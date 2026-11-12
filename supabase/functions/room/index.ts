/**
 * Edge Function "room": Freunde-Modus (Live-Räume für 2–30 Spieler).
 *
 * Alle Aktionen laufen hier mit service_role; die Raum-Tabellen sind für Clients
 * gesperrt. Clients lesen den bereinigten Zustand per RPC room_state() und werden
 * per Realtime-Broadcast (Trigger in der DB) über Änderungen informiert.
 *
 *   POST { action, code?, ... }   Authorization: Bearer <Spieler-JWT>
 *
 * Aktionen: create, join, leave, settings, kick, start, answer, tick, next, override, again
 *
 * Anti-Schummeln: Zeit kommt vom Server, Antworten nur in der Fragephase und nur einmal,
 * Antwortlisten verlassen den Server nie (nur die Gruppen der Auflösung).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { compact, normalize } from '../_shared/domain/normalize.ts';
import { matchAnswer } from '../_shared/domain/matchAnswer.ts';
import { scoreAnswer, scoreAiVerdict, type AiVerdict } from '../_shared/domain/scoring.ts';
import { berlinDateKey, selectDailySets } from '../_shared/domain/daily.ts';
import type { Answer, Question } from '../_shared/domain/types.ts';
import {
  acceptsAnswer,
  COUNTDOWN_MS,
  CUSTOM_PROMPT_MAX,
  DEFAULT_SETTINGS,
  freeColor,
  isRoomCode,
  makeRoomCode,
  nextHost,
  nextTransition,
  planQuestions,
  playsQuestion,
  REVEAL_MS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  ROOMS_PER_HOUR,
  sanitizeSettings,
  settingsProblem,
  type RoomSettings,
  type RoomStatus,
} from '../_shared/domain/room.ts';
import { scoreQuestion, type RoomAnswerInput } from '../_shared/domain/roomScoring.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? firstKey('SUPABASE_PUBLISHABLE_KEYS');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? firstKey('SUPABASE_SECRET_KEYS');

function firstKey(name: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://playhighsandlows.github.io').split(',').map((s) => s.trim()).filter(Boolean),
);
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
function corsHeaders(origin: string | null): Record<string, string> {
  const base = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  return origin && (ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin)) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

class Fail extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Room {
  id: string;
  code: string;
  host_id: string | null;
  created_by: string | null;
  status: RoomStatus;
  settings: RoomSettings;
  current_index: number;
  question_count: number;
  phase_ends_at: string | null;
  round: number;
  version: number;
}
interface Player {
  room_id: string;
  user_id: string;
  name: string;
  avatar: number;
  color: number;
  from_index: number;
  kicked: boolean;
  joined_at: string;
  last_seen: string;
}
interface AnswerRow {
  user_id: string;
  raw: string;
  normalized: string;
  status: 'pending' | 'valid' | 'invalid' | 'unchecked';
  list_answer: string | null;
  canonical: string | null;
  source: 'list' | 'ai' | null;
  global_tier: string | null;
  global_points: number | null;
  override_valid: boolean | null;
  created_at: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null) => (s ? Date.parse(s) : null);

async function loadRoom(code: unknown): Promise<Room> {
  const c = typeof code === 'string' ? code.toUpperCase() : '';
  if (!isRoomCode(c)) throw new Fail('not_found', 404);
  const { data } = await db.from('rooms').select('*').eq('code', c).maybeSingle();
  if (!data) throw new Fail('not_found', 404);
  return data as Room;
}

async function loadPlayers(roomId: string): Promise<Player[]> {
  const { data } = await db.from('room_players').select('*').eq('room_id', roomId).order('joined_at');
  return (data ?? []) as Player[];
}

/**
 * Raum ändern, nur wenn niemand dazwischen kam (Versionsvergleich) – so können viele
 * Clients gleichzeitig „ticken“, ohne dass ein Schritt doppelt passiert.
 */
async function casUpdate(room: Room, patch: Partial<Room> & Record<string, unknown>): Promise<Room | null> {
  const { data } = await db
    .from('rooms')
    .update({ ...patch, version: room.version + 1, last_activity_at: new Date().toISOString() })
    .eq('id', room.id)
    .eq('version', room.version)
    .select('*')
    .maybeSingle();
  return (data as Room) ?? null;
}

/** Version erhöhen (Broadcast „Zustand neu“), unabhängig von Konflikten. */
async function bump(roomId: string) {
  const { data } = await db.from('rooms').select('version').eq('id', roomId).single();
  await db
    .from('rooms')
    .update({ version: (data?.version ?? 0) + 1, last_activity_at: new Date().toISOString() })
    .eq('id', roomId);
}

