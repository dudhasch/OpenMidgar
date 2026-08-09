/**
 * Opcode-Tabellen für das Interpreter-Grundgerüst (S6) — Clean-Room:
 * Nummern, Operandenlängen und Semantikbeschreibungen stammen ausschließlich
 * aus öffentlicher Community-Dokumentation (Qhimm-Wiki-Opcode-Liste) und
 * eigener Verhaltensbeobachtung; kein Original-Disassembly.
 *
 * S6-Scope (Masterplan 4.1): Kontrollfluss, Variablen, Dialog-Stub.
 * Alles andere folgt der UNKNOWN-Politik (🔵): Länge bekannt → überspringen
 * + Telemetriezähler; Länge unbekannt → kontrollierter Kontext-Fault.
 */

export const OP = {
  // Kontrollfluss & Synchronisation
  RET: 0x00,
  REQ: 0x01,
  REQSW: 0x02,
  REQEW: 0x03,
  RETTO: 0x07,
  JMPF: 0x10,
  JMPFL: 0x11,
  JMPB: 0x12,
  JMPBL: 0x13,
  IFUB: 0x14,
  IFUBL: 0x15,
  IFSW: 0x16,
  IFSWL: 0x17,
  IFUW: 0x18,
  IFUWL: 0x19,
  WAIT: 0x24,
  // Dialog-Stub
  MESSAGE: 0x40,
  ASK: 0x48,
  WINDOW: 0x50,
  WCLSE: 0x52,
  // Variablen (saturierende Varianten mit "!")
  PLUS_S: 0x76,
  PLUS2_S: 0x77,
  MINUS_S: 0x78,
  MINUS2_S: 0x79,
  INC_S: 0x7a,
  INC2_S: 0x7b,
  DEC_S: 0x7c,
  DEC2_S: 0x7d,
  SETBYTE: 0x80,
  SETWORD: 0x81,
  BITON: 0x82,
  BITOFF: 0x83,
  BITXOR: 0x84,
  PLUS: 0x85,
  PLUS2: 0x86,
  MINUS: 0x87,
  MINUS2: 0x88,
  MUL: 0x89,
  MUL2: 0x8a,
  DIV: 0x8b,
  DIV2: 0x8c,
  MOD: 0x8d,
  MOD2: 0x8e,
  AND: 0x8f,
  AND2: 0x90,
  OR: 0x91,
  OR2: 0x92,
  XOR: 0x93,
  XOR2: 0x94,
  INC: 0x95,
  INC2: 0x96,
  DEC: 0x97,
  DEC2: 0x98,
  RANDOM: 0x99,
} as const;

export type OpCategory =
  | 'control'
  | 'variable'
  | 'dialog'
  | 'unknown-skipped'
  | 'unknown-fault';

/**
 * Operandenlängen (Bytes NACH dem Opcode-Byte) der implementierten Ops.
 * 🟡 Wortvergleiche: Adresse als u8 angenommen (Bankbreite 256 Bytes),
 * `Zu validieren` gegen Realverhalten.
 */
export const IMPL_OPERAND_LEN: Readonly<Record<number, number>> = {
  [OP.RET]: 0,
  [OP.REQ]: 2,
  [OP.REQSW]: 2,
  [OP.REQEW]: 2,
  [OP.RETTO]: 1,
  [OP.JMPF]: 1,
  [OP.JMPFL]: 2,
  [OP.JMPB]: 1,
  [OP.JMPBL]: 2,
  [OP.IFUB]: 5,
  [OP.IFUBL]: 6,
  [OP.IFSW]: 6,
  [OP.IFSWL]: 7,
  [OP.IFUW]: 6,
  [OP.IFUWL]: 7,
  [OP.WAIT]: 2,
  [OP.MESSAGE]: 2,
  [OP.ASK]: 6,
  [OP.WINDOW]: 9,
  [OP.WCLSE]: 1,
  [OP.PLUS_S]: 3,
  [OP.PLUS2_S]: 4,
  [OP.MINUS_S]: 3,
  [OP.MINUS2_S]: 4,
  [OP.INC_S]: 2,
  [OP.INC2_S]: 2,
  [OP.DEC_S]: 2,
  [OP.DEC2_S]: 2,
  [OP.SETBYTE]: 3,
  [OP.SETWORD]: 4,
  [OP.BITON]: 3,
  [OP.BITOFF]: 3,
  [OP.BITXOR]: 3,
  [OP.PLUS]: 3,
  [OP.PLUS2]: 4,
  [OP.MINUS]: 3,
  [OP.MINUS2]: 4,
  [OP.MUL]: 3,
  [OP.MUL2]: 4,
  [OP.DIV]: 3,
  [OP.DIV2]: 4,
  [OP.MOD]: 3,
  [OP.MOD2]: 4,
  [OP.AND]: 3,
  [OP.AND2]: 4,
  [OP.OR]: 3,
  [OP.OR2]: 4,
  [OP.XOR]: 3,
  [OP.XOR2]: 4,
  [OP.INC]: 2,
  [OP.INC2]: 2,
  [OP.DEC]: 2,
  [OP.DEC2]: 2,
  [OP.RANDOM]: 2,
};

/**
 * UNKNOWN-Politik, Stufe „Länge bekannt": dokumentierte Operandenlängen
 * nicht implementierter, aber häufiger Ops — werden übersprungen und gezählt.
 * 🟡 Jede Länge einzeln `Zu validieren` (Quelle: öffentliche Opcode-Liste).
 */
export const SKIP_OPERAND_LEN: Readonly<Record<number, number>> = {
  0x04: 2, // PREQ (Party-Variante von REQ)
  0x05: 2, // PRQSW
  0x06: 2, // PRQEW
  0x7e: 1, // TLKON
  0xa0: 1, // PC
  0xa1: 1, // CHAR
  0xa2: 2, // DFANM
  0xa3: 2, // ANIME1
  0xa4: 1, // VISI
  0xa5: 10, // XYZI
  0xa8: 5, // MOVE
  0xf0: 1, // MUSIC
  0xf1: 4, // SOUND
};

/**
 * 🟡 KAWAI (0x28) ist variabel lang: erstes Operandenbyte = Gesamtlänge der
 * Instruktion inkl. Opcode und Längenbyte (`Zu validieren`).
 */
export const OP_KAWAI = 0x28;

/** Vergleichsoperatoren der IF-Familie (öffentlich dokumentiert). */
export const CMP = {
  EQ: 0,
  NE: 1,
  GT: 2,
  LT: 3,
  GE: 4,
  LE: 5,
  AND: 6,
  XOR: 7,
  OR: 8,
  BITON: 9,
  BITOFF: 10,
} as const;

export function evalComparison(a: number, b: number, op: number): boolean | null {
  switch (op) {
    case CMP.EQ: return a === b;
    case CMP.NE: return a !== b;
    case CMP.GT: return a > b;
    case CMP.LT: return a < b;
    case CMP.GE: return a >= b;
    case CMP.LE: return a <= b;
    case CMP.AND: return (a & b) !== 0;
    case CMP.XOR: return (a ^ b) !== 0;
    case CMP.OR: return (a | b) !== 0;
    case CMP.BITON: return (a & (1 << b)) !== 0;
    case CMP.BITOFF: return (a & (1 << b)) === 0;
    default: return null; // unbekannter Vergleich → Fault beim Aufrufer
  }
}
