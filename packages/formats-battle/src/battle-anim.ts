import { bdiag, type BattleDiagnostic } from './diagnostics.js';

/**
 * `<präfix>da` — die Animationsbank der Kampfmodelle (K9).
 *
 * **Warum es diesen Parser gibt.** Der größte verbliebene Sichtmangel der
 * 1.0-Demo: Alle Kampffiguren stehen in der Bindpose, Arme senkrecht nach
 * oben. Geometrie (K1/K2) und Skelett (S30) stehen; die Bewegung fehlte, weil
 * das Format unbekannt war.
 *
 * **Woher der Bauplan kommt.** Aus der eigenen Codeanalyse des PC-Abbilds
 * (ADR-028), nicht aus einer Fremdquelle. Vier Funktionen tragen ihn:
 *
 * | Adresse | Name | was sie beisteuert |
 * |---|---|---|
 * | `0x005E82DE` | `BattleModel_LoadAnimBank` | die **Satzkette** der Datei |
 * | `0x005E7DE4` | `BattleModel_DecodeAnimation` | Rahmenschleife, 4096→Grad |
 * | `0x005E7680` | `BattleModel_DecodeAnimFrame` | Schlüssel- vs. Deltarahmen |
 * | `0x005E7C40` / `0x005E7B7B` / `0x005E7CE4` | die drei Bitleser | die Packung |
 *
 * ---
 *
 * ## Die Datei
 *
 * ```
 * u32 animCount
 * je Animation:
 *   u32 jointCount     Wurzel + Knochen  (= Skelettknochen + 1)
 *   u32 frameCount
 *   u32 packedSize
 *   u8  packed[packedSize]
 * ```
 *
 * Die Kette ist die **Gütefunktion des Containers**: `4 + Σ (12 + packedSize)`
 * muss die Dateilänge **byteexakt** treffen. Ein falscher Versatz kann das
 * nicht zufällig.
 *
 * ## Der gepackte Block
 *
 * ```
 * +0x00 u16 kopfWort     Bedeutung offen (🔴) — der Dekoder liest ihn nie
 * +0x02 u16 stromBytes   Länge des Bitstroms ab +0x05 — das Abbruchmaß
 * +0x04 u8  shift        Quantisierung der Drehwinkel
 * +0x05 Bitstrom, MSB zuerst
 * ```
 *
 * `packedSize` ist die auf 4 aufgerundete Blocklänge:
 * `align4(5 + stromBytes)`, gemessen 7129/7130. Der eine Ausreißer (`rsda`,
 * Satz 15) ist zu groß, nicht zu klein — die Kette bleibt heil.
 *
 * **Leere Platzhalter.** 707 Sätze tragen `packedSize == 4` und
 * `stromBytes == 0`: zwei Wörter, **kein `shift`-Byte**, kein Strom. Das
 * Original merkt das nicht — es liest `shift` und die Winkelbits über die
 * Satzgrenze hinweg aus dem Folgesatz und erzeugt genau einen Rahmen aus
 * Nachbarbytes. Da dieser Rahmen von fremden Daten abhängt und nichts
 * bedeutet, gibt dieser Parser für solche Sätze `frames: []` mit
 * {@link BattleAnimation.leer} zurück, statt Unsinn nachzubauen.
 *
 * Winkel sind PSX-Einheiten: **4096 = Vollkreis**. Gespeichert werden
 * `12 − shift` Bits, danach um `shift` nach links geschoben — die Präzision
 * bleibt 12 Bit, die Auflösung sinkt auf `2^shift`.
 *
 * **Rahmen 0 ist der Schlüsselrahmen:** drei 16-Bit-Werte Wurzelverschiebung,
 * dann `jointCount` mal drei `12−shift`-Bit-Drehungen. Gelenk 0 ist die
 * **Wurzeldrehung**, Gelenk 1…n sind die Knochen.
 *
 * **Jeder weitere Rahmen ist ein Deltarahmen** — dieselbe Reihenfolge, aber
 * variable Längen, aufaddiert auf den Vorgänger (mit s16-Überlauf, wie im
 * Original).
 *
 * Verschiebungsdelta ({@link Bitstrom.liesVerschiebungsdelta}):
 * `0` + 7 Bit vorzeichenbehaftet, oder `1` + 16 Bit vorzeichenbehaftet.
 *
 * Drehdelta ({@link Bitstrom.liesDrehdelta}): ein Bit `0` heißt „unverändert".
 * Sonst folgen 3 Bit `k`:
 *
 * | `k` | Nutzlast | Wert |
 * |---|---|---|
 * | 0 | — | `−1 << shift` |
 * | 1…6 | `k` Bit vorzeichenbehaftet | `(v ± 2^(k−1)) << shift` |
 * | 7 | `12 − shift` Bit | `v << shift` |
 *
 * ## Die Gütefunktion der Packung
 *
 * Der Strom trägt **keine** Rahmenzahl: Das Original dekodiert, bis
 * `(bitCursor + 7) / 8` das Maß `stromBytes` erreicht, und schreibt jeden
 * Rahmen in einen mit `frameCount` bemessenen Puffer. Beides muss also genau
 * aufgehen — **die Zahl der dekodierten Rahmen muss `frameCount` treffen**.
 * Das ist keine Plausibilitätsprüfung, sondern eine Abrechnung: Jeder Fehler
 * in Bitbreite, Reihenfolge oder Deltacode verschiebt den Cursor und
 * verfehlt sie. Siehe {@link ANIM_MAX_JOINTS} für die zweite Abrechnung.
 *
 * ## Was hier ausdrücklich NICHT steht
 *
 * 🔴 `kopfWort` (`u16@0` des Blocks) — Bedeutung offen.
 *
 * ⚠️ Die Winkelnormierung ist die des Originals und **kein** sauberes
 * Modulo: negative Werte bekommen genau einmal `+0x1000`. Werte außerhalb
 * `[−4096, 4095]` bleiben außerhalb `[0, 4095]`. Nachgebildet wird das
 * Verhalten, nicht die Absicht.
 */

