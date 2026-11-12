/**
 * Feste Farben für die System-Leisten (theme-color) je Ort – statt einen Pixel
 * abzugreifen: Himmel nach Höhe, Höhle nach Zone (dunkel, im Ton der Zone).
 */
import { CAVE_ZONES } from './world';

/** Himmel: Farbe ab dieser Höhe (m) – entspricht dem oberen Bildrand. */
const SKY_BAR: [number, string][] = [
  [0, '#2fbdff'],
  [1500, '#2a9df0'],
  [3000, '#2f6fe4'],
  [3800, '#7a6fd4'],
  [4300, '#e8857a'],
  [4700, '#c94a78'],
  [5300, '#5a3480'],
  [5900, '#1e1a4a'],
  [6500, '#0b0b22'],
];

/** Höhle: dunkel, aber erkennbar im Ton der Zone. */
export const CAVE_BAR = {
  earth: '#1d130e',
  rock: '#151827',
  crystal: '#2a1247',
  shroom: '#082528',
  lava: '#3d0f08',
} as const;

/** Neutraler dunkler Ton (Manifest, Admin, untere Leiste). */
export const NEUTRAL_BAR = '#16121f';

/** Bis zu dieser Tiefe sieht man oben noch den Himmel über dem Schacht. */
const SURFACE_M = 120;

export function systemBarColor(view: 'home' | 'rare' | 'common', meters: number): string {
  if (view === 'rare' && meters > SURFACE_M) {
    for (const [limit, zone] of CAVE_ZONES) if (meters < limit) return CAVE_BAR[zone];
    return CAVE_BAR.lava;
  }
  // oberer Bildrand liegt beim Aufstieg ein Stück über dem Ballon
  const top = view === 'common' ? meters + 600 : 0;
  let color = SKY_BAR[0][1];
  for (const [m, c] of SKY_BAR) if (top >= m) color = c;
  return color;
}
