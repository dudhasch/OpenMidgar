import { buildAsciiTable, decodeFfText, DEFAULT_ASCII_OFFSET, type FfTextTable } from '@webmidgar/formats-kernel';

/**
 * Savemap-Leser (S21) — die Feldlage **innerhalb** eines originalen 4340-Byte-
 * Slots. S14 hatte den Slot bewusst nur als Rohbytes geliefert; erst das Menü
 * braucht seinen Inhalt.
 *
 * **Alle Konstanten hier sind aus den Realdaten abgeleitet, keine übernommen**
 * (Probe `menu-savemap-probe.rdtest.ts`, Befunde in FINDINGS.md):
 *
 *  - Die **Schrittweite 132** kommt aus dem Namensraster: FF-Text-Namen (die
 *    Zeichentabelle ist seit S13 belegt) treffen bei 100 + i·132; dieselbe
 *    Suche auf verwürfelten Slots liefert **0 Treffer**.
 *  - Die **Basis 84** kommt aus der Kennungsspalte: Genau eine Spalte des
 *    Rasters trägt in jedem Record einen Wert ≤ 10 und nimmt neun verschiedene
 *    Werte an. Sie liegt 16 Byte vor dem Namen.
 *  - **Level** ist über die Konkordanz mit dem HP-Maximum belegt (0,974 gegen
 *    ein Kontrollniveau von 0,638 bei verwürfelter Zuordnung).
 *  - **HP/MP** über Ordnungspaare (aktuell ≤ Maximum, ausnahmslos) und ihre
 *    Wertebereiche: Die MP-Felder erreichen exakt 999.
 *  - **Gil und Spielzeit** über Duplikatgruppen (beide stehen zweimal im Slot)
 *    und werden über die Konkordanz beider Reihen auseinandergehalten (0,885).
 *  - **Party und Inventar** liegen unmittelbar hinter dem Recordarray; der
 *    Inventareintrag teilt sich in 7 Bit Anzahl und 9 Bit Kennung, entschieden
 *    über die Verteilung der Anzahl (nur diese Aufteilung kennt „Anzahl 1").
 *
 * Was nicht gemessen ist, steht als 🟡 an der Konstanten — und wird gelesen,
 * aber nicht gedeutet.
 */

/** Slotlänge des Originalformats (S14). */
export const SAVEMAP_SLOT_LEN = 4340;

/** Vorschaublock: Slot 4…83. Ergibt sich aus der Recordbasis, ist nicht gesetzt. */
export const SAVEMAP_PREVIEW_FROM = 4;
export const SAVEMAP_DATA_FROM = 84;

export const CHARACTER_RECORD_BASE = 84;
export const CHARACTER_RECORD_LEN = 132;
export const CHARACTER_RECORD_COUNT = 9;

/** Feldlage **innerhalb** eines Charakterrecords. */
export const CHAR = {
  /** Figurenkennung 0…10 (neun spielbare plus zwei Sonderfassungen). */
  id: 0,
  level: 1,
  /** 🟡 Sechs Grundwerte; die Reihenfolge ist aus dem Wertebereich plausibel, nicht belegt. */
  stats: 2,
  statsCount: 6,
  name: 16,
  nameLen: 12,
  /** 🟡 Ausrüstungskennungen — Wertebereiche passen, einzeln belegt sind sie nicht. */
  weapon: 28,
  armor: 29,
  accessory: 30,
  hp: 44,
  hpMax: 46,
  mp: 48,
  mpMax: 50,
  /** 16 Materiaplätze à 4 Byte (Kennung + 3 Byte Erfahrung). 🟡 Aufteilung. */
  materia: 64,
  materiaSlots: 16,
  materiaEntryLen: 4,
} as const;

/** Partyaufstellung: drei Figurenkennungen, unmittelbar hinter dem Recordarray. */
export const PARTY_OFFSET = CHARACTER_RECORD_BASE + CHARACTER_RECORD_COUNT * CHARACTER_RECORD_LEN;
export const PARTY_SIZE = 3;

export const INVENTORY_OFFSET = 1276;
export const INVENTORY_ENTRIES = 320;
/** Bits der Gegenstandskennung; die oberen 7 Bit tragen die Anzahl. */
export const INVENTORY_ID_BITS = 9;

/** Gil und Spielzeit stehen doppelt im Slot — hier die Fassung des Vorschaublocks. */
export const GIL_OFFSET = 32;
export const PLAYTIME_OFFSET = 36;
/** Zweitfassung in der Savemap; muss mit der ersten übereinstimmen. */
export const GIL_OFFSET_SAVEMAP = 2940;
export const PLAYTIME_OFFSET_SAVEMAP = 2944;

/** Leerer Platz — sowohl im Inventar als auch bei Figurenkennungen. */
export const EMPTY_SLOT = 0xff;
const EMPTY_ENTRY = 0xffff;

export interface MateriaSlot {
  /** 0xFF = leer. */
  id: number;
  /** 🟡 Erfahrungspunkte als u24; die Deutung ist nicht einzeln belegt. */
  ap: number;
}

export interface CharacterRecord {
  index: number;
  id: number;
  name: string;
  level: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  /** 🟡 Sechs Grundwerte in Speicherreihenfolge, bewusst unbenannt. */
  stats: number[];
  weapon: number;
  armor: number;
  accessory: number;
  materia: MateriaSlot[];
  /** false, wenn der Record nie beschrieben wurde (kein Name, kein HP-Maximum). */
  used: boolean;
}

