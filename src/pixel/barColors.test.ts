import { describe, expect, it } from 'vitest';
import { CAVE_BAR, systemBarColor } from './barColors';

describe('Farbe der System-Leisten', () => {
  it('Höhle: feste dunkle Farbe je Zone', () => {
    expect(systemBarColor('rare', 400)).toBe(CAVE_BAR.earth);
    expect(systemBarColor('rare', 1700)).toBe(CAVE_BAR.rock);
    expect(systemBarColor('rare', 3200)).toBe(CAVE_BAR.crystal);
    expect(systemBarColor('rare', 4900)).toBe(CAVE_BAR.shroom);
    expect(systemBarColor('rare', 6800)).toBe(CAVE_BAR.lava);
    expect(systemBarColor('rare', 12000)).toBe(CAVE_BAR.lava);
  });
  it('am Eingang und im Himmel: Himmelsfarbe nach Höhe', () => {
    expect(systemBarColor('rare', 0)).toBe('#2fbdff');
    expect(systemBarColor('home', 0)).toBe('#2fbdff');
    expect(systemBarColor('common', 0)).toBe('#2fbdff');
    expect(systemBarColor('common', 4000)).toBe('#e8857a'); // Abendrot oben im Bild (4.600 m)
    expect(systemBarColor('common', 7000)).toBe('#0b0b22');
  });
});
