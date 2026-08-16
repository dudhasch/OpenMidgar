import { describe, expect, it } from 'vitest';
import { composeSavemapSlot, type FixtureSavemap } from '@webmidgar/fixture-gen';
import { readSavemap, ROW_FRONT } from '@webmidgar/formats-save';
import { spacingTableFrom } from '@webmidgar/formats-kernel';
import {
  buildItemScreen,
  buildItemsView,
  buildKeyItemsView,
  createItemScreenState,
  FF7_ITEM_SCREEN_LAYOUT,
  ITEM_ARRANGE_LABELS,
  ITEM_TAB_LABELS,
  MenuSession,
  MENU_SURFACE,
  NEUTRAL_MENU_INPUT,
  rectInSurface,
  scrollThumb,
  VISIBLE_ITEM_ROWS,
  type ItemScreenState,
  type MenuData,
  type MenuInput,
  type MenuPanel,
} from './index.js';

/**
 * Abnahme des Gegenstands-Bildschirms.
 *
 * Geprüft wird **Geometrie gegen die gemessenen Zahlen**, nicht gegen Pixel:
 * Ein Bildvergleich hinge an Schriftrendering und Grafikkarte, und eine
 * Menüaufnahme des Originals liegt im Baum ohnehin nicht vor. Die Belege sind
 * die Konstanten aus `item-layout.ts`; dieser Test hält fest, dass der
 * Bildschirm sie tatsächlich benutzt und nicht daneben rechnet.
 *
 * Zwei Fälle sind ausdrücklich dabei, weil sie im Standbild unsichtbar wären:
 * die **letzte** Fensterzeile (ein falsches Zeilenraster fällt erst dort auf)
 * und die feste Spalte des Trennzeichens (sie darf nicht am Namensende hängen).
 */

const SPIELSTAND: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 12, hp: 340, hpMax: 480, mp: 22, mpMax: 40, row: ROW_FRONT },
    { id: 1, name: 'Barret', level: 11, hp: 90, hpMax: 500, mp: 8, mpMax: 30, row: ROW_FRONT },
    { id: 2, name: 'Tifa', level: 10, hp: 0, hpMax: 300, mp: 30, mpMax: 30, row: ROW_FRONT },
  ],
  party: [0, 1, 2],
  inventory: [
    { itemId: 0, count: 12 },
    null, // Lücke: das Original verdichtet nicht
    { itemId: 2, count: 127 }, // die größte Menge, die ins Inventarwort passt
    { itemId: 3, count: 7 },
  ],
  keyItems: [0, 1, 5],
  gil: 1234,
  playtimeSeconds: 60,
  location: 'Sektor 7',
};

const SPACING = spacingTableFrom(Uint8Array.from({ length: 256 }, (_, i) => 4 + (i % 9)));

function daten(spec: FixtureSavemap = SPIELSTAND, extra: Partial<MenuData> = {}): MenuData {
  const savemap = readSavemap(composeSavemapSlot(spec));
  if (!savemap) throw new Error('Savemap nicht lesbar');
  return {
    savemap,
    itemName: (id) => (id === 0 ? 'Trank' : `Gegenstand${id}`),
    itemDescription: (id) => `Beschreibung ${id}`,
    keyItemName: (id) => `Schluessel${id}`,
    locationName: null,
    spacing: SPACING,
    metricsMeasured: true,
    metricsDiagnostic: null,
    ...extra,
  };
}

function bild(state: Partial<ItemScreenState> = {}, extra: Partial<MenuData> = {}) {
  const d = daten(SPIELSTAND, extra);
  const s: ItemScreenState = { ...createItemScreenState(), ...state };
  const vm = s.tab === 2 ? buildKeyItemsView(d, s.keyScroll) : buildItemsView(d, s.scroll);
  return buildItemScreen(vm, d, s);
}

const panel = (b: { panels: MenuPanel[] }, id: string): MenuPanel => {
  const p = b.panels.find((x) => x.id === id);
  if (!p) throw new Error(`Fenster ${id} fehlt`);
  return p;
};

function press(keys: Partial<MenuInput>): MenuInput {
  return { ...NEUTRAL_MENU_INPUT, ...keys };
}

function tap(session: MenuSession, keys: Partial<MenuInput>): void {
  session.step(press(keys));
  session.step(NEUTRAL_MENU_INPUT);
}

