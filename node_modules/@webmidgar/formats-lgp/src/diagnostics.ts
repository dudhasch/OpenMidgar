/** Typisierte Fehlerklassen laut Import-Validierungsmatrix (Masterplan Phase 1.5). */

export type LgpDiagnosticCode =
  | 'E-LGP-HDR' // Header unplausibel — Archiv fatal
  | 'E-LGP-TOC' // TOC-Eintrag strukturell ungültig — Eintrag quarantänisiert
  | 'E-LGP-ENTRY' // Datenvorsatz-Kreuzcheck fehlgeschlagen — Eintrag quarantänisiert
  | 'W-LGP-OVERLAP' // Datenbereiche überlappen — Warnung, Einträge nutzbar
  | 'W-LGP-TERM' // Terminator fehlt/abweichend — nur Diagnose
  | 'W-LGP-LOOKUP' // Lookup-Tabelle nicht aus TOC reproduzierbar — eigener Index maßgeblich
  | 'W-LGP-CONFLICTTBL' // Konflikttabelle unlesbar — Konfliktauflösung degradiert
  | 'W-LGP-DUP-TOC' // Name+Offset doppelt im TOC — redundanter Eintrag verworfen
  | 'W-LGP-SHADOWED' // Name doppelt ohne Conflict-Index — früherer Eintrag verschattet
  | 'W-LGP-NAME'; // Nicht-kanonische Zeichen im Namen — bereinigt

export type DiagnosticSeverity = 'fatal' | 'error' | 'warning';

export interface LgpDiagnostic {
  code: LgpDiagnosticCode;
  severity: DiagnosticSeverity;
  archive: string;
  /** Kanonischer Name des betroffenen Eintrags, falls eintragsbezogen. */
  entry?: string;
  /** TOC-Index des betroffenen Eintrags, falls eintragsbezogen. */
  tocIndex?: number;
  detail: string;
}

export function severityOf(code: LgpDiagnosticCode): DiagnosticSeverity {
  if (code === 'E-LGP-HDR') return 'fatal';
  return code.startsWith('E-') ? 'error' : 'warning';
}

export function diag(
  code: LgpDiagnosticCode,
  archive: string,
  detail: string,
  extra?: { entry?: string; tocIndex?: number },
): LgpDiagnostic {
  return { code, severity: severityOf(code), archive, detail, ...extra };
}
