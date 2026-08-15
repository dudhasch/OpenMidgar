import { INVENTORY_RANGES, inventoryCategory, type InventoryCategory } from '@webmidgar/formats-kernel';
import {
  CHAR,
  CHARACTER_RECORD_BASE,
  CHARACTER_RECORD_COUNT,
  CHARACTER_RECORD_LEN,
  GIL_OFFSET,
  GIL_OFFSET_SAVEMAP,
  INVENTORY_ENTRIES,
  INVENTORY_ID_BITS,
  INVENTORY_OFFSET,
  PLAYTIME_OFFSET,
  PLAYTIME_OFFSET_SAVEMAP,
  SAVEMAP_SLOT_LEN,
} from './savemap.js';

/**
 * Schreibpfad in die Savemap (F07, Welle 4).
 *
 * Bis hierher war das Menü ausdrücklich lesend — `savemap.ts` sagt das in
 * seinem Kopf, und das war richtig, solange es keine Handlung gab. Mit
 * Ausrüsten und Speichern gibt es eine, und dieser Schreibpfad ist die einzige
 * Stelle, an der ein Spielstand verändert wird.
 *
 * **Drei Regeln, die den Rest des Moduls erklären:**
 *
 * 1. **Bytes sind die Wahrheit, nicht das Objekt.** Geschrieben wird in den
 *    4340-Byte-Slot; `readSavemap` bleibt die einzige Deutung. Ein zweiter
 *    Schreibweg über das `Savemap`-Objekt hätte zwei Quellen erzeugt, die
 *    auseinanderlaufen können.
 * 2. **Jede Funktion gibt einen neuen Slot zurück.** Der geladene Stand des
 *    Nutzers wird nie in place verändert. Das kostet eine Kopie von 4,3 kB pro
 *    Handlung und macht dafür jede Prüfung „welche Bytes hat das geändert?"
 *    trivial — und genau diese Prüfung ist die Abnahme dieses Moduls.
 * 3. **Doppelt abgelegte Felder werden doppelt geschrieben.** Gil und
 *    Spielzeit stehen zweimal im Slot (`duplicatesConsistent` prüft das beim
 *    Lesen). Wer nur eine Fassung schreibt, erzeugt einen Stand, den der
 *    eigene Leser als widersprüchlich meldet.
 *
 * **Kein Schreiben originaler `save*.ff7`-Dateien.** Der veränderte Slot geht
 * in den eigenen, versionierten Spielstand (`SaveSlot`, S14) — die
 * Installation des Nutzers wird nicht angefasst. Das ist dieselbe Trennung wie
 * in `slot.ts` und aus demselben Grund.
 */

/** Sentinel eines leeren Inventarplatzes. */
export const EMPTY_INVENTORY_ENTRY = 0xffff;
/** Sentinel „nichts ausgerüstet" in den drei Ausrüstungsspalten. */
export const EMPTY_EQUIP = 0xff;
/** Höchste Stückzahl, die in die 7 Anzahlbits passt. */
export const MAX_ITEM_COUNT = (1 << (16 - INVENTORY_ID_BITS)) - 1;

/** Die drei Ausrüstungsplätze einer Figur. */
export type EquipSlotKind = 'weapon' | 'armor' | 'accessory';

const EQUIP_FELD: Readonly<Record<EquipSlotKind, number>> = {
  weapon: CHAR.weapon,
  armor: CHAR.armor,
  accessory: CHAR.accessory,
};

/** Bereichsbasis, mit der aus einem Listenindex eine Inventarkennung wird (F18). */
const EQUIP_BASIS: Readonly<Record<EquipSlotKind, number>> = {
  weapon: INVENTORY_RANGES.weaponBase,
  armor: INVENTORY_RANGES.armorBase,
  accessory: INVENTORY_RANGES.accessoryBase,
};

/** Welche Inventarkategorie in welchen Platz gehört. */
const EQUIP_KATEGORIE: Readonly<Record<EquipSlotKind, InventoryCategory>> = {
  weapon: 'weapon',
  armor: 'armor',
  accessory: 'accessory',
};

/** Ergebnis einer Handlung. Ein Fehlschlag nennt seinen Grund und ändert nichts. */
export type WriteResult =
  | { ok: true; slot: Uint8Array; note?: string }
  | { ok: false; reason: string };

