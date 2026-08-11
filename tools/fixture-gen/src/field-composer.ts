import {
  CAM_RECORD_LEN,
  SCR_ENTRIES_PER_ENTITY,
  SCR_ENTITY_NAME_LEN,
  SCR_HEADER_LEN,
  TRG_BG_PARAMS_LEN,
  TRG_GATEWAY_COUNT,
  TRG_GATEWAY_LEN,
  TRG_HEADER_LEN,

  TRG_NAME_LEN,
  TRG_SECTION_LEN,
  TRG_TRIGGER_COUNT,
  TRG_TRIGGER_LEN,
  WM_ACCESS_LEN,
  WM_BLOCKED,
  WM_TRIANGLE_LEN,
  type Vec3,
} from '@webmidgar/formats-field';
import { compressLzsEntry } from './lzs-compress.js';
import { composeBackgroundSection, composePaletteSection } from './background-composer.js';
import { composeModelLoaderSection } from './model-loader-composer.js';

/**
 * Field-Composer für Golden Fixtures: baut dekomprimierte Field-Container
 * (und via compressLzsEntry komplette Archiveinträge) aus deklarativen Specs.
 * Layout-Wissen ist bewusst dupliziert zum Parser (unabhängige Implementierung).
 */

const putAscii = (target: Uint8Array, offset: number, text: string): void => {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
};

// --- Walkmesh ---------------------------------------------------------------

export interface WalkmeshSpec {
  triangles: { vertices: [Vec3, Vec3, Vec3]; adjacencyOverride?: [number | null, number | null, number | null] }[];
}

/**
 * Serialisiert ein Walkmesh; Adjazenz wird aus geteilten Kanten automatisch
 * berechnet (symmetrisch), sofern kein Override gesetzt ist.
 */
export function composeWalkmeshSection(spec: WalkmeshSpec): Uint8Array {
  const n = spec.triangles.length;
  const adjacency = computeAdjacency(spec);
  const bytes = new Uint8Array(4 + n * (WM_TRIANGLE_LEN + WM_ACCESS_LEN));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, n, true);
  spec.triangles.forEach((tri, t) => {
    tri.vertices.forEach((v, i) => {
      const o = 4 + t * WM_TRIANGLE_LEN + i * 8;
      view.setInt16(o, v[0], true);
      view.setInt16(o + 2, v[1], true);
      view.setInt16(o + 4, v[2], true);
      view.setInt16(o + 6, 0, true); // res
    });
    const aBase = 4 + n * WM_TRIANGLE_LEN + t * WM_ACCESS_LEN;
    adjacency[t]!.forEach((neighbor, e) => {
      view.setUint16(aBase + e * 2, neighbor === null ? WM_BLOCKED : neighbor, true);
    });
  });
  return bytes;
}

export function computeAdjacency(spec: WalkmeshSpec): (number | null)[][] {
  const edgeKey = (a: Vec3, b: Vec3): string => {
    const ka = a.join(','), kb = b.join(',');
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const edgeOwners = new Map<string, { tri: number; edge: number }[]>();
  spec.triangles.forEach((tri, t) => {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(tri.vertices[e]!, tri.vertices[(e + 1) % 3]!);
      const list = edgeOwners.get(key) ?? [];
      list.push({ tri: t, edge: e });
      edgeOwners.set(key, list);
    }
  });
  const adjacency: (number | null)[][] = spec.triangles.map(() => [null, null, null]);
  for (const owners of edgeOwners.values()) {
    if (owners.length === 2) {
      adjacency[owners[0]!.tri]![owners[0]!.edge] = owners[1]!.tri;
      adjacency[owners[1]!.tri]![owners[1]!.edge] = owners[0]!.tri;
    }
  }
  spec.triangles.forEach((tri, t) => {
    if (tri.adjacencyOverride) adjacency[t] = [...tri.adjacencyOverride];
  });
  return adjacency;
}

// --- Kamera -----------------------------------------------------------------

export interface CameraSpec {
  /** Achsvektoren als Floats; werden mit 4096 festkomma-quantisiert. */
  axes: [Vec3, Vec3, Vec3];
  position: Vec3;
  zoom: number;
}

export function composeCameraSection(cameras: CameraSpec[]): Uint8Array {
  const bytes = new Uint8Array(cameras.length * CAM_RECORD_LEN);
  const view = new DataView(bytes.buffer);
  cameras.forEach((cam, c) => {
    const base = c * CAM_RECORD_LEN;
    cam.axes.forEach((row, r) => {
      row.forEach((v, i) => view.setInt16(base + r * 6 + i * 2, Math.round(v * 4096), true));
    });
    view.setInt16(base + 18, Math.round(cam.axes[2]![2]! * 4096), true); // Wiederholungsfeld
    cam.position.forEach((v, i) => view.setInt32(base + 20 + i * 4, v, true));
    view.setUint32(base + 32, 0, true);
    view.setUint16(base + 36, cam.zoom, true); // Recordende: 38 Bytes (realdaten-validiert)
  });
  return bytes;
}

