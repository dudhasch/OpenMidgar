import { describe, expect, it } from 'vitest';
import { BattleAiAsm, composeAiScript, composeSceneBin, type SceneSpec } from '@webmidgar/fixture-gen';
import { parseSceneBin } from '@webmidgar/formats-battle';
import type { BattleStarter } from './mode.js';
import { createEncounterBattleStarter } from './starter.js';
import { NEUTRAL_BATTLE_INPUT, type BattleSession, type BattleTickInput, type PartyMemberSpec } from './session.js';

/**
 * Starter-Tests: Fixture-Container (composeSceneBin — dieselbe Grammatik wie
 * das Original: Blöcke à 0x2000, gzip-Ströme, 0xFF-Füllung), dann die
 * ID-Semantik `Szene = id >> 2, Formation = id & 3` als Sollverlauf plus die
 * Quarantäne-Pfade (defekte Szene, leere Formation, ID außerhalb) als `null`.
 */

const party: PartyMemberSpec[] = [
  { id: 'held', level: 10, maxHp: 300, maxMp: 40, strength: 22, defense: 12, magic: 14, mdefense: 10, dexterity: 24, luck: 8 },
];

function enemy(id: number, exp: number): SceneSpec['enemies'][number] {
  return {
    id,
    name: `G${id}`,
    level: 4,
    hp: 40,
    exp,
    gil: 5,
    ap: 1,
    attackSlots: [0],
    aiScript: composeAiScript({ 0: new BattleAiAsm().pushConst(310).attack().end().assemble() }),
  };
}

/** Szene 0: 1 Formation · Szene 1: 3 Formationen mit unterscheidbarer Beute · Szene 2: defekt. */
function containerSpec(): SceneSpec[] {
  return [
    { enemies: [enemy(11, 7)], formations: [{ slots: [{ enemyIndex: 0 }] }], attackIds: [310] },
    {
      enemies: [enemy(20, 13), enemy(21, 17)],
      formations: [
        { slots: [{ enemyIndex: 0 }] },
        { slots: [{ enemyIndex: 1 }] },
        { slots: [{ enemyIndex: 0 }, { enemyIndex: 1 }] },
      ],
      attackIds: [310],
    },
    { enemies: [enemy(30, 99)], formations: [{ slots: [{ enemyIndex: 0 }] }], attackIds: [310] },
  ];
}

async function fixtureStarter(opts: { seed?: number; corrupt?: boolean } = {}): Promise<BattleStarter> {
  const bin = await composeSceneBin(containerSpec(), opts.corrupt ? { corruptSceneIndex: 2 } : {});
  const scenes = await parseSceneBin(bin, 'fixture-scene.bin');
  const starterOpts: Parameters<typeof createEncounterBattleStarter>[0] = { scenes, party };
  if (opts.seed !== undefined) starterOpts.seed = opts.seed;
  return createEncounterBattleStarter(starterOpts);
}

function playToOutcome(session: BattleSession): { outcome: NonNullable<ReturnType<BattleSession['tick']>['outcome']>; digests: string[] } {
  const digests: string[] = [];
  let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
  for (let t = 0; t < 10_000; t++) {
    const r = session.tick(pending);
    pending = NEUTRAL_BATTLE_INPUT;
    if (r.awaitingInput.length > 0) {
      pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
    }
    digests.push(session.digest());
    if (r.outcome) return { outcome: r.outcome, digests };
  }
  throw new Error('kein Ausgang in 10000 Takten');
}

describe('createEncounterBattleStarter: ID-Semantik Szene = id >> 2, Formation = id & 3', () => {
  it('löst Encounter-IDs auf die richtige Szene und Formation auf (Beute als Fingerabdruck)', async () => {
    const starter = await fixtureStarter({ seed: 5 });

    // ID 0 → Szene 0, Formation 0.
    const s0 = starter(0);
    expect(s0).not.toBeNull();
    expect(playToOutcome(s0!).outcome).toMatchObject({ kind: 'victory', exp: 7 });

    // ID 4·1+1 = 5 → Szene 1, Formation 1 (nur Gegner 21).
    const s5 = starter(5);
    expect(playToOutcome(s5!).outcome).toMatchObject({ kind: 'victory', exp: 17, defeatedEnemyTypeIds: [21] });

    // ID 4·1+2 = 6 → Szene 1, Formation 2 (beide Gegner, Beute summiert).
    const s6 = starter(6);
    expect(playToOutcome(s6!).outcome).toMatchObject({ kind: 'victory', exp: 30, defeatedEnemyTypeIds: [20, 21] });
  });

  it('maskiert die Oberbits wie der Sektion-7-Leser (0x03FF)', async () => {
    const starter = await fixtureStarter({ seed: 5 });
    const plain = starter(5)!;
    const masked = starter(0x8000 | 5)!;
    expect(masked).not.toBeNull();
    expect(playToOutcome(masked).outcome).toEqual(playToOutcome(plain).outcome);
  });

  it('gleicher Seed ⇒ bitidentischer Verlauf; anderer Seed ⇒ nachweisbar verschieden', async () => {
    const a = playToOutcome((await fixtureStarter({ seed: 21 }))(6)!);
    const b = playToOutcome((await fixtureStarter({ seed: 21 }))(6)!);
    const c = playToOutcome((await fixtureStarter({ seed: 22 }))(6)!);
    expect(a.digests).toEqual(b.digests);
    expect(c.digests).not.toEqual(a.digests);
  });
});

describe('createEncounterBattleStarter: Quarantäne-Pfade liefern null statt Wurf', () => {
  it('leere Formation ⇒ null (Szene 0 hat nur Formation 0)', async () => {
    const starter = await fixtureStarter();
    expect(starter(1)).toBeNull();
    expect(starter(3)).toBeNull();
  });

  it('ID außerhalb des Containers ⇒ null', async () => {
    const starter = await fixtureStarter();
    expect(starter(4 * 3)).toBeNull(); // Szene 3 existiert nicht
    expect(starter(1023)).toBeNull();
  });

  it('quarantänisierte Szene (defekter gzip-Strom) ⇒ null, Nachbarn bleiben startbar', async () => {
    const starter = await fixtureStarter({ corrupt: true });
    expect(starter(4 * 2)).toBeNull(); // Szene 2 ist defekt
    expect(starter(0)).not.toBeNull(); // Szene 0 unberührt
  });
});
