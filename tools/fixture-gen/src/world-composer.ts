import { compressLzs } from './lzs-compress.js';

/**
 * World-Composer (S28) — Zweitimplementierung des Weltkarten-Blockformats
 * für Golden Fixtures, bewusst codegetrennt vom Parser in `formats-world`.
 * Layout laut FINDINGS S28 (realdaten-belegt): Block 0xB800 B = 16 u32-
 * Offsets + je Mesh (u32 LZS-Länge + Strom), Rest genullt; Mesh dekomprimiert
 * `u16 triCount · u16 vertCount · tri[12 B] · vert[8 B] · normal[8 B]`.
 */

export const WORLD_FIXTURE_BLOCK_BYTES = 0xb800;
const MESHES_PER_BLOCK = 16;

export interface WorldTriangleSpec {
  v: [number, number, number];
  walkClass?: number;
  attrHigh?: number;
  uv?: [number, number, number, number, number, number];
  textureWord?: number;
}

export interface WorldVertexSpec {
  x: number;
  h: number;
  z: number;
  spare?: number;
}

export interface WorldMeshSpec {
  triangles: WorldTriangleSpec[];
  vertices: WorldVertexSpec[];
  /** Fehlt die Angabe: Einheitsnormale nach oben (0, 4096, 0). */
  normals?: Array<[number, number, number]>;
}

export function composeWorldMeshBytes(spec: WorldMeshSpec): Uint8Array {
  const tri = spec.triangles.length;
  const vert = spec.vertices.length;
  if (vert > 256) throw new Error(`Weltkarten-Mesh trägt höchstens 256 Vertices (Indizes sind u8), nicht ${vert}`);
  const bytes = new Uint8Array(4 + tri * 12 + vert * 8 + vert * 8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, tri, true);
  view.setUint16(2, vert, true);
  let o = 4;
  for (const t of spec.triangles) {
    bytes[o] = t.v[0];
    bytes[o + 1] = t.v[1];
    bytes[o + 2] = t.v[2];
    bytes[o + 3] = ((t.attrHigh ?? 0) << 5) | ((t.walkClass ?? 0) & 0x1f);
    const uv = t.uv ?? [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) bytes[o + 4 + i] = uv[i]!;
    view.setUint16(o + 10, t.textureWord ?? 0, true);
    o += 12;
  }
  for (const v of spec.vertices) {
    view.setInt16(o, v.x, true);
    view.setInt16(o + 2, v.h, true);
    view.setInt16(o + 4, v.z, true);
    view.setUint16(o + 6, v.spare ?? 0, true);
    o += 8;
  }
  for (let i = 0; i < vert; i++) {
    const n = spec.normals?.[i] ?? [0, 4096, 0];
    view.setInt16(o, n[0], true);
    view.setInt16(o + 2, n[1], true);
    view.setInt16(o + 4, n[2], true);
    view.setUint16(o + 6, 0, true);
    o += 8;
  }
  return bytes;
}

export function composeWorldBlock(meshes: WorldMeshSpec[]): Uint8Array {
  if (meshes.length !== MESHES_PER_BLOCK) {
    throw new Error(`Ein Block trägt genau ${MESHES_PER_BLOCK} Meshes, nicht ${meshes.length}`);
  }
  const block = new Uint8Array(WORLD_FIXTURE_BLOCK_BYTES);
  const view = new DataView(block.buffer);
  let o = MESHES_PER_BLOCK * 4;
  meshes.forEach((spec, i) => {
    const stream = compressLzs(composeWorldMeshBytes(spec));
    if (o + 4 + stream.length > WORLD_FIXTURE_BLOCK_BYTES) {
      throw new Error(`Block läuft über: Mesh ${i} endet bei ${o + 4 + stream.length}`);
    }
    view.setUint32(i * 4, o, true);
    view.setUint32(o, stream.length, true);
    block.set(stream, o + 4);
    o += 4 + stream.length;
  });
  return block;
}

export function composeWorldMap(blocks: WorldMeshSpec[][]): Uint8Array {
  const out = new Uint8Array(blocks.length * WORLD_FIXTURE_BLOCK_BYTES);
  blocks.forEach((meshes, i) => out.set(composeWorldBlock(meshes), i * WORLD_FIXTURE_BLOCK_BYTES));
  return out;
}

/**
 * Höhenfeld-Mesh: (n+1)² Vertices über dem lokalen Grundriss [0, extent]²,
 * Höhe aus `heightFn(x, z)` — der Standardbaustein für Naht- und
 * Streaming-Fixtures. `heightFn` erhält GLOBALE Koordinaten, wenn `origin`
 * gesetzt ist; damit sind benachbarte Meshes automatisch nahtstetig.
 */
export function heightfieldMeshSpec(
  n: number,
  extent: number,
  heightFn: (x: number, z: number) => number,
  options: { origin?: { x: number; z: number }; walkClassFn?: (x: number, z: number) => number } = {},
): WorldMeshSpec {
  const origin = options.origin ?? { x: 0, z: 0 };
  const step = extent / n;
  if (!Number.isInteger(step)) throw new Error(`extent ${extent} nicht durch n ${n} teilbar`);
  const vertices: WorldVertexSpec[] = [];
  for (let gz = 0; gz <= n; gz++) {
    for (let gx = 0; gx <= n; gx++) {
      const x = gx * step;
      const z = gz * step;
      vertices.push({ x, h: Math.round(heightFn(origin.x + x, origin.z + z)), z });
    }
  }
  const triangles: WorldTriangleSpec[] = [];
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const a = gz * (n + 1) + gx;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      const cx = origin.x + gx * step + step / 2;
      const cz = origin.z + gz * step + step / 2;
      const walkClass = options.walkClassFn ? options.walkClassFn(cx, cz) : 0;
      triangles.push({ v: [a, b, d], walkClass }, { v: [a, d, c], walkClass });
    }
  }
  return { triangles, vertices };
}
