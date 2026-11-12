import { useEffect, useRef } from 'react';
import type { TierId } from '../domain/types';
import { loadImages } from './assets';
import { BALLOON_X, PPM, World, type ViewState } from './world';

export type WorldView = 'home' | 'rare' | 'common';

export interface WorldFx {
  /** ändert sich bei jeder neuen Antwort */
  key: number;
  tier: TierId;
  points: number;
}

/** Startseite: Schacht im linken, Ballon im rechten Drittel – auch auf breiten Bildschirmen. */
const homeCamX = (W: number) => BALLOON_X / 2 + Math.max(0, (W - 200) * 0.12);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Die Pixel-Welt als Canvas. Rendert in niedriger Auflösung und skaliert per CSS
 * ganzzahlig hoch (image-rendering: pixelated) – nichts wird weichgezeichnet.
 *
 * `meters` ist die Tiefe (rare) bzw. Höhe (common). Ändert sie sich, fährt die
 * Figur dorthin; je weiter der Weg, desto länger die Fahrt. Bei der Ankunft
 * wird `fx` ausgelöst (Partikel, Jubel bei 100 Punkten, Zucken bei 0).
 */
export function PixelWorld({ view, meters = 0, fx = null }: { view: WorldView; meters?: number; fx?: WorldFx | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(meters);
  const fxRef = useRef<WorldFx | null>(fx);
  target.current = meters;
  fxRef.current = fx;

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let world: World | null = null;
    let raf = 0;
    let stopped = false;
    let W = 200;
    let H = 300;

    const resize = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // ganzzahliger Maßstab: virtuelle Breite ca. 180–360 px
      const scale = Math.max(2, Math.min(6, Math.floor(Math.min(cw / 180, ch / 200))));
      W = Math.ceil(cw / scale);
      H = Math.ceil(ch / scale);
      cv.width = W;
      cv.height = H;
      cv.style.width = `${W * scale}px`;
      cv.style.height = `${H * scale}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Fahrt-Zustand
    let shown = target.current;
    let from = shown;
    let to = shown;
    let t0 = 0;
    let dur = 0;
    let doneFx = fxRef.current?.key ?? -1; // beim ersten Laden nichts auslösen
    let pendingFx: WorldFx | null = null;
    let mood: 'idle' | 'cheer' | 'flinch' = 'idle';
    let moodUntil = 0;
    let last = performance.now();

    const fire = (f: WorldFx, now: number) => {
      if (!world) return;
      const power = 0.5 + f.points / 100;
      if (view === 'rare') world.burst(f.tier, 0, shown * PPM, power);
      else world.burst(f.tier, BALLOON_X, -shown * PPM - 40, power);
      mood = f.points >= 100 ? 'cheer' : f.points === 0 ? 'flinch' : 'idle';
      moodUntil = now + (mood === 'cheer' ? 2600 : 900);
    };

    const frame = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (!world) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const calm = reduce.matches;

      if (target.current !== to) {
        from = shown;
        to = target.current;
        t0 = now;
        // mehr Meter = längere, spürbarere Fahrt
        dur = calm ? 0 : 900 + Math.abs(to - from) * 2.3;
      }
      const f = fxRef.current;
      if (f && f.key !== doneFx) {
        doneFx = f.key;
        pendingFx = f;
      }
      const moving = shown !== to;
      if (moving) {
        const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
        shown = t >= 1 ? to : from + (to - from) * easeInOut(t);
      }
      if (pendingFx && shown === to) {
        fire(pendingFx, now);
        pendingFx = null;
      }
      if (mood !== 'idle' && now > moodUntil) mood = 'idle';

      const px = shown * PPM;
      const state: ViewState = {
        camX: view === 'home' ? homeCamX(W) : view === 'rare' ? 0 : BALLOON_X,
        camY: view === 'rare' ? px : view === 'common' ? -px : 0,
        anchorY: Math.round(H * (view === 'home' ? 0.55 : view === 'rare' ? 0.7 : 0.86)),
        time: now / 1000,
        depth: view === 'rare' ? shown : view === 'home' ? 70 : 0,
        altitude: view === 'common' ? shown : 0,
        explorerMood: view === 'rare' ? mood : 'idle',
        balloonMood: view === 'common' ? mood : 'idle',
        explorerMoving: view === 'rare' && moving,
        balloonRising: view === 'common' && moving && to > from,
        calm,
      };
      world.draw(ctx, W, H, state, dt);
    };

    void loadImages().then((images) => {
      if (stopped) return;
      world = new World(images, ctx);
    });
    raf = requestAnimationFrame(frame);

    // im Hintergrund-Tab nicht weiterzeichnen
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [view]);

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden bg-[#0b0b22]" aria-hidden>
      <canvas ref={canvasRef} className="pixelated absolute left-0 top-0" />
    </div>
  );
}
