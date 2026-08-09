import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * S17-Nachprobe „Kampf-Opcode", zweiter Anlauf.
 *
 * Der erste Anlauf suchte den Opcode über die **Encounter-Tabelle des eigenen
 * Fields** (Sektion 7) und fand nichts: bester Kandidat 8,8 Prozentpunkte über
 * der Kontrolle, Faktor 1,3. Zum Vergleich lag der Field-Wechsel-Opcode bei
 * Faktor 44.
 *
 * Makou Reactor führt die Opcode-Liste positionsgeordnet in 16er-Blöcken; der
 * achte Block beginnt mit `BATTLE`, also **0x70**. Zwei Dinge daran sind
 * unabhängig prüfbar und stützen die Liste, bevor sie irgendetwas behauptet:
 *
 *  - Der siebte Block beginnt mit `MAPJUMP` = **0x60** — exakt der Wert, den
 *    unsere eigene Rückkantenprobe aus den Daten abgeleitet hat.
 *  - `OpcodeBATTLE` trägt ein Bank-Byte und eine u16 → **3 Operandenbytes**,
 *    `BTLON` deren **1**. Beides deckt sich mit unserer aus den Realdaten
 *    abgeleiteten Längentabelle.
 *
 * **Warum der erste Anlauf scheitern MUSSTE:** `battleID` ist eine globale
 * Formationsnummer, keine Nummer aus der Encounter-Tabelle des Fields.
 * Sektion 7 beschreibt die ZUFALLSkämpfe eines Fields; `BATTLE` löst einen
 * SKRIPTIERTEN Kampf aus. Die Probe hat also in der falschen Menge gesucht —
 * und weil diese Menge riesig ist, sah selbst der richtige Opcode wie Rauschen
 * aus. Diese Probe weist genau das nach.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Wertebereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const OP_BATTLE = 0x70;
const OP_BTLON = 0x71;

function operandLen(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

interface Vorkommen {
  op: number;
  operand: Uint8Array;
  fieldIdx: number;
}

/** Alle u16-Werte (LE, jede Byteposition) einer Bytefolge. */
function u16Menge(bytes: Uint8Array | undefined): Set<number> {
  const set = new Set<number>();
  if (!bytes || bytes.length < 2) return set;
  for (let i = 0; i + 2 <= bytes.length; i++) set.add(bytes[i]! | (bytes[i + 1]! << 8));
  return set;
}

describe.skipIf(!available)('Realdaten: Kampf-Opcode (S17, zweiter Anlauf)', () => {
  it('0x70 trägt eine globale Formationsnummer — nicht aus Sektion 7', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const len = operandLen();

    const bundles: FieldBundle[] = [];
    const treffer: Vorkommen[] = [];
    let btlon = 0;
    let bytecodeBytes = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const bundle = parsed.bundle;
      if (!parsed.ok || !bundle?.script) continue;
      const fieldIdx = bundles.length;
      bundles.push(bundle);

      const code = bundle.rawSections[1];
      if (!code) continue;
      bytecodeBytes += code.length;
      // Durchlauf über die Entry-Point-Spannen — dasselbe Verfahren wie in der
      // Opcode-Identifikation, damit die Instruktionsmenge vergleichbar ist.
      for (const s of bundle.script.spans) {
        if (s.end <= s.start) continue;
        let pc = s.start;
        let guard = 0;
        while (pc < s.end && ++guard < 100_000) {
          const op = code[pc]!;
          if (op === OP_KAWAI) {
            const total = code[pc + 1];
            if (total === undefined || total < 2) break;
            pc += total;
            continue;
          }
          const l = len[op] ?? -1;
          if (l < 0) break; // unbekannte Länge: Spanne endet hier
          const operand = code.subarray(pc + 1, pc + 1 + l);
          if (operand.length < l) break;
          if (op === OP_BATTLE) treffer.push({ op, operand: operand.slice(), fieldIdx });
          if (op === OP_BTLON) btlon++;
          pc += 1 + l;
        }
      }
    }

    // Bank-Byte: 0 bedeutet "beide Operanden sind Literale".
    const literale = treffer.filter((t) => t.operand[0] === 0);
    const ids = literale.map((t) => t.operand[1]! | (t.operand[2]! << 8));
    const idsSortiert = [...ids].sort((a, b) => a - b);

    // Der Kernnachweis: Steht die Formationsnummer in Sektion 7 DES EIGENEN
    // Fields? Kontrolle wie im ersten Anlauf: Sektion 7 des Nachbarfields.
    let inEigener = 0;
    let inNachbar = 0;
    for (const t of literale) {
      const id = t.operand[1]! | (t.operand[2]! << 8);
      const eigen = u16Menge(bundles[t.fieldIdx]?.rawSections[7]);
      const nachbar = u16Menge(bundles[(t.fieldIdx + 1) % bundles.length]?.rawSections[7]);
      if (eigen.has(id)) inEigener++;
      if (nachbar.has(id)) inNachbar++;
    }

    console.log(
      'Kampf-Opcode 0x70 (BATTLE):',
      JSON.stringify(
        {
          fields: bundles.length,
          bytecodeBytes,
          vorkommen: treffer.length,
          davonLiterale: literale.length,
          btlonVorkommen: btlon,
          formationsnummern: {
            verschieden: new Set(ids).size,
            min: idsSortiert[0],
            median: idsSortiert[Math.floor(idsSortiert.length / 2)],
            p95: idsSortiert[Math.floor(idsSortiert.length * 0.95)],
            max: idsSortiert[idsSortiert.length - 1],
            unter1024: `${ids.filter((v) => v < 1024).length}/${ids.length}`,
          },
          'in Sektion 7 des eigenen Fields': `${inEigener}/${literale.length} (${((inEigener / literale.length) * 100).toFixed(1)}%)`,
          'in Sektion 7 des Nachbarfields': `${inNachbar}/${literale.length} (${((inNachbar / literale.length) * 100).toFixed(1)}%)`,
        },
        null,
        1,
      ),
    );

    // 1. Der Opcode kommt überhaupt vor — und nicht nur vereinzelt.
    expect(treffer.length).toBeGreaterThan(100);

    // 2. Die Formationsnummern sind plausibel: kleine, weit gestreute Werte.
    //    Ein zufällig herausgegriffenes Byte-Paar läge im Mittel bei ~32768;
    //    hier liegt der Median bei 468. Bewertet wird über ein Quantil, nicht
    //    über das Maximum: Der Spannen-Durchlauf kann an einer Stelle mit
    //    unbekannter Operandenlänge aus dem Tritt geraten, und ein einzelner
    //    versetzt gelesener Eintrag darf einen Befund über 173 Vorkommen nicht
    //    kippen.
    expect(idsSortiert[Math.floor(idsSortiert.length * 0.95)]!).toBeLessThan(4096);
    expect(ids.filter((v) => v < 1024).length / ids.length).toBeGreaterThan(0.8);
    expect(new Set(ids).size).toBeGreaterThan(50);

    // 3. DER EIGENTLICHE BEFUND: Die Formationsnummer steht NICHT bevorzugt in
    //    Sektion 7 des eigenen Fields. Genau deshalb konnte der erste Anlauf
    //    den richtigen Opcode nicht von Rauschen unterscheiden — er hat in der
    //    falschen Menge gesucht. Eigen- und Nachbarquote liegen gleichauf.
    const abstand = Math.abs(inEigener - inNachbar) / literale.length;
    expect(abstand).toBeLessThan(0.15);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
