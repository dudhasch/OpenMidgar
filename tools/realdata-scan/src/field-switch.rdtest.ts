import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { FieldSession } from '@webmidgar/field-runtime';
import { buildTileAtlas } from '@webmidgar/render-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-NFR-Messung: Wie teuer ist ein Field-Wechsel?
 *
 * Der Masterplan fordert einen warmen Wechsel unter 500 ms. Diese Probe misst
 * die reine Rechenlast des Wechsels in Node — Entpacken und Parsen des
 * Containers, Aufbau der Sitzung (Solver-Grid, Interpreter) und Auflösen der
 * Hintergrundkacheln in den Atlas. Nicht enthalten sind Browserkosten
 * (GPU-Upload, Worker-Übergabe), aber genau diese Schritte sind der
 * dominierende Anteil und damit eine belastbare untere Schranke.
 *
 * Die Archivbytes kommen aus dem bereits offenen Index — das entspricht dem
 * „warmen" Fall, in dem das LGP-Verzeichnis schon steht.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const NFR_WARM_MS = 500;

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;

describe.skipIf(!available)('Realdaten: Field-Wechsel-Budget (S11)', () => {
  it('Rechenlast je Wechsel gegen die 500-ms-Vorgabe', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const parseMs: number[] = [];
    const sessionMs: number[] = [];
    const atlasMs: number[] = [];
    const totalMs: number[] = [];
    let fields = 0;
    let overBudget = 0;
    let worst = { total: 0, tiles: 0, triangles: 0 };

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      const bytes = await index.readEntry(entry.canonicalId);

      const t0 = performance.now();
      let parsed;
      try {
        parsed = parseFieldEntry(bytes, entry.name);
      } catch {
        continue;
      }
      const t1 = performance.now();
      if (!parsed.ok || !parsed.bundle) continue;
      const bundle = parsed.bundle;
      fields++;

      const session = new FieldSession(bundle, { seed: 1 });
      const t2 = performance.now();

      let tiles = 0;
      if (bundle.background) {
        const atlas = buildTileAtlas(bundle.background, bundle.palette);
        tiles = atlas.variantCount;
      }
      const t3 = performance.now();

      parseMs.push(t1 - t0);
      sessionMs.push(t2 - t1);
      atlasMs.push(t3 - t2);
      const total = t3 - t0;
      totalMs.push(total);
      if (total > NFR_WARM_MS) overBudget++;
      if (total > worst.total) {
        worst = { total, tiles, triangles: bundle.walkmesh?.triangles.length ?? 0 };
      }
      void session;
    }

    const stat = (xs: number[]): Record<string, number> => {
      const s = [...xs].sort((a, b) => a - b);
      return {
        p50: Number(percentile(s, 0.5).toFixed(2)),
        p95: Number(percentile(s, 0.95).toFixed(2)),
        p99: Number(percentile(s, 0.99).toFixed(2)),
        max: Number((s[s.length - 1] ?? 0).toFixed(2)),
      };
    };

    console.log(
      'Field-Wechsel-Budget (ms):',
      JSON.stringify(
        {
          fields,
          container: stat(parseMs),
          sitzung: stat(sessionMs),
          kachelatlas: stat(atlasMs),
          gesamt: stat(totalMs),
          ueberBudget: `${overBudget}/${fields} (> ${NFR_WARM_MS} ms)`,
          teuerstesField: {
            gesamtMs: Number(worst.total.toFixed(2)),
            kachelvarianten: worst.tiles,
            dreiecke: worst.triangles,
          },
        },
        null,
        1,
      ),
    );

    expect(fields).toBeGreaterThan(700);
    // Kein Field darf die Vorgabe schon in der reinen Rechenlast sprengen.
    expect(overBudget).toBe(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
