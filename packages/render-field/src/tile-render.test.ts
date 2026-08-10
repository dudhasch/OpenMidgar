import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import {
  composeBackgroundSection,
  composePaletteSection,
  type BackgroundSectionSpec,
  type Rgba8,
} from '@webmidgar/fixture-gen';
import { parseBackgroundSection, parsePaletteSection, type FieldDiagnostic } from '@webmidgar/formats-field';
import {
  baseLayerIndex,
  composeBackgroundImage,
  layerTileSize,
  layerTransparency,
  resolveTileRgba,
  type TileResolveIssue,
} from './tile-image.js';
import { buildTileAtlas, tileVariantKey } from './tile-atlas.js';
import { buildFieldBackground } from './field-background.js';

/**
 * Fixture-Testsuite für den Hintergrund-Renderpfad (S9 → S4-Depth-Pipeline).
 * Jede Fixture entsteht ausschließlich über `composeBackgroundSection`/
 * `composePaletteSection` und wird über die Parser aus formats-field wieder
 * eingelesen — kein Byte wird von Hand gebastelt. Damit belegt jeder Test die
 * Dualität Writer↔Parser↔Renderer.
 */

// Fixe Punkte der BGR555→RGBA8-Rundung (Komponenten 0 oder 255 bleiben nach
// encode→decode exakt erhalten), damit Erwartungswerte ohne Rundungsdrift
// direkt als Literal geschrieben werden können.
const TRANSPARENT: Rgba8 = [0, 0, 0, 0];
const RED: Rgba8 = [255, 0, 0, 255];
const GREEN: Rgba8 = [0, 255, 0, 255];
const BLUE: Rgba8 = [0, 0, 255, 255];

function texturePage(depth: 1 | 2): Uint8Array {
  return new Uint8Array(65536 * depth);
}

/** Einzelnes Texel einer palettierten (depth 1) Texturseite setzen. */
function setPalettizedTexel(data: Uint8Array, x: number, y: number, paletteIndex: number): void {
  data[y * 256 + x] = paletteIndex;
}

/** 16×16- oder 32×32-Block einer palettierten Texturseite mit einem Index füllen. */
function fillPalettizedBlock(data: Uint8Array, srcX: number, srcY: number, size: number, paletteIndex: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPalettizedTexel(data, srcX + x, srcY + y, paletteIndex);
    }
  }
}

/** Einzelnes Texel einer Direktfarb-Texturseite (depth 2, BGR555) setzen. */
function setDirectTexel(data: Uint8Array, x: number, y: number, color: Rgba8): void {
  const value = encodeBgr555(color);
  const o = (y * 256 + x) * 2;
  data[o] = value & 0xff;
  data[o + 1] = (value >> 8) & 0xff;
}

// Duplikat der Writer-seitigen BGR555-Kodierung nur für den Fixture-Aufbau
// von Test 3 (Direktfarbe) — Parser/Renderer nutzen weiterhin ausschließlich
// `decodeBgr555` aus formats-field.
function encodeBgr555(c: Rgba8): number {
  if (c[3] === 0) return 0;
  return ((c[0] >> 3) & 0x1f) | (((c[1] >> 3) & 0x1f) << 5) | (((c[2] >> 3) & 0x1f) << 10) | 0x8000;
}

