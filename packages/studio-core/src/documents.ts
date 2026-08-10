/**
 * Dokumentschemas des Studio-Projektmodells (A-ST-4, Masterplan B.1/B.2):
 * rein deklarative JSON-Dokumente, ein Dokument pro fachlicher Einheit,
 * jede Datei trägt `schemaVersion`; Referenzen ausschließlich als IDs,
 * nie als Pfade. Originalinhalte werden nur referenziert, nie kopiert —
 * es existiert bewusst kein Dokumentfeld für Originalbytes/-texte (B.7).
 */

import {
  checkEffekt,
  ELEMENTE,
  STATUSWERTE,
  type Effekt,
  type Element,
  type StatusWert,
} from './effects.js';

export type DocumentKind =
  | 'project'
  | 'dialogue'
  | 'scriptGraph'
  | 'character'
  | 'field'
  | 'fieldDelta'
  | 'variables'
  | 'enemy'
  | 'battle';

/** Aktuelle Schemaversionen je Dokumenttyp. */
export const SCHEMA_VERSIONS: Readonly<Record<DocumentKind, number>> = {
  project: 1,
  dialogue: 1,
  scriptGraph: 1,
  character: 1,
  field: 1,
  fieldDelta: 1,
  variables: 1,
  enemy: 1,
  battle: 1,
};

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/* ------------------------------------------------------------------ */
/* project.json                                                        */
/* ------------------------------------------------------------------ */

export interface ProjectDoc {
  schemaVersion: number;
  /** Reverse-DNS, z. B. `de.example.midgarquest`. */
  modId: string;
  name: string;
  /** Semver-String, z. B. `0.1.0`. */
  version: string;
  /** Semver-Range-String, z. B. `^0.11.0`. */
  engineCompat: string;
  primaersprache: string;
  sprachen: string[];
  /** Studio kompiliert ausschließlich auf Manifest v2 (A-ST-2). */
  manifestZielversion: 2;
}

/* ------------------------------------------------------------------ */
/* dialogues/<field>.<locale>.json                                     */
/* ------------------------------------------------------------------ */

export interface DialogueControl {
  art: 'farbe' | 'pause' | 'variable' | 'auswahl';
  wert: string;
}

export interface DialoguePage {
  text: string;
  steuerelemente?: DialogueControl[] | undefined;
}

/**
 * Dialog-Delta: speichert NIE Originaltext — nur den neuen Text (in
 * `seiten`) plus `guardHash` als Restore-Guard (Masterplan 5.2, B.7).
 */
export interface DialogueDelta {
  guardHash: string;
  ersetztOriginalIndex?: number | undefined;
}

export interface DialogueEntry {
  id: string;
  sprecher?: string | undefined;
  seiten: DialoguePage[];
  delta?: DialogueDelta | undefined;
}

export interface DialogueDoc {
  schemaVersion: number;
  /** Kanonische Field-ID (`field:<id>`). */
  field: string;
  locale: string;
  eintraege: DialogueEntry[];
}

/* ------------------------------------------------------------------ */
/* scripts/<entitaet>.<slot>.json                                      */
/* ------------------------------------------------------------------ */

/** Die neun Kategorien der Opcode-Taxonomie (Masterplan 4.1). */
export const SCRIPT_KATEGORIEN = [
  'kontrollfluss',
  'variablen',
  'dialog',
  'entity-bewegung',
  'kamera',
  'field-uebergang',
  'audio',
  'battle',
  'spezial',
] as const;
export type ScriptKategorie = (typeof SCRIPT_KATEGORIEN)[number];

/** Im Editor gesperrte Kategorien (A-ST-5): Semantik noch nicht implementiert. */
export const GESPERRTE_SCRIPT_KATEGORIEN: readonly ScriptKategorie[] = [
  'entity-bewegung',
  'kamera',
  'audio',
  'spezial',
];

/** Slot-Trigger-Semantik aus R1 A5 (A-ST-5). */
export const SLOT_ARTEN = ['init', 'main', 'interaktion', 'beruehrung', 'timer'] as const;
export type SlotArt = (typeof SLOT_ARTEN)[number];

export interface ScriptNode {
  id: string;
  kategorie: ScriptKategorie;
  /** Mnemonic-String (z. B. `JMPF`, `MESSAGE`). */
  op: string;
  operanden?: Record<string, string | number> | undefined;
  /** Formatgegeben; visuell unterscheidbar (A-ST-5). */
  blockierend: boolean;
  position: Vec2;
}

export interface ScriptEdge {
  /** Knoten-IDs. */
  von: string;
  zu: string;
  bedingung?: string | undefined;
}

export interface ScriptGraphDoc {
  schemaVersion: number;
  entitaet: string;
  slot: SlotArt;
  knoten: ScriptNode[];
  kanten: ScriptEdge[];
  /** Namen benannter Variablen (→ variables.json). */
  variablenRefs?: string[] | undefined;
}

/* ------------------------------------------------------------------ */
/* characters/<id>.json                                                */
/* ------------------------------------------------------------------ */

export type CharacterModell =
  | { art: 'referenz'; ref: string }
  | { art: 'textur-override'; ref: string; texturAsset: string };

export interface CharacterAuftritt {
  /** Field-ID: kanonisch (`field:<id>`) oder Mod-ID. */
  field: string;
  dreieck: number;
  position: Vec3;
  richtung: number;
  /** Slot → Script-Referenz (ID). */
  scripts: Partial<Record<SlotArt, string>>;
}

export interface CharacterDoc {
  schemaVersion: number;
  id: string;
  name: string;
  modell: CharacterModell;
  kollision: { radius: number; hoehe: number };
  auftritte: CharacterAuftritt[];
}

/* ------------------------------------------------------------------ */
/* fields/<id>.json (neu) und fields/<id>.delta.json                   */
/* ------------------------------------------------------------------ */

export interface WalkmeshTriangle {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  /** Kante (ab, bc, ca) → Index des Nachbardreiecks oder null. */
  adjazent: [number | null, number | null, number | null];
}

export interface FieldCamera {
  position: Vec3;
  ziel: Vec3;
  fovBasis: number;
}

export interface FieldTrigger {
  id: string;
  eckpunkte: Vec3[];
  scriptRef: string;
}

