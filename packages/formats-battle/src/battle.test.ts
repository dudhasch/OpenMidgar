import { describe, expect, it } from 'vitest';
import {
  composeBattleSkeleton,
  composeGrowthSection,
  composeScene,
  composeSceneBin,
  type SceneSpec,
} from '@webmidgar/fixture-gen';
import { parseBattleSkeleton } from './skeleton.js';
import { parseGrowthSection, parseKernelBattleData } from './kernel-battle.js';
import { parseScene, parseSceneBin } from './scene.js';
import { formationAddress, SCENE_DECOMPRESSED_LEN } from './types.js';

/**
 * Fixture-Tests formats-battle (S30). Composer (fixture-gen) und Parser sind
 * codegetrennte Zweitimplementierungen — der Roundtrip ist der Strukturtest.
 */

const beispielSzene: SceneSpec = {
  enemies: [
    { id: 7, name: 'WACHE', level: 5, hp: 120, mp: 10, exp: 22, gil: 8, ap: 2, attackSlots: [0, 1], aiScript: new Uint8Array([0x12, 0x60, 0x02, 0x73]) },
    { id: 19, name: 'HUND', level: 3, hp: 44, exp: 9, attackSlots: [1] },
  ],
  formations: [
    { slots: [{ enemyIndex: 0, x: 100, y: 0, z: -200, row: 1 }, { enemyIndex: 1, x: -300, z: 50 }], location: 4 },
    { slots: [{ enemyIndex: 1 }], location: 4, aiScript: new Uint8Array([0x99]) },
  ],
  attackIds: [260, 261],
  attackMpCosts: [0, 4],
};

describe('formats-battle: Szene', () => {
  it('Roundtrip composeScene → parseScene erhält alle typisierten Felder', () => {
    const bytes = composeScene(beispielSzene);
    expect(bytes.length).toBe(SCENE_DECOMPRESSED_LEN);
    const scene = parseScene(bytes, 0);

    expect(scene.enemyTypeIds).toEqual([7, 19, 0xffff]);
    expect(scene.enemies[0]!.level).toBe(5);
    expect(scene.enemies[0]!.hp).toBe(120);
    expect(scene.enemies[0]!.mp).toBe(10);
    expect(scene.enemies[0]!.ap).toBe(2);
    expect(scene.enemies[0]!.exp).toBe(22);
    expect(scene.enemies[0]!.gil).toBe(8);
    expect(scene.enemies[1]!.hp).toBe(44);
    expect(scene.enemies[2]).toBeNull();

    // Gegner 0 nutzt Attacken 260/261 (Tabellenplätze 0/1).
    expect(scene.enemies[0]!.attackIds[0]).toBe(260);
    expect(scene.enemies[0]!.attackIds[1]).toBe(261);
    expect(scene.enemies[0]!.attackIds[2]).toBe(0xffff);
    expect(scene.attacks[1]!.mpCost).toBe(4);

    const f0 = scene.formations[0]!;
    expect(f0.location).toBe(4);
    expect(f0.slots[0]).toMatchObject({ enemyTypeId: 7, x: 100, y: 0, z: -200, row: 1 });
    expect(f0.slots[1]).toMatchObject({ enemyTypeId: 19, x: -300, z: 50 });
    expect(f0.slots[2]!.enemyTypeId).toBe(0xffff);

    // KI-Spannen laufen bis zum nächsten belegten Offset bzw. Bereichsende
    // (das Format kennt keine Längenfelder) — der Skriptanfang ist byteexakt,
    // dahinter steht die 0xFF-Füllung des Bereichs.
    expect([...scene.enemyAiScripts[0]!.subarray(0, 4)]).toEqual([0x12, 0x60, 0x02, 0x73]);
    expect(scene.enemyAiScripts[0]!.subarray(4).every((b) => b === 0xff)).toBe(true);
    expect(scene.enemyAiScripts[1]).toBeNull();
    expect(scene.formations[1]!.aiScript[0]).toBe(0x99);
    expect(scene.formations[0]!.aiScript.length).toBe(0);
  });

  it('Roundtrip composeSceneBin → parseSceneBin über mehrere Blöcke; Kampf-ID-Adressierung', async () => {
    // 40 Szenen erzwingen mehrere Blöcke (variable Szenenzahl je Block).
    const scenes: SceneSpec[] = [];
    for (let i = 0; i < 40; i++) {
      scenes.push({
        enemies: [{ id: i, name: `G${i}`, level: 1 + (i % 99), hp: 10 + i }],
        formations: [{ slots: [{ enemyIndex: 0 }] }],
      });
    }
    const bin = await composeSceneBin(scenes);
    expect(bin.length % 0x2000).toBe(0);
    const container = await parseSceneBin(bin, 'fixture-scene.bin');
    expect(container.diagnostics).toEqual([]);
    expect(container.scenes.length).toBe(40);
    container.scenes.forEach((s, i) => {
      expect(s).not.toBeNull();
      expect(s!.enemyTypeIds[0]).toBe(i);
      expect(s!.enemies[0]!.hp).toBe(10 + i);
    });
    // Kampf-ID 0..1023 adressiert Szene >> 2, Formation & 3.
    expect(formationAddress(0)).toEqual({ sceneIndex: 0, formationIndex: 0 });
    expect(formationAddress(157)).toEqual({ sceneIndex: 39, formationIndex: 1 });
  });

  it('quarantänisiert eine defekte Szene, statt den Container zu verwerfen', async () => {
    const scenes: SceneSpec[] = [0, 1, 2].map((i) => ({
      enemies: [{ id: i }],
      formations: [{ slots: [{ enemyIndex: 0 }] }],
    }));
    const bin = await composeSceneBin(scenes, { corruptSceneIndex: 1 });
    const container = await parseSceneBin(bin, 'defekt.bin');
    expect(container.scenes[0]).not.toBeNull();
    expect(container.scenes[1]).toBeNull();
    expect(container.scenes[2]).not.toBeNull();
    expect(container.diagnostics.some((d) => d.code === 'E-BTL-SCENE' && d.index === 1)).toBe(true);
  });
});

