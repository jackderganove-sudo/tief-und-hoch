/** 30 gut unterscheidbare Spielerfarben (Freunde-Modus): Seil-Figur bzw. Ballon, Namensschild. */
export const PLAYER_COLORS = [
  '#e2533a', '#3fc6c0', '#f2b53a', '#9b5de5', '#7ec850', '#f08ae6', '#3d83b3', '#ff8a2b', '#c23b34', '#4ad295',
  '#ffd166', '#6c5ce7', '#2ec4b6', '#ef476f', '#a3d977', '#118ab2', '#e07a5f', '#b388eb', '#06d6a0', '#f4a261',
  '#8d6e63', '#26c6da', '#d81b60', '#c0ca33', '#5c6bc0', '#ff7043', '#66bb6a', '#ab47bc', '#ffca28', '#78909c',
];
export const playerColor = (i: number) => PLAYER_COLORS[((i % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
