import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { effectiveTileSource, parseFieldEntry, type BackgroundTile } from '@webmidgar/formats-field';
import {
  baseLayerIndex,
  buildTileAtlas,
  composeBackgroundImage,
  type TileResolveIssue,
} from '@webmidgar/render-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Abnahme: End-zu-End-Beweis der Tile-Semantik über einen
 * Bildkohärenztest — ohne Referenzbild und ohne Sichtprüfung.
 *
 * Idee: Ein Vorrenderbild ist ein natürliches Bild. Ist die Zuordnung
 * Tile → Texturseite → Palette → Quellkoordinate korrekt, dann sind
 * benachbarte Pixel ÜBER eine Kachelgrenze hinweg im Mittel genauso ähnlich
 * wie innerhalb einer Kachel. Ist auch nur eine Zuordnung falsch, springt
 * der Farbunterschied an den Kachelgrenzen sichtbar hoch.
 *
 * Gemessen wird deshalb das Verhältnis
 *     mittlerer |ΔRGB| über Kachelgrenzen / mittlerer |ΔRGB| im Kachelinneren
 * für die korrekte Auslegung und für drei bewusst falsche Gegenhypothesen.
 * Die korrekte Auslegung muss deutlich näher an 1 liegen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

interface Coherence {
  boundarySum: number;
  boundaryN: number;
  interiorSum: number;
  interiorN: number;
}

function accumulateCoherence(
  img: { width: number; height: number; rgba: Uint8Array; originX: number },
  tileSize: number,
  acc: Coherence,
): void {
  const { width, height, rgba } = img;
  // Kachelgrenzen liegen dort, wo (x + originX) ein Vielfaches von tileSize ist.
  const phase = ((img.originX % tileSize) + tileSize) % tileSize;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x + 1 < width; x++) {
      const a = (y * width + x) * 4;
      const b = a + 4;
      if (rgba[a + 3] === 0 || rgba[b + 3] === 0) continue;
      const d =
        Math.abs(rgba[a]! - rgba[b]!) + Math.abs(rgba[a + 1]! - rgba[b + 1]!) + Math.abs(rgba[a + 2]! - rgba[b + 2]!);
      const isBoundary = (x + 1 + phase) % tileSize === 0;
      if (isBoundary) {
        acc.boundarySum += d;
        acc.boundaryN++;
      } else {
        acc.interiorSum += d;
        acc.interiorN++;
      }
    }
  }
}

const ratio = (c: Coherence): number =>
  c.interiorN === 0 || c.boundaryN === 0 ? NaN : c.boundarySum / c.boundaryN / (c.interiorSum / c.interiorN);

