import { describe, expect, it } from 'vitest';
import { parseWorldBlock, WORLD_BLOCK_BYTES, type WorldTerrain } from '@webmidgar/formats-world';
import {
  buildWorldTextureTable,
  chooseOffset,
  CLTR_QUIRK_U,
  feasibleOffsets,
  measureTextureFit,
  measureTextureUvRanges,
  minimalDimension,
  type TextureUvRange,
} from './texture-table.js';
import {
  atlasUvForLocalPixel,
  buildWorldTextureAtlas,
  countAtlasOverlaps,
  type WorldAtlasImage,
} from './texture-atlas.js';
import { colorizeIndexed, paletteExtremes, substituteAnimatedPalette } from './texture-images.js';
import { buildWorldTextureSet } from './texture-setup.js';
import { buildTexturedMeshGeometry } from './geometry.js';
import { WORLD_GRIDS } from '@webmidgar/formats-world';

// --- Fixtures selbst erzeugen -------------------------------------------------

interface TriSpec {
  uv: [number, number, number, number, number, number];
  textureId: number;
}

/** Ein Block mit einem Mesh, dessen Dreiecke die gewünschten UV/IDs tragen. */
function terrainMit(tris: TriSpec[]): WorldTerrain {
  const vertCount = 3;
  const roh = new Uint8Array(4 + tris.length * 12 + vertCount * 16);
  const rv = new DataView(roh.buffer);
  rv.setUint16(0, tris.length, true);
  rv.setUint16(2, vertCount, true);
  tris.forEach((t, i) => {
    const o = 4 + i * 12;
    roh[o] = 0;
    roh[o + 1] = 1;
    roh[o + 2] = 2;
    roh[o + 3] = 1;
    for (let k = 0; k < 6; k++) roh[o + 4 + k] = t.uv[k]!;
    rv.setUint16(o + 10, t.textureId, true);
  });
  for (let v = 0; v < vertCount; v++) {
    const o = 4 + tris.length * 12 + v * 8;
    rv.setInt16(o, v * 100, true);
    rv.setInt16(o + 2, 0, true);
    rv.setInt16(o + 4, v * 50, true);
  }
  // LZS-Rohstrom: Steuerbyte mit acht Literalflags je acht Bytes.
  const strom: number[] = [];
  for (let i = 0; i < roh.length; i += 8) {
    strom.push(0xff);
    for (let k = 0; k < 8 && i + k < roh.length; k++) strom.push(roh[i + k]!);
  }
  const block = new Uint8Array(WORLD_BLOCK_BYTES);
  const bv = new DataView(block.buffer);
  const tabelle = 16 * 4;
  for (let i = 0; i < 16; i++) bv.setUint32(i * 4, tabelle, true);
  bv.setUint32(tabelle, strom.length, true);
  block.set(strom, tabelle + 4);
  const r = parseWorldBlock(block, 0);
  // Alle 16 Slots zeigen auf dasselbe Mesh — für die Messung genügt einer.
  return { blocks: [r.block], diagnostics: r.diagnostics };
}

const bild = (id: number, w: number, h: number, farbe: number): WorldAtlasImage => ({
  textureId: id,
  width: w,
  height: h,
  rgba: Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : farbe)),
});

// --- Maße und Ursprünge -------------------------------------------------------

describe('F11b: Maßbestimmung aus den UV-Bytes', () => {
  it('minimalDimension nimmt die Kachelkante inklusiv — sonst kippt die Zuordnung', () => {
    // u bis 128 bei Ursprung 0 gehört noch zu einer 128 breiten Textur
    // (Randkachelfall in worldUvToLocal), nicht erst zu einer 256 breiten.
    expect(minimalDimension(0, 128)).toBe(128);
    expect(minimalDimension(0, 129)).toBe(256);
    expect(minimalDimension(0, 31)).toBe(32);
    expect(minimalDimension(128, 248)).toBe(128);
    expect(minimalDimension(0, 0)).toBe(16);
  });

  it('feasibleOffsets liefert nur 16-ausgerichtete Ursprünge, größter zuerst', () => {
    expect(feasibleOffsets(158, 188, 64)).toEqual([144, 128]);
    expect(feasibleOffsets(0, 120, 128)).toEqual([0]);
    expect(feasibleOffsets(128, 248, 128)).toEqual([128]);
  });

  it('chooseOffset bevorzugt den auf die Texturbreite ausgerichteten Wert', () => {
    // 144 und 128 passen beide; 128 ist ein Vielfaches von 64.
    expect(chooseOffset(158, 188, 64)).toEqual({ offset: 128, ambiguous: true });
    expect(chooseOffset(0, 120, 128)).toEqual({ offset: 0, ambiguous: false });
  });

  it('sammelt Spannweiten je textureId und blendet den cltr-Quirk aus', () => {
    const terrain = terrainMit([
      { textureId: 5, uv: [10, 20, 30, 40, 50, 60] },
      { textureId: 5, uv: [254, 0, 255, 1, 120, 70] },
    ]);
    const ohne = measureTextureUvRanges(terrain).get(5)!;
    expect([ohne.uMin, ohne.uMax]).toEqual([10, 255]);
    const mit = measureTextureUvRanges(terrain, { quirkTextureIds: new Set([5]) }).get(5)!;
    expect([mit.uMin, mit.uMax]).toEqual([10, 120]);
    expect(mit.triangles).toBe(2 * 16); // 16 identische Mesh-Slots im Block
    // Die Quirk-Schwelle bleibt eine benannte Größe, kein Zahlenliteral im Code.
    expect(CLTR_QUIRK_U).toBe(192);
  });
});

