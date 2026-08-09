import {
  resolveMaplistTarget,
  type FieldBundle,
  type FieldMaplist,
} from '@webmidgar/formats-field';
import { WalkmeshSolver } from '@webmidgar/walkmesh';
import type { FieldChange } from './session.js';

/**
 * Field-Wechsel (Masterplan Phase 5): Aus einem gequerten Gateway wird ein
 * Zielfield und ein Ankunftspunkt.
 *
 * Der Zielfield-Index ist realdaten-belegt (u16@14, 0-basierter Index in die
 * `maplist`; 78,8 % Rückkantenquote gegen 0,2 % Kontrollniveau). Der
 * **Zielpunkt** im Record ist es NICHT — deshalb wird er hier bewusst nicht
 * verwendet. Stattdessen liefert die Rückrichtung die Ankunft: Im Zielfield
 * gibt es fast immer ein Gateway zurück zum Herkunftsfield; dessen
 * Austrittslinie ist genau die Stelle, an der die Figur erscheinen muss.
 *
 * Das ist nicht bloß ein Notbehelf — es ist robuster als eine geratene
 * Koordinate, weil es ausschließlich auf belegten Daten beruht.
 */

export interface FieldTransition {
  /** Fieldname aus der `maplist`, kleingeschrieben. */
  targetField: string;
  /** Index des Gegen-Gateways im Zielfield, falls gefunden. */
  returnGatewayIndex: number | null;
  /** Ankunftspunkt im Grundriss des Zielfields. */
  arrival: { x: number; y: number } | null;
  /** Warum kein Ankunftspunkt bestimmt werden konnte. */
  reason?: string;
}

export function resolveGatewayTarget(change: FieldChange, maplist: FieldMaplist): string | null {
  return resolveMaplistTarget(maplist, change.destMaplistIndex);
}

/**
 * Wie weit die Figur von der Austrittslinie ins Zielfield hineingesetzt wird.
 * Ohne diesen Versatz stünde sie exakt auf der Linie und würde beim ersten
 * Schritt sofort wieder hinausfallen.
 */
export const ARRIVAL_INSET = 24;

/** Suchraster der Einrücktiefen, aufsteigend — nah an der Linie bevorzugt. */
export const ARRIVAL_INSETS: readonly number[] = [ARRIVAL_INSET, 48, 96, 8, 192];

/** Abtastpunkte entlang der Austrittslinie, von der Mitte nach außen. */
export const ARRIVAL_FRACTIONS: readonly number[] = [0.5, 0.35, 0.65, 0.2, 0.8];

/**
 * Bestimmt den Ankunftspunkt im Zielfield über das Gegen-Gateway.
 * Beide Lotrichtungen der Austrittslinie werden geprüft; genommen wird die,
 * die im Walkmesh landet. Findet sich keine, greift der Mittelpunkt selbst,
 * und wenn auch der nicht im Mesh liegt, bleibt `arrival` null — der Aufrufer
 * entscheidet dann (z. B. Schwerpunkt des ersten Dreiecks).
 */
export function planTransition(
  change: FieldChange,
  maplist: FieldMaplist,
  targetBundle: FieldBundle | null,
  fromFieldId: string,
): FieldTransition | null {
  const targetField = resolveGatewayTarget(change, maplist);
  if (!targetField) return null;
  if (!targetBundle) {
    return { targetField, returnGatewayIndex: null, arrival: null, reason: 'Zielfield nicht geladen' };
  }
  if (!targetBundle.walkmesh || targetBundle.walkmesh.triangles.length === 0) {
    return { targetField, returnGatewayIndex: null, arrival: null, reason: 'Zielfield ohne Walkmesh' };
  }

  const from = fromFieldId.toLowerCase();
  const gateways = targetBundle.triggers?.gateways ?? [];
  let returnIndex: number | null = null;
  for (const [i, g] of gateways.entries()) {
    if (!g.used) continue;
    if (resolveMaplistTarget(maplist, g.destMaplistIndex) === from) {
      returnIndex = i;
      break;
    }
  }

  const solver = new WalkmeshSolver(targetBundle.walkmesh);
  if (returnIndex === null) {
    return { targetField, returnGatewayIndex: null, arrival: null, reason: 'kein Gegen-Gateway' };
  }

  const line = gateways[returnIndex]!.exitLine;
  const dx = line[1][0] - line[0][0];
  const dy = line[1][1] - line[0][1];
  const len = Math.hypot(dx, dy) || 1;
  // Lotrichtungen der Austrittslinie.
  const nx = -dy / len;
  const ny = dx / len;

  // Der Mittelpunkt allein reicht nicht: Austrittslinien ragen häufig über den
  // begehbaren Bereich hinaus, und die passende Einrücktiefe hängt von der
  // Geometrie ab. Deshalb wird ein kleines Raster abgesucht — erst nah an der
  // Linienmitte und mit dem Standardversatz, dann weiter außen. Die Reihenfolge
  // ist fest, damit das Ergebnis deterministisch bleibt.
  for (const inset of ARRIVAL_INSETS) {
    for (const t of ARRIVAL_FRACTIONS) {
      const px = line[0][0] + dx * t;
      const py = line[0][1] + dy * t;
      for (const sign of [1, -1]) {
        const x = px + nx * inset * sign;
        const y = py + ny * inset * sign;
        if (solver.locate(x, y)) {
          return { targetField, returnGatewayIndex: returnIndex, arrival: { x, y } };
        }
      }
    }
  }
  return {
    targetField,
    returnGatewayIndex: returnIndex,
    arrival: null,
    reason: 'Gegen-Gateway liegt nicht am Walkmesh',
  };
}
