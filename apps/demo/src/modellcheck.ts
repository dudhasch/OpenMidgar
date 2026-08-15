import {
  BackSide,
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Side,
} from 'three';
import { IndexService } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import { decodeModelLightBlock, parseFieldEntry, type FieldModelManifest } from '@webmidgar/formats-field';
import { parseA, parseHrc, parseP, parseRsd, parseTex, type MeshSource, type Skeleton, type TextureSource } from '@webmidgar/formats-model';
import { ff7DirToScene } from '@webmidgar/convert';
import { FieldCompositor } from '@webmidgar/render-field';
import {
  applyFrame,
  bindClip,
  bindPoseFrame,
  buildActor,
  setActorFacing,
  setModelFrontOffset,
  setModelSideOverride,
  type Actor,
  type ActorLighting,
  type BoundClip,
} from '@webmidgar/render-actor';
import { openHttpSource } from './game/http-source.js';

/**
 * Modellcheck — Lage, Seitigkeit und Blickrichtung getrennt prüfbar.
 *
 * Die drei Fragen verdecken einander: Eine gespiegelte Modellmatrix dreht die
 * scheinbare Blickrichtung UND kehrt den Umlaufsinn um, sodass die
 * Rückseitenentfernung die falsche Hälfte behält. Wer dann mit `DoubleSide`
 * oder einem Kursversatz „behebt", lässt beide Symptome optisch verschwinden
 * und die Matrix gespiegelt. Diese Seite trennt die Fragen, statt sie zu
 * verrechnen — und die Schalter sind ausdrücklich Diagnose, keine Vorgabe.
 *
 * Prüfsatz für den Kurs: Feldfiguren haben genau einen Geh- und einen
 * Laufzyklus, kein „geht weg"-Clip. Ein Unterschied zwischen hin und weg kann
 * deshalb NUR ein Kursfehler sein. Bei Kurs 0 muss die Figur nach Walkmesh −Y
 * schauen.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $('status');
const canvas = $<HTMLCanvasElement>('view');
const fieldSel = $<HTMLSelectElement>('field');
const modelSel = $<HTMLSelectElement>('model');
const headingSel = $<HTMLSelectElement>('heading');
const sideSel = $<HTMLSelectElement>('side');
const offsetSel = $<HTMLSelectElement>('offset');
const camSel = $<HTMLSelectElement>('cam');
const sheetImg = $<HTMLImageElement>('sheet');
const jsonEl = $<HTMLTextAreaElement>('json');
const copyBtn = $<HTMLButtonElement>('copy');

const setStatus = (s: string): void => {
  statusEl.textContent = s;
};

const SIDES: Record<string, Side> = { front: FrontSide, back: BackSide, double: DoubleSide };

// --- Szene ------------------------------------------------------------------

const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);
const scene = new Scene();
const actorGroup = new Group();
scene.add(actorGroup);
const camera = new PerspectiveCamera(40, 1, 1, 40000);

/** Achsenkreuz im FF7-Raum, über die zentrale Basis in die Szene gebracht. */
function buildAxes(len: number): Group {
  const g = new Group();
  const achse = (dir: [number, number, number], farbe: number): Line => {
    const a = ff7DirToScene([0, 0, 0]);
    const b = ff7DirToScene([dir[0] * len, dir[1] * len, dir[2] * len]);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute([...a, ...b], 3));
    return new Line(geom, new LineBasicMaterial({ color: farbe }));
  };
  g.add(achse([1, 0, 0], 0xff4040)); // FF7 +X
  g.add(achse([0, -1, 0], 0x40ff60)); // FF7 −Y — Kurs 0
  g.add(achse([0, 0, 1], 0x4090ff)); // FF7 +Z (oben)
  return g;
}
let axes = buildAxes(50);
scene.add(axes);

let center = new Vector3();
let radius = 50;

