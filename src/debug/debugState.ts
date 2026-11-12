/**
 * Debug-Zustand, aktiv mit ?debug=1 – aber nur, wenn `debugAvailable` gilt.
 */
const KEY = 'hal:v1:debug:dayOffset';

/**
 * Debug-Code ist im Bundle, wenn der Dev-Server läuft oder der Build mit
 * VITE_ENABLE_DEBUG=true gebaut wurde (Test-Deployment). Sonst wird er wegoptimiert.
 */
export const debugAvailable: boolean = import.meta.env.DEV || __DEBUG_BUILD__;

export const debugEnabled: boolean =
  debugAvailable && typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

let offset = debugEnabled ? readOffset() : 0;
const listeners = new Set<() => void>();

function readOffset(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Verschiebung des Spieltags in Tagen gegenüber dem echten Berliner Datum. */
export function getDayOffset(): number {
  return debugEnabled ? offset : 0;
}

export function setDayOffset(next: number) {
  if (!debugEnabled) return;
  offset = next;
  try {
    if (next === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(next));
  } catch {
    /* ignorieren */
  }
  listeners.forEach((l) => l());
}

export function subscribeDayOffset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
