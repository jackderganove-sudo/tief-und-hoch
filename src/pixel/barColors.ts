/**
 * Feste Farben für die System-Leisten (theme-color) je Ort – statt einen Pixel
 * abzugreifen: Himmel nach Höhe, Höhle nach Zone (dunkel, im Ton der Zone).
 */
import { caveZoneAt, type CaveZone } from './zones';

/** Himmel: Farbe ab dieser Höhe (m) – entspricht dem oberen Bildrand. */
const SKY_BAR: [number, string][] = [
  [0, '#2fbdff'],
  [1300, '#2a9df0'],
  [2700, '#2f6fe4'],
  [3500, '#7a6fd4'],
  [3900, '#e8857a'],
  [4300, '#c94a78'],
  [4700, '#5a3480'],
  [5000, '#1e1a4a'],
  [5250, '#0b0b22'],
  // leuchtende Wolkendecke und Himmel
  [5500, '#c98bb0'],
  [5700, '#ffd9a0'],
  [6200, '#fff1c8'],
  // endlos: Kristallwolken, Polarlicht, Weltraum
  [7600, '#b8d8ff'],
  [9600, '#0c1830'],
  [11600, '#05040c'],
];

/** Höhle: dunkel, aber erkennbar im Ton der Zone. */
export const CAVE_BAR: Record<CaveZone, string> = {
  earth: '#1d130e',
  rock: '#151827',
  crystal: '#2a1247',
  shroom: '#082528',
  lava: '#3d0f08',
  hell: '#2a0820',
  icehell: '#0c1a30',
  crystalhell: '#200c3a',
  abyss: '#08060e',
};

/** Neutraler dunkler Ton (Manifest, Admin, untere Leiste). */
export const NEUTRAL_BAR = '#16121f';

/** Bis zu dieser Tiefe sieht man oben noch den Himmel über dem Schacht. */
const SURFACE_M = 120;

export function systemBarColor(view: 'home' | 'rare' | 'common', meters: number): string {
  if (view === 'rare' && meters > SURFACE_M) return CAVE_BAR[caveZoneAt(meters)];
  // oberer Bildrand liegt beim Aufstieg ein Stück über dem Ballon
  const top = view === 'common' ? meters + 600 : 0;
  let color = SKY_BAR[0][1];
  for (const [m, c] of SKY_BAR) if (top >= m) color = c;
  return color;
}
