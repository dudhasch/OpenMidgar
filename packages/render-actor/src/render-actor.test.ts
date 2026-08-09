import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { composeA, composeHrc, composeP } from '@webmidgar/fixture-gen';
import { parseA, parseHrc, parseP, type Skeleton } from '@webmidgar/formats-model';
import { bindClip } from './binding.js';
import { bindPoseFrame, computePose } from './pose.js';
import { applyFrame, boneModelMatrix, buildActor, buildFallbackActor } from './actor.js';

/**
 * S7-Akzeptanz: Fixture-Skelett + Fixture-Animation ergeben mathematisch
 * erwartete Gelenk-WELTposen — Assert auf Matrizen/Punkte, nicht Optik.
 * Referenzmathematik (pose.ts) und Three-Szenegraph (actor.ts) sind zwei
 * unabhängige Implementierungen und müssen übereinstimmen.
 */

function skeleton(): Skeleton {
  const { value } = parseHrc(
    composeHrc({
      skeletonName: 'kette',
      bones: [
        { name: 'hip', parent: 'root', length: 2 },
        { name: 'chest', parent: 'hip', length: 3 },
        { name: 'arm', parent: 'chest', length: 1 },
      ],
    }),
    'kette.hrc',
  );
  if (!value) throw new Error('Fixture-Skelett unparsbar');
  return value;
}

describe('Referenzposen (handgerechnet)', () => {
  it('Bindpose: Kette wächst entlang +Z um die Bone-Längen', () => {
    const sk = skeleton();
    const poses = computePose(sk, bindPoseFrame(sk));
    expect(poses[0]!.origin).toEqual([0, 0, 0]);
    expect(poses[0]!.tip).toEqual([0, 0, 2]);
    expect(poses[1]!.origin).toEqual([0, 0, 2]);
    expect(poses[1]!.tip).toEqual([0, 0, 5]);
    expect(poses[2]!.origin).toEqual([0, 0, 5]);
    expect(poses[2]!.tip).toEqual([0, 0, 6]);
  });

  it('Akzeptanzfall: 90°-Gelenkwinkel ergeben exakt erwartete Weltpositionen', () => {
    const sk = skeleton();
    // hip: Ry(90) — (0,0,L)→(L,0,0); chest: Rx(90) — (0,0,L)→(0,−L,0) im hip-System.
    const { value: clip } = parseA(
      composeA({
        frames: [
          {
            rootRotation: [0, 0, 0],
            rootTranslation: [10, 20, 30],
            boneRotations: [
              [0, 90, 0],
              [90, 0, 0],
              [0, 0, 0],
            ],
          },
        ],
      }),
      'pose.a',
    );
    const poses = computePose(sk, clip!.frames[0]!);

    const close = (actual: [number, number, number], expected: [number, number, number]): void => {
      expect(actual[0]).toBeCloseTo(expected[0], 5);
      expect(actual[1]).toBeCloseTo(expected[1], 5);
      expect(actual[2]).toBeCloseTo(expected[2], 5);
    };
    close(poses[0]!.origin, [10, 20, 30]);
    close(poses[0]!.tip, [12, 20, 30]); // Ry(90): +Z → +X
    close(poses[1]!.origin, [12, 20, 30]);
    close(poses[1]!.tip, [12, 17, 30]); // zusätzlich Rx(90): +Z → −Y
    close(poses[2]!.origin, [12, 17, 30]);
    close(poses[2]!.tip, [12, 16, 30]); // arm neutral: verlängert die −Y-Richtung
  });

  it('Wurzelrotation dreht die gesamte Kette', () => {
    const sk = skeleton();
    const frame = bindPoseFrame(sk);
    frame.rootRotation = [0, 90, 0];
    const poses = computePose(sk, frame);
    expect(poses[2]!.tip[0]).toBeCloseTo(6, 5); // +Z-Kette → +X
    expect(poses[2]!.tip[2]).toBeCloseTo(0, 5);
  });
});

