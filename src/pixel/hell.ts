/**
 * Die Hölle: Unter der Lava öffnet sich der Schacht in eine riesige Höhle.
 * Verspielt statt gruselig – Basalt- und Obsidiansäulen, Feuerseen auf Simsen,
 * glühende Runen, Ketten mit Käfigen und Laternen, Schwefeldampf, Lavafälle,
 * Runentore, kleine Teufelchen, die laufen, fliegen und winken, Flammengeister.
 * Bei 7.000 m steht das Höllentor; darunter geht es endlos weiter
 * (Eis-Hölle, Kristall-Hölle, Abgrund – gleiche Bauteile, andere Farben).
 *
 * Koordinaten wie in world.ts: x = 0 ist das Seil, y = Meter × PPM.
 * Hintergrund-Ebenen mit Parallaxe f < 1 (ferne Säulen ziehen langsamer vorbei),
 * Vordergrund-Felsen mit f > 1.
 *
 * Leistung (Pixel 9): Alles Statische wird einmal in Bilder vorgerechnet und pro
 * Bild nur noch geblittet – Ziel sind wenige hundert Canvas-Aufrufe pro Bild.
 */
import type { Images } from './assets';
import { canvas, flipX, lerpColor, rampMap, recolor, type Sprite } from './sprites';
import { DEEP_PAL, DEEP_SHARED, DeepRenderer } from './deep';
import { hash, HELL_BG, HW, levelAt, levelBlend, LEVELS, mod, PPM, type Darkness, type HellFrame, type Level, type Palette, type SharedParts } from './hellShared';
import { GATE_M, HELL_M } from './zones';

export type { Light } from './hellShared';

const PAL: Record<Level, Palette> = {
  ...DEEP_PAL,
  hell: {
    bg: HELL_BG,
    far: ['#1e0818', '#3e1430'],
    col: ['#140610', '#2e1028', '#5a2246', '#ff6a3c'],
    lake: ['#5a0c08', '#a8240e', '#e2541e', '#ff9a3c', '#ffe28a'],
    rune: '#ff5a8a',
    flame: ['#fff1b0', '#ffb347', '#ff5a2b'],
    imp: ['#1a0606', '#5a0c0c', '#c21e1e', '#ff6a4a', '#ffe08a'],
    steam: ['#3a4a10', '#7a8a20', '#b8c84a', '#e8f08a', '#f8ffd0'],
  },
};

/** Dunkelheit über der Hölle (bis zum Tor) – heller als früher, die Feuerseen sollen tragen. */
export const HELL_DARK: Darkness = [0.26, [46, 8, 30]];

type RGB = [number, number, number];
type Part = keyof SharedParts;

/** Anteil „Hölle“ an einer Tiefe: 1 bis 6.800 m, über die Torgrenze (±200 m) auf 0. */
function hellW(m: number): number {
  const lb = levelBlend(m);
  if (lb.a !== 'hell') return 0;
  return lb.b === 'hell' ? 1 : 1 - lb.t;
}

const partW = (l: Level, p: Part) => (l === 'hell' ? 1 : DEEP_SHARED[l][p]);
/** Dichte eines gemeinsamen Bauteils an einer Tiefe (deep.ts legt die Werte je Ebene fest). */
function sharedW(m: number, p: Part): number {
  const lb = levelBlend(m);
  return partW(lb.a, p) * (1 - lb.t) + partW(lb.b, p) * lb.t;
}

/** Glattes, in x periodisches Rauschen (Periode muss den Umfang teilen). */
function noise(x: number, period: number, seed: number, wrap: number): number {
  const n = Math.max(1, Math.round(wrap / period));
  const f = x / period;
  const i = Math.floor(f);
  const t = f - i;
  const s = t * t * (3 - 2 * t);
  return hash(mod(i, n), seed) * (1 - s) + hash(mod(i + 1, n), seed) * s;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tri = (u: number) => 1 - Math.abs(2 * (u - Math.floor(u)) - 1);

/** Pixelpuffer zum Vorrechnen (nur beim Aufbau, nie pro Bild). */
class Buf {
  readonly d: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly wrapX = false,
    readonly wrapY = false,
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  px(x: number, y: number, c: RGB, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.wrapX) x = mod(x, this.w);
    else if (x < 0 || x >= this.w) return;
    if (this.wrapY) y = mod(y, this.h);
    else if (y < 0 || y >= this.h) return;
    if (a <= 0) return;
    a = Math.min(1, a);
    const d = this.d;
    const i = (y * this.w + x) * 4;
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * a + d[i + k] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c, a);
  }
  sprite(): Sprite {
    const [c, x] = canvas(this.w, this.h);
    const img = x.createImageData(this.w, this.h);
    img.data.set(this.d);
    x.putImageData(img, 0, 0);
    return c;
  }
}

/** Ferne Höhlenwand (nur Hölle): Parallaxe und Startzeile. */
const FB = 0.2;
const LY0 = HELL_M * PPM - 100;
/** Vordergrund-Felsen */
const FF = 1.35;
const FGW = 44;
const FGH = 512;
/** Kettenstreifen (Kettenglied 6×27 gestapelt) */
const CHAIN_LEN = 27 * 14;

/** Runentore: Tiefe in Metern und Seite. */
const RUNE_GATES: [number, -1 | 1][] = [
  [3750, -1],
  [4550, 1],
  [5350, -1],
  [6150, 1],
];

export class HellRenderer {
  private lava = new Map<Level, Sprite>();
  private imp = new Map<Level, [Sprite, Sprite]>();
  private steam = new Map<Level, Sprite>();
  private torch = new Map<Level, Sprite>();
  private runes = new Map<Level, Sprite>();
  private spiritS = new Map<Level, Sprite[]>();
  private cache = new Map<string, Sprite>();
  private bgStrips = new Map<number, Sprite>();
  private lavafall: Sprite;
  private chain: Sprite;
  private chainStrip: Sprite;
  private deep: DeepRenderer;
  // vorgerechnete Hölle-Bilder
  private back: Sprite;
  private backFalls: [number, number, number][] = [];
  private drip: Sprite;
  private fallTex: Sprite;
  private fg: [Sprite, Sprite];
  private swaths: Sprite[];
  private flyImp: Sprite[];
  private cage: Sprite[];
  private lantern: Sprite[];
  private runeGate: Sprite;
  private portal: Sprite;
  private ceil: { img: Sprite; drops: [number, number][]; glows: number[]; falls: Sprite[] } | null = null;
  private gateImg: Sprite | null = null;
  /** Bildschirm-Zeilen der Hölle mit Deckkraft (pro Bild neu) */
  private rows: [number, number, number][] = [];

  constructor(img: Images) {
    this.deep = new DeepRenderer(img);
    this.lavafall = img['hell/lavafall'] as unknown as Sprite;
    this.chain = img['hell/chain'] as unknown as Sprite;
    for (const l of LEVELS) {
      const p = PAL[l];
      this.lava.set(l, l === 'hell' ? (img['hell/lavatile'] as unknown as Sprite) : recolor(img['hell/lavatile'], rampMap(p.lake)));
      const imp = l === 'hell' ? (img['hell/imp'] as unknown as Sprite) : recolor(img['hell/imp'], rampMap(p.imp));
      this.imp.set(l, [imp, flipX(imp)]);
      this.steam.set(l, recolor(img['hell/smoke-fire'], rampMap(p.steam)));
      this.torch.set(l, l === 'hell' ? (img['hell/torch'] as unknown as Sprite) : recolor(img['hell/torch'], rampMap([p.col[0], p.col[1], p.flame[2], p.flame[1], p.flame[0]])));
      const [rr, rg, rb] = hexRgb(p.rune);
      // Runen: weiße Glyphen in Runenfarbe, dunkle Umrandung bleibt
      this.runes.set(
        l,
        recolor(img['hell/glyphs'], (r, g, b) => {
          const lum = (r + g + b) / 765;
          return lum > 0.5 ? [Math.min(255, rr + 60 * lum), Math.min(255, rg + 40 * lum), Math.min(255, rb + 40 * lum)] : [r * 0.4, g * 0.3, b * 0.4];
        }),
      );
      this.spiritS.set(l, [0, 1].map((f) => this.spiritSprite(p, f)));
    }
    const [cs, cx] = canvas(6, CHAIN_LEN);
    for (let y = 0; y < CHAIN_LEN; y += 27) cx.drawImage(this.chain, 0, y);
    this.chainStrip = cs;
    this.back = this.bakeBackdrop();
    this.drip = this.bakeDrip();
    this.fallTex = this.bakeFallTex();
    this.fg = [this.bakeForeground(701, false), this.bakeForeground(733, true)];
    this.swaths = [0, 1, 2].map((v) => this.bakeSwath(v));
    const imp = this.imp.get('hell')![0];
    this.flyImp = [0, 1].flatMap((f) => {
      const s = this.bakeFlyImp(imp, f);
      return [s, flipX(s)];
    });
    this.cage = [this.bakeCage(null), this.bakeCage(imp, 0), this.bakeCage(imp, 1)];
    this.lantern = [0, 1].map((f) => this.bakeLantern(f));
    [this.runeGate, this.portal] = this.bakeRuneGate();
  }

