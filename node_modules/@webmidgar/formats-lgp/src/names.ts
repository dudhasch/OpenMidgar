import { LOOKUP_DIM } from './constants.js';

/**
 * Namensnormalisierung — verbindlicher Vertrag aus Masterplan Phase 1.1:
 * lowercase, nur [a-z0-9_.-], 20-Byte-Kürzung des Formats bleibt erhalten.
 */

export interface NormalizedName {
  /** Kanonischer Basisname (ohne Archiv-Namespace, ohne Konflikt-Diskriminator). */
  canonical: string;
  /** true, wenn Zeichen ersetzt werden mussten (→ W-LGP-NAME). */
  sanitized: boolean;
}

/** Dekodiert ein NUL-gepolstertes 20-Byte-Namensfeld bis zum ersten NUL. */
export function decodeRawName(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let s = '';
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

const CANONICAL_RE = /^[a-z0-9_.-]*$/;

export function normalizeName(raw: string): NormalizedName {
  const lower = raw.toLowerCase();
  if (CANONICAL_RE.test(lower)) return { canonical: lower, sanitized: false };
  let out = '';
  for (const ch of lower) out += CANONICAL_RE.test(ch) ? ch : '_';
  return { canonical: out, sanitized: true };
}

/** Kanonischer Asset-Identifier: `lgp:<archiv>/<name>[#c<n>]`. */
export function canonicalId(archive: string, name: string, conflictIndex = 0): string {
  const base = `lgp:${archive.toLowerCase()}/${name}`;
  return conflictIndex > 0 ? `${base}#c${conflictIndex}` : base;
}

/**
 * Bucket-Wertfunktion der Lookup-Tabelle.
 * Zu validieren (🟡, Masterplan R-Lookup): Abbildung an Referenzimplementierungen
 * angelehnt — Ziffern werden in den Buchstabenbereich gefaltet, '_' und '-' auf
 * feste Buchstabenwerte gelegt. Der eigene TOC-Index bleibt maßgeblich; gegen
 * Realarchive wird die Tabelle nur warnend (W-LGP-LOOKUP) geprüft.
 */
export function lookupCharValue(ch: string): number {
  const c = ch.toLowerCase();
  if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 97;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48; // '0'→'a'-Faltung
  if (c === '_') return 'k'.charCodeAt(0) - 97;
  if (c === '-') return 'l'.charCodeAt(0) - 97;
  return -1;
}

/**
 * Bucket (row, col) eines Namens; null = nicht bucketbar (landet nicht in der
 * Lookup-Tabelle, bleibt aber über den TOC-Index auflösbar).
 * col 0 ist reserviert für "kein zweites Zeichen / Trenner".
 */
export function lookupBucket(name: string): { row: number; col: number } | null {
  if (name.length === 0) return null;
  const row = lookupCharValue(name[0]!);
  if (row < 0 || row >= LOOKUP_DIM) return null;
  let col = 0;
  if (name.length > 1 && name[1] !== '.') {
    const v = lookupCharValue(name[1]!);
    if (v < 0 || v + 1 >= LOOKUP_DIM) return null;
    col = v + 1;
  }
  return { row, col };
}
