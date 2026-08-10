import { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { IoRequest, IoResponse, IoWorkerInit, OpenSourceResult } from '@webmidgar/io';
import type { LgpEntry } from '@webmidgar/formats-lgp';
import { parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { FIELD_ASPECT, ff7ToScene, type FovBase } from '@webmidgar/convert';
import { buildFieldBackground, buildFieldCamera, FieldCompositor } from '@webmidgar/render-field';
import {
  FieldSession,
  NEUTRAL_INPUT,
  InputRecorder,
  replayInputs,
  type FieldInput,
  type TickResult,
  type FieldChange,
  type FieldSessionSnapshot,
  type InputRecording,
} from '@webmidgar/field-runtime';
import { buildFallbackActor, type Actor } from '@webmidgar/render-actor';
import {
  DEFAULT_TOUCH_LAYOUT,
  GamepadFeed,
  InputSampler,
  KeyboardFeed,
  TouchFeed,
  defaultBindings,
  parseBindings,
  resolveTouchLayout,
  toFieldInput,
  type Viewport,
} from '@webmidgar/input';

/**
 * S11-Demo: Durchstich-Seite — ein echtes Field aus der lokalen Installation
 * wird begehbar. Die gesamte Spiellogik lebt in `FieldSession`
 * (`@webmidgar/field-runtime`); diese Seite sammelt nur Tastatureingaben,
 * ruft pro Takt genau einmal `session.tick(input)` mit fester Taktrate auf
 * und liest danach den Zustand für Szene und Ausleseleiste ab. Ausschließlich
 * lokal gelesene Originaldaten; nichts verlässt den Browser.
 */

const NEAR = 100;
const FAR = 10000;
const FOV_BASE: FovBase = 240; // realdaten-entschieden seit S9
const TICK_HZ = 30;
const TICK_DT_MS = 1000 / TICK_HZ;
const MAX_ACCUMULATOR_MS = 250; // Schutz vor „spiral of death“ nach Tab-Wechsel
const LOG_LINES = 8;
const SNAPSHOT_KEY = 'webmidgar:field-demo:snapshot';

// --- IO/Index-Worker (derselbe Pfad wie background-demo.ts) ----------------

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

// --- DOM ---------------------------------------------------------------------

const statusEl = $('status');
const pickBtn = $('pick') as HTMLButtonElement;
const selectEl = $('fieldSelect') as HTMLSelectElement;
const enterBtn = $('enter') as HTMLButtonElement;
const readoutEl = $('readout');
const canvas = $('view') as HTMLCanvasElement;
const dialogOverlayEl = $('dialogOverlay');
const fieldChangeBannerEl = $('fieldChangeBanner');
const fieldChangeTextEl = $('fieldChangeText');
const gotoTargetBtn = $('gotoTarget') as HTMLButtonElement;
const snapshotBtn = $('snapshot') as HTMLButtonElement;
const restoreBtn = $('restore') as HTMLButtonElement;
const recordBtn = $('record') as HTMLButtonElement;
const replayBtn = $('replay') as HTMLButtonElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// --- Szene (einmalig) ---------------------------------------------------------

const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);
const scene = new Scene();
const bgGroup = new Group();
const actorGroup = new Group();
scene.add(bgGroup);
scene.add(actorGroup);

const actor: Actor = buildFallbackActor();
actor.root.visible = false;
actorGroup.add(actor.root);

let camera: PerspectiveCamera | null = null;

// --- Zustand: Verzeichnis/Archiv ----------------------------------------------

const entryByName = new Map<string, LgpEntry>();
let fieldNames: string[] = [];

// --- Zustand: aktuelles Field --------------------------------------------------

let currentBundle: FieldBundle | null = null;
let currentFieldName = '';
let session: FieldSession | null = null;
let lastTileCount = 0;
let lastAtlasCount = 0;
let lastWarnings: string[] = [];

interface MoveEventCounters {
  crossed: number;
  slid: number;
  blocked: number;
  clamped: number;
}

let moveEventCounters: MoveEventCounters = { crossed: 0, slid: 0, blocked: 0, clamped: 0 };
let moveEventLog: string[] = [];
let triggerLog: string[] = [];
let activeTriggerIndices = new Set<number>();
let pendingFieldChange: FieldChange | null = null;
let dialogVisible = false;

// --- Zustand: Aufzeichnung/Replay ----------------------------------------------

let recorder: InputRecorder | null = null;
let recording = false;
interface RecordingCapture {
  recording: InputRecording;
  liveDigest: string;
}
let lastCapture: RecordingCapture | null = null;

// --- Verzeichniswahl + Archivscan (Nutzergeste erforderlich) ------------------

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
  enterBtn.disabled = fieldNames.length === 0;
}

