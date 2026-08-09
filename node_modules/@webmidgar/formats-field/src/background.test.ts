import { describe, expect, it } from 'vitest';
import {
  composeBackgroundSection,
  composeFieldContainer,
  composePaletteSection,
  composeWalkmeshSection,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer } from './container.js';
import { effectiveTileSource, parseBackgroundSection } from './sections/background.js';
import { parsePaletteSection } from './sections/palette.js';
import { SECTION } from './nam.js';
import type { FieldDiagnostic } from './diagnostics.js';

/** S8: Hintergrund-/Palettenpfad — Roundtrips über zwei Implementierungen. */

const diag = (): FieldDiagnostic[] => [];

describe('Sektion 4: Palette', () => {
  it('Roundtrip: Seiten, BGR555→RGBA (8er-Schritte verlustfrei), Alpha-0-Farbe', () => {
    const bytes = composePaletteSection({
      pages: [
        [
          [248, 128, 8, 255],
          [0, 0, 0, 0], // transparent → Rohwert 0
          [64, 200, 96, 255],
        ],
        [[16, 16, 240, 255]],
      ],
    });
    const d = diag();
    const pal = parsePaletteSection(bytes, 'fix', d)!;
    expect(pal).not.toBeNull();
    expect(d).toEqual([]);
    expect(pal.pages).toHaveLength(2);
    expect([...pal.pages[0]!.subarray(0, 4)]).toEqual([255, 132, 8, 255]);
    expect(pal.pages[0]![7]).toBe(0); // Alpha der transparenten Farbe
    expect([...pal.pages[1]!.subarray(0, 4)]).toEqual([16, 16, 247, 255]);
  });

  it('E-PAL-SIZE bei inkonsistenter Länge', () => {
    const bytes = composePaletteSection({ pages: [[[1, 2, 3, 255]]] });
    const d = diag();
    expect(parsePaletteSection(new Uint8Array(bytes.subarray(0, bytes.length - 2)), 'fix', d)).toBeNull();
    expect(d.map((x) => x.code)).toContain('E-PAL-SIZE');
  });
});

function backgroundSpec(): Parameters<typeof composeBackgroundSection>[0] {
  const texData = new Uint8Array(65536);
  texData[0] = 7;
  texData[65535] = 9;
  return {
    layers: {
      0: {
        width: 640,
        height: 480,
        tiles: [
          { dstX: -160, dstY: 16, srcX: 32, srcY: 240, paletteId: 3, textureId: 5, bpp: 2 },
          { dstX: 0, dstY: 0, srcX: 0, srcY: 0, paletteId: 1 },
        ],
      },
      1: {
        width: 640,
        height: 480,
        tiles: [
          // src2 gesetzt → der UV-Cache muss src2 abbilden, nicht src.
          { dstX: 16, dstY: -32, srcX: 16, srcY: 16, srcX2: 64, srcY2: 96, paletteId: 2, z: 7, layerControl: 16 },
        ],
      },
      3: { width: 320, height: 240, tiles: [] },
    },
    texturePages: [
      { slot: 0, depth: 1, data: texData },
      { slot: 5, depth: 2 },
    ],
  };
}

