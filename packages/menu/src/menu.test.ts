import { describe, expect, it } from 'vitest';
import {
  composeSaveFile,
  composeSavemapSlot,
  composeKernelContainer,
  composeRecordSection,
  composeTextSection,
  type FixtureSavemap,
} from '@webmidgar/fixture-gen';
import { parseOriginalSave, readSavemap, formatPlaytime } from '@webmidgar/formats-save';
import {
  indexKernelSections,
  inventoryCategory,
  inventoryNameLookup,
  parseKernelContainer,
  resolveKernelNameLists,
  type InventoryNameLookup,
  type KernelNameLists,
} from '@webmidgar/formats-kernel';
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
  // Ein Vertreter je Bereich der Inventarkennung (F18) plus eine Kennung
  // außerhalb aller Listen — die Lücke muss sichtbar bleiben.
  inventory: [
    { itemId: 0, count: 12 }, // Gegenstand
    { itemId: 1, count: 3 }, // Gegenstand
    { itemId: 215, count: 1 }, // Waffe   (215 − 128 = 87)
    { itemId: 258, count: 2 }, // Rüstung (258 − 256 = 2)
    { itemId: 307, count: 1 }, // Accessoire (307 − 288 = 19)
    { itemId: 500, count: 1 }, // außerhalb 0…319
  ],
  gil: 1234567,
  playtimeSeconds: 3725,
};

/**
 * **Der Sektionssatz des Fixtures bildet den echten Kernel nach** — und das ist
 * kein Zierrat, sondern die Lehre aus F18/F24-A: Der alte Test benutzte eine
 * einzelne 256er-Liste, und genau deshalb blieb er grün, während im Menü 100 %
 * der Inventarnamen falsch waren. Ein Fixture, das den mehrdeutigen Teil der
 * Wirklichkeit wegkürzt, kann den Fehler gar nicht sehen.
 *
 * Nachgebildet werden deshalb: fünf Recordtabellen, acht Beschreibungslisten,
 * acht Namenslisten in Originalreihenfolge — mit allen fünf 128er-Listen und
 * beiden 256er-Listen, die die Auswahl mehrdeutig machen.
 */
const NAMES = {
  commands: fuelle(32, 32, (i) => `Kommando${i}`, { 0: 'Angriff', 1: 'Zauber' }),
  magic: fuelle(256, 200, (i) => `Zauber${i}`, { 0: 'Heilung', 1: 'Heilung2', 215: 'NICHT-WAFFE' }),
  // Belegt 0…104 — die Belegungsgrenze ist die zweite Hälfte der Doppelbedingung.
  items: fuelle(128, 105, (i) => `Gegenstand${i}`, { 0: 'Trank', 1: 'Äther' }),
  // Füllgrad 1,000 — der Anker der Rollenbestimmung.
  weapons: fuelle(128, 128, (i) => `Waffe${i}`, { 0: 'Meisterschwert', 87: '4-Spitz-Shuriken' }),
  armor: fuelle(32, 32, (i) => `Ruestung${i}`, { 2: 'Titanreif' }),
  accessories: fuelle(32, 32, (i) => `Accessoire${i}`, { 19: 'Feuerring' }),
  materia: fuelle(96, 84, (i) => `Materia${i}`, { 0: 'MP-Plus' }),
  keyItems: fuelle(64, 51, (i) => `Schluessel${i}`, {}),
} as const;

/** `count` Plätze, davon die ersten `belegt` gefüllt; `sonder` überschreibt einzelne. */
function fuelle(count: number, belegt: number, name: (i: number) => string, sonder: Record<number, string>): string[] {
  const out = new Array<string>(count).fill('');
  for (let i = 0; i < belegt; i++) out[i] = name(i);
  for (const [i, s] of Object.entries(sonder)) out[Number(i)] = s;
  return out;
}

/**
 * Baut ein `kernel.bin`-Fixture mit realistischem Sektionssatz.
 * Reihenfolge wie im Original: Records · Beschreibungen · Namen.
 */
