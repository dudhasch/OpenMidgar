import { describe, expect, it } from 'vitest';
import {
  composeFieldContainer,
  composeScriptSection,
  composeTriggersSection,
  composeWalkmeshSection,
  ScriptAssembler,
  type ScriptSpec,
  type TriggersSpec,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { readBank } from '@webmidgar/interpreter';
import { FieldSession, type FieldInput } from './session.js';
import { decodeFieldDialogs } from './dialog.js';
import { InputRecorder, replayInputs } from './replay.js';

/**
 * Fixture-Testsuite für `FieldSession` (Masterplan Phase 5, vertikaler
 * Durchstich): jede Fixture läuft ausschließlich über die Composer aus
 * `tools/fixture-gen` und wird mit `parseFieldContainer` geparst — damit
 * beweist jeder Test die volle Kette Writer → Parser → Laufzeit, nie Bytes
 * von Hand.
 */

// --- Fixture-Helfer ----------------------------------------------------------

/** Flaches Rechteck aus 2 Dreiecken — ausreichend für Bewegung ohne Kanteneinfluss. */
function flatRect(x0: number, y0: number, x1: number, y1: number, z = 0): WalkmeshSpec {
  return {
    triangles: [
      { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z]] },
      { vertices: [[x0, y0, z], [x1, y1, z], [x0, y1, z]] },
    ],
  };
}

/** Raster aus nx×ny Zellen, optional mit linearer Steigung (muss ganzzahlig bleiben, i16!). */
function flatGrid(
  nx: number,
  ny: number,
  cell: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  slope: { sx: number; sy: number } = { sx: 0, sy: 0 },
): WalkmeshSpec {
  const z = (x: number, y: number): number => Math.round(slope.sx * x + slope.sy * y);
  const triangles: WalkmeshSpec['triangles'] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x0 = origin.x + gx * cell;
      const x1 = origin.x + (gx + 1) * cell;
      const y0 = origin.y + gy * cell;
      const y1 = origin.y + (gy + 1) * cell;
      triangles.push(
        { vertices: [[x0, y0, z(x0, y0)], [x1, y0, z(x1, y0)], [x1, y1, z(x1, y1)]] },
        { vertices: [[x0, y0, z(x0, y0)], [x1, y1, z(x1, y1)], [x0, y1, z(x0, y1)]] },
      );
    }
  }
  return { triangles };
}

interface FixtureSpec {
  fieldId?: string;
  walkmesh?: WalkmeshSpec;
  triggers?: TriggersSpec;
  script?: ScriptSpec;
}

