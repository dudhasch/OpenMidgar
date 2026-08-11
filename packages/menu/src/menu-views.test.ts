import { describe, expect, it } from 'vitest';
import {
  composeKernelContainer,
  composeRecordSection,
  composeSavemapSlot,
  composeTextSection,
  type FixtureSavemap,
} from '@webmidgar/fixture-gen';
import { readSavemap, ROW_BACK, ROW_FRONT } from '@webmidgar/formats-save';
import {
  indexKernelSections,
  inventoryDescriptionLookup,
  inventoryNameLookup,
  listNameLookup,
  parseKernelContainer,
  readMateriaRecords,
  resolveKernelDataSections,
  resolveKernelNameLists,
  spacingTableFrom,
} from '@webmidgar/formats-kernel';
import { FF7_WINDOW_SKIN } from '@webmidgar/ui-window';
import {
  buildConfigView,
  buildEquipView,
  buildLimitView,
  buildMagicView,
  buildMainScreen,
  buildMateriaView,
  buildPhsView,
  buildTimeView,
  buildViewScreen,
  contentRect,
  FF7_MAIN_MENU_LAYOUT,
  MENU_SURFACE,
  MenuSession,
  rectInSurface,
  rectsOverlap,
  resolveLocation,
  screenMetrics,
  textWidth,
  type MenuData,
} from './index.js';

/**
 * Golden-Abnahme der neuen Menüansichten (F24-B).
 *
 * Der Vergleich läuft über die **Struktur** — Zeilenschlüssel, Beschriftungen,
 * Werte, Rechtecke, Spaltenanker. Ein Pixelvergleich würde hier weniger
 * messen und mehr scheitern: Er hinge an Schriftrendering und Grafikkarte,
 * während die Frage „steht in der Materiazeile der richtige Name und die
 * richtige AP-Zahl" davon gar nicht abhängt.
 *
 * Das tragende Kriterium des Auftrags ist der **letzte** Test dieser Datei:
 * Eine Änderung der Savemap muss die Anzeige ändern, ohne dass eine Zeile Code
 * angefasst wird.
 */

// --- Fixtures ---------------------------------------------------------------

const SPIELSTAND: FixtureSavemap = {
  characters: [
    {
      id: 0,
      name: 'Wolke',
      level: 12,
      hp: 340,
      hpMax: 480,
      mp: 22,
      mpMax: 40,
      stats: [21, 18, 15, 14, 17, 9],
      weapon: 0,
      armor: 2,
      accessory: 19,
      // Vier getragene Materia: zwei in der Waffe, eine in der Rüstung, eine
      // gemeisterte. Die Sättigungsmarke 0xFFFFFF ist ausdrücklich dabei.
      materia: [
        { id: 0, ap: 250 },
        { id: 1, ap: 0 },
        { id: 0xff, ap: 0xffffff },
        { id: 0xff, ap: 0xffffff },
        { id: 0xff, ap: 0xffffff },
        { id: 0xff, ap: 0xffffff },
        { id: 0xff, ap: 0xffffff },
        { id: 0xff, ap: 0xffffff },
        { id: 2, ap: 0xffffff },
      ],
      limitLevel: 2,
      limitBar: 255,
      // Bits 0, 1 und 3 gesetzt ⇒ Limit 1-1, 1-2 und 2-2 gelernt.
      limitsLearned: 0b1011,
      row: ROW_BACK,
      exp: 14764,
      expToNext: 201,
    },
    { id: 1, name: 'Barret', level: 11, hp: 500, hpMax: 500, mp: 8, mpMax: 30, weapon: 1, armor: 0, accessory: 0xff },
    { id: 2, name: 'Tifa', level: 10, hp: 260, hpMax: 300, mp: 30, mpMax: 30 },
  ],
  party: [0, 2, null],
  inventory: [
    { itemId: 0, count: 12 },
    { itemId: 215, count: 1 },
  ],
  gil: 1234567,
  playtimeSeconds: 3725,
  location: 'Slum von Sektor 7',
  phsAllowed: 0b111,
  phsVisible: 0b11,
  menuVisible: 0xffff,
  menuLocked: 0,
  battleSpeed: 128,
  battleMessageSpeed: 128,
  fieldMessageSpeed: 128,
  disc: 1,
};

