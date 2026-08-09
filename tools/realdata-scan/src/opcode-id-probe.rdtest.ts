import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, parseMaplist, type FieldBundle, type FieldDiagnostic } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * Opcode-Identifikation: Welcher Opcode löst einen Field-Wechsel aus, welcher
 * einen Kampf?
 *
 * Beide Suchen laufen über dieselbe, EINMAL eingesammelte Instruktionsmenge
 * (Opcode, Operandenbytes, Fieldindex) — der Bytecode wird nur ein einziges
 * Mal linear durchlaufen (Operandenlängen aus `IMPL_OPERAND_LEN` +
 * `SKIP_OPERAND_LEN`, 0x28/KAWAI variabel über sein erstes Operandenbyte).
 * Jede Hypothese (Opcode, u16-Position) wertet danach nur noch über dieser
 * Liste aus, statt den Bytecode erneut zu durchlaufen.
 *
 * **Suche A — Field-Wechsel:** Ein u16-Operandenwert wird als 0-basierter
 * `maplist`-Index gedeutet und gegen die echten Fieldnamen aufgelöst
 * (Treffer) sowie gegen eine um 400 verschobene `maplist` (Kontrolle,
 * Grundrauschen). Zusätzlich — und das ist die aussagekräftigste Metrik —
 * wird aus den aufgelösten Kanten (Field → Zielfield) ein gerichteter Graph
 * gebaut und die Rückkantenquote gemessen: Ein echter Field-Wechsel-Opcode
 * sollte überwiegend Kanten erzeugen, die im Zielfield eine Gegenkante haben
 * (die Spielwelt ist begehbar), Rauschen praktisch nie.
 *
 * **Suche B — Kampfstart:** Ein u16-Operandenwert wird gegen die
 * Encounter-Kandidatenmenge des EIGENEN Fields geprüft (alle u16-Werte aus
 * Sektion 7, deren Aufbau nicht erschlossen ist — daher wird sie als reine
 * Bytefolge behandelt). Kontrolle ist dieselbe Prüfung gegen Sektion 7 des
 * NÄCHSTEN Fields (feste Verschiebung um 1 in Bundle-Reihenfolge).
 *
 * Ein Befund zählt nur bei großem Abstand zur Kontrolle UND mindestens 100
 * Vorkommen — beides wird in der Ausgabe mitgeliefert, die Bewertung erfolgt
 * im begleitenden Bericht, nicht in dieser Datei.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Feste Verschiebung des maplist-Index für das Kontrollniveau in Suche A. */
const MAPLIST_CONTROL_SHIFT = 400;
/** Mindestvorkommen, unterhalb derer eine Rückkantenquote nicht aussagekräftig ist. */
const MIN_A_COUNT = 20;
const TOP_N = 10;

interface LoadedField {
  idx: number;
  name: string;
  bundle: FieldBundle;
}

interface Instr {
  op: number;
  operand: Uint8Array;
  fieldIdx: number;
}

