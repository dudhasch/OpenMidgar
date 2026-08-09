import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4-B10 — Aufteilung der 30-B-Lichtblöcke im Field-Manifest (Sektion 3).
 *
 * Unsere bisherige Auslegung liest je Lichteinheit (9 B) **erst drei i16
 * Richtungen, dann drei Farbbytes**. Makou Reactor liest exakt umgekehrt:
 * **erst drei Farbbytes, dann drei i16 Richtungen**. Beide Auslegungen sind
 * gleich lang — die Bytefolge allein entscheidet nicht.
 *
 * Entscheiden lässt es sich über die **Beträge**: Richtungsvektoren einer
 * Beleuchtung sind normiert (im FF7-Bestand üblicherweise auf 4096) und haben
 * daher eine eng verteilte Länge. Drei Bytes, die man fälschlich als i16
 * liest, ergeben dagegen beliebige Werte ohne gemeinsame Länge.
 *
 * Gemessen wird also für beide Auslegungen die Streuung von |v|. Die richtige
 * Auslegung hat die deutlich engere Verteilung.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zahlen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

function streuung(werte: number[]): { median: number; iqr: number; anteilNahMedian: number } {
  if (werte.length === 0) return { median: 0, iqr: 0, anteilNahMedian: 0 };
  const s = [...werte].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  const median = q(0.5);
  const iqr = q(0.75) - q(0.25);
  const nah = werte.filter((v) => median > 0 && Math.abs(v - median) / median < 0.1).length;
  return { median, iqr, anteilNahMedian: nah / werte.length };
}

describe.skipIf(!available)('Realdaten: Lichtblock-Aufteilung (R4-B10)', () => {
  it('entscheidet Farbe-zuerst gegen Richtung-zuerst über die Vektorlänge', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const laengeFarbeZuerst: number[] = [];
    const laengeRichtungZuerst: number[] = [];
    let bloecke = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      for (const m of parsed.bundle?.models?.models ?? []) {
        const raw = m.blockRaw;
        if (!raw || raw.length < 30) continue;
        bloecke++;
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let j = 0; j < 3; j++) {
          const base = j * 9;
          // Auslegung A (Makou): Farbe bei +0..2, Richtung bei +3..8.
          const a = [view.getInt16(base + 3, true), view.getInt16(base + 5, true), view.getInt16(base + 7, true)];
          laengeFarbeZuerst.push(Math.hypot(a[0]!, a[1]!, a[2]!));
          // Auslegung B (unsere bisherige): Richtung bei +0..5, Farbe bei +6..8.
          const b = [view.getInt16(base, true), view.getInt16(base + 2, true), view.getInt16(base + 4, true)];
          laengeRichtungZuerst.push(Math.hypot(b[0]!, b[1]!, b[2]!));
        }
      }
    }

    const a = streuung(laengeFarbeZuerst);
    const b = streuung(laengeRichtungZuerst);
    console.log(
      'Lichtblock — Länge der Richtungsvektoren:',
      JSON.stringify(
        {
          bloecke,
          'A: Farbe zuerst (Makou)': {
            median: a.median.toFixed(1),
            iqr: a.iqr.toFixed(1),
            'Anteil ±10 % um den Median': `${(a.anteilNahMedian * 100).toFixed(1)}%`,
          },
          'B: Richtung zuerst (bisher)': {
            median: b.median.toFixed(1),
            iqr: b.iqr.toFixed(1),
            'Anteil ±10 % um den Median': `${(b.anteilNahMedian * 100).toFixed(1)}%`,
          },
        },
        null,
        1,
      ),
    );

    expect(bloecke).toBeGreaterThan(1000);
    // Die belegte Auslegung muss die Alternative deutlich schlagen — und die
    // Vektoren müssen wie normiert aussehen.
    expect(a.anteilNahMedian).toBeGreaterThan(0.9);
    expect(a.anteilNahMedian).toBeGreaterThan(b.anteilNahMedian * 2);
    expect(a.median).toBeGreaterThan(4000);
    expect(a.median).toBeLessThan(4200);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
