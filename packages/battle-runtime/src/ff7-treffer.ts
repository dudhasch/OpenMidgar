import { trunc32, type SchadensKontext } from './ff7-schaden.js';
import { wurf1bis100, zufallUnter, type Zufallszustand } from './ff7-zufall.js';

/**
 * Der physische Trefferwurf — zahlengleich (§6.5, ADR-028).
 *
 * ## Die drei Stellen, an denen Portierungen still abweichen
 *
 * 1. **Beide Glückstests teilen sich EINEN Zug.** Wer zweimal zieht, bekommt
 *    an dieser Stelle vielleicht dasselbe Ergebnis und verschiebt danach den
 *    ganzen Strom.
 * 2. **Beide Züge fallen immer**, auch wenn der Treffer längst erzwungen ist.
 *    Ein „wir würfeln gar nicht erst"-Kurzschluss spart genau die Bytes ein,
 *    die alles Folgende verschieben.
 * 3. **Der Vergleich ist streng**: `wurf < rate` trifft. Eine Rate von exakt
 *    1 trifft deshalb **nie** — und genau darum liegt die Untergrenze bei 1
 *    und nicht bei 0.
 *
 * ⚠️ `rate` wird nach oben **nicht** geklemmt. Ein erzwungener Treffer trägt
 * `0xFF` = 255, und weil der Wurf nie über 100 geht, trifft er immer.
 *
 * ## Was dieses Modul NICHT entscheidet
 *
 * 🟡 Den **Rückenangriff**. Im Original leitet `resolveAttackFacing` ihn aus
 * drei 16-Bit-Seitenmasken und dem „schaut weg"-Bit der Beteiligten ab — das
 * ist Aufstellungszustand, den unsere Kampfsitzung noch nicht führt. Er wird
 * deshalb als Eingabe übergeben (`modifierFlags` Bit 0), nicht hier
 * hergeleitet. Solange die Aufstellung fehlt, ist er eine Vorgabe von außen.
 *
 * 🟡 Ebenso `hitRate`, `dexterity`, die beiden Ausweichwerte und die
 * Statusprozente: Sie kommen aus der abgeleiteten Statuskette (§9), die noch
 * nicht steht. Sie sind hier Parameter — das hält die Grenze sichtbar,
 * statt sie mit einem Platzhalter zu verwischen.
 */

/** Statusbits, bei denen ein physischer Treffer nicht danebengehen kann. */
export const TREFFER_ERZWINGENDE_STATUS = 0x02404445;
/** Davon werden diese durch den Treffer **geheilt** (Schlaf, Verwirrung, Manipulation). */
export const DURCH_TREFFER_GEHEILT = 0x00400044;
export const STATUS_FURY = 5;

export interface TrefferEingabe {
  /** Trefferquote des Angriffs (`accuracy`). */
  hitRate: number;
  /** Geschicklichkeit des Angreifers, bereits statusskaliert. */
  dexterity: number;
  /** Ausweichwert des Angreifers bzw. des Ziels (§9.5), bereits skaliert. */
  evadeAttacker: number;
  evadeTarget: number;
  luckAttacker: number;
  luckTarget: number;
  /** Platznummern: < 4 ist Party, > 3 ist Gegnerseite. */
  attackerSlot: number;
  targetSlot: number;
  /** Elementarreaktion; Bits `0x63` erzwingen den Treffer. */
  elemReaction: number;
}

export interface TrefferErgebnis {
  getroffen: boolean;
  /** Die Rate, mit der am Ende verglichen wurde — für Proben und Anzeige. */
  rate: number;
  /** Status, den dieser Treffer heilt (Schlaf/Verwirrung/Manipulation). */
  workCure: number;
}

/** −30 % auf die Trefferrate bei Wut — und **nur**, wenn sie nicht erzwungen ist. */
export function wendeWutabzugAn(attackerStatus: number, rate: number): number {
  if (rate < 0xff && attackerStatus & (1 << STATUS_FURY)) {
    return (rate - ((Math.imul(rate, 3) / 10) | 0)) | 0;
  }
  return rate;
}

/**
 * Physischer Trefferwurf. Verändert `ctx.resultFlags` (Bit 0 = daneben) und
 * zieht **immer genau zwei** Zufallsgrößen: einen `zufallUnter(100)` und
 * einen `wurf1bis100` (der wiederum zwei Tabellenbytes kostet).
 */
