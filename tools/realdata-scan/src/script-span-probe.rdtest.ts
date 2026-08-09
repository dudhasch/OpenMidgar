import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, SCR_HEADER_LEN, SCR_ENTITY_NAME_LEN, SCR_ENTRIES_PER_ENTITY } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * E-SCR-SPAN-Klärungsprobe (Vorarbeit S6): Welche Werte stehen in den
 * 29 als ungültig markierten Entry-Point-Slots echter Fields?
 * Hypothese: Sentinel-Semantik ungenutzter Slots. Ausgabe aggregiert.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: E-SCR-SPAN-Klassifikation', () => {
  it('klassifiziert alle Out-of-Range-Entry-Points', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const classes: Record<string, number> = {};
    const samples: string[] = [];
    let fieldsAffected = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.bundle?.script) continue;
      const raw = parsed.bundle.rawSections[1];
      if (!raw) continue;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const nEntities = view.getUint8(2);
      const stringTableOffset = view.getUint16(4, true);
      const nAkao = view.getUint16(6, true);
      const entryBase = SCR_HEADER_LEN + nEntities * SCR_ENTITY_NAME_LEN + nAkao * 4;
      const dataStart = entryBase + nEntities * SCR_ENTRIES_PER_ENTITY * 2;

      let affected = false;
      for (let e = 0; e < nEntities; e++) {
        for (let s = 0; s < SCR_ENTRIES_PER_ENTITY; s++) {
          const value = view.getUint16(entryBase + (e * SCR_ENTRIES_PER_ENTITY + s) * 2, true);
          if (value >= dataStart && value < stringTableOffset) continue;
          affected = true;
          let cls: string;
          if (value === 0) cls = 'value=0';
          else if (value === stringTableOffset) cls = 'value==stringTableOffset';
          else if (value > stringTableOffset && value < raw.byteLength) cls = 'in-stringtable';
          else if (value >= raw.byteLength) cls = 'beyond-section';
          else cls = 'before-dataStart';
          classes[cls] = (classes[cls] ?? 0) + 1;
          if (samples.length < 25) {
            samples.push(
              `${entry.name} e${e}s${s}: v=${value} dataStart=${dataStart} strTab=${stringTableOffset} len=${raw.byteLength} prevSlot=${s > 0 ? view.getUint16(entryBase + (e * SCR_ENTRIES_PER_ENTITY + s - 1) * 2, true) : '-'}`,
            );
          }
        }
      }
      if (affected) fieldsAffected++;
    }

    console.log('Klassen:', JSON.stringify(classes, null, 2));
    console.log('Betroffene Fields:', fieldsAffected);
    console.log('Beispiele:\n' + samples.join('\n'));
    expect(Object.keys(classes).length).toBeGreaterThan(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
