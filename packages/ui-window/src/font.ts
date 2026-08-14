/**
 * Die **Spielschrift** — Text aus dem Fontblatt in `WINDOW.BIN` statt aus
 * einer Systemschrift (Welle 3, schließt den dritten tragenden Vorbehalt der
 * Welle-2-Abnahme).
 *
 * 🔵 **Warum hier und nicht in `formats-kernel`.** Der Parser liefert das
 * Blatt als Palettenbild; was eine *Zeile Text* daraus wird, ist eine
 * Darstellungsfrage und gehört zur Fensterschale — derselben, die Dialog,
 * Menü und Kampf-HUD teilen. Dieses Modul ist DOM-frei und in Node testbar;
 * die einzige Stelle mit Elementberührung ist `text-paint.ts`.
 *
 * 🟢 **Aufbau des Blattes, gemessen** (`tools/realdata-scan/src/fontblatt-probe.rdtest.ts`,
 * deutsche Steam-Installation):
 *
 * | Größe | Befund |
 * |---|---|
 * | Blatt | 256 × 252, 4 bpp, Zellen 12 × 12, 21 je Zeile — Zellennummer **ist** der Textcode |
 * | Palettenindizes im Bestand | nur **0, 1, 3** — 0 durchsichtig, 1 dunkel, 3 hell |
 * | Paletten | 8 Zeilen à 32 Einträge; je Zeile wiederholen sich vier Farben |
 * | belegte Zellen | 212, davon **212 linksbündig** (Tinte beginnt in Spalte 0) |
 * | rechte Randspalte berührt | **1 von 212** — Kontrollniveau für „Raster sitzt richtig" |
 * | Tintenhöhe | Median 9, Maximum 12 (füllt die Zelle) |
 *
 * Zwei Folgerungen, die den Zeichenweg bestimmen:
 *
 * 1. **Der Schatten steckt im Blatt.** Index 1 ist die dunkle Kante, Index 3
 *    der Körper. Wer aus dem Blatt zeichnet, darf **keinen** CSS-Schatten mehr
 *    dazugeben — der käme doppelt.
 * 2. **Die Farbe ist eine Palettenzeile, kein CSS-Wert.** Die acht Zeilen sind
 *    die Textfarben des Originals (grau, blau, rot, magenta, grün, cyan, gelb,
 *    weiß). Farbwechsel im Text sind damit ein Zeilenwechsel, kein Umfärben.
 */

import type { FfTextTable, TimImage } from '@webmidgar/formats-kernel';
import { FONT_CELL, FONT_CELLS_PER_ROW } from '@webmidgar/formats-kernel';

export { FONT_CELL, FONT_CELLS_PER_ROW };

/**
 * Palettenzeilen des Fontblatts. Die Namen beschreiben die **gemessenen**
 * Farben der jeweiligen Zeile (hellster Eintrag), nicht eine übernommene
 * Codetabelle: 🟡 welcher Farbcode des Textstroms welche Zeile wählt, ist
 * damit noch nicht belegt — dafür braucht es einen Sichtabgleich an einem
 * Dialog mit Farbcode.
 */
export enum FontPalette {
  /** 106,106,106 — gedämpftes Grau. */
  Grau = 0,
  /** 0,98,189 */
  Blau = 1,
  /** 189,0,0 */
  Rot = 2,
  /** 230,0,230 */
  Magenta = 3,
  /** 90,230,123 */
  Gruen = 4,
  /** 0,230,230 */
  Cyan = 5,
  /** 230,230,0 */
  Gelb = 6,
  /** 230,230,230 — die Standardfarbe des Dialogtextes. */
  Weiss = 7,
}

/** Vorgabe: die weiße Zeile, mit der das Original Dialoge setzt. */
export const DEFAULT_FONT_PALETTE = FontPalette.Weiss;

/**
 * Wiedergabemaßstab: Die Spielfläche des Originals ist 320 × 224, unsere
 * Renderfläche 640 × 480 — eine 12-px-Zelle wird also 24 px hoch. Genau
 * dieser Faktor steckt auch in der gemessenen Zeilenhöhe 32 (16 im Original).
 */
export const FONT_SCALE = 2;

export interface GlyphAtlas {
  width: number;
  height: number;
  /** RGBA8, Zeile für Zeile — direkt in eine Textur/Canvas übertragbar. */
  rgba: Uint8Array;
  cell: number;
  perRow: number;
  paletteRow: number;
  /** Zellen mit Tinte; die übrigen Codes zeichnen nichts. */
  belegteZellen: number;
}

/**
 * Baut das Blatt einer Palettenzeile als RGBA8.
 *
 * Der Palettenblock ist `clutWidth` Einträge breit; die vier tatsächlich
 * benutzten Farben stehen am Zeilenanfang. Indizes außerhalb der Zeile fallen
 * auf durchsichtig zurück — stilles Ersetzen durch eine Nachbarfarbe wäre ein
 * Ratewert.
 */
