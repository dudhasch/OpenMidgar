import {
  AxesHelper,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { IoRequest, IoResponse, IoWorkerInit, OpenSourceResult } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import {
  decodeModelLightBlock,
  parseFieldEntry,
  type FieldBundle,
  type FieldModelAnimation,
  type FieldModelEntry,
  type FieldModelManifest,
} from '@webmidgar/formats-field';
import {
  parseA,
  parseHrc,
  parseP,
  parseRsd,
  parseTex,
  type AnimationClipSource,
  type MeshSource,
  type ModelDiagnostic,
  type Skeleton,
  type TextureSource,
} from '@webmidgar/formats-model';
import { FieldCompositor } from '@webmidgar/render-field';
import {
  applyFrame,
  bindClip,
  bindPoseFrame,
  buildActor,
  buildFallbackActor,
  type Actor,
  type ActorMeshBundle,
  type BoundClip,
} from '@webmidgar/render-actor';

/**
 * S10-Demo: echtes Field-Modell aus der lokalen Installation. Auflösekette
 * flevel → Manifest (Sektion 3) → char.lgp (hrc → rsd → p/tex → a),
 * `buildActor`/`applyFrame`/`bindClip` wie in der S7-Fixture-Demo
 * (`actor-demo.ts`), aber mit echten Daten. Ausschließlich lokal gelesene
 * Originaldaten; nichts verlässt den Browser.
 *
 * Zusätzlich Vergleichsschalter für die R4-Sichtvalidierung
 * (docs/R4-MODELL-KONVENTIONEN.md, B1/B5/B6) — sie wirken NUR hier in der
 * Demo, nicht in den Bibliothekspaketen. Die Wurzelrahmen-Korrektur
 * (R4-Fix) ist seit dem Referenz-Entscheid Vorgabe und hier abschaltbar.
 */

type CameraView = 'front' | 'side' | 'top';

interface RawBoneBundle {
  mesh: MeshSource;
  textures: (TextureSource | null)[];
}

interface Stats {
  field: string;
  modelIndex: number;
  modelFile: string;
  fallback: boolean;
  fallbackReason: string;
  boneCount: number;
  submeshCount: number;
  texturedSubmeshCount: number;
  clipFrameCount: number;
  clipBoneCount: number;
  diagnosticCounts: Record<string, number>;
  resolveIssueCount: number;
  resolveIssues: string[];
}

// --- IO/Index-Worker (derselbe Pfad wie main.ts / background-demo.ts) ------

const worker = new Worker(new URL('../../../packages/io/src/io-worker.ts', import.meta.url), {
  type: 'module',
});
let nextRequestId = 1;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function request(msg: DistributiveOmit<IoRequest, 'v' | 'requestId'>): Promise<IoResponse> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<IoResponse>) => {
      if (ev.data.requestId !== requestId) return;
      worker.removeEventListener('message', onMessage);
      if (ev.data.kind === 'fault') reject(new Error(`${ev.data.code}: ${ev.data.message}`));
      else resolve(ev.data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ v: 1, requestId, ...msg } as IoRequest);
  });
}

async function readEntryBytes(entry: LgpEntry): Promise<Uint8Array> {
  const res = await request({ kind: 'read-entry', canonicalId: entry.canonicalId });
  if (res.kind !== 'bytes') throw new Error('Unerwartete Antwort beim Lesen des Eintrags');
  return new Uint8Array(res.payload);
}

const $ = (id: string) => document.getElementById(id)!;

// --- DOM --------------------------------------------------------------------