/** Kopf eines Animationssatzes in der Datei: `jointCount`, `frameCount`, `packedSize`. */
export const ANIM_SATZKOPF_LEN = 12;
/** Kopf des gepackten Blocks: `u16 kopfWort`, `u16 stromBytes`, `u8 shift`. */
export const ANIM_BLOCK_KOPF_LEN = 5;
/** PSX-Winkeleinheit: 4096 entspricht dem Vollkreis. */
export const PSX_VOLLKREIS = 4096;
/**
 * Obere Schranke der Gelenkzahl. Das Original dekodiert in einen mit 500
 * dwords bemessenen Kratzpuffer bei einer Satzbreite von `0x28` Byte —
 * das sind **genau 50 Sätze**. Mehr Gelenke würden über den Puffer laufen.
 */
export const ANIM_MAX_JOINTS = 50;

export interface BattleAnimFrame {
  /** Wurzelverschiebung als s16-Tripel, ungeskaliert (Original teilt durch 1.0f). */
  rootTranslation: [number, number, number];
  /**
   * Drehungen in PSX-Einheiten, normiert wie im Original. Länge `3 · jointCount`;
   * Index 0…2 ist die **Wurzel**, danach je Knochen drei Werte.
   */
  rotations: Int32Array;
}

export interface BattleAnimation {
  /** Wurzel + Knochen. Entspricht der Skelettknochenzahl + 1. */
  jointCount: number;
  /** Rahmenzahl aus dem Satzkopf — vom Dekoder byteexakt bestätigt. */
  frameCount: number;
  /** Quantisierung der Drehwinkel (`u8@4` des Blocks). */
  shift: number;
  /** `u16@0` des Blocks — Bedeutung offen (🔴). */
  kopfWort: number;
  /** `u16@2` des Blocks: Länge des Bitstroms ab `+0x05`. */
  stromBytes: number;
  /** `packedSize` aus dem Satzkopf. */
  packedSize: number;
  /** Platzhaltersatz ohne Bitstrom (`stromBytes == 0`) — `frames` ist dann leer. */
  leer: boolean;
  frames: BattleAnimFrame[];
}

export interface BattleAnimBank {
  animations: BattleAnimation[];
}

export interface ParseBattleAnimResult {
  bank: BattleAnimBank | null;
  diagnostics: BattleDiagnostic[];
}

/** s16-Abschneidung — das Original rechnet die Deltas in `short`, mit Überlauf. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * Winkelnormierung des Originals: genau ein `+0x1000` für negative Werte.
 * Bewusst **kein** `mod 4096` — siehe Kopfkommentar.
 */
function normiereWinkel(v: number): number {
  return v < 0 ? v + 0x1000 : v;
}

/**
 * MSB-zuerst-Bitleser über einem absoluten Versatz im Dateipuffer.
 *
 * Der absolute Puffer ist Absicht und keine Bequemlichkeit: Die beiden
 * Deltaleser holen sich pauschal 2 bzw. 3 Byte ab der aktuellen Byteposition,
 * auch wenn davon nur ein Teil zum Strom gehört. Über eine Kopie des Blocks
 * gelesen ergäbe das am Blockende andere Werte als im Original.
 */