export interface FieldGateway {
  /** Field-ID in beide Richtungen erlaubt (B.2). */
  zielField: string;
  zielDreieck: number;
  zielPosition: Vec3;
}

export interface FieldDoc {
  schemaVersion: number;
  id: string;
  hintergrundAsset?: string | undefined;
  walkmesh: { dreiecke: WalkmeshTriangle[] };
  kameras: FieldCamera[];
  trigger: FieldTrigger[];
  gateways: FieldGateway[];
}

/** Spiegelt die Patch-Record-Enumeration aus Masterplan 5.2. */
export const FIELD_DELTA_OPS = ['replace-span', 'insert-before', 'insert-after', 'disable-span'] as const;
export type FieldDeltaOp = (typeof FIELD_DELTA_OPS)[number];

export interface FieldDeltaOperation {
  op: FieldDeltaOp;
  anker: { entity: string; slot: SlotArt; ipOffset: number };
  guardHash: string;
  /** Payload ausschließlich als Mnemonics/Text, nie Originalbytes. */
  payload?: string | undefined;
}

export interface FieldDeltaDoc {
  schemaVersion: number;
  /** Kanonische Field-ID (`field:<id>`) — nie Vollkopie des Originals. */
  zielField: string;
  operationen: FieldDeltaOperation[];
}

/* ------------------------------------------------------------------ */
/* variables.json                                                      */
/* ------------------------------------------------------------------ */

export interface NamedVariable {
  name: string;
  bank?: number | undefined;
  adresse?: number | undefined;
  kommentar?: string | undefined;
}

export interface VariablesDoc {
  schemaVersion: number;
  benannt: NamedVariable[];
}

/* ------------------------------------------------------------------ */
/* enemies/<id>.json (MS15, ADR-024)                                   */
/* ------------------------------------------------------------------ */

/**
 * Modell-Angabe des Gegners: dieselbe Union wie beim CharacterDoc
 * (`referenz` | `textur-override`), plus `baukasten` (MS9) und `gltf`
 * (MS6) als reservierte String-Literale — im Typ zugelassen, in der
 * Validierung als Info „gesperrt" gemeldet (Payload-Struktur offen,
 * bis MS9/MS6 die Schemas fixieren).
 */
export type EnemyModell =
  | { art: 'referenz'; ref: string }
  | { art: 'textur-override'; ref: string; texturAsset: string }
  | { art: 'baukasten' }
  | { art: 'gltf' };

/** Gesperrte Modellarten → Meilenstein der Freigabe (MS15-UI-Regel). */
export const GESPERRTE_ENEMY_MODELLARTEN: Readonly<Record<string, string>> = {
  baukasten: 'MS9',
  gltf: 'MS6',
};

export interface EnemyStats {
  hp: number;
  mp: number;
  staerke: number;
  abwehr: number;
  magie: number;
  magAbwehr: number;
  geschick: number;
  glueck: number;
  level: number;
  exp: number;
  ap: number;
  gil: number;
}

/**
 * Sinnvolle Wertebänder der Stats (MS15: „Orientierung Original-Level-
 * Bänder"). Abweichungen sind Warnungen, nie Fehler — der Editor zeigt
 * sie als Budget-Balken-Hinweis.
 */
export const ENEMY_STAT_BAND: Readonly<Record<keyof EnemyStats, { min: number; max: number }>> = {
  hp: { min: 1, max: 99999 },
  mp: { min: 0, max: 9999 },
  staerke: { min: 1, max: 255 },
  abwehr: { min: 0, max: 255 },
  magie: { min: 0, max: 255 },
  magAbwehr: { min: 0, max: 255 },
  geschick: { min: 0, max: 255 },
  glueck: { min: 0, max: 255 },
  level: { min: 1, max: 99 },
  exp: { min: 0, max: 999999 },
  ap: { min: 0, max: 9999 },
  gil: { min: 0, max: 999999 },
};

/** Fünf Affinitäts-Zustände je Element (MS15: Cycler-Reihenfolge). */
export const ELEMENT_AFFINITAETEN = ['schwach', 'normal', 'resistent', 'immun', 'absorbiert'] as const;
export type ElementAffinitaet = (typeof ELEMENT_AFFINITAETEN)[number];

export interface EnemyAffinitaeten {
  /** Nur gesetzte Elemente werden serialisiert; fehlende gelten als 'normal'. */
  elemente: Partial<Record<Element, ElementAffinitaet>>;
  /** Geschlossene Statusliste (effects.ts). */
  statusImmunitaeten: StatusWert[];
}

export interface EnemyAngriff {
  id: string;
  name: string;
  /** Effekt-Taxonomie (effects.ts, ADR-020) — unbekannte Werte = Strukturfehler. */
  effekt: Effekt;
  kosten?: number | undefined;
  zielregel?: string | undefined;
}

/** Geschlossene Bedingungs-Menge der deklarativen Gegner-KI (ADR-024). */
export const VERHALTENS_BEDINGUNGEN = [
  'hp_unter',
  'runde_jede',
  'ziel_hat_status',
  'gruppenmitglieder_unter',
  'mp_unter',
  'immer',
] as const;
export type VerhaltensBedingungArt = (typeof VERHALTENS_BEDINGUNGEN)[number];

/** Bedingung mit typisiertem Parameter je Art (kein Freitext, ADR-007/ADR-024). */
export type VerhaltensBedingung =
  | { art: 'hp_unter'; prozent: number }
  | { art: 'runde_jede'; n: number }
  | { art: 'ziel_hat_status'; status: StatusWert }
  | { art: 'gruppenmitglieder_unter'; n: number }
  | { art: 'mp_unter'; prozent: number }
  | { art: 'immer' };

export interface VerhaltensRegel {
  wenn: VerhaltensBedingung;
  /** ID eines Eintrags aus angriffe[]. */
  dann: string;
  gewicht: number;
}

/** Gegner-KI als deklarative Prioritätenliste — kein Script-Pfad (ADR-024). */
export interface EnemyVerhalten {
  art: 'prioritaeten';
  regeln: VerhaltensRegel[];
}

