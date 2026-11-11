import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MAX_POINTS, totalPoints, pointsToMeters } from '../domain/scoring';
import type { Mode } from '../domain/types';
import { services } from '../services';
import { CaveScene } from '../components/scene/CaveScene';
import { SkyScene } from '../components/scene/SkyScene';
import { LanguageToggle } from '../components/LanguageToggle';
import { useCountdown } from '../game/useBerlinDay';
import { currentLang, localeFor } from '../i18n';

/** Startseite: oben Himmel (Aufstieg), unten Höhle (Abstieg). */
export function HomeScreen({ dateKey, onPlay }: { dateKey: string; onPlay: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const countdown = useCountdown();
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <ModeHalf mode="common" dateKey={dateKey} onPlay={onPlay} />
      <ModeHalf mode="rare" dateKey={dateKey} onPlay={onPlay} />

      {/* Horizont mit Titel */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 18 }}
          className="pointer-events-auto mx-auto w-fit rounded-full bg-cream px-6 py-2.5 text-center shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]"
        >
          <h1 className="font-display text-3xl font-bold tracking-tight text-cave-950 sm:text-4xl">
            {t('app.title')}
          </h1>
        </motion.div>
        <p className="mt-2 text-center text-xs font-medium text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
          {t('app.tagline')} · {t('home.nextIn', { time: countdown })}
        </p>
      </div>

      <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          className="rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur"
          aria-expanded={showRules}
        >
          ?
        </button>
        <LanguageToggle />
      </div>

      <AnimatePresence>
        {showRules && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
            onClick={() => setShowRules(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-sm rounded-3xl bg-cream p-6 text-cave-950 shadow-2xl"
            >
              <h2 className="font-display text-2xl font-bold">{t('home.rules')}</h2>
              <p className="mt-3">{t('home.rulesText')}</p>
              <p className="mt-3">
                🎈 <b>{t('modes.common.name')}</b>: {t('modes.common.tagline')}.
              </p>
              <p className="mt-1">
                ⛏️ <b>{t('modes.rare.name')}</b>: {t('modes.rare.tagline')}.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModeHalf({ mode, dateKey, onPlay }: { mode: Mode; dateKey: string; onPlay: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const rare = mode === 'rare';
  const day = services.progress.getDay(mode, dateKey);
  const streak = services.progress.getStreak(mode, dateKey);
  const points = day ? totalPoints(day.results) : 0;
  const meters = pointsToMeters(points);
  const fmt = new Intl.NumberFormat(localeFor(day?.lang ?? currentLang()));

  const action = day?.finished ? t('home.showResult') : day && (day.results.length || day.questionStartedAt) ? t('home.continue') : t('home.play');

  return (
    <button
      type="button"
      onClick={() => onPlay(mode)}
      className={`group relative flex-1 overflow-hidden text-left ${rare ? 'text-cream' : 'text-[#1d2a52]'}`}
      aria-label={`${t(`modes.${mode}.name`)} – ${action}`}
    >
      {rare ? <CaveScene progress={0.5} showLift={false} /> : <SkyScene progress={0.42} showBalloon={false} />}

      <div
        className={`relative z-10 flex h-full flex-col items-center px-6 text-center ${
          rare ? 'justify-start pt-[18%] sm:pt-[12%]' : 'justify-end pb-[18%] sm:pb-[12%]'
        }`}
      >
        {!rare && <BalloonIcon />}
        <h2 className="font-display text-4xl font-bold sm:text-5xl" style={rare ? { textShadow: '0 0 24px rgba(139,233,253,0.55)' } : undefined}>
          {t(`modes.${mode}.name`)}
        </h2>
        <p className="mt-1 max-w-xs text-sm opacity-85 sm:text-base">{t(`modes.${mode}.tagline`)}</p>
        <span
          className={`mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold shadow-lg transition group-hover:scale-105 group-active:scale-95 ${
            rare ? 'bg-glow-crystal text-cave-950 shadow-glow-crystal/30' : 'bg-balloon text-white shadow-balloon/30'
          }`}
        >
          {action}
          {day?.finished && (
            <span className="tabular-nums opacity-80">
              · {rare && meters > 0 ? '−' : ''}
              {fmt.format(meters)} m
            </span>
          )}
        </span>
        <p className="mt-2 h-4 text-xs opacity-75">
          {streak > 0 ? `🔥 ${t('home.streak', { count: streak })}` : day?.finished ? `${points}/${MAX_POINTS}` : ''}
        </p>
        {rare && <PickIcon />}
      </div>
    </button>
  );
}

function BalloonIcon() {
  return (
    <svg viewBox="0 0 100 140" className="mb-3 w-14 animate-bob drop-shadow-lg" aria-hidden>
      <path d="M50 4 C20 4 6 28 6 50 C6 74 30 92 40 104 L60 104 C70 92 94 74 94 50 C94 28 80 4 50 4 Z" fill="#ff7a59" />
      <path d="M50 4 C38 4 32 30 33 52 C34 76 40 92 44 104 L56 104 C60 92 66 76 67 52 C68 30 62 4 50 4 Z" fill="#fff7ec" />
      <path d="M41 104 L43 118 M59 104 L57 118" stroke="#6b4a2b" strokeWidth="2" />
      <rect x="39" y="117" width="22" height="16" rx="2.5" fill="#a0703f" />
    </svg>
  );
}

function PickIcon() {
  return (
    <svg viewBox="0 0 60 60" className="mt-4 w-12 drop-shadow-[0_0_10px_rgba(139,233,253,0.6)]" aria-hidden>
      <path d="M14 52 L40 18" stroke="#c9a77a" strokeWidth="5" strokeLinecap="round" />
      <path d="M21 4 Q48 4 58 31 Q43 15 21 4 Z" fill="#8be9fd" stroke="#e0fbff" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}