export class Bitstrom {
  bit = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly basis: number,
  ) {}

  private byteAt(i: number): number {
    const at = this.basis + i;
    return at >= 0 && at < this.bytes.length ? this.bytes[at]! : 0;
  }

  /** `n` Bits, MSB zuerst, als vorzeichenbehaftete `n`-Bit-Zahl (`FUN_005E7C40`). */
  liesBits(n: number): number {
    let wert = 0;
    for (let i = 0; i < n; i++) {
      wert *= 2;
      if ((this.byteAt(this.bit >> 3) & (1 << (7 - (this.bit & 7)))) !== 0) wert += 1;
      this.bit++;
    }
    return (wert << (32 - n)) >> (32 - n);
  }

  /**
   * Verschiebungsdelta (`FUN_005E7B7B`): Führungsbit `0` → 7 Bit (8 Bit
   * insgesamt), Führungsbit `1` → 16 Bit (17 Bit insgesamt).
   */
  liesVerschiebungsdelta(): number {
    const i = this.bit >> 3;
    const b = this.bit & 7;
    const wort = (this.byteAt(i) << 8) | this.byteAt(i + 1);
    if ((wort & (1 << (15 - b))) === 0) {
      this.bit += 8;
      return s16((wort << (b + 1)) & 0xffff) >> 9;
    }
    const drei = (((wort << 8) | this.byteAt(i + 2)) >>> 0) << (b + 1);
    this.bit += 17;
    return s16((drei >>> 8) & 0xffff);
  }

  /** Drehdelta (`FUN_005E7CE4`): Präfixcode über `shift` quantisiert. */
  liesDrehdelta(shift: number): number {
    if (this.liesBits(1) === 0) return 0;
    const k = this.liesBits(3) & 7;
    if (k === 0) return -1 << shift;
    if (k === 7) return this.liesBits(12 - shift) << shift;
    const roh = this.liesBits(k);
    return (roh + (roh < 0 ? -(1 << (k - 1)) : 1 << (k - 1))) << shift;
  }
}

/**
 * Dekodiert einen gepackten Block vollständig. Gibt `null` zurück, sobald eine
 * Invariante fällt — nie ein Teilergebnis.
 */
