import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { decompressLzsEntry, SECTION } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

describe.skipIf(!existsSync(REAL_DIR))('Kamerasektion: Längenprobe', () => {
  it('sammelt Sektion-2-Längenhistogramm über echte Fields', { timeout: 300_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const lenHist = new Map<number, number>();
    let sampled = 0;
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.') || entry.name === 'maplist') continue;
      try {
        const bytes = await index.readEntry(entry.canonicalId);
        const container = decompressLzsEntry(bytes);
        const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
        const ptr = view.getUint32(6 + (SECTION.CAMERA - 1) * 4, true);
        const len = view.getUint32(ptr, true);
        lenHist.set(len, (lenHist.get(len) ?? 0) + 1);
        sampled++;
      } catch {
        /* Nicht-Field */
      }
    }
    const sorted = [...lenHist.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Sektion-2-Längen (${sampled} Fields):`, JSON.stringify(sorted.slice(0, 12)));
    console.log(
      'mod 40:',
      JSON.stringify(sorted.slice(0, 12).map(([len, n]) => [len, len % 40, n])),
    );
    expect(sampled).toBeGreaterThan(600);
    await dir.closeAll();
  });
});
