/**
 * Lebendiger Himmel: Böen mit Windlinien (auch vor dem Ballon), Wolken im Vordergrund,
 * Vögel weichen aus oder landen auf dem Korb, Flugzeug mit Kondensstreifen, Engelchen
 * drehen eine Runde um den Ballon, Turbulenz in der Wolkendecke, Antippen.
 * Schnittstelle: interact.ts. Aufgerufen von world.ts.
 *
 * Alles wird beim Laden vorgezeichnet; pro Bild nur wenige Blits (≈ 10–60 Aufrufe).
 */
import type { Images } from './assets';
import { Px, bayer, contrailSprite, cumulus, type HeavenRenderer } from './heaven';
import type { FxFrame, Gust, Interact, Rect } from './interact';
import { birdSprites, flipX, fromRows, planeSprite, type Sprite } from './sprites';
import { DECK_M, GATE_M, HEAVEN_M } from './zones';

const PPM = 0.5;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const sgn = () => (Math.random() < 0.5 ? -1 : 1) as -1 | 1;

/** Farbsätze nach Höhe: Tag, Abendrot, Nacht, Himmel (Gold), Polarlicht. */
type Tint = 0 | 1 | 2 | 3 | 4;
const LINE_COLORS = ['#ffffff', '#fff0f4', '#b8c8f0', '#d8a050', '#9af0d0'];
function tintAt(m: number): Tint {
  if (m < 3700) return 0;
  if (m < 4600) return 1;
  if (m < DECK_M) return 2;
  if (m < HEAVEN_M) return 1;
  if (m < GATE_M) return 3;
  if (m < GATE_M + 2000) return 0;
  return 4;
}

/** Böen je Sekunde nach Höhe (Höhenwind am meisten, im Weltraum keine Luft). */
function gustRate(m: number) {
  if (m < 150) return 0.03;
  if (m < 2500) return 1 / 13;
  if (m < 3700) return 1 / 5;
  if (m < DECK_M) return 1 / 13;
  if (m < HEAVEN_M) return 1 / 7;
  if (m < GATE_M + 4000) return 1 / 14;
  return 0;
}

// ---------------------------------------------------------------- Sprites (nur beim Laden)

/** Windlinie (Kopf rechts): leicht gewellt, nach hinten blasser, optional mit Schnörkel. */
function windLine(len: number, curl: boolean, double: boolean, color: string): Sprite {
  const px = new Px(len + 9, 11);
  const y0 = 5;
  for (let x = 0; x < len; x++) {
    const t = x / len;
    const a = 0.12 + 0.75 * t;
    if (t < 0.3 && bayer(x, 0) > t * 3) continue; // Schwanz zerfasert
    const y = y0 + Math.round(Math.sin(x * 0.18) * 0.8);
    px.set(x, y, color, a);
    if (double && x > len * 0.35 && x < len * 0.85) px.set(x - 6, y + 3, color, a * 0.6);
  }
  if (curl)
    for (let i = 0; i <= 14; i++) {
      const ang = (i / 14) * Math.PI * 1.7;
      px.set(len + Math.sin(ang) * 3.5, y0 - (3.5 - Math.cos(ang) * 3.5), color, 0.85);
    }
  return px.sprite();
}

/** Luftwirbel: kleine Spirale, vier Drehstufen. */
function swirlFrames(color: string): Sprite[] {
  return [0, 1, 2, 3].map((fr) => {
    const px = new Px(13, 11);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const ang = t * Math.PI * 3.2 + (fr * Math.PI) / 2;
      const r = 1 + t * 4.5;
      px.set(6 + Math.cos(ang) * r * 1.15, 5 + Math.sin(ang) * r * 0.85, color, 0.25 + 0.65 * t);
    }
    return px.sprite();
  });
}

/** Wölkchen beim Antippen: wächst und löst sich auf (4 Stufen). */
function puffFrames(pal: string[]): Sprite[] {
  return [0, 1, 2, 3].map((fr) => {
    const R = 4 + fr * 2;
    const S = R * 2 + 6;
    const px = new Px(S, S);
    const blobs: [number, number, number][] = [
      [S / 2, S / 2 + 1, R * 0.7],
      [S / 2 - R * 0.55, S / 2 + 2, R * 0.5],
      [S / 2 + R * 0.55, S / 2 + 2, R * 0.55],
      [S / 2 + 1, S / 2 - R * 0.35, R * 0.5],
    ];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let inside = -1;
        for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 <= br * br) inside = Math.max(inside, 1 - Math.hypot(x - bx, y - by) / br);
        if (inside < 0) continue;
        if (bayer(x, y) < fr * 0.22) continue; // löst sich auf
        const tone = y < S / 2 - 1 ? 0 : y < S / 2 + R * 0.4 ? 1 : 2;
        px.set(x, y, pal[tone]);
      }
    return px.sprite();
  });
}

