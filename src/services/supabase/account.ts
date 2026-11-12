/**
 * Optionales Konto (Google/GitHub). Spielen geht weiter anonym; ein Login
 * „upgradet“ das anonyme Konto per linkIdentity (gleiche user_id → alle Antworten,
 * Serie und Statistik bleiben). Gehört die Google-/GitHub-Identität schon zu einem
 * Konto (zweites Gerät), wird stattdessen dort angemeldet und der Gerätestand
 * zusammengeführt.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabase } from './client';

export type Provider = 'google' | 'github' | 'discord';

export interface Account {
  id: string;
  anonymous: boolean;
  provider: string | null;
  email: string | null;
}

const INTENT_KEY = 'hal:v1:auth-intent';

interface Intent {
  provider: Provider;
  /** 'link' = anonymes Konto upgraden, 'switch' = in bestehendes Konto wechseln (Gerät zusammenführen) */
  step: 'link' | 'switch';
  at: number;
}

export function toAccount(u: User | null | undefined): Account | null {
  if (!u) return null;
  const provider = (u.app_metadata?.provider as string | undefined) ?? null;
  return { id: u.id, anonymous: !!u.is_anonymous, provider: u.is_anonymous ? null : provider, email: u.email ?? null };
}

function readIntent(): Intent | null {
  try {
    const i = JSON.parse(localStorage.getItem(INTENT_KEY) ?? 'null') as Intent | null;
    return i && Date.now() - i.at < 15 * 60_000 ? i : null;
  } catch {
    return null;
  }
}

function writeIntent(i: Intent | null) {
  try {
    if (i) localStorage.setItem(INTENT_KEY, JSON.stringify(i));
    else localStorage.removeItem(INTENT_KEY);
  } catch {
    /* egal */
  }
}

/** Rücksprung-Adresse: dieselbe Seite ohne alte OAuth-Parameter. */
function returnUrl(): string {
  const u = new URL(location.href);
  for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

/**
 * Anmelden mit Google/GitHub. Anonym angemeldet → Konto upgraden (linkIdentity),
 * sonst normale Anmeldung. Leitet zum Anbieter weiter.
 */
export async function signInWith(provider: Provider, db: SupabaseClient | null = supabase): Promise<void> {
  if (!db) throw new Error('Supabase ist nicht konfiguriert');
  const { data } = await db.auth.getSession();
  const user = data.session?.user;
  if (user?.is_anonymous) {
    writeIntent({ provider, step: 'link', at: Date.now() });
    const { error } = await db.auth.linkIdentity({ provider, options: { redirectTo: returnUrl() } });
    if (!error) return;
    // z. B. manuelles Verknüpfen deaktiviert → normale Anmeldung
    console.warn('linkIdentity:', error.message);
  }
  writeIntent({ provider, step: 'switch', at: Date.now() });
  const { error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl() } });
  if (error) throw new Error(error.message);
}

export type CallbackResult =
  | { kind: 'none' }
  /** anonymes Konto wurde upgegradet (gleiche ID) */
  | { kind: 'upgraded' }
  /** in ein bestehendes Konto gewechselt → Gerätestand zusammenführen */
  | { kind: 'switched' }
  /** Verknüpfen ging nicht, weil die Identität schon ein Konto hat → wir leiten zum Login weiter */
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string };

/**
 * Nach dem Rücksprung vom Anbieter auswerten (beim App-Start aufrufen, nachdem
 * supabase-js die Sitzung aus der URL übernommen hat).
 */
