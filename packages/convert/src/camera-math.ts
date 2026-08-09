import type { FieldCamera, Vec3 } from '@webmidgar/formats-field';
import { ff7DirToScene, ff7ToScene } from './ff7-to-scene.js';

/**
 * Kamerarekonstruktion (Masterplan Phase 3.2), rein numerisch, ohne Three.js.
 *
 * Quellmodell (PSX-/PC-Konvention der Field-Kamera, 🟡 Zu validieren):
 *   v_cam = R·v_world + t  mit R aus den drei Achszeilen (normalisiert /4096),
 *   Kameraraum: x rechts, y NACH UNTEN, z in Blickrichtung (in den Schirm).
 *   Projektion: sx = x·zoom/z, sy = y·zoom/z auf dem historischen Raster.
 *
 * Zielmodell (Three.js): Kamera blickt entlang −Z, +Y oben.
 * Basiswechsel: right = M·r₁, up = −M·r₂ (y-down → y-up), back = −M·r₃
 * (forward = −back). Kameraweltposition: C = −Rᵀ·t, dann M.
 */

/** Kalibrierparameter FOV-Basis (Masterplan R2): historisches Rasterhöhen-Maß. */
export type FovBase = 240 | 224;

/** 4:3 — fester Bildkreis der Originalkamera (ADR-005). */
export const FIELD_ASPECT = 4 / 3;

export interface ReconstructedFieldCamera {
  /** Kameraweltposition im Scene-Raum. */
  positionScene: Vec3;
  /** Orthonormale Kamerabasis im Scene-Raum (Three.js-Konvention). */
  right: Vec3;
  up: Vec3;
  back: Vec3;
  fovYRad: number;
  zoom: number;
  fovBase: FovBase;
}

export function fovYFromZoom(zoom: number, base: FovBase): number {
  if (zoom <= 0) throw new RangeError(`zoom muss > 0 sein, ist ${zoom}`);
  return 2 * Math.atan(base / 2 / zoom);
}

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

export function reconstructFieldCamera(
  cam: FieldCamera,
  opts: { fovBase: FovBase },
): ReconstructedFieldCamera {
  const R = cam.axes; // Zeilen r1..r3, bereits /4096 normalisiert (S2-NAM)
  const t = cam.positionRaw;
  // C_ff7 = −Rᵀ·t  (Spalten von R mit t skalarmultipliziert)
  const cFf7: Vec3 = [
    -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
    -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
    -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
  ];
  return {
    positionScene: ff7ToScene(cFf7),
    right: ff7DirToScene(R[0]),
    up: neg(ff7DirToScene(R[1])),
    back: neg(ff7DirToScene(R[2])),
    fovYRad: fovYFromZoom(cam.zoom, opts.fovBase),
    zoom: cam.zoom,
    fovBase: opts.fovBase,
  };
}

export interface ScreenProjection {
  /** Pixelkoordinaten im Zielraster (y nach unten). */
  x: number;
  y: number;
  /** Sichtdistanz entlang der Blickachse (Kamera-z, positiv vor der Kamera). */
  viewDistance: number;
  /** false, wenn der Punkt hinter der Kamera liegt. */
  inFront: boolean;
}

/**
 * Referenzprojektion nach Originalmodell (unabhängig von Three.js) — dient
 * den Konsistenztests: Three.js-Kamera und diese Funktion müssen für
 * identische Punkte identische Pixel liefern (Writer/Parser-Dualitätsprinzip).
 */
export function projectFf7PointToScreen(
  p: Vec3,
  cam: FieldCamera,
  opts: { width: number; height: number; fovBase: FovBase },
): ScreenProjection {
  const R = cam.axes;
  const t = cam.positionRaw;
  const vx = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0];
  const vy = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1];
  const vz = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2];
  const halfH = opts.fovBase / 2;
  // NDC über das FOV-Modell (y-down-Quelle → NDC y-up mit Minus).
  const ndcX = (vx * cam.zoom) / (vz * halfH * FIELD_ASPECT);
  const ndcY = -((vy * cam.zoom) / (vz * halfH));
  return {
    x: ((ndcX + 1) / 2) * opts.width,
    y: ((1 - ndcY) / 2) * opts.height,
    viewDistance: vz,
    inFront: vz > 0,
  };
}

/**
 * Sichtdistanz → NDC-Tiefe (OpenGL-Clipraum, z ∈ [−1, 1]) für die
 * Tile-Depth-Komposition (ADR-005). near/far müssen mit der Renderkamera
 * übereinstimmen — die Abbildung ist Teil der Kalibrierung.
 */
export function viewDistanceToNdcDepth(d: number, near: number, far: number): number {
  if (d <= 0) throw new RangeError(`Sichtdistanz muss > 0 sein, ist ${d}`);
  return (far + near) / (far - near) - (2 * far * near) / ((far - near) * d);
}
