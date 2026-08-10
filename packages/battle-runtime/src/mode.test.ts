import { describe, expect, it } from 'vitest';
import {
  BattleAiAsm,
  composeAiScript,
  composeEncounterSection,
  composeFieldContainer,
  composeGrowthSection,
  composeScene,
  composeScriptSection,
  composeWalkmeshSection,
  ScriptAssembler,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { parseGrowthSection, parseScene } from '@webmidgar/formats-battle';
import { readBank } from '@webmidgar/interpreter';
import { FieldSession, type FieldInput } from '@webmidgar/field-runtime';
import { BattleModeCoordinator, encodeOutcome, type FieldPort } from './mode.js';
import { applyExperience, expTotalForLevel, type CharacterProgress } from './rewards.js';
import { BattleSession, battleConfigFromScene, NEUTRAL_BATTLE_INPUT, type BattleTickInput } from './session.js';

/**
 * S33-Tests: Modus-Vertrag Field ↔ Battle (ADR-026), Zufallskämpfe,
 * Ergebnisverbuchung. Der zentrale Nachweis: Replay ÜBER DIE MODUSGRENZE
 * bitidentisch — plus die Pflicht-Gegenprobe (verschobene Eingabe ⇒ anderer
 * Digest), ohne die die Gleichheit wertlos wäre.
 */

function flatRect(x0: number, y0: number, x1: number, y1: number, z = 0): WalkmeshSpec {
  return {
    triangles: [
      { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z]] },
      { vertices: [[x0, y0, z], [x1, y1, z], [x0, y1, z]] },
    ],
  };
}

function scriptSection(asm: ScriptAssembler): Uint8Array {
  const { bytes } = asm.assemble();
  return composeScriptSection({ entities: [{ name: 'hero', entryPoints: [0] }], scriptBytes: bytes });
}

function buildBundle(spec: { script?: Uint8Array; encounter?: Uint8Array }): FieldBundle {
  const sections: Record<number, Uint8Array> = { 5: composeWalkmeshSection(flatRect(-500, -500, 500, 500)) };
  if (spec.script) sections[1] = spec.script;
  if (spec.encounter) sections[7] = spec.encounter;
  const layout = composeFieldContainer({ sections });
  const result = parseFieldContainer(layout.bytes, 'fxmode');
  if (!result.ok || !result.bundle) throw new Error('Fixture nicht parsebar');
  return result.bundle;
}

function fieldPort(session: FieldSession): FieldPort {
  return {
    tick: (input) => session.tick(input as FieldInput),
    postBattleFinished: (requestId, outcome) =>
      session.runtime!.postEvent({ kind: 'battle-finished', requestId, outcome }),
    digest: () => session.digest(),
  };
}

function fixtureBattleScene() {
  return parseScene(
    composeScene({
      enemies: [
        {
          id: 5,
          name: 'W',
          level: 3,
          hp: 40,
          exp: 12,
          gil: 7,
          ap: 1,
          attackSlots: [0],
          aiScript: composeAiScript({ 0: new BattleAiAsm().pushConst(280).attack().end().assemble() }),
        },
      ],
      formations: [{ slots: [{ enemyIndex: 0 }] }],
      attackIds: [280],
    }),
    0,
  );
}

const party = [
  { id: 'held', level: 10, maxHp: 300, maxMp: 40, strength: 22, defense: 12, magic: 14, mdefense: 10, dexterity: 24, luck: 8 },
];

interface RunResult {
  digests: string[];
  outcomeCode: number | null;
  battles: number;
}

