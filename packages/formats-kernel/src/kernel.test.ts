import { describe, expect, it } from 'vitest';
import { composeKernelContainer, composeRecordSection, composeTextSection } from '@webmidgar/fixture-gen';
import { parseKernelContainer } from './container.js';
import {
  decodeRestrictions,
  readAccessoryRecords,
  readArmorRecords,
  readItemRecords,
  readMateriaRecords,
  readWeaponRecords,
  resolveKernelDataSections,
} from './data-records.js';
import {
  DEFAULT_ASCII_OFFSET,
  buildAsciiTable,
  decodeFfText,
  decodeStringTable,
  germanLikeness,
} from './text.js';

/** S13: Kernel-Container und Textdekoder — Roundtrips über zwei Implementierungen. */

describe('Kernel-Container: Kopfauslegung u16-triple', () => {
  it('Roundtrip: drei Sektionen, Layout erkannt, Daten byteidentisch, keine Diagnosen', async () => {
    const sec0 = new Uint8Array([1, 2, 3, 4, 5]);
    const sec1 = new Uint8Array([9, 8, 7]);
    const sec2 = Uint8Array.from({ length: 64 }, (_, i) => (i * 3 + 1) & 0xff);

    const bytes = await composeKernelContainer(
      [{ data: sec0 }, { data: sec1 }, { data: sec2 }],
      'u16-triple',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container).not.toBeNull();
    expect(container.layout).toBe('u16-triple');
    expect(container.sections).toHaveLength(3);
    expect(container.diagnostics).toEqual([]);
    expect(container.sections.every((s) => s.ok)).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect([...container.sections[1]!.data]).toEqual([...sec1]);
    expect([...container.sections[2]!.data]).toEqual([...sec2]);
  });
});

describe('Kernel-Container: Kopfauslegung u32-len', () => {
  it('Roundtrip: drei Sektionen, Layout selbst erkannt, Daten byteidentisch, keine Diagnosen', async () => {
    // sec1 muss inkompressibel und > 64 KiB entpackt sein: erst dann trägt der
    // gzip-Strom mehr als 0xFFFF komprimierte Bytes, und die u16-triple-Lesart
    // (die nur die unteren 16 Bit des u32-Feldes sähe) läuft nicht mehr
    // byteexakt aus. Bei kleineren Sektionen sind beide Kopfauslegungen
    // bitidentisch interpretierbar — echte Mehrdeutigkeit, kein Kopf-Bug.
    let seed = 0x9e3779b9;
    const prng = () => {
      seed = (seed ^ (seed << 13)) >>> 0;
      seed = (seed ^ (seed >>> 17)) >>> 0;
      seed = (seed ^ (seed << 5)) >>> 0;
      return seed;
    };
    const sec0 = new Uint8Array([11, 22, 33]);
    const sec1 = Uint8Array.from({ length: 80_000 }, () => prng() & 0xff);
    const sec2 = new Uint8Array([255, 0, 128, 64]);

    const bytes = await composeKernelContainer(
      [{ data: sec0 }, { data: sec1 }, { data: sec2 }],
      'u32-len',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container).not.toBeNull();
    expect(container.layout).toBe('u32-len');
    expect(container.sections).toHaveLength(3);
    expect(container.diagnostics).toEqual([]);
    expect(container.sections.every((s) => s.ok)).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect([...container.sections[1]!.data]).toEqual([...sec1]);
    expect([...container.sections[2]!.data]).toEqual([...sec2]);
  });
});

