import { describe, expect, it } from 'vitest';
import { ff7ToScene } from '@webmidgar/convert';
import {
  composeWorldMap,
  heightfieldMeshSpec,
  type WorldMeshSpec,
} from '@webmidgar/fixture-gen';
import {
  parseWorldMap,
  WORLD_BLOCK_EXTENT,
  WORLD_MESH_EXTENT,
  WORLD_GRIDS,
  type WorldGrid,
} from '@webmidgar/formats-world';
import { buildMeshGeometry } from './geometry.js';
import { sampleGround } from './height.js';
import { WorldStreamer } from './streaming.js';
import { followCameraPose } from './camera.js';
import { blockIndexToCell, meshOrigin, wrapCell } from './layout.js';

/**
 * render-world-Fixtures (S28). Alles läuft über den World-Composer und den
 * Parser — nie Bytes von Hand. Die Grid-Definition der Fixtures ist 2×2
 * (4 Blöcke), Höhen aus einer global stetigen Funktion: damit sind Naht- und
 * Wickelfälle konstruktionsbedingt wohldefiniert.
 */

const GRID: WorldGrid = { cols: 2, rows: 2, primaryBlocks: 4, belegt: true };

/** Höhenfunktion global über die 2×2-Karte; ganzzahlig, i16-sicher. */
const hoehe = (x: number, z: number): number => Math.round(x / 128) - Math.round(z / 256);
const klasse = (x: number, _z: number): number => (x < WORLD_BLOCK_EXTENT ? 3 : 17);

function fixtureTerrain() {
  const bloecke: WorldMeshSpec[][] = [];
  for (let blockRow = 0; blockRow < GRID.rows; blockRow++) {
    for (let blockCol = 0; blockCol < GRID.cols; blockCol++) {
      const meshes: WorldMeshSpec[] = [];
      for (let m = 0; m < 16; m++) {
        const origin = meshOrigin({ col: blockCol, row: blockRow }, m);
        meshes.push(heightfieldMeshSpec(4, WORLD_MESH_EXTENT, hoehe, { origin, walkClassFn: klasse }));
      }
      bloecke.push(meshes);
    }
  }
  const terrain = parseWorldMap(composeWorldMap(bloecke));
  expect(terrain.diagnostics).toEqual([]);
  return terrain;
}

describe('Geometrieaufbau (ADR-009: keine zweite Flip-Stelle)', () => {
  it('jeder Szenenvertex entspricht ff7ToScene([weltX, weltZ, höhe]) — verglichen gegen die Referenzabbildung', () => {
    const terrain = fixtureTerrain();
    const blockIndex = 3; // Zelle (1,1)
    const meshIndex = 5; // Zelle (1,1) im 4×4-Raster
    const mesh = terrain.blocks[blockIndex]!.meshes[meshIndex]!;
    const geo = buildMeshGeometry(mesh, blockIndex, meshIndex, GRID);
    const origin = meshOrigin(blockIndexToCell(blockIndex, GRID), meshIndex);
    for (let i = 0; i < mesh.vertCount; i++) {
      const erwartet = ff7ToScene([
        origin.x + mesh.positions[i * 3]!,
        origin.z + mesh.positions[i * 3 + 2]!,
        mesh.positions[i * 3 + 1]!,
      ]);
      expect([geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]]).toEqual(erwartet);
    }
    expect(geo.indices.length).toBe(mesh.triCount * 3);
    expect([...new Set(geo.walkClasses)]).toEqual([17]);
  });
});

