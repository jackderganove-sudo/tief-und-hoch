// Automatisch kopiert aus src/domain/roomScoring.ts (npm run function-data) – nicht von Hand ändern.
/**
 * Wertung im Freunde-Modus.
 *
 * Global: wie im normalen Spiel (Liste/baseScore bzw. KI-Schätzung) – pro Antwort
 *   schon beim Eingang berechnet (global_points/global_tier).
 *
 * Gruppe: Seltenheit innerhalb des Raums. Gültig ist, was Liste/KI (bzw. der Gastgeber)
 *   gelten lässt; gleiche Antworten werden über Liste/Aliase/KI-Schreibweise zusammengefasst.
 *   k = Spieler mit derselben Antwort, N = gültige Antworten,
 *   Anteil der anderen, die dasselbe sagten: f = (k−1)/(N−1)·100 (N=1 → 0).
 *   Abstieg: nur du (k=1) = 100 („Nur du!“), sonst Medaille aus f über die Abstiegs-
 *            Schwellen (≤3 → 100 … >50 → 10), höchstens 85 für k ≥ 2.
 *   Aufstieg: größte Gruppe (k ≥ 2) = 100 („Volltreffer: Mehrheit“), sonst Medaille aus f
 *            über die Aufstiegs-Schwellen (≥80 … <12 → 10), höchstens 85.
 *   Sonderregel 2 Spieler (Abstieg): verschiedene Antworten = je 60 statt 100 –
 *            sonst wäre jede Zweier-Runde ein Diamant.
 *   Ungültig = 0.
 */
import { tierFor, TIERS } from './scoring.ts';
import type { Mode, TierId } from './types.ts';

export type Special = 'only_you' | 'majority' | 'same_pair';

export interface RoomAnswerInput {
  userId: string;
  raw: string;
  valid: boolean;
  /** Zusammenfassung gleicher Antworten (Listen-Text oder KI-Schreibweise, kompakt) */
  groupKey: string;
  /** Anzeigetext der Gruppe */
  display: string;
  globalTier?: TierId | null;
  globalPoints?: number | null;
  source?: 'list' | 'ai' | null;
}

export interface PlayerScore {
  points: number;
  tier: TierId;
  group: string | null;
  special?: Special;
}

export interface RevealGroup {
  key: string;
  text: string;
  valid: boolean;
  count: number;
  players: string[];
  /** Punkte für diese Gruppe (bei „Global“ können sie innerhalb der Gruppe gleich sein) */
  points: number;
  tier: TierId;
  special?: Special;
  source?: 'list' | 'ai' | null;
}

export interface QuestionScore {
  perPlayer: Record<string, PlayerScore>;
  groups: RevealGroup[];
  /** Mitspieler ohne Antwort (0 Punkte) */
  missed: string[];
}

/** Punkte einer gültigen Antwort bei „Gruppe“. */
export function groupScore(mode: Mode, k: number, nValid: number, participants: number, largestK: number): { tier: TierId; special?: Special } {
  const f = nValid <= 1 ? 0 : (100 * (k - 1)) / (nValid - 1);
  if (mode === 'rare') {
    if (k === 1) {
      if (participants <= 2) return { tier: 'crystal' }; // Sonderregel 2 Spieler
      return { tier: 'core', special: 'only_you' };
    }
    const t = tierFor('rare', f);
    return { tier: t === 'core' ? 'ember' : t };
  }
  if (k >= 2 && k === largestK) return { tier: 'stars', special: participants <= 2 ? 'same_pair' : 'majority' };
  const t = tierFor('common', f);
  return { tier: t === 'stars' ? 'sunset' : t };
}

/**
 * Eine Frage auswerten.
 * @param participants Spieler, die bei dieser Frage mitspielen (auch ohne Antwort)
 */
