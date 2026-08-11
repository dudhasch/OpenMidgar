/**
 * `field.tbl`-Composer (F06) — Zweitimplementierung des Layouts für Golden
 * Fixtures, bewusst codegetrennt vom Parser in `formats-world`.
 *
 * Layout (realdaten-belegt, s. `packages/formats-world/src/field-tbl.ts`):
 * 64 Datensätze à 24 B = 2 Einträge à 12 B; Eintrag = i16 x · i16 y ·
 * u16 triangle · u16 fieldId · u8 direction · 3 B Padding, wobei das Padding
 * die Richtung wiederholt (im Bestand 65/65). Der Composer schreibt die
 * Wiederholung standardmäßig mit; `brokenDirPad` erzeugt bewusst eine Datei,
 * die die Vorhersage VERLETZT — dafür gibt es einen Negativtest.
 */

export const FIXTURE_FIELD_TBL_RECORDS = 64;
export const FIXTURE_FIELD_TBL_RECORD_BYTES = 24;
export const FIXTURE_FIELD_TBL_BYTES = FIXTURE_FIELD_TBL_RECORDS * FIXTURE_FIELD_TBL_RECORD_BYTES;

export interface FieldTblEntrySpec {
  x: number;
  y: number;
  triangle: number;
  fieldId: number;
  direction: number;
  /** Padding NICHT als Richtungswiederholung schreiben (Negativfall). */
  brokenDirPad?: boolean;
}

export interface FieldTblRecordSpec {
  index: number;
  default?: FieldTblEntrySpec;
  alternative?: FieldTblEntrySpec;
}

function schreibeEintrag(view: DataView, base: number, spec: FieldTblEntrySpec): void {
  view.setInt16(base, spec.x, true);
  view.setInt16(base + 2, spec.y, true);
  view.setUint16(base + 4, spec.triangle, true);
  view.setUint16(base + 6, spec.fieldId, true);
  view.setUint8(base + 8, spec.direction & 0xff);
  const pad = spec.brokenDirPad ? 0 : spec.direction & 0xff;
  view.setUint8(base + 9, pad);
  view.setUint8(base + 10, pad);
  view.setUint8(base + 11, pad);
}

/** Baut eine vollständige `field.tbl`; nicht genannte Slots bleiben genullt. */
export function composeFieldTbl(records: FieldTblRecordSpec[], recordCount = FIXTURE_FIELD_TBL_RECORDS): Uint8Array {
  const bytes = new Uint8Array(recordCount * FIXTURE_FIELD_TBL_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (const rec of records) {
    if (rec.index < 0 || rec.index >= recordCount) throw new Error(`Datensatz ${rec.index} außerhalb 0..${recordCount - 1}`);
    const base = rec.index * FIXTURE_FIELD_TBL_RECORD_BYTES;
    if (rec.default) schreibeEintrag(view, base, rec.default);
    if (rec.alternative) schreibeEintrag(view, base + 12, rec.alternative);
  }
  return bytes;
}
