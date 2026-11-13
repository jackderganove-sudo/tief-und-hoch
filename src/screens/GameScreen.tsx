import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MODE_TIERS, TIERS, pointsToMeters, totalPoints } from '../domain/scoring';
import type { AnswerResult, Lang, Mode } from '../domain/types';
import { useGame } from '../game/useGame';
import { PlayShell, modeTheme } from '../components/PlayShell';
import { QuestionCard } from '../components/QuestionCard';
import { TierReveal } from '../components/TierReveal';
import { TIER_COLOR } from '../components/tierStyle';
import { Panel, PxButton, TierIcon } from '../components/px';
import { localeFor } from '../i18n';
import { MilestoneCelebration, useMilestone } from '../components/MilestoneCelebration';

/** Tagesspiel: 7 Fragen, einmal pro Tag und Modus. */
export function GameScreen({
  mode,
  dateKey,
  lang,
  onExit,
  onFinished,
}: {
  mode: Mode;
  dateKey: string;
  lang: Lang;
  onExit: () => void;
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const game = useGame(mode, dateKey, lang);
  const theme = modeTheme(mode);
  const results = game.record?.results ?? [];
  const total = game.record?.questionIds.length ?? 0;
  const question = game.questions[game.index];
  const finished = game.record?.finished ?? false;
  const meters = pointsToMeters(totalPoints(results));
  const { milestone, dismiss } = useMilestone(mode, meters, { daily: true, dateKey });

  // Bereits beendetes Spiel (z. B. nach Reload) direkt zum Ergebnis.
  useEffect(() => {
    if (game.status === 'finished' && !game.lastResult) onFinished();
  }, [game.status, game.lastResult, onFinished]);

  return (
    <PlayShell
      mode={mode}
      meters={meters}
      locale={localeFor(lang)}
      title={`${t(`modes.${mode}.name`)}`}
      backLabel={t('game.back')}
      onBack={onExit}
      fx={game.lastResult ? { key: results.length, tier: game.lastResult.tier, points: game.lastResult.points } : null}
      info={total > 0 && game.status !== 'intro' && `${Math.min(game.index + 1, total)}/${total}`}
      strip={<ProgressSlots total={total} results={results} mode={mode} />}
    >
      <AnimatePresence mode="wait">
        {game.status === 'loading' && (
          <motion.p key="loading" className="text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {t('home.loading')}
          </motion.p>
        )}

        {game.status === 'empty' && (
          <motion.div key="empty">
            <Panel tone={theme.panel} className="text-center">
              {t('game.noQuestions')}
            </Panel>
          </motion.div>
        )}

        {game.status === 'intro' && (
          <motion.div key="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <Panel tone={theme.panel} className="px-1">
              <h1 className="text-4xl font-bold leading-none">{results.length ? t('home.continue') : t('game.ready')}</h1>
              <p className="mt-2 text-lg leading-tight">{t(`modes.${mode}.tagline`)}.</p>
              <TierLegend mode={mode} />
              <p className="mt-4 text-base leading-snug opacity-85">{t('home.rulesText')}</p>
              <PxButton tone={theme.rare ? 'gold' : theme.primary} onClick={game.startQuestion} autoFocus className="mt-4 w-full text-xl">
                {results.length ? t('home.continue') : t('game.start')}
              </PxButton>
            </Panel>
          </motion.div>
        )}

        {game.status === 'question' && question && game.round && (
          <QuestionCard key={`q-${game.index}`} question={question} round={game.round} mode={mode} onAttempt={game.attempt} onExpire={game.expire} />
        )}

        {(game.status === 'reveal' || game.status === 'finished') && game.lastResult && question && (
          <TierReveal
            key={`r-${game.index}`}
            result={game.lastResult}
            question={question}
            mode={mode}
            nextLabel={finished ? t('game.finish') : t('game.next')}
            onNext={finished ? onFinished : game.startQuestion}
          />
        )}
      </AnimatePresence>
      <MilestoneCelebration milestone={milestone} onClose={dismiss} />
    </PlayShell>
  );
}

/** 7 Felder: leer, oder das Icon der erreichten Stufe. */
function ProgressSlots({ total, results, mode }: { total: number; results: AnswerResult[]; mode: Mode }) {
  const dark = mode === 'rare';
  return (
    <div className="flex justify-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const r = results[i];
        return (
          <span key={i} className={`px-field ${dark ? 'px-field-dark' : 'px-field-light'} grid size-11 place-items-center [--px:2px]`}>
            {r ? <TierIcon tier={r.tier} scale={2} /> : <span className="size-1.5 bg-current opacity-30" />}
          </span>
        );
      })}
    </div>
  );
}

/** Stufen-Legende mit Punkten. */
export function TierLegend({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const rare = mode === 'rare';
  return (
    <ul className="mt-4 space-y-1">
      {[...MODE_TIERS[mode]].reverse().map((id) => (
        <li key={id} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <TierIcon tier={id} scale={2} />
            <span className="text-lg font-bold" style={{ color: TIER_COLOR[id], textShadow: rare ? '1px 1px 0 #0e0a16' : undefined }}>
              {t(`tiers.${id}`)}
            </span>
          </span>
          <span className="text-lg tabular-nums">{TIERS[id].points}</span>
        </li>
      ))}
      {rare && (
        <li className="flex items-center justify-between gap-3 opacity-85">
          <span className="flex items-center gap-2">
            <TierIcon tier="tooClever" scale={2} />
            <span className="text-base">{t('tiers.tooClever')}</span>
          </span>
          <span className="tabular-nums">{TIERS.tooClever.points}</span>
        </li>
      )}
    </ul>
  );
}
