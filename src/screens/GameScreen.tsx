import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { matchAnswer } from '../domain/matchAnswer';
import { MAX_POINTS, MODE_TIERS, TIERS, pointsToMeters, totalPoints } from '../domain/scoring';
import type { Lang, Mode } from '../domain/types';
import { useGame } from '../game/useGame';
import { CaveScene } from '../components/scene/CaveScene';
import { SkyScene } from '../components/scene/SkyScene';
import { DepthGauge } from '../components/DepthGauge';
import { TimerBar } from '../components/TimerBar';
import { TierReveal } from '../components/TierReveal';
import { TIER_COLOR } from '../components/tierStyle';
import { localeFor } from '../i18n';

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
  const rare = mode === 'rare';
  const results = game.record?.results ?? [];
  const points = totalPoints(results);
  const meters = pointsToMeters(points);
  const progress = points / MAX_POINTS;
  const total = game.questions.length;
  const question = game.questions[game.index];

  // Bereits beendetes Spiel (z. B. nach Reload) direkt zum Ergebnis.
  useEffect(() => {
    if (game.status === 'finished' && !game.lastResult) onFinished();
  }, [game.status, game.lastResult, onFinished]);

  const theme = rare ? 'text-cream' : 'text-[#1d2a52]';
  const card = rare ? 'bg-cave-900/70 ring-1 ring-white/10' : 'bg-white/70 ring-1 ring-white/70';

  return (
    <div className={`relative h-dvh w-full overflow-hidden ${theme}`}>
      {rare ? <CaveScene progress={progress} /> : <SkyScene progress={progress} />}

      <div className="absolute bottom-[8%] right-1 top-[18%] z-10">
        <DepthGauge mode={mode} meters={meters} locale={localeFor(lang)} />
      </div>

      <div className="relative z-20 mx-auto flex h-full max-w-xl flex-col px-4 pb-6 pr-14 pt-[max(1rem,env(safe-area-inset-top))] sm:pr-16">
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onExit}
            className={`rounded-full px-3 py-1.5 text-sm font-medium backdrop-blur ${rare ? 'bg-white/10 hover:bg-white/20' : 'bg-white/50 hover:bg-white/70'}`}
          >
            ← {t('game.back')}
          </button>
          <p className="font-display text-lg font-semibold">
            {t(`modes.${mode}.name`)} {rare ? '⛏️' : '🎈'}
          </p>
          <p className="text-sm tabular-nums opacity-80">
            {total > 0 && game.status !== 'intro' && t('game.question', { n: Math.min(game.index + 1, total), total })}
          </p>
        </header>

        {/* Fortschritts-Punkte */}
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => {
            const r = results[i];
            return (
              <span
                key={i}
                className={`h-2 w-6 rounded-full transition-colors ${r ? '' : rare ? 'bg-white/15' : 'bg-white/50'}`}
                style={r ? { background: TIER_COLOR[r.tier] } : undefined}
              />
            );
          })}
        </div>

        <div className="mt-5">
          <AnimatePresence mode="wait">
            {game.status === 'loading' && (
              <motion.p key="loading" className="text-center opacity-70" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {t('home.loading')}
              </motion.p>
            )}

            {game.status === 'empty' && (
              <motion.div key="empty" className={`rounded-3xl p-6 text-center backdrop-blur-md ${card}`}>
                {t('game.noQuestions')}
              </motion.div>
            )}

            {game.status === 'intro' && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`rounded-3xl p-6 backdrop-blur-md ${card}`}
              >
                <h1 className="font-display text-4xl font-bold">{results.length ? t('home.continue') : t('game.ready')}</h1>
                <p className="mt-2 opacity-80">{t(`modes.${mode}.tagline`)}.</p>
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
                  {rare && (
                    <li className="flex items-center justify-between gap-3 text-sm opacity-80">
                      <span>
                        {TIERS.tooClever.emoji} {t('tiers.tooClever')}
                      </span>
                      <span className="tabular-nums">{TIERS.tooClever.points}</span>
                    </li>
                  )}
                </ul>
                <p className="mt-5 text-sm opacity-75">{t('home.rulesText')}</p>
                <button
                  type="button"
                  onClick={game.startQuestion}
                  autoFocus
                  className={`mt-6 w-full rounded-2xl px-6 py-3.5 text-lg font-semibold transition active:scale-[0.98] ${
                    rare ? 'bg-glow-crystal text-cave-950' : 'bg-balloon text-white'
                  }`}
                >
                  {results.length ? t('home.continue') : t('game.start')}
                </button>
              </motion.div>
            )}

            {game.status === 'question' && question && game.deadline && (
              <QuestionCard
                key={`q-${game.index}`}
                prompt={question.prompt}
                deadline={game.deadline}
                mode={mode}
                card={card}
                onSubmit={game.submit}
                hintFor={(input) => {
                  if (compact(input).length < 3) return null;
                  const m = matchAnswer(question, input);
                  return m && m.distance > 0 ? m.answer.text : null;
                }}
              />
            )}

            {(game.status === 'reveal' || game.status === 'finished') && game.lastResult && question && (
              <TierReveal
                key={`r-${game.index}`}
                result={game.lastResult}
                question={question}
                mode={mode}
                isLast={game.record?.finished ?? false}
                onNext={game.record?.finished ? onFinished : game.startQuestion}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  prompt,
  deadline,
  mode,
  card,
  onSubmit,
  hintFor,
}: {
  prompt: string;
  deadline: number;
  mode: Mode;
  card: string;
  onSubmit: (input: string, timedOut?: boolean) => void;
  hintFor: (input: string) => string | null;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const inputRef = useRef(input);
  inputRef.current = input;
  const hint = useMemo(() => hintFor(input), [input, hintFor]);
  const rare = mode === 'rare';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className={`rounded-3xl p-5 backdrop-blur-md ${card}`}
    >
      <TimerBar deadline={deadline} mode={mode} onExpire={() => onSubmit(inputRef.current, true)} />
      <h1 className="mt-4 font-display text-[1.7rem] font-semibold leading-tight sm:text-3xl">{prompt}</h1>
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
            rare
              ? 'bg-black/40 text-cream ring-white/10 placeholder:text-white/40 focus:ring-glow-crystal'
              : 'bg-white/90 text-[#1d2a52] ring-transparent placeholder:text-[#1d2a52]/40 focus:ring-balloon'
          }`}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className={`rounded-2xl px-5 font-semibold transition active:scale-95 disabled:opacity-40 ${
            rare ? 'bg-glow-crystal text-cave-950' : 'bg-balloon text-white'
          }`}
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
