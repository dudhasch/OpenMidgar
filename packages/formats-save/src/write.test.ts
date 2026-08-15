import { describe, expect, it } from 'vitest';
import { INVENTORY_RANGES } from '@webmidgar/formats-kernel';
import {
  CHAR,
  CHARACTER_RECORD_BASE,
  CHARACTER_RECORD_LEN,
  GIL_OFFSET,
  GIL_OFFSET_SAVEMAP,
  INVENTORY_ID_BITS,
  INVENTORY_OFFSET,
  PLAYTIME_OFFSET,
  PLAYTIME_OFFSET_SAVEMAP,
  SAVEMAP_SLOT_LEN,
  readInventory,
  readSavemap,
} from './savemap.js';
import {
  EMPTY_EQUIP,
  EMPTY_INVENTORY_ENTRY,
  MAX_ITEM_COUNT,
  addInventoryItem,
  countItem,
  equipItem,
  removeInventoryItem,
  setCharacterPoints,
  setGil,
  setInventoryEntry,
  setPlaytimeSeconds,
  unequipItem,
} from './write.js';

/**
 * Abnahme des Schreibpfads (F07).
 *
 * Zwei Prüfarten, die sich ergänzen und einzeln beide nicht reichen:
 *
 *  - **Rückleseprobe** — was geschrieben wurde, liest `readSavemap` wieder.
 *    Sie zeigt, dass die Stelle stimmt, aber nicht, dass sonst nichts passiert
 *    ist.
 *  - **Bytedifferenz als Kontrollniveau** — wie viele Bytes des 4340er-Slots
 *    hat die Handlung verändert? Diese Zahl ist vorhergesagt, nicht abgelesen.
 *    Sie ist die schärfere Prüfung: Ein Schreibfehler, der nebenbei ein
 *    fremdes Feld trifft, überlebt jede Rückleseprobe und stirbt hier.
 */

const ANZAHL_BITS = 16 - INVENTORY_ID_BITS;

/**
 * Ein selbstgebauter Slot. Fixtures sind im Projekt immer selbst erzeugt; hier
 * kommt hinzu, dass ein Originalslot für diese Prüfung sogar schlechter wäre —
 * die Bytedifferenz braucht einen Untergrund, dessen Belegung bekannt ist.
 */
function fixtureSlot(): Uint8Array {
  const slot = new Uint8Array(SAVEMAP_SLOT_LEN);
  const view = new DataView(slot.buffer);

  const figur = (index: number, id: number, hp: number, hpMax: number, mp: number, mpMax: number): void => {
    const at = CHARACTER_RECORD_BASE + index * CHARACTER_RECORD_LEN;
    slot[at + CHAR.id] = id;
    slot[at + CHAR.level] = 7;
    view.setUint16(at + CHAR.hp, hp, true);
    view.setUint16(at + CHAR.hpMax, hpMax, true);
    view.setUint16(at + CHAR.mp, mp, true);
    view.setUint16(at + CHAR.mpMax, mpMax, true);
    slot[at + CHAR.weapon] = EMPTY_EQUIP;
    slot[at + CHAR.armor] = EMPTY_EQUIP;
    slot[at + CHAR.accessory] = EMPTY_EQUIP;
  };
  figur(0, 0, 200, 314, 30, 54);
  figur(1, 1, 180, 280, 40, 60);

  // Inventar: alles leer, dann drei belegte Plätze.
  for (let i = 0; i < 320; i++) view.setUint16(INVENTORY_OFFSET + i * 2, EMPTY_INVENTORY_ENTRY, true);
  const setzen = (platz: number, id: number, n: number): void =>
    view.setUint16(INVENTORY_OFFSET + platz * 2, (n << INVENTORY_ID_BITS) | id, true);
  setzen(0, 4, 3); // Gegenstand
  setzen(1, INVENTORY_RANGES.weaponBase + 2, 1); // Waffe, Listenindex 2
  setzen(2, INVENTORY_RANGES.armorBase + 5, 1); // Rüstung, Listenindex 5

  view.setUint32(GIL_OFFSET, 200, true);
  view.setUint32(GIL_OFFSET_SAVEMAP, 200, true);
  return slot;
}

