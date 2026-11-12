/** 12 Pixel-Avatare (12×12) für Spielerprofile – Kopfbedeckung, Haut, Haare variieren. */
import { canvas, type Sprite } from './sprites';

const SKIN = ['#f2c48d', '#d9a066', '#a8714a', '#7a4e32'];
const HATS: { name: string; c: [string, string]; kind: 'helmet' | 'cap' | 'hair' | 'beanie' }[] = [
  { name: 'Forscherin', c: ['#f2d03a', '#b8941c'], kind: 'helmet' },
  { name: 'Ballonfahrer', c: ['#e2603a', '#a8372a'], kind: 'cap' },
  { name: 'Kristall', c: ['#8be9fd', '#3fa9d6'], kind: 'beanie' },
  { name: 'Pilz', c: ['#f08ae6', '#9f3fb0'], kind: 'beanie' },
  { name: 'Lava', c: ['#ff8a2b', '#c23a16'], kind: 'helmet' },
  { name: 'Wiese', c: ['#7ec850', '#4e9a3a'], kind: 'cap' },
];
const HAIR = ['#3a2416', '#8a5a34', '#e8c070', '#2a2030'];

function draw(i: number): Sprite {
  const [c, ctx] = canvas(12, 12);
  const p = (x: number, y: number, col: string, w = 1, h = 1) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  const hat = HATS[i % HATS.length];
  const skin = SKIN[Math.floor(i / 3) % SKIN.length];
  const hair = HAIR[i % HAIR.length];
  // Gesicht
  p(3, 4, skin, 6, 6);
  p(2, 5, skin, 1, 4);
  p(9, 5, skin, 1, 4);
  p(4, 6, '#2a2030');
  p(7, 6, '#2a2030');
  p(5, 8, '#a8372a', 2, 1);
  p(3, 10, '#3d83b3', 6, 2); // Kragen
  // Haare an den Seiten
  p(2, 4, hair, 1, 2);
  p(9, 4, hair, 1, 2);
  if (hat.kind === 'helmet') {
    p(2, 1, hat.c[0], 8, 3);
    p(1, 3, hat.c[1], 10, 1);
    p(5, 2, '#fff3a0', 2, 1); // Lampe
  } else if (hat.kind === 'cap') {
    p(3, 1, hat.c[0], 6, 3);
    p(8, 3, hat.c[1], 3, 1);
  } else {
    p(2, 1, hat.c[0], 8, 3);
    p(2, 3, hat.c[1], 8, 1);
    p(5, 0, hat.c[1], 2, 1);
  }
  return c;
}

const cache = new Map<number, Sprite>();
export const AVATAR_COUNT = 12;
export function avatarSprite(i: number): Sprite {
  const k = ((i % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = draw(k)));
  return s;
}
