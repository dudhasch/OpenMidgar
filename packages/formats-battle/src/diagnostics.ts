/**
 * Diagnosecodes der Kampfdaten-Formate (S30). Gleiche Haltung wie überall:
 * Quarantäne der betroffenen Einheit (Szene, Record, Skelett) statt Abbruch
 * des Gesamtbestands.
 */

export type BattleDiagnosticCode =
  /** Containerfehler in scene.bin (Blockraster, Zeigertabelle). */
  | 'E-BTL-CONTAINER'
  /** Eine Szene ließ sich nicht entpacken oder hat die falsche Größe. */
  | 'E-BTL-SCENE'
  /** Ein Record innerhalb einer Szene verletzt belegte Invarianten. */
  | 'E-BTL-RECORD'
  /** KI-Offsettabelle zeigt außerhalb ihres Bereichs. */
  | 'E-BTL-AI'
  /** kernel.bin-Sektion hat nicht die belegte Recordaufteilung. */
  | 'E-BTL-KERNEL'
  /** Battle-Skelett verletzt die 52+12·n-Grammatik. */
  | 'E-BTL-SKELETON';

export interface BattleDiagnostic {
  code: BattleDiagnosticCode;
  asset: string;
  message: string;
  /** Szenen-/Recordindex, wenn zutreffend. */
  index?: number;
}

export function bdiag(code: BattleDiagnosticCode, asset: string, message: string, index?: number): BattleDiagnostic {
  return index === undefined ? { code, asset, message } : { code, asset, message, index };
}
