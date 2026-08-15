import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { decodeFieldDialogs } from '@webmidgar/field-runtime';
import {
  parseWindowBin,
  measureGlyphInkWidths,
  buildFieldTextTable,
} from '@webmidgar/formats-kernel';
import { buildGlyphCodeMap, buildGlyphAtlas, cellRect, FONT_CELL } from '@webmidgar/ui-window';
import { NodeDirectorySource } from './node-source.js';
import { REAL_DIR, realPfad } from './real-pfade.js';

/**
 * Schrift-Abdeckung (Welle 3): Lässt sich der **echte** Dialogbestand aus dem
 * Fontblatt zeichnen — und ist die Kette Zeichen → Textcode → Zelle stimmig?
 *
 * **Zwei getrennte Fragen, zwei getrennte Zahlen.**
 *
 * 1. *Abdeckung* — wie viele Zeichen aller Felddialoge haben überhaupt einen
 *    Textcode? Fehlstellen sind sichtbare Lücken im Text, deshalb wird ihr
 *    Zeichensatz mitgezählt und benannt (Zeichen, nicht Inhalt).
 *
 * 2. *Stimmigkeit* — sitzt hinter dem Code auch die richtige Zelle? Dafür gibt
 *    es eine **scharfe Vorhersage**, die nichts mit unserer Abbildung zu tun
 *    hat: Für die deutsche Fassung gilt `Vorschub = Tintenbreite + 1` (in
 *    Welle 2 an 194 von 212 Glyphen gemessen). Wenn Zeichen → Code → Zelle
 *    stimmt, muss diese Gleichung für die *tatsächlich vorkommenden* Zeichen
 *    genauso halten.
 *
 * **Kontrollniveau:** dieselbe Rechnung mit um ±1 verschobener Zelle. Das
 * Blatt ist dicht belegt (212 von 256 Zellen tragen Tinte), eine bloße
 * „Zelle nicht leer"-Quote wäre also blind — die Tintenbreite des Nachbarn ist
 * dagegen eine andere Zahl, und genau daran scheitert eine falsche Zuordnung.
 */


const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Spielschrift gegen den echten Dialogbestand', () => {
  it(
    'deckt die Felddialoge ab und trifft die Tintenbreiten der Zellen',
    { timeout: 900_000 },
    async () => {
      const winBytes = new Uint8Array(await readFile(realPfad('kernel/WINDOW.BIN')));
      const win = await parseWindowBin(winBytes, 'WINDOW.BIN');
      expect(win.fontTexture).not.toBeNull();
      const font = win.fontTexture!;
      const ink = measureGlyphInkWidths(font);
      const codes = buildGlyphCodeMap(buildFieldTextTable());
      const atlas = buildGlyphAtlas(font);

      // --- Dialogbestand einlesen -------------------------------------------
      const index = new IndexService();
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      await index.openSource(dir, { deep: false });
      const felder = index.listEntries('flevel').filter((e) => !e.name.includes('.'));

      let zeichen = 0;
      let mitCode = 0;
      const fehlstellen = new Map<string, number>();
      const codeHaeufigkeit = new Map<number, number>();
      let felderGelesen = 0;

      for (const eintrag of felder) {
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(eintrag.canonicalId), eintrag.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle) continue;
        felderGelesen++;
        for (const dialog of decodeFieldDialogs(parsed.bundle)) {
          if (!dialog) continue;
          for (const ch of dialog) {
            if (ch === '\n' || ch === '\t') continue;
            zeichen++;
            const code = codes.get(ch);
            if (code === undefined) {
              fehlstellen.set(ch, (fehlstellen.get(ch) ?? 0) + 1);
              continue;
            }
            mitCode++;
            codeHaeufigkeit.set(code, (codeHaeufigkeit.get(code) ?? 0) + 1);
          }
        }
      }
      await dir.closeAll();

      const abdeckung = mitCode / zeichen;

      // --- Stimmigkeit: Vorschub == Tintenbreite + 1 ------------------------
      const pruefe = (versatz: number): { treffer: number; gewichtet: number; grund: number } => {
        let treffer = 0;
        let gewichtet = 0;
        let grund = 0;
        for (const [code, anzahl] of codeHaeufigkeit) {
          const zelle = code + versatz;
          if (zelle < 0 || zelle > 255) continue;
          grund += anzahl;
          const breite = win.glyphWidths[code] ?? 0;
          if (breite === ink[zelle]! + 1) {
            treffer++;
            gewichtet += anzahl;
          }
        }
        return { treffer, gewichtet, grund };
      };
      const regel = pruefe(0);
      const kontrollePlus = pruefe(+1);
      const kontrolleMinus = pruefe(-1);

      const bericht = {
        felder: felderGelesen,
        zeichen,
        abdeckung: `${(abdeckung * 100).toFixed(4)} % (${mitCode}/${zeichen})`,
        verschiedeneCodes: codeHaeufigkeit.size,
        fehlstellen: [...fehlstellen]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([ch, n]) => ({ zeichen: ch, codepoint: ch.codePointAt(0), anzahl: n })),
        belegteZellen: atlas.belegteZellen,
        stimmigkeit: {
          regel: `${((regel.gewichtet / regel.grund) * 100).toFixed(2)} % gewichtet, ${regel.treffer}/${codeHaeufigkeit.size} Zeichen`,
          kontrolleZellePlus1: `${((kontrollePlus.gewichtet / kontrollePlus.grund) * 100).toFixed(2)} %`,
          kontrolleZelleMinus1: `${((kontrolleMinus.gewichtet / kontrolleMinus.grund) * 100).toFixed(2)} %`,
        },
      };
      console.log(JSON.stringify(bericht, null, 1));

      // Abdeckung: der Bestand muss praktisch vollständig zeichenbar sein.
      expect(abdeckung).toBeGreaterThan(0.99);
      // Stimmigkeit: die Regel muss ihre Kontrollen deutlich schlagen.
      expect(regel.gewichtet / regel.grund).toBeGreaterThan(
        Math.max(kontrollePlus.gewichtet / kontrollePlus.grund, kontrolleMinus.gewichtet / kontrolleMinus.grund) * 1.5,
      );
      // Und die Zellen, die wir adressieren, müssen im Blatt liegen.
      for (const code of codeHaeufigkeit.keys()) {
        const r = cellRect(code);
        expect(r.x + FONT_CELL).toBeLessThanOrEqual(font.width);
        expect(r.y + FONT_CELL).toBeLessThanOrEqual(font.height);
      }
    },
  );
});
