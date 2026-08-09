import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, WebGLRenderer } from 'three';
import { composeCameraSection, corridorWalkmesh } from '@webmidgar/fixture-gen';
import { parseCameraSection } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { buildFieldCamera, buildWalkmeshDebugObject, FieldCompositor } from '@webmidgar/render-field';
import { WalkmeshSolver, type MoveEvent, type WalkState } from '@webmidgar/walkmesh';

/** S5-Demo: Solver + Debug-Overlay auf dem Nadelöhr-Fixture (Masterplan 3.3.8). */

const mesh = corridorWalkmesh();
const solver = new WalkmeshSolver(mesh);
let state: WalkState = solver.locate(150, 150)!;
const counters = { crossed: 0, slid: 0, blocked: 0, clamped: 0 };

// Überkopfkamera über der Anlagenmitte (450,150), Höhe 1200: R=diag(1,−1,−1),
// t = −R·C = (−450, 150, 1200).
const camSection = composeCameraSection([
  { axes: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], position: [-450, 150, 1200], zoom: 400 },
]);
const fieldCam = parseCameraSection(camSection, 'walkdemo', [])!.cameras[0]!;
const camera = buildFieldCamera(fieldCam, { fovBase: 240, near: 100, far: 10000 });

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);

const scene = new Scene();
scene.add(buildWalkmeshDebugObject(solver.debugEdges()));
const marker = new Mesh(new BoxGeometry(24, 40, 24), new MeshBasicMaterial({ color: 0xff2222 }));
scene.add(marker);

const keys = new Set<string>();
canvas.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
canvas.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.focus();

const SPEED = 6; // Field-Einheiten pro Frame

function applyEvents(events: MoveEvent[]): void {
  for (const e of events) counters[e.type]++;
}

/** Ein Bewegungs-Tick — auch für die automatisierte Verifikation nutzbar. */
function step(dx: number, dy: number): void {
  const result = solver.move(state, dx, dy);
  state = result.state;
  applyEvents(result.events);
}

function frame(): void {
  let dx = 0;
  let dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx -= SPEED;
  if (keys.has('d') || keys.has('arrowright')) dx += SPEED;
  if (keys.has('w') || keys.has('arrowup')) dy += SPEED;
  if (keys.has('s') || keys.has('arrowdown')) dy -= SPEED;
  if (dx !== 0 || dy !== 0) step(dx, dy);

  marker.position.set(...ff7ToScene([state.x, state.y, state.height + 20]));
  compositor.render(scene, camera);
  document.getElementById('readout')!.textContent =
    `Tri ${String(state.tri).padStart(2)}  x=${state.x.toFixed(1)}  y=${state.y.toFixed(1)}  z=${state.height.toFixed(1)}\n` +
    `crossed=${counters.crossed}  slid=${counters.slid}  blocked=${counters.blocked}  clamped=${counters.clamped}`;
  requestAnimationFrame(frame);
}
frame();

// Automatisierungshaken für Verifikation/Tests im Browser.
(window as unknown as { walkerDebug: unknown }).walkerDebug = {
  step,
  getState: () => ({ ...state }),
  getCounters: () => ({ ...counters }),
  inMesh: () => solver.containsPoint(state.tri, state.x, state.y, 0.01),
};
