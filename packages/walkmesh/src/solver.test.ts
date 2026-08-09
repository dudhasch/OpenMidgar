import { describe, expect, it } from 'vitest';
import {
  corridorWalkmesh,
  degenerateNeighborWalkmesh,
  gridWalkmesh,
  wedgeWalkmesh,
} from '@webmidgar/fixture-gen';
import { composeTriggersSection } from '@webmidgar/fixture-gen';
import { parseTriggersSection } from '@webmidgar/formats-field';
import { WalkmeshSolver, type WalkState } from './solver.js';
import { detectGatewayCrossings, segmentsIntersect } from './crossing.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invariante nach jedem Tick: Position liegt im aktiven Dreieck (Masterplan 3.3). */
function assertInMesh(solver: WalkmeshSolver, s: WalkState, ctx: string): void {
  expect(solver.containsPoint(s.tri, s.x, s.y, 0.01), `${ctx}: (${s.x},${s.y}) in Tri ${s.tri}`).toBe(true);
}

describe('Akzeptanzfall 1: Ebene Fläche', () => {
  it('geradlinige Bewegung über ≥20 Dreiecke: Ideallinie, konstante Höhe', () => {
    const solver = new WalkmeshSolver(gridWalkmesh(15, 4, 100));
    let state = solver.locate(50, 250)!;
    expect(state).not.toBeNull();
    const startY = state.y;
    let crossings = 0;
    for (let step = 0; step < 40; step++) {
      const result = solver.move(state, 35, 0);
      state = result.state;
      crossings += result.events.filter((e) => e.type === 'crossed').length;
      expect(Math.abs(state.y - startY)).toBeLessThan(1e-9); // Ideallinie
      expect(Math.abs(state.height)).toBeLessThan(1e-9); // eben
      assertInMesh(solver, state, `Schritt ${step}`);
    }
    expect(state.x).toBeCloseTo(50 + 40 * 35, 6);
    expect(crossings).toBeGreaterThanOrEqual(20);
  });

  it('Property-Test: 10.000 randomisierte Schritte, immer im Mesh, 0 Übertrittsfehler', () => {
    const solver = new WalkmeshSolver(gridWalkmesh(10, 10, 100));
    const rnd = mulberry32(0x5eed);
    let state = solver.locate(500, 500)!;
    for (let i = 0; i < 10_000; i++) {
      const angle = rnd() * Math.PI * 2;
      const dist = rnd() * 80;
      state = solver.move(state, Math.cos(angle) * dist, Math.sin(angle) * dist).state;
      if (i % 100 === 0) assertInMesh(solver, state, `Iteration ${i}`);
      expect(Number.isFinite(state.x) && Number.isFinite(state.y)).toBe(true);
    }
    assertInMesh(solver, state, 'final');
  });
});

describe('Akzeptanzfall 2: Steigung', () => {
  // z = x/2 + y/4 — ganzzahlig auf dem 100er-Raster.
  const solver = new WalkmeshSolver(gridWalkmesh(8, 8, 100, { sx: 0.5, sy: 0.25 }));

  it('Höhe an 1000 Zufallspunkten exakt nach Ebenengleichung', () => {
    const rnd = mulberry32(0xabcd);
    for (let i = 0; i < 1000; i++) {
      const x = rnd() * 799;
      const y = rnd() * 799;
      const state = solver.locate(x, y);
      expect(state, `locate(${x},${y})`).not.toBeNull();
      expect(state!.height).toBeCloseTo(x / 2 + y / 4, 6);
    }
  });

  it('Grundriss-Geschwindigkeit bleibt konstant (keine Hangbremse)', () => {
    let state = solver.locate(100, 400)!;
    const result = solver.move(state, 250, 0);
    expect(result.state.x).toBeCloseTo(350, 9); // volle Grundrissstrecke
    expect(result.state.height).toBeCloseTo(350 / 2 + 400 / 4, 6);
  });
});

