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

export interface Submesh {
  /** Startindex (in Indices) und Anzahl der Indices. */
  start: number;
  count: number;
  textured: boolean;
  /** Index in die RSD-Texturliste (nur texturiert). */
  textureIndex: number;
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
  diagnostics: ModelDiagnostic[];
}

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
