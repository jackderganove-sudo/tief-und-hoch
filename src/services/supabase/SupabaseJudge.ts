import type { AiVerdict } from '../../domain/scoring';
import type { Question } from '../../domain/types';
import type { AnswerJudge } from '../AnswerJudge';
import { SUPABASE_ANON_KEY, SUPABASE_URL, ensureSession } from './client';

/** Höchstens so lange wartet das Spiel auf die KI-Prüfung. */
export const JUDGE_TIMEOUT_MS = 6000;

interface JudgeResponse {
  status: AiVerdict['status'];
  list_answer: string | null;
  canonical_text: string | null;
  estimated_base_score: number | null;
  approved?: boolean;
}

/** Ruft die Edge Function "judge-answer" auf. Fehler und Zeitüberschreitung → status "error". */
export class SupabaseJudge implements AnswerJudge {
  async judge(question: Question, input: string): Promise<AiVerdict> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
    try {
      const token = await ensureSession();
      if (!token) return { status: 'error' };
      const res = await fetch(`${SUPABASE_URL}/functions/v1/judge-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ question_id: question.id, answer: input }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { status: 'error' };
      const r = (await res.json()) as JudgeResponse;
      if (!['valid', 'invalid', 'error', 'limited'].includes(r.status)) return { status: 'error' };
      return { status: r.status, approved: r.approved === true, listAnswer: r.list_answer, canonicalText: r.canonical_text, estimatedBaseScore: r.estimated_base_score };
    } catch {
      return { status: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