// --- Aufteilung -------------------------------------------------------------

describe('Gegenstands-Bildschirm: die gemessene Aufteilung', () => {
  it('setzt die vier Rechtecke der Tabelle und die beiden Fenster außerhalb davon', () => {
    const b = bild();
    expect(b.panels.map((p) => p.id)).toEqual(['title', 'tabs', 'description', 'list', 'party']);
    expect(panel(b, 'title').rect).toEqual({ x: 476, y: 0, width: 164, height: 51 });
    expect(panel(b, 'tabs').rect).toEqual({ x: 0, y: 0, width: 640, height: 51 });
    expect(panel(b, 'description').rect).toEqual({ x: 0, y: 51, width: 640, height: 51 });
    expect(panel(b, 'list').rect).toEqual({ x: 0, y: 94, width: 640, height: 386 });
    expect(panel(b, 'party').rect).toEqual({ x: 0, y: 96, width: 300, height: 384 });
    for (const p of b.panels) expect(rectInSurface(p.rect)).toBe(true);
  });

  it('macht Reiterzeile und Listenfenster bildschirmbreit — die scheinbaren Kanten sind fremde Fenster', () => {
    const b = bild();
    // Was in Aufnahmen wie eine Trennkante bei x≈486 bzw. x≈293 aussieht, ist
    // die Bordkante des davorliegenden Titel- bzw. Figurenfensters. Beide
    // breiten Fenster laufen dahinter durch — das ist der Grund, warum diese
    // Prüfung überhaupt dasteht.
    expect(panel(b, 'tabs').rect.width).toBe(MENU_SURFACE.width);
    expect(panel(b, 'list').rect.width).toBe(MENU_SURFACE.width);
    expect(panel(b, 'title').rect.x).toBeLessThan(panel(b, 'tabs').rect.width);
    expect(panel(b, 'party').rect.width).toBeLessThan(panel(b, 'list').rect.width);
  });

  it('lässt die zehn Listenzeilen im Beschnitt aufgehen', () => {
    const { clip, row, visibleRows } = FF7_ITEM_SCREEN_LAYOUT;
    // 10 × 37 = 370 gegen 372 px Beschnitthöhe: die Gegenprobe zweier
    // getrennt gelesener Stellen des Abbilds.
    expect(visibleRows * row.pitch).toBeLessThanOrEqual(clip.height);
    expect((visibleRows + 1) * row.pitch).toBeGreaterThan(clip.height);
    const liste = panel(bild(), 'list');
    expect(liste.clip).toEqual(clip);
    expect(liste.lines).toHaveLength(visibleRows);
    // Die letzte Zeile bleibt im Beschnitt — ein falsches Raster fiele erst hier auf.
    const letzte = liste.lines[visibleRows - 1]!;
    expect(letzte.y).toBe(9 * row.pitch + row.icon.dy);
    expect(letzte.y + row.icon.size).toBeLessThanOrEqual(clip.y + clip.height);
  });

  it('zeigt die Bildlaufleiste über alle 320 Plätze und rechnet den Daumen daraus', () => {
    const b = bild({ scroll: 160 });
    const scroll = panel(b, 'list').scroll!;
    expect(scroll).toMatchObject({ rect: { x: 618, y: 102, width: 17, height: 372 }, visible: 10, total: 320, first: 160 });
    const daumen = scrollThumb(scroll.rect, scroll.visible, scroll.total, scroll.first);
    expect(daumen.y).toBe(102 + Math.floor((372 * 160) / 320));
    expect(daumen.height).toBe(Math.floor((372 * 10) / 320) + 1);
  });
});

// --- Die Zeile --------------------------------------------------------------

