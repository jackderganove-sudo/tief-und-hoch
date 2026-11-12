import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { pointsToMeters } from '../domain/scoring';
import type { AnswerResult, Mode, Question } from '../domain/types';
import { TIER_COLOR } from './tierStyle';
import { localeFor } from '../i18n';
import { modeTheme } from './PlayShell';
import { Panel, PxButton, TierIcon } from './px';
import { AiBadge } from './AiBadge';
import { isApprovedResult } from '../domain/approved';

/** Stufen-Einblendung nach jeder Antwort – kompakt, damit die Fahrt darunter sichtbar bleibt. */
export function TierReveal({
  result,
  question,
  mode,
  nextLabel,
  onNext,
  secondaryLabel,
  onSecondary,
}: {
  result: AnswerResult;
  question: Question;
  mode: Mode;
  nextLabel: string;
  onNext: () => void;
  /** Optionaler zweiter Knopf (Übungsmodus: "Beenden"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const fmt = new Intl.NumberFormat(localeFor(i18n.language === 'en' ? 'en' : 'de'));
  const theme = modeTheme(mode);
  const color = TIER_COLOR[result.tier];
  const rare = mode === 'rare';
  const meters = pointsToMeters(result.points);

  const top = question.answers[0];
  const rarest = [...question.answers].filter((a) => !a.tooClever).sort((a, b) => a.baseScore - b.baseScore)[0];

  const ai = result.source === 'ai';

  // KI-Badge nur bei von der KI akzeptierten Antworten, direkt hinter der Antwort; Erklärung als Tooltip
  const badge = ai && result.matched && !isApprovedResult(question, result) ? <AiBadge mode={mode} /> : null;

  let detail: React.ReactNode;
  if (result.matched) detail = <>{t('game.countedAs', { answer: result.matched })}{badge}</>;
  else if (result.timedOut && !result.input.trim()) detail = t('game.timeUp');
  else if (!result.input.trim()) detail = t('game.empty');
  else if (result.unchecked) detail = `„${result.input}“ – ${t(result.unchecked === 'limited' ? 'game.uncheckedLimit' : 'game.unchecked')}`;
  else if (ai) detail = `„${result.input}“ – ${t('game.aiRejected')}`;
  else detail = `„${result.input}“ – ${t('game.invalid')}`;


  return (
    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22 }} aria-live="polite">
      <Panel tone={theme.panel} className="px-1 text-center">
        <div className="flex items-center justify-center gap-3">
          <motion.span initial={{ y: -10 }} animate={{ y: [-10, 0, -4, 0] }} transition={{ duration: 0.5, times: [0, 0.5, 0.75, 1] }}>
            <TierIcon tier={result.tier} scale={3} />
          </motion.span>
          <div className="text-left">
            <h2 className="text-4xl font-bold leading-none" style={{ color, textShadow: rare ? '2px 2px 0 #0e0a16' : '2px 2px 0 rgba(58,36,22,0.25)' }}>
              {t(`tiers.${result.tier}`)}
            </h2>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {t('game.points', { points: result.points })}{' '}
              <span className="text-base font-normal opacity-75">
                ({rare && meters > 0 ? '−' : '+'}
                {fmt.format(meters)} m)
              </span>
            </p>
          </div>
        </div>
        {result.tier === 'tooClever' && <p className="mt-2 text-sm opacity-85">{t('tierHints.tooClever')}</p>}
        <p className="mt-3 text-lg leading-tight">{detail}</p>
        <div className="mt-1 text-sm leading-snug opacity-75">
          <p>{t('game.topAnswer', { answer: top.text })}</p>
          {rare && rarest && rarest.text !== result.matched && <p>{t('game.rareAnswer', { answer: rarest.text })}</p>}
        </div>
        <PxButton tone={theme.rare ? 'gold' : theme.primary} onClick={onNext} autoFocus className="mt-4 w-full text-xl">
          {nextLabel}
        </PxButton>
        {secondaryLabel && onSecondary && (
          <button type="button" onClick={onSecondary} className="mt-2 w-full py-1 text-base underline decoration-dotted underline-offset-4 opacity-85">
            {secondaryLabel}
          </button>
        )}
      </Panel>
    </motion.div>
  );
}

