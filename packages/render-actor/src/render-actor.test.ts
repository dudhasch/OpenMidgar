import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { composeA, composeHrc, composeP, composeTex } from '@webmidgar/fixture-gen';
import { parseA, parseHrc, parseP, parseTex, type AnimationFrame, type Skeleton } from '@webmidgar/formats-model';
import { bindClip } from './binding.js';
import { bindPoseFrame, computePose } from './pose.js';
import {
  applyFrame,
  boneModelMatrix,
  buildActor,
  buildFallbackActor,
  buildLightSet,
  MODEL_FRONT_OFFSET_DEG,
  setActorFacing,
  type ActorLighting,
} from './actor.js';

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

  /**
   * F20-Abnahme: Die Blickrichtung darf die Scene-Basis nicht zerstören.
   * Der Fehler, den dieser Test fängt, war `root.rotation.y = …` — eine
   * Euler-Zuweisung ersetzt das Basis-Quaternion vollständig, die Figur landet
   * im rohen FF7-Modellraum und liegt flach.
   */
  it('Blickrichtung erhält die Hochachse (Figur bleibt aufrecht)', () => {
    const sk = skeleton();
    const oben = new THREE.Vector3(0, 0, 1); // FF7-Hochachse im Modellraum

    for (const grad of [0, 90, 180, 270, 45]) {
      const actor = buildActor(sk, () => []);
      setActorFacing(actor, grad);
      actor.root.updateMatrixWorld(true);

      // Die Modell-Hochachse muss IMMER auf Scene-oben zeigen, unabhängig vom
      // Gierwinkel — eine Drehung um die Hochachse kippt sie nicht.
      const hoch = oben.clone().applyQuaternion(actor.root.quaternion);
      expect(hoch.x).toBeCloseTo(0, 6);
      expect(hoch.y).toBeCloseTo(1, 6);
      expect(hoch.z).toBeCloseTo(0, 6);
    }
  });

  it('Blickrichtung dreht in der Bodenebene um Scene-y (inkl. Vorderseiten-Versatz)', () => {
    const sk = skeleton();
    const vorne = new THREE.Vector3(0, 1, 0); // FF7-Grundriss: +y
    const actor = buildActor(sk, () => []);
    const referenz = buildActor(sk, () => []);

    for (const grad of [0, 30, 90, 200]) {
      setActorFacing(actor, grad);
      // Referenzabbildung: Drehung um Scene-y um −(facing + Versatz),
      // angewandt auf die Basis. Der Versatz ist sichtkalibriert (Runde 3:
      // ohne ihn blickte „runter" nach rechts, „hoch" nach links).
      referenz.root.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeRotationY((-(grad + MODEL_FRONT_OFFSET_DEG) * Math.PI) / 180),
      );
      const a = vorne.clone().applyQuaternion(actor.root.quaternion);
      const b = vorne
        .clone()
        .applyMatrix4(new THREE.Matrix4().makeBasis(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, 1, 0),
        ))
        .applyQuaternion(referenz.root.quaternion);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.z).toBeCloseTo(b.z, 6);
    }
  });

  it('texturierte Flächen bekommen Farbschlüssel und Aufkleber-Versatz', () => {
    const sk = skeleton();
    // Drei Flächen: ein echter Aufkleber (texturiert UND flach, Klasse T),
    // texturierte KÖRPERgeometrie (texturiert, aber Gouraud — Klasse H) und
    // vertexgefärbte Grundgeometrie. Nur die erste darf den Tiefenvorzug
    // bekommen. Die mittlere ist der Fall, den die frühere Regel („jedes
    // texturierte Submesh") zu Unrecht traf; im Bestand sind das 8 Submeshes.
    const { value: mesh } = parseP(
      composeP({
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 0, 1],
          [0, 1, 1],
          [0, 0, 2],
          [1, 0, 2],
          [0, 1, 2],
        ],
        normals: [[0, 0, 1]],
        texCoords: [
          [0, 0],
          [1, 0],
          [0, 1],
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
            materialClass: 2, // T — flach, der Aufkleber
          },
          {
            vertexStart: 6,
            vertexCount: 3,
            polys: [{ v: [0, 1, 2], n: [0, 0, 0] }],
            textured: true,
            textureIndex: 0,
            texCoordStart: 3,
            materialClass: 4, // H — Gouraud, texturierte Körpergeometrie
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
    expect(mats).toHaveLength(3);

    // Aufkleber (texturiert + flach): Farbschlüssel scharf, Tiefenvorzug aktiv.
    expect(mats[0]!.alphaTest).toBeGreaterThan(0);
    expect(mats[0]!.polygonOffset).toBe(true);
    expect(mats[0]!.polygonOffsetFactor).toBeLessThan(0); // zur Kamera hin
    expect(mats[0]!.map).not.toBeNull();

    // Texturierte KÖRPERgeometrie (Gouraud): Textur und Farbschlüssel ja,
    // Tiefenvorzug NEIN. Das ist die Gegenprobe zur verschärften Regel — mit
    // der alten Fassung („jedes texturierte Submesh") wäre sie rot.
    expect(mats[1]!.map).not.toBeNull();
    expect(mats[1]!.alphaTest).toBeGreaterThan(0);
    expect(mats[1]!.polygonOffset).toBe(false);

    // Vertexgefärbt: KEINE Sonderbehandlung. Ohne diese Gegenprobe wäre der
    // Test auch dann grün, wenn jedes Material den Versatz bekäme — und dann
    // hätte er über Aufkleber nichts ausgesagt.
    expect(mats[2]!.polygonOffset).toBe(false);
    expect(mats[2]!.alphaTest).toBe(0);
    expect(mats[2]!.vertexColors).toBe(true);
  });
});

