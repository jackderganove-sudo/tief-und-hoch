/**
 * Edge Function "judge-answer": prüft eine Antwort, die nicht in der
 * kuratierten Liste steht, mit Gemini.
 *
 * Ablauf: Spieler-JWT prüfen → Frage aus dem Bundle → Listen-Treffer? → Cache
 * (ai_verdicts) → Rate-Limit → Gemini (max. ~3,3 s) → Urteil cachen.
 *
 * Der Gemini-Key liegt nur als Secret GEMINI_API_KEY in Supabase und wird nie
 * ausgegeben oder geloggt.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import questions from '../_shared/questions.json' with { type: 'json' };
import {
  MAX_ANSWER_LENGTH,
  cacheKey,
  extractText,
  findApproved,
  findListAnswer,
  geminiRequestBody,
  parseModelOutput,
  type JudgeQuestion,
  type JudgeResponse,
} from '../_shared/judge.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// Genauigkeit vor Tempo – das Urteil wird ohnehin gecacht.
const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
const THINKING = Deno.env.get('GEMINI_THINKING') ?? 'low';
/** Springt ein, wenn das Hauptmodell überlastet (503) oder zu langsam ist. Leer = kein Ersatz. */
const FALLBACK_MODEL = Deno.env.get('GEMINI_FALLBACK_MODEL') ?? 'gemini-3.5-flash-lite';
const FALLBACK_THINKING = Deno.env.get('GEMINI_FALLBACK_THINKING') ?? 'minimal';
/** Das Spiel wartet 6 s; so lange wartet die Funktion auf die KI, bevor sie dem Spieler antwortet. */
const GEMINI_TIMEOUT_MS = 4700;
/** Spätestens so lange nach Eingang der Anfrage antwortet die Funktion dem Spieler (Netz-Puffer bis 6 s). */
const RESPOND_WITHIN_MS = 5300;
/** Danach prüft sie im Hintergrund weiter und speichert das Urteil, sobald es da ist. */
const BACKGROUND_TIMEOUT_MS = 25_000;
/** Ist das Hauptmodell bis dahin nicht fertig, startet das Ersatzmodell parallel. */
const HEDGE_AFTER_MS = 2000;
/** Antwortet das Ersatzmodell bis dahin nicht, läuft eine zweite Anfrage parallel (die erste Antwort gewinnt). */
const FALLBACK_HEDGE_MS = 1800;
/** Breaker: so lange wird das Hauptmodell nach 429 (Kontingent) bzw. 503 (Überlastung) übersprungen. */
const BLOCK_429_MS = 15 * 60_000;
const BLOCK_503_MS = 2 * 60_000;
/** Geheimnis für den nächtlichen Nachprüf-Job (Supabase Cron). Leer = Job deaktiviert. */
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
/** KI-Anfragen (ohne Cache-Treffer) pro Spieler in 24 Stunden. */
const USER_LIMIT = Number(Deno.env.get('AI_USER_DAILY_LIMIT') ?? 100);
/** Schutz des Gratis-Kontingents: KI-Anfragen aller Spieler in 24 Stunden. */
const GLOBAL_LIMIT = Number(Deno.env.get('AI_GLOBAL_DAILY_LIMIT') ?? 1000);

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

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const QUESTIONS = questions as Record<string, JudgeQuestion>;

/**
 * Browser dürfen nur von der Spiel-Adresse (und lokal beim Entwickeln) zugreifen.
 * Weitere Adressen per Secret ALLOWED_ORIGINS (kommagetrennt).
 */
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const verdict = (v: Partial<JudgeResponse> & { status: JudgeResponse['status'] }): JudgeResponse => ({
  list_answer: null,
  canonical_text: null,
  estimated_base_score: null,
  reason: null,
  cached: false,
  ...v,
});

function background(p: PromiseLike<unknown>) {
  const task = Promise.resolve(p).catch((e) => console.error('background task failed', String(e)));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
}

interface LogEntry {
  kind: string;
  ms?: number;
  detail?: string;
  model?: string | null;
  primaryStatus?: number | null;
}

function log(userId: string | null, questionId: string, e: LogEntry) {
  background(
    admin.from('ai_judge_log').insert({
      user_id: userId,
      question_id: questionId,
      kind: e.kind,
      ms: e.ms ?? null,
      detail: e.detail?.slice(0, 400) ?? null,
      model: e.model ?? null,
      primary_status: e.primaryStatus ?? null,
    }),
  );
}

