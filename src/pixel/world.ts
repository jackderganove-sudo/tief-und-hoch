/**
 * Die Spielwelt als ein durchgehender Querschnitt:
 * y = 0 ist die Erdoberfläche, darüber der Himmel (Aufstieg), darunter die Höhle (Abstieg).
 * 1 Meter = 0,5 Welt-Pixel. Alle Zonen hängen fest an Metern.
 *
 * Gezeichnet wird in ein kleines Canvas (ca. 200–360 px breit), das per CSS
 * ganzzahlig und ohne Glättung hochskaliert wird. Alle Positionen werden gerundet.
 */
import type { Images } from './assets';
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
  planeSprite,
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
const LAKE_ROW = Math.round((7150 * PPM) / T); // Lavasee knapp unter 7000 m

type Zone = 'earth' | 'rock' | 'crystal' | 'shroom' | 'lava';
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

/** Zonengrenzen der Höhle in Metern Tiefe. */
export const CAVE_ZONES: [number, Zone][] = [
  [800, 'earth'],
  [2300, 'rock'],
  [3800, 'crystal'],
  [5300, 'shroom'],
  [Infinity, 'lava'],
];

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
};

/** Gesteinstöne je Zone [dunkel, mittel, hell] – für Felsnasen, Einbettungen und Steine. */
const ROCK_TONES: Record<Zone, [string, string, string]> = {
  earth: ['#3a261c', '#5a3b2a', '#8a5a34'],
  rock: ['#2c2638', '#4a4060', '#6d6478'],
  crystal: ['#24143c', '#4a2a78', '#7a50b8'],
  shroom: ['#0c2a2c', '#1c4a48', '#3f8e7e'],
  lava: ['#2a0c0a', '#5a1c12', '#8a3418'],
};

/** Weich zwischen den Zonen überblendet (±200 m um jede Grenze). */
function zoneDarkness(m: number): [number, [number, number, number]] {
  for (const [limit, zone] of CAVE_ZONES) {
    if (m < limit - 200) return ZONE_DARK[zone];
    if (m < limit + 200 && limit !== Infinity) {
      const next = CAVE_ZONES[CAVE_ZONES.findIndex(([l]) => l === limit) + 1]?.[1] ?? zone;
      const t = (m - (limit - 200)) / 400;
      const [a0, c0] = ZONE_DARK[zone];
      const [a1, c1] = ZONE_DARK[next];
      return [a0 + (a1 - a0) * t, [0, 1, 2].map((i) => Math.round(c0[i] + (c1[i] - c0[i]) * t)) as [number, number, number]];
    }
  }
  return ZONE_DARK.lava;
}

/** Zone einer Kachelzeile; an den Grenzen verzahnen sich die Schichten. */
function zoneOfRow(row: number): Zone {
  const m = (row * T) / PPM;
  for (const [limit, zone] of CAVE_ZONES) if (m < limit) return zone;
  return 'lava';
}

