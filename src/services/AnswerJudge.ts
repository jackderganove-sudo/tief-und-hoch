import type { AiVerdict } from '../domain/scoring';
import type { Question } from '../domain/types';

/**
 * Zweite Meinung für Antworten, die die lokale Prüfung (Liste, Aliase,
 * Tippfehler) nicht kennt. Wird nur dann aufgerufen.
 */
export interface AnswerJudge {
  judge(question: Question, input: string): Promise<AiVerdict>;
}
