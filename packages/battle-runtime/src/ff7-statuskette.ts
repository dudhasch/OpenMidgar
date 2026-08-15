/**
 * Die abgeleitete Statuskette — zahlengleich (§9, ADR-028).
 *
 * Von den sechs Grundwerten des Spielstands bis zu den vier Zahlen, mit denen
 * die Schadensformel rechnet. Ohne sie bleibt {@link schadenPhysisch} eine
 * Funktion ohne Eingaben.
 *
 * ## Der überraschendste Fakt der Kette
 *
 * 🟢 **Die Magieabwehr der Rüstung wird NIE addiert.** `magicDefense`
 * (Rüstung `+0x03`) existiert im Datensatz, wird von der Menüanzeige gelesen —
 * und von der Kampfrechnung ignoriert. Magieangriff ist *Magie plus Materia*,
 * Magieabwehr ist *Geist plus Materia*, beides ohne Ausrüstungsanteil.
 *
 * Eine Portierung, die die Magieabwehr der Rüstung mitrechnet, liegt bei
 * jedem magischen Treffer daneben — im Testvektor 11.8 um 4 Punkte, was rund
 * 2 % Schaden ausmacht. Der Fehler ist klein genug, um beim Spielen nicht
 * aufzufallen, und groß genug, um jede Zahlengleichheit zu verfehlen.
 *
 * ## Reihenfolge und Klemmung
 *
 * ```
 * Grundwert  = base[i] + sourceBonus[i] + Ausrüstungsbonus[i]     (auf 255 geklemmt)
 * Angriff    = Waffe.attackPower + Kraft                          (0…255)
 * Abwehr     = Rüstung.defense   + Widerstandskraft               (0…255)
 * MagAngriff = 0 + Magie                                          (0…255)
 * MagAbwehr  = 0 + Geist                                          (0…255)
 * ```
 *
 * Danach wird `Angriff` im Kämpfer auf **mindestens 1** gehoben — als
 * einziger der vier.
 *
 * ## Was hier fehlt und warum es sichtbar bleibt
 *
 * 🔴 **Materia.** Das Original addiert vor der Klemmung vorzeichenbehaftete
 * Materia-Deltas auf alle vier Werte (§12.2) und tauscht bei gesetztem
 * HP↔MP-Flag die beiden Maxima. Beides ist hier **nicht** umgesetzt; die
 * Deltas sind Parameter mit Vorgabe 0. Ein Platzhalter wäre schlimmer als
 * eine Lücke: Er sähe aus wie eine Antwort.
 */

/** Die sechs Grundwerte in Speicherreihenfolge. */
export const STAT_KRAFT = 0;
export const STAT_WIDERSTAND = 1;
export const STAT_MAGIE = 2;
export const STAT_GEIST = 3;
export const STAT_GESCHICK = 4;
export const STAT_GLUECK = 5;

/** Kennungen der acht Kampfprozentsätze (`statPct`). 6 und 7 sind unbenutzt. */
export const PCT_ANGRIFF = 0;
export const PCT_MAGANGRIFF = 1;
export const PCT_ABWEHR = 2;
export const PCT_MAGABWEHR = 3;
export const PCT_ABWEHRPROZENT = 4;
export const PCT_GESCHICK = 5;

export interface AusruestungsBonus {
  /** Bis zu vier Paare; Index > 5 wird **ignoriert**, nicht geklemmt. */
  index: readonly number[];
  /** Vorzeichenbehaftete Bytes (`i8`). */
  amount: readonly number[];
}

/**
 * Ausrüstungsboni auf einen Grundwertsatz addieren (§9.1a).
 *
 * ⚠️ Der Akkumulator ist ein **`u8` und läuft über** — keine breitere
 * Zwischengröße. Und Indizes 6…254 werden **ignoriert**, nicht geklemmt; im
 * Auslieferungsbestand kommt dort nur `0xFF` vor.
 */
export function addiereAusruestungsBonus(bonus: number[], b: AusruestungsBonus): void {
  const n = Math.min(b.index.length, b.amount.length);
  for (let i = 0; i < n; i++) {
    const idx = b.index[i]!;
    if (idx > 5) continue;
    bonus[idx] = (bonus[idx]! + b.amount[i]!) & 0xff;
  }
}

/** `i8`-Lesung eines Bytes — `statBoostAmount` ist vorzeichenbehaftet. */
export function alsI8(v: number): number {
  return (v << 24) >> 24;
}

export interface GrundwertEingabe {
  /** Sechs Werte aus dem Spielstand (`+0x02`…`+0x07`). */
  base: readonly number[];
  /** Sechs Quellen-Boni (`+0x08`…`+0x0D`). */
  sourceBonus: readonly number[];
  /** Boni aus Waffe, Rüstung und (wenn getragen) Accessoire. */
  ausruestung: readonly AusruestungsBonus[];
  /** Fluchring: `0x19`. Addiert pauschal +15/+15/+15/+15/+15/+10. */
  accessoryId?: number;
}

