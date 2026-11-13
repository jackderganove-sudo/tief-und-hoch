/**
 * Zonen der Welt in Metern (1 Punkt = 10 m). Eine Stelle für Welt, Systemleisten,
 * Debug, Erfolge – Grenzen nach echten Tagesrunden später hier nachjustieren.
 *
 * Annahmen (Stand 13.11.2026, nur wenige echte Runden):
 *  - Abstieg: Ø ≈ 190 Punkte (1.900 m), oberes Drittel ab ≈ 230, beste ~12 % ab ≈ 300.
 *  - Aufstieg: Ø ≈ 430 Punkte (4.300 m), oberes Drittel ab ≈ 470, beste ~12 % ab ≈ 540.
 *  - Bei 7.000 m (700 = perfekte Runde) steht das Tor; darunter/darüber geht es endlos weiter.
 */

export type CaveZone = 'earth' | 'rock' | 'crystal' | 'shroom' | 'lava' | 'hell' | 'icehell' | 'crystalhell' | 'abyss';
export type SkyZone = 'meadow' | 'clouds' | 'wind' | 'sunset' | 'stars' | 'deck' | 'heaven' | 'crystalclouds' | 'aurora' | 'space';

/** Abstieg: Zone gilt bis zur angegebenen Tiefe (exklusiv). */
export const DESCENT: [number, CaveZone][] = [
  [300, 'earth'],
  [900, 'rock'],
  [1600, 'crystal'],
  [2300, 'shroom'],
  [3100, 'lava'],
  [7000, 'hell'],
];
/** Lavafall/Lavaröhre: hier seilt sich die Figur durch die Lava in die Hölle ab. */
export const LAVAFALL: [number, number] = [2850, 3100];
export const HELL_M = 3100;
export const GATE_M = 7000;
/** Endlos unter dem Höllentor: Ebenen wiederholen sich in dieser Reihenfolge. */
export const DEEP_LEVELS: CaveZone[] = ['icehell', 'crystalhell', 'abyss'];
export const LEVEL_SPAN = 2000;

/** Aufstieg: Zone gilt bis zur angegebenen Höhe (exklusiv). */
export const ASCENT: [number, SkyZone][] = [
  [1200, 'meadow'],
  [2500, 'clouds'],
  [3700, 'wind'],
  [4600, 'sunset'],
  [5300, 'stars'],
  [5500, 'deck'],
  [7000, 'heaven'],
];
export const DECK_M = 5300;
export const HEAVEN_M = 5500;
export const HIGH_LEVELS: SkyZone[] = ['crystalclouds', 'aurora', 'space'];

export function caveZoneAt(m: number): CaveZone {
  for (const [limit, zone] of DESCENT) if (m < limit) return zone;
  const k = Math.floor((m - GATE_M) / LEVEL_SPAN);
  return DEEP_LEVELS[k % DEEP_LEVELS.length];
}

export function skyZoneAt(m: number): SkyZone {
  for (const [limit, zone] of ASCENT) if (m < limit) return zone;
  const k = Math.floor((m - GATE_M) / LEVEL_SPAN);
  // Weltraum bleibt, wenn man ihn erreicht hat
  return HIGH_LEVELS[Math.min(k, HIGH_LEVELS.length - 1)];
}

/** Die Hölle-Familie (offene Riesenhöhle statt Schacht). */
export const isHellish = (z: CaveZone) => z === 'hell' || z === 'icehell' || z === 'crystalhell' || z === 'abyss';

/** Grenzen einer Höhlen-Zone um die Tiefe m (für weiche Übergänge). */
export function caveBoundaries(fromM: number, toM: number): number[] {
  const out: number[] = [];
  for (const [limit] of DESCENT) if (limit > fromM && limit < toM) out.push(limit);
  for (let b = GATE_M + LEVEL_SPAN; b < toM; b += LEVEL_SPAN) if (b > fromM) out.push(b);
  return out;
}

/** Erfolge: erstes Erreichen in einer Tagesrunde. */
export type Milestone = 'hell' | 'heaven';
export function milestoneOf(mode: 'rare' | 'common', meters: number): Milestone | null {
  if (mode === 'rare') return meters >= HELL_M ? 'hell' : null;
  return meters >= HEAVEN_M ? 'heaven' : null;
}
