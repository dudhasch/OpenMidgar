import type { ByteSource } from './byte-source.js';
import { checkByteDeviation, formatCheckByte } from './check-byte.js';
import {
  CONFLICT_DIR_LEN,
  CREATOR_LEN,
  DATA_PREFIX_LEN,
  HEADER_LEN,
  LOOKUP_DIM,
  LOOKUP_ENTRY_LEN,
  LOOKUP_TABLE_LEN,
  MAX_FILE_COUNT,
  NAME_LEN,
  TERMINATOR,
  TOC_ENTRY_LEN,
} from './constants.js';
import { diag, type LgpDiagnostic } from './diagnostics.js';
import type { ArchiveIndexData, LgpEntry, LgpScanResult } from './index-model.js';
import { canonicalId, decodeRawName, lookupBucket, normalizeName } from './names.js';

export interface ScanOptions {
  /**
   * 'fast': Header+TOC+Lookup+Konflikte; Längen/Kreuzchecks lazy beim Zugriff.
   * 'deep': zusätzlich Datenvorsatz-Kreuzcheck je Eintrag + Overlap-Sweep.
   */
  mode?: 'fast' | 'deep';
  signal?: AbortSignal | undefined;
  /** Vorberechneter Quell-Fingerprint (sonst leerer String). */
  fingerprint?: string;
  /**
   * Opt-in: den „Check-Code" gegen die in O5 gemessene Invariante prüfen
   * (W-LGP-CHECKBYTE, rein warnend, quarantänisiert nichts).
   *
   * Standardmäßig **aus**. Die Invariante ist über einen Bestand gemessen,
   * nicht aus dem Format hergeleitet — sie darf Importe nicht scheitern
   * lassen. Sinnvoll für Mod-Werkzeuge und Archivprüfungen, wo eine
   * zusätzliche Fehlererkennung mehr wert ist als Toleranz.
   */
  validateCheckByte?: boolean;
}

interface RawToc {
  rawName: string;
  offset: number;
  checkByte: number;
  conflictIndex: number;
}

