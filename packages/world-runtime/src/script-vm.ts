import {
  WOP_CALL_BASE,
  WOP_CALL_LAST,
  WOP_GOTO,
  WOP_GOTO_IF_FALSE,
  WOP_OPERAND1,
  WOP_RESET,
  WOP_RETURN,
  WOP_WAIT,
  WOP_WAIT_SET,
  WORLD_CMD_POPS,
  WORLD_CMD_PUSHES,
  type EvFunction,
  type WorldEv,
} from '@webmidgar/formats-world';

/**
 * World-Script-VM (S29/S30) — Interpreter der u16-Stack-Grammatik.
 *
 * Beleglage, ehrlich getrennt:
 *  🟢 GEMESSEN (world-ev-probe): Wortbreite, Operandenlängen (Push-Familie
 *     und Sprünge je 1 Wort, Rest 0), Return 0x203 beendet, Sprungziel =
 *     codebasis-relative Wortadresse auf Instruktionsgrenzen (732/732).
 *  🟢 GEMESSEN (world-cmd-probe): die STELLIGKEIT der Kommando-Opcodes. Der
 *     Code zerfällt in Anweisungen ab 0x100 (Stack-Reset); jede Anweisung
 *     verbraucht ihren Stack exakt. Über 2360 Anweisungen ist das lineare
 *     System der Netto-Deltas widerspruchsfrei und bestimmt 92/96 Opcodes
 *     eindeutig; Kontrollen mit verschobener Anweisungsgrenze liefern 110
 *     bzw. 1833 Widersprüche. Details in `@webmidgar/formats-world`.
 *  🟡 HYPOTHESE (Community-Beschreibung, über Fixture-Sollverläufe
 *     festgelegt, NICHT am Original belegt): die Stack-WIRKUNG der
 *     Rechen-/Vergleichsopcodes, die Bitadress-Zerlegung (addr>>3 / addr&7)
 *     und die Pop-Reihenfolge von Write (Wert zuerst, dann Adresse); die
 *     Aufteilung der gemessenen Paar-Deltas 0x305/0x306 und 0x326/0x327.
 *  🔴 UNBEKANNT bleibt die BEDEUTUNG der Kommandos. Deshalb führt die VM sie
 *     als DATEN aus: sie nimmt die gemessene Zahl Operanden vom Stack und legt
 *     `WorldCommand { opcode, args }` ins Ergebnis. Kein Kommando wirkt in der
 *     VM selbst — die Deutung ist Sache der Sitzung bzw. des Wirts. Ein
 *     Opcode ohne gemessene Stelligkeit faultet weiterhin (UNKNOWN-Politik).
 *
 * Determinismus: Die VM ist ein reiner Zustandsübergang über ganzzahligen
 * Werten (u16-Wrap); es gibt keine Wanduhr und keinen Float.
 */

export interface WorldVmFault {
  pc: number;
  opcode: number;
  kind: 'unknown-op' | 'stack-underflow' | 'budget' | 'bad-jump' | 'bad-call' | 'call-depth';
}

export interface WorldWrite {
  addr: number;
  value: number;
}

/** Ein ausgeführtes Kommando als DATEN — Stelligkeit gemessen, Bedeutung nicht. */
export interface WorldCommand {
  opcode: number;
  /** Operanden in Push-Reihenfolge (zuerst gepusht = args[0]). */
  args: number[];
}

export interface WorldVmResult {
  /** Funktion regulär beendet (alle Rahmen zurückgekehrt). */
  finished: boolean;
  /** An einem Wartepunkt (0x306) angehalten — fortsetzbar. */
  suspended: boolean;
  steps: number;
  faults: WorldVmFault[];
  writes: WorldWrite[];
  commands: WorldCommand[];
}

/** Fortsetzbarer Ausführungszustand (ADR-006: waitState als Daten). */
export interface WorldVmState {
  /** Aufrufkeller; der oberste Rahmen ist der letzte Eintrag. */
  frames: Array<{ start: number; pc: number; end: number }>;
  stack: number[];
  /** Verbleibende Wartetakte, vom Wirt heruntergezählt. */
  waitFrames: number;
  /** Von 0x305 vorgemerkte Taktzahl (🟡 Aufteilung des gemessenen Paar-Deltas). */
  pendingWait: number;
}

/** Serialisierbarer Speicher: sortierte Paare, damit der Digest stabil ist. */
export interface WorldMemorySnapshot {
  savemap: Array<[number, number]>;
  temp: Array<[number, number]>;
  special: Array<[number, number]>;
}

const FAULT_LIMIT = 256;
const CALL_DEPTH_LIMIT = 16;

export class WorldScriptVM {
  readonly savemap = new Map<number, number>();
  readonly temp = new Map<number, number>();
  /**
   * Sonderregister. GEMESSEN: 0x11b und 0x11f adressieren DENSELBEN Indexraum
   * — im Bestand nutzt 0x11b die Indizes {0,1,4,5,6,7,8,9,10,12,13,14} und
   * 0x11f genau {2,3}, zusammen lückenlos 0–14 und ÜBERSCHNEIDUNGSFREI. Unter
   * der Community-Benennung „Byte- bzw. Wortzugriff auf dieselbe Basis" müsste
   * Wort 2 die Bytes 4/5 überdecken — die sind aber getrennt belegt. Die
   * Referenzaussage „0x117/0x11b/0x11f arbeiten identisch" ist damit an den
   * eigenen Daten bestätigt.
   */
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

  findModelFunction(modelId: number, functionId: number): EvFunction | null {
    return (
      this.ev.functions.find((f) => f.type === 'model' && f.modelId === modelId && f.functionId === functionId) ?? null
    );
  }

