import { describe, expect, it } from 'vitest';
import {
  composeSaveFile,
  composeSavemapSlot,
  composeKernelContainer,
  composeTextSection,
  type FixtureSavemap,
} from '@webmidgar/fixture-gen';
import { parseOriginalSave, readSavemap, formatPlaytime } from '@webmidgar/formats-save';
import { indexKernelSections, itemNameLookup, parseKernelContainer, pickItemTextLists } from '@webmidgar/formats-kernel';
import {
  MenuSession,
  NEUTRAL_MENU_INPUT,
  buildItemsView,
  buildPartyView,
  buildStatusView,
  buildTimeView,
  formatNumber,
  type MenuData,
  type MenuInput,
} from './index.js';

/**
 * S21-Abnahme. Der Golden-Vergleich läuft über die **Struktur** der Ansichten,
 * nicht über Pixel: Ein Screenshot-Vergleich hinge an Schriftrendering und
 * Grafikkarte und würde bei jeder Layoutkosmetik ausschlagen, ohne über die
 * Korrektheit der Werte mehr auszusagen als diese Zeilenvergleiche.
 */

const BASIS: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 12, hp: 340, hpMax: 480, mp: 22, mpMax: 40, stats: [21, 18, 15, 14, 17, 9] },
    { id: 1, name: 'Barret', level: 11, hp: 500, hpMax: 500, mp: 8, mpMax: 30, stats: [24, 20, 9, 11, 12, 7] },
    { id: 2, name: 'Tifa', level: 10, hp: 260, hpMax: 300, mp: 30, mpMax: 30, stats: [19, 16, 13, 15, 20, 12] },
  ],
  party: [0, 2, null],
  inventory: [
    { itemId: 0, count: 12 },
    { itemId: 1, count: 3 },
    { itemId: 250, count: 1 },
  ],
  gil: 1234567,
  playtimeSeconds: 3725,
};

/** Namensliste mit 256 Plätzen; nur wenige belegt — wie im Bestand. */
function itemNames(): string[] {
  const names = new Array<string>(256).fill('');
  names[0] = 'Trank';
  names[1] = 'Äther';
  return names;
}

function menuData(spec: FixtureSavemap = BASIS, names = itemNames()): MenuData {
  const savemap = readSavemap(composeSavemapSlot(spec));
  if (!savemap) throw new Error('Savemap nicht lesbar');
  return {
    savemap,
    itemName: (id) => (names[id] && names[id]!.length > 0 ? names[id]! : null),
    locationName: 'Sektor 7',
  };
}

function press(keys: Partial<MenuInput>): MenuInput {
  return { ...NEUTRAL_MENU_INPUT, ...keys };
}

/** Eine Taste drücken und wieder loslassen — das Menü wertet nur Flanken. */
function tap(session: MenuSession, keys: Partial<MenuInput>): void {
  session.step(press(keys));
  session.step(NEUTRAL_MENU_INPUT);
}

