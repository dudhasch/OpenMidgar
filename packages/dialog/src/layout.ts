/**
 * Fenster- und Textlayout (S15) — datengetrieben und ohne DOM, damit es in
 * Node vollständig testbar bleibt. Das Rendering liest das Ergebnis nur ab.
 *
 * Die Metrik (Glyphenbreiten, Fensterränder, Zeilenhöhe) ist bewusst ein
 * **Parameter**, keine eingebaute Konstante: Sie stammt aus den Fontassets der
 * Installation und darf sich je Sprachfassung unterscheiden. Bis sie gemessen
 * ist, arbeitet das Modul mit einer erklärten Ersatzmetrik — und sagt das.
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
 * 🟡 Ersatzmetrik: gleichbreite Glyphen. Sie ist absichtlich grob und wird
 * durch die gemessene Fontmetrik ersetzt, sobald die Fontassets erschlossen
 * sind. Wer sie benutzt, bekommt einen plausiblen, aber nicht originalgetreuen
 * Umbruch — das ist besser als ein Umbruch, der so tut, als wäre er exakt.
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

export function measureText(text: string, glyphs: GlyphMetrics): number {
  let width = 0;
  for (const ch of text) width += glyphs.widths[ch] ?? glyphs.defaultWidth;
  return width;
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

/**
 * Bricht Text auf Zeilen und Seiten um.
 *
 * Regeln, bewusst explizit: Ein `\n` erzwingt einen Zeilenumbruch, ein `\f`
 * eine neue Seite. Umgebrochen wird an Leerzeichen; ein Wort, das allein nicht
 * in die Zeile passt, wird hart getrennt statt über den Rand zu laufen — und
 * dabei gezählt, damit eine zu schmale Fenstermetrik auffällt statt still zu
 * verstümmeln.
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
