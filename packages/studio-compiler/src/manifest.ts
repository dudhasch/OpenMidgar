/**
 * Manifest v2 (A-ST-2, Masterplan Teil D): v1-Wurzelfelder aus
 * WEBMIDGAR-MASTERPLAN 5.2 plus die additiven v2-Records
 * (entities[], scripts[], dialogues[].mode, variables).
 * Capabilities werden ausschließlich aus dem Projektinhalt abgeleitet,
 * nie gepflegt — ein Inhalt ohne deklarierte Capability ist strukturell
 * unmöglich.
 */

import type {
  BattleDoc,
  DialogueEntry,
  EnemyDoc,
  FieldCamera,
  FieldGateway,
  FieldTrigger,
  NamedVariable,
  SlotArt,
  Vec3,
  WalkmeshTriangle,
} from '@webmidgar/studio-core';

/** Kanonische Reihenfolge aller Manifest-Capabilities (v1 + v2). */
export const MANIFEST_CAPABILITIES = [
  'texture-override',
  'model-override',
  'background-override',
  'script-patch',
  'dialogue-replace',
  'field-add',
  'entity-add',
  'script-add',
  'dialogue-add',
  'model-add',
  'variable-claim',
] as const;
export type ManifestCapability = (typeof MANIFEST_CAPABILITIES)[number];

/**
 * Reservierte Capabilities ohne Produzenten im aktuellen Dokumentmodell
 * (UI gesperrt, A-ST-2): werden nur gesetzt, sobald entsprechende
 * Inhalte existieren — aktuell nie.
 */
export const RESERVIERTE_CAPABILITIES: readonly ManifestCapability[] = [
  'model-add',
  'model-override',
  'background-override',
];

export interface ManifestDependency {
  id: string;
  versionRange: string;
}

export interface ManifestConflict {
  id: string;
  versionRange?: string | undefined;
}

/** Override-Record (v1, `assets[]`). */
export interface ManifestAsset {
  target: string;
  source: string;
  format: string;
  variant?: string | undefined;
}

/** entity-add (v2): Platzierung einer neuen Entität in einem Field. */
export interface ManifestEntity {
  /** Mod-Namensraum: `mod:<modId>/char/<name>[.<auftritt>]`. */
  id: string;
  /** Kanonische Field-ID oder Mod-Field-ID. */
  field: string;
  modellRef: string;
  platzierung: { dreieck: number; position: Vec3; richtung: number };
  kollision: { radius: number; hoehe: number };
  scripts: Partial<Record<SlotArt, string>>;
}

/** script-add (v2): vollständig neues Script als Mnemonic-Op-Liste. */
export interface ManifestScript {
  /** Mod-Namensraum: `mod:<modId>/script/<entitaet>.<slot>`. */
  id: string;
  /** Topologisch sortierte Op-Liste; Sprungziele aufgelöst auf Knoten-IDs. */
  payload: string[];
  /** SHA-256-Digest der kanonischen Graph-Serialisierung (Source-Map-Anker). */
  quelle: string;
}

/** dialogue-replace/-add (v2 erweitert den v1-Dialog-Record um `mode`). */
export interface ManifestDialogue {
  field: string;
  locale: string;
  mode: 'replace' | 'add';
  eintraege: DialogueEntry[];
}

/** field-add (v1): NAM-nahes deklaratives Field-Dokument (ADR-014). */
export interface ManifestField {
  /** Mod-Namensraum: `mod:<modId>/field/<name>`. */
  id: string;
  /** Paketpfad des Hintergrund-Assets (`content/…`), falls vorhanden. */
  hintergrundAsset?: string | undefined;
  walkmesh: { dreiecke: WalkmeshTriangle[] };
  kameras: FieldCamera[];
  trigger: FieldTrigger[];
  gateways: FieldGateway[];
}