async function kernelFixture(overrides: { weaponsFillRate1?: boolean } = {}): Promise<KernelNameLists> {
  const beschreibung = (n: number, belegt: number): Uint8Array =>
    composeTextSection(fuelle(n, belegt, (i) => `Beschreibungstext Nummer ${i}`, {}));
  const waffen = overrides.weaponsFillRate1 === false ? fuelle(128, 100, (i) => `Waffe${i}`, {}) : [...NAMES.weapons];

  const bytes = await composeKernelContainer([
    // 0…3 — Recordtabellen vor dem Gegenstandsblock. Sektion 1 trägt bewusst
    // dieselbe Länge wie die Gegenstandstabelle (3584 B): Die Einzellänge ist
    // mehrdeutig, erst der Lauf aller fünf Längen ist es nicht.
    { data: composeRecordSection(32, 8) },
    { data: composeRecordSection(256, 14) },
    { data: composeRecordSection(997, 4) },
    { data: composeRecordSection(719, 4) },
    // 4…8 — die fünf typisierten Recordtabellen.
    { data: composeRecordSection(128, 28, itemRecordFuellung) },
    { data: composeRecordSection(128, 44, weaponRecordFuellung) },
    { data: composeRecordSection(32, 36) },
    { data: composeRecordSection(32, 16) },
    { data: composeRecordSection(96, 20, materiaRecordFuellung) },
    // 9…16 — Beschreibungen in Rollenordnung.
    { data: beschreibung(32, 27) },
    { data: beschreibung(256, 149) },
    { data: beschreibung(128, 80) },
    { data: beschreibung(128, 23) },
    { data: beschreibung(32, 8) },
    { data: beschreibung(32, 32) },
    { data: beschreibung(96, 83) },
    { data: beschreibung(64, 49) },
    // 17…24 — Namen in Rollenordnung.
    { data: composeTextSection(NAMES.commands) },
    { data: composeTextSection(NAMES.magic) },
    { data: composeTextSection(NAMES.items) },
    { data: composeTextSection(waffen) },
    { data: composeTextSection(NAMES.armor) },
    { data: composeTextSection(NAMES.accessories) },
    { data: composeTextSection(NAMES.materia) },
    { data: composeTextSection(NAMES.keyItems) },
    // 25 — Kampftexte: die fünfte 128er-Liste, damit die Länge mehrdeutig bleibt.
    { data: composeTextSection(fuelle(128, 93, (i) => `Kampftext${i}`, {})) },
  ]);
  const container = await parseKernelContainer(bytes, 'kernel.bin');
  return resolveKernelNameLists(indexKernelSections(container!));
}

/** Gegenstandsrecord: Verbotsmaske an 0x0A, Angriffskraft an 0x0F. */
function itemRecordFuellung(i: number, _record: Uint8Array, view: DataView): void {
  view.setUint16(0x0a, 0xfffc, true); // ~0xFFFC = 3 ⇒ verkaufbar + im Kampf nutzbar
  view.setUint8(0x0f, i & 0x7f);
}

/** Waffenrecord: Wachstumsrate 0…3 an 0x06, Verbotsmaske an 0x2A. */
function weaponRecordFuellung(i: number, _record: Uint8Array, view: DataView): void {
  view.setUint8(0x06, i % 4);
  view.setUint8(0x1c, 3);
  view.setUint16(0x2a, 0xfff6, true);
}

/** Materiarecord: vier aufsteigende AP-Schwellen. */
function materiaRecordFuellung(i: number, _record: Uint8Array, view: DataView): void {
  [0, 2, 4, 6].forEach((o, k) => view.setUint16(o, (k + 1) * 100 + i, true));
  view.setUint8(0x0d, i % 16);
  view.setUint16(0x0e, 0xffff, true); // ungenutztes Polster — hält die Sektion aus der Textliste heraus
}

const KERNEL_LISTEN = await kernelFixture();
const KERNEL_LOOKUP: InventoryNameLookup = inventoryNameLookup(KERNEL_LISTEN);

