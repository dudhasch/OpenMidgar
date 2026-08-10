import { describe, expect, it } from 'vitest';
import { BattleAiAsm, composeAiScript, composeBattleSkeleton, composeScene } from '@webmidgar/fixture-gen';
import { parseBattleSkeleton, parseScene } from '@webmidgar/formats-battle';
import { BattleSession, NEUTRAL_BATTLE_INPUT, battleConfigFromScene, type BattleTickInput } from '@webmidgar/battle-runtime';
import {
  assignPartsToBones,
  battleSkeletonToSkeleton,
  battleToScene,
  parseCameraBlock,
  placeFormation,
  placeParty,
} from './composition.js';
import { BattleViewModel } from './view-model.js';

/**
 * S32-Tests. Das ERSTE Kriterium des Bogens: Die Präsentation ist
 * wirkungsfrei — der Kampfverlaufs-Digest ist mit und ohne Darstellungsschicht
 * identisch. Danach: Aufstellung reproduzierbar aus den Szenendaten,
 * Kompositions- und Kameraregeln als Fixture-Sollverläufe.
 */

function fixtureScene() {
  return parseScene(
    composeScene({
      enemies: [
        { id: 3, name: 'A', level: 4, hp: 60, exp: 5, attackSlots: [0], aiScript: composeAiScript({ 0: new BattleAiAsm().pushConst(300).attack().end().assemble() }) },
        { id: 8, name: 'B', level: 6, hp: 90, exp: 9, attackSlots: [0] },
      ],
      formations: [
        {
          slots: [
            { enemyIndex: 0, x: -500, y: 0, z: -1000, row: 0 },
            { enemyIndex: 1, x: 700, y: 0, z: -1400, row: 1 },
          ],
        },
      ],
      attackIds: [300],
    }),
    0,
  );
}

const party = [
  { id: 'held', level: 12, maxHp: 400, maxMp: 50, strength: 25, defense: 14, magic: 15, mdefense: 12, dexterity: 26, luck: 9 },
];

describe('Wirkungsfreiheit (erste Abnahme, nicht letzte)', () => {
  it('Digest des Kampfverlaufs ist mit und ohne ViewModel identisch', () => {
    const scene = fixtureScene();
    const mk = () => new BattleSession(battleConfigFromScene(scene, 0, party, { seed: 11 }));

    // Lauf A: nackte Session.
    const a = mk();
    const digestsA: string[] = [];
    let pendingA: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 600; t++) {
      const r = a.tick(pendingA);
      pendingA = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) pendingA = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      digestsA.push(a.digest());
      if (r.outcome) break;
    }

    // Lauf B: identisch, aber mit angeschlossener Darstellungsschicht.
    const b = mk();
    const vm = BattleViewModel.fromSession(b, [
      { id: 'held', maxHp: 400, maxMp: 50 },
      { id: 'enemy-0', maxHp: 60, maxMp: 0 },
      { id: 'enemy-1', maxHp: 90, maxMp: 0 },
    ]);
    const digestsB: string[] = [];
    let pendingB: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 600; t++) {
      const r = b.tick(pendingB);
      vm.applyTick(r);
      pendingB = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) pendingB = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      digestsB.push(b.digest());
      if (r.outcome) break;
    }

    expect(digestsB).toEqual(digestsA);
    // …und die Darstellung hat den Verlauf tatsächlich gesehen (kein leerer Test).
    expect(vm.view.effectCoverage.substituted).toBeGreaterThan(0);
    expect(vm.view.outcomeKind).not.toBeNull();
  });

  it('ViewModel spiegelt HP-Verlauf und meldet die Effektquote als Ersatz (0 % belegt)', () => {
    const scene = fixtureScene();
    const session = new BattleSession(battleConfigFromScene(scene, 0, party, { seed: 5 }));
    const vm = BattleViewModel.fromSession(session, [
      { id: 'held', maxHp: 400, maxMp: 50 },
      { id: 'enemy-0', maxHp: 60, maxMp: 0 },
      { id: 'enemy-1', maxHp: 90, maxMp: 0 },
    ]);
    let pending: BattleTickInput = NEUTRAL_BATTLE_INPUT;
    for (let t = 0; t < 2000; t++) {
      const r = session.tick(pending);
      vm.applyTick(r);
      pending = NEUTRAL_BATTLE_INPUT;
      if (r.awaitingInput.length > 0) pending = { command: { actorId: r.awaitingInput[0]!, command: { kind: 'attack', targetId: 'enemy-0' } } };
      if (r.outcome) break;
    }
    expect(vm.view.outcomeKind).toBe('victory');
    const enemy0 = vm.view.actors.find((a) => a.id === 'enemy-0')!;
    expect(enemy0.hp).toBe(0);
    expect(enemy0.alive).toBe(false);
    expect(vm.view.effectCoverage.covered).toBe(0);
    expect(vm.view.effectCoverage.substituted).toBeGreaterThan(0);
  });
});

