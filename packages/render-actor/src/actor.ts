import * as THREE from 'three';
import { ff7DirToScene } from '@webmidgar/convert';
import { texToRgba, type AnimationFrame, type MeshSource, type Skeleton, type TextureSource } from '@webmidgar/formats-model';
import { EULER_ORDER, ROOT_FRAME_FIX_DEG, rootFrameTranslationToModel } from './pose.js';

/**
 * GPU-Adapter der Modellkette: Skeleton → Three-Bone-Hierarchie mit starren
 * Segment-Meshes (FF7-Field-Modelle sind rigid-segmentiert, kein Skinning).
 *
 * Aufbau: `root` (Scene-Space-Wrapper — trägt als EINZIGE Stelle die zentrale
 * FF7→Scene-Basis aus packages/convert, ADR-009) → `model` (FF7-Modellraum,
 * erhält Wurzeltranslation/-rotation je Frame) → Bone-Gruppen (Kindversatz
 * (0,0,parentLength), Eulerorder 'YXZ' — Referenzmathematik in pose.ts).
 */

export interface ActorMeshBundle {
  mesh: MeshSource;
  /** Je RSD-Texturslot eine Textur oder null (→ Platzhalter). */
  textures: (TextureSource | null)[];
}

export interface Actor {
  root: THREE.Group;
  model: THREE.Group;
  boneGroups: THREE.Group[];
}

/** Wrapper-Rotation aus der zentralen Konvertierung (keine lokalen Flips). */
export function sceneBasisMatrix(): THREE.Matrix4 {
  const x = ff7DirToScene([1, 0, 0]);
  const y = ff7DirToScene([0, 1, 0]);
  const z = ff7DirToScene([0, 0, 1]);
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x),
    new THREE.Vector3(...y),
    new THREE.Vector3(...z),
  );
}

/** Hochachse im FF7-Modellraum (dritte Komponente, s. convert/ff7-to-scene). */
const FF7_UP = new THREE.Vector3(0, 0, 1);
/** Wiederverwendet — `setActorFacing` läuft je Figur und Takt, darf nicht allozieren. */
const yawScratch = new THREE.Quaternion();

/**
 * Blickrichtung einer Figur setzen, OHNE die Scene-Basis zu verlieren.
 *
 * `root.quaternion` trägt die zentrale FF7→Scene-Basis (s. buildActor,
 * ADR-009). Wer stattdessen `root.rotation.y` schreibt, ersetzt das Quaternion
 * vollständig und löscht die Basis — die Figur steht dann im rohen
 * FF7-Modellraum, also flach auf dem Boden, und der Gierwinkel dreht den
 * liegenden Körper in der Bodenebene (F20, 2026-08-10: betraf jede
 * Field-Aufnahme der Demo).
 *
 * Deshalb wird der Gierwinkel um die FF7-Hochachse **auf** die Basis
 * multipliziert: `root.quaternion = Basis ∘ R_z(−facing)`. Das Vorzeichen ist
 * dasselbe wie zuvor in der Demo — die Basis bildet FF7-z auf Scene-y ab, eine
 * Drehung um FF7-z ist also dieselbe Drehung wie zuvor um Scene-y.
 */
/**
 * 🟡 Modell-Vorderseiten-Versatz: Die Feldmodelle schauen im Modellraum nicht
 * entlang der Achse, die die erste Fassung annahm — Sichtbefund (Runde 3):
 * „runter" blickte nach rechts, „hoch" nach links, konsistent 90° verdreht.
 * Der Wert wird per Sichtsweep gegen Original-Screenshots kalibriert.
 */
export let MODEL_FRONT_OFFSET_DEG = -90;

/** Nur für die Sichtkalibrierung der Demo — kein Spielzustand. */
export function setModelFrontOffset(deg: number): void {
  MODEL_FRONT_OFFSET_DEG = deg;
}

