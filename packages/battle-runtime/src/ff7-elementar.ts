import type { SchadensKontext } from './ff7-schaden.js';
import { zufallUnter, type Zufallszustand } from './ff7-zufall.js';

/**
 * Der Elementarschritt — zahlengleich (§6.9–§6.12, ADR-028).
 *
 * Er läuft **zweimal** je Treffer: einmal vor dem Schadensprogramm
 * ({@link elementarVorSchaden}) und einmal unmittelbar danach
 * ({@link elementarNachSchaden}). Dazwischen liegt die Formel. Wer ihn als
 * einen Block hinter die Formel schiebt, verliert die Trefferquoten-
 * Skalierung und den Soforttod-Wurf.
 *
 * ## Die Affinitätscodes
 *
 * `elemReaction` ist ein Bitwort: Bit `i` steht für Affinitätscode `i`.
 * Belegt sind sechs davon:
 *
 * | Bit | Code | Wirkung |
 * |---|---|---|
 * | `0x01` | 0 | **Sofortiger Tod** |
 * | `0x02` | 1 | erzwingt den Treffer (sonst unbenannt) |
 * | `0x04` | 2 | **Schwäche** — Schaden ×2 |
 * | `0x10` | 4 | **Halbierung** — Schaden ÷2 |
 * | `0x20` | 5 | **Nichtigkeit** |
 * | `0x40` | 6 | **Absorption** |
 * | `0x80` | 7 | **volle Wiederherstellung** |
 *
 * Die Codes 1 und 3 bekommen hier **keinen Namen**, weil ihre Wirkung aus dem
 * gelesenen Abschnitt nicht hervorgeht — Code 1 taucht nur in der
 * Treffermaske `0x63` auf. Ein erfundener Name wäre schlimmer als keiner.
 *
 * 🟢 **Am Bestand nachgezählt** (422 belegte Affinitätspaare über 352
 * Gegnertypen): Es kommen die Codes `0, 1, 2, 4, 5, 6` vor — **Code 3 gar
 * nicht**. Die Lücke ist also keine unsere, sondern eine des Bestands: Es
 * gibt kein Beispiel, an dem sich etwas deuten ließe.
 *
 * ## Die Asymmetrie, die der Bestand eigens hervorhebt
 *
 * ⚠️ **Schwäche verdoppelt mit glatter Schiebung** (`d << 1`), **Halbierung
 * rundet AUF** (`(d + 1) >> 1`). Beides weicht von jeder anderen Halbierung
 * im System ab — die klemmen zur Null hin. Aus 5 wird verdoppelt 10 und
 * halbiert **3**, nicht 2.
 */

export const AFF_SOFORTTOD = 0x01;
export const AFF_ERZWUNGEN = 0x02;
export const AFF_SCHWACH = 0x04;
export const AFF_HALB = 0x10;
export const AFF_NICHTIG = 0x20;
export const AFF_ABSORB = 0x40;
export const AFF_VOLLHEILUNG = 0x80;
/** Maske der Codes, bei denen ein Treffer nicht danebengehen kann (§6.5/§6.6). */
export const AFF_TRIFFT_SICHER = 0x63;

/** Die sechs Kratzfelder, die ein Treffer mit sich führt (§6.12a). */
export interface TrefferKratz {
  workInflict: number;
  workCure: number;
  workToggle: number;
  workStatusUnion: number;
  elemReaction: number;
  damage: number;
}

export function leererKratz(): TrefferKratz {
  return { workInflict: 0, workCure: 0, workToggle: 0, workStatusUnion: 0, elemReaction: 0, damage: 0 };
}

/**
 * Nullt **genau sechs** Felder — und rührt `resultFlags`, `damageKind`,
 * `displayedDamage` und die Immunitätsmaske ausdrücklich **nicht** an
 * (§6.12a). Die Auslassung ist der Punkt: Ein „alles zurücksetzen" hier
 * verliert den Fehlschlag-Vermerk.
 */
export function loescheTrefferKratz(k: TrefferKratz): void {
  k.workInflict = 0;
  k.workCure = 0;
  k.workToggle = 0;
  k.workStatusUnion = 0;
  k.elemReaction = 0;
  k.damage = 0;
}

