import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-Probe: Woran erkennt man einen UNGENUTZTEN Gateway-Slot?
 *
 * Jedes Field trägt genau 12 Gateway-Records (702 × 12 = 8424). Nur ein Teil
 * ist belegt: 740 Records nennen ein `destFieldId` außerhalb des Bestands,
 * darunter auffällige Byte-Wiederholungsmuster (0xC0C0, 0x4040, 0x2020) —
 * typisch für nie beschriebene Slots. Der bisherige Sentinel-Test
 * (`destFieldId !== 0x7FFF`) greift dort nicht.
 *
 * Geprüft werden konkurrierende Erkennungsmerkmale, jeweils gegen die
 * Kontrollgröße „destFieldId liegt im Bestand".
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Gateway-Belegung (S11-Probe)', () => {
  it('Erkennungsmerkmale ungenutzter Slots', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const bundles = [];
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      try {
        const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        if (parsed.ok && parsed.bundle) bundles.push(parsed.bundle);
      } catch {
        /* Nicht-Fields überspringen */
      }
    }
    const fieldCount = bundles.length;

    const destHist = new Map<number, number>();
    // Kandidatenmerkmale, jeweils als Vierfeldertafel gegen „Ziel im Bestand".
    const marks = {
      degenerateLine: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
      zeroLine: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
      zeroDestination: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
      repeatedBytes: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
      sentinel7fff: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
    };
    let total = 0;
    let inRange = 0;

    for (const bundle of bundles) {
      for (const g of bundle.triggers?.gateways ?? []) {
        total++;
        const within = g.destFieldId >= 0 && g.destFieldId < fieldCount;
        if (within) inRange++;
        if (destHist.size < 40 || destHist.has(g.destFieldId)) {
          destHist.set(g.destFieldId, (destHist.get(g.destFieldId) ?? 0) + 1);
        }

        const [a, b] = g.exitLine;
        const degenerate = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        const zeroLine = a.every((v) => v === 0) && b.every((v) => v === 0);
        const zeroDest = g.destination.every((v) => v === 0);
        const lo = g.destFieldId & 0xff;
        const hi = (g.destFieldId >> 8) & 0xff;
        const repeated = lo === hi && lo !== 0;
        const sentinel = g.destFieldId === 0x7fff;

        const put = (m: { yesIn: number; yesOut: number; noIn: number; noOut: number }, flag: boolean): void => {
          if (flag) {
            if (within) m.yesIn++;
            else m.yesOut++;
          } else if (within) m.noIn++;
          else m.noOut++;
        };
        put(marks.degenerateLine, degenerate);
        put(marks.zeroLine, zeroLine);
        put(marks.zeroDestination, zeroDest);
        put(marks.repeatedBytes, repeated);
        put(marks.sentinel7fff, sentinel);
      }
    }

    // --- Wo steckt die Zielfield-Nummer wirklich? --------------------------
    // Nur belegte Slots betrachten (nicht-entartete Austrittslinie) und je
    // u16-Offset im 24-B-Record prüfen, ob der Wert ein Field-Index sein kann.
    const TRG_HEADER = 36; // TRG_HEADER_LEN aus sections/triggers.ts
    const GW_LEN = 24;
    const offsetStats: { off: number; inRange: number; distinct: number; min: number; max: number }[] = [];
    for (let off = 0; off + 2 <= GW_LEN; off++) {
      offsetStats.push({ off, inRange: 0, distinct: 0, min: 0xffff, max: 0 });
    }
    const distinctSets = offsetStats.map(() => new Set<number>());
    let usedSlots = 0;

    for (const bundle of bundles) {
      const raw = bundle.rawSections[8];
      const triggers = bundle.triggers;
      if (!raw || !triggers) continue;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      triggers.gateways.forEach((g, i) => {
        const [a, b] = g.exitLine;
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return; // ungenutzt
        usedSlots++;
        const base = TRG_HEADER + i * GW_LEN;
        for (let off = 0; off + 2 <= GW_LEN; off++) {
          if (base + off + 2 > raw.length) continue;
          const v = view.getUint16(base + off, true);
          const s = offsetStats[off]!;
          if (v < fieldCount) s.inRange++;
          if (v < s.min) s.min = v;
          if (v > s.max) s.max = v;
          const set = distinctSets[off]!;
          if (set.size < 800) set.add(v);
        }
      });
    }
    offsetStats.forEach((s, i) => {
      s.distinct = distinctSets[i]!.size;
    });

    console.log(
      'Zielfield-Kandidaten (nur belegte Slots, n=' + usedSlots + '):',
      JSON.stringify(
        offsetStats
          .map((s) => ({ ...s, quote: `${((s.inRange / Math.max(1, usedSlots)) * 100).toFixed(1)}%` }))
          .filter((s) => s.inRange > 0)
          .sort((a, b) => b.inRange - a.inRange)
          .slice(0, 10),
      ),
    );

    console.log(
      'Gateway-Belegung:',
      JSON.stringify(
        {
          fields: fieldCount,
          gateways: total,
          zielImBestand: `${inRange}/${total}`,
          destTop: Array.from(destHist).sort((a, b) => b[1] - a[1]).slice(0, 12),
          // yesOut = Merkmal trifft zu UND Ziel ungültig  → erwünscht
          // yesIn  = Merkmal trifft zu, Ziel aber gültig  → Fehlalarm
          merkmale: marks,
        },
        null,
        1,
      ),
    );

    expect(fieldCount).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