describe('Kernel-Container: Kopf-/Strom-Defekte', () => {
  it('E-KRN-GZIP bei falscher entpackter Länge im Kopf — Nutzdaten kommen trotzdem korrekt an', async () => {
    const sec0 = new Uint8Array([4, 5, 6, 7]);
    const bytes = await composeKernelContainer(
      [{ data: sec0, declaredLengthOverride: 999 }],
      'u16-triple',
    );
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toHaveLength(1);
    expect(container.sections[0]!.ok).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...sec0]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-GZIP');
  });

  it('defekter gzip-Strom quarantänisiert nur die betroffene Sektion, die übrigen bleiben nutzbar', async () => {
    const secA = new Uint8Array([1, 2, 3]);
    const secB = Uint8Array.from({ length: 80 }, (_, i) => (i * 7 + 1) & 0xff);
    const secC = new Uint8Array([9, 8, 7]);

    const bytes = await composeKernelContainer(
      [{ data: secA }, { data: secB }, { data: secC }],
      'u16-triple',
    );

    // Sektion 1 (secB) mitten im gzip-Strom verfälschen — nicht die ersten
    // beiden Bytes (gzip-Magic), sonst würde schon das Accounting scheitern.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const comp0 = view.getUint16(0, true);
    const sec1HeaderOffset = 6 + comp0;
    const comp1 = view.getUint16(sec1HeaderOffset, true);
    const sec1DataOffset = sec1HeaderOffset + 6;
    const corruptAt = sec1DataOffset + Math.floor(comp1 * 0.6);
    bytes[corruptAt] = bytes[corruptAt]! ^ 0xff;

    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toHaveLength(3);
    expect(container.sections[0]!.ok).toBe(true);
    expect([...container.sections[0]!.data]).toEqual([...secA]);
    expect(container.sections[1]!.ok).toBe(false);
    expect(container.sections[1]!.data).toHaveLength(0);
    expect(container.sections[2]!.ok).toBe(true);
    expect([...container.sections[2]!.data]).toEqual([...secC]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-SEC1');
  });

  it('kein gültiges Layout → leere Sektionsliste mit E-KRN-ACCOUNT, kein Wurf', async () => {
    const bytes = new Uint8Array(32).fill(0xaa);
    const container = (await parseKernelContainer(bytes, 'fix'))!;

    expect(container.sections).toEqual([]);
    expect(container.diagnostics.map((d) => d.code)).toContain('E-KRN-ACCOUNT');
  });
});

describe('Textdekoder', () => {
  it('Roundtrip: mehrere Zeichenketten kommen exakt zurück, keine unbekannten Bytes', () => {
    const strings = ['hallo welt', 'system test', 'dritte zeile'];
    const bytes = composeTextSection(strings, DEFAULT_ASCII_OFFSET);
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET);

    const decoded = decodeStringTable(bytes, table, 0, strings.length);

    expect(decoded).toHaveLength(3);
    decoded.forEach((d, i) => {
      expect(d.text).toBe(strings[i]);
      expect(d.unknownBytes).toBe(0);
      expect(d.terminated).toBe(true);
    });
  });

  it('falscher Versatz erzeugt Unsinn — germanLikeness des richtigen Textes ist deutlich höher', () => {
    // Selbst erfundener Beispielsatz, kein Originaltext aus dem Spiel.
    const satz = 'der kleine drache fliegt schnell ueber den fluss';
    const bytes = composeTextSection([satz], DEFAULT_ASCII_OFFSET);

    const correctTable = buildAsciiTable(DEFAULT_ASCII_OFFSET);
    const wrongTable = buildAsciiTable(DEFAULT_ASCII_OFFSET + 1);

    const correct = decodeStringTable(bytes, correctTable, 0, 1)[0]!;
    const wrong = decodeStringTable(bytes, wrongTable, 0, 1)[0]!;

    expect(correct.text).toBe(satz);
    expect(wrong.text).not.toBe(satz);
    expect(germanLikeness(correct.text)).toBeGreaterThan(0.3);
    expect(germanLikeness(correct.text)).toBeGreaterThan(germanLikeness(wrong.text) + 0.15);
  });

  it('Steuercodes und unbekannte Bytes werden gezählt, das Ersatzzeichen steht im Text', () => {
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET);
    const bytes = new Uint8Array([
      'A'.charCodeAt(0) - DEFAULT_ASCII_OFFSET, // 'A' im linearen ASCII-Fenster
      0xfe,
      0x00, // Steuercode (0xFE) mit einem Folgebyte
      0xc5, // Byte außerhalb aller Fenster — unbekannt
      0xff, // Terminator
    ]);

    const decoded = decodeFfText(bytes, table);

    expect(decoded.controlCount).toBe(1);
    expect(decoded.unknownBytes).toBe(1);
    expect(decoded.terminated).toBe(true);
    expect(decoded.text).toBe('A�');
  });
});

