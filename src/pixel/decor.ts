/**
 * Prozedurale Höhlen-Deko: viele Varianten aus einer Seed-Zahl (gleiche Stelle =
 * gleiches Objekt, verschiedene Stellen = verschieden). Alles auf transparentem
 * Grund, mit Facetten/Lichtkanten; gecacht.
 */
import { canvas, CRYSTAL_COLORS, lerpColor, SHROOM_COLORS, type Sprite } from './sprites';

/** Kleiner deterministischer Zufall (mulberry32). */
export function rng(seed: number) {
  let a = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Sprite>();
function cached(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) cache.set(key, (s = make()));
  return s;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Leichter Farbversatz für Abwechslung (Richtung Weiß bzw. Dunkel). */
function tint(c: string, t: number) {
  return t >= 0 ? lerpColor(c, '#ffffff', t) : lerpColor(c, '#000000', -t);
}

// ---------------------------------------------------------------- Kristalle

/**
 * Kristallgruppe: 1–5 Splitter unterschiedlicher Höhe/Breite/Neigung, mit
 * heller linker Facette, dunkler rechter Facette, Lichtkante und Spitzenglanz.
 * size 0 klein … 2 groß. Fuß unten (für Wände: drehen).
 */
export function crystalCluster(seed: number, size: 0 | 1 | 2, palette: number): Sprite {
  return cached(`cr-${seed}-${size}-${palette}`, () => {
    const r = rng(seed + size * 101 + palette * 7);
    const W = [12, 18, 26][size];
    const H = [12, 18, 28][size];
    const [c, ctx] = canvas(W, H);
    const base = CRYSTAL_COLORS[palette % CRYSTAL_COLORS.length];
    const shift = (r() - 0.5) * 0.25;
    const col = base.map((x) => tint(x, shift));
    const outline = tint(base[3], -0.45);
    const n = [1, 2, 3][size] + Math.floor(r() * (size + 2));
    const shards = Array.from({ length: n }, (_, i) => {
      const center = i === 0;
      return {
        x: W / 2 + (center ? (r() - 0.5) * 2 : (r() - 0.5) * (W - 6)),
        w: Math.max(2, Math.round((center ? 0.32 : 0.2) * W * (0.7 + r() * 0.5))),
        h: Math.round(H * (center ? 0.85 + r() * 0.15 : 0.35 + r() * 0.45)),
        lean: (r() - 0.5) * (center ? 0.4 : 1.3),
      };
    });
    // hintere (kleinere) zuerst, die große Mittlere zuletzt
    shards.sort((a, b) => a.h - b.h);
    for (const s of shards) {
      for (let i = 0; i < s.h; i++) {
        const y = H - 1 - i;
        const t = i / s.h;
        const half = t > 0.7 ? (s.w / 2) * Math.max(0, 1 - (t - 0.7) / 0.3) : s.w / 2;
        const mid = s.x + s.lean * i * 0.45;
        const x0 = Math.round(mid - half);
        const x1 = Math.round(mid + half);
        for (let x = x0; x <= x1; x++) {
          const rel = half < 0.5 ? 0 : (x - mid) / half;
          px(ctx, x, y, x === x1 && half >= 1 ? outline : rel < -0.4 ? col[1] : rel < 0.25 ? col[2] : col[3]);
        }
        // Lichtkante auf der linken Facette
        if (t > 0.1 && t < 0.85 && half >= 1.5) px(ctx, x0 + 1, y, col[0]);
      }
      // Spitzenglanz
      const tipX = s.x + s.lean * (s.h - 1) * 0.45;
      px(ctx, tipX, H - s.h, '#ffffff');
    }
    if (r() < 0.5) {
      // spiegeln für Abwechslung
      const [m, mctx] = canvas(W, H);
      mctx.translate(W, 0);
      mctx.scale(-1, 1);
      mctx.drawImage(c, 0, 0);
      return m;
    }
    return c;
  });
}

// ---------------------------------------------------------------- Pilze

/** Pilzgruppe: 1–3 Pilze mit gewölbtem Hut, Lamellen, Tupfen und Stiel mit Lichtseite. */
export function shroomCluster(seed: number, size: 0 | 1 | 2, palette: number): Sprite {
  return cached(`sh-${seed}-${size}-${palette}`, () => {
    const r = rng(seed * 3 + size * 31 + palette);
    const W = [12, 18, 24][size];
    const H = [12, 16, 22][size];
    const [c, ctx] = canvas(W, H);
    const col = SHROOM_COLORS[palette % SHROOM_COLORS.length].map((x) => tint(x, (r() - 0.5) * 0.2));
    const n = 1 + Math.floor(r() * (size + 1.6));
    const caps = Array.from({ length: n }, (_, i) => ({
      x: i === 0 ? W / 2 + (r() - 0.5) * 2 : 2 + r() * (W - 4),
      cw: Math.max(4, Math.round((i === 0 ? 0.65 : 0.35 + r() * 0.2) * W)),
      stem: Math.round((i === 0 ? 0.55 : 0.25 + r() * 0.25) * H),
    })).sort((a, b) => a.stem - b.stem);
    for (const m of caps) {
      const capH = Math.max(2, Math.round(m.cw * 0.42));
      const top = H - m.stem - capH;
      // Stiel
      const sw = Math.max(1, Math.round(m.cw * 0.22));
      for (let y = top + capH; y < H; y++) {
        px(ctx, m.x - sw / 2, y, '#cfe3dc', sw, 1);
        px(ctx, m.x + sw / 2 - 1, y, '#8aa69c');
      }
      // Hut
      for (let y = 0; y < capH; y++) {
        const half = Math.sqrt(1 - ((capH - y) / (capH + 0.5)) ** 2) * (m.cw / 2);
        for (let x = Math.round(m.x - half); x <= Math.round(m.x + half); x++) {
          const rel = (x - m.x) / Math.max(1, half);
          px(ctx, x, top + y, y === 0 || rel < -0.35 ? col[1] : rel > 0.5 ? tint(col[2], -0.25) : col[2]);
        }
      }
      // Lamellen (dunkler Saum unter dem Hut)
      px(ctx, m.x - m.cw / 2 + 1, top + capH, tint(col[2], -0.4), m.cw - 1, 1);
      // Tupfen und Glanz
      px(ctx, m.x - m.cw * 0.2, top + 1, col[0]);
      if (m.cw > 6) px(ctx, m.x + m.cw * 0.18, top + Math.max(1, capH - 2), col[0]);
    }
    return c;
  });
}

// ---------------------------------------------------------------- Erde & Fels

const BONE = ['#efe6cf', '#cbbf9f', '#8f8466', '#5a5242'];

/** Fossil: Ammonit, Knochen oder Muschel – eingebettet im Gestein. */
export function fossil(seed: number): Sprite {
  return cached(`fo-${seed}`, () => {
    const r = rng(seed * 5 + 11);
    const kind = Math.floor(r() * 3);
    if (kind === 0) {
      // Ammonit: Spirale
      const [c, ctx] = canvas(9, 9);
      for (let i = 0; i < 70; i++) {
        const a = i * 0.32;
        const rad = 0.4 + a * 0.55;
        if (rad > 4.2) break;
        px(ctx, 4 + Math.cos(a) * rad, 4 + Math.sin(a) * rad, i % 3 ? BONE[1] : BONE[2]);
      }
      px(ctx, 4, 4, BONE[3]);
      px(ctx, 2, 2, BONE[0]);
      return c;
    }
    if (kind === 1) {
      // Knochen
      const [c, ctx] = canvas(11, 5);
      px(ctx, 2, 2, BONE[1], 7, 1);
      px(ctx, 2, 1, BONE[0], 7, 1);
      for (const x of [0, 9]) {
        px(ctx, x, 0, BONE[1], 2, 2);
        px(ctx, x, 3, BONE[2], 2, 2);
      }
      px(ctx, 2, 3, BONE[2], 7, 1);
      return c;
    }
    // Muschel (Fächer)
    const [c, ctx] = canvas(9, 7);
    for (let y = 0; y < 6; y++) {
      const half = Math.round(Math.sqrt(Math.max(0, 1 - ((5 - y) / 6) ** 2)) * 4);
      for (let x = 4 - half; x <= 4 + half; x++) px(ctx, x, y, (x + y) % 2 ? BONE[1] : BONE[2]);
    }
    px(ctx, 3, 6, BONE[2], 3, 1);
    px(ctx, 3, 1, BONE[0], 2, 1);
    return c;
  });
}

/** 2–4 Steine mit Lichtkante, Farbton je Zone. */
export function pebbles(seed: number, tones: [string, string, string]): Sprite {
  return cached(`pe-${seed}-${tones[0]}`, () => {
    const r = rng(seed * 7 + 3);
    const [c, ctx] = canvas(14, 7);
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const w = 3 + Math.floor(r() * 4);
      const h = 2 + Math.floor(r() * 3);
      const x = Math.floor(r() * (14 - w));
      const y = 7 - h;
      px(ctx, x, y + 1, tones[1], w, h - 1);
      px(ctx, x + 1, y, tones[1], w - 2, 1);
      px(ctx, x + 1, y, tones[2], Math.max(1, w - 3), 1);
      px(ctx, x, y + h - 1, tones[0], w, 1);
    }
    return c;
  });
}