const isMember = (players: Player[], uid: string) => players.find((p) => p.user_id === uid && !p.kicked);

function requireHost(room: Room, uid: string) {
  if (room.host_id !== uid) throw new Fail('not_host', 403);
}

function cleanName(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, 20) : '';
}
const cleanAvatar = (a: unknown) => (Number.isInteger(a) && (a as number) >= 0 && (a as number) <= 11 ? (a as number) : 0);

async function isBanned(uid: string): Promise<boolean> {
  const { data } = await db.from('player_bans').select('user_id').eq('user_id', uid).maybeSingle();
  return !!data;
}

/** Datenbankfehler beim Spieler-Eintrag in verständliche Codes übersetzen. */
function playerError(e: { code?: string; message?: string } | null): never {
  if (e?.code === '23505') throw new Fail('name_taken', 409);
  if (e?.code === '23514') throw new Fail('name_invalid', 400);
  throw new Fail(e?.message ?? 'db_error', 500);
}

// ---------------------------------------------------------------- Aktionen

async function create(uid: string, body: Record<string, unknown>) {
  if (await isBanned(uid)) throw new Fail('banned', 403);
  const since = iso(Date.now() - 3600_000);
  const { count } = await db.from('rooms').select('id', { count: 'exact', head: true }).eq('created_by', uid).gte('created_at', since);
  if ((count ?? 0) >= ROOMS_PER_HOUR) throw new Fail('rate_limited', 429);
  const name = cleanName(body.name);
  const settings = sanitizeSettings(body.settings, { ...DEFAULT_SETTINGS, lang: body.lang === 'en' ? 'en' : 'de' });
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeRoomCode();
    const { data: room, error } = await db
      .from('rooms')
      .insert({ code, host_id: uid, created_by: uid, settings })
      .select('*')
      .single();
    if (error?.code === '23505') continue; // Code schon vergeben
    if (error || !room) throw new Fail(error?.message ?? 'db_error', 500);
    const { error: pe } = await db.from('room_players').insert({ room_id: room.id, user_id: uid, name, avatar: cleanAvatar(body.avatar), color: 0 });
    if (pe) {
      await db.from('rooms').delete().eq('id', room.id);
      playerError(pe);
    }
    return { code };
  }
  throw new Fail('no_code', 500);
}

async function join(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  if (await isBanned(uid)) throw new Fail('banned', 403);
  const players = await loadPlayers(room.id);
  const existing = players.find((p) => p.user_id === uid);
  if (existing?.kicked) throw new Fail('kicked', 403);
  const name = cleanName(body.name);
  const avatar = cleanAvatar(body.avatar);
  if (existing) {
    // Wieder da (z. B. neues Gerät/Reload): Name/Avatar aktualisieren
    const { error } = await db.from('room_players').update({ name, avatar, last_seen: new Date().toISOString() }).eq('room_id', room.id).eq('user_id', uid);
    if (error) playerError(error);
    await bump(room.id);
    return { code: room.code };
  }
  if (players.filter((p) => !p.kicked).length >= ROOM_MAX_PLAYERS) throw new Fail('room_full', 409);
  // Später Beitretende steigen ab der nächsten Frage ein
  const from_index = room.status === 'lobby' || room.status === 'finished' || room.status === 'countdown' ? 0 : room.current_index + 1;
  const { error } = await db.from('room_players').insert({
    room_id: room.id,
    user_id: uid,
    name,
    avatar,
    color: freeColor(players.filter((p) => !p.kicked).map((p) => p.color)),
    from_index,
  });
  if (error) playerError(error);
  await bump(room.id);
  return { code: room.code };
}

async function leave(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  await db.from('room_players').delete().eq('room_id', room.id).eq('user_id', uid);
  const rest = (await loadPlayers(room.id)).filter((p) => !p.kicked);
  if (rest.length === 0) {
    await db.from('rooms').delete().eq('id', room.id);
    return { left: true };
  }
  if (room.host_id === uid) await db.from('rooms').update({ host_id: rest[0].user_id }).eq('id', room.id);
  await bump(room.id);
  return { left: true };
}

async function updateSettings(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  if (room.status !== 'lobby' && room.status !== 'finished') throw new Fail('not_in_lobby', 409);
  const settings = sanitizeSettings(body.settings, room.settings);
  await db.from('rooms').update({ settings, version: room.version + 1, last_activity_at: new Date().toISOString() }).eq('id', room.id);
  return { settings };
}

