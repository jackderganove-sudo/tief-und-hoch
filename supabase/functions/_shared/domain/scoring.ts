// Automatisch kopiert aus src/domain/scoring.ts (npm run function-data) – nicht von Hand ändern.
import type { AnswerResult, Mode, Question, Tier, TierId } from './types.ts';
import type { Match } from './matchAnswer.ts';

export const QUESTIONS_PER_DAY = 7;
export const SECONDS_PER_QUESTION = 25;
export const METERS_PER_POINT = 10;
export const MAX_POINTS = QUESTIONS_PER_DAY * 100;

/**
 * Stufen. Die IDs bleiben aus Kompatibilität (gespeicherte Spielstände) bei den alten
 * Zonen-Namen; angezeigt werden Medaillen – gleiche Punkte = gleiche Medaille in beiden Modi:
 * Bronze 10 · Silber 30 · Gold 60 · Platin 85 · Diamant 100 (Anzeigenamen in i18n „tiers“).
 */
export const TIERS: Record<TierId, Tier> = {
  moss: { id: 'moss', points: 10, emoji: '🥉' },
  stone: { id: 'stone', points: 30, emoji: '🥈' },
  crystal: { id: 'crystal', points: 60, emoji: '🥇' },
  ember: { id: 'ember', points: 85, emoji: '🏆' },
  core: { id: 'core', points: 100, emoji: '💎' },
  tooClever: { id: 'tooClever', points: 15, emoji: '🤓' },
  meadow: { id: 'meadow', points: 10, emoji: '🥉' },
  treetops: { id: 'treetops', points: 30, emoji: '🥈' },
  clouds: { id: 'clouds', points: 60, emoji: '🥇' },
  sunset: { id: 'sunset', points: 85, emoji: '🏆' },
  stars: { id: 'stars', points: 100, emoji: '💎' },
  invalid: { id: 'invalid', points: 0, emoji: '⬛' },
};

/** Stufen von oben nach unten (bzw. unten nach oben) – für Legende und Höhenmesser. */
export const MODE_TIERS: Record<Mode, TierId[]> = {
  rare: ['moss', 'stone', 'crystal', 'ember', 'core'],
  common: ['meadow', 'treetops', 'clouds', 'sunset', 'stars'],
};

/**
 * Schwellen auf der Häufigkeit (0–100).
 * RARE wertet invers: je kleiner die Häufigkeit, desto tiefer.
 * COMMON wertet direkt: je größer die Häufigkeit, desto höher.
 */
export function tierFor(mode: Mode, frequency: number, tooClever = false): TierId {
  if (mode === 'rare') {
    if (tooClever) return 'tooClever';
    if (frequency <= 3) return 'core';
    if (frequency <= 10) return 'ember';
    if (frequency <= 25) return 'crystal';
    if (frequency <= 50) return 'stone';
    return 'moss';
  }
  if (frequency >= 80) return 'stars';
  if (frequency >= 55) return 'sunset';
  if (frequency >= 30) return 'clouds';
  if (frequency >= 12) return 'treetops';
  return 'meadow';
}

/** Baut das Ergebnis einer Antwort; `frequency` kommt vom ScoreService. */
export function scoreAnswer(params: {
  mode: Mode;
  questionId: string;
  input: string;
  match: Match | null;
  frequency: number | null;
  timedOut?: boolean;
}): AnswerResult {
  const { mode, questionId, input, match, frequency, timedOut = false } = params;
  if (!match || frequency === null) {
    return {
      questionId,
      input,
      matched: null,
      fuzzy: false,
      frequency: null,
      tier: 'invalid',
      points: 0,
      timedOut,
      source: 'list',
    };
  }
  const tier = tierFor(mode, frequency, match.answer.tooClever);
  return {
    questionId,
    input,
    matched: match.answer.text,
    fuzzy: match.distance > 0,
    frequency,
    tier,
    points: TIERS[tier].points,
    timedOut,
    source: 'list',
  };
}

