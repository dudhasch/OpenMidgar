import type { MenuRect } from './layout.js';

/**
 * Aufteilung des **Gegenstands-Bildschirms** — am Abbild gemessen, nicht
 * geraten.
 *
 * 🔵 **Warum diese Datei überhaupt existiert.** `layout.ts` hält fest, dass die
 * Anordnung des Hauptmenüs unbelegt ist, weil keine Menüaufnahme vorliegt. Für
 * den Gegenstands-Bildschirm gilt das seit dieser Welle **nicht mehr**: Seine
 * Geometrie steht als Datentabelle und als Zeichenkonstanten im PC-Abbild
 * `ff7_en.exe` und ist dort direkt ablesbar (ADR-028 gibt die eigene
 * Codeanalyse frei). Die Zahlen unten sind deshalb durchgehend 🟢, und sie
 * gehören an **eine** Stelle statt verteilt über eine Zeichenfunktion.
 *
 * 🟢 **Woher sie kommen.** `Menu_ItemScreenInit` (`0x00714EF2`) hängt einen
 * Zeiger auf eine Tabelle von vier `int16 x,y,w,h`; für die 640×480-Darstellung
 * ist das `0x00921C78`. Alles Übrige sind unmittelbare Operanden der
 * Zeichenschleifen in `Menu_ItemScreenFrame` (`0x00715105`). Die Fundstellen
 * stehen an jeder Konstante einzeln.
 *
 * 🟢 **Zwei unabhängige Gegenproben, die aufgehen.**
 *
 *  1. Der Bildlaufdeskriptor wird jeden Bildlauf neu geschrieben
 *     (`0x0071570E`…`0x0071574E`): sichtbar 10, gesamt 0x140, Rechteck
 *     `(618,102,17,372)`. Er liegt exakt im Beschnittfenster der Liste
 *     `(0,102,640,372)`, das aus einer ganz anderen Stelle
 *     (`0x00715654`…`0x00715662`) stammt — und 10 Zeilen zu 37 px sind 370 px,
 *     passen also gerade in dessen 372 px.
 *  2. Die Gesamtzeilenzahl 320 ist zeichengleich mit `INVENTORY_ENTRIES` aus
 *     `@webmidgar/formats-save`, das unabhängig davon an Spielständen gemessen
 *     wurde.
 *
 * ⚠️ **Nicht skalieren.** Es gibt im Abbild eine zweite Fassung für 320×240
 * (`0x00921C98`). Ihre **Rechtecke** sind die aufgerundeten Hälften, ihre
 * **Zeichenkonstanten** aber nicht: 37 gegen 19, 36 gegen 18, 373 gegen 186 —
 * der 640er-Wert ist durchweg `2n−1` bzw. `2n+1`. Wer je eine 320er-Darstellung
 * nachbaut, muss deren Konstanten einzeln lesen und darf diese hier nicht
 * halbieren.
 *
 * ⚠️ **Bordüre.** Das Original setzt seine Fensterecken aus 8-px-Kacheln
 * (`_DAT_007B7CC4 = 8.0`) und rückt die Füllung 6 px ein; unsere Schale
 * (`FF7_WINDOW_SKIN`) hat eine an Referenzbildern vermessene 5-px-Bordüre. Das
 * ist kein Widerspruch — von der 8-px-Kachel ist ein Teil durchsichtig —, aber
 * es heißt: Dieser Bildschirm rechnet **absolut** und benutzt weder
 * `contentRect` noch `lineHeight` der Schale. Täte er es, sähe er im Standbild
 * richtig aus und liefe erst beim Blättern auseinander.
 */

/**
 * 🟢 Höhe einer Glyphenzelle in der 640×480-Darstellung: 24 px
 * (`_DAT_007B7D00 = 24.0`, benutzt von der Schriftausgabe des Menüs). Sie ist
 * **nicht** die Zeilenhöhe der Fensterschale (32) — die gilt für Dialogtext.
 * Zeilenkästen dieses Bildschirms sind so hoch wie das, was in ihnen steht.
 */
