import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { projectFf7PointToScreen } from '@webmidgar/convert';
import { NodeDirectorySource } from './node-source.js';

/**
 * S8-Realdaten-Probe: FOV-Basis (Masterplan-Kalibrierfrage R2, 240 vs. 224).
 *
 * Messidee: |ndc| ∝ 1/base. Berührt ein Punkt genau den Bildrand, ist
 * base_touch = 240 * |ndc_bei_base_240| die wahre FOV-Basis. Liegt der Punkt
 * innerhalb des Bildes, ist base_touch KLEINER als die wahre Basis — das
 * Maximum von base_touch über viele Fields ist somit eine untere Schranke
 * für die wahre Basis (unverzerrter Diskriminator).
 *
 * Reine Messung — keine Bewertung/Parseränderung, kein Doku-Output.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

interface FieldSample {
  category: 'nonScrolling' | 'scrolling';
  baseTouchX: number;
  baseTouchY: number;
  anyBehindCamera: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : NaN,
  };
}

function histogram(values: number[]) {
  const buckets: Record<string, number> = {
    '<112': 0,
    '112-160': 0,
    '160-200': 0,
    '200-224': 0,
    '224-240': 0,
    '240-280': 0,
    '280-400': 0,
    '>400': 0,
  };
  for (const v of values) {
    if (v < 112) buckets['<112']!++;
    else if (v < 160) buckets['112-160']!++;
    else if (v < 200) buckets['160-200']!++;
    else if (v < 224) buckets['200-224']!++;
    else if (v < 240) buckets['224-240']!++;
    else if (v < 280) buckets['240-280']!++;
    else if (v < 400) buckets['280-400']!++;
    else buckets['>400']!++;
  }
  return buckets;
}

function bump(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN(map: Map<number, number>, n: number): [number, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function categoryStats(samples: FieldSample[]) {
  const baseTouchY = samples.map((s) => s.baseTouchY);
  const baseTouchX = samples.map((s) => s.baseTouchX);
  const behind = samples.filter((s) => s.anyBehindCamera).length;
  const overY224 = samples.filter((s) => s.baseTouchY > 224).length;
  const overY240 = samples.filter((s) => s.baseTouchY > 240).length;
  return {
    fields: samples.length,
    baseTouchY: summarize(baseTouchY),
    baseTouchX: summarize(baseTouchX),
    histogramBaseTouchY: histogram(baseTouchY),
    shareBaseTouchYOver224: samples.length > 0 ? overY224 / samples.length : NaN,
    shareBaseTouchYOver240: samples.length > 0 ? overY240 / samples.length : NaN,
    fieldsWithCornerBehindCamera: behind,
  };
}

describe.skipIf(!available)('Realdaten: FOV-Basis-Probe (R2)', () => {
  it('misst base_touch über alle Fields', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const samples: FieldSample[] = [];
    let fieldsSeen = 0;
    let fieldsMissingParts = 0;
    const layer0Dims: Record<string, number> = {};

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.bundle) continue;
      const bundle = parsed.bundle;
      fieldsSeen++;

      const walkmesh = bundle.walkmesh;
      const cameraSet = bundle.cameras;
      const background = bundle.background;
      if (!walkmesh || !cameraSet || cameraSet.cameras.length === 0 || !background) {
        fieldsMissingParts++;
        continue;
      }

      const layer0 = background.layers.find((l) => l.index === 0);
      if (layer0) {
        const key = `${layer0.width}x${layer0.height}`;
        layer0Dims[key] = (layer0Dims[key] ?? 0) + 1;
      }
      const category: 'nonScrolling' | 'scrolling' =
        layer0 && layer0.width <= 336 && layer0.height <= 256 ? 'nonScrolling' : 'scrolling';

      const cam = cameraSet.cameras[0]!;
      let maxAbsNdcX = 0;
      let maxAbsNdcY = 0;
      let anyBehindCamera = false;

      for (const tri of walkmesh.triangles) {
        for (const p of tri.vertices) {
          const proj = projectFf7PointToScreen(p, cam, { width: 320, height: 240, fovBase: 240 });
          if (!proj.inFront) {
            anyBehindCamera = true;
            continue;
          }
          const ndcX = (proj.x / 320) * 2 - 1;
          const ndcY = 1 - (proj.y / 240) * 2;
          maxAbsNdcX = Math.max(maxAbsNdcX, Math.abs(ndcX));
          maxAbsNdcY = Math.max(maxAbsNdcY, Math.abs(ndcY));
        }
      }

      samples.push({
        category,
        baseTouchX: 240 * maxAbsNdcX,
        baseTouchY: 240 * maxAbsNdcY,
        anyBehindCamera,
      });
    }

    const nonScrolling = samples.filter((s) => s.category === 'nonScrolling');
    const scrolling = samples.filter((s) => s.category === 'scrolling');

    const layer0Top8 = Object.entries(layer0Dims)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const result = {
      fieldsSeen,
      fieldsMissingWalkmeshOrCameraOrBackground: fieldsMissingParts,
      fieldsMeasured: samples.length,
      layer0DimsTop8: layer0Top8,
      nonScrolling: categoryStats(nonScrolling),
      scrolling: categoryStats(scrolling),
    };

    console.log('FOV-Basis-Probe:', JSON.stringify(result, null, 2));

    expect(fieldsSeen).toBeGreaterThan(700);
    await dir.closeAll();
  });

  it(
    'Sichtfenster: cameraRange vs. Layer-0-Bildmaß (Pixelmessung, ohne 3D)',
    { timeout: 900_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      let fieldsSeen = 0;
      let fieldsMeasured = 0;
      let fieldsMissingTriggersOrLayer0 = 0;
      let negativeSpanX = 0;
      let negativeSpanY = 0;

      const swAll = new Map<number, number>();
      const shAll = new Map<number, number>();
      const sw336x256 = new Map<number, number>();
      const sh336x256 = new Map<number, number>();
      const swOther = new Map<number, number>();
      const shOther = new Map<number, number>();

      // cameraRange = [links, unten, rechts, oben]
      let crMin: [number, number, number, number] = [Infinity, Infinity, Infinity, Infinity];
      let crMax: [number, number, number, number] = [-Infinity, -Infinity, -Infinity, -Infinity];

      // Kachelkantenlänge Layer 0: 16px (Layer 0/1 = 16px-Kacheln, Layer 2 = 32px —
      // gilt hier nicht, da ausschließlich Layer 0 vermessen wird).
      const LAYER0_TILE_EDGE = 16;

      let fieldsWithLayer0Tiles = 0;
      const bboxToDeclared = new Map<string, number>();
      const bboxHeightAll = new Map<number, number>();
      const bboxWidthAll = new Map<number, number>();
      const bboxCrossAll = new Map<string, number>();
      let fields336 = 0;
      const bboxHeight336 = new Map<number, number>();
      const bboxWidth336 = new Map<number, number>();
      const bboxCross336 = new Map<string, number>();
      const dstYMin336 = new Map<number, number>();
      const dstYMaxPlus336 = new Map<number, number>();

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle) continue;
        const bundle = parsed.bundle;
        fieldsSeen++;

        const background = bundle.background;
        const layer0 = background?.layers.find((l) => l.index === 0);
        const triggers = bundle.triggers;

        if (!layer0 || !triggers) {
          fieldsMissingTriggersOrLayer0++;
        } else {
          fieldsMeasured++;
          const [left, bottom, right, top] = triggers.cameraRange;
          crMin = [
            Math.min(crMin[0], left),
            Math.min(crMin[1], bottom),
            Math.min(crMin[2], right),
            Math.min(crMin[3], top),
          ];
          crMax = [
            Math.max(crMax[0], left),
            Math.max(crMax[1], bottom),
            Math.max(crMax[2], right),
            Math.max(crMax[3], top),
          ];

          const spanX = right - left;
          const spanY = top - bottom;
          if (spanX < 0) negativeSpanX++;
          if (spanY < 0) negativeSpanY++;

          const sw = layer0.width - spanX;
          const sh = layer0.height - spanY;
          bump(swAll, sw);
          bump(shAll, sh);
          if (layer0.width === 336 && layer0.height === 256) {
            bump(sw336x256, sw);
            bump(sh336x256, sh);
          } else {
            bump(swOther, sw);
            bump(shOther, sh);
          }
        }

        if (layer0 && layer0.tiles.length > 0) {
          fieldsWithLayer0Tiles++;
          let minDstX = Infinity;
          let minDstY = Infinity;
          let maxDstX = -Infinity;
          let maxDstY = -Infinity;
          for (const tile of layer0.tiles) {
            minDstX = Math.min(minDstX, tile.dstX);
            minDstY = Math.min(minDstY, tile.dstY);
            maxDstX = Math.max(maxDstX, tile.dstX + LAYER0_TILE_EDGE);
            maxDstY = Math.max(maxDstY, tile.dstY + LAYER0_TILE_EDGE);
          }
          const bboxW = maxDstX - minDstX;
          const bboxH = maxDstY - minDstY;
          const key = `${bboxW}x${bboxH}->${layer0.width}x${layer0.height}`;
          bboxToDeclared.set(key, (bboxToDeclared.get(key) ?? 0) + 1);

          bump(bboxWidthAll, bboxW);
          bump(bboxHeightAll, bboxH);
          const crossKey = `${bboxW}x${bboxH}`;
          bboxCrossAll.set(crossKey, (bboxCrossAll.get(crossKey) ?? 0) + 1);

          if (layer0.width === 336 && layer0.height === 256) {
            fields336++;
            bump(bboxWidth336, bboxW);
            bump(bboxHeight336, bboxH);
            bboxCross336.set(crossKey, (bboxCross336.get(crossKey) ?? 0) + 1);
            bump(dstYMin336, minDstY);
            bump(dstYMaxPlus336, maxDstY);
          }
        }
      }

      const bboxTop8 = [...bboxToDeclared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

      const fullHistogram = (map: Map<number, number>): [number, number][] =>
        [...map.entries()].sort((a, b) => b[1] - a[1]);

      const crossTableMin3 = (map: Map<string, number>): [string, number][] =>
        [...map.entries()]
          .filter(([, count]) => count >= 3)
          .sort((a, b) => b[1] - a[1]);

      const height336Values = [...bboxHeight336.entries()];
      const exact240 = height336Values.find(([h]) => h === 240)?.[1] ?? 0;
      const exact224 = height336Values.find(([h]) => h === 224)?.[1] ?? 0;
      const otherHeights336 = height336Values
        .filter(([h]) => h !== 240 && h !== 224)
        .sort((a, b) => b[1] - a[1]);

      const result = {
        fieldsSeen,
        fieldsMeasured,
        fieldsMissingTriggersOrLayer0,
        negativeSpanX,
        negativeSpanY,
        cameraRangeObservedRange: {
          left: [crMin[0], crMax[0]],
          bottom: [crMin[1], crMax[1]],
          right: [crMin[2], crMax[2]],
          top: [crMin[3], crMax[3]],
        },
        swTop12: topN(swAll, 12),
        shTop12: topN(shAll, 12),
        nonScrolling336x256: {
          fields: [...sw336x256.values()].reduce((a, b) => a + b, 0),
          swTop12: topN(sw336x256, 12),
          shTop12: topN(sh336x256, 12),
        },
        scrollingOther: {
          fields: [...swOther.values()].reduce((a, b) => a + b, 0),
          swTop12: topN(swOther, 12),
          shTop12: topN(shOther, 12),
        },
        fieldsWithLayer0Tiles,
        bboxVsDeclaredTop8: bboxTop8,
        bboxAll: {
          heightHistogramFull: fullHistogram(bboxHeightAll),
          widthHistogramFull: fullHistogram(bboxWidthAll),
          crossTableMin3: crossTableMin3(bboxCrossAll),
        },
        declared336x256: {
          fields: fields336,
          heightHistogramFull: fullHistogram(bboxHeight336),
          widthHistogramFull: fullHistogram(bboxWidth336),
          crossTableMin3: crossTableMin3(bboxCross336),
          exactHeight240: exact240,
          exactHeight224: exact224,
          otherHeights: otherHeights336,
          dstYMinHistogram: fullHistogram(dstYMin336),
          dstYMaxPlusTileHistogram: fullHistogram(dstYMaxPlus336),
        },
      };

      console.log('Sichtfenster-Probe:', JSON.stringify(result, null, 2));

      expect(fieldsSeen).toBeGreaterThan(700);
      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
