import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase-Anbindung (optional). Das Frontend kennt nur URL und anon/publishable
 * Key – beide sind öffentlich. Ohne diese Variablen läuft das Spiel rein lokal
 * (keine KI-Prüfung, nichts wird gespeichert).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tuh:v1:auth' } }) : null;

export const SUPABASE_URL = url ?? '';
export const SUPABASE_ANON_KEY = anonKey ?? '';

let pending: Promise<string | null> | null = null;

/**
 * Zugriffstoken des Spielers. Beim ersten Mal wird anonym angemeldet –
 * jeder Spieler bekommt so eine feste ID, ganz ohne Registrierung.
 */
export function ensureSession(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session.access_token;
    const { data: signIn, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('Anonyme Anmeldung fehlgeschlagen:', error.message);
      return null;
    }
    return signIn.session?.access_token ?? null;
  })().finally(() => {
    // Nächster Aufruf fragt erneut (Token kann sich erneuert haben).
    pending = null;
  });
  return pending;
}
