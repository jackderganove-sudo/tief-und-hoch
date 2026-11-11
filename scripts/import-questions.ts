/**
 * Fragen-Pakete importieren und prüfen.
 *
 *   npm run import-questions -- packs/mein-paket.json [weitere.json …] [--replace] [--dry-run] [--verbose]
 *   npm run validate-questions
 *
 * Paket-Format (JSON):
 *   {
 *     "lang": "de",            // Standard für alle Fragen im Paket (optional)
 *     "mode": "rare",          // dito
 *     "questions": [
 *       {
 *         "id": "de-rare-bundesland",   // optional, wird sonst aus dem Prompt erzeugt
 *         "prompt": "Nenne ein deutsches Bundesland",
 *         "answers": [
 *           { "text": "Bayern", "aliases": [], "baseScore": 95 },
 *           "Nordrhein-Westfalen|NRW=60",   // Kurzform: Text|Alias|Alias=Score
 *           "Saarland=12!"                  // ! am Ende = tooClever
 *         ]
 *       }
 *     ]
 *   }
 * Ein Paket darf auch direkt ein Array von Fragen sein.
 *
 * Ergebnis: src/data/questions/<lang>/<mode>.json (vollständiges Format,
 * Antworten nach baseScore absteigend sortiert).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact, normalize } from '../src/domain/normalize.ts';
import { allowedTypos, levenshtein } from '../src/domain/levenshtein.ts';
import { LANGS, MODES } from '../src/domain/types.ts';
import type { Answer, Lang, Mode, Question } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'src/data/questions');
const MIN_ANSWERS = 5;

type RawAnswer = string | { text?: unknown; aliases?: unknown; baseScore?: unknown; tooClever?: unknown };
interface RawQuestion {
  id?: unknown;
  lang?: unknown;
  mode?: unknown;
  prompt?: unknown;
  answers?: unknown;
}

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
}

const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);
const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);

function fileFor(lang: Lang, mode: Mode) {
  return join(DATA_DIR, lang, `${mode}.json`);
}

function loadStored(lang: Lang, mode: Mode): Question[] {
  const file = fileFor(lang, mode);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Question[]) : [];
}

/** Eine Antwort pro Zeile – kompakt und gut lesbare Diffs. */
function formatQuestions(list: Question[]): string {
  const blocks = list.map((q) => {
    const answers = q.answers.map((a) => `      ${JSON.stringify(a)}`).join(',\n');
    return [
      '  {',
      `    "id": ${JSON.stringify(q.id)},`,
      `    "lang": ${JSON.stringify(q.lang)},`,
      `    "mode": ${JSON.stringify(q.mode)},`,
      `    "prompt": ${JSON.stringify(q.prompt)},`,
      '    "answers": [',
      answers,
      '    ]',
      '  }',
    ].join('\n');
  });
  return `[\n${blocks.join(',\n')}\n]\n`;
}

function makeId(lang: Lang, mode: Mode, prompt: string): string {
  const slug = normalize(prompt).split(' ').slice(0, 6).join('-').slice(0, 48);
  return `${lang}-${mode}-${slug}`;
}

/** "Text|Alias|Alias=Score!" → Answer */
function parseShorthand(s: string): RawAnswer {
  const m = /^(.*?)\s*=\s*(\d+)\s*(!?)\s*$/.exec(s);
  if (!m) return { text: s };
  const [names, score, flag] = [m[1], Number(m[2]), m[3] === '!'];
  const [text, ...aliases] = names.split('|').map((x) => x.trim()).filter(Boolean);
  return { text, aliases, baseScore: score, ...(flag ? { tooClever: true } : {}) };
}

