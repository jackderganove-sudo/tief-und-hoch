import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerSW } from 'virtual:pwa-register';
import { Panel, PxButton } from '../components/px';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
/** Beim Server nach einer neuen Version fragen (ohne Wirkung, wenn kein Service Worker läuft). */
export const checkForUpdate = () => registration?.update().catch(() => {}) ?? Promise.resolve();
let waiting = false;
const listeners = new Set<() => void>();

// Service Worker registrieren (nur im Build; im Dev-Server gibt es keinen)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  updateSW = registerSW({
    onNeedRefresh() {
      waiting = true;
      listeners.forEach((l) => l());
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration = reg;
      // stündlich nach einer neuen Version sehen – und immer, wenn die App wieder in den
      // Vordergrund kommt (sonst bleibt ein Handy, auf dem die App nur pausiert, ewig auf dem alten Stand)
      const check = () => void reg.update().catch(() => {});
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

const AUTO_KEY = 'hal:auto-update-at';
/** Schutz vor Lade-Schleifen: höchstens ein automatisches Neuladen pro Minute. */
export function mayAutoUpdate(lastAt: number | null, now: number): boolean {
  return lastAt === null || !Number.isFinite(lastAt) || now - lastAt > 60_000;
}

/**
 * Neue Version: Auf der Startseite (`auto`) wird sie sofort von selbst übernommen – sonst
 * bleiben Geräte tagelang auf einem alten Stand, weil der Hinweis während einer Runde nicht
 * erscheint und danach leicht übersehen wird. In einer Runde (`hidden`) passiert nichts; auf
 * anderen Seiten (Ergebnis, Freunde-Modus) gibt es den Hinweis mit Knopf.
 */
export function UpdateToast({ hidden, auto = false }: { hidden: boolean; auto?: boolean }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(waiting);
  useEffect(() => {
    const l = () => setShow(true);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    // Zurück auf der Startseite: gleich nach einer neuen Version sehen
    if (auto) void checkForUpdate();
  }, [auto]);
  useEffect(() => {
    if (!show || !auto || hidden || !updateSW) return;
    const apply = () => {
      // nicht mitten in einer Eingabe oder einem offenen Dialog (Anmeldung, Code eintippen …)
      const a = document.activeElement;
      if (document.querySelector('[role="dialog"]') || a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return false;
      let last: number | null = null;
      try {
        last = Number(sessionStorage.getItem(AUTO_KEY) ?? NaN);
      } catch {
        /* egal */
      }
      if (!mayAutoUpdate(last, Date.now())) return true; // gerade erst neu geladen → nur der Hinweis bleibt
      try {
        sessionStorage.setItem(AUTO_KEY, String(Date.now()));
      } catch {
        /* egal */
      }
      void updateSW?.(true);
      return true;
    };
    if (apply()) return;
    const id = setInterval(() => apply() && clearInterval(id), 3000);
    return () => clearInterval(id);
  }, [show, auto, hidden]);
  if (!show || hidden) return null;
  return (
    <div className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-3" role="status">
      <Panel tone="wood" className="flex items-center gap-3 px-1 text-base [--px:2px]">
        <span>{t('pwa.updateReady')}</span>
        <PxButton tone="gold" small className="text-base" onClick={() => void updateSW?.(true)}>
          {t('pwa.reload')}
        </PxButton>
        <button type="button" aria-label={t('pwa.dismiss')} className="px-1 text-lg opacity-70" onClick={() => setShow(false)}>
          ×
        </button>
      </Panel>
    </div>
  );
}
