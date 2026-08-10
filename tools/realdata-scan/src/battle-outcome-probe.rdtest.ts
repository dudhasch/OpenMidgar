import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * S33-Probe: Die `outcome`-Zielvariable — mit AUSGESPROCHENER Annahme.
 *
 * Annahme: „Das Original spiegelt den Kampfausgang in eine Script-Variable,
 * und Skripte mit verzweigendem Kampfausgang LESEN sie kurz nach `BATTLE`."
 * Diese Annahme KANN falsch sein (eigener Opcode, Sonderadresse) — die
 * Messung darf sie widerlegen. Verfahren laut Roadmap: über alle Fields
 * zählen, welche Bankadresse innerhalb von n Instruktionen nach `BATTLE`
 * (0x70) von der IF-Familie gelesen wird; Kontrollen: dieselbe Statistik
 * nach `MAPJUMP` (0x60) und an einer um k Instruktionen verschobenen
 * Position. **Ein Faktor unter ~3 ist nach Projektmaßstab KEIN Befund** —
 * dann bleibt die Zielvariable 🔴 und der Interpreter schreibt weiterhin
 * nichts (die bewusste Haltung aus S17).
 *
 * Suchmengen-Einschränkung: Gezählt werden nur Vorkommen, auf die überhaupt
 * eine IF-Instruktion im Fenster folgt — Story-Kämpfe mit festem Ausgang
 * können die Antwort nicht enthalten und fallen so heraus; die Quote
 * `mitVerzweigung` wird mitberichtet.
 *
 * Zweitens: die vier O9-Kampf-Opcode-Längen (BTMD2/BTRLD/BTLTB/BTLMD).
 * Die O9-Runde hat sie systematisch NICHT übernommen; hier wird gezielt
 * nachgemessen, dass jede einzelne Makou-Länge den Spannen-Abschluss
 * verschlechtert oder nicht verbessert — damit ist der S33-Posten „O9
 * mitziehen" mit einem Messergebnis geschlossen statt mit einem Verweis.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(REAL_DIR);

const OP_BATTLE = 0x70;
const OP_MAPJUMP = 0x60;
const IF_OPS = new Set([0x14, 0x15, 0x16, 0x17, 0x18, 0x19]);

interface Span {
  bytes: Uint8Array;
  start: number;
  end: number;
}

function buildTable(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

/** Instruktionspositionen einer Spanne (linearer Lauf, KAWAI variabel). */
function decodePositions(span: Span, table: readonly number[]): number[] {
  const out: number[] = [];
  let ip = span.start;
  let guard = 0;
  while (ip < span.end && ++guard < 100_000) {
    out.push(ip);
    const op = span.bytes[ip]!;
    if (op === OP_KAWAI) {
      const total = span.bytes[ip + 1];
      if (total === undefined || total < 2) return out;
      ip += total;
      continue;
    }
    const len = table[op]!;
    if (len < 0) return out;
    ip += 1 + len;
  }
  return out;
}

/** Linke IF-Adresse als Schlüssel (Bank-Nibble << 16 | Rohadresse). */
function ifLeftKey(bytes: Uint8Array, ip: number): number {
  const op = bytes[ip]!;
  const bankPair = bytes[ip + 1]!;
  const word = op >= 0x16;
  const raw = word ? bytes[ip + 2]! | (bytes[ip + 3]! << 8) : bytes[ip + 2]!;
  return ((bankPair >> 4) << 16) | raw;
}

interface WindowStat {
  occurrences: number;
  withIf: number;
  histogram: Map<number, number>;
}

function collect(spans: Span[], table: readonly number[], anchorOp: number, skip: number, window: number): WindowStat {
  const stat: WindowStat = { occurrences: 0, withIf: 0, histogram: new Map() };
  for (const span of spans) {
    const positions = decodePositions(span, table);
    for (let i = 0; i < positions.length; i++) {
      if (span.bytes[positions[i]!] !== anchorOp) continue;
      stat.occurrences++;
      for (let j = i + 1 + skip; j < Math.min(positions.length, i + 1 + skip + window); j++) {
        const ip = positions[j]!;
        if (!IF_OPS.has(span.bytes[ip]!)) continue;
        stat.withIf++;
        const key = ifLeftKey(span.bytes, ip);
        stat.histogram.set(key, (stat.histogram.get(key) ?? 0) + 1);
        break; // nur der ERSTE Lesezugriff zählt
      }
    }
  }
  return stat;
}

function topShare(stat: WindowStat): { key: string; share: number } {
  let bestKey = -1;
  let best = 0;
  for (const [k, v] of stat.histogram) {
    if (v > best) {
      best = v;
      bestKey = k;
    }
  }
  return {
    key: bestKey >= 0 ? `bank${bestKey >> 16}/addr${bestKey & 0xffff}` : '-',
    share: stat.withIf > 0 ? best / stat.withIf : 0,
  };
}

async function loadSpans(): Promise<Span[]> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const spans: Span[] = [];
  for (const entry of index.listEntries('flevel')) {
    if (entry.name.includes('.')) continue;
    let parsed;
    try {
      parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
    } catch {
      continue;
    }
    const script = parsed.bundle?.script;
    const bytes = parsed.bundle?.rawSections[1];
    if (!parsed.ok || !script || !bytes) continue;
    for (const s of script.spans) {
      if (s.end > s.start) spans.push({ bytes, start: s.start, end: s.end });
    }
  }
  await dir.closeAll();
  return spans;
}