/** Ein Paar aus dem Gegnerrecord: Kennung (`+0x28+i`) und Affinitätscode (`+0x30+i`). */
export interface GegnerAffinitaet {
  id: number;
  code: number;
}

export interface AffinitaetsEingabe {
  /** Elementmaske des Angriffs. */
  attackElementMask: number;
  /** Vereinigung der Statusänderungen, die der Angriff vorhat. */
  statusChangeMask: number;
  /** Acht Paare aus dem Gegnerrecord — leer für Partymitglieder. */
  gegner?: readonly GegnerAffinitaet[];
  /** Für Partymitglieder: die drei Masken des Lebendblocks. */
  partyHalve?: number;
  partyInvalid?: number;
  partyAbsorb?: number;
  /** Statusimmunitätsmaske (§7.2) — landet in Platz 13. */
  statusImmunity?: number;
  /** Schild (Statusbit 20): absorbiert Elemente 0…8, nichtet 9…14. */
  hatSchild?: boolean;
  honourResistBits?: boolean;
  absorbElementMask?: number;
  nullifyElementMask?: number;
}

/**
 * Baut die 16-Platz-Tabelle (§6.9). Plätze 0…7 tragen **Element**masken je
 * Affinitätscode, Plätze 8…15 **Status**masken.
 *
 * ⚠️ Die Gegnerpaare packen beides in ein Byte: `id >> 5` wählt die Hälfte
 * (0 = Element, 1 = Status), `id & 0x1F` das Bit. Wer nur `id` als Bitnummer
 * liest, schreibt jede Statusaffinität in die Elementhälfte.
 */
export function baueAffinitaetstabelle(ein: AffinitaetsEingabe): number[] {
  const t = new Array<number>(16).fill(0);

  if (ein.gegner && ein.gegner.length) {
    for (const p of ein.gegner) {
      if (p.id === 0xff) continue;
      const haelfte = p.id >> 5;
      t[p.code + haelfte * 8]! |= 1 << (p.id & 0x1f);
    }
  } else {
    t[4] = ein.partyHalve ?? 0;
    t[5] = ein.partyInvalid ?? 0;
    t[6] = ein.partyAbsorb ?? 0;
  }

  t[13]! |= ein.statusImmunity ?? 0;

  if (ein.honourResistBits !== false && ein.hatSchild) {
    t[6]! |= 0x01ff; // Elemente 0…8 absorbieren
    t[5]! |= 0x7e00; // Elemente 9…14 nichten
  }
  t[6]! |= ein.absorbElementMask ?? 0;
  t[5]! |= ein.nullifyElementMask ?? 0;

  // Giftnichtigkeit (Elementbit 4) und Giftimmunität (Statusbit 3) bedingen
  // einander — eines von beiden zieht das andere nach sich.
  if (t[5]! & 0x10 || t[13]! & 0x08) {
    t[5]! |= 0x10;
    t[13]! |= 0x08;
  }

  for (let i = 0; i < 8; i++) {
    t[i]! &= ein.attackElementMask;
    t[i + 8]! &= ein.statusChangeMask;
    // Statusimmunität zählt NUR, wenn sie die ganze angeforderte Änderung
    // abdeckt — sonst fällt sie ersatzlos weg.
    if (i === 5 && t[13] !== ein.statusChangeMask) t[13] = 0;
  }
  return t;
}

/**
 * Faltet die Tabelle zu `elemReaction` (§6.10): Platz `i` setzt Bit `i & 7`.
 *
 * ⚠️ Zwei Sonderfälle, die leicht untergehen: Ein Angriff **mit** Stärke
 * ignoriert die Statusimmunität (Platz 13 wird geleert), und ohne Sonderflag
 * `0x0080` wird die ganze Reaktion verworfen — der Angriff kümmert sich
 * dann nicht um Affinitäten.
 */
export function falteAffinitaet(tabelle: readonly number[], power: number, specialFlags: number): number {
  const t = [...tabelle];
  if (power !== 0 && t[13] !== 0) t[13] = 0;
  let wort = 0;
  for (let i = 0; i < 16; i++) if (t[i] !== 0) wort |= 1 << (i & 7);
  return (specialFlags & 0x0080) === 0 ? 0 : wort;
}

