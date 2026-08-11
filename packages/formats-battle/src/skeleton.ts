import { bdiag, type BattleDiagnostic } from './diagnostics.js';
import { SKELETON_BONE_LEN, SKELETON_HEADER_LEN, type BattleBone, type BattleSkeleton } from './types.js';

/**
 * Battle-Skelett (`<präfix>aa` in battle.lgp) — S30.
 *
 * Grammatik ✅ realdaten-belegt über ALLE 481 Skelette: Länge = 52 + 12·n mit
 * n = u32@12; Bone-Record = i32 parent (Vorwärtskette 11026/11026) ·
 * f32 length · u32 flag ∈ {0,1}. Der Masterplan behielt recht: Das ist NICHT
 * die `.hrc`-Konvention aus char.lgp — aber die Geometrie dahinter ist das
 * bekannte `.p`-Format und die Texturen sind TEX (Suffix-Klassifikation der
 * Probe: alle Stichproben eindeutig).
 */

export interface ParseSkeletonResult {
  skeleton: BattleSkeleton | null;
  diagnostics: BattleDiagnostic[];
}

export function parseBattleSkeleton(bytes: Uint8Array, asset: string): ParseSkeletonResult {
  const diagnostics: BattleDiagnostic[] = [];
  if (bytes.length < SKELETON_HEADER_LEN) {
    diagnostics.push(bdiag('E-BTL-SKELETON', asset, `kürzer als Kopf (${bytes.length} B)`));
    return { skeleton: null, diagnostics };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boneCount = view.getUint32(12, true);
  if (SKELETON_HEADER_LEN + boneCount * SKELETON_BONE_LEN !== bytes.length) {
    diagnostics.push(
      bdiag('E-BTL-SKELETON', asset, `Accounting verletzt: ${bytes.length} B statt ${SKELETON_HEADER_LEN + boneCount * SKELETON_BONE_LEN} (bones=${boneCount})`),
    );
    return { skeleton: null, diagnostics };
  }
  const headerRaw = new Uint32Array(13);
  for (let i = 0; i < 13; i++) headerRaw[i] = view.getUint32(i * 4, true);
  const bones: BattleBone[] = [];
  for (let k = 0; k < boneCount; k++) {
    const off = SKELETON_HEADER_LEN + k * SKELETON_BONE_LEN;
    const parent = view.getInt32(off, true);
    if (parent < -1 || parent >= k) {
      // Vorwärtskette ist im Bestand ausnahmslos erfüllt — Verletzung = defekt.
      diagnostics.push(bdiag('E-BTL-SKELETON', asset, `Bone ${k}: Elternindex ${parent} verletzt Vorwärtskette`, k));
      return { skeleton: null, diagnostics };
    }
    bones.push({
      parent,
      length: view.getFloat32(off + 4, true),
      hasGeometry: view.getUint32(off + 8, true) === 1,
    });
  }
  return { skeleton: { boneCount, bones, headerRaw }, diagnostics };
}

/**
 * Modellpräfix eines Gegnertyps: Basis-26 über die Gegner-ID (✅ Schluss
 * 354/354 gegen den Szenenbestand; ⚠️ die id+1-Kontrolle ist im dichten
 * Namensraum blind — die Arithmetik stützt sich zusätzlich auf den
 * S32-Sichtnachweis).
 *
 * 🟡 **Offener Nebenbefund (K5-Sichtprüfung, 2026-08-11).** Beim Rendern
 * vollständiger Kämpfe fiel auf: **14 der 370 Gegnerpräfixe tragen weniger
 * als 20 Dreiecke**, und zehn davon liegen ZUSAMMENHÄNGEND am Bandanfang
 * (`aa`…`aj`, dazu `ap`, `bx`, `fi`, `iy`). Diese Präfixe rendern als eine
 * einzelne flache Fläche. Zwei Deutungen sind möglich und keine ist
 * gemessen: (a) es sind echte Platzhalter im Originalbestand, (b) die
 * Basis-26-Zuordnung hat am Bandanfang einen Versatz. Für die frühen Szenen
 * ist das sichtbar — Szene 0 und 1 liefern dadurch flache Gegner. Der
 * Befund gehört zur Gegnerzuordnung, nicht zur Party (K4) oder zur Bühne
 * (K5), und wird hier nur festgehalten, damit er nicht verloren geht.
 */
export function enemyModelPrefix(enemyTypeId: number): string {
  return String.fromCharCode(97 + Math.floor(enemyTypeId / 26)) + String.fromCharCode(97 + (enemyTypeId % 26));
}