describe('S21 Savemap-Leser', () => {
  it('liest Charakterrecords, Party, Inventar, Gil und Spielzeit zurück', () => {
    const savemap = readSavemap(composeSavemapSlot(BASIS))!;
    expect(savemap.characters[0]).toMatchObject({ id: 0, name: 'Wolke', level: 12, hp: 340, hpMax: 480, mp: 22, mpMax: 40 });
    expect(savemap.characters[0]!.stats).toEqual([21, 18, 15, 14, 17, 9]);
    expect(savemap.party).toEqual([0, 2, null]);
    expect(savemap.inventory).toEqual([
      { slot: 0, itemId: 0, count: 12 },
      { slot: 1, itemId: 1, count: 3 },
      { slot: 2, itemId: 250, count: 1 },
    ]);
    expect(savemap.gil).toBe(1234567);
    expect(savemap.playtimeSeconds).toBe(3725);
    expect(savemap.duplicatesConsistent).toBe(true);
  });

  it('meldet nie beschriebene Charakterplätze als unbenutzt, statt sie zu verschweigen', () => {
    const savemap = readSavemap(composeSavemapSlot(BASIS))!;
    expect(savemap.characters).toHaveLength(9);
    expect(savemap.characters.filter((c) => c.used)).toHaveLength(3);
    expect(savemap.characters[5]!.used).toBe(false);
  });

  it('deckt eine widersprüchliche Doppelablage von Gil auf', () => {
    const savemap = readSavemap(composeSavemapSlot({ ...BASIS, breakDuplicates: true }))!;
    expect(savemap.duplicatesConsistent).toBe(false);
    // Der gelesene Wert bleibt der des Vorschaublocks — gemeldet, nicht geraten.
    expect(savemap.gil).toBe(1234567);
  });

  it('liest den Slot aus einer vollständigen save*.ff7-Datei mit gültiger Prüfsumme', () => {
    const datei = composeSaveFile([composeSavemapSlot(BASIS), null, composeSavemapSlot({ ...BASIS, gil: 42 })]);
    const parsed = parseOriginalSave(datei, 'fixture.ff7')!;
    expect(parsed.slots[0]!.occupied).toBe(true);
    expect(parsed.slots[0]!.checksumValid).toBe(true);
    expect(parsed.slots[1]!.occupied).toBe(false);
    expect(readSavemap(parsed.slots[2]!.raw)!.gil).toBe(42);
    // Ein genullter Slot hat keine gültige Prüfsumme — und das ist kein Fehler.
    expect(parsed.diagnostics).toEqual([]);
  });

  it('formatiert die Spielzeit wie das Original', () => {
    expect(formatPlaytime(3725)).toBe('1:02:05');
    expect(formatPlaytime(0)).toBe('0:00:00');
  });
});

describe('S21 Kernel-Namenslisten', () => {
  it('bestimmt die Gegenstandsnamen über Stringanzahl und mittlere Länge, nicht über eine feste Sektionsnummer', async () => {
    const namen = itemNames();
    namen[2] = 'Elixier';
    const beschreibungen = new Array<string>(256).fill('');
    beschreibungen[0] = 'Stellt einen Teil der Trefferpunkte wieder her';
    beschreibungen[1] = 'Stellt einen Teil der Magiepunkte wieder her';
    beschreibungen[2] = 'Stellt Treffer- und Magiepunkte vollstaendig wieder her';

    const bytes = await composeKernelContainer([
      // Eine Recordtabelle davor, damit die Auswahl sie überspringen muss.
      { data: new Uint8Array(256).fill(7) },
      { data: composeTextSection(beschreibungen) },
      { data: composeTextSection(namen) },
    ]);
    const container = await parseKernelContainer(bytes, 'kernel.bin');
    const index = indexKernelSections(container!);
    const listen = pickItemTextLists(index);

    expect(listen.names?.strings[0]).toBe('Trank');
    expect(listen.names?.strings[2]).toBe('Elixier');
    expect(listen.descriptions?.strings[2]).toContain('vollstaendig');
    // Die kürzere Liste ist die Namensliste — genau das unterscheidet sie.
    expect(listen.names!.meanLength).toBeLessThan(listen.descriptions!.meanLength);
  });

  it('rät nicht, wenn keine Liste der erwarteten Länge da ist', async () => {
    const bytes = await composeKernelContainer([{ data: composeTextSection(['a', 'b', 'c']) }]);
    const container = await parseKernelContainer(bytes, 'kernel.bin');
    const listen = pickItemTextLists(indexKernelSections(container!));
    expect(listen.names).toBeNull();
    expect(itemNameLookup(listen.names)(0)).toBeNull();
  });
});

