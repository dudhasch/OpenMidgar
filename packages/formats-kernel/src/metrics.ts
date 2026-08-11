/**
 * FF7-Textmetrik: aus Rohtextbytes die Fenstergröße rechnen.
 *
 * 🔵 **Die entscheidende Architekturaussage: FF7 bricht Text nicht um.**
 * Zeilenumbrüche stehen als Byte 0xE7 fest im Text, Seitenumbrüche als 0xE8.
 * Die Fenstergröße folgt dem Text, nicht umgekehrt:
 *   Breite = längste Zeile + Polsterung,  Höhe = meiste Zeilen einer Seite.
 * Ein Layout, das selbst umbricht, erzeugt zwangsläufig andere Zeilen als das
 * Original — deshalb ist das hier eine reine **Messung**, kein Satzalgorithmus.
 *
 * Die Zahlen kommen aus zwei Quellen und sind entsprechend markiert:
 *   🟢 Zeichenbreiten — aus `WINDOW.BIN` des Nutzers gelesen.
 *   🟡 Polsterung, MAX-Breite, {CHOICE}/Tab-Einzüge, Zeilenhöhenformel —
 *      liegen in `ff7.exe` an Einzeloffsets, die wir nicht übernehmen; hier
 *      stehen die dokumentierten Standardwerte als Annahme.
 */

/** Textbytes mit Sonderbedeutung für die Breitenrechnung. */
export const TXT = {
  SPACE: 0x00,
  DIGIT_ZERO: 0x10,
  CAP_O: 0x2f,
  CHOICE: 0xe0,
  TAB: 0xe1,
  LIG_COMMA_SPACE: 0xe2,
  LIG_DOT_QUOTE: 0xe3,
  LIG_ELLIPSIS_QUOTE: 0xe4,
  NEWLINE: 0xe7,
  NEWPAGE: 0xe8,
  NAME_FIRST: 0xea,
  NAME_LAST: 0xf2,
  PARTY_FIRST: 0xf3,
  PARTY_LAST: 0xf5,
  FUNC: 0xfe,
  END: 0xff,
} as const;

/** Zweitbytes der 0xFE-Funktionen, die die Breite beeinflussen. */
const FN_WAIT = 0xdd;
const FN_MEM1 = 0xde;
const FN_MEM2 = 0xe1;
const FN_MEM3 = 0xe2;
const FN_MAX = 0xe9;

/** 🟢 Zeichen des Auslassungspunkts `…` in der westlichen Tabelle. */
const CODE_ELLIPSIS = 0xa9;
/** 🟢 Zeichen `"` (Byte 0x02 ⇒ ASCII 0x22). */
const CODE_QUOTE = 0x02;
/** 🟢 Zeichen `,` (Byte 0x0C ⇒ ASCII 0x2C). */
const CODE_COMMA = 0x0c;
/** 🟢 Zeichen `.` (Byte 0x0E ⇒ ASCII 0x2E). */
const CODE_DOT = 0x0e;

export interface FfSpacing {
  /** Vorschub je Textbyte in Pixeln (256 Einträge). */
  widths: Uint8Array;
  /** 🟡 Zeichenbreite im MAX-Modus, **halbiert** angewandt. Standard 26. */
  maxWidth: number;
  /** 🟡 Fensterpolsterung; Startwert jeder Zeile. Standard 16. */
  padding: number;
  /** 🟡 {CHOICE}-Einzug, gezählt in Leerzeichen. Standard 10. */
  choiceSpaces: number;
  /** 🟡 Tab-Einzug, gezählt in Leerzeichen. Standard 4. */
  tabSpaces: number;
  /** 🟡 Höhe = Zeilen × rowStep + rowBase. */
  rowStep: number;
  rowBase: number;
}

/**
 * Werte, die in `ff7.exe` liegen. Deren Offsets sind Fremdarbeit und werden
 * nicht übernommen — stattdessen sind die Werte, wo möglich, **am Bestand
 * gemessen**.
 *
 * 🟢 `padding = 20`. Die Fremdbeschreibung nennt 0x10 = 16 als Standard; das
 * ist für diese Installation **falsch**. Gemessen über 9 417 Dialoge mit
 * bekannter Fenstergröße aus 702 Fields (Vorhersage = deklarierte `w` des
 * WINDOW-Opcodes): Trefferquote 0,38 % bei 19 px, **38,90 % bei 20 px**,
 * 6,99 % bei 21 px. Ein Spitzenwert von Faktor 100 gegen den Nachbarwert ist
 * keine Anpassung, sondern eine Ablesung.
 *
 * 🟡 `maxWidth`, `choiceSpaces`, `tabSpaces`, `rowStep`, `rowBase` bleiben
 * angenommene Standardwerte — sie kommen in zu wenigen Dialogen vor, um sie
 * so zu messen ({CHOICE}: 53 Fälle).
 */
export const EXE_DEFAULTS = {
  maxWidth: 26,
  padding: 20,
  choiceSpaces: 10,
  tabSpaces: 4,
  rowStep: 16,
  rowBase: 25,
} as const;