function placeCamera(): void {
  const d = radius * 2.8 + 20;
  // Kamerapositionen im FF7-Raum, dann über die zentrale Basis in die Szene.
  const nach: Record<string, [number, number, number]> = {
    mY: [0, -1, 0.18],
    pY: [0, 1, 0.18],
    pX: [1, 0, 0.18],
    mX: [-1, 0, 0.18],
    top: [0, -0.01, 1],
  };
  const v = nach[camSel.value] ?? nach['mY']!;
  const s = ff7DirToScene([v[0] * d, v[1] * d, v[2] * d]);
  camera.up.set(0, 1, 0);
  camera.position.set(center.x + s[0], center.y + s[1], center.z + s[2]);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function frameCamera(): void {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  if (actor) box.setFromObject(actor.root);
  if (box.isEmpty()) {
    center = new Vector3();
    radius = 50;
  } else {
    center = box.getCenter(new Vector3());
    radius = Math.max(box.getSize(new Vector3()).length() / 2, 8);
  }
  scene.remove(axes);
  axes = buildAxes(radius * 1.5);
  axes.position.copy(center);
  scene.add(axes);
  placeCamera();
}

// --- Daten ------------------------------------------------------------------

const index = new IndexService();
const fieldByName = new Map<string, LgpEntry>();
const charByName = new Map<string, LgpEntry>();
const resolveChar = (n: string): LgpEntry | undefined => charByName.get(n.toLowerCase());
const readEntry = (e: LgpEntry): Promise<Uint8Array> => index.readEntry(e.canonicalId);

let manifest: FieldModelManifest | null = null;
let skeleton: Skeleton | null = null;
let bundles = new Map<number, { mesh: MeshSource; textures: (TextureSource | null)[] }[]>();
let licht: ActorLighting | null = null;
let actor: Actor | null = null;
let modelFile = '';
let clip: BoundClip | null = null;

function rebuild(): void {
  if (actor) actorGroup.remove(actor.root);
  actor = null;
  if (!skeleton) return;
  setModelSideOverride(SIDES[sideSel.value] ?? FrontSide);
  setModelFrontOffset(Number(offsetSel.value));
  const a = buildActor(skeleton, (b) => bundles.get(b) ?? [], licht ?? undefined);
  actor = a;
  actorGroup.add(a.root);
  // Die Bindpose hat rootRotation 0; zusammen mit ROOT_FRAME_FIX_DEG (−90°)
  // legt sie die Figur flach. Die Laufzeit zeigt IMMER einen echten
  // Animationsrahmen, dessen Wurzelrotation den Versatz aufhebt — genau den
  // nehmen wir hier auch, sonst pruefte die Seite eine Pose, die es im Spiel
  // nicht gibt.
  applyFrame(a, skeleton, clip?.frames[0] ?? bindPoseFrame(skeleton));
  setActorFacing(a, Number(headingSel.value));
  frameCamera();
}

async function loadField(name: string): Promise<void> {
  const e = fieldByName.get(name);
  if (!e) return;
  setStatus(`Lade Field "${name}" …`);
  const parsed = parseFieldEntry(await readEntry(e), name);
  manifest = parsed.ok ? (parsed.bundle?.models ?? null) : null;
  modelSel.innerHTML = (manifest?.models ?? [])
    .map((m, i) => `<option value="${i}">#${i} ${m.modelFile}</option>`)
    .join('');
  if (manifest && manifest.models.length > 0) await loadModel(0);
}

async function loadModel(i: number): Promise<void> {
  const m = manifest?.models[i];
  if (!m) return;
  modelSel.value = String(i);
  modelFile = m.modelFile;
  setStatus(`Lade "${m.modelFile}" …`);
  skeleton = null;
  bundles = new Map();

  const hrcEntry = resolveChar(m.modelFile);
  if (!hrcEntry) {
    setStatus(`hrc "${m.modelFile}" fehlt.`);
    return;
  }
  const sk = parseHrc(await readEntry(hrcEntry), m.modelFile).value;
  if (!sk) {
    setStatus(`hrc "${m.modelFile}" nicht parsbar.`);
    return;
  }
  skeleton = sk;
  for (let b = 0; b < sk.bones.length; b++) {
    const list: { mesh: MeshSource; textures: (TextureSource | null)[] }[] = [];
    for (const ref of sk.bones[b]!.resourceRefs) {
      const rsdEntry = resolveChar(`${ref}.rsd`);
      if (!rsdEntry) continue;
      const rsd = parseRsd(await readEntry(rsdEntry), `${ref}.rsd`).value;
      if (!rsd) continue;
      const pEntry = resolveChar(`${rsd.meshRef}.p`);
      if (!pEntry) continue;
      const mesh = parseP(await readEntry(pEntry), `${rsd.meshRef}.p`).value;
      if (!mesh) continue;
      const textures: (TextureSource | null)[] = [];
      for (const t of rsd.textureRefs) {
        const te = resolveChar(`${t}.tex`);
        textures.push(te ? parseTex(await readEntry(te), `${t}.tex`).value : null);
      }
      list.push({ mesh, textures });
    }
    bundles.set(b, list);
  }
  licht = decodeModelLightBlock(m.blockRaw);

  // Ersten Animationsrahmen holen — s. Kommentar in `rebuild`.
  clip = null;
  const animFile = m.animations[0]?.file;
  if (animFile) {
    const animEntry = resolveChar(animFile);
    if (animEntry) {
      const src = parseA(await readEntry(animEntry), animFile).value;
      if (src) clip = bindClip(sk, src, animFile);
    }
  }

  rebuild();
  setStatus(`${m.modelFile}: ${sk.bones.length} Bones. Kurs ${headingSel.value}°, ${sideSel.value}, Versatz ${offsetSel.value}°.`);
}

// --- Vergleichsblätter ------------------------------------------------------

function shot(): string {
  compositor.render(scene, camera);
  return canvas.toDataURL('image/png');
}

async function blatt(name: string, zellen: { titel: string; anwenden: () => void }[]): Promise<void> {
  const w = 400;
  const sheet = document.createElement('canvas');
  sheet.width = w * zellen.length;
  sheet.height = w + 20;
  const g = sheet.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.fillStyle = '#fff';
  g.font = '13px monospace';
  const merkeSide = sideSel.value;
  const merkeHeading = headingSel.value;
  const merkeOffset = offsetSel.value;
  for (const [i, z] of zellen.entries()) {
    z.anwenden();
    rebuild();
    // BEWUSST kein requestAnimationFrame: Ist das Browserfenster nicht
    // sichtbar, setzt der Browser die Bildtakte aus und der Aufruf käme nie
    // zurück — genau daran hing die erste Fassung. Gezeichnet wird ohnehin
    // synchron, ein Warten auf den Compositor bringt hier nichts.
    await new Promise((r) => setTimeout(r, 0));
    compositor.render(scene, camera);
    g.drawImage(canvas, 0, 0, canvas.width, canvas.height, i * w, 20, w, w);
    g.fillText(z.titel, i * w + 6, 14);
  }
  sideSel.value = merkeSide;
  headingSel.value = merkeHeading;
  offsetSel.value = merkeOffset;
  rebuild();
  const url = sheet.toDataURL('image/png');
  sheetImg.src = url;
  await fetch(`/ff7data/__shot?name=${name}`, { method: 'POST', body: url });
  setStatus(`Blatt "${name}" erzeugt und abgelegt.`);
}

$('sheetHeading').addEventListener('click', () => {
  void blatt('modell-kurs', [0, 90, 180, 270].map((h) => ({
    titel: `Kurs ${h}°`,
    anwenden: () => {
      headingSel.value = String(h);
    },
  })));
});
$('sheetSide').addEventListener('click', () => {
  void blatt('modell-seitigkeit', ['front', 'back', 'double'].map((s) => ({
    titel: s,
    anwenden: () => {
      sideSel.value = s;
    },
  })));
});
$('sheetOffset').addEventListener('click', () => {
  void blatt('modell-versatz', ['-90', '0', '90', '180'].map((o) => ({
    titel: `Versatz ${o}°`,
    anwenden: () => {
      offsetSel.value = o;
    },
  })));
});

// --- Bedienung --------------------------------------------------------------

fieldSel.addEventListener('change', () => void loadField(fieldSel.value));
modelSel.addEventListener('change', () => void loadModel(Number(modelSel.value)));
for (const el of [headingSel, sideSel, offsetSel]) el.addEventListener('change', rebuild);
camSel.addEventListener('change', placeCamera);

// --- Rückmeldung ------------------------------------------------------------

const befunde: unknown[] = [];
function aktuell(): unknown {
  const bewertung: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLSelectElement>('select[data-q]')) {
    if (el.value) bewertung[el.id.replace(/^q_/, '')] = el.value;
  }
  return {
    field: fieldSel.value,
    modell: modelFile,
    einstellungen: {
      kurs: Number(headingSel.value),
      seitigkeit: sideSel.value,
      versatz: Number(offsetSel.value),
      kamera: camSel.value,
    },
    bewertung,
    anmerkung: $<HTMLTextAreaElement>('q_text').value.trim(),
  };
}
$('add').addEventListener('click', () => {
  befunde.push(aktuell());
  $('count').textContent = `${befunde.length} gemerkt`;
  setStatus('Befund gemerkt.');
});
$('gen').addEventListener('click', () => {
  const alle = [...befunde];
  const jetzt = aktuell() as { bewertung: Record<string, string>; anmerkung: string };
  if (Object.keys(jetzt.bewertung).length > 0 || jetzt.anmerkung) alle.push(jetzt);
  jsonEl.value = JSON.stringify({ art: 'webmidgar-modellcheck', version: 1, befunde: alle }, null, 1);
  copyBtn.disabled = alle.length === 0;
});
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(jsonEl.value);
    setStatus('Kopiert.');
  } catch {
    jsonEl.select();
    setStatus('Kopieren blockiert — Text ist markiert, bitte Strg+C.');
  }
});

