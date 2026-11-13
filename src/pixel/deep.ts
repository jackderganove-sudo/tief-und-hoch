/**
 * Endlose Tiefen unter dem Höllentor: Eis-Hölle, Kristall-Hölle, Abgrund (je 2.000 m, wiederholt).
 * hell.ts zeichnet die gemeinsamen Bauteile (Säulen, Simse, Teufelchen …) in diesen Farben;
 * hier kommen Paletten, Dunkelheit und die eigenen Ebenen jeder Tiefe dazu.
 *
 *  - Eis-Hölle: Eiswände mit eingewachsenen Kristallen, Simse mit Eiszapfen, erstarrte Lavafälle
 *    (unter dem Eis glimmt noch Glut), blaues Feuer, Schneeglitzern.
 *  - Kristall-Hölle: riesige leuchtende Kristallsäulen, deren Flächen die Gegenseite spiegeln,
 *    wandernde Lichtreflexe, Splitter am Rand, funkelnde Spitzen.
 *  - Abgrund: fast dunkel – ferne Lichter in endlosen Nebelschichten, schwebende Ruinen mit
 *    leuchtendem Moos und Wurzeln, Leuchtquallen, aufsteigende Sporen.
 *
 * Leistung: Alles Statische wird einmal (beim ersten Erreichen einer Tiefe) in große, senkrecht
 * kachelbare Bilder gerechnet; pro Bild nur wenige drawImage-Aufrufe je Ebene plus ein paar
 * bewegte Kleinigkeiten (Flammen, Glanz, Quallen, Partikel). Keine Pixelarbeit im Bild-Takt.
 */
import type { Images } from './assets';
import { crystalCluster, rng } from './decor';
import { canvas, rampMap, recolor, type Sprite } from './sprites';
import { GATE_M, LEVEL_SPAN } from './zones';
import { HELL_BG, levelAt, mod, PPM, hash, type Darkness, type DeepLevel, type HellFrame, levelBlend, type Level, type Palette, type SharedParts } from './hellShared';

export const DEEP_PAL: Record<DeepLevel, Palette> = {
  icehell: {
    bg: ['#0e2038', '#060c1c'],
    far: ['#0a1628', '#1e3a5e'],
    col: ['#081222', '#1c3454', '#4e7eb0', '#bfe8ff'],
    lake: ['#0c2a4a', '#2a6aa8', '#6ab8e8', '#bfe8ff', '#ffffff'],
    rune: '#8be9fd',
    flame: ['#ffffff', '#bfe8ff', '#5ab8ff'],
    imp: ['#06121e', '#123a5a', '#2a7ab0', '#8ad0f8', '#ffffff'],
    steam: ['#4a6a8a', '#8aaccc', '#c8e4f8', '#e8f6ff', '#ffffff'],
  },
  crystalhell: {
    bg: ['#2a0e46', '#120622'],
    far: ['#1a0a2e', '#3c1a66'],
    col: ['#120624', '#2e1452', '#6a32b0', '#f08ae6'],
    lake: ['#3a0a5a', '#7a20b0', '#c050f0', '#f0a0ff', '#ffe0ff'],
    rune: '#f08ae6',
    flame: ['#ffe0ff', '#f0a0ff', '#b04af0'],
    imp: ['#14061e', '#4a1270', '#9a32d0', '#e08af8', '#fff0ff'],
    steam: ['#4a2a6a', '#8a5ab0', '#c8a0e8', '#ecd8ff', '#ffffff'],
  },
  abyss: {
    bg: ['#0a0616', '#030208'],
    far: ['#0a0614', '#1c1230'],
    col: ['#06040c', '#140e22', '#2e2248', '#7a5aff'],
    lake: ['#082830', '#145a5a', '#2aa898', '#7af0d8', '#d8fff4'],
    rune: '#3af0c8',
    flame: ['#d8fff4', '#7af0d8', '#2aa898'],
    imp: ['#06040c', '#1e1440', '#4a3a90', '#9a88e0', '#f0ecff'],
    steam: ['#2a2240', '#4a3e6a', '#7a6aa0', '#b0a4d0', '#e0dcf0'],
  },
};

export const DEEP_DARK: Record<DeepLevel, Darkness> = {
  icehell: [0.42, [8, 18, 40]],
  crystalhell: [0.4, [30, 8, 48]],
  abyss: [0.5, [4, 2, 10]],
};

/** Welche gemeinsamen Bauteile aus hell.ts in jeder Tiefe erscheinen (und wie dicht). */
export const DEEP_SHARED: Record<DeepLevel, SharedParts> = {
  // Eis: vereiste Säulen und Simse bleiben teilweise, Fernsäulen ersetzt die Eiswand
  icehell: {
    farColumns: 0,
    midColumns: 0.5,
    ledges: 0.45,
    imps: 0.5,
    chains: 0.2,
    spirits: 0.7,
    steam: 0.35,
    torches: 0.5,
  },
  // Kristall: die Kristallsäulen ersetzen die Basaltsäulen ganz
  crystalhell: {
    farColumns: 0,
    midColumns: 0,
    ledges: 0.3,
    imps: 0.35,
    chains: 0,
    spirits: 0.5,
    steam: 0.2,
    torches: 0.2,
  },
  // Abgrund: fast leer – ein paar Ketten ins Nichts und Irrlichter
  abyss: {
    farColumns: 0,
    midColumns: 0,
    ledges: 0.12,
    imps: 0.1,
    chains: 0.45,
    spirits: 0.35,
    steam: 0,
    torches: 0,
  },
};

// ---------------------------------------------------------------- Hilfen fürs Vorrechnen

type RGB = [number, number, number];
const C = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(mod(y, 4) << 2) | mod(x, 4)] + 0.5) / 16;

/** Periodisches Rauschen in [-1, 1] mit Periode p (für senkrecht kachelbare Formen). */
function pnoise(y: number, p: number, seed: number) {
  let v = 0;
  let a = 0;
  for (const k of [1, 2, 3, 5]) {
    v += Math.sin((2 * Math.PI * k * y) / p + seed * 1.7 + k * 2.3) / k;
    a += 1 / k;
  }
  return v / a;
}

/** Pixelpuffer (ImageData) mit Umbruch: senkrecht immer, waagrecht optional. */
class Buf {
  readonly img: ImageData;
  readonly px: Uint32Array;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly wrapX = true,
  ) {
    this.img = new ImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
  }
  idx(x: number, y: number) {
    let xi = Math.round(x);
    const yi = mod(Math.round(y), this.h);
    if (this.wrapX) xi = mod(xi, this.w);
    else if (xi < 0 || xi >= this.w) return -1;
    return yi * this.w + xi;
  }
  set(x: number, y: number, c: RGB, a = 1) {
    const i = this.idx(x, y);
    if (i < 0 || a <= 0) return;
    if (a >= 1) {
      this.px[i] = (0xff000000 | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
      return;
    }
    const e = this.px[i];
    const ea = (e >>> 24) / 255;
    const oa = a + ea * (1 - a);
    const k = ea * (1 - a);
    const r = (c[0] * a + (e & 255) * k) / oa;
    const g = (c[1] * a + ((e >>> 8) & 255) * k) / oa;
    const b = (c[2] * a + ((e >>> 16) & 255) * k) / oa;
    this.px[i] = ((Math.round(oa * 255) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }
  /** Farbe und Deckkraft an einer Stelle (null = durchsichtig). */
  get(x: number, y: number): RGB | null {
    const i = this.idx(x, y);
    if (i < 0) return null;
    const e = this.px[i];
    if (e >>> 24 < 128) return null;
    return [e & 255, (e >>> 8) & 255, (e >>> 16) & 255];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c, a);
  }
  /** Gestufter, geditherter Lichtschein (Pixel-Look statt weichem Verlauf). */
  halo(x: number, y: number, r: number, c: RGB, a: number) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const q = 1 - Math.hypot(dx, dy) / r;
        if (q <= 0) continue;
        const step = Math.floor(q * q * 3 + bayer(x + dx, y + dy)) / 3;
        if (step > 0) this.set(x + dx, y + dy, c, a * step);
      }
  }
  toCanvas(): Sprite {
    const [c, ctx] = canvas(this.w, this.h);
    ctx.putImageData(this.img, 0, 0);
    return c;
  }
}

