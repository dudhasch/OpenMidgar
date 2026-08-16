/**
 * Der Textmaler — die **einzige** Stelle, die aus dem Fontblatt Elemente macht.
 *
 * 🔵 Zeichnen statt Schrift setzen: Jede Glyphe wird ein leeres Kästchen, das
 * seinen Ausschnitt aus dem Blatt als Hintergrund trägt. Damit stimmen
 * Vorschub, Form und der **im Blatt enthaltene Schatten** ohne Nachbildung,
 * und die Zeile bleibt normales DOM (messbar, kein Canvas, kein Bildvergleich
 * nötig, um sie zu prüfen).
 *
 * Die Elementschnittstelle ist absichtlich winzig — dieselbe Bauart wie
 * `@webmidgar/ui-battle-hud/paint`: so ist der Maler ohne `lib.dom` in Node
 * testbar, und die Demo reicht echtes DOM herein.
 */

import { FONT_CELL, FONT_SCALE, layoutGlyphRun, type GlyphRun } from './font.js';
import { FF7_WINDOW_SKIN, type WindowSkin } from './skin.js';

export interface GlyphStyle {
  setProperty(name: string, value: string): void;
}

export interface GlyphNode {
  style: GlyphStyle;
  textContent: string | null;
}

/** Elternelement: Alles, was Kinder ersetzen und erzeugen kann. */
export interface GlyphContainer extends GlyphNode {
  replaceChildren(...nodes: unknown[]): void;
  ownerDocument: { createElement(tag: string): unknown } | null;
}

/**
 * Alles, was der Maler zum Zeichnen braucht. `atlasUrl` erzeugt die
 * aufrufende Seite aus `buildGlyphAtlas` (im Browser über ein Canvas) —
 * dieses Modul kennt weder Canvas noch Bildformate.
 */
export interface FontContext {
  atlasUrl: string;
  atlasWidth: number;
  atlasHeight: number;
  /** Zeichen → Textcode, aus `buildGlyphCodeMap`. */
  codes: Map<string, number>;
  /** Vorschubtabelle aus `WINDOW.BIN`; null = Zellenbreite. */
  widths: Uint8Array | null;
  scale?: number;
  /**
   * Weitere Blätter, je Palettenzeile — `atlasUrl` ist die Vorgabezeile.
   *
   * 🔵 **Warum mehrere Blätter und nicht eine Einfärbung.** Das Original
   * wechselt Textfarben über die CLUT des Blattes, nicht über eine Tönung: Ein
   * gesperrter Gegenstand, eine cyanfarbene Beschriftung und ein knapper
   * HP-Wert sind derselbe Glyphensatz in einer anderen Palettenzeile. Ein
   * CSS-Filter über ein weißes Blatt träfe weder die Farbe noch den im Blatt
   * enthaltenen Schatten. Die Blätter sind klein; sie einmal je gebrauchter
   * Zeile zu bauen ist billiger als jede Nachbildung.
   */
  palettes?: Readonly<Record<number, string>>;
}

export interface GlyphPaintOptions {
  /** Zeilenhöhe in Pixeln; Vorgabe ist die der Schale (32). */
  lineHeight?: number;
  /** Überschreibt den Maßstab des Kontexts. */
  scale?: number;
  skin?: WindowSkin;
  /** Palettenzeile; ohne Angabe die Vorgabezeile des Kontexts. */
  palette?: number;
}

const px = (n: number): string => `${n}px`;

/**
 * Zeichnet `text` in `el`. Zeilenumbrüche (`\n`) werden zu je einer Zeile mit
 * der Zeilenhöhe der Schale; `\t` wird als Einzug um eine halbe Zelle
 * gehandhabt (die Auswahl-Einzüge des Originals kommen so an).
 *
 * Ohne `font` fällt die Funktion auf **Systemschrift** zurück — sichtbar und
 * absichtlich, nicht still: Sie setzt dann nur `textContent`, genau wie vorher.
 * Der Rückgabewert sagt, welcher Weg genommen wurde und wie viele Zeichen
 * kein Blattzeichen hatten.
 */