export function setActorFacing(actor: Actor, degrees: number): void {
  actor.root.quaternion
    .setFromRotationMatrix(sceneBasisMatrix())
    .multiply(yawScratch.setFromAxisAngle(FF7_UP, (-(degrees + MODEL_FRONT_OFFSET_DEG) * Math.PI) / 180));
}

const PLACEHOLDER_COLOR = 0xff00ff; // Magenta-Platzhalter (Debug-Konvention)

/**
 * Schwelle des Farbschlüssels. 🟢 **Realdatenbeleg** (`tex-alpha-probe`): Der
 * Bestand kennt praktisch nur die Alphawerte 255 (28209 Einträge), 0 (2213)
 * und 254 (858) — es gibt keine Halbtransparenz, die eine feinere Schwelle
 * verlangte. Ein harter Schnitt in der Mitte ist deshalb kein Kompromiss,
 * sondern die exakte Semantik.
 *
 * `alphaTest` statt `transparent: true`: Verworfene Fragmente schreiben auch
 * die Tiefe nicht. Genau darauf kommt es an — sonst verdeckte die unsichtbare
 * Fläche des Aufklebers das Gesicht ebenso zuverlässig wie die sichtbare, und
 * man hätte statt eines schwarzen Rechtecks ein Loch.
 */
const ALPHA_TEST = 0.5;

/**
 * Tiefenvorzug für texturierte Flächen (Aufkleber-Versatz).
 *
 * 🟡 **Renderentscheidung, kein Formatfakt.** FF7 legt Augen und Mund als
 * Aufkleber EXAKT auf die Gesichtsfläche. Ohne Vorzug entscheidet der
 * Rundungsfehler je Pixel, wer gewinnt; sichtbar wurde das als Streifenmuster
 * über den Augen (Sichtprüfung 2026-08-10).
 *
 * Dass ausgerechnet die texturierten Flächen die Aufkleber sind, ist gemessen
 * und nicht geraten: Von 4710 Submeshes des Bestands sind nur **626**
 * texturiert (13,3 %), und 187 Ressourcen tragen genau drei Texturen — Gesicht
 * plus zwei Augen. Die Grundgeometrie ist vertexgefärbt.
 *
 * **Wirkung und Richtung sind belegt** (2026-08-10, O4-Resttafel): Die Regel
 * wurde 2/2 als richtig beurteilt, die **umgekehrte Kontrollregel** (Vorzug
 * für die untexturierten Flächen) 2/2 als falsch, und „gar kein Vorzug"
 * ebenfalls 2/2 als falsch. Damit ist ausgeschlossen, dass die Regel
 * wirkungslos ist oder in die falsche Richtung zeigt — genau das hätte die
 * Kontrollzelle aufgedeckt.
 *
 * Bleibt trotzdem 🟡, weil die Regel eine Bauform ausnutzt und keine Angabe
 * der Datei ist: Ein texturiertes Submesh, das KEIN Aufkleber ist, bekäme den
 * Vorzug ebenfalls. Bei einem Versatz dieser Größe ist das folgenlos, aber es
 * ist eine Annahme und wird als solche geführt.
 */
const DECAL_OFFSET_FACTOR = -1;
const DECAL_OFFSET_UNITS = -1;