// --- F18/F24-A Zusatz: typisierte Recordtabellen ----------------------------

/**
 * Fixture mit dem Sektionslauf der fünf Datentabellen. Sektion 1 trägt
 * absichtlich dieselbe Länge wie die Gegenstandstabelle (3584 B) — genau die
 * Mehrdeutigkeit, an der eine Zuordnung „nach Einzellänge" scheitern würde.
 */
async function datenFixture(bruch?: { armorRecords?: number }): Promise<Awaited<ReturnType<typeof parseKernelContainer>>> {
  const bytes = await composeKernelContainer([
    { data: composeRecordSection(32, 8) },
    { data: composeRecordSection(256, 14) }, // 3584 B — Doppelgänger der Item-Tabelle
    { data: composeRecordSection(997, 4) },
    { data: composeRecordSection(719, 4) },
    {
      data: composeRecordSection(128, 28, (i, _r, v) => {
        v.setUint16(0x08, 1000 + i, true);
        v.setUint16(0x0a, 0xfffc, true); // Verbotsmaske ⇒ verkaufbar + im Kampf
        v.setUint8(0x0f, i & 0x7f);
        v.setUint32(0x14, 0x0000_0021, true);
        v.setUint16(0x18, 0x0004, true);
      }),
    },
    {
      data: composeRecordSection(128, 44, (i, _r, v) => {
        v.setUint8(0x04, (i * 3) & 0xff);
        v.setUint8(0x06, i % 4);
        v.setUint16(0x0e, 0x01ff, true);
        for (let s = 0; s < 8; s++) v.setUint8(0x1c + s, s);
        v.setUint16(0x2a, 0xfff6, true);
      }),
    },
    {
      data: composeRecordSection(bruch?.armorRecords ?? 32, 36, (i, _r, v) => {
        v.setUint8(0x02, 10 + i);
        v.setUint16(0x20, 0xfffe, true); // nur verkaufbar
      }),
    },
    {
      data: composeRecordSection(32, 16, (i, _r, v) => {
        v.setUint8(0x00, i & 0x07);
        v.setUint16(0x0c, 0x01ff, true);
        v.setUint16(0x0e, 0xffff, true); // gar nichts erlaubt
      }),
    },
    {
      data: composeRecordSection(96, 20, (i, _r, v) => {
        [0, 2, 4, 6].forEach((o, k) => v.setUint16(o, (k + 1) * 100 + i, true));
        v.setUint8(0x0c, i % 16);
        v.setUint8(0x0d, 0xa0 | (i % 16));
        v.setUint16(0x0e, 0xffff, true);
      }),
    },
  ]);
  return parseKernelContainer(bytes, 'kernel.bin');
}

describe('F18/F24-A Kernel-Datentabellen: Accounting', () => {
  it('findet den Sektionslauf über Recordzahl × Größe == Sektionslänge — je Sektion einzeln nachgerechnet', async () => {
    const container = (await datenFixture())!;
    const sections = resolveKernelDataSections(container);
    expect(sections.reason).toBeNull();

    const erwartet = [
      { role: 'item' as const, sectionIndex: 4, recordCount: 128, recordSize: 28, length: 3584 },
      { role: 'weapon' as const, sectionIndex: 5, recordCount: 128, recordSize: 44, length: 5632 },
      { role: 'armor' as const, sectionIndex: 6, recordCount: 32, recordSize: 36, length: 1152 },
      { role: 'accessory' as const, sectionIndex: 7, recordCount: 32, recordSize: 16, length: 512 },
      { role: 'materia' as const, sectionIndex: 8, recordCount: 96, recordSize: 20, length: 1920 },
    ];
    for (const e of erwartet) {
      expect(sections[e.role]).toEqual(e);
      // Das Accounting selbst: Recordzahl × Größe == tatsächliche Sektionslänge.
      expect(e.recordCount * e.recordSize).toBe(container.sections[e.sectionIndex]!.data.length);
    }
    // Die Einzellänge 3584 kommt zweimal vor — nur der Lauf ist eindeutig.
    expect(container.sections[1]!.data.length).toBe(container.sections[4]!.data.length);
  });

  it('rät nicht, wenn das Accounting nicht aufgeht', async () => {
    const container = (await datenFixture({ armorRecords: 30 }))!;
    const sections = resolveKernelDataSections(container);
    expect(sections.item).toBeNull();
    expect(sections.materia).toBeNull();
    expect(sections.reason).toMatch(/kein Sektionslauf/);
  });
});

