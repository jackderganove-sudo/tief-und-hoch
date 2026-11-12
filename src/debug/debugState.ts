/**
 * Debug-Zustand.
 *
 * - Dev-Server (npm run dev): wie bisher mit ?debug=1.
 * - Live-Build: ?debug=1 hat KEINE Wirkung. Debug gibt es nur über das Admin-Dashboard:
 *   es setzt eine lokale Markierung, und beim Start prüft die App per is_admin() auf dem
 *   Server, ob das angemeldete Konto wirklich Admin ist. Sonst wird die Markierung gelöscht.
 *   Was der Debug-Modus serverseitig darf (is_debug-Runden), prüft zusätzlich die Datenbank.
 *
 * Im Debug-Modus spielt man in einem eigenen Spielstand („Sandbox“, siehe
 * DebugProgressRepository) – echte Statistik, Serie und Sync bleiben unberührt.
 */
const OFFSET_KEY = 'hal:v1:debug:dayOffset';
export const ADMIN_DEBUG_KEY = 'hal:v1:debug:admin';

export interface DebugEnv {
  dev: boolean;
  search: string;
  adminFlag: boolean;
}

/** Sofort (synchron) aktiv? Nur im Dev-Server mit ?debug=1. */
export function devDebugRequested(env: DebugEnv): boolean {
  return env.dev && new URLSearchParams(env.search).get('debug') === '1';
}

/**
 * Admin-Debug (Live-Build): nur mit Markierung UND bestätigtem Admin.
 * `checkAdmin` fragt den Server (RPC is_admin) – ohne Sitzung/Fehler → false.
 */
export async function resolveAdminDebug(env: DebugEnv, checkAdmin: () => Promise<boolean>): Promise<boolean> {
  if (!env.adminFlag) return false;
  try {
    return await checkAdmin();
  } catch {
    return false;
  }
}

const env = (): DebugEnv => ({
  dev: import.meta.env.DEV,
  search: typeof location !== 'undefined' ? location.search : '',
  adminFlag: readFlag(),
});

let enabled = devDebugRequested(env());
let offset = enabled ? readOffset() : 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readFlag(): boolean {
  try {
    return localStorage.getItem(ADMIN_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

function readOffset(): number {
  try {
    const n = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function isDebug(): boolean {
  return enabled;
}

/** Nach dem Start: Admin-Debug serverseitig bestätigen (Live-Build). */
export async function initAdminDebug(checkAdmin: () => Promise<boolean>): Promise<void> {
  if (enabled) return;
  const ok = await resolveAdminDebug(env(), checkAdmin);
  if (!ok) {
    if (readFlag()) setAdminDebugFlag(false); // kein Admin (mehr) → Markierung weg
    return;
  }
  enabled = true;
  offset = readOffset();
  notify();
}

/** Nur vom Admin-Dashboard (nach Admin-Prüfung) aufgerufen. */
export function setAdminDebugFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(ADMIN_DEBUG_KEY, '1');
    else {
      localStorage.removeItem(ADMIN_DEBUG_KEY);
      localStorage.removeItem(OFFSET_KEY);
    }
  } catch {
    /* ignorieren */
  }
  if (!on && enabled && !devDebugRequested(env())) {
    enabled = false;
    offset = 0;
  }
  notify();
}

export function adminDebugFlag(): boolean {
  return readFlag();
}

/** Verschiebung des Spieltags in Tagen gegenüber dem echten Berliner Datum. */
export function getDayOffset(): number {
  return enabled ? offset : 0;
}

/** Tag verschieben. Wirkt nur im Debug-Modus (bzw. setzt den Wert für den nächsten Start). */
export function setDayOffset(next: number) {
  offset = next;
  try {
    if (next === 0) localStorage.removeItem(OFFSET_KEY);
    else localStorage.setItem(OFFSET_KEY, String(next));
  } catch {
    /* ignorieren */
  }
  notify();
}

/** Gespeicherte Verschiebung (auch wenn die App gerade nicht im Debug-Modus läuft, z. B. im Dashboard). */
export function storedDayOffset(): number {
  return readOffset();
}

export function subscribeDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Alter Name – useBerlinDay hört darauf. */
export const subscribeDayOffset = subscribeDebug;
