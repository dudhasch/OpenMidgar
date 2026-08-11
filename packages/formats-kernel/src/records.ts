import type { KernelContainer, KernelSection } from './container.js';
import { buildAsciiTable, decodeFfText, DEFAULT_ASCII_OFFSET, type FfTextTable } from './text.js';

/**
 * Sektionsrollen und Namenslisten von `kernel.bin` (S21, korrigiert in F18/F24-A).
 *
 * S13 hat den Container erschlossen — 27 Sektionen, gzip, Zeichentabelle. Was
 * *in* den Sektionen steht, war danach offen, und die erste Antwort darauf war
 * **falsch**: Die alte `pickItemTextLists` suchte die Gegenstandsnamen über die
 * Stringanzahl 256 und traf damit die **Zauberliste** (Sektion 18). Gemessen an
 * vier echten Spielständen waren dadurch 65 von 79 Inventarzeilen falsch
 * benannt und 14 gar nicht auflösbar — 0 richtig. Die Fehlerursache steht
 * ausführlich in `tools/realdata-scan/FINDINGS.md`, Abschnitt M4.
 *
 * **Was jetzt gemessen wird.** Die Rollen der Textlisten werden nicht mehr über
 * eine einzelne Kennzahl geraten, sondern über drei Bedingungen, die gemeinsam
 * eindeutig sind:
 *
 *  1. **Anker.** Genau eine Textliste hat 128 Einträge *und* Füllgrad 1,000 —
 *     die Waffennamen. (Realdaten: die fünf 128er-Listen tragen die Füllgrade
 *     0,625 · 0,180 · 0,820 · **1,000** · 0,727. Die reine Länge ist also
 *     fünffach mehrdeutig, die Doppelbedingung nicht.)
 *  2. **Nachbarschaft.** Die Namenslisten liegen als geschlossener Block in
 *     fester Reihenfolge: Kommandos, Magie, Gegenstände, **Waffen**, Rüstungen,
 *     Accessoires, Materia, Schlüsselgegenstände. Vom Anker aus ist damit jede
 *     andere Rolle bestimmt.
 *  3. **Gegenprobe.** Jede so bestimmte Rolle muss ihre erwartete Stringanzahl
 *     tragen (256/128/128/32/32/96/64), und die Gegenstandsliste zusätzlich die
 *     **Belegungsgrenze**: letzter belegter Index 104. Schlägt eine Probe fehl,
 *     wird nicht geraten — die Zuordnung meldet sich als gescheitert.
 *
 * Beschreibungsliste = Namensliste − 8 (derselbe Block, acht Sektionen davor);
 * auch das wird über die Stringanzahl gegengeprüft.
 *
 * 🔵 Bewusst **keine** festen Sektionsnummern: Eine andere Sprachfassung oder
 * ein Mod, der eine Sektion einfügt, würde sie stillschweigend verschieben.
 * Gemessen wird gegen Eigenschaften der Daten, nicht gegen Positionen.
 */

const TABLE: FfTextTable = buildAsciiTable(DEFAULT_ASCII_OFFSET);

export type KernelSectionRole = 'text' | 'record' | 'unbekannt';

export interface KernelTextList {
  sectionIndex: number;
  strings: string[];
  /** Anteil vollständig dekodierter Einträge — unter 1 ist die Liste angebrochen. */
  complete: number;
  /** Anteil nicht leerer Einträge; Basisrate für jede Auflösungsmessung. */
  fillRate: number;
  /** Höchster Index mit nicht leerem Eintrag; −1 bei komplett leerer Liste. */
  lastOccupied: number;
  meanLength: number;
}

export interface KernelSectionInfo {
  index: number;
  length: number;
  role: KernelSectionRole;
  /** Nur bei `role === 'record'`: kleinste Schrittweite, die die Sektion teilt. */
  recordStride: number | null;
  recordCount: number | null;
}

export interface KernelTextIndex {
  sections: KernelSectionInfo[];
  lists: KernelTextList[];
}

