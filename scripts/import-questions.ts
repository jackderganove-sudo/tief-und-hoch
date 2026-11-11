/**
 * Fragen-Pakete importieren und prüfen.
 *
 *   npm run import-questions -- packs/mein-paket.json [weitere.json …] [--replace] [--dry-run] [--verbose]
 *   npm run validate-questions [-- --verbose]
 *
 * Paket-Format (JSON):
 *   {
 *     "lang": "de",            // Standard für alle Fragen im Paket (optional)
 *     "topic": "food",         // dito
 *     "questions": [
 *       {
 *         "id": "de-food-001",            // optional – sonst nächste freie Nummer
 *         "prompt": "Nenne ein Nudelgericht",
 *         "modes": ["rare", "common"],    // optional – sonst aus der Verteilung abgeleitet
 *         "answers": [
 *           { "text": "Lasagne", "aliases": ["Lasagna"], "baseScore": 70 },
 *           "Spaghetti Bolognese|Spag Bol=100",   // Kurzform: Text|Alias|Alias=Score
 *           "Cacio e Pepe=2!"                     // ! am Ende = tooClever
 *         ]
 *       }
 *     ]
 *   }
 * Ein Paket darf auch direkt ein Array von Fragen sein.
 *
 * Ergebnis: src/data/questions/<lang>/<topic>.json (vollständiges Format,
 * Antworten nach baseScore absteigend sortiert).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { compact } from '../src/domain/normalize.ts';
import { allowedTypos, levenshtein } from '../src/domain/levenshtein.ts';
import { MIN_ANSWERS, deriveModes, distributionIssues, qualifiesFor } from '../src/domain/quality.ts';
import { LANGS, MODES, TOPICS } from '../src/domain/types.ts';
import type { Lang, Mode, Question, TopicId } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'src/data/questions');
/** Mindestens so viele Fragen pro Sprache und Modus (ein Tag braucht 7). */
const MIN_PER_MODE = 7;
/** Darunter gibt es pro Thema und Modus einen Hinweis (Übungsmodus mit einem Thema). */
const MIN_PER_TOPIC_MODE = 5;

// ---------------------------------------------------------------- Schema (zod)

const LangSchema = z.enum(LANGS);
const ModeSchema = z.enum(MODES);
const TopicSchema = z.enum(TOPICS);

const AnswerSchema = z.strictObject({
  text: z.string().trim().min(1, 'Antwort ohne Text'),
  aliases: z.array(z.string().trim().min(1)).default([]),
  baseScore: z.number().int('baseScore muss ganzzahlig sein').min(0).max(100),
  tooClever: z.literal(true).optional(),
});

/** "Text|Alias|Alias=Score!" → Antwort-Objekt */
function parseShorthand(s: string): unknown {
  const m = /^(.*?)\s*=\s*(\d+)\s*(!?)\s*$/.exec(s);
  if (!m) return { text: s }; // kein Score → Schema meldet den Fehler
  const [text, ...aliases] = m[1].split('|').map((x) => x.trim()).filter(Boolean);
  return { text: text ?? '', aliases, baseScore: Number(m[2]), ...(m[3] ? { tooClever: true } : {}) };
}

const AnswerInput = z.preprocess((v) => (typeof v === 'string' ? parseShorthand(v) : v), AnswerSchema);

const QuestionInput = z.strictObject({
  id: z.string().regex(/^(de|en)-[a-z_]+-\d{3}$/, 'ID muss wie "de-food-001" aussehen').optional(),
  lang: LangSchema.optional(),
  topic: TopicSchema.optional(),
  prompt: z.string().trim().min(5, 'prompt fehlt oder ist zu kurz'),
  modes: z.array(ModeSchema).min(1).optional(),
  answers: z.array(AnswerInput),
});

const PackInput = z.preprocess(
  (v) => (Array.isArray(v) ? { questions: v } : v),
  z.strictObject({
    lang: LangSchema.optional(),
    topic: TopicSchema.optional(),
    questions: z.array(QuestionInput).min(1, 'Paket enthält keine Fragen'),
  }),
);

const StoredQuestion = z.strictObject({
  id: z.string().regex(/^(de|en)-[a-z_]+-\d{3}$/),
  lang: LangSchema,
  topic: TopicSchema,
  prompt: z.string().min(5),
  modes: z.array(ModeSchema).min(1),
  answers: z.array(AnswerSchema),
});

// ---------------------------------------------------------------- Bericht

const VERBOSE = process.argv.includes('--verbose');

