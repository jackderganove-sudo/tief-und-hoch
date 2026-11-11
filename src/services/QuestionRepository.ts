import { selectDailySets } from '../domain/daily';
import { TOPICS, topicSelected } from '../domain/types';
import type { Lang, Mode, Question, TopicId, TopicSelection } from '../domain/types';

export interface QuestionFilter {
  lang: Lang;
  mode: Mode;
  topics: TopicSelection;
  /** Fragen, die nicht vorkommen sollen (z. B. die heutigen Tagesfragen). */
  excludeIds?: readonly string[];
}

/**
 * Zugriff auf Fragen. Phase 1 liest lokale JSON-Dateien (eine pro Thema und
 * Sprache), Phase 2 kann z. B. eine Supabase-Tabelle abfragen.
 */
export interface QuestionRepository {
  /** Die Fragen des Tages – für alle Spieler gleich, aus allen Themen gemischt. */
  getDailyQuestions(dateKey: string, lang: Lang, mode: Mode): Promise<Question[]>;
  /** Einzelne Fragen per ID (z. B. um einen gespeicherten Spielstand fortzusetzen). */
  getQuestionsByIds(ids: string[], lang: Lang): Promise<Question[]>;
  /** Alle Fragen zu Modus + Themenauswahl (Übungsmodus, später Freunde-Modus). */
  getQuestions(filter: QuestionFilter): Promise<Question[]>;
  /** Anzahl Fragen pro Thema für einen Modus (für die Themenauswahl). */
  getTopicCounts(lang: Lang, mode: Mode): Promise<Record<TopicId, number>>;
}

type Loader = () => Promise<{ default: Question[] }>;

// Vite teilt jede Datei in einen eigenen Chunk – geladen wird nur die gespielte Sprache.
const loaders = import.meta.glob<{ default: Question[] }>('../data/questions/*/*.json');

export class LocalQuestionRepository implements QuestionRepository {
  private cache = new Map<Lang, Promise<Question[]>>();

  private pool(lang: Lang): Promise<Question[]> {
    let p = this.cache.get(lang);
    if (!p) {
      p = Promise.all(
        TOPICS.map((topic) => {
          const load = loaders[`../data/questions/${lang}/${topic}.json`] as Loader | undefined;
          return load ? load().then((m) => m.default) : Promise.resolve<Question[]>([]);
        }),
      ).then((lists) => lists.flat());
      this.cache.set(lang, p);
    }
    return p;
  }

  async getDailyQuestions(dateKey: string, lang: Lang, mode: Mode): Promise<Question[]> {
    return selectDailySets(await this.pool(lang), dateKey, lang)[mode];
  }

  async getQuestionsByIds(ids: string[], lang: Lang): Promise<Question[]> {
    const byId = new Map((await this.pool(lang)).map((q) => [q.id, q]));
    return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
  }

  async getQuestions({ lang, mode, topics, excludeIds = [] }: QuestionFilter): Promise<Question[]> {
    const exclude = new Set(excludeIds);
    return (await this.pool(lang)).filter(
      (q) => q.modes.includes(mode) && topicSelected(topics, q.topic) && !exclude.has(q.id),
    );
  }

  async getTopicCounts(lang: Lang, mode: Mode): Promise<Record<TopicId, number>> {
    const counts = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<TopicId, number>;
    for (const q of await this.pool(lang)) if (q.modes.includes(mode)) counts[q.topic]++;
    return counts;
  }
}
