import * as THREE from 'three';
import type { BattleSkeleton } from '@webmidgar/formats-battle';
import type { MeshSource, TextureSource } from '@webmidgar/formats-model';
import { applyFrame, bindPoseFrame, buildActor, type Actor } from '@webmidgar/render-actor';
import { assignPartsToBones, BATTLE_ROOT_EXTRA_X_DEG, battleSkeletonToSkeleton, battleToScene, type BattleCamera } from './composition.js';

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

/**
 * 🟢 **Maßstab der Kampfmodelle: 1 — kein Umrechnungsfaktor.**
 *
 * F37 hat für FELD-Modelle den Bezugswert 512/4 = 128 kalibriert (Feldfiguren
 * werden also um 4 vergrößert). Ob im Kampf derselbe Bezug gilt, war eine
 * eigene Frage: Die Szene trägt kein `modelScale`-Feld. Gemessen
 * (`battle-vollbild.rdtest.ts`, 2026-08-11):
 *
 *  - Bindpose-Höhen der Spielermodelle: Median **852** (Cloud 817, Tifa 836,
 *    Barret 972, Red XIII 898) — über alle 11 Spielerpräfixe 694…1630.
 *  - Bindpose-Höhen der 369 Gegnermodelle: Median **1370** (10 % 646,
 *    90 % 5329). Spieler und Gegner liegen also in DERSELBEN Größenordnung;
 *    ein Faktor, der nur auf die Party wirkte, würde sie auseinanderreißen.
 *  - Aufstellungsabstände in scene.bin: Median **1803** über 2545 Platzpaare.
 *    Eine 850 hohe Figur bei 1800 Platzabstand ist genau die Dichte, die die
 *    Originalaufnahme zeigt.
 *
 * KONTROLLE (Maßstabssweep 1 / 4 / 8 / 16 im selben Kampf, durch die
 * Szenenkamera gerendert): Schon bei Faktor 4 füllt ein einzelner
 * Party-Unterarm ein Drittel des Bildes und die Figuren ragen über die
 * Bühnenfläche hinaus; bei 8 und 16 ist die Bühne unsichtbar. Nur Faktor 1
 * stellt Party und Gegner gemeinsam auf die Arena. Der Feldfaktor 4 gilt im
 * Kampf also NICHT.
 */
export const BATTLE_MODEL_SCALE = 1;

/**
 * ⚠️ **Nur EINE Basiswendung je Objekt.** Modelle gehen über
 * `buildActor` → `root.quaternion = sceneBasisMatrix()` (ADR-009, Rx(−90°))
 * plus Wurzel-Frame-X 270° und liegen damit BEREITS in der Battle-Lage
 * Rx(180°) = `battleToScene`. Wer auf ein fertiges Modell zusätzlich
 * `battleToScene` anwendet, dreht um weitere 180° und legt jede Figur flach
 * (Rx(90°) statt Rx(180°)) — genau dieser Fehler ist beim ersten Vollbild
 * aufgetreten. `battleToScene` gehört an Plätze, Bühne und Kamera; an Modelle
 * NICHT.
 */
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
 * 🔵 Ersatz-Stage: Bodenplatte + Horizontfarbe.
 *
 * ⚠️ **Nur noch Rückfall.** Der Satz „das Stage-Format des Originals ist
 * unbelegt" stimmt seit K5 nicht mehr: Die 90 Bühnen liegen als skelettlose
 * `.p`/TEX-Präfixe `og`…`rr` in battle.lgp und werden von
 * `loadBattleStage` + `buildBattleStage` echt geladen. Diese Funktion bleibt
 * ausschließlich für den Fall, dass zu einer `location` kein Präfix auflösbar
 * ist (im Originalbestand kommt das nicht vor — 1000/1000 Formationen lösen
 * auf), und als Ersatz in Tests ohne Realdaten.
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

/**
 * Kamera aus dem Szenen-Kamerablock — über die zentrale 🟢 Battle-Basis
 * `battleToScene` (x-rechts, y-ab, z-Tiefe; Messbelege in composition.ts),
 * dieselbe Konvention wie die Aufstellung: Kamera-y ist 1000/1000 negativ
 * (über dem Boden) und landet damit auf Szene-+Y.
 */
export function applyBattleCamera(camera: THREE.PerspectiveCamera, cam: BattleCamera): void {
  const pos = battleToScene(cam.position);
  const target = battleToScene(cam.target);
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(target[0], target[1], target[2]);
}
