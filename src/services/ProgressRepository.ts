import { addDays } from '../domain/daily';
import { totalPoints } from '../domain/scoring';
import type { AnswerResult, Lang, Mode, TierId } from '../domain/types';

/** Spielstand eines Modus an einem Tag. */
export interface DayRecord {
  dateKey: string;
  mode: Mode;
  lang: Lang;
  questionIds: string[];
  results: AnswerResult[];
  /** Zeitpunkt, an dem die aktuelle Frage erschien – der Timer läuft auch über Reloads weiter. */
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

/**
 * Lokaler Fortschritt (Spielstand, Streak, Statistik).
 * Bewusst synchron: localStorage ist sofort da. Ein späterer Sync mit
 * Supabase kann diese Klasse umhüllen, ohne dass sich die UI ändert.
 */
export interface ProgressRepository {
  getDay(mode: Mode, dateKey: string): DayRecord | null;
  saveDay(record: DayRecord): void;
  getStats(mode: Mode): ModeStats;
  /** Streak, wie er heute angezeigt wird (0, wenn gestern nicht gespielt wurde). */
  getStreak(mode: Mode, today: string): number;
  recordFinished(record: DayRecord): ModeStats;
  /** Spielstand eines Tages löschen (Debug-Modus). */
  clearDay(mode: Mode, dateKey: string): void;
  /** Statistik und Serie eines Modus löschen (Debug-Modus). */
  clearStats(mode: Mode): void;
}

const PREFIX = 'tuh:v1';
const KEEP_DAYS = 30;

export class LocalProgressRepository implements ProgressRepository {
  constructor(private storage: Storage | null = safeLocalStorage()) {}

  private read<T>(key: string): T | null {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown) {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Speicher voll oder gesperrt (privater Modus) – Spiel läuft trotzdem weiter.
    }
  }

  getDay(mode: Mode, dateKey: string) {
    return this.read<DayRecord>(`${PREFIX}:day:${mode}:${dateKey}`);
  }

  clearDay(mode: Mode, dateKey: string) {
    try {
      this.storage?.removeItem(`${PREFIX}:day:${mode}:${dateKey}`);
    } catch {
      /* ignorieren */
    }
  }

  clearStats(mode: Mode) {
    try {
      this.storage?.removeItem(`${PREFIX}:stats:${mode}`);
    } catch {
      /* ignorieren */
    }
  }

  saveDay(record: DayRecord) {
    this.write(`${PREFIX}:day:${record.mode}:${record.dateKey}`, record);
    this.prune(record.dateKey);
  }

  getStats(mode: Mode) {
    return { ...emptyStats(), ...this.read<ModeStats>(`${PREFIX}:stats:${mode}`) };
  }

  getStreak(mode: Mode, today: string) {
    const s = this.getStats(mode);
    return s.lastPlayed === today || s.lastPlayed === addDays(today, -1) ? s.currentStreak : 0;
  }

  recordFinished(record: DayRecord): ModeStats {
    const s = this.getStats(record.mode);
    if (s.lastPlayed === record.dateKey) return s; // schon gezählt

    const points = totalPoints(record.results);
    const streak = s.lastPlayed === addDays(record.dateKey, -1) ? s.currentStreak + 1 : 1;
    const tierCounts = { ...s.tierCounts };
    for (const r of record.results) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;

    const next: ModeStats = {
      played: s.played + 1,
      totalPoints: s.totalPoints + points,
      best: Math.max(s.best, points),
      currentStreak: streak,
      maxStreak: Math.max(s.maxStreak, streak),
      lastPlayed: record.dateKey,
      tierCounts,
    };
    this.write(`${PREFIX}:stats:${record.mode}`, next);
    return next;
  }

  /** Alte Tages-Spielstände entfernen, damit localStorage nicht wächst. */
  private prune(today: string) {
    if (!this.storage) return;
    const cutoff = addDays(today, -KEEP_DAYS);
    try {
      for (let i = this.storage.length - 1; i >= 0; i--) {
        const key = this.storage.key(i);
        const m = key && /^tuh:v1:day:\w+:(\d{4}-\d{2}-\d{2})$/.exec(key);
        if (m && m[1] < cutoff) this.storage.removeItem(key!);
      }
    } catch {
      /* ignorieren */
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
