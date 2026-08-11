import * as THREE from 'three';
import { buildMeshObject } from '@webmidgar/render-actor';
import type { BattleStageFiles } from './model-loader.js';

/**
 * K5 — Three-Pfad der Kampfbühne.
 *
 * Die Bühne ist der EINFACHERE Fall gegenüber den Modellen, nicht der
 * schwierigere: Sie hat kein Skelett, keine Bindpose, keine Kompositionsregel.
 *
 * 🟢 **Platzierungsregel: keine.** Gemessen (`battle-stage.rdtest.ts`, alle 90
 * Bühnen, 1194 Teile): Das Verhältnis „Streuung der Teilmittelpunkte zur
 * mittleren Teilgröße" hat den Median **0,893**, und **81,1 %** der Bühnen
 * liegen über 0,25. Die Teile stehen also NICHT übereinander im Ursprung —
 * jedes `.p` trägt seine Weltlage in den eigenen Vertexkoordinaten. Die Bühne
 * ist damit die blosse Vereinigung ihrer Teile. Die Kontrollhypothese „es
 * fehlt eine Platzierungstabelle" hätte ein Verhältnis nahe 0 verlangt; das
 * kommt im Bestand nur als Minimum (0,072) bei einzelnen Bühnen vor.
 *
 * 🟢 **Basis:** Dieselbe Battle-Basis wie Aufstellung und Kamera
 * (`battleToScene`, x-rechts / y-ab / z-Tiefe ⇒ Rx(180°)). Es gibt keine
 * zweite Flip-Stelle: die Gruppe trägt die Drehung, die Vertexdaten bleiben
 * unangetastet.
 */

/** Rx(180°) — die Matrixform von `battleToScene`, s. composition.ts. */
export const BATTLE_STAGE_ROTATION_X = Math.PI;

export interface BuiltBattleStage {
  root: THREE.Group;
  /** Anzahl tatsächlich eingehängter Teile (für Protokolle/Abnahmen). */
  partCount: number;
  /** Teile ohne auflösbare Textur — gemeldet, nicht stillschweigend ersetzt. */
  missingTextures: number;
}

export function buildBattleStage(name: string, files: BattleStageFiles): BuiltBattleStage {
  const root = new THREE.Group();
  root.name = `battle-stage:${name}`;
  root.rotation.x = BATTLE_STAGE_ROTATION_X;

  let missingTextures = 0;
  for (const mesh of files.parts) {
    for (const sub of mesh.submeshes) {
      if (sub.textured && !files.textures[sub.textureIndex]) missingTextures++;
    }
    root.add(buildMeshObject({ mesh, textures: files.textures }));
  }
  return { root, partCount: files.parts.length, missingTextures };
}
