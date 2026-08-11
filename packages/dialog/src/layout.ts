import {
  FALLBACK_SPACING,
  measureFfWindow,
  spacingFromWindowBin,
  type FfSpacing,
} from '@webmidgar/formats-kernel';

/**
 * Fenster- und Textlayout (S15, Welle 2 überarbeitet).
 *
 * ⚠️ **Regelwechsel gegenüber Welle 1.** Dieses Modul hat Text bis dahin
 * *umgebrochen*: Wörter wurden auf eine vorgegebene Fensterbreite verteilt.
 * Das ist nicht, was FF7 tut. Belegt (docs/fremdquellen/touphscript.md §4.3
 * und nachgemessen an 9 417 Originaldialogen):
 *
 *   **FF7 hat keinen Autowrap.** Zeilenumbrüche stehen als Byte 0xE7 fest im
 *   Text, Seitenumbrüche als 0xE8. Die Fenstergröße folgt dem Text —
 *   Breite = längste Zeile + Polsterung, Höhe = meiste Zeilen einer Seite,
 *   Deckel 13 Zeilen.
 *
 * Wer umbricht, erzeugt zwangsläufig andere Zeilen als das Original. Das
 * Layout misst deshalb nur noch; `layoutText` bleibt als **ausdrücklich
 * markierter Ersatzweg** für bereits dekodierten Text ohne Steuerbytes
 * erhalten (Menü-Beschriftungen, Testtexte), ist aber nicht der Originalpfad.
 */

export interface GlyphMetrics {
  /** Breite je Zeichen in Pixeln; fehlt ein Zeichen, gilt `defaultWidth`. */
  widths: Readonly<Record<string, number>>;
  defaultWidth: number;
  lineHeight: number;
}

export interface WindowMetrics {
  /** Innenabstand links/oben/rechts/unten in Pixeln. */
  padding: [number, number, number, number];
  /** Sichtbare Zeilen je Seite. */
  linesPerPage: number;
}

/**
 * 🟡 Ersatzmetrik: gleichbreite Glyphen. Sie greift **nur**, wenn
 * `WINDOW.BIN` fehlt, und dann nicht stillschweigend — `glyphMetricsFrom`
 * liefert dazu eine Diagnose.
 */
export const FALLBACK_GLYPHS: GlyphMetrics = {
  widths: {},
  defaultWidth: 8,
  lineHeight: 16,
};

export const DEFAULT_WINDOW: WindowMetrics = {
  padding: [8, 8, 8, 8],
  linesPerPage: 3,
};

export interface DialogMetricsResult {
  spacing: FfSpacing;
  /** true = echte Tabelle aus WINDOW.BIN, false = Ersatzmetrik. */
  measured: boolean;
  /** Menschenlesbarer Grund, wenn auf die Ersatzmetrik zurückgefallen wurde. */
  diagnostic: string | null;
}

/**
 * Beschafft die Textmetrik. **Der Rückfall ist laut**: Ohne `WINDOW.BIN` gibt
 * es eine erklärte Ersatzmetrik samt Begründung, nie ein stilles „passt
 * schon". Genau daran ist in Welle 1 nicht aufgefallen, dass jedes Fenster
 * mit einer erfundenen Metrik bemessen wurde.
 */
export function dialogMetrics(
  win: { glyphWidths: Uint8Array; rawGlyphBytes: Uint8Array } | null,
): DialogMetricsResult {
  if (!win) {
    return {
      spacing: FALLBACK_SPACING,
      measured: false,
      diagnostic: 'WINDOW.BIN nicht geladen — Ersatzmetrik (8 px je Zeichen), Fenstergrößen sind Schätzwerte',
    };
  }
  const spacing = spacingFromWindowBin(win);
  if (!spacing) {
    return {
      spacing: FALLBACK_SPACING,
      measured: false,
      diagnostic: `WINDOW.BIN ohne brauchbare Breitentabelle (${win.glyphWidths.length} statt 256 Einträge) — Ersatzmetrik`,
    };
  }
  return { spacing, measured: true, diagnostic: null };
}

/** Textbreite in Pixeln aus einer Zeichenmetrik (Ersatzweg, siehe oben). */
export function measureText(text: string, glyphs: GlyphMetrics): number {
  let width = 0;
  for (const ch of text) width += glyphs.widths[ch] ?? glyphs.defaultWidth;
  return width;
}

/**
 * Zeichenmetrik für bereits dekodierten Text aus der echten Breitentabelle.
 * Der Versatz ist derselbe wie in `formats-kernel/text.ts`: Byte + 0x20 =
 * ASCII, also ASCII − 0x20 = Byte.
 */
export function glyphMetricsFrom(spacing: FfSpacing, lineHeight = 32): GlyphMetrics {
  const widths: Record<string, number> = {};
  for (let byte = 0x00; byte <= 0x5e; byte++) {
    widths[String.fromCharCode(byte + 0x20)] = spacing.widths[byte]!;
  }
  return { widths, defaultWidth: spacing.widths[0x2f]!, lineHeight };
}

