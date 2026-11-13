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
 * Anti-Schummeln: Zeit kommt vom Server, Versuche nur in der Fragephase, Antwortlisten
 * verlassen den Server nie (nur die Gruppen der Auflösung).
 *
 * Mehrere Versuche: Jeder Versuch wird einzeln geprüft (room_attempts). Die erste gültige
 * Antwort zählt und beendet die Frage für den Spieler; nach Ablauf der Fragezeit gibt es
 * keine Versuche mehr. KI höchstens MAX_AI_CHECKS-mal pro Frage und Spieler.
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
import { isNonsense, MAX_AI_CHECKS, nearMiss, pickFunnyAttempts, ROOM_MAX_ATTEMPTS } from '../_shared/domain/attempts.ts';

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
  ended_by_admin: boolean;
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
interface AttemptRow {
  user_id: string;
  n: number;
  raw: string;
  status: 'pending' | 'valid' | 'invalid' | 'unchecked';
  reason: 'nonsense' | 'ai' | 'list_only' | 'limited' | null;
  ai: boolean;
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
  if (room.ended_by_admin) throw new Fail('not_found', 404);
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
    const r = (await res.json()) as { status: AiVerdict['status']; list_answer: string | null; canonical_text: string | null; estimated_base_score: number | null; approved?: boolean; cached?: boolean; scope?: 'question' | 'day' };
    return { status: r.status, approved: r.approved === true, cached: r.cached === true || r.approved === true, scope: r.scope, listAnswer: r.list_answer, canonicalText: r.canonical_text, estimatedBaseScore: r.estimated_base_score };
  } catch {
    return { status: 'error' };
  }
}

/** Antwort an den Client auf einen Versuch. */
interface AttemptReply {
  accepted: boolean;
  /** duplicate: schon versucht · invalid: nicht gültig · list_only/limited: keine KI mehr · unchecked: KI nicht erreichbar · too_many */
  reason?: 'duplicate' | 'invalid' | 'list_only' | 'limited' | 'unchecked' | 'too_many';
  /** „Meintest du …?“ (knapp neben einer Listen-Antwort) */
  hint?: string | null;
  ai_left: number;
  attempts: number;
}

/**
 * Ein Versuch. Die erste gültige Antwort zählt (room_answers) und beendet die Frage für den
 * Spieler; alles andere wird nur als Versuch festgehalten und er darf weiter raten.
 */
