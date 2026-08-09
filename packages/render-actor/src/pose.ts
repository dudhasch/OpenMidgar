import type { AnimationFrame, Skeleton } from '@webmidgar/formats-model';

/**
 * Referenz-Posenmathematik — bewusst OHNE Three.js (Dualitätsprinzip wie bei
 * der S4-Kameraprojektion): Der Three-Szenegraph in actor.ts muss diese
 * Matrizen reproduzieren; Tests asserten numerisch gegen diese Implementierung.
 *
 * Konventionen (R4, Bone-Seite per Referenzabgleich ✅ entschieden —
 * docs/R4-MODELL-KONVENTIONEN.md, „Referenz-Entscheid B1–B4"):
 *  - Bindpose: Rotationen neutral; Kind-Ursprung liegt am Parent-Ende,
 *    versetzt um die Parent-Bone-Länge entlang der BONE-ACHSE.
 *  - BONE-ACHSE: lokales +Z → Versatz (0, 0, length). Längen sind im
 *    Bestand negativ — die Kette wächst nach −Z im Modellraum.
 *  - Eulerreihenfolge: R = Ry · Rx · Rz (entspricht Three-Order 'YXZ'),
 *    Winkel in Grad, Frame-Zuordnung in Bone-DATEIreihenfolge.
 *  - Wurzel: M = T(rootTranslation) · R(rootRotation).
 *  - Wurzelrahmen-Korrektur (R4-Fix, Vorgabe AN): Die `.a`-Wurzel steht in
 *    einem gedrehten Rahmen — Kujata setzt für Feldmodelle
 *    rootRotationDegreesX = 180. Weil unsere Szene zusätzlich die
 *    ADR-009-Basis C = Rx(−90°) trägt, gilt hier: fix = −90° auf der
 *    Wurzel-X-Komponente und t_m = rootFrameTranslationToModel(t). Herleitung
 *    und numerische Verifikation: `ROOT_FRAME_FIX_DEG`.
 */

export const EULER_ORDER = 'YXZ' as const;

/**
 * Fester Zusatzwinkel auf der Wurzel-X-Achse (Grad) — der **Wurzelrahmen-Fix**
 * für FELD-Modelle (R4, entschieden 2026-08-10, numerisch verifiziert).
 *
 * Herleitung (Details: docs/R4-MODELL-KONVENTIONEN.md):
 *  - Kujata (picklejar76) — nachweislich korrekte Pipeline — setzt für
 *    Feldmodelle `rootRotationDegreesX = 180` auf die Wurzelrotation, bei
 *    sonst identischer Bone-Mathematik (YXZ, Grad, Kindversatz [0,0,−|L|]).
 *    Kujata arbeitet direkt im Modellraum, ohne Achsen-Basiswechsel.
 *  - Unsere Szene hängt über dem Modell die ADR-009-Basis
 *    C = (x,y,z) → (x,z,−y) = Rx(−90°) als Wrapper.
 *  - Äquivalenzforderung `Szene == Kujata-Welt`:
 *    Rotation: C · Rx(fix) = Rx(180°)  ⇒  fix = C⁻¹·Rx(180°) = Rx(270°)
 *    ≡ **−90°**, Euler-additiv auf der Wurzel-X-Komponente (wie der bisherige
 *    Pitch-Mechanismus).
 *  - Verifiziert: Bei Wurzelrotation = 0 (98,7 % der echten Frames) ist die
 *    korrigierte Szene EXAKT identisch mit der Kujata-Referenzkette (max.
 *    Fehler 1e-15). Zuvor lag die Figur global um 90° verkippt — das erklärt
 *    alle drei Sichtsymptome der R4-Sichtprüfung (liegt/von unten, Glieder in
 *    falschen Ebenen, Seiten-/Draufsicht falsch).
 *  - Residuum: Nur bei Wurzelrotation mit **Y-Anteil ≠ 0** bleibt eine
 *    Abweichung, weil Kujatas +180 intern in der Euler-Komposition sitzt und
 *    nicht mit Ry kommutiert (X-/Z-Anteile sind exakt abgedeckt). Diese
 *    Frames sind im Bestand selten; Watch-Item in der R4-Notiz.
 *
 * Der frühere Ansatz `FIELD_ROOT_PITCH_DEG = 180` war wirkungslos: Er drehte
 * die Figur im bereits verkippten Rahmen nur um ihre eigene Achse, und die
 * BBox-Gütefunktion der Realdaten-Probe ist für 180°-Drehungen ohnehin blind.
 */
export const ROOT_FRAME_FIX_DEG = -90;

/**
 * Wurzeltranslation aus dem `.a`-Wurzelrahmen in den Modellraum:
 * t_m = C⁻¹ · t = (t.x, −t.z, t.y).
 *
 * Die rohe Wurzeltranslation steht im selben gedrehten Wurzelrahmen wie die
 * Wurzelrotation — unverändert übernommen versenkt sie die Figur um ihre
 * Höhenkomponente (Symptom „man sieht die Figur von unten").
 *
 * Bewusst LOKAL definiert, obwohl die Abbildung numerisch mit `sceneToFf7`
 * (ADR-009) übereinstimmt: Semantisch ist das KEINE FF7↔Szene-Konvertierung,
 * sondern die Umkehrung des Kujata-Wurzelrahmens innerhalb des Modellraums.
 */
export function rootFrameTranslationToModel(t: [number, number, number]): [number, number, number] {
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
 * `rootFrameFix` (Vorgabe **an**) wendet die Wurzelrahmen-Korrektur an
 * (`ROOT_FRAME_FIX_DEG` + `rootFrameTranslationToModel`) — das ist der
 * entschiedene R4-Vertrag und die numerisch verifizierte Kujata-Äquivalenz.
 * `false` liefert das rohe Verhalten ohne Korrektur und dient dem
 * Hypothesen-Sweep in der Realdaten-Probe sowie der Dualitätsprüfung beider
 * Modi gegen den Three-Szenegraph.
 */
export function computePose(
  skeleton: Skeleton,
  frame: AnimationFrame,
  rootFrameFix = true,
): BonePose[] {
  const rootR = frame.rootRotation;
  const rootT = rootFrameFix
    ? rootFrameTranslationToModel(frame.rootTranslation)
    : frame.rootTranslation;
  const rootMatrix = matMul(
    translation(rootT[0], rootT[1], rootT[2]),
    rotationEulerYxz(rootR[0] + (rootFrameFix ? ROOT_FRAME_FIX_DEG : 0), rootR[1], rootR[2]),
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
      offset = translation(0, 0, parent.length);
    }
    const matrix = matMul(parentMatrix, matMul(offset, local));
    poses.push({
      matrix,
      origin: transformPoint(matrix, [0, 0, 0]),
      tip: transformPoint(matrix, [0, 0, bone.length]),
    });
  }
  return poses;
}