describe('F11b: Tabellenbau und Gütemessung', () => {
  const bereich = (id: number, u: [number, number], v: [number, number], tris = 100): TextureUvRange => ({
    textureId: id,
    triangles: tris,
    uMin: u[0],
    uMax: u[1],
    vMin: v[0],
    vMax: v[1],
  });

  it('setzt Name, Maß und abgeleiteten Ursprung zusammen', () => {
    const ranges = new Map([
      [0, bereich(0, [0, 120], [0, 70])],
      [1, bereich(1, [128, 248], [0, 126])],
    ]);
    const r = buildWorldTextureTable({
      ranges,
      names: ['cltr', 'sng01'],
      sizes: new Map([
        ['cltr', { width: 128, height: 128 }],
        ['sng01', { width: 128, height: 128 }],
      ]),
    });
    expect(r.table[0]).toEqual({ width: 128, height: 128, uOffset: 0, vOffset: 0 });
    expect(r.table[1]).toEqual({ width: 128, height: 128, uOffset: 128, vOffset: 0 });
    expect(r.entries.every((e) => e.fits)).toBe(true);
    expect(r.unresolved).toEqual([]);
  });

  it('IDs ohne Größe bleiben unaufgelöst und werden gemeldet — nicht erfunden', () => {
    const r = buildWorldTextureTable({
      ranges: new Map([[0, bereich(0, [0, 10], [0, 10])]]),
      names: ['fehlt'],
      sizes: new Map(),
    });
    expect(r.unresolved).toEqual([0]);
    expect(r.table[0]).toBeUndefined();
    expect(r.diagnostics).toHaveLength(1);
  });

  it('animierte Plätze werden der Reihe nach auf wm.ta abgebildet', () => {
    const r = buildWorldTextureTable({
      ranges: new Map([
        [0, bereich(0, [0, 30], [0, 30])],
        [1, bereich(1, [0, 30], [0, 30])],
        [2, bereich(2, [0, 30], [0, 30])],
      ]),
      names: ['a', null, null],
      sizes: new Map([['a', { width: 32, height: 32 }]]),
      animated: [
        { width: 32, height: 32 },
        { width: 32, height: 32 },
      ],
    });
    expect(r.entries.map((e) => e.animatedSlot)).toEqual([null, 0, 1]);
    expect(r.unresolved).toEqual([]);
  });

  it('Gütemaß: richtige Zuordnung trifft voll, Verwürfelung deutlich darunter', () => {
    // Sieben IDs mit klar unterschiedlichen Maßen — eine falsche Zuordnung
    // verletzt fast immer die Fensterbedingung.
    const specs: Array<[number, number, number, number]> = [
      [0, 240, 16, 16],
      [1, 16, 240, 16],
      [2, 120, 120, 128],
      [3, 30, 30, 32],
      [4, 60, 30, 64],
      [5, 30, 60, 32],
      [6, 200, 200, 256],
    ];
    const ranges = new Map<number, TextureUvRange>();
    const sizes = new Map<string, { width: number; height: number }>();
    const names: string[] = [];
    for (const [id, uMax, vMax] of specs) {
      ranges.set(id, bereich(id, [0, uMax], [0, vMax]));
      const w = minimalDimension(0, uMax);
      const h = minimalDimension(0, vMax);
      names.push(`t${id}`);
      sizes.set(`t${id}`, { width: w, height: h });
    }
    const r = buildWorldTextureTable({ ranges, names, sizes });
    const census = new Map<string, number>();
    for (const e of r.entries) census.set(`${e.width}x${e.height}`, (census.get(`${e.width}x${e.height}`) ?? 0) + 1);
    const m = measureTextureFit(r.entries, ranges, census, { controls: 300, seed: 7 });
    expect(m.rate).toBe(1);
    expect(m.hits).toBe(m.total);
    // Kontrollniveau MUSS deutlich darunter liegen, sonst misst die Quote nichts.
    expect(m.controlMedian).toBeLessThan(0.7);
    expect(m.controlMax).toBeLessThan(1);
  });
});

