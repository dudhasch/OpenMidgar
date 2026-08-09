import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { ff7ToScene } from '@webmidgar/convert';
import type { Vec3 } from '@webmidgar/formats-field';

/**
 * Walkmesh-Debug-Overlay (Masterplan Phase 3.3, Punkt 8): Dreieckskanten als
 * Liniensegmente, gesperrte Kanten hervorgehoben. Konsumiert die
 * Solver-Debugdaten, damit Overlay und Bewegungslogik dieselbe Sicht teilen.
 */

export interface DebugEdge {
  a: Vec3;
  b: Vec3;
  blocked: boolean;
}

export function buildWalkmeshDebugObject(edges: DebugEdge[]): Group {
  const normal: number[] = [];
  const blocked: number[] = [];
  for (const e of edges) {
    const target = e.blocked ? blocked : normal;
    target.push(...ff7ToScene(e.a), ...ff7ToScene(e.b));
  }
  const group = new Group();
  const make = (data: number[], color: number): LineSegments => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(data, 3));
    return new LineSegments(geom, new LineBasicMaterial({ color }));
  };
  if (normal.length) group.add(make(normal, 0x9a9a9a));
  if (blocked.length) group.add(make(blocked, 0xff2020)); // Sperrkanten rot
  return group;
}
