import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { FieldRuntime, prepareScript, stateDigest, type PreparedScript } from '@webmidgar/interpreter';

import { NodeDirectorySource } from './node-source.js';

/**
 * S6-Realdaten-Crosstest: Der Interpreter läuft über echten Field-Bytecode
 * (UNKNOWN-Politik aktiv, Dialog-Stub mit deterministischer Auto-Auswahl).
 * Harte Zusicherung: Determinismus — zwei unabhängige Läufe je Field liefern
 * bitidentische Zustands-Digests. Fault-/Skip-Statistik ist Planungsinput
 * für die Opcode-Abdeckung späterer Sessions. Ausgabe nur aggregiert.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TICKS = 120;
const BUDGET = 200;

function runField(prepared: PreparedScript): { digest: string; rt: FieldRuntime } {
  const rt = new FieldRuntime(prepared, { seed: 0x5117, budget: BUDGET, mainLoop: true });
  rt.start();
  for (let t = 0; t < TICKS; t++) {
    rt.tick();
    // Deterministische „UI": offene Dialoge alle 5 Ticks mit Auswahl 0 lösen.
    if (rt.state.tickCounter % 5 === 0) {
      for (const entity of rt.state.entities) {
        for (const ctx of entity.context ? [entity.context, ...entity.suspended] : entity.suspended) {
          if (ctx.waitState.kind === 'dialogue') {
            rt.postEvent({ kind: 'dialogue-resolved', requestId: ctx.waitState.requestId, choice: 0 });
          }
        }
      }
    }
  }
  return { digest: stateDigest(rt.state), rt };
}

describe.skipIf(!available)('Realdaten: Interpreter-Grundgerüst auf echtem Bytecode', () => {
  it(
    'Determinismus-Doppellauf + Fault-Statistik über flevel',
    { timeout: 600_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      const stats = {
        fields: 0,
        scriptless: 0,
        digestMismatches: [] as string[],
        entitiesTotal: 0,
        faultsByReason: {} as Record<string, number>,
        faultOpsTop: {} as Record<string, number>,
        unknownSkipsTop: {} as Record<string, number>,
        fieldsWithoutFault: 0,
        scrSpanDiagnostics: 0,
      };

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle?.script || !parsed.bundle.rawSections[1]) {
          stats.scriptless++;
          continue;
        }
        stats.scrSpanDiagnostics += parsed.diagnostics.filter((d) => d.code === 'E-SCR-SPAN').length;
        const prepared = prepareScript(parsed.bundle.script, parsed.bundle.rawSections[1]);
        stats.fields++;
        stats.entitiesTotal += prepared.entities.length;

        const runA = runField(prepared);
        const runB = runField(prepared);
        if (runA.digest !== runB.digest && stats.digestMismatches.length < 10) {
          stats.digestMismatches.push(entry.name);
        }

        for (const fault of runA.rt.state.faults) {
          stats.faultsByReason[fault.reason] = (stats.faultsByReason[fault.reason] ?? 0) + 1;
          if (fault.reason === 'unknown-op') {
            const key = `0x${fault.op.toString(16)}`;
            stats.faultOpsTop[key] = (stats.faultOpsTop[key] ?? 0) + 1;
          }
        }
        if (runA.rt.state.faultCount === 0) stats.fieldsWithoutFault++;
        for (const [op, n] of Object.entries(runA.rt.state.unknownSkips)) {
          const key = `0x${Number(op).toString(16)}`;
          stats.unknownSkipsTop[key] = (stats.unknownSkipsTop[key] ?? 0) + n;
        }
      }

      const top = (rec: Record<string, number>, n: number): [string, number][] =>
        Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n);
      console.log('Interpreter-Sweep:', JSON.stringify({
        fields: stats.fields,
        scriptless: stats.scriptless,
        entitiesTotal: stats.entitiesTotal,
        fieldsWithoutFault: stats.fieldsWithoutFault,
        faultsByReason: stats.faultsByReason,
        scrSpanDiagnostics: stats.scrSpanDiagnostics,
      }, null, 2));
      console.log('Top-Fault-Opcodes:', JSON.stringify(top(stats.faultOpsTop, 15)));
      console.log('Top-Skip-Opcodes:', JSON.stringify(top(stats.unknownSkipsTop, 15)));

      // Akzeptanz: Determinismus auf ALLEN echten Fields; Sentinel-Fix wirksam.
      expect(stats.digestMismatches).toEqual([]);
      expect(stats.fields).toBeGreaterThan(500);
      expect(stats.scrSpanDiagnostics).toBe(0);
      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
