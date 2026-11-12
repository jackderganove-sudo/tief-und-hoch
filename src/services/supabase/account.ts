/**
 * Optionales Konto (Google/GitHub). Spielen geht weiter anonym; ein Login
 * „upgradet“ das anonyme Konto per linkIdentity (gleiche user_id → alle Antworten,
 * Serie und Statistik bleiben). Gehört die Google-/GitHub-Identität schon zu einem
 * Konto (zweites Gerät), wird stattdessen dort angemeldet und der Gerätestand
 * zusammengeführt.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabase } from './client';

export type Provider = 'google' | 'github';

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
