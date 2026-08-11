import { describe, expect, it } from 'vitest';
import { composeWorldBlock } from '@webmidgar/fixture-gen';
import { parseWorldBlock, WORLD_GRIDS } from '@webmidgar/formats-world';
import { resolveTriangleUv, worldUvToLocal, type WorldTextureTable } from './uv.js';
import { buildMeshGeometry, buildTexturedMeshGeometry } from './geometry.js';

/**
 * F11a — UV-Umrechnung. Die drei Sonderfälle der Vorschrift werden EINZELN
 * geprüft; für jeden gibt es einen Gegenfall, in dem er NICHT greifen darf
 * (sonst würde ein zu breit gefasster Sonderfall unbemerkt durchgehen).
 */

describe('worldUvToLocal (F11a)', () => {
  it('Regel 3 (Normalfall): einfache Differenz, wenn Offset ≤ Wert und keine Randlage', () => {
    // 100 − 32 = 68, kein Umlauf (68 < 64? nein → mod 64 greift): 68 mod 64 = 4.
    expect(worldUvToLocal(100, 32, 64)).toBe(4);
    // Ohne Umlauf: 40 − 32 = 8.
    expect(worldUvToLocal(40, 32, 64)).toBe(8);
    // Offset 0 ist der triviale Durchgriff.
    expect(worldUvToLocal(17, 0, 32)).toBe(17);
  });

  it('Regel 1 (Randkachel): wert + offset === dimension ⇒ wert − 1', () => {
    // 32 + 32 === 64 ⇒ 31 statt (32 − 32) mod 64 = 0.
    expect(worldUvToLocal(32, 32, 64)).toBe(31);
    // Gegenfall: um eins daneben, Regel 1 darf NICHT greifen.
    expect(worldUvToLocal(33, 32, 64)).toBe(1);
    // Gegenfall andere Seite: hier greift Regel 2, nicht Regel 1.
    expect(worldUvToLocal(31, 32, 64)).toBe(1);
    // Randfall mit Offset 0: 64 + 0 === 64 ⇒ 63.
    expect(worldUvToLocal(64, 0, 64)).toBe(63);
  });

  it('Regel 2 (Seitenüberlauf): offset > wert ⇒ offset mod dimension', () => {
    // vOffset 480 bei Höhe 32: 480 mod 32 = 0 ⇒ Ergebnis 10.
    expect(worldUvToLocal(10, 480, 32)).toBe(10);
    // vOffset 464 bei Höhe 32: 464 mod 32 = 16; |10 − 16| mod 32 = 6.
    expect(worldUvToLocal(10, 464, 32)).toBe(6);
    // Gegenfall: offset ≤ wert ⇒ KEIN Modulo auf dem Offset.
    expect(worldUvToLocal(200, 128, 128)).toBe(72);
  });

  it('vorzeichenfrei: das Ergebnis ist nie negativ', () => {
    for (let wert = 0; wert <= 255; wert++) {
      for (const [offset, dim] of [
        [0, 16],
        [112, 16],
        [128, 32],
        [224, 128],
        [480, 64],
      ] as const) {
        const r = worldUvToLocal(wert, offset, dim);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(dim);
      }
    }
  });

  it('Dimension 0 (unbekannte Textur) ergibt 0 statt NaN', () => {
    expect(worldUvToLocal(42, 8, 0)).toBe(0);
  });
});

describe('resolveTriangleUv (F11a)', () => {
  const tabelle: WorldTextureTable = [
    { width: 64, height: 64, uOffset: 0, vOffset: 0 },
    { width: 16, height: 16, uOffset: 112, vOffset: 64 },
  ];

  it('rechnet alle drei Ecken um und normiert auf [0,1]', () => {
    const r = resolveTriangleUv([0, 0, 32, 32, 63, 63], 0, tabelle)!;
    expect(r.pixels).toEqual([0, 0, 32, 32, 63, 63]);
    expect(r.normalized).toEqual([0, 0, 0.5, 0.5, 63 / 64, 63 / 64]);
  });

  it('wendet die Offsets der jeweiligen Textur an (16×16 @ 112/64)', () => {
    const r = resolveTriangleUv([112, 64, 120, 72, 127, 79], 1, tabelle)!;
    expect(r.pixels).toEqual([0, 0, 8, 8, 15, 15]);
  });

  it('🔴 F11b fehlt: ohne Metadaten null — es wird nichts geraten', () => {
    expect(resolveTriangleUv([0, 0, 0, 0, 0, 0], 7, tabelle)).toBeNull();
    expect(resolveTriangleUv([0, 0, 0, 0, 0, 0], 0, [])).toBeNull();
  });
});