async function answer(uid: string, jwt: string, body: Record<string, unknown>): Promise<AttemptReply> {
  const room = await loadRoom(body.code);
  const now = Date.now();
  const idx = Number(body.idx);
  // Nach Ablauf der Fragezeit keine Versuche mehr
  if (idx !== room.current_index || !acceptsAnswer(room.status, ms(room.phase_ends_at), now)) throw new Fail('too_late', 409);
  const raw = typeof body.answer === 'string' ? body.answer.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!raw) throw new Fail('empty', 400);

  // alles Nötige in einem Rutsch (jeder Versuch soll schnell beantwortet sein)
  const [players, banned, { data: accepted }, { data: before }, { data: rq }] = await Promise.all([
    loadPlayers(room.id),
    isBanned(uid),
    db.from('room_answers').select('user_id').eq('room_id', room.id).eq('idx', idx).eq('user_id', uid).maybeSingle(),
    db.from('room_attempts').select('user_id, n, raw, status, reason, ai, created_at').eq('room_id', room.id).eq('idx', idx).eq('user_id', uid).order('n'),
    db.from('room_questions').select('question_id, custom_prompt').eq('room_id', room.id).eq('idx', idx).single(),
  ]);
  const me = players.find((p) => p.user_id === uid);
  if (!me || !playsQuestion(me, idx)) throw new Fail('not_playing', 403);
  if (banned) throw new Fail('banned', 403);
  if (accepted) throw new Fail('already_answered', 409);
  const attempts = (before ?? []) as (AttemptRow & { created_at: string })[];
  // immer nur eine Prüfung gleichzeitig (eine hängengebliebene gilt nach 15 s als „nicht geprüft“)
  for (const a of attempts.filter((x) => x.status === 'pending')) {
    if (now - Date.parse(a.created_at) < 15_000) throw new Fail('busy', 409);
    a.status = 'unchecked';
    await db.from('room_attempts').update({ status: 'unchecked' }).eq('room_id', room.id).eq('idx', idx).eq('user_id', uid).eq('n', a.n);
  }
  const aiUsed = attempts.filter((a) => a.ai).length;
  const reply = (r: Partial<AttemptReply> & { accepted: boolean }, used = aiUsed, count = attempts.length): AttemptReply => ({ ai_left: Math.max(0, MAX_AI_CHECKS - used), attempts: count, ...r });

  // Doppelte Eingabe: sofort ablehnen, ohne Prüfung und ohne neuen Versuch
  const key = compact(raw);
  if (attempts.some((a) => a.status === 'invalid' && compact(a.raw) === key)) return reply({ accepted: false, reason: 'duplicate' });
  if (attempts.length >= ROOM_MAX_ATTEMPTS) return reply({ accepted: false, reason: 'too_many' });

  const n = (attempts.at(-1)?.n ?? 0) + 1;
  const base = { room_id: room.id, idx, user_id: uid, n, raw, normalized: normalize(raw).slice(0, 100) };
  const record = async (row: Partial<AttemptRow>) => {
    const { error } = await db.from('room_attempts').insert({ ...base, ...row });
    // gleichzeitiger Versuch desselben Spielers (gleiche Nummer)
    if (error?.code === '23505') throw new Fail('busy', 409);
    if (error) throw new Fail(error.message, 500);
  };
  const settle = (row: Partial<AttemptRow>) => db.from('room_attempts').update(row).eq('room_id', room.id).eq('idx', idx).eq('user_id', uid).eq('n', n);
  /** Gültig: als gewertete Antwort eintragen – nur solange die Frage noch läuft. */
  const accept = async (patch: Partial<AnswerRow>): Promise<boolean> => {
    const fresh = await loadRoom(room.code);
    if (fresh.status !== 'question' || fresh.current_index !== idx) return false;
    const { error } = await db.from('room_answers').insert({ room_id: room.id, idx, user_id: uid, raw, normalized: base.normalized, attempts: n, ...patch });
    if (error?.code === '23505') throw new Fail('already_answered', 409);
    if (error) throw new Fail(error.message, 500);
    return true;
  };

  const custom = !!rq?.custom_prompt;
  let question: Question | null = null;
  let hint: string | null = null;
  if (!custom) {
    // 1. Lokal: Liste, Aliase, Tippfehler-Toleranz
    const { data } = await db.from('questions').select('*').eq('id', rq?.question_id as string).single();
    question = { ...(data as CatalogQuestion), approvedKeys: [] } as unknown as Question;
    const match = matchAnswer(question, raw);
    if (match) {
      const r = scoreAnswer({ mode: room.settings.mode, questionId: question.id, input: raw, match, frequency: match.answer.baseScore });
      await record({ status: 'valid' });
      const ok = await accept({ status: 'valid', list_answer: match.answer.text, canonical: match.answer.text, base_score: match.answer.baseScore, source: 'list', global_tier: r.tier, global_points: r.points } as Partial<AnswerRow>);
      if (!ok) throw new Fail('too_late', 409);
      await advance(room.code);
      return reply({ accepted: true }, aiUsed, n);
    }
    hint = nearMiss(question, raw);
  }

  // 2. Offensichtlicher Unsinn geht gar nicht erst an die KI
  if (isNonsense(question ?? { answers: [] }, raw)) {
    await record({ status: 'invalid', reason: 'nonsense' });
    return reply({ accepted: false, reason: 'invalid', hint }, aiUsed, n);
  }

  // 3. Server-Cache/Freigaben; KI nur, solange das Kontingent der Frage reicht
  const cacheOnly = aiUsed >= MAX_AI_CHECKS;
  if (cacheOnly && custom) {
    // eigene Fragen haben weder Liste noch Cache
    await record({ status: 'invalid', reason: 'list_only' });
    return reply({ accepted: false, reason: 'list_only' }, aiUsed, n);
  }
  await record({ status: 'pending' });
  const verdict = custom
    ? await askJudge(jwt, { room_code: room.code, room_idx: idx, answer: raw })
    : await askJudge(jwt, { question_id: question!.id, answer: raw, ...(cacheOnly ? { cache_only: true } : {}) });
  // Cache-Treffer, Freigaben und reine Cache-Abfragen verbrauchen kein Kontingent
  const ai = !cacheOnly && !verdict.cached && verdict.status !== 'limited' && verdict.status !== 'uncached';
  const used = aiUsed + (ai ? 1 : 0);

  if (verdict.status === 'valid') {
    let patch: Partial<AnswerRow> = { status: 'valid', canonical: verdict.canonicalText ?? null, source: 'ai' };
    if (question) {
      const r = scoreAiVerdict({ mode: room.settings.mode, question, input: raw, verdict });
      patch = { ...patch, list_answer: verdict.listAnswer ?? null, base_score: verdict.estimatedBaseScore ?? null, source: r.source ?? 'ai', global_tier: r.tier, global_points: r.points } as Partial<AnswerRow>;
    }
    const ok = await accept(patch);
    await settle({ status: ok ? 'valid' : 'invalid', ai });
    if (!ok) throw new Fail('too_late', 409);
    await advance(room.code);
    return reply({ accepted: true }, used, n);
  }
  if (verdict.status === 'error') {
    await settle({ status: 'unchecked', ai });
    await advance(room.code);
    return reply({ accepted: false, reason: 'unchecked' }, used, n);
  }
  const reason = verdict.status === 'invalid' ? 'ai' : verdict.status === 'limited' && verdict.scope !== 'question' ? 'limited' : 'list_only';
  await settle({ status: 'invalid', reason, ai });
  // Wartete die Auflösung nur noch auf diese Prüfung?
  await advance(room.code);
  return reply({ accepted: false, reason: reason === 'ai' ? 'invalid' : reason, hint }, used, n);
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
      const [{ data }, { count }] = await Promise.all([
        db.from('room_answers').select('user_id, status').eq('room_id', room.id).eq('idx', room.current_index).eq('status', 'valid'),
        db.from('room_attempts').select('n', { count: 'exact', head: true }).eq('room_id', room.id).eq('idx', room.current_index).eq('status', 'pending'),
      ]);
      const playing = players.filter((p) => playsQuestion(p, room.current_index));
      // „geantwortet“ heißt: eine gültige Antwort – wer noch rät, hält die Frage bis zum Zeitablauf offen
      const answered = new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
      pending = (count ?? 0) > 0;
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
  await closeAttempts(room.id, idx);
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

