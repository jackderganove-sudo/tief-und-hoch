import type { TierId } from '../domain/types';

/** Medaillen-Farben: auf dunklem Stein und hellem Holz lesbar. */
const BRONZE = '#c46f2e';
const SILVER = '#8d97a8';
const GOLD = '#d9a21c';
const PLATINUM = '#4a8aa0';
const DIAMOND = '#25b4e8';

/** Farbe pro Stufe (Text, Ränder) – gleiche Punkte = gleiche Medaille in beiden Modi. */
export const TIER_COLOR: Record<TierId, string> = {
  moss: BRONZE,
  stone: SILVER,
  crystal: GOLD,
  ember: PLATINUM,
  core: DIAMOND,
  meadow: BRONZE,
  treetops: SILVER,
  clouds: GOLD,
  sunset: PLATINUM,
  stars: DIAMOND,
  tooClever: '#f6d365',
  invalid: '#8a8f98',
};
