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
/** Das Spiel wartet 6 s; der Rest bleibt für Anmeldung, Cache, Netz und Antwort. */
const GEMINI_TIMEOUT_MS = 4700;
/** Ist das Hauptmodell bis dahin nicht fertig, startet das Ersatzmodell parallel. */
const HEDGE_AFTER_MS = 2000;
/** KI-Anfragen (ohne Cache-Treffer) pro Spieler in 24 Stunden. */
const USER_LIMIT = Number(Deno.env.get('AI_USER_DAILY_LIMIT') ?? 30);
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

function log(userId: string, questionId: string, kind: string, ms?: number, detail?: string) {
  background(admin.from('ai_judge_log').insert({ user_id: userId, question_id: questionId, kind, ms: ms ?? null, detail: detail?.slice(0, 400) ?? null }));
}

async function askGeminiOnce(model: string, thinking: string, question: JudgeQuestion, answer: string, timeoutMs: number) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY fehlt');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(geminiRequestBody(question, answer, thinking)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    // Nur Status und Fehlermeldung von Google loggen – nie Header oder Key.
    const detail = await res.text().catch(() => '');
    throw new Error(`${model} ${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const result = parseModelOutput(extractText(await res.json()), question);
  if (!result) throw new Error(`${model}: unlesbare KI-Antwort`);
  return result;
}

type Verdict = Awaited<ReturnType<typeof askGeminiOnce>>;

/** Ersatzmodell; scheitert es schnell (z. B. 503), ein zweiter Versuch bis zur Deadline. */
async function askFallback(question: JudgeQuestion, answer: string, deadline: number): Promise<Verdict> {
  try {
    return await askGeminiOnce(FALLBACK_MODEL, FALLBACK_THINKING, question, answer, Math.max(500, deadline - Date.now()));
  } catch (e) {
    if (deadline - Date.now() < 1500) throw e;
    return await askGeminiOnce(FALLBACK_MODEL, FALLBACK_THINKING, question, answer, deadline - Date.now());
  }
}

/**
 * Sperre für das Hauptmodell (pro Funktions-Instanz): nach 429 (Kontingent
 * erschöpft) 10 min, nach 503 (Überlastung) 1 min – solange urteilt direkt
 * das Ersatzmodell mit voller Zeit.
 */
let primaryBlockedUntil = 0;
function notePrimaryFailure(e: unknown) {
  const msg = String(e);
  const pause = / 429:/.test(msg) ? 10 * 60_000 : / 503:/.test(msg) ? 60_000 : 0;
  if (pause) primaryBlockedUntil = Math.max(primaryBlockedUntil, Date.now() + pause);
}

/**
 * Hauptmodell zuerst. Ist es nach 2 s nicht fertig oder scheitert vorher
 * (z. B. 503 Überlastung), läuft das Ersatzmodell parallel mit. Das Urteil des
 * Hauptmodells gewinnt, wenn es rechtzeitig kommt; sonst zählt das Ersatzmodell.
 * Liefert auch, welches Modell geurteilt hat.
 */
async function askGemini(question: JudgeQuestion, answer: string): Promise<Verdict & { model: string; fallbackReason?: string }> {
  const t0 = Date.now();
  if (FALLBACK_MODEL && Date.now() < primaryBlockedUntil) {
    const r = await askFallback(question, answer, t0 + GEMINI_TIMEOUT_MS);
    return { model: FALLBACK_MODEL, fallbackReason: `${MODEL} pausiert (429/503)`, ...r };
  }
  const primary = askGeminiOnce(MODEL, THINKING, question, answer, GEMINI_TIMEOUT_MS);
  primary.catch(notePrimaryFailure);
  if (!FALLBACK_MODEL) return { model: MODEL, ...(await primary) };

  let primaryError: unknown = null;
  const primarySettled = primary.then(
    () => true,
    (e) => ((primaryError = e), false),
  );
  // Ersatzmodell starten: nach HEDGE_AFTER_MS oder sofort bei einem Fehler des Hauptmodells
  await Promise.race([primarySettled, new Promise((r) => setTimeout(r, HEDGE_AFTER_MS))]);
  if (primaryError === null && (await Promise.race([primarySettled, Promise.resolve(null)])) === true) {
    return { model: MODEL, ...(await primary) };
  }
  const fallback = askFallback(question, answer, t0 + GEMINI_TIMEOUT_MS);

  try {
    return { model: MODEL, ...(await primary) };
  } catch (e) {
    try {
      return { model: FALLBACK_MODEL, fallbackReason: String(e), ...(await fallback) };
    } catch (e2) {
      throw new Error(`${String(e).slice(0, 190)} | ${String(e2).slice(0, 190)}`);
    }
  } finally {
    fallback.catch(() => {}); // unbenutztes Ersatz-Ergebnis still verwerfen
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Spieler (auch anonym angemeldet) prüfen
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth, error: authError } = jwt
    ? await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.getUser(jwt)
    : { data: { user: null }, error: true };
  const user = auth?.user;
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  let body: { question_id?: unknown; answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const questionId = typeof body.question_id === 'string' ? body.question_id : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, MAX_ANSWER_LENGTH) : '';
  const question = QUESTIONS[questionId];
  if (!question) return json({ error: 'unknown question' }, 400);

  const key = cacheKey(answer);
  if (!key) return json(verdict({ status: 'invalid' }));

  // Steht doch in der Liste (z. B. ältere App-Version) → ohne KI
  const listed = findListAnswer(question, answer);
  if (listed) {
    log(user.id, questionId, 'list');
    return json(verdict({ status: 'valid', list_answer: listed, canonical_text: listed }));
  }

  // Von mir freigegeben (auch Schreibweisen/Aliase) → wie eine Listen-Antwort
  const { data: approvedRows } = await admin
    .from('approved_answers')
    .select('text, aliases, base_score, merged_into')
    .eq('question_id', questionId);
  const approved = findApproved(approvedRows ?? [], answer);
  if (approved) {
    log(user.id, questionId, 'list');
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

  // Cache (abgelehnte Urteile stehen hier mit valid = false)
  const { data: hit } = await admin
    .from('ai_verdicts')
    .select('valid, list_answer, canonical_text, estimated_base_score, reason')
    .eq('question_id', questionId)
    .eq('normalized_answer', key)
    .maybeSingle();
  if (hit) {
    log(user.id, questionId, 'cache');
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
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [mine, all] = await Promise.all([
    admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('kind', 'model').gte('created_at', since),
    admin.from('ai_judge_log').select('id', { count: 'exact', head: true }).eq('kind', 'model').gte('created_at', since),
  ]);
  if ((mine.count ?? 0) >= USER_LIMIT || (all.count ?? 0) >= GLOBAL_LIMIT) {
    log(user.id, questionId, 'limited');
    return json(verdict({ status: 'limited' }));
  }

  const t0 = Date.now();
  try {
    const { model, fallbackReason, ...result } = await askGemini(question, answer);
    log(user.id, questionId, 'model', Date.now() - t0, fallbackReason ? `Ersatzmodell ${model} – ${fallbackReason}` : undefined);
    background(
      admin.from('ai_verdicts').upsert(
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
        },
        { onConflict: 'question_id,normalized_answer', ignoreDuplicates: true },
      ),
    );
    return json(verdict(result));
  } catch (e) {
    console.error('judge failed', questionId, Date.now() - t0, 'ms', String(e));
    log(user.id, questionId, 'error', Date.now() - t0, String(e));
    return json(verdict({ status: 'error' }));
  }
});
