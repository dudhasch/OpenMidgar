import type { CharacterRecord, Savemap } from '@webmidgar/formats-save';
import type { InventoryNameLookup } from '@webmidgar/formats-kernel';
import { barFill, formatDuration, formatNumber, formatRatio } from './format.js';

/**
 * Menü-View-Model (S21) — **lesend**.
 *
 * Das Modul kennt weder DOM noch Three.js. Es übersetzt Savemap und
 * Kernel-Namenslisten in fertige Zeilen; die Darstellung liest sie nur ab.
 * Damit sind alle Ansichten in Node prüfbar, und der Golden-Vergleich läuft
 * über Struktur statt über Pixel — ein Pixelvergleich hätte hier nichts
 * gemessen, was der Strukturvergleich nicht schärfer misst, wäre aber von
 * Schriftrendering und Grafikkarte abhängig.
 *
 * **Es gibt keinen Schreibpfad.** S21 ist ausdrücklich Anzeige: kein Sortieren,
 * kein Benutzen, kein Ausrüsten. Was nicht da ist, kann auch nicht versehentlich
 * einen Spielstand verändern.
 */

/** Quellen des Menüs. Alles, was es braucht, kommt als Daten herein. */
export interface MenuData {
  savemap: Savemap;
  /**
   * Inventarname zu einer Kennung; `null`, wenn unbekannt.
   *
   * ⚠️ **Muss aus `inventoryNameLookup` (S13-Kernel) stammen**, nicht aus einer
   * einzelnen Namensliste. Die Inventarkennung ist bereichskodiert — 0…127
   * Gegenstände, 128…255 Waffen, 256…287 Rüstungen, 288…319 Accessoires —, und
   * eine Nachschlagefunktion über nur eine Liste liefert für alles ab 128
   * entweder nichts oder, schlimmer, den Namen eines fremden Bereichs. Genau
   * das war F18/F24-A: 65 von 79 Inventarzeilen trugen Zaubernamen.
   */
  itemName: InventoryNameLookup;
  /** Anzeigename des aktuellen Ortes; `null`, wenn nicht bestimmbar. */
  locationName: string | null;
}

export type MenuViewId = 'status' | 'party' | 'items' | 'time';

export interface MenuRow {
  /** Stabile Kennung der Zeile — Anker für Tests und für die Darstellung. */
  key: string;
  label: string;
  value: string;
  /** Balkenanteil 0…1, wenn die Zeile einen Balken zeigt. */
  fill?: number;
  /** Zeile ist nicht auswählbar (Überschrift, Trenner). */
  static?: boolean;
}

export interface MenuViewModel {
  view: MenuViewId;
  title: string;
  rows: MenuRow[];
  /** Zeilen, die der Zeiger anspringen kann (Indizes in `rows`). */
  selectable: number[];
}

/**
 * Anzeigename eines Charakters. Ein leerer Name kommt vor (nie beschriebener
 * Platz) und wird als solcher gezeigt — nicht durch einen Kernel-Vorgabenamen
 * ersetzt. Das Akzeptanzkriterium verlangt ausdrücklich den Namen aus der
 * Savemap: Wer seine Figur umbenannt hat, muss den eigenen Namen sehen.
 */
export function characterLabel(c: CharacterRecord): string {
  return c.name.length > 0 ? c.name : '—';
}

function statusRows(c: CharacterRecord): MenuRow[] {
  const p = `c${c.index}`;
  return [
    { key: `${p}.name`, label: 'Name', value: characterLabel(c) },
    { key: `${p}.level`, label: 'Level', value: formatNumber(c.level) },
    { key: `${p}.hp`, label: 'HP', value: formatRatio(c.hp, c.hpMax), fill: barFill(c.hp, c.hpMax) },
    { key: `${p}.mp`, label: 'MP', value: formatRatio(c.mp, c.mpMax), fill: barFill(c.mp, c.mpMax) },
  ];
}

/**
 * Statusansicht eines Charakters. `characterIndex` zeigt in das
 * **Recordarray**, nicht in die Party — so bleibt die Ansicht auch für
 * Figuren erreichbar, die gerade nicht in der Gruppe sind.
 */