/** Bild mit senkrechtem (und ggf. waagrechtem) Umbruch auf eine Kachel zeichnen. */
function blitWrap(ctx: CanvasRenderingContext2D, s: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, wrapX = true) {
  const xs = wrapX ? [x - w, x, x + w] : [x];
  for (const xx of xs) for (const yy of [y - h, y, y + h]) if (xx + s.width > 0 && xx < w && yy + s.height > 0 && yy < h) ctx.drawImage(s, Math.round(xx), Math.round(yy));
}

interface Pt {
  x: number;
  y: number;
  r?: number;
  c?: string;
}
interface Seg {
  x: number;
  w: number;
  y0: number;
  y1: number;
}
/** Senkrecht kachelbares Ebenenbild; cx = Bild-x der Seilmitte. */
interface Tile {
  img: Sprite;
  w: number;
  h: number;
  cx: number;
  lights: Pt[];
  flames: Pt[];
  glints: Seg[];
  sparks: Pt[];
}
const tile = (b: Buf, cx: number): Tile => ({
  img: b.toCanvas(),
  w: b.w,
  h: b.h,
  cx,
  lights: [],
  flames: [],
  glints: [],
  sparks: [],
});

/** Randstreifen vorn: links und rechts (rechts gespiegelt gebaut, x vom Bildrand aus). */
interface Strip {
  l: Tile;
  r: Tile;
}

interface Ruin {
  spr: Sprite;
  lights: Pt[];
}
interface RuinPlace {
  v: number;
  x: number;
  y: number;
}

interface LevelArt {
  back: [Tile, number][];
  front: [Strip, number];
}

/** Hintergrund der Hölle über dem Tor (wie PAL.hell.bg in hell.ts – für den Schleier am Tor). */
const bgOf = (l: Level) => (l === 'hell' ? HELL_BG : DEEP_PAL[l].bg);
const ALL_LIT = () => true;

/** Höhe des Dunstschleiers an den Ebenengrenzen in Bildpunkten (±200 m). */
const BAND = Math.round(400 * PPM);

const STRIP_W = 58;

// ---------------------------------------------------------------- Eis-Hölle

const ICE = {
  deep: C('#081222'),
  d1: C('#0c1c34'),
  d2: C('#10243f'),
  d3: C('#16304f'),
  i1: C('#1c4a78'),
  i2: C('#2e6ea8'),
  i3: C('#4e9ad0'),
  i4: C('#8ad0f0'),
  i5: C('#cdf2ff'),
  snow: C('#e8f8ff'),
  white: C('#ffffff'),
  fire: C('#5ab8ff'),
  ember: C('#c8502a'),
  ember2: C('#ff9a4a'),
};

/** Eiszapfen nach unten (2 px breit, wenn lang). */
function icicle(b: Buf, x: number, y: number, len: number) {
  for (let i = 0; i < len; i++) {
    const tip = i >= len - 1;
    b.set(x, y + i, tip ? ICE.white : i < 2 ? ICE.i3 : ICE.i4);
    if (len > 5 && i < len * 0.55) b.set(x + 1, y + i, ICE.i2);
  }
}

/** Erstarrter Lavafall: Eis außen, darunter glimmt die Glut; unten ein gefrorener Haufen. */
function frozenFall(b: Buf, cx: number, y0: number, len: number, fw: number, seed: number) {
  const R = rng(seed);
  const phase = Math.floor(R() * 13);
  const pile = 16;
  for (let yy = 0; yy < len; yy++) {
    const bulge = mod(yy + phase, 13) < 2 ? 1 : 0;
    const spread = yy > len - pile ? Math.round((yy - (len - pile)) * 0.45) : 0;
    const round = yy > len - 4 ? (yy - (len - 4)) * 2 : 0;
    const w = Math.max(2, fw + bulge + spread * 2 - round);
    const wob = Math.round(Math.sin(yy * 0.13 + seed) * 1.2);
    const x0 = Math.round(cx - w / 2) + wob;
    const core = 0.45 + 0.15 * Math.sin(yy * 0.07 + seed);
    for (let x = 0; x < w; x++) {
      const rel = x / Math.max(1, w - 1);
      let c = rel < 0.15 ? ICE.i5 : rel < 0.45 ? ICE.i3 : rel < 0.8 ? ICE.i2 : ICE.i1;
      if (hash(x0 + x, 5) < 0.25 && rel > 0.15) c = mix(c, ICE.i4, 0.35);
      if (mod(yy + phase, 13) === 0 && rel < 0.75) c = ICE.snow;
      b.set(x0 + x, y0 + yy, c);
      // Glut unter dem Eis
      if (yy < len - 6 && Math.abs(rel - core) < 0.13) b.set(x0 + x, y0 + yy, R() < 0.05 ? ICE.ember2 : ICE.ember, 0.5);
    }
    b.set(x0 + w, y0 + yy, ICE.deep, 0.6);
  }
  for (let x = -fw / 2 - 2; x < fw / 2 + 4; x++) if (R() < 0.5) icicle(b, cx + x, y0 + len - 1, 2 + Math.floor(R() * R() * 9));
}

function iceFar(): Tile {
  const w = 384;
  const h = 288;
  const cx = 192;
  const b = new Buf(w, h);
  const R = rng(1101);
  const body = C('#0d203b');
  const streak = C('#132a4c');
  const edge = C('#2a5a90');
  for (let y = 0; y < h; y++) {
    const eL = cx - 100 + 24 * pnoise(y, h, 1) + 7 * pnoise(y, h / 3, 2);
    const eR = cx + 100 - 24 * pnoise(y, h, 3) - 7 * pnoise(y, h / 3, 4);
    for (let x = 0; x < w; x++) {
      const dl = eL - x;
      const dr = x - eR;
      const dd = Math.max(dl, dr);
      if (dd < 0) continue;
      b.set(x, y, dd < 1 ? edge : hash(Math.floor(x / 3), 7) < 0.22 ? streak : body);
    }
  }
  // ferne erstarrte Fälle
  const falls: [number, number, number, number][] = [
    [cx - 62, 7, 0, h],
    [cx + 58, 6, 0, h],
    [cx - 84, 5, 40, 150],
    [cx + 82, 5, 170, 120],
    [cx - 30, 4, 200, 70],
  ];
  for (const [fx, fw, y0, len] of falls)
    for (let yy = 0; yy < len; yy++) {
      const spread = len < h && yy > len - 8 ? Math.round((yy - (len - 8)) * 0.5) : 0;
      for (let x = -spread; x < fw + spread; x++) {
        const rel = x / (fw - 1);
        let c = mix(C('#1c4070'), C('#3a70a8'), Math.max(0, 1 - Math.abs(rel - 0.4) * 2));
        if (mod(y0 + yy + Math.floor(hash(fx + x, 3) * 3), 9) === 0) c = C('#5a90c8');
        b.set(fx + x, y0 + yy, c);
      }
    }
  // ferne blaue Feuer
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const x = cx + side * (100 + R() * 70);
    const y = R() * h;
    b.halo(x, y, 5, ICE.fire, 0.45);
    b.rect(x, y, 2, 2, C('#bfe8ff'));
  }
  // Nebelbänder
  for (const fy of [60, 200]) for (let y = -10; y < 10; y++) for (let x = 0; x < w; x++) if (bayer(x, y) < 0.35 * (1 - Math.abs(y) / 10)) b.set(x, fy + y, C('#4e7eb0'), 0.14);
  return tile(b, cx);
}

