import { useTranslation } from 'react-i18next';
import type { Mode } from '../domain/types';

/** Farben passend zum Panel: Holz (Aufstieg) bzw. Stein (Abstieg). */
const COLORS: Record<Mode, { edge: string; fill: string; light: string; text: string }> = {
  common: { edge: '#3a2416', fill: '#c98a4b', light: '#e7b77a', text: '#fff3d6' },
  rare: { edge: '#0e0a16', fill: '#3b3552', light: '#5a5276', text: '#8be9fd' },
};

/** Ein Pixel des Badges in CSS-Pixeln – ganzzahlig, damit alles scharf bleibt. */
const P = 2;

/**
 * Winziges Pixel-Badge „KI“/„AI“ neben einer KI-geprüften Antwort.
 * Quadratisch, Ecken um einen Pixel abgeschnitten. Tooltip per `title`,
 * auf Touch-Geräten schaltet Antippen den Hinweis (`onToggle`) um.
 */
export function AiBadge({ mode, open = false, onToggle }: { mode: Mode; open?: boolean; onToggle?: () => void }) {
  const { t } = useTranslation();
  const c = COLORS[mode];
  // 13 Badge-Pixel: 1 Pixel Rand, 11 Pixel Fläche (Platz für zwei Silkscreen-Buchstaben)
  const size = 13 * P;
  const cut = `polygon(${P}px 0, calc(100% - ${P}px) 0, 100% ${P}px, 100% calc(100% - ${P}px), calc(100% - ${P}px) 100%, ${P}px 100%, 0 calc(100% - ${P}px), 0 ${P}px)`;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t('game.aiBadgeHint')}
      aria-label={t('game.aiBadgeHint')}
      aria-expanded={onToggle ? open : undefined}
      className="relative -top-[2px] mx-1 inline-grid shrink-0 cursor-help place-items-center align-middle"
      style={{ width: size, height: size, background: c.edge, clipPath: cut }}
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
  );
}
