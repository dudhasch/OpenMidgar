import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, SKIP_OPERAND_LEN, OP, OP_KAWAI } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * Sprungziel-Probe (O11, Dauerprobe seit Welle 3/4).
 *
 * **Frage.** Von welchem Byte aus zählt ein Sprungoffset — vom Opcode-Byte
 * oder vom Operandenbyte? Die Antwort war für Vorwärts- und Rückwärtssprünge
 * unterschiedlich, und der Unterschied war ein echter Defekt: Bis 2026-08-15
 * rechnete die VM Rücksprünge vom Operandenbyte und landete damit im Bestand
 * fast nie auf einer Instruktion.
 *
 * **Gütefunktion.** Ein Sprungziel muss auf einer **Instruktionsgrenze**
 * liegen. Die Grenzen entstehen aus dem linearen Durchlauf der Spanne mit der
 * belegten Längentabelle (Spannen-Abschluss 99,92 %, s. O9) — sie sind also
 * unabhängig von der Sprungrechnung, die hier geprüft wird.
 *
 * **Eichung statt blinder Quote.** Dieselbe Anlage misst beide Richtungen. Sie
 * ist an den Vorwärtssprüngen geeicht: Dort muss die implementierte Rechnung
 * gewinnen und die verschobene verlieren. Täte sie das nicht, wäre die Anlage
 * kaputt und die Rückwärtsaussage wertlos.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Opcode → Gesamtlänge der Instruktion; null, wenn unbekannt. */
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

interface Zaehler {
  treffer: number;
  gesamt: number;
}

const quote = (z: Zaehler): string =>
  `${((z.treffer / Math.max(1, z.gesamt)) * 100).toFixed(1)} % (${z.treffer}/${z.gesamt})`;

describe.skipIf(!available)('Realdaten: Bezugspunkt der Sprungoffsets', () => {
  it(
    'Rücksprünge zählen vom Opcode-Byte, Vorwärtssprünge vom Operandenbyte',
    { timeout: 900_000 },
    async () => {
      const index = new IndexService();
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      await index.openSource(dir, { deep: false });

      const rueck = { regel: { treffer: 0, gesamt: 0 }, kontrolle: { treffer: 0, gesamt: 0 } };
      const rueckLang = { regel: { treffer: 0, gesamt: 0 }, kontrolle: { treffer: 0, gesamt: 0 } };
      const vor = { regel: { treffer: 0, gesamt: 0 }, kontrolle: { treffer: 0, gesamt: 0 } };
      let felder = 0;

      for (const eintrag of index.listEntries('flevel')) {
        if (eintrag.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(eintrag.canonicalId), eintrag.name);
        } catch {
          continue;
        }
        const bundle = parsed.ok ? parsed.bundle : null;
        const script = bundle?.script;
        const code = bundle?.rawSections[1];
        if (!script || !code) continue;
        felder++;

        for (const span of script.spans.filter((s) => s.end > s.start)) {
          // 1. Instruktionsgrenzen der Spanne — unabhängig von jeder Sprungrechnung.
          const grenzen = new Set<number>();
          const sprünge: { ip: number; op: number; off: number }[] = [];
          let at = span.start;
          while (at < span.end) {
            grenzen.add(at);
            const len = instrLen(code, at);
            if (len === null) break;
            const op = code[at]!;
            if (op === OP.JMPB || op === OP.JMPF) {
              sprünge.push({ ip: at, op, off: code[at + 1]! });
            } else if (op === OP.JMPBL || op === OP.JMPFL) {
              sprünge.push({ ip: at, op, off: code[at + 1]! | (code[at + 2]! << 8) });
            }
            at += len;
          }
          grenzen.add(at);

          // 2. Beide Rechnungen gegen dieselben Grenzen.
          for (const s of sprünge) {
            const zaehle = (ziel: number, z: Zaehler): void => {
              z.gesamt++;
              if (grenzen.has(ziel)) z.treffer++;
            };
            if (s.op === OP.JMPB) {
              zaehle(s.ip - s.off, rueck.regel);
              zaehle(s.ip + 1 - s.off, rueck.kontrolle);
            } else if (s.op === OP.JMPBL) {
              zaehle(s.ip - s.off, rueckLang.regel);
              zaehle(s.ip + 1 - s.off, rueckLang.kontrolle);
            } else if (s.op === OP.JMPF) {
              zaehle(s.ip + 1 + s.off, vor.regel);
              zaehle(s.ip + s.off, vor.kontrolle);
            } else {
              zaehle(s.ip + 1 + s.off, vor.regel);
              zaehle(s.ip + s.off, vor.kontrolle);
            }
          }
        }
      }
      await dir.closeAll();

      console.log(
        JSON.stringify(
          {
            felder,
            'JMPB  Regel ip − off': quote(rueck.regel),
            'JMPB  Kontrolle ip + 1 − off': quote(rueck.kontrolle),
            'JMPBL Regel ip − off': quote(rueckLang.regel),
            'JMPBL Kontrolle ip + 1 − off': quote(rueckLang.kontrolle),
            'JMPF/L Regel ip + 1 + off (Eichung)': quote(vor.regel),
            'JMPF/L Kontrolle ip + off (Eichung)': quote(vor.kontrolle),
          },
          null,
          1,
        ),
      );

      // Eichung zuerst: Wenn die vorwärts nicht hält, misst die Anlage nichts.
      expect(vor.regel.treffer / vor.regel.gesamt).toBeGreaterThan(0.95);
      expect(vor.kontrolle.treffer / vor.kontrolle.gesamt).toBeLessThan(0.3);
      // Und dann die Aussage, um die es geht.
      expect(rueck.regel.treffer / rueck.regel.gesamt).toBeGreaterThan(0.95);
      expect(rueck.kontrolle.treffer / rueck.kontrolle.gesamt).toBeLessThan(0.1);
      // JMPBL ist selten; hier zählt der Abstand zur Kontrolle, nicht die
      // Vollständigkeit. Dass die Quote unter der von JMPB liegt, ist erwartet:
      // Diese Probe läuft über ALLE Spannen linear, also auch über den toten
      // Code (korpusweit 32,5 % der Instruktionen), während die
      // Erstmessung nur im Instruktionsstrom erreichte Sprünge zählte.
      expect(rueckLang.regel.treffer / rueckLang.regel.gesamt).toBeGreaterThan(0.7);
      expect(rueckLang.kontrolle.treffer / rueckLang.kontrolle.gesamt).toBeLessThan(0.05);
    },
  );
});
