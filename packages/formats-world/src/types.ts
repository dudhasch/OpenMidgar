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

/**
 * WM0-Alternativblöcke 63–68 → ersetzte Rasterzelle. **REALDATEN-BELEGT**
 * (`world-altblock-probe`, 2026-08-10), zwei voneinander unabhängige Maße:
 *  (a) Mesh-Identität: jeder Alternativblock teilt 5–16 seiner 16 Meshes mit
 *      GENAU EINEM Primärblock, mit allen 62 übrigen 0–8;
 *  (b) Nahtstetigkeit an der Zielzelle (S28-Maß): 1,0 / 1,0 / 1,0 / 1,0 /
 *      0,967 / 0,967 gegen einen Kontrollmedian von 0,055–0,570.
 * Beide Maße liefern dieselbe Zuordnung. Der Index in dieser Liste ist der
 * Versatz zu Block 63 (Alternativblock = 63 + Index).
 */
export const WM0_ALTERNATIVE_CELLS: readonly number[] = [50, 41, 42, 60, 47, 48];

/**
 * Gruppierung der Alternativblöcke zu Umschaltstufen. 🟡 REFERENZANGABE
 * (ff7-landscaper `map-state.md`), NICHT gemessen: die Nahtprobe ist gegenüber
 * der Gruppierung blind, weil auch die Alternativblöcke perfekte Ränder zu den
 * PRIMÄRnachbarn haben (Quote 1,0) — die Änderungen liegen im Blockinneren.
 * Die Stufenzuordnung „Weltfortschritt p ⇒ Gruppen 0…p−1 getauscht" ist eine
 * 🔵 dokumentierte Eigenentscheidung; keine Quelle stellt diese Tabelle auf.
 */
export const WM0_ALTERNATIVE_GROUPS: ReadonlyArray<readonly number[]> = [[50], [41, 42], [60], [47, 48]];

/**
 * Blockindex einer Rasterzelle unter einem Weltfortschritt (0 = Urzustand).
 * Für alles außer WM0 (grid.primaryBlocks ≠ 63) ist die Zelle ihr eigener
 * Block — im Bestand hat nur WM0 Alternativblöcke.
 */
export function resolveBlockIndex(cell: number, grid: WorldGrid, worldProgress = 0): number {
  if (grid.primaryBlocks !== 63 || worldProgress <= 0) return cell;
  const stufen = Math.min(worldProgress, WM0_ALTERNATIVE_GROUPS.length);
  for (let g = 0; g < stufen; g++) {
    if (WM0_ALTERNATIVE_GROUPS[g]!.includes(cell)) {
      const idx = WM0_ALTERNATIVE_CELLS.indexOf(cell);
      if (idx >= 0) return grid.primaryBlocks + idx;
    }
  }
  return cell;
}

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