export function physischerTrefferwurf(
  ctx: SchadensKontext,
  ein: TrefferEingabe,
  z: Zufallszustand,
): TrefferErgebnis {
  let rate = -1;
  let workCure = 0;

  if (ctx.modifierFlags & 0x1) rate = 0xff; // Rückenangriff
  if (ein.elemReaction & 0x63) rate = 0xff; // Absorption/Immunität/Schwäche
  if (ctx.targetStatus & TREFFER_ERZWINGENDE_STATUS) {
    // Ein Treffer auf ein schlafendes, verwirrtes oder manipuliertes Ziel
    // kann nicht danebengehen UND hebt diesen Zustand auf.
    workCure |= ctx.targetStatus & DURCH_TREFFER_GEHEILT;
    rate = 0xff;
  }
  if (ctx.resultFlags & 0x20) rate = 0xff; // durch Deckung umgelenkt

  // Diese Terme werden UNBEDINGT ausgewertet, auch bei bereits erzwungenem
  // Treffer. Sie kosten keinen Zufall, aber ihre Reihenfolge liegt fest.
  const dexTerm = trunc32(ein.dexterity, 4);
  if (rate === -1) {
    rate = wendeWutabzugAn(
      ctx.attackerStatus,
      ((ein.hitRate + dexTerm + ein.evadeAttacker) - ein.evadeTarget) | 0,
    );
  }
  if (rate < 1) rate = 1; // Untergrenze NACH dem Erzwingen

  // EIN Zug, von beiden Glückstests geteilt — immer gezogen.
  const r = zufallUnter(z, 100) & 0xff;
  if (r < ein.luckAttacker >> 2) {
    rate = 0xff;
  } else if (ein.attackerSlot > 3 && ein.targetSlot < 3 && r < ein.luckTarget >> 2) {
    rate = 0;
  }

  // Immer gezogen — kostet zwei Tabellenbytes und meist einen Bankwechsel.
  const wurf = wurf1bis100(z);
  const getroffen = wurf < rate;
  if (!getroffen) ctx.resultFlags |= 1;
  return { getroffen, rate, workCure };
}

/** Statusbits, bei denen ein MAGISCHER Treffer nicht danebengehen kann (§6.6). */
export const MAG_TREFFER_ERZWINGENDE_STATUS = 0x02004445;
export const STATUS_REFLECT = 18;

export interface MagTrefferEingabe {
  /** Trefferquote des Angriffs. `>= 0xFF` heißt „kann nicht danebengehen". */
  hitRate: number;
  attackerLevel: number;
  targetLevel: number;
  /** Magieabwehr-Prozent des Ziels (Rüstung `+0x05`). */
  magicDefensePercent: number;
  elemReaction: number;
  /** Statusmaske, die der Angriff zufügen will; 0 = keiner. */
  statusInflict: number;
}

/**
 * Magischer Trefferwurf (§6.6).
 *
 * ⚠️ **Die fragilste Reihenfolge im ganzen System.** Beide Zufallsgrößen
 * werden **vor jeder vorzeitigen Rückkehr** gezogen — auch wenn feststeht,
 * dass der Angriff nicht danebengehen kann. Ein Dekoder, der faul zieht,
 * verschiebt den Strom für alles Folgende.
 *
 * Anders als physisch werden hier **zwei** `zufallUnter(100)` gezogen, nicht
 * einer plus ein `wurf1bis100` — die beiden Wege kosten also verschieden
 * viele Tabellenbytes.
 */
export function magischerTrefferwurf(
  ctx: SchadensKontext,
  ein: MagTrefferEingabe,
  z: Zufallszustand,
): { getroffen: boolean; rate: number } {
  let rate = ein.hitRate;
  const lvlTerm = (ein.attackerLevel - trunc32(ein.targetLevel, 2)) | 0;

  // UNBEDINGT, vor allen Abkürzungen.
  const r1 = zufallUnter(z, 100) & 0xff;
  const r2 = ((zufallUnter(z, 100) & 0xff) + 1) | 0;

  const trifftSicher =
    rate >= 0xff ||
    (ein.elemReaction & 0x63) !== 0 ||
    (!(ctx.specialFlags & 0x0200) && (ctx.targetStatus & (1 << STATUS_REFLECT)) !== 0) ||
    (ein.statusInflict === 0 && (ctx.targetStatus & MAG_TREFFER_ERZWINGENDE_STATUS) !== 0);
  if (trifftSicher) return { getroffen: true, rate };

  rate = wendeWutabzugAn(ctx.attackerStatus, rate);
  if (r1 < ein.magicDefensePercent || r2 >= rate + lvlTerm) {
    ctx.resultFlags |= 1;
    return { getroffen: false, rate };
  }
  return { getroffen: true, rate };
}
