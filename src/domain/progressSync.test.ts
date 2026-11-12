import { describe, expect, it } from 'vitest';
import { computeStats, emptySnapshot, histOf, mergeSnapshots, progressFromLegacy, type DayRecord, type Snapshot } from './progressSync';
import { LocalProgressRepository } from '../services/ProgressRepository';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const day = (dateKey: string, points: number[], mode: 'rare' | 'common' = 'rare', finished = true): DayRecord => ({
  dateKey,
  mode,
  lang: 'de',
  questionIds: points.map((_, i) => `q${i}`),
  results: points.map((p, i) => ({
    questionId: `q${i}`,
    input: 'x',
    matched: 'x',
    fuzzy: false,
    frequency: 1,
    tier: p === 100 ? 'core' : 'moss',
    points: p,
    timedOut: false,
  })),
  questionStartedAt: null,
  finished,
});

/** Snapshot eines Geräts, das an den angegebenen Tagen gespielt hat. */
function device(dates: [string, number][], mode: 'rare' | 'common' = 'rare'): Snapshot {
  const repo = new LocalProgressRepository(new MemoryStorage());
  for (const [d, p] of dates) {
    const rec = day(d, [p], mode);
    repo.saveDay(rec);
    repo.recordFinished(rec);
  }
  return repo.exportSnapshot();
}

describe('Statistik aus dem Verlauf', () => {
  it('Serie, Bestwert und Medaillen', () => {
    const s = device([
      ['2026-11-01', 100],
      ['2026-11-02', 10],
      ['2026-11-04', 100],
      ['2026-11-05', 100],
      ['2026-11-06', 10],
    ]);
    const st = computeStats(s.modes.rare);
    expect(st).toMatchObject({ played: 5, totalPoints: 320, best: 100, currentStreak: 3, maxStreak: 3, lastPlayed: '2026-11-06' });
    expect(st.tierCounts).toEqual({ core: 3, moss: 2 });
  });

  it('übernimmt alte Statistik (vor dem Verlauf) ohne Verlust', () => {
    const old = { played: 40, totalPoints: 9000, best: 610, currentStreak: 2, maxStreak: 12, lastPlayed: '2026-11-06', tierCounts: { core: 50, moss: 30 } };
    const p = progressFromLegacy(old, [day('2026-11-05', [100]), day('2026-11-06', [10]), day('2026-11-07', [10], 'rare', false)]);
    expect(Object.keys(p.history)).toEqual(['2026-11-05', '2026-11-06']);
    const st = computeStats(p);
    expect(st).toMatchObject({ played: 40, totalPoints: 9000, best: 610, maxStreak: 12, currentStreak: 2 });
    expect(st.tierCounts).toEqual({ core: 50, moss: 30 });
  });
});

describe('Zusammenführen beim Login auf einem zweiten Gerät', () => {
  it('vereinigt Tagesergebnisse, ohne Runden doppelt zu zählen; die längere Serie ergibt sich', () => {
    const account = device([
      ['2026-11-01', 100],
      ['2026-11-02', 100],
      ['2026-11-03', 100],
    ]);
    const phone = device([
      ['2026-11-03', 10], // gleicher Tag wie im Konto → Konto gewinnt
      ['2026-11-04', 60],
      ['2026-11-05', 60],
    ]);
    const { merged, summary } = mergeSnapshots(account, phone);
    expect(summary).toEqual({ addedRounds: 2, duplicateDays: 1, streak: { rare: 5, common: 0 } });
    const st = computeStats(merged.modes.rare);
    expect(st).toMatchObject({ played: 5, totalPoints: 420, currentStreak: 5, maxStreak: 5 });
    expect(merged.modes.rare.history['2026-11-03']).toEqual(histOf(day('2026-11-03', [100])));
  });

  it('Tagesspielstände: fertig schlägt offen, sonst gewinnt das Konto', () => {
    const remote = emptySnapshot();
    const local = emptySnapshot();
    remote.days['rare:2026-11-07'] = day('2026-11-07', [10], 'rare', false);
    local.days['rare:2026-11-07'] = day('2026-11-07', [10, 60], 'rare', true);
    remote.days['common:2026-11-07'] = day('2026-11-07', [100], 'common', true);
    local.days['common:2026-11-07'] = day('2026-11-07', [10], 'common', true);
    const { merged } = mergeSnapshots(remote, local);
    expect(merged.days['rare:2026-11-07'].finished).toBe(true);
    expect(merged.days['common:2026-11-07'].results[0].points).toBe(100);
  });

  it('Einstellungen: Konto gewinnt, fehlende vom Gerät', () => {
    const remote = emptySnapshot();
    const local = emptySnapshot();
    local.settings.lang = 'en';
    expect(mergeSnapshots(remote, local).merged.settings.lang).toBe('en');
    remote.settings.lang = 'de';
    expect(mergeSnapshots(remote, local).merged.settings.lang).toBe('de');
  });

  it('Snapshot hin und zurück: import ersetzt den lokalen Stand vollständig', () => {
    const snap = device([['2026-11-01', 100]]);
    const repo = new LocalProgressRepository(new MemoryStorage());
    repo.saveDay(day('2026-10-01', [10]));
    repo.importSnapshot(snap);
    expect(repo.getDay('rare', '2026-10-01')).toBeNull();
    expect(repo.getStats('rare').played).toBe(1);
    expect(repo.exportSnapshot()).toEqual(snap);
  });

  it('Abmelden/Konto löschen: clearAll entfernt allen Fortschritt', () => {
    const storage = new MemoryStorage();
    const repo = new LocalProgressRepository(storage);
    repo.saveDay(day('2026-11-01', [100]));
    repo.recordFinished(day('2026-11-01', [100]));
    storage.setItem('hal:v1:lang', 'en');
    repo.clearAll();
    expect(repo.getStats('rare').played).toBe(0);
    expect(storage.getItem('hal:v1:lang')).toBe('en'); // Sprache ist eine Geräteeinstellung
  });
});
