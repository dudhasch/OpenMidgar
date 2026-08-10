/**
 * Savemap-Composer für Golden Fixtures (S21) — **codegetrennt** vom Leser in
 * `packages/formats-save` (Dualitätsprinzip wie LGP-Writer ↔ Scanner).
 *
 * Die Offsets sind hier bewusst noch einmal als eigene Konstanten geschrieben
 * und nicht aus dem Leser importiert. Ein Roundtrip, bei dem beide Seiten
 * dieselbe Tabelle benutzen, prüft nur, dass die Tabelle mit sich selbst
 * übereinstimmt — er würde einen Zahlendreher glatt durchgehen lassen.
 */

export const FIXTURE_SLOT_LEN = 4340;
export const FIXTURE_SLOT_COUNT = 15;
export const FIXTURE_SAVE_HEADER_LEN = 9;

const REC_BASE = 84;
const REC_LEN = 132;
const REC_COUNT = 9;
const PARTY_AT = 1272;
const INVENTORY_AT = 1276;
const INVENTORY_ENTRIES = 320;
const GIL_AT = 32;
const TIME_AT = 36;
const GIL_AT_2 = 2940;
const TIME_AT_2 = 2944;

export interface FixtureCharacter {
  id: number;
  name: string;
  level: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  stats?: readonly number[] | undefined;
  weapon?: number | undefined;
  armor?: number | undefined;
  accessory?: number | undefined;
  materia?: ReadonlyArray<{ id: number; ap: number }> | undefined;
}

export interface FixtureSavemap {
  characters: readonly FixtureCharacter[];
  /** Bis zu drei Figurenkennungen; `null` lässt den Platz frei. */
  party: ReadonlyArray<number | null>;
  inventory: ReadonlyArray<{ itemId: number; count: number }>;
  gil: number;
  playtimeSeconds: number;
  /**
   * Bricht die Übereinstimmung der beiden Ablagen von Gil und Spielzeit
   * absichtlich auf — für den Defektpfad, der prüfen muss, dass der Leser das
   * meldet statt es zu überlesen.
   */
  breakDuplicates?: boolean | undefined;
}

/** FF-Textkodierung: linearer ASCII-Versatz 0x20, Terminator 0xFF. */
function encodeName(name: string, fieldLen: number): Uint8Array {
  const out = new Uint8Array(fieldLen).fill(0xff);
  for (let i = 0; i < Math.min(name.length, fieldLen - 1); i++) {
    out[i] = (name.charCodeAt(i) - 0x20) & 0xff;
  }
  return out;
}

export function composeSavemapSlot(spec: FixtureSavemap): Uint8Array {
  const slot = new Uint8Array(FIXTURE_SLOT_LEN);
  const view = new DataView(slot.buffer);

  spec.characters.slice(0, REC_COUNT).forEach((c, i) => {
    const base = REC_BASE + i * REC_LEN;
    slot[base] = c.id & 0xff;
    slot[base + 1] = c.level & 0xff;
    const stats = c.stats ?? [];
    for (let s = 0; s < 6; s++) slot[base + 2 + s] = (stats[s] ?? 0) & 0xff;
    slot.set(encodeName(c.name, 12), base + 16);
    slot[base + 28] = (c.weapon ?? 0xff) & 0xff;
    slot[base + 29] = (c.armor ?? 0xff) & 0xff;
    slot[base + 30] = (c.accessory ?? 0xff) & 0xff;
    view.setUint16(base + 44, c.hp & 0xffff, true);
    // F12: @46/@50 sind die BASISWERTE, die echten Maxima (inkl. Ausrüstung)
    // liegen bei @56/@58 (ff7tk Type_FF7CHAR.h). Die Fixture schreibt beide
    // gleich — ein Fixture-Charakter trägt keine Ausrüstungsboni.
    view.setUint16(base + 46, c.hpMax & 0xffff, true);
    view.setUint16(base + 48, c.mp & 0xffff, true);
    view.setUint16(base + 50, c.mpMax & 0xffff, true);
    view.setUint16(base + 56, c.hpMax & 0xffff, true);
    view.setUint16(base + 58, c.mpMax & 0xffff, true);
    for (let m = 0; m < 16; m++) {
      const at = base + 64 + m * 4;
      const entry = c.materia?.[m];
      slot[at] = (entry?.id ?? 0xff) & 0xff;
      const ap = entry?.ap ?? 0xffffff;
      slot[at + 1] = ap & 0xff;
      slot[at + 2] = (ap >> 8) & 0xff;
      slot[at + 3] = (ap >> 16) & 0xff;
    }
  });

  for (let i = 0; i < 3; i++) {
    const id = spec.party[i];
    slot[PARTY_AT + i] = id === null || id === undefined ? 0xff : id & 0xff;
  }

  for (let i = 0; i < INVENTORY_ENTRIES; i++) {
    const e = spec.inventory[i];
    const at = INVENTORY_AT + i * 2;
    // Der Leer-Sentinel ist 0xFFFF; die Aufteilung ist 7 Bit Anzahl über
    // 9 Bit Kennung (realdaten-entschieden über die Verteilung der Anzahl).
    view.setUint16(at, e ? ((e.count & 0x7f) << 9) | (e.itemId & 0x1ff) : 0xffff, true);
  }

  view.setUint32(GIL_AT, spec.gil >>> 0, true);
  view.setUint32(TIME_AT, spec.playtimeSeconds >>> 0, true);
  view.setUint32(GIL_AT_2, spec.breakDuplicates ? (spec.gil + 1) >>> 0 : spec.gil >>> 0, true);
  view.setUint32(TIME_AT_2, spec.playtimeSeconds >>> 0, true);

  return slot;
}

/**
 * CRC-16/CCITT mit Nachlauf-XOR über `slot[4…]` — die in S14 belegte
 * Prüfsumme. Auch sie ist hier eigenständig geschrieben: Der Fixture-Erzeuger
 * darf die Prüfsumme des Lesers nicht ausleihen, sonst prüft der Roundtrip
 * eine Implementierung gegen sich selbst.
 */
function checksum(slot: Uint8Array): number {
  let r = 0xffff;
  for (let i = 4; i < slot.length; i++) {
    r ^= slot[i]! << 8;
    for (let bit = 0; bit < 8; bit++) r = r & 0x8000 ? ((r << 1) ^ 0x1021) & 0xffff : (r << 1) & 0xffff;
  }
  return (r ^ 0xffff) & 0xffff;
}

/**
 * Baut eine vollständige `save*.ff7`-Datei: 9-Byte-Kopf und 15 Slots. Nicht
 * belegte Slots bleiben genullt — genau so, wie der Bestand es zeigt, damit
 * der Belegungstest des Lesers eine echte Mischung sieht.
 */
export function composeSaveFile(slots: ReadonlyArray<Uint8Array | null>): Uint8Array {
  const out = new Uint8Array(FIXTURE_SAVE_HEADER_LEN + FIXTURE_SLOT_COUNT * FIXTURE_SLOT_LEN);
  // Kopf: die ersten Bytes tragen im Original eine Signatur; der Leser wertet
  // sie nicht, also bleibt hier eine erkennbare, aber bedeutungsfreie Folge.
  out.set([0x79, 0x27, 0x3d, 0x71, 0x00, 0x00, 0x00, 0x00, 0x00], 0);
  for (let i = 0; i < FIXTURE_SLOT_COUNT; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const copy = slot.slice();
    const view = new DataView(copy.buffer);
    view.setUint32(0, checksum(copy), true);
    out.set(copy, FIXTURE_SAVE_HEADER_LEN + i * FIXTURE_SLOT_LEN);
  }
  return out;
}