const statusEl = $('status');
const pickBtn = $('pick') as HTMLButtonElement;
const fieldSelectEl = $('fieldSelect') as HTMLSelectElement;
const loadManifestBtn = $('loadManifest') as HTMLButtonElement;
const tableBody = $('modelTableBody') as HTMLTableSectionElement;
const canvas = $('view') as HTMLCanvasElement;
const readoutEl = $('readout');
const animSelectEl = $('animSelect') as HTMLSelectElement;
const frameSliderEl = $('frameSlider') as HTMLInputElement;
const frameLabelEl = $('frameLabel');
const axesCheckboxEl = $('toggleAxes') as HTMLInputElement;
const viewSelectEl = $('viewSelect') as HTMLSelectElement;
const swapCheckboxEl = $('toggleSwap') as HTMLInputElement;
/**
 * R4-Wurzelrahmen-Fix: Die `.a`-Wurzel steht in einem gedrehten Rahmen
 * (Kujata: rootRotationDegreesX = 180 im reinen Modellraum); mit unserem
 * ADR-009-Wrapper heißt das Wurzel-X −90° und t_m = (t.x, −t.z, t.y).
 * Numerisch verifiziert (docs/R4-MODELL-KONVENTIONEN.md) und deshalb
 * standardmäßig AN — der Schalter bleibt als Vergleich für die finale
 * Sichtprüfung an der echten Installation.
 */
const rootFrameFixCheckboxEl = $('toggleRootFrameFix') as HTMLInputElement;
const rootFrameFix = (): boolean => rootFrameFixCheckboxEl.checked;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// --- Szene (einmalig) --------------------------------------------------------

const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);
const scene = new Scene();
const actorGroup = new Group();
scene.add(actorGroup);
const axesHelper = new AxesHelper(50);
axesHelper.visible = axesCheckboxEl.checked;
scene.add(axesHelper);

const camera = new PerspectiveCamera(45, canvas.width / canvas.height, 10, 20000);
let lastBBoxCenter = new Vector3(0, 0, 0);
let lastBBoxRadius = 50;
let cameraView: CameraView = 'front';

function setCameraView(view: CameraView): void {
  cameraView = view;
  viewSelectEl.value = view;
  const dist = lastBBoxRadius * 2.5 + 20;
  const c = lastBBoxCenter;
  if (view === 'front') {
    camera.up.set(0, 1, 0);
    camera.position.set(c.x, c.y, c.z + dist);
  } else if (view === 'side') {
    camera.up.set(0, 1, 0);
    camera.position.set(c.x + dist, c.y, c.z);
  } else {
    camera.up.set(0, 0, -1);
    camera.position.set(c.x, c.y + dist, c.z);
  }
  camera.lookAt(c);
  camera.updateProjectionMatrix();
}
setCameraView('front');

function frameActorCamera(): void {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  if (currentActor) box.setFromObject(currentActor.root);
  if (box.isEmpty()) {
    lastBBoxCenter = new Vector3(0, 0, 0);
    lastBBoxRadius = 50;
  } else {
    lastBBoxCenter = box.getCenter(new Vector3());
    lastBBoxRadius = Math.max(box.getSize(new Vector3()).length() / 2, 10);
  }
  setCameraView(cameraView);
}

// --- Zustand: Verzeichnis/Archive --------------------------------------------

const fieldEntryByName = new Map<string, LgpEntry>();
const charEntryByName = new Map<string, LgpEntry>();
let fieldNames: string[] = [];

function resolveChar(name: string): LgpEntry | undefined {
  return charEntryByName.get(name.toLowerCase());
}

// --- Zustand: aktuelles Field/Modell ------------------------------------------

let currentFieldName = '';
let currentBundle: FieldBundle | null = null;

let currentActor: Actor | null = null;
let boneAxisLines: LineSegments[] = [];
let currentSkeleton: Skeleton | null = null;
let currentBoneBundles = new Map<number, RawBoneBundle[]>();
let currentModel: FieldModelEntry | null = null;
let currentModelIndex = -1;
let usedFallback = false;
let fallbackReason = '';
let diagnostics: ModelDiagnostic[] = [];
let resolveIssues: string[] = [];

let currentClipBound: BoundClip | null = null;
let currentClipSource: AnimationClipSource | null = null;
let frameIndex = 0;
let autoPlay = true;
let lastAdvance = 0;
const FRAME_INTERVAL_MS = 80;

// --- Verzeichniswahl + Archivscan (Nutzergeste erforderlich) -----------------

