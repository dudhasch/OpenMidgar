import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVE_CHECKSUM_FROM,
  SAVE_LAYOUTS,
  isSlotOccupied,
  parseOriginalSave,
  saveSlotChecksum,
  type SaveFileLayout,
} from './original.js';
import {
  SAVE_SCHEMA_VERSION,
  acceptSlot,
  canonicalizeSlot,
  type SaveSlot,
} from './slot.js';
import { SaveSlotStore } from './store.js';

/**
 * Deterministische Pseudozufallsfolge (linearer Kongruenzgenerator) statt
 * `Math.random` — Testdaten müssen reproduzierbar sein.
 */
function pseudoRandomBytes(length: number, seed: number): Uint8Array {
  let state = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state & 0xff;
  }
  return out;
}

const LAYOUT: SaveFileLayout = SAVE_LAYOUTS[0]!; // 9/4340, 15 Slots

/**
 * Prüfsumme des Fixture-Writers — **tabellengetrieben**, während der Parser
 * bitweise rechnet. Die Dopplung ist Absicht: Zwei Verfahren, die dasselbe
 * Ergebnis liefern müssen, fangen einen Denkfehler, den eine geteilte
 * Implementierung beidseitig durchreichen würde.
 */
const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    table[n] = c;
  }
  return table;
})();

function writerChecksum(slot: Uint8Array): number {
  let r = 0xffff;
  for (let i = SAVE_CHECKSUM_FROM; i < slot.length; i++) {
    r = ((r << 8) & 0xffff) ^ CRC_TABLE[((r >> 8) ^ slot[i]!) & 0xff]!;
  }
  return (r ^ 0xffff) & 0xffff;
}

/** Schreibt einen Slot mit gültiger Prüfsumme am Slotanfang (u16 LE). */
function sealSlot(slot: Uint8Array): Uint8Array {
  slot[0] = 0;
  slot[1] = 0;
  slot[2] = 0;
  slot[3] = 0;
  const crc = writerChecksum(slot);
  slot[0] = crc & 0xff;
  slot[1] = (crc >> 8) & 0xff;
  return slot;
}

function buildSaveFile(occupiedIndices: readonly number[]): Uint8Array {
  const totalSize = LAYOUT.headerLength + LAYOUT.slotCount * LAYOUT.slotLength;
  const bytes = new Uint8Array(totalSize);
  for (let i = 0; i < LAYOUT.headerLength; i++) bytes[i] = 0xa0 + i;
  for (const idx of occupiedIndices) {
    const start = LAYOUT.headerLength + idx * LAYOUT.slotLength;
    bytes.set(sealSlot(pseudoRandomBytes(LAYOUT.slotLength, 1000 + idx)), start);
  }
  return bytes;
}