describe('F18/F24-A Kernel-Datentabellen: Recordfelder', () => {
  it('liest Item-, Waffen-, Rüstungs-, Accessoire- und Materiarecords zurück', async () => {
    const container = (await datenFixture())!;
    const sections = resolveKernelDataSections(container);

    const items = readItemRecords(container, sections);
    expect(items).toHaveLength(128);
    expect(items[7]).toMatchObject({ index: 7, cameraMovementId: 1007, attackPower: 7, status: 0x21, element: 4 });

    const weapons = readWeaponRecords(container, sections);
    expect(weapons).toHaveLength(128);
    expect(weapons[9]).toMatchObject({ index: 9, attackStrength: 27, growthRate: 1, equipableBy: 0x1ff });
    expect(weapons[9]!.materiaSlots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Wachstumsrate bleibt im gemessenen Wertebereich 0…3.
    expect(weapons.every((w) => w.growthRate <= 3)).toBe(true);

    const armor = readArmorRecords(container, sections);
    expect(armor).toHaveLength(32);
    expect(armor[5]!.defense).toBe(15);

    const accessories = readAccessoryRecords(container, sections);
    expect(accessories).toHaveLength(32);
    expect(accessories[3]!.boostedStats[0]!.stat).toBe(3);
    expect(accessories[3]!.equipableBy).toBe(0x1ff);

    const materia = readMateriaRecords(container, sections);
    expect(materia).toHaveLength(96);
    expect(materia[2]!.apLevelsRaw).toEqual([102, 202, 302, 402]);
    // Nur das untere Nibble ist der Typ; die oberen vier Bit bleiben roh erhalten.
    expect(materia[2]!.typeNibble).toBe(2);
    expect(materia[2]!.typeRaw).toBe(0xa2);
    // Die AP-Schwellen sind aufsteigend — dieselbe Eigenschaft, über die sie an
    // den Realdaten gegen ein Kontrollniveau belegt wurden.
    expect(materia.every((m) => m.apLevelsRaw.every((ap, k, all) => k === 0 || all[k - 1]! <= ap))).toBe(true);
  });

  it('invertiert die Restriktionsmaske — die Datei speichert Verbote', async () => {
    const container = (await datenFixture())!;
    const sections = resolveKernelDataSections(container);

    // 0xFFFC ⇒ ~ = 0b011 ⇒ verkaufbar + im Kampf nutzbar, im Menü nicht.
    const item = readItemRecords(container, sections)[0]!;
    expect(item.restrictions).toEqual({ canBeSold: true, canBeUsedInBattle: true, canBeUsedInMenu: false, raw: 0xfffc });
    // 0xFFFE ⇒ ~ = 0b001 ⇒ nur verkaufbar.
    expect(readArmorRecords(container, sections)[0]!.restrictions.canBeSold).toBe(true);
    expect(readArmorRecords(container, sections)[0]!.restrictions.canBeUsedInMenu).toBe(false);
    // 0xFFFF ⇒ ~ = 0 ⇒ gar nichts erlaubt. Ohne Invertierung wäre die Bedeutung
    // genau umgekehrt — das ist der Fehler, den diese Zeile ausschließt.
    const acc = readAccessoryRecords(container, sections)[0]!.restrictions;
    expect([acc.canBeSold, acc.canBeUsedInBattle, acc.canBeUsedInMenu]).toEqual([false, false, false]);
    expect(decodeRestrictions(0xfff8)).toMatchObject({ canBeSold: true, canBeUsedInBattle: true, canBeUsedInMenu: true });
  });
});
