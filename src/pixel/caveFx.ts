/**
 * Lebendige Höhle und Hölle: Umgebung reagiert auf den Forscher und er auf sie
 * (Tropfen auf den Helm, Fledermausschwärme, Lampe spiegelt sich in Kristallen,
 * Pilze leuchten auf, Funken und Hitzeflimmern, Teufelchen springen weg, Antippen).
 * Schnittstelle: interact.ts. Aufgerufen von world.ts.
 */
import type { Images } from './assets';
import type { FxFrame } from './interact';

export class CaveFx {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_img: Images) {}

  /** Hinter dem Forscher (nach Schacht und Hölle, unter der Dunkelheit). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  back(_f: FxFrame) {}

  /** Vor dem Forscher, noch unter der Dunkelheit (wird von ihr abgedunkelt, Lampe hellt auf). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  front(_f: FxFrame) {}

  /** Über der Dunkelheit: Leuchtendes im Vordergrund (Funken, Glut, Glitzern). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  glow(_f: FxFrame) {}
}
