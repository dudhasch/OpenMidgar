import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/** S8-Nachprobe: Layout des Texturblocks in Sektion 9 (nach "TEXTURE"). */

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

describe.skipIf(!available)('Realdaten: Sektion-9-Texturblock', () => {
  it('Rohstruktur + Hypothesen-Walk', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let printed = 0;
    const hyp = {
      fields: 0,
      // H-A: 42 Slots {u16 exists; wenn !=0: u16 size, u16 depth, size²·depth}
      hA: 0,
      // H-B: wie H-A, aber Datenlänge = 256·256·depth unabhängig von size
      hB: 0,
      // H-C: exists u16; Daten fix 65536 B (256×256×1)
      hC: 0,
      misfitSamples: [] as string[],
    };

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const s9 = parsed.bundle?.rawSections[9];
      if (!s9) continue;
      const v = new DataView(s9.buffer, s9.byteOffset, s9.byteLength);
      const mTex = findAscii(s9, 'TEXTURE');
      const mEnd = s9.length - 3; // END als letzte 3 Bytes (Runde 1 belegt)
      if (mTex < 0) continue;
      hyp.fields++;

      if (printed < 3) {
        printed++;
        const u16s: number[] = [];
        for (let k = 0; k < 40 && mTex + 7 + k * 2 + 2 <= s9.length; k++) {
          u16s.push(v.getUint16(mTex + 7 + k * 2, true));
        }
        console.log(`RAW ${entry.name}: texRegion=${mEnd - (mTex + 7)}B u16s=[${u16s.join(',')}]`);
      }

      const tryWalk = (dataLen: (size: number, depth: number) => number): boolean => {
        let o = mTex + 7;
        let slots = 0;
        while (o + 2 <= mEnd && slots < 42) {
          const exists = v.getUint16(o, true);
          o += 2;
          slots++;
          if (exists !== 0) {
            if (o + 4 > mEnd) return false;
            const size = v.getUint16(o, true);
            const depth = v.getUint16(o + 2, true);
            const len = dataLen(size, depth);
            if (len < 0 || len > 1 << 22) return false;
            o += 4 + len;
            if (o > mEnd) return false;
          }
        }
        return slots === 42 && o === mEnd;
      };
      if (tryWalk((s, d) => s * s * d)) hyp.hA++;
      else if (tryWalk((_s, d) => 65536 * d)) hyp.hB++;
      else if (tryWalk(() => 65536)) hyp.hC++;
      else if (hyp.misfitSamples.length < 5) {
        // Diagnose: erste Slots im Detail.
        const detail: string[] = [];
        let o = mTex + 7;
        for (let s = 0; s < 4 && o + 6 <= s9.length; s++) {
          detail.push(`slot${s}:[${v.getUint16(o, true)},${v.getUint16(o + 2, true)},${v.getUint16(o + 4, true)}]`);
          o += 6;
        }
        hyp.misfitSamples.push(`${entry.name} region=${mEnd - (mTex + 7)} ${detail.join(' ')}`);
      }
    }

    console.log('Hypothesen:', JSON.stringify(hyp, null, 2));
    expect(hyp.fields).toBeGreaterThan(500);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
