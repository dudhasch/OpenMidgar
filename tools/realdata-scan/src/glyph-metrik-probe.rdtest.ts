import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, SKIP_OPERAND_LEN, OP, OP_KAWAI } from '@webmidgar/interpreter';
import {
  parseWindowBin,
  spacingTableFrom,
  spacingFromWindowBin,
  nameSlotWidthFrom,
  measureFfWindow,
  FALLBACK_SPACING,
  EXE_DEFAULTS,
} from '@webmidgar/formats-kernel';
import { NodeDirectorySource } from './node-source.js';

/**
 * Glyphenmetrik-Probe (Welle 2): Ist die aus `WINDOW.BIN` gelesene
 * Breitentabelle die Metrik, mit der Square die Fenstergrößen der echten
 * Dialoge bestimmt hat?
 *
 * **Scharfe Vorhersage.** FF7 kennt keinen Autowrap: die Fensterbreite eines
 * Dialogs ist `längste Zeile + Polsterung`. Square hat die `w`-Operanden der
 * WINDOW-Opcodes mit genau dieser Rechnung erzeugt. Also muss gelten:
 *   (a) *keine* Zeile darf breiter sein als das Fenster (Verletzungsquote 0),
 *   (b) für automatisch bemessene Fenster muss die Vorhersage den deklarierten
 *       Wert sogar **exakt treffen**.
 *
 * **Kontrollniveaus** (ohne die wäre jede Quote wertlos):
 *   - `fallback`   — die alte Ersatzmetrik (jedes Zeichen 8 px),
 *   - `shuffled`   — dieselbe Tabelle, Werte deterministisch verwürfelt,
 *   - `constMean`  — jedes Zeichen der Mittelwert der echten Tabelle,
 *   - `low5`       — Konkurrenzauslegung des Tabellenbytes (nur untere 5 Bit).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Zusammenhängende Bytecode-Dekodierung: Opcode → Gesamtlänge der Instruktion. */
function instrLen(code: Uint8Array, at: number): number | null {
  const op = code[at];
  if (op === undefined) return null;
  if (op === OP_KAWAI) {
    const len = code[at + 1];
    return len === undefined || len < 2 ? null : len;
  }
  const n = IMPL_OPERAND_LEN[op] ?? SKIP_OPERAND_LEN[op];
  return n === undefined ? null : 1 + n;
}

interface WindowRecord {
  field: string;
  /** Deklarierte Fensterbreite aus dem WINDOW-Opcode. */
  declaredW: number;
  declaredH: number;
  /** Rohbytes des zugeordneten Dialogstrings (ohne 0xFF). */
  text: Uint8Array;
}

