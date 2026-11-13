import { SUPABASE_ANON_KEY, SUPABASE_URL, ensureSession, supabase } from '../services/supabase/client';
import type { RoomSettings, RoomStatus } from '../domain/room';
import type { RevealGroup, Special } from '../domain/roomScoring';
import type { TierId } from '../domain/types';

/** Freunde-Modus: Aufrufe an die Edge Function "room" und den Zustand per RPC. */

export interface RoomPlayer {
  user_id: string;
  name: string;
  avatar: number;
  color: number;
  from_index: number;
  online: boolean;
  /** hat eine gültige Antwort (nur die beendet die Frage) */
  answered: boolean;
  /** Versuche bei der laufenden Frage – nur die Anzahl */
  attempts: number;
  points: number;
}

export interface RevealPlayer {
  points: number;
  tier: TierId;
  group: string | null;
  special?: Special;
  /** Original-Schreibweise */
  answer: string | null;
  /** Versuche bei dieser Frage */
  attempts?: number;
}

export interface Reveal {
  idx: number;
  scoring: 'global' | 'group';
  mode: 'rare' | 'common';
  groups: RevealGroup[];
  players: Record<string, RevealPlayer>;
  missed: string[];
  unchecked: string[];
  list: { top: string | null; rarest: string | null } | null;
  /** Lustige Fehlversuche – nur wenn der Raum es erlaubt (sonst null) */
  funny?: { user_id: string; text: string }[] | null;
}

/** Antwort des Servers auf einen Versuch. */
export interface AttemptReply {
  accepted: boolean;
  reason?: 'duplicate' | 'invalid' | 'list_only' | 'limited' | 'unchecked' | 'too_many';
  hint?: string | null;
  ai_left: number;
  attempts: number;
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  settings: Omit<RoomSettings, 'custom_prompts'>;
  custom_prompts: string[] | null;
  index: number;
  count: number;
  round: number;
  ends_at: string | null;
  now: string;
  version: number;
  host_id: string | null;
  me: string;
  players: RoomPlayer[];
  question: { idx: number; prompt: string; topic: string | null; custom: boolean; ends_at: string | null } | null;
  /** eigene gewertete (gültige) Antwort */
  my_answer: string | null;
  /** eigene abgelehnte Versuche dieser Frage */
  my_attempts?: string[];
  /** eigene nicht geprüfte Versuche (KI nicht erreichbar/Limit) – nicht falsch */
  my_unchecked?: string[];
  /** KI-Prüfungen, die mir bei dieser Frage bleiben */
  my_ai_left?: number;
  reveal: Reveal | null;
  reveals: Reveal[] | null;
}

export interface RoomPreview {
  error: 'not_found' | 'not_member' | 'kicked';
  code?: string;
  status?: RoomStatus;
  players?: number;
  host?: string | null;
  lang?: string;
}

export class RoomError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function roomCall<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = await ensureSession();
  if (!token) throw new RoomError('no_session', 0);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new RoomError('offline', 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new RoomError(data.error ?? `http_${res.status}`, res.status);
  return data;
}

export async function fetchRoom(code: string): Promise<RoomState | RoomPreview> {
  if (!supabase || !(await ensureSession())) throw new RoomError('no_session', 0);
  const { data, error } = await supabase.rpc('room_state', { p_code: code });
  if (error) throw new RoomError(error.message, 0);
  return data as RoomState | RoomPreview;
}

export const isPreview = (s: RoomState | RoomPreview | null): s is RoomPreview => !!s && 'error' in s;

export const roomLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}?room=${code}`;

// ---------------------------------------------------------------- Name/Avatar merken

const PROFILE_KEY = 'hal:v1:room-profile';
export function savedRoomProfile(): { name: string; avatar: number } | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function saveRoomProfile(p: { name: string; avatar: number }) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* egal */
  }
}
