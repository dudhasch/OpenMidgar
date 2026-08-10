import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  parseWorldMap,
  WORLD_GRIDS,
  type WorldTerrain,
} from '@webmidgar/formats-world';
import {
  buildMeshGeometry,
  followCameraPose,
  sampleGround,
  WorldStreamer,
} from '@webmidgar/render-world';
import {
  defaultBindings,
  InputSampler,
  KeyboardFeed,
  toFieldInput,
} from '@webmidgar/input';

/**
 * S28-Demo: WM0-Terrain mit blockweisem Streaming und Verfolgerkamera.
 * Spiellogik-Anteile (Position, Höhenabfrage, Streamer) sind Node-testbare
 * Pakete; diese Seite ist nur Schale: Eingabe sammeln, am Takt abtasten,
 * Streaming-Aufträge in Three-Objekte umsetzen.
 */

const TICK_HZ = 30;
const TICK_DT_MS = 1000 / TICK_HZ;
const SPEED = 220; // Welteinheiten je Takt (🔵 Demo-Wert, kein Formatfakt)
const DREH_GRAD = 3; // Grad je Takt

const canvas = document.getElementById('view') as HTMLCanvasElement;
const statusEl = document.getElementById('status')!;
const readoutEl = document.getElementById('readout')!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
const scene = new Scene();
scene.add(new DirectionalLight(0xffffff, 2.2).translateY(1).translateX(0.4));
const camera = new PerspectiveCamera(55, canvas.width / canvas.height, 100, 400000);

const GRID = WORLD_GRIDS.wm0;
let terrain: WorldTerrain | null = null;
const streamer = new WorldStreamer(GRID, 1);
const residentObjekte = new Map<string, Group>();

// Diagnosefarben je Geländeklasse (5 Bit → 32 Werte), stabil aus dem Index.
const KLASSENFARBEN = Array.from({ length: 32 }, (_, i) => new Color().setHSL((i * 0.618034) % 1, 0.55, 0.45));

const spieler = { x: 4.5 * 32768, z: 3.5 * 32768, h: 0, heading: 0 };

// --- Eingabe (S27): Tastatur-Feed, Abtastung am Takt -------------------------
const bindings = defaultBindings();
// Q/E drehen — Demo-lokale Zusatzbelegung im Feld-Kontext (Belegung ist Daten).
bindings.field!.keyboard['KeyQ'] = 'pageUp';
bindings.field!.keyboard['KeyE'] = 'pageDown';
const keyboard = new KeyboardFeed();
const sampler = new InputSampler(bindings, [keyboard]);
window.addEventListener('keydown', (e) => {
  if (bindings.field!.keyboard[e.code]) {
    e.preventDefault();
    keyboard.handleKey(e.code, true);
  }
});
window.addEventListener('keyup', (e) => keyboard.handleKey(e.code, false));
window.addEventListener('blur', () => keyboard.clear());

// --- Laden -------------------------------------------------------------------
(document.getElementById('mapfile') as HTMLInputElement).addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  terrain = parseWorldMap(bytes);
  const quarantiniert = terrain.diagnostics.length;
  statusEl.textContent = `${terrain.blocks.length} Blöcke geparst, ${quarantiniert} Diagnosen`;
  for (const g of residentObjekte.values()) scene.remove(g);
  residentObjekte.clear();
  streamer.clear();
  const start = sampleGround(terrain, GRID, spieler.x, spieler.z);
  spieler.h = start?.height ?? 0;
});

function baueBlockGruppe(blockIndex: number, cell: { col: number; row: number }): Group {
  const gruppe = new Group();
  const block = terrain!.blocks[blockIndex];
  if (!block) return gruppe;
  block.meshes.forEach((mesh, meshIndex) => {
    if (!mesh) return;
    const geo = buildMeshGeometry(mesh, blockIndex, meshIndex, GRID, cell);
    // Vertexfarben je Dreieck: Geometrie in unindizierte Form entfalten,
    // damit jede Fläche ihre Klassenfarbe flach trägt.
    const positions = new Float32Array(geo.triCount * 9);
    const farben = new Float32Array(geo.triCount * 9);
    for (let t = 0; t < geo.triCount; t++) {
      const farbe = KLASSENFARBEN[geo.walkClasses[t]!]!;
      for (let k = 0; k < 3; k++) {
        const v = geo.indices[t * 3 + k]!;
        positions.set(geo.positions.subarray(v * 3, v * 3 + 3), t * 9 + k * 3);
        farben[t * 9 + k * 3] = farbe.r;
        farben[t * 9 + k * 3 + 1] = farbe.g;
        farben[t * 9 + k * 3 + 2] = farbe.b;
      }
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(positions, 3));
    bg.setAttribute('color', new BufferAttribute(farben, 3));
    bg.computeVertexNormals();
    gruppe.add(new Mesh(bg, new MeshLambertMaterial({ vertexColors: true })));
  });
  return gruppe;
}

