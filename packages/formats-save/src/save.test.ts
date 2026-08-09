import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVE_EMPTY_ZERO_SHARE,
  SAVE_LAYOUTS,
  isSlotOccupied,
  parseOriginalSave,
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

function buildSaveFile(occupiedIndices: readonly number[]): Uint8Array {
  const totalSize = LAYOUT.headerLength + LAYOUT.slotCount * LAYOUT.slotLength;
  const bytes = new Uint8Array(totalSize);
  for (let i = 0; i < LAYOUT.headerLength; i++) bytes[i] = 0xa0 + i;
  for (const idx of occupiedIndices) {
    const start = LAYOUT.headerLength + idx * LAYOUT.slotLength;
    bytes.set(pseudoRandomBytes(LAYOUT.slotLength, 1000 + idx), start);
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

  it('behauptet keine Prüfsummenprüfung: checksumRaw wird nur roh übernommen, keine W-SAVE-CHECKSUM-Diagnose', () => {
    const bytes = buildSaveFile([0]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Absichtlich eine "falsche" Prüfsumme an den Slotanfang schreiben.
    view.setUint16(LAYOUT.headerLength, 0xdead, true);

    const parsed = parseOriginalSave(bytes, 'save/checksum-test.ff7');
    expect(parsed).not.toBeNull();
    expect(parsed!.slots[0]!.checksumRaw).toBe(0xdead);
    expect(parsed!.diagnostics.some((d) => d.code === 'W-SAVE-CHECKSUM')).toBe(false);
    expect(parsed!.diagnostics).toEqual([]);
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

  it('nutzt die dokumentierte Nullanteil-Schwelle', () => {
    expect(SAVE_EMPTY_ZERO_SHARE).toBe(0.95);
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