pickBtn.addEventListener('click', async () => {
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker(opts?: { mode: string }): Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: 'read' });
    worker.postMessage({ v: 1, kind: 'init', directoryHandle: handle } satisfies IoWorkerInit);

    setStatus('Scanne Installationsverzeichnis …');
    const res = await request({ kind: 'open-source' });
    if (res.kind !== 'result') throw new Error('Unerwartete Antwort beim Scan');
    const result = res.payload as OpenSourceResult;

    const flevel = result.archives.find((a) => a.archiveName === 'flevel');
    if (!flevel) {
      setStatus('Archiv "flevel" wurde in diesem Verzeichnis nicht gefunden.');
      return;
    }
    if (flevel.fatal) {
      setStatus('Archiv "flevel" ist unbrauchbar (fataler Scanfehler).');
      return;
    }
    const char = result.archives.find((a) => a.archiveName === 'char');

    const fieldEntriesRes = await request({ kind: 'list-entries', archiveName: 'flevel' });
    if (fieldEntriesRes.kind !== 'result') throw new Error('Unerwartete Antwort beim Auflisten (flevel)');
    const fieldEntries = fieldEntriesRes.payload as LgpEntry[];
    fieldEntryByName.clear();
    for (const e of fieldEntries) {
      if (!e.name.includes('.')) fieldEntryByName.set(e.name, e);
    }
    fieldNames = [...fieldEntryByName.keys()].sort((a, b) => a.localeCompare(b));
    populateFieldSelect();

    charEntryByName.clear();
    if (char && !char.fatal) {
      const charEntriesRes = await request({ kind: 'list-entries', archiveName: 'char' });
      if (charEntriesRes.kind !== 'result') throw new Error('Unerwartete Antwort beim Auflisten (char)');
      for (const e of charEntriesRes.payload as LgpEntry[]) charEntryByName.set(e.name, e);
    }

    const charNote = !char
      ? ' — Archiv "char" fehlt, Modelle sind nicht auflösbar.'
      : char.fatal
        ? ' — Archiv "char" ist unbrauchbar (fataler Scanfehler), Modelle sind nicht auflösbar.'
        : ` (${charEntryByName.size} Modell-Assets in char.lgp).`;
    setStatus(`Fertig — ${fieldNames.length} Fields gefunden${charNote}`);
  } catch (err) {
    setStatus(`Fehler: ${(err as Error).message}`);
  }
});

function populateFieldSelect(): void {
  fieldSelectEl.innerHTML = fieldNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  fieldSelectEl.disabled = fieldNames.length === 0;
  loadManifestBtn.disabled = fieldNames.length === 0;
}

loadManifestBtn.addEventListener('click', () => {
  const name = fieldSelectEl.value;
  if (name) void loadManifest(name);
});

// --- Manifest laden + Tabelle ------------------------------------------------

async function loadManifest(name: string): Promise<void> {
  const entry = fieldEntryByName.get(name);
  if (!entry) throw new Error(`Field "${name}" ist nicht bekannt — zuerst Verzeichnis wählen und scannen.`);

  setStatus(`Lade Field "${name}" …`);
  const bytes = await readEntryBytes(entry);
  const parsed = parseFieldEntry(bytes, name);
  currentFieldName = name;
  currentBundle = parsed.ok ? (parsed.bundle ?? null) : null;
  clearModelState();

  if (!parsed.ok || !currentBundle) {
    tableBody.innerHTML = '';
    const codes = parsed.diagnostics.map((d) => d.code).join(', ') || 'unbekannt';
    readoutEl.textContent = `Field "${name}" konnte nicht gelesen werden (LZS/Container fatal).\nDiagnosen: ${codes}`;
    setStatus(`Field "${name}" unbrauchbar.`);
    return;
  }
  if (!currentBundle.models) {
    tableBody.innerHTML = '';
    readoutEl.textContent = `Field "${name}": Sektion 3 (Model-Loader) fehlt oder ist quarantänisiert — keine Modelle.`;
    setStatus(`Field "${name}" geladen, aber ohne Modellmanifest.`);
    return;
  }

  populateModelTable(currentBundle.models);
  readoutEl.textContent = `Field "${name}": ${currentBundle.models.models.length} Modelle im Manifest. Zeile anklicken oder "Anzeigen" wählen.`;
  setStatus(`Field "${name}" geladen — ${currentBundle.models.models.length} Modelle.`);
}

