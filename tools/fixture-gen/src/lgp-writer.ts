import {
  CONFLICT_DIR_LEN,
  CREATOR_DEFAULT,
  CREATOR_LEN,
  DATA_PREFIX_LEN,
  HEADER_LEN,
  LOOKUP_DIM,
  LOOKUP_ENTRY_LEN,
  LOOKUP_TABLE_LEN,
  NAME_LEN,
  TERMINATOR,
  TOC_ENTRY_LEN,
  lookupBucket,
} from '@webmidgar/formats-lgp';

/**
 * Eigenständiger LGP-Writer für Golden Fixtures (Masterplan-Grundsatz:
 * Fixtures sind selbst erzeugte Minimaldaten, nie Originaldaten im Repo).
 * Der Writer teilt KEINEN Code mit dem Scanner — Roundtrip-Tests prüfen
 * dadurch zwei unabhängige Implementierungen desselben Formatverständnisses.
 */

export interface LgpFixtureEntry {
  name: string;
  data: Uint8Array;
  /** >0 aktiviert Konfliktgruppen-Mitgliedschaft (gleichnamige Einträge). */
  conflictIndex?: number;
  /** Quellordner-Diskriminator für die Konflikttabelle. */
  conflictDir?: string;
  /** Überschreibt den Check-Code (sonst: Regel unten). Für Defekt-Fixtures. */
  checkByte?: number;
}

export interface LgpFixtureSpec {
  creator?: string;
  entries: LgpFixtureEntry[];
  /** 'zero' schreibt u16 0 vor dem Datenbereich; 'omit' lässt die Tabelle ganz weg. */
  emptyConflictField?: 'zero' | 'omit';
  omitTerminator?: boolean;
}

export interface LgpFixtureLayout {
  bytes: Uint8Array;
  tocStart: number;
  lookupStart: number;
  conflictStart: number;
  /** Absoluter Offset des Datenvorsatzes je Eintrag (in Spec-Reihenfolge nach Sortierung). */
  entryOffsets: number[];
  /** Sortierte Eintragsreihenfolge, wie sie im TOC gelandet ist. */
  order: LgpFixtureEntry[];
}

function putAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}

/**
 * Check-Code des TOC-Records — **Zweitimplementierung** der in O5 gemessenen
 * Invariante (0x0B genau auf `.hrc`, sonst 0x0E; 45.563 Einträge, 56 Archive,
 * kein Gegenbeispiel). Bewusst hier ausgeschrieben statt aus dem Paket
 * importiert: Der Writer darf mit dem Scanner keinen Code teilen, sonst prüft
 * der Roundtrip nur noch sich selbst.
 */
function fixtureCheckByte(name: string): number {
  return name.toLowerCase().endsWith('.hrc') ? 0x0b : 0x0e;
}