describe('Höhenabfrage', () => {
  it('liefert an Vertexpunkten exakt die Fixture-Höhe und interpoliert dazwischen linear', () => {
    const terrain = fixtureTerrain();
    // Vertexpunkt (Raster 2048): exakt.
    const p1 = sampleGround(terrain, GRID, 4096, 2048);
    expect(p1).not.toBeNull();
    expect(p1!.height).toBe(hoehe(4096, 2048));
    // Zwischenpunkt: die Höhenfunktion ist stückweise linear über den
    // Dreiecken; ein Punkt auf halber Kante trifft den Mittelwert der Enden.
    const p2 = sampleGround(terrain, GRID, 4096 + 1024, 2048);
    expect(p2).not.toBeNull();
    expect(p2!.height).toBeCloseTo((hoehe(4096, 2048) + hoehe(4096 + 2048, 2048)) / 2, 5);
    // Geländeklasse folgt der Fixture-Zuweisung.
    expect(sampleGround(terrain, GRID, 1000, 1000)!.walkClass).toBe(3);
    expect(sampleGround(terrain, GRID, WORLD_BLOCK_EXTENT + 1000, 1000)!.walkClass).toBe(17);
  });

  it('wickelt Koordinaten außerhalb des Primärrasters (die Karte wiederholt sich)', () => {
    const terrain = fixtureTerrain();
    const innen = sampleGround(terrain, GRID, 1000, 1000)!;
    const gewickelt = sampleGround(terrain, GRID, 1000 + GRID.cols * WORLD_BLOCK_EXTENT, 1000)!;
    expect(gewickelt.height).toBe(innen.height);
    expect(gewickelt.blockIndex).toBe(innen.blockIndex);
  });

  it('liefert für quarantinierte Blöcke null — Loch, kein Ratewert', () => {
    const terrain = fixtureTerrain();
    terrain.blocks[0] = null;
    expect(sampleGround(terrain, GRID, 1000, 1000)).toBeNull();
  });
});

describe('Streaming', () => {
  it('hält genau die Nachbarschaft resident und meldet Load/Release als Differenz', () => {
    const grid: WorldGrid = { cols: 9, rows: 7, primaryBlocks: 63, belegt: true };
    const streamer = new WorldStreamer(grid, 1);
    const u1 = streamer.update(4.5 * WORLD_BLOCK_EXTENT, 3.5 * WORLD_BLOCK_EXTENT); // Zelle (4,3)
    expect(u1.load).toHaveLength(9);
    expect(u1.release).toHaveLength(0);
    expect(u1.residentCount).toBe(9);

    // Ein Block nach Osten: 3 neue, 3 alte weg, 6 bleiben.
    const u2 = streamer.update(5.5 * WORLD_BLOCK_EXTENT, 3.5 * WORLD_BLOCK_EXTENT);
    expect(u2.load).toHaveLength(3);
    expect(u2.release).toHaveLength(3);
    expect(u2.residentCount).toBe(9);
    expect(u2.generation).toBe(u1.generation + 1);

    // Stillstand: keine Änderung.
    const u3 = streamer.update(5.5 * WORLD_BLOCK_EXTENT, 3.5 * WORLD_BLOCK_EXTENT);
    expect(u3.load).toHaveLength(0);
    expect(u3.release).toHaveLength(0);
  });

  it('wickelt am Kartenrand: die Nachbarschaft der Zelle (0,0) zieht Daten vom gegenüberliegenden Rand', () => {
    const grid: WorldGrid = { cols: 9, rows: 7, primaryBlocks: 63, belegt: true };
    const streamer = new WorldStreamer(grid, 1);
    const u = streamer.update(0.5 * WORLD_BLOCK_EXTENT, 0.5 * WORLD_BLOCK_EXTENT);
    expect(u.load).toHaveLength(9);
    const westSlot = u.load.find((s) => s.cell.col === -1 && s.cell.row === 0)!;
    expect(westSlot.blockIndex).toBe(8); // Spalte 8 = gegenüberliegender Rand
    const nordwestSlot = u.load.find((s) => s.cell.col === -1 && s.cell.row === -1)!;
    expect(nordwestSlot.blockIndex).toBe(6 * 9 + 8);
  });

  it('clear räumt vollständig und erhöht die Generation', () => {
    const grid: WorldGrid = { cols: 2, rows: 2, primaryBlocks: 4, belegt: true };
    const streamer = new WorldStreamer(grid, 1);
    streamer.update(0, 0);
    const cleared = streamer.clear();
    expect(cleared.release).toHaveLength(9);
    expect(streamer.residentSlots).toHaveLength(0);
  });
});