describe('parseOriginalSave', () => {
  it('erkennt die 9/4340-Aufteilung bei korrekter Dateigröße', () => {
    expect(LAYOUT).toEqual({ headerLength: 9, slotLength: 4340, slotCount: 15 });
    const bytes = buildSaveFile([0, 2, 5]);
    expect(bytes.length).toBe(9 + 15 * 4340);
    expect(bytes.length).toBe(65109);

    const parsed = parseOriginalSave(bytes, 'save/slot-test.ff7');
    expect(parsed).not.toBeNull();
    expect(parsed!.layout).toEqual(LAYOUT);
    expect(parsed!.headerRaw.length).toBe(9);
    expect(Array.from(parsed!.headerRaw)).toEqual(Array.from(bytes.slice(0, 9)));
    expect(parsed!.slots).toHaveLength(15);
  });

  it('unterscheidet belegte von leeren Slots anhand deterministischer Testdaten', () => {
    const occupied = [0, 2, 5];
    const bytes = buildSaveFile(occupied);
    const parsed = parseOriginalSave(bytes, 'save/slot-test.ff7');
    expect(parsed).not.toBeNull();
    for (const slot of parsed!.slots) {
      expect(slot.raw.length).toBe(4340);
      expect(slot.occupied).toBe(occupied.includes(slot.index));
    }
  });

  it('lehnt falsche Dateigröße mit E-SAVE-SIZE ab und liefert null', () => {
    const bytes = new Uint8Array(1234); // passt zu keiner bekannten Aufteilung
    const result = parseOriginalSave(bytes, 'save/broken.ff7');
    expect(result).toBeNull();
    // Anmerkung (siehe Bericht): parseOriginalSave befüllt intern eine
    // `diagnostics`-Liste mit einem E-SAVE-SIZE-Eintrag, gibt bei falscher
    // Größe aber `null` zurück statt der Diagnose — der Eintrag ist für
    // Aufrufer nicht erreichbar. Hier lässt sich daher nur der null-Rückgabewert
    // prüfen, nicht der Diagnosecode selbst.
  });

  it('bestätigt die Prüfsumme jedes belegten Slots ohne Diagnose', () => {
    const bytes = buildSaveFile([0, 2, 5]);
    const parsed = parseOriginalSave(bytes, 'save/checksum-test.ff7');
    expect(parsed).not.toBeNull();
    for (const slot of parsed!.slots) {
      if (!slot.occupied) continue;
      expect(slot.checksumValid).toBe(true);
      expect(slot.checksumRaw).toBe(slot.checksumComputed);
    }
    expect(parsed!.diagnostics).toEqual([]);
  });

  it('meldet W-SAVE-CHECKSUM, sobald ein belegter Slot verfälscht ist', () => {
    const bytes = buildSaveFile([0, 2]);
    // Ein einzelnes Byte tief im Slot kippen — die Prüfsumme selbst bleibt
    // unangetastet, genau wie bei einer echten Beschädigung.
    const target = LAYOUT.headerLength + 2 * LAYOUT.slotLength + 2000;
    bytes[target] = bytes[target]! ^ 0x01;

    const parsed = parseOriginalSave(bytes, 'save/broken-slot.ff7');
    expect(parsed).not.toBeNull();
    expect(parsed!.slots[0]!.checksumValid).toBe(true);
    expect(parsed!.slots[2]!.checksumValid).toBe(false);
    const warnings = parsed!.diagnostics.filter((d) => d.code === 'W-SAVE-CHECKSUM');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.slot).toBe(2);
  });

  it('meldet für genullte Slots KEINE Prüfsummenwarnung', () => {
    const bytes = buildSaveFile([0]);
    const parsed = parseOriginalSave(bytes, 'save/mostly-empty.ff7');
    // 14 leere Slots — ohne die Belegtheitsbedingung gäbe es 14 Warnungen.
    expect(parsed!.slots.filter((s) => !s.occupied)).toHaveLength(14);
    expect(parsed!.diagnostics).toEqual([]);
  });

  it('Nachlauf-XOR: ein genullter Slot ergibt gerade NICHT die gespeicherte 0', () => {
    // Das ist der Grund, warum die frühere 89-%-Trefferquote ein Artefakt war
    // und die jetzige Regel keines sein kann.
    const empty = new Uint8Array(LAYOUT.slotLength);
    expect(saveSlotChecksum(empty)).not.toBe(0);
  });

  it('Writer und Parser rechnen unabhängig dasselbe', () => {
    for (const seed of [1, 42, 9999]) {
      const slot = sealSlot(pseudoRandomBytes(LAYOUT.slotLength, seed));
      expect(saveSlotChecksum(slot)).toBe(writerChecksum(slot));
      expect(slot[0]! | (slot[1]! << 8)).toBe(saveSlotChecksum(slot));
    }
  });
});

describe('isSlotOccupied', () => {
  it('bewertet einen vollständig genullten Slot als leer', () => {
    const empty = new Uint8Array(LAYOUT.slotLength);
    expect(isSlotOccupied(empty)).toBe(false);
  });

  it('bewertet einen mit deterministischen Pseudozufallsdaten gefüllten Slot als belegt', () => {
    const data = pseudoRandomBytes(LAYOUT.slotLength, 42);
    expect(isSlotOccupied(data)).toBe(true);
  });

  it('erkennt auch einen sehr dünn beschriebenen Slot als belegt', () => {
    // Regression: Die frühere 95-%-Nullanteil-Schwelle hätte diesen Slot
    // verworfen. Im echten Bestand gibt es genau so einen — mit gültiger
    // Prüfsumme.
    const sparse = new Uint8Array(LAYOUT.slotLength);
    sparse[4000] = 1;
    expect(isSlotOccupied(sparse)).toBe(true);
  });
});

function makeSlot(overrides: Partial<SaveSlot> = {}): SaveSlot {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    sourceFingerprint: 'fp-abc123',
    createdAt: 1_700_000_000_000,
    globalState: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
    fieldId: 'md1stin',
    fieldState: { position: [1, 2, 3], flags: ['a', 'b'] },
    tickCounter: 42,
    label: 'Testspeicher',
    ...overrides,
  };
}