export function scoreQuestion(params: {
  mode: Mode;
  scoring: 'global' | 'group';
  participants: readonly string[];
  answers: readonly RoomAnswerInput[];
}): QuestionScore {
  const { mode, scoring, participants } = params;
  const inRoom = new Set(participants);
  const answers = params.answers.filter((a) => inRoom.has(a.userId));

  const byKey = new Map<string, RoomAnswerInput[]>();
  for (const a of answers) {
    const key = `${a.valid ? 'v' : 'x'}:${a.groupKey}`;
    byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  const validGroups = [...byKey.entries()].filter(([k]) => k.startsWith('v:'));
  const nValid = validGroups.reduce((s, [, g]) => s + g.length, 0);
  const largestK = Math.max(0, ...validGroups.map(([, g]) => g.length));

  const perPlayer: Record<string, PlayerScore> = {};
  const groups: RevealGroup[] = [];
  for (const [key, g] of byKey) {
    const valid = g[0].valid;
    let tier: TierId = 'invalid';
    let special: Special | undefined;
    if (valid && scoring === 'group') ({ tier, special } = groupScore(mode, g.length, nValid, participants.length, largestK));
    for (const a of g) {
      let t: TierId = tier;
      if (valid && scoring === 'global') t = a.globalTier ?? 'invalid';
      const points = valid ? (scoring === 'global' ? a.globalPoints ?? TIERS[t].points : TIERS[t].points) : 0;
      perPlayer[a.userId] = { points, tier: valid ? t : 'invalid', group: key, special: valid && scoring === 'group' ? special : g.length === 1 && valid && participants.length > 2 ? 'only_you' : undefined };
    }
    const first = perPlayer[g[0].userId];
    groups.push({
      key,
      text: g[0].display,
      valid,
      count: g.length,
      players: g.map((a) => a.userId),
      points: first.points,
      tier: first.tier,
      special: first.special,
      source: g[0].source ?? null,
    });
  }
  const missed = participants.filter((u) => !perPlayer[u]);
  for (const u of missed) perPlayer[u] = { points: 0, tier: 'invalid', group: null };
  // gültige zuerst, dann nach Anzahl
  groups.sort((a, b) => Number(b.valid) - Number(a.valid) || b.count - a.count || a.text.localeCompare(b.text));
  return { perPlayer, groups, missed };
}

/** Spieler nach Punkten (Gleichstand: gleicher Platz). */
export function standings(points: Record<string, number>): { userId: string; points: number; place: number }[] {
  const sorted = Object.entries(points).sort((a, b) => b[1] - a[1]);
  let place = 0;
  let prev = Number.NaN;
  return sorted.map(([userId, p], i) => {
    if (p !== prev) place = i + 1;
    prev = p;
    return { userId, points: p, place };
  });
}

// ---------------------------------------------------------------- Endbildschirm

export interface RevealLike {
  groups: { valid: boolean; players: string[] }[];
}

export interface Awards {
  /** Die zwei Spieler, die am häufigsten dieselbe Antwort hatten */
  mindReaders: { a: string; b: string; count: number } | null;
  /** Wer am häufigsten als Einziger eine (gültige) Antwort hatte */
  loner: { userId: string; count: number } | null;
}

export function matchAwards(reveals: readonly RevealLike[]): Awards {
  const pairs = new Map<string, number>();
  const alone = new Map<string, number>();
  for (const r of reveals) {
    for (const g of r.groups) {
      if (!g.valid) continue;
      if (g.players.length === 1) alone.set(g.players[0], (alone.get(g.players[0]) ?? 0) + 1);
      const ps = [...g.players].sort();
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const key = `${ps[i]}|${ps[j]}`;
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
    }
  }
  const bestPair = [...pairs].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
  const bestAlone = [...alone].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
  return {
    mindReaders: bestPair ? { a: bestPair[0].split('|')[0], b: bestPair[0].split('|')[1], count: bestPair[1] } : null,
    loner: bestAlone ? { userId: bestAlone[0], count: bestAlone[1] } : null,
  };
}

/** „Match“-Moment direkt nach der Frage: wer hatte dasselbe wie ich? */
export function myMatch(reveal: { groups: { valid: boolean; players: string[]; key: string }[] }, me: string): { group: string | null; others: string[]; valid: boolean } {
  const g = reveal.groups.find((x) => x.players.includes(me));
  if (!g) return { group: null, others: [], valid: false };
  return { group: g.key, others: g.players.filter((p) => p !== me), valid: g.valid };
}
