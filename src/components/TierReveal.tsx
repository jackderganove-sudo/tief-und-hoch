import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TIERS, pointsToMeters } from '../domain/scoring';
import type { AnswerResult, Mode, Question } from '../domain/types';
import { TIER_COLOR } from './tierStyle';

/** Große Stufen-Einblendung nach jeder Antwort. */
export function TierReveal({
  result,
  question,
  mode,
  isLast,
  onNext,
}: {
  result: AnswerResult;
  question: Question;
  mode: Mode;
  isLast: boolean;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const tier = TIERS[result.tier];
  const color = TIER_COLOR[result.tier];
  const rare = mode === 'rare';
  const meters = pointsToMeters(result.points);

  const top = question.answers[0];
  const rarest = [...question.answers].filter((a) => !a.tooClever).sort((a, b) => a.baseScore - b.baseScore)[0];

  let detail: string;
  if (result.matched) detail = t('game.countedAs', { answer: result.matched });
  else if (result.timedOut && !result.input.trim()) detail = t('game.timeUp');
  else if (!result.input.trim()) detail = t('game.empty');
  else detail = `„${result.input}“ – ${t('game.invalid')}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`rounded-3xl p-6 text-center shadow-2xl backdrop-blur-md ${
        rare ? 'bg-cave-900/75 ring-1 ring-white/10' : 'bg-white/75 text-[#1d2a52] ring-1 ring-white/60'
      }`}
      style={{ boxShadow: `0 0 60px -12px ${color}` }}
      aria-live="polite"
    >
      <motion.div
        initial={{ scale: 0.3, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.1 }}
        className="text-6xl leading-none"
        aria-hidden
      >
        {tier.emoji}
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, letterSpacing: '0.3em' }}
        animate={{ opacity: 1, letterSpacing: '0.02em' }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mt-3 font-display text-5xl font-bold"
        style={{ color, textShadow: rare ? `0 0 24px ${color}` : undefined }}
      >
        {t(`tiers.${result.tier}`)}
      </motion.h2>
      <p className="mt-1 font-display text-2xl tabular-nums opacity-90">
        {t('game.points', { points: result.points })}
        <span className="ml-2 text-base opacity-70">
          ({rare && meters > 0 ? '−' : '+'}
          {meters} m)
        </span>
      </p>
      {result.tier === 'tooClever' && <p className="mt-2 text-sm opacity-80">{t('tierHints.tooClever')}</p>}
      <p className="mt-4 text-base">{detail}</p>
      <div className="mt-2 space-y-0.5 text-sm opacity-70">
        <p>{t('game.topAnswer', { answer: top.text })}</p>
        {rare && rarest && rarest.text !== result.matched && <p>{t('game.rareAnswer', { answer: rarest.text })}</p>}
      </div>
      <button
        type="button"
        onClick={onNext}
        autoFocus
        className={`mt-6 w-full rounded-2xl px-6 py-3.5 text-lg font-semibold transition active:scale-[0.98] ${
          rare ? 'bg-glow-crystal text-cave-950 hover:brightness-110' : 'bg-balloon text-white hover:brightness-105'
        }`}
      >
        {isLast ? t('game.finish') : t('game.next')}
      </button>
    </motion.div>
  );
}
