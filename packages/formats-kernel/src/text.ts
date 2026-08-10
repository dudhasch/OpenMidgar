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

/**
 * Feldtext-Funktionscodes (F29) — Bytes OBERHALB des linearen ASCII-Fensters.
 *
 * Herkunft zweigleisig, beides dokumentiert:
 *
 * 🟢 **Sichtabgleich gegen Original-Screenshots** (2026-08-10, Steam-Durchlauf,
 * dieselben Spieldateien): Der lineare Versatz bildete 0xB2/0xB3 auf `Ò`/`Ó`
 * ab — an exakt den Stellen, an denen das Original die typografischen
 * Anführungszeichen `“`/`”` zeigt (Referenz `20260810223255_1.jpg`:
 * `“C'mon newcomer.`). Ebenso stand zwischen Sprechername und Zitat ein
 * unbekanntes Byte, wo das Original einen **Zeilenumbruch** setzt (Referenz
 * `20260810223420_1.jpg`: `Biggs` ist eine eigene Zeile).
 *
 * 🟡 **Community-Tabelle (Kujata, char-map.js)** für die Belegung der
 * Funktionscodes: 0xE0 Auswahl-Einzug, 0xE1 Tab, 0xE7 Zeilenumbruch,
 * 0xE8 Seitenwechsel, 0xEA–0xF5 Namensplatzhalter, 0xD2–0xDF Farb-/
 * Effektcodes. Diese Belegungen sind gegen unsere Realdaten noch nicht
 * einzeln erhärtet; falsch belegte Codes fallen im Sichttest auf und sind
 * dann einzeln zu korrigieren.
 */
export const FIELD_NAME_SLOTS = [
  'Cloud',
  'Barret',
  'Tifa',
  'Aeris',
  'Red XIII',
  'Yuffie',
  'Cait Sith',
  'Vincent',
  'Cid',
  'Mitglied 1',
  'Mitglied 2',
  'Mitglied 3',
] as const;

/**
 * Sonderzeichen oberhalb des ASCII-Fensters (0x60–0xCF) — Belegung nach der
 * westlichen Tabelle des ff7tk-Toolkits (`FF7Text.h`, 🟡 gegen unsere
 * deutschen Realdaten noch nicht durchgemessen; die Anführungszeichen, `…`
 * und die Funktionscodes darunter sind rohbyte- bzw. sichtbelegt 🟢).
 * Wichtig: das lineare Fenster gilt nur bis 0x5E — die alte Annahme, es
 * reiche bis 0xBF, machte aus jedem Umlaut ein falsches Zeichen.
 */
const SONDERZEICHEN: Readonly<Record<number, string>> = {
  0x60: 'Ä', 0x61: 'Å', 0x62: 'Ç', 0x63: 'É', 0x64: 'Ñ', 0x65: 'Ö', 0x66: 'Ü', 0x67: 'á',
  0x68: 'à', 0x69: 'â', 0x6a: 'ä', 0x6b: 'ã', 0x6c: 'å', 0x6d: 'ç', 0x6e: 'é', 0x6f: 'è',
  0x70: 'ê', 0x71: 'ë', 0x72: 'í', 0x73: 'ì', 0x74: 'î', 0x75: 'ï', 0x76: 'ñ', 0x77: 'ó',
  0x78: 'ò', 0x79: 'ô', 0x7a: 'ö', 0x7b: 'õ', 0x7c: 'ú', 0x7d: 'ù', 0x7e: 'û', 0x7f: 'ü',
  0x87: 'ß', 0xa9: '…', 0xb0: '–', 0xb1: '—', 0xb2: '“', 0xb3: '”', 0xb4: '‘', 0xb5: '’',
  0xc2: '‚', 0xc3: '„',
};

/** Feldtext-Tabelle: ASCII-Fenster + Anführungszeichen + Funktionscodes. */
export function buildFieldTextTable(names: readonly string[] = FIELD_NAME_SLOTS): FfTextTable {
  const overrides: Record<number, string> = {
    // 🟢 Rohbyte-belegt (gameDebug.dialogRoh über del1, Strings 6–11):
    // eb e7 b2 = {Barret} + Zeilenumbruch + Anführung · b3 e8 b2 = Ende/Seite/Anfang ·
    // e7 e1 = Umbruch + Einzug der Fortsetzungszeile · a9 = Ellipse (…PUFF…)
    ...SONDERZEICHEN,
    // Funktionscodes (0xE0/E2–E4 🟡 ff7tk-Belegung, Rest rohbyte-belegt):
    0xe0: ' ', // {CHOICE}: Einzug einer Auswahlzeile
    0xe1: '\t',
    0xe2: ', ',
    0xe3: '.”',
    0xe4: '…”',
    0xe7: '\n',
    0xe8: '\n\n', // Seitenwechsel; die Demo zeigt Seiten als Absatz
    0xe9: '\n\n',
    // PS-Buttons (ff7tk: 0xF6–0xF9) — Symbole, KEINE Steuersequenzen: die
    // alte Deutung (Folgebyte überspringen) hätte echte Zeichen verschluckt.
    0xf6: '○',
    0xf7: '△',
    0xf8: '□',
    0xf9: '✕',
  };
  names.forEach((name, i) => {
    overrides[0xea + i] = name;
  });
  const table = buildAsciiTable(DEFAULT_ASCII_OFFSET, overrides);
  return {
    ...table,
    // Lineares Fenster nur bis 0x5E (ff7tk) — darüber Sonderzeichen, nicht
    // Latin-1: die alte Fenstergrenze 0xBF machte aus Umlauten Zufallszeichen.
    windows: [{ from: 0x00, to: 0x5e, offset: DEFAULT_ASCII_OFFSET }],
    // 0xFE leitet Mehrbyte-Sequenzen ein (Farben, Pause, Variablen).
    // 🟡 Vereinfachung: pauschal 1 Folgebyte; {PAUSEnnn}/{MEMORY} tragen mehr.
    controls: { 0xfe: 1 },
  };
}
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