describe('Gegenstands-Bildschirm: der Aufbau einer Zeile', () => {
  it('setzt Symbol, Name, Trennzeichen und Menge auf ihre gemessenen Spalten', () => {
    const r = FF7_ITEM_SCREEN_LAYOUT.row;
    const zeile = panel(bild(), 'list').lines[0]!;
    const [symbol, name, trenner, ...ziffern] = zeile.runs;
    expect(symbol).toMatchObject({ kind: 'icon', x: r.icon.x, size: r.icon.size, iconCategory: 'item' });
    expect(name).toMatchObject({ text: 'Trank', x: r.name.x, dy: r.name.dy - r.icon.dy });
    expect(trenner).toMatchObject({ text: ':', x: r.separator.x });
    // Menge 12 ⇒ nur die beiden hinteren Stellen; die führende Null fehlt.
    expect(ziffern.map((z) => [z!.text, z!.x])).toEqual([
      ['1', r.count.x + r.count.digitPitch],
      ['2', r.count.x + 2 * r.count.digitPitch],
    ]);
  });

  it('hängt das Trennzeichen an seine feste Spalte, nicht an das Namensende', () => {
    const r = FF7_ITEM_SCREEN_LAYOUT.row;
    const b = bild({}, { itemName: (id) => (id === 0 ? 'Trank' : 'Wiederbelebungsmittel-Extrakt') });
    const trennerX = panel(b, 'list')
      .lines.filter((l) => l.runs.length > 0)
      .map((l) => l.runs.find((run) => run.text === ':')!.x);
    expect(new Set(trennerX)).toEqual(new Set([r.separator.x]));
    // Ein Name, der über die Spalte hinausläuft, wird gemeldet statt verdeckt.
    expect(b.notes.some((n) => n.includes('Trennzeichenspalte'))).toBe(true);
  });

  it('zeichnet keine führenden Nullen und klemmt das dreistellige Feld', () => {
    const zeilen = panel(bild(), 'list').lines;
    const ziffern = (i: number): string =>
      zeilen[i]!.runs.filter((r) => /^[0-9]$/.test(r.text)).map((r) => r.text).join('');
    expect(ziffern(2)).toBe('127');
    expect(ziffern(3)).toBe('7'); // einstellig ⇒ eine Stelle, nicht „007"
    expect(zeilen[3]!.runs.find((r) => r.text === '7')!.x).toBe(
      FF7_ITEM_SCREEN_LAYOUT.row.count.x + 2 * FF7_ITEM_SCREEN_LAYOUT.row.count.digitPitch,
    );
  });

  it('hat ein Mengenfeld, das breiter ist als der Spielstand je füllen kann — und das bleibt so', () => {
    // Das Original zeichnet drei Stellen und klemmt auf 999 (`DrawDecimalNumber`,
    // `0x006F9739`). Erreichbar ist das nie: Die Menge steckt in den oberen
    // **sieben** Bit des Inventarworts, also höchstens 127. Beides ist gemessen,
    // beides bleibt stehen — die Klemmung ist eine Wache des Originals, keine
    // Anzeigeregel, und sie hier wegzukürzen hieße, eine Messung zu übermalen.
    const d = daten({ ...SPIELSTAND, inventory: [{ itemId: 0, count: 1500 }] });
    expect(d.savemap.inventory[0]!.count).toBe(1500 & 0x7f);
    const zeile = panel(buildItemScreen(buildItemsView(d, 0), d, createItemScreenState()), 'list').lines[0]!;
    expect(zeile.runs.filter((r) => /^[0-9]$/.test(r.text)).map((r) => r.text).join('')).toBe('92');
  });

  it('lässt einen leeren Platz sichtbar leer, statt die Liste zusammenzuschieben', () => {
    const zeilen = panel(bild(), 'list').lines;
    expect(zeilen[1]!.runs).toEqual([]);
    expect(zeilen[1]!.selectable).toBe(true);
    // Der Platz darunter bleibt Platz 2 — nichts ist nachgerückt.
    expect(zeilen[2]!.key).toBe('i2');
  });

  it('färbt einen im Menü gesperrten Gegenstand grau — Name, Trennzeichen und Menge, nicht das Symbol', () => {
    const b = bild({}, { itemUsableInMenu: (id) => id !== 0 });
    const zeile = panel(b, 'list').lines[0]!;
    const symbol = zeile.runs.find((r) => r.kind === 'icon')!;
    expect(symbol.palette).toBeUndefined();
    for (const r of zeile.runs.filter((x) => x.kind !== 'icon')) expect(r.palette).toBe(0);
    // Die benutzbare Zeile bleibt in der Vorgabefarbe (kein palette-Feld).
    for (const r of panel(b, 'list').lines[2]!.runs) {
      if (r.kind !== 'icon') expect(r.palette).toBeUndefined();
    }
  });

  it('setzt den Zeiger auf seine eigene Spalte, nicht an den Fensterrand', () => {
    const r = FF7_ITEM_SCREEN_LAYOUT.row;
    const zeilen = panel(bild({ row: 3 }), 'list').lines;
    expect(zeilen[3]!.cursor).toBe(true);
    expect(zeilen[3]!.cursorRect).toEqual({ x: r.cursor.x, y: 3 * r.pitch + r.cursor.dy, width: 48, height: 26 });
    expect(zeilen[0]!.cursor).toBe(false);
    // Blinkphase aus: der Zeiger verschwindet, die Zeile bleibt.
    expect(panel(bild({ row: 3, blink: false }), 'list').lines[3]!.cursor).toBe(false);
  });
});

