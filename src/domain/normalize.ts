/**
 * Vereinheitlicht eine Eingabe für den Vergleich:
 * Kleinschreibung, ä→ae, ö→oe, ü→ue, ß→ss, sonstige Akzente weg,
 * Satzzeichen/Bindestriche → Leerzeichen, Mehrfach-Leerzeichen zusammengefasst.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Wie normalize, aber ohne Leerzeichen ("Spaghetti Carbonara" = "spaghetticarbonara"). */
export function compact(input: string): string {
  return normalize(input).replace(/ /g, '');
}
