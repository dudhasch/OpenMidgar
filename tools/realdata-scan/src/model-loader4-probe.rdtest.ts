import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Strukturprobe, 4. Iteration. Das Grammatikraster aus Iteration 3 fand
 * KEINE passende Auslegung — also wird nicht weiter geraten, sondern der
 * Bytestrom direkt vermessen:
 *
 * Ein „Stringfeld" ist ein ASCII-Lauf, dessen Länge exakt im u16 unmittelbar
 * davor steht (in 702/702 Fields für das erste Feld belegt). Gemessen wird,
 * was ZWISCHEN dem Ende eines Stringfelds und dem Längenpräfix des nächsten
 * steht — als Folge von u16-Werten. Häufige Folgen sind die Festteile des
 * Records; ihre Länge ist die gesuchte Recordstruktur.
 *
 * Ausgabe bleibt inhaltsfrei: nur Längen, Zahlenwerte und Zeichenklassen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

const bump = (m: Map<string, number>, k: string, cap = 80): void => {
  if (m.size < cap || m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
};
const top = (m: Map<string, number>, n = 16): unknown =>
  Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n);

describe.skipIf(!available)('Realdaten: Sektion 3 Zwischenräume (S10-Probe 4)', () => {
  it('Festteile zwischen den Stringfeldern', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const gapBytes = new Map<string, number>();
    const gapWords = new Map<string, number>();
    const stringLenSeq = new Map<string, number>();
    const firstGap = new Map<string, number>();
    const tailBytes = new Map<string, number>();
    const stringsPerField = new Map<string, number>();
    const stringsVsModels = new Map<string, number>();
    let fields = 0;
    let prefixedStrings = 0;
    let unprefixedRuns = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const data = parsed.bundle?.rawSections[SECTION_MODEL_LOADER];
      if (!parsed.ok || !data || data.length < 12) continue;
      fields++;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const models = view.getUint16(2, true);

      // Alle Stringfelder mit gültigem Längenpräfix einsammeln.
      const fieldsFound: { start: number; len: number }[] = [];
      let o = 6;
      while (o + 2 <= data.length) {
        const len = view.getUint16(o, true);
        if (len >= 2 && len <= 64 && o + 2 + len <= data.length) {
          let printable = true;
          for (let i = o + 2; i < o + 2 + len; i++) {
            const b = data[i]!;
            if (b < 0x20 || b > 0x7e) {
              printable = false;
              break;
            }
          }
          if (printable) {
            fieldsFound.push({ start: o + 2, len });
            prefixedStrings++;
            o = o + 2 + len;
            continue;
          }
        }
        o += 1;
      }

      bump(stringsPerField, `${fieldsFound.length}`, 60);
      bump(stringsVsModels, `${models}→${fieldsFound.length}`, 80);

      for (const [i, f] of fieldsFound.entries()) {
        const end = f.start + f.len;
        const next = fieldsFound[i + 1];
        const gapEnd = next ? next.start - 2 : data.length;
        const n = gapEnd - end;
        if (n < 0 || n > 40) continue;
        bump(gapBytes, `${n}`, 40);
        if (n % 2 === 0 && n <= 24) {
          const words: number[] = [];
          for (let w = 0; w < n / 2; w++) words.push(view.getUint16(end + w * 2, true));
          bump(gapWords, `n=${n}:[${words.join(',')}]`, 80);
        }
        if (i === 0) bump(firstGap, `${n}`, 30);
        if (!next) bump(tailBytes, `${n}`, 30);
      }

      bump(stringLenSeq, fieldsFound.slice(0, 6).map((f) => f.len).join(','), 60);

      // Nicht präfixierte ASCII-Läufe zählen (Gegenprobe zur Vollständigkeit).
      let run = 0;
      for (let i = 0; i < data.length; i++) {
        const b = data[i]!;
        if (b >= 0x21 && b <= 0x7e) run++;
        else {
          if (run >= 3 && !fieldsFound.some((f) => i - run >= f.start && i <= f.start + f.len)) unprefixedRuns++;
          run = 0;
        }
      }
    }

    console.log(`Fields=${fields}, Stringfelder gesamt=${prefixedStrings}, nicht erfasste Läufe=${unprefixedRuns}`);
    console.log('Anzahl Stringfelder je Field:', JSON.stringify(top(stringsPerField)));
    console.log('Modellzahl → Stringfelder:', JSON.stringify(top(stringsVsModels)));
    console.log('Erste 6 Stringlängen:', JSON.stringify(top(stringLenSeq)));
    console.log('Bytes zwischen zwei Stringfeldern:', JSON.stringify(top(gapBytes)));
    console.log('Zwischenraum als u16-Folge:', JSON.stringify(top(gapWords, 20)));
    console.log('Erster Zwischenraum:', JSON.stringify(top(firstGap)));
    console.log('Rest nach dem letzten Stringfeld:', JSON.stringify(top(tailBytes)));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