export function buildLgp(spec: LgpFixtureSpec): LgpFixtureLayout {
  // Bucket-kontige TOC-Reihenfolge, damit die Lookup-Tabelle konstruierbar ist.
  const order = [...spec.entries].sort((a, b) => {
    const ba = lookupBucket(a.name.toLowerCase());
    const bb = lookupBucket(b.name.toLowerCase());
    const ka = ba ? ba.row * LOOKUP_DIM + ba.col : Number.MAX_SAFE_INTEGER;
    const kb = bb ? bb.row * LOOKUP_DIM + bb.col : Number.MAX_SAFE_INTEGER;
    return ka - kb || a.name.localeCompare(b.name);
  });

  const n = order.length;
  const tocStart = HEADER_LEN;
  const lookupStart = tocStart + n * TOC_ENTRY_LEN;
  const conflictStart = lookupStart + LOOKUP_TABLE_LEN;

  // Konflikttabelle serialisieren.
  const groups = new Map<number, { dir: string; tocIndex: number }[]>();
  order.forEach((e, tocIndex) => {
    if ((e.conflictIndex ?? 0) > 0) {
      const g = groups.get(e.conflictIndex!) ?? [];
      g.push({ dir: e.conflictDir ?? '', tocIndex });
      groups.set(e.conflictIndex!, g);
    }
  });
  let conflictBytes: Uint8Array;
  if (groups.size > 0) {
    const maxGroup = Math.max(...groups.keys());
    let len = 2;
    for (let g = 1; g <= maxGroup; g++) len += 2 + (groups.get(g)?.length ?? 0) * (CONFLICT_DIR_LEN + 2);
    conflictBytes = new Uint8Array(len);
    const cv = new DataView(conflictBytes.buffer);
    cv.setUint16(0, maxGroup, true);
    let pos = 2;
    for (let g = 1; g <= maxGroup; g++) {
      const members = groups.get(g) ?? [];
      cv.setUint16(pos, members.length, true);
      pos += 2;
      for (const m of members) {
        putAscii(conflictBytes, pos, m.dir.slice(0, CONFLICT_DIR_LEN - 1));
        cv.setUint16(pos + CONFLICT_DIR_LEN, m.tocIndex, true);
        pos += CONFLICT_DIR_LEN + 2;
      }
    }
  } else {
    conflictBytes = (spec.emptyConflictField ?? 'zero') === 'zero' ? new Uint8Array(2) : new Uint8Array(0);
  }

  const dataStart = conflictStart + conflictBytes.length;
  const entryOffsets: number[] = [];
  let cursor = dataStart;
  for (const e of order) {
    entryOffsets.push(cursor);
    cursor += DATA_PREFIX_LEN + e.data.length;
  }
  const terminator = spec.omitTerminator ? '' : TERMINATOR;
  const total = cursor + terminator.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  // Header
  const creator = spec.creator ?? CREATOR_DEFAULT;
  putAscii(bytes, CREATOR_LEN - creator.length, creator); // rechtsbündig, NUL-gepolstert
  view.setUint32(CREATOR_LEN, n, true);

  // TOC
  order.forEach((e, i) => {
    const base = tocStart + i * TOC_ENTRY_LEN;
    putAscii(bytes, base, e.name.slice(0, NAME_LEN));
    view.setUint32(base + NAME_LEN, entryOffsets[i]!, true);
    view.setUint8(base + NAME_LEN + 4, e.checkByte ?? fixtureCheckByte(e.name));
    view.setUint16(base + NAME_LEN + 5, e.conflictIndex ?? 0, true);
  });

  // Lookup-Tabelle
  const buckets = new Map<number, { start: number; count: number }>();
  order.forEach((e, i) => {
    const b = lookupBucket(e.name.toLowerCase());
    if (!b) return;
    const key = b.row * LOOKUP_DIM + b.col;
    const cur = buckets.get(key);
    if (!cur) buckets.set(key, { start: i + 1, count: 1 });
    else cur.count++;
  });
  for (const [key, { start, count }] of buckets) {
    view.setUint16(lookupStart + key * LOOKUP_ENTRY_LEN, start, true);
    view.setUint16(lookupStart + key * LOOKUP_ENTRY_LEN + 2, count, true);
  }

  bytes.set(conflictBytes, conflictStart);

  // Datenbereich
  order.forEach((e, i) => {
    const off = entryOffsets[i]!;
    putAscii(bytes, off, e.name.slice(0, NAME_LEN));
    view.setUint32(off + NAME_LEN, e.data.length, true);
    bytes.set(e.data, off + DATA_PREFIX_LEN);
  });

  if (terminator) putAscii(bytes, total - terminator.length, terminator);

  return { bytes, tocStart, lookupStart, conflictStart, entryOffsets, order };
}

// ---------------------------------------------------------------------------
// Gezielte Defekt-Mutationen für die Fehlerklassen der Validierungsmatrix.
// Mutieren die Bytes eines validen Fixtures in-place (auf einer Kopie).
// ---------------------------------------------------------------------------

export function corruptCreator(layout: LgpFixtureLayout): Uint8Array {
  const bytes = layout.bytes.slice();
  bytes[0] = 0x01; // nicht-druckbar → E-LGP-HDR
  return bytes;
}

export function corruptFileCount(layout: LgpFixtureLayout, count: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(CREATOR_LEN, count, true);
  return bytes;
}

export function corruptTocOffset(layout: LgpFixtureLayout, tocIndex: number, offset: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(layout.tocStart + tocIndex * TOC_ENTRY_LEN + NAME_LEN, offset, true);
  return bytes;
}

