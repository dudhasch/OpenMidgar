import { describe, expect, it } from 'vitest';
import {
  composeWorldBlock,
  composeWorldMap,
  composeWorldMeshBytes,
  heightfieldMeshSpec,
  type WorldMeshSpec,
} from '@webmidgar/fixture-gen';
import { parseWorldBlock, parseWorldMap, parseWorldMesh } from './parse.js';
import {
  WORLD_BLOCK_BYTES,
  WORLD_MESH_EXTENT,
  WORLD_GRIDS,
  WM0_ALTERNATIVE_CELLS,
  resolveBlockIndex,
} from './types.js';

/**
 * Roundtrip-Suite Writer ↔ Parser (S28): Der Composer in fixture-gen ist die
 * codegetrennte Zweitimplementierung; jede Fixture beweist die volle Kette
 * Spezifikation → Bytes → NAM. Quarantäne-Fixtures decken jede E-WLD-Klasse.
 */

function beispielMesh(): WorldMeshSpec {
  return {
    triangles: [
      { v: [0, 1, 2], walkClass: 3, attrHigh: 1, uv: [1, 2, 3, 4, 5, 6], textureWord: 0x1234 },
      { v: [1, 3, 2], walkClass: 17, textureWord: 7 },
    ],
    vertices: [
      { x: 0, h: 10, z: 0 },
      { x: 100, h: -20, z: 0, spare: 5 },
      { x: 0, h: 30, z: 100 },
      { x: 100, h: 40, z: 100 },
    ],
    normals: [
      [0, 4096, 0],
      [1, 4000, -1],
      [0, 4096, 0],
      [0, 4096, 0],
    ],
  };
}

function sechzehn(spec: WorldMeshSpec): WorldMeshSpec[] {
  return Array.from({ length: 16 }, () => spec);
}

describe('Weltkarten-Mesh: Composer ↔ Parser', () => {
  it('Roundtrip erhält alle Felder — Dreiecke, Vertices, Reserven, Normalen', () => {
    const spec = beispielMesh();
    const mesh = parseWorldMesh(composeWorldMeshBytes(spec));
    expect(mesh.triCount).toBe(2);
    expect(mesh.vertCount).toBe(4);
    expect(mesh.triangles[0]).toEqual({
      v0: 0,
      v1: 1,
      v2: 2,
      walkClass: 3,
      attrHigh: 1,
      uv: [1, 2, 3, 4, 5, 6],
      textureWord: 0x1234,
      // F11a: Zerlegung 0x1234 = 0b0001_0010_0011_0100 → id 0x034 = 52,
      // locationId (Bits 9–13) = 9, Flagbit 15 nicht gesetzt.
      textureId: 52,
      locationId: 9,
      textureFlag: false,
    });
    expect(mesh.triangles[1]!.walkClass).toBe(17);
    expect([...mesh.positions]).toEqual([0, 10, 0, 100, -20, 0, 0, 30, 100, 100, 40, 100]);
    expect(mesh.vertexSpare[1]).toBe(5);
    expect([...mesh.normals.slice(3, 6)]).toEqual([1, 4000, -1]);
  });

  it('Accounting ist hart: ein angehängtes Byte ist ein Fehler, kein Warnfall', () => {
    const bytes = composeWorldMeshBytes(beispielMesh());
    const langer = new Uint8Array(bytes.length + 1);
    langer.set(bytes);
    expect(() => parseWorldMesh(langer)).toThrow(/Accounting/);
  });

  it('Vertexindex außerhalb der Vertexmenge wird abgewiesen', () => {
    const spec = beispielMesh();
    spec.triangles[0]!.v = [0, 1, 200];
    expect(() => parseWorldMesh(composeWorldMeshBytes(spec))).toThrow(/außerhalb/);
  });
});

