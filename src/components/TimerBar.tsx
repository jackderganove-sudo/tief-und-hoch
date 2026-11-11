import { useEffect, useRef } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { Mode } from '../domain/types';

/**
 * Schrumpfender Zeitbalken. Rechnet mit einer festen Deadline (nicht mit
 * Intervallen) – dadurch stimmt die Zeit auch nach Tab-Wechsel oder Reload.
 */
export function TimerBar({ deadline, mode, onExpire }: { deadline: number; mode: Mode; onExpire: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    expired.current = false;
    const total = SECONDS_PER_QUESTION * 1000;
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const frac = left / total;
      if (bar.current) {
        bar.current.style.transform = `scaleX(${frac})`;
        bar.current.dataset.low = left < 5000 ? 'true' : 'false';
      }
      if (label.current) label.current.textContent = String(Math.ceil(left / 1000));
      if (left <= 0) {
        if (!expired.current) {
          expired.current = true;
          onExpireRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [deadline]);

  const track = mode === 'rare' ? 'bg-white/10' : 'bg-white/45';
  const fill =
    mode === 'rare'
      ? 'bg-gradient-to-r from-glow-crystal to-glow-violet data-[low=true]:from-glow-lava data-[low=true]:to-[#ff2d55]'
      : 'bg-gradient-to-r from-[#ffb36b] to-balloon data-[low=true]:from-[#ff5f6d] data-[low=true]:to-[#d6249f]';

  return (
    <div className="flex items-center gap-3" role="timer" aria-live="off">
      <div className={`relative h-2.5 flex-1 overflow-hidden rounded-full ${track}`}>
        <div ref={bar} className={`absolute inset-0 origin-left rounded-full transition-colors duration-500 ${fill}`} />
      </div>
      <span ref={label} className="w-7 text-right font-display text-lg tabular-nums" />
    </div>
  );
}
