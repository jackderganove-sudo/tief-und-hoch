/**
 * Die Hölle: Unter der Lava öffnet sich der Schacht in eine riesige Höhle.
 * Verspielt statt gruselig – Basalt- und Obsidiansäulen, Feuerseen auf Simsen,
 * glühende Runen, Ketten, Schwefeldampf, kleine Teufelchen, die winken,
 * Flammengeister. Bei 7.000 m steht das Höllentor; darunter geht es endlos weiter
 * (Eis-Hölle, Kristall-Hölle, Abgrund – gleiche Bauteile, andere Farben).
 *
 * Koordinaten wie in world.ts: x = 0 ist das Seil, y = Meter × PPM.
 * Hintergrund-Ebenen mit Parallaxe f < 1 (ferne Säulen ziehen langsamer vorbei).
 */
import type { Images } from './assets';
import { crystalCluster } from './decor';
import { canvas, lerpColor, rampMap, recolor, type Sprite } from './sprites';
import { caveZoneAt, GATE_M, HELL_M, type CaveZone } from './zones';

const PPM = 0.5;
const HW = 48;

type Level = 'hell' | 'icehell' | 'crystalhell' | 'abyss';

interface Palette {
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

const PAL: Record<Level, Palette> = {
  hell: {
    bg: ['#2a0a22', '#160614'],
    far: ['#1c0818', '#3a1230'],
    col: ['#140610', '#2e1028', '#5a2246', '#ff6a3c'],
    lake: ['#5a0c08', '#a8240e', '#e2541e', '#ff9a3c', '#ffe28a'],
    rune: '#ff5a8a',
    flame: ['#fff1b0', '#ffb347', '#ff5a2b'],
    imp: ['#1a0606', '#5a0c0c', '#c21e1e', '#ff6a4a', '#ffe08a'],
    steam: ['#3a4a10', '#7a8a20', '#b8c84a', '#e8f08a', '#f8ffd0'],
  },
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
    bg: ['#100820', '#04020a'],
    far: ['#0a0614', '#1c1230'],
    col: ['#06040c', '#140e22', '#2e2248', '#7a5aff'],
    lake: ['#140830', '#3a1a80', '#6a40d0', '#a888ff', '#e0d8ff'],
    rune: '#8a6aff',
    flame: ['#e0d8ff', '#a888ff', '#6a40d0'],
    imp: ['#06040c', '#1e1440', '#4a3a90', '#9a88e0', '#f0ecff'],
    steam: ['#2a2240', '#4a3e6a', '#7a6aa0', '#b0a4d0', '#e0dcf0'],
  },
};

const LEVELS: Level[] = ['hell', 'icehell', 'crystalhell', 'abyss'];
const levelAt = (m: number): Level => {
  const z = caveZoneAt(Math.max(m, HELL_M + 1));
  return (LEVELS as CaveZone[]).includes(z) ? (z as Level) : 'hell';
};

/** Ebene(n) an einer Tiefe mit Überblendanteil der unteren Ebene (±200 m um jede Grenze). */
function levelBlend(m: number): { a: Level; b: Level; t: number } {
  const a = levelAt(m - 200);
  const b = levelAt(m + 200);
  if (a === b) return { a, b, t: 0 };
  const edge = m < GATE_M + 1000 ? GATE_M : GATE_M + Math.round((m - GATE_M) / 2000) * 2000;
  return { a, b, t: Math.max(0, Math.min(1, (m - (edge - 200)) / 400)) };
}

const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mod = (n: number, m: number) => ((n % m) + m) % m;

export type Light = [number, number, number, string?];

interface Drawn {
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

export class HellRenderer {
  private lava = new Map<Level, Sprite>();
  private imp = new Map<Level, Sprite>();
  private steam = new Map<Level, Sprite>();
  private torch = new Map<Level, Sprite>();
  private runes = new Map<Level, Sprite>();
  private columns = new Map<string, Sprite>();
  private lavafall: Sprite;
  private chain: Sprite;

