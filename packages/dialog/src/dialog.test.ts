import { describe, expect, it } from 'vitest';
import { EXE_DEFAULTS, spacingTableFrom } from '@webmidgar/formats-kernel';
import {
  dialogMetrics,
  glyphMetricsFrom,
  layoutFfText,
  layoutText,
  measureText,
  type GlyphMetrics,
} from './layout.js';
import { DialogSession, type DialogInput, type DialogRequest } from './session.js';

/**
 * Testsuite für `packages/dialog` (S15): Zeilen-/Seitenumbruch (`layoutText`)
 * und den taktbasierten Dialogablauf (`DialogSession`). Alle Metriken sind
 * bewusst eigene, klar gewählte Testwerte — nicht die Fallback-Vorgaben aus
 * `layout.ts` —, damit jeder erwartete Umbruch von Hand nachvollziehbar
 * bleibt, statt von einer zufällig passenden Vorgabe abzuhängen.
 */

/** Gleichbreite Glyphen: jedes Zeichen (inkl. Leerzeichen) `width` Pixel breit. */
function monoGlyphs(width: number): GlyphMetrics {
  return { widths: {}, defaultWidth: width, lineHeight: 16 };
}

describe('layoutText — Umbruch an Leerzeichen', () => {
  it('bricht genau dort um, wo die Zeilenbreite überschritten würde', () => {
    const glyphs = monoGlyphs(10);
    const result = layoutText('Tifa und Barret gehen los', {
      width: 80,
      glyphs,
      window: { padding: [0, 0, 0, 0], linesPerPage: 10 },
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.lines).toEqual(['Tifa und', 'Barret', 'gehen', 'los']);
    for (const line of result.pages[0]!.lines) {
      expect(measureText(line, glyphs)).toBeLessThanOrEqual(80);
    }
    expect(result.maxLineWidth).toBe(80);
    expect(result.overlongWords).toBe(0);
  });
});

describe('layoutText — Seitenumbruch durch linesPerPage', () => {
  it('teilt mehr Zeilen als eine Seite fasst auf mehrere Seiten auf, je höchstens linesPerPage Zeilen', () => {
    const result = layoutText('Zeile1\nZeile2\nZeile3\nZeile4\nZeile5', {
      width: 1000,
      window: { padding: [0, 0, 0, 0], linesPerPage: 2 },
    });
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.lines).toEqual(['Zeile1', 'Zeile2']);
    expect(result.pages[1]!.lines).toEqual(['Zeile3', 'Zeile4']);
    expect(result.pages[2]!.lines).toEqual(['Zeile5']);
    for (const page of result.pages) {
      expect(page.lines.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('layoutText — explizite Umbrüche', () => {
  it('erzwingt mit \\n eine neue Zeile, auch mehrfach hintereinander', () => {
    const result = layoutText('Wort1\nWort2\n\nWort3', {
      width: 1000,
      window: { padding: [0, 0, 0, 0], linesPerPage: 10 },
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.lines).toEqual(['Wort1', 'Wort2', '', 'Wort3']);
  });

  it('erzwingt mit \\f eine neue Seite, auch mehrfach hintereinander und mitten im Text', () => {
    const result = layoutText('SeiteA\f\fSeiteB', {
      width: 1000,
      window: { padding: [0, 0, 0, 0], linesPerPage: 10 },
    });
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.lines).toEqual(['SeiteA']);
    expect(result.pages[1]!.lines).toEqual(['']);
    expect(result.pages[2]!.lines).toEqual(['SeiteB']);
  });
});

describe('layoutText — überlanges Wort', () => {
  it('trennt ein Wort, das breiter als die Zeile ist, hart und zählt es in overlongWords', () => {
    const glyphs = monoGlyphs(10);
    const result = layoutText('Donnerschlag', {
      width: 50,
      glyphs,
      window: { padding: [0, 0, 0, 0], linesPerPage: 10 },
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.lines).toEqual(['Donne', 'rschl', 'ag']);
    expect(result.overlongWords).toBe(1);
    for (const line of result.pages[0]!.lines) {
      expect(measureText(line, glyphs)).toBeLessThanOrEqual(50);
    }
  });
});

describe('layoutText — proportionale Glyphen', () => {
  it('bricht denselben Text bei breiteren Einzelzeichen an anderer Stelle um als bei gleichbreiten Glyphen', () => {
    const text = 'mim mim mim mim';
    const window = { padding: [0, 0, 0, 0] as [number, number, number, number], linesPerPage: 10 };

    const equalWidth = monoGlyphs(10);
    const proportional: GlyphMetrics = { widths: { m: 20, i: 10 }, defaultWidth: 10, lineHeight: 16 };

    const withEqualGlyphs = layoutText(text, { width: 100, glyphs: equalWidth, window });
    const withProportionalGlyphs = layoutText(text, { width: 100, glyphs: proportional, window });

    expect(withEqualGlyphs.pages[0]!.lines).toEqual(['mim mim', 'mim mim']);
    expect(withProportionalGlyphs.pages[0]!.lines).toEqual(['mim', 'mim', 'mim', 'mim']);
    expect(withProportionalGlyphs.pages[0]!.lines).not.toEqual(withEqualGlyphs.pages[0]!.lines);
  });
});

describe('DialogSession — Textgeschwindigkeit', () => {
  it('zeigt mit charsPerTick:2 nach k Takten höchstens 2·k Zeichen, nach genügend Takten die ganze Seite', () => {
    const session = new DialogSession({
      width: 1000,
      window: { padding: [0, 0, 0, 0], linesPerPage: 5 },
      charsPerTick: 2,
    });
    session.open({ requestId: 1, text: 'Aerith' });

    session.tick();
    expect(session.visibleLines().join('')).toBe('Ae');
    session.tick();
    expect(session.visibleLines().join('')).toBe('Aeri');
    session.tick();
    expect(session.visibleLines().join('')).toBe('Aerith');
    // Weiterer Takt: Seite ist bereits vollständig, bleibt es auch.
    session.tick();
    expect(session.visibleLines().join('')).toBe('Aerith');
  });

  it('zeigt mit charsPerTick:0 die Seite sofort vollständig, ohne einen einzigen Takt', () => {
    const session = new DialogSession({
      width: 1000,
      window: { padding: [0, 0, 0, 0], linesPerPage: 5 },
      charsPerTick: 0,
    });
    session.open({ requestId: 1, text: 'Aerith' });
    expect(session.visibleLines().join('')).toBe('Aerith');
  });
});

describe('DialogSession — Bestätigen ist gestaffelt', () => {
  it('vervollständigt beim ersten Bestätigen nur den Text, blättert beim zweiten, schließt beim dritten', () => {
    const request: DialogRequest = { requestId: 55, text: 'Wartezeit\nAnkunft' };
    const session = new DialogSession({
      width: 500,
      window: { padding: [0, 0, 0, 0], linesPerPage: 1 },
      charsPerTick: 8,
    });
    session.open(request);
    const confirm: DialogInput = { confirm: true, cancel: false, moveY: 0 };

    // Erste Stufe: Text der ersten Seite läuft noch (9 Zeichen, 8 pro Takt) —
    // Bestätigen zeigt ihn sofort vollständig, bleibt aber auf derselben Seite.
    const first = session.tick(confirm);
    expect(first.resolved).toBeNull();
    expect(session.state!.pageIndex).toBe(0);
    expect(session.visibleLines()).toEqual(['Wartezeit']);

    // Zweite Stufe: Text ist vollständig gezeigt — Bestätigen blättert um.
    const second = session.tick(confirm);
    expect(second.resolved).toBeNull();
    expect(session.state!.pageIndex).toBe(1);

    // Dritte Stufe: letzte Seite, ihr Text passt in einen Takt (7 ≤ 8 Zeichen)
    // — Bestätigen schließt das Fenster und liefert resolved.
    const third = session.tick(confirm);
    expect(third.resolved).toEqual({ requestId: 55, choice: 0 });
    expect(session.state!.done).toBe(true);
  });
});

describe('DialogSession — Auswahl (ASK)', () => {
  const request: DialogRequest = {
    requestId: 3,
    text: 'Zeile0\nZeile1\nZeile2\nZeile3',
    choice: { firstLine: 1, lastLine: 3 },
  };
  const options = {
    width: 500,
    window: { padding: [0, 0, 0, 0] as [number, number, number, number], linesPerPage: 4 },
    charsPerTick: 0,
  };

  it('startet die Auswahl bei firstLine und bestätigt sie unverändert als Index 0', () => {
    const session = new DialogSession(options);
    session.open(request);
    const result = session.tick({ confirm: true, cancel: false, moveY: 0 });
    expect(result.resolved).toEqual({ requestId: 3, choice: 0 });
  });

  it('bewegt moveY:1 nach unten und läuft am Ende umlaufend auf firstLine zurück', () => {
    const session = new DialogSession(options);
    session.open(request);
    const down: DialogInput = { confirm: false, cancel: false, moveY: 1 };

    session.tick(down);
    expect(session.state!.selection).toBe(2);
    session.tick(down);
    expect(session.state!.selection).toBe(3);
    session.tick(down); // über lastLine hinaus: Umlauf zurück auf firstLine
    expect(session.state!.selection).toBe(1);

    const result = session.tick({ confirm: true, cancel: false, moveY: 0 });
    expect(result.resolved).toEqual({ requestId: 3, choice: 0 });
  });

  it('bewegt moveY:-1 nach oben und läuft vor firstLine umlaufend auf lastLine', () => {
    const session = new DialogSession(options);
    session.open(request);
    session.tick({ confirm: false, cancel: false, moveY: -1 });
    expect(session.state!.selection).toBe(3);

    const result = session.tick({ confirm: true, cancel: false, moveY: 0 });
    // 0-basierter Index relativ zu firstLine: lastLine(3) − firstLine(1) = 2.
    expect(result.resolved).toEqual({ requestId: 3, choice: 2 });
  });
});

describe('DialogSession — Determinismus', () => {
  it('liefert bei identischer Eingabefolge dieselben sichtbaren Zeilen je Takt und dasselbe resolved', () => {
    const request: DialogRequest = {
      requestId: 77,
      text: 'Zeile0\nZeile1\nZeile2\nZeile3',
      choice: { firstLine: 1, lastLine: 3 },
    };
    const options = {
      width: 500,
      window: { padding: [0, 0, 0, 0] as [number, number, number, number], linesPerPage: 4 },
      charsPerTick: 3,
    };
    const inputs: DialogInput[] = [
      { confirm: false, cancel: false, moveY: 1 },
      { confirm: false, cancel: false, moveY: 0 },
      { confirm: true, cancel: false, moveY: 0 },
      { confirm: false, cancel: false, moveY: -1 },
      { confirm: true, cancel: false, moveY: 0 },
      { confirm: true, cancel: false, moveY: 0 }, // Takt nach Abschluss: bleibt wirkungslos
    ];

    const sessionA = new DialogSession(options);
    const sessionB = new DialogSession(options);
    sessionA.open(request);
    sessionB.open(request);

    const resultsA = inputs.map((input) => ({
      resolved: sessionA.tick(input).resolved,
      visible: sessionA.visibleLines(),
    }));
    const resultsB = inputs.map((input) => ({
      resolved: sessionB.tick(input).resolved,
      visible: sessionB.visibleLines(),
    }));

    expect(resultsA).toEqual(resultsB);
    // Sanity-Check: Die Sequenz löst tatsächlich auf, statt trivial leer zu sein.
    expect(resultsA[4]!.resolved).toEqual({ requestId: 77, choice: 0 });
    expect(resultsA[5]!.resolved).toBeNull();
  });
});

/**
 * Welle 2: der Originalpfad. FF7 bricht nicht um — die Zeilen stehen im Text,
 * und das Fenster wird danach bemessen. Diese Tests sichern genau den
 * Unterschied zum alten, umbrechenden Verhalten ab.
 */

/** Testmetrik mit klar von Hand nachrechenbaren Breiten. */
function testSpacing() {
  const raw = new Uint8Array(256);
  for (let i = 0; i < 256; i++) raw[i] = 5;
  raw[0x2f] = 9; // 'O'
  raw[0x01] = 4; // '!'
  return spacingTableFrom(Uint8Array.from(raw), { rawGlyphBytes: raw });
}

describe('layoutFfText — kein Autowrap', () => {
  it('lässt eine überlange Zeile stehen und macht das Fenster breit', () => {
    const spacing = testSpacing();
    const lang = 'O'.repeat(60);
    const layout = layoutFfText(lang, spacing);
    expect(layout.pages).toHaveLength(1);
    // Entscheidend: EINE Zeile, nicht mehrere — hier hätte das alte
    // layoutText umgebrochen.
    expect(layout.pages[0]!.lines).toEqual([lang]);
    expect(layout.width).toBe(EXE_DEFAULTS.padding + 60 * 9);
    expect(layout.lines).toBe(1);
  });

  it('übernimmt Zeilen und Seiten unverändert aus dem Text', () => {
    const layout = layoutFfText('OO\nO\fOOO', testSpacing());
    expect(layout.pages.map((p) => p.lines)).toEqual([['OO', 'O'], ['OOO']]);
    // Fensterbreite folgt der längsten Zeile über alle Seiten hinweg.
    expect(layout.width).toBe(EXE_DEFAULTS.padding + 3 * 9);
    expect(layout.lines).toBe(2);
  });

  it('deckelt die Zeilenzahl bei 13 wie das Original', () => {
    const viele = Array.from({ length: 20 }, () => 'O').join('\n');
    expect(layoutFfText(viele, testSpacing()).lines).toBe(13);
  });
});

describe('dialogMetrics — der Rückfall ist laut', () => {
  it('liefert ohne WINDOW.BIN die Ersatzmetrik MIT Diagnose', () => {
    const r = dialogMetrics(null);
    expect(r.measured).toBe(false);
    expect(r.diagnostic).toMatch(/WINDOW\.BIN/);
    expect(r.spacing.widths[0x2f]).toBe(8);
  });

  it('meldet auch eine unbrauchbar kurze Breitentabelle, statt sie zu benutzen', () => {
    const r = dialogMetrics({ glyphWidths: new Uint8Array(0), rawGlyphBytes: new Uint8Array(0) });
    expect(r.measured).toBe(false);
    expect(r.diagnostic).toMatch(/256/);
  });

  it('liefert mit echter Tabelle die gemessene Metrik und keine Diagnose', () => {
    const raw = Uint8Array.from({ length: 256 }, () => 7);
    const r = dialogMetrics({ glyphWidths: raw, rawGlyphBytes: raw });
    expect(r.measured).toBe(true);
    expect(r.diagnostic).toBeNull();
    expect(r.spacing.widths[0x2f]).toBe(7);
  });
});

describe('glyphMetricsFrom — Brücke zur Zeichenmetrik', () => {
  it('bildet das ASCII-Fenster über den Versatz 0x20 ab', () => {
    const spacing = testSpacing();
    const glyphs = glyphMetricsFrom(spacing);
    expect(glyphs.widths['O']).toBe(9); // Byte 0x2F
    expect(glyphs.widths['!']).toBe(4); // Byte 0x01
    expect(measureText('OO!', glyphs)).toBe(9 + 9 + 4);
  });
});

describe('DialogSession — FF7-Modus', () => {
  it('bricht mit ffSpacing nicht um und liefert die Fenstergröße mit', () => {
    const session = new DialogSession({
      width: 100, // absichtlich viel zu schmal: im FF7-Modus irrelevant
      ffSpacing: testSpacing(),
      charsPerTick: 0,
    });
    session.open({ requestId: 1, text: 'OOOOOOOOOO\nOO' });
    expect(session.state!.pages[0]!.lines).toEqual(['OOOOOOOOOO', 'OO']);
    expect(session.state!.window).toEqual({
      width: EXE_DEFAULTS.padding + 10 * 9,
      height: 2 * EXE_DEFAULTS.rowStep + EXE_DEFAULTS.rowBase,
      lines: 2,
    });
  });

  it('bricht ohne ffSpacing weiterhin um — der Ersatzweg bleibt erhalten', () => {
    const session = new DialogSession({
      width: 100,
      glyphs: { widths: {}, defaultWidth: 10, lineHeight: 16 },
      window: { padding: [0, 0, 0, 0], linesPerPage: 10 },
      charsPerTick: 0,
    });
    session.open({ requestId: 1, text: 'aaaaaaaaaa aaaaaaaaaa' });
    expect(session.state!.pages[0]!.lines).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa']);
    expect(session.state!.window).toBeNull();
  });
});
