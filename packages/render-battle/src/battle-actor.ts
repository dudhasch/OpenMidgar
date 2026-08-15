import * as THREE from 'three';
import type { BattleAnimBank, BattleSkeleton } from '@webmidgar/formats-battle';
import type { AnimationClipSource, MeshSource, Skeleton, TextureSource } from '@webmidgar/formats-model';
import { applyFrame, bindPoseFrame, buildActor, type Actor } from '@webmidgar/render-actor';
import {
  assignPartsToBones,
  battleAnimationToClip,
  BATTLE_ROOT_EXTRA_X_DEG,
  battleSkeletonToSkeleton,
  battleToScene,
  type BattleCamera,
} from './composition.js';

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
  /** Animationsbank aus `<präfix>da` (K9). `null`, wenn keine geladen wurde. */
  animations?: BattleAnimBank | null;
}

export interface BuiltBattleActor {
  actor: Actor;
  /** Teile ohne Bone (🟡 Waffen-Kandidaten) — nicht dargestellt, gemeldet. */
  unassignedParts: number[];
  /** Der NAM-Skeleton der Modellkette — nötig, um Rahmen anzuwenden. */
  skeleton: Skeleton;
  /** Clips der Bank in Bankreihenfolge; leere Platzhaltersätze fallen heraus. */
  clips: AnimationClipSource[];
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
  // Leere Platzhaltersätze tragen keine Rahmen (K9) — sie fallen hier heraus,
  // damit ein Index in `clips` immer einen abspielbaren Clip trifft.
  const clips = (files.animations?.animations ?? []).filter((a) => !a.leer).map((a) => battleAnimationToClip(a));
  return { actor, unassignedParts, skeleton, clips };
}

/**
 * Einen Animationsrahmen auf einen Kampfaktor legen (K9).
 *
 * Der Battle-Wurzelwinkel wird auf die Wurzeldrehung des Rahmens **addiert** —
 * genauso, wie ihn `buildBattleActor` für die Bindpose setzt. Das ist die
 * bestehende Algebra des Projekts (`applyFrame` addiert `ROOT_FRAME_FIX_DEG`
 * an derselben Stelle), nicht eine neue Annahme.
 *
 * ⚠️ 🟡 **Wo diese Addition genau stimmt.** Sie faltet die Basisdrehung in den
 * X-Platz eines YXZ-Eulertripels. Das ist mit „Basis ∘ Animation" nur dann
 * gleichbedeutend, wenn die Wurzel-Y-Drehung des Rahmens 0 ist — bei der
 * Bindpose ist sie das, im Lauf einer Animation nicht zwangsläufig. Der
 * Field-Pfad rechnet seit je genauso; ob der Unterschied im Kampf sichtbar
 * wird, entscheidet ein Bildvergleich, keine Rechnung. Bis dahin bleibt es
 * bei der bestehenden Algebra, damit Feld und Kampf nicht auseinanderlaufen.
 *
 * Rahmenindizes werden zyklisch genommen — eine Kampfanimation ist eine
 * Schleife, und ein Index jenseits des Endes soll nicht in die Bindpose
 * zurückfallen.
 */
export function applyBattleAnimationFrame(
  built: BuiltBattleActor,
  clip: AnimationClipSource,
  frameIndex: number,
): void {
  if (clip.frames.length === 0) return;
  const n = clip.frames.length;
  const f = clip.frames[((frameIndex % n) + n) % n]!;
  applyFrame(built.actor, built.skeleton, {
    ...f,
    rootRotation: [f.rootRotation[0] + BATTLE_ROOT_EXTRA_X_DEG, f.rootRotation[1], f.rootRotation[2]],
  });
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
