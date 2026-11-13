import { useCallback, useEffect, useRef, useState } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { AnswerResult, Lang, Mode, Question, TopicSelection } from '../domain/types';
import { services } from '../services';
import { QuestionRound, type RoundState } from './questionRound';

export type PracticeStatus = 'loading' | 'empty' | 'question' | 'reveal' | 'summary';

interface PracticeState {
  status: PracticeStatus;
  question: Question | null;
  /** Die laufende Frage: Deadline, Versuche, Feedback. */
  round: RoundState | null;
  lastResult: AnswerResult | null;
  results: AnswerResult[];
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Endlos-/Übungsmodus: zufällige Fragen aus den gewählten Themen, bis man
 * aufhört. Nichts davon wird gespeichert – keine Serie, kein Tagesergebnis.
 * Die heutigen Tagesfragen kommen nicht vor, damit die Übung sie nicht verrät.
 */
/** `forcedIds`: nur diese Fragen (Admin-Debug „Frage direkt spielen“). */
export function usePractice(mode: Mode, lang: Lang, topics: TopicSelection, dateKey: string, forcedIds?: string[]) {
  const [state, setState] = useState<PracticeState>({ status: 'loading', question: null, round: null, lastResult: null, results: [] });
  const pool = useRef<Question[]>([]);
  const queue = useRef<Question[]>([]);
  const roundRef = useRef<QuestionRound | null>(null);

  const next = useCallback(() => {
    if (pool.current.length === 0) return;
    if (queue.current.length === 0) queue.current = shuffled(pool.current);
    const question = queue.current.pop()!;
    // Beliebig viele Versuche: Die Frage endet mit der ersten gültigen Antwort oder dem Zeitablauf
    const round = new QuestionRound(question, mode, services.scores, { deadline: Date.now() + SECONDS_PER_QUESTION * 1000 }, (rs) => {
      if (roundRef.current !== round) return;
      const result = rs.result;
      if (!result) return setState((s) => ({ ...s, round: rs }));
      roundRef.current = null;
      // Auch Übungsantworten speichern (is_practice) – für den Admin und spätere Auswertungen
      void services.scores.submit({ dateKey, lang, mode, questionId: question.id, result, practice: true });
      setState((prev) => ({ ...prev, status: 'reveal', round: null, lastResult: result, results: [...prev.results, result] }));
    });
    roundRef.current = round;
    setState((s) => ({ ...s, status: 'question', question, round: round.state, lastResult: null }));
  }, [mode, lang, dateKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (forcedIds?.length) {
        const forced = await services.questions.getQuestionsByIds(forcedIds, lang);
        if (cancelled) return;
        pool.current = forced;
        queue.current = [];
        if (forced.length === 0) setState((s) => ({ ...s, status: 'empty' }));
        else next();
        return;
      }
      const [rare, common] = await Promise.all([
        services.questions.getDailyQuestions(dateKey, lang, 'rare'),
        services.questions.getDailyQuestions(dateKey, lang, 'common'),
      ]);
      const questions = await services.questions.getQuestions({
        lang,
        mode,
        topics,
        excludeIds: [...rare, ...common].map((q) => q.id),
      });
      if (cancelled) return;
      pool.current = questions;
      queue.current = [];
      if (questions.length === 0) setState((s) => ({ ...s, status: 'empty' }));
      else next();
    })();
    return () => {
      cancelled = true;
      roundRef.current = null;
    };
    // topics ist pro Sitzung fest; bewusst nicht als Abhängigkeit (Array-Identität).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lang, dateKey, next]);

  const attempt = useCallback((input: string) => void roundRef.current?.attempt(input), []);
  const expire = useCallback((input: string) => void roundRef.current?.expire(input), []);

  const finish = useCallback(() => {
    roundRef.current = null;
    setState((s) => ({ ...s, status: 'summary', round: null }));
  }, []);

  return { ...state, poolSize: pool.current.length, next, attempt, expire, finish };
}
