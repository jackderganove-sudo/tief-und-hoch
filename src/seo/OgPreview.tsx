import { PixelWorld } from '../pixel/PixelWorld';
import { Panel } from '../components/px';

/**
 * Vorschaubild für Link-Vorschauen (og:image, 1200×630) – nur im Dev-Server unter /?og.
 * scripts/og-image.mjs fotografiert diese Seite nach public/og-image.png.
 */
export default function OgPreview() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PixelWorld view="home" />
      <div className="absolute left-[3%] top-1/2 z-10 w-[37%] -translate-y-1/2">
        <Panel tone="wood" className="px-3 py-1 text-center">
          <h1 className="text-[4.6rem] font-bold leading-none">Highs &amp; Lows</h1>
          <p className="mt-3 text-[1.5rem] leading-tight">Tägliches Trivia · Daily trivia</p>
        </Panel>
        <div className="mt-4 grid grid-cols-2 gap-3 text-center text-[1.4rem] font-bold">
          <Panel tone="wood" className="px-1 [--px:3px]">▲ Häufig = hoch</Panel>
          <Panel tone="stone" className="px-1 [--px:3px]">▼ Selten = tief</Panel>
        </div>
      </div>
    </div>
  );
}
