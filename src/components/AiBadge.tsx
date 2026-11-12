import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Mode } from '../domain/types';

/** Farben passend zum Panel: Holz (Aufstieg) bzw. Stein (Abstieg). */
const COLORS: Record<Mode, { edge: string; fill: string; light: string; text: string; tipBg: string; tipText: string }> = {
  common: { edge: '#3a2416', fill: '#c98a4b', light: '#e7b77a', text: '#fff3d6', tipBg: '#f5e2bc', tipText: '#3a2416' },
  rare: { edge: '#0e0a16', fill: '#3b3552', light: '#5a5276', text: '#8be9fd', tipBg: '#2a2538', tipText: '#ece6f5' },
};

/** Ein Pixel des Badges in CSS-Pixeln – ganzzahlig, damit alles scharf bleibt. */
const P = 2;
const cut = (p: number) =>
  `polygon(${p}px 0, calc(100% - ${p}px) 0, 100% ${p}px, 100% calc(100% - ${p}px), calc(100% - ${p}px) 100%, ${p}px 100%, 0 calc(100% - ${p}px), 0 ${p}px)`;

/**
 * Winziges Pixel-Badge „KI“/„AI“ neben einer KI-geprüften Antwort.
 * Quadratisch, Ecken um einen Pixel abgeschnitten. Die Erklärung gibt es nur
 * als Tooltip: beim Darüberfahren (Maus) bzw. Antippen (Touch) – sie schwebt
 * über dem Inhalt und verschiebt nichts.
 */
export function AiBadge({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const c = COLORS[mode];
  const ref = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const pointerType = useRef<string>('');
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const hint = t('game.aiBadgeHint');
  // 13 Badge-Pixel: 1 Pixel Rand, 11 Pixel Fläche (Platz für zwei Silkscreen-Buchstaben)
  const size = 13 * P;

  // Position: über dem Badge, horizontal im Bildschirm gehalten; zu wenig Platz oben → darunter
  useLayoutEffect(() => {
    if (!open || !ref.current || !tipRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.round(Math.min(Math.max(r.left + r.width / 2 - tip.width / 2, margin), window.innerWidth - tip.width - margin));
    const below = r.top - tip.height - 6 < margin;
    const top = Math.round(below ? r.bottom + 6 : r.top - tip.height - 6);
    setPos({ left, top, below });
  }, [open]);

  // Schließen bei Tipp daneben, Escape, Scrollen oder Größenänderung
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onPointerDown={(e) => (pointerType.current = e.pointerType)}
        // Maus: Hover öffnet, Klick lässt offen. Touch/Tastatur: Antippen schaltet um.
        onClick={() => (pointerType.current === 'mouse' ? setOpen(true) : setOpen((v) => !v))}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
        onBlur={() => setOpen(false)}
        aria-label={hint}
        aria-expanded={open}
        className="relative -top-[2px] mx-1 inline-grid shrink-0 cursor-help place-items-center align-middle"
        style={{ width: size, height: size, background: c.edge, clipPath: cut(P) }}
      >
        <span
          aria-hidden
          className="grid place-items-center font-tiny leading-none"
          style={{
            width: size - 2 * P,
            height: size - 2 * P,
            background: c.fill,
            boxShadow: `inset 0 ${P}px 0 ${c.light}`,
            color: c.text,
            // Silkscreen ist auf 8 px gezeichnet: 8 · P px = ein Schriftpixel pro Badge-Pixel
            fontSize: 8 * P,
            paddingLeft: P,
          }}
        >
          {t('game.aiBadge')}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-[15rem] text-left text-sm leading-snug"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              background: c.edge,
              padding: P,
              clipPath: cut(P),
            }}
          >
            <div style={{ background: c.tipBg, color: c.tipText, padding: `${3 * P}px ${4 * P}px` }}>{hint}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