export interface BeuteEintrag {
  /** Item-ID: eigenes MS11-Item (`mod:…/item/…`) oder Original (`kernel:item/<id>`). */
  itemRef: string;
  /** Wahrscheinlichkeit 0..1. */
  rate: number;
}

export interface EnemyBeute {
  drops: BeuteEintrag[];
  stehlen: BeuteEintrag[];
  morph?: string | undefined;
}

export interface EnemyDoc {
  schemaVersion: number;
  id: string;
  name: string;
  beschreibung?: string | undefined;
  modell: EnemyModell;
  stats: EnemyStats;
  affinitaeten: EnemyAffinitaeten;
  angriffe: EnemyAngriff[];
  verhalten: EnemyVerhalten;
  beute: EnemyBeute;
  formationTags: string[];
}

/* ------------------------------------------------------------------ */
/* battles/<id>.json (MS16, ADR-025)                                   */
/* ------------------------------------------------------------------ */

/** Battle-Szenen sind reine deklarative Datenbündel (ADR-025). */
export type BattleArena =
  | { art: 'referenz'; ref: string }
  | { art: 'nutzerbild'; asset: string };

export interface FormationReihe {
  /** Enemy-ID (mod-Namensraum oder Dokument-ID). */
  enemyRef: string;
  anzahl: number;
  /** 2D-Position auf der normalisierten Arena-Grundfläche. */
  position: { x: number; z: number };
  flags?: string[] | undefined;
}

export interface BattleFormation {
  reihen: FormationReihe[];
  maxGleichzeitig: number;
}

export const FLUCHT_REGELN = ['erlaubt', 'verboten', 'bedingt'] as const;
export type FluchtRegel = (typeof FLUCHT_REGELN)[number];

export const HINTERHALT_ARTEN = ['keiner', 'moeglich', 'garantiert'] as const;
export type HinterhaltArt = (typeof HINTERHALT_ARTEN)[number];

export interface BattleRegeln {
  flucht: FluchtRegel;
  hinterhalt?: HinterhaltArt | undefined;
  /** MVP: geschlossen auf 'alle-besiegt' (MS16). */
  siegbedingung: 'alle-besiegt';
}

export interface BattleBelohnung {
  expMod?: number | undefined;
  apMod?: number | undefined;
  gilMod?: number | undefined;
  garantierteDrops?: { itemRef: string }[] | undefined;
}

/** Szene an eine Encounter-Zone eines Fields oder an einen Script-Knoten hängen. */
export type BattleVerknuepfung =
  | { feldRef: string; encounterZone: string }
  | { scriptStart: string };

export interface BattleDoc {
  schemaVersion: number;
  id: string;
  name: string;
  arena: BattleArena;
  formation: BattleFormation;
  regeln: BattleRegeln;
  musikRef?: string | undefined;
  belohnung: BattleBelohnung;
  verknuepfung?: BattleVerknuepfung | undefined;
}

/* ------------------------------------------------------------------ */
/* Dokumenttyp aus Projektpfad                                         */
/* ------------------------------------------------------------------ */

export function documentKindForPath(pfad: string): DocumentKind | null {
  if (pfad === 'project.json') return 'project';
  if (pfad === 'variables.json') return 'variables';
  if (/^dialogues\/[^/]+\.json$/.test(pfad)) return 'dialogue';
  if (/^scripts\/[^/]+\.json$/.test(pfad)) return 'scriptGraph';
  if (/^characters\/[^/]+\.json$/.test(pfad)) return 'character';
  if (/^enemies\/[^/]+\.json$/.test(pfad)) return 'enemy';
  if (/^battles\/[^/]+\.json$/.test(pfad)) return 'battle';
  if (/^fields\/[^/]+\.delta\.json$/.test(pfad)) return 'fieldDelta';
  if (/^fields\/[^/]+\.json$/.test(pfad)) return 'field';
  return null;
}

/* ------------------------------------------------------------------ */
/* Migrationen (B.1: einmalig beim Projektöffnen, nie still)           */
/* ------------------------------------------------------------------ */

/** Migriert ein Dokument von Version `von` nach `von + 1`. */
export type MigrationFn = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations-Hooks je Dokumenttyp: Version → Funktion. v1 ist die
 * initiale (und aktuelle) Version — die Tabellen sind bewusst leer
 * (no-op), zukünftige Migrationen werden hier eingehängt.
 */
export const MIGRATIONS: Readonly<Record<DocumentKind, Readonly<Record<number, MigrationFn>>>> = {
  project: {},
  dialogue: {},
  scriptGraph: {},
  character: {},
  field: {},
  fieldDelta: {},
  variables: {},
  enemy: {},
  battle: {},
};

export interface MigrationResult {
  doc: unknown;
  von: number;
  nach: number;
  migriert: boolean;
}

export function migrateDocument(kind: DocumentKind, doc: unknown): MigrationResult {
  const rec = isRecord(doc) ? doc : {};
  const von = typeof rec['schemaVersion'] === 'number' ? (rec['schemaVersion'] as number) : 1;
  const ziel = SCHEMA_VERSIONS[kind];
  let current = doc;
  for (let v = von; v < ziel; v++) {
    const hook = MIGRATIONS[kind][v];
    if (!hook) {
      throw new Error(`Keine Migration für ${kind} von schemaVersion ${v} nach ${v + 1} registriert.`);
    }
    current = hook(current as Record<string, unknown>);
  }
  if (von > ziel) {
    throw new Error(`Dokument ${kind} mit schemaVersion ${von} ist neuer als unterstützt (${ziel}).`);
  }
  return { doc: current, von, nach: ziel, migriert: von !== ziel };
}

/* ------------------------------------------------------------------ */
/* Strukturelle Validierung                                            */
/* ------------------------------------------------------------------ */

export interface StructureError {
  /** JSON-Pfad im Dokument, z. B. `eintraege[2].seiten`. */
  pfad: string;
  meldung: string;
}

type Sink = (pfad: string, meldung: string) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v);
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function makeSink(): { sink: Sink; errors: StructureError[] } {
  const errors: StructureError[] = [];
  return { sink: (pfad, meldung) => errors.push({ pfad, meldung }), errors };
}