describe('S21 Menü-Ansichten (Golden)', () => {
  it('Gruppenansicht zeigt besetzte und freie Plätze', () => {
    const vm = buildPartyView(menuData());
    expect(vm.rows.map((r) => [r.key, r.label, r.value])).toEqual([
      ['p0', 'Wolke', 'Lv 12  HP 340/480  MP 22/40'],
      ['p1', 'Tifa', 'Lv 10  HP 260/300  MP 30/30'],
      ['p2', 'Platz 3', '— frei —'],
    ]);
    // Nur besetzte Plätze sind anwählbar.
    expect(vm.selectable).toEqual([0, 1]);
  });

  it('Statusansicht zeigt Werte und Balkenfüllung', () => {
    const vm = buildStatusView(menuData(), 0);
    expect(vm.title).toBe('Status — Wolke');
    expect(vm.rows.map((r) => [r.key, r.value])).toEqual([
      ['c0.name', 'Wolke'],
      ['c0.level', '12'],
      ['c0.hp', '340/480'],
      ['c0.mp', '22/40'],
      ['c0.stats', '21 · 18 · 15 · 14 · 17 · 9'],
    ]);
    expect(vm.rows[2]!.fill).toBeCloseTo(340 / 480, 6);
  });

  it('Gegenstandsliste löst Namen über die Kernel-Liste auf und macht Lücken sichtbar', () => {
    const vm = buildItemsView(menuData());
    expect(vm.rows.map((r) => [r.label, r.value])).toEqual([
      ['Trank', '×12'],
      ['Äther', '×3'],
      // Kennung ohne Namen: sichtbar als Lücke, nicht ausgelassen.
      ['?250', '×1'],
    ]);
  });

  it('Übersicht formatiert Gil und Spielzeit umgebungsunabhängig', () => {
    const vm = buildTimeView(menuData());
    expect(vm.rows.map((r) => [r.key, r.value])).toEqual([
      ['gil', '1.234.567'],
      ['zeit', '1:02:05'],
      ['ort', 'Sektor 7'],
    ]);
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1000)).toBe('1.000');
  });

  it('nennt einen widersprüchlichen Spielstand in der Ansicht selbst', () => {
    const vm = buildTimeView(menuData({ ...BASIS, breakDuplicates: true }));
    expect(vm.rows.map((r) => r.key)).toContain('warnung');
  });

  it('ändert die Anzeige allein durch andere Savemap-Daten — ohne Codeänderung', () => {
    const anders = menuData({
      ...BASIS,
      characters: [{ id: 0, name: 'Anders', level: 99, hp: 9999, hpMax: 9999, mp: 999, mpMax: 999 }],
      party: [0, null, null],
      gil: 7,
      playtimeSeconds: 61,
    });
    expect(buildPartyView(anders).rows[0]!.label).toBe('Anders');
    expect(buildPartyView(anders).rows[0]!.value).toBe('Lv 99  HP 9.999/9.999  MP 999/999');
    expect(buildTimeView(anders).rows.map((r) => r.value)).toEqual(['7', '0:01:01', 'Sektor 7']);
  });
});

describe('S21 Menü-Bedienung', () => {
  it('öffnet und schließt über die Umschalttaste', () => {
    const s = new MenuSession(menuData());
    expect(s.viewModel()).toBeNull();
    tap(s, { toggle: true });
    expect(s.state.open).toBe(true);
    tap(s, { toggle: true });
    expect(s.state.open).toBe(false);
  });

  it('wertet nur Flanken — eine gehaltene Taste schaltet nicht durch', () => {
    const s = new MenuSession(menuData());
    s.step(press({ toggle: true }));
    s.step(press({ toggle: true }));
    s.step(press({ toggle: true }));
    expect(s.state.open).toBe(true);
  });

  it('läuft mit dem Zeiger um und öffnet den Status der gewählten Figur', () => {
    const s = new MenuSession(menuData());
    s.open('party');
    tap(s, { down: true });
    expect(s.state.cursor).toBe(1);
    tap(s, { down: true });
    expect(s.state.cursor).toBe(0);
    tap(s, { up: true });
    expect(s.state.cursor).toBe(1); // Umlauf nach hinten
    tap(s, { confirm: true });
    expect(s.state.view).toBe('status');
    expect(s.viewModel()!.title).toBe('Status — Tifa');
  });

  it('blättert innerhalb der Gegenstandsliste, bevor es die Ansicht wechselt', () => {
    const viele = Array.from({ length: 25 }, (_, i) => ({ itemId: i, count: 1 }));
    const s = new MenuSession(menuData({ ...BASIS, inventory: viele }));
    s.open('items');
    expect(s.viewModel()!.title).toBe('Gegenstände (1/3)');
    tap(s, { right: true });
    expect(s.viewModel()!.title).toBe('Gegenstände (2/3)');
    tap(s, { right: true });
    tap(s, { right: true });
    // Letzte Seite erreicht: der nächste Schritt wechselt die Ansicht.
    expect(s.state.view).not.toBe('items');
  });

  it('schließt über Abbrechen', () => {
    const s = new MenuSession(menuData());
    s.open();
    tap(s, { cancel: true });
    expect(s.state.open).toBe(false);
  });
});
