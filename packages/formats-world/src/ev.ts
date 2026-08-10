/**
 * `.ev`-Parser (S29) — World-Script-Container. Alle Grenzen realdaten-belegt
 * (world-ev-probe, 2026-08-10): Datei fix 0x7000 B, Call-Tabelle fix 0x400 B
 * (bis 256 Paare u16-Kennung + u16-Wortoffset relativ zu Wort 512, Sentinel
 * 0xFFFF), Kennungstyp in Bits 14–15, Funktions-Abschluss 175/175 mit der
 * Operandentabelle unten, Sprungziele 732/732 codebasis-relativ auf
 * Instruktionsgrenzen.
 */

export const EV_FILE_BYTES = 0x7000;
export const EV_CODE_BASE_WORDS = 512;
export const EV_TABLE_SENTINEL = 0xffff;

/** Return beendet eine Funktion (Formatfakt: 175/175 Funktionen schließen). */
export const WOP_RETURN = 0x203;
export const WOP_RESET = 0x100;
export const WOP_GOTO = 0x200;
export const WOP_GOTO_IF_FALSE = 0x201;

/**
 * Opcodes mit genau einem Operandenwort — GEMESSEN über den Funktions-
 * Abschluss + Sprungbeweis; alle übrigen beobachteten Opcodes tragen keins.
 */
export const WOP_OPERAND1: ReadonlySet<number> = new Set([
  0x110, 0x114, 0x117, 0x118, 0x119, 0x11b, 0x11c, 0x11d, 0x11f, WOP_GOTO, WOP_GOTO_IF_FALSE,
]);

export type EvFunctionType = 'system' | 'model' | 'mesh';

export interface EvFunction {
  /** Rohe Kennung aus der Tabelle. */
  id: number;
  type: EvFunctionType;
  /** system: Funktionsnummer; model: Funktionsnummer je Modell; mesh: Nummer im Mesh. */
  functionId: number;
  /** Nur type=model: Modellnummer (Bits 8–13). */
  modelId?: number;
  /**
   * Nur type=mesh. Kodierung (Kennung >> 4) & 0x3FF = zeile·36 + spalte —
   * REALDATEN-ENTSCHIEDEN gegen die Community-Beschreibung („x = div 36"):
   * mit spalte = mod 36 passen 49/49 wm0-Funktionen ins 36×28-Raster, mit
   * der beschriebenen Deutung nur 46/49 (world-vehicle-probe).
   */
  meshX?: number;
  meshY?: number;
  /** Wortoffset des Codes relativ zu EV_CODE_BASE_WORDS. */
  offset: number;
  /** Exklusives Codeende (Wortoffset der nächsten Funktion bzw. Codeende). */
  end: number;
}

export interface EvDiagnostic {
  code: 'E-EV-SIZE' | 'E-EV-TABLE';
  message: string;
}

export interface WorldEv {
  functions: EvFunction[];
  /** Codebereich als u16-Worte (ab EV_CODE_BASE_WORDS). */
  code: Uint16Array;
  diagnostics: EvDiagnostic[];
}

export function parseWorldEv(bytes: Uint8Array): WorldEv {
  const diagnostics: EvDiagnostic[] = [];
  if (bytes.length !== EV_FILE_BYTES) {
    // Kein harter Abbruch: die feste Größe ist im Bestand 3/3, aber Fixtures
    // dürfen kleiner sein — gemeldet wird trotzdem.
    diagnostics.push({ code: 'E-EV-SIZE', message: `Dateigröße ${bytes.length} ≠ ${EV_FILE_BYTES}` });
  }
  if (bytes.length < EV_CODE_BASE_WORDS * 2 || bytes.length % 2 !== 0) {
    return { functions: [], code: new Uint16Array(0), diagnostics: [{ code: 'E-EV-TABLE', message: 'Datei kürzer als die Call-Tabelle oder ungerade' }] };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const worte = bytes.length / 2;
  const codeWorte = worte - EV_CODE_BASE_WORDS;
  const roh: Array<{ id: number; offset: number }> = [];
  for (let w = 0; w + 1 < EV_CODE_BASE_WORDS && roh.length < 256; w += 2) {
    const id = view.getUint16(w * 2, true);
    if (id === EV_TABLE_SENTINEL) break;
    roh.push({ id, offset: view.getUint16(w * 2 + 2, true) });
  }
  for (const p of roh) {
    if (p.offset >= codeWorte) {
      diagnostics.push({ code: 'E-EV-TABLE', message: `Funktionsoffset ${p.offset} außerhalb des Codes (${codeWorte})` });
    }
  }
  const starts = [...new Set(roh.map((p) => p.offset))].sort((a, b) => a - b);
  const endOf = new Map<number, number>();
  starts.forEach((s, i) => endOf.set(s, i + 1 < starts.length ? starts[i + 1]! : codeWorte));
  const functions: EvFunction[] = roh
    .filter((p) => p.offset < codeWorte)
    .map((p) => {
      const typBits = p.id >> 14;
      const base = { id: p.id, offset: p.offset, end: endOf.get(p.offset)! };
      if (typBits === 0) return { ...base, type: 'system' as const, functionId: p.id & 0xff };
      if (typBits === 1) {
        return { ...base, type: 'model' as const, functionId: p.id & 0xff, modelId: (p.id >> 8) & 0x3f };
      }
      const meshCoords = (p.id >> 4) & 0x3ff;
      return {
        ...base,
        type: 'mesh' as const,
        functionId: p.id & 0xf,
        meshX: meshCoords % 36,
        meshY: Math.floor(meshCoords / 36),
      };
    });
  const code = new Uint16Array(codeWorte);
  for (let i = 0; i < codeWorte; i++) code[i] = view.getUint16((EV_CODE_BASE_WORDS + i) * 2, true);
  return { functions, code, diagnostics };
}
