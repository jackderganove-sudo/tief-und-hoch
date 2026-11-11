import { LocalProgressRepository, type ProgressRepository } from './ProgressRepository';
import { LocalQuestionRepository, type QuestionRepository } from './QuestionRepository';
import { LocalScoreService, type ScoreService } from './ScoreService';

export interface Services {
  questions: QuestionRepository;
  scores: ScoreService;
  progress: ProgressRepository;
}

/**
 * Die eine Stelle, an der die Implementierungen gewählt werden.
 * Phase 2: hier z. B. `new SupabaseQuestionRepository(client)` einsetzen.
 */
export const services: Services = {
  questions: new LocalQuestionRepository(),
  scores: new LocalScoreService(),
  progress: new LocalProgressRepository(),
};

export type { AnswerSubmission, ScoreService } from './ScoreService';
export type { DayRecord, ModeStats, ProgressRepository } from './ProgressRepository';
export type { QuestionRepository } from './QuestionRepository';