/** Kombinierte Operandenlängentabelle (0..255); -1 = nicht abgedeckt. */
function combinedOperandLenTable(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

/** Alle u16-Werte (little-endian, an JEDER Byteposition) einer Bytefolge. */
function collectU16Candidates(bytes: Uint8Array | undefined): Set<number> {
  const set = new Set<number>();
  if (!bytes || bytes.length < 2) return set;
  for (let i = 0; i + 1 < bytes.length; i++) {
    set.add(bytes[i]! | (bytes[i + 1]! << 8));
  }
  return set;
}

const pct = (n: number, d: number): string => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
const ratio = (n: number, d: number): number => (d > 0 ? n / d : -1);

describe.skipIf(!available)('Realdaten: Opcode-Identifikation (Field-Wechsel & Kampfstart)', () => {
  it(
    'Opcode-Identifikation: welcher Opcode wechselt das Field, welcher startet einen Kampf',
    { timeout: 1_800_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      // --- 1. Alle Fields + `maplist` laden. ---------------------------------
      const loaded: LoadedField[] = [];
      const nameToIdx = new Map<string, number>();
      const diagnostics: FieldDiagnostic[] = [];
      let maplistNames: string[] = [];
      let maplistFound = false;

      for (const entry of index.listEntries('flevel')) {
        const name = entry.name.toLowerCase();
        if (name === 'maplist') {
          const parsedMaplist = parseMaplist(await index.readEntry(entry.canonicalId), 'maplist', diagnostics);
          if (parsedMaplist) {
            maplistNames = parsedMaplist.names;
            maplistFound = true;
          }
          continue;
        }
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle) continue;
        const idx = loaded.length;
        loaded.push({ idx, name, bundle: parsed.bundle });
        nameToIdx.set(name, idx);
      }
      const fields = loaded.length;
      const fieldCount = Math.max(1, fields);
      const mapCount = Math.max(1, maplistNames.length);

      const resolveMapIdx = (raw: number): number | undefined => {
        const targetName = maplistNames[raw];
        if (!targetName) return undefined;
        return nameToIdx.get(targetName);
      };
      const resolveMapIdxControl = (raw: number): number | undefined => {
        const shifted = ((raw + MAPLIST_CONTROL_SHIFT) % mapCount + mapCount) % mapCount;
        const targetName = maplistNames[shifted];
        if (!targetName) return undefined;
        return nameToIdx.get(targetName);
      };

      // --- 2. Encounter-Kandidatenmengen (Sektion 7) je Field. ---------------
      const encounterCandidates: Set<number>[] = loaded.map((f) => collectU16Candidates(f.bundle.rawSections[7]));
      const fieldsWithEncounterData = encounterCandidates.filter((s) => s.size > 0).length;

      // --- 3. Bytecode EINMAL linear durchlaufen, Instruktionen einsammeln. --
      const table = combinedOperandLenTable();
      const instrByOp = new Map<number, Instr[]>();
      const pushInstr = (op: number, operand: Uint8Array, fieldIdx: number): void => {
        let arr = instrByOp.get(op);
        if (!arr) {
          arr = [];
          instrByOp.set(op, arr);
        }
        arr.push({ op, operand, fieldIdx });
      };

      let spansTotal = 0;
      let spansOk = 0;
      let instructionsTotal = 0;

      for (const f of loaded) {
        const script = f.bundle.script;
        const bytes = f.bundle.rawSections[1];
        if (!script || !bytes) continue;
        for (const s of script.spans) {
          if (s.end <= s.start) continue;
          spansTotal++;
          let ip = s.start;
          let guard = 0;
          let ok = true;
          while (ip < s.end) {
            if (++guard > 100_000) {
              ok = false;
              break;
            }
            const op = bytes[ip]!;
            if (op === OP_KAWAI) {
              // Variable Länge: erstes Operandenbyte trägt die Gesamtlänge
              // (inkl. Opcode + Längenbyte).
              const total = bytes[ip + 1];
              if (total === undefined || total < 2) {
                ok = false;
                break;
              }
              if (total > 2) {
                pushInstr(op, bytes.subarray(ip + 2, ip + total), f.idx);
                instructionsTotal++;
              }
              ip += total;
              continue;
            }
            const len = table[op]!;
            if (len < 0) {
              ok = false;
              break;
            }
            if (len > 0) {
              pushInstr(op, bytes.subarray(ip + 1, ip + 1 + len), f.idx);
              instructionsTotal++;
            }
            ip += 1 + len;
          }
          if (ok && ip === s.end) spansOk++;
        }
      }

      // --- 4. Suche A: Field-Wechsel über maplist-Index. ----------------------
      interface ComboA {
        op: number;
        pos: number;
        count: number;
        hits: number;
        controlHits: number;
        backCount: number;
        backChecked: number;
        backCountControl: number;
        backCheckedControl: number;
      }
      const combosA: ComboA[] = [];

      for (const [op, instances] of instrByOp) {
        let maxLen = 0;
        for (const it of instances) if (it.operand.length > maxLen) maxLen = it.operand.length;
        for (let pos = 0; pos <= maxLen - 2; pos++) {
          let count = 0;
          let hits = 0;
          let controlHits = 0;
          const pairs: { src: number; dst: number }[] = [];
          const pairsControl: { src: number; dst: number }[] = [];
          for (const it of instances) {
            if (it.operand.length < pos + 2) continue;
            count++;
            const raw = it.operand[pos]! | (it.operand[pos + 1]! << 8);
            const dst = resolveMapIdx(raw);
            if (dst !== undefined) {
              hits++;
              pairs.push({ src: it.fieldIdx, dst });
            }
            const dstControl = resolveMapIdxControl(raw);
            if (dstControl !== undefined) {
              controlHits++;
              pairsControl.push({ src: it.fieldIdx, dst: dstControl });
            }
          }

          const adjacency = new Set<string>();
          for (const p of pairs) adjacency.add(`${p.src}->${p.dst}`);
          let backCount = 0;
          let backChecked = 0;
          for (const p of pairs) {
            if (p.src === p.dst) continue;
            backChecked++;
            if (adjacency.has(`${p.dst}->${p.src}`)) backCount++;
          }

          const adjacencyControl = new Set<string>();
          for (const p of pairsControl) adjacencyControl.add(`${p.src}->${p.dst}`);
          let backCountControl = 0;
          let backCheckedControl = 0;
          for (const p of pairsControl) {
            if (p.src === p.dst) continue;
            backCheckedControl++;
            if (adjacencyControl.has(`${p.dst}->${p.src}`)) backCountControl++;
          }

          combosA.push({
            op,
            pos,
            count,
            hits,
            controlHits,
            backCount,
            backChecked,
            backCountControl,
            backCheckedControl,
          });
        }
      }

      const topA = combosA
        .filter((c) => c.count >= MIN_A_COUNT)
        .sort((a, b) => ratio(b.backCount, b.backChecked) - ratio(a.backCount, a.backChecked))
        .slice(0, TOP_N)
        .map((c) => ({
          opcode: `0x${c.op.toString(16).padStart(2, '0')}`,
          position: c.pos,
          anzahl: c.count,
          trefferquote: pct(c.hits, c.count),
          kontrollquote: pct(c.controlHits, c.count),
          abstandProzentpunkte: (((c.hits - c.controlHits) / c.count) * 100).toFixed(1),
          rueckkantenquote: pct(c.backCount, c.backChecked),
          rueckkantenquoteKontrolle: pct(c.backCountControl, c.backCheckedControl),
          geprueftKanten: c.backChecked,
        }));

      // --- 5. Suche B: Kampfstart über Encounter-ID (Sektion 7, eigenes Field). --
      interface ComboB {
        op: number;
        pos: number;
        count: number;
        hits: number;
        controlHits: number;
        abstand: number;
      }
      const combosB: ComboB[] = [];

      for (const [op, instances] of instrByOp) {
        let maxLen = 0;
        for (const it of instances) if (it.operand.length > maxLen) maxLen = it.operand.length;
        for (let pos = 0; pos <= maxLen - 2; pos++) {
          let count = 0;
          let hits = 0;
          let controlHits = 0;
          for (const it of instances) {
            if (it.operand.length < pos + 2) continue;
            count++;
            const raw = it.operand[pos]! | (it.operand[pos + 1]! << 8);
            const ownSet = encounterCandidates[it.fieldIdx];
            if (ownSet && ownSet.has(raw)) hits++;
            const nextIdx = (it.fieldIdx + 1) % fieldCount;
            const nextSet = encounterCandidates[nextIdx];
            if (nextSet && nextSet.has(raw)) controlHits++;
          }
          combosB.push({
            op,
            pos,
            count,
            hits,
            controlHits,
            abstand: count > 0 ? ((hits - controlHits) / count) * 100 : 0,
          });
        }
      }

      const topB = combosB
        .filter((c) => c.count > 0)
        .sort((a, b) => b.abstand - a.abstand)
        .slice(0, TOP_N)
        .map((c) => ({
          opcode: `0x${c.op.toString(16).padStart(2, '0')}`,
          position: c.pos,
          anzahl: c.count,
          trefferquote: pct(c.hits, c.count),
          kontrollquote: pct(c.controlHits, c.count),
          abstandProzentpunkte: c.abstand.toFixed(1),
        }));

      // --- 6. Ausgabe (aggregiert, keine Fieldnamen/Originaldaten). ----------
      console.log(
        'Opcode-Identifikation:',
        JSON.stringify(
          {
            fields,
            spans: { gesamt: spansTotal, abschlossen: spansOk, quote: pct(spansOk, spansTotal) },
            instruktionenGesamt: instructionsTotal,
            maplist: { gefunden: maplistFound, anzahlNamen: maplistNames.length },
            encounterSektion7: { felderMitDaten: fieldsWithEncounterData, von: fields },
            sucheA_Feldwechsel: topA,
            sucheB_Kampfstart: topB,
          },
          null,
          2,
        ),
      );

      expect(fields).toBeGreaterThan(700);
      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
