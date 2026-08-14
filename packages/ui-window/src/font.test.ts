import { describe, expect, it } from 'vitest';
import {
  buildFieldTextTable,
  buildAsciiTable,
  DEFAULT_ASCII_OFFSET,
  FONT_CELL,
  FONT_CELLS_PER_ROW,
  type TimImage,
} from '@webmidgar/formats-kernel';
import {
  buildGlyphAtlas,
  buildGlyphCodeMap,
  cellRect,
  DEFAULT_FONT_PALETTE,
  FontPalette,
  layoutGlyphRun,
} from './font.js';
import { paintGlyphText, type FontContext, type GlyphContainer } from './text-paint.js';

/**
 * Fixture-Fontblatt — **selbst erzeugt**, wie alle Fixtures des Projekts.
 * Es bildet den gemessenen Aufbau nach: 4 bpp, Zellen 12×12, 21 je Zeile,
 * nur die Indizes 0/1/3 belegt, 8 Palettenzeilen à 32 Einträge.
 */
function fixtureFont(codesMitTinte: readonly number[]): TimImage {
  const width = FONT_CELL * FONT_CELLS_PER_ROW; // 252 — genügt für den Test
  const height = FONT_CELL * 21;
  const indices = new Uint8Array(width * height);
  for (const code of codesMitTinte) {
    const { x, y } = cellRect(code);
    for (let dy = 1; dy < FONT_CELL - 1; dy++) {
      // Körper (3) mit dunkler Kante (1) rechts darunter — wie im Original.
      indices[(y + dy) * width + x] = 3;
      indices[(y + dy) * width + x + 1] = 1;
    }
  }
  const clutWidth = 32;
  const clutHeight = 8;
  const palette = new Uint8Array(clutWidth * clutHeight * 4);
  for (let row = 0; row < clutHeight; row++) {
    const hell = row === FontPalette.Weiss ? 230 : 20 + row * 10;
    for (const [idx, [r, g, b, a]] of [
      [0, [0, 0, 0, 0]],
      [1, [hell / 8, hell / 8, hell / 8, 255]],
      [3, [hell, hell, hell, 255]],
    ] as [number, number[]][]) {
      const o = (row * clutWidth + idx) * 4;
      palette[o] = r!;
      palette[o + 1] = g!;
      palette[o + 2] = b!;
      palette[o + 3] = a!;
    }
  }
  return { bpp: 4, width, height, palette, clutWidth, clutHeight, indices };
}

/** Winziges Fake-DOM: genug für den Maler, nichts darüber hinaus. */
class FakeEl {
  readonly props = new Map<string, string>();
  readonly children: FakeEl[] = [];
  textContent: string | null = null;
  dataset: Record<string, string> = {};
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  readonly style = {
    setProperty: (n: string, v: string): void => {
      this.props.set(n, v);
    },
  };
  replaceChildren(...nodes: unknown[]): void {
    this.children.length = 0;
    for (const n of nodes) this.children.push(n as FakeEl);
  }
  get ownerDocument(): { createElement(tag: string): unknown } {
    return { createElement: (tag: string) => new FakeEl(tag) };
  }
  /** Alle Nachfahren in Dokumentreihenfolge. */
  alle(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.alle()]);
  }
}

describe('Zellenraster', () => {
  it('bildet den Textcode direkt auf die Zelle ab (21 je Zeile, 12 px)', () => {
    expect(cellRect(0)).toEqual({ x: 0, y: 0 });
    expect(cellRect(20)).toEqual({ x: 240, y: 0 });
    expect(cellRect(21)).toEqual({ x: 0, y: 12 });
    expect(cellRect(255)).toEqual({ x: (255 % 21) * 12, y: Math.floor(255 / 21) * 12 });
  });
});