enterBtn.addEventListener('click', () => {
  const name = selectEl.value;
  if (name) void enterField(name);
});

// --- Field betreten ------------------------------------------------------------

async function enterField(name: string): Promise<void> {
  const entry = entryByName.get(name);
  if (!entry) throw new Error(`Field "${name}" ist nicht bekannt — zuerst Verzeichnis wählen und scannen.`);

  setStatus(`Lade ${name} …`);
  const bytesRes = await request({ kind: 'read-entry', canonicalId: entry.canonicalId });
  if (bytesRes.kind !== 'bytes') throw new Error('Unerwartete Antwort beim Lesen des Eintrags');
  const bytes = new Uint8Array(bytesRes.payload);
  const parsed = parseFieldEntry(bytes, name);

  if (!parsed.ok || !parsed.bundle) {
    clearAll();
    const codes = parsed.diagnostics.map((d) => d.code).join(', ') || 'unbekannt';
    readoutEl.textContent = `Field "${name}" konnte nicht gelesen werden (LZS/Container fatal).\nDiagnosen: ${codes}`;
    setStatus(`Field "${name}" unbrauchbar.`);
    return;
  }

  const bundle = parsed.bundle;
  currentBundle = bundle;
  currentFieldName = name;
  stopRecordingSilently();
  lastCapture = null;

  const warnings: string[] = [];

  // --- Hintergrund ---
  bgGroup.clear();
  if (bundle.background) {
    const built = buildFieldBackground(bundle.background, bundle.palette, { near: NEAR, far: FAR });
    for (const mesh of built.meshes) bgGroup.add(mesh);
    lastTileCount = built.tileCount;
    lastAtlasCount = built.atlas.atlases.length;
  } else {
    lastTileCount = 0;
    lastAtlasCount = 0;
    warnings.push('Hintergrund (Sektion 9) fehlt oder ist quarantänisiert — die Szene bleibt schwarz.');
  }

  // --- Kamera ---
  const fieldCam = bundle.cameras?.cameras[0];
  if (fieldCam) {
    camera = buildFieldCamera(fieldCam, { fovBase: FOV_BASE, near: NEAR, far: FAR });
  } else {
    camera = new PerspectiveCamera(60, FIELD_ASPECT, NEAR, FAR);
    warnings.push('Kamera (Sektion 2) fehlt oder ist quarantänisiert — eine Platzhalterkamera wird verwendet.');
  }

  // --- Walkmesh ---
  if (!bundle.walkmesh) {
    warnings.push('Walkmesh (Sektion 5) fehlt oder ist quarantänisiert — das Field ist nicht begehbar, die Figur bleibt inaktiv.');
  }

  lastWarnings = warnings;
  resetRuntimeState(bundle);

  setStatus(`Field "${name}" betreten${warnings.length ? ` — ${warnings.length} Hinweis(e), siehe Ausleseleiste` : ''}.`);
}

function clearAll(): void {
  bgGroup.clear();
  camera = null;
  session = null;
  currentBundle = null;
  currentFieldName = '';
  lastTileCount = 0;
  lastAtlasCount = 0;
  lastWarnings = [];
  stopRecordingSilently();
  lastCapture = null;
  resetMotionState();
  updateActorFromPlayer();
  updateReadout();
}

function stopRecordingSilently(): void {
  recorder = null;
  recording = false;
  recordBtn.textContent = 'Aufzeichnung starten';
}