describe('resolveTileRgba: palettierte Kachel', () => {
  it('löst ein 16×16-Muster pixelgenau auf, inklusive eines transparenten Texels', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED, GREEN, BLUE]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;
    expect(palette).not.toBeNull();

    const texData = texturePage(1);
    setPalettizedTexel(texData, 32, 48, 1); // Tile-Texel (0,0) → rot
    setPalettizedTexel(texData, 40, 56, 2); // Tile-Texel (8,8) → grün
    // Tile-Texel (15,15) bleibt Index 0 → transparent.

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          tiles: [{ dstX: 0, dstY: 0, srcX: 32, srcY: 48, paletteId: 0, textureId: 0, bpp: 1 }],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const diagnostics: FieldDiagnostic[] = [];
    const bg = parseBackgroundSection(bgBytes, 'fix', diagnostics)!;
    expect(bg).not.toBeNull();
    expect(diagnostics).toEqual([]);

    const tile = bg.layers[0]!.tiles[0]!;
    const page = bg.texturePages.find((p) => p.slot === tile.textureId);
    const out = resolveTileRgba(tile, page, palette.pages, 16)!;
    expect(out).not.toBeNull();

    const texelAt = (x: number, y: number): number[] => {
      const o = (y * 16 + x) * 4;
      return [...out.slice(o, o + 4)];
    };
    expect(texelAt(0, 0)).toEqual(RED);
    expect(texelAt(8, 8)).toEqual(GREEN);
    expect(texelAt(15, 15)).toEqual(TRANSPARENT);
  });

  it('F31: Misch-Tiles auf Layern > 0 lesen src2 von textureId2, alle anderen src von textureId', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED, GREEN]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texA = texturePage(1);
    fillPalettizedBlock(texA, 0, 0, 16, 1); // Seite 0, src-Region: rot
    const texB = texturePage(1);
    fillPalettizedBlock(texB, 64, 80, 16, 2); // Seite 1, src2-Region: grün

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          // Layer 0 mit gesetztem src2: die alte Heuristik „src2, sobald
          // gesetzt" hätte hier die falsche Region gelesen.
          tiles: [{ dstX: 0, dstY: 0, srcX: 0, srcY: 0, srcX2: 64, srcY2: 80, paletteId: 0, textureId: 0, bpp: 1 }],
        },
        1: {
          width: 1,
          height: 1,
          // Misch-Tile: src2 auf textureId2 (Makou-Regel, F31).
          tiles: [
            {
              dstX: 16, dstY: 0, srcX: 0, srcY: 0, srcX2: 64, srcY2: 80,
              paletteId: 0, textureId: 0, textureId2: 1, blending: 1, typeTrans: 1, bpp: 1,
            },
          ],
        },
      },
      texturePages: [
        { slot: 0, depth: 1, data: texA },
        { slot: 1, depth: 1, data: texB },
      ],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const basis = bg.layers[0]!.tiles[0]!;
    const misch = bg.layers.find((l) => l.index === 1)!.tiles[0]!;
    expect(misch.textureId2).toBe(1);

    // Layer 0 (nicht mischend): erste Felder → Seite 0, Region A, rot.
    const outBasis = resolveTileRgba(basis, bg.texturePages[0]!, palette.pages, 16, 'opaque', 0)!;
    expect([...outBasis.slice(0, 4)]).toEqual(RED);

    // Layer 1 mischend: zweites Paar auf Seite textureId2 → grün.
    const seite = bg.texturePages.find((p) => p.slot === 1)!;
    const outMisch = resolveTileRgba(misch, seite, palette.pages, 16, 'index0', 1)!;
    expect([...outMisch.slice(0, 4)]).toEqual(GREEN);
  });
});

describe('resolveTileRgba: Direktfarbe (bpp 2)', () => {
  it('dekodiert BGR555-Texel ohne Palettenbezug', () => {
    const texData = texturePage(2);
    setDirectTexel(texData, 10, 20, RED);
    setDirectTexel(texData, 11, 20, BLUE);

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          // paletteId ist für Direktfarbe wirkungslos — bewusst mit fremdem Wert belegt.
          tiles: [{ dstX: 0, dstY: 0, srcX: 10, srcY: 20, paletteId: 9, textureId: 0, bpp: 2 }],
        },
      },
      texturePages: [{ slot: 0, depth: 2, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const tile = bg.layers[0]!.tiles[0]!;
    const page = bg.texturePages[0]!;
    expect(page.depth).toBe(2);

    const out = resolveTileRgba(tile, page, [], 16)!;
    expect([...out.slice(0, 4)]).toEqual(RED);
    expect([...out.slice(4, 8)]).toEqual(BLUE);
  });
});

describe('composeBackgroundImage: Ausdehnung und Alpha-Over', () => {
  it('Bildausdehnung folgt der bemalten Fläche; vorderer Layer überschreibt, hinterer bleibt an nicht überlappender Stelle sichtbar', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED, BLUE]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1); // rot, für Layer 0
    fillPalettizedBlock(texData, 16, 0, 16, 2); // blau, für Layer 1

    const bgBytes = composeBackgroundSection({
      layers: {
        0: { width: 1, height: 1, tiles: [{ dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }] },
        1: { width: 1, height: 1, tiles: [{ dstX: 8, dstY: 0, srcX: 16, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }] },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const image = composeBackgroundImage(bg, palette);

    expect(image.originX).toBe(0);
    expect(image.originY).toBe(0);
    expect(image.width).toBe(24); // Layer 0: x 0..16, Layer 1: x 8..24 → Vereinigung 0..24
    expect(image.height).toBe(16);

    const pixelAt = (x: number, y: number): number[] => {
      const o = (y * image.width + x) * 4;
      return [...image.rgba.slice(o, o + 4)];
    };
    expect(pixelAt(2, 2)).toEqual(RED); // nur Layer 0 bemalt hier → hinterer bleibt sichtbar
    expect(pixelAt(10, 2)).toEqual(BLUE); // Überlappung 8..15 → vorderer Layer 1 gewinnt
  });
});