/** Fährt das Gesamtsystem: Field läuft, Kämpfe werden automatisch gespielt. */
function runCoordinated(opts: { seed: number; battleSeed: number; delayBattleInput?: boolean; mode?: 'real' | 'stub' }): RunResult {
  const asm = new ScriptAssembler();
  asm.battle(0x009d).setByte(3, 0, 42).ret();
  const bundle = buildBundle({ script: scriptSection(asm) });
  const session = new FieldSession(bundle, { seed: opts.seed, dialogMode: 'auto' });
  const scene = fixtureBattleScene();
  const coordinator = new BattleModeCoordinator(
    fieldPort(session),
    () => new BattleSession(battleConfigFromScene(scene, 0, party, { seed: opts.battleSeed })),
    { battleMode: opts.mode ?? 'real' },
  );
  const digests: string[] = [];
  let outcomeCode: number | null = null;
  let battles = 0;
  let pendingBattleInput: BattleTickInput = NEUTRAL_BATTLE_INPUT;
  let delayed = 0;
  for (let t = 0; t < 3000; t++) {
    const r = coordinator.tick({ moveX: 0, moveY: 0, confirm: false, cancel: false }, pendingBattleInput);
    pendingBattleInput = NEUTRAL_BATTLE_INPUT;
    if (r.battleFinished) {
      outcomeCode = encodeOutcome(r.battleFinished);
      battles++;
    }
    if (coordinator.modeState.mode === 'battle') {
      const battle = coordinator.activeBattle!;
      const awaiting = battle
        .snapshot()
        .actors.filter((a) => a.ready);
      if (awaiting.length > 0) {
        // Gegenprobe „verschoben": das Kommando einen Takt später geben.
        if (opts.delayBattleInput && delayed < 1) {
          delayed++;
        } else {
          pendingBattleInput = { command: { actorId: awaiting[0]!.id, command: { kind: 'attack', targetId: 'enemy-0' } } };
        }
      }
    }
    digests.push(coordinator.digest());
    if (outcomeCode !== null && t > 200) break;
  }
  return { digests, outcomeCode, battles };
}

describe('Modus-Vertrag (ADR-026): Field friert ein, Battle läuft eigenständig', () => {
  it('E2E: Script → BATTLE → echter Kampf → battle-finished → Script läuft weiter', () => {
    const asm = new ScriptAssembler();
    asm.battle(0x009d).setByte(3, 0, 42).ret();
    const bundle = buildBundle({ script: scriptSection(asm) });
    const session = new FieldSession(bundle, { seed: 3, dialogMode: 'auto' });
    const scene = fixtureBattleScene();
    const coordinator = new BattleModeCoordinator(
      fieldPort(session),
      (encounterId) => {
        expect(encounterId).toBe(0x009d);
        return new BattleSession(battleConfigFromScene(scene, 0, party, { seed: 9 }));
      },
    );

    let finished = null;
    let rewards = null;
    for (let t = 0; t < 3000 && !finished; t++) {
      let input: BattleTickInput = NEUTRAL_BATTLE_INPUT;
      const battle = coordinator.activeBattle;
      if (battle) {
        const ready = battle.snapshot().actors.find((a) => a.ready);
        if (ready) input = { command: { actorId: ready.id, command: { kind: 'attack', targetId: 'enemy-0' } } };
      }
      const r = coordinator.tick({ moveX: 0, moveY: 0, confirm: false, cancel: false }, input);
      if (r.battleFinished) {
        finished = r.battleFinished;
        rewards = r.pendingRewards;
      }
    }
    expect(finished).toMatchObject({ kind: 'victory', exp: 12, ap: 1, gil: 7 });
    expect(rewards).toMatchObject({ exp: 12, ap: 1, gil: 7 });
    // Der wartende Script-Kontext ist aufgeweckt worden und hat weitergemacht.
    for (let t = 0; t < 10; t++) coordinator.tick({ moveX: 0, moveY: 0, confirm: false, cancel: false });
    expect(readBank(session.runtime!.state, 3, 0, false)).toBe(42);
  });

  it('Replay über die Modusgrenze ist bitidentisch; verschobene Eingabe ändert den Digest', () => {
    const a = runCoordinated({ seed: 7, battleSeed: 11 });
    const b = runCoordinated({ seed: 7, battleSeed: 11 });
    expect(a.outcomeCode).toBe(0);
    expect(a.digests).toEqual(b.digests);

    // Pflicht-Gegenprobe: dieselben Kommandos, eines um einen Takt verzögert.
    const c = runCoordinated({ seed: 7, battleSeed: 11, delayBattleInput: true });
    expect(c.digests).not.toEqual(a.digests);
  });

  it('Save→Load nach dem Kampf ist digestgleich (Modusgrenze überstanden)', () => {
    const asm = new ScriptAssembler();
    asm.battle(1).setByte(3, 1, 7).ret();
    const bundle = buildBundle({ script: scriptSection(asm) });
    const session = new FieldSession(bundle, { seed: 5, dialogMode: 'auto' });
    const scene = fixtureBattleScene();
    const coordinator = new BattleModeCoordinator(fieldPort(session), () =>
      new BattleSession(battleConfigFromScene(scene, 0, party, { seed: 2 })),
    );
    let done = false;
    for (let t = 0; t < 3000 && !done; t++) {
      let input: BattleTickInput = NEUTRAL_BATTLE_INPUT;
      const battle = coordinator.activeBattle;
      const ready = battle?.snapshot().actors.find((x) => x.ready);
      if (battle && ready) input = { command: { actorId: ready.id, command: { kind: 'attack', targetId: 'enemy-0' } } };
      done = coordinator.tick({ moveX: 0, moveY: 0, confirm: false, cancel: false }, input).battleFinished !== null;
    }
    expect(done).toBe(true);
    const snap = structuredClone(session.snapshot());
    const session2 = new FieldSession(bundle, { seed: 5, dialogMode: 'auto' });
    const restored = session2.restore(snap);
    expect(restored.ok).toBe(true);
    expect(session2.digest()).toBe(session.digest());
    // …und beide laufen identisch weiter.
    for (let t = 0; t < 60; t++) {
      session.tick();
      session2.tick();
      expect(session2.digest()).toBe(session.digest());
    }
  });

  it('ADR-011-Stub bleibt als Testmodus: sofortiger Rückweg, kein Kampf', () => {
    const r = runCoordinated({ seed: 7, battleSeed: 11, mode: 'stub' });
    expect(r.battles).toBe(0);
    // Das Script ist trotzdem weitergelaufen (der Stub meldet outcome 0).
  });
});

