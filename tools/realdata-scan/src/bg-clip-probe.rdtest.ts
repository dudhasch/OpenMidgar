import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { viewDistanceToNdcDepth } from '@webmidgar/convert';
import {
  buildFieldBackground,
  buildTileAtlas,
  buildDrawList,
  DEFAULT_TILE_Z_SCALE,
  tileZToViewDistance,
} from '@webmidgar/render-field';

import { NodeDirectorySource } from './node-source.js';

/**
 * F03-Probe: Verlustbilanz der Hintergrund-Pipeline für md1stin + Kontrollen.
 *
 * Misst je Schritt, wie viele Tiles überleben:
 *   Parser (Sektion 9) → Atlas (fehlende Textur-/Palettenseite) →
 *   DrawList → Tiefenfenster [-1, 1] der Clip-Space-Quads (NEAR/FAR der Demo).
 *
 * Verdachtshypothese: `tileZToViewDistance(4095, 4) = 16380 > FAR = 10000`
 * → NDC-Tiefe > 1 → der Rasterizer verwirft das komplette Quad. Das träfe
 * JEDEN Layer-0-Tile (z konstant 4095), sichtbar bliebe nur, was Layer 1–3
 * mit kleinerem z darüberlegen — exakt das Lochbild aus field-start.jpg.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Demo-Kameraparameter (apps/demo: NEAR=100, FAR=10000). */
const NEAR = 100;
const FAR = 10000;

const FIELDS = ['md1stin', 'md1_1', 'nrthmk', 'cosin1', 'elevtr1', 'ship_2'];

describe.skipIf(!available)('Realdaten: F03 Tile-Verlustbilanz (Depth-Clip)', () => {
  it('bilanziert md1stin und Kontroll-Fields', { timeout: 300_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const wanted = new Set(FIELDS);
    const report: Record<string, unknown> = {};

    for (const entry of index.listEntries('flevel')) {
      if (!wanted.has(entry.name)) continue;
      const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      const bg = parsed.bundle?.background;
      const pal = parsed.bundle?.palette;
      if (!parsed.ok || !bg) {
        report[entry.name] = { fehler: 'kein Background-Bundle' };
        continue;
      }

      const atlas = buildTileAtlas(bg, pal);
      const items = buildDrawList(bg, atlas);
      const built = buildFieldBackground(bg, pal, { near: NEAR, far: FAR });

      const perLayer: Record<string, unknown> = {};
      for (const layer of bg.layers) {
        const layerItems = items.filter((i) => i.layer === layer.index);
        let farClipped = 0;
        let nearClipped = 0;
        // Flächendeckung von Layer 0 vor/nach Clip (Zellen sind disjunkt genug
        // für eine Set-Zählung über dst-Positionen).
        const cellsAll = new Set<string>();
        const cellsSurviving = new Set<string>();
        for (const it of layerItems) {
          const depth = viewDistanceToNdcDepth(
            tileZToViewDistance(it.tile.z, DEFAULT_TILE_Z_SCALE),
            NEAR,
            FAR,
          );
          cellsAll.add(`${it.tile.dstX},${it.tile.dstY}`);
          if (depth > 1) farClipped++;
          else if (depth < -1) nearClipped++;
          else cellsSurviving.add(`${it.tile.dstX},${it.tile.dstY}`);
        }
        const zs = layer.tiles.map((t) => t.z);
        perLayer[`layer${layer.index}`] = {
          parserTiles: layer.tiles.length,
          drawItems: layerItems.length,
          farClipped,
          nearClipped,
          zellenGesamt: cellsAll.size,
          zellenSichtbar: cellsSurviving.size,
          zMin: zs.length ? Math.min(...zs) : null,
          zMax: zs.length ? Math.max(...zs) : null,
        };
      }

      // Abnahme nach Fix: Die Mesh-Vertizes selbst müssen im Clip-Fenster
      // [-1, 1] liegen — sonst verwirft der Rasterizer das Quad.
      let meshZMin = Infinity;
      let meshZMax = -Infinity;
      let meshVerticesOutside = 0;
      for (const mesh of built.meshes) {
        const pos = mesh.geometry.getAttribute('position');
        for (let v = 0; v < pos.count; v++) {
          const z = pos.getZ(v);
          if (z < meshZMin) meshZMin = z;
          if (z > meshZMax) meshZMax = z;
          if (z < -1 || z > 1) meshVerticesOutside++;
        }
      }

      report[entry.name] = {
        parserTilesGesamt: bg.layers.reduce((s, l) => s + l.tiles.length, 0),
        atlasIssues: atlas.issues.length,
        drawListGesamt: items.length,
        buildTileCount: built.tileCount,
        texturSeiten: bg.texturePages.length,
        palettenSeiten: pal?.pages.length ?? 0,
        meshZMin,
        meshZMax,
        meshVerticesOutside,
        perLayer,
      };
    }

    console.log('F03-Bilanz:', JSON.stringify(report, null, 1));
    expect(Object.keys(report)).toContain('md1stin');
    // Nach dem Fix (Tiefenklemmung in buildBackgroundMesh) darf kein einziger
    // Mesh-Vertex mehr außerhalb des Clip-Fensters liegen.
    for (const r of Object.values(report) as { meshVerticesOutside?: number }[]) {
      expect(r.meshVerticesOutside ?? 0).toBe(0);
    }
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