// --- Start ------------------------------------------------------------------

function loop(): void {
  compositor.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const VORSCHLAEGE = ['md1stin', 'md1_1', 'nrthmk', 'mds7st1'];

void (async () => {
  const source = await openHttpSource();
  if (!source) {
    setStatus('Dev-Datenquelle /ff7data nicht verfügbar.');
    return;
  }
  setStatus('Indexiere …');
  await index.openSource(source, { deep: false });
  for (const e of index.listEntries('flevel')) if (!e.name.includes('.')) fieldByName.set(e.name, e);
  for (const e of index.listEntries('char')) charByName.set(e.name, e);
  const namen = [...fieldByName.keys()].sort((a, b) => a.localeCompare(b));
  const oben = VORSCHLAEGE.filter((n) => fieldByName.has(n));
  fieldSel.innerHTML = [...oben, ...namen.filter((n) => !oben.includes(n))]
    .map((n) => `<option value="${n}">${n}</option>`)
    .join('');
  await loadField(fieldSel.value);
})().catch((err: unknown) => setStatus(`Fehler: ${(err as Error).message}`));

(window as unknown as { modellcheck: unknown }).modellcheck = {
  ladeModell: (f: string, i: number): Promise<void> => loadField(f).then(() => loadModel(i)),
  setze: (o: Partial<{ kurs: number; seitigkeit: string; versatz: number; kamera: string }>): void => {
    if (o.kurs !== undefined) headingSel.value = String(o.kurs);
    if (o.seitigkeit) sideSel.value = o.seitigkeit;
    if (o.versatz !== undefined) offsetSel.value = String(o.versatz);
    if (o.kamera) camSel.value = o.kamera;
    rebuild();
    placeCamera();
  },
  blatt: (name: string): Promise<void> => {
    const btn = name === 'kurs' ? 'sheetHeading' : name === 'seitigkeit' ? 'sheetSide' : 'sheetOffset';
    $(btn).click();
    return new Promise((r) => setTimeout(r, 1500));
  },
  bild: (): string => shot(),
};
