import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Browser-Umgebung minimal nachbilden (Tests laufen in Node)
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  location: { href: 'https://playhighsandlows.github.io/' },
  history: { state: null, replaceState: vi.fn() },
});

const { signInWith, handleAuthCallback, toAccount } = await import('./account');

function fakeDb(user: { id: string; is_anonymous: boolean } | null) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: user ? { user } : null } })),
    linkIdentity: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
  };
  return { db: { auth } as unknown as SupabaseClient, auth };
}

describe('Login: anonymes Konto upgraden statt neu anlegen', () => {
  beforeEach(() => store.clear());

  it('anonym angemeldet → linkIdentity (gleiche user_id bleibt)', async () => {
    const { db, auth } = fakeDb({ id: 'anon-1', is_anonymous: true });
    await signInWith('github', db);
    expect(auth.linkIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }));
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('nach dem Rücksprung mit echtem Konto → „upgraded“', async () => {
    const { db: before } = fakeDb({ id: 'anon-1', is_anonymous: true });
    await signInWith('google', before);
    const { db: after } = fakeDb({ id: 'anon-1', is_anonymous: false });
    expect(await handleAuthCallback(after, 'https://playhighsandlows.github.io/')).toEqual({ kind: 'upgraded' });
  });

  it('Identität gehört schon zu einem Konto (zweites Gerät) → dort anmelden, danach „switched“ (zusammenführen)', async () => {
    const { db: before } = fakeDb({ id: 'anon-2', is_anonymous: true });
    await signInWith('github', before);
    const { db: mid, auth } = fakeDb({ id: 'anon-2', is_anonymous: true });
    const res = await handleAuthCallback(mid, 'https://playhighsandlows.github.io/?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked');
    expect(res).toEqual({ kind: 'redirecting' });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }));
    const { db: after } = fakeDb({ id: 'existing-account', is_anonymous: false });
    expect(await handleAuthCallback(after, 'https://playhighsandlows.github.io/')).toEqual({ kind: 'switched' });
  });

  it('ohne anonyme Sitzung → normale Anmeldung', async () => {
    const { db, auth } = fakeDb(null);
    await signInWith('google', db);
    expect(auth.signInWithOAuth).toHaveBeenCalled();
    expect(auth.linkIdentity).not.toHaveBeenCalled();
  });

  it('andere Fehler werden gemeldet, nichts hängt nach', async () => {
    const { db } = fakeDb({ id: 'anon-3', is_anonymous: true });
    await signInWith('google', db);
    expect(await handleAuthCallback(db, 'https://x/?error=access_denied&error_code=access_denied&error_description=User+cancelled')).toEqual({
      kind: 'error',
      message: 'User cancelled',
    });
    expect(await handleAuthCallback(db, 'https://x/')).toEqual({ kind: 'none' });
  });

  it('Konto-Darstellung: anonym ohne Anbieter', () => {
    expect(toAccount({ id: 'a', is_anonymous: true, app_metadata: { provider: 'anonymous' } } as never)).toMatchObject({ anonymous: true, provider: null });
    expect(toAccount({ id: 'b', is_anonymous: false, app_metadata: { provider: 'github' }, email: 'x@y.z' } as never)).toMatchObject({ provider: 'github', email: 'x@y.z' });
  });
});
