/**
 * Gegner-KI-VM (S31) — Interpreter für den KI-Bytecode aus scene.bin.
 *
 * **Realdaten-belegte Grammatik** (battle-ai-probe, 2026-08-10):
 *  - Jedes KI-Skript beginnt mit einer 16×u16-Handler-Offsettabelle
 *    (614/614 monoton, erster belegter Offset ausnahmslos 32).
 *  - Operandenlängen: Push-Familie 0x00–0x03 je 2 (Adressoperanden clustern
 *    in 8 Bänken, 95 %), Immediate-Treppen 0x10–0x13 = 1/2/3/4 und
 *    0x60–0x62 = 1/2/3, Sprünge 0x70/0x71/0x72 je 2, String-Op 0x93 =
 *    variabel bis 0xFF (0x00 ist TRENNZEICHEN im Text, nicht Ende!),
 *    alle übrigen 0. Spannen-Abschluss **938/941 (99,68 %)**; die 3 Reste
 *    sind dokumentiert (🟡). Terminator ist **0x73** (nicht 0x72 — der
 *    trägt einen u16-Operanden; Community-Angaben hier korrigiert).
 *  - Sprungziele sind HANDLER-relativ: 3920/3941 auf Instruktionsgrenzen
 *    gegen 6,2 % bei +1-Kontrolle (skript-relativ fällt mit 49 % durch).
 *  - 0x70 ist bedingt (Nachfolger nie Sprungziel — Fallthrough), 0x71/0x72
 *    verhalten sich unbedingt (Nachfolger zu 69 %/78 % nur als Ziel
 *    erreichbar).
 *
 * **Semantik-Politik** wie beim World-Script (S29): Die STACK-Semantik der
 * scharfgeschalteten Opcodes ist eine dokumentierte 🟡-Fixture-Festlegung
 * (am Original nicht belegt); alles andere läuft unter der UNKNOWN-Politik
 * des Projekts (Fault ins Journal, per Längentabelle überspringen, nie
 * raten). Der Speicherzugriff geht über ein austauschbares `AiMemory` —
 * die Belegung des Original-Adressraums ist unbelegt (🔴), die Runtime
 * liefert eine dokumentierte 🔵-Minimalbelegung.
 */

export const AI_HANDLER_COUNT = 16;
export const AI_STRING_OP = 0x93;
export const AI_TERMINATOR = 0x73;

/** Operandenlängen (ohne Opcode-Byte). Herkunft: s. Kopfkommentar. */
export function aiOperandLengths(): Int8Array {
  const t = new Int8Array(256);
  const set = (op: number, len: number) => {
    t[op] = len;
  };
  set(0x00, 2);
  set(0x01, 2);
  set(0x02, 2);
  set(0x03, 2);
  set(0x10, 1);
  set(0x11, 2);
  set(0x12, 3);
  set(0x13, 4);
  set(0x60, 1);
  set(0x61, 2);
  set(0x62, 3);
  set(0x70, 2);
  set(0x71, 2);
  set(0x72, 2);
  // 🟡 0xA0/0xA1: aus der Community-Tabelle übernommen; auf der Gütefunktion
  // indifferent (n=102 bzw. selten) — als Skip-Länge brauchbar, kein Beleg.
  set(0xa0, 2);
  set(0xa1, 2);
  return t;
}

export interface AiScript {
  /** Handler-Offsets (skriptrelativ); null = leer (0xFFFF). */
  handlerOffsets: (number | null)[];
  bytes: Uint8Array;
}

