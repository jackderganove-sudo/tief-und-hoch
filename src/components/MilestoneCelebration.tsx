import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { milestoneOf, type Milestone } from '../pixel/zones';
import { services } from '../services';
import type { Mode } from '../domain/types';
import { Panel } from './px';

/**
 * Beobachtet die Meter einer Runde. Wird die Hölle bzw. der Himmel erreicht:
 * - Tagesrunde: als Erfolg speichern; die große Feier nur beim allerersten Mal.
 * - Übung: einmal pro Sitzung feiern, nichts speichern (dort ist es leichter).
 * Beim Laden einer schon weiter gespielten Runde (Reload) wird nichts gefeiert.
 */
export function useMilestone(mode: Mode, meters: number, opts: { daily: boolean; dateKey: string }) {
  const [shown, setShown] = useState<Milestone | null>(null);
  const prev = useRef(meters);
  const celebrated = useRef(false);
  useEffect(() => {
    const before = milestoneOf(mode, prev.current);
    prev.current = meters;
    const now = milestoneOf(mode, meters);
    if (!now || before || celebrated.current) return;
    const isNew = opts.daily ? services.progress.recordAchievement(now, opts.dateKey) : true;
    if (!isNew) return;
    celebrated.current = true;
    // erst feiern, wenn die Figur angekommen ist
    const id = setTimeout(() => setShown(now), 1700);
    return () => clearTimeout(id);
  }, [mode, meters, opts.daily, opts.dateKey]);
  return { milestone: shown, dismiss: () => setShown(null) };
}

/** Große Einblendung: „Du hast die Hölle erreicht!“ / „Willkommen im Himmel!“ – Tippen schließt. */
export function MilestoneCelebration({ milestone, onClose }: { milestone: Milestone | null; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!milestone) return;
    try {
      navigator.vibrate?.(milestone === 'hell' ? [60, 40, 60, 40, 140] : [30, 50, 30, 50, 30, 50, 120]);
    } catch {
      /* egal */
    }
    const id = setTimeout(onClose, 6500);
    return () => clearTimeout(id);
  }, [milestone, onClose]);

  const hell = milestone === 'hell';
  const colors = hell ? ['#ffe28a', '#ffb347', '#ff6a2b', '#ff3a5a'] : ['#ffffff', '#fff2c8', '#ffe28a', '#8be9fd'];
  return (
    <AnimatePresence>
      {milestone && (
        <motion.div
          key={milestone}
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid cursor-pointer place-items-center px-5"
          style={{
            background: hell
              ? 'radial-gradient(circle at 50% 55%, rgba(255,106,43,0.55), rgba(42,8,32,0.85) 70%)'
              : 'radial-gradient(circle at 50% 45%, rgba(255,242,200,0.75), rgba(120,150,220,0.55) 75%)',
          }}
        >
          {/* Funken bzw. Lichtfunken steigen auf */}
          <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {Array.from({ length: 36 }, (_, i) => (
              <motion.span
                key={i}
                className="absolute block size-2"
                style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length] }}
                initial={{ y: hell ? '110vh' : '-10vh', opacity: 1 }}
                animate={{ y: hell ? '-10vh' : '110vh', opacity: [1, 1, 0] }}
                transition={{ duration: 2.4 + (i % 5) * 0.5, delay: (i % 9) * 0.18, repeat: Infinity, ease: 'linear' }}
              />
            ))}
          </span>
          <motion.div initial={{ scale: 0.6, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
            <Panel tone={hell ? 'stone' : 'wood'} className="max-w-sm px-3 text-center">
              <motion.p
                className="text-7xl leading-none"
                animate={{ rotate: [0, -8, 8, -4, 0], scale: [1, 1.15, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.8 }}
                aria-hidden
              >
                {hell ? '😈' : '😇'}
              </motion.p>
              <h2 className="mt-3 text-4xl font-bold leading-tight" style={{ color: hell ? '#ff8a4a' : '#c89a4a' }}>
                {t(`milestone.${milestone}.title`)}
              </h2>
              <p className="mt-2 text-lg leading-snug">{t(`milestone.${milestone}.text`)}</p>
              <p className="mt-3 text-xs opacity-60">{t('friends.tapToSkip')}</p>
            </Panel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