describe('Weltkarten-Block und -Karte: Roundtrip und Quarantäne', () => {
  it('Block-Roundtrip: 16 Meshes, bitgenaue Rekomposition', () => {
    const block = composeWorldBlock(sechzehn(beispielMesh()));
    expect(block.length).toBe(WORLD_BLOCK_BYTES);
    const parsed = parseWorldBlock(block, 0);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.block!.meshes.every((m) => m !== null)).toBe(true);
    // Rekomposition aus dem geparsten NAM ergibt dieselben Bytes (der
    // Composer ist deterministisch, das NAM verlustfrei).
    const respec: WorldMeshSpec[] = parsed.block!.meshes.map((m) => ({
      triangles: m!.triangles.map((t) => ({
        v: [t.v0, t.v1, t.v2] as [number, number, number],
        walkClass: t.walkClass,
        attrHigh: t.attrHigh,
        uv: t.uv,
        textureWord: t.textureWord,
      })),
      vertices: Array.from({ length: m!.vertCount }, (_, i) => ({
        x: m!.positions[i * 3]!,
        h: m!.positions[i * 3 + 1]!,
        z: m!.positions[i * 3 + 2]!,
        spare: m!.vertexSpare[i]!,
      })),
      normals: Array.from({ length: m!.vertCount }, (_, i) => [
        m!.normals[i * 3]!,
        m!.normals[i * 3 + 1]!,
        m!.normals[i * 3 + 2]!,
      ] as [number, number, number]),
    }));
    expect(composeWorldBlock(respec)).toEqual(block);
  });

  it('E-WLD-TABLE: zerstörte Offsettabelle quarantiniert den Block (Loch, kein Absturz)', () => {
    const block = composeWorldBlock(sechzehn(beispielMesh()));
    new DataView(block.buffer).setUint32(4, 8, true); // Slot 1 < Tabellenende → ungültig
    const parsed = parseWorldBlock(block, 7);
    expect(parsed.block).toBeNull();
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ code: 'E-WLD-TABLE', blockIndex: 7 }),
    ]);
  });

  it('E-WLD-MESH: ein zerstörter Strom quarantiniert NUR das eine Mesh', () => {
    const block = composeWorldBlock(sechzehn(beispielMesh()));
    const view = new DataView(block.buffer);
    const off3 = view.getUint32(3 * 4, true);
    view.setUint32(off3, 0xb000, true); // Längenwort von Mesh 3 → Strom über Blockende
    const parsed = parseWorldBlock(block, 0);
    expect(parsed.block).not.toBeNull();
    expect(parsed.block!.meshes[3]).toBeNull();
    expect(parsed.block!.meshes.filter((m) => m !== null)).toHaveLength(15);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ code: 'E-WLD-MESH', blockIndex: 0, meshIndex: 3 }),
    ]);
  });

  it('E-WLD-SIZE: Restbytes werden gemeldet, vollständige Blöcke trotzdem geparst', () => {
    const map = composeWorldMap([sechzehn(beispielMesh()), sechzehn(beispielMesh())]);
    const langer = new Uint8Array(map.length + 100);
    langer.set(map);
    const terrain = parseWorldMap(langer);
    expect(terrain.blocks).toHaveLength(2);
    expect(terrain.blocks.every((b) => b !== null)).toBe(true);
    expect(terrain.diagnostics).toEqual([expect.objectContaining({ code: 'E-WLD-SIZE' })]);
  });

  it('Höhenfeld-Baustein: global stetige Höhenfunktion ergibt nahtstetige Nachbarmeshes', () => {
    const h = (x: number, z: number): number => Math.round(x / 64 + z / 128);
    const links = heightfieldMeshSpec(4, WORLD_MESH_EXTENT, h, { origin: { x: 0, z: 0 } });
    const rechts = heightfieldMeshSpec(4, WORLD_MESH_EXTENT, h, { origin: { x: WORLD_MESH_EXTENT, z: 0 } });
    const kanteLinks = links.vertices.filter((v) => v.x === WORLD_MESH_EXTENT).map((v) => [v.z, v.h]);
    const kanteRechts = rechts.vertices.filter((v) => v.x === 0).map((v) => [v.z, v.h]);
    expect(kanteLinks).toEqual(kanteRechts);
  });
});

describe('WM0-Alternativblöcke (S30)', () => {
  it('Zuordnung Alternativblock → Rasterzelle ist die gemessene Reihenfolge', () => {
    // REALDATEN-BELEGT (world-altblock-probe): Mesh-Identität UND Naht-
    // stetigkeit liefern unabhängig voneinander dieselbe Zuordnung.
    expect(WM0_ALTERNATIVE_CELLS).toEqual([50, 41, 42, 60, 47, 48]);
    expect(new Set(WM0_ALTERNATIVE_CELLS).size).toBe(6);
    // Jede Zelle liegt im 9×7-Primärraster.
    for (const z of WM0_ALTERNATIVE_CELLS) expect(z).toBeLessThan(63);
  });

  it('resolveBlockIndex tauscht stufenweise und lässt alles andere unberührt', () => {
    const grid = WORLD_GRIDS.wm0;
    // Stufe 0: Urzustand — keine einzige Zelle wird getauscht.
    for (let z = 0; z < 63; z++) expect(resolveBlockIndex(z, grid, 0)).toBe(z);
    // Stufe 1 tauscht genau Zelle 50 gegen Block 63.
    expect(resolveBlockIndex(50, grid, 1)).toBe(63);
    expect(resolveBlockIndex(41, grid, 1)).toBe(41);
    // Stufe 2 nimmt die Junon-Gruppe dazu (kumulativ, 🔵 dokumentiert).
    expect(resolveBlockIndex(41, grid, 2)).toBe(64);
    expect(resolveBlockIndex(42, grid, 2)).toBe(65);
    expect(resolveBlockIndex(60, grid, 2)).toBe(60);
    // Stufe 4: alle sechs getauscht, genau sechs Zellen betroffen.
    const getauscht = [];
    for (let z = 0; z < 63; z++) if (resolveBlockIndex(z, grid, 4) !== z) getauscht.push(z);
    expect(getauscht.sort((a, b) => a - b)).toEqual([41, 42, 47, 48, 50, 60]);
    expect(resolveBlockIndex(60, grid, 3)).toBe(66);
    expect(resolveBlockIndex(47, grid, 4)).toBe(67);
    expect(resolveBlockIndex(48, grid, 4)).toBe(68);
  });

  it('Karten ohne Alternativblöcke bleiben unberührt (nur WM0 hat welche)', () => {
    for (const g of [WORLD_GRIDS.wm2, WORLD_GRIDS.wm3]) {
      for (let z = 0; z < g.primaryBlocks; z++) expect(resolveBlockIndex(z, g, 4)).toBe(z);
    }
  });
});
