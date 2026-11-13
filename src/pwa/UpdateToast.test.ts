import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

describe('automatisches Update auf der Startseite', async () => {
  const { mayAutoUpdate } = await import('./UpdateToast');
  it('lädt beim ersten Mal neu', () => {
    expect(mayAutoUpdate(null, 1_000_000)).toBe(true);
    expect(mayAutoUpdate(Number.NaN, 1_000_000)).toBe(true);
  });
  it('keine Lade-Schleife: höchstens einmal pro Minute', () => {
    expect(mayAutoUpdate(1_000_000 - 5_000, 1_000_000)).toBe(false);
    expect(mayAutoUpdate(1_000_000 - 61_000, 1_000_000)).toBe(true);
  });
});
