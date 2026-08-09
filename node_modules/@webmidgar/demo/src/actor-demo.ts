import { Group, Scene, Vector3, WebGLRenderer } from 'three';
import {
  composeA,
  composeCameraSection,
  composeHrc,
  composeP,
  gridWalkmesh,
  type PSpec,
  type Vec3f,
} from '@webmidgar/fixture-gen';
import { parseA, parseHrc, parseP, type MeshSource } from '@webmidgar/formats-model';
import { parseCameraSection } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { buildFieldCamera, buildWalkmeshDebugObject, FieldCompositor } from '@webmidgar/render-field';
import { WalkmeshSolver, type WalkState } from '@webmidgar/walkmesh';
import { applyFrame, bindClip, buildActor } from '@webmidgar/render-actor';

/**
 * S7-Demo: komplette Modellkette auf Fixture-Basis — hrc/p/a-Writer →
 * Parser → Actor → Gehzyklus, positioniert vom S5-Solver auf einem
 * geneigten Grid-Walkmesh. Ausschließlich selbst erzeugte Daten.
 */

// --- Fixture-Figur über den echten Format-Pfad ------------------------------

/** Quader als .p-Spec: 8 Vertices, 6 Flächennormalen, 12 CCW-Dreiecke. */
function boxSpec(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rgba: [number, number, number, number]): PSpec {
  const v: Vec3f[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // CCW von außen (rechtshändig, Normalen zeigen aus dem Quader heraus).
  const faces: [number, number, number, number][] = [
    [0, 2, 1, 0], [0, 3, 2, 0], // Boden (−z)
    [4, 5, 6, 1], [4, 6, 7, 1], // Deckel (+z)
    [0, 5, 4, 2], [0, 1, 5, 2], // Front (−y)
    [3, 6, 2, 3], [3, 7, 6, 3], // Rückseite (+y)
    [0, 7, 3, 4], [0, 4, 7, 4], // links (−x)
    [1, 2, 6, 5], [1, 6, 5, 5], // rechts (+x)
  ];
  const polys = faces.map(([a, b, c, n]) => ({
    v: [a, b, c] as [number, number, number],
    n: [n, n, n] as [number, number, number],
  }));
  return {
    vertices: v,
    normals: [
      [0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0],
    ],
    vertexColors: v.map(() => rgba),
    groups: [{ vertexStart: 0, vertexCount: 8, polys }],
  };
}

function meshOf(spec: PSpec, name: string): MeshSource {
  const { value } = parseP(composeP(spec), name);
  if (!value) throw new Error(`Fixture-Mesh unparsbar: ${name}`);
  return value;
}

const skeleton = parseHrc(
  composeHrc({
    skeletonName: 'roboter',
    bones: [
      { name: 'pelvis', parent: 'root', length: 0 },
      { name: 'torso', parent: 'pelvis', length: 26 },
      { name: 'head', parent: 'torso', length: 9 },
      { name: 'leg_l', parent: 'pelvis', length: -30 },
      { name: 'leg_r', parent: 'pelvis', length: -30 },
      { name: 'arm_l', parent: 'torso', length: -20 },
      { name: 'arm_r', parent: 'torso', length: -20 },
    ],
  }),
  'roboter.hrc',
).value!;

const boneMeshes: Record<number, MeshSource[]> = {
  1: [meshOf(boxSpec(-10, 10, -6, 6, 0, 26, [70, 110, 220, 255]), 'torso.p')],
  2: [meshOf(boxSpec(-6, 6, -6, 6, 1, 12, [235, 200, 160, 255]), 'head.p')],
  3: [meshOf(boxSpec(-8, -2, -4, 4, -30, 0, [60, 60, 70, 255]), 'legl.p')],
  4: [meshOf(boxSpec(2, 8, -4, 4, -30, 0, [60, 60, 70, 255]), 'legr.p')],
  5: [meshOf(boxSpec(-14, -10, -4, 4, -20, 0, [70, 110, 220, 255]), 'arml.p')],
  6: [meshOf(boxSpec(10, 14, -4, 4, -20, 0, [70, 110, 220, 255]), 'armr.p')],
};

// 16-Frame-Gehzyklus als echtes .a-Fixture (Roundtrip über den Parser).
const WALK_FRAMES = 16;
const walkClip = parseA(
  composeA({
    frames: Array.from({ length: WALK_FRAMES }, (_, f) => {
      const phase = (f / WALK_FRAMES) * Math.PI * 2;
      const swing = Math.sin(phase);
      return {
        rootRotation: [0, 0, 0] as Vec3f,
        rootTranslation: [0, 0, 31 + 1.5 * Math.abs(Math.cos(phase))] as Vec3f,
        boneRotations: [
          [0, 0, 0], // pelvis
          [0, 0, 0], // torso
          [0, 0, 0], // head
          [28 * swing, 0, 0], // leg_l
          [-28 * swing, 0, 0], // leg_r
          [-20 * swing, 0, 0], // arm_l
          [20 * swing, 0, 0], // arm_r
        ] as Vec3f[],
      };
    }),
  }),
  'walk.a',
).value!;
const bound = bindClip(skeleton, walkClip, 'walk.a');

// --- Szene: geneigtes Grid-Walkmesh + Solver --------------------------------

const mesh = gridWalkmesh(6, 6, 100, { sx: 0.12, sy: 0 });
const solver = new WalkmeshSolver(mesh);
let state: WalkState = solver.locate(300, 300)!;
let heading = 0;

const camSection = composeCameraSection([
  {
    axes: [
      [1, 0, 0],
      [0, -0.5335, -0.8458],
      [0, 0.8458, -0.5335],
    ],
    position: [-300, 194, 536],
    zoom: 420,
  },
]);
const fieldCam = parseCameraSection(camSection, 'actordemo', [])!.cameras[0]!;
const camera = buildFieldCamera(fieldCam, { fovBase: 240, near: 50, far: 10000 });

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);