function iceMid(): Tile {
  const w = 384;
  const h = 512;
  const cx = 192;
  const b = new Buf(w, h);
  const R = rng(1201);
  const out = tile(b, cx);
  const E = (s: number, y: number) => 68 + 16 * pnoise(y, h, s * 5) + 5 * pnoise(y, h / 4, s * 7);
  // Eiswände
  for (const s of [-1, 1])
    for (let y = 0; y < h; y++) {
      const e = E(s, y);
      for (let dist = Math.floor(e); dist <= cx; dist++) {
        const x = cx + s * dist;
        const dd = dist - e;
        const cX = Math.floor(x / 7);
        const cy = mod(y + cX * 5, h);
        let c = [ICE.d1, ICE.d2, ICE.d3][Math.floor(hash(cX * 31 + Math.floor(cy / 8), s) * 3)];
        if (cy % 8 === 0) c = ICE.deep;
        if (dd < 1) c = ICE.i4;
        else if (dd < 3) c = ICE.i2;
        else if (dd < 6) c = mix(c, ICE.i1, 0.5);
        b.set(x, y, c);
        if (dd > 6 && hash(x * 13 + y, 9) < 0.004) b.set(x, y, ICE.i5);
      }
    }
  // eingewachsene Kristalle: Schein vorher, Kristall nachher (Canvas)
  const crystals: [number, number, number, 0 | 1 | 2][] = [];
  for (const s of [-1, 1])
    for (let j = 0; j < 6; j++) {
      const y = j * 85 + R() * 40;
      const dist = E(s, y) + 4 + R() * 14;
      const x = cx + s * dist;
      const size = (R() < 0.4 ? 2 : 1) as 1 | 2;
      b.halo(x, y - 6, 12, C('#7fe3f5'), 0.28);
      crystals.push([x, y, j * 7 + (s > 0 ? 3 : 0), size]);
    }
  // Simse mit Eiszapfen, blauem Feuer und erstarrten Fällen
  for (const s of [-1, 1])
    for (let j = 0; j < 4; j++) {
      const y = Math.round(j * 128 + 20 + R() * 60);
      const e = E(s, y);
      const P = 10 + Math.floor(R() * 14);
      for (let row = 0; row < 8; row++) {
        const tipIn = row < 5 ? 0 : (row - 4) * 3;
        for (let dist = Math.floor(e - P + tipIn); dist <= e + 3; dist++) {
          const c = row === 0 ? ICE.snow : row === 1 ? ICE.i5 : row < 5 ? (dist < e - P + 3 ? ICE.i3 : ICE.i2) : ICE.i1;
          b.set(cx + s * dist, y + row, c);
        }
      }
      for (let dist = Math.floor(e - P + 2); dist <= e; dist++) if (R() < 0.55) icicle(b, cx + s * dist, y + 8, 2 + Math.floor(R() * R() * 14));
      if (R() < 0.65) {
        const fx = cx + s * (e - P * 0.5);
        b.halo(fx, y - 5, 14, ICE.fire, 0.3);
        out.flames.push({ x: Math.round(fx), y });
        out.lights.push({ x: Math.round(fx), y: y - 5, r: 16, c: '#5ab8ff' });
      }
      if (R() < 0.55) {
        const fx = Math.round(cx + s * (e - P + 6));
        const len = 90 + Math.floor(R() * 90);
        const fw = 8 + Math.floor(R() * 5);
        frozenFall(b, fx, y + 7, len, fw, j * 11 + s);
        out.glints.push({ x: fx - 1, w: 1, y0: y + 9, y1: y + len - 8 });
      }
    }
  out.img = b.toCanvas();
  const ctx = out.img.getContext('2d')!;
  for (const [x, y, seed, size] of crystals) {
    const cr = crystalCluster(seed, size, 0);
    blitWrap(ctx, cr, x - cr.width / 2, y - cr.height, w, h);
  }
  return out;
}

/** Vordergrund-Streifen am Bildrand; u = Abstand vom Rand, side 1 = rechts (gespiegelt). */
function stripBuf(side: number) {
  const b = new Buf(STRIP_W, 1152, false);
  const px = (u: number, y: number, c: RGB, a = 1) => b.set(side > 0 ? STRIP_W - 1 - u : u, y, c, a);
  const X = (u: number) => (side > 0 ? STRIP_W - 1 - u : u);
  return { b, px, X };
}

function iceFront(side: number): Tile {
  const { b, px, X } = stripBuf(side);
  const h = b.h;
  const R = rng(1301 + side * 17);
  const rock = [C('#050b16'), C('#0a1626'), C('#10203a')];
  // dünne Wand am Rand
  for (let y = 0; y < h; y++) {
    const e = 3 + 3 * (pnoise(y, h / 6, side) + 1);
    for (let u = 0; u < e; u++) px(u, y, u > e - 1 ? ICE.i1 : rock[0]);
  }
  const out = {
    flames: [] as Pt[],
    lights: [] as Pt[],
    crystals: [] as [number, number, number][],
  };
  for (let k = 0; k < 6; k++) {
    const y0 = Math.round(k * 192 + R() * 80);
    const D = 22 + Math.floor(R() * 26);
    const Ht = 14 + Math.floor(R() * 14);
    for (let yy = 0; yy < Ht; yy++) {
      const ext = D * Math.pow(1 - yy / Ht, 0.7) + 4;
      for (let u = 0; u < ext; u++) {
        let c = rock[hash(Math.floor(u / 4) + k, Math.floor(yy / 5)) < 0.5 ? 1 : 0];
        if (yy === 0) c = ICE.snow;
        else if (yy === 1) c = ICE.i4;
        else if (yy === 2) c = ICE.i2;
        else if (u > ext - 1.5) c = rock[2];
        px(u, y0 + yy, c);
      }
      // Zapfen an der Unterkante
      const ext2 = D * Math.pow(1 - (yy + 1) / Ht, 0.7) + 4;
      for (let u = Math.floor(ext2); u < ext; u++) if (R() < 0.5) icicle(b, X(u) - (side > 0 ? 1 : 0), y0 + yy + 1, 3 + Math.floor(R() * R() * 20));
    }
    // Schneehaube
    for (let u = 0; u < D * 0.8; u++) if (R() < 0.4) px(u, y0 - 1, ICE.snow);
    if (R() < 0.55) {
      const u = Math.round(D * (0.35 + R() * 0.3));
      out.flames.push({ x: X(u), y: y0 });
      out.lights.push({ x: X(u), y: y0 - 6, r: 18, c: '#5ab8ff' });
      b.halo(X(u), y0 - 6, 12, ICE.fire, 0.3);
    } else if (R() < 0.7) {
      out.crystals.push([X(Math.round(D * 0.6)), y0 + 1, k * 5 + side]);
    }
  }
  const t: Tile = { ...tile(b, 0), flames: out.flames, lights: out.lights };
  const ctx = t.img.getContext('2d')!;
  for (const [x, y, seed] of out.crystals) {
    const cr = crystalCluster(seed, 1, 0);
    blitWrap(ctx, cr, x - cr.width / 2, y - cr.height + 2, b.w, h, false);
  }
  return t;
}

/** Blaues Feuer, 4 Bilder à 9×13. */
function blueFire(): Sprite[] {
  const cols = [C('#ffffff'), C('#bfe8ff'), C('#5ab8ff'), C('#2a6ae0')];
  return [0, 1, 2, 3].map((f) => {
    const b = new Buf(9, 13, false);
    const hh = 10 + (f % 2);
    for (let r = 0; r < hh; r++) {
      const q = r / hh;
      const hw = 3.6 * Math.pow(1 - q, 0.65) * (r < 2 ? 0.7 + r * 0.15 : 1);
      const sway = Math.round(Math.sin(f * 1.6 + r * 0.5) * q * 1.6);
      for (let dx = -4; dx <= 4; dx++) {
        const ad = Math.abs(dx - sway);
        if (ad > hw) continue;
        const rr = ad / Math.max(0.5, hw);
        const c = rr < 0.35 && q < 0.5 ? cols[0] : rr < 0.6 && q < 0.8 ? cols[1] : rr < 0.9 ? cols[2] : cols[3];
        b.set(4 + dx, 12 - r, c);
      }
    }
    if (f === 1 || f === 3) b.set(4 + (f === 1 ? 1 : -1), 12 - hh - 1 - (f >> 1), cols[1]);
    return b.toCanvas();
  });
}

