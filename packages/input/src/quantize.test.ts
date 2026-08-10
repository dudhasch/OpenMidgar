import { describe, expect, it } from 'vitest';
import { AXIS_STUFEN, axisFromDigital, dequantizeAxis, quantizeAxis } from './quantize.js';

/**
 * S27-Abnahme „Achsen-Quantisierung als Property-Test": 1000 deterministische
 * Zufallswerte (seeded — Tests würfeln nie mit der Wanduhr), geprüft werden
 * die Eigenschaften, nicht Einzelwerte: Ganzzahligkeit, Wertebereich,
 * Idempotenz über die Rückabbildung (keine Rundungsdrift), Monotonie und
 * Punktsymmetrie.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('quantizeAxis', () => {
  it('liefert für 1000 zufällige Werte ganzzahlige Stufen im Wertebereich, ohne Drift, monoton und symmetrisch', () => {
    const rnd = mulberry32(0x51f7);
    const values = Array.from({ length: 1000 }, () => rnd() * 2.4 - 1.2); // absichtlich über [−1,1] hinaus
    for (const v of values) {
      const q = quantizeAxis(v);
      expect(Number.isInteger(q)).toBe(true);
      expect(Math.abs(q)).toBeLessThanOrEqual(AXIS_STUFEN);
      // Keine Rundungsdrift: Stufe → Mittenwert → Stufe ist ein Fixpunkt.
      expect(quantizeAxis(dequantizeAxis(q))).toBe(q);
      // Punktsymmetrie: das Vorzeichen ist reine Spiegelung. (`0 - q` statt
      // `-q`: die Negation von 0 wäre −0, und die Funktion liefert nie −0 —
      // genau das wird hier mitgeprüft.)
      expect(quantizeAxis(-v)).toBe(0 - q === 0 ? 0 : -q);
      expect(Object.is(quantizeAxis(-v), -0)).toBe(false);
      // Wiederholbarkeit (triviale, aber notwendige Eigenschaft).
      expect(quantizeAxis(v)).toBe(q);
    }
    // Monotonie über die sortierte Folge.
    const sorted = [...values].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(quantizeAxis(sorted[i]!)).toBeGreaterThanOrEqual(quantizeAxis(sorted[i - 1]!));
    }
  });

  it('behandelt Deadzone, Sättigung und Sonderwerte definiert', () => {
    expect(quantizeAxis(0)).toBe(0);
    expect(quantizeAxis(0.2)).toBe(0); // innerhalb der Deadzone
    expect(quantizeAxis(0.26)).toBe(1); // knapp jenseits: mindestens Stufe 1
    expect(quantizeAxis(1)).toBe(AXIS_STUFEN);
    expect(quantizeAxis(5)).toBe(AXIS_STUFEN); // Sättigung
    expect(quantizeAxis(-1)).toBe(-AXIS_STUFEN);
    expect(quantizeAxis(Number.NaN)).toBe(0);
    expect(quantizeAxis(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('axisFromDigital', () => {
  it('bildet digitale Richtungen auf Vollausschlag ab, Gegenrichtungen heben sich auf', () => {
    expect(axisFromDigital(false, false)).toBe(0);
    expect(axisFromDigital(true, true)).toBe(0);
    expect(axisFromDigital(false, true)).toBe(AXIS_STUFEN);
    expect(axisFromDigital(true, false)).toBe(-AXIS_STUFEN);
  });
});
