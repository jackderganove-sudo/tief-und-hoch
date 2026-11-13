import { PixelWorld, previewCrew, type WorldView } from './PixelWorld';

/**
 * Nur im Dev-Server: zeigt die Welt an einer festen Stelle, für Screenshots.
 *   /?world=rare&m=3000   /?world=common&m=4200   /?world=home   &crew=5 (Freunde-Modus)
 */
export default function WorldPreview() {
  const p = new URLSearchParams(location.search);
  const view = (p.get('world') ?? 'home') as WorldView;
  const m = Number(p.get('m') ?? 0);
  const n = Number(p.get('crew') ?? 0);
  return (
    <div className="relative h-dvh w-full">
      <PixelWorld view={view} meters={m} crew={n > 0 && view !== 'home' ? previewCrew(n, m) : undefined} />
    </div>
  );
}