  constructor(img: Images) {
    this.lavafall = img['hell/lavafall'] as unknown as Sprite;
    this.chain = img['hell/chain'] as unknown as Sprite;
    for (const l of LEVELS) {
      const p = PAL[l];
      this.lava.set(l, l === 'hell' ? (img['hell/lavatile'] as unknown as Sprite) : recolor(img['hell/lavatile'], rampMap(p.lake)));
      this.imp.set(l, l === 'hell' ? (img['hell/imp'] as unknown as Sprite) : recolor(img['hell/imp'], rampMap(p.imp)));
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
    }
  }

  /** Basaltsäule als kachelbares Stück (sechseckige Segmente, Randlicht auf einer Seite). */
  private column(l: Level, w: number, rimLeft: boolean): Sprite {
    const key = `${l}-${w}-${rimLeft}`;
    let s = this.columns.get(key);
    if (s) return s;
    const [dark, mid, light, rim] = PAL[l].col;
    const [c, x] = canvas(w, 48);
    x.fillStyle = mid;
    x.fillRect(0, 0, w, 48);
    // senkrechte Facetten
    x.fillStyle = dark;
    x.fillRect(Math.floor(w * 0.66), 0, Math.ceil(w * 0.34), 48);
    x.fillStyle = light;
    x.fillRect(Math.floor(w * 0.18), 0, 2, 48);
    // Segmentfugen (Basalt bricht in Blöcken)
    for (const sy of [0, 17, 33]) {
      x.fillStyle = dark;
      x.fillRect(0, sy, w, 1);
      x.fillStyle = light;
      x.fillRect(1, sy + 1, Math.floor(w * 0.6), 1);
    }
    // Randlicht von den Feuerseen
    x.fillStyle = rim;
    x.globalAlpha = 0.55;
    x.fillRect(rimLeft ? 0 : w - 1, 0, 1, 48);
    x.globalAlpha = 1;
    x.fillStyle = '#000000';
    x.fillRect(rimLeft ? w - 1 : 0, 0, 1, 48);
    this.columns.set(key, (s = c));
    return s;
  }

  draw(d: Drawn) {
    const { ctx, W, H, oy } = d;
    const top = Math.round(HELL_M * PPM + oy);
    if (top >= H) return;
    const clipTop = Math.max(0, top);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, W, H - clipTop);
    ctx.clip();
    this.background(d, clipTop);
    this.farLayer(d, clipTop);
    this.midLayer(d, clipTop);
    this.gate(d);
    this.spirits(d, clipTop);
    this.signs(d);
    ctx.restore();
    if (top > -60) this.ceiling(d, top);
  }

  /** Riesenhöhle: Farbverlauf in Bändern, je Ebene getönt, weich überblendet. */
  private background(d: Drawn, clipTop: number) {
    const { ctx, W, H, oy } = d;
    for (let y = clipTop; y < H; y += 2) {
      const m = (y - oy) / PPM;
      const lb = levelBlend(m);
      const t = (Math.sin(m * 0.0018) + 1) / 2;
      const ca = lerpColor(PAL[lb.a].bg[0], PAL[lb.a].bg[1], t);
      const cb = lerpColor(PAL[lb.b].bg[0], PAL[lb.b].bg[1], t);
      const dither = ((y >> 1) & 1) * 0.12 - 0.06;
      ctx.fillStyle = lb.t === 0 ? ca : blendRgb(ca, cb, Math.max(0, Math.min(1, lb.t + dither)));
      ctx.fillRect(0, y, W, 2);
    }
  }

  /** Bildschirm-Koordinaten einer Parallax-Ebene. */
  private layer(d: Drawn, f: number) {
    return {
      sx: (lx: number) => Math.round(d.W / 2 + (lx - d.camX) * f),
      sy: (ly: number) => Math.round(d.anchorY + (ly - d.camY) * f),
      ly: (sy: number) => (sy - d.anchorY) / f + d.camY,
    };
  }

