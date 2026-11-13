/**
 * Daten für die Edge Function "judge-answer" erzeugen:
 *   supabase/functions/_shared/questions.json  (Frage, Sprache, Antworten pro ID)
 *   supabase/functions/_shared/normalize.ts    (Kopie von src/domain/normalize.ts)
 *
 *   npm run function-data            schreiben
 *   npm run function-data -- --check prüfen, ob alles aktuell ist (CI)
 *
 * Nach Änderungen an den Fragen: Skript laufen lassen und die Funktion neu
 * deployen (npx supabase functions deploy judge-answer).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question } from '../src/domain/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/data/questions');
const OUT = join(ROOT, 'supabase/functions/_shared');

const questions: Record<string, { lang: string; prompt: string; answers: { text: string; aliases: string[]; baseScore: number }[] }> = {};
for (const lang of readdirSync(DATA).sort()) {
  for (const file of readdirSync(join(DATA, lang)).sort()) {
    for (const q of JSON.parse(readFileSync(join(DATA, lang, file), 'utf8')) as Question[]) {
      questions[q.id] = {
        lang: q.lang,
        prompt: q.prompt,
        answers: q.answers.map((a) => ({ text: a.text, aliases: a.aliases, baseScore: a.baseScore })),
      };
    }
  }
}

const files: Record<string, string> = {
  'questions.json': JSON.stringify(questions) + '\n',
  'normalize.ts':
    '// Automatisch kopiert aus src/domain/normalize.ts (npm run function-data) – nicht von Hand ändern.\n' +
    readFileSync(join(ROOT, 'src/domain/normalize.ts'), 'utf8'),
};

// Spiel-Logik für die Edge Function "room" (Freunde-Modus): dieselben Regeln wie im Client.
// Deno braucht Dateiendungen in Importen → './x' wird zu './x.ts'.
const DOMAIN = ['normalize', 'levenshtein', 'matchAnswer', 'scoring', 'types', 'daily', 'room', 'roomScoring', 'attempts'];
for (const name of DOMAIN) {
  const src = readFileSync(join(ROOT, `src/domain/${name}.ts`), 'utf8').replace(/(from\s+'\.\/[A-Za-z]+)'/g, "$1.ts'");
  files[`domain/${name}.ts`] = `// Automatisch kopiert aus src/domain/${name}.ts (npm run function-data) – nicht von Hand ändern.\n${src}`;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, content] of Object.entries(files)) {
  const path = join(OUT, name);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    console.error(`veraltet: supabase/functions/_shared/${name} – bitte "npm run function-data" ausführen`);
    stale++;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`geschrieben: supabase/functions/_shared/${name}`);
  }
}
if (check && !stale) console.log(`Funktionsdaten aktuell (${Object.keys(questions).length} Fragen).`);
process.exit(stale ? 1 : 0);
