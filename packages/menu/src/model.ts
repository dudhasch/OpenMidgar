import type { CharacterRecord, Savemap } from '@webmidgar/formats-save';
import type { FfSpacing, InventoryNameLookup, MateriaRecord } from '@webmidgar/formats-kernel';
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
 * **Dieses Modul hat keinen Schreibpfad** — und behält ihn auch nicht. Seit
 * Welle 4 kann das Menü ausrüsten und speichern (F07), aber nicht hier: Die
 * Handlungen liegen in `actions.ts` und laufen über einen Wirt, der die Bytes
 * schreibt. Ein View-Model, das nebenbei den Spielstand ändert, wäre genau die
 * Bauform, die diese Trennung verhindern soll.
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
  /**
   * **Ersatz**-Ortsname des Wirts (Feldname, „Weltkarte", …).
   *
   * ⚠️ Seit F24-B ist das nicht mehr die Hauptquelle. Der Ortsname steht in
   * der Savemap (0x0F0C, ersatzweise 0x0028 im Vorschaublock) und ist dort
   * gemessen belegt; siehe {@link resolveLocation}. Dieses Feld greift nur,
   * wenn beide Ablagen leer sind — und die Ansicht macht sichtbar, dass sie
   * es getan hat.
   */
  locationName: string | null;

  // --- ab hier optional: die neuen Ansichten (F24-B, Teil 2 und 4) ----------

  /**
   * Beschreibungstext zu einer Inventarkennung (F24-B, Teil 4). Kommt aus
   * `inventoryDescriptionLookup` (S13-Kernel). Fehlt er, zeigt die
   * Gegenstandsansicht keine Beschreibung — statt einer erfundenen.
   */
  itemDescription?: InventoryNameLookup | undefined;
  /** Materianamen (96 Einträge, Kennung = Index). */
  materiaName?: InventoryNameLookup | undefined;
  /** Zaubernamen (256 Einträge, Kennung = Index). */
  magicName?: InventoryNameLookup | undefined;
  /** Materia-Recordtabelle aus `KERNEL.BIN` — für Stufe und Zauberzuordnung. */
  materiaRecords?: readonly MateriaRecord[] | undefined;
  /**
   * Gemessene Glyphenmetrik aus `WINDOW.BIN`. **Muss** aus `dialogMetrics`
   * stammen; `metricsMeasured === false` gehört sichtbar in die Ansicht.
   */
  spacing?: FfSpacing | undefined;
  metricsMeasured?: boolean | undefined;
  metricsDiagnostic?: string | null | undefined;
}

export type MenuViewId =
  | 'main'
  | 'status'
  | 'party'
  | 'items'
  | 'time'
  | 'equip'
  | 'materia'
  | 'magic'
  | 'limit'
  | 'phs'
  | 'config'
  /** Auswahlliste einer Handlung (Ausrüsten) — F07, Welle 4. */
  | 'pick'
  /** Spielstandsplätze. */
  | 'save';

export interface MenuRow {
  /** Stabile Kennung der Zeile — Anker für Tests und für die Darstellung. */
  key: string;
  label: string;
  value: string;
  /** Balkenanteil 0…1, wenn die Zeile einen Balken zeigt. */
  fill?: number;
  /** Färbung des Balkens; ohne Angabe wie HP. */
  barTone?: 'hp' | 'mp' | 'limit' | 'exp';
  /** Zeile ist nicht auswählbar (Überschrift, Trenner). */
  static?: boolean;
  /**
   * Beschreibungstext aus den Kernel-Beschreibungslisten (F24-B, Teil 4).
   * Fehlt, wenn keine Beschreibung auflösbar ist — nie ein Ersatztext.
   */
  description?: string;
}

export interface MenuViewModel {
  view: MenuViewId;
  title: string;
  rows: MenuRow[];
  /** Zeilen, die der Zeiger anspringen kann (Indizes in `rows`). */
  selectable: number[];
  /**
   * Hinweise, die **in der Ansicht** stehen müssen — nicht in einem Protokoll.
   * Hier landet alles, was nicht gemessen ist: Ersatzmetrik statt
   * `WINDOW.BIN`, geratener Ortsname, unbelegte Zauberzuordnung. Eine Ansicht,
   * die ihre eigenen Unsicherheiten verschweigt, ist genau der Fehler, der
   * F18/F24-A eine Welle lang unentdeckt gelassen hat.
   */
  notes?: string[];
}