describe('acceptSlot', () => {
  it('akzeptiert einen korrekten Slot ohne Warnungen', () => {
    const slot = makeSlot();
    const outcome = acceptSlot(slot, 'fp-abc123');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.slot.fieldId).toBe('md1stin');
      expect(outcome.warnings).toEqual([]);
    }
  });

  it('lehnt eine falsche Schemaversion ab', () => {
    const bad: unknown = { ...makeSlot(), schemaVersion: 2 };
    const outcome = acceptSlot(bad);
    expect(outcome).toEqual({ ok: false, reason: 'Schemaversion 2 wird nicht unterstützt' });
  });

  it('lehnt einen Slot mit fehlenden Pflichtfeldern ab', () => {
    const { fieldId: _fieldId, ...withoutFieldId } = makeSlot();
    const outcome = acceptSlot(withoutFieldId);
    expect(outcome).toEqual({ ok: false, reason: 'Pflichtfelder fehlen' });
  });

  it('warnt bei abweichendem Fingerprint, lehnt aber nicht ab', () => {
    const slot = makeSlot({ sourceFingerprint: 'fp-andere-installation' });
    const outcome = acceptSlot(slot, 'fp-abc123');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings[0]).toContain('anderen Installation');
    }
  });
});

describe('canonicalizeSlot', () => {
  it('ist unabhängig von der Schlüsselreihenfolge', () => {
    const a = makeSlot();
    const b: SaveSlot = {
      label: a.label,
      tickCounter: a.tickCounter,
      fieldState: a.fieldState,
      fieldId: a.fieldId,
      globalState: a.globalState,
      createdAt: a.createdAt,
      sourceFingerprint: a.sourceFingerprint,
      schemaVersion: a.schemaVersion,
    };
    expect(canonicalizeSlot(a)).toBe(canonicalizeSlot(b));
  });

  it('führt Uint8Array-Felder als Zahlenfolge fort', () => {
    const slot = makeSlot({ globalState: [new Uint8Array([9, 8, 7])] });
    const canonical = canonicalizeSlot(slot);
    expect(canonical).toContain('"__u8":[9,8,7]');
  });

  it('ist ein Fixpunkt: zweifache Kanonisierung ändert nichts mehr', () => {
    const slot = makeSlot();
    const once = canonicalizeSlot(slot);
    const reparsed = JSON.parse(once) as SaveSlot;
    const twice = canonicalizeSlot(reparsed);
    expect(twice).toBe(once);
  });
});

describe('SaveSlotStore (IndexedDB-Rundlauf)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('schreibt, liest, listet und löscht Slots', async () => {
    const store = new SaveSlotStore();
    await store.open();

    const slot0 = makeSlot({ label: 'Slot 0' });
    const slot1 = makeSlot({ label: 'Slot 1', fieldId: 'nmkin_1' });
    await store.write(0, slot0);
    await store.write(1, slot1);

    const readBack = await store.read(0, 'fp-abc123');
    expect(readBack).not.toBeNull();
    expect(readBack!.ok).toBe(true);
    if (readBack!.ok) {
      expect(readBack!.slot.label).toBe('Slot 0');
    }

    const list = await store.list(2);
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.label).sort()).toEqual(['Slot 0', 'Slot 1']);

    await store.remove(0);
    expect(await store.read(0)).toBeNull();
    const listAfterRemove = await store.list(2);
    expect(listAfterRemove).toHaveLength(1);
    expect(listAfterRemove[0]!.label).toBe('Slot 1');
  });

  it('liefert null für einen nie geschriebenen Slot', async () => {
    const store = new SaveSlotStore();
    await store.open();
    expect(await store.read(7)).toBeNull();
  });

  it('überspringt ungültige Einträge beim Auflisten', async () => {
    const store = new SaveSlotStore();
    await store.open();
    await store.write(0, makeSlot({ label: 'Gültig' }));
    // Ungültigen Eintrag direkt reinschreiben (falsche Schemaversion) —
    // simuliert Datenverfall oder ein zukünftiges Format.
    await store.write(1, { ...makeSlot(), schemaVersion: 99 } as unknown as SaveSlot);

    const list = await store.list(2);
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('Gültig');
  });
});
