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
  findListAnswer,
  geminiRequestBody,
  parseModelOutput,
  type JudgeQuestion,
  type JudgeResponse,
} from '../_shared/judge.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
const THINKING = Deno.env.get('GEMINI_THINKING') ?? 'low';
const GEMINI_TIMEOUT_MS = 3300;
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

function log(userId: string, questionId: string, kind: string, ms?: number) {
  background(admin.from('ai_judge_log').insert({ user_id: userId, question_id: questionId, kind, ms: ms ?? null }));
}

async function askGemini(question: JudgeQuestion, answer: string) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY fehlt');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(geminiRequestBody(question, answer, THINKING)),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Nur Status und Fehlermeldung von Google loggen – nie Header oder Key.
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  return parseModelOutput(extractText(await res.json()), question);
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

  // Cache
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
    const result = await askGemini(question, answer);
    if (!result) throw new Error('unlesbare KI-Antwort');
    log(user.id, questionId, 'model', Date.now() - t0);
    background(
      admin.from('ai_verdicts').upsert(
        {
          question_id: questionId,
          normalized_answer: key,
          valid: result.status === 'valid',
          canonical_text: result.canonical_text,
          list_answer: result.list_answer,
          estimated_base_score: result.estimated_base_score,
          reason: result.reason,
          model: MODEL,
        },
        { onConflict: 'question_id,normalized_answer', ignoreDuplicates: true },
      ),
    );
    return json(verdict(result));
  } catch (e) {
    console.error('judge failed', questionId, Date.now() - t0, 'ms', String(e));
    log(user.id, questionId, 'error', Date.now() - t0);
    return json(verdict({ status: 'error' }));
  }
});
