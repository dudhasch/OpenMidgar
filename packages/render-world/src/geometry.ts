import { ff7ToScene } from '@webmidgar/convert';
import type { WorldGrid, WorldMesh } from '@webmidgar/formats-world';
import { blockIndexToCell, meshOrigin, type BlockCell } from './layout.js';

/**
 * Geometrieaufbau (S28) — bewusst Three-frei (dieselbe Haltung wie
 * tile-image/tile-atlas in render-field): reine Arrays, die eine dünne
 * Three-Schale in BufferGeometry gießt. Jeder Vertex läuft durch
 * `ff7ToScene` — es entsteht KEINE zweite Flip-Stelle (ADR-009; Test
 * vergleicht gegen die Referenzabbildung).
 */

export interface MeshGeometry {
  /** xyz je Vertex, Szenenkoordinaten. */
  positions: Float32Array;
  /** Dreiecksindizes (u16 reicht: ≤ 256 Vertices je Mesh). */
  indices: Uint16Array;
  /** Geländeklasse je Dreieck (untere 5 Attributbits, Semantik 🟡). */
  walkClasses: Uint8Array;
  triCount: number;
  vertCount: number;
}

/**
 * Baut die Szenengeometrie eines Meshes an seiner Weltposition.
 * `cellOverride` erlaubt dem Streaming, denselben Block an einer gewickelten
 * Position zu platzieren (die Karte wiederholt sich am Rand).
 */
export function buildMeshGeometry(
  mesh: WorldMesh,
  blockIndex: number,
  meshIndex: number,
  grid: WorldGrid,
  cellOverride?: BlockCell,
): MeshGeometry {
  const cell = cellOverride ?? blockIndexToCell(blockIndex, grid);
  const origin = meshOrigin(cell, meshIndex);
  const positions = new Float32Array(mesh.vertCount * 3);
  for (let i = 0; i < mesh.vertCount; i++) {
    const x = origin.x + mesh.positions[i * 3]!;
    const h = mesh.positions[i * 3 + 1]!;
    const z = origin.z + mesh.positions[i * 3 + 2]!;
    // Weltvertex (x, h, z) in FF7-Konvention: Grundriss (x, z), Höhe h.
    const scene = ff7ToScene([x, z, h]);
    positions[i * 3] = scene[0];
    positions[i * 3 + 1] = scene[1];
    positions[i * 3 + 2] = scene[2];
  }
  const indices = new Uint16Array(mesh.triCount * 3);
  const walkClasses = new Uint8Array(mesh.triCount);
  mesh.triangles.forEach((t, i) => {
    indices[i * 3] = t.v0;
    indices[i * 3 + 1] = t.v1;
    indices[i * 3 + 2] = t.v2;
    walkClasses[i] = t.walkClass;
  });
  return { positions, indices, walkClasses, triCount: mesh.triCount, vertCount: mesh.vertCount };
}
