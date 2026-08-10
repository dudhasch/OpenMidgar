import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { parseAudioFmt } from '@webmidgar/audio';
import { NodeDirectorySource } from './node-source.js';

/**
 * Wie wird ein Klang aus `audio.dat` adressiert? — die Anschlussfrage zur
 * Bankstruktur (S38).
 *
 * **Was belegt ist.** `audio.fmt` beschreibt `audio.dat` vollständig: 724
 * Klangsätze in 26 Bänken, Accounting 100 %. Damit ist die Frage „was liegt in
 * den 48,5 MB" beantwortet. Offen ist die andere Hälfte: **womit greift das
 * Spiel auf einen Satz zu?**
 *
 * **Die scharfe Vorhersage.** Wenn der `SOUND`-Opcode (0xF1) einen **flachen
 * Index über alle Klangsätze** trägt — Abschlussmarken übersprungen —, dann
 * darf über alle Fields **kein einziger Operand ≥ 724** auftreten. Das ist
 * scharf, weil der Operand ein volles `uint16` ist: Ohne Obergrenze gäbe es
 * keinen Grund, warum er ausgerechnet bei der Satzzahl abbricht.
 *
 * **Die Kontrollmenge** ist das `uint16` unmittelbar VOR jedem `SOUND`-Opcode:
 * derselbe Bytecode, dieselbe Werteverteilung, aber kein Grund, eine
 * Obergrenze zu kennen. Ohne diese Kontrolle wäre „fast alle unter 724" wertlos
 * — Bytecode ist ohnehin voll kleiner Zahlen.
 *
 * **Zweite Kandidatenzahl.** Zählte das Spiel die Abschlussmarken als Plätze
 * mit, wären es 750 statt 724. Beide Grenzen werden getrennt gemessen; ein
 * Operand im Bereich 724..749 würde die zweite Auslegung stützen.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten und Zahlenbereiche.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const FMT = join(REAL_DIR, 'data', 'sound', 'audio.fmt');
const available = existsSync(REAL_DIR) && existsSync(FMT);

const OP_SOUND = 0xf1;

function operandLen(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

describe.skipIf(!available)('Realdaten: Klang-ID gegen die Satzzahl aus audio.fmt', () => {
  it('prüft die Obergrenze des SOUND-Operanden gegen eine Kontrollmenge', async () => {
    const table = parseAudioFmt(new Uint8Array(await readFile(FMT)));
    const saetze = table.entries.length;
    const plaetze = saetze + table.banks.length;

    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const len = operandLen();

    const ids: number[] = [];
    const kontrolle: number[] = [];
    let fields = 0;

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
      const code = bundle.rawSections[1];
      if (!code) continue;
      fields++;

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
          if (l < 0) break;
          if (op === OP_SOUND && pc + 4 < code.length) {
            // Operanden: u8 Bankpaar, u16 Klang-ID, u8 Panorama.
            // Nur Literale zählen: Das obere Nibble des Bankpaars muss 0 sein,
            // sonst steht dort eine Speicheradresse und keine ID.
            const bankPair = code[pc + 1]!;
            if (((bankPair >> 4) & 0xf) === 0) {
              ids.push(code[pc + 2]! | (code[pc + 3]! << 8));
              if (pc >= 2) kontrolle.push(code[pc - 2]! | (code[pc - 1]! << 8));
            }
          }
          pc += 1 + l;
        }
      }
    }

    const unter = (werte: number[], grenze: number): number => werte.filter((v) => v < grenze).length;
    const q = (n: number, d: number): string => `${n}/${d} (${((n / Math.max(1, d)) * 100).toFixed(2)}%)`;
    const max = ids.length ? Math.max(...ids) : -1;
    const zwischen = ids.filter((v) => v >= saetze && v < plaetze).length;

    console.log(
      'SOUND-Operand gegen die Satzzahl aus audio.fmt:',
      JSON.stringify(
        {
          Fields: fields,
          'Klangsätze in audio.fmt': saetze,
          'Plätze inkl. Abschlussmarken': plaetze,
          'SOUND-Literale gefunden': ids.length,
          'größter Operand': max,
          'verschiedene Operanden': new Set(ids).size,
          Vorhersage: {
            [`< ${saetze} (Klangsätze)`]: q(unter(ids, saetze), ids.length),
            [`< ${plaetze} (inkl. Abschlussmarken)`]: q(unter(ids, plaetze), ids.length),
            [`im Zwischenbereich ${saetze}..${plaetze - 1}`]: zwischen,
          },
          Kontrollmenge: {
            Umfang: kontrolle.length,
            [`< ${saetze}`]: q(unter(kontrolle, saetze), kontrolle.length),
            [`< ${plaetze}`]: q(unter(kontrolle, plaetze), kontrolle.length),
          },
        },
        null,
        1,
      ),
    );

    expect(saetze).toBe(724);
    expect(ids.length).toBeGreaterThan(100);

    // Die Vorhersage muss die Kontrollmenge deutlich schlagen — sonst misst
    // die Probe nur „Bytecode enthält kleine Zahlen".
    const trefferQuote = unter(ids, saetze) / ids.length;
    const kontrollQuote = unter(kontrolle, saetze) / Math.max(1, kontrolle.length);
    expect(trefferQuote).toBeGreaterThan(0.99);
    expect(kontrollQuote).toBeLessThan(0.8);
    expect(trefferQuote - kontrollQuote).toBeGreaterThan(0.25);

    // Trennt die beiden Auslegungen: Zählte das Spiel die Abschlussmarken als
    // Plätze mit, müssten Operanden im Band 724..749 vorkommen. Es gibt keine.
    expect(zwischen).toBe(0);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