/** Regenwurm, leicht gekrümmt. */
export function worm(seed: number): Sprite {
  return cached(`wo-${seed}`, () => {
    const r = rng(seed * 13 + 1);
    const [c, ctx] = canvas(10, 5);
    const ph = r() * 6;
    for (let x = 0; x < 9; x++) px(ctx, x, 2 + Math.round(Math.sin(x * 0.8 + ph) * 1.4), x === 8 ? '#f4a3b0' : x % 3 ? '#d97a8a' : '#b85a6c');
    return c;
  });
}

/** Wurzelgeflecht, das aus der Erde hängt (oben angesetzt). */
export function roots(seed: number, len: number): Sprite {
  return cached(`ro-${seed}-${len}`, () => {
    const r = rng(seed * 17 + 5);
    const [c, ctx] = canvas(12, len);
    const strands = 1 + Math.floor(r() * 3);
    for (let s = 0; s < strands; s++) {
      let x = 2 + r() * 8;
      const l = Math.round(len * (0.5 + r() * 0.5));
      for (let y = 0; y < l; y++) {
        x += (r() - 0.5) * 0.9;
        px(ctx, x, y, y < 3 ? '#6e4a2c' : '#5a3b26');
        if (r() < 0.12) px(ctx, x + (r() < 0.5 ? -1 : 1), y + 1, '#4a2f1e');
      }
      px(ctx, x, l, '#8a6440');
    }
    return c;
  });
}

