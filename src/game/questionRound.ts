/**
 * Eine Frage mit beliebig vielen Versuchen (Tagesrunde und Übung).
 *
 * Falsche Antworten beenden die Frage nicht: Feedback, Feld leeren, weitertippen. Die Frage
 * endet mit der ersten gültigen Antwort oder mit dem Ablauf der Zeit (0 Punkte). Solange
 * der Server gefragt wird (KI), steht der Timer – höchstens AI_PAUSE_MAX_MS pro Prüfung.
 *
 * Ohne React, mit einsetzbarer Uhr und Wertung – so lässt sich der Ablauf testen.
 */
import { isDuplicate, MAX_AI_CHECKS, rememberRejected, resumeDeadline, type RoundProgress } from '../domain/attempts';

export type { RoundProgress } from '../domain/attempts';
import type { AnswerResult, Mode, Question } from '../domain/types';
import type { ScoreService } from '../services/ScoreService';

export type FeedbackKind =
  | 'invalid' // nicht gültig
  | 'duplicate' // schon versucht
  | 'unchecked' // KI nicht erreichbar – nochmal versuchen erlaubt
  | 'listOnly' // KI-Kontingent der Frage verbraucht
  | 'limited'; // KI-Tageslimit

export interface Feedback {
  /** Zählt hoch – so spielt die Wackel-Animation bei jedem Fehlversuch neu. */
  id: number;
  kind: FeedbackKind;
  input: string;
  /** „Meintest du …?“ */
  hint: string | null;
}

export interface RoundState extends RoundProgress {
  deadline: number;
  /** Der Server wird gefragt: Timer steht, Eingabe gesperrt. */
  checking: boolean;
  feedback: Feedback | null;
  /** Gesetzt, sobald die Frage vorbei ist. */
  result: AnswerResult | null;
}

export const emptyProgress = (): RoundProgress => ({ tried: [], count: 0, aiChecks: 0, listOnly: null });

export class QuestionRound {
  state: RoundState;
  private feedbackId = 0;
  private lastReject: Feedback['kind'] | 'ai' | null = null;

  constructor(
    private readonly question: Question,
    private readonly mode: Mode,
    private readonly scores: Pick<ScoreService, 'attempt' | 'willAsk'>,
    init: { deadline: number } & Partial<RoundProgress>,
    private readonly onChange: (s: RoundState) => void = () => {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.state = { ...emptyProgress(), ...init, tried: [...(init.tried ?? [])], checking: false, feedback: null, result: null };
  }

  private set(patch: Partial<RoundState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private feedback(kind: FeedbackKind, input: string, hint: string | null = null): Feedback {
    return { id: ++this.feedbackId, kind, input, hint };
  }

  get aiLeft(): number {
    return this.state.listOnly ? 0 : Math.max(0, MAX_AI_CHECKS - this.state.aiChecks);
  }

  /** Antwort abschicken. Die Frage läuft weiter, solange nichts gilt. */
  attempt(input: string): Promise<void> {
    return this.run(input, false);
  }

  /** Zeit abgelaufen: Was noch im Feld steht, ist der letzte Versuch; danach ist Schluss. */
  expire(input: string): Promise<void> {
    return this.run(input, true);
  }

  private async run(input: string, final: boolean): Promise<void> {
    const s = this.state;
    if (s.result || s.checking) return;
    const text = input.replace(/\s+/g, ' ').trim();
    if (!text) {
      if (final) this.timeUp('');
      return;
    }
    if (isDuplicate(s.tried, text)) {
      // sofort, ohne Prüfung
      if (final) this.timeUp(text);
      else this.set({ feedback: this.feedback('duplicate', text) });
      return;
    }

    const remote = this.scores.willAsk(this.question, text);
    const pausedAt = this.now();
    const count = s.count + 1;
    if (remote) this.set({ checking: true, count, feedback: null });
    else this.state = { ...this.state, count };

    const outcome = await this.scores.attempt(this.question, text, this.mode, { aiLeft: this.aiLeft, timedOut: final });

    const aiChecks = this.state.aiChecks + (outcome.aiUsed ? 1 : 0);
    const deadline = remote ? resumeDeadline(this.state.deadline, pausedAt, this.now()) : this.state.deadline;

    if (outcome.ok) {
      this.set({ checking: false, deadline, aiChecks, feedback: null, result: { ...outcome.result, attempts: count, rejected: [...this.state.tried] } });
      return;
    }

    // „Nicht geprüft“ darf noch einmal versucht werden – alles andere gilt als versucht
    const tried = outcome.reason === 'unchecked' ? this.state.tried : rememberRejected(this.state.tried, text);
    const listOnly: RoundState['listOnly'] =
      outcome.reason === 'limited' ? 'day' : this.state.listOnly ?? (outcome.reason === 'listOnly' || aiChecks >= MAX_AI_CHECKS ? 'question' : null);
    const kind: FeedbackKind = outcome.reason === 'ai' ? 'invalid' : outcome.reason;
    this.lastReject = outcome.reason;
    this.state = { ...this.state, checking: false, deadline, aiChecks, tried, listOnly };
    if (final) this.timeUp(text);
    else this.set({ feedback: this.feedback(kind, text, outcome.hint) });
  }

  /** Zeit um ohne gültige Antwort: 0 Punkte („Daneben“), die Versuche bleiben sichtbar. */
  private timeUp(lastInput: string) {
    const s = this.state;
    const last = this.lastReject;
    const wasLast = lastInput !== '' && (s.tried.at(-1) === lastInput || last === 'unchecked');
    this.set({
      checking: false,
      feedback: null,
      result: {
        questionId: this.question.id,
        input: lastInput,
        matched: null,
        fuzzy: false,
        frequency: null,
        tier: 'invalid',
        points: 0,
        timedOut: true,
        source: wasLast && last === 'ai' ? 'ai' : 'list',
        ...(wasLast && (last === 'unchecked' || last === 'limited') ? { unchecked: last === 'limited' ? ('limited' as const) : ('error' as const) } : {}),
        attempts: s.count,
        rejected: [...s.tried],
      },
    });
  }
}
