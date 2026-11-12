/**
 * Zentraler Konto-Zustand für die Oberfläche: wer ist angemeldet, Profil, Admin,
 * und was beim Login zusammengeführt wurde. Startet Sync und Rücksprung-Auswertung.
 */
import { useEffect, useState } from 'react';
import i18n from 'i18next';
import type { MergeSummary } from '../domain/progressSync';
import { supabase } from './supabase/client';
import { handleAuthCallback, isAdmin, loadProfile, suggestedName, toAccount, type Account, type Profile, type Provider } from './supabase/account';
import { ProgressSync } from './supabase/ProgressSync';
import type { ProgressRepository } from './ProgressRepository';

export interface AccountState {
  ready: boolean;
  account: Account | null;
  profile: Profile | null;
  admin: boolean;
  /** Nach dem Login auf einem weiteren Gerät: was übernommen wurde (einmal anzeigen) */
  merged: MergeSummary | null;
  error: string | null;
  /** Anmeldung scheiterte, weil die (unbestätigte) Anbieter-E-Mail schon ein Konto hat */
  errorEmailTaken: Provider | null;
  /** Vorschlag für den Spielernamen aus dem Anbieter-Profil (z. B. Discord-Name) */
  suggestedName: string;
}

let state: AccountState = { ready: false, account: null, profile: null, admin: false, merged: null, error: null, errorEmailTaken: null, suggestedName: '' };
/** Nächste Anmeldung kommt aus dem E-Mail-Code-Login → Zusammenführung anzeigen */
let expectingLogin = false;
export function expectLogin() {
  expectingLogin = true;
}
const listeners = new Set<() => void>();
const set = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function getAccountState() {
  return state;
}

export function useAccount(): AccountState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

export function dismissMerged() {
  set({ merged: null });
}

export async function refreshProfile() {
  const a = state.account;
  if (!a || a.anonymous) return set({ profile: null, admin: false });
  const [profile, admin] = await Promise.all([loadProfile(a.id), isAdmin(a.id)]);
  set({ profile, admin });
}

let started = false;

/** Einmal beim App-Start aufrufen. */
export function startAccount(repo: ProgressRepository) {
  if (started || !supabase) return set({ ready: true });
  started = true;
  const db = supabase;
  const sync = new ProgressSync(db, repo, (snap) => {
    if (snap.settings.lang && snap.settings.lang !== i18n.language) void i18n.changeLanguage(snap.settings.lang);
  });

  let lastUser: string | null = null;
  const onSession = async (user: Parameters<typeof toAccount>[0], afterCallbackIn: boolean) => {
    let afterCallback = afterCallbackIn;
    const account = toAccount(user);
    set({ account, suggestedName: suggestedName(user) });
    if (expectingLogin && account && !account.anonymous) {
      expectingLogin = false;
      afterCallback = true;
    }
    if (account?.id !== lastUser) {
      lastUser = account?.id ?? null;
      const summary = await sync.attach(account?.id ?? null);
      // Zusammenfassung nur zeigen, wenn wirklich ein anderes Gerät dazukam
      if (afterCallback && summary && (summary.addedRounds > 0 || summary.duplicateDays > 0)) set({ merged: summary });
    }
    await refreshProfile();
    set({ ready: true });
  };

  void (async () => {
    // erst den Rücksprung vom Anbieter auswerten (Upgrade / Wechsel / Fehler)
    const cb = await handleAuthCallback(db);
    if (cb.kind === 'redirecting') return;
    if (cb.kind === 'error') set({ error: cb.message, errorEmailTaken: cb.emailTaken ?? null });
    const { data } = await db.auth.getSession();
    await onSession(data.session?.user, cb.kind === 'switched' || cb.kind === 'upgraded');
  })();

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void onSession(session?.user, false);
  });
}
