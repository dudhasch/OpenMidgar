import { describe, expect, it } from 'vitest';
import { composeScriptSection, ScriptAssembler } from '@webmidgar/fixture-gen';
import { parseScriptSection, type FieldDiagnostic } from '@webmidgar/formats-field';
import { FieldRuntime, prepareScript, readBank, type PreparedScript } from '@webmidgar/interpreter';
import { BreakpointManager } from './breakpoints.js';
import { Timeline } from './timeline.js';

function prepare(entities: { name: string; entries: number[] }[], bytes: Uint8Array): PreparedScript {
  const section = composeScriptSection({
    entities: entities.map((e) => ({ name: e.name, entryPoints: e.entries })),
    scriptBytes: bytes,
  });
  const diagnostics: FieldDiagnostic[] = [];
  const set = parseScriptSection(section, 'fixture', diagnostics);
  if (!set) throw new Error('Fixture-Sektion unparsbar');
  return prepareScript(set, section);
}

describe('Timeline', () => {
  it('protokolliert Starts, Yields, Requests und Enden tick-indiziert (asset-frei)', () => {
    const asm = new ScriptAssembler();
    asm.label('a').req(1, 1, 3).wait(2).ret();
    asm.label('b-init').ret();
    asm.label('b-s1').setByte(3, 0, 1).ret();
    const { bytes, offsets } = asm.assemble();
    const timeline = new Timeline();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'a', entries: [offsets['a']!] },
          { name: 'b', entries: [offsets['b-init']!, offsets['b-s1']!] },
        ],
        bytes,
      ),
      { mainLoop: false, observer: timeline },
    );
    rt.start();
    rt.run(5);
    const kinds = new Set(timeline.events.map((e) => e.kind));
    expect(kinds).toContain('context-start');
    expect(kinds).toContain('yield');
    expect(kinds).toContain('request');
    expect(kinds).toContain('context-end');
    const req = timeline.events.find((e) => e.kind === 'request');
    expect(req).toMatchObject({ source: 0, target: 1, slot: 1, accepted: true });
    // Export ist reines JSON ohne Texte.
    expect(() => JSON.parse(timeline.toJson())).not.toThrow();
  });
});

describe('Breakpoints', () => {
  it('hält VOR der Instruktion, Einzelschritt führt genau eine aus, Resume läuft weiter', () => {
    const asm = new ScriptAssembler();
    asm.setByte(3, 0, 1).label('bp').setByte(3, 0, 2).setByte(3, 0, 3).ret();
    asm.label('other').inc(3, 1).wait(1).jmpb('other');
    const { bytes, offsets } = asm.assemble();
    const prepared = prepare(
      [
        { name: 'hero', entries: [0] },
        { name: 'walker', entries: [offsets['other']!] },
      ],
      bytes,
    );
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    const bm = new BreakpointManager(rt);
    // Entry-Offsets sind sektionsrelativ — Breakpoint ebenso.
    const bpIp = prepared.entities[0]!.entryPoints[0]! + offsets['bp']!;
    bm.add({ entityIndex: 0, slot: 0, ip: bpIp });
    rt.start();
    rt.run(3);
    expect(readBank(rt.state, 3, 0, false)).toBe(1); // vor Instruktion angehalten
    expect(bm.hits).toHaveLength(1);
    expect(bm.isPaused(0, 0)).toBe(true);
    expect(readBank(rt.state, 3, 1, false)).toBe(3); // anderer Kontext lief weiter

    bm.step(0, 0, 1);
    rt.tick();
    expect(readBank(rt.state, 3, 0, false)).toBe(2); // exakt eine Instruktion
    expect(bm.isPaused(0, 0)).toBe(true);

    bm.resume(0, 0);
    rt.tick();
    expect(readBank(rt.state, 3, 0, false)).toBe(3);
    expect(rt.state.entities[0]!.context).toBeNull(); // Script beendet
  });
});
