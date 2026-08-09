import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Strukturprobe (Methodik-Standard seit S7: Fakten VOR Parserbau):
 * Field-Sektion 3 (Model-Loader). Über die Sektion ist bislang nichts
 * belegt — die Probe erschließt das Layout aus dem Bestand:
 *
 *  P1  Längenverteilung der Sektion, erste u16/u32-Werte als Zählerkandidaten
 *  P2  Lage und Länge aller druckbaren ASCII-Läufe (Namensfelder)
 *  P3  Endungen der Läufe (.hrc / .a / .tex) und deren Reihenfolge
 *  P4  Abstände zwischen Namensläufen — daraus folgt die Recordlänge
 *
 * Ausgabe ausschließlich aggregiert; Namen werden NICHT ausgegeben, nur
 * ihre Längen, Endungen und Positionen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

interface AsciiRun {
  start: number;
  length: number;
  suffix: string;
}

function asciiRuns(data: Uint8Array, minLen: number): AsciiRun[] {
  const runs: AsciiRun[] = [];
  let start = -1;
  for (let i = 0; i <= data.length; i++) {
    const b = i < data.length ? data[i]! : 0;
    const printable = b >= 0x21 && b <= 0x7e;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const length = i - start;
      if (length >= minLen) {
        const text = String.fromCharCode(...data.subarray(start, i)).toLowerCase();
        const dot = text.lastIndexOf('.');
        runs.push({ start, length, suffix: dot >= 0 ? text.slice(dot) : '' });
      }
      start = -1;
    }
  }
  return runs;
}

const bump = (m: Map<string | number, number>, k: string | number, cap = 60): void => {
  if (m.size < cap || m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
};

describe.skipIf(!available)('Realdaten: Field-Sektion 3 (S10-Probe)', () => {
  it('Layout-Erschließung Model-Loader', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const lenHist = new Map<string | number, number>();
    const head = {
      u16at0: new Map<string | number, number>(),
      u16at2: new Map<string | number, number>(),
      u16at4: new Map<string | number, number>(),
      u16at6: new Map<string | number, number>(),
    };
    const runLen = new Map<string | number, number>();
    const suffixes = new Map<string | number, number>();
    const firstRunStart = new Map<string | number, number>();
    const runGaps = new Map<string | number, number>();
    const runsPerField = new Map<string | number, number>();
    const hrcRunsPerField = new Map<string | number, number>();
    // Verhältnis: passt ein u16 im Kopf zur Anzahl der .hrc-Läufe?
    const counterMatch = { at0: 0, at2: 0, at4: 0, at6: 0, checked: 0 };
    let fields = 0;
    let withSection = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.bundle) continue;
      fields++;
      const data = parsed.bundle.rawSections[SECTION_MODEL_LOADER];
      if (!data || data.length < 8) continue;
      withSection++;

      // P1
      bump(lenHist, Math.floor(data.length / 256) * 256, 40);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      bump(head.u16at0, view.getUint16(0, true), 30);
      bump(head.u16at2, view.getUint16(2, true), 30);
      bump(head.u16at4, view.getUint16(4, true), 30);
      bump(head.u16at6, view.getUint16(6, true), 30);

      // P2/P3
      const runs = asciiRuns(data, 3);
      bump(runsPerField, runs.length, 40);
      let prevStart = -1;
      let hrcCount = 0;
      for (const r of runs) {
        bump(runLen, r.length, 40);
        bump(suffixes, r.suffix || '(ohne)', 40);
        if (r.suffix === '.hrc') hrcCount++;
        if (prevStart >= 0) bump(runGaps, r.start - prevStart, 60);
        prevStart = r.start;
      }
      bump(hrcRunsPerField, hrcCount, 40);
      if (runs.length > 0) bump(firstRunStart, runs[0]!.start, 40);

      // P4: Zählerkandidaten gegen die .hrc-Anzahl prüfen
      if (hrcCount > 0) {
        counterMatch.checked++;
        if (view.getUint16(0, true) === hrcCount) counterMatch.at0++;
        if (view.getUint16(2, true) === hrcCount) counterMatch.at2++;
        if (view.getUint16(4, true) === hrcCount) counterMatch.at4++;
        if (view.getUint16(6, true) === hrcCount) counterMatch.at6++;
      }
    }

    const top = (m: Map<string | number, number>, n = 12): unknown =>
      Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n);

    console.log(`Fields=${fields}, mit Sektion 3 = ${withSection}`);
    console.log('P1 Längen (256er-Klassen):', JSON.stringify(top(lenHist)));
    console.log('P1 Kopf-u16 @0:', JSON.stringify(top(head.u16at0)));
    console.log('P1 Kopf-u16 @2:', JSON.stringify(top(head.u16at2)));
    console.log('P1 Kopf-u16 @4:', JSON.stringify(top(head.u16at4)));
    console.log('P1 Kopf-u16 @6:', JSON.stringify(top(head.u16at6)));
    console.log('P2 Lauflängen:', JSON.stringify(top(runLen, 16)));
    console.log('P3 Endungen:', JSON.stringify(top(suffixes, 16)));
    console.log('P2 erster Lauf beginnt bei:', JSON.stringify(top(firstRunStart)));
    console.log('P4 Abstände zwischen Läufen:', JSON.stringify(top(runGaps, 20)));
    console.log('P2 Läufe je Field:', JSON.stringify(top(runsPerField)));
    console.log('P2 .hrc-Läufe je Field:', JSON.stringify(top(hrcRunsPerField)));
    console.log('P4 Zählerkandidat == .hrc-Anzahl:', JSON.stringify(counterMatch));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
