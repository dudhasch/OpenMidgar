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

/**
 * Aufruf-Familie: Opcode 0x204 + k ruft Funktion k; die Modellnummer kommt vom
 * STACK (1 Pop). GEMESSEN: alle im Bestand belegten Opcodes 0x20c–0x223 haben
 * Netto-Delta −1 (Stack-Bilanz, s. `world-cmd-probe`); die Zuordnung
 * „Funktionsnummer = Opcode − 0x204" ist Referenzangabe (🟡) und mit der
 * gemessenen Stelligkeit verträglich.
 */
export const WOP_CALL_BASE = 0x204;
export const WOP_CALL_LAST = 0x223;

/** Warte-Paar: 0x305 nimmt die Taktzahl, 0x306 hält an (🟡 Aufteilung, s. u.). */
export const WOP_WAIT_SET = 0x305;
export const WOP_WAIT = 0x306;

/**
 * Stelligkeit der Kommando-Opcodes — ABGELEITET AUS DEN DATEN, nicht geglaubt.
 *
 * Verfahren (world-cmd-probe, 2026-08-10): Der World-Bytecode zerfällt in
 * ANWEISUNGEN, die mit 0x100 (Stack-Reset) beginnen; jede Anweisung muss den
 * Stack byteexakt aufbrauchen (Tiefe 0 am Ende, nie negativ) — dasselbe
 * Accounting-Prinzip wie beim Terrainlayout. Über 2360 Anweisungen ergibt das
 * ein lineares Gleichungssystem in den Netto-Deltas; es ist WIDERSPRUCHSFREI
 * und bestimmt 92 von 96 freien Opcodes eindeutig (Kontrollen mit verschobener
 * Anweisungsgrenze: 110 bzw. 1833 Widersprüche). Die Pop-Zahl folgt danach aus
 * der Mindesttiefe vor dem Opcode; sie ist für 90/92 eindeutig.
 *
 * NICHT gemessen ist die BEDEUTUNG. Die Namen der Community-Quellen stehen
 * nur als Kommentar an den Stellen, wo die eigene Messung sie stützt.
 */
export const WORLD_CMD_POPS: ReadonlyMap<number, number> = new Map<number, number>([
  // Unäre Entfernungs-/Richtungsabfragen: Delta 0 gemessen, Pop 0 oder 1
  // (Mindesttiefe 1) — 1→1 übernommen (🟡, Referenz sagt 1 Pop).
  [0x18, 1], [0x19, 1], [0x1b, 1],
  [0x300, 1], [0x302, 0], [0x303, 1], [0x304, 1],
  // 0x305+0x306 zusammen GEMESSEN −1 (218 Anweisungen). Die Aufteilung ist
  // durch die Daten NICHT entscheidbar (beide treten nur als Paar auf);
  // 1/0 gewählt, weil die Referenz 0x306 als den ausführenden Warteopcode
  // führt. Die Referenzangabe „je 1 Pop" ist durch die Messung WIDERLEGT.
  [WOP_WAIT_SET, 1], [WOP_WAIT, 0],
  [0x307, 1], [0x308, 2], [0x309, 2], [0x30a, 1], [0x30b, 1], [0x30c, 0], [0x30d, 0],
  [0x30e, 2], [0x310, 2], [0x311, 2], [0x312, 2], [0x313, 3], [0x314, 2], [0x315, 3],
  [0x316, 3], [0x317, 1], [0x318, 2], [0x319, 1], [0x31b, 1], [0x31c, 1], [0x31d, 1],
  [0x31f, 1], [0x320, 0], [0x321, 1], [0x324, 4], [0x325, 1],
  // 0x326+0x327 zusammen GEMESSEN −3; Aufteilung 3/0 aus der Referenz, mit der
  // Messung verträglich (🟡).
  [0x326, 3], [0x327, 0],
  [0x328, 1], [0x329, 1], [0x32a, 1], [0x32b, 1], [0x32c, 2], [0x32d, 0], [0x32e, 0],
  [0x32f, 1], [0x330, 1], [0x331, 0], [0x332, 0], [0x333, 2], [0x334, 0], [0x336, 1],
  [0x339, 0], [0x33a, 1], [0x33b, 2], [0x33c, 0], [0x33d, 1], [0x33e, 1], [0x347, 1],
  [0x348, 2], [0x349, 1], [0x34a, 1], [0x34b, 1], [0x34c, 1], [0x34d, 3], [0x34e, 1],
  [0x34f, 1], [0x350, 1], [0x351, 1], [0x352, 1], [0x353, 2], [0x354, 1], [0x355, 1],
]);

/**
 * Opcodes, die ihr Ergebnis zurück auf den Stack legen (Delta 0 bei 1 Pop).
 * Alle übrigen Kommandos haben Push 0 — gemessen, nicht angenommen.
 */
export const WORLD_CMD_PUSHES: ReadonlySet<number> = new Set([0x18, 0x19, 0x1b]);

/**
 * 0x349 setzt den Weltfortschritt (Referenz: `set_world_progress`). GEMESSEN
 * im Bestand: der Opcode kommt ausschließlich in der Initialisierungsfunktion
 * vor und wird dort über eine MONOTONE Schwellenkaskade auf dem Savemap-Wort 0
 * belegt (≥638 → 1, ≥1000 → 2, ≥1197 → 3, ≥1199 → 3 oder 4); ohne Treffer
 * bleibt 0. Wertebereich also 0–4 = 5 Stufen.
 */
export const WOP_SET_WORLD_PROGRESS = 0x349;
export const WORLD_PROGRESS_MAX = 4;

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
