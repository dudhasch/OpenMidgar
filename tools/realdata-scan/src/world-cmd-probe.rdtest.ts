import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  parseWorldEv,
  parseWorldMap,
  WORLD_GRIDS,
  WORLD_MESH_EXTENT,
  WORLD_CMD_POPS,
} from '@webmidgar/formats-world';
import { sampleGround } from '@webmidgar/render-world';
import { WorldScriptVM } from '@webmidgar/world-runtime';
import { NodeDirectorySource } from './node-source.js';

/**
 * S30 — Kommando-Opcodes des World-Scripts.
 *
 * DIE FRAGE: S29 hat die Grammatik belegt, aber 23,6 % aller realen
 * Instruktionen waren Kommando-Opcodes ohne bekannte Stelligkeit — die VM
 * musste sie faulten und überspringen. Hier wird die STELLIGKEIT aus den
 * Daten abgeleitet (die Bedeutung bleibt davon unberührt: 🔴).
 *
 * VERFAHREN (Accounting, wie beim Terrainlayout):
 *  1. Der Code zerfällt in ANWEISUNGEN. Ausgesprochene Annahme der Suchmenge:
 *     „0x100 leert den Stack und beginnt jede Anweisung, und der Stack ist am
 *     Anweisungsende leer." Das ist keine Glaubenssache — es ist die
 *     Gütefunktion, und sie wird gegen zwei falsche Trennungen kontrolliert.
 *  2. Jede Anweisung liefert eine Gleichung „Summe der Netto-Deltas = 0".
 *     Das lineare System über 2360 Anweisungen ist WIDERSPRUCHSFREI und
 *     bestimmt 92 von 96 freien Opcodes eindeutig.
 *  3. Aus den nun berechenbaren Stacktiefen folgt die Pop-Zahl: sie liegt
 *     zwischen max(0, −delta) und der Mindesttiefe vor dem Opcode. Für 89/92
 *     fällt das Intervall auf einen Punkt zusammen.
 *
 * GRENZEN, die die Messung selbst benennt:
 *  - 0x305/0x306 und 0x326/0x327 treten NUR paarweise auf; messbar ist nur die
 *    Summe (−1 bzw. −3), nicht die Aufteilung.
 *  - Die Bilanz ist gegenüber der BEDEUTUNG vollständig invariant. Sie belegt,
 *    dass die Stelligkeiten aufgehen — nicht, dass ein Opcode das Richtige tut.
 *
 * Urheberrecht: nur Zähler, Quoten, Wertebereiche — keine Bytefolgen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(REAL_DIR);
const WM_DIR = join(REAL_DIR, 'data', 'wm');

const CODE_BASIS_WORT = 512;
const OPERAND1 = new Set([0x110, 0x114, 0x117, 0x118, 0x119, 0x11b, 0x11c, 0x11d, 0x11f, 0x200, 0x201]);
const OP_RETURN = 0x203;
const OP_RESET = 0x100;

/** Vor der Messung bekannte Stack-Wirkung (S29): [pop, push]. */
const BEKANNT = new Map<number, [number, number]>([
  [0x110, [0, 1]], [0x114, [0, 1]], [0x117, [0, 1]], [0x118, [0, 1]], [0x119, [0, 1]],
  [0x11b, [0, 1]], [0x11c, [0, 1]], [0x11d, [0, 1]], [0x11f, [0, 1]],
  [0x15, [1, 1]], [0x17, [1, 1]],
  [0x30, [2, 1]], [0x40, [2, 1]], [0x41, [2, 1]], [0x50, [2, 1]], [0x51, [2, 1]],
  [0x60, [2, 1]], [0x61, [2, 1]], [0x62, [2, 1]], [0x63, [2, 1]], [0x70, [2, 1]],
  [0x80, [2, 1]], [0xa0, [2, 1]], [0xb0, [2, 1]], [0xc0, [2, 1]],
  [0xe0, [2, 0]], [0x200, [0, 0]], [0x201, [1, 0]],
]);

/**
 * Referenztabelle (ff7-landscaper / wiki.ffrtt.ru) — HYPOTHESENGEBER, keine
 * Autorität. Sie wird hier gegen die eigene Messung gehalten, nicht übernommen.
 */