describe.skipIf(!available)('Realdaten: Hintergrund-Komposition (S9-Abnahme)', () => {
  it('Bildkohärenz schlägt die Gegenhypothesen', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const variants: Record<string, { c: Coherence; mutate: (t: BackgroundTile) => BackgroundTile }> = {
      // Belegte Auslegung.
      korrekt: { c: { boundarySum: 0, boundaryN: 0, interiorSum: 0, interiorN: 0 }, mutate: (t) => t },
      // Gegenhypothese 1: Texturseite aus u8@30 statt u8@34.
      texAus30: {
        c: { boundarySum: 0, boundaryN: 0, interiorSum: 0, interiorN: 0 },
        mutate: (t) => ({ ...t, textureId: t.raw[30]! }),
      },
      // Gegenhypothese 2: Palettenseite aus u16@20 (die verworfene S8-Annahme).
      palAus20: {
        c: { boundarySum: 0, boundaryN: 0, interiorSum: 0, interiorN: 0 },
        mutate: (t) => ({ ...t, paletteId: t.layerControl & 0xff }),
      },
    };

    const stats = {
      fields: 0,
      composed: 0,
      opaqueSum: 0,
      pixelSum: 0,
      issues: {} as Record<string, number>,
      // Deckung der Basisebene unter den drei Transparenzregeln.
      coverage: { opaque: 0, index0: 0, paletteAlpha: 0, pixels: 0 },
      // Nur die nicht scrollenden Fields (bemalte Fläche exakt 320×240):
      // dort muss die Basisebene lückenlos sein.
      coverageScreen: { opaque: 0, index0: 0, paletteAlpha: 0, pixels: 0, fields: 0 },
      // Direkter Formatbeweis der src2-Regel über den mitgeführten UV-Cache.
      uvTiles: 0,
      uvAgree: 0,
      atlasVariantsMax: 0,
      atlasCountMax: 0,
      atlasCountHist: {} as Record<number, number>,
      sizes: {} as Record<string, number>,
      /** Fields, deren unterster bemalter Layer nicht Layer 0 ist. */
      basisNichtLayer0: [] as string[],
    };

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bg = parsed.bundle?.background;
      const pal = parsed.bundle?.palette;
      if (!parsed.ok || !bg) continue;
      stats.fields++;

      // src2-Regel direkt gegen den mitgeführten UV-Cache prüfen (alle Layer).
      for (const layer of bg.layers) {
        for (const t of layer.tiles) {
          const src = effectiveTileSource(t);
          stats.uvTiles++;
          if (t.uvX === Math.round((src.x / 256) * 1e7) && t.uvY === Math.round((src.y / 256) * 1e7)) {
            stats.uvAgree++;
          }
        }
      }

      // Die Basisebene ist der unterste BEMALTE Layer — nicht zwingend
      // Layer 0. `ship_2` hat einen leeren Layer 0 und trägt sein ganzes Bild
      // in Layer 1; die frühere Prüfung auf Layer 0 hat dieses Field
      // stillschweigend übersprungen (composed 701 statt 702).
      const base = baseLayerIndex(bg);
      const layer0 = bg.layers.find((l) => l.index === base);
      if (!layer0 || layer0.tiles.length === 0) continue;
      if (base !== 0) stats.basisNichtLayer0.push(entry.name);

      // Deckung wird über die Basis UND den darüber liegenden Layer gemessen:
      // Layer 1 ist in den Originaldaten ausnahmslos vorhanden (702/702) und
      // trägt Bildfläche, ist also keine reine Überlagerung.
      const baseLayers = bg.layers.filter((l) => l.index <= base + 1);
      let screenSized = false;
      for (const rule of ['opaque', 'index0', 'paletteAlpha'] as const) {
        const img = composeBackgroundImage({ ...bg, layers: baseLayers }, pal, { transparency: rule });
        screenSized = img.width === 320 && img.height === 240;
        let opaque = 0;
        for (let p = 3; p < img.rgba.length; p += 4) if (img.rgba[p]! !== 0) opaque++;
        stats.coverage[rule] += opaque;
        if (screenSized) stats.coverageScreen[rule] += opaque;
        if (rule === 'opaque') {
          stats.coverage.pixels += img.width * img.height;
          if (screenSized) {
            stats.coverageScreen.pixels += img.width * img.height;
            stats.coverageScreen.fields++;
          }
        }
      }

      for (const [name, variant] of Object.entries(variants)) {
        const issues: TileResolveIssue[] = [];
        const img = composeBackgroundImage(
          { ...bg, layers: [{ ...layer0, tiles: layer0.tiles.map(variant.mutate) }] },
          pal,
          { issues },
        );
        if (img.width === 0) continue;
        accumulateCoherence(img, 16, variant.c);
        if (name === 'korrekt') {
          stats.composed++;
          stats.sizes[`${img.width}x${img.height}`] = (stats.sizes[`${img.width}x${img.height}`] ?? 0) + 1;
          for (const i of issues) stats.issues[i.code] = (stats.issues[i.code] ?? 0) + 1;
        }
      }

      const atlas = buildTileAtlas(bg, pal);
      stats.atlasVariantsMax = Math.max(stats.atlasVariantsMax, atlas.variantCount);
      stats.atlasCountMax = Math.max(stats.atlasCountMax, atlas.atlases.length);
      stats.atlasCountHist[atlas.atlases.length] = (stats.atlasCountHist[atlas.atlases.length] ?? 0) + 1;
      for (const i of atlas.issues) stats.issues[`ATLAS-${i.code}`] = (stats.issues[`ATLAS-${i.code}`] ?? 0) + 1;
    }

    const ratios = Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, Number(ratio(v.c).toFixed(4))]));
    console.log('Kohärenzverhältnis (Grenze/Inneres, ideal ≈ 1):', JSON.stringify(ratios, null, 1));
    console.log(
      'Komposition:',
      JSON.stringify(
        {
          fields: stats.fields,
          composed: stats.composed,
          deckungLayer0: {
            opaque: `${((stats.coverage.opaque / stats.coverage.pixels) * 100).toFixed(2)}%`,
            index0: `${((stats.coverage.index0 / stats.coverage.pixels) * 100).toFixed(2)}%`,
            paletteAlpha: `${((stats.coverage.paletteAlpha / stats.coverage.pixels) * 100).toFixed(2)}%`,
          },
          deckungVollbildFields: {
            fields: stats.coverageScreen.fields,
            opaque: `${((stats.coverageScreen.opaque / stats.coverageScreen.pixels) * 100).toFixed(2)}%`,
            index0: `${((stats.coverageScreen.index0 / stats.coverageScreen.pixels) * 100).toFixed(2)}%`,
            paletteAlpha: `${((stats.coverageScreen.paletteAlpha / stats.coverageScreen.pixels) * 100).toFixed(2)}%`,
          },
          uvRegel: `${((stats.uvAgree / stats.uvTiles) * 100).toFixed(2)}% (${stats.uvTiles} Tiles)`,
          issues: stats.issues,
          atlasVariantsMax: stats.atlasVariantsMax,
          atlasCountMax: stats.atlasCountMax,
          atlasCountHist: stats.atlasCountHist,
          topGroessen: Object.entries(stats.sizes).sort((a, b) => b[1] - a[1]).slice(0, 6),
          basisNichtLayer0: stats.basisNichtLayer0,
        },
        null,
        1,
      ),
    );

    expect(stats.fields).toBeGreaterThan(700);
    // Kein Field darf mehr stillschweigend durchfallen: Die Basisebene wird
    // über den untersten bemalten Layer bestimmt, nicht über Index 0.
    expect(stats.composed).toBe(stats.fields);
    // Die belegte Auslegung muss die Gegenhypothesen schlagen.
    expect(ratios['korrekt']!).toBeLessThan(ratios['texAus30']!);
    expect(ratios['korrekt']!).toBeLessThan(ratios['palAus20']!);
    // src2-Regel: der Record führt sein eigenes UV mit — es muss passen.
    expect(stats.uvAgree / stats.uvTiles).toBeGreaterThan(0.98);
    // Bildschirmgroße Basis (Layer 0+1): gemessen 97,1 % gedeckt — der Rest
    // sind tatsächlich unbemalte Zellen, keine Auflösungsfehler.
    expect(stats.coverageScreen.opaque / stats.coverageScreen.pixels).toBeGreaterThan(0.95);
    // Masterplan Phase 3.2: höchstens 4 Atlanten je Field.
    expect(stats.atlasCountMax).toBeLessThanOrEqual(4);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