function fuelle(count: number, belegt: number, name: (i: number) => string, sonder: Record<number, string> = {}): string[] {
  const out = new Array<string>(count).fill('');
  for (let i = 0; i < belegt; i++) out[i] = name(i);
  for (const [i, s] of Object.entries(sonder)) out[Number(i)] = s;
  return out;
}

const NAMEN = {
  commands: fuelle(32, 32, (i) => `Kommando${i}`),
  magic: fuelle(256, 200, (i) => `Zauber${i}`, { 3: 'Feuer', 4: 'Feuer2', 9: 'Heilung' }),
  items: fuelle(128, 105, (i) => `Gegenstand${i}`, { 0: 'Trank' }),
  weapons: fuelle(128, 128, (i) => `Waffe${i}`, { 0: 'Buster-Schwert', 1: 'Gatling' }),
  armor: fuelle(32, 32, (i) => `Ruestung${i}`, { 0: 'Bronzearmband', 2: 'Titanreif' }),
  accessories: fuelle(32, 32, (i) => `Accessoire${i}`, { 19: 'Feuerring' }),
  materia: fuelle(96, 84, (i) => `Materia${i}`, { 0: 'Feuer-Materia', 1: 'Heil-Materia', 2: 'Blitz-Materia' }),
  keyItems: fuelle(64, 51, (i) => `Schluessel${i}`),
} as const;

/** Materiarecord mit AP-Schwellen **und** Attributbytes (Zauberindizes). */
function materiaRecordFuellung(i: number, _record: Uint8Array, view: DataView): void {
  // Schwellen 2…5. Multipliziert mit dem 🟡 Faktor 100 ergibt Stufe 2 ab 200 AP.
  [0, 2, 4, 6].forEach((o, k) => view.setUint16(o, (k + 1) * 2, true));
  view.setUint8(0x0c, 0);
  view.setUint8(0x0d, 9);
  // Attributbytes 0x0E…0x13: aufsteigende Zauberindizes, hinten 0xFF.
  const zauber = i === 0 ? [3, 4] : i === 1 ? [9] : [];
  for (let k = 0; k < 6; k++) view.setUint8(0x0e + k, zauber[k] ?? 0xff);
}

async function kernel(): Promise<{
  itemName: ReturnType<typeof inventoryNameLookup>;
  itemDescription: ReturnType<typeof inventoryDescriptionLookup>;
  materiaName: ReturnType<typeof listNameLookup>;
  magicName: ReturnType<typeof listNameLookup>;
  materiaRecords: ReturnType<typeof readMateriaRecords>;
}> {
  const beschreibung = (n: number, belegt: number, praefix: string): Uint8Array =>
    composeTextSection(fuelle(n, belegt, (i) => `${praefix} ${i}`));

  const bytes = await composeKernelContainer([
    { data: composeRecordSection(32, 8) },
    { data: composeRecordSection(256, 14) },
    { data: composeRecordSection(997, 4) },
    { data: composeRecordSection(719, 4) },
    { data: composeRecordSection(128, 28) },
    { data: composeRecordSection(128, 44) },
    { data: composeRecordSection(32, 36) },
    { data: composeRecordSection(32, 16) },
    { data: composeRecordSection(96, 20, materiaRecordFuellung) },
    { data: beschreibung(32, 27, 'Kommandotext') },
    { data: beschreibung(256, 149, 'Zaubertext') },
    { data: beschreibung(128, 80, 'Heilt etwas Leben,') },
    { data: beschreibung(128, 23, 'Ein Schwert,') },
    { data: beschreibung(32, 8, 'Ruestungstext') },
    { data: beschreibung(32, 32, 'Accessoiretext') },
    { data: beschreibung(96, 83, 'Materiatext') },
    { data: beschreibung(64, 49, 'Schluesseltext') },
    { data: composeTextSection(NAMEN.commands) },
    { data: composeTextSection(NAMEN.magic) },
    { data: composeTextSection(NAMEN.items) },
    { data: composeTextSection(NAMEN.weapons) },
    { data: composeTextSection(NAMEN.armor) },
    { data: composeTextSection(NAMEN.accessories) },
    { data: composeTextSection(NAMEN.materia) },
    { data: composeTextSection(NAMEN.keyItems) },
    { data: composeTextSection(fuelle(128, 93, (i) => `Kampftext${i}`)) },
  ]);
  const container = (await parseKernelContainer(bytes, 'kernel.bin'))!;
  const listen = resolveKernelNameLists(indexKernelSections(container));
  const sektionen = resolveKernelDataSections(container);
  return {
    itemName: inventoryNameLookup(listen),
    itemDescription: inventoryDescriptionLookup(listen),
    materiaName: listNameLookup(listen.materia),
    magicName: listNameLookup(listen.magic),
    materiaRecords: readMateriaRecords(container, sektionen),
  };
}

