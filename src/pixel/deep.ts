/**
 * Endlose Tiefen unter dem Höllentor: Eis-Hölle, Kristall-Hölle, Abgrund (je 2.000 m, wiederholt).
 * hell.ts zeichnet die gemeinsamen Bauteile (Säulen, Simse, Teufelchen …) in diesen Farben;
 * hier kommen Paletten, Dunkelheit und die eigenen Ebenen jeder Tiefe dazu.
 */
import type { Images } from './assets';
import type { Darkness, DeepLevel, HellFrame, Palette, SharedParts } from './hellShared';

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

export const DEEP_DARK: Record<DeepLevel, Darkness> = {
  icehell: [0.46, [8, 18, 40]],
  crystalhell: [0.44, [30, 8, 48]],
  abyss: [0.6, [10, 4, 18]],
};

const ALL: SharedParts = { farColumns: 1, midColumns: 1, ledges: 1, imps: 1, chains: 1, spirits: 1, steam: 1, torches: 1 };
/** Welche gemeinsamen Bauteile aus hell.ts in jeder Tiefe erscheinen (und wie dicht). */
export const DEEP_SHARED: Record<DeepLevel, SharedParts> = {
  icehell: { ...ALL },
  crystalhell: { ...ALL },
  abyss: { ...ALL },
};

export class DeepRenderer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_img: Images) {}

  /** Hinter den gemeinsamen Säulen (nach dem Hintergrundverlauf). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  back(_d: HellFrame, _clipTop: number) {}

  /** Vor allem anderen der Höhle (nach Geistern und Schildern, noch innerhalb der Höhle). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  front(_d: HellFrame, _clipTop: number) {}
}
