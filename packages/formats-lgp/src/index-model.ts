import type { LgpDiagnostic } from './diagnostics.js';

/** Persistierbares Indexmodell (Cache-Stufe S0) — reine Daten, JSON-serialisierbar. */

export interface LgpEntry {
  canonicalId: string;
  /** Roh dekodierter (unbereinigter) Name aus dem TOC. */
  rawName: string;
  /** Kanonischer Basisname ohne Namespace/Diskriminator. */
  name: string;
  tocIndex: number;
  /** Absoluter Offset des Datenvorsatzes (name[20]+u32 len). */
  offset: number;
  /** Payload-Länge; erst nach Deep Scan oder erstem Zugriff bekannt. */
  length?: number;
  /** Absoluter Payload-Offset (= offset + DATA_PREFIX_LEN), gesetzt mit length. */
  dataOffset?: number;
  checkByte: number;
  conflictIndex: number;
  /** Quellordner-Diskriminator aus der Konflikttabelle, falls auflösbar. */
  conflictDir?: string;
  quarantined?: boolean;
  quarantineCode?: 'E-LGP-TOC' | 'E-LGP-ENTRY';
  /** Durch späteren gleichnamigen Eintrag verdrängt (letzter gewinnt). */
  shadowed?: boolean;
}

export interface ArchiveIndexData {
  schemaVersion: 1;
  archiveName: string;
  /** Fingerprint der Quelle (Größe + mtime + TOC-Hash), Cache-Key in S0. */
  fingerprint: string;
  fileSize: number;
  entryCount: number;
  entries: LgpEntry[];
  /** true, wenn Deep Scan lief (Längen + Kreuzchecks + Overlap-Sweep). */
  deepScanned: boolean;
  terminatorOk: boolean;
  lookupReproducible: boolean;
  diagnostics: LgpDiagnostic[];
}

export interface LgpScanResult {
  /** false nur bei E-LGP-HDR (Archiv unbrauchbar). */
  ok: boolean;
  archive?: ArchiveIndexData;
  diagnostics: LgpDiagnostic[];
}

/** Auflösungssicht: nur nutzbare (nicht quarantänisierte/verschattete) Einträge. */
export function resolvableEntries(a: ArchiveIndexData): LgpEntry[] {
  return a.entries.filter((e) => !e.quarantined && !e.shadowed);
}
