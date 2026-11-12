/**
 * RLS-Tests gegen das verknüpfte Supabase-Projekt (supabase/tests/rls.sql).
 * Läuft in einer Transaktion mit ROLLBACK – es bleibt nichts in der Datenbank.
 *
 *   npm run test:rls
 *
 * Zugang: SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens) oder die
 * Anmeldung der Supabase-CLI aus dem Schlüsselbund (npx supabase login).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  try {
    token = execFileSync('secret-tool', ['lookup', 'service', 'Supabase CLI'], { encoding: 'utf8' }).trim();
  } catch {
    /* kein Schlüsselbund */
  }
}
if (!token) {
  console.error('Kein Zugang: SUPABASE_ACCESS_TOKEN setzen oder "npx supabase login".');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: readFileSync('supabase/tests/rls.sql', 'utf8') }),
});
const body = await res.text();
if (!res.ok || !body.includes('RLS-Tests bestanden')) {
  console.error('RLS-Tests FEHLGESCHLAGEN:', body.slice(0, 600));
  process.exit(1);
}
console.log('RLS-Tests bestanden (anon, Spieler, fremder Spieler, Admin).');

// Freunde-Modus: Antworten/Antwortlisten vor der Auflösung unerreichbar
const roomsRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: readFileSync('supabase/tests/rooms.sql', 'utf8') }),
});
const roomsBody = await roomsRes.text();
if (!roomsRes.ok || !roomsBody.includes('Raum-Tests bestanden')) {
  console.error('Raum-Tests FEHLGESCHLAGEN:', roomsBody.slice(0, 600));
  process.exit(1);
}
console.log('Raum-Tests bestanden (keine Antworten vor der Auflösung, kein Direktzugriff, Aufräumen).');

// Zusätzlich über die öffentliche API mit dem anon key: nichts Admin-Relevantes lesbar
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const api = (path, init = {}) =>
  fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...init.headers } });
const checks = [
  ['ai_verdicts lesen', await api('ai_verdicts?select=id&limit=1')],
  ['admin_verdicts lesen', await api('admin_verdicts?select=id&limit=1')],
  ['admins lesen', await api('admins?select=user_id&limit=1')],
  ['submissions lesen', await api('submissions?select=id&limit=1')],
  ['approved_answers schreiben', await api('approved_answers', { method: 'POST', body: JSON.stringify({ question_id: 'de-food-001', text: 'x', base_score: 1 }) })],
  ['approve_verdict aufrufen', await api('rpc/approve_verdict', { method: 'POST', body: JSON.stringify({ p_verdict: '00000000-0000-4000-8000-0000000000e1', p_text: 'x' }) })],
  ['admin_overview aufrufen', await api('rpc/admin_overview', { method: 'POST', body: '{}' })],
  ['admin_players aufrufen', await api('rpc/admin_players', { method: 'POST', body: '{}' })],
  ['admin_set_ban aufrufen', await api('rpc/admin_set_ban', { method: 'POST', body: JSON.stringify({ p_user: '00000000-0000-4000-8000-00000000c001', p_banned: true }) })],
  ['admin_log lesen', await api('admin_log?select=id&limit=1')],
  ['player_bans lesen', await api('player_bans?select=user_id&limit=1')],
  ['questions lesen (Antwortlisten)', await api('questions?select=answers&limit=1')],
  ['room_answers lesen', await api('room_answers?select=raw&limit=1')],
  ['room_state ohne Anmeldung', await api('rpc/room_state', { method: 'POST', body: JSON.stringify({ p_code: 'ABCDEF' }) })],
];
let bad = 0;
for (const [name, r] of checks) {
  const text = await r.text();
  const blocked = r.status >= 400 || text === '[]';
  if (!blocked) bad++;
  console.log(`${blocked ? 'gesperrt' : 'OFFEN!  '}  ${name} (HTTP ${r.status})`);
}
const pub = await api('approved_answers?select=id&limit=1');
console.log(`${pub.ok ? 'lesbar  ' : 'FEHLER  '}  approved_answers lesen (öffentlich, HTTP ${pub.status})`);
process.exit(bad || !pub.ok ? 1 : 0);
