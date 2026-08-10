import type { WorldTickInput } from './session.js';

/**
 * Brücke S27-Aktionsstrom → WorldSession (S29). Strukturell typisiert, damit
 * world-runtime nicht von `@webmidgar/input` abhängt — die Sitzung bleibt
 * mit jedem Aktionslieferanten testbar. Belegung: Achse X dreht, Achse Y
 * fährt (Feinstufung kollabiert auf das Vorzeichen — die Stufen bleiben in
 * der Aufzeichnung erhalten und sind für spätere Feinfahrt reserviert),
 * `ok` ist die Aktion, `switch` wechselt das Fahrzeug.
 */
export function toWorldInput(sample: { held: readonly string[]; axisX: number; axisY: number }): WorldTickInput {
  return {
    turn: Math.sign(sample.axisX) as -1 | 0 | 1,
    throttle: Math.sign(sample.axisY) as -1 | 0 | 1,
    action: sample.held.includes('ok'),
    switchVehicle: sample.held.includes('switch'),
  };
}