const KERNEL = await kernel();

/**
 * Eine Glyphentabelle mit **verschiedenen** Breiten. Gleichbreite Glyphen
 * würden den Spaltentest wertlos machen: Er soll ja gerade zeigen, dass die
 * gemessenen Breiten benutzt werden und nicht eine Pauschale.
 */
const SPACING = spacingTableFrom(Uint8Array.from({ length: 256 }, (_, i) => 4 + (i % 9)));

function menuData(spec: FixtureSavemap = SPIELSTAND, extra: Partial<MenuData> = {}): MenuData {
  const savemap = readSavemap(composeSavemapSlot(spec));
  if (!savemap) throw new Error('Savemap nicht lesbar');
  return {
    savemap,
    itemName: KERNEL.itemName,
    itemDescription: KERNEL.itemDescription,
    materiaName: KERNEL.materiaName,
    magicName: KERNEL.magicName,
    materiaRecords: KERNEL.materiaRecords,
    locationName: 'Feldname des Wirts',
    spacing: SPACING,
    metricsMeasured: true,
    metricsDiagnostic: null,
    ...extra,
  };
}

// --- Ortsanzeige ------------------------------------------------------------

describe('F24-B Ortsanzeige', () => {
  it('nimmt den Ortsnamen aus der Savemap und nicht vom Wirt', () => {
    const ort = resolveLocation(menuData());
    expect(ort).toEqual({ name: 'Slum von Sektor 7', source: 'savemap', note: null });
    expect(buildTimeView(menuData()).rows.find((r) => r.key === 'ort')!.value).toBe('Slum von Sektor 7');
  });

  it('fällt auf den Vorschaublock zurück, wenn die laufende Ablage leer ist — und sagt es', () => {
    const ort = resolveLocation(menuData({ ...SPIELSTAND, location: '', previewLocation: 'Notspeicherstand' }));
    expect(ort.name).toBe('Notspeicherstand');
    expect(ort.source).toBe('preview');
    expect(ort.note).toMatch(/0x0028/);
  });

  it('nennt den Wirtsnamen als solchen, wenn der Spielstand keinen Ort trägt', () => {
    const vm = buildTimeView(menuData({ ...SPIELSTAND, location: '', previewLocation: '' }));
    expect(vm.rows.find((r) => r.key === 'ort')!.value).toBe('Feldname des Wirts');
    expect(vm.notes!.join(' ')).toMatch(/nicht aus dem Spielstand/);
  });

  it('meldet eine widersprüchliche Doppelablage, statt sie zu überlesen', () => {
    const data = menuData({ ...SPIELSTAND, location: 'Hier', previewLocation: 'Dort' });
    expect(data.savemap.locationConsistent).toBe(false);
    expect(buildTimeView(data).notes!.join(' ')).toMatch(/widersprüchlich/);
  });
});