function resetMotionState(): void {
  moveEventCounters = { crossed: 0, slid: 0, blocked: 0, clamped: 0 };
  moveEventLog = [];
  triggerLog = [];
  activeTriggerIndices = new Set();
  pendingFieldChange = null;
  hideFieldChangeBanner();
  dialogVisible = false;
  hideDialog();
}

/** Frische `FieldSession` auf demselben Bundle — reproduzierbarer Startzustand. */
function resetRuntimeState(bundle: FieldBundle): void {
  session = new FieldSession(bundle);
  resetMotionState();
  accumulator = 0;
  lastFrameTime = performance.now();
  updateActorFromPlayer();
  updateReadout();
}

// --- Spielfigur ----------------------------------------------------------------

function updateActorFromPlayer(): void {
  const player = session?.player;
  if (!player) {
    actor.root.visible = false;
    return;
  }
  actor.root.visible = true;
  const scenePos = ff7ToScene([player.walk.x, player.walk.y, player.walk.height]);
  actor.root.position.set(scenePos[0], scenePos[1], scenePos[2]);
}

// --- Eingaben --------------------------------------------------------------------

// S27: Alle Quellen laufen über `@webmidgar/input` — diese Seite sammelt nur
// noch Roh-Ereignisse in die Feeds; abgetastet wird ausschließlich am Takt.
const BINDINGS_KEY = 'webmidgar:input:bindings';
const storedBindings = localStorage.getItem(BINDINGS_KEY);
const parsedBindings = storedBindings ? parseBindings(storedBindings) : null;
const bindings = parsedBindings?.ok && parsedBindings.table ? parsedBindings.table : defaultBindings();
if (parsedBindings && parsedBindings.diagnostics.length > 0) {
  console.warn('Eingabe-Belegung mit Diagnosen geladen:', parsedBindings.diagnostics);
}

const keyboardFeed = new KeyboardFeed();
const gamepadFeed = new GamepadFeed();

function currentViewport(): Viewport {
  const style = getComputedStyle(document.documentElement);
  const inset = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  // Maßgeblich ist der SICHTBARE Viewport: Auf Mobilgeräten zoomt der Browser
  // nicht-responsive Seiten heraus; `innerWidth/Height` beschreiben dann den
  // Layout-Viewport und das Overlay läge außerhalb des Sichtbaren.
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
    safeArea: {
      top: inset('--sat'),
      right: inset('--sar'),
      bottom: inset('--sab'),
      left: inset('--sal'),
    },
  };
}

const touchFeed = new TouchFeed(resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, currentViewport()));
const sampler = new InputSampler(bindings, [keyboardFeed, gamepadFeed, touchFeed]);

const HANDLED_CODES = new Set(Object.keys(bindings.field?.keyboard ?? {}));
window.addEventListener('keydown', (e) => {
  if (!HANDLED_CODES.has(e.code)) return;
  if (document.activeElement !== selectEl) e.preventDefault();
  keyboardFeed.handleKey(e.code, true);
});
window.addEventListener('keyup', (e) => {
  if (HANDLED_CODES.has(e.code)) keyboardFeed.handleKey(e.code, false);
});
// Fokusverlust: alles loslassen, sonst klemmen Tasten nach Alt+Tab für immer.
window.addEventListener('blur', () => keyboardFeed.clear());

window.addEventListener('gamepadconnected', () => gamepadFeed.setConnected(true));
window.addEventListener('gamepaddisconnected', () => gamepadFeed.setConnected(false));

/** Polling im rAF (die Gamepad API ist Poll-only); ausgewertet wird am Takt. */
function pollGamepad(): void {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = pads.find((p) => p !== null) ?? null;
  if (!pad) return;
  gamepadFeed.setState({
    buttons: pad.buttons.map((b) => b.pressed),
    axes: [...pad.axes],
  });
}

// Touch-Overlay: gezeichnet wird ausschließlich, was der Resolver liefert.
const touchOverlayEl = document.createElement('div');
touchOverlayEl.id = 'touch-overlay';
touchOverlayEl.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:40;display:none;';
document.body.appendChild(touchOverlayEl);
const touchCapable = window.matchMedia?.('(pointer: coarse)').matches ?? false;

