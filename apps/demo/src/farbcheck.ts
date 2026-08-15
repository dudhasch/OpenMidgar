import { Box3, Group, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, LinearSRGBColorSpace } from 'three';
import { IndexService } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import {
  decodeModelLightBlock,
  parseFieldEntry,
  type FieldModelEntry,
  type FieldModelManifest,
} from '@webmidgar/formats-field';
import {
  parseA,
  parseHrc,
  parseP,
  parseRsd,
  parseTex,
  type MeshSource,
  type Skeleton,
  type TextureSource,
} from '@webmidgar/formats-model';
import { FieldCompositor } from '@webmidgar/render-field';
import {
  applyFrame,
  bindClip,
  bindPoseFrame,
  buildActor,
  setActorFacing,
  setModelTextureFilter,
  type Actor,
  type ActorLighting,
  type ActorMeshBundle,
  type BoundClip,
} from '@webmidgar/render-actor';
import { openHttpSource } from './game/http-source.js';

/**
 * Sichtprüfung des Feldmodell-Farbpfades mit strukturierter Rückmeldung.
 *
 * Zweck: Die Rechnung hinter den Farben ist gegen das Dekompilat geprüft
 * (docs/FARBPFAD-FELDMODELLE.md) — ob das Ergebnis dem Original **gleicht**,
 * kann nur ein Auge sagen, das das Original kennt. Diese Seite stellt dafür
 * die beiden geänderten Entscheidungen als Schalter nebeneinander und
 * sammelt das Urteil als JSON ein.
 *
 * Nur Entwicklungsbetrieb: Datenquelle ist `/ff7data` (s. ff7data-plugin.ts).
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = $('status');
const canvas = $<HTMLCanvasElement>('view');
const fieldSel = $<HTMLSelectElement>('field');
const modelSel = $<HTMLSelectElement>('model');
const animSel = $<HTMLSelectElement>('anim');
const farbraumSel = $<HTMLSelectElement>('farbraum');
const lichtSel = $<HTMLSelectElement>('licht');
const filterSel = $<HTMLSelectElement>('filter');
const azimut = $<HTMLInputElement>('azimut');
const hoehe = $<HTMLInputElement>('hoehe');
const facing = $<HTMLInputElement>('facing');
const frameSlider = $<HTMLInputElement>('frame');
const playBtn = $<HTMLButtonElement>('play');
const jsonEl = $<HTMLTextAreaElement>('json');
const copyBtn = $<HTMLButtonElement>('copy');
const countEl = $('count');
const lightInfo = $('lightInfo');

const setStatus = (s: string): void => {
  statusEl.textContent = s;
};

// --- Szene -----------------------------------------------------------------

const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer); // setzt den Original-Farbpfad
const scene = new Scene();
const actorGroup = new Group();
scene.add(actorGroup);
const camera = new PerspectiveCamera(45, 4 / 3, 1, 30000);

let bboxCenter = new Vector3();
let bboxRadius = 50;

function updateCamera(): void {
  const az = (Number(azimut.value) * Math.PI) / 180;
  const el = (Number(hoehe.value) * Math.PI) / 180;
  const dist = bboxRadius * 2.6 + 15;
  camera.up.set(0, 1, 0);
  camera.position.set(
    bboxCenter.x + dist * Math.sin(az) * Math.cos(el),
    bboxCenter.y + dist * Math.sin(el),
    bboxCenter.z + dist * Math.cos(az) * Math.cos(el),
  );
  camera.lookAt(bboxCenter);
  camera.updateProjectionMatrix();
  $('azimutVal').textContent = `${azimut.value}°`;
  $('hoeheVal').textContent = `${hoehe.value}°`;
}

function frameCamera(): void {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  if (actor) box.setFromObject(actor.root);
  if (box.isEmpty()) {
    bboxCenter = new Vector3();
    bboxRadius = 50;
  } else {
    bboxCenter = box.getCenter(new Vector3());
    bboxRadius = Math.max(box.getSize(new Vector3()).length() / 2, 8);
  }
  updateCamera();
}

// --- Datenquelle ------------------------------------------------------------

const index = new IndexService();
const fieldByName = new Map<string, LgpEntry>();
const charByName = new Map<string, LgpEntry>();
const resolveChar = (n: string): LgpEntry | undefined => charByName.get(n.toLowerCase());
const readEntry = (e: LgpEntry): Promise<Uint8Array> => index.readEntry(e.canonicalId);

// --- Modellzustand ----------------------------------------------------------

interface BoneBundle {
  mesh: MeshSource;
  textures: (TextureSource | null)[];
}

let manifest: FieldModelManifest | null = null;
let entry: FieldModelEntry | null = null;
let skeleton: Skeleton | null = null;
let bundles = new Map<number, BoneBundle[]>();
let licht: ActorLighting | null = null;
let actor: Actor | null = null;
let clip: BoundClip | null = null;
let frameIndex = 0;
let playing = true;
let lastAdvance = 0;
const FRAME_MS = 80;

/**
 * Die **entfernte** Lambert-Hypothese, für den A/B-Vergleich nachgebaut:
 * `farbe · min(1,25, ambient + Σ max(0, n·l̂ᵢ)·cᵢ)` mit normierter, NICHT
 * negierter Richtung, einmalig im Modellraum eingebacken. Sie steht hier
 * bewusst als Variante, damit das Auge zwischen alt und neu entscheiden kann
 * statt nur zwischen „neu" und „nichts".
 */