function kopie(slot: Uint8Array): Uint8Array {
  return slot.slice();
}

function sicht(slot: Uint8Array): DataView {
  return new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
}

function recordBasis(characterIndex: number): number {
  return CHARACTER_RECORD_BASE + characterIndex * CHARACTER_RECORD_LEN;
}

// --- Inventar ---------------------------------------------------------------

/**
 * Schreibt einen Inventarplatz. `count === 0` leert ihn — mit dem Sentinel
 * 0xFFFF, denn `readInventory` überspringt sowohl den Sentinel als auch die
 * Anzahl 0, und ein halb geleerter Platz wäre in beiden Fassungen unsichtbar,
 * aber nicht gleich.
 */
export function setInventoryEntry(
  slot: Uint8Array,
  entrySlot: number,
  itemId: number,
  count: number,
): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(entrySlot) || entrySlot < 0 || entrySlot >= INVENTORY_ENTRIES) {
    return { ok: false, reason: `Inventarplatz ${entrySlot} liegt außerhalb 0…${INVENTORY_ENTRIES - 1}` };
  }
  if (count < 0 || count > MAX_ITEM_COUNT) {
    return { ok: false, reason: `Anzahl ${count} passt nicht in ${16 - INVENTORY_ID_BITS} Bit` };
  }
  if (count > 0 && (itemId < 0 || itemId > INVENTORY_RANGES.max)) {
    return { ok: false, reason: `Kennung ${itemId} liegt außerhalb 0…${INVENTORY_RANGES.max}` };
  }
  const out = kopie(slot);
  const wert = count === 0 ? EMPTY_INVENTORY_ENTRY : (count << INVENTORY_ID_BITS) | itemId;
  sicht(out).setUint16(INVENTORY_OFFSET + entrySlot * 2, wert, true);
  return { ok: true, slot: out };
}

/**
 * Legt einen Gegenstand ins Inventar: erst auf einen vorhandenen Stapel
 * derselben Kennung, sonst auf den ersten freien Platz.
 *
 * Das Stapeln ist kein Komfort, sondern Notwendigkeit — das Inventar hat 320
 * Plätze, und ein Ausrüstungstausch, der jedes Mal einen neuen belegt, läuft
 * es leer.
 */
export function addInventoryItem(slot: Uint8Array, itemId: number, count = 1): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (itemId < 0 || itemId > INVENTORY_RANGES.max) {
    return { ok: false, reason: `Kennung ${itemId} liegt außerhalb 0…${INVENTORY_RANGES.max}` };
  }
  const view = sicht(slot);
  const maske = (1 << INVENTORY_ID_BITS) - 1;
  let frei = -1;
  for (let i = 0; i < INVENTORY_ENTRIES; i++) {
    const wert = view.getUint16(INVENTORY_OFFSET + i * 2, true);
    const menge = wert === EMPTY_INVENTORY_ENTRY ? 0 : wert >>> INVENTORY_ID_BITS;
    if (menge === 0) {
      if (frei < 0) frei = i;
      continue;
    }
    if ((wert & maske) === itemId && menge + count <= MAX_ITEM_COUNT) {
      return setInventoryEntry(slot, i, itemId, menge + count);
    }
  }
  if (frei < 0) return { ok: false, reason: 'Inventar voll' };
  return setInventoryEntry(slot, frei, itemId, count);
}

/** Nimmt Stück für Stück von einem Platz; bei 0 wird der Platz geleert. */
export function removeInventoryItem(slot: Uint8Array, entrySlot: number, count = 1): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(entrySlot) || entrySlot < 0 || entrySlot >= INVENTORY_ENTRIES) {
    return { ok: false, reason: `Inventarplatz ${entrySlot} liegt außerhalb 0…${INVENTORY_ENTRIES - 1}` };
  }
  const wert = sicht(slot).getUint16(INVENTORY_OFFSET + entrySlot * 2, true);
  const menge = wert === EMPTY_INVENTORY_ENTRY ? 0 : wert >>> INVENTORY_ID_BITS;
  if (menge < count) return { ok: false, reason: `Platz ${entrySlot} hält nur ${menge} Stück` };
  const id = wert & ((1 << INVENTORY_ID_BITS) - 1);
  return setInventoryEntry(slot, entrySlot, id, menge - count);
}

