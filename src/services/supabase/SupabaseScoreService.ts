import type { AnswerSubmission } from '../ScoreService';
import { LocalScoreService } from '../ScoreService';
import { normalize } from '../../domain/normalize';
import { SUPABASE_URL, ensureSession, supabase } from './client';

/**
 * Wie LocalScoreService, speichert aber jede Tagesantwort in `submissions`
 * (Basis für echte Häufigkeiten). Fehler beim Speichern stören das Spiel nicht.
 */
export class SupabaseScoreService extends LocalScoreService {
  private warmed = false;

  prepare(): void {
    if (this.warmed || !supabase) return;
    this.warmed = true;
    void ensureSession();
    // Preflight weckt die Edge Function auf (Kaltstart), ohne etwas zu prüfen.
    void fetch(`${SUPABASE_URL}/functions/v1/judge-answer`, { method: 'OPTIONS' }).catch(() => {});
  }

  async submit({ dateKey, lang, mode, questionId, result, practice = false }: AnswerSubmission): Promise<void> {
    if (!supabase) return;
    try {
      if (!(await ensureSession())) return;
      const { error } = await supabase.from('submissions').insert({
        question_id: questionId,
        lang,
        mode,
        day: dateKey,
        raw_answer: result.input.slice(0, 100),
        normalized_answer: normalize(result.input).slice(0, 100),
        matched_answer: result.matched?.slice(0, 100) ?? null,
        source: result.source ?? 'list',
        score: result.points,
        is_practice: practice,
      });
      // 23505 = Tagesantwort schon gespeichert (z. B. nach Reload) – kein Problem
      if (error && error.code !== '23505') console.warn('Antwort nicht gespeichert:', error.message);
    } catch (e) {
      console.warn('Antwort nicht gespeichert:', e);
    }
  }
}