/** Fester Aufschlag des Fluchrings — im Original hart verdrahtet. */
export const FLUCHRING_ID = 0x19;
export const FLUCHRING_AUFSCHLAG = [15, 15, 15, 15, 15, 10] as const;

/** Stufe 1: die sechs wirksamen Grundwerte, jeder auf 255 geklemmt. */
export function grundwerte(ein: GrundwertEingabe): number[] {
  const bonus = [0, 0, 0, 0, 0, 0];
  for (const a of ein.ausruestung) addiereAusruestungsBonus(bonus, a);
  const total = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) total[i] = (ein.base[i] ?? 0) + (ein.sourceBonus[i] ?? 0) + bonus[i]!;
  if (ein.accessoryId === FLUCHRING_ID) {
    for (let i = 0; i < 6; i++) total[i]! += FLUCHRING_AUFSCHLAG[i]!;
  }
  return total.map((v) => Math.min(v, 255));
}

export interface AbgeleiteteWerte {
  attack: number;
  defense: number;
  magicAttack: number;
  magicDefense: number;
}

export interface AbleitungsEingabe {
  /** Ergebnis von {@link grundwerte}. */
  stat: readonly number[];
  /** Waffe `+0x04`. */
  weaponAttackPower: number;
  /** Rüstung `+0x02`. **Rüstung `+0x03` wird nicht gebraucht** — siehe Kopf. */
  armorDefense: number;
  /** Vorzeichenbehaftete Materia-Deltas (🔴 nicht umgesetzt, Vorgabe 0). */
  materiaDelta?: Partial<AbgeleiteteWerte>;
}

const klemme = (v: number): number => (v > 255 ? 255 : v < 0 ? 0 : v);

/** Stufe 3: die vier Kampfzahlen. */
export function abgeleiteteWerte(ein: AbleitungsEingabe): AbgeleiteteWerte {
  const d = ein.materiaDelta ?? {};
  return {
    attack: klemme(ein.weaponAttackPower + (d.attack ?? 0) + (ein.stat[STAT_KRAFT] ?? 0)),
    defense: klemme(ein.armorDefense + (d.defense ?? 0) + (ein.stat[STAT_WIDERSTAND] ?? 0)),
    // Kein Ausrüstungsanteil — das ist kein Versehen, siehe Kopfkommentar.
    magicAttack: klemme((d.magicAttack ?? 0) + (ein.stat[STAT_MAGIE] ?? 0)),
    magicDefense: klemme((d.magicDefense ?? 0) + (ein.stat[STAT_GEIST] ?? 0)),
  };
}

/**
 * Stufe 4: in den Kämpfer. Der einzige Unterschied zur Ableitung ist die
 * Untergrenze 1 auf `attack` — die anderen drei dürfen 0 sein.
 */
export function inKaempfer(w: AbgeleiteteWerte): AbgeleiteteWerte {
  return { ...w, attack: w.attack === 0 ? 1 : w.attack };
}

/**
 * Kampfprozentsatz anwenden (§9.4). `pct` ist ein `i8` in −100…+100.
 *
 * ⚠️ Die Division kürzt **zur Null hin** (x86 `IDIV`), nicht abwärts — bei
 * negativem `pct` ist das ein anderer Wert als `Math.floor`.
 */
export function wendeStatProzentAn(base: number, pct: number): number {
  return (base + ((Math.imul(base, pct) / 100) | 0)) | 0;
}

/**
 * Ausweichprozent (§9.5).
 *
 * ⚠️ Die Party-Grenze ist `< 4`, **nicht** `< 3`: Der unbenutzte Platz 3
 * nimmt den Party-Zweig. Wer hier `< 3` schreibt, bekommt für Platz 3 einen
 * anderen Wert — und Platz 3 kommt in der Aufstellung vor.
 */
export function ausweichProzent(
  platz: number,
  dexterity: number,
  defensePercent: number,
  pctAbwehrprozent = 0,
): number {
  const roh = platz < 4 ? (dexterity >> 2) + defensePercent : defensePercent;
  return wendeStatProzentAn(roh, pctAbwehrprozent);
}

/** Prozentsätze aufaddieren und klemmen (§9.4, `addStatPercentModifiers`). */
export function addiereStatProzent(statPct: number[], delta: number, slotMask: number): void {
  for (let i = 0; i < 8; i++) {
    if (!(slotMask & (1 << i))) continue;
    const v = (statPct[i] ?? 0) + delta;
    statPct[i] = v > 100 ? 100 : v < -100 ? -100 : v;
  }
}