function populateModelTable(manifest: FieldModelManifest): void {
  tableBody.innerHTML = '';
  manifest.models.forEach((model, i) => {
    const tr = document.createElement('tr');
    const light = decodeModelLightBlock(model.blockRaw);

    const cellTexts = [
      String(i),
      model.modelFile,
      model.scale === null ? '–' : String(model.scale),
      String(model.unknownAfterName),
      String(model.animations.length),
    ];
    for (const text of cellTexts) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    const colorTd = document.createElement('td');
    if (light) {
      const [r, g, b] = light.ambient;
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      colorTd.appendChild(swatch);
      colorTd.appendChild(document.createTextNode(` ${r},${g},${b}`));
    } else {
      colorTd.textContent = '–';
    }
    tr.appendChild(colorTd);

    const actionTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = 'Anzeigen';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void showModel(i);
    });
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    tr.addEventListener('click', () => void showModel(i));
    tableBody.appendChild(tr);
  });
}

// --- Modell anzeigen: hrc → rsd → p/tex, Actor bauen -------------------------

function clearModelState(): void {
  if (currentActor) {
    actorGroup.remove(currentActor.root);
    currentActor = null;
  }
  boneAxisLines = [];
  currentSkeleton = null;
  currentBoneBundles = new Map();
  currentModel = null;
  currentModelIndex = -1;
  currentClipBound = null;
  currentClipSource = null;
  diagnostics = [];
  resolveIssues = [];
  usedFallback = false;
  fallbackReason = '';
  autoPlay = true;
  frameIndex = 0;
  populateAnimationSelect([]);
  frameSliderEl.value = '0';
  frameSliderEl.max = '0';
  updateFrameLabel();
  frameActorCamera();
}

