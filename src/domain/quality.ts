import type { Answer, Mode } from './types';

/**
 * Qualitätsregeln für Fragen – genutzt vom Import-Skript (Validierung,
 * automatische Modus-Zuordnung) und in Tests.
 */
export const MIN_ANSWERS = 20;

const count = (answers: Pick<Answer, 'baseScore'>[], pred: (s: number) => boolean) =>
  answers.filter((a) => pred(a.baseScore)).length;

/**
 * COMMON braucht klare Top-Antworten: mindestens eine "Sterne"-Antwort (≥ 80)
 * und nicht zu viele sehr häufige (sonst ist nichts davon "die" Antwort).
 * RARE braucht genug seltene Antworten: mind. 8 mit ≤ 10 und 3 mit ≤ 3 ("Kern").
 */
export function qualifiesFor(mode: Mode, answers: Pick<Answer, 'baseScore'>[]): boolean {
  if (mode === 'common') {
    return count(answers, (s) => s >= 80) >= 1 && count(answers, (s) => s >= 60) <= 5;
  }
  return count(answers, (s) => s <= 10) >= 8 && count(answers, (s) => s <= 3) >= 3;
}

export function deriveModes(answers: Pick<Answer, 'baseScore'>[]): Mode[] {
  return (['rare', 'common'] as const).filter((m) => qualifiesFor(m, answers));
}

/**
 * Plausible Verteilung: wenige sehr häufige, viele seltene Antworten.
 * Gibt Fehlermeldungen zurück (leer = in Ordnung).
 */
export function distributionIssues(answers: Pick<Answer, 'baseScore'>[]): string[] {
  const n = answers.length;
  if (n === 0) return [];
  const issues: string[] = [];
  const top = Math.max(...answers.map((a) => a.baseScore));
  const high = count(answers, (s) => s >= 60);
  const low = count(answers, (s) => s <= 15);
  if (top < 40) issues.push(`keine häufige Antwort (höchster baseScore ${top}, erwartet ≥ 40)`);
  if (high / n > 0.25) issues.push(`zu viele sehr häufige Antworten (${high} von ${n} mit baseScore ≥ 60)`);
  if (low / n < 0.25) issues.push(`zu wenige seltene Antworten (${low} von ${n} mit baseScore ≤ 15)`);
  return issues;
}
