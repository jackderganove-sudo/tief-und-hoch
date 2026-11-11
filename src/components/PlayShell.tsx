import type { ReactNode } from 'react';
import type { Mode } from '../domain/types';
import { MAX_POINTS, METERS_PER_POINT } from '../domain/scoring';
import { CaveScene } from './scene/CaveScene';
import { SkyScene } from './scene/SkyScene';
import { DepthGauge } from './DepthGauge';

/** Farben der Karten/Knöpfe je Modus – von Spiel- und Übungsbildschirm geteilt. */
export function modeTheme(mode: Mode) {
  const rare = mode === 'rare';
  return {
    rare,
    text: rare ? 'text-cream' : 'text-[#1d2a52]',
    card: rare ? 'bg-cave-900/70 ring-1 ring-white/10' : 'bg-white/70 ring-1 ring-white/70',
    primary: rare ? 'bg-glow-crystal text-cave-950' : 'bg-balloon text-white',
    ghost: rare ? 'bg-white/10 hover:bg-white/20' : 'bg-white/50 hover:bg-white/70',
  };
}

/**
 * Gemeinsamer Rahmen für alle Spielbildschirme: Szene im Hintergrund,
 * Höhenmesser rechts, Kopfzeile, darunter der Inhalt.
 */
export function PlayShell({
  mode,
  meters,
  locale,
  title,
  backLabel,
  onBack,
  info,
  strip,
  children,
}: {
  mode: Mode;
  /** 0 … 7000 – bestimmt Kamera und Höhenmesser. */
  meters: number;
  locale: string;
  title: ReactNode;
  backLabel: string;
  onBack: () => void;
  /** Rechts in der Kopfzeile, z. B. "Frage 3 von 7". */
  info?: ReactNode;
  /** Zeile unter der Kopfzeile, z. B. Fortschritts-Punkte. */
  strip?: ReactNode;
  children: ReactNode;
}) {
  const theme = modeTheme(mode);
  const progress = meters / (MAX_POINTS * METERS_PER_POINT);
  return (
    <div className={`relative h-dvh w-full overflow-hidden ${theme.text}`}>
      {theme.rare ? <CaveScene progress={progress} /> : <SkyScene progress={progress} />}

      <div className="pointer-events-none absolute bottom-[8%] right-1 top-[18%] z-30">
        <DepthGauge mode={mode} meters={meters} locale={locale} />
      </div>

      <div className="relative z-20 mx-auto flex h-full max-w-xl flex-col overflow-y-auto px-4 pb-6 pr-14 pt-[max(1rem,env(safe-area-inset-top))] sm:pr-16">
        <header className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className={`rounded-full px-3 py-1.5 text-sm font-medium backdrop-blur ${theme.ghost}`}>
            ← {backLabel}
          </button>
          <p className="font-display text-lg font-semibold">{title}</p>
          <p className="min-w-16 text-right text-sm tabular-nums opacity-80">{info}</p>
        </header>
        {strip && <div className="mt-3">{strip}</div>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