function altLambert(mesh: MeshSource, l: ActorLighting): MeshSource {
  const out = new Uint8Array(mesh.colors);
  const dirs = l.lights.map((x) => {
    const [dx, dy, dz] = x.direction;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len, c: x.color };
  });
  const n = mesh.positions.length / 3;
  for (let v = 0; v < n; v++) {
    const nx = mesh.normals[v * 3]!;
    const ny = mesh.normals[v * 3 + 1]!;
    const nz = mesh.normals[v * 3 + 2]!;
    let r = l.ambient[0] / 255;
    let g = l.ambient[1] / 255;
    let b = l.ambient[2] / 255;
    for (const d of dirs) {
      const k = Math.max(0, nx * d.x + ny * d.y + nz * d.z);
      r += (k * d.c[0]) / 255;
      g += (k * d.c[1]) / 255;
      b += (k * d.c[2]) / 255;
    }
    const o = v * 4;
    out[o] = Math.min(255, out[o]! * Math.min(1.25, r));
    out[o + 1] = Math.min(255, out[o + 1]! * Math.min(1.25, g));
    out[o + 2] = Math.min(255, out[o + 2]! * Math.min(1.25, b));
  }
  return { ...mesh, colors: out };
}

function rebuildActor(): void {
  if (actor) actorGroup.remove(actor.root);
  actor = null;
  if (!skeleton) return;
  const modus = lichtSel.value;
  const built = buildActor(
    skeleton,
    (bone): ActorMeshBundle[] =>
      (bundles.get(bone) ?? []).map((b) => ({
        mesh: modus === 'alt' && licht ? altLambert(b.mesh, licht) : b.mesh,
        textures: b.textures,
      })),
    modus === 'original' && licht ? licht : undefined,
  );
  actor = built;
  actorGroup.add(built.root);
  applyFacing();
  applyCurrentFrame();
  frameCamera();
}

function applyFacing(): void {
  if (!actor) return;
  setActorFacing(actor, Number(facing.value));
  $('facingVal').textContent = `${facing.value}°`;
}

function applyCurrentFrame(): void {
  if (!actor || !skeleton) return;
  const f = clip?.frames[frameIndex] ?? bindPoseFrame(skeleton);
  applyFrame(actor, skeleton, f);
  $('frameVal').textContent = `${frameIndex} / ${Math.max((clip?.frames.length ?? 1) - 1, 0)}`;
}

// --- Laden ------------------------------------------------------------------

async function loadField(name: string): Promise<void> {
  const e = fieldByName.get(name);
  if (!e) return;
  setStatus(`Lade Field "${name}" …`);
  const parsed = parseFieldEntry(await readEntry(e), name);
  manifest = parsed.ok ? (parsed.bundle?.models ?? null) : null;
  modelSel.innerHTML = (manifest?.models ?? [])
    .map((m, i) => `<option value="${i}">#${i} ${m.modelFile} (${m.animations.length} Anim.)</option>`)
    .join('');
  modelSel.disabled = !manifest || manifest.models.length === 0;
  if (manifest && manifest.models.length > 0) await loadModel(0);
  else setStatus(`Field "${name}" hat kein Modellmanifest.`);
}

