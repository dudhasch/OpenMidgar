import type { KernelContainer, KernelSection } from './container.js';
import { buildAsciiTable, decodeFfText, DEFAULT_ASCII_OFFSET, type FfTextTable } from './text.js';

/**
 * Sektionsrollen und Namenslisten von `kernel.bin` (S21).
 *
 * S13 hat den Container erschlossen — 27 Sektionen, gzip, Zeichentabelle. Was
 * *in* den Sektionen steht, blieb offen. Für das lesende Menü wird davon genau
 * eines gebraucht: die Liste der Gegenstandsnamen.
 *
 * **Die Sektionsnummer ist hier bewusst keine Konstante.** Sie wird bei jedem
 * Laden neu bestimmt, weil eine fest verdrahtete Nummer bei einer anderen
 * Sprachfassung oder einem anderen Release stillschweigend das Falsche liefern
 * würde. Bestimmt wird sie über drei Eigenschaften, die alle messbar sind:
 *
 *  1. **Textliste oder Recordtabelle?** Eine Textliste beginnt mit einer
 *     Zeigertabelle; der erste Zeiger zeigt genau hinter sie, seine Hälfte ist
 *     also die Stringanzahl. Eine Recordtabelle hat das nicht.
 *  2. **Welche Textliste gehört zu den Gegenständen?** Die mit der passenden
 *     Anzahl (Realdaten: 256) — und davon gibt es genau zwei.
 *  3. **Namen oder Beschreibungen?** Beschreibungen sind im Mittel deutlich
 *     länger (gemessen 13,0 gegen 7,1 Zeichen).
 *
 * Wer die Auswahl nachvollziehen will, bekommt sie mit: `KernelTextIndex`
 * führt alle gefundenen Listen samt Kennzahlen, nicht nur die ausgewählte.
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
 * Anzahl der Gegenstandsplätze. ✅ Realdaten: Genau zwei Textlisten führen 256
 * Einträge, und die im Spielstand vorkommenden Kennungen lösen in ihnen mit
 * einem Zugewinn von +0,26 bzw. +0,20 über der Basisrate auf — alle übrigen
 * Listen bleiben bei ≤ +0,08.
 */
export const ITEM_COUNT = 256;

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
  for (let i = 0; i < count; i++) {
    const decoded = decodeFfText(section.data, TABLE, view.getUint16(i * 2, true));
    strings.push(decoded.text);
    if (decoded.terminated && decoded.unknownBytes === 0) complete++;
    if (decoded.text.trim().length > 0) filled++;
    lengthSum += decoded.text.length;
  }
  return {
    sectionIndex: section.index,
    strings,
    complete: complete / count,
    fillRate: filled / count,
    meanLength: lengthSum / count,
  };
}

/**
 * Kleinste Schrittweite, die die Sektion restlos teilt und mindestens vier
 * Records ergibt. Bewusst **ohne** Konstanzmaß: Für das Menü wird die
 * Recordbelegung nicht gebraucht, und eine Schrittweite ohne Belegung wäre
 * eine Zahl, die mehr verspricht, als sie hält. Sie steht nur im Bericht.
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

export interface ItemTextLists {
  names: KernelTextList | null;
  descriptions: KernelTextList | null;
}

/**
 * Wählt aus den gefundenen Listen die Gegenstandsnamen und -beschreibungen.
 *
 * Gibt es weniger als zwei Listen der erwarteten Länge, wird **nicht geraten**:
 * Dann bleibt `descriptions` leer, und bei gar keinem Treffer auch `names`.
 * Ein Menü ohne Gegenstandsnamen ist ein sichtbarer Mangel; ein Menü mit
 * falschen Gegenstandsnamen wäre ein unsichtbarer.
 */
export function pickItemTextLists(index: KernelTextIndex, count = ITEM_COUNT): ItemTextLists {
  const passend = index.lists.filter((l) => l.strings.length === count).sort((a, b) => a.meanLength - b.meanLength);
  return {
    names: passend[0] ?? null,
    descriptions: passend.length >= 2 ? passend[passend.length - 1]! : null,
  };
}

/**
 * Nachschlagefunktion für Gegenstandsnamen. Unbekannte Kennungen liefern
 * `null` statt eines Platzhalters — der Aufrufer entscheidet, wie er eine
 * Lücke darstellt, und eine Lücke bleibt als Lücke erkennbar.
 */
export function itemNameLookup(names: KernelTextList | null): (id: number) => string | null {
  return (id: number): string | null => {
    const text = names?.strings[id]?.trim();
    return text && text.length > 0 ? text : null;
  };
}
