import { ff7ToScene } from '@webmidgar/convert';
import type { WorldGrid, WorldMesh } from '@webmidgar/formats-world';
import { blockIndexToCell, meshOrigin, type BlockCell } from './layout.js';
import { atlasUvForLocalPixel, type WorldTextureAtlas } from './texture-atlas.js';
import { resolveTriangleUv, type WorldTextureTable } from './uv.js';

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
  /**
   * ROHE u/v-Bytes je Dreieck (6 Stück: u0,v0,u1,v1,u2,v2), VRAM-seiten-
   * absolut. Sie hängen an der ECKE, nicht am Vertex — deshalb können sie in
   * dieser INDIZIERTEN Geometrie kein Vertexattribut sein (zwei Dreiecke
   * teilen sich Vertices, aber nicht deren UVs). Für den Texturpfad gibt es
   * `buildTexturedMeshGeometry` (nicht-indiziert).
   */
  uvBytes: Uint8Array;
  /** `textureWord & 0x1FF` je Dreieck (🟢 realdaten-belegt). */
  textureIds: Uint16Array;
  /** `(textureWord >> 9) & 0x1F` je Dreieck (🟢 Bitbreite belegt, Semantik 🟡). */
  locationIds: Uint8Array;
  /** Bit 15 des Texturworts je Dreieck, 0/1 (🟡 Bedeutung ungemessen). */
  textureFlags: Uint8Array;
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
  const uvBytes = new Uint8Array(mesh.triCount * 6);
  const textureIds = new Uint16Array(mesh.triCount);
  const locationIds = new Uint8Array(mesh.triCount);
  const textureFlags = new Uint8Array(mesh.triCount);
  mesh.triangles.forEach((t, i) => {
    indices[i * 3] = t.v0;
    indices[i * 3 + 1] = t.v1;
    indices[i * 3 + 2] = t.v2;
    walkClasses[i] = t.walkClass;
    uvBytes.set(t.uv, i * 6);
    textureIds[i] = t.textureId;
    locationIds[i] = t.locationId;
    textureFlags[i] = t.textureFlag ? 1 : 0;
  });
  return {
    positions,
    indices,
    walkClasses,
    uvBytes,
    textureIds,
    locationIds,
    textureFlags,
    triCount: mesh.triCount,
    vertCount: mesh.vertCount,
  };
}

/**
 * Nicht-indizierte Variante für den TEXTURPFAD: ein Dreieck = drei eigene
 * Vertices, damit die eckenbezogenen UVs ein echtes Vertexattribut werden
 * können. 🔵 Architekturentscheidung: der Geometriepfad bleibt zweigleisig —
 * die indizierte Form ist kleiner und trägt das Picking über den Dreiecks-
 * index, die nicht-indizierte ist die einzige, die texturieren kann.
 *
 * `table` liefert die Texturmetadaten aus F11b, `atlas` (F25) legt die UVs
 * zusätzlich in die Atlaszelle. Fehlt die Tabelle, bleiben die UVs die ROHEN,
 * seiten-absoluten Bytes durch 255 geteilt — sichtbar falsch, aber ohne
 * stille Erfindung. `uvResolved` sagt je Dreieck, ob eine echte Umrechnung
 * stattgefunden hat; `atlasPages` sagt, aus welcher Atlasseite das Dreieck
 * liest (255 = keine — der Aufrufer muss dann nach Seite trennen).
 */
export interface TexturedMeshGeometry {
  /** xyz je Ecke (triCount · 3 Vertices), Szenenkoordinaten. */
  positions: Float32Array;
  /** uv je Ecke, auf [0,1] normiert. */
  uvs: Float32Array;
  textureIds: Uint16Array;
  locationIds: Uint8Array;
  walkClasses: Uint8Array;
  /** 1 = UV über die Texturtabelle aufgelöst, 0 = Rohbytes durchgereicht. */
  uvResolved: Uint8Array;
  /** Atlasseite je Dreieck; 255 = keine Atlaszelle vorhanden. */
  atlasPages: Uint8Array;
  triCount: number;
}

export interface TexturedGeometryOptions {
  table?: WorldTextureTable;
  atlas?: WorldTextureAtlas;
  cellOverride?: BlockCell;
}

export function buildTexturedMeshGeometry(
  mesh: WorldMesh,
  blockIndex: number,
  meshIndex: number,
  grid: WorldGrid,
  optionen: TexturedGeometryOptions = {},
): TexturedMeshGeometry {
  const table: WorldTextureTable = optionen.table ?? [];
  const atlas = optionen.atlas;
  const cellOverride = optionen.cellOverride;
  const basis = buildMeshGeometry(mesh, blockIndex, meshIndex, grid, cellOverride);
  const positions = new Float32Array(mesh.triCount * 9);
  const uvs = new Float32Array(mesh.triCount * 6);
  const uvResolved = new Uint8Array(mesh.triCount);
  const atlasPages = new Uint8Array(mesh.triCount).fill(255);
  for (let i = 0; i < mesh.triCount; i++) {
    for (let ecke = 0; ecke < 3; ecke++) {
      const v = basis.indices[i * 3 + ecke]!;
      positions[i * 9 + ecke * 3] = basis.positions[v * 3]!;
      positions[i * 9 + ecke * 3 + 1] = basis.positions[v * 3 + 1]!;
      positions[i * 9 + ecke * 3 + 2] = basis.positions[v * 3 + 2]!;
    }
    const roh = mesh.triangles[i]!.uv;
    const textureId = basis.textureIds[i]!;
    const aufgeloest = resolveTriangleUv(roh, textureId, table);
    if (!aufgeloest) {
      // 🔴 keine Tabelle: Rohbytes normiert durchreichen, NICHT raten.
      for (let k = 0; k < 6; k++) uvs[i * 6 + k] = roh[k]! / 255;
      continue;
    }
    uvResolved[i] = 1;
    const platz = atlas?.placements.get(textureId);
    if (!platz) {
      uvs.set(aufgeloest.normalized, i * 6);
      continue;
    }
    atlasPages[i] = platz.atlas;
    for (let ecke = 0; ecke < 3; ecke++) {
      const [au, av] = atlasUvForLocalPixel(
        platz,
        atlas!.size,
        aufgeloest.pixels[ecke * 2]!,
        aufgeloest.pixels[ecke * 2 + 1]!,
      );
      uvs[i * 6 + ecke * 2] = au;
      uvs[i * 6 + ecke * 2 + 1] = av;
    }
  }
  return {
    positions,
    uvs,
    textureIds: basis.textureIds,
    locationIds: basis.locationIds,
    walkClasses: basis.walkClasses,
    uvResolved,
    atlasPages,
    triCount: mesh.triCount,
  };
}
