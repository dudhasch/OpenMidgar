import {
  WORLD_MESH_EXTENT,
  WORLD_MESH_GRID,
  type WorldGrid,
  type WorldTerrain,
} from '@webmidgar/formats-world';
import { cellAt, cellToBlockIndex, wrapCell } from './layout.js';

/**
 * Höhen- und Klassenabfrage über dem Terrain (S28) — Node-testbar, arbeitet
 * in Weltkoordinaten. Grundlage der Objektplatzierung (S28) und der
 * Fahrzeug-Geländeprüfung (S29).
 */

export interface GroundSample {
  height: number;
  /** Geländeklasse des getroffenen Dreiecks (Semantik 🟡 — Daten, kein Urteil). */
  walkClass: number;
  blockIndex: number;
  meshIndex: number;
  triangleIndex: number;
}

/**
 * Tastet den Boden unter (x, z) ab. Die Karte wiederholt sich: Koordinaten
 * außerhalb des Primärrasters werden gewickelt. Löcher (quarantinierte
 * Blöcke/Meshes, degenerierte Abdeckung) liefern null — nie einen Ratewert.
 */
export function sampleGround(terrain: WorldTerrain, grid: WorldGrid, x: number, z: number): GroundSample | null {
  const cell = wrapCell(cellAt(x, z), grid);
  const blockIndex = cellToBlockIndex(cell, grid);
  const block = terrain.blocks[blockIndex];
  if (!block) return null;
  const extent = WORLD_MESH_EXTENT;
  const mod = (v: number, m: number): number => ((v % m) + m) % m;
  const lokalX = mod(x, extent * WORLD_MESH_GRID);
  const lokalZ = mod(z, extent * WORLD_MESH_GRID);
  const meshCol = Math.min(WORLD_MESH_GRID - 1, Math.floor(lokalX / extent));
  const meshRow = Math.min(WORLD_MESH_GRID - 1, Math.floor(lokalZ / extent));
  const meshIndex = meshRow * WORLD_MESH_GRID + meshCol;
  const mesh = block.meshes[meshIndex];
  if (!mesh) return null;
  const mx = lokalX - meshCol * extent;
  const mz = lokalZ - meshRow * extent;

  for (let t = 0; t < mesh.triCount; t++) {
    const tri = mesh.triangles[t]!;
    const ax = mesh.positions[tri.v0 * 3]!;
    const az = mesh.positions[tri.v0 * 3 + 2]!;
    const bx = mesh.positions[tri.v1 * 3]!;
    const bz = mesh.positions[tri.v1 * 3 + 2]!;
    const cx = mesh.positions[tri.v2 * 3]!;
    const cz = mesh.positions[tri.v2 * 3 + 2]!;
    const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (det === 0) continue;
    const l0 = ((bx - mx) * (cz - mz) - (cx - mx) * (bz - mz)) / det;
    const l1 = ((cx - mx) * (az - mz) - (ax - mx) * (cz - mz)) / det;
    const l2 = 1 - l0 - l1;
    const eps = -1e-9;
    if (l0 < eps || l1 < eps || l2 < eps) continue;
    const ah = mesh.positions[tri.v0 * 3 + 1]!;
    const bh = mesh.positions[tri.v1 * 3 + 1]!;
    const ch = mesh.positions[tri.v2 * 3 + 1]!;
    return {
      height: l0 * ah + l1 * bh + l2 * ch,
      walkClass: tri.walkClass,
      blockIndex,
      meshIndex,
      triangleIndex: t,
    };
  }
  return null;
}
