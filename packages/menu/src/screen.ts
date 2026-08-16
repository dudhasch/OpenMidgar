import { glyphMetricsFrom, type GlyphMetrics } from '@webmidgar/dialog';
import { FALLBACK_SPACING, type FfSpacing } from '@webmidgar/formats-kernel';
import { MENU_ITEM_ORDER, istVordereReihe } from '@webmidgar/formats-save';
import {
  borderThickness,
  FF7_WINDOW_SKIN,
  WindowDisplayMode,
  type WindowSkin,
} from '@webmidgar/ui-window';
import { barFill, formatDuration, formatNumber, formatRatio } from './format.js';
import {
  CURSOR_SPALTE,
  FF7_MAIN_MENU_LAYOUT,
  MENU_SURFACE,
  type MainMenuLayout,
  type MenuRect,
} from './layout.js';
import { characterLabel, resolveLocation, type MenuData, type MenuViewModel } from './model.js';
import { menuItemStates } from './views.js';

/**
 * **Der Bildschirm als Daten** (F24-B, Teil 1 und 5).
 *
 * 🔵 **Warum hier und nicht in der Demo.** Die Demo hat das Menü bisher als
 * HTML-Tabelle in einem Kasten gezeichnet — `<table>`, Monospace, 2-px-Rand,
 * abgerundete Ecken. Das war in zwei Bewertungsrunden zu 100 % das Urteil
 * „katastrophal", und es war nicht zu reparieren, ohne dieselbe Optik ein
 * drittes Mal irgendwo hinzuschreiben. Deshalb beschreibt dieses Modul den
 * Bildschirm vollständig als Daten: Fenster mit Rechtecken und
 * Darstellungsart, Zeilen mit Spaltenankern in Pixeln, Balken mit Anteil. Die
 * Demo **zeichnet nur noch ab** — sie entscheidet nichts.
 *
 * 🔵 **Die Schale wird benutzt, nicht nachgebaut.** Farben, Bordüre, Verlauf,
 * Zeilenhöhe und Polsterung kommen aus `FF7_WINDOW_SKIN`
 * (`@webmidgar/ui-window`). In dieser Datei steht keine einzige Farbe.
 *
 * 🟢 **Die Textbreiten kommen aus `WINDOW.BIN`.** Spaltenanker und
 * Rechtsbündigkeit werden mit der gemessenen Glyphenmetrik gerechnet, nicht
 * mit einer geschätzten Zeichenbreite. Fehlt die Datei, wird die Ersatzmetrik
 * benutzt — aber **laut**: `metricsMeasured === false` und ein Hinweis in
 * `notes`, der in der Ansicht landet.
 */

/**
 * Farbe eines Textlaufs als **Palettenzeile des Fontblatts**, nicht als
 * CSS-Wert. Das Original schaltet Textfarben genauso: Es wählt eine CLUT, kein
 * RGB. Die acht Zeilen sind in `@webmidgar/ui-window` als `FontPalette`
 * gemessen; hier steht nur die Zahl, damit dieses Paket keine Farbe kennt.
 */
export type MenuPaletteRow = number;

export interface MenuTextRun {
  text: string;
  /** Ankerposition in Pixeln, relativ zur Textfläche des Fensters. */
  x: number;
  /** `left` = ab `x` nach rechts, `right` = bis `x` nach links. */
  align: 'left' | 'right';
  /** Gedämpft dargestellt (gesperrter Menüpunkt, leerer Platz). */
  dim?: boolean;
  /** Gemessene Breite in Pixeln — die Demo braucht sie nicht neu zu rechnen. */
  width: number;
  /**
   * Palettenzeile, wenn die Zeile nicht in der Vorgabefarbe steht. Ohne Angabe
   * gilt Weiß — dieselbe Vorgabe wie im Original (Farbindex 7).
   */
  palette?: MenuPaletteRow;
  /**
   * Kein Text, sondern ein **Feld**: `icon` ist das Typsymbol der
   * Gegenstandszeile, `portrait` das Figurenbild. Beide Grafiken liegen in
   * `menu_us.lgp` und sind im Baum nicht vorhanden (🔴) — der Bildschirm
   * reserviert deshalb nur ihren Platz und sagt in `notes`, dass er es tut.
   * Ein gezeichneter Ersatz wäre eine stille Erfindung.
   */
  kind?: 'text' | 'icon' | 'portrait';
  /** Kantenlänge für `icon`/`portrait`. */
  size?: number;
  /** Für `icon`: der Inventarbereich, dessen Kachel gemeint ist. */
  iconCategory?: 'item' | 'weapon' | 'armor' | 'accessory';
  /**
   * Feinversatz gegen die Oberkante der Zeile. Das Original setzt die
   * Elemente einer Gegenstandszeile auf **eine** optische Mittellinie und
   * gleicht dafür ihre verschiedenen Höhen (32/24/16) über den y-Wert aus —
   * genau dieser Ausgleich steht hier.
   */
  dy?: number;
}