async function showModel(index: number): Promise<void> {
  if (!currentBundle?.models) throw new Error('Kein Manifest geladen.');
  const manifest = currentBundle.models;
  const model = manifest.models[index];
  if (!model) {
    throw new Error(`Modellindex ${index} außerhalb des Manifests (0…${manifest.models.length - 1}).`);
  }

  currentModelIndex = index;
  currentModel = model;
  diagnostics = [];
  resolveIssues = [];
  usedFallback = false;
  fallbackReason = '';
  autoPlay = true;
  frameIndex = 0;

  setStatus(`Lade Modell "${model.modelFile}" …`);

  const hrcEntry = resolveChar(model.modelFile);
  if (!hrcEntry) {
    fallbackReason = `hrc "${model.modelFile}" nicht in char.lgp gefunden`;
    resolveIssues.push(fallbackReason);
    finishFallback();
    return;
  }
  const hrcBytes = await readEntryBytes(hrcEntry);
  const hrcResult = parseHrc(hrcBytes, model.modelFile);
  diagnostics.push(...hrcResult.diagnostics);
  if (!hrcResult.value) {
    fallbackReason = `hrc "${model.modelFile}" nicht parsbar`;
    finishFallback();
    return;
  }
  const skeleton = hrcResult.value;
  currentSkeleton = skeleton;

  const boneBundles = new Map<number, RawBoneBundle[]>();
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    const bundles: RawBoneBundle[] = [];
    for (const ref of bone.resourceRefs) {
      const rsdName = `${ref}.rsd`;
      const rsdEntry = resolveChar(rsdName);
      if (!rsdEntry) {
        resolveIssues.push(`rsd "${rsdName}" (Bone "${bone.name}") nicht in char.lgp gefunden`);
        continue;
      }
      const rsdResult = parseRsd(await readEntryBytes(rsdEntry), rsdName);
      diagnostics.push(...rsdResult.diagnostics);
      if (!rsdResult.value) {
        resolveIssues.push(`rsd "${rsdName}" nicht parsbar`);
        continue;
      }
      const binding = rsdResult.value;

      const pName = `${binding.meshRef}.p`;
      const pEntry = resolveChar(pName);
      if (!pEntry) {
        resolveIssues.push(`p "${pName}" (aus ${rsdName}) nicht in char.lgp gefunden`);
        continue;
      }
      const pResult = parseP(await readEntryBytes(pEntry), pName);
      diagnostics.push(...pResult.diagnostics);
      if (!pResult.value) {
        resolveIssues.push(`p "${pName}" nicht parsbar`);
        continue;
      }

      const textures: (TextureSource | null)[] = [];
      for (const texRef of binding.textureRefs) {
        const texName = `${texRef}.tex`;
        const texEntry = resolveChar(texName);
        if (!texEntry) {
          resolveIssues.push(`tex "${texName}" (aus ${rsdName}) nicht in char.lgp gefunden`);
          textures.push(null);
          continue;
        }
        const texResult = parseTex(await readEntryBytes(texEntry), texName);
        diagnostics.push(...texResult.diagnostics);
        if (!texResult.value) resolveIssues.push(`tex "${texName}" nicht parsbar`);
        textures.push(texResult.value);
      }

      bundles.push({ mesh: pResult.value, textures });
    }
    boneBundles.set(i, bundles);
  }
  currentBoneBundles = boneBundles;

  replaceActorInScene(buildActorFromCache());

  populateAnimationSelect(model.animations);
  if (model.animations.length > 0) {
    await loadAnimation(0);
  } else {
    currentClipBound = null;
    currentClipSource = null;
    applyBindPoseIfPossible();
  }

  updateReadout();
  setStatus(`Modell "${model.modelFile}" angezeigt (${index + 1}/${manifest.models.length}).`);
}

function finishFallback(): void {
  usedFallback = true;
  currentSkeleton = null;
  currentBoneBundles = new Map();
  currentClipBound = null;
  currentClipSource = null;
  replaceActorInScene(buildFallbackActor());
  populateAnimationSelect([]);
  updateReadout();
  setStatus(`Modell "${currentModel?.modelFile ?? '?'}": Fallback-Actor (${fallbackReason}).`);
}

function swapPalette(tex: TextureSource): TextureSource {
  return {
    ...tex,
    palettes: tex.palettes.map((pal) => {
      const copy = new Uint8Array(pal);
      for (let i = 0; i + 2 < copy.length; i += 4) {
        const r = copy[i]!;
        const b = copy[i + 2]!;
        copy[i] = b;
        copy[i + 2] = r;
      }
      return copy;
    }),
  };
}

function buildActorFromCache(): Actor {
  if (!currentSkeleton) return buildFallbackActor();
  const skeleton = currentSkeleton;
  const swap = swapCheckboxEl.checked;
  return buildActor(skeleton, (boneIndex): ActorMeshBundle[] => {
    const bundles = currentBoneBundles.get(boneIndex) ?? [];
    return bundles.map((b) => ({
      mesh: b.mesh,
      textures: b.textures.map((t) => (t ? (swap ? swapPalette(t) : t) : null)),
    }));
  });
}

function replaceActorInScene(actor: Actor): void {
  if (currentActor) actorGroup.remove(currentActor.root);
  boneAxisLines = [];
  currentActor = actor;
  actorGroup.add(actor.root);
  buildBoneAxisLines();
  frameActorCamera();
}

function buildBoneAxisLines(): void {
  boneAxisLines = [];
  if (!currentActor || !currentSkeleton) return;
  const actor = currentActor;
  currentSkeleton.bones.forEach((bone, i) => {
    const group = actor.boneGroups[i];
    if (!group) return;
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, bone.length], 3));
    // Rot = negative Länge (Kette wächst nach -Z, R4/B1-Regelfall), Grün = positiv.
    const line = new LineSegments(geom, new LineBasicMaterial({ color: bone.length < 0 ? 0xff5050 : 0x50ff90 }));
    line.visible = axesCheckboxEl.checked;
    group.add(line);
    boneAxisLines.push(line);
  });
}