export function paintGlyphText(
  el: GlyphContainer,
  text: string,
  font: FontContext | null,
  opts: GlyphPaintOptions = {},
): { gezeichnet: boolean; glyphen: number; fehlend: number; zeilen: number } {
  const zeilenText = text.split('\n');
  if (!font) {
    el.textContent = text;
    return { gezeichnet: false, glyphen: 0, fehlend: 0, zeilen: zeilenText.length };
  }
  const doc = el.ownerDocument;
  if (!doc) throw new Error('Textmaler ohne ownerDocument');
  const skin = opts.skin ?? FF7_WINDOW_SKIN;
  const scale = opts.scale ?? font.scale ?? FONT_SCALE;
  const lineHeight = opts.lineHeight ?? skin.lineHeight;
  // Fehlt das Blatt der verlangten Zeile, wird die Vorgabezeile gezeichnet —
  // sichtbar in falscher Farbe statt gar nicht.
  const atlasUrl = (opts.palette === undefined ? undefined : font.palettes?.[opts.palette]) ?? font.atlasUrl;

  // Der im Blatt enthaltene Schatten ersetzt den CSS-Schatten; sonst doppelt.
  el.style.setProperty('text-shadow', 'none');
  el.style.setProperty('font-size', '0');

  const kinder: unknown[] = [];
  let glyphen = 0;
  let fehlend = 0;
  for (const zeile of zeilenText) {
    const einzug = zeile.startsWith('\t') ? FONT_CELL : 0;
    const run: GlyphRun = layoutGlyphRun(zeile.replace(/\t/g, ''), font.codes, font.widths);
    fehlend += run.fehlend;
    const zeilenEl = doc.createElement('div') as unknown as GlyphContainer;
    zeilenEl.style.setProperty('display', 'block');
    zeilenEl.style.setProperty('height', px(lineHeight));
    zeilenEl.style.setProperty('white-space', 'nowrap');
    if (einzug) zeilenEl.style.setProperty('padding-left', px(einzug * scale));
    const glyphKinder: unknown[] = [];
    for (const g of run.glyphen) {
      const span = doc.createElement('span') as unknown as GlyphNode;
      const s = span.style;
      s.setProperty('display', 'inline-block');
      if (g.code !== null) s.setProperty('width', px(g.advance * scale));
      s.setProperty('height', px(FONT_CELL * scale));
      // Grundlinie: die Zelle sitzt unten in der Zeilenhöhe, damit Zeilen mit
      // und ohne Unterlängen dieselbe Grundlinie behalten.
      s.setProperty('vertical-align', 'top');
      s.setProperty('margin-top', px(Math.max(0, lineHeight - FONT_CELL * scale)));
      if (g.code === null) {
        // Fehlstelle: **sichtbar** in Systemschrift setzen, nicht verschlucken.
        // Der Auswahlzeiger ist der Regelfall dafür — er ist kein Blattzeichen,
        // sondern sitzt in der Fenstergrafik (WINDOW.BIN Sektion 0). Ein leeres
        // Kästchen hätte ihn stumm verschwinden lassen.
        s.setProperty('background', 'none');
        s.setProperty('font-size', px(Math.round(FONT_CELL * scale * 0.85)));
        s.setProperty('line-height', px(FONT_CELL * scale));
        s.setProperty('color', skin.textColor);
        span.textContent = g.ch;
        // `dataset` ist im echten DOM nur lesbar — beschrieben wird der
        // Eintrag, nicht das Objekt ersetzt.
        const ds = (span as unknown as { dataset?: Record<string, string> }).dataset;
        if (ds) ds['fehlend'] = g.ch;
      } else {
        s.setProperty('background-image', `url(${atlasUrl})`);
        s.setProperty(
          'background-size',
          `${px(font.atlasWidth * scale)} ${px(font.atlasHeight * scale)}`,
        );
        s.setProperty('background-position', `${px(-g.sx * scale)} ${px(-g.sy * scale)}`);
        s.setProperty('image-rendering', 'pixelated');
        glyphen++;
      }
      glyphKinder.push(span);
    }
    zeilenEl.replaceChildren(...glyphKinder);
    kinder.push(zeilenEl);
  }
  el.replaceChildren(...kinder);
  return { gezeichnet: true, glyphen, fehlend, zeilen: zeilenText.length };
}