function menuData(spec: FixtureSavemap = BASIS, itemName: InventoryNameLookup = KERNEL_LOOKUP): MenuData {
  const savemap = readSavemap(composeSavemapSlot(spec));
  if (!savemap) throw new Error('Savemap nicht lesbar');
  return { savemap, itemName, locationName: 'Sektor 7' };
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
      // Kennungen über 255 belegen den Neunbit-Teil des Inventarworts —
      // der Roundtrip belegt, dass Kennung und Menge sich nicht überlappen.
      { slot: 2, itemId: 215, count: 1 },
      { slot: 3, itemId: 258, count: 2 },
      { slot: 4, itemId: 307, count: 1 },
      { slot: 5, itemId: 500, count: 1 },
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

describe('S21/F18 Kernel-Namenslisten', () => {
  it('ordnet alle acht Rollen zu — über Anker, Nachbarschaft und Gegenprobe, nicht über feste Sektionsnummern', () => {
    expect(KERNEL_LISTEN.reason).toBeNull();
    expect(KERNEL_LISTEN.weaponSection).toBe(20);
    expect(KERNEL_LISTEN.items?.sectionIndex).toBe(19);
    expect(KERNEL_LISTEN.armor?.sectionIndex).toBe(21);
    expect(KERNEL_LISTEN.accessories?.sectionIndex).toBe(22);
    expect(KERNEL_LISTEN.materia?.sectionIndex).toBe(23);
    expect(KERNEL_LISTEN.keyItems?.sectionIndex).toBe(24);
    expect(KERNEL_LISTEN.magic?.sectionIndex).toBe(18);
    expect(KERNEL_LISTEN.commands?.sectionIndex).toBe(17);
    // Beschreibung = Name − 8, über die Stringanzahl gegengeprüft.
    expect(KERNEL_LISTEN.descriptions.items?.sectionIndex).toBe(11);
    expect(KERNEL_LISTEN.descriptions.materia?.sectionIndex).toBe(15);
  });

  it('greift NICHT nach der 256er-Zauberliste — der Defekt F18/F24-A als Regressionsanker', () => {
    // Der alte Code filterte auf `strings.length === 256` und traf damit die
    // Zauberliste. Beide 256er-Listen liegen im Fixture; die Gegenstandsliste
    // hat 128 Plätze.
    expect(KERNEL_LISTEN.items!.strings).toHaveLength(128);
    expect(KERNEL_LISTEN.magic!.strings).toHaveLength(256);
    expect(KERNEL_LISTEN.items!.lastOccupied).toBe(104);
    expect(KERNEL_LOOKUP(0)).toBe('Trank');
    expect(KERNEL_LOOKUP(0)).not.toBe('Heilung');
    // Kennung 215 ist im Zauberbereich belegt — ein einlistiger Zugriff würde
    // hier stillschweigend den falschen Namen liefern.
    expect(KERNEL_LISTEN.magic!.strings[215]).toBe('NICHT-WAFFE');
    expect(KERNEL_LOOKUP(215)).toBe('4-Spitz-Shuriken');
  });

  it('löst je einen Vertreter der vier Bereiche auf (Golden)', () => {
    expect([0, 128, 215, 256, 258, 288, 307].map((id) => [id, inventoryCategory(id)?.category, KERNEL_LOOKUP(id)])).toEqual([
      [0, 'item', 'Trank'],
      [128, 'weapon', 'Meisterschwert'],
      [215, 'weapon', '4-Spitz-Shuriken'],
      [256, 'armor', 'Ruestung0'],
      [258, 'armor', 'Titanreif'],
      [288, 'accessory', 'Accessoire0'],
      [307, 'accessory', 'Feuerring'],
    ]);
    // Grenzen: 127 ist der letzte Gegenstand, 319 das letzte Accessoire,
    // 320 gibt es im Inventar nicht.
    expect(inventoryCategory(127)?.category).toBe('item');
    expect(inventoryCategory(319)).toEqual({ category: 'accessory', index: 31 });
    expect(inventoryCategory(320)).toBeNull();
    expect(KERNEL_LOOKUP(320)).toBeNull();
    // Unbelegter Platz innerhalb eines Bereichs bleibt eine Lücke.
    expect(KERNEL_LOOKUP(110)).toBeNull();
  });

  it('rät nicht, wenn der Anker fehlt', async () => {
    const bytes = await composeKernelContainer([{ data: composeTextSection(['a', 'b', 'c']) }]);
    const listen = resolveKernelNameLists(indexKernelSections((await parseKernelContainer(bytes, 'kernel.bin'))!));
    expect(listen.items).toBeNull();
    expect(listen.weapons).toBeNull();
    expect(listen.reason).toMatch(/kein Anker/);
    expect(inventoryNameLookup(listen)(0)).toBeNull();
  });

  it('rät auch dann nicht, wenn die Waffenliste Lücken hat — der Anker muss echt sein', async () => {
    const listen = await kernelFixture({ weaponsFillRate1: false });
    expect(listen.reason).toMatch(/kein Anker/);
    expect(listen.items).toBeNull();
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

  it('Gegenstandsliste löst alle vier Kennungsbereiche auf und macht Lücken sichtbar', () => {
    const vm = buildItemsView(menuData());
    expect(vm.rows.map((r) => [r.label, r.value])).toEqual([
      ['Trank', '×12'],
      ['Äther', '×3'],
      ['4-Spitz-Shuriken', '×1'],
      ['Titanreif', '×2'],
      ['Feuerring', '×1'],
      // Kennung außerhalb aller Bereiche: sichtbar als Lücke, nicht ausgelassen.
      ['?500', '×1'],
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
