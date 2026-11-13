/**
 * Der Himmel über den Sternen: Der Ballon steigt durch eine leuchtende Wolkendecke,
 * darüber goldene und weiße Wolkeninseln, ein schwebender Tempel, Säulenruinen,
 * Regenbogenbrücken, Lichtstrahlen und Engelchen, die mitfliegen. Bei 7.000 m das
 * Himmelstor. Darüber endlos: Kristallwolken, Polarlicht, Weltraum mit Planeten.
 *
 * Koordinaten wie in world.ts: y = Bildschirm über at(m, f) (Höhe in Metern, Parallax f).
 */
import type { Images } from './assets';
import { crystalCluster, rng } from './decor';
import { canvas, flipX, fromRows, planeSprite, rampMap, recolor, type Sprite } from './sprites';
import { DECK_M, GATE_M, HEAVEN_M } from './zones';

const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export interface SkyFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Bildschirm-y eines Objekts in m Metern Höhe auf einer Ebene mit Parallaxe f */
  at: (m: number, f: number) => number;
  /** Kamerahöhe in Metern */
  camM: number;
  camX: number;
  time: number;
  calm: boolean;
  /** Bildschirm-x des Ballons und seine Höhe (Engelchen fliegen mit) */
  balloonX: number;
  balloonY: number;
  bottom: number;
  sign: (text: string) => Sprite;
  buoy: Sprite;
}

function flipY(src: CanvasImageSource & { width: number; height: number }): Sprite {
  const [c, x] = canvas(src.width, src.height);
  x.translate(0, src.height);
  x.scale(1, -1);
  x.drawImage(src, 0, 0);
  return c;
}

/** Untere Kante eines Bildes weich ausblenden (Wolkendecke statt massiver Block). */
function fadeBottom(src: Sprite, keep: number): Sprite {
  const [c, x] = canvas(src.width, keep);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  for (let y = keep - 40; y < keep; y += 2) {
    x.globalAlpha = (y - (keep - 40)) / 40;
    x.fillRect(0, y, src.width, 2);
  }
  return c;
}

/** Säulen in heaven/columns: [x, Breite] – jede steht mit Sockel auf der Unterkante (y 96). */
const COLUMN_CROPS: [number, number][] = [
  [93, 16],
  [109, 16],
  [141, 16],
  [173, 16],
  [189, 16],
  [125, 16],
];

/** Farben der abbröckelnden Splitter (aus den Kristallpaletten). */
const CRUMB = ['#9ad8ff', '#f0b0ff', '#9af0e0', '#c8c0ff'];

const GOLD = ['#7a5a2a', '#c89a4a', '#f0d08a', '#fff2c8', '#ffffff'];
const CRYSTAL = ['#4a5a9a', '#7a9ad8', '#b8d4ff', '#e6f2ff', '#ffffff'];

export class HeavenRenderer {
  private islandBig: Sprite;
  private islandSmall: Sprite;
  private rocks: Sprite[];
  private deck: Sprite;
  private deckCrystal: Sprite;
  private temple: Sprite;
  private columns: Sprite;
  private angel: Sprite;
  private angelWave: Sprite[];
  private angelWaveL: Sprite[];
  private space: Record<string, HTMLImageElement>;
  private spaceFlip: Sprite;
  private starsFlip: Sprite;
  private planets: HTMLImageElement;
  private rainbow = new Map<number, Sprite>();
  private shards: Sprite[];
  private isles: Sprite[];
  private islesFar: Sprite[];
  private nacre: Sprite[];
  private fan: Sprite;
  /** Wolkenpolster, auf dem der Kristall im Lichtfächer wächst. */
  private pad: Sprite;
  private halo: Sprite;

  constructor(img: Images) {
    const gold = rampMap(GOLD);
    this.islandBig = recolor(img['heaven/island-big'], gold);
    this.islandSmall = recolor(img['heaven/island-small'], gold);
    this.rocks = [recolor(img['heaven/rock-a'], gold), recolor(img['heaven/rock-b'], gold)];
    // Wolkendecke: Gold von unten durchleuchtet
    this.deck = fadeBottom(recolor(img['heaven/clouds'], rampMap(['#e8b070', '#ffd9a0', '#fff1d0', '#fffaf0', '#ffffff'])), 120);
    this.deckCrystal = fadeBottom(recolor(img['heaven/clouds'], rampMap(CRYSTAL)), 110);
    this.temple = recolor(img['heaven/temple'], rampMap(['#6a5030', '#b89058', '#ead2a0', '#fff6dc', '#ffffff']));
    this.columns = recolor(img['heaven/columns'], rampMap(['#7a6a50', '#c8b898', '#f0e6d0', '#fffaf0', '#ffffff']));
    this.angel = img['heaven/angel'] as unknown as Sprite;
    this.angelWave = [0, 1].map((t) => angelWaveSprite(img['heaven/angel'], t));
    this.angelWaveL = this.angelWave.map((s) => flipX(s));
    this.space = {
      background: img['space/background'],
      stars: img['space/stars'],
      far: img['space/far-planets'],
      ring: img['space/ring-planet'],
      big: img['space/big-planet'],
    };
    this.planets = img['space/planets'];
    // Hintergrund ist nur waagerecht kachelbar → jede zweite Reihe gespiegelt, keine Nahtkanten
    this.spaceFlip = flipY(img['space/background']);
    this.starsFlip = flipY(img['space/stars']);
    this.shards = [0, 1, 2].map((k) => crystalCluster(500 + k * 17, 1, k));
    this.isles = [crystalIsland(1, 62), crystalIsland(2, 84), crystalIsland(3, 46), crystalIsland(4, 70)];
    // ferne Ebene: kleiner und im Himmelsblau verdunstet
    this.islesFar = [crystalIsland(5, 40, '#cfe0ff'), crystalIsland(6, 54, '#cfe0ff'), crystalIsland(7, 34, '#cfe0ff'), crystalIsland(8, 46, '#cfe0ff')];
    // Perlmuttwolken: pastellweiß, am oberen Saum schillernd in Spektralfarben
    const pearl = ['#ffffff', '#f2f0ff', '#dcdcfa', '#c2c8f0', '#a8b2e6'];
    this.nacre = [41, 42, 43].map((sd, i) =>
      cloudBank(sd, 240, 30 + i * 4, pearl, 'top', true, (x, y, d) => {
        if (d > 5) return null;
        const k = Math.floor(((x * 0.5 + y * 2 + d * 3) % 36) / 6);
        return d < 1 ? '#ffffff' : mix(pearl[1], SPECTRUM[k], 0.4 - d * 0.05);
      }),
    );
    this.fan = prismFanSprite();
    this.pad = cloudPad(77, 26);
    this.halo = haloSprite(48);
  }

  /** Hinter dem Ballon. */
  back(f: SkyFrame) {
    if (f.camM < DECK_M - 900) return;
    this.space_(f);
    this.aurora(f);
    this.rays(f);
    this.crystals(f);
    this.deckLayer(f, 0.85, 0.9);
    this.islands(f);
    this.gate(f);
    this.signs(f);
    this.angels(f, false);
  }

  /** Vor dem Ballon: Wolkendecke zum Durchfliegen, Engelchen. */
  front(f: SkyFrame) {
    if (f.camM < DECK_M - 900) return;
    this.deckLayer(f, 1.12, 0.8);
    this.angels(f);
    this.lightBeings(f);
  }

  /** Leuchtende Wolkendecke über dem Sternenhimmel (5.300–5.500 m) und Kristallwolken (7.000–9.000 m). */
  private deckLayer(f: SkyFrame, par: number, alpha: number) {
    const { ctx, W, bottom } = f;
    for (const [m, img] of [
      [DECK_M + 60, this.deck],
      [GATE_M + 600, this.deckCrystal],
      [GATE_M + 1400, this.deckCrystal],
    ] as [number, Sprite][]) {
      const y = f.at(m, par) - 60;
      if (y > bottom || y + img.height < 0) continue;
      const off = mod(Math.round(-f.camX * par * 0.3 + (f.calm ? 0 : f.time * 3 * par)), img.width);
      ctx.globalAlpha = alpha;
      for (let x = off - img.width; x < W; x += img.width) ctx.drawImage(img, x, y);
      ctx.globalAlpha = 1;
    }
  }

