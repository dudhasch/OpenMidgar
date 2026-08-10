/**
 * NAM-Typen der Weltkarte (S28). Grundlage sind ausschließlich die
 * realdaten-belegten Fakten aus `tools/realdata-scan/FINDINGS.md` (Abschnitt
 * S28): Blockgrammatik 85/85, Mesh-Grammatik 1360/1360 byteexakt,
 * Nahtstetigkeit 828/828, Raster WM0 9×7 (Blöcke 0–62 + 6 Alternativblöcke),
 * WM2 3×4; WM3-Anordnung ist eine dokumentierte Annahme (2×2, 🟡 — die
 * Messung ist dort blind, s. FINDINGS).
 */

export const WORLD_BLOCK_BYTES = 0xb800;
export const WORLD_MESHES_PER_BLOCK = 16;
/** Meshes je Block liegen als 4×4-Raster (Zeile = Index div 4). */
export const WORLD_MESH_GRID = 4;
/** Lokaler Grundriss eines Meshes: x,z ∈ [0, 8192]. */
export const WORLD_MESH_EXTENT = 8192;
/** Grundriss eines Blocks: 4 · 8192. */
export const WORLD_BLOCK_EXTENT = WORLD_MESH_GRID * WORLD_MESH_EXTENT;

export interface WorldGrid {
  cols: number;
  rows: number;
  /** Blöcke ab diesem Index sind Alternativblöcke (Story-Varianten). */
  primaryBlocks: number;
  /** 🟢 gemessen oder 🟡 Annahme — s. FINDINGS. */
  belegt: boolean;
}

/** Rasterkonstanten je Kartendatei (Messstand 2026-08-10). */
export const WORLD_GRIDS: Record<'wm0' | 'wm2' | 'wm3', WorldGrid> = {
  wm0: { cols: 9, rows: 7, primaryBlocks: 63, belegt: true },
  wm2: { cols: 3, rows: 4, primaryBlocks: 12, belegt: true },
  // 🟡 Annahme: die Naht-Messung ist bei WM3 blind (12 Unikate auf 64 Meshes).
  wm3: { cols: 2, rows: 2, primaryBlocks: 4, belegt: false },
};

export interface WorldTriangle {
  /** Vertexindizes (u8 — ein Mesh trägt höchstens 256 Vertices). */
  v0: number;
  v1: number;
  v2: number;
  /** Untere 5 Bits von Byte 3 — Wertevielfalt belegt, Semantik 🟡. */
  walkClass: number;
  /** Obere 3 Bits von Byte 3 — 🟡. */
  attrHigh: number;
  /** 6 UV-Bytes (Deutung 🟡, roh konserviert). */
  uv: [number, number, number, number, number, number];
  /** u16 Texturwort (Deutung 🟡, roh konserviert). */
  textureWord: number;
}

export interface WorldMesh {
  triCount: number;
  vertCount: number;
  triangles: WorldTriangle[];
  /** Je Vertex x,h,z (i16) — h ist die Höhe, x/z der lokale Grundriss. */
  positions: Int16Array;
  /** Das vierte u16 je Vertex, roh konserviert (🟡). */
  vertexSpare: Uint16Array;
  /** Je Vertex nx,ny,nz (i16) + Reserve, roh konserviert. */
  normals: Int16Array;
  normalSpare: Uint16Array;
}

export interface WorldBlock {
  index: number;
  /** 16 Meshes im 4×4-Raster; ein quarantiniertes Mesh ist null. */
  meshes: Array<WorldMesh | null>;
}

export type WorldDiagnosticCode = 'E-WLD-SIZE' | 'E-WLD-TABLE' | 'E-WLD-MESH';

export interface WorldDiagnostic {
  code: WorldDiagnosticCode;
  blockIndex: number;
  meshIndex?: number;
  message: string;
}

export interface WorldTerrain {
  /** Ein quarantinierter Block ist null (Loch mit Diagnose, kein Absturz). */
  blocks: Array<WorldBlock | null>;
  diagnostics: WorldDiagnostic[];
}