const REFERENZ_POPS = new Map<number, number>([
  [0x18, 1], [0x19, 1], [0x1b, 1],
  [0x300, 1], [0x302, 0], [0x303, 1], [0x304, 1], [0x305, 1], [0x306, 1], [0x307, 1],
  [0x308, 2], [0x309, 2], [0x30a, 1], [0x30b, 1], [0x30c, 0], [0x30d, 0], [0x30e, 2],
  [0x310, 2], [0x311, 2], [0x312, 2], [0x313, 3], [0x314, 2], [0x315, 3], [0x316, 3],
  [0x317, 1], [0x318, 2], [0x319, 1], [0x31b, 1], [0x31c, 1], [0x31d, 1], [0x31f, 1],
  [0x320, 0], [0x321, 1], [0x324, 4], [0x325, 1], [0x326, 3], [0x327, 0], [0x328, 1],
  [0x329, 1], [0x32a, 1], [0x32b, 1], [0x32c, 2], [0x32d, 0], [0x32e, 0], [0x32f, 1],
  [0x330, 1], [0x331, 0], [0x332, 0], [0x333, 2], [0x334, 0], [0x336, 1], [0x339, 0],
  [0x33a, 1], [0x33b, 2], [0x33c, 0], [0x33d, 1], [0x33e, 1], [0x347, 1], [0x348, 2],
  [0x349, 1], [0x34a, 1], [0x34b, 1], [0x34c, 1], [0x34d, 3], [0x34e, 1], [0x34f, 1],
  [0x350, 1], [0x351, 1], [0x352, 1], [0x353, 2], [0x354, 1], [0x355, 1],
]);
/** Aufruf-Familie 0x204+k: die Referenz gibt EINEN Pop (die Modellnummer). */
for (let op = 0x204; op <= 0x223; op++) REFERENZ_POPS.set(op, 1);

interface Instr { pc: number; op: number; operand: number | null }
interface Fn { ids: number[]; start: number; instrs: Instr[] }

async function readEvEntries(): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/wm']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const out: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of index.listEntries('world_gm')) {
    if (entry.name.toLowerCase().endsWith('.ev')) {
      out.push({ name: entry.name, bytes: await index.readEntry(entry.canonicalId) });
    }
  }
  await dir.closeAll();
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function disasm(bytes: Uint8Array): Fn[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wort = (w: number): number => view.getUint16(w * 2, true);
  const codeWorte = bytes.length / 2 - CODE_BASIS_WORT;
  const paare: Array<{ id: number; offset: number }> = [];
  for (let w = 0; w + 1 < CODE_BASIS_WORT && paare.length < 256; w += 2) {
    const id = wort(w);
    if (id === 0xffff) break;
    paare.push({ id, offset: wort(w + 1) });
  }
  const starts = [...new Set(paare.map((p) => p.offset))].sort((a, b) => a - b);
  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : codeWorte;
    const instrs: Instr[] = [];
    let pc = s;
    while (pc < end) {
      const op = wort(CODE_BASIS_WORT + pc);
      if (OPERAND1.has(op)) { instrs.push({ pc, op, operand: wort(CODE_BASIS_WORT + pc + 1) }); pc += 2; }
      else { instrs.push({ pc, op, operand: null }); pc += 1; }
      if (op === OP_RETURN) break;
    }
    return { ids: paare.filter((p) => p.offset === s).map((p) => p.id), start: s, instrs };
  });
}

function statements(fn: Fn, trenner: (i: Instr) => boolean): Instr[][] {
  const out: Instr[][] = [];
  let cur: Instr[] | null = null;
  for (const i of fn.instrs) {
    if (trenner(i)) {
      if (cur) out.push(cur);
      cur = i.op === OP_RESET ? [] : i.op === OP_RETURN ? null : [i];
      continue;
    }
    if (cur) cur.push(i);
  }
  if (cur) out.push(cur);
  return out;
}