describe('Zufallskämpfe (S33): Ratenmodell + BTLON', () => {
  function encounterBundle(opts: { rate: number; btlonOff?: boolean }): FieldBundle {
    const asm = new ScriptAssembler();
    if (opts.btlonOff) asm.btlon(1);
    asm.ret();
    return buildBundle({
      script: scriptSection(asm),
      encounter: composeEncounterSection({
        tables: [
          {
            enabled: 1,
            rate: opts.rate,
            standard: [
              [32, 100],
              [8, 200],
            ],
          },
        ],
      }),
    });
  }

  const laufInput: FieldInput = { moveX: 1, moveY: 0, confirm: false, cancel: false };

  function countBattles(bundle: FieldBundle, ticks: number, seed = 1): { battles: number; ids: number[] } {
    const session = new FieldSession(bundle, { seed, dialogMode: 'auto', encounterStepsPerCheck: 8 });
    let battles = 0;
    const ids: number[] = [];
    for (let t = 0; t < ticks; t++) {
      // Hin- und herlaufen, damit die Figur nie am Rand festhängt.
      const dir = Math.floor(t / 50) % 2 === 0 ? 1 : -1;
      const r = session.tick({ ...laufInput, moveX: dir as 1 | -1 });
      for (const h of r.hostRequests) {
        if (h.kind === 'battle') {
          battles++;
          ids.push(h.encounterId);
        }
      }
    }
    return { battles, ids };
  }

  it('höhere Rate ⇒ messbar mehr Kämpfe; Rate 0 und BTLON-Aus ⇒ keine', () => {
    const viele = countBattles(encounterBundle({ rate: 192 }), 2000);
    const wenige = countBattles(encounterBundle({ rate: 16 }), 2000);
    const keine = countBattles(encounterBundle({ rate: 0 }), 2000);
    const btlonAus = countBattles(encounterBundle({ rate: 192, btlonOff: true }), 2000);
    expect(viele.battles).toBeGreaterThan(wenige.battles * 2);
    expect(wenige.battles).toBeGreaterThan(0);
    expect(keine.battles).toBe(0);
    expect(btlonAus.battles).toBe(0);
    // Alle IDs kommen maskiert aus der Tabelle (100/200) — die maskenlose
    // Auslegung läge bei 32868/8392 und damit außerhalb des 10-Bit-Raums.
    expect(new Set(viele.ids)).toEqual(new Set([100, 200]));
    // Gewichtung: battleId 100 (Gewicht 32) muss deutlich häufiger fallen.
    const n100 = viele.ids.filter((i) => i === 100).length;
    const n200 = viele.ids.filter((i) => i === 200).length;
    expect(n100).toBeGreaterThan(n200);
  });

  it('Snapshot/Restore mitten im Prüffenster erhält den Schrittzähler', () => {
    const bundle = encounterBundle({ rate: 128 });
    const s1 = new FieldSession(bundle, { seed: 4, dialogMode: 'auto', encounterStepsPerCheck: 16 });
    for (let t = 0; t < 11; t++) s1.tick(laufInput);
    const snap = structuredClone(s1.snapshot());
    expect(snap.encounterSteps).toBeGreaterThan(0);
    const s2 = new FieldSession(bundle, { seed: 4, dialogMode: 'auto', encounterStepsPerCheck: 16 });
    expect(s2.restore(snap).ok).toBe(true);
    for (let t = 0; t < 200; t++) {
      const dir = Math.floor(t / 50) % 2 === 0 ? 1 : -1;
      s1.tick({ ...laufInput, moveX: dir as 1 | -1 });
      s2.tick({ ...laufInput, moveX: dir as 1 | -1 });
      expect(s2.digest()).toBe(s1.digest());
    }
  });
});

