/**
 * `field.tbl` — die World→Field-Einstiegspunkte (F06).
 *
 * Fundort: Eintrag `field.tbl` im Archiv `world_us.lgp` (`data/wm`).
 *
 * 🟢 FORMATFAKT, an den Realdaten mit Kontrolle belegt
 * (`tools/realdata-scan/src/world-fieldtbl-probe.rdtest.ts`, 2026-08-11):
 *
 *  Accounting: Dateilänge 1536 B = 64 Datensätze × 24 B, Rest 0 (exakt).
 *  Datensatz = zwei Einträge à 12 B: Slot 0 „default", Slot 1 „alternative".
 *  Eintrag  = i16le x · i16le y · u16le triangle · u16le fieldId ·
 *             u8 direction · 3 B Padding.
 *
 *  Vier unabhängige Vorhersagen, je gegen eine Kontrolle gemessen
 *  (65 belegte Einträge von 128; 63 Slots sind vollständig genullt und aus
 *  allen Quoten herausgerechnet — Nullwert-Zweitrechnung, Regel 3):
 *
 *   K1 Richtungsbyte vierfach (Padding wiederholt die Richtung):
 *      65/65 = 100 %. Kontrolle „dieselbe Vierfachregel an den um 1..3 Byte
 *      verschobenen Positionen 5/6/7": 0/65, 0/65, 0/65.
 *   K2 `fieldId` löst über die `maplist` auf einen existierenden
 *      flevel-Eintrag auf: 65/65 = 100 %. Kontrolle „fieldId von der um
 *      −2/−1/+1/+2 B verschobenen Position": 22/65, 1/65, 0/65, 0/65.
 *      Zweitkontrolle „Zufalls-ID aus demselben Wertebereich": 58/65 — die
 *      `maplist` ist dicht belegt, diese Kontrolle trägt daher NICHT; die
 *      Verschiebungskontrolle und K4 tragen die Aussage.
 *   K3 `triangle` < Dreiecksanzahl im Walkmesh des Zielfeldes: 65/65.
 *      Kontrolle „permutierte Feldzuordnung": 54/65 (schwach, weil die
 *      Indizes klein sind). Ohne die Nullwerte (triangle = 0, 1 Fall):
 *      64/64 gegen 53/64.
 *   K4 **Die tragende Messung**: der Punkt (x, y) liegt IM Walkmesh-Dreieck
 *      `triangle` des über `fieldId` aufgelösten Feldes — das prüft alle vier
 *      Felder gemeinsam: 65/65 = 100 %. Kontrolle „derselbe Punkt gegen ein
 *      zufälliges anderes Dreieck desselben Feldes": **0/65 = 0 %**.
 *      Kontrolle „permutierte Feldzuordnung": 11/65 = 17 %.
 *
 *  Wertebereiche im Bestand: x −2019…5907, y −9530…3460, triangle 0…263,
 *  fieldId 70…744 (maplist hat 788 Einträge), direction 0…248.
 *  Slotbelegung: 58 default, 7 alternative; in 6 Datensätzen sind beide
 *  Einträge inhaltsgleich.
 *
 * 🟢 Der Skript-Opcode 0x318 nimmt Datensatznummer und Szenarioselektor
 *    (0 = default, 1 = alternative) vom Stack. Beides ist GEMESSEN, nicht
 *    übernommen (dieselbe Probe, Musterscan `PUSH a · PUSH b · 0x318` über
 *    wm0/wm2/wm3.ev — VOLLERHEBUNG: der Opcode kommt 89× vor und alle 89
 *    Stellen tragen beide Operanden als direkte Immediates):
 *     · Reihenfolge: `a` = Datensatz, `b` = Szenario. 89/89 haben b ∈ {0,1};
 *       die Vertauschungskontrolle erfüllt beide Bedingungen nur 1/89 mal und
 *       trifft 0/89 belegte Slots.
 *     · **Die Datensatznummer ist 1-BASIERT.** Wertebereich im Bestand exakt
 *       1…64. 1-basiert (`record = a − 1`) treffen 89/89 einen BELEGTEN Slot,
 *       0-basiert nur 75/89 — und bei Szenario 1 sogar 9/9 gegen 0/9. Das ist
 *       der schärfste Diskriminator: es gibt nur 7 belegte alternative Slots,
 *       zufällige Treffer sind praktisch ausgeschlossen.
 *    Deshalb: `fieldTblEntryForOpcode()` für den VM-Pfad, `fieldTblEntry()`
 *    für den 0-basierten Tabellenzugriff.
 * 🔴 Offen: `direction` ist eine 256er-Richtung (Wertebereich passt), aber
 *    ihr Nullpunkt/Drehsinn im Field-Raum ist nicht gemessen.
 */

export const FIELD_TBL_RECORD_COUNT = 64;
export const FIELD_TBL_ENTRY_BYTES = 12;
export const FIELD_TBL_RECORD_BYTES = FIELD_TBL_ENTRY_BYTES * 2;
export const FIELD_TBL_BYTES = FIELD_TBL_RECORD_COUNT * FIELD_TBL_RECORD_BYTES; // 0x600

/** Szenarioselektor des Opcodes 0x318. */
export type FieldTblScenario = 0 | 1;

export interface FieldEntryPoint {
  /** Ankunftskoordinate im Grundriss des Zielfelds (i16). */
  x: number;
  y: number;
  /** Dreiecksindex im Walkmesh des Zielfelds. */
  triangle: number;
  /** Index in die `maplist` — derselbe Namensraum wie ein Gateway-Ziel (S11). */
  fieldId: number;
  /** 256er-Richtung (🔴 Nullpunkt ungemessen). */
  direction: number;
  /** true, wenn alle 12 Byte des Eintrags null sind (unbelegter Slot). */
  empty: boolean;
  /**
   * true, wenn die drei Padding-Bytes die Richtung wiederholen (K1). Im
   * Bestand 65/65 bei den belegten Einträgen — ein Eintrag OHNE diese
   * Wiederholung ist ein Hinweis auf eine Fehldeutung oder eine Fremddatei.
   */
  directionRepeated: boolean;
}

