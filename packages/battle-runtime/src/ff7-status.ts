import { zufallUnter, type Zufallszustand } from './ff7-zufall.js';

/**
 * Statusänderung: Laden, Immunität, Erfolgswurf — zahlengleich (§7.1–§7.3,
 * ADR-028).
 *
 * Damit schließt sich der Verweis, den {@link baueAffinitaetstabelle} offen
 * gelassen hatte: Platz 13 der Affinitätstabelle bekommt die Immunitätsmaske
 * von hier.
 */

/** Die drei Eimer des Statusmodus, plus „keiner". */
export const EIMER_ZUFUEGEN = 0;
export const EIMER_HEILEN = 1;
export const EIMER_UMSCHALTEN = 2;
export const EIMER_KEINER = 3;

/** Statusbits, die diese Datei liest. */
export const ST_TOD = 0;
export const ST_FROSCH = 11;
export const ST_MINI = 12;
export const ST_PEERLESS = 24;
export const ST_DEATH_FORCE = 28;
export const ST_RESIST = 29;

export interface Statusaenderung {
  inflict: number;
  cure: number;
  toggle: number;
  /** 0…252; `0xFF` bedeutet „nie gesetzt" und damit automatischer Erfolg. */
  rate: number;
  /** Nur beim Fangen-Sonderfall belegt (`statusMask` Bit 31). */
  battleTypeSel?: number;
}

/**
 * Statusänderung aus einem Datensatz laden (§7.1).
 *
 * Der Modus steckt in den oberen zwei Bits (`>>> 6`), die Rate in den unteren
 * sechs (`<< 2`, also 0…252). Eimer 3 heißt „keine Änderung" — und genau das
 * ist der Fall bei `modeAndRate === 0xFF`, weil `0xFF >>> 6 === 3`.
 *
 * ⚠️ **Der Fangen-Sonderfall schreibt die Rate NICHT.** Trägt `statusMask`
 * Bit 31, wird nur `inflict = 0x80000000` gesetzt und ein globaler Wähler
 * belegt; `rate` behält, was vorher darin stand. Da sie einmal je Aktion auf
 * `0xFF` vorbelegt wird, gelingt so ein Datensatz **automatisch**.
 */
export function ladeStatusaenderung(modeAndRate: number, statusMask: number, vorigeRate = 0xff): Statusaenderung {
  const aus: Statusaenderung = { inflict: 0, cure: 0, toggle: 0, rate: vorigeRate };
  const eimer = modeAndRate >>> 6;
  if (eimer >= EIMER_KEINER) return aus;

  if ((statusMask & 0x80000000) === 0) {
    aus.rate = (modeAndRate & 0x3f) << 2;
    if (eimer === EIMER_ZUFUEGEN) aus.inflict = statusMask;
    else if (eimer === EIMER_HEILEN) aus.cure = statusMask;
    else aus.toggle = statusMask;
  } else {
    aus.inflict = 0x80000000;
    aus.battleTypeSel = statusMask & 3;
  }
  return aus;
}

export interface ImmunitaetsEingabe {
  /** `ActorTiming +0x34`. Für Gegner `~SceneEnemy.statusImmunity`. */
  statusLock: number;
  /** `flags29 & 0x8` — verwandelt. */
  verwandelt?: boolean;
  /** Statuswort des Ziels. */
  status: number;
  /** `flags2 & 0x1000` — „kann nicht sterben". */
  kannNichtSterben?: boolean;
  /** `commandId !== 4` (Kommando 4 ist *Gegenstand*). */
  honourResistBits?: boolean;
  /** `(statusCure & 1) !== 0` — ein Wiederbelebungszauber. */
  allowRevive?: boolean;
  /** Platz des Ziels; nur `< 3` darf wiederbelebt werden. */
  slot: number;
  /** Sonderflags des Angriffs; ohne Bit `0x0080` entfällt jede Immunität. */
  specialFlags: number;
}

