/**
 * Edge Function "delete-account": löscht das Konto des angemeldeten Spielers endgültig.
 * Per ON DELETE CASCADE verschwinden damit alle seine Daten (Antworten, Fortschritt,
 * Profil, KI-Log, Admin-Eintrag); Verweise in Prüf-Daten werden NULL.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const firstKey = (name: string) => {
  try {
    const k = JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>;
    return k.default ?? Object.values(k)[0] ?? '';
  } catch {
    return '';
  }
};
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? firstKey('SUPABASE_PUBLISHABLE_KEYS');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? firstKey('SUPABASE_SECRET_KEYS');
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ALLOWED = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? 'https://playhighsandlows.github.io').split(','));
const DEV = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/;
function cors(origin: string | null): Record<string, string> {
  const base = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  return origin && (ALLOWED.has(origin) || DEV.test(origin)) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response('{"error":"method"}', { status: 405, headers });
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data, error } = jwt ? await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.getUser(jwt) : { data: { user: null }, error: true };
  const user = data?.user;
  if (error || !user) return new Response('{"error":"unauthorized"}', { status: 401, headers });
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) return new Response('{"error":"confirm required"}', { status: 400, headers });
  const { error: delError } = await admin.auth.admin.deleteUser(user.id);
  if (delError) {
    console.error('delete failed', delError.message);
    return new Response('{"error":"delete failed"}', { status: 500, headers });
  }
  return new Response('{"deleted":true}', { headers });
});