/** Zerstört den Vorsatznamen eines Eintrags → E-LGP-ENTRY im Deep Scan. */
export function corruptPrefixName(layout: LgpFixtureLayout, entryIndex: number): Uint8Array {
  const bytes = layout.bytes.slice();
  putAscii(bytes, layout.entryOffsets[entryIndex]!, 'zzzzmismatch');
  return bytes;
}

/** Bläht die Vorsatzlänge eines Eintrags über das Dateiende → E-LGP-ENTRY. */
export function corruptPrefixLength(layout: LgpFixtureLayout, entryIndex: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(layout.entryOffsets[entryIndex]! + NAME_LEN, 0x7fffffff, true);
  return bytes;
}

/** Lässt Eintrag B in den Datenbereich von Eintrag A zeigen → W-LGP-OVERLAP. */
export function corruptOverlap(layout: LgpFixtureLayout, tocIndexA: number, tocIndexB: number): Uint8Array {
  const bytes = layout.bytes.slice();
  const view = new DataView(bytes.buffer);
  const offsetA = layout.entryOffsets[tocIndexA]!;
  // B-Offset mitten in As Payload legen (hinter dessen Vorsatz, damit As
  // Vorsatzname intakt bleibt) und dort einen gültigen Vorsatz mit B-Namen platzieren.
  const overlapOffset = offsetA + DATA_PREFIX_LEN + 4;
  const nameB = layout.order[tocIndexB]!.name;
  view.setUint32(layout.tocStart + tocIndexB * TOC_ENTRY_LEN + NAME_LEN, overlapOffset, true);
  putAscii(bytes, overlapOffset, nameB.slice(0, NAME_LEN));
  for (let i = nameB.length; i < NAME_LEN; i++) bytes[overlapOffset + i] = 0;
  view.setUint32(overlapOffset + NAME_LEN, 8, true);
  return bytes;
}

export function corruptLookup(layout: LgpFixtureLayout): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint16(layout.lookupStart, 0xbeef, true);
  return bytes;
}

/** Setzt den Conflict-Index eines TOC-Records → Konflikttabellen-Pfade testbar. */
export function setTocConflictIndex(layout: LgpFixtureLayout, tocIndex: number, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint16(layout.tocStart + tocIndex * TOC_ENTRY_LEN + NAME_LEN + 5, value, true);
  return bytes;
}

/** Setzt den Check-Code eines TOC-Records → W-LGP-CHECKBYTE (opt-in). */
export function setTocCheckByte(layout: LgpFixtureLayout, tocIndex: number, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint8(layout.tocStart + tocIndex * TOC_ENTRY_LEN + NAME_LEN + 4, value);
  return bytes;
}

/** Zerstört den Gruppenzähler der Konflikttabelle → W-LGP-CONFLICTTBL. */
export function corruptConflictCount(layout: LgpFixtureLayout, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint16(layout.conflictStart, value, true);
  return bytes;
}

/** Dupliziert den TOC-Record von `src` an Position `dst` (Name+Offset identisch). */
export function duplicateTocRecord(layout: LgpFixtureLayout, src: number, dst: number): Uint8Array {
  const bytes = layout.bytes.slice();
  const from = layout.tocStart + src * TOC_ENTRY_LEN;
  const to = layout.tocStart + dst * TOC_ENTRY_LEN;
  bytes.copyWithin(to, from, from + TOC_ENTRY_LEN);
  return bytes;
}

/** Kopiert nur den Namen von `src` nach `dst` (Offsets bleiben verschieden) → Shadowing. */
export function duplicateTocName(layout: LgpFixtureLayout, src: number, dst: number): Uint8Array {
  const bytes = layout.bytes.slice();
  const from = layout.tocStart + src * TOC_ENTRY_LEN;
  const to = layout.tocStart + dst * TOC_ENTRY_LEN;
  bytes.copyWithin(to, from, from + NAME_LEN);
  // Der Vorsatzname am dst-Offset muss mitziehen, sonst greift E-LGP-ENTRY statt Shadowing.
  const dstOffset = new DataView(bytes.buffer).getUint32(to + NAME_LEN, true);
  bytes.copyWithin(dstOffset, from, from + NAME_LEN);
  return bytes;
}
