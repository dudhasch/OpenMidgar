import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Strukturprobe, 2. Iteration — Recordaufbau der Sektion 3.
 * Aus Iteration 1 belegt: Kopf ist u16 0 · u16 Anzahl (1…12) · u16 Skala
 * (512 in 643/702 Fields); der erste Namenslauf beginnt in allen 702 Fields
 * exakt bei Offset 8, u16@6 liegt bei 19…27.
 *
 * Offen: Ist u16@6 ein Längenpräfix? Wie sind Modell- und Animationsnamen
 * getrennt? Diese Probe misst deshalb je Namenslauf das unmittelbar davor
 * stehende u16, das Folgebyte und das ZEICHENKLASSENMUSTER des Laufs
 * (L = Buchstabe, D = Ziffer, Sonderzeichen literal) — so wird die Struktur
 * sichtbar, ohne Originalnamen auszugeben.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

function classPattern(data: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const ch = String.fromCharCode(data[i]!);
    if (/[A-Za-z]/.test(ch)) out += 'L';
    else if (/[0-9]/.test(ch)) out += 'D';
    else out += ch;
  }
  // Wiederholungen zusammenfassen: LLLL -> L4
  return out.replace(/(.)\1*/g, (m, c: string) => (m.length > 1 ? `${c}${m.length}` : c));
}

const bump = (m: Map<string | number, number>, k: string | number, cap = 60): void => {
  if (m.size < cap || m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
};
const top = (m: Map<string | number, number>, n = 14): unknown =>
  Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n);

describe.skipIf(!available)('Realdaten: Sektion 3 Recordaufbau (S10-Probe 2)', () => {
  it('Namensmuster und Längenpräfixe', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const patterns = new Map<string | number, number>();
    const prefixMatchesRun = { u16before: 0, u16before2: 0, total: 0 };
    const prefixValueMinusRun = new Map<string | number, number>();
    const byteAfter = new Map<string | number, number>();
    const bytesBetween = new Map<string | number, number>();
    // Kopf-u16@6 gegen die Länge des ersten Laufs bzw. gegen den Abstand bis
    // zum übernächsten Lauf.
    const head6VsFirstRun = new Map<string | number, number>();
    let fields = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const data = parsed.bundle?.rawSections[SECTION_MODEL_LOADER];
      if (!parsed.ok || !data || data.length < 12) continue;
      fields++;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      // Läufe ermitteln.
      const runs: { start: number; end: number }[] = [];
      let start = -1;
      for (let i = 0; i <= data.length; i++) {
        const b = i < data.length ? data[i]! : 0;
        const printable = b >= 0x21 && b <= 0x7e;
        if (printable) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          if (i - start >= 2) runs.push({ start, end: i });
          start = -1;
        }
      }

      for (const [i, run] of runs.entries()) {
        const len = run.end - run.start;
        bump(patterns, classPattern(data, run.start, run.end), 40);
        prefixMatchesRun.total++;
        if (run.start >= 2) {
          const p = view.getUint16(run.start - 2, true);
          if (p === len) prefixMatchesRun.u16before++;
          bump(prefixValueMinusRun, p - len, 30);
        }
        if (run.start >= 4 && view.getUint16(run.start - 4, true) === len) prefixMatchesRun.u16before2++;
        if (run.end < data.length) bump(byteAfter, data[run.end]!, 20);
        const next = runs[i + 1];
        if (next) bump(bytesBetween, next.start - run.end, 24);
      }

      if (runs.length > 0) {
        bump(head6VsFirstRun, view.getUint16(6, true) - (runs[0]!.end - runs[0]!.start), 24);
      }
    }

    console.log(`Fields=${fields}`);
    console.log('Zeichenklassenmuster der Namensläufe:', JSON.stringify(top(patterns, 20)));
    console.log('Längenpräfix-Treffer:', JSON.stringify(prefixMatchesRun));
    console.log('u16 vor dem Lauf minus Lauflänge:', JSON.stringify(top(prefixValueMinusRun)));
    console.log('Byte direkt nach dem Lauf:', JSON.stringify(top(byteAfter)));
    console.log('Nichtdruckbare Bytes zwischen zwei Läufen:', JSON.stringify(top(bytesBetween, 20)));
    console.log('u16@6 minus Länge des ersten Laufs:', JSON.stringify(top(head6VsFirstRun)));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
