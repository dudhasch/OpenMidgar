/**
 * Byte-Winkel des Feldskripts ↔ unsere Gradzählung.
 *
 * Das Feld rechnet Richtungen als **Byte-Winkel**: 256 Schritte auf den
 * Vollkreis, und die Null zeigt nach **−Y** des Walkmesh.
 *
 * 🟡 **Herkunft** (ADR-028), aus dem Abbild gelesen:
 * `Field_StepEntityOnWalkmesh` (0x00636C41) bildet den Schritt als
 * `(+sin(h)·sx, −cos(h)·sy)` — das `NEG EAX` bei 0x00636FBE sitzt allein auf
 * dem Kosinus-/Y-Term. Die Sinustabelle bei 0x00908E30 ist stride-4
 * `{sin, cos}` (Eintrag 0 liest `(0, +4096)`, Eintrag 64 liest `(+4096, 0)`).
 * Daraus folgt die Rose:
 *
 * | Byte | Richtung |
 * |---|---|
 * | `0x00` | −Y |
 * | `0x40` | +X |
 * | `0x80` | +Y |
 * | `0xC0` | −X |
 *
 * **Unsere** Blickrichtung zählt dagegen in **Grad ab +X**, gegen den
 * Uhrzeigersinn (`richtungGrad` in field-runtime, `atan2(dy, dx)`). Zwischen
 * beiden liegen also ein Maßstab (360/256) und ein Ursprung (0x40 = 0°).
 *
 * Diese beiden Funktionen sind die einzige Stelle, an der umgerechnet werden
 * darf — dieselbe Regel wie für die Achsen in `@webmidgar/convert` (ADR-009).
 * Wer den Byte-Winkel irgendwo direkt als Grad ablegt, verdreht die Figur um
 * 90° und staucht den Kreis auf 256/360 seiner Größe.
 */

/** Schrittweite eines Byte-Winkels in Grad: 360/256 = 1,40625. */
export const BYTE_ANGLE_STEP_DEG = 360 / 256;

/** Byte-Winkel (0…255, 0 = −Y) → Grad ab +X, gegen den Uhrzeigersinn (0…360). */
export function byteAngleToDegrees(byteAngle: number): number {
  const b = ((Math.trunc(byteAngle) % 256) + 256) % 256;
  return (((b - 0x40) * BYTE_ANGLE_STEP_DEG) % 360 + 360) % 360;
}

/** Grad ab +X → Byte-Winkel (0…255, 0 = −Y). Umkehrung von {@link byteAngleToDegrees}. */
export function degreesToByteAngle(degrees: number): number {
  const raw = Math.round(degrees / BYTE_ANGLE_STEP_DEG) + 0x40;
  return ((raw % 256) + 256) % 256;
}
