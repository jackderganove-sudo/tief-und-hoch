import { addDays } from '../domain/daily';
import {
  computeStats,
  emptyModeProgress,
  emptySnapshot,
  histOf,
  progressFromLegacy,
  type DayRecord,
  type ModeProgress,
  type ModeStats,
  type Snapshot,
} from '../domain/progressSync';
import { MODES, type Lang, type Mode } from '../domain/types';

export { emptyStats } from '../domain/progressSync';
export type { DayRecord, ModeStats } from '../domain/progressSync';

/**
 * Lokaler Fortschritt (Spielstand, Streak, Statistik).
 * Bewusst synchron: localStorage ist sofort da und bleibt Offline-Cache.
 * Der Sync mit Supabase (ProgressSync) liest/schreibt Snapshots und hört auf Änderungen.
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
  /** Gesamter Fortschritt als Snapshot (für Sync/Zusammenführen). */
  exportSnapshot(): Snapshot;
  /** Snapshot übernehmen (ersetzt den lokalen Stand). */
  importSnapshot(snapshot: Snapshot): void;
  /** Alles Lokale löschen (Konto gelöscht / abgemeldet). */
  clearAll(): void;
  /** Wird nach jeder Änderung aufgerufen (Sync). */
  onChange(listener: () => void): () => void;
}

const PREFIX = 'hal:v1';
const KEEP_DAYS = 30;

export class LocalProgressRepository implements ProgressRepository {
  private listeners = new Set<() => void>();
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

  private remove(key: string) {
    try {
      this.storage?.removeItem(key);
    } catch {
      /* ignorieren */
    }
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private dayKeys(): string[] {
    const keys: string[] = [];
    try {
      for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const k = this.storage!.key(i);
        if (k && /^hal:v1:day:\w+:\d{4}-\d{2}-\d{2}$/.test(k)) keys.push(k);
      }
    } catch {
      /* ignorieren */
    }
    return keys;
  }

  /** Verlauf eines Modus; alte Statistik (vor dem Verlauf) wird einmalig übernommen. */
  private progress(mode: Mode): ModeProgress {
    const p = this.read<ModeProgress>(`${PREFIX}:progress:${mode}`);
    if (p) return { history: p.history ?? {}, legacy: { ...emptyModeProgress().legacy, ...p.legacy } };
    const old = this.read<ModeStats>(`${PREFIX}:stats:${mode}`);
    if (!old) return emptyModeProgress();
    const days = this.dayKeys()
      .filter((k) => k.startsWith(`${PREFIX}:day:${mode}:`))
      .map((k) => this.read<DayRecord>(k))
      .filter((d): d is DayRecord => !!d);
    const migrated = progressFromLegacy({ ...old, tierCounts: old.tierCounts ?? {} }, days);
    this.write(`${PREFIX}:progress:${mode}`, migrated);
    return migrated;
  }

  getDay(mode: Mode, dateKey: string) {
    return this.read<DayRecord>(`${PREFIX}:day:${mode}:${dateKey}`);
  }

  clearDay(mode: Mode, dateKey: string) {
    this.remove(`${PREFIX}:day:${mode}:${dateKey}`);
    this.changed();
  }

  clearStats(mode: Mode) {
    this.remove(`${PREFIX}:stats:${mode}`);
    this.remove(`${PREFIX}:progress:${mode}`);
    this.changed();
  }

  saveDay(record: DayRecord) {
    this.write(`${PREFIX}:day:${record.mode}:${record.dateKey}`, record);
    this.prune(record.dateKey);
    this.changed();
  }

  getStats(mode: Mode) {
    return computeStats(this.progress(mode));
  }

  getStreak(mode: Mode, today: string) {
    const s = this.getStats(mode);
    return s.lastPlayed === today || s.lastPlayed === addDays(today, -1) ? s.currentStreak : 0;
  }

  recordFinished(record: DayRecord): ModeStats {
    const p = this.progress(record.mode);
    if (!p.history[record.dateKey]) {
      p.history[record.dateKey] = histOf(record);
      this.write(`${PREFIX}:progress:${record.mode}`, p);
      this.changed();
    }
    return computeStats(p);
  }

  exportSnapshot(): Snapshot {
    const snap = emptySnapshot();
    for (const k of this.dayKeys()) {
      const d = this.read<DayRecord>(k);
      if (d) snap.days[`${d.mode}:${d.dateKey}`] = d;
    }
    for (const m of MODES) snap.modes[m] = this.progress(m);
    const lang = this.storage?.getItem(`${PREFIX}:lang`);
    if (lang === 'de' || lang === 'en') snap.settings.lang = lang as Lang;
    return snap;
  }

  importSnapshot(snapshot: Snapshot) {
    for (const k of this.dayKeys()) this.remove(k);
    for (const d of Object.values(snapshot.days)) this.write(`${PREFIX}:day:${d.mode}:${d.dateKey}`, d);
    for (const m of MODES) this.write(`${PREFIX}:progress:${m}`, snapshot.modes[m] ?? emptyModeProgress());
    if (snapshot.settings.lang) {
      try {
        this.storage?.setItem(`${PREFIX}:lang`, snapshot.settings.lang);
      } catch {
        /* ignorieren */
      }
    }
  }

  clearAll() {
    for (const k of this.dayKeys()) this.remove(k);
    for (const m of MODES) {
      this.remove(`${PREFIX}:progress:${m}`);
      this.remove(`${PREFIX}:stats:${m}`);
    }
    this.changed();
  }

  /** Alte Tages-Spielstände entfernen, damit localStorage nicht wächst (Verlauf bleibt). */
  private prune(today: string) {
    if (!this.storage) return;
    const cutoff = addDays(today, -KEEP_DAYS);
    for (const key of this.dayKeys()) {
      const m = /(\d{4}-\d{2}-\d{2})$/.exec(key);
      if (m && m[1] < cutoff) this.remove(key);
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