  /** Goldene Lichtstrahlen schräg von oben (über der Wolkendecke bis zum Tor). */
  private rays(f: SkyFrame) {
    const s = clamp((f.camM - (DECK_M - 200)) / 500) * clamp((GATE_M + 800 - f.camM) / 600);
    if (s <= 0) return;
    const { ctx, W, bottom, time, calm } = f;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x0 = Math.round(W * (0.1 + i * 0.22) + (calm ? 0 : Math.sin(time * 0.2 + i) * 8));
      const w = 10 + (i % 3) * 6;
      ctx.globalAlpha = s * (0.06 + 0.03 * Math.sin(time * 0.5 + i));
      // ein vorgezeichneter schräger Streifen statt ~200 fillRects je Strahl
      const ray = this.raySprite(w);
      const h = Math.min(bottom, ray.height);
      if (h > 0) ctx.drawImage(ray, 0, 0, ray.width, h, x0, 0, ray.width, h);
    }
    ctx.restore();
  }

  private rays_ = new Map<number, Sprite>();
  private raySprite(w: number): Sprite {
    let r = this.rays_.get(w);
    if (r) return r;
    const H = 1024;
    const [c, x] = canvas(w + Math.round(H * 0.35) + 1, H);
    x.fillStyle = '#ffe8a8';
    for (let y = 0; y < H; y += 2) x.fillRect(Math.round(y * 0.35), y, w, 2);
    this.rays_.set(w, (r = c));
    return r;
  }

  /** Schwebende Wolkeninseln mit Tempel, Säulen und Regenbogenbrücken. */
  private islands(f: SkyFrame) {
    const { ctx, W, time, calm } = f;
    // Inseln erst über der Wolkendecke (sonst schweben sie in den Sternenhimmel)
    const bottom = Math.min(f.bottom, f.at(DECK_M + 120, 1));
    // ferne Inseln erst einblenden, wenn man über der Wolkendecke ist
    const vis = clamp((f.camM - (DECK_M - 150)) / 300);
    if (bottom <= 0 || vis <= 0) return;
    ctx.save();
    ctx.globalAlpha = vis;
    ctx.beginPath();
    ctx.rect(0, 0, W, bottom);
    ctx.clip();
    const layers: [number, number][] = [
      [0.55, 0],
      [0.8, 1],
    ];
    for (const [par, li] of layers) {
      for (let j = 0; j < 7; j++) {
        const m = HEAVEN_M + 80 + j * 220 + hash(j, li * 3 + 1) * 90;
        if (m > GATE_M - 200) continue;
        const y = f.at(m, par);
        if (y < -110 || y > bottom + 20) continue;
        // abwechselnd links/rechts vom Ballon, nie direkt dahinter
        const side = (j + li) % 2 ? -1 : 1;
        const big = hash(j, li * 11 + 4) < 0.4;
        const isl = big ? this.islandBig : hash(j, 9) < 0.5 ? this.islandSmall : this.rocks[j % 2];
        // Innenkante 28–60 px neben dem Ballon, Rest darf aus dem Bild ragen
        const gap = 28 + Math.round(hash(j, li + 7) * 32);
        const x = Math.round((side > 0 ? f.balloonX + gap : f.balloonX - gap - isl.width) + (calm ? 0 : Math.sin(time * 0.15 + j) * 6));
        const bob = calm ? 0 : Math.round(Math.sin(time * 0.6 + j) * 2);
        // Tempel bzw. Säulen auf großen Inseln
        if (big && li === 0 && j % 3 === 0) {
          const tw = Math.round(this.temple.width / 2);
          const th = Math.round(this.temple.height / 2);
          ctx.drawImage(this.temple, x + Math.round(isl.width / 2 - tw / 2), y - th + 6 + bob, tw, th);
        } else if (big) {
          // ganze Säulen (eigene Ausschnitte, kein 32-px-Raster – sonst halbe Säulen ohne Sockel)
          const [cx0, cw] = COLUMN_CROPS[Math.floor(hash(j, li) * COLUMN_CROPS.length)];
          ctx.drawImage(this.columns, cx0, 0, cw, 96, x + 24 + (16 - cw) / 2, y - 92 + bob, cw, 96);
          if (cw <= 16) ctx.drawImage(this.columns, cx0, 0, cw, 96, x + 52, y - 91 + bob, cw, 96);
        }
        ctx.drawImage(isl, x, y + bob);
        // Regenbogenbrücke zur nächsten Insel derselben Ebene
        if (li === 1 && side > 0 && hash(j, 21) < 0.5) {
          const bow = this.rainbowSprite(70 + Math.floor(hash(j, 22) * 3) * 20);
          ctx.globalAlpha = 0.85 * vis;
          ctx.drawImage(bow, x + isl.width - 8, y - bow.height + 10 + bob);
          ctx.globalAlpha = vis;
        }
      }
    }
    // ein großer Tempel auf einer eigenen Wolkeninsel (fern)
    const ty = f.at(6250, 0.45);
    if (ty > -120 && ty < bottom + 40) {
      const tx = Math.round(f.balloonX - 150 + (calm ? 0 : Math.sin(time * 0.1) * 4));
      const tw = Math.round(this.temple.width * 0.5);
      const th = Math.round(this.temple.height * 0.5);
      ctx.drawImage(this.islandBig, tx - 4, ty);
      ctx.drawImage(this.temple, tx + Math.round(this.islandBig.width / 2 - tw / 2) - 4, ty - th + 8, tw, th);
    }
    ctx.restore();
  }

  /** Regenbogen als Pixel-Bogen (sechs Bänder), gecacht je Breite. */
  private rainbowSprite(w: number): Sprite {
    let s = this.rainbow.get(w);
    if (s) return s;
    const bands = ['#ff6a6a', '#ffb347', '#ffe28a', '#7ec850', '#5ab8ff', '#a87aff'];
    const h = Math.round(w * 0.42);
    const [c, x] = canvas(w, h + 6);
    const cx = w / 2;
    const r0 = w / 2;
    for (let px = 0; px < w; px++) {
      for (let b = 0; b < bands.length; b++) {
        const r = r0 - b * 2;
        const dx = px - cx;
        if (Math.abs(dx) > r) continue;
        const yy = Math.round(h + 4 - Math.sqrt(r * r - dx * dx) * (h / r0));
        x.fillStyle = bands[b];
        x.fillRect(px, yy, 1, 2);
      }
    }
    this.rainbow.set(w, (s = c));
    return s;
  }

  /** Himmelstor bei 7.000 m: zwei weiße Säulen, goldener Bogen mit Heiligenschein, Perlentor, Wolkensockel. */
  private gate(f: SkyFrame) {
    const { ctx, time, calm } = f;
    const cx = f.balloonX;
    const base = f.at(GATE_M, 1) + 46; // Ballon bei 7.000 m schwebt mitten im Tor
    if (base < -10 || base - 190 > f.bottom) return;
    const half = 56;
    const h = 150;
    // Licht im Torbogen
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let r = 70; r > 0; r -= 6) {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(cx, base - 80, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Perlentor: goldene Stäbe mit Perlen
    for (let x = cx - half + 16; x < cx + half - 16; x += 6) {
      ctx.fillStyle = '#c89a4a';
      ctx.fillRect(x, base - h + 30, 2, h - 30);
      ctx.fillStyle = '#fff2c8';
      ctx.fillRect(x, base - h + 30, 1, h - 30);
      for (let y = base - h + 40; y < base; y += 22) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y, 4, 3);
        ctx.fillStyle = '#e0d8f0';
        ctx.fillRect(x, y + 2, 2, 1);
      }
    }
    // Säulen (aus den Ruinen-Säulen, ganz)
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - half - 6 : cx + half - 26;
      ctx.drawImage(this.columns, 176, 0, 29, 96, x, base - 96, 29, 96);
      ctx.drawImage(this.columns, 176, 0, 29, 40, x, base - h + 14, 29, 40);
    }
    // goldener Bogen mit Heiligenschein
    for (let a = 0; a <= 32; a++) {
      const t = (a / 32) * Math.PI;
      const x = Math.round(cx - Math.cos(t) * (half + 4));
      const y = Math.round(base - h + 20 - Math.sin(t) * 34);
      ctx.fillStyle = '#c89a4a';
      ctx.fillRect(x - 2, y, 5, 5);
      ctx.fillStyle = '#ffe28a';
      ctx.fillRect(x - 2, y, 5, 2);
    }
    const halo = calm ? 1 : 0.7 + 0.3 * Math.sin(time * 2);
    ctx.globalAlpha = halo;
    ctx.strokeStyle = '#fff6c2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, base - h - 22, 16, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Wolkensockel
    for (let i = -6; i <= 6; i++) {
      const r = 10 + Math.round(hash(i, 81) * 8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + i * 13, base + 4 + Math.round(hash(i, 82) * 4), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f0e6ff';
    ctx.fillRect(cx - 90, base + 10, 180, 6);
    const sign = f.sign('+7000 m');
    ctx.drawImage(sign, cx - Math.floor(sign.width / 2), base - h - 4);
  }

  /** Höhenschilder an goldenen Bojen im Himmel (darunter siehe world.ts). */
  private signs(f: SkyFrame) {
    const { ctx, time, calm } = f;
    for (let m = HEAVEN_M; m < GATE_M + 40000; m += m < GATE_M ? 500 : 1000) {
      if (m === GATE_M) continue;
      const y = f.at(m, 1);
      if (y > f.bottom + 10) continue;
      if (y < -30) break;
      const s = f.sign(`+${m} m`);
      const x = f.balloonX + 34;
      const bob = calm ? 0 : Math.round(Math.sin(time * 1.1 + m) * 1);
      ctx.drawImage(f.buoy, x + Math.floor(s.width / 2) - 4, y - 12 + bob);
      ctx.drawImage(s, x, y - 2 + bob);
    }
  }

  /** Sichtbarkeit der Engelchen (nur im Himmel bis knapp über das Tor). */
  angelVis(camM: number) {
    return clamp((camM - HEAVEN_M) / 200) * clamp((GATE_M + 600 - camM) / 300);
  }

  /**
   * Ruheplatz bzw. Flugbahn eines Engelchens: [x, y (oben links), hinter dem Ballon?, winkt?].
   * Ausflug (angelFx, gesetzt von skyFx): eine Runde um den Ballon – oben hinter der Hülle,
   * unten davor –, danach neben dem Korb winken und zurück an den Platz.
   */
  angelPos(f: SkyFrame, i: number): [number, number, boolean, boolean] {
    const { time, calm } = f;
    const side = i ? 1 : -1;
    const rx = Math.round(f.balloonX + side * (42 + (calm ? 0 : Math.sin(time * 0.7 + i) * 8)) - 17);
    const ry = Math.round(f.balloonY - 70 + i * 26 + (calm ? 0 : Math.sin(time * 1.4 + i * 2) * 5));
    const a = this.angelFx[i];
    if (!a) return [rx, ry, false, false];
    const u = (time - a.t0) / a.dur;
    if (u < 0 || u >= 1) {
      this.angelFx[i] = null;
      return [rx, ry, false, false];
    }
    if (a.kind === 'wave') return [rx, ry + (calm ? 0 : Math.round(Math.sin(u * Math.PI * 4))), false, true];
    // Runde: Ellipse um die Ballonmitte, Start und Ende am Ruheplatz
    const cx = f.balloonX - 17;
    const cy = f.balloonY - 28;
    const th0 = Math.atan2((ry - cy) / 20, (rx - cx) / 52);
    const e = (t: number) => t * t * (3 - 2 * t);
    const loop = u < 0.12 ? 0 : u > 0.72 ? 1 : (u - 0.12) / 0.6;
    const th = th0 - side * e(loop) * Math.PI * 2;
    let x = cx + Math.cos(th) * 52;
    let y = cy + Math.sin(th) * 20;
    // weich vom Platz auf die Bahn und zurück
    const k = u < 0.12 ? e(u / 0.12) : u > 0.72 ? 1 - e(Math.min(1, (u - 0.72) / 0.12)) : 1;
    x = rx + (x - rx) * k;
    y = ry + (y - ry) * k;
    const waving = u > 0.84;
    return [Math.round(x), Math.round(y), k > 0.5 && Math.sin(th) < 0, waving];
  }

  /** Ausflüge der beiden Engelchen (von skyFx gesetzt): Runde um den Ballon oder winken. */
  angelFx: ({ kind: 'loop' | 'wave'; t0: number; dur: number } | null)[] = [null, null];

  /** Engelchen begleiten den Ballon im Himmel (front: davor, sonst die Teile der Runde hinter der Hülle). */
  private angels(f: SkyFrame, front = true) {
    const vis = this.angelVis(f.camM);
    if (vis <= 0) return;
    const { ctx, time, calm } = f;
    ctx.globalAlpha = vis;
    for (let i = 0; i < 2; i++) {
      const [x, y, behind, waving] = this.angelPos(f, i);
      if (behind === front) continue;
      if (waving) {
        // winkt mit dem Arm, der zum Ballon zeigt
        const k = calm ? 0 : Math.floor(time * 5) % 2;
        ctx.drawImage(i ? this.angelWaveL[k] : this.angelWave[k], x, y);
      } else {
        const fr = calm ? 0 : Math.floor(time * (this.angelFx[i] ? 10 : 6) + i * 2) % 4;
        ctx.drawImage(this.angel, fr * 34, 0, 34, 43, x, y, 34, 43);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Kleine Lichtwesen (funkeln, schweben) zwischen den Inseln. */
  private lightBeings(f: SkyFrame) {
    if (f.camM < HEAVEN_M - 200 || f.camM > GATE_M + 2200) return;
    const { ctx, W, time, calm } = f;
    for (let i = 0; i < 9; i++) {
      const m = HEAVEN_M + i * 190 + hash(i, 91) * 120;
      const y = f.at(m, 1.05) + (calm ? 0 : Math.round(Math.sin(time * 1.2 + i) * 6));
      if (y < 0 || y > f.bottom) continue;
      const x = Math.round(mod(hash(i, 92) * W + (calm ? 0 : time * (4 + i)), W));
      const tw = calm ? 1 : Math.sin(time * 4 + i * 3);
      ctx.fillStyle = '#fff6c2';
      ctx.fillRect(x, y, 2, 2);
      if (tw > 0.3) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y, 4, 1);
        ctx.fillRect(x, y - 1, 1, 4);
      }
    }
  }

  /** Kristallinseln dieses Bilds (Bildschirm-Rechteck des Kerns, Index) – für Antippen in skyFx. */
  crystalHits: { x: number; y: number; w: number; h: number; j: number }[] = [];
  /** Angetippte Inseln: Index → Zeitpunkt (klingen, Splitter rieseln). */
  private chimes = new Map<number, number>();

  /** Insel j zum Klingen bringen (Antippen). */
  chime(j: number, time: number) {
    this.chimes.set(j, time);
  }

  /**
   * Kristallwolken (7.000–9.000 m): Halo mit Nebensonnen, schillernde Perlmuttwolken,
   * schwebende Kristallinseln mit Spektralfächern, großer Lichtfächer an einem Kristall auf
   * einem Wolkenpolster. Nichts schwebt frei: Splitter bröckeln sichtbar von den Unterseiten
   * der Inseln ab und fallen funkelnd in die Tiefe.
   */
  private crystals(f: SkyFrame) {
    this.crystalHits.length = 0;
    if (f.camM < GATE_M - 300 || f.camM > GATE_M + 2600) return;
    const { ctx, W, time, calm, bottom } = f;
    // über dem Tor einblenden, vor dem Polarlicht ausblenden
    const vis = clamp((f.camM - (GATE_M - 100)) / 350) * clamp((GATE_M + 2050 - f.camM) / 450);
    if (vis <= 0) return;
    ctx.globalAlpha = vis;
    // 22°-Halo hoch oben (sehr fern, fast fest)
    const hy = f.at(GATE_M + 1300, 0.18) - this.halo.height / 2;
    if (hy < bottom && hy + this.halo.height > 0) ctx.drawImage(this.halo, Math.round(W * 0.3 - this.halo.width / 2 - f.camX * 0.02), hy);
    // Perlmuttwolken: Bänke mit Regenbogensaum
    for (let i = 0; i < this.nacre.length; i++) {
      const [m, par] = [
        [GATE_M + 350, 0.45],
        [GATE_M + 1000, 0.6],
        [GATE_M + 1650, 0.5],
      ][i];
      const s = this.nacre[i];
      const y = f.at(m, par);
      if (y > bottom || y + s.height < 0) continue;
      const off = mod(Math.round(-f.camX * par * 0.5 + (calm ? 0 : time * (1.5 + i))), s.width);
      for (let x = off - s.width; x < W; x += s.width) ctx.drawImage(s, x, y);
    }
    // Lichtfächer: Strahl bricht sich an einem Kristall, der auf einem kleinen Wolkenpolster wächst
    for (let i = 0; i < 2; i++) {
      const y = f.at(GATE_M + 500 + i * 800, 0.7);
      if (y > bottom || y + this.fan.height + 20 < 0) continue;
      const x = i ? Math.round(f.balloonX + 10) : Math.round(f.balloonX - 150);
      const bob = calm ? 0 : Math.round(Math.sin(time * 0.5 + i * 3) * 1);
      ctx.globalAlpha = vis * (calm ? 0.8 : 0.65 + 0.3 * Math.sin(time * 0.7 + i * 2));
      ctx.drawImage(this.fan, x, y);
      ctx.globalAlpha = vis;
      const sh = this.shards[i];
      ctx.drawImage(sh, x + 44 - Math.round(sh.width / 2), y + 24 + bob);
      ctx.drawImage(this.pad, x + 44 - Math.round(this.pad.width / 2), y + 24 + sh.height - 3 + bob);
      this.crystalHits.push({ x: x + 30, y: y + 18, w: 28, h: sh.height + this.pad.height + 6, j: 100 + i });
      this.crumbs(f, x + 44, y + 24 + sh.height + 3 + bob, 6, 100 + i, 0.7);
    }
    // schwebende Kristallinseln in zwei Ebenen, links/rechts vom Ballon
    for (let j = 0; j < 9; j++) {
      const li = j % 2;
      const par = li ? 0.85 : 0.55;
      const m = GATE_M + 280 + j * 205 + hash(j, 131) * 60;
      const isl = (li ? this.isles : this.islesFar)[j % this.isles.length];
      const bob = calm ? 0 : Math.round(Math.sin(time * 0.5 + j) * 2);
      const y = f.at(m, par) + bob;
      if (y > bottom || y + isl.height + 40 < 0) continue;
      const side = (j >> 1) % 2 ? 1 : -1;
      const gap = 30 + Math.round(hash(j, 132) * 40);
      const x = Math.round(side > 0 ? f.balloonX + gap : f.balloonX - gap - (isl.width - 34)) + (calm ? 0 : Math.round(Math.sin(time * 0.12 + j) * 5));
      ctx.drawImage(isl, x, y);
      const w = isl.width - 34;
      const h = Math.round(w * 0.88);
      const y0 = Math.round(h * 0.46);
      this.crystalHits.push({ x, y, w, h: h + 4, j });
      if (!calm && Math.sin(time * 2.6 + j * 1.7) > 0.7) {
        // Funkeln auf einer Kristallspitze
        const sx = x + Math.round(w * (0.25 + hash(j, 133) * 0.35));
        const sy = y + Math.round(h * 0.2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy - 2, 1, 5);
        ctx.fillRect(sx - 2, sy, 5, 1);
      }
      // Splitter bröckeln von der Unterseite (Kegel) ab
      this.crumbs(f, x + Math.round(w / 2), y + y0 + 2, h - y0, j, li ? 1 : 0.6, w / 2 - 3);
      const c = this.chimes.get(j);
      if (c !== undefined) this.chimeFx(f, x, y, w, y0, h, j, time - c);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Abbröckelnde Splitter unter einer Insel: in Abständen lösen sich 2–3 Splitter vom Kegel
   * (Mitte cx, Oberkante top, Höhe cone, halbe Breite oben half), fallen beschleunigt und funkeln.
   */
  private crumbs(f: SkyFrame, cx: number, top: number, cone: number, j: number, a: number, half = 3) {
    if (f.calm) return;
    const { ctx, time } = f;
    const P = 5 + hash(j, 141) * 5;
    const tt = time + hash(j, 142) * P;
    const cyc = Math.floor(tt / P);
    const ph = tt - cyc * P;
    for (let k = 0; k < 3; k++) {
      const t = ph - k * 0.4;
      if (t < 0 || t > 1.9) continue;
      if (k === 2 && hash(j + cyc, 143) < 0.5) continue;
      // Ablösepunkt auf der Kegelfläche (unten schmaler)
      const u = 0.35 + 0.6 * hash(j * 7 + k, cyc * 13 + 1);
      const hw = half * (1 - u ** 1.15);
      const sx = cx + Math.round((hash(j * 5 + k, cyc * 7 + 2) - 0.5) * 1.6 * hw);
      const sy = top + Math.round(u * cone);
      // kurz hängen, dann fallen
      const fall = t < 0.25 ? 0 : 0.5 * 38 * (t - 0.25) ** 2;
      const y = sy + Math.round(fall);
      if (y > f.bottom) continue;
      if (t > 1.4 && Math.floor(time * 20) % 2) continue; // flackert aus
      const glint = (Math.floor(time * 12) + k + j) % 3 === 0;
      ctx.globalAlpha = a;
      ctx.fillStyle = glint ? '#ffffff' : CRUMB[(j + k) % CRUMB.length];
      ctx.fillRect(sx + Math.round(Math.sin(t * 3 + k) * (t * 2)), y, 1, k === 0 && a > 0.8 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  /** Angetippte Insel klingt: Funkeln auf den Spitzen, ein Schauer Splitter rieselt ab. */
  private chimeFx(f: SkyFrame, x: number, y: number, w: number, y0: number, h: number, j: number, t: number) {
    if (t > 1.6 || t < 0) {
      this.chimes.delete(j);
      return;
    }
    const { ctx, calm } = f;
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 3; k++) {
      if (!calm && (Math.floor(t * 10) + k) % 2) continue;
      const sx = x + Math.round(w * (0.22 + k * 0.28));
      const sy = y + Math.round(y0 * (0.35 + hash(j, k + 150) * 0.4));
      const r = t < 0.3 ? 3 : 2;
      ctx.fillRect(sx, sy - r, 1, r * 2 + 1);
      ctx.fillRect(sx - r, sy, r * 2 + 1, 1);
    }
    if (calm) return;
    for (let k = 0; k < 6; k++) {
      const u = 0.3 + 0.6 * hash(j, k + 160);
      const sx = x + w / 2 + (hash(j, k + 170) - 0.5) * w * (1 - u) * 0.9;
      const sy = y + y0 + 2 + u * (h - y0) + 0.5 * 40 * t * t;
      ctx.fillStyle = (Math.floor(t * 14) + k) % 2 ? '#ffffff' : CRUMB[k % CRUMB.length];
      ctx.fillRect(Math.round(sx + (hash(j, k + 180) - 0.5) * 10 * t), Math.round(sy), 1, 1);
    }
  }

  /** Polarlicht (9.000–11.000 m): wehende Bänder in Grün, Türkis und Rosa, dazu Sterne. */
  private aurora(f: SkyFrame) {
    const s = clamp((f.camM - (GATE_M + 1700)) / 400) * clamp((GATE_M + 4600 - f.camM) / 500);
    const stars = clamp((f.camM - (GATE_M + 1700)) / 400);
    const { ctx, W, bottom, time, calm } = f;
    if (stars > 0) {
      // Sterne fest am Bildschirm (sehr fern)
      for (let i = 0; i < 90; i++) {
        const x = Math.floor(hash(i, 101) * W);
        const y = Math.floor(hash(i, 102) * bottom);
        const tw = calm ? 1 : Math.sin(time * (1 + hash(i, 103) * 2) + i);
        if (tw < -0.5) continue;
        ctx.globalAlpha = stars;
        ctx.fillStyle = hash(i, 104) > 0.8 ? '#bfe6ff' : '#ffffff';
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (s <= 0) return;
    const bands: [string, number][] = [
      ['#4af0a0', 0],
      ['#3ad0f0', 1.7],
      ['#f08ae6', 3.4],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [color, ph] of bands) {
      ctx.fillStyle = color;
      // 3-px-Säulen in 4 Helligkeitsstufen (wenige große Rechtecke statt vieler Pixel – schnell auf Handys)
      for (let x = 0; x < W; x += 3) {
        const base = bottom * (0.25 + ph * 0.06) + Math.sin(x * 0.03 + (calm ? 0 : time * 0.4) + ph) * 14 + Math.sin(x * 0.011 + ph) * 20;
        const len = 26 + Math.round(Math.sin(x * 0.05 + ph * 2 + (calm ? 0 : time * 0.7)) * 12);
        for (let q = 0; q < 4; q++) {
          ctx.globalAlpha = s * 0.18 * (1 - q / 4);
          ctx.fillRect(x, Math.round(base + (q * len) / 4), 3, Math.ceil(len / 4));
        }
      }
    }
    ctx.restore();
  }

  /** Weltraum (ab 11.000 m): ansimuz-Hintergrund, Sterne, Planeten. */
  private space_(f: SkyFrame) {
    const s = clamp((f.camM - (GATE_M + 3900)) / 600);
    if (s <= 0) return;
    const { ctx, W, bottom, time, calm } = f;
    ctx.globalAlpha = s;
    const bg = this.space.background;
    const st = this.space.stars;
    const shift = Math.round(f.camM * 0.02);
    const row0 = Math.floor(shift / bg.height);
    const off = mod(shift, bg.height);
    for (let i = -1, y = off - bg.height; y < bottom; i++, y += bg.height)
      for (let x = 0; x < W; x += bg.width) ctx.drawImage(mod(row0 - i, 2) ? this.spaceFlip : bg, x, y);
    const shift2 = Math.round(f.camM * 0.05 + (calm ? 0 : time * 2));
    const row2 = Math.floor(shift2 / st.height);
    const off2 = mod(shift2, st.height);
    for (let i = -1, y = off2 - st.height; y < bottom; i++, y += st.height)
      for (let x = 0; x < W; x += st.width) ctx.drawImage(mod(row2 - i, 2) ? this.starsFlip : st, x, y);
    ctx.drawImage(this.space.far, 0, Math.round(mod(-f.camM * 0.08, bottom + 160) - 160));
    // Planeten in verschiedenen Höhen
    for (let i = 0; i < 8; i++) {
      const m = GATE_M + 4200 + i * 900;
      const y = f.at(m, 0.3);
      if (y < -120 || y > bottom) continue;
      // links oder rechts, nie hinter dem Ballon
      const x = i % 2 ? Math.round(f.balloonX + 40 + hash(i, 111) * Math.max(10, W / 2 - 90)) : Math.round(f.balloonX - 40 - 90 + hash(i, 111) * Math.max(10, W / 2 - 90) * -1);
      if (i === 2) ctx.drawImage(this.space.ring, x, y);
      else if (i === 5) ctx.drawImage(this.space.big, x, y);
      else ctx.drawImage(this.planets, (i % 6) * 32, 0, 32, 32, x, y, 32, 32);
    }
    ctx.globalAlpha = 1;
  }
}

// ================================================================ Pixel-Generatoren (nur beim Laden)

/** Engelchen (erstes Bild) mit erhobenem rechtem Arm zum Winken; tilt 0/1 = Arm steil/schräg. */
function angelWaveSprite(sheet: CanvasImageSource, tilt: number): Sprite {
  const [c, x] = canvas(34, 43);
  x.drawImage(sheet, 0, 0, 34, 43, 0, 0, 34, 43);
  const r = (px: number, py: number, w: number, h: number, col: string) => {
    x.fillStyle = col;
    x.fillRect(px, py, w, h);
  };
  // herabhängende Hand übermalen (Gewand)
  r(25, 31, 2, 3, '#a3acbe');
  r(27, 31, 1, 4, '#67708b');
  // Ärmel von der Schulter nach oben, Hand oben
  const pts = tilt ? [[24, 21], [25, 19], [26, 17], [27, 15], [28, 13]] : [[24, 21], [25, 19], [25, 17], [26, 15], [26, 13]];
  for (const [px, py] of pts) {
    r(px - 1, py, 4, 2, '#67708b');
    r(px, py, 2, 2, '#a3acbe');
  }
  const [hx, hy] = pts[pts.length - 1];
  r(hx - 1, hy - 4, 4, 4, '#945542');
  r(hx, hy - 4, 2, 3, '#e5ae78');
  r(hx, hy - 1, 2, 1, '#c58158');
  return c;
}

type RGBA = [number, number, number, number];
const rgbaCache = new Map<string, RGBA>();
function rgba(h: string): RGBA {
  let c = rgbaCache.get(h);
  if (!c) {
    const n = parseInt(h.slice(1, 7), 16);
    rgbaCache.set(h, (c = [n >> 16, (n >> 8) & 255, n & 255, 255]));
  }
  return c;
}
/** Zwei Hex-Farben mischen → Hex. */
export function mix(a: string, b: string, t: number): string {
  const x = rgba(a);
  const y = rgba(b);
  return '#' + [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('');
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const SPECTRUM = ['#ff6a6a', '#ffb347', '#ffe28a', '#7ec850', '#5ab8ff', '#a87aff'];

/** Kleiner Pixelpuffer: Pixel setzen (mit Deckkraft), am Ende ein Sprite – keine fillRect-Flut beim Laden. */
export class Px {
  d: Uint8ClampedArray;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: string, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const [r, g, b] = rgba(c);
    const d = this.d;
    const i = (y * this.w + x) * 4;
    const al = Math.min(1, a);
    const da = d[i + 3] / 255;
    const oa = al + da * (1 - al);
    d[i] = (r * al + d[i] * da * (1 - al)) / oa;
    d[i + 1] = (g * al + d[i + 1] * da * (1 - al)) / oa;
    d[i + 2] = (b * al + d[i + 2] * da * (1 - al)) / oa;
    d[i + 3] = oa * 255;
  }
  sprite(): Sprite {
    const [c, x] = canvas(this.w, this.h);
    const im = x.createImageData(this.w, this.h);
    im.data.set(this.d);
    x.putImageData(im, 0, 0);
    return c;
  }
}

/**
 * Haufenwolke (Cumulus) aus überlappenden Pixelkreisen: Licht von links oben,
 * Falten zwischen den Ballen, flache schattige Unterseite, Bayer-Dithering an den Tonstufen.
 * pal: [Glanz, hell, mittel, Schatten, Unterseite]
 */
export function cumulus(seed: number, w: number, pal: string[], tower = 0.5): Sprite {
  const r = rng(seed);
  const h = Math.round(w * (0.42 + tower * 0.3));
  const blobs: [number, number, number][] = [];
  const n = 3 + Math.floor(w / 18);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const rad = w * (0.08 + 0.05 * Math.sin(Math.PI * t)) * (0.8 + r() * 0.4);
    blobs.push([rad + (w - 2 * rad) * t + (r() - 0.5) * 4, h - 4 - rad * 0.75, rad]);
  }
  const m = 2 + Math.floor(w / 30);
  for (let i = 0; i < m; i++) {
    const t = (i + 0.5 + (r() - 0.5) * 0.5) / m;
    const dome = Math.sin(Math.PI * (0.15 + t * 0.7));
    const rad = w * (0.1 + 0.08 * dome) * (0.85 + r() * 0.3);
    const cy = Math.max(rad + 1, h - 6 - rad - dome * (h - 8 - 2 * rad) * (0.55 + 0.45 * r()));
    blobs.push([w * (0.12 + t * 0.76), cy, rad]);
  }
  blobs.sort((a, b) => a[1] - b[1]); // höhere Ballen hinten, tiefere davor
  const left = Math.min(...blobs.map((b) => b[0] - b[2]));
  const right = Math.max(...blobs.map((b) => b[0] + b[2]));
  const px = new Px(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = -1;
      let behind = false;
      for (let i = 0; i < blobs.length; i++) {
        const [bx, by, br] = blobs[i];
        if ((x - bx) ** 2 + (y - by) ** 2 <= br * br) {
          if (k >= 0) behind = true;
          k = i;
        }
      }
      const flat = y >= h - 4 && x > left + 3 && x < right - 3;
      if (k < 0 && !flat) continue;
      const th = (bayer(x, y) - 0.5) * 0.16;
      let tone: number;
      if (k >= 0) {
        const [bx, by, br] = blobs[k];
        const nx = (x - bx) / br;
        const ny = (y - by) / br;
        let l = -(nx * 0.55 + ny * 0.85) - (y / h) * 0.45 + th;
        // Falte: Rand eines vorderen Ballens, der einen hinteren überdeckt
        if (behind && nx * nx + ny * ny > 0.8 && ny < 0.3) l -= 0.45;
        tone = l > 0.62 ? 0 : l > 0.18 ? 1 : l > -0.28 ? 2 : 3;
      } else tone = 3;
      if (y >= h - 2) tone = 4;
      else if (y >= h - 4) tone = Math.max(tone, 3);
      px.set(x, y, pal[tone]);
    }
  }
  return px.sprite();
}

/**
 * Wolkenbank (kachelbar in der Breite w, Vielfaches von 12): oben oder unten aufgebauscht.
 * lit = 'top' → Sonne von oben (Rand oben hell), 'bottom' → Abendsonne von unten.
 * pal: [Lichtrand, hell, mittel, Schatten, tief]
 */
function cloudBank(seed: number, w: number, h: number, pal: string[], lit: 'top' | 'bottom', fadeBottom: boolean, shade?: (x: number, y: number, d: number) => string | null): Sprite {
  const r = rng(seed);
  const nb = w / 12;
  const bumps = Array.from({ length: nb }, () => 2 + r() * 6);
  const ph = [r() * 6, r() * 6, r() * 6];
  const T = Math.PI * 2;
  const wave = (x: number, k: number) =>
    Math.sin((T * x * 1) / w + ph[0]) * 3 * k + Math.sin((T * x * 3) / w + ph[1]) * 2 * k + Math.sin((T * x * 7) / w + ph[2]);
  const bump = (x: number, s: number) => {
    const b = Math.floor(x / 12) % nb;
    const u = (x % 12) / 12;
    return Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) * bumps[(b + s) % nb];
  };
  const px = new Px(w, h);
  for (let x = 0; x < w; x++) {
    const top = Math.round(h * 0.3 + wave(x, 1) - (lit === 'top' ? bump(x, 0) : bump(x, 0) * 0.4));
    const bot = Math.round(h - 2 - (lit === 'bottom' ? 3 - bump(x + 6, 3) * 0.5 + wave(x + 40, 0.3) : 0));
    for (let y = Math.max(0, top); y <= Math.min(h - 1, bot); y++) {
      const d = y - top;
      const e = bot - y;
      const th = bayer(x, y);
      if (fadeBottom && e < 5 && th > e / 5) continue;
      const custom = shade?.(x, y, d);
      if (custom) {
        px.set(x, y, custom);
        continue;
      }
      const thick = bot - top + 1;
      let tone: number;
      if (lit === 'top') {
        tone = d < 1 ? 0 : d < 3 ? 1 : d / thick < 0.45 + (th - 0.5) * 0.2 ? 2 : d / thick < 0.8 + (th - 0.5) * 0.2 ? 3 : 4;
        // Falte zwischen zwei Bauschen
        if (d < 5 && x % 12 < 1) tone = Math.max(tone, 2);
      } else {
        tone = e < 1 ? 0 : e < 3 ? 1 : e / thick < 0.4 + (th - 0.5) * 0.2 ? 2 : e / thick < 0.75 + (th - 0.5) * 0.2 ? 3 : 4;
        if (d < 1) tone = Math.min(tone, 3);
      }
      // Schlieren: waagerechte, etwas dunklere Streifen
      if (tone > 0 && tone < 4 && hash(y, seed) < 0.22 && hash(Math.floor(x / 9), y + seed) < 0.5) tone++;
      px.set(x, y, pal[tone]);
    }
  }
  return px.sprite();
}

/**
 * Ferne Bergkette (kachelbar, 256 px): hintere und vordere Gipfel mit Schnee,
 * Sonnen- und Schattenseite, unten im Dunst aufgelöst.
 * pal: [Schnee, Schnee-Schatten, Fels hell, Fels Schatten, ferne Kette, ferne Kette Schatten, Dunst]
 */
function mountainStrip(seed: number, pal: string[]): Sprite {
  const W = 256;
  const H = 96;
  const r = rng(seed);
  type Peak = { x: number; top: number; sl: number };
  const mk = (n: number, t0: number, t1: number): Peak[] =>
    Array.from({ length: n }, (_, i) => ({ x: ((i + 0.2 + r() * 0.6) * W) / n, top: t0 + r() * (t1 - t0), sl: 0.5 + r() * 0.5 }));
  const back = mk(7, 6, 30);
  const front = mk(4, 28, 50);
  const ridge = (pk: Peak[], x: number): [number, Peak, number] => {
    let best = 1e9;
    let bp = pk[0];
    let bdx = 0;
    for (const p of pk) {
      let dx = x - p.x;
      dx -= Math.round(dx / W) * W;
      const y = p.top + Math.abs(dx) * p.sl;
      if (y < best) [best, bp, bdx] = [y, p, dx];
    }
    return [best + Math.round(Math.sin((Math.PI * 2 * x * 9) / W) * 1.2 + Math.sin((Math.PI * 2 * x * 23) / W) * 0.8), bp, bdx];
  };
  const px = new Px(W, H);
  for (let x = 0; x < W; x++) {
    const [fy, fp, fdx] = ridge(front, x);
    const [by, bp, bdx] = ridge(back, x);
    for (let y = Math.max(0, Math.min(fy, by)); y < H; y++) {
      const isFront = y >= fy;
      const [p, dx] = isFront ? [fp, fdx] : [bp, bdx];
      const depth = y - p.top;
      const shadow = dx > depth * 0.3 - 1 + (hash(y, x) < 0.15 ? 1 : 0);
      const snowLine = (isFront ? 9 : 7) + Math.round(Math.sin(x * 1.7) * 1.5 + hash(x >> 1, seed) * 2);
      let c: string;
      if (depth < snowLine && p.top < (isFront ? 42 : 26)) c = shadow ? pal[1] : pal[0];
      else if (isFront) c = shadow ? pal[3] : pal[2];
      else c = shadow ? pal[5] : pal[4];
      if (!isFront) c = mix(c, pal[6], 0.3);
      // Dunst nach unten: Bayer-gestuft in die Dunstfarbe
      const t = clamp((y - 46) / (H - 52));
      const lvl = Math.floor(t * 2 + bayer(x, y) * 0.999);
      if (lvl >= 2) c = pal[6];
      else if (lvl === 1) c = mix(c, pal[6], 0.55);
      px.set(x, y, c);
    }
  }
  return px.sprite();
}

/** Gänse in V-Formation, Flügelschlag je Vogel versetzt. */
function flockSprite(n: number, frame: number, color: string, spread: number): Sprite {
  const arms = Math.ceil((n - 1) / 2);
  const w = arms * spread + 7;
  const h = arms * 6 + 6;
  const px = new Px(w, h);
  const up = ['k...k', '.kkk.', '..k..'];
  const down = ['.....', '.kkk.', 'k.k.k'];
  for (let i = 0; i < n; i++) {
    const k = Math.ceil(i / 2);
    const side = i % 2 ? -1 : 1;
    const bx = w - 6 - k * spread;
    const by = Math.round(h / 2 - 1 + side * k * 3);
    const rows = (frame + i) % 2 ? up : down;
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < 5; xx++) if (row[xx] === 'k') px.set(bx + xx, by + yy - 1, color);
    });
  }
  return px.sprite();
}

/** Lockerer Schwarm kleiner Vögel (Stare). */
function swarmSprite(seed: number, frame: number, color: string): Sprite {
  const r = rng(seed);
  const px = new Px(36, 16);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const x = 18 + Math.cos(a) * d * 16;
    const y = 8 + Math.sin(a) * d * 6;
    px.set(x, y, color);
    if ((frame + i) % 2) {
      px.set(x - 1, y - 1, color);
      px.set(x + 1, y - 1, color);
    } else {
      px.set(x - 1, y, color);
      px.set(x + 1, y, color);
    }
  }
  return px.sprite();
}

/** Kondensstreifen: zwei Triebwerkslinien am Flugzeug, nach hinten breiter und blasser. */
export function contrailSprite(len: number, thick: number): Sprite {
  const h = thick + 4;
  const px = new Px(len, h);
  const mid = Math.floor(h / 2);
  for (let x = 0; x < len; x++) {
    const t = x / len; // 0 = Ende, 1 = am Flugzeug
    const a = 0.12 + 0.7 * t ** 1.4;
    if (t > 0.88) {
      px.set(x, mid - 1, '#ffffff', a);
      px.set(x, mid + 1, '#ffffff', a);
      continue;
    }
    const half = Math.round((1 - t) * (thick / 2)) + (hash(x >> 2, 3) < 0.4 ? 1 : 0);
    for (let y = mid - half; y <= mid + half; y++) {
      const edge = Math.abs(y - mid) === half && half > 0;
      if (edge && bayer(x, y) > 0.5) continue;
      px.set(x, y, '#ffffff', a * (edge ? 0.6 : 1));
    }
  }
  return px.sprite();
}

/** Windlinie mit Schnörkel am Ende. */
function windLineSprite(len: number, up: boolean): Sprite {
  const px = new Px(len + 8, 9);
  const y0 = up ? 7 : 1;
  for (let x = 0; x < len; x++) px.set(x, y0, '#ffffff', 0.15 + 0.6 * (x / len));
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 1.6;
    const s = up ? -1 : 1;
    px.set(len + Math.sin(a) * 3, y0 + s * (3 - Math.cos(a) * 3), '#ffffff', 0.75);
  }
  return px.sprite();
}

