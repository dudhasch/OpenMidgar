import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { decompressLzsEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S8-Verifikationsprobe des korrigierten Layer-Modells:
 *   Layer 0: 8-B-Header + n·52 + 4 Blank
 *   Layer 1–3: u8 flag; wenn 1: (6 + rest)-Header + n·52 + 4 Blank
 *   rest-Kandidaten je Layer werden exakt gegen TEXTURE ge-accountet.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

function findAscii(bytes: Uint8Array, text: string, from = 0): number {
  outer: for (let i = from; i <= bytes.length - text.length; i++) {
    for (let c = 0; c < text.length; c++) {
      if (bytes[i + c] !== text.charCodeAt(c)) continue outer;
    }
    return i;
  }
  return -1;
}

describe.skipIf(!available)('Realdaten: korrigiertes Layer-Modell', () => {
  it('Blank-nach-Tiles-Accounting', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const REST = [
      { l1: 16, l2: 10, l3: 14 },
      { l1: 12, l2: 6, l3: 10 },
      { l1: 16, l2: 12, l3: 16 },
      { l1: 20, l2: 14, l3: 18 },
    ];
    const fits: Record<string, number> = {};
    let fields = 0;
    const unsolved: string[] = [];

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let bytes: Uint8Array;
      try {
        bytes = decompressLzsEntry(await index.readEntry(entry.canonicalId));
      } catch {
        continue;
      }
      // Sektion 9 direkt schneiden (Container: 9. Zeiger).
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.length < 42 || view.getUint32(2, true) !== 9) continue;
      const ptr = view.getUint32(6 + 8 * 4, true);
      if (ptr + 4 > bytes.length) continue;
      const len = view.getUint32(ptr, true);
      const s9 = bytes.subarray(ptr + 4, ptr + 4 + len);
      const v = new DataView(s9.buffer, s9.byteOffset, s9.byteLength);
      const mBack = findAscii(s9, 'BACK', 12);
      const mTex = findAscii(s9, 'TEXTURE', mBack);
      if (mBack < 0 || mTex < 0) continue;
      fields++;

      let any = false;
      for (const r of REST) {
        // Regel: 4-Blank-SEP nach jedem AKTIVEN Block, sofern noch ein
        // Flag folgt; nach dem Layer-3-Block direkt TEXTURE.
        let o = mBack + 4;
        o += 8 + v.getUint16(o + 4, true) * 52; // Layer 0 (immer aktiv)
        let prevActive = true;
        let ok = o <= mTex;
        for (const rest of [r.l1, r.l2, r.l3]) {
          if (!ok) break;
          if (prevActive) o += 4; // SEP
          if (o + 1 > mTex) {
            ok = false;
            break;
          }
          const flag = s9[o]!;
          o += 1;
          if (flag === 0) {
            prevActive = false;
            continue;
          }
          if (flag !== 1) {
            ok = false;
            break;
          }
          o += 6 + rest + v.getUint16(o + 4, true) * 52;
          prevActive = true;
          if (o > mTex) ok = false;
        }
        if (ok && o === mTex) {
          fits[`l1:${r.l1}/l2:${r.l2}/l3:${r.l3}`] = (fits[`l1:${r.l1}/l2:${r.l2}/l3:${r.l3}`] ?? 0) + 1;
          any = true;
        }
      }
      if (!any && unsolved.length < 5) unsolved.push(entry.name);
    }

    console.log('KOMPAKT:', JSON.stringify({ fields, fits, unsolved }));
    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
