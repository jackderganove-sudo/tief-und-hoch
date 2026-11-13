/**
 * Lebendiger Himmel: Böen mit Windlinien (auch vor dem Ballon), Wolken im Vordergrund,
 * Vögel weichen aus oder landen auf dem Korb, Engelchen umkreisen den Ballon, Turbulenz
 * in der Wolkendecke, Antippen. Schnittstelle: interact.ts. Aufgerufen von world.ts.
 */
import type { Images } from './assets';
import type { FxFrame } from './interact';

export class SkyFx {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_img: Images) {}

  /** Hinter dem Ballon (nach dem ganzen Himmel). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  back(_f: FxFrame) {}

  /** Vor dem Ballon (ganz zuletzt). Nicht über UI-Flächen (f.ix.avoid) zeichnen. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  front(_f: FxFrame) {}
}
