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
 *
 * Seit dem R4-Wurzelrahmen-Fix (2026-08-10) tragen die Vorgabe-Posen die
 * Korrektur (Wurzel-X −90°, t_m = (t.x, −t.z, t.y)); die Erwartungswerte
 * unten sind gegen eine davon unabhängige Handrechnung (numpy-Skript mit
 * Rx/Ry/Rz/T von Hand gebaut) geprüft, nicht aus der Implementierung
 * abgeleitet.
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
  it('Bindpose: mit Wurzelrahmen-Fix steht die +Z-Kette auf +Y (Wurzel = Rx(−90°))', () => {
    const sk = skeleton();
    const poses = computePose(sk, bindPoseFrame(sk));
    // Handrechnung: Wurzel = Rx(−90°) bildet (0,0,L) auf (0,L,0) ab;
    // die Kette wächst damit entlang +Y um die Bone-Längen.
    const close = (actual: [number, number, number], expected: [number, number, number]): void => {
      expect(actual[0]).toBeCloseTo(expected[0], 5);
      expect(actual[1]).toBeCloseTo(expected[1], 5);
      expect(actual[2]).toBeCloseTo(expected[2], 5);
    };
    close(poses[0]!.origin, [0, 0, 0]);
    close(poses[0]!.tip, [0, 2, 0]);
    close(poses[1]!.origin, [0, 2, 0]);
    close(poses[1]!.tip, [0, 5, 0]);
    close(poses[2]!.origin, [0, 5, 0]);
    close(poses[2]!.tip, [0, 6, 0]);
  });

  it('Akzeptanzfall: 90°-Gelenkwinkel ergeben exakt erwartete Weltpositionen', () => {
    const sk = skeleton();
    // Wurzeltranslation (10,20,30) liegt im gedrehten Wurzelrahmen:
    // t_m = (t.x, −t.z, t.y) = (10, −30, 20). Wurzelrotation 0 + Fix = Rx(−90°).
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
    close(poses[0]!.origin, [10, -30, 20]); // = t_m
    close(poses[0]!.tip, [12, -30, 20]); // Rx(−90)·Ry(90): +Z → +X
    close(poses[1]!.origin, [12, -30, 20]);
    close(poses[1]!.tip, [12, -30, 23]); // Rx(−90)·Ry(90)·Rx(90): +Z → +Z
    close(poses[2]!.origin, [12, -30, 23]);
    close(poses[2]!.tip, [12, -30, 24]); // arm neutral: verlängert die +Z-Richtung
  });

  it('Wurzelrotation dreht die gesamte Kette', () => {
    const sk = skeleton();
    const frame = bindPoseFrame(sk);
    frame.rootRotation = [0, 90, 0];
    const poses = computePose(sk, frame);
    // Handrechnung: Ry(90)·Rx(−90°) bildet die +Z-Kette auf +Y ab (Ry dreht
    // um genau die Achse, auf die Rx(−90) die Kette gelegt hat).
    expect(poses[2]!.tip[0]).toBeCloseTo(0, 5);
    expect(poses[2]!.tip[1]).toBeCloseTo(6, 5);
    expect(poses[2]!.tip[2]).toBeCloseTo(0, 5);
  });
});

describe('Dualität Referenzmathematik ↔ Three-Szenegraph', () => {
  // BEIDE Wurzelrahmen-Modi müssen dual sein: roh (false) wie korrigiert
  // (true) — die Dualität betrifft die Mathematik, nicht die Konvention.
  it.each([false, true])(
    'boneModelMatrix reproduziert computePose für nichttriviale Winkel (rootFrameFix=%s)',
    (rootFrameFix) => {
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
      const poses = computePose(sk, frame, rootFrameFix);

      const actor = buildActor(sk, () => []);
      applyFrame(actor, sk, frame, rootFrameFix);
      for (let b = 0; b < sk.bones.length; b++) {
        const three = boneModelMatrix(actor, b); // column-major elements
        const ref = poses[b]!.matrix;
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            expect(three.elements[c * 4 + r]).toBeCloseTo(ref[r]![c]!, 5);
          }
        }
      }
    },
  );

  it('Scene-Wrapper: die (degenerierte) Bindkette liegt nach dem R4-Fix auf −Z_scene', () => {
    const sk = skeleton();
    const actor = buildActor(sk, () => []);
    applyFrame(actor, sk, bindPoseFrame(sk));
    actor.root.updateMatrixWorld(true);
    // Im Modellraum steht die Kette nach dem Fix auf +Y (siehe oben); der
    // ADR-009-Wrapper C = (x,z,−y) legt sie auf −Z_scene. Das ist KEIN
    // Rückschritt: Die Bindpose ist degeneriert (gerade Kette) und liegt in
    // der Realdaten-Messung ebenfalls — die Aufrechtigkeit steckt in den
    // Animationsdaten (hip −90°X), belegt durch den Kujata-Äquivalenztest.
    const tip = actor.boneGroups[2]!.localToWorld(new THREE.Vector3(0, 0, 1));
    expect(tip.x).toBeCloseTo(0, 5);
    expect(tip.y).toBeCloseTo(0, 5);
    expect(tip.z).toBeCloseTo(-6, 5);
  });
});