function toAnswer(raw: RawAnswer, where: string, report: Report): Answer | null {
  const obj = typeof raw === 'string' ? parseShorthand(raw) : raw;
  if (!obj || typeof obj !== 'object') {
    report.error(where, 'Antwort ist weder Objekt noch Text');
    return null;
  }
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) {
    report.error(where, `Antwort ohne Text: ${JSON.stringify(raw)}`);
    return null;
  }
  const score = obj.baseScore;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    report.error(where, `"${text}": baseScore muss eine Zahl 0–100 sein (ist ${JSON.stringify(score)})`);
    return null;
  }
  const aliases = Array.isArray(obj.aliases)
    ? obj.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
    : [];
  if (obj.aliases !== undefined && !Array.isArray(obj.aliases)) {
    report.error(where, `"${text}": aliases muss ein Array sein`);
  }
  return {
    text,
    aliases,
    baseScore: Math.round(score),
    ...(obj.tooClever === true ? { tooClever: true } : {}),
  };
}

function toQuestion(raw: RawQuestion, defaults: { lang?: unknown; mode?: unknown }, where: string, report: Report): Question | null {
  const lang = raw.lang ?? defaults.lang;
  const mode = raw.mode ?? defaults.mode;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!isLang(lang)) report.error(where, `lang muss ${LANGS.join('/')} sein (ist ${JSON.stringify(lang)})`);
  if (!isMode(mode)) report.error(where, `mode muss ${MODES.join('/')} sein (ist ${JSON.stringify(mode)})`);
  if (!prompt) report.error(where, 'prompt fehlt');
  if (!Array.isArray(raw.answers)) report.error(where, 'answers muss ein Array sein');
  if (!isLang(lang) || !isMode(mode) || !prompt || !Array.isArray(raw.answers)) return null;

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeId(lang, mode, prompt);
  const here = `${where} [${id}]`;
  const answers = (raw.answers as RawAnswer[])
    .map((a) => toAnswer(a, here, report))
    .filter((a): a is Answer => a !== null)
    .sort((a, b) => b.baseScore - a.baseScore || a.text.localeCompare(b.text));

  return { id, lang, mode, prompt, answers };
}

/** Inhaltliche Prüfungen einer einzelnen Frage. */
function checkQuestion(q: Question, where: string, report: Report) {
  const here = `${where} [${q.id}]`;
  if (q.answers.length < MIN_ANSWERS) report.error(here, `mindestens ${MIN_ANSWERS} Antworten nötig`);

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
      if (prev && prev !== a.text) report.error(here, `"${s}" ist doppelt (auch bei "${prev}")`);
      else if (prev) report.warn(here, `"${s}" ist bei "${a.text}" doppelt eingetragen`);
      owner.set(key, a.text);
      keys.push({ key, text: a.text });
    }
  }

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

  const top = Math.max(...q.answers.map((a) => a.baseScore));
  const bottom = Math.min(...q.answers.map((a) => a.baseScore));
  if (q.mode === 'rare' && bottom > 3) report.warn(here, 'keine Antwort mit baseScore ≤ 3 – Stufe "Kern" unerreichbar');
  if (q.mode === 'common' && top < 80) report.warn(here, 'keine Antwort mit baseScore ≥ 80 – Stufe "Sterne" unerreichbar');
  if (q.mode === 'common' && q.answers.some((a) => a.tooClever)) {
    report.warn(here, 'tooClever wird im Modus "common" ignoriert');
  }
}

function readPack(file: string, report: Report): Question[] {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    report.error(file, `kein gültiges JSON (${(e as Error).message})`);
    return [];
  }
  const pack = Array.isArray(json) ? { questions: json } : (json as Record<string, unknown>);
  if (!Array.isArray(pack.questions)) {
    report.error(file, 'erwartet ein Array oder { questions: [...] }');
    return [];
  }
  return (pack.questions as RawQuestion[])
    .map((q, i) => toQuestion(q, pack, `${file}#${i + 1}`, report))
    .filter((q): q is Question => q !== null);
}

const VERBOSE = process.argv.includes('--verbose');

