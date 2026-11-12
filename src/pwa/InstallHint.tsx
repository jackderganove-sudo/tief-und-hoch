import { useTranslation } from 'react-i18next';
import { PxButton } from '../components/px';
import { useEffect, useState } from 'react';
import { canOfferFullscreen, useInstall } from './install';

/** Pixel-Icon „Teilen“ (Kasten mit Pfeil nach oben), wie in Safari. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 11 13" width={22} height={26} className="pixelated inline-block shrink-0" shapeRendering="crispEdges" aria-hidden>
      <path fill="#3d83b3" d="M5 0h1v1h1v1h1v1H6v6H5V3H3V2h1V1h1zM1 5h3v1H2v6h7V6H7V5h3v8H1z" />
    </svg>
  );
}

/** Pixel-Icon „Zum Home-Bildschirm“ (Kasten mit Plus). */
function AddIcon() {
  return (
    <svg viewBox="0 0 11 11" width={22} height={22} className="pixelated inline-block shrink-0" shapeRendering="crispEdges" aria-hidden>
      <path fill="#3a2416" d="M1 0h9v1h1v9h-1v1H1v-1H0V1h1zm0 1v9h9V1zM5 3h1v2h2v1H6v2H5V6H3V5h2z" />
    </svg>
  );
}

/** Pfeil nach unten zur Safari-Leiste (iPhone) – gepixelt, wippt sanft (außer bei reduzierter Bewegung). */
function DownArrow() {
  return (
    <svg viewBox="0 0 7 8" width={21} height={24} className="pixelated inline-block motion-safe:animate-bounce" shapeRendering="crispEdges" aria-hidden>
      <path fill="#e2603a" d="M2 0h3v4h2v1H6v1H5v1H4v1H3V7H2V6H1V5H0V4h2z" />
    </svg>
  );
}

/**
 * Abschnitt im Hilfe-Menü: Android/Chrome → Knopf „App installieren“,
 * iPhone/iPad → Anleitung „Teilen → Zum Home-Bildschirm“, installiert → nichts.
 */
/** Vollbild im normalen Browser (Android/Desktop) über die Fullscreen-API. */
export function FullscreenToggle() {
  const { t } = useTranslation();
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  if (!canOfferFullscreen()) return null;
  return (
    <PxButton
      tone="wood"
      small
      className="mt-3 w-full text-base"
      onClick={(e) => {
        e.stopPropagation();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }}
    >
      {full ? t('pwa.exitFullscreen') : t('pwa.fullscreen')}
    </PxButton>
  );
}

export function InstallHint() {
  const { t } = useTranslation();
  const install = useInstall();
  if (install.kind === 'none') return <FullscreenToggle />;
  return (
    <section className="mt-4 border-t-2 border-dashed border-current/25 pt-3">
      <h3 className="text-xl font-bold">{t('pwa.installTitle')}</h3>
      <p className="mt-1 text-base leading-snug opacity-85">{t('pwa.installText')}</p>
      {install.kind === 'prompt' ? (
        <PxButton tone="gold" className="mt-3 w-full text-lg" onClick={(e) => (e.stopPropagation(), void install.install())}>
          {t('pwa.installButton')}
        </PxButton>
      ) : (
        <ol className="mt-2 space-y-2 text-base leading-snug">
          <li className="flex items-center gap-2">
            <span className="font-bold">1.</span> <ShareIcon /> {t(install.ipad ? 'pwa.iosStep1Pad' : 'pwa.iosStep1')} {!install.ipad && <DownArrow />}
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold">2.</span> <AddIcon /> {t('pwa.iosStep2')}
          </li>
        </ol>
      )}
      <FullscreenToggle />
    </section>
  );
}
