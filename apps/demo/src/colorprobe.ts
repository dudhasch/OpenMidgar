import {
  Group,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { composeHrc, composeP } from '@webmidgar/fixture-gen';
import { parseHrc, parseP } from '@webmidgar/formats-model';
import { buildActor, buildLightSet, type ActorLighting } from '@webmidgar/render-actor';
import { configureOriginalColorPipeline } from '@webmidgar/render-field';

/**
 * Farbprobe des Feldmodell-Pfades — ohne Originaldaten.
 *
 * Gerendert wird ein Fixture-Modell durch **denselben** Pfad wie ein echtes
 * Feldmodell (`parseP` → `buildActor` → Shader), danach werden die Pixel
 * zurückgelesen und gegen die auf der CPU nachgerechnete Erwartung des
 * Originals gehalten. Zu jeder Zelle gehört eine Gegenprobe, die fehlschlagen
 * MUSS, wenn die geprüfte Regel wirkungslos wäre.
 */

const canvas = document.getElementById('view') as HTMLCanvasElement;
const out = document.getElementById('out')!;

const LIGHT: ActorLighting = {
  // Richtung roh (0, 4096, 0) → negiert/skaliert (0, −1, 0) → Feldlichtbasis
  // (x, z, −y) = (0, 0, 1). Trifft die Normale (0,0,1) also voll.
  lights: [
    { color: [128, 128, 128], direction: [0, 4096, 0] },
    { color: [0, 0, 0], direction: [0, 0, 0] },
    { color: [0, 0, 0], direction: [0, 0, 0] },
  ],
  ambient: [32, 32, 32],
};

const ECKFARBEN: [number, number, number][] = [
  [200, 100, 50],
  [40, 220, 90],
  [60, 70, 240],
];

/** Zwei Dreiecke: links GOURAUD (Klasse 1), rechts FLAT (Klasse 0). */
function fixtureMesh(): ReturnType<typeof parseP> {
  return parseP(
    composeP({
      vertices: [
        [-1.5, -1, 0],
        [-0.5, -1, 0],
        [-1.0, 1, 0],
        [0.5, -1, 0],
        [1.5, -1, 0],
        [1.0, 1, 0],
      ],
      normals: [[0, 0, 1]],
      vertexColors: [
        [...ECKFARBEN[0]!, 255],
        [...ECKFARBEN[1]!, 255],
        [...ECKFARBEN[2]!, 255],
        [...ECKFARBEN[0]!, 255],
        [...ECKFARBEN[1]!, 255],
        [...ECKFARBEN[2]!, 255],
      ],
      groups: [
        { vertexStart: 0, vertexCount: 3, materialClass: 1, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] },
        { vertexStart: 3, vertexCount: 3, materialClass: 0, polys: [{ v: [0, 1, 2], n: [0, 0, 0] }] },
      ],
    }),
    'probe.p',
  );
}

/** Die Rechnung des Originals, auf der CPU — die Erwartung dieser Probe. */
function erwartet(farbe: [number, number, number]): [number, number, number] {
  const set = buildLightSet(LIGHT);
  const i = new Vector3(0, 0, 1).applyMatrix3(set.colorDir).add(set.ambient);
  const kanal = (c: number, intensitaet: number, sockel: number): number =>
    Math.round(Math.min(1, (c / 255) * Math.max(intensitaet, sockel)) * 255);
  return [
    kanal(farbe[0], i.x, set.ambient.x),
    kanal(farbe[1], i.y, set.ambient.y),
    kanal(farbe[2], i.z, set.ambient.z),
  ];
}

const zeilen: string[] = [];
let fehler = 0;
const pruefe = (name: string, ist: unknown, soll: unknown, toleranz = 2): void => {
  const a = ist as number[];
  const b = soll as number[];
  const ok = Array.isArray(a) && Array.isArray(b) && a.every((v, k) => Math.abs(v - b[k]!) <= toleranz);
  if (!ok) fehler++;
  zeilen.push(
    `${ok ? '  ok  ' : ' FEHL '} ${name.padEnd(56)} ist=${JSON.stringify(a)} soll=${JSON.stringify(b)}`,
  );
};

