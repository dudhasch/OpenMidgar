/**
 * Effekt-Taxonomie (MS11/ADR-020): eigenes versioniertes Schema — die
 * Abweisung unbekannter Einträge ist Pflicht (die Engine verweigert sie
 * später mit Diagnose, das Studio schon als Strukturfehler).
 */

import { describe, expect, it } from 'vitest';
import {
  checkEffekt,
  EFFECT_ARTEN,
  EFFECT_TAXONOMY_VERSION,
  EFFECT_ZIELE,
  ELEMENTE,
  STATUSWERTE,
  type Effekt,
} from './effects.js';

function fehlerVon(effekt: unknown): string[] {
  const out: string[] = [];
  checkEffekt((pfad) => out.push(pfad), effekt, 'effekt');
  return out;
}

describe('Effekt-Taxonomie (versioniert)', () => {
  it('trägt eine Schemaversion und geschlossene Konstantenlisten', () => {
    expect(EFFECT_TAXONOMY_VERSION).toBe(1);
    expect(EFFECT_ARTEN).toEqual(['heil_hp', 'heil_mp', 'schaden', 'buff', 'debuff', 'status_setzen', 'status_heilen']);
    expect(EFFECT_ZIELE).toEqual(['wahl_einzeln', 'wahl_gruppe', 'party', 'selbst', 'gegner_einzeln', 'gegner_gruppe']);
    expect(ELEMENTE).toEqual(['feuer', 'eis', 'blitz', 'erde', 'wind', 'wasser', 'heilig', 'schatten', 'gift', 'schwerkraft']);
    expect(STATUSWERTE.length).toBeGreaterThan(0);
    expect(new Set(STATUSWERTE).size).toBe(STATUSWERTE.length);
  });

  it('akzeptiert gültige Effekte aller Stärke-Alternativen', () => {
    const fest: Effekt = {
      art: 'schaden',
      ziel: 'gegner_einzeln',
      staerke: { fest: 30 },
      element: 'feuer',
      status: 'blind',
      trefferquote: 0.3,
    };
    expect(fehlerVon(fest)).toEqual([]);
    expect(fehlerVon({ art: 'heil_hp', ziel: 'party', staerke: { prozent: 25 } })).toEqual([]);
  });

  it('weist unbekannte art/ziel/element/status als Strukturfehler ab', () => {
    const pfade = fehlerVon({
      art: 'wunder',
      ziel: 'irgendwen',
      staerke: { fest: 1 },
      element: 'magma',
      status: 'muede',
    });
    expect(pfade).toEqual(['effekt.art', 'effekt.ziel', 'effekt.element', 'effekt.status']);
  });

  it('staerke verlangt genau eine der Alternativen fest|prozent; prozent in 0..100', () => {
    expect(fehlerVon({ art: 'schaden', ziel: 'selbst', staerke: {} })).toEqual(['effekt.staerke']);
    expect(fehlerVon({ art: 'schaden', ziel: 'selbst', staerke: { fest: 1, prozent: 2 } })).toEqual(['effekt.staerke']);
    expect(fehlerVon({ art: 'schaden', ziel: 'selbst', staerke: { prozent: 101 } })).toEqual(['effekt.staerke.prozent']);
    expect(fehlerVon({ art: 'schaden', ziel: 'selbst' })).toEqual(['effekt.staerke']);
  });

  it('trefferquote muss in 0..1 liegen; Nicht-Objekt wird abgewiesen', () => {
    expect(fehlerVon({ art: 'status_setzen', ziel: 'gegner_gruppe', staerke: { fest: 0 }, trefferquote: 1.5 })).toEqual([
      'effekt.trefferquote',
    ]);
    expect(fehlerVon('feuerball')).toEqual(['effekt']);
  });
});
