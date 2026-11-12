import { PixelWorld, type WorldView } from './PixelWorld';

/**
 * Nur im Dev-Server: zeigt die Welt an einer festen Stelle, für Screenshots.
 *   /?world=rare&m=3000   /?world=common&m=4200   /?world=home
 */
export default function WorldPreview() {
  const p = new URLSearchParams(location.search);
  const view = (p.get('world') ?? 'home') as WorldView;
  const m = Number(p.get('m') ?? 0);
  return (
    <div className="relative h-dvh w-full">
      <PixelWorld view={view} meters={m} />
    </div>
  );
}