/**
 * Immunitätsmaske bauen (§7.2). Die Reihenfolge ist bindend — mehrere
 * Schritte schreiben in dieselben Bits.
 *
 * ⚠️ **Der letzte Schritt löscht alles.** Ohne Sonderflag `0x0080` gibt es
 * gar keine Immunität; das steht am Ende und überschreibt jede vorherige
 * Rechnung. Wer die Prüfung nach vorne zieht, spart nichts und ändert nichts —
 * wer sie vergisst, macht jeden Angriff wirkungslos, der Immunitäten
 * durchbrechen soll.
 */
export function baueImmunitaetsmaske(ein: ImmunitaetsEingabe): number {
  let imm = ein.statusLock;

  // Verwandelt: Verwirrung, Frosch und Berserk prallen ab.
  if (ein.verwandelt) imm |= 0x00800840;
  if (ein.honourResistBits !== false) {
    if (ein.status & (1 << ST_RESIST)) imm |= 0x5fffffff;
    if (ein.status & (1 << ST_DEATH_FORCE)) imm |= 0x00000001;
  }
  if (ein.status & (1 << ST_PEERLESS)) imm |= 0x7fffffff;
  // Hast und Verlangsamung sind immer gemeinsam immun.
  if (imm & 0x300) imm |= 0x300;
  // Ein Wiederbelebungszauber schlägt die Todesimmunität — aber nur in der Party.
  if (ein.slot < 3 && ein.allowRevive) imm &= ~1;
  if (ein.kannNichtSterben) imm |= 1;
  // Todesimmun heißt auch todesurteilsimmun.
  if (imm & 1) imm |= 0x00200000;
  if ((ein.specialFlags & 0x0080) === 0) imm = 0;
  return imm >>> 0;
}

export interface ErfolgsEingabe {
  rate: number;
  inflict: number;
  cure: number;
  toggle: number;
  targetStatus: number;
  targetSlot: number;
  targetFlags: number;
  targetCount: number;
  repeatCasts: number;
  bonusPercent: number;
  /** Maske der aus dem Kampf entfernten Plätze. */
  removedActorMask?: number;
}

/** Ab dieser Rate gelingt die Änderung ohne Wurf. */
export const RATE_SICHER = 0xfc;

/**
 * Erfolgswurf der Statusänderung (§7.3) — **die erste Ziehung eines
 * Treffers**, noch vor allem Elementaren.
 *
 * ⚠️ Gezogen wird **nur**, wenn die Rate unter 252 liegt. Das ist die eine
 * Stelle im Trefferablauf, an der eine Ziehung wirklich ausbleibt — überall
 * sonst fällt sie unbedingt. Wer hier zur Sicherheit zieht, verschiebt den
 * Strom genauso wie wer anderswo faul ist.
 */
export function wuerfleStatuserfolg(ein: ErfolgsEingabe, z: Zufallszustand): boolean {
  let rate = ein.rate;
  const union = ein.inflict | ein.cure | ein.toggle;

  // Betrifft die Änderung GENAU Frosch bzw. Mini, gelingt sie sicher.
  if ((ein.targetStatus & 0x0800) === union) rate = RATE_SICHER;
  if ((ein.targetStatus & 0x1000) === union) rate = RATE_SICHER;
  // Hast, Schild und Berserk landen auf einem Partymitglied immer.
  if (ein.targetSlot < 3 && union & 0x00900100) rate = RATE_SICHER;

  let ok = true;
  if (rate < RATE_SICHER) {
    rate = (rate + ((Math.imul(rate, ein.bonusPercent) / 100) | 0)) | 0;
    if ((ein.targetFlags & 0x0c) !== 0x04 && ein.targetCount > 1) rate = ((rate * 2) / 3) | 0;
    if (ein.repeatCasts !== 0) rate = rate >> 1;
    const r = zufallUnter(z, 100) & 0xff;
    // ⚠️ `rate <= r + 1`, nicht `rate < r`: Eine Rate von 1 scheitert immer.
    if (rate <= r + 1) ok = false;
  }
  if (union & 1 && (ein.removedActorMask ?? 0) & (1 << ein.targetSlot)) ok = false;
  return ok;
}
