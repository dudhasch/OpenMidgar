import { describe, expect, it } from 'vitest';
import { composeWindowBin, composeWindowBinFixture, composeTim } from '@webmidgar/fixture-gen';
import {
  decodeGlyphWidth,
  measureGlyphInkWidths,
  parseWindowBin,
  FONT_CELL,
} from './window-bin.js';
import {
  EXE_DEFAULTS,
  FALLBACK_SPACING,
  measureFfWindow,
  nameSlotWidthFrom,
  spacingFromWindowBin,
  spacingTableFrom,
  splitFfText,
  TXT,
} from './metrics.js';

/**
 * `WINDOW.BIN` + FF7-Textmetrik.
 *
 * Der Kern jeder Behauptung hier ist **Accounting**: Sektionslängen müssen
 * die Datei byteexakt füllen, die Breitentabelle muss 256 Einträge liefern,
 * und die Dekodierregel muss gegen eine *unabhängig* gemessene Größe
 * bestehen — hier die Tintenbreite im Fontblatt, die das Fixture aus
 * derselben Tabelle, aber über einen anderen Weg erzeugt.
 */

/** Eine Tabelle mit Werten in allen interessanten Ecken des Bytebereichs. */
function testGlyphBytes(): Uint8Array {
  const b = new Uint8Array(256);
  for (let i = 0; i < 0xe0; i++) {
    // Breiten 1..11, damit sie in eine 12-px-Zelle passen.
    b[i] = 1 + (i % 11);
  }
  b[TXT.SPACE] = 3;
  b[0x0c] = 8; // ','
  b[0x0e] = 7; // '.'
  b[0x02] = 5; // '"'
  b[0x10] = 8; // '0'
  b[0x2f] = 9; // 'O'
  b[0xa9] = 9; // '…'
  b[0xc4] = 0x0d; // breitestes Zeichen — bestimmt die Namensbreite
  for (let i = 0xe0; i < 256; i++) b[i] = 1;
  return b;
}

describe('WINDOW.BIN — Accounting', () => {
  it('rechnet drei Sektionen plus Nullrest byteexakt gegen die Dateigröße ab', async () => {
    const bytes = await composeWindowBinFixture(testGlyphBytes());
    const win = await parseWindowBin(bytes, 'fixture');
    expect(win.diagnostics).toEqual([]);
    expect(win.sections).toHaveLength(3);
    const consumed = win.sections.reduce((n, s) => n + 6 + s.compressedLength, 0);
    expect(consumed + win.trailerLength).toBe(bytes.length);
    expect(win.trailerLength).toBe(2);
  });

  it('liefert genau 256 Breiten, und die dritte Sektion entpackt auf ihre Kopflänge', async () => {
    const bytes = await composeWindowBinFixture(testGlyphBytes());
    const win = await parseWindowBin(bytes, 'fixture');
    expect(win.glyphWidths).toHaveLength(256);
    expect(win.rawGlyphBytes).toHaveLength(256);
    const dritte = win.sections[2]!;
    expect(dritte.data.length).toBe(dritte.declaredLength);
    expect(dritte.data.length).toBeGreaterThanOrEqual(256);
  });

  it('meldet einen nicht genullten Rest, statt ihn zu überlesen', async () => {
    const bytes = await composeWindowBinFixture(testGlyphBytes(), { trailer: 5 });
    bytes[bytes.length - 1] = 0x42;
    const win = await parseWindowBin(bytes, 'fixture');
    expect(win.diagnostics.map((d) => d.code)).toContain('E-WIN-ACCOUNT');
  });

  it('meldet eine zu kurze Breitensektion und lässt die Tabelle leer', async () => {
    const bytes = await composeWindowBin({
      windowTim: composeTim({
        width: 8,
        height: 8,
        clut: new Uint16Array(16),
        clutWidth: 16,
        clutHeight: 1,
        indices: new Uint8Array(64),
      }),
      fontTim: composeTim({
        width: 8,
        height: 8,
        clut: new Uint16Array(16),
        clutWidth: 16,
        clutHeight: 1,
        indices: new Uint8Array(64),
      }),
      widthSection: new Uint8Array(100),
    });
    const win = await parseWindowBin(bytes, 'fixture');
    expect(win.diagnostics.map((d) => d.code)).toContain('E-WIN-WIDTHS');
    expect(win.glyphWidths).toHaveLength(0);
    // Und der Metrikpfad verweigert dann die Auskunft, statt zu raten.
    expect(spacingFromWindowBin(win)).toBeNull();
  });
});