// ---------------------------------------------------------------- Kristall-Hölle

const CRY = {
  deep: C('#120624'),
  dark: C('#2e1452'),
  mid: C('#6a32b0'),
  light: C('#b060e8'),
  bright: C('#f0a0ff'),
  white: C('#ffe0ff'),
  rim: C('#f08ae6'),
  violet: C('#c050f0'),
};

interface PrismCols {
  l: RGB;
  m: RGB;
  r: RGB;
  edge: RGB;
  out: RGB;
  vein: RGB;
}

/** Sechseckige Kristallsäule von der Seite: helle, mittlere (spiegelnde) und dunkle Fläche. */
function prism(b: Buf, cxp: number, w: number, y0: number, len: number, pc: PrismCols, tips: boolean, seed: number) {
  const T = Math.round(w * 0.9);
  for (let yy = 0; yy < len; yy++) {
    let hw = w / 2;
    if (tips && yy < T) hw *= (yy + 1) / T;
    if (tips && yy > len - T) hw *= (len - yy) / T;
    const l = Math.round(cxp - hw);
    const r = Math.round(cxp + hw);
    const vein = Math.round(cxp + w * 0.1 + Math.sin(yy * 0.05 + seed) * w * 0.08);
    for (let x = l; x <= r; x++) {
      const rel = (x - l) / Math.max(1, r - l);
      let c = rel < 0.28 ? pc.l : rel < 0.72 ? pc.m : pc.r;
      if (Math.abs(rel - 0.28) < 0.04) c = mix(pc.l, pc.edge, 0.5);
      if (x === l) c = pc.edge;
      if (x === r) c = pc.out;
      // eingeschliffener Glanzstreifen (schräg)
      if (rel > 0.05 && rel < 0.95 && mod(yy - x * 0.7 + seed * 13, 97) < 3) c = mix(c, pc.edge, 0.4);
      if (x === vein && rel > 0.3 && rel < 0.72) c = mix(c, pc.vein, 0.6);
      b.set(x, y0 + yy, c);
    }
  }
}

function crystalFar(): Tile {
  const w = 384;
  const h = 320;
  const cx = 192;
  const b = new Buf(w, h);
  const R = rng(2101);
  const pc: PrismCols = {
    l: C('#3c1a66'),
    m: C('#2a1248'),
    r: C('#1a0a2e'),
    edge: C('#6a32b0'),
    out: C('#12061e'),
    vein: C('#7a3ac0'),
  };
  const spires: [number, number, number, number][] = [
    [cx - 96, 26, 0, h],
    [cx + 92, 22, 0, h],
    [cx - 60, 14, 30, 170],
    [cx + 50, 16, 180, 200],
    [cx - 18, 9, 120, 70],
    [cx + 128, 18, 90, 160],
    [cx - 136, 16, 230, 150],
  ];
  spires.forEach(([x, sw, y0, len], i) => prism(b, x, sw, y0, len, pc, len < h, i * 3));
  for (let i = 0; i < 26; i++) b.set(R() * w, R() * h, R() < 0.3 ? CRY.white : CRY.light, 0.7);
  for (const fy of [80, 240]) for (let y = -12; y < 12; y++) for (let x = 0; x < w; x++) if (bayer(x, y) < 0.3 * (1 - Math.abs(y) / 12)) b.set(x, fy + y, C('#8a50c8'), 0.12);
  return tile(b, cx);
}

function crystalMid(): Tile {
  const w = 384;
  const h = 576;
  const cx = 192;
  const b = new Buf(w, h);
  const R = rng(2201);
  const out = tile(b, cx);
  const pc: PrismCols = {
    l: CRY.light,
    m: CRY.mid,
    r: CRY.dark,
    edge: CRY.bright,
    out: CRY.deep,
    vein: CRY.white,
  };
  const pcFar: PrismCols = {
    l: C('#7a3ac0'),
    m: C('#4a1e86'),
    r: C('#24104a'),
    edge: C('#c070f0'),
    out: CRY.deep,
    vein: C('#e0a0ff'),
  };
  const segs: {
    x: number;
    w: number;
    y0: number;
    len: number;
    tips: boolean;
    near: boolean;
  }[] = [];
  for (const s of [-1, 1]) {
    // ferne Säulen ganz durch
    segs.push({
      x: cx + s * (104 + R() * 14),
      w: 22 + Math.floor(R() * 8),
      y0: 0,
      len: h,
      tips: false,
      near: false,
    });
    // nahe, riesige Säulen in zwei Stücken mit Spitzen
    let y = Math.floor(R() * 80) + (s > 0 ? 250 : 0);
    for (let k = 0; k < 2; k++) {
      const len = 200 + Math.floor(R() * 60);
      segs.push({
        x: cx + s * (64 + R() * 8),
        w: 30 + Math.floor(R() * 8),
        y0: y,
        len,
        tips: true,
        near: true,
      });
      y += len + 20 + Math.floor(R() * 30);
    }
  }
  // schwebende Splitter hinter dem Seil
  for (let k = 0; k < 4; k++)
    segs.push({
      x: cx + (k % 2 ? 1 : -1) * (22 + R() * 16),
      w: 6 + Math.floor(R() * 3),
      y0: Math.floor(k * 144 + R() * 80),
      len: 18 + Math.floor(R() * 24),
      tips: true,
      near: false,
    });
  for (const sg of segs.filter((s) => !s.near)) prism(b, sg.x, sg.w, sg.y0, sg.len, sg.w < 12 ? pc : pcFar, sg.tips, sg.x);
  for (const sg of segs.filter((s) => s.near)) prism(b, sg.x, sg.w, sg.y0, sg.len, pc, true, sg.x);
  // Spiegelung: die mittlere Fläche zeigt (getönt, leicht versetzt) die Säule gegenüber
  const snap = new Buf(w, h);
  snap.px.set(b.px);
  for (const sg of segs.filter((s) => s.near)) {
    const T = Math.round(sg.w * 0.9);
    const l = sg.x - sg.w / 2;
    for (let yy = T; yy < sg.len - T; yy++) {
      const y = sg.y0 + yy;
      for (let x = Math.ceil(l + sg.w * 0.3); x < l + sg.w * 0.72; x++) {
        const src = snap.get(2 * cx - x, y + 23);
        if (src) b.set(x, y, mix(src, CRY.white, 0.35), 0.6);
      }
    }
    // Leuchtknoten in der Säule
    for (let n = 0; n < 2; n++) {
      const ny = Math.round(sg.y0 + T + 20 + R() * (sg.len - 2 * T - 40));
      const nx = Math.round(sg.x + sg.w * 0.05);
      b.halo(nx, ny, 9, CRY.bright, 0.45);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) b.set(nx + dx, ny + dy, Math.abs(dx) + Math.abs(dy) < 2 ? CRY.white : CRY.bright);
      out.lights.push({ x: nx, y: ny, r: 18, c: n ? '#f08ae6' : '#c050f0' });
    }
    out.glints.push({
      x: Math.round(sg.x - sg.w / 2),
      w: sg.w,
      y0: sg.y0 + T,
      y1: sg.y0 + sg.len - T,
    });
    out.sparks.push({ x: Math.round(sg.x), y: sg.y0 });
    out.sparks.push({ x: Math.round(sg.x), y: sg.y0 + sg.len - 1 });
  }
  out.img = b.toCanvas();
  const ctx = out.img.getContext('2d')!;
  // kleine Kristallgruppen an den Säulenflanken
  for (const sg of segs.filter((s) => s.near))
    for (let k = 0; k < 2; k++) {
      const cr = crystalCluster(Math.floor(sg.x) + k * 9, R() < 0.5 ? 0 : 1, 1);
      const y = sg.y0 + 40 + R() * (sg.len - 80);
      const inner = sg.x < cx ? sg.x + sg.w / 2 - 3 : sg.x - sg.w / 2 - cr.width + 3;
      blitWrap(ctx, cr, inner, y, w, h);
    }
  return out;
}

