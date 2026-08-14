/**
 * Spielschrift für die Demo (Welle 3).
 *
 * Hier — und nur hier — wird aus dem gemessenen Fontblatt ein Bild, das der
 * Browser als Hintergrund verwenden kann. Alles Entscheidbare (Zellenlage,
 * Vorschub, Palettenzeile, Rückabbildung Zeichen → Code) steckt in
 * `@webmidgar/ui-window`; dieses Modul kennt nur Canvas und Daten-URL.
 */

import {
  buildGlyphAtlas,
  buildGlyphCodeMap,
  DEFAULT_FONT_PALETTE,
  type FontContext,
} from '@webmidgar/ui-window';
import { buildFieldTextTable, type WindowBin } from '@webmidgar/formats-kernel';

export interface FontAufbau {
  kontext: FontContext | null;
  /** Für den Bootlog — sagt, welcher Weg gilt und warum. */
  hinweis: string;
}

/**
 * Baut den Zeichenkontext aus `WINDOW.BIN`. Fehlt die Datei oder ihr
 * Fontblatt, bleibt es bei der Systemschrift — mit Begründung, nie stumm.
 */
export function buildFontContext(
  windowBin: WindowBin | null,
  paletteRow: number = DEFAULT_FONT_PALETTE,
): FontAufbau {
  const font = windowBin?.fontTexture ?? null;
  if (!font) {
    return {
      kontext: null,
      hinweis: windowBin
        ? 'WINDOW.BIN ohne lesbares Fontblatt — Text weiter in Systemschrift'
        : 'WINDOW.BIN fehlt — Text weiter in Systemschrift',
    };
  }
  const atlas = buildGlyphAtlas(font, paletteRow);
  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { kontext: null, hinweis: 'Kein 2D-Kontext für das Fontblatt — Systemschrift' };
  }
  const clamped = new Uint8ClampedArray(atlas.width * atlas.height * 4);
  clamped.set(atlas.rgba);
  ctx.putImageData(new ImageData(clamped, atlas.width, atlas.height), 0, 0);
  const widths = windowBin?.glyphWidths.length === 256 ? windowBin.glyphWidths : null;
  return {
    kontext: {
      atlasUrl: canvas.toDataURL('image/png'),
      atlasWidth: atlas.width,
      atlasHeight: atlas.height,
      codes: buildGlyphCodeMap(buildFieldTextTable()),
      widths,
    },
    hinweis:
      `Spielschrift aus WINDOW.BIN (${atlas.belegteZellen} belegte Zellen, ` +
      `Palettenzeile ${paletteRow}, Vorschub ${widths ? 'aus der Breitentabelle' : 'ersatzweise Zellenbreite'})`,
  };
}
