import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import type { Walkmesh } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { WalkmeshSolver } from '@webmidgar/walkmesh';
import { NodeDirectorySource } from './node-source.js';

/**
 * Bewegungsoperanden-Probe: prüft die vermutete Feldaufteilung der
 * Bewegungs-Opcodes 0xA5 (XYZI) und 0xA8 (MOVE) gegen das Walkmesh
 * DESSELBEN Fields.
 *
 * H-XYZI (10 Operandenbytes): u8 bankPaar1, u8 bankPaar2, i16 x, i16 y,
 * i16 z, u16 triangleId.
 * H-MOVE (5 Operandenbytes): u8 bankPaar, i16 x, i16 y.
 *
 * Entscheidender Test: `triangleId` muss ein gültiger Index in das Walkmesh
 * desselben Fields sein, `(x, y)` müssen in dessen Grundriss-Bounding-Box
 * liegen. Eine zufällige Fehlinterpretation träfe das nur selten — deshalb
 * tragen drei Kontrollhypothesen (K1 verschobene Felder, K2 anderer
 * triangleId-Offset, K3 Walkmesh des NÄCHSTEN Fields) dieselben Messungen
 * als Grundrauschen mit.
 *
 * Die Bytespannen werden — wie im Interpreter — linear mit der aus den
 * Realdaten abgeleiteten Operandenlängentabelle (`IMPL_OPERAND_LEN` +
 * `SKIP_OPERAND_LEN`, S12, 99,73 % Spannen-Abschluss) durchlaufen, damit der
 * Bytestrom synchron bleibt und Operanden nie als Opcodes gelesen werden.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const OP_XYZI = 0xa5;
const OP_MOVE = 0xa8;
const XYZI_LEN = 10;
const MOVE_LEN = 5;

interface Span {
  start: number;
  end: number;
}

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface FieldWalkData {
  triangleCount: number;
  solver: WalkmeshSolver;
  bbox: BBox;
  bboxTol: BBox;
}

interface OpInstance {
  fieldIdx: number;
  op: Uint8Array;
}

/** Bounding-Box aller begehbaren Dreiecke im Grundriss (x/y) — nur diese sind für locate() relevant. */
function computeBBox(solver: WalkmeshSolver): BBox | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const t of solver.tris) {
    if (!t.walkable) continue;
    any = true;
    for (const x of t.xs) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    for (const y of t.ys) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return any ? { minX, maxX, minY, maxY } : null;
}

function expandBBox(box: BBox, frac: number): BBox {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  return {
    minX: box.minX - frac * w,
    maxX: box.maxX + frac * w,
    minY: box.minY - frac * h,
    maxY: box.maxY + frac * h,
  };
}

function inBBox(x: number, y: number, box: BBox): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function buildLenTable(): number[] {
  const table = new Array<number>(256).fill(-1);
  for (const [op, len] of Object.entries(IMPL_OPERAND_LEN)) table[Number(op)] = len;
  for (const [op, len] of Object.entries(SKIP_OPERAND_LEN)) table[Number(op)] = len;
  return table;
}

/** Wertebereich + Anzahl verschiedener Werte über ein Zerlegungsfeld. */
class RangeTracker {
  min = Infinity;
  max = -Infinity;
  private readonly seen = new Set<number>();

  push(v: number): void {
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
    this.seen.add(v);
  }

  summary(): { min: number; max: number; distinct: number } {
    return { min: this.min, max: this.max, distinct: this.seen.size };
  }
}

/** Anteilszähler: trifft/geprüft → Prozentsatz. */
class Ratio {
  hit = 0;
  total = 0;
  push(ok: boolean): void {
    this.total++;
    if (ok) this.hit++;
  }
  pct(): string {
    return this.total > 0 ? `${((this.hit / this.total) * 100).toFixed(2)}%` : 'n/a';
  }
}

function readI16(op: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > op.length) return null;
  return new DataView(op.buffer, op.byteOffset + offset, 2).getInt16(0, true);
}

function readU16(op: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > op.length) return null;
  return new DataView(op.buffer, op.byteOffset + offset, 2).getUint16(0, true);
}

interface XyziDecoded {
  bank1: number;
  bank2: number;
  x: number;
  y: number;
  z: number;
  triId: number;
}

