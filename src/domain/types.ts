export type Lang = 'de' | 'en';
export type Mode = 'rare' | 'common';

export const LANGS: readonly Lang[] = ['de', 'en'];
export const MODES: readonly Mode[] = ['rare', 'common'];

export interface Answer {
  text: string;
  aliases: string[];
  /** Geschätzte Häufigkeit 0–100 (100 = die Antwort, die jeder sagt). */
  baseScore: number;
  /** Wirkt ausgefallen, wird aber genau deshalb oft gewählt (RARE: Sonderstufe). */
  tooClever?: boolean;
}

export interface Question {
  id: string;
  lang: Lang;
  mode: Mode;
  prompt: string;
  answers: Answer[];
}

export type TierId =
  // RARE (Abstieg)
  | 'moss'
  | 'stone'
  | 'crystal'
  | 'ember'
  | 'core'
  | 'tooClever'
  // COMMON (Aufstieg)
  | 'meadow'
  | 'treetops'
  | 'clouds'
  | 'sunset'
  | 'stars'
  // beide
  | 'invalid';

export interface Tier {
  id: TierId;
  points: number;
  emoji: string;
}

/** Ergebnis einer einzelnen Antwort. */
export interface AnswerResult {
  questionId: string;
  input: string;
  /** Kanonischer Text der erkannten Antwort, null wenn ungültig. */
  matched: string | null;
  /** true, wenn nur per Tippfehler-Toleranz erkannt ("Gemeint: …?"). */
  fuzzy: boolean;
  /** Effektive Häufigkeit 0–100, mit der gewertet wurde. */
  frequency: number | null;
  tier: TierId;
  points: number;
  timedOut: boolean;
}