  // ------------------------------------------------------------------ Vorrechnen

  /** Ferne Höhlenwand: Felsterrassen mit Feuerseen, Zacken mit Glut von unten, dünne Lavafälle. */
  private bakeBackdrop(): Sprite {
    const BW = 256;
    const BH = Math.ceil((GATE_M * PPM + 2600 - LY0) * FB);
    const b = new Buf(BW, BH, true);
    const p = PAL.hell;
    const rockD = hexRgb('#14060f');
    const rockL = hexRgb('#6e2028');
    const rim = hexRgb('#e2541e');
    const halo = hexRgb(p.lake[1]);
    const lk = p.lake.map(hexRgb);
    const terr: number[] = [];
    for (let ty = 30, k = 0; ty < BH + 40; k++) {
      terr.push(ty);
      ty += 74 + Math.floor(hash(k, 501) * 46);
    }
    terr.forEach((T, k) => {
      const height = (x: number) => {
        const n = noise(x, 32, 520 + k, BW) * 0.6 + noise(x, 8, 530 + k, BW) * 0.4;
        return Math.max(0, Math.round((n - 0.34) * 100));
      };
      const hs: number[] = [];
      const pool: boolean[] = [];
      for (let x = 0; x < BW; x++) {
        pool[x] = noise(x, 32, 510 + k, BW) < 0.4;
        hs[x] = pool[x] ? 0 : height(x);
      }
      // Abstand zum nächsten Feuersee (ringförmig)
      const dist: number[] = new Array(BW).fill(99);
      for (let x = 0; x < BW; x++) if (pool[x]) for (let dx = -30; dx <= 30; dx++) dist[mod(x + dx, BW)] = Math.min(dist[mod(x + dx, BW)], Math.abs(dx));
      // Schein über den Seen
      for (let x = 0; x < BW; x++) {
        if (dist[x] > 20) continue;
        const w = 1 - dist[x] / 20;
        for (let dy = 1; dy < 40; dy++) b.px(x, T - dy, halo, 0.5 * Math.pow(1 - dy / 40, 1.6) * w);
      }
      for (let x = 0; x < BW; x++) {
        const L0 = clamp01(1 - dist[x] / 30);
        const top = T - hs[x];
        for (let y = top; y < T + 6; y++) {
          const dy = T - y;
          const L = L0 * clamp01(1 - dy / 34);
          let c = mix(rockD, rockL, L * 0.9);
          const edge = hs[mod(x - 1, BW)] < T - y || hs[mod(x + 1, BW)] < T - y;
          if (edge && dy > 0) c = mix(rockD, rim, 0.25 + L * 0.7);
          if (y === top && hs[x] > 0) c = mix(c, rockD, 0.4);
          b.px(x, y, c);
        }
        if (pool[x]) {
          b.px(x, T - 2, lk[2], 0.5);
          b.px(x, T - 1, hash(x, 515 + k) < 0.3 ? lk[4] : lk[3]);
          b.px(x, T, lk[3]);
          b.px(x, T + 1, lk[2]);
          b.px(x, T + 2, lk[1]);
        }
        // Überhang unter der Terrasse mit Tropfsteinen
        const under = Math.round(2 + Math.max(0, noise(x, 16, 560 + k, BW) - 0.3) * 30 + (hash(x, 540 + k) < 0.12 ? 3 + hash(x, 541 + k) * 10 : 0));
        for (let i = 0; i < under; i++) b.px(x, T + 6 + i, i === under - 1 ? mix(rockD, rockL, 0.5) : rockD);
      }
      // Lavafall von der Terrasse darüber in einen See
      if (k > 0 && hash(k, 550) < 0.8) {
        let xc = Math.floor(hash(k, 551) * BW);
        for (let i = 0; i < BW && !pool[xc]; i++) xc = mod(xc + 1, BW);
        const y0 = terr[k - 1] + 6;
        for (let y = y0; y < T; y++) {
          b.px(xc - 2, y, lk[2], 0.18);
          b.px(xc - 1, y, lk[2], 0.55);
          b.px(xc, y, (y >> 2) % 3 === 0 ? lk[4] : lk[3]);
          b.px(xc + 1, y, lk[3]);
          b.px(xc + 2, y, lk[2], 0.55);
          b.px(xc + 3, y, lk[2], 0.18);
        }
        for (let dx = -4; dx <= 5; dx++) b.px(xc + dx, T - 2, lk[3], 0.6 - Math.abs(dx) * 0.1);
        this.backFalls.push([xc, y0, T]);
      }
    });
    return b.sprite();
  }

  /** Helle Tropfen, die einen fernen Lavafall hinunterlaufen (vertikal verschiebbar). */
  private bakeDrip(): Sprite {
    const b = new Buf(2, 320);
    const c = hexRgb(PAL.hell.lake[4]);
    for (let y = 0; y < 320; y++) if (mod(y, 24) < 4) b.rect(0, y, 2, 1, c, mod(y, 24) < 2 ? 1 : 0.6);
    return b.sprite();
  }

  /** Lavastrom (10 px Strom + Schein), Periode 32, zum Verschieben nach unten. */
  private bakeFallTex(): Sprite {
    const W = 12;
    const b = new Buf(W, 544);
    const lk = PAL.hell.lake.map(hexRgb);
    for (let y = 0; y < 544; y++) {
      for (let x = 0; x < W; x++) {
        const dx = Math.abs(x - 5.5);
        if (dx > 3) {
          b.px(x, y, lk[2], dx > 4 ? 0.12 : 0.3);
          continue;
        }
        const ph = mod(y + Math.floor(hash(x, 801) * 32) + (x & 1) * 7, 32);
        let c = dx > 2 ? lk[1] : dx > 1 ? lk[2] : lk[3];
        if (ph < 4 && dx <= 1) c = lk[4];
        else if (ph < 10 && dx <= 2) c = lk[3];
        else if (ph > 22 && dx > 1) c = lk[1];
        b.px(x, y, c);
      }
    }
    return b.sprite();
  }

  /** Vordergrund-Felsen am Bildrand: fast schwarz, Unterseiten von den Feuerseen glutrot angestrahlt. */
  private bakeForeground(seed: number, right: boolean): Sprite {
    const b = new Buf(FGW, FGH, false, true);
    const e: number[] = [];
    for (let y = 0; y < FGH; y++) {
      const n = noise(y, 64, seed, FGH) * 0.6 + noise(y, 16, seed + 1, FGH) * 0.28 + noise(y, 4, seed + 2, FGH) * 0.12;
      // in 2-px-Stufen, damit die Kante wie behauener Fels wirkt
      e[y] = 2 * Math.round(Math.max(0, Math.min(26, (n - 0.45) * 110)) / 2);
    }
    const body = hexRgb('#0c0309');
    const inner = hexRgb('#1a0612');
    const hot = hexRgb('#ff7a3c');
    const warm = hexRgb('#b2321e');
    const ember = hexRgb('#5a1418');
    const top = hexRgb('#2e0e22');
    for (let y = 0; y < FGH; y++) {
      const w = e[y];
      if (w < 2) continue;
      // Kantenrichtung: wird der Fels darunter schmaler, zeigt die Kante nach unten (zur Glut)
      const below = Math.min(e[mod(y + 1, FGH)], e[mod(y + 2, FGH)], e[mod(y + 3, FGH)]);
      const above = Math.min(e[mod(y - 1, FGH)], e[mod(y - 2, FGH)]);
      for (let i = 0; i < w; i++) {
        const x = right ? FGW - 1 - i : i;
        const fromEdge = w - 1 - i;
        let c = body;
        if (i >= below) {
          // Unterseite: von unten angestrahlt, je tiefer die Zeile in der Unterkante, desto heller
          const dn = e[mod(y + 1, FGH)] <= i ? 0 : e[mod(y + 2, FGH)] <= i ? 1 : 2;
          c = dn === 0 ? (fromEdge < 3 ? hot : warm) : dn === 1 ? warm : ember;
        } else if (i >= above && fromEdge < 2) c = top;
        else if (fromEdge === 0) c = ember;
        else if (fromEdge < 3) c = inner;
        else if (hash(x * 13 + y, seed + 3) < 0.04) c = inner; // Körnung
        b.px(x, y, c);
      }
    }
    return b.sprite();
  }