function buildTexture(tex: TextureSource): THREE.DataTexture {
  const texture = new THREE.DataTexture(texToRgba(tex), tex.width, tex.height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter; // authentischer Look, keine Palettensäume
  texture.minFilter = THREE.NearestFilter;
  // F41: Gespiegelte Aufkleber (das zweite Auge nutzt UVs außerhalb von
  // [0,1]) brauchen Wiederholung — mit Clamp-to-Edge (three-Vorgabe)
  // verschmierte der Randtexel das Decal zu einer leeren Fläche.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Feldlicht je Modell (F42) — Sektion-3-Block: drei gerichtete Lichter
 * (RGB + i16-Richtungsvektor, 4096er-Festkomma) plus Umgebungsfarbe.
 */
export interface ActorLighting {
  lights: { color: [number, number, number]; direction: [number, number, number] }[];
  ambient: [number, number, number];
}

/**
 * Beleuchtung in die Vertexfarben einbacken (F42).
 *
 * 🟡 **Lambert-Hypothese**: `farbe · clamp(ambient + Σ max(0, n·l̂ᵢ)·cᵢ)` im
 * Modellraum. Makou Reactor rendert die drei Richtungslichter selbst nicht —
 * es editiert sie nur; die Anwendung ist also Sichtsache. Ohne jede
 * Beleuchtung wirkten unsere Modelle gegenüber dem Original flach und blass
 * (Nutzerbefund „viel satter", Runde 3).
 */
function bakeLighting(mesh: MeshSource, licht: ActorLighting): Uint8Array {
  const out = new Uint8Array(mesh.colors); // Kopie — die Quelle ist geteilt
  const dirs = licht.lights.map((l) => {
    const [x, y, z] = l.direction;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len, c: l.color };
  });
  const vertexCount = mesh.positions.length / 3;
  for (let v = 0; v < vertexCount; v++) {
    const nx = mesh.normals[v * 3]!;
    const ny = mesh.normals[v * 3 + 1]!;
    const nz = mesh.normals[v * 3 + 2]!;
    let r = licht.ambient[0] / 255;
    let g = licht.ambient[1] / 255;
    let b = licht.ambient[2] / 255;
    for (const d of dirs) {
      const beitrag = Math.max(0, nx * d.x + ny * d.y + nz * d.z);
      r += (beitrag * d.c[0]) / 255;
      g += (beitrag * d.c[1]) / 255;
      b += (beitrag * d.c[2]) / 255;
    }
    const o = v * 4;
    out[o] = Math.min(255, out[o]! * Math.min(1.25, r));
    out[o + 1] = Math.min(255, out[o + 1]! * Math.min(1.25, g));
    out[o + 2] = Math.min(255, out[o + 2]! * Math.min(1.25, b));
  }
  return out;
}

/**
 * Ein `.p`-Mesh als Three-Objekt — Submesh-Gruppen, Texturen, Vertexfarben,
 * Aufkleber-Versatz. Exportiert, weil die Kampfbühne (render-battle) DIESELBE
 * Geometrie- und Texturkette benutzt, aber kein Skelett hat: sie braucht den
 * Mesh-Bau ohne den Bone-Baum drumherum. Zwei Implementierungen desselben
 * Materialaufbaus würden sonst unbemerkt auseinanderlaufen.
 */
export function buildMeshObject(bundle: ActorMeshBundle, licht?: ActorLighting): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(bundle.mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(bundle.mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(bundle.mesh.uvs, 2));
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(licht ? bakeLighting(bundle.mesh, licht) : bundle.mesh.colors, 4, true),
  );
  geometry.setIndex(new THREE.BufferAttribute(bundle.mesh.indices, 1));

  const materials: THREE.Material[] = [];
  bundle.mesh.submeshes.forEach((sub, s) => {
    geometry.addGroup(sub.start, sub.count, s);
    if (sub.textured) {
      const tex = bundle.textures[sub.textureIndex];
      materials.push(
        tex
          ? new THREE.MeshBasicMaterial({
              map: buildTexture(tex),
              // F42: Textur × Vertexfarbe — erst mit der Modulation wirken
              // die Modelle so gesättigt wie im Original.
              vertexColors: true,
              alphaTest: ALPHA_TEST,
              polygonOffset: true,
              polygonOffsetFactor: DECAL_OFFSET_FACTOR,
              polygonOffsetUnits: DECAL_OFFSET_UNITS,
            })
          : new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR }),
      );
    } else {
      materials.push(new THREE.MeshBasicMaterial({ vertexColors: true }));
    }
  });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Actor aus Skeleton + aufgelösten Ressourcen bauen. `resolve` liefert je
 * Bone die Mesh-/Texturbündel (leer = reines Gelenk).
 */