function rebuildTouchOverlay(): void {
  const controls = resolveTouchLayout(DEFAULT_TOUCH_LAYOUT, currentViewport());
  touchFeed.updateLayout(controls);
  touchOverlayEl.replaceChildren(
    ...controls.map((c) => {
      const el = document.createElement('div');
      el.dataset['controlId'] = c.id;
      el.style.cssText =
        `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;` +
        `border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.12);` +
        `border-radius:${c.shape === 'circle' ? '50%' : '6px'};`;
      return el;
    }),
  );
  touchOverlayEl.style.display = touchCapable ? 'block' : 'none';
}
rebuildTouchOverlay();
window.addEventListener('resize', rebuildTouchOverlay);
window.visualViewport?.addEventListener('resize', rebuildTouchOverlay);
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') touchFeed.pointerDown(e.pointerId, e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') touchFeed.pointerMove(e.pointerId, e.clientX, e.clientY);
});
const releaseTouch = (e: PointerEvent): void => touchFeed.pointerUp(e.pointerId);
window.addEventListener('pointerup', releaseTouch);
window.addEventListener('pointercancel', releaseTouch);

// --- Spielschleife: fester Takt (30 Hz) über Akkumulator ------------------------

let accumulator = 0;
let lastFrameTime = performance.now();

function runTick(input: FieldInput): TickResult | null {
  if (!session) return null;
  const result = session.tick(input);
  if (recording && recorder) recorder.record(input);
  applyTickResult(result);
  return result;
}

function applyTickResult(result: TickResult): void {
  for (const e of result.moveEvents) {
    moveEventCounters[e.type]++;
    const edgeText = e.edge !== undefined ? ` Kante ${e.edge}` : '';
    moveEventLog.push(`#${result.tick} ${e.type} Tri${e.tri}${edgeText}`);
  }
  if (moveEventLog.length > LOG_LINES) moveEventLog = moveEventLog.slice(-LOG_LINES);

  for (const t of result.triggers) {
    triggerLog.push(`#${result.tick} ${t.kind} Trigger[${t.index}]`);
    if (t.kind === 'enter') activeTriggerIndices.add(t.index);
    else activeTriggerIndices.delete(t.index);
  }
  if (triggerLog.length > LOG_LINES) triggerLog = triggerLog.slice(-LOG_LINES);

  if (result.fieldChange) {
    pendingFieldChange = result.fieldChange;
    showFieldChangeBanner(result.fieldChange, result.tick);
  }

  if (result.confirmPressed) {
    dialogVisible = !dialogVisible;
    dialogOverlayEl.classList.toggle('visible', dialogVisible);
  }

  updateActorFromPlayer();
}

function frame(now: number): void {
  const delta = now - lastFrameTime;
  lastFrameTime = now;
  accumulator = Math.min(accumulator + delta, MAX_ACCUMULATOR_MS);
  pollGamepad();
  while (accumulator >= TICK_DT_MS) {
    if (session) runTick(toFieldInput(sampler.sampleTick()));
    accumulator -= TICK_DT_MS;
  }
  if (camera) compositor.render(scene, camera);
  updateReadout();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Zielfield-Meldung -----------------------------------------------------------

function showFieldChangeBanner(change: FieldChange, tick: number): void {
  fieldChangeTextEl.textContent =
    `Takt ${tick}: Gateway ${change.gatewayIndex} gequert → Ziel-Field-ID ${change.destMaplistIndex}, ` +
  fieldChangeBannerEl.classList.add('visible');
}

function hideFieldChangeBanner(): void {
  fieldChangeBannerEl.classList.remove('visible');
  fieldChangeTextEl.textContent = '';
}

gotoTargetBtn.addEventListener('click', () => {
  setStatus(
    'Zielfield wird NICHT automatisch geladen: die Auflösung von Ziel-Field-ID zu Feldname/-datei ist noch offen ' +
      'und wird hier nicht geraten (siehe destFieldId oben).',
  );
});

function hideDialog(): void {
  dialogOverlayEl.classList.remove('visible');
}

// --- Snapshot/Restore (localStorage, Uint8Array-sicher) ---------------------------

function serializeSnapshot(snap: FieldSessionSnapshot): string {
  return JSON.stringify(snap, (_key, value) =>
    value instanceof Uint8Array ? { __u8: Array.from(value) } : value,
  );
}

function deserializeSnapshot(text: string): FieldSessionSnapshot {
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object' && '__u8' in (value as Record<string, unknown>)) {
      const arr = (value as { __u8: unknown }).__u8;
      if (Array.isArray(arr)) return new Uint8Array(arr as number[]);
    }
    return value;
  }) as FieldSessionSnapshot;
}

