import { describe, expect, it } from 'vitest';
import { INVENTORY_RANGES } from '@webmidgar/formats-kernel';
import { countItem, readSavemap, type Savemap } from '@webmidgar/formats-save';
import { composeSavemapSlot, type FixtureSavemap } from '@webmidgar/fixture-gen';
import { MenuSession, NEUTRAL_MENU_INPUT, type MenuInput } from './session.js';
import type { MenuActionHost, SaveSlotChoice } from './actions.js';
import type { MenuData } from './model.js';

/**
 * Abnahme der Menü-Handlungen (F07, Welle 4).
 *
 * Geprüft wird der **ganze Weg**: Tastendruck → Sitzung → Wirt → Savemap →
 * neue Ansicht. Ein Test, der nur `equipItem` aufruft, hätte den Schreibpfad
 * geprüft, den `formats-save` schon selbst prüft; interessant ist hier die
 * Verdrahtung — sie ist die Stelle, an der eine Handlung ins Leere läuft, ohne
 * dass irgendetwas rot wird.
 */

const WAFFE = INVENTORY_RANGES.weaponBase + 2;
const RUESTUNG = INVENTORY_RANGES.armorBase + 5;

const FIXTURE: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 7, hp: 314, hpMax: 314, mp: 54, mpMax: 54, stats: [20, 16, 19, 17, 14, 14] },
  ],
  party: [0, null, null],
  inventory: [
    { itemId: 4, count: 3 },
    { itemId: WAFFE, count: 1 },
    { itemId: RUESTUNG, count: 1 },
  ],
  gil: 200,
  playtimeSeconds: 0,
};

/**
 * Ein Wirt aus zwanzig Zeilen. Er hält die Rohbytes, deutet sie mit dem echten
 * Leser und liefert eine neue Datensicht — genau das, was die Demo auch tut,
 * nur ohne Browser.
 */
class TestWirt implements MenuActionHost {
  bytes: Uint8Array;
  gespeichert: number[] = [];

  constructor(
    slot: Uint8Array,
    private plaetze: SaveSlotChoice[] | null = [
      { index: 0, label: 'Leer', belegt: false },
      { index: 1, label: 'Leer', belegt: false },
    ],
  ) {
    this.bytes = slot;
  }

  slot(): Uint8Array | null {
    return this.bytes;
  }

  apply(slot: Uint8Array): MenuData {
    this.bytes = slot;
    return this.daten();
  }

  saveSlots(): SaveSlotChoice[] {
    if (!this.plaetze) throw new Error('kein Speicher');
    return this.plaetze;
  }

  requestSave(index: number): string {
    this.gespeichert.push(index);
    return `Platz ${index + 1} wird gespeichert…`;
  }

  savemap(): Savemap {
    return readSavemap(this.bytes)!;
  }

  daten(): MenuData {
    return {
      savemap: this.savemap(),
      itemName: (id) => `Ding${id}`,
      locationName: 'Testfeld',
    };
  }
}

/** Ein Tastendruck als Flanke: drücken, loslassen. */
function druck(session: MenuSession, key: keyof MenuInput): void {
  const input: MenuInput = { ...NEUTRAL_MENU_INPUT, [key]: true };
  session.step(input);
  session.step({ ...NEUTRAL_MENU_INPUT });
}

function neueSitzung(wirt?: TestWirt): { session: MenuSession; wirt: TestWirt } {
  const w = wirt ?? new TestWirt(composeSavemapSlot(FIXTURE));
  const session = new MenuSession(w.daten(), w);
  session.open('equip');
  return { session, wirt: w };
}

