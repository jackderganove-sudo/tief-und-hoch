import { LocalProgressRepository, type ProgressRepository } from './ProgressRepository';
import { ApprovedQuestionRepository, LocalQuestionRepository, type QuestionRepository } from './QuestionRepository';
import { LocalScoreService, type ScoreService } from './ScoreService';
import { CachedJudge } from './CachedJudge';
import { supabase } from './supabase/client';
import { SupabaseJudge } from './supabase/SupabaseJudge';
import { SupabaseScoreService } from './supabase/SupabaseScoreService';
import { ApprovedAnswers } from './supabase/ApprovedAnswers';
import { startAccount } from './accountState';

export interface Services {
  questions: QuestionRepository;
  scores: ScoreService;
  progress: ProgressRepository;
}

/**
 * Die eine Stelle, an der die Implementierungen gewählt werden.
 * Mit VITE_SUPABASE_URL/-ANON_KEY: KI-Prüfung + Speichern der Antworten,
 * sonst alles lokal.
 */
const approved = supabase ? new ApprovedAnswers(() => CachedJudge.clear()) : null;
approved?.start();

export const services: Services = {
  // Freigegebene Antworten (Admin-Bereich) zählen wie Listen-Antworten
  questions: approved ? new ApprovedQuestionRepository(new LocalQuestionRepository(), () => approved.get()) : new LocalQuestionRepository(),
  scores: supabase ? new SupabaseScoreService(new CachedJudge(new SupabaseJudge(), __BUILD_ID__)) : new LocalScoreService(),
  progress: new LocalProgressRepository(),
};

// Konto (optional), Rücksprung vom Login und Fortschritts-Sync starten
startAccount(services.progress);

export type { AnswerSubmission, ScoreService } from './ScoreService';
export type { AnswerJudge } from './AnswerJudge';
export type { DayRecord, ModeStats, ProgressRepository } from './ProgressRepository';
export type { QuestionRepository } from './QuestionRepository';