/** Urteil der KI-Prüfung, wie es das Spiel von der Edge Function bekommt. */
export interface AiVerdict {
  /** 'uncached' = nur im Cache nachgesehen (Kontingent der Frage verbraucht), kein Urteil vorhanden. */
  status: 'valid' | 'invalid' | 'error' | 'limited' | 'uncached';
  /** Urteil kam aus dem Cache – zählt nicht als KI-Prüfung. */
  cached?: boolean;
  /** Bei 'limited': Kontingent dieser Frage (statt Tageslimit) verbraucht. */
  scope?: 'question' | 'day';
  /** Von mir freigegeben → normale Wertung wie eine Listen-Antwort, kein KI-Badge. */
  approved?: boolean;
  /** Antwort aus der Liste, wenn die Eingabe eine Variante davon ist. */
  listAnswer?: string | null;
  canonicalText?: string | null;
  estimatedBaseScore?: number | null;
}

/** Bestes Ergebnis, das eine KI-akzeptierte Antwort im Abstieg erreichen kann. */
export const AI_RARE_MAX_TIER: TierId = 'ember';

/**
 * Wertung einer Antwort, die erst die KI-Prüfung erkannt hat.
 * - Variante einer Listen-Antwort → zählt wie diese Listen-Antwort.
 * - Abstieg: Stufe aus der geschätzten Häufigkeit, aber höchstens „Glut“ –
 *   100 Punkte gibt es nur für Antworten aus der kuratierten Liste.
 * - Aufstieg: nicht in der Liste = per Definition selten → niedrigste Stufe.
 * - Fehler/Limit: ungültig, aber als „nicht geprüft“ markiert.
 */
export function scoreAiVerdict(params: {
  mode: Mode;
  question: Question;
  input: string;
  verdict: AiVerdict;
  timedOut?: boolean;
}): AnswerResult {
  const { mode, question, input, verdict, timedOut = false } = params;
  const base = { questionId: question.id, input, fuzzy: false, timedOut, source: 'ai' as const };
  const invalid: AnswerResult = { ...base, matched: null, frequency: null, tier: 'invalid', points: 0 };

  if (verdict.status === 'error' || verdict.status === 'limited') return { ...invalid, unchecked: verdict.status };
  // nur im Cache nachgesehen und nichts gefunden → schlicht „nicht in der Liste“
  if (verdict.status === 'uncached') return { ...invalid, source: 'list' };
  if (verdict.status !== 'valid') return invalid;

  const listed = verdict.listAnswer ? question.answers.find((a) => a.text === verdict.listAnswer) : undefined;
  const source = verdict.approved ? ('list' as const) : ('ai' as const);
  if (listed) {
    const tier = tierFor(mode, listed.baseScore, listed.tooClever);
    return { ...base, source, matched: listed.text, frequency: listed.baseScore, tier, points: TIERS[tier].points };
  }
  if (verdict.approved) {
    const freq = Math.max(0, Math.min(100, Math.round(verdict.estimatedBaseScore ?? 0)));
    const tier = tierFor(mode, freq);
    return { ...base, source, matched: (verdict.canonicalText ?? '').trim() || input.trim(), frequency: freq, tier, points: TIERS[tier].points };
  }

  const matched = (verdict.canonicalText ?? '').trim() || input.trim();
  const estimate = Math.max(0, Math.min(100, Math.round(verdict.estimatedBaseScore ?? 0)));
  let tier: TierId;
  if (mode === 'rare') {
    tier = tierFor('rare', estimate);
    if (tier === 'core') tier = AI_RARE_MAX_TIER;
  } else {
    tier = 'meadow';
  }
  return { ...base, matched, frequency: estimate, tier, points: TIERS[tier].points };
}

export function totalPoints(results: Pick<AnswerResult, 'points'>[]): number {
  return results.reduce((sum, r) => sum + r.points, 0);
}

export function pointsToMeters(points: number): number {
  return points * METERS_PER_POINT;
}

/**
 * Stand einer Übungssession: startet immer bei 0 m; Tiefe bzw. Höhe ist die
 * Summe der Punkte dieser Session × 10 m (keine Hochrechnung, nichts aus anderen Runden).
 */
export function practiceProgress(results: Pick<AnswerResult, 'points'>[]): { meters: number; points: number; average: number } {
  const points = totalPoints(results);
  return { meters: pointsToMeters(points), points, average: results.length ? points / results.length : 0 };
}