class Report {
  errors: string[] = [];
  warnings: string[] = [];
  /** Nur mit --verbose ausgegeben. */
  notes: string[] = [];
  error(where: string, msg: string) {
    this.errors.push(`✖ ${where}: ${msg}`);
  }
  warn(where: string, msg: string) {
    this.warnings.push(`⚠ ${where}: ${msg}`);
  }
  note(where: string, msg: string) {
    this.notes.push(`· ${where}: ${msg}`);
  }
  zod(where: string, err: z.ZodError) {
    for (const issue of err.issues) this.error(`${where}${issue.path.length ? ` → ${issue.path.join('.')}` : ''}`, issue.message);
  }
  print() {
    if (VERBOSE) for (const n of this.notes) console.log(n);
    else if (this.notes.length) console.log(`· ${this.notes.length} ähnliche Schreibweisen (Details mit --verbose)`);
    for (const w of this.warnings) console.warn(w);
    for (const e of this.errors) console.error(e);
  }
}

// ---------------------------------------------------------------- Dateien

const fileFor = (lang: Lang, topic: TopicId) => join(DATA_DIR, lang, `${topic}.json`);

function loadStored(lang: Lang, topic: TopicId, report?: Report): Question[] {
  const file = fileFor(lang, topic);
  if (!existsSync(file)) return [];
  const parsed = z.array(StoredQuestion).safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    report?.zod(`${lang}/${topic}.json`, parsed.error);
    return [];
  }
  return parsed.data as Question[];
}

/** Eine Antwort pro Zeile – kompakt und gut lesbare Diffs. */
function formatQuestions(list: Question[]): string {
  const blocks = list.map((q) =>
    [
      '  {',
      `    "id": ${JSON.stringify(q.id)},`,
      `    "lang": ${JSON.stringify(q.lang)},`,
      `    "topic": ${JSON.stringify(q.topic)},`,
      `    "prompt": ${JSON.stringify(q.prompt)},`,
      `    "modes": ${JSON.stringify(q.modes)},`,
      '    "answers": [',
      q.answers.map((a) => `      ${JSON.stringify(a)}`).join(',\n'),
      '    ]',
      '  }',
    ].join('\n'),
  );
  return `[\n${blocks.join(',\n')}\n]\n`;
}

// ---------------------------------------------------------------- Prüfungen

/** Inhaltliche Prüfungen einer einzelnen Frage (über das Schema hinaus). */
function checkQuestion(q: Question, where: string, report: Report) {
  const here = `${where} [${q.id}] "${q.prompt}"`;
  if (!q.id.startsWith(`${q.lang}-${q.topic}-`)) report.error(here, `ID passt nicht zu lang/topic (${q.lang}/${q.topic})`);
  if (q.answers.length < MIN_ANSWERS) report.error(here, `nur ${q.answers.length} Antworten (mindestens ${MIN_ANSWERS})`);

  // Doppelte Schreibweisen (nach Normalisierung) über Texte und Aliase hinweg.
  const owner = new Map<string, string>();
  const keys: { key: string; text: string }[] = [];
  for (const a of q.answers) {
    for (const s of [a.text, ...a.aliases]) {
      const key = compact(s);
      if (!key) {
        report.error(here, `"${s}" ist nach Normalisierung leer`);
        continue;
      }
      const prev = owner.get(key);
      if (prev !== undefined) {
        report.error(here, prev === a.text ? `"${s}" ist bei "${a.text}" doppelt eingetragen` : `"${s}" ist doppelt (auch bei "${prev}")`);
      }
      owner.set(key, a.text);
      keys.push({ key, text: a.text });
    }
  }

  for (const issue of distributionIssues(q.answers)) report.error(here, `unplausible Verteilung – ${issue}`);
  if (new Set(q.modes).size !== q.modes.length) report.error(here, 'modes enthält Duplikate');
  for (const mode of q.modes) {
    if (!qualifiesFor(mode, q.answers)) {
      report.error(
        here,
        mode === 'common'
          ? 'Modus "common" braucht eine klare Top-Antwort (baseScore ≥ 80, höchstens 5 Antworten ≥ 60)'
          : 'Modus "rare" braucht genug seltene Antworten (mind. 8 mit baseScore ≤ 10, davon 3 mit ≤ 3)',
      );
    }
  }

  const clever = q.answers.filter((a) => a.tooClever).length;
  if (clever > 3) report.error(here, `${clever} tooClever-Antworten (höchstens 3)`);
  if (clever === 0 && q.modes.includes('rare')) report.warn(here, 'keine tooClever-Antwort (empfohlen: 1–3)');

  // Sehr ähnliche Schreibweisen verschiedener Antworten: Tippfehler-Toleranz könnte verwechseln.
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (a.text === b.text) continue;
      const max = allowedTypos(Math.min(a.key.length, b.key.length));
      if (max > 0 && levenshtein(a.key, b.key, max) <= max) {
        report.note(here, `"${a.text}" ~ "${b.text}" (bei Tippfehlern gewinnt die nähere Schreibweise)`);
      }
    }
  }
}