function run(): void {
  const mesh = fixtureMesh();
  if (!mesh.value) {
    out.textContent = `Fixture unparsbar: ${mesh.diagnostics.map((d) => d.code).join(', ')}`;
    return;
  }
  zeilen.push(
    `Submeshes: ${JSON.stringify(
      mesh.value.submeshes.map((s) => ({ klasse: s.materialClass, flach: s.flatShaded })),
    )}`,
  );

  const hrc = parseHrc(composeHrc({ skeletonName: 'probe', bones: [{ name: 'b', parent: 'root', length: 0 }] }), 'probe.hrc');

  const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  configureOriginalColorPipeline(renderer);

  const scene = new Scene();
  const wurzel = new Group();
  scene.add(wurzel);
  const actor = buildActor(hrc.value!, (b) => (b === 0 ? [{ mesh: mesh.value!, textures: [] }] : []), LIGHT);
  wurzel.add(actor.root);

  // Kamera auf die Szenenlage der FF7-XY-Ebene ausrichten: Die Basis bildet
  // FF7-z auf Scene-y ab, die Fläche liegt also waagerecht.
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);

  const gl = renderer.getContext();
  const lies = (welt: Vector3): [number, number, number] => {
    const p = welt.clone().project(camera);
    const x = Math.round(((p.x + 1) / 2) * canvas.width);
    const y = Math.round(((p.y + 1) / 2) * canvas.height);
    const buf = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0]!, buf[1]!, buf[2]!];
  };

  // Schwerpunkt beider Dreiecke im FF7-Modellraum, in Weltkoordinaten gebracht.
  const schwerpunkt = (xs: number[]): Vector3 =>
    actor.boneGroups[0]!.localToWorld(new Vector3((xs[0]! + xs[1]! + xs[2]!) / 3, (-1 - 1 + 1) / 3, 0));
  const gouraudMitte = schwerpunkt([-1.5, -0.5, -1.0]);
  const flatMitte = schwerpunkt([0.5, 1.5, 1.0]);
  // Nahe Ecke 0 des FLAT-Dreiecks — dort ist die Farbe ohnehin Ecke 0.
  // Nahe Ecke 1 dagegen trennt FLAT von GOURAUD.
  const flatBeiEcke1 = actor.boneGroups[0]!.localToWorld(new Vector3(1.35, -0.8, 0));
  const gouraudBeiEcke1 = actor.boneGroups[0]!.localToWorld(new Vector3(-0.65, -0.8, 0));

  renderer.render(scene, camera);

  // --- 1. Beleuchtung: der Schwerpunkt der GOURAUD-Fläche ist das Mittel der
  //        drei Eckfarben, jeweils mit der Original-Intensität skaliert.
  const mittelFarbe: [number, number, number] = [0, 1, 2].map(
    (k) => (ECKFARBEN[0]![k]! + ECKFARBEN[1]![k]! + ECKFARBEN[2]![k]!) / 3,
  ) as [number, number, number];
  pruefe('Gouraud-Schwerpunkt = beleuchtetes Mittel der Eckfarben', lies(gouraudMitte), erwartet(mittelFarbe), 3);

  // --- 2. FLAT: jede Stelle der Fläche trägt die Farbe von Ecke 0.
  pruefe('Flat-Schwerpunkt = beleuchtete Farbe von Ecke 0', lies(flatMitte), erwartet(ECKFARBEN[0]!), 3);
  pruefe('Flat nahe Ecke 1 = IMMER NOCH Ecke 0', lies(flatBeiEcke1), erwartet(ECKFARBEN[0]!), 3);

  // --- 3. Gegenprobe: Wäre die FLAT-Regel wirkungslos, stünde an derselben
  //        relativen Stelle der GOURAUD-Fläche fast die Farbe von Ecke 1.
  const gouraudNahEcke1 = lies(gouraudBeiEcke1);
  const flatWert = erwartet(ECKFARBEN[0]!);
  const unterschiedlich = gouraudNahEcke1.some((v, k) => Math.abs(v - flatWert[k]!) > 12);
  if (!unterschiedlich) fehler++;
  zeilen.push(
    `${unterschiedlich ? '  ok  ' : ' FEHL '} ${'Gegenprobe: Gouraud an gleicher Stelle weicht ab'.padEnd(56)} ist=${JSON.stringify(gouraudNahEcke1)} soll≠${JSON.stringify(flatWert)}`,
  );

  // --- 4. Farbpfad: mit sRGB-Ausgabe (three-Vorgabe) MUSS derselbe Pixel
  //        heller herauskommen. Das belegt, dass die Umstellung wirkt.
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.render(scene, camera);
  const mitSrgb = lies(flatMitte);
  const ohneSrgb = flatWert;
  const heller = mitSrgb.every((v, k) => v > ohneSrgb[k]! + 8);
  if (!heller) fehler++;
  zeilen.push(
    `${heller ? '  ok  ' : ' FEHL '} ${'Gegenprobe: three-Vorgabe (sRGB) hellt spürbar auf'.padEnd(56)} ist=${JSON.stringify(mitSrgb)} vs. linear=${JSON.stringify(ohneSrgb)}`,
  );

  renderer.outputColorSpace = (renderer.outputColorSpace = 'srgb-linear' as never);
  renderer.render(scene, camera);

  zeilen.push('');
  zeilen.push(fehler === 0 ? 'ERGEBNIS: alle Proben bestanden' : `ERGEBNIS: ${fehler} Probe(n) fehlgeschlagen`);
  out.textContent = zeilen.join('\n');
  out.className = fehler === 0 ? 'ok' : 'bad';
  (window as unknown as { colorprobe: unknown }).colorprobe = { fehler, zeilen };
}

try {
  run();
} catch (err) {
  out.textContent = `Ausnahme: ${(err as Error).message}\n${(err as Error).stack ?? ''}`;
  out.className = 'bad';
  (window as unknown as { colorprobe: unknown }).colorprobe = { fehler: -1, zeilen: [String(err)] };
}
