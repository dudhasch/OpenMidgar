import * as THREE from 'three';
import type { BattleSkeleton } from '@webmidgar/formats-battle';
import type { MeshSource, TextureSource } from '@webmidgar/formats-model';
import { applyFrame, bindPoseFrame, buildActor, type Actor } from '@webmidgar/render-actor';
import { ff7ToScene } from '@webmidgar/convert';
import { assignPartsToBones, BATTLE_ROOT_EXTRA_X_DEG, battleSkeletonToSkeleton, type BattleCamera } from './composition.js';

/**
 * Three-Pfad der Battle-Darstellung (S32). Die Regeln (Skelettabbildung,
 * Teilezuordnung, Kamera) liegen Three-frei in composition.ts — hier steht
 * nur die Reproduktion. Der Modellbau läuft über `buildActor` aus
 * render-actor: Battle-Geometrie IST `.p` und Battle-Texturen SIND TEX
 * (S30-Suffixklassifikation), nur das Skelett ist battle-eigen.
 */

export interface BattleModelFiles {
  skeleton: BattleSkeleton;
  /** Geometrien in SUFFIXORDNUNG (die Ordnung ist Teil der 🟡-Kompositionsregel). */
  parts: MeshSource[];
  /** Texturen in Suffixordnung — `.p`-Submeshes indizieren hinein (🟡). */
  textures: (TextureSource | null)[];
}

export interface BuiltBattleActor {
  actor: Actor;
  /** Teile ohne Bone (🟡 Waffen-Kandidaten) — nicht dargestellt, gemeldet. */
  unassignedParts: number[];
}

export function buildBattleActor(name: string, files: BattleModelFiles): BuiltBattleActor {
  const skeleton = battleSkeletonToSkeleton(files.skeleton, name);
  const { boneToPart, unassignedParts } = assignPartsToBones(files.skeleton, files.parts.length);
  const actor = buildActor(skeleton, (boneIndex) => {
    const partIndex = boneToPart.get(boneIndex);
    if (partIndex === undefined) return [];
    return [{ mesh: files.parts[partIndex]!, textures: files.textures }];
  });
  // Bindpose + Battle-Wurzelwinkel (Sichtnachweis, s. composition.ts).
  const frame = bindPoseFrame(skeleton);
  applyFrame(actor, skeleton, { ...frame, rootRotation: [BATTLE_ROOT_EXTRA_X_DEG, 0, 0] });
  return { actor, unassignedParts };
}

/**
 * 🔵 Ersatz-Stage: Bodenplatte + Horizontfarbe. Das Stage-Format des Originals
 * ist unbelegt (Formatlage 🔴) — das hier ist die dokumentierte
 * Ersatzdarstellung, keine Rekonstruktion.
 */
export function buildSubstituteStage(radius = 12000): THREE.Group {
  const group = new THREE.Group();
  group.name = 'battle-stage-substitute';
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: 0x2e3440 }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  return group;
}

/** Kamera aus dem Szenen-Kamerablock — über die ZENTRALE Konvertierung. */
export function applyBattleCamera(camera: THREE.PerspectiveCamera, cam: BattleCamera): void {
  const pos = ff7ToScene(cam.position);
  const target = ff7ToScene(cam.target);
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(target[0], target[1], target[2]);
}
