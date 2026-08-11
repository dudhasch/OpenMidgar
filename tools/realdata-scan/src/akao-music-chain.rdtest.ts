import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseAkaoBlock, parseFieldEntry, resolveFieldMusic, type FieldDiagnostic } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * F09-B — die MUSIC-Kette, vollständig durchgemessen.
 *
 * **Die Behauptung.** Der Operand des `MUSIC`-Opcodes (0xF0) ist KEIN globaler
 * Titel, sondern ein **field-lokaler Index in die AKAO-Offsettabelle** der
 * eigenen Sektion 1. Kette:
 * `v → akaoOffsets[v] → AKAO-Kopf → u16@+4 = musicId → music.idx[musicId−1]`.
 *
 * **Die scharfen Vorhersagen und ihre Kontrollniveaus.** Eine Trefferquote
 * allein wäre wertlos — Bytecode ist voll kleiner Zahlen, und `nAkao` ist
 * meistens klein. Deshalb wird jede Vorhersage gegen zwei Verschiebungen
 * gestellt, die dieselbe Werteverteilung haben, aber keinen Grund, die Grenze
 * zu kennen:
 *   1. **Operand < nAkao des EIGENEN Fields.**
 *      Kontrolle A: derselbe Operand gegen `nAkao` des NACHBARFIELDS.
 *      Kontrolle B: das Byte VOR dem Opcode gegen das eigene `nAkao`.
 *   2. **An `akaoOffsets[v]` steht `AKAO`.**
 *      Kontrolle: dieselbe Prüfung an einer um vier Byte verschobenen Stelle
 *      und an einem zufällig gewählten Sektionsoffset.
 *   3. **`musicId` liegt im Band 1…`music.idx`-Zeilen.**
 *      Kontrolle: der u16 zwei Byte weiter (also `AKAO`-Länge statt ID).
 *
 * **Gegenhypothese, die durchfallen muss.** Die Kujata-Angabe „musicId = u8 bei
 * +50 im AKAO-Block". Sie wird mitgemessen; liegt sie unter den
 * Versatzkontrollen, ist sie widerlegt und nicht „schwächer belegt".
 *
 * **Die Ausreißer werden BENANNT.** Zählen genügt nicht: Jedes Field, dessen
 * MUSIC-Operand nicht auf ein `AKAO` zeigt, erscheint mit Namen, Operand,
 * Offset und den ersten Bytes des Blocks in der Ausgabe. Nur so ist prüfbar,
 * ob es sich um die belegten Defekte (abgeschnittenes Magic, Tutorial-Block)
 * handelt oder um ein Loch in der Deutung.
 *
 * Urheberrecht/Datenschutz: Ausgabe sind Zähler, Quoten, Fieldnamen (Bezeichner
 * des Formats) und Byteklassen — kein Werkinhalt.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const MUSIC_IDX = join(REAL_DIR, 'data', 'music', 'music.idx');
const available = existsSync(join(REAL_DIR, 'data', 'field'));

const OP_MUSIC = 0xf0;

function operandLen(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

const q = (n: number, d: number): string => `${n}/${d} (${((n / Math.max(1, d)) * 100).toFixed(2)}%)`;

/** Deterministischer Zufall — die Kontrolle muss reproduzierbar sein. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

interface FieldInfo {
  name: string;
  section1: Uint8Array;
  nAkao: number;
  akaoOffsets: number[];
  /** MUSIC-Operanden mit dem Byte davor (Kontrolle B). */
  musicOps: { operand: number; byteBefore: number }[];
}