// --- Neue Ansichten ---------------------------------------------------------

describe('F24-B Ansichten (Golden)', () => {
  it('Ausrüstung nennt Waffe, Rüstung, Accessoire, Platzzahl und Reihe', () => {
    const vm = buildEquipView(menuData(), 0);
    expect(vm.title).toBe('Ausrüstung — Wolke');
    expect(vm.rows.map((r) => [r.key, r.label, r.value])).toEqual([
      ['c0.weapon', 'Waffe', 'Buster-Schwert  ○2'],
      ['c0.armor', 'Rüstung', 'Titanreif  ○1'],
      ['c0.accessory', 'Accessoire', 'Feuerring'],
      ['c0.row', 'Reihe', 'hinten'],
    ]);
    // Beschreibungen aus den Kernel-Beschreibungslisten (Teil 4).
    expect(vm.rows[0]!.description).toMatch(/^Ein Schwert, 0$/);
    expect(vm.rows[1]!.description).toMatch(/^Ruestungstext 2$/);
  });

  it('Ausrüstung zeigt leere Plätze als solche und die vordere Reihe', () => {
    const vm = buildEquipView(menuData(), 1);
    expect(vm.rows.map((r) => r.value)).toEqual(['Gatling  ○0', 'Bronzearmband  ○0', '—', 'vorne']);
  });

  it('Materia zeigt alle 16 Plätze, Träger, Stufe und die Meistermarke', () => {
    const vm = buildMateriaView(menuData(), 0);
    expect(vm.rows).toHaveLength(16);
    expect(vm.rows.slice(0, 3).map((r) => [r.label, r.value])).toEqual([
      // 250 AP ≥ Schwelle 2×100 ⇒ Stufe 2; 400/600/800 sind noch nicht erreicht.
      ['W1  Feuer-Materia', 'Lv 2  AP 250'],
      ['W2  Heil-Materia', 'Lv 1  AP 0'],
      ['W3', '— leer —'],
    ]);
    // Platz 9 sitzt in der Rüstung und trägt die Sättigungsmarke.
    expect(vm.rows[8]!.label).toBe('R1  Blitz-Materia');
    expect(vm.rows[8]!.value).toBe('★  AP Meister');
    expect(vm.selectable).toEqual([0, 1, 8]);
    expect(vm.notes!.join(' ')).toMatch(/AP-Faktor/);
  });

  it('Zauber leitet aus den Attributbytes ab und nennt jedes Mal die Quelle', () => {
    const vm = buildMagicView(menuData(), 0);
    expect(vm.rows.map((r) => [r.label, r.value])).toEqual([
      ['Feuer', 'Feuer-Materia'],
      ['Feuer2', 'Feuer-Materia'],
      ['Heilung', 'Heil-Materia'],
    ]);
    // Die Unsicherheit steht in der Ansicht, nicht in einem Protokoll.
    expect(vm.notes!.join(' ')).toMatch(/🔴/);
  });

  it('Limit zeigt Stufe, Balken und die sieben Limitzeilen', () => {
    const vm = buildLimitView(menuData(), 0);
    expect(vm.rows.slice(0, 2).map((r) => [r.label, r.value])).toEqual([
      ['Limitstufe', '2'],
      ['Limitbalken', 'bereit'],
    ]);
    // Bits 0, 1, 3 gesetzt: die Bitmaske ist löchrig, die Zeilenfolge nicht.
    expect(vm.rows.slice(2).map((r) => [r.label, r.value])).toEqual([
      ['Limit 1-1', 'gelernt'],
      ['Limit 1-2', 'gelernt'],
      ['Limit 2-1', 'gelernt'],
      ['Limit 2-2', '—'],
      ['Limit 3-1', '—'],
      ['Limit 3-2', '—'],
      ['Limit 4-1', '—'],
    ]);
  });

  it('PHS unterscheidet Gruppe, verfügbar und gesperrt und zeigt die Rohmasken', () => {
    const vm = buildPhsView(menuData());
    expect(vm.rows.slice(0, 3).map((r) => [r.label, r.value.split('  ').pop()])).toEqual([
      ['Wolke', 'in der Gruppe'],
      ['Barret', 'verfügbar'],
      ['Tifa', 'in der Gruppe'],
    ]);
    expect(vm.rows.find((r) => r.key === 'phsroh')!.value).toBe('erlaubt 0x7 · sichtbar 0x3');
  });

  it('PHS meldet eine Figur als gesperrt, wenn ihr Bit fehlt', () => {
    const vm = buildPhsView(menuData({ ...SPIELSTAND, phsAllowed: 0b001 }));
    expect(vm.rows[1]!.value.split('  ').pop()).toBe('gesperrt');
  });

  it('Konfiguration zeigt Rohwerte und den Zustand jedes Menüpunkts', () => {
    const vm = buildConfigView(menuData({ ...SPIELSTAND, options: 0x4455, menuVisible: 0x03fb, menuLocked: 0x0100 }));
    expect(vm.rows.find((r) => r.key === 'cfg.options')!.value).toBe('0x4455');
    // Bit 2 (materia) fehlt in 0x02FB ⇒ ausgeblendet; Bit 8 (phs) ist gesperrt.
    const zustand = Object.fromEntries(
      vm.rows.filter((r) => r.key.startsWith('cfg.item.')).map((r) => [r.key.slice('cfg.item.'.length), r.value]),
    );
    expect(zustand['materia']).toBe('ausgeblendet');
    expect(zustand['phs']).toBe('gesperrt');
    expect(zustand['item']).toBe('frei');
  });

  it('kommt ohne Kernel-Listen aus und sagt in der Ansicht, was fehlt', () => {
    const nackt = menuData(SPIELSTAND, {
      itemDescription: undefined,
      materiaName: undefined,
      magicName: undefined,
      materiaRecords: undefined,
    });
    expect(buildMateriaView(nackt, 0).rows[0]!.label).toBe('W1  ?0');
    expect(buildMateriaView(nackt, 0).notes!.join(' ')).toMatch(/Keine Materia-Namensliste/);
    expect(buildMagicView(nackt, 0).rows[0]!.value).toBe('Keine Zauber');
  });
});

