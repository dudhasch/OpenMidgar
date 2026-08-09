import { parseWalkmeshSection, type Vec3, type Walkmesh } from '@webmidgar/formats-field';
import { composeWalkmeshSection, type WalkmeshSpec } from './field-composer.js';

/**
 * Walkmesh-Fixtures für den S5-Solver (Masterplan 3.3): ebene Fläche,
 * Steigung, adversariale Fälle (Spitzkeil, Nadelöhr, degeneriert).
 * Alle Fixtures laufen durch compose→parse, damit der Parserpfad mitgetestet ist.
 */

export function walkmeshFromSpec(spec: WalkmeshSpec): Walkmesh {
  const mesh = parseWalkmeshSection(composeWalkmeshSection(spec), 'fixture', []);
  if (!mesh) throw new Error('Fixture-Walkmesh unparsebar');
  return mesh;
}

/**
 * Flaches Raster aus nx×ny Zellen der Kantenlänge cell (2 Dreiecke je Zelle);
 * Ränder automatisch gesperrt. Optional lineare Steigung z = sx·x + sy·y
 * (sx/sy so wählen, dass z ganzzahlig bleibt — i16-Serialisierung!).
 */
export function gridWalkmesh(
  nx: number,
  ny: number,
  cell: number,
  slope: { sx: number; sy: number } = { sx: 0, sy: 0 },
): Walkmesh {
  const z = (x: number, y: number): number => Math.round(slope.sx * x + slope.sy * y);
  const triangles: WalkmeshSpec['triangles'] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x0 = gx * cell, x1 = (gx + 1) * cell;
      const y0 = gy * cell, y1 = (gy + 1) * cell;
      triangles.push(
        { vertices: [[x0, y0, z(x0, y0)], [x1, y0, z(x1, y0)], [x1, y1, z(x1, y1)]] },
        { vertices: [[x0, y0, z(x0, y0)], [x1, y1, z(x1, y1)], [x0, y1, z(x0, y1)]] },
      );
    }
  }
  return walkmeshFromSpec({ triangles });
}

/** Spitzkeil: enge Sackgasse mit gesperrten Wänden, Eintritt über die Basis. */
export function wedgeWalkmesh(): Walkmesh {
  return walkmeshFromSpec({
    triangles: [
      // Keilspitze bei (0,0), Basis bei x=400.
      { vertices: [[0, 0, 0], [400, 20, 0], [400, -20, 0]] },
      // Eintrittsdreieck, teilt die Basiskante (400,20)-(400,-20).
      { vertices: [[400, 20, 0], [800, 200, 0], [400, -20, 0]] },
      { vertices: [[800, 200, 0], [800, -200, 0], [400, -20, 0]] },
    ],
  });
}

/**
 * Nadelöhr: zwei Räume, verbunden durch einen 20 Einheiten schmalen Korridor.
 * Raum-Polygone als Fächer, damit die Korridormündung geteilte Kanten hat.
 */
export function corridorWalkmesh(): Walkmesh {
  const fan = (center: Vec3, ring: Vec3[]): WalkmeshSpec['triangles'] =>
    ring.map((p, i) => ({
      vertices: [center, p, ring[(i + 1) % ring.length]!] as [Vec3, Vec3, Vec3],
    }));
  const roomA = fan([150, 150, 0], [
    [0, 0, 0], [300, 0, 0], [300, 140, 0], [300, 160, 0], [300, 300, 0], [0, 300, 0],
  ]);
  const corridor: WalkmeshSpec['triangles'] = [
    { vertices: [[300, 140, 0], [600, 140, 0], [600, 160, 0]] },
    { vertices: [[300, 140, 0], [600, 160, 0], [300, 160, 0]] },
  ];
  const roomB = fan([750, 150, 0], [
    [600, 140, 0], [600, 0, 0], [900, 0, 0], [900, 300, 0], [600, 300, 0], [600, 160, 0],
  ]);
  return walkmeshFromSpec({ triangles: [...roomA, ...corridor, ...roomB] });
}

/** Raster mit eingestreutem degeneriertem Dreieck (Nulllinie). */
export function degenerateNeighborWalkmesh(): Walkmesh {
  return walkmeshFromSpec({
    triangles: [
      { vertices: [[0, 0, 0], [100, 0, 0], [100, 100, 0]] },
      { vertices: [[0, 0, 0], [100, 100, 0], [0, 100, 0]] },
      // Degeneriert: kollineare Punkte, teilt Kante (100,0)-(100,100).
      { vertices: [[100, 0, 0], [100, 50, 0], [100, 100, 0]] },
    ],
  });
}
