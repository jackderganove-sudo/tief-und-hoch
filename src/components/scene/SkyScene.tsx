import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CAMERA_SPAN, WORLD_SCREENS, skyDecor, type DecorItem } from './decor';

/**
 * Aufstieg: Wiese → Baumwipfel → Wolken → Abendrot → Sterne.
 * Die Welt ist 6 Bildschirme hoch; bei Fortschritt 0 sieht man den Boden,
 * bei 1 den Sternenhimmel. Der Ballon bleibt in der Bildmitte.
 */
const GRADIENT = `linear-gradient(to bottom,
  #080c26 0%, #121a44 12%, #2a2160 22%,
  #6a3f86 30%, #d0607a 36%, #ff9a76 41%, #ffc796 46%,
  #ffe7c4 50%, #d7efff 56%, #b7e1ff 66%,
  #9fd8ff 78%, #b4e3ff 88%, #cdeeff 92%,
  #8bcf6a 92.5%, #6fb552 96%, #5aa043 100%)`;

function Cloud({ item }: { item: DecorItem }) {
  const warm = item.y < 45; // im Abendrot rosa getönt
  return (
    <div className="animate-drift" style={{ animationDuration: `${30 + item.r * 30}s`, animationDelay: `${item.r * -20}s` }}>
      <svg viewBox="0 0 120 50" style={{ transform: item.flip ? 'scaleX(-1)' : undefined }}>
        <path
          d="M10 44 Q0 44 2 34 Q4 24 18 26 Q20 10 38 12 Q46 0 62 6 Q76 0 84 14 Q100 10 104 24 Q120 24 118 36 Q116 44 104 44 Z"
          fill={warm ? '#ffe1d6' : 'white'}
          opacity={0.72 + item.r * 0.2}
        />
      </svg>
    </div>
  );
}

function Tree({ item }: { item: DecorItem }) {
  const green = ['#3f8f3a', '#4b9c42', '#2f7a34', '#5aa843'][Math.floor(item.r * 4)];
  return (
    <svg viewBox="0 0 60 70">
      <rect x="27" y="40" width="6" height="30" fill="#6b4a2b" />
      <circle cx="30" cy="28" r="20" fill={green} />
      <circle cx="18" cy="36" r="13" fill={green} />
      <circle cx="42" cy="36" r="13" fill={green} />
      <circle cx="24" cy="20" r="8" fill="white" opacity="0.12" />
    </svg>
  );
}

function Bird({ item }: { item: DecorItem }) {
  return (
    <svg viewBox="0 0 20 8" className="animate-bob" style={{ animationDelay: `${item.r * -4}s` }}>
      <path d="M1 6 Q5 0 10 5 Q15 0 19 6" fill="none" stroke="#3b4a66" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const SkyWorld = memo(function SkyWorld() {
  const decor = useMemo(skyDecor, []);
  return (
    <>
      {/* Mond */}
      <div className="absolute left-[72%] top-[5%] h-[14vmin] w-[14vmin] rounded-full bg-[#fff6d8] shadow-[0_0_6vmin_#fff3c4]" />
      {/* Sonne im Abendrot */}
      <div className="absolute left-[22%] top-[40%] h-[26vmin] w-[26vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#fff1c1_0%,#ffb36b_55%,#ff8a5c_100%)] shadow-[0_0_12vmin_#ff9f6b]" />
      {/* Hügel */}
      <svg className="absolute inset-x-0 bottom-0 h-[9%] w-full" viewBox="0 0 100 30" preserveAspectRatio="none">
        <path d="M0 12 Q20 2 42 9 T100 6 V30 H0 Z" fill="#7cc35c" />
        <path d="M0 20 Q30 10 60 17 T100 15 V30 H0 Z" fill="#5fae47" />
      </svg>
      {decor.map((item, i) => {
        if (item.kind === 'star') {
          return (
            <span
              key={i}
              className="absolute rounded-full bg-white animate-twinkle"
              style={{
                left: `${item.x}%`,
                top: `${item.y}%`,
                width: `${item.s}vmin`,
                height: `${item.s}vmin`,
                animationDelay: `${item.r * -3}s`,
                boxShadow: item.s > 0.6 ? '0 0 1vmin white' : undefined,
              }}
            />
          );
        }
        if (item.kind === 'flower') {
          const c = ['#ffd166', '#ff8fab', '#ffffff', '#c8b6ff'][Math.floor(item.r * 4)];
          return <span key={i} className="absolute rounded-full" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.s}vmin`, height: `${item.s}vmin`, background: c }} />;
        }
        const Comp = item.kind === 'cloud' ? Cloud : item.kind === 'tree' ? Tree : item.kind === 'bird' ? Bird : null;
        if (!Comp) return null;
        return (
          <div key={i} className="absolute" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.s}vmin`, transform: 'translate(-50%, -100%)' }}>
            <Comp item={item} />
          </div>
        );
      })}
    </>
  );
});

