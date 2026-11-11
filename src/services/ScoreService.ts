import { matchAnswer } from '../domain/matchAnswer';
import { scoreAnswer } from '../domain/scoring';
import type { Answer, AnswerResult, Lang, Mode, Question } from '../domain/types';

export interface AnswerSubmission {
  dateKey: string;
  lang: Lang;
  mode: Mode;
  questionId: string;
  /** Kanonische Antwort oder null, wenn ungültig. */
  answerText: string | null;
}

/**
 * Wertung von Antworten.
 *
 * Phase 1: Häufigkeit = baseScore aus den Daten.
 * Phase 2 (Supabase): `submit` speichert echte Antworten, `frequencyOf` mischt
 * baseScore mit dem echten Anteil, sobald eine Frage genug Antworten hat, z. B.
 *   w = min(1, n / 200);  freq = (1 - w) · baseScore + w · realShareNormalized
 * Die Oberfläche merkt davon nichts – sie ruft nur `evaluate` und `submit`.
 */
export interface ScoreService {
  evaluate(question: Question, input: string, opts?: { timedOut?: boolean }): Promise<AnswerResult>;
  submit(submission: AnswerSubmission): Promise<void>;
}

export class LocalScoreService implements ScoreService {
  protected async frequencyOf(_question: Question, answer: Answer): Promise<number> {
    return answer.baseScore;
  }

  async evaluate(question: Question, input: string, opts: { timedOut?: boolean } = {}) {
    const match = matchAnswer(question, input);
    const frequency = match ? await this.frequencyOf(question, match.answer) : null;
    return scoreAnswer({
      mode: question.mode,
      questionId: question.id,
      input,
      match,
      frequency,
      timedOut: opts.timedOut,
    });
  }

  async submit(): Promise<void> {
    // Phase 1: nichts zu tun. Phase 2: Insert in eine "answers"-Tabelle.
  }
}
