import { mdiag, type AnimationClipSource, type AnimationFrame, type ModelDiagnostic, type Skeleton } from '@webmidgar/formats-model';

/**
 * Animationsbindung (Masterplan 1.5, Zeile „Animation"): Kompatibilität wird
 * gegen das Skelett geprüft; Bone-Mismatch wird per Clamp/Pad toleriert
 * (Original toleriert Abweichungen, 🟡) und gewarnt — nie still.
 */

export interface BoundClip {
  frames: AnimationFrame[];
  warnings: ModelDiagnostic[];
  /** true = Bone-Zahl passte exakt (topologiegleiche Nutzung). */
  exact: boolean;
}

export function bindClip(skeleton: Skeleton, clip: AnimationClipSource, asset: string): BoundClip {
  const warnings: ModelDiagnostic[] = [];
  const nBones = skeleton.bones.length;
  const exact = clip.boneCount === nBones;
  if (!exact) {
    warnings.push(
      mdiag('W-ANIM-BONES', asset, `Clip hat ${clip.boneCount} Bones, Skelett ${nBones} — ${clip.boneCount > nBones ? 'Clamp' : 'Pad mit 0'}`),
    );
  }
  const frames = exact
    ? clip.frames
    : clip.frames.map((f): AnimationFrame => {
        const rotations = new Float32Array(nBones * 3);
        rotations.set(f.rotations.subarray(0, Math.min(f.rotations.length, nBones * 3)));
        return { rootRotation: f.rootRotation, rootTranslation: f.rootTranslation, rotations };
      });
  return { frames, warnings, exact };
}