  /** Ferne Säulen als Silhouetten, mit dunklem Glühen. */
  private farLayer(d: Drawn, clipTop: number) {
    const { ctx, W, H } = d;
    const f = 0.35;
    const L = this.layer(d, f);
    const span = 46;
    const k0 = Math.floor((d.camX - W / f) / span);
    for (let k = k0; k < k0 + Math.ceil((W * 2.2) / f / span) + 2; k++) {
      const x = L.sx(k * span + hash(k, 1) * 26);
      const w = hash(k, 2) < 0.2 ? 26 + Math.floor(hash(k, 4) * 20) : 6 + Math.floor(hash(k, 2) * 10);
      if (x + w < 0 || x > W) continue;
      for (let y = clipTop - mod(clipTop - L.sy(0), 24); y < H; y += 24) {
        const lb = levelBlend((y + 12 - d.oy) / PPM);
        const p = PAL[lb.t > 0.5 ? lb.b : lb.a];
        for (const [lvl, alpha] of [
          [lb.a, 1],
          [lb.b, lb.t],
        ] as [Level, number][]) {
          if (alpha <= 0) continue;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = PAL[lvl].far[0];
          ctx.fillRect(x, y, w, 24);
          ctx.fillStyle = PAL[lvl].far[1];
          ctx.fillRect(x, y, 1, 24);
        }
        ctx.globalAlpha = 1;
        // hin und wieder ein glimmendes Fenster
        const seg = Math.floor(L.ly(y) / 24);
        if (hash(k * 31 + seg, 3) < 0.07) {
          ctx.fillStyle = p.lake[2];
          ctx.fillRect(x + 2, y + 9, Math.max(2, w - 5), 2);
        }
      }
    }
  }