async function loadModel(i: number): Promise<void> {
  if (!manifest) return;
  const m = manifest.models[i];
  if (!m) return;
  entry = m;
  modelSel.value = String(i);
  setStatus(`Lade Modell "${m.modelFile}" …`);

  skeleton = null;
  bundles = new Map();
  clip = null;
  frameIndex = 0;

  const hrcEntry = resolveChar(m.modelFile);
  if (!hrcEntry) {
    setStatus(`hrc "${m.modelFile}" nicht in char.lgp.`);
    return;
  }
  const sk = parseHrc(await readEntry(hrcEntry), m.modelFile).value;
  if (!sk) {
    setStatus(`hrc "${m.modelFile}" nicht parsbar.`);
    return;
  }
  skeleton = sk;

  for (let b = 0; b < sk.bones.length; b++) {
    const list: BoneBundle[] = [];
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
  zeigeLicht();

  animSel.innerHTML = m.animations.map((a, k) => `<option value="${k}">${a.name} → ${a.file}</option>`).join('');
  animSel.disabled = m.animations.length === 0;
  rebuildActor();
  if (m.animations.length > 0) await loadAnim(0);
  else frameCamera();

  const flach = [...bundles.values()].flat().reduce((n, b) => n + b.mesh.submeshes.filter((s) => s.flatShaded).length, 0);
  const gesamt = [...bundles.values()].flat().reduce((n, b) => n + b.mesh.submeshes.length, 0);
  setStatus(`${m.modelFile}: ${sk.bones.length} Bones, ${gesamt} Submeshes (${flach} flach schattiert).`);
}

async function loadAnim(k: number): Promise<void> {
  if (!entry || !skeleton) return;
  const a = entry.animations[k];
  if (!a) return;
  animSel.value = String(k);
  const e = resolveChar(a.file);
  if (!e) {
    clip = null;
    return;
  }
  const src = parseA(await readEntry(e), a.file).value;
  clip = src ? bindClip(skeleton, src, a.file) : null;
  frameIndex = 0;
  frameSlider.max = String(Math.max((clip?.frames.length ?? 1) - 1, 0));
  frameSlider.value = '0';
  applyCurrentFrame();
  frameCamera();
}

function zeigeLicht(): void {
  if (!licht) {
    lightInfo.textContent = 'kein Lichtblock';
    return;
  }
  const sw = (c: [number, number, number]): string =>
    `<span class="sw" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>`;
  const zeilen = licht.lights
    .map(
      (l, i) =>
        `<tr><td>Licht ${i}</td><td>${sw(l.color)} ${l.color.join(', ')}</td><td class="val">Richtung ${l.direction.join(', ')}</td></tr>`,
    )
    .join('');
  lightInfo.innerHTML = `<table class="lights">${zeilen}<tr><td>Ambient</td><td>${sw(licht.ambient)} ${licht.ambient.join(', ')}</td><td></td></tr></table>`;
}

// --- Bedienung --------------------------------------------------------------

fieldSel.addEventListener('change', () => void loadField(fieldSel.value));
modelSel.addEventListener('change', () => void loadModel(Number(modelSel.value)));
animSel.addEventListener('change', () => void loadAnim(Number(animSel.value)));
lichtSel.addEventListener('change', rebuildActor);
filterSel.addEventListener('change', () => {
  // Der Filter sitzt in der Texturerzeugung — der Actor muss neu gebaut werden.
  setModelTextureFilter(filterSel.value === 'linear');
  void loadModel(Number(modelSel.value));
});
farbraumSel.addEventListener('change', () => {
  renderer.outputColorSpace = farbraumSel.value === 'srgb' ? SRGBColorSpace : LinearSRGBColorSpace;
});
azimut.addEventListener('input', updateCamera);
hoehe.addEventListener('input', updateCamera);
facing.addEventListener('input', applyFacing);
frameSlider.addEventListener('input', () => {
  playing = false;
  playBtn.textContent = '▶ Abspielen';
  frameIndex = Number(frameSlider.value);
  applyCurrentFrame();
});
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? '⏸ Pause' : '▶ Abspielen';
});
$('prev').addEventListener('click', () => {
  const i = Number(modelSel.value) - 1;
  if (i >= 0) void loadModel(i);
});
$('next').addEventListener('click', () => {
  const i = Number(modelSel.value) + 1;
  if (manifest && i < manifest.models.length) void loadModel(i);
});

// --- Rückmeldung ------------------------------------------------------------

interface Befund {
  field: string;
  modellIndex: number;
  modellDatei: string;
  ambient: [number, number, number] | null;
  einstellungen: { farbraum: string; licht: string; filter: string; azimut: number; hoehe: number; figur: number; frame: number };
  bewertung: Record<string, string>;
  anmerkung: string;
}

const befunde: Befund[] = [];

