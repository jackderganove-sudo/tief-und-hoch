import { isNonsense, nearMiss } from '../domain/attempts';
import { matchAnswer } from '../domain/matchAnswer';
import { scoreAiVerdict, scoreAnswer } from '../domain/scoring';
import type { Answer, AnswerResult, Lang, Mode, Question } from '../domain/types';
import type { AnswerJudge } from './AnswerJudge';

/** Warum ein Versuch nicht gilt. */
export type RejectReason =
  | 'invalid' // nicht in der Liste (und keine KI verfügbar bzw. Unsinn)
  | 'ai' // von der KI abgelehnt
  | 'listOnly' // KI-Kontingent dieser Frage verbraucht – nur noch die Liste zählt
  | 'limited' // KI-Tageslimit erreicht
  | 'unchecked'; // KI nicht erreichbar – darf noch einmal versucht werden

/** Ergebnis eines einzelnen Versuchs (die Frage läuft bei „rejected“ weiter). */
export type AttemptOutcome =
  | { ok: true; result: AnswerResult; aiUsed: boolean }
  | { ok: false; reason: RejectReason; aiUsed: boolean; /** „Meintest du …?“ */ hint: string | null };

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
  /**
   * Muss für diese Eingabe der Server gefragt werden (Timer pausiert, Eingabe gesperrt)?
   * false = sofort entschieden: Liste, Geräte-Cache oder offensichtlicher Unsinn.
   */
  willAsk(question: Question, input: string): boolean;
  /**
   * Ein Versuch: erst lokal (Liste, Aliase, Freigaben, Cache), nur wenn das nichts entscheidet
   * und `aiLeft > 0` die KI; ohne Kontingent wird nur noch im Cache nachgesehen.
   */
  attempt(question: Question, input: string, mode: Mode, opts: { aiLeft: number; timedOut?: boolean }): Promise<AttemptOutcome>;
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

  willAsk(question: Question, input: string): boolean {
    if (!this.judge || !input.trim()) return false;
    if (matchAnswer(question, input)) return false;
    if (isNonsense(question, input)) return false;
    return !this.judge.peek?.(question, input.trim());
  }

  async attempt(question: Question, input: string, mode: Mode, opts: { aiLeft: number; timedOut?: boolean }): Promise<AttemptOutcome> {
    const { timedOut } = opts;
    const match = matchAnswer(question, input);
    if (match) {
      const frequency = await this.frequencyOf(question, match.answer);
      return { ok: true, aiUsed: false, result: scoreAnswer({ mode, questionId: question.id, input, match, frequency, timedOut }) };
    }
    const hint = nearMiss(question, input);
    const text = input.trim();
    if (!this.judge || !text || isNonsense(question, text)) return { ok: false, reason: 'invalid', aiUsed: false, hint };

    const cacheOnly = opts.aiLeft <= 0;
    const verdict = this.judge.peek?.(question, text) ?? (await this.judge.judge(question, text, { cacheOnly }));
    // Cache-Treffer, Freigaben und reine Cache-Abfragen verbrauchen kein Kontingent
    const aiUsed = !cacheOnly && !verdict.cached && verdict.status !== 'limited' && verdict.status !== 'uncached';
    if (verdict.status === 'valid') return { ok: true, aiUsed, result: scoreAiVerdict({ mode, question, input, verdict, timedOut }) };
    if (verdict.status === 'uncached') return { ok: false, reason: 'listOnly', aiUsed, hint };
    if (verdict.status === 'limited') return { ok: false, reason: verdict.scope === 'question' ? 'listOnly' : 'limited', aiUsed, hint };
    if (verdict.status === 'error') return { ok: false, reason: 'unchecked', aiUsed, hint };
    return { ok: false, reason: 'ai', aiUsed, hint };
  }

  async submit(_submission: AnswerSubmission): Promise<void> {
    // Rein lokal: nichts zu speichern.
  }
}
