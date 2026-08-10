import type { FieldDiagnostic } from './diagnostics.js';

/**
 * Normalisierte Runtime-Repräsentationen (NAM) des Field-Pfads —
 * Assetklassen `FieldBundle`, `Walkmesh`, `FieldCameraSet`, `FieldTriggers`,
 * `PreparedScript`-Vorstufe laut Masterplan Phase 2.3. Reine Daten,
 * strukturiert klonbar, keine Klassen.
 */

export type Vec3 = [number, number, number];

export interface WalkmeshTriangle {
  /** Konvertierung ins Three.js-System erfolgt erst in Phase 3 (ADR-009). */
  vertices: [Vec3, Vec3, Vec3];
  /** Nachbardreieck je Kante i=(v[i]→v[(i+1)%3]); null = gesperrte Kante. */
  adjacency: [number | null, number | null, number | null];
  degenerate?: boolean;
}

export interface Walkmesh {
  schemaVersion: 1;
  triangleCount: number;
  triangles: WalkmeshTriangle[];
}

export interface FieldCamera {
  /** Rohwerte: Achsvektoren als i16-Festkomma (4096 = 1.0). */
  axesRaw: [Vec3, Vec3, Vec3];
  /** 🟡 Zehnter i16 im Record (dokumentiert als Wiederholung) — roh konserviert. */
  axisRepeatRaw: number;
  positionRaw: Vec3;
  zoom: number;
  /** Normalisierte Achsen (Rohwert / 4096). */
  axes: [Vec3, Vec3, Vec3];
  /** true, wenn Achsen innerhalb der Orthonormalitätstoleranz liegen. */
  orthonormal: boolean;
}

export interface FieldCameraSet {
  schemaVersion: 1;
  cameras: FieldCamera[];
}

/**
 * Gateway-Record (24 B). Jede Triggersektion führt 12 Slots; belegt sind im
 * Gesamtbestand nur 1095 davon.
 *
 * ✅ Belegt: `exitLine` @0…@11 und das Belegungsmerkmal — ein ungenutzter Slot
 *   hat eine entartete (punktförmige) Austrittslinie. Über 8424 Records
 *   trennt das sauber: alle 740 Records mit auffälligem Zielfeld-Wert sind
 *   nicht entartet, alle 7329 entarteten tragen den Nullwert.
 * ✅ Belegt: `destMaplistIndex` = u16@14 ist ein **0-basierter Index in die
 *   `maplist`** (nicht in die Archivreihenfolge). Nachgewiesen über
 *   Graph-Symmetrie: Fasst man die Ziele als gerichteten Graphen auf, haben
 *   **78,8 %** der Kanten eine Gegenkante — gegen ein Kontrollniveau von
 *   **0,2 %** bei verwürfelten Zielen. Alle anderen Offsets und
 *   Indexdeutungen bleiben unter 3 %.
 * 🔴 **Der Zielpunkt steht NICHT im Record** — das ist gemessen, nicht
 *   vermutet: Alle prüfbaren Vec3-i16-Offsets (@12, @16, @18) liegen mit
 *   34,3 % / 14,4 % / 12,0 % Treffern *unter* ihrer jeweiligen Kontrollquote
 *   (36,8 % / 17,3 % / 14,2 %), und die Fehlschläge liegen im Median 99
 *   Einheiten neben der Ziel-Bounding-Box — also kein Skalierungsproblem.
 *   Die Ankunftsposition wird deshalb aus dem **Gegen-Gateway** des
 *   Zielfields abgeleitet (`planTransition` in `@webmidgar/field-runtime`).
 *   Die verbleibenden Bytes bleiben in `raw`; @16/@18 tragen identische
 *   Verteilungen und sehen nach Flags aus, nicht nach Koordinaten.
 */
export interface FieldGateway {
  exitLine: [Vec3, Vec3];
  /** false = ungenutzter Slot (entartete Austrittslinie). */
  used: boolean;
  /** u16@14 — 0-basierter Index in die `maplist`. ✅ */
  destMaplistIndex: number;
  /** Vollständiger 24-B-Record (die nicht zugeordneten Bytes inklusive). */
  raw: Uint8Array;
}

export interface FieldTriggerVolume {
  corners: [Vec3, Vec3];
  /** false = ungenutzter Slot (genullte Ecken) — sonst Phantomtrigger bei (0,0). */
  used: boolean;
  bgGroup: number;
  bgFrame: number;
  behavior: number;
  soundId: number;
}

export interface FieldTriggers {
  schemaVersion: 1;
  name: string;
  control: number;
  cameraFocusHeight: number;
  /** [links, unten, rechts, oben] in Field-Einheiten. */
  cameraRange: [number, number, number, number];
  /** Hintergrund-Layer-Parameterblock — roh, Auswertung in späterer Phase (🟡). */
  bgLayerParamsRaw: number[];
  gateways: FieldGateway[];
  triggers: FieldTriggerVolume[];
}

export interface ScriptEntity {
  name: string;
  /**
   * 32 Entry-Points, sektionsrelative Offsets; null = ungültig (E-SCR-SPAN).
   * Wert == stringTableOffset ist gültig und bedeutet „leerer Span"
   * (ungenutzter Slot-Sentinel, realdaten-validiert 2026-08-09).
   */
  entryPoints: (number | null)[];
}