function reqStr(sink: Sink, rec: Record<string, unknown>, key: string, pfad: string, extra?: (v: string) => string | null): void {
  const v = rec[key];
  if (!isStr(v)) {
    sink(pfad, `${key} fehlt oder ist kein String.`);
    return;
  }
  const msg = extra?.(v);
  if (msg) sink(pfad, msg);
}

function reqNum(sink: Sink, rec: Record<string, unknown>, key: string, pfad: string, extra?: (v: number) => string | null): void {
  const v = rec[key];
  if (!isNum(v)) {
    sink(pfad, `${key} fehlt oder ist keine Zahl.`);
    return;
  }
  const msg = extra?.(v);
  if (msg) sink(pfad, msg);
}

function reqSchemaVersion(sink: Sink, rec: Record<string, unknown>): void {
  if (!isInt(rec['schemaVersion']) || (rec['schemaVersion'] as number) < 1) {
    sink('schemaVersion', 'schemaVersion fehlt oder ist keine ganze Zahl ≥ 1.');
  }
}

function checkVec2(sink: Sink, v: unknown, pfad: string): void {
  if (!isRecord(v) || !isNum(v['x']) || !isNum(v['y'])) sink(pfad, 'Vektor {x, y} erwartet.');
}

function checkVec3(sink: Sink, v: unknown, pfad: string): void {
  if (!isRecord(v) || !isNum(v['x']) || !isNum(v['y']) || !isNum(v['z'])) sink(pfad, 'Vektor {x, y, z} erwartet.');
}

function checkVec3Tuple(sink: Sink, v: unknown, pfad: string): void {
  if (!isArr(v) || v.length !== 3 || !v.every(isNum)) sink(pfad, 'Zahlen-Tripel [x, y, z] erwartet.');
}

function checkSlot(sink: Sink, v: unknown, pfad: string): void {
  if (!isStr(v) || !(SLOT_ARTEN as readonly string[]).includes(v)) {
    sink(pfad, `slot muss einer von ${SLOT_ARTEN.join(' | ')} sein.`);
  }
}

/* --- Einzelvalidierer --- */

export const MOD_ID_PATTERN = /^[a-z0-9.-]{3,64}$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
export const SEMVER_RANGE_PATTERN = /^(?:[<>=~^]{1,2}\s*)?\d+\.(?:\d+|x)\.(?:\d+|x)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export function validateProjectDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'modId', 'modId', (v) =>
    MOD_ID_PATTERN.test(v) ? null : 'modId muss reverse-DNS-Format [a-z0-9.-]{3,64} haben.',
  );
  reqStr(sink, doc, 'name', 'name', (v) => (v.trim().length > 0 ? null : 'name darf nicht leer sein.'));
  reqStr(sink, doc, 'version', 'version', (v) =>
    SEMVER_PATTERN.test(v) ? null : 'version muss ein Semver-String sein (z. B. 0.1.0).',
  );
  reqStr(sink, doc, 'engineCompat', 'engineCompat', (v) =>
    SEMVER_RANGE_PATTERN.test(v) ? null : 'engineCompat muss ein Semver-Range-String sein (z. B. ^0.11.0).',
  );
  reqStr(sink, doc, 'primaersprache', 'primaersprache');
  const sprachen = doc['sprachen'];
  if (!isArr(sprachen) || !sprachen.every(isStr)) sink('sprachen', 'sprachen muss ein String-Array sein.');
  if (doc['manifestZielversion'] !== 2) sink('manifestZielversion', 'manifestZielversion muss 2 sein (A-ST-2).');
  return errors;
}

export function validateDialogueDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'field', 'field');
  reqStr(sink, doc, 'locale', 'locale');
  const eintraege = doc['eintraege'];
  if (!isArr(eintraege)) {
    sink('eintraege', 'eintraege muss ein Array sein.');
    return errors;
  }
  eintraege.forEach((e, i) => {
    const p = `eintraege[${i}]`;
    if (!isRecord(e)) {
      sink(p, 'Eintrag ist kein Objekt.');
      return;
    }
    reqStr(sink, e, 'id', `${p}.id`);
    if (e['sprecher'] !== undefined && !isStr(e['sprecher'])) sink(`${p}.sprecher`, 'sprecher muss ein String sein.');
    const seiten = e['seiten'];
    if (!isArr(seiten)) {
      sink(`${p}.seiten`, 'seiten muss ein Array sein.');
    } else {
      seiten.forEach((s, j) => {
        const sp = `${p}.seiten[${j}]`;
        if (!isRecord(s)) {
          sink(sp, 'Seite ist kein Objekt.');
          return;
        }
        reqStr(sink, s, 'text', `${sp}.text`);
        const ctrl = s['steuerelemente'];
        if (ctrl !== undefined) {
          if (!isArr(ctrl)) {
            sink(`${sp}.steuerelemente`, 'steuerelemente muss ein Array sein.');
          } else {
            ctrl.forEach((c, k) => {
              const cp = `${sp}.steuerelemente[${k}]`;
              if (!isRecord(c)) {
                sink(cp, 'Steuerelement ist kein Objekt.');
                return;
              }
              const art = c['art'];
              if (!isStr(art) || !['farbe', 'pause', 'variable', 'auswahl'].includes(art)) {
                sink(`${cp}.art`, "art muss 'farbe' | 'pause' | 'variable' | 'auswahl' sein.");
              }
              reqStr(sink, c, 'wert', `${cp}.wert`);
            });
          }
        }
      });
    }
    const delta = e['delta'];
    if (delta !== undefined) {
      if (!isRecord(delta)) {
        sink(`${p}.delta`, 'delta ist kein Objekt.');
      } else {
        reqStr(sink, delta, 'guardHash', `${p}.delta.guardHash`, (v) =>
          v.length > 0 ? null : 'guardHash darf nicht leer sein.',
        );
        const idx = delta['ersetztOriginalIndex'];
        if (idx !== undefined && (!isInt(idx) || (idx as number) < 0)) {
          sink(`${p}.delta.ersetztOriginalIndex`, 'ersetztOriginalIndex muss eine ganze Zahl ≥ 0 sein.');
        }
      }
    }
  });
  return errors;
}