/**
 * Anzahl der Gegenstandsplätze. ✅ Realdaten: Die Gegenstandsnamenliste führt
 * **128** Plätze, belegt sind davon 0…104.
 *
 * ⚠️ Bis F18/F24-A stand hier 256 — das war die Stringanzahl der *Zauberliste*
 * und der eigentliche Defekt. Die Zahl bleibt exportiert, weil sie eine echte
 * Formattatsache ist, wird aber für die Listenauswahl nicht mehr benutzt.
 */
export const ITEM_COUNT = 128;

/**
 * Höchster belegter Index der Gegenstandsnamenliste. ✅ Realdaten (deutsche
 * Fassung, `data/kernel/KERNEL.BIN`): Einträge 0…104 sind belegt, 105…127 leer.
 * Das ist die zweite Hälfte der Doppelbedingung aus (1) — die Länge allein ist
 * mehrdeutig, Länge **und** Belegungsgrenze sind es nicht.
 */
export const ITEM_LAST_OCCUPIED = 104;

/** Erwartete Stringanzahl je Namensrolle. ✅ Realdaten, alle sieben gemessen. */
export const NAME_LIST_COUNTS = {
  commands: 32,
  magic: 256,
  items: 128,
  weapons: 128,
  armor: 32,
  accessories: 32,
  materia: 96,
  keyItems: 64,
} as const;

export type KernelNameRole = keyof typeof NAME_LIST_COUNTS;

/**
 * Reihenfolge des Namensblocks. 🟢 Realdaten: Die acht Listen liegen in genau
 * dieser Folge unmittelbar hintereinander (gemessen an den Sektionen 17…24 der
 * deutschen Fassung); unabhängig beschrieben in `docs/fremdquellen/elena.md`
 * §2.1. Der Code verlässt sich auf die **Reihenfolge**, nicht auf die Nummern.
 */
export const NAME_ROLE_ORDER: readonly KernelNameRole[] = [
  'commands',
  'magic',
  'items',
  'weapons',
  'armor',
  'accessories',
  'materia',
  'keyItems',
];

/**
 * Abstand einer Beschreibungsliste zu ihrer Namensliste. 🟢 Realdaten: Die
 * Beschreibungen bilden denselben Block acht Sektionen früher (Sektion 9…16
 * gegen 17…24), Stringanzahlen paarweise gleich.
 */
export const DESCRIPTION_SECTION_DELTA = 8;

/**
 * Liest die Stringanzahl einer Textliste aus ihrem ersten Zeiger. Gibt `null`,
 * wenn die Sektion keine Zeigertabelle hat — das ist die Unterscheidung
 * zwischen Text- und Recordsektion und keine Fehlerbedingung.
 */
