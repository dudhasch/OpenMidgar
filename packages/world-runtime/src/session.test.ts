import { describe, expect, it } from 'vitest';
import {
  assembleWorldEv,
  composeWorldMap,
  heightfieldMeshSpec,
  meshFunctionId,
  type WorldMeshSpec,
} from '@webmidgar/fixture-gen';
import { parseWorldEv, parseWorldMap, WORLD_MESH_EXTENT, type WorldGrid } from '@webmidgar/formats-world';
import { meshOrigin } from '@webmidgar/render-world';
import { NEUTRAL_WORLD_INPUT, WorldSession, type WorldSessionOptions, type WorldTickInput } from './session.js';
import { toWorldInput } from './input-adapter.js';

/**
 * WorldSession-Fixtures (S29). Terrain über den World-Composer: 2×2-Blöcke,
 * Westhälfte Klasse 3 („Land"), Osthälfte Klasse 17 („Wasser") — die
 * ANFÜHRUNGSZEICHEN sind Programm: Die Klassensemantik des Originals ist
 * unbelegt, die Matrix ist Testdatum.
 */

const GRID: WorldGrid = { cols: 2, rows: 2, primaryBlocks: 4, belegt: true };
const LAND = 3;
const WASSER = 17;
const BLOCK_EXTENT = WORLD_MESH_EXTENT * 4;

function fixtureTerrain() {
  const bloecke: WorldMeshSpec[][] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const meshes: WorldMeshSpec[] = [];
      for (let m = 0; m < 16; m++) {
        const origin = meshOrigin({ col, row }, m);
        meshes.push(
          heightfieldMeshSpec(4, WORLD_MESH_EXTENT, (x, z) => Math.round(x / 512) - Math.round(z / 1024), {
            origin,
            walkClassFn: (x) => (x < BLOCK_EXTENT ? LAND : WASSER),
          }),
        );
      }
      bloecke.push(meshes);
    }
  }
  const terrain = parseWorldMap(composeWorldMap(bloecke));
  expect(terrain.diagnostics).toEqual([]);
  return terrain;
}

const FUSS = { id: 'fuss', speed: 200, allowedClasses: [LAND] };
const BOOT = { id: 'boot', speed: 300, allowedClasses: [WASSER] };

function session(options: Partial<WorldSessionOptions> = {}): WorldSession {
  return new WorldSession(fixtureTerrain(), GRID, {
    vehicles: [FUSS, BOOT],
    start: { x: 4000, z: 20000 },
    ...options,
  });
}

const VOR: WorldTickInput = { turn: 0, throttle: 1, action: false, switchVehicle: false };

describe('Bewegung und Fahrzeugmatrix', () => {
  it('fährt auf erlaubtem Gelände, folgt der Höhe und blockiert an der Klassengrenze', () => {
    const s = session();
    let blocked = 0;
    for (let i = 0; i < 200; i++) {
      const r = s.tick(VOR); // Kurs 0 = +x, auf die Wassergrenze zu
      if (r.blocked) blocked++;
    }
    // Die Grenze liegt bei x = 32768: zu Fuß endet die Fahrt davor.
    expect(s.x).toBeLessThanOrEqual(BLOCK_EXTENT);
    expect(blocked).toBeGreaterThan(0);
    // Höhe folgt dem Terrain (heightFn an der Endposition, ±1 Rundung der
    // baryzentrischen Interpolation zwischen ganzzahligen Vertexhöhen).
    expect(Math.abs(s.h - (Math.round(s.x / 512) - Math.round(s.z / 1024)))).toBeLessThanOrEqual(1);
  });

  it('Fahrzeugwechsel (Flanke) schaltet die Matrix um: das Boot überquert die Grenze, an der der Fuß stand', () => {
    const s = session();
    for (let i = 0; i < 200; i++) s.tick(VOR); // bis an die Wasserkante
    const vorher = s.x;
    expect(s.tick({ ...VOR, switchVehicle: true }).vehicle).toBe('boot');
    // Die 🔵-Regel prüft ausschließlich die ZIELklasse: Das Boot darf von der
    // Landkante ins Wasser übersetzen (genau das ist der Ein-/Ausstieg) und
    // fährt dann weiter — der Fuß stand hier fest.
    for (let i = 0; i < 5; i++) expect(s.tick(VOR).moved).toBe(true);
    expect(s.x).toBeGreaterThan(vorher + 4 * BOOT.speed);
    // Zurück auf den Fuß mitten im Wasser: sofort wieder blockiert.
    s.tick({ ...NEUTRAL_WORLD_INPUT, switchVehicle: true });
    expect(s.vehicle.id).toBe('fuss');
    expect(s.tick(VOR).blocked).toBe(true);
  });

  it('KONTROLLE „verdrehte Matrix": vertauschte Klassen ändern die Erreichbarkeit messbar', () => {
    const fahre = (vehicles: typeof FUSS[]): number => {
      const s = new WorldSession(fixtureTerrain(), GRID, { vehicles, start: { x: 4000, z: 20000 } });
      for (let i = 0; i < 200; i++) s.tick(VOR);
      return s.x;
    };
    const normal = fahre([{ ...FUSS }]);
    const verdreht = fahre([{ ...FUSS, allowedClasses: [WASSER] }]);
    // Wäre die Erreichbarkeit gegen die Matrix invariant, wäre die ganze
    // Messanlage wertlos (Roadmap-Abnahme) — sie ist es nicht:
    expect(normal).toBeGreaterThan(30000);
    expect(verdreht).toBe(4000); // startet auf Land, darf nur Wasser: steht
  });
});

