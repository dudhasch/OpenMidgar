import { describe, expect, it } from 'vitest';
import type { FieldRuntimeState } from '@webmidgar/interpreter';
import {
  BILDER_JE_SCHRITT,
  DANGER_GEHEN,
  DANGER_PRO_PRUEFUNG,
  DANGER_RENNEN,
  EncounterModel,
  OFFSET_ZUWACHS,
  STEP_ID_ZUWACHS,
  type EncounterTable,
} from './encounter.js';

/**
 * Schrittzähler-Modell (Speedrun-Dokumentation „Step Count").
 *
 * Geprüft wird die Zählerhierarchie selbst — nicht eine Kampfhäufigkeit.
 * Der Kern der Beschreibung ist ein VERHÄLTNIS: Gehen bringt ein Viertel des
 * Gefahrenzuwachses bei unveränderter Schrittzählung. Genau das muss der Test
 * festnageln, denn daran hängt jede Step-Route.
 */

/** Minimaler Zustand für `nextRandom` — der PRNG braucht nur `rngState`. */
function zustand(seed = 1): FieldRuntimeState {
  return { rngState: seed >>> 0 } as unknown as FieldRuntimeState;
}

function tabelle(rate: number): EncounterTable {
  return {
    enabled: true,
    rate,
    standard: [
      { battleId: 100, probability: 32 },
      { battleId: 200, probability: 32 },
    ],
    special: [],
  };
}

describe('Schrittzähler: Zählerhierarchie', () => {
  it('stepId wandert alle 8 Bilder um +2 — beim Gehen wie beim Rennen', () => {
    for (const laufend of [true, false]) {
      const m = new EncounterModel(tabelle(0));
      const st = zustand();
      for (let i = 0; i < BILDER_JE_SCHRITT - 1; i++) {
        m.onMovedTick(st, laufend);
        expect(m.stepId).toBe(0);
      }
      m.onMovedTick(st, laufend);
      expect(m.stepId).toBe(STEP_ID_ZUWACHS);
    }
  });

  it('Gehen bringt exakt ein Viertel der Gefahr des Rennens', () => {
    const rennen = new EncounterModel(tabelle(0));
    const gehen = new EncounterModel(tabelle(0));
    const st = zustand();
    // Zehn volle Schrittzyklen; Rate 0 ⇒ nie ein Kampf, die Zähler laufen rein.
    for (let i = 0; i < BILDER_JE_SCHRITT * 10; i++) {
      rennen.onMovedTick(st, true);
      gehen.onMovedTick(st, false);
    }
    expect(rennen.stepId).toBe(gehen.stepId); // Schrittzählung identisch
    expect(rennen.danger).toBe(10 * DANGER_RENNEN);
    expect(gehen.danger).toBe(10 * DANGER_GEHEN);
    expect(rennen.danger).toBe(gehen.danger * 4);
  });

  it('offset wandert um +13, wenn stepId bei 256 überläuft', () => {
    const m = new EncounterModel(tabelle(0));
    const st = zustand();
    expect(m.offset).toBe(0);
    // 128 Schrittzyklen à +2 ⇒ stepId läuft genau einmal über.
    for (let i = 0; i < BILDER_JE_SCHRITT * 128; i++) m.onMovedTick(st, true);
    expect(m.stepId).toBe(0);
    expect(m.offset).toBe(OFFSET_ZUWACHS);
  });
});

describe('Schrittzähler: „Limbo" unter einer Prüfung', () => {
  /**
   * Der praktische Kern der Doku: Dieselbe Wegstrecke löst beim Rennen eine
   * Prüfung aus und beim Gehen nicht — obwohl beide gleich viele Schritte
   * zählen. Rate 255 macht jede Prüfung zum Kampf, damit der Test die
   * SCHWELLE misst und nicht den Zufall.
   */
  it('gleiche Schrittzahl: Rennen löst aus, Gehen nicht', () => {
    const zyklenBisPruefung = DANGER_PRO_PRUEFUNG / DANGER_RENNEN;
    const bilder = BILDER_JE_SCHRITT * zyklenBisPruefung;

    const rennen = new EncounterModel(tabelle(255));
    const stR = zustand(7);
    let kampfBeimRennen: number | null = null;
    for (let i = 0; i < bilder; i++) kampfBeimRennen ??= rennen.onMovedTick(stR, true);

    const gehen = new EncounterModel(tabelle(255));
    const stG = zustand(7);
    let kampfBeimGehen: number | null = null;
    for (let i = 0; i < bilder; i++) kampfBeimGehen ??= gehen.onMovedTick(stG, false);

    expect(kampfBeimRennen).not.toBeNull();
    expect(kampfBeimGehen).toBeNull();
    expect(rennen.stepId).toBe(gehen.stepId);
  });

  it('Gehen verschiebt die Prüfung um den Faktor 4, verhindert sie nicht', () => {
    const bilder = BILDER_JE_SCHRITT * (DANGER_PRO_PRUEFUNG / DANGER_GEHEN);
    const m = new EncounterModel(tabelle(255));
    const st = zustand(7);
    let kampf: number | null = null;
    for (let i = 0; i < bilder; i++) kampf ??= m.onMovedTick(st, false);
    expect(kampf).not.toBeNull();
  });
});

describe('Schrittzähler: Formationsnummer', () => {
  it('wandert je Kampf um +2 bzw. +3 und bleibt damit nichtlinear', () => {
    const m = new EncounterModel(tabelle(255));
    const st = zustand(3);
    const stände: number[] = [];
    for (let k = 0; k < 4; k++) {
      let kampf: number | null = null;
      while (kampf === null) kampf = m.onMovedTick(st, true);
      stände.push(m.formationId);
    }
    // 0 → +2 = 2 → +2 = 4 … gerade Stände wachsen um 2; die Folge ist
    // vom aktuellen Wert abhängig, nicht konstant.
    expect(stände).toEqual([2, 4, 6, 8]);
    const ungerade = new EncounterModel(tabelle(255));
    ungerade.setzeZaehler({ formationId: 1 });
    let k: number | null = null;
    const st2 = zustand(3);
    while (k === null) k = ungerade.onMovedTick(st2, true);
    expect(ungerade.formationId).toBe(4); // 1 + 3
  });
});

describe('Schrittzähler: Zustand bleibt sicherbar', () => {
  it('setzeZaehler stellt alle fünf Zähler wieder her', () => {
    const m = new EncounterModel(tabelle(64));
    const st = zustand(5);
    for (let i = 0; i < 500; i++) m.onMovedTick(st, i % 3 === 0);
    const stand = m.zaehler();

    const n = new EncounterModel(tabelle(64));
    n.setzeZaehler(stand);
    expect(n.zaehler()).toEqual(stand);

    // Weiterlauf ab identischem Zähler- UND PRNG-Stand ist identisch.
    const a = zustand(11);
    const b = zustand(11);
    const folgeM: (number | null)[] = [];
    const folgeN: (number | null)[] = [];
    for (let i = 0; i < 400; i++) {
      folgeM.push(m.onMovedTick(a, true));
      folgeN.push(n.onMovedTick(b, true));
    }
    expect(folgeN).toEqual(folgeM);
  });
});
