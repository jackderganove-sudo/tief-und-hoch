/**
 * Gemeinsame Bausteine für eine Welt, die auf die Figur reagiert (und umgekehrt).
 * Feste Schnittstelle zwischen Himmel (skyFx.ts, heaven.ts) und Höhle/Hölle (caveFx.ts,
 * hell.ts, deep.ts); world.ts füllt sie jedes Bild und zeichnet Figur und Ballon danach.
 *
 * Alle Koordinaten sind Bildschirm-Koordinaten des Canvas (virtuelle Pixel), wie beim Zeichnen.
 *
 * Ablauf pro Bild:
 *   1. world.ts: begin() – Figur-/Ballon-Anker, UI-Flächen, Antipp-Ereignisse dieses Bilds
 *   2. Renderer zeichnen, lesen Anker/Wind/Taps, lösen Reaktionen aus (rig.react / rig.push)
 *   3. world.ts zeichnet Figur und Ballon mit dem Zustand der Rigs (Schwingen, Neigen, Pose)
 *   4. world.ts: end(dt) – Federn, Böen und Zeiten weiterrechnen
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Posen, die world.ts an Figur bzw. Ballon-Passagier zeichnen kann. */
export type Pose =
  | 'flinch' // zuckt (Tropfen auf den Helm, Funke)
  | 'duck' // duckt sich (Fledermausschwarm, Teufelchen springt)
  | 'hold' // hält sich fest (Böe, Turbulenz)
  | 'look' // schaut zur Seite (dir: -1 links, 1 rechts)
  | 'wave'; // winkt (Engelchen, Vogel auf dem Korb)

/**
 * Bewegliche Figur: Forscher am Seil (Pendel) bzw. Ballon (Neigen). Federnd gedämpft;
 * Renderer geben nur Stöße und Posen, world.ts zeichnet daraus.
 */
export class Rig {
  /** Seitliche Auslenkung in px (Forscher: unteres Seilende; Ballon: Hülle oben). */
  swing = 0;
  private vel = 0;
  pose: Pose | null = null;
  /** Blickrichtung für 'look' bzw. Seite für 'wave'. */
  dir: -1 | 1 = 1;
  private poseLeft = 0;
  /** Kurzer Wackler (z. B. Ruck, Tropfen) – zusätzlich zum Schwingen. */
  jolt = 0;
  /** Ballon: Brenner kurz fauchen lassen (Sekunden). */
  burner = 0;

  constructor(
    /** Federsteife: Forscher am langen Seil schwingt langsam, Ballon richtet sich schneller auf. */
    private stiffness: number,
    private damping: number,
    /** Größte Auslenkung in px. */
    private max: number,
  ) {}

  /** Stoß in px/s (positiv = nach rechts). */
  push(v: number) {
    this.vel += v;
  }

  /** Pose für `seconds` zeigen. Eine stärkere/neuere Reaktion ersetzt die laufende. */
  react(pose: Pose, seconds: number, dir: -1 | 1 = 1) {
    this.pose = pose;
    this.dir = dir;
    this.poseLeft = seconds;
    if (pose === 'flinch') this.jolt = Math.max(this.jolt, 0.35);
  }

  get busy() {
    return this.pose !== null;
  }

  update(dt: number, calm: boolean) {
    if (calm) {
      // ohne Bewegung: sofort in Ruhe, Posen nur kurz
      this.swing = 0;
      this.vel = 0;
      this.jolt = 0;
    } else {
      this.vel += (-this.stiffness * this.swing - this.damping * this.vel) * dt;
      this.swing += this.vel * dt;
      if (Math.abs(this.swing) > this.max) {
        this.swing = Math.sign(this.swing) * this.max;
        this.vel *= -0.3;
      }
      this.jolt = Math.max(0, this.jolt - dt);
    }
    this.burner = Math.max(0, this.burner - dt);
    if (this.pose) {
      this.poseLeft -= dt;
      if (this.poseLeft <= 0) this.pose = null;
    }
  }
}

/** Windböe: zieht als Band waagerecht durchs Bild; front = auch vor dem Ballon sichtbar. */
export interface Gust {
  /** Mitte des Bandes (Bildschirm-y) und Vorderkante (x, wandert mit vx). */
  y: number;
  x: number;
  vx: number;
  /** Höhe des Bandes in px. */
  h: number;
  /** 0..1 */
  strength: number;
  front: boolean;
  /** Schon getroffen: eigener Ballon (-1) bzw. Mitspieler-Index – jede Böe stößt jeden nur einmal. */
  hit?: Set<number>;
  /** frei für den Erzeuger (Aussehen, Seed) */
  seed: number;
  age: number;
}

