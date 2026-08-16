import { istVordereReihe } from '@webmidgar/formats-save';
import { FF7_WINDOW_SKIN, WindowDisplayMode, type WindowSkin } from '@webmidgar/ui-window';
import { barFill } from './format.js';
import {
  FF7_ITEM_SCREEN_LAYOUT,
  GLYPH_HEIGHT,
  ITEM_ARRANGE_LABELS,
  ITEM_TAB_LABELS,
  type ItemScreenLayout,
} from './item-layout.js';
import { MENU_SURFACE, type MenuRect } from './layout.js';
import { characterLabel, VISIBLE_ITEM_ROWS, type MenuData, type MenuViewModel } from './model.js';
import {
  contentRect,
  screenMetrics,
  textWidth,
  type MenuBar,
  type MenuPaletteRow,
  type MenuPanel,
  type MenuScreen,
  type MenuScreenLine,
  type MenuTextRun,
  type ScreenMetrics,
} from './screen.js';

/**
 * Der **Gegenstands-Bildschirm** in der Aufteilung des Originals.
 *
 * 🔵 **Warum ein eigener Erbauer und nicht `buildViewScreen`.** Die allgemeine
 * Listenansicht (Kopf/Liste/Fuß, Zeilenhöhe der Schale, rechtsbündiger Wert an
 * der Textflächenkante) ist eine eigene Bauform des Projekts — sie war
 * begründet, solange es für das Menü keinen Beleg gab. Für diesen einen
 * Bildschirm gibt es ihn jetzt: sechs Fenster mit gemessenen Rechtecken, ein
 * Zeilenraster von 37 px (nicht 32), vier feste Spaltenanker und eine
 * Bildlaufleiste. Das in `buildViewScreen` unterzubringen hätte beide Bauformen
 * verdorben; deshalb steht der Bildschirm hier, und `buildViewScreen` bleibt
 * unverändert für die übrigen Ansichten.
 *
 * 🟢 **Sämtliche Geometrie kommt aus {@link FF7_ITEM_SCREEN_LAYOUT}** und ist
 * dort einzeln mit ihrer Fundstelle im Abbild belegt. Diese Datei entscheidet
 * über keine einzige Zahl — sie ordnet nur zu.
 *
 * ⚠️ **Was dieser Bildschirm nicht tut, und warum das so bleibt.** Das Original
 * kennt sechs Untermodi; drei davon **schreiben** (Gegenstand benutzen,
 * Sortieren, Plätze von Hand tauschen). Umgesetzt sind hier die anzeigenden und
 * blätternden: Reiterzeile, Gegenstandsliste, Schlüsselliste und das geöffnete
 * Sortierfenster. Die Schreibwege fehlen, und die Ansicht sagt es in `notes`.
 * Eine Taste, die scheinbar wirkt, ist schlimmer als eine, die erkennbar nicht
 * wirkt — dieselbe Regel, nach der die PHS-Ansicht bis heute nur zeigt.
 */

/**
 * Farbindizes des Originals, als Palettenzeilen unserer gemessenen Schrift.
 *
 * 🟢 **Warum die Zahlen ohne Umrechnung passen.** Das Menü des Originals
 * schaltet Textfarben über einen Index (`colorIndex`), der in der Schriftpalette
 * die CLUT wählt; gemessen sind dort Körper `#E6E6E6` für Index 7 und `#6A6A6A`
 * für Index 0. Die acht Palettenzeilen unseres Fontblatts sind unabhängig davon
 * an der Installation vermessen (`FontPalette` in `@webmidgar/ui-window`) und
 * tragen auf Zeile 7 `230,230,230` und auf Zeile 0 `106,106,106` — dieselben
 * Werte, `0x6A = 106`. Zwei getrennt erhobene Tabellen, deckungsgleich; deshalb
 * wird der Index des Originals hier unverändert als Zeilennummer benutzt.
 */
const FARBE = {
  /** 🟢 Farbindex 7 — die Vorgabefarbe. */
  normal: 7 as MenuPaletteRow,
  /** 🟢 Farbindex 0 — im Menü gesperrter Gegenstand. */
  gesperrt: 0 as MenuPaletteRow,
  /** 🟢 Beschriftungen LV/HP/MP: `DrawFixedPitchString2x(…, 5, …)` (`0x006C62A2`). */
  beschriftung: 5 as MenuPaletteRow,
  /** 🟢 Wert auf höchstens einem Viertel des Maximums: Farbindex 6. */
  knapp: 6 as MenuPaletteRow,
  /** 🟢 Kampfunfähig (HP 0): Farbindex 2. */
  kampfunfaehig: 2 as MenuPaletteRow,
} as const;