describe('Menü-Handlungen: Ausrüsten', () => {
  it('öffnet mit Bestätigen die Auswahlliste des Waffenplatzes', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    expect(session.state.view).toBe('pick');
    expect(session.state.pending).toEqual({ kind: 'equip', equipSlot: 'weapon' });
    expect(session.viewModel()?.title).toContain('Waffe');
  });

  it('zeigt in der Waffenauswahl nur Waffen — nicht das ganze Inventar', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    const vm = session.viewModel()!;
    // Drei Inventarzeilen im Stand, davon genau eine Waffe; nichts ausgerüstet,
    // also keine Abnehmen-Zeile.
    expect(vm.rows.map((r) => r.key)).toEqual(['pick1']);
  });

  it('rüstet aus und schreibt das in den Spielstand des Wirts', () => {
    const { session, wirt } = neueSitzung();
    druck(session, 'confirm'); // Waffenplatz
    druck(session, 'confirm'); // erste Waffe
    expect(session.state.view).toBe('equip');
    expect(wirt.savemap().characters[0]!.weapon).toBe(2);
    expect(wirt.savemap().inventory.some((e) => e.itemId === WAFFE)).toBe(false);
  });

  it('erhält beim Tausch die Gesamtzahl der Stücke', () => {
    const { session, wirt } = neueSitzung();
    expect(countItem(wirt.bytes, WAFFE)).toBe(1);
    druck(session, 'confirm');
    druck(session, 'confirm');
    expect(countItem(wirt.bytes, WAFFE)).toBe(1);
  });

  it('bietet nach dem Ausrüsten das Abnehmen an und nimmt wirklich ab', () => {
    const { session, wirt } = neueSitzung();
    druck(session, 'confirm');
    druck(session, 'confirm');
    // Erneut in die Auswahl: jetzt steht die Abnehmen-Zeile vorn.
    druck(session, 'confirm');
    expect(session.viewModel()!.rows[0]!.key).toBe('ab');
    druck(session, 'confirm');
    expect(wirt.savemap().characters[0]!.weapon).toBe(0xff);
    expect(countItem(wirt.bytes, WAFFE)).toBe(1);
  });

  it('trifft mit der zweiten Zeile den Rüstungsplatz, nicht die Waffe', () => {
    const { session, wirt } = neueSitzung();
    druck(session, 'down');
    druck(session, 'confirm');
    expect(session.state.pending).toEqual({ kind: 'equip', equipSlot: 'armor' });
    druck(session, 'confirm');
    expect(wirt.savemap().characters[0]!.armor).toBe(5);
    expect(wirt.savemap().characters[0]!.weapon).toBe(0xff);
  });

  it('führt Abbrechen aus der Auswahlliste zurück in die Ausrüstung', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    druck(session, 'cancel');
    expect(session.state.view).toBe('equip');
    expect(session.state.pending).toBeNull();
    expect(session.state.open).toBe(true);
  });

  it('blättert nicht aus einer laufenden Auswahl heraus', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    druck(session, 'right');
    expect(session.state.view).toBe('pick');
    expect(session.state.pending).not.toBeNull();
  });

  it('nennt den Materia-Vorbehalt in der Ansicht, statt ihn zu verschweigen', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    expect(session.screen()!.notes.join(' ')).toContain('Materia');
  });

  it('meldet den ungerechneten Maximalwert nach dem Ausrüsten', () => {
    const { session } = neueSitzung();
    druck(session, 'confirm');
    druck(session, 'confirm');
    expect(session.state.message).toContain('ungemessen');
  });
});

describe('Menü-Handlungen: ohne Wirt bleibt alles lesend', () => {
  it('ändert ohne Wirt nichts und sagt warum', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const session = new MenuSession(wirt.daten()); // kein Wirt übergeben
    session.open('equip');
    druck(session, 'confirm');
    expect(session.state.view).toBe('equip');
    expect(session.state.message).toContain('nur anzeigen');
  });

  it('ändert ohne Spielstandsbytes nichts und sagt warum', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const leer: MenuActionHost = { slot: () => null, apply: (s) => wirt.apply(s) };
    const session = new MenuSession(wirt.daten(), leer);
    session.open('equip');
    druck(session, 'confirm');
    expect(session.state.view).toBe('equip');
    expect(session.state.message).toContain('gesperrt');
  });
});

describe('Menü-Handlungen: Speichern', () => {
  it('erreicht die Speicheransicht über die Kommandospalte', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const session = new MenuSession(wirt.daten(), wirt);
    session.open('main');
    const spalte = session.visibleCommands();
    const platz = spalte.findIndex((s) => s.key === 'save');
    expect(platz).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < platz; i++) druck(session, 'down');
    druck(session, 'confirm');
    expect(session.state.view).toBe('save');
  });

  it('reicht die Platznummer an den Wirt weiter und zeigt dessen Meldung', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const session = new MenuSession(wirt.daten(), wirt);
    session.open('save');
    druck(session, 'down');
    druck(session, 'confirm');
    expect(wirt.gespeichert).toEqual([1]);
    expect(session.state.message).toContain('Platz 2');
  });

  it('sagt es, wenn kein Speicher angebunden ist', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const ohne: MenuActionHost = { slot: () => wirt.bytes, apply: (s) => wirt.apply(s) };
    const session = new MenuSession(wirt.daten(), ohne);
    session.open('save');
    expect(session.viewModel()!.rows[0]!.value).toContain('Kein Spielstandspeicher');
    druck(session, 'confirm');
    expect(session.state.message).toBeNull(); // keine wählbare Zeile, keine falsche Zusage
  });

  it('meldet ein asynchrones Ergebnis nach', () => {
    const wirt = new TestWirt(composeSavemapSlot(FIXTURE));
    const session = new MenuSession(wirt.daten(), wirt);
    session.open('save');
    druck(session, 'confirm');
    expect(session.state.message).toContain('wird gespeichert');
    session.setMessage('Platz 1 gespeichert');
    expect(session.screen()!.notes[0]).toBe('Platz 1 gespeichert');
  });
});