/** Federwolke (Cirrus): dünne Fasern, an den Enden ausgefranst, mit kleinem Haken. */
function cirrusSprite(seed: number, w: number): Sprite {
  const r = rng(seed);
  const px = new Px(w, 10);
  for (let s = 0; s < 5; s++) {
    const y = 2 + Math.round(s * 1.4);
    const x0 = Math.round(r() * w * 0.3);
    const x1 = Math.round(w * (0.6 + r() * 0.4)) - 2;
    for (let x = x0; x < x1; x++) {
      const t = (x - x0) / (x1 - x0);
      const a = Math.sin(Math.PI * t) * (s === 1 || s === 2 ? 0.9 : 0.55);
      if (a < 0.25 && bayer(x, y) > a * 3) continue;
      px.set(x, y + (t > 0.9 ? 1 : 0), s === 1 ? '#ffffff' : '#e4f0ff', a + 0.1);
    }
  }
  return px.sprite();
}

/** Kristall (Prisma) mit drei Flächen und Spitze, leicht regenbogenschillernd. */
function prism(px: Px, x0: number, base: number, w: number, h: number, pal: string[], tilt: number) {
  const tip = Math.max(3, Math.round(w * 0.9));
  for (let y = 0; y < h; y++) {
    const yy = base - y;
    const half = y > h - tip ? (w / 2) * ((h - y) / tip) : w / 2;
    const cx = x0 + tilt * (y / h) * 3;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const u = (x - (cx - half)) / (2 * half + 0.001);
      let c = u < 0.3 ? pal[3] : u < 0.62 ? pal[2] : pal[1];
      if (x === Math.round(cx - half) || x === Math.round(cx + half)) c = pal[0];
      // Regenbogenschimmer: schräges Band über die Flächen
      const band = (x * 2 + yy * 3) % 40;
      if (band < 6 && u > 0.05 && u < 0.95) c = mix(c, SPECTRUM[band], 0.35);
      px.set(x, yy, c);
    }
  }
}

