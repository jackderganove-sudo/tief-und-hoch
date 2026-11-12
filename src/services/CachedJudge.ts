import { normalize } from '../domain/normalize';
import type { AiVerdict } from '../domain/scoring';
import type { Question } from '../domain/types';
import type { AnswerJudge } from './AnswerJudge';

const KEY = 'hal:v1:ai-verdicts';
/** Älteste Einträge fliegen raus, damit localStorage klein bleibt. */
const MAX_ENTRIES = 400;

interface Store {
  /** Build-Kennung – bei neuer App-Version wird der Cache verworfen. */
  build: string;
  entries: Record<string, AiVerdict>;
}

/**
 * Merkt sich KI-Urteile auf dem Gerät (pro Frage + normalisierter Antwort):
 * Wiederholte Antworten werden sofort und ohne Netz gewertet. Fehler und
 * Limit-Antworten werden nicht gemerkt, damit sie später erneut geprüft werden.
 */
export class CachedJudge implements AnswerJudge {
  /** Lokalen Cache verwerfen (z. B. nachdem ich Urteile geprüft habe). */
  static clear(storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    try {
      storage?.removeItem(KEY);
    } catch {
      /* egal */
    }
  }

  constructor(
    private readonly inner: AnswerJudge,
    private readonly build: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {}

  private load(): Store {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? 'null') as Store | null;
      if (raw && raw.build === this.build && raw.entries) return raw;
      if (raw) this.storage?.removeItem(KEY); // neue App-Version → leeren
    } catch {
      /* kaputter Eintrag → neu anfangen */
    }
    return { build: this.build, entries: {} };
  }

  private save(store: Store) {
    const keys = Object.keys(store.entries);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete store.entries[k];
    try {
      this.storage?.setItem(KEY, JSON.stringify(store));
    } catch {
      /* Speicher voll/gesperrt – egal, dann eben ohne Cache */
    }
  }

  async judge(question: Question, input: string): Promise<AiVerdict> {
    const key = `${question.id}|${normalize(input)}`;
    const cached = this.load().entries[key];
    if (cached) return cached;
    const verdict = await this.inner.judge(question, input);
    if (verdict.status === 'valid' || verdict.status === 'invalid') {
      const store = this.load();
      delete store.entries[key]; // ans Ende (neuester Eintrag)
      store.entries[key] = verdict;
      this.save(store);
    }
    return verdict;
  }
}
