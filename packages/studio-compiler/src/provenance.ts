/**
 * Provenienz-Schleuse (B.7, ADR-017, A-ST-3): Dateiimporte nach
 * `assets/` werden per SHA-256 gegen den Archiv-Index der lokalen
 * Installation (bekannte Original-Hashes) geprüft. Ein byteidentischer
 * Treffer wird verweigert — Originalbytes sind in Paketen strukturell
 * nicht transportierbar; Originalinhalte werden ausschließlich über
 * kanonische IDs referenziert.
 */

import { sha256Hex } from './hash.js';

export interface AssetImportErgebnis {
  /** true = Import zulässig (kein byteidentischer Originaltreffer). */
  erlaubt: boolean;
  /** SHA-256-Hex-Digest der importierten Bytes (immer berechnet). */
  sha256: string;
  /** Erklärtext bei Verweigerung. */
  meldung?: string | undefined;
}

/**
 * Prüft einen Asset-Import gegen die Menge bekannter Original-Hashes.
 * Byteidentischer Treffer → Verweigerung mit Erklärtext.
 */
export async function pruefeAssetImport(
  bytes: Uint8Array,
  bekannteOriginalHashes: ReadonlySet<string>,
): Promise<AssetImportErgebnis> {
  const sha256 = await sha256Hex(bytes);
  if (bekannteOriginalHashes.has(sha256)) {
    return {
      erlaubt: false,
      sha256,
      meldung:
        `Import verweigert: Die Datei ist byteidentisch mit einem Originalinhalt ` +
        `(sha256 ${sha256}). Originalassets werden niemals in ein Paket kopiert (B.7) — ` +
        `referenziere stattdessen die kanonische ID des Originals (lgp:…).`,
    };
  }
  return { erlaubt: true, sha256 };
}