export async function handleAuthCallback(db: SupabaseClient | null = supabase, href = location.href): Promise<CallbackResult> {
  if (!db) return { kind: 'none' };
  const intent = readIntent();
  const url = new URL(href);
  const params = new URLSearchParams([...url.searchParams, ...new URLSearchParams(url.hash.replace(/^#/, ''))]);
  const errorCode = params.get('error_code');
  const clean = () => {
    if (url.searchParams.has('error') || url.searchParams.has('code') || url.hash) history.replaceState(history.state, '', returnUrl());
  };
  if (errorCode) {
    clean();
    if (errorCode === 'identity_already_exists' && intent?.step === 'link') {
      // Diese Google-/GitHub-Identität gehört schon zu einem Konto → dort anmelden, Gerät wird zusammengeführt
      writeIntent({ provider: intent.provider, step: 'switch', at: Date.now() });
      await db.auth.signInWithOAuth({ provider: intent.provider, options: { redirectTo: returnUrl() } });
      return { kind: 'redirecting' };
    }
    writeIntent(null);
    return { kind: 'error', message: params.get('error_description') ?? errorCode };
  }
  if (!intent) return { kind: 'none' };
  const { data } = await db.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) return { kind: 'none' }; // noch nicht zurück
  writeIntent(null);
  clean();
  return intent.step === 'link' ? { kind: 'upgraded' } : { kind: 'switched' };
}

export async function signOut(db: SupabaseClient | null = supabase) {
  await db?.auth.signOut();
}

/** Konto endgültig löschen (Edge Function delete-account; löscht alle Daten serverseitig). */
export async function deleteAccount(db: SupabaseClient | null = supabase): Promise<void> {
  if (!db) return;
  const { error } = await db.functions.invoke('delete-account', { body: { confirm: true } });
  if (error) throw new Error(error.message);
  await db.auth.signOut();
}

// ---------------------------------------------------------------- E-Mail mit Einmal-Code

/**
 * Anmeldung per E-Mail und 6-stelligem Code (kein Magic Link – Links öffnen sich im
 * Browser statt in der installierten App, kein Passwort).
 *
 * - anonym angemeldet → updateUser({ email }) → Code bestätigt die E-Mail → dasselbe Konto
 *   wird dauerhaft (Upgrade, gleiche user_id)
 * - E-Mail gehört schon zu einem Konto (z. B. über Google angelegt) → Code-Anmeldung in
 *   dieses Konto; Supabase verknüpft Identitäten mit gleicher bestätigter E-Mail selbst,
 *   der Gerätestand wird zusammengeführt
 * - ohne Sitzung → Code-Anmeldung (legt bei Bedarf ein Konto an)
 */
export type EmailStep = 'link' | 'switch';
export type EmailError = 'rate_limit' | 'invalid_email' | 'invalid_code' | 'other';

export class EmailLoginError extends Error {
  constructor(
    readonly kind: EmailError,
    message: string,
  ) {
    super(message);
  }
}

function emailError(e: { status?: number; code?: string; message?: string } | null): EmailLoginError {
  const code = e?.code ?? '';
  const msg = e?.message ?? 'unbekannter Fehler';
  if (e?.status === 429 || /rate_limit|over_email_send_rate_limit|too many/i.test(code + msg)) return new EmailLoginError('rate_limit', msg);
  if (/otp_expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(code + msg)) return new EmailLoginError('invalid_code', msg);
  if (/email_address_invalid|validation_failed|invalid.*email/i.test(code + msg)) return new EmailLoginError('invalid_email', msg);
  return new EmailLoginError('other', msg);
}

const isEmailTaken = (e: { code?: string; message?: string } | null) =>
  !!e && /email_exists|already been registered|already registered|user_already_exists/i.test(`${e.code ?? ''} ${e.message ?? ''}`);

/** Code an die E-Mail senden. Liefert, wie er nachher bestätigt werden muss. */
export async function sendEmailCode(email: string, db: SupabaseClient | null = supabase): Promise<EmailStep> {
  if (!db) throw new EmailLoginError('other', 'Supabase ist nicht konfiguriert');
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new EmailLoginError('invalid_email', 'ungültige E-Mail');
  const { data } = await db.auth.getSession();
  if (data.session?.user?.is_anonymous) {
    const { error } = await db.auth.updateUser({ email: address });
    if (!error) return 'link';
    if (!isEmailTaken(error)) throw emailError(error);
    // E-Mail gehört schon zu einem Konto → dort anmelden (Gerät wird zusammengeführt)
  }
  const { error } = await db.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
  if (error) throw emailError(error);
  return 'switch';
}

/** Code bestätigen. upgraded = anonymes Konto übernommen, switched = in bestehendes/neues Konto gewechselt. */
export async function verifyEmailCode(email: string, code: string, step: EmailStep, db: SupabaseClient | null = supabase): Promise<'upgraded' | 'switched'> {
  if (!db) throw new EmailLoginError('other', 'Supabase ist nicht konfiguriert');
  const token = code.replace(/\D/g, '');
  if (token.length !== 6) throw new EmailLoginError('invalid_code', 'Der Code hat 6 Ziffern');
  const { error } = await db.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: step === 'link' ? 'email_change' : 'email' });
  if (error) throw emailError(error);
  return step === 'link' ? 'upgraded' : 'switched';
}

/** Spielername-Vorschlag aus dem Anbieter-Profil (Discord/Google/GitHub), passend zu den Namensregeln. */
export function suggestedName(user: Pick<User, 'user_metadata' | 'email'> | null | undefined): string {
  const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [m.custom_claims && (m.custom_claims as Record<string, unknown>).global_name, m.full_name, m.name, m.user_name, m.preferred_username, user?.email?.split('@')[0]];
  // erster Kandidat, der nach dem Säubern die Namensregeln erfüllt (≥ 3 Zeichen)
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const clean = raw
      .replace(/[^A-Za-z0-9ÄÖÜäöüß ._-]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[ ._-]+|[ ._-]+$/g, '')
      .slice(0, 20)
      .replace(/[ ._-]+$/g, '');
    if (clean.length >= 3) return clean;
  }
  return '';
}

// ---------------------------------------------------------------- Profil

export interface Profile {
  display_name: string;
  avatar: number;
}

export async function loadProfile(userId: string, db: SupabaseClient | null = supabase): Promise<Profile | null> {
  if (!db) return null;
  const { data } = await db.from('profiles').select('display_name, avatar').eq('user_id', userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

export type SaveProfileError = 'taken' | 'invalid' | 'other';

export async function saveProfile(userId: string, p: Profile, db: SupabaseClient | null = supabase): Promise<SaveProfileError | null> {
  if (!db) return 'other';
  const { error } = await db
    .from('profiles')
    .upsert({ user_id: userId, display_name: p.display_name.trim(), avatar: p.avatar, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (!error) return null;
  if (error.code === '23505') return 'taken';
  if (error.code === '23514') return 'invalid';
  return 'other';
}

export async function isAdmin(userId: string, db: SupabaseClient | null = supabase): Promise<boolean> {
  if (!db) return false;
  const { data } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}