export type BarTone = 'hp' | 'mp' | 'limit' | 'exp';

export interface MenuBar {
  x: number;
  width: number;
  /** Füllanteil 0…1. */
  fill: number;
  tone: BarTone;
  /**
   * Oberkante, wenn der Balken nicht auf der Zeilenmitte sitzt. Im
   * Gegenstands-Bildschirm ist das der Regelfall: Die HP-/MP-Balken der
   * Figurenspalte stehen dort **unter** ihrer Zahlenzeile.
   */
  y?: number;
  /** Höhe, wenn nicht die Vorgabe des Malers gelten soll. */
  height?: number;
}

export interface MenuScreenLine {
  key: string;
  /** Oberkante der Zeile, relativ zur Textfläche (bzw. absolut, s. `MenuPanel.absolute`). */
  y: number;
  runs: MenuTextRun[];
  bars: MenuBar[];
  /** Der Zeiger kann hier stehen. */
  selectable: boolean;
  /** Der Zeiger steht hier. */
  cursor: boolean;
  /** Höhe der Textkästen dieser Zeile; ohne Angabe die Zeilenhöhe der Schale. */
  height?: number;
  /** Lage des Zeigers, wenn er nicht am linken Fensterrand steht. */
  cursorRect?: MenuRect;
}

/** Bildlaufleiste eines Fensters — Maße und Stand, nicht der Daumen selbst. */
export interface MenuScrollBar {
  /** Rechteck der Leiste in Bildschirmkoordinaten. */
  rect: MenuRect;
  visible: number;
  total: number;
  first: number;
}

export interface MenuPanel {
  id: string;
  /** Außenmaß auf der Menüfläche. */
  rect: MenuRect;
  /** Textfläche innerhalb von Bordüre und Polsterung. */
  content: MenuRect;
  mode: WindowDisplayMode;
  lines: MenuScreenLine[];
  /**
   * `true` heißt: Zeilen-`y` und Lauf-`x` sind **Bildschirmkoordinaten**, nicht
   * Versätze in der Textfläche. Nötig für den Gegenstands-Bildschirm, dessen
   * Anker im Original absolut gesetzt sind und dessen Zeilenraster (37 px)
   * nicht die Zeilenhöhe der Schale ist.
   */
  absolute?: boolean;
  /** Fenster zeigt eine Bildlaufleiste. */
  scroll?: MenuScrollBar;
  /** Zeichenbereich, außerhalb dessen Zeilen nicht erscheinen. */
  clip?: MenuRect;
}

export interface MenuScreen {
  surface: { width: number; height: number };
  panels: MenuPanel[];
  /** Hinweise, die sichtbar in den Bildschirm gehören. */
  notes: string[];
  /** false = Ersatzmetrik statt `WINDOW.BIN`. Gehört angezeigt. */
  metricsMeasured: boolean;
}

/** Metrik eines Menüaufbaus — alles, was die Breitenrechnung braucht. */
export interface ScreenMetrics {
  glyphs: GlyphMetrics;
  skin: WindowSkin;
  lineHeight: number;
}

/**
 * Beschafft die Metrik. Der Rückfall ist derselbe wie im Dialog: Fehlt die
 * gemessene Tabelle, wird die Ersatzmetrik benutzt **und gemeldet**.
 */
