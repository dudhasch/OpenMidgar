/** Fehlerklassen der Modellkette laut Import-Validierungsmatrix (Phase 1.5). */

export type ModelDiagnosticCode =
  | 'E-HRC-GRAMMAR' // Zeilengrammatik verletzt → Fallback-Modell
  | 'E-HRC-CYCLE' // Parent-Zyklus oder fehlender Parent
  | 'E-RSD-KEY' // Pflichtschlüssel fehlt/unlesbar
  | 'E-P-SIZE' // Zähler×Recordgröße ≠ Datenlänge
  | 'E-P-BOUNDS' // Index außerhalb des Pools
  | 'W-P-GROUP' // defekte Gruppe ausgelassen (Degradierung)
  | 'E-TEX-SIZE' // Header vs. Datenlänge inkonsistent
  | 'E-TEX-FORMAT' // nicht unterstütztes Pixelformat
  | 'E-TEX-BOUNDS' // Palettenindex außerhalb der Palette
  | 'E-ANIM-SIZE' // Header vs. Datenlänge inkonsistent
  | 'W-ANIM-BONES' // Bone-Zahl ≠ Skelett (Clamp/Pad-Toleranzregel)
  | 'W-ANIM-ROTORDER'; // Reihenfolge-Tripel im Kopf ist keine Permutation von {0,1,2}

export interface ModelDiagnostic {
  code: ModelDiagnosticCode;
  asset: string;
  message: string;
}

export function mdiag(code: ModelDiagnosticCode, asset: string, message: string): ModelDiagnostic {
  return { code, asset, message };
}
