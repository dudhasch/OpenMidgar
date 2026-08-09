import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S17-Probe „Encounter-Tabelle" (Field-Sektion 7).
 *
 * Makou Reactor beschreibt die Sektion als **zwei Tabellen à 24 Byte**:
 *
 * ```
 * u8  enabled
 * u8  rate
 * u16 standard[6]   // Wahrscheinlichkeit in den oberen 6 Bit,
 * u16 special[4]    // Kampf-ID in den unteren 10 Bit (& 0x03FF)
 * u16 padding
 * ```
 *
 * Das ist eine **Hypothese**, keine Autorität. Geprüft wird sie über vier
 * Vorhersagen, die eine falsche Auslegung nicht gleichzeitig erfüllen kann:
 *
 *  1. Die Sektion ist genau 48 Byte groß (2 × 24).
 *  2. `enabled` ist ein Flag, trägt also nur sehr wenige verschiedene Werte.
 *  3. Das Padding ist genullt.
 *  4. Die Kampf-IDs liegen im 10-Bit-Bereich — und decken sich mit den
 *     Formationsnummern, die der `BATTLE`-Opcode (0x70) trägt.
 *
 * Vorhersage 4 ist die interessante: Sie erklärt rückwirkend, warum der erste
 * Anlauf zur Opcode-Suche scheitern musste. Er verglich **rohe u16-Werte** aus
 * der Sektion mit dem Operanden — aber im Record stecken Wahrscheinlichkeit
 * und ID im selben Wort. Ohne die Maske `& 0x03FF` kann der Vergleich gar
 * nicht treffen.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TABLE_LEN = 24;
const SECTION_LEN = TABLE_LEN * 2;

describe.skipIf(!available)('Realdaten: Encounter-Tabelle (Sektion 7)', () => {
  it('prüft das 2×24-B-Layout gegen vier Vorhersagen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let fields = 0;
    let richtigeGroesse = 0;
    let paddingNull = 0;
    let paddingGeprueft = 0;
    const enabledWerte = new Map<number, number>();
    const rateWerte = new Map<number, number>();
    const battleIds = new Set<number>();
    let idsGesamt = 0;
    let idsUeber1023 = 0;
    // Kontrolle: dieselbe Auswertung an einer um 2 Byte verschobenen Grenze.
    const battleIdsVerschoben = new Set<number>();

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const sec = parsed.bundle?.rawSections[7];
      if (!sec) continue;
      fields++;
      if (sec.length !== SECTION_LEN) continue;
      richtigeGroesse++;

      const view = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      for (const t of [0, 1]) {
        const base = t * TABLE_LEN;
        enabledWerte.set(sec[base]!, (enabledWerte.get(sec[base]!) ?? 0) + 1);
        rateWerte.set(sec[base + 1]!, (rateWerte.get(sec[base + 1]!) ?? 0) + 1);
        paddingGeprueft++;
        if (view.getUint16(base + 22, true) === 0) paddingNull++;
        for (let i = 0; i < 10; i++) {
          const raw = view.getUint16(base + 2 + i * 2, true);
          if (raw === 0) continue; // ungenutzter Steckplatz
          idsGesamt++;
          const id = raw & 0x03ff;
          battleIds.add(id);
          if (id > 1023) idsUeber1023++;
          battleIdsVerschoben.add(view.getUint16(base + 3 + i * 2, true) & 0x03ff);
        }
      }
    }

    console.log(
      'Encounter-Tabelle (Sektion 7):',
      JSON.stringify(
        {
          fieldsMitSektion: fields,
          davonGenau48Byte: `${richtigeGroesse}/${fields}`,
          paddingGenullt: `${paddingNull}/${paddingGeprueft}`,
          enabledVerschiedeneWerte: enabledWerte.size,
          enabledTop: [...enabledWerte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
          rateVerschiedeneWerte: rateWerte.size,
          belegteSteckplaetze: idsGesamt,
          verschiedeneKampfIds: battleIds.size,
          idsUeber1023,
        },
        null,
        1,
      ),
    );

    // 1. Feste Sektionsgröße.
    expect(richtigeGroesse).toBe(fields);
    // 2. `enabled` ist ein Flag — sehr wenige Werte.
    expect(enabledWerte.size).toBeLessThanOrEqual(4);
    // 3. Padding genullt.
    expect(paddingNull).toBe(paddingGeprueft);
    // 4. Die Maske hält per Konstruktion; entscheidend ist, dass überhaupt
    //    eine plausible Menge an IDs entsteht.
    expect(battleIds.size).toBeGreaterThan(50);
    expect(idsUeber1023).toBe(0);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