/** Prüfungen über den ganzen Bestand. */
function checkAll(all: Question[], report: Report) {
  const ids = new Map<string, number>();
  const prompts = new Map<string, string>();
  for (const q of all) {
    ids.set(q.id, (ids.get(q.id) ?? 0) + 1);
    const key = `${q.lang}:${compact(q.prompt)}`;
    const prev = prompts.get(key);
    if (prev) report.error(`[${q.id}]`, `gleicher Prompt wie ${prev}`);
    prompts.set(key, q.id);
  }
  for (const [id, n] of ids) if (n > 1) report.error(`[${id}]`, `ID kommt ${n}× vor`);

  for (const lang of LANGS) {
    const mine = all.filter((q) => q.lang === lang);
    if (!mine.length) continue;
    for (const mode of MODES) {
      const n = mine.filter((q) => q.modes.includes(mode)).length;
      if (n < MIN_PER_MODE) report.error(lang, `nur ${n} Fragen für Modus "${mode}" (mindestens ${MIN_PER_MODE})`);
    }
    for (const topic of TOPICS) {
      const inTopic = mine.filter((q) => q.topic === topic);
      if (!inTopic.length) continue;
      for (const mode of MODES) {
        const n = inTopic.filter((q) => q.modes.includes(mode)).length;
        if (n < MIN_PER_TOPIC_MODE) report.warn(`${lang}/${topic}`, `nur ${n} Fragen für Modus "${mode}"`);
      }
    }
  }
}

function printOverview(all: Question[]) {
  const pad = (v: string | number, w: number) => String(v).padStart(w);
  for (const lang of LANGS) {
    const mine = all.filter((q) => q.lang === lang);
    console.log(`\n${lang.toUpperCase()}  ${'Thema'.padEnd(11)} ${pad('Fragen', 6)} ${pad('rare', 5)} ${pad('common', 6)} ${pad('beide', 5)} ${pad('Ø Antw.', 8)}`);
    const row = (label: string, list: Question[]) => {
      const answers = list.reduce((s, q) => s + q.answers.length, 0);
      console.log(
        `    ${label.padEnd(11)} ${pad(list.length, 6)} ${pad(list.filter((q) => q.modes.includes('rare')).length, 5)} ` +
          `${pad(list.filter((q) => q.modes.includes('common')).length, 6)} ${pad(list.filter((q) => q.modes.length === 2).length, 5)} ` +
          `${pad(list.length ? (answers / list.length).toFixed(1) : '–', 8)}`,
      );
    };
    for (const topic of TOPICS) row(topic, mine.filter((q) => q.topic === topic));
    row('GESAMT', mine);
  }
}

function loadAll(report: Report): Question[] {
  const all: Question[] = [];
  for (const lang of LANGS) {
    const dir = join(DATA_DIR, lang);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.json') && !TOPICS.includes(f.slice(0, -5) as TopicId)) {
          report.error(`${lang}/${f}`, `unbekanntes Thema (erlaubt: ${TOPICS.join(', ')})`);
        }
      }
    }
    for (const topic of TOPICS) {
      for (const q of loadStored(lang, topic, report)) {
        if (q.lang !== lang || q.topic !== topic) report.error(`${lang}/${topic}.json`, `"${q.id}" liegt in der falschen Datei`);
        all.push(q);
      }
    }
  }
  return all;
}

// ---------------------------------------------------------------- Befehle

function validateAll(): number {
  const report = new Report();
  const all = loadAll(report);
  for (const q of all) checkQuestion(q, `${q.lang}/${q.topic}.json`, report);
  checkAll(all, report);
  printOverview(all);
  console.log('');
  report.print();
  console.log(`\n${all.length} Fragen, ${report.errors.length} Fehler, ${report.warnings.length} Hinweise.`);
  return report.errors.length ? 1 : 0;
}

interface Incoming {
  id?: string;
  question: Omit<Question, 'id'>;
}

