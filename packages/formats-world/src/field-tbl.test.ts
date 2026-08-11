import { describe, expect, it } from 'vitest';
import { composeFieldTbl, FIXTURE_FIELD_TBL_BYTES } from '@webmidgar/fixture-gen';
import {
  FIELD_TBL_BYTES,
  FIELD_TBL_RECORD_BYTES,
  FIELD_TBL_RECORD_COUNT,
  fieldTblEntry,
  fieldTblEntryForOpcode,
  fieldTblEntryWithFallback,
  parseFieldTbl,
} from './field-tbl.js';

/**
 * F06 — `field.tbl`. Die Fixtures kommen aus dem Composer (Zweitimplementierung),
 * die Realdatenbelege stehen im Kopfkommentar von `field-tbl.ts`; hier wird das
 * Verhalten des Parsers verriegelt, nicht die Formatfrage entschieden.
 */

describe('parseFieldTbl (F06)', () => {
  it('Accounting: 64 × 24 B = 0x600, Composer und Parser stimmen überein', () => {
    expect(FIELD_TBL_BYTES).toBe(0x600);
    expect(FIELD_TBL_RECORD_COUNT * FIELD_TBL_RECORD_BYTES).toBe(FIELD_TBL_BYTES);
    expect(FIXTURE_FIELD_TBL_BYTES).toBe(FIELD_TBL_BYTES);
    const t = parseFieldTbl(composeFieldTbl([]));
    expect(t.diagnostics).toEqual([]);
    expect(t.records).toHaveLength(64);
    expect(t.records.every((r) => r.default.empty && r.alternative.empty)).toBe(true);
  });

  it('liest beide Szenarien eines Datensatzes getrennt', () => {
    const bytes = composeFieldTbl([
      {
        index: 3,
        default: { x: -100, y: 250, triangle: 7, fieldId: 116, direction: 64 },
        alternative: { x: 900, y: -9000, triangle: 63, fieldId: 300, direction: 248 },
      },
    ]);
    const t = parseFieldTbl(bytes);
    expect(t.diagnostics).toEqual([]);
    const d = fieldTblEntry(t, 3, 0)!;
    expect(d).toMatchObject({ x: -100, y: 250, triangle: 7, fieldId: 116, direction: 64, empty: false });
    const a = fieldTblEntry(t, 3, 1)!;
    expect(a).toMatchObject({ x: 900, y: -9000, triangle: 63, fieldId: 300, direction: 248 });
    // Nachbardatensätze bleiben leer — kein Überlesen der 24-B-Grenze.
    expect(fieldTblEntry(t, 2, 0)).toBeNull();
    expect(fieldTblEntry(t, 4, 0)).toBeNull();
  });

  it('Vierfachregel des Richtungsbytes: erkannt und bei Verletzung diagnostiziert', () => {
    const gut = parseFieldTbl(
      composeFieldTbl([{ index: 0, default: { x: 1, y: 2, triangle: 3, fieldId: 4, direction: 200 } }]),
    );
    expect(gut.records[0]!.default.directionRepeated).toBe(true);
    expect(gut.diagnostics).toEqual([]);

    const kaputt = parseFieldTbl(
      composeFieldTbl([
        { index: 0, default: { x: 1, y: 2, triangle: 3, fieldId: 4, direction: 200, brokenDirPad: true } },
      ]),
    );
    expect(kaputt.records[0]!.default.directionRepeated).toBe(false);
    expect(kaputt.diagnostics).toEqual([
      { code: 'W-FTBL-DIRPAD', record: 0, scenario: 0, message: expect.stringContaining('Padding') },
    ]);
    // Richtung 0 mit „kaputtem" Padding ist NICHT unterscheidbar (alles null)
    // — und der Eintrag ist dann ohnehin leer. Nullwert-Zweitrechnung.
    const nullFall = parseFieldTbl(
      composeFieldTbl([
        { index: 1, default: { x: 0, y: 0, triangle: 0, fieldId: 0, direction: 0, brokenDirPad: true } },
      ]),
    );
    expect(nullFall.records[1]!.default.empty).toBe(true);
    expect(nullFall.diagnostics).toEqual([]);
  });

  it('0x318-Zugriff ist 1-basiert (gemessen), Tabellenzugriff 0-basiert', () => {
    const t = parseFieldTbl(
      composeFieldTbl([{ index: 0, default: { x: 5, y: 6, triangle: 1, fieldId: 70, direction: 0 } }]),
    );
    expect(fieldTblEntry(t, 0, 0)?.fieldId).toBe(70);
    expect(fieldTblEntryForOpcode(t, 1, 0)?.fieldId).toBe(70);
    // 0 und 65 liegen außerhalb des gemessenen Wertebereichs 1…64.
    expect(fieldTblEntryForOpcode(t, 0, 0)).toBeNull();
    expect(fieldTblEntryForOpcode(t, 65, 0)).toBeNull();
  });

  it('leerer Slot ist eine Sackgasse; der Rückfall auf default ist ausdrücklich', () => {
    const t = parseFieldTbl(
      composeFieldTbl([{ index: 9, default: { x: 1, y: 1, triangle: 0, fieldId: 200, direction: 0 } }]),
    );
    expect(fieldTblEntry(t, 9, 1)).toBeNull();
    expect(fieldTblEntryWithFallback(t, 9, 1)?.fieldId).toBe(200);
    expect(fieldTblEntryWithFallback(t, 60, 1)).toBeNull();
  });

  it('abweichende Länge: Diagnose statt Abbruch, vollständige Datensätze bleiben lesbar', () => {
    const voll = composeFieldTbl([{ index: 1, default: { x: 7, y: 8, triangle: 2, fieldId: 90, direction: 16 } }]);
    const kurz = voll.subarray(0, 5 * FIELD_TBL_RECORD_BYTES + 7);
    const t = parseFieldTbl(kurz);
    expect(t.records).toHaveLength(5);
    expect(t.diagnostics.map((d) => d.code)).toEqual(['E-FTBL-SIZE']);
    expect(t.diagnostics[0]!.message).toContain('Rest 7 B');
    expect(fieldTblEntry(t, 1, 0)?.fieldId).toBe(90);
  });
});
