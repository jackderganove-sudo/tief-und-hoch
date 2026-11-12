import { useCallback, useEffect, useRef, useState } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { AnswerResult, Lang, Mode, Question, TopicSelection } from '../domain/types';
import { services } from '../services';

export type PracticeStatus = 'loading' | 'empty' | 'question' | 'reveal' | 'summary';

interface PracticeState {
  status: PracticeStatus;
  question: Question | null;
  deadline: number | null;
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
export function usePractice(mode: Mode, lang: Lang, topics: TopicSelection, dateKey: string) {
  const [state, setState] = useState<PracticeState>({ status: 'loading', question: null, deadline: null, lastResult: null, results: [] });
  const pool = useRef<Question[]>([]);
  const queue = useRef<Question[]>([]);
  const submitting = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const next = useCallback(() => {
    if (pool.current.length === 0) return;
    if (queue.current.length === 0) queue.current = shuffled(pool.current);
    const question = queue.current.pop()!;
    submitting.current = false;
    setState((s) => ({ ...s, status: 'question', question, deadline: Date.now() + SECONDS_PER_QUESTION * 1000, lastResult: null }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    };
    // topics ist pro Sitzung fest; bewusst nicht als Abhängigkeit (Array-Identität).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lang, dateKey, next]);

  const submit = useCallback(
    async (input: string, timedOut = false) => {
      const s = stateRef.current;
      if (s.status !== 'question' || !s.question || submitting.current) return;
      submitting.current = true;
      const result = await services.scores.evaluate(s.question, input, mode, { timedOut });
      // Auch Übungsantworten speichern (is_practice) – für den Admin und spätere Auswertungen
      void services.scores.submit({ dateKey, lang, mode, questionId: s.question.id, result, practice: true });
      setState((prev) => ({ ...prev, status: 'reveal', deadline: null, lastResult: result, results: [...prev.results, result] }));
    },
    [mode, lang, dateKey],
  );

  const finish = useCallback(() => setState((s) => ({ ...s, status: 'summary', deadline: null })), []);

  return { ...state, poolSize: pool.current.length, next, submit, finish };
}
