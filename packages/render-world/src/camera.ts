import { ff7ToScene } from '@webmidgar/convert';

/**
 * Verfolgerkamera der Weltkarte (S28) — reine Funktion Pose = f(Ziel,
 * Fahrtrichtung, Parameter), keine Wanduhr, kein interner Zustand. Die
 * Glättung geschieht, wenn gewünscht, taktweise im Aufrufer (deterministisch);
 * hier gibt es nur Geometrie. Eingaben in Weltkoordinaten (FF7-Quellsystem),
 * Ausgabe in Szenenkoordinaten — über `ff7ToScene`, keine eigene Flip-Stelle.
 */

export interface FollowCameraParams {
  /** Abstand hinter dem Ziel im Grundriss. */
  distance: number;
  /** Höhe über dem Ziel. */
  elevation: number;
  /** Blickpunkt-Anhebung über dem Ziel. */
  lookAhead: number;
}

export const DEFAULT_FOLLOW_CAMERA: FollowCameraParams = {
  distance: 9000,
  elevation: 5200,
  lookAhead: 600,
};

export interface CameraPose {
  /** Kameraposition, Szenenkoordinaten. */
  position: [number, number, number];
  /** Blickziel, Szenenkoordinaten. */
  target: [number, number, number];
}

/**
 * `headingGrad`: Fahrtrichtung im Grundriss (0 = +x, gegen den Uhrzeigersinn,
 * dieselbe Konvention wie `richtungGrad` der FieldSession). Die Kamera steht
 * hinter dem Ziel entgegen der Fahrtrichtung.
 */
export function followCameraPose(
  worldX: number,
  worldZ: number,
  worldH: number,
  headingGrad: number,
  params: FollowCameraParams = DEFAULT_FOLLOW_CAMERA,
): CameraPose {
  const rad = (headingGrad * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirZ = Math.sin(rad);
  const camWorld: [number, number, number] = [
    worldX - dirX * params.distance,
    worldZ - dirZ * params.distance,
    worldH + params.elevation,
  ];
  const targetWorld: [number, number, number] = [worldX, worldZ, worldH + params.lookAhead];
  return {
    position: ff7ToScene(camWorld) as [number, number, number],
    target: ff7ToScene(targetWorld) as [number, number, number],
  };
}
