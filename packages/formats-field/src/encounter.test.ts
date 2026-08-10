import { describe, expect, it } from 'vitest';
import { composeCompressedField, composeEncounterSection, composeFieldContainer } from '@webmidgar/fixture-gen';
import { parseFieldContainer, parseFieldEntry } from './container.js';
import {
  ENC_PROB_SUM,
  ENC_SECTION_LEN,
  ENC_SPECIAL_ROLE,
  ENC_TABLE_LEN,
  parseEncounterSection,
  selectSpecialEncounter,
  selectStandardEncounter,
  splitFormationId,
} from './sections/encounter.js';
import { SECTION } from './nam.js';
import type { FieldDiagnostic } from './diagnostics.js';

/**
 * O3b: Encounter-Sektion (Sektion 7) — Roundtrip über zwei unabhängige
 * Implementierungen (Composer im `fixture-gen` rechnet die 6/10-Teilung
 * selbst) plus die Defektfälle der Validierungsmatrix.
 */

const diag = (): FieldDiagnostic[] => [];

/** Belegte Tabelle, deren Standardanteile sich wie im Original auf 64 summieren. */
const vollstaendig = (): Parameters<typeof composeEncounterSection>[0] => ({
  tables: [
    {
      rate: 48,
      standard: [
        [20, 300],
        [16, 301],
        [12, 302],
        [8, 303],
        [4, 304],
        [4, 305],
      ],
      special: [
        [2, 400],
        [2, 401],
        [0, 0],
        [4, 402],
      ],
    },
    // Zwei Slots sind das Minimum: 6 Bit fassen höchstens 63, die Summe muss
    // 64 sein — eine Tabelle mit nur EINEM Standardkampf ist unmöglich.
    // (Realdaten bestätigen: Slot 0 und 1 sind in 197/197 Tabellen belegt.)
    { rate: 72, standard: [[63, 512], [1, 513]] },
  ],
});

