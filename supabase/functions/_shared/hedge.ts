/**
 * Zwei Modelle gegeneinander absichern – ohne Deno/Netz, damit es mit Vitest testbar ist
 * (src/domain/hedge.test.ts).
 *
 * Das Hauptmodell ist genauer, das Ersatzmodell schneller und verlässlicher. Regeln:
 *  1. Hauptmodell startet. Antwortet es bis `hedgeAfterMs`, gewinnt es.
 *  2. Sonst (oder sofort, wenn es scheitert) startet zusätzlich das Ersatzmodell.
 *  3. Bis `preferPrimaryMs` nach dem Start darf das Hauptmodell noch gewinnen, auch wenn
 *     das Ersatzmodell schon fertig ist (Genauigkeit vor Tempo).
 *  4. Danach gewinnt die erste erfolgreiche Antwort – das Ersatzmodell wartet NICHT länger
 *     auf ein hängendes Hauptmodell.
 *
 * Regel 4 fehlte früher: Hing das Hauptmodell (ohne Fehler, einfach langsam), wurde die längst
 * vorliegende Antwort des Ersatzmodells bis zum Hintergrund-Limit (25 s) zurückgehalten. Der
 * Spieler bekam nach ~5 s „konnte nicht geprüft werden“, obwohl ein Urteil da war.
 */
export interface HedgeOptions<T> {
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  /** Ab wann das Ersatzmodell parallel startet (ms nach Start). */
  hedgeAfterMs: number;
  /** Bis wann das Hauptmodell Vorrang hat (ms nach Start). */
  preferPrimaryMs: number;
  /** einsetzbar für Tests */
  sleep?: (ms: number) => Promise<void>;
}

export interface HedgeResult<T> {
  value: T;
  from: 'primary' | 'fallback';
  /** Fehler des Hauptmodells, falls es gescheitert ist. */
  primaryError?: unknown;
  /** Das Hauptmodell hat seine Vorrangzeit überschritten (hängt/ist überlastet). */
  primarySlow: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export async function hedged<T>(o: HedgeOptions<T>): Promise<HedgeResult<T>> {
  const sleep = o.sleep ?? defaultSleep;
  type Settled = { ok: true; value: T } | { ok: false; error: unknown };
  const settle = (p: Promise<T>): Promise<Settled> =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

  const primary = settle(o.primary());
  const early = await Promise.race([primary, sleep(o.hedgeAfterMs).then(() => null)]);
  if (early?.ok) return { value: early.value, from: 'primary', primarySlow: false };

  const fallback = settle(o.fallback());
  /** Ersatzmodell abwarten; scheitert es auch, beide Fehler melden. */
  const useFallback = async (primaryError: unknown, primarySlow: boolean): Promise<HedgeResult<T>> => {
    const f = await fallback;
    if (f.ok) return { value: f.value, from: 'fallback', primaryError, primarySlow };
    throw new HedgeError(primaryError, f.error);
  };
  // Hauptmodell schon gescheitert → es bleibt nur das Ersatzmodell
  if (early && !early.ok) return useFallback(early.error, false);

  // Vorrangzeit: Das Hauptmodell darf noch gewinnen
  const preferred = await Promise.race([primary, sleep(o.preferPrimaryMs - o.hedgeAfterMs).then(() => null)]);
  if (preferred?.ok) return { value: preferred.value, from: 'primary', primarySlow: false };
  if (preferred && !preferred.ok) return useFallback(preferred.error, false);

  // Vorrangzeit um: wer zuerst erfolgreich antwortet, gewinnt
  const first = await Promise.race([
    fallback.then((f) => ({ who: 'fallback' as const, r: f })),
    primary.then((p) => ({ who: 'primary' as const, r: p })),
  ]);
  if (first.r.ok) return { value: first.r.value, from: first.who, primarySlow: true };
  // der Schnellere ist gescheitert → auf den anderen warten
  if (first.who === 'fallback') {
    const p = await primary;
    if (p.ok) return { value: p.value, from: 'primary', primarySlow: true };
    throw new HedgeError(p.error, first.r.error);
  }
  return useFallback(first.r.error, true);
}

/** Beide Modelle sind gescheitert. */
export class HedgeError extends Error {
  constructor(
    readonly primaryError: unknown,
    readonly fallbackError: unknown,
  ) {
    super(`${String((primaryError as Error)?.message ?? primaryError).slice(0, 180)} | ${String((fallbackError as Error)?.message ?? fallbackError).slice(0, 180)}`);
  }
}
