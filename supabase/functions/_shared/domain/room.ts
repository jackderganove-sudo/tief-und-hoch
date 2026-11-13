// Automatisch kopiert aus src/domain/room.ts (npm run function-data) – nicht von Hand ändern.
/**
 * Freunde-Modus: Raum-Einstellungen, Codes und Ablauf – reine Logik ohne Netz/DB.
 * Läuft im Client (Lobby/Anzeige) und in der Edge Function "room" (Kopie über
 * npm run function-data), damit beide dieselben Regeln haben.
 */
import { TOPICS, type Lang, type Mode, type TopicId } from './types.ts';

export const ROOM_MIN_PLAYERS = 2;
export const ROOM_MAX_PLAYERS = 30;
/** Ohne verwechselbare Zeichen (kein I, O, 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const QUESTION_COUNTS = { min: 5, max: 20 } as const;
export const QUESTION_SECONDS = [15, 25, 40] as const;
export const CUSTOM_PROMPT_MAX = 120;

/** Countdown vor der ersten Frage */
export const COUNTDOWN_MS = 3_000;
/** So lange bleibt die Auflösung stehen, wenn der Gastgeber nicht weiterklickt */
export const REVEAL_MS = 20_000;
/** Netz-Toleranz für Antworten kurz nach Ablauf (Serverzeit) */
export const ANSWER_GRACE_MS = 750;
/** So lange wartet die Auflösung höchstens auf laufende KI-Prüfungen */
export const PENDING_GRACE_MS = 12_000;
/** Raum-Erstellung pro Spieler und Stunde */
export const ROOMS_PER_HOUR = 10;
/** Gastgeber gilt als weg, wenn er so lange nichts vom Server geholt hat */
export const HOST_TIMEOUT_MS = 45_000;

export type RoomStatus = 'lobby' | 'countdown' | 'question' | 'scoring' | 'reveal' | 'finished';
export type RoomScoring = 'global' | 'group';
export type QuestionSource = 'random' | 'topics' | 'custom' | 'mixed';

export interface RoomSettings {
  mode: Mode;
  scoring: RoomScoring;
  source: QuestionSource;
  topics: TopicId[];
  count: number;
  seconds: (typeof QUESTION_SECONDS)[number];
  lang: Lang;
  /** Eigene Fragen des Gastgebers (nur bei source custom/mixed) */
  custom_prompts: string[];
  /** In der Auflösung ausklappbar: lustige Fehlversuche aller Spieler (Standard aus) */
  show_attempts: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'rare',
  scoring: 'global',
  source: 'random',
  topics: [],
  count: 7,
  seconds: 25,
  lang: 'de',
  custom_prompts: [],
  show_attempts: false,
};

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  return s;
}

/** Eingabe normalisieren (Kleinbuchstaben, Leerzeichen, verwechselte Zeichen O→… nicht raten). */
export function cleanRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(code: string): boolean {
  return new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code);
}

const cleanPrompt = (p: unknown) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_PROMPT_MAX) : '');

/** Einstellungen aus (untrusted) Eingaben – alles auf erlaubte Werte begrenzt. */
export function sanitizeSettings(input: unknown, base: RoomSettings = DEFAULT_SETTINGS): RoomSettings {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode: Mode = i.mode === 'common' || i.mode === 'rare' ? i.mode : base.mode;
  const source: QuestionSource = ['random', 'topics', 'custom', 'mixed'].includes(i.source as string) ? (i.source as QuestionSource) : base.source;
  const topicsIn = Array.isArray(i.topics) ? i.topics : base.topics;
  const topics = [...new Set(topicsIn.filter((t): t is TopicId => (TOPICS as readonly string[]).includes(t as string)))];
  const count = Number.isInteger(i.count) ? Math.min(QUESTION_COUNTS.max, Math.max(QUESTION_COUNTS.min, i.count as number)) : base.count;
  const seconds = (QUESTION_SECONDS as readonly number[]).includes(i.seconds as number) ? (i.seconds as RoomSettings['seconds']) : base.seconds;
  const lang: Lang = i.lang === 'en' || i.lang === 'de' ? i.lang : base.lang;
  const promptsIn = Array.isArray(i.custom_prompts) ? i.custom_prompts : base.custom_prompts;
  const custom_prompts = promptsIn.map(cleanPrompt).filter((p) => p.length >= 3).slice(0, QUESTION_COUNTS.max);
  // Eigene Fragen ohne Antwortliste → Wertung immer „Gruppe“
  const scoring: RoomScoring = source === 'custom' ? 'group' : i.scoring === 'group' || i.scoring === 'global' ? i.scoring : base.scoring;
  const show_attempts = typeof i.show_attempts === 'boolean' ? i.show_attempts : base.show_attempts === true;
  return { mode, scoring, source, topics: source === 'topics' || source === 'mixed' ? topics : [], count, seconds, lang, custom_prompts, show_attempts };
}

