import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Strukturprobe, 2. Iteration: gezielte Entscheidungstests statt
 * Offsetprofil. Aus der 1. Iteration bekannt:
 *   L0:   @24 u16 ∈ 0..11 (12 Werte), @20 ≈ immer 0, @26/@27 konstant 4095
 *   L1-3: @20 u16 ∈ 2..32 (16 Werte), @24 u16 mit 54 Werten inkl. 0x8000-Bit
 *   beide: @44..@46 und @48..@50 sind 24-Bit-Felder, deren Nichtnull-Zähler
 *          EXAKT mit srcX(@12) bzw. srcY(@14) übereinstimmen
 *
 * Diese Probe entscheidet per Teilmengentest gegen die im selben Field
 * tatsächlich vorhandenen Texturslots/Palettenseiten und kartiert die
 * 24-Bit-Felder gegen srcX/srcY.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Tile-Feldzuordnung (S9-Probe 2)', () => {
  it('Teilmengentests + 24-Bit-Kartierung', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // Teilmengentest: gilt {u8@off über alle Tiles eines Fields} ⊆ Slots?
    const slotSubsetOk = new Array<number>(52).fill(0);
    const slotSubsetNontrivial = new Array<number>(52).fill(0);
    // dito für Palettenseiten, u8 und u16, getrennt nach Layerklasse
    const palOkU16 = { L0: new Array<number>(51).fill(0), L13: new Array<number>(51).fill(0) };
    const palNontrivialU16 = { L0: new Array<number>(51).fill(0), L13: new Array<number>(51).fill(0) };

    // 24-Bit-Kartierung: srcX -> Menge der u32@44-Werte (obere Byte 0)
    const map44 = new Map<number, Set<number>>();
    const map48 = new Map<number, Set<number>>();
    // Beziehung srcX2(@16)/srcY2(@18) zu srcX/srcY
    let src2Equal = 0;
    let src2Present = 0;
    let src2Total = 0;
    // Verteilung der Kandidatenfelder je Layerklasse
    const hist = {
      L0_24: new Map<number, number>(),
      L13_20: new Map<number, number>(),
      L13_24: new Map<number, number>(),
      L13_24hi: new Map<number, number>(),
      L0_38: new Map<number, number>(),
      L13_38: new Map<number, number>(),
      L13_42: new Map<number, number>(),
      L13_30: new Map<number, number>(),
    };
    const bump = (m: Map<number, number>, k: number): void => {
      if (m.size < 80 || m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
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
      const slots = new Set(bg.texturePages.map((p) => p.slot));

      // Wertemengen je Offset für dieses Field sammeln.
      const perOffsetU8: Set<number>[] = Array.from({ length: 52 }, () => new Set<number>());
      const perOffsetU16: { L0: Set<number>[]; L13: Set<number>[] } = {
        L0: Array.from({ length: 51 }, () => new Set<number>()),
        L13: Array.from({ length: 51 }, () => new Set<number>()),
      };

      for (const layer of bg.layers) {
        const cls = layer.index === 0 ? 'L0' : 'L13';
        for (const tile of layer.tiles) {
          const raw = tile.raw;
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          for (let off = 0; off < 52; off++) {
            const s = perOffsetU8[off]!;
            if (s.size < 128) s.add(raw[off]!);
            if (off <= 50) {
              const t = perOffsetU16[cls][off]!;
              if (t.size < 128) t.add(view.getUint16(off, true));
            }
          }
          const srcX = raw[12]!;
          const srcY = raw[14]!;
          const v44 = raw[44]! | (raw[45]! << 8) | (raw[46]! << 16);
          const v48 = raw[48]! | (raw[49]! << 8) | (raw[50]! << 16);
          const m44 = map44.get(srcX) ?? new Set<number>();
          if (m44.size < 6) m44.add(v44);
          map44.set(srcX, m44);
          const m48 = map48.get(srcY) ?? new Set<number>();
          if (m48.size < 6) m48.add(v48);
          map48.set(srcY, m48);

          src2Total++;
          const sx2 = raw[16]!;
          const sy2 = raw[18]!;
          if (sx2 !== 0 || sy2 !== 0) src2Present++;
          if (sx2 === srcX && sy2 === srcY) src2Equal++;

          if (cls === 'L0') {
            bump(hist.L0_24, view.getUint16(24, true));
            bump(hist.L0_38, view.getUint16(38, true));
          } else {
            bump(hist.L13_20, view.getUint16(20, true));
            bump(hist.L13_24, view.getUint16(24, true) & 0x7fff);
            bump(hist.L13_24hi, view.getUint16(24, true) >>> 15);
            bump(hist.L13_38, view.getUint16(38, true));
            bump(hist.L13_42, raw[42]!);
            bump(hist.L13_30, raw[30]!);
          }
        }
      }

      for (let off = 0; off < 52; off++) {
        const vals = perOffsetU8[off]!;
        if (vals.size === 0) continue;
        const nontrivial = !(vals.size === 1 && vals.has(0));
        if (slots.size > 0 && Array.from(vals).every((v) => slots.has(v))) {
          slotSubsetOk[off]!++;
          if (nontrivial) slotSubsetNontrivial[off]!++;
        }
      }
      if (pageCount > 0) {
        for (const cls of ['L0', 'L13'] as const) {
          for (let off = 0; off <= 50; off++) {
            const vals = perOffsetU16[cls][off]!;
            if (vals.size === 0) continue;
            if (Array.from(vals).every((v) => v < pageCount)) {
              palOkU16[cls][off]!++;
              if (!(vals.size === 1 && vals.has(0))) palNontrivialU16[cls][off]!++;
            }
          }
        }
      }
    }

    const topOffsets = (arr: number[], nontrivial: number[]): unknown =>
      arr
        .map((n, off) => ({ off, fieldsOk: n, davonNichttrivial: nontrivial[off]! }))
        .filter((r) => r.davonNichttrivial > 0)
        .sort((a, b) => b.davonNichttrivial - a.davonNichttrivial)
        .slice(0, 12);

    console.log('=== u8@off ⊆ vorhandene Texturslots (je Field) ===');
    console.log(JSON.stringify(topOffsets(slotSubsetOk, slotSubsetNontrivial), null, 1));
    console.log('=== u16@off < Palettenseitenzahl (je Field), Layer 0 ===');
    console.log(JSON.stringify(topOffsets(palOkU16.L0, palNontrivialU16.L0), null, 1));
    console.log('=== u16@off < Palettenseitenzahl (je Field), Layer 1-3 ===');
    console.log(JSON.stringify(topOffsets(palOkU16.L13, palNontrivialU16.L13), null, 1));

    const mapDump = (m: Map<number, Set<number>>): unknown =>
      Array.from(m)
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => [k, Array.from(v).sort((a, b) => a - b)]);
    console.log('=== srcX(@12) -> u24@44 ===\n' + JSON.stringify(mapDump(map44)));
    console.log('=== srcY(@14) -> u24@48 ===\n' + JSON.stringify(mapDump(map48)));

    console.log(
      `=== src2(@16/@18): gesetzt ${src2Present}/${src2Total}, identisch mit src ${src2Equal}/${src2Total} ===`,
    );

    const histDump = (m: Map<number, number>): unknown =>
      Array.from(m).sort((a, b) => a[0] - b[0]).slice(0, 40);
    for (const [name, m] of Object.entries(hist)) {
      console.log(`=== Histogramm ${name} (Wert:Anzahl) ===\n` + JSON.stringify(histDump(m)));
    }
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
