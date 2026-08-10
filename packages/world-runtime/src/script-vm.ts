import {
  WOP_GOTO,
  WOP_GOTO_IF_FALSE,
  WOP_OPERAND1,
  WOP_RESET,
  WOP_RETURN,
  type EvFunction,
  type WorldEv,
} from '@webmidgar/formats-world';

/**
 * World-Script-VM (S29) — Interpreter der u16-Stack-Grammatik.
 *
 * Beleglage, ehrlich getrennt:
 *  🟢 GEMESSEN (world-ev-probe): Wortbreite, Operandenlängen (Push-Familie
 *     und Sprünge je 1 Wort, Rest 0), Return 0x203 beendet, Sprungziel =
 *     codebasis-relative Wortadresse auf Instruktionsgrenzen (732/732).
 *  🟡 HYPOTHESE (Community-Beschreibung, über Fixture-Sollverläufe
 *     festgelegt, NICHT am Original belegt): die Stack-WIRKUNG der
 *     Rechen-/Vergleichsopcodes, die Bitadress-Zerlegung (addr>>3 / addr&7)
 *     und die Pop-Reihenfolge von Write (Wert zuerst, dann Adresse).
 *  🔴 UNBEKANNT: alle Kommando-Opcodes (0x204, 0x300+ …) — sie laufen unter
 *     der UNKNOWN-Politik des Projekts: Fault ins Journal, überspringen,
 *     NIE raten (dieselbe Haltung wie im Field-Interpreter).
 *
 * Determinismus: Die VM ist ein reiner Zustandsübergang über ganzzahligen
 * Werten (u16-Wrap); es gibt keine Wanduhr und keinen Float.
 */

export interface WorldVmFault {
  pc: number;
  opcode: number;
  kind: 'unknown-op' | 'stack-underflow' | 'budget' | 'bad-jump';
}

export interface WorldWrite {
  addr: number;
  value: number;
}

export interface WorldVmResult {
  finished: boolean;
  steps: number;
  faults: WorldVmFault[];
  writes: WorldWrite[];
}

/** Serialisierbarer Speicher: sortierte Paare, damit der Digest stabil ist. */
export interface WorldMemorySnapshot {
  savemap: Array<[number, number]>;
  temp: Array<[number, number]>;
  special: Array<[number, number]>;
}

const FAULT_LIMIT = 256;

export class WorldScriptVM {
  readonly savemap = new Map<number, number>();
  readonly temp = new Map<number, number>();
  readonly special = new Map<number, number>();

  constructor(readonly ev: WorldEv) {}

  findMeshFunction(meshX: number, meshY: number, functionId: number): EvFunction | null {
    return (
      this.ev.functions.find(
        (f) => f.type === 'mesh' && f.meshX === meshX && f.meshY === meshY && f.functionId === functionId,
      ) ?? null
    );
  }

  findSystemFunction(functionId: number): EvFunction | null {
    return this.ev.functions.find((f) => f.type === 'system' && f.functionId === functionId) ?? null;
  }