const CRY_PALS = [
  ['#2a3a7a', '#4a7ad0', '#9ad8ff', '#eafcff'],
  ['#5a2a7a', '#b06ad0', '#f0b0ff', '#fff0ff'],
  ['#2a5a6a', '#3aa0a8', '#9af0e0', '#f0fff8'],
  ['#3a3a8a', '#7a7ae0', '#c8c0ff', '#f6f2ff'],
];

/** Schwebende Kristallinsel: Wolkenpolster, Kristalle obenauf, facettierter Kristallkegel darunter, Lichtbrechung. */
function crystalIsland(seed: number, w: number, haze?: string): Sprite {
  const r = rng(seed);
  const pad = 34;
  const h = Math.round(w * 0.88);
  const px = new Px(w + pad, h + 16);
  const y0 = Math.round(h * 0.46);
  // Kristalle obenauf (hinter dem Wolkenpolster)
  const n = 3 + Math.floor(w / 22);
  const spires: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cw = 4 + Math.round(r() * (w / 12));
    const ch = Math.round((8 + r() * (y0 - 10)) * (0.5 + 0.5 * Math.sin(Math.PI * t)));
    const x = Math.round(w * (0.15 + 0.7 * t) + (r() - 0.5) * 6);
    spires.push([x, ch, cw]);
    prism(px, x, y0 + 3, cw, ch, CRY_PALS[(seed + i) % 4], (r() - 0.5) * 2);
  }
  // Kegel unten: Facetten, links hell, rechts dunkel
  const cone = h - y0;
  const facets = 5 + Math.floor(w / 20);
  for (let y = 0; y < cone; y++) {
    const t = y / cone;
    const half = (w / 2 - 3) * (1 - t ** 1.15) + (hash(y >> 2, seed) - 0.5) * 2;
    for (let x = Math.round(w / 2 - half); x <= Math.round(w / 2 + half); x++) {
      const u = (x - (w / 2 - half)) / (2 * half + 0.001);
      const f = Math.floor((u + t * 0.15) * facets);
      const p = CRY_PALS[(seed + f) % 4];
      let c = u < 0.35 ? p[2] : u < 0.7 ? p[1] : p[0];
      if (f % 2) c = mix(c, '#1a2050', 0.18);
      // Facettenkanten hell
      if (Math.abs(((u + t * 0.15) * facets) % 1) < 0.08) c = mix(c, '#ffffff', 0.5);
      const band = (x * 3 - y * 2 + 400) % 52;
      if (band < 6) c = mix(c, SPECTRUM[band], 0.3);
      px.set(x, y0 + 2 + y, c);
    }
  }
  // Wolkenpolster obenauf
  const bumps = 2 + Math.floor(w / 14);
  for (let i = 0; i < bumps; i++) {
    const cx = 4 + ((w - 8) * (i + 0.5)) / bumps;
    const rad = 4 + r() * (w / 16);
    for (let y = -rad; y <= 3; y++)
      for (let x = -rad; x <= rad; x++) {
        if (x * x + y * y > rad * rad && y < 0) continue;
        const l = -(x / rad) * 0.5 - (y / rad) * 0.8 + (bayer(x + 64, y + 64) - 0.5) * 0.2;
        px.set(cx + x, y0 + 2 + y, l > 0.55 ? '#ffffff' : l > 0.05 ? '#eef0ff' : l > -0.4 ? '#d4d6fa' : '#b4b6ea');
      }
  }
  // Lichtbrechung: Spektralfächer aus dem höchsten Kristall nach rechts unten
  const top = spires.reduce((a, b) => (b[1] > a[1] ? b : a));
  const sx = top[0] + 2;
  const sy = y0 + 3 - Math.round(top[1] * 0.55);
  for (let k = 0; k < SPECTRUM.length; k++) {
    const ang = 0.35 + k * 0.07;
    const len = pad + w - sx - 4;
    for (let d = 3; d < len; d++) {
      const a = 0.55 * (1 - d / len);
      px.set(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, SPECTRUM[k], a);
      px.set(sx + Math.cos(ang) * d, sy + 1 + Math.sin(ang) * d, SPECTRUM[k], a * 0.6);
    }
  }
  px.set(sx, sy, '#ffffff');
  if (haze) {
    const d = px.d;
    const [hr, hg, hb] = rgba(haze);
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (hr - d[i]) * 0.45;
      d[i + 1] += (hg - d[i + 1]) * 0.45;
      d[i + 2] += (hb - d[i + 2]) * 0.45;
    }
  }
  return px.sprite();
}