/** H-XYZI mit optionaler Byteverschiebung (K1: shift=-1 → i16 x ab Operandenbyte 1 statt 2). */
function decodeXYZI(op: Uint8Array, shift: number): XyziDecoded | null {
  const x = readI16(op, 2 + shift);
  const y = readI16(op, 4 + shift);
  const z = readI16(op, 6 + shift);
  const triId = readU16(op, 8 + shift);
  if (x === null || y === null || z === null || triId === null) return null;
  return { bank1: op[0]!, bank2: op[1]!, x, y, z, triId };
}

interface MoveDecoded {
  bank: number;
  x: number;
  y: number;
}

/** H-MOVE mit optionaler Byteverschiebung (K1: shift=-1 → i16 x ab Operandenbyte 0 statt 1). */
function decodeMOVE(op: Uint8Array, shift: number): MoveDecoded | null {
  const x = readI16(op, 1 + shift);
  const y = readI16(op, 3 + shift);
  if (x === null || y === null) return null;
  return { bank: op[0]!, x, y };
}

describe.skipIf(!available)('Realdaten: Bewegungsoperanden-Feldaufteilung', () => {
  it(
    'H-XYZI/H-MOVE gegen Walkmesh desselben Fields + Kontrollhypothesen K1-K3',
    { timeout: 900_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      const lenTable = buildLenTable();
      const fieldList: FieldWalkData[] = [];
      const xyziInstances: OpInstance[] = [];
      const moveInstances: OpInstance[] = [];

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle) continue;
        const bundle = parsed.bundle;
        const script = bundle.script;
        const bytes = bundle.rawSections[1];
        const walkmesh: Walkmesh | undefined = bundle.walkmesh;
        if (!script || !bytes || !walkmesh || walkmesh.triangles.length === 0) continue;

        const solver = new WalkmeshSolver(walkmesh);
        const bbox = computeBBox(solver);
        if (!bbox) continue;

        const fieldIdx = fieldList.length;
        fieldList.push({
          triangleCount: walkmesh.triangles.length,
          solver,
          bbox,
          bboxTol: expandBBox(bbox, 0.1),
        });

        // Spannen linear durchlaufen — exakt wie der Interpreter, damit der
        // Bytestrom synchron bleibt und Operanden nie als Opcodes gelesen werden.
        for (const s of script.spans as Span[]) {
          if (s.end <= s.start) continue;
          let ip = s.start;
          let guard = 0;
          while (ip < s.end) {
            if (++guard > 100_000) break;
            const op = bytes[ip]!;
            if (op === OP_KAWAI) {
              const total = bytes[ip + 1];
              if (total === undefined || total < 2) break;
              ip += total;
              continue;
            }
            const len = lenTable[op]!;
            if (len < 0) break;
            const operandStart = ip + 1;
            const operandEnd = operandStart + len;
            if (operandEnd > s.end) break;
            if (op === OP_XYZI && len === XYZI_LEN) {
              xyziInstances.push({ fieldIdx, op: bytes.subarray(operandStart, operandEnd) });
            } else if (op === OP_MOVE && len === MOVE_LEN) {
              moveInstances.push({ fieldIdx, op: bytes.subarray(operandStart, operandEnd) });
            }
            ip = operandEnd;
          }
        }
      }

      const fields = fieldList.length;
      const nextFieldIdx = (i: number): number => (i + 1) % Math.max(1, fields);

      // --- 0xA5 XYZI -----------------------------------------------------
      const xyzi = {
        count: xyziInstances.length,
        triIdInRange: new Ratio(),
        bboxIn: new Ratio(),
        bboxInTol10: new Ratio(),
        inMesh: new Ratio(),
        k1_shifted: {
          bboxIn: new Ratio(),
          bboxInTol10: new Ratio(),
          inMesh: new Ratio(),
          triIdInRange: new Ratio(),
        },
        k2_altTriIdOffset: { triIdInRange: new Ratio() },
        k3_nextFieldWalkmesh: {
          triIdInRange: new Ratio(),
          bboxIn: new Ratio(),
          bboxInTol10: new Ratio(),
          inMesh: new Ratio(),
        },
        ranges: {
          bank1: new RangeTracker(),
          bank2: new RangeTracker(),
          x: new RangeTracker(),
          y: new RangeTracker(),
          z: new RangeTracker(),
          triId: new RangeTracker(),
        },
        bank1Histogram: {} as Record<number, number>,
        bank2Histogram: {} as Record<number, number>,
      };

      for (const inst of xyziInstances) {
        const own = fieldList[inst.fieldIdx]!;
        const d = decodeXYZI(inst.op, 0);
        if (!d) continue;

        xyzi.ranges.bank1.push(d.bank1);
        xyzi.ranges.bank2.push(d.bank2);
        xyzi.ranges.x.push(d.x);
        xyzi.ranges.y.push(d.y);
        xyzi.ranges.z.push(d.z);
        xyzi.ranges.triId.push(d.triId);
        xyzi.bank1Histogram[d.bank1] = (xyzi.bank1Histogram[d.bank1] ?? 0) + 1;
        xyzi.bank2Histogram[d.bank2] = (xyzi.bank2Histogram[d.bank2] ?? 0) + 1;

        xyzi.triIdInRange.push(d.triId < own.triangleCount);
        xyzi.bboxIn.push(inBBox(d.x, d.y, own.bbox));
        xyzi.bboxInTol10.push(inBBox(d.x, d.y, own.bboxTol));
        xyzi.inMesh.push(own.solver.locate(d.x, d.y) !== null);

        // K1: alle Mehrbytefelder um 1 Byte nach vorn verschoben lesen.
        const k1 = decodeXYZI(inst.op, -1);
        if (k1) {
          xyzi.k1_shifted.bboxIn.push(inBBox(k1.x, k1.y, own.bbox));
          xyzi.k1_shifted.bboxInTol10.push(inBBox(k1.x, k1.y, own.bboxTol));
          xyzi.k1_shifted.inMesh.push(own.solver.locate(k1.x, k1.y) !== null);
          xyzi.k1_shifted.triIdInRange.push(k1.triId < own.triangleCount);
        }

        // K2: triangleId aus den ersten beiden Operandenbytes (bankPaar als u16).
        const altTriId = readU16(inst.op, 0);
        if (altTriId !== null) xyzi.k2_altTriIdOffset.triIdInRange.push(altTriId < own.triangleCount);

        // K3: korrekt zerlegte Werte gegen das Walkmesh des NÄCHSTEN Fields
        // (feste Verschiebung statt Zufall) — liefert das Grundrauschen.
        const next = fieldList[nextFieldIdx(inst.fieldIdx)]!;
        xyzi.k3_nextFieldWalkmesh.triIdInRange.push(d.triId < next.triangleCount);
        xyzi.k3_nextFieldWalkmesh.bboxIn.push(inBBox(d.x, d.y, next.bbox));
        xyzi.k3_nextFieldWalkmesh.bboxInTol10.push(inBBox(d.x, d.y, next.bboxTol));
        xyzi.k3_nextFieldWalkmesh.inMesh.push(next.solver.locate(d.x, d.y) !== null);
      }

      // --- 0xA8 MOVE -------------------------------------------------------
      const move = {
        count: moveInstances.length,
        bboxIn: new Ratio(),
        bboxInTol10: new Ratio(),
        inMesh: new Ratio(),
        k1_shifted: { bboxIn: new Ratio(), bboxInTol10: new Ratio(), inMesh: new Ratio() },
        k3_nextFieldWalkmesh: { bboxIn: new Ratio(), bboxInTol10: new Ratio(), inMesh: new Ratio() },
        ranges: {
          bank: new RangeTracker(),
          x: new RangeTracker(),
          y: new RangeTracker(),
        },
      };

      for (const inst of moveInstances) {
        const own = fieldList[inst.fieldIdx]!;
        const d = decodeMOVE(inst.op, 0);
        if (!d) continue;

        move.ranges.bank.push(d.bank);
        move.ranges.x.push(d.x);
        move.ranges.y.push(d.y);

        move.bboxIn.push(inBBox(d.x, d.y, own.bbox));
        move.bboxInTol10.push(inBBox(d.x, d.y, own.bboxTol));
        move.inMesh.push(own.solver.locate(d.x, d.y) !== null);

        const k1 = decodeMOVE(inst.op, -1);
        if (k1) {
          move.k1_shifted.bboxIn.push(inBBox(k1.x, k1.y, own.bbox));
          move.k1_shifted.bboxInTol10.push(inBBox(k1.x, k1.y, own.bboxTol));
          move.k1_shifted.inMesh.push(own.solver.locate(k1.x, k1.y) !== null);
        }

        const next = fieldList[nextFieldIdx(inst.fieldIdx)]!;
        move.k3_nextFieldWalkmesh.bboxIn.push(inBBox(d.x, d.y, next.bbox));
        move.k3_nextFieldWalkmesh.bboxInTol10.push(inBBox(d.x, d.y, next.bboxTol));
        move.k3_nextFieldWalkmesh.inMesh.push(next.solver.locate(d.x, d.y) !== null);
      }

      const topHistogram = (h: Record<number, number>, n: number): Record<string, number> =>
        Object.fromEntries(
          Object.entries(h)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n),
        );

      const report = {
        fields,
        xyziInstruktionen: xyzi.count,
        moveInstruktionen: move.count,
        'H-XYZI (0xA5)': {
          triangleIdInRange: xyzi.triIdInRange.pct(),
          xyInBBox: xyzi.bboxIn.pct(),
          xyInBBoxTol10Pct: xyzi.bboxInTol10.pct(),
          xyImMesh: xyzi.inMesh.pct(),
          wertebereiche: {
            bankPaar1: xyzi.ranges.bank1.summary(),
            bankPaar2: xyzi.ranges.bank2.summary(),
            x: xyzi.ranges.x.summary(),
            y: xyzi.ranges.y.summary(),
            z: xyzi.ranges.z.summary(),
            triangleId: xyzi.ranges.triId.summary(),
          },
          bankPaar1Histogramm_top10: topHistogram(xyzi.bank1Histogram, 10),
          bankPaar2Histogramm_top10: topHistogram(xyzi.bank2Histogram, 10),
        },
        'H-MOVE (0xA8)': {
          xyInBBox: move.bboxIn.pct(),
          xyInBBoxTol10Pct: move.bboxInTol10.pct(),
          xyImMesh: move.inMesh.pct(),
          wertebereiche: {
            bankPaar: move.ranges.bank.summary(),
            x: move.ranges.x.summary(),
            y: move.ranges.y.summary(),
          },
        },
        Kontrollhypothesen: {
          'K1 (0xA5, Felder um 1 Byte verschoben)': {
            triangleIdInRange: xyzi.k1_shifted.triIdInRange.pct(),
            xyInBBox: xyzi.k1_shifted.bboxIn.pct(),
            xyInBBoxTol10Pct: xyzi.k1_shifted.bboxInTol10.pct(),
            xyImMesh: xyzi.k1_shifted.inMesh.pct(),
          },
          'K1 (0xA8, Felder um 1 Byte verschoben)': {
            xyInBBox: move.k1_shifted.bboxIn.pct(),
            xyInBBoxTol10Pct: move.k1_shifted.bboxInTol10.pct(),
            xyImMesh: move.k1_shifted.inMesh.pct(),
          },
          'K2 (0xA5, triangleId aus Operandenbyte 0-1)': {
            triangleIdInRange: xyzi.k2_altTriIdOffset.triIdInRange.pct(),
          },
          'K3 (0xA5, Walkmesh des nächsten Fields)': {
            triangleIdInRange: xyzi.k3_nextFieldWalkmesh.triIdInRange.pct(),
            xyInBBox: xyzi.k3_nextFieldWalkmesh.bboxIn.pct(),
            xyInBBoxTol10Pct: xyzi.k3_nextFieldWalkmesh.bboxInTol10.pct(),
            xyImMesh: xyzi.k3_nextFieldWalkmesh.inMesh.pct(),
          },
          'K3 (0xA8, Walkmesh des nächsten Fields)': {
            xyInBBox: move.k3_nextFieldWalkmesh.bboxIn.pct(),
            xyInBBoxTol10Pct: move.k3_nextFieldWalkmesh.bboxInTol10.pct(),
            xyImMesh: move.k3_nextFieldWalkmesh.inMesh.pct(),
          },
        },
      };

      console.log('Bewegungsoperanden:', JSON.stringify(report, null, 2));

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
