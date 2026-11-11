import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { matchAnswer } from '../domain/matchAnswer';
import { TOPIC_EMOJI, type Mode, type Question } from '../domain/types';
import { TimerBar } from './TimerBar';
import { modeTheme } from './PlayShell';

/** Frage mit Timer, Eingabefeld und "Gemeint: …?"-Hinweis. */
export function QuestionCard({
  question,
  deadline,
  mode,
  onSubmit,
}: {
  question: Question;
  deadline: number;
  mode: Mode;
  onSubmit: (input: string, timedOut?: boolean) => void;
}) {
  const { t } = useTranslation();
  const theme = modeTheme(mode);
  const [input, setInput] = useState('');
  const inputRef = useRef(input);
  inputRef.current = input;

  const hint = useMemo(() => {
    if (compact(input).length < 3) return null;
    const m = matchAnswer(question, input);
    return m && m.distance > 0 ? m.answer.text : null;
  }, [input, question]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className={`rounded-3xl p-5 backdrop-blur-md ${theme.card}`}
    >
      <TimerBar deadline={deadline} mode={mode} onExpire={() => onSubmit(inputRef.current, true)} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
        <span aria-hidden>{TOPIC_EMOJI[question.topic]}</span> {t(`topics.${question.topic}`)}
      </p>
      <h1 className="mt-1 font-display text-[1.7rem] font-semibold leading-tight sm:text-3xl">{question.prompt}</h1>
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) onSubmit(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={60}
          placeholder={t('game.placeholder')}
          aria-label={t('game.placeholder')}
          className={`min-w-0 flex-1 rounded-2xl px-4 py-3 text-lg outline-none ring-2 transition ${
            theme.rare
              ? 'bg-black/40 text-cream ring-white/10 placeholder:text-white/40 focus:ring-glow-crystal'
              : 'bg-white/90 text-[#1d2a52] ring-transparent placeholder:text-[#1d2a52]/40 focus:ring-balloon'
          }`}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className={`rounded-2xl px-5 font-semibold transition active:scale-95 disabled:opacity-40 ${theme.primary}`}
        >
          {t('game.submit')}
        </button>
      </form>
      <div className="mt-2 h-6">
        <AnimatePresence>
          {hint && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={() => setInput(hint)}
              className="text-sm underline decoration-dotted underline-offset-4 opacity-85"
            >
              {t('game.didYouMean', { answer: hint })}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
