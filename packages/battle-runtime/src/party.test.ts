import { describe, expect, it } from 'vitest';
import { BattleAiAsm, composeAiScript, composeSavemapSlot, composeScene } from '@webmidgar/fixture-gen';
import { readSavemap } from '@webmidgar/formats-save';
import { parseScene } from '@webmidgar/formats-battle';
import { defaultParty, partyFromSavemap } from './party.js';
import { BattleSession, battleConfigFromScene, NEUTRAL_BATTLE_INPUT, type BattleTickInput } from './session.js';

/**
 * Party-Brücke: Fixture-Savemap (codegetrennter Composer aus fixture-gen) →
 * Kampfwerte. Die 🟡-Reihenfolge-Deutung des stats-Blocks
 * [str, vit, mag, spi, dex, lck] wird hier als Sollverlauf festgeschrieben —
 * ändert sie sich (Sichtnachweis), bricht genau dieser Test.
 */

function fixtureSavemap(party: (number | null)[] = [0, 3, null]) {
  const slot = composeSavemapSlot({
    characters: [
      { id: 0, name: 'WOLKE', level: 12, hp: 250, hpMax: 300, mp: 30, mpMax: 44, stats: [20, 16, 19, 17, 9, 14] },
      { id: 3, name: 'TINA', level: 11, hp: 280, hpMax: 280, mp: 22, mpMax: 36, stats: [18, 20, 12, 11, 8, 10] },
      // Record 2 bleibt unbeschrieben (used: false) — Kennung 7 im Party-Slot
      // dürfte dann nicht auflösen.
    ],
    party,
    inventory: [],
    gil: 100,
    playtimeSeconds: 60,
  });
  const savemap = readSavemap(slot);
  expect(savemap).not.toBeNull();
  return savemap!;
}

describe('partyFromSavemap: belegte Gruppenplätze → Kampfwerte', () => {
  it('übernimmt Level/HP/MP direkt und die Grundwerte in der 🟡-Reihenfolge', () => {
    const specs = partyFromSavemap(fixtureSavemap());
    expect(specs.length).toBe(2);
    expect(specs[0]).toEqual({
      id: 'WOLKE',
      level: 12,
      maxHp: 300,
      hp: 250,
      maxMp: 44,
      mp: 30,
      strength: 20,
      defense: 16, // 🔵 = vitality (Ausrüstung noch ungedeutet)
      magic: 19,
      mdefense: 17, // 🔵 = spirit
      dexterity: 9,
      luck: 14,
    });
    expect(specs[1]).toMatchObject({ id: 'TINA', level: 11, strength: 18, defense: 20, mdefense: 11 });
  });

  it('überspringt unbesetzte Plätze und Kennungen ohne benutzten Record', () => {
    expect(partyFromSavemap(fixtureSavemap([null, null, null]))).toEqual([]);
    // Kennung 7 hat keinen beschriebenen Record; Kennung 3 löst auf.
    const specs = partyFromSavemap(fixtureSavemap([7, 3, null]));
    expect(specs.map((s) => s.id)).toEqual(['TINA']);
  });

  it('Reihenfolge folgt den Party-Slots, nicht dem Recordarray', () => {
    const specs = partyFromSavemap(fixtureSavemap([3, 0, null]));
    expect(specs.map((s) => s.id)).toEqual(['TINA', 'WOLKE']);
  });
});

describe('defaultParty: 🔵-Startaufstellung ohne Spielstand', () => {
  it('liefert vollständige, kampffähige Werte', () => {
    const specs = defaultParty();
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.level).toBeGreaterThan(0);
      expect(s.maxHp).toBeGreaterThan(0);
      expect(s.strength).toBeGreaterThan(0);
      expect(s.dexterity).toBeGreaterThan(0);
    }
    // Kennungen sind eindeutig (Aktor-IDs der Session).
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it('trägt einen Kampf aus Szenendaten bis zum Sieg (produktiv startbar)', () => {
    const scene = parseScene(
      composeScene({
        enemies: [
          {
            id: 16,
            name: 'WACHE',
            level: 3,
            hp: 30,
            exp: 6,
            gil: 4,
            ap: 1,
            attackSlots: [0],
            aiScript: composeAiScript({ 0: new BattleAiAsm().pushConst(320).attack().end().assemble() }),
          },
        ],
        formations: [{ slots: [{ enemyIndex: 0 }] }],
        attackIds: [320],
      }),
      0,
    );
    const session = new BattleSession(battleConfigFromScene(scene, 0, defaultParty(), { seed: 13 }));
    let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 10_000; t++) {
      const r = session.tick(pending);
      pending = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) {
        pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      }
      if (r.outcome) {
        expect(r.outcome).toMatchObject({ kind: 'victory', exp: 6 });
        return;
      }
    }
    throw new Error('kein Sieg in 10000 Takten');
  });
});
