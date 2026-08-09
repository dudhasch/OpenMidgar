import { describe, expect, it } from 'vitest';
import { composeScriptSection, ScriptAssembler } from '@webmidgar/fixture-gen';
import { parseScriptSection, type FieldDiagnostic } from '@webmidgar/formats-field';
import { CMP } from './opcodes.js';
import { FieldRuntime } from './runtime.js';
import { prepareScript, type PreparedScript } from './prepared.js';
import { readBank } from './state.js';
import { restoreRuntime, snapshotRuntime, stateDigest } from './serde.js';
import { ReplayRecorder, replayRecording } from './replay.js';
import { RingTrace } from './trace.js';

/**
 * S6-Akzeptanztests: Fixture-Scripts stammen aus dem eigenständigen
 * Assembler (tools/fixture-gen) und laufen durch den S2-Parser — Roundtrip
 * über zwei unabhängige Implementierungen.
 */

interface EntitySpec {
  name: string;
  entries: number[];
}

function prepare(entities: EntitySpec[], bytes: Uint8Array): PreparedScript {
  const section = composeScriptSection({
    entities: entities.map((e) => ({ name: e.name, entryPoints: e.entries })),
    scriptBytes: bytes,
  });
  const diagnostics: FieldDiagnostic[] = [];
  const set = parseScriptSection(section, 'fixture', diagnostics);
  if (!set) throw new Error(`Fixture-Sektion unparsbar: ${JSON.stringify(diagnostics)}`);
  return prepareScript(set, section);
}

const bank = (rt: FieldRuntime, b: number, a: number, word = false): number => readBank(rt.state, b, a, word);

describe('Kontrollfluss', () => {
  it('Zählschleife: IFUB + JMPB zählt exakt bis 10, dann RET', () => {
    const asm = new ScriptAssembler();
    asm
      .setByte(3, 0, 0)
      .label('loop')
      .inc(3, 0)
      .ifub(3, 0, 10, CMP.LT, 'done')
      .jmpb('loop')
      .label('done')
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(10);
    expect(rt.isQuiescent()).toBe(true);
  });

  it('WAIT: Variable steigt erst nach Ablauf der Ticks', () => {
    const asm = new ScriptAssembler();
    asm.setByte(3, 0, 1).wait(5).setByte(3, 0, 2).ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick(); // Tick 1: setzt 1, wartet bis Tick 6
    expect(bank(rt, 3, 0)).toBe(1);
    rt.run(4); // Tick 5: noch wartend
    expect(bank(rt, 3, 0)).toBe(1);
    rt.tick(); // Tick 6: Fortsetzung am Tickanfang
    expect(bank(rt, 3, 0)).toBe(2);
  });

  it('Vorwärts-/Rückwärtssprünge (kurz + lang) erreichen ihre Ziele', () => {
    const asm = new ScriptAssembler();
    asm
      .jmpfl('mid')
      .label('back')
      .setByte(3, 1, 77)
      .jmpf('end')
      .label('mid')
      .setByte(3, 0, 42)
      .jmpbl('back')
      .label('end')
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(42);
    expect(bank(rt, 3, 1)).toBe(77);
  });

  it('Init/Main-Semantik (🟡): Main-Teil hinter dem Init-RET läuft je Tick einmal weiter', () => {
    const asm = new ScriptAssembler();
    asm
      .setByte(3, 0, 1) // Init
      .ret()
      .inc(3, 1) // Main: zählt je Tick
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: true });
    rt.start();
    rt.run(5); // Tick 1: Init; Ticks 2–5: je 1 Main-Iteration
    expect(bank(rt, 3, 0)).toBe(1);
    expect(bank(rt, 3, 1)).toBe(4);
  });

  it('Main-Teil läuft nie in den Span der nächsten Entität', () => {
    const asm = new ScriptAssembler();
    asm.label('e0').setByte(3, 0, 1).ret(); // Entität 0: reines Init, kein Main
    asm.label('e1').inc(3, 2).ret().inc(3, 3).ret(); // Entität 1: Init + Main
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'a', entries: [offsets['e0']!] },
          { name: 'b', entries: [offsets['e1']!] },
        ],
        bytes,
      ),
      { mainLoop: true },
    );
    rt.start();
    rt.run(10);
    // Liefe Entität 0 hinter ihrem Init-RET weiter, würde sie e1-Code
    // mitausführen und (3,2) über 1 treiben.
    expect(bank(rt, 3, 2)).toBe(1);
    expect(bank(rt, 3, 3)).toBe(9); // b-Main: Ticks 2–10
  });
});