/** Kleines Wolkenpolster (Unterseite mit hängenden Kristallzapfen), Breite w. */
function cloudPad(seed: number, w: number): Sprite {
  const r = rng(seed);
  const h = 13;
  const px = new Px(w, h);
  // hängende Zapfen zuerst (Polster verdeckt ihren Ansatz)
  for (let i = 0; i < 3; i++) {
    const cx = Math.round(w * (0.3 + i * 0.2) + (r() - 0.5) * 2);
    const len = 3 + Math.round(r() * 4);
    const p = CRY_PALS[(seed + i) % 4];
    for (let y = 0; y < len; y++) {
      const half = y < len - 1 ? 1 : 0;
      for (let x = -half; x <= half; x++) px.set(cx + x, 5 + y, x < 0 ? p[2] : x > 0 ? p[0] : p[1]);
    }
  }
  const bumps = 3;
  for (let i = 0; i < bumps; i++) {
    const cx = 3 + ((w - 6) * (i + 0.5)) / bumps;
    const rad = 3 + r() * 2;
    for (let y = -rad; y <= 2; y++)
      for (let x = -rad; x <= rad; x++) {
        if (x * x + y * y > rad * rad && y < 0) continue;
        const l = -(x / rad) * 0.5 - (y / rad) * 0.8 + (bayer(x + 64, y + 64) - 0.5) * 0.2;
        px.set(cx + x, 5 + y, l > 0.55 ? '#ffffff' : l > 0.05 ? '#eef0ff' : l > -0.4 ? '#d4d6fa' : '#b4b6ea');
      }
  }
  return px.sprite();
}

