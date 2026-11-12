/** Hilfen für Raum-Tests mit Bot-Clients (anonyme Supabase-Sitzungen). */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
export const URL = env.VITE_SUPABASE_URL;
export const KEY = env.VITE_SUPABASE_ANON_KEY;
const SESSIONS = process.env.ROOM_BOT_SESSIONS ?? '/tmp/hal-room-bots.json';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function assert(cond, msg) {
  if (!cond) {
    console.error('FEHLER:', msg);
    process.exit(1);
  }
}

/** Anonyme Bots; Sitzungen werden wiederverwendet (Supabase begrenzt anonyme Anmeldungen pro Stunde). */
export async function bots(n, prefix = 'Bot') {
  const saved = existsSync(SESSIONS) ? JSON.parse(readFileSync(SESSIONS, 'utf8')) : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let ok = false;
    if (saved[i]) ok = !(await sb.auth.refreshSession({ refresh_token: saved[i] })).error;
    if (!ok) {
      const { error } = await sb.auth.signInAnonymously();
      assert(!error, `anonyme Anmeldung ${i}: ${error?.message}`);
    }
    const { data } = await sb.auth.getSession();
    saved[i] = data.session.refresh_token;
    writeFileSync(SESSIONS, JSON.stringify(saved));
    out.push({ sb, id: data.session.user.id, token: data.session.access_token, name: `${prefix} ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}` });
  }
  return out;
}

export async function call(bot, action, body = {}) {
  const res = await fetch(`${URL}/functions/v1/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}`, apikey: KEY },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
export const state = async (bot, code) => (await bot.sb.rpc('room_state', { p_code: code })).data;

/** Wartet (mit Ticks), bis der Raum einen Zustand erreicht. */
export async function waitFor(bot, code, pred, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const st = await state(bot, code);
    if (pred(st)) return st;
    assert(Date.now() - t0 < timeoutMs, `Zeitüberschreitung, Zustand: ${st?.status} #${st?.index}`);
    await call(bot, 'tick', { code });
    await sleep(500);
  }
}

// ---- nur für Tests: Antwortliste der laufenden Frage über die Verwaltungs-API (Clients können das nicht)
let token;
export function adminSql(query) {
  token ??= process.env.SUPABASE_ACCESS_TOKEN ?? execFileSync('secret-tool', ['lookup', 'service', 'Supabase CLI'], { encoding: 'utf8' }).trim();
  const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
  return fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then((r) => r.json());
}
export async function listAnswers(code, idx) {
  const rows = await adminSql(
    `select q.answers from public.room_questions rq join public.rooms r on r.id = rq.room_id join public.questions q on q.id = rq.question_id where r.code = '${code}' and rq.idx = ${Number(idx)}`,
  );
  return rows?.[0]?.answers ?? [];
}
