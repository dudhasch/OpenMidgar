import { describe, expect, it } from 'vitest';
import { composeCameraSection } from '@webmidgar/fixture-gen';
import { parseCameraSection, type FieldCamera, type Vec3 } from '@webmidgar/formats-field';
import { ff7ToScene, sceneToFf7 } from './ff7-to-scene.js';
import {
  fovYFromZoom,
  projectFf7PointToScreen,
  reconstructFieldCamera,
  viewDistanceToNdcDepth,
} from './camera-math.js';

/**
 * Kalibrier-Fixture „Achsenkreuz": Überkopfkamera bei C_ff7 = (0, 0, 1000),
 * Blick senkrecht nach unten (−z_ff7), Schirm-x = +x_ff7, Schirm-y(↓) = −y_ff7.
 * R = diag(1, −1, −1) ist eine echte Rotation (det = +1); t = −R·C = (0, 0, 1000).
 */
function overheadCamera(): FieldCamera {
  const section = composeCameraSection([
    { axes: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], position: [0, 0, 1000], zoom: 400 },
  ]);
  const diags: never[] = [];
  const parsed = parseCameraSection(section, 'test', diags)!;
  expect(diags).toHaveLength(0);
  return parsed.cameras[0]!;
}

describe('ff7ToScene (ADR-009)', () => {
  it('bildet die Höhenachse auf +Y ab und erhält die Händigkeit', () => {
    expect(ff7ToScene([1, 2, 3])).toEqual([1, 3, -2]);
    // Händigkeit: e1 × e2 = e3 muss unter M erhalten bleiben.
    const e1 = ff7ToScene([1, 0, 0]);
    const e2 = ff7ToScene([0, 1, 0]);
    const e3 = ff7ToScene([0, 0, 1]);
    const cross: Vec3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    cross.forEach((v, i) => expect(v).toBeCloseTo(e3[i]!, 12)); // −0 ≡ +0

  });

  it('ist exakt invertierbar', () => {
    const v: Vec3 = [12, -34, 56];
    expect(sceneToFf7(ff7ToScene(v))).toEqual(v);
    expect(ff7ToScene(sceneToFf7(v))).toEqual(v);
  });
});

describe('Kamerarekonstruktion', () => {
  it('C = −Rᵀ·t liefert die erwartete Weltposition im Scene-Raum', () => {
    const recon = reconstructFieldCamera(overheadCamera(), { fovBase: 240 });
    // C_ff7 = (0, 0, 1000) → Scene (0, 1000, 0): Kamera hängt 1000 über dem Boden.
    expect(recon.positionScene[0]).toBeCloseTo(0, 6);
    expect(recon.positionScene[1]).toBeCloseTo(1000, 6);
    expect(recon.positionScene[2]).toBeCloseTo(0, 6);
    // Blick senkrecht nach unten: back = +Y_scene (forward = −Y).
    expect(recon.back[1]).toBeCloseTo(1, 6);
    // Basis orthonormal.
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(recon.right, recon.up)).toBeCloseTo(0, 6);
    expect(dot(recon.right, recon.back)).toBeCloseTo(0, 6);
    expect(dot(recon.up, recon.back)).toBeCloseTo(0, 6);
    expect(Math.hypot(...recon.right)).toBeCloseTo(1, 6);
  });

  it('FOV aus Zoom für beide Kalibrierbasen (R2-Dokumentation)', () => {
    // zoom 400: Basis 240 → 2·atan(120/400); Basis 224 → 2·atan(112/400).
    expect(fovYFromZoom(400, 240)).toBeCloseTo(2 * Math.atan(120 / 400), 12);
    expect(fovYFromZoom(400, 224)).toBeCloseTo(2 * Math.atan(112 / 400), 12);
    expect(fovYFromZoom(400, 240)).toBeGreaterThan(fovYFromZoom(400, 224));
  });
});

describe('Referenzprojektion (Originalmodell)', () => {
  it('projiziert bekannte Punkte auf handgerechnete Pixel (320×240, Basis 240)', () => {
    const cam = overheadCamera();
    const opts = { width: 320, height: 240, fovBase: 240 as const };
    // Ursprung: exakt Bildmitte, Sichtdistanz 1000.
    const center = projectFf7PointToScreen([0, 0, 0], cam, opts);
    expect(center.x).toBeCloseTo(160, 6);
    expect(center.y).toBeCloseTo(120, 6);
    expect(center.viewDistance).toBeCloseTo(1000, 6);
    // (100, 0, 0): sx = 100·400/1000 = 40 px rechts der Mitte.
    const right = projectFf7PointToScreen([100, 0, 0], cam, opts);
    expect(right.x).toBeCloseTo(200, 6);
    expect(right.y).toBeCloseTo(120, 6);
    // (0, 100, 0): Schirm-y = −y_ff7 → 40 px ÜBER der Mitte.
    const north = projectFf7PointToScreen([0, 100, 0], cam, opts);
    expect(north.x).toBeCloseTo(160, 6);
    expect(north.y).toBeCloseTo(80, 6);
    // Höhe 200 → näher an der Kamera (Sichtdistanz 800).
    const raised = projectFf7PointToScreen([100, 0, 200], cam, opts);
    expect(raised.viewDistance).toBeCloseTo(800, 6);
    expect(raised.x).toBeCloseTo(160 + (100 * 400) / 800, 6);
    // Punkt hinter der Kamera wird markiert.
    const behind = projectFf7PointToScreen([0, 0, 2000], cam, opts);
    expect(behind.inFront).toBe(false);
  });
});

describe('Tiefenabbildung (Tile-Depth-Kalibrierung)', () => {
  it('bildet near→−1, far→+1 ab und ist streng monoton', () => {
    expect(viewDistanceToNdcDepth(100, 100, 10000)).toBeCloseTo(-1, 9);
    expect(viewDistanceToNdcDepth(10000, 100, 10000)).toBeCloseTo(1, 9);
    let prev = -Infinity;
    for (const d of [100, 200, 500, 800, 1000, 1200, 5000, 10000]) {
      const z = viewDistanceToNdcDepth(d, 100, 10000);
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
  });

  it('Verdeckungsordnung des Kalibrier-Szenarios: Tile 800 < Figur 1000 < Tile 1200', () => {
    const near = 100, far = 10000;
    const front = viewDistanceToNdcDepth(800, near, far);
    const figure = viewDistanceToNdcDepth(1000, near, far);
    const back = viewDistanceToNdcDepth(1200, near, far);
    expect(front).toBeLessThan(figure);
    expect(figure).toBeLessThan(back);
  });
});