describe('Determinismus (ADR-006)', () => {
  /** Aufgezeichnete Fahrt: drehen, fahren, wechseln — Eingabe bis zum letzten Takt. */
  function fahrplan(t: number, shift = 0): WorldTickInput {
    const k = t - shift;
    if (k < 1) return NEUTRAL_WORLD_INPUT;
    if (k <= 30) return { turn: 1, throttle: 1, action: false, switchVehicle: false };
    if (k === 31) return { ...NEUTRAL_WORLD_INPUT, switchVehicle: true };
    if (k <= 120) return { turn: k % 7 === 0 ? -1 : 0, throttle: 1, action: false, switchVehicle: false };
    if (k === 121) return { ...NEUTRAL_WORLD_INPUT, switchVehicle: true };
    return { turn: 0, throttle: 1, action: false, switchVehicle: false };
  }

  it('240 Takte Fahrt sind über zwei Läufe bitidentisch; ein verschobener Strom ändert den Digest', () => {
    const lauf = (shift: number): string => {
      const s = session({ seed: 7 });
      for (let t = 1; t <= 240; t++) s.tick(fahrplan(t, shift));
      return s.digest();
    };
    const a = lauf(0);
    expect(lauf(0)).toBe(a);
    expect(lauf(1)).not.toBe(a); // Gegenprobe gegen den blinden Digest
  });

  it('Snapshot/Restore mitten in der Fahrt ist verlustfrei (Digest-Gleichheit am Ende)', () => {
    const voll = session({ seed: 7 });
    for (let t = 1; t <= 240; t++) voll.tick(fahrplan(t));

    const erste = session({ seed: 7 });
    for (let t = 1; t <= 100; t++) erste.tick(fahrplan(t));
    const mitte = erste.snapshot();

    const zweite = session({ seed: 7 });
    expect(zweite.restore(mitte).ok).toBe(true);
    for (let t = 101; t <= 240; t++) zweite.tick(fahrplan(t));
    expect(zweite.digest()).toBe(voll.digest());
  });
});

describe('Mesh-Trigger über die Script-VM', () => {
  it('beim Zellenwechsel läuft Funktion 0 der Zelle und ihr Speichereffekt wandert in den Digest', () => {
    // Start in Zelle (0, 2) — Fahrt nach +x betritt Zelle (1, 2).
    const ev = parseWorldEv(
      assembleWorldEv([
        {
          id: meshFunctionId(1, 2, 0),
          code: [
            { op: 'PushConst', value: 77 },
            { op: 'PushConst', value: 1 },
            { op: 'Write' },
            { op: 'Return' },
          ],
        },
      ]),
    );
    const mit = session({ ev, start: { x: 8000, z: 20000 } });
    const ohne = session({ start: { x: 8000, z: 20000 } });
    let gelaufen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = mit.tick(VOR);
      ohne.tick(VOR);
      gelaufen.push(...r.ranFunctions);
    }
    expect(gelaufen).toEqual([meshFunctionId(1, 2, 0)]);
    expect(mit.vm!.savemap.get(77)).toBe(1);
    expect(mit.digest()).not.toBe(ohne.digest()); // Speicher ist Zustand
  });
});

describe('Übergänge und Begegnungen', () => {
  it('Aktion innerhalb einer Ortsmarke erzeugt den world-transition-Request (Daten, keine Wirkung)', () => {
    const s = session({
      locations: [{ x: 4000, z: 20000, radius: 500, destMaplistIndex: 116 }],
    });
    const treffer = s.tick({ ...NEUTRAL_WORLD_INPUT, action: true });
    expect(treffer.requests).toEqual([
      { kind: 'world-transition', locationIndex: 0, destMaplistIndex: 116 },
    ]);
    // Halten erzeugt keinen zweiten Request (Flanke, nicht Zustand).
    expect(s.tick({ ...NEUTRAL_WORLD_INPUT, action: true }).requests).toEqual([]);
  });

  it('Begegnungsprüfung: seed-deterministisch, Teil des Snapshots, standardmäßig AUS (ADR-011)', () => {
    const fahre = (seed: number, enabled = true): number[] => {
      const s = session({
        seed,
        encounters: { enabled, classes: [LAND], stepsPerCheck: 8, threshold: 128 },
      });
      const ticks: number[] = [];
      for (let t = 1; t <= 150; t++) {
        const r = s.tick(VOR);
        if (r.requests.some((q) => q.kind === 'encounter-check')) ticks.push(t);
      }
      return ticks;
    };
    const a = fahre(42);
    expect(a.length).toBeGreaterThan(0);
    expect(fahre(42)).toEqual(a); // gleicher Seed ⇒ gleiche Takte
    expect(fahre(43)).not.toEqual(a); // anderer Seed ⇒ nachweisbar anders
    expect(fahre(42, false)).toEqual([]); // Standard: Stub-Politik
  });
});

describe('S27-Adapter', () => {
  it('bildet den Aktionsrahmen auf Welt-Eingabe ab (Achse X dreht, Achse Y fährt)', () => {
    expect(toWorldInput({ held: ['right', 'up'], axisX: 8, axisY: 8 })).toEqual({
      turn: 1,
      throttle: 1,
      action: false,
      switchVehicle: false,
    });
    expect(toWorldInput({ held: ['ok', 'switch'], axisX: 0, axisY: 0 })).toEqual({
      turn: 0,
      throttle: 0,
      action: true,
      switchVehicle: true,
    });
  });
});