  /** Schwefeldampf-Schwade: breites, gedithertes Band. */
  private bakeSwath(v: number): Sprite {
    const W = 128;
    const Hh = 22;
    const b = new Buf(W, Hh);
    const st = PAL.hell.steam.map(hexRgb);
    for (let y = 0; y < Hh; y++)
      for (let x = 0; x < W; x++) {
        const edge = Math.sin((Math.PI * x) / W);
        const prof = Math.sin((Math.PI * y) / Hh);
        const n = noise(x + y * 0.6, 16, 900 + v, 256) * 0.7 + noise(x - y, 8, 910 + v, 256) * 0.3;
        const dns = prof * edge * (0.4 + n);
        const dith = ((x + y) & 1) * 0.12;
        if (dns + dith > 0.8) b.px(x, y, st[3], 0.4);
        else if (dns + dith > 0.55) b.px(x, y, st[2], 0.3);
        else if (dns + dith > 0.35 && (x + y * 3) % 3 === 0) b.px(x, y, st[2], 0.25);
      }
    return b.sprite();
  }

  /** Fliegendes Teufelchen mit Fledermausflügeln (Flügel oben/unten). */
  private bakeFlyImp(imp: Sprite, f: number): Sprite {
    const [c, x] = canvas(32, 22);
    const p = PAL.hell.imp;
    // linker Flügel, Schulter rechts unten; rechts gespiegelt
    const up = ['b.........', 'bb........', 'abb.......', '.aabb.....', '.aaaabbb..', '..aaaaaaab', '...a.a.aa.'];
    const down = ['..........', '..........', '......bbbb', '...bbaaaab', '.bbaaaaaa.', 'baaa.aa...', 'aa..a.....'];
    const rows = f === 0 ? up : down;
    const col: Record<string, string> = { a: p[1], b: p[2] };
    rows.forEach((r, y) => {
      for (let i = 0; i < r.length; i++) {
        const k = r[i];
        if (k === '.') continue;
        x.fillStyle = col[k];
        x.fillRect(i, 3 + y, 1, 1);
        x.fillRect(31 - i, 3 + y, 1, 1);
      }
    });
    x.drawImage(imp, 0, 0, 18, 20, 7, 1, 18, 20);
    return c;
  }

  /** Eisenkäfig an der Kette, wahlweise mit Teufelchen (winkt in Frame 1). */
  private bakeCage(imp: Sprite | null, f = 0): Sprite {
    const [c, x] = canvas(22, 28);
    if (imp) x.drawImage(imp, f * 18, 0, 18, 20, 2, 5, 18, 20);
    else {
      // Glutnest im leeren Käfig
      x.fillStyle = PAL.hell.lake[2];
      x.fillRect(6, 22, 10, 2);
      x.fillStyle = PAL.hell.lake[4];
      x.fillRect(9, 22, 3, 1);
    }
    const dark = '#1e1624';
    const mid = '#4a3a54';
    const light = '#8a7a98';
    const hot = '#ff8a4a';
    x.fillStyle = mid;
    x.fillRect(10, 0, 2, 2);
    x.fillStyle = dark;
    x.fillRect(6, 2, 10, 1);
    x.fillRect(3, 3, 16, 1);
    x.fillStyle = mid;
    x.fillRect(1, 4, 20, 2);
    x.fillStyle = light;
    x.fillRect(2, 4, 12, 1);
    for (const bx of [1, 5, 9, 12, 16, 20]) {
      x.fillStyle = bx === 20 ? hot : bx === 1 ? dark : mid;
      x.fillRect(bx, 6, 1, 18);
    }
    x.fillStyle = mid;
    x.fillRect(1, 14, 20, 1);
    x.fillStyle = dark;
    x.fillRect(0, 24, 22, 2);
    x.fillStyle = light;
    x.fillRect(1, 24, 13, 1);
    x.fillStyle = hot;
    x.fillRect(5, 26, 12, 1);
    x.fillStyle = dark;
    x.fillRect(10, 27, 2, 1);
    return c;
  }

  /** Laterne: Eisenrahmen, flackernde Flamme. */
  private bakeLantern(f: number): Sprite {
    const [c, x] = canvas(9, 13);
    const p = PAL.hell;
    x.fillStyle = '#4a3a54';
    x.fillRect(4, 0, 1, 1);
    x.fillRect(2, 1, 5, 1);
    x.fillStyle = '#1e1624';
    x.fillRect(1, 2, 7, 1);
    x.fillStyle = p.flame[2];
    x.fillRect(2, 3, 5, 6);
    x.fillStyle = p.flame[1];
    x.fillRect(3, f ? 4 : 5, 3, f ? 5 : 4);
    x.fillStyle = p.flame[0];
    x.fillRect(4, f ? 5 : 6, 1, 3);
    x.fillStyle = '#1e1624';
    x.fillRect(1, 3, 1, 6);
    x.fillRect(7, 3, 1, 6);
    x.fillStyle = '#4a3a54';
    x.fillRect(1, 9, 7, 2);
    x.fillStyle = '#8a7a98';
    x.fillRect(2, 9, 3, 1);
    x.fillStyle = '#1e1624';
    x.fillRect(3, 11, 3, 1);
    x.fillRect(4, 12, 1, 1);
    return c;
  }

