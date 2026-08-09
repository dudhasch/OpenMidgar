import { describe, expect, it } from 'vitest';
import { Vector3, type Mesh, type BufferAttribute } from 'three';
import { composeCameraSection } from '@webmidgar/fixture-gen';
import { parseCameraSection, type FieldCamera, type Vec3 } from '@webmidgar/formats-field';
import {
  ff7ToScene,
  projectFf7PointToScreen,
  viewDistanceToNdcDepth,
} from '@webmidgar/convert';
import { buildFieldCamera } from './field-camera.js';
import { computeLetterbox } from './letterbox.js';
import { buildBackgroundMesh, type BackgroundTileSpec } from './background.js';

function fixtureCamera(axes: [Vec3, Vec3, Vec3], position: Vec3, zoom: number): FieldCamera {
  const section = composeCameraSection([{ axes, position, zoom }]);
  return parseCameraSection(section, 'test', [])!.cameras[0]!;
}

describe('buildFieldCamera ↔ Referenzprojektion (Konsistenzbeweis)', () => {
  it('Three.js-Kamera und Originalmodell projizieren identisch (Überkopf)', () => {
    const cam = fixtureCamera([[1, 0, 0], [0, -1, 0], [0, 0, -1]], [0, 0, 1000], 400);
    const three = buildFieldCamera(cam, { fovBase: 240, near: 100, far: 10000 });
    const points: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [0, 100, 0],
      [-250, 130, 0],
      [100, 0, 200],
      [-80, -60, 50],
    ];
    for (const p of points) {
      const ref = projectFf7PointToScreen(p, cam, { width: 640, height: 480, fovBase: 240 });
      const ndc = new Vector3(...ff7ToScene(p)).project(three);
      const px = ((ndc.x + 1) / 2) * 640;
      const py = ((1 - ndc.y) / 2) * 480;
      expect(px, `x von ${p}`).toBeCloseTo(ref.x, 4);
      expect(py, `y von ${p}`).toBeCloseTo(ref.y, 4);
    }
  });

  it('… auch für eine gedrehte Schrägkamera', () => {
    // Rotation um die ff7-x-Achse: Kamera schaut schräg von oben/hinten.
    const c = Math.cos(Math.PI / 5);
    const s = Math.sin(Math.PI / 5);
    // Zeilen orthonormal, det +1: r1=(1,0,0), r2=(0,−c,−s)? Prüfe: r1×r2 = (0·(−s)−0·(−c), …)
    // Wir verwenden R = Rx-artig mit y-down-Konvention: r2=(0,-c,s), r3=(0,-s,-c).
    const cam = fixtureCamera(
      [[1, 0, 0], [0, -c, s], [0, -s, -c]],
      [0, 200, 1500],
      512,
    );
    const three = buildFieldCamera(cam, { fovBase: 240, near: 50, far: 20000 });
    // Toleranz 0,05 px: die i16-Festkomma-Quantisierung der Achsen (÷4096)
    // macht R minimal nicht-orthonormal; der Referenzpfad nutzt R direkt,
    // der Three.js-Pfad die orthonormale Basis — die Restdifferenz ist
    // formatgegeben und weit unterhalb visueller Relevanz.
    for (const p of [[0, 0, 0], [300, 200, 0], [-150, -100, 120]] as Vec3[]) {
      const ref = projectFf7PointToScreen(p, cam, { width: 320, height: 240, fovBase: 240 });
      if (!ref.inFront) continue;
      const ndc = new Vector3(...ff7ToScene(p)).project(three);
      expect(Math.abs(((ndc.x + 1) / 2) * 320 - ref.x), `x von ${p}`).toBeLessThan(0.05);
      expect(Math.abs(((1 - ndc.y) / 2) * 240 - ref.y), `y von ${p}`).toBeLessThan(0.05);
    }
  });

  it('FOV-Basis 224 verändert die Projektion konsistent in beiden Implementierungen', () => {
    const cam = fixtureCamera([[1, 0, 0], [0, -1, 0], [0, 0, -1]], [0, 0, 1000], 400);
    const three = buildFieldCamera(cam, { fovBase: 224, near: 100, far: 10000 });
    const ref = projectFf7PointToScreen([100, 50, 0], cam, { width: 320, height: 240, fovBase: 224 });
    const ndc = new Vector3(...ff7ToScene([100, 50, 0])).project(three);
    expect(((ndc.x + 1) / 2) * 320).toBeCloseTo(ref.x, 4);
    expect(((1 - ndc.y) / 2) * 240).toBeCloseTo(ref.y, 4);
  });
});

