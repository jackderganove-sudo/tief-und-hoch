import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { MAX_POINTS, totalPoints, pointsToMeters } from '../domain/scoring';
import type { Mode } from '../domain/types';
import { services } from '../services';
import { PixelWorld } from '../pixel/PixelWorld';
import { LanguageToggle } from '../components/LanguageToggle';
import { Panel, PxButton } from '../components/px';
import { useCountdown } from '../game/useBerlinDay';
import { currentLang, localeFor } from '../i18n';
import { InstallHint } from '../pwa/InstallHint';

/**
 * Startseite: Querschnitt der Welt – oben Himmel mit Ballon, unten der
 * Höhleneingang mit dem Forscher. Wahl zwischen Aufstieg und Abstieg.
 */
export function HomeScreen({
  dateKey,
  onPlay,
  onPractice,
}: {
  dateKey: string;
  onPlay: (mode: Mode) => void;
  onPractice: () => void;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown();
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PixelWorld view="home" />

      <div className="absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <PxButton tone="wood" small onClick={onPractice} className="text-base">
          ∞ {t('practice.name')}
        </PxButton>
        <div className="flex gap-1">
          <PxButton tone="wood" small onClick={() => setShowRules(true)} aria-label={t('home.rules')} className="text-base">
            ?
          </PxButton>
          <LanguageToggle />
        </div>
      </div>

      {/* Titel-Schild oben im Himmel */}
      <div className="absolute inset-x-0 top-[9%] z-20 flex flex-col items-center px-4">
        <Panel tone="wood" className="px-2 text-center">
          <h1 className="text-4xl font-bold leading-none sm:text-5xl">{t('app.title')}</h1>
          <p className="mt-1 text-sm leading-tight sm:text-base">{t('app.tagline')}</p>
        </Panel>
      </div>

      {/* Querschnitt: Ballon steht rechts auf der Wiese, der Schacht liegt links.
          Aufstieg links neben dem Ballon im Himmel, Abstieg rechts neben dem Schacht in der Höhle. */}
      <div className="absolute bottom-[47%] left-0 z-20 w-[60%] max-w-xs pl-3">
        <ModeChoice mode="common" dateKey={dateKey} onPlay={onPlay} />
      </div>
      <div className="absolute right-0 top-[60%] z-20 w-[60%] max-w-xs pr-3">
        <ModeChoice mode="rare" dateKey={dateKey} onPlay={onPlay} />
      </div>

      <p className="absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 text-center text-sm text-[#f3e2bb] px-shadow">
        {t('home.nextIn', { time: countdown })}
      </p>

      <AnimatePresence>
        {showRules && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 grid place-items-center bg-[#0e0a16]/70 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]"
            onClick={() => setShowRules(false)}
          >
            <motion.div initial={{ y: 12 }} animate={{ y: 0 }} className="max-h-full max-w-sm overflow-y-auto">
              <Panel tone="wood" className="px-1">
                <h2 className="text-3xl font-bold">{t('home.rules')}</h2>
                <p className="mt-2 text-lg leading-snug">{t('home.rulesText')}</p>
                <p className="mt-3 text-lg leading-snug">
                  ▲ <b>{t('modes.common.name')}</b>: {t('modes.common.tagline')}.
                </p>
                <p className="mt-1 text-lg leading-snug">
                  ▼ <b>{t('modes.rare.name')}</b>: {t('modes.rare.tagline')}.
                </p>
                <p className="mt-1 text-lg leading-snug">
                  ∞ <b>{t('practice.name')}</b>: {t('practice.intro')}
                </p>
                <InstallHint />
              </Panel>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModeChoice({ mode, dateKey, onPlay }: { mode: Mode; dateKey: string; onPlay: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const rare = mode === 'rare';
  const day = services.progress.getDay(mode, dateKey);
  const streak = services.progress.getStreak(mode, dateKey);
  const points = day ? totalPoints(day.results) : 0;
  const meters = pointsToMeters(points);
  const fmt = new Intl.NumberFormat(localeFor(day?.lang ?? currentLang()));
  const action = day?.finished ? t('home.showResult') : day && (day.results.length || day.questionStartedAt) ? t('home.continue') : t('home.play');
  const status = day?.finished
    ? `${rare && meters > 0 ? '−' : ''}${fmt.format(meters)} m · ${points}/${MAX_POINTS}`
    : streak > 0
      ? `🔥 ${t('home.streak', { count: streak })}`
      : t(`modes.${mode}.tagline`);

  return (
    <motion.div initial={{ opacity: 0, y: rare ? 10 : -10 }} animate={{ opacity: 1, y: 0 }} className="flex w-full flex-col items-stretch gap-1">
      <PxButton tone={rare ? 'teal' : 'coral'} onClick={() => onPlay(mode)} aria-label={`${t(`modes.${mode}.name`)} – ${action}`} className="w-full text-xl">
        {rare ? '▼' : '▲'} {t(`modes.${mode}.name`)}
      </PxButton>
      <Panel tone={rare ? 'stone' : 'wood'} className="w-full px-1 text-center text-sm leading-tight [--px:2px]">
        <span className="font-bold">{action}</span>
        <span className="block opacity-85">{status}</span>
      </Panel>
    </motion.div>
  );
}
