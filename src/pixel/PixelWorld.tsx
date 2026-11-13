import { useEffect, useRef } from 'react';
import { setThemeColor } from '../pwa/themeColor';
import { systemBarColor } from './barColors';
import type { TierId } from '../domain/types';
import { loadImages } from './assets';
import { BALLOON_X, PPM, World, type CrewMember, type ViewState } from './world';

export type WorldView = 'home' | 'rare' | 'common';

export interface WorldFx {
  /** ändert sich bei jeder neuen Antwort */
  key: number;
  tier: TierId;
  points: number;
}

/** Freunde-Modus: ein Spieler in der Szene (die eigene Figur hat me = true). */
export interface CrewInput {
  id: string;
  name: string;
  color: string;
  meters: number;
  me?: boolean;
  mood?: 'idle' | 'cheer' | 'flinch';
  /** Namensschild zeigen (bei vielen Spielern nur ausgewählte) */
  label?: boolean;
}

/** x-Versatz der Mitspieler: links/rechts neben der eigenen Figur, bei vielen enger (gestaffelt). */
export function crewOffsets(n: number, view: WorldView): number[] {
  const rare = view === 'rare';
  const inner = rare ? 9 : 24;
  const outer = rare ? 42 : 96;
  const perSide = Math.ceil(n / 2);
  const step = perSide <= 1 ? 0 : Math.min(rare ? 9 : 22, (outer - inner) / (perSide - 1));
  return Array.from({ length: n }, (_, i) => {
    const k = Math.floor(i / 2);
    return (i % 2 ? -1 : 1) * (inner + k * step);
  });
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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Die Pixel-Welt als Canvas. Rendert in niedriger Auflösung und skaliert per CSS
 * ganzzahlig hoch (image-rendering: pixelated) – nichts wird weichgezeichnet.
 *
 * `meters` ist die Tiefe (rare) bzw. Höhe (common). Ändert sie sich, fährt die
 * Figur dorthin; je weiter der Weg, desto länger die Fahrt. Bei der Ankunft
 * wird `fx` ausgelöst (Partikel, Jubel bei 100 Punkten, Zucken bei 0).
 */
/** Was als UI-Fläche gilt (Vordergrund-Effekte weichen aus). */
const UI_SELECTOR = '.px-wood, .px-stone, .px-btn, .px-field, input, textarea, [data-world-avoid]';
/** Worauf Antippen nicht in die Welt geht. */
const NO_TAP_SELECTOR = 'button, a, input, textarea, select, label, [role="button"], [role="dialog"], .px-wood, .px-stone, .px-btn, .px-field, [data-no-world-tap]';

export function PixelWorld({ view, meters = 0, fx = null, crew }: { view: WorldView; meters?: number; fx?: WorldFx | null; crew?: CrewInput[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(meters);
  const fxRef = useRef<WorldFx | null>(fx);
  const crewRef = useRef<CrewInput[] | undefined>(crew);
  const labels = useRef(new Map<string, HTMLDivElement>());
  target.current = meters;
  fxRef.current = fx;
  crewRef.current = crew;

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
    let scale = 2;
    const crewShown = new Map<string, number>();

    const resize = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // ganzzahliger Maßstab: virtuelle Breite ca. 180–360 px
      // Startseite etwas weiter herausgezoomt, damit Ballon und Höhleneingang übereinander passen
      scale = Math.max(2, Math.min(6, Math.floor(Math.min(cw / 180, ch / (view === 'home' ? 300 : 200)))));
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
    let lastUi = 0;

    /** UI-Flächen (Panels, Knöpfe, Felder) in Canvas-Koordinaten – dort keine Vordergrund-Effekte. */
    const measureUi = () => {
      if (!world) return;
      const base = el.getBoundingClientRect();
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const n of document.querySelectorAll<HTMLElement>(UI_SELECTOR)) {
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < base.top || r.top > base.bottom) continue;
        rects.push({ x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale });
        if (rects.length >= 24) break;
      }
      // Frage/Eingabe zu sehen → ruhiger
      world.setUi(rects, !!document.querySelector('input:not([type=hidden]), textarea, [data-world-quiet]'));
    };

    /**
     * Antippen der Szene: nur auf freier Fläche (nicht auf Knöpfen, Panels, Feldern), nie während
     * ein Eingabefeld den Fokus hat (Tastatur bleibt offen), kein preventDefault – stört nichts.
     */
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || !world || !e.isPrimary) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 450) return; // Wischen/Halten
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable)) return;
      const tgt = e.target instanceof Element ? e.target : null;
      if (tgt?.closest(NO_TAP_SELECTOR)) return;
      const base = el.getBoundingClientRect();
      if (e.clientX < base.left || e.clientX > base.right || e.clientY < base.top || e.clientY > base.bottom) return;
      world.tap(Math.floor((e.clientX - base.left) / scale), Math.floor((e.clientY - base.top) / scale));
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });

    const fire = (f: WorldFx, now: number) => {
      if (!world) return;
      const power = 0.5 + f.points / 100;
      const calm = reduce.matches;
      if (view === 'rare') world.burst(f.tier, 0, shown * PPM, power, calm);
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

      // Unter dem Höllentor bzw. über dem Himmelstor geht es endlos weiter (Übung, Freunde-Modus)
      const pos = shown;
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

      // Freunde-Modus: Mitspieler gleiten zu ihren Punkten; Kamera folgt der eigenen Figur
      const all = crewRef.current;
      const ox = Math.round(W / 2 - state.camX);
      const oy = Math.round(state.anchorY - state.camY);
      if (all && view !== 'home') {
        const others = all.filter((c) => !c.me);
        const xs = crewOffsets(others.length, view);
        state.crew = others.map((c, i): CrewMember => {
          const prev = crewShown.get(c.id) ?? c.meters;
          const goal = c.meters;
          const next = calm || Math.abs(goal - prev) < 2 ? goal : prev + (goal - prev) * Math.min(1, dt * 1.6);
          crewShown.set(c.id, next);
          return { x: xs[i], meters: next, color: c.color, mood: c.mood ?? 'idle' };
        });
        // Namensschilder (DOM, gestochen scharf) über den Figuren
        others.forEach((c, i) => {
          const el = labels.current.get(c.id);
          if (!el) return;
          const m = crewShown.get(c.id) ?? 0;
          const x = view === 'rare' ? ox + xs[i] : ox + BALLOON_X + xs[i];
          // bei vielen Spielern Schilder abwechselnd versetzt, damit sie sich nicht überdecken
          const stagger = others.length > 4 ? (i % 4) * 7 : 0;
          const y = (view === 'rare' ? oy + m * PPM - 9 : oy - m * PPM - 33) - stagger;
          el.style.transform = `translate(${x * scale}px, ${y * scale}px) translate(-50%, -100%)`;
        });
        const mine = all.find((c) => c.me);
        const el = mine && labels.current.get(mine.id);
        if (el) {
          const x = view === 'rare' ? ox : ox + BALLOON_X;
          const y = view === 'rare' ? oy + pos * PPM - 12 : oy - pos * PPM - 78;
          el.style.transform = `translate(${x * scale}px, ${y * scale}px) translate(-50%, -100%)`;
        }
      }
      if (now - lastUi > 250) {
        lastUi = now;
        measureUi();
      }
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
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
    };
  }, [view]);

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden bg-[#0b0b22]" aria-hidden>
      <canvas ref={canvasRef} className="pixelated absolute left-0 top-0" />
      {crew
        ?.filter((c) => c.label !== false)
        .map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              if (el) labels.current.set(c.id, el);
              else labels.current.delete(c.id);
            }}
            className={`pointer-events-none absolute left-0 top-0 max-w-[6rem] truncate whitespace-nowrap px-1 text-[0.7rem] font-bold leading-4 text-white ${c.me ? 'z-10 ring-1 ring-white' : ''}`}
            style={{ background: c.color, transform: 'translate(-999px, -999px)' }}
          >
            {!c.me && crew.length > 5 ? c.name.slice(0, 6) : c.name}
          </div>
        ))}
    </div>
  );
}