describe('computeLetterbox (ADR-005)', () => {
  it('exakt 4:3 → volle Fläche', () => {
    expect(computeLetterbox(640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
  it('breiter Canvas → Pillarbox, zentriert, Inhalt bleibt 4:3', () => {
    const rect = computeLetterbox(800, 480);
    expect(rect).toEqual({ x: 80, y: 0, width: 640, height: 480 });
    expect(rect.width / rect.height).toBeCloseTo(4 / 3, 6);
  });
  it('hoher Canvas → Letterbox, zentriert', () => {
    const rect = computeLetterbox(640, 600);
    expect(rect).toEqual({ x: 0, y: 60, width: 640, height: 480 });
  });
  it('Resize skaliert nur die Balken: Innenfläche bleibt exakt 4:3', () => {
    for (const [w, h] of [[1920, 1080], [1280, 1024], [375, 812], [1024, 768]]) {
      const rect = computeLetterbox(w!, h!);
      expect(Math.abs(rect.width / rect.height - 4 / 3)).toBeLessThan(0.01);
      expect(rect.x * 2 + rect.width).toBeGreaterThanOrEqual(w! - 1); // zentriert
    }
  });
});

describe('buildBackgroundMesh (Tile-Depth)', () => {
  const tiles: BackgroundTileSpec[] = [
    { x: 0, y: 0, width: 320, height: 240, viewDistance: 5000, color: [0, 0, 1] },
    { x: 60, y: 80, width: 100, height: 80, viewDistance: 800, color: [0, 1, 0] },
  ];

  it('erzeugt Clip-Space-Quads mit korrekt gemappter NDC-Tiefe pro Tile', () => {
    const mesh: Mesh = buildBackgroundMesh(tiles, { near: 100, far: 10000 });
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    expect(pos.count).toBe(8); // 2 Tiles × 4 Ecken
    // Vollbild-Tile: Ecke 0 = (−1, +1) (Design-Pixel (0,0) = oben links).
    expect(pos.getX(0)).toBeCloseTo(-1, 6);
    expect(pos.getY(0)).toBeCloseTo(1, 6);
    expect(pos.getZ(0)).toBeCloseTo(viewDistanceToNdcDepth(5000, 100, 10000), 6);
    // Vordergrund-Tile liegt tiefenmäßig VOR dem Vollbild-Tile.
    expect(pos.getZ(4)).toBeLessThan(pos.getZ(0));
    // Frustum-Culling ist für Clip-Space-Geometrie deaktiviert.
    expect(mesh.frustumCulled).toBe(false);
  });

  it('Tile-Eckpunkte entsprechen dem Design-Raster (y nach unten)', () => {
    const mesh = buildBackgroundMesh(tiles, { near: 100, far: 10000 });
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    // Tile 2: x 60..160 → NDC −0.625..0, y 80..160 → NDC +0.333..−0.333.
    expect(pos.getX(4)).toBeCloseTo(60 / 160 - 1, 6);
    expect(pos.getX(5)).toBeCloseTo(160 / 160 - 1, 6);
    expect(pos.getY(4)).toBeCloseTo(1 - 80 / 120, 6);
    expect(pos.getY(6)).toBeCloseTo(1 - 160 / 120, 6);
  });
});
