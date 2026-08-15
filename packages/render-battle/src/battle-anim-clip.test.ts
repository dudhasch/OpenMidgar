import { describe, expect, it } from 'vitest';
import { ROTATION_ORDER_YXZ } from '@webmidgar/formats-model';
import type { BattleAnimation } from '@webmidgar/formats-battle';
import { battleAnimationToClip, PSX_ZU_GRAD } from './composition.js';

/**
 * K9 — Umrechnung Kampfanimation → Clip der Modellkette.
 *
 * Geprüft wird genau das, was das Original tut, und nichts darüber hinaus:
 * die Knochenzahl (Gelenke minus eins), der Versatz um eins zwischen Gelenk
 * und Knochen, die Winkelumrechnung 4096 → 360, die rohe Verschiebung und
 * die feste Rotationsreihenfolge YXZ.
 */

function anim(jointCount: number, frames: { t: [number, number, number]; r: number[] }[]): BattleAnimation {
  return {
    jointCount,
    frameCount: frames.length,
    shift: 0,
    kopfWort: frames.length,
    stromBytes: 1,
    packedSize: 8,
    leer: false,
    frames: frames.map((f) => ({ rootTranslation: f.t, rotations: Int32Array.from(f.r) })),
  };
}

describe('battleAnimationToClip', () => {
  it('nimmt Gelenk 0 als Wurzel und schiebt die Knochen um eins', () => {
    // 3 Gelenke = Wurzel + 2 Knochen. Werte so gewählt, dass jeder Platz
    // eindeutig wiedererkennbar ist.
    const a = anim(3, [{ t: [7, -8, 9], r: [1024, 2048, 3072, 100, 200, 300, 400, 500, 600] }]);
    const clip = battleAnimationToClip(a);

    expect(clip.boneCount).toBe(2);
    expect(clip.frames).toHaveLength(1);
    const f = clip.frames[0]!;
    // Wurzel = Gelenk 0, in Grad.
    expect(f.rootRotation).toEqual([90, 180, 270]);
    // Knochen 0 = Gelenk 1, Knochen 1 = Gelenk 2.
    expect([...f.rotations]).toEqual([100, 200, 300, 400, 500, 600].map((v) => v * PSX_ZU_GRAD));
    // Verschiebung roh — der Maßstab des Originals ist 1.0f.
    expect(f.rootTranslation).toEqual([7, -8, 9]);
  });

  it('kippt die Wurzel-Y nur auf Verlangen', () => {
    const a = anim(1, [{ t: [1, 2, 3], r: [0, 0, 0] }]);
    expect(battleAnimationToClip(a).frames[0]!.rootTranslation).toEqual([1, 2, 3]);
    expect(battleAnimationToClip(a, true).frames[0]!.rootTranslation).toEqual([1, -2, 3]);
  });

  it('trägt die Rotationsreihenfolge YXZ des Kampfladers', () => {
    const clip = battleAnimationToClip(anim(2, [{ t: [0, 0, 0], r: [0, 0, 0, 0, 0, 0] }]));
    expect(clip.rotationOrder).toEqual([...ROTATION_ORDER_YXZ]);
    expect(clip.schemaVersion).toBe(1);
  });

  it('verträgt den Wurzel-only-Satz ohne Knochen', () => {
    // jointCount 1 kommt im Bestand vor (35 Banken tragen solche Sätze).
    const clip = battleAnimationToClip(anim(1, [{ t: [0, 0, 0], r: [4095, 0, 2048] }]));
    expect(clip.boneCount).toBe(0);
    expect(clip.frames[0]!.rotations).toHaveLength(0);
    expect(clip.frames[0]!.rootRotation[0]).toBeCloseTo(4095 * PSX_ZU_GRAD, 6);
  });

  it('rechnet den vollen Kreis auf 360 Grad ab', () => {
    // 4096 Einheiten sind der Vollkreis: Der größte darstellbare Wert liegt
    // knapp darunter, nie darüber.
    expect(4096 * PSX_ZU_GRAD).toBe(360);
    const clip = battleAnimationToClip(anim(1, [{ t: [0, 0, 0], r: [0, 1024, 3072] }]));
    expect(clip.frames[0]!.rootRotation).toEqual([0, 90, 270]);
  });
});