/** Komponiert einen kompletten Field-Container und parst ihn zurück zum `FieldBundle`. */
function buildBundle(spec: FixtureSpec): FieldBundle {
  const sections: Record<number, Uint8Array> = {};
  if (spec.walkmesh) sections[5] = composeWalkmeshSection(spec.walkmesh);
  if (spec.triggers) sections[8] = composeTriggersSection(spec.triggers);
  if (spec.script) sections[1] = composeScriptSection(spec.script);
  const layout = composeFieldContainer({ sections });
  const fieldId = spec.fieldId ?? 'fx';
  const result = parseFieldContainer(layout.bytes, fieldId);
  if (!result.ok || !result.bundle) {
    throw new Error(`Fixture nicht parsebar: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.bundle;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Tests --------------------------------------------------------------------

describe('Startplatzierung', () => {
  it('platziert die Figur mit gültigem Walkmesh in einem begehbaren Dreieck auf der Ebenenhöhe', () => {
    const bundle = buildBundle({ walkmesh: flatGrid(4, 4, 100, { x: 0, y: 0 }, { sx: 0.5, sy: 0.25 }) });
    const session = new FieldSession(bundle);
    expect(session.player).not.toBeNull();
    const { tri, x, y, height } = session.player!.walk;
    expect(session.solver!.containsPoint(tri, x, y, 0.01)).toBe(true);
    expect(height).toBeCloseTo(0.5 * x + 0.25 * y, 6);
  });

  it('bleibt ohne Walkmesh unplatziert und tick() wirft keine Ausnahme', () => {
    const bundle = buildBundle({});
    expect(bundle.walkmesh).toBeUndefined();
    const session = new FieldSession(bundle);
    expect(session.player).toBeNull();
    expect(() => session.tick()).not.toThrow();
    expect(session.player).toBeNull();
  });
});

describe('Bewegung und Invariante', () => {
  it('hält die Figur über 200 Ticks mit wechselnder Richtung stets im Mesh, auch an Außenkanten', () => {
    const bundle = buildBundle({ walkmesh: flatGrid(5, 5, 100) });
    const session = new FieldSession(bundle, { start: { x: 250, y: 250 } });
    // Vier 50-Tick-Segmente: bewusst lange in eine Richtung (inkl. Diagonalen),
    // damit die Figur wiederholt gegen Außenkanten/Ecken gedrückt wird.
    const segments: [number, number][] = [
      [1, 0],
      [1, 1],
      [-1, 0],
      [-1, -1],
    ];
    for (let i = 0; i < 200; i++) {
      const seg = segments[Math.floor(i / 50)]!;
      const result = session.tick({ moveX: seg[0], moveY: seg[1], confirm: false, cancel: false });
      expect(result.tick).toBe(i + 1);
      expect(session.player).not.toBeNull();
      const walk = session.player!.walk;
      expect(
        session.solver!.containsPoint(walk.tri, walk.x, walk.y, 0.01),
        `Tick ${i + 1}: (${walk.x},${walk.y}) in Tri ${walk.tri}`,
      ).toBe(true);
    }
  });
});

describe('Diagonale Bewegung', () => {
  it('legt bei moveX=1,moveY=1 dieselbe Grundriss-Strecke zurück wie bei moveX=1,moveY=0', () => {
    // Großes ebenes Dreieckspaar, Start weit weg von Rand und Diagonalkante.
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 4000, 4000) });
    const start = { x: 1000, y: 3000 };
    const straight = new FieldSession(bundle, { start });
    const diagonal = new FieldSession(bundle, { start });
    straight.tick({ moveX: 1, moveY: 0, confirm: false, cancel: false });
    diagonal.tick({ moveX: 1, moveY: 1, confirm: false, cancel: false });
    const distStraight = Math.hypot(straight.player!.walk.x - start.x, straight.player!.walk.y - start.y);
    const distDiagonal = Math.hypot(diagonal.player!.walk.x - start.x, diagonal.player!.walk.y - start.y);
    expect(Math.abs(distStraight - distDiagonal)).toBeLessThan(1e-9);
  });
});

describe('Gateway', () => {
  it('feuert beim Übertritt genau einmal, mit korrektem fieldChange; davor/danach nichts', () => {
    const bundle = buildBundle({
      walkmesh: flatRect(0, 0, 1200, 300),
      triggers: {
        name: 'gw',
        gateways: [{ exit: [500, 150], dest: [50, 150], destMaplistIndex: 42 }],
      },
    });
    const session = new FieldSession(bundle, { start: { x: 100, y: 150 } });
    const crossingTicks: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const result = session.tick({ moveX: 1, moveY: 0, confirm: false, cancel: false });
      if (result.fieldChange) {
        crossingTicks.push(i);
        expect(result.gateways).toHaveLength(1);
        expect(result.fieldChange.destMaplistIndex).toBe(42);
        expect(result.fieldChange.gatewayIndex).toBe(0);
      } else {
        expect(result.gateways).toHaveLength(0);
      }
    }
    expect(crossingTicks).toHaveLength(1);
  });
});

describe('Triggervolumen', () => {
  it('liefert beim Durchqueren genau ein enter und ein leave, ohne Wiederholung dazwischen', () => {
    const bundle = buildBundle({
      walkmesh: flatRect(0, 0, 1200, 300),
      triggers: { name: 'trg', triggers: [{ corners: [[400, 50, 0], [700, 250, 0]] }] },
    });
    const session = new FieldSession(bundle, { start: { x: 100, y: 150 } });
    const enters: number[] = [];
    const leaves: number[] = [];
    for (let i = 1; i <= 150; i++) {
      const result = session.tick({ moveX: 1, moveY: 0, confirm: false, cancel: false });
      for (const ev of result.triggers) {
        expect(ev.index).toBe(0);
        if (ev.kind === 'enter') enters.push(i);
        else leaves.push(i);
      }
    }
    expect(enters).toHaveLength(1);
    expect(leaves).toHaveLength(1);
    expect(enters[0]!).toBeLessThan(leaves[0]!);
  });

  it('placeAt mitten im Triggervolumen erzeugt keine Flanke (Wiedereinstieg ohne Ereignis)', () => {
    const bundle = buildBundle({
      walkmesh: flatRect(0, 0, 1200, 300),
      triggers: { name: 'trg', triggers: [{ corners: [[400, 50, 0], [700, 250, 0]] }] },
    });
    const session = new FieldSession(bundle, { start: { x: 100, y: 150 } });
    expect(session.placeAt(500, 150)).toBe(true);
    // Bewegung, die innerhalb des Volumens bleibt: keine erneute Flanke.
    const result = session.tick({ moveX: 1, moveY: 0, confirm: false, cancel: false });
    expect(result.triggers).toHaveLength(0);
  });
});

describe('Bestätigungstaste', () => {
  it('liefert confirmPressed nur bei der steigenden Flanke von confirm', () => {
    const bundle = buildBundle({});
    const session = new FieldSession(bundle);
    const press = (confirm: boolean): boolean =>
      session.tick({ moveX: 0, moveY: 0, confirm, cancel: false }).confirmPressed;
    expect(press(true)).toBe(true); // Tick 1: erste Flanke
    expect(press(true)).toBe(false); // Tick 2: weiterhin gehalten
    expect(press(false)).toBe(false); // Tick 3: losgelassen
    expect(press(false)).toBe(false); // Tick 4: weiterhin losgelassen
    expect(press(true)).toBe(true); // Tick 5: erneut gedrückt — wieder genau einmal
  });
});

describe('Snapshot/Restore', () => {
  it('liefert nach Restore in einer frischen Sitzung denselben Digest wie der Originallauf', () => {
    const bundle = buildBundle({ walkmesh: flatGrid(6, 6, 100) });
    const original = new FieldSession(bundle, { start: { x: 300, y: 300 } });

    const inputsA: FieldInput[] = [];
    for (let i = 0; i < 40; i++) {
      inputsA.push({ moveX: (i % 3) - 1, moveY: ((i + 1) % 3) - 1, confirm: i % 7 === 0, cancel: false });
    }
    for (const input of inputsA) original.tick(input);
    const snapshot = original.snapshot();

    const inputsB: FieldInput[] = [];
    for (let i = 0; i < 60; i++) {
      inputsB.push({ moveX: ((i + 2) % 3) - 1, moveY: (i % 3) - 1, confirm: i % 11 === 0, cancel: false });
    }
    for (const input of inputsB) original.tick(input);
    const digestOriginal = original.digest();

    const restored = new FieldSession(bundle);
    const restoreResult = restored.restore(snapshot);
    expect(restoreResult.ok).toBe(true);
    for (const input of inputsB) restored.tick(input);
    expect(restored.digest()).toBe(digestOriginal);
  });
});

describe('Restore-Ablehnung', () => {
  it('lehnt einen Snapshot mit fremder fieldId ab und lässt den Zustand unverändert', () => {
    const bundleA = buildBundle({ walkmesh: flatRect(0, 0, 500, 500), fieldId: 'field-a' });
    const bundleB = buildBundle({ walkmesh: flatRect(0, 0, 500, 500), fieldId: 'field-b' });
    const sessionA = new FieldSession(bundleA, { start: { x: 100, y: 100 } });
    sessionA.tick({ moveX: 1, moveY: 0, confirm: false, cancel: false });
    const foreignSnapshot = sessionA.snapshot();

    const sessionB = new FieldSession(bundleB, { start: { x: 200, y: 200 } });
    sessionB.tick({ moveX: 0, moveY: 1, confirm: false, cancel: false });
    const before = sessionB.snapshot();

    const result = sessionB.restore(foreignSnapshot);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(sessionB.snapshot()).toEqual(before);
  });
});

describe('Replay', () => {
  it('liefert nach Aufzeichnung mit InputRecorder und replayInputs auf frischer Sitzung einen bitidentischen Digest', () => {
    const bundle = buildBundle({
      walkmesh: flatRect(0, 0, 2000, 400),
      triggers: {
        name: 'replay',
        gateways: [{ exit: [900, 200], dest: [80, 200], destMaplistIndex: 55 }],
        // y-Spanne bewusst über die volle Feldhöhe, damit die Vertikaldrift
        // des Zufallswegs die Querung nicht verhindert.
        triggers: [{ corners: [[300, 0, 0], [600, 400, 0]] }],
      },
      fieldId: 'replay-field',
    });
    const options = { start: { x: 100, y: 200 } };

    const rnd = mulberry32(0xc0ffee);
    const inputs: FieldInput[] = [];
    for (let i = 0; i < 320; i++) {
      const rx = rnd();
      const moveX = rx < 0.85 ? 1 : rx < 0.95 ? 0 : -1; // starker Vorwärtsdrall, garantiert die Querung
      const ry = rnd();
      const moveY = ry < 0.34 ? -1 : ry < 0.67 ? 0 : 1;
      inputs.push({ moveX, moveY, confirm: i % 15 < 4, cancel: false });
    }

    const original = new FieldSession(bundle, options);
    const recorder = new InputRecorder(bundle.fieldId);
    let sawTrigger = false;
    let sawGateway = false;
    let sawConfirm = false;
    for (const input of inputs) {
      const result = original.tick(input);
      if (result.triggers.length > 0) sawTrigger = true;
      if (result.fieldChange) sawGateway = true;
      if (result.confirmPressed) sawConfirm = true;
      recorder.record(input);
    }
    // Voraussetzung, damit der Test tatsächlich Trigger-/Gateway-/Tastenpfade abdeckt.
    expect(sawTrigger).toBe(true);
    expect(sawGateway).toBe(true);
    expect(sawConfirm).toBe(true);

    const recording = recorder.finish();
    expect(recording.ticks).toBeGreaterThanOrEqual(300);
    const replay = replayInputs(bundle, recording, options);
    expect(replay.digest).toBe(original.digest());
    expect(replay.fieldChanges).toBeGreaterThan(0);
    expect(replay.triggerEvents).toBeGreaterThan(0);
  });
});

describe('Dialogtexte', () => {
  /**
   * FF-Text der Fixture-Konvention: ASCII − 0x20 (realdaten-abgeleiteter
   * Versatz aus S13), 0xFF-Terminator. Bewusst hier im Test dupliziert statt
   * den Dekoder zu importieren — zwei unabhängige Umsetzungen (Dualität).
   */
  function ffText(text: string): Uint8Array {
    const out = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) - 0x20;
    out[text.length] = 0xff;
    return out;
  }

  it('MESSAGE reicht den String-Index durch; decodeFieldDialogs und dialogText liefern den Text', () => {
    const asm = new ScriptAssembler();
    asm.message(0, 1).ret();
    const { bytes } = asm.assemble();
    const bundle = buildBundle({
      script: {
        entities: [{ name: 'talker', entryPoints: [0] }],
        scriptBytes: bytes,
        strings: [ffText('Erster Text'), ffText('Hallo Midgar!')],
      },
    });

    // Volle Kette Writer → Parser → Dekoder: die selbstgebaute Stringtabelle
    // kommt Zeichen für Zeichen zurück.
    expect(decodeFieldDialogs(bundle)).toEqual(['Erster Text', 'Hallo Midgar!']);

    const session = new FieldSession(bundle, { dialogMode: 'manual' });
    const result = session.tick();
    expect(result.pendingDialogs).toHaveLength(1);
    const dialog = result.pendingDialogs[0]!;
    expect(dialog.dialogId).toBe(1); // MESSAGE mit String-Index 1
    expect(dialog.choice).toBeNull();
    expect(dialog.firstChoice).toBeNull();
    expect(session.dialogText(dialog.dialogId)).toBe('Hallo Midgar!');
    expect(session.dialogText(0)).toBe('Erster Text');
    expect(session.dialogText(99)).toBeNull(); // unbekannter Index: null, keine Exception
  });

  it('ASK trägt dialogId und Auswahlzeilen im PendingDialog', () => {
    const asm = new ScriptAssembler();
    asm.ask(3, 9, 0, 0, 1, 2).ret();
    const { bytes } = asm.assemble();
    const bundle = buildBundle({
      script: {
        entities: [{ name: 'asker', entryPoints: [0] }],
        scriptBytes: bytes,
        strings: [ffText('Ja oder nein?')],
      },
    });
    const session = new FieldSession(bundle, { dialogMode: 'manual' });
    const result = session.tick();
    expect(result.pendingDialogs).toHaveLength(1);
    const dialog = result.pendingDialogs[0]!;
    expect(dialog.dialogId).toBe(0);
    expect(dialog.choice).toEqual({ bank: 3, addr: 9 });
    expect(dialog.firstChoice).toBe(1);
    expect(dialog.lastChoice).toBe(2);
    expect(session.dialogText(dialog.dialogId)).toBe('Ja oder nein?');
  });

  it('liefert ohne Script-Sektion eine leere Tabelle', () => {
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 500, 500) });
    expect(decodeFieldDialogs(bundle)).toEqual([]);
  });
});

describe('Talk-Interaktion (F04)', () => {
  /** FF-Text wie in der Dialogtexte-Suite: ASCII − 0x20, 0xFF-Terminator. */
  function ffText(text: string): Uint8Array {
    const out = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) - 0x20;
    out[text.length] = 0xff;
    return out;
  }

  /** NPC bei (x,y): Init platziert, Main tut nichts, Talk (Entry 1) zeigt MESSAGE 0. */
  function talkerBundle(x: number, y: number, opts: { invisible?: boolean } = {}): FieldBundle {
    const asm = new ScriptAssembler();
    asm.xyzi(x, y, 0, 0);
    if (opts.invisible) asm.visi(false);
    asm.ret(); // Init-Ende — dahinter beginnt der Main-Teil
    asm.ret(); // Main: leer, terminiert sofort
    asm.label('talk').message(0, 0).ret();
    const { bytes, offsets } = asm.assemble();
    return buildBundle({
      walkmesh: flatRect(0, 0, 1200, 300),
      script: {
        entities: [{ name: 'npc', entryPoints: [0, offsets['talk']!] }],
        scriptBytes: bytes,
        strings: [ffText('Hallo!')],
      },
    });
  }

  const confirmInput: FieldInput = { moveX: 0, moveY: 0, confirm: true, cancel: false };

  it('confirm neben dem NPC startet das Talk-Script; dieselbe Flanke drückt den Dialog nicht weg', () => {
    const session = new FieldSession(talkerBundle(500, 150), { start: { x: 490, y: 150 } });
    session.tick(); // Tick 1: Init platziert den NPC
    const r = session.tick(confirmInput);
    expect(r.talkStarted).toEqual({ entityIndex: 0 });
    expect(r.pendingDialogs).toHaveLength(1);
    expect(r.pendingDialogs[0]!.entityIndex).toBe(0);
    expect(r.pendingDialogs[0]!.slot).toBe(1);
    expect(session.dialogText(r.pendingDialogs[0]!.dialogId)).toBe('Hallo!');
    expect(r.resolvedDialogs).toHaveLength(0); // die Start-Flanke beantwortet nicht

    // Gehaltene Taste: keine neue Flanke — Dialog bleibt offen, kein Neustart.
    const r2 = session.tick(confirmInput);
    expect(r2.talkStarted).toBeNull();
    expect(r2.pendingDialogs).toHaveLength(1);

    // Loslassen, erneut drücken: jetzt beantwortet die Flanke den Dialog,
    // statt ein weiteres Talk zu starten (offener Dialog konsumiert die Taste).
    session.tick();
    const r4 = session.tick(confirmInput);
    expect(r4.talkStarted).toBeNull();
    expect(r4.resolvedDialogs).toHaveLength(1);
    expect(r4.pendingDialogs).toHaveLength(0);
  });

  it('confirm außerhalb der Talk-Reichweite startet nichts', () => {
    const session = new FieldSession(talkerBundle(900, 150), { start: { x: 100, y: 150 } });
    session.tick();
    const r = session.tick(confirmInput);
    expect(r.talkStarted).toBeNull();
    expect(r.pendingDialogs).toHaveLength(0);
  });

  it('unsichtbare Entitäten sind nicht ansprechbar', () => {
    const session = new FieldSession(talkerBundle(500, 150, { invisible: true }), { start: { x: 490, y: 150 } });
    session.tick();
    const r = session.tick(confirmInput);
    expect(r.talkStarted).toBeNull();
    expect(r.pendingDialogs).toHaveLength(0);
  });

  it('Gleichstand: bei zwei gleich weit entfernten NPCs gewinnt der kleinere Index', () => {
    const asm = new ScriptAssembler();
    asm.label('i0').xyzi(530, 150, 0, 0).ret().ret();
    asm.label('t0').message(0, 0).ret();
    asm.label('i1').xyzi(470, 150, 0, 0).ret().ret();
    asm.label('t1').message(0, 1).ret();
    const { bytes, offsets } = asm.assemble();
    const bundle = buildBundle({
      walkmesh: flatRect(0, 0, 1200, 300),
      script: {
        entities: [
          { name: 'npc0', entryPoints: [offsets['i0']!, offsets['t0']!] },
          { name: 'npc1', entryPoints: [offsets['i1']!, offsets['t1']!] },
        ],
        scriptBytes: bytes,
        strings: [ffText('Null'), ffText('Eins')],
      },
    });
    const session = new FieldSession(bundle, { start: { x: 500, y: 150 } });
    session.tick(); // beide Inits platzieren
    const r = session.tick(confirmInput);
    expect(r.talkStarted).toEqual({ entityIndex: 0 });
    expect(r.pendingDialogs).toHaveLength(1);
    expect(r.pendingDialogs[0]!.dialogId).toBe(0);
  });

  it('Replay-Determinismus: identische Eingaben ⇒ identischer Digest; Snapshot mitten im Talk trägt', () => {
    const bundle = talkerBundle(500, 150);
    const options = { start: { x: 470, y: 150 } };
    const inputs: FieldInput[] = [];
    for (let i = 0; i < 40; i++) {
      inputs.push({ moveX: i < 5 ? 1 : 0, moveY: 0, confirm: i % 6 === 3, cancel: false });
    }

    const a = new FieldSession(bundle, options);
    const b = new FieldSession(bundle, options);
    let sawTalk = false;
    for (const input of inputs) {
      if (a.tick(input).talkStarted) sawTalk = true;
      b.tick(input);
    }
    expect(sawTalk).toBe(true); // der Lauf deckt den Talk-Pfad tatsächlich ab
    expect(a.digest()).toBe(b.digest());

    // Snapshot, während der Talk-Dialog offen ist: der Zusatzkontext liegt im
    // Runtime-Snapshot, die Wiederherstellung muss bitidentisch weiterlaufen.
    const c = new FieldSession(bundle, options);
    c.tick();
    const opened = c.tick(confirmInput);
    expect(opened.talkStarted).toEqual({ entityIndex: 0 });
    const snap = c.snapshot();
    const tail = inputs.slice(0, 12);
    for (const input of tail) c.tick(input);
    const expected = c.digest();

    const d = new FieldSession(bundle);
    expect(d.restore(snap).ok).toBe(true);
    for (const input of tail) d.tick(input);
    expect(d.digest()).toBe(expected);
  });
});

describe('Interpreter', () => {
  it('läuft mit: erwarteter Bankwert ändert sich, Digest weicht von runScript:false ab', () => {
    const asm = new ScriptAssembler();
    asm
      .setByte(3, 0, 1) // Init: Marker
      .ret()
      .inc(3, 1) // Main: zählt je Tick-Iteration
      .ret();
    const { bytes } = asm.assemble();
    const script: ScriptSpec = { entities: [{ name: 'hero', entryPoints: [0] }], scriptBytes: bytes };
    const bundle = buildBundle({ script });

    const withScript = new FieldSession(bundle, { runScript: true });
    expect(withScript.runtime).not.toBeNull();
    // Der Konstruktor reiht die Slot-0-Requests bereits ein (`runtime.start()`).
    // Tick 1 arbeitet den Init-Teil ab, ab Tick 2 zählt der Main-Teil hoch.
    for (let i = 0; i < 5; i++) withScript.tick();
    expect(readBank(withScript.runtime!.state, 3, 1, false)).toBe(4);
    expect(readBank(withScript.runtime!.state, 3, 0, false)).toBe(1); // Init-Marker

    const withoutScript = new FieldSession(bundle, { runScript: false });
    expect(withoutScript.runtime).toBeNull();
    for (let i = 0; i < 5; i++) withoutScript.tick();

    expect(withScript.digest()).not.toBe(withoutScript.digest());
  });
});