// --- Reiter, Beschreibung, Figurenspalte ------------------------------------

describe('Gegenstands-Bildschirm: Reiter, Beschreibung und Figurenspalte', () => {
  it('setzt drei Reiter im gemessenen Abstand', () => {
    const t = FF7_ITEM_SCREEN_LAYOUT.tab;
    const zeilen = panel(bild(), 'tabs').lines;
    expect(zeilen.map((l) => l.runs[0]!.text)).toEqual([...ITEM_TAB_LABELS]);
    expect(zeilen.map((l) => l.runs[0]!.x)).toEqual([t.textX, t.textX + t.pitch, t.textX + 2 * t.pitch]);
    expect(zeilen.every((l) => l.y === t.textY)).toBe(true);
  });

  it('lässt die Beschreibungszeile leer, solange der Zeiger in der Reiterzeile oder im Sortierfenster steht', () => {
    const text = (s: Partial<ItemScreenState>): string => panel(bild(s), 'description').lines[0]!.runs[0]!.text;
    expect(text({ submode: 1, row: 0 })).toBe('Beschreibung 0');
    expect(text({ submode: 0 })).toBe('');
    expect(text({ submode: 4, tab: 1 })).toBe('');
  });

  it('zeigt drei Figurenblöcke im Abstand von 120 px und überspringt leere Plätze', () => {
    const b = FF7_ITEM_SCREEN_LAYOUT.partyBlock;
    const zeilen = panel(bild(), 'party').lines;
    const namen = zeilen.filter((l) => l.key.endsWith('.name'));
    expect(namen.map((l) => l.runs[0]!.text)).toEqual(['Wolke', 'Barret', 'Tifa']);
    expect(namen.map((l) => l.y)).toEqual([0, 1, 2].map((s) => b.block.dy + s * b.slotPitch));

    const ohneDritten = { ...SPIELSTAND, party: [0, 1, null] } as FixtureSavemap;
    const d = daten(ohneDritten);
    const leer = buildItemScreen(buildItemsView(d, 0), d, createItemScreenState());
    expect(panel(leer, 'party').lines.filter((l) => l.key.endsWith('.name'))).toHaveLength(2);
  });

  it('färbt knappe und aufgebrauchte Werte wie das Original', () => {
    const zeilen = panel(bild(), 'party').lines;
    const ziffernFarbe = (key: string): Array<number | undefined> =>
      zeilen
        .find((l) => l.key === key)!
        .runs.filter((r) => /^[0-9]$/.test(r.text))
        .map((r) => r.palette);
    // Wolke 340/480 — über einem Viertel ⇒ Vorgabefarbe (kein palette-Feld).
    expect(ziffernFarbe('party.0.hp').every((p) => p === undefined)).toBe(true);
    // Barret 90/500 — höchstens ein Viertel ⇒ Farbindex 6.
    expect(ziffernFarbe('party.1.hp')[0]).toBe(6);
    // Tifa 0/300 — kampfunfähig ⇒ der ganze Block auf Farbindex 2.
    expect(ziffernFarbe('party.2.hp').every((p) => p === 2)).toBe(true);
    expect(zeilen.find((l) => l.key === 'party.2.name')!.runs[0]!.palette).toBe(2);
    // Die Beschriftungen stehen unabhängig davon auf Farbindex 5.
    expect(zeilen.find((l) => l.key === 'party.0.hp')!.runs[0]).toMatchObject({ text: 'HP', palette: 5 });
  });

  it('setzt die HP-/MP-Balken unter ihre Zahlenzeile, nicht auf sie', () => {
    const b = FF7_ITEM_SCREEN_LAYOUT.partyBlock;
    const zeilen = panel(bild(), 'party').lines;
    const hp = zeilen.find((l) => l.key === 'party.0.hp')!;
    expect(hp.bars[0]).toMatchObject({ x: b.block.x + b.bar.x, width: b.bar.width, height: b.bar.height });
    expect(hp.bars[0]!.y).toBe(b.block.dy + b.bar.hpY);
    expect(hp.bars[0]!.y).toBeGreaterThan(hp.y);
  });
});

