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
      <div className="absolute inset-x-0 top-[6.5%] z-20 flex flex-col items-center px-4">
        <Panel tone="wood" className="max-w-sm px-2 text-center">
          <h1 className="text-4xl font-bold leading-none sm:text-5xl">{t('app.title')}</h1>
          <p className="mt-1 text-sm leading-tight sm:text-base">{t('app.tagline')}</p>
        </Panel>
      </div>

      {/* Querschnitt (Positionen passend zu HOME_LAYOUT in PixelWorld): je Hälfte ein Knopf,
          gespiegelt um den Horizont – Ballon und Forscher nah am Boden, die Knöpfe nach außen. */}
      <div className="absolute inset-x-0 top-[21%] z-20 flex justify-center px-6 [@media(min-aspect-ratio:1/1)]:left-[calc(50%+8rem)] [@media(min-aspect-ratio:1/1)]:right-auto [@media(min-aspect-ratio:1/1)]:top-[30%] [@media(min-aspect-ratio:1/1)]:w-80 [@media(min-aspect-ratio:1/1)]:px-0">
        <ModeChoice mode="common" dateKey={dateKey} onPlay={onPlay} />
      </div>
      <div className="absolute inset-x-0 top-[73%] z-20 flex justify-center px-6 [@media(min-aspect-ratio:1/1)]:left-[calc(50%+8rem)] [@media(min-aspect-ratio:1/1)]:right-auto [@media(min-aspect-ratio:1/1)]:top-[71%] [@media(min-aspect-ratio:1/1)]:w-80 [@media(min-aspect-ratio:1/1)]:px-0">
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
  // Zweite Zeile nur, wenn es etwas zu melden gibt: heutiges Ergebnis oder Serie
  const status = day?.finished
    ? `${rare && meters > 0 ? '−' : ''}${fmt.format(meters)} m · ${points}/${MAX_POINTS}`
    : streak > 0
      ? `🔥 ${t('home.streak', { count: streak })}`
      : null;

  return (
    <motion.div initial={{ opacity: 0, y: rare ? 10 : -10 }} animate={{ opacity: 1, y: 0 }} className="flex w-full max-w-xs flex-col items-stretch gap-1">
      <PxButton tone={rare ? 'teal' : 'coral'} onClick={() => onPlay(mode)} aria-label={`${t(`modes.${mode}.name`)} – ${action}`} className="w-full text-2xl">
        {rare ? '▼' : '▲'} {t(`modes.${mode}.name`)}
      </PxButton>
      <Panel tone={rare ? 'stone' : 'wood'} className="w-full px-1 text-center text-sm leading-tight [--px:2px]">
        {/* immer genau eine Zeile: Beschreibung – oder, wenn vorhanden, heutiges Ergebnis/Serie */}
        {status ? <span className="block font-bold">{status}</span> : <span className="block">{t(`modes.${mode}.tagline`)}</span>}
      </Panel>
    </motion.div>
  );
}