describe('Verfolgerkamera', () => {
  it('steht hinter dem Ziel entgegen der Fahrtrichtung und blickt aufs Ziel — alles über ff7ToScene', () => {
    const pose = followCameraPose(10000, 20000, 300, 0, { distance: 1000, elevation: 500, lookAhead: 100 });
    // Fahrtrichtung 0° = +x ⇒ Kamera bei x−1000, Höhe h+500.
    expect(pose.position).toEqual(ff7ToScene([9000, 20000, 800]) as [number, number, number]);
    expect(pose.target).toEqual(ff7ToScene([10000, 20000, 400]) as [number, number, number]);
  });

  it('ist eine reine Funktion: gleiche Eingabe, gleiches Ergebnis', () => {
    const a = followCameraPose(1, 2, 3, 45);
    const b = followCameraPose(1, 2, 3, 45);
    expect(a).toEqual(b);
  });
});

describe('wrapCell', () => {
  it('wickelt negative und übergroße Zellen auf das Primärraster', () => {
    const grid: WorldGrid = { cols: 9, rows: 7, primaryBlocks: 63, belegt: true };
    expect(wrapCell({ col: -1, row: -1 }, grid)).toEqual({ col: 8, row: 6 });
    expect(wrapCell({ col: 9, row: 7 }, grid)).toEqual({ col: 0, row: 0 });
    expect(wrapCell({ col: 4, row: 3 }, grid)).toEqual({ col: 4, row: 3 });
  });
});

describe('Alternativblöcke im Streaming (S30)', () => {
  const wm0 = WORLD_GRIDS.wm0;

  it('Fortschrittswechsel macht genau die getauschten Slots ungültig — nicht mehr, nicht weniger', () => {
    const streamer = new WorldStreamer(wm0, 1);
    // Mittelpunkt so wählen, dass Zelle 50 (Spalte 5, Zeile 5) resident ist.
    const x = 5 * WORLD_BLOCK_EXTENT + 1000;
    const z = 5 * WORLD_BLOCK_EXTENT + 1000;
    const erst = streamer.update(x, z);
    expect(erst.load).toHaveLength(9);
    expect(erst.load.map((s) => s.blockIndex)).toContain(50);
    // Ohne Fortschrittswechsel ändert sich nichts.
    expect(streamer.update(x, z).load).toEqual([]);

    streamer.setWorldProgress(1);
    const nach = streamer.update(x, z);
    // Stufe 1 tauscht ausschließlich Zelle 50 → Block 63.
    expect(nach.release.map((s) => s.blockIndex)).toEqual([50]);
    expect(nach.load.map((s) => s.blockIndex)).toEqual([63]);
    // Zurückschalten löst denselben Vorgang rückwärts aus (kein Einweg-Zustand).
    streamer.setWorldProgress(0);
    const zurueck = streamer.update(x, z);
    expect(zurueck.release.map((s) => s.blockIndex)).toEqual([63]);
    expect(zurueck.load.map((s) => s.blockIndex)).toEqual([50]);
  });

  it('Zellen ohne Alternative sind gegen den Fortschritt invariant (Gegenprobe)', () => {
    const streamer = new WorldStreamer(wm0, 1);
    const x = 1 * WORLD_BLOCK_EXTENT + 1000;
    const z = 1 * WORLD_BLOCK_EXTENT + 1000;
    streamer.update(x, z);
    streamer.setWorldProgress(4);
    const nach = streamer.update(x, z);
    expect(nach.load).toEqual([]);
    expect(nach.release).toEqual([]);
  });
});