// --- Trigger ----------------------------------------------------------------

/**
 * Gateway-Spezifikation. Die Zielangaben heißen bewusst „Kandidat": ihre
 * Lage im 24-B-Record ist realdaten-seitig NICHT belegt (siehe
 * `sections/triggers.ts`). Der Composer schreibt sie an die aktuell
 * angenommenen Offsets, damit Roundtrips stabil sind — mehr behauptet er nicht.
 */
export interface GatewaySpec {
  exitLine: [Vec3, Vec3];
  destMaplistIndex: number;
}

export interface TriggerVolumeSpec {
  corners: [Vec3, Vec3];
  bgGroup?: number;
  bgFrame?: number;
  behavior?: number;
  soundId?: number;
}

export interface TriggersSpec {
  name: string;
  control?: number;
  cameraFocusHeight?: number;
  cameraRange?: [number, number, number, number];
  gateways?: GatewaySpec[];
  triggers?: TriggerVolumeSpec[];
}

export function composeTriggersSection(spec: TriggersSpec): Uint8Array {
  const bytes = new Uint8Array(TRG_SECTION_LEN);
  const view = new DataView(bytes.buffer);
  putAscii(bytes, 0, spec.name.slice(0, TRG_NAME_LEN - 1));
  view.setUint8(TRG_NAME_LEN, spec.control ?? 0);
  view.setInt16(TRG_NAME_LEN + 1, spec.cameraFocusHeight ?? 0, true);
  const range = spec.cameraRange ?? [0, 0, 0, 0];
  range.forEach((v, i) => view.setInt16(TRG_NAME_LEN + 3 + i * 2, v, true));
  // BG-Layer-Parameterblock bleibt 0 (roh konserviert, TRG_BG_PARAMS_LEN Bytes)
  void TRG_BG_PARAMS_LEN;

  const writeVec3 = (o: number, v: Vec3): void => {
    view.setInt16(o, v[0], true);
    view.setInt16(o + 2, v[1], true);
    view.setInt16(o + 4, v[2], true);
  };

  for (let g = 0; g < TRG_GATEWAY_COUNT; g++) {
    const o = TRG_HEADER_LEN + g * TRG_GATEWAY_LEN;
    const gw = spec.gateways?.[g];
    if (gw) {
      writeVec3(o, gw.exitLine[0]);
      writeVec3(o + 6, gw.exitLine[1]);
      view.setUint16(o + 14, gw.destMaplistIndex, true);
    }
    // Ungenutzte Slots bleiben komplett genullt — genau daran erkennt der
    // Parser sie (entartete Austrittslinie), nicht an einem Sentinel-Wert.
  }
  const trBase = TRG_HEADER_LEN + TRG_GATEWAY_COUNT * TRG_GATEWAY_LEN;
  for (let t = 0; t < TRG_TRIGGER_COUNT; t++) {
    const o = trBase + t * TRG_TRIGGER_LEN;
    const tr = spec.triggers?.[t];
    if (tr) {
      writeVec3(o, tr.corners[0]);
      writeVec3(o + 6, tr.corners[1]);
      view.setUint8(o + 12, tr.bgGroup ?? 0);
      view.setUint8(o + 13, tr.bgFrame ?? 0);
      view.setUint8(o + 14, tr.behavior ?? 0);
      view.setUint8(o + 15, tr.soundId ?? 0);
    }
  }
  return bytes;
}

// --- Script (Spans + Strings) ----------------------------------------------

/**
 * Ein AKAO-/Tutorial-Block hinter der Stringtabelle. Bewusst als
 * **Zweitimplementierung** gebaut: der Kopf wird hier von Hand gelegt, damit
 * ein Parserfehler nicht durch dieselbe Rechnung verdeckt wird.
 */
export type AkaoBlockSpec =
  /** Vollständiges Magic `AKAO` + u16-ID + u16-Länge. */
  | { kind: 'akao'; musicId: number; payload?: Uint8Array }
  /**
   * Belegter Originaldefekt: die ersten `missing` Magic-Bytes fehlen, der
   * Restkopf rutscht entsprechend nach vorn (Makou §4.2).
   */
  | { kind: 'akao-truncated'; missing: 1 | 2; musicId: number; payload?: Uint8Array }
  /** Tutorial-Bytecode statt Musik — erstes Byte im Opcode-Bereich 0x00…0x12. */
  | { kind: 'tutorial'; bytes?: Uint8Array }
  /** Weder Magic noch gültiger Tutorial-Opcode (erstes Byte > 0x12, < 0xFF). */
  | { kind: 'unknown'; firstByte?: number }
  /** Offset zeigt aus der Sektion heraus — erzeugt E-FLD-AKAOOFF. */
  | { kind: 'dangling-offset'; offset?: number };

