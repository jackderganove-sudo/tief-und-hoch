import { matchAnswer } from '../domain/matchAnswer';
import { scoreAiVerdict, scoreAnswer } from '../domain/scoring';
import type { Answer, AnswerResult, Lang, Mode, Question } from '../domain/types';
import type { AnswerJudge } from './AnswerJudge';

export interface AnswerSubmission {
  dateKey: string;
  lang: Lang;
  mode: Mode;
  questionId: string;
  result: AnswerResult;
  /** Aus dem Endlos-Modus: wird gespeichert, zählt aber nicht für echte Häufigkeiten. */
  practice?: boolean;
}

/**
 * Wertung von Antworten.
 *
 * 1. Lokal: Liste, Aliase, Tippfehler – Häufigkeit = baseScore aus den Daten.
 * 2. Nur wenn das nichts findet und ein `judge` da ist: KI-Prüfung (Supabase).
 *
 * Später: `frequencyOf` mischt baseScore mit echten Anteilen aus `submissions`,
 * sobald eine Frage genug Antworten hat, z. B.
 *   w = min(1, n / 200);  freq = (1 - w) · baseScore + w · realShareNormalized
 * Die Oberfläche merkt davon nichts – sie ruft nur `evaluate` und `submit`.
 */
export interface ScoreService {
  /** true, wenn Antworten außerhalb der Liste per KI geprüft werden können. */
  readonly canJudge: boolean;
  /** Vor der ersten Frage aufrufen: Anmeldung/Verbindung vorwärmen, damit die Prüfung schnell ist. */
  prepare(): void;
  evaluate(question: Question, input: string, mode: Mode, opts?: { timedOut?: boolean }): Promise<AnswerResult>;
  submit(submission: AnswerSubmission): Promise<void>;
}

export class LocalScoreService implements ScoreService {
  constructor(private readonly judge: AnswerJudge | null = null) {}

  get canJudge() {
    return this.judge !== null;
  }

  prepare(): void {}

  protected async frequencyOf(_question: Question, answer: Answer): Promise<number> {
    return answer.baseScore;
  }

  async evaluate(question: Question, input: string, mode: Mode, opts: { timedOut?: boolean } = {}) {
    const match = matchAnswer(question, input);
    if (!match && this.judge && input.trim()) {
      const verdict = await this.judge.judge(question, input.trim());
      return scoreAiVerdict({ mode, question, input, verdict, timedOut: opts.timedOut });
    }
    const frequency = match ? await this.frequencyOf(question, match.answer) : null;
    return scoreAnswer({
      mode,
      questionId: question.id,
      input,
      match,
      frequency,
      timedOut: opts.timedOut,
    });
  }

  async submit(_submission: AnswerSubmission): Promise<void> {
    // Rein lokal: nichts zu speichern.
  }
}
