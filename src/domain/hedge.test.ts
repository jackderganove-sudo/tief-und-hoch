import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hedged, HedgeError } from '../../supabase/functions/_shared/hedge';

/**
 * Regression „Couldn't be checked“: Das Hauptmodell hing (18–25 s, ohne Fehler). Das
 * Ersatzmodell hatte nach ~3 s längst geantwortet, wurde aber zurückgehalten – der Spieler
 * bekam nach 5,3 s „konnte nicht geprüft werden“ und (alte App) sofort „Daneben“.
 */
const after = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const failAfter = (ms: number, msg: string) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms));
/** Wie lange der Spieler höchstens auf die Function wartet. */
const PLAYER_WAIT_MS = 5300;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function run<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = Date.now();
  let out: { value?: T; error?: unknown; ms: number } | null = null;
  p.then(
    (value) => (out = { value, ms: Date.now() - t0 }),
    (error) => (out = { error, ms: Date.now() - t0 }),
  );
  for (let i = 0; i < 400 && !out; i++) await vi.advanceTimersByTimeAsync(100);
  if (!out) throw new Error('hängt');
  return out;
}

const opts = { hedgeAfterMs: 2000, preferPrimaryMs: 3600 };

describe('Hauptmodell gegen Ersatzmodell absichern', () => {
  it('hängendes Hauptmodell: die Antwort des Ersatzmodells kommt, bevor der Spieler aufgibt', async () => {
    const fallback = vi.fn(() => after(900, 'ersatz'));
    const r = await run(hedged({ ...opts, primary: () => after(18_500, 'haupt'), fallback }));
    expect(r.value).toMatchObject({ value: 'ersatz', from: 'fallback', primarySlow: true });
    // früher: 18,5 s (bzw. 25 s Zeitlimit) → Spieler bekam „nicht geprüft“
    expect(r.ms).toBeLessThan(PLAYER_WAIT_MS);
    expect(r.ms).toBeGreaterThanOrEqual(opts.preferPrimaryMs);
  });

  it('Hauptmodell läuft ins Zeitlimit (25 s): trotzdem zählt das Ersatzmodell rechtzeitig', async () => {
    const r = await run(hedged({ ...opts, primary: () => failAfter(25_000, 'TimeoutError: Signal timed out'), fallback: () => after(1200, 'ersatz') }));
    expect(r.value?.from).toBe('fallback');
    expect(r.ms).toBeLessThan(PLAYER_WAIT_MS);
  });

  it('schnelles Hauptmodell gewinnt, das Ersatzmodell startet gar nicht', async () => {
    const fallback = vi.fn(() => after(100, 'ersatz'));
    const r = await run(hedged({ ...opts, primary: () => after(1300, 'haupt'), fallback }));
    expect(r.value).toMatchObject({ value: 'haupt', from: 'primary', primarySlow: false });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('Hauptmodell hat Vorrang, solange es in der Vorrangzeit antwortet (Genauigkeit vor Tempo)', async () => {
    const r = await run(hedged({ ...opts, primary: () => after(3200, 'haupt'), fallback: () => after(500, 'ersatz') }));
    expect(r.value).toMatchObject({ value: 'haupt', from: 'primary' });
    expect(r.ms).toBeLessThan(opts.preferPrimaryMs);
  });

  it('Hauptmodell scheitert sofort (429): Ersatzmodell startet ohne Wartezeit', async () => {
    const r = await run(hedged({ ...opts, primary: () => failAfter(150, '429 quota'), fallback: () => after(800, 'ersatz') }));
    expect(r.value).toMatchObject({ value: 'ersatz', from: 'fallback', primarySlow: false });
    expect((r.value?.primaryError as Error).message).toBe('429 quota');
    expect(r.ms).toBeLessThan(1200);
  });

  it('Hauptmodell scheitert während der Vorrangzeit: Ersatzmodell zählt', async () => {
    const r = await run(hedged({ ...opts, primary: () => failAfter(2800, '503'), fallback: () => after(600, 'ersatz') }));
    expect(r.value).toMatchObject({ value: 'ersatz', from: 'fallback' });
    expect(r.ms).toBeLessThan(3000);
  });

  it('beide langsam: wer zuerst fertig ist, gewinnt', async () => {
    const a = await run(hedged({ ...opts, primary: () => after(7000, 'haupt'), fallback: () => after(9000, 'ersatz') }));
    expect(a.value).toMatchObject({ value: 'haupt', from: 'primary', primarySlow: true });
    const b = await run(hedged({ ...opts, primary: () => after(20_000, 'haupt'), fallback: () => after(6000, 'ersatz') }));
    expect(b.value).toMatchObject({ value: 'ersatz', from: 'fallback', primarySlow: true });
  });

  it('Ersatzmodell scheitert, Hauptmodell kommt spät doch noch', async () => {
    const r = await run(hedged({ ...opts, primary: () => after(8000, 'haupt'), fallback: () => failAfter(500, '429 ersatz') }));
    expect(r.value).toMatchObject({ value: 'haupt', from: 'primary', primarySlow: true });
  });

  it('beide scheitern: ein Fehler mit beiden Ursachen', async () => {
    const r = await run(hedged({ ...opts, primary: () => failAfter(100, '429 haupt'), fallback: () => failAfter(300, '429 ersatz') }));
    expect(r.error).toBeInstanceOf(HedgeError);
    expect((r.error as HedgeError).message).toBe('429 haupt | 429 ersatz');
    const late = await run(hedged({ ...opts, primary: () => failAfter(9000, 'timeout haupt'), fallback: () => failAfter(4000, '503 ersatz') }));
    expect((late.error as HedgeError).message).toBe('timeout haupt | 503 ersatz');
  });
});