/** script-patch (v1): deklarativer Patch auf ein Original-Field. */
export interface ManifestPatch {
  field: string;
  anchor: { entity: string; slot: SlotArt; ipOffset: number };
  operation: 'replace-span' | 'insert-before' | 'insert-after' | 'disable-span';
  payload?: string | undefined;
  guardHash: string;
}

/**
 * variable-claim (v2): Reservierung eines Variablenbank-Bereichs.
 * MVP-Festlegung: Mod-Bereich = Bank 15; von/bis aus den deklarierten
 * Adressen abgeleitet (RS2-Kollisionsregistry ist Engine-Zukunft).
 */
export interface ManifestVariables {
  bereich: { bank: number; von: number; bis: number };
  benannteSlots: NamedVariable[];
}

export interface ManifestIntegrity {
  algo: 'sha256';
  /** Paketpfad → Hex-Digest; deckt alle Inhaltsdateien (content/…). */
  hashes: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Manifest-v3-Kandidaten (MS15/MS16)                                   */
/* ------------------------------------------------------------------ */

/**
 * 🔵 Designentscheidung (Roadmap „Ergänzungen: Manifest v3", RS12/RS13):
 * `enemy-add`/`battle-add` und die Records `enemies[]`/`battles[]` sind
 * **v3-Kandidaten**. Das v2-Schema bleibt unberührt — die Kandidaten
 * leben in einem separat markierten Erweiterungsfeld `v3Kandidaten`
 * statt als neue Wurzelfelder, bis das Battle-Modul das v3-Schema
 * fixiert. Aktivierung folgt dem S19-Muster: schema-bekannt, Import
 * vorerst verweigert mit Diagnose (Stub-Validierung, A-ST-16).
 */
export const V3_KANDIDATEN_CAPABILITIES = ['enemy-add', 'battle-add'] as const;
export type V3KandidatCapability = (typeof V3_KANDIDATEN_CAPABILITIES)[number];

/** enemy-add (v3-Kandidat): vollständiges Gegner-Datenbündel, id im Mod-Namensraum. */
export type ManifestEnemy = Omit<EnemyDoc, 'schemaVersion' | 'id'> & {
  /** Mod-Namensraum: `mod:<modId>/enemy/<name>`. */
  id: string;
};

/** battle-add (v3-Kandidat): deklaratives Begegnungs-Bündel (ADR-025), id im Mod-Namensraum. */
export type ManifestBattle = Omit<BattleDoc, 'schemaVersion' | 'id'> & {
  /** Mod-Namensraum: `mod:<modId>/battle/<name>`. */
  id: string;
};

/** Klar markierte Erweiterung am Manifest — kein Teil des v2-Schemas. */
export interface ManifestV3Kandidaten {
  capabilities: V3KandidatCapability[];
  enemies?: ManifestEnemy[] | undefined;
  battles?: ManifestBattle[] | undefined;
}

/** Manifest-Wurzel (WEBMIDGAR-MASTERPLAN 5.2 + Teil D). */
export interface ManifestV2 {
  manifestVersion: '2.0.0';
  /** = modId des Projekts. */
  id: string;
  version: string;
  name: string;
  engineCompat: string;
  dependencies: ManifestDependency[];
  conflicts: ManifestConflict[];
  capabilities: ManifestCapability[];
  assets?: ManifestAsset[] | undefined;
  entities?: ManifestEntity[] | undefined;
  scripts?: ManifestScript[] | undefined;
  dialogues?: ManifestDialogue[] | undefined;
  fields?: ManifestField[] | undefined;
  patches?: ManifestPatch[] | undefined;
  variables?: ManifestVariables | undefined;
  /**
   * Erweiterung (kein v2-Schemafeld): abgeleitete v3-Kandidaten
   * (MS15/MS16). Nur gesetzt, wenn Enemy-/Battle-Dokumente existieren.
   */
  v3Kandidaten?: ManifestV3Kandidaten | undefined;
  integrity: ManifestIntegrity;
}
