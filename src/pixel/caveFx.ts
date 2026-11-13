/**
 * Lebendige Höhle und Hölle: Umgebung reagiert auf den Forscher und er auf sie
 * (Tropfen auf den Helm, Fledermausschwärme, Lampe spiegelt sich in Kristallen,
 * Pilze leuchten auf, Funken und Hitzeflimmern, Teufelchen springen weg, Antippen).
 * Schnittstelle: interact.ts. Aufgerufen von world.ts.
 *
 * Leistung (Pixel 9): alle Sprites werden einmal im Konstruktor vorgerechnet und nur geblittet,
 * keine Musterfüllung, kein getImageData im Bild-Takt, höchstens ein paar zusätzliche Lichter.
 * Kristalle und Pilze liest caveFx aus den festen Lichtern der Schacht-Abschnitte (baked) –
 * ihre Lage muss nicht doppelt geführt werden.
 */
import type { Images } from './assets';
import { hellTargets } from './hellShared';
import type { FxFrame, Rect } from './interact';
import { batSprites, canvas, CRYSTAL_COLORS, type Sprite } from './sprites';
import { caveZoneAt, GATE_M, HELL_M, LAVAFALL, type CaveZone } from './zones';

const PPM = 0.5;
const TAU = Math.PI * 2;

const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Farben der festen Lichter, an denen caveFx Kristalle bzw. Pilze erkennt. */
const CRYSTAL_LIGHT = new Set(CRYSTAL_COLORS.map((c) => c[1]));
const SHROOM_LIGHT = new Set(['#63f0d0', '#b8f05a', '#f08ae6']);
const LAVA_LIGHT = new Set(['#ff7a2b', '#ffb347', '#e2541e', '#ff9a3c']);

interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  /** gehört zum vorbeiziehenden Schwarm (sonst: aufgescheucht durch Antippen) */
  swarm: boolean;
}
interface Drop {
  x: number;
  y: number;
  vy: number;
  /** -1 eigene Figur, sonst Index des Mitspielers */
  target: number;
  hit: boolean;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  near: boolean;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  color: string;
  /** über der Dunkelheit (leuchtet) oder darunter (Staub, Schnee) */
  glow: boolean;
}
/** Kurzlebige Sprite-Effekte: Spritzer, Ring, Blubbern, Funkeln. */
interface Blip {
  kind: 'splash' | 'ring' | 'blurp' | 'twinkle';
  x: number;
  y: number;
  t: number;
  dur: number;
  frames: Sprite[];
  glow: boolean;
}

export class CaveFx {
  private bat: Sprite[];
  private splash: Sprite[];
  private twinkle: Sprite[];
  private twinkleBlue: Sprite[];
  private ringPink: Sprite[];
  private ringBlue: Sprite[];
  private blurps = new Map<string, Sprite[]>();

