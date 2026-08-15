import type { ModelDiagnostic } from './diagnostics.js';

/**
 * NAM-Typen der Modellkette (Masterplan 1.2/1.3): reine Daten, strukturiert
 * klonbar. Komposition zum FieldModel ist Runtime-Sache (render-actor),
 * Parser bleiben formatlokal.
 */

export interface SkeletonBone {
  name: string;
  /** −1 = Wurzel. Nach topologischer Sortierung gilt parentIndex < index. */
  parentIndex: number;
  length: number;
  /** RSD-Basisnamen (kleingeschrieben, ohne Endung). */
  resourceRefs: string[];
  /** Position in der Originaldatei — Animationsframes adressieren 🟡 in Dateireihenfolge. */
  fileOrder: number;
}

export interface Skeleton {
  schemaVersion: 1;
  name: string;
  bones: SkeletonBone[];
  /** FNV-1a-32 über (Bone-Zahl, Parent-Topologie) — Animationskompatibilität. */
  topologyHash: number;
  diagnostics: ModelDiagnostic[];
}

export interface ResourceBinding {
  schemaVersion: 1;
  /** Basisname des .p-Modells (aus PLY=…, Alt-Endung auf .p abgebildet). */
  meshRef: string;
  /** Geordnet — Gruppen indizieren hinein (Reihenfolge ist Semantik). */
  textureRefs: string[];
  diagnostics: ModelDiagnostic[];
}

/**
 * Materialklasse einer `.p`-Gruppe (`p_group+0x00`). Die fünf Klassen des
 * Originals — C, G, T, D, H — und, was hier zählt, ihr Schattierungsmodus:
 *
 * | Wert | Kürzel | Bedeutung           | Schattierung |
 * |------|--------|---------------------|--------------|
 * | 0    | C      | Farbe, flach        | FLAT         |
 * | 1    | G      | Gouraud             | GOURAUD      |
 * | 2    | T      | Textur, flach       | FLAT         |
 * | 3    | D      | Farbe + Textur      | FLAT         |
 * | 4    | H      | Gouraud + Textur    | GOURAUD      |
 *
 * 🟡 **Herkunft** (ADR-027/A2): Dekompilat `ff7_en.exe`,
 * `Pfile_BuildHundredFromMaterial` (0x00694E05) setzt aus genau dieser Klasse
 * `p_hundred.shadeMode` (D3DSHADE_FLAT 1 / D3DSHADE_GOURAUD 2), und
 * `D3D5ApplyRenderState` (0x006A3D30) schreibt ihn je Gruppe als
 * `D3DRENDERSTATE_SHADEMODE`. Gegenprobe an unseren Daten steht aus.
 */
export type MaterialClass = 0 | 1 | 2 | 3 | 4;

/** Die Klassen C/T/D — im Original D3DSHADE_FLAT. */
export function isFlatShaded(kind: number): boolean {
  return kind === 0 || kind === 2 || kind === 3;
}

export interface Submesh {
  /** Startindex (in Indices) und Anzahl der Indices. */
  start: number;
  count: number;
  textured: boolean;
  /** Index in die RSD-Texturliste (nur texturiert). */
  textureIndex: number;
  /** Materialklasse der Gruppe — siehe {@link MaterialClass}. */
  materialClass: MaterialClass;
  /**
   * `true`, wenn das Original diese Gruppe FLAT schattiert. Gelesen wird
   * `p_hundred+0x24` (der Renderstate, den die Engine ausgibt), nicht die
   * Materialklasse. Der Parser hat die Folge bereits eingebacken — Farbe und
   * Normale der ersten Ecke stehen an allen drei Ecken des Dreiecks —, das
   * Flag ist also Diagnose, nicht Renderbefehl.
   */
  flatShaded: boolean;
  /**
   * FF7-Blendmodus des Renderstate-Blocks (`p_hundred+0x44`): 0 normal-Alpha,
   * 1 additiv, 2 invsrccolor, 3 Viertel-additiv, 4 deckend.
   *
   * 🟡 **Noch nicht ausgewertet.** Für Feldfiguren ist das fast folgenlos —
   * 4852 der 4875 `char.lgp`-Blöcke tragen 4, und der Feldlader übergibt
   * Modus 6 („behalte den gespeicherten"), plättet also nichts. Die 23
   * übrigen Gruppen (10× Modus 0, 2× 1, 11× 3) rendern wir derzeit deckend.
   */
  blendMode: number;
}

export interface MeshSource {
  schemaVersion: 1;
  /** Vereinheitlichter Vertexstream nach Index-Flattening. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** RGBA je Vertex (normalisiert 0–255). */
  colors: Uint8Array;
  indices: Uint32Array;
  submeshes: Submesh[];
  /** Anzahl ausgelassener (defekter) Gruppen (W-P-GROUP). */
  droppedGroups: number;
  diagnostics: ModelDiagnostic[];
}

export interface TextureSource {
  schemaVersion: 1;
  width: number;
  height: number;
  /** Alle Paletten als RGBA8-Farbtabellen (NAM konserviert sämtliche). */
  palettes: Uint8Array[];
  /** Palettenindizierte Pixel (8 bpp) — Dekodierung via toRgba. */
  pixelIndices: Uint8Array;
  diagnostics: ModelDiagnostic[];
}

export interface AnimationFrame {
  /** Grad; Rohreihenfolge Rotation vor Translation (realdaten-validierte Framegröße 24+12n). */
  rootRotation: [number, number, number];
  rootTranslation: [number, number, number];
  /** Grad, flach [x0,y0,z0, x1,…] in Bone-Dateireihenfolge (🟡 R4). */
  rotations: Float32Array;
}

export interface AnimationClipSource {
  schemaVersion: 1;
  boneCount: number;
  frames: AnimationFrame[];
  /**
   * Rotationsreihenfolge aus dem Dateikopf, als Achsenfolge (0 = X/alpha,
   * 1 = Y/beta, 2 = Z/gamma). 🟢 Realdaten-belegt: In allen 3209 `.a`-Dateien
   * der Installation steht [1, 0, 2] = **YXZ**, und die beiden
   * Kontrollversätze treffen in exakt 0 Fällen.
   *
   * Das Feld wird mitgeführt, statt die Reihenfolge fest zu verdrahten — sie
   * ist nachweislich ein **Datum der Datei**, keine Konstante der Engine.
   * Weicht eine Datei ab, meldet der Parser `W-ANIM-ROTORDER`, statt still
   * falsch zu rechnen.
   */
  rotationOrder: [number, number, number];
  diagnostics: ModelDiagnostic[];
}

/** Die einzige in freier Wildbahn belegte Reihenfolge: YXZ. */
export const ROTATION_ORDER_YXZ: readonly [number, number, number] = [1, 0, 2];

export function fnv1a32Numbers(values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    // 4 Bytes je Wert, little-endian gefaltet.
    for (let s = 0; s < 32; s += 8) {
      h ^= (value >>> s) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}
