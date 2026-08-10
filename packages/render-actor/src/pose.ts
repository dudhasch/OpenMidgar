import type { AnimationFrame, Skeleton } from '@webmidgar/formats-model';

/**
 * Referenz-Posenmathematik — bewusst OHNE Three.js (Dualitätsprinzip wie bei
 * der S4-Kameraprojektion): Der Three-Szenegraph in actor.ts muss diese
 * Matrizen reproduzieren; Tests asserten numerisch gegen diese Implementierung.
 *
 * Konventionen (R4, 🟡 `Zu validieren` per Referenzszene):
 *  - Bindpose: Rotationen neutral; Kind-Ursprung liegt am Parent-Ende,
 *    versetzt um die Parent-Bone-Länge entlang der BONE-ACHSE.
 *  - BONE-ACHSE: lokales +Z, Kindversatz (0, 0, **−**length). Die Längen sind
 *    im Bestand negativ, die Kette wächst also nach +Z im Modellraum.
 *    🟢 Sichtgeprüft (R4, 2026-08-10): In einer Tafel über 50 Renderketten
 *    trugen ausschließlich die als korrekt erkannten Zellen dieses Vorzeichen.
 *    Vier vorherige Messungen hatten es falsch entschieden, weil ihre
 *    Gütefunktionen die Richtung wegaggregierten.
 *  - Eulerreihenfolge: R = Ry · Rx · Rz (entspricht Three-Order 'YXZ'),
 *    Winkel in Grad, Frame-Zuordnung in Bone-DATEIreihenfolge.
 *  - Wurzel: M = T(rootTranslation) · R(rootRotation).
 */

export const EULER_ORDER = 'YXZ' as const;



/**
 * **Wurzelrahmen-Korrektur** (R4, 2026-08-10).
 *
 * Die Sichtprüfung am echten Modell entscheidet, was keine Bounding-Box
 * konnte: Ohne Zusatzwinkel sieht man die Figur **von unten** (Füße), mit 180°
 * **von oben** (Kopf). Beide Stellungen liegen 90° daneben — in
 * entgegengesetzte Richtungen. Der gesuchte Wert liegt also dazwischen.
 *
 * Dieselbe Zahl folgt unabhängig aus der Rechnung. Kujata setzt für
 * Feldmodelle `rootRotationDegreesX = 180` im **reinen Modellraum**. Unsere
 * Pipeline hängt stattdessen die ADR-009-Basis
 * `C: (x,y,z) → (x, z, −y)` über das Modell — und das ist genau `Rx(−90°)`:
 *
 * ```text
 * Rx(θ): (x, y, z) → (x, y·cosθ − z·sinθ, y·sinθ + z·cosθ)
 * θ = −90°:         → (x, z, −y)   ✓ also C = Rx(−90°)
 * ```
 *
 * Damit unsere Szene dieselbe Weltlage liefert wie Kujata, muss gelten
 * `C · Rx(fix) = Rx(180°)`, und weil Drehungen um dieselbe Achse additiv sind:
 *
 * ```text
 * Rx(−90° + fix) = Rx(180°)  ⇒  fix = 270° ≡ −90°
 * ```
 *
 * Zwei unabhängige Wege, dieselbe Antwort — das Auge und die Algebra.
 */
export const ROOT_FRAME_FIX_DEG = -90;

/**
 * Wurzeltranslation aus dem gedrehten `.a`-Rahmen in den Modellraum.
 *
 * Die rohe Translation steht im selben gedrehten Rahmen wie die
 * Wurzelrotation. Wird nur die Rotation korrigiert und die Translation roh
 * übernommen, wandert die Figur in die falsche Achse — das ist der zweite
 * Teil des Symptoms „von unten gesehen". Angewandt wird `C⁻¹ = Rx(+90°)`:
 *
 * ```text
 * Rx(+90°): (x, y, z) → (x, −z, y)
 * ```
 */
export function rootFrameTranslationToModel(
  t: readonly [number, number, number],
): [number, number, number] {
  return [t[0], -t[2], t[1]];
}

/** Spaltenvektor-Konvention, Speicherung zeilenweise (m[r][c]). */
export type Mat4 = number[][];

export const identity = (): Mat4 => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

export function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = identity();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r]![c] = a[r]![0]! * b[0]![c]! + a[r]![1]! * b[1]![c]! + a[r]![2]! * b[2]![c]! + a[r]![3]! * b[3]![c]!;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[0]![3] = x;
  m[1]![3] = y;
  m[2]![3] = z;
  return m;
}