describe('Glyphenblatt', () => {
  it('färbt nach Palettenzeile ein und lässt Index 0 durchsichtig', () => {
    const font = fixtureFont([0x21]);
    const atlas = buildGlyphAtlas(font, FontPalette.Weiss);
    const { x, y } = cellRect(0x21);
    const at = (px: number, py: number): number[] => {
      const o = (py * atlas.width + px) * 4;
      return [atlas.rgba[o]!, atlas.rgba[o + 1]!, atlas.rgba[o + 2]!, atlas.rgba[o + 3]!];
    };
    expect(at(x, y + 1)).toEqual([230, 230, 230, 255]); // Körper
    expect(at(x + 1, y + 1)).toEqual([28, 28, 28, 255]); // Schattenkante
    expect(at(x + 5, y + 1)).toEqual([0, 0, 0, 0]); // leer
    expect(atlas.belegteZellen).toBe(1);
  });

  it('wählt mit der Palettenzeile eine andere Farbe — dieselben Formen', () => {
    const font = fixtureFont([0x21]);
    const weiss = buildGlyphAtlas(font, FontPalette.Weiss);
    const rot = buildGlyphAtlas(font, FontPalette.Rot);
    const { x, y } = cellRect(0x21);
    const o = ((y + 1) * weiss.width + x) * 4;
    expect(weiss.rgba[o]).not.toBe(rot.rgba[o]);
    // Deckung identisch: nur die Farbe wechselt, nie die Form.
    const deckung = (a: GlyphAtlasLike): number[] =>
      [...a.rgba].filter((_, i) => i % 4 === 3).map((v) => (v ? 1 : 0));
    expect(deckung(weiss)).toEqual(deckung(rot));
  });

  it('lässt unbekannte Palettenzeilen durchsichtig statt zu raten', () => {
    const font = fixtureFont([0x21]);
    const atlas = buildGlyphAtlas(font, 99);
    expect([...atlas.rgba].every((v) => v === 0)).toBe(true);
  });

  it('ist die Standardzeile Weiß', () => {
    expect(DEFAULT_FONT_PALETTE).toBe(FontPalette.Weiss);
  });
});

type GlyphAtlasLike = { rgba: Uint8Array; width: number };

describe('Rückabbildung Zeichen → Textcode', () => {
  it('kehrt das lineare ASCII-Fenster um', () => {
    const map = buildGlyphCodeMap(buildFieldTextTable());
    expect(map.get(' ')).toBe(0x00);
    expect(map.get('A')).toBe(0x41 - DEFAULT_ASCII_OFFSET);
    expect(map.get('z')).toBe(0x7a - DEFAULT_ASCII_OFFSET);
  });

  it('nimmt einzeichige Sonderbelegungen mit, mehrzeichige nicht', () => {
    const map = buildGlyphCodeMap(buildFieldTextTable());
    expect(map.get('ü')).toBe(0x7f);
    expect(map.get('“')).toBe(0xb2);
    // Namensplatzhalter und ', ' sind mehrzeichig — sie haben keinen Code und
    // zerfallen beim Zeichnen in ihre Einzelzeichen.
    expect(map.get('Cloud')).toBeUndefined();
    expect(map.get(', ')).toBeUndefined();
    expect(map.get('C')).toBeDefined();
  });

  it('ist deterministisch: bei Mehrdeutigkeit gewinnt der kleinste Code', () => {
    const table = buildAsciiTable(DEFAULT_ASCII_OFFSET, { 0xc0: 'A' });
    const map = buildGlyphCodeMap(table);
    expect(map.get('A')).toBe(0x41 - DEFAULT_ASCII_OFFSET);
  });
});

describe('Zeilensatz', () => {
  const map = buildGlyphCodeMap(buildFieldTextTable());
  const widths = new Uint8Array(256).fill(8);

  it('nimmt den Vorschub aus der Breitentabelle, nicht die Zellenbreite', () => {
    const w = new Uint8Array(256).fill(8);
    w[map.get('i')!] = 3;
    const run = layoutGlyphRun('ii', map, w);
    expect(run.glyphen.map((g) => g.advance)).toEqual([3, 3]);
    expect(run.breite).toBe(6);
  });

  it('setzt ohne Breitentabelle die Zellenbreite — sichtbar zu breit, nie stumm', () => {
    const run = layoutGlyphRun('ab', map, null);
    expect(run.glyphen.map((g) => g.advance)).toEqual([FONT_CELL, FONT_CELL]);
  });

  it('zählt Zeichen ohne Blattzeichen als Fehlstelle, statt sie zu verschlucken', () => {
    const run = layoutGlyphRun('a☃b', map, widths);
    expect(run.fehlend).toBe(1);
    expect(run.glyphen).toHaveLength(3);
    expect(run.glyphen[1]!.code).toBeNull();
    expect(run.glyphen[1]!.ch).toBe('☃');
  });

  it('adressiert die Quellzelle des Zeichens', () => {
    const run = layoutGlyphRun('A', map, widths);
    const code = map.get('A')!;
    const { x, y } = cellRect(code);
    expect(run.glyphen[0]).toMatchObject({ code, sx: x, sy: y });
  });
});