function crystalFront(side: number): Tile {
  const { b, X } = stripBuf(side);
  const R = rng(2301 + side * 17);
  const out = tile(b, 0);
  const base = [C('#0a0414'), C('#160a26'), C('#2a1248')];
  for (let k = 0; k < 6; k++) {
    const y0 = Math.round(k * 192 + R() * 90);
    const br = 9 + Math.floor(R() * 7);
    // Splitter: von der Wurzel schräg nach innen-oben/unten
    const n = 2 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const ang = (-0.15 + R() * 0.95) * (i % 2 ? -1 : 1) * 0.9 + 0.25;
      const L = 22 + R() * 30;
      const sw = 6 + Math.floor(R() * 7);
      const dxu = Math.cos(ang);
      const dy = -Math.sin(ang);
      const u0 = 2;
      for (let y = Math.floor(y0 - L - 4); y < y0 + L + 4; y++)
        for (let u = 0; u < STRIP_W; u++) {
          const t = (u - u0) * dxu + (y - y0) * dy;
          if (t < 0 || t > L) continue;
          const sx = -(u - u0) * dy + (y - y0) * dxu;
          const half = (sw / 2) * (t > L - sw ? (L - t) / sw : 1);
          if (Math.abs(sx) > half) continue;
          const rel = (sx / Math.max(0.5, half) + 1) / 2;
          let c = rel < 0.3 ? CRY.bright : rel < 0.7 ? CRY.violet : CRY.mid;
          if (rel < 0.08) c = CRY.white;
          if (rel > 0.92) c = CRY.deep;
          if (Math.abs(rel - 0.5) < 0.08 && mod(Math.round(t), 9) < 5) c = mix(c, CRY.white, 0.5);
          b.set(X(u), y, c);
        }
      out.sparks.push({
        x: X(Math.round(u0 + dxu * (L - 1))),
        y: Math.round(y0 + dy * (L - 1)),
      });
    }
    // dunkle Wurzel am Rand
    for (let y = -br; y <= br; y++) for (let u = 0; u < br * 1.1 - Math.abs(y) * 0.6; u++) b.set(X(u), y0 + y, base[u > br * 1.1 - Math.abs(y) * 0.6 - 2 ? 2 : (u + y) & 1]);
    out.lights.push({ x: X(14), y: y0 - 6, r: 18, c: '#f08ae6' });
  }
  out.img = b.toCanvas();
  return out;
}

/** Funkeln: 3 Bilder (Punkt, kleines Kreuz, großes Kreuz). */
function twinkles(): Sprite[] {
  const wc = C('#ffffff');
  const pk = C('#f0a0ff');
  return [0, 1, 2].map((f) => {
    const b = new Buf(7, 7, false);
    b.set(3, 3, wc);
    for (let i = 1; i <= f + 1 && f > 0; i++) {
      const c = i === 1 ? wc : pk;
      b.set(3 + i, 3, c);
      b.set(3 - i, 3, c);
      b.set(3, 3 + i, c);
      b.set(3, 3 - i, c);
    }
    return b.toCanvas();
  });
}

/** Wandernder Glanz auf den Kristallflächen (diagonal, halbdurchsichtig). */
function glintSprite(w: number): Sprite {
  const b = new Buf(w, w + 10, false);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.abs(y - x * 0.6 - 4);
      if (d < 1.2) b.set(x, y, C('#ffffff'), 0.55);
      else if (d < 3) b.set(x, y, C('#ffe0ff'), 0.22);
    }
  return b.toCanvas();
}

// ---------------------------------------------------------------- Abgrund

const ABY = {
  glow: C('#3af0c8'),
  glow2: C('#9afff0'),
  tip: C('#d8fff4'),
  violet: C('#a888ff'),
  stem: C('#16303a'),
};

function abyssFar(): Tile {
  const w = 384;
  const h = 256;
  const b = new Buf(w, h);
  const R = rng(3101);
  // Nebelschichten: eine Ahnung von Tiefe
  for (const [fy, fh, a] of [
    [30, 26, 0.32],
    [120, 18, 0.24],
    [200, 30, 0.3],
  ] as [number, number, number][])
    for (let y = -fh; y < fh; y++) for (let x = 0; x < w; x++) if (bayer(x, y) < a * (1 - Math.abs(y) / fh) + 0.02 * Math.sin(x * 0.05)) b.set(x, fy + y, C('#151026'), 0.6);
  const cols = [C('#5a4a90'), C('#3a7aa0'), C('#a08850'), C('#7a50b0'), C('#2a8a80')];
  for (let i = 0; i < 60; i++) b.set(R() * w, R() * h, cols[i % cols.length], 0.6 + R() * 0.4);
  // ferne Türme mit Fenstern
  for (let i = 0; i < 6; i++) {
    const x = Math.round(R() * w);
    const y = Math.round(R() * h);
    const n = 3 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) b.set(x + (k % 2), y + k * 3, C('#c0a060'), 0.7);
  }
  // ein paar hellere ferne Lichter
  for (let i = 0; i < 8; i++) {
    const x = R() * w;
    const y = R() * h;
    const c = i % 2 ? ABY.glow : ABY.violet;
    b.halo(x, y, 5, c, 0.4);
    b.set(x, y, mix(c, C('#ffffff'), 0.5));
  }
  return tile(b, 192);
}

function abyssFar2(): Tile {
  const w = 384;
  const h = 384;
  const cx = 192;
  const b = new Buf(w, h);
  const R = rng(3201);
  const body = C('#120e22');
  const rim = C('#3a3060');
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const x0 = cx + side * (34 + R() * 120);
    const y0 = (i * h) / 7 + R() * 30;
    const rw = 8 + R() * 18;
    const depth = rw * (1 + R() * 0.8);
    // schwebender Fels: flache Oberseite, spitze Unterseite
    // Unterseite zackig wie Tropfsteine
    for (let dx = -Math.round(rw); dx <= Math.round(rw); dx++) {
      const q = 1 - Math.pow(Math.abs(dx) / rw, 1.4);
      const bot = Math.max(1, Math.round(depth * q * (0.55 + 0.6 * hash(Math.floor((dx + 40) / 2), i + 7))));
      for (let yy = 0; yy < bot; yy++) b.set(x0 + dx, y0 + yy, yy < 1 || dx === -Math.round(rw) ? rim : body);
    }
    // Ruinen-Silhouetten darauf
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const tx = Math.round(x0 - rw * 0.6 + R() * rw * 1.2);
      const th = 4 + Math.floor(R() * 12);
      const tw = 2 + Math.floor(R() * 3);
      b.rect(tx, y0 - th, tw, th, body);
      b.set(tx, y0 - th, rim);
      if (R() < 0.7) b.set(tx + Math.floor(tw / 2), y0 - th + 2 + Math.floor(R() * (th - 3)), C('#c0a060'));
    }
    if (R() < 0.6) {
      b.halo(x0, y0 + depth * 0.4, 4, ABY.glow, 0.3);
      b.set(x0, y0 + depth * 0.4, ABY.glow2);
    }
  }
  return tile(b, cx);
}

