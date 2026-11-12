import { describe, expect, it } from 'vitest';
import { migrateStorage } from './migrateStorage';

function memory(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('Umzug der localStorage-Schlüssel (tuh: → hal:)', () => {
  it('übernimmt Spielstand, Sprache, KI-Cache und Anmeldung, löscht alte Schlüssel', () => {
    const s = memory({
      'tuh:v1:day:rare:2026-11-12': '{"results":[]}',
      'tuh:v1:lang': 'en',
      'tuh:v1:ai-verdicts': '{"build":"x"}',
      'tuh:v1:auth': '{"access_token":"t"}',
      'tuh:v1:admin-auth-code-verifier': 'v',
      fremd: '1',
    });
    expect(migrateStorage(s)).toBe(5);
    expect(s.getItem('hal:v1:day:rare:2026-11-12')).toBe('{"results":[]}');
    expect(s.getItem('hal:v1:lang')).toBe('en');
    expect(s.getItem('hal:v1:auth')).toBe('{"access_token":"t"}');
    expect(s.getItem('hal:v1:admin-auth-code-verifier')).toBe('v');
    expect(s.getItem('tuh:v1:lang')).toBeNull();
    expect(s.getItem('fremd')).toBe('1');
  });

  it('überschreibt nie neuere Werte und ist beim zweiten Mal ein No-op', () => {
    const s = memory({ 'tuh:v1:lang': 'en', 'hal:v1:lang': 'de' });
    migrateStorage(s);
    expect(s.getItem('hal:v1:lang')).toBe('de');
    expect(migrateStorage(s)).toBe(0);
  });
});