/** Gauss über den Netto-Deltas; liefert die eindeutig bestimmten Variablen. */
function loeseDeltas(
  vars: number[],
  rows: Array<{ koeff: Map<number, number>; rhs: number }>,
): { loesung: Map<number, number>; widerspruch: number } {
  const idx = new Map(vars.map((v, i) => [v, i]));
  const m: number[][] = rows.map((r) => {
    const z = new Array<number>(vars.length + 1).fill(0);
    for (const [v, c] of r.koeff) z[idx.get(v)!] = c;
    z[vars.length] = r.rhs;
    return z;
  });
  const pivot = new Map<number, number>();
  let zeile = 0;
  for (let spalte = 0; spalte < vars.length && zeile < m.length; spalte++) {
    let p = -1;
    for (let r = zeile; r < m.length; r++) if (Math.abs(m[r]![spalte]!) > 1e-9) { p = r; break; }
    if (p < 0) continue;
    [m[zeile], m[p]] = [m[p]!, m[zeile]!];
    const pv = m[zeile]![spalte]!;
    for (let c = spalte; c <= vars.length; c++) m[zeile]![c]! /= pv;
    for (let r = 0; r < m.length; r++) {
      if (r === zeile) continue;
      const f = m[r]![spalte]!;
      if (Math.abs(f) < 1e-9) continue;
      for (let c = spalte; c <= vars.length; c++) m[r]![c]! -= f * m[zeile]![c]!;
    }
    pivot.set(spalte, zeile);
    zeile++;
  }
  let widerspruch = 0;
  for (const row of m) {
    const nullzeile = row.slice(0, vars.length).every((x) => Math.abs(x) < 1e-9);
    if (nullzeile && Math.abs(row[vars.length]!) > 1e-9) widerspruch++;
  }
  const loesung = new Map<number, number>();
  for (const [spalte, r] of pivot) {
    let frei = false;
    for (let c = 0; c < vars.length; c++) if (c !== spalte && Math.abs(m[r]![c]!) > 1e-9) frei = true;
    if (!frei) loesung.set(vars[spalte]!, Math.round(m[r]![vars.length]!));
  }
  return { loesung, widerspruch };
}

function baueSystem(sts: Instr[][]): {
  vars: number[];
  rows: Array<{ koeff: Map<number, number>; rhs: number }>;
} {
  const frei = new Set<number>();
  for (const st of sts) for (const i of st) if (!BEKANNT.has(i.op)) frei.add(i.op);
  const rows = sts.map((st) => {
    const koeff = new Map<number, number>();
    let rhs = 0;
    for (const i of st) {
      const b = BEKANNT.get(i.op);
      if (b) rhs -= b[1] - b[0];
      else koeff.set(i.op, (koeff.get(i.op) ?? 0) + 1);
    }
    return { koeff, rhs };
  });
  return { vars: [...frei].sort((a, b) => a - b), rows };
}

async function alleStatements(): Promise<{ fns: Fn[]; sts: Instr[][] }> {
  const entries = await readEvEntries();
  const fns: Fn[] = [];
  for (const { bytes } of entries) fns.push(...disasm(bytes));
  const sts: Instr[][] = [];
  for (const fn of fns) sts.push(...statements(fn, (i) => i.op === OP_RESET || i.op === OP_RETURN));
  return { fns, sts };
}