  runFunction(fn: EvFunction, budget = 10_000): WorldVmResult {
    const code = this.ev.code;
    const faults: WorldVmFault[] = [];
    const writes: WorldWrite[] = [];
    const stack: number[] = [];
    let pc = fn.offset;
    let steps = 0;
    const fault = (kind: WorldVmFault['kind'], opcode: number): void => {
      if (faults.length < FAULT_LIMIT) faults.push({ pc, opcode, kind });
    };
    const pop = (opcode: number): number => {
      const v = stack.pop();
      if (v === undefined) {
        fault('stack-underflow', opcode);
        return 0;
      }
      return v;
    };
    const leseByte = (map: Map<number, number>, addr: number): number => map.get(addr) ?? 0;

    while (pc < code.length) {
      if (++steps > budget) {
        fault('budget', -1);
        return { finished: false, steps, faults, writes };
      }
      const op = code[pc]!;
      if (op === WOP_RETURN) return { finished: true, steps, faults, writes };
      const operand = WOP_OPERAND1.has(op) ? (code[pc + 1] ?? 0) : 0;

      switch (op) {
        case 0x0: // NOP (🟡)
          break;
        case WOP_RESET:
          stack.length = 0;
          break;
        case 0x110:
          stack.push(operand);
          break;
        case 0x114: // Savemap-Bit (🟡 addr>>3 / addr&7)
          stack.push((leseByte(this.savemap, operand >> 3) >> (operand & 7)) & 1);
          break;
        case 0x117:
          stack.push((leseByte(this.special, operand >> 3) >> (operand & 7)) & 1);
          break;
        case 0x118:
          stack.push(leseByte(this.savemap, operand) & 0xff);
          break;
        case 0x119:
          stack.push(leseByte(this.temp, operand) & 0xff);
          break;
        case 0x11b:
          stack.push(leseByte(this.special, operand) & 0xff);
          break;
        case 0x11c:
          stack.push(leseByte(this.savemap, operand) & 0xffff);
          break;
        case 0x11d:
          stack.push(leseByte(this.temp, operand) & 0xffff);
          break;
        case 0x11f:
          stack.push(leseByte(this.special, operand) & 0xffff);
          break;
        case 0x15:
          stack.push(~pop(op) & 0xffff);
          break;
        case 0x17:
          stack.push(pop(op) === 0 ? 1 : 0);
          break;
        case 0x30:
        case 0x40:
        case 0x41:
        case 0x50:
        case 0x51:
        case 0x60:
        case 0x61:
        case 0x62:
        case 0x63:
        case 0x70:
        case 0x80:
        case 0xa0:
        case 0xb0:
        case 0xc0: {
          const b = pop(op);
          const a = pop(op);
          let r: number;
          switch (op) {
            case 0x30: r = a * b; break;
            case 0x40: r = a + b; break;
            case 0x41: r = a - b; break;
            case 0x50: r = a << b; break;
            case 0x51: r = a >> b; break;
            case 0x60: r = a < b ? 1 : 0; break;
            case 0x61: r = a > b ? 1 : 0; break;
            case 0x62: r = a <= b ? 1 : 0; break;
            case 0x63: r = a >= b ? 1 : 0; break;
            case 0x70: r = a === b ? 1 : 0; break;
            case 0x80: r = a & b; break;
            case 0xa0: r = a | b; break;
            case 0xb0: r = a !== 0 && b !== 0 ? 1 : 0; break;
            default: r = a !== 0 || b !== 0 ? 1 : 0; break;
          }
          stack.push(r & 0xffff);
          break;
        }
        case 0xe0: {
          // 🟡 Pop-Reihenfolge: Wert zuletzt gepusht, Adresse zuerst.
          const value = pop(op);
          const addr = pop(op);
          this.savemap.set(addr, value & 0xffff);
          writes.push({ addr, value: value & 0xffff });
          break;
        }
        case WOP_GOTO:
        case WOP_GOTO_IF_FALSE: {
          const springen = op === WOP_GOTO ? true : pop(op) === 0;
          if (springen) {
            if (operand < fn.offset || operand >= fn.end) {
              // Im Bestand 732/732 innerhalb der Funktion — außerhalb ist Defekt.
              fault('bad-jump', op);
              return { finished: false, steps, faults, writes };
            }
            pc = operand;
            continue;
          }
          break;
        }
        default:
          // UNKNOWN-Politik: melden und überspringen (Operandenlänge 0 ist
          // für alle nicht gelisteten Opcodes gemessen, s. Probe).
          fault('unknown-op', op);
          break;
      }
      pc += WOP_OPERAND1.has(op) ? 2 : 1;
    }
    fault('budget', -1);
    return { finished: false, steps, faults, writes };
  }

  snapshotMemory(): WorldMemorySnapshot {
    const sortiert = (m: Map<number, number>): Array<[number, number]> =>
      [...m.entries()].sort((a, b) => a[0] - b[0]);
    return { savemap: sortiert(this.savemap), temp: sortiert(this.temp), special: sortiert(this.special) };
  }

  restoreMemory(snapshot: WorldMemorySnapshot): void {
    this.savemap.clear();
    this.temp.clear();
    this.special.clear();
    for (const [k, v] of snapshot.savemap) this.savemap.set(k, v);
    for (const [k, v] of snapshot.temp) this.temp.set(k, v);
    for (const [k, v] of snapshot.special) this.special.set(k, v);
  }
}