/** Funkeln (Stern mit vier Strahlen), 4 Stufen: aufblitzen, verglimmen. */
function sparkFrames(color: string): Sprite[] {
  return [3, 2, 1, 0].map((r) => {
    const px = new Px(9, 9);
    px.set(4, 4, '#ffffff');
    for (let k = 1; k <= r; k++) {
      const a = 1 - k / (r + 1.5);
      px.set(4 + k, 4, color, a);
      px.set(4 - k, 4, color, a);
      px.set(4, 4 + k, color, a);
      px.set(4, 4 - k, color, a);
    }
    if (r >= 2) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) px.set(4 + dx, 4 + dy, color, 0.5);
    return px.sprite();
  });
}

/** Weicher Nebelballen (Wolkendecke um den Ballon): Bayer-gestuft nach außen durchsichtig. */
function fogSprite(w: number, h: number, pal: string[]): Sprite {
  const px = new Px(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) + Math.sin(x * 0.21 + y * 0.13) * 0.06;
      if (d >= 1) continue;
      const a = 1 - d;
      if (bayer(x, y) > a * 1.6) continue;
      const tone = y < h * 0.35 ? 0 : y < h * 0.7 ? 1 : 2;
      px.set(x, y, pal[tone], 0.45 + a * 0.4);
    }
  return px.sprite();
}

const BIRD_PAL = { k: '#2b2438', w: '#4a3f5e', y: '#e8a040' };
/** Vogel von der Seite (Blick nach rechts): Flügel oben, Flügel unten, sitzend. */
function sideBird(): Sprite[] {
  return [
    fromRows(['..w....', '..ww.kk', 'kkkkkky', '..kk...', '.......'], BIRD_PAL),
    fromRows(['.......', '.....kk', 'kkkkkky', '..ww...', '..w....'], BIRD_PAL),
    fromRows(['....kk.', '...kkky', 'kkwwkk.', '.kwwkk.', '...y.y.'], BIRD_PAL),
  ];
}

// ---------------------------------------------------------------- Zustände

interface FlockBird {
  dx: number;
  dy: number;
  ody: number;
  vy: number;
  vx: number;
  ph: number;
}
interface Flock {
  x: number;
  base: number; // Bildschirm-y relativ zur Ballonmitte
  dir: -1 | 1;
  speed: number;
  birds: FlockBird[];
  scared: boolean;
}
interface Lander {
  phase: 'in' | 'sit' | 'out';
  t: number;
  side: -1 | 1;
  x: number;
  y: number;
  sx: number;
  sy: number;
  stay: number;
  waved: boolean;
  vx: number;
  vy: number;
}
interface Plane {
  x: number;
  y: number;
  dir: -1 | 1;
  start: number;
  gone: number;
}
interface FgCloud {
  s: Sprite;
  x: number;
  m: number;
  vx: number;
  a: number;
  base: number;
}
interface Drop {
  x: number;
  y: number;
  vy: number;
  life: number;
}
interface TapFx {
  frames: Sprite[];
  x: number;
  y: number;
  t: number;
  dur: number;
}

export class SkyFx {
  private lines: Sprite[][][]; // [Tint][Variante][0 rechts, 1 links]
  private swirls: Sprite[][];
  private puffs: Sprite[][];
  private sparks: Sprite[][];
  private fogs: Sprite[];
  private birds = birdSprites();
  private side: Sprite[][]; // [0 rechts, 1 links][Bild]
  private plane: Sprite[];
  private trail: Sprite[];
  private clouds: Sprite[][]; // [Farbsatz][Größe]