/** Welcher Reiter der Gegenstands-Bildschirm gerade zeigt. */
export type ItemTab = 0 | 1 | 2;

/**
 * Untermodus in der Nummerierung des Originals (`0x00DD19C8`). 2 (Zielauswahl)
 * und 5 (Handtausch) fehlen absichtlich — beide sind Schreibwege, siehe oben.
 */
export type ItemSubmode = 0 | 1 | 3 | 4;

export interface ItemScreenState {
  tab: ItemTab;
  submode: ItemSubmode;
  /** Oberste sichtbare Zeile der Gegenstandsliste, 0…310. */
  scroll: number;
  /** Zeile des Zeigers innerhalb des Fensters, 0…9. */
  row: number;
  /** Oberste sichtbare Zeile der Schlüsselliste. */
  keyScroll: number;
  /** Zelle des Zeigers in der Schlüsselliste. */
  keyRow: number;
  keyCol: 0 | 1;
  /** Zeile des Sortier-Aufklappfensters, 0…7. */
  arrangeRow: number;
  /**
   * 🟢 Blinkphase des Zeigers: Das Original prüft Bit 1 des Bildzählers
   * (`AND EAX,0x2` an fünf Stellen), also zwei Bilder sichtbar, zwei nicht.
   * `false` blendet den Zeiger aus.
   */
  blink: boolean;
}

export function createItemScreenState(): ItemScreenState {
  return {
    tab: 0,
    // 🟢 Das Original startet nicht in der Reiterzeile, sondern in der Liste:
    // Menu_ItemScreenInit setzt den Untermodus auf 1 (0x00714EF5).
    submode: 1,
    scroll: 0,
    row: 0,
    keyScroll: 0,
    keyRow: 0,
    keyCol: 0,
    arrangeRow: 0,
    blink: true,
  };
}

function lauf(
  text: string,
  x: number,
  m: ScreenMetrics,
  palette: MenuPaletteRow = FARBE.normal,
  dy = 0,
): MenuTextRun {
  return {
    text,
    x,
    align: 'left',
    width: textWidth(text, m),
    ...(palette === FARBE.normal ? {} : { palette }),
    ...(dy === 0 ? {} : { dy }),
  };
}

/**
 * Eine Zahl als **feste Ziffernstellen**, so wie `DrawDecimalNumber`
 * (`0x006F9739`) sie setzt: jede Stelle auf ihrer eigenen Stiftposition
 * `x + (Stelle−1)·Abstand`, führende Nullen gar nicht erst gezeichnet, und im
 * dreistelligen Feld auf 999 geklemmt.
 *
 * 🔵 Das als Einzelläufe zu modellieren statt als rechtsbündigen Text ist kein
 * Umweg: Rechtsbündig gesetzter Proportionaltext hätte dieselbe rechte Kante,
 * aber andere Ziffernabstände — und genau die sieht man in einer Liste
 * untereinanderstehender Zahlen.
 */
function ziffern(
  wert: number,
  stellen: number,
  x: number,
  abstand: number,
  m: ScreenMetrics,
  palette: MenuPaletteRow,
  dy = 0,
): MenuTextRun[] {
  const grenze = 10 ** stellen - 1;
  const geklemmt = Math.max(0, Math.min(grenze, Math.trunc(wert)));
  const text = String(geklemmt).padStart(stellen, ' ');
  const out: MenuTextRun[] = [];
  for (let i = 0; i < stellen; i++) {
    const z = text[i]!;
    if (z === ' ') continue;
    out.push(lauf(z, x + i * abstand, m, palette, dy));
  }
  return out;
}

/** Ein Fenster mit absoluten Ankern — ohne Zeilenrasterung der Schale. */
function fenster(
  id: string,
  rect: MenuRect,
  lines: MenuScreenLine[],
  skin: WindowSkin,
  extra: Partial<MenuPanel> = {},
): MenuPanel {
  return {
    id,
    rect,
    content: contentRect(rect, skin),
    mode: WindowDisplayMode.Normal,
    lines,
    absolute: true,
    ...extra,
  };
}

/** Eine Zeile ohne Zeiger und ohne Balken — der häufigste Fall. */
function zeile(key: string, y: number, runs: MenuTextRun[], bars: MenuBar[] = []): MenuScreenLine {
  return { key, y, runs, bars, selectable: false, cursor: false, height: GLYPH_HEIGHT };
}