axesCheckboxEl.addEventListener('change', () => {
  axesHelper.visible = axesCheckboxEl.checked;
  for (const line of boneAxisLines) line.visible = axesCheckboxEl.checked;
});

viewSelectEl.addEventListener('change', () => {
  setCameraView(viewSelectEl.value as CameraView);
});

rootFrameFixCheckboxEl.addEventListener('change', () => {
  applyCurrentFrame();
  frameActorCamera();
});

swapCheckboxEl.addEventListener('change', () => {
  if (!currentSkeleton) return; // Fallback-Actor hat keine Texturen.
  replaceActorInScene(buildActorFromCache());
  updateReadout();
});

// --- Animation ---------------------------------------------------------------

function populateAnimationSelect(anims: readonly FieldModelAnimation[]): void {
  animSelectEl.innerHTML = anims
    .map((a, i) => `<option value="${i}">${a.name} → ${a.file}</option>`)
    .join('');
  animSelectEl.disabled = anims.length === 0;
}

async function loadAnimation(animIndex: number): Promise<void> {
  if (!currentModel || !currentSkeleton) return;
  const anim = currentModel.animations[animIndex];
  if (!anim) return;
  animSelectEl.value = String(animIndex);

  const entry = resolveChar(anim.file);
  if (!entry) {
    resolveIssues.push(`Animation "${anim.file}" nicht in char.lgp gefunden`);
    currentClipBound = null;
    currentClipSource = null;
    applyBindPoseIfPossible();
    updateReadout();
    return;
  }
  const result = parseA(await readEntryBytes(entry), anim.file);
  diagnostics.push(...result.diagnostics);
  if (!result.value) {
    resolveIssues.push(`Animation "${anim.file}" nicht parsbar`);
    currentClipBound = null;
    currentClipSource = null;
    applyBindPoseIfPossible();
    updateReadout();
    return;
  }
  currentClipSource = result.value;
  const bound = bindClip(currentSkeleton, result.value, anim.file);
  diagnostics.push(...bound.warnings);
  currentClipBound = bound;
  frameIndex = 0;
  autoPlay = true;
  frameSliderEl.max = String(Math.max(bound.frames.length - 1, 0));
  frameSliderEl.value = '0';
  applyCurrentFrame();
  updateReadout();
}

animSelectEl.addEventListener('change', () => {
  void loadAnimation(Number(animSelectEl.value));
});

frameSliderEl.addEventListener('input', () => {
  autoPlay = false;
  frameIndex = Number(frameSliderEl.value);
  applyCurrentFrame();
});

function applyBindPoseIfPossible(): void {
  if (currentActor && currentSkeleton) applyFrame(currentActor, currentSkeleton, bindPoseFrame(currentSkeleton), rootFrameFix());
}

function applyCurrentFrame(): void {
  if (currentActor && currentSkeleton && currentClipBound) {
    const frame = currentClipBound.frames[frameIndex] ?? bindPoseFrame(currentSkeleton);
    applyFrame(currentActor, currentSkeleton, frame, rootFrameFix());
  }
  updateFrameLabel();
}

function updateFrameLabel(): void {
  const max = Math.max((currentClipBound?.frames.length ?? 1) - 1, 0);
  frameLabelEl.textContent = `${frameIndex} / ${max}`;
}

// --- Renderschleife ------------------------------------------------------------