  private bats: Bat[] = [];
  private swarm: { dir: -1 | 1; ducked: boolean; crew: Set<number> } | null = null;
  private drops: Drop[] = [];
  private sparks: Spark[] = [];
  private parts: Particle[] = [];
  private blips: Blip[] = [];
  /** Pilze im Lampenlicht: Helligkeit je Pilz (Schlüssel aus Welt-Koordinaten). */
  private lit = new Map<string, { x: number; y: number; c: string; v: number; seen: boolean }>();
  /** Zwischenbild fürs Hitzeflimmern im Vordergrund (eine Kopie pro Bild, keine Selbstkopien). */
  private haze: [Sprite, CanvasRenderingContext2D] = canvas(8, 8);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_img: Images) {
    this.bat = batSprites();
    this.splash = [0, 1, 2].map((f) => {
      const [c, x] = canvas(9, 6);
      x.fillStyle = f === 0 ? '#cfe8ff' : '#9fd8ff';
      if (f === 0) {
        x.fillRect(3, 3, 3, 2);
        x.fillRect(4, 2, 1, 1);
      } else {
        const r = f + 1;
        for (const s of [-1, 1]) {
          x.fillRect(4 + s * r, 4 - f, 1, 1);
          x.fillRect(4 + s * (r + 1), 5 - f + 1, 1, 1);
        }
        x.fillStyle = '#cfe8ff';
        x.fillRect(4, 3 - f, 1, 1);
      }
      return c;
    });
    this.twinkle = twinkles('#ffffff', '#ff9bd0');
    this.twinkleBlue = twinkles('#ffffff', '#8be9fd');
    this.ringPink = rings('#f6e6ff', '#c79bf2');
    this.ringBlue = rings('#e9fbff', '#7fe3f5');
  }

  // ------------------------------------------------------------------ Hilfen

  private zoneAt(f: FxFrame, y: number): CaveZone {
    return caveZoneAt(Math.max(0, (y - f.oy) / PPM));
  }

  private blurp(color: string): Sprite[] {
    let s = this.blurps.get(color);
    if (!s) this.blurps.set(color, (s = blurpFrames(color)));
    return s;
  }

  private puff(x: number, y: number, n: number, colors: string[], o: { speed: number; up: number; g: number; life: number; glow: boolean }, calm: boolean) {
    for (let i = 0; i < n && this.parts.length < 90; i++) {
      const a = Math.random() * TAU;
      const sp = calm ? 0 : o.speed * (0.4 + Math.random() * 0.6);
      const r = calm ? 2 + Math.random() * 6 : 0;
      this.parts.push({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r * 0.7,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - (calm ? 0 : o.up),
        g: calm ? 0 : o.g,
        life: 0,
        max: o.life * (0.6 + Math.random() * 0.5),
        color: colors[i % colors.length],
        glow: o.glow,
      });
    }
  }

  private blip(kind: Blip['kind'], x: number, y: number, frames: Sprite[], dur: number, glow = true) {
    if (this.blips.length < 16) this.blips.push({ kind, x, y, t: 0, dur, frames, glow });
  }

  /** Nächstes festes Licht (Kristall/Pilz/Lava) einer Farbgruppe in Reichweite. */
  private nearestLight(f: FxFrame, x: number, y: number, set: Set<string>, reach: number) {
    let best: [number, number, string] | null = null;
    let bd = reach * reach;
    for (const [lx, ly, , c, baked] of f.lights) {
      if (!baked || !c || !set.has(c)) continue;
      const d = (lx - x) ** 2 + (ly - y) ** 2;
      if (d < bd) {
        bd = d;
        best = [lx, ly, c];
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ Ebenen

  /** Hinter dem Forscher (nach Schacht und Hölle, unter der Dunkelheit). */
  back(f: FxFrame) {
    const { ix, dt, calm } = f;
    this.handleTaps(f);
    const e = ix.explorerAnchor;
    const zone = caveZoneAt(f.depth);
    const shaft = f.depth < HELL_M;

    // --- Zufallsereignisse (Raten pro Sekunde; ix.chance halbiert bei Fragen, 15 % bei reduzierter Bewegung)
    if (e) {
      if ((zone === 'earth' || zone === 'rock' || zone === 'crystal' || zone === 'shroom' || zone === 'icehell') && f.depth > 40 && this.drops.length < 2 && ix.chance(1 / 9, dt))
        this.spawnDrop(f);
      const batRate = zone === 'rock' ? 1 / 26 : zone === 'earth' || zone === 'crystal' ? 1 / 45 : 0;
      if (!calm && !this.swarm && batRate && f.depth > 60 && ix.chance(batRate, dt)) this.spawnSwarm(f);
      const hot = zone === 'lava' || zone === 'hell' || (f.depth > LAVAFALL[0] - 100 && f.depth < HELL_M + 300);
      if (hot && this.sparks.length < 6 && ix.chance(zone === 'hell' ? 1 / 4 : 1 / 3, dt)) this.spawnSparks(f);
    }

    // --- Pilze leuchten auf, wenn die Stirnlampe sie erreicht (sanft ein- und ausblenden)
    if (shaft || f.depth < HELL_M + 200) this.shroomGlow(f);
    else this.lit.clear();
  }

  /** Vor dem Forscher, noch unter der Dunkelheit (wird von ihr abgedunkelt, Lampe hellt auf). */
  front(f: FxFrame) {
    const { ctx, dt, ix, W, H } = f;
    const e = ix.explorerAnchor;

    // --- Tropfen fallen auf den Helm
    for (const d of this.drops) {
      d.vy += 260 * dt;
      d.y += d.vy * dt;
      const tgt = d.target < 0 ? (e ? { x: e.head.x + 4, y: e.head.y } : null) : ix.crewAnchors[d.target] ? { x: ix.crewAnchors[d.target].x, y: ix.crewAnchors[d.target].y - 10 } : null;
      if (!d.hit && tgt && d.y >= tgt.y && d.y - d.vy * dt < tgt.y + 2) {
        if (Math.abs(d.x - tgt.x) <= 5) {
          d.hit = true;
          if (d.target < 0) {
            ix.explorer.react('flinch', 0.45, d.x < tgt.x ? 1 : -1);
            ix.explorer.push((d.x < tgt.x ? 1 : -1) * 4);
          } else ix.crew[d.target]?.push((Math.random() < 0.5 ? -1 : 1) * 4);
          this.blip('splash', Math.round(d.x) - 4, Math.round(tgt.y) - 4, this.splash, 0.3, false);
        }
      }
      if (!d.hit && d.y < H + 4 && !ix.overUi({ x: d.x, y: d.y, w: 1, h: 3 })) {
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 2);
        ctx.fillStyle = '#e8f6ff';
        ctx.fillRect(Math.round(d.x), Math.round(d.y) + 2, 1, 1);
      }
    }
    this.drops = this.drops.filter((d) => !d.hit && d.y < H + 4);

    // --- Fledermäuse (Schwarm zieht vorbei, Aufgescheuchte flattern davon)
    if (this.bats.length) this.updateBats(f);

    // --- Partikel unter der Dunkelheit (Staub, Schnee)
    this.stepParticles(f, false);
    this.drawBlips(f, false);

    // --- Hitzeflimmern vorn: Lavazone und Hölle (am Lavafall flimmert world.ts schon)
    const hotZone = (f.depth >= 2300 && f.depth < LAVAFALL[0] - 80) || (f.depth > HELL_M + 160 && f.depth < GATE_M - 100);
    if (e && hotZone && !f.calm) this.hazeBand(f, e.y + 12, Math.min(H, e.y + 64), W);
  }

  /** Über der Dunkelheit: Leuchtendes im Vordergrund (Funken, Glut, Glitzern). */
  glow(f: FxFrame) {
    const { ctx, dt, ix } = f;
    const e = ix.explorerAnchor;

    // --- Kristalle spiegeln die Stirnlampe
    if (e && f.depth < HELL_M) this.crystalGlints(f, e.lamp);

    // --- Funken fliegen vor der Figur vorbei
    for (const s of this.sparks) {
      s.life -= dt;
      if (s.life > 0) continue; // noch nicht gestartet (gestaffelt)
      s.vy -= 10 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (e && !s.near && Math.abs(s.x - (e.head.x + 4)) < 5 && Math.abs(s.y - (e.head.y + 2)) < 5) {
        s.near = true;
        if (!ix.explorer.busy && Math.random() < 0.5) ix.explorer.react('flinch', 0.35, s.vx > 0 ? 1 : -1);
      }
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      if (ix.overUi({ x: x - 2, y: y - 2, w: 5, h: 5 })) continue;
      const tx = -Math.sign(s.vx);
      const ty = -Math.sign(s.vy);
      ctx.fillStyle = '#ff6a2b';
      ctx.fillRect(x + tx * 2, y + ty * 2, 1, 1);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(x + tx, y + ty, 1, 1);
      ctx.fillStyle = '#fff1b0';
      ctx.fillRect(x, y, 1, 1);
    }
    this.sparks = this.sparks.filter((s) => s.life > -3 && s.y > -10 && s.x > -10 && s.x < f.W + 10);

    this.stepParticles(f, true);
    this.drawBlips(f, true);
    // Zeitablauf der Blips einmal pro Bild (hier am Ende)
    for (const b of this.blips) b.t += dt;
    this.blips = this.blips.filter((b) => b.t < b.dur);
  }

  // ------------------------------------------------------------------ Ereignisse

  private spawnDrop(f: FxFrame) {
    const { ix } = f;
    const crew = ix.crewAnchors;
    const target = crew.length && Math.random() < 0.25 ? Math.floor(Math.random() * crew.length) : -1;
    const e = ix.explorerAnchor!;
    const x = target < 0 ? e.head.x + 4 : crew[target].x;
    const y = target < 0 ? e.head.y : crew[target].y - 10;
    this.drops.push({ x, y: Math.max(-4, y - 70 - Math.random() * 30), vy: 0, target, hit: false });
  }

  private spawnSwarm(f: FxFrame) {
    const e = f.ix.explorerAnchor!;
    const dir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
    const y0 = e.head.y - 2 + Math.round((Math.random() - 0.5) * 10);
    const n = f.ix.quiet ? 4 : 6;
    this.swarm = { dir, ducked: false, crew: new Set() };
    for (let i = 0; i < n; i++)
      this.bats.push({
        x: dir > 0 ? -16 - i * 7 - Math.random() * 10 : f.W + 4 + i * 7 + Math.random() * 10,
        y: y0 + Math.round((Math.random() - 0.5) * 14),
        vx: dir * (68 + Math.random() * 14),
        vy: 0,
        ph: Math.random() * TAU,
        swarm: true,
      });
  }

  private spawnSparks(f: FxFrame) {
    const e = f.ix.explorerAnchor!;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const n = 2 + Math.floor(Math.random() * 3);
    // fliegen schräg von unten seitlich an der Figur vorbei (Kopfhöhe ± ein paar Pixel)
    for (let i = 0; i < n; i++) {
      const vx = dir * (34 + Math.random() * 24);
      const vy = -(30 + Math.random() * 20);
      const tHit = 1.1 + Math.random() * 0.4; // Zeit bis Kopfhöhe
      const ox = (Math.random() - 0.5) * 18;
      const oy = (Math.random() - 0.5) * 12;
      this.sparks.push({
        x: e.head.x + 4 + ox - vx * tHit,
        y: e.head.y + 2 + oy - vy * tHit,
        vx,
        vy,
        life: i * 0.12, // gestaffelt: Wartezeit bis zum Start, danach negatives Alter
        near: false,
      });
    }
  }

  // ------------------------------------------------------------------ Antippen

  private handleTaps(f: FxFrame) {
    const { ix, calm, W, H } = f;
    // Teufelchen und Feuerseen der Hölle zuerst (genaue Ziele)
    for (const t of hellTargets.list) {
      const tap = ix.takeTap({ x: t.x - 3, y: t.y - 3, w: t.w + 6, h: t.h + 6 });
      if (!tap) continue;
      if (t.kind === 'imp') {
        hellTargets.poked.set(t.id, f.time);
        this.puff(t.x + 9, t.y + 19, 4, ['#ffb347', '#ff6a2b'], { speed: 14, up: 10, g: 20, life: 0.6, glow: true }, calm);
      } else this.lavaBlurp(f, tap.x, t.y + 2, t.color ?? '#ffb347');
    }
    for (let tap = ix.takeTap({ x: 0, y: 0, w: W, h: H }); tap; tap = ix.takeTap({ x: 0, y: 0, w: W, h: H })) {
      const zone = this.zoneAt(f, tap.y);
      const { x, y } = tap;
      if (zone === 'earth' || zone === 'rock') {
        // Fledermäuse flattern auf, etwas Staub rieselt
        const n = calm ? 0 : 3;
        for (let i = 0; i < n; i++)
          this.bats.push({ x: x - 6 + (i - 1) * 6, y: y - 3 + Math.random() * 4, vx: (i - 1) * 22 + (Math.random() - 0.5) * 16, vy: -38 - Math.random() * 16, ph: Math.random() * TAU, swarm: false });
        this.puff(x, y, 5, zone === 'earth' ? ['#8a5a34', '#5a3b2a'] : ['#9a8fa8', '#6d6478'], { speed: 10, up: 0, g: 40, life: 0.8, glow: false }, calm);
      } else if (zone === 'crystal' || zone === 'crystalhell') {
        // Kristall klingt: Ring und Funkeln, am nächsten Kristall wenn einer in Reichweite ist
        const c = this.nearestLight(f, x, y, CRYSTAL_LIGHT, 26);
        const cx = c ? c[0] : x;
        const cy = c ? c[1] - 3 : y;
        this.blip('ring', cx - 10, cy - 10, this.ringPink, 0.5);
        for (let i = 0; i < 3; i++) this.blip('twinkle', Math.round(cx - 3 + (Math.random() - 0.5) * 14), Math.round(cy - 3 + (Math.random() - 0.5) * 12), this.twinkle, 0.45 + i * 0.1);
        this.puff(cx, cy, 6, ['#ffffff', '#c79bf2', '#ff9bd0'], { speed: 22, up: 4, g: 8, life: 0.9, glow: true }, calm);
      } else if (zone === 'shroom' || zone === 'abyss') {
        // Pilz pufft Sporen, leuchtet kurz auf
        const c = this.nearestLight(f, x, y, SHROOM_LIGHT, 26);
        const cx = c ? c[0] : x;
        const cy = c ? c[1] - 2 : y;
        if (c) {
          const l = this.lit.get(`${Math.round(c[0])},${Math.round(c[1] - f.oy)}`);
          if (l) l.v = 1.6;
        }
        const cols = zone === 'abyss' ? ['#3af0c8', '#9afff0', '#a888ff'] : ['#d8ff7a', '#7af0d0', '#f0a0e8'];
        this.puff(cx, cy, 10, cols, { speed: 12, up: 12, g: -4, life: 1.8, glow: true }, calm);
      } else if (zone === 'lava') {
        const c = this.nearestLight(f, x, y, LAVA_LIGHT, 22);
        if (c) this.lavaBlurp(f, c[0], c[1], '#ffb347');
        else this.puff(x, y, 7, ['#ffb347', '#ff6a2b', '#ffe28a'], { speed: 16, up: 14, g: -10, life: 1.1, glow: true }, calm);
      } else if (zone === 'icehell') {
        this.blip('ring', x - 10, y - 10, this.ringBlue, 0.5);
        this.blip('twinkle', x - 3, y - 3, this.twinkleBlue, 0.5);
        this.puff(x, y, 8, ['#e8f6ff', '#bfe8ff'], { speed: 14, up: 2, g: 14, life: 1.4, glow: false }, calm);
      } else {
        // Hölle abseits von Zielen: Glut stiebt auf
        this.puff(x, y, 7, ['#ffb347', '#ff6a2b', '#ffe28a'], { speed: 16, up: 14, g: -10, life: 1.1, glow: true }, calm);
      }
    }
  }

  private lavaBlurp(f: FxFrame, x: number, y: number, color: string) {
    this.blip('blurp', Math.round(x) - 4, Math.round(y) - 6, this.blurp(color), 0.55);
    this.puff(x, y - 2, 5, [color, '#ffe28a', '#ff6a2b'], { speed: 18, up: 26, g: 70, life: 0.8, glow: true }, f.calm);
  }

  // ------------------------------------------------------------------ Teile

  private updateBats(f: FxFrame) {
    const { ctx, dt, ix, W, H, time } = f;
    const e = ix.explorerAnchor;
    const sw = this.swarm;
    for (const b of this.bats) {
      if (b.swarm) {
        b.x += b.vx * dt;
        b.y += Math.sin(time * 9 + b.ph) * 18 * dt;
      } else {
        // aufgescheucht: steigen, werden schneller, flattern zickzack
        b.vy -= 10 * dt;
        b.vx += Math.sign(b.vx || 1) * 20 * dt;
        b.x += (b.vx + Math.sin(time * 11 + b.ph) * 20) * dt;
        b.y += b.vy * dt;
      }
    }
    if (sw) {
      // Figur duckt sich, wenn der Schwarm sie gleich erreicht
      if (e && !sw.ducked && this.bats.some((b) => b.swarm && (b.x + 6 - e.x) * sw.dir > -30 && (b.x + 6 - e.x) * sw.dir < 0 && Math.abs(b.y - e.head.y) < 14)) {
        sw.ducked = true;
        ix.explorer.react('duck', 0.9, sw.dir);
        ix.explorer.push(sw.dir * 5);
      }
      ix.crewAnchors.forEach((a, i) => {
        if (sw.crew.has(i)) return;
        if (this.bats.some((b) => b.swarm && Math.abs(b.x + 6 - a.x) < 6 && Math.abs(b.y - (a.y - 8)) < 14)) {
          sw.crew.add(i);
          ix.crew[i]?.push(sw.dir * 4);
        }
      });
    }
    this.bats = this.bats.filter((b) => b.x > -40 && b.x < W + 40 && b.y > -20 && b.y < H + 20);
    if (!this.bats.some((b) => b.swarm)) this.swarm = null;
    const calm = f.calm;
    for (const b of this.bats) {
      const r: Rect = { x: b.x, y: b.y, w: 13, h: 6 };
      if (ix.overUi(r)) continue;
      ctx.drawImage(this.bat[calm ? 0 : Math.floor(time * 12 + b.ph) % 2], Math.round(b.x), Math.round(b.y));
    }
  }

  private stepParticles(f: FxFrame, glow: boolean) {
    const { ctx, dt, ix } = f;
    let any = false;
    for (const p of this.parts) {
      if (p.glow !== glow) continue;
      any = true;
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 1.5;
      if (p.life >= p.max) continue;
      if (p.max - p.life < 0.2 && Math.floor(p.life * 30) % 2) continue; // flackert aus
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (ix.overUi({ x, y, w: 1, h: 1 })) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, 1, 1);
    }
    if (any) this.parts = this.parts.filter((p) => p.life < p.max);
  }

  private drawBlips(f: FxFrame, glow: boolean) {
    const { ctx, ix } = f;
    for (const b of this.blips) {
      if (b.glow !== glow) continue;
      const fr = b.frames[Math.min(b.frames.length - 1, Math.floor((b.t / b.dur) * b.frames.length))];
      if (ix.overUi({ x: b.x, y: b.y, w: fr.width, h: fr.height })) continue;
      ctx.drawImage(fr, b.x, b.y);
    }
  }

  /** Pilze im Lichtkegel der Stirnlampe glimmen heller (wenige zusätzliche Lichter, weich überblendet). */
  private shroomGlow(f: FxFrame) {
    const { ix, dt } = f;
    const lamp = ix.explorerAnchor?.lamp;
    for (const l of this.lit.values()) l.seen = false;
    if (lamp) {
      const reach = 50;
      for (const [lx, ly, , c, baked] of f.lights) {
        if (!baked || !c || !SHROOM_LIGHT.has(c)) continue;
        if (Math.abs(lx - lamp.x) > reach || Math.abs(ly - lamp.y) > reach) continue;
        if (this.zoneAt(f, ly) !== 'shroom') continue;
        const key = `${Math.round(lx)},${Math.round(ly - f.oy)}`;
        let s = this.lit.get(key);
        if (!s) this.lit.set(key, (s = { x: lx, y: ly, c, v: 0, seen: true }));
        s.x = lx;
        s.y = ly;
        s.seen = Math.hypot(lx - lamp.x, ly - lamp.y) < reach;
      }
    }
    // weich ein-/ausblenden, die hellsten (nächsten) bekommen ein Licht – höchstens 6
    const on: { x: number; y: number; c: string; v: number }[] = [];
    for (const [k, s] of this.lit) {
      const target = s.seen ? 1 : 0;
      const rate = f.calm ? 6 : 1.6;
      if (s.v > 1) s.v -= dt * 0.8; // nach dem Antippen kurz überhell
      else s.v += Math.sign(target - s.v) * Math.min(Math.abs(target - s.v), rate * dt);
      if (s.v <= 0.01 && !s.seen) {
        this.lit.delete(k);
        continue;
      }
      // Position mitführen, auch wenn der Pilz gerade außer Reichweite ist
      if (!s.seen) s.y = Number(k.split(',')[1]) + f.oy;
      on.push(s);
    }
    on.sort((a, b) => b.v - a.v);
    for (const s of on.slice(0, 6)) if (s.v > 0.08) f.lights.push([Math.round(s.x), Math.round(s.y), Math.round(4 + 7 * Math.min(1.4, s.v)), s.c]);
  }

  /** Glanzpunkte, wo das Lampenlicht auf Kristalle trifft; sie wandern mit Pendeln und Abstieg. */
  private crystalGlints(f: FxFrame, lamp: { x: number; y: number; r: number }) {
    const { ctx, ix, time, calm } = f;
    const reach = 66;
    const hits: [number, number, number][] = [];
    for (const [lx, ly, , c, baked] of f.lights) {
      if (!baked || !c || !CRYSTAL_LIGHT.has(c)) continue;
      const dx = lx - lamp.x;
      const dy = ly - lamp.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.hypot(dx, dy);
      if (d < reach) hits.push([lx, ly, 1 - d / reach]);
    }
    if (!hits.length) return;
    hits.sort((a, b) => b[2] - a[2]);
    for (const [lx, ly, q] of hits.slice(0, 6)) {
      const h = hash(Math.round(lx), Math.round(ly - f.oy));
      // Facette blitzt auf, wenn der Winkel Lampe→Kristall passt: hängt an Lampenposition (Pendeln, Fahrt)
      const ph = (h * 7 + (lamp.x - lx) * 0.09 + (lamp.y - ly) * 0.035 + time * 0.22) % 1;
      const p = ph < 0 ? ph + 1 : ph;
      const win = 0.1 + 0.25 * q;
      let fr = -1;
      if (calm) fr = q > 0.45 ? 1 : -1;
      else if (p < win) fr = p < win * 0.33 ? 1 : p < win * 0.66 ? 2 : 0;
      if (fr < 0) continue;
      const gx = Math.round(lx - 3 + (hash(h, 3) - 0.5) * 6);
      const gy = Math.round(ly - 6 + (hash(h, 4) - 0.5) * 6);
      if (ix.overUi({ x: gx, y: gy, w: 7, h: 7 })) continue;
      ctx.drawImage(this.twinkle[fr], gx, gy);
    }
  }

  /** Hitzeflimmern unter der Figur: ein Bereich einmal kopiert, Zeilenbänder ±1 px versetzt zurück. */
  private hazeBand(f: FxFrame, y0: number, y1: number, W: number) {
    y0 = Math.max(0, Math.round(y0));
    y1 = Math.round(y1);
    if (y1 - y0 < 4) return;
    const { ctx, time } = f;
    const [sc, sctx] = this.haze;
    const h = y1 - y0;
    if (sc.width !== W || sc.height < h) {
      sc.width = W;
      sc.height = Math.max(h, sc.height);
    }
    sctx.clearRect(0, 0, W, h);
    sctx.drawImage(ctx.canvas, 0, y0, W, h, 0, 0, W, h);
    for (let y = y0; y < y1; y += 2) {
      // nach unten (näher an der Glut) stärker
      const k = (y - y0) / h;
      const dx = Math.round(Math.sin(y * 0.5 - time * 6) * (0.4 + k * 0.9));
      if (dx === 0) continue;
      const bh = Math.min(2, y1 - y);
      ctx.drawImage(sc, 0, y - y0, W, bh, dx, y, W, bh);
    }
  }
}