function Balloon({ burning }: { burning: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[54%] w-[22vmin] -translate-x-1/2 animate-bob" aria-hidden>
      <svg viewBox="0 0 100 140" className="w-full drop-shadow-[0_1.5vmin_2vmin_rgba(30,40,80,0.25)]">
        <defs>
          <clipPath id="envelope">
            <path d="M50 4 C20 4 6 28 6 50 C6 74 30 92 40 104 L60 104 C70 92 94 74 94 50 C94 28 80 4 50 4 Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#envelope)">
          <rect width="100" height="110" fill="#ff7a59" />
          <rect x="22" width="14" height="110" fill="#fff7ec" />
          <rect x="64" width="14" height="110" fill="#fff7ec" />
          <rect x="43" width="14" height="110" fill="#ffc15e" />
          <ellipse cx="34" cy="30" rx="16" ry="22" fill="white" opacity="0.18" />
        </g>
        <path d="M40 104 L42 118 M60 104 L58 118 M46 104 L46 118 M54 104 L54 118" stroke="#6b4a2b" strokeWidth="1.2" />
        <rect x="38" y="117" width="24" height="18" rx="2.5" fill="#a0703f" />
        <path d="M38 123 H62 M38 129 H62" stroke="#7a522c" strokeWidth="1.2" />
      </svg>
      {burning && (
        <div className="absolute left-1/2 top-[66%] h-[4vmin] w-[2.4vmin] -translate-x-1/2 origin-bottom animate-flicker rounded-[50%_50%_40%_40%] bg-[radial-gradient(circle_at_50%_70%,#fff3b0_0%,#ffb347_45%,#ff6a2b_100%)] shadow-[0_0_3vmin_#ffb347]" />
      )}
    </div>
  );
}

export function SkyScene({ progress, showBalloon = true }: { progress: number; showBalloon?: boolean }) {
  const p = Math.min(1, Math.max(0, progress));
  // Brenner zündet kurz, wenn es nach oben geht.
  const [burning, setBurning] = useState(false);
  const prev = useRef(p);
  useEffect(() => {
    if (p > prev.current) {
      setBurning(true);
      const id = window.setTimeout(() => setBurning(false), 2400);
      prev.current = p;
      return () => window.clearTimeout(id);
    }
    prev.current = p;
  }, [p]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-sky-day" aria-hidden>
      <motion.div
        className="absolute inset-x-0 top-0 will-change-transform"
        style={{ height: `${WORLD_SCREENS * 100}%`, background: GRADIENT }}
        initial={false}
        animate={{ y: `${-(1 - p) * CAMERA_SPAN}%` }}
        transition={{ duration: 2.4, ease: [0.45, 0, 0.15, 1] }}
      >
        <SkyWorld />
      </motion.div>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 40%, transparent 55%, rgba(20,30,70,0.18) 100%)' }} />
      {showBalloon && <Balloon burning={burning} />}
    </div>
  );
}
