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

// --- F24-B: Felder der neuen Menüansichten ----------------------------------
// Auch diese Offsets stehen absichtlich noch einmal eigenständig hier.
const PREVIEW_LOCATION_AT = 0x28;
const PREVIEW_LOCATION_LEN = 32;
const LOCATION_AT = 0x0f0c;
const LOCATION_LEN = 24;
const PARTY_MATERIA_AT = 0x077c;
const PARTY_MATERIA_ENTRIES = 200;
const MENU_VISIBLE_AT = 0x0bc0;
const MENU_LOCKED_AT = 0x0bc2;
const PHS_ALLOWED_AT = 0x10a4;
const PHS_VISIBLE_AT = 0x10a6;
const OPTIONS_AT = 0x10da;
const BATTLE_SPEED_AT = 0x10d8;
const BATTLE_MSG_SPEED_AT = 0x10d9;
const FIELD_MSG_SPEED_AT = 0x10ec;
const DISC_AT = 0x0ea4;
/** Relativ zum Charakterrecord. */
const CHAR_LIMIT_LEVEL = 0x0e;
const CHAR_LIMIT_BAR = 0x0f;
const CHAR_ROW = 0x20;
const CHAR_LIMITS = 0x22;
const CHAR_EXP = 0x3c;
const CHAR_EXP_NEXT = 0x80;

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
  /** 1…4; ohne Angabe 1. */
  limitLevel?: number | undefined;
  /** 0…255; 255 heißt „bereit". */
  limitBar?: number | undefined;
  /** Bitmaske der gelernten Limits (Bits 0,1,3,4,6,7,9). */
  limitsLearned?: number | undefined;
  /** 0xFF vorne, 0xFE hinten; ohne Angabe vorne. */
  row?: number | undefined;
  exp?: number | undefined;
  expToNext?: number | undefined;
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

  // --- F24-B ---------------------------------------------------------------
  /** Ortsname in der laufenden Ablage (0x0F0C). Leer heißt „nicht eingetragen". */
  location?: string | undefined;
  /** Ortsname im Vorschaublock (0x0028). Ohne Angabe derselbe wie `location`. */
  previewLocation?: string | undefined;
  /** Materiavorrat der Gruppe. */
  partyMateria?: ReadonlyArray<{ id: number; ap: number }> | undefined;
  menuVisible?: number | undefined;
  menuLocked?: number | undefined;
  phsAllowed?: number | undefined;
  phsVisible?: number | undefined;
  options?: number | undefined;
  battleSpeed?: number | undefined;
  battleMessageSpeed?: number | undefined;
  fieldMessageSpeed?: number | undefined;
  disc?: number | undefined;
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
    slot[base + CHAR_LIMIT_LEVEL] = (c.limitLevel ?? 1) & 0xff;
    slot[base + CHAR_LIMIT_BAR] = (c.limitBar ?? 0) & 0xff;
    slot[base + CHAR_ROW] = (c.row ?? 0xff) & 0xff;
    view.setUint16(base + CHAR_LIMITS, (c.limitsLearned ?? 0) & 0xffff, true);
    view.setUint32(base + CHAR_EXP, (c.exp ?? 0) >>> 0, true);
    view.setUint32(base + CHAR_EXP_NEXT, (c.expToNext ?? 0) >>> 0, true);
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

  // F24-B: Ortsname in beiden Ablagen. Ohne eigene Vorschaufassung tragen
  // beide denselben Text — genau so, wie es der Bestand in 7 von 7 Fällen
  // zeigt, in denen beide gefüllt sind.
  slot.set(encodeName(spec.location ?? '', LOCATION_LEN), LOCATION_AT);
  slot.set(encodeName(spec.previewLocation ?? spec.location ?? '', PREVIEW_LOCATION_LEN), PREVIEW_LOCATION_AT);

  for (let i = 0; i < PARTY_MATERIA_ENTRIES; i++) {
    const at = PARTY_MATERIA_AT + i * 4;
    const e = spec.partyMateria?.[i];
    slot[at] = (e?.id ?? 0xff) & 0xff;
    const ap = e?.ap ?? 0xffffff;
    slot[at + 1] = ap & 0xff;
    slot[at + 2] = (ap >> 8) & 0xff;
    slot[at + 3] = (ap >> 16) & 0xff;
  }

  view.setUint16(MENU_VISIBLE_AT, (spec.menuVisible ?? 0xffff) & 0xffff, true);
  view.setUint16(MENU_LOCKED_AT, (spec.menuLocked ?? 0) & 0xffff, true);
  view.setUint16(PHS_ALLOWED_AT, (spec.phsAllowed ?? 0) & 0xffff, true);
  view.setUint16(PHS_VISIBLE_AT, (spec.phsVisible ?? 0) & 0xffff, true);
  view.setUint16(OPTIONS_AT, (spec.options ?? 0) & 0xffff, true);
  slot[BATTLE_SPEED_AT] = (spec.battleSpeed ?? 128) & 0xff;
  slot[BATTLE_MSG_SPEED_AT] = (spec.battleMessageSpeed ?? 128) & 0xff;
  slot[FIELD_MSG_SPEED_AT] = (spec.fieldMessageSpeed ?? 128) & 0xff;
  slot[DISC_AT] = (spec.disc ?? 1) & 0xff;

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
