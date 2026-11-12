import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { matchAnswer } from '../domain/matchAnswer';
import { TOPIC_EMOJI, type Mode, type Question } from '../domain/types';
import { TimerBar } from './TimerBar';
import { modeTheme } from './PlayShell';
import { Panel, PxButton } from './px';
import { services } from '../services';

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
  const [sending, setSending] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => services.scores.prepare(), []);

  // Timer stoppt sofort beim Abschicken; die Prüfung (ggf. KI) läuft danach.
  const send = (text: string, timedOut = false) => {
    if (sending) return;
    setSending(true);
    onSubmit(text, timedOut);
  };
  // Lädt nur die KI-Prüfung (nicht in der Liste) – nur dann Ladeanzeige
  const checking = sending && services.scores.canJudge && input.trim() !== '' && !matchAnswer(question, input);

  const hint = useMemo(() => {
    if (compact(input).length < 3) return null;
    const m = matchAnswer(question, input);
    return m && m.distance > 0 ? m.answer.text : null;
  }, [input, question]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
      <Panel tone={theme.panel} className="px-1">
        <TimerBar deadline={deadline} mode={mode} paused={sending} onExpire={() => send(inputRef.current, true)} />
        <p className="mt-3 font-tiny text-xs uppercase opacity-75">
          <span aria-hidden>{TOPIC_EMOJI[question.topic]}</span> {t(`topics.${question.topic}`)}
        </p>
        <h1 className="mt-1 text-[1.6rem] font-bold leading-[1.1] sm:text-3xl">{question.prompt}</h1>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) send(input);
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
            readOnly={sending}
            placeholder={t('game.placeholder')}
            aria-label={t('game.placeholder')}
            className={`${theme.field} min-w-0 flex-1 bg-transparent px-1 text-xl placeholder:opacity-50`}
          />
          <PxButton tone={theme.rare ? 'gold' : theme.primary} type="submit" disabled={!input.trim() || sending} className="text-lg">
            {t('game.submit')}
          </PxButton>
        </form>
        <div className="mt-1 h-6">
          <AnimatePresence>
            {checking && (
              <motion.p key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex items-center gap-2 text-base" role="status">
                <span className="px-loader" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                {t('game.aiChecking')}
              </motion.p>
            )}
            {!sending && hint && (
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setInput(hint)}
                className="text-base underline decoration-dotted underline-offset-4"
              >
                {t('game.didYouMean', { answer: hint })}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </Panel>
    </motion.div>
  );
}