async function kick(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  const target = typeof body.user_id === 'string' ? body.user_id : '';
  if (!target || target === uid) throw new Fail('bad_target');
  await db.from('room_players').update({ kicked: true }).eq('room_id', room.id).eq('user_id', target);
  await bump(room.id);
  return { kicked: target };
}

/** Fragen-Pool aus der DB (ohne die heutigen Tagesfragen – sonst würde der Raum sie verraten). */
async function catalogPool(s: RoomSettings): Promise<string[]> {
  const { data } = await db.from('questions').select('id, lang, topic, prompt, modes').eq('lang', s.lang);
  const all = ((data ?? []) as Question[]).map((q) => ({ ...q, answers: [] as Answer[] }));
  const daily = selectDailySets(all, berlinDateKey(), s.lang);
  const blocked = new Set([...daily.rare, ...daily.common].map((q) => q.id));
  return all
    .filter((q) => q.modes.includes(s.mode) && !blocked.has(q.id))
    .filter((q) => (s.source === 'topics' || s.source === 'mixed') && s.topics.length ? s.topics.includes(q.topic) : true)
    .map((q) => q.id);
}

async function start(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  if (room.status !== 'lobby') throw new Fail('not_in_lobby', 409);
  const players = (await loadPlayers(room.id)).filter((p) => !p.kicked);
  if (players.length < ROOM_MIN_PLAYERS) throw new Fail('too_few_players', 409);
  const s = room.settings;
  const problem = settingsProblem(s);
  if (problem) throw new Fail(problem, 409);

  const ids = s.source === 'custom' ? [] : await catalogPool(s);
  const plan = planQuestions(s, ids);
  if (plan.length === 0) throw new Fail('no_questions', 409);
  const { data: qs } = await db.from('questions').select('id, prompt, topic').in('id', plan.flatMap((p) => (p.kind === 'catalog' ? [p.id] : [])));
  const byId = new Map(((qs ?? []) as { id: string; prompt: string; topic: string }[]).map((q) => [q.id, q]));

  await db.from('room_questions').delete().eq('room_id', room.id);
  const rows = plan.map((p, idx) =>
    p.kind === 'catalog'
      ? { room_id: room.id, idx, question_id: p.id, prompt: byId.get(p.id)?.prompt ?? '?', topic: byId.get(p.id)?.topic ?? null, lang: s.lang }
      : { room_id: room.id, idx, custom_prompt: p.prompt, prompt: p.prompt, topic: null, lang: s.lang },
  );
  const { error } = await db.from('room_questions').insert(rows);
  if (error) throw new Fail(error.message, 500);
  await db.from('room_players').update({ from_index: 0 }).eq('room_id', room.id);
  const updated = await casUpdate(room, {
    status: 'countdown',
    current_index: -1,
    question_count: rows.length,
    phase_ends_at: iso(Date.now() + COUNTDOWN_MS),
  });
  if (!updated) throw new Fail('conflict', 409);
  return { started: true };
}

// ---------------------------------------------------------------- Antworten prüfen

interface CatalogQuestion {
  id: string;
  lang: 'de' | 'en';
  topic: string;
  prompt: string;
  modes: ('rare' | 'common')[];
  answers: Answer[];
}

/** KI-Prüfung über die bestehende Funktion judge-answer (Cache, Freigaben, Limits, Log). */
async function askJudge(jwt: string, payload: Record<string, unknown>): Promise<AiVerdict> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/judge-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { status: 'error' };
    const r = (await res.json()) as { status: AiVerdict['status']; list_answer: string | null; canonical_text: string | null; estimated_base_score: number | null; approved?: boolean };
    return { status: r.status, approved: r.approved === true, listAnswer: r.list_answer, canonicalText: r.canonical_text, estimatedBaseScore: r.estimated_base_score };
  } catch {
    return { status: 'error' };
  }
}

