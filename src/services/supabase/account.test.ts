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

  it('Discord-E-Mail gehört schon zu einem Konto (email_exists) → ebenfalls dort anmelden statt Fehler', async () => {
    const { db: before } = fakeDb({ id: 'anon-4', is_anonymous: true });
    await signInWith('discord', before);
    const { db: mid, auth } = fakeDb({ id: 'anon-4', is_anonymous: true });
    const res = await handleAuthCallback(mid, 'https://x/?error=server_error&error_code=email_exists&error_description=A+user+with+this+email+address+has+already+been+registered');
    expect(res).toEqual({ kind: 'redirecting' });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'discord' }));
    const { db: after } = fakeDb({ id: 'existing-account', is_anonymous: false });
    expect(await handleAuthCallback(after, 'https://x/')).toEqual({ kind: 'switched' });
  });

  it('auch der Wechsel scheitert an der E-Mail (beim Anbieter unbestätigt) → verständlicher Hinweis statt Schleife', async () => {
    const { db: before } = fakeDb({ id: 'anon-5', is_anonymous: true });
    await signInWith('discord', before);
    const { db: mid } = fakeDb({ id: 'anon-5', is_anonymous: true });
    const err = 'https://x/?error=server_error&error_code=email_exists&error_description=A+user+with+this+email+address+has+already+been+registered';
    expect(await handleAuthCallback(mid, err)).toEqual({ kind: 'redirecting' });
    const { db: again, auth } = fakeDb({ id: 'anon-5', is_anonymous: true });
    expect(await handleAuthCallback(again, err)).toMatchObject({ kind: 'error', emailTaken: 'discord' });
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
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

describe('E-Mail-Login per 6-stelligem Code (gemockt)', async () => {
  const { sendEmailCode, verifyEmailCode, EmailLoginError, suggestedName } = await import('./account');
  function otpDb(user: { id: string; is_anonymous: boolean } | null, opts: { updateError?: object; otpError?: object; verifyError?: object } = {}) {
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: user ? { user } : null } })),
      updateUser: vi.fn(async () => ({ error: opts.updateError ?? null })),
      signInWithOtp: vi.fn(async () => ({ error: opts.otpError ?? null })),
      verifyOtp: vi.fn(async () => ({ error: opts.verifyError ?? null })),
    };
    return { db: { auth } as unknown as SupabaseClient, auth };
  }

  it('anonym → updateUser(E-Mail), Bestätigung als email_change (Upgrade, gleiche user_id)', async () => {
    const { db, auth } = otpDb({ id: 'anon', is_anonymous: true });
    expect(await sendEmailCode(' Spieler@Example.com ', db)).toBe('link');
    expect(auth.updateUser).toHaveBeenCalledWith({ email: 'spieler@example.com' });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(await verifyEmailCode('spieler@example.com', '123 456', 'link', db)).toBe('upgraded');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'spieler@example.com', token: '123456', type: 'email_change' });
  });

  it('E-Mail gehört schon zu einem Konto (z. B. über Google) → Code-Anmeldung dort, kein zweites Konto', async () => {
    const { db, auth } = otpDb({ id: 'anon', is_anonymous: true }, { updateError: { code: 'email_exists', message: 'A user with this email address has already been registered' } });
    expect(await sendEmailCode('jack@example.com', db)).toBe('switch');
    expect(auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'jack@example.com' }));
    expect(await verifyEmailCode('jack@example.com', '654321', 'switch', db)).toBe('switched');
    expect(auth.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ type: 'email' }));
  });

  it('ohne Sitzung → normale Code-Anmeldung', async () => {
    const { db, auth } = otpDb(null);
    expect(await sendEmailCode('neu@example.com', db)).toBe('switch');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('verständliche Fehler: Limit, falscher Code, ungültige Adresse', async () => {
    const limited = otpDb(null, { otpError: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } });
    await expect(sendEmailCode('a@b.de', limited.db)).rejects.toMatchObject({ kind: 'rate_limit' });
    const wrong = otpDb(null, { verifyError: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' } });
    await expect(verifyEmailCode('a@b.de', '111111', 'switch', wrong.db)).rejects.toMatchObject({ kind: 'invalid_code' });
    await expect(verifyEmailCode('a@b.de', '12', 'switch', wrong.db)).rejects.toBeInstanceOf(EmailLoginError);
    await expect(sendEmailCode('kein-at-zeichen', otpDb(null).db)).rejects.toMatchObject({ kind: 'invalid_email' });
  });

  it('Spielername-Vorschlag aus Discord/Google, passend zu den Namensregeln', () => {
    expect(suggestedName({ user_metadata: { custom_claims: { global_name: 'Höhlen Jack 🎈' }, full_name: 'jack#1234' }, email: undefined } as never)).toBe('Höhlen Jack');
    expect(suggestedName({ user_metadata: { full_name: 'Jo' }, email: 'johanna.m@example.com' } as never)).toBe('johanna.m');
    expect(suggestedName({ user_metadata: {}, email: undefined } as never)).toBe('');
  });
});