class GeminiError extends Error {
  constructor(
    readonly model: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function askGeminiOnce(model: string, thinking: string, question: JudgeQuestion, answer: string, timeoutMs: number) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new GeminiError(model, 0, 'GEMINI_API_KEY fehlt');
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiRequestBody(question, answer, thinking)),
      signal: AbortSignal.timeout(Math.max(300, timeoutMs)),
    });
  } catch (e) {
    throw new GeminiError(model, 0, `${model}: ${String(e).slice(0, 120)}`);
  }
  if (!res.ok) {
    // Nur Status und Fehlermeldung von Google loggen – nie Header oder Key.
    const detail = await res.text().catch(() => '');
    throw new GeminiError(model, res.status, `${model} ${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  const result = parseModelOutput(extractText(await res.json()), question);
  if (!result) throw new GeminiError(model, 200, `${model}: unlesbare KI-Antwort`);
  return result;
}

type Verdict = Awaited<ReturnType<typeof askGeminiOnce>>;
type Judged = Verdict & { model: string; primaryStatus: number | null; note?: string };

/** Erste erfolgreiche Antwort mehrerer Versuche; scheitern alle, gewinnt der letzte Fehler. */
function firstSuccess<T>(attempts: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let failed = 0;
    let lastErr: unknown;
    for (const a of attempts)
      a.then(resolve, (e) => {
        lastErr = e;
        if (++failed === attempts.length) reject(lastErr);
      });
  });
}

/**
 * Ersatzmodell (Flash-Lite, größtes Gratis-Kontingent), abgesichert gegen langsame
 * Ausreißer: Antwortet die erste Anfrage nicht in FALLBACK_HEDGE_MS oder scheitert sie
 * schnell, läuft eine zweite parallel. Die erste gültige Antwort gewinnt.
 */
async function askFallback(question: JudgeQuestion, answer: string, deadline: number): Promise<Verdict> {
  const left = () => deadline - Date.now();
  const first = askGeminiOnce(FALLBACK_MODEL, FALLBACK_THINKING, question, answer, left());
  first.catch(() => {});
  const early = await Promise.race([
    first.then(() => 'ok' as const, () => 'failed' as const),
    new Promise<'slow'>((r) => setTimeout(() => r('slow'), FALLBACK_HEDGE_MS)),
  ]);
  if (early === 'ok') return first;
  if (left() < 700) return first;
  const second = askGeminiOnce(FALLBACK_MODEL, FALLBACK_THINKING, question, answer, left());
  second.catch(() => {});
  return early === 'failed' ? second : firstSuccess([first, second]);
}

/**
 * Breaker für das Hauptmodell, gilt für ALLE Funktions-Instanzen (Zustand im Log):
 * nach 429 für BLOCK_429_MS, nach 503 für BLOCK_503_MS überspringen. Danach ist die
 * nächste Anfrage der Halb-offen-Test – scheitert sie wieder, beginnt das Fenster neu.
 * Kurz im Speicher gepuffert, damit nicht jede Anfrage die Datenbank fragt.
 */
let breakerCache = { until: 0, checkedAt: 0 };
async function primaryBlocked(): Promise<boolean> {
  const now = Date.now();
  if (now - breakerCache.checkedAt < 20_000) return now < breakerCache.until;
  const { data } = await admin
    .from('ai_judge_log')
    .select('created_at, primary_status')
    .in('primary_status', [429, 503])
    .gte('created_at', new Date(now - BLOCK_429_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  const last = data?.[0];
  const until = last ? Date.parse(last.created_at) + (last.primary_status === 429 ? BLOCK_429_MS : BLOCK_503_MS) : 0;
  breakerCache = { until, checkedAt: now };
  return now < until;
}

function notePrimaryFailure(status: number) {
  if (status === 429 || status === 503) {
    breakerCache = { until: Date.now() + (status === 429 ? BLOCK_429_MS : BLOCK_503_MS), checkedAt: Date.now() };
  }
}

/**
 * Hauptmodell zuerst (genauer). Bei 429/503 sofort, sonst nach HEDGE_AFTER_MS läuft das
 * Ersatzmodell parallel; das Hauptmodell gewinnt, wenn es bis zur Deadline antwortet.
 * Ist der Breaker offen, urteilt direkt das Ersatzmodell mit voller Zeit.
 */
async function askGemini(question: JudgeQuestion, answer: string, budgetMs: number): Promise<Judged> {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  if (FALLBACK_MODEL && (await primaryBlocked())) {
    const r = await askFallback(question, answer, deadline);
    return { ...r, model: FALLBACK_MODEL, primaryStatus: null, note: `${MODEL} pausiert (Breaker)` };
  }
  const primary = askGeminiOnce(MODEL, THINKING, question, answer, deadline - Date.now());
  primary.catch(() => {});
  if (!FALLBACK_MODEL) return { ...(await primary), model: MODEL, primaryStatus: 200 };

  let primaryErr: GeminiError | null = null;
  const settled = primary.then(
    () => true,
    (e) => ((primaryErr = e as GeminiError), false),
  );
  await Promise.race([settled, new Promise((r) => setTimeout(r, HEDGE_AFTER_MS))]);
  if (!primaryErr && (await Promise.race([settled, Promise.resolve(null)])) === true) {
    return { ...(await primary), model: MODEL, primaryStatus: 200 };
  }
  const fallback = askFallback(question, answer, deadline);
  fallback.catch(() => {});
  try {
    return { ...(await primary), model: MODEL, primaryStatus: 200 };
  } catch (e) {
    const err = e as GeminiError;
    notePrimaryFailure(err.status);
    try {
      return { ...(await fallback), model: FALLBACK_MODEL, primaryStatus: err.status || null, note: err.message };
    } catch (e2) {
      const err2 = new GeminiError(FALLBACK_MODEL, (e2 as GeminiError).status ?? 0, `${err.message.slice(0, 180)} | ${String((e2 as Error).message).slice(0, 180)}`);
      (err2 as GeminiError & { primaryStatus?: number }).primaryStatus = err.status;
      throw err2;
    }
  }
}

/** Antwort, die (noch) nicht geprüft werden konnte, festhalten – taucht im Admin unter „Nicht geprüft“ auf. */
function storeUnchecked(questionId: string, key: string, reason: 'error' | 'limited') {
  background(
    admin.from('ai_verdicts').upsert(
      { question_id: questionId, normalized_answer: key, valid: false, ai_valid: false, model: 'none', review_status: 'unchecked', unchecked_reason: reason },
      { onConflict: 'question_id,normalized_answer', ignoreDuplicates: true },
    ),
  );
}

/** KI fragen und das Urteil speichern (überschreibt einen „unchecked“-Eintrag). */
async function judgeAndStore(
  userId: string | null,
  questionId: string,
  question: JudgeQuestion,
  answer: string,
  key: string,
  waitMs = GEMINI_TIMEOUT_MS,
): Promise<JudgeResponse> {
  const t0 = Date.now();
  // Die eigentliche Prüfung darf länger dauern als der Spieler wartet (Hintergrund).
  const work = (async (): Promise<JudgeResponse> => {
    try {
      const { model, primaryStatus, note, ...result } = await askGemini(question, answer, BACKGROUND_TIMEOUT_MS);
      const ms = Date.now() - t0;
      log(userId, questionId, { kind: 'model', ms, model, primaryStatus, detail: [note && `Ersatzmodell ${model} – ${note}`, ms > waitMs && 'im Hintergrund fertig'].filter(Boolean).join(' · ') || undefined });
      const { error } = await admin.from('ai_verdicts').upsert(
        {
          question_id: questionId,
          normalized_answer: key,
          valid: result.status === 'valid',
          ai_valid: result.status === 'valid',
          canonical_text: result.canonical_text,
          list_answer: result.list_answer,
          estimated_base_score: result.estimated_base_score,
          reason: result.reason,
          model,
          review_status: 'pending',
          unchecked_reason: null,
        },
        { onConflict: 'question_id,normalized_answer' },
      );
      if (error) console.error('verdict not stored', error.message);
      return verdict(result);
    } catch (e) {
      const err = e as GeminiError & { primaryStatus?: number };
      console.error('judge failed', questionId, Date.now() - t0, 'ms', err.message);
      log(userId, questionId, { kind: 'error', ms: Date.now() - t0, detail: err.message, model: err.model, primaryStatus: err.primaryStatus ?? null });
      storeUnchecked(questionId, key, 'error');
      return verdict({ status: 'error' });
    }
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), waitMs));
  const first = await Promise.race([work, timeout]);
  if (first) return first;
  // Zu langsam für den Spieler: „nicht geprüft“ melden, festhalten, im Hintergrund weiterprüfen
  storeUnchecked(questionId, key, 'error');
  background(work);
  return verdict({ status: 'error' });
}

/** Nächtlicher Job: offene „unchecked“-Antworten erneut prüfen, solange Kontingent da ist. */
async function recheckBatch(limit: number): Promise<Response> {
  const { data: rows, error } = await admin
    .from('ai_verdicts')
    .select('question_id, normalized_answer')
    .eq('review_status', 'unchecked')
    .order('created_at')
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  const results: Record<string, number> = {};
  for (const r of rows ?? []) {
    const q = QUESTIONS[r.question_id];
    if (!q) continue;
    // Originalschreibweise (mit Umlauten) aus den gespeicherten Antworten, sonst die normalisierte
    const { data: sub } = await admin
      .from('submissions')
      .select('raw_answer')
      .eq('question_id', r.question_id)
      .eq('normalized_answer', r.normalized_answer)
      .order('created_at', { ascending: false })
      .limit(1);
    const res = await judgeAndStore(null, r.question_id, q, sub?.[0]?.raw_answer ?? r.normalized_answer, r.normalized_answer, BACKGROUND_TIMEOUT_MS);
    results[res.status] = (results[res.status] ?? 0) + 1;
    if (res.status === 'error') break; // Kontingent/Störung: beim nächsten Lauf weiter
  }
  return json({ checked: rows?.length ?? 0, results });
}

async function handle(req: Request): Promise<Response> {
  const reqStart = Date.now();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { question_id?: unknown; answer?: unknown; recheck?: unknown; mode?: unknown; limit?: unknown; room_code?: unknown; room_idx?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Cron: Nachprüfen aller offenen Antworten (eigenes Geheimnis, kein Spieler)
  if (body.mode === 'recheck-batch') {
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'unauthorized' }, 401);
    return recheckBatch(Math.min(50, Number(body.limit) || 20));
  }

  // Spieler (auch anonym angemeldet) prüfen
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth, error: authError } = jwt
    ? await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.getUser(jwt)
    : { data: { user: null }, error: true };
  const user = auth?.user;
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  // Freunde-Modus: eigene Frage des Gastgebers (ohne Antwortliste). Nur für Mitspieler
  // dieses Raums und nur für die gerade laufende eigene Frage; kein Cache (Frage ist einmalig).
  if (typeof body.room_code === 'string') return judgeRoomCustom(user.id, body.room_code, Number(body.room_idx), body.answer);

  const questionId = typeof body.question_id === 'string' ? body.question_id : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, MAX_ANSWER_LENGTH) : '';
  const question = QUESTIONS[questionId];
  if (!question) return json({ error: 'unknown question' }, 400);

  const key = cacheKey(answer);
  if (!key) return json(verdict({ status: 'invalid' }));

  // Admins (Tabelle admins) haben kein KI-Limit – im Spiel wie im Admin-Bereich.
  // Gesperrte Spieler (player_bans, Admin-Dashboard) bekommen keine KI-Prüfung.
  const [adminRow, banRow] = await Promise.all([
    admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    admin.from('player_bans').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  if (banRow.data) return json(verdict({ status: 'limited' }));
  const isAdminUser = !!adminRow.data;
  // Nachprüfung aus dem Admin-Bereich: ohne Cache, längere Wartezeit
  const isAdmin = body.recheck === true;
  if (isAdmin && !isAdminUser) return json({ error: 'forbidden' }, 403);

  // Steht doch in der Liste (z. B. ältere App-Version) → ohne KI
  const listed = findListAnswer(question, answer);
  if (listed) {
    log(user.id, questionId, { kind: 'list' });
    return json(verdict({ status: 'valid', list_answer: listed, canonical_text: listed }));
  }

  // Freigaben, Cache und Limits gleichzeitig abfragen (spart Zeit vor der KI)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [approvedRes, hitRes, mine, all] = await Promise.all([
    admin.from('approved_answers').select('text, aliases, base_score, merged_into').eq('question_id', questionId),
    isAdmin
      ? Promise.resolve({ data: null })
      : admin
          .from('ai_verdicts')
          .select('valid, list_answer, canonical_text, estimated_base_score, reason')
          .eq('question_id', questionId)
          .eq('normalized_answer', key)
          .neq('review_status', 'unchecked')
          .maybeSingle(),
    // Nur echte KI-Anfragen zählen (kind 'model'); Cache-Treffer und Freigaben nie
    isAdminUser ? Promise.resolve({ count: 0 }) : admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'model').gte('created_at', since),
    isAdminUser ? Promise.resolve({ count: 0 }) : admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('kind', 'model').gte('created_at', since),
  ]);

  // Von mir freigegeben (auch Schreibweisen/Aliase) → wie eine Listen-Antwort
  const approved = findApproved(approvedRes.data ?? [], answer);
  if (approved) {
    log(user.id, questionId, { kind: 'list' });
    const merged = findListAnswer(question, approved.merged_into);
    return json(
      verdict({
        status: 'valid',
        approved: true,
        list_answer: merged,
        canonical_text: merged ?? approved.text,
        estimated_base_score: approved.base_score,
      }),
    );
  }

  // Cache (abgelehnte Urteile stehen hier mit valid = false; „unchecked“ ist KEIN Treffer)
  const hit = hitRes.data;
  if (hit) {
    log(user.id, questionId, { kind: 'cache' });
    return json(
      verdict({
        status: hit.valid ? 'valid' : 'invalid',
        list_answer: hit.list_answer,
        canonical_text: hit.canonical_text,
        estimated_base_score: hit.estimated_base_score,
        reason: hit.reason,
        cached: true,
      }),
    );
  }

  // Rate-Limit: pro Spieler und insgesamt, jeweils über die letzten 24 Stunden
  if (!isAdminUser && ((mine.count ?? 0) >= USER_LIMIT || (all.count ?? 0) >= GLOBAL_LIMIT)) {
    log(user.id, questionId, { kind: 'limited' });
    storeUnchecked(questionId, key, 'limited');
    return json(verdict({ status: 'limited' }));
  }

  // Admin-Nachprüfung: länger warten (kein Spieler-Timer)
  // Spieler: Antwort spätestens RESPOND_WITHIN_MS nach Eingang (danach prüft der Hintergrund weiter)
  const waitMs = isAdmin ? 20_000 : Math.max(1500, RESPOND_WITHIN_MS - (Date.now() - reqStart));
  return json(await judgeAndStore(user.id, questionId, question, answer, key, waitMs));
}

async function judgeRoomCustom(userId: string, code: string, idx: number, rawAnswer: unknown): Promise<Response> {
  const answer = typeof rawAnswer === 'string' ? rawAnswer.trim().slice(0, MAX_ANSWER_LENGTH) : '';
  if (!cacheKey(answer)) return json(verdict({ status: 'invalid' }));
  const { data: room } = await admin.from('rooms').select('id, status, current_index').eq('code', code.toUpperCase()).maybeSingle();
  if (!room || room.current_index !== idx || !['question', 'scoring'].includes(room.status)) return json({ error: 'forbidden' }, 403);
  const [{ data: member }, { data: rq }, { data: banned }] = await Promise.all([
    admin.from('room_players').select('user_id').eq('room_id', room.id).eq('user_id', userId).eq('kicked', false).maybeSingle(),
    admin.from('room_questions').select('custom_prompt, lang').eq('room_id', room.id).eq('idx', idx).maybeSingle(),
    admin.from('player_bans').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (!member || !rq?.custom_prompt || banned) return json({ error: 'forbidden' }, 403);
  const logId = `custom:${code}`;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [mine, all] = await Promise.all([
    admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'model').gte('created_at', since),
    admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('kind', 'model').gte('created_at', since),
  ]);
  if ((mine.count ?? 0) >= USER_LIMIT || (all.count ?? 0) >= GLOBAL_LIMIT) {
    log(userId, logId, { kind: 'limited' });
    return json(verdict({ status: 'limited' }));
  }
  const question: JudgeQuestion = { lang: rq.lang === 'en' ? 'en' : 'de', prompt: rq.custom_prompt, answers: [] };
  const t0 = Date.now();
  try {
    const { model, primaryStatus, ...result } = await askGemini(question, answer, 8000);
    log(userId, logId, { kind: 'model', ms: Date.now() - t0, model, primaryStatus });
    return json(verdict(result));
  } catch (e) {
    const err = e as GeminiError & { primaryStatus?: number };
    log(userId, logId, { kind: 'error', ms: Date.now() - t0, detail: err.message, model: err.model, primaryStatus: err.primaryStatus ?? null });
    return json(verdict({ status: 'error' }));
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const res = await handle(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