describe('decodeGlyphWidth — additive Regel', () => {
  it('addiert je gesetztem 0x20-Vielfachen ein Pixel zu den unteren 5 Bit', () => {
    expect(decodeGlyphWidth(0x09)).toBe(9);
    expect(decodeGlyphWidth(0x27)).toBe(8); // 7 + 1
    expect(decodeGlyphWidth(0x48)).toBe(10); // 8 + 2
    expect(decodeGlyphWidth(0x6a)).toBe(13); // 10 + 3
    // Ohne die obere Hälfte wäre bei 31 px Schluss; mit ihr bei 38.
    expect(decodeGlyphWidth(0xff)).toBe(31 + 7);
  });
});

describe('Fontblatt — unabhängige Gegenprobe zur Breitentabelle', () => {
  it('misst je Zeichen eine Tintenbreite von genau Tabellenbreite − 1', async () => {
    const glyphs = testGlyphBytes();
    const bytes = await composeWindowBinFixture(glyphs);
    const win = await parseWindowBin(bytes, 'fixture');
    expect(win.fontTexture).not.toBeNull();
    expect(win.fontTexture!.width).toBe(256);
    expect(win.fontTexture!.height).toBe(252);

    const ink = measureGlyphInkWidths(win.fontTexture!);
    let treffer = 0;
    let geprueft = 0;
    for (let code = 0; code < 0xe0; code++) {
      const erwartet = decodeGlyphWidth(glyphs[code]!) - 1;
      if (erwartet <= 0 || erwartet > FONT_CELL) continue;
      geprueft++;
      if (ink[code] === erwartet) treffer++;
    }
    expect(geprueft).toBeGreaterThan(180);
    expect(treffer).toBe(geprueft);

    // Kontrollniveau: gegen eine verschobene Zuordnung darf es NICHT passen.
    let versetzt = 0;
    for (let code = 0; code < 0xe0 - 1; code++) {
      if (ink[code] === decodeGlyphWidth(glyphs[code + 1]!) - 1) versetzt++;
    }
    expect(versetzt).toBeLessThan(geprueft / 2);
  });
});

describe('Namensbreite — fällt aus den Daten, ist keine Konstante', () => {
  it('ist 9 × die größte Zeichenbreite der Tabelle', () => {
    const glyphs = testGlyphBytes();
    expect(nameSlotWidthFrom(glyphs)).toBe(9 * 0x0d);
    // Wird ein Zeichen breiter, wächst der Platzhalter mit.
    const breiter = Uint8Array.from(glyphs);
    breiter[0x50] = 0x11;
    expect(nameSlotWidthFrom(breiter)).toBe(9 * 0x11);
  });
});