// ------------------------------------------------------------------ Sprites

/** Funkeln: Punkt, kleines Kreuz, großes Kreuz (7×7). */
function twinkles(core: string, arm: string): Sprite[] {
  return [0, 1, 2].map((f) => {
    const [c, x] = canvas(7, 7);
    x.fillStyle = core;
    x.fillRect(3, 3, 1, 1);
    for (let i = 1; i <= f + 1 && f > 0; i++) {
      x.fillStyle = i === 1 ? core : arm;
      x.fillRect(3 + i, 3, 1, 1);
      x.fillRect(3 - i, 3, 1, 1);
      x.fillRect(3, 3 + i, 1, 1);
      x.fillRect(3, 3 - i, 1, 1);
    }
    return c;
  });
}

/** Klang-Ring (21×21): wächst in 4 Stufen, wird lückenhaft. */
function rings(inner: string, outer: string): Sprite[] {
  return [3, 5, 7, 9].map((r, f) => {
    const [c, x] = canvas(21, 21);
    const n = Math.round(r * 6.3);
    for (let i = 0; i < n; i++) {
      if (f >= 2 && i % (f === 3 ? 3 : 4) === 0) continue;
      const a = (i / n) * TAU;
      x.fillStyle = f < 2 ? inner : outer;
      x.fillRect(Math.round(10 + Math.cos(a) * r), Math.round(10 + Math.sin(a) * r * 0.8), 1, 1);
    }
    return c;
  });
}

/** Lava blubbert: Blase wächst, platzt in Tropfen (9×8, 4 Bilder). */
function blurpFrames(color: string): Sprite[] {
  const hot = '#ffe28a';
  const dark = '#c9541e';
  return [0, 1, 2, 3].map((f) => {
    const [c, x] = canvas(9, 8);
    if (f < 2) {
      const w = f ? 5 : 3;
      const h = f ? 3 : 2;
      x.fillStyle = color;
      x.fillRect(4 - (w >> 1), 7 - h, w, h);
      x.fillStyle = hot;
      x.fillRect(4 - (w >> 1) + 1, 7 - h, 1, 1);
      x.fillStyle = dark;
      x.fillRect(4 - (w >> 1), 7, w, 1);
    } else {
      x.fillStyle = f === 2 ? hot : color;
      const r = f === 2 ? 2 : 4;
      for (const [dx, dy] of [
        [-r, 0],
        [r, 0],
        [-1, -r + 1],
        [1, -r],
      ])
        x.fillRect(4 + dx, 6 + dy, 1, 1);
      x.fillStyle = dark;
      x.fillRect(3, 7, 3, 1);
    }
    return c;
  });
}
