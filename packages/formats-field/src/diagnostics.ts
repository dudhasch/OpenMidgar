/**
 * Typisierte Fehlerklassen des Field-Pfads laut Import-Validierungsmatrix
 * (Masterplan Phase 1.5). Sektionsfehler tragen die 1-basierte Sektionsnummer
 * im Code (`E-FLD-SEC5` = Walkmesh-Sektion defekt).
 */

export type FieldDiagnosticCode =
  | 'E-LZS-STREAM' // LZS-Strom defekt — Asset unbrauchbar
  | 'E-FLD-HDR' // Container-Header unbrauchbar — Field fatal
  | `E-FLD-SEC${number}` // Sektion n quarantänisiert — Bundle degradiert
  | 'W-FLD-MAGIC' // führendes u16 != 0 (🟡 Zu validieren) — nur Diagnose
  | 'W-FLD-SECCOUNT' // Sektionsanzahl != 9 — nur Diagnose
  | 'E-WM-COUNT' // Walkmesh-Zähler passt nicht zur Sektionslänge
  | 'E-WM-ADJ' // Adjazenzindex außerhalb — Kante wird als gesperrt behandelt
  | 'W-WM-ASYM' // Adjazenz nicht symmetrisch
  | 'W-WM-DEGEN' // degeneriertes Dreieck markiert
  | 'E-CAM-SIZE' // Kamerasektion hat keine gültige Recordgröße
  | 'W-CAM-ORTHO' // Achsenmatrix außerhalb der Orthonormalitätstoleranz
  | 'E-TRG-SIZE' // Triggersektion zu kurz
  | 'E-SCR-HDR' // Script-Header unplausibel
  | 'E-SCR-SPAN' // Script-Entry-Point außerhalb des Script-Bereichs
  | 'E-SCR-STR' // String-Offset außerhalb der Sektion
  | 'E-PAL-SIZE' // Palettensektion: Header vs. Länge inkonsistent
  | 'E-BG-HDR' // Hintergrund: Marker fehlen oder falsche Reihenfolge
  | 'E-BG-LAYER' // Hintergrund: Layer-Accounting geht nicht auf
  | 'E-BG-TEX' // Hintergrund: Texturseiten-Accounting geht nicht auf
  | 'E-MDL-SIZE' // Model-Loader: Accounting geht nicht auf — Sektion unbrauchbar
  | 'E-MDL-COUNT' // Model-Loader: Modell-/Animationszähler unplausibel
  | 'W-MDL-NAME' // Model-Loader: Dateifeld ohne verwertbaren Modellnamen
  | 'W-MDL-SCALE'; // Model-Loader: Skalatext nicht als Zahl lesbar

export type FieldSeverity = 'fatal' | 'error' | 'warning';

export interface FieldDiagnostic {
  code: FieldDiagnosticCode;
  severity: FieldSeverity;
  field: string;
  /** 1-basierte Sektionsnummer, falls sektionsbezogen. */
  section?: number;
  detail: string;
}

export function fieldSeverity(code: FieldDiagnosticCode): FieldSeverity {
  if (code === 'E-FLD-HDR') return 'fatal';
  return code.startsWith('E-') ? 'error' : 'warning';
}

export function fdiag(
  code: FieldDiagnosticCode,
  field: string,
  detail: string,
  section?: number,
): FieldDiagnostic {
  return {
    code,
    severity: fieldSeverity(code),
    field,
    detail,
    ...(section !== undefined ? { section } : {}),
  };
}