function aktuellerBefund(): Befund {
  const bewertung: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLSelectElement>('select[data-q]')) {
    if (el.value) bewertung[el.id.replace(/^q_/, '')] = el.value;
  }
  return {
    field: fieldSel.value,
    modellIndex: Number(modelSel.value),
    modellDatei: entry?.modelFile ?? '',
    ambient: licht?.ambient ?? null,
    einstellungen: {
      farbraum: farbraumSel.value,
      licht: lichtSel.value,
      filter: filterSel.value,
      azimut: Number(azimut.value),
      hoehe: Number(hoehe.value),
      figur: Number(facing.value),
      frame: frameIndex,
    },
    bewertung,
    anmerkung: $<HTMLTextAreaElement>('q_text').value.trim(),
  };
}

$('add').addEventListener('click', () => {
  befunde.push(aktuellerBefund());
  countEl.textContent = `${befunde.length} gemerkte Befunde`;
  setStatus('Befund gemerkt — jetzt Einstellung oder Modell wechseln und weiter prüfen.');
});

$('gen').addEventListener('click', () => {
  const alle = [...befunde];
  const jetzt = aktuellerBefund();
  // Der aktuelle Stand kommt automatisch dazu, wenn überhaupt etwas bewertet
  // wurde — sonst müsste man immer erst „merken" drücken.
  if (Object.keys(jetzt.bewertung).length > 0 || jetzt.anmerkung) alle.push(jetzt);
  jsonEl.value = JSON.stringify(
    {
      art: 'webmidgar-farbcheck',
      version: 1,
      canvas: `${canvas.width}x${canvas.height}`,
      befunde: alle,
    },
    null,
    1,
  );
  copyBtn.disabled = alle.length === 0;
  setStatus(alle.length === 0 ? 'Noch nichts bewertet.' : `${alle.length} Befund(e) — kopieren und im Chat einfügen.`);
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(jsonEl.value);
    setStatus('In die Zwischenablage kopiert.');
  } catch {
    jsonEl.select();
    setStatus('Automatisches Kopieren blockiert — Text ist markiert, bitte Strg+C.');
  }
});

// --- Schleife ---------------------------------------------------------------

function loop(t: number): void {
  if (playing && clip && clip.frames.length > 0 && t - lastAdvance >= FRAME_MS) {
    frameIndex = (frameIndex + 1) % clip.frames.length;
    frameSlider.value = String(frameIndex);
    applyCurrentFrame();
    lastAdvance = t;
  }
  compositor.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Start ------------------------------------------------------------------

/** Ein paar Felder, in denen bekannte Figuren stehen — spart das Suchen. */
const VORSCHLAEGE = ['md1stin', 'md1_1', 'nrthmk', 'tin_1', 'mds7st1', 'elm_i'];

void (async () => {
  const source = await openHttpSource();
  if (!source) {
    setStatus('Dev-Datenquelle /ff7data nicht verfügbar — FF7_DATA_DIR bzw. apps/demo/ff7data.local.json fehlt.');
    return;
  }
  setStatus('Indexiere Archive …');
  await index.openSource(source, { deep: false });
  for (const e of index.listEntries('flevel')) if (!e.name.includes('.')) fieldByName.set(e.name, e);
  for (const e of index.listEntries('char')) charByName.set(e.name, e);

  const namen = [...fieldByName.keys()].sort((a, b) => a.localeCompare(b));
  const oben = VORSCHLAEGE.filter((n) => fieldByName.has(n));
  fieldSel.innerHTML = [...oben, ...namen.filter((n) => !oben.includes(n))]
    .map((n) => `<option value="${n}">${n}</option>`)
    .join('');
  updateCamera();
  await loadField(fieldSel.value);
})().catch((err: unknown) => setStatus(`Fehler: ${(err as Error).message}`));

(window as unknown as { farbcheck: unknown }).farbcheck = {
  bild: (): string => {
    compositor.render(scene, camera);
    return canvas.toDataURL('image/png');
  },
  setze: (o: Partial<{ farbraum: string; licht: string; filter: string; azimut: number; hoehe: number; figur: number }>): void => {
    if (o.farbraum) {
      farbraumSel.value = o.farbraum;
      farbraumSel.dispatchEvent(new Event('change'));
    }
    if (o.licht) {
      lichtSel.value = o.licht;
      lichtSel.dispatchEvent(new Event('change'));
    }
    if (o.azimut !== undefined) azimut.value = String(o.azimut);
    if (o.hoehe !== undefined) hoehe.value = String(o.hoehe);
    if (o.figur !== undefined) {
      facing.value = String(o.figur);
      applyFacing();
    }
    updateCamera();
  },
  ladeModell: (f: string, i: number): Promise<void> =>
    loadField(f).then(() => loadModel(i)),
  pause: (): void => {
    playing = false;
  },
};
