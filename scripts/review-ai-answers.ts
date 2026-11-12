/**
 * KI-akzeptierte Antworten sichten – gruppiert nach Frage, mit Häufigkeit.
 * Gute Antworten lassen sich danach dauerhaft in die Fragen-Pakete übernehmen.
 *
 *   npm run review-ai-answers                     Übersicht im Terminal
 *   npm run review-ai-answers -- --min=2          nur Antworten, die mind. 2× gegeben wurden
 *   npm run review-ai-answers -- --export=packs/ai-review.json
 *
 * Der Export enthält jede betroffene Frage vollständig (alte Antworten + neue
 * KI-Antworten, Varianten als Aliase). Datei prüfen, Unpassendes löschen, dann:
 *   npm run import-questions -- packs/ai-review.json --replace
 *   npm run function-data   (und judge-answer neu deployen)
 *
 * Zugang: braucht SUPABASE_URL (oder VITE_SUPABASE_URL) und SUPABASE_SERVICE_ROLE_KEY
 * bzw. einen Secret Key (sb_secret_…) in .env.local oder der Umgebung. Dieser
 * Schlüssel umgeht RLS – nur lokal verwenden, nie committen oder ins Frontend.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { compact } from '../src/domain/normalize.ts';
import type { Answer, Question } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env.local'))) process.loadEnvFile(join(ROOT, '.env.local'));

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY (oder SUPABASE_SECRET_KEY) fehlen – siehe Kopf dieser Datei.');
  process.exit(1);
}

const args = process.argv.slice(2);
const min = Number(args.find((a) => a.startsWith('--min='))?.slice(6) ?? 1);
const exportPath = args.find((a) => a.startsWith('--export='))?.slice(9);

// Fragen laden
const questions = new Map<string, Question>();
const DATA = join(ROOT, 'src/data/questions');
for (const lang of readdirSync(DATA)) {
  for (const file of readdirSync(join(DATA, lang))) {
    for (const q of JSON.parse(readFileSync(join(DATA, lang, file), 'utf8')) as Question[]) questions.set(q.id, q);
  }
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function all<T>(table: string, columns: string, filter: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

interface Verdict {
  question_id: string;
  normalized_answer: string;
  canonical_text: string | null;
  list_answer: string | null;
  estimated_base_score: number | null;
  reason: string | null;
}
interface Submission {
  question_id: string;
  raw_answer: string;
  matched_answer: string | null;
}

const verdicts = await all<Verdict>('ai_verdicts', 'question_id, normalized_answer, canonical_text, list_answer, estimated_base_score, reason', (q) =>
  q.eq('valid', true),
);
const submissions = await all<Submission>('submissions', 'question_id, raw_answer, matched_answer', (q) => q.eq('source', 'ai').not('matched_answer', 'is', null));

// Gruppieren: Frage → kanonische Antwort → Häufigkeit, Schreibweisen, Schätzung
interface Group {
  text: string;
  listAnswer: string | null;
  estimate: number;
  reason: string | null;
  count: number;
  spellings: Set<string>;
}
const byQuestion = new Map<string, Map<string, Group>>();
for (const v of verdicts) {
  const text = v.list_answer ?? v.canonical_text ?? v.normalized_answer;
  const groups = byQuestion.get(v.question_id) ?? new Map<string, Group>();
  byQuestion.set(v.question_id, groups);
  const k = compact(text);
  const g = groups.get(k) ?? { text, listAnswer: v.list_answer, estimate: v.estimated_base_score ?? 0, reason: v.reason, count: 0, spellings: new Set() };
  groups.set(k, g);
}
for (const s of submissions) {
  const groups = byQuestion.get(s.question_id);
  const g = groups?.get(compact(s.matched_answer!));
  if (!g) continue;
  g.count++;
  if (compact(s.raw_answer) !== compact(g.text)) g.spellings.add(s.raw_answer.trim());
}

const exported: Question[] = [];
let shown = 0;
for (const [id, groups] of [...byQuestion].sort(([a], [b]) => a.localeCompare(b))) {
  const q = questions.get(id);
  const list = [...groups.values()].filter((g) => g.count >= min).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  if (!q || list.length === 0) continue;
  console.log(`\n${id}  ${q.prompt}`);
  for (const g of list) {
    const kind = g.listAnswer ? `Variante von „${g.listAnswer}“` : `neu, Schätzung ${g.estimate}`;
    const spell = g.spellings.size ? `  [${[...g.spellings].slice(0, 5).join(', ')}]` : '';
    console.log(`  ${String(g.count).padStart(4)}×  ${g.text}  (${kind})${spell}${g.reason ? `  – ${g.reason}` : ''}`);
    shown++;
  }

  if (exportPath) {
    const answers: Answer[] = q.answers.map((a) => ({ ...a, aliases: [...a.aliases] }));
    for (const g of list) {
      const target = answers.find((a) => compact(a.text) === compact(g.listAnswer ?? g.text));
      const aliases = [...g.spellings].filter((s) => s.length > 0);
      if (target) {
        // Variante: Schreibweisen als Aliase ergänzen
        for (const s of [g.text, ...aliases]) {
          if (compact(s) !== compact(target.text) && !target.aliases.some((x) => compact(x) === compact(s))) target.aliases.push(s);
        }
      } else {
        answers.push({ text: g.text, aliases: aliases.filter((s) => compact(s) !== compact(g.text)), baseScore: Math.max(1, Math.min(100, g.estimate)) });
      }
    }
    exported.push({ ...q, answers });
  }
}

console.log(`\n${shown} KI-akzeptierte Antworten in ${byQuestion.size} Fragen (${submissions.length} Tagesantworten über die KI).`);
if (exportPath) {
  writeFileSync(resolve(ROOT, exportPath), JSON.stringify({ questions: exported }, null, 2) + '\n');
  console.log(`Export: ${exportPath} (${exported.length} Fragen) → prüfen, dann: npm run import-questions -- ${exportPath} --replace`);
}
