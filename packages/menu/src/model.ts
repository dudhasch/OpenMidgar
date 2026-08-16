import { INVENTORY_ENTRIES, type CharacterRecord, type InventoryEntry, type Savemap } from '@webmidgar/formats-save';
import {
  inventoryCategory,
  type FfSpacing,
  type InventoryCategory,
  type InventoryNameLookup,
  type MateriaRecord,
} from '@webmidgar/formats-kernel';
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
  /**
   * Namen der Schlüsselgegenstände (64 Einträge, Kennung = Index) — im
   * `KERNEL.BIN` eine **eigene** Liste, nicht Teil des Inventarbereichs.
   */
  keyItemName?: InventoryNameLookup | undefined;
  /** Beschreibungen der Schlüsselgegenstände. */
  keyItemDescription?: InventoryNameLookup | undefined;
  /**
   * Ist die Inventarkennung **im Menü** benutzbar? `null` heißt „nicht
   * entscheidbar" (keine Recordtabelle geladen) — und dann wird auch nichts
   * ausgegraut, statt eine Vermutung zu zeichnen.
   *
   * 🟢 **Warum das genau die richtige Frage ist.** Der Item-Bildschirm färbt
   * eine Zeile grau, wenn Bit 2 der Nutzungsbeschränkung gesetzt ist
   * (`0x007157F5`…`0x00715801`: `farbe = (b & 4) ? 0 : 7`). Dasselbe Bit
   * dekodiert `@webmidgar/formats-kernel` seit S13 als `canBeUsedInMenu` —
   * dort bitinvertiert gelesen (`RESTRICTION_MENU = 4`), also gesetztes
   * Rohbit ⇔ `canBeUsedInMenu === false`. Zwei unabhängig erhobene Lesungen
   * derselben Stelle, die sich decken.
   */
  itemUsableInMenu?: ((id: number) => boolean | null) | undefined;
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
  /** Schlüsselgegenstände — der dritte Reiter des Gegenstands-Bildschirms. */
  | 'keyItems'
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

  // --- nur die Gegenstandsliste: Felder, die der Bildschirm einzeln setzt ---

  /** Inventarplatz 0…319 (auch für leere Plätze gesetzt). */
  slot?: number;
  /** Inventarkennung; fehlt bei einem leeren Platz. */
  itemId?: number;
  /** Menge als **Zahl** — der Bildschirm zerlegt sie in feste Ziffernstellen. */
  count?: number;
  /** Bereich der Kennung; bestimmt die Symbolkachel. */
  iconCategory?: InventoryCategory;
  /**
   * `false` ⇒ die Zeile wird grau gezeichnet (Original: Farbindex 0 statt 7).
   * Fehlt das Feld, ist die Benutzbarkeit unbekannt und es wird nicht gegraut.
   */
  usable?: boolean;
  /** Der Platz ist leer — sichtbar leer, nicht ausgelassen. */
  empty?: boolean;
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

/**
 * 🟢 Sichtbare Zeilen der Gegenstandsliste. Gemessen an zwei voneinander
 * unabhängigen Stellen des Abbilds: `Menu_ItemScreenInit` (`0x00714EF2`) setzt
 * den Listenzeiger auf 1 Spalte × **10** sichtbare Zeilen, und der
 * Bildlaufdeskriptor (`0x0071570E`) trägt dieselbe 10.
 */
export const VISIBLE_ITEM_ROWS = 10;

/** 🟢 Gesamtzahl der Inventarplätze — 320, wie `INVENTORY_ENTRIES`. */
export const INVENTORY_SLOT_COUNT = INVENTORY_ENTRIES;

/**
 * Die 320 Inventarplätze **mit ihren Lücken**.
 *
 * 🟢 **Warum Lücken und nicht eine verdichtete Liste.** Das Original verdichtet
 * nicht: `SavemapRemoveItem` (`0x006CBE5F`) schreibt beim Aufbrauchen `0xFFFF`
 * an Ort und Stelle und schiebt nichts nach. Genau deshalb gibt es überhaupt
 * einen Sortierbefehl im Menü. Ein verdichtetes Modell hätte diese Lücken
 * versteckt — und mit ihnen den Grund für die halbe Bedienoberfläche.
 *
 * Der Leser in `@webmidgar/formats-save` bleibt unangetastet: Er liefert die
 * belegten Einträge samt ihrem Originalplatz, und diese Funktion legt sie
 * zurück an ihre Stelle. So bleibt ein rein lesender, vielfach benutzter
 * Parser frei von einer Darstellungsfrage.
 */
export function inventorySlots(data: MenuData): Array<InventoryEntry | null> {
  const plaetze: Array<InventoryEntry | null> = new Array(INVENTORY_SLOT_COUNT).fill(null);
  for (const e of data.savemap.inventory) {
    if (e.slot >= 0 && e.slot < INVENTORY_SLOT_COUNT) plaetze[e.slot] = e;
  }
  return plaetze;
}

/** Höchster zulässiger Bildlaufstand der Gegenstandsliste. */
export const MAX_ITEM_SCROLL = INVENTORY_SLOT_COUNT - VISIBLE_ITEM_ROWS;

