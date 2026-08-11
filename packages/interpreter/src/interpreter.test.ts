import { describe, expect, it } from 'vitest';
import { composeScriptSection, ScriptAssembler } from '@webmidgar/fixture-gen';
import { parseScriptSection, type FieldDiagnostic } from '@webmidgar/formats-field';
import { CMP, IMPL_OPERAND_LEN, OP_KAWAI, SKIP_OPERAND_LEN } from './opcodes.js';
import { FieldRuntime } from './runtime.js';
import { prepareScript, type PreparedScript } from './prepared.js';
import { berechneAnfangsBgStates, readBank } from './state.js';
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

  it('Bank-Aliasing (S14): gepaarte Bänke teilen sich eine Region, ungepaarte nicht', () => {
    // Bis S13 waren die 16 Bänke unabhängige Puffer. Das war falsch: Ein
    // Skript, das über Bank 1 schreibt und über Bank 2 liest, hätte den Wert
    // nie gesehen. Geprüft wird jedes dokumentierte Paar in beide Richtungen.
    const pairs: [number, number][] = [
      [1, 2],
      [3, 4],
      [0xb, 0xc],
      [0xd, 0xe],
      [7, 0xf],
      [5, 6],
    ];
    for (const [a, b] of pairs) {
      const asm = new ScriptAssembler();
      asm.setByte(a, 10, 123).setByte(b, 20, 45).ret();
      const { bytes } = asm.assemble();
      const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
      rt.start();
      rt.tick();
      expect(bank(rt, b, 10), `Bank ${a} → ${b}`).toBe(123);
      expect(bank(rt, a, 20), `Bank ${b} → ${a}`).toBe(45);
    }
    // Gegenprobe: Bänke aus verschiedenen Paaren dürfen sich NICHT sehen.
    const asm = new ScriptAssembler();
    asm.setByte(1, 30, 99).ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    expect(bank(rt, 3, 30)).toBe(0);
    expect(bank(rt, 5, 30)).toBe(0);
  });

  it('Bank-Aliasing überlebt Snapshot und Restore', () => {
    const asm = new ScriptAssembler();
    asm.setByte(1, 10, 7).ret();
    const { bytes } = asm.assemble();
    const prepared = prepare([{ name: 'hero', entries: [0] }], bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.tick();
    const restored = restoreRuntime(snapshotRuntime(rt.state), prepared);
    // Nach dem Restore muss die Aliasbindung noch stehen: ein Schreibzugriff
    // über Bank 2 muss weiterhin über Bank 1 sichtbar sein.
    restored.state.banks[2]![10] = 42;
    expect(restored.state.banks[1]![10]).toBe(42);
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
    // Der String-Index-Operand (zweites Operandenbyte) wird durchgereicht.
    expect((w as { dialogId: number }).dialogId).toBe(3);
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
    // ASK-Operanden: Dialog-Index + erste/letzte wählbare Zeile.
    const ask = w as { dialogId: number; firstChoice?: number; lastChoice?: number };
    expect(ask.dialogId).toBe(5);
    expect(ask.firstChoice).toBe(1);
    expect(ask.lastChoice).toBe(3);
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

describe('Wirt-Interaktion (requestEntityScript, F04)', () => {
  it('startet ein gültiges Entry an der nächsten Tick-Grenze; Doppelstart wird abgelehnt', () => {
    const asm = new ScriptAssembler();
    asm.label('init').ret();
    asm.label('talk').setByte(3, 0, 7).wait(2).setByte(3, 1, 8).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare([{ name: 'npc', entries: [offsets['init']!, offsets['talk']!] }], bytes),
      { mainLoop: false },
    );
    rt.start();
    rt.tick(); // Init durch
    expect(rt.requestEntityScript(0, 1)).toBe(true);
    expect(rt.requestEntityScript(0, 1)).toBe(false); // bereits eingereiht (staged)
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(7); // Talk lief an der Tick-Grenze an
    expect(rt.requestEntityScript(0, 1)).toBe(false); // läuft gerade (WAIT)
    rt.run(4);
    expect(bank(rt, 3, 1)).toBe(8); // Talk zu Ende
    expect(rt.requestEntityScript(0, 1)).toBe(true); // wieder frei
  });

  it('lehnt leere, wiederholte und unbekannte Entries ohne jede Zustandsänderung ab', () => {
    const asm = new ScriptAssembler();
    asm.label('init').ret();
    const { bytes } = asm.assemble();
    // Slot 1 wiederholt Slot 0 (Fixture-Komposition = Realdaten-Konvention),
    // Slot 2 trägt den codeEnd-Sentinel (leerer Span).
    const rt = new FieldRuntime(
      prepare([{ name: 'npc', entries: [0, 0, bytes.length] }], bytes),
      { mainLoop: false },
    );
    rt.start();
    rt.tick();
    const before = stateDigest(rt.state);
    expect(rt.requestEntityScript(0, 1)).toBe(false); // wiederholter Slot = ungenutzt
    expect(rt.requestEntityScript(0, 2)).toBe(false); // Sentinel == codeEnd
    expect(rt.requestEntityScript(0, 40)).toBe(false); // außerhalb der 32 Slots
    expect(rt.requestEntityScript(9, 1)).toBe(false); // Entität existiert nicht
    expect(rt.state.droppedRequests).toBe(0); // keine Skript-Diagnose für Wirt-Abweisungen
    expect(stateDigest(rt.state)).toBe(before); // Ablehnung ist nebenwirkungsfrei
  });

  it('verdrängt eine wartende Main-Schleife (INTERACTION_PRIORITY) und setzt sie danach fort', () => {
    const asm = new ScriptAssembler();
    asm.ret(); // Init (Entry 0)
    asm.inc(3, 0).wait(10).ret(); // Main: zählt, wartet lange
    asm.label('talk').setByte(3, 1, 5).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'npc', entries: [0, offsets['talk']!] }], bytes), {
      mainLoop: true,
    });
    rt.start();
    rt.run(2); // Tick 1 Init, Tick 2: Main zählt und hängt im WAIT bis Tick 12
    expect(bank(rt, 3, 0)).toBe(1);
    expect(rt.requestEntityScript(0, 1)).toBe(true);
    rt.tick(); // Talk verdrängt den wartenden Main-Kontext und läuft durch
    expect(bank(rt, 3, 1)).toBe(5);
    expect(bank(rt, 3, 0)).toBe(1); // Main hat nicht erneut gezählt
    rt.run(11); // Main-WAIT läuft ab, Schleife iteriert erneut
    expect(bank(rt, 3, 0)).toBeGreaterThan(1);
  });

  it('exclusive verhindert den Start neben einem laufenden Interaktionskontext', () => {
    const asm = new ScriptAssembler();
    asm.label('init').ret();
    asm.label('s1').wait(5).ret();
    asm.label('s2').setByte(3, 0, 1).ret();
    const { bytes, offsets } = asm.assemble();
    const rt = new FieldRuntime(
      prepare([{ name: 'npc', entries: [offsets['init']!, offsets['s1']!, offsets['s2']!] }], bytes),
      { mainLoop: false },
    );
    rt.start();
    rt.tick();
    expect(rt.requestEntityScript(0, 1)).toBe(true);
    rt.tick(); // s1 läuft (WAIT)
    expect(rt.requestEntityScript(0, 2, { exclusive: true })).toBe(false); // Entität beschäftigt
    expect(rt.requestEntityScript(0, 2)).toBe(true); // ohne exclusive erlaubt
  });

  it('Zusatzkontexte überleben Snapshot/Restore bitidentisch', () => {
    const asm = new ScriptAssembler();
    asm.label('init').ret();
    asm.label('talk').setByte(3, 0, 1).wait(5).setByte(3, 1, 9).ret();
    const { bytes, offsets } = asm.assemble();
    const prepared = prepare([{ name: 'npc', entries: [offsets['init']!, offsets['talk']!] }], bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.tick();
    rt.requestEntityScript(0, 1);
    rt.tick(); // Talk läuft und hängt im WAIT — mitten im Zusatzkontext sichern
    const snap = snapshotRuntime(rt.state);
    rt.run(6);
    expect(bank(rt, 3, 1)).toBe(9);
    const digestA = stateDigest(rt.state);

    const rt2 = new FieldRuntime(prepared, { mainLoop: false });
    expect(rt2.restoreFrom(snap)).toEqual([]);
    rt2.run(6);
    expect(stateDigest(rt2.state)).toBe(digestA);
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

  it('UNKNOWN mit bekannter Länge wird übersprungen und gezählt, der Kontext läuft weiter', () => {
    const asm = new ScriptAssembler();
    // 0x7E (TLKON, Skip-Tabelle, 1 Operand) — nicht implementiert, Länge bekannt.
    asm.raw(0x7e, 0x01).setByte(3, 0, 1).raw(0x7e, 0x00).setByte(3, 0, 2).ret();
    const { bytes } = asm.assemble();
    const trace = new RingTrace(16);
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false, trace });
    rt.start();
    rt.tick();
    expect(rt.state.unknownSkips[0x7e]).toBe(2);
    expect(bank(rt, 3, 0)).toBe(2); // beide Zuweisungen erreicht
    const last = trace.last(1)[0]!;
    expect(last.category).not.toBe('unknown-fault');
  });

  it('die Längentabelle deckt alle 256 Opcodes ab — der UNKNOWN-Fault ist damit unerreichbar', () => {
    // Seit S12 ist die Tabelle aus den Realdaten abgeleitet und vollständig
    // (Spannen-Abschluss 99,73 %). Der Fault-Zweig der UNKNOWN-Politik bleibt
    // als Sicherung bestehen, kann aber von keinem Opcode mehr ausgelöst
    // werden. Fällt diese Zusicherung, ist die Tabelle beschädigt.
    const missing: number[] = [];
    for (let op = 0; op < 256; op++) {
      if (op === OP_KAWAI) continue; // variabel lang, gesondert behandelt
      if (IMPL_OPERAND_LEN[op] === undefined && SKIP_OPERAND_LEN[op] === undefined) missing.push(op);
    }
    expect(missing).toEqual([]);
  });

  it('S-DEADSKIP: beide Längentabellen sind disjunkt und decken zusammen mit KAWAI genau 256 Opcodes', () => {
    // `vm.ts` fragt IMMER zuerst `IMPL_OPERAND_LEN`. Ein Opcode, der in beiden
    // Tabellen steht, hat deshalb einen toten Skip-Eintrag. Bis 2026-08-11
    // waren das 17 Stück (0x02, 0x03, 0x49, 0x4A, 0x60, 0x70, 0x71, 0xA0–0xA5,
    // 0xA8, 0xB3, 0xF0, 0xF1). Alle 17 stimmten überein — und genau darin lag
    // der Fehler: Ein toter Eintrag, der zufällig richtig ist, meldet sich nie,
    // bis jemand nur eine der beiden Tabellen pflegt. Dieser Test macht die
    // Doppelung zu einem sofortigen Testbruch statt zu einer stillen Falle.
    const doppelt = Object.keys(IMPL_OPERAND_LEN)
      .map(Number)
      .filter((op) => SKIP_OPERAND_LEN[op] !== undefined)
      .map((op) => `0x${op.toString(16)}`);
    expect(doppelt).toEqual([]);

    // KAWAI darf in keiner der beiden Tabellen stehen — seine Länge steht im
    // ersten Operandenbyte, ein Tabelleneintrag würde sie überschreiben.
    expect(IMPL_OPERAND_LEN[OP_KAWAI]).toBeUndefined();
    expect(SKIP_OPERAND_LEN[OP_KAWAI]).toBeUndefined();

    // Und die Summe muss aufgehen: lückenlos, überschneidungsfrei, 256.
    const summe = Object.keys(IMPL_OPERAND_LEN).length + Object.keys(SKIP_OPERAND_LEN).length + 1;
    expect(summe).toBe(256);
  });

  it('Fault-Journal + Slot-Isolation greifen bei einem Laufzeitfault (Masterplan 4.3)', () => {
    const asm = new ScriptAssembler();
    // Unbekannter Vergleichsoperator (15) → strukturierter Fault statt Raten.
    asm.setByte(3, 0, 1).ifub(3, 0, 1, 15, 'ende').label('ende').ret();
    const { bytes } = asm.assemble();
    const rt = new FieldRuntime(prepare([{ name: 'hero', entries: [0] }], bytes), { mainLoop: false });
    rt.start();
    rt.tick();
    const entity = rt.state.entities[0]!;
    expect(entity.context).toBeNull(); // Fault beendet den Kontext
    expect(rt.state.faultCount).toBe(1);
    expect(rt.state.faults[0]).toMatchObject({ reason: 'unknown-comparison' });
    expect(entity.disabledSlots).toContain(0);
    expect(rt.enqueueRequest(0, 0, 1, 'async')).toBe(false); // Slot gesperrt
  });
});

