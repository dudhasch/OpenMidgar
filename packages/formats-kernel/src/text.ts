/**
 * FF-Textkodierung (S13) — Dekoder für die Textsektionen von `kernel.bin`
 * und die Stringtabellen der Fields.
 *
 * **Clean-Room-Grundsatz:** Die Zeichentabelle ist hier keine abgeschriebene
 * Konstante, sondern eine *parametrisierte Hypothese*, die gegen die
 * Installation des Nutzers erhärtet wird. Die Vermutung ist ein einfacher
 * Versatz gegenüber ASCII; welcher Versatz gilt, entscheidet die Messung
 * `germanLikeness` über den Gesamtbestand — die richtige Auslegung erzeugt
 * deutschen Text, jede falsche erzeugt Rauschen.
 *
 * Ausgegeben werden in Berichten ausschließlich Kennzahlen, nie Text.
 */

/** Ein Fenster von Bytewerten, das linear auf Unicode-Codepunkte abbildet. */
export interface AsciiWindow {
  from: number;
  to: number;
  /** Zielcodepunkt = Byte + offset. */
  offset: number;
}

export interface FfTextTable {
  /** Lineare Fenster (schnell, deckt den Großteil ab). */
  windows: AsciiWindow[];
  /** Einzelabweichungen, u. a. Umlaute — Byte → Zeichen. */
  overrides: Readonly<Record<number, string>>;
  /** Bytes, die eine Zeichenkette beenden. */
  terminators: readonly number[];
  /** Bytes, die eine Steuersequenz einleiten, mit Anzahl Folgebytes. */
  controls: Readonly<Record<number, number>>;
}

/**
 * Basistabelle: ein linearer ASCII-Versatz. `offset` ist der Kandidat, den die
 * Ableitung bestimmt — 0x20 („Byte 0 ist das Leerzeichen") ist die
 * Ausgangsvermutung.
 */
export function buildAsciiTable(offset: number, overrides: Record<number, string> = {}): FfTextTable {
  return {
    windows: [{ from: 0x00, to: 0xdf - offset, offset }],
    overrides,
    terminators: [0xff],
    controls: { ...DEFAULT_CONTROLS },
  };
}

/**
 * Versatz der Zeichentabelle — ✅ **aus den Realdaten abgeleitet** (S13), nicht
 * angenommen: Über alle 18 Textsektionen von `kernel.bin` gewinnt 0x20 die
 * Ableitung, und zwar in der deutschen wie in der englischen Fassung.
 *
 * Ein Messfallstrick, der beinahe zum Fehlschluss geführt hätte: Der scheinbare
 * Zweitplatzierte (Versatz 0) liegt nur 6 % zurück — aber nicht, weil er eine
 * ernsthafte Alternative wäre, sondern weil die Gütefunktion vor der Bewertung
 * kleinschreibt und ASCII-Groß-/Kleinbuchstaben genau 32 auseinanderliegen.
 * Versatz 0 ist also ein *Schatten* von 0x20, keine Konkurrenz. Gegen den
 * ersten davon unabhängigen Kandidaten beträgt der Abstand Faktor 1,64 (de)
 * bzw. 1,38 (en) — das ist der belastbare Wert.
 */
export const DEFAULT_ASCII_OFFSET = 0x20;

/**
 * Steuerbytes. 0xFE ist die dokumentierte Steuersequenz.
 *
 * 🟡 0xF8 und 0xF9 sind die mit Abstand häufigsten *unerklärten* Bytes im
 * Bestand (594 bzw. 164 Fundstellen gegenüber 5–11 für alle übrigen). Sie
 * hier als einbytige Steuersequenzen zu führen, ist eine Hypothese — sie
 * senkt den Anteil unbekannter Bytes messbar, ist aber nicht bewiesen. Wer
 * die Textausgabe pixelgenau braucht, muss sie einzeln klären.
 */
export const DEFAULT_CONTROLS: Readonly<Record<number, number>> = { 0xfe: 1, 0xf8: 1, 0xf9: 1 };

