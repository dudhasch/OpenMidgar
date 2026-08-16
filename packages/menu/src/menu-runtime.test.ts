import { describe, expect, it } from 'vitest';
import {
  composeFieldContainer,
  composeScriptSection,
  composeSavemapSlot,
  composeWalkmeshSection,
  ScriptAssembler,
  type FixtureSavemap,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { FieldSession } from '@webmidgar/field-runtime';
import { readSavemap } from '@webmidgar/formats-save';
import { MenuSession, NEUTRAL_MENU_INPUT, type MenuData, type MenuInput } from './index.js';

/**
 * S21-Abnahme der **Laufzeitseite**: Menü-Opcodes und die Zusicherung, dass das
 * Menü ein reines Overlay ist.
 *
 * Die Digest-Gleichheit ist hier der eigentliche Prüfstein. Sie ist keine
 * Behauptung über den Menücode, sondern eine Messung: Zwei Sitzungen bekommen
 * dieselbe Eingabefolge, eine davon wird zusätzlich durch das komplette Menü
 * gefahren — und wenn deren Digest abweicht, hat das Menü in die Spielwelt
 * geschrieben.
 */

const SAVEMAP: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 5, hp: 90, hpMax: 120, mp: 10, mpMax: 12 },
    { id: 1, name: 'Barret', level: 6, hp: 150, hpMax: 150, mp: 4, mpMax: 8 },
  ],
  party: [0, 1, null],
  inventory: [{ itemId: 0, count: 2 }],
  gil: 500,
  playtimeSeconds: 90,
};

function buildBundle(script: ReturnType<ScriptAssembler['assemble']> | null): FieldBundle {
  const sections: Record<number, Uint8Array> = {
    5: composeWalkmeshSection({
      triangles: [
        { vertices: [[0, 0, 0], [200, 0, 0], [200, 200, 0]] },
        { vertices: [[0, 0, 0], [200, 200, 0], [0, 200, 0]] },
      ],
    }),
  };
  if (script) {
    sections[1] = composeScriptSection({
      entities: [{ name: 'held', entryPoints: [script.offsets['start']!] }],
      scriptBytes: script.bytes,
    });
  }
  const result = parseFieldContainer(composeFieldContainer({ sections }).bytes, 'menufx');
  if (!result.ok || !result.bundle) throw new Error(`Fixture nicht parsebar: ${JSON.stringify(result.diagnostics)}`);
  return result.bundle;
}

function menuData(): MenuData {
  return {
    savemap: readSavemap(composeSavemapSlot(SAVEMAP))!,
    itemName: (id) => (id === 0 ? 'Trank' : null),
    locationName: 'Testfeld',
  };
}

function press(keys: Partial<MenuInput>): MenuInput {
  return { ...NEUTRAL_MENU_INPUT, ...keys };
}

describe('S21 Menü-Opcodes', () => {
  it('MENU reiht eine Wirkung ein und hält den Kontext an, bis der Wirt schließt', () => {
    const script = new ScriptAssembler().label('start').menu(3, 17).setByte(1, 0, 99).ret().assemble();
    const session = new FieldSession(buildBundle(script), { menuMode: 'manual' });

    const first = session.tick();
    const request = first.hostRequests.find((r) => r.kind === 'menu');
    expect(request).toMatchObject({ kind: 'menu', selector: 3, param: 17 });
    expect(first.pendingMenus).toHaveLength(1);

    // Ohne Antwort bleibt der Kontext stehen — die Zuweisung dahinter wirkt nicht.
    session.tick();
    session.tick();
    expect(session.runtime!.state.banks[1]![0]).toBe(0);

    session.closeMenu(first.pendingMenus[0]!.requestId);
    session.tick(); // Ereignis wird am Tickanfang zugestellt
    session.tick();
    expect(session.runtime!.state.banks[1]![0]).toBe(99);
  });

  it('beantwortet Menüaufrufe im Selbstlauf, damit Sweeps nicht stehen bleiben', () => {
    const script = new ScriptAssembler().label('start').menu(1).setByte(1, 0, 42).ret().assemble();
    const session = new FieldSession(buildBundle(script));
    for (let i = 0; i < 5; i++) session.tick();
    expect(session.runtime!.state.banks[1]![0]).toBe(42);
    expect(session.pendingMenus()).toEqual([]);
  });

  it('MENU2 führt seinen Operanden roh mit, statt ihn zu deuten', () => {
    const script = new ScriptAssembler().label('start').menu2(5).ret().assemble();
    const session = new FieldSession(buildBundle(script));
    session.tick();
    session.tick();
    expect(session.runtime!.state.menuAccessRaw).toBe(5);
  });
});

describe('S21 Menü ist ein reines Overlay', () => {
  it('lässt den Replay-Digest unberührt, egal wie ausgiebig es bedient wird', () => {
    const bundle = buildBundle(new ScriptAssembler().label('start').setByte(1, 0, 7).ret().assemble());
    const eingaben = Array.from({ length: 20 }, (_, i) => ({
      moveX: i % 3 === 0 ? 1 : 0,
      moveY: i % 4 === 0 ? 1 : 0,
      confirm: false,
      cancel: false,
    }));

    const ohne = new FieldSession(bundle, { seed: 5 });
    for (const e of eingaben) ohne.tick(e);

    const mit = new FieldSession(bundle, { seed: 5 });
    const menu = new MenuSession(menuData());
    for (const [i, e] of eingaben.entries()) {
      mit.tick(e);
      // Das Menü wird parallel bedient: öffnen, blättern, wählen, schließen.
      // Zweimal Abbrechen, weil der Gegenstands-Bildschirm zweistufig ist wie
      // im Original: erst zurück in die Reiterzeile, dann hinaus.
      menu.step(
        press({ toggle: i === 0, right: i === 3, down: i === 5, confirm: i === 7, cancel: i === 15 || i === 17 }),
      );
      menu.step(NEUTRAL_MENU_INPUT);
    }

    expect(mit.digest()).toBe(ohne.digest());
    // Gegenprobe: Das Menü wurde tatsächlich bedient — sonst wäre die
    // Gleichheit oben nur die Gleichheit zweier untätiger Läufe.
    expect(menu.state.view).not.toBe('party');
    expect(menu.state.open).toBe(false);
  });
});