describe.skipIf(!available)('Realdaten: Glyphenmetrik aus WINDOW.BIN gegen echte Fenstergrößen', () => {
  it(
    'Vorhersage der Fensterbreite trifft die deklarierte Breite',
    { timeout: 600_000 },
    async () => {
      // --- 1. WINDOW.BIN lesen und Accounting prüfen -------------------------
      const winPath = join(REAL_DIR, 'data', 'kernel', 'WINDOW.BIN');
      const winBytes = new Uint8Array(await readFile(winPath));
      const win = await parseWindowBin(winBytes, 'WINDOW.BIN');
      expect(win.diagnostics.map((d) => d.code)).toEqual([]);
      expect(win.sections.length).toBe(3);
      expect(win.glyphWidths.length).toBe(256);
      // Accounting: Sektionen + Nullrest füllen die Datei byteexakt.
      const consumed = win.sections.reduce((n, s) => n + 6 + s.compressedLength, 0);
      expect(consumed + win.trailerLength).toBe(winBytes.length);

      const real = spacingFromWindowBin(win)!;
      expect(real).not.toBeNull();
      // 🟢 Namensbreite fällt aus den Daten: 9 × breiteste Zeichenbreite.
      expect(nameSlotWidthFrom(win.rawGlyphBytes)).toBe(117);

      // --- 2. Kontrollniveaus -----------------------------------------------
      const mean = Math.round(
        win.glyphWidths.slice(0, 0xe0).reduce((a, b) => a + b, 0) / 0xe0,
      );
      const shuffledWidths = (() => {
        const arr = Uint8Array.from(win.glyphWidths);
        // Deterministische Permutation (LCG) — dieselbe Werteverteilung,
        // aber die Zuordnung Zeichen→Breite ist zerstört.
        let s = 0x1234_5678;
        for (let i = arr.length - 1; i > 0; i--) {
          s = (s * 1103515245 + 12345) >>> 0;
          const j = s % (i + 1);
          const t = arr[i]!;
          arr[i] = arr[j]!;
          arr[j] = t;
        }
        return arr;
      })();
      const low5Widths = Uint8Array.from(win.rawGlyphBytes, (b) => b & 0x1f);

      const nw = { nameWidth: nameSlotWidthFrom(win.rawGlyphBytes) };
      const variants: Record<string, ReturnType<typeof spacingTableFrom>> = {
        real,
        low5: spacingTableFrom(low5Widths, nw),
        shuffled: spacingTableFrom(shuffledWidths, nw),
        constMean: spacingTableFrom(Uint8Array.from({ length: 256 }, () => mean), nw),
        fallback: FALLBACK_SPACING,
      };

      // --- 3. Fenster + zugehörigen Dialog aus echten Fields sammeln ---------
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      const records: WindowRecord[] = [];
      let fields = 0;

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        const set = parsed.bundle?.script;
        const raw = parsed.bundle?.rawSections[1];
        if (!parsed.ok || !set || !raw) continue;
        fields++;

        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const strTab = set.stringTableOffset;

        // Rohbytes eines Dialogs (String-Index → Bytes bis 0xFF).
        const stringBytes = (id: number): Uint8Array | null => {
          const off = set.stringOffsets[id];
          if (off === null || off === undefined) return null;
          const start = strTab + off;
          if (start >= raw.byteLength) return null;
          let end = start;
          while (end < raw.byteLength && raw[end] !== 0xff) end++;
          return raw.subarray(start, end);
        };

        // Fenstergeometrie je Fenster-Slot, entitätsweise fortgeschrieben.
        for (const span of set.spans) {
          const geom = new Map<number, { w: number; h: number }>();
          let at = span.start;
          while (at < span.end) {
            const op = raw[at]!;
            const len = instrLen(raw, at);
            if (len === null) break;
            if (op === OP.WINDOW && at + 9 <= raw.byteLength) {
              geom.set(raw[at + 1]!, {
                w: view.getUint16(at + 6, true),
                h: view.getUint16(at + 8, true),
              });
            } else if (op === OP.MESSAGE && at + 3 <= raw.byteLength) {
              const g = geom.get(raw[at + 1]!);
              const text = stringBytes(raw[at + 2]!);
              if (g && text && text.length > 0) {
                records.push({ field: entry.name, declaredW: g.w, declaredH: g.h, text });
              }
            }
            at += len;
          }
        }
      }

      expect(fields).toBeGreaterThan(600);
      expect(records.length).toBeGreaterThan(2000);

      // --- 4. Messen ---------------------------------------------------------
      const report: string[] = [];
      const summary: Record<string, { exact: number; over: number; under: number }> = {};
      for (const [name, sp] of Object.entries(variants)) {
        let exact = 0;
        let over = 0;
        for (const r of records) {
          const w = measureFfWindow(r.text, sp).width;
          if (w === r.declaredW) exact++;
          else if (w > r.declaredW) over++;
        }
        summary[name] = { exact, over, under: records.length - exact - over };
        report.push(
          `${name.padEnd(10)} exakt ${((exact / records.length) * 100).toFixed(2)}% ` +
            `| zu breit (Verletzung) ${((over / records.length) * 100).toFixed(2)}% ` +
            `| zu schmal ${(((records.length - exact - over) / records.length) * 100).toFixed(2)}%`,
        );
      }
      console.log(
        `\nGlyphenmetrik: ${records.length} Dialoge mit bekannter Fenstergröße aus ${fields} Fields\n` +
          report.join('\n'),
      );

      // --- 5. Polsterung MESSEN statt annehmen ------------------------------
      // Die Polsterung liegt in `ff7.exe`; die Fremdbeschreibung nennt 16 als
      // Standard. Ob das stimmt, entscheidet hier der Bestand: Der richtige
      // Wert muss die Trefferquote maximieren, ohne die Verletzungsquote
      // hochzutreiben. Ohne den Sweep wäre 16 eine ungeprüfte Annahme.
      const sweep: string[] = [];
      let bestPad = real.padding;
      let bestExact = -1;
      for (let pad = 12; pad <= 28; pad += 2) {
        const sp = spacingTableFrom(win.glyphWidths, { padding: pad, ...nw });
        let exact = 0;
        let over = 0;
        for (const r of records) {
          const w = measureFfWindow(r.text, sp).width;
          if (w === r.declaredW) exact++;
          else if (w > r.declaredW) over++;
        }
        sweep.push(
          `Polsterung ${String(pad).padStart(2)} px: exakt ${((exact / records.length) * 100).toFixed(2)}% ` +
            `| Verletzung ${((over / records.length) * 100).toFixed(2)}%`,
        );
        if (exact > bestExact) {
          bestExact = exact;
          bestPad = pad;
        }
      }
      console.log('Polsterungs-Sweep:\n' + sweep.join('\n'));

      // Residuenverteilung bei der besten Polsterung.
      const tuned = spacingTableFrom(win.glyphWidths, { padding: bestPad, ...nw });
      const hist = new Map<number, number>();
      let tunedOver = 0;
      for (const r of records) {
        const w = measureFfWindow(r.text, tuned).width;
        if (w > r.declaredW) tunedOver++;
        hist.set(
          Math.max(-40, Math.min(80, r.declaredW - w)),
          (hist.get(Math.max(-40, Math.min(80, r.declaredW - w))) ?? 0) + 1,
        );
      }
      console.log(
        `Residuen bei Polsterung ${bestPad} px (deklariert − vorhergesagt), Top 12:\n` +
          [...hist.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([d, n]) => `${String(d).padStart(4)}px: ${n} (${((n / records.length) * 100).toFixed(1)}%)`)
            .join('\n'),
      );

      // Woher kommen die verbliebenen Residuengruppen? Aufteilung nach den
      // beiden Textmerkmalen, deren Breite wir nur ANNEHMEN: Namensplatzhalter
      // und {CHOICE}-Einzug.
      const groups: Record<string, number[]> = { rein: [], name: [], choice: [], beides: [] };
      for (const r of records) {
        const hasName = r.text.some((b) => b >= 0xea && b <= 0xf5);
        const hasChoice = r.text.some((b) => b === 0xe0);
        const key = hasName && hasChoice ? 'beides' : hasName ? 'name' : hasChoice ? 'choice' : 'rein';
        groups[key]!.push(r.declaredW - measureFfWindow(r.text, tuned).width);
      }
      console.log(
        'Residuen nach Textmerkmal (Polsterung ' +
          bestPad +
          '):\n' +
          Object.entries(groups)
            .map(([k, v]) => {
              const zero = v.filter((d) => d === 0).length;
              const neg = v.filter((d) => d < 0).length;
              const med = v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]! : 0;
              return `${k.padEnd(7)} n=${String(v.length).padStart(5)} exakt ${((zero / (v.length || 1)) * 100).toFixed(1)}% Verletzung ${((neg / (v.length || 1)) * 100).toFixed(1)}% Median ${med}px`;
            })
            .join('\n'),
      );

      // Namensbreite messen statt annehmen (nur auf Dialogen mit Platzhalter).
      const nameRecords = records.filter((r) => r.text.some((b) => b >= 0xea && b <= 0xf5));
      const nameSweep: string[] = [];
      let bestName = 0;
      let bestNameExact = -1;
      for (let nw = 110; nw <= 124; nw++) {
        const sp = spacingTableFrom(win.glyphWidths, { padding: bestPad, nameWidth: nw });
        let exact = 0;
        for (const r of nameRecords) if (measureFfWindow(r.text, sp).width === r.declaredW) exact++;
        nameSweep.push(`${String(nw).padStart(3)} px: ${((exact / nameRecords.length) * 100).toFixed(1)}%`);
        if (exact > bestNameExact) {
          bestNameExact = exact;
          bestName = nw;
        }
      }
      console.log(`Namensbreiten-Sweep fein (n=${nameRecords.length}, exakt):\n  ` + nameSweep.join('\n  '));

      // Feiner Polsterungs-Sweep bei gemessener Namensbreite.
      const fine: string[] = [];
      for (let pad = 17; pad <= 23; pad++) {
        const sp = spacingTableFrom(win.glyphWidths, { padding: pad, nameWidth: bestName });
        let exact = 0;
        let over = 0;
        for (const r of records) {
          const w = measureFfWindow(r.text, sp).width;
          if (w === r.declaredW) exact++;
          else if (w > r.declaredW) over++;
        }
        fine.push(
          `Polsterung ${pad}: exakt ${((exact / records.length) * 100).toFixed(2)}% | Verletzung ${((over / records.length) * 100).toFixed(2)}%`,
        );
      }
      console.log('Feiner Sweep bei Namensbreite ' + bestName + ':\n  ' + fine.join('\n  '));

      // Gemessene Metrik als Ganzes gegen die alte Ersatzmetrik.
      const measured = spacingTableFrom(win.glyphWidths, { padding: bestPad, nameWidth: bestName });
      let mExact = 0;
      let mOver = 0;
      const rest = new Map<number, number>();
      for (const r of records) {
        const w = measureFfWindow(r.text, measured).width;
        if (w === r.declaredW) mExact++;
        else if (w > r.declaredW) mOver++;
        const d = Math.max(-20, Math.min(40, r.declaredW - w));
        rest.set(d, (rest.get(d) ?? 0) + 1);
      }
      console.log(
        `GEMESSENE Metrik (Polsterung ${bestPad}, Namensbreite ${bestName}): ` +
          `exakt ${((mExact / records.length) * 100).toFixed(2)}% | Verletzung ${((mOver / records.length) * 100).toFixed(2)}%\n` +
          'Restresiduen Top 8: ' +
          [...rest.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([d, n]) => `${d}px:${((n / records.length) * 100).toFixed(1)}%`)
            .join('  '),
      );

      // --- 6. Behauptungen ---------------------------------------------------
      // Die Vorhersage der Task: **keine** Zeile eines Originaldialogs darf
      // breiter sein als ihr Fenster. Das ist die Kennzahl, die zwischen
      // richtiger und falscher Metrik trennt — und sie trennt scharf.
      const real0 = summary['real']!;
      // (a) Verletzungsquote: die echte Metrik liegt bei ~3 %, jedes
      //     Kontrollniveau bei 83–86 %. Faktor > 20.
      for (const ctrl of ['shuffled', 'constMean', 'fallback']) {
        expect(real0.over * 20).toBeLessThan(summary[ctrl]!.over);
      }
      expect(real0.over / records.length).toBeLessThan(0.05);
      // (b) Exakte Treffer: knapp 39 % der Fenster werden auf das Pixel
      //     getroffen — gegen 7–8 % bei verwürfelter Tabelle und 0,2 % bei
      //     der alten Ersatzmetrik.
      expect(real0.exact / records.length).toBeGreaterThan(0.35);
      expect(real0.exact).toBeGreaterThan(summary['shuffled']!.exact * 4);
      expect(real0.exact).toBeGreaterThan(summary['fallback']!.exact * 100);
      // (c) Die additive Dekodierregel schlägt die Konkurrenzauslegung
      //     „nur untere 5 Bit" deutlich — damit ist sie belegt, nicht geglaubt.
      expect(real0.exact).toBeGreaterThan(summary['low5']!.exact * 1.5);
      // (d) Die gemessene Polsterung ist die aus EXE_DEFAULTS.
      expect(bestPad).toBe(EXE_DEFAULTS.padding);
      expect(bestName).toBe(117);
      expect(tunedOver / records.length).toBeLessThan(0.05);
    },
  );
});
