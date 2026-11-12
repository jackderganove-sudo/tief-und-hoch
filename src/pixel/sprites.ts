/**
 * Eigene Pixel-Sprites – als Textraster oder prozedural gezeichnet, im selben
 * 16-px-Raster und mit Farben, die aus den Ansimuz-Grafiken übernommen sind.
 */
export type Sprite = HTMLCanvasElement;

export function canvas(w: number, h: number): [Sprite, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Textraster → Sprite. Jedes Zeichen ist ein Pixel, '.' ist durchsichtig. */
export function fromRows(rows: string[], pal: Record<string, string>): Sprite {
  const [c, ctx] = canvas(Math.max(...rows.map((r) => r.length)), rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return c;
}

export function flipX(src: CanvasImageSource & { width: number; height: number }): Sprite {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Färbt ein Bild Pixel für Pixel um (Alpha bleibt). */
export function recolor(
  src: CanvasImageSource & { width: number; height: number },
  fn: (r: number, g: number, b: number) => [number, number, number],
): Sprite {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [r, g, b] = fn(d[i], d[i + 1], d[i + 2]);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Abbildung der Helligkeit auf eine Farbrampe (dunkel → hell). */
export function rampMap(ramp: string[]) {
  const cols = ramp.map(hex);
  return (r: number, g: number, b: number): [number, number, number] => {
    const l = Math.min(0.999, (0.3 * r + 0.5 * g + 0.2 * b) / 255);
    const f = l * (cols.length - 1);
    const i = Math.floor(f);
    const t = f - i;
    const a = cols[i];
    const z = cols[i + 1];
    return [Math.round(a[0] + (z[0] - a[0]) * t), Math.round(a[1] + (z[1] - a[1]) * t), Math.round(a[2] + (z[2] - a[2]) * t)];
  };
}

export function lerpColor(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
}

// ---------------------------------------------------------------- Höhlenforscher

const EXPLORER_PAL = {
  k: '#1b1424', // Kontur
  y: '#f7c531', // Helm
  o: '#d99a1e', // Helm-Schatten
  L: '#fff6c2', // Stirnlampe
  s: '#f3c59d', // Haut
  d: '#c98f6b', // Haut-Schatten
  b: '#3f7cc0', // Jacke
  B: '#2b558f', // Jacke-Schatten
  g: '#8a5a34', // Gurt
  p: '#6a4a3c', // Hose
  P: '#4b3329', // Hose-Schatten
  t: '#2c2230', // Stiefel
  r: '#d8b27a', // Seil/Handschuh
  w: '#ffffff',
};

const HEAD = [
  '....kkkkkk....',
  '...kyyyyyyk...',
  '..kyyyyyyyykk.',
  '..kyyyyyyyyLLk',
  '..koooooooyLLk',
  '..kssssssssk..',
  '..kswkssswkk..',
  '..ksskssskdk..',
  '...ksssssdk...',
];
const TORSO_HANG = [
  '..kkbbrrbbkk..',
  '.kbbbbrrbbbbk.',
  '.kbBbbrrbbBbk.',
  '.kskbbbbbbksk.',
  '..kkggggggkk..',
];
const LEGS_A = ['..kppppkpppk..', '..kpPpk.kpPk..', '..kppk..kppk..', '..kttk..kttk..', '..kkkk..kkkk..'];
const LEGS_B = ['..kpppkppppk..', '..kpPk.kpPpk..', '.kppk...kppk..', '.kttk....kttk.', '.kkkk....kkkk.'];
const TORSO_CHEER = [
  'ks.kbbrrbbk.sk',
  'kbkbbbrrbbbkbk',
  '.kbBbbrrbbBbk.',
  '..kbbbbbbbbk..',
  '..kkggggggkk..',
];
const HEAD_FLINCH = [
  '....kkkkkk....',
  '...kyyyyyyk...',
  '..kyyyyyyyykk.',
  '..kyyyyyyyyLLk',
  '..koooooooyLLk',
  '..kssssssssk..',
  '..kkkssskkkk..',
  '..kssskkssdk..',
  '...kskkksdk...',
];
const TORSO_FLINCH = [
  '.kskbbrrbbksk.',
  '.kbkbbrrbbkbk.',
  '..kBbbrrbbBk..',
  '..kbbbbbbbbk..',
  '..kkggggggkk..',
];

export function explorerSprites() {
  const mk = (...parts: string[][]) => fromRows(parts.flat(), EXPLORER_PAL);
  return {
    hangA: mk(HEAD, TORSO_HANG, LEGS_A),
    hangB: mk(HEAD, TORSO_HANG, LEGS_B),
    cheer: mk(HEAD, TORSO_CHEER, LEGS_B),
    flinch: mk(HEAD_FLINCH, TORSO_FLINCH, LEGS_A),
  };
}

// ---------------------------------------------------------------- Heißluftballon

/** Ballon mit Korb und Pilot; `flame` 0 = aus, 1–3 = Brenner-Frames. */
export function balloonSprite(flame: number, mood: 'idle' | 'cheer' | 'flinch' = 'idle'): Sprite {
  const W = 46;
  const H = 74;
  const [c, ctx] = canvas(W, H);
  const cx = 23;
  const px = (x: number, y: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const stripes = ['#e2533a', '#f6e2b3', '#f2a03a', '#f6e2b3'];
  const shade = ['#b93a2c', '#d8bf8c', '#cf7d27', '#d8bf8c'];
  const light = ['#f47b5c', '#fff4d6', '#ffc163', '#fff4d6'];
  // Hülle: oben Halbkugel, unten zum Brenner hin verjüngt
  for (let y = 0; y < 48; y++) {
    const t = y / 47;
    const half = y < 22 ? Math.sqrt(1 - ((22 - y) / 22) ** 2) * 22 : 22 * (1 - ((t - 0.46) / 0.54) ** 1.7 * 0.78);
    const h = Math.max(2, Math.round(half));
    for (let x = -h; x <= h; x++) {
      // Bahnen laufen zum Scheitel zusammen
      const u = (x / (h + 0.5) + 1) / 2;
      const gore = Math.min(7, Math.floor(u * 8));
      const i = gore % 4;
      let col = stripes[i];
      if (u > 0.72) col = shade[i];
      else if (u < 0.2 && y < 30) col = light[i];
      if (x === -h || x === h || y === 0) col = '#3a2030';
      px(cx + x, y, col);
    }
  }
  // Band um die Hülle
  for (let x = -21; x <= 21; x++) if (ctx.getImageData(cx + x, 26, 1, 1).data[3]) px(cx + x, 26, x > 9 ? '#8e2a2a' : '#c23b34');
  // Brennerrahmen + Seile
  ctx.fillStyle = '#3a2030';
  ctx.fillRect(cx - 5, 48, 11, 1);
  for (let y = 49; y < 62; y++) {
    px(cx - 5 - Math.round((y - 49) * 0.08), y, '#5b4636');
    px(cx + 5 + Math.round((y - 49) * 0.08), y, '#5b4636');
  }
  ctx.fillStyle = '#6d6875';
  ctx.fillRect(cx - 2, 55, 5, 2);
  // Flamme
  if (flame) {
    const fl = [
      ['..o..', '.oyo.', '.oyo.', 'oywyo', '.oyo.'],
      ['.o...', '.oyo.', 'oyyo.', 'oywyo', '.oyo.'],
      ['...o.', '.oyo.', '.oyyo', 'oywyo', '.oyo.'],
    ][flame - 1];
    const f = fromRows(fl, { o: '#f2681f', y: '#ffd23c', w: '#fffbe0' });
    ctx.drawImage(f, cx - 2, 50);
  }
  // Pilot
  const armsUp = mood === 'cheer';
  ctx.fillStyle = '#1b1424';
  ctx.fillRect(cx - 3, 56, 7, 6);
  ctx.fillStyle = '#f3c59d';
  ctx.fillRect(cx - 2, 57, 5, 4);
  ctx.fillStyle = '#b5482f';
  ctx.fillRect(cx - 3, 56, 7, 2); // Mütze
  ctx.fillStyle = '#1b1424';
  if (mood === 'flinch') ctx.fillRect(cx - 1, 59, 3, 1);
  else {
    px(cx - 1, 59, '#1b1424');
    px(cx + 1, 59, '#1b1424');
  }
  if (armsUp) {
    ctx.fillStyle = '#3f7cc0';
    ctx.fillRect(cx - 6, 55, 2, 5);
    ctx.fillRect(cx + 5, 55, 2, 5);
    px(cx - 6, 54, '#f3c59d');
    px(cx + 6, 54, '#f3c59d');
  }
  // Korb
  for (let y = 62; y < 73; y++) {
    for (let x = -7; x <= 7; x++) {
      const edge = x === -7 || x === 7 || y === 72 || y === 62;
      const weave = (x + y) % 3 === 0;
      px(cx + x, y, edge ? '#3a2416' : x > 3 ? '#8a5a2e' : weave ? '#b9803f' : '#a26c33');
    }
  }
  ctx.fillStyle = '#d7a45a';
  ctx.fillRect(cx - 6, 63, 13, 1);
  // Sandsäcke
  ctx.fillStyle = '#c9b79a';
  ctx.fillRect(cx - 9, 66, 2, 3);
  ctx.fillRect(cx + 8, 66, 2, 3);
  return c;
}

// ---------------------------------------------------------------- Höhlen-Deko

export const CRYSTAL_COLORS = [
  ['#e9fbff', '#7fe3f5', '#2f9fd0', '#1b5a8f'],
  ['#f6e6ff', '#c79bf2', '#8a55d0', '#4a2a86'],
  ['#ffe6f5', '#ff9bd0', '#d0509c', '#7a2a66'],
];

/** Kristallgruppe aus drei Splittern. */
export function crystalSprite(variant: number, big: boolean): Sprite {
  const [c, ctx] = canvas(big ? 22 : 13, big ? 24 : 13);
  const col = CRYSTAL_COLORS[variant % 3];
  const shard = (bx: number, w: number, h: number, lean: number) => {
    const base = c.height - 1;
    for (let i = 0; i < h; i++) {
      const y = base - i;
      const t = i / h;
      const half = t > 0.75 ? (w / 2) * (1 - (t - 0.75) / 0.25) : w / 2;
      const mid = bx + lean * t * h * 0.35;
      for (let x = Math.round(mid - half); x <= Math.round(mid + half); x++) {
        const rel = half < 0.5 ? 0 : (x - mid) / half;
        ctx.fillStyle = rel < -0.45 ? col[1] : rel < 0.2 ? col[2] : col[3];
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = col[0];
      if (t > 0.2 && t < 0.8) ctx.fillRect(Math.round(mid - half * 0.5), y, 1, 1);
    }
  };
  if (big) {
    shard(5, 5, 14, -1);
    shard(16, 5, 16, 1);
    shard(11, 7, 23, 0.1);
  } else {
    shard(3, 3, 8, -1);
    shard(9, 3, 9, 1);
    shard(6, 4, 12, 0);
  }
  return c;
}

export const SHROOM_COLORS = [
  ['#d8fff4', '#63f0d0', '#1f9f95', '#e8fff8'],
  ['#f3ffd0', '#b8f05a', '#5d9f2a', '#f8ffe6'],
  ['#ffe3fb', '#f08ae6', '#9f3fb0', '#fff0fd'],
];

export function shroomSprite(variant: number, big: boolean): Sprite {
  const w = big ? 15 : 9;
  const h = big ? 14 : 9;
  const [c, ctx] = canvas(w, h);
  const col = SHROOM_COLORS[variant % 3];
  const capH = big ? 7 : 4;
  const cx = (w - 1) / 2;
  for (let y = 0; y < capH; y++) {
    const half = Math.sqrt(1 - ((capH - 1 - y) / capH) ** 2) * (w / 2);
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
      ctx.fillStyle = y === 0 || x < cx - half * 0.3 ? col[1] : col[2];
      if (y === capH - 1) ctx.fillStyle = col[2];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = col[0];
  ctx.fillRect(Math.round(cx - 2), 1, big ? 2 : 1, 1);
  if (big) {
    ctx.fillRect(Math.round(cx + 3), 3, 2, 1);
    ctx.fillRect(Math.round(cx - 5), 4, 1, 1);
  }
  ctx.fillStyle = col[3];
  ctx.fillRect(Math.round(cx - (big ? 1 : 0)), capH, big ? 3 : 2, h - capH);
  ctx.fillStyle = '#9fb8b0';
  ctx.fillRect(Math.round(cx + (big ? 1 : 1)), capH, 1, h - capH);
  return c;
}

export function batSprites(): Sprite[] {
  const pal = { k: '#231a33', p: '#4a3a66', e: '#ff7a5a' };
  return [
    fromRows(['kk.........kk', 'kpkk.....kkpk', 'kpppkkkkkpppk', '.kppkepekppk.', '..kkkpppkkk..', '.....kkk.....'], pal),
    fromRows(['.............', '....kkkkk....', '.kkkkepekkkk.', 'kpppkpppkpppk', 'kpkk.kkk.kkpk', 'kk.........kk'], pal),
  ];
}

// ---------------------------------------------------------------- Himmel-Deko

/** Wolke aus überlappenden Pixel-Kreisen mit flacher, schattierter Unterseite. */
export function cloudSprite(seed: number, w: number, tint: [string, string, string] = ['#ffffff', '#dff1ff', '#b7dcf7']): Sprite {
  const h = Math.round(w * 0.42) + 4;
  const [c, ctx] = canvas(w, h);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
  const blobs: [number, number, number][] = [];
  const n = 3 + Math.floor(w / 14);
  for (let i = 0; i < n; i++) {
    const r = (h * 0.32) * (0.7 + rnd() * 0.6);
    blobs.push([r + ((w - 2 * r) * i) / (n - 1), h - 3 - r * (0.75 + rnd() * 0.35), r]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let top = false;
      for (const [bx, by, r] of blobs) {
        const d = (x - bx) ** 2 + (y - by) ** 2;
        if (d <= r * r) {
          inside = true;
          if (y < by - r * 0.35) top = true;
        }
      }
      if (y >= h - 3 && x > 3 && x < w - 4) inside = true;
      if (!inside) continue;
      ctx.fillStyle = y >= h - 2 ? tint[2] : top ? tint[0] : tint[1];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Kleiner Vogel (Seitenansicht), zwei Flügelschlag-Frames. */
export function birdSprites(): Sprite[] {
  const pal = { k: '#2b2438', w: '#4a3f5e' };
  return [fromRows(['k.....k', 'kw...wk', '.kwkwk.', '...k...'], pal), fromRows(['.......', '...k...', '.kwkwk.', 'kk...kk'], pal)];
}

export function planeSprite(): Sprite {
  return fromRows(
    ['.......ww......', '......wwb......', 'r....wwwwwwwww.', 'rwwwwwwwwwwwwww', '.wwbwbwbwwwwwd.', '.....ddd.......', '......dd.......'],
    { w: '#f4f7fb', b: '#5aa7e0', r: '#e2533a', d: '#b8c4d2' },
  );
}

export function sunSprite(): Sprite {
  const r = 22;
  const [c, ctx] = canvas(r * 2 + 1, r * 2 + 1);
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r) continue;
      // waagerechte Streifen im unteren Drittel – Retro-Sonnenuntergang
      if (y > 6 && (y - 6) % 5 === 4) continue;
      ctx.fillStyle = y < -8 ? '#fff3b0' : y < 4 ? '#ffd76a' : y < 13 ? '#ffae4a' : '#ff7f50';
      ctx.fillRect(x + r, y + r, 1, 1);
    }
  return c;
}

export function moonSprite(): Sprite {
  const r = 9;
  const [c, ctx] = canvas(r * 2 + 1, r * 2 + 1);
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      ctx.fillStyle = (x + 4) ** 2 + (y + 3) ** 2 < 45 ? '#fffbe6' : '#e2dcc0';
      ctx.fillRect(x + r, y + r, 1, 1);
    }
  ctx.fillStyle = '#c9c2a4';
  ctx.fillRect(11, 6, 2, 2);
  ctx.fillRect(6, 11, 3, 2);
  ctx.fillRect(12, 13, 2, 1);
  return c;
}

export function satelliteSprite(): Sprite {
  return fromRows(['bbb.....bbb', 'bBb.ggg.bBb', 'bbbkgwgkbbb', 'bBb.ggg.bBb', 'bbb..k..bbb', '.....k.....'], {
    b: '#3f7cc0',
    B: '#7fc0f0',
    g: '#c8ccd4',
    w: '#ffffff',
    k: '#6d6875',
  });
}

/** Kleiner Signalballon, der im Himmel ein Höhenschild trägt. */
export function buoySprite(): Sprite {
  return fromRows(
    ['..rrrrr..', '.rRrrrrr.', 'rRrrrrrrd', 'rrrrrrrdd', 'rrrrrrrdd', '.rrrrrdd.', '..rrrdd..', '...kkk...', '....k....', '....k....'],
    { r: '#e2533a', R: '#f79a7c', d: '#a8322a', k: '#3a2030' },
  );
}

// ---------------------------------------------------------------- Mini-Schrift für Schilder

const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  m: ['.....', '##.#.', '#.#.#', '#.#.#', '#.#.#'],
  ' ': ['.', '.', '.', '.', '.'],
};

/** Holzschild mit Text wie "-500 m". */
export function signSprite(text: string): Sprite {
  const glyphs = [...text].map((ch) => GLYPHS[ch] ?? GLYPHS[' ']);
  const tw = glyphs.reduce((s, g) => s + g[0].length + 1, -1);
  const w = tw + 8;
  const [c, ctx] = canvas(w, 13);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(0, 0, w, 13);
  ctx.fillStyle = '#c98b4a';
  ctx.fillRect(1, 1, w - 2, 11);
  ctx.fillStyle = '#e0a868';
  ctx.fillRect(1, 1, w - 2, 2);
  ctx.fillStyle = '#a66d35';
  ctx.fillRect(1, 9, w - 2, 3);
  ctx.fillRect(3, 5, 2, 1);
  ctx.fillRect(w - 6, 6, 3, 1);
  ctx.fillStyle = '#6d6875';
  ctx.fillRect(2, 2, 1, 1);
  ctx.fillRect(w - 3, 2, 1, 1);
  let x = 4;
  ctx.fillStyle = '#2b1a10';
  for (const g of glyphs) {
    g.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') ctx.fillRect(x + i, 4 + y, 1, 1);
    });
    x += g[0].length + 1;
  }
  return c;
}

/** Abgestufte Lichtmaske (weiß, mit Alpha-Ringen) zum Ausstanzen der Dunkelheit. */
export function lightMask(radius: number): Sprite {
  const size = radius * 2 + 1;
  const [c, ctx] = canvas(size, size);
  const rings: [number, number][] = [
    [1, 0.3],
    [0.82, 0.55],
    [0.62, 0.8],
    [0.42, 1],
  ];
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - radius) ** 2 + (y - radius) ** 2) / radius;
      // leichtes Schachbrett an den Ringkanten, damit die Stufen weicher wirken
      const dd = d + ((x + y) & 1 ? 0.035 : -0.035);
      let a = 0;
      for (const [r, al] of rings) if (dd <= r) a = al;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- Stufen-Icons (16×16)

const ICONS: Record<string, [string[], Record<string, string>]> = {
  moss: [
    ['................', '................', '................', '................', '.......g........', '...g...gg..g....', '...gg.gGg.gg....', '....gGgGggG..g..', '..g.gGGGgGg.gg..', '..ggGGGgGGGgG...', '...GGgGGGgGGG...', '.dGGGGGGGGGGGd..', '.dddGGGGGGGddd..', '..dddddddddddd..', '................', '................'],
    { g: '#b8e86a', G: '#5d9f3a', d: '#3e6b2a' },
  ],
  stone: [
    ['................', '................', '................', '................', '.....kkkkk......', '....kwllllkk....', '...kwllllllmk...', '..kwlllllllmmk..', '..kllllmlllmmk..', '.klllllmmllmmmk.', '.kllmlllllmmmmk.', '.kmmmmmmmmmmmmk.', '..kkkkkkkkkkkk..', '................', '................', '................'],
    { k: '#2a2438', w: '#c8bfd2', l: '#9a8fa8', m: '#6d6478' },
  ],
  ember: [
    ['................', '.......o........', '......oo........', '......ooo.......', '.....ooyoo..o...', '....oooyyoo.oo..', '...oooyyyoooo...', '..oooyyyyyooo...', '..ooyyywyyyoo...', '..ooyyywwyyoo...', '..oyyywwwwyyo...', '...oyywwwwyo....', '....oyywwyo.....', '.....oooooo.....', '................', '................'],
    { o: '#e2541e', y: '#ffb347', w: '#fff1b0' },
  ],
  core: [
    ['................', '................', '.....rrrrrr.....', '...rrooooooorr..', '..rooyyyyyyoor..', '..roywwwwwwyor..', '.royywwwwwwyyor.', '.roywwwwwwwwyor.', '.roywwwwwwwwyor.', '.royywwwwwwyyor.', '..roywwwwwwyor..', '..rooyyyyyyoor..', '...rrooooooorr..', '.....rrrrrr.....', '................', '................'],
    { r: '#7a2416', o: '#e2541e', y: '#ffb347', w: '#fff1b0' },
  ],
  tooClever: [
    ['................', '................', '................', '................', '................', 'k..............k', '.kkkkk....kkkkk.', '.kwwwkkkkkkwwwk.', '.kwbbk....kwbbk.', '.kbbbk....kbbbk.', '.kkkkk....kkkkk.', '................', '................', '................', '................', '................'],
    { k: '#2a2438', w: '#e6f6ff', b: '#9fd8ff' },
  ],
  invalid: [
    ['................', '................', '..kk........kk..', '..kxk......kxk..', '...kxk....kxk...', '....kxk..kxk....', '.....kxkkxk.....', '......kxxk......', '......kxxk......', '.....kxkkxk.....', '....kxk..kxk....', '...kxk....kxk...', '..kxk......kxk..', '..kk........kk..', '................', '................'],
    { k: '#2a2438', x: '#8a8f98' },
  ],
  meadow: [
    ['................', '................', '......pp........', '.....pyyp.......', '......pp...w....', '......g...wyw...', '...g..g....w....', '...gg.g..g.g....', '....gggg.gg.g...', '..g.gggggggg....', '..gggggggggggg..', '.dggggggggggggd.', '.dddddddddddddd.', '................', '................', '................'],
    { p: '#ff8fab', y: '#ffd166', w: '#ffffff', g: '#7ec850', d: '#4e9a3a' },
  ],
  treetops: [
    ['................', '......gggg......', '....ggGGGggg....', '...gGGGGGGGgg...', '..gGGGlGGGGGgg..', '..gGGllGGGGGGg..', '.gGGGGGGGGlGGGg.', '.gGGGGGGGllGGGg.', '.dGGGGGGGGGGGGd.', '..ddGGGGGGGGdd..', '....ddddbddd....', '.......bb.......', '.......bb.......', '......bbbb......', '................', '................'],
    { g: '#7ec850', G: '#4e9a3a', l: '#b8e86a', d: '#2f6b2a', b: '#8a5a2e' },
  ],
  clouds: [
    ['................', '................', '................', '................', '.......www......', '.....wwwwwww....', '...wwwwwwwwwww..', '..wwwwwwwwwwww..', '.wwwwwwwwwwwwww.', '.wllllllllllllw.', '.blllllllllllbb.', '..bbbbbbbbbbbb..', '................', '................', '................', '................'],
    { w: '#ffffff', l: '#dff1ff', b: '#b7dcf7' },
  ],
  sunset: [
    ['kkkkkkkkkkkkkkkk', 'kppppppppppppppk', 'kppppppppppppppk', 'kpppppyyyyppqppk', 'kppppyyyyyyqqppk', 'kpppyyyyyyyyqppk', 'kroooooooooooork', 'krrrrrrrrrrrrrrk', 'krooooooooooorrk', 'krrrrrrrrrrrrrrk', 'krrroooooooorrrk', 'kmmmmmmmmmmmmmmk', 'kmmmmmmmmmmmmmmk', 'kmmwwmmmmmmwwmmk', 'kmmmmmmmmmmmmmmk', 'kkkkkkkkkkkkkkkk'],
    { k: '#3a2030', p: '#e2567c', q: '#f79a7a', y: '#fff3b0', o: '#ffae4a', r: '#ff7f50', m: '#6c3c8c', w: '#c79bd8' },
  ],
  stars: [
    ['................', '.......y........', '.......y........', '......yyy.......', '......ywy.......', '.yyyyywwwyyyyy..', '..yyywwwwwyyy...', '...yyywwwyyy....', '....yywwwyy.....', '....yyyyyyy.....', '...yyy...yyy....', '...yy.....yy....', '..y.........y...', '................', '................', '................'],
    { y: '#ffd76a', w: '#fff6c2' },
  ],
};

/** 16×16-Icon einer Stufe ("crystal" nutzt den Kristall-Sprite). */
export function tierIconSprite(tier: string): Sprite {
  if (tier === 'crystal') {
    const [c, ctx] = canvas(16, 16);
    ctx.drawImage(crystalSprite(0, false), 1, 2);
    return c;
  }
  const def = ICONS[tier] ?? ICONS.invalid;
  return fromRows(def[0], def[1]);
}
