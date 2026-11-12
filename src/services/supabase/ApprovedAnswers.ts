import type { ApprovedAnswer } from '../../domain/approved';
import { supabase } from './client';

const KEY = 'hal:v1:approved';
/** Länger wartet die App beim Laden der Fragen nicht – danach gilt der gespeicherte Stand. */
const WAIT_MS = 1500;

interface Stored {
  revision: number;
  rows: ApprovedAnswer[];
}

function readStored(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
  } catch {
    return null;
  }
}

/**
 * Freigegebene Antworten (Tabelle approved_answers): beim Start einmal laden,
 * in localStorage merken, offline den gemerkten Stand nutzen. Hat sich die
 * Prüf-Revision geändert, wird `onRevisionChange` aufgerufen (lokalen KI-Cache leeren).
 */
export class ApprovedAnswers {
  private fresh: Promise<ApprovedAnswer[] | null> | null = null;
  private stored = readStored();

  constructor(private readonly onRevisionChange: () => void) {}

  /** Startet das Laden (einmal pro App-Start). */
  start(): void {
    if (this.fresh || !supabase) return;
    const db = supabase;
    this.fresh = (async () => {
      const [rows, meta] = await Promise.all([
        db.from('approved_answers').select('question_id, text, aliases, base_score, merged_into'),
        db.from('app_meta').select('value').eq('key', 'review_revision').maybeSingle(),
      ]);
      if (rows.error || meta.error) throw new Error(rows.error?.message ?? meta.error?.message);
      const next: Stored = { revision: Number(meta.data?.value ?? 0), rows: rows.data as ApprovedAnswer[] };
      if (this.stored && this.stored.revision !== next.revision) this.onRevisionChange();
      this.stored = next;
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* egal */
      }
      return next.rows;
    })().catch((e) => {
      console.warn('Freigegebene Antworten nicht geladen (offline?):', e);
      return null;
    });
  }

  /** Aktueller Stand: frisch geladen, sonst nach kurzer Wartezeit der gespeicherte. */
  async get(): Promise<ApprovedAnswer[]> {
    this.start();
    if (this.fresh) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS));
      const rows = await Promise.race([this.fresh, timeout]);
      if (rows) return rows;
    }
    return this.stored?.rows ?? [];
  }
}
