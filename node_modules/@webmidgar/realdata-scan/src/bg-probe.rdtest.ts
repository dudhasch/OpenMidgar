import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S8-Vorprobe: Strukturanalyse der Hintergrund-Sektionen (4 = Palette,
 * 6 = Tile-Map?, 9 = Background) über alle Fields — VOR dem Parserbau.
 *
 * Hypothesen (öffentliche Doku, alle 🟡):
 *  H-P4: Sektion 4 = u32 länge? + u16 palX + u16 palY + u16 colorsPerPage +
 *        u16 pageCount + pageCount·256·u16 Farben (BGR555+Maskenbit)
 *  H-S6: Sektion 6 auf PC funktionslos/leer (Tiles liegen in Sektion 9)
 *  H-B9: Sektion 9 = u16 0, u16 depth, ASCII-Marker "PALETTE" … "BACK" …
 *        "TEXTURE" … "END" + "FINAL FANTASY7"; Tiles à 52 B; Texturseiten
 *        42 Slots {u16 exists; u16 size; u16 depth; size²·depth B}
 *  H-T52: Tile-Record-Feldoffsets — datengetrieben ermitteln (Kandidaten
 *        je Byteoffset gegen Plausibilitätskriterien zählen)
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

describe.skipIf(!available)('Realdaten: Hintergrund-Sektionsproben', () => {
  it('H-P4/H-S6/H-B9/H-T52 prüfen', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const p4 = { fields: 0, exact: 0, mismatch: [] as string[], pageCounts: {} as Record<number, number> };
    const s6 = { lens: {} as Record<number, number> };
    const b9 = {
      fields: 0,
      headerZero: 0,
      markerOrderOk: 0,
      terminatorOk: 0,
      texAccountOk: 0,
      texDepths: {} as Record<string, number>,
      samples: [] as string[],
    };
    // H-T52: je Byteoffset zählen, wie oft Plausibilitätskriterien halten.
    const tileStats = {
      tiles: 0,
      u8lt42: new Array<number>(52).fill(0),
      u8ltPages: new Array<number>(52).fill(0),
      i16small: new Array<number>(52).fill(0), // |i16| <= 3200 an geradem Offset
      i16mult16: new Array<number>(52).fill(0), // i16 % 16 == 0 (16er-Tile-Raster)
      u8mult16: new Array<number>(52).fill(0), // u8 % 16 == 0 (Atlas-Quellraster)
      u8lt16: new Array<number>(52).fill(0), // Palettenindex-Kandidat
      tileRegionFit52: 0,
      tileRegionMisfit: [] as string[],
      texWalkSamples: [] as string[],
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
      const s4 = parsed.bundle.rawSections[4];
      const s6b = parsed.bundle.rawSections[6];
      const s9 = parsed.bundle.rawSections[9];

      if (s4 && s4.length >= 12) {
        p4.fields++;
        const v = new DataView(s4.buffer, s4.byteOffset, s4.byteLength);
        const pageCount = v.getUint16(10, true);
        p4.pageCounts[pageCount] = (p4.pageCounts[pageCount] ?? 0) + 1;
        const expected = 12 + pageCount * 512;
        if (expected === s4.length) p4.exact++;
        else if (p4.mismatch.length < 6) {
          p4.mismatch.push(
            `${entry.name}: len=${s4.length} erw=${expected} (u32@0=${v.getUint32(0, true)} u16@4=${v.getUint16(4, true)} u16@6=${v.getUint16(6, true)} u16@8=${v.getUint16(8, true)} pages=${pageCount})`,
          );
        }
      }
      if (s6b) s6.lens[s6b.length] = (s6.lens[s6b.length] ?? 0) + 1;

      if (s9 && s9.length > 32) {
        b9.fields++;
        const v = new DataView(s9.buffer, s9.byteOffset, s9.byteLength);
        if (v.getUint16(0, true) === 0) b9.headerZero++;
        const mPal = findAscii(s9, 'PALETTE');
        const mBack = findAscii(s9, 'BACK', mPal + 7);
        const mTex = findAscii(s9, 'TEXTURE', mBack + 4);
        const mEnd = findAscii(s9, 'END', mTex + 7);
        const mFinal = findAscii(s9, 'FINAL FANTASY7', mEnd);
        if (mPal >= 0 && mBack > mPal && mTex > mBack && mEnd > mTex) b9.markerOrderOk++;
        if (mFinal >= 0 && mFinal + 14 >= s9.length - 2) b9.terminatorOk++;
        if (b9.samples.length < 4) {
          b9.samples.push(`${entry.name}: PAL@${mPal} BACK@${mBack} TEX@${mTex} END@${mEnd} FINAL@${mFinal} len=${s9.length}`);
        }

        // Rohblick auf die ersten u16 nach TEXTURE (Walk-Fehlerdiagnose).
        if (mTex >= 0 && tileStats.texWalkSamples.length < 5) {
          const first: number[] = [];
          for (let k = 0; k < 14 && mTex + 7 + k * 2 + 2 <= s9.length; k++) {
            first.push(v.getUint16(mTex + 7 + k * 2, true));
          }
          tileStats.texWalkSamples.push(`${entry.name}: [${first.join(',')}]`);
        }
        // Texturseiten-Accounting: ab TEXTURE+7 bis END.
        if (mTex >= 0 && mEnd > mTex) {
          let o = mTex + 7;
          let ok = true;
          let slots = 0;
          while (o + 2 <= mEnd && slots < 64) {
            const exists = v.getUint16(o, true);
            o += 2;
            slots++;
            if (exists !== 0) {
              if (o + 4 > mEnd) {
                ok = false;
                break;
              }
              const size = v.getUint16(o, true);
              const depth = v.getUint16(o + 2, true);
              b9.texDepths[`${size}×${depth}`] = (b9.texDepths[`${size}×${depth}`] ?? 0) + 1;
              o += 4 + size * size * depth;
              if (o > mEnd) {
                ok = false;
                break;
              }
            }
          }
          if (ok && Math.abs(o - mEnd) <= 2 && slots >= 40) b9.texAccountOk++;
        }

        // Tile-Region: zwischen BACK+4 und TEXTURE. Layer-0-Header-Hypothese:
        // u16 w, h, tileCount, depth — dann tileCount·52 B.
        if (mBack >= 0 && mTex > mBack) {
          const lo = mBack + 4;
          const tileCount = v.getUint16(lo + 4, true);
          const tilesStart = lo + 8;
          const tilesEnd = tilesStart + tileCount * 52;
          if (tilesEnd <= mTex && tileCount > 0) {
            tileStats.tileRegionFit52++;
            // Stichprobe: bis 40 Tiles je Field in die Offset-Statistik.
            const pages = s4 && s4.length >= 12 ? new DataView(s4.buffer, s4.byteOffset).getUint16(10, true) : 0;
            // Gleichverteilte Stichprobe über ALLE Tiles (kein Anfangs-Bias).
            const stride = Math.max(1, Math.floor(tileCount / 40));
            for (let t = 0; t < tileCount; t += stride) {
              const to = tilesStart + t * 52;
              tileStats.tiles++;
              for (let b = 0; b < 52; b++) {
                const u8 = s9[to + b]!;
                if (u8 < 42) tileStats.u8lt42[b]!++;
                if (u8 < 16) tileStats.u8lt16[b]!++;
                if (u8 % 16 === 0) tileStats.u8mult16[b]!++;
                if (pages > 0 && u8 < pages) tileStats.u8ltPages[b]!++;
                if (b % 2 === 0 && to + b + 2 <= s9.length) {
                  const i16 = v.getInt16(to + b, true);
                  if (Math.abs(i16) <= 3200) tileStats.i16small[b]!++;
                  if (i16 % 16 === 0) tileStats.i16mult16[b]!++;
                }
              }
            }
          } else if (tileStats.tileRegionMisfit.length < 6) {
            tileStats.tileRegionMisfit.push(
              `${entry.name}: lo-u16s=[${v.getUint16(lo, true)},${v.getUint16(lo + 2, true)},${v.getUint16(lo + 4, true)},${v.getUint16(lo + 6, true)}] Region=${mTex - lo}B tilesEnd-mTex=${tilesEnd - mTex}`,
            );
          }
        }
      }
    }

    const pct = (arr: number[]): string =>
      arr.map((n) => (tileStats.tiles === 0 ? 0 : Math.round((n / tileStats.tiles) * 100))).join(',');
    const topDepths = Object.entries(b9.texDepths).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log('KOMPAKT:', JSON.stringify({
      p4: { fields: p4.fields, exact: p4.exact, pageCounts: p4.pageCounts, mismatch: p4.mismatch },
      s6Lens: s6.lens,
      b9: { fields: b9.fields, headerZero: b9.headerZero, markerOrderOk: b9.markerOrderOk, terminatorOk: b9.terminatorOk, texAccountOk: b9.texAccountOk, topDepths },
    }));
    console.log('B9-Beispiele:', JSON.stringify(b9.samples));
    console.log('TEX-Walk-Rohdaten:', JSON.stringify(tileStats.texWalkSamples, null, 2));
    console.log(`H-T52 Tiles=${tileStats.tiles} regionFit=${tileStats.tileRegionFit52} misfit=${JSON.stringify(tileStats.tileRegionMisfit)}`);
    console.log('%u8<42:    ', pct(tileStats.u8lt42));
    console.log('%u8<16:    ', pct(tileStats.u8lt16));
    console.log('%u8%%16==0: ', pct(tileStats.u8mult16));
    console.log('%u8<pages: ', pct(tileStats.u8ltPages));
    console.log('%|i16|<=3200:', pct(tileStats.i16small));
    console.log('%i16%%16==0: ', pct(tileStats.i16mult16));

    expect(b9.fields).toBeGreaterThan(500);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