async function answer(uid: string, jwt: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  const now = Date.now();
  const idx = Number(body.idx);
  if (idx !== room.current_index || !acceptsAnswer(room.status, ms(room.phase_ends_at), now)) throw new Fail('too_late', 409);
  const players = await loadPlayers(room.id);
  const me = players.find((p) => p.user_id === uid);
  if (!me || !playsQuestion(me, idx)) throw new Fail('not_playing', 403);
  if (await isBanned(uid)) throw new Fail('banned', 403);
  const raw = typeof body.answer === 'string' ? body.answer.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  // Nur einmal pro Frage (Primärschlüssel); leere Eingabe = Pass (0 Punkte)
  const { error } = await db.from('room_answers').insert({ room_id: room.id, idx, user_id: uid, raw, normalized: normalize(raw).slice(0, 100), status: raw ? 'pending' : 'invalid' });
  if (error?.code === '23505') throw new Fail('already_answered', 409);
  if (error) throw new Fail(error.message, 500);

  if (raw) {
    const { data: rq } = await db.from('room_questions').select('question_id, custom_prompt').eq('room_id', room.id).eq('idx', idx).single();
    const patch = rq?.custom_prompt
      ? await judgeCustom(jwt, room, idx, raw)
      : await judgeCatalog(jwt, room.settings.mode, rq?.question_id as string, raw);
    await db.from('room_answers').update(patch).eq('room_id', room.id).eq('idx', idx).eq('user_id', uid);
  }
  // Vielleicht haben jetzt alle geantwortet → sofort auflösen
  await advance(room.code);
  return { accepted: true };
}

async function judgeCatalog(jwt: string, mode: 'rare' | 'common', questionId: string, raw: string): Promise<Partial<AnswerRow>> {
  const { data } = await db.from('questions').select('*').eq('id', questionId).single();
  const q = data as CatalogQuestion;
  const question: Question = { ...q, approvedKeys: [] } as unknown as Question;
  const match = matchAnswer(question, raw);
  if (match) {
    const r = scoreAnswer({ mode, questionId, input: raw, match, frequency: match.answer.baseScore });
    return { status: 'valid', list_answer: match.answer.text, canonical: match.answer.text, base_score: match.answer.baseScore, source: 'list', global_tier: r.tier, global_points: r.points } as Partial<AnswerRow>;
  }
  // Nicht in der Liste: freigegebene Antworten, Cache und KI über judge-answer
  const verdict = await askJudge(jwt, { question_id: questionId, answer: raw });
  const r = scoreAiVerdict({ mode, question, input: raw, verdict });
  if (verdict.status === 'error' || verdict.status === 'limited') return { status: 'unchecked', source: 'ai', global_tier: 'invalid', global_points: 0 };
  return {
    status: verdict.status === 'valid' ? 'valid' : 'invalid',
    list_answer: verdict.listAnswer ?? null,
    canonical: verdict.canonicalText ?? null,
    base_score: verdict.estimatedBaseScore ?? null,
    source: r.source ?? 'ai',
    global_tier: r.tier,
    global_points: r.points,
  } as Partial<AnswerRow>;
}

async function judgeCustom(jwt: string, room: Room, idx: number, raw: string): Promise<Partial<AnswerRow>> {
  const verdict = await askJudge(jwt, { room_code: room.code, room_idx: idx, answer: raw });
  if (verdict.status === 'error' || verdict.status === 'limited') return { status: 'unchecked', source: 'ai' };
  return { status: verdict.status === 'valid' ? 'valid' : 'invalid', canonical: verdict.canonicalText ?? null, source: 'ai' };
}

// ---------------------------------------------------------------- Ablauf

/**
 * Nächsten Schritt ausführen, wenn er fällig ist (Serverzeit). Darf beliebig oft und
 * parallel aufgerufen werden: Zustandswechsel laufen per Versionsvergleich genau einmal.
 */