/** Felsvorsprung: alle ~11 Zeilen ragt von links oder rechts ein Sims in den Schacht. */
function ledgeOfRow(row: number): { side: -1 | 1; len: number; k: number } | null {
  if (row < 5 || row >= LAKE_ROW - 2) return null;
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

// Himmelsfarbe nach "Sichthöhe" in Metern. Zonen: Wiese/Wald 0–1300, Wolken 1300–2700,
// Höhenwind 2700–4000, Abendrot 4000–5300, Sterne ab 5300.
const SKY_STOPS: [number, string][] = [
  [0, ''], // wird beim Laden aus back.png gelesen
  [1300, ''], // Unterkante Wolkenband (bg-clouds)
  [2600, ''], // Oberkante Wolkenband
  [3500, '#2f6fe4'],
  [3850, '#6f7fe0'],
  [4100, '#c47fc4'],
  [4350, '#f79a7a'],
  [4550, '#f7a05e'],
  [4800, '#e2567c'],
  [5350, '#6c3c8c'],
  [5900, '#221d52'],
  [6500, '#0b0b22'],
];
/** Wie stark der Himmelsverlauf auf dem Bildschirm gestaucht ist (Ferne). */
const SKY_F = 0.25;

export class World {
  private img: Images;
  private sets: Record<Zone, TileSet>;
  private bg: Record<Zone, { far: CanvasPattern | null; mid: CanvasPattern | null; base: string; farH: number; midH: number }>;
  private explorer = explorerSprites();
  private balloons = new Map<string, Sprite>();
  private bats = batSprites();
  private signs = new Map<string, Sprite>();
  private buoy = buoySprite();
  private clouds: { alt: number; x: number; f: number; speed: number; sprite: Sprite }[] = [];
  private birds = birdSprites();
  private sun = sunSprite();
  private moon = moonSprite();
  private plane = planeSprite();
  private satellite = satelliteSprite();
  private eagleFlip: Sprite;
  private masks = new Map<number, Sprite>();
  private dark: Sprite;
  private darkCtx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private lights: [number, number, number, string?][] = [];
  private glowCache = new Map<string, Sprite>();
  private stars: [number, number, number][] = [];
  private stalactite: Sprite;

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

    // Wolken: feste Liste, Lage nach Metern. Hinter dem Ballon f < 1, davor f > 1.
    const sunset: [string, string, string] = ['#ffd9c2', '#ffab9a', '#d9708f'];
    const dusk: [string, string, string] = ['#c79bd8', '#8e62b0', '#5a3f86'];
    for (let i = 0; i < 30; i++) {
      const f = [0.6, 0.85, 1.25][i % 3];
      this.clouds.push({ alt: 1300 + hash(i, 1) * 1400, x: hash(i, 2) * 600, f, speed: 2 + hash(i, 3) * 5, sprite: cloudSprite(i + 1, Math.round(26 + hash(i, 4) * 44 * f)) });
    }
    for (let i = 0; i < 6; i++) {
      // vereinzelte Schönwetterwolken über dem Wald
      this.clouds.push({ alt: 500 + hash(i, 5) * 700, x: hash(i, 6) * 600, f: 0.7, speed: 3, sprite: cloudSprite(60 + i, 24 + Math.round(hash(i, 7) * 16)) });
    }
    for (let i = 0; i < 12; i++) {
      // Höhenwind: lange, flache Schleierwolken, die schnell ziehen
      const [c, cx] = canvas(40 + Math.round(hash(i, 11) * 50), 3);
      cx.fillStyle = '#e6f3ff';
      cx.fillRect(4, 0, c.width - 12, 1);
      cx.fillRect(0, 1, c.width, 1);
      cx.fillStyle = '#bcdcf7';
      cx.fillRect(8, 2, c.width - 14, 1);
      this.clouds.push({ alt: 2750 + hash(i, 12) * 1200, x: hash(i, 13) * 600, f: [0.7, 1.1][i % 2], speed: 18 + hash(i, 14) * 14, sprite: c });
    }
    for (let i = 0; i < 16; i++) {
      const high = i > 9;
      this.clouds.push({
        alt: high ? 5250 + hash(i, 21) * 500 : 4150 + hash(i, 21) * 1000,
        x: hash(i, 22) * 600,
        f: [0.6, 0.9, 1.2][i % 3],
        speed: 2 + hash(i, 23) * 4,
        sprite: cloudSprite(100 + i, Math.round(30 + hash(i, 24) * 50), high ? dusk : sunset),
      });
    }
    for (let i = 0; i < 220; i++) this.stars.push([hash(i, 31), 5300 + hash(i, 32) * 2600, hash(i, 33)]);

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
      const zone = centerDepth > 5300 ? 'lava' : centerDepth > 3800 ? 'shroom' : centerDepth > 2300 ? 'crystal' : 'other';
      if (zone === 'lava' && Math.random() < dt * 14)
        this.particles.push({ x: (Math.random() - 0.5) * HW * 2, y: top + H + 4, vx: (Math.random() - 0.5) * 8, vy: -24 - Math.random() * 26, life: 0, max: 3.2, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2b', size: 1, gravity: -4, glow: true });
      if (zone === 'shroom' && Math.random() < dt * 5)
        this.particles.push({ x: (Math.random() - 0.5) * HW * 1.9, y: top + Math.random() * H, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8, life: 0, max: 4, color: Math.random() < 0.6 ? '#d8ff7a' : '#7af0d0', size: 1, gravity: 0, glow: true });
    }
    void W;
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

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, v: ViewState, dt: number) {
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(W / 2 - v.camX); // Welt-x → Bildschirm
    const oy = Math.round(v.anchorY - v.camY); // Welt-y → Bildschirm
    const groundY = oy; // Bildschirm-y der Erdoberfläche
    this.lights.length = 0;

    if (groundY > 0) this.drawSky(ctx, W, H, v, ox, groundY);
    if (groundY < H) {
      if (v.show.cave) this.drawCave(ctx, W, H, v, ox, oy);
      else this.drawGround(ctx, W, H, ox, oy);
    }
    if (groundY > -60 && groundY < H + 200) this.drawSurface(ctx, W, ox, groundY, v.show.cave);

    if (v.crew) for (const c of v.crew) v.show.cave ? this.drawCrewExplorer(ctx, v, c, ox, oy, groundY) : this.drawCrewBalloon(ctx, v, c, ox, groundY);
    if (v.show.explorer) this.drawExplorer(ctx, v, ox, oy, groundY);
    if (v.show.balloon) this.drawBalloon(ctx, v, ox, groundY);

    // Wolken vor dem Ballon
    this.drawClouds(ctx, W, H, v, groundY, true);

    this.ambient(v, W, H, dt);
    this.updateParticles(dt);
    for (const p of this.particles) {
      if (p.life < 0 || p.glow) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x) + ox, Math.round(p.y) + oy, p.size, p.size);
    }

    if (groundY < H && v.show.cave) this.drawDarkness(ctx, W, H, v, oy);

    for (const p of this.particles) {
      if (p.life < 0 || !p.glow) continue;
      if (p.max - p.life < 0.25 && Math.floor(p.life * 30) % 2) continue; // flackert aus
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x) + ox, Math.round(p.y) + oy, p.size, p.size);
    }
  }

  /** Seil vom Holzgerüst und der Forscher mit Stirnlampe. */
  private drawExplorer(ctx: CanvasRenderingContext2D, v: ViewState, ox: number, oy: number, groundY: number) {
    const ey = Math.round(v.depth * PPM) + oy;
    const beamY = groundY - 34;
    ctx.fillStyle = '#d8b27a';
    const ropeTop = Math.max(-2, beamY);
    if (ey - 9 > ropeTop) {
      ctx.fillRect(ox, ropeTop, 1, ey - 9 - ropeTop);
      ctx.fillStyle = '#a8824e';
      for (let y = ropeTop + ((oy % 4) + 4) % 4; y < ey - 9; y += 4) ctx.fillRect(ox, y, 1, 1);
    }
    const sway = v.calm || v.explorerMoving ? 0 : Math.round(Math.sin(v.time * 1.6) * 1);
    const frame =
      v.explorerMood === 'cheer'
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
    const shake = v.explorerMood === 'flinch' ? Math.round(Math.sin(v.time * 40) * 1) : 0;
    ctx.drawImage(frame, ox - 7 + sway + shake, ey - 9);
    this.lights.push([ox + 5 + sway, ey - 5, 72, '#ffe9a8']);
  }

  /** Mitspieler im Abstieg: eigenes Seil, kleine Figur mit Hemd in Spielerfarbe. */
  private drawCrewExplorer(ctx: CanvasRenderingContext2D, v: ViewState, c: CrewMember, ox: number, oy: number, groundY: number) {
    const x = ox + Math.round(c.x);
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
    ctx.drawImage(s, ox + v.balloonX + Math.round(c.x) - 8 + shake, by - 30 + bob + jump);
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, v: ViewState, ox: number, groundY: number) {
    const by = groundY - Math.round(v.altitude * PPM);
    const bob = v.calm || v.altitude < 4 ? 0 : Math.round(Math.sin(v.time * 1.3) * 1.5);
    const flame = v.balloonRising ? 1 + (Math.floor(v.time * 12) % 3) : !v.calm && v.altitude > 4 && Math.floor(v.time * 0.6) % 4 === 0 ? 1 + (Math.floor(v.time * 12) % 3) : 0;
    const key = `${flame}-${v.balloonMood}`;
    let bs = this.balloons.get(key);
    if (!bs) this.balloons.set(key, (bs = balloonSprite(flame, v.balloonMood)));
    const bShake = v.balloonMood === 'flinch' ? Math.round(Math.sin(v.time * 36) * 1) : 0;
    ctx.drawImage(bs, ox + v.balloonX - 23 + bShake, by - 74 + bob);
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
    if (camM > 4300) {
      for (const [sx, m, ph] of this.stars) {
        const y = at(m, 0.12);
        if (y < 0 || y >= bottom) continue;
        const tw = v.calm ? 1 : Math.sin(v.time * (1 + ph * 2) + ph * 20);
        if (tw < -0.6) continue;
        const x = Math.floor(sx * W);
        ctx.fillStyle = ph > 0.8 ? '#bfe6ff' : ph > 0.6 ? '#ffe9b8' : '#ffffff';
        ctx.globalAlpha = clamp((camM - 4300) / 1200);
        ctx.fillRect(x, y, 1, 1);
        if (ph > 0.92 && tw > 0.5) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(this.moon, Math.round(W * 0.7), at(6700, 0.2));
      const sat = mod(v.calm ? 60 : v.time * 5, W + 60) - 30;
      ctx.drawImage(this.satellite, Math.round(sat), at(7100, 0.35) + Math.round(sat * 0.12));
    }

    // 3. Sonne im Abendrot – sinkt beim Steigen langsam
    const sunY = at(4700, 0.6);
    if (sunY > -50 && sunY < bottom) ctx.drawImage(this.sun, Math.round(W * 0.22) - 22, sunY);

    // 4. Meer am Horizont und Wolkenband (fernste Ebenen)
    const back = this.img['sunny/back'];
    const backY = layerGround(0.35) - 150;
    if (backY < bottom && backY + 240 > 0) {
      const off = mod(Math.round(-v.camX * 0.1), 384);
      for (let x = off - 384; x < W; x += 384) ctx.drawImage(back, x, backY);
    }
    const strip = this.img['woods/bg-clouds'];
    const stripY = at(2350, 0.4);
    if (stripY < bottom && stripY + 208 > 0) {
      const off = mod(Math.round(-v.camX * 0.15 + (v.calm ? 0 : v.time * 1.5)), 160);
      for (let x = off - 160; x < W; x += 160) ctx.drawImage(strip, x, stripY);
    }

    // 5. Flugzeug in der Ferne mit Kondensstreifen (Höhenwind-Zone)
    const planeY = at(3350, 0.55);
    if (planeY > -10 && planeY < bottom) {
      const px = Math.round(mod(v.calm ? 120 : v.time * 16, W + 160) - 60);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 60; i += 2) {
        ctx.globalAlpha = clamp(1 - i / 60) * 0.8;
        ctx.fillRect(px - 2 - i, planeY + 3, 2, 1);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(this.plane, px, planeY);
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

    // 9. Vögel: kleine Schwärme über dem Wald, ab und zu ein Adler
    for (let i = 0; i < 6; i++) {
      const alt = 350 + hash(i, 41) * 1000;
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

    // 10. Höhenschilder an Signalballons
    for (let m = 500; m <= 7000; m += 500) {
      const y = groundY - Math.round(m * PPM);
      if (y < -30 || y > bottom + 10) continue;
      const sign = this.sign(`+${m} m`);
      const x = ox + BALLOON_X + 34;
      const bobS = v.calm ? 0 : Math.round(Math.sin(v.time * 1.1 + m) * 1);
      ctx.drawImage(this.buoy, x + Math.floor(sign.width / 2) - 4, y - 12 + bobS);
      ctx.drawImage(sign, x, y - 2 + bobS);
    }
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
    const r1 = Math.ceil((H - oy) / T);
    const c0 = Math.floor(-ox / T);
    const c1 = Math.ceil((W - ox) / T);
    const earth = this.sets.earth;

    for (let r = r0; r <= r1; r++) {
      const y = r * T + oy;
      const zone = zoneOfRow(r);
      const set = this.sets[zone];
      const bg = this.bg[zone];
      const ledge = ledgeOfRow(r);

      // --- Rückwand des Schachts (Parallax-Muster je Zone) – ab Bodenhöhe, damit kein gerader Schnitt entsteht
      if (r >= 0) {
        ctx.fillStyle = bg.base;
        ctx.fillRect(ox - HW, y, HW * 2, T);
        if (zone === 'earth') {
          ctx.fillStyle = '#3a2a24';
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
        }
        // hintere Ebenen dunkler/blasser, vordere kräftiger → Tiefe
        for (const [p, f, alpha] of [
          [bg.far, 0.45, 0.45],
          [bg.mid, 0.72, 0.8],
        ] as [CanvasPattern | null, number, number][]) {
          if (!p) continue;
          const ty = Math.round(v.anchorY - v.camY * f);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.rect(ox - HW, y, HW * 2, T);
          ctx.clip();
          ctx.translate(ox - 60, ty);
          ctx.fillStyle = p;
          ctx.fillRect(60 - HW, y - ty, HW * 2, T);
          ctx.restore();
        }
        if (zone !== 'earth' && r < LAKE_ROW) this.backWallDetails(ctx, zone, r, ox, y, v);
        // Schatten der Seitenwände auf der Rückwand
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(ox - HW, y, 3, T);
        ctx.fillRect(ox + HW - 3, y, 3, T);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(ox - HW + 3, y, 4, T);
        ctx.fillRect(ox + HW - 7, y, 4, T);
      }

      // --- Lavasee
      if (r >= LAKE_ROW) {
        for (let x = -HW; x < HW; x += 2) {
          const wave = r === LAKE_ROW ? Math.round(Math.sin(x * 0.22 + v.time * 2) * 1.5 + Math.sin(x * 0.5 - v.time * 1.3)) + 3 : 0;
          ctx.fillStyle = r === LAKE_ROW ? '#ffd27a' : '#ff7a2b';
          ctx.fillRect(ox + x, y + wave, 2, T - wave);
          ctx.fillStyle = r === LAKE_ROW ? '#ff8a2b' : r === LAKE_ROW + 1 ? '#e2541e' : '#c23a16';
          ctx.fillRect(ox + x, y + wave + 2, 2, T - wave - 2);
          if (r === LAKE_ROW && !v.calm && hash(x, Math.floor(v.time * 1.5)) < 0.05) {
            ctx.fillStyle = '#fff1b0';
            ctx.fillRect(ox + x, y + wave + 4, 2, 2);
          }
        }
        if (r === LAKE_ROW) for (let x = -HW + 12; x < HW; x += 24) this.lights.push([ox + x, y + 6, 44, '#ff7a2b']);
      }

      // --- Fels links und rechts vom Schacht
      for (let c = c0; c <= c1; c++) {
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

      // --- Hintergrund-Fels neben dem Schacht: dunkler, eigene Struktur (Deko hängt nicht vor „nichts“)
      if (r >= 1) this.backRock(ctx, zone, r, ox, y, W);

      // --- Leuchtendes im Fels neben dem Schacht: die Zone ist auch außerhalb der Lampe erkennbar
      if (r >= 2 && r < LAKE_ROW) {
        if (zone === 'lava') this.lavaRock(ctx, r, ox, y, W, v);
        else this.sideEmitters(ctx, zone, r, ox, y, W);
      }

      // --- Sims mit allem, was darauf wächst oder daran hängt
      if (ledge && r < LAKE_ROW) {
        const { side, len, k } = ledge;
        const lx = (i: number) => ox + (side < 0 ? -HW + i * T : HW - (i + 1) * T);
        if (zone === 'earth') {
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
              if (!v.calm && Math.floor(v.time * 1.5 + k) % 4 === 0) {
                ctx.fillStyle = '#cfe8ff';
                ctx.fillRect(px0 + 2, y + 1, 1, 1);
              }
            }
            if (hash(k, 74) < 0.7) {
              ctx.drawImage(this.stalactite, Math.round(mid - 19), y + T + 4);
              // Tropfen fällt von der Spitze
              if (!v.calm) {
                const t = mod(v.time * 0.8 + hash(k, 75) * 3, 3);
                if (t < 1.4) {
                  ctx.fillStyle = '#9fd8ff';
                  ctx.fillRect(Math.round(mid), y + T + 58 + Math.round(t * t * 46), 1, 2);
                }
              }
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
      if (r >= 2 && r < LAKE_ROW - 1 && !ledge) {
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
      if (r > 1 && zone !== zoneOfRow(r - 1)) this.drawStrata(ctx, W, ox, y, zoneOfRow(r - 1), zone);

      // --- Fledermäuse in der Felshöhle
      if (zone === 'rock' && r % 9 === 4) {
        const bx = ox + Math.round(Math.sin((v.calm ? 0 : v.time * 0.7) + r) * (HW - 14));
        const byy = y + Math.round(Math.cos((v.calm ? 0 : v.time * 1.9) + r) * 5);
        ctx.drawImage(this.bats[v.calm ? 0 : Math.floor(v.time * 7 + r) % 2], bx - 6, byy);
      }
    }

    // --- Übergang Wiese → Schacht (nach den Zeilen, damit er obenauf liegt)
    if (oy > -40 && oy < H) this.shaftLip(ctx, ox, oy);

    // --- Tiefenschilder an der rechten Wand
    for (let m = 500; m <= 7000; m += 500) {
      const y = Math.round(m * PPM) + oy;
      if (y < -20 || y > H + 20) continue;
      const s = this.sign(`-${m} m`);
      ctx.drawImage(s, ox + HW - s.width + 3, y - 6);
    }
  }

  /**
   * Struktur der Schacht-Rückwand (Risse, Kiesel, Glanzpunkte) – bewusst keine Objekte:
   * Rund ums Seil gibt es nur Partikel (Staub, Funken, Glühwürmchen), keine Deko.
   */
  private backWallDetails(ctx: CanvasRenderingContext2D, zone: Zone, r: number, ox: number, y: number, v: ViewState) {
    const px = (i: number, salt: number) => ox - HW + 4 + Math.floor(hash(r * 7 + i, salt) * (HW * 2 - 8));
    const py = (i: number, salt: number) => y + Math.floor(hash(r * 7 + i, salt) * (T - 4));
    const tone: Record<Zone, [string, string, string]> = {
      earth: ['#3e2c25', '#54392b', '#17110d'],
      rock: ['#4a4060', '#6d6478', '#17131f'],
      crystal: ['#3a2560', '#5a3f8a', '#1a0f2c'],
      shroom: ['#1c3a3a', '#2c5450', '#0a1a1c'],
      lava: ['#5a1f14', '#7a2a18', '#24090a'],
    };
    const [stone, light, crack] = tone[zone];
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
    if (zone === 'rock' && hash(r, 15) < 0.6 && !v.calm && Math.floor(v.time * 2 + hash(r, 16) * 8) % 5 === 0) {
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
        // Pilzgruppe auf Moospolster, direkt am Fels (kein Kasten)
        const k = Math.floor(h * 97) % 3;
        const s = shroomPatch(seed * 5 + 2, k);
        ctx.drawImage(s, Math.round(x - s.width / 2), y + 18 - s.height);
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
    for (const [x, y, r] of this.lights) {
      let m = this.masks.get(r);
      if (!m) this.masks.set(r, (m = lightMask(r)));
      d.drawImage(m, x - r, y - r);
    }
    ctx.drawImage(this.dark, 0, 0);
    // farbiges Leuchten (Kristalle, Pilze, Lava, Lampe)
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, color] of this.lights) {
      if (!color) continue;
      const key = `${r}-${color}`;
      let g = this.glowCache.get(key);
      if (!g) {
        const m = lightMask(r);
        g = recolor(m, () => {
          const n = parseInt(color.slice(1), 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        });
        this.glowCache.set(key, g);
      }
      ctx.globalAlpha = 0.14; // dezenter Schein statt runder Scheibe
      ctx.drawImage(g, x - r, y - r);
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