describe('Akzeptanzfall 3: Kantenübergang', () => {
  it('Übertritt erzeugt keinen Höhen-/Positionssprung', () => {
    const solver = new WalkmeshSolver(gridWalkmesh(8, 8, 100, { sx: 0.5, sy: 0.25 }));
    let state = solver.locate(50, 50)!;
    let prevHeight = state.height;
    let prevX = state.x;
    let prevY = state.y;
    for (let i = 0; i < 60; i++) {
      const result = solver.move(state, 23, 11);
      state = result.state;
      // Kontinuität: Distanz pro Schritt ≤ Sollschritt + eps, Höhe folgt Ebene.
      const stepDist = Math.hypot(state.x - prevX, state.y - prevY);
      expect(stepDist).toBeLessThanOrEqual(Math.hypot(23, 11) + 1e-6);
      expect(state.height).toBeCloseTo(state.x / 2 + state.y / 4, 6);
      expect(Math.abs(state.height - prevHeight)).toBeLessThan(30); // kein Teleport
      prevHeight = state.height;
      prevX = state.x;
      prevY = state.y;
      assertInMesh(solver, state, `Schritt ${i}`);
    }
  });

  it('Sliding an gesperrter Randkante hält die Position im Mesh', () => {
    const solver = new WalkmeshSolver(gridWalkmesh(5, 5, 100));
    let state = solver.locate(250, 450)!;
    // Schräg gegen die obere Wand (y=500): y wird gekappt, x rutscht weiter.
    for (let i = 0; i < 10; i++) {
      const result = solver.move(state, 30, 40);
      state = result.state;
      assertInMesh(solver, state, `Slide ${i}`);
      expect(state.y).toBeLessThanOrEqual(500 + 0.01);
    }
    expect(state.x).toBeGreaterThan(400); // Bewegung entlang der Wand fand statt
    expect(state.y).toBeGreaterThan(499); // an der Wand
  });

  it('Spitzkeil: zwei gesperrte Kanten → Stillstand, nie Durchtunneln', () => {
    const solver = new WalkmeshSolver(wedgeWalkmesh());
    let state = solver.locate(600, 0)!;
    for (let i = 0; i < 50; i++) {
      state = solver.move(state, -60, 0).state; // stur Richtung Keilspitze
      assertInMesh(solver, state, `Keil ${i}`);
      expect(state.x).toBeGreaterThanOrEqual(-0.01); // nie hinter der Spitze
    }
    // Konvergenz in der Sackgasse: deutlich in den Keil vorgedrungen …
    expect(state.x).toBeLessThan(400);
    // … und die Keilwände wurden nie durchstoßen (|y| ≤ Keilbreite an Position x).
    expect(Math.abs(state.y)).toBeLessThanOrEqual(20 * (state.x / 400) + 0.1);
  });

  it('Nadelöhr: schräger Anlauf rutscht durch den Korridor in Raum B', () => {
    const solver = new WalkmeshSolver(corridorWalkmesh());
    let state = solver.locate(150, 150)!;
    let maxCorridorY = -Infinity;
    for (let i = 0; i < 80 && state.x < 700; i++) {
      // Schräger Sollvektor → Wandkontakt im 20er-Korridor ist garantiert.
      state = solver.move(state, 25, state.x > 250 && state.x < 650 ? 8 : 0).state;
      assertInMesh(solver, state, `Korridor ${i}`);
      if (state.x > 300 && state.x < 600) maxCorridorY = Math.max(maxCorridorY, state.y);
    }
    expect(state.x).toBeGreaterThan(650); // in Raum B angekommen
    expect(maxCorridorY).toBeLessThanOrEqual(160.01); // Korridorwand hielt stand
  });

  it('degeneriertes Nachbardreieck wird als gesperrt behandelt', () => {
    const solver = new WalkmeshSolver(degenerateNeighborWalkmesh());
    let state = solver.locate(50, 30)!;
    for (let i = 0; i < 20; i++) {
      state = solver.move(state, 30, 0).state;
      assertInMesh(solver, state, `Degen ${i}`);
      expect(state.x).toBeLessThanOrEqual(100.01); // Kante zur Degeneration sperrt
    }
  });
});

describe('Mehrebenen-locate (Brückenfall)', () => {
  it('wählt bei überlappenden Grundrissen die Ebene nahe zHint', () => {
    // Zwei Ebenen: Boden z=0 und "Brücke" z=500 über demselben Grundriss.
    const ground = gridWalkmesh(2, 2, 100);
    const bridge = gridWalkmesh(2, 2, 100);
    for (const t of bridge.triangles) for (const v of t.vertices) v[2] = 500;
    const merged = {
      schemaVersion: 1 as const,
      triangleCount: ground.triangleCount + bridge.triangleCount,
      triangles: [
        ...ground.triangles,
        ...bridge.triangles.map((t) => ({
          ...t,
          adjacency: t.adjacency.map((n) => (n === null ? null : n + ground.triangleCount)) as [
            number | null, number | null, number | null,
          ],
        })),
      ],
    };
    const solver = new WalkmeshSolver(merged);
    expect(solver.locate(100, 100, 20)!.height).toBe(0);
    expect(solver.locate(100, 100, 480)!.height).toBe(500);
  });
});

describe('Gateway-/Trigger-Querung', () => {
  it('Segment-Schnitt: Grundfälle', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }).hit).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }).hit).toBe(false);
    expect(segmentsIntersect({ x: 0, y: 1 }, { x: 10, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 }).hit).toBe(false);
  });

  it('Gateway feuert exakt einmal pro Querung, mit deterministischer Reihenfolge', () => {
    const section = composeTriggersSection({
      name: 'gwtest',
      gateways: [
        { exitLine: [[100, -50, 0], [100, 50, 0]], destination: [0, 0, 0], destFieldId: 7 },
        { exitLine: [[200, -50, 0], [200, 50, 0]], destination: [0, 0, 0], destFieldId: 8 },
      ],
    });
    const triggers = parseTriggersSection(section, 'gwtest', [])!;
    // Schritt quert BEIDE Linien: Reihenfolge nach t (erst Feld 7, dann 8).
    const both = detectGatewayCrossings({ x: 50, y: 0 }, { x: 250, y: 0 }, triggers);
    expect(both.map((e) => e.gateway.destFieldId)).toEqual([7, 8]);
    // Schritt ohne Querung: nichts feuert (inaktive Slots ebenfalls nicht).
    expect(detectGatewayCrossings({ x: 110, y: 0 }, { x: 190, y: 0 }, triggers)).toHaveLength(0);
    // Hin und zurück: je Querung genau ein Ereignis.
    const back = detectGatewayCrossings({ x: 150, y: 0 }, { x: 50, y: 0 }, triggers);
    expect(back).toHaveLength(1);
    expect(back[0]!.gatewayIndex).toBe(0);
  });
});