/** Großer Lichtfächer: weißer Strahl von links oben, im Prisma in sechs Farben aufgefächert. */
function prismFanSprite(): Sprite {
  const W = 150;
  const H = 96;
  const px = new Px(W, H);
  const hx = 44;
  const hy = 30;
  for (let d = 0; d < 52; d++) {
    const a = 0.08 + 0.4 * (d / 52);
    for (let o = -1; o <= 1; o++) px.set(hx - d * 0.82, hy - d * 0.55 + o, '#ffffff', o ? a * 0.5 : a);
  }
  for (let k = 0; k < SPECTRUM.length; k++) {
    const ang = 0.28 + k * 0.085;
    for (let d = 2; d < 115; d++) {
      const a = 0.45 * (1 - d / 115) ** 0.8;
      for (let o = 0; o < 2 + Math.floor(d / 40); o++) px.set(hx + Math.cos(ang) * d, hy + Math.sin(ang) * d + o, SPECTRUM[k], a);
    }
  }
  return px.sprite();
}

/** 22°-Halo um eine helle Sonne: dünner Regenbogenring (innen rot), dazu zwei Nebensonnen. */
function haloSprite(R: number): Sprite {
  const S = R * 2 + 30;
  const px = new Px(S, S);
  const c = S / 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c);
      const k = Math.floor(d - R + 1);
      if (k >= 0 && k < 5) px.set(x, y, SPECTRUM[Math.min(5, k + (k > 2 ? 1 : 0))], 0.28);
      if (d < 7) px.set(x, y, d < 4 ? '#ffffff' : '#fff6d0', d < 4 ? 1 : 0.7);
      else if (d < 14 && bayer(x, y) < 0.5 * (1 - (d - 7) / 7)) px.set(x, y, '#ffffff', 0.5);
    }
  for (const s of [-1, 1]) {
    const x = c + s * (R + 2);
    for (let k = 0; k < 4; k++) px.set(x + s * k, c, SPECTRUM[k], 0.6);
    px.set(x, c - 1, '#ffffff', 0.6);
    px.set(x, c + 1, '#ffffff', 0.6);
  }
  return px.sprite();
}