export interface InventoryEntry {
  slot: number;
  itemId: number;
  count: number;
}

export interface Savemap {
  schemaVersion: 1;
  characters: CharacterRecord[];
  /** Drei Plätze; `null` steht für einen unbesetzten Platz (Sentinel 0xFF). */
  party: Array<number | null>;
  inventory: InventoryEntry[];
  gil: number;
  /** Spielzeit. 🟡 Einheit Sekunden — plausibel, nicht bewiesen. */
  playtimeSeconds: number;
  /**
   * Stimmen die beiden Ablagen von Gil und Spielzeit überein? Sie tun es im
   * Bestand immer; eine Abweichung heißt, dass der Slot anders aufgebaut ist
   * als gemessen — das gehört gemeldet und nicht überlesen.
   */
  duplicatesConsistent: boolean;
}

const NAME_TABLE: FfTextTable = buildAsciiTable(DEFAULT_ASCII_OFFSET);

function readName(view: DataView, bytes: Uint8Array, at: number): string {
  void view;
  return decodeFfText(bytes, NAME_TABLE, at, CHAR.nameLen).text.trim();
}

/**
 * Liest einen Charakterrecord. Ein nie beschriebener Record wird **nicht**
 * unterdrückt, sondern als `used: false` gemeldet: Das Menü soll leere Plätze
 * zeigen können, und ein stillschweigend weggelassener Record wäre für die
 * Fehlersuche schlechter als ein sichtbar leerer.
 */
export function readCharacterRecord(slot: Uint8Array, index: number): CharacterRecord {
  const base = CHARACTER_RECORD_BASE + index * CHARACTER_RECORD_LEN;
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  const u8 = (o: number): number => slot[base + o] ?? 0;
  const u16 = (o: number): number => (base + o + 2 <= slot.length ? view.getUint16(base + o, true) : 0);

  const stats: number[] = [];
  for (let i = 0; i < CHAR.statsCount; i++) stats.push(u8(CHAR.stats + i));

  const materia: MateriaSlot[] = [];
  for (let i = 0; i < CHAR.materiaSlots; i++) {
    const at = CHAR.materia + i * CHAR.materiaEntryLen;
    materia.push({ id: u8(at), ap: u8(at + 1) | (u8(at + 2) << 8) | (u8(at + 3) << 16) });
  }

  const name = readName(view, slot, base + CHAR.name);
  const hpMax = u16(CHAR.hpMax);
  return {
    index,
    id: u8(CHAR.id),
    name,
    level: u8(CHAR.level),
    hp: u16(CHAR.hp),
    hpMax,
    mp: u16(CHAR.mp),
    mpMax: u16(CHAR.mpMax),
    stats,
    weapon: u8(CHAR.weapon),
    armor: u8(CHAR.armor),
    accessory: u8(CHAR.accessory),
    materia,
    used: name.length > 0 && hpMax > 0,
  };
}

/**
 * Liest das Inventar. Leere Plätze (Sentinel 0xFFFF) fallen heraus, die
 * Plätznummer bleibt aber erhalten — sonst ließe sich eine Anzeige nicht mehr
 * auf den Speicher zurückführen.
 */
export function readInventory(slot: Uint8Array): InventoryEntry[] {
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  const maske = (1 << INVENTORY_ID_BITS) - 1;
  const out: InventoryEntry[] = [];
  for (let i = 0; i < INVENTORY_ENTRIES; i++) {
    const at = INVENTORY_OFFSET + i * 2;
    if (at + 2 > slot.length) break;
    const value = view.getUint16(at, true);
    if (value === EMPTY_ENTRY) continue;
    const count = value >>> INVENTORY_ID_BITS;
    if (count === 0) continue;
    out.push({ slot: i, itemId: value & maske, count });
  }
  return out;
}

/**
 * Liest einen kompletten Slot. Der Leser ist **rein lesend** und ohne
 * Seiteneffekt: S21 ist ausdrücklich eine Anzeigesession, es gibt keinen
 * Schreibpfad in die Savemap.
 */
export function readSavemap(slot: Uint8Array): Savemap | null {
  if (slot.length < SAVEMAP_SLOT_LEN) return null;
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);

  const characters: CharacterRecord[] = [];
  for (let i = 0; i < CHARACTER_RECORD_COUNT; i++) characters.push(readCharacterRecord(slot, i));

  const party: Array<number | null> = [];
  for (let i = 0; i < PARTY_SIZE; i++) {
    const v = slot[PARTY_OFFSET + i] ?? EMPTY_SLOT;
    party.push(v === EMPTY_SLOT ? null : v);
  }

  const gil = view.getUint32(GIL_OFFSET, true);
  const playtimeSeconds = view.getUint32(PLAYTIME_OFFSET, true);
  const duplicatesConsistent =
    view.getUint32(GIL_OFFSET_SAVEMAP, true) === gil &&
    view.getUint32(PLAYTIME_OFFSET_SAVEMAP, true) === playtimeSeconds;

  return {
    schemaVersion: 1,
    characters,
    party,
    inventory: readInventory(slot),
    gil,
    playtimeSeconds,
    duplicatesConsistent,
  };
}

/** Spielzeit als `h:mm:ss` — die Darstellung des Originals. */
export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
