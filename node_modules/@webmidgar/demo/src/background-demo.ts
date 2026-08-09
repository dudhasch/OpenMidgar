import { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { IoRequest, IoResponse, IoWorkerInit, OpenSourceResult } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import {
  parseFieldEntry,
  type FieldBackground,
  type FieldBundle,
  type FieldPalette,
} from '@webmidgar/formats-field';
import { FIELD_ASPECT } from '@webmidgar/convert';
import {
  buildFieldBackground,
  buildFieldCamera,
  composeBackgroundImage,
  FieldCompositor,
  type ComposedImage,
  type TileResolveIssue,
} from '@webmidgar/render-field';

/**
 * S9-Demo: echter Field-Hintergrund aus der lokalen Installation, doppelt
 * gerendert — links die CPU-Referenz (`composeBackgroundImage`), rechts der
 * GPU-Pfad (`buildFieldBackground` + bestehender 4:3-Kompositor). Ausschließlich
 * lokal gelesene Originaldaten; nichts verlässt den Browser.
 */

const NEAR = 100;
const FAR = 10000;
const FOV_BASE = 240;
const LAYER_INDICES = [0, 1, 2, 3] as const;

// --- IO/Index-Worker (derselbe Pfad wie main.ts) ----------------------------

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

const $ = (id: string) => document.getElementById(id)!;

// --- DOM ----------------------------------------------------------------

const statusEl = $('status');
const selectEl = $('fieldSelect') as HTMLSelectElement;
const loadBtn = $('load') as HTMLButtonElement;
const readoutEl = $('readout');
const canvas2d = $('view2d') as HTMLCanvasElement;
const canvasGpu = $('viewGpu') as HTMLCanvasElement;
const ctx2d = canvas2d.getContext('2d')!;

const layerCheckboxes = LAYER_INDICES.map((i) => $(`layer${i}`) as HTMLInputElement);
const layerVisible: boolean[] = LAYER_INDICES.map(() => true);
layerCheckboxes.forEach((cb, i) => {
  cb.addEventListener('change', () => {
    layerVisible[i] = cb.checked;
    if (currentBundle) renderCurrent();
  });
});

// --- GPU-Szene (einmalig) ------------------------------------------------

const renderer = new WebGLRenderer({ canvas: canvasGpu, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);
const scene = new Scene();
const bgGroup = new Group();
scene.add(bgGroup);

// --- Zustand ---------------------------------------------------------------

const entryByName = new Map<string, LgpEntry>();
let fieldNames: string[] = [];
let currentBundle: FieldBundle | null = null;
let currentFieldName = '';
let lastComposed: ComposedImage | null = null;
let lastStats: BackgroundStats = emptyStats();

interface BackgroundStats {
  field: string;
  layerTileCounts: Record<number, number>;
  paletteCount: number;
  texturePageCount: number;
  atlasCount: number;
  variantCount: number;
  issueCounts: Record<string, number>;
}

function emptyStats(): BackgroundStats {
  return { field: '', layerTileCounts: {}, paletteCount: 0, texturePageCount: 0, atlasCount: 0, variantCount: 0, issueCounts: {} };
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// --- Verzeichniswahl + Archivscan (Nutzergeste erforderlich) ---------------

$('pick').addEventListener('click', async () => {
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
      setStatus(`Archiv "flevel" ist unbrauchbar (fataler Scanfehler).`);
      return;
    }

    const entriesRes = await request({ kind: 'list-entries', archiveName: 'flevel' });
    if (entriesRes.kind !== 'result') throw new Error('Unerwartete Antwort beim Auflisten');
    const entries = entriesRes.payload as LgpEntry[];

    entryByName.clear();
    for (const e of entries) {
      if (!e.name.includes('.')) entryByName.set(e.name, e);
    }
    fieldNames = [...entryByName.keys()].sort((a, b) => a.localeCompare(b));
    populateSelect();
    setStatus(`Fertig — ${fieldNames.length} Fields gefunden (Archiv "flevel", ${entries.length} Einträge insgesamt).`);
  } catch (err) {
    setStatus(`Fehler: ${(err as Error).message}`);
  }
});

function populateSelect(): void {
  selectEl.innerHTML = fieldNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  selectEl.disabled = fieldNames.length === 0;
  loadBtn.disabled = fieldNames.length === 0;
}

loadBtn.addEventListener('click', () => {
  const name = selectEl.value;
  if (name) void loadField(name);
});

// --- Laden + Parsen ----------------------------------------------------

async function loadField(name: string): Promise<void> {
  const entry = entryByName.get(name);
  if (!entry) throw new Error(`Field "${name}" ist nicht bekannt — zuerst Verzeichnis wählen und scannen.`);

  setStatus(`Lade ${name} …`);
  const bytesRes = await request({ kind: 'read-entry', canonicalId: entry.canonicalId });
  if (bytesRes.kind !== 'bytes') throw new Error('Unerwartete Antwort beim Lesen des Eintrags');
  const bytes = new Uint8Array(bytesRes.payload);

  const parsed = parseFieldEntry(bytes, name);
  currentFieldName = name;
  if (!parsed.ok || !parsed.bundle) {
    currentBundle = null;
    lastComposed = null;
    clearViews();
    lastStats = { ...emptyStats(), field: name };
    const codes = parsed.diagnostics.map((d) => d.code).join(', ') || 'unbekannt';
    readoutEl.textContent = `Field "${name}" konnte nicht gelesen werden (LZS/Container fatal).\nDiagnosen: ${codes}`;
    setStatus(`Field "${name}" unbrauchbar.`);
    return;
  }

  currentBundle = parsed.bundle;
  renderCurrent();
  setStatus(`Field "${name}" geladen.`);
}

function clearViews(): void {
  canvas2d.width = 1;
  canvas2d.height = 1;
  ctx2d.clearRect(0, 0, 1, 1);
  bgGroup.clear();
  compositor.render(scene, new PerspectiveCamera(60, FIELD_ASPECT, NEAR, FAR));
}

// --- Rendern (2D-Referenz + GPU-Pfad) ---------------------------------------

function renderCurrent(): void {
  const bundle = currentBundle;
  if (!bundle) return;

  if (!bundle.background) {
    lastComposed = null;
    clearViews();
    lastStats = { ...emptyStats(), field: currentFieldName };
    readoutEl.textContent = `Field "${currentFieldName}": Sektion 9 (Hintergrund) fehlt oder ist quarantänisiert — nichts zu rendern.`;
    return;
  }
  const bg = bundle.background;
  const palette = bundle.palette;
  const activeLayers = LAYER_INDICES.filter((i) => layerVisible[i]);

  // --- 2D-Referenz ---
  const composeIssues: TileResolveIssue[] = [];
  const composed = composeBackgroundImage(bg, palette, { layers: [...activeLayers], issues: composeIssues });
  lastComposed = composed;
  if (composed.width > 0 && composed.height > 0) {
    canvas2d.width = composed.width;
    canvas2d.height = composed.height;
    const clamped = new Uint8ClampedArray(composed.rgba);
    ctx2d.putImageData(new ImageData(clamped, composed.width, composed.height), 0, 0);
  } else {
    canvas2d.width = 1;
    canvas2d.height = 1;
    ctx2d.clearRect(0, 0, 1, 1);
  }

  // --- GPU-Pfad ---
  const filteredBg: FieldBackground = { ...bg, layers: bg.layers.filter((l) => layerVisible[l.index] ?? true) };
  const fieldCamera = bundle.cameras?.cameras[0];
  const camera = fieldCamera
    ? buildFieldCamera(fieldCamera, { fovBase: FOV_BASE, near: NEAR, far: FAR })
    : new PerspectiveCamera(60, FIELD_ASPECT, NEAR, FAR);

  const built = buildFieldBackground(filteredBg, palette, { near: NEAR, far: FAR });
  bgGroup.clear();
  for (const mesh of built.meshes) bgGroup.add(mesh);
  compositor.render(scene, camera);

  // --- Ausleseleiste + Debug-Stats ---
  const layerTileCounts: Record<number, number> = {};
  for (const layer of bg.layers) layerTileCounts[layer.index] = layer.tiles.length;

  const issueCounts: Record<string, number> = {};
  for (const issue of [...composeIssues, ...built.atlas.issues]) {
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
  }

  lastStats = {
    field: currentFieldName,
    layerTileCounts,
    paletteCount: palette?.pages.length ?? 0,
    texturePageCount: bg.texturePages.length,
    atlasCount: built.atlas.atlases.length,
    variantCount: built.atlas.variantCount,
    issueCounts,
  };
  updateReadout(palette !== undefined, activeLayers);
}

function updateReadout(hasPalette: boolean, activeLayers: readonly number[]): void {
  const lines: string[] = [];
  lines.push(`Field            ${lastStats.field}`);
  lines.push(`Layer aktiv      ${activeLayers.join(', ') || '(keiner)'}`);
  lines.push(`Layer/Tiles      ${LAYER_INDICES.map((i) => `L${i}=${lastStats.layerTileCounts[i] ?? '–'}`).join('  ')}`);
  lines.push(`Palettenseiten   ${lastStats.paletteCount}${hasPalette ? '' : '  (Sektion fehlt — Tiles evtl. unauflösbar)'}`);
  lines.push(`Texturseiten     ${lastStats.texturePageCount}`);
  lines.push(`Atlanten         ${lastStats.atlasCount}`);
  lines.push(`Varianten        ${lastStats.variantCount}`);
  const issueEntries = Object.entries(lastStats.issueCounts);
  lines.push(
    `Issues           ${issueEntries.length ? issueEntries.map(([code, n]) => `${code}=${n}`).join('  ') : 'keine'}`,
  );
  readoutEl.textContent = lines.join('\n');
}

// --- Automatisierungshaken für die Browser-Verifikation ---------------------
// Hinweis: `listFields`/`stats`/`pixel` setzen einen vorherigen Verzeichnis-
// scan voraus (Nutzergeste, siehe Hinweistext) — `load` selbst kann danach
// beliebig oft ohne Nutzerinteraktion aufgerufen werden.

(window as unknown as { backgroundDebug: unknown }).backgroundDebug = {
  listFields: (): string[] => [...fieldNames],
  load: async (name: string): Promise<void> => {
    if (![...entryByName.keys()].includes(name)) {
      throw new Error(`Field "${name}" nicht in der Liste — zuerst Verzeichnis wählen.`);
    }
    selectEl.value = name;
    await loadField(name);
  },
  stats: (): object => ({
    field: lastStats.field,
    layerTileCounts: { ...lastStats.layerTileCounts },
    paletteCount: lastStats.paletteCount,
    texturePageCount: lastStats.texturePageCount,
    atlasCount: lastStats.atlasCount,
    variantCount: lastStats.variantCount,
    issueCounts: { ...lastStats.issueCounts },
  }),
  pixel: (x: number, y: number): [number, number, number, number] => {
    const d = ctx2d.getImageData(x, y, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
  },
};