export const GLYPH_HEIGHT = 24;

/** Ein Element innerhalb einer Listenzeile: Anker relativ zum Bildschirm. */
export interface ItemRowAnchors {
  /** 🟢 Zeilenraster in Pixeln (`IMUL …,0x25` an vier Stellen). */
  pitch: number;
  /** 🟢 Typsymbol, 32×32 (`0x0071590B` x=0x157, `0x00715906` y+0x69). */
  icon: { x: number; dy: number; size: number };
  /** 🟢 Name, linksbündig (`0x00715841` x=0x175, `0x0071583C` y+0x6D). */
  name: { x: number; dy: number };
  /** 🟢 Trennglyphe (Atlaskachel 0xD5), 16×16, **feste** Spalte (`0x00715940`). */
  separator: { x: number; dy: number; size: number };
  /**
   * 🟢 Mengenfeld: drei Stellen mit fester Stiftposition
   * (`0x00715976` x=0x226, `0x00715956` Stellenzahl 3, Stellenabstand 12 —
   * Letzteres, weil das Menümodul `gHiResFontActive` auf 1 setzt,
   * `0x006CD3CF`). Führende Nullen werden nicht gezeichnet, die Menge auf 999
   * geklemmt (`DrawDecimalNumber`, `0x006F9739`).
   */
  count: { x: number; dy: number; digits: number; digitPitch: number };
  /** 🟢 Zeigehand, 48×26 (`0x007151EC` x=0x12A, `0x007151E8` y+0x6D). */
  cursor: { x: number; dy: number; width: number; height: number };
}

/** Anker eines Figurenblocks, relativ zu seinem Ursprung. */
export interface PartyBlockAnchors {
  /** 🟢 Abstand zweier Gruppenplätze (`IMUL …,0x78`). */
  slotPitch: number;
  /** 🟢 Porträtecke (`0x0071559B`-Zweig: x=0x25, y=Slot*0x78+0x74). */
  portrait: { x: number; dy: number; size: number };
  /** 🟢 Ursprung des Werteblocks (x=0x85, y=Slot*0x78+0x7E). */
  block: { x: number; dy: number };
  /**
   * 🟢 Innerer Aufbau des Werteblocks, gelesen an
   * `Menu_DrawCharStatBlock2x` (`0x006C62A2`), Versätze relativ zu `block`:
   * Name (0,0) · „LV" (0,0x1D) · Stufe (0x1E,0x1D) · „HP" (0,0x33) ·
   * HP (0x1E,0x31) · Trenner (0x4F,0x31) · HP-Maximum (0x57,0x31) ·
   * „MP" (0,0x49) · MP (0x1E,0x47) · Trenner (0x4F,0x47) ·
   * MP-Maximum (0x57,0x47) · HP-Balken (0x1E,0x42) · MP-Balken (0x1E,0x58),
   * beide 0x69×2 px.
   */
  name: { x: number; y: number };
  labelLv: { x: number; y: number };
  level: { x: number; y: number; digits: number };
  labelHp: { x: number; y: number };
  hp: { x: number; y: number; digits: number };
  labelMp: { x: number; y: number };
  mp: { x: number; y: number; digits: number };
  /** Trennglyphe zwischen Wert und Maximum. */
  slash: { x: number };
  /** Maximum (zweite Zahl derselben Zeile). */
  max: { x: number };
  /** Balken unter der jeweiligen Zeile. */
  bar: { x: number; hpY: number; mpY: number; width: number; height: number };
  /** 🟢 Zeiger der Zielauswahl (x=0, y=Slot*0x78+0xA1). */
  targetCursor: { x: number; dy: number };
  /** 🟢 Stellenabstand aller Zahlen dieses Blocks. */
  digitPitch: number;
}