describe('Ergebnisverbuchung (S33): EXP, Stufenaufstieg, Beute', () => {
  it('applyExperience: exakte Sollrechnung gegen die Growth-Kurven', () => {
    const growth = parseGrowthSection(
      composeGrowthSection({ expCurves: [{ charIndex: 0, gradients: [16, 16, 16, 16, 16, 16, 16, 16] }] }),
      'fixture',
      [],
    )!;
    // 🔵-Formel: expToNext(l) = floor(16·l²/16) = l² ⇒ Schwelle für Level 2 = 4, Level 3 = 4+9 = 13.
    expect(expTotalForLevel(growth, 0, 2)).toBe(4);
    expect(expTotalForLevel(growth, 0, 3)).toBe(13);
    const progress: CharacterProgress = { charIndex: 0, level: 1, exp: 0, maxHp: 100, maxMp: 20 };
    const r1 = applyExperience(progress, 5, growth);
    expect(progress.level).toBe(2);
    expect(r1.levelsGained).toBe(1);
    // HP-/MP-Zuwachs aus den belegten Gewinn-Tabellen (Abschnitt 0 ⇒ Index 0).
    expect(progress.maxHp).toBe(100 + 10);
    expect(progress.maxMp).toBe(20 + 5);
    const r2 = applyExperience(progress, 8, growth);
    expect(progress.level).toBe(3);
    expect(progress.exp).toBe(13);
    expect(r2.levelsGained).toBe(1);
  });

  it('Beutewurf ist deterministisch und Teil des Replays', () => {
    const scene = parseScene(
      composeScene({
        enemies: [{ id: 5, name: 'W', level: 3, hp: 1, exp: 12, gil: 7, ap: 1 }],
        formations: [{ slots: [{ enemyIndex: 0 }] }],
      }),
      0,
    );
    const cfg = battleConfigFromScene(scene, 0, party, { seed: 21 });
    // Drops von Hand ergänzen (der Fixture-Composer lässt itemRaw leer).
    cfg.enemies[0]!.drops = [
      { rate: 255, itemId: 17 },
      { rate: 0, itemId: 99 },
    ];
    const play = () => {
      const s = new BattleSession(cfg);
      for (let t = 0; t < 5000; t++) {
        const r = s.tick(
          s.snapshot().actors.some((a) => a.ready)
            ? { command: { actorId: 'held', command: { kind: 'attack', targetId: 'enemy-0' } } }
            : NEUTRAL_BATTLE_INPUT,
        );
        if (r.outcome) return r.outcome;
      }
      throw new Error('kein Ausgang');
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.kind).toBe('victory');
    if (a.kind === 'victory') {
      // Rate 255 fällt praktisch sicher, Rate 0 nie.
      expect(a.drops).toEqual([17]);
    }
  });
});
