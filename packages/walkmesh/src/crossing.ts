import type { FieldGateway, FieldTriggers } from '@webmidgar/formats-field';

/**
 * Trigger-/Gateway-Erkennung im Grundriss (Masterplan Phase 3.3, Schritt 5).
 *
 * **Umgestellt 2026-08-15 (F15).** Bis dahin schnitt der Bewegungsschritt gegen
 * ein „Austrittssegment" aus zwei Vec3 des Records. Diese Deutung ist
 * realdaten-widerlegt (s. `FieldGateway`): Die Segmente liefen quer über die
 * halbe Karte, und der Übertritt feuerte im Bestand praktisch nie. Belegt ist
 * ein **Austrittspunkt** (@2/@4, 85,5 % im eigenen Netz gegen 27,0 %
 * Fremdfeld-Kontrolle); ein zweiter Punkt ist an keinem Versatz nachweisbar.
 *
 * Die Regel lautet deshalb: Ein Gateway feuert, wenn der Bewegungsschritt in
 * den Kreis mit Radius `GATEWAY_RADIUS` um den Austrittspunkt **eintritt** —
 * der Schrittanfang liegt außerhalb, der Schritt selbst kommt näher heran.
 *
 * **Warum ausgerechnet die Eintrittskante.** Sie leistet dasselbe wie die
 * Flankenerkennung der alten Segmentquerung, und drei Fälle zeigen, dass die
 * naheliegenderen Formulierungen es nicht tun:
 *  - „Abstand < R" allein feuert in **jedem** Takt, den man in der Nähe steht,
 *  - „Abstand < R und Annäherung" feuert immer noch mehrfach, sobald man sich
 *    innerhalb des Kreises weiterbewegt,
 *  - der reine Endpunktvergleich verpasst schnelle Schritte, die den Kreis in
 *    einem Takt durchqueren — deshalb zählt der **kürzeste Abstand zur
 *    Schrittstrecke**, nicht der zum Schrittende.
 *
 * Nach einem Field-Wechsel steht die Figur regelmäßig innerhalb des Kreises des
 * Gegen-Gateways (Median 142 Einheiten, s. `FieldGateway`). Genau deshalb darf
 * die Regel dort nicht feuern — und tut es nicht, weil der Schrittanfang schon
 * innen liegt.
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
  /** Parameter der größten Annäherung entlang des Schritts (0…1). */
  t: number;
}

/**
 * Auslöseradius um den Austrittspunkt, in Field-Einheiten.
 *
 * 🔵 Gesetzt, aber **beidseitig aus den Daten eingegrenzt**, nicht geraten:
 *  - **nach unten** durch die Ankunftsstreuung: Über 771 Gegen-Gateway-Paare
 *    liegt der Zielpunkt im Median 142 Einheiten vom Austrittspunkt des
 *    Gegen-Gateways entfernt, 82,7 % unter 300. Ein kleinerer Radius würde
 *    reguläre Ankünfte verfehlen.
 *  - **nach oben** durch den Abstand benachbarter Gateways: Zwei Gateways
 *    desselben Zielfields liegen im Median 1107 Einheiten auseinander. Der
 *    Radius muss unter der Hälfte davon bleiben (553), sonst überlappen sich
 *    zwei Auslösezonen.
 *
 * 300 liegt in diesem Fenster. Wer ihn ändert, muss beide Schranken prüfen.
 */
export const GATEWAY_RADIUS = 300;

/** Kürzester Abstand zur Strecke prev→next samt Parameter der Annäherung. */
function naechsteAnnaeherung(
  prev: GroundPoint,
  next: GroundPoint,
  px: number,
  py: number,
): { abstand: number; t: number } {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - prev.x) * dx + (py - prev.y) * dy) / len2));
  const cx = prev.x + t * dx - px;
  const cy = prev.y + t * dy - py;
  // R9-Härtung: sqrt statt hypot — hypot weicht zwischen V8-Ständen ab.
  return { abstand: Math.sqrt(cx * cx + cy * cy), t };
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
    const [px, py] = gateway.exitPoint;
    const { abstand, t } = naechsteAnnaeherung(prev, next, px, py);
    if (abstand > GATEWAY_RADIUS) return;
    // Eintrittskante: Der Schrittanfang muss AUSSERHALB gelegen haben.
    const vorher = Math.sqrt((prev.x - px) ** 2 + (prev.y - py) ** 2);
    if (vorher <= GATEWAY_RADIUS) return;
    events.push({ gatewayIndex, gateway, t });
  });
  return events.sort((a, b) => a.t - b.t);
}
