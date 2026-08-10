/**
 * Formelwerk (S31) — durchweg 🔵 **Eigenentwurf mit dokumentierter Abweichung**.
 *
 * Zusatzregel 3 der Roadmap: Schadens- und Trefferformeln liegen mit hoher
 * Wahrscheinlichkeit in der EXE, nicht in Daten. Es gibt hier NICHTS zu
 * „belegen" — deshalb ist jede Formel eine austauschbare, reine Funktion in
 * einer Tabelle (dieselbe Entwurfshaltung wie beim Musikindex S16 und der
 * Fahrzeugmatrix S29): Die Engine ist mit unvollständiger Kenntnis
 * auslieferbar; sie ist dann unvollständig statt falsch. **Kampfverläufe sind
 * reproduzierbar und in sich stimmig, aber NICHT zahlengleich mit dem
 * Original** — dieser Satz gehört in die Release-Notes.
 *
 * Alle Funktionen sind ganzzahlig und ohne Wanduhr/Float-Abhängigkeit
 * (ADR-006/R9: Replay-Bitgleichheit über Engines hinweg).
 */

export interface CombatantStats {
  level: number;
  strength: number;
  defense: number;
  magic: number;
  mdefense: number;
  dexterity: number;
  luck: number;
}

export interface FormulaSet {
  /** Physischer Grundschaden vor Streuung. `power` in 1/16 (16 = Normalhieb). */
  physicalDamage(attacker: CombatantStats, defender: CombatantStats, power: number): number;
  /** Magischer Grundschaden vor Streuung. */
  magicalDamage(attacker: CombatantStats, defender: CombatantStats, power: number): number;
  /** Streuung: bildet einen 8-Bit-Wurf auf einen Faktor in 1/4096 ab. */
  varianceNumerator(roll256: number): number;
  /** Trifft der Angriff? `accuracy` 0–255 (255 = sicher), Wurf 0–255. */
  hits(accuracy: number, attacker: CombatantStats, defender: CombatantStats, roll256: number): boolean;
  /** Fluchtchance in 1/256 je Versuch. */
  escapeThreshold(party: CombatantStats, enemies: CombatantStats[]): number;
  /** ATB-Füllung je Takt (ganzzahlig; ATB_MAX = 65536). */
  atbGainPerTick(stats: CombatantStats): number;
}

export const ATB_MAX = 65536;

/**
 * 🔵 Standardformelsatz. Eigenschaften, auf die Tests bauen dürfen:
 * ganzzahlig, monoton in Angriffwerten, antimonoton in Verteidigungswerten,
 * nie negativ, Streuung in [3841/4096, 4096/4096].
 */
export function defaultFormulas(): FormulaSet {
  return {
    physicalDamage(attacker, defender, power) {
      const base = Math.floor(((attacker.strength * 2 + attacker.level) * power) / 16);
      const reduced = Math.floor((base * 256) / (256 + defender.defense * 2));
      return Math.max(1, reduced);
    },
    magicalDamage(attacker, defender, power) {
      const base = Math.floor(((attacker.magic * 3 + attacker.level) * power) / 16);
      const reduced = Math.floor((base * 256) / (256 + defender.mdefense * 2));
      return Math.max(1, reduced);
    },
    varianceNumerator(roll256) {
      return 3841 + (roll256 & 0xff);
    },
    hits(accuracy, attacker, defender, roll256) {
      if (accuracy >= 255) return true;
      const evade = Math.min(64, defender.dexterity >> 2);
      const chance = Math.max(16, Math.min(255, accuracy + attacker.dexterity - evade));
      return roll256 < chance;
    },
    escapeThreshold(party, enemies) {
      const maxEnemyLevel = enemies.reduce((m, e) => Math.max(m, e.level), 1);
      const diff = party.level - maxEnemyLevel;
      return Math.max(32, Math.min(224, 128 + diff * 8));
    },
    atbGainPerTick(stats) {
      return 512 + stats.dexterity * 24;
    },
  };
}

/** Wendet die Streuung an: `floor(damage · num / 4096)`, mindestens 1. */
export function applyVariance(damage: number, numerator: number): number {
  return Math.max(1, Math.floor((damage * numerator) / 4096));
}
