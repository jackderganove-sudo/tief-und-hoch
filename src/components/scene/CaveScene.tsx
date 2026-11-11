import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CAMERA_SPAN, WORLD_SCREENS, caveDecor, type DecorItem } from './decor';
import { mulberry32 } from '../../domain/daily';

/**
 * Abstieg: eine 6 Bildschirme hohe Höhlenspalte, die Kamera fährt mit dem
 * Fortschritt (0–1) nach unten. Moos → Fels → Kristalle → Leuchtpilze → Lava.
 */
const GRADIENT = `linear-gradient(to bottom,
  #a9dcff 0%, #d8efff 7.6%,
  #5b8f3a 8.2%, #3b2a1d 8.9%, #2b2119 14%,
  #1d2219 18%, #182019 30%,
  #1b1d24 36%, #16171f 48%,
  #1a1430 54%, #140f28 64%,
  #0b1a1f 70%, #081517 80%,
  #1a0b08 86%, #2a0c06 93%, #5a1505 98%, #8a2306 100%)`;

const CRYSTAL_COLORS = ['#8be9fd', '#b794f6', '#f0abfc', '#7dd3fc'];

function Crystal({ item }: { item: DecorItem }) {
  const color = CRYSTAL_COLORS[Math.floor(item.r * CRYSTAL_COLORS.length)];
  return (
    <svg viewBox="0 0 40 40" className="animate-pulse-glow" style={{ animationDelay: `${item.r * -4}s`, filter: `drop-shadow(0 0 1.4vmin ${color})` }}>
      <defs>
        <linearGradient id={`cg-${color.slice(1)}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.95" />
          <stop offset="0.45" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <g fill={`url(#cg-${color.slice(1)})`} stroke="white" strokeOpacity="0.5" strokeWidth="0.6">
        <path d="M20 2 L26 14 L24 38 L16 38 L14 14 Z" />
        <path d="M9 14 L14 20 L14 38 L7 38 L5 22 Z" opacity="0.85" />
        <path d="M31 18 L35 24 L33 38 L26 38 L27 24 Z" opacity="0.8" />
      </g>
    </svg>
  );
}

function Shroom({ item }: { item: DecorItem }) {
  const cap = item.r < 0.5 ? '#5eead4' : item.r < 0.8 ? '#a3e635' : '#c084fc';
  return (
    <svg viewBox="0 0 40 40" className="animate-pulse-glow" style={{ animationDelay: `${item.r * -3}s`, filter: `drop-shadow(0 0 1.6vmin ${cap})` }}>
      <path d="M17 18 Q16 30 14 39 L24 39 Q22 30 22 18 Z" fill="#e6f7f2" opacity="0.85" />
      <path d="M3 20 Q6 4 20 3 Q34 4 37 20 Q30 23 20 22 Q10 23 3 20 Z" fill={cap} />
      <circle cx="13" cy="12" r="2" fill="white" opacity="0.7" />
      <circle cx="24" cy="9" r="1.6" fill="white" opacity="0.7" />
      <circle cx="29" cy="15" r="1.3" fill="white" opacity="0.6" />
    </svg>
  );
}

function Rock({ item }: { item: DecorItem }) {
  const shade = 38 + Math.round(item.r * 18);
  return (
    <svg viewBox="0 0 40 30">
      <path d="M3 28 L6 14 L15 6 L27 5 L36 13 L38 28 Z" fill={`rgb(${shade},${shade + 2},${shade + 10})`} />
      <path d="M15 6 L19 16 L36 13" fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.2" />
      <path d="M6 14 L19 16 L22 28" fill="none" stroke="black" strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}

function Moss({ item }: { item: DecorItem }) {
  return (
    <svg viewBox="0 0 40 20" style={{ transform: item.flip ? 'scaleX(-1)' : undefined }}>
      <path d="M0 20 Q4 8 9 14 Q12 3 18 12 Q22 2 27 11 Q31 5 34 13 Q38 9 40 20 Z" fill={item.r < 0.5 ? '#4d7c3a' : '#5f9142'} opacity="0.9" />
    </svg>
  );
}

function Root({ item }: { item: DecorItem }) {
  return (
    <svg viewBox="0 0 20 60" style={{ transform: item.flip ? 'scaleX(-1)' : undefined }}>
      <path d="M10 0 Q14 15 8 26 Q4 36 11 46 Q13 52 9 60" fill="none" stroke="#5a3d26" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 26 Q2 30 1 38" fill="none" stroke="#5a3d26" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Grass({ item }: { item: DecorItem }) {
  return (
    <svg viewBox="0 0 20 14">
      <path d="M2 14 L5 2 L7 14 M8 14 L10 0 L12 14 M13 14 L16 4 L18 14" stroke={item.r < 0.5 ? '#6aa84f' : '#7cbf5a'} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const ITEM: Record<string, (p: { item: DecorItem }) => React.ReactElement | null> = {
  crystal: Crystal,
  shroom: Shroom,
  rock: Rock,
  moss: Moss,
  root: Root,
  grass: Grass,
};

/** Zerklüftete Seitenwände als ein SVG über die ganze Welthöhe. */
function Walls() {
  const path = useMemo(() => {
    const rand = mulberry32(7);
    const steps = 120;
    const top = 8.6; // Prozent – knapp unter der Grasnarbe
    const pts = (side: 'l' | 'r') =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const y = top + ((100 - top) * i) / steps;
        // Schacht wird nach unten etwas breiter, mit Zacken
        const base = 10 + 6 * Math.sin(i / 7) + rand() * 7 - (i / steps) * 3;
        return `${side === 'l' ? base : 100 - base},${y * 10}`;
      });
    const left = `M0,${top * 10} L${pts('l').join(' L')} L0,1000 Z`;
    const right = `M100,${top * 10} L${pts('r').join(' L')} L100,1000 Z`;
    return { left, right };
  }, []);
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden>
      <g fill="black" fillOpacity="0.55" stroke="white" strokeOpacity="0.06" strokeWidth="0.4" vectorEffect="non-scaling-stroke">
        <path d={path.left} />
        <path d={path.right} />
      </g>
    </svg>
  );
}

const CaveWorld = memo(function CaveWorld() {
  const decor = useMemo(caveDecor, []);
  return (
    <>
      <Walls />
      {/* Lava-Glühen am Boden */}
      <div
        className="absolute inset-x-0 bottom-0 h-[6%] animate-pulse-glow"
        style={{ background: 'radial-gradient(120% 100% at 50% 100%, #ffb347 0%, #ff5a1f 30%, #9b1c06 60%, transparent 100%)' }}
      />
      {decor.map((item, i) => {
        if (item.kind === 'ember' || item.kind === 'spore' || item.kind === 'dust') {
          const color = item.kind === 'ember' ? '#ffb347' : item.kind === 'spore' ? '#5eead4' : '#ffffff';
          return (
            <span
              key={i}
              className={item.kind === 'dust' ? 'absolute rounded-full animate-twinkle' : 'absolute rounded-full animate-rise'}
              style={{
                left: `${item.x}%`,
                top: `${item.y}%`,
                width: `${item.s}vmin`,
                height: `${item.s}vmin`,
                background: color,
                opacity: item.kind === 'dust' ? 0.25 : 0.9,
                boxShadow: item.kind === 'dust' ? undefined : `0 0 1vmin ${color}`,
                animationDelay: `${item.r * -5}s`,
                animationDuration: item.kind === 'dust' ? '6s' : `${4 + item.r * 4}s`,
              }}
            />
          );
        }
        const Comp = ITEM[item.kind];
        if (!Comp) return null;
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.s}vmin`, transform: 'translate(-50%, -100%)' }}
          >
            <Comp item={item} />
          </div>
        );
      })}
    </>
  );
});

/** Förderkorb mit Laterne, der am Seil hängt (bleibt in der Bildschirmmitte). */
function Lift() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-0 h-[68%] w-[16vmin] -translate-x-1/2" aria-hidden>
      <div className="absolute left-1/2 top-0 h-[calc(100%-13vmin)] w-[0.5vmin] -translate-x-1/2 bg-gradient-to-b from-transparent via-stone-400/60 to-stone-300/80" />
      <div className="absolute bottom-0 left-0 w-full origin-top animate-sway">
        <div
          className="absolute -inset-[14vmin] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,200,120,0.28) 0%, rgba(255,170,80,0.08) 40%, transparent 70%)' }}
        />
        <svg viewBox="0 0 60 50" className="relative w-full drop-shadow-[0_0_2vmin_rgba(255,190,110,0.5)]">
          <path d="M30 0 L8 12 M30 0 L52 12" stroke="#c9b79c" strokeWidth="1.4" />
          <rect x="6" y="12" width="48" height="34" rx="3" fill="#2a211b" stroke="#8a7158" strokeWidth="2" />
          <path d="M18 12 V46 M30 12 V46 M42 12 V46" stroke="#8a7158" strokeWidth="1.4" />
          <rect x="24" y="22" width="12" height="15" rx="2.5" fill="#ffd38a" />
          <rect x="26.5" y="25" width="7" height="9" rx="1.5" fill="#fff4d6" />
          <path d="M6 46 H54" stroke="#b08d68" strokeWidth="3" />
        </svg>
      </div>
    </div>
  );
}

export function CaveScene({ progress, showLift = true }: { progress: number; showLift?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-cave-950" aria-hidden>
      <motion.div
        className="absolute inset-x-0 top-0 will-change-transform"
        style={{ height: `${WORLD_SCREENS * 100}%`, background: GRADIENT }}
        initial={false}
        animate={{ y: `${-Math.min(1, Math.max(0, progress)) * CAMERA_SPAN}%` }}
        transition={{ duration: 2.4, ease: [0.45, 0, 0.15, 1] }}
      >
        <CaveWorld />
      </motion.div>
      {/* Vignette: Ränder dunkel, Mitte vom Korb beleuchtet */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 75% 60% at 50% 42%, transparent 35%, rgba(4,3,8,0.75) 100%)' }} />
      {showLift && <Lift />}
    </div>
  );
}