export interface ItemScreenLayout {
  /** 🟢 Eingeklapptes Hauptmenü-Kommandofenster mit dem Bildschirmnamen. */
  title: MenuRect;
  titleText: { x: number; y: number };
  /** 🟢 Rechteck 0 der Tabelle — die Reiterzeile, bildschirmbreit. */
  tabs: MenuRect;
  /** 🟢 Reiter i: Text bei `i*93+57`, Zeiger bei `i*93+13`. */
  tab: { textX: number; textY: number; cursorX: number; cursorY: number; pitch: number };
  /** 🟢 Rechteck 1 — die einzeilige Beschreibung. */
  description: MenuRect;
  descriptionText: { x: number; y: number };
  /** 🟢 Rechteck 2 — das große Fenster, bildschirmbreit. */
  list: MenuRect;
  /** 🟢 Beschnitt, in dem Liste und Bildlaufleiste stehen. */
  clip: MenuRect;
  /** 🟢 Nicht aus der Tabelle: jeden Bildlauf per `SetRectShorts` gebaut. */
  party: MenuRect;
  partyBlock: PartyBlockAnchors;
  /** 🟢 Rechteck 3 — das Sortier-Aufklappfenster, nur im Sortiermodus. */
  arrange: MenuRect;
  arrangeRow: { textX: number; textY: number; cursorX: number; cursorY: number; pitch: number };
  /** 🟢 Bildlaufleiste; gilt für Gegenstands- **und** Schlüsselliste. */
  scrollBar: MenuRect;
  row: ItemRowAnchors;
  /** 🟢 Schlüsselliste: zwei Spalten, eigenes Zeilenraster, keine Mengen. */
  keyRow: {
    columns: number;
    columnPitch: number;
    textX: number;
    textY: number;
    pitch: number;
    cursorX: number;
    cursorY: number;
  };
  /** 🟢 Sichtbare Zeilen beider Listen. */
  visibleRows: number;
  /** 🟢 Sichtbare Zeilen der Schlüsselliste (2 Spalten × 10). */
  keyVisibleRows: number;
  /** 🟢 Gesamtzeilen der Gegenstandsliste — 0x140 im Bildlaufdeskriptor. */
  totalRows: number;
}

/**
 * 🟢 Die gemessene Aufteilung. Jede Zahl trägt ihre Fundstelle im Typ oben oder
 * im Kommentar daneben; keine ist gesetzt, geschätzt oder gerundet.
 */