/** Ranke mit Blättern, hängt nach unten (transparent – statt Kachel mit dunklem Grund). */
export function vine(seed: number, len: number): Sprite {
  return cached(`vi-${seed}-${len}`, () => {
    const r = rng(seed * 19 + 9);
    const [c, ctx] = canvas(9, len);
    let x = 4;
    for (let y = 0; y < len; y++) {
      x += (r() - 0.5) * 0.7;
      px(ctx, x, y, '#2f6b2a');
      if (y % 3 === 1) {
        const side = r() < 0.5 ? -1 : 1;
        px(ctx, x + side, y, '#5d9f3a');
        px(ctx, x + side * 2, y + 1, '#7ec850');
      }
    }
    return c;
  });
}

// ---------------------------------------------------------------- Pilzgrotte

/**
 * Pilzgruppe auf einem Moospolster: 3–7 Pilze unterschiedlicher Größe, Polster mit
 * Lichtkante, Myzel-Fäden darunter. Fuß unten; für Wände drehen.
 */
export function shroomPatch(seed: number, palette: number): Sprite {
  return cached(`sp-${seed}-${palette}`, () => {
    const r = rng(seed * 29 + palette * 3 + 1);
    const W = 22 + Math.floor(r() * 8);
    const H = 20;
    const [c, ctx] = canvas(W, H);
    const col = SHROOM_COLORS[palette % SHROOM_COLORS.length].map((x) => tint(x, (r() - 0.5) * 0.18));
    // Myzel: feine helle Fäden unter dem Polster
    for (let f = 0; f < 4; f++) {
      let x = 3 + r() * (W - 6);
      for (let y = H - 4; y < H; y++) {
        x += (r() - 0.5) * 1.6;
        px(ctx, x, y, f % 2 ? '#a8d8c8' : '#7fb8a8');
      }
    }
    // Moospolster: flacher Hügel mit Lichtkante oben
    const moss = ['#0f3a32', '#1f6f5a', '#2f9f7a', '#6fd8a8'];
    for (let x = 0; x < W; x++) {
      const t = (x - W / 2) / (W / 2);
      const h = Math.max(1, Math.round((1 - t * t) * 5 + (r() - 0.5) * 1.5));
      const top = H - 4 - h;
      px(ctx, x, top, moss[3]);
      px(ctx, x, top + 1, moss[2], 1, Math.max(1, h - 2));
      px(ctx, x, top + h - 1, moss[1], 1, 2);
      px(ctx, x, H - 3, moss[0]);
    }
    // Pilze: größere hinten, kleine vorne
    const n = 3 + Math.floor(r() * 5);
    const shrooms = Array.from({ length: n }, () => ({ x: 2 + r() * (W - 4), s: r() })).sort((a, b) => b.s - a.s);
    for (const m of shrooms) {
      const cw = 3 + Math.round(m.s * 6);
      const stem = 2 + Math.round(m.s * 6);
      const capH = Math.max(2, Math.round(cw * 0.45));
      const t = (m.x - W / 2) / (W / 2);
      const ground = H - 4 - Math.max(1, Math.round((1 - t * t) * 5)) + 1;
      const top = ground - stem - capH;
      px(ctx, m.x - 0.5, top + capH, '#d8efe6', 1, stem);
      if (cw > 4) px(ctx, m.x + 0.5, top + capH, '#8aa69c', 1, stem);
      for (let y = 0; y < capH; y++) {
        const half = Math.sqrt(1 - ((capH - y) / (capH + 0.5)) ** 2) * (cw / 2);
        for (let x = Math.round(m.x - half); x <= Math.round(m.x + half); x++) {
          const rel = (x - m.x) / Math.max(1, half);
          px(ctx, x, top + y, y === 0 || rel < -0.3 ? col[1] : rel > 0.45 ? tint(col[2], -0.25) : col[2]);
        }
      }
      px(ctx, m.x - cw / 2 + 1, top + capH, tint(col[2], -0.45), cw - 1, 1);
      px(ctx, m.x - cw * 0.2, top + 1, col[0]);
    }
    return c;
  });
}

// ---------------------------------------------------------------- Steinzone

/** Spinnennetz für eine Ecke (oben an der Wand): dir 1 = Netz nach rechts, -1 = nach links. */
export function cobweb(seed: number, dir: 1 | -1): Sprite {
  return cached(`cw-${seed}-${dir}`, () => {
    const r = rng(seed * 37 + 2);
    const S = 10 + Math.floor(r() * 6);
    const [c, ctx] = canvas(S, S);
    ctx.globalAlpha = 0.55;
    const ox = dir > 0 ? 0 : S - 1;
    // Speichen
    for (const a of [0.15, 0.5, 0.85]) {
      for (let i = 0; i < S; i++) px(ctx, ox + dir * i * Math.cos(a * 1.4), i * Math.sin(a * 1.4) * 0.9, '#d8d8e8');
    }
    // Querfäden
    for (const rad of [S * 0.35, S * 0.65, S * 0.9]) {
      for (let a = 0.1; a < 1.45; a += 0.08) px(ctx, ox + dir * rad * Math.cos(a), rad * Math.sin(a) * 0.9, '#c0c0d4');
    }
    return c;
  });
}