async function advance(code: string, force = false): Promise<void> {
  for (let step = 0; step < 4; step++) {
    const room = await loadRoom(code);
    const players = await loadPlayers(room.id);

    // Gastgeber nicht mehr erreichbar → Rolle geht an den am längsten Anwesenden
    const host = nextHost(players, room.host_id, Date.now());
    if (host !== room.host_id) {
      await casUpdate(room, { host_id: host });
      continue;
    }

    // Hängengebliebene Auswertung (Abbruch mitten drin) erneut versuchen
    if (room.status === 'scoring') {
      if (Date.now() - (ms(room.phase_ends_at) ?? 0) > 30_000) await scoreCurrent(room);
      return;
    }

    let allAnswered = false;
    let pending = false;
    if (room.status === 'question') {
      const { data } = await db.from('room_answers').select('user_id, status').eq('room_id', room.id).eq('idx', room.current_index);
      const rows = (data ?? []) as { user_id: string; status: string }[];
      const playing = players.filter((p) => playsQuestion(p, room.current_index));
      const answered = new Set(rows.map((r) => r.user_id));
      pending = rows.some((r) => r.status === 'pending');
      allAnswered = playing.length > 0 && playing.every((p) => answered.has(p.user_id)) && !pending;
    }
    const t = nextTransition({
      status: room.status,
      index: room.current_index,
      count: room.question_count,
      endsAt: force ? 0 : ms(room.phase_ends_at),
      now: Date.now(),
      allAnswered,
      pending,
    });
    if (!t) return;
    if (t.to === 'question') {
      const seconds = room.settings.seconds ?? 25;
      const endsAt = Date.now() + seconds * 1000;
      const updated = await casUpdate(room, { status: 'question', current_index: t.index, phase_ends_at: iso(endsAt) });
      if (updated) await db.from('room_questions').update({ started_at: new Date().toISOString(), ends_at: iso(endsAt) }).eq('room_id', room.id).eq('idx', t.index);
      return;
    }
    if (t.to === 'finished') {
      await casUpdate(room, { status: 'finished', phase_ends_at: null });
      return;
    }
    if (t.to === 'scoring') {
      const claimed = await casUpdate(room, { status: 'scoring', phase_ends_at: new Date().toISOString() });
      if (claimed) await scoreCurrent(claimed);
      return;
    }
  }
}

/** Aktuelle Frage auswerten und die Auflösung speichern. */
async function scoreCurrent(room: Room): Promise<void> {
  const idx = room.current_index;
  const [players, answersRes, rqRes] = await Promise.all([
    loadPlayers(room.id),
    db.from('room_answers').select('*').eq('room_id', room.id).eq('idx', idx),
    db.from('room_questions').select('question_id, custom_prompt').eq('room_id', room.id).eq('idx', idx).single(),
  ]);
  const rows = (answersRes.data ?? []) as AnswerRow[];
  const custom = !!rqRes.data?.custom_prompt;
  const reveal = await buildReveal(room, idx, players, rows, custom, rqRes.data?.question_id ?? null);
  const after = await loadRoom(room.code);
  await casUpdate(after, { status: 'reveal', phase_ends_at: iso(Date.now() + REVEAL_MS) });
  void reveal;
}

async function buildReveal(room: Room, idx: number, players: Player[], rows: AnswerRow[], custom: boolean, questionId: string | null) {
  const scoring = custom ? 'group' : room.settings.scoring;
  const participants = players.filter((p) => playsQuestion(p, idx)).map((p) => p.user_id);
  const inputs: RoomAnswerInput[] = rows.map((a) => {
    // laufende Prüfung bei Auflösung = nicht geprüft (0 Punkte)
    const valid = a.override_valid ?? a.status === 'valid';
    const display = (a.list_answer ?? a.canonical ?? a.raw).trim() || '–';
    return {
      userId: a.user_id,
      raw: a.raw,
      valid,
      groupKey: valid ? compact(a.list_answer ?? a.canonical ?? a.raw) : compact(a.raw) || '∅',
      display: valid ? display : a.raw.trim() || '–',
      globalTier: (a.override_valid === true && !a.global_points ? (room.settings.mode === 'rare' ? 'moss' : 'meadow') : a.global_tier) as RoomAnswerInput['globalTier'],
      globalPoints: a.override_valid === true && !a.global_points ? 10 : a.global_points,
      source: a.source,
    };
  });
  const score = scoreQuestion({ mode: room.settings.mode, scoring, participants, answers: inputs });
  await Promise.all(
    Object.entries(score.perPlayer)
      .filter(([u]) => rows.some((r) => r.user_id === u))
      .map(([u, p]) => db.from('room_answers').update({ points: p.points, tier: p.tier }).eq('room_id', room.id).eq('idx', idx).eq('user_id', u)),
  );
  // Zur Einordnung (nur Katalogfragen): häufigste und seltenste Listen-Antwort
  let list: { top: string | null; rarest: string | null } | null = null;
  if (questionId) {
    const { data } = await db.from('questions').select('answers').eq('id', questionId).single();
    const answers = ((data?.answers ?? []) as Answer[]).filter((a) => !a.tooClever);
    const sorted = [...answers].sort((a, b) => b.baseScore - a.baseScore);
    list = { top: sorted[0]?.text ?? null, rarest: sorted.at(-1)?.text ?? null };
  }
  const reveal = {
    idx,
    scoring,
    mode: room.settings.mode,
    groups: score.groups,
    players: Object.fromEntries(
      Object.entries(score.perPlayer).map(([u, p]) => [u, { ...p, answer: rows.find((r) => r.user_id === u)?.raw ?? null }]),
    ),
    missed: score.missed,
    unchecked: rows.filter((r) => r.status === 'unchecked' || r.status === 'pending').map((r) => r.user_id),
    list,
  };
  await db.from('room_questions').update({ reveal }).eq('room_id', room.id).eq('idx', idx);
  return reveal;
}

