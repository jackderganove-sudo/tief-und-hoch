/**
 * Fortschritt als Snapshot – für Sync zwischen Geräten und das Zusammenführen
 * beim Login. Statistik und Serie werden immer aus dem Verlauf berechnet
 * (ein Eintrag pro fertig gespieltem Tag), dadurch lassen sich zwei Geräte
 * ohne Doppelzählung zusammenführen.
 */
import { addDays } from './daily';
import { totalPoints } from './scoring';
import type { AnswerResult, Lang, Mode, TierId } from './types';
import { MODES } from './types';

export interface DayRecord {
  dateKey: string;
  mode: Mode;
  lang: Lang;
  questionIds: string[];
  results: AnswerResult[];
  questionStartedAt: number | null;
  finished: boolean;
}

export interface ModeStats {
  played: number;
  totalPoints: number;
  best: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayed: string | null;
  tierCounts: Partial<Record<TierId, number>>;
}

export const emptyStats = (): ModeStats => ({
  played: 0,
  totalPoints: 0,
  best: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayed: null,
  tierCounts: {},
});

/** Ergebnis eines fertig gespielten Tages. */
export interface DayHist {
  points: number;
  tiers: Partial<Record<TierId, number>>;
}

/** Ältere Runden, für die es keinen Verlauf mehr gibt (vor Einführung des Verlaufs). */
export interface LegacyBase {
  played: number;
  totalPoints: number;
  best: number;
  maxStreak: number;
  tierCounts: Partial<Record<TierId, number>>;
}

export interface ModeProgress {
  history: Record<string, DayHist>;
  legacy: LegacyBase;
}

export interface Snapshot {
  version: 1;
  /** Schlüssel "mode:YYYY-MM-DD" */
  days: Record<string, DayRecord>;
  modes: Record<Mode, ModeProgress>;
  settings: { lang?: Lang };
}

export const emptyLegacy = (): LegacyBase => ({ played: 0, totalPoints: 0, best: 0, maxStreak: 0, tierCounts: {} });
export const emptyModeProgress = (): ModeProgress => ({ history: {}, legacy: emptyLegacy() });
export const emptySnapshot = (): Snapshot => ({
  version: 1,
  days: {},
  modes: { rare: emptyModeProgress(), common: emptyModeProgress() },
  settings: {},
});

export function histOf(record: Pick<DayRecord, 'results'>): DayHist {
  const tiers: Partial<Record<TierId, number>> = {};
  for (const r of record.results) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
  return { points: totalPoints(record.results), tiers };
}

function addTiers(a: Partial<Record<TierId, number>>, b: Partial<Record<TierId, number>>) {
  const out = { ...a };
  for (const [k, n] of Object.entries(b) as [TierId, number][]) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** Längste Folge aufeinanderfolgender Tage und die Folge, die am letzten Tag endet. */
function streaks(dates: string[]): { current: number; max: number } {
  const sorted = [...dates].sort();
  let max = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    max = Math.max(max, run);
    prev = d;
  }
  return { current: run, max };
}

/** Statistik aus Verlauf + Altbestand. */
export function computeStats(p: ModeProgress): ModeStats {
  const dates = Object.keys(p.history).sort();
  const hist = dates.map((d) => p.history[d]);
  const { current, max } = streaks(dates);
  return {
    played: p.legacy.played + hist.length,
    totalPoints: p.legacy.totalPoints + hist.reduce((s, h) => s + h.points, 0),
    best: Math.max(p.legacy.best, ...hist.map((h) => h.points), 0),
    currentStreak: current,
    maxStreak: Math.max(p.legacy.maxStreak, max),
    lastPlayed: dates.at(-1) ?? null,
    tierCounts: hist.reduce((t, h) => addTiers(t, h.tiers), { ...p.legacy.tierCounts }),
  };
}

/**
 * Aus altem Statistik-Stand (vor Einführung des Verlaufs) und den noch
 * vorhandenen Tagesspielständen einen Verlauf bauen. Was älter ist und
 * keinen Tagesspielstand mehr hat, wandert in den Altbestand.
 */
export function progressFromLegacy(stats: ModeStats, days: DayRecord[]): ModeProgress {
  const history: Record<string, DayHist> = {};
  for (const d of days) if (d.finished) history[d.dateKey] = histOf(d);
  const hist = Object.values(history);
  const legacyTiers = { ...stats.tierCounts };
  for (const h of hist) for (const [k, n] of Object.entries(h.tiers) as [TierId, number][]) legacyTiers[k] = Math.max(0, (legacyTiers[k] ?? 0) - n);
  return {
    history,
    legacy: {
      played: Math.max(0, stats.played - hist.length),
      totalPoints: Math.max(0, stats.totalPoints - hist.reduce((s, h) => s + h.points, 0)),
      best: stats.best,
      maxStreak: stats.maxStreak,
      tierCounts: legacyTiers,
    },
  };
}

export interface MergeSummary {
  /** Tagesrunden, die das Konto vom Gerät neu bekommen hat */
  addedRounds: number;
  /** Tage, an denen beide gespielt hatten – nur eine Runde wird behalten */
  duplicateDays: number;
  /** Serie nach dem Zusammenführen, je Modus */
  streak: Record<Mode, number>;
}

/**
 * Konto-Stand (remote) und Gerät (local) zusammenführen:
 * - Tagesspielstände vereinigen; am selben Tag gewinnt ein fertiger vor einem
 *   offenen, bei zwei fertigen der des Kontos (keine doppelten Runden).
 * - Verlauf vereinigen (gleicher Tag nur einmal, Konto gewinnt), Altbestand addieren.
 * - Serie/Statistik danach neu berechnen → die längere Serie ergibt sich von selbst.
 * - Einstellungen: Konto gewinnt, fehlende Werte vom Gerät.
 */
export function mergeSnapshots(remote: Snapshot, local: Snapshot): { merged: Snapshot; summary: MergeSummary } {
  const days: Record<string, DayRecord> = { ...remote.days };
  for (const [key, d] of Object.entries(local.days)) {
    const r = days[key];
    if (!r || (!r.finished && (d.finished || d.results.length > r.results.length))) days[key] = d;
  }
  let addedRounds = 0;
  let duplicateDays = 0;
  const modes = {} as Record<Mode, ModeProgress>;
  for (const m of MODES) {
    const rm = remote.modes[m] ?? emptyModeProgress();
    const lm = local.modes[m] ?? emptyModeProgress();
    const history = { ...rm.history };
    for (const [date, h] of Object.entries(lm.history)) {
      if (history[date]) duplicateDays++;
      else {
        history[date] = h;
        addedRounds++;
      }
    }
    modes[m] = {
      history,
      legacy: {
        played: rm.legacy.played + lm.legacy.played,
        totalPoints: rm.legacy.totalPoints + lm.legacy.totalPoints,
        best: Math.max(rm.legacy.best, lm.legacy.best),
        maxStreak: Math.max(rm.legacy.maxStreak, lm.legacy.maxStreak),
        tierCounts: addTiers(rm.legacy.tierCounts, lm.legacy.tierCounts),
      },
    };
  }
  const merged: Snapshot = { version: 1, days, modes, settings: { ...local.settings, ...remote.settings } };
  return {
    merged,
    summary: {
      addedRounds,
      duplicateDays,
      streak: { rare: computeStats(modes.rare).currentStreak, common: computeStats(modes.common).currentStreak },
    },
  };
}

/** Ist der Snapshot gleich (für „nichts zu tun“)? */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
