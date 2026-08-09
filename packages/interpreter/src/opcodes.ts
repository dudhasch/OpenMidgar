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
  // Entität & Bewegung (S12). Längen sind realdaten-abgeleitet; die
  // Feldaufteilung INNERHALB der Operanden ist gesondert geprüft.
  PC: 0xa0,
  CHAR: 0xa1,
  DFANM: 0xa2,
  ANIME1: 0xa3,
  VISI: 0xa4,
  XYZI: 0xa5,
  MOVE: 0xa8,
  DIR: 0xab,
  // Audio (S17). Die abgeleiteten Längen (1 bzw. 4) decken sich mit der
  // öffentlichen Dokumentation — zwei unabhängige Quellen, die übereinstimmen.
  MUSIC: 0xf0,
  SOUND: 0xf1,
  /**
   * Field-Wechsel. ✅ Aus den Realdaten identifiziert (S17): Von allen 256
   * Opcodes und allen Operandenpositionen ist einzig `0x60` an Position 0 ein
   * echter Zielfield-Index — der daraus gebaute Field-Graph hat **39,4 %
   * Rückkanten** gegen **0,9 %** bei verschobener maplist (Faktor 44). Alle
   * anderen Kandidaten bleiben unter 2,2 % und damit im Rauschen.
   */
  MAPJUMP: 0x60,
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
  // Entität & Bewegung — Längen aus dem Spannen-Abschluss (S12).
  [OP.PC]: 1,
  [OP.CHAR]: 1,
  [OP.DFANM]: 2,
  [OP.ANIME1]: 2,
  [OP.VISI]: 1,
  [OP.XYZI]: 10,
  [OP.MOVE]: 5,
  [OP.DIR]: 3,
  [OP.MUSIC]: 1,
  [OP.SOUND]: 4,
  [OP.MAPJUMP]: 9,
};

/**
 * UNKNOWN-Politik, Stufe „Länge bekannt": Operandenlängen nicht
 * implementierter Ops — werden übersprungen und gezählt.
 *
 * **Diese Tabelle ist aus den Realdaten ABGELEITET, nicht abgeschrieben**
 * (S12). Gütefunktion ist der Spannen-Abschluss: Jede der 48.041
 * Script-Spannen des Bestands ist ein zusammenhängender Instruktionsstrom, der
 * beim linearen Durchlaufen **exakt** auf seinem Ende landen muss. Eine
 * falsche Länge verrutscht den Strom und verfehlt das Ende. Ein
 * Koordinatenabstieg über die Längen 0…16 hebt die Abschlussquote von
 * **43,19 % auf 99,73 %**, bei 0,04 % unbekannt und 0,23 % Überlauf.
 *
 * Absicherung gegen Überanpassung: Alle vom Interpreter tatsächlich
 * ausgeführten Opcodes (`IMPL_OPERAND_LEN`) waren beim Abstieg **eingefroren**
 * — ein freier Lauf verbog sonst nachweislich richtige Längen (REQ 2→0,
 * MUL 3→0), weil sich 256 freie Parameter leicht gegen eine einzelne Kennzahl
 * optimieren lassen. Bei Gleichstand blieb der Ausgangswert stehen.
 *
 * 🟡 **48 der hier gelisteten Längen sind mehrdeutig** (mehrere Werte erreichen
 * dieselbe Güte, weil der Opcode zu selten vorkommt). Sie sind für den
 * Skip-Pfad brauchbar, taugen aber nicht als Beleg für die Recordstruktur —
 * wer einen dieser Opcodes implementiert, muss seine Länge einzeln prüfen.
 */
