import type { GrowthSection } from '@webmidgar/formats-battle';

/**
 * Ergebnisverbuchung (S33) — EXP/Stufenaufstieg/HP-MP-Zuwachs.
 *
 * Datenlage: Die Growth-Records (Kurvenindizes, 64 Kurven, Gewinn-Tabellen)
 * sind Formatfakt (S30). Die VERKNÜPFUNGSREGEL — wie aus (gradient, base)
 * eine EXP-Schwelle oder ein Statistikzuwachs wird — liegt nicht in den Daten
 * (Zusatzregel 3) und ist hier 🔵 Eigenentwurf: ganzzahlig, monoton,
 * dokumentiert, austauschbar. Kampf- und Aufstiegsverläufe sind damit
 * reproduzierbar und in sich stimmig, aber NICHT zahlengleich mit dem
 * Original (Release-Notes-Pflicht).
 */

export interface CharacterProgress {
  /** Index 0–8 in die Growth-Charakter-Records. */
  charIndex: number;
  level: number;
  /** Gesamt-EXP (nicht „bis zum nächsten Level"). */
  exp: number;
  maxHp: number;
  maxMp: number;
}

/** 🔵 Levelabschnitt 0..7 (8 Kurvenpaare decken 2..99 ab). */
export function levelBracket(level: number): number {
  return Math.max(0, Math.min(7, Math.floor((level - 2) / 12.25)));
}

/**
 * 🔵 EXP-Schwelle: Gesamt-EXP, ab der `level` erreicht ist.
 * `expTotal(L) = Σ_{l=2..L} floor(gradient(l) · l² / 16)` — nutzt die
 * belegten Kurvengradienten (Basis der EXP-Kurven ist im Bestand 0),
 * ganzzahlig und strikt monoton, solange der Gradient nicht 0 ist.
 */
export function expTotalForLevel(growth: GrowthSection, charIndex: number, level: number): number {
  const curveIndex = growth.characters[charIndex]?.curveIndexes.exp;
  if (curveIndex === undefined) return Number.MAX_SAFE_INTEGER;
  const curve = growth.curves[curveIndex];
  if (!curve) return Number.MAX_SAFE_INTEGER;
  let total = 0;
  for (let l = 2; l <= level; l++) {
    const g = Math.max(1, curve.gradients[levelBracket(l)] ?? 1);
    total += Math.floor((g * l * l) / 16);
  }
  return total;
}

export interface LevelUpResult {
  levelsGained: number;
  hpGained: number;
  mpGained: number;
}

/**
 * Schreibt EXP gut und vollzieht Stufenaufstiege. 🔵 HP-/MP-Zuwachs je
 * Aufstieg kommt aus den belegten Gewinn-Tabellen (12 Einträge), indiziert
 * mit dem Levelabschnitt — die Original-Indizierung („Guideline-Differenz")
 * ist unbelegt.
 */
export function applyExperience(progress: CharacterProgress, gained: number, growth: GrowthSection): LevelUpResult {
  progress.exp += gained;
  const result: LevelUpResult = { levelsGained: 0, hpGained: 0, mpGained: 0 };
  while (progress.level < 99 && progress.exp >= expTotalForLevel(growth, progress.charIndex, progress.level + 1)) {
    progress.level++;
    const bracket = levelBracket(progress.level);
    const hp = growth.hpGain[bracket] ?? 0;
    const mp = growth.mpGain[bracket] ?? 0;
    progress.maxHp = Math.min(9999, progress.maxHp + hp);
    progress.maxMp = Math.min(999, progress.maxMp + mp);
    result.levelsGained++;
    result.hpGained += hp;
    result.mpGained += mp;
  }
  return result;
}
