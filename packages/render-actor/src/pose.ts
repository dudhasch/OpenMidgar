import type { AnimationFrame, Skeleton } from '@webmidgar/formats-model';

/**
 * Referenz-Posenmathematik — bewusst OHNE Three.js (Dualitätsprinzip wie bei
 * der S4-Kameraprojektion): Der Three-Szenegraph in actor.ts muss diese
 * Matrizen reproduzieren; Tests asserten numerisch gegen diese Implementierung.
 *
 * Konventionen (R4, 🟡 `Zu validieren` per Referenzszene):
 *  - Bindpose: Rotationen neutral; Kind-Ursprung liegt am Parent-Ende,
 *    versetzt um die Parent-Bone-Länge entlang der BONE-ACHSE.
 *  - BONE-ACHSE: lokales +Z → Versatz (0, 0, length). Längen sind im
 *    Bestand negativ — die Kette wächst nach −Z im Modellraum.
 *  - Eulerreihenfolge: R = Ry · Rx · Rz (entspricht Three-Order 'YXZ'),
 *    Winkel in Grad, Frame-Zuordnung in Bone-DATEIreihenfolge.
 *  - Wurzel: M = T(rootTranslation) · R(rootRotation).
 */

export const EULER_ORDER = 'YXZ' as const;

/**
 * Fester Zusatzwinkel auf der Wurzel-X-Achse (Grad), nur für FELD-Modelle.
 *
 * 🟡 Herkunft: Kujata (picklejar76) führt für Feldmodelle
 * `rootRotationDegreesX = 180` bei sonst unveränderten Bone-Winkeln und
 * derselben Eulerreihenfolge 'YXZ'. Zwei Dinge stützen das:
 *
 *  - Die Sichtprüfung am echten Modell meldet „die Figur liegt, man sieht sie
 *    **von unten**" — eine 180°-Drehung ist genau diese Symptomatik.
 *  - Kujatas Quaternion-Herleitung entspricht Zeichen für Zeichen der
 *    Three-Semantik von 'YXZ' (R = Ry·Rx·Rz), also derselben Konvention wie
 *    `rotationEulerYxz` hier. Die Reihenfolge war nie das Problem.
 *
 * **Warum das (noch) nicht gemessen ist:** Die Realdaten-Probe bewertet über
 * die Ausdehnung der Mesh-Punktwolke — und eine 180°-Drehung lässt eine
 * Bounding-Box unverändert. Die Gütefunktion ist für diesen Fehler
 * konstruktionsbedingt blind; gemessen liefern Versatz 0 und 180 exakt
 * dieselben Werte. Der Wert ist deshalb ausdrücklich 🟡 und braucht eine
 * Sichtprüfung oder ein richtungsempfindliches Maß.
 */
export const FIELD_ROOT_PITCH_DEG = 180;

/**
 * ⚠️ **Nicht als Vorgabe gesetzt.** Der Wert stammt aus einer Pipeline, die
 * sich an ZWEI weiteren Stellen von unserer unterscheidet: Kujata versetzt das
 * Kind nach `−parentLength` (bei uns `+parentLength`) und kennt keinen
 * Achsen-Basiswechsel FF7→Szene, sondern arbeitet direkt im Modellraum. Die
 * drei Entscheidungen gehören zusammen; eine davon einzeln zu übernehmen ist
 * genau der Fehler, den dieses Projekt sonst vermeidet.
 *
 * Nachgemessen: Kujatas Versatzvorzeichen verschlechtert unsere Aufrechtigkeit
 * durchgehend — `offset+` belegt alle vorderen Plätze. Unsere Bindpose steht
 * ohne den Pitch bereits zu 95 % aufrecht.
 *
 * Der Pitch bleibt deshalb ein **Schalter** (`applyFrame(..., pitch)`), den
 * die Demoseite live umlegen kann. Erst wenn ein Auge oder ein
 * richtungsempfindliches Maß entschieden hat, wird daraus eine Vorgabe.
 */
export const DEFAULT_ROOT_PITCH_DEG = 0;

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
 * `rootPitchDeg` ist bewusst **0** als Vorgabe: Diese Funktion ist die reine
 * Referenzmathematik und soll keine Fassungs-Konvention tragen. Den
 * Feldversatz (`FIELD_ROOT_PITCH_DEG`) setzt der Aufrufer — im Renderpfad
 * genau einmal in `applyFrame`.
 */
export function computePose(
  skeleton: Skeleton,
  frame: AnimationFrame,
  rootPitchDeg = 0,
): BonePose[] {
  const rootR = frame.rootRotation;
  const rootMatrix = matMul(
    translation(frame.rootTranslation[0], frame.rootTranslation[1], frame.rootTranslation[2]),
    rotationEulerYxz(rootR[0] + rootPitchDeg, rootR[1], rootR[2]),
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
