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
 * Palettenzeilen, die das Menü außer der Vorgabe braucht.
 *
 * 🟢 Die Zahlen sind die Farbindizes, die der Gegenstands-Bildschirm des
 * Originals setzt: 0 für einen im Menü gesperrten Gegenstand, 2 für eine
 * kampfunfähige Figur, 5 für die Beschriftungen LV/HP/MP, 6 für einen Wert auf
 * höchstens einem Viertel des Maximums. Sie treffen ohne Umrechnung auf unsere
 * gemessenen Palettenzeilen — siehe `FARBE` in `@webmidgar/menu`.
 */
const MENUE_PALETTEN = [0, 2, 5, 6] as const;

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
  const alsDatenUrl = (zeile: number): string => {
    const a = buildGlyphAtlas(font, zeile);
    const c = new Uint8ClampedArray(a.width * a.height * 4);
    c.set(a.rgba);
    ctx.putImageData(new ImageData(c, a.width, a.height), 0, 0);
    return canvas.toDataURL('image/png');
  };

  // Erst die Nebenzeilen, zuletzt die Vorgabezeile — so bleibt das Canvas mit
  // dem Vorgabeblatt zurück und der Kontext ist ohne weitere Umwege stimmig.
  const palettes: Record<number, string> = {};
  for (const zeile of MENUE_PALETTEN) palettes[zeile] = alsDatenUrl(zeile);
  const atlasUrl = alsDatenUrl(paletteRow);
  palettes[paletteRow] = atlasUrl;

  const widths = windowBin?.glyphWidths.length === 256 ? windowBin.glyphWidths : null;
  return {
    kontext: {
      atlasUrl,
      atlasWidth: atlas.width,
      atlasHeight: atlas.height,
      codes: buildGlyphCodeMap(buildFieldTextTable()),
      widths,
      palettes,
    },
    hinweis:
      `Spielschrift aus WINDOW.BIN (${atlas.belegteZellen} belegte Zellen, ` +
      `Palettenzeile ${paletteRow} + ${MENUE_PALETTEN.length} Menüfarben, ` +
      `Vorschub ${widths ? 'aus der Breitentabelle' : 'ersatzweise Zellenbreite'})`,
  };
}