export interface FieldScriptSet {
  schemaVersion: 1;
  entities: ScriptEntity[];
  /** Beginn des Script-Bytecode-Bereichs (sektionsrelativ). */
  dataStart: number;
  stringTableOffset: number;
  /** Disjunkte Bytecode-Spannen [start, end), abgeleitet aus Entry-Points. */
  spans: { start: number; end: number }[];
  /** String-Offsets relativ zum Stringtabellen-Beginn; null = ungültig. */
  stringOffsets: (number | null)[];
}

/** Palettensektion (Sektion 4) — Layout realdaten-validiert (702/702). */
export interface FieldPalette {
  schemaVersion: 1;
  /** Rohkopf: u32 + palX + palY + colorsPerPage (roh konserviert). */
  headerRaw: number[];
  /** Seiten à 256 Farben, dekodiert nach RGBA8 (BGR555, 🟡 Bitzuordnung). */
  pages: Uint8Array[];
}

/**
 * Hintergrund-Tile (52-B-Record, Sektion 9). Feldzuordnung ✅ realdaten-
 * validiert (S9-Proben 1–3 über 647.531 Tiles); der vollständige Record
 * bleibt zusätzlich roh erhalten, weil einige Felder noch 🟡 sind.
 */
export interface BackgroundTile {
  /** i16@4 / i16@6 — Zielposition, Bildmitte = (0,0), 8er-Raster. */
  dstX: number;
  dstY: number;
  /** u8@12 / u8@14 — Quellposition in der Texturseite (16er-Raster, < 256). */
  srcX: number;
  srcY: number;
  /**
   * u8@16 / u8@18 — zweites Quellkoordinatenpaar. Der vorberechnete
   * UV-Cache (`uvX`/`uvY`) folgt diesem Paar, wenn es gesetzt ist —
   * `effectiveSrc()` bildet die Regel ab.
   */
  srcX2: number;
  srcY2: number;
  /**
   * 🟡 u16@20 — je Layer konstant (L1 = 16, L2 = 32, L3 = 2…15, L0 = 0),
   * also KEINE Palettenangabe (das war die S8-Fehlannahme). Zweck offen.
   */
  layerControl: number;
  /** u8@24 — Palettenseite; 99,87 % der Tiles < Seitenzahl. ✅ */
  paletteId: number;
  /** 🟡 u8@25 — Einzelbit-Maske (0 in 99,4 % der Tiles). */
  flags: number;
  /**
   * u16@26 — 12-Bit-Tiefenschlüssel (0…4096). In Layer 0 konstant 4095
   * (= hinterste Ebene), in den Layern 1–3 je Tile verschieden.
   */
  z: number;
  /** u8@34 — Texturseiten-Slot; 99,85 % verweisen auf eine vorhandene Seite. ✅ */
  textureId: number;
  /** u8@38 — Texeltiefe der Quellseite (0/1 = palettiert, 2 = Direktfarbe). */
  bpp: number;
  /** u32@44 / u32@48 — vorberechnetes UV in 1e7-Festkomma (= src/256·1e7). */
  uvX: number;
  uvY: number;
  raw: Uint8Array;
}

export interface BackgroundLayer {
  /** 0–3; Layer 0 existiert immer, 1–3 flag-gesteuert. */
  index: number;
  width: number;
  height: number;
  /** Headerrest hinter w/h/tileCount — roh (L0: depth-u16, L1: 16 B, …). */
  headerRaw: Uint8Array;
  tiles: BackgroundTile[];
}

export interface BackgroundTexturePage {
  slot: number;
  /** Bytes je Texel (1 = palettenindiziert, 2 = 16-Bit-Direktfarbe 🟡). */
  depth: number;
  /** size-Feld des Slots — roh (Datenlänge hängt NUR an depth). */
  sizeRaw: number;
  /** 256×256×depth Texel. */
  data: Uint8Array;
}

/** Hintergrundsektion (Sektion 9) — Marker-Layout realdaten-validiert. */
export interface FieldBackground {
  schemaVersion: 1;
  /** 5-B-Sektionskopf + 24-B-PALETTE-Block, roh konserviert. */
  headerRaw: Uint8Array;
  paletteHeaderRaw: Uint8Array;
  layers: BackgroundLayer[];
  texturePages: BackgroundTexturePage[];
}

/**
 * Ein Eintrag der Model-Loader-Sektion (Sektion 3) — Grammatik ✅
 * realdaten-validiert (702/702 Fields byteexakt, S10).
 */
