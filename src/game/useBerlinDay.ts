import { useEffect, useState } from 'react';
import { berlinDateKey, msUntilNextBerlinDay } from '../domain/daily';

/** Aktueller Spieltag (Europe/Berlin) – aktualisiert sich selbst um Mitternacht. */
export function useBerlinDay(): string {
  const [day, setDay] = useState(() => berlinDateKey());
  useEffect(() => {
    const id = window.setInterval(() => setDay(berlinDateKey()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return day;
}

/** Countdown "hh:mm:ss" bis zum nächsten Spieltag. */
export function useCountdown(): string {
  const [ms, setMs] = useState(() => msUntilNextBerlinDay());
  useEffect(() => {
    const id = window.setInterval(() => setMs(msUntilNextBerlinDay()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
