import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Strukturprobe, 3. Iteration — Entscheidungstests für die Renderfelder.
 * Hypothesen aus Probe 2:
 *   H1 Palettenseite = u8@24 (u16@24 enthält zusätzlich ein Flagbyte @25)
 *   H2 Texturseiten-ID = u8@34
 *   H3 u8@38 = Texeltiefe der Quellseite (1 = palettiert, 2 = direkt)
 *   H4 u32@44 = round(srcX/256·1e7), u32@48 = round(srcY/256·1e7) (UV-Cache)
 *   H5 u16@20 = Kachelgröße in Pixeln (16, seltener 32); Layer 0 lässt das Feld 0
 * Jede Hypothese wird gegen den tatsächlichen Bestand des jeweiligen Fields
 * geprüft (vorhandene Texturslots, Palettenseitenzahl, Rasterlage).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Tile-Renderfelder (S9-Probe 3)', () => {
  it('Entscheidungstests H1-H5', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const c = {
      tiles: 0,
      // H1
      palInRange: 0,
      palChecked: 0,
      palFlagHist: new Map<number, number>(),
      // H2 (Kandidaten im Vergleich)
      texCand: {} as Record<number, { inSlots: number; depthMatch: number }>,
      // H3
      depthHist: new Map<number, number>(),
      // H4
      uvXOk: 0,
      uvYOk: 0,
      uvXMismatchIsSrc2: 0,
      uvXMismatch: 0,
      uvXMismatchSample: [] as string[],
      // H5
      sizeHist: new Map<number, number>(),
      size16DstAligned16: 0,
      size16Total: 0,
      size32DstAligned32: 0,
      size32Total: 0,
      size32SrcAligned32: 0,
      // Layerbezug
      sizeByLayer: {} as Record<number, Record<number, number>>,
    };
    for (const off of [28, 30, 32, 34, 36, 38, 42]) c.texCand[off] = { inSlots: 0, depthMatch: 0 };

    const bump = (m: Map<number, number>, k: number): void => {
      if (m.size < 60 || m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
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
      const bg = parsed.bundle?.background;
      if (!parsed.ok || !bg) continue;
      fields++;
      const pageCount = parsed.bundle?.palette?.pages.length ?? 0;
      const depthBySlot = new Map(bg.texturePages.map((p) => [p.slot, p.depth]));

      for (const layer of bg.layers) {
        for (const tile of layer.tiles) {
          const raw = tile.raw;
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          c.tiles++;

          // H1
          if (pageCount > 0) {
            c.palChecked++;
            if (raw[24]! < pageCount) c.palInRange++;
          }
          bump(c.palFlagHist, raw[25]!);

          // H3
          const bpp = raw[38]!;
          bump(c.depthHist, bpp);

          // H2
          for (const off of [28, 30, 32, 34, 36, 38, 42]) {
            const v = raw[off]!;
            const d = depthBySlot.get(v);
            if (d !== undefined) {
              c.texCand[off]!.inSlots++;
              if (d === bpp) c.texCand[off]!.depthMatch++;
            }
          }

          // H4
          const srcX = raw[12]!;
          const srcY = raw[14]!;
          const u44 = view.getUint32(44, true);
          const u48 = view.getUint32(48, true);
          const expX = Math.round((srcX / 256) * 1e7);
          const expY = Math.round((srcY / 256) * 1e7);
          if (u44 === expX) c.uvXOk++;
          else {
            c.uvXMismatch++;
            if (u44 === Math.round((raw[16]! / 256) * 1e7)) c.uvXMismatchIsSrc2++;
            else if (c.uvXMismatchSample.length < 12) {
              c.uvXMismatchSample.push(`L${layer.index} srcX=${srcX} srcX2=${raw[16]} u44=${u44}`);
            }
          }
          if (u48 === expY) c.uvYOk++;

          // H5
          const size = view.getUint16(20, true);
          bump(c.sizeHist, size);
          const byLayer = (c.sizeByLayer[layer.index] ??= {});
          byLayer[size] = (byLayer[size] ?? 0) + 1;
          if (size === 16) {
            c.size16Total++;
            if (tile.dstX % 16 === 0 && tile.dstY % 16 === 0) c.size16DstAligned16++;
          } else if (size === 32) {
            c.size32Total++;
            if (tile.dstX % 32 === 0 && tile.dstY % 32 === 0) c.size32DstAligned32++;
            if (srcX % 32 === 0 && srcY % 32 === 0) c.size32SrcAligned32++;
          }
        }
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(2)}%`);
    console.log('H1 Palettenseite u8@24 im Bereich:', pct(c.palInRange, c.palChecked), `(${c.palChecked} Tiles)`);
    console.log('H1 Flagbyte @25:', JSON.stringify(Array.from(c.palFlagHist).sort((a, b) => a[0] - b[0])));
    console.log(
      'H2 Texturslot-Kandidaten:',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(c.texCand).map(([off, v]) => [
            off,
            { inSlots: pct(v.inSlots, c.tiles), depthMatch: pct(v.depthMatch, c.tiles) },
          ]),
        ),
        null,
        1,
      ),
    );
    console.log('H3 u8@38:', JSON.stringify(Array.from(c.depthHist).sort((a, b) => a[0] - b[0])));
    console.log(
      `H4 UV-Cache: X ${pct(c.uvXOk, c.tiles)}, Y ${pct(c.uvYOk, c.tiles)}; ` +
        `X-Abweichungen ${c.uvXMismatch}, davon = src2 ${c.uvXMismatchIsSrc2}`,
    );
    console.log('H4 Restabweichungen:', JSON.stringify(c.uvXMismatchSample));
    console.log('H5 u16@20:', JSON.stringify(Array.from(c.sizeHist).sort((a, b) => a[0] - b[0])));
    console.log('H5 je Layer:', JSON.stringify(c.sizeByLayer));
    console.log(
      `H5 Raster: size16 dst%16 ${pct(c.size16DstAligned16, c.size16Total)} (${c.size16Total}), ` +
        `size32 dst%32 ${pct(c.size32DstAligned32, c.size32Total)} src%32 ${pct(c.size32SrcAligned32, c.size32Total)} (${c.size32Total})`,
    );
    console.log(`Fields=${fields} Tiles=${c.tiles}`);

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
