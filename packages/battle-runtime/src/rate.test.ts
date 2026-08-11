import { describe, expect, it } from 'vitest';
import {
  BATTLE_TICK_HZ,
  BATTLE_TICK_MS,
  FIELD_TICK_HZ,
  FIELD_TO_BATTLE_DIVIDER,
  battleTicksToMs,
  isBattleTickDue,
} from './rate.js';
import { BattleSession, type BattleConfig, type PartyMemberSpec } from './session.js';

/**
 * **Die Messung zur Kampf-Bildrate.**
 *
 * Frage der Aufgabe: „Prüfe, mit welcher Rate `packages/battle-runtime` heute
 * läuft. Wenn es 30 ist, sind alle Wartewerte um Faktor 2 falsch."
 *
 * Gemessenes Ergebnis (2026-08-11): battle-runtime kannte **gar keine** Rate;
 * die Sitzung zählt nur Takte. Die 1.0-Demo hat sie in der gemeinsamen
 * 30-Hz-Schleife getickt — der Kampf lief also mit doppelter Wanduhrgeschwin-
 * digkeit. Wartewerte aus Originaldaten gibt es in der Kampflaufzeit noch
 * keine (die ATB-Füllung ist 🔵 Eigenentwurf), deshalb war nur die
 * Geschwindigkeit falsch, nicht eine Zahl.
 *
 * Der zweite Test unten ist der Beleg dafür, dass die Korrektur **kein
 * engineCompat-Schritt** ist: Der Digest hängt an der Zahl der Takte und an
 * den Eingaben, nicht an ihrer Wanduhrverteilung.
 */

function config(seed: number): BattleConfig {
  const party: PartyMemberSpec[] = [
    { id: 'cloud', level: 7, maxHp: 302, maxMp: 54, strength: 20, defense: 12, magic: 14, mdefense: 10, dexterity: 15, luck: 8 },
  ];
  return {
    party,
    enemies: [
      {
        enemyTypeId: 1,
        level: 6,
        maxHp: 80,
        mp: 0,
        stats: { level: 6, strength: 10, defense: 8, magic: 4, mdefense: 4, dexterity: 9, luck: 4 },
        attackIds: [3],
        exp: 16,
        ap: 2,
        gil: 40,
      },
    ],
    seed,
  };
}

describe('Kampf-Taktrate', () => {
  it('nennt die Zielraten des Originals: Kampf 15, Field 30 (ffnx.md)', () => {
    expect(BATTLE_TICK_HZ).toBe(15);
    expect(FIELD_TICK_HZ).toBe(30);
    expect(FIELD_TO_BATTLE_DIVIDER).toBe(2);
    expect(BATTLE_TICK_MS).toBeCloseTo(66.667, 3);
  });

  it('rechnet Kampf-Wartewerte gegen 15 Hz, nicht gegen 30', () => {
    // „Ein Kampf-Wartewert = n/15 s" — 30 Ticks sind zwei Sekunden.
    expect(battleTicksToMs(30)).toBe(2000);
    // Kontrollhypothese: gegen 30 Hz gerechnet wäre es die Hälfte. Genau
    // dieser Faktor 2 war der Fehler der 1.0-Demo.
    expect((30 * 1000) / FIELD_TICK_HZ).toBe(1000);
  });

  it('teilt eine 30-Hz-Wirtsschleife korrekt auf den Kampftakt herunter', () => {
    const faellig = Array.from({ length: 12 }, (_, i) => isBattleTickDue(i));
    expect(faellig.filter(Boolean)).toHaveLength(6);
    expect(faellig).toEqual([true, false, true, false, true, false, true, false, true, false, true, false]);
    // Ein 60-Hz-Wirt tickt jeden vierten Durchlauf.
    expect([0, 1, 2, 3, 4].map((i) => isBattleTickDue(i, 60))).toEqual([true, false, false, false, true]);
  });

  it('lässt den Digest von der Rate UNBERÜHRT — die Sitzung kennt keine Wanduhr', () => {
    // Zwei Läufe über dieselbe Zahl Takte, unterschiedlich „getaktet"
    // gedacht: Der Zustand hängt nur an Takten und Eingaben.
    const a = new BattleSession(config(0x51ed));
    const b = new BattleSession(config(0x51ed));
    for (let i = 0; i < 200; i++) a.tick();
    for (let i = 0; i < 200; i++) b.tick();
    expect(a.digest()).toBe(b.digest());

    // Kontrollhypothese 1: ein Takt mehr ergibt einen ANDEREN Digest — der
    // Test misst also überhaupt etwas.
    const c = new BattleSession(config(0x51ed));
    for (let i = 0; i < 201; i++) c.tick();
    expect(c.digest()).not.toBe(a.digest());

    // Kontrollhypothese 2: ein anderer Seed ebenfalls.
    const d = new BattleSession(config(0x1234));
    for (let i = 0; i < 200; i++) d.tick();
    expect(d.digest()).not.toBe(a.digest());
  });

  it('hält den Digest über die Runde fest (Regressionsanker für 200 Takte)', () => {
    const s = new BattleSession(config(0x51ed));
    for (let i = 0; i < 200; i++) s.tick();
    // Neu angelegt in dieser Runde. Ändert er sich, ist das ein
    // engineCompat-Schritt und gehört dokumentiert.
    expect(s.digest()).toMatchInlineSnapshot(`"738934749e950317"`);
  });
});