/**
 * Gegenstandsliste — ein **Fenster von zehn Plätzen** über die 320, nicht mehr
 * eine Seite über die belegten Einträge.
 *
 * 🟢 Das ist die Bauform des Originals: Der Listenzeiger läuft über alle 320
 * Plätze bei zehn sichtbaren Zeilen (`Menu_ItemScreenInit`, `0x00714EF2`), und
 * die Bildlaufleiste rechts zeigt genau diesen Stand. Die vorherige
 * Seitenaufteilung über die belegten Einträge war eine eigene Erfindung: Sie
 * ließ leere Plätze verschwinden, wechselte die Seitenzahl bei jedem
 * Verbrauch und hatte im Original keine Entsprechung.
 *
 * Eine Kennung ohne Namen wird weiterhin als solche angezeigt (`?<Kennung>`)
 * und **nicht ausgelassen**: Eine stillschweigend verkürzte Liste würde die
 * Lücke verstecken, statt sie meldbar zu machen.
 *
 * ✅ Realdaten nach F18/F24-A: Über die vier Spielstände der Installation
 * (79 Inventarzeilen) löst mit `inventoryNameLookup` **jede** Zeile auf —
 * 0 Platzhalter. Unter der alten einlistigen Lesung blieben 14 Platzhalter,
 * und die übrigen 65 Zeilen trugen den falschen Namen.
 */
export function buildItemsView(data: MenuData, scrollTop = 0): MenuViewModel {
  const plaetze = inventorySlots(data);
  const oben = Math.max(0, Math.min(MAX_ITEM_SCROLL, Math.trunc(scrollTop)));
  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  let unbekannteBenutzbarkeit = false;

  for (let i = 0; i < VISIBLE_ITEM_ROWS; i++) {
    const platz = oben + i;
    const e = plaetze[platz] ?? null;
    if (!e) {
      // Ein leerer Platz bleibt eine Zeile — er ist anspringbar, denn das
      // Original lässt den Zeiger über ihn laufen (der Listenzeiger kennt nur
      // 320 Zeilen, keine Belegung).
      selectable.push(rows.length);
      rows.push({ key: `i${platz}`, label: '', value: '', slot: platz, empty: true });
      continue;
    }
    // F24-B Teil 4: Die Beschreibung wurde bisher weggeworfen. Fehlt sie,
    // bleibt das Feld weg — ein Ersatztext wäre eine Erfindung.
    const beschreibung = data.itemDescription?.(e.itemId) ?? null;
    const bereich = inventoryCategory(e.itemId);
    const benutzbar = data.itemUsableInMenu?.(e.itemId) ?? null;
    if (benutzbar === null) unbekannteBenutzbarkeit = true;
    selectable.push(rows.length);
    rows.push({
      key: `i${platz}`,
      label: data.itemName(e.itemId) ?? `?${e.itemId}`,
      value: `×${formatNumber(e.count)}`,
      slot: platz,
      itemId: e.itemId,
      count: e.count,
      ...(bereich ? { iconCategory: bereich.category } : {}),
      ...(benutzbar === null ? {} : { usable: benutzbar }),
      ...(beschreibung ? { description: beschreibung } : {}),
    });
  }

  const notes: string[] = [];
  if (!data.itemDescription) notes.push('Keine Beschreibungsliste geladen — Gegenstandstexte fehlen');
  if (unbekannteBenutzbarkeit) {
    notes.push(
      'Keine Gegenstands-Recordtabelle geladen — nichts wird ausgegraut; das Original graut, was im Menü gesperrt ist',
    );
  }
  return { view: 'items', title: 'Gegenstände', rows, selectable, notes };
}

/**
 * Schlüsselgegenstände: zwei Spalten, zeilenweise gefüllt, ohne Menge.
 *
 * 🟢 Die Füllrichtung ist gelesen, nicht gewählt: Die Zeichenschleife
 * (`0x007159FD`…`0x00715A2B`) und der Zeigerindex (`0x007153CC`) rechnen beide
 * `Index = Spalte + 2·(Oberkante + Zeile)` — also links, rechts, nächste Zeile.
 * Diese Ansicht ist im Original **reine Anzeige**: ihr Untermodus hat keinen
 * Bestätigen-Zweig (`0x007173AE` liest ausschließlich Abbrechen).
 */
export function buildKeyItemsView(data: MenuData, scrollTop = 0): MenuViewModel {
  const besessen = data.savemap.keyItems;
  const zeilen = Math.ceil(besessen.length / 2);
  const oben = Math.max(0, Math.min(Math.max(0, zeilen - VISIBLE_ITEM_ROWS), Math.trunc(scrollTop)));
  const rows: MenuRow[] = [];
  const selectable: number[] = [];
  for (let i = 0; i < VISIBLE_ITEM_ROWS * 2; i++) {
    const index = oben * 2 + i;
    const id = besessen[index];
    if (id === undefined) {
      rows.push({ key: `k${index}`, label: '', value: '', slot: index, empty: true, static: true });
      continue;
    }
    const beschreibung = data.keyItemDescription?.(id) ?? null;
    selectable.push(rows.length);
    rows.push({
      key: `k${index}`,
      label: data.keyItemName?.(id) ?? `?${id}`,
      value: '',
      slot: index,
      itemId: id,
      ...(beschreibung ? { description: beschreibung } : {}),
    });
  }
  const notes: string[] = [];
  if (!data.keyItemName) notes.push('Keine Schlüsselgegenstands-Namensliste geladen — Kennungen statt Namen');
  return { view: 'keyItems', title: 'Schlüsselgegenstände', rows, selectable, notes };
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
