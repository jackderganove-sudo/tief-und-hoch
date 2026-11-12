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

/** Farbe des obersten Pixels der Szene (Mitte) als #rrggbb. */
export function sampleTopColor(ctx: CanvasRenderingContext2D, width: number): string | null {
  try {
    const [r, g, b] = ctx.getImageData(Math.floor(width / 2), 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}