/** 🟢 Harte Grenzen des Originals. */
export const FF_MAX_LINES = 13;
export const FF_MAX_HEIGHT_PX = 217;

/**
 * Namenslänge, mit der die Platzhalter 0xEA–0xF5 bemessen werden.
 * Charakternamen sind umbenennbar; die Fenster des Originals müssen den
 * **schlimmsten Fall** fassen, also 9 Zeichen der breitesten Sorte.
 */
export const NAME_SLOT_CHARS = 9;

/**
 * Breite eines Namensplatzhalters — 🟢 **gemessen und dann hergeleitet**.
 *
 * Gemessen: Über 4 830 Dialoge mit Namensplatzhalter springt die
 * Trefferquote gegen die deklarierten Fensterbreiten bei genau 117 px von
 * 21,4 % auf 44,7 % (Nachbarwerte 116 und 118: 21,4 % / 24,4 %).
 *
 * Hergeleitet: 117 = 9 × 13, und **13 ist die größte Zeichenbreite der
 * Tabelle** — in der deutschen wie in der englischen Fassung, beide Male am
 * selben Zeichen 0xC4. Der Wert ist damit keine Konstante, sondern fällt aus
 * den Daten heraus: neun Zeichen der breitesten Sorte.
 *
 * ⚠️ Nebenbefund: Nimmt man die Breiten *einschließlich* der oberen Bits
 * (siehe `decodeGlyphWidth`), läge das Maximum bei 14 (de) bzw. 15 (en) und
 * die Herleitung ginge nicht auf. Die Namensbemessung des Originals rechnet
 * also mit den unteren 5 Bit — ein Indiz gegen die additive Auslegung für
 * die wenigen Einträge mit gesetzten oberen Bits (🔴 nicht abschließend).
 */
export function nameSlotWidthFrom(glyphBytes: Uint8Array): number {
  let widest = 0;
  for (let i = 0; i < Math.min(0xe0, glyphBytes.length); i++) {
    widest = Math.max(widest, glyphBytes[i]! & 0x1f);
  }
  return NAME_SLOT_CHARS * widest;
}

/**
 * Baut die Arbeitstabelle aus 256 rohen Glyphenbreiten.
 *
 * Überschrieben werden genau die Bytes, die keine Glyphe sind: die drei
 * Ligaturen (Summe ihrer Bestandteile), die Namensplatzhalter und die beiden
 * Einzüge. Alles andere bleibt so, wie `WINDOW.BIN` es sagt.
 */
export function spacingTableFrom(
  glyphWidths: Uint8Array,
  opts: Partial<Omit<FfSpacing, 'widths'>> & {
    nameWidth?: number;
    /** Rohbytes der Tabelle — nötig, um die Namensbreite herzuleiten. */
    rawGlyphBytes?: Uint8Array;
  } = {},
): FfSpacing {
  const widths = new Uint8Array(256);
  widths.set(glyphWidths.subarray(0, 256));
  const padding = opts.padding ?? EXE_DEFAULTS.padding;

  widths[TXT.LIG_COMMA_SPACE] = widths[TXT.SPACE]! + widths[CODE_COMMA]!;
  widths[TXT.LIG_DOT_QUOTE] = widths[CODE_DOT]! + widths[CODE_QUOTE]!;
  widths[TXT.LIG_ELLIPSIS_QUOTE] = widths[CODE_ELLIPSIS]! + widths[CODE_QUOTE]!;

  const nameWidth =
    opts.nameWidth ??
    (opts.rawGlyphBytes ? nameSlotWidthFrom(opts.rawGlyphBytes) : NAME_SLOT_CHARS * widths[TXT.CAP_O]!);
  for (let c = TXT.NAME_FIRST; c <= TXT.PARTY_LAST; c++) {
    widths[c] = Math.min(255, Math.max(0, nameWidth));
  }

  return {
    widths,
    maxWidth: opts.maxWidth ?? EXE_DEFAULTS.maxWidth,
    padding,
    choiceSpaces: opts.choiceSpaces ?? EXE_DEFAULTS.choiceSpaces,
    tabSpaces: opts.tabSpaces ?? EXE_DEFAULTS.tabSpaces,
    rowStep: opts.rowStep ?? EXE_DEFAULTS.rowStep,
    rowBase: opts.rowBase ?? EXE_DEFAULTS.rowBase,
  };
}

/**
 * Der bequeme Weg: Metrik direkt aus einer gelesenen `WINDOW.BIN`. Fehlt die
 * Breitentabelle, kommt `null` zurück — der Aufrufer muss den Rückfall dann
 * **bewusst** wählen und melden, statt ihn geschenkt zu bekommen.
 */
export function spacingFromWindowBin(
  win: { glyphWidths: Uint8Array; rawGlyphBytes: Uint8Array },
  opts: Partial<Omit<FfSpacing, 'widths'>> = {},
): FfSpacing | null {
  if (win.glyphWidths.length < 256) return null;
  return spacingTableFrom(win.glyphWidths, { ...opts, rawGlyphBytes: win.rawGlyphBytes });
}

