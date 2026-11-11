import { useCallback, useEffect, useRef, useState } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { AnswerResult, Lang, Mode, Question } from '../domain/types';
import { services, type DayRecord } from '../services';

export type GameStatus = 'loading' | 'empty' | 'intro' | 'question' | 'reveal' | 'finished';

export interface GameState {
  status: GameStatus;
  questions: Question[];
  record: DayRecord | null;
  /** Index der aktuellen (bzw. zuletzt beantworteten) Frage. */
  index: number;
  lastResult: AnswerResult | null;
  /** Zeitpunkt (ms), an dem die aktuelle Frage abläuft. */
  deadline: number | null;
}

const QUESTION_MS = SECONDS_PER_QUESTION * 1000;

/**
 * Ablauf eines Tagesspiels: laden → Intro → Frage → Auflösung → … → fertig.
 * Jeder Schritt wird sofort gespeichert; nach einem Reload geht es an derselben
 * Stelle weiter, und der Timer einer offenen Frage läuft dabei weiter.
 */
export function useGame(mode: Mode, dateKey: string, lang: Lang) {
  const [state, setState] = useState<GameState>({
    status: 'loading',
    questions: [],
    record: null,
    index: 0,
    lastResult: null,
    deadline: null,
  });
  const submitting = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = services.progress.getDay(mode, dateKey);
      const questions = existing
        ? await services.questions.getQuestionsByIds(existing.questionIds, existing.lang)
        : await services.questions.getDailyQuestions(dateKey, lang, mode);
      if (cancelled) return;

      // Gespeicherter Stand verweist auf Fragen, die es nicht mehr gibt (Datenstand geändert):
      // Ein laufendes Spiel beginnt neu, ein beendetes bleibt als Ergebnis stehen.
      if (existing && !existing.finished && questions.length !== existing.questionIds.length) {
        services.progress.clearDay(mode, dateKey);
        const fresh = await services.questions.getDailyQuestions(dateKey, lang, mode);
        if (cancelled) return;
        if (fresh.length === 0) {
          setState((s) => ({ ...s, status: 'empty' }));
          return;
        }
        setState({
          status: 'intro',
          questions: fresh,
          record: { dateKey, mode, lang, questionIds: fresh.map((q) => q.id), results: [], questionStartedAt: null, finished: false },
          index: 0,
          lastResult: null,
          deadline: null,
        });
        return;
      }

      if (questions.length === 0 && !existing?.finished) {
        setState((s) => ({ ...s, status: 'empty' }));
        return;
      }

      const record: DayRecord = existing ?? {
        dateKey,
        mode,
        lang,
        questionIds: questions.map((q) => q.id),
        results: [],
        questionStartedAt: null,
        finished: false,
      };
      const index = record.results.length;

      if (record.finished) {
        setState({ status: 'finished', questions, record, index, lastResult: null, deadline: null });
      } else if (record.questionStartedAt !== null) {
        setState({
          status: 'question',
          questions,
          record,
          index,
          lastResult: null,
          deadline: record.questionStartedAt + QUESTION_MS,
        });
      } else {
        setState({ status: 'intro', questions, record, index, lastResult: null, deadline: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, dateKey, lang]);

  /** Nächste Frage starten (aus Intro oder Auflösung heraus). */
  const startQuestion = useCallback(() => {
    const s = stateRef.current;
    if (!s.record || s.record.finished) return;
    const now = Date.now();
    const record: DayRecord = { ...s.record, questionStartedAt: now };
    services.progress.saveDay(record);
    submitting.current = false;
    setState({
      ...s,
      status: 'question',
      record,
      index: record.results.length,
      lastResult: null,
      deadline: now + QUESTION_MS,
    });
  }, []);

  const submit = useCallback(async (input: string, timedOut = false) => {
    const s = stateRef.current;
    if (s.status !== 'question' || !s.record || submitting.current) return;
    submitting.current = true;

    const question = s.questions[s.record.results.length];
    const result = await services.scores.evaluate(question, input, mode, { timedOut });
    const results = [...s.record.results, result];
    const finished = results.length >= s.record.questionIds.length;
    const record: DayRecord = { ...s.record, results, questionStartedAt: null, finished };

    services.progress.saveDay(record);
    if (finished) services.progress.recordFinished(record);
    void services.scores.submit({
      dateKey: record.dateKey,
      lang: record.lang,
      mode,
      questionId: question.id,
      answerText: result.matched,
    });

    setState({ ...s, status: 'reveal', record, index: results.length - 1, lastResult: result, deadline: null });
  }, [mode]);

  return { ...state, startQuestion, submit };
}