describe('Variablen', () => {
  it('Arithmetik: wickelnde und saturierende Varianten, Byte und Wort', () => {
    const asm = new ScriptAssembler();
    asm
      .setByte(3, 0, 250)
      .plus(3, 0, 10) // 260 → wickelt zu 4
      .setByte(3, 1, 250)
      .plusSat(3, 1, 10) // saturiert zu 255
      .setWord(3, 2, 0xfffe)
      .plus2(3, 2, 5) // wickelt zu 3
      .setWord(3, 4, 0xfffe)
      .plus2Sat(3, 4, 5) // saturiert zu 0xffff
      .setByte(3, 6, 3)
      .minus(3, 6, 5) // wickelt zu 254
      .setByte(3, 7, 3)
      .minusSat(3, 7, 5) // saturiert zu 0
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(4);
    expect(bank(rt, 3, 1)).toBe(255);
    expect(bank(rt, 3, 2, true)).toBe(3);
    expect(bank(rt, 3, 4, true)).toBe(0xffff);
    expect(bank(rt, 3, 6)).toBe(254);
    expect(bank(rt, 3, 7)).toBe(0);
  });

  it('Bit-Ops, MUL/DIV/MOD (Division durch 0 → 0, 🟡) und Bank-zu-Bank-Quellen', () => {
    const asm = new ScriptAssembler();
    asm
      .biton(3, 0, 3) // 0b1000
      .biton(3, 0, 0) // 0b1001
      .bitoff(3, 0, 3) // 0b0001
      .bitxor(3, 0, 0) // 0b0000
      .setByte(3, 1, 7)
      .mul(3, 1, 6) // 42
      .setByte(3, 2, 42)
      .div(3, 2, 0) // Division durch 0 → 0
      .setByte(3, 3, 47)
      .mod(3, 3, 10) // 7
      .setByte(2, 5, 9)
      .setByte(3, 4, { bank: 2, addr: 5 }) // Quelle aus Bank 2
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(0);
    expect(bank(rt, 3, 1)).toBe(42);
    expect(bank(rt, 3, 2)).toBe(0);
    expect(bank(rt, 3, 3)).toBe(7);
    expect(bank(rt, 3, 4)).toBe(9);
  });

  it('RANDOM ist deterministisch pro Seed', () => {
    const asm = new ScriptAssembler();
    asm.random(3, 0).random(3, 1).ret();
    const { bytes } = asm.assemble();
    const prepared = prepare([{ name: 'hero', entries: [0] }], bytes);
    const run = (seed: number): [number, number] => {
      const rt = new FieldRuntime(prepared, { seed, mainLoop: false });
      rt.start();
      rt.tick();
      return [bank(rt, 3, 0), bank(rt, 3, 1)];
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it('Signierter Wortvergleich (IFSW) behandelt negative Werte korrekt', () => {
    const asm = new ScriptAssembler();
    asm
      .setWord(3, 0, 0xffff) // −1 als i16
      .ifsw(3, 0, 5, CMP.LT, 'else')
      .setByte(3, 2, 1) // −1 < 5 → then
      .ret()
      .label('else')
      .setByte(3, 2, 2)
      .ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 2)).toBe(1);
  });
});

describe('Dialog-Stub', () => {
  it('MESSAGE blockiert bis DialogueResolved; parallele Entität läuft weiter', () => {
    const asm = new ScriptAssembler();
    asm.label('a').window(0, 10, 10, 100, 40).message(0, 3).setByte(3, 0, 1).ret();
    asm.label('b').inc(3, 1).wait(1).jmpb('b');
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'talker', entries: [offsets['a']!] },
          { name: 'walker', entries: [offsets['b']!] },
        ],
        bytes,
      ),
      { mainLoop: false },
    );
    rt.start();
    rt.run(3);
    expect(bank(rt, 3, 0)).toBe(0); // talker hängt im Dialog
    expect(bank(rt, 3, 1)).toBe(3); // walker lief parallel weiter
    const w = rt.state.entities[0]!.context!.waitState;
    expect(w.kind).toBe('dialogue');
    rt.postEvent({ kind: 'dialogue-resolved', requestId: (w as { requestId: number }).requestId, choice: 0 });
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(1);
  });

  it('ASK schreibt die Auswahl in die Zielvariable', () => {
    const asm = new ScriptAssembler();
    asm.ask(3, 9, 0, 5, 1, 3).setByte(3, 0, 1).ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    const w = rt.state.entities[0]!.context!.waitState;
    expect(w.kind).toBe('dialogue');
    rt.postEvent({ kind: 'dialogue-resolved', requestId: (w as { requestId: number }).requestId, choice: 2 });
    rt.tick();
    expect(bank(rt, 3, 9)).toBe(2);
    expect(bank(rt, 3, 0)).toBe(1);
  });
});