describe('Textmaler', () => {
  const font = fixtureFont([...Array(128).keys()]);
  const kontext = (): FontContext => ({
    atlasUrl: 'data:image/png;base64,XX',
    atlasWidth: font.width,
    atlasHeight: font.height,
    codes: buildGlyphCodeMap(buildFieldTextTable()),
    widths: new Uint8Array(256).fill(8),
  });

  it('macht aus jedem Zeichen ein Kästchen mit Blattausschnitt', () => {
    const el = new FakeEl('div');
    const bericht = paintGlyphText(el as unknown as GlyphContainer, 'AB', kontext());
    expect(bericht).toMatchObject({ gezeichnet: true, glyphen: 2, fehlend: 0, zeilen: 1 });
    const spans = el.alle().filter((e) => e.tag === 'span');
    expect(spans).toHaveLength(2);
    expect(spans[0]!.props.get('width')).toBe('16px'); // 8 px × Maßstab 2
    // 'A' = Textcode 0x21 = Zelle (12|1) → 144|12 im Blatt, verdoppelt.
    expect(spans[0]!.props.get('background-position')).toBe('-288px -24px');
    expect(spans[1]!.props.get('background-position')).toBe('-312px -24px');
  });

  it('nimmt den CSS-Schatten zurück — der Schatten steckt schon im Blatt', () => {
    const el = new FakeEl('div');
    paintGlyphText(el as unknown as GlyphContainer, 'A', kontext());
    expect(el.props.get('text-shadow')).toBe('none');
  });

  it('macht aus jedem Umbruch eine eigene Zeile mit der Zeilenhöhe der Schale', () => {
    const el = new FakeEl('div');
    const bericht = paintGlyphText(el as unknown as GlyphContainer, 'AB\nC', kontext());
    expect(bericht.zeilen).toBe(2);
    expect(el.children).toHaveLength(2);
    expect(el.children[0]!.props.get('height')).toBe('32px');
    expect(el.children[0]!.children).toHaveLength(2);
    expect(el.children[1]!.children).toHaveLength(1);
  });

  it('zeichnet den Einzug der Auswahlzeilen als Polsterung', () => {
    const el = new FakeEl('div');
    paintGlyphText(el as unknown as GlyphContainer, '\tJa', kontext());
    expect(el.children[0]!.props.get('padding-left')).toBe('24px');
    expect(el.children[0]!.children).toHaveLength(2);
  });

  it('fällt ohne Fontblatt sichtbar auf Systemschrift zurück', () => {
    const el = new FakeEl('div');
    const bericht = paintGlyphText(el as unknown as GlyphContainer, 'AB', null);
    expect(bericht.gezeichnet).toBe(false);
    expect(el.textContent).toBe('AB');
    expect(el.children).toHaveLength(0);
  });

  it('setzt Fehlstellen sichtbar in Systemschrift, statt sie zu verschlucken', () => {
    const el = new FakeEl('div');
    const bericht = paintGlyphText(el as unknown as GlyphContainer, 'A☃', kontext());
    expect(bericht.fehlend).toBe(1);
    const spans = el.alle().filter((e) => e.tag === 'span');
    expect(spans).toHaveLength(2);
    expect(spans[1]!.dataset['fehlend']).toBe('☃');
    expect(spans[1]!.props.get('background-image')).toBeUndefined();
    // Sichtbar: eigenes Schriftmaß (der Kasten steht auf font-size 0) und Text.
    expect(spans[1]!.textContent).toBe('☃');
    expect(spans[1]!.props.get('font-size')).toBe('20px');
    // Keine feste Breite — die Systemschrift bestimmt sie selbst.
    expect(spans[1]!.props.get('width')).toBeUndefined();
  });
});