function dekodiereBlock(
  bytes: Uint8Array,
  blockAb: number,
  jointCount: number,
  frameCount: number,
  packedSize: number,
  asset: string,
  index: number,
  diagnostics: BattleDiagnostic[],
): BattleAnimation | null {
  const fehler = (text: string): null => {
    diagnostics.push(bdiag('E-BTL-ANIM', asset, text, index));
    return null;
  };

  // Vier Byte reichen für die zwei Wörter — das `shift`-Byte fehlt bei
  // Platzhaltern, und ohne Strom wird es auch nicht gebraucht.
  if (packedSize < 4) return fehler(`packedSize ${packedSize} trägt nicht einmal zwei Wörter`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kopfWort = view.getUint16(blockAb, true);
  const stromBytes = view.getUint16(blockAb + 2, true);
  if (jointCount < 1 || jointCount > ANIM_MAX_JOINTS) {
    return fehler(`jointCount ${jointCount} außerhalb 1…${ANIM_MAX_JOINTS}`);
  }
  if (stromBytes === 0) {
    return { jointCount, frameCount, shift: 0, kopfWort, stromBytes, packedSize, leer: true, frames: [] };
  }

  if (packedSize < ANIM_BLOCK_KOPF_LEN) return fehler(`packedSize ${packedSize} < Blockkopf`);
  const shift = bytes[blockAb + 4]!;
  // `12 - shift` muss mindestens ein Bit übrig lassen, sonst dreht der
  // Bitleser leer und die Schleife käme nie voran.
  if (shift > 11) return fehler(`shift ${shift} lässt keine Winkelbits übrig`);
  if (ANIM_BLOCK_KOPF_LEN + stromBytes > packedSize) {
    return fehler(`stromBytes ${stromBytes} + Kopf überschreitet packedSize ${packedSize}`);
  }

  const strom = new Bitstrom(bytes, blockAb + ANIM_BLOCK_KOPF_LEN);
  const roh = new Int32Array(3 * jointCount);
  let tx = 0;
  let ty = 0;
  let tz = 0;
  const frames: BattleAnimFrame[] = [];

  for (;;) {
    if (strom.bit === 0) {
      tx = strom.liesBits(16);
      ty = strom.liesBits(16);
      tz = strom.liesBits(16);
      for (let j = 0; j < jointCount; j++) {
        for (let a = 0; a < 3; a++) roh[j * 3 + a] = s16(strom.liesBits(12 - shift) << shift);
      }
    } else {
      tx = s16(tx + strom.liesVerschiebungsdelta());
      ty = s16(ty + strom.liesVerschiebungsdelta());
      tz = s16(tz + strom.liesVerschiebungsdelta());
      for (let j = 0; j < jointCount; j++) {
        for (let a = 0; a < 3; a++) {
          roh[j * 3 + a] = s16(roh[j * 3 + a]! + strom.liesDrehdelta(shift));
        }
      }
    }

    const rotations = new Int32Array(3 * jointCount);
    for (let i = 0; i < rotations.length; i++) rotations[i] = normiereWinkel(roh[i]!);
    frames.push({ rootTranslation: [tx, ty, tz], rotations });

    if (stromBytes <= (((strom.bit + 7) >> 3) & 0xffff)) break;
    // Reißleine: ohne sie könnte ein missdeuteter Strom endlos laufen. Sie
    // greift nur, wenn die Abrechnung ohnehin verloren ist.
    if (frames.length > frameCount) {
      return fehler(`Bitstrom liefert mehr als ${frameCount} Rahmen`);
    }
  }

  /**
   * **Die Abrechnung.** Der Strom nennt seine Rahmenzahl nicht; sie steht im
   * Satzkopf. Trifft der Dekoder sie nicht auf den Rahmen genau, ist die
   * Packung falsch gedeutet — es gibt keine dritte Möglichkeit.
   */
  if (frames.length !== frameCount) {
    return fehler(`Rahmenabrechnung: ${frames.length} dekodiert, ${frameCount} erwartet`);
  }

  return { jointCount, frameCount, shift, kopfWort, stromBytes, packedSize, leer: false, frames };
}

/**
 * Liest eine Animationsbank (`<präfix>da`). Wie überall in diesem Paket:
 * Bei verletzter Invariante `null` plus Diagnose, kein Teilergebnis.
 */
export function parseBattleAnimBank(bytes: Uint8Array, asset: string): ParseBattleAnimResult {
  const diagnostics: BattleDiagnostic[] = [];
  const fehler = (text: string, index?: number): ParseBattleAnimResult => {
    diagnostics.push(bdiag('E-BTL-ANIM', asset, text, index));
    return { bank: null, diagnostics };
  };

  if (bytes.length < 4) return fehler(`kürzer als der Bankkopf (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const animCount = view.getUint32(0, true);
  if (animCount === 0) return fehler('animCount ist 0');
  // Jeder Satz braucht mindestens Kopf + Blockkopf; das schneidet Unsinn ab,
  // bevor die Schleife ihn ausrechnet.
  if (4 + animCount * (ANIM_SATZKOPF_LEN + ANIM_BLOCK_KOPF_LEN) > bytes.length) {
    return fehler(`animCount ${animCount} passt nicht in ${bytes.length} B`);
  }

  const animations: BattleAnimation[] = [];
  let at = 4;
  for (let i = 0; i < animCount; i++) {
    if (at + ANIM_SATZKOPF_LEN > bytes.length) return fehler(`Satz ${i}: Kopf liegt außerhalb`, i);
    const jointCount = view.getUint32(at, true);
    const frameCount = view.getUint32(at + 4, true);
    const packedSize = view.getUint32(at + 8, true);
    if (at + ANIM_SATZKOPF_LEN + packedSize > bytes.length) {
      return fehler(`Satz ${i}: packedSize ${packedSize} ragt über das Dateiende`, i);
    }
    if (frameCount === 0) return fehler(`Satz ${i}: frameCount ist 0`, i);

    const anim = dekodiereBlock(
      bytes,
      at + ANIM_SATZKOPF_LEN,
      jointCount,
      frameCount,
      packedSize,
      asset,
      i,
      diagnostics,
    );
    if (!anim) return { bank: null, diagnostics };
    animations.push(anim);
    at += ANIM_SATZKOPF_LEN + packedSize;
  }

  /** Containerabrechnung: die Satzkette muss das Dateiende exakt treffen. */
  if (at !== bytes.length) {
    return fehler(`Satzkette endet bei ${at}, Datei ist ${bytes.length} B`);
  }

  return { bank: { animations }, diagnostics };
}

/** PSX-Einheiten in Grad — die Umrechnung des Originals (`v / 4096 · 360`). */
export function winkelZuGrad(psx: number): number {
  return (psx / PSX_VOLLKREIS) * 360;
}
