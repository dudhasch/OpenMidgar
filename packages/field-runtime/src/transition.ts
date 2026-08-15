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
 * **Umgestellt 2026-08-15 (F15).** Beide Angaben stehen im Record und sind
 * gemessen:
 *
 *  - Zielfield: `u16`@14, 0-basierter Index in die `maplist` (78,8 %
 *    Rückkantenquote gegen 0,2 % Kontrollniveau, S11).
 *  - Ankunftspunkt: `i16`@8 / `i16`@10 — er liegt in **100,0 %** der 978
 *    auflösbaren Gateways im Walkmesh des Zielfields, gegen Kontrollen von
 *    33,1 % (Maplist-Nachbar), 36,2 % (eigenes Field) und 46,2 % (verschobene
 *    Zuordnung).
 *
 * Damit entfällt die bisherige Herleitung über das Gegen-Gateway. Sie war
 * korrekt gedacht — der S11-Befund „der Zielpunkt steht nicht im Record" war
 * kein Messfehler, sondern eine zu enge Kandidatenmenge (@12/@16/@18, nie @8)
 * — aber sie traf nur 510 von 1095 Gateways exakt. Die Rückrichtung bleibt als
 * **Rückfall** erhalten, für den Fall, dass der Punkt außerhalb des Netzes
 * liegt; sie ist damit nicht mehr der Normalweg, sondern die Ausnahme.
 */

export interface FieldTransition {
  /** Fieldname aus der `maplist`, kleingeschrieben. */
  targetField: string;
  /** Index des Gegen-Gateways im Zielfield — nur beim Rückfall gesetzt. */
  returnGatewayIndex: number | null;
  /** Ankunftspunkt im Grundriss des Zielfields. */
  arrival: { x: number; y: number } | null;
  /** Woher der Ankunftspunkt stammt — der Normalweg ist `record`. */
  source: 'record' | 'gegen-gateway' | null;
  /** Warum kein Ankunftspunkt bestimmt werden konnte. */
  reason?: string;
}

export function resolveGatewayTarget(change: FieldChange, maplist: FieldMaplist): string | null {
  return resolveMaplistTarget(maplist, change.destMaplistIndex);
}

/**
 * Wie weit die Figur beim **Rückfall** von der Austrittsstelle ins Zielfield
 * hineingesetzt wird. Ohne Versatz stünde sie genau auf der Kante.
 */
export const ARRIVAL_INSET = 24;

/** Suchraster der Einrücktiefen, aufsteigend — nah an der Stelle bevorzugt. */
export const ARRIVAL_INSETS: readonly number[] = [ARRIVAL_INSET, 48, 96, 8, 192];

/** Suchrichtungen des Rückfalls (Einheitskreis, feste Reihenfolge). */
const RICHTUNGEN: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [0.7071067811865476, 0.7071067811865476],
  [-0.7071067811865476, 0.7071067811865476],
  [0.7071067811865476, -0.7071067811865476],
  [-0.7071067811865476, -0.7071067811865476],
];

export function planTransition(
  change: FieldChange,
  maplist: FieldMaplist,
  targetBundle: FieldBundle | null,
  fromFieldId: string,
): FieldTransition | null {
  const targetField = resolveGatewayTarget(change, maplist);
  if (!targetField) return null;
  const leer = { targetField, returnGatewayIndex: null, arrival: null, source: null } as const;
  if (!targetBundle) return { ...leer, reason: 'Zielfield nicht geladen' };
  if (!targetBundle.walkmesh || targetBundle.walkmesh.triangles.length === 0) {
    return { ...leer, reason: 'Zielfield ohne Walkmesh' };
  }

  const solver = new WalkmeshSolver(targetBundle.walkmesh);

  // --- Normalweg: der Ankunftspunkt aus dem Record ------------------------
  const [zx, zy] = change.destPoint;
  if (solver.locate(zx, zy)) {
    return {
      targetField,
      returnGatewayIndex: null,
      arrival: { x: zx, y: zy },
      source: 'record',
    };
  }

  // --- Rückfall: Austrittsstelle des Gegen-Gateways ------------------------
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
  if (returnIndex === null) {
    return { ...leer, reason: 'Zielpunkt außerhalb des Netzes, kein Gegen-Gateway' };
  }
  const [gx, gy] = gateways[returnIndex]!.exitPoint;
  if (solver.locate(gx, gy)) {
    return {
      targetField,
      returnGatewayIndex: returnIndex,
      arrival: { x: gx, y: gy },
      source: 'gegen-gateway',
    };
  }
  // Ringsuche um die Austrittsstelle, feste Reihenfolge ⇒ deterministisch.
  for (const inset of ARRIVAL_INSETS) {
    for (const [dx, dy] of RICHTUNGEN) {
      const x = gx + dx * inset;
      const y = gy + dy * inset;
      if (solver.locate(x, y)) {
        return {
          targetField,
          returnGatewayIndex: returnIndex,
          arrival: { x, y },
          source: 'gegen-gateway',
        };
      }
    }
  }
  return {
    targetField,
    returnGatewayIndex: returnIndex,
    arrival: null,
    source: null,
    reason: 'weder Zielpunkt noch Gegen-Gateway liegen im Walkmesh',
  };
}