describe('Dualität Referenzmathematik ↔ Three-Szenegraph', () => {
  it('boneModelMatrix reproduziert computePose für nichttriviale Winkel', () => {
    const sk = skeleton();
    const { value: clip } = parseA(
      composeA({
        frames: [
          {
            rootRotation: [10, -35, 70],
            rootTranslation: [-4, 8, 1.5],
            boneRotations: [
              [33, 12, -9],
              [-80, 45, 5],
              [17, -170, 66],
            ],
          },
        ],
      }),
      'wild.a',
    );
    const frame = clip!.frames[0]!;
    const poses = computePose(sk, frame);

    const actor = buildActor(sk, () => []);
    applyFrame(actor, sk, frame);
    for (let b = 0; b < sk.bones.length; b++) {
      const three = boneModelMatrix(actor, b); // column-major elements
      const ref = poses[b]!.matrix;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          expect(three.elements[c * 4 + r]).toBeCloseTo(ref[r]![c]!, 5);
        }
      }
    }
  });

  it('Scene-Wrapper: FF7-Höhenachse (+Z) landet auf Three-+Y', () => {
    const sk = skeleton();
    const actor = buildActor(sk, () => []);
    applyFrame(actor, sk, bindPoseFrame(sk));
    actor.root.updateMatrixWorld(true);
    // Kettenende (0,0,6)_ff7 muss in Scene-Koordinaten (0,6,0) liegen.
    const tip = actor.boneGroups[2]!.localToWorld(new THREE.Vector3(0, 0, 1));
    expect(tip.x).toBeCloseTo(0, 5);
    expect(tip.y).toBeCloseTo(6, 5);
    expect(tip.z).toBeCloseTo(0, 5);
  });
});

describe('Animationsbindung & Meshes', () => {
  it('bindClip: Clamp/Pad mit W-ANIM-BONES, exakte Bindung ohne Warnung', () => {
    const sk = skeleton();
    const mkClip = (bones: number): ReturnType<typeof parseA>['value'] =>
      parseA(
        composeA({
          frames: [
            {
              rootRotation: [0, 0, 0],
              rootTranslation: [0, 0, 0],
              boneRotations: Array.from({ length: bones }, () => [1, 2, 3] as [number, number, number]),
            },
          ],
        }),
        'clip.a',
      ).value;

    const exact = bindClip(sk, mkClip(3)!, 'clip.a');
    expect(exact.exact).toBe(true);
    expect(exact.warnings).toEqual([]);

    const padded = bindClip(sk, mkClip(2)!, 'clip.a');
    expect(padded.exact).toBe(false);
    expect(padded.warnings.map((w) => w.code)).toContain('W-ANIM-BONES');
    expect(padded.frames[0]!.rotations.length).toBe(9);
    expect(padded.frames[0]!.rotations[8]).toBe(0); // Pad

    const clamped = bindClip(sk, mkClip(5)!, 'clip.a');
    expect(clamped.frames[0]!.rotations.length).toBe(9); // Clamp
  });

  it('Actor trägt Bone-Meshes; Fallback-Kapsel existiert', () => {
    const sk = skeleton();
    const { value: mesh } = parseP(
      composeP({
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        normals: [[0, 0, 1]],
        groups: [{ vertexStart: 0, vertexCount: 3, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] }],
      }),
      'seg.p',
    );
    const actor = buildActor(sk, (bone) => (bone === 1 ? [{ mesh: mesh!, textures: [] }] : []));
    // chest trägt sein Segment-Mesh UND die Kind-Bone-Gruppe (arm).
    expect(actor.boneGroups[1]!.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1);
    expect(actor.boneGroups[0]!.children).toContain(actor.boneGroups[1]!);

    const fallback = buildFallbackActor();
    expect(fallback.model.children.length).toBe(1);
  });
});