/** Kann mit diesen Einstellungen gestartet werden? Sonst Grund. */
export function settingsProblem(s: RoomSettings): string | null {
  if (s.source === 'custom' && s.custom_prompts.length === 0) return 'no_custom_prompts';
  return null;
}

/** Reihenfolge: bei „gemischt“ eigene Fragen gleichmäßig verteilt. null = eigene Frage (Index in custom_prompts). */
export type PlannedQuestion = { kind: 'catalog'; id: string } | { kind: 'custom'; prompt: string };

export function planQuestions(s: RoomSettings, catalogIds: readonly string[], rand: () => number = Math.random): PlannedQuestion[] {
  const shuffled = shuffle(catalogIds, rand);
  if (s.source === 'custom') return s.custom_prompts.slice(0, s.count).map((prompt) => ({ kind: 'custom', prompt }));
  if (s.source !== 'mixed' || s.custom_prompts.length === 0) return shuffled.slice(0, s.count).map((id) => ({ kind: 'catalog', id }));
  const customs = s.custom_prompts.slice(0, s.count);
  const nCatalog = Math.min(shuffled.length, s.count - customs.length);
  const total = customs.length + nCatalog;
  const out: PlannedQuestion[] = [];
  let c = 0;
  let k = 0;
  for (let i = 0; i < total; i++) {
    // eigene Frage, wenn sie „dran“ ist (gleichmäßig über die Runde verteilt)
    const wantCustom = c < customs.length && (k >= nCatalog || Math.floor(((i + 1) * customs.length) / total) > c);
    if (wantCustom) out.push({ kind: 'custom', prompt: customs[c++] });
    else out.push({ kind: 'catalog', id: shuffled[k++] });
  }
  return out;
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------- Ablauf

export interface PhaseInput {
  status: RoomStatus;
  index: number;
  count: number;
  endsAt: number | null;
  now: number;
  /** Alle Mitspieler dieser Frage haben eine gültige Antwort und nichts wird mehr geprüft */
  allAnswered: boolean;
  /** Es laufen noch KI-Prüfungen */
  pending: boolean;
}

export type Transition =
  | { to: 'question'; index: number }
  | { to: 'scoring' }
  | { to: 'finished' }
  | null;

/**
 * Was passiert beim nächsten „Tick“ (Client meldet Timer-Ende, Antwort kommt rein, Cron)?
 * Die Zeit kommt immer vom Server.
 */
export function nextTransition(p: PhaseInput): Transition {
  const due = p.endsAt !== null && p.now >= p.endsAt;
  switch (p.status) {
    case 'countdown':
      return due ? { to: 'question', index: p.index + 1 } : null;
    case 'question':
      if (p.allAnswered) return { to: 'scoring' };
      if (!due) return null;
      // Nach Ablauf: auf laufende KI-Prüfungen höchstens PENDING_GRACE_MS warten
      if (p.pending && p.now < (p.endsAt as number) + PENDING_GRACE_MS) return null;
      return { to: 'scoring' };
    case 'reveal':
      if (!due) return null;
      return p.index + 1 >= p.count ? { to: 'finished' } : { to: 'question', index: p.index + 1 };
    default:
      return null;
  }
}

/** Darf dieser Versuch noch angenommen werden? (nur in der Fragephase, bis Ablauf + Netz-Toleranz) */
export function acceptsAnswer(status: RoomStatus, endsAt: number | null, now: number): boolean {
  return status === 'question' && endsAt !== null && now <= endsAt + ANSWER_GRACE_MS;
}

/** Spielt dieser Spieler bei Frage idx mit? (später Beitretende erst ab from_index) */
export function playsQuestion(p: { kicked: boolean; from_index: number }, idx: number): boolean {
  return !p.kicked && p.from_index <= idx;
}

/** Nächster Gastgeber: der am längsten im Raum ist und gerade erreichbar. */
export function nextHost<T extends { user_id: string; kicked: boolean; joined_at: string; last_seen: string }>(
  players: readonly T[],
  currentHost: string | null,
  now: number,
): string | null {
  const alive = (p: T) => !p.kicked && now - Date.parse(p.last_seen) < HOST_TIMEOUT_MS;
  const host = players.find((p) => p.user_id === currentHost);
  if (host && alive(host)) return currentHost;
  const next = [...players].filter(alive).sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
  return next?.user_id ?? currentHost;
}

/** Erste freie Spielerfarbe (0–29). */
export function freeColor(used: readonly number[]): number {
  for (let c = 0; c < ROOM_MAX_PLAYERS; c++) if (!used.includes(c)) return c;
  return used.length % ROOM_MAX_PLAYERS;
}
