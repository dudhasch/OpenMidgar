import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Strukturprobe, 5. Iteration — maskierter Bytestrom-Dump.
 * Dieselbe Methode, die in S8 die Layer-Separatoren entschieden hat: nicht
 * weiter raten, sondern den Anfang der Sektion direkt lesen.
 *
 * Buchstaben werden als `L`, Ziffern als `D` ausgegeben — die Struktur
 * (Trenner, Punkte, Unterstriche, Nullbytes, Zahlenwerte) bleibt sichtbar,
 * Originalnamen erscheinen NICHT.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

function maskedDump(data: Uint8Array, from: number, to: number): string {
  const parts: string[] = [];
  for (let i = from; i < Math.min(to, data.length); i++) {
    const b = data[i]!;
    const ch = String.fromCharCode(b);
    if (/[A-Za-z]/.test(ch)) parts.push('L');
    else if (/[0-9]/.test(ch)) parts.push('D');
    else if (b >= 0x21 && b <= 0x7e) parts.push(ch);
    else if (b === 0x20) parts.push('_');
    else parts.push(`<${b}>`);
  }
  return parts.join('');
}

describe.skipIf(!available)('Realdaten: Sektion 3 Bytestrom (S10-Probe 5)', () => {
  it('Maskierter Dump der ersten Records', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let shown = 0;
    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const data = parsed.bundle?.rawSections[SECTION_MODEL_LOADER];
      if (!parsed.ok || !data || data.length < 200) continue;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      console.log(
        `--- Sektion 3, Länge ${data.length} B, Kopf u16: ` +
          `[${view.getUint16(0, true)}, ${view.getUint16(2, true)}, ${view.getUint16(4, true)}] ---`,
      );
      for (let o = 6; o < Math.min(6 + 320, data.length); o += 40) {
        console.log(`@${String(o).padStart(4)} ${maskedDump(data, o, o + 40)}`);
      }
      if (++shown >= 4) break;
    }

    expect(shown).toBeGreaterThan(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
