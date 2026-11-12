import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MODE_TIERS, TIERS, pointsToMeters, totalPoints } from '../domain/scoring';
import type { Lang, Mode } from '../domain/types';
import { useGame } from '../game/useGame';
import { PlayShell, modeTheme } from '../components/PlayShell';
import { QuestionCard } from '../components/QuestionCard';
import { TierReveal } from '../components/TierReveal';
import { TIER_COLOR } from '../components/tierStyle';
import { localeFor } from '../i18n';

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

  // Bereits beendetes Spiel (z. B. nach Reload) direkt zum Ergebnis.
  useEffect(() => {
    if (game.status === 'finished' && !game.lastResult) onFinished();
  }, [game.status, game.lastResult, onFinished]);

  return (
    <PlayShell
      mode={mode}
      meters={pointsToMeters(totalPoints(results))}
      locale={localeFor(lang)}
      title={`${t(`modes.${mode}.name`)} ${theme.rare ? '⛏️' : '🎈'}`}
      backLabel={t('game.back')}
      onBack={onExit}
      fx={game.lastResult ? { key: results.length, tier: game.lastResult.tier, points: game.lastResult.points } : null}
      info={total > 0 && game.status !== 'intro' && t('game.question', { n: Math.min(game.index + 1, total), total })}
      strip={
        <div className="flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => {
            const r = results[i];
            return (
              <span
                key={i}
                className={`h-2 w-6 rounded-full transition-colors ${r ? '' : theme.rare ? 'bg-white/15' : 'bg-white/50'}`}
                style={r ? { background: TIER_COLOR[r.tier] } : undefined}
              />
            );
          })}
        </div>
      }
    >
      <AnimatePresence mode="wait">
        {game.status === 'loading' && (
          <motion.p key="loading" className="text-center opacity-70" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {t('home.loading')}
          </motion.p>
        )}

        {game.status === 'empty' && (
          <motion.div key="empty" className={`rounded-3xl p-6 text-center backdrop-blur-md ${theme.card}`}>
            {t('game.noQuestions')}
          </motion.div>
        )}

        {game.status === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`rounded-3xl p-6 backdrop-blur-md ${theme.card}`}
          >
            <h1 className="font-display text-4xl font-bold">{results.length ? t('home.continue') : t('game.ready')}</h1>
            <p className="mt-2 opacity-80">{t(`modes.${mode}.tagline`)}.</p>
            <TierLegend mode={mode} />
            <p className="mt-5 text-sm opacity-75">{t('home.rulesText')}</p>
            <button
              type="button"
              onClick={game.startQuestion}
              autoFocus
              className={`mt-6 w-full rounded-2xl px-6 py-3.5 text-lg font-semibold transition active:scale-[0.98] ${theme.primary}`}
            >
              {results.length ? t('home.continue') : t('game.start')}
            </button>
          </motion.div>
        )}

        {game.status === 'question' && question && game.deadline && (
          <QuestionCard key={`q-${game.index}`} question={question} deadline={game.deadline} mode={mode} onSubmit={game.submit} />
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
    </PlayShell>
  );
}

/** Stufen-Legende mit Punkten. */
export function TierLegend({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-5 space-y-1.5">
      {[...MODE_TIERS[mode]].reverse().map((id) => (
        <li key={id} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span aria-hidden>{TIERS[id].emoji}</span>
            <span className="font-semibold" style={{ color: TIER_COLOR[id] }}>
              {t(`tiers.${id}`)}
            </span>
          </span>
          <span className="tabular-nums opacity-80">{TIERS[id].points}</span>
        </li>
      ))}
      {mode === 'rare' && (
        <li className="flex items-center justify-between gap-3 text-sm opacity-80">
          <span>
            {TIERS.tooClever.emoji} {t('tiers.tooClever')}
          </span>
          <span className="tabular-nums">{TIERS.tooClever.points}</span>
        </li>
      )}
    </ul>
  );
}