/**
 * Frage vorbei: Wer keine gültige Antwort hat, bekommt seinen letzten Versuch als (ungültige)
 * Antwort eingetragen – so sieht man in der Auflösung, woran es lag, und der Gastgeber kann
 * sie noch gelten lassen. Gültige Antworten bekommen die Zahl der Versuche.
 */
async function closeAttempts(roomId: string, idx: number): Promise<void> {
  const [{ data: att }, { data: ans }] = await Promise.all([
    db.from('room_attempts').select('user_id, n, raw, status, reason, ai').eq('room_id', roomId).eq('idx', idx).order('n'),
    db.from('room_answers').select('user_id').eq('room_id', roomId).eq('idx', idx),
  ]);
  const have = new Set(((ans ?? []) as { user_id: string }[]).map((a) => a.user_id));
  const last = new Map<string, AttemptRow>();
  for (const a of (att ?? []) as AttemptRow[]) last.set(a.user_id, a);
  const missing = [...last.values()].filter((a) => !have.has(a.user_id));
  if (!missing.length) return;
  await db.from('room_answers').upsert(
    missing.map((a) => ({
      room_id: roomId,
      idx,
      user_id: a.user_id,
      raw: a.raw,
      normalized: normalize(a.raw).slice(0, 100),
      // laufende/gescheiterte Prüfung oder gar nicht mehr geprüft (KI-Kontingent, Limit) = nicht geprüft, nicht „falsch“
      status: a.status === 'invalid' && a.reason !== 'list_only' && a.reason !== 'limited' ? 'invalid' : 'unchecked',
      source: a.ai || a.status !== 'invalid' ? 'ai' : 'list',
      global_tier: 'invalid',
      global_points: 0,
      attempts: a.n,
    })),
    { onConflict: 'room_id,idx,user_id', ignoreDuplicates: true },
  );
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
  // Versuche: Anzahl je Spieler immer; die Fehlversuche selbst nur, wenn der Raum es erlaubt
  const { data: att } = await db.from('room_attempts').select('user_id, n, raw, status, reason, ai').eq('room_id', room.id).eq('idx', idx).order('n');
  const attempts = ((att ?? []) as AttemptRow[]).filter((a) => participants.includes(a.user_id));
  const tries: Record<string, number> = {};
  for (const a of attempts) tries[a.user_id] = Math.max(tries[a.user_id] ?? 0, a.n);
  // ohne die Antworten, die ohnehin als „ungültig“ in der Auflösung stehen
  const finals = new Set(rows.map((r) => `${r.user_id}|${compact(r.raw)}`));
  const funny = room.settings.show_attempts
    ? pickFunnyAttempts(attempts.filter((a) => a.status === 'invalid' && !finals.has(`${a.user_id}|${compact(a.raw)}`))).map((a) => ({ user_id: a.user_id, text: a.raw }))
    : null;
  const reveal = {
    idx,
    scoring,
    mode: room.settings.mode,
    groups: score.groups,
    players: Object.fromEntries(
      Object.entries(score.perPlayer).map(([u, p]) => [u, { ...p, answer: rows.find((r) => r.user_id === u)?.raw ?? null, attempts: tries[u] ?? 0 }]),
    ),
    missed: score.missed,
    unchecked: rows.filter((r) => r.status === 'unchecked' || r.status === 'pending').map((r) => r.user_id),
    list,
    funny,
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
  if (room.ended_by_admin) throw new Fail('ended_by_admin', 409);
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
    // Mitgliedschaft prüfen (außer bei create/join; „answer“ prüft sie selbst, das spart zwei Abfragen pro Versuch)
    if (!['create', 'join', 'answer'].includes(action)) {
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
