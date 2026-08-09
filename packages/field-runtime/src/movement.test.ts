import { describe, expect, it } from 'vitest';
import {
  composeFieldContainer,
  composeScriptSection,
  composeWalkmeshSection,
  ScriptAssembler,
  type ScriptSpec,
  type WalkmeshSpec,
} from '@webmidgar/fixture-gen';
import { parseFieldContainer, type FieldBundle } from '@webmidgar/formats-field';
import { DEFAULT_MOVE_SPEED, readBank } from '@webmidgar/interpreter';
import { FieldSession } from './session.js';

/**
 * Fixture-Testsuite für die Bewegungs- und Entity-Opcodes des Field-
 * Interpreters (S12: CHAR/PC/VISI/DFANM/ANIME1/DIR/XYZI/MOVE). Wie
 * `session.test.ts` läuft jede Fixture ausschließlich über die Composer aus
 * `tools/fixture-gen` und wird mit `parseFieldContainer` geparst — nie Bytes
 * von Hand.
 */

// --- Fixture-Helfer (aus session.test.ts übernommen) --------------------------

/** Flaches Rechteck aus 2 Dreiecken — ausreichend für Bewegung ohne Kanteneinfluss. */
function flatRect(x0: number, y0: number, x1: number, y1: number, z = 0): WalkmeshSpec {
  return {
    triangles: [
      { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z]] },
      { vertices: [[x0, y0, z], [x1, y1, z], [x0, y1, z]] },
    ],
  };
}

interface FixtureSpec {
  fieldId?: string;
  walkmesh?: WalkmeshSpec;
  script?: ScriptSpec;
}