function loop(t: number): void {
  if (currentActor && currentSkeleton && currentClipBound && autoPlay && currentClipBound.frames.length > 0) {
    if (t - lastAdvance >= FRAME_INTERVAL_MS) {
      frameIndex = (frameIndex + 1) % currentClipBound.frames.length;
      frameSliderEl.value = String(frameIndex);
      applyCurrentFrame();
      lastAdvance = t;
    }
  }
  compositor.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Ausleseleiste -------------------------------------------------------------

function computeStats(): Stats {
  let submeshCount = 0;
  let texturedSubmeshCount = 0;
  for (const bundles of currentBoneBundles.values()) {
    for (const b of bundles) {
      submeshCount += b.mesh.submeshes.length;
      texturedSubmeshCount += b.mesh.submeshes.filter((s) => s.textured).length;
    }
  }
  const diagnosticCounts: Record<string, number> = {};
  for (const d of diagnostics) diagnosticCounts[d.code] = (diagnosticCounts[d.code] ?? 0) + 1;

  return {
    field: currentFieldName,
    modelIndex: currentModelIndex,
    modelFile: currentModel?.modelFile ?? '',
    fallback: usedFallback,
    fallbackReason,
    boneCount: currentSkeleton?.bones.length ?? 0,
    submeshCount,
    texturedSubmeshCount,
    clipFrameCount: currentClipBound?.frames.length ?? 0,
    clipBoneCount: currentClipSource?.boneCount ?? 0,
    diagnosticCounts,
    resolveIssueCount: resolveIssues.length,
    resolveIssues: [...resolveIssues],
  };
}

function updateReadout(): void {
  const stats = computeStats();
  const lines: string[] = [];
  lines.push(`Field            ${stats.field || '(keins)'}`);
  lines.push(`Modell           ${stats.modelIndex >= 0 ? `#${stats.modelIndex} ${stats.modelFile}` : '(keins)'}`);
  lines.push(`Fallback         ${stats.fallback ? `ja — ${stats.fallbackReason}` : 'nein'}`);
  lines.push(`Bones            ${stats.boneCount}`);
  lines.push(`Submeshes        ${stats.submeshCount}  (texturiert: ${stats.texturedSubmeshCount})`);
  lines.push(`Clip             Frames=${stats.clipFrameCount}  Bones=${stats.clipBoneCount}`);
  const diagEntries = Object.entries(stats.diagnosticCounts);
  lines.push(`Diagnosen        ${diagEntries.length ? diagEntries.map(([c, n]) => `${c}=${n}`).join('  ') : 'keine'}`);
  lines.push(`Auflösung        ${stats.resolveIssueCount} Problem(e)${stats.resolveIssueCount ? ':' : ''}`);
  for (const issue of stats.resolveIssues) lines.push(`  - ${issue}`);
  readoutEl.textContent = lines.join('\n');
}

// --- Automatisierungshaken für die Browser-Verifikation ----------------------
// Hinweis: Verzeichniswahl bleibt Nutzergeste (siehe Hinweistext); der
// übrige Ablauf ist danach beliebig oft ohne Nutzerinteraktion aufrufbar.

function manifestToPlain(manifest: FieldModelManifest | null): object {
  if (!manifest) return { models: [] };
  return {
    schemaVersion: manifest.schemaVersion,
    blank: manifest.blank,
    scaleGlobal: manifest.scaleGlobal,
    models: manifest.models.map((m) => ({
      name: m.name,
      modelFile: m.modelFile,
      scale: m.scale,
      unknownAfterName: m.unknownAfterName,
      animationCount: m.animations.length,
      animations: m.animations.map((a) => ({ name: a.name, file: a.file, tag: a.tag, tail: a.tail })),
      ambient: decodeModelLightBlock(m.blockRaw)?.ambient ?? null,
    })),
  };
}

(window as unknown as { fieldModelDebug: unknown }).fieldModelDebug = {
  listFields: (): string[] => [...fieldNames],
  loadManifest: async (name: string): Promise<void> => {
    if (!fieldEntryByName.has(name)) {
      throw new Error(`Field "${name}" nicht in der Liste — zuerst Verzeichnis wählen.`);
    }
    fieldSelectEl.value = name;
    await loadManifest(name);
  },
  manifest: (): object => manifestToPlain(currentBundle?.models ?? null),
  showModel: async (index: number): Promise<void> => {
    await showModel(index);
  },
  stats: (): object => computeStats(),
};
