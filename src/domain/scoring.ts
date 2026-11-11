import type { AnswerResult, Mode, Tier, TierId } from './types';
import type { Match } from './matchAnswer';

export const QUESTIONS_PER_DAY = 7;
export const SECONDS_PER_QUESTION = 25;
export const METERS_PER_POINT = 10;
export const MAX_POINTS = QUESTIONS_PER_DAY * 100;

export const TIERS: Record<TierId, Tier> = {
  moss: { id: 'moss', points: 10, emoji: '🌿' },
  stone: { id: 'stone', points: 30, emoji: '🪨' },
  crystal: { id: 'crystal', points: 60, emoji: '💎' },
  ember: { id: 'ember', points: 85, emoji: '🔥' },
  core: { id: 'core', points: 100, emoji: '🌋' },
  tooClever: { id: 'tooClever', points: 15, emoji: '🤓' },
  meadow: { id: 'meadow', points: 10, emoji: '🌱' },
  treetops: { id: 'treetops', points: 30, emoji: '🌳' },
  clouds: { id: 'clouds', points: 60, emoji: '☁️' },
  sunset: { id: 'sunset', points: 85, emoji: '🌇' },
  stars: { id: 'stars', points: 100, emoji: '⭐' },
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
  };
}

export function totalPoints(results: Pick<AnswerResult, 'points'>[]): number {
  return results.reduce((sum, r) => sum + r.points, 0);
}

export function pointsToMeters(points: number): number {
  return points * METERS_PER_POINT;
}