describe('composeBackgroundImage: Zeichenreihenfolge nach z', () => {
  it('das Tile mit kleinerem z (näher) gewinnt auf derselben Zielzelle', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED, BLUE]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1); // rot — "fern", großes z
    fillPalettizedBlock(texData, 16, 0, 16, 2); // blau — "nah", kleines z

    const bgBytes = composeBackgroundSection({
      layers: {
        1: {
          width: 1,
          height: 1,
          tiles: [
            { dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1, z: 50 },
            { dstX: 0, dstY: 0, srcX: 16, srcY: 0, paletteId: 0, textureId: 0, bpp: 1, z: 10 },
          ],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const image = composeBackgroundImage(bg, palette);
    expect([...image.rgba.slice(0, 4)]).toEqual(BLUE);
  });
});

describe('layerTileSize: 32-px-Kacheln bei layerControl 32', () => {
  it('layerTileSize liefert 32, die komponierte Fläche ist entsprechend 32 px je Tile', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 32, 1);

    const bgBytes = composeBackgroundSection({
      layers: {
        2: {
          width: 1,
          height: 1,
          tiles: [{ dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1, layerControl: 32 }],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const layer2 = bg.layers.find((l) => l.index === 2)!;
    expect(layerTileSize(layer2)).toBe(32);

    const image = composeBackgroundImage(bg, palette, { layers: [2] });
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);
  });
});

describe('buildTileAtlas: Deduplizierung und UV-Rechtecke', () => {
  it('identische Varianten teilen einen Atlaseintrag, unterschiedliche Palettenseiten ergeben getrennte Einträge', () => {
    const palBytes = composePaletteSection({
      pages: [
        [TRANSPARENT, RED],
        [TRANSPARENT, GREEN],
      ],
    });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1);

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          tiles: [
            { dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }, // Variante A
            { dstX: 16, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }, // Variante A, anderes dst
            { dstX: 32, dstY: 0, srcX: 0, srcY: 0, paletteId: 1, textureId: 0, bpp: 1 }, // Variante B, andere Palette
          ],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const atlas = buildTileAtlas(bg, palette);
    expect(atlas.issues).toEqual([]);
    expect(atlas.variantCount).toBe(2);

    const tileA = bg.layers[0]!.tiles[0]!;
    const tileDup = bg.layers[0]!.tiles[1]!;
    const tileB = bg.layers[0]!.tiles[2]!;
    const transparency = layerTransparency(0);
    const keyA = tileVariantKey(tileA, 16, transparency, 0);
    const keyB = tileVariantKey(tileB, 16, transparency, 0);
    // Duplikat (anderes dst, sonst identische Variante) teilt sich den Eintrag von A.
    expect(atlas.entries.get(tileVariantKey(tileDup, 16, transparency, 0))).toEqual(atlas.entries.get(keyA));

    const entryA = atlas.entries.get(keyA)!;
    const entryB = atlas.entries.get(keyB)!;
    for (const e of [entryA, entryB]) {
      expect(e.u0).toBeGreaterThanOrEqual(0);
      expect(e.v0).toBeGreaterThanOrEqual(0);
      expect(e.u1).toBeLessThanOrEqual(1);
      expect(e.v1).toBeLessThanOrEqual(1);
      expect(e.u1).toBeGreaterThan(e.u0);
      expect(e.v1).toBeGreaterThan(e.v0);
    }
    // Disjunkte UV-Rechtecke (nebeneinander in derselben Zeile gepackt).
    expect(entryA.u1 <= entryB.u0 || entryB.u1 <= entryA.u0).toBe(true);

    // Atlaspixel an der Eintragsposition stimmen mit resolveTileRgba überein.
    const size = atlas.size;
    const px = Math.round(entryA.u0 * size);
    const py = Math.round(entryA.v0 * size);
    const atlasPixels = atlas.atlases[entryA.atlas]!;
    const expected = resolveTileRgba(tileA, bg.texturePages[0]!, palette.pages, 16, transparency)!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const ao = ((py + y) * size + (px + x)) * 4;
        const eo = (y * 16 + x) * 4;
        expect([...atlasPixels.slice(ao, ao + 4)]).toEqual([...expected.slice(eo, eo + 4)]);
      }
    }
  });
});

