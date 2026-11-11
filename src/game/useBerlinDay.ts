import { useEffect, useState, useSyncExternalStore } from 'react';
import { addDays, berlinDateKey, msUntilNextBerlinDay } from '../domain/daily';
import { getDayOffset, subscribeDayOffset } from '../debug/debugState';

/**
 * Aktueller Spieltag (Europe/Berlin) – aktualisiert sich selbst um Mitternacht.
 * Im Debug-Modus um die eingestellte Anzahl Tage verschoben.
 */
export function useBerlinDay(): string {
  const [day, setDay] = useState(() => berlinDateKey());
  const offset = useSyncExternalStore(subscribeDayOffset, getDayOffset);
  useEffect(() => {
    const id = window.setInterval(() => setDay(berlinDateKey()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return offset ? addDays(day, offset) : day;
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