export function buildActor(
  skeleton: Skeleton,
  resolve: (boneIndex: number) => ActorMeshBundle[],
  licht?: ActorLighting,
): Actor {
  const root = new THREE.Group();
  root.name = `actor:${skeleton.name}`;
  root.quaternion.setFromRotationMatrix(sceneBasisMatrix());

  const model = new THREE.Group();
  model.name = 'model';
  model.rotation.order = EULER_ORDER;
  root.add(model);

  const boneGroups: THREE.Group[] = [];
  skeleton.bones.forEach((bone, i) => {
    const group = new THREE.Group();
    group.name = `bone:${bone.name}#${i}`;
    group.rotation.order = EULER_ORDER;
    if (bone.parentIndex < 0) {
      model.add(group);
    } else {
      // Kindversatz entgegen der Bone-Achse (R4, sichtgeprüft) — muss mit
      // `computePose` in pose.ts übereinstimmen, sonst bricht die Dualität.
      group.position.set(0, 0, -skeleton.bones[bone.parentIndex]!.length);
      boneGroups[bone.parentIndex]!.add(group);
    }
    for (const bundle of resolve(i)) group.add(buildMeshObject(bundle, licht));
    boneGroups.push(group);
  });
  return { root, model, boneGroups };
}

const DEG2RAD = Math.PI / 180;

/**
 * Frame anwenden — die Konventionen der Referenzmathematik (pose.ts) inklusive
 * der Wurzelrahmen-Korrektur.
 *
 * `rootFrameFix` ist **Vorgabe**, seit die Sichtprüfung und die Algebra
 * unabhängig auf denselben Wert führen (s. `ROOT_FRAME_FIX_DEG`). Der Schalter
 * bleibt, damit Sweeps und die Dualitätstests das rohe Verhalten weiterhin
 * ansteuern können.
 */
export function applyFrame(
  actor: Actor,
  skeleton: Skeleton,
  frame: AnimationFrame,
  rootFrameFix = true,
): void {
  const t = rootFrameFix ? rootFrameTranslationToModel(frame.rootTranslation) : frame.rootTranslation;
  const pitch = rootFrameFix ? ROOT_FRAME_FIX_DEG : 0;
  actor.model.position.set(t[0], t[1], t[2]);
  actor.model.rotation.set(
    (frame.rootRotation[0] + pitch) * DEG2RAD,
    frame.rootRotation[1] * DEG2RAD,
    frame.rootRotation[2] * DEG2RAD,
    EULER_ORDER,
  );
  skeleton.bones.forEach((bone, i) => {
    const rx = frame.rotations[bone.fileOrder * 3] ?? 0;
    const ry = frame.rotations[bone.fileOrder * 3 + 1] ?? 0;
    const rz = frame.rotations[bone.fileOrder * 3 + 2] ?? 0;
    actor.boneGroups[i]!.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD, EULER_ORDER);
  });
}

/** Bone-Matrix im FF7-Modellraum (Wrapper herausgerechnet) — für Tests/Debug. */
export function boneModelMatrix(actor: Actor, boneIndex: number): THREE.Matrix4 {
  actor.root.updateMatrixWorld(true);
  const rootInverse = actor.root.matrixWorld.clone().invert();
  return rootInverse.multiply(actor.boneGroups[boneIndex]!.matrixWorld);
}

/** Kapsel-Platzhalter (E-HRC-Fallback laut Validierungsmatrix). */
export function buildFallbackActor(height = 20): Actor {
  const root = new THREE.Group();
  root.name = 'actor:fallback';
  root.quaternion.setFromRotationMatrix(sceneBasisMatrix());
  const model = new THREE.Group();
  root.add(model);
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(height / 4, height / 2, 4, 8),
    new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR, wireframe: true }),
  );
  capsule.position.z = height / 2;
  capsule.rotation.x = Math.PI / 2; // Kapselachse auf Modell-Z (Höhenachse)
  model.add(capsule);
  return { root, model, boneGroups: [] };
}
