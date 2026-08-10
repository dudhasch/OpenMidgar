/**
 * Gemeinsame Typen für den Steam-Besitznachweis (Stufe 2 des Lizenzkonzepts,
 * siehe docs/STEAM-LIZENZNACHWEIS.md). Framework-frei, DOM-frei — der Client
 * injiziert seine Umgebungszugriffe.
 */

export type LicenseProofStatus =
  /** Relay hat Besitz für mindestens eine konfigurierte AppID bestätigt. */
  | 'verified'
  /** Steam-Login ok, aber Besitz nicht nachweisbar (nicht vorhanden oder Profil privat). */
  | 'not-owned'
  /** Login hat nicht geklappt bzw. Ergebnis ist nicht verfügbar (Timeout, Nutzer-Abbruch seitens Steam). */
  | 'unverifiable'
  /** Technischer Fehler (Relay nicht erreichbar, Protokollbruch, ungültige Konfiguration). */
  | 'error'
  /** Der Nutzer hat den Flow in der App abgebrochen. */
  | 'cancelled';

export type LicenseProofMethod = 'check-app-ownership' | 'owned-games';

export interface LicenseProofResult {
  status: LicenseProofStatus;
  /** Geprüfte AppID, wenn der Status aus einer echten Prüfung stammt. */
  appid?: number;
  /** Welcher Steam-API-Pfad geprüft hat (nur bei verified/not-owned). */
  method?: LicenseProofMethod;
  /** ISO-Zeitpunkt der Verifizierung (Serverzeit des Relays). */
  verifiedAt?: string;
  /** Maschinenlesbarer Fehlercode bei status error/unverifiable. */
  error?: string;
}

/** Zustandsautomat des Clients — für UI-Anzeige (Badge „prüfe…"). */
export type LicenseFlowState = 'idle' | 'awaiting-popup' | 'awaiting-result' | 'done';
