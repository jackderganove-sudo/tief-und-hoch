/**
 * Farbe der System-Leisten (Android-Statusleiste, Chrome-Adressleiste, installierte App)
 * zur Laufzeit an die Szene anpassen: Himmel oben, dunkle Höhlenzone beim Abstieg.
 */
let current = '';

export function setThemeColor(color: string) {
  if (color === current) return;
  current = color;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}