export function validateScriptGraphDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'entitaet', 'entitaet');
  checkSlot(sink, doc['slot'], 'slot');
  const knoten = doc['knoten'];
  if (!isArr(knoten)) {
    sink('knoten', 'knoten muss ein Array sein.');
    return errors;
  }
  knoten.forEach((n, i) => {
    const p = `knoten[${i}]`;
    if (!isRecord(n)) {
      sink(p, 'Knoten ist kein Objekt.');
      return;
    }
    reqStr(sink, n, 'id', `${p}.id`);
    const kat = n['kategorie'];
    if (!isStr(kat) || !(SCRIPT_KATEGORIEN as readonly string[]).includes(kat)) {
      sink(`${p}.kategorie`, `kategorie muss eine der neun Taxonomie-Kategorien sein (${SCRIPT_KATEGORIEN.join(' | ')}).`);
    }
    reqStr(sink, n, 'op', `${p}.op`, (v) => (v.length > 0 ? null : 'op (Mnemonic) darf nicht leer sein.'));
    const ops = n['operanden'];
    if (ops !== undefined) {
      if (!isRecord(ops)) {
        sink(`${p}.operanden`, 'operanden muss ein Objekt sein.');
      } else {
        for (const [k, v] of Object.entries(ops)) {
          if (!isStr(v) && !isNum(v)) sink(`${p}.operanden.${k}`, 'Operand muss String oder Zahl sein.');
        }
      }
    }
    if (!isBool(n['blockierend'])) sink(`${p}.blockierend`, 'blockierend muss ein Boolean sein.');
    checkVec2(sink, n['position'], `${p}.position`);
  });
  const kanten = doc['kanten'];
  if (!isArr(kanten)) {
    sink('kanten', 'kanten muss ein Array sein.');
  } else {
    kanten.forEach((k, i) => {
      const p = `kanten[${i}]`;
      if (!isRecord(k)) {
        sink(p, 'Kante ist kein Objekt.');
        return;
      }
      reqStr(sink, k, 'von', `${p}.von`);
      reqStr(sink, k, 'zu', `${p}.zu`);
      if (k['bedingung'] !== undefined && !isStr(k['bedingung'])) sink(`${p}.bedingung`, 'bedingung muss ein String sein.');
    });
  }
  const refs = doc['variablenRefs'];
  if (refs !== undefined && (!isArr(refs) || !refs.every(isStr))) {
    sink('variablenRefs', 'variablenRefs muss ein String-Array sein.');
  }
  return errors;
}

export function validateCharacterDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'id', 'id');
  reqStr(sink, doc, 'name', 'name');
  const modell = doc['modell'];
  if (!isRecord(modell)) {
    sink('modell', 'modell ist kein Objekt.');
  } else {
    const art = modell['art'];
    if (art === 'referenz') {
      reqStr(sink, modell, 'ref', 'modell.ref');
    } else if (art === 'textur-override') {
      reqStr(sink, modell, 'ref', 'modell.ref');
      reqStr(sink, modell, 'texturAsset', 'modell.texturAsset', (v) =>
        v.length > 0 ? null : 'texturAsset darf nicht leer sein.',
      );
    } else {
      sink('modell.art', "modell.art muss 'referenz' | 'textur-override' sein.");
    }
  }
  const kollision = doc['kollision'];
  if (!isRecord(kollision)) {
    sink('kollision', 'kollision ist kein Objekt.');
  } else {
    reqNum(sink, kollision, 'radius', 'kollision.radius');
    reqNum(sink, kollision, 'hoehe', 'kollision.hoehe');
  }
  const auftritte = doc['auftritte'];
  if (!isArr(auftritte)) {
    sink('auftritte', 'auftritte muss ein Array sein.');
  } else {
    auftritte.forEach((a, i) => {
      const p = `auftritte[${i}]`;
      if (!isRecord(a)) {
        sink(p, 'Auftritt ist kein Objekt.');
        return;
      }
      reqStr(sink, a, 'field', `${p}.field`);
      if (!isInt(a['dreieck']) || (a['dreieck'] as number) < 0) sink(`${p}.dreieck`, 'dreieck muss eine ganze Zahl ≥ 0 sein.');
      checkVec3(sink, a['position'], `${p}.position`);
      reqNum(sink, a, 'richtung', `${p}.richtung`);
      const scripts = a['scripts'];
      if (!isRecord(scripts)) {
        sink(`${p}.scripts`, 'scripts muss ein Objekt (Slot → Referenz) sein.');
      } else {
        for (const [k, v] of Object.entries(scripts)) {
          if (!(SLOT_ARTEN as readonly string[]).includes(k)) sink(`${p}.scripts.${k}`, `Unbekannter Slot '${k}'.`);
          if (!isStr(v)) sink(`${p}.scripts.${k}`, 'Script-Referenz muss ein String sein.');
        }
      }
    });
  }
  return errors;
}