  /** Runentor: Bogen aus Obsidian mit glühenden Runen; das Portal pulsiert getrennt. */
  private bakeRuneGate(): [Sprite, Sprite] {
    const GW = 48;
    const GH = 66;
    const p = PAL.hell;
    const [dark, mid, light] = p.col.map(hexRgb);
    const rim = hexRgb(p.lake[3]);
    const b = new Buf(GW, GH);
    const portal = new Buf(GW, GH);
    const inOuter = (x: number, y: number) => x >= 0 && x < GW && (y >= 24 || (x - 23.5) ** 2 + (y - 24) ** 2 <= 24 * 24);
    const inOpen = (x: number, y: number) => x >= 10 && x <= 37 && (y >= 24 || (x - 23.5) ** 2 + (y - 24) ** 2 <= 14 * 14);
    const lk = p.lake.map(hexRgb);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (!inOuter(x, y)) continue;
        if (inOpen(x, y)) {
          // Portal: Glut unten, nach oben dunkler, mit Wirbeln
          const t = clamp01((y - 12) / (GH - 12));
          const swirl = Math.sin(Math.hypot(x - 23.5, y - 40) * 0.9 - Math.atan2(y - 40, x - 23.5) * 2) > 0.6;
          portal.px(x, y, swirl ? lk[2] : mix(lk[0], lk[2], t), swirl ? 0.25 + t * 0.35 : 0.3 + t * 0.45);
          continue;
        }
        const edgeIn = inOpen(x - 1, y) || inOpen(x + 1, y) || inOpen(x, y - 1);
        const edgeOut = !inOuter(x - 1, y) || !inOuter(x + 1, y) || !inOuter(x, y - 1);
        let c = mix(mid, light, 0.45);
        if (edgeOut) c = dark;
        else if (edgeIn) c = y > 30 ? rim : light;
        else if (y < 24 && (x + y) % 7 === 0) c = mid; // Steinfugen im Bogen
        else if (y > 24 && y % 13 === 0) c = mid;
        else if (x === 9 || x === 38) c = mid;
        else if (y > GH - 12) c = mix(mid, rim, ((y - (GH - 12)) / 12) * 0.5);
        b.px(x, y, c);
      }
    const s = b.sprite();
    const x = s.getContext('2d')!;
    const runes = this.runes.get('hell')!;
    for (let i = 0; i < 3; i++)
      for (const [px, side] of [
        [1, 0],
        [39, 1],
      ]) {
        const g = 70 + i * 5 + side * 2;
        x.drawImage(runes, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, px, 28 + i * 12, 8, 8);
      }
    const g = 99;
    x.drawImage(runes, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, 20, 1, 8, 8);
    return [s, portal.sprite()];
  }

  /** Flammengeist (7×9), zwei Flacker-Frames. */
  private spiritSprite(p: Palette, f: number): Sprite {
    const [c, x] = canvas(7, 9);
    x.fillStyle = p.flame[2];
    x.fillRect(1, 3, 5, 5);
    x.fillRect(2, 8, 3, 1);
    x.fillStyle = p.flame[1];
    x.fillRect(2 + f, 0, 2, 4);
    x.fillRect(2, 3, 3, 4);
    x.fillStyle = p.flame[0];
    x.fillRect(3, 4, 1, 3);
    x.fillStyle = '#2a0a1a';
    x.fillRect(2, 5, 1, 1);
    x.fillRect(4, 5, 1, 1);
    return c;
  }

  private cached(key: string, make: () => Sprite): Sprite {
    let s = this.cache.get(key);
    if (!s) this.cache.set(key, (s = make()));
    return s;
  }

  /** Basaltsäule: 240 px (5 Segmente à 48 px), Randlicht, in der Hölle mit Glutadern. */
  private column(l: Level, w: number, rimLeft: boolean): Sprite {
    return this.cached(`col-${l}-${w}-${rimLeft}`, () => {
      const p = PAL[l];
      const [dark, mid, light, rim] = p.col;
      const [c, x] = canvas(w, 240);
      x.fillStyle = mid;
      x.fillRect(0, 0, w, 240);
      x.fillStyle = dark;
      x.fillRect(Math.floor(w * 0.66), 0, Math.ceil(w * 0.34), 240);
      x.fillStyle = light;
      x.fillRect(Math.floor(w * 0.18), 0, 2, 240);
      for (let s = 0; s < 5; s++)
        for (const sy of [0, 17, 33]) {
          x.fillStyle = dark;
          x.fillRect(0, s * 48 + sy, w, 1);
          x.fillStyle = light;
          x.fillRect(1, s * 48 + sy + 1, Math.floor(w * 0.6), 1);
        }
      if (l === 'hell') {
        // Glutadern: dünne Risse, die von innen glühen
        for (let v = 0; v < 3; v++) {
          let vx = Math.floor(hash(w * 7 + v, 81) * (w - 4)) + 2;
          const y0 = Math.floor(hash(w + v, 82) * 200);
          const len = 12 + Math.floor(hash(w, v + 83) * 26);
          for (let i = 0; i < len; i++) {
            if (hash(i + v * 50, w + 84) < 0.3) vx += hash(i, v + 85) < 0.5 ? -1 : 1;
            vx = Math.max(1, Math.min(w - 2, vx));
            x.fillStyle = i % 5 === 0 ? p.lake[4] : i % 2 ? p.lake[2] : p.lake[3];
            x.fillRect(vx, y0 + i, 1, 1);
          }
        }
      }
      // Randlicht von den Feuerseen
      x.fillStyle = rim;
      x.globalAlpha = l === 'hell' ? 0.8 : 0.55;
      x.fillRect(rimLeft ? 0 : w - 1, 0, 1, 240);
      if (l === 'hell') {
        x.globalAlpha = 0.3;
        x.fillRect(rimLeft ? 1 : w - 2, 0, 1, 240);
      }
      x.globalAlpha = 1;
      x.fillStyle = '#000000';
      x.fillRect(rimLeft ? w - 1 : 0, 0, 1, 240);
      return c;
    });
  }

  /** Ferne Säule als Silhouette (240 px = 10 Segmente à 24 px) mit glimmenden Fenstern. */
  private farColumn(l: Level, w: number, v: number): Sprite {
    return this.cached(`far-${l}-${w}-${v}`, () => {
      const p = PAL[l];
      const [c, x] = canvas(w, 240);
      x.fillStyle = p.far[0];
      x.fillRect(0, 0, w, 240);
      x.fillStyle = p.far[1];
      x.fillRect(0, 0, 1, 240);
      for (let s = 0; s < 10; s++) {
        if (hash(w * 31 + s + v * 97, 3) >= 0.06) continue;
        if (l === 'hell') {
          x.fillStyle = p.lake[1];
          x.fillRect(1, s * 24 + 8, Math.max(2, w - 5) + 2, 4);
        }
        x.fillStyle = p.lake[2];
        x.fillRect(2, s * 24 + 9, Math.max(2, w - 5), 2);
      }
      return c;
    });
  }

  /** Sims-Platte (ohne See) mit dunklem Unterbau. */
  private ledge(l: Level, sw: number): Sprite {
    return this.cached(`ledge-${l}-${sw}`, () => {
      const p = PAL[l];
      const [c, x] = canvas(sw, 9);
      x.fillStyle = p.col[1];
      x.fillRect(0, 0, sw, 5);
      x.fillStyle = p.col[2];
      x.fillRect(0, 0, sw, 1);
      x.fillStyle = p.col[0];
      x.fillRect(2, 5, sw - 4, 2);
      x.fillRect(6, 7, sw - 12, 2);
      return c;
    });
  }

  /** Warmer Schein über einem Feuersee: färbt Säulenwand und Luft von unten an. */
  private uplight(l: Level, w: number): Sprite {
    return this.cached(`up-${l}-${w}`, () => {
      const b = new Buf(w, 44);
      const c = hexRgb(PAL[l].lake[2]);
      for (let y = 0; y < 44; y++)
        for (let x = 0; x < w; x++) {
          const dx = Math.abs(x - w / 2) / (w / 2);
          const a = 0.34 * Math.pow(y / 43, 1.6) * (1 - dx * dx);
          if (a > 0.02 && ((x + y) & 1 || a > 0.12)) b.px(x, y, c, a);
        }
      return b.sprite();
    });
  }

  /** Durchhängende Kette zwischen zwei Säulen. */
  private sagChain(l: Level, w: number): Sprite {
    return this.cached(`sag-${l}-${w}`, () => {
      const p = PAL[l];
      const sag = Math.round(10 + w * 0.12);
      const [c, x] = canvas(w, sag + 3);
      for (let i = 0; i < w; i += 2) {
        const t = i / w;
        const yy = Math.round(sag * 4 * t * (1 - t));
        x.fillStyle = (i >> 1) & 1 ? p.col[2] : p.col[1];
        x.fillRect(i, yy, 2, 1);
        x.fillStyle = p.col[0];
        x.fillRect(i, yy + 1, 2, 1);
      }
      return c;
    });
  }

  /** Felsnase, aus der Lava quillt. */
  private spout(): Sprite {
    return this.cached('spout', () => {
      const p = PAL.hell;
      const [c, x] = canvas(24, 8);
      x.fillStyle = p.col[0];
      x.fillRect(0, 1, 24, 5);
      x.fillRect(3, 0, 16, 1);
      x.fillRect(6, 6, 10, 1);
      x.fillStyle = p.col[1];
      x.fillRect(2, 1, 18, 3);
      x.fillStyle = p.col[2];
      x.fillRect(3, 1, 10, 1);
      x.fillStyle = p.lake[2];
      x.fillRect(5, 5, 14, 1);
      x.fillStyle = p.lake[3];
      x.fillRect(7, 6, 10, 2);
      return c;
    });
  }

  /** Flaches Lavabecken mit Felsrand und Schein. */
  private basin(): Sprite {
    return this.cached('basin', () => {
      const p = PAL.hell;
      const b = new Buf(40, 12);
      const lk = p.lake.map(hexRgb);
      const [r0, r1, r2] = p.col.map(hexRgb);
      for (let y = 0; y < 4; y++) for (let x = 6; x < 34; x++) b.px(x, y, lk[2], 0.25 * ((y + 1) / 4) * (1 - Math.abs(x - 19.5) / 15));
      for (let x = 0; x < 40; x++) {
        const dx = Math.abs(x - 19.5);
        const depth = dx > 17 ? 3 : dx > 13 ? 5 : 8;
        for (let y = 4; y < 4 + depth; y++) b.px(x, y, y === 4 ? r2 : y > depth ? r0 : mix(r1, lk[0], dx < 12 && y < 7 ? 0.6 : 0));
        if (dx < 15) {
          b.px(x, 4, (x * 7) % 11 < 3 ? lk[4] : lk[3]);
          b.px(x, 5, lk[2]);
          if (dx < 13) b.px(x, 6, lk[1]);
        }
      }
      return b.sprite();
    });
  }

  // ------------------------------------------------------------------ Zeichnen

  draw(d: HellFrame) {
    const { ctx, W, H, oy } = d;
    const top = Math.round(HELL_M * PPM + oy);
    if (top >= H) return;
    const clipTop = Math.max(0, top);
    this.hellRows(d, clipTop);
    const hell = this.rows.length > 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, W, H - clipTop);
    ctx.clip();
    this.background(d, clipTop);
    this.deep.back(d, clipTop);
    if (hell) this.backdrop(d);
    this.farLayer(d, clipTop);
    if (hell) {
      this.swathLayer(d, 0.45, 0);
      this.lavaFalls(d, clipTop);
      this.runeGates(d);
    }
    this.midLayer(d, clipTop);
    if (hell) this.cages(d, clipTop);
    this.gate(d);
    if (hell) this.flyingImps(d, clipTop);
    this.spirits(d, clipTop);
    if (hell) this.swathLayer(d, 1, 1);
    this.signs(d);
    if (hell) this.foreground(d);
    this.deep.front(d, clipTop);
    ctx.restore();
    if (top > -80) this.ceiling(d, top);
  }

  /** Bildschirm-Zeilen, in denen Hölle-Ebenen sichtbar sind: voll bis 6.800 m, dann in 8 Stufen aus. */
  private hellRows(d: HellFrame, clipTop: number) {
    const rows: [number, number, number][] = (this.rows = []);
    const yF = Math.round((GATE_M - 200) * PPM + d.oy);
    const add = (a: number, b: number, al: number) => {
      a = Math.max(a, clipTop);
      b = Math.min(b, d.H);
      if (b > a && al > 0) rows.push([a, b, al]);
    };
    add(clipTop, yF, 1);
    for (let i = 0; i < 8; i++) add(yF + i * 25, yF + (i + 1) * 25, 1 - (i + 0.5) / 8);
  }

  /** Blittet ein Ebenen-Bild (optional waagerecht/senkrecht gekachelt) nur in die Hölle-Zeilen. */
  private blit(d: HellFrame, img: Sprite, x0: number, y0: number, tileX: boolean, tileY: boolean) {
    const { ctx, W } = d;
    const iw = img.width;
    const ih = img.height;
    const xs: number[] = [];
    if (tileX) for (let x = mod(x0, iw) - iw; x < W; x += iw) xs.push(x);
    else xs.push(x0);
    for (const [a, b, al] of this.rows) {
      ctx.globalAlpha = al;
      const ty0 = tileY ? y0 + Math.floor((a - y0) / ih) * ih : y0;
      for (let ty = ty0; ty < b; ty += ih) {
        const s = Math.max(a, ty);
        const e = Math.min(b, ty + ih);
        if (e > s) for (const x of xs) ctx.drawImage(img, 0, s - ty, iw, e - s, x, s, iw, e - s);
        if (!tileY) break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Riesenhöhle: Farbverlauf in Bändern, je Ebene getönt – als vorgerechnete Streifen à 128 px. */
  private background(d: HellFrame, clipTop: number) {
    const { ctx, W, H, oy } = d;
    for (let c = Math.floor((clipTop - oy) / 128); c * 128 + oy < H; c++) {
      let s = this.bgStrips.get(c);
      if (!s) {
        if (this.bgStrips.size > 48) this.bgStrips.clear();
        const [cv, x] = canvas(1, 128);
        for (let y = 0; y < 128; y += 2) {
          const yw = c * 128 + y;
          const m = yw / PPM;
          const lb = levelBlend(m);
          const t = (Math.sin(m * 0.0018) + 1) / 2;
          const ca = lerpColor(PAL[lb.a].bg[0], PAL[lb.a].bg[1], t);
          const cb = lerpColor(PAL[lb.b].bg[0], PAL[lb.b].bg[1], t);
          const dither = ((yw >> 1) & 1) * 0.12 - 0.06;
          x.fillStyle = lb.t === 0 ? ca : blendRgb(ca, cb, Math.max(0, Math.min(1, lb.t + dither)));
          x.fillRect(0, y, 1, 2);
        }
        this.bgStrips.set(c, (s = cv));
      }
      ctx.drawImage(s, 0, 0, 1, 128, 0, c * 128 + oy, W, 128);
    }
  }

  /** Bildschirm-Koordinaten einer Parallax-Ebene. */
  private layer(d: HellFrame, f: number) {
    return {
      sx: (lx: number) => Math.round(d.W / 2 + (lx - d.camX) * f),
      sy: (ly: number) => Math.round(d.anchorY + (ly - d.camY) * f),
      ly: (sy: number) => (sy - d.anchorY) / f + d.camY,
    };
  }

  /** Ferne Höhlenwand mit Terrassen und Feuerseen; Tropfen laufen die fernen Lavafälle hinab. */
  private backdrop(d: HellFrame) {
    const { ctx, W, time, calm } = d;
    const Y0 = Math.round(d.anchorY + (LY0 - d.camY) * FB);
    const X0 = Math.round(W / 2 - d.camX * FB);
    this.blit(d, this.back, X0, Y0, true, false);
    if (calm) return;
    const off = Math.floor(mod(time * 30, 24));
    for (const [fx, y0, y1] of this.backFalls) {
      const sy = Y0 + y0;
      const len = Math.min(296, y1 - y0);
      if (sy + len < 0 || sy > d.H) continue;
      const al = hellW((sy + len / 2 - d.oy) / PPM);
      if (al <= 0) continue;
      ctx.globalAlpha = al;
      for (let x = mod(X0, 256) - 256; x < W; x += 256) if (x + fx >= -2 && x + fx < W) ctx.drawImage(this.drip, 0, 24 - off, 2, len, x + fx, sy, 2, len);
    }
    ctx.globalAlpha = 1;
  }

  /** Ferne Säulen als Silhouetten, mit dunklem Glühen. */
  private farLayer(d: HellFrame, clipTop: number) {
    const { W } = d;
    const f = 0.35;
    const L = this.layer(d, f);
    const span = 46;
    const k0 = Math.floor((d.camX - W / f) / span);
    for (let k = k0; k < k0 + Math.ceil((W * 2.2) / f / span) + 2; k++) {
      const x = L.sx(k * span + hash(k, 1) * 26);
      const w = hash(k, 2) < 0.2 ? 26 + Math.floor(hash(k, 4) * 20) : 6 + Math.floor(hash(k, 2) * 10);
      if (x + w < 0 || x > W) continue;
      const v = mod(k, 3);
      // In der Hölle stehen weniger ferne Säulen – dahinter soll die Höhlenwand mit ihren Feuerseen zu sehen sein
      const inHell = w > 20 || hash(k, 6) > 0.55 ? 1 : 0;
      this.columnRuns(d, clipTop, x, L.sy(0) + Math.floor(hash(k, 5) * 10) * 24, 24, 10, 'farColumns', (l) => this.farColumn(l, w, v), inHell);
    }
  }

  /**
   * Zeichnet eine Säule aus einem gekachelten Bild (period Segmente à seg px). Gleiche Ebene ohne
   * Überblendung wird zu einem Aufruf zusammengefasst; an Ebenengrenzen wird je Segment überblendet
   * und mit DEEP_SHARED gewichtet.
   */
  private columnRuns(d: HellFrame, clipTop: number, x: number, y0: number, seg: number, period: number, part: Part, spr: (l: Level) => Sprite, inHell = 1) {
    const { ctx, H, oy } = d;
    const pw = (l: Level) => (l === 'hell' ? inHell : partW(l, part));
    let run: { l: Level; s0: number; n: number } | null = null;
    const flush = () => {
      if (!run) return;
      const sp = spr(run.l);
      ctx.drawImage(sp, 0, mod(run.s0, period) * seg, sp.width, run.n * seg, x, y0 + run.s0 * seg, sp.width, run.n * seg);
      run = null;
    };
    for (let s = Math.floor((clipTop - y0) / seg); y0 + s * seg < H; s++) {
      const lb = levelBlend((y0 + s * seg + seg / 2 - oy) / PPM);
      const wa = pw(lb.a);
      const wb = pw(lb.b);
      if (lb.t === 0 && wa === 1) {
        const r = run as { l: Level; s0: number; n: number } | null;
        if (r && r.l === lb.a && mod(r.s0, period) + r.n < period) r.n++;
        else {
          flush();
          run = { l: lb.a, s0: s, n: 1 };
        }
        continue;
      }
      flush();
      const idx = mod(s, period) * seg;
      const y = y0 + s * seg;
      const aa = lb.t === 0 ? wa : wa * (wb > 0 ? 1 : 1 - lb.t);
      const ab = lb.t === 0 ? 0 : wb * lb.t;
      for (const [l, al] of [
        [lb.a, aa],
        [lb.b, ab],
      ] as [Level, number][]) {
        if (al <= 0) continue;
        ctx.globalAlpha = al;
        const sp = spr(l);
        ctx.drawImage(sp, 0, idx, sp.width, seg, x, y, sp.width, seg);
      }
      ctx.globalAlpha = 1;
    }
    flush();
  }

  /** Schwefeldampf-Schwaden, die langsam quer durch die Höhle ziehen (nur Hölle). */
  private swathLayer(d: HellFrame, f: number, seed: number) {
    const { ctx, W, H, time, calm } = d;
    const L = this.layer(d, f);
    const STEP = seed ? 150 : 110;
    for (let j = Math.floor(L.ly(-30) / STEP); j <= Math.ceil(L.ly(H + 30) / STEP); j++) {
      if (hash(j, 120 + seed) > (seed ? 0.45 : 0.6)) continue;
      const ly = j * STEP + hash(j, 121 + seed) * 60;
      if (ly < HELL_M * PPM + 40) continue;
      const y = L.sy(ly);
      const w = hellW((y - d.oy) / PPM);
      if (w <= 0 || y < -24 || y > H) continue;
      const s = this.swaths[mod(j, 3)];
      const speed = (seed ? 5 : 3) * (hash(j, 122) < 0.5 ? 1 : -1);
      const span = W + s.width;
      const x = Math.round(mod(hash(j, 123) * span + (calm ? 0 : time * speed), span)) - s.width;
      ctx.globalAlpha = w * (seed ? 0.5 : 0.7);
      ctx.drawImage(s, x, y);
    }
    ctx.globalAlpha = 1;
  }

  /** Große Lavafälle aus Felsnasen, die in glühende Becken stürzen (nur Hölle). */
  private lavaFalls(d: HellFrame, clipTop: number) {
    const { ctx, W, H, time, calm } = d;
    const f = 0.5;
    const L = this.layer(d, f);
    const STEP = 270;
    const p = PAL.hell;
    for (let j = Math.floor(L.ly(clipTop - 400) / STEP); j <= Math.ceil(L.ly(H) / STEP); j++) {
      if (hash(j, 130) > 0.5) continue;
      const ly = j * STEP + hash(j, 131) * 80;
      if (ly < HELL_M * PPM + 20) continue;
      const side = hash(j, 132) < 0.5 ? -1 : 1;
      const x = L.sx(side * (60 + hash(j, 133) * 70)) - 6;
      const y0 = L.sy(ly);
      const len = 80 + Math.floor(hash(j, 134) * 110);
      const y1 = y0 + len;
      if (y1 + 14 < clipTop || y0 - 12 > H || x + 30 < 0 || x - 10 > W) continue;
      const al = Math.min(hellW((y1 - d.oy) / PPM), hellW((y0 - d.oy) / PPM));
      if (al <= 0) continue;
      ctx.globalAlpha = al;
      // Strom (verschoben, damit er fließt)
      const off = calm ? 0 : Math.floor(mod(time * 46, 32));
      const a = Math.max(y0, clipTop - 2);
      const e = Math.min(y1, H);
      if (e > a) ctx.drawImage(this.fallTex, 0, 32 - off + ((a - y0) % 32), 12, e - a, x, a, 12, e - a);
      ctx.drawImage(this.spout(), x - 6, y0 - 6);
      ctx.drawImage(this.basin(), x - 14, y1 - 4);
      if (!calm) {
        ctx.fillStyle = p.lake[4];
        const sp = Math.floor(time * 6 + j);
        ctx.fillRect(x + (sp % 5) * 3 - 1, y1 - 2 - (sp % 3), 1, 1);
        ctx.fillRect(x + 12 - (sp % 4) * 3, y1 - 1 - ((sp + 1) % 3), 1, 1);
      }
      ctx.globalAlpha = 1;
      if (al > 0.3) {
        d.lights.push([x + 6, y1, 28, p.lake[3]]);
      }
    }
  }

  /** Runentore als ferne Landmarken (nur Hölle), Portal pulsiert. */
  private runeGates(d: HellFrame) {
    const { ctx, H, time, calm } = d;
    const L = this.layer(d, 0.55);
    for (const [m, side] of RUNE_GATES) {
      const x = L.sx(side * 100) - 24;
      const y = L.sy(m * PPM) - 66;
      if (y > H || y + 70 < 0) continue;
      const al = hellW((y + 33 - d.oy) / PPM);
      if (al <= 0) continue;
      ctx.globalAlpha = al * (calm ? 0.85 : 0.6 + 0.4 * Math.sin(time * 1.7 + m));
      ctx.drawImage(this.portal, x, y);
      ctx.globalAlpha = al;
      ctx.drawImage(this.runeGate, x, y);
      ctx.globalAlpha = 1;
      d.lights.push([x + 24, y + 42, 30, PAL.hell.rune]);
    }
  }

  /** Obsidiansäulen mit Runen, Simsen, Feuerseen, Teufelchen, Fackeln, Dampf und Ketten. */
  private midLayer(d: HellFrame, clipTop: number) {
    const { ctx, W, H, time, calm } = d;
    const f = 0.7;
    const L = this.layer(d, f);
    const k0 = Math.floor((d.camX - W / f) / 120) - 1;
    const k1 = Math.ceil((d.camX + W / f) / 120) + 1;
    const cols: { k: number; x: number; w: number }[] = [];
    for (let k = k0; k <= k1; k++) {
      // Säulen symmetrisch um das Seil: die innersten (k = 0 / −1) immer da, 62–90 px vom Seil,
      // weiter außen alle 120 px mit gelegentlicher Lücke – die Mitte bleibt frei
      const w = 16 + Math.floor(hash(k, 12) * 22);
      const off = 62 + Math.floor(hash(k, 11) * 28);
      const lx = k >= 0 ? off + k * 120 : -off - (-k - 1) * 120 - w;
      if (Math.abs(k + 0.5) > 1 && hash(k, 13) < 0.25) continue;
      cols.push({ k, x: L.sx(lx), w });
    }
    const ly0 = L.ly(clipTop);
    const ly1 = L.ly(H);
    const STEP = 230;
    const mOf = (sy: number) => (sy - d.oy) / PPM;

    // Ketten zwischen benachbarten Säulen (hinter den Säulen)
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      if (b.k !== a.k + 1) continue;
      for (let j = Math.floor(ly0 / STEP); j <= Math.ceil(ly1 / STEP); j++) {
        if (hash(a.k * 17 + j, 21) > 0.35) continue;
        const ly = j * STEP + 60 + hash(a.k + j, 22) * 60;
        if (ly < HELL_M * PPM) continue;
        const y = L.sy(ly);
        const x0 = a.x + a.w;
        const x1 = b.x;
        if (x1 - x0 < 8 || y < clipTop - 30 || y > H + 30) continue;
        if (hash(a.k * 3 + j, 23) >= sharedW(mOf(y), 'chains')) continue;
        ctx.drawImage(this.sagChain(levelAt(ly / PPM), x1 - x0), x0, y);
      }
    }

    for (const { k, x, w } of cols) {
      if (x + w + 40 < 0 || x - 40 > W) continue;
      const rimLeft = x + w / 2 > W / 2;
      this.columnRuns(d, clipTop, x, L.sy(0), 48, 5, 'midColumns', (l) => this.column(l, w, rimLeft));
      // Runen auf der Säule, pulsierend
      for (let j = Math.floor(ly0 / 70); j <= Math.ceil(ly1 / 70); j++) {
        if (hash(k * 13 + j, 31) > 0.4) continue;
        const ly = j * 70 + hash(k, j) * 30;
        const y = L.sy(ly);
        if (y < clipTop || y > H) continue;
        const vis = sharedW(mOf(y), 'midColumns');
        if (vis <= 0) continue;
        const lvl = levelAt(ly / PPM);
        const g = Math.floor(hash(k * 7 + j, 32) * 128);
        const pulse = calm ? 1 : 0.55 + 0.45 * Math.sin(time * 2 + j + k);
        ctx.globalAlpha = pulse * vis;
        ctx.drawImage(this.runes.get(lvl)!, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, x + Math.floor(w / 2) - 4, y, 8, 8);
        ctx.globalAlpha = 1;
        if (hash(k + j, 33) < 0.35) d.lights.push([x + Math.floor(w / 2), y + 4, 9, PAL[lvl].rune]);
      }
      // Simse mit Feuersee
      for (let j = Math.floor(ly0 / STEP) - 1; j <= Math.ceil(ly1 / STEP) + 1; j++) {
        if (hash(k * 5 + j, 41) > 0.7) continue;
        const ly = j * STEP + hash(k * 3 + j, 42) * 120;
        if (ly < HELL_M * PPM + 40) continue;
        const y = L.sy(ly);
        if (y < clipTop - 40 || y > H + 50) continue;
        const m = mOf(y);
        if (hash(k * 5 + j, 48) >= sharedW(m, 'ledges')) continue;
        const hw = hellW(m);
        const lvl = levelAt(ly / PPM);
        const p = PAL[lvl];
        const left = hash(k + j, 43) < 0.5;
        const sw = 30 + Math.floor(hash(k + j, 44) * 14);
        const sx = left ? x - sw + 4 : x + w - 4;
        // Schein des Sees auf Säule und Luft (nur Hölle)
        if (hw > 0) {
          const uw = sw + 28;
          ctx.globalAlpha = hw;
          ctx.drawImage(this.uplight(lvl, uw), Math.round(sx + sw / 2 - uw / 2), y - 42);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(this.ledge(lvl, sw), sx, y);
        // Feuersee in der Mulde (animiert)
        const frame = calm ? 0 : Math.floor(time * 10 + k) % 45;
        const lw = sw - 10;
        ctx.drawImage(this.lava.get(lvl)!, frame * 16, 0, Math.min(16, lw), 3, sx + 5, y - 2, Math.min(16, lw), 3);
        if (lw > 16) ctx.drawImage(this.lava.get(lvl)!, ((frame + 7) % 45) * 16, 0, lw - 16, 3, sx + 21, y - 2, lw - 16, 3);
        ctx.fillStyle = p.lake[4];
        if (!calm && hash(k * 9 + j, Math.floor(time * 2)) < 0.3) ctx.fillRect(sx + 5 + Math.floor(hash(j, Math.floor(time * 2)) * lw), y - 2, 1, 1);
        d.lights.push([sx + sw / 2, y - 2, 16 + Math.floor(sw / 3), p.lake[3]]);
        // Lava läuft über die Kante und rinnt als dünner Strom hinab (nur Hölle)
        if (hw > 0 && hash(k * 6 + j, 49) < 0.45) {
          const fx = left ? sx + 1 : sx + sw - 3;
          const flen = 18 + Math.floor(hash(k + j, 50) * 30);
          const off = calm ? 0 : Math.floor(mod(time * 40, 32));
          ctx.globalAlpha = hw * 0.85;
          ctx.drawImage(this.fallTex, 4, 32 - off, 3, flen, fx - 1, y + 3, 3, flen);
          ctx.globalAlpha = 1;
        }
        // Dampf steigt auf
        if (!calm && hash(k * 7 + j, 51) < sharedW(m, 'steam')) {
          const st = this.steam.get(lvl)!;
          for (let s = 0; s < 2; s++) {
            const tt = mod(time * 0.6 + s * 0.5 + hash(k, j), 1);
            const fr = Math.floor(tt * 4) % 4;
            ctx.globalAlpha = 0.55 * (1 - tt);
            ctx.drawImage(st, fr * 16, 16 * (s % 2), 16, 16, sx + 4 + s * 10 + Math.round(Math.sin(time + s) * 2), y - 14 - Math.round(tt * 22), 16, 16);
          }
          ctx.globalAlpha = 1;
        }
        // Fackel am Rand
        const torch = hash(k + j, 45) < 0.5 * sharedW(m, 'torches');
        if (torch) {
          const tf = calm ? 0 : Math.floor(time * 10 + j) % 8;
          const tx = left ? sx : sx + sw - 16;
          ctx.drawImage(this.torch.get(lvl)!, tf * 16, 0, 16, 16, tx, y - 16, 16, 16);
          d.lights.push([tx + 8, y - 10, 14, p.flame[1]]);
        }
        // Teufelchen läuft auf dem Sims hin und her – winkt, wenn die Figur vorbeikommt
        if (hash(k * 2 + j, 46) < 0.62 * sharedW(m, 'imps')) {
          const near = Math.abs(y - d.explorerY) < 70;
          let a0 = sx + 2;
          let a1 = sx + sw - 20;
          if (torch) {
            if (left) a0 = sx + 13;
            else a1 = sx + sw - 31;
          }
          const span = Math.max(0, a1 - a0);
          const u = calm ? 0.25 : (time * 7) / Math.max(8, span * 2) + hash(k, j + 3);
          const ix = Math.round(a0 + tri(u) * span);
          const goingLeft = u - Math.floor(u) >= 0.5;
          const wave = !calm && near && Math.floor(time * 4 + k) % 2 === 1;
          const faceLeft = near ? sx + sw / 2 > W / 2 : goingLeft;
          const bob = calm || near || span < 2 ? 0 : -(Math.floor(time * 8 + k) % 2);
          const [imp, impL] = this.imp.get(lvl)!;
          // gespiegeltes Blatt: Frame 0 liegt rechts
          ctx.drawImage(faceLeft ? impL : imp, faceLeft ? (wave ? 0 : 18) : wave ? 18 : 0, 0, 18, 20, ix, y - 19 + bob, 18, 20);
        }
        // Kette hängt vom Sims herab
        if (hash(k * 4 + j, 47) < 0.3 * sharedW(m, 'chains')) {
          const cx = left ? sx + 3 : sx + sw - 5;
          ctx.drawImage(this.chainStrip, 0, 0, 6, 54, cx, y + 7, 6, 54);
        }
      }
    }
  }

  /** Käfige und Laternen an langen Ketten von der Höhlendecke (nur Hölle), leicht pendelnd. */
  private cages(d: HellFrame, clipTop: number) {
    const { ctx, W, H, time, calm } = d;
    const f = 0.85;
    const L = this.layer(d, f);
    const STEP = 150;
    for (let j = Math.floor(L.ly(clipTop) / STEP); j <= Math.ceil(L.ly(H + 40) / STEP); j++) {
      if (hash(j, 140) > 0.6) continue;
      const ly = j * STEP + hash(j, 141) * 50;
      if (ly < HELL_M * PPM + 30) continue;
      const side = hash(j, 142) < 0.5 ? -1 : 1;
      const sway = calm ? 0 : Math.round(Math.sin(time * 0.9 + j) * 1.6);
      const x = L.sx(side * (30 + hash(j, 143) * 60)) + sway;
      const y = L.sy(ly);
      if (y < clipTop - 30 || y > H + 2 || x < -24 || x > W + 4) continue;
      const al = hellW((y - d.oy) / PPM);
      if (al <= 0) continue;
      const chainTop = Math.max(clipTop, L.sy(Math.max(HELL_M * PPM, ly - 140 - hash(j, 144) * 200)));
      ctx.globalAlpha = al;
      const kind = hash(j, 145);
      const cw = kind < 0.6 ? 22 : 9;
      const cx = x + Math.floor(cw / 2) - 3;
      for (let cy = chainTop; cy < y; cy += CHAIN_LEN) {
        const h = Math.min(CHAIN_LEN, y - cy);
        ctx.drawImage(this.chainStrip, 0, mod(cy - y, 27), 6, h, cx, cy, 6, h);
      }
      if (kind < 0.6) {
        // Käfig, meist mit Teufelchen darin – winkt heraus, wenn die Figur vorbeikommt
        const near = Math.abs(y + 14 - d.explorerY) < 60;
        const s = kind < 0.15 ? this.cage[0] : !calm && near && Math.floor(time * 4 + j) % 2 ? this.cage[2] : this.cage[1];
        ctx.drawImage(s, x, y);
        ctx.globalAlpha = 1;
        if (kind < 0.15) d.lights.push([x + 11, y + 22, 12, PAL.hell.lake[3]]);
      } else {
        ctx.drawImage(this.lantern[calm ? 0 : Math.floor(time * 7 + j) % 2], x, y);
        ctx.globalAlpha = 1;
        d.lights.push([x + 4, y + 6, 20, PAL.hell.flame[1]]);
      }
    }
  }

  /** Teufelchen mit Fledermausflügeln, die quer durch die Höhle flattern (nur Hölle). */
  private flyingImps(d: HellFrame, clipTop: number) {
    const { ctx, W, H, time, calm } = d;
    const L = this.layer(d, 0.9);
    const STEP = 180;
    for (let j = Math.floor(L.ly(clipTop - 30) / STEP); j <= Math.ceil(L.ly(H + 30) / STEP); j++) {
      if (hash(j, 150) > 0.55) continue;
      const ly = j * STEP + hash(j, 151) * 80;
      if (ly < HELL_M * PPM + 40) continue;
      const ph = hash(j, 152) * 6.28;
      const sp = 0.18 + hash(j, 153) * 0.12;
      const t = calm ? 0 : time;
      const x = Math.round(W / 2 + Math.sin(t * sp + ph) * (W / 2 + 24)) - 16;
      const vx = Math.cos(t * sp + ph);
      const y = L.sy(ly) + Math.round(Math.sin(t * 2.2 + ph) * 7);
      if (y < clipTop - 22 || y > H || x < -32 || x > W) continue;
      const al = hellW((y - d.oy) / PPM);
      if (al <= 0) continue;
      const fr = calm ? 0 : Math.floor(t * 9 + j) % 2;
      ctx.globalAlpha = al;
      ctx.drawImage(this.flyImp[fr * 2 + (vx < 0 ? 1 : 0)], x, y);
      ctx.globalAlpha = 1;
    }
  }

  /** Höllentor bei 7.000 m: Säulen mit Runen, Bogen mit Hörnern, glühende Torflügel, Feuerschalen. */
  private gate(d: HellFrame) {
    const { ctx, ox, oy, H, time, calm } = d;
    const base = Math.round(GATE_M * PPM + oy) + 28; // Schwelle knapp unter der Figur bei 7.000 m
    if (base < -10 || base - 150 > H) return;
    const pw = 16;
    const half = 52;
    const h = 108;
    // Statische Teile einmal vorrechnen (Ursprung: ox − 60, base − h − 40)
    if (!this.gateImg) {
      const p = PAL.hell;
      const [c, x] = canvas(120, h + 40);
      const o = 60;
      const b = h + 40;
      for (let y = b - h + 18; y < b; y++) {
        const t = (y - (b - h + 18)) / (h - 18);
        x.fillStyle = lerpColor('#5a0c18', '#ff6a3c', Math.min(1, t * 1.2));
        x.fillRect(o - half + pw, y, (half - pw) * 2, 1);
      }
      x.fillStyle = '#2a0610';
      x.fillRect(o - 1, b - h + 18, 2, h - 18);
      for (const s of [-1, 1]) {
        x.fillStyle = '#ffd27a';
        for (let i = 0; i < 4; i++) x.fillRect(o + s * 14 - 1, b - 80 + i * 18, 3, 3);
        const px = o + (s < 0 ? -half : half - pw);
        x.drawImage(this.column('hell', pw, s > 0), 0, 0, pw, h, px, b - h, pw, h);
      }
      x.fillStyle = p.col[0];
      x.fillRect(o - half - 4, b - h - 14, half * 2 + 8, 14);
      x.fillStyle = p.col[2];
      x.fillRect(o - half - 4, b - h - 14, half * 2 + 8, 2);
      x.fillStyle = p.col[1];
      x.fillRect(o - half - 2, b - h - 11, half * 2 + 4, 9);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 12; i++) {
          const hx = o + s * (half - 6 + Math.round(Math.sin(i * 0.25) * 6 + i * 0.6));
          const hy = b - h - 14 - i * 2;
          x.fillStyle = i > 9 ? '#fff1b0' : i > 6 ? '#e8d8c0' : '#c8b8a0';
          x.fillRect(hx - (i < 6 ? 2 : 1), hy, i < 6 ? 4 : 2, 2);
        }
      }
      this.gateImg = c;
    }
    ctx.drawImage(this.gateImg, ox - 60, base - h - 40);
    for (const s of [-1, 1]) {
      const x = ox + (s < 0 ? -half : half - pw);
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = calm ? 1 : 0.6 + 0.4 * Math.sin(time * 2.5 + i + s);
        const g = 40 + i * 7 + (s > 0 ? 3 : 0);
        ctx.drawImage(this.runes.get('hell')!, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, x + 4, base - h + 20 + i * 20, 8, 8);
      }
      ctx.globalAlpha = 1;
      const tf = calm ? 0 : Math.floor(time * 10 + s) % 8;
      ctx.drawImage(this.torch.get('hell')!, tf * 16, 0, 16, 16, x, base - h - 30, 16, 16);
      d.lights.push([x + 8, base - h - 24, 26, '#ffb347']);
    }
    const sign = d.sign('-7000 m');
    ctx.drawImage(sign, ox - Math.floor(sign.width / 2), base - h - 10);
    d.lights.push([ox, base - 40, 46, '#ff6a3c']);
    d.lights.push([ox, base - 80, 30, '#ff8a4a']);
  }

  /** Flammengeister: kleine flackernde Flammen, die in Schleifen durch die Höhle tanzen. */
  private spirits(d: HellFrame, clipTop: number) {
    const { ctx, W, H, oy, time, calm } = d;
    const y0 = Math.floor((clipTop - oy) / 80) - 1;
    const y1 = Math.ceil((H - oy) / 80) + 1;
    for (let j = y0; j <= y1; j++) {
      const wy = j * 80 + hash(j, 62) * 40;
      if (wy < HELL_M * PPM + 20) continue;
      const m = wy / PPM;
      if (hash(j, 61) > (0.6 + 0.3 * hellW(m)) * sharedW(m, 'spirits')) continue;
      const side = hash(j, 63) < 0.5 ? -1 : 1;
      const t = calm ? 0 : time;
      const x = Math.round(d.ox + side * (20 + hash(j, 64) * (W / 2 - 30)) + Math.sin(t * 0.8 + j) * 14 + Math.sin(t * 0.37 + j * 3) * 9);
      const y = Math.round(wy + oy + Math.sin(t * 1.3 + j * 2) * 9 + Math.cos(t * 0.6 + j) * 5);
      if (y < clipTop || y > H) continue;
      const lvl = levelAt(m);
      const fl = calm ? 0 : Math.floor(t * 8 + j) % 2;
      ctx.drawImage(this.spiritS.get(lvl)![fl], x - 3, y - 4);
      d.lights.push([x, y, 10, PAL[lvl].flame[1]]);
    }
  }

  /** Tiefenschilder an Ketten (in der offenen Höhle gibt es keine Wand). */
  private signs(d: HellFrame) {
    const { ctx, H, ox, oy } = d;
    for (let m = HELL_M + 400; m < GATE_M + 40000; m += m < GATE_M ? 500 : 1000) {
      if (m === GATE_M) continue;
      const y = Math.round(m * PPM) + oy;
      if (y < -40) continue;
      if (y > H + 20) break;
      const s = d.sign(`-${m} m`);
      const x = ox + HW - s.width - 6;
      ctx.drawImage(this.chain, x + Math.floor(s.width / 2) - 3, y - 33);
      ctx.drawImage(s, x, y - 6);
    }
  }

  /** Vordergrund-Felsen an beiden Bildrändern (nur Hölle), ziehen schneller vorbei. */
  private foreground(d: HellFrame) {
    const Y = Math.round(d.anchorY - d.camY * FF);
    const dx = Math.round(d.camX * 0.35);
    this.blit(d, this.fg[0], -6 - dx, Y, false, true);
    this.blit(d, this.fg[1], d.W - FGW + 6 - dx, Y + 211, false, true);
  }

  /**
   * Übergang: Der Schacht endet, darunter öffnet sich die Höhle. Felsdecke mit
   * Zacken über die ganze Breite, im Schacht-Ausgang zwei Lavafälle.
   */
  private ceiling(d: HellFrame, top: number) {
    const { ctx, W, ox, time, calm } = d;
    if (!this.ceil) {
      // Felsdecke für wx = −256 … 255 einmal vorrechnen (Zeile 0 = top − 4)
      const rock = ['#2a0c0a', '#5a1c12', '#8a3418'];
      const [c, x] = canvas(512, 80);
      const drops: [number, number][] = [];
      const glows: number[] = [];
      for (let i = 0; i < 512; i++) {
        const wx = i - 256;
        const out = Math.max(0, Math.abs(wx) - HW);
        const jag = Math.round(10 + Math.min(26, out * 0.12) + Math.sin(wx * 0.11) * 4 + Math.sin(wx * 0.37) * 2 + hash(wx, 71) * 3);
        if (Math.abs(wx) < HW - 2) continue;
        x.fillStyle = rock[0];
        x.fillRect(i, 0, 1, jag + 4);
        x.fillStyle = (wx >> 2) % 5 === 0 ? rock[2] : rock[1];
        x.fillRect(i, jag + 1, 1, 2);
        x.fillStyle = '#120404';
        x.fillRect(i, jag + 3, 1, 1);
        if (hash(wx, 74) < 0.04) {
          x.fillStyle = '#ff8a2b';
          x.fillRect(i, 4 + Math.floor(hash(wx, 75) * jag), 1, 3);
          glows.push(wx);
        }
        if (hash(wx, 72) < 0.07) {
          const len = 6 + Math.floor(hash(wx, 73) * 16);
          for (let k = 0; k < len; k++) {
            x.fillStyle = k > len - 3 ? '#ffb347' : k > len - 5 ? rock[2] : rock[1];
            x.fillRect(i - (k < len / 2 ? 1 : 0), jag + k + 2, k < len / 2 ? 3 : 1, 1);
          }
          drops.push([wx, jag + len]);
        }
      }
      // Lavafälle als lange Streifen (3 Frames), unten ausgeblendet
      const falls = [0, 1, 2].map((fr) => {
        const [fc, fx] = canvas(16, 14 * 16);
        for (let k = 0; k < 14; k++) {
          fx.globalAlpha = k < 9 ? 1 : 1 - (k - 9) / 5;
          fx.drawImage(this.lavafall, fr * 16, 0, 16, 16, 0, k * 16, 16, 16);
        }
        return fc;
      });
      this.ceil = { img: c, drops, glows, falls };
    }
    const cl = this.ceil;
    ctx.drawImage(cl.img, ox - 256, top - 4);
    for (const wx of cl.glows) if (ox + wx >= 0 && ox + wx < W) d.lights.push([ox + wx, top + 6, 8, '#ff7a2b']);
    if (!calm) {
      ctx.fillStyle = '#ffd27a';
      for (const [wx, end] of cl.drops) {
        if (ox + wx < 0 || ox + wx >= W) continue;
        const t = mod(time * 0.7 + hash(wx, 76) * 3, 3);
        if (t < 1.6) ctx.fillRect(ox + wx, top + end + Math.round(t * t * 40), 1, 2);
      }
    }
    const fr = calm ? 0 : Math.floor(time * 8) % 3;
    for (const s of [-1, 1]) {
      const fx = ox + (s < 0 ? -HW - 2 : HW - 14);
      ctx.drawImage(cl.falls[fr], fx, top - 40);
      d.lights.push([fx + 8, top + 20, 30, '#ff7a2b']);
      d.lights.push([fx + 8, top + 90, 24, '#ff7a2b']);
    }
  }
}

function hexRgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendRgb(a: string, b: string, t: number): string {
  const pa = a.match(/\d+/g)!.map(Number);
  const pb = b.match(/\d+/g)!.map(Number);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