export interface FieldModelEntry {
  /** Beschreibender Name (19…27 Zeichen), Längenpräfix im Format. */
  name: string;
  /** Modelldatei aus dem 12-B-Feld, z. B. `xxxx.hrc` (kleingeschrieben). */
  modelFile: string;
  /** Skala als Text im selben Feld hinterlegt; null, wenn nicht lesbar (🟡). */
  scale: number | null;
  /** 12-B-Dateifeld roh — enthält Name + Skalatext. */
  fileFieldRaw: Uint8Array;
  /**
   * 🟡 u16 direkt hinter dem Namen — ein binäres Flag: über 5454 Modelle
   * kommen ausschließlich die Werte 0 (47,6 %) und 1 (52,4 %) vor.
   * Bedeutung offen.
   */
  unknownAfterName: number;
  /**
   * 30-B-Block hinter dem Animationszähler — roh konserviert.
   * Deutung als Beleuchtung siehe `decodeModelLightBlock` (🟡).
   */
  blockRaw: Uint8Array;
  animations: FieldModelAnimation[];
}

export interface FieldModelAnimation {
  /** Rohname aus dem Manifest, z. B. `xxxx.aki` (kleingeschrieben). */
  name: string;
  /**
   * Auflösbarer Dateiname in `char.lgp`: Stamm + `.a`.
   * ✅ Realdaten-validiert: Der Teil hinter dem Punkt ist KEINE Dateiendung —
   * mit `<stamm>.a` lösen 26.212/26.212 Referenzen auf, mit dem Rohnamen 0.
   */
  file: string;
  /** 🟡 Kennung hinter dem Punkt (aki/yos/chi/tak/tor/hei/kei/anm) — Zweck offen. */
  tag: string;
  /** u16 hinter dem Namen; in 97,1 % der Einträge 1 (🟡 Restsemantik). */
  tail: number;
}

/** Model-Loader-Sektion (Sektion 3). */
export interface FieldModelManifest {
  schemaVersion: 1;
  /** u16@0, in allen Originaldaten 0. */
  blank: number;
  /** Globale Skala aus dem Kopf (u16@4); 512 in 643/702 Fields. */
  scaleGlobal: number;
  models: FieldModelEntry[];
}

/**
 * Ein Slot der Encounter-Tabelle (Sektion 7). Ein u16 trägt **zwei** Werte:
 * Wahrscheinlichkeitsanteil in den oberen 6 Bit, globale Formations-ID in den
 * unteren 10 (`& 0x03FF`). `raw == 0` = ungenutzter Slot.
 */
export interface FieldEncounterSlot {
  /** Anteil an 64 (Standardslots) bzw. absoluter Anteil (Sonderslots). ✅ */
  probability: number;
  /**
   * Globale Formationsnummer — dieselbe Nummernebene wie der Operand des
   * `BATTLE`-Opcodes. ✅ Referenzschluss gegen `scene.bin`:
   * `scene = id >> 2`, `formation = id & 3`.
   */
  formationId: number;
  /** Unzerlegtes Wort (die 6/10-Teilung bleibt nachvollziehbar). */
  raw: number;
}

export interface FieldEncounterTable {
  /** `enabledRaw != 0`; gemessen genau dann, wenn die Tabelle Inhalt hat. */
  enabled: boolean;
  enabledRaw: number;
  /** 🟡 Begegnungsrate — acht Werte im Bestand, alle Vielfache von 8 (24…240). */
  rate: number;
  /** Sechs Standardkämpfe; ihre Anteile summieren sich auf 64. ✅ */
  standard: FieldEncounterSlot[];
  /** Vier Sonderanflüge (Rücken-/Seiten-/Zangenangriff, `ENC_SPECIAL_ROLE`). */
  special: FieldEncounterSlot[];
  /** Summe der Standardanteile — 64 in allen 197 belegten Tabellen. */
  probabilitySum: number;
  /** u16 am Tabellenende; 1404/1404 genullt. */
  padding: number;
}

/** Encounter-Sektion (Sektion 7) — Layout realdaten-validiert (702/702). */
export interface FieldEncounters {
  schemaVersion: 1;
  /** Zwei Tabellen à 24 B; Tabelle 1 ist nur in 15 Fields belegt (🟡 Umschalter). */
  tables: [FieldEncounterTable, FieldEncounterTable];
}

/** 1-basierte Sektionsnummern des PC-Field-Containers (🟢 Grundstruktur). */
export const SECTION = {
  SCRIPT: 1,
  CAMERA: 2,
  MODEL_LOADER: 3,
  PALETTE: 4,
  WALKMESH: 5,
  TILEMAP: 6,
  ENCOUNTER: 7,
  TRIGGERS: 8,
  BACKGROUND: 9,
} as const;

export interface FieldBundle {
  schemaVersion: 1;
  fieldId: string;
  sectionCount: number;
  /** Roh-Slices aller strukturell gültigen Sektionen (1-basiert indiziert). */
  rawSections: Record<number, Uint8Array>;
  /** Quarantänisierte Sektionsnummern (E-FLD-SEC<n>). */
  quarantinedSections: number[];
  script?: FieldScriptSet;
  cameras?: FieldCameraSet;
  models?: FieldModelManifest;
  walkmesh?: Walkmesh;
  triggers?: FieldTriggers;
  palette?: FieldPalette;
  background?: FieldBackground;
  encounters?: FieldEncounters;
  /** Ohne gültiges Walkmesh ist das Field nicht betretbar (Masterplan 1.5). */
  enterable: boolean;
  diagnostics: FieldDiagnostic[];
}
