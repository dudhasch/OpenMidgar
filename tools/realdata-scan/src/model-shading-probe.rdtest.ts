import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { hasPSignature, isFlatShaded, parseP } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * Gegenprobe zum Farbpfad der Feldmodelle (docs/FARBPFAD-FELDMODELLE.md).
 *
 * Der Parser liest seit dieser Runde die Renderstate-Blöcke („hundreds") mit
 * und entnimmt ihnen den Schattierungsmodus. Diese Probe misst am echten
 * `char.lgp`, was dabei herauskommt:
 *
 *  S1  Parsen alle `.p`-Einträge weiter? (Regression zur Blockeinführung)
 *  S2  Trägt jede Datei genau einen Block je Gruppe?
 *  S3  Ist `p_hundred+0x24` immer 1 oder 2 — also ein echter Schattierungsmodus?
 *  S4  Stimmt er mit der Materialklasse `p_group+0x00` überein? Das Dekompilat
 *      sagt „bauartbedingt ja"; erst diese Messung macht daraus einen Beleg.
 *  S5  Wie groß ist die Änderung überhaupt — wie viele Gruppen sind flach?
 *  S6  Blendmodus-Verteilung (erwartet: fast alles 4 = deckend).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Schattierung der Feldmodelle', () => {
  it('S1–S6: Renderstate-Blöcke über den gesamten char.lgp-Bestand', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const HUNDRED_LEN = 100;
    const stat = {
      dateien: 0,
      geparst: 0,
      fehlgeschlagen: 0,
      diagnosen: {} as Record<string, number>,
      blockZahlGleichGruppenZahl: 0,
      blockZahlAbweichend: 0,
      shadeModeHistogramm: {} as Record<number, number>,
      materialKlasseHistogramm: {} as Record<number, number>,
      klasseUndBlockEinig: 0,
      klasseUndBlockUneinig: 0,
      submeshes: 0,
      submeshesFlach: 0,
      submeshesFlachTexturiert: 0,
      submeshesGouraudTexturiert: 0,
      blendModeHistogramm: {} as Record<number, number>,
    };
    const zaehle = (h: Record<number, number>, k: number): void => {
      h[k] = (h[k] ?? 0) + 1;
    };

    for (const eintrag of index.listEntries('char')) {
      const bytes = await index.readEntry(eintrag.canonicalId).catch(() => null);
      if (!bytes || !hasPSignature(bytes)) continue;
      stat.dateien++;

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const nVertices = view.getUint32(0x0c, true);
      const nNormals = view.getUint32(0x10, true);
      const nUnknown1 = view.getUint32(0x14, true);
      const nTexCs = view.getUint32(0x18, true);
      const nVertexColors = view.getUint32(0x1c, true);
      const nEdges = view.getUint32(0x20, true);
      const nPolys = view.getUint32(0x24, true);
      const nHundreds = view.getUint32(0x30, true);
      const nGroups = view.getUint32(0x34, true);

      if (nHundreds === nGroups) stat.blockZahlGleichGruppenZahl++;
      else stat.blockZahlAbweichend++;

      // Blockanfang unabhängig vom Parser nachrechnen (zweite Implementierung).
      const offHundreds =
        128 +
        nVertices * 12 +
        nNormals * 12 +
        nUnknown1 * 12 +
        nTexCs * 8 +
        nVertexColors * 4 +
        nPolys * 4 +
        nEdges * 4 +
        nPolys * 24;
      const offGroups = offHundreds + nHundreds * HUNDRED_LEN;

      for (let g = 0; g < Math.min(nGroups, nHundreds); g++) {
        const shade = view.getUint32(offHundreds + g * HUNDRED_LEN + 0x24, true);
        const blend = view.getInt32(offHundreds + g * HUNDRED_LEN + 0x44, true);
        const klasse = view.getInt32(offGroups + g * 56, true);
        zaehle(stat.shadeModeHistogramm, shade);
        zaehle(stat.materialKlasseHistogramm, klasse);
        zaehle(stat.blendModeHistogramm, blend);
        if (klasse >= 0 && klasse <= 4) {
          if (isFlatShaded(klasse) === (shade === 1)) stat.klasseUndBlockEinig++;
          else stat.klasseUndBlockUneinig++;
        }
      }

      const { value, diagnostics } = parseP(bytes, eintrag.name);
      for (const d of diagnostics) stat.diagnosen[d.code] = (stat.diagnosen[d.code] ?? 0) + 1;
      if (!value) {
        stat.fehlgeschlagen++;
        continue;
      }
      stat.geparst++;
      for (const s of value.submeshes) {
        stat.submeshes++;
        if (s.flatShaded) {
          stat.submeshesFlach++;
          if (s.textured) stat.submeshesFlachTexturiert++;
        } else if (s.textured) {
          stat.submeshesGouraudTexturiert++;
        }
      }
    }

    await dir.closeAll();

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(stat, null, 1));

    // S1: keine Regression — jede erkannte `.p` parst.
    expect(stat.dateien).toBeGreaterThan(1000);
    expect(stat.fehlgeschlagen).toBe(0);

    // S2: ein Block je Gruppe, ausnahmslos.
    expect(stat.blockZahlAbweichend).toBe(0);

    // S3: der Schattierungsmodus ist tatsächlich nur 1 oder 2.
    expect(Object.keys(stat.shadeModeHistogramm).sort()).toEqual(['1', '2']);

    // S4: Block und Materialklasse sagen dasselbe — die Behauptung des
    // Dekompilats, an unseren Daten geprüft.
    expect(stat.klasseUndBlockUneinig).toBe(0);

    // S5: Die Änderung ist nicht folgenlos — es gibt flache Gruppen.
    expect(stat.submeshesFlach).toBeGreaterThan(0);
  });
});