// --- Bildschirm -------------------------------------------------------------

describe('F24-B Bildschirmaufbau', () => {
  it('die Hauptmenü-Aufteilung überlappt nicht und bleibt auf der Menüfläche', () => {
    const l = FF7_MAIN_MENU_LAYOUT;
    const rechtecke = [l.commands, l.party, l.location, l.timeGil];
    for (const r of rechtecke) expect(rectInSurface(r)).toBe(true);
    for (let i = 0; i < rechtecke.length; i++) {
      for (let j = i + 1; j < rechtecke.length; j++) {
        expect(rectsOverlap(rechtecke[i]!, rechtecke[j]!)).toBe(false);
      }
    }
    // 🟢 F40: Menüs nutzen 640×480, nicht die 640×448 von Field und Kampf.
    expect(MENU_SURFACE).toEqual({ width: 640, height: 480 });
  });

  it('baut vier Fenster mit Kommandospalte, Gruppe, Ort und Zeit/Gil', () => {
    const s = buildMainScreen(menuData());
    expect(s.panels.map((p) => p.id)).toEqual(['commands', 'party', 'location', 'timeGil']);
    expect(s.metricsMeasured).toBe(true);
    expect(s.panels[0]!.lines.map((l) => l.runs[0]!.text)).toEqual([
      'Gegenstand',
      'Zauber',
      'Materia',
      'Ausrüstung',
      'Status',
      'Reihe',
      'Limit',
      'Konfig.',
      'PHS',
      'Speichern',
    ]);
    // Ort und Zeit/Gil kommen aus dem Spielstand.
    expect(s.panels[2]!.lines[0]!.runs[0]!.text).toBe('Slum von Sektor 7');
    expect(s.panels[3]!.lines.map((l) => l.runs[1]!.text)).toEqual(['1:02:05', '1.234.567']);
  });

  it('blendet gesperrte Kommandos gedämpft ein, statt sie zu verschweigen', () => {
    const s = buildMainScreen(menuData({ ...SPIELSTAND, menuVisible: 0x03fb, menuLocked: 0x0100 }));
    const spalte = s.panels[0]!.lines;
    expect(spalte.map((l) => l.runs[0]!.text)).not.toContain('Materia');
    const phs = spalte.find((l) => l.runs[0]!.text === 'PHS')!;
    expect(phs.runs[0]!.dim).toBe(true);
    expect(phs.selectable).toBe(false);
  });

  it('rechnet Textbreiten mit der gemessenen Glyphentabelle, nicht mit einer Pauschale', () => {
    const m = screenMetrics(SPACING);
    // Die Fixture-Tabelle vergibt verschiedene Breiten; „i" und „M" liegen
    // deshalb auseinander. Eine Pauschalbreite würde hier gleich messen.
    expect(textWidth('i', m)).not.toBe(textWidth('M', m));
    expect(textWidth('ii', m)).toBe(2 * textWidth('i', m));
    // Und die Breite steht an jedem Textlauf, damit die Demo nichts nachrechnet.
    const s = buildMainScreen(menuData());
    const lauf = s.panels[0]!.lines[0]!.runs[0]!;
    expect(lauf.width).toBe(textWidth(lauf.text, m));
    expect(lauf.width).toBeGreaterThan(0);
  });

  it('meldet die Ersatzmetrik sichtbar, statt sie stillschweigend zu benutzen', () => {
    const s = buildMainScreen(menuData(SPIELSTAND, { spacing: undefined, metricsMeasured: false, metricsDiagnostic: 'WINDOW.BIN nicht geladen' }));
    expect(s.metricsMeasured).toBe(false);
    expect(s.notes).toContain('WINDOW.BIN nicht geladen');
  });

  it('setzt die Textfläche aus Bordüre und Polsterung der gemeinsamen Schale', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 };
    const c = contentRect(rect);
    const b = FF7_WINDOW_SKIN.border.reduce((n, l) => n + l.width, 0);
    expect(c.x).toBe(b + FF7_WINDOW_SKIN.padding[0]);
    expect(c.width).toBe(200 - 2 * b - FF7_WINDOW_SKIN.padding[0] - FF7_WINDOW_SKIN.padding[2]);
  });

  it('legt Listenansichten als Titel-, Listen- und Beschreibungsfenster an', () => {
    const s = new MenuSession(menuData());
    s.open('items');
    const bild = s.screen()!;
    expect(bild.panels.map((p) => p.id)).toEqual(['title', 'list', 'description']);
    // Die Beschreibungszeile zeigt den Text der markierten Zeile.
    expect(bild.panels[2]!.lines[0]!.runs[0]!.text).toMatch(/^Heilt etwas Leben, 0$/);
    // Fenster stapeln sich lückenlos und bleiben auf der Fläche.
    for (const p of bild.panels) expect(rectInSurface(p.rect)).toBe(true);
  });

  it('Wertespalte ist rechtsbündig an der Textflächenkante verankert', () => {
    const s = new MenuSession(menuData());
    s.open('items');
    const liste = s.screen()!.panels[1]!;
    const wert = liste.lines[0]!.runs[1]!;
    expect(wert.align).toBe('right');
    expect(wert.x).toBe(liste.content.width);
  });
});

