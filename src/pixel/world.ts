/**
 * Die Spielwelt als ein durchgehender Querschnitt:
 * y = 0 ist die Erdoberfläche, darüber der Himmel (Aufstieg), darunter die Höhle (Abstieg).
 * 1 Meter = 0,5 Welt-Pixel. Alle Zonen hängen fest an Metern.
 *
 * Gezeichnet wird in ein kleines Canvas (ca. 200–360 px breit), das per CSS
 * ganzzahlig und ohne Glättung hochskaliert wird. Alle Positionen werden gerundet.
 */
import type { Images } from './assets';
import { caveZoneAt, HELL_M, LAVAFALL, type CaveZone } from './zones';
import { HELL_DARK, HellRenderer } from './hell';
import { DEEP_DARK } from './deep';
import { HeavenRenderer, MidSkyRenderer, type SkyFrame } from './heaven';
import { Interact, Rig, type FxFrame, type Rect } from './interact';
import { CaveFx } from './caveFx';
import { SkyFx } from './skyFx';
import { cobweb, crystalCluster, fossil, pebbles, roots, rng, shroomPatch, vine, worm } from './decor';
import {
  balloonSprite,
  batSprites,
  birdSprites,
  buoySprite,
  canvas,
  cloudSprite,
  CRYSTAL_COLORS,
  explorerSprites,
  flipX,
  lerpColor,
  lightMask,
  moonSprite,
  rampMap,
  recolor,
  satelliteSprite,
  signSprite,
  sunSprite,
  miniBalloonSprite,
  type Sprite,
} from './sprites';

export const PPM = 0.5; // Pixel pro Meter
const T = 16; // Kachelgröße
const HW = 48; // halbe Schachtbreite in px (3 Kacheln je Seite)
export const BALLOON_X = 104; // Startplatz des Ballons rechts neben dem Höhleneingang
/** Ab dieser Kachelzeile öffnet sich der Schacht in die Hölle (Riesenhöhle, eigene Zeichnung). */
const HELL_ROW = Math.round((HELL_M * PPM) / T);
/** Ballon-Neigung: Zeilenbereiche des Sprites und wie stark sie mitgehen. */
const BALLOON_SHEAR: [number, number, number][] = [
  [0, 12, 1],
  [12, 24, 0.8],
  [24, 36, 0.6],
  [36, 49, 0.4],
  [49, 56, 0.15],
  [56, 62, -0.05],
  [62, 74, -0.3],
];

/** Schacht-Zwischenspeicher: Zeilen je Abschnitt und mitgezeichnete Nachbarzeilen (Überhang). */
const CHUNK_ROWS = 16;
const CHUNK_MARGIN = 5;
/** Rand der Leucht-Bilder (Schein ragt über den Abschnitt hinaus) und Stärke des Scheins. */
const GLOW_PAD = 48;
const GLOW_ALPHA = 0.14;
/** Licht: x, y, Radius, Farbe; baked = Schein liegt schon im Leucht-Bild des Abschnitts. */
type Light = [number, number, number, string?, boolean?];
/** Feststehender Schachtabschnitt: Bild, Leucht-Bild, Lichtmaske (für die Dunkelheit) und seine Lichter. */
type Chunk = { img: Sprite; glow: Sprite | null; mask: Sprite | null; lights: Light[] };

type Zone = CaveZone;
/** Zonen mit Schacht (über der Hölle). */
type ShaftZone = 'earth' | 'rock' | 'crystal' | 'shroom' | 'lava';
type Mood = 'idle' | 'cheer' | 'flinch';

export interface ViewState {
  /** Kamera-Mitte in Weltkoordinaten (px). */
  camX: number;
  camY: number;
  /** Bildschirm-y (virtuelle px), an dem camY liegt. */
  anchorY: number;
  /** Zeit in Sekunden (für Animationen). */
  time: number;
  /** Tiefe des Forschers in Metern (≥ 0). */
  depth: number;
  /** Höhe des Ballons in Metern (≥ 0). */
  altitude: number;
  explorerMood: Mood;
  balloonMood: Mood;
  /** Bewegt sich die Figur gerade? (Beine/Brenner) */
  explorerMoving: boolean;
  balloonRising: boolean;
  /** Ohne Umgebungsanimation (prefers-reduced-motion). */
  calm: boolean;
  /** Was zu sehen ist: Abstieg ohne Ballon, Aufstieg ohne Höhle/Forscher, Start mit beidem. */
  show: { explorer: boolean; balloon: boolean; cave: boolean };
  /** Welt-x des Ballons (Startseite: über dem Schacht, sonst sein Startplatz). */
  balloonX: number;
  /** Freunde-Modus: die anderen Spieler (eigene Seile bzw. Ballons). */
  crew?: CrewMember[];
}

/** Ein anderer Spieler in der Szene (Freunde-Modus). */
export interface CrewMember {
  /** Welt-x relativ zur eigenen Figur */
  x: number;
  meters: number;
  color: string;
  mood: Mood;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  /** leuchtet durch die Dunkelheit */
  glow: boolean;
}

const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));


/**
 * Dunkelheit je Zone: [Deckkraft, Farbton]. Leuchtende Zonen (Kristall, Pilze, Lava)
 * sind heller, damit man sie auch außerhalb der Stirnlampe erkennt.
 */
const ZONE_DARK: Record<Zone, [number, [number, number, number]]> = {
  earth: [0.8, [8, 5, 12]],
  rock: [0.64, [10, 14, 30]],
  crystal: [0.62, [20, 6, 40]],
  shroom: [0.62, [3, 20, 24]],
  lava: [0.48, [40, 8, 4]],
  // Hölle und Tiefen: Werte gehören zu hell.ts bzw. deep.ts
  hell: HELL_DARK,
  ...DEEP_DARK,
};

/** Gesteinstöne je Zone [dunkel, mittel, hell] – für Felsnasen, Einbettungen und Steine. */
const ROCK_TONES: Record<Zone, [string, string, string]> = {
  earth: ['#3a261c', '#5a3b2a', '#8a5a34'],
  rock: ['#2c2638', '#4a4060', '#6d6478'],
  crystal: ['#24143c', '#4a2a78', '#7a50b8'],
  shroom: ['#0c2a2c', '#1c4a48', '#3f8e7e'],
  lava: ['#2a0c0a', '#5a1c12', '#8a3418'],
  hell: ['#1a0a18', '#3a1630', '#6a2a48'],
  icehell: ['#0e1a2e', '#2a4a6e', '#8ab8e0'],
  crystalhell: ['#1c0c30', '#46207a', '#9a5ae0'],
  abyss: ['#08060e', '#1c1428', '#3a2a50'],
};

/** Weich zwischen den Zonen überblendet (±150 m um jede Grenze). */
function zoneDarkness(m: number): [number, [number, number, number]] {
  const a = caveZoneAt(m - 150);
  const b = caveZoneAt(m + 150);
  if (a === b) return ZONE_DARK[a];
  // Grenze liegt irgendwo im Fenster: Anteil der unteren Zone bestimmen
  let lo = m - 150;
  let hi = m + 150;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (caveZoneAt(mid) === a) lo = mid;
    else hi = mid;
  }
  const t = clamp((m - (lo - 150)) / 300);
  const [a0, c0] = ZONE_DARK[a];
  const [a1, c1] = ZONE_DARK[b];
  return [a0 + (a1 - a0) * t, [0, 1, 2].map((i) => Math.round(c0[i] + (c1[i] - c0[i]) * t)) as [number, number, number]];
}

/** Zone einer Kachelzeile. */
function zoneOfRow(row: number): Zone {
  return caveZoneAt((row * T) / PPM);
}

/** Felsvorsprung: alle ~11 Zeilen ragt von links oder rechts ein Sims in den Schacht. */
function ledgeOfRow(row: number): { side: -1 | 1; len: number; k: number } | null {
  if (row < 5 || row >= HELL_ROW - 3) return null;
  const k = Math.floor((row - 5) / 11);
  const base = 5 + k * 11 + Math.floor(hash(k, 3) * 5);
  if (row !== base) return null;
  return { side: hash(k, 5) < 0.5 ? -1 : 1, len: hash(k, 9) < 0.55 ? 2 : 1, k };
}

interface TileSet {
  img: CanvasImageSource;
  wallL: [number, number][]; // Fels links, Schacht rechts
  wallR: [number, number][];
  fill: [number, number][];
  detail: [number, number][];
  ledge: [number, number][];
  fringe: [number, number][];
}

// Himmelsfarbe nach "Sichthöhe" in Metern (Zonen siehe zones.ts): Wiese/Wald 0–1200,
// Wolken 1200–2500, Höhenwind 2500–3700, Abendrot 3700–4600, Sterne 4600–5300,
// leuchtende Wolkendecke 5300–5500, Himmel 5500–7000, darüber Kristallwolken, Polarlicht, Weltraum.
const SKY_STOPS: [number, string][] = [
  [0, ''], // wird beim Laden aus back.png gelesen
  [1200, ''], // Unterkante Wolkenband (bg-clouds)
  [2400, ''], // Oberkante Wolkenband
  [3150, '#2f6fe4'],
  [3450, '#6f7fe0'],
  [3700, '#c47fc4'],
  [3900, '#f79a7a'],
  [4100, '#f7a05e'],
  [4350, '#e2567c'],
  [4650, '#6c3c8c'],
  [4950, '#221d52'],
  [5250, '#0b0b22'],
  // Wolkendecke: Gold bricht durch
  [5380, '#3a2a5e'],
  [5470, '#c98bb0'],
  [5560, '#ffd9a0'],
  [5900, '#fff1c8'],
  [6600, '#fff8e4'],
  [7000, '#eaf4ff'],
  // Kristallwolken
  [7600, '#cfe4ff'],
  [8700, '#b4c4f0'],
  // Polarlicht (Nacht)
  [9150, '#1a2850'],
  [10600, '#0c1830'],
  // Weltraum
  [11300, '#05040c'],
];
/** Wie stark der Himmelsverlauf auf dem Bildschirm gestaucht ist (Ferne). */
const SKY_F = 0.25;

export class World {
  private img: Images;
  private sets: Record<ShaftZone, TileSet>;
  private bg: Record<ShaftZone, { far: CanvasPattern | null; mid: CanvasPattern | null; base: string; farH: number; midH: number }>;
  private explorer = explorerSprites();
  private balloons = new Map<string, Sprite>();
  private bats = batSprites();
  private signs = new Map<string, Sprite>();
  private buoy = buoySprite();
  private clouds: { alt: number; x: number; f: number; speed: number; sprite: Sprite }[] = [];
  private birds = birdSprites();
  private sun = sunSprite();
  private moon = moonSprite();
  private satellite = satelliteSprite();
  private eagleFlip: Sprite;
  private masks = new Map<number, Sprite>();
  private dark: Sprite;
  private darkCtx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private lights: Light[] = [];
  /** Wechselwirkung Welt ↔ Figur (siehe interact.ts). */
  readonly ix = new Interact();
  private caveFx: CaveFx;
  private skyFx: SkyFx;
  private chunks = new Map<string, Chunk>();
  /** Vorberechnete Leucht-Bilder der Abschnitte für dieses Bild: [Bild, y]. */
  private glowLayers: [Sprite, number][] = [];
  /** Vorberechnete Lichtmasken der Abschnitte für dieses Bild: [Bild, y]. */
  private maskLayers: [Sprite, number][] = [];
  private strips = new Map<string, Sprite | null>();
  /** Zwischenbild fürs Hitzeflimmern (statt den Haupt-Canvas viele Male auf sich selbst zu kopieren). */
  private shimmer: [Sprite, CanvasRenderingContext2D] = canvas(8, 8);
  private glowCache = new Map<string, Sprite>();
  private stars: [number, number, number][] = [];
  private stalactite: Sprite;
  private hell: HellRenderer;
  private heaven: HeavenRenderer;
  private midSky = new MidSkyRenderer();