/**
 * Der Werteblock einer Figur, in den Versätzen von `Menu_DrawCharStatBlock2x`
 * (`0x006C62A2`).
 *
 * 🟢 Die Farbregel ist dort gelesen und nicht erfunden: HP bzw. MP stehen in
 * Farbindex 7, solange der Wert **über** einem Viertel des Maximums liegt, und
 * in 6 darunter; bei HP 0 geht der ganze Block auf 2.
 */
function figurenblock(
  data: MenuData,
  slot: number,
  layout: ItemScreenLayout,
  m: ScreenMetrics,
): MenuScreenLine[] {
  const b = layout.partyBlock;
  const id = data.savemap.party[slot];
  const c = id === null || id === undefined ? null : data.savemap.characters.find((ch) => ch.id === id);
  // 🟢 Leerer Gruppenplatz: Das Original überspringt den Block ganz (`0x0071559B`).
  if (!c) return [];

  const oben = b.block.dy + slot * b.slotPitch;
  const x = b.block.x;
  const kampfunfaehig = c.hp === 0;
  const wertFarbe = (wert: number, max: number): MenuPaletteRow =>
    kampfunfaehig ? FARBE.kampfunfaehig : wert > Math.trunc(max / 4) ? FARBE.normal : FARBE.knapp;
  const kopf = kampfunfaehig ? FARBE.kampfunfaehig : FARBE.normal;
  const balken = (y: number, fill: number, tone: MenuBar['tone']): MenuBar => ({
    x: x + b.bar.x,
    width: b.bar.width,
    height: b.bar.height,
    y: oben + y,
    fill,
    tone,
  });

  return [
    zeile(`party.${slot}.portrait`, b.portrait.dy + slot * b.slotPitch, [
      { text: '', x: b.portrait.x, align: 'left', width: b.portrait.size, kind: 'portrait', size: b.portrait.size },
    ]),
    zeile(`party.${slot}.name`, oben + b.name.y, [
      lauf(characterLabel(c), x + b.name.x, m, kopf),
      // 🟡 Die Kampfreihe steht im Original nicht in diesem Block. Sie steht
      // hier, weil die bisherige Gruppenansicht sie zeigt und ein ersatzloser
      // Wegfall eine Auslassung wäre — nicht, weil sie gemessen wäre.
      lauf(istVordereReihe(c.row) ? 'vorne' : 'hinten', x + b.max.x, m, FARBE.beschriftung),
    ]),
    zeile(`party.${slot}.lv`, oben + b.labelLv.y, [
      lauf('LV', x + b.labelLv.x, m, FARBE.beschriftung),
      ...ziffern(c.level, b.level.digits, x + b.level.x, b.digitPitch, m, kopf),
    ]),
    zeile(
      `party.${slot}.hp`,
      oben + b.labelHp.y,
      [
        lauf('HP', x + b.labelHp.x, m, FARBE.beschriftung),
        ...ziffern(c.hp, b.hp.digits, x + b.hp.x, b.digitPitch, m, wertFarbe(c.hp, c.hpMax), b.hp.y - b.labelHp.y),
        lauf('/', x + b.slash.x, m, kopf, b.hp.y - b.labelHp.y),
        ...ziffern(c.hpMax, b.hp.digits, x + b.max.x, b.digitPitch, m, kopf, b.hp.y - b.labelHp.y),
      ],
      [balken(b.bar.hpY, barFill(c.hp, c.hpMax), 'hp')],
    ),
    zeile(
      `party.${slot}.mp`,
      oben + b.labelMp.y,
      [
        lauf('MP', x + b.labelMp.x, m, FARBE.beschriftung),
        ...ziffern(c.mp, b.mp.digits, x + b.mp.x, b.digitPitch, m, wertFarbe(c.mp, c.mpMax), b.mp.y - b.labelMp.y),
        lauf('/', x + b.slash.x, m, kopf, b.mp.y - b.labelMp.y),
        ...ziffern(c.mpMax, b.mp.digits, x + b.max.x, b.digitPitch, m, kopf, b.mp.y - b.labelMp.y),
      ],
      [balken(b.bar.mpY, barFill(c.mp, c.mpMax), 'mp')],
    ),
  ];
}

/**
 * Baut den Gegenstands-Bildschirm.
 *
 * `vm` liefert die Zeilen (aus `buildItemsView` bzw. `buildKeyItemsView`), die
 * Lage jeder einzelnen kommt aus dem Layout. Die Trennung ist dieselbe wie
 * überall im Paket: Was angezeigt wird, entscheidet das Zeilenmodell — wo es
 * steht, dieser Bildschirm.
 */
