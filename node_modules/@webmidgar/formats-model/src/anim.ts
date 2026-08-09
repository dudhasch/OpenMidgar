import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import type { AnimationClipSource, AnimationFrame } from './nam.js';
import type { ParseResult } from './hrc.js';

/**
 * `.a`-Parser (Feld-Animation) — Framegröße realdaten-validiert
 * (3209/3209 Dateien): Header 36 B, Frame = 24 B Wurzel + 12 B je Bone.
 * 🟡 R4 offen: Zuordnung der 24 Wurzel-Bytes (Annahme: Rotation vor
 * Translation) sowie Winkelreihenfolge/-vorzeichen — beides an genau einer
 * Stelle in render-actor ausgewertet, per „Bekannte Pose"-Fixture geprüft.
 */

const HEADER_LEN = 36;
const ROOT_LEN = 24;
const BONE_LEN = 12;

export function parseA(bytes: Uint8Array, asset: string): ParseResult<AnimationClipSource> {
  const diagnostics: ModelDiagnostic[] = [];
  const fail = (message: string): ParseResult<AnimationClipSource> => {
    diagnostics.push(mdiag('E-ANIM-SIZE', asset, message));
    return { value: null, diagnostics };
  };
  if (bytes.length < HEADER_LEN) return fail(`Datei kürzer als Header (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint32(4, true);
  const boneCount = view.getUint32(8, true);
  const frameLen = ROOT_LEN + boneCount * BONE_LEN;
  const expected = HEADER_LEN + frameCount * frameLen;
  if (expected !== bytes.length) {
    return fail(`erwartet ${expected} B (${frameCount} Frames × ${frameLen} B), tatsächlich ${bytes.length}`);
  }

  const frames: AnimationFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const base = HEADER_LEN + f * frameLen;
    const rotations = new Float32Array(boneCount * 3);
    for (let i = 0; i < boneCount * 3; i++) {
      rotations[i] = view.getFloat32(base + ROOT_LEN + i * 4, true);
    }
    frames.push({
      rootRotation: [view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)],
      rootTranslation: [view.getFloat32(base + 12, true), view.getFloat32(base + 16, true), view.getFloat32(base + 20, true)],
      rotations,
    });
  }

  return {
    value: { schemaVersion: 1, boneCount, frames, diagnostics },
    diagnostics,
  };
}