  private flocks: Flock[] = [];
  private lander: Lander | null = null;
  private planeEv: Plane | null = null;
  private fg: FgCloud | null = null;
  private drops: Drop[] = [];
  private tapFx: TapFx[] = [];
  private hitSwirls: { x: number; y: number; dir: number; t: number; tint: Tint }[] = [];
  private seen = new WeakSet<Gust>();
  private angelWaveAt = -1;
  private angelWaveDir: -1 | 1 = 1;
  private nextAngel = 6;
  private time = 0;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _img: Images,
    private heaven?: HeavenRenderer,
  ) {
    const variants: [number, boolean, boolean][] = [
      [28, true, false],
      [46, false, true],
      [62, true, false],
      [38, false, false],
    ];
    this.lines = LINE_COLORS.map((c) =>
      variants.map(([len, curl, dbl]) => {
        const s = windLine(len, curl, dbl, c);
        return [s, flipX(s)];
      }),
    );
    this.swirls = LINE_COLORS.map((c) => swirlFrames(c));
    this.puffs = [
      ['#ffffff', '#eef7ff', '#cfe6fa'],
      ['#fff0e0', '#f6c0c8', '#d692b8'],
      ['#c8d0f0', '#9aa4d8', '#707ab8'],
      ['#fffaf0', '#fff1d0', '#ffd9a0'],
      ['#ffffff', '#e0f8f0', '#a0e0d0'],
    ].map((p) => puffFrames(p));
    this.sparks = ['#ffffff', '#ffe9b8', '#ffe28a', '#ffd070', '#9af0e0', '#9ad8ff'].map((c) => sparkFrames(c));
    this.fogs = [
      fogSprite(150, 104, ['#7a6aa8', '#6a5a98', '#5a4a88']),
      fogSprite(150, 104, ['#f6d0d8', '#e0a8c0', '#c890b0']),
      fogSprite(150, 104, ['#fff6e0', '#ffe2b0', '#f6c890']),
    ];
    const sb = sideBird();
    this.side = [sb, sb.map((s) => flipX(s))];
    const pl = planeSprite();
    this.plane = [pl, flipX(pl)];
    const tr = contrailSprite(170, 4);
    this.trail = [tr, flipX(tr)];
    const pals = [
      ['#ffffff', '#f2f8ff', '#dcecfa', '#c0d8f0', '#a8c4e6'], // Tag
      ['#fff0d8', '#ffd0b0', '#f4a8a8', '#d888a8', '#a8689e'], // Abendrot
      ['#3e3866', '#332e5a', '#2a264e', '#221e42', '#1a1736'], // Nacht: Silhouette
      ['#fffaf0', '#fff1d0', '#ffe2b0', '#f6cc98', '#e8b484'], // Himmel
      ['#ffffff', '#f2f0ff', '#dcdcfa', '#c2c8f0', '#a8b2e6'], // Perlmutt
    ];
    this.clouds = pals.map((p, i) => [cumulus(1300 + i, 120, p, 0.4), cumulus(1310 + i, 160, p, 0.55)]);
  }

  // ================================================================ hinter dem Ballon

  /** Hinter dem Ballon (nach dem ganzen Himmel). */
  back(f: FxFrame) {
    const dt = Math.min(0.1, f.dt);
    this.time = f.time;
    const ix = f.ix;
    const b = ix.balloonAnchor;
    const m = f.altitude;
    if (b) {
      this.spawn(f, dt, b, m);
      this.taps(f, b, m);
      this.deck(f, dt, m);
      this.angelEvents(f, b);
    }
    this.updateFlocks(f, dt, b);
    this.updateLander(f, dt, b);
    this.updateHits(f);
    this.drawPlane(f, dt);
    this.drawGusts(f, false);
    this.drawFlocks(f, false);
  }

  /** Vor dem Ballon (ganz zuletzt). Nicht über UI-Flächen (f.ix.avoid) zeichnen. */
  front(f: FxFrame) {
    const dt = Math.min(0.1, f.dt);
    this.drawGusts(f, true);
    this.drawFlocks(f, true);
    this.drawLander(f);
    this.drawHitSwirls(f);
    this.drawFog(f, dt);
    this.drawFg(f, dt);
    this.drawTapFx(f);
  }

  // ---------------------------------------------------------------- Ereignisse

  private spawn(f: FxFrame, dt: number, b: NonNullable<Interact['balloonAnchor']>, m: number) {
    const ix = f.ix;
    const chance = (r: number, d: number) => ix.chance(r, d);
    if (f.calm) return; // ohne Bewegung: keine Böen, Schwärme, Wolken im Vordergrund
    const cy = b.y - 36;
    // Böe: mal genau auf den Ballon, mal darüber/darunter vorbei
    const rate = gustRate(m);
    if (rate > 0 && chance(rate, dt)) {
      const windy = m >= 2500 && m < 3700;
      const dir: -1 | 1 = windy && Math.random() < 0.8 ? 1 : sgn();
      const aim = Math.random() < 0.55;
      const y = clamp(Math.round(aim ? cy + rnd(-5, 5) : cy + sgn() * rnd(30, 90)), 16, f.H - 16);
      ix.wind.add({
        y,
        x: dir > 0 ? -20 : f.W + 20,
        vx: dir * (windy ? rnd(100, 150) : rnd(70, 110)),
        h: Math.round(rnd(22, 32)),
        strength: windy ? rnd(0.45, 0.9) : m >= DECK_M && m < HEAVEN_M ? rnd(0.3, 0.6) : rnd(0.2, 0.55),
        front: Math.random() < 0.6,
        seed: tintAt(m) * 1000 + Math.floor(Math.random() * 1000),
      });
    }
    // Vogelschwarm kreuzt auf Ballonhöhe (Wiese bis Höhenwind)
    if (m > 120 && m < 3000 && this.flocks.length < 2 && chance(1 / 16, dt)) {
      const dir = sgn();
      const n = 3 + Math.floor(Math.random() * 3);
      this.flocks.push({
        x: dir > 0 ? -10 : f.W + 10,
        base: Math.round(rnd(-50, 30)),
        dir,
        speed: rnd(28, 40),
        scared: false,
        birds: Array.from({ length: n }, (_, i) => ({ dx: i * 9 + rnd(0, 3), dy: Math.round(((i * 5) % 9) - 4 + rnd(-1, 1)), ody: 0, vy: 0, vx: 0, ph: Math.random() * 2 })),
      });
    }
    // ein Vogel landet auf dem Korbrand
    if (!this.lander && m > 150 && m < 2600 && chance(1 / 32, dt)) {
      const side = sgn();
      this.lander = { phase: 'in', t: 0, side, x: side < 0 ? -10 : f.W + 10, y: b.y - 90, sx: side < 0 ? -10 : f.W + 10, sy: b.y - 90, stay: rnd(4, 6.5), waved: false, vx: 0, vy: 0 };
    }
    // Flugzeug mit Kondensstreifen über dem Ballon
    if (!this.planeEv && m > 1300 && m < 4300 && chance(1 / 45, dt)) {
      const dir = sgn();
      this.planeEv = { x: dir > 0 ? -16 : f.W + 1, y: Math.round(clamp(b.y - rnd(110, 170), 10, f.H)), dir, start: dir > 0 ? -16 : f.W + 1, gone: 0 };
    }
    // Wolke zieht vor dem Ballon vorbei
    if (!this.fg && m > 600 && m < GATE_M + 4000 && chance(1 / 28, dt)) {
      const t = m < 3700 ? 0 : m < 4600 ? 1 : m < DECK_M ? 2 : m < GATE_M ? 3 : m < GATE_M + 2000 ? 4 : 2;
      const s = this.clouds[t][Math.random() < 0.5 ? 0 : 1];
      const dir = sgn();
      const yTarget = cy + rnd(-30, 40) - s.height / 2;
      // Weltlage mit Parallaxe 1.6: zieht beim Steigen schneller vorbei als der Hintergrund
      const mm = ((f.anchorY - yTarget) / 1.6 + f.camY) / PPM;
      this.fg = { s, x: dir > 0 ? -s.width : f.W, m: mm, vx: dir * rnd(30, 44), a: 0, base: t === 2 ? 0.7 : 0.55 };
    }
  }

  /** Wolkendecke (5.300–5.500 m): Turbulenz, Nebel um den Ballon, Feuchtigkeit. */
  private deck(f: FxFrame, dt: number, m: number) {
    const w = clamp((m - 5220) / 90) * clamp((5580 - m) / 80);
    if (w <= 0 || f.calm) return;
    const ix = f.ix;
    if (ix.chance(2.4 * w, dt)) ix.balloon.push(sgn() * rnd(8, 18));
    if (ix.chance(0.3 * w, dt) && !ix.balloon.busy) ix.balloon.react('hold', 0.8, sgn());
    for (const r of ix.crew) if (ix.chance(1.6 * w, dt)) r.push(sgn() * rnd(6, 14));
    const b = ix.balloonAnchor;
    if (b && this.drops.length < 18 && Math.random() < dt * 22 * w)
      this.drops.push({ x: b.x + Math.round(rnd(-48, 48)), y: b.y - Math.round(rnd(20, 100)), vy: rnd(45, 80), life: rnd(0.5, 0.9) });
  }

  /** Engelchen: ab und zu eine Runde um den Ballon, danach winken (Passagier winkt zurück). */
  private angelEvents(f: FxFrame, b: NonNullable<Interact['balloonAnchor']>) {
    const h = this.heaven;
    if (!h) return;
    const camM = -f.camY / PPM;
    if (h.angelVis(camM) < 0.8) return;
    if (this.angelWaveAt > 0 && f.time >= this.angelWaveAt) {
      f.ix.balloon.react('wave', 1.1, this.angelWaveDir);
      this.angelWaveAt = -1;
    }
    if (f.calm || h.angelFx[0] || h.angelFx[1]) return;
    if (f.time > this.nextAngel && f.ix.chance(1 / 12, f.dt)) {
      const i = Math.random() < 0.5 ? 0 : 1;
      const dur = 4.8;
      h.angelFx[i] = { kind: 'loop', t0: f.time, dur };
      this.angelWaveAt = f.time + dur * 0.86;
      this.angelWaveDir = i ? 1 : -1;
      this.nextAngel = f.time + dur + 6;
    }
    void b;
  }

  // ---------------------------------------------------------------- Antippen

  private taps(f: FxFrame, b: NonNullable<Interact['balloonAnchor']>, m: number) {
    const ix = f.ix;
    if (!ix.taps.some((t) => !t.used)) return;
    // Vogel auf dem Korb fliegt auf
    const L = this.lander;
    if (L && ix.takeTap({ x: L.x - 6, y: L.y - 6, w: 19, h: 17 })) this.scareLander(L);
    // Schwarm: Vögel flattern auf
    for (const fl of this.flocks) {
      if (fl.scared) continue;
      for (const bd of fl.birds) {
        const [x, y] = this.birdPos(fl, bd, b);
        if (ix.takeTap({ x: x - 7, y: y - 7, w: 21, h: 18 })) {
          this.scareFlock(fl);
          break;
        }
      }
    }
    // Kristallinsel klingt
    const h = this.heaven;
    if (h)
      for (const c of h.crystalHits) {
        const t = ix.takeTap({ x: c.x - 3, y: c.y - 3, w: c.w + 6, h: c.h + 6 });
        if (t) {
          h.chime(c.j, f.time);
          this.addTap(this.sparks[4], t.x, t.y, 0.5);
        }
      }
    // Engelchen winken
    const camM = -f.camY / PPM;
    if (h && h.angelVis(camM) > 0.5) {
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        const r: Rect = { x: b.x + s * 42 - 17 - 12, y: b.y - 104 + i * 26 - 8, w: 34 + 24, h: 43 + 16 };
        if (!h.angelFx[i] && ix.takeTap(r)) this.angelWave(f, i);
      }
    }
    // Wolke im Vordergrund pustet
    const fg = this.fg;
    if (fg) {
      const y = this.fgY(f, fg);
      const t = ix.takeTap({ x: fg.x + 8, y: y + 6, w: fg.s.width - 16, h: fg.s.height - 6 });
      if (t) {
        this.addTap(this.puffs[tintAt(m)], t.x - 8, t.y - 8, 0.6);
        fg.vx *= 1.6;
      }
    }
    // sonst: kleine Reaktion an der Stelle, passend zur Höhe
    const t = ix.takeTap({ x: 0, y: 0, w: f.W, h: f.H });
    if (!t) return;
    if (m >= HEAVEN_M && m < GATE_M + 600 && h) {
      this.addTap(this.sparks[3], t.x - 4, t.y - 4, 0.6);
      // nächstes Engelchen winkt
      const i = t.x > b.x ? 1 : 0;
      if (!h.angelFx[i] && h.angelVis(camM) > 0.5) this.angelWave(f, i);
    } else if (m >= 2500 && m < 3700) this.addTap(this.swirls[0], t.x - 6, t.y - 5, 0.7, true);
    else if ((m >= 4600 && m < DECK_M) || m >= GATE_M + 2000) this.addTap(this.sparks[m < DECK_M ? 1 : 0], t.x - 4, t.y - 4, 0.6);
    else if (m >= GATE_M) this.addTap(this.sparks[5], t.x - 4, t.y - 4, 0.6);
    else {
      const p = this.puffs[tintAt(m)];
      this.addTap(p, t.x - p[0].width / 2, t.y - p[0].height / 2, 0.7);
    }
  }

  private angelWave(f: FxFrame, i: number) {
    const h = this.heaven;
    if (!h) return;
    h.angelFx[i] = { kind: 'wave', t0: f.time, dur: 1.5 };
    this.angelWaveAt = f.time + 0.35;
    this.angelWaveDir = i ? 1 : -1;
  }

  private addTap(frames: Sprite[], x: number, y: number, dur: number, spin = false) {
    if (this.tapFx.length >= 6) this.tapFx.shift();
    // Wirbel drehen sich zweimal, Wölkchen/Funkeln laufen einmal durch
    this.tapFx.push({ frames: spin ? [...frames, ...frames] : frames, x: Math.round(x), y: Math.round(y), t: this.time, dur });
  }

  // ---------------------------------------------------------------- Böen

  private drawGusts(f: FxFrame, front: boolean) {
    const { ctx, ix } = f;
    for (const g of ix.wind.gusts) {
      const tint = Math.floor(g.seed / 1000) as Tint;
      if (tint < 0 || tint > 4) continue;
      if (front && !g.front) continue;
      const dir = g.vx >= 0 ? 0 : 1;
      const n = 3 + (g.seed % 2);
      const a = Math.min(1, g.age / 0.3) * (0.7 + 0.3 * g.strength) * (f.calm ? 0.6 : 1);
      for (let k = 0; k < n; k++) {
        // vorn nur die mittleren Linien (streichen über den Ballon), hinten die übrigen
        if ((g.front && k % 2 === 1) !== front) continue;
        const s = this.lines[tint][(g.seed + k) % 4][dir];
        const lag = k * 14 + Math.round(hash(g.seed, k) * 10);
        const head = dir ? g.x + lag : g.x - lag;
        const x = Math.round(dir ? head : head - s.width);
        const y = Math.round(g.y + (hash(g.seed, k + 9) - 0.5) * g.h * 0.8 + Math.sin(g.age * 4 + k) * 1.5) - 5;
        if (x > f.W || x + s.width < 0) continue;
        if (front && ix.overUi({ x, y, w: s.width, h: s.height })) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(s, x, y);
      }
      // kräftige Böen: Wirbel an der Vorderkante
      if (!front && g.strength > 0.5) {
        const sw = this.swirls[tint][Math.floor(g.age * 10) % 4];
        ctx.globalAlpha = a * 0.8;
        ctx.drawImage(sw, Math.round(g.x - (dir ? -4 : 16)), Math.round(g.y + (hash(g.seed, 3) - 0.5) * g.h * 0.6) - 5);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Böe trifft den Ballon (world.ts stößt ihn an): Luft wirbelt an der Hülle. */
  private updateHits(f: FxFrame) {
    const b = f.ix.balloonAnchor;
    for (const g of f.ix.wind.gusts) {
      if (this.seen.has(g) || !g.hit?.has(-1)) continue;
      this.seen.add(g);
      if (!b || f.calm) continue;
      const tint = Math.floor(g.seed / 1000) as Tint;
      const dir = g.vx >= 0 ? 1 : -1;
      if (this.hitSwirls.length < 4) {
        this.hitSwirls.push({ x: b.x + dir * 14, y: b.y - 62, dir, t: f.time, tint });
        if (g.strength > 0.4) this.hitSwirls.push({ x: b.x + dir * 4, y: b.y - 30, dir, t: f.time + 0.12, tint });
      }
    }
  }

  private drawHitSwirls(f: FxFrame) {
    const { ctx, ix } = f;
    this.hitSwirls = this.hitSwirls.filter((s) => f.time - s.t < 0.8);
    for (const s of this.hitSwirls) {
      const t = f.time - s.t;
      if (t < 0) continue;
      const x = Math.round(s.x + s.dir * t * 40) - 6;
      const y = Math.round(s.y - t * 6) - 5;
      if (ix.overUi({ x, y, w: 13, h: 11 })) continue;
      ctx.globalAlpha = 1 - t / 0.8;
      ctx.drawImage(this.swirls[s.tint][Math.floor(t * 12) % 4], x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Vögel

  private birdPos(fl: Flock, bd: FlockBird, b: Interact['balloonAnchor']): [number, number] {
    const cy = b ? b.y - 36 : 200;
    return [Math.round(fl.x - fl.dir * bd.dx + bd.vx), Math.round(cy + fl.base + bd.dy + bd.ody)];
  }

  private scareFlock(fl: Flock) {
    fl.scared = true;
    for (const bd of fl.birds) {
      bd.vy = -rnd(35, 60);
      bd.vx = 0;
    }
  }

  private updateFlocks(f: FxFrame, dt: number, b: Interact['balloonAnchor']) {
    for (const fl of this.flocks) {
      fl.x += fl.dir * fl.speed * (fl.scared ? 1.5 : 1) * dt;
      for (const bd of fl.birds) {
        if (fl.scared) {
          bd.ody += bd.vy * dt;
          bd.vx += fl.dir * rnd(-10, 25) * dt;
          continue;
        }
        if (!b) continue;
        // ausweichen: aus einer Ellipse um die Hülle (samt Korb) nach oben bzw. unten
        const [x] = this.birdPos(fl, bd, b);
        const ex = x + 3 - b.x;
        const ey0 = b.y - 36 + fl.base + bd.dy - (b.y - 40);
        const k = clamp(1 - (Math.abs(ex) - 18) / 34);
        const want = (ey0 >= 0 ? 1 : -1) * Math.max(0, 46 - Math.abs(ey0)) * k;
        bd.ody += (want - bd.ody) * Math.min(1, dt * 5);
      }
    }
    this.flocks = this.flocks.filter((fl) => fl.x > -120 && fl.x < f.W + 120 && !(fl.scared && fl.birds.every((bd) => this.birdPos(fl, bd, b)[1] < -10)));
  }

  private drawFlocks(f: FxFrame, front: boolean) {
    const { ctx, ix } = f;
    const b = ix.balloonAnchor;
    for (const fl of this.flocks)
      fl.birds.forEach((bd, i) => {
        if ((i % 2 === 1) !== front) return;
        const [x, y] = this.birdPos(fl, bd, b);
        if (front && ix.overUi({ x, y, w: 7, h: 4 })) return;
        const fast = fl.scared || Math.abs(bd.ody) > 4;
        const fr = f.calm ? 0 : Math.floor(f.time * (fast ? 12 : 6) + bd.ph) % 2;
        ctx.drawImage(this.birds[fr], x, y);
      });
  }

  private scareLander(L: Lander) {
    if (L.phase === 'out') return;
    L.phase = 'out';
    L.t = 0;
    L.vx = -L.side * rnd(35, 50);
    L.vy = -rnd(30, 45);
  }

  /** Landeplatz auf dem Korbrand (Korb pendelt beim Neigen leicht gegen die Hülle). */
  private perch(f: FxFrame, L: Lander): [number, number] {
    const b = f.ix.balloonAnchor!;
    const x = b.basket.x + (L.side < 0 ? -1 : b.basket.w - 6) + Math.round(f.ix.balloon.swing * -0.3);
    return [x, b.basket.y - 5];
  }

  private updateLander(f: FxFrame, dt: number, b: Interact['balloonAnchor']) {
    const L = this.lander;
    if (!L) return;
    L.t += dt;
    const ix = f.ix;
    if (!b && L.phase !== 'out') this.scareLander(L);
    if (L.phase === 'in') {
      const [px, py] = this.perch(f, L);
      const u = clamp(L.t / 2.6);
      const e = 1 - (1 - u) * (1 - u);
      // Bogen: erst etwas höher, dann von oben auf den Rand
      L.x = L.sx + (px - L.sx) * e;
      L.y = L.sy + (py - L.sy) * e - Math.sin(Math.PI * u) * 14;
      if (u >= 1) {
        L.phase = 'sit';
        L.t = 0;
        ix.balloon.react('look', 1.4, L.side);
      }
    } else if (L.phase === 'sit') {
      [L.x, L.y] = this.perch(f, L);
      if (!L.waved && L.t > 1.3) {
        L.waved = true;
        ix.balloon.react('wave', 1.2, L.side);
      }
      // Brenner oder kräftiges Schaukeln verscheucht ihn
      if (ix.balloon.burner > 0.3 || Math.abs(ix.balloon.swing) > 2.5 || L.t > L.stay) this.scareLander(L);
    } else {
      L.x += L.vx * dt;
      L.y += L.vy * dt;
      L.vy -= 8 * dt;
      if (L.x < -20 || L.x > f.W + 20 || L.y < -20) this.lander = null;
    }
  }

  private drawLander(f: FxFrame) {
    const L = this.lander;
    if (!L) return;
    const { ctx, ix } = f;
    const x = Math.round(L.x);
    const y = Math.round(L.y);
    if (ix.overUi({ x, y, w: 7, h: 5 })) return;
    // Blick: beim Anflug zum Korb, sitzend zur Ballonmitte, beim Abflug davon weg
    const face = L.phase === 'out' ? (L.vx > 0 ? 0 : 1) : L.side < 0 ? 0 : 1;
    const set = this.side[face];
    if (L.phase === 'sit') {
      const hop = !f.calm && Math.floor(L.t * 2.5) % 5 === 3 ? -1 : 0;
      ctx.drawImage(set[2], x, y + hop);
    } else ctx.drawImage(set[f.calm ? 0 : Math.floor(f.time * (L.phase === 'in' && L.t > 2.2 ? 4 : 11)) % 2], x, y);
  }

  // ---------------------------------------------------------------- Flugzeug

  private drawPlane(f: FxFrame, dt: number) {
    const p = this.planeEv;
    if (!p) return;
    const { ctx } = f;
    const out = p.dir > 0 ? p.x > f.W + 4 : p.x < -20;
    if (out) p.gone += dt;
    p.x += p.dir * 46 * dt;
    if (p.gone > 3) {
      this.planeEv = null;
      return;
    }
    const tr = this.trail[p.dir > 0 ? 0 : 1];
    const L = Math.min(tr.width, Math.round(Math.abs(p.x - p.start)));
    const px = Math.round(p.x);
    ctx.globalAlpha = 1 - p.gone / 3;
    if (L > 1) {
      const ty = p.y + 3 - Math.floor(tr.height / 2) + 1;
      if (p.dir > 0) ctx.drawImage(tr, tr.width - L, 0, L, tr.height, px - L + 2, ty, L, tr.height);
      else ctx.drawImage(tr, 0, 0, L, tr.height, px + 13, ty, L, tr.height);
    }
    ctx.globalAlpha = 1;
    if (!out) ctx.drawImage(this.plane[p.dir > 0 ? 0 : 1], px, p.y);
  }

  // ---------------------------------------------------------------- Vordergrund

  private fgY(f: FxFrame, c: FgCloud) {
    return Math.round(f.anchorY - (c.m * PPM + f.camY) * 1.6);
  }

  private drawFg(f: FxFrame, dt: number) {
    const c = this.fg;
    if (!c) return;
    const { ctx, ix } = f;
    c.x += c.vx * dt;
    const y = this.fgY(f, c);
    const r = { x: Math.round(c.x), y, w: c.s.width, h: c.s.height };
    if (r.x > f.W + 4 || r.x + r.w < -4 || y > f.H + 40 || y + r.h < -60) {
      if ((c.vx > 0 && r.x > f.W) || (c.vx < 0 && r.x + r.w < 0) || y > f.H + 40 || y + r.h < -60) this.fg = null;
      return;
    }
    // über UI-Flächen fast ausblenden, bei Fragen dezenter
    const target = ix.overUi(r) ? 0.1 : c.base * (ix.quiet ? 0.6 : 1);
    c.a += (target - c.a) * Math.min(1, dt * 3);
    if (c.a < 0.03) return;
    ctx.globalAlpha = c.a;
    ctx.drawImage(c.s, r.x, y);
    ctx.globalAlpha = 1;
  }

  /** In der Wolkendecke: Nebel hüllt den Ballon kurz ein, Tröpfchen ziehen vorbei. */
  private drawFog(f: FxFrame, dt: number) {
    const { ctx, ix } = f;
    const b = ix.balloonAnchor;
    const m = f.altitude;
    const w = clamp((m - 5220) / 90) * clamp((5580 - m) / 80);
    if (b && w > 0) {
      const fog = this.fogs[m < 5340 ? 0 : m < 5450 ? 1 : 2];
      const breathe = f.calm ? 1 : 0.85 + 0.15 * Math.sin(f.time * 0.8);
      const x = Math.round(b.x - fog.width / 2 + (f.calm ? 0 : Math.sin(f.time * 0.3) * 6));
      const y = Math.round(b.y - 40 - fog.height / 2);
      const r = { x, y, w: fog.width, h: fog.height };
      ctx.globalAlpha = 0.75 * w * breathe * (ix.overUi(r) ? 0.25 : 1);
      ctx.drawImage(fog, x, y);
      ctx.globalAlpha = 1;
    }
    if (!this.drops.length) return;
    ctx.fillStyle = '#eef4ff';
    for (const d of this.drops) {
      d.y += d.vy * dt;
      d.life -= dt;
      if (d.life <= 0) continue;
      ctx.globalAlpha = Math.min(0.85, d.life * 2);
      ctx.fillRect(d.x, Math.round(d.y), 1, 2);
    }
    ctx.globalAlpha = 1;
    this.drops = this.drops.filter((d) => d.life > 0);
  }

  private drawTapFx(f: FxFrame) {
    const { ctx } = f;
    this.tapFx = this.tapFx.filter((t) => f.time - t.t < t.dur);
    for (const t of this.tapFx) {
      const u = (f.time - t.t) / t.dur;
      const s = t.frames[f.calm ? 0 : Math.min(t.frames.length - 1, Math.floor(u * t.frames.length))];
      ctx.drawImage(s, t.x, t.y - (f.calm ? 0 : Math.round(u * 3)));
    }
  }
}