export function buildItemScreen(
  vm: MenuViewModel,
  data: MenuData,
  state: ItemScreenState,
  layout: ItemScreenLayout = FF7_ITEM_SCREEN_LAYOUT,
  skin: WindowSkin = FF7_WINDOW_SKIN,
): MenuScreen {
  const m = screenMetrics(data.spacing, skin);
  const notes: string[] = [...(vm.notes ?? [])];
  if (data.metricsMeasured === false && data.metricsDiagnostic) notes.push(data.metricsDiagnostic);
  else if (data.spacing === undefined) {
    notes.push('Keine Glyphenmetrik übergeben — Ersatzbreiten, Spalten sind Schätzwerte');
  }

  const schluessel = state.tab === 2;
  const panels: MenuPanel[] = [];

  // --- Titelfenster: das eingeklappte Kommandofenster des Hauptmenüs ---
  panels.push(
    fenster('title', layout.title, [zeile('title', layout.titleText.y, [lauf('Gegenstand', layout.titleText.x, m)])], skin),
  );

  // --- Reiterzeile ---
  panels.push(
    fenster(
      'tabs',
      layout.tabs,
      ITEM_TAB_LABELS.map((label, i) => ({
        key: `tab.${i}`,
        y: layout.tab.textY,
        runs: [lauf(label, layout.tab.textX + i * layout.tab.pitch, m)],
        bars: [],
        selectable: true,
        // 🟢 Der Reiterzeiger steht auch dann auf seinem Reiter, wenn der Zeiger
        // in der Liste läuft — blinken tut er nur, während er selbst aktiv ist
        // (Untermodus 1 setzt den Blinktest nur um den Reitercursor).
        cursor: i === state.tab && (state.submode !== 0 || state.blink),
        height: GLYPH_HEIGHT,
        cursorRect: {
          x: layout.tab.cursorX + i * layout.tab.pitch,
          y: layout.tab.cursorY,
          width: layout.row.cursor.width,
          height: layout.row.cursor.height,
        },
      })),
      skin,
    ),
  );

  // --- Beschreibungszeile ---
  // 🟢 Leer, solange der Zeiger in der Reiterzeile steht oder das Sortierfenster
  // offen ist: Die Untermodi 0 und 4 zeichnen an (27,64) nichts.
  const markiert = vm.rows[schluessel ? state.keyRow * 2 + state.keyCol : state.row];
  const beschreibung = state.submode === 0 || state.submode === 4 ? '' : (markiert?.description ?? '');
  panels.push(
    fenster(
      'description',
      layout.description,
      [zeile('desc', layout.descriptionText.y, [lauf(beschreibung, layout.descriptionText.x, m)])],
      skin,
    ),
  );

  // --- Das große Fenster: Gegenstands- oder Schlüsselliste ---
  const zeilen = schluessel
    ? schluesselZeilen(vm, state, layout, m)
    : gegenstandsZeilen(vm, state, layout, m, notes);
  const schluesselZeilenGesamt = Math.max(1, Math.ceil(data.savemap.keyItems.length / 2));
  panels.push(
    fenster('list', layout.list, zeilen, skin, {
      clip: layout.clip,
      scroll: {
        rect: layout.scrollBar,
        visible: layout.visibleRows,
        total: schluessel ? schluesselZeilenGesamt : layout.totalRows,
        first: schluessel ? state.keyScroll : state.scroll,
      },
    }),
  );

  // --- Figurenspalte: entfällt im Reiter „Schlüssel" ---
  if (!schluessel) {
    const figuren: MenuScreenLine[] = [];
    for (let slot = 0; slot < data.savemap.party.length; slot++) {
      figuren.push(...figurenblock(data, slot, layout, m));
    }
    panels.push(fenster('party', layout.party, figuren, skin));
  }

  // --- Sortier-Aufklappfenster ---
  if (state.submode === 4) {
    panels.push(
      fenster(
        'arrange',
        layout.arrange,
        ITEM_ARRANGE_LABELS.map((label, i) => ({
          key: `arrange.${i}`,
          y: layout.arrangeRow.textY + i * layout.arrangeRow.pitch,
          runs: [lauf(label, layout.arrangeRow.textX, m)],
          bars: [],
          selectable: true,
          // 🟢 Der Zeiger des Aufklappfensters blinkt im Original nicht.
          cursor: i === state.arrangeRow,
          height: GLYPH_HEIGHT,
          cursorRect: {
            x: layout.arrangeRow.cursorX,
            y: layout.arrangeRow.cursorY + i * layout.arrangeRow.pitch,
            width: layout.row.cursor.width,
            height: layout.row.cursor.height,
          },
        })),
        skin,
      ),
    );
    notes.push('Sortieren ist nicht umgesetzt — das Fenster zeigt die acht Zeilen des Originals');
  }

  notes.push('Benutzen ist nicht umgesetzt — dieser Bildschirm zeigt und blättert');

  return { surface: { ...MENU_SURFACE }, panels, notes, metricsMeasured: data.metricsMeasured ?? false };
}

