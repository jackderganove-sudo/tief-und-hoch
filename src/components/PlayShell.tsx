import type { ReactNode } from 'react';
import type { Mode } from '../domain/types';
import { PixelWorld, type WorldFx } from '../pixel/PixelWorld';
import { Panel, PxButton, type ButtonTone, type PanelTone } from './px';

/** Rahmen, Knöpfe und Felder je Modus – Höhle: Stein, Himmel: Holz. */
export function modeTheme(mode: Mode) {
  const rare = mode === 'rare';
  return {
    rare,
    panel: (rare ? 'stone' : 'wood') as PanelTone,
    primary: (rare ? 'teal' : 'coral') as ButtonTone,
    secondary: (rare ? 'stone' : 'wood') as ButtonTone,
    field: rare ? 'px-field px-field-dark' : 'px-field px-field-light',
    accent: rare ? '#8be9fd' : '#e2603a',
  };
}

/**
 * Gemeinsamer Rahmen für die Spielbildschirme: Pixel-Welt im Hintergrund,
 * oben eine HUD-Leiste (Zurück, Titel/Frage, Meter), darunter der Inhalt.
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
  fx,
  children,
}: {
  mode: Mode;
  /** 0 … 7000 – Tiefe bzw. Höhe der Figur. */
  meters: number;
  locale: string;
  title: ReactNode;
  backLabel: string;
  onBack: () => void;
  /** z. B. "Frage 3 von 7" */
  info?: ReactNode;
  /** Zeile unter der HUD-Leiste, z. B. Fortschritt */
  strip?: ReactNode;
  /** Effekt nach einer Antwort (Partikel, Reaktion der Figur). */
  fx?: WorldFx | null;
  children: ReactNode;
}) {
  const theme = modeTheme(mode);
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PixelWorld view={mode} meters={meters} fx={fx} />

      <div className="relative z-20 mx-auto flex h-full max-w-xl flex-col overflow-y-auto px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <header className="flex items-stretch gap-2">
          <PxButton tone={theme.secondary} small onClick={onBack} aria-label={backLabel} className="shrink-0 text-base">
            ←
          </PxButton>
          <Panel tone={theme.panel} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 leading-none">
            <span className="truncate font-bold">{title}</span>
            {info && <span className="shrink-0 text-sm tabular-nums opacity-80">{info}</span>}
          </Panel>
          <Panel tone={theme.panel} className="flex shrink-0 items-center px-1 font-bold leading-none tabular-nums">
            {mode === 'rare' && meters > 0 ? '−' : ''}
            {new Intl.NumberFormat(locale).format(meters)} m
          </Panel>
        </header>
        {/* Bei sehr niedriger Höhe (Bildschirmtastatur offen) Fortschritt ausblenden, damit das Eingabefeld sichtbar bleibt */}
        {strip && <div className="mt-2 [@media(max-height:520px)]:hidden">{strip}</div>}
        <div className="mt-3 [@media(max-height:520px)]:mt-2">{children}</div>
      </div>
    </div>
  );
}