describe('XYI / XYZ (Bündelübernahme 2026-08-11)', () => {
  /**
   * Rohbytes statt Assembler: Die zu prüfende Aussage IST die Byteaufteilung.
   * Ginge sie über einen Assembler, der dieselbe Annahme kodiert, prüfte der
   * Test nur, ob zwei Kopien derselben Annahme zueinander passen.
   */
  const lauf = (bytes: number[]): FieldRuntime => {
    const rt = new FieldRuntime(prepare([{ name: 'npc', entries: [0] }], new Uint8Array(bytes)), {
      mainLoop: false,
    });
    rt.start();
    rt.tick();
    return rt;
  };
  // SETBYTE Bank 3 Adresse 0 ← 7: die Ausrichtungsprobe hinter dem Testopcode.
  const MARKE = [0x80, 0x30, 0x00, 0x07];

  it('XYI setzt x, y und das Dreieck — und lässt die Höhe stehen', () => {
    const rt = lauf([
      // XYZI: Ausgangsposition mit Höhe 50 und Dreieck 9.
      0xa5, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x32, 0x00, 0x09, 0x00,
      // XYI: x=10, y=20, Dreieck 3 — kein Höhenoperand.
      0xa6, 0x00, 0x00, 0x0a, 0x00, 0x14, 0x00, 0x03, 0x00,
      ...MARKE,
      0x00,
    ]);
    const actor = rt.state.actors[0]!;
    expect(actor.position).toEqual([10, 20, 50]); // Höhe unverändert
    expect(actor.triangle).toBe(3);
    // Die Marke beweist die Länge 8: Bei jeder anderen liefe der Strom in die
    // Operanden und träfe SETBYTE nie an der richtigen Stelle.
    expect(bank(rt, 3, 0)).toBe(7);
  });

  it('XYZ setzt x, y und die Höhe — und lässt das Dreieck stehen', () => {
    const rt = lauf([
      0xa5, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x32, 0x00, 0x09, 0x00,
      // XYZ: x=−4, y=8, z=100.
      0xa7, 0x00, 0x00, 0xfc, 0xff, 0x08, 0x00, 0x64, 0x00,
      ...MARKE,
      0x00,
    ]);
    const actor = rt.state.actors[0]!;
    expect(actor.position).toEqual([-4, 8, 100]);
    expect(actor.triangle).toBe(9); // Dreieck unverändert
    expect(bank(rt, 3, 0)).toBe(7);
  });

  it('XYI liest Bankoperanden über die Nibbleaufteilung der beiden Bankbytes', () => {
    // Bankbyte 1 = 0x33 (x und y aus Bank 3), Bankbyte 2 = 0x30 (Dreieck aus
    // Bank 3). Die Adressen stehen als u16 im Bytecode — das hohe Byte ist bei
    // echten Bankoperanden immer 0, genau die Signatur, an der die Länge 8
    // gemessen wurde.
    // Die Bankzugriffe sind 16 Bit breit (wie bei XYZI), die Adressen liegen
    // deshalb um zwei auseinander und werden mit SETWORD gefüllt.
    const rt = lauf([
      0x81, 0x30, 0x10, 0x2a, 0x00, // Bank 3[0x10] ← 42  (x)
      0x81, 0x30, 0x12, 0x0b, 0x00, // Bank 3[0x12] ← 11  (y)
      0x81, 0x30, 0x14, 0x05, 0x00, // Bank 3[0x14] ← 5   (Dreieck)
      0xa6, 0x33, 0x30, 0x10, 0x00, 0x12, 0x00, 0x14, 0x00,
      ...MARKE,
      0x00,
    ]);
    const actor = rt.state.actors[0]!;
    expect(actor.position?.[0]).toBe(42);
    expect(actor.position?.[1]).toBe(11);
    expect(actor.triangle).toBe(5);
    expect(bank(rt, 3, 0)).toBe(7);
  });

  it('XYI beendet einen laufenden Bewegungsauftrag wie XYZI', () => {
    const rt = lauf([
      0xa8, 0x00, 0x64, 0x00, 0x64, 0x00, // MOVE 100/100 → yield
      0x00,
    ]);
    expect(rt.state.actors[0]!.moveTarget).not.toBeNull();
    // Zweiter Lauf: XYI nach MOVE muss den Auftrag löschen.
    const rt2 = lauf([
      0xa6, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00,
      0x00,
    ]);
    expect(rt2.state.actors[0]!.moveTarget).toBeNull();
  });
});

