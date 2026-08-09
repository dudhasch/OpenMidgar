import type { FieldGateway, FieldTriggers } from '@webmidgar/formats-field';

/**
 * Trigger-/Gateway-Erkennung im Grundriss (Masterplan Phase 3.3, Schritt 5):
 * Ein Gateway feuert, wenn der Bewegungsschritt (prev → next) das
 * Austrittssegment schneidet — Flankenerkennung, exakt einmal pro Querung.
 */

export interface GroundPoint {
  x: number;
  y: number;
}

/** Segment-Segment-Schnitt im Grundriss; t = Parameter entlang prev→next. */
export function segmentsIntersect(
  p0: GroundPoint,
  p1: GroundPoint,
  a: GroundPoint,
  b: GroundPoint,
): { hit: boolean; t?: number } {
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = rx * ey - ry * ex;
  if (Math.abs(denom) < 1e-12) return { hit: false };
  const wx = a.x - p0.x;
  const wy = a.y - p0.y;
  const t = (wx * ey - wy * ex) / denom;
  const s = (wx * ry - wy * rx) / denom;
  if (t < 0 || t > 1 || s < 0 || s > 1) return { hit: false };
  return { hit: true, t };
}

export interface GatewayEvent {
  gatewayIndex: number;
  gateway: FieldGateway;
  /** Parameter entlang des Bewegungsschritts (für deterministische Reihenfolge). */
  t: number;
}

/** Prüft einen Bewegungsschritt gegen alle aktiven Gateways eines Fields. */
export function detectGatewayCrossings(
  prev: GroundPoint,
  next: GroundPoint,
  triggers: FieldTriggers,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  triggers.gateways.forEach((gateway, gatewayIndex) => {
    if (!gateway.used) return;
    const a = { x: gateway.exitLine[0][0], y: gateway.exitLine[0][1] };
    const b = { x: gateway.exitLine[1][0], y: gateway.exitLine[1][1] };
    const hit = segmentsIntersect(prev, next, a, b);
    if (hit.hit) events.push({ gatewayIndex, gateway, t: hit.t! });
  });
  return events.sort((a, b) => a.t - b.t);
}