describe.skipIf(!available)('Realdaten: World-Kommando-Opcodes (S30)', () => {
  it('H-BILANZ: Netto-Deltas aus der Anweisungsbilanz — widerspruchsfrei, 92/96 eindeutig', async () => {
    const { sts } = await alleStatements();
    const { vars, rows } = baueSystem(sts);
    const { loesung, widerspruch } = loeseDeltas(vars, rows);
    const unbestimmt = vars.filter((v) => !loesung.has(v));
    console.log(
      'WORLD-CMD-DELTA:',
      JSON.stringify({
        anweisungen: sts.length,
        freieOpcodes: vars.length,
        eindeutig: loesung.size,
        widerspruch,
        unbestimmt: unbestimmt.map((v) => `0x${v.toString(16)}`),
      }),
    );
    // Der Wahrheitstest: das System geht ohne Rest auf.
    expect(widerspruch).toBe(0);
    expect(sts.length).toBe(2360);
    expect(vars.length).toBe(96);
    expect(loesung.size).toBe(92);
    // Die vier Unbestimmten sind GENAU die beiden Paare, die nie einzeln
    // vorkommen — die Messung benennt ihre eigene Grenze.
    expect(unbestimmt).toEqual([0x305, 0x306, 0x326, 0x327]);
  });

  it('KONTROLLE: falsch gezogene Anweisungsgrenzen erzeugen Widersprüche', async () => {
    const { fns } = await alleStatements();
    const messe = (trenner: (i: Instr) => boolean): { stmts: number; widerspruch: number } => {
      const sts: Instr[][] = [];
      for (const fn of fns) sts.push(...statements(fn, trenner));
      const { vars, rows } = baueSystem(sts);
      return { stmts: sts.length, widerspruch: loeseDeltas(vars, rows).widerspruch };
    };
    const echt = messe((i) => i.op === OP_RESET || i.op === OP_RETURN);
    const k201 = messe((i) => i.op === 0x201 || i.op === OP_RETURN);
    const k110 = messe((i) => i.op === 0x110 || i.op === OP_RETURN);
    console.log('WORLD-CMD-KONTROLLE:', JSON.stringify({ echt, k201, k110 }));
    // Wäre die Bilanz gegenüber der Trennung invariant, wäre sie blind.
    expect(echt.widerspruch).toBe(0);
    expect(k201.widerspruch).toBeGreaterThan(50);
    expect(k110.widerspruch).toBeGreaterThan(1000);
  });

  it('H-POP: Pop-Zahl aus den Stacktiefen; Nullwert-Zweitrechnung ohne die 0-stelligen', async () => {
    const { sts } = await alleStatements();
    const { vars, rows } = baueSystem(sts);
    const { loesung } = loeseDeltas(vars, rows);
    const delta = (op: number): number | null => {
      const b = BEKANNT.get(op);
      if (b) return b[1] - b[0];
      return loesung.get(op) ?? null;
    };
    const minTiefe = new Map<number, number>();
    const anzahl = new Map<number, number>();
    for (const st of sts) {
      let t = 0;
      for (const i of st) {
        const d = delta(i.op);
        if (d === null) break;
        if (!BEKANNT.has(i.op)) {
          minTiefe.set(i.op, Math.min(minTiefe.get(i.op) ?? 99, t));
          anzahl.set(i.op, (anzahl.get(i.op) ?? 0) + 1);
        }
        t += d;
      }
    }
    let eindeutig = 0;
    let offen = 0;
    let nullstellig = 0;
    const abweichung: string[] = [];
    for (const [op, d] of loesung) {
      const unten = Math.max(0, -d);
      const oben = minTiefe.get(op) ?? unten;
      if (unten === oben) {
        eindeutig++;
        if (unten === 0) nullstellig++;
        // Gegenprobe gegen die verriegelte Tabelle im Paket.
        const tabelle = WORLD_CMD_POPS.get(op);
        if (tabelle !== undefined && tabelle !== unten) abweichung.push(`0x${op.toString(16)}: ${tabelle}≠${unten}`);
      } else {
        offen++;
      }
    }
    console.log(
      'WORLD-CMD-POP:',
      JSON.stringify({
        bestimmt: loesung.size,
        eindeutig,
        offen,
        nullstellig,
        ohneNullstellige: eindeutig - nullstellig,
        abweichungZurTabelle: abweichung,
        belegstellen: [...anzahl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o, n]) => [`0x${o.toString(16)}`, n]),
      }),
    );
    // 89 von 92: offen bleiben genau 0x18/0x19/0x1b (Delta 0, Mindesttiefe 1 —
    // Pop 0 oder 1 ist an den Daten nicht entscheidbar).
    expect(eindeutig).toBe(89);
    expect(offen).toBe(3);
    // Nullwert-Zweitrechnung: 0-stellige Opcodes bestehen die Bilanz trivial.
    expect(eindeutig - nullstellig).toBeGreaterThan(70);
    // Die ausgelieferte Tabelle darf von der Messung nirgends abweichen.
    expect(abweichung).toEqual([]);
  });

  it('REFERENZABGLEICH: Community-Tabelle gegen die eigene Messung, mit verschobener Kontrolle', async () => {
    const { sts } = await alleStatements();
    const { vars, rows } = baueSystem(sts);
    const { loesung } = loeseDeltas(vars, rows);
    const delta = (op: number): number | null =>
      BEKANNT.has(op) ? BEKANNT.get(op)![1] - BEKANNT.get(op)![0] : (loesung.get(op) ?? null);
    const minTiefe = new Map<number, number>();
    for (const st of sts) {
      let t = 0;
      for (const i of st) {
        const d = delta(i.op);
        if (d === null) break;
        if (!BEKANNT.has(i.op)) minTiefe.set(i.op, Math.min(minTiefe.get(i.op) ?? 99, t));
        t += d;
      }
    }
    // Die Aufruf-Familie 0x204–0x223 trägt in der Referenz durchgehend den
    // Wert 1 — sie ist als KONTROLLE entartet (jede Verschiebung trifft) und
    // wird deshalb getrennt gezählt, statt die Quote zu schönen.
    const messbar: Array<[number, number]> = [];
    let familieGeprueft = 0;
    let familieTreffer = 0;
    const widerlegt: string[] = [];
    for (const [op, d] of loesung) {
      const unten = Math.max(0, -d);
      const oben = minTiefe.get(op) ?? unten;
      if (unten !== oben) continue; // nur eindeutig Gemessenes vergleichen
      const ref = REFERENZ_POPS.get(op);
      if (ref === undefined) continue;
      if (op >= 0x204 && op <= 0x223) {
        familieGeprueft++;
        if (ref === unten) familieTreffer++;
        continue;
      }
      messbar.push([op, unten]);
      if (ref !== unten) widerlegt.push(`0x${op.toString(16)}: Referenz ${ref}, gemessen ${unten}`);
    }
    messbar.sort((a, b) => a[0] - b[0]);
    const geprueft = messbar.length;
    const treffer = messbar.filter(([op, gemessen]) => REFERENZ_POPS.get(op) === gemessen).length;
    // Kontrolle: die Referenzwerte um EINE Listenposition verschoben zuordnen.
    let kontrolle = 0;
    for (let i = 0; i < messbar.length; i++) {
      const nachbar = messbar[(i + 1) % messbar.length]![0];
      if (REFERENZ_POPS.get(nachbar) === messbar[i]![1]) kontrolle++;
    }
    // Zweite Widerlegung: die Referenz gibt 0x305 UND 0x306 je 1 Pop; gemessen
    // ist die SUMME des Paares −1 (die Werte selbst sind nicht trennbar).
    const paarSumme = { p305_306: 0, p326_327: 0 };
    for (const st of sts) {
      const hat = (o: number): boolean => st.some((i) => i.op === o);
      if (hat(0x305) && hat(0x306)) paarSumme.p305_306++;
      if (hat(0x326) && hat(0x327)) paarSumme.p326_327++;
    }
    const paarUnpaarig = sts.filter(
      (st) => st.some((i) => i.op === 0x305) !== st.some((i) => i.op === 0x306),
    ).length;
    console.log(
      'WORLD-CMD-REFERENZ:',
      JSON.stringify({
        geprueft,
        treffer,
        quote: (treffer / geprueft).toFixed(4),
        kontrolleVerschoben: kontrolle,
        kontrollQuote: (kontrolle / geprueft).toFixed(4),
        aufrufFamilie: `${familieTreffer}/${familieGeprueft} (als Kontrolle entartet)`,
        widerlegt,
        paarSumme,
        paarUnpaarig,
      }),
    );
    expect(geprueft).toBeGreaterThan(60);
    expect(treffer).toBe(geprueft); // die Referenz hält, wo sie eindeutig messbar ist
    expect(familieTreffer).toBe(familieGeprueft);
    expect(kontrolle).toBeLessThan(treffer * 0.7); // die Gütefunktion ist nicht blind
    // 0x305/0x306 kommen NUR paarweise vor — deshalb ist die Referenzangabe
    // „je 1 Pop" (Summe 2) an der gemessenen Summe (1) widerlegt.
    expect(paarUnpaarig).toBe(0);
  });

  it('ABDECKUNG: VM-Lauf über alle wm0-Funktionen — Faultquote vor/nach der Scharfschaltung', async () => {
    const entries = await readEvEntries();
    const wm0 = entries.find((e) => e.name.toLowerCase().startsWith('wm0'))!;
    const ev = parseWorldEv(wm0.bytes);
    const vm = new WorldScriptVM(ev);
    let instrGesamt = 0;
    let unknown = 0;
    let stackUnderflow = 0;
    let regulaer = 0;
    let angehalten = 0;
    const faultOpcodes = new Map<number, number>();
    for (const fn of ev.functions) {
      let state = vm.startFunction(fn);
      let r = vm.run(state, 20000);
      let schutz = 0;
      while (r.suspended && schutz++ < 64) {
        state.waitFrames = 0;
        const w = vm.run(state, 20000);
        r = { ...w, faults: [...r.faults, ...w.faults] };
      }
      if (r.suspended) angehalten++;
      else if (r.finished) regulaer++;
      instrGesamt += r.steps;
      for (const f of r.faults) {
        if (f.kind === 'unknown-op') { unknown++; faultOpcodes.set(f.opcode, (faultOpcodes.get(f.opcode) ?? 0) + 1); }
        if (f.kind === 'stack-underflow') stackUnderflow++;
      }
    }
    console.log(
      'WORLD-CMD-ABDECKUNG:',
      JSON.stringify({
        funktionen: ev.functions.length,
        regulaerBeendet: regulaer,
        instruktionen: instrGesamt,
        unknownOps: unknown,
        unknownQuote: (unknown / instrGesamt).toFixed(5),
        stackUnderflow,
        restOpcodes: [...faultOpcodes.entries()].map(([o, n]) => [`0x${o.toString(16)}`, n]),
      }),
    );
    // S29: 23,6 % unknown. Jetzt: kein einziger unbekannter Opcode mehr, und
    // — das ist der schärfere Beleg — kein Stack-Underflow: die Stelligkeiten
    // gehen über den GESAMTEN Bestand auf.
    expect(unknown).toBe(0);
    expect(stackUnderflow).toBe(0);
    expect(regulaer + angehalten).toBe(ev.functions.length);
  });

  it('BLOCKSUCHE (Negativbefund): kein Operand trägt die Alternativblöcke oder ihre Zellen', async () => {
    // Ausgesprochene Annahme der Suchmenge — die hier SCHEITERT: „Die
    // Umschaltung der WM0-Alternativblöcke steht als Blockindex im Script."
    // Gesucht wird in ALLEN Literaloperanden ALLER Kommando-Opcodes (die vier
    // Positionen vor dem Opcode), über alle drei `.ev`. Damit die Suche
    // aussagekräftig ist, wird sie an einer bekannten Menge VALIDIERT: die
    // Mesh-Zellen der Einstiegspunkte (0x308) müssen gefunden werden.
    const { fns } = await alleStatements();
    const ZELLEN = new Set([41, 42, 47, 48, 50, 60]); // gemessene Zielzellen
    const ALT = new Set([63, 64, 65, 66, 67, 68]); // die Alternativblöcke
    const treffer = new Map<string, { zellen: number; alt: number; n: number; uniq: Set<number> }>();
    for (const fn of fns) {
      for (const st of statements(fn, (i) => i.op === OP_RESET || i.op === OP_RETURN)) {
        for (let k = 0; k < st.length; k++) {
          const op = st[k]!.op;
          if (BEKANNT.has(op)) continue;
          for (let d = 1; d <= 4; d++) {
            const q = k - d;
            if (q < 0 || st[q]!.op !== 0x110) break;
            const key = `0x${op.toString(16)}#${d}`;
            const e = treffer.get(key) ?? { zellen: 0, alt: 0, n: 0, uniq: new Set<number>() };
            const v = st[q]!.operand!;
            e.n++;
            e.uniq.add(v);
            if (ZELLEN.has(v)) e.zellen++;
            if (ALT.has(v)) e.alt++;
            treffer.set(key, e);
          }
        }
      }
    }
    // Validierung der Suche: 0x308 muss als Mesh-Zellen-Träger sichtbar sein.
    const validierung = treffer.get('0x308#2');
    expect(validierung).toBeDefined();
    expect(validierung!.uniq.size).toBeGreaterThan(20);

    const verdaechtig = [...treffer.entries()]
      .filter(([, e]) => e.n >= 5)
      .map(([k, e]) => ({
        stelle: k,
        n: e.n,
        zellenQuote: e.zellen / e.n,
        altQuote: e.alt / e.n,
        // Erwartungswert bei Zufall: 6 von den `uniq` beobachteten Werten.
        erwartet: 6 / Math.max(e.uniq.size, 1),
      }))
      .filter((x) => x.zellenQuote > 3 * x.erwartet || x.altQuote > 3 * x.erwartet)
      .sort((a, b) => b.zellenQuote - a.zellenQuote);
    console.log(
      'WORLD-CMD-BLOCKSUCHE:',
      JSON.stringify({ stellen: treffer.size, ueberRauschen: verdaechtig.slice(0, 6) }),
    );
    // Negativbefund: keine Operandenstelle trägt die Alternativblöcke 63–68.
    const altTraeger = [...treffer.values()].filter((e) => e.alt / e.n > 0.5);
    expect(altTraeger).toEqual([]);
  });

  it('H-PROGRESS: 0x349 wird über eine monotone Schwellenkaskade auf Savemap-Wort 0 belegt', async () => {
    const { fns } = await alleStatements();
    const stufen: number[] = [];
    const schwellen: number[] = [];
    for (const fn of fns) {
      const st = statements(fn, (i) => i.op === OP_RESET || i.op === OP_RETURN);
      for (let k = 0; k < st.length; k++) {
        const s = st[k]!;
        const idx = s.findIndex((i) => i.op === 0x349);
        if (idx < 0) continue;
        if (idx >= 1 && s[idx - 1]!.op === 0x110) stufen.push(s[idx - 1]!.operand!);
        // Die zuletzt VOR dieser Anweisung geprüfte Schwelle auf 0x11c(0).
        for (let j = k - 1; j >= 0 && j >= k - 6; j--) {
          const v = st[j]!;
          if (v.length >= 3 && v[0]!.op === 0x11c && v[0]!.operand === 0 && v[1]!.op === 0x110) {
            schwellen.push(v[1]!.operand!);
            break;
          }
        }
      }
    }
    const uniqStufen = [...new Set(stufen)].sort((a, b) => a - b);
    const uniqSchwellen = [...new Set(schwellen)].sort((a, b) => a - b);
    console.log('WORLD-CMD-PROGRESS:', JSON.stringify({ vorkommen: stufen.length, uniqStufen, uniqSchwellen }));
    // Genau vier Nicht-Null-Stufen (0 ist der Vorgabewert, wenn keine Schwelle
    // greift) — dieselbe Anzahl wie die vier Alternativgruppen.
    expect(uniqStufen).toEqual([1, 2, 3, 4]);
    // Die Schwellen sind Werte des Fortschrittsworts, nicht Blockindizes.
    expect(Math.min(...uniqSchwellen)).toBeGreaterThan(100);
  });

  it('H-SPECIAL: 0x11b und 0x11f teilen EINEN Indexraum (überschneidungsfrei, lückenlos)', async () => {
    const { fns } = await alleStatements();
    const raum = new Map<number, Set<number>>([[0x117, new Set()], [0x11b, new Set()], [0x11f, new Set()]]);
    for (const fn of fns) {
      for (const i of fn.instrs) {
        const s = raum.get(i.op);
        if (s && i.operand !== null) s.add(i.operand);
      }
    }
    const b = raum.get(0x11b)!;
    const w = raum.get(0x11f)!;
    const schnitt = [...b].filter((x) => w.has(x));
    const union = [...new Set([...b, ...w, ...raum.get(0x117)!])].sort((a, b2) => a - b2);
    // Kontrollhypothese „echte Byte-/Wortzugriffe auf dieselbe Basis": dann
    // müsste Wortindex k die Bytes 2k und 2k+1 überdecken.
    const kollision = [...w].filter((k) => b.has(2 * k) || b.has(2 * k + 1)).length;
    console.log(
      'WORLD-CMD-SPECIAL:',
      JSON.stringify({
        byteIndizes: [...b].sort((x, y) => x - y),
        wortIndizes: [...w].sort((x, y) => x - y),
        bitIndizes: [...raum.get(0x117)!],
        schnitt,
        unionLueckenlosBis: union.length && union[union.length - 1] === union.length - 1,
        kollisionUnterByteWortDeutung: kollision,
      }),
    );
    // Gemessen: getrennte Indizes, zusammen ein lückenloser Raum ab 0 — und
    // unter der Byte/Wort-Deutung kollidierten sie. Die Referenzaussage
    // „0x117/0x11b/0x11f arbeiten identisch" hält an den eigenen Daten.
    expect(schnitt).toEqual([]);
    expect(kollision).toBeGreaterThan(0);
  });

  it('H-ORT: 0x308/0x309 setzen eine Position — die Einstiegspunkte liegen auf Nicht-Wasser', async () => {
    // Ausgesprochene Annahme der Suchmenge: Die Einstiegspunkte der Weltkarte
    // stehen IM Script (Zweig auf Sonderregister 6), nicht in einer Tabelle.
    // Gütefunktion: Wenn 0x308 (Mesh-Zelle) und 0x309 (Lage im Mesh) wirklich
    // eine Position bilden, MUSS diese Position auf begehbarem Gelände liegen.
    const bytes = new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP')));
    const terrain = parseWorldMap(bytes);
    const grid = WORLD_GRIDS.wm0;
    const WASSER = 3; // datengetriebener Wasserkandidat (S29)

    const entries = await readEvEntries();
    {
      const wm0 = entries.find((e) => e.name.toLowerCase().startsWith('wm0'))!;
      const orte: Array<{ id: number; mx: number; my: number; px: number; pz: number }> = [];
      for (const fn of disasm(wm0.bytes)) {
        const st = statements(fn, (i) => i.op === OP_RESET || i.op === OP_RETURN);
        for (let k = 0; k < st.length; k++) {
          const s = st[k]!;
          if (s.length !== 4) continue;
          if (s[0]!.op !== 0x11b || s[0]!.operand !== 6) continue;
          if (s[1]!.op !== 0x110 || s[2]!.op !== 0x70 || s[3]!.op !== 0x201) continue;
          const id = s[1]!.operand!;
          const ziel = s[3]!.operand!;
          let zelle: [number, number] | null = null;
          for (let j = k + 1; j < st.length; j++) {
            const b = st[j]!;
            if (b[0] && b[0]!.pc >= ziel) break;
            for (let q = 0; q < b.length; q++) {
              const vor = b.slice(Math.max(0, q - 2), q);
              if (vor.length !== 2 || !vor.every((x) => x.op === 0x110)) continue;
              if (b[q]!.op === 0x308) zelle = [vor[0]!.operand!, vor[1]!.operand!];
              else if (b[q]!.op === 0x309 && zelle) {
                orte.push({ id, mx: zelle[0], my: zelle[1], px: vor[0]!.operand!, pz: vor[1]!.operand! });
                zelle = null;
              }
            }
          }
        }
      }
      let land = 0;
      let wasser = 0;
      let leer = 0;
      for (const o of orte) {
        const boden = sampleGround(terrain, grid, o.mx * WORLD_MESH_EXTENT + o.px, o.my * WORLD_MESH_EXTENT + o.pz);
        if (!boden) leer++;
        else if (boden.walkClass === WASSER) wasser++;
        else land++;
      }
      // Kontrolle: gleich viele gleichverteilte Zufallspunkte derselben Karte.
      let kLand = 0;
      let kWasser = 0;
      let seed = 0x51ed;
      const rnd = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 2000; i++) {
        const x = rnd() * grid.cols * 4 * WORLD_MESH_EXTENT;
        const z = rnd() * grid.rows * 4 * WORLD_MESH_EXTENT;
        const boden = sampleGround(terrain, grid, x, z);
        if (!boden) continue;
        if (boden.walkClass === WASSER) kWasser++;
        else kLand++;
      }
      console.log(
        'WORLD-CMD-ORTE:',
        JSON.stringify({
          orte: orte.length,
          land,
          wasser,
          leer,
          quote: (land / (land + wasser)).toFixed(4),
          kontrollQuote: (kLand / (kLand + kWasser)).toFixed(4),
          meshBereich: [Math.min(...orte.map((o) => o.mx)), Math.max(...orte.map((o) => o.mx)), Math.min(...orte.map((o) => o.my)), Math.max(...orte.map((o) => o.my))],
          lageBereich: [Math.min(...orte.map((o) => Math.min(o.px, o.pz))), Math.max(...orte.map((o) => Math.max(o.px, o.pz)))],
        }),
      );
      expect(orte.length).toBeGreaterThan(40);
      // Alle Mesh-Zellen im 36×28-Raster, alle Lagewerte im Mesh-Grundriss.
      for (const o of orte) {
        expect(o.mx).toBeLessThan(grid.cols * 4);
        expect(o.my).toBeLessThan(grid.rows * 4);
        expect(o.px).toBeLessThanOrEqual(WORLD_MESH_EXTENT);
        expect(o.pz).toBeLessThanOrEqual(WORLD_MESH_EXTENT);
      }
      // Der eigentliche Beleg: die Punkte liegen weit überwiegend auf Land,
      // während die Karte selbst überwiegend Wasser ist.
      expect(land / (land + wasser)).toBeGreaterThan(0.85);
      expect(kLand / (kLand + kWasser)).toBeLessThan(land / (land + wasser) - 0.2);
    }
  });
});
