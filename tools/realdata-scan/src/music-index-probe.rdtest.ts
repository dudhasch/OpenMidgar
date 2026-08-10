import 'fake-indexeddb/auto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * O2 — Musikindex → Dateiname, zweiter Anlauf.
 *
 * **Stand vorher.** Es gibt keine Indexdatei; FFNx löst über eine Funktion in
 * der EXE auf (`common_externals.get_midi_name`) — dort ist nichts zu holen.
 * Die **Zielmenge** war aber geschlossen: `data/midi/midi.lgp` und
 * `data/music_ogg` decken sich zu 94/94. Gesucht war nur noch die Permutation.
 * Widerlegt war: Die TOC-Reihenfolge von `midi.lgp` ist es nicht (die
 * Schwesterarchive desselben Titelsatzes sind nur 40/94, 19/94 und 25/94
 * positionsgleich — wäre die Archivordnung kanonisch, müssten alle vier
 * übereinstimmen).
 *
 * **Was jetzt neu ist.** Kujata führt unter `metadata/music-list` eine
 * **indizierte** Liste mit 100 Einträgen (id 0..99). Alle 94 lokal
 * vorhandenen OGG-Namen kommen darin vor; sechs Einträge (id 0, 1, 16, 66, 89,
 * 98) haben lokal keine Datei, und ein Name ist doppelt vergeben.
 *
 * Das ist eine **Hypothese**, keine Autorität — eine fremde Liste ist genau
 * so lange wertlos, wie sie nichts vorhersagt. Also sagt sie hier etwas
 * vorher, das unabhängig durchfallen kann:
 *
 *   **Der `MUSIC`-Opcode (0xF0) trägt einen Index in genau diese Liste.
 *   Dann darf über alle 702 Fields kein einziger Operand ≥ 100 auftreten.**
 *
 * Das ist scharf, weil der Operand ein volles Byte ist: Wäre er etwas anderes
 * (eine feldlokale Nummer, ein Lautstärkewert, ein Kanal), gäbe es keinen
 * Grund, warum er ausgerechnet bei 100 abbricht. Zum Vergleich läuft die
 * gleiche Auswertung über eine **Kontrollmenge**: die Bytes unmittelbar VOR
 * jedem `MUSIC`-Opcode. Sie stammen aus demselben Bytecode, haben also
 * dieselbe Werteverteilung — aber keinen Grund, eine Obergrenze zu kennen.
 *
 * **Was diese Probe NICHT zeigt.** Sie belegt die Obergrenze, nicht die
 * Zuordnung. Ein Index, der in die richtige Liste zeigt, kann trotzdem
 * verschoben sein. Die Zuordnung bleibt deshalb 🟡 und wird — wie in der
 * Roadmap entschieden — als **austauschbare Tabelle** modelliert, nicht als
 * eingebaute Konstante.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten und Zahlenbereiche.
 * **Keine Titel, keine Dateinamen** im Ergebnis.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const OGG_DIR = join(REAL_DIR, 'data', 'music_ogg');
const available = existsSync(REAL_DIR) && existsSync(OGG_DIR);

const OP_MUSIC = 0xf0;
/** Länge der Kujata-Liste — die Obergrenze, die vorhergesagt wird. */
const LISTEN_LAENGE = 100;

function operandLen(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

describe.skipIf(!available)('Realdaten: Musikindex-Obergrenze (O2)', () => {
  it('sagt aus der Kujata-Liste eine Obergrenze vorher und prüft sie gegen eine Kontrollmenge', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const len = operandLen();

    const oggDateien = readdirSync(OGG_DIR).filter((f) => f.toLowerCase().endsWith('.ogg')).length;

    const operanden: number[] = [];
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
          if (op === OP_MUSIC && pc + 1 < code.length) {
            operanden.push(code[pc + 1]!);
            // Kontrolle: das Byte VOR dem Opcode — gleicher Bytecode,
            // gleiche Verteilung, aber keine Obergrenze zu erwarten.
            if (pc > 0) kontrolle.push(code[pc - 1]!);
          }
          pc += 1 + l;
        }
      }
    }

    const ueber = (werte: number[]): number => werte.filter((v) => v >= LISTEN_LAENGE).length;
    const max = (werte: number[]): number => werte.reduce((a, b) => Math.max(a, b), -1);
    const verschieden = new Set(operanden).size;

    console.log(
      'Musikindex-Obergrenze (O2):',
      JSON.stringify(
        {
          fields,
          'lokale OGG-Dateien': oggDateien,
          'Länge der Kujata-Liste': LISTEN_LAENGE,
          'MUSIC-Vorkommen': operanden.length,
          'verschiedene Indizes': verschieden,
          'größter Index': max(operanden),
          'Indizes >= 100': `${ueber(operanden)}/${operanden.length}`,
          'Ausreißer (Wert × Häufigkeit)': [
            ...operanden
              .filter((v) => v >= LISTEN_LAENGE)
              .reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>())
              .entries(),
          ].sort((a, b) => b[1] - a[1]),
          Kontrolle: {
            'Bytes vor dem Opcode': kontrolle.length,
            'größter Wert': max(kontrolle),
            'Werte >= 100': `${ueber(kontrolle)}/${kontrolle.length} (${((ueber(kontrolle) / Math.max(1, kontrolle.length)) * 100).toFixed(1)}%)`,
          },
        },
        null,
        1,
      ),
    );

    expect(fields).toBeGreaterThan(600);
    expect(operanden.length).toBeGreaterThan(100);

    // BEFUND: Die scharfe Vorhersage („kein Operand >= 100") fällt durch —
    // 36 von 935 verletzen sie. Sie wird hier bewusst NICHT abgeschwächt,
    // sondern als das dokumentiert, was sie ist: nicht erfüllt.
    //
    // Was stattdessen gilt, und warum es nicht reicht:
    //  * Der Kandidat ist mit rund 3,9 % Ausreißern etwa halb so schlecht wie
    //    die Kontrolle mit 8,4 % — ein Signal, aber kein Beleg.
    //  * Die Ausreißer haben **keine Struktur**: Sie verteilen sich über viele
    //    verschiedene Werte, statt sich auf einen Sentinel wie 0xFF zu
    //    konzentrieren. Genau so sieht ein Parse-Versatz aus, kein Sonderwert.
    //  * Ihr Anteil liegt in derselben Größenordnung wie die bekannte
    //    Fault-Rate des Spannen-Durchlaufs (rund 3 %, S12).
    //
    // Damit ist die Messung **nicht entscheidungsfähig**: Sie kann „die Liste
    // stimmt, der Durchlauf verrutscht gelegentlich" nicht von „die Liste
    // stimmt nicht" trennen. O2 bleibt 🟡. Erst ein sauberer Durchlauf (O9,
    // Operandenlängen) macht diese Probe aussagekräftig — deshalb wird hier
    // nur festgehalten, was ohne ihn belastbar ist.
    expect(ueber(operanden) / operanden.length).toBeLessThan(
      ueber(kontrolle) / Math.max(1, kontrolle.length),
    );
    // Die Kontrolle muss die Obergrenze überhaupt verletzen — sonst wäre der
    // Vergleich wertlos.
    expect(ueber(kontrolle)).toBeGreaterThan(0);
    // Feldmusik nutzt nur einen kleinen Teil des Titelbestands.
    expect(verschieden).toBeLessThan(oggDateien);

    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
