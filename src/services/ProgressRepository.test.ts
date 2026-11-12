import { describe, expect, it, vi } from 'vitest';
import { LocalProgressRepository, type DayRecord } from './ProgressRepository';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const day = (dateKey: string, points: number[]): DayRecord => ({
  dateKey,
  mode: 'rare',
  lang: 'de',
  questionIds: points.map((_, i) => `q${i}`),
  results: points.map((p, i) => ({
    questionId: `q${i}`, input: 'x', matched: 'x', fuzzy: false, frequency: 1,
    tier: p === 100 ? 'core' : 'moss', points: p, timedOut: false,
  })),
  questionStartedAt: null,
  finished: true,
});

describe('LocalProgressRepository', () => {
  it('tracks streaks, best and counts each day once', () => {
    const repo = new LocalProgressRepository(new MemoryStorage());
    repo.recordFinished(day('2026-11-09', [100, 10]));
    repo.recordFinished(day('2026-11-10', [10]));
    const s = repo.recordFinished(day('2026-11-10', [10]));
    expect(s).toMatchObject({ played: 2, best: 110, currentStreak: 2, maxStreak: 2, totalPoints: 120 });
    expect(s.tierCounts).toEqual({ core: 1, moss: 2 });
    expect(repo.getStreak('rare', '2026-11-11')).toBe(2);
    expect(repo.getStreak('rare', '2026-11-12')).toBe(0);
    const s2 = repo.recordFinished(day('2026-11-13', [10]));
    expect(s2).toMatchObject({ currentStreak: 1, maxStreak: 2 });
  });

  it('clears a single day and the stats on request', () => {
    const repo = new LocalProgressRepository(new MemoryStorage());
    repo.saveDay(day('2026-11-10', [10]));
    repo.saveDay(day('2026-11-11', [10]));
    repo.recordFinished(day('2026-11-11', [10]));
    repo.clearDay('rare', '2026-11-11');
    expect(repo.getDay('rare', '2026-11-11')).toBeNull();
    expect(repo.getDay('rare', '2026-11-10')).not.toBeNull();
    repo.clearStats('rare');
    expect(repo.getStats('rare').played).toBe(0);
  });

  it('prunes old day records', () => {
    const storage = new MemoryStorage();
    const repo = new LocalProgressRepository(storage);
    repo.saveDay(day('2026-09-01', [10]));
    repo.saveDay(day('2026-11-11', [10]));
    expect(repo.getDay('rare', '2026-09-01')).toBeNull();
    expect(repo.getDay('rare', '2026-11-11')).not.toBeNull();
  });
});

describe('Debug-Runden zählen nicht (Sandbox)', async () => {
  const { DebugAwareProgressRepository } = await import('./ProgressRepository');
  it('im Debug-Modus landen Runden nur in der Sandbox; echter Stand, Serie und Sync bleiben unberührt', () => {
    const storage = new MemoryStorage();
    const real = new LocalProgressRepository(storage);
    const sandbox = new LocalProgressRepository(storage, 'hal:v1:debug');
    let debug = false;
    const repo = new DebugAwareProgressRepository(real, sandbox, () => debug);
    const synced = vi.fn();
    real.onChange(synced); // so hängt ProgressSync am echten Repository

    repo.saveDay(day('2026-11-09', [100]));
    repo.recordFinished(day('2026-11-09', [100]));
    expect(real.getStats('rare').played).toBe(1);
    synced.mockClear();

    debug = true;
    repo.seedSandbox();
    expect(repo.getStats('rare').played).toBe(1); // Kopie des echten Stands
    repo.saveDay(day('2026-11-15', [100, 100]));
    repo.recordFinished(day('2026-11-15', [100, 100]));
    repo.clearStats('common');
    expect(repo.getStats('rare').played).toBe(2);

    debug = false;
    expect(repo.getStats('rare')).toMatchObject({ played: 1, totalPoints: 100, currentStreak: 1 });
    expect(real.getDay('rare', '2026-11-15')).toBeNull();
    expect(Object.keys(real.exportSnapshot().days)).toEqual(['rare:2026-11-09']);
    expect(synced).not.toHaveBeenCalled();
  });
});