  constructor(images: Images, ctx: CanvasRenderingContext2D) {
    this.img = images;
    const warped = images['warped/tilesets'];
    // Pilzgrotte und Lavakern: dieselben Kacheln, über eine Farbrampe umgefärbt
    const teal = recolor(warped, rampMap(['#06141a', '#0e3338', '#1c6660', '#3fae8e', '#b6f5d4']));
    const red = recolor(warped, rampMap(['#120608', '#3a0f10', '#7a2416', '#c9541e', '#ffc46a']));
    const warpedSet = (img: CanvasImageSource): TileSet => ({
      img,
      wallL: [[16, 8], [16, 9]],
      wallR: [[13, 8], [13, 9]],
      fill: [[14, 8], [15, 8], [14, 9], [15, 9]],
      detail: [],
      ledge: [[10, 7], [11, 7]],
      fringe: [[12, 3], [14, 3]],
    });
    const cavRows = [1, 2, 3, 4, 10, 11, 12, 13, 14];
    this.sets = {
      earth: {
        img: images['sunny/tileset'],
        wallL: [[5, 3]],
        wallR: [[1, 3]],
        fill: [[3, 3]],
        detail: [[7, 7], [5, 7]],
        ledge: [],
        fringe: [],
      },
      rock: {
        img: images['caverns/tiles'],
        wallL: cavRows.map((r) => [23, r]),
        wallR: cavRows.map((r) => [7, r]),
        fill: [[8, 1]],
        detail: [[8, 3], [12, 3], [9, 4], [9, 14], [11, 14]],
        ledge: [[10, 9], [11, 9], [14, 9], [15, 9]],
        fringe: [[10, 5], [11, 5], [14, 5], [15, 5]],
      },
      crystal: warpedSet(warped),
      shroom: warpedSet(teal),
      lava: warpedSet(red),
    };

    const pat = (src: CanvasImageSource) => ctx.createPattern(src, 'repeat');
    const wbg = images['warped/background'];
    const wmid = images['warped/middleground-no-fungus'];
    const wfung = images['warped/middleground'];
    const tealMap = rampMap(['#04121a', '#0a2a30', '#125a58', '#2f9f8a', '#9af0d0']);
    const redMap = rampMap(['#140506', '#3c0d0c', '#8a2412', '#e2641e', '#ffd27a']);
    const dimPink = rampMap(['#1c0b2e', '#3a1a5e', '#6a2f9a', '#b24fc8', '#f0a0e8']);
    this.bg = {
      earth: { far: null, mid: null, base: '#2e221f', farH: 1, midH: 1 },
      rock: { far: pat(images['caverns/background']), mid: null, base: '#241f38', farH: 288, midH: 1 },
      crystal: { far: pat(recolor(wbg, dimPink)), mid: pat(wmid), base: '#3a1a5e', farH: 176, midH: 176 },
      shroom: { far: pat(recolor(wbg, tealMap)), mid: pat(recolor(wfung, tealMap)), base: '#0a2a30', farH: 176, midH: 176 },
      lava: { far: pat(recolor(wbg, redMap)), mid: pat(recolor(wmid, redMap)), base: '#3c0d0c', farH: 176, midH: 176 },
    };

    this.stalactite = images['warped/stalactite'] as unknown as Sprite;

    // Himmelsfarben passend zu den Hintergrundbildern auslesen
    const sample = (im: HTMLImageElement, x: number, y: number) => {
      const [, c] = canvas(1, 1);
      c.drawImage(im, -x, -y);
      const d = c.getImageData(0, 0, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
    };
    SKY_STOPS[0][1] = sample(images['sunny/back'], 2, 0);
    SKY_STOPS[1][1] = sample(images['woods/bg-clouds'], 2, 206);
    SKY_STOPS[2][1] = sample(images['woods/bg-clouds'], 2, 1);

    // Schönwetterwolken über dem Wald; ab ≈1.100 m übernimmt MidSkyRenderer (heaven.ts)
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ alt: 450 + hash(i, 5) * 650, x: hash(i, 6) * 600, f: 0.7, speed: 3, sprite: cloudSprite(60 + i, 24 + Math.round(hash(i, 7) * 16)) });
    }
    for (let i = 0; i < 220; i++) this.stars.push([hash(i, 31), 4500 + hash(i, 32) * 1300, hash(i, 33)]);

    const sheet = images['sunny/eagle'];
    const [e, ex] = canvas(80, 41);
    ex.drawImage(sheet, 0, 0, 80, 41, 0, 0, 80, 41);
    this.eagleFlip = (() => {
      const [c2, x2] = canvas(80, 41);
      x2.drawImage(flipX(recolorNone(e, 0, 40)), 0, 0);
      x2.drawImage(flipX(recolorNone(e, 40, 40)), 40, 0);
      return c2;
    })();

    [this.dark, this.darkCtx] = canvas(8, 8);
    this.hell = new HellRenderer(images);
    this.heaven = new HeavenRenderer(images);
    this.caveFx = new CaveFx(images);
    this.skyFx = new SkyFx(images);
  }

  // ---------------------------------------------------------------- Effekte

  burst(kind: string, x: number, y: number, power = 1, calm = false) {
    const sets: Record<string, { colors: string[]; n: number; speed: number; gravity: number; life: number; size: number }> = {
      moss: { colors: ['#7ec850', '#4e9a3a', '#b8e86a'], n: 10, speed: 22, gravity: 40, life: 1.1, size: 1 },
      stone: { colors: ['#9a8fa8', '#6d6478', '#c8bfd2'], n: 12, speed: 30, gravity: 90, life: 0.9, size: 2 },
      crystal: { colors: CRYSTAL_COLORS.map((c) => c[1]).concat('#ffffff'), n: 22, speed: 38, gravity: 10, life: 1.4, size: 1 },
      ember: { colors: ['#ffb347', '#ff6a2b', '#ffe28a'], n: 26, speed: 34, gravity: -30, life: 1.5, size: 1 },
      core: { colors: ['#ffe28a', '#ff8a2b', '#ff4a2b', '#ffffff'], n: 60, speed: 62, gravity: -12, life: 1.9, size: 2 },
      tooClever: { colors: ['#f6d365', '#ffffff'], n: 14, speed: 24, gravity: -20, life: 1.2, size: 1 },
      invalid: { colors: ['#8a8f98', '#5a5f68'], n: 8, speed: 16, gravity: 60, life: 0.8, size: 1 },
      meadow: { colors: ['#ffd166', '#ff8fab', '#ffffff', '#7ec850'], n: 10, speed: 22, gravity: 30, life: 1.3, size: 1 },
      treetops: { colors: ['#7ec850', '#4e9a3a', '#c8e86a'], n: 16, speed: 30, gravity: 30, life: 1.4, size: 1 },
      clouds: { colors: ['#ffffff', '#dff1ff'], n: 16, speed: 26, gravity: -6, life: 1.4, size: 2 },
      sunset: { colors: ['#ffb36b', '#ff7eb6', '#ffe28a'], n: 28, speed: 40, gravity: 6, life: 1.6, size: 1 },
      stars: { colors: ['#fff6c2', '#8be9fd', '#ff9bd0', '#b8f05a', '#ffffff'], n: 0, speed: 0, gravity: 0, life: 0, size: 0 },
    };
    const set = sets[kind] ?? sets.invalid;
    if (calm) {
      // Reduzierte Bewegung: ruhiges Funkeln an Ort und Stelle, das nur ausblendet.
      const n = Math.max(6, Math.round(Math.min(set.n || 24, 24) * power));
      for (let i = 0; i < n; i++) {
        const a = hash(i, 3) * Math.PI * 2;
        const r = 6 + hash(i, 4) * 18;
        this.particles.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7, vx: 0, vy: 0, life: 0, max: 1.2, color: set.colors[i % set.colors.length], size: 1, gravity: 0, glow: kind !== 'invalid' && kind !== 'stone' });
      }
      return;
    }
    if (kind === 'stars') {
      // Feuerwerk: drei Raketen-Explosionen rund um den Ballon
      for (let b = 0; b < 4; b++) {
        const bx = x + (b - 1.5) * 34 + (hash(b, x) - 0.5) * 16;
        const by = y - 30 - hash(b, y) * 40;
        const col = set.colors[b % set.colors.length];
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const sp = 34 + (i % 3) * 9;
          this.particles.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: -b * 0.22, max: 1.5, color: i % 4 ? col : '#ffffff', size: 1, gravity: 26, glow: true });
        }
      }
      return;
    }
    const n = Math.round(set.n * power);
    for (let i = 0; i < n; i++) {
      const a = hash(i, n) * Math.PI * 2;
      const sp = set.speed * (0.4 + hash(i, 5));
      this.particles.push({
        x: x + (hash(i, 8) - 0.5) * 10,
        y: y + (hash(i, 9) - 0.5) * 10,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - set.speed * 0.3,
        life: 0,
        max: set.life * (0.6 + hash(i, 6) * 0.6),
        color: set.colors[i % set.colors.length],
        size: set.size,
        gravity: set.gravity,
        glow: kind !== 'invalid' && kind !== 'stone',
      });
    }
  }

  private ambient(v: ViewState, W: number, H: number, dt: number) {
    if (v.calm || this.particles.length > 260) return;
    const top = v.camY - v.anchorY;
    const centerDepth = (v.camY + H * 0.2) / PPM;
    if (v.camY > 60) {
      // Staub im Lampenlicht
      if (Math.random() < dt * 5)
        this.particles.push({ x: (Math.random() - 0.5) * HW * 1.8, y: top + Math.random() * H, vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 3, life: 0, max: 3, color: '#cfc6dc', size: 1, gravity: 0, glow: false });
      const zone = caveZoneAt(centerDepth);
      if (zone === 'lava' && Math.random() < dt * 14)
        this.particles.push({ x: (Math.random() - 0.5) * HW * 2, y: top + H + 4, vx: (Math.random() - 0.5) * 8, vy: -24 - Math.random() * 26, life: 0, max: 3.2, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2b', size: 1, gravity: -4, glow: true });
      if (centerDepth > LAVAFALL[0] - 100 && centerDepth < HELL_M + 300 && Math.random() < dt * 30)
        // Funkenregen: fällt von oben herab
        this.particles.push({ x: (Math.random() - 0.5) * HW * 2, y: top - 4, vx: (Math.random() - 0.5) * 10, vy: 30 + Math.random() * 30, life: 0, max: 2.4, color: Math.random() < 0.5 ? '#ffe28a' : '#ff8a2b', size: 1, gravity: 30, glow: true });
      if ((zone === 'hell' || zone === 'crystalhell' || zone === 'abyss') && Math.random() < dt * 6)
        this.particles.push({ x: (Math.random() - 0.5) * W, y: top + H + 4, vx: (Math.random() - 0.5) * 6, vy: -14 - Math.random() * 14, life: 0, max: 5, color: zone === 'hell' ? '#ff8a4a' : zone === 'crystalhell' ? '#f0a0ff' : '#a888ff', size: 1, gravity: -2, glow: true });
      if (zone === 'icehell' && Math.random() < dt * 10)
        // Eis-Hölle: Schneeflocken
        this.particles.push({ x: (Math.random() - 0.5) * W, y: top - 4, vx: (Math.random() - 0.5) * 8, vy: 10 + Math.random() * 10, life: 0, max: 8, color: '#e8f6ff', size: 1, gravity: 0, glow: true });
      if (zone === 'shroom' && Math.random() < dt * 5)
        this.particles.push({ x: (Math.random() - 0.5) * HW * 1.9, y: top + Math.random() * H, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8, life: 0, max: 4, color: Math.random() < 0.6 ? '#d8ff7a' : '#7af0d0', size: 1, gravity: 0, glow: true });
    }
  }

  private updateParticles(dt: number) {
    const out: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life < 0) {
        out.push(p);
        continue;
      }
      if (p.life >= p.max) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 0.8;
      out.push(p);
    }
    this.particles = out;
  }

  // ---------------------------------------------------------------- Zeichnen

  /** Antippen der Szene (Canvas-Koordinaten); wird im nächsten Bild beantwortet. */
  tap(x: number, y: number) {
    if (this.ix.taps.length < 4) this.ix.taps.push({ x, y, used: false });
  }

  /** UI-Flächen (Canvas-Koordinaten) und ob gerade eine Frage/Eingabe zu sehen ist. */
  setUi(avoid: Rect[], quiet: boolean) {
    this.ix.avoid = avoid;
    this.ix.quiet = quiet;
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, dt: number) {
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(W / 2 - v.camX); // Welt-x → Bildschirm
    const oy = Math.round(v.anchorY - v.camY); // Welt-y → Bildschirm
    const groundY = oy; // Bildschirm-y der Erdoberfläche
    this.lights.length = 0;
    this.glowLayers.length = 0;
    this.maskLayers.length = 0;
    const fx = this.beginInteract(ctx, W, H, v, ox, oy, dt);

    if (groundY > 0) {
      this.drawSky(ctx, W, H, v, ox, groundY);
      if (v.show.balloon) this.skyFx.back(fx);
    }
    if (groundY < H) {
      if (v.show.cave) {
        this.drawCave(ctx, W, H, v, ox, oy);
        this.hell.draw({
          ctx, W, H, ox, oy,
          camX: v.camX,
          camY: v.camY,
          anchorY: v.anchorY,
          time: v.time,
          calm: v.calm,
          explorerY: Math.round(v.depth * PPM) + oy,
          lights: this.lights,
          sign: (t) => this.sign(t),
        });
        this.caveFx.back(fx);
      } else this.drawGround(ctx, W, H, ox, oy);
    }
    if (groundY > -60 && groundY < H + 200) this.drawSurface(ctx, W, ox, groundY, v.show.cave);

    if (v.crew) for (const c of v.crew) v.show.cave ? this.drawCrewExplorer(ctx, v, c, ox, oy, groundY) : this.drawCrewBalloon(ctx, v, c, ox, groundY);
    if (v.show.explorer) this.drawExplorer(ctx, v, ox, oy, groundY);
    if (v.show.cave) this.caveFx.front(fx);
    if (v.show.balloon) this.drawBalloon(ctx, v, ox, groundY);

    // Wolken vor dem Ballon
    this.drawClouds(ctx, W, H, v, groundY, true);
    if (groundY > 0 && v.show.balloon) {
      const sky = this.skyFrame(ctx, W, H, v, ox, groundY);
      this.midSky.front(sky);
      this.heaven.front(sky);
      this.skyFx.front(fx);
    }

    this.ambient(v, W, H, dt);
    this.updateParticles(dt);
    for (const p of this.particles) {
      if (p.life < 0 || p.glow) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x) + ox, Math.round(p.y) + oy, p.size, p.size);
    }

    if (groundY < H && v.show.cave) this.drawDarkness(ctx, W, H, v, oy);
    if (v.show.cave && !v.calm) this.heatShimmer(ctx, W, H, v, oy);

    for (const p of this.particles) {
      if (p.life < 0 || !p.glow) continue;
      if (p.max - p.life < 0.25 && Math.floor(p.life * 30) % 2) continue; // flackert aus
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x) + ox, Math.round(p.y) + oy, p.size, p.size);
    }
    if (v.show.cave && groundY < H) this.caveFx.glow(fx);
    this.ix.end(dt, W);
  }

  /**
   * Anfang jedes Bilds: Anker von Figur und Ballon setzen, Antippen der Figur und Böen am
   * Ballon beantworten, ruhiges Eigenleben (Seil pendelt nach). Gibt den Rahmen für skyFx/caveFx.
   */
  private beginInteract(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, ox: number, oy: number, dt: number): FxFrame {
    const ix = this.ix;
    ix.calm = v.calm;
    ix.time = v.time;
    const ex = v.show.explorer ? ox + Math.round(ix.explorer.swing) : 0;
    const ey = Math.round(v.depth * PPM) + oy;
    ix.explorerAnchor = v.show.explorer ? { x: ex, y: ey, head: { x: ex - 4, y: ey - 9, w: 9, h: 5 }, lamp: { x: ex + 5, y: ey - 5, r: 72 } } : null;
    const bx = ox + v.balloonX;
    const by = oy - Math.round(v.altitude * PPM);
    ix.balloonAnchor = v.show.balloon ? { x: bx, y: by - 6, envelope: { x: bx - 22, y: by - 74, w: 45, h: 48 }, basket: { x: bx - 6, y: by - 12, w: 13, h: 12 } } : null;
    const crew = v.crew ?? [];
    while (ix.crew.length < crew.length) ix.crew.push(new Rig(14, 2.6, 4));
    ix.crewAnchors = crew.map((c, i) =>
      v.show.cave
        ? { x: ox + Math.round(c.x + ix.crew[i].swing), y: Math.round(c.meters * PPM) + oy }
        : { x: bx + Math.round(c.x), y: oy - Math.round(c.meters * PPM) - 15 },
    );

    // Antippen der Figur: Forscher winkt, Ballon-Brenner faucht
    const e = ix.explorerAnchor;
    if (e && ix.takeTap({ x: e.x - 9, y: e.y - 13, w: 19, h: 22 })) {
      ix.explorer.react('wave', 1.2, 1);
      ix.explorer.push(8);
    }
    const b = ix.balloonAnchor;
    if (b && ix.takeTap({ x: b.envelope.x - 4, y: b.envelope.y - 4, w: b.envelope.w + 8, h: 78 })) {
      ix.balloon.burner = 0.9;
      ix.balloon.react('wave', 1.2, 1);
    }

    // Böen: einmal je Ballon stoßen, Passagier hält sich fest
    if (b)
      for (const g of ix.wind.at(b.x, b.y - 36, 26)) {
        g.hit ??= new Set();
        if (g.hit.has(-1)) continue;
        g.hit.add(-1);
        const dir = g.vx >= 0 ? 1 : -1;
        ix.balloon.push(dir * (18 + 34 * g.strength));
        if (g.strength > 0.3) ix.balloon.react('hold', 0.6 + g.strength * 0.8, dir);
      }
    if (v.show.balloon)
      ix.crewAnchors.forEach((a, i) => {
        for (const g of ix.wind.at(a.x, a.y, 20)) {
          g.hit ??= new Set();
          if (g.hit.has(i)) continue;
          g.hit.add(i);
          ix.crew[i].push((g.vx >= 0 ? 1 : -1) * (14 + 26 * g.strength));
        }
      });

    // Seil pendelt leise nach; beim Losfahren/Anhalten kleiner Ruck
    if (v.show.explorer && !v.calm) {
      if (v.explorerMoving !== this.wasMoving) ix.explorer.push((Math.random() < 0.5 ? -1 : 1) * 7);
      else if (Math.random() < dt * 0.25) ix.explorer.push((Math.random() - 0.5) * 6);
    }
    this.wasMoving = v.explorerMoving;

    return {
      ctx,
      W,
      H,
      ox,
      oy,
      camY: v.camY,
      anchorY: v.anchorY,
      time: v.time,
      dt,
      calm: v.calm,
      depth: v.depth,
      altitude: v.altitude,
      show: v.show,
      lights: this.lights,
      ix,
    };
  }
  private wasMoving = false;

  /** Seil vom Holzgerüst und der Forscher mit Stirnlampe. */
  private drawExplorer(ctx: CanvasRenderingContext2D, v: ViewState, ox: number, oy: number, groundY: number) {
    const ey = Math.round(v.depth * PPM) + oy;
    const beamY = groundY - 34;
    const rig = this.ix.explorer;
    const swing = Math.round(rig.swing);
    ctx.fillStyle = '#d8b27a';
    const ropeTop = Math.max(-2, beamY);
    // unteres Seilstück biegt sich mit dem Pendeln (oben bleibt das Seil gerade)
    const bendLen = Math.min(56, Math.max(0, ey - 9 - ropeTop));
    const bendTop = ey - 9 - bendLen;
    if (ey - 9 > ropeTop) {
      ctx.fillRect(ox, ropeTop, 1, bendTop - ropeTop);
      for (let y = bendTop; y < ey - 9; y++) {
        const t = (y - bendTop) / Math.max(1, bendLen);
        ctx.fillRect(ox + Math.round(rig.swing * t * t), y, 1, 1);
      }
      ctx.fillStyle = '#a8824e';
      for (let y = ropeTop + ((oy % 4) + 4) % 4; y < bendTop; y += 4) ctx.fillRect(ox, y, 1, 1);
      // im Lavafall glüht das Seil kurz auf
      const g0 = Math.max(ropeTop, Math.round(LAVAFALL[0] * PPM) + oy);
      const g1 = Math.min(ey - 9, Math.round((LAVAFALL[1] + 60) * PPM) + oy);
      if (g1 > g0) {
        for (let y = g0; y < g1; y++) {
          ctx.fillStyle = (y + Math.floor(v.time * 20)) % 6 < 3 ? '#ffb347' : '#ff6a2b';
          ctx.fillRect(ox, y, 1, 1);
        }
        this.lights.push([ox, Math.round((g0 + g1) / 2), 18, '#ff8a2b']);
      }
    }
    const sway = swing + (v.calm || v.explorerMoving ? 0 : Math.round(Math.sin(v.time * 1.6) * 1));
    const pose = v.explorerMood === 'idle' ? rig.pose : null;
    const frame = pose
      ? pose === 'flinch' || pose === 'duck'
        ? this.explorer.flinch
        : pose === 'wave'
          ? Math.floor(v.time * 6) % 2
            ? this.explorer.cheer
            : this.explorer.hangB
          : this.explorer.hangB
      : v.explorerMood === 'cheer'
        ? Math.floor(v.time * 6) % 2
          ? this.explorer.cheer
          : this.explorer.hangB
        : v.explorerMood === 'flinch'
          ? this.explorer.flinch
          : v.explorerMoving && Math.floor(v.time * 8) % 2
            ? this.explorer.hangB
            : Math.floor(v.time * 1.2) % 2 && !v.calm
              ? this.explorer.hangB
              : this.explorer.hangA;
    const shake = v.explorerMood === 'flinch' || rig.jolt > 0 ? Math.round(Math.sin(v.time * 40) * 1) : 0;
    ctx.drawImage(frame, ox - 7 + sway + shake, ey - 9 + (pose === 'duck' ? 2 : 0));
    this.lights.push([ox + 5 + sway, ey - 5, 72, '#ffe9a8']);
  }

  /** Mitspieler im Abstieg: eigenes Seil, kleine Figur mit Hemd in Spielerfarbe. */
  private drawCrewExplorer(ctx: CanvasRenderingContext2D, v: ViewState, c: CrewMember, ox: number, oy: number, groundY: number) {
    const i = v.crew?.indexOf(c) ?? -1;
    const x = ox + Math.round(c.x) + (i >= 0 && this.ix.crew[i] ? Math.round(this.ix.crew[i].swing) : 0);
    const ey = Math.round(c.meters * PPM) + oy;
    const ropeTop = Math.max(-2, groundY - 34);
    ctx.fillStyle = '#b8935e';
    if (ey - 6 > ropeTop) ctx.fillRect(x, ropeTop, 1, ey - 6 - ropeTop);
    const bob = v.calm ? 0 : Math.round(Math.sin(v.time * 1.6 + c.x) * 1);
    const jump = c.mood === 'cheer' && Math.floor(v.time * 6) % 2 ? -2 : 0;
    const shake = c.mood === 'flinch' ? Math.round(Math.sin(v.time * 40) * 1) : 0;
    const fx = x - 3 + bob + shake;
    const fy = ey - 6 + jump;
    const r = (dx: number, dy: number, w: number, h: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(fx + dx, fy + dy, w, h);
    };
    r(1, 0, 5, 2, '#f2d03a'); // Helm
    r(3, 0, 1, 1, '#fff3a0'); // Lampe
    r(1, 2, 5, 2, '#f2c48d'); // Gesicht
    r(2, 2, 1, 1, '#2a2030');
    r(4, 2, 1, 1, '#2a2030');
    r(0, 4, 7, 3, c.color); // Hemd in Spielerfarbe
    if (c.mood === 'cheer') {
      r(0, 1, 1, 3, c.color);
      r(6, 1, 1, 3, c.color);
    }
    r(1, 7, 2, 2, '#3a2a40');
    r(4, 7, 2, 2, '#3a2a40');
    this.lights.push([x, fy + 2, 34, '#ffe9a8']);
  }

  private crewBalloons = new Map<string, Sprite>();
  /** Mitspieler im Aufstieg: kleiner Ballon in Spielerfarbe. */
  private drawCrewBalloon(ctx: CanvasRenderingContext2D, v: ViewState, c: CrewMember, ox: number, groundY: number) {
    let s = this.crewBalloons.get(c.color);
    if (!s) this.crewBalloons.set(c.color, (s = miniBalloonSprite(c.color)));
    const by = groundY - Math.round(c.meters * PPM);
    const bob = v.calm ? 0 : Math.round(Math.sin(v.time * 1.3 + c.x * 0.1) * 1.5);
    const shake = c.mood === 'flinch' ? Math.round(Math.sin(v.time * 36) * 1) : 0;
    const jump = c.mood === 'cheer' && Math.floor(v.time * 5) % 2 ? -2 : 0;
    const i = v.crew?.indexOf(c) ?? -1;
    const tilt = i >= 0 && this.ix.crew[i] ? Math.round(this.ix.crew[i].swing * 0.7) : 0;
    ctx.drawImage(s, ox + v.balloonX + Math.round(c.x) - 8 + shake + tilt, by - 30 + bob + jump);
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, v: ViewState, ox: number, groundY: number) {
    const by = groundY - Math.round(v.altitude * PPM);
    const bob = v.calm || v.altitude < 4 ? 0 : Math.round(Math.sin(v.time * 1.3) * 1.5);
    const rig = this.ix.balloon;
    const burn = v.balloonRising || rig.burner > 0 || (!v.calm && v.altitude > 4 && Math.floor(v.time * 0.6) % 4 === 0);
    const flame = burn ? 1 + (Math.floor(v.time * 12) % 3) : 0;
    // Pose des Passagiers: festhalten bei Böen (wie Zucken), winken beim Antippen (wie Jubel)
    const mood = v.balloonMood !== 'idle' ? v.balloonMood : rig.pose === 'hold' ? 'flinch' : rig.pose === 'wave' ? 'cheer' : 'idle';
    const key = `${flame}-${mood}`;
    let bs = this.balloons.get(key);
    if (!bs) this.balloons.set(key, (bs = balloonSprite(flame, mood)));
    const bShake = v.balloonMood === 'flinch' ? Math.round(Math.sin(v.time * 36) * 1) : 0;
    const x0 = ox + v.balloonX - 23 + bShake;
    const y0 = by - 74 + bob;
    const t = rig.swing;
    if (Math.abs(t) < 0.5) ctx.drawImage(bs, x0, y0);
    else
      // Neigen als Scherung in Streifen (pixelgenau, keine weichgezeichnete Drehung):
      // Hülle oben weht am weitesten, der Korb pendelt leicht dagegen
      for (const [r0, r1, k] of BALLOON_SHEAR) ctx.drawImage(bs, 0, r0, bs.width, r1 - r0, x0 + Math.round(t * k), y0 + r0, bs.width, r1 - r0);
  }

  /** Aufstieg: fester Boden ohne Höhleneingang (Erde, nach unten dunkler). */
  private drawGround(ctx: CanvasRenderingContext2D, W: number, H: number, ox: number, oy: number) {
    const earth = this.sets.earth;
    const r1 = Math.min(Math.ceil((H - oy) / T), 12);
    const c0 = Math.floor(-ox / T);
    const c1 = Math.ceil((W - ox) / T);
    for (let r = Math.max(0, Math.floor(-oy / T)); r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const h = hash(c, r * 3 + 1);
        this.tile(ctx, earth, r === 0 ? [3, 1] : earth.fill[Math.floor(h * 31) % earth.fill.length], c * T + ox, r * T + oy);
      }
    }
    if (oy + (r1 + 1) * T < H) {
      ctx.fillStyle = '#24160f';
      ctx.fillRect(0, oy + (r1 + 1) * T, W, H);
    }
  }

  private skyColor(m: number): string {
    const s = SKY_STOPS;
    if (m <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (m <= s[i][0]) {
        // in 6 Stufen quantisieren – sichtbare Farbbänder statt weichem Verlauf
        const t = Math.round(((m - s[i - 1][0]) / (s[i][0] - s[i - 1][0])) * 6) / 6;
        return lerpColor(s[i - 1][1], s[i][1], t);
      }
    }
    return s[s.length - 1][1];
  }

  private drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, ox: number, groundY: number) {
    const camAlt = -v.camY; // Kamerahöhe in px über dem Boden
    const camM = camAlt / PPM;
    /** Bildschirm-y eines Objekts in m Metern Höhe auf einer Ebene mit Parallax-Faktor f. */
    const at = (m: number, f: number) => Math.round(v.anchorY - (m * PPM - camAlt) * f);
    const layerGround = (f: number) => Math.round(v.anchorY + camAlt * f);
    const bottom = Math.min(H, groundY);

    // 1. Himmelsverlauf in 2-px-Bändern, jede zweite Zeile leicht versetzt (Dithering)
    for (let y = 0; y < bottom; y += 2) {
      const m = camM + ((v.anchorY - y) / PPM) * SKY_F + (y & 2 ? 25 : -25);
      ctx.fillStyle = this.skyColor(m);
      ctx.fillRect(0, y, W, 2);
    }

    // 2. Sterne, Mond, Satellit (ganz fern)
    // Sterne nur in der Nacht zwischen Abendrot und Wolkendecke (und wieder im Polarlicht/Weltraum, siehe drawHeaven)
    const starAlpha = clamp((camM - 3700) / 900) * clamp((5600 - camM) / 300);
    if (starAlpha > 0) {
      for (const [sx, m, ph] of this.stars) {
        const y = at(m, 0.12);
        if (y < 0 || y >= bottom) continue;
        const tw = v.calm ? 1 : Math.sin(v.time * (1 + ph * 2) + ph * 20);
        if (tw < -0.6) continue;
        const x = Math.floor(sx * W);
        ctx.fillStyle = ph > 0.8 ? '#bfe6ff' : ph > 0.6 ? '#ffe9b8' : '#ffffff';
        ctx.globalAlpha = starAlpha;
        ctx.fillRect(x, y, 1, 1);
        if (ph > 0.92 && tw > 0.5) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(this.moon, Math.round(W * 0.7), at(5150, 0.2));
      const sat = mod(v.calm ? 60 : v.time * 5, W + 60) - 30;
      ctx.drawImage(this.satellite, Math.round(sat), at(5200, 0.35) + Math.round(sat * 0.12));
    }

    // 3. Sonne im Abendrot – sinkt beim Steigen langsam
    const sunY = at(4200, 0.6);
    if (sunY > -50 && sunY < bottom) ctx.drawImage(this.sun, Math.round(W * 0.22) - 22, sunY);

    // 4. Meer am Horizont und Wolkenband (fernste Ebenen)
    const back = this.img['sunny/back'];
    const backY = layerGround(0.35) - 150;
    if (backY < bottom && backY + 240 > 0) {
      const off = mod(Math.round(-v.camX * 0.1), 384);
      for (let x = off - 384; x < W; x += 384) ctx.drawImage(back, x, backY);
    }
    // ferne Berggipfel tief unten, Wolkenmeer, ferne Abendrot-Bänke (vor dem Wolkenband, damit die Gipfel daraus auftauchen)
    const sky = this.skyFrame(ctx, W, H, v, ox, groundY);
    this.midSky.far(sky, v.anchorY);
    const strip = this.img['woods/bg-clouds'];
    const stripY = at(2150, 0.4);
    if (stripY < bottom && stripY + 208 > 0) {
      const off = mod(Math.round(-v.camX * 0.15 + (v.calm ? 0 : v.time * 1.5)), 160);
      for (let x = off - 160; x < W; x += 160) ctx.drawImage(strip, x, stripY);
    }

    // 6. Berge, Hügel, Waldrand
    const mt = this.img['woods/bg-mountains'];
    const mtY = layerGround(0.3) - 208 + 46;
    if (mtY < bottom) {
      const off = mod(Math.round(-v.camX * 0.2), 160);
      for (let x = off - 160; x < W; x += 160) ctx.drawImage(mt, x, mtY);
    }
    const hill = this.img['sunny/middle'];
    const hillY = layerGround(0.5) - 118;
    if (hillY < bottom)
      for (const hx of [-330, -70, 240, 520]) {
        const x = Math.round(W / 2 + (hx - v.camX) * 0.45);
        if (x > -180 && x < W) ctx.drawImage(hill, x, hillY + ((hx / 7) & 15));
      }
    // Waldrand nah am Betrachter: verschwindet beim Steigen schnell nach unten (Bäume nur am Boden)
    const trees = this.img['woods/bg-trees'];
    const treeY = layerGround(0.95) - 208 + 46;
    if (treeY < bottom) {
      const off = mod(Math.round(-v.camX * 0.7), 160);
      for (let x = off - 160; x < W; x += 160) ctx.drawImage(trees, x, treeY);
    }

    // 7. Wolken hinter dem Ballon
    this.drawClouds(ctx, W, H, v, groundY, false);
    // Haufenwolken, Federwolken, Vogelschwärme, Flugzeuge, Windlinien, Wolkenbänke
    this.midSky.mid(sky);

    // 8. Über den Sternen: Wolkendecke, Himmel, Himmelstor, darüber Kristallwolken, Polarlicht, Weltraum
    this.heaven.back(sky);

    // 9. Vögel: kleine Schwärme über dem Wald, ab und zu ein Adler
    for (let i = 0; i < 6; i++) {
      const alt = 300 + hash(i, 41) * 850;
      const baseY = at(alt, 0.9) + (v.calm ? 0 : Math.round(Math.sin(v.time * 0.9 + i) * 3));
      if (baseY < -20 || baseY > bottom) continue;
      const dir = i % 2 ? 1 : -1;
      const x0 = Math.round(mod((v.calm ? 0 : v.time * (10 + i * 2) * dir) + hash(i, 42) * 400 - v.camX * 0.9, W + 100) - 50);
      for (let b = 0; b < 3 + (i % 3); b++) {
        const fr = v.calm ? 0 : Math.floor(v.time * 6 + b * 1.7 + i) % 2;
        const bx = x0 - dir * b * 9;
        const by = baseY + ((b * 5) % 7) - 3;
        ctx.drawImage(dir > 0 ? this.birds[fr] : this.birds[fr], bx, by);
      }
    }
    const eY = at(900, 0.95) + (v.calm ? 0 : Math.round(Math.sin(v.time * 0.6) * 6));
    if (eY > -41 && eY < bottom) {
      const ex = Math.round(mod((v.calm ? 0 : v.time * 14) - v.camX * 0.95, W + 120) - 60);
      const fr = v.calm ? 0 : Math.floor(v.time * 5) % 2;
      ctx.drawImage(this.eagleFlip, fr * 40, 0, 40, 41, ex, eY, 40, 41);
    }

    // 10. Höhenschilder an Signalballons (bis zum Himmel; dort eigene Schilder, siehe drawHeaven)
    for (let m = 500; m < 5500; m += 500) {
      const y = groundY - Math.round(m * PPM);
      if (y < -30 || y > bottom + 10) continue;
      const sign = this.sign(`+${m} m`);
      const x = ox + BALLOON_X + 34;
      const bobS = v.calm ? 0 : Math.round(Math.sin(v.time * 1.1 + m) * 1);
      ctx.drawImage(this.buoy, x + Math.floor(sign.width / 2) - 4, y - 12 + bobS);
      ctx.drawImage(sign, x, y - 2 + bobS);
    }
  }

  private skyFrame(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, ox: number, groundY: number): SkyFrame {
    const camAlt = -v.camY;
    return {
      ctx,
      W,
      H,
      at: (m: number, f: number) => Math.round(v.anchorY - (m * PPM - camAlt) * f),
      camM: camAlt / PPM,
      camX: v.camX,
      time: v.time,
      calm: v.calm,
      balloonX: ox + v.balloonX,
      balloonY: groundY - Math.round(v.altitude * PPM) - 40,
      bottom: Math.min(H, groundY),
      sign: (t) => this.sign(t),
      buoy: this.buoy,
    };
  }

  private drawClouds(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, groundY: number, front: boolean) {
    const camAlt = -v.camY;
    for (const c of this.clouds) {
      if (c.f > 1 !== front) continue;
      const y = Math.round(v.anchorY - (c.alt * PPM - camAlt) * c.f);
      if (y < -40 || y > Math.min(H, groundY)) continue;
      const span = W + 160;
      const x = Math.round(mod(c.x + (v.calm ? 0 : v.time * c.speed) - v.camX * c.f, span) - 80);
      ctx.drawImage(c.sprite, x, y);
    }
  }

  private sign(text: string): Sprite {
    let s = this.signs.get(text);
    if (!s) this.signs.set(text, (s = signSprite(text)));
    return s;
  }

  /** Wiese, Dorf, Bäume und das Holzgestell über dem Höhleneingang. */
  private drawSurface(ctx: CanvasRenderingContext2D, W: number, ox: number, groundY: number, shaft: boolean) {
    const props: [string, number, number][] = [
      // [Bild, Welt-x der linken Kante, Einsinken in px]
      ['sunny/pine', -330, 2],
      ['sunny/wooden-house', -260, 2],
      ['sunny/tree', -190, 4],
      ['sunny/rock-2', -128, 3],
      ['sunny/bush', -96, 1],
      ['sunny/sign', 60, 0],
      ['sunny/house', 150, 2],
      ['sunny/tree', 228, 4],
      ['sunny/straw-house', 330, 2],
      ['sunny/palm', 452, 2],
      ['sunny/plant-house', 500, 2],
      ['sunny/pine', 640, 2],
      ['sunny/bush', 280, 1],
    ];
    for (const [key, x, sink] of props) {
      const im = this.img[key];
      const sx = ox + x;
      if (sx > W || sx + im.width < 0) continue;
      ctx.drawImage(im, sx, groundY - im.height + sink);
    }
    // Grasbüschel (ohne Höhle auch über der Stelle des Eingangs)
    const ts = this.sets.earth.img;
    for (let i = -24; i < 40; i++) {
      if (hash(i, 61) > 0.42) continue;
      const x = i * 23 + Math.floor(hash(i, 62) * 9);
      if (shaft && x > -HW - 12 && x < HW + 8) continue;
      ctx.drawImage(ts, (hash(i, 63) < 0.5 ? 1 : 3) * T, 7 * T, T, T, ox + x, groundY - T + 1, T, T);
    }
    if (!shaft) return;
    // Gestell: zwei Pfosten, Querbalken, Umlenkrolle
    const post = (x: number) => {
      ctx.fillStyle = '#3a2416';
      ctx.fillRect(ox + x - 1, groundY - 38, 6, 39);
      ctx.fillStyle = '#a26c33';
      ctx.fillRect(ox + x, groundY - 37, 4, 38);
      ctx.fillStyle = '#c98b4a';
      ctx.fillRect(ox + x, groundY - 37, 1, 38);
    };
    post(-HW - 6);
    post(HW + 2);
    ctx.fillStyle = '#3a2416';
    ctx.fillRect(ox - HW - 9, groundY - 42, HW * 2 + 18, 6);
    ctx.fillStyle = '#b9803f';
    ctx.fillRect(ox - HW - 8, groundY - 41, HW * 2 + 16, 4);
    ctx.fillStyle = '#d7a45a';
    ctx.fillRect(ox - HW - 8, groundY - 41, HW * 2 + 16, 1);
    ctx.fillStyle = '#6d6875';
    ctx.fillRect(ox - 2, groundY - 37, 5, 4);
    ctx.fillStyle = '#c8ccd4';
    ctx.fillRect(ox - 1, groundY - 36, 3, 2);
  }

  private tile(ctx: CanvasRenderingContext2D, set: TileSet, t: [number, number], x: number, y: number) {
    ctx.drawImage(set.img, t[0] * T, t[1] * T, T, T, x, y, T, T);
  }

  private drawCave(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, ox: number, oy: number) {
    const r0 = Math.max(0, Math.floor(-oy / T));
    // ab HELL_ROW zeichnet drawHell die offene Riesenhöhle
    const r1 = Math.min(Math.ceil((H - oy) / T), HELL_ROW - 1);

    // 1. Rückwand mit Parallax (bewegt sich gegen die Wände) – jedes Bild neu, aber nur ein
    //    Rechteck je Zonen-Abschnitt (früher Clip + Musterfüllung je Zeile: zu teuer auf dem Handy)
    for (let r = r0; r <= r1; ) {
      const zone = zoneOfRow(r) as ShaftZone;
      let e = r;
      while (e < r1 && zoneOfRow(e + 1) === zone) e++;
      const y = r * T + oy;
      const h = (e - r + 1) * T;
      const bg = this.bg[zone];
      ctx.fillStyle = bg.base;
      ctx.fillRect(ox - HW, y, HW * 2, h);
      // hintere Ebenen dunkler/blasser, vordere kräftiger → Tiefe
      // aus vorgerenderten Streifen statt Musterfüllung (die bremst das Handy nach ein paar Sekunden aus)
      for (const [layer, f, alpha] of [
        ['far', 0.45, 0.45],
        ['mid', 0.72, 0.8],
      ] as ['far' | 'mid', number, number][]) {
        const strip = this.wallStrip(zone, layer);
        if (!strip) continue;
        const ty = Math.round(v.anchorY - v.camY * f);
        const ph = strip.height;
        ctx.globalAlpha = alpha;
        for (let yy = y; yy < y + h; ) {
          const sy = mod(yy - ty, ph);
          const sh = Math.min(ph - sy, y + h - yy);
          ctx.drawImage(strip, 0, sy, HW * 2, sh, ox - HW, yy, HW * 2, sh);
          yy += sh;
        }
        ctx.globalAlpha = 1;
      }
      r = e + 1;
    }
    // 2. Alles Feststehende aus dem Zwischenspeicher: wenige große Bilder statt tausender kleiner Aufrufe
    //    (Pixel 9: Pilzgrotte 2 → 60 fps). Lichter der Abschnitte werden mitgeführt.
    for (let c = Math.floor(r0 / CHUNK_ROWS); c <= Math.floor(r1 / CHUNK_ROWS); c++) {
      const ch = this.caveChunk(W, v, ox, c);
      const top = c * CHUNK_ROWS * T + oy;
      ctx.drawImage(ch.img, 0, top);
      for (const [x, y, rad, col] of ch.lights) this.lights.push([x, y + top, rad, col, true]);
      if (ch.glow) this.glowLayers.push([ch.glow, top - GLOW_PAD]);
      if (ch.mask) this.maskLayers.push([ch.mask, top - GLOW_PAD]);
    }
    // 3. Bewegtes (Lavafall, Lavaströme, Fledermäuse, Tropfen) obendrauf
    for (let r = r0; r <= r1; r++) this.caveRow(ctx, W, v, ox, oy, r, 'anim');

    // --- Übergang Wiese → Schacht (nach den Zeilen, damit er obenauf liegt)
    if (oy > -40 && oy < H) this.shaftLip(ctx, ox, oy);

    // --- Tiefenschilder an der rechten Wand (in der Hölle hängen sie an Ketten, siehe drawHell)
    for (let m = 500; m < HELL_M; m += 500) {
      const y = Math.round(m * PPM) + oy;
      if (y < -20 || y > H + 20) continue;
      const s = this.sign(`-${m} m`);
      ctx.drawImage(s, ox + HW - s.width + 3, y - 6);
    }
  }

  /**
   * Eine Schachtzeile in einer von zwei Ebenen: 'static' alles Feststehende (landet im
   * Zwischenspeicher), 'anim' Bewegtes. Die Rückwand mit Parallax zeichnet drawCave.
   */
  private caveRow(ctx: CanvasRenderingContext2D, W: number, v: ViewState, ox: number, oy: number, r: number, pass: 'static' | 'anim') {
    const S = pass === 'static';
    const A = pass === 'anim';
    const c0 = Math.floor(-ox / T);
    const c1 = Math.ceil((W - ox) / T);
    const earth = this.sets.earth;
    const y = r * T + oy;
    const zone = zoneOfRow(r) as ShaftZone; // r < HELL_ROW
    const set = this.sets[zone];
    const ledge = ledgeOfRow(r);

    // --- Rückwand: Grundfarbe und Parallax zeichnet drawCave je Zonen-Abschnitt; hier nur Feststehendes
    if (S) {
      if (zone === 'earth') {
        for (let i = 0; i < 6; i++) {
          const px = ox - HW + Math.floor(hash(r, i * 3) * HW * 2);
          const py = y + Math.floor(hash(r, i * 3 + 1) * T);
          ctx.fillStyle = i % 3 ? '#3e2c25' : '#54392b';
          ctx.fillRect(px, py, 2 + (i & 1), 2);
          if (i % 3 === 0) {
            ctx.fillStyle = '#6e4a34';
            ctx.fillRect(px, py, 1, 1);
          }
        }
        if (hash(r, 99) < 0.45) {
          // Wurzel hängt von oben durch
          // nur dicht an den Wänden – die Schachtmitte ums Seil bleibt frei
          const rx = hash(r, 97) < 0.5 ? ox - HW + 2 + Math.floor(hash(r, 98) * 8) : ox + HW - 3 - Math.floor(hash(r, 98) * 8);
          ctx.fillStyle = '#5a3b26';
          for (let i = 0; i < T; i++) ctx.fillRect(rx + Math.round(Math.sin((r * T + i) * 0.4) * 1.2), y + i, 1, 1);
        }
      } else this.backWallDetails(ctx, zone, r, ox, y, v, false);
      // Schatten der Seitenwände auf der Rückwand
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(ox - HW, y, 3, T);
      ctx.fillRect(ox + HW - 3, y, 3, T);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(ox - HW + 3, y, 4, T);
      ctx.fillRect(ox + HW - 7, y, 4, T);
    }

    if (A && zone === 'rock') this.backWallDetails(ctx, zone, r, ox, y, v, true);

    // --- Fels links und rechts vom Schacht
    if (S) for (let c = c0; c <= c1; c++) {
      if (c >= -3 && c <= 2) continue;
      const x = c * T + ox;
      if (r === 0) {
        this.tile(ctx, earth, c === -4 ? [5, 1] : c === 3 ? [1, 1] : [3, 1], x, y);
        continue;
      }
      if (c === -4) this.tile(ctx, set, set.wallL[Math.floor(hash(r, 1) * set.wallL.length)], x, y);
      else if (c === 3) this.tile(ctx, set, set.wallR[Math.floor(hash(r, 2) * set.wallR.length)], x, y);
      else {
        const h = hash(c, r * 3 + 1);
        const t = set.detail.length && h < 0.13 ? set.detail[Math.floor(h * 97) % set.detail.length] : set.fill[Math.floor(h * 31) % set.fill.length];
        this.tile(ctx, set, t, x, y);
      }
    }

    // --- Lavafall: im Übergang zur Hölle rinnt Lava an beiden Schachtwänden herab
    const rowM = (r * T) / PPM;
    if (A && rowM >= LAVAFALL[0] - 40 && rowM < HELL_M) {
      const fall = this.img['hell/lavafall'];
      const fr = v.calm ? 0 : Math.floor(v.time * 8 + r) % 3;
      const fade = clamp((rowM - (LAVAFALL[0] - 40)) / 120);
      ctx.globalAlpha = fade;
      ctx.drawImage(fall, fr * 16, 0, 16, 16, ox - HW, y, 16, 16);
      ctx.drawImage(fall, ((fr + 1) % 3) * 16, 0, 16, 16, ox + HW - 16, y, 16, 16);
      ctx.globalAlpha = 1;
      this.lights.push([ox - HW + 8, y + 8, 22, '#ff7a2b']);
      this.lights.push([ox + HW - 8, y + 8, 22, '#ff7a2b']);
    }

    // --- Hintergrund-Fels neben dem Schacht: dunkler, eigene Struktur (Deko hängt nicht vor „nichts“)
    if (S && r >= 1) this.backRock(ctx, zone, r, ox, y, W);

    // --- Leuchtendes im Fels neben dem Schacht: die Zone ist auch außerhalb der Lampe erkennbar
    if (r >= 2) {
      if (zone === 'lava') {
        if (A) this.lavaRock(ctx, r, ox, y, W, v);
      } else if (S) this.sideEmitters(ctx, zone, r, ox, y, W);
    }

    // --- Sims mit allem, was darauf wächst oder daran hängt
    if (ledge && (S || A)) {
      const { side, len, k } = ledge;
      const lx = (i: number) => ox + (side < 0 ? -HW + i * T : HW - (i + 1) * T);
      if (!S) {
        // nur die bewegten Kleinigkeiten (Glitzern, Tropfen) – der Rest liegt im Zwischenspeicher
        if (zone === 'rock') this.ledgeAnim(ctx, ledge, ox, y, v);
      } else if (zone === 'earth') {
        // dicke Wurzel ragt aus der Erdwand, daran hängen Ranken, obendrauf Gras
        this.rootLedge(ctx, side, ox, y, k);
      } else {
        for (let i = 0; i < len; i++) {
          this.tile(ctx, set, set.ledge[(k + i) % set.ledge.length], lx(i), y);
          this.tile(ctx, set, set.fringe[(k + i) % set.fringe.length], lx(i), y + T);
        }
        const mid = lx(0) + (side < 0 ? (len * T) / 2 : T - (len * T) / 2);
        if (zone === 'rock') {
          // kleine Tropfsteine und eine Pfütze auf dem Sims
          const [rd, rm, rl] = ROCK_TONES.rock;
          for (let i = 0; i < 3; i++) {
            const sx = lx(0) + 3 + Math.floor(hash(k * 3 + i, 261) * (len * T - 6));
            const sh = 2 + Math.floor(hash(k * 3 + i, 262) * 4);
            for (let j = 0; j < sh; j++) {
              ctx.fillStyle = j === sh - 1 ? rl : rm;
              ctx.fillRect(sx - (j < sh - 2 ? 1 : 0), y - j, j < sh - 2 ? 3 : 1, 1);
            }
            ctx.fillStyle = rd;
            ctx.fillRect(sx - 1, y, 3, 1);
          }
          if (hash(k, 263) < 0.6) {
            const pw = 6 + Math.floor(hash(k, 264) * 6);
            const px0 = side < 0 ? lx(0) + len * T - pw - 4 : lx(0) + 4;
            ctx.fillStyle = '#2a4a6a';
            ctx.fillRect(px0, y + 1, pw, 1);
            ctx.fillStyle = '#5a8ab8';
            ctx.fillRect(px0 + 1, y + 1, Math.max(1, pw - 4), 1);
          }
          if (hash(k, 74) < 0.7) {
            ctx.drawImage(this.stalactite, Math.round(mid - 19), y + T + 4);
          }
        } else if (zone === 'crystal') {
          // große Kristallgruppe, Fuß im Sims eingebettet
          const s = crystalCluster(k * 13 + 1, 2, k % 3);
          ctx.drawImage(s, Math.round(mid - s.width / 2), y - s.height + 3);
          this.embedLip(ctx, Math.round(mid - s.width / 2), y, s.width, 'crystal', k);
          this.lights.push([Math.round(mid), y - 10, 15, CRYSTAL_COLORS[k % 3][1]]);
        } else if (zone === 'shroom') {
          // Pilzgruppe auf Moospolster, Fuß im Sims
          const s = shroomPatch(k * 7 + 3, k % 3);
          ctx.drawImage(s, Math.round(mid - s.width / 2), y - s.height + 4);
          if (len > 1) {
            // Pflanzen stehen auf dem Sims (Fuß auf der Oberkante)
            const plant = this.img[len >= 3 && hash(k, 76) < 0.5 ? 'warped/plant-big' : 'warped/plant-small'];
            // an der Wandseite des Simses, damit nichts über die Kante ragt
            const px0 = side < 0 ? lx(0) : lx(0) + T - plant.width;
            ctx.drawImage(plant, px0, y - plant.height + 3);
          }
          this.softGlow(Math.round(mid), y - 6, 22, ['#63f0d0', '#b8f05a', '#f08ae6'][k % 3], k);
        } else {
          ctx.fillStyle = '#ffd27a';
          ctx.fillRect(Math.round(mid) - 6, y + 2, 12, 1);
          ctx.fillStyle = '#ff8a2b';
          ctx.fillRect(Math.round(mid) - 9, y + 3, 18, 1);
          this.lights.push([Math.round(mid), y + 3, 16, '#ff7a2b']);
        }
      }
    }

    // --- Kleinteile an den Wänden: alles sitzt an der Wand und wächst zur Schachtmitte
    if (S && r >= 2 && !ledge) {
      const h = hash(r, 81);
      const left = hash(r, 82) < 0.5;
      const k = Math.floor(h * 90) % 3;
      if (zone === 'crystal' && h < 0.34) {
        const size = (hash(r, 84) < 0.35 ? 1 : 0) as 0 | 1;
        const s = this.wallSprite('cr', r, size, k, left);
        this.wallGrowth(ctx, s, left, ox, y, zone, r);
        this.lights.push([left ? ox - HW + s.width - 2 : ox + HW - s.width + 2, y + 7, 9 + size * 3, CRYSTAL_COLORS[k][1]]);
      } else if (zone === 'shroom' && h < 0.4) {
        const s = this.wallSprite('sp', r, 0, k, left);
        this.wallGrowth(ctx, s, left, ox, y - 4, zone, r);
        this.softGlow(left ? ox - HW + 8 : ox + HW - 8, y + 8, s.height, ['#63f0d0', '#b8f05a', '#f08ae6'][k], r, true);
      } else if ((zone === 'rock' || zone === 'crystal' || zone === 'shroom') && h > 0.8) {
        // Felsnase an der Wand (gezeichnet, keine Kachel mit dunklem Grund)
        this.outcrop(ctx, left, ox, y + 3, zone, r);
      } else if (zone === 'earth' && h < 0.4) {
        // Wurzeln, Steine oder ein Wurm an der Erdwand
        const wx = left ? ox - HW : ox + HW;
        const pick = hash(r, 85);
        if (pick < 0.45) ctx.drawImage(roots(r, 10 + Math.floor(hash(r, 86) * 10)), left ? wx - 2 : wx - 10, y);
        else if (pick < 0.75) ctx.drawImage(pebbles(r, ROCK_TONES.earth), left ? wx : wx - 14, y + 8);
        else ctx.drawImage(worm(r), left ? wx : wx - 10, y + 6);
      } else if (zone === 'lava' && h < 0.25) {
        // glühender Riss in der Schachtwand
        ctx.fillStyle = '#ff8a2b';
        const cx = left ? ox - HW - 12 : ox + HW + 4;
        for (let i = 0; i < 7; i++) ctx.fillRect(cx + ((i * 5) % 7), y + i * 2, 1, 2);
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(cx + 3, y + 6, 1, 3);
        this.lights.push([cx + 3, y + 8, 10, '#ff8a2b']);
      }
    }

    // --- Gesteinsschichten am Übergang zur nächsten Zone
    if (S && r > 1 && zone !== zoneOfRow(r - 1)) this.drawStrata(ctx, W, ox, y, zoneOfRow(r - 1), zone);

    // --- Fledermäuse in der Felshöhle
    if (A && zone === 'rock' && r % 9 === 4) {
      const bx = ox + Math.round(Math.sin((v.calm ? 0 : v.time * 0.7) + r) * (HW - 14));
      const byy = y + Math.round(Math.cos((v.calm ? 0 : v.time * 1.9) + r) * 5);
      ctx.drawImage(this.bats[v.calm ? 0 : Math.floor(v.time * 7 + r) % 2], bx - 6, byy);
    }
  }

  /** Feststehender Schachtabschnitt (CHUNK_ROWS Zeilen, volle Breite), einmal gezeichnet und gecacht. */
  private caveChunk(W: number, v: ViewState, ox: number, c: number): Chunk {
    const key = `${W}:${ox}:${c}`;
    let ch = this.chunks.get(key);
    if (ch) {
      // zuletzt benutzt ans Ende (einfaches LRU)
      this.chunks.delete(key);
      this.chunks.set(key, ch);
      return ch;
    }
    const [img, cctx] = canvas(W, CHUNK_ROWS * T);
    const oyC = -c * CHUNK_ROWS * T;
    const first = c * CHUNK_ROWS;
    const last = first + CHUNK_ROWS - 1;
    const saved = this.lights;
    const own: Light[] = [];
    // Nachbarzeilen mitzeichnen: Kristalle, Ranken und Tropfsteine ragen über die Zeilengrenze
    for (let r = Math.max(0, first - CHUNK_MARGIN); r <= Math.min(HELL_ROW - 1, last + CHUNK_MARGIN); r++) {
      this.lights = [];
      this.caveRow(cctx, W, v, ox, oyC, r, 'static');
      if (r >= first && r <= last) own.push(...this.lights);
    }
    this.lights = saved;
    // Farbiger Schein aller festen Lichter in ein Bild (additiv) – auf dem Handy sind ~80 einzelne
    // Leucht-Sprites pro Bild nach wenigen Sekunden der Grund für den Einbruch auf ~13 fps
    let glow: Sprite | null = null;
    let mask: Sprite | null = null;
    if (own.length) {
      // Lichtmasken übereinander (source-over vereinigt die Deckkraft: 1-(1-a)(1-b)) – einmal
      // ausgestanzt wirkt das genau wie jede Maske einzeln mit destination-out
      const [mk, mctx] = canvas(W, CHUNK_ROWS * T + GLOW_PAD * 2);
      for (const [x, y, rad] of own) mctx.drawImage(this.lightMaskOf(rad), x - rad, y - rad + GLOW_PAD);
      mask = mk;
    }
    if (own.some((l) => l[3])) {
      const [g, gctx] = canvas(W, CHUNK_ROWS * T + GLOW_PAD * 2);
      gctx.globalCompositeOperation = 'lighter';
      gctx.globalAlpha = GLOW_ALPHA;
      for (const [x, y, rad, col] of own) if (col) gctx.drawImage(this.glowSprite(rad, col), x - rad, y - rad + GLOW_PAD);
      glow = g;
    }
    ch = { img, glow, mask, lights: own };
    this.chunks.set(key, ch);
    while (this.chunks.size > 8) this.chunks.delete(this.chunks.keys().next().value!);
    return ch;
  }

  /** Rückwand-Ebene einer Zone als Streifen (Schachtbreite × Musterhöhe), einmal aus dem Muster gerendert. */
  private wallStrip(zone: ShaftZone, layer: 'far' | 'mid'): Sprite | null {
    const key = `${zone}-${layer}`;
    if (this.strips.has(key)) return this.strips.get(key)!;
    const bg = this.bg[zone];
    const pat = bg[layer];
    let strip: Sprite | null = null;
    if (pat) {
      const ph = layer === 'far' ? bg.farH : bg.midH;
      const [c, sctx] = canvas(HW * 2, ph);
      // gleiche Ausrichtung wie früher: Musterursprung bei Bildschirm-x ox - 60
      sctx.translate(HW - 60, 0);
      sctx.fillStyle = pat;
      sctx.fillRect(60 - HW, 0, HW * 2, ph);
      strip = c;
    }
    this.strips.set(key, strip);
    return strip;
  }

  /** Lichtmaske (Deckkraft nach außen weich) je Radius, gecacht. */
  private lightMaskOf(r: number): Sprite {
    let m = this.masks.get(r);
    if (!m) this.masks.set(r, (m = lightMask(r)));
    return m;
  }

  /** Farbiger Schein eines Lichts (gecacht je Radius und Farbe). */
  private glowSprite(r: number, color: string): Sprite {
    const key = `${r}-${color}`;
    let g = this.glowCache.get(key);
    if (!g) {
      g = recolor(this.lightMaskOf(r), () => {
        const n = parseInt(color.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      });
      this.glowCache.set(key, g);
    }
    return g;
  }

  /** Bewegtes auf einem Felssims: Glitzern in der Pfütze, fallender Tropfen (Gegenstück zum statischen Sims). */
  private ledgeAnim(ctx: CanvasRenderingContext2D, ledge: NonNullable<ReturnType<typeof ledgeOfRow>>, ox: number, y: number, v: ViewState) {
    if (v.calm) return;
    const { side, len, k } = ledge;
    const lx = (i: number) => ox + (side < 0 ? -HW + i * T : HW - (i + 1) * T);
    const mid = lx(0) + (side < 0 ? (len * T) / 2 : T - (len * T) / 2);
    if (hash(k, 263) < 0.6 && Math.floor(v.time * 1.5 + k) % 4 === 0) {
      const pw = 6 + Math.floor(hash(k, 264) * 6);
      const px0 = side < 0 ? lx(0) + len * T - pw - 4 : lx(0) + 4;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(px0 + 2, y + 1, 1, 1);
    }
    if (hash(k, 74) < 0.7) {
      const t = mod(v.time * 0.8 + hash(k, 75) * 3, 3);
      if (t < 1.4) {
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(Math.round(mid), y + T + 58 + Math.round(t * t * 46), 1, 2);
      }
    }
  }

  /**
   * Struktur der Schacht-Rückwand (Risse, Kiesel, Glanzpunkte) – bewusst keine Objekte:
   * Rund ums Seil gibt es nur Partikel (Staub, Funken, Glühwürmchen), keine Deko.
   */
  private backWallDetails(ctx: CanvasRenderingContext2D, zone: Zone, r: number, ox: number, y: number, v: ViewState, anim: boolean) {
    const px = (i: number, salt: number) => ox - HW + 4 + Math.floor(hash(r * 7 + i, salt) * (HW * 2 - 8));
    const py = (i: number, salt: number) => y + Math.floor(hash(r * 7 + i, salt) * (T - 4));
    const tone: Record<Zone, [string, string, string]> = {
      earth: ['#3e2c25', '#54392b', '#17110d'],
      rock: ['#4a4060', '#6d6478', '#17131f'],
      crystal: ['#3a2560', '#5a3f8a', '#1a0f2c'],
      shroom: ['#1c3a3a', '#2c5450', '#0a1a1c'],
      lava: ['#5a1f14', '#7a2a18', '#24090a'],
      hell: ['#3a1630', '#6a2a48', '#1a0a18'],
      icehell: ['#2a4a6e', '#8ab8e0', '#0e1a2e'],
      crystalhell: ['#46207a', '#9a5ae0', '#1c0c30'],
      abyss: ['#1c1428', '#3a2a50', '#08060e'],
    };
    const [stone, light, crack] = tone[zone];
    if (!anim) {
      for (let i = 0; i < 3; i++) {
        const x = px(i, 11);
        const yy = py(i, 12);
        ctx.fillStyle = stone;
        ctx.fillRect(x, yy, 3, 2);
        ctx.fillStyle = light;
        ctx.fillRect(x, yy, 1, 1);
      }
      if (hash(r, 13) < 0.45) {
        ctx.fillStyle = crack;
        const x = px(5, 14);
        for (let i = 0; i < 9; i++) ctx.fillRect(x + Math.round(Math.sin(i * 1.3 + r) * 1.5), y + i * 2, 1, 2);
      }
      if (zone === 'rock') {
        // Schichtband quer über die Rückwand
        if (hash(r, 19) < 0.55) {
          const by = y + Math.floor(hash(r, 20) * T);
          ctx.fillStyle = hash(r, 21) < 0.5 ? '#3a3350' : '#524a6a';
          for (let x = ox - HW; x < ox + HW; x += 1) ctx.fillRect(x, by + Math.round(Math.sin((x - ox) * 0.12 + r) * 1.2), 1, 1);
        }
        // Spinnennetz in einer Wandecke
        if (hash(r, 22) < 0.12) {
          const left = hash(r, 23) < 0.5;
          const web = cobweb(r, left ? 1 : -1);
          ctx.drawImage(web, left ? ox - HW : ox + HW - web.width, y);
        }
      }
    }
    if (anim && zone === 'rock' && hash(r, 15) < 0.6 && !v.calm && Math.floor(v.time * 2 + hash(r, 16) * 8) % 5 === 0) {
      ctx.fillStyle = '#9fd8ff';
      ctx.fillRect(px(6, 17), py(6, 18), 1, 1);
    }
  }

  /**
   * Selbstleuchtendes im Fels links/rechts vom Schacht: Flechten flach auf dem Fels,
   * Kristalle und Pilze stehen in kleinen Felsnischen (nichts schwebt). Lava: lavaRock.
   */
  private sideEmitters(ctx: CanvasRenderingContext2D, zone: Zone, r: number, ox: number, y: number, W: number) {
    if (zone === 'lava') return;
    for (const side of [-1, 1]) {
      const h = hash(r * 2 + (side > 0 ? 1 : 0), 51);
      if (h > (zone === 'earth' || zone === 'rock' ? 0.28 : 0.3)) continue;
      const span = Math.max(8, W / 2 - HW - 24);
      const dist = HW + 16 + Math.floor(hash(r, 52 + side) * span);
      const x = ox + side * dist;
      const seed = r * 2 + (side > 0 ? 1 : 0);
      if (zone === 'earth' || zone === 'rock') {
        // Fossilien, Steine und Erzadern im Gestein, in der Erde auch Wurzeln und Würmer (ohne Leuchten)
        const pick = hash(seed, 53);
        if (zone === 'rock' && pick > 0.55) {
          this.oreVein(ctx, x - 4, y + 2, seed);
          continue;
        }
        const s =
          pick < 0.3 ? fossil(seed) : pick < 0.65 ? pebbles(seed, ROCK_TONES[zone]) : zone === 'earth' ? (pick < 0.85 ? worm(seed) : roots(seed, 12)) : fossil(seed + 1);
        ctx.drawImage(s, Math.round(x - s.width / 2), y + 4);
      } else if (zone === 'crystal') {
        const k = Math.floor(h * 97) % 3;
        const s = crystalCluster(seed * 3 + 5, hash(seed, 54) < 0.3 ? 1 : 0, k);
        this.niche(ctx, x, y + 15, s.width + 4, 'crystal', seed);
        ctx.drawImage(s, Math.round(x - s.width / 2), y + 16 - s.height);
        this.embedLip(ctx, Math.round(x - s.width / 2), y + 15, s.width, 'crystal', seed);
        this.lights.push([x, y + 9, 11, CRYSTAL_COLORS[k][1]]);
      } else {
        // Pilzgruppe auf Moospolster – sitzt auf einem Felssims, der aus dem Gestein ragt
        // (vorher schwebten die Polster als kleine Inseln im Dunkeln)
        const k = Math.floor(h * 97) % 3;
        const s = shroomPatch(seed * 5 + 2, k);
        const px0 = Math.round(x - s.width / 2);
        this.rockShelf(ctx, px0 - 3, y + 17, s.width + 6, 'shroom', seed);
        ctx.drawImage(s, px0, y + 18 - s.height);
        this.embedLip(ctx, px0, y + 17, s.width, 'shroom', seed);
        this.softGlow(x, y + 8, s.width, ['#63f0d0', '#b8f05a', '#f08ae6'][k], seed);
      }
    }
  }

  /**
   * Weicher Schein statt Leuchtscheibe: mehrere kleine, schwache Lichter entlang
   * einer Fläche (Polster/Gruppe) – wirkt wie Licht, das auf die Wand fällt.
   */
  private softGlow(cx: number, cy: number, extent: number, color: string, seed: number, vertical = false) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const off = ((i + 0.5) / n - 0.5) * extent;
      const jitter = (hash(seed + i, 231) - 0.5) * 4;
      this.lights.push([Math.round(vertical ? cx + jitter : cx + off), Math.round(vertical ? cy + off : cy + jitter), 6 + Math.floor(hash(seed + i, 232) * 4), color]);
    }
  }

  /** Eigene Felsstruktur im Hintergrund neben dem Schacht: dunkler, mit Schichten und Rissen. */
  private backRock(ctx: CanvasRenderingContext2D, zone: Zone, r: number, ox: number, y: number, W: number) {
    const [dark, mid] = ROCK_TONES[zone];
    const edgeL = ox - HW - T;
    const edgeR = ox + HW + T;
    ctx.fillStyle = 'rgba(6,4,12,0.38)';
    ctx.fillRect(0, y, Math.max(0, edgeL), T);
    ctx.fillRect(edgeR, y, Math.max(0, W - edgeR), T);
    // Schichtfugen (leicht wellig) und Risse
    for (const [x0, x1] of [
      [0, edgeL],
      [edgeR, W],
    ]) {
      if (x1 - x0 < 4) continue;
      // nur ab und zu eine Schichtfuge, unterbrochen und gegen die Wand hin auslaufend
      if (hash(r, 242 + x0) < 0.4) {
        const by = y + Math.floor(hash(r, 241 + x0) * T);
        ctx.fillStyle = lerpColor(dark, mid, 0.6);
        for (let x = x0; x < x1; x += 2) {
          if (hash(x + r * 31, 246) < 0.3) continue;
          ctx.fillRect(x, by + Math.round(Math.sin((x - ox) * 0.09 + r) * 1.5 + Math.sin((x - ox) * 0.023) * 3), 2, 1);
        }
      }
      if (hash(r, 243 + x0) < 0.5) {
        let cx = x0 + Math.floor(hash(r, 244 + x0) * (x1 - x0));
        ctx.fillStyle = dark;
        for (let i = 0; i < T; i++) {
          cx += hash(r * 7 + i, 245) < 0.5 ? -1 : 1;
          ctx.fillRect(cx, y + i, 1, 1);
        }
      }
    }
  }

  /** Steinzone: Erzader im Fels (Gold/Kupfer/Eisen) mit Glanzpunkt. */
  private oreVein(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) {
    const ores: [string, string][] = [
      ['#c8a040', '#ffe08a'],
      ['#b86a3a', '#f0a070'],
      ['#8a4a4a', '#d08080'],
      ['#7a8aa8', '#d0e0ff'],
    ];
    const [c, glint] = ores[Math.floor(hash(seed, 251) * ores.length)];
    let cx = x;
    let cy = y;
    for (let i = 0; i < 10; i++) {
      cx += hash(seed * 3 + i, 252) < 0.5 ? 1 : -1;
      cy += hash(seed * 5 + i, 253) < 0.6 ? 1 : 0;
      ctx.fillStyle = c;
      ctx.fillRect(cx, cy, hash(seed + i, 254) < 0.3 ? 2 : 1, 1);
    }
    ctx.fillStyle = glint;
    ctx.fillRect(x + 1, y + 2, 1, 1);
  }

  /** Felssims im Hintergrund-Gestein: Oberkante hell, darunter Fels, der in die Wand übergeht. */
  private rockShelf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, zone: Zone, seed: number) {
    const [dark, mid, light] = ROCK_TONES[zone];
    const r = rng(seed * 13 + 5);
    for (let i = 0; i < w; i++) {
      // nach unten verjüngt, unregelmäßig – wie aus der Wand gebrochen
      const t = Math.abs(i - w / 2) / (w / 2);
      const depth = Math.max(2, Math.round((1 - t * t) * 9 + r() * 2));
      ctx.fillStyle = mid;
      ctx.fillRect(x + i, y, 1, depth);
      ctx.fillStyle = r() < 0.5 ? light : mid;
      ctx.fillRect(x + i, y, 1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x + i, y + depth, 1, 2);
      // Risse/Moos an der Unterseite
      if (r() < 0.12) {
        ctx.fillStyle = '#2f8e6a';
        ctx.fillRect(x + i, y + depth, 1, 1 + Math.floor(r() * 3));
      }
    }
    // Schatten auf der Wand darunter
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + 10, w - 4, 3);
  }

  /** Unregelmäßige Gesteinskante vor dem Fuß eines Objekts – es wirkt eingewachsen statt aufgelegt. */
  private embedLip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, zone: Zone, seed: number) {
    const [dark, mid, light] = ROCK_TONES[zone];
    const r = rng(seed * 31 + x);
    for (let i = -1; i <= w; i++) {
      const h = 1 + Math.floor(r() * 3);
      ctx.fillStyle = mid;
      ctx.fillRect(x + i, y - h + 1, 1, h + 1);
      ctx.fillStyle = r() < 0.4 ? light : mid;
      ctx.fillRect(x + i, y - h + 1, 1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x + i, y + 2, 1, 1);
    }
  }

  /** Felsnase aus der Schachtwand: unregelmäßig, Licht oben, Schatten unten. */
  private outcrop(ctx: CanvasRenderingContext2D, left: boolean, ox: number, y: number, zone: Zone, seed: number) {
    const [dark, mid, light] = ROCK_TONES[zone];
    const r = rng(seed * 41 + 7);
    const depth = 5 + Math.floor(r() * 6);
    const tall = 6 + Math.floor(r() * 5);
    for (let i = 0; i < depth; i++) {
      const hh = Math.max(2, Math.round(tall * (1 - i / depth) + (r() - 0.5) * 2));
      const x = left ? ox - HW + i : ox + HW - 1 - i;
      ctx.fillStyle = mid;
      ctx.fillRect(x, y, 1, hh);
      ctx.fillStyle = light;
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + hh - 1, 1, 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(left ? ox - HW : ox + HW - depth, y + tall, depth - 1, 2);
  }

  /** Gedrehte Wand-Variante (Kristall/Pilz wächst zur Schachtmitte), gecacht. */
  private wallCache = new Map<string, Sprite>();
  private wallSprite(kind: 'cr' | 'sp', seed: number, size: 0 | 1, palette: number, left: boolean): Sprite {
    const key = `${kind}-${seed}-${size}-${palette}-${left}`;
    let s = this.wallCache.get(key);
    if (!s) {
      const up = kind === 'cr' ? crystalCluster(seed * 11 + 4, size, palette) : shroomPatch(seed * 11 + 6, palette);
      this.wallCache.set(key, (s = rotate90(up, left ? 1 : -1)));
    }
    return s;
  }

  /** Erdzone: dicke Wurzel aus der Wand, Ranken daran, Gras obendrauf. */
  private rootLedge(ctx: CanvasRenderingContext2D, side: -1 | 1, ox: number, y: number, k: number) {
    const r = rng(k * 23 + 1);
    const len = 14 + Math.floor(r() * 12);
    const wall = side < 0 ? ox - HW : ox + HW;
    let yy = y + 4;
    for (let i = 0; i < len; i++) {
      const x = side < 0 ? wall + i : wall - 1 - i;
      if (r() < 0.25) yy += r() < 0.5 ? -1 : 1;
      const thick = Math.max(1, 4 - Math.floor((i / len) * 3));
      ctx.fillStyle = '#5a3b26';
      ctx.fillRect(x, yy, 1, thick);
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(x, yy, 1, 1);
      ctx.fillStyle = '#3a2418';
      ctx.fillRect(x, yy + thick, 1, 1);
      if (i % 6 === 3 && r() < 0.8) {
        const v = vine(k * 5 + i, 8 + Math.floor(r() * 14));
        ctx.drawImage(v, x - 4, yy + thick);
      }
      if (i % 4 === 1) {
        ctx.fillStyle = r() < 0.5 ? '#7ec850' : '#5d9f3a';
        ctx.fillRect(x, yy - 1 - Math.floor(r() * 3), 1, 2);
      }
    }
    if (r() < 0.5) {
      const m = this.img['sunny/shrooms'];
      ctx.drawImage(m, side < 0 ? wall + 2 : wall - m.width - 2, y + 4 - m.height + 2);
    }
  }

  /** Rundliche, unregelmäßige Felsmulde im Zonengestein (statt dunklem Kasten), Boden bei floorY. */
  private niche(ctx: CanvasRenderingContext2D, cx: number, floorY: number, w: number, zone: Zone = 'rock', seed = 0) {
    const [dark, mid, light] = ROCK_TONES[zone];
    const hollow = lerpColor(dark, '#000000', 0.35);
    const hw = w / 2 + 1;
    const hh = Math.round(w * 0.75);
    for (let dy = -hh; dy <= 0; dy++) {
      const t = (dy + hh) / hh; // 0 oben … 1 Boden
      const half = Math.round(Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)) * hw + (hash(dy + seed, 221) - 0.5) * 1.5);
      if (half <= 0) continue;
      ctx.fillStyle = hollow;
      ctx.fillRect(Math.round(cx - half), floorY + dy, half * 2, 1);
      // Rand: oben hell (Licht von oben), seitlich mittel
      ctx.fillStyle = dy === -hh + 1 ? light : mid;
      ctx.fillRect(Math.round(cx - half) - 1, floorY + dy, 1, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(Math.round(cx + half), floorY + dy, 1, 1);
    }
    // Boden der Mulde
    ctx.fillStyle = mid;
    ctx.fillRect(Math.round(cx - hw), floorY, Math.round(hw * 2), 2);
    ctx.fillStyle = light;
    ctx.fillRect(Math.round(cx - hw) + 1, floorY, Math.round(hw * 2) - 2, 1);
  }


  /** Kristall/Pilz wächst seitlich aus der Schachtwand – Fuß von einer Felsnase verdeckt. */
  private wallGrowth(ctx: CanvasRenderingContext2D, s: Sprite, left: boolean, ox: number, y: number, zone: Zone, seed: number) {
    const wallX = left ? ox - HW : ox + HW;
    ctx.drawImage(s, left ? wallX - 1 : wallX + 1 - s.width, y + 1);
    // Ansatz: unregelmäßiger Fels vor dem Fuß (zur Wand hin)
    const [dark, mid, light] = ROCK_TONES[zone];
    const r = rng(seed * 17 + 3);
    for (let i = -1; i <= s.height; i++) {
      const d = 2 + Math.floor(r() * 3);
      ctx.fillStyle = mid;
      ctx.fillRect(left ? wallX - 1 : wallX - d + 1, y + 1 + i, d, 1);
      ctx.fillStyle = r() < 0.35 ? light : dark;
      ctx.fillRect(left ? wallX - 1 + d - 1 : wallX - d + 1, y + 1 + i, 1, 1);
    }
  }

  /**
   * Lava-Zone im Fels neben dem Schacht – bewusst unregelmäßig: wenige Lavaströme über
   * mehrere Zeilen, verzweigte Risse und kleine Glutnester, mit unterschiedlicher Größe
   * und Helligkeit (kein gleichmäßiges Raster aus Lichtkreisen).
   */
  private lavaRock(ctx: CanvasRenderingContext2D, r: number, ox: number, y: number, W: number, v: ViewState) {
    const span = Math.max(8, W / 2 - HW - 16);
    const glow = ['#ff7a2b', '#ffb347', '#e2541e', '#ff9a3c'];
    for (const side of [-1, 1]) {
      const s = side > 0 ? 1 : 0;
      // 1) Lavastrom: gehört zu einem Block aus 5 Zeilen, läuft durch dessen Zeilen 1–3
      const block = Math.floor(r / 5);
      const inBlock = r % 5;
      if (hash(block * 2 + s, 91) < 0.38 && inBlock >= 1 && inBlock <= 3) {
        const x = ox + side * (HW + 12 + Math.floor(hash(block, 92 + s) * span));
        const wob = (yy: number) => Math.round(Math.sin((r * T + yy) * 0.18 + block) * 2);
        for (let yy = 0; yy < T; yy++) {
          const xx = x + wob(yy);
          ctx.fillStyle = '#7a2416';
          ctx.fillRect(xx - 2, y + yy, 5, 1);
          ctx.fillStyle = '#e2541e';
          ctx.fillRect(xx - 1, y + yy, 3, 1);
          ctx.fillStyle = '#ffb347';
          ctx.fillRect(xx, y + yy, 1, 1);
        }
        // helle Brocken, die den Strom hinunterfließen
        if (!v.calm) {
          const t = mod(v.time * 14 + hash(block, 93) * 40, T * 3);
          const yy = Math.floor(t) - (inBlock - 1) * T;
          if (yy >= 0 && yy < T) {
            ctx.fillStyle = '#fff1b0';
            ctx.fillRect(x + wob(yy), y + yy, 1, 2);
          }
        }
        if (inBlock === 2) this.lights.push([x, y + 8, 14 + Math.floor(hash(block, 94 + s) * 10), glow[block % 4]]);
        if (inBlock === 3) {
          // kleine Lache am Ende
          ctx.fillStyle = '#e2541e';
          ctx.fillRect(x - 4, y + T - 3, 9, 2);
          ctx.fillStyle = '#ffd27a';
          ctx.fillRect(x - 2, y + T - 3, 4, 1);
        }
        continue;
      }
      const h = hash(r * 2 + s, 95);
      if (h > 0.2) continue;
      const x = ox + side * (HW + 10 + Math.floor(hash(r, 96 + s) * span));
      const yy = y + Math.floor(hash(r, 98 + s) * (T - 6));
      if (h < 0.12) {
        // 2) verzweigter Riss, unterschiedlich lang
        const len = 4 + Math.floor(hash(r, 99) * 6);
        ctx.fillStyle = '#c9541e';
        let cx = x;
        for (let i = 0; i < len; i++) {
          cx += hash(r * 13 + i, 100) < 0.5 ? -1 : 1;
          ctx.fillRect(cx, yy + i, 1, 1);
          if (i === 2) ctx.fillRect(cx + 1, yy + i, 2, 1);
        }
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(x, yy + 1, 1, 2);
        if (hash(r, 101) < 0.6) this.lights.push([x, yy + 3, 7 + Math.floor(hash(r, 102) * 6), glow[r % 4]]);
      } else {
        // 3) Glutnest: kleiner, heller Fleck, flackert leicht
        const flick = v.calm ? 0 : Math.floor(v.time * 3 + r) % 3 === 0 ? 1 : 0;
        ctx.fillStyle = '#e2541e';
        ctx.fillRect(x - 1, yy, 3, 2);
        ctx.fillStyle = flick ? '#fff1b0' : '#ffb347';
        ctx.fillRect(x, yy, 1, 1);
        this.lights.push([x, yy + 1, 5 + Math.floor(hash(r, 103) * 5), glow[(r + 1) % 4]]);
      }
    }
  }

  /**
   * Oberkante des Schachts: Grasnarbe hängt unregelmäßig über die Kante, darunter
   * wellige Schichten (Humus → Erde → Kies) und Wurzeln, Schatten unter dem Überhang.
   */
  private shaftLip(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    const x0 = ox - HW;
    for (let i = 0; i < HW * 2; i++) {
      const x = x0 + i;
      const wave = Math.sin(i * 0.31) * 1.6 + Math.sin(i * 0.11 + 1) * 1.4;
      const grass = 2 + Math.round(hash(i, 201) * 2 + Math.max(0, wave * 0.5));
      const humus = 4 + Math.round(wave + hash(i, 202) * 2);
      const soil = 6 + Math.round(Math.sin(i * 0.17 + 2) * 2 + hash(i, 203));
      let y = oy;
      // Grasnarbe (hell oben, dunkle Spitzen) – manche Halme hängen länger herab
      ctx.fillStyle = '#7ec850';
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = '#4e9a3a';
      ctx.fillRect(x, y + 1, 1, grass - 1);
      if (hash(i, 204) < 0.18) {
        ctx.fillStyle = '#2f6b2a';
        ctx.fillRect(x, y + grass, 1, 2 + Math.floor(hash(i, 205) * 4));
      }
      y += grass;
      // Schatten unter dem Überhang
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y, 1, 2);
      // Humus, dann hellere Erde, dann eine Kieslage
      ctx.fillStyle = '#2a1a12';
      ctx.fillRect(x, y, 1, humus);
      y += humus;
      ctx.fillStyle = (i + Math.floor(wave)) % 7 === 0 ? '#5a3b2a' : '#4a3022';
      ctx.fillRect(x, y, 1, soil);
      y += soil;
      if (hash(i, 206) < 0.3) {
        ctx.fillStyle = hash(i, 207) < 0.5 ? '#6d6478' : '#8a7f72';
        ctx.fillRect(x, y - 1, 1 + (hash(i, 208) < 0.4 ? 1 : 0), 2);
      }
      // weicher Übergang in die Rückwand: gezackte Unterkante
      if (hash(i, 209) < 0.5) {
        ctx.fillStyle = '#4a3022';
        ctx.fillRect(x, y, 1, 1 + Math.floor(hash(i, 210) * 3));
      }
    }
    // Gras hängt auch über die Innenkanten der Seitenwände
    for (const side of [-1, 1]) {
      for (let d = 0; d < 5; d++) {
        const x = side < 0 ? x0 - 1 - d : ox + HW + d;
        const len = 3 + Math.floor(hash(d + (side > 0 ? 9 : 0), 211) * 6) - d;
        if (len <= 0) continue;
        ctx.fillStyle = d === 0 ? '#2f6b2a' : '#4e9a3a';
        ctx.fillRect(x, oy + 1, 1, len);
      }
    }
    // Wurzeln aus der Grasnarbe (nicht mitten über dem Seil)
    for (let n = 0; n < 4; n++) {
      const off = 4 + Math.floor(hash(n, 212) * (HW - 14));
      const rx = n % 2 ? ox - HW + off : ox + HW - off - 12;
      ctx.drawImage(roots(n + 3, 10 + Math.floor(hash(n, 213) * 14)), rx, oy + 5);
    }
  }

  /** Wellige Gesteinsbänder über die ganze Breite – weicher Übergang zwischen zwei Zonen. */
  private drawStrata(ctx: CanvasRenderingContext2D, W: number, ox: number, y: number, upper: Zone, lower: Zone) {
    const col: Record<Zone, [string, string, string]> = {
      earth: ['#3a261c', '#5a3b2a', '#8a5a34'],
      rock: ['#2c2638', '#4a4060', '#6d6478'],
      crystal: ['#2e1a4a', '#5a2f8a', '#8a55d0'],
      shroom: ['#0c2a2c', '#1c5a58', '#3fae8e'],
      lava: ['#3a0f10', '#7a2416', '#c9541e'],
      hell: ROCK_TONES.hell,
      icehell: ROCK_TONES.icehell,
      crystalhell: ROCK_TONES.crystalhell,
      abyss: ROCK_TONES.abyss,
    };
    const a = col[upper];
    const b = col[lower];
    const bands: [number, string, number][] = [
      [-10, a[1], 3],
      [-6, a[2], 1],
      [-4, b[0], 4],
      [1, b[1], 3],
      [5, a[1], 1],
      [7, b[2], 1],
      [9, b[0], 3],
    ];
    for (let x = 0; x < W; x++) {
      const wx = x - ox;
      const wave = Math.round(Math.sin(wx * 0.07 + y * 0.01) * 2 + Math.sin(wx * 0.19) * 1);
      for (const [dy, c, h] of bands) {
        // gezackte Kanten: jede zweite Spalte 1 px versetzt
        ctx.fillStyle = c;
        ctx.fillRect(x, y + dy + wave + ((wx & 1) && h > 1 ? 1 : 0), 1, h);
      }
    }
  }

  /** Hitzeflimmern über dem Lavafall: Zeilenbänder leicht seitlich versetzt (kopiert vom eigenen Canvas). */
  private heatShimmer(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, oy: number) {
    const y0 = Math.max(0, Math.round((LAVAFALL[0] - 80) * PPM) + oy);
    const y1 = Math.min(H, Math.round((HELL_M + 160) * PPM) + oy);
    if (y1 <= y0) return;
    // Bereich einmal kopieren, dann Bänder aus der Kopie versetzt zurückzeichnen
    const [sc, sctx] = this.shimmer;
    if (sc.width !== W || sc.height < y1 - y0) {
      sc.width = W;
      sc.height = Math.max(y1 - y0, sc.height);
    }
    sctx.clearRect(0, 0, W, y1 - y0);
    sctx.drawImage(ctx.canvas, 0, y0, W, y1 - y0, 0, 0, W, y1 - y0);
    for (let y = y0; y < y1; y += 3) {
      const dx = Math.round(Math.sin(y * 0.35 + v.time * 7));
      if (dx === 0) continue;
      const h = Math.min(3, y1 - y);
      ctx.drawImage(sc, 0, y - y0, W, h, dx, y, W, h);
    }
  }

  /** Dunkelheit über der Höhle; Stirnlampe, Kristalle, Pilze und Lava stanzen Licht heraus. */
  private drawDarkness(ctx: CanvasRenderingContext2D, W: number, H: number, _v: ViewState, oy: number) {
    if (this.dark.width !== W || this.dark.height !== H) {
      this.dark.width = W;
      this.dark.height = H;
    }
    const d = this.darkCtx;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    for (let y = Math.max(0, oy); y < H; y += 4) {
      const depthPx = y - oy;
      // direkt unter dem Eingang fällt noch Tageslicht ein
      const entry = clamp((depthPx - 30) / 260);
      if (entry <= 0) continue;
      const [alpha, [cr, cg, cb]] = zoneDarkness(depthPx / PPM);
      d.fillStyle = `rgba(${cr},${cg},${cb},${(entry * alpha).toFixed(3)})`;
      d.fillRect(0, y, W, 4);
    }
    d.globalCompositeOperation = 'destination-out';
    for (const [m, y] of this.maskLayers) d.drawImage(m, 0, y);
    for (const [x, y, r, , baked] of this.lights) if (!baked) d.drawImage(this.lightMaskOf(r), x - r, y - r);
    ctx.drawImage(this.dark, 0, 0);
    // farbiges Leuchten (Kristalle, Pilze, Lava, Lampe): feste Lichter kommen gesammelt aus den
    // Leucht-Bildern der Abschnitte, nur bewegte einzeln
    ctx.globalCompositeOperation = 'lighter';
    for (const [g, y] of this.glowLayers) ctx.drawImage(g, 0, y);
    this.glowLayers.length = 0;
    ctx.globalAlpha = GLOW_ALPHA; // dezenter Schein statt runder Scheibe
    for (const [x, y, r, color, baked] of this.lights) {
      if (!color || baked) continue;
      ctx.drawImage(this.glowSprite(r, color), x - r, y - r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Schneidet einen 40 px breiten Frame aus einem Spritesheet. */
function recolorNone(src: Sprite, x: number, w: number): Sprite {
  const [c, ctx] = canvas(w, src.height);
  ctx.drawImage(src, x, 0, w, src.height, 0, 0, w, src.height);
  return c;
}

/** Sprite um 90° drehen: dir 1 = im Uhrzeigersinn (oben zeigt nach rechts), -1 = gegen. */
function rotate90(src: Sprite, dir: 1 | -1): Sprite {
  const [c, ctx] = canvas(src.height, src.width);
  ctx.imageSmoothingEnabled = false;
  if (dir === 1) {
    ctx.translate(src.height, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, src.width);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  return c;
}