export function validateFieldDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'id', 'id');
  if (doc['hintergrundAsset'] !== undefined && !isStr(doc['hintergrundAsset'])) {
    sink('hintergrundAsset', 'hintergrundAsset muss ein String sein.');
  }
  const walkmesh = doc['walkmesh'];
  if (!isRecord(walkmesh) || !isArr(walkmesh['dreiecke'])) {
    sink('walkmesh', 'walkmesh.dreiecke muss ein Array sein.');
  } else {
    walkmesh['dreiecke'].forEach((t, i) => {
      const p = `walkmesh.dreiecke[${i}]`;
      if (!isRecord(t)) {
        sink(p, 'Dreieck ist kein Objekt.');
        return;
      }
      checkVec3Tuple(sink, t['a'], `${p}.a`);
      checkVec3Tuple(sink, t['b'], `${p}.b`);
      checkVec3Tuple(sink, t['c'], `${p}.c`);
      const adj = t['adjazent'];
      if (!isArr(adj) || adj.length !== 3 || !adj.every((x) => x === null || (isInt(x) && (x as number) >= 0))) {
        sink(`${p}.adjazent`, 'adjazent muss ein Tripel aus (number | null) sein.');
      }
    });
  }
  const kameras = doc['kameras'];
  if (!isArr(kameras)) {
    sink('kameras', 'kameras muss ein Array sein.');
  } else {
    kameras.forEach((k, i) => {
      const p = `kameras[${i}]`;
      if (!isRecord(k)) {
        sink(p, 'Kamera ist kein Objekt.');
        return;
      }
      checkVec3(sink, k['position'], `${p}.position`);
      checkVec3(sink, k['ziel'], `${p}.ziel`);
      reqNum(sink, k, 'fovBasis', `${p}.fovBasis`);
    });
  }
  const trigger = doc['trigger'];
  if (!isArr(trigger)) {
    sink('trigger', 'trigger muss ein Array sein.');
  } else {
    trigger.forEach((t, i) => {
      const p = `trigger[${i}]`;
      if (!isRecord(t)) {
        sink(p, 'Trigger ist kein Objekt.');
        return;
      }
      reqStr(sink, t, 'id', `${p}.id`);
      if (!isArr(t['eckpunkte'])) {
        sink(`${p}.eckpunkte`, 'eckpunkte muss ein Array sein.');
      } else {
        t['eckpunkte'].forEach((e, j) => checkVec3(sink, e, `${p}.eckpunkte[${j}]`));
      }
      reqStr(sink, t, 'scriptRef', `${p}.scriptRef`);
    });
  }
  const gateways = doc['gateways'];
  if (!isArr(gateways)) {
    sink('gateways', 'gateways muss ein Array sein.');
  } else {
    gateways.forEach((g, i) => {
      const p = `gateways[${i}]`;
      if (!isRecord(g)) {
        sink(p, 'Gateway ist kein Objekt.');
        return;
      }
      reqStr(sink, g, 'zielField', `${p}.zielField`);
      if (!isInt(g['zielDreieck']) || (g['zielDreieck'] as number) < 0) {
        sink(`${p}.zielDreieck`, 'zielDreieck muss eine ganze Zahl ≥ 0 sein.');
      }
      checkVec3(sink, g['zielPosition'], `${p}.zielPosition`);
    });
  }
  return errors;
}

export function validateFieldDeltaDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'zielField', 'zielField');
  const ops = doc['operationen'];
  if (!isArr(ops)) {
    sink('operationen', 'operationen muss ein Array sein.');
    return errors;
  }
  ops.forEach((o, i) => {
    const p = `operationen[${i}]`;
    if (!isRecord(o)) {
      sink(p, 'Operation ist kein Objekt.');
      return;
    }
    const op = o['op'];
    if (!isStr(op) || !(FIELD_DELTA_OPS as readonly string[]).includes(op)) {
      sink(`${p}.op`, `op muss einer von ${FIELD_DELTA_OPS.join(' | ')} sein.`);
    }
    const anker = o['anker'];
    if (!isRecord(anker)) {
      sink(`${p}.anker`, 'anker ist kein Objekt.');
    } else {
      reqStr(sink, anker, 'entity', `${p}.anker.entity`);
      checkSlot(sink, anker['slot'], `${p}.anker.slot`);
      if (!isInt(anker['ipOffset']) || (anker['ipOffset'] as number) < 0) {
        sink(`${p}.anker.ipOffset`, 'ipOffset muss eine ganze Zahl ≥ 0 sein.');
      }
    }
    reqStr(sink, o, 'guardHash', `${p}.guardHash`, (v) => (v.length > 0 ? null : 'guardHash darf nicht leer sein.'));
    if (o['payload'] !== undefined && !isStr(o['payload'])) sink(`${p}.payload`, 'payload muss ein String sein.');
  });
  return errors;
}

export function validateVariablesDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  const benannt = doc['benannt'];
  if (!isArr(benannt)) {
    sink('benannt', 'benannt muss ein Array sein.');
    return errors;
  }
  benannt.forEach((b, i) => {
    const p = `benannt[${i}]`;
    if (!isRecord(b)) {
      sink(p, 'Eintrag ist kein Objekt.');
      return;
    }
    reqStr(sink, b, 'name', `${p}.name`, (v) => (v.trim().length > 0 ? null : 'name darf nicht leer sein.'));
    if (b['bank'] !== undefined && (!isInt(b['bank']) || (b['bank'] as number) < 0 || (b['bank'] as number) > 15)) {
      sink(`${p}.bank`, 'bank muss eine ganze Zahl in 0..15 sein.');
    }
    if (b['adresse'] !== undefined && (!isInt(b['adresse']) || (b['adresse'] as number) < 0 || (b['adresse'] as number) > 255)) {
      sink(`${p}.adresse`, 'adresse muss eine ganze Zahl in 0..255 sein.');
    }
    if (b['kommentar'] !== undefined && !isStr(b['kommentar'])) sink(`${p}.kommentar`, 'kommentar muss ein String sein.');
  });
  return errors;
}

function checkBedingung(sink: Sink, v: unknown, pfad: string): void {
  if (!isRecord(v)) {
    sink(pfad, 'Bedingung ist kein Objekt.');
    return;
  }
  const art = v['art'];
  if (!isStr(art) || !(VERHALTENS_BEDINGUNGEN as readonly string[]).includes(art)) {
    sink(`${pfad}.art`, `Unbekannte Bedingung — art muss eine der geschlossenen Menge sein (${VERHALTENS_BEDINGUNGEN.join(' | ')}).`);
    return;
  }
  switch (art as VerhaltensBedingungArt) {
    case 'hp_unter':
    case 'mp_unter':
      reqNum(sink, v, 'prozent', `${pfad}.prozent`, (n) => (n > 0 && n <= 100 ? null : 'prozent muss in (0, 100] liegen.'));
      break;
    case 'runde_jede':
    case 'gruppenmitglieder_unter':
      if (!isInt(v['n']) || (v['n'] as number) < 1) sink(`${pfad}.n`, 'n muss eine ganze Zahl ≥ 1 sein.');
      break;
    case 'ziel_hat_status': {
      const status = v['status'];
      if (!isStr(status) || !(STATUSWERTE as readonly string[]).includes(status)) {
        sink(`${pfad}.status`, `status muss aus der geschlossenen Statusliste sein (${STATUSWERTE.join(' | ')}).`);
      }
      break;
    }
    case 'immer':
      break;
  }
}

function checkBeuteEintrag(sink: Sink, v: unknown, pfad: string): void {
  if (!isRecord(v)) {
    sink(pfad, 'Beute-Eintrag ist kein Objekt.');
    return;
  }
  reqStr(sink, v, 'itemRef', `${pfad}.itemRef`, (s) => (s.length > 0 ? null : 'itemRef darf nicht leer sein.'));
  reqNum(sink, v, 'rate', `${pfad}.rate`);
}