describe('Encounter-Sektion (Sektion 7)', () => {
  it('liest die 2×24-B-Tabellen byteexakt zurück', () => {
    const bytes = composeEncounterSection(vollstaendig());
    expect(bytes.length).toBe(ENC_SECTION_LEN);
    const d = diag();
    const enc = parseEncounterSection(bytes, 'fixture', d)!;
    expect(d).toEqual([]);

    const t0 = enc.tables[0];
    expect(t0.enabled).toBe(true);
    expect(t0.rate).toBe(48);
    expect(t0.padding).toBe(0);
    expect(t0.standard.map((s) => s.formationId)).toEqual([300, 301, 302, 303, 304, 305]);
    expect(t0.standard.map((s) => s.probability)).toEqual([20, 16, 12, 8, 4, 4]);
    expect(t0.probabilitySum).toBe(ENC_PROB_SUM);
    expect(t0.special.map((s) => s.formationId)).toEqual([400, 401, 0, 402]);
    expect(t0.special.map((s) => s.probability)).toEqual([2, 2, 0, 4]);

    const t1 = enc.tables[1];
    expect(t1.enabled).toBe(true);
    expect(t1.rate).toBe(72);
    expect(t1.standard[0]!.formationId).toBe(512);
    expect(t1.standard[0]!.probability).toBe(63);
    expect(t1.probabilitySum).toBe(ENC_PROB_SUM);
    // Ungenutzte Slots bleiben roh 0 — das ist das Belegungsmerkmal.
    expect(t1.standard.slice(2).every((s) => s.raw === 0)).toBe(true);
  });

  it('trennt Wahrscheinlichkeit (obere 6 Bit) und ID (untere 10) verlustfrei', () => {
    // Grenzfall: maximale ID (1023) mit maximalem Anteil (63) im selben Wort.
    const bytes = composeEncounterSection({ tables: [{ standard: [[63, 1023]] }] });
    const slot = parseEncounterSection(bytes, 'fixture', diag())!.tables[0].standard[0]!;
    expect(slot.raw).toBe(0xffff);
    expect(slot.probability).toBe(63);
    expect(slot.formationId).toBe(1023);
  });

  it('meldet eine genullte Tabelle als deaktiviert, ohne Diagnose', () => {
    const d = diag();
    const enc = parseEncounterSection(composeEncounterSection(), 'fixture', d)!;
    expect(d).toEqual([]);
    expect(enc.tables.map((t) => t.enabled)).toEqual([false, false]);
    expect(enc.tables[0].probabilitySum).toBe(0);
  });

  it('quarantänisiert eine Sektion mit falscher Länge (E-ENC-SIZE)', () => {
    const d = diag();
    expect(parseEncounterSection(new Uint8Array(ENC_TABLE_LEN), 'fixture', d)).toBeNull();
    expect(d.map((x) => x.code)).toEqual(['E-ENC-SIZE']);
    expect(d[0]!.section).toBe(SECTION.ENCOUNTER);
    expect(d[0]!.severity).toBe('error');
  });

  it('warnt bei gebrochener Summenregel, ohne die Sektion zu verwerfen', () => {
    const d = diag();
    const enc = parseEncounterSection(
      composeEncounterSection({ tables: [{ standard: [[32, 300]] }] }),
      'fixture',
      d,
    )!;
    expect(d.map((x) => x.code)).toEqual(['W-ENC-PROBSUM']);
    expect(d[0]!.severity).toBe('warning');
    expect(enc.tables[0].probabilitySum).toBe(32);
    expect(enc.tables[0].enabled).toBe(true);
  });

  it('warnt bei nicht genulltem Padding und widersprüchlichem enabled', () => {
    const d1 = diag();
    const gutMitPad: Parameters<typeof composeEncounterSection>[0] = {
      tables: [{ standard: [[32, 300], [32, 301]], padding: 7 }],
    };
    parseEncounterSection(composeEncounterSection(gutMitPad), 'fixture', d1);
    expect(d1.map((x) => x.code)).toEqual(['W-ENC-PAD']);

    const d2 = diag();
    // enabled == 0, aber die Tabelle trägt Inhalt.
    parseEncounterSection(
      composeEncounterSection({ tables: [{ enabled: 0, standard: [[32, 300], [32, 301]] }] }),
      'fixture',
      d2,
    );
    expect(d2.map((x) => x.code)).toEqual(['W-ENC-FLAG']);

    const d3 = diag();
    // enabled == 5: unzulässiger Flagwert UND Widerspruch zum leeren Inhalt.
    parseEncounterSection(composeEncounterSection({ tables: [{ enabled: 5 }] }), 'fixture', d3);
    expect(d3.map((x) => x.code)).toEqual(['W-ENC-FLAG', 'W-ENC-PROBSUM']);
  });

  it('zieht Standardkämpfe nach der kumulierten 64er-Verteilung', () => {
    const table = parseEncounterSection(composeEncounterSection(vollstaendig()), 'fixture', diag())!.tables[0];
    // Slotgrenzen: 0..19 → 300, 20..35 → 301, 36..47 → 302, 48..55 → 303,
    // 56..59 → 304, 60..63 → 305.
    expect(selectStandardEncounter(table, 0)!.formationId).toBe(300);
    expect(selectStandardEncounter(table, 19)!.formationId).toBe(300);
    expect(selectStandardEncounter(table, 20)!.formationId).toBe(301);
    expect(selectStandardEncounter(table, 47)!.formationId).toBe(302);
    expect(selectStandardEncounter(table, 63)!.formationId).toBe(305);
    // Jeder Wurf in [0,64) trifft genau einen Slot — die Summenregel garantiert
    // eine lückenlose Überdeckung.
    const treffer = new Set<number>();
    for (let roll = 0; roll < ENC_PROB_SUM; roll++) treffer.add(selectStandardEncounter(table, roll)!.formationId);
    expect([...treffer].sort((a, b) => a - b)).toEqual([300, 301, 302, 303, 304, 305]);
    // Außerhalb des Wurfbereichs und bei deaktivierter Tabelle: null.
    expect(selectStandardEncounter(table, 64)).toBeNull();
    expect(selectStandardEncounter(table, -1)).toBeNull();
    const leer = parseEncounterSection(composeEncounterSection(), 'fixture', diag())!.tables[0];
    expect(selectStandardEncounter(leer, 0)).toBeNull();
  });

  it('prüft Sonderanflüge slotweise gegen ihren absoluten Anteil', () => {
    const table = parseEncounterSection(composeEncounterSection(vollstaendig()), 'fixture', diag())!.tables[0];
    expect(selectSpecialEncounter(table, 0, 1)!.formationId).toBe(400);
    expect(selectSpecialEncounter(table, 0, 2)).toBeNull();
    expect(selectSpecialEncounter(table, 3, 3)!.formationId).toBe(402);
    // Slot 2 ist ungenutzt (raw == 0) — er darf nie ziehen.
    expect(selectSpecialEncounter(table, 2, 0)).toBeNull();
    expect(ENC_SPECIAL_ROLE.length).toBe(4);
  });

  it('zerlegt die Formations-ID in Szene und Formationsindex', () => {
    expect(splitFormationId(0)).toEqual({ scene: 0, formation: 0 });
    expect(splitFormationId(979)).toEqual({ scene: 244, formation: 3 });
    expect(splitFormationId(256)).toEqual({ scene: 64, formation: 0 });
  });

  it('hängt die Sektion ins Bundle und quarantänisiert nur sie bei Defekt', () => {
    const gut = parseFieldContainer(
      composeFieldContainer({ sections: { [SECTION.ENCOUNTER]: composeEncounterSection(vollstaendig()) } }).bytes,
      'gut',
    );
    expect(gut.ok).toBe(true);
    expect(gut.bundle!.quarantinedSections).not.toContain(SECTION.ENCOUNTER);
    expect(gut.bundle!.encounters!.tables[0].standard[0]!.formationId).toBe(300);

    const kaputt = parseFieldContainer(
      composeFieldContainer({ sections: { [SECTION.ENCOUNTER]: new Uint8Array(40) } }).bytes,
      'kaputt',
    );
    expect(kaputt.ok).toBe(true);
    expect(kaputt.bundle!.encounters).toBeUndefined();
    expect(kaputt.bundle!.quarantinedSections).toContain(SECTION.ENCOUNTER);
    expect(kaputt.diagnostics.map((x) => x.code)).toContain('E-ENC-SIZE');
    // Der Rest des Bundles bleibt nutzbar — Quarantäne statt Abbruch.
    expect(kaputt.bundle!.palette).toBeDefined();
  });

  it('überlebt den kompletten LZS-Eintragspfad', () => {
    const entry = composeCompressedField({
      sections: { [SECTION.ENCOUNTER]: composeEncounterSection(vollstaendig()) },
    });
    const parsed = parseFieldEntry(entry, 'lzs');
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle!.encounters!.tables[1].rate).toBe(72);
  });
});