function buildAkaoBlock(spec: AkaoBlockSpec): Uint8Array {
  switch (spec.kind) {
    case 'akao':
    case 'akao-truncated': {
      const missing = spec.kind === 'akao-truncated' ? spec.missing : 0;
      const payload = spec.payload ?? new Uint8Array(16);
      const head = new Uint8Array(8 - missing);
      const magic = 'AKAO'.slice(missing);
      putAscii(head, 0, magic);
      const hv = new DataView(head.buffer);
      hv.setUint16(4 - missing, spec.musicId, true);
      hv.setUint16(6 - missing, payload.length, true);
      const out = new Uint8Array(head.length + payload.length);
      out.set(head, 0);
      out.set(payload, head.length);
      return out;
    }
    case 'tutorial':
      // 0x00 PAUSE + u16, dann 0x11 FINISH — gültige Tutorial-Mini-VM.
      return spec.bytes ?? Uint8Array.from([0x00, 0x10, 0x00, 0x11]);
    case 'unknown':
      return Uint8Array.from([spec.firstByte ?? 0x7b, 0, 0, 0]);
    case 'dangling-offset':
      return new Uint8Array(0);
  }
}

export interface ScriptSpec {
  entities: {
    name: string;
    /** Entry-Points als Offsets relativ zum Script-Bytecode-Beginn. */
    entryPoints: number[];
  }[];
  scriptBytes: Uint8Array;
  strings?: Uint8Array[];
  /** AKAO-/Tutorial-Blöcke; sie landen hinter der Stringtabelle (wie im Original). */
  akao?: AkaoBlockSpec[];
}

export function composeScriptSection(spec: ScriptSpec): Uint8Array {
  const n = spec.entities.length;
  const akaoSpecs = spec.akao ?? [];
  const nAkao = akaoSpecs.length;
  const namesBase = SCR_HEADER_LEN;
  const akaoTableBase = namesBase + n * SCR_ENTITY_NAME_LEN;
  const entryBase = akaoTableBase + nAkao * 4;
  const dataStart = entryBase + n * SCR_ENTRIES_PER_ENTITY * 2;
  const stringTableOffset = dataStart + spec.scriptBytes.length;
  const strings = spec.strings ?? [];
  const stringOffsetsBase = 2 + strings.length * 2;
  const stringsLen = strings.reduce((sum, s) => sum + s.length, 0);
  const akaoBase = stringTableOffset + stringOffsetsBase + stringsLen;

  const blocks = akaoSpecs.map(buildAkaoBlock);
  const total = akaoBase + blocks.reduce((sum, b) => sum + b.length, 0);

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  view.setUint8(2, n);
  view.setUint8(3, 0); // nModels (S2: ungenutzt)
  view.setUint16(4, stringTableOffset, true);
  view.setUint16(6, nAkao, true); // nAkao
  view.setUint16(8, 512, true); // scale (Platzhalter)
  putAscii(bytes, 16, 'fixture'); // creator[8]
  putAscii(bytes, 24, 'field'); // name[8]

  spec.entities.forEach((e, i) => {
    putAscii(bytes, namesBase + i * SCR_ENTITY_NAME_LEN, e.name.slice(0, SCR_ENTITY_NAME_LEN - 1));
    for (let s = 0; s < SCR_ENTRIES_PER_ENTITY; s++) {
      const rel = e.entryPoints[s] ?? e.entryPoints[e.entryPoints.length - 1] ?? 0;
      view.setUint16(entryBase + (i * SCR_ENTRIES_PER_ENTITY + s) * 2, dataStart + rel, true);
    }
  });
  bytes.set(spec.scriptBytes, dataStart);

  view.setUint16(stringTableOffset, strings.length, true);
  let cursor = stringOffsetsBase;
  strings.forEach((s, i) => {
    view.setUint16(stringTableOffset + 2 + i * 2, cursor, true);
    bytes.set(s, stringTableOffset + cursor);
    cursor += s.length;
  });

  let blockAt = akaoBase;
  blocks.forEach((block, i) => {
    const s = akaoSpecs[i]!;
    const offset = s.kind === 'dangling-offset' ? (s.offset ?? total + 4096) : blockAt;
    view.setUint32(akaoTableBase + i * 4, offset, true);
    bytes.set(block, blockAt);
    blockAt += block.length;
  });
  return bytes;
}

// --- Encounter (Sektion 7) ---------------------------------------------------