async function next(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  if (room.status !== 'reveal') throw new Fail('not_in_reveal', 409);
  // Spontane eigene Frage als nächste einschieben
  const prompt = typeof body.custom_prompt === 'string' ? body.custom_prompt.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_PROMPT_MAX) : '';
  if (prompt.length >= 3) {
    const at = room.current_index + 1;
    const { data: later } = await db.from('room_questions').select('idx').eq('room_id', room.id).gte('idx', at).order('idx', { ascending: false });
    for (const r of (later ?? []) as { idx: number }[]) {
      await db.from('room_questions').update({ idx: r.idx + 1 }).eq('room_id', room.id).eq('idx', r.idx);
    }
    await db.from('room_questions').insert({ room_id: room.id, idx: at, custom_prompt: prompt, prompt, lang: room.settings.lang });
    const fresh = await loadRoom(room.code);
    await casUpdate(fresh, { question_count: fresh.question_count + 1 });
  }
  await advance(room.code, true);
  return { ok: true };
}

async function override(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  if (room.status !== 'reveal' && room.status !== 'finished') throw new Fail('not_in_reveal', 409);
  const idx = room.current_index;
  const users = Array.isArray(body.user_ids) ? body.user_ids.filter((u): u is string => typeof u === 'string') : [];
  if (!users.length) throw new Fail('bad_target');
  await db.from('room_answers').update({ override_valid: body.valid === true }).eq('room_id', room.id).eq('idx', idx).in('user_id', users);
  const [players, answersRes, rqRes] = await Promise.all([
    loadPlayers(room.id),
    db.from('room_answers').select('*').eq('room_id', room.id).eq('idx', idx),
    db.from('room_questions').select('question_id, custom_prompt').eq('room_id', room.id).eq('idx', idx).single(),
  ]);
  await buildReveal(room, idx, players, (answersRes.data ?? []) as AnswerRow[], !!rqRes.data?.custom_prompt, rqRes.data?.question_id ?? null);
  // Auflösung etwas verlängern, damit alle die Korrektur sehen
  await db.from('rooms').update({ version: room.version + 1, phase_ends_at: room.status === 'reveal' ? iso(Date.now() + REVEAL_MS) : null, last_activity_at: new Date().toISOString() }).eq('id', room.id);
  return { ok: true };
}

async function again(uid: string, body: Record<string, unknown>) {
  const room = await loadRoom(body.code);
  requireHost(room, uid);
  if (room.status !== 'finished') throw new Fail('not_finished', 409);
  await db.from('room_questions').delete().eq('room_id', room.id);
  await db.from('room_players').update({ from_index: 0 }).eq('room_id', room.id);
  await casUpdate(room, { status: 'lobby', current_index: -1, question_count: 0, phase_ends_at: null, round: room.round + 1 });
  return { ok: true };
}

// ---------------------------------------------------------------- HTTP

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth } = jwt ? await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.getUser(jwt) : { data: { user: null } };
  const user = auth?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  try {
    const uid = user.id;
    const action = String(body.action ?? '');
    // Mitgliedschaft prüfen (außer bei create/join)
    if (!['create', 'join'].includes(action)) {
      const room = await loadRoom(body.code);
      if (!isMember(await loadPlayers(room.id), uid)) throw new Fail('not_member', 403);
    }
    switch (action) {
      case 'create':
        return json(await create(uid, body));
      case 'join':
        return json(await join(uid, body));
      case 'leave':
        return json(await leave(uid, body));
      case 'settings':
        return json(await updateSettings(uid, body));
      case 'kick':
        return json(await kick(uid, body));
      case 'start':
        return json(await start(uid, body));
      case 'answer':
        return json(await answer(uid, jwt, body));
      case 'tick':
        await advance((await loadRoom(body.code)).code);
        return json({ ok: true });
      case 'next':
        return json(await next(uid, body));
      case 'override':
        return json(await override(uid, body));
      case 'again':
        return json(await again(uid, body));
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    console.error('room error', String(e));
    return json({ error: 'server_error' }, 500);
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const res = await handle(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
