import { addDays } from '../domain/daily';
import {
  computeStats,
  emptyModeProgress,
  emptySnapshot,
  histOf,
  progressFromLegacy,
  type Achievements,
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
  /** Erfolge (Hölle/Himmel erreicht) mit Datum. */
  getAchievements(): Achievements;
  /** Erfolg festhalten; true, wenn er neu ist. */
  recordAchievement(key: keyof Achievements, dateKey: string): boolean;
}

const KEEP_DAYS = 30;

export class LocalProgressRepository implements ProgressRepository {
  private listeners = new Set<() => void>();
  /**
   * @param prefix Schlüssel-Präfix; der Debug-Modus nutzt einen eigenen ('hal:v1:debug'),
   *               damit Debug-Runden nie in den echten Fortschritt geraten.
   */
  constructor(
    private storage: Storage | null = safeLocalStorage(),
    private prefix = 'hal:v1',
  ) {}

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
        if (k && k.startsWith(`${this.prefix}:day:`) && /^\w+:\d{4}-\d{2}-\d{2}$/.test(k.slice(this.prefix.length + 5))) keys.push(k);
      }
    } catch {
      /* ignorieren */
    }
    return keys;
  }

  /** Verlauf eines Modus; alte Statistik (vor dem Verlauf) wird einmalig übernommen. */
  private progress(mode: Mode): ModeProgress {
    const p = this.read<ModeProgress>(`${this.prefix}:progress:${mode}`);
    if (p) return { history: p.history ?? {}, legacy: { ...emptyModeProgress().legacy, ...p.legacy } };
    const old = this.read<ModeStats>(`${this.prefix}:stats:${mode}`);
    if (!old) return emptyModeProgress();
    const days = this.dayKeys()
      .filter((k) => k.startsWith(`${this.prefix}:day:${mode}:`))
      .map((k) => this.read<DayRecord>(k))
      .filter((d): d is DayRecord => !!d);
    const migrated = progressFromLegacy({ ...old, tierCounts: old.tierCounts ?? {} }, days);
    this.write(`${this.prefix}:progress:${mode}`, migrated);
    return migrated;
  }

  getDay(mode: Mode, dateKey: string) {
    return this.read<DayRecord>(`${this.prefix}:day:${mode}:${dateKey}`);
  }

  clearDay(mode: Mode, dateKey: string) {
    this.remove(`${this.prefix}:day:${mode}:${dateKey}`);
    this.changed();
  }

  clearStats(mode: Mode) {
    this.remove(`${this.prefix}:stats:${mode}`);
    this.remove(`${this.prefix}:progress:${mode}`);
    this.changed();
  }

  saveDay(record: DayRecord) {
    this.write(`${this.prefix}:day:${record.mode}:${record.dateKey}`, record);
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
      this.write(`${this.prefix}:progress:${record.mode}`, p);
      this.changed();
    }
    return computeStats(p);
  }

  getAchievements(): Achievements {
    return this.read<Achievements>(`${this.prefix}:achievements`) ?? {};
  }

  recordAchievement(key: keyof Achievements, dateKey: string): boolean {
    const a = this.getAchievements();
    if (a[key]) return false;
    a[key] = dateKey;
    this.write(`${this.prefix}:achievements`, a);
    this.changed();
    return true;
  }

  exportSnapshot(): Snapshot {
    const snap = emptySnapshot();
    const ach = this.getAchievements();
    if (Object.keys(ach).length) snap.achievements = ach;
    for (const k of this.dayKeys()) {
      const d = this.read<DayRecord>(k);
      if (d) snap.days[`${d.mode}:${d.dateKey}`] = d;
    }
    for (const m of MODES) snap.modes[m] = this.progress(m);
    const lang = this.storage?.getItem('hal:v1:lang');
    if (lang === 'de' || lang === 'en') snap.settings.lang = lang as Lang;
    return snap;
  }

  importSnapshot(snapshot: Snapshot) {
    for (const k of this.dayKeys()) this.remove(k);
    for (const d of Object.values(snapshot.days)) this.write(`${this.prefix}:day:${d.mode}:${d.dateKey}`, d);
    for (const m of MODES) this.write(`${this.prefix}:progress:${m}`, snapshot.modes[m] ?? emptyModeProgress());
    if (snapshot.achievements && Object.keys(snapshot.achievements).length) this.write(`${this.prefix}:achievements`, snapshot.achievements);
    else this.remove(`${this.prefix}:achievements`);
    if (snapshot.settings.lang) {
      try {
        this.storage?.setItem('hal:v1:lang', snapshot.settings.lang);
      } catch {
        /* ignorieren */
      }
    }
  }

  clearAll() {
    for (const k of this.dayKeys()) this.remove(k);
    for (const m of MODES) {
      this.remove(`${this.prefix}:progress:${m}`);
      this.remove(`${this.prefix}:stats:${m}`);
    }
    this.remove(`${this.prefix}:achievements`);
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

/**
 * Reicht an den echten Fortschritt oder – im Debug-Modus – an die Sandbox weiter.
 * Der Sync (ProgressSync) hängt nur am echten Repository, nie an der Sandbox.
 */
export class DebugAwareProgressRepository implements ProgressRepository {
  constructor(
    readonly real: ProgressRepository,
    readonly sandbox: ProgressRepository,
    private readonly debug: () => boolean,
  ) {}
  private get r() {
    return this.debug() ? this.sandbox : this.real;
  }
  getDay(mode: Mode, dateKey: string) {
    return this.r.getDay(mode, dateKey);
  }
  saveDay(record: DayRecord) {
    this.r.saveDay(record);
  }
  getStats(mode: Mode) {
    return this.r.getStats(mode);
  }
  getStreak(mode: Mode, today: string) {
    return this.r.getStreak(mode, today);
  }
  recordFinished(record: DayRecord) {
    return this.r.recordFinished(record);
  }
  clearDay(mode: Mode, dateKey: string) {
    this.r.clearDay(mode, dateKey);
  }
  clearStats(mode: Mode) {
    this.r.clearStats(mode);
  }
  exportSnapshot() {
    return this.r.exportSnapshot();
  }
  importSnapshot(snapshot: Snapshot) {
    this.r.importSnapshot(snapshot);
  }
  clearAll() {
    this.r.clearAll();
  }
  onChange(listener: () => void) {
    const a = this.real.onChange(listener);
    const b = this.sandbox.onChange(listener);
    return () => {
      a();
      b();
    };
  }
  getAchievements() {
    return this.r.getAchievements();
  }
  recordAchievement(key: 'hell' | 'heaven', dateKey: string) {
    return this.r.recordAchievement(key, dateKey);
  }
  /** Sandbox mit einer Kopie des echten Stands füllen (beim Einschalten des Debug-Modus). */
  seedSandbox() {
    this.sandbox.importSnapshot(this.real.exportSnapshot());
  }
}