function readPack(file: string, report: Report): Incoming[] {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    report.error(file, `kein gültiges JSON (${(e as Error).message})`);
    return [];
  }
  const pack = PackInput.safeParse(json);
  if (!pack.success) {
    report.zod(file, pack.error);
    return [];
  }
  const out: Incoming[] = [];
  pack.data.questions.forEach((raw, i) => {
    const where = `${file}#${i + 1} "${raw.prompt}"`;
    const lang = raw.lang ?? pack.data.lang;
    const topic = raw.topic ?? pack.data.topic;
    if (!lang) report.error(where, 'lang fehlt (in der Frage oder im Paket angeben)');
    if (!topic) report.error(where, 'topic fehlt (in der Frage oder im Paket angeben)');
    if (!lang || !topic) return;
    const answers = [...raw.answers].sort((a, b) => b.baseScore - a.baseScore || a.text.localeCompare(b.text));
    const modes: Mode[] = raw.modes ? MODES.filter((m) => raw.modes!.includes(m)) : deriveModes(answers);
    if (modes.length === 0) {
      report.error(where, 'passt zu keinem Modus: weder klare Top-Antwort (≥ 80) noch genug seltene Antworten');
      return;
    }
    out.push({ id: raw.id, question: { lang, topic, prompt: raw.prompt, modes, answers } });
  });
  return out;
}

function importPacks(files: string[], replace: boolean, dryRun: boolean): number {
  const report = new Report();
  const incoming = files.flatMap((f) => readPack(resolve(f), report));
  const all = loadAll(report);

  const byId = new Map(all.map((q) => [q.id, q]));
  const byPrompt = new Map(all.map((q) => [`${q.lang}:${compact(q.prompt)}`, q]));
  const nextNumber = new Map<string, number>();
  const nextId = (lang: Lang, topic: TopicId) => {
    const prefix = `${lang}-${topic}-`;
    let n = nextNumber.get(prefix);
    if (n === undefined) {
      n = Math.max(0, ...all.filter((q) => q.id.startsWith(prefix)).map((q) => Number(q.id.slice(prefix.length)))) + 1;
    }
    nextNumber.set(prefix, n + 1);
    return `${prefix}${String(n).padStart(3, '0')}`;
  };

  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const touched = new Set<string>();
  const result = [...all];
  for (const inc of incoming) {
    // Bestehende Frage erkennen: über die ID, sonst über denselben Prompt.
    const existing = (inc.id && byId.get(inc.id)) || byPrompt.get(`${inc.question.lang}:${compact(inc.question.prompt)}`);
    if (existing && !replace) {
      report.warn('Paket', `"${inc.question.prompt}" existiert schon als ${existing.id} – übersprungen (mit --replace überschreiben)`);
      skipped++;
      continue;
    }
    const q: Question = { id: existing?.id ?? inc.id ?? nextId(inc.question.lang, inc.question.topic), ...inc.question };
    checkQuestion(q, 'Paket', report);
    if (existing) {
      result[result.indexOf(existing)] = q;
      touched.add(`${existing.lang}/${existing.topic}`);
      replaced++;
    } else {
      result.push(q);
      added++;
    }
    byId.set(q.id, q);
    byPrompt.set(`${q.lang}:${compact(q.prompt)}`, q);
    touched.add(`${q.lang}/${q.topic}`);
  }
  checkAll(result, report);

  report.print();
  if (report.errors.length) {
    console.error(`\nAbgebrochen: ${report.errors.length} Fehler. Es wurde nichts geschrieben.`);
    return 1;
  }

  if (!dryRun) {
    for (const key of touched) {
      const [lang, topic] = key.split('/') as [Lang, TopicId];
      const list = result.filter((q) => q.lang === lang && q.topic === topic).sort((a, b) => a.id.localeCompare(b.id));
      mkdirSync(dirname(fileFor(lang, topic)), { recursive: true });
      writeFileSync(fileFor(lang, topic), formatQuestions(list));
    }
  }
  if (VERBOSE) printOverview(result);
  console.log(`\n${dryRun ? '[dry-run, nichts geschrieben] ' : ''}${added} neu, ${replaced} ersetzt, ${skipped} übersprungen. Bestand: ${result.length} Fragen.`);
  return 0;
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));

if (flags.has('--validate')) {
  process.exit(validateAll());
} else if (files.length === 0) {
  console.log('Nutzung: npm run import-questions -- <paket.json> […] [--replace] [--dry-run] [--verbose]');
  console.log('         npm run validate-questions');
  process.exit(1);
} else {
  process.exit(importPacks(files, flags.has('--replace'), flags.has('--dry-run')));
}
