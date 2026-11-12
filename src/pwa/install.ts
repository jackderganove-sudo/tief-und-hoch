/**
 * Installieren-Hinweis: Android/Chrome liefert `beforeinstallprompt`, iOS nicht
 * (dort zeigt die App „Teilen → Zum Home-Bildschirm“). In der installierten App
 * (display-mode: standalone) gibt es keinen Hinweis.
 */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Früh lauschen – das Ereignis kommt oft, bevor React überhaupt rendert
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Vollbild per Fullscreen-API anbieten? Nur im Browser auf Android/Desktop, nicht auf iOS. */
export function canOfferFullscreen(): boolean {
  return !isIOS() && (!!document.fullscreenElement || !isStandalone()) && typeof document.documentElement.requestFullscreen === 'function';
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS meldet sich als Mac – erkennbar am Touchscreen
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isIPad(): boolean {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export type InstallState = { kind: 'none' } | { kind: 'prompt'; install: () => Promise<void> } | { kind: 'ios'; ipad: boolean };

export function useInstall(): InstallState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (isStandalone()) return { kind: 'none' };
  if (deferred) {
    const ev = deferred;
    return {
      kind: 'prompt',
      install: async () => {
        await ev.prompt();
        await ev.userChoice;
        deferred = null;
        notify();
      },
    };
  }
  return isIOS() ? { kind: 'ios', ipad: isIPad() } : { kind: 'none' };
}