describe('Basisebene ist der unterste bemalte Layer, nicht zwingend Layer 0', () => {
  /**
   * Regression: `ship_2` aus dem Originalbestand hat einen leeren Layer 0; sein
   * gesamtes Bild liegt in Layer 1. Wird die Transparenzregel am Layerindex
   * statt an der tatsächlichen Basis festgemacht, gilt dort Index 0 als
   * transparent und stanzt Löcher ins Basisbild (gemessen: 100,00 % Deckung
   * unter `opaque` gegen 94,73 % unter `index0`).
   */
  const painted = {
    width: 2,
    height: 1,
    tiles: [
      { dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }, // Index 1
      { dstX: 16, dstY: 0, srcX: 16, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }, // Index 0
    ],
  };

  function background(layers: BackgroundSectionSpec['layers']) {
    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1); // Index 1 → rot
    fillPalettizedBlock(texData, 16, 0, 16, 0); // Index 0 → echtes Schwarz der Palette
    const bgBytes = composeBackgroundSection({
      layers,
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    return parseBackgroundSection(bgBytes, 'fix', [])!;
  }

  it('deckt das Basisbild auch dann, wenn Layer 0 leer ist und Layer 1 die Basis trägt', () => {
    // Palettenindex 0 ist hier ECHTES Schwarz, nicht transparent — genau der
    // Fall, den die index0-Regel fälschlich ausstanzen würde.
    const palBytes = composePaletteSection({ pages: [[[0, 0, 0, 255], RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const bg = background({ 0: { width: 0, height: 0, tiles: [] }, 1: painted });
    expect(bg.layers.find((l) => l.index === 0)?.tiles ?? []).toHaveLength(0);
    expect(baseLayerIndex(bg)).toBe(1);

    const image = composeBackgroundImage(bg, palette);
    // Beide Kacheln müssen deckend sein: die rote UND die aus Index 0.
    expect([...image.rgba.slice(0, 4)]).toEqual(RED);
    const o = 16 * 4;
    expect([...image.rgba.slice(o, o + 4)]).toEqual([0, 0, 0, 255]);
  });

  it('Gegenprobe: liegt die Basis auf Layer 0, bleibt Index 0 auf Layer 1 ein Loch', () => {
    const palBytes = composePaletteSection({ pages: [[[0, 0, 0, 255], RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const bg = background({ 0: painted, 1: painted });
    expect(baseLayerIndex(bg)).toBe(0);
    // Nur Layer 1 komponieren: Die Basis liegt auf 0, also ist Layer 1 eine
    // Überlagerung und darf nicht zur deckenden Basis befördert werden.
    const overlay = composeBackgroundImage(bg, palette, { layers: [1] });
    const o = 16 * 4;
    expect(overlay.rgba[o + 3]).toBe(0);
    // ...während dieselbe Kachel auf der Basisebene deckend bleibt.
    const base = composeBackgroundImage(bg, palette, { layers: [0] });
    expect([...base.rgba.slice(o, o + 4)]).toEqual([0, 0, 0, 255]);
  });
});

describe('Degradierung: fehlende Texturseite', () => {
  it('erzeugt einen W-BG-TEXMISS-Eintrag und überspringt nur das betroffene Tile', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1);

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          tiles: [
            { dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 9, bpp: 1 }, // Slot 9 existiert nicht
            { dstX: 16, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }, // gültig
          ],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;
    const issues: TileResolveIssue[] = [];
    const image = composeBackgroundImage(bg, palette, { issues });

    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('W-BG-TEXMISS');
    expect(issues[0]!.layer).toBe(0);

    // Das gültige Tile wird trotz des fehlenden Nachbarn weiterhin gezeichnet.
    const o = (0 * image.width + 16) * 4;
    expect([...image.rgba.slice(o, o + 4)]).toEqual(RED);
  });
});

describe('buildFieldBackground: Tiefenfenster (F03)', () => {
  /**
   * Regression md1stin: Layer 0 trägt konstant z = 4095; mit zScale 4 liegt
   * die Sichtdistanz (16380) hinter far = 10000 → unklammert NDC-Tiefe > 1 →
   * der Rasterizer verwirft das komplette Quad. Real gemessen (bg-clip-probe):
   * 795/795 Layer-0-Tiles unsichtbar, ebenso jede Layer-0-Fläche der
   * Kontroll-Fields. Kacheln mit kleinem z (Sichtdistanz < near) fielen
   * spiegelbildlich aus dem vorderen Fenster.
   */
  it('klemmt die NDC-Tiefe aller Tiles auf [-1, 1], hinten wie vorn', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1);

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          // z-Default des Composers für Layer 0 ist 4095 — der md1stin-Fall.
          tiles: [{ dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }],
        },
        1: {
          width: 1,
          height: 1,
          // z = 1 → Sichtdistanz 4 < near → läge vor dem vorderen Fenster.
          tiles: [{ dstX: 16, dstY: 0, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1, z: 1 }],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;

    const render = buildFieldBackground(bg, palette, { near: 100, far: 10000 });
    expect(render.tileCount).toBe(2);
    for (const mesh of render.meshes) {
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        expect(pos.getZ(v)).toBeGreaterThanOrEqual(-1);
        expect(pos.getZ(v)).toBeLessThanOrEqual(1);
      }
    }
    // Ordnung bleibt erhalten: die ferne Basis liegt am hinteren, das nahe
    // Overlay am vorderen Rand des Fensters. (Seit F32 liegen die Layer in
    // getrennten Stapeln — deshalb über alle Meshes eingesammelt.)
    const zWerte = render.meshes.flatMap((m) => {
      const pos = m.geometry.getAttribute('position') as BufferAttribute;
      return Array.from({ length: pos.count }, (_, v) => pos.getZ(v));
    });
    expect(Math.max(...zWerte)).toBeCloseTo(1, 9); // Layer 0, z=4095
    expect(Math.min(...zWerte)).toBeCloseTo(-1, 9); // Layer 1, z=1
  });
});

describe('buildFieldBackground: Koordinatenverschiebung', () => {
  it('dst = (-160,-120) landet im Design-Raster bei (0,0); scrollX/Y verschiebt entsprechend; ein Mesh je Atlas', () => {
    const palBytes = composePaletteSection({ pages: [[TRANSPARENT, RED]] });
    const palette = parsePaletteSection(palBytes, 'fix', [])!;

    const texData = texturePage(1);
    fillPalettizedBlock(texData, 0, 0, 16, 1);

    const bgBytes = composeBackgroundSection({
      layers: {
        0: {
          width: 1,
          height: 1,
          tiles: [{ dstX: -160, dstY: -120, srcX: 0, srcY: 0, paletteId: 0, textureId: 0, bpp: 1 }],
        },
      },
      texturePages: [{ slot: 0, depth: 1, data: texData }],
    });
    const bg = parseBackgroundSection(bgBytes, 'fix', [])!;

    const render = buildFieldBackground(bg, palette, { near: 100, far: 10000 });
    expect(render.tileCount).toBe(1);
    expect(render.meshes).toHaveLength(render.atlas.atlases.length);

    const pos = render.meshes[0]!.geometry.getAttribute('position') as BufferAttribute;
    // Design-Ursprung (0,0) → NDC-Ecke oben links (-1, +1).
    expect(pos.getX(0)).toBeCloseTo(-1, 6);
    expect(pos.getY(0)).toBeCloseTo(1, 6);

    const scrolled = buildFieldBackground(bg, palette, { near: 100, far: 10000, scrollX: 10, scrollY: 5 });
    const posScrolled = scrolled.meshes[0]!.geometry.getAttribute('position') as BufferAttribute;
    // offsetX = 160 − 10 = 150 → x = −160 + 150 = −10.
    expect(posScrolled.getX(0)).toBeCloseTo((-10 / 320) * 2 - 1, 6);
    // offsetY = 120 − 5 = 115 → y = −120 + 115 = −5.
    expect(posScrolled.getY(0)).toBeCloseTo(1 - (-5 / 240) * 2, 6);
  });
});