describe('Anfangszustand der Hintergrundmasken (F35-1)', () => {
  it('belegt je Parameter das niedrigste vorkommende Zustandsbit', () => {
    // Kachelsatz nach dem Muster von `junonr2`: param 16 mit den Zuständen
    // 1/2/4, param 17 mit 1…128, dazu statische Kacheln (param 0).
    const kacheln = [
      { param: 0, state: 0 },
      { param: 16, state: 4 },
      { param: 16, state: 1 },
      { param: 16, state: 2 },
      { param: 17, state: 8 },
      { param: 17, state: 2 },
    ];
    expect(berechneAnfangsBgStates(kacheln)).toEqual({ 16: 1, 17: 2 });
  });

  it('lässt statische Kacheln (param 0) und Zustand 0 außen vor', () => {
    expect(berechneAnfangsBgStates([{ param: 0, state: 0 }, { param: 5, state: 0 }])).toEqual({});
  });

  it('die Runtime übernimmt die Vorbelegung und BGOFF räumt sie wieder ab', () => {
    // BGOFF param 16 Zustand 0 (Bit 1) — genau das Bit, das die Vorbelegung
    // gesetzt hat. Damit ist belegt, dass Vorbelegung und Opcode dieselbe
    // Maske meinen und nicht zwei getrennte Karten führen.
    const rt = new FieldRuntime(
      prepare([{ name: 'bg', entries: [0] }], new Uint8Array([0xe1, 0x00, 0x10, 0x00, 0x00])),
      { mainLoop: false, initialBgStates: { 16: 1, 17: 4 } },
    );
    expect(rt.state.bgStates).toEqual({ 16: 1, 17: 4 });
    rt.start();
    rt.tick();
    expect(rt.state.bgStates).toEqual({ 16: 0, 17: 4 });
  });

  it('ohne Angabe bleibt die Karte leer — der Zustand vor der Änderung', () => {
    const rt = new FieldRuntime(prepare([{ name: 'bg', entries: [0] }], new Uint8Array([0x00])), {});
    expect(rt.state.bgStates).toEqual({});
  });
});