describe.skipIf(!available)('Realdaten: MUSIC-Operand → AKAO-Block → musicId', () => {
  it(
    'belegt die Kette mit Kontrollniveau und benennt jeden Ausreißer',
    { timeout: 900_000 },
    async () => {
      // music.idx liefert die Obergrenze des gültigen Bandes.
      let musicLines = 0;
      if (existsSync(MUSIC_IDX)) {
        musicLines = new TextDecoder('latin1')
          .decode(await readFile(MUSIC_IDX))
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0).length;
      }

      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });
      const len = operandLen();

      const fields: FieldInfo[] = [];
      let fieldsGesamt = 0;
      let fieldsOhneScript = 0;

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        fieldsGesamt++;
        const bundle = parsed.bundle;
        const section1 = bundle?.rawSections[1];
        if (!parsed.ok || !bundle?.script || !section1) {
          fieldsOhneScript++;
          continue;
        }

        // MUSIC-Vorkommen aus dem Bytecode einsammeln (Spannenlauf wie in den
        // übrigen Opcode-Proben; KAWAI trägt seine Länge selbst).
        const musicOps: { operand: number; byteBefore: number }[] = [];
        for (const s of bundle.script.spans) {
          if (s.end <= s.start) continue;
          let pc = s.start;
          let guard = 0;
          while (pc < s.end && ++guard < 100_000) {
            const op = section1[pc]!;
            if (op === OP_KAWAI) {
              const total = section1[pc + 1];
              if (total === undefined || total < 2) break;
              pc += total;
              continue;
            }
            const l = len[op] ?? -1;
            if (l < 0) break;
            if (op === OP_MUSIC && pc + 1 < section1.length) {
              musicOps.push({
                operand: section1[pc + 1]!,
                byteBefore: pc > 0 ? section1[pc - 1]! : 0,
              });
            }
            pc += 1 + l;
          }
        }

        fields.push({
          name: entry.name,
          section1,
          nAkao: bundle.script.akaoOffsets.length,
          akaoOffsets: [...bundle.script.akaoOffsets],
          musicOps,
        });
      }

      expect(fields.length).toBeGreaterThan(0);

      // --- Vorhersage 1: Operand < nAkao des eigenen Fields -----------------
      let vorkommen = 0;
      let trefferEigen = 0;
      let trefferNachbar = 0;
      let trefferByteDavor = 0;
      const werteverteilung = new Map<number, number>();

      fields.forEach((f, i) => {
        const nachbar = fields[(i + 1) % fields.length]!;
        for (const m of f.musicOps) {
          vorkommen++;
          werteverteilung.set(m.operand, (werteverteilung.get(m.operand) ?? 0) + 1);
          if (m.operand < f.nAkao) trefferEigen++;
          if (m.operand < nachbar.nAkao) trefferNachbar++;
          if (m.byteBefore < f.nAkao) trefferByteDavor++;
        }
      });

      // --- Vorhersage 2 + 3: Magic und musicId ------------------------------
      let aufloesbar = 0;
      let magicVoll = 0;
      let magicAbgeschnitten = 0;
      let tutorial = 0;
      let unbekannt = 0;
      let ausserhalb = 0;
      let idImBand = 0;
      let kontrolleVersatz4 = 0;
      let kontrolleZufall = 0;
      let kontrolleLaengeImBand = 0;
      let kujataTreffer = 0; // u8 bei +50 im Band 1…musicLines
      const ausreisser: string[] = [];
      const idVerteilung = new Map<number, number>();
      const rnd = lcg(0x5eed_1234);

      for (const f of fields) {
        for (const m of f.musicOps) {
          if (m.operand >= f.nAkao) continue;
          aufloesbar++;
          const at = f.akaoOffsets[m.operand]!;
          const diagnostics: FieldDiagnostic[] = [];
          const res = resolveFieldMusic(f.akaoOffsets, f.section1, m.operand, f.name, diagnostics);
          const block = res.block!;

          switch (block.kind) {
            case 'akao':
              magicVoll++;
              break;
            case 'akao-truncated':
              magicAbgeschnitten++;
              break;
            case 'tutorial':
              tutorial++;
              break;
            case 'unknown':
              unbekannt++;
              break;
            default:
              ausserhalb++;
              break;
          }

          if (res.musicId !== null) {
            idVerteilung.set(res.musicId, (idVerteilung.get(res.musicId) ?? 0) + 1);
            if (musicLines > 0 && res.musicId >= 1 && res.musicId <= musicLines) idImBand++;
          } else {
            // Ausreißer BENENNEN, nicht nur zählen.
            const head = [...f.section1.subarray(at, Math.min(at + 8, f.section1.length))]
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(' ');
            ausreisser.push(
              `${f.name}: MUSIC ${m.operand}/${f.nAkao} → @${at} (${block.kind}) Bytes[${head}] Diagnose=${diagnostics.map((d) => d.code).join(',') || '—'}`,
            );
          }

          // Kontrolle zu Vorhersage 2: dieselbe Magic-Prüfung vier Byte daneben
          // und an einem zufälligen Sektionsoffset.
          if (parseAkaoBlock(f.section1, at + 4).kind === 'akao') kontrolleVersatz4++;
          const zufall = Math.floor(rnd() * Math.max(1, f.section1.length - 8));
          if (parseAkaoBlock(f.section1, zufall).kind === 'akao') kontrolleZufall++;

          // Kontrolle zu Vorhersage 3: der u16 ZWEI Byte weiter (die Länge).
          if (at + 8 <= f.section1.length && musicLines > 0) {
            const view = new DataView(f.section1.buffer, f.section1.byteOffset, f.section1.byteLength);
            const laenge = view.getUint16(at + 6 - block.missingMagicBytes, true);
            if (laenge >= 1 && laenge <= musicLines) kontrolleLaengeImBand++;
            // Gegenhypothese Kujata: u8 bei +50.
            if (at + 50 < f.section1.length) {
              const kujata = f.section1[at + 50]!;
              if (kujata >= 1 && kujata <= musicLines) kujataTreffer++;
            }
          }
        }
      }

      // --- Magic-Quote über ALLE AKAO-Offsets (nicht nur die benutzten) -----
      let blockGesamt = 0;
      const blockKlassen = new Map<string, number>();
      const blockAusreisser: string[] = [];
      for (const f of fields) {
        f.akaoOffsets.forEach((off, i) => {
          blockGesamt++;
          const b = parseAkaoBlock(f.section1, off);
          blockKlassen.set(b.kind, (blockKlassen.get(b.kind) ?? 0) + 1);
          if (b.kind === 'akao-truncated' || b.kind === 'unknown' || b.kind === 'out-of-range') {
            const head = [...f.section1.subarray(off, Math.min(off + 6, f.section1.length))]
              .map((x) => x.toString(16).padStart(2, '0'))
              .join(' ');
            blockAusreisser.push(`${f.name}[${i}] @${off} ${b.kind} Bytes[${head}]`);
          }
        });
      }

      const verteilung = [...werteverteilung.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v}:${n}`)
        .join(' ');

      console.log(
        'F09-B — MUSIC-Kette über alle Fields:',
        JSON.stringify(
          {
            Fields: fields.length,
            'Fields gesamt / ohne Script': `${fieldsGesamt} / ${fieldsOhneScript}`,
            'music.idx-Zeilen': musicLines,
            'MUSIC-Vorkommen': vorkommen,
            Werteverteilung: verteilung,
            'V1 Operand < nAkao (eigen)': q(trefferEigen, vorkommen),
            'V1 Kontrolle Nachbarfield': q(trefferNachbar, vorkommen),
            'V1 Kontrolle Byte-davor': q(trefferByteDavor, vorkommen),
            'Auflösbare Operanden': aufloesbar,
            'V2 Magic AKAO vollständig': q(magicVoll, aufloesbar),
            'V2 Magic abgeschnitten': magicAbgeschnitten,
            'V2 Tutorial-Block': tutorial,
            'V2 weder noch': unbekannt,
            'V2 Offset außerhalb': ausserhalb,
            'V2 Kontrolle Versatz +4': q(kontrolleVersatz4, aufloesbar),
            'V2 Kontrolle Zufallsoffset': q(kontrolleZufall, aufloesbar),
            'V3 musicId im Band 1…N': q(idImBand, aufloesbar),
            'V3 Kontrolle u16 zwei Byte weiter (Länge)': q(kontrolleLaengeImBand, aufloesbar),
            'Gegenhypothese Kujata (u8 @+50)': q(kujataTreffer, aufloesbar),
            'verschiedene musicId-Werte': idVerteilung.size,
            'musicId-Bereich':
              idVerteilung.size > 0
                ? `${Math.min(...idVerteilung.keys())}…${Math.max(...idVerteilung.keys())}`
                : '—',
          },
          null,
          2,
        ),
      );

      console.log(
        'Alle AKAO-Blöcke (auch die von keinem MUSIC benutzten):',
        JSON.stringify({ Blöcke: blockGesamt, Klassen: Object.fromEntries(blockKlassen) }, null, 2),
      );
      console.log(
        `Benannte Blockausreißer (${blockAusreisser.length}):\n` +
          (blockAusreisser.slice(0, 60).join('\n') || '— keine —'),
      );
      console.log(
        `Benannte MUSIC-Ausreißer (${ausreisser.length}):\n` +
          (ausreisser.slice(0, 60).join('\n') || '— keine —'),
      );

      // Die Probe ist eine Messung; sie darf nicht an einer Quote scheitern.
      // Geprüft wird nur, dass überhaupt gemessen wurde — und dass die
      // Vorhersage ihre Kontrollen schlägt (sonst ist die Deutung falsch).
      expect(vorkommen).toBeGreaterThan(0);
      expect(trefferEigen).toBeGreaterThan(trefferNachbar);
      expect(trefferEigen).toBeGreaterThan(trefferByteDavor);
      expect(magicVoll).toBeGreaterThan(kontrolleVersatz4);
      expect(magicVoll).toBeGreaterThan(kontrolleZufall);
      expect(idImBand).toBeGreaterThan(kujataTreffer);

      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