describe('Sektion 9: Hintergrund', () => {
  it('Roundtrip: Layer-Flags, Tiles, Texturseiten (Layer 2 aus)', () => {
    const d = diag();
    const bg = parseBackgroundSection(composeBackgroundSection(backgroundSpec()), 'fix', d)!;
    expect(bg).not.toBeNull();
    expect(d).toEqual([]);
    expect(bg.layers.map((l) => l.index)).toEqual([0, 1, 3]);
    const l0 = bg.layers[0]!;
    expect(l0.width).toBe(640);
    expect(l0.tiles).toHaveLength(2);
    expect(l0.tiles[0]).toMatchObject({
      dstX: -160,
      dstY: 16,
      srcX: 32,
      srcY: 240,
      paletteId: 3,
      textureId: 5,
      bpp: 2,
      z: 4095, // Layer-0-Default (hinterste Ebene)
    });
    expect(l0.tiles[0]!.raw.length).toBe(52);
    // UV-Cache = src/256·1e7, hier ohne src2.
    expect(l0.tiles[0]!.uvX).toBe(1_250_000);
    expect(l0.tiles[0]!.uvY).toBe(9_375_000);
    const l1t = bg.layers[1]!.tiles[0]!;
    expect(l1t.dstY).toBe(-32);
    expect(effectiveTileSource(l1t)).toEqual({ x: 64, y: 96 });
    expect(l1t.uvX).toBe(2_500_000);
    expect(l1t.z).toBe(7);
    expect(l1t.layerControl).toBe(16);
    expect(bg.texturePages.map((p) => p.slot)).toEqual([0, 5]);
    expect(bg.texturePages[0]!.data[0]).toBe(7);
    expect(bg.texturePages[0]!.data[65535]).toBe(9);
    expect(bg.texturePages[1]!.depth).toBe(2);
    expect(bg.texturePages[1]!.data.length).toBe(131072);
  });

  it('Leerer Default-Composer ergibt gültigen leeren Hintergrund', () => {
    const d = diag();
    const bg = parseBackgroundSection(composeBackgroundSection(), 'fix', d)!;
    expect(bg).not.toBeNull();
    expect(d).toEqual([]);
    expect(bg.layers).toHaveLength(1);
    expect(bg.layers[0]!.tiles).toHaveLength(0);
    expect(bg.texturePages).toHaveLength(0);
  });

  it('E-BG-HDR bei fehlendem Marker, E-BG-LAYER bei Blank-/Zähler-Defekt, E-BG-TEX bei Tiefe 3', () => {
    const good = composeBackgroundSection(backgroundSpec());

    const noTexture = good.slice();
    const texAt = noTexture.findIndex((_, i) => String.fromCharCode(...noTexture.subarray(i, i + 7)) === 'TEXTURE');
    noTexture[texAt] = 0x58;
    const d1 = diag();
    expect(parseBackgroundSection(noTexture, 'fix', d1)).toBeNull();
    expect(d1.map((x) => x.code)).toContain('E-BG-HDR');

    // Blank-Bytes vor Layer-1-Flag beschädigen (liegen direkt hinter Layer-0-Tiles).
    const badBlank = good.slice();
    const backAt = badBlank.findIndex((_, i) => String.fromCharCode(...badBlank.subarray(i, i + 4)) === 'BACK');
    const l0Tiles = new DataView(badBlank.buffer).getUint16(backAt + 4 + 4, true);
    badBlank[backAt + 4 + 8 + l0Tiles * 52] = 0xff;
    const d2 = diag();
    expect(parseBackgroundSection(badBlank, 'fix', d2)).toBeNull();
    expect(d2.map((x) => x.code)).toContain('E-BG-LAYER');

    // Layer-0-tileCount aufblasen → Accounting bricht.
    const badCount = good.slice();
    new DataView(badCount.buffer).setUint16(backAt + 4 + 4, 9999, true);
    const d3 = diag();
    expect(parseBackgroundSection(badCount, 'fix', d3)).toBeNull();
    expect(d3.map((x) => x.code)).toContain('E-BG-LAYER');

    // Texturtiefe 3 unplausibel.
    const badDepth = good.slice();
    const texStart = texAt + 7;
    new DataView(badDepth.buffer).setUint16(texStart + 2 + 2, 3, true); // Slot 0: exists, size, depth
    const d4 = diag();
    expect(parseBackgroundSection(badDepth, 'fix', d4)).toBeNull();
    expect(d4.map((x) => x.code)).toContain('E-BG-TEX');
  });
});

describe('Container-Integration', () => {
  it('Sektion 4 + 9 landen im Bundle; defekter Hintergrund quarantäniert nur sich selbst', () => {
    const wm = composeWalkmeshSection({
      triangles: [{ vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]] }],
    });
    const good = parseFieldContainer(
      composeFieldContainer({
        sections: {
          [SECTION.WALKMESH]: wm,
          [SECTION.PALETTE]: composePaletteSection({ pages: [[[8, 16, 24, 255]]] }),
          [SECTION.BACKGROUND]: composeBackgroundSection(backgroundSpec()),
        },
      }).bytes,
      'f',
    );
    expect(good.bundle!.palette!.pages).toHaveLength(1);
    expect(good.bundle!.background!.layers).toHaveLength(3);
    // Sektionen 4/9 sauber; 1/2/8 tragen hier bewusst nur 8-B-Füller.
    expect(good.bundle!.quarantinedSections).not.toContain(SECTION.PALETTE);
    expect(good.bundle!.quarantinedSections).not.toContain(SECTION.BACKGROUND);

    const broken = parseFieldContainer(
      composeFieldContainer({
        sections: { [SECTION.WALKMESH]: wm, [SECTION.BACKGROUND]: new Uint8Array(100) },
      }).bytes,
      'f',
    );
    expect(broken.bundle!.background).toBeUndefined();
    expect(broken.bundle!.quarantinedSections).toContain(SECTION.BACKGROUND);
    expect(broken.bundle!.enterable).toBe(true); // Field bleibt begehbar
  });
});