/**
 * Woher der angezeigte Ortsname kommt. Die Reihenfolge ist die Rangfolge der
 * Quellen, und sie ist **gemessen** (siehe `LOCATION_NAME_OFFSET` in
 * `@webmidgar/formats-save`): Die Savemap-Fassung ist die laufende, der
 * Vorschaublock die beim Speichern festgehaltene; der Wirtsname ist gar keine
 * Spielstandsangabe und deshalb der letzte Ausweg.
 */
export type LocationSource = 'savemap' | 'preview' | 'wirt' | 'keiner';

export interface ResolvedLocation {
  name: string | null;
  source: LocationSource;
  /** Hinweis, wenn die Quelle nicht die Savemap ist; sonst `null`. */
  note: string | null;
}

/**
 * Bestimmt den anzuzeigenden Ortsnamen (F24-B, Teil 3).
 *
 * 🟢 **Beleg** (Probe `menu-views-probe.rdtest.ts`, V1): Ein Sweep über alle
 * 4340 Offsets des Slots findet in den acht belegten Spielständen der
 * Installation **genau zwei** eigenständige Stellen, an denen durchgehend ein
 * terminiertes, druckbares und über die Stände variierendes Namensfeld steht —
 * 0x0028 und 0x0F0C. Auf byteweise verwürfelten Slots findet derselbe Sweep
 * **null** Stellen. Wo beide Ablagen gefüllt sind, tragen sie denselben Text
 * (7/7).
 *
 * Der achte Stand ist ein Notspeicherstand: Savemap-Feld leer, Vorschaublock
 * gefüllt. Genau deshalb ist der Vorschaublock hier zweite Quelle und nicht
 * bloß eine Gegenprobe.
 */
export function resolveLocation(data: MenuData): ResolvedLocation {
  const sm = data.savemap.locationName ?? '';
  if (sm.length > 0) return { name: sm, source: 'savemap', note: null };
  const pv = data.savemap.previewLocationName ?? '';
  if (pv.length > 0) {
    return {
      name: pv,
      source: 'preview',
      note: 'Ort aus dem Vorschaublock (0x0028) — die laufende Ablage 0x0F0C ist leer',
    };
  }
  if (data.locationName) {
    return {
      name: data.locationName,
      source: 'wirt',
      note: 'Ort nicht aus dem Spielstand, sondern vom Wirt gemeldet (Feldname) — 🟡',
    };
  }
  return { name: null, source: 'keiner', note: 'Kein Ortsname im Spielstand' };
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
    // F24-B Teil 4: Die Beschreibung wurde bisher weggeworfen. Fehlt sie,
    // bleibt das Feld weg — ein Ersatztext wäre eine Erfindung.
    const beschreibung = data.itemDescription?.(e.itemId) ?? null;
    rows.push({
      key: `i${e.slot}`,
      label: data.itemName(e.itemId) ?? `?${e.itemId}`,
      value: `×${formatNumber(e.count)}`,
      ...(beschreibung ? { description: beschreibung } : {}),
    });
  }
  if (rows.length === 0) rows.push({ key: 'leer', label: '', value: 'Keine Gegenstände', static: true });
  const notes = data.itemDescription ? [] : ['Keine Beschreibungsliste geladen — Gegenstandstexte fehlen'];
  return { view: 'items', title: `Gegenstände (${clamped + 1}/${pages})`, rows, selectable, notes };
}

export function itemPageCount(data: MenuData): number {
  return Math.max(1, Math.ceil(data.savemap.inventory.length / ITEMS_PER_PAGE));
}

/** Gil, Spielzeit und Ort — die Kopfzeile des Originalmenüs als eigene Ansicht. */
export function buildTimeView(data: MenuData): MenuViewModel {
  const ort = resolveLocation(data);
  const rows: MenuRow[] = [
    { key: 'gil', label: 'Gil', value: formatNumber(data.savemap.gil), static: true },
    { key: 'zeit', label: 'Spielzeit', value: formatDuration(data.savemap.playtimeSeconds), static: true },
    { key: 'ort', label: 'Ort', value: ort.name ?? 'Unbekannt', static: true },
  ];
  // Eine widersprüchliche Doppelablage ist ein Befund und gehört sichtbar in
  // die Ansicht — nicht in ein Protokoll, das niemand liest.
  if (!data.savemap.duplicatesConsistent) {
    rows.push({ key: 'warnung', label: 'Hinweis', value: 'Gil/Spielzeit stehen im Spielstand widersprüchlich', static: true });
  }
  const notes: string[] = [];
  if (ort.note) notes.push(ort.note);
  if (data.savemap.locationConsistent === false) {
    notes.push('Ortsname steht im Spielstand doppelt und widersprüchlich (0x0028 ≠ 0x0F0C)');
  }
  return { view: 'time', title: 'Übersicht', rows, selectable: [], notes };
}