/**
 * Die zehn Zeilen der Gegenstandsliste. Jede besteht aus vier Elementen an
 * festen Spalten — Symbol, Name, Trennzeichen, Menge —, die im Original auf
 * einer gemeinsamen optischen Mittellinie sitzen und ihre verschiedenen Höhen
 * über den Feinversatz ausgleichen.
 */
function gegenstandsZeilen(
  vm: MenuViewModel,
  state: ItemScreenState,
  layout: ItemScreenLayout,
  m: ScreenMetrics,
  notes: string[],
): MenuScreenLine[] {
  const r = layout.row;
  let symbolFehlt = false;
  let ueberlauf = false;

  const zeilen = vm.rows.slice(0, VISIBLE_ITEM_ROWS).map((row, i): MenuScreenLine => {
    // Oberkante der Zeile ist das oberste Element, das Symbol.
    const oben = i * r.pitch + r.icon.dy;
    const runs: MenuTextRun[] = [];
    if (!row.empty) {
      const farbe = row.usable === false ? FARBE.gesperrt : FARBE.normal;
      if (row.iconCategory) {
        symbolFehlt = true;
        runs.push({
          text: '',
          x: r.icon.x,
          align: 'left',
          width: r.icon.size,
          kind: 'icon',
          size: r.icon.size,
          iconCategory: row.iconCategory,
        });
      }
      const name = lauf(row.label, r.name.x, m, farbe, r.name.dy - r.icon.dy);
      runs.push(name);
      // 🟢 Die Trennzeichenspalte ist im Original **fest** (`0x00715940`) und
      // hängt nicht am Namensende. Deutsche Namen sind länger als die
      // englischen, für die sie bemessen wurde; ein Überlauf wird deshalb
      // gemeldet und nicht durch ein Verschieben der Spalte verdeckt.
      if (r.name.x + name.width > r.separator.x) ueberlauf = true;
      runs.push(lauf(':', r.separator.x, m, farbe, r.separator.dy - r.icon.dy));
      runs.push(
        ...ziffern(row.count ?? 0, r.count.digits, r.count.x, r.count.digitPitch, m, farbe, r.count.dy - r.icon.dy),
      );
    }
    return {
      key: row.key,
      y: oben,
      runs,
      bars: [],
      selectable: true,
      cursor: i === state.row && state.submode === 1 && state.blink,
      height: r.icon.size,
      cursorRect: {
        x: r.cursor.x,
        y: i * r.pitch + r.cursor.dy,
        width: r.cursor.width,
        height: r.cursor.height,
      },
    };
  });

  if (symbolFehlt) {
    notes.push('Typsymbole 🔴 — die Kacheln liegen in `menu_us.lgp`, das der Baum nicht lädt; ihr Platz bleibt frei');
  }
  if (ueberlauf) notes.push('Ein Gegenstandsname überschreitet die feste Trennzeichenspalte des Originals');
  return zeilen;
}

/** Die zwanzig Zellen der Schlüsselliste — zwei Spalten, zeilenweise gefüllt. */
function schluesselZeilen(
  vm: MenuViewModel,
  state: ItemScreenState,
  layout: ItemScreenLayout,
  m: ScreenMetrics,
): MenuScreenLine[] {
  const k = layout.keyRow;
  const out: MenuScreenLine[] = [];
  vm.rows.forEach((row, i) => {
    if (row.empty) return;
    const spalte = i % k.columns;
    const reihe = Math.floor(i / k.columns);
    out.push({
      key: row.key,
      y: k.textY + reihe * k.pitch,
      runs: [lauf(row.label, k.textX + spalte * k.columnPitch, m)],
      bars: [],
      selectable: true,
      cursor: reihe === state.keyRow && spalte === state.keyCol && state.submode === 3 && state.blink,
      height: GLYPH_HEIGHT,
      cursorRect: {
        x: k.cursorX + spalte * k.columnPitch,
        y: k.cursorY + reihe * k.pitch,
        width: layout.row.cursor.width,
        height: layout.row.cursor.height,
      },
    });
  });
  return out;
}
