import { selectDailyQuestions } from '../domain/daily';
import type { Lang, Mode, Question } from '../domain/types';

/**
 * Zugriff auf Fragen. Phase 1 liest lokale JSON-Dateien,
 * Phase 2 kann z. B. eine Supabase-Tabelle "daily_questions" abfragen.
 */
export interface QuestionRepository {
  /** Die Fragen des Tages – für alle Spieler gleich. */
  getDailyQuestions(dateKey: string, lang: Lang, mode: Mode): Promise<Question[]>;
  /** Einzelne Fragen per ID (z. B. um einen gespeicherten Spielstand fortzusetzen). */
  getQuestionsByIds(ids: string[], lang: Lang, mode: Mode): Promise<Question[]>;
}

type Loader = () => Promise<{ default: Question[] }>;

// Vite teilt jede Datei in einen eigenen Chunk – geladen wird nur, was gespielt wird.
const loaders = import.meta.glob<{ default: Question[] }>('../data/questions/*/*.json');

export class LocalQuestionRepository implements QuestionRepository {
  private cache = new Map<string, Promise<Question[]>>();

  private pool(lang: Lang, mode: Mode): Promise<Question[]> {
    const key = `../data/questions/${lang}/${mode}.json`;
    let p = this.cache.get(key);
    if (!p) {
      const load = loaders[key] as Loader | undefined;
      p = load ? load().then((m) => m.default) : Promise.resolve([]);
      this.cache.set(key, p);
    }
    return p;
  }

  async getDailyQuestions(dateKey: string, lang: Lang, mode: Mode): Promise<Question[]> {
    return selectDailyQuestions(await this.pool(lang, mode), dateKey, lang, mode);
  }

  async getQuestionsByIds(ids: string[], lang: Lang, mode: Mode): Promise<Question[]> {
    const byId = new Map((await this.pool(lang, mode)).map((q) => [q.id, q]));
    return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
  }
}
