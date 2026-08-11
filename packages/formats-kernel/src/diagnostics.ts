/**
 * Fehlerklassen des Kernel-Pfads (S13). Gleiche Politik wie in den übrigen
 * Formatpaketen: Eine defekte Sektion quarantäniert sich selbst, der Rest
 * bleibt nutzbar — Abbruch nur, wenn der Container als Ganzes unbrauchbar ist.
 */

export type KernelDiagnosticCode =
  | 'E-KRN-HDR' // Container-Kopf unbrauchbar — Datei fatal
  | 'E-KRN-ACCOUNT' // Summe der Sektionslängen passt nicht zur Dateigröße
  | `E-KRN-SEC${number}` // Sektion n quarantänisiert
  | 'E-KRN-GZIP' // gzip-Strom einer Sektion defekt
  | 'E-KRN-RECORD' // Record-Accounting einer Datensektion geht nicht auf
  | 'E-WIN-ACCOUNT' // WINDOW.BIN: Sektionslängen füllen die Datei nicht byteexakt
  | 'E-WIN-SECTIONS' // WINDOW.BIN: unerwartete Sektionsanzahl
  | 'E-WIN-WIDTHS' // WINDOW.BIN: Breitensektion zu kurz für 256 Einträge
  | 'W-WIN-TIM' // WINDOW.BIN: TIM-Block einer Bildsektion unplausibel
  | 'W-KRN-TEXT'; // Textsektion enthält unbekannte Codepunkte

export type KernelSeverity = 'fatal' | 'error' | 'warning';

export interface KernelDiagnostic {
  code: KernelDiagnosticCode;
  severity: KernelSeverity;
  asset: string;
  section?: number;
  detail: string;
}

export function kernelSeverity(code: KernelDiagnosticCode): KernelSeverity {
  if (code === 'E-KRN-HDR' || code === 'E-KRN-ACCOUNT' || code === 'E-WIN-ACCOUNT') return 'fatal';
  return code.startsWith('E-') ? 'error' : 'warning';
}

export function kdiag(
  code: KernelDiagnosticCode,
  asset: string,
  detail: string,
  section?: number,
): KernelDiagnostic {
  return {
    code,
    severity: kernelSeverity(code),
    asset,
    detail,
    ...(section !== undefined ? { section } : {}),
  };
}
