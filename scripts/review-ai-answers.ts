/**
 * KI-geprüfte Antworten sichten und Freigaben dauerhaft ins Repo übernehmen.
 *
 *   npm run review-ai-answers                      Übersicht: KI-akzeptierte Antworten nach Frage, mit Häufigkeit
 *   npm run review-ai-answers -- --min=2           nur Antworten, die mind. 2× gespielt wurden
 *   npm run review-ai-answers -- --export=packs/ai-review.json
 *                                                  Übersicht als Paket (alle KI-akzeptierten, zum Sichten)
 *   npm run review-ai-answers -- --apply-approved  Freigaben aus dem Admin-Bereich in die Fragen-JSONs
 *                                                  übernehmen und in der DB als "exportiert" markieren
 *   … --apply-approved --dry-run                   nur zeigen, was passieren würde
 *
 * Nach --apply-approved: Änderungen prüfen (git diff), committen, pushen und
 * die Funktion neu deployen (npx supabase functions deploy judge-answer).
 *
 * Zugang: über die Anmeldung der Supabase-CLI (npx supabase login) oder
 * SUPABASE_ACCESS_TOKEN – kein geheimer Projekt-Schlüssel nötig.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeApproved, type ApprovedAnswer } from '../src/domain/approved.ts';
import { compact } from '../src/domain/normalize.ts';
import type { Answer, Question } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const min = Number(args.find((a) => a.startsWith('--min='))?.slice(6) ?? 0);
const exportPath = args.find((a) => a.startsWith('--export='))?.slice(9);
const applyApproved = args.includes('--apply-approved');
const dryRun = args.includes('--dry-run');

// ---------------------------------------------------------------- Datenbank über die Management-API

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
  console.error('Kein Zugang: "npx supabase login" ausführen oder SUPABASE_ACCESS_TOKEN setzen.');
  process.exit(1);
}

async function sql<T>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`);
  return JSON.parse(body) as T[];
}

// ---------------------------------------------------------------- Fragen

const DATA = join(ROOT, 'src/data/questions');
const questions = new Map<string, Question>();
for (const lang of readdirSync(DATA)) {
  for (const file of readdirSync(join(DATA, lang))) {
    for (const q of JSON.parse(readFileSync(join(DATA, lang, file), 'utf8')) as Question[]) questions.set(q.id, q);
  }
}

/** Frage ohne App-interne Felder (für Pakete). */
function clean(q: Question): Question {
  const { approvedKeys: _k, ...rest } = q;
  return { ...rest, answers: q.answers.map(({ approved: _a, ...a }): Answer => a) };
}

// ---------------------------------------------------------------- --apply-approved

if (applyApproved) {
  const rows = await sql<ApprovedAnswer & { id: string }>(
    'select id, question_id, text, aliases, base_score, merged_into from public.approved_answers where exported_at is null order by question_id, created_at',
  );
  if (rows.length === 0) {
    console.log('Keine neuen Freigaben.');
    process.exit(0);
  }
  const unknown = rows.filter((r) => !questions.has(r.question_id));
  for (const r of unknown) console.warn(`übersprungen: ${r.question_id} gibt es im Repo nicht („${r.text}“)`);
  const usable = rows.filter((r) => questions.has(r.question_id));

  const affected = [...new Set(usable.map((r) => r.question_id))].map((id) => clean(mergeApproved(questions.get(id)!, usable)));
  for (const r of usable) {
    console.log(`  ${r.question_id}  ${r.merged_into ? `„${r.text}“ → Alias von „${r.merged_into}“` : `„${r.text}“ (baseScore ${r.base_score})`}${r.aliases.length ? `  [${r.aliases.join(', ')}]` : ''}`);
  }
  if (dryRun) {
    console.log(`\n[dry-run] ${usable.length} Freigaben in ${affected.length} Fragen – nichts geschrieben.`);
    process.exit(0);
  }

  const pack = join(ROOT, `packs/approved-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(pack, JSON.stringify({ questions: affected }, null, 2) + '\n');
  // Über das Import-Skript schreiben: gleiche Prüfung (zod) und gleiches Dateiformat wie sonst
  execFileSync('npx', ['tsx', 'scripts/import-questions.ts', pack, '--replace'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('npx', ['tsx', 'scripts/function-data.ts'], { cwd: ROOT, stdio: 'inherit' });

  const ids = usable.map((r) => `'${r.id.replace(/[^0-9a-f-]/g, '')}'`).join(',');
  await sql(`update public.approved_answers set exported_at = now() where id in (${ids})`);
  console.log(`\n${usable.length} Freigaben übernommen und als exportiert markiert. Paket: ${pack.replace(ROOT + '/', '')}`);
  console.log('Jetzt: git diff prüfen, committen, pushen, dann: npx supabase functions deploy judge-answer');
  process.exit(0);
}

// ---------------------------------------------------------------- Übersicht / --export

interface Row {
  question_id: string;
  text: string;
  list_answer: string | null;
  estimate: number | null;
  reason: string | null;
  review_status: string;
  plays: number;
  spellings: string[] | null;
}

const rows = await sql<Row>(`
  select v.question_id,
         coalesce(v.list_answer, v.canonical_text, v.normalized_answer) as text,
         v.list_answer, v.estimated_base_score as estimate, v.reason, v.review_status,
         count(s.id)::int as plays,
         array_remove(array_agg(distinct s.raw_answer), null) as spellings
  from public.ai_verdicts v
  left join public.submissions s on s.question_id = v.question_id and s.normalized_answer = v.normalized_answer
  where v.valid
  group by v.id
  order by v.question_id, plays desc`);

const exported: Question[] = [];
let shown = 0;
const byQuestion = new Map<string, Row[]>();
for (const r of rows) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);

for (const [id, list] of byQuestion) {
  const q = questions.get(id);
  const visible = list.filter((g) => g.plays >= min);
  if (!q || visible.length === 0) continue;
  console.log(`\n${id}  ${q.prompt}`);
  for (const g of visible) {
    const kind = g.list_answer ? `Variante von „${g.list_answer}“` : `neu, Schätzung ${g.estimate}`;
    const spell = g.spellings?.length ? `  [${g.spellings.slice(0, 5).join(', ')}]` : '';
    console.log(`  ${String(g.plays).padStart(4)}×  ${g.text}  (${kind}, ${g.review_status})${spell}${g.reason ? `  – ${g.reason}` : ''}`);
    shown++;
  }
  if (exportPath) {
    const answers: Answer[] = q.answers.map((a) => ({ ...a, aliases: [...a.aliases] }));
    for (const g of visible) {
      const target = answers.find((a) => compact(a.text) === compact(g.list_answer ?? g.text));
      const spellings = (g.spellings ?? []).filter((s) => compact(s) !== compact(g.text));
      if (target) {
        for (const s of [g.text, ...spellings]) {
          if (compact(s) !== compact(target.text) && !target.aliases.some((x) => compact(x) === compact(s))) target.aliases.push(s);
        }
      } else {
        answers.push({ text: g.text, aliases: spellings, baseScore: Math.max(1, Math.min(100, g.estimate ?? 1)) });
      }
    }
    exported.push({ ...q, answers });
  }
}

console.log(`\n${shown} KI-akzeptierte Antworten in ${byQuestion.size} Fragen.`);
if (exportPath) {
  writeFileSync(resolve(ROOT, exportPath), JSON.stringify({ questions: exported }, null, 2) + '\n');
  console.log(`Export: ${exportPath} (${exported.length} Fragen) → prüfen, dann: npm run import-questions -- ${exportPath} --replace`);
}
