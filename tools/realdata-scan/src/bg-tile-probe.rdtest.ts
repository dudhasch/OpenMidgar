import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S9-Strukturprobe (Methodik-Standard seit S7: Fakten VOR Parserbau):
 * Semantik des 52-Byte-Tile-Records. Bisher belegt sind dstX@4, dstY@6,
 * srcX@12, srcY@14. Offen: Texturseiten-ID, Palettenseite, Blend/State/Param
 * und die Tiefeninformation.
 *
 * Verfahren: Für jeden Byte-Offset werden Wertebereich und Kardinalität über
 * alle Tiles erhoben, dazu gezielte Hypothesentests gegen die im selben Field
 * tatsächlich vorhandenen Texturslots bzw. Palettenseiten. Ausgabe ist
 * ausschließlich aggregiert (keine Originaldaten).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

interface OffsetStat {
  u8min: number;
  u8max: number;
  u8distinct: Set<number>;
  u8nonzero: number;
  u16min: number;
  u16max: number;
  u16distinct: Set<number>;
}

const DISTINCT_CAP = 400;

function newStat(): OffsetStat {
  return {
    u8min: 255,
    u8max: 0,
    u8distinct: new Set(),
    u8nonzero: 0,
    u16min: 0xffff,
    u16max: 0,
    u16distinct: new Set(),
  };
}

describe.skipIf(!available)('Realdaten: Tile-Record-Semantik (S9-Probe)', () => {
  it('Offsetprofil + Hypothesentests über alle Tiles', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // Getrennte Profile: Layer 0 verhält sich erfahrungsgemäß anders als 1–3.
    const profiles = new Map<string, OffsetStat[]>();
    const profileFor = (key: string): OffsetStat[] => {
      let p = profiles.get(key);
      if (!p) {
        p = Array.from({ length: 52 }, newStat);
        profiles.set(key, p);
      }
      return p;
    };

    // Hypothesenzähler je Offset.
    const hSlotU8 = new Array<number>(52).fill(0); // u8@off ist ein vorhandener Texturslot
    const hSlotU8Lt42 = new Array<number>(52).fill(0);
    const hPalU8 = new Array<number>(52).fill(0); // u8@off < Palettenseiten
    const hPalU16 = new Array<number>(51).fill(0); // u16@off < Palettenseiten
    let tilesTotal = 0;
    let tilesWithPages = 0;
    let tilesWithPalette = 0;

    const layerDst = new Map<number, { minX: number; maxX: number; minY: number; maxY: number }>();
    const layerHeaderSamples = new Map<number, Map<string, number>>();
    const layerWh = new Map<number, Map<string, number>>();

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

      for (const layer of bg.layers) {
        const wh = layerWh.get(layer.index) ?? new Map<string, number>();
        const whKey = `${layer.width}x${layer.height}`;
        wh.set(whKey, (wh.get(whKey) ?? 0) + 1);
        layerWh.set(layer.index, wh);

        const hs = layerHeaderSamples.get(layer.index) ?? new Map<string, number>();
        const hkey = Array.from(layer.headerRaw).join(',');
        hs.set(hkey, (hs.get(hkey) ?? 0) + 1);
        layerHeaderSamples.set(layer.index, hs);

        const prof = profileFor(layer.index === 0 ? 'L0' : 'L1-3');
        let box = layerDst.get(layer.index);
        if (!box) {
          box = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
          layerDst.set(layer.index, box);
        }

        for (const tile of layer.tiles) {
          tilesTotal++;
          if (slots.size > 0) tilesWithPages++;
          if (pageCount > 0) tilesWithPalette++;
          box.minX = Math.min(box.minX, tile.dstX);
          box.maxX = Math.max(box.maxX, tile.dstX);
          box.minY = Math.min(box.minY, tile.dstY);
          box.maxY = Math.max(box.maxY, tile.dstY);

          const raw = tile.raw;
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          for (let off = 0; off < 52; off++) {
            const b = raw[off]!;
            const s = prof[off]!;
            if (b < s.u8min) s.u8min = b;
            if (b > s.u8max) s.u8max = b;
            if (b !== 0) s.u8nonzero++;
            if (s.u8distinct.size < DISTINCT_CAP) s.u8distinct.add(b);
            if (off <= 50) {
              const w = view.getUint16(off, true);
              if (w < s.u16min) s.u16min = w;
              if (w > s.u16max) s.u16max = w;
              if (s.u16distinct.size < DISTINCT_CAP) s.u16distinct.add(w);
              if (pageCount > 0 && w < pageCount) hPalU16[off]!++;
            }
            if (slots.size > 0 && slots.has(b)) hSlotU8[off]!++;
            if (b < 42) hSlotU8Lt42[off]!++;
            if (pageCount > 0 && b < pageCount) hPalU8[off]!++;
          }
        }
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
    const dump = (key: string): string[] => {
      const prof = profiles.get(key);
      if (!prof) return [];
      return prof.map((s, off) => {
        const u8 = `u8[${s.u8min}..${s.u8max}] d=${s.u8distinct.size}${s.u8distinct.size >= DISTINCT_CAP ? '+' : ''} nz=${s.u8nonzero}`;
        const u16 =
          off <= 50 ? ` | u16[${s.u16min}..${s.u16max}] d=${s.u16distinct.size}${s.u16distinct.size >= DISTINCT_CAP ? '+' : ''}` : '';
        return `@${String(off).padStart(2)} ${u8}${u16}`;
      });
    };

    console.log('=== Tile-Offsetprofil Layer 0 ===\n' + dump('L0').join('\n'));
    console.log('=== Tile-Offsetprofil Layer 1-3 ===\n' + dump('L1-3').join('\n'));

    const slotRates = hSlotU8
      .map((n, off) => ({ off, inSlots: pct(n, tilesWithPages), lt42: pct(hSlotU8Lt42[off]!, tilesTotal) }))
      .filter((r) => r.inSlots !== '0.0%');
    console.log('=== Hypothese "u8@off ist vorhandener Texturslot" ===\n' + JSON.stringify(slotRates, null, 1));

    const palRates = hPalU16
      .map((n, off) => ({ off, u16: pct(n, tilesWithPalette), u8: pct(hPalU8[off]!, tilesWithPalette) }))
      .filter((r) => r.u16 !== '0.0%' || r.u8 !== '0.0%');
    console.log('=== Hypothese "Wert < Palettenseitenzahl" ===\n' + JSON.stringify(palRates, null, 1));

    console.log('=== dst-Bounding-Boxen je Layer ===\n' + JSON.stringify(Object.fromEntries(layerDst), null, 1));
    console.log(
      '=== Layer w/h Top-Werte ===\n' +
        JSON.stringify(
          Object.fromEntries(
            Array.from(layerWh, ([k, m]) => [
              k,
              Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, 6),
            ]),
          ),
          null,
          1,
        ),
    );
    console.log(
      '=== Layer-Headerrest: Anzahl verschiedener Muster ===\n' +
        JSON.stringify(
          Object.fromEntries(
            Array.from(layerHeaderSamples, ([k, m]) => [
              k,
              { distinct: m.size, top: Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, 3) },
            ]),
          ),
          null,
          1,
        ),
    );
    console.log(`Fields=${fields} Tiles=${tilesTotal}`);

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