describe('measureFfWindow — Fensterbreite folgt dem Text', () => {
  const spacing = spacingTableFrom(
    Uint8Array.from(testGlyphBytes(), decodeGlyphWidth),
    { rawGlyphBytes: testGlyphBytes() },
  );

  it('startet jede Zeile bei der Polsterung und nimmt die längste Zeile', () => {
    // Zwei Zeilen: 'OO' (2×9) und 'O' (9). Breiter ist die erste.
    const text = Uint8Array.of(0x2f, 0x2f, TXT.NEWLINE, 0x2f, TXT.END);
    const m = measureFfWindow(text, spacing);
    expect(m.width).toBe(EXE_DEFAULTS.padding + 18);
    expect(m.lines).toBe(2);
  });

  it('bricht NICHT um — ein langer Text ohne 0xE7 bleibt eine einzige Zeile', () => {
    const text = Uint8Array.from({ length: 200 }, () => 0x2f);
    const m = measureFfWindow(text, spacing);
    expect(m.lines).toBe(1);
    expect(m.width).toBe(EXE_DEFAULTS.padding + 200 * 9);
  });

  it('zählt Seiten über 0xE8 und nimmt die zeilenreichste Seite', () => {
    // Seite 1: 3 Zeilen, Seite 2: 1 Zeile.
    const text = Uint8Array.of(
      0x2f, TXT.NEWLINE, 0x2f, TXT.NEWLINE, 0x2f, TXT.NEWPAGE, 0x2f, TXT.END,
    );
    const m = measureFfWindow(text, spacing);
    expect(m.pages).toBe(2);
    expect(m.lines).toBe(3);
    expect(m.height).toBe(3 * EXE_DEFAULTS.rowStep + EXE_DEFAULTS.rowBase);
  });

  it('deckelt die Zeilenzahl bei 13', () => {
    const text = Uint8Array.from({ length: 40 }, (_, i) => (i % 2 ? TXT.NEWLINE : 0x2f));
    expect(measureFfWindow(text, spacing).lines).toBe(13);
  });

  it('bricht bei 0xFF ab und ignoriert alles dahinter', () => {
    const kurz = measureFfWindow(Uint8Array.of(0x2f, TXT.END, 0x2f, 0x2f, 0x2f), spacing);
    expect(kurz.width).toBe(EXE_DEFAULTS.padding + 9);
  });

  it('rechnet die drei Ligaturen als Summe ihrer Bestandteile', () => {
    const komma = measureFfWindow(Uint8Array.of(TXT.LIG_COMMA_SPACE), spacing).width;
    const einzeln = measureFfWindow(Uint8Array.of(TXT.SPACE, 0x0c), spacing).width;
    expect(komma).toBe(einzeln);
  });

  it('zählt {CHOICE} und Tab in Leerzeichen, nicht in Pixeln', () => {
    const choice = measureFfWindow(Uint8Array.of(TXT.CHOICE), spacing).width;
    expect(choice).toBe(EXE_DEFAULTS.padding + EXE_DEFAULTS.choiceSpaces * spacing.widths[TXT.SPACE]!);
    const tab = measureFfWindow(Uint8Array.of(TXT.TAB), spacing).width;
    expect(tab).toBe(EXE_DEFAULTS.padding + EXE_DEFAULTS.tabSpaces * spacing.widths[TXT.SPACE]!);
  });

  it('überspringt die Parameter von {WAIT} und {MEM3}, ohne sie als Text zu zählen', () => {
    // FE DD <u16> darf keine Breite erzeugen; die zwei Parameterbytes sind
    // absichtlich Werte, die als Glyphen breit wären.
    const wait = measureFfWindow(Uint8Array.of(TXT.FUNC, 0xdd, 0x2f, 0x2f), spacing);
    expect(wait.width).toBe(EXE_DEFAULTS.padding);
    // FE E2 <offset u16> <länge u16> ⇒ Länge × Breite('O').
    const mem3 = measureFfWindow(Uint8Array.of(TXT.FUNC, 0xe2, 0, 0, 3, 0), spacing);
    expect(mem3.width).toBe(EXE_DEFAULTS.padding + 3 * spacing.widths[0x2f]!);
  });

  it('schaltet mit {MAX} auf die halbe MAX-Breite je Zeichen um und wieder zurück', () => {
    const normal = measureFfWindow(Uint8Array.of(0x2f, 0x2f), spacing).width;
    const max = measureFfWindow(
      Uint8Array.of(TXT.FUNC, 0xe9, 0x2f, 0x2f, TXT.FUNC, 0xe9, 0x2f),
      spacing,
    ).width;
    expect(max).toBe(EXE_DEFAULTS.padding + 2 * (EXE_DEFAULTS.maxWidth / 2) + spacing.widths[0x2f]!);
    expect(max).not.toBe(normal);
  });

  it('bemisst Namensplatzhalter mit der hergeleiteten Namensbreite', () => {
    const cloud = measureFfWindow(Uint8Array.of(TXT.NAME_FIRST), spacing).width;
    expect(cloud).toBe(EXE_DEFAULTS.padding + nameSlotWidthFrom(testGlyphBytes()));
  });
});

describe('splitFfText — zerlegt ohne umzubrechen', () => {
  it('trennt Zeilen an 0xE7 und Seiten an 0xE8 und liefert Byte-Spannen', () => {
    const text = Uint8Array.of(0x21, 0x22, TXT.NEWLINE, 0x23, TXT.NEWPAGE, 0x24);
    const { pages } = splitFfText(text);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ]);
    expect(pages[1]).toEqual([{ start: 5, end: 6 }]);
  });
});

describe('Ersatzmetrik', () => {
  it('ist von der echten Metrik unterscheidbar und liefert andere Breiten', () => {
    const echt = spacingTableFrom(Uint8Array.from(testGlyphBytes(), decodeGlyphWidth));
    const text = Uint8Array.of(0x2f, 0x2f, 0x2f); // dreimal 'O' (9 px statt 8)
    expect(measureFfWindow(text, FALLBACK_SPACING).width).not.toBe(
      measureFfWindow(text, echt).width,
    );
    expect(FALLBACK_SPACING.widths[0x2f]).toBe(8);
  });
});
