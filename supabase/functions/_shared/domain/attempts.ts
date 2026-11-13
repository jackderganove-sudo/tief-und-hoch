// Automatisch kopiert aus src/domain/attempts.ts (npm run function-data) – nicht von Hand ändern.
/**
 * Mehrere Versuche pro Frage: Falsche Antworten beenden die Frage nicht. Man gibt so oft neu
 * ein, bis eine Antwort gilt oder die Zeit abläuft. Reine Logik ohne Netz – läuft im Client
 * und (Kopie über npm run function-data) in der Edge Function "room".
 *
 * Reihenfolge der Prüfung: Liste/Aliase/Freigaben → Geräte-Cache → offensichtlicher Unsinn
 * (gar nicht erst fragen) → Server (Cache; KI nur, solange das Kontingent der Frage reicht).
 */
import { allowedTypos, levenshtein } from './levenshtein.ts';
import { compact, normalize } from './normalize.ts';
import type { Question } from './types.ts';

/** KI-Prüfungen pro Frage und Spieler. Danach gilt nur noch die Liste (und der Cache). */
export const MAX_AI_CHECKS = 3;
/** So lange hält eine laufende KI-Prüfung den Timer höchstens an. */
export const AI_PAUSE_MAX_MS = 6000;
/** So viele ungültige Versuche werden je Frage gemerkt (Anzeige, Speichern). */
export const MAX_REJECTED_KEPT = 20;
/** Freunde-Modus: Versuche pro Frage und Spieler (Schutz vor Dauerfeuer; für Menschen „beliebig oft“). */
export const ROOM_MAX_ATTEMPTS = 30;

/** Was von einer laufenden Frage gespeichert wird (Reload setzt weder Versuche noch KI-Kontingent zurück). */
export interface RoundProgress {
  /** Abgelehnte Eingaben in Reihenfolge. */
  tried: string[];
  /** Alle gewerteten Versuche (ohne doppelte und leere). */
  count: number;
  aiChecks: number;
  /** Nur noch die Liste zählt: Kontingent der Frage bzw. Tageslimit verbraucht. */
  listOnly: null | 'question' | 'day';
}

/** Schlüssel für „schon versucht“: gleiche Schreibweise nach Normalisierung, ohne Leerzeichen. */
export const attemptKey = (input: string) => compact(input);

/** Wurde diese Eingabe (in irgendeiner Schreibweise) schon abgelehnt? */
export function isDuplicate(tried: readonly string[], input: string): boolean {
  const key = attemptKey(input);
  return !!key && tried.some((t) => attemptKey(t) === key);
}

/**
 * Offensichtlicher Unsinn, der nie an die KI geht: zu kurz, nur Zahlen/Sonderzeichen,
 * Wiederholungen („aaaa“, „hahaha“). Fragen, deren Liste selbst Zahlen kennt, lassen Zahlen zu.
 */
export function isNonsense(question: Pick<Question, 'answers'>, input: string): boolean {
  const key = compact(input);
  if (key.length < 2) return true;
  if (!/[a-z]/.test(key)) {
    const numeric = question.answers.some((a) => [a.text, ...a.aliases].some((s) => /^\d/.test(compact(s))));
    return !numeric;
  }
  // ein Zeichen oder ein Zeichenpaar, mindestens dreimal hintereinander und sonst nichts
  if (/^(.)\1{2,}$/.test(key) || /^(..)\1{2,}$/.test(key)) return true;
  return false;
}

/**
 * „Meintest du …?“ – Listen-Antwort, die knapp außerhalb der Tippfehler-Toleranz liegt
 * (ein Fehler mehr als erlaubt). Nur ein Hinweis; gewertet wird sie nicht.
 */
export function nearMiss(question: Pick<Question, 'answers'>, input: string): string | null {
  const key = compact(input);
  if (key.length < 4) return null;
  let best: { text: string; d: number; score: number } | null = null;
  for (const a of question.answers) {
    for (const s of [a.text, ...a.aliases]) {
      const k = compact(s);
      const max = allowedTypos(Math.min(key.length, k.length)) + 1;
      const d = levenshtein(key, k, max);
      if (d === 0 || d > max) continue;
      if (!best || d < best.d || (d === best.d && a.baseScore > best.score)) best = { text: a.text, d, score: a.baseScore };
    }
  }
  return best?.text ?? null;
}

/** Wie die Deadline nach einer KI-Prüfung weiterrückt: um die Wartezeit, höchstens AI_PAUSE_MAX_MS. */
export function resumeDeadline(deadline: number, pausedAt: number, now: number): number {
  return deadline + Math.max(0, Math.min(AI_PAUSE_MAX_MS, now - pausedAt));
}

/** Ungültigen Versuch merken (für Anzeige/Speichern gekürzt, ohne doppelte Schreibweisen). */
export function rememberRejected(tried: readonly string[], input: string): string[] {
  const text = input.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!text || isDuplicate(tried, text)) return [...tried];
  return [...tried, text].slice(-MAX_REJECTED_KEPT);
}

/**
 * Freunde-Modus, Auflösung: ein paar „lustige“ Fehlversuche aus allen heraussuchen – echte
 * Wörter vor Tippsalat (von der KI abgelehnt zuerst), längere zuerst, höchstens zwei pro
 * Spieler, keine doppelten Schreibweisen.
 */
export function pickFunnyAttempts<T extends { user_id: string; raw: string; ai: boolean }>(attempts: readonly T[], max = 8): T[] {
  const seen = new Set<string>();
  const perPlayer = new Map<string, number>();
  const out: T[] = [];
  const sorted = [...attempts].sort((a, b) => Number(b.ai) - Number(a.ai) || b.raw.length - a.raw.length || a.raw.localeCompare(b.raw));
  for (const a of sorted) {
    const key = normalize(a.raw);
    if (key.length < 3 || seen.has(key)) continue;
    if ((perPlayer.get(a.user_id) ?? 0) >= 2) continue;
    seen.add(key);
    perPlayer.set(a.user_id, (perPlayer.get(a.user_id) ?? 0) + 1);
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}
