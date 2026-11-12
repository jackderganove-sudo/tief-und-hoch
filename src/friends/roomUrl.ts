import { cleanRoomCode, isRoomCode } from '../domain/room';

const URL_KEY = 'room';

/** Raumcode in der Adresse halten – Reload und Teilen-Link führen zurück in den Raum. */
export function setUrlCode(code: string | null) {
  const u = new URL(location.href);
  if (code) u.searchParams.set(URL_KEY, code);
  else u.searchParams.delete(URL_KEY);
  history.replaceState(history.state, '', u);
}

/** Einladungslink ?room=CODE */
export function urlRoomCode(): string | null {
  const c = cleanRoomCode(new URLSearchParams(location.search).get(URL_KEY) ?? '');
  return isRoomCode(c) ? c : null;
}