function abyssFront(side: number): Tile {
  const { b, px, X } = stripBuf(side);
  const h = b.h;
  const R = rng(3301 + side * 17);
  const out = tile(b, 0);
  const rock = [C('#020104'), C('#07050c'), C('#151024')];
  for (let y = 0; y < h; y++) {
    const e = 5 + 4 * (pnoise(y, h / 5, side * 3) + 1);
    for (let u = 0; u < e; u++) px(u, y, u > e - 1 ? rock[2] : rock[0]);
  }
  for (let k = 0; k < 7; k++) {
    const y0 = Math.round((k * h) / 7 + R() * 60);
    const D = 16 + Math.floor(R() * 26);
    const Ht = 10 + Math.floor(R() * 18);
    for (let yy = -Ht; yy < Ht; yy++) {
      const ext = D * Math.pow(1 - Math.abs(yy) / Ht, 0.6) + 4;
      for (let u = 0; u < ext; u++) px(u, y0 + yy, u > ext - 1.5 ? rock[2] : rock[(u >> 2) & 1]);
    }
    // Leuchtpilze oben
    const nf = 2 + Math.floor(R() * 3);
    for (let i = 0; i < nf; i++) {
      const u = Math.round(4 + R() * (D - 4));
      const top = Math.round(y0 - Ht * (1 - Math.pow(Math.max(0, (u - 4) / D), 1 / 0.6))) + 1;
      const sh = 2 + Math.floor(R() * 4);
      for (let s = 0; s < sh; s++) px(u, top - s, ABY.stem);
      const cw = 1 + Math.floor(R() * 2);
      const cap = i % 3 === 2 ? ABY.violet : ABY.glow;
      for (let dx = -cw - 1; dx <= cw + 1; dx++) px(u + dx, top - sh, Math.abs(dx) > cw ? mix(cap, C('#000000'), 0.4) : cap);
      for (let dx = -cw; dx <= cw; dx++) px(u + dx, top - sh - 1, dx === 0 ? ABY.tip : ABY.glow2);
      if (cw > 1) px(u, top - sh - 2, ABY.glow2);
      b.halo(X(u), top - sh, 7, cap, 0.3);
    }
    // Ranken mit Leuchtspitzen unten
    for (let i = 0; i < 3; i++) {
      if (R() < 0.3) continue;
      const u = Math.round(3 + R() * D * 0.7);
      const L = 8 + Math.floor(R() * 34);
      const y = y0 + Math.round(Ht * 0.5);
      for (let s = 0; s < L; s++) px(u + Math.round(Math.sin(s * 0.3 + i) * 0.8), y + s, s % 5 === 4 ? ABY.glow : ABY.stem);
      px(u, y + L, ABY.tip);
      b.halo(X(u), y + L, 5, ABY.glow, 0.3);
      if (i === 0) out.lights.push({ x: X(u), y: y + L, r: 14, c: '#3af0c8' });
    }
  }
  out.img = b.toCanvas();
  return out;
}

/** Schwebende Ruine aus Himmels-Inseln und Säulenstücken, umgefärbt, mit Leuchtmoos und Wurzeln. */
function ruin(img: Images, v: number): Ruin {
  const stone = rampMap(['#07050f', '#16122a', '#2a2446', '#463c6a', '#6c6098']);
  const colR = rampMap(['#0a0816', '#1e1a34', '#363052', '#56507a', '#8a80b0']);
  const islands = ['heaven/island-big', 'heaven/island-small', 'heaven/rock-b', 'heaven/rock-a', 'heaven/island-small', 'heaven/rock-b'];
  const isl = recolor(img[islands[v % islands.length]], stone);
  // Säulenstücke (x, y, w, h) aus heaven/columns
  const pieces: [number, number, number, number][] = [
    [0, 51, 10, 42],
    [31, 42, 12, 52],
    [61, 16, 16, 79],
    [47, 75, 12, 19],
    [78, 73, 14, 22],
  ];
  const cols = recolor(img['heaven/columns'], colR);
  const R = rng(4100 + v * 13);
  const pad = 6;
  const capH = 80;
  const W = isl.width + pad * 2;
  const H = isl.height + capH + 44;
  const [, ctx] = canvas(W, H);
  const iy = capH;
  // Säulen auf der Insel (die hohen nur auf großen Inseln)
  const n = v === 6 ? 0 : isl.width > 60 ? 3 : isl.width > 40 ? 2 : 1;
  if (v === 6) {
    // Tempelrest: Gebälk mit zwei Säulen, rechts oben abgebrochen
    const tmp = recolor(img['heaven/temple'], colR);
    ctx.drawImage(tmp, 12, 84, 76, 84, pad + 11, iy + 5 - 84, 76, 84);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(pad + 50, iy - 80);
    ctx.lineTo(pad + 60, iy - 72);
    ctx.lineTo(pad + 66, iy - 75);
    ctx.lineTo(pad + 74, iy - 60);
    ctx.lineTo(pad + 90, iy - 30);
    ctx.lineTo(pad + 90, iy - 80);
    ctx.fill();
    ctx.fillRect(pad + 58, iy - 58, 30, 30);
    ctx.globalCompositeOperation = 'source-over';
  }
  for (let k = 0; k < n; k++) {
    const p = pieces[Math.floor(R() * (isl.width > 60 ? 5 : 2)) + (isl.width > 60 ? 0 : 3)];
    const x = pad + Math.round(((k + 0.5) / n) * isl.width - p[2] / 2 + (R() - 0.5) * 6);
    ctx.drawImage(cols, p[0], p[1], p[2], p[3], x, iy + 5 - p[3], p[2], p[3]);
  }
  ctx.drawImage(isl, pad, iy);
  // Moos und Wurzeln (einmalig, Pixel lesen ist hier erlaubt)
  const data = ctx.getImageData(0, 0, W, H);
  const b = new Buf(W, H, false);
  b.px.set(new Uint32Array(data.data.buffer));
  const lights: Pt[] = [];
  let best = -1;
  for (let x = 0; x < W; x++) {
    let top = -1;
    let bot = -1;
    for (let y = 0; y < H; y++) if (b.get(x, y)) (top < 0 && (top = y), (bot = y));
    if (top < 0) continue;
    if (R() < 0.3) {
      b.set(x, top, R() < 0.4 ? ABY.glow2 : ABY.glow);
      if (R() < 0.3) b.set(x, top - 1, ABY.glow);
    }
    if (bot > iy + 6 && R() < 0.1) {
      const L = 6 + Math.floor(R() * 26);
      for (let s = 1; s < L && bot + s < H - 1; s++) b.set(x + Math.round(Math.sin(s * 0.35 + x) * 0.7), bot + s, s % 4 === 3 ? ABY.glow : ABY.stem);
      const ty = Math.min(H - 2, bot + L);
      b.set(x, ty, ABY.tip);
      b.halo(x, ty, 4, ABY.glow, 0.3);
      if (L > best) {
        best = L;
        lights[0] = { x, y: ty, r: 14, c: '#3af0c8' };
      }
    }
  }
  // ein Leuchtfleck oben (Moospolster)
  const mx = Math.round(pad + isl.width * (0.3 + R() * 0.4));
  let my = 0;
  while (my < H - 1 && !b.get(mx, my)) my++;
  b.halo(mx, my - 2, 7, v % 2 ? ABY.violet : ABY.glow, 0.35);
  for (let dx = -2; dx <= 2; dx++) b.set(mx + dx, my - (Math.abs(dx) < 2 ? 1 : 0), v % 2 ? C('#d0c0ff') : ABY.glow2);
  lights.push({ x: mx, y: my - 2, r: 14, c: v % 2 ? '#a888ff' : '#3af0c8' });
  return { spr: b.toCanvas(), lights: lights.filter(Boolean) };
}

/** Leuchtqualle: 2 Bilder (zusammengezogen/ausgedehnt), 9×12. */
function jelly(c1: string, c2: string): Sprite[] {
  const a = C(c1);
  const z = C(c2);
  return [0, 1].map((f) => {
    const b = new Buf(9, 12, false);
    const bw = f ? 4 : 3;
    for (let y = 0; y < 4; y++) {
      const hw = Math.round(bw * Math.sqrt(1 - Math.pow((3 - y) / 4, 2)));
      for (let dx = -hw; dx <= hw; dx++) b.set(4 + dx, y + 1, y === 0 || Math.abs(dx) === hw ? z : dx === -1 && y === 1 ? C('#ffffff') : a);
    }
    for (let t = -1; t <= 1; t++)
      for (let s = 0; s < 6 - Math.abs(t) + f; s++) if ((s + t) % 2 === 0 || s < 2) b.set(4 + t * (f ? 2 : 1) + (s > 3 ? t : 0), 5 + s, z, s > 3 ? 0.6 : 1);
    return b.toCanvas();
  });
}

const RUIN_P = 960;
const RUIN_F = 0.5;
const JELLY_F = 0.78;
const JELLY_P = 720;

// ---------------------------------------------------------------- Renderer