/** Indizes aller Bytes, in denen sich zwei Slots unterscheiden. */
function unterschiede(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/**
 * Die Bytedifferenz muss **innerhalb** des erlaubten Fensters liegen — nicht
 * gleich ihm. Ein neu geschriebener Wert kann mit dem alten Byte
 * übereinstimmen (200 → 12345 ändert von vier u32-Bytes nur zwei), und das ist
 * kein Fehlschlag, sondern Arithmetik. Die Aussage, auf die es ankommt, ist
 * die andere Richtung: **außerhalb** des Fensters darf sich nichts bewegen.
 */
function nurInnerhalb(a: Uint8Array, b: Uint8Array, fenster: number[]): number[] {
  const erlaubt = new Set(fenster);
  return unterschiede(a, b).filter((i) => !erlaubt.has(i));
}

const spanne = (von: number, laenge: number): number[] =>
  Array.from({ length: laenge }, (_, i) => von + i);

describe('Schreibpfad: Inventar', () => {
  it('schreibt einen Platz und liest ihn zurück', () => {
    const vorher = fixtureSlot();
    const r = setInventoryEntry(vorher, 10, 42, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const eintrag = readInventory(r.slot).find((e) => e.slot === 10);
    expect(eintrag).toEqual({ slot: 10, itemId: 42, count: 5 });
  });

  it('ändert genau die zwei Bytes des Platzes — und keins mehr', () => {
    const vorher = fixtureSlot();
    const r = setInventoryEntry(vorher, 10, 42, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(unterschiede(vorher, r.slot)).toEqual([INVENTORY_OFFSET + 20, INVENTORY_OFFSET + 21]);
  });

  it('lässt den Ausgangsslot unangetastet', () => {
    const vorher = fixtureSlot();
    const kopie = vorher.slice();
    setInventoryEntry(vorher, 10, 42, 5);
    expect(unterschiede(vorher, kopie)).toEqual([]);
  });

  it('leert einen Platz mit dem Sentinel, nicht mit Anzahl 0', () => {
    const r = setInventoryEntry(fixtureSlot(), 0, 4, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const view = new DataView(r.slot.buffer, r.slot.byteOffset, r.slot.byteLength);
    expect(view.getUint16(INVENTORY_OFFSET, true)).toBe(EMPTY_INVENTORY_ENTRY);
    expect(readInventory(r.slot).some((e) => e.slot === 0)).toBe(false);
  });

  it('stapelt auf einen vorhandenen Stapel derselben Kennung', () => {
    const r = addInventoryItem(fixtureSlot(), 4, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readInventory(r.slot).find((e) => e.slot === 0)?.count).toBe(5);
    // Kein zweiter Platz belegt.
    expect(readInventory(r.slot).filter((e) => e.itemId === 4)).toHaveLength(1);
  });

  it('nimmt den ersten freien Platz, wenn die Kennung noch fehlt', () => {
    const r = addInventoryItem(fixtureSlot(), 99, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readInventory(r.slot).find((e) => e.itemId === 99)?.slot).toBe(3);
  });

  it('weist eine Anzahl ab, die nicht in die Anzahlbits passt', () => {
    const r = setInventoryEntry(fixtureSlot(), 0, 4, MAX_ITEM_COUNT + 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain(`${ANZAHL_BITS} Bit`);
  });

  it('nimmt nicht mehr Stücke, als der Platz hält', () => {
    const r = removeInventoryItem(fixtureSlot(), 0, 4);
    expect(r.ok).toBe(false);
  });
});

describe('Schreibpfad: Ausrüsten', () => {
  it('trägt die Waffe in die Spalte und nimmt sie aus dem Inventar', () => {
    const vorher = fixtureSlot();
    const r = equipItem(vorher, 0, 'weapon', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sm = readSavemap(r.slot)!;
    expect(sm.characters[0]!.weapon).toBe(2);
    expect(readInventory(r.slot).some((e) => e.slot === 1)).toBe(false);
  });

  it('erhält die Gesamtzahl der Stücke — der Tausch erzeugt und vernichtet nichts', () => {
    const vorher = fixtureSlot();
    const id = INVENTORY_RANGES.weaponBase + 2;
    expect(countItem(vorher, id)).toBe(1);
    const erst = equipItem(vorher, 0, 'weapon', 1);
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;
    expect(countItem(erst.slot, id)).toBe(1);

    // Zweiter Tausch: dieselbe Figur bekommt eine andere Waffe, die alte muss
    // zurück ins Inventar. Genau hier verliert eine naive Umsetzung ein Stück.
    const mit = addInventoryItem(erst.slot, INVENTORY_RANGES.weaponBase + 9, 1);
    expect(mit.ok).toBe(true);
    if (!mit.ok) return;
    const platz = readInventory(mit.slot).find((e) => e.itemId === INVENTORY_RANGES.weaponBase + 9)!.slot;
    const zweit = equipItem(mit.slot, 0, 'weapon', platz);
    expect(zweit.ok).toBe(true);
    if (!zweit.ok) return;
    expect(readSavemap(zweit.slot)!.characters[0]!.weapon).toBe(9);
    expect(countItem(zweit.slot, id)).toBe(1);
    expect(countItem(zweit.slot, INVENTORY_RANGES.weaponBase + 9)).toBe(1);
  });

  it('weist ein Stück ab, das nicht in den Platz gehört', () => {
    const r = equipItem(fixtureSlot(), 0, 'weapon', 2); // Rüstung in den Waffenplatz
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('armor');
  });

  it('weist einen leeren Inventarplatz ab', () => {
    const r = equipItem(fixtureSlot(), 0, 'weapon', 200);
    expect(r.ok).toBe(false);
  });

  it('meldet, dass die Maxima nicht neu gerechnet werden', () => {
    const r = equipItem(fixtureSlot(), 0, 'weapon', 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toContain('ungemessen');
    // Und zwar wirklich nicht — die Maxima stehen unverändert.
    expect(readSavemap(r.slot)!.characters[0]!.hpMax).toBe(314);
  });

  it('legt ein abgenommenes Stück zurück ins Inventar', () => {
    const erst = equipItem(fixtureSlot(), 0, 'weapon', 1);
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;
    const ab = unequipItem(erst.slot, 0, 'weapon');
    expect(ab.ok).toBe(true);
    if (!ab.ok) return;
    expect(readSavemap(ab.slot)!.characters[0]!.weapon).toBe(EMPTY_EQUIP);
    expect(countItem(ab.slot, INVENTORY_RANGES.weaponBase + 2)).toBe(1);
  });

  it('weist das Abnehmen eines leeren Platzes ab', () => {
    expect(unequipItem(fixtureSlot(), 0, 'accessory').ok).toBe(false);
  });
});

describe('Schreibpfad: Zahlenfelder', () => {
  it('schreibt Gil in beide Ablagen — der eigene Leser meldet sonst einen Widerspruch', () => {
    const vorher = fixtureSlot();
    const r = setGil(vorher, 12345);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sm = readSavemap(r.slot)!;
    expect(sm.gil).toBe(12345);
    expect(sm.duplicatesConsistent).toBe(true);
    expect(nurInnerhalb(vorher, r.slot, [...spanne(GIL_OFFSET, 4), ...spanne(GIL_OFFSET_SAVEMAP, 4)])).toEqual([]);
  });

  it('erzeugt einen widersprüchlichen Stand, wenn nur eine Ablage geschrieben wird', () => {
    // Gegenprobe zur Regel: Sie ist nicht Vorsicht, sondern notwendig.
    const slot = fixtureSlot();
    new DataView(slot.buffer).setUint32(GIL_OFFSET, 999, true);
    expect(readSavemap(slot)!.duplicatesConsistent).toBe(false);
  });

  it('schreibt die Spielzeit in beide Ablagen', () => {
    const r = setPlaytimeSeconds(fixtureSlot(), 3600);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const view = new DataView(r.slot.buffer, r.slot.byteOffset, r.slot.byteLength);
    expect(view.getUint32(PLAYTIME_OFFSET, true)).toBe(3600);
    expect(view.getUint32(PLAYTIME_OFFSET_SAVEMAP, true)).toBe(3600);
  });

  it('klemmt HP auf das Maximum — „aktuell ≤ Maximum" ist die eigene Messgrundlage', () => {
    const r = setCharacterPoints(fixtureSlot(), 0, 'hp', 9999);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readSavemap(r.slot)!.characters[0]!.hp).toBe(314);
  });

  it('klemmt MP nach unten auf 0', () => {
    const r = setCharacterPoints(fixtureSlot(), 0, 'mp', -50);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readSavemap(r.slot)!.characters[0]!.mp).toBe(0);
  });

  it('rührt beim Setzen der HP genau zwei Bytes an', () => {
    const vorher = fixtureSlot();
    const r = setCharacterPoints(vorher, 1, 'hp', 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const basis = CHARACTER_RECORD_BASE + CHARACTER_RECORD_LEN + CHAR.hp;
    expect(nurInnerhalb(vorher, r.slot, spanne(basis, 2))).toEqual([]);
    expect(unterschiede(vorher, r.slot).length).toBeGreaterThan(0);
  });
});
