import { compact } from './normalize';
import type { AnswerResult, Question } from './types';

/** Im Admin-Bereich freigegebene Antwort (Tabelle approved_answers). */
export interface ApprovedAnswer {
  question_id: string;
  text: string;
  aliases: string[];
  base_score: number;
  /** Gesetzt: Variante dieser Listen-Antwort. */
  merged_into: string | null;
}

/**
 * Freigegebene Antworten in eine Frage einarbeiten – danach sind sie ganz
 * normale Listen-Antworten (Tippfehler-Toleranz, Wertung, kein KI-Badge).
 * Varianten werden Aliase der Listen-Antwort; Doppeltes wird übersprungen.
 */
export function mergeApproved(question: Question, rows: readonly ApprovedAnswer[]): Question {
  const mine = rows.filter((r) => r.question_id === question.id);
  if (mine.length === 0) return question;

  const answers = question.answers.map((a) => ({ ...a, aliases: [...a.aliases] }));
  const known = new Set(answers.flatMap((a) => [a.text, ...a.aliases].map(compact)));
  const approvedKeys = new Set<string>();

  for (const r of mine) {
    const spellings = [r.text, ...r.aliases].filter((s) => compact(s));
    spellings.forEach((s) => approvedKeys.add(compact(s)));
    const target = r.merged_into ? answers.find((a) => compact(a.text) === compact(r.merged_into!)) : undefined;
    if (target) {
      for (const s of spellings) if (!known.has(compact(s))) (target.aliases.push(s), known.add(compact(s)));
    } else if (!known.has(compact(r.text))) {
      answers.push({ text: r.text, aliases: r.aliases.filter((s) => !known.has(compact(s))), baseScore: r.base_score, approved: true });
      spellings.forEach((s) => known.add(compact(s)));
    }
  }
  return { ...question, answers, approvedKeys: [...approvedKeys] };
}

/** Ist dieses (alte) KI-Ergebnis inzwischen freigegeben? Dann kein KI-Badge mehr. */
export function isApprovedResult(question: Question | undefined, result: Pick<AnswerResult, 'input' | 'matched'>): boolean {
  const keys = question?.approvedKeys;
  if (!keys?.length) return false;
  return [result.input, result.matched].some((s) => s && keys.includes(compact(s)));
}