snapshotBtn.addEventListener('click', () => {
  if (!session) {
    setStatus('Kein Field betreten — kein Snapshot möglich.');
    return;
  }
  const snap = session.snapshot();
  localStorage.setItem(SNAPSHOT_KEY, serializeSnapshot(snap));
  setStatus(`Snapshot gespeichert (Takt ${snap.tick}, Field "${snap.fieldId}").`);
});

restoreBtn.addEventListener('click', () => {
  if (!session) {
    setStatus('Kein Field betreten — kein Restore möglich.');
    return;
  }
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) {
    setStatus('Kein Snapshot im lokalen Speicher.');
    return;
  }
  let snap: FieldSessionSnapshot;
  try {
    snap = deserializeSnapshot(raw);
  } catch (err) {
    setStatus(`Snapshot nicht lesbar: ${(err as Error).message}`);
    return;
  }
  const result = session.restore(snap);
  if (!result.ok) {
    setStatus(`Restore fehlgeschlagen: ${result.reason ?? 'unbekannt'}`);
    return;
  }
  resetMotionState(); // Trigger-/Bewegungslog gehört zum verworfenen Live-Verlauf, nicht zum Snapshot.
  updateActorFromPlayer();
  updateReadout();
  const warnText = result.warnings.length ? ` — Warnungen: ${result.warnings.join('; ')}` : '';
  setStatus(`Snapshot wiederhergestellt (Takt ${snap.tick}).${warnText}`);
});

// --- Aufzeichnung/Replay -----------------------------------------------------------

recordBtn.addEventListener('click', () => {
  if (!currentBundle) {
    setStatus('Kein Field betreten.');
    return;
  }
  if (!recording) {
    // Reproduzierbarer Startzustand: Aufzeichnung beginnt auf einer frischen
    // Sitzung, damit "Replay prüfen" später auf einer ebenfalls frischen
    // Sitzung bitidentisch vergleichen kann.
    resetRuntimeState(currentBundle);
    recorder = new InputRecorder(session!.fieldId);
    recording = true;
    recordBtn.textContent = 'Aufzeichnung stoppen';
    setStatus('Aufzeichnung gestartet — Sitzung wurde für einen reproduzierbaren Startzustand zurückgesetzt.');
  } else {
    const finished = recorder!.finish();
    lastCapture = { recording: finished, liveDigest: session!.digest() };
    recorder = null;
    recording = false;
    recordBtn.textContent = 'Aufzeichnung starten';
    setStatus(`Aufzeichnung beendet — ${finished.ticks} Takte, ${finished.frames.length} mit Eingabe.`);
  }
});

function checkReplay(): { ok: boolean; live: string; replay: string } {
  if (!currentBundle || !lastCapture) {
    throw new Error('Keine abgeschlossene Aufzeichnung vorhanden — zuerst aufzeichnen und stoppen.');
  }
  const result = replayInputs(currentBundle, lastCapture.recording);
  return { ok: result.digest === lastCapture.liveDigest, live: lastCapture.liveDigest, replay: result.digest };
}

replayBtn.addEventListener('click', () => {
  try {
    const r = checkReplay();
    setStatus(
      r.ok
        ? `Replay OK — Digest stimmt mit dem Live-Lauf überein (${r.live}).`
        : `Replay WEICHT AB — live=${r.live}  replay=${r.replay}`,
    );
  } catch (err) {
    setStatus((err as Error).message);
  }
});