  /** Obsidiansäulen mit Runen, Simsen, Feuerseen, Teufelchen, Fackeln, Dampf und Ketten. */
  private midLayer(d: Drawn, clipTop: number) {
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
        const sag = 10 + (x1 - x0) * 0.12;
        const p = PAL[levelAt(ly / PPM)];
        for (let x = x0; x < x1; x += 2) {
          const t = (x - x0) / (x1 - x0);
          const yy = Math.round(y + sag * 4 * t * (1 - t));
          ctx.fillStyle = (x >> 1) & 1 ? p.col[2] : p.col[1];
          ctx.fillRect(x, yy, 2, 1);
          ctx.fillStyle = p.col[0];
          ctx.fillRect(x, yy + 1, 2, 1);
        }
      }
    }

    for (const { k, x, w } of cols) {
      if (x + w + 40 < 0 || x - 40 > W) continue;
      const rimLeft = x + w / 2 > W / 2;
      // Säule in 48-px-Stücken, Farbe je Ebene
      const start = clipTop - mod(clipTop - L.sy(0), 48);
      for (let y = start; y < H; y += 48) {
        const lb = levelBlend((y + 24 - d.oy) / PPM);
        ctx.drawImage(this.column(lb.a, w, rimLeft), x, y);
        if (lb.t > 0) {
          ctx.globalAlpha = lb.t;
          ctx.drawImage(this.column(lb.b, w, rimLeft), x, y);
          ctx.globalAlpha = 1;
        }
      }
      // Runen auf der Säule, pulsierend
      for (let j = Math.floor(ly0 / 70); j <= Math.ceil(ly1 / 70); j++) {
        if (hash(k * 13 + j, 31) > 0.4) continue;
        const ly = j * 70 + hash(k, j) * 30;
        const y = L.sy(ly);
        if (y < clipTop || y > H) continue;
        const lvl = levelAt(ly / PPM);
        const g = Math.floor(hash(k * 7 + j, 32) * 128);
        const pulse = calm ? 1 : 0.55 + 0.45 * Math.sin(time * 2 + j + k);
        ctx.globalAlpha = pulse;
        ctx.drawImage(this.runes.get(lvl)!, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, x + Math.floor(w / 2) - 4, y, 8, 8);
        ctx.globalAlpha = 1;
        d.lights.push([x + Math.floor(w / 2), y + 4, 9, PAL[lvl].rune]);
      }
      // Simse mit Feuersee
      for (let j = Math.floor(ly0 / STEP) - 1; j <= Math.ceil(ly1 / STEP) + 1; j++) {
        if (hash(k * 5 + j, 41) > 0.7) continue;
        const ly = j * STEP + hash(k * 3 + j, 42) * 120;
        if (ly < HELL_M * PPM + 40) continue;
        const y = L.sy(ly);
        if (y < clipTop - 40 || y > H + 20) continue;
        const lvl = levelAt(ly / PPM);
        const p = PAL[lvl];
        const left = hash(k + j, 43) < 0.5;
        const sw = 30 + Math.floor(hash(k + j, 44) * 14);
        const sx = left ? x - sw + 4 : x + w - 4;
        // Felsplatte
        ctx.fillStyle = p.col[1];
        ctx.fillRect(sx, y, sw, 5);
        ctx.fillStyle = p.col[2];
        ctx.fillRect(sx, y, sw, 1);
        ctx.fillStyle = p.col[0];
        ctx.fillRect(sx + 2, y + 5, sw - 4, 2);
        ctx.fillRect(sx + 6, y + 7, sw - 12, 2);
        // Feuersee in der Mulde (animiert)
        const frame = calm ? 0 : Math.floor(time * 10 + k) % 45;
        const lw = sw - 10;
        ctx.drawImage(this.lava.get(lvl)!, frame * 16, 0, Math.min(16, lw), 3, sx + 5, y - 2, Math.min(16, lw), 3);
        if (lw > 16) ctx.drawImage(this.lava.get(lvl)!, ((frame + 7) % 45) * 16, 0, lw - 16, 3, sx + 21, y - 2, lw - 16, 3);
        ctx.fillStyle = p.lake[4];
        if (!calm && hash(k * 9 + j, Math.floor(time * 2)) < 0.3) ctx.fillRect(sx + 5 + Math.floor(hash(j, Math.floor(time * 2)) * lw), y - 2, 1, 1);
        d.lights.push([sx + sw / 2, y - 2, 16 + Math.floor(sw / 3), p.lake[3]]);
        // Dampf steigt auf
        if (!calm) {
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
        if (hash(k + j, 45) < 0.5) {
          const tf = calm ? 0 : Math.floor(time * 10 + j) % 8;
          const tx = left ? sx : sx + sw - 16;
          ctx.drawImage(this.torch.get(lvl)!, tf * 16, 0, 16, 16, tx, y - 16, 16, 16);
          d.lights.push([tx + 8, y - 10, 14, p.flame[1]]);
        }
        // Teufelchen auf dem Sims – winkt, wenn die Figur vorbeikommt
        if (hash(k * 2 + j, 46) < 0.55) {
          const near = Math.abs(y - d.explorerY) < 70;
          const wave = !calm && near && Math.floor(time * 4 + k) % 2 === 1;
          const ix = left ? sx + sw - 22 : sx + 6;
          const bob = calm ? 0 : Math.round(Math.sin(time * 3 + k + j) * 0.6);
          ctx.drawImage(this.imp.get(lvl)!, wave ? 18 : 0, 0, 18, 20, ix, y - 19 + bob, 18, 20);
        }
        // Kette hängt vom Sims herab
        if (hash(k * 4 + j, 47) < 0.3) {
          const cx = left ? sx + 3 : sx + sw - 5;
          for (let cy = y + 7; cy < y + 7 + 27 * 2; cy += 27) ctx.drawImage(this.chain, cx, cy);
        }
      }
      // Kristall-Hölle: Kristalle wachsen aus den Säulen
      void k;
    }
    void crystalCluster;
  }

  /** Höllentor bei 7.000 m: Säulen mit Runen, Bogen mit Hörnern, glühende Torflügel, Feuerschalen. */
  private gate(d: Drawn) {
    const { ctx, ox, oy, H, time, calm } = d;
    const base = Math.round(GATE_M * PPM + oy) + 28; // Schwelle knapp unter der Figur bei 7.000 m
    if (base < -10 || base - 150 > H) return;
    const p = PAL.hell;
    const pw = 16;
    const half = 52;
    const h = 108;
    // glühende Torflügel (Hintergrund des Durchgangs)
    for (let y = base - h + 18; y < base; y++) {
      const t = (y - (base - h + 18)) / (h - 18);
      ctx.fillStyle = lerpColor('#5a0c18', '#ff6a3c', Math.min(1, t * 1.2));
      ctx.fillRect(ox - half + pw, y, (half - pw) * 2, 1);
    }
    // Torspalt und Beschläge
    ctx.fillStyle = '#2a0610';
    ctx.fillRect(ox - 1, base - h + 18, 2, h - 18);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(ox + s * 14 - 1, base - 80 + i * 18, 3, 3);
      }
    }
    // Säulen
    for (const s of [-1, 1]) {
      const x = ox + (s < 0 ? -half : half - pw);
      for (let y = base - h; y < base; y += 48) ctx.drawImage(this.column('hell', pw, s > 0), 0, 0, pw, Math.min(48, base - y), x, y, pw, Math.min(48, base - y));
      // Runen
      for (let i = 0; i < 4; i++) {
        const pulse = calm ? 1 : 0.6 + 0.4 * Math.sin(time * 2.5 + i + s);
        ctx.globalAlpha = pulse;
        const g = 40 + i * 7 + (s > 0 ? 3 : 0);
        ctx.drawImage(this.runes.get('hell')!, (g % 32) * 8, Math.floor(g / 32) * 8, 8, 8, x + 4, base - h + 20 + i * 20, 8, 8);
        ctx.globalAlpha = 1;
      }
      // Feuerschale auf der Säule
      const tf = calm ? 0 : Math.floor(time * 10 + s) % 8;
      ctx.drawImage(this.torch.get('hell')!, tf * 16, 0, 16, 16, x, base - h - 30, 16, 16);
      d.lights.push([x + 8, base - h - 24, 26, '#ffb347']);
    }
    // Bogen mit zwei verspielten Hörnern
    ctx.fillStyle = p.col[0];
    ctx.fillRect(ox - half - 4, base - h - 14, half * 2 + 8, 14);
    ctx.fillStyle = p.col[2];
    ctx.fillRect(ox - half - 4, base - h - 14, half * 2 + 8, 2);
    ctx.fillStyle = p.col[1];
    ctx.fillRect(ox - half - 2, base - h - 11, half * 2 + 4, 9);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const hx = ox + s * (half - 6 + Math.round(Math.sin(i * 0.25) * 6 + i * 0.6));
        const hy = base - h - 14 - i * 2;
        ctx.fillStyle = i > 9 ? '#fff1b0' : i > 6 ? '#e8d8c0' : '#c8b8a0';
        ctx.fillRect(hx - (i < 6 ? 2 : 1), hy, i < 6 ? 4 : 2, 2);
      }
    }
    // Schild „7000 m“ und Lichter
    const sign = d.sign('-7000 m');
    ctx.drawImage(sign, ox - Math.floor(sign.width / 2), base - h - 10);
    d.lights.push([ox, base - 40, 46, '#ff6a3c']);
    d.lights.push([ox, base - 80, 30, '#ff8a4a']);
  }

  /** Flammengeister: kleine flackernde Flammen, die durch die Höhle treiben. */
  private spirits(d: Drawn, clipTop: number) {
    const { ctx, W, H, oy, time, calm } = d;
    const y0 = Math.floor((clipTop - oy) / 80) - 1;
    const y1 = Math.ceil((H - oy) / 80) + 1;
    for (let j = y0; j <= y1; j++) {
      if (hash(j, 61) > 0.6) continue;
      const wy = j * 80 + hash(j, 62) * 40;
      if (wy < HELL_M * PPM + 20) continue;
      const side = hash(j, 63) < 0.5 ? -1 : 1;
      const x = Math.round(d.ox + side * (20 + hash(j, 64) * (W / 2 - 30)) + (calm ? 0 : Math.sin(time * 0.8 + j) * 10));
      const y = Math.round(wy + oy + (calm ? 0 : Math.sin(time * 1.3 + j * 2) * 6));
      if (y < clipTop || y > H) continue;
      const p = PAL[levelAt(wy / PPM)];
      const fl = calm ? 0 : Math.floor(time * 8 + j) % 2;
      ctx.fillStyle = p.flame[2];
      ctx.fillRect(x - 1, y - 2, 3, 4);
      ctx.fillStyle = p.flame[1];
      ctx.fillRect(x - 1 + fl, y - 4, 2, 4);
      ctx.fillStyle = p.flame[0];
      ctx.fillRect(x, y - 1, 1, 2);
      // Augen – freundlich
      ctx.fillStyle = '#2a0a1a';
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      d.lights.push([x, y, 10, p.flame[1]]);
    }
  }

  /** Tiefenschilder an Ketten (in der offenen Höhle gibt es keine Wand). */
  private signs(d: Drawn) {
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

  /**
   * Übergang: Der Schacht endet, darunter öffnet sich die Höhle. Felsdecke mit
   * Zacken über die ganze Breite, im Schacht-Ausgang zwei Lavafälle.
   */
  private ceiling(d: Drawn, top: number) {
    const { ctx, W, ox, time, calm } = d;
    // Lavagestein wie in der Zone darüber: dunkel, mittel, hell, Glut
    const rock = ['#2a0c0a', '#5a1c12', '#8a3418'];
    for (let x = 0; x < W; x++) {
      const wx = x - ox;
      // am Schachtausgang dünner, nach außen dicker – wie eine Höhlendecke
      const out = Math.max(0, Math.abs(wx) - HW);
      const jag = Math.round(10 + Math.min(26, out * 0.12) + Math.sin(wx * 0.11) * 4 + Math.sin(wx * 0.37) * 2 + hash(wx, 71) * 3);
      if (Math.abs(wx) < HW - 2) continue;
      ctx.fillStyle = rock[0];
      ctx.fillRect(x, top - 4, 1, jag + 4);
      ctx.fillStyle = (wx >> 2) % 5 === 0 ? rock[2] : rock[1];
      ctx.fillRect(x, top + jag - 3, 1, 2);
      ctx.fillStyle = '#120404';
      ctx.fillRect(x, top + jag - 1, 1, 1);
      // Glutadern in der Decke
      if (hash(wx, 74) < 0.04) {
        ctx.fillStyle = '#ff8a2b';
        ctx.fillRect(x, top + Math.floor(hash(wx, 75) * jag), 1, 3);
        d.lights.push([x, top + 6, 8, '#ff7a2b']);
      }
      // Tropfsteine, an deren Spitze Lava glüht
      if (hash(wx, 72) < 0.07) {
        const len = 6 + Math.floor(hash(wx, 73) * 16);
        for (let i = 0; i < len; i++) {
          ctx.fillStyle = i > len - 3 ? '#ffb347' : i > len - 5 ? rock[2] : rock[1];
          ctx.fillRect(x - (i < len / 2 ? 1 : 0), top + jag + i - 2, i < len / 2 ? 3 : 1, 1);
        }
        // Lavatropfen fällt
        if (!calm) {
          const t = mod(time * 0.7 + hash(wx, 76) * 3, 3);
          if (t < 1.6) {
            ctx.fillStyle = '#ffd27a';
            ctx.fillRect(x, top + jag + len + Math.round(t * t * 40), 1, 2);
          }
        }
      }
    }
    // Lavafälle an beiden Kanten des Schachtausgangs
    const fall = this.lavafall;
    const fr = calm ? 0 : Math.floor(time * 8) % 3;
    for (const s of [-1, 1]) {
      const fx = ox + (s < 0 ? -HW - 2 : HW - 14);
      for (let i = 0; i < 14; i++) {
        const y = top - 40 + i * 16;
        ctx.globalAlpha = i < 9 ? 1 : 1 - (i - 9) / 5;
        ctx.drawImage(fall, fr * 16, 0, 16, 16, fx, y, 16, 16);
      }
      ctx.globalAlpha = 1;
      d.lights.push([fx + 8, top + 20, 30, '#ff7a2b']);
      d.lights.push([fx + 8, top + 90, 24, '#ff7a2b']);
    }
  }
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blendRgb(a: string, b: string, t: number): string {
  const pa = a.match(/\d+/g)!.map(Number);
  const pb = b.match(/\d+/g)!.map(Number);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