export interface LayoutOptions {
  /** Fensterbreite in Pixeln (Außenmaß). */
  width: number;
  glyphs?: GlyphMetrics | undefined;
  window?: WindowMetrics | undefined;
}

export interface TextPage {
  lines: string[];
}

export interface LaidOutText {
  pages: TextPage[];
  /** Breiteste gemessene Zeile — für die Fensterbreitenprüfung. */
  maxLineWidth: number;
  /** Wörter, die allein schon breiter als die Zeile sind (hart getrennt). */
  overlongWords: number;
}

export interface FfLayout {
  pages: TextPage[];
  /** Fensterbreite nach der Originalregel (längste Zeile + Polsterung). */
  width: number;
  /** Zeilen der zeilenreichsten Seite, gedeckelt bei 13. */
  lines: number;
  height: number;
}

/**
 * **Der Originalpfad.** Nimmt Text, dessen Zeilen- und Seitenumbrüche bereits
 * feststehen (`\n` bzw. `\f` im dekodierten Text, 0xE7/0xE8 im Rohtext), und
 * bemisst das Fenster danach. Es wird nichts umbrochen.
 *
 * Für die Breitenmessung wird der dekodierte Text wieder auf Bytes abgebildet;
 * Zeichen außerhalb des ASCII-Fensters bekommen die Breite von `O`. Wer
 * pixelgenau arbeiten muss, misst mit `measureFfWindow` direkt auf den
 * Rohbytes — dieser Weg hier ist für die UI, die ohnehin schon Text hat.
 */
export function layoutFfText(text: string, spacing: FfSpacing): FfLayout {
  const pages: TextPage[] = [];
  for (const rawPage of text.split('\f')) {
    pages.push({ lines: rawPage.split('\n').slice(0, 13) });
  }
  const bytes = encodeForMeasure(text);
  const m = measureFfWindow(bytes, spacing);
  return { pages, width: m.width, lines: m.lines, height: m.height };
}

/** Dekodierten Text zurück auf messbare Bytes bringen (ASCII − 0x20). */
function encodeForMeasure(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    if (ch === '\n') out.push(0xe7);
    else if (ch === '\f') out.push(0xe8);
    else {
      const code = ch.codePointAt(0)!;
      out.push(code >= 0x20 && code <= 0x7e ? code - 0x20 : 0x2f);
    }
  }
  return Uint8Array.from(out);
}

/**
 * Umbrechendes Layout — **kein Originalverhalten**, siehe Modulkopf. Bleibt
 * für dekodierte Texte ohne feste Umbrüche (Menüeinträge, Tests) und für
 * Fälle, in denen die Fensterbreite vorgegeben ist statt berechnet.
 *
 * Ein `\n` erzwingt einen Zeilenumbruch, ein `\f` eine neue Seite. Ein Wort,
 * das allein nicht in die Zeile passt, wird hart getrennt statt über den Rand
 * zu laufen — und dabei gezählt, damit eine zu schmale Metrik auffällt statt
 * still zu verstümmeln.
 */
export function layoutText(text: string, opts: LayoutOptions): LaidOutText {
  const glyphs = opts.glyphs ?? FALLBACK_GLYPHS;
  const win = opts.window ?? DEFAULT_WINDOW;
  const inner = Math.max(1, opts.width - win.padding[0] - win.padding[2]);

  const pages: TextPage[] = [];
  let lines: string[] = [];
  let maxLineWidth = 0;
  let overlongWords = 0;

  const pushLine = (line: string): void => {
    maxLineWidth = Math.max(maxLineWidth, measureText(line, glyphs));
    lines.push(line);
    if (lines.length >= win.linesPerPage) {
      pages.push({ lines });
      lines = [];
    }
  };
  const flushPage = (): void => {
    if (lines.length > 0) {
      pages.push({ lines });
      lines = [];
    }
  };

  for (const [pageIndex, rawPage] of text.split('\f').entries()) {
    if (pageIndex > 0) flushPage();
    for (const rawLine of rawPage.split('\n')) {
      let current = '';
      for (const word of rawLine.split(' ')) {
        if (word === '') {
          continue;
        }
        const candidate = current === '' ? word : `${current} ${word}`;
        if (measureText(candidate, glyphs) <= inner) {
          current = candidate;
          continue;
        }
        if (current !== '') {
          pushLine(current);
          current = '';
        }
        // Wort passt allein nicht: hart trennen, aber sichtbar zählen.
        let rest = word;
        if (measureText(rest, glyphs) > inner) overlongWords++;
        while (measureText(rest, glyphs) > inner) {
          let cut = rest.length;
          while (cut > 1 && measureText(rest.slice(0, cut), glyphs) > inner) cut--;
          pushLine(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        current = rest;
      }
      pushLine(current);
    }
  }
  flushPage();
  return { pages, maxLineWidth, overlongWords };
}
