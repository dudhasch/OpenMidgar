import { HEADER_LEN, TOC_ENTRY_LEN, CREATOR_LEN, MAX_FILE_COUNT } from '@webmidgar/formats-lgp';
import type { SourceFile } from './sources.js';

/**
 * Quell-Fingerprinting (Masterplan Phase 1.1 / ADR-008):
 * Archiv-Fingerprint = SHA-256 über (Pfad, Größe, mtime, TOC-Bytes).
 * Der Fingerprint ist der S0-Cache-Key; jede Quelländerung erzwingt Rescan.
 */

async function sha256Hex(parts: Uint8Array[]): Promise<string> {
  let total = 0;
  for (const p of parts) total += p.length;
  const joined = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    joined.set(p, pos);
    pos += p.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', joined as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function metaBytes(file: SourceFile): Uint8Array {
  const enc = new TextEncoder().encode(file.path);
  const out = new Uint8Array(enc.length + 16);
  out.set(enc, 0);
  const view = new DataView(out.buffer);
  view.setFloat64(enc.length, file.size, true);
  view.setFloat64(enc.length + 8, file.lastModified, true);
  return out;
}

/**
 * Liest Header+TOC (billig, wenige hundert KB max.) und bildet den Fingerprint.
 * Bei strukturell unlesbarem Header fällt der TOC-Anteil weg — der Fingerprint
 * bleibt definiert (Metadaten), das Archiv wird aber ohnehin E-LGP-HDR-fatal.
 */
export async function archiveFingerprint(file: SourceFile, signal?: AbortSignal): Promise<string> {
  const parts: Uint8Array[] = [metaBytes(file)];
  if (file.size >= HEADER_LEN) {
    const header = await file.read(0, HEADER_LEN, signal);
    parts.push(header);
    const count = new DataView(header.buffer, header.byteOffset).getUint32(CREATOR_LEN, true);
    const tocLen = count * TOC_ENTRY_LEN;
    if (count > 0 && count <= MAX_FILE_COUNT && HEADER_LEN + tocLen <= file.size) {
      parts.push(await file.read(HEADER_LEN, tocLen, signal));
    }
  }
  return sha256Hex(parts);
}

/** Quellen-Fingerprint = SHA-256 über die sortierten Archiv-Fingerprints. */
export async function sourceFingerprint(archiveFps: string[]): Promise<string> {
  const enc = new TextEncoder();
  return sha256Hex([...archiveFps].sort().map((fp) => enc.encode(fp)));
}