/** Scannt ein LGP-Archiv zu einem persistierbaren Index (Masterplan Phase 1.1). */
export async function scanLgp(
  source: ByteSource,
  archiveName: string,
  opts: ScanOptions = {},
): Promise<LgpScanResult> {
  const mode = opts.mode ?? 'fast';
  const { signal } = opts;
  const diagnostics: LgpDiagnostic[] = [];
  const arc = archiveName.toLowerCase();

  // --- Header ---------------------------------------------------------------
  if (source.size < HEADER_LEN) {
    diagnostics.push(diag('E-LGP-HDR', arc, `Datei kleiner als Header (${source.size} B)`));
    return { ok: false, diagnostics };
  }
  const header = await source.read(0, HEADER_LEN, signal);
  const creator = header.subarray(0, CREATOR_LEN);
  // Plausibilität: Creator-Feld ist NUL-Polsterung + druckbares ASCII.
  let printable = 0;
  for (const b of creator) {
    if (b === 0) continue;
    if (b < 0x20 || b > 0x7e) {
      diagnostics.push(diag('E-LGP-HDR', arc, 'Creator-Feld enthält nicht-druckbare Bytes'));
      return { ok: false, diagnostics };
    }
    printable++;
  }
  if (printable === 0) {
    diagnostics.push(diag('E-LGP-HDR', arc, 'Creator-Feld leer'));
    return { ok: false, diagnostics };
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const entryCount = view.getUint32(CREATOR_LEN, true);
  if (entryCount === 0 || entryCount > MAX_FILE_COUNT) {
    diagnostics.push(diag('E-LGP-HDR', arc, `Dateianzahl unplausibel: ${entryCount}`));
    return { ok: false, diagnostics };
  }
  const tocEnd = HEADER_LEN + entryCount * TOC_ENTRY_LEN;
  if (tocEnd + LOOKUP_TABLE_LEN > source.size) {
    diagnostics.push(
      diag('E-LGP-HDR', arc, `TOC+Lookup (${tocEnd + LOOKUP_TABLE_LEN} B) überschreitet Dateigröße`),
    );
    return { ok: false, diagnostics };
  }

  // --- TOC ------------------------------------------------------------------
  const tocBytes = await source.read(HEADER_LEN, entryCount * TOC_ENTRY_LEN, signal);
  const tocView = new DataView(tocBytes.buffer, tocBytes.byteOffset, tocBytes.byteLength);
  const rawToc: RawToc[] = [];
  for (let i = 0; i < entryCount; i++) {
    const base = i * TOC_ENTRY_LEN;
    rawToc.push({
      rawName: decodeRawName(tocBytes.subarray(base, base + NAME_LEN)),
      offset: tocView.getUint32(base + NAME_LEN, true),
      checkByte: tocView.getUint8(base + NAME_LEN + 4),
      conflictIndex: tocView.getUint16(base + NAME_LEN + 5, true),
    });
  }

  // --- Einträge + Strukturvalidierung (E-LGP-TOC) ---------------------------
  const entries: LgpEntry[] = [];
  for (let i = 0; i < rawToc.length; i++) {
    const t = rawToc[i]!;
    const norm = normalizeName(t.rawName);
    if (norm.sanitized) {
      diagnostics.push(
        diag('W-LGP-NAME', arc, `Nicht-kanonische Zeichen bereinigt: ${JSON.stringify(t.rawName)}`, {
          entry: norm.canonical,
          tocIndex: i,
        }),
      );
    }
    const entry: LgpEntry = {
      canonicalId: canonicalId(arc, norm.canonical, t.conflictIndex),
      rawName: t.rawName,
      name: norm.canonical,
      tocIndex: i,
      offset: t.offset,
      checkByte: t.checkByte,
      conflictIndex: t.conflictIndex,
    };
    if (opts.validateCheckByte === true) {
      const abw = checkByteDeviation(norm.canonical, t.checkByte);
      if (abw) {
        diagnostics.push(
          diag(
            'W-LGP-CHECKBYTE',
            arc,
            abw.art === 'unbekannt'
              ? `Check-Code ${formatCheckByte(t.checkByte)} im Bestand nicht belegt (erwartet ${formatCheckByte(abw.erwartet)})`
              : `Check-Code ${formatCheckByte(t.checkByte)} passt nicht zur Eintragsart (erwartet ${formatCheckByte(abw.erwartet)})`,
            { entry: norm.canonical, tocIndex: i },
          ),
        );
      }
    }
    if (t.offset < tocEnd + LOOKUP_TABLE_LEN || t.offset + DATA_PREFIX_LEN > source.size) {
      entry.quarantined = true;
      entry.quarantineCode = 'E-LGP-TOC';
      diagnostics.push(
        diag('E-LGP-TOC', arc, `Offset ${t.offset} außerhalb des gültigen Bereichs`, {
          entry: norm.canonical,
          tocIndex: i,
        }),
      );
    }
    entries.push(entry);
  }

  // --- Duplikatauflösung (Masterplan 1.1, deterministische Reihenfolge) -----
  resolveDuplicates(entries, arc, diagnostics);

  // --- Lookup-Tabelle: strukturell lesen, gegen TOC reproduzieren -----------
  const lookupBytes = await source.read(tocEnd, LOOKUP_TABLE_LEN, signal);
  const lookupReproducible = verifyLookup(lookupBytes, entries, arc, diagnostics);

  // --- Konflikttabelle (best effort im Bereich Lookup-Ende..min. Offset) ----
  const conflictAreaStart = tocEnd + LOOKUP_TABLE_LEN;
  const minOffset = Math.min(
    source.size,
    ...entries.filter((e) => !e.quarantined).map((e) => e.offset),
  );
  await parseConflictTable(source, conflictAreaStart, minOffset, entries, arc, diagnostics, signal);

  // --- Terminator -----------------------------------------------------------
  const termBytes = await source.read(
    Math.max(0, source.size - TERMINATOR.length),
    Math.min(TERMINATOR.length, source.size),
    signal,
  );
  const terminatorOk = asciiEquals(termBytes, TERMINATOR);
  if (!terminatorOk) {
    diagnostics.push(diag('W-LGP-TERM', arc, 'Terminator-Signatur fehlt oder weicht ab'));
  }

  // --- Deep Scan: Vorsatz-Kreuzcheck + Overlap-Sweep ------------------------
  if (mode === 'deep') {
    for (const e of entries) {
      if (e.quarantined) continue;
      signal?.throwIfAborted();
      const check = await readAndValidatePrefix(source, e, source.size, signal);
      if (check) {
        e.quarantined = true;
        e.quarantineCode = 'E-LGP-ENTRY';
        diagnostics.push(diag('E-LGP-ENTRY', arc, check, { entry: e.name, tocIndex: e.tocIndex }));
      }
    }
    overlapSweep(entries, arc, diagnostics);
  }

  const archive: ArchiveIndexData = {
    schemaVersion: 1,
    archiveName: arc,
    fingerprint: opts.fingerprint ?? '',
    fileSize: source.size,
    entryCount,
    entries,
    deepScanned: mode === 'deep',
    terminatorOk,
    lookupReproducible,
    diagnostics,
  };
  return { ok: true, archive, diagnostics };
}

/**
 * Liest den Datenvorsatz eines Eintrags, validiert Name+Länge (E-LGP-ENTRY)
 * und setzt length/dataOffset. Liefert Fehlerdetail oder null bei Erfolg.
 * Wird vom Deep Scan und vom lazy Zugriffs-Pfad (SliceReader) genutzt.
 */
export async function readAndValidatePrefix(
  source: ByteSource,
  entry: LgpEntry,
  fileSize: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const prefix = await source.read(entry.offset, DATA_PREFIX_LEN, signal);
  const prefixName = decodeRawName(prefix.subarray(0, NAME_LEN));
  const pView = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const length = pView.getUint32(NAME_LEN, true);
  if (normalizeName(prefixName).canonical !== entry.name) {
    return `Vorsatzname ${JSON.stringify(prefixName)} != TOC-Name ${JSON.stringify(entry.rawName)}`;
  }
  if (entry.offset + DATA_PREFIX_LEN + length > fileSize) {
    return `Payload-Länge ${length} überschreitet Dateiende`;
  }
  entry.length = length;
  entry.dataOffset = entry.offset + DATA_PREFIX_LEN;
  return null;
}

function resolveDuplicates(entries: LgpEntry[], arc: string, diagnostics: LgpDiagnostic[]): void {
  const byId = new Map<string, LgpEntry>();
  for (const e of entries) {
    if (e.quarantined) continue;
    const prev = byId.get(e.canonicalId);
    if (!prev) {
      byId.set(e.canonicalId, e);
      continue;
    }
    if (prev.offset === e.offset) {
      // TOC-Redundanz: identischer Datensatz doppelt gelistet.
      e.shadowed = true;
      diagnostics.push(
        diag('W-LGP-DUP-TOC', arc, `Name+Offset doppelt im TOC`, { entry: e.name, tocIndex: e.tocIndex }),
      );
    } else {
      // Gleicher Name, anderer Offset, kein Conflict-Index: letzter gewinnt
      // (🟡 Annahme über Original-Verhalten, Masterplan 1.1).
      prev.shadowed = true;
      byId.set(e.canonicalId, e);
      diagnostics.push(
        diag('W-LGP-SHADOWED', arc, `Eintrag durch späteren gleichnamigen verschattet`, {
          entry: prev.name,
          tocIndex: prev.tocIndex,
        }),
      );
    }
  }
}

function verifyLookup(
  lookupBytes: Uint8Array,
  entries: LgpEntry[],
  arc: string,
  diagnostics: LgpDiagnostic[],
): boolean {
  const view = new DataView(lookupBytes.buffer, lookupBytes.byteOffset, lookupBytes.byteLength);
  // Erwartete Buckets aus dem TOC reproduzieren (eigener Index ist maßgeblich).
  const expected = new Map<number, { start: number; count: number }>();
  for (const e of entries) {
    const b = lookupBucket(e.name);
    if (!b) continue;
    const key = b.row * LOOKUP_DIM + b.col;
    const cur = expected.get(key);
    if (!cur) expected.set(key, { start: e.tocIndex + 1, count: 1 });
    else {
      cur.start = Math.min(cur.start, e.tocIndex + 1);
      cur.count++;
    }
  }
  let mismatches = 0;
  for (let key = 0; key < LOOKUP_DIM * LOOKUP_DIM; key++) {
    const start = view.getUint16(key * LOOKUP_ENTRY_LEN, true);
    const count = view.getUint16(key * LOOKUP_ENTRY_LEN + 2, true);
    const exp = expected.get(key);
    if (exp) {
      if (start !== exp.start || count !== exp.count) mismatches++;
    } else if (start !== 0 || count !== 0) {
      mismatches++;
    }
  }
  if (mismatches > 0) {
    diagnostics.push(
      diag(
        'W-LGP-LOOKUP',
        arc,
        `Lookup-Tabelle in ${mismatches} Buckets nicht aus TOC reproduzierbar (eigener Index maßgeblich)`,
      ),
    );
    return false;
  }
  return true;
}

async function parseConflictTable(
  source: ByteSource,
  areaStart: number,
  areaEnd: number,
  entries: LgpEntry[],
  arc: string,
  diagnostics: LgpDiagnostic[],
  signal?: AbortSignal,
): Promise<void> {
  const hasConflicts = entries.some((e) => e.conflictIndex > 0);
  const gap = areaEnd - areaStart;
  if (gap < 2) {
    if (hasConflicts) {
      diagnostics.push(
        diag('W-LGP-CONFLICTTBL', arc, 'Conflict-Indizes im TOC, aber kein Platz für Konflikttabelle'),
      );
    }
    return;
  }
  try {
    const head = await source.read(areaStart, 2, signal);
    const groupCount = new DataView(head.buffer, head.byteOffset).getUint16(0, true);
    if (groupCount === 0) return;
    // Plausibilitätsgrenze: Tabelle muss in den Bereich vor dem ersten Datenoffset passen.
    if (groupCount > 256) throw new Error(`groupCount unplausibel: ${groupCount}`);
    let pos = areaStart + 2;
    const dirByToc = new Map<number, { dir: string; group: number }>();
    for (let g = 1; g <= groupCount; g++) {
      const cntBytes = await source.read(pos, 2, signal);
      const cnt = new DataView(cntBytes.buffer, cntBytes.byteOffset).getUint16(0, true);
      pos += 2;
      for (let i = 0; i < cnt; i++) {
        const rec = await source.read(pos, CONFLICT_DIR_LEN + 2, signal);
        const dir = decodeRawName(rec.subarray(0, CONFLICT_DIR_LEN));
        const tocIndex = new DataView(rec.buffer, rec.byteOffset).getUint16(CONFLICT_DIR_LEN, true);
        dirByToc.set(tocIndex, { dir, group: g });
        pos += CONFLICT_DIR_LEN + 2;
      }
      if (pos > areaEnd) throw new Error('Konflikttabelle überschreitet Datenbereich');
    }
    for (const e of entries) {
      const hit = dirByToc.get(e.tocIndex);
      if (hit) e.conflictDir = normalizeName(hit.dir).canonical;
    }
  } catch (err) {
    diagnostics.push(
      diag('W-LGP-CONFLICTTBL', arc, `Konflikttabelle unlesbar: ${(err as Error).message}`),
    );
  }
}

function overlapSweep(entries: LgpEntry[], arc: string, diagnostics: LgpDiagnostic[]): void {
  const usable = entries
    .filter((e) => !e.quarantined && e.length !== undefined)
    .sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1]!;
    const cur = usable[i]!;
    const prevEnd = prev.offset + DATA_PREFIX_LEN + (prev.length ?? 0);
    if (cur.offset < prevEnd) {
      diagnostics.push(
        diag('W-LGP-OVERLAP', arc, `Datenbereiche überlappen: ${prev.name} ↔ ${cur.name}`, {
          entry: cur.name,
          tocIndex: cur.tocIndex,
        }),
      );
    }
  }
}

function asciiEquals(bytes: Uint8Array, text: string): boolean {
  if (bytes.length !== text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}