export function buildStatusView(data: MenuData, characterIndex: number): MenuViewModel {
  const c = data.savemap.characters[characterIndex];
  if (!c) {
    return { view: 'status', title: 'Status', rows: [{ key: 'leer', label: '', value: 'Kein Charakter', static: true }], selectable: [] };
  }
  const rows: MenuRow[] = [
    ...statusRows(c),
    { key: `c${c.index}.stats`, label: 'Grundwerte', value: c.stats.map((s) => formatNumber(s)).join(' · '), static: true },
  ];
  return { view: 'status', title: `Status — ${characterLabel(c)}`, rows, selectable: [] };
}

/**
 * Gruppenübersicht. Gezeigt werden die drei Gruppenplätze in ihrer
 * Speicherreihenfolge; ein unbesetzter Platz bleibt sichtbar leer, statt die
 * Liste zusammenzuschieben — sonst wäre nicht erkennbar, welcher Platz frei ist.
 */
export function buildPartyView(data: MenuData): MenuViewModel {
  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  data.savemap.party.forEach((id, slot) => {
    if (id === null) {
      rows.push({ key: `p${slot}`, label: `Platz ${slot + 1}`, value: '— frei —', static: true });
      return;
    }
    const c = data.savemap.characters.find((ch) => ch.id === id);
    if (!c) {
      rows.push({ key: `p${slot}`, label: `Platz ${slot + 1}`, value: `Unbekannte Kennung ${id}`, static: true });
      return;
    }
    selectable.push(rows.length);
    rows.push({
      key: `p${slot}`,
      label: characterLabel(c),
      value: `Lv ${formatNumber(c.level)}  HP ${formatRatio(c.hp, c.hpMax)}  MP ${formatRatio(c.mp, c.mpMax)}`,
      fill: barFill(c.hp, c.hpMax),
    });
  });
  return { view: 'party', title: 'Gruppe', rows, selectable };
}

export const ITEMS_PER_PAGE = 10;

/**
 * Gegenstandsliste, seitenweise. Eine Kennung ohne Namen wird als solche
 * angezeigt (`?<Kennung>`) und **nicht ausgelassen**: Eine stillschweigend
 * verkürzte Liste würde die Lücke verstecken, statt sie meldbar zu machen.
 *
 * ✅ Realdaten nach F18/F24-A: Über die vier Spielstände der Installation
 * (79 Inventarzeilen) löst mit `inventoryNameLookup` **jede** Zeile auf —
 * 0 Platzhalter. Unter der alten einlistigen Lesung blieben 14 Platzhalter,
 * und die übrigen 65 Zeilen trugen den falschen Namen.
 */
export function buildItemsView(data: MenuData, page = 0): MenuViewModel {
  const entries = data.savemap.inventory;
  const pages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
  const clamped = Math.max(0, Math.min(pages - 1, page));
  const from = clamped * ITEMS_PER_PAGE;
  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  for (const e of entries.slice(from, from + ITEMS_PER_PAGE)) {
    selectable.push(rows.length);
    rows.push({
      key: `i${e.slot}`,
      label: data.itemName(e.itemId) ?? `?${e.itemId}`,
      value: `×${formatNumber(e.count)}`,
    });
  }
  if (rows.length === 0) rows.push({ key: 'leer', label: '', value: 'Keine Gegenstände', static: true });
  return { view: 'items', title: `Gegenstände (${clamped + 1}/${pages})`, rows, selectable };
}

export function itemPageCount(data: MenuData): number {
  return Math.max(1, Math.ceil(data.savemap.inventory.length / ITEMS_PER_PAGE));
}

/** Gil, Spielzeit und Ort — die Kopfzeile des Originalmenüs als eigene Ansicht. */
export function buildTimeView(data: MenuData): MenuViewModel {
  const rows: MenuRow[] = [
    { key: 'gil', label: 'Gil', value: formatNumber(data.savemap.gil), static: true },
    { key: 'zeit', label: 'Spielzeit', value: formatDuration(data.savemap.playtimeSeconds), static: true },
    { key: 'ort', label: 'Ort', value: data.locationName ?? 'Unbekannt', static: true },
  ];
  // Eine widersprüchliche Doppelablage ist ein Befund und gehört sichtbar in
  // die Ansicht — nicht in ein Protokoll, das niemand liest.
  if (!data.savemap.duplicatesConsistent) {
    rows.push({ key: 'warnung', label: 'Hinweis', value: 'Gil/Spielzeit stehen im Spielstand widersprüchlich', static: true });
  }
  return { view: 'time', title: 'Übersicht', rows, selectable: [] };
}
