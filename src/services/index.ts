import { DebugAwareProgressRepository, LocalProgressRepository, type ProgressRepository } from './ProgressRepository';
import { adminDebugFlag, initAdminDebug, isDebug } from '../debug/debugState';
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

/** Echter Fortschritt und Debug-Sandbox (nur Admin-Debug / Dev-Server mit ?debug=1). */
export const progressStores = new DebugAwareProgressRepository(
  new LocalProgressRepository(),
  new LocalProgressRepository(undefined, 'hal:v1:debug'),
  isDebug,
);

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
  progress: progressStores,
};

// Konto (optional), Rücksprung vom Login und Fortschritts-Sync starten
// Sync nur mit dem echten Fortschritt – Debug-Runden bleiben in der Sandbox
startAccount(progressStores.real);

// Admin-Debug (Live-Build): nur wenn das Konto laut Server Admin ist
if (supabase && adminDebugFlag()) {
  const db = supabase;
  void initAdminDebug(async () => {
    const { data } = await db.auth.getSession();
    if (!data.session || data.session.user.is_anonymous) return false;
    const { data: ok, error } = await db.rpc('is_admin');
    return !error && ok === true;
  });
}

export type { AnswerSubmission, ScoreService } from './ScoreService';
export type { AnswerJudge } from './AnswerJudge';
export type { DayRecord, ModeStats, ProgressRepository } from './ProgressRepository';
export type { QuestionRepository } from './QuestionRepository';
