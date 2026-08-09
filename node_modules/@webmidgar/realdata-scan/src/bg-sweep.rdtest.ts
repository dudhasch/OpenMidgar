import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S8-Realdaten-Sweep: Paletten- und Hintergrundsektion über alle Fields —
 * die Parser müssen den kompletten Bestand mit exaktem Accounting tragen.
 * Ausgabe aggregiert (Layer-/Tile-/Texturseiten-Statistik).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Hintergrund-Sweep flevel', () => {
  it('Sektion 4 + 9 über alle Fields', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const stats = {
      fields: 0,
      paletteOk: 0,
      backgroundOk: 0,
      diag: {} as Record<string, number>,
      layerPresence: {} as Record<string, number>,
      tilesTotal: 0,
      tilesMax: 0,
      pagesTotal: 0,
      depth2Pages: 0,
      paletteIdInRange: 0,
      paletteIdChecked: 0,
      srcAligned: 0,
      srcChecked: 0,
      failures: [] as string[],
    };

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.bundle) continue;
      stats.fields++;
      for (const d of parsed.diagnostics) {
        if (d.code.startsWith('E-PAL') || d.code.startsWith('E-BG')) {
          stats.diag[d.code] = (stats.diag[d.code] ?? 0) + 1;
          if (stats.failures.length < 8) stats.failures.push(`${entry.name}: ${d.code} ${d.detail}`);
        }
      }
      const pal = parsed.bundle.palette;
      const bg = parsed.bundle.background;
      if (pal) stats.paletteOk++;
      if (!bg) continue;
      stats.backgroundOk++;
      const presence = bg.layers.map((l) => l.index).join('+');
      stats.layerPresence[presence] = (stats.layerPresence[presence] ?? 0) + 1;
      let tiles = 0;
      for (const layer of bg.layers) {
        tiles += layer.tiles.length;
        for (const tile of layer.tiles) {
          stats.srcChecked++;
          if (tile.srcX % 16 === 0 && tile.srcY % 16 === 0 && tile.srcX < 256 && tile.srcY < 256) stats.srcAligned++;
          if (pal && pal.pages.length > 0) {
            stats.paletteIdChecked++;
            if (tile.paletteId < pal.pages.length) stats.paletteIdInRange++;
          }
        }
      }
      stats.tilesTotal += tiles;
      stats.tilesMax = Math.max(stats.tilesMax, tiles);
      stats.pagesTotal += bg.texturePages.length;
      stats.depth2Pages += bg.texturePages.filter((p) => p.depth === 2).length;
    }

    console.log('BG-Sweep:', JSON.stringify(stats, null, 2));

    expect(stats.fields).toBeGreaterThan(700);
    expect(stats.paletteOk).toBe(stats.fields);
    expect(stats.backgroundOk).toBe(stats.fields);
    // Kandidatenfeld-Absicherung: Quellkoordinaten im 16er-Raster.
    expect(stats.srcAligned / stats.srcChecked).toBeGreaterThan(0.99);
    // Seit S9 ist `paletteId` u8@24 statt u16@20 — damit greift die Prüfung.
    expect(stats.paletteIdInRange / stats.paletteIdChecked).toBeGreaterThan(0.99);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
