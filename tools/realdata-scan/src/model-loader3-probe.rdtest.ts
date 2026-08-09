import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Strukturprobe, Accounting-Raster (Methode aus S7/S8: eine Grammatik ist
 * genau dann richtig, wenn sie die Sektion über ALLE Fields byteexakt ausläuft).
 *
 * Belegt aus den Iterationen 1/2/5 (maskierter Bytestrom-Dump):
 *   Kopf     : u16 0 · u16 Modellzahl (1…12) · u16 Skala (512 in 643/702)
 *   je Modell: u16 nameLen · name[nameLen] · u16 (=0) · Dateifeld ·
 *              u16 animCount · Binärblock · animCount × Animationsrecord
 *   je Anim  : u16 nameLen · name[nameLen] · u16 (=1)
 *
 * Unbekannt bleiben nur noch drei Festlängen: das Dateifeld (`file`), der
 * Binärblock (`block`) und der Anhang je Animation (`animTail`). Genau die
 * variiert dieses Raster.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

interface Grammar {
  gapAfterName: number;
  file: number;
  block: number;
  animTail: number;
}

function walk(data: Uint8Array, view: DataView, g: Grammar): number {
  const need = (o: number, n: number): boolean => o + n <= data.length;
  if (!need(0, 6)) return -1;
  const models = view.getUint16(2, true);
  if (models === 0 || models > 32) return -1;
  let o = 6;
  for (let m = 0; m < models; m++) {
    if (!need(o, 2)) return -1;
    const nameLen = view.getUint16(o, true);
    o += 2;
    if (nameLen < 1 || nameLen > 64 || !need(o, nameLen)) return -1;
    o += nameLen;
    if (!need(o, g.gapAfterName + g.file + 2)) return -1;
    o += g.gapAfterName + g.file;
    const anims = view.getUint16(o, true);
    o += 2;
    if (anims > 128 || !need(o, g.block)) return -1;
    o += g.block;
    for (let a = 0; a < anims; a++) {
      if (!need(o, 2)) return -1;
      const aLen = view.getUint16(o, true);
      o += 2;
      if (aLen < 1 || aLen > 64 || !need(o, aLen + g.animTail)) return -1;
      o += aLen + g.animTail;
    }
  }
  return o;
}

describe.skipIf(!available)('Realdaten: Sektion 3 Grammatik (S10-Probe 3)', () => {
  it('Accounting-Raster über alle Fields', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const sections: Uint8Array[] = [];
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const data = parsed.bundle?.rawSections[SECTION_MODEL_LOADER];
      if (parsed.ok && data && data.length >= 8) sections.push(data);
    }

    const results: { g: string; exact: number; tail: Record<number, number>; broken: number }[] = [];
    for (const gapAfterName of [0, 2]) {
      for (let file = 8; file <= 16; file += 1) {
        for (let block = 0; block <= 48; block += 1) {
          for (const animTail of [0, 2, 4]) {
            const g: Grammar = { gapAfterName, file, block, animTail };
            let exact = 0;
            let broken = 0;
            const tail: Record<number, number> = {};
            for (const data of sections) {
              const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
              const end = walk(data, view, g);
              if (end < 0) broken++;
              else if (end === data.length) exact++;
              else if (data.length - end <= 16) tail[data.length - end] = (tail[data.length - end] ?? 0) + 1;
            }
            if (exact >= sections.length * 0.5) {
              results.push({ g: `gap${gapAfterName}/file${file}/block${block}/tail${animTail}`, exact, tail, broken });
            }
          }
        }
      }
    }
    results.sort((a, b) => b.exact - a.exact);

    console.log(`Sektionen=${sections.length}`);
    console.log('Beste Grammatiken:', JSON.stringify(results.slice(0, 8), null, 1));

    expect(sections.length).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