// --- Ausrüsten --------------------------------------------------------------

/**
 * Rüstet die Figur mit dem Gegenstand auf `inventorySlot` aus und legt das
 * bisher getragene Stück zurück ins Inventar.
 *
 * **Ein Tausch, kein Anlegen.** Das ist der Punkt, an dem eine naive Umsetzung
 * Gegenstände erzeugt oder vernichtet: Wer nur die Ausrüstungsspalte schreibt,
 * verliert das alte Stück; wer nur das Inventar schreibt, verdoppelt es. Die
 * Abnahme dieses Moduls prüft deshalb die **Erhaltung** — die Gesamtzahl der
 * Stücke einer Kennung über Inventar und Ausrüstungsspalten zusammen ist
 * vorher und nachher gleich.
 *
 * 🟡 **Was hier NICHT passiert:** HP-/MP-Maxima (@56/@58) tragen die Boni der
 * Ausrüstung, und die Formel dafür ist ungemessen. Sie bleiben deshalb
 * unverändert — lieber ein Stand, dessen Maxima zur alten Ausrüstung passen,
 * als eine erfundene Neuberechnung. Das gehört in die Anzeige und steht
 * darum in `note`.
 */
export function equipItem(
  slot: Uint8Array,
  characterIndex: number,
  kind: EquipSlotKind,
  inventorySlot: number,
): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(characterIndex) || characterIndex < 0 || characterIndex >= CHARACTER_RECORD_COUNT) {
    return { ok: false, reason: `Charakterindex ${characterIndex} liegt außerhalb 0…${CHARACTER_RECORD_COUNT - 1}` };
  }
  const view = sicht(slot);
  const wert = view.getUint16(INVENTORY_OFFSET + inventorySlot * 2, true);
  const menge = wert === EMPTY_INVENTORY_ENTRY ? 0 : wert >>> INVENTORY_ID_BITS;
  if (menge === 0) return { ok: false, reason: `Inventarplatz ${inventorySlot} ist leer` };
  const id = wert & ((1 << INVENTORY_ID_BITS) - 1);

  const bereich = inventoryCategory(id);
  if (!bereich || bereich.category !== EQUIP_KATEGORIE[kind]) {
    return {
      ok: false,
      reason: `Kennung ${id} ist ${bereich?.category ?? 'unbekannt'}, der Platz erwartet ${EQUIP_KATEGORIE[kind]}`,
    };
  }

  const feld = recordBasis(characterIndex) + EQUIP_FELD[kind];
  const alt = slot[feld] ?? EMPTY_EQUIP;

  // 1. Neues Stück aus dem Inventar nehmen.
  const genommen = removeInventoryItem(slot, inventorySlot, 1);
  if (!genommen.ok) return genommen;
  let out = genommen.slot;

  // 2. Altes Stück zurücklegen — erst danach die Spalte überschreiben, sonst
  //    wäre sie bei einem vollen Inventar schon weg und das Stück verloren.
  if (alt !== EMPTY_EQUIP) {
    const zurueck = addInventoryItem(out, EQUIP_BASIS[kind] + alt, 1);
    if (!zurueck.ok) return { ok: false, reason: `Altes Stück passt nicht zurück: ${zurueck.reason}` };
    out = zurueck.slot;
  }

  // 3. Ausrüstungsspalte setzen.
  out[feld] = bereich.index;
  return {
    ok: true,
    slot: out,
    note: 'HP-/MP-Maxima tragen Ausrüstungsboni (@56/@58) und werden nicht neu gerechnet — die Formel ist ungemessen (🟡)',
  };
}

/** Nimmt ein Ausrüstungsstück ab und legt es ins Inventar. */
export function unequipItem(slot: Uint8Array, characterIndex: number, kind: EquipSlotKind): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(characterIndex) || characterIndex < 0 || characterIndex >= CHARACTER_RECORD_COUNT) {
    return { ok: false, reason: `Charakterindex ${characterIndex} liegt außerhalb` };
  }
  const feld = recordBasis(characterIndex) + EQUIP_FELD[kind];
  const alt = slot[feld] ?? EMPTY_EQUIP;
  if (alt === EMPTY_EQUIP) return { ok: false, reason: 'Der Platz ist bereits leer' };
  const zurueck = addInventoryItem(slot, EQUIP_BASIS[kind] + alt, 1);
  if (!zurueck.ok) return zurueck;
  const out = zurueck.slot;
  out[feld] = EMPTY_EQUIP;
  return { ok: true, slot: out };
}