export function parseAiScript(bytes: Uint8Array): AiScript | null {
  if (bytes.length < AI_HANDLER_COUNT * 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const handlerOffsets: (number | null)[] = [];
  for (let i = 0; i < AI_HANDLER_COUNT; i++) {
    const v = view.getUint16(i * 2, true);
    handlerOffsets.push(v === 0xffff ? null : v);
  }
  return { handlerOffsets, bytes };
}

/**
 * Speicherschnittstelle der VM. Adressen sind die 16-Bit-Operanden der
 * Push-Familie; `size` ist die Familiennummer 0–3 (🟡 Deutung bit/u8/u16/u24).
 */
export interface AiMemory {
  read(address: number, size: number): number;
  write(address: number, value: number): void;
}

export interface AiAction {
  /** Vom Skript gewählte Attacke (Szenen-Attack-ID). */
  attackId: number;
  /** Rohwert unter der Attacken-ID auf dem Stack, falls vorhanden (🟡 Zielmaske). */
  targetRaw: number | null;
}

export type AiFaultKind = 'unknown-op' | 'stack-underflow' | 'bad-jump' | 'budget' | 'unknown-memory';

export interface AiFault {
  pc: number;
  opcode: number;
  kind: AiFaultKind;
}

export interface AiRunResult {
  finished: boolean;
  steps: number;
  actions: AiAction[];
  faults: AiFault[];
  /** Anteil per UNKNOWN-Politik übersprungener Instruktionen. */
  unknownCount: number;
}

const FAULT_LIMIT = 32;
const STACK_LIMIT = 128;

export interface AiRunOptions {
  budget?: number;
  rng?: () => number;
}

/**
 * Führt einen Handler aus. `handlerIndex` adressiert die 16er-Tabelle;
 * Konvention der Runtime: Der niedrigste belegte Index ist der Haupthandler
 * (🟡 — die Rollensemantik der 16 Plätze ist unbelegt).
 */
export function runAiHandler(
  script: AiScript,
  handlerIndex: number,
  memory: AiMemory,
  options: AiRunOptions = {},
): AiRunResult {
  const lengths = aiOperandLengths();
  const budget = options.budget ?? 2048;
  const rng = options.rng ?? (() => 0);
  const start = script.handlerOffsets[handlerIndex];
  const faults: AiFault[] = [];
  const actions: AiAction[] = [];
  if (start === null || start === undefined || start >= script.bytes.length) {
    return { finished: true, steps: 0, actions, faults, unknownCount: 0 };
  }
  // Handler-Ende: nächster belegter Offset oder Skriptende (Spannengrammatik).
  let end = script.bytes.length;
  for (const off of script.handlerOffsets) {
    if (off !== null && off > start && off < end) end = off;
  }
  const b = script.bytes;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const stack: number[] = [];
  let pc = start;
  let steps = 0;
  let unknownCount = 0;
  const fault = (kind: AiFaultKind, opcode: number, at: number): void => {
    if (faults.length < FAULT_LIMIT) faults.push({ pc: at, opcode, kind });
  };
  const pop = (opcode: number, at: number): number => {
    const v = stack.pop();
    if (v === undefined) {
      fault('stack-underflow', opcode, at);
      return 0;
    }
    return v;
  };
  const push = (v: number): void => {
    if (stack.length < STACK_LIMIT) stack.push(v >>> 0);
  };

  while (pc < end) {
    if (steps++ >= budget) {
      fault('budget', -1, pc);
      return { finished: false, steps, actions, faults, unknownCount };
    }
    const at = pc;
    const op = b[pc]!;
    if (op === AI_STRING_OP) {
      // Debug-Text: bis 0xFF überspringen (0x00 ist Trennzeichen im Text).
      let j = pc + 1;
      while (j < end && b[j] !== 0xff) j++;
      pc = j + 1;
      continue;
    }
    const next = pc + 1 + lengths[op]!;
    if (op === AI_TERMINATOR) {
      return { finished: true, steps, actions, faults, unknownCount };
    }
    switch (op) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x03: {
        // 🟡 Push aus dem Battle-Speicher (Größenfamilie = Opcode).
        const address = view.getUint16(pc + 1, true);
        push(memory.read(address, op));
        break;
      }
      case 0x10:
        push(b[pc + 1]!);
        break;
      case 0x11:
        push(view.getUint16(pc + 1, true));
        break;
      case 0x12:
        push(b[pc + 1]! | (b[pc + 2]! << 8) | (b[pc + 3]! << 16));
        break;
      case 0x13:
        push(view.getUint32(pc + 1, true));
        break;
      case 0x60:
        push(b[pc + 1]!);
        break;
      case 0x61:
        push(view.getUint16(pc + 1, true));
        break;
      case 0x62:
        push(b[pc + 1]! | (b[pc + 2]! << 8) | (b[pc + 3]! << 16));
        break;
      case 0x30:
      case 0x31:
      case 0x32:
      case 0x33:
      case 0x34:
      case 0x35:
      case 0x36: {
        // 🟡 Fixture-Festlegung: b = zweiter Pop, a = erster Pop von unten;
        // u32-Wrap wie im World-Script (S29).
        const rhs = pop(op, at);
        const lhs = pop(op, at);
        let r = 0;
        switch (op) {
          case 0x30: r = (lhs + rhs) >>> 0; break;
          case 0x31: r = (lhs - rhs) >>> 0; break;
          case 0x32: r = Math.imul(lhs, rhs) >>> 0; break;
          case 0x33: r = rhs === 0 ? 0 : Math.floor(lhs / rhs) >>> 0; break;
          case 0x34: r = rhs === 0 ? 0 : (lhs % rhs) >>> 0; break;
          case 0x35: r = (lhs & rhs) >>> 0; break;
          case 0x36: r = (lhs | rhs) >>> 0; break;
        }
        push(r);
        break;
      }
      case 0x40:
      case 0x41:
      case 0x42:
      case 0x43:
      case 0x44:
      case 0x45: {
        // 🟡 Vergleichsfamilie: eq, ne, ge, le, gt, lt (Fixture-Festlegung).
        const rhs = pop(op, at);
        const lhs = pop(op, at);
        let r = false;
        switch (op) {
          case 0x40: r = lhs === rhs; break;
          case 0x41: r = lhs !== rhs; break;
          case 0x42: r = lhs >= rhs; break;
          case 0x43: r = lhs <= rhs; break;
          case 0x44: r = lhs > rhs; break;
          case 0x45: r = lhs < rhs; break;
        }
        push(r ? 1 : 0);
        break;
      }
      case 0x50: {
        const rhs = pop(op, at);
        const lhs = pop(op, at);
        push(lhs !== 0 && rhs !== 0 ? 1 : 0);
        break;
      }
      case 0x51: {
        const rhs = pop(op, at);
        const lhs = pop(op, at);
        push(lhs !== 0 || rhs !== 0 ? 1 : 0);
        break;
      }
      case 0x52:
        push(pop(op, at) === 0 ? 1 : 0);
        break;
      case 0x70: {
        // ✅ bedingt (Nachfolger ist nie Sprungziel — Fallthrough-Beleg).
        const target = start + view.getUint16(pc + 1, true);
        const cond = pop(op, at);
        if (cond === 0) {
          if (target < start || target >= end) {
            fault('bad-jump', op, at);
            return { finished: false, steps, actions, faults, unknownCount };
          }
          pc = target;
          continue;
        }
        break;
      }
      case 0x71:
      case 0x72: {
        // ✅ unbedingt (Nachfolger nur als Ziel erreichbar, 69 %/78 %).
        // Der semantische Unterschied der beiden ist unbelegt (🟡).
        const target = start + view.getUint16(pc + 1, true);
        if (target < start || target >= end) {
          fault('bad-jump', op, at);
          return { finished: false, steps, actions, faults, unknownCount };
        }
        pc = target;
        continue;
      }
      case 0x82:
        // 🔵 Zufallswort aus dem Sitzungs-PRNG (Original-Deutung unbelegt).
        push(rng() & 0xffff);
        break;
      case 0x90: {
        // 🟡 Store: Wert, dann Adresse poppen (Fixture-Festlegung).
        const value = pop(op, at);
        const address = pop(op, at);
        memory.write(address & 0xffff, value);
        break;
      }
      case 0x91:
        pop(op, at);
        break;
      case 0x92: {
        // 🟡 Aktion: Attack-ID poppen; liegt darunter noch ein Wert, gilt er
        // als Zielrohwert (Fixture-Festlegung, ADR-Kommentar in session.ts).
        const attackId = pop(op, at);
        const targetRaw = stack.length > 0 ? pop(op, at) : null;
        actions.push({ attackId: attackId & 0xffff, targetRaw });
        break;
      }
      default:
        fault('unknown-op', op, at);
        unknownCount++;
        break;
    }
    pc = next;
  }
  // Aus der Spanne gelaufen ohne Terminator — als Abschluss werten, aber
  // meldbar (die 3 bekannten Restspannen des Bestands enden so).
  return { finished: true, steps, actions, faults, unknownCount };
}