// --- Takt --------------------------------------------------------------------
let tickZaehler = 0;
function tick(): void {
  tickZaehler++;
  const frame = sampler.sampleTick();
  const input = toFieldInput(frame);
  if (frame.held.includes('pageUp')) spieler.heading = (spieler.heading + DREH_GRAD) % 360;
  if (frame.held.includes('pageDown')) spieler.heading = (spieler.heading - DREH_GRAD + 360) % 360;
  if (terrain && (input.moveX !== 0 || input.moveY !== 0)) {
    const rad = (spieler.heading * Math.PI) / 180;
    const vor = input.moveY;
    const seit = input.moveX;
    spieler.x += (Math.cos(rad) * vor - Math.sin(rad) * seit) * SPEED;
    spieler.z += (Math.sin(rad) * vor + Math.cos(rad) * seit) * SPEED;
    const boden = sampleGround(terrain, GRID, spieler.x, spieler.z);
    if (boden) spieler.h = boden.height;
  }
  if (terrain) {
    const update = streamer.update(spieler.x, spieler.z);
    for (const slot of update.release) {
      const g = residentObjekte.get(slot.key);
      if (g) {
        scene.remove(g);
        g.traverse((o) => {
          if (o instanceof Mesh) {
            o.geometry.dispose();
            (o.material as MeshLambertMaterial).dispose();
          }
        });
        residentObjekte.delete(slot.key);
      }
    }
    for (const slot of update.load) {
      const g = baueBlockGruppe(slot.blockIndex, slot.cell);
      residentObjekte.set(slot.key, g);
      scene.add(g);
    }
  }
}

let accumulator = 0;
let last = performance.now();
function frame(now: number): void {
  accumulator = Math.min(accumulator + (now - last), 250);
  last = now;
  while (accumulator >= TICK_DT_MS) {
    tick();
    accumulator -= TICK_DT_MS;
  }
  const pose = followCameraPose(spieler.x, spieler.z, spieler.h, spieler.heading);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  renderer.render(scene, camera);
  const boden = terrain ? sampleGround(terrain, GRID, spieler.x, spieler.z) : null;
  readoutEl.textContent =
    `Takt ${tickZaehler}  x=${spieler.x.toFixed(0)}  z=${spieler.z.toFixed(0)}  h=${spieler.h.toFixed(0)}  Kurs ${spieler.heading}°\n` +
    `Block ${boden?.blockIndex ?? '—'}  Mesh ${boden?.meshIndex ?? '—'}  Klasse ${boden?.walkClass ?? '—'}\n` +
    `resident: ${residentObjekte.size} Blockgruppen`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Automatisierungshaken (Konvention aller Demoseiten).
(window as unknown as { worldDebug: unknown }).worldDebug = {
  /** Treibt die Taktlogik ohne rAF — für Verifikation in nicht komponierenden Tabs. */
  stepTicks: (n: number) => {
    for (let i = 0; i < n; i++) tick();
  },
  sample: (x: number, z: number) => (terrain ? sampleGround(terrain, GRID, x, z) : null),
  getPlayer: () => ({ ...spieler }),
  setPlayer: (x: number, z: number) => {
    spieler.x = x;
    spieler.z = z;
  },
  residentCount: () => residentObjekte.size,
  terrainLoaded: () => terrain !== null,
  diagnostics: () => terrain?.diagnostics ?? null,
  loadBytes: (bytes: Uint8Array) => {
    terrain = parseWorldMap(bytes);
    statusEl.textContent = `${terrain.blocks.length} Blöcke geparst (Debug-Pfad)`;
  },
};
