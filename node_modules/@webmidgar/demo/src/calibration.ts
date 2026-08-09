import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import { composeCameraSection } from '@webmidgar/fixture-gen';
import { parseCameraSection, type Vec3 } from '@webmidgar/formats-field';
import { ff7ToScene, type FovBase } from '@webmidgar/convert';
import {
  buildBackgroundMesh,
  buildFieldCamera,
  FieldCompositor,
  type BackgroundTileSpec,
} from '@webmidgar/render-field';

/**
 * S4-Kalibrierszene (Masterplan 3.1/3.2): deterministischer Render der
 * Achsenkreuz-Referenz mit automatischen Checks für Verdeckung,
 * Resize-Invarianz und Golden-Screenshot-Diff.
 */

const NEAR = 100;
const FAR = 10000;

// Überkopf-Fixture-Kamera: R = diag(1,−1,−1), C_ff7 = (0,0,1000), zoom 400.
function makeCamera(fovBase: FovBase) {
  const section = composeCameraSection([
    { axes: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], position: [0, 0, 1000], zoom: 400 },
  ]);
  const cam = parseCameraSection(section, 'calibration', [])!.cameras[0]!;
  return buildFieldCamera(cam, { fovBase, near: NEAR, far: FAR });
}

// Tiles in Design-Pixeln (320×240): Verdeckungs-Dreiklang um die Figur (850).
const TILES: BackgroundTileSpec[] = [
  { x: 0, y: 0, width: 320, height: 240, viewDistance: 5000, color: [0.155, 0.155, 1] },
  { x: 100, y: 60, width: 65, height: 130, viewDistance: 800, color: [0, 0.863, 0] },
  { x: 155, y: 110, width: 75, height: 70, viewDistance: 950, color: [1, 0.549, 0] },
];

function makeScene(): Scene {
  const scene = new Scene();
  scene.add(buildBackgroundMesh(TILES, { near: NEAR, far: FAR }));

  // Fixture-Walkmesh als Wireframe (Grundriss ±300, ff7 z = 0).
  const grid: number[] = [];
  for (let i = -300; i <= 300; i += 100) {
    for (const [a, b] of [
      [[i, -300, 0], [i, 300, 0]],
      [[-300, i, 0], [300, i, 0]],
    ] as [Vec3, Vec3][]) {
      grid.push(...ff7ToScene(a), ...ff7ToScene(b));
    }
  }
  const gridGeom = new BufferGeometry();
  gridGeom.setAttribute('position', new Float32BufferAttribute(grid, 3));
  scene.add(new LineSegments(gridGeom, new LineBasicMaterial({ color: 0xc8c8c8 })));

  // Platzhalterfigur: rote Box 60×60 Grundriss, 150 hoch, auf dem Walkmesh.
  const box = new Mesh(
    new BoxGeometry(60, 150, 60),
    new MeshBasicMaterial({ color: 0xff1e1e }),
  );
  box.position.set(...ff7ToScene([0, 0, 75]));
  scene.add(box);
  return scene;
}

// --- Rendering --------------------------------------------------------------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);
const scene = makeScene();

function currentFovBase(): FovBase {
  return Number((document.getElementById('fovBase') as HTMLSelectElement).value) as FovBase;
}

function renderAt(width: number, height: number): void {
  renderer.setSize(width, height, false);
  compositor.render(scene, makeCamera(currentFovBase()));
}

/** Extrahiert die innere 4:3-Komposition als 640×480-ImageData. */
function extractComposition(): ImageData {
  const rect = compositor.viewportRect;
  const out = document.createElement('canvas');
  out.width = 640;
  out.height = 480;
  const ctx = out.getContext('2d')!;
  const topY = canvas.height - (rect.y + rect.height); // GL-Ursprung unten links
  ctx.drawImage(canvas, rect.x, topY, rect.width, rect.height, 0, 0, 640, 480);
  return ctx.getImageData(0, 0, 640, 480);
}