  /** Startzustand für eine Funktion (ohne sie auszuführen). */
  startFunction(fn: EvFunction): WorldVmState {
    return { frames: [{ start: fn.offset, pc: fn.offset, end: fn.end }], stack: [], waitFrames: 0, pendingWait: 0 };
  }

  runFunction(fn: EvFunction, budget = 10_000): WorldVmResult {
    return this.run(this.startFunction(fn), budget);
  }

  /**
   * Führt `state` fort. Ein Wartepunkt hält an (`suspended`), ohne den Zustand
   * zu verlieren — der Wirt zählt `waitFrames` herunter und ruft erneut.
   */
  run(state: WorldVmState, budget = 10_000): WorldVmResult {
    const code = this.ev.code;
    const faults: WorldVmFault[] = [];
    const writes: WorldWrite[] = [];
    const commands: WorldCommand[] = [];
    const stack = state.stack;
    let steps = 0;
    let pc = state.frames.length ? state.frames[state.frames.length - 1]!.pc : code.length;
    const fault = (kind: WorldVmFault['kind'], opcode: number): void => {
      if (faults.length < FAULT_LIMIT) faults.push({ pc, opcode, kind });
    };
    const abbruch = (): WorldVmResult => {
      if (state.frames.length) state.frames[state.frames.length - 1]!.pc = pc;
      return { finished: false, suspended: false, steps, faults, writes, commands };
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

    if (state.waitFrames > 0) {
      return { finished: false, suspended: true, steps, faults, writes, commands };
    }

    while (state.frames.length > 0) {
      const frame = state.frames[state.frames.length - 1]!;
      if (pc >= code.length) {
        fault('bad-jump', -1);
        return abbruch();
      }
      if (++steps > budget) {
        fault('budget', -1);
        return abbruch();
      }
      const op = code[pc]!;
      if (op === WOP_RETURN) {
        state.frames.pop();
        if (state.frames.length === 0) {
          return { finished: true, suspended: false, steps, faults, writes, commands };
        }
        pc = state.frames[state.frames.length - 1]!.pc;
        continue;
      }
      const operand = WOP_OPERAND1.has(op) ? (code[pc + 1] ?? 0) : 0;
      let gesprungen = false;

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
        case 0x11b:
        case 0x11f:
          // GEMESSEN identischer Indexraum (s. Kommentar an `special`).
          stack.push(leseByte(this.special, operand) & 0xffff);
          break;
        case 0x118:
          stack.push(leseByte(this.savemap, operand) & 0xff);
          break;
        case 0x119:
          stack.push(leseByte(this.temp, operand) & 0xff);
          break;
        case 0x11c:
          stack.push(leseByte(this.savemap, operand) & 0xffff);
          break;
        case 0x11d:
          stack.push(leseByte(this.temp, operand) & 0xffff);
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
            if (operand >= frame.start && operand < frame.end) {
              pc = operand;
              gesprungen = true;
            } else {
              // Im Bestand 732/732 innerhalb der Funktion — außerhalb ist Defekt.
              fault('bad-jump', op);
              return abbruch();
            }
          }
          break;
        }
        default: {
          if (op >= WOP_CALL_BASE && op <= WOP_CALL_LAST) {
            // Aufruf-Familie: Modellnummer vom Stack (GEMESSEN 1 Pop),
            // Funktionsnummer aus dem Opcode (🟡 Referenz).
            const modelId = pop(op);
            const fnId = op - WOP_CALL_BASE;
            const ziel =
              modelId < 64 ? this.findModelFunction(modelId, fnId) : this.findSystemFunction(fnId);
            if (!ziel) {
              // Kein Absturz: fehlende Zielfunktion ist im Bestand möglich
              // (Modelle werden erst zur Laufzeit geladen) — melden, weiter.
              fault('bad-call', op);
              break;
            }
            if (state.frames.length >= CALL_DEPTH_LIMIT) {
              fault('call-depth', op);
              break;
            }
            frame.pc = pc + 1;
            state.frames.push({ start: ziel.offset, pc: ziel.offset, end: ziel.end });
            pc = ziel.offset;
            gesprungen = true;
            break;
          }
          const pops = WORLD_CMD_POPS.get(op);
          if (pops === undefined) {
            // UNKNOWN-Politik: melden und überspringen (Operandenlänge 0 ist
            // für alle nicht gelisteten Opcodes gemessen, s. Probe).
            fault('unknown-op', op);
            break;
          }
          const args = new Array<number>(pops);
          for (let i = pops - 1; i >= 0; i--) args[i] = pop(op);
          if (WORLD_CMD_PUSHES.has(op)) {
            // Abfrage-Opcodes legen ein Ergebnis zurück; der WERT ist unbelegt
            // (🔴) — 0 ist der neutrale Platzhalter, keine Behauptung.
            stack.push(0);
          }
          commands.push({ opcode: op, args });
          if (op === WOP_WAIT_SET) {
            state.pendingWait = args[0]! & 0xffff;
          } else if (op === WOP_WAIT) {
            const takte = state.pendingWait;
            state.pendingWait = 0;
            if (takte > 0) {
              state.waitFrames = takte;
              frame.pc = pc + 1;
              return { finished: false, suspended: true, steps, faults, writes, commands };
            }
          }
          break;
        }
      }
      if (!gesprungen) pc += WOP_OPERAND1.has(op) ? 2 : 1;
      state.frames[state.frames.length - 1]!.pc = pc;
    }
    return { finished: true, suspended: false, steps, faults, writes, commands };
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
