import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { matchAnswer } from '../domain/matchAnswer';
import { TOPIC_EMOJI, type Mode, type Question } from '../domain/types';
import type { RoundState } from '../game/questionRound';
import { TimerBar } from './TimerBar';
import { modeTheme } from './PlayShell';
import { Panel } from './px';
import { AttemptInput } from './AttemptInput';
import { services } from '../services';

/**
 * Frage mit Timer und Eingabe. Falsche Antworten beenden die Frage nicht – man gibt neu ein,
 * bis eine Antwort gilt oder die Zeit abläuft. Während einer KI-Prüfung steht der Timer.
 */
export function QuestionCard({
  question,
  round,
  mode,
  onAttempt,
  onExpire,
}: {
  question: Question;
  round: RoundState;
  mode: Mode;
  onAttempt: (input: string) => void;
  /** Zeit abgelaufen – bekommt, was noch im Feld steht (letzter Versuch) */
  onExpire: (input: string) => void;
}) {
  const { t } = useTranslation();
  const theme = modeTheme(mode);
  const typed = useRef('');

  useEffect(() => services.scores.prepare(), []);

  const note = round.listOnly === 'day' ? t('game.listOnlyDay') : round.listOnly === 'question' ? t('game.listOnly') : null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} data-world-quiet>
      <Panel tone={theme.panel} className="px-1">
        <TimerBar deadline={round.deadline} mode={mode} paused={round.checking} onExpire={() => onExpire(typed.current)} />
        <p className="mt-3 font-tiny text-xs uppercase opacity-75">
          <span aria-hidden>{TOPIC_EMOJI[question.topic]}</span> {t(`topics.${question.topic}`)}
        </p>
        <h1 className="mt-1 text-[1.6rem] font-bold leading-[1.1] sm:text-3xl [@media(max-height:520px)]:text-[1.35rem]">{question.prompt}</h1>
        <AttemptInput
          mode={mode}
          checking={round.checking}
          feedback={round.feedback}
          tried={round.tried}
          note={note}
          valueRef={typed}
          onSubmit={onAttempt}
          liveHint={(input) => {
            if (compact(input).length < 3) return null;
            const m = matchAnswer(question, input);
            return m && m.distance > 0 ? m.answer.text : null;
          }}
        />
      </Panel>
    </motion.div>
  );
}