describe.skipIf(!available)('S33-Probe: outcome-Zielvariable', () => {
  it('misst den ersten IF-Lesezugriff nach BATTLE gegen zwei Kontrollen', { timeout: 1_800_000 }, async () => {
    const spans = await loadSpans();
    const table = buildTable();
    const WINDOW = 8;

    const battle = collect(spans, table, OP_BATTLE, 0, WINDOW);
    const mapjump = collect(spans, table, OP_MAPJUMP, 0, WINDOW);
    const shifted = collect(spans, table, OP_BATTLE, 12, WINDOW);

    const tb = topShare(battle);
    const tm = topShare(mapjump);
    const ts = topShare(shifted);
    const faktorGegenMapjump = tm.share > 0 ? tb.share / tm.share : Infinity;
    const faktorGegenVerschoben = ts.share > 0 ? tb.share / ts.share : Infinity;

    console.log(
      'outcome-Probe:',
      JSON.stringify(
        {
          battle: { occurrences: battle.occurrences, mitVerzweigung: battle.withIf, top: tb },
          mapjump: { occurrences: mapjump.occurrences, mitVerzweigung: mapjump.withIf, top: tm },
          verschoben: { occurrences: shifted.occurrences, mitVerzweigung: shifted.withIf, top: ts },
          faktorGegenMapjump: faktorGegenMapjump.toFixed(2),
          faktorGegenVerschoben: faktorGegenVerschoben.toFixed(2),
        },
        null,
        1,
      ),
    );

    expect(battle.occurrences).toBeGreaterThan(100);
    // **Ergebnis der Messung (2026-08-10): KEIN Befund.** Die stärkste nach
    // BATTLE gelesene Adresse liegt unter dem Faktor 3 gegen beide Kontrollen
    // — die Annahme „outcome landet in einer Script-Variable" ist damit nicht
    // belegt. Konsequenz (Roadmap): Die Zielvariable bleibt 🔴, der
    // Interpreter schreibt WEITERHIN NICHTS (`vm.ts` unverändert), der Wert
    // lebt ausschließlich im `battle-finished`-Event. Diese Erwartungen
    // dokumentieren den Negativbefund; schlägt eine künftig fehl, hat sich
    // die Datenlage geändert und die Frage ist NEU zu entscheiden.
    expect(faktorGegenMapjump).toBeLessThan(3);
    expect(faktorGegenVerschoben).toBeLessThan(3);
  });

  it('O9-Kampf-Opcodes: keine der vier Makou-Längen verbessert den Abschluss', { timeout: 1_800_000 }, async () => {
    const spans = await loadSpans();
    const table = buildTable();
    const walk = (t: readonly number[]): number => {
      let ok = 0;
      for (const span of spans) {
        let ip = span.start;
        let guard = 0;
        let good = true;
        while (ip < span.end) {
          if (++guard > 100_000) {
            good = false;
            break;
          }
          const op = span.bytes[ip]!;
          if (op === OP_KAWAI) {
            const total = span.bytes[ip + 1];
            if (total === undefined || total < 2) {
              good = false;
              break;
            }
            ip += total;
            continue;
          }
          const len = t[op]!;
          if (len < 0) {
            good = false;
            break;
          }
          ip += 1 + len;
        }
        if (good && ip === span.end) ok++;
      }
      return ok;
    };

    const baseline = walk(table);
    // Makou-GESAMTlängen: BTMD2 0x22 = 5, BTRLD 0x23 = 3, BTLTB 0x4B = 2,
    // BTLMD 0x72 = 3 ⇒ Operandenlängen 4/2/1/2 (unsere Tabelle: 1/4/0/1).
    const hypothesen: [number, number][] = [
      [0x22, 4],
      [0x23, 2],
      [0x4b, 1],
      [0x72, 2],
    ];
    const ergebnisse: Record<string, { baseline: number; makou: number }> = {};
    for (const [op, len] of hypothesen) {
      const t2 = [...table];
      t2[op] = len;
      ergebnisse[`0x${op.toString(16)}`] = { baseline, makou: walk(t2) };
    }
    console.log('O9-Kampf-Opcodes:', JSON.stringify({ spans: spans.length, ergebnisse }));
    for (const [op, r] of Object.entries(ergebnisse)) {
      // Keine Makou-Länge darf den Abschluss verbessern — sonst wäre die
      // O9-Ablehnung falsch gewesen und die Länge gehörte übernommen.
      expect(r.makou, `Makou-Länge für ${op}`).toBeLessThanOrEqual(r.baseline);
    }
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
