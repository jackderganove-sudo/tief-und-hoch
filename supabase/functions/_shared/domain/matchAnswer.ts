// Automatisch kopiert aus src/domain/matchAnswer.ts (npm run function-data) – nicht von Hand ändern.
import { compact } from './normalize.ts';
import { allowedTypos, levenshtein } from './levenshtein.ts';
import type { Answer, Question } from './types.ts';

export interface Match {
  answer: Answer;
  /** 0 = exakter Treffer (nach Normalisierung), >0 = per Tippfehler-Toleranz. */
  distance: number;
}

interface Candidate {
  answer: Answer;
  key: string;
}

// Kandidaten pro Frage cachen – die Liste ändert sich zur Laufzeit nicht.
const cache = new WeakMap<Question, Candidate[]>();

function candidates(question: Question): Candidate[] {
  let list = cache.get(question);
  if (!list) {
    list = question.answers.flatMap((answer) =>
      [answer.text, ...answer.aliases].map((s) => ({ answer, key: compact(s) })),
    );
    cache.set(question, list);
  }
  return list;
}

/**
 * Sucht die passende Antwort zur Eingabe.
 * 1. exakter Treffer nach Normalisierung (inkl. Aliase)
 * 2. sonst bester Treffer innerhalb der Tippfehler-Toleranz
 * Bei Gleichstand gewinnt die kürzere Distanz, dann die häufigere Antwort.
 */
export function matchAnswer(question: Question, input: string): Match | null {
  const key = compact(input);
  if (!key) return null;

  const list = candidates(question);
  const exact = list.find((c) => c.key === key);
  if (exact) return { answer: exact.answer, distance: 0 };

  let best: Match | null = null;
  for (const c of list) {
    const max = allowedTypos(Math.min(key.length, c.key.length));
    if (max === 0) continue;
    const d = levenshtein(key, c.key, max);
    if (d > max) continue;
    if (
      !best ||
      d < best.distance ||
      (d === best.distance && c.answer.baseScore > best.answer.baseScore)
    ) {
      best = { answer: c.answer, distance: d };
    }
  }
  return best;
}
