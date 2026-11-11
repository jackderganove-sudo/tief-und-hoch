import type { Lang, Mode, Question } from './types';
import { QUESTIONS_PER_DAY } from './scoring';

export const GAME_TIME_ZONE = 'Europe/Berlin';

/** Kalendertag in Europe/Berlin als "YYYY-MM-DD" (Tageswechsel um Mitternacht Berliner Zeit). */
export function berlinDateKey(now: Date = new Date()): string {
  // en-CA liefert ISO-Reihenfolge YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Tage seit 1970-01-01 für einen Datums-Schlüssel (unabhängig von der lokalen Zeitzone). */
export function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Millisekunden bis zum nächsten Tageswechsel in Berlin (für den Countdown). */
export function msUntilNextBerlinDay(now: Date = new Date()): number {
  const today = berlinDateKey(now);
  // Grob 25 h vorspringen und per Binärsuche den Wechselzeitpunkt finden – robust bei Zeitumstellung.
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (berlinDateKey(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return hi - now.getTime();
}

/** Kleiner, schneller Hash (FNV-1a) → 32-bit Seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministischer Zufallsgenerator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Wählt die Tagesfragen deterministisch aus dem Pool.
 *
 * Der Pool wird (nach ID sortiert) in "Runden" gemischt: Runde r ist eine
 * eigene Permutation mit Seed aus (Sprache, Modus, r). Tag n nimmt die
 * Positionen n·7 … n·7+6 dieser endlosen Folge. So kommt jede Frage erst
 * wieder dran, wenn alle anderen einmal dran waren.
 *
 * Hinweis: Wenn neue Fragen dazukommen, ändert sich die Auswahl künftiger
 * (und vergangener) Tage – alle Spieler mit gleichem Datenstand sehen aber
 * weiterhin dieselben Fragen.
 */
export function selectDailyQuestions(
  pool: readonly Question[],
  dateKey: string,
  lang: Lang,
  mode: Mode,
  count = QUESTIONS_PER_DAY,
): Question[] {
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  if (n === 0) return [];
  const want = Math.min(count, n);

  const rounds = new Map<number, Question[]>();
  const round = (r: number) => {
    let perm = rounds.get(r);
    if (!perm) {
      perm = seededShuffle(sorted, hashString(`${lang}:${mode}:round:${r}`));
      rounds.set(r, perm);
    }
    return perm;
  };

  const picked: Question[] = [];
  const seen = new Set<string>();
  // Index kann für weit zurückliegende Daten negativ werden → in den positiven Bereich falten.
  let pos = dayNumber(dateKey) * count;
  while (picked.length < want) {
    const r = Math.floor(pos / n);
    const q = round(r)[((pos % n) + n) % n];
    if (!seen.has(q.id)) {
      seen.add(q.id);
      picked.push(q);
    }
    pos++;
  }
  return picked;
}