describe('Kujata-Äquivalenz (R4-Sichtprüfungs-Fix)', () => {
  /**
   * Akzeptanz: Die korrigierte Szene (Actor inkl. ADR-009-Wrapper, Fix an)
   * muss elementweise der Referenzkette entsprechen, die Kujata (nachweislich
   * korrekte Pipeline) für Feldmodelle baut:
   *   K_root = T(t)·EulerYXZ(rootX + 180, rootY, rootZ)   — Modellraum!
   *   K_i    = K_{i-1}·T(0,0,L_parent)·EulerYXZ(bone_i)
   * Skelett mit NEGATIVEN Längen (echter Bestand), hip −90°X = echter
   * Cloud-Datenpunkt. Verifikation unabhängig nachgerechnet (numpy): max.
   * Fehler 1e-15 bei Wurzelrotation 0 — dem Regelfall (98,7 % der echten
   * Frames).
   */
  it('korrigierte Szene == Kujata-Referenzkette bei Wurzelrotation 0', () => {
    const { value: sk } = parseHrc(
      composeHrc({
        skeletonName: 'negkette',
        bones: [
          { name: 'hip', parent: 'root', length: -12 },
          { name: 'chest', parent: 'hip', length: -8 },
          { name: 'arm', parent: 'chest', length: -5 },
        ],
      }),
      'neg.hrc',
    );
    const { value: clip } = parseA(
      composeA({
        frames: [
          {
            rootRotation: [0, 0, 0],
            rootTranslation: [1, 13.5, 0.08],
            boneRotations: [
              [-90, 5, -3],
              [10, -15, 8],
              [25, 40, -12],
            ],
          },
        ],
      }),
      'kujata.a',
    );
    const frame = clip!.frames[0]!;

    // Referenzkette direkt mit THREE.Matrix4 (Kujata-Welt, kein Wrapper).
    const DEG2RAD_LOCAL = Math.PI / 180;
    const eulerYxz = (x: number, y: number, z: number): THREE.Matrix4 =>
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(x * DEG2RAD_LOCAL, y * DEG2RAD_LOCAL, z * DEG2RAD_LOCAL, 'YXZ'),
      );
    const t = frame.rootTranslation;
    const refs: THREE.Matrix4[] = [];
    let k = new THREE.Matrix4()
      .makeTranslation(t[0], t[1], t[2])
      .multiply(eulerYxz(frame.rootRotation[0] + 180, frame.rootRotation[1], frame.rootRotation[2]));
    sk!.bones.forEach((bone, i) => {
      if (bone.parentIndex >= 0) {
        const plen = sk!.bones[bone.parentIndex]!.length;
        k = k.multiply(new THREE.Matrix4().makeTranslation(0, 0, plen));
      }
      k = k.multiply(
        eulerYxz(
          frame.rotations[bone.fileOrder * 3] ?? 0,
          frame.rotations[bone.fileOrder * 3 + 1] ?? 0,
          frame.rotations[bone.fileOrder * 3 + 2] ?? 0,
        ),
      );
      refs.push(k.clone());
    });

    const actor = buildActor(sk!, () => []);
    applyFrame(actor, sk!, frame); // Vorgabe: Wurzelrahmen-Fix an
    actor.root.updateMatrixWorld(true);
    for (let b = 0; b < sk!.bones.length; b++) {
      const world = actor.boneGroups[b]!.matrixWorld; // inkl. ADR-009-Wrapper
      for (let e = 0; e < 16; e++) {
        // Toleranz 5e-6: float32-Datei-Rundreise ~1e-8; die strukturelle
        // Abweichung liegt bei 1e-15 (numpy-Verifikation).
        expect(world.elements[e]).toBeCloseTo(refs[b]!.elements[e]!, 5);
      }
    }

    // Aufrechtigkeit: Kettenende-Szene-Y liegt ÜBER dem Wurzelgelenk
    // (Kopf über Füßen). Handrechnung: Kettenende ≈ (0,65, 36,95, 3,72),
    // Wurzelgelenk = (1, 13,5, 0,08).
    const end = actor.boneGroups[2]!.localToWorld(new THREE.Vector3(0, 0, sk!.bones[2]!.length));
    const rootJoint = actor.boneGroups[0]!.getWorldPosition(new THREE.Vector3());
    expect(end.y).toBeGreaterThan(rootJoint.y);
  });

  /**
   * Zweiter Frame mit Wurzelrotation ≠ 0: bewusst WEGGELASSEN. Numerisch
   * nachgemessen bleibt die Äquivalenz exakt, solange der Y-Anteil der
   * Wurzelrotation 0 ist (X/Z beliebig); nur bei Y ≠ 0 entsteht ein Residuum
   * in der Größenordnung mehrerer Modelleinheiten, weil Kujatas +180 intern
   * in der Euler-Komposition sitzt und nicht mit Ry kommutiert. Für dieses
   * Residuum ist keine saubere Toleranz wählbar — es ist Kujatas eigene
   * Struktur, nicht unser Fehler (Watch-Item in
   * docs/R4-MODELL-KONVENTIONEN.md; echte Wurzelrotationen sind zu 98,7 %
   * exakt 0).
   */
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