export class DeepRenderer {
  private img: Images;
  private art = new Map<DeepLevel, LevelArt>();
  private jobs = new Map<DeepLevel, { art: LevelArt; steps: (() => void)[] }>();
  private flame: Sprite[] = [];
  private tw: Sprite[] = [];
  private glints = new Map<number, Sprite>();
  private ruins: Ruin[] = [];
  private ruinPlace: RuinPlace[] = [];
  private jellies: Sprite[][] = [];
  private veils = new Map<number, Sprite>();

  constructor(img: Images) {
    this.img = img;
  }

  /**
   * Bilder einer Tiefe in kleinen Schritten rechnen (je Schritt ein Ebenenbild, ~10–30 ms).
   * Vorab (warm) läuft pro Bild höchstens ein Schritt, damit es beim Abstieg nicht ruckelt;
   * wird eine Tiefe sofort gebraucht (Sprung), laufen die restlichen Schritte auf einmal.
   */
  private job(l: DeepLevel) {
    let j = this.jobs.get(l);
    if (j) return j;
    const art: LevelArt = {
      back: [],
      front: undefined as unknown as [Strip, number],
    };
    let left: Tile;
    let steps: (() => void)[];
    if (l === 'icehell')
      steps = [
        () => (this.flame = blueFire()),
        () => art.back.push([iceFar(), 0.22]),
        () => art.back.push([iceMid(), 0.5]),
        () => (left = iceFront(-1)),
        () => (art.front = [{ l: left, r: iceFront(1) }, 1.2]),
      ];
    else if (l === 'crystalhell')
      steps = [
        () => (this.tw = twinkles()),
        () => art.back.push([crystalFar(), 0.22]),
        () => art.back.push([crystalMid(), 0.5]),
        () => (left = crystalFront(-1)),
        () => (art.front = [{ l: left, r: crystalFront(1) }, 1.2]),
      ];
    else
      steps = [
        () => {
          this.ruins = [0, 1, 2, 3, 4, 5, 6].map((v) => ruin(this.img, v));
          const R = rng(4001);
          const order = [6, 1, 2, 0, 3, 4, 5, 1, 3];
          this.ruinPlace = order.map((v, k) => {
            const big = this.ruins[v].spr.width > 80;
            return {
              v,
              x: (k % 2 ? 1 : -1) * ((big ? 90 : 62) + R() * 20),
              y: Math.round((k * RUIN_P) / order.length + R() * 30),
            };
          });
          this.jellies = [jelly('#7af0d8', '#2aa898'), jelly('#c8b8ff', '#7a5ad0')];
        },
        () => art.back.push([abyssFar(), 0.1]),
        () => art.back.push([abyssFar2(), 0.28]),
        () => (left = abyssFront(-1)),
        () => (art.front = [{ l: left, r: abyssFront(1) }, 1.25]),
      ];
    this.jobs.set(l, (j = { art, steps }));
    return j;
  }

  /** Einen Schritt vorrechnen (für die nächste Tiefe). */
  private warm(l: DeepLevel) {
    if (this.art.has(l)) return;
    const j = this.job(l);
    j.steps.shift()?.();
    if (!j.steps.length) this.art.set(l, j.art);
  }

  private get(l: DeepLevel): LevelArt {
    let a = this.art.get(l);
    if (a) return a;
    const j = this.job(l);
    while (j.steps.length) j.steps.shift()!();
    this.art.set(l, (a = j.art));
    return a;
  }

  /**
   * Bildschirm an den Ebenengrenzen (Tor, dann alle 2.000 m) in Abschnitte je Tiefe teilen.
   * Die Grenze selbst wird nicht überblendet (das bräuchte Zwischenbilder), sondern liegt
   * hart unter einem Dunstschleier in der Hintergrundfarbe – siehe veil().
   */
  private layout(d: HellFrame, clipTop: number) {
    const { H, oy } = d;
    const secs: { l: DeepLevel; y0: number; y1: number }[] = [];
    const seams: number[] = [];
    const mTop = (clipTop - oy) / PPM;
    let e = GATE_M + Math.max(0, Math.ceil((mTop - GATE_M) / LEVEL_SPAN)) * LEVEL_SPAN;
    let y = clipTop;
    while (y < H) {
      const ey = Math.round(e * PPM + oy);
      const y1 = Math.min(H, Math.max(ey, y + 1));
      const l = levelAt((y - oy) / PPM + 1);
      if (l !== 'hell') secs.push({ l, y0: y, y1 });
      y = y1;
      if (y >= ey) e += LEVEL_SPAN;
    }
    // Schleier auch für Grenzen knapp über/unter dem Bild
    for (let m = GATE_M + Math.max(0, Math.floor(((clipTop - BAND / 2 - oy) / PPM - GATE_M) / LEVEL_SPAN)) * LEVEL_SPAN; m * PPM + oy - BAND / 2 < H; m += LEVEL_SPAN)
      if (m * PPM + oy + BAND / 2 > clipTop) seams.push(m);
    return { secs, seams };
  }

  /**
   * Dunstschleier über einer Ebenengrenze: 1 × 200 px, Zeile für Zeile genau die
   * Hintergrundfarbe aus hell.ts (gleiche Formel), Deckkraft zur Grenze hin bis 1.
   */
  private veil(e: number): Sprite {
    let v = this.veils.get(e);
    if (v) return v;
    if (this.veils.size > 8) this.veils.clear();
    const [c, x] = canvas(1, BAND);
    const top = e * PPM - BAND / 2;
    for (let y = 0; y < BAND; y++) {
      const m = (top + y) / PPM;
      const lb = levelBlend(m);
      const t = (Math.sin(m * 0.0018) + 1) / 2;
      const bg = (l: Level) => mix(C(bgOf(l)[0]), C(bgOf(l)[1]), t);
      const col = mix(bg(lb.a), bg(lb.b), lb.t);
      const a = Math.pow(Math.max(0, 1 - Math.abs(y + 0.5 - BAND / 2) / (BAND / 2)), 1.4);
      x.fillStyle = `rgba(${col.map(Math.round).join(',')},${a.toFixed(3)})`;
      x.fillRect(0, y, 1, 1);
    }
    this.veils.set(e, (v = c));
    return v;
  }

  back(d: HellFrame, clipTop: number) {
    if ((d.H - d.oy) / PPM < GATE_M - 220) return;
    // nächste Tiefe schon vorher rechnen, damit beim Übergang nichts ruckelt
    const below = levelAt((d.H - d.oy) / PPM + 600);
    if (below !== 'hell') this.warm(below);
    const { secs, seams } = this.layout(d, clipTop);
    for (const { l, y0, y1 } of secs) {
      for (const [t, f] of this.get(l).back) this.drawTile(d, d.ctx, l, y0, y1, 0, ALL_LIT, t, f, 0);
      if (l === 'abyss') this.drawRuins(d, d.ctx, y0, y1, 0, ALL_LIT);
    }
    for (const e of seams) d.ctx.drawImage(this.veil(e), 0, 0, 1, BAND, 0, Math.round(e * PPM + d.oy - BAND / 2), d.W, BAND);
  }

  front(d: HellFrame, clipTop: number) {
    if ((d.H - d.oy) / PPM < GATE_M - 220) return;
    const { secs, seams } = this.layout(d, clipTop);
    for (const { l, y0, y1 } of secs) {
      const [st, f] = this.get(l).front;
      this.drawTile(d, d.ctx, l, y0, y1, 0, ALL_LIT, st.l, f, 0);
      this.drawTile(d, d.ctx, l, y0, y1, 0, ALL_LIT, st.r, f, d.W - st.r.w);
      if (l === 'abyss') this.drawJellies(d, d.ctx, y0, y1, 0, ALL_LIT);
    }
    // Schleier nur über den Randstreifen (die Mitte gehört hell.ts und der Figur)
    for (const e of seams) {
      const y = Math.round(e * PPM + d.oy - BAND / 2);
      d.ctx.drawImage(this.veil(e), 0, 0, 1, BAND, 0, y, STRIP_W, BAND);
      d.ctx.drawImage(this.veil(e), 0, 0, 1, BAND, d.W - STRIP_W, y, STRIP_W, BAND);
    }
    this.particles(d, clipTop);
  }

