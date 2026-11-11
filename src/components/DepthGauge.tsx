import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { MAX_POINTS, METERS_PER_POINT } from '../domain/scoring';
import type { Mode } from '../domain/types';

const MAX_METERS = MAX_POINTS * METERS_PER_POINT;
const TICKS = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];

/** Tiefen-/Höhenmesser am rechten Rand. */
export function DepthGauge({ mode, meters, locale }: { mode: Mode; meters: number; locale: string }) {
  const mv = useMotionValue(meters);
  const fmt = new Intl.NumberFormat(locale);
  const text = useTransform(mv, (v) => `${mode === 'rare' && v > 0 ? '−' : ''}${fmt.format(Math.round(v))} m`);
  const pos = useTransform(mv, (v) => `${(v / MAX_METERS) * 100}%`);

  useEffect(() => {
    const controls = animate(mv, meters, { duration: 2.4, ease: [0.45, 0, 0.15, 1] });
    return () => controls.stop();
  }, [meters, mv]);

  const rare = mode === 'rare';
  const tone = rare ? 'text-white/70' : 'text-[#1d2a52]/70';
  const line = rare ? 'bg-white/25' : 'bg-[#1d2a52]/25';

  return (
    <div className={`pointer-events-none relative h-full w-12 ${tone}`} aria-label={rare ? 'Tiefenmesser' : 'Höhenmesser'}>
      <div className={`absolute bottom-0 right-3 top-0 w-px ${line}`} />
      {TICKS.map((m) => (
        <div
          key={m}
          className="absolute right-3 flex items-center gap-1"
          style={rare ? { top: `${(m / MAX_METERS) * 100}%` } : { bottom: `${(m / MAX_METERS) * 100}%` }}
        >
          <span className="text-[9px] tabular-nums leading-none">{m / 1000}k</span>
          <span className={`h-px w-2 ${line}`} />
        </div>
      ))}
      <motion.div
        className="absolute right-0 flex items-center"
        style={rare ? { top: pos, y: '-50%' } : { bottom: pos, y: '50%' }}
      >
        <motion.span
          className={`mr-1 whitespace-nowrap rounded-full px-2 py-0.5 font-display text-xs font-semibold tabular-nums shadow-lg ${
            rare ? 'bg-glow-crystal text-cave-950 shadow-glow-crystal/40' : 'bg-balloon text-white shadow-balloon/40'
          }`}
        >
          {text}
        </motion.span>
        <span className={`h-3 w-3 rotate-45 ${rare ? 'bg-glow-crystal' : 'bg-balloon'}`} />
      </motion.div>
    </div>
  );
}