// --- Bedienung --------------------------------------------------------------

describe('F24-B Bedienung des Hauptmenüs', () => {
  it('öffnet über die Kommandospalte die zugehörige Ansicht und kehrt zurück', () => {
    const s = new MenuSession(menuData());
    s.open('main');
    expect(s.state.view).toBe('main');
    // Zweites Kommando: Zauber.
    s.step({ ...NEUTRAL, down: true });
    s.step(NEUTRAL);
    s.step({ ...NEUTRAL, confirm: true });
    s.step(NEUTRAL);
    expect(s.state.view).toBe('magic');
    // Abbrechen führt zurück ins Hauptmenü, nicht hinaus.
    s.step({ ...NEUTRAL, cancel: true });
    s.step(NEUTRAL);
    expect(s.state.view).toBe('main');
    expect(s.state.open).toBe(true);
    // Erst der zweite Abbruch schließt.
    s.step({ ...NEUTRAL, cancel: true });
    s.step(NEUTRAL);
    expect(s.state.open).toBe(false);
  });

  it('überspringt gesperrte Kommandos beim Wählen', () => {
    const s = new MenuSession(menuData({ ...SPIELSTAND, menuVisible: 0xffff, menuLocked: 0b1 }));
    s.open('main');
    const vm = s.viewModel()!;
    expect(vm.rows[0]!.value).toBe('gesperrt');
    expect(vm.selectable).not.toContain(0);
  });
});

