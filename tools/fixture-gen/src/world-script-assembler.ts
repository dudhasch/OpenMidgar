/**
 * World-Script-Assembler (S29) — Zweitimplementierung des `.ev`-Formats für
 * Golden Fixtures, codegetrennt vom Parser/Interpreter. Layout laut
 * world-ev-probe: 0x400 B Call-Tabelle (u16 Kennung + u16 Wortoffset relativ
 * zu Wort 512, 0xFFFF-Sentinel), Code als u16-Worte; Sprungziele
 * codebasis-relativ.
 */

export type WorldMnemonic =
  | { op: 'Label'; name: string }
  | { op: 'PushConst'; value: number }
  | { op: 'PushSavemapBit' | 'PushSpecialBit' | 'PushSavemapByte' | 'PushTempByte' | 'PushSpecialByte' | 'PushSavemapWord' | 'PushTempWord' | 'PushSpecialWord'; addr: number }
  | { op: 'Goto' | 'GotoIfFalse'; label: string }
  | { op: 'Nop' | 'Reset' | 'Return' | 'Neg' | 'Not' | 'Mul' | 'Add' | 'Sub' | 'Shl' | 'Shr' | 'Lt' | 'Gt' | 'Le' | 'Ge' | 'Eq' | 'BitAnd' | 'BitOr' | 'LAnd' | 'LOr' | 'Write' }
  | { op: 'Raw'; word: number };

const PUSH_WORDS: Record<string, number> = {
  PushConst: 0x110,
  PushSavemapBit: 0x114,
  PushSpecialBit: 0x117,
  PushSavemapByte: 0x118,
  PushTempByte: 0x119,
  PushSpecialByte: 0x11b,
  PushSavemapWord: 0x11c,
  PushTempWord: 0x11d,
  PushSpecialWord: 0x11f,
};

const PLAIN_WORDS: Record<string, number> = {
  Nop: 0x0,
  Reset: 0x100,
  Return: 0x203,
  Neg: 0x15,
  Not: 0x17,
  Mul: 0x30,
  Add: 0x40,
  Sub: 0x41,
  Shl: 0x50,
  Shr: 0x51,
  Lt: 0x60,
  Gt: 0x61,
  Le: 0x62,
  Ge: 0x63,
  Eq: 0x70,
  BitAnd: 0x80,
  BitOr: 0xa0,
  LAnd: 0xb0,
  LOr: 0xc0,
  Write: 0xe0,
};

export function systemFunctionId(fn: number): number {
  return fn & 0xff;
}

export function modelFunctionId(modelId: number, fn: number): number {
  return (1 << 14) | ((modelId & 0x3f) << 8) | (fn & 0xff);
}

/** Deutung wie im Parser (realdaten-entschieden): Koordinaten als zeile·36+spalte in Bits 4–13. */
export function meshFunctionId(meshX: number, meshY: number, fn: number): number {
  return (2 << 14) | (((meshY * 36 + meshX) & 0x3ff) << 4) | (fn & 0xf);
}

export interface WorldEvFunctionSpec {
  id: number;
  code: WorldMnemonic[];
}

/** Assembliert eine Funktion zu Worten; Labels lokal, Ziele relativ zur Codebasis. */
function assembleFunction(spec: WorldEvFunctionSpec, startOffset: number): number[] {
  // Pass 1: Labelpositionen.
  const labels = new Map<string, number>();
  let pos = 0;
  for (const m of spec.code) {
    if (m.op === 'Label') {
      labels.set(m.name, startOffset + pos);
      continue;
    }
    pos += m.op in PUSH_WORDS || m.op === 'Goto' || m.op === 'GotoIfFalse' ? 2 : 1;
  }
  // Pass 2: Emission.
  const out: number[] = [];
  for (const m of spec.code) {
    switch (m.op) {
      case 'Label':
        break;
      case 'Goto':
      case 'GotoIfFalse': {
        const ziel = labels.get(m.label);
        if (ziel === undefined) throw new Error(`Label "${m.label}" unbekannt`);
        out.push(m.op === 'Goto' ? 0x200 : 0x201, ziel);
        break;
      }
      case 'PushConst':
        out.push(0x110, m.value & 0xffff);
        break;
      case 'Raw':
        out.push(m.word & 0xffff);
        break;
      default: {
        if (m.op in PUSH_WORDS) {
          out.push(PUSH_WORDS[m.op]!, (m as { addr: number }).addr & 0xffff);
        } else if (m.op in PLAIN_WORDS) {
          out.push(PLAIN_WORDS[m.op]!);
        } else {
          throw new Error(`Mnemonic ${String(m.op)} unbekannt`);
        }
      }
    }
  }
  if (out[out.length - 1] !== 0x203) {
    throw new Error(`Funktion 0x${spec.id.toString(16)} endet nicht mit Return`);
  }
  return out;
}

/**
 * Baut eine vollständige `.ev`-Datei (0x7000 B). Funktion 0 des Bestands ist
 * eine Leerfunktion (erstes Codewort = Return) — der Composer erzwingt
 * dasselbe Strukturmerkmal, indem er eine Leerfunktion voranstellt, wenn die
 * erste Spezifikation nicht bei Offset 0 mit Return beginnt.
 */
export function assembleWorldEv(functions: WorldEvFunctionSpec[]): Uint8Array {
  const bytes = new Uint8Array(0x7000);
  const view = new DataView(bytes.buffer);
  const sorted = [...functions].sort((a, b) => a.id - b.id);
  if (sorted.length > 255) throw new Error('höchstens 255 Funktionen (plus Sentinel)');
  // Leerfunktion am Codeanfang (Strukturmerkmal des Bestands).
  const code: number[] = [0x203];
  const eintraege: Array<{ id: number; offset: number }> = [];
  for (const spec of sorted) {
    const offset = code.length;
    eintraege.push({ id: spec.id, offset });
    code.push(...assembleFunction(spec, offset));
  }
  if (512 + code.length > 0x7000 / 2) throw new Error(`Code zu groß: ${code.length} Worte`);
  eintraege.forEach((e, i) => {
    view.setUint16(i * 4, e.id, true);
    view.setUint16(i * 4 + 2, e.offset, true);
  });
  view.setUint16(eintraege.length * 4, 0xffff, true);
  view.setUint16(eintraege.length * 4 + 2, 0, true);
  code.forEach((wort, i) => view.setUint16((512 + i) * 2, wort, true));
  return bytes;
}