export const FF7_ITEM_SCREEN_LAYOUT: ItemScreenLayout = {
  // Menu_DrawCommandWindow2x (0x006C98A6), gerufen als Erstes bei 0x0071511E:
  // SetRectShorts(0x1DC,0,0xA4,0x33) + Text bei (0x1FC,0xD).
  title: { x: 476, y: 0, width: 164, height: 51 },
  titleText: { x: 508, y: 13 },

  // Tabelle 0x00921C78, Rechteck 0.
  tabs: { x: 0, y: 0, width: 640, height: 51 },
  // 0x00715643 IMUL 0x5D / ADD 0x39, y aus 0x0071563E PUSH 0x11.
  tab: { textX: 57, textY: 17, cursorX: 13, cursorY: 26, pitch: 93 },

  // Rechteck 1; Text 0x007152ED PUSH 0x1B / 0x007152EB PUSH 0x40.
  description: { x: 0, y: 51, width: 640, height: 51 },
  descriptionText: { x: 27, y: 64 },

  // Rechteck 2; Beschnitt 0x00715654…0x00715662.
  list: { x: 0, y: 94, width: 640, height: 386 },
  clip: { x: 0, y: 102, width: 640, height: 372 },

  // 0x007155E7 PUSH 0x180 / 0x007155EC PUSH 0x12C / 0x007155F1 PUSH 0x60.
  party: { x: 0, y: 96, width: 300, height: 384 },
  partyBlock: {
    slotPitch: 120,
    portrait: { x: 37, dy: 116, size: 64 },
    block: { x: 133, dy: 126 },
    name: { x: 0, y: 0 },
    labelLv: { x: 0, y: 29 },
    level: { x: 30, y: 29, digits: 2 },
    labelHp: { x: 0, y: 51 },
    hp: { x: 30, y: 49, digits: 4 },
    labelMp: { x: 0, y: 73 },
    mp: { x: 30, y: 71, digits: 4 },
    slash: { x: 79 },
    max: { x: 87 },
    bar: { x: 30, hpY: 66, mpY: 88, width: 105, height: 2 },
    targetCursor: { x: 0, dy: 161 },
    digitPitch: 12,
  },

  // Rechteck 3; Zeilen 0x007154BF IMUL 0x1A / LEA +0xD, Zeiger 0x00715477 SUB 0x1E.
  arrange: { x: 220, y: 26, width: 145, height: 227 },
  arrangeRow: { textX: 233, textY: 39, cursorX: 190, cursorY: 43, pitch: 26 },

  scrollBar: { x: 618, y: 102, width: 17, height: 372 },

  row: {
    pitch: 37,
    icon: { x: 343, dy: 105, size: 32 },
    name: { x: 373, dy: 109 },
    separator: { x: 548, dy: 114, size: 16 },
    count: { x: 550, dy: 112, digits: 3, digitPitch: 12 },
    cursor: { x: 298, dy: 109, width: 48, height: 26 },
  },

  // 0x00715A7E IMUL 0x125 / ADD 0x35; 0x00715A6A IMUL 0x24 / +0x7C.
  keyRow: { columns: 2, columnPitch: 293, textX: 53, textY: 124, pitch: 36, cursorX: 5, cursorY: 129 },

  visibleRows: 10,
  keyVisibleRows: 10,
  totalRows: 320,
};

/**
 * 🟢 Die Beschriftungen der Reiterzeile. Im Abbild stehen sie als englische
 * Zeichenketten bei `0x00921168` (Schrittweite 0xC, Indizes 0…2); hier stehen
 * die deutschen Entsprechungen, wie überall im Menü (`COMMAND_LABELS`).
 * **Belegt ist die Zahl der Reiter und ihre Reihenfolge**, nicht der Wortlaut
 * der Übersetzung.
 */
export const ITEM_TAB_LABELS = ['Benutzen', 'Sortieren', 'Schlüssel'] as const;

/**
 * 🟢 Die acht Zeilen des Sortier-Aufklappfensters, in der Reihenfolge des
 * Originals (`0x00921168` Indizes 3…10, Schleifengrenze 8 bei `0x00715495`).
 * Auch hier ist die Reihenfolge belegt, der deutsche Wortlaut nicht.
 *
 * ⚠️ Zeile 0 sortiert im Original **nicht**, sondern schaltet in den
 * Handtausch-Modus (`0x00717442`). Die Zeilen 1…7 rufen einen Quicksort über
 * alle 320 Plätze (`0x00714640`).
 */
export const ITEM_ARRANGE_LABELS = [
  'Von Hand',
  'Feld',
  'Kampf',
  'Wurf',
  'Art',
  'Name',
  'Meiste',
  'Wenigste',
] as const;

/**
 * 🟡 Daumen der Bildlaufleiste. Die Formel steht als CONFIRMED im eigenen
 * Decomp-Bestand (`pseudocode/menu-module.md`, Abschnitt „Scroll-bar
 * descriptor"), wurde in dieser Welle aber **nicht selbst am Abbild
 * disassembliert** — deshalb 🟡 und nicht 🟢. Die Maße der Leiste selbst sind
 * dagegen gelesen.
 */
export function scrollThumb(
  bar: MenuRect,
  visible: number,
  total: number,
  first: number,
): { y: number; height: number } {
  if (total <= 0) return { y: bar.y, height: bar.height };
  return {
    y: bar.y + Math.floor((bar.height * first) / total),
    height: Math.floor((bar.height * visible) / total) + 1,
  };
}
