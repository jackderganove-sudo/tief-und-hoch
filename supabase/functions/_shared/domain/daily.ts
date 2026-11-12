// Automatisch kopiert aus src/domain/daily.ts (npm run function-data) – nicht von Hand ändern.
import type { Lang, Mode, Question } from './types.ts';
import { QUESTIONS_PER_DAY } from './scoring.ts';

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

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Mischt die Fragen so, dass sich Themen abwechseln: Ein Thema kommt erst
 * wieder dran, wenn `spread - 1` andere Fragen dazwischen lagen (solange noch
 * genug Themen übrig sind). Innerhalb dieser Regel wird gewichtet gezogen –
 * große Themen sind über die ganze Runde verteilt statt am Anfang gehäuft.
 */
export function shuffleSpreadByTopic(questions: readonly Question[], rand: () => number, spread: number): Question[] {
  const byTopic = new Map<string, Question[]>();
  for (const q of shuffle(questions, rand)) {
    const list = byTopic.get(q.topic);
    if (list) list.push(q);
    else byTopic.set(q.topic, [q]);
  }
  const out: Question[] = [];
  const recent: string[] = [];
  while (out.length < questions.length) {
    const open = [...byTopic.entries()].filter(([, list]) => list.length > 0);
    const fresh = open.filter(([topic]) => !recent.includes(topic));
    const candidates = fresh.length ? fresh : open;
    let pick = rand() * candidates.reduce((sum, [, list]) => sum + list.length, 0);
    let chosen = candidates[candidates.length - 1];
    for (const c of candidates) {
      pick -= c[1].length;
      if (pick < 0) {
        chosen = c;
        break;
      }
    }
    out.push(chosen[1].pop()!);
    recent.push(chosen[0]);
    if (recent.length >= spread) recent.shift();
  }
  return out;
}

/**
 * Wählt die Tagesfragen eines Modus deterministisch aus dem Pool.
 *
 * Nur Fragen, deren `modes` den Modus enthält. Der Pool wird (nach ID
 * sortiert) in "Runden" gemischt: Runde r ist eine eigene, nach Themen
 * gestreute Permutation mit Seed aus (Sprache, Modus, r) – Rare und Common
 * haben also verschiedene Seeds. Tag n nimmt die Positionen n·7 … n·7+6 dieser
 * endlosen Folge. So kommt eine Frage in der Regel erst wieder dran, wenn alle
 * anderen einmal dran waren, und ein Tag mischt verschiedene Themen (bei
 * mindestens 7 Themen im Pool hat jede Tagesfrage ein anderes Thema).
 *
 * `excludeIds`: Fragen, die an diesem Tag nicht vorkommen dürfen (die des
 * anderen Modus – sonst würde dessen Auflösung die Antworten verraten).
 * Ersatz kommt von einer halben Runde entfernt.
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
  excludeIds: ReadonlySet<string> = new Set(),
): Question[] {
  const sorted = pool.filter((q) => q.modes.includes(mode)).sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  if (n === 0) return [];

  const rounds = new Map<number, Question[]>();
  const at = (pos: number) => {
    const r = Math.floor(pos / n);
    let perm = rounds.get(r);
    if (!perm) {
      perm = shuffleSpreadByTopic(sorted, mulberry32(hashString(`${lang}:${mode}:round:${r}`)), count);
      rounds.set(r, perm);
    }
    return perm[((pos % n) + n) % n];
  };

  const picked: Question[] = [];
  const seen = new Set<string>(excludeIds);
  const topics = new Set<string>();
  const start = dayNumber(dateKey) * count;
  const half = Math.floor(n / 2);
  for (let i = 0; i < count; i++) {
    // Reguläre Position. Ist die Frage gesperrt oder das Thema heute schon dran,
    // kommt Ersatz von einer halben Runde entfernt – erst mit neuem Thema, sonst irgendeine freie.
    const regular = at(start + i);
    let q: Question | undefined;
    for (const needNewTopic of [true, false]) {
      const fits = (c: Question) => !seen.has(c.id) && !(needNewTopic && topics.has(c.topic));
      if (fits(regular)) q = regular;
      for (let j = 0; !q && j < n; j++) {
        const c = at(start + i + half + j);
        if (fits(c)) q = c;
      }
      if (q) break;
    }
    if (!q) break; // Pool erschöpft
    seen.add(q.id);
    topics.add(q.topic);
    picked.push(q);
  }
  return picked;
}

/** Beide Tagessätze; Common enthält keine Frage, die heute schon in Rare vorkommt. */
export function selectDailySets(pool: readonly Question[], dateKey: string, lang: Lang): Record<Mode, Question[]> {
  const rare = selectDailyQuestions(pool, dateKey, lang, 'rare');
  const common = selectDailyQuestions(pool, dateKey, lang, 'common', QUESTIONS_PER_DAY, new Set(rare.map((q) => q.id)));
  return { rare, common };
}
