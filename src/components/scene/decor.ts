import { mulberry32 } from '../../domain/daily';

/**
 * Deterministisch erzeugte Deko für die Szenen – sieht bei jedem Laden gleich aus.
 * Koordinaten in Prozent der "Welt" (x: Breite, y: Höhe der hohen Szenen-Spalte).
 */
export interface DecorItem {
  kind: string;
  x: number;
  y: number;
  /** Größe in vmin */
  s: number;
  /** zusätzliche Zufallszahl 0–1 (Farbe, Drehung, Verzögerung …) */
  r: number;
  flip?: boolean;
}

/** Welt ist 6 Bildschirmhöhen hoch; die Kamera fährt 5 davon. */
export const WORLD_SCREENS = 6;
export const CAMERA_SPAN = ((WORLD_SCREENS - 1) / WORLD_SCREENS) * 100;
const ZONE = 100 / WORLD_SCREENS;

function scatter(
  rand: () => number,
  kind: string,
  count: number,
  yFrom: number,
  yTo: number,
  size: [number, number],
  xRange: 'walls' | 'center' | 'any' = 'any',
): DecorItem[] {
  return Array.from({ length: count }, () => {
    let x: number;
    if (xRange === 'walls') x = rand() < 0.5 ? 4 + rand() * 14 : 82 + rand() * 14;
    else if (xRange === 'center') x = 25 + rand() * 50;
    else x = 6 + rand() * 88;
    return {
      kind,
      x,
      y: yFrom + rand() * (yTo - yFrom),
      s: size[0] + rand() * (size[1] - size[0]),
      r: rand(),
      flip: rand() < 0.5,
    };
  });
}

export function caveDecor(): DecorItem[] {
  const rand = mulberry32(0xcafe);
  return [
    ...scatter(rand, 'grass', 22, ZONE * 0.5 - 0.3, ZONE * 0.5, [2.5, 5]),
    ...scatter(rand, 'root', 7, ZONE * 0.55, ZONE * 1.1, [8, 16], 'walls'),
    ...scatter(rand, 'moss', 26, ZONE * 1, ZONE * 2.1, [4, 9], 'walls'),
    ...scatter(rand, 'rock', 18, ZONE * 2, ZONE * 3, [4, 10]),
    ...scatter(rand, 'crystal', 20, ZONE * 3, ZONE * 4.05, [6, 14], 'walls'),
    ...scatter(rand, 'crystal', 5, ZONE * 3.2, ZONE * 4, [4, 7], 'any'),
    ...scatter(rand, 'shroom', 22, ZONE * 4, ZONE * 5.05, [5, 11], 'walls'),
    ...scatter(rand, 'spore', 26, ZONE * 4, ZONE * 5, [0.5, 1.2]),
    ...scatter(rand, 'ember', 34, ZONE * 5.2, 99, [0.5, 1.4]),
    ...scatter(rand, 'dust', 30, ZONE * 1, ZONE * 4, [0.3, 0.7]),
  ];
}

export function skyDecor(): DecorItem[] {
  const rand = mulberry32(0xb100);
  return [
    ...scatter(rand, 'star', 90, 0, ZONE * 1.7, [0.25, 0.8]),
    ...scatter(rand, 'star', 25, ZONE * 1.7, ZONE * 2.1, [0.2, 0.5]),
    ...scatter(rand, 'cloud', 8, ZONE * 1.8, ZONE * 2.6, [18, 34]),
    ...scatter(rand, 'cloud', 14, ZONE * 2.6, ZONE * 4.1, [20, 42]),
    ...scatter(rand, 'cloud', 5, ZONE * 4.1, ZONE * 4.7, [16, 26]),
    ...scatter(rand, 'bird', 9, ZONE * 4.6, ZONE * 5.4, [2, 3.5]),
    // Wald am Boden: Stämme stehen auf der Grasnarbe (~92,5 %), Kronen ragen hoch.
    ...scatter(rand, 'tree', 9, 92.9, 93.4, [30, 52]),
    ...scatter(rand, 'tree', 12, 93.6, 94.6, [22, 36]),
    ...scatter(rand, 'flower', 30, ZONE * 5.6, 98.5, [0.8, 1.6]),
  ];
}