export interface EncounterTableSpec {
  /** Default: aus dem Inhalt abgeleitet (1, sobald ein Slot belegt ist). */
  enabled?: number;
  rate?: number;
  /** Bis zu 6 Standardslots als [Anteil, Formations-ID]; Rest wird genullt. */
  standard?: [number, number][];
  /** Bis zu 4 Sonderslots als [Anteil, Formations-ID]. */
  special?: [number, number][];
  /** Zum Erzeugen von Quarantäne-/Diagnose-Fixtures. */
  padding?: number;
}

export interface EncounterSpec {
  tables?: [EncounterTableSpec?, EncounterTableSpec?];
  /** Erzwingt eine abweichende Sektionslänge (Defekt-Fixture). */
  sectionLenOverride?: number;
}

/**
 * Zweitimplementierung der Encounter-Sektion (24 B je Tabelle, 2 Tabellen).
 * Bewusst unabhängig vom Parser: die 6/10-Teilung wird hier erneut gerechnet.
 */
export function composeEncounterSection(spec: EncounterSpec = {}): Uint8Array {
  const TABLE = 24;
  const bytes = new Uint8Array(spec.sectionLenOverride ?? TABLE * 2);
  const view = new DataView(bytes.buffer);
  for (let t = 0; t < 2; t++) {
    const table = spec.tables?.[t];
    const base = t * TABLE;
    if (!table || base + TABLE > bytes.length) continue;
    const std = table.standard ?? [];
    const spc = table.special ?? [];
    const belegt = std.length > 0 || spc.length > 0;
    bytes[base] = table.enabled ?? (belegt ? 1 : 0);
    bytes[base + 1] = table.rate ?? 0;
    for (let i = 0; i < 6; i++) {
      const s = std[i];
      if (s) view.setUint16(base + 2 + i * 2, ((s[0] & 0x3f) << 10) | (s[1] & 0x03ff), true);
    }
    for (let i = 0; i < 4; i++) {
      const s = spc[i];
      if (s) view.setUint16(base + 14 + i * 2, ((s[0] & 0x3f) << 10) | (s[1] & 0x03ff), true);
    }
    view.setUint16(base + 22, table.padding ?? 0, true);
  }
  return bytes;
}

// --- Container --------------------------------------------------------------

export interface FieldContainerSpec {
  /** 1-basierte Sektionsnummer → Sektionsdaten; fehlende erhalten Füllbytes. */
  sections: Record<number, Uint8Array>;
  sectionCount?: number;
}

export interface FieldFixtureLayout {
  bytes: Uint8Array;
  /** Absoluter Offset des u32-Längenvorsatzes je Sektion (1-basiert). */
  sectionOffsets: Record<number, number>;
  pointerTableStart: number;
}

export function composeFieldContainer(spec: FieldContainerSpec): FieldFixtureLayout {
  const count = spec.sectionCount ?? 9;
  const headerEnd = 6 + count * 4;
  const sectionOffsets: Record<number, number> = {};
  let cursor = headerEnd;
  const datas: Uint8Array[] = [];
  for (let s = 1; s <= count; s++) {
    // Füller für ungenutzte Sektionen; 3/4/7/9 brauchen minimale GÜLTIGE
    // Strukturen, da der Container sie semantisch parst.
    const filler =
      s === 3
        ? composeModelLoaderSection()
        : s === 4
          ? composePaletteSection({ pages: [] })
          : s === 7
            ? composeEncounterSection()
            : s === 9
              ? composeBackgroundSection()
              : new Uint8Array(8);
    const data = spec.sections[s] ?? filler;
    sectionOffsets[s] = cursor;
    datas.push(data);
    cursor += 4 + data.length;
  }
  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  view.setUint32(2, count, true);
  for (let s = 1; s <= count; s++) {
    view.setUint32(6 + (s - 1) * 4, sectionOffsets[s]!, true);
    view.setUint32(sectionOffsets[s]!, datas[s - 1]!.length, true);
    bytes.set(datas[s - 1]!, sectionOffsets[s]! + 4);
  }
  return { bytes, sectionOffsets, pointerTableStart: 6 };
}

/** Kompletter Fixture-Eintrag: Container komponieren + LZS-Rahmen. */
export function composeCompressedField(spec: FieldContainerSpec): Uint8Array {
  return compressLzsEntry(composeFieldContainer(spec).bytes);
}

// --- Defekt-Mutationen ------------------------------------------------------

export function corruptSectionPointer(layout: FieldFixtureLayout, sectionNo: number, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(6 + (sectionNo - 1) * 4, value, true);
  return bytes;
}

export function corruptSectionLength(layout: FieldFixtureLayout, sectionNo: number, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(layout.sectionOffsets[sectionNo]!, value, true);
  return bytes;
}

export function corruptSectionCount(layout: FieldFixtureLayout, value: number): Uint8Array {
  const bytes = layout.bytes.slice();
  new DataView(bytes.buffer).setUint32(2, value, true);
  return bytes;
}