export function screenMetrics(spacing: FfSpacing | undefined, skin: WindowSkin = FF7_WINDOW_SKIN): ScreenMetrics {
  const sp = spacing ?? FALLBACK_SPACING;
  return { glyphs: glyphMetricsFrom(sp, skin.lineHeight), skin, lineHeight: skin.lineHeight };
}

/**
 * Textbreite in Pixeln nach der gemessenen Glyphentabelle.
 *
 * Zeichen außerhalb des linearen ASCII-Fensters (Umlaute, `×`, `★`, `○`)
 * fallen auf `defaultWidth` zurück — die Breite von `O`. Das ist eine
 * Näherung und sie ist bewusst nicht versteckt: Für die Spaltenausrichtung
 * eines Menüs reicht sie, für pixelgenaues Zeichnen aus dem Fontblatt nicht.
 */
export function textWidth(text: string, m: ScreenMetrics): number {
  let w = 0;
  for (const ch of text) w += m.glyphs.widths[ch] ?? m.glyphs.defaultWidth;
  return w;
}

function run(text: string, x: number, align: 'left' | 'right', m: ScreenMetrics, dim = false): MenuTextRun {
  return { text, x, align, width: textWidth(text, m), ...(dim ? { dim: true } : {}) };
}

/** Textfläche eines Fensters: Außenmaß minus Bordüre minus Polsterung. */
export function contentRect(rect: MenuRect, skin: WindowSkin = FF7_WINDOW_SKIN): MenuRect {
  const b = borderThickness(skin);
  const [links, oben, rechts, unten] = skin.padding;
  return {
    x: rect.x + b + links,
    y: rect.y + b + oben,
    width: Math.max(0, rect.width - 2 * b - links - rechts),
    height: Math.max(0, rect.height - 2 * b - oben - unten),
  };
}

/** Wie viele Zeilen passen in ein Fenster dieser Höhe? */
export function linesInPanel(rect: MenuRect, m: ScreenMetrics): number {
  return Math.max(0, Math.floor(contentRect(rect, m.skin).height / m.lineHeight));
}

function panel(id: string, rect: MenuRect, lines: MenuScreenLine[], m: ScreenMetrics): MenuPanel {
  return { id, rect, content: contentRect(rect, m.skin), mode: WindowDisplayMode.Normal, lines };
}

// --- Hauptmenü --------------------------------------------------------------

/** Anzeigenamen der Kommandospalte. Reihenfolge = `MENU_ITEM_ORDER` (🟡). */
export const COMMAND_LABELS: Readonly<Record<(typeof MENU_ITEM_ORDER)[number], string>> = {
  item: 'Gegenstand',
  magic: 'Zauber',
  materia: 'Materia',
  equip: 'Ausrüstung',
  status: 'Status',
  formation: 'Reihe',
  limit: 'Limit',
  config: 'Konfig.',
  phs: 'PHS',
  save: 'Speichern',
};

export interface MainScreenState {
  /** Index in der **sichtbaren** Kommandoliste. */
  commandCursor: number;
  /** Gruppenplatz, auf dem der Zeiger steht; `null` = Kommandospalte aktiv. */
  partyCursor: number | null;
}

/**
 * Der Hauptbildschirm des Menüs.
 *
 * Aufbau: Kommandospalte, Gruppenfenster, Ort, Zeit/Gil. Die Anordnung ist
 * 🟡 und steckt vollständig in `layout` — siehe `layout.ts` für den Grund,
 * warum sie nicht belegt werden konnte.
 */