// --- Sortierfenster und Schlüsselliste --------------------------------------

describe('Gegenstands-Bildschirm: Sortierfenster und Schlüsselliste', () => {
  it('klappt das Sortierfenster nur im zugehörigen Untermodus auf und zeigt acht Zeilen', () => {
    expect(bild().panels.some((p) => p.id === 'arrange')).toBe(false);
    const b = bild({ tab: 1, submode: 4, arrangeRow: 2 });
    const p = panel(b, 'arrange');
    expect(p.rect).toEqual({ x: 220, y: 26, width: 145, height: 227 });
    expect(p.lines.map((l) => l.runs[0]!.text)).toEqual([...ITEM_ARRANGE_LABELS]);
    const a = FF7_ITEM_SCREEN_LAYOUT.arrangeRow;
    expect(p.lines.map((l) => l.y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => a.textY + i * a.pitch));
    // Der Zeiger steht links AUSSERHALB des Rahmens — so im Original.
    expect(p.lines[2]!.cursorRect!.x).toBe(a.cursorX);
    expect(a.cursorX).toBeLessThan(p.rect.x);
    expect(b.notes.some((n) => n.includes('Sortieren ist nicht umgesetzt'))).toBe(true);
  });

  it('ersetzt im Reiter „Schlüssel" die Figurenspalte durch eine zweispaltige Liste', () => {
    const b = bild({ tab: 2, submode: 3 });
    expect(b.panels.some((p) => p.id === 'party')).toBe(false);
    const k = FF7_ITEM_SCREEN_LAYOUT.keyRow;
    const zeilen = panel(b, 'list').lines;
    // Drei Schlüssel, zeilenweise gefüllt: zwei links/rechts in Zeile 0, einer links in Zeile 1.
    expect(zeilen.map((l) => [l.runs[0]!.x, l.y])).toEqual([
      [k.textX, k.textY],
      [k.textX + k.columnPitch, k.textY],
      [k.textX, k.textY + k.pitch],
    ]);
    expect(panel(b, 'list').scroll!.total).toBe(2); // zwei belegte Zeilen
  });
});

// --- Bedienung --------------------------------------------------------------

describe('Gegenstands-Bildschirm: Bedienung', () => {
  it('läuft im Schlüsselreiter über beide Spalten mit Übertrag in die Zeile', () => {
    const s = new MenuSession(daten());
    s.open('items');
    tap(s, { cancel: true }); // Reiterzeile
    tap(s, { right: true });
    tap(s, { right: true }); // Reiter „Schlüssel"
    tap(s, { confirm: true });
    expect(s.state.item.submode).toBe(3);
    expect([s.state.item.keyRow, s.state.item.keyCol]).toEqual([0, 0]);
    tap(s, { right: true });
    expect([s.state.item.keyRow, s.state.item.keyCol]).toEqual([0, 1]);
    // Von der rechten Spalte weiter nach rechts: zurück nach links, eine Zeile tiefer.
    tap(s, { right: true });
    expect([s.state.item.keyRow, s.state.item.keyCol]).toEqual([1, 0]);
  });

  it('lässt den Zeiger des Sortierfensters umlaufen', () => {
    const s = new MenuSession(daten());
    s.open('items');
    tap(s, { cancel: true });
    tap(s, { right: true }); // Reiter „Sortieren"
    tap(s, { confirm: true });
    expect(s.state.item.arrangeRow).toBe(0);
    tap(s, { up: true });
    expect(s.state.item.arrangeRow).toBe(ITEM_ARRANGE_LABELS.length - 1);
    tap(s, { down: true });
    expect(s.state.item.arrangeRow).toBe(0);
  });

  it('sagt in der Ansicht, was es nicht kann, statt es vorzutäuschen', () => {
    const b = bild();
    expect(b.notes.some((n) => n.includes('Benutzen ist nicht umgesetzt'))).toBe(true);
  });
});