export function validateEnemyDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'id', 'id');
  reqStr(sink, doc, 'name', 'name', (v) => (v.trim().length > 0 ? null : 'name darf nicht leer sein.'));
  if (doc['beschreibung'] !== undefined && !isStr(doc['beschreibung'])) {
    sink('beschreibung', 'beschreibung muss ein String sein.');
  }
  const modell = doc['modell'];
  if (!isRecord(modell)) {
    sink('modell', 'modell ist kein Objekt.');
  } else {
    const art = modell['art'];
    if (art === 'referenz') {
      reqStr(sink, modell, 'ref', 'modell.ref');
    } else if (art === 'textur-override') {
      reqStr(sink, modell, 'ref', 'modell.ref');
      reqStr(sink, modell, 'texturAsset', 'modell.texturAsset', (v) =>
        v.length > 0 ? null : 'texturAsset darf nicht leer sein.',
      );
    } else if (art === 'baukasten' || art === 'gltf') {
      // Reserviert (MS9/MS6): im Typ zugelassen, Payload-Struktur offen —
      // die fachliche Validierung meldet die Sperre als Info.
    } else {
      sink('modell.art', "modell.art muss 'referenz' | 'textur-override' | 'baukasten' (MS9) | 'gltf' (MS6) sein.");
    }
  }
  const stats = doc['stats'];
  if (!isRecord(stats)) {
    sink('stats', 'stats ist kein Objekt.');
  } else {
    for (const key of Object.keys(ENEMY_STAT_BAND) as (keyof EnemyStats)[]) {
      reqNum(sink, stats, key, `stats.${key}`);
    }
  }
  const aff = doc['affinitaeten'];
  if (!isRecord(aff)) {
    sink('affinitaeten', 'affinitaeten ist kein Objekt.');
  } else {
    const elemente = aff['elemente'];
    if (!isRecord(elemente)) {
      sink('affinitaeten.elemente', 'affinitaeten.elemente muss ein Objekt (Element → Zustand) sein.');
    } else {
      for (const [k, v] of Object.entries(elemente)) {
        if (!(ELEMENTE as readonly string[]).includes(k)) {
          sink(`affinitaeten.elemente.${k}`, `Unbekanntes Element '${k}' — geschlossene Liste: ${ELEMENTE.join(' | ')}.`);
          continue;
        }
        if (!isStr(v) || !(ELEMENT_AFFINITAETEN as readonly string[]).includes(v)) {
          sink(`affinitaeten.elemente.${k}`, `Affinität muss einer der fünf Zustände sein (${ELEMENT_AFFINITAETEN.join(' | ')}).`);
        }
      }
    }
    const immun = aff['statusImmunitaeten'];
    if (!isArr(immun)) {
      sink('affinitaeten.statusImmunitaeten', 'statusImmunitaeten muss ein Array sein.');
    } else {
      immun.forEach((s, i) => {
        if (!isStr(s) || !(STATUSWERTE as readonly string[]).includes(s)) {
          sink(`affinitaeten.statusImmunitaeten[${i}]`, `Status muss aus der geschlossenen Statusliste sein (${STATUSWERTE.join(' | ')}).`);
        }
      });
    }
  }
  const angriffe = doc['angriffe'];
  if (!isArr(angriffe)) {
    sink('angriffe', 'angriffe muss ein Array sein.');
  } else {
    angriffe.forEach((a, i) => {
      const p = `angriffe[${i}]`;
      if (!isRecord(a)) {
        sink(p, 'Angriff ist kein Objekt.');
        return;
      }
      reqStr(sink, a, 'id', `${p}.id`);
      reqStr(sink, a, 'name', `${p}.name`);
      checkEffekt(sink, a['effekt'], `${p}.effekt`);
      if (a['kosten'] !== undefined && (!isNum(a['kosten']) || (a['kosten'] as number) < 0)) {
        sink(`${p}.kosten`, 'kosten muss eine Zahl ≥ 0 sein.');
      }
      if (a['zielregel'] !== undefined && !isStr(a['zielregel'])) sink(`${p}.zielregel`, 'zielregel muss ein String sein.');
    });
  }
  const verhalten = doc['verhalten'];
  if (!isRecord(verhalten)) {
    sink('verhalten', 'verhalten ist kein Objekt.');
  } else {
    if (verhalten['art'] !== 'prioritaeten') {
      sink('verhalten.art', "verhalten.art muss 'prioritaeten' sein (deklarative KI, ADR-024).");
    }
    const regeln = verhalten['regeln'];
    if (!isArr(regeln)) {
      sink('verhalten.regeln', 'verhalten.regeln muss ein Array sein.');
    } else {
      regeln.forEach((r, i) => {
        const p = `verhalten.regeln[${i}]`;
        if (!isRecord(r)) {
          sink(p, 'Regel ist kein Objekt.');
          return;
        }
        checkBedingung(sink, r['wenn'], `${p}.wenn`);
        reqStr(sink, r, 'dann', `${p}.dann`);
        reqNum(sink, r, 'gewicht', `${p}.gewicht`, (n) => (n > 0 ? null : 'gewicht muss > 0 sein.'));
      });
    }
  }
  const beute = doc['beute'];
  if (!isRecord(beute)) {
    sink('beute', 'beute ist kein Objekt.');
  } else {
    const drops = beute['drops'];
    if (!isArr(drops)) {
      sink('beute.drops', 'beute.drops muss ein Array sein.');
    } else {
      drops.forEach((d, i) => checkBeuteEintrag(sink, d, `beute.drops[${i}]`));
    }
    const stehlen = beute['stehlen'];
    if (!isArr(stehlen)) {
      sink('beute.stehlen', 'beute.stehlen muss ein Array sein.');
    } else {
      stehlen.forEach((d, i) => checkBeuteEintrag(sink, d, `beute.stehlen[${i}]`));
    }
    if (beute['morph'] !== undefined && !isStr(beute['morph'])) sink('beute.morph', 'morph muss ein String (itemRef) sein.');
  }
  const tags = doc['formationTags'];
  if (!isArr(tags) || !tags.every(isStr)) sink('formationTags', 'formationTags muss ein String-Array sein.');
  return errors;
}