  /**
   * Kachel einer Parallax-Ebene für den Bildschirmbereich y0–y1 auf c zeichnen (um dy nach oben
   * versetzt), samt Lichtern und bewegten Teilen. fixedX: Randstreifen (fester Bildschirm-x),
   * sonst um die Seilmitte zentriert.
   */
  private drawTile(d: HellFrame, c: CanvasRenderingContext2D, lvl: DeepLevel, y0: number, y1: number, dy: number, lit: (y: number) => boolean, t: Tile, f: number, fixedX: number) {
    const { W } = d;
    const strip = t.cx === 0;
    const off = Math.round(d.anchorY - d.camY * f);
    let x0 = strip ? fixedX : mod(Math.round(W / 2 - d.camX * f) - t.cx, t.w) - t.w;
    if (!strip && x0 + t.w <= 0) x0 += t.w;
    for (let y = y0; y < y1;) {
      const r = mod(y - off, t.h);
      const h = Math.min(y1 - y, t.h - r);
      for (let x = x0; x < W; x += t.w) {
        const sx = Math.max(0, -x);
        const sw = Math.min(t.w - sx, W - x - sx);
        if (sw > 0) c.drawImage(t.img, sx, r, sw, h, x + sx, y - dy, sw, h);
        if (strip) break;
      }
      y += h;
    }
    // Punkte einer Kachel, die in diesem Bereich liegen (Bildschirmkoordinaten)
    const each = (pts: Pt[], fn: (x: number, y: number, p: Pt) => void) => {
      for (const p of pts) {
        for (let sy = off + p.y + t.h * Math.ceil((y0 - off - p.y) / t.h); sy < y1; sy += t.h) {
          let sx = x0 + p.x;
          if (!strip && sx < -30) sx += t.w;
          if (sx < -30 || sx > W + 30) continue;
          fn(sx, sy, p);
        }
      }
    };
    each(t.lights, (x, y, p) => lit(y) && d.lights.push([x, y, p.r ?? 14, p.c]));
    const time = d.calm ? 0 : d.time;
    if (t.flames.length) each(t.flames, (x, y, p) => c.drawImage(this.flame[Math.floor(time * 9 + p.x * 0.37) & 3], x - 4, y - 13 - dy));
    if (t.glints.length) {
      c.fillStyle = '#ffffff';
      for (const g of t.glints) {
        const len = g.y1 - g.y0;
        if (lvl === 'icehell') {
          // Lichtfunke rinnt den erstarrten Fall hinab
          const gy = g.y0 + Math.floor(mod(time * 18 + g.x * 7, len + 60));
          if (gy < g.y1) each([{ x: g.x, y: gy }], (x, y) => c.fillRect(x, y - dy, 1, 3));
        } else {
          // Glanz wandert über die Kristallfläche
          const spr = this.glint(g.w);
          const gy = g.y0 + Math.floor(mod(time * 14 + g.x * 5, len + 160));
          if (gy + spr.height <= g.y1) each([{ x: g.x, y: gy }], (x, y) => c.drawImage(spr, x, y - dy));
        }
      }
    }
    if (t.sparks.length && this.tw.length)
      each(t.sparks, (x, y, p) => {
        const ph = mod(time * 1.3 + hash(p.x, p.y) * 4, 4);
        if (ph >= 1.5) return;
        c.drawImage(this.tw[ph < 0.5 ? 0 : ph < 1 ? 2 : 1], x - 3, y - 3 - dy);
      });
  }

  private glint(w: number): Sprite {
    let g = this.glints.get(w);
    if (!g) this.glints.set(w, (g = glintSprite(w)));
    return g;
  }

  /** Schwebende Ruinen im Abgrund (einzeln, damit sie sanft wippen). */
  private drawRuins(d: HellFrame, c: CanvasRenderingContext2D, y0: number, y1: number, dy: number, lit: (y: number) => boolean) {
    const { W } = d;
    const off = Math.round(d.anchorY - d.camY * RUIN_F);
    const time = d.calm ? 0 : d.time;
    this.ruinPlace.forEach((p, i) => {
      const r = this.ruins[p.v];
      // Ankerpunkt = Oberkante der Insel (Bild hat oben 80 px Platz für Säulen)
      for (let sy = off + p.y + RUIN_P * Math.ceil((y0 - off - p.y) / RUIN_P); sy < y1; sy += RUIN_P) {
        const bob = Math.round(Math.sin(time * 0.6 + i * 1.7) * 2);
        const x = Math.round(W / 2 + p.x - d.camX * RUIN_F - r.spr.width / 2 + Math.sin(time * 0.35 + i) * 1.5);
        const y = sy - 80 + bob;
        if (x > W || x + r.spr.width < 0) continue;
        c.drawImage(r.spr, x, y - dy);
        for (const l of r.lights) if (lit(y + l.y)) d.lights.push([x + l.x, y + l.y, l.r ?? 14, l.c]);
      }
    });
  }

  /** Leuchtquallen steigen langsam auf und pulsieren. */
  private drawJellies(d: HellFrame, c: CanvasRenderingContext2D, y0: number, y1: number, dy: number, lit: (y: number) => boolean) {
    const { W } = d;
    const time = d.calm ? 0 : d.time;
    const off = Math.round(d.anchorY - d.camY * JELLY_F);
    for (let i = 0; i < 6; i++) {
      const base = mod(Math.round(i * (JELLY_P / 6) + hash(i, 501) * 60 - time * 5), JELLY_P);
      for (let sy = off + base + JELLY_P * Math.ceil((y0 - off - base) / JELLY_P); sy < y1; sy += JELLY_P) {
        const side = i % 2 ? 1 : -1;
        const x = Math.round(W / 2 + side * (18 + hash(i, 502) * 70) + Math.sin(time * 0.5 + i * 2) * 6);
        if (x < -10 || x > W + 10) continue;
        const kind = i % 3 === 0 ? 1 : 0;
        const fr = Math.floor(time * 1.6 + i * 0.7) % 2;
        c.drawImage(this.jellies[kind][fr], x - 4, sy - 6 - dy);
        if (lit(sy)) d.lights.push([x, sy - 3, 12, kind ? '#a888ff' : '#3af0c8']);
      }
    }
  }

  /** Schneeglitzern (Eis), Glitzerstaub (Kristall), Sporen (Abgrund) – je ein Pixel. */
  private particles(d: HellFrame, clipTop: number) {
    const { ctx, W, H, oy } = d;
    const time = d.calm ? 0 : d.time;
    const span = H + 80;
    const off = d.anchorY - d.camY * 0.9;
    for (let i = 0; i < 40; i++) {
      const fall = hash(i, 601);
      const yy = mod(hash(i, 602) * span + off, span) - 40;
      const lvl0 = levelAt((yy - oy) / PPM);
      if (lvl0 === 'hell') continue;
      let x: number;
      let y: number;
      let c: string;
      if (lvl0 === 'icehell') {
        y = Math.round(mod(yy + time * (6 + fall * 10), span) - 40);
        x = Math.round(mod(hash(i, 603) * W + Math.sin(time * 0.7 + i) * 4, W));
        c = i % 4 ? '#bfe8ff' : '#ffffff';
      } else if (lvl0 === 'crystalhell') {
        y = Math.round(mod(yy + time * (3 + fall * 4), span) - 40);
        x = Math.round(mod(hash(i, 603) * W + Math.sin(time * 0.9 + i) * 6, W));
        if (Math.floor(time * 3 + i) % 3 === 0) continue;
        c = i % 3 ? '#f0a0ff' : '#ffe0ff';
      } else {
        y = Math.round(mod(yy - time * (3 + fall * 6), span) - 40);
        x = Math.round(mod(hash(i, 603) * W + Math.sin(time * 0.5 + i * 3) * 5, W));
        c = i % 3 ? '#3af0c8' : '#a888ff';
      }
      if (y < clipTop || y >= H) continue;
      // nur in der eigenen Tiefe (am Bildschirmort neu prüfen)
      if (levelAt((y - oy) / PPM) !== lvl0) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