const NEUTRAL = {
  toggle: false,
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  cancel: false,
};

// --- Das Abnahmekriterium ---------------------------------------------------

describe('F24-B Abnahme: die Savemap steuert die Anzeige', () => {
  it('ändert jede neue Ansicht allein durch andere Savemap-Daten', () => {
    const anders: FixtureSavemap = {
      ...SPIELSTAND,
      characters: [
        {
          ...SPIELSTAND.characters[0]!,
          name: 'Anders',
          weapon: 1,
          armor: 0,
          accessory: 0xff,
          materia: [{ id: 1, ap: 0xffffff }],
          limitLevel: 4,
          limitBar: 0,
          limitsLearned: 0,
          row: ROW_FRONT,
        },
        SPIELSTAND.characters[1]!,
        SPIELSTAND.characters[2]!,
      ],
      location: 'Nibelheim',
      gil: 7,
      playtimeSeconds: 61,
      phsAllowed: 0,
    };
    const b = menuData(anders);

    expect(buildEquipView(b, 0).title).toBe('Ausrüstung — Anders');
    expect(buildEquipView(b, 0).rows.map((r) => r.value)).toEqual(['Gatling  ○1', 'Bronzearmband  ○0', '—', 'vorne']);
    expect(buildMateriaView(b, 0).rows[0]!.value).toBe('★  AP Meister');
    expect(buildMagicView(b, 0).rows.map((r) => r.label)).toEqual(['Heilung']);
    expect(buildLimitView(b, 0).rows.slice(0, 2).map((r) => r.value)).toEqual(['4', '0/255']);
    expect(buildLimitView(b, 0).rows.slice(2).every((r) => r.value === '—')).toBe(true);
    expect(buildPhsView(b).rows[1]!.value).toMatch(/gesperrt$/);
    expect(resolveLocation(b).name).toBe('Nibelheim');

    const bild = buildMainScreen(b);
    expect(bild.panels[2]!.lines[0]!.runs[0]!.text).toBe('Nibelheim');
    expect(bild.panels[3]!.lines.map((l) => l.runs[1]!.text)).toEqual(['0:01:01', '7']);
  });

  it('der Bildschirm einer Ansicht folgt ihrem Zeilenmodell ohne Zwischenschritt', () => {
    const vm = buildLimitView(menuData(), 0);
    const bild = buildViewScreen(vm, menuData(), 0);
    expect(bild.panels[1]!.lines.map((l) => l.key)).toEqual(vm.rows.map((r) => r.key));
    expect(bild.panels[0]!.lines[0]!.runs[0]!.text).toBe(vm.title);
  });
});