describe('formats-battle: Battle-Skelett', () => {
  it('Roundtrip mit Vorwärtskette und Geometrieflags', () => {
    const bytes = composeBattleSkeleton([
      { parent: -1, length: 0, hasGeometry: false },
      { parent: 0, length: -12.5, hasGeometry: true },
      { parent: 1, length: -7.25, hasGeometry: true },
    ]);
    const { skeleton, diagnostics } = parseBattleSkeleton(bytes, 'aaaa');
    expect(diagnostics).toEqual([]);
    expect(skeleton!.boneCount).toBe(3);
    expect(skeleton!.bones[1]).toEqual({ parent: 0, length: -12.5, hasGeometry: true });
  });

  it('verwirft Skelette mit verletzter Vorwärtskette oder falschem Accounting', () => {
    const bytes = composeBattleSkeleton([{ parent: -1, length: 0, hasGeometry: false }]);
    // Accounting verletzen: 1 Byte anhängen.
    const langer = new Uint8Array(bytes.length + 1);
    langer.set(bytes);
    expect(parseBattleSkeleton(langer, 'x').skeleton).toBeNull();
    // Vorwärtskette verletzen: parent == eigener Index.
    const view = new DataView(bytes.buffer);
    view.setInt32(52, 0, true);
    const res = parseBattleSkeleton(bytes, 'x');
    expect(res.skeleton).toBeNull();
    expect(res.diagnostics[0]!.code).toBe('E-BTL-SKELETON');
  });
});

describe('formats-battle: kernel-Sektionen 0–2', () => {
  it('parst Growth-Sektion mit gebänderten Kurvenindizes und EXP-Kurven', () => {
    const bytes = composeGrowthSection({ expCurves: [{ charIndex: 0, gradients: [10, 20, 30, 40, 50, 60, 70, 80] }] });
    const diagnostics: never[] = [];
    const growth = parseGrowthSection(bytes, 'fixture', diagnostics)!;
    expect(growth.characters.length).toBe(9);
    expect(growth.characters[0]!.curveIndexes.hp).toBe(37);
    expect(growth.characters[0]!.curveIndexes.mp).toBe(46);
    expect(growth.characters[0]!.curveIndexes.exp).toBe(55);
    expect([...growth.curves[55]!.gradients]).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect([...growth.curves[55]!.bases]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(growth.tailRaw.length).toBe(2424);
  });

  it('parseKernelBattleData verlangt die belegten Recordgrößen', () => {
    const commands = new Uint8Array(32 * 8);
    const attacks = new Uint8Array(128 * 28);
    new DataView(attacks.buffer).setUint16(3 * 28 + 4, 12, true);
    const growth = composeGrowthSection();
    const ok = parseKernelBattleData([{ data: commands }, { data: attacks }, { data: growth }]);
    expect(ok.data).not.toBeNull();
    expect(ok.data!.attacks[3]!.mpCost).toBe(12);
    const falsch = parseKernelBattleData([{ data: new Uint8Array(31 * 8) }, { data: attacks }, { data: growth }]);
    expect(falsch.data).toBeNull();
    expect(falsch.diagnostics[0]!.code).toBe('E-BTL-KERNEL');
  });
});