// ================================================================ Mittlerer Himmel (Wolken, Höhenwind, Abendrot)

/** Abendrot-Wolken erst, wenn sich der Himmel färbt (sonst hängen sie im Blau). */
const duskVis = (m: number) => clamp((m - 3350) / 350);

type Drifter = { alt: number; f: number; x: number; speed: number; s: Sprite; side?: number; dusk?: boolean };

const DAY = ['#ffffff', '#eef7ff', '#cfe6fa', '#a6c8ee', '#86addf'];
const SUNSET_PUFF = ['#fff0c0', '#ffc89a', '#f59a9a', '#c8709e', '#8a5296'];
const DUSK_PUFF = ['#f6c0c8', '#d692b8', '#a26eae', '#704e98', '#47397c'];

/**
 * Zwischen Wiese und Sternen (≈1.100–4.800 m): Haufenwolken in vier Parallax-Ebenen,
 * ferne Berggipfel tief unten mit ziehenden Wolkenschatten, Wolkenmeer, Vogelschwärme,
 * Flugzeuge mit Kondensstreifen, Federwolken und Windlinien im Höhenwind,
 * mehrfarbige Wolkenbänke im Abendrot. Alles beim Laden vorgezeichnet; pro Bild nur Blits.
 */
export class MidSkyRenderer {
  private cum: Drifter[] = [];
  private cirrus: Drifter[] = [];
  private mtn: Sprite[];
  private mtnShade: Sprite[];
  private sea: Sprite[];
  private banks: { alt: number; f: number; s: Sprite; speed: number }[] = [];
  private winds: Sprite[];
  private flocks: { alt: number; f: number; x: number; speed: number; frames: Sprite[] }[] = [];
  private plane: Sprite;
  private trail: Sprite;
  private trailFar: Sprite;
  private oldTrail: Sprite;
  private planeFar: Sprite;

  constructor() {
    const haze = (p: string[], sky: string, t: number) => p.map((c) => mix(c, sky, t));
    // Haufenwolken: fern (dunstig), mittel, nah, ganz vorne (seitlich vom Ballon)
    const layers: [number, number, number, number, number, number][] = [
      // [f, Anzahl, Breite min, Breite max, alt min, alt max]
      [0.32, 9, 44, 80, 1100, 3300],
      [0.55, 9, 64, 110, 1150, 2900],
      [0.82, 8, 80, 130, 1250, 2700],
      [1.25, 5, 110, 160, 1350, 2600],
    ];
    layers.forEach(([f, n, w0, w1, a0, a1], li) => {
      for (let i = 0; i < n; i++) {
        const seed = 700 + li * 31 + i;
        const alt = a0 + ((i + hash(i, li * 5 + 1) * 0.8) / n) * (a1 - a0);
        // Farbe: unten hellblauer Dunst, im Höhenwind tiefer blau
        const sky = alt > 2500 ? '#3f7ee8' : '#8ec8f8';
        const pal = li === 0 ? haze(DAY, sky, 0.42) : li === 1 ? haze(DAY, sky, 0.18) : DAY;
        const w = Math.round(w0 + hash(i, li * 5 + 2) * (w1 - w0));
        this.cum.push({
          alt,
          f,
          x: hash(i, li * 5 + 3) * 600,
          speed: 1.5 + hash(i, li * 5 + 4) * 3 + (alt > 2500 ? 6 : 0),
          s: cumulus(seed, w, pal, 0.3 + hash(i, li) * 0.6),
          side: li === 3 ? (i % 2 ? 1 : -1) : undefined,
        });
      }
    });
    // Abendrot: rosa-goldene Ballen, oben violett
    for (let i = 0; i < 10; i++) {
      const high = i >= 6;
      const f = [0.55, 0.85, 1.2][i % 3];
      this.cum.push({
        alt: high ? 4450 + hash(i, 61) * 300 : 3750 + hash(i, 61) * 650,
        f,
        x: hash(i, 62) * 600,
        speed: 2 + hash(i, 63) * 3,
        s: cumulus(800 + i, Math.round(50 + hash(i, 64) * 60), high ? DUSK_PUFF : SUNSET_PUFF, 0.3),
        side: f > 1 ? (i % 2 ? 1 : -1) : undefined,
        dusk: true,
      });
    }

    const mDay = ['#eef4ff', '#aebfee', '#7593dc', '#5570c0', '#8aa6e6', '#6c88d0', '#6d97ea'];
    const mDusk = ['#ffd6b8', '#d896b8', '#a072b0', '#6e4c94', '#b884b8', '#8a62a6', '#c47fc4'];
    this.mtn = [mountainStrip(11, mDay), mountainStrip(11, mDusk)];
    const dark = (p: string[]) => p.map((c) => mix(c, '#1c2468', 0.2));
    this.mtnShade = [mountainStrip(11, dark(mDay)), mountainStrip(11, dark(mDusk))];
    this.sea = [
      cloudBank(21, 240, 40, ['#ffffff', '#f0f7ff', '#d2e6fa', '#acc8ee', '#8eb2e6'], 'top', false),
      cloudBank(21, 240, 40, ['#fff0c8', '#ffc8a0', '#f0a0a8', '#c87aaa', '#a066a8'], 'top', false),
    ];
    // Wolkenbänke im Abendrot: unten von oben beleuchtet (gold/rosa), oben von unten (rosa/violett)
    const bankDefs: [number, number, string[], 'top' | 'bottom', number][] = [
      [3820, 0.5, ['#fff2b8', '#ffd08a', '#ffa28a', '#e0768e', '#b0588e'], 'top', 34],
      [4020, 0.72, ['#ffe6a8', '#ffb48a', '#f2868e', '#c46494', '#8e4c8e'], 'top', 30],
      [4300, 0.55, ['#ffe0a0', '#ffa888', '#e07a9a', '#a8609e', '#704a8e'], 'bottom', 38],
      [4500, 0.78, ['#ffc0a0', '#f08a9e', '#b868a8', '#7c5098', '#4e3c80'], 'bottom', 32],
      [4700, 0.62, ['#e89ab8', '#b878b0', '#80589e', '#523f86', '#33306a'], 'bottom', 30],
    ];
    bankDefs.forEach(([alt, f, pal, lit, h], i) => this.banks.push({ alt, f, s: cloudBank(31 + i, 240, h, pal, lit, true), speed: 1 + i * 0.6 }));
    for (let i = 0; i < 12; i++)
      this.cirrus.push({ alt: 2450 + hash(i, 71) * 1350, f: [0.45, 0.7, 1.05][i % 3], x: hash(i, 72) * 600, speed: 14 + hash(i, 73) * 16, s: cirrusSprite(900 + i, Math.round(50 + hash(i, 74) * 60)) });
    this.winds = [windLineSprite(34, false), windLineSprite(52, true), windLineSprite(70, false), windLineSprite(44, true)];
    const flockDefs: [number, number, number, string][] = [
      // [Höhe, f, Vögel (0 = Schwarm), Farbe]
      [1350, 0.85, 7, '#3a3352'],
      [1650, 0.6, 0, '#5a6a9a'],
      [1950, 0.9, 9, '#3a3352'],
      [2300, 0.55, 5, '#5a72a8'],
      [2650, 0.8, 0, '#3a4470'],
      [3000, 0.65, 7, '#3c4c88'],
    ];
    flockDefs.forEach(([alt, f, n, col], i) => {
      const frames = [0, 1].map((fr) => (n ? flockSprite(n, fr, col, 7) : swarmSprite(40 + i, fr, col)));
      const dir = i % 2 ? -1 : 1;
      this.flocks.push({ alt, f, x: hash(i, 81) * 500, speed: (7 + hash(i, 82) * 6) * dir, frames: dir > 0 ? frames : frames.map((s) => flipX(s)) });
    });
    this.plane = planeSprite();
    this.trail = contrailSprite(150, 5);
    this.trailFar = flipX(contrailSprite(90, 2)); // fliegt nach links
    this.oldTrail = (() => {
      // alter, schon zerfaserter Streifen schräg über den Himmel
      const px = new Px(200, 40);
      for (let x = 0; x < 200; x++) {
        const y = 34 - x * 0.15 + Math.sin(x * 0.06) * 2;
        for (let o = -2; o <= 2; o++) if (bayer(x, Math.round(y + o)) < 0.75 - Math.abs(o) * 0.25) px.set(x, y + o, '#ffffff', 0.35 * Math.sin((Math.PI * x) / 200));
      }
      return px.sprite();
    })();
    this.planeFar = fromRows(['.ww..', 'wwwww', '..w..'], { w: '#e8eef8' });
  }

