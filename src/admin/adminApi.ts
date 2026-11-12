import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../services/supabase/client';

/** Ein Login für alles: der Admin-Bereich nutzt denselben Supabase-Client wie das Spiel. */
export const adminDb: SupabaseClient | null = supabase;

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'unchecked';

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
  /** Warum (noch) nicht geprüft: KI-Fehler/Timeout oder Limit */
  unchecked_reason: 'error' | 'limited' | null;
  reviewed_at: string | null;
  created_at: string;
  plays: number;
  practice_plays: number;
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

/** Antwort erneut von der KI prüfen lassen (Admin: ohne Spieler-Limit, wartet bis 20 s). */
export async function recheck(db: SupabaseClient, v: AdminVerdict): Promise<string> {
  const { data, error } = await db.functions.invoke('judge-answer', {
    body: { question_id: v.question_id, answer: v.raw_answer ?? v.normalized_answer, recheck: true },
  });
  if (error) throw new Error(error.message);
  return (data as { status: string }).status;
}

export interface AiStatus {
  checks_today: number;
  errors_today: number;
  limited_today: number;
  cache_today: number;
  avg_ms_today: number | null;
  last_model: string | null;
  primary_quota_hit_at: string | null;
  unchecked_open: number;
  /** KI-Prüfungen heute pro Spieler (Top 5) */
  top_users: { short_id: string; is_admin: boolean; provider: string; checks: number; limited: number }[];
}

export async function loadAiStatus(db: SupabaseClient): Promise<AiStatus> {
  const { data, error } = await db.rpc('admin_ai_status');
  if (error) throw new Error(error.message);
  return data as AiStatus;
}

// ---------------------------------------------------------------- Dashboard (alle serverseitig gegen admins geprüft)

export interface Overview {
  active_today: number;
  active_week: number;
  signed_in_today: number;
  signed_in_week: number;
  new_today: number;
  new_week: number;
  new_signed_in_week: number;
  rounds_today: Partial<Record<'rare' | 'common', number>> | null;
  rounds_week: Partial<Record<'rare' | 'common', number>> | null;
  avg_points_today: Partial<Record<'rare' | 'common', number>> | null;
  avg_points_week: Partial<Record<'rare' | 'common', number>> | null;
  practice_today: number;
  debug_today: number;
  ai_today: { ok: number; cache: number; error: number; limited: number };
  last_model: string | null;
  primary_quota_hit_at: string | null;
  /** 429/503 des Hauptmodells in den letzten 10 Minuten (Breaker aktiv) */
  breaker_recent: number;
  open_pending: number;
  open_unchecked: number;
  banned: number;
}

async function rpc<T>(db: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadOverview = (db: SupabaseClient) => rpc<Overview>(db, 'admin_overview');

export interface PlayerRow {
  user_id: string;
  display_name: string | null;
  /** Login-Art (google, discord, github, email, anonym) – nie die E-Mail */
  provider: string;
  is_admin: boolean;
  banned: boolean;
  ban_reason: string | null;
  created_at: string;
  last_active: string | null;
  rounds: number;
  answers: number;
  ai_today: number;
}

export const loadPlayers = (db: SupabaseClient, search: string) => rpc<PlayerRow[]>(db, 'admin_players', { p_search: search || null, p_limit: 200 });
export const setBan = (db: SupabaseClient, userId: string, banned: boolean, reason?: string) =>
  rpc<null>(db, 'admin_set_ban', { p_user: userId, p_banned: banned, p_reason: reason ?? null });
export const resetName = (db: SupabaseClient, userId: string) => rpc<string | null>(db, 'admin_reset_name', { p_user: userId });

export interface AnswerStat {
  answer: string;
  source: 'list' | 'ai';
  plays: number;
  avg_score: number;
}
export const loadQuestionStats = (db: SupabaseClient, questionId: string) => rpc<AnswerStat[]>(db, 'admin_question_stats', { p_question: questionId });

export interface QuestionFlag {
  question_id: string;
  plays: number;
  misses: number;
  ai: number;
  miss_rate: number;
  ai_rate: number;
}
export const loadQuestionFlags = (db: SupabaseClient, minPlays = 5) => rpc<QuestionFlag[]>(db, 'admin_question_flags', { p_min_plays: minPlays });

export interface AdminLogRow {
  id: number;
  admin_id: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}
export async function loadAdminLog(db: SupabaseClient, limit = 50): Promise<AdminLogRow[]> {
  const { data, error } = await db.from('admin_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data as AdminLogRow[];
}

/** Server-Bestätigung „bin ich Admin?“ (für den Debug-Schalter). */
export async function confirmAdmin(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('is_admin');
  return !error && data === true;
}
