import { useEffect, useRef } from 'react';
import { SECONDS_PER_QUESTION } from '../domain/scoring';
import type { Mode } from '../domain/types';

/**
 * Schrumpfender Zeitbalken in Pixel-Segmenten. Rechnet mit einer festen
 * Deadline – stimmt auch nach Tab-Wechsel oder Reload.
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
      // in 50 Stufen – der Balken springt pixelweise statt weich zu gleiten
      const frac = Math.ceil((left / total) * 50) / 50;
      if (bar.current) {
        bar.current.style.width = `${frac * 100}%`;
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

  const fill =
    mode === 'rare'
      ? 'bg-[#3fc6c0] shadow-[inset_0_3px_0_#a8f5ea,inset_0_-3px_0_#1f6f76] data-[low=true]:bg-[#e2541e] data-[low=true]:shadow-[inset_0_3px_0_#ffb347,inset_0_-3px_0_#7a2416]'
      : 'bg-[#f2b53a] shadow-[inset_0_3px_0_#ffe08a,inset_0_-3px_0_#a8661c] data-[low=true]:bg-[#e2541e] data-[low=true]:shadow-[inset_0_3px_0_#ffb347,inset_0_-3px_0_#7a2416]';

  return (
    <div className="flex items-center gap-2" role="timer" aria-live="off">
      <div className="px-field px-field-dark h-7 flex-1">
        <div ref={bar} className={`h-full ${fill}`} />
      </div>
      <span ref={label} className="w-7 text-right text-xl font-bold tabular-nums" />
    </div>
  );
}