  private drift(f: SkyFrame, d: { x: number; speed: number; f: number }, w: number): number {
    const span = f.W + w + 60;
    return Math.round(mod(d.x + (f.calm ? 0 : f.time * d.speed) - f.camX * d.f, span) - w - 30);
  }

  /** Fernste Ebenen: Berge tief unten mit Wolkenschatten, Wolkenmeer, ferne Wolkenbänke. */
  far(f: SkyFrame, anchorY: number) {
    const { ctx, W, camM, bottom } = f;
    if (camM < 900 || camM > 5200) return;
    // Berge: sinken beim Steigen langsam ab (sehr fern), erst hinter dem Wolkenband, dann darüber
    const vis = clamp((camM - 1300) / 400) * clamp((4700 - camM) / 500);
    const mtY = Math.round(anchorY - 72 + (camM - 1500) * 0.035);
    if (vis > 0 && mtY < bottom) {
      const dusk = clamp((camM - 3300) / 700);
      const off = mod(Math.round(-f.camX * 0.05 + (f.calm ? 0 : f.time * 0.4)), 256);
      for (let k = 0; k < 2; k++) {
        const a = vis * (k ? dusk : 1);
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        for (let x = off - 256; x < W; x += 256) ctx.drawImage(this.mtn[k], x, mtY);
        // Wolkenschatten ziehen über die Hänge (Ausschnitte der abgedunkelten Fassung, grob elliptisch)
        for (let i = 0; i < 3; i++) {
          const cx = mod(hash(i, 51) * 400 + (f.calm ? 0 : f.time * (5 + i * 2)), W + 120) - 60;
          const cw = 34 + Math.round(hash(i, 52) * 30);
          // Ellipse aus 4-px-Streifen, nach unten etwas breiter (Schatten fällt schräg auf die Hänge)
          for (let q = 0; q < 9; q++) {
            const u = (q + 0.5) / 9;
            const dw = Math.round(cw * Math.sqrt(1 - (2 * u - 1) ** 2) * (0.8 + u * 0.4));
            const dy = 12 + q * 4;
            const dh = 4;
            const x0 = Math.round(cx + (u - 0.5) * 10 - dw / 2);
            for (let tx = off - 256; tx < W; tx += 256) {
              const a0 = Math.max(x0, tx);
              const a1 = Math.min(x0 + dw, tx + 256);
              if (a1 > a0) ctx.drawImage(this.mtnShade[k], a0 - tx, dy, a1 - a0, dh, a0, mtY + dy, a1 - a0, dh);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      // Wolkenmeer vor dem Bergfuß, darunter Dunst bis zum Bildrand
      const seaY = mtY + 60;
      if (seaY < bottom) {
        const so = mod(Math.round(-f.camX * 0.08 + (f.calm ? 0 : f.time * 1.2)), 240);
        for (let k = 0; k < 2; k++) {
          const a = vis * (k ? dusk : 1);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          for (let x = so - 240; x < W; x += 240) ctx.drawImage(this.sea[k], x, seaY);
          ctx.fillStyle = k ? '#a066a8' : '#8eb2e6';
          if (seaY + 40 < bottom) ctx.fillRect(0, seaY + 40, W, bottom - seaY - 40);
        }
        ctx.globalAlpha = 1;
      }
    }
    // alter Kondensstreifen ganz fern
    const oy = f.at(3350, 0.3);
    if (oy > -40 && oy < bottom) ctx.drawImage(this.oldTrail, Math.round(W * 0.5 - 100 - f.camX * 0.05), oy);
    this.drawBanks(f, false);
  }

  private drawBanks(f: SkyFrame, near: boolean) {
    const { ctx, W, bottom } = f;
    const a = duskVis(f.camM);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    for (const b of this.banks) {
      if (b.f > 0.7 !== near) continue;
      const y = f.at(b.alt, b.f);
      if (y > bottom || y + b.s.height < 0) continue;
      const off = mod(Math.round(-f.camX * b.f * 0.5 + (f.calm ? 0 : f.time * b.speed)), 240);
      for (let x = off - 240; x < W; x += 240) ctx.drawImage(b.s, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawCum(f: SkyFrame, front: boolean) {
    const { ctx, bottom } = f;
    const dv = duskVis(f.camM);
    for (const c of this.cum) {
      if (c.f > 1 !== front || (c.dusk ? dv <= 0 : dv >= 1)) continue;
      const y = f.at(c.alt, c.f) - c.s.height;
      if (y > bottom || y + c.s.height < 0) continue;
      let x: number;
      if (c.side) {
        // ganz vorne: seitlich am Ballon vorbei, nie davor
        const sway = f.calm ? 0 : Math.sin(f.time * 0.1 + c.alt) * 8;
        x = Math.round(c.side > 0 ? f.balloonX + 34 + sway + hash(c.alt, 1) * 20 : f.balloonX - 34 - c.s.width - sway - hash(c.alt, 1) * 20);
      } else x = this.drift(f, c, c.s.width);
      // Tageswolken lösen sich im Abendrot auf, Abendwolken kommen dazu
      const a = c.dusk ? dv : 1 - dv;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(c.s, x, y);
      ctx.globalAlpha = 1;
    }
  }

  /** Hinter dem Ballon: Wolken, Federwolken, Vögel, Flugzeuge, Windlinien, nahe Wolkenbänke. */
  mid(f: SkyFrame) {
    const { ctx, W, camM, bottom, time, calm } = f;
    if (camM < 900 || camM > 5200) return;
    this.drawCum(f, false);
    for (const c of this.cirrus) {
      if (c.f > 1) continue;
      const y = f.at(c.alt, c.f);
      if (y < -12 || y > bottom) continue;
      ctx.drawImage(c.s, this.drift(f, c, c.s.width), y);
    }
    // Flugzeuge: eines nah mit breitem Streifen nach rechts, eines fern nach links
    const planeY = f.at(3100, 0.55);
    if (planeY > -10 && planeY < bottom) {
      const px = Math.round(mod(calm ? 120 : time * 16, W + 200) - 40);
      ctx.drawImage(this.trail, px - this.trail.width + 2, planeY + 3 - Math.floor(this.trail.height / 2) + 1);
      ctx.drawImage(this.plane, px, planeY);
    }
    const farY = f.at(2750, 0.4);
    if (farY > -10 && farY < bottom) {
      const px = Math.round(W + 100 - mod(calm ? 80 : time * 9 + 70, W + 200));
      ctx.drawImage(this.trailFar, px + 4, farY - 2);
      ctx.drawImage(this.planeFar, px, farY - 1);
    }
    for (const fl of this.flocks) {
      const y = f.at(fl.alt, fl.f) + (calm ? 0 : Math.round(Math.sin(time * 0.8 + fl.alt) * 3));
      const s = fl.frames[calm ? 0 : Math.floor(time * 4 + fl.alt) % 2];
      if (y < -20 || y > bottom) continue;
      ctx.drawImage(s, this.drift(f, fl, s.width), y);
    }
    // Windlinien im Höhenwind
    const wv = clamp((camM - 2350) / 300) * clamp((3950 - camM) / 300);
    if (wv > 0 && !calm) {
      ctx.globalAlpha = wv;
      for (let i = 0; i < 9; i++) {
        const s = this.winds[i % 4];
        const y = Math.round(hash(i, 91) * (bottom - 20)) + Math.round(Math.sin(time * 1.3 + i) * 3);
        const x = Math.round(mod(hash(i, 92) * 500 + time * (70 + i * 9), W + s.width + 120) - s.width - 60);
        ctx.drawImage(s, x, y);
      }
      ctx.globalAlpha = 1;
    }
    this.drawBanks(f, true);
  }

  /** Vor dem Ballon: große nahe Haufenwolken seitlich, nahe Federwolken. */
  front(f: SkyFrame) {
    if (f.camM < 900 || f.camM > 5200) return;
    this.drawCum(f, true);
    for (const c of this.cirrus) {
      if (c.f <= 1) continue;
      const y = f.at(c.alt, c.f);
      if (y < -12 || y > f.bottom) continue;
      f.ctx.drawImage(c.s, this.drift(f, c, c.s.width), y);
    }
  }
}
