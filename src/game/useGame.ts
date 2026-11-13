import { useCallback, useEffect, useRef, useState } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { AnswerResult, Lang, Mode, Question } from '../domain/types';
import { services, type DayRecord } from '../services';
import { QuestionRound, type RoundState } from './questionRound';

export type GameStatus = 'loading' | 'empty' | 'intro' | 'question' | 'reveal' | 'finished';

export interface GameState {
  status: GameStatus;
  questions: Question[];
  record: DayRecord | null;
  /** Index der aktuellen (bzw. zuletzt beantworteten) Frage. */
  index: number;
  lastResult: AnswerResult | null;
  /** Die laufende Frage: Deadline, Versuche, Feedback (null außerhalb der Fragephase). */
  round: RoundState | null;
}

const QUESTION_MS = SECONDS_PER_QUESTION * 1000;

/**
 * Ablauf eines Tagesspiels: laden → Intro → Frage → Auflösung → … → fertig.
 * Jeder Schritt wird sofort gespeichert; nach einem Reload geht es an derselben
 * Stelle weiter, und der Timer einer offenen Frage läuft dabei weiter.
 *
 * Pro Frage beliebig viele Versuche (siehe QuestionRound): Sie endet mit der ersten
 * gültigen Antwort oder mit dem Ablauf der Zeit.
 */
export function useGame(mode: Mode, dateKey: string, lang: Lang) {
  const [state, setState] = useState<GameState>({
    status: 'loading',
    questions: [],
    record: null,
    index: 0,
    lastResult: null,
    round: null,
  });
  const roundRef = useRef<QuestionRound | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Frage ist vorbei (gültige Antwort oder Zeit um): werten, speichern, Auflösung zeigen. */
  const finishQuestion = useCallback(
    (question: Question, result: AnswerResult) => {
      const s = stateRef.current;
      if (s.status !== 'question' || !s.record) return;
      const results = [...s.record.results, result];
      const finished = results.length >= s.record.questionIds.length;
      const record: DayRecord = { ...s.record, results, questionStartedAt: null, round: undefined, finished };

      services.progress.saveDay(record);
      if (finished) services.progress.recordFinished(record);
      void services.scores.submit({ dateKey: record.dateKey, lang: record.lang, mode, questionId: question.id, result });
      roundRef.current = null;
      setState({ ...s, status: 'reveal', record, index: results.length - 1, lastResult: result, round: null });
    },
    [mode],
  );

  /** Frage starten bzw. nach einem Reload fortsetzen. */
  const beginRound = useCallback(
    (question: Question, init: ConstructorParameters<typeof QuestionRound>[3]): RoundState => {
      const round = new QuestionRound(question, mode, services.scores, init, (rs) => {
        if (roundRef.current !== round) return;
        if (rs.result) return finishQuestion(question, rs.result);
        const s = stateRef.current;
        if (!s.record) return;
        let record = s.record;
        if (!rs.checking) {
          // Versuche, KI-Kontingent und die (durch KI-Pausen verschobene) Startzeit merken
          record = { ...record, questionStartedAt: rs.deadline - QUESTION_MS, round: { tried: rs.tried, unchecked: rs.unchecked, count: rs.count, aiChecks: rs.aiChecks, listOnly: rs.listOnly } };
          services.progress.saveDay(record);
        }
        setState({ ...s, record, round: rs });
      });
      roundRef.current = round;
      return round.state;
    },
    [mode, finishQuestion],
  );

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
          round: null,
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
        setState({ status: 'finished', questions, record, index, lastResult: null, round: null });
      } else if (record.questionStartedAt !== null && questions[index]) {
        const round = beginRound(questions[index], { deadline: record.questionStartedAt + QUESTION_MS, ...record.round });
        setState({ status: 'question', questions, record, index, lastResult: null, round });
      } else {
        setState({ status: 'intro', questions, record, index, lastResult: null, round: null });
      }
    })();
    return () => {
      cancelled = true;
      roundRef.current = null;
    };
  }, [mode, dateKey, lang, beginRound]);

  /** Nächste Frage starten (aus Intro oder Auflösung heraus). */
  const startQuestion = useCallback(() => {
    const s = stateRef.current;
    if (!s.record || s.record.finished) return;
    const question = s.questions[s.record.results.length];
    if (!question) return;
    const now = Date.now();
    const record: DayRecord = { ...s.record, questionStartedAt: now, round: undefined };
    services.progress.saveDay(record);
    const round = beginRound(question, { deadline: now + QUESTION_MS });
    setState({ ...s, status: 'question', record, index: record.results.length, lastResult: null, round });
  }, [beginRound]);

  /** Antwort abschicken – bei „ungültig“ läuft die Frage weiter. */
  const attempt = useCallback((input: string) => void roundRef.current?.attempt(input), []);
  /** Zeit abgelaufen: Was noch im Feld steht, ist der letzte Versuch. */
  const expire = useCallback((input: string) => void roundRef.current?.expire(input), []);

  return { ...state, startQuestion, attempt, expire };
}
