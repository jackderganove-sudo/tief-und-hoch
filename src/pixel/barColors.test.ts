import { describe, expect, it } from 'vitest';
import { CAVE_BAR, systemBarColor } from './barColors';

describe('Farbe der System-Leisten', () => {
  it('Höhle: feste dunkle Farbe je Zone (neue Skala)', () => {
    expect(systemBarColor('rare', 200)).toBe(CAVE_BAR.earth);
    expect(systemBarColor('rare', 600)).toBe(CAVE_BAR.rock);
    expect(systemBarColor('rare', 1200)).toBe(CAVE_BAR.crystal);
    expect(systemBarColor('rare', 2000)).toBe(CAVE_BAR.shroom);
    expect(systemBarColor('rare', 2700)).toBe(CAVE_BAR.lava);
    expect(systemBarColor('rare', 5000)).toBe(CAVE_BAR.hell);
    expect(systemBarColor('rare', 8000)).toBe(CAVE_BAR.icehell);
    expect(systemBarColor('rare', 10000)).toBe(CAVE_BAR.crystalhell);
    expect(systemBarColor('rare', 12000)).toBe(CAVE_BAR.abyss);
    expect(systemBarColor('rare', 14000)).toBe(CAVE_BAR.icehell); // Ebenen wiederholen sich
  });
  it('am Eingang und im Himmel: Himmelsfarbe nach Höhe', () => {
    expect(systemBarColor('rare', 0)).toBe('#2fbdff');
    expect(systemBarColor('home', 0)).toBe('#2fbdff');
    expect(systemBarColor('common', 0)).toBe('#2fbdff');
    expect(systemBarColor('common', 3500)).toBe('#e8857a'); // Abendrot oben im Bild (4.100 m)
    expect(systemBarColor('common', 6000)).toBe('#fff1c8'); // Himmel
    expect(systemBarColor('common', 12000)).toBe('#05040c'); // Weltraum
  });
});
