import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWindowBin, FONT_CELL, FONT_CELLS_PER_ROW } from '@webmidgar/formats-kernel';

/**
 * Fontblatt-Probe (Welle 3): Bevor die Demo aus dem Fontblatt zeichnet, muss
 * gemessen sein, **wie** eine Zelle aufgebaut ist. Vier Fragen, die die
 * Zeichenregel bestimmen und die man nicht raten darf:
 *
 *   1. Welche Palettenindizes kommen im Blatt überhaupt vor? Ein Blatt mit nur
 *      zwei Indizes ist eine reine Maske; mehr Indizes hießen Kantenglättung
 *      oder Schattenkante, die man beim Zeichnen erhalten muss.
 *   2. Welche Farben stehen in der Palette, und gibt es mehrere Palettenzeilen
 *      (Textfarben des Originals)?
 *   3. Sitzt die Tinte am Zellenursprung, oder trägt jede Zelle einen Versatz?
 *      Davon hängt ab, ob man Zellen 1:1 als Kachel zeichnen darf.
 *   4. Wie hoch ist die Tinte tatsächlich? Sie entscheidet, ob 12 px Zellhöhe
 *      und die gemessene Zeilenhöhe 16 (×2 = 32) zusammenpassen.
 *
 * **Kontrollniveau** für Frage 3: Wäre der Zellenursprung falsch (Raster um
 * einen Pixel verschoben), müssten Tintenkästen regelmäßig an den rechten oder
 * unteren Zellenrand stoßen bzw. überlaufen. Gezählt wird deshalb, wie viele
 * Zellen die Randspalte/-zeile berühren — bei richtigem Raster ist das für die
 * *linke* Spalte häufig (Glyphen sind linksbündig) und für die *rechte*
 * Randspalte selten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Aufbau des Fontblatts (WINDOW.BIN Sektion 1)', () => {
  it('misst Indexvorrat, Palette, Zellenursprung und Tintenhöhe', async () => {
    const winBytes = new Uint8Array(await readFile(join(REAL_DIR, 'data', 'kernel', 'WINDOW.BIN')));
    const win = await parseWindowBin(winBytes, 'WINDOW.BIN');
    const font = win.fontTexture;
    expect(font).not.toBeNull();
    if (!font) return;

    // --- 1. Indexvorrat ----------------------------------------------------
    const hist = new Array<number>(16).fill(0);
    for (const i of font.indices) hist[i]! += 1;
    const belegt = hist.map((n, i) => ({ index: i, anzahl: n })).filter((e) => e.anzahl > 0);

    // --- 2. Palette --------------------------------------------------------
    const paletten: string[][] = [];
    for (let row = 0; row < font.clutHeight; row++) {
      const zeile: string[] = [];
      for (let i = 0; i < font.clutWidth; i++) {
        const o = (row * font.clutWidth + i) * 4;
        zeile.push(
          `${font.palette[o]},${font.palette[o + 1]},${font.palette[o + 2]},${font.palette[o + 3]}`,
        );
      }
      paletten.push(zeile);
    }

    // --- 3./4. Tintenkästen je Zelle --------------------------------------
    let belegteZellen = 0;
    let linksBuendig = 0;
    let obenBuendig = 0;
    let beruehrtRechts = 0;
    let beruehrtUnten = 0;
    let maxHoehe = 0;
    let minTop = FONT_CELL;
    let maxBottom = 0;
    const hoehen = new Map<number, number>();
    const tops = new Map<number, number>();
    for (let code = 0; code < 256; code++) {
      const col = code % FONT_CELLS_PER_ROW;
      const row = Math.floor(code / FONT_CELLS_PER_ROW);
      const x0 = col * FONT_CELL;
      const y0 = row * FONT_CELL;
      if (y0 + FONT_CELL > font.height || x0 + FONT_CELL > font.width) continue;
      let l = FONT_CELL;
      let t = FONT_CELL;
      let r = -1;
      let b = -1;
      for (let y = 0; y < FONT_CELL; y++) {
        for (let x = 0; x < FONT_CELL; x++) {
          if (!font.indices[(y0 + y) * font.width + x0 + x]) continue;
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < t) t = y;
          if (y > b) b = y;
        }
      }
      if (r < 0) continue;
      belegteZellen++;
      if (l === 0) linksBuendig++;
      if (t === 0) obenBuendig++;
      if (r === FONT_CELL - 1) beruehrtRechts++;
      if (b === FONT_CELL - 1) beruehrtUnten++;
      const h = b - t + 1;
      maxHoehe = Math.max(maxHoehe, h);
      minTop = Math.min(minTop, t);
      maxBottom = Math.max(maxBottom, b);
      hoehen.set(h, (hoehen.get(h) ?? 0) + 1);
      tops.set(t, (tops.get(t) ?? 0) + 1);
    }

    console.log(
      JSON.stringify(
        {
          blatt: { breite: font.width, hoehe: font.height, bpp: font.bpp },
          clut: { breite: font.clutWidth, zeilen: font.clutHeight },
          indexvorrat: belegt,
          paletten,
          zellen: {
            belegt: belegteZellen,
            linksBuendig,
            obenBuendig,
            beruehrtRechteRandspalte: beruehrtRechts,
            beruehrtUntereRandzeile: beruehrtUnten,
          },
          tinte: {
            maxHoehe,
            minTop,
            maxBottom,
            hoehenHistogramm: [...hoehen].sort((a, b2) => b2[1] - a[1]),
            topHistogramm: [...tops].sort((a, b2) => b2[1] - a[1]),
          },
        },
        null,
        1,
      ),
    );

    expect(font.width).toBe(256);
    expect(font.height).toBe(252);
  });
});
