import type { TierId } from '../domain/types';

/** Leuchtfarbe pro Stufe (Text, Glow, Ränder). */
export const TIER_COLOR: Record<TierId, string> = {
  moss: '#86c46b',
  stone: '#b8bfcc',
  crystal: '#8be9fd',
  ember: '#ffa94d',
  core: '#ff5a2b',
  tooClever: '#f6d365',
  meadow: '#5aa843',
  treetops: '#2f8a4a',
  clouds: '#5b8fd9',
  sunset: '#f0703f',
  stars: '#6d4cd6',
  invalid: '#8a8f98',
};