export function buildMainScreen(
  data: MenuData,
  state: MainScreenState = { commandCursor: 0, partyCursor: null },
  layout: MainMenuLayout = FF7_MAIN_MENU_LAYOUT,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): MenuScreen {
  const m = screenMetrics(data.spacing, skin);
  const notes: string[] = [];
  if (data.metricsMeasured === false && data.metricsDiagnostic) notes.push(data.metricsDiagnostic);
  else if (data.spacing === undefined) notes.push('Keine Glyphenmetrik übergeben — Ersatzbreiten, Spalten sind Schätzwerte');

  // --- Kommandospalte ---
  const befehlsFlaeche = contentRect(layout.commands, skin);
  const sichtbar = menuItemStates(data).filter((s) => s.visible);
  const befehlsZeilen: MenuScreenLine[] = sichtbar.map((s, i) => ({
    key: `cmd.${s.key}`,
    y: i * m.lineHeight,
    runs: [run(COMMAND_LABELS[s.key], CURSOR_SPALTE, 'left', m, s.locked)],
    bars: [],
    selectable: !s.locked,
    cursor: state.partyCursor === null && i === state.commandCursor,
  }));
  void befehlsFlaeche;

  // --- Gruppenfenster ---
  const gruppenFlaeche = contentRect(layout.party, skin);
  const gruppenZeilen: MenuScreenLine[] = [];
  data.savemap.party.forEach((id, slot) => {
    const oben = slot * layout.partyEntryHeight;
    const c = id === null ? null : data.savemap.characters.find((ch) => ch.id === id);
    if (!c) {
      gruppenZeilen.push({
        key: `party.${slot}`,
        y: oben,
        runs: [run('— frei —', 0, 'left', m, true)],
        bars: [],
        selectable: false,
        cursor: false,
      });
      return;
    }
    const gewaehlt = state.partyCursor === slot;
    gruppenZeilen.push({
      key: `party.${slot}.name`,
      y: oben,
      runs: [
        run(characterLabel(c), 0, 'left', m),
        run(istVordereReihe(c.row) ? 'vorne' : 'hinten', gruppenFlaeche.width, 'right', m, true),
      ],
      bars: [],
      selectable: true,
      cursor: gewaehlt,
    });
    gruppenZeilen.push({
      key: `party.${slot}.level`,
      y: oben + m.lineHeight,
      runs: [run('LV', 0, 'left', m), run(formatNumber(c.level), layout.columns.second, 'right', m)],
      bars: [],
      selectable: false,
      cursor: false,
    });
    gruppenZeilen.push({
      key: `party.${slot}.hp`,
      y: oben + 2 * m.lineHeight,
      runs: [run('HP', 0, 'left', m), run(formatRatio(c.hp, c.hpMax), layout.columns.third, 'right', m)],
      bars: [{ x: layout.columns.third + 8, width: layout.columns.barWidth, fill: barFill(c.hp, c.hpMax), tone: 'hp' }],
      selectable: false,
      cursor: false,
    });
    gruppenZeilen.push({
      key: `party.${slot}.mp`,
      y: oben + 3 * m.lineHeight,
      runs: [run('MP', 0, 'left', m), run(formatRatio(c.mp, c.mpMax), layout.columns.third, 'right', m)],
      bars: [{ x: layout.columns.third + 8, width: layout.columns.barWidth, fill: barFill(c.mp, c.mpMax), tone: 'mp' }],
      selectable: false,
      cursor: false,
    });
  });

  // --- Ort ---
  const ort = resolveLocation(data);
  if (ort.note) notes.push(ort.note);
  const ortFlaeche = contentRect(layout.location, skin);
  const ortZeilen: MenuScreenLine[] = [
    {
      key: 'ort',
      y: 0,
      runs: [run(ort.name ?? 'Unbekannt', 0, 'left', m, ort.source !== 'savemap')],
      bars: [],
      selectable: false,
      cursor: false,
    },
  ];
  void ortFlaeche;

  // --- Zeit und Gil ---
  const zeitFlaeche = contentRect(layout.timeGil, skin);
  const zeitZeilen: MenuScreenLine[] = [
    {
      key: 'zeit',
      y: 0,
      runs: [
        run('Zeit', 0, 'left', m),
        run(formatDuration(data.savemap.playtimeSeconds), zeitFlaeche.width, 'right', m),
      ],
      bars: [],
      selectable: false,
      cursor: false,
    },
    {
      key: 'gil',
      y: m.lineHeight,
      runs: [run('Gil', 0, 'left', m), run(formatNumber(data.savemap.gil), zeitFlaeche.width, 'right', m)],
      bars: [],
      selectable: false,
      cursor: false,
    },
  ];
  if (!data.savemap.duplicatesConsistent) {
    notes.push('Gil/Spielzeit stehen im Spielstand widersprüchlich');
  }

  return {
    surface: { ...MENU_SURFACE },
    panels: [
      panel('commands', layout.commands, befehlsZeilen, m),
      panel('party', layout.party, gruppenZeilen, m),
      panel('location', layout.location, ortZeilen, m),
      panel('timeGil', layout.timeGil, zeitZeilen, m),
    ],
    notes,
    metricsMeasured: data.metricsMeasured ?? false,
  };
}

