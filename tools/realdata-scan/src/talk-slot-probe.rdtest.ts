import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { IMPL_OPERAND_LEN, OP, OP_KAWAI, SKIP_OPERAND_LEN } from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * Talk-Slot-Probe (F04): Stützt die Community-Konvention „Entry 1 = Talk"
 * an den Realdaten, bevor die Spieler-Interaktion darauf gebaut wird.
 *
 * Zwei Fragen:
 *  1. **Wie sehen ungenutzte Slots aus?** Kandidaten: Sentinel
 *     (== stringTableOffset) oder Wiederholung eines früheren Slot-Werts.
 *     Davon hängt ab, woran `requestEntityScript` ein „leeres" Entry erkennt.
 *  2. **Enthält Entry 1 überdurchschnittlich oft MESSAGE/ASK?** Talk-Scripts
 *     sollten Dialoge zeigen; als Kontrollniveau dienen die Entries 3+
 *     derselben Entities. Ein deutlicher Abstand stützt die Konvention.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** LINE (0xD0) — Community-Zuordnung (🟡), hier nur zur Entitätsklassifikation. */
const OP_LINE = 0xd0;

/** Zählt Dialog-/Klassifikations-Opcodes in [start, end) mit den Operandenlängen des Interpreters. */
function scanSpan(
  code: Uint8Array,
  start: number,
  end: number,
): { message: number; ask: number; char: number; line: number; aborted: boolean } {
  let ip = start;
  const c = { message: 0, ask: 0, char: 0, line: 0, aborted: false };
  while (ip < end) {
    const op = code[ip]!;
    if (op === OP.MESSAGE) c.message++;
    if (op === OP.ASK) c.ask++;
    if (op === OP.CHAR) c.char++;
    if (op === OP_LINE) c.line++;
    let len = IMPL_OPERAND_LEN[op] ?? SKIP_OPERAND_LEN[op];
    if (op === OP_KAWAI) {
      const total = ip + 1 < end ? code[ip + 1]! : 0;
      if (total < 2) return { ...c, aborted: true };
      len = total - 1;
    }
    if (len === undefined) return { ...c, aborted: true };
    ip += 1 + len;
  }
  return c;
}

describe.skipIf(!available)('Realdaten: Talk-Slot-Konvention (Entry 1)', () => {
  it('misst ungenutzte-Slot-Formen und MESSAGE/ASK-Anteile je Entry-Slot', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // Frage 1: Form ungenutzter Slots (über alle Slots 1..31).
    const slotForm: Record<string, number> = {
      eigenstaendig: 0, // Wert ist kein früherer Slot-Wert und < codeEnd
      'wiederholt-frueheren-slot': 0,
      'sentinel==codeEnd': 0,
      null: 0,
    };
    let nichtMonoton = 0;

    // Frage 2: MESSAGE/ASK-Anteile je Slot-Gruppe (nur eigenständige Entries),
    // getrennt nach Entitätsart: Die Slot-Konvention gilt laut Community nur
    // für Modell-Entities (CHAR im Init); LINE-Entities belegen dieselben
    // Slots mit Berührungs-Semantik und würden die Messung verwässern.
    interface Gruppe {
      entries: number;
      mitDialog: number;
      aborted: number;
    }
    const leereGruppen = (): Record<string, Gruppe> => ({
      'slot-1-talk': { entries: 0, mitDialog: 0, aborted: 0 },
      'slot-2-contact': { entries: 0, mitDialog: 0, aborted: 0 },
      'slot-3plus-kontrolle': { entries: 0, mitDialog: 0, aborted: 0 },
    });
    const arten: Record<string, Record<string, Gruppe>> = {
      'modell (CHAR im Init)': leereGruppen(),
      'line (LINE im Init)': leereGruppen(),
      sonstige: leereGruppen(),
    };
    const artenZaehler: Record<string, number> = {};
    let entities = 0;
    let fields = 0;

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      const script = parsed.bundle?.script;
      const code = parsed.bundle?.rawSections[1];
      if (!parsed.ok || !script || !code) continue;
      fields++;
      const codeEnd = script.stringTableOffset;
      // Span-Ende: nächster eigenständiger Entry-Offset des ganzen Fields.
      const alleEntries = [...new Set(script.entities.flatMap((e) => e.entryPoints.filter((p): p is number => p !== null && p < codeEnd)))].sort(
        (a, b) => a - b,
      );
      const spanEnde = (start: number): number => {
        for (const off of alleEntries) if (off > start) return off;
        return codeEnd;
      };

      for (const entity of script.entities) {
        entities++;
        const eps = entity.entryPoints;
        // Entitätsart aus dem Slot-0-Span (Init + Main) bestimmen.
        const e0 = eps[0];
        let art = 'sonstige';
        if (e0 !== null && e0 !== undefined && e0 < codeEnd) {
          const initScan = scanSpan(code, e0, spanEnde(e0));
          if (initScan.char > 0) art = 'modell (CHAR im Init)';
          else if (initScan.line > 0) art = 'line (LINE im Init)';
        }
        artenZaehler[art] = (artenZaehler[art] ?? 0) + 1;
        const gruppen = arten[art]!;
        for (let s = 1; s < eps.length; s++) {
          const v = eps[s];
          const prev = eps[s - 1];
          if (v !== null && v !== undefined && prev !== null && prev !== undefined && v < prev) nichtMonoton++;
          if (v === null || v === undefined) {
            slotForm['null'] = (slotForm['null'] ?? 0) + 1;
            continue;
          }
          if (v === codeEnd) {
            slotForm['sentinel==codeEnd'] = (slotForm['sentinel==codeEnd'] ?? 0) + 1;
            continue;
          }
          const wiederholt = eps.slice(0, s).some((p) => p === v);
          if (wiederholt) {
            slotForm['wiederholt-frueheren-slot'] = (slotForm['wiederholt-frueheren-slot'] ?? 0) + 1;
            continue;
          }
          slotForm['eigenstaendig'] = (slotForm['eigenstaendig'] ?? 0) + 1;
          const gruppe = s === 1 ? gruppen['slot-1-talk']! : s === 2 ? gruppen['slot-2-contact']! : gruppen['slot-3plus-kontrolle']!;
          gruppe.entries++;
          const scan = scanSpan(code, v, spanEnde(v));
          if (scan.aborted) gruppe.aborted++;
          if (scan.message + scan.ask > 0) gruppe.mitDialog++;
        }
      }
    }

    console.log(`Fields: ${fields}, Entities: ${entities}`);
    console.log('Entitätsarten:', JSON.stringify(artenZaehler));
    console.log('Slot-Formen (Slots 1..31):', JSON.stringify(slotForm, null, 2));
    console.log('Nicht monoton (v < Vorgänger):', nichtMonoton);
    for (const [artName, gruppen] of Object.entries(arten)) {
      for (const [name, g] of Object.entries(gruppen)) {
        const anteil = g.entries > 0 ? ((100 * g.mitDialog) / g.entries).toFixed(1) : '-';
        console.log(
          `${artName} / ${name}: ${g.entries} eigenständige Entries, ${g.mitDialog} mit MESSAGE/ASK (${anteil} %), ${g.aborted} Scan-Abbrüche`,
        );
      }
    }
    expect(fields).toBeGreaterThan(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