/**
 * Rückfallmetrik, wenn `WINDOW.BIN` fehlt: jedes Zeichen 8 px. Sie ist
 * absichtlich grob und **muss** mit einer Diagnose einhergehen — ein stiller
 * Rückfall würde falsche Fenster erzeugen, die niemandem auffallen.
 */
export const FALLBACK_SPACING: FfSpacing = spacingTableFrom(
  Uint8Array.from({ length: 256 }, () => 8),
);

export interface FfMeasure {
  /** Fensterbreite in Pixeln (längste Zeile + Polsterung). */
  width: number;
  /** Zeilenzahl der zeilenreichsten Seite, gedeckelt bei 13. */
  lines: number;
  /** Fensterhöhe in Pixeln, gedeckelt bei 217. */
  height: number;
  /** Anzahl {NEW}-Seiten. */
  pages: number;
}

/** Höhe in Pixeln aus einer Zeilenzahl (Umkehrung: `linesFromHeight`). */
export function heightFromLines(lines: number, sp: FfSpacing): number {
  return Math.min(FF_MAX_HEIGHT_PX, lines * sp.rowStep + sp.rowBase);
}

export function linesFromHeight(px: number, sp: FfSpacing): number {
  return Math.min(FF_MAX_LINES, Math.max(1, Math.floor((px - sp.rowBase) / sp.rowStep)));
}

/**
 * Misst Rohtextbytes so, wie das Original sein Fenster bemisst.
 *
 * Der Ablauf folgt genau der Struktur der Textkodierung: 0xFE leitet eine
 * Funktion ein (davon ändern fünf die Breite), 0xE7/0xE8 schließen eine Zeile
 * bzw. Seite ab, 0xE0/0xE1 zählen in Leerzeichen statt in Pixeln, alles
 * andere ist eine Glyphe. Im MAX-Modus zählt jedes Zeichen die halbe
 * MAX-Breite — deshalb kann das Ergebnis krumm werden und wird aufgerundet.
 */
export function measureFfWindow(bytes: Uint8Array, sp: FfSpacing): FfMeasure {
  let lineWidth = sp.padding;
  let maxWidth = sp.padding;
  let maxMode = false;

  let lines = 1;
  let maxLines = 1;
  let pages = 1;

  const glyph = (code: number): number => (maxMode ? sp.maxWidth / 2 : sp.widths[code]!);

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === TXT.END) break;
    if (b === TXT.FUNC) {
      const fn = bytes[i + 1];
      i += 2;
      if (fn === undefined) break;
      if (fn === FN_MAX) maxMode = !maxMode;
      else if (fn === FN_WAIT) i += 2;
      else if (fn === FN_MEM1 || fn === FN_MEM2) {
        lineWidth += 5 * (maxMode ? sp.maxWidth : sp.widths[TXT.DIGIT_ZERO]!);
      } else if (fn === FN_MEM3) {
        const len = (bytes[i + 2] ?? 0) | ((bytes[i + 3] ?? 0) << 8);
        i += 4;
        lineWidth += len * (maxMode ? sp.maxWidth : sp.widths[TXT.CAP_O]!);
      }
      continue;
    }
    i++;
    if (b === TXT.NEWLINE || b === TXT.NEWPAGE) {
      maxWidth = Math.max(maxWidth, lineWidth);
      lineWidth = sp.padding;
      if (b === TXT.NEWLINE) {
        lines++;
      } else {
        maxLines = Math.max(maxLines, lines);
        lines = 1;
        pages++;
      }
      continue;
    }
    if (b === TXT.CHOICE) {
      lineWidth += sp.choiceSpaces * glyph(TXT.SPACE);
      continue;
    }
    if (b === TXT.TAB) {
      lineWidth += sp.tabSpaces * glyph(TXT.SPACE);
      continue;
    }
    lineWidth += glyph(b);
  }

  maxLines = Math.min(FF_MAX_LINES, Math.max(maxLines, lines));
  const width = Math.ceil(Math.max(lineWidth, maxWidth));
  return { width, lines: maxLines, height: heightFromLines(maxLines, sp), pages };
}

/**
 * Zerlegt Rohtextbytes in Seiten und Zeilen — **ohne** umzubrechen. Die
 * Rückgabe enthält Byte-Spannen, damit der Aufrufer selbst entscheidet, mit
 * welcher Zeichentabelle er dekodiert.
 */
export function splitFfText(bytes: Uint8Array): { pages: { start: number; end: number }[][] } {
  const pages: { start: number; end: number }[][] = [];
  let lines: { start: number; end: number }[] = [];
  let start = 0;
  let i = 0;
  const pushLine = (end: number): void => {
    lines.push({ start, end });
  };
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === TXT.END) break;
    if (b === TXT.FUNC) {
      const fn = bytes[i + 1];
      i += fn === FN_WAIT ? 4 : fn === FN_MEM3 ? 6 : 2;
      continue;
    }
    if (b === TXT.NEWLINE) {
      pushLine(i);
      start = i + 1;
    } else if (b === TXT.NEWPAGE) {
      pushLine(i);
      pages.push(lines);
      lines = [];
      start = i + 1;
    }
    i++;
  }
  pushLine(Math.min(i, bytes.length));
  pages.push(lines);
  return { pages };
}
