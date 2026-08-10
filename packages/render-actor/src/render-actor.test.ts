import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { composeA, composeHrc, composeP, composeTex } from '@webmidgar/fixture-gen';
import { parseA, parseHrc, parseP, parseTex, type AnimationFrame, type Skeleton } from '@webmidgar/formats-model';
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
  it('Bindpose: Kette wächst entgegen der Bone-Achse um die Bone-Längen', () => {
    // R4, sichtgeprüft: Der Kindversatz läuft nach −length, nicht +length.
    // Das Fixture nutzt POSITIVE Längen (2/3/1), im Bestand sind sie negativ —
    // dort wächst die Kette dadurch nach +Z.
    const sk = skeleton();
    const poses = computePose(sk, bindPoseFrame(sk));
    expect(poses[0]!.origin).toEqual([0, 0, 0]);
    expect(poses[0]!.tip).toEqual([0, 0, -2]);
    expect(poses[1]!.origin).toEqual([0, 0, -2]);
    expect(poses[1]!.tip).toEqual([0, 0, -5]);
    expect(poses[2]!.origin).toEqual([0, 0, -5]);
    expect(poses[2]!.tip).toEqual([0, 0, -6]);
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
    // Handrechnung mit dem sichtgeprüften Versatz −length:
    close(poses[0]!.origin, [10, 20, 30]);
    close(poses[0]!.tip, [8, 20, 30]); // Ry(90): −Z → −X
    close(poses[1]!.origin, [8, 20, 30]);
    close(poses[1]!.tip, [8, 23, 30]); // zusätzlich Rx(90): −Z → +Y
    close(poses[2]!.origin, [8, 23, 30]);
    close(poses[2]!.tip, [8, 24, 30]); // arm neutral: verlängert die +Y-Richtung
  });

  it('Wurzelrotation dreht die gesamte Kette', () => {
    const sk = skeleton();
    const frame = bindPoseFrame(sk);
    frame.rootRotation = [0, 90, 0];
    const poses = computePose(sk, frame);
    expect(poses[2]!.tip[0]).toBeCloseTo(-6, 5); // −Z-Kette → −X unter Ry(90)
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
    // Ohne Feldversatz: Dieser Test belegt die Dualität der reinen
    // Referenzmathematik, nicht die Fassungs-Konvention.
    applyFrame(actor, sk, frame, false);
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

  it('Dualität gilt auch im KORRIGIERTEN Wurzelrahmen — dem Standardpfad', () => {
    // Der Renderpfad läuft per Vorgabe MIT der Wurzelrahmen-Korrektur. Ohne
    // diesen Test wäre ausgerechnet die Vorgabe ungeprüft und nur der
    // abgeschaltete Sonderfall abgesichert.
    //
    // Die Wurzeltranslation ist bewusst ungleich null und in allen drei
    // Komponenten verschieden: Wäre sie (0,0,0) oder symmetrisch, könnte der
    // Test die Umbauregel `t → (x, −z, y)` gar nicht von der Identität
    // unterscheiden und bliebe grün, auch wenn sie fehlte.
    const sk = skeleton();
    const frame: AnimationFrame = {
      rootRotation: [11, -23, 47],
      rootTranslation: [3, 5, -7],
      rotations: new Float32Array([12, -34, 56, 0, 0, 0, -8, 90, 3]),
    };
    const poses = computePose(sk, frame, true);
    const actor = buildActor(sk, () => []);
    applyFrame(actor, sk, frame, true);
    for (let b = 0; b < sk.bones.length; b++) {
      const three = boneModelMatrix(actor, b);
      const ref = poses[b]!.matrix;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          expect(three.elements[c * 4 + r]).toBeCloseTo(ref[r]![c]!, 5);
        }
      }
    }
  });

  it('Wurzelrahmen-Korrektur ist wirksam — Gegenprobe zum abgeschalteten Modus', () => {
    // Kontrolle zum Test darüber: Beide Modi müssen sich messbar
    // unterscheiden. Wären sie gleich, liefe die Dualität oben ins Leere und
    // die Korrektur wäre faktisch wirkungslos.
    const sk = skeleton();
    const frame: AnimationFrame = {
      rootRotation: [0, 0, 0],
      rootTranslation: [0, 4, 0],
      rotations: new Float32Array(sk.bones.length * 3),
    };
    const roh = computePose(sk, frame, false);
    const fix = computePose(sk, frame, true);
    // Translation: (0,4,0) → (0,−0,4) — die Höhe wandert von Y nach Z.
    expect(roh[0]!.origin[1]).toBeCloseTo(4, 5);
    expect(fix[0]!.origin[2]).toBeCloseTo(4, 5);
    expect(fix[0]!.origin[1]).toBeCloseTo(0, 5);
  });

  it('Scene-Wrapper: FF7-Höhenachse (+Z) landet auf Three-+Y', () => {
    const sk = skeleton();
    const actor = buildActor(sk, () => []);
    applyFrame(actor, sk, bindPoseFrame(sk), false);
    actor.root.updateMatrixWorld(true);

    // Die Basis selbst, unabhängig von der Kette: FF7-(0,0,1) → Scene-(0,1,0).
    const hoch = actor.root.localToWorld(new THREE.Vector3(0, 0, 1));
    expect(hoch.x).toBeCloseTo(0, 5);
    expect(hoch.y).toBeCloseTo(1, 5);
    expect(hoch.z).toBeCloseTo(0, 5);

    // Und durch die Kette: Bone 2 sitzt bei (0,0,−5)_ff7, ein Schritt entlang
    // seiner lokalen +Z-Achse landet bei (0,0,−4) → Scene (0,−4,0).
    const tip = actor.boneGroups[2]!.localToWorld(new THREE.Vector3(0, 0, 1));
    expect(tip.x).toBeCloseTo(0, 5);
    expect(tip.y).toBeCloseTo(-4, 5);
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

  it('texturierte Flächen bekommen Farbschlüssel und Aufkleber-Versatz', () => {
    const sk = skeleton();
    // Zwei Flächen: eine texturierte (Aufkleber) und eine vertexgefärbte
    // (Grundgeometrie) — nur die erste darf die Sonderbehandlung erhalten.
    const { value: mesh } = parseP(
      composeP({
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 0, 1],
          [0, 1, 1],
        ],
        normals: [[0, 0, 1]],
        texCoords: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        groups: [
          {
            vertexStart: 0,
            vertexCount: 3,
            polys: [{ v: [0, 1, 2], n: [0, 0, 0] }],
            textured: true,
            textureIndex: 0,
            texCoordStart: 0,
          },
          { vertexStart: 3, vertexCount: 3, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] },
        ],
      }),
      'decal.p',
    );
    // Paletteneintrag 0 durchsichtig, 1 undurchsichtig — die Bauform der
    // Aufkleber im Bestand (98 % durchsichtige Fläche um ein kleines Motiv).
    const { value: tex } = parseTex(
      composeTex({
        width: 2,
        height: 2,
        palettes: [[[0, 0, 0, 0], [200, 40, 40, 255]]],
        pixels: [0, 1, 0, 0],
      }),
      'decal.tex',
    );
    expect(tex).not.toBeNull();
    // Der Farbschlüssel im Kopf folgt dem Palettenalpha (695/695 im Bestand).
    expect(tex!.palettes[0]![3]).toBe(0);

    const actor = buildActor(sk, (bone) => (bone === 1 ? [{ mesh: mesh!, textures: [tex!] }] : []));
    const drei = actor.boneGroups[1]!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    const mats = drei.material as THREE.MeshBasicMaterial[];
    expect(mats).toHaveLength(2);

    // Texturiert: Farbschlüssel scharf, Tiefenvorzug aktiv.
    expect(mats[0]!.alphaTest).toBeGreaterThan(0);
    expect(mats[0]!.polygonOffset).toBe(true);
    expect(mats[0]!.polygonOffsetFactor).toBeLessThan(0); // zur Kamera hin
    expect(mats[0]!.map).not.toBeNull();

    // Vertexgefärbt: KEINE Sonderbehandlung. Ohne diese Gegenprobe wäre der
    // Test auch dann grün, wenn jedes Material den Versatz bekäme — und dann
    // hätte er über Aufkleber nichts ausgesagt.
    expect(mats[1]!.polygonOffset).toBe(false);
    expect(mats[1]!.alphaTest).toBe(0);
    expect(mats[1]!.vertexColors).toBe(true);
  });
});
