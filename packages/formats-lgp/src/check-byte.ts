import { CHECK_BYTE_HRC, CHECK_BYTE_PLAIN } from './constants.js';

/**
 * Der „Check-Code" — 1 Byte je TOC-Eintrag (Offset name[20] + u32).
 *
 * Die Community-Quellen widersprechen sich („Prüfwert" gegen
 * „Ordnungshinweis"); vier Implementierungen lesen das Byte und verwenden es
 * nicht. Beide Hypothesen sind über den vollen Archivbestand der lokalen
 * Installation gemessen worden (45.563 TOC-Einträge, 56 Archive) und **beide
 * sind durchgefallen**:
 *
 *  - *Prüfwert:* Das Byte nimmt im ganzen Bestand genau **zwei** Werte an
 *    (0x0E: 44.797, 0x0B: 766) — Entropie 0,12 Bit. Achtzehn billige
 *    Funktionen über Name, Inhalt, Länge und Offset (Summe, XOR, vier CRC-8-
 *    Polynome, kleine Moduln) bleiben allesamt unter dem Nullmodell
 *    „immer 0x0E" und haben gegenüber ihrer eigenen Nachbarkontrolle keinen
 *    Vorsprung. Ein Prüfwert ist es nicht.
 *  - *Ordnungshinweis:* Nicht monoton (743 Abstiege), keine Blockstruktur
 *    (Wechselzahl 1,005× des Zufallserwartungswerts), keine Positionsfunktion
 *    (beste Reinheit über `tocIndex mod k` = exakt der Mehrheitsanteil, also
 *    kein Informationsgewinn). Ein Ordnungshinweis ist es auch nicht.
 *
 * Was trägt, ist die **Eintragsart**: 0x0B steht im gesamten Bestand genau auf
 * den `.hrc`-Einträgen (766/766, kein Gegenbeispiel in beide Richtungen), alle
 * übrigen 87 Endungen ausnahmslos auf 0x0E. Die Nachbarkontrolle derselben
 * Regel fällt auf der Minderheitsklasse von 100 % auf 3 %.
 *
 * **Was damit NICHT belegt ist** (🔵, bewusst nicht als Semantik ausgegeben):
 * warum der Packer das tut. Name und Inhalt sind hier nicht trennbar — jede
 * `.hrc`-Nutzlast beginnt mit `:HEADER_`, die Inhaltssignatur liefert dieselbe
 * Partition mit derselben Quote. Ob 0x0B „Skelettdatei", „Textdatei" oder
 * schlicht einen zweiten Packerlauf markiert, ist nicht entschieden.
 *
 * Deshalb ist die Prüfung **opt-in und ausschließlich warnend**
 * (`ScanOptions.validateCheckByte`). Die Regel ist eine über einen Bestand
 * gemessene Invariante, kein Formatfakt.
 */

/** Die beiden im Bestand belegten Werte. Alles andere ist unbelegt. */
export const KNOWN_CHECK_BYTES: readonly number[] = [CHECK_BYTE_PLAIN, CHECK_BYTE_HRC];

/** Endungen, die im Bestand ausnahmslos den Minderheitswert tragen. */
const HRC_SUFFIX = '.hrc';

/**
 * Der laut gemessener Invariante erwartete Check-Code eines Eintrags.
 * Erwartet einen bereits normalisierten (kleingeschriebenen) Namen.
 */
export function expectedCheckByte(name: string): number {
  return name.endsWith(HRC_SUFFIX) ? CHECK_BYTE_HRC : CHECK_BYTE_PLAIN;
}

/**
 * Abweichungsbefund oder `null`, wenn der Eintrag der Invariante entspricht.
 * Zwei unterscheidbare Fälle, weil sie verschieden schwer wiegen:
 *  - `unbekannt`: Wert außerhalb {0x0E, 0x0B} — im Bestand nie vorgekommen.
 *  - `art`: bekannter Wert, aber nicht der zur Eintragsart passende.
 */
export function checkByteDeviation(
  name: string,
  checkByte: number,
): { art: 'unbekannt' | 'art'; erwartet: number } | null {
  const erwartet = expectedCheckByte(name);
  if (checkByte === erwartet) return null;
  return { art: KNOWN_CHECK_BYTES.includes(checkByte) ? 'art' : 'unbekannt', erwartet };
}

/** Lesbare Hexdarstellung für Diagnosetexte. */
export function formatCheckByte(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}