const scene = new Scene();
scene.add(buildWalkmeshDebugObject(solver.debugEdges()));

const actor = buildActor(skeleton, (bone) => (boneMeshes[bone] ?? []).map((m) => ({ mesh: m, textures: [] })));
const walker = new Group(); // Scene-Space: Position vom Solver, Drehung = Blickrichtung
walker.add(actor.root);
scene.add(walker);

// --- Steuerung + Animation ---------------------------------------------------

const keys = new Set<string>();
canvas.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
canvas.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.focus();

const SPEED = 5;
let frameIndex = 0;
let animCounter = 0;

function step(dx: number, dy: number): void {
  state = solver.move(state, dx, dy).state;
  heading = Math.atan2(dx, dy);
}

function setFrame(i: number): void {
  frameIndex = ((i % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
  applyFrame(actor, skeleton, bound.frames[frameIndex]!);
}

function frame(): void {
  let dx = 0;
  let dy = 0;
  if (keys.has('a') || keys.has('arrowleft')) dx -= SPEED;
  if (keys.has('d') || keys.has('arrowright')) dx += SPEED;
  if (keys.has('w') || keys.has('arrowup')) dy += SPEED;
  if (keys.has('s') || keys.has('arrowdown')) dy -= SPEED;
  const moving = dx !== 0 || dy !== 0;
  if (moving) {
    step(dx, dy);
    if (++animCounter % 3 === 0) setFrame(frameIndex + 1);
  } else {
    setFrame(0);
  }

  walker.position.set(...ff7ToScene([state.x, state.y, state.height]));
  walker.rotation.y = heading;
  compositor.render(scene, camera);
  document.getElementById('readout')!.textContent =
    `Tri ${String(state.tri).padStart(2)}  x=${state.x.toFixed(1)}  y=${state.y.toFixed(1)}  z=${state.height.toFixed(1)}  Frame ${frameIndex}`;
  requestAnimationFrame(frame);
}
setFrame(0);
frame();

// Automatisierungshaken für die Browser-Verifikation.
(window as unknown as { actorDebug: unknown }).actorDebug = {
  step,
  setFrame,
  getState: () => ({ ...state, heading, frameIndex }),
  jointWorld: (bone: number): [number, number, number] => {
    scene.updateMatrixWorld(true);
    const p = actor.boneGroups[bone]!.localToWorld(new Vector3(0, 0, skeleton.bones[bone]!.length));
    return [p.x, p.y, p.z];
  },
  inMesh: () => solver.containsPoint(state.tri, state.x, state.y, 0.01),
};
