/**
 * Achsen-Quantisierung (S27).
 *
 * Float-Achswerte eines Gamepads sind geräte- und treiberabhängig und damit
 * replayfeindlich: Derselbe Stick liefert auf zwei Rechnern verschiedene
 * letzte Bits. Deshalb wird JEDER Analogwert beim Abtasten auf eine
 * dokumentierte ganzzahlige Stufung abgebildet; nur die Stufe erreicht den
 * Zustand und den Digest.
 *
 * Stufung und Deadzone sind 🔵 Eigenentwurf (die Roadmap stellt klar: das ist
 * kein Formatgegenstand des Originals):
 *  - `AXIS_STUFEN = 8` Stufen je Richtung → Wertebereich −8…+8.
 *  - `AXIS_DEADZONE = 0.25`: darunter gilt der Stick als neutral.
 *  - Oberhalb der Deadzone wird linear auf 1…8 skaliert; die kleinste
 *    Auslenkung jenseits der Deadzone ist immer mindestens Stufe 1 (sonst
 *    gäbe es ein zweites, verstecktes Totband).
 *
 * Determinismus: Es kommen nur IEEE-754-exakt festgelegte Operationen vor
 * (Addition, Multiplikation, Division, `Math.round`) — die Stufe ist über
 * Engines hinweg bitgleich (dieselbe Härtung wie `richtungGrad` in S20/R9).
 */

export const AXIS_STUFEN = 8;
export const AXIS_DEADZONE = 0.25;

/** Bildet einen Analogwert aus [−1, +1] auf die ganzzahlige Stufe −8…+8 ab. */
export function quantizeAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  const mag = Math.abs(clamped);
  if (mag <= AXIS_DEADZONE) return 0;
  const scaled = ((mag - AXIS_DEADZONE) / (1 - AXIS_DEADZONE)) * AXIS_STUFEN;
  const step = Math.max(1, Math.min(AXIS_STUFEN, Math.round(scaled)));
  return clamped < 0 ? -step : step;
}

/** Digitale Richtungen (Tasten, D-Pad, Touch-Kreuz) sind immer Vollausschlag. */
export function axisFromDigital(negative: boolean, positive: boolean): number {
  if (negative === positive) return 0;
  return positive ? AXIS_STUFEN : -AXIS_STUFEN;
}

/** Mittenwert einer Stufe in [−1, +1] — nur für Anzeigezwecke, nie für Zustand. */
export function dequantizeAxis(step: number): number {
  if (step === 0) return 0;
  const s = Math.max(-AXIS_STUFEN, Math.min(AXIS_STUFEN, Math.trunc(step)));
  const mag = AXIS_DEADZONE + (Math.abs(s) / AXIS_STUFEN) * (1 - AXIS_DEADZONE);
  return s < 0 ? -mag : mag;
}
