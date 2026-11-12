/**
 * Einmalige Umstellung der localStorage-Schlüssel nach der Umbenennung
 * („tuh:“ → „hal:“, Highs & Lows). Läuft als allererstes Modul – vor i18n und
 * den Supabase-Clients –, damit Spielstand, Statistik, Sprache, KI-Cache und
 * Anmeldungen erhalten bleiben. Vorhandene neue Werte werden nie überschrieben.
 */
const OLD = 'tuh:';
const NEW = 'hal:';

export function migrateStorage(storage: Storage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(OLD)) keys.push(k);
  }
  for (const k of keys) {
    const target = NEW + k.slice(OLD.length);
    const value = storage.getItem(k);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(k);
  }
  return keys.length;
}

try {
  if (typeof localStorage !== 'undefined') migrateStorage(localStorage);
} catch {
  /* localStorage gesperrt – nichts zu tun */
}
