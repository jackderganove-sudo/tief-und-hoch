import { useEffect, useRef } from 'react';
import { setThemeColor } from '../pwa/themeColor';
import { systemBarColor } from './barColors';
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
/**
 * Startseite als Querschnitt: Schacht und Ballon auf einer senkrechten Linie in der Mitte.
 * Diese Verhältnisse (Anteil der Bildschirmhöhe) nutzt auch das Layout in HomeScreen.
 */
export const HOME_LAYOUT = {
  // Hochformat: Titel → Aufstieg-Knopf → Ballon über dem Gerüst | Boden | Forscher → Abstieg-Knopf
  portrait: { ground: 0.6, balloonTop: 0.32, explorer: 0.67 },
  // Querformat: Figuren in der Mitte, Knöpfe in einer gemeinsamen Spalte rechts daneben
  landscape: { ground: 0.64, balloonTop: 0.245, explorer: 0.76 },
};
const homeLayout = (W: number, H: number) => (W > H ? HOME_LAYOUT.landscape : HOME_LAYOUT.portrait);
const BALLOON_H = 74;
/** Tiefste Stelle der Höhle (knapp über dem Lavasee). */
const MAX_DEPTH_M = 7000;

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
      // Startseite etwas weiter herausgezoomt, damit Ballon und Höhleneingang übereinander passen
      const scale = Math.max(2, Math.min(6, Math.floor(Math.min(cw / 180, ch / (view === 'home' ? 300 : 200)))));
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
    let lastTheme = 0;

    const fire = (f: WorldFx, now: number) => {
      if (!world) return;
      const power = 0.5 + f.points / 100;
      const calm = reduce.matches;
      if (view === 'rare') world.burst(f.tier, 0, Math.min(shown, MAX_DEPTH_M) * PPM, power, calm);
      else world.burst(f.tier, BALLOON_X, -shown * PPM - 40, power, calm);
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

      // Die Höhle endet am Lavasee: in endlosen Übungen bleibt die Figur dort, die Anzeige zählt weiter
      const pos = view === 'rare' ? Math.min(shown, MAX_DEPTH_M) : shown;
      const px = pos * PPM;
      const state: ViewState = {
        camX: view === 'common' ? BALLOON_X : 0,
        camY: view === 'rare' ? px : view === 'common' ? -px : 0,
        anchorY: Math.round(H * (view === 'home' ? homeLayout(W, H).ground : view === 'rare' ? 0.7 : 0.86)),
        time: now / 1000,
        depth: view === 'rare' ? pos : view === 'home' ? Math.max(30, ((homeLayout(W, H).explorer - homeLayout(W, H).ground) * H) / PPM) : 0,
        // Startseite: Ballon schwebt im Himmel über dem Gerüst
        altitude: view === 'common' ? shown : view === 'home' ? Math.max(0, ((homeLayout(W, H).ground - homeLayout(W, H).balloonTop) * H - BALLOON_H) / PPM) : 0,
        explorerMood: view === 'rare' ? mood : 'idle',
        balloonMood: view === 'common' ? mood : 'idle',
        explorerMoving: view === 'rare' && moving,
        balloonRising: view === 'common' && moving && to > from,
        calm,
        show: { explorer: view !== 'common', balloon: view !== 'rare', cave: view !== 'common' },
        balloonX: view === 'home' ? 0 : BALLOON_X,
      };
      world.draw(ctx, W, H, state, dt);
      // Systemleisten: feste Farbe je Ort (Himmel nach Höhe, Höhle nach Zone)
      if (now - lastTheme > 300) {
        lastTheme = now;
        setThemeColor(systemBarColor(view, pos));
      }
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
