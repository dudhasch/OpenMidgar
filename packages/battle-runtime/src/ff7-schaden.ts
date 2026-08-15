/**
 * Schadensrechnung des Originals — zahlengleich (S31/ADR-028).
 *
 * ## Warum es dieses Modul neben `formulas.ts` gibt
 *
 * `formulas.ts` ist ein **Eigenentwurf**: in sich stimmig, reproduzierbar,
 * aber ausdrücklich **nicht zahlengleich**. Der Grund dafür war eine
 * Projektregel — Zusatzregel 4, „Kein Disassemblieren der Original-EXE" —,
 * und die ist mit **ADR-028 aufgehoben**. Was jahrelang als versperrt geführt
 * wurde, ist damit schlicht offen gewesen; dieses Modul löst es ein.
 *
 * Beide Sätze bleiben nebeneinander stehen: Der Eigenentwurf trägt Kämpfe
 * auch ohne Kenntnis der Originalzahlen, dieser Satz trifft sie.
 *
 * ## Herkunft und was davon belegt ist
 *
 * Bauplan aus der eigenen Codeanalyse (`spec/spec-battle-formulas.md` §3–§5,
 * `Battle_DecodeDamageCalcByte` `0x005D17C7`). **Ein Dekompilat ist ein
 * Bauplan, kein Beleg** — deshalb sind die beiden Tabellen unten am Abbild
 * nachgeschlagen und die Testvektoren des Bestands als Abrechnung
 * nachgerechnet, nicht übernommen.
 *
 * ## Die fünf Ganzzahl-Verhaltensweisen, an denen Portierungen scheitern
 *
 * Das Original ist 32-Bit-x86 aus MSVC. Im Schadenspfad kommen fünf
 * verschiedene Rundungen vor, und sie zu vermischen ist der übliche Weg,
 * unbemerkt abzuweichen:
 *
 * | Konstrukt | Bedeutung | hier |
 * |---|---|---|
 * | `IMUL r32, r32` | 32-Bit-Multiplikation, **läuft über** | `Math.imul` |
 * | `CDQ; AND EDX,n-1; ADD; SAR` | Division, **zur Null hin** gekürzt | {@link trunc32} |
 * | `SAR EAX, n` ohne Korrektur | arithmetische Schiebung = **Abrunden** | `>>` |
 *
 * Der Unterschied zwischen den letzten beiden zeigt sich **nur bei negativen
 * Werten** — und `damage` darf zwischendurch negativ werden (nichts klemmt
 * es vor §5.9 auf ≥ 0). Genau dort liegt die Falle.
 */

/** Statusbits, soweit die Schadensrechnung sie liest (§8.1). */
export const STATUS_SADNESS = 4;
export const STATUS_FROG = 11;
export const STATUS_SMALL = 12;
export const STATUS_PETRIFY = 14;
export const STATUS_BARRIER = 16;
export const STATUS_MBARRIER = 17;
export const STATUS_BERSERK = 23;
export const STATUS_PEERLESS = 24;
export const STATUS_LUCKY_GIRL = 30;

/** Maske, bei der ein Ziel gar keinen Schaden nimmt: Petrify | Peerless (§5.9). */
export const KEIN_SCHADEN_MASKE = 0x01004000;

/**
 * Vorzeichenbehaftete Division durch eine Zweierpotenz, **zur Null hin
 * gekürzt** — die x86-Folge `CDQ; AND EDX,pow2-1; ADD EAX,EDX; SAR EAX,k`.
 *
 * Für nichtnegative Werte identisch mit `>>`; für negative **nicht**. Beide
 * Formen kommen im Original vor, deshalb stehen beide hier nebeneinander.
 */
export function trunc32(a: number, pow2: number): number {
  a |= 0;
  return ((a + (a < 0 ? pow2 - 1 : 0)) / pow2) | 0;
}

/** Arithmetische Schiebung = Abrunden. Dort, wo das Original die Korrektur weglässt. */
export function sar(a: number, n: number): number {
  return (a | 0) >> n;
}

/**
 * 🟢 **Am Abbild gelesen** (`0x008FF068`, 16 Byte):
 * `01 01 00 01 00 00 03 02 00 00 05 01 00 00 00 00`.
 *
 * Index ist das hohe Nibble des Schadensbytes.
 * Bit 0 → physisch erzwingen · Bit 1 → Formel `|= 0x10` · Bit 2 → das niedere
 * Nibble wird eine Sondereffekt-ID und die Formel auf 1 festgenagelt.
 */