describe('BGROL / BGROL2 (0xE2 / 0xE3)', () => {
  const bgLauf = (bytes: number[], initial?: Record<number, number>): FieldRuntime => {
    const rt = new FieldRuntime(prepare([{ name: 'bg', entries: [0] }], new Uint8Array(bytes)), {
      mainLoop: false,
      ...(initial ? { initialBgStates: initial } : {}),
    });
    rt.start();
    rt.run(3);
    return rt;
  };

  it('BGROL schaltet die Maske ein Bit weiter, BGROL2 eines zurück', () => {
    expect(bgLauf([0xe2, 0x00, 0x01, 0x00], { 1: 1 }).state.bgStates).toEqual({ 1: 2 });
    expect(bgLauf([0xe2, 0x00, 0x01, 0x00], { 1: 4 }).state.bgStates).toEqual({ 1: 8 });
    expect(bgLauf([0xe3, 0x00, 0x01, 0x00], { 1: 8 }).state.bgStates).toEqual({ 1: 4 });
  });

  it('die Rotation ist 8 Bit breit und schließt sich zum Ring', () => {
    // Gemessen: der Zustandsoperand von BGON/BGOFF nimmt korpusweit genau die
    // Werte 0…7 an (9684 Literalvorkommen), die Kachelzustände sind die acht
    // Zweierpotenzen. Deshalb rotiert die Maske über ein Byte, nicht über 32.
    expect(bgLauf([0xe2, 0x00, 0x01, 0x00], { 1: 128 }).state.bgStates).toEqual({ 1: 1 });
    expect(bgLauf([0xe3, 0x00, 0x01, 0x00], { 1: 1 }).state.bgStates).toEqual({ 1: 128 });
  });

  it('eine leere Maske bleibt leer — ein Zustand aus dem Nichts wäre geraten', () => {
    expect(bgLauf([0xe2, 0x00, 0x01, 0x00], { 1: 0 }).state.bgStates).toEqual({ 1: 0 });
    expect(bgLauf([0xe2, 0x00, 0x07, 0x00]).state.bgStates).toEqual({ 7: 0 });
  });

  it('BGROL und BGON greifen auf dieselbe Maske zu', () => {
    // BGON(param 1, Zustand 2) setzt Bit 2 (= 4), BGROL macht daraus 8.
    const rt = bgLauf([0xe0, 0x00, 0x01, 0x02, 0xe2, 0x00, 0x01, 0x00]);
    expect(rt.state.bgStates).toEqual({ 1: 8 });
  });

  it('das Bankpaar adressiert den Parameter wie bei BGCLR', () => {
    // Hohes Nibble = Bank des Parameters. Bank 3, Adresse 0x10 trägt 9.
    const rt = new FieldRuntime(
      prepare(
        [{ name: 'bg', entries: [0] }],
        // SETBYTE Bank3[0x10] ← 9 ; BGROL(banks=0x30, param-Adresse 0x10)
        new Uint8Array([0x80, 0x30, 0x10, 0x09, 0xe2, 0x30, 0x10, 0x00]),
      ),
      { mainLoop: false, initialBgStates: { 9: 2 } },
    );
    rt.start();
    rt.run(3);
    expect(rt.state.bgStates).toEqual({ 9: 4 });
  });

  /**
   * **Die Abnahme der Längenkorrektur 0xE2 = 2.**
   *
   * Rohbytes der Spanne [2137, 2213) aus `hyou4` (Field-Bytecode, reine
   * Zahlenangabe über ein Dateiformat). Die Spanne enthält fünf 0xE2- und vier
   * 0xE3-Blöcke, die byteidentisch gebaut sind: `24 07 00 · eX 00 01`. Unter
   * der alten Länge 1 für 0xE2 zerfielen die e2-Blöcke in `BGROL 00 / REQ /
   * RET`, während die e3-Blöcke sauber lasen — dieselbe Konstruktion, zwei
   * Lesarten in EINER Spanne. Dieser Test hält fest, dass beide jetzt gleich
   * lesen; bricht er, ist die Längenkorrektur zurückgedreht worden.
   */
  it('hyou4 [2137,2213) liest sich in beiden Blöcken gleich', () => {
    const bytes = [
      0xe4, 0x00, 0x01, 0xe0, 0x00, 0x01, 0x00, 0x00, 0xe1, 0x00, 0x01, 0x01, 0xe0, 0x00, 0x01,
      0x00, 0x24, 0x07, 0x00, 0xe2, 0x00, 0x01, 0x24, 0x07, 0x00, 0xe2, 0x00, 0x01, 0x24, 0x07,
      0x00, 0xe2, 0x00, 0x01, 0x24, 0x07, 0x00, 0xe2, 0x00, 0x01, 0x24, 0x07, 0x00, 0xe2, 0x00,
      0x01, 0x24, 0x07, 0x00, 0xe3, 0x00, 0x01, 0x24, 0x07, 0x00, 0xe3, 0x00, 0x01, 0x24, 0x07,
      0x00, 0xe3, 0x00, 0x01, 0x24, 0x07, 0x00, 0xe3, 0x00, 0x01, 0x24, 0x07, 0x00, 0x12, 0x41,
      0x00,
    ];
    const laenge = (op: number): number => {
      const l = IMPL_OPERAND_LEN[op] ?? SKIP_OPERAND_LEN[op];
      if (l === undefined) throw new Error(`keine Länge für 0x${op.toString(16)}`);
      return l;
    };
    // Linearer Durchlauf: Die Spanne muss exakt auf ihrem Ende schließen.
    const grenzen: number[] = [];
    let pc = 0;
    while (pc < bytes.length) {
      grenzen.push(pc);
      pc += 1 + laenge(bytes[pc]!);
    }
    expect(pc).toBe(bytes.length);

    // Die neun Rollblöcke liegen auf gleichem Raster: Jeder beginnt drei Byte
    // hinter einem WAIT(7) und ist selbst drei Byte lang.
    const rollen = grenzen.filter((p) => bytes[p] === 0xe2 || bytes[p] === 0xe3);
    expect(rollen).toHaveLength(9);
    expect(rollen.filter((p) => bytes[p] === 0xe2)).toHaveLength(5);
    expect(rollen.filter((p) => bytes[p] === 0xe3)).toHaveLength(4);
    // Operanden identisch, Abstände identisch — das ist die Gleichheit der
    // beiden Lesarten in Zahlen.
    for (const p of rollen) {
      expect([bytes[p + 1], bytes[p + 2]]).toEqual([0x00, 0x01]);
      expect(bytes[p - 3]).toBe(0x24); // WAIT davor
      expect(grenzen).toContain(p - 3);
    }
    const abstaende = new Set(rollen.slice(1).map((p, i) => p - rollen[i]!));
    expect([...abstaende]).toEqual([6]);

    // Gegenprobe: Unter der alten Länge 1 zerfällt genau die e2-Hälfte. Der
    // Rumpf ab 2145 (Index 8) träfe dann schon bei Index 24 auf ein RET —
    // mitten im ersten Durchlauf, vor dem JMPB am Ende.
    const alt = (op: number): number => (op === 0xe2 ? 1 : laenge(op));
    const g2: number[] = [];
    let q = 8;
    while (q < bytes.length) {
      g2.push(q);
      q += 1 + alt(bytes[q]!);
    }
    const erstesRet = g2.find((p) => bytes[p] === 0x00)!;
    expect(erstesRet).toBe(24); // absolut 2161 — die Schleife stürbe im ersten Lauf
    // Unter Länge 2 ist das erste RET des Rumpfes die Marke HINTER dem JMPB.
    const g3 = grenzen.filter((p) => p >= 8);
    expect(g3.find((p) => bytes[p] === 0x00)).toBe(75); // absolut 2212
    expect(bytes[g3[g3.length - 2]!]).toBe(0x12); // JMPB unmittelbar davor
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

describe('Kampf-Opcodes (S17)', () => {
  it('BATTLE stellt eine HostRequest, hält den Kontext an und läuft nach battle-finished weiter', () => {
    const asm = new ScriptAssembler();
    asm.battle(0x01c2).setByte(3, 0, 42).ret();
    const { bytes } = asm.assemble();
    const prepared = prepare([{ name: 'a', entries: [0] }], bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();

    rt.tick();
    const req = rt.state.hostRequests.find((r) => r.kind === 'battle');
    expect(req).toBeDefined();
    expect(req).toMatchObject({ kind: 'battle', encounterId: 0x01c2 });

    // Der Kontext wartet — die Folgeanweisung darf NICHT gelaufen sein.
    const ctx = rt.state.entities[0]!.context!;
    expect(ctx.waitState.kind).toBe('battle');
    rt.tick();
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(0);

    // Erst das Kampfergebnis löst ihn.
    const requestId = req?.kind === 'battle' ? req.requestId : -1;
    rt.postEvent({ kind: 'battle-finished', requestId, outcome: 1 });
    rt.tick();
    expect(bank(rt, 3, 0)).toBe(42);
  });

  it('ein fremdes battle-finished weckt den Kontext NICHT', () => {
    const asm = new ScriptAssembler();
    asm.battle(7).setByte(3, 1, 9).ret();
    const prepared = prepare([{ name: 'a', entries: [0] }], asm.assemble().bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.tick();

    const req = rt.state.hostRequests.find((r) => r.kind === 'battle')!;
    const requestId = req.kind === 'battle' ? req.requestId : -1;
    rt.postEvent({ kind: 'battle-finished', requestId: requestId + 1000, outcome: 0 });
    rt.tick();
    rt.tick();
    expect(bank(rt, 3, 1)).toBe(0);
    expect(rt.state.entities[0]!.context!.waitState.kind).toBe('battle');
  });

  it('BTLON schaltet die Zufallskämpfe und blockiert nicht', () => {
    const asm = new ScriptAssembler();
    asm.btlon(1).setByte(3, 2, 5).ret();
    const prepared = prepare([{ name: 'a', entries: [0] }], asm.assemble().bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.tick();
    expect(rt.state.randomEncountersDisabled).toBe(true);
    expect(bank(rt, 3, 2)).toBe(5);
  });

  it('die Bank-Variante liest die Formationsnummer aus einer Variablen', () => {
    const asm = new ScriptAssembler();
    // Formationsnummer 300 in Bank 3, Adresse 10 (Wort) ablegen …
    asm.setWord(3, 10, 300);
    // … und BATTLE mit Bank 3 im unteren Nibble aufrufen.
    asm.raw(0x70, 0x03, 10, 0).ret();
    const prepared = prepare([{ name: 'a', entries: [0] }], asm.assemble().bytes);
    const rt = new FieldRuntime(prepared, { mainLoop: false });
    rt.start();
    rt.tick();
    rt.tick();
    const req = rt.state.hostRequests.find((r) => r.kind === 'battle');
    expect(req).toMatchObject({ kind: 'battle', encounterId: 300 });
  });
});