describe('Aufstellung aus den Szenendaten', () => {
  it('battleToScene ist die Battle-Basis Rx(180°): y-ab → Y-oben, det +1, Boden bleibt 0', () => {
    // (x, y, z)_battle → (x, −y, −z)_scene
    expect(battleToScene([1, 2, 3])).toEqual([1, -2, -3]);
    // Bodenslot bleibt auf Bodenhöhe (−0 ≡ 0), Flieger (Battle-y < 0) landet ÜBER dem Boden.
    expect(battleToScene([100, 0, -1700])[1] === 0).toBe(true);
    expect(battleToScene([0, -300, 0])[1]).toBe(300);
    // Händigkeit: e1 × e2 = e3 bleibt erhalten (Rx(180°), kein Spiegel; +0 normalisiert).
    const e1 = battleToScene([1, 0, 0]);
    const e2 = battleToScene([0, 1, 0]);
    const e3 = battleToScene([0, 0, 1]);
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    expect(cross.map((v) => v + 0)).toEqual(e3.map((v) => v + 0));
  });

  it('placeFormation nutzt die Slot-Koordinaten über die zentrale Battle-Basis', () => {
    const scene = fixtureScene();
    const placed = placeFormation(scene.formations[0]!);
    expect(placed.length).toBe(2);
    // battleToScene: (x,y,z) → (x,−y,−z) — Bodenslots (y=0) stehen auf
    // Szene-Höhe 0, Gegner (Battle-z<0) auf der Szene-+z-Seite.
    expect(placed[0]!.scenePosition).toEqual([-500, -0, 1000]);
    expect(placed[1]!.scenePosition).toEqual([700, -0, 1400]);
    expect(placed[1]!.row).toBe(1);
    // Party-Ersatzpositionen (🔵): ebenfalls Bodenhöhe 0, gegenüber der
    // Gegner-Mehrheitsseite (Battle-z +3200 → Szene-z −3200).
    const partyPos = placeParty(2);
    expect(partyPos.length).toBe(2);
    expect(partyPos[0]![1]).toBe(-0);
    expect(partyPos[0]![2]).toBe(-3200);
    // Gegner und Party liegen auf GEGENÜBERLIEGENDEN Seiten der Tiefenachse.
    expect(Math.sign(placed[0]!.scenePosition[2])).not.toBe(Math.sign(partyPos[0]![2]));
  });
});

describe('Kompositionsregeln', () => {
  it('Skelettabbildung + Teilezuordnung: k-ter Flag-Bone ← k-tes Teil; Überzählige gemeldet', () => {
    const bs = parseBattleSkeleton(
      composeBattleSkeleton([
        { parent: -1, length: 0, hasGeometry: false },
        { parent: 0, length: -10, hasGeometry: true },
        { parent: 1, length: -8, hasGeometry: false },
        { parent: 2, length: -6, hasGeometry: true },
      ]),
      'test',
    ).skeleton!;
    const skeleton = battleSkeletonToSkeleton(bs, 'test');
    expect(skeleton.bones.length).toBe(4);
    expect(skeleton.bones[3]!.parentIndex).toBe(2);

    const exact = assignPartsToBones(bs, 2);
    expect(exact.boneToPart.get(1)).toBe(0);
    expect(exact.boneToPart.get(3)).toBe(1);
    expect(exact.unassignedParts).toEqual([]);

    // +1-Fall (125 Präfixe im Bestand): letztes Teil bleibt unzugeordnet.
    const plus = assignPartsToBones(bs, 3);
    expect(plus.unassignedParts).toEqual([2]);
  });

  it('Kamerablock: 3 Kameras à Position+Ziel, Füllwörter −1', () => {
    const raw = new Uint8Array(48);
    const view = new DataView(raw.buffer);
    const vals = [100, -900, 4000, 0, -300, 0];
    vals.forEach((v, i) => view.setInt16(i * 2, v, true));
    for (let k = 18; k < 24; k++) view.setInt16(k * 2, -1, true);
    const { cameras, padOk } = parseCameraBlock(raw);
    expect(padOk).toBe(true);
    expect(cameras[0]!.position).toEqual([100, -900, 4000]);
    expect(cameras[0]!.target).toEqual([0, -300, 0]);
  });
});
