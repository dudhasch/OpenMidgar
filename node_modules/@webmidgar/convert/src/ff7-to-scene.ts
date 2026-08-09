import type { Vec3 } from '@webmidgar/formats-field';

/**
 * DIE zentrale Koordinatenkonvertierung (ADR-009, Masterplan Phase 3.1).
 * Dies ist die EINZIGE Stelle im gesamten Projekt, an der Achsen getauscht
 * oder Vorzeichen geflippt werden — lokale Ad-hoc-Flips in Subsystemen sind
 * verboten.
 *
 * Quellsystem (FF7-Field, 🟡 Zu validieren gegen Realdaten-Referenzszene):
 *   rechtshändig, dritte Komponente = Höhe (z-up), Grundriss in x/y.
 * Zielsystem (Three.js): rechtshändig, +Y oben, Blickrichtung −Z.
 *
 * Abbildung M: (x, y, z)_ff7 → (x, z, −y)_scene.
 * det(M) = +1 — Händigkeit bleibt erhalten; M⁻¹ = (x, −z, y).
 */

export function ff7ToScene(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}

export function sceneToFf7(v: Vec3): Vec3 {
  return [v[0], -v[2], v[1]];
}

/** Richtungsvektoren nutzen dieselbe lineare Abbildung (keine Translation). */
export const ff7DirToScene = ff7ToScene;
export const sceneDirToFf7 = sceneToFf7;
