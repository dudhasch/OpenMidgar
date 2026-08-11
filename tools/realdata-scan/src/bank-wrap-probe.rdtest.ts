import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * **O7 — 16-Bit-Bankzugriff an Adresse 0xFF.** Dauerprobe.
 *
 * Die Frage: Ein Wortzugriff auf Bankadresse 0xFF braucht zwei Bytes, aber
 * hinter 0xFF ist die Bank zu Ende. `state.ts` (`readBank`/`writeBank`) wrappt
 * innerhalb der Bank — es liest `b[0xFF] | b[0x00] << 8`. Die Alternative wäre
 * ein Übergriff in die Folgeregion. Beide Auslegungen unterscheiden sich an
 * **genau einer** Adresse.
 *
 * **Diese Probe entscheidet die Frage nicht durch Wissen, sondern durch
 * Irrelevanz** — und das ist ein zulässiges Ergebnis, solange die Zahl
 * dahintersteht statt einer Annahme. Sie zählt über alle Fields, wie viele
 * Wortzugriffe auf Adresse 0xFF im Bytecode überhaupt vorkommen.
 *
 * Sie bleibt als **Dauerprobe** stehen, weil die Irrelevanz eine Eigenschaft
 * des Bestands ist, nicht der Engine: Ein Mod oder ein anderer Datenstand kann
 * sie jederzeit aufheben. Steigt die Fundstellenzahl über 5, schlägt die Probe
 * fehl und die Auslegung muss dann wirklich geklärt werden.
 *
 * **Kontrollzählung:** dieselbe Auswertung für Adresse 0xFE. Sie darf nicht
 * einfach 0 ergeben, ohne dass man es weiß — käme 0xFE hundertfach vor und
 * 0xFF nie, wäre die Seltenheit von 0xFF ein Befund; kämen beide nie vor, ist
 * es schlicht die Randlage hoher Adressen. Die Zahl wird deshalb mitberichtet.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Opcodes mit 16-Bit-Zugriff auf die Zielvariable (Bankpaar, Adresse, …). */
const WORT_VARIANTEN: readonly number[] = [
  OP.SETWORD, OP.PLUS2, OP.MINUS2, OP.MUL2, OP.DIV2, OP.MOD2,
  OP.AND2, OP.OR2, OP.XOR2, OP.INC2, OP.DEC2,
  OP.PLUS2_S, OP.MINUS2_S, OP.INC2_S, OP.DEC2_S,
];

/** IF-Wortvarianten: linke Adresse u16@1, rechte u16@3, Bankpaar @0. */
const IF_WORT: readonly number[] = [OP.IFSW, OP.IFSWL, OP.IFUW, OP.IFUWL];

function tabelle(): number[] {
  const t = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) t[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) t[Number(op)] = len;
  return t;
}

interface Zaehlung {
  wort: number;
  ifWort: number;
  fundstellen: string[];
}

describe.skipIf(!available)('Realdaten: O7 — Wortzugriff auf Bankadresse 0xFF', () => {
  it('zählt die Fundstellen über alle Fields (Dauerprobe)', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const len = tabelle();

    const zaehle = (adresse: number): Zaehlung => ({ wort: 0, ifWort: 0, fundstellen: [] });
    const ergebnis = new Map<number, Zaehlung>([
      [0xff, zaehle(0xff)],
      [0xfe, zaehle(0xfe)],
    ]);
    let fields = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const b = parsed.bundle;
      if (!parsed.ok || !b?.script || !b.rawSections[1]) continue;
      fields++;
      const code = b.rawSections[1]!;
      for (const s of b.script.spans) {
        if (s.end <= s.start) continue;
        let pc = s.start;
        let guard = 0;
        while (pc < s.end && ++guard < 100_000) {
          const op = code[pc]!;
          for (const [adresse, z] of ergebnis) {
            if (WORT_VARIANTEN.includes(op)) {
              // Zielvariable: Bankpaar @0 (hohes Nibble = Zielbank), Adresse @1.
              // Nur ein echter Bankzugriff kann überhaupt wrappen.
              const bankPaar = code[pc + 1]!;
              if (((bankPaar >> 4) & 0xf) !== 0 && code[pc + 2] === adresse) {
                z.wort++;
                if (z.fundstellen.length < 10) z.fundstellen.push(`${entry.name}@${pc} op=0x${op.toString(16)}`);
              }
              // Quelloperand: niedriges Nibble, Adresse als u16 @2 bzw. @3.
              if ((bankPaar & 0xf) !== 0 && code[pc + 3] === adresse && op === OP.SETWORD) {
                z.wort++;
                if (z.fundstellen.length < 10) z.fundstellen.push(`${entry.name}@${pc} Quelle op=0x${op.toString(16)}`);
              }
            }
            if (IF_WORT.includes(op)) {
              const bankPaar = code[pc + 1]!;
              if (((bankPaar >> 4) & 0xf) !== 0 && code[pc + 2] === adresse) z.ifWort++;
              if ((bankPaar & 0xf) !== 0 && code[pc + 4] === adresse) z.ifWort++;
            }
          }
          const l = op === OP_KAWAI ? (code[pc + 1] ?? 2) - 1 : len[op]!;
          if (l < 0) break;
          pc += 1 + l;
        }
      }
    }
    await dir.closeAll();

    const ff = ergebnis.get(0xff)!;
    const fe = ergebnis.get(0xfe)!;
    console.log(
      'O7 — Wortzugriffe an Bankgrenze:',
      JSON.stringify(
        {
          Fields: fields,
          'Adresse 0xFF — Wortvarianten': ff.wort,
          'Adresse 0xFF — IF-Wortvarianten': ff.ifWort,
          'Adresse 0xFF — Fundstellen': ff.fundstellen,
          'Kontrolle Adresse 0xFE — Wortvarianten': fe.wort,
          'Kontrolle Adresse 0xFE — IF-Wortvarianten': fe.ifWort,
          'Kontrolle Adresse 0xFE — Fundstellen': fe.fundstellen,
        },
        null,
        1,
      ),
    );

    expect(fields).toBeGreaterThan(500);
    // Die Schwelle ist der eigentliche Inhalt dieser Probe: Solange die
    // Fundstellen an einer Hand abzuzählen sind, ist die Wrap-Regel ein
    // Randfall ohne Wirkung auf den Bestand. Reißt die Schwelle, ist O7 wieder
    // offen und muss über einen Verhaltensvergleich entschieden werden.
    expect(ff.wort + ff.ifWort).toBeLessThanOrEqual(5);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
