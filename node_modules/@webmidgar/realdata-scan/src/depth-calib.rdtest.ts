import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-Eichung K7: Wie rechnet man den 12-Bit-Tiefenschlüssel `z` der
 * Hintergrund-Tiles in eine Sichtdistanz um?
 *
 * Aus S9 ist belegt, dass `z` KEINE Metrik ist (kein konstanter Faktor zur
 * kameraseitigen Sichtdistanz). Es bleibt aber eine harte Ordnungsbedingung,
 * die sich messen lässt:
 *
 *   Layer 0 trägt ausnahmslos z = 4095 und ist die hinterste Ebene.
 *   Also muss für JEDEN begehbaren Punkt gelten:  vz < 4095 · zScale.
 *
 * Daraus folgt die Untergrenze  zScale > max(vz) / 4095  je Field. Diese Probe
 * misst deren Verteilung und liefert damit einen belegten Vorgabewert statt
 * einer geratenen Konstante. Zusätzlich wird geprüft, wie viele Fields bei
 * zScale = 1 bereits verletzungsfrei sind.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const LAYER0_Z = 4095;

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;

describe.skipIf(!available)('Realdaten: Tiefen-Eichung K7 (S11)', () => {
  it('Untergrenze für zScale aus der Ordnungsbedingung', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const needed: number[] = [];
    const vzMaxAll: number[] = [];
    const fgRatios: number[] = [];
    let fields = 0;
    let okAtOne = 0;
    let withoutCamera = 0;
    let behindCamera = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const b = parsed.bundle;
      if (!parsed.ok || !b?.walkmesh || !b.cameras || b.cameras.cameras.length === 0) {
        if (parsed.ok && b?.walkmesh) withoutCamera++;
        continue;
      }
      const cam = b.cameras.cameras[0]!;
      const R = cam.axes;
      const t = cam.positionRaw;
      let vzMax = -Infinity;
      let anyBehind = false;
      for (const tri of b.walkmesh.triangles) {
        for (const p of tri.vertices) {
          const vz = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
          if (vz <= 0) anyBehind = true;
          if (vz > vzMax) vzMax = vz;
        }
      }
      if (!Number.isFinite(vzMax)) continue;
      fields++;
      if (anyBehind) behindCamera++;
      vzMaxAll.push(vzMax);
      const need = vzMax / LAYER0_Z;
      needed.push(need);
      if (need <= 1) okAtOne++;

      // Anteil der Vordergrund-Tiles (Layer 1–3), die bei zScale = 1 vor dem
      // NÄCHSTEN begehbaren Punkt lägen — grobes Plausibilitätsmaß.
      const fg = b.background?.layers.filter((l) => l.index > 0) ?? [];
      let fgTotal = 0;
      let fgFront = 0;
      let vzMin = Infinity;
      for (const tri of b.walkmesh.triangles) {
        for (const p of tri.vertices) {
          const vz = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
          if (vz > 0 && vz < vzMin) vzMin = vz;
        }
      }
      for (const layer of fg) {
        for (const tile of layer.tiles) {
          fgTotal++;
          if (tile.z < vzMin) fgFront++;
        }
      }
      if (fgTotal > 0) fgRatios.push(fgFront / fgTotal);
    }

    const sortedNeed = [...needed].sort((a, b) => a - b);
    const sortedVz = [...vzMaxAll].sort((a, b) => a - b);
    const sortedFg = [...fgRatios].sort((a, b) => a - b);

    console.log(
      'K7-Eichung:',
      JSON.stringify(
        {
          fields,
          fieldsOhneKamera: withoutCamera,
          fieldsMitPunktHinterKamera: behindCamera,
          maxSichtdistanz: {
            p5: percentile(sortedVz, 0.05),
            p50: percentile(sortedVz, 0.5),
            p95: percentile(sortedVz, 0.95),
            max: sortedVz[sortedVz.length - 1],
          },
          benoetigterZScale: {
            p50: percentile(sortedNeed, 0.5),
            p90: percentile(sortedNeed, 0.9),
            p99: percentile(sortedNeed, 0.99),
            max: sortedNeed[sortedNeed.length - 1],
          },
          fieldsOkBeiZScale1: `${okAtOne}/${fields}`,
          anteilVordergrundTilesVorDerFigur: {
            p5: percentile(sortedFg, 0.05),
            p50: percentile(sortedFg, 0.5),
            p95: percentile(sortedFg, 0.95),
          },
        },
        null,
        1,
      ),
    );

    expect(fields).toBeGreaterThan(600);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
