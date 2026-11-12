import { describe, expect, it, vi } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));
let debug = false;
vi.mock('./client', () => ({
  SUPABASE_URL: 'https://x.supabase.co',
  ensureSession: async () => 'token',
  supabase: { from: () => ({ insert }) },
}));
vi.mock('../../debug/debugState', () => ({ isDebug: () => debug }));

const { SupabaseScoreService } = await import('./SupabaseScoreService');

describe('Antworten speichern', () => {
  const svc = new SupabaseScoreService({ judge: async () => ({ status: 'error' }) });
  const result = { questionId: 'de-food-001', input: 'Apfel', matched: 'Apfel', fuzzy: false, frequency: 50, tier: 'stone' as const, points: 30, timedOut: false };

  it('normale Runde: is_debug = false', async () => {
    await svc.submit({ dateKey: '2026-11-14', lang: 'de', mode: 'rare', questionId: 'de-food-001', result });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ is_debug: false, is_practice: false }));
  });

  it('Admin-Debug: Runde wird als is_debug markiert (zählt serverseitig nirgends)', async () => {
    debug = true;
    await svc.submit({ dateKey: '2026-11-20', lang: 'de', mode: 'rare', questionId: 'de-food-001', result });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ is_debug: true, day: '2026-11-20' }));
  });
});
