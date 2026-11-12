import { beforeEach, describe, expect, it, vi } from 'vitest';

// Browser-Umgebung minimal nachbilden (Tests laufen in Node)
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  location: { search: '?debug=1' },
});

/** debugState frisch laden (Modul-Zustand wird beim Import gesetzt). */
async function fresh() {
  vi.resetModules();
  return import('./debugState');
}

describe('Debug im Live-Build nur für Admins', () => {
  beforeEach(() => store.clear());

  it('?debug=1 wirkt nur im Dev-Server', async () => {
    const { devDebugRequested } = await fresh();
    expect(devDebugRequested({ dev: false, search: '?debug=1', adminFlag: false })).toBe(false);
    expect(devDebugRequested({ dev: false, search: '?debug=1', adminFlag: true })).toBe(false);
    expect(devDebugRequested({ dev: true, search: '?debug=1', adminFlag: false })).toBe(true);
    expect(devDebugRequested({ dev: true, search: '', adminFlag: false })).toBe(false);
  });

  it('Live-Build (Tests laufen ohne DEV): ?debug=1 ohne Admin → kein Debug, kein Tagesversatz', async () => {
    vi.stubEnv('DEV', false);
    store.set('hal:v1:debug:dayOffset', '5');
    const d = await fresh();
    expect(d.isDebug()).toBe(false);
    expect(d.getDayOffset()).toBe(0);
    vi.unstubAllEnvs();
  });

  it('Admin-Markierung ohne bestätigten Admin → aus, Markierung wird gelöscht', async () => {
    vi.stubEnv('DEV', false);
    store.set('hal:v1:debug:admin', '1');
    store.set('hal:v1:debug:dayOffset', '3');
    const d = await fresh();
    await d.initAdminDebug(async () => false);
    expect(d.isDebug()).toBe(false);
    expect(d.getDayOffset()).toBe(0);
    expect(store.has('hal:v1:debug:admin')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('Server-Fehler bei der Admin-Prüfung → aus', async () => {
    vi.stubEnv('DEV', false);
    store.set('hal:v1:debug:admin', '1');
    const d = await fresh();
    await d.initAdminDebug(async () => {
      throw new Error('offline');
    });
    expect(d.isDebug()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('ohne Markierung fragt die App den Server gar nicht', async () => {
    vi.stubEnv('DEV', false);
    const d = await fresh();
    const check = vi.fn(async () => true);
    await d.initAdminDebug(check);
    expect(check).not.toHaveBeenCalled();
    expect(d.isDebug()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('bestätigter Admin mit Markierung → Debug an, Tagesversatz gilt; ausschalten setzt alles zurück', async () => {
    vi.stubEnv('DEV', false);
    store.set('hal:v1:debug:admin', '1');
    store.set('hal:v1:debug:dayOffset', '2');
    const d = await fresh();
    await d.initAdminDebug(async () => true);
    expect(d.isDebug()).toBe(true);
    expect(d.getDayOffset()).toBe(2);
    d.setAdminDebugFlag(false);
    expect(d.isDebug()).toBe(false);
    expect(d.getDayOffset()).toBe(0);
    expect(store.has('hal:v1:debug:dayOffset')).toBe(false);
    vi.unstubAllEnvs();
  });
});