describe('Geometrie führt textureId/locationId/UV mit', () => {
  const grid = WORLD_GRIDS.wm0;

  function meshMitTexturwoertern(): ReturnType<typeof parseWorldBlock> {
    // textureWord: id 5, locationId 3 (=3<<9=1536), Flagbit 15 gesetzt.
    const wort = 5 | (3 << 9) | 0x8000;
    const block = composeWorldBlock(
      Array.from({ length: 16 }, () => ({
        triangles: [
          { v: [0, 1, 2] as [number, number, number], walkClass: 4, uv: [10, 20, 30, 40, 50, 60] as [number, number, number, number, number, number], textureWord: wort },
          { v: [0, 2, 3] as [number, number, number], walkClass: 9, uv: [1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number], textureWord: 0 },
        ],
        vertices: [
          { x: 0, h: 0, z: 0 },
          { x: 8192, h: 0, z: 0 },
          { x: 8192, h: 0, z: 8192 },
          { x: 0, h: 0, z: 8192 },
        ],
      })),
    );
    return parseWorldBlock(block, 0);
  }

  it('indizierte Geometrie trägt die Dreiecksattribute je Dreieck', () => {
    const mesh = meshMitTexturwoertern().block!.meshes[0]!;
    const geo = buildMeshGeometry(mesh, 0, 0, grid);
    expect(geo.triCount).toBe(2);
    expect([...geo.textureIds]).toEqual([5, 0]);
    expect([...geo.locationIds]).toEqual([3, 0]);
    expect([...geo.textureFlags]).toEqual([1, 0]);
    expect([...geo.uvBytes]).toEqual([10, 20, 30, 40, 50, 60, 1, 2, 3, 4, 5, 6]);
  });

  it('nicht-indizierte Geometrie: drei eigene Ecken je Dreieck, UV als Vertexattribut', () => {
    const mesh = meshMitTexturwoertern().block!.meshes[0]!;
    const tabelle: WorldTextureTable = [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { width: 64, height: 64, uOffset: 0, vOffset: 0 },
    ];
    const geo = buildTexturedMeshGeometry(mesh, 0, 0, grid, { table: tabelle });
    expect(geo.positions).toHaveLength(2 * 9);
    expect(geo.uvs).toHaveLength(2 * 6);
    // Dreieck 0 hat Metadaten, Dreieck 1 (textureId 0) nicht.
    expect([...geo.uvResolved]).toEqual([1, 0]);
    expect([...geo.uvs.slice(0, 6)]).toEqual([10 / 64, 20 / 64, 30 / 64, 40 / 64, 50 / 64, 60 / 64]);
    // Ohne Metadaten: ROHBYTES normiert, keine erfundene Umrechnung
    // (Float32-Speicherung, daher Nähevergleich).
    [1, 2, 3, 4, 5, 6].forEach((b, i) => expect(geo.uvs[6 + i]).toBeCloseTo(b / 255, 6));
    // Positionen decken sich mit der indizierten Form.
    const basis = buildMeshGeometry(mesh, 0, 0, grid);
    for (let i = 0; i < 3; i++) {
      const v = basis.indices[i]!;
      expect(geo.positions[i * 3]).toBe(basis.positions[v * 3]);
      expect(geo.positions[i * 3 + 1]).toBe(basis.positions[v * 3 + 1]);
      expect(geo.positions[i * 3 + 2]).toBe(basis.positions[v * 3 + 2]);
    }
  });
});
