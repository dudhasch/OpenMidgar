import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import type { AnimationClipSource, AnimationFrame } from './nam.js';
import type { ParseResult } from './hrc.js';

/**
 * `.a`-Parser (Feld-Animation) — Framegröße realdaten-validiert
 * (3209/3209 Dateien): Header 36 B, Frame = 24 B Wurzel + 12 B je Bone.
 *
 * 🟢 Die **Rotationsreihenfolge steht im Kopf** (Versatz 12..14), nicht in der
 * Engine: drei Bytes, je 0 = alpha/X, 1 = beta/Y, 2 = gamma/Z. Belegt über
 * 3209/3209 Dateien — dort ist das Tripel **immer** eine Permutation von
 * {0,1,2}, während die beiden Kontrollversätze 13 und 16 in **exakt 0** Fällen
 * eine ergeben. Ein zufälliges Bytetripel bestünde diesen Test mit
 * Wahrscheinlichkeit 6 / 2^24.
 *
 * Gemessen kommt genau **eine** Reihenfolge vor: YXZ (3209/3209). Damit ist
 * die frühere Vermutung widerlegt, wechselnde Reihenfolgen könnten erklären,
 * warum animierte Frames kippen — sie wechseln nicht. Die Ursache lag
 * woanders und ist gefunden: das Vorzeichen des Kindversatzes (R4-B1).
 *
 * 🟢 **R4-B3 — Zuordnung der 24 Wurzel-Bytes: Rotation VOR Translation.**
 * Sichtgeprüft am 2026-08-10 (O4-Resttafel, `o4-sheet.rdtest.ts`): drei
 * Modelle, jeweils der Frame mit dem stärksten Wurzelsignal, heutige Lesung
 * gegen vertauschte Hälften. Urteil **3/3 richtig gegen 3/3 falsch**,
 * einstimmig.
 *
 * *Warum das nachgeholt wurde, obwohl hier schon 🟢 stand:* Die vorherige
 * Begründung lautete „durch zwei unabhängige Fremdimplementierungen
 * gestützt". Das ist nach Projektstandard **kein Beleg**, sondern eine
 * Hypothese — dieselbe Haltung, die bei O9 dreizehn Prozentpunkte gerettet
 * hat, als die pauschal übernommene Referenztabelle auf 86,77 % gedrückt
 * hätte. Jetzt steht ein eigener Nachweis dahinter.
 */

const HEADER_LEN = 36;
const ROOT_LEN = 24;
const BONE_LEN = 12;
/** Versatz der drei Reihenfolge-Bytes im Kopf. */
const ROT_ORDER_AT = 12;

/** Ist das Tripel eine Permutation von {0,1,2}? */
function istPermutation(a: number, b: number, c: number): boolean {
  if (a > 2 || b > 2 || c > 2) return false;
  return a !== b && b !== c && a !== c;
}

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

  const ro: [number, number, number] = [
    bytes[ROT_ORDER_AT]!,
    bytes[ROT_ORDER_AT + 1]!,
    bytes[ROT_ORDER_AT + 2]!,
  ];
  if (!istPermutation(ro[0], ro[1], ro[2])) {
    // Keine gültige Reihenfolge: Wir raten nicht, sondern melden und fallen
    // auf die einzige real belegte zurück.
    diagnostics.push(
      mdiag('W-ANIM-ROTORDER', asset, `Reihenfolge-Tripel (${ro.join(',')}) ist keine Permutation von {0,1,2}`),
    );
    ro[0] = 1;
    ro[1] = 0;
    ro[2] = 2;
  }

  return {
    value: { schemaVersion: 1, boneCount, frames, rotationOrder: ro, diagnostics },
    diagnostics,
  };
}