/** Komponiert einen kompletten Field-Container und parst ihn zurück zum `FieldBundle`. */
function buildBundle(spec: FixtureSpec): FieldBundle {
  const sections: Record<number, Uint8Array> = {};
  if (spec.walkmesh) sections[5] = composeWalkmeshSection(spec.walkmesh);
  if (spec.script) sections[1] = composeScriptSection(spec.script);
  const layout = composeFieldContainer({ sections });
  const fieldId = spec.fieldId ?? 'fx-movement';
  const result = parseFieldContainer(layout.bytes, fieldId);
  if (!result.ok || !result.bundle) {
    throw new Error(`Fixture nicht parsebar: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.bundle;
}

/** Einzelentitäts-Skript: ein Slot (Init), ausschließlich `runScript`-Sitzungen. */
function singleEntityScript(build: (asm: ScriptAssembler) => void): ScriptSpec {
  const asm = new ScriptAssembler();
  build(asm);
  const { bytes } = asm.assemble();
  return { entities: [{ name: 'e0', entryPoints: [0] }], scriptBytes: bytes };
}

// --- Tests ----------------------------------------------------------------

describe('CHAR/PC/VISI', () => {
  it('schreiben Modellindex, Partymitglied und Sichtbarkeit in den Actor-Zustand nach einem Takt', () => {
    const script = singleEntityScript((asm) => {
      asm.pc(3).char(7).visi(false).ret();
    });
    const bundle = buildBundle({ script });
    const session = new FieldSession(bundle);

    session.tick();

    const actor = session.runtime!.state.actors[0]!;
    expect(actor.partyMember).toBe(3);
    expect(actor.modelIndex).toBe(7);
    expect(actor.visible).toBe(false);
  });
});

describe('DFANM/ANIME1', () => {
  it('unterscheiden sich ausschließlich in `loop`; ID und Geschwindigkeit werden identisch übernommen', () => {
    const asm = new ScriptAssembler();
    asm
      .label('loopEntity')
      .dfanm(5, 9, true)
      .ret()
      .label('onceEntity')
      .dfanm(5, 9, false) // loop=false ⇒ ANIME1-Opcode (0xa3)
      .ret();
    const { bytes, offsets } = asm.assemble();
    const script: ScriptSpec = {
      entities: [
        { name: 'loopEntity', entryPoints: [offsets.loopEntity!] },
        { name: 'onceEntity', entryPoints: [offsets.onceEntity!] },
      ],
      scriptBytes: bytes,
    };
    const bundle = buildBundle({ script });
    const session = new FieldSession(bundle);

    session.tick();

    const actors = session.runtime!.state.actors;
    expect(actors[0]!.animation).toEqual({ id: 5, speed: 9, loop: true });
    expect(actors[1]!.animation).toEqual({ id: 5, speed: 9, loop: false });
  });
});

describe('XYZI', () => {
  it('setzt Position und Walkmeshdreieck exakt auf die Operanden, innerhalb des bekannten Dreiecks', () => {
    // Dreieck 0 von flatRect: (0,0)-(2000,0)-(2000,2000), also y <= x.
    const script = singleEntityScript((asm) => {
      asm.xyzi(900, 700, 0, 0).ret();
    });
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 2000, 2000), script });
    const session = new FieldSession(bundle);

    session.tick();

    const actor = session.runtime!.state.actors[0]!;
    expect(actor.position).toEqual([900, 700, 0]);
    expect(actor.triangle).toBe(0);
    expect(session.solver!.containsPoint(0, 900, 700, 0.01)).toBe(true);
  });
});

describe('MOVE', () => {
  it('lässt den Kontext warten, nähert sich monoton an und setzt die Variable erst nach Ankunft', () => {
    // Start (200,100) und Ziel (240,100) liegen beide sicher in Dreieck 0
    // (y <= x) und weit von Rand/Diagonale entfernt — reine Gerade in +x.
    const start = { x: 200, y: 100 };
    const target = { x: 240, y: 100 };
    const dist = Math.hypot(target.x - start.x, target.y - start.y);
    const script = singleEntityScript((asm) => {
      asm.xyzi(start.x, start.y, 0, 0).move(target.x, target.y).setByte(3, 0, 1).ret();
    });
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 2000, 2000), script });
    const session = new FieldSession(bundle);

    // Tick 1: Init führt XYZI + MOVE aus, der Kontext geht in `waitState.movement`.
    session.tick();
    const ctx = session.runtime!.state.entities[0]!.context;
    expect(ctx?.waitState.kind).toBe('movement');
    const requestId = ctx!.waitState.kind === 'movement' ? ctx!.waitState.requestId : -1;
    expect(requestId).toBeGreaterThan(0);

    let prevDist = dist;
    let arrivedAtTick = -1;
    const maxTicks = Math.ceil(dist / DEFAULT_MOVE_SPEED) + 5; // ±-Puffer über die Erwartung
    for (let i = 0; i < maxTicks && arrivedAtTick < 0; i++) {
      // (a) solange die Bewegung läuft, bleibt die Variable ungesetzt.
      expect(readBank(session.runtime!.state, 3, 0, false)).toBe(0);

      const result = session.tick();

      const pos = session.runtime!.state.actors[0]!.position!;
      const curDist = Math.hypot(target.x - pos[0], target.y - pos[1]);
      // (b) die Entität nähert sich dem Ziel monoton (nie weiter weg als zuvor).
      expect(curDist).toBeLessThanOrEqual(prevDist + 1e-9);
      prevDist = curDist;

      if (result.arrivals.includes(requestId)) arrivedAtTick = i + 2; // +1 für Init-Tick, +1 für 1-basiert
    }

    expect(arrivedAtTick).toBeGreaterThan(0);
    // (c) nach Ankunft: Variable gesetzt, Ziel exakt erreicht, kein Auftrag mehr offen.
    expect(readBank(session.runtime!.state, 3, 0, false)).toBe(1);
    expect(session.runtime!.state.actors[0]!.moveTarget).toBeNull();
    expect(session.runtime!.state.actors[0]!.position).toEqual([target.x, target.y, 0]);

    // Taktzahl bis zur Ankunft muss zur Distanz/Geschwindigkeit passen (Toleranz ±2).
    const expectedTicks = 1 + Math.ceil(dist / DEFAULT_MOVE_SPEED); // 1 Tick XYZI/MOVE + Bewegungstakte
    expect(Math.abs(arrivedAtTick - expectedTicks)).toBeLessThanOrEqual(2);
  });

  it('bleibt bei einem Ziel außerhalb des Walkmeshs stets im Mesh und bricht spätestens nach dem Stall-Abbruch ab', () => {
    // Ziel weit rechts außerhalb des 1000×1000-Meshs: die Entität läuft gegen
    // die Außenkante und bleibt dort stecken (Solver-Invariante „immer im Mesh").
    const start = { x: 500, y: 400 };
    const target = { x: 5000, y: 400 };
    const script = singleEntityScript((asm) => {
      // Dreieck 0 von flatRect deckt y <= x ab; (500,400) liegt darin.
      asm.xyzi(start.x, start.y, 0, 0).move(target.x, target.y).ret();
    });
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 1000, 1000), script });
    const session = new FieldSession(bundle);

    session.tick(); // Init: XYZI + MOVE, Kontext wartet
    const ctx = session.runtime!.state.entities[0]!.context;
    const requestId = ctx!.waitState.kind === 'movement' ? ctx!.waitState.requestId : -1;
    expect(requestId).toBeGreaterThan(0);

    // Stall-Abbruch bei 30 Takten ohne Fortschritt (Fachregel, session.ts
    // exportiert MOVE_STALL_TICKS nicht — hier bewusst als Konstante gespiegelt,
    // mit großzügigem Puffer für die Anlaufstrecke bis zur Kante).
    const MOVE_STALL_TICKS = 30;
    const maxTicks = Math.ceil((target.x - start.x) / DEFAULT_MOVE_SPEED) + MOVE_STALL_TICKS + 10;
    let arrived = false;
    for (let i = 0; i < maxTicks && !arrived; i++) {
      const result = session.tick();
      const actor = session.runtime!.state.actors[0]!;
      if (actor.position && actor.triangle !== null) {
        expect(
          session.solver!.containsPoint(actor.triangle, actor.position[0], actor.position[1], 0.01),
          `Tick ${i + 2}: (${actor.position[0]},${actor.position[1]}) in Tri ${actor.triangle}`,
        ).toBe(true);
      }
      if (result.arrivals.includes(requestId)) arrived = true;
    }

    expect(arrived, `Bewegungsauftrag nicht innerhalb von ${maxTicks} Takten beendet`).toBe(true);
    expect(session.runtime!.state.actors[0]!.moveTarget).toBeNull();
  });
});

describe('XYZI bricht MOVE ab', () => {
  it('setzt `moveTarget` auf null, wenn ein XYZI mitten in einer laufenden Bewegung eintrifft', () => {
    // Slot 0 (Init, Prio 7 laut PriorityRules.INIT_PRIORITY) setzt Start + MOVE
    // auf ein weit entferntes Ziel und fordert dabei Slot 1 mit höherer Priorität
    // (kleinere Zahl = höher) auf derselben Entität an. Der Request wirkt erst
    // an der nächsten Taktgrenze (Staging), verdrängt Slot 0 dann aber, noch
    // während dessen Bewegung läuft, und Slot 1 setzt die Position hart per XYZI.
    const start = { x: 200, y: 100 };
    const farTarget = { x: 2200, y: 100 }; // weit weg: kein Erreichen binnen weniger Takte
    const asm = new ScriptAssembler();
    asm
      .label('init')
      .xyzi(start.x, start.y, 0, 0)
      .req(0, 1, 1) // Entität 0, Slot 1, Priorität 1 (> Init-Priorität 7)
      .move(farTarget.x, farTarget.y)
      .ret()
      .label('cancel')
      .xyzi(300, 100, 0, 0)
      .ret();
    const { bytes, offsets } = asm.assemble();
    const script: ScriptSpec = {
      entities: [{ name: 'e0', entryPoints: [offsets.init!, offsets.cancel!] }],
      scriptBytes: bytes,
    };
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 4000, 4000), script });
    const session = new FieldSession(bundle);

    session.tick(); // Tick 1: Init (XYZI + REQ + MOVE), Slot-1-Request wird gestaged
    expect(session.runtime!.state.actors[0]!.moveTarget).not.toBeNull();

    session.tick(); // Tick 2: Slot 1 verdrängt Slot 0 und setzt XYZI hart
    expect(session.runtime!.state.actors[0]!.moveTarget).toBeNull();
  });
});

describe('Determinismus', () => {
  it('liefert bei gleicher Eingabefolge auf zwei frischen Sitzungen mit Bewegungsskript identische Digests', () => {
    const script = singleEntityScript((asm) => {
      asm.xyzi(200, 100, 0, 0).move(500, 380).ret();
    });
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 2000, 2000), script });

    const run = (): string => {
      const session = new FieldSession(bundle);
      for (let i = 0; i < 60; i++) session.tick();
      return session.digest();
    };

    expect(run()).toBe(run());
  });

  it('liefert nach Snapshot mitten in der Bewegung und Restore in eine frische Sitzung denselben Digest', () => {
    const script = singleEntityScript((asm) => {
      asm.xyzi(200, 100, 0, 0).move(500, 380).ret();
    });
    const bundle = buildBundle({ walkmesh: flatRect(0, 0, 2000, 2000), script });

    const original = new FieldSession(bundle);
    for (let i = 0; i < 60; i++) original.tick();
    const digestOriginal = original.digest();

    const snapshotSession = new FieldSession(bundle);
    for (let i = 0; i < 20; i++) snapshotSession.tick(); // mitten in der Bewegung
    // Die Bewegung darf zum Snapshot-Zeitpunkt noch nicht abgeschlossen sein —
    // sonst prüft der Test keinen echten Restore-während-MOVE-Fall.
    expect(snapshotSession.runtime!.state.actors[0]!.moveTarget).not.toBeNull();
    const snapshot = snapshotSession.snapshot();

    const restored = new FieldSession(bundle);
    const restoreResult = restored.restore(snapshot);
    expect(restoreResult.ok).toBe(true);
    for (let i = 0; i < 40; i++) restored.tick(); // gleiche Restlaufzeit (20 + 40 = 60)

    expect(restored.digest()).toBe(digestOriginal);
  });
});