export const SCHADENSKLASSEN_FLAGS = Object.freeze([
  0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x03, 0x02, 0x00, 0x00, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * 🟢 **Am Abbild gelesen** (`0x007B7720`): `0a 0b 0c 0d 1e 1f 20 21 22` und
 * danach `00 00 00 00 00 80 3b`.
 *
 * ⚠️ **Abweichung zur Vorlage, hier ausdrücklich vermerkt.** Die Spezifikation
 * führt die Einträge 9…15 sämtlich als `0`. Das Abbild trägt ab Versatz 12 die
 * vier Bytes `00 00 80 3B` — das ist die **Fließkommakonstante `1/256`**, die
 * hinter der Tabelle liegt. Die Tabelle ist also 12 Byte lang, nicht 16.
 * Erreichbar wären die Einträge 14/15 nur über ein Schadensbyte `0xAE`/`0xAF`;
 * im Auslieferungsbestand kommt das nicht vor. Nachgebildet wird hier das
 * **Abbild**, nicht die Prosa — mit diesem Vermerk, damit der Unterschied
 * nicht später als Fehler gelesen wird.
 */
export const SONDEREFFEKT_AUS_LO = Object.freeze([
  0x0a, 0x0b, 0x0c, 0x0d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3b,
]);

/** Sonderflag-Bits, die die Schadensrechnung liest (§6.2). */
export const SF_MAGISCH = 0x0004;
export const SF_KEIN_ERZWUNGENER_KRIT = 0x2000;

export interface SchadensKontext {
  /** Das Schadensbyte selbst (`damageCalc`). */
  damageCalc: number;
  /** Sonderflags der Attacke bzw. Waffe; **wird beim Dekodieren verändert**. */
  specialFlags: number;
  targetFlags: number;
  resultFlags: number;
  /** Bit 1 (`0x2`) = kritisch, Bit 2 (`0x4`) = trifft MP statt HP. */
  damageKind: number;
  /** `modifierFlags & 1` = Rückenangriff. */
  modifierFlags: number;
  power: number;
  bonusPercent: number;
  repeatCasts: number;
  targetCount: number;
  attackerLevel: number;
  attackStat: number;
  defence: number;
  attackerStatus: number;
  targetStatus: number;
  /** `0x20` = Nahkampfkommando; entscheidet mit über die Reihenhalbierung. */
  commandKind: number;
  damage: number;
  /** Ergebnis des Dekodierens. */
  formulaGroup?: number;
  formulaIndex?: number;
  specialEffectId?: number;
}

export interface KampfteilnehmerLage {
  /** `flags2`: Bit `0x40` = hintere Reihe, Bit `0x20` = verteidigt. */
  flags2: number;
  /** Rückenangriffs-Faktor in Achteln (`SceneEnemy + 0xA2`; Party fest `0x10`). */
  backAttackMul8: number;
  level: number;
  luck: number;
}

/**
 * Schadensbyte aufteilen und die Klassenflags anwenden (§4.1,
 * `Battle_DecodeDamageCalcByte` `0x005D17C7`).
 *
 * ⚠️ **Die Reihenfolge trägt.** Die Klassenflags können `specialFlags` Bit 2
 * gerade eben gelöscht haben; erst danach entscheidet sich, ob der
 * Angriffswert der physische oder der magische ist. Wer den Angriffswert
 * vorher zieht, rechnet bei jeder physisch erzwungenen Magie falsch.
 *
 * Der Angriffswert selbst wird **nicht** hier gesetzt — er hängt an
 * `applyStatPercent` über der Kampfteilnehmertabelle. Zurückgegeben wird
 * stattdessen, **welcher** Wert zu nehmen ist.
 */
export function dekodiereSchadensbyte(ctx: SchadensKontext): { magisch: boolean } {
  const gruppe = (ctx.damageCalc & 0xf0) >> 4;
  ctx.formulaGroup = gruppe;
  ctx.formulaIndex = ctx.damageCalc & 0x0f;
  const flags = SCHADENSKLASSEN_FLAGS[gruppe]!;

  if (flags & 1) ctx.specialFlags &= ~SF_MAGISCH;
  if (flags & 2) ctx.formulaIndex |= 0x10;
  if (flags & 4) {
    ctx.specialEffectId = SONDEREFFEKT_AUS_LO[ctx.formulaIndex]!;
    ctx.formulaIndex = 1;
  }
  return { magisch: (ctx.specialFlags & SF_MAGISCH) !== 0 };
}

/** a) Trauer — **das Ziel** trägt sie. −30 %, gekürzt (§5.8a). */
export function wendeTrauerAn(ctx: SchadensKontext, d: number): number {
  if (ctx.targetStatus & (1 << STATUS_SADNESS)) {
    return (d - ((Math.imul(d, 3) / 10) | 0)) | 0;
  }
  return d;
}

/**
 * b) Aufteilung auf mehrere Ziele (§5.8b). `unterdruecken` entscheidet der
 * Aufrufer — die magische Formel setzt es **vor** der Rechnung aus den
 * Zielflags, die physische übergibt immer 0.
 */
export function wendeZielaufteilungAn(ctx: SchadensKontext, d: number, unterdruecken: number): number {
  let u = unterdruecken;
  if (u === 0 && (ctx.targetCount < 2 || ctx.targetFlags & 0x80)) u = 1;
  if (ctx.repeatCasts !== 0) return sar(d, 1);
  if (u === 0) return ((d << 1) / 3) | 0;
  return d;
}

/**
 * c) Barriere/Magiebarriere und der prozentuale Aufschlag (§5.8c).
 *
 * ⚠️ Die Halbierung hängt an **beiden** Ergebnisbits: Hat eine frühere Formel
 * eines gesetzt, halbiert auch die nächste.
 */
export function wendeBarriereUndAufschlagAn(ctx: SchadensKontext, d: number): number {
  if (ctx.specialFlags & SF_MAGISCH) {
    if (ctx.targetStatus & (1 << STATUS_MBARRIER)) ctx.resultFlags |= 0x8000;
  } else if (ctx.targetStatus & (1 << STATUS_BARRIER)) {
    ctx.resultFlags |= 0x4000;
  }
  let v = d;
  if (ctx.resultFlags & 0xc000) v = trunc32(v, 2);
  if (ctx.bonusPercent !== 0) v = (v + ((Math.imul(v, ctx.bonusPercent) / 100) | 0)) | 0;
  return v;
}

/**
 * d) Streuung (§5.8d) — **der einzige Zufallsverbraucher der Formeln**.
 *
 * `f = r + 0x0F01` liegt in 3841…4096, also **0,93774…1,0**: Die Streuung
 * kann nur mindern, nie mehren. Und sie **rundet ab** (`SAR`, keine
 * Kürzungskorrektur), weshalb es die Null-Wache braucht: Für `d = 1` und
 * `r < 255` ist das Produkt kleiner als 4096 und die Schiebung ergäbe 0.
 *
 * @param roll256 Der Wurf 0…255. Wird hereingereicht statt gezogen, damit die
 *   Rechnung rein bleibt (ADR-006: Replay-Bitgleichheit).
 */
export function wendeStreuungAn(d: number, roll256: number): number {
  const f = (roll256 & 0xff) + 0x0f01;
  const v = Math.imul(d, f) >> 12;
  return v === 0 ? 1 : v;
}

/**
 * Formel `0x01` — **die gesamte physische Kette** (§5.3). Die Schritte
 * stehen in genau dieser Reihenfolge; jede Umstellung ändert Zahlen.
 */
export function schadenPhysisch(
  ctx: SchadensKontext,
  angreifer: KampfteilnehmerLage,
  ziel: KampfteilnehmerLage,
  roll256: number,
): number {
  // 1. Erzwungener Kritischer. Bit 13 ist in JEDEM ausgelieferten Datensatz
  //    gesetzt, dieser Zweig feuert im Originalbestand also nie.
  if ((ctx.specialFlags & SF_KEIN_ERZWUNGENER_KRIT) === 0) ctx.damageKind |= 0x2;

  // 2. Grundschaden.
  const atk = ctx.attackStat | 0;
  const lvl = ctx.attackerLevel | 0;
  const base = (trunc32(Math.imul(lvl, atk), 32) * trunc32(lvl + atk, 32) + atk) | 0;

  // 3. Verteidigung und Stärke des Angriffs.
  let d = trunc32(Math.imul(Math.imul(base, (512 - ctx.defence) | 0), ctx.power), 8192);

  // 4. Kritischer: ×2.
  if (ctx.damageKind & 0x2) d = (d << 1) | 0;

  // 5. Berserk: ×1,5 — mit ABRUNDEN, nicht kürzen.
  if (ctx.attackerStatus & (1 << STATUS_BERSERK)) d = sar(Math.imul(d, 3), 1);

  // 6. Reihenhalbierung. Bei Fernangriffen entfällt sie ganz.
  let halb = (ziel.flags2 & 0x40) !== 0;
  if (ctx.targetFlags & 0x20 || ctx.commandKind === 0x20) {
    if (angreifer.flags2 & 0x40) halb = true;
  } else {
    halb = false;
  }
  if (halb) d = trunc32(d, 2);

  // 7. Ziel verteidigt.
  if (ziel.flags2 & 0x20) d = trunc32(d, 2);

  // 8. Rückenangriff: Faktor des ZIELS, in Achteln, abrundend.
  if (ctx.modifierFlags & 0x1) d = sar(Math.imul(d, ziel.backAttackMul8), 3);

  // 9. Frosch: ×1/4, abrundend.
  if (ctx.attackerStatus & (1 << STATUS_FROG)) d = sar(d, 2);

  // 10-12. Die drei gemeinsamen Nachbearbeiter, in dieser Reihenfolge.
  d = wendeTrauerAn(ctx, d);
  d = wendeZielaufteilungAn(ctx, d, 0);
  d = wendeBarriereUndAufschlagAn(ctx, d);

  // 13. Mini erzwingt 0 — die Streuung hebt es gleich darauf auf 1.
  if (ctx.attackerStatus & (1 << STATUS_SMALL)) d = 0;

  // 14. Streuung.
  d = wendeStreuungAn(d, roll256);
  ctx.damage = d;
  return d;
}

/**
 * Formel `0x02` — magischer Schaden (§5.4).
 *
 * Kein Reihenmodifikator, kein Berserk, kein Frosch, kein Mini. Und die
 * Unterdrückung der Zielaufteilung wird **zuerst** entschieden, aus den
 * Zielflags — nicht wie physisch aus der Zielzahl.
 */
export function schadenMagisch(ctx: SchadensKontext, roll256: number): number {
  const unterdruecken = (ctx.targetFlags & 0x0c) === 0x04 ? 1 : 0;
  const base = Math.imul((ctx.attackStat + ctx.attackerLevel) | 0, 6);
  let d = trunc32(Math.imul(Math.imul(base, (512 - ctx.defence) | 0), ctx.power), 8192);

  d = wendeTrauerAn(ctx, d);
  d = wendeZielaufteilungAn(ctx, d, unterdruecken);
  d = wendeBarriereUndAufschlagAn(ctx, d);
  d = wendeStreuungAn(d, roll256);
  ctx.damage = d;
  return d;
}

/**
 * Der Kritisch-Wurf (§6.7). `rate` darf negativ werden — dann erfüllt kein
 * Wurf aus 1…100 die Bedingung und es gibt nie einen Kritischen.
 *
 * ⚠️ `criticalBonus` wird **vorzeichenlos** gelesen: Das `0xFF` des Masamune
 * addiert 255 und garantiert damit den Kritischen.
 */
export function wuerfleKritisch(
  ctx: SchadensKontext,
  angreifer: KampfteilnehmerLage,
  ziel: KampfteilnehmerLage,
  criticalBonus: number,
  istPartyPlatz: boolean,
  roll1bis100: number,
): boolean {
  if (ctx.resultFlags & 1) return false; // schon danebengegangen
  let rate: number;
  if (ctx.attackerStatus & (1 << STATUS_LUCKY_GIRL)) {
    rate = 0xff;
  } else {
    rate = trunc32((ctx.attackerLevel + angreifer.luck - ziel.level) | 0, 4);
    if (istPartyPlatz) rate = (rate + (criticalBonus & 0xff)) | 0;
  }
  if (roll1bis100 <= rate) {
    ctx.damageKind |= 0x2;
    return true;
  }
  return false;
}

/** Vorgabe-Obergrenzen; bei gesetztem HP↔MP-Materiaflag vertauscht (§5.9). */
export const HP_OBERGRENZE = 9999;
export const MP_OBERGRENZE = 999;
/** „All Lucky 7s" — der Zähler des Angreifers steht auf diesem Wert. */
export const LUCKY_7S = 0x1e61;

export interface KlemmLage {
  /** HP-Obergrenze des Ziels; für Gegner fest {@link HP_OBERGRENZE}. */
  hpCap: number;
  mpCap: number;
  /** Ziel nimmt gar keinen Schaden (Immunität, Petrify oder Peerless). */
  nimmtKeinenSchaden: boolean;
  /** Angreifer steht auf 7777 HP. */
  luckySevens: boolean;
}

/**
 * Nachklemmung (§5.9) — läuft **einmal**, nach Formel und Elementarschritt.
 * Reihenfolge ist bindend: erst Obergrenze, dann Immunität, dann Lucky 7s.
 */
export function klemmeSchaden(ctx: SchadensKontext, lage: KlemmLage): number {
  const cap = ctx.damageKind & 0x4 ? lage.mpCap : lage.hpCap;
  if (cap < ctx.damage) ctx.damage = cap;
  if (lage.nimmtKeinenSchaden) ctx.damage = 0;
  if (ctx.damage !== 0 && lage.luckySevens) ctx.damage = LUCKY_7S;
  return ctx.damage;
}

/** Nimmt das Ziel überhaupt Schaden? (§5.9/§6.8) */
export function nimmtKeinenSchaden(zielStatus: number, immunGegenArt: boolean): boolean {
  return immunGegenArt || (zielStatus & KEIN_SCHADEN_MASKE) !== 0;
}

/** Bequemer Startkontext; alle Felder ausdrücklich, nichts implizit 0. */
export function leererKontext(teil: Partial<SchadensKontext> = {}): SchadensKontext {
  return {
    damageCalc: 0,
    specialFlags: 0,
    targetFlags: 0,
    resultFlags: 0,
    damageKind: 0,
    modifierFlags: 0,
    power: 0,
    bonusPercent: 0,
    repeatCasts: 0,
    targetCount: 1,
    attackerLevel: 1,
    attackStat: 0,
    defence: 0,
    attackerStatus: 0,
    targetStatus: 0,
    commandKind: 0,
    damage: 0,
    ...teil,
  };
}

/**
 * Formeln `0x03` / `0x04` — Anteil der aktuellen bzw. maximalen HP/MP (§5.5).
 *
 * `power / 32` ist der Bruch: 8 → 25 %, 16 → 50 %, 32 → 100 %. **Weder Trauer
 * noch Aufteilung, Barriere oder Streuung** greifen hier — die vier
 * Nachbearbeiter laufen bei diesen beiden Formeln gar nicht.
 */
export function schadenAnteil(ctx: SchadensKontext, aktuellerWert: number): number {
  let v = trunc32(Math.imul(aktuellerWert, ctx.power), 32);
  if (ctx.repeatCasts !== 0) v = sar(v, 1);
  ctx.damage = v;
  return v;
}

/** Wählt HP oder MP für {@link schadenAnteil}: Sonderflag Bit 0 heißt HP. */
export function anteilTrifftHp(ctx: SchadensKontext): boolean {
  return (ctx.specialFlags & 0x1) !== 0;
}

/** Formel `0x05` — die „flache" Formel (Heilzauber). Ohne Trauerabzug. */
export function schadenFlach(ctx: SchadensKontext, roll256: number): number {
  let v = (Math.imul((ctx.attackStat + ctx.attackerLevel) | 0, 6) + Math.imul(ctx.power, 22)) | 0;
  v = wendeZielaufteilungAn(ctx, v, 0);
  v = wendeBarriereUndAufschlagAn(ctx, v);
  v = wendeStreuungAn(v, roll256);
  ctx.damage = v;
  return v;
}

/** Formel `0x06` — schlicht `power · 20`. Kein Nachbearbeiter, keine Streuung. */
export function schadenKonstant(ctx: SchadensKontext): number {
  ctx.damage = Math.imul(ctx.power, 20);
  return ctx.damage;
}

/** Formel `0x07` — Stärke gegen Abwehr, **nur** Streuung. */
export function schadenGegenAbwehr(ctx: SchadensKontext, roll256: number): number {
  const v = trunc32(Math.imul(ctx.power, (512 - ctx.defence) | 0), 32);
  ctx.damage = wendeStreuungAn(v, roll256);
  return ctx.damage;
}

/**
 * Formel `0x08` — kein Schaden, sondern eine erzwungene Elementarreaktion.
 *
 * Absorbiert das Ziel (`0x40`), wird daraus Affinität 0 = **Sofortiger Tod**;
 * sonst Affinität 7 = **volle Wiederherstellung**. Die Formel dreht die
 * Wirkung also um, statt eine Zahl zu liefern.
 */
export function erzwingeElementarreaktion(elemReaction: number): number {
  return elemReaction & 0x40 ? 0x01 : 0x80;
}

/**
 * Formel `0x0A` — `power` auf die Ziele verteilt, **aufgerundet**.
 * `targetMask` ist eine 32-Bit-Maske; gezählt werden ihre gesetzten Bits.
 */
export function schadenAufgeteilt(ctx: SchadensKontext, targetMask: number): number {
  let n = 0;
  for (let m = targetMask >>> 0; m !== 0; m >>>= 1) n += m & 1;
  ctx.damage = n !== 0 ? (((ctx.power + n - 1) / n) | 0) : 0;
  return ctx.damage;
}