export function validateBattleDoc(doc: unknown): StructureError[] {
  const { sink, errors } = makeSink();
  if (!isRecord(doc)) {
    sink('', 'Dokument ist kein Objekt.');
    return errors;
  }
  reqSchemaVersion(sink, doc);
  reqStr(sink, doc, 'id', 'id');
  reqStr(sink, doc, 'name', 'name', (v) => (v.trim().length > 0 ? null : 'name darf nicht leer sein.'));
  const arena = doc['arena'];
  if (!isRecord(arena)) {
    sink('arena', 'arena ist kein Objekt.');
  } else {
    const art = arena['art'];
    if (art === 'referenz') {
      reqStr(sink, arena, 'ref', 'arena.ref');
    } else if (art === 'nutzerbild') {
      reqStr(sink, arena, 'asset', 'arena.asset', (v) => (v.length > 0 ? null : 'asset darf nicht leer sein.'));
    } else {
      sink('arena.art', "arena.art muss 'referenz' | 'nutzerbild' sein.");
    }
  }
  const formation = doc['formation'];
  if (!isRecord(formation)) {
    sink('formation', 'formation ist kein Objekt.');
  } else {
    const reihen = formation['reihen'];
    if (!isArr(reihen)) {
      sink('formation.reihen', 'formation.reihen muss ein Array sein.');
    } else {
      reihen.forEach((r, i) => {
        const p = `formation.reihen[${i}]`;
        if (!isRecord(r)) {
          sink(p, 'Reihe ist kein Objekt.');
          return;
        }
        reqStr(sink, r, 'enemyRef', `${p}.enemyRef`, (v) => (v.length > 0 ? null : 'enemyRef darf nicht leer sein.'));
        if (!isInt(r['anzahl'])) sink(`${p}.anzahl`, 'anzahl muss eine ganze Zahl sein.');
        const pos = r['position'];
        if (!isRecord(pos) || !isNum(pos['x']) || !isNum(pos['z'])) {
          sink(`${p}.position`, 'position {x, z} erwartet.');
        }
        const flags = r['flags'];
        if (flags !== undefined && (!isArr(flags) || !flags.every(isStr))) {
          sink(`${p}.flags`, 'flags muss ein String-Array sein.');
        }
      });
    }
    if (!isInt(formation['maxGleichzeitig']) || (formation['maxGleichzeitig'] as number) < 1) {
      sink('formation.maxGleichzeitig', 'maxGleichzeitig muss eine ganze Zahl ≥ 1 sein.');
    }
  }
  const regeln = doc['regeln'];
  if (!isRecord(regeln)) {
    sink('regeln', 'regeln ist kein Objekt.');
  } else {
    const flucht = regeln['flucht'];
    if (!isStr(flucht) || !(FLUCHT_REGELN as readonly string[]).includes(flucht)) {
      sink('regeln.flucht', `flucht muss einer von ${FLUCHT_REGELN.join(' | ')} sein.`);
    }
    const hinterhalt = regeln['hinterhalt'];
    if (hinterhalt !== undefined && (!isStr(hinterhalt) || !(HINTERHALT_ARTEN as readonly string[]).includes(hinterhalt))) {
      sink('regeln.hinterhalt', `hinterhalt muss einer von ${HINTERHALT_ARTEN.join(' | ')} sein.`);
    }
    if (regeln['siegbedingung'] !== 'alle-besiegt') {
      sink('regeln.siegbedingung', "siegbedingung muss 'alle-besiegt' sein (MVP, geschlossen — MS16).");
    }
  }
  if (doc['musikRef'] !== undefined && !isStr(doc['musikRef'])) sink('musikRef', 'musikRef muss ein String sein.');
  const belohnung = doc['belohnung'];
  if (!isRecord(belohnung)) {
    sink('belohnung', 'belohnung ist kein Objekt.');
  } else {
    for (const key of ['expMod', 'apMod', 'gilMod'] as const) {
      if (belohnung[key] !== undefined && !isNum(belohnung[key])) sink(`belohnung.${key}`, `${key} muss eine Zahl sein.`);
    }
    const garantiert = belohnung['garantierteDrops'];
    if (garantiert !== undefined) {
      if (!isArr(garantiert)) {
        sink('belohnung.garantierteDrops', 'garantierteDrops muss ein Array sein.');
      } else {
        garantiert.forEach((d, i) => {
          const p = `belohnung.garantierteDrops[${i}]`;
          if (!isRecord(d)) {
            sink(p, 'Drop-Eintrag ist kein Objekt.');
            return;
          }
          reqStr(sink, d, 'itemRef', `${p}.itemRef`, (v) => (v.length > 0 ? null : 'itemRef darf nicht leer sein.'));
        });
      }
    }
  }
  const verknuepfung = doc['verknuepfung'];
  if (verknuepfung !== undefined) {
    if (!isRecord(verknuepfung)) {
      sink('verknuepfung', 'verknuepfung ist kein Objekt.');
    } else if ('feldRef' in verknuepfung) {
      reqStr(sink, verknuepfung, 'feldRef', 'verknuepfung.feldRef');
      reqStr(sink, verknuepfung, 'encounterZone', 'verknuepfung.encounterZone');
    } else if ('scriptStart' in verknuepfung) {
      reqStr(sink, verknuepfung, 'scriptStart', 'verknuepfung.scriptStart');
    } else {
      sink('verknuepfung', 'verknuepfung muss {feldRef, encounterZone} oder {scriptStart} sein.');
    }
  }
  return errors;
}

/** Strukturvalidierer je Dokumenttyp (für Store/Validierung zugreifbar). */
export const STRUCTURAL_VALIDATORS: Readonly<Record<DocumentKind, (doc: unknown) => StructureError[]>> = {
  project: validateProjectDoc,
  dialogue: validateDialogueDoc,
  scriptGraph: validateScriptGraphDoc,
  character: validateCharacterDoc,
  field: validateFieldDoc,
  fieldDelta: validateFieldDeltaDoc,
  variables: validateVariablesDoc,
  enemy: validateEnemyDoc,
  battle: validateBattleDoc,
};
