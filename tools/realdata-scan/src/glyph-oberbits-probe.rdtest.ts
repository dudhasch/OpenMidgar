import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWindowBin, measureGlyphInkWidths, buildFieldTextTable } from '@webmidgar/formats-kernel';
import { buildGlyphCodeMap } from '@webmidgar/ui-window';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * Die oberen Bits des Breitenbytes (Welle 3) — **Zusatzbreite oder Versatz?**
 *
 * Stand vor dieser Messung (Welle-2-Abnahme, dritter Vorbehalt): Die
 * Fenstermessung entscheidet sich klar für die *additive* Auslegung
 * `(b & 0x1F) + (b >> 5)`, aber für 12–15 Zeichen (`"` `(` `)` `,` `.` `1` `:`
 * und einige Akzentgroßbuchstaben) läuft sie mit der Namensplatzhalter-
 * Rechnung auseinander. Solange der Text aus einer Systemschrift kam, war das
 * nicht entscheidbar — es gab keine gezeichnete Glyphe, an der man messen
 * konnte.
 *
 * Jetzt gibt es sie, und damit eine **dritte, unabhängige Achse**: die
 * Tintenbreite der Zelle im Fontblatt. Für 194 von 212 Glyphen gilt
 * `Vorschub = Tinte + 1`. Die Frage ist deshalb scharf gestellt:
 *
 *   Trifft bei den Zeichen mit gesetzten oberen Bits die **additive** Regel
 *   die Tinte, oder die **untere 5-Bit**-Auslegung?
 *
 * Beide Auslegungen werden getrennt für die zwei Gruppen gerechnet (obere
 * Bits gesetzt / nicht gesetzt). Die Gruppe ohne obere Bits ist dabei die
 * eingebaute **Kontrolle**: dort sind beide Auslegungen identisch, also muss
 * dort auch dieselbe Quote herauskommen — tut sie das nicht, misst die Probe
 * etwas anderes als gedacht.
 */


const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: obere Bits des Glyphenbreiten-Bytes', () => {
  it('prüft additive Auslegung gegen untere 5 Bit an der Tintenbreite', async () => {
    const winBytes = new Uint8Array(await readFile(realPfad('kernel/WINDOW.BIN')));
    const win = await parseWindowBin(winBytes, 'WINDOW.BIN');
    const font = win.fontTexture!;
    const ink = measureGlyphInkWidths(font);
    const codes = buildGlyphCodeMap(buildFieldTextTable());
    const zeichenFuerCode = new Map<number, string>();
    for (const [ch, code] of codes) if (!zeichenFuerCode.has(code)) zeichenFuerCode.set(code, ch);

    const gruppen = { mitOberbits: [] as number[], ohneOberbits: [] as number[] };
    for (let code = 0; code < 256; code++) {
      if (ink[code] === 0) continue; // leere Zelle: kein Urteil möglich
      const b = win.rawGlyphBytes[code]!;
      (b >> 5 ? gruppen.mitOberbits : gruppen.ohneOberbits).push(code);
    }

    const quote = (menge: number[], regel: (b: number) => number): string => {
      const treffer = menge.filter((c) => regel(win.rawGlyphBytes[c]!) === ink[c]! + 1).length;
      return `${((treffer / menge.length) * 100).toFixed(1)} % (${treffer}/${menge.length})`;
    };
    const additiv = (b: number): number => (b & 0x1f) + (b >> 5);
    const low5 = (b: number): number => b & 0x1f;

    const beispiele = gruppen.mitOberbits.map((code) => ({
      zeichen: zeichenFuerCode.get(code) ?? `#${code}`,
      code,
      byte: win.rawGlyphBytes[code],
      tinte: ink[code],
      additiv: additiv(win.rawGlyphBytes[code]!),
      low5: low5(win.rawGlyphBytes[code]!),
    }));

    const bericht = {
      mitOberbits: {
        anzahl: gruppen.mitOberbits.length,
        additivTrifftTinte: quote(gruppen.mitOberbits, additiv),
        low5TrifftTinte: quote(gruppen.mitOberbits, low5),
        beispiele,
      },
      ohneOberbits: {
        anzahl: gruppen.ohneOberbits.length,
        additivTrifftTinte: quote(gruppen.ohneOberbits, additiv),
        low5TrifftTinte: quote(gruppen.ohneOberbits, low5),
      },
    };
    console.log(JSON.stringify(bericht, null, 1));

    // Kontrolle: ohne obere Bits sind beide Auslegungen dieselbe Rechnung.
    expect(bericht.ohneOberbits.additivTrifftTinte).toBe(bericht.ohneOberbits.low5TrifftTinte);
    expect(gruppen.mitOberbits.length).toBeGreaterThan(0);
  });
});
