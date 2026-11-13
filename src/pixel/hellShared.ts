/**
 * Gemeinsame Bausteine der Höllen-Renderer (hell.ts: Hölle bis zum Tor, deep.ts: Eis-Hölle,
 * Kristall-Hölle, Abgrund). Diese Datei ist die feste Schnittstelle zwischen beiden.
 */
import type { Sprite } from './sprites';
import { caveZoneAt, GATE_M, HELL_M, type CaveZone } from './zones';

export const PPM = 0.5;
export const HW = 48;

export type Level = 'hell' | 'icehell' | 'crystalhell' | 'abyss';
export type DeepLevel = Exclude<Level, 'hell'>;

export interface Palette {
  /** Hintergrund oben/unten (wechselt langsam mit der Tiefe) */
  bg: [string, string];
  far: [string, string];
  /** Säulen: dunkel, mittel, hell, Randlicht */
  col: [string, string, string, string];
  /** Feuersee: dunkel → hell */
  lake: [string, string, string, string, string];
  rune: string;
  flame: [string, string, string];
  /** Rampe für Teufelchen (dunkel → hell) */
  imp: string[];
  steam: string[];
}

/** Dunkelheit über der Riesenhöhle: [Deckkraft, Farbton] (world.ts legt sie über alles, Lichter stanzen aus). */
export type Darkness = [number, [number, number, number]];

/**
 * Wie dicht hell.ts seine gemeinsamen Bauteile in einer Tiefe zeichnet (0 = gar nicht, 1 = wie in
 * der Hölle). deep.ts legt die Werte je Tiefe fest; hell.ts richtet sich danach (mit Überblendung).
 */
export interface SharedParts {
  farColumns: number;
  midColumns: number;
  ledges: number;
  imps: number;
  chains: number;
  spirits: number;
  steam: number;
  torches: number;
}

/** Licht: x, y, Radius, Farbe; baked = Schein liegt schon in einem vorberechneten Bild. */
export type Light = [number, number, number, string?, boolean?];

/** Hintergrundverlauf der Hölle (hell.ts nutzt ihn, deep.ts für den Dunst am Höllentor). */
export const HELL_BG: [string, string] = ['#341028', '#1c0816'];

export const LEVELS: Level[] = ['hell', 'icehell', 'crystalhell', 'abyss'];
export const levelAt = (m: number): Level => {
  const z = caveZoneAt(Math.max(m, HELL_M + 1));
  return (LEVELS as CaveZone[]).includes(z) ? (z as Level) : 'hell';
};

/** Ebene(n) an einer Tiefe mit Überblendanteil der unteren Ebene (±200 m um jede Grenze). */
export function levelBlend(m: number): { a: Level; b: Level; t: number } {
  const a = levelAt(m - 200);
  const b = levelAt(m + 200);
  if (a === b) return { a, b, t: 0 };
  const edge = m < GATE_M + 1000 ? GATE_M : GATE_M + Math.round((m - GATE_M) / 2000) * 2000;
  return { a, b, t: Math.max(0, Math.min(1, (m - (edge - 200)) / 400)) };
}

export const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Alles, was ein Höllen-Renderer pro Bild bekommt (Bildschirm-Koordinaten wie in world.ts). */
export interface HellFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  ox: number;
  oy: number;
  camX: number;
  camY: number;
  anchorY: number;
  time: number;
  calm: boolean;
  /** Bildschirm-y der Figur (Teufelchen winken, wenn sie vorbeikommt) */
  explorerY: number;
  lights: Light[];
  sign: (text: string) => Sprite;
}
