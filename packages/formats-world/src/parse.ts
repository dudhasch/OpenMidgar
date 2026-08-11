import { decompressLzs } from '@webmidgar/formats-field';
import {
  decodeTextureWord,
  WORLD_BLOCK_BYTES,
  WORLD_MESHES_PER_BLOCK,
  type WorldBlock,
  type WorldDiagnostic,
  type WorldMesh,
  type WorldTerrain,
  type WorldTriangle,
} from './types.js';

/**
 * Parser der Weltkarten-Terrainblöcke (S28). Jede Grenze hier ist gemessen,
 * nicht geglaubt: Blockgrammatik 85/85 (Kontrolle 0/85), Mesh-Grammatik
 * 1360/1360 byteexakt (FINDINGS S28). Fehler führen zur QUARANTÄNE des
 * betroffenen Blocks bzw. Meshes — nie zum Abbruch der ganzen Karte
 * (dieselbe Degradierungshaltung wie beim Field-Container).
 */

const TABLE_BYTES = WORLD_MESHES_PER_BLOCK * 4;

export function parseWorldMesh(bytes: Uint8Array): WorldMesh {
  if (bytes.length < 4) throw new Error(`Mesh kürzer als Kopf (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint16(0, true);
  const vertCount = view.getUint16(2, true);
  const expected = 4 + triCount * 12 + vertCount * 8 + vertCount * 8;
  if (bytes.length !== expected) {
    // Das byteexakte Accounting IST der Wahrheitstest — 1360/1360 im Bestand.
    throw new Error(`Accounting verletzt: ${bytes.length} B statt ${expected} B (tri=${triCount}, vert=${vertCount})`);
  }
  const triangles: WorldTriangle[] = new Array(triCount);
  let o = 4;
  for (let t = 0; t < triCount; t++, o += 12) {
    const attr = bytes[o + 3]!;
    const textureWord = view.getUint16(o + 10, true);
    triangles[t] = {
      v0: bytes[o]!,
      v1: bytes[o + 1]!,
      v2: bytes[o + 2]!,
      walkClass: attr & 0x1f,
      attrHigh: attr >> 5,
      uv: [bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!, bytes[o + 8]!, bytes[o + 9]!],
      textureWord,
      ...decodeTextureWord(textureWord),
    };
    if (triangles[t]!.v0 >= vertCount || triangles[t]!.v1 >= vertCount || triangles[t]!.v2 >= vertCount) {
      throw new Error(`Dreieck ${t} referenziert Vertex außerhalb (${vertCount})`);
    }
  }
  const positions = new Int16Array(vertCount * 3);
  const vertexSpare = new Uint16Array(vertCount);
  for (let vtx = 0; vtx < vertCount; vtx++, o += 8) {
    positions[vtx * 3] = view.getInt16(o, true);
    positions[vtx * 3 + 1] = view.getInt16(o + 2, true);
    positions[vtx * 3 + 2] = view.getInt16(o + 4, true);
    vertexSpare[vtx] = view.getUint16(o + 6, true);
  }
  const normals = new Int16Array(vertCount * 3);
  const normalSpare = new Uint16Array(vertCount);
  for (let vtx = 0; vtx < vertCount; vtx++, o += 8) {
    normals[vtx * 3] = view.getInt16(o, true);
    normals[vtx * 3 + 1] = view.getInt16(o + 2, true);
    normals[vtx * 3 + 2] = view.getInt16(o + 4, true);
    normalSpare[vtx] = view.getUint16(o + 6, true);
  }
  return { triCount, vertCount, triangles, positions, vertexSpare, normals, normalSpare };
}

export interface ParseBlockResult {
  block: WorldBlock | null;
  diagnostics: WorldDiagnostic[];
}

export function parseWorldBlock(bytes: Uint8Array, blockIndex: number): ParseBlockResult {
  const diagnostics: WorldDiagnostic[] = [];
  if (bytes.length !== WORLD_BLOCK_BYTES) {
    return {
      block: null,
      diagnostics: [{ code: 'E-WLD-TABLE', blockIndex, message: `Blockgröße ${bytes.length} ≠ ${WORLD_BLOCK_BYTES}` }],
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: number[] = [];
  for (let i = 0; i < WORLD_MESHES_PER_BLOCK; i++) offsets.push(view.getUint32(i * 4, true));
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i]!;
    const monoton = i === 0 || off >= offsets[i - 1]!;
    if (off < TABLE_BYTES || off >= WORLD_BLOCK_BYTES || !monoton) {
      return {
        block: null,
        diagnostics: [{ code: 'E-WLD-TABLE', blockIndex, message: `Offsettabelle ungültig an Slot ${i} (${off})` }],
      };
    }
  }
  const meshes: Array<WorldMesh | null> = [];
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i]!;
    try {
      const compressed = view.getUint32(off, true);
      if (off + 4 + compressed > WORLD_BLOCK_BYTES) throw new Error(`Strom (${compressed} B) über Blockende`);
      meshes.push(parseWorldMesh(decompressLzs(bytes.subarray(off + 4, off + 4 + compressed))));
    } catch (e) {
      meshes.push(null);
      diagnostics.push({ code: 'E-WLD-MESH', blockIndex, meshIndex: i, message: (e as Error).message });
    }
  }
  return { block: { index: blockIndex, meshes }, diagnostics };
}

export function parseWorldMap(bytes: Uint8Array): WorldTerrain {
  const diagnostics: WorldDiagnostic[] = [];
  const blocks: Array<WorldBlock | null> = [];
  const rest = bytes.length % WORLD_BLOCK_BYTES;
  const blockCount = (bytes.length - rest) / WORLD_BLOCK_BYTES;
  if (rest !== 0) {
    diagnostics.push({
      code: 'E-WLD-SIZE',
      blockIndex: blockCount,
      message: `${rest} B Rest — Datei ist kein Blockvielfaches; Restbytes ignoriert`,
    });
  }
  for (let b = 0; b < blockCount; b++) {
    const r = parseWorldBlock(bytes.subarray(b * WORLD_BLOCK_BYTES, (b + 1) * WORLD_BLOCK_BYTES), b);
    blocks.push(r.block);
    diagnostics.push(...r.diagnostics);
  }
  return { blocks, diagnostics };
}
