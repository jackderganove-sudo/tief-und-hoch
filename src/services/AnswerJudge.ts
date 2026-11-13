import type { AiVerdict } from '../domain/scoring';
import type { Question } from '../domain/types';

/**
 * Zweite Meinung für Antworten, die die lokale Prüfung (Liste, Aliase,
 * Tippfehler) nicht kennt. Wird nur dann aufgerufen.
 */
export interface AnswerJudge {
  /** `cacheOnly`: nur bekannte Urteile (Freigaben, Cache) – die KI wird nicht gefragt. */
  judge(question: Question, input: string, opts?: { cacheOnly?: boolean }): Promise<AiVerdict>;
  /** Urteil, das ohne Netz schon bekannt ist (Geräte-Cache). */
  peek?(question: Question, input: string): AiVerdict | null;
}