// --- Atlas --------------------------------------------------------------------

describe('F25: Texturatlas', () => {
  it('bringt alle Bilder unter, ohne dass sich Zellen samt Polsterung überlappen', () => {
    const bilder = [
      bild(0, 128, 128, 10),
      bild(1, 64, 32, 20),
      bild(2, 32, 32, 30),
      bild(3, 256, 64, 40),
      bild(4, 16, 16, 50),
    ];
    const a = buildWorldTextureAtlas(bilder, { atlasSize: 512, padding: 4 });
    // Accounting: jedes Bild hat genau einen Platz, keines abgewiesen.
    expect(a.rejected).toEqual([]);
    expect(a.placements.size).toBe(bilder.length);
    expect(countAtlasOverlaps(a)).toBe(0);
    // Nutzfläche stimmt mit der Summe der Bildflächen überein.
    const summe = bilder.reduce((s, b) => s + b.width * b.height, 0);
    expect(a.usedArea.reduce((s, x) => s + x, 0)).toBe(summe);
  });

  it('Polsterung trägt Randfarbe, nicht Transparenz', () => {
    const a = buildWorldTextureAtlas([bild(0, 32, 32, 77)], { atlasSize: 64, padding: 4 });
    const p = a.placements.get(0)!;
    const seite = a.atlases[0]!;
    const at = (x: number, y: number): number[] => [...seite.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(at(p.x, p.y)).toEqual([77, 77, 77, 255]);
    expect(at(p.x - 1, p.y - 1)).toEqual([77, 77, 77, 255]);
    expect(at(p.x + 32 + 3, p.y + 32 + 3)).toEqual([77, 77, 77, 255]);
    // Außerhalb der Polsterung bleibt der Atlas leer.
    expect(at(p.x + 32 + 4, p.y)).toEqual([0, 0, 0, 0]);
  });

  it('zu großes Bild wird gemeldet statt beschnitten', () => {
    const a = buildWorldTextureAtlas([bild(0, 64, 64, 1)], { atlasSize: 64, padding: 4 });
    expect(a.rejected).toEqual([0]);
    expect(a.placements.size).toBe(0);
  });

  it('Wiederholung steckt in der UV-Rechnung, nicht im Sampler', () => {
    const p = { atlas: 0, x: 100, y: 200, width: 32, height: 32 };
    const [u0, v0] = atlasUvForLocalPixel(p, 1024, 0, 0);
    const [u1] = atlasUvForLocalPixel(p, 1024, 32, 0); // eine volle Kachel weiter
    expect(u1).toBeCloseTo(u0, 10);
    expect(v0).toBeCloseTo((200 + 0.5) / 1024, 10);
    // Negative Werte laufen ebenfalls in die Zelle zurück, nicht daneben.
    const [uNeg] = atlasUvForLocalPixel(p, 1024, -1, 0);
    expect(uNeg).toBeCloseTo((100 + 31 + 0.5) / 1024, 10);
  });
});

// --- Geometrie mit Atlas ------------------------------------------------------

describe('F25: Geometrie liest aus der Atlaszelle', () => {
  it('legt aufgelöste UVs in die Zelle und meldet die Atlasseite', () => {
    const terrain = terrainMit([
      { textureId: 0, uv: [0, 0, 16, 0, 0, 16] },
      { textureId: 9, uv: [1, 2, 3, 4, 5, 6] },
    ]);
    const mesh = terrain.blocks[0]!.meshes[0]!;
    const atlas = buildWorldTextureAtlas([bild(0, 32, 32, 5)], { atlasSize: 256, padding: 4 });
    const geo = buildTexturedMeshGeometry(mesh, 0, 0, WORLD_GRIDS.wm0, {
      table: [{ width: 32, height: 32, uOffset: 0, vOffset: 0 }],
      atlas,
    });
    const p = atlas.placements.get(0)!;
    expect(geo.uvResolved[0]).toBe(1);
    expect(geo.atlasPages[0]).toBe(0);
    expect(geo.uvs[0]).toBeCloseTo((p.x + 0.5) / 256, 6);
    expect(geo.uvs[2]).toBeCloseTo((p.x + 16 + 0.5) / 256, 6);
    // Dreieck 1 hat keine Metadaten: Rohbytes, keine Atlasseite.
    expect(geo.uvResolved[1]).toBe(0);
    expect(geo.atlasPages[1]).toBe(255);
  });

  it('ohne Atlas bleibt das alte Verhalten (normierte Texturkoordinaten)', () => {
    const terrain = terrainMit([{ textureId: 0, uv: [16, 0, 0, 16, 0, 0] }]);
    const mesh = terrain.blocks[0]!.meshes[0]!;
    const geo = buildTexturedMeshGeometry(mesh, 0, 0, WORLD_GRIDS.wm0, {
      table: [{ width: 32, height: 32, uOffset: 0, vOffset: 0 }],
    });
    expect(geo.uvs[0]).toBeCloseTo(16 / 32, 6);
    expect(geo.atlasPages[0]).toBe(255);
  });
});

// --- Gesamteinstieg -----------------------------------------------------------

describe('buildWorldTextureSet — der Aufruf, den die Demo verdrahtet', () => {
  it('führt Namenstabelle, .tex-Bilder und wm.ta zu Tabelle + Atlas zusammen', () => {
    const terrain = terrainMit([
      { textureId: 0, uv: [0, 0, 30, 0, 0, 30] },
      { textureId: 1, uv: [0, 0, 30, 0, 0, 30] },
    ]);
    const set = buildWorldTextureSet({
      terrain,
      nameTable: {
        names: ['gras', null],
        tableOffset: 0,
        bases: { wm0: 0, wm2: 0, wm3: 1 },
        animatedCount: 1,
        diagnostics: [],
      },
      base: 0,
      staticImages: new Map([
        ['gras', { name: 'gras', width: 32, height: 32, rgba: farbverlaufRgba(32, 32) }],
      ]),
      animated: [
        {
          slot: 0,
          width: 32,
          height: 32,
          speed: 20,
          frames: [{ vramX: 384, vramY: 256, indices: Uint8Array.from({ length: 32 * 32 }, (_, i) => i % 16) }],
        },
      ],
      atlasSize: 256,
    });
    expect(set.report.usedIds).toBe(2);
    expect(set.report.named).toBe(1);
    expect(set.report.animatedIds).toBe(1);
    expect(set.report.misfits).toEqual([]);
    expect(set.report.unresolved).toEqual([]);
    expect(set.report.missingImages).toEqual([]);
    expect(set.atlas.placements.size).toBe(2);
    expect(countAtlasOverlaps(set.atlas)).toBe(0);
    // Die animierte Textur bekam eine Ersatzpalette — der Anteil wird BERICHTET.
    expect(set.report.substitutePaletteTriangleShare).toBeCloseTo(0.5, 6);
    expect(set.table[0]).toEqual({ width: 32, height: 32, uOffset: 0, vOffset: 0 });
  });

  it('ohne wm.ta bleiben die animierten IDs sichtbar unbesetzt statt heimlich ersetzt', () => {
    const terrain = terrainMit([{ textureId: 0, uv: [0, 0, 30, 0, 0, 30] }]);
    const set = buildWorldTextureSet({
      terrain,
      nameTable: { names: [null], tableOffset: 0, bases: { wm0: 0, wm2: 0, wm3: 0 }, animatedCount: 1, diagnostics: [] },
      base: 0,
      staticImages: new Map(),
      atlasSize: 128,
    });
    expect(set.report.unresolved).toEqual([0]);
    expect(set.atlas.placements.size).toBe(0);
    expect(set.report.substitutePaletteTriangleShare).toBe(0);
  });
});

function farbverlaufRgba(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i % 256;
    rgba[i * 4 + 1] = (i * 3) % 256;
    rgba[i * 4 + 2] = (i * 7) % 256;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// --- Ersatzpalette ------------------------------------------------------------

describe('Ersatzpalette der animierten Texturen (🟡)', () => {
  it('Extremfarben ignorieren durchsichtige Pixel', () => {
    const rgba = new Uint8Array([
      255, 255, 255, 0, // durchsichtig, darf nicht als „hell" gewinnen
      10, 20, 30, 255,
      200, 210, 220, 255,
    ]);
    const e = paletteExtremes(rgba)!;
    expect(e.dark).toEqual([10, 20, 30]);
    expect(e.light).toEqual([200, 210, 220]);
  });

  it('Verlauf hat 16 undurchsichtige Stufen mit den Extremen an den Enden', () => {
    const pal = substituteAnimatedPalette([0, 0, 64], [128, 192, 255]);
    expect(pal).toHaveLength(16 * 4);
    expect([...pal.subarray(0, 4)]).toEqual([0, 0, 64, 255]);
    expect([...pal.subarray(60, 64)]).toEqual([128, 192, 255, 255]);
    for (let i = 0; i < 16; i++) expect(pal[i * 4 + 3]).toBe(255);
  });

  it('Indexbild einfärben respektiert die Palettenlänge', () => {
    const pal = substituteAnimatedPalette([0, 0, 0], [15, 15, 15]);
    const rgba = colorizeIndexed(Uint8Array.from([0, 15, 3]), pal);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([15, 15, 15, 255]);
  });
});