/**
 * Elementarschritt **vor** dem Schadensprogramm (§6.11).
 *
 * Zieht Zufall **nur** im Soforttod-Fall auf einer Prozentformel — das ist
 * die einzige bedingte Ziehung im ganzen Trefferablauf und deshalb der eine
 * Fall, in dem faules Ziehen richtig ist.
 */
export function elementarVorSchaden(
  ctx: SchadensKontext & { hitRate: number },
  k: TrefferKratz,
  z: Zufallszustand,
): void {
  if (k.elemReaction & AFF_ABSORB) {
    const tausch = k.workCure;
    k.workCure = k.workInflict;
    k.workInflict = tausch;
    if (k.workInflict & 1) {
      k.workInflict &= ~1;
      k.elemReaction = AFF_SOFORTTOD;
    }
    if (k.workCure & 1) {
      k.workCure &= ~1;
      k.elemReaction = AFF_VOLLHEILUNG;
    }
  }

  // Sofortiger Tod auf einer Prozentformel muss einen d32-Wurf schlagen.
  const idx = ctx.formulaIndex ?? 0;
  if (k.elemReaction & AFF_SOFORTTOD && idx > 2 && idx < 5) {
    if (ctx.power <= (zufallUnter(z, 32) & 0xff)) {
      k.elemReaction = (k.elemReaction & ~AFF_SOFORTTOD) | AFF_NICHTIG;
    }
  }

  // Bei Stärke 0 skalieren Schwäche und Halbierung die TREFFERQUOTE statt
  // des Schadens — es gibt ja keinen.
  if (ctx.power === 0) {
    if (k.elemReaction & AFF_SCHWACH) ctx.hitRate = (ctx.hitRate << 1) | 0;
    if (k.elemReaction & AFF_HALB) ctx.hitRate = ctx.hitRate >> 1;
  }
}

export interface ZielLebenspunkte {
  curHp: number;
  maxHp: number;
  curMp: number;
  maxMp: number;
}

/**
 * Elementarschritt **nach** dem Schadensprogramm (§6.12).
 *
 * ⚠️ Die Asymmetrie: `d << 1` bei Schwäche (glatte Schiebung), `(d + 1) >> 1`
 * bei Halbierung (**aufrundend**). Jede andere Halbierung im System kürzt
 * zur Null hin — diese eine nicht.
 */
export function elementarNachSchaden(
  ctx: SchadensKontext & { displayedDamage?: number; elementMask?: number },
  k: TrefferKratz,
  ziel: ZielLebenspunkte,
): void {
  if ((k.elemReaction & AFF_ABSORB) === 0) {
    if (k.elemReaction & AFF_SCHWACH) k.damage = (k.damage << 1) | 0;
    if (k.elemReaction & AFF_HALB) k.damage = (k.damage + 1) >> 1;
  } else {
    ctx.damageKind ^= 0x1; // Absorption dreht Schaden in Heilung
  }

  if (k.elemReaction & AFF_SOFORTTOD) {
    if ((ctx.targetStatus & 1) === 0) {
      k.workInflict |= 1;
      k.workCure &= ~1;
      ctx.resultFlags &= ~0x2;
      ctx.damageKind &= ~0x1;
      ctx.displayedDamage = -2;
    } else {
      // Schon tot: gilt als Fehlschlag ohne Zahl.
      ctx.resultFlags |= 0x3;
      loescheTrefferKratz(k);
    }
  } else if (k.elemReaction & AFF_VOLLHEILUNG) {
    ziel.curHp = ziel.maxHp;
    ziel.curMp = ziel.maxMp;
    ctx.damageKind = 0x1;
    ctx.resultFlags &= ~0x2;
    k.workInflict &= ~1;
    ctx.displayedDamage = -3;
  } else if (k.elemReaction & AFF_NICHTIG) {
    if (k.workStatusUnion !== 0 || (ctx.elementMask ?? 0) & 0x08) ctx.resultFlags |= 1;
    loescheTrefferKratz(k);
  }
  ctx.damage = k.damage;
}