function fnv1a(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// --- Checks -----------------------------------------------------------------

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const PROBES: { name: string; x: number; y: number; expect: [number, number, number] }[] = [
  { name: 'Hintergrund-Tile (blau) sichtbar', x: 600, y: 40, expect: [40, 40, 255] },
  { name: 'Figur HINTER Vordergrund-Tile (grün verdeckt rot)', x: 310, y: 240, expect: [0, 220, 0] },
  { name: 'Figur VOR Tile 950 (rot verdeckt orange)', x: 340, y: 250, expect: [255, 30, 30] },
  { name: 'Tile 950 über Bodenebene (orange sichtbar)', x: 420, y: 300, expect: [255, 140, 0] },
  { name: 'Vordergrund-Tile über Boden (grün sichtbar)', x: 220, y: 160, expect: [0, 220, 0] },
];

function runOcclusionChecks(img: ImageData): CheckResult[] {
  return PROBES.map((p) => {
    const o = (p.y * 640 + p.x) * 4;
    const got: [number, number, number] = [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
    const pass = got.every((v, i) => Math.abs(v - p.expect[i]!) <= 24);
    return {
      name: p.name,
      pass,
      detail: `Pixel(${p.x},${p.y}) = rgb(${got.join(',')}), erwartet ≈ rgb(${p.expect.join(',')})`,
    };
  });
}

function runResizeCheck(): CheckResult {
  const hashes: string[] = [];
  for (const [w, h] of [[640, 480], [800, 480], [640, 600]] as const) {
    renderAt(w, h);
    hashes.push(fnv1a(extractComposition().data));
  }
  renderAt(640, 480);
  const pass = hashes.every((x) => x === hashes[0]);
  return {
    name: 'Resize-Invarianz: Komposition identisch bei 4:3/Pillarbox/Letterbox',
    pass,
    detail: `Hashes: ${hashes.join(' | ')}`,
  };
}

async function runGoldenCheck(img: ImageData): Promise<CheckResult> {
  try {
    const resp = await fetch('/golden/axis-cross.png');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const golden = ctx.getImageData(0, 0, 640, 480);
    let diff = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (
        Math.abs(img.data[i]! - golden.data[i]!) > 8 ||
        Math.abs(img.data[i + 1]! - golden.data[i + 1]!) > 8 ||
        Math.abs(img.data[i + 2]! - golden.data[i + 2]!) > 8
      ) {
        diff++;
      }
    }
    const ratio = diff / (640 * 480);
    return {
      name: 'Golden-Screenshot-Diff (Basis 240)',
      pass: ratio < 0.005,
      detail: `${(ratio * 100).toFixed(3)} % abweichende Pixel (Schwelle 0,5 %)`,
    };
  } catch (err) {
    return {
      name: 'Golden-Screenshot-Diff',
      pass: false,
      detail: `Kein Golden geladen (${(err as Error).message}) — mit fensterExportGolden() erzeugen`,
    };
  }
}

function report(results: CheckResult[]): void {
  document.getElementById('checks')!.innerHTML = results
    .map(
      (r) =>
        `<li><span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span> ${r.name} — ${r.detail}</li>`,
    )
    .join('');
}

async function runAllChecks(): Promise<void> {
  renderAt(canvas.width, canvas.height);
  const results: CheckResult[] = [];
  renderAt(640, 480);
  const img = extractComposition();
  results.push(...runOcclusionChecks(img));
  results.push(runResizeCheck());
  results.push(await runGoldenCheck(extractComposition()));
  report(results);
}

// Golden-Export für die Repo-Ablage (aus der Konsole aufrufbar).
(window as unknown as { fensterExportGolden: () => string }).fensterExportGolden = () => {
  renderAt(640, 480);
  const img = extractComposition();
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
};

document.querySelectorAll<HTMLButtonElement>('button[data-size]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const [w, h] = btn.dataset['size']!.split('x').map(Number);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    renderAt(w!, h!);
  }),
);
document.getElementById('fovBase')!.addEventListener('change', () => renderAt(canvas.width, canvas.height));
document.getElementById('runChecks')!.addEventListener('click', () => void runAllChecks());

renderAt(640, 480);
