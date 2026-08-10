import {
  WORLD_BLOCK_EXTENT,
  WORLD_MESH_EXTENT,
  WORLD_MESH_GRID,
  type WorldGrid,
} from '@webmidgar/formats-world';

/**
 * Weltkoordinaten-Arithmetik (S28). „Weltkoordinaten" heißt hier das
 * FF7-QUELLsystem der Karte: x nach Osten, z entlang der Zeilenachse des
 * Rasters, h als Höhe — VOR jeder Konvertierung in die Szene. Die einzige
 * Achsen-/Vorzeichenkonvertierung bleibt `ff7ToScene` (ADR-009).
 */

export interface BlockCell {
  col: number;
  row: number;
}

export function blockIndexToCell(index: number, grid: WorldGrid): BlockCell {
  const col = index % grid.cols;
  return { col, row: (index - col) / grid.cols };
}

export function cellToBlockIndex(cell: BlockCell, grid: WorldGrid): number {
  return cell.row * grid.cols + cell.col;
}

/** Wickelt eine Zelle auf das Primärraster (die Originalkarte wiederholt sich). */
export function wrapCell(cell: BlockCell, grid: WorldGrid): BlockCell {
  const mod = (v: number, m: number): number => ((v % m) + m) % m;
  return { col: mod(cell.col, grid.cols), row: mod(cell.row, grid.rows) };
}

/** Weltursprung (x, z) eines Blocks. */
export function blockOrigin(cell: BlockCell): { x: number; z: number } {
  return { x: cell.col * WORLD_BLOCK_EXTENT, z: cell.row * WORLD_BLOCK_EXTENT };
}

/** Weltursprung eines Meshes innerhalb seines Blocks (4×4-Raster, zeilenweise). */
export function meshOrigin(cell: BlockCell, meshIndex: number): { x: number; z: number } {
  const col = meshIndex % WORLD_MESH_GRID;
  const row = (meshIndex - col) / WORLD_MESH_GRID;
  const base = blockOrigin(cell);
  return { x: base.x + col * WORLD_MESH_EXTENT, z: base.z + row * WORLD_MESH_EXTENT };
}

/** Blockzelle unter einem Weltpunkt (ungewickelt — der Aufrufer wickelt). */
export function cellAt(x: number, z: number): BlockCell {
  return { col: Math.floor(x / WORLD_BLOCK_EXTENT), row: Math.floor(z / WORLD_BLOCK_EXTENT) };
}