export class Wind {
  gusts: Gust[] = [];

  add(g: Omit<Gust, 'age'>) {
    if (this.gusts.length < 6) this.gusts.push({ ...g, age: 0 });
  }

  /** Böen, deren Band gerade über den Punkt (x, y) streicht (Vorderkante höchstens `reach` px entfernt). */
  at(x: number, y: number, reach = 24): Gust[] {
    return this.gusts.filter((g) => Math.abs(y - g.y) < g.h / 2 && Math.abs(x - g.x) < reach);
  }

  update(dt: number, W: number) {
    for (const g of this.gusts) {
      g.x += g.vx * dt;
      g.age += dt;
    }
    this.gusts = this.gusts.filter((g) => g.x > -120 && g.x < W + 120);
  }
}

/** Was die Effekt-Renderer (skyFx.ts, caveFx.ts) pro Bild bekommen. */
export interface FxFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Bildschirm-x der Welt-Mitte (Seil) und Bildschirm-y der Erdoberfläche (0 m). */
  ox: number;
  oy: number;
  /** Bildschirm-y für Weltmeter m: Höhle oy + m * PPM, Himmel oy - m * PPM. */
  camY: number;
  anchorY: number;
  time: number;
  dt: number;
  calm: boolean;
  /** Tiefe des Forschers bzw. Höhe des Ballons in Metern. */
  depth: number;
  altitude: number;
  show: { explorer: boolean; balloon: boolean; cave: boolean };
  /** Lichtquellen der Höhle (Stirnlampe stanzt Dunkelheit aus): [x, y, Radius, Farbe]. */
  lights: [number, number, number, string?, boolean?][];
  ix: Interact;
}

export interface Tap {
  x: number;
  y: number;
  /** Schon von einem Renderer beantwortet? (Dann reagiert sonst niemand mehr darauf.) */
  used: boolean;
}

/** Wie stark Effekte laufen: 1 normal, deutlich weniger bei prefers-reduced-motion. */
export function motionScale(calm: boolean) {
  return calm ? 0.15 : 1;
}

export class Interact {
  /** Forscher am Seil (Abstieg). */
  explorer = new Rig(9, 1.6, 6);
  /** Eigener Ballon (Aufstieg). */
  balloon = new Rig(14, 2.6, 6);
  /** Ballons/Figuren der Mitspieler (Freunde-Modus), nach Index. */
  crew: Rig[] = [];
  wind = new Wind();
  taps: Tap[] = [];
  /** UI-Flächen (Panels, Knöpfe) in Canvas-Koordinaten: Vordergrund-Effekte nicht darüber zeichnen. */
  avoid: Rect[] = [];
  /** Eine Frage/Eingabe ist zu sehen: Ereignisse seltener, nichts Auffälliges im Vordergrund. */
  quiet = false;
  calm = false;
  time = 0;

  /** Anker dieses Bilds (null = nicht zu sehen). */
  explorerAnchor: { x: number; y: number; head: Rect; lamp: { x: number; y: number; r: number } } | null = null;
  balloonAnchor: { x: number; y: number; envelope: Rect; basket: Rect } | null = null;
  /** Mitspieler: Position (Seilende bzw. Ballonmitte). */
  crewAnchors: { x: number; y: number }[] = [];

  /** Liegt das Rechteck (ganz oder teilweise) über einer UI-Fläche? */
  overUi(r: Rect): boolean {
    return this.avoid.some((a) => r.x < a.x + a.w && r.x + r.w > a.x && r.y < a.y + a.h && r.y + r.h > a.y);
  }

  /** Nimmt den ersten unbenutzten Tap in `r` (oder im Radius um x/y) und markiert ihn als benutzt. */
  takeTap(r: Rect): Tap | null {
    const t = this.taps.find((t) => !t.used && t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h);
    if (t) t.used = true;
    return t ?? null;
  }

  /** Häufigkeit für Zufallsereignisse: Rate pro Sekunde → Wahrscheinlichkeit in diesem Bild. */
  chance(perSecond: number, dt: number) {
    const rate = perSecond * motionScale(this.calm) * (this.quiet ? 0.5 : 1);
    return Math.random() < rate * dt;
  }

  end(dt: number, W: number) {
    this.explorer.update(dt, this.calm);
    this.balloon.update(dt, this.calm);
    for (const r of this.crew) r.update(dt, this.calm);
    this.wind.update(dt, W);
    this.taps = [];
  }
}