describe('Script-Requests (REQ/REQSW/REQEW, 🟡 R1-Hooks)', () => {
  it('REQ ist asynchron: Anforderer läuft weiter, Ziel startet am Tickanfang', () => {
    const asm = new ScriptAssembler();
    asm.label('a').req(1, 1, 3).setByte(3, 0, 1).ret();
    asm.label('b-init').ret();
    asm.label('b-s1').setByte(3, 1, 9).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'a', entries: [offsets['a']!] },
          { name: 'b', entries: [offsets['b-init']!, offsets['b-s1']!] },
        ],
        bytes,
      ),
      { mainLoop: false },
    );
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(1); // a lief durch
    expect(bank(rt, 3, 1)).toBe(0); // b-s1 startet erst nächste Tick-Grenze
    rt.tick();
    expect(bank(rt, 3, 1)).toBe(9);
  });

  it('REQEW ist synchron: Anforderer wartet auf Abschluss des Zielscripts', () => {
    const asm = new ScriptAssembler();
    asm.label('a').reqew(1, 1, 3).setByte(3, 0, 1).ret();
    asm.label('b-init').ret();
    asm.label('b-s1').wait(3).setByte(3, 1, 9).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'a', entries: [offsets['a']!] },
          { name: 'b', entries: [offsets['b-init']!, offsets['b-s1']!] },
        ],
        bytes,
      ),
      { mainLoop: false },
    );
    rt.start();
    rt.run(3);
    expect(bank(rt, 3, 0)).toBe(0); // a wartet noch (b-s1 im WAIT)
    rt.run(3);
    expect(bank(rt, 3, 1)).toBe(9);
    expect(bank(rt, 3, 0)).toBe(1); // a wurde nach Abschluss fortgesetzt
  });

  it('Höherpriore Requests verdrängen an der Tick-Grenze; Verdrängter wird fortgesetzt', () => {
    const asm = new ScriptAssembler();
    // Ziel: langlaufendes Slot-1-Script (Priorität 5) wird von Slot-2 (Priorität 1) verdrängt.
    asm.label('a').req(1, 1, 5).wait(2).req(1, 2, 1).ret();
    asm.label('b-init').ret();
    asm.label('b-s1').inc(3, 0).wait(1).jmpb('b-s1');
    asm.label('b-s2').setByte(3, 1, 9).wait(4).setByte(3, 2, 9).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'a', entries: [offsets['a']!] },
          { name: 'b', entries: [offsets['b-init']!, offsets['b-s1']!, offsets['b-s2']!] },
        ],
        bytes,
      ),
      { mainLoop: false },
    );
    rt.start();
    rt.run(4);
    expect(bank(rt, 3, 1)).toBe(9); // s2 hat verdrängt
    const before = bank(rt, 3, 0);
    rt.run(6);
    expect(bank(rt, 3, 2)).toBe(9); // s2 fertig
    expect(bank(rt, 3, 0)).toBeGreaterThan(before); // s1 läuft danach weiter
  });
});

