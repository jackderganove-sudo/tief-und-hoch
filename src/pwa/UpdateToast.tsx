import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerSW } from 'virtual:pwa-register';
import { Panel, PxButton } from '../components/px';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
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

/**
 * Kleiner Pixel-Hinweis „Neue Version – neu laden“. Lädt nur auf Knopfdruck neu
 * und wird während einer laufenden Runde gar nicht angezeigt (`hidden`).
 */
export function UpdateToast({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(waiting);
  useEffect(() => {
    const l = () => setShow(true);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
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
