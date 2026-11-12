/**
 * Fragen + Antwortlisten in die Datenbank-Tabelle public.questions übernehmen
 * (für den Freunde-Modus: dort werten nur der Server, Clients sehen keine Antworten).
 *
 *   npm run questions-db              alle Fragen aus src/data/questions hochladen (upsert),
 *                                     entfernte Fragen löschen
 *   npm run questions-db -- --check   nur prüfen, ob die Tabelle aktuell ist
 *
 * Freigegebene Antworten (approved_answers) mischt die Edge Function "room" live dazu –
 * sie müssen hier nicht übernommen werden.
 *
 * Zugang: Anmeldung der Supabase-CLI (npx supabase login) oder SUPABASE_ACCESS_TOKEN.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/data/questions');
const check = process.argv.includes('--check');

const ref = readFileSync(join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim();
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

async function sql<T = unknown>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL-Fehler (${res.status}): ${body.slice(0, 400)}`);
  return JSON.parse(body) as T[];
}

const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

const rows: { id: string; lang: string; topic: string; prompt: string; modes: string[]; answers: unknown }[] = [];
for (const lang of readdirSync(DATA).sort()) {
  for (const file of readdirSync(join(DATA, lang)).sort()) {
    for (const q of JSON.parse(readFileSync(join(DATA, lang, file), 'utf8')) as Question[]) {
      rows.push({
        id: q.id,
        lang: q.lang,
        topic: q.topic,
        prompt: q.prompt,
        modes: q.modes,
        answers: q.answers.map((a) => ({ text: a.text, aliases: a.aliases, baseScore: a.baseScore, ...(a.tooClever ? { tooClever: true } : {}) })),
      });
    }
  }
}

const digest = (r: (typeof rows)[number]) => createHash('sha1').update(JSON.stringify([r.lang, r.topic, r.prompt, r.modes, r.answers])).digest('hex');
const local = new Map(rows.map((r) => [r.id, digest(r)]));

const remoteRows = await sql<{ id: string; lang: string; topic: string; prompt: string; modes: string[]; answers: unknown }>(
  'select id, lang, topic, prompt, modes, answers from public.questions',
);
const remote = new Map(remoteRows.map((r) => [r.id, digest(r)]));
const changed = rows.filter((r) => remote.get(r.id) !== local.get(r.id));
const removed = [...remote.keys()].filter((id) => !local.has(id));

if (check) {
  if (changed.length || removed.length) {
    console.error(`questions-Tabelle veraltet: ${changed.length} neu/geändert, ${removed.length} entfernt – "npm run questions-db" ausführen.`);
    process.exit(1);
  }
  console.log(`questions-Tabelle aktuell (${rows.length} Fragen).`);
  process.exit(0);
}

for (let i = 0; i < changed.length; i += 80) {
  const batch = changed.slice(i, i + 80);
  const values = batch
    .map((r) => `(${lit(r.id)}, ${lit(r.lang)}, ${lit(r.topic)}, ${lit(r.prompt)}, array[${r.modes.map(lit).join(',')}]::text[], ${lit(JSON.stringify(r.answers))}::jsonb, now())`)
    .join(',\n');
  await sql(`insert into public.questions (id, lang, topic, prompt, modes, answers, updated_at) values ${values}
    on conflict (id) do update set lang = excluded.lang, topic = excluded.topic, prompt = excluded.prompt,
      modes = excluded.modes, answers = excluded.answers, updated_at = now()`);
}
if (removed.length) await sql(`delete from public.questions where id in (${removed.map(lit).join(',')})`);
console.log(`questions: ${changed.length} hochgeladen, ${removed.length} entfernt, ${rows.length} gesamt.`);