/**
 * Das Lichtwerk des Originals (🟡 ADR-027/A2, Dekompilat `ff7_en.exe`:
 * `Field_InstantiateModels` → `Gfx_CreateLightSet` → `FUN_0069C2E8`/`FUN_0069C25A`).
 * Geprüft wird die Matrix, nicht die Optik: `I = C·D·n + ambient`.
 */
describe('Feldlicht', () => {
  const licht = (
    lights: { color: [number, number, number]; direction: [number, number, number] }[],
    ambient: [number, number, number] = [0, 0, 0],
  ): ActorLighting => ({ lights, ambient });

  /** Intensitätstripel für eine Normale — dieselbe Rechnung wie im Shader. */
  function intensity(l: ActorLighting, n: [number, number, number]): [number, number, number] {
    const set = buildLightSet(l);
    const v = new THREE.Vector3(...n).applyMatrix3(set.colorDir).add(set.ambient);
    return [v.x, v.y, v.z];
  }

  it('negiert die Richtung, teilt durch 4096 und dreht in die Feldlichtbasis', () => {
    // Roh (0, 4096, 0) → negiert/skaliert (0, −1, 0) → Basis (x, z, −y) = (0, 0, 1).
    const l = licht([{ color: [255, 255, 255], direction: [0, 4096, 0] }]);
    // Normale entlang +z trifft das Licht voll.
    expect(intensity(l, [0, 0, 1])[0]).toBeCloseTo(1);
    // Die Gegenrichtung liefert −1 — es gibt KEIN max(0, n·l) je Licht.
    expect(intensity(l, [0, 0, -1])[0]).toBeCloseTo(-1);
    // Die beiden anderen Achsen bleiben unbeteiligt.
    expect(intensity(l, [1, 0, 0])[0]).toBeCloseTo(0);
    expect(intensity(l, [0, 1, 0])[0]).toBeCloseTo(0);
  });

  it('Gegenprobe zum Vorzeichen: ohne Negation zeigte das Licht auf die falsche Seite', () => {
    const l = licht([{ color: [255, 255, 255], direction: [0, 0, 4096] }]);
    // Roh (0,0,4096) → (0,0,−1) → Basis (x, z, −y) = (0, −1, 0).
    // Die beleuchtete Seite ist damit −y, nicht +y.
    expect(intensity(l, [0, -1, 0])[0]).toBeCloseTo(1);
    expect(intensity(l, [0, 1, 0])[0]).toBeCloseTo(-1);
  });

  it('Lichter summieren sich VORZEICHENBEHAFTET — gegenläufige heben sich auf', () => {
    const l = licht([
      { color: [255, 255, 255], direction: [0, 4096, 0] },
      { color: [255, 255, 255], direction: [0, -4096, 0] },
      { color: [0, 0, 0], direction: [0, 0, 0] },
    ]);
    expect(intensity(l, [0, 0, 1])[0]).toBeCloseTo(0);
    expect(intensity(l, [0, 0, -1])[0]).toBeCloseTo(0);
  });

  it('trennt die Farbkanäle: Zeile r der Matrix trägt nur Kanal r der Lichter', () => {
    const l = licht(
      [
        { color: [255, 0, 0], direction: [0, 4096, 0] }, // rein rot, Richtung +z
        { color: [0, 0, 255], direction: [0, 0, -4096] }, // rein blau, Richtung +y
        { color: [0, 0, 0], direction: [0, 0, 0] },
      ],
      [0, 0, 0],
    );
    const [r1, g1, b1] = intensity(l, [0, 0, 1]);
    expect(r1).toBeCloseTo(1);
    expect(g1).toBeCloseTo(0);
    expect(b1).toBeCloseTo(0);

    const [r2, g2, b2] = intensity(l, [0, 1, 0]);
    expect(r2).toBeCloseTo(0);
    expect(g2).toBeCloseTo(0);
    expect(b2).toBeCloseTo(1);
  });

  it('Umgebungsfarbe ist der additive Sockel, auf 0…1 skaliert', () => {
    const l = licht([{ color: [0, 0, 0], direction: [0, 0, 0] }], [128, 64, 32]);
    const [r, g, b] = intensity(l, [0, 0, 1]);
    expect(r).toBeCloseTo(128 / 255);
    expect(g).toBeCloseTo(64 / 255);
    expect(b).toBeCloseTo(32 / 255);
  });

  it('unnormierte Richtungen bleiben unnormiert — der Betrag ist Helligkeit', () => {
    const halb = licht([{ color: [255, 255, 255], direction: [0, 2048, 0] }]);
    expect(intensity(halb, [0, 0, 1])[0]).toBeCloseTo(0.5);
  });
});