export const SKIP_OPERAND_LEN: Readonly<Record<number, number>> = {
  0x02: 2, 0x03: 2, 0x04: 3, 0x05: 1, 0x06: 2, 0x08: 1, 0x09: 0, 0x0a: 0,
  0x0b: 0, 0x0c: 0, 0x0d: 0, 0x0e: 1, 0x0f: 0, 0x1a: 0, 0x1b: 0, 0x1c: 0,
  0x1d: 4, 0x1e: 0, 0x1f: 0, 0x20: 0, 0x21: 0, 0x22: 1, 0x23: 4, 0x25: 8,
  0x26: 1, 0x27: 0, 0x29: 0, 0x2a: 2, 0x2b: 1, 0x2c: 0, 0x2d: 6, 0x2e: 1,
  0x2f: 8, 0x30: 3, 0x31: 2, 0x32: 1, 0x33: 0, 0x34: 1, 0x35: 3, 0x36: 5,
  0x37: 7, 0x38: 0, 0x39: 0, 0x3a: 4, 0x3b: 4, 0x3c: 0, 0x3d: 0, 0x3e: 0,
  0x3f: 0, 0x41: 1, 0x42: 0, 0x43: 2, 0x44: 0, 0x45: 0, 0x46: 0, 0x47: 4,
  0x49: 3, 0x4a: 1, 0x4b: 0, 0x4c: 7, 0x4d: 1, 0x4e: 14, 0x4f: 10, 0x51: 3,
  0x53: 1, 0x54: 1, 0x55: 1, 0x56: 3, 0x57: 8, 0x58: 4, 0x59: 2, 0x5a: 1,
  0x5b: 3, 0x5c: 5, 0x5d: 0, 0x5e: 7, 0x5f: 1, 0x60: 9, 0x61: 10, 0x62: 4,
  0x63: 5, 0x64: 5, 0x65: 0, 0x66: 8, 0x67: 0, 0x68: 8, 0x69: 6, 0x6a: 6,
  0x6b: 8, 0x6c: 0, 0x6d: 3, 0x6e: 4, 0x6f: 9, 0x70: 3, 0x71: 1, 0x72: 1,
  0x73: 3, 0x74: 3, 0x75: 7, 0x7e: 1, 0x7f: 2, 0x9a: 1, 0x9b: 0, 0x9c: 1,
  0x9d: 1, 0x9e: 0, 0x9f: 0, 0xa0: 1, 0xa1: 1, 0xa2: 2, 0xa3: 2, 0xa4: 1,
  0xa5: 10, 0xa6: 2, 0xa7: 6, 0xa8: 5, 0xa9: 5, 0xaa: 1, 0xab: 3, 0xac: 0,
  0xad: 5, 0xae: 2, 0xaf: 2, 0xb0: 4, 0xb1: 4, 0xb2: 3, 0xb3: 2, 0xb4: 5,
  0xb5: 3, 0xb6: 1, 0xb7: 2, 0xb8: 6, 0xb9: 5, 0xba: 2, 0xbb: 4, 0xbc: 4,
  0xbd: 3, 0xbe: 3, 0xbf: 1, 0xc0: 9, 0xc1: 3, 0xc2: 14, 0xc3: 10, 0xc4: 0,
  0xc5: 2, 0xc6: 2, 0xc7: 1, 0xc8: 1, 0xc9: 1, 0xca: 3, 0xcb: 2, 0xcc: 0,
  0xcd: 2, 0xce: 0, 0xcf: 0, 0xd0: 13, 0xd1: 1, 0xd2: 0, 0xd3: 1, 0xd4: 0,
  0xd5: 1, 0xd6: 1, 0xd7: 2, 0xd8: 2, 0xd9: 2, 0xda: 0, 0xdb: 2, 0xdc: 3,
  0xdd: 0, 0xde: 0, 0xdf: 0, 0xe0: 3, 0xe1: 3, 0xe2: 1, 0xe3: 2, 0xe4: 2,
  0xe5: 4, 0xe6: 4, 0xe7: 2, 0xe8: 4, 0xe9: 9, 0xea: 14, 0xeb: 1, 0xec: 3,
  0xed: 3, 0xee: 0, 0xef: 0, 0xf0: 1, 0xf1: 4, 0xf2: 6, 0xf3: 3, 0xf4: 3,
  0xf5: 1, 0xf6: 1, 0xf7: 8, 0xf8: 1, 0xf9: 0, 0xfa: 2, 0xfb: 0, 0xfc: 6,
  0xfd: 0, 0xfe: 3, 0xff: 1,
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