// --- Zahlenfelder -----------------------------------------------------------

/** Gil — **beide** Ablagen, sonst meldet der eigene Leser einen Widerspruch. */
export function setGil(slot: Uint8Array, gil: number): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(gil) || gil < 0 || gil > 0xffffffff) return { ok: false, reason: `Gil ${gil} außerhalb u32` };
  const out = kopie(slot);
  const v = sicht(out);
  v.setUint32(GIL_OFFSET, gil, true);
  v.setUint32(GIL_OFFSET_SAVEMAP, gil, true);
  return { ok: true, slot: out };
}

/** Spielzeit in Sekunden — ebenfalls beide Ablagen. */
export function setPlaytimeSeconds(slot: Uint8Array, sekunden: number): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(sekunden) || sekunden < 0 || sekunden > 0xffffffff) {
    return { ok: false, reason: `Spielzeit ${sekunden} außerhalb u32` };
  }
  const out = kopie(slot);
  const v = sicht(out);
  v.setUint32(PLAYTIME_OFFSET, sekunden, true);
  v.setUint32(PLAYTIME_OFFSET_SAVEMAP, sekunden, true);
  return { ok: true, slot: out };
}

/**
 * Setzt HP bzw. MP einer Figur, geklemmt auf das jeweilige Maximum (@56/@58).
 * Die Klemmung ist keine Bequemlichkeit: „aktuell ≤ Maximum" ist eine der
 * Ordnungsaussagen, über die die Feldlage überhaupt belegt wurde — ein
 * Schreibpfad, der sie verletzt, würde die eigene Messgrundlage zerstören.
 */
export function setCharacterPoints(
  slot: Uint8Array,
  characterIndex: number,
  kind: 'hp' | 'mp',
  wert: number,
): WriteResult {
  if (slot.length < SAVEMAP_SLOT_LEN) return { ok: false, reason: 'Slot zu kurz' };
  if (!Number.isInteger(characterIndex) || characterIndex < 0 || characterIndex >= CHARACTER_RECORD_COUNT) {
    return { ok: false, reason: `Charakterindex ${characterIndex} liegt außerhalb` };
  }
  const basis = recordBasis(characterIndex);
  const out = kopie(slot);
  const v = sicht(out);
  const maxAt = basis + (kind === 'hp' ? CHAR.hpMax : CHAR.mpMax);
  const at = basis + (kind === 'hp' ? CHAR.hp : CHAR.mp);
  const max = v.getUint16(maxAt, true);
  v.setUint16(at, Math.max(0, Math.min(max, Math.round(wert))), true);
  return { ok: true, slot: out };
}

/**
 * Zählt, wie oft eine Inventarkennung im Stand **insgesamt** vorkommt —
 * im Inventar und in den Ausrüstungsspalten aller Figuren.
 *
 * Das ist die Erhaltungsgröße des Ausrüstungstauschs und der Grund, warum
 * diese Funktion hier steht und nicht im Test: Sie gehört zur Aussage des
 * Moduls, nicht zu ihrer Prüfung.
 */
export function countItem(slot: Uint8Array, itemId: number): number {
  const view = sicht(slot);
  const maske = (1 << INVENTORY_ID_BITS) - 1;
  let n = 0;
  for (let i = 0; i < INVENTORY_ENTRIES; i++) {
    const wert = view.getUint16(INVENTORY_OFFSET + i * 2, true);
    if (wert === EMPTY_INVENTORY_ENTRY) continue;
    const menge = wert >>> INVENTORY_ID_BITS;
    if (menge > 0 && (wert & maske) === itemId) n += menge;
  }
  const bereich = inventoryCategory(itemId);
  if (bereich && bereich.category !== 'item') {
    const kind = bereich.category as EquipSlotKind;
    for (let c = 0; c < CHARACTER_RECORD_COUNT; c++) {
      if (slot[recordBasis(c) + EQUIP_FELD[kind]] === bereich.index) n++;
    }
  }
  return n;
}
