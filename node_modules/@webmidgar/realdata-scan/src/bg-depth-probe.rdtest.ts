import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Tiefenkalibrierung — Realdatenprobe für drei offene Zuordnungsfragen
 * des Hintergrund-Tile-Records (52 B):
 *   M1 UV-Cache-Regel (welche Quellkoordinate erklärt u32@44/u32@48?)
 *   M2 Texturseiten-ID (u8@34): Teilmenge oder Gleichheit gegen vorhandene
 *      Texturslots? Gegenkandidaten u8@30/u8@32/u8@36 zum Vergleich.
 *   M3 Tile-Z (u16@26) gegen echte Kamera-Sichtdistanz — Suche nach einem
 *      konstanten Umrechnungsfaktor über alle Fields mit Walkmesh + Kamera.
 * Reine Messung, keine Bewertung — Aggregation ausschließlich über console.log.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? NaN;
}

function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))));
  return sorted[idx] ?? NaN;
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(2)}%`);

describe.skipIf(!available)('Realdaten: Tiefenkalibrierung Hintergrund-Tile (S9)', () => {
  it('M1-M3 offene Zuordnungsfragen', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // --- M1: UV-Cache-Regel -------------------------------------------------
    const m1 = {
      tiles: 0,
      r1X: 0,
      r1Y: 0,
      r2X: 0,
      r2Y: 0,
      r3X: 0,
      r3Y: 0,
      noneCombined: 0,
      samples: [] as string[],
    };

    // --- M2: Texturseiten-ID --------------------------------------------------
    const m2Candidates = [34, 30, 32, 36] as const;
    const m2 = {} as Record<
      (typeof m2Candidates)[number],
      { fieldsChecked: number; equalFields: number; subsetFields: number; violationFields: number }
    >;
    for (const off of m2Candidates) {
      m2[off] = { fieldsChecked: 0, equalFields: 0, subsetFields: 0, violationFields: 0 };
    }
    const m2ViolationSamples: string[] = [];

    // --- M3: Tile-Z gegen Sichtdistanz ----------------------------------------
    const m3 = {
      fieldsWithCamAndWalk: 0,
      ratioMedByMed: [] as number[],
      ratioMinByMax: [] as number[],
      ratioMaxByMin: [] as number[],
      zBoundedFields: 0,
      zBoundedChecked: 0,
      globalZHist: new Array(8).fill(0) as number[],
      globalZTotal: 0,
      layer0Total: 0,
      layer0NonMax: 0,
    };

    let fields = 0;
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
      const bg = bundle.background;
      if (!bg) continue;
      fields++;

      // Texturslot-Bestand für M2.
      const existingSlots = new Set(bg.texturePages.map((p) => p.slot));
      const usedByOffset = new Map<number, Set<number>>();
      for (const off of m2Candidates) usedByOffset.set(off, new Set<number>());

      // Globale z-Verteilung (alle Layer, alle Tiles dieses Fields).
      for (const layer of bg.layers) {
        for (const tile of layer.tiles) {
          const raw = tile.raw;
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

          // M1
          const srcX = raw[12]!;
          const srcY = raw[14]!;
          const src2X = raw[16]!;
          const src2Y = raw[18]!;
          const uvX = view.getUint32(44, true);
          const uvY = view.getUint32(48, true);

          const expSrcX = Math.round((srcX / 256) * 1e7);
          const expSrcY = Math.round((srcY / 256) * 1e7);
          const expSrc2X = Math.round((src2X / 256) * 1e7);
          const expSrc2Y = Math.round((src2Y / 256) * 1e7);
          const src2Set = src2X !== 0 || src2Y !== 0;
          const expR3X = src2Set ? expSrc2X : expSrcX;
          const expR3Y = src2Set ? expSrc2Y : expSrcY;

          m1.tiles++;
          const r1x = uvX === expSrcX;
          const r1y = uvY === expSrcY;
          const r2x = uvX === expSrc2X;
          const r2y = uvY === expSrc2Y;
          const r3x = uvX === expR3X;
          const r3y = uvY === expR3Y;
          if (r1x) m1.r1X++;
          if (r1y) m1.r1Y++;
          if (r2x) m1.r2X++;
          if (r2y) m1.r2Y++;
          if (r3x) m1.r3X++;
          if (r3y) m1.r3Y++;

          const explained = (r1x && r1y) || (r2x && r2y) || (r3x && r3y);
          if (!explained) {
            m1.noneCombined++;
            if (m1.samples.length < 10) {
              m1.samples.push(
                `L${layer.index} src=(${srcX},${srcY}) src2=(${src2X},${src2Y}) uv=(${uvX},${uvY})`,
              );
            }
          }

          // M2: Sammle verwendete Werte je Kandidatenoffset.
          for (const off of m2Candidates) {
            usedByOffset.get(off)!.add(raw[off]!);
          }

          // M3 Vorbereitung: globale z-Verteilung u16@26.
          const z = view.getUint16(26, true);
          m3.globalZTotal++;
          const bin = Math.min(7, Math.max(0, Math.floor((z / 4096) * 8)));
          m3.globalZHist[bin] = (m3.globalZHist[bin] ?? 0) + 1;
          if (layer.index === 0) {
            m3.layer0Total++;
            if (z !== 4095) m3.layer0NonMax++;
          }
        }
      }

      // M2 Auswertung je Field.
      if (existingSlots.size > 0) {
        for (const off of m2Candidates) {
          const used = usedByOffset.get(off)!;
          if (used.size === 0) continue;
          m2[off]!.fieldsChecked++;
          let isSubset = true;
          for (const v of used) {
            if (!existingSlots.has(v)) {
              isSubset = false;
              break;
            }
          }
          if (isSubset) {
            if (used.size === existingSlots.size) m2[off]!.equalFields++;
            else m2[off]!.subsetFields++;
          } else {
            m2[off]!.violationFields++;
            if (off === 34 && m2ViolationSamples.length < 8) {
              m2ViolationSamples.push(
                `verwendet=${JSON.stringify(Array.from(used).sort((a, b) => a - b))} vorhanden=${JSON.stringify(Array.from(existingSlots).sort((a, b) => a - b))}`,
              );
            }
          }
        }
      }

      // --- M3: Tile-Z gegen Kamera-Sichtdistanz -------------------------------
      const walkmesh = bundle.walkmesh;
      const cam = bundle.cameras?.cameras[0];
      if (walkmesh && walkmesh.triangles.length > 0 && cam) {
        const R = cam.axes;
        const t = cam.positionRaw;
        const vzList: number[] = [];
        for (const tri of walkmesh.triangles) {
          for (const p of tri.vertices) {
            const vz = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
            vzList.push(vz);
          }
        }
        vzList.sort((a, b) => a - b);
        const vzMin = vzList[0]!;
        const vzMax = vzList[vzList.length - 1]!;
        const vzMedian = median(vzList);

        const zList: number[] = [];
        for (const layer of bg.layers) {
          if (layer.index === 0) continue;
          for (const tile of layer.tiles) {
            const raw = tile.raw;
            const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
            zList.push(view.getUint16(26, true));
          }
        }

        if (zList.length > 0) {
          zList.sort((a, b) => a - b);
          const zMin = zList[0]!;
          const zMax = zList[zList.length - 1]!;
          const zMedian = median(zList);

          m3.fieldsWithCamAndWalk++;
          if (zMedian !== 0) m3.ratioMedByMed.push(vzMedian / zMedian);
          if (zMax !== 0) m3.ratioMinByMax.push(vzMin / zMax);
          if (zMin !== 0) m3.ratioMaxByMin.push(vzMax / zMin);

          m3.zBoundedChecked++;
          if (zMax <= 4095 && zMin >= 0) m3.zBoundedFields++;
        }
      }
    }

    m3.ratioMedByMed.sort((a, b) => a - b);
    m3.ratioMinByMax.sort((a, b) => a - b);
    m3.ratioMaxByMin.sort((a, b) => a - b);

    const result = {
      fields,
      M1_UVCacheRegel: {
        tiles: m1.tiles,
        R1_srcImmer: { X: pct(m1.r1X, m1.tiles), Y: pct(m1.r1Y, m1.tiles) },
        R2_src2Immer: { X: pct(m1.r2X, m1.tiles), Y: pct(m1.r2Y, m1.tiles) },
        R3_bedingt: { X: pct(m1.r3X, m1.tiles), Y: pct(m1.r3Y, m1.tiles) },
        vonKeinerRegelErklaert: m1.noneCombined,
        beispiele: m1.samples,
      },
      M2_Texturseiten: Object.fromEntries(
        m2Candidates.map((off) => [
          `u8@${off}`,
          {
            fieldsChecked: m2[off]!.fieldsChecked,
            equalFields: m2[off]!.equalFields,
            subsetFields: m2[off]!.subsetFields,
            violationFields: m2[off]!.violationFields,
          },
        ]),
      ),
      M2_ViolationBeispiele_u8_34: m2ViolationSamples,
      M3_TiefeKalibrierung: {
        fieldsWithCamAndWalk: m3.fieldsWithCamAndWalk,
        ratio_vzMedian_durch_zMedian: {
          p10: percentile(m3.ratioMedByMed, 10),
          p50: percentile(m3.ratioMedByMed, 50),
          p90: percentile(m3.ratioMedByMed, 90),
          n: m3.ratioMedByMed.length,
        },
        ratio_vzMin_durch_zMax: {
          p10: percentile(m3.ratioMinByMax, 10),
          p50: percentile(m3.ratioMinByMax, 50),
          p90: percentile(m3.ratioMinByMax, 90),
          n: m3.ratioMinByMax.length,
        },
        ratio_vzMax_durch_zMin: {
          p10: percentile(m3.ratioMaxByMin, 10),
          p50: percentile(m3.ratioMaxByMin, 50),
          p90: percentile(m3.ratioMaxByMin, 90),
          n: m3.ratioMaxByMin.length,
        },
        zBounded_0_4095_Anteil: pct(m3.zBoundedFields, m3.zBoundedChecked),
        zBoundedChecked: m3.zBoundedChecked,
        globaleZVerteilung_8Klassen_Layer0bis3: m3.globalZHist,
        globaleZVerteilung_Total: m3.globalZTotal,
        Layer0_Kontrolle: {
          total: m3.layer0Total,
          ausnahmenNicht4095: m3.layer0NonMax,
        },
      },
    };

    console.log('Tiefenkalibrierung:', JSON.stringify(result, null, 2));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