// --- Unteransichten ---------------------------------------------------------

/**
 * Eine Listenansicht als Bildschirm: ein Titelfenster oben, darunter das
 * Listenfenster, unten die Beschreibungszeile der markierten Zeile.
 *
 * Die Dreiteilung ist keine Erfindung, sondern die Aufteilung, die an den
 * Referenzbildern der Kampfabschlüsse messbar ist: schmales Kopffenster,
 * großes Inhaltsfenster, gestapelt mit 2 px Zwischenraum und bündig am
 * Bildrand.
 */
export function buildViewScreen(
  vm: MenuViewModel,
  data: MenuData,
  cursor = 0,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): MenuScreen {
  const m = screenMetrics(data.spacing, skin);
  const b = borderThickness(skin);
  const kopfHoehe = m.lineHeight + 2 * b + skin.padding[1] + skin.padding[3];
  const fussHoehe = kopfHoehe;
  const luecke = 2;

  const kopf: MenuRect = { x: 0, y: 0, width: MENU_SURFACE.width, height: kopfHoehe };
  const fuss: MenuRect = {
    x: 0,
    y: MENU_SURFACE.height - fussHoehe,
    width: MENU_SURFACE.width,
    height: fussHoehe,
  };
  const liste: MenuRect = {
    x: 0,
    y: kopfHoehe + luecke,
    width: MENU_SURFACE.width,
    height: MENU_SURFACE.height - kopfHoehe - fussHoehe - 2 * luecke,
  };
  const listenFlaeche = contentRect(liste, skin);

  const gewaehlt = vm.selectable[cursor];
  const listenZeilen: MenuScreenLine[] = vm.rows.map((r, i) => {
    const runs: MenuTextRun[] = [run(r.label, 0, 'left', m, r.static === true)];
    if (r.value.length > 0) runs.push(run(r.value, listenFlaeche.width, 'right', m));
    const balkenBreite = 160;
    const bars: MenuBar[] =
      r.fill === undefined
        ? []
        : [
            {
              x: Math.max(0, listenFlaeche.width - balkenBreite - 180),
              width: balkenBreite,
              fill: r.fill,
              tone: r.barTone ?? 'hp',
            },
          ];
    return {
      key: r.key,
      y: i * m.lineHeight,
      runs,
      bars,
      selectable: vm.selectable.includes(i),
      cursor: i === gewaehlt,
    };
  });

  const markierte = gewaehlt === undefined ? undefined : vm.rows[gewaehlt];
  const fussText = markierte?.description ?? '';

  const notes = [...(vm.notes ?? [])];
  if (data.metricsMeasured === false && data.metricsDiagnostic) notes.push(data.metricsDiagnostic);
  else if (data.spacing === undefined) notes.push('Keine Glyphenmetrik übergeben — Ersatzbreiten, Spalten sind Schätzwerte');

  return {
    surface: { ...MENU_SURFACE },
    panels: [
      panel('title', kopf, [{ key: 'title', y: 0, runs: [run(vm.title, 0, 'left', m)], bars: [], selectable: false, cursor: false }], m),
      panel('list', liste, listenZeilen, m),
      panel(
        'description',
        fuss,
        [{ key: 'desc', y: 0, runs: [run(fussText, 0, 'left', m)], bars: [], selectable: false, cursor: false }],
        m,
      ),
    ],
    notes,
    metricsMeasured: data.metricsMeasured ?? false,
  };
}
