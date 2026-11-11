/**
 * Debug-Zustand (nur im Dev-Server, aktiv mit ?debug=1).
 * Im Produktions-Build ist import.meta.env.DEV = false → alles hier wird zu
 * Konstanten und der Rest wegoptimiert.
 */
const KEY = 'tuh:v1:debug:dayOffset';

export const debugEnabled: boolean =
  import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

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