describe('Budget-Eskalation & UNKNOWN-Politik', () => {
  it('Endlosschleife ohne Yield: Zwangs-Yields, dann Fault; Nachbar unbeeinträchtigt', () => {
    const asm = new ScriptAssembler();
    asm.label('hot').inc(3, 0).jmpb('hot');
    asm.label('calm').inc(3, 1).wait(1).jmpb('calm');
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare(
        [
          { name: 'hot', entries: [offsets['hot']!] },
          { name: 'calm', entries: [offsets['calm']!] },
        ],
        bytes,
      ),
      { mainLoop: false, budget: 100, maxBudgetStrikes: 3 },
    );
    rt.start();
    rt.run(2);
    // Nach 2 Ticks: 2 Strikes, noch kein Fault.
    expect(rt.state.entities[0]!.context!.status).toBe('running');
    rt.tick();
    const hot = rt.state.entities[0]!;
    expect(hot.context).toBeNull();
    expect(rt.state.faults[0]).toMatchObject({ reason: 'budget' });
    expect(hot.disabledSlots).toContain(0);
    rt.run(3);
    expect(bank(rt, 3, 1)).toBe(6); // calm lief die ganze Zeit
  });

  it('UNKNOWN mit bekannter Länge wird übersprungen und gezählt; ohne Länge → strukturierter Fault', () => {
    const asm = new ScriptAssembler();
    // 0xF0 (MUSIC, Skip-Tabelle, 1 Operand) + 0xFF (unbekannt).
    asm.raw(0xf0, 0x07).setByte(3, 0, 1).raw(0xff).setByte(3, 0, 2).ret();
    const { bytes } = asm.assemble();
    const trace = new RingTrace(16);
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false, trace });
    rt.start();
    rt.tick();
    expect(rt.state.unknownSkips[0xf0]).toBe(1);
    expect(bank(rt, 3, 0)).toBe(1); // bis zum unbekannten Op gekommen
    const entity = rt.state.entities[0]!;
    expect(entity.context).toBeNull(); // Fault beendet den Kontext
    const last = trace.last(1)[0]!;
    expect(last.category).toBe('unknown-fault');
    expect(last.op).toBe(0xff);
    // Fault-Journal + Slot-Isolation (Masterplan 4.3).
    expect(rt.state.faultCount).toBe(1);
    expect(rt.state.faults[0]).toMatchObject({ reason: 'unknown-op', op: 0xff });
    expect(entity.disabledSlots).toContain(0);
    expect(rt.enqueueRequest(0, 0, 1, 'async')).toBe(false); // Slot gesperrt
  });
});

