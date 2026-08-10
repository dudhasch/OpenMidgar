/**
 * Öffentliche Verträge des Steam-Lizenznachweis-Clients.
 * Das Ergebnis ist ein Verifizierungs-Badge — keine harte Sperre.
 */
export type LicenseProofStatus = 'verified' | 'not-owned' | 'unverifiable' | 'error' | 'cancelled';

export interface LicenseProofResult {
  status: LicenseProofStatus;
  appid?: number;
  method?: 'check-app-ownership' | 'owned-games';
  verifiedAt?: string;
  error?: string;
}

export type LicenseFlowState = 'idle' | 'awaiting-popup' | 'awaiting-result' | 'done';
