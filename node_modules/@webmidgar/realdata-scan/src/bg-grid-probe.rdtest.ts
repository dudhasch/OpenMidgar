import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Zusatzprobe: Kachelgröße je Layer. `layerControl` (u16@20) ist je Layer
 * konstant (L1 = 16, L2 = 32, L3 = 2…15) — die Frage ist, ob das die
 * Kachelkantenlänge meint. Entscheidend ist die tatsächliche Rasterweite:
 * der kleinste positive Abstand zwischen benachbarten Zielpositionen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Kachelraster (S9)', () => {
  it('minimaler dst-Abstand je Layer', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const gapHist: Record<number, Map<number, number>> = {};
    const overlapByLayer: Record<number, { overlap16: number; cells: number }> = {};
    let fields = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bg = parsed.bundle?.background;
      if (!parsed.ok || !bg) continue;
      fields++;
      for (const layer of bg.layers) {
        if (layer.tiles.length < 2) continue;
        // Kleinster positiver Abstand zwischen verschiedenen dstX-Werten
        // innerhalb derselben Zeile (gleiches dstY).
        const rows = new Map<number, number[]>();
        for (const t of layer.tiles) {
          const r = rows.get(t.dstY) ?? [];
          r.push(t.dstX);
          rows.set(t.dstY, r);
        }
        let minGap = Infinity;
        for (const xs of rows.values()) {
          xs.sort((a, b) => a - b);
          for (let i = 1; i < xs.length; i++) {
            const g = xs[i]! - xs[i - 1]!;
            if (g > 0 && g < minGap) minGap = g;
          }
        }
        if (Number.isFinite(minGap)) {
          const m = (gapHist[layer.index] ??= new Map());
          m.set(minGap, (m.get(minGap) ?? 0) + 1);
        }
        // Belegungstest: Wie viele Tiles landen bei 16er-Zellen auf derselben Zelle?
        const seen = new Set<string>();
        let overlap = 0;
        for (const t of layer.tiles) {
          const k = `${t.dstX},${t.dstY}`;
          if (seen.has(k)) overlap++;
          else seen.add(k);
        }
        const o = (overlapByLayer[layer.index] ??= { overlap16: 0, cells: 0 });
        o.overlap16 += overlap;
        o.cells += layer.tiles.length;
      }
    }

    console.log(
      'Minimaler dst-Abstand je Layer (Wert:Fields):',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(gapHist).map(([k, m]) => [k, Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, 8)]),
        ),
      ),
    );
    console.log('Doppelt belegte Zielzellen je Layer:', JSON.stringify(overlapByLayer));
    console.log(`Fields=${fields}`);
    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