// --- Ausleseleiste -----------------------------------------------------------------

function updateReadout(): void {
  const lines: string[] = [];
  const player = session?.player ?? null;

  lines.push(`Field            ${currentFieldName || '(keins)'}`);
  lines.push(`Takt             ${session?.tickCounter ?? 0}`);
  lines.push(
    `Dreieck/Position ${
      player
        ? `Tri=${player.walk.tri}  x=${player.walk.x.toFixed(1)}  y=${player.walk.y.toFixed(1)}  z=${player.walk.height.toFixed(1)}`
        : '(keine Figur — Field nicht betreten oder Walkmesh fehlt)'
    }`,
  );
  lines.push(`Tiles/Atlanten   ${lastTileCount} Tiles, ${lastAtlasCount} Atlanten`);
  lines.push(
    `Trigger aktiv    ${activeTriggerIndices.size ? [...activeTriggerIndices].sort((a, b) => a - b).join(', ') : '(keine)'}`,
  );
  lines.push(
    `Bewegung         crossed=${moveEventCounters.crossed}  slid=${moveEventCounters.slid}  ` +
      `blocked=${moveEventCounters.blocked}  clamped=${moveEventCounters.clamped}`,
  );
  lines.push('Letzte Bewegungsereignisse:');
  lines.push(...(moveEventLog.length ? moveEventLog.map((l) => `  ${l}`) : ['  (keine)']));
  if (triggerLog.length) {
    lines.push('Letzte Triggerereignisse:');
    lines.push(...triggerLog.map((l) => `  ${l}`));
  }
  if (lastWarnings.length) {
    lines.push('Hinweise:');
    lines.push(...lastWarnings.map((w) => `  - ${w}`));
  }
  lines.push(`Aufzeichnung     ${recording ? 'läuft' : lastCapture ? 'gestoppt (bereit für Replay)' : '(keine)'}`);
  lines.push(`Digest           ${session ? session.digest() : '(keine Sitzung)'}`);

  readoutEl.textContent = lines.join('\n');
}

// --- Automatisierungshaken für die Browser-Verifikation ---------------------------
// Hinweis: Verzeichniswahl bleibt Nutzergeste (siehe Hinweistext) — der
// übrige Ablauf ist danach beliebig oft ohne Nutzerinteraktion aufrufbar.

function computeStats(): object {
  const player = session?.player ?? null;
  return {
    field: currentFieldName,
    tick: session?.tickCounter ?? 0,
    tri: player?.walk.tri ?? null,
    x: player?.walk.x ?? null,
    y: player?.walk.y ?? null,
    height: player?.walk.height ?? null,
    tileCount: lastTileCount,
    atlasCount: lastAtlasCount,
    activeTriggers: [...activeTriggerIndices].sort((a, b) => a - b),
    moveEventCounters: { ...moveEventCounters },
    pendingFieldChange: pendingFieldChange ? { ...pendingFieldChange } : null,
    dialogVisible,
    recording,
    hasCapture: lastCapture !== null,
    warnings: [...lastWarnings],
  };
}

(window as unknown as { fieldDemoDebug: unknown }).fieldDemoDebug = {
  listFields: (): string[] => [...fieldNames],
  enter: async (name: string): Promise<void> => {
    if (!entryByName.has(name)) {
      throw new Error(`Field "${name}" nicht in der Liste — zuerst Verzeichnis wählen.`);
    }
    selectEl.value = name;
    await enterField(name);
  },
  step: (input: Partial<FieldInput>, times = 1): void => {
    if (!session) throw new Error('Kein Field betreten.');
    const full: FieldInput = { ...NEUTRAL_INPUT, ...input };
    for (let i = 0; i < times; i++) runTick(full);
    if (camera) compositor.render(scene, camera);
    updateReadout();
  },
  stats: (): object => computeStats(),
  digest: (): string => (session ? session.digest() : ''),
  checkReplay: (): { ok: boolean; live: string; replay: string } => checkReplay(),
};