function printReport(report: Report) {
  if (VERBOSE) for (const n of report.notes) console.log(n);
  else if (report.notes.length) {
    console.log(`· ${report.notes.length} ähnliche Schreibweisen (Details mit --verbose)`);
  }
  for (const w of report.warnings) console.warn(w);
  for (const e of report.errors) console.error(e);
}

function validateAll(): number {
  const report = new Report();
  const ids = new Set<string>();
  let total = 0;
  for (const lang of LANGS) {
    for (const mode of MODES) {
      const list = loadStored(lang, mode);
      const where = `${lang}/${mode}.json`;
      for (const q of list) {
        if (ids.has(q.id)) report.error(where, `ID "${q.id}" doppelt`);
        ids.add(q.id);
        if (q.lang !== lang || q.mode !== mode) report.error(where, `"${q.id}" liegt in der falschen Datei`);
        checkQuestion(q, where, report);
      }
      console.log(`${where.padEnd(16)} ${String(list.length).padStart(3)} Fragen`);
      total += list.length;
    }
  }
  printReport(report);
  console.log(`\n${total} Fragen, ${report.errors.length} Fehler, ${report.warnings.length} Hinweise.`);
  return report.errors.length ? 1 : 0;
}

function importPacks(files: string[], replace: boolean, dryRun: boolean): number {
  const report = new Report();
  const incoming = files.flatMap((f) => readPack(resolve(f), report));
  for (const q of incoming) checkQuestion(q, 'Paket', report);

  // IDs innerhalb der neuen Pakete eindeutig?
  const seen = new Set<string>();
  for (const q of incoming) {
    if (seen.has(q.id)) report.error('Paket', `ID "${q.id}" mehrfach im Import`);
    seen.add(q.id);
  }

  if (report.errors.length) {
    printReport(report);
    console.error(`\nAbgebrochen: ${report.errors.length} Fehler. Es wurde nichts geschrieben.`);
    return 1;
  }

  const allIds = new Map<string, string>();
  for (const lang of LANGS) for (const mode of MODES) for (const q of loadStored(lang, mode)) allIds.set(q.id, `${lang}/${mode}`);

  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const lang of LANGS) {
    for (const mode of MODES) {
      const mine = incoming.filter((q) => q.lang === lang && q.mode === mode);
      if (!mine.length) continue;
      const list = loadStored(lang, mode);
      for (const q of mine) {
        const existingAt = allIds.get(q.id);
        const idx = list.findIndex((x) => x.id === q.id);
        if (existingAt && idx === -1) {
          report.error('Paket', `ID "${q.id}" existiert bereits in ${existingAt}`);
          continue;
        }
        if (idx >= 0 && !replace) {
          report.warn('Paket', `"${q.id}" existiert schon – übersprungen (mit --replace überschreiben)`);
          skipped++;
          continue;
        }
        if (idx >= 0) {
          list[idx] = q;
          replaced++;
        } else {
          list.push(q);
          added++;
        }
      }
      list.sort((a, b) => a.id.localeCompare(b.id));
      if (!dryRun) {
        mkdirSync(dirname(fileFor(lang, mode)), { recursive: true });
        writeFileSync(fileFor(lang, mode), formatQuestions(list));
      }
    }
  }

  printReport(report);
  console.log(
    `\n${dryRun ? '[dry-run, nichts geschrieben] ' : ''}${added} neu, ${replaced} ersetzt, ${skipped} übersprungen` +
      (report.errors.length ? `, ${report.errors.length} Fehler.` : '.'),
  );
  return report.errors.length ? 1 : 0;
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));

if (flags.has('--validate')) {
  process.exit(validateAll());
} else if (files.length === 0) {
  console.log('Nutzung: npm run import-questions -- <paket.json> […] [--replace] [--dry-run]');
  console.log('         npm run validate-questions');
  process.exit(1);
} else {
  process.exit(importPacks(files, flags.has('--replace'), flags.has('--dry-run')));
}
