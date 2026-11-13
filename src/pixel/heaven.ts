/**
 * Der Himmel über den Sternen: Der Ballon steigt durch eine leuchtende Wolkendecke,
 * darüber goldene und weiße Wolkeninseln, ein schwebender Tempel, Säulenruinen,
 * Regenbogenbrücken, Lichtstrahlen und Engelchen, die mitfliegen. Bei 7.000 m das
 * Himmelstor. Darüber endlos: Kristallwolken, Polarlicht, Weltraum mit Planeten.
 *
 * Koordinaten wie in world.ts: y = Bildschirm über at(m, f) (Höhe in Metern, Parallax f).
 */
import type { Images } from './assets';
import { crystalCluster } from './decor';
import { canvas, rampMap, recolor, type Sprite } from './sprites';
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
  private space: Record<string, HTMLImageElement>;
  private spaceFlip: Sprite;
  private starsFlip: Sprite;
  private planets: HTMLImageElement;
  private rainbow = new Map<number, Sprite>();
  private shards: Sprite[];

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
      ctx.fillStyle = '#ffe8a8';
      for (let y = 0; y < bottom; y += 2) {
        const sx = x0 + Math.round(y * 0.35);
        ctx.fillRect(sx, y, w, 2);
      }
    }
    ctx.restore();
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
          const c = Math.floor(hash(j, li) * 6);
          ctx.drawImage(this.columns, c * 32, 0, 32, 96, x + 20, y - 92 + bob, 32, 96);
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

  /** Engelchen begleiten den Ballon im Himmel. */
  private angels(f: SkyFrame) {
    const vis = clamp((f.camM - HEAVEN_M) / 200) * clamp((GATE_M + 600 - f.camM) / 300);
    if (vis <= 0) return;
    const { ctx, time, calm } = f;
    ctx.globalAlpha = vis;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const fr = calm ? 0 : Math.floor(time * 6 + i * 2) % 4;
      const x = Math.round(f.balloonX + side * (42 + (calm ? 0 : Math.sin(time * 0.7 + i) * 8)) - 17);
      const y = Math.round(f.balloonY - 70 + i * 26 + (calm ? 0 : Math.sin(time * 1.4 + i * 2) * 5));
      ctx.drawImage(this.angel, fr * 34, 0, 34, 43, x, y, 34, 43);
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
      if (f.camM > GATE_M) ctx.drawImage(this.shards[i % 3], x - 6, y + 10);
    }
  }

  /** Kristallwolken (7.000–9.000 m): schwebende Kristalle in Wolkenfetzen, funkeln. */
  private crystals(f: SkyFrame) {
    if (f.camM < GATE_M - 300 || f.camM > GATE_M + 2600) return;
    const { ctx, W, time, calm } = f;
    for (let i = 0; i < 16; i++) {
      const m = GATE_M + 150 + i * 120 + hash(i, 121) * 80;
      const par = i % 3 === 0 ? 0.6 : 0.85;
      const y = f.at(m, par) + (calm ? 0 : Math.round(Math.sin(time * 0.8 + i) * 3));
      if (y < -30 || y > f.bottom) continue;
      const side = i % 2 ? 1 : -1;
      const x = Math.round(f.balloonX + side * (36 + hash(i, 122) * (W / 2 - 40)) - 8);
      const shard = this.shards[i % 3];
      ctx.globalAlpha = par < 0.7 ? 0.6 : 1;
      ctx.drawImage(shard, x, y);
      if (!calm && Math.sin(time * 3 + i * 2) > 0.85) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 4, y + 2, 1, 3);
        ctx.fillRect(x + 3, y + 3, 3, 1);
      }
    }
    ctx.globalAlpha = 1;
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
      for (let x = 0; x < W; x += 2) {
        const base = bottom * (0.25 + ph * 0.06) + Math.sin(x * 0.03 + (calm ? 0 : time * 0.4) + ph) * 14 + Math.sin(x * 0.011 + ph) * 20;
        const len = 26 + Math.round(Math.sin(x * 0.05 + ph * 2 + (calm ? 0 : time * 0.7)) * 12);
        for (let k = 0; k < len; k += 2) {
          ctx.globalAlpha = s * 0.18 * (1 - k / len);
          ctx.fillStyle = color;
          ctx.fillRect(x, Math.round(base + k), 2, 2);
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