export interface DecodedText {
  text: string;
  /** Bytes ohne Zuordnung — als Zähler, nicht als Inhalt. */
  unknownBytes: number;
  /** Übersprungene Steuersequenzen. */
  controlCount: number;
  /** true, wenn ein Terminator erreicht wurde (sonst: Puffer erschöpft). */
  terminated: boolean;
}

/**
 * Dekodiert eine Zeichenkette ab `start`. Unbekannte Bytes werden gezählt und
 * durch U+FFFD ersetzt — nie stillschweigend verworfen, damit die
 * Vollständigkeitsmessung ehrlich bleibt.
 */
export function decodeFfText(bytes: Uint8Array, table: FfTextTable, start = 0, maxLen = 4096): DecodedText {
  let text = '';
  let unknownBytes = 0;
  let controlCount = 0;
  let terminated = false;
  for (let i = start; i < bytes.length && i - start < maxLen; i++) {
    const b = bytes[i]!;
    if (table.terminators.includes(b)) {
      terminated = true;
      break;
    }
    const skip = table.controls[b];
    if (skip !== undefined) {
      controlCount++;
      i += skip;
      continue;
    }
    const override = table.overrides[b];
    if (override !== undefined) {
      text += override;
      continue;
    }
    const win = table.windows.find((w) => b >= w.from && b <= w.to);
    if (win) {
      text += String.fromCharCode(b + win.offset);
      continue;
    }
    unknownBytes++;
    text += '�';
  }
  return { text, unknownBytes, controlCount, terminated };
}

/**
 * Maß dafür, wie sehr ein Text nach deutschem Fließtext aussieht — die
 * Gütefunktion der Tabellenableitung.
 *
 * Bewertet werden drei sprachunabhängig messbare Eigenschaften: der Anteil
 * echter Buchstaben, die Häufigkeit der im Deutschen dominanten Buchstaben
 * und das Vorkommen typischer Bigramme. Eine falsche Zeichentabelle erzeugt
 * gleichverteiltes Rauschen und fällt bei allen dreien durch.
 *
 * Die Funktion sieht Text, gibt aber nur eine Zahl zurück — Berichte bleiben
 * damit inhaltsfrei.
 */
const GERMAN_LETTERS = 'enisratdhulcgmobwfkzvpjäöüß';
const GERMAN_BIGRAMS = ['en', 'er', 'ch', 'de', 'ei', 'te', 'in', 'nd', 'ie', 'ge', 'st', 'un'];

export function germanLikeness(text: string): number {
  if (text.length === 0) return 0;
  const lower = text.toLowerCase();
  let letters = 0;
  let common = 0;
  for (const ch of lower) {
    if (/[a-zäöüß]/.test(ch)) {
      letters++;
      if (GERMAN_LETTERS.indexOf(ch) >= 0 && GERMAN_LETTERS.indexOf(ch) < 12) common++;
    }
  }
  const letterShare = letters / text.length;
  const commonShare = letters > 0 ? common / letters : 0;
  let bigrams = 0;
  for (const bg of GERMAN_BIGRAMS) {
    let at = lower.indexOf(bg);
    while (at >= 0) {
      bigrams++;
      at = lower.indexOf(bg, at + 1);
    }
  }
  const bigramShare = Math.min(1, bigrams / Math.max(1, lower.length / 8));
  // Gleichgewichtet: keine der drei Eigenschaften allein ist überzeugend.
  return (letterShare + commonShare + bigramShare) / 3;
}

/**
 * Liest eine Stringtabelle: `count` u16-Offsets ab `pointerBase`, jeweils
 * relativ zu `pointerBase`, danach die Zeichenketten.
 */
export function decodeStringTable(
  bytes: Uint8Array,
  table: FfTextTable,
  pointerBase: number,
  count: number,
): DecodedText[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: DecodedText[] = [];
  for (let i = 0; i < count; i++) {
    const at = pointerBase + i * 2;
    if (at + 2 > bytes.length) break;
    const offset = pointerBase + view.getUint16(at, true);
    if (offset >= bytes.length) {
      out.push({ text: '', unknownBytes: 0, controlCount: 0, terminated: false });
      continue;
    }
    out.push(decodeFfText(bytes, table, offset));
  }
  return out;
}