export interface FieldTblRecord {
  index: number;
  /** Slot 0. */
  default: FieldEntryPoint;
  /** Slot 1. */
  alternative: FieldEntryPoint;
}

export type FieldTblDiagnosticCode = 'E-FTBL-SIZE' | 'W-FTBL-DIRPAD';

export interface FieldTblDiagnostic {
  code: FieldTblDiagnosticCode;
  record?: number;
  scenario?: FieldTblScenario;
  message: string;
}

export interface FieldTable {
  schemaVersion: 1;
  records: FieldTblRecord[];
  diagnostics: FieldTblDiagnostic[];
}

function leseEintrag(view: DataView, base: number): FieldEntryPoint {
  let empty = true;
  for (let i = 0; i < FIELD_TBL_ENTRY_BYTES; i++) {
    if (view.getUint8(base + i) !== 0) {
      empty = false;
      break;
    }
  }
  const direction = view.getUint8(base + 8);
  const directionRepeated =
    view.getUint8(base + 9) === direction &&
    view.getUint8(base + 10) === direction &&
    view.getUint8(base + 11) === direction;
  return {
    x: view.getInt16(base, true),
    y: view.getInt16(base + 2, true),
    triangle: view.getUint16(base + 4, true),
    fieldId: view.getUint16(base + 6, true),
    direction,
    empty,
    directionRepeated,
  };
}

/**
 * Parst `field.tbl`. Degradierungshaltung wie im Field-Container: eine
 * abweichende Länge ist eine DIAGNOSE, kein Abbruch — es werden so viele
 * vollständige Datensätze gelesen, wie die Datei hergibt.
 */
export function parseFieldTbl(bytes: Uint8Array): FieldTable {
  const diagnostics: FieldTblDiagnostic[] = [];
  const rest = bytes.length % FIELD_TBL_RECORD_BYTES;
  const vorhanden = (bytes.length - rest) / FIELD_TBL_RECORD_BYTES;
  if (bytes.length !== FIELD_TBL_BYTES) {
    diagnostics.push({
      code: 'E-FTBL-SIZE',
      message:
        `Länge ${bytes.length} B ≠ ${FIELD_TBL_BYTES} B ` +
        `(${FIELD_TBL_RECORD_COUNT} × ${FIELD_TBL_RECORD_BYTES}); ${vorhanden} Datensätze gelesen, Rest ${rest} B`,
    });
  }
  const anzahl = Math.min(vorhanden, FIELD_TBL_RECORD_COUNT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: FieldTblRecord[] = [];
  for (let r = 0; r < anzahl; r++) {
    const base = r * FIELD_TBL_RECORD_BYTES;
    const rec: FieldTblRecord = {
      index: r,
      default: leseEintrag(view, base),
      alternative: leseEintrag(view, base + FIELD_TBL_ENTRY_BYTES),
    };
    for (const scenario of [0, 1] as const) {
      const e = scenario === 0 ? rec.default : rec.alternative;
      if (!e.empty && !e.directionRepeated) {
        diagnostics.push({
          code: 'W-FTBL-DIRPAD',
          record: r,
          scenario,
          message: 'Padding wiederholt die Richtung nicht (im Bestand 65/65 — Layoutverdacht)',
        });
      }
    }
    records.push(rec);
  }
  return { schemaVersion: 1, records, diagnostics };
}

/**
 * Einstiegspunkt zu Datensatznummer + Szenario (die beiden Stackwerte des
 * Opcodes 0x318). `null`, wenn die Nummer außerhalb liegt oder der Slot leer
 * ist — beides kommt im Bestand vor (63 der 128 Slots sind genullt) und ist
 * eine Sackgasse, kein Fehler.
 */
export function fieldTblEntry(
  table: FieldTable,
  record: number,
  scenario: FieldTblScenario = 0,
): FieldEntryPoint | null {
  const rec = table.records[record];
  if (!rec) return null;
  const e = scenario === 1 ? rec.alternative : rec.default;
  return e.empty ? null : e;
}

/**
 * Einstiegspunkt zu den beiden Stackwerten des Opcodes 0x318. Die
 * Datensatznummer ist 🟢 GEMESSEN 1-basiert (89/89 belegte Slots gegen 75/89
 * bei 0-basiert; bei Szenario 1: 9/9 gegen 0/9). Gültig sind 1…64.
 */
export function fieldTblEntryForOpcode(
  table: FieldTable,
  recordOneBased: number,
  scenario: FieldTblScenario = 0,
): FieldEntryPoint | null {
  if (recordOneBased < 1 || recordOneBased > FIELD_TBL_RECORD_COUNT) return null;
  return fieldTblEntry(table, recordOneBased - 1, scenario);
}

/**
 * Fällt ein leerer „alternative"-Slot auf „default" zurück? Das ist NICHT
 * gemessen (🔴) — die Engine könnte auch gar nichts tun. Deshalb ist der
 * Rückfall eine ausdrücklich aufrufbare Funktion und KEIN Verhalten von
 * `fieldTblEntry`.
 */
export function fieldTblEntryWithFallback(
  table: FieldTable,
  record: number,
  scenario: FieldTblScenario = 0,
): FieldEntryPoint | null {
  return fieldTblEntry(table, record, scenario) ?? (scenario === 1 ? fieldTblEntry(table, record, 0) : null);
}