export function textListLength(data: Uint8Array): number | null {
  if (data.length < 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const first = view.getUint16(0, true);
  if (first < 2 || first % 2 !== 0 || first > data.length) return null;
  const count = first / 2;
  // Jeder Zeiger muss in die Sektion zeigen. Ohne diese Prüfung würde eine
  // Recordtabelle, deren erste zwei Bytes zufällig gerade sind, als Textliste
  // durchgehen.
  for (let i = 0; i < count; i++) {
    if (view.getUint16(i * 2, true) >= data.length) return null;
  }
  return count;
}

export function readTextList(section: KernelSection): KernelTextList | null {
  const count = textListLength(section.data);
  if (count === null || count === 0) return null;
  const view = new DataView(section.data.buffer, section.data.byteOffset, section.data.byteLength);
  const strings: string[] = [];
  let complete = 0;
  let filled = 0;
  let lengthSum = 0;
  let lastOccupied = -1;
  for (let i = 0; i < count; i++) {
    const decoded = decodeFfText(section.data, TABLE, view.getUint16(i * 2, true));
    strings.push(decoded.text);
    if (decoded.terminated && decoded.unknownBytes === 0) complete++;
    if (decoded.text.trim().length > 0) {
      filled++;
      lastOccupied = i;
    }
    lengthSum += decoded.text.length;
  }
  return {
    sectionIndex: section.index,
    strings,
    complete: complete / count,
    fillRate: filled / count,
    lastOccupied,
    meanLength: lengthSum / count,
  };
}

/**
 * Kleinste Schrittweite, die die Sektion restlos teilt und mindestens vier
 * Records ergibt. Bewusst **ohne** Konstanzmaß: Für das Menü wird die
 * Recordbelegung nicht gebraucht, und eine Schrittweite ohne Belegung wäre
 * eine Zahl, die mehr verspricht, als sie hält. Sie steht nur im Bericht.
 * Die *typisierten* Recordtabellen bestimmt `resolveKernelDataSections`
 * (`data-records.ts`) über Accounting, nicht über diese Heuristik.
 */
function smallestStride(length: number): number | null {
  for (let stride = 4; stride <= 256; stride++) {
    if (length % stride === 0 && length / stride >= 4) return stride;
  }
  return null;
}

export function indexKernelSections(container: KernelContainer): KernelTextIndex {
  const sections: KernelSectionInfo[] = [];
  const lists: KernelTextList[] = [];
  for (const section of container.sections) {
    if (!section.ok || section.data.length === 0) {
      sections.push({ index: section.index, length: section.data.length, role: 'unbekannt', recordStride: null, recordCount: null });
      continue;
    }
    const list = readTextList(section);
    if (list && list.complete > 0.5) {
      lists.push(list);
      sections.push({ index: section.index, length: section.data.length, role: 'text', recordStride: null, recordCount: null });
      continue;
    }
    const stride = smallestStride(section.data.length);
    sections.push({
      index: section.index,
      length: section.data.length,
      role: 'record',
      recordStride: stride,
      recordCount: stride === null ? null : section.data.length / stride,
    });
  }
  return { sections, lists };
}

// --- Rollenbestimmung der Namenslisten --------------------------------------

/** Die vier Listen, aus denen ein Inventareintrag aufgelöst wird (F18). */
export interface InventoryNameLists {
  items: KernelTextList | null;
  weapons: KernelTextList | null;
  armor: KernelTextList | null;
  accessories: KernelTextList | null;
}

export interface KernelNameLists extends InventoryNameLists {
  materia: KernelTextList | null;
  keyItems: KernelTextList | null;
  magic: KernelTextList | null;
  commands: KernelTextList | null;
  /** Beschreibungslisten in derselben Rollenordnung (Namenssektion − 8). */
  descriptions: Record<KernelNameRole, KernelTextList | null>;
  /** Sektionsindex der Waffennamen — der Anker der Zuordnung; `null` bei Fehlschlag. */
  weaponSection: number | null;
  /** Grund, falls die Zuordnung scheiterte oder unvollständig blieb; sonst `null`. */
  reason: string | null;
}

function leereRollen(): Record<KernelNameRole, KernelTextList | null> {
  return { commands: null, magic: null, items: null, weapons: null, armor: null, accessories: null, materia: null, keyItems: null };
}

function leereListen(reason: string | null, weaponSection: number | null = null): KernelNameLists {
  return { ...leereRollen(), descriptions: leereRollen(), weaponSection, reason };
}

/**
 * Bestimmt die Rollen aller Namens- und Beschreibungslisten.
 *
 * Der Anker ist die einzige 128er-Liste mit Füllgrad 1,000 (Waffennamen); von
 * ihr aus wird die Reihenfolge `NAME_ROLE_ORDER` nach vorn und hinten
 * abgetragen und jede Rolle gegen ihre erwartete Stringanzahl geprüft. Die
 * Gegenstandsliste bekommt zusätzlich die Belegungsprobe
 * (`lastOccupied === ITEM_LAST_OCCUPIED`).
 *
 * **Es wird nicht geraten.** Fehlt der Anker oder ist er mehrdeutig, kommt eine
 * leere Zuordnung mit `reason` zurück. Ein Menü ohne Namen ist ein sichtbarer
 * Mangel; ein Menü mit falschen Namen wäre ein unsichtbarer — genau der, der
 * als F18/F24 ein Jahr lang durch die Demo gelaufen ist.
 */
export function resolveKernelNameLists(index: KernelTextIndex): KernelNameLists {
  const bySection = new Map<number, KernelTextList>();
  for (const l of index.lists) bySection.set(l.sectionIndex, l);

  const anker = index.lists.filter(
    (l) => l.strings.length === NAME_LIST_COUNTS.weapons && l.fillRate === 1,
  );
  if (anker.length !== 1) {
    return leereListen(
      anker.length === 0
        ? `kein Anker: keine Liste mit ${NAME_LIST_COUNTS.weapons} Einträgen und Füllgrad 1,000`
        : `Anker mehrdeutig: ${anker.length} Listen mit ${NAME_LIST_COUNTS.weapons} Einträgen und Füllgrad 1,000 (Sektionen ${anker.map((a) => a.sectionIndex).join(', ')})`,
    );
  }
  const weaponSection = anker[0]!.sectionIndex;
  const ankerPos = NAME_ROLE_ORDER.indexOf('weapons');

  const namen = leereRollen();
  const beschreibungen = leereRollen();
  const fehlend: string[] = [];
  for (let i = 0; i < NAME_ROLE_ORDER.length; i++) {
    const rolle = NAME_ROLE_ORDER[i]!;
    const erwartet = NAME_LIST_COUNTS[rolle];
    const sektion = weaponSection + (i - ankerPos);
    const liste = bySection.get(sektion);
    if (!liste || liste.strings.length !== erwartet) {
      fehlend.push(`${rolle}@${sektion}`);
      continue;
    }
    if (rolle === 'items' && liste.lastOccupied !== ITEM_LAST_OCCUPIED) {
      fehlend.push(`items@${sektion} (letzter belegter Index ${liste.lastOccupied}, erwartet ${ITEM_LAST_OCCUPIED})`);
      continue;
    }
    namen[rolle] = liste;
    const beschreibung = bySection.get(sektion - DESCRIPTION_SECTION_DELTA);
    if (beschreibung && beschreibung.strings.length === erwartet) beschreibungen[rolle] = beschreibung;
  }

  return {
    ...namen,
    descriptions: beschreibungen,
    weaponSection,
    reason: fehlend.length > 0 ? `Rollen ohne passende Liste: ${fehlend.join(', ')}` : null,
  };
}

// --- Bereichskodierung der Inventarkennungen (F18) ---------------------------

/**
 * Bereichsgrenzen der Inventarkennung. 🟢 Beleg: `docs/DEMO-FINDINGS-1.0.md`
 * F18 (ff7tk `FF7Item.h`) und die Messung an vier Spielständen — unter dieser
 * Aufteilung lösen **alle 79** vorkommenden Inventarzeilen auf, unter der alten
 * Lesung nur 14 überhaupt (und keine davon richtig).
 *
 * Das Inventarwort selbst ist ein u16: Kennung in den Bits 0–8, Menge in den
 * Bits 9–15 (S21-Messung, `packages/formats-save`).
 */
export const INVENTORY_RANGES = {
  /** 0…127 → Gegenstandsliste, Index = Kennung. */
  itemMax: 127,
  /** 128…255 → Waffenliste, Index = Kennung − 128. */
  weaponBase: 128,
  /** 256…287 → Rüstungsliste, Index = Kennung − 256. */
  armorBase: 256,
  /** 288…319 → Accessoireliste, Index = Kennung − 288. */
  accessoryBase: 288,
  /** Höchste im Inventar mögliche Kennung. */
  max: 319,
} as const;

export type InventoryCategory = 'item' | 'weapon' | 'armor' | 'accessory';

/**
 * Bereich und listenlokaler Index einer Inventarkennung. `null` für Kennungen
 * außerhalb 0…319 — die gibt es im Inventar nicht, und eine erfundene
 * Zuordnung würde den Fehler verstecken statt ihn zu zeigen.
 */
export function inventoryCategory(id: number): { category: InventoryCategory; index: number } | null {
  if (!Number.isInteger(id) || id < 0) return null;
  if (id <= INVENTORY_RANGES.itemMax) return { category: 'item', index: id };
  if (id < INVENTORY_RANGES.armorBase) return { category: 'weapon', index: id - INVENTORY_RANGES.weaponBase };
  if (id < INVENTORY_RANGES.accessoryBase) return { category: 'armor', index: id - INVENTORY_RANGES.armorBase };
  if (id <= INVENTORY_RANGES.max) return { category: 'accessory', index: id - INVENTORY_RANGES.accessoryBase };
  return null;
}

/** Nachschlagefunktion für Inventarnamen; `null` heißt „nicht auflösbar". */
export type InventoryNameLookup = (id: number) => string | null;

/**
 * Nachschlagefunktion über alle vier Bereiche (F18). Unbekannte Kennungen
 * liefern `null` statt eines Platzhalters — der Aufrufer entscheidet, wie er
 * eine Lücke darstellt, und eine Lücke bleibt als Lücke erkennbar.
 */
export function inventoryNameLookup(lists: InventoryNameLists): InventoryNameLookup {
  const quelle: Record<InventoryCategory, KernelTextList | null> = {
    item: lists.items,
    weapon: lists.weapons,
    armor: lists.armor,
    accessory: lists.accessories,
  };
  return (id: number): string | null => {
    const bereich = inventoryCategory(id);
    if (!bereich) return null;
    const text = quelle[bereich.category]?.strings[bereich.index]?.trim();
    return text && text.length > 0 ? text : null;
  };
}

/**
 * Nachschlagefunktion für **Beschreibungen** über alle vier Inventarbereiche
 * (F24-B, Teil 4).
 *
 * Bis hierher hat `resolveKernelNameLists` die Beschreibungslisten zwar
 * bestimmt, aber niemand hat sie abgefragt — das Menü warf sie weg. Der Aufbau
 * ist absichtlich derselbe wie bei {@link inventoryNameLookup}: dieselbe
 * Bereichskodierung, dieselbe `null`-Regel für „nicht auflösbar". Zwei
 * verschiedene Zuordnungslogiken für Name und Beschreibung wären die
 * zuverlässigste Art, F18 ein zweites Mal zu bauen.
 */
export function inventoryDescriptionLookup(lists: {
  descriptions: Pick<Record<KernelNameRole, KernelTextList | null>, 'items' | 'weapons' | 'armor' | 'accessories'>;
}): InventoryNameLookup {
  const quelle: Record<InventoryCategory, KernelTextList | null> = {
    item: lists.descriptions.items,
    weapon: lists.descriptions.weapons,
    armor: lists.descriptions.armor,
    accessory: lists.descriptions.accessories,
  };
  return (id: number): string | null => {
    const bereich = inventoryCategory(id);
    if (!bereich) return null;
    const text = quelle[bereich.category]?.strings[bereich.index]?.trim();
    return text && text.length > 0 ? text : null;
  };
}

/**
 * Nachschlagefunktion über **eine** Liste — für Materia, Zauber, Befehle und
 * Schlüsselgegenstände, die keine Bereichskodierung haben. Bewusst getrennt
 * von {@link inventoryNameLookup} benannt, damit an der Aufrufstelle sichtbar
 * bleibt, welche Sorte Kennung gemeint ist.
 */
export function listNameLookup(list: KernelTextList | null): InventoryNameLookup {
  return (id: number): string | null => {
    const text = list?.strings[id]?.trim();
    return text && text.length > 0 ? text : null;
  };
}

// --- Altlast: einlistige Auswahl (F18-Vorzustand) ----------------------------

export interface ItemTextLists {
  names: KernelTextList | null;
  descriptions: KernelTextList | null;
}

/**
 * @deprecated Ersetzt durch {@link resolveKernelNameLists} +
 * {@link inventoryNameLookup}. Die Funktion liefert nur noch die
 * **Gegenstands**liste; Kennungen ab 128 (Waffen, Rüstungen, Accessoires) sind
 * damit grundsätzlich nicht auflösbar. Sie bleibt ausschließlich als
 * Übergangsschale für noch nicht umgestellte Aufrufer stehen.
 *
 * Die alte Implementierung wählte über `strings.length === 256` und traf damit
 * die Zauberliste — das war der Defekt F18/F24-A.
 */
export function pickItemTextLists(index: KernelTextIndex): ItemTextLists {
  const listen = resolveKernelNameLists(index);
  return { names: listen.items, descriptions: listen.descriptions.items };
}

/**
 * @deprecated Ersetzt durch {@link inventoryNameLookup}. Schlägt nur in einer
 * einzelnen Liste nach und kennt die Bereichskodierung nicht.
 */
export function itemNameLookup(names: KernelTextList | null): InventoryNameLookup {
  return (id: number): string | null => {
    const text = names?.strings[id]?.trim();
    return text && text.length > 0 ? text : null;
  };
}