export function buildGlyphAtlas(
  font: TimImage,
  paletteRow: number = DEFAULT_FONT_PALETTE,
): GlyphAtlas {
  const rgba = new Uint8Array(font.width * font.height * 4);
  const base = paletteRow * font.clutWidth * 4;
  const rowValid = paletteRow >= 0 && paletteRow < font.clutHeight;
  for (let i = 0; i < font.indices.length; i++) {
    const idx = font.indices[i]!;
    if (!rowValid || idx >= font.clutWidth) continue;
    const o = base + idx * 4;
    rgba[i * 4 + 0] = font.palette[o + 0] ?? 0;
    rgba[i * 4 + 1] = font.palette[o + 1] ?? 0;
    rgba[i * 4 + 2] = font.palette[o + 2] ?? 0;
    rgba[i * 4 + 3] = font.palette[o + 3] ?? 0;
  }
  let belegteZellen = 0;
  for (let code = 0; code < 256; code++) {
    const r = cellRect(code);
    if (r.y + FONT_CELL > font.height || r.x + FONT_CELL > font.width) continue;
    let ink = false;
    for (let y = 0; y < FONT_CELL && !ink; y++) {
      for (let x = 0; x < FONT_CELL; x++) {
        if (font.indices[(r.y + y) * font.width + r.x + x]) {
          ink = true;
          break;
        }
      }
    }
    if (ink) belegteZellen++;
  }
  return {
    width: font.width,
    height: font.height,
    rgba,
    cell: FONT_CELL,
    perRow: FONT_CELLS_PER_ROW,
    paletteRow,
    belegteZellen,
  };
}

/** Lage einer Zelle im Blatt. Die Zellennummer ist der Textcode. */
export function cellRect(code: number): { x: number; y: number } {
  return {
    x: (code % FONT_CELLS_PER_ROW) * FONT_CELL,
    y: Math.floor(code / FONT_CELLS_PER_ROW) * FONT_CELL,
  };
}

/**
 * **Rückabbildung Zeichen → Textcode.**
 *
 * Der Dialogweg dekodiert Bytes früh zu einer Zeichenkette; zum Zeichnen wird
 * der Code wieder gebraucht. Statt eine zweite Tabelle zu pflegen (die
 * auseinanderliefe), wird die Umkehr **aus derselben `FfTextTable` abgeleitet**,
 * mit der dekodiert wurde. Mehrzeichige Belegungen (Namensplatzhalter wie
 * `{Cloud}`, `', '`) haben keinen eigenen Code — sie zerfallen beim Zeichnen
 * in ihre Einzelzeichen, die ihrerseits Codes haben.
 *
 * Bei Mehrdeutigkeit gewinnt der **kleinste** Code: die linearen Fenster
 * werden zuerst eingetragen, Sonderbelegungen überschreiben nur, was noch
 * nicht belegt ist. Damit ist die Abbildung deterministisch.
 */
export function buildGlyphCodeMap(table: FfTextTable): Map<string, number> {
  const map = new Map<string, number>();
  for (const win of table.windows) {
    for (let b = win.from; b <= win.to; b++) {
      const ch = String.fromCodePoint(b + win.offset);
      if (!map.has(ch)) map.set(ch, b);
    }
  }
  for (const [key, value] of Object.entries(table.overrides)) {
    const code = Number(key);
    if (![...value].length || [...value].length > 1) continue;
    if (!map.has(value)) map.set(value, code);
  }
  return map;
}

export interface RunGlyph {
  /** Textcode; `null` = kein Zeichen im Blatt (wird als Lücke gezeichnet). */
  code: number | null;
  /** Quellposition im Blatt (unskaliert). */
  sx: number;
  sy: number;
  /** Vorschub in Blattpixeln (unskaliert). */
  advance: number;
  /** Das Zeichen selbst — für Diagnose und Fallback. */
  ch: string;
}

export interface GlyphRun {
  glyphen: RunGlyph[];
  /** Gesamtbreite in Blattpixeln. */
  breite: number;
  /** Zeichen ohne Code — die Fehlstellen dieser Zeile. */
  fehlend: number;
}

/**
 * Setzt eine **einzelne Zeile** in Glyphen um. Umbrüche macht der Aufrufer
 * (`@webmidgar/dialog` kann das bereits); dieses Modul kennt keine Zeilen.
 *
 * `widths` ist die Tabelle aus `WINDOW.BIN` (Index = Textcode). Fehlt sie,
 * bleibt der Vorschub die Zellenbreite — sichtbar zu breit, aber nie stumm
 * falsch.
 */
export function layoutGlyphRun(
  text: string,
  codes: Map<string, number>,
  widths: Uint8Array | null,
): GlyphRun {
  const glyphen: RunGlyph[] = [];
  let breite = 0;
  let fehlend = 0;
  for (const ch of text) {
    const code = codes.get(ch);
    if (code === undefined) {
      fehlend++;
      const advance = widths?.[codes.get(' ') ?? 0] ?? FONT_CELL;
      glyphen.push({ code: null, sx: 0, sy: 0, advance, ch });
      breite += advance;
      continue;
    }
    const rect = cellRect(code);
    const advance = widths && widths.length > code ? widths[code]! : FONT_CELL;
    glyphen.push({ code, sx: rect.x, sy: rect.y, advance, ch });
    breite += advance;
  }
  return { glyphen, breite, fehlend };
}