describe('Serialisierung & Replay (Akzeptanzkriterien S6)', () => {
  function dialogueFixture(): { prepared: PreparedScript } {
    const asm = new ScriptAssembler();
    asm.label('a').setByte(3, 0, 1).message(0, 2).setByte(3, 0, 7).ret();
    asm.label('b').inc(3, 1).wait(2).jmpb('b');
    const { bytes, offsets } = asm.assemble();
    return {
      prepared: prepare(
        [
          { name: 'a', entries: [offsets['a']!] },
          { name: 'b', entries: [offsets['b']!] },
        ],
        bytes,
      ),
    };
  }

  it('Snapshot → Restore mitten im Dialog-Yield ist verlustfrei (bitidentischer Verlauf)', () => {
    const { prepared } = dialogueFixture();
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.run(3); // a hängt im Dialog, b läuft
    const snap = snapshotRuntime(rt.state);

    const continueRun = (r: FieldRuntime): string => {
      const w = r.state.entities[0]!.context!.waitState as { requestId: number };
      r.postEvent({ kind: 'dialogue-resolved', requestId: w.requestId, choice: 1 });
      r.run(5);
      return stateDigest(r.state);
    };

    const rtB = new FieldRuntime(prepared, { mainLoop: false });
    const warnings = rtB.restoreFrom(snap);
    expect(warnings).toEqual([]);
    expect(stateDigest(rtB.state)).toBe(stateDigest(rt.state));
    expect(continueRun(rtB)).toBe(continueRun(rt));
    expect(readBank(rt.state, 3, 0, false)).toBe(7); // Dialog wurde fortgesetzt
  });

  it('Script-Hash-Guard: verändertes Script → ip-Reset + Warnung', () => {
    const { prepared } = dialogueFixture();
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.run(2);
    const snap = snapshotRuntime(rt.state);

    const asm = new ScriptAssembler();
    asm.label('a').setByte(3, 0, 3).ret();
    asm.label('b').wait(1).jmpb('b');
    const { bytes, offsets } = asm.assemble();
    const other = prepare(
      [
        { name: 'a', entries: [offsets['a']!] },
        { name: 'b', entries: [offsets['b']!] },
      ],
      bytes,
    );
    const { state, warnings } = restoreRuntime(snap, other);
    expect(warnings.length).toBeGreaterThan(0);
    expect(state.scriptHash).toBe(other.scriptHash);
    const ctx = state.entities[0]!.context!;
    expect(ctx.ip).toBe(other.entities[0]!.entryPoints[0]);
    expect(ctx.waitState.kind).toBe('none');
  });

  it('Replay-Digest über 10.000 Ticks: zwei unabhängige Läufe bitidentisch, Wiedergabe ebenso', () => {
    const asm = new ScriptAssembler();
    asm
      .label('a')
      .random(3, 0)
      .ifub(3, 0, 128, CMP.LT, 'skip')
      .inc2(3, 2)
      .label('skip')
      .message(0, 1)
      .plus2(3, 4, 3)
      .ret() // Init-RET → Main-Teil:
      .inc(3, 6)
      .ret();
    asm.label('b').inc2(3, 8).wait(3).req(0, 1, 2).jmpb('b');
    asm.label('a-s1').plus(3, 10, 5).ret();
    const { bytes, offsets } = asm.assemble();
    const prepared = prepare(
      [
        { name: 'a', entries: [offsets['a']!, offsets['a-s1']!] },
        { name: 'b', entries: [offsets['b']!] },
      ],
      bytes,
    );

    const record = (): { digests: string[]; final: string; recording: ReplayRecorder['recording'] } => {
      const rt = new FieldRuntime(prepared, { seed: 99, mainLoop: true });
      rt.start();
      const rec = new ReplayRecorder(rt, 500);
      for (let t = 0; t < 10_000; t++) {
        rec.tick();
        // Deterministische „UI": jeden offenen Dialog alle 7 Ticks bestätigen.
        for (const entity of rt.state.entities) {
          const w = entity.context?.waitState;
          if (w?.kind === 'dialogue' && rt.state.tickCounter % 7 === 0) {
            rec.postEvent({ kind: 'dialogue-resolved', requestId: w.requestId, choice: rt.state.tickCounter % 3 });
          }
        }
      }
      return { digests: rec.recording.digests, final: stateDigest(rt.state), recording: rec.recording };
    };

    const runA = record();
    const runB = record();
    expect(runA.digests.length).toBe(20);
    expect(runA.digests).toEqual(runB.digests);
    expect(runA.final).toBe(runB.final);

    // Wiedergabe aus der Aufzeichnung (Start-Snapshot + Eingabestrom).
    const replayed = replayRecording(runA.recording, prepared);
    expect(replayed.warnings).toEqual([]);
    expect(replayed.digests).toEqual(runA.digests);
    expect(replayed.finalDigest).toBe(runA.final);
  });
});
