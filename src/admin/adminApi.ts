import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Eigener Supabase-Client für den Admin-Bereich: eigene Sitzung (GitHub-Login),
 * getrennt von der anonymen Spieler-Sitzung. Nur URL + anon key – alle Rechte
 * kommen aus RLS (Tabelle admins), nie aus einem geheimen Schlüssel.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const adminDb: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'tuh:v1:admin-auth' },
      })
    : null;

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AdminVerdict {
  id: string;
  question_id: string;
  lang: string;
  topic: string;
  normalized_answer: string;
  canonical_text: string | null;
  list_answer: string | null;
  estimated_base_score: number | null;
  reason: string | null;
  model: string;
  valid: boolean;
  ai_valid: boolean;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  created_at: string;
  plays: number;
  raw_answer: string | null;
  approved_id: string | null;
  approved_text: string | null;
  approved_aliases: string[] | null;
  approved_base_score: number | null;
  approved_merged_into: string | null;
}

export interface VerdictFilter {
  status: ReviewStatus | 'all';
  ai: 'all' | 'valid' | 'invalid';
  lang: 'all' | 'de' | 'en';
  topic: string | 'all';
}

export async function loadVerdicts(db: SupabaseClient, f: VerdictFilter): Promise<AdminVerdict[]> {
  let q = db.from('admin_verdicts').select('*').order('question_id').order('created_at', { ascending: false }).limit(500);
  if (f.status !== 'all') q = q.eq('review_status', f.status);
  if (f.ai !== 'all') q = q.eq('ai_valid', f.ai === 'valid');
  if (f.lang !== 'all') q = q.eq('lang', f.lang);
  if (f.topic !== 'all') q = q.eq('topic', f.topic);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as AdminVerdict[];
}

export async function approve(
  db: SupabaseClient,
  v: AdminVerdict,
  opts: { text: string; aliases: string[]; baseScore: number; mergedInto?: string | null },
) {
  const { error } = await db.rpc('approve_verdict', {
    p_verdict: v.id,
    p_text: opts.text,
    p_aliases: opts.aliases,
    p_base_score: opts.baseScore,
    p_merged_into: opts.mergedInto ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function reject(db: SupabaseClient, ids: string[]) {
  const { error } = await db.rpc('reject_verdicts', { p_ids: ids });
  if (error) throw new Error(error.message);
}

export async function reset(db: SupabaseClient, ids: string[]) {
  const { error } = await db.rpc('reset_verdicts', { p_ids: ids });
  if (error) throw new Error(error.message);
}

/** Vorschlag fürs Freigeben: Schreibweise, Aliase, Score. */
export function defaults(v: AdminVerdict) {
  const text = (v.approved_text ?? v.canonical_text ?? v.raw_answer ?? v.normalized_answer).trim();
  const raw = v.raw_answer?.trim();
  const aliases = v.approved_aliases ?? (raw && raw.toLowerCase() !== text.toLowerCase() ? [raw] : []);
  const baseScore = v.approved_base_score ?? v.estimated_base_score ?? 1;
  return { text, aliases, baseScore };
}