const deg = Math.PI / 180;

export function rotationEulerYxz(xDeg: number, yDeg: number, zDeg: number): Mat4 {
  const cx = Math.cos(xDeg * deg), sx = Math.sin(xDeg * deg);
  const cy = Math.cos(yDeg * deg), sy = Math.sin(yDeg * deg);
  const cz = Math.cos(zDeg * deg), sz = Math.sin(zDeg * deg);
  const rx: Mat4 = [
    [1, 0, 0, 0],
    [0, cx, -sx, 0],
    [0, sx, cx, 0],
    [0, 0, 0, 1],
  ];
  const ry: Mat4 = [
    [cy, 0, sy, 0],
    [0, 1, 0, 0],
    [-sy, 0, cy, 0],
    [0, 0, 0, 1],
  ];
  const rz: Mat4 = [
    [cz, -sz, 0, 0],
    [sz, cz, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  return matMul(matMul(ry, rx), rz);
}

export function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    m[0]![0]! * p[0] + m[0]![1]! * p[1] + m[0]![2]! * p[2] + m[0]![3]!,
    m[1]![0]! * p[0] + m[1]![1]! * p[1] + m[1]![2]! * p[2] + m[1]![3]!,
    m[2]![0]! * p[0] + m[2]![1]! * p[1] + m[2]![2]! * p[2] + m[2]![3]!,
  ];
}

export interface BonePose {
  /** Welt-(Modellraum-)Matrix des Bone-Ursprungs (Gelenk). */
  matrix: Mat4;
  /** Gelenkursprung im Modellraum. */
  origin: [number, number, number];
  /** Bone-Ende (Ursprung + Länge entlang der Bone-Achse). */
  tip: [number, number, number];
}

/** Bindpose = Frame mit lauter Nullrotationen. */
export function bindPoseFrame(skeleton: Skeleton): AnimationFrame {
  return {
    rootRotation: [0, 0, 0],
    rootTranslation: [0, 0, 0],
    rotations: new Float32Array(skeleton.bones.length * 3),
  };
}

/**
 * Modellraum-Posen aller Bones für einen Frame. `rotations` wird in
 * Dateireihenfolge adressiert; fehlende Einträge gelten als 0 (Pad-Regel).
 *
 * `rootFrameFix` ist hier bewusst **false** als Vorgabe: Diese Funktion ist die reine
 * Referenzmathematik und soll keine Fassungs-Konvention tragen. Die Korrektur
 * setzt der Aufrufer — im Renderpfad genau einmal in `applyFrame`, wo sie
 * umgekehrt **Vorgabe** ist.
 */
export function computePose(
  skeleton: Skeleton,
  frame: AnimationFrame,
  rootFrameFix = false,
): BonePose[] {
  const rootR = frame.rootRotation;
  const t = rootFrameFix ? rootFrameTranslationToModel(frame.rootTranslation) : frame.rootTranslation;
  const pitch = rootFrameFix ? ROOT_FRAME_FIX_DEG : 0;
  const rootMatrix = matMul(
    translation(t[0], t[1], t[2]),
    rotationEulerYxz(rootR[0] + pitch, rootR[1], rootR[2]),
  );
  const poses: BonePose[] = [];
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    const rx = frame.rotations[bone.fileOrder * 3] ?? 0;
    const ry = frame.rotations[bone.fileOrder * 3 + 1] ?? 0;
    const rz = frame.rotations[bone.fileOrder * 3 + 2] ?? 0;
    const local = rotationEulerYxz(rx, ry, rz);
    let parentMatrix: Mat4;
    let offset: Mat4;
    if (bone.parentIndex < 0) {
      parentMatrix = rootMatrix;
      offset = identity();
    } else {
      const parent = skeleton.bones[bone.parentIndex]!;
      parentMatrix = poses[bone.parentIndex]!.matrix;
      // Kindversatz entgegen der Bone-Achse (R4, sichtgeprüft 2026-08-10).
      offset = translation(0, 0, -parent.length);
    }
    const matrix = matMul(parentMatrix, matMul(offset, local));
    poses.push({
      matrix,
      origin: transformPoint(matrix, [0, 0, 0]),
      tip: transformPoint(matrix, [0, 0, -bone.length]),
    });
  }
  return poses;
}
