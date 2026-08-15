import type { FieldDiagnostic } from './diagnostics.js';
// Nur ein Typ-Import: zur Laufzeit gibt es keine Kante zurück nach `sections/`.
import type { AkaoBlock } from './sections/akao.js';

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
 * **Neu vermessen 2026-08-15 (F15).** Die vorige Deutung „zwei Vec3 ab @0 und
 * @6 bilden eine Austrittslinie" war falsch: Sie ergab Linien quer über die
 * halbe Karte, und der Übertritt feuerte nie. Gemessen wurde mit
 * Punkt-in-Dreieck gegen das begehbare Netz, über alle 1095 belegten Records
 * und alle elf möglichen `i16`-Paare:
 *
 * | Feld | Versatz | Beleg | Kontrolle |
 * |---|---|---|---|
 * | `exitPoint` (x, y) im **eigenen** Netz | @2/@4 | **85,5 %** (936/1095) | Fremdfeld 27,0 %; alle übrigen Versätze ≤ Kontrolle |
 * | `destPoint` (x, y) im **Ziel**netz | @8/@10 | **100,0 %** (978/978) | Maplist-Nachbar 33,1 % · eigenes Field 36,2 % · verschobene Zuordnung 46,2 % |
 * | `destMaplistIndex` | @14 | 78,8 % Rückkanten (S11) | verwürfelt 0,2 % |
 *
 * **Kohärenzprobe** über 771 Gegen-Gateway-Paare: Der Zielpunkt von A liegt im
 * Median **142 Einheiten** vom Austrittspunkt des Gegen-Gateways entfernt
 * (82,7 % unter 300) — Kontrolle „anderes Gateway desselben Zielfields":
 * Median 1107, nur 8,8 % unter 300. Beide Deutungen stützen sich also
 * gegenseitig, ohne dass eine dritte Annahme nötig wäre.
 *
 * ⚠️ **Damit ist der S11-Befund „der Zielpunkt steht NICHT im Record"
 * widerlegt.** Er war nicht falsch gemessen, sondern zu eng: Geprüft worden
 * waren die Versätze @12, @16 und @18 — @8 stand nie in der Kandidatenmenge.
 * Die Lehre steht in `docs/ROADMAP-OFFENE-POSTEN.md`.
 *
 * 🔴 **Offen: eine Austrittsli­nie gibt es nicht — jedenfalls nicht auffindbar.**
 * Für einen *zweiten* Punkt im eigenen Netz trägt kein Versatz (bester
 * Kandidat @20 mit 70,4 % gegen 37,0 % Kontrolle, alle übrigen auf
 * Kontrollniveau), und als Strecke gerechnet verbessern alle Kandidaten den
 * Abstand zum Gegen-Gateway gleich stark (Median 87–119 gegen 142 für den
 * Punkt allein) — das ist keine Trennung, sondern der übliche Gewinn, den jede
 * Verlängerung bringt. Der Übertritt läuft deshalb über den **Punkt** (siehe
 * `detectGatewayCrossings`), nicht über eine Linie.
 *
 * 🟡 @0 und @6 sind die je zugehörigen dritten Komponenten (vermutlich Höhen);
 * die Deutung als **Dreiecksnummer** ist gemessen und widerlegt (0,8 % bzw.
 * 0,9 % gegen Nachbarkontrollen von 0,4 % / 1,8 %). Sie bleiben roh.
 */
export interface FieldGateway {
  /** ✅ Austrittsstelle im eigenen Grundriss — `i16`@2 / `i16`@4. */
  exitPoint: [number, number];
  /** ✅ Ankunftsstelle im Grundriss des Zielfields — `i16`@8 / `i16`@10. */
  destPoint: [number, number];
  /** 🟡 `i16`@0 und `i16`@6 — dritte Komponente je Punkt, Deutung offen. */
  exitZRaw: number;
  destZRaw: number;
  /** false = ungenutzter Slot (Austritts- und Zielpunkt byteidentisch). */
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

/**
 * Script-Sektion (Sektion 1).
 *
 * **Schemaversion 2** (engineCompat-Schritt, F09-B): `akaoOffsets` kam hinzu.
 * Vorher wurde die Offsettabelle nur ÜBERSPRUNGEN, um an die Entry-Tabelle zu
 * kommen — damit war die MUSIC-Kette am ersten Glied abgeschnitten. Siehe
 * `sections/akao.ts` für die Messung, die den Operanden als field-lokalen
 * Index in genau diese Tabelle belegt.
 */
export interface FieldScriptSet {
  schemaVersion: 2;
  entities: ScriptEntity[];
  /** Beginn des Script-Bytecode-Bereichs (sektionsrelativ). */
  dataStart: number;
  stringTableOffset: number;
  /**
   * `nAkao` u32-Offsets (sektionsrelativ) auf die AKAO-/Tutorial-Blöcke.
   * **Der MUSIC-Operand indiziert diese Tabelle** — er ist keine Titelnummer.
   */
  akaoOffsets: number[];
  /** Kopfklassifikation je Offset (gleiche Reihenfolge wie `akaoOffsets`). */
  akaoBlocks: AkaoBlock[];
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
  /**
   * u8@28 — Animationsgruppe. 0 = statisches Tile (immer sichtbar), sonst die
   * Nummer des Parameters, den das Field-Script schaltet.
   *
   * 🟢 **Realdatenbeleg** (`md8_1`, 890 Tiles, 2026-08-10): 474 Tiles tragen
   * `param = 0` und **exakt dieselben 474** tragen `state = 0` — die beiden
   * Felder sind gekoppelt, wie es die Deutung verlangt. Die übrigen 416 Tiles
   * (`param = 1`) sind die animierten Flammen der brennenden Reaktorszene.
   */
  param: number;
  /**
   * u8@29 — Zustands-Bitmaske innerhalb der Animationsgruppe. Beobachtete
   * Werte sind Einzelbits (8, 16, 32 …): das Tile gehört zu genau einem
   * Animationsschritt und ist sichtbar, wenn dieses Bit im aktuellen Wert des
   * Parameters gesetzt ist.
   *
   * Werden ALLE Zustände gleichzeitig gezeichnet, überlagern sich sämtliche
   * Phasen einer Animation zu einem unscharfen Block — das war F22.
   */
  state: number;
  /** u8@30 — Mischung aktiv (0 = deckend). Zählt in `md8_1` 415 Tiles wie `typeTrans`. */
  blending: number;
  /**
   * u8@32 — Mischart. 🟡 Community-Konvention: 0 = Mittelwert, 1 = additiv,
   * 2 = subtraktiv, 3 = 25 % additiv. In `md8_1` treten nur 0 und 1 auf.
   */
  typeTrans: number;
  /** u8@34 — Texturseiten-Slot; 99,85 % verweisen auf eine vorhandene Seite. ✅ */
  textureId: number;
  /**
   * u8@36 — zweite Texturseite (F31). 🟢 Belegt (Makou `TilePC.textureID2`,
   * dort @32 bei um 4 Bytes späterem Record-Nullpunkt): Misch-Tiles
   * (`blending > 0`, Layer > 0) lesen ihre Quelle aus `srcX2/srcY2` auf
   * DIESER Seite — s. `effectiveTileRef`.
   */
  textureId2: number;
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
