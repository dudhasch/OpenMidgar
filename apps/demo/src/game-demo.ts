import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  WebGLRenderer,
} from 'three';
import { FIELD_ASPECT, ff7ToScene, type FovBase } from '@webmidgar/convert';
import { buildFieldBackground, buildFieldCamera, FieldCompositor } from '@webmidgar/render-field';
import {
  FieldSession,
  NEUTRAL_INPUT,
  planTransition,
  type FieldChange,
  type FieldInput,
  type FieldSessionSnapshot,
  type TickResult,
} from '@webmidgar/field-runtime';
import { resolveFieldMusic, type FieldBundle, type FieldDiagnostic } from '@webmidgar/formats-field';
import { berechneAnfangsBgStates, regionBuffers, type HostRequest } from '@webmidgar/interpreter';
import { MusicRuntime, planLoop } from '@webmidgar/audio';
import {
  applyWindowSkin,
  windowSkinCss,
  windowOuterSize,
  FF7_WINDOW_SKIN,
  RENDER_SURFACE,
  WindowDisplayMode,
  WindowShell,
  paintGlyphText,
  type FontContext,
} from '@webmidgar/ui-window';
import { measureFfWindow, FALLBACK_SPACING } from '@webmidgar/formats-kernel';
import {
  buildFallbackActor,
  createActorLibrary,
  setActorFacing,
  type Actor,
  type ActorLibrary,
  type FieldActorHandle,
} from '@webmidgar/render-actor';
import { fieldTblEntryForOpcode, WORLD_GRIDS } from '@webmidgar/formats-world';
import {
  WorldSession,
  toWorldInput,
  type WorldLocation,
  type WorldTickResult,
} from '@webmidgar/world-runtime';
import {
  buildTexturedMeshGeometry,
  followCameraPose,
  sampleGround,
  WorldStreamer,
} from '@webmidgar/render-world';
import {
  defaultBindings,
  InputSampler,
  KeyboardFeed,
  toFieldInput,
  type ActionFrame,
  type InputContextId,
  type SemanticAction,
} from '@webmidgar/input';
import {
  BATTLE_TICK_HZ,
  applyExperience,
  createEncounterBattleStarter,
  defaultParty,
  encodeOutcome,
  expTotalForLevel,
  isBattleTickDue,
  partyFromSavemap,
  type BattleSession,
  type BattleStarter,
  type BattleTickInput,
  type CharacterProgress,
  type PartyMemberSpec,
} from '@webmidgar/battle-runtime';
import {
  BattleViewModel,
  applyBattleCamera,
  buildBattleActor,
  buildBattleStage,
  buildSubstituteStage,
  loadBattleModel,
  loadBattleStage,
  parseCameraBlock,
  partyModelByPrefix,
  partyModelPrefix,
  placeFormation,
  placeParty,
  stagePrefixForLocation,
} from '@webmidgar/render-battle';
import {
  ATB_MAX,
  DEFAULT_COMMANDS,
  domPaintHost,
  hudBoxes,
  paintBoxes,
  resultBoxes,
  resultMessages,
  type HudBox,
  type HudFloater,
  type HudModel,
  type PaintHost,
  type ResultScreenModel,
} from '@webmidgar/ui-battle-hud';
import { enemyModelPrefix, formationAddress, parseGrowthSection, type GrowthSection } from '@webmidgar/formats-battle';
import { Box3, BoxGeometry, Vector3 } from 'three';
import {
  MenuSession,
  NEUTRAL_MENU_INPUT,
  VIEW_ORDER,
  type MenuData,
  type MenuInput,
  type MenuActionHost,
  type MenuScreen,
  type MenuViewId,
  type SaveSlotChoice,
} from '@webmidgar/menu';
import {
  formatPlaytime,
  readSavemap,
  SaveSlotStore,
  SAVE_SCHEMA_VERSION,
  type Savemap,
  type SaveSlot,
} from '@webmidgar/formats-save';
import { composeSavemapSlot, type FixtureSavemap } from '@webmidgar/fixture-gen';
import { CURSOR_SPALTE } from '@webmidgar/menu';
import { bootGameData, type GameData } from './game/data';
import { buildFontContext } from './game/font';

/**
 * 1.0-Integration: EINE Seite, die Field, Weltkarte, Kampf und Menü zu einem
 * spielbaren Ganzen verbindet. Spiellogik lebt ausschließlich in den Paketen
 * (FieldSession/WorldSession/BattleSession); diese Seite ist Schale und
 * Modus-Router: Eingaben sammeln, am Takt abtasten, Ergebnisse darstellen,
 * Host-Requests zwischen den Sitzungen vermitteln.
 *
 * Datenquelle im Dev-Betrieb: `/ff7data` (s. ff7data-plugin.ts) — dadurch ist
 * die Seite ohne Nutzergeste automatisierbar (`window.gameDebug`).
 */

const NEAR = 100;
const FAR = 10000;
const FOV_BASE: FovBase = 240;
const TICK_HZ = 30;
const TICK_DT_MS = 1000 / TICK_HZ;
const MAX_ACCUMULATOR_MS = 250;
const START_FIELD_DEFAULT = 'md1stin';
const LOG_LINES = 8;

// --- DOM -----------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id)!;
const statusEl = $('status');
const selectEl = $('fieldSelect') as HTMLSelectElement;
const enterBtn = $('enter') as HTMLButtonElement;
const toWorldBtn = $('toWorld') as HTMLButtonElement;
const readoutEl = $('readout');
const canvas = $('view') as HTMLCanvasElement;
const dialogOverlayEl = $('dialogOverlay');
const dialogBoxEl = $('dialogBox');
const battleOverlayEl = $('battleOverlay');
const resultOverlayEl = $('resultOverlay');
const menuOverlayEl = $('menuOverlay');

/**
 * Gemeinsame Fensterschale (Welle 2). Die Optik des Dialogfensters kommt
 * nicht mehr aus dem <style>-Block, sondern aus @webmidgar/ui-window —
 * dieselbe Quelle, die Menü und Kampf-HUD später benutzen.
 * Der Nachweis, dass das pixelgleich ist: apps/demo/window-skin.html.
 */
applyWindowSkin(dialogBoxEl, WindowDisplayMode.Normal);

/**
 * Fensterverwaltung als Zustand. Heute setzt sie nur der Dialog; sobald der
 * Interpreter WMODE/WCLSE anschließt, schreibt er hier hinein und die UI
 * liest ab (siehe packages/ui-window/src/shell.ts).
 */
const windowShell = new WindowShell();
/** Slot 0 = Dialogfenster des Fields. */
const DIALOG_SLOT = 0;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// --- Renderer + Szenen -----------------------------------------------------------

const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const compositor = new FieldCompositor(renderer);

const fieldScene = new Scene();
const bgGroup = new Group();
const actorGroup = new Group();
fieldScene.add(bgGroup, actorGroup);
let fieldCamera: PerspectiveCamera | null = null;

const worldScene = new Scene();
worldScene.add(new DirectionalLight(0xffffff, 2.2).translateY(1).translateX(0.4));
const worldCamera = new PerspectiveCamera(55, canvas.width / canvas.height, 100, 400000);
const worldTerrainGroup = new Group();
const worldMarkerGroup = new Group();
worldScene.add(worldTerrainGroup, worldMarkerGroup);

// --- Zustand ---------------------------------------------------------------------

type Mode = 'boot' | 'field' | 'world';
let mode: Mode = 'boot';
let data: GameData | null = null;
/**
 * Welle 3: die Spielschrift. `null` heißt Systemschrift — der Bootlog sagt
 * dann, warum (fehlende `WINDOW.BIN`, unlesbares Fontblatt).
 */
let fontKontext: FontContext | null = null;

// Field
let fieldSession: FieldSession | null = null;
let fieldBundle: FieldBundle | null = null;
let fieldName = '';
let fieldWarnings: string[] = [];
let transitioning = false;
/**
 * Ruhe-, Geh- und Rennanimation eines Feldmodells.
 *
 * 🟢 **Belegt** (Makou Reactor, FieldModelLoaderPS.cpp): Für Hauptcharakter-
 * Modelle sind die ersten drei Animations-Slots Stehen/Gehen/Rennen —
 * Cloud AAAA.HRC → ACFE/AAFF/AAGA, im Code kommentiert „Standing, walking,
 * running".
 *
 * Wichtig bleibt, dass überhaupt EINE Animation gesetzt wird: ohne sie
 * lief jede Figur in der Bindpose, und die ist keine Standhaltung, sondern die
 * unposierte Bone-Kette — die Figuren lagen flach am Boden (F21).
 */
const ANIM_STEHEN = 0;
const ANIM_GEHEN = 1;
const ANIM_RENNEN = 2;
/** F21-Diagnose: übersprungene Modell-Teilressourcen, gezählt je Name. */
const modellFehlstellen = new Map<
  string,
  { model: string; kind: 'hrc' | 'rsd' | 'p' | 'tex' | 'texSlot'; name: string; anzahl: number }
>();
const playerActor: Actor = buildFallbackActor();
playerActor.root.visible = false;
actorGroup.add(playerActor.root);
const npcActors = new Map<number, Actor>();
// Echte Modelle (S10-Manifest + char.lgp): je Interpreter-Actor ein Handle.
let actorLib: ActorLibrary | null = null;
let modelGeneration = 0; // entwertet verspätete Ladeergebnisse nach Field-Wechsel
const actorHandles = new Map<number, FieldActorHandle>();
let playerHandle: FieldActorHandle | null = null;
/** F28-Kalibrierung: Zusatzfaktor auf den Figurenmaßstab (1 = wie geladen). */
let figurSkala = 1;
/** Animierte Hintergrundgruppen des aktuellen Fields (F22). */
let hintergrundAnim: {
  gruppen: { param: number; state: number; meshes: Mesh[] }[];
  zustaende: Map<number, number[]>;
  takt: number;
} | null = null;
/** Zuletzt gesetzte Spieleranimation und Vorposition (Gehen/Stehen, F21). */
let spielerAnim: number | null = null;
let letzteSpielerPos: [number, number] | null = null;
/** F36: Figuren erst zeigen, wenn ihre Animation gebunden ist (sonst Bindpose = liegend). */
const animBereit = new Set<number>();
let spielerBereit = false;
const actorAnimState = new Map<number, string>(); // zuletzt gesetzte Animation je Actor ("id|speed|loop")

// World
let worldSession: WorldSession | null = null;
const GRID = WORLD_GRIDS.wm0;
const streamer = new WorldStreamer(GRID, 1);
const residentBlocks = new Map<string, Group>();
const KLASSENFARBEN = Array.from({ length: 32 }, (_, i) => new Color().setHSL((i * 0.618034) % 1, 0.55, 0.45));
const playerMarker = new Mesh(new ConeGeometry(600, 1800, 8), new MeshBasicMaterial({ color: 0xff4444 }));
playerMarker.rotation.x = Math.PI; // Spitze nach unten auf die Position
worldScene.add(playerMarker);
let worldEncounterChecks = 0;
let lastWorldResult: WorldTickResult | null = null;

// Battle (echt): eigene Szene + Kamera aus dem Formations-Kamerablock.
const battleScene3 = new Scene();
battleScene3.add(new DirectionalLight(0xffffff, 2.0).translateY(1));
const battleGroup = new Group();
battleScene3.add(battleGroup);
/**
 * K5 — die Bühne hängt am KAMPF, nicht am Programm: welche der 90 Bühnen
 * (`og`…`rr`) gilt, entscheidet `location` der Formation. Die schwarze
 * Ersatzscheibe bleibt als Rückfall, kommt im Originalbestand aber nicht vor
 * (1000/1000 Formationen lösen auf).
 */
let stageGroup: Group | null = null;
/** K5-Prüfgröße: welche Bühne zu welcher `location` gebaut wurde. */
let stageProtokoll: {
  prefix: string | null;
  location: number | null;
  teile: number;
  texturen: number;
  ersatz: boolean;
} = { prefix: null, location: null, teile: 0, texturen: 0, ersatz: true };

function setzeBuehne(gruppe: Group | null): void {
  if (stageGroup) battleScene3.remove(stageGroup);
  stageGroup = gruppe;
  if (gruppe) battleScene3.add(gruppe);
}
const battleCamera = new PerspectiveCamera(50, canvas.width / canvas.height, 10, 200000);
let partySpecs: PartyMemberSpec[] = [];
let battleStarter: BattleStarter | null = null;
let battleGen = 0;
/** K1/K2-Prüfgröße: geladene Teile/Texturen je Battle-Präfix (`gameDebug.battleModelle`). */
const battleModellProtokoll = new Map<
  string,
  { prefix: string; teile: number; texturen: number; eintraege: number }
>();

interface RealBattle {
  session: BattleSession;
  /**
   * K7: die wirkungsfreie Projektionsschicht (S32). Sie war gebaut, aber
   * NIRGENDS angeschlossen — Trefferzahlen und Ersatzdarstellung erschienen
   * nie. Jetzt bekommt sie jedes Tick-Ergebnis und speist das HUD.
   * Rückkanal gibt es weiterhin keinen: der Digest bleibt unberührt.
   */
  view: BattleViewModel;
  requestId: number | null;
  source: 'field' | 'world';
  encounterId: number;
  partyIds: string[];
  enemyIds: string[];
  maxHp: Map<string, number>;
  maxMp: Map<string, number>;
  awaiting: string[];
  eventLog: string[];
  outcomeKind: string | null;
  rewards: { exp: number; ap: number; gil: number; drops: number[] } | null;
  /** Kommandofenster: gewählter Eintrag und Zeile, an der es hängt. */
  commandIndex: number;
  /** Meldungsfenster über der Bühne, mit Restlaufzeit in Kampftakten. */
  message: string;
  messageTicks: number;
  /** Ergebnisbildschirm (N7); solange null, läuft der Kampf. */
  result: ResultScreenModel | null;
  resultPage: number;
}
let battle: RealBattle | null = null;
/** Maler des Kampf-HUD bzw. des Ergebnisbildschirms (je ein Kastenbestand). */
const hudHost: PaintHost = domPaintHost(battleOverlayEl as unknown as Parameters<typeof domPaintHost>[0]);
const resultHost: PaintHost = domPaintHost(resultOverlayEl as unknown as Parameters<typeof domPaintHost>[0]);
/**
 * DERSELBE Maler für das Menü. Drei Bereiche, eine Rezeptur: Kastenliste aus
 * dem Paket, `paintBoxes` setzt sie, `applyWindowSkin` gibt die Optik.
 */
const menuHost: PaintHost = domPaintHost(menuOverlayEl as unknown as Parameters<typeof domPaintHost>[0]);
/** Growth-Sektion aus KERNEL.BIN — Grundlage der EXP-Verbuchung (S33). */
let growth: GrowthSection | null = null;
/** Fortschritt je Gruppenmitglied; überlebt den einzelnen Kampf. */
const progressById = new Map<string, CharacterProgress>();

// 🔵 Weltkarten-Begegnungstabellen sind 🔴 (S29/S33) — Demo-Ersatz-ID.
const WORLD_DEMO_ENCOUNTER = 303;

// Overlays
interface BattleStub {
  encounterId: number;
  requestId: number | null; // null = Zufallskampf ohne Script-Warteschleife? (immer gesetzt laut HostRequest)
  source: 'field' | 'world';
}
let battleStub: BattleStub | null = null;
let menuSession: MenuSession | null = null;
let menuHostRequestId: number | null = null;
let dialogVisibleId: number | null = null;

/**
 * Musik (AUD-1/F09-A/F09-D): der Wiedergabepfad läuft jetzt über
 * `@webmidgar/audio` statt über ein eigenes `HTMLAudioElement`.
 *
 * Drei Defekte fallen damit zusammen weg:
 *
 * **AUD-1** — die Engine war gebaut, aber im laufenden Programm nicht
 * verdrahtet. Jetzt ist `MusicRuntime` der einzige Wiedergabeweg; der
 * Kommandozustand aus `engine.ts` ist die einzige Wahrheit darüber, was klingt.
 *
 * **F09-D** — die alte Wache `if (!name || currentMusic === name) return;`
 * setzte den „laufenden Titel" VOR dem `play()` und schluckte die Ablehnung der
 * Autoplay-Politik. War der erste Versuch abgelehnt, blieb der Titel für den
 * Rest der Sitzung stumm, weil jede spätere Anforderung an der Wache abprallte.
 * Das Gate-Modell kennt dafür den Zustand `suspended`: ein `play-music` vor der
 * Nutzergeste ist eine **Vormerkung**, kein Fehlschlag — `resume()` holt sie nach.
 *
 * **F09-E** — `<audio loop>` kann nur die ganze Datei wiederholen; 87 % der
 * Titel tragen `LOOPSTART`. `MusicRuntime` setzt `loopStart`/`loopEnd` am
 * `AudioBufferSourceNode`, das Intro läuft also genau einmal.
 *
 * 🔵 Kampf-/Sieg-Titel bleiben Demo-Konvention („bat"/„fanfare"), werden aber
 * über `music.idx` in eine musicId übersetzt, weil die Laufzeit mit IDs arbeitet.
 */
const audioCtx: AudioContext | null = typeof AudioContext === 'undefined' ? null : new AudioContext();

/** musicId ist 1-basiert, `music.idx` 0-basiert (S37) — die Umrechnung bleibt. */
async function loadTrack(musicId: number): Promise<Uint8Array | null> {
  const name = data?.musicNames[musicId - 1];
  if (!name) return null;
  const res = await fetch(`/ff7data/data/music_ogg/${name}.ogg`);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

const music: MusicRuntime | null = audioCtx
  ? new MusicRuntime({ context: audioCtx, loadTrack, ticksPerSecond: TICK_HZ, onDiagnostic: log })
  : null;

/**
 * Platzhalter im Kommandomodell. Der ECHTE Schleifenplan wird erst nach dem
 * Dekodieren aus den OGG-Tags gerechnet (`planLoop` braucht `totalSamples`),
 * und `MusicRuntime` ignoriert dieses Feld bewusst. Hier nichts erraten.
 */
const PLATZHALTER_PLAN = planLoop({ loopStart: null, loopLength: null, keys: [] }, null);

/** Zuletzt aufgelöste Field-Musik (zum Zurückschalten nach dem Kampf). */
let fieldMusicId: number | null = null;
/** Protokoll der MUSIC-Kette je Aufruf — Prüfgröße für `gameDebug.musik()`. */
interface MusikAufloesung {
  field: string;
  operand: number;
  musicId: number | null;
  musicIndex: number | null;
  name: string | null;
  reason: string;
  diagnosen: string[];
  /** Wie oft dieselbe Auflösung unmittelbar hintereinander kam (Script-Schleife). */
  wiederholungen: number;
}
const musikProtokoll: MusikAufloesung[] = [];

function musicIdByName(name: string): number | null {
  const i = data?.musicNames.indexOf(name) ?? -1;
  return i < 0 ? null : i + 1;
}

/**
 * Startet einen Titel — es sei denn, er läuft **nachweislich** schon.
 *
 * Die Wache prüft `state.currentTrack`, also das, was `applyAudioCommand`
 * TATSÄCHLICH ausgeführt hat. Das ist der Unterschied zur alten F09-D-Wache:
 * die merkte sich den Wunsch vor dem Abspielen und verschluckte die Ablehnung,
 * hier bleibt `currentTrack` vor der Nutzergeste `null` — eine Vormerkung wird
 * also niemals als „läuft schon" missdeutet.
 *
 * Ohne diese Wache wäre der Titel nicht stumm, sondern das Gegenteil: gemessen
 * setzt `md1_1` den MUSIC-Opcode in 120 Takten 32-mal ab (das Script läuft in
 * einer Schleife), und jeder Aufruf würde die Quelle neu starten.
 */
function spieleMusikId(musicId: number | null, once = false): void {
  if (musicId === null || !music) return;
  if (music.state.currentTrack === musicId) return;
  void music.dispatch({ kind: 'play-music', trackId: musicId, loop: PLATZHALTER_PLAN, once });
}

/**
 * Nutzergeste ⇒ Freigabe. `resumeAudio` holt den Stau in Reihenfolge nach; ein
 * vor der Geste angefordertes `play-music` geht also NICHT verloren. Mehrfache
 * Aufrufe sind wirkungslos (leerer Stau ⇒ kein Kommando im Protokoll).
 */
function audioFreigeben(): void {
  if (!music) return;
  void (audioCtx as unknown as { resume?: () => Promise<void> })?.resume?.();
  void music.resume();
}
window.addEventListener('pointerdown', audioFreigeben);

// Log
let hostLog: string[] = [];
function log(line: string): void {
  hostLog.push(line);
  if (hostLog.length > LOG_LINES) hostLog = hostLog.slice(-LOG_LINES);
}

// --- Eingabe ---------------------------------------------------------------------

const bindings = defaultBindings();
const keyboardFeed = new KeyboardFeed();
const sampler = new InputSampler(bindings, [keyboardFeed]);

const HANDLED_CODES = new Set<string>();
for (const ctx of Object.values(bindings)) {
  if (ctx) for (const code of Object.keys(ctx.keyboard)) HANDLED_CODES.add(code);
}
window.addEventListener('keydown', (e) => {
  audioFreigeben(); // F09-D: erste Nutzergeste gibt den Ton frei, egal welche Taste
  if (e.code === 'F9') {
    e.preventDefault();
    toggleWorld();
    return;
  }
  /**
   * Schnellspeichern und -laden auf Platz 0 (F07). Das Menü kann speichern,
   * aber nicht laden — das Original hat im Hauptmenü keinen Ladepunkt, und
   * einen zu erfinden wäre eine Ansicht ohne Vorbild. Zwei Tasten sind hier
   * die ehrlichere Lösung als ein erfundener Menüeintrag.
   */
  if (e.code === 'F6' || e.code === 'F7') {
    e.preventDefault();
    const tat = e.code === 'F6' ? spielstandSchreiben(0) : spielstandLaden(0);
    void tat.then((text) => {
      log(text);
      setStatus(text);
    });
    return;
  }
  // T blättert durch die drei Weltkarten-Darstellungsarten (F11b/F25). Die
  // beiden Diagnosearten bleiben erreichbar — sie sind ein Werkzeug.
  if (e.code === 'KeyT' && mode === 'world') {
    e.preventDefault();
    const folge: WeltDarstellung[] = ['textured', 'terrain', 'region'];
    setzeWeltDarstellung(folge[(folge.indexOf(weltDarstellung) + 1) % folge.length]!);
    return;
  }
  if (!HANDLED_CODES.has(e.code)) return;
  if (document.activeElement !== selectEl) e.preventDefault();
  keyboardFeed.handleKey(e.code, true);
});
window.addEventListener('keyup', (e) => {
  if (HANDLED_CODES.has(e.code)) keyboardFeed.handleKey(e.code, false);
});
window.addEventListener('blur', () => keyboardFeed.clear());

/** Aktiver Eingabekontext dieses Takts (Overlays haben Vorrang vor dem Modus). */
function activeContext(): InputContextId {
  if (battle) return 'battle';
  if (battleStub) return 'menu'; // 🔵 Ersatz für den Stub-Pfad
  if (menuSession) return 'menu';
  if (dialogVisibleId !== null) return 'dialog';
  return mode === 'world' ? 'world' : 'field';
}

// --- Menü-Overlay ----------------------------------------------------------------

const MENU_FIXTURE: FixtureSavemap = {
  characters: [
    { id: 0, name: 'Wolke', level: 7, hp: 314, hpMax: 314, mp: 54, mpMax: 54, stats: [20, 16, 19, 17, 14, 14] },
  ],
  party: [0, null, null],
  inventory: [{ itemId: 0, count: 2 }],
  gil: 200,
  playtimeSeconds: 0,
};

function menuData(): MenuData {
  return {
    /**
     * `savemapAktuell` statt `data.savemap`: Seit Welle 4 verändert das Menü
     * den Stand (F07). Wer hier die Ladefassung nähme, zeigte nach jedem
     * Ausrüsten wieder die alte Ausrüstung — die Handlung liefe ins Leere,
     * ohne dass irgendetwas fehlschlüge.
     */
    savemap: savemapAktuell ?? readSavemap(composeSavemapSlot(MENU_FIXTURE))!,
    itemName: data?.itemName ?? (() => null),
    itemDescription: data?.itemDescription,
    materiaName: data?.materiaName,
    magicName: data?.magicName,
    materiaRecords: data?.materiaRecords,
    spacing: data?.textMetrik.spacing,
    metricsMeasured: data?.textMetrik.measured ?? false,
    metricsDiagnostic: data?.textMetrik.diagnostic ?? null,
    /**
     * Nur noch **Ersatz**: `resolveLocation` bevorzugt den Ortsnamen aus der
     * Savemap (0x0F0C, ersatzweise Vorschaublock) und macht sichtbar, wenn es
     * doch der Wirt war, der ihn geliefert hat.
     */
    locationName: mode === 'world' ? 'Weltkarte' : fieldName || null,
  };
}

// --- Spielstand: Wirt der Menü-Handlungen und Speicherplätze (F07) ---------------

/**
 * Die laufenden Spielstandsbytes. Sie starten als Kopie aus der Installation
 * (`data.savemapRaw`) und werden ab hier vom Menü verändert — die Datei des
 * Nutzers wird nie geschrieben.
 */
let savemapBytes: Uint8Array | null = null;
let savemapAktuell: Savemap | null = null;

/** Wie viele Plätze die Speicheransicht anbietet. */
const SPEICHERPLAETZE = 4;

const saveStore = new SaveSlotStore();
let saveStoreBereit = false;
let saveUebersicht: SaveSlotChoice[] = Array.from({ length: SPEICHERPLAETZE }, (_, i) => ({
  index: i,
  label: 'Leer',
  belegt: false,
}));

async function saveStoreOeffnen(): Promise<boolean> {
  if (saveStoreBereit) return true;
  try {
    await saveStore.open();
    saveStoreBereit = true;
    await saveUebersichtAktualisieren();
    return true;
  } catch (err) {
    log(`Spielstandspeicher nicht verfügbar: ${String(err)}`);
    return false;
  }
}

async function saveUebersichtAktualisieren(): Promise<void> {
  if (!saveStoreBereit) return;
  const belegt = await saveStore.list(SPEICHERPLAETZE);
  saveUebersicht = Array.from({ length: SPEICHERPLAETZE }, (_, i) => {
    const meta = belegt.find((m) => m.index === i);
    if (!meta) return { index: i, label: 'Leer', belegt: false };
    return {
      index: i,
      label: `${meta.fieldId}  ${formatPlaytime(Math.floor(meta.tickCounter / 30))}`,
      belegt: true,
    };
  });
}

/**
 * Baut den Spielstand aus dem laufenden Zustand.
 *
 * Was mitgeht, ist genau das, was sich nicht wieder herleiten lässt: die
 * Variablenregionen des Interpreters, der Field-Snapshot und seit Version 2
 * die Savemap. Alles Ableitbare — geladene Modelle, Kamera, Hintergrundnetze —
 * bleibt draußen und wird beim Laden neu gebaut.
 */
function spielstandBauen(label: string): SaveSlot | null {
  if (!fieldSession) return null;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    sourceFingerprint: data?.sourceFingerprint ?? 'unbekannt',
    createdAt: Date.now(),
    globalState: fieldSession.runtime ? regionBuffers(fieldSession.runtime.state).map((b) => b.slice()) : [],
    fieldId: fieldName,
    fieldState: fieldSession.snapshot(),
    tickCounter: fieldSession.snapshot().tick,
    label,
    ...(savemapBytes ? { savemap: savemapBytes.slice() } : {}),
  };
}

async function spielstandSchreiben(index: number): Promise<string> {
  if (!(await saveStoreOeffnen())) return 'Speichern nicht möglich — kein Speicher';
  const slot = spielstandBauen(`${fieldName} (Platz ${index + 1})`);
  if (!slot) return 'Speichern nicht möglich — keine laufende Field-Sitzung';
  try {
    await saveStore.write(index, slot);
    await saveUebersichtAktualisieren();
    log(`Spielstand ${index + 1} geschrieben (${slot.fieldId}, Tick ${slot.tickCounter})`);
    return `Platz ${index + 1} gespeichert — ${slot.fieldId}`;
  } catch (err) {
    log(`Speichern fehlgeschlagen: ${String(err)}`);
    return `Speichern fehlgeschlagen: ${String(err)}`;
  }
}

/**
 * Lädt einen Spielstand: erst das Field betreten (das baut Netze, Modelle und
 * Sitzung neu auf), dann den Snapshot einspielen.
 *
 * Die Reihenfolge ist nicht beliebig — `FieldSession.restore` lehnt einen
 * Snapshot ab, der zu einem anderen Field gehört, und genau diese Prüfung ist
 * der Grund, warum hier nicht andersherum gearbeitet wird.
 */
async function spielstandLaden(index: number): Promise<string> {
  if (!(await saveStoreOeffnen())) return 'Laden nicht möglich — kein Speicher';
  const ergebnis = await saveStore.read(index, data?.sourceFingerprint);
  if (!ergebnis) return `Platz ${index + 1} ist leer`;
  if (!ergebnis.ok) return `Platz ${index + 1} unlesbar: ${ergebnis.reason}`;
  for (const w of ergebnis.warnings) log(`Spielstand ${index + 1}: ${w}`);

  const slot = ergebnis.slot;
  if (mode === 'world') toggleWorld();
  const betreten = await enterField(slot.fieldId);
  if (!betreten || !fieldSession) return `Field "${slot.fieldId}" nicht ladbar`;

  const wieder = fieldSession.restore(slot.fieldState as FieldSessionSnapshot);
  for (const w of wieder.warnings) log(`Spielstand ${index + 1}: ${w}`);
  if (!wieder.ok) return `Snapshot abgelehnt: ${wieder.reason ?? 'unbekannt'}`;

  if (slot.savemap) {
    savemapBytes = slot.savemap.slice();
    savemapAktuell = readSavemap(savemapBytes);
  }
  updateFieldActors();
  log(`Spielstand ${index + 1} geladen (${slot.fieldId}, Tick ${slot.tickCounter})`);
  return `Platz ${index + 1} geladen — ${slot.fieldId}`;
}

/**
 * Der Wirt, den die Menüsitzung für ihre Handlungen ruft (F07).
 *
 * Er ist bewusst dünn: Er hält die Bytes, deutet sie mit `readSavemap` und
 * reicht die neue Datensicht zurück. Das Schreiben selbst liegt in
 * `@webmidgar/formats-save`, die Ablauflogik in `@webmidgar/menu` — hier steht
 * nur die Verbindung.
 */
const menuWirt: MenuActionHost = {
  slot: () => savemapBytes,
  apply: (slot) => {
    savemapBytes = slot;
    savemapAktuell = readSavemap(slot);
    return menuData();
  },
  saveSlots: () => saveUebersicht,
  requestSave: (index) => {
    void spielstandSchreiben(index).then((text) => {
      menuSession?.setMessage(text);
      renderMenu();
    });
    return `Platz ${index + 1} wird gespeichert …`;
  },
};

function openMenu(requestId: number | null): void {
  void saveStoreOeffnen().then(() => renderMenu());
  menuSession = new MenuSession(menuData(), menuWirt);
  /**
   * `main` statt `party`: erst damit greift der zweistufige Abbruch
   * (Unteransicht → Hauptmenü → schließen) und die Kommandospalte ist
   * überhaupt erreichbar. Der MENU-Opcode nimmt weiterhin seinen eigenen Weg
   * (`open(view)`) — dort schließt Abbrechen wie bisher sofort.
   */
  menuSession.open('main');
  menuHostRequestId = requestId;
  renderMenu();
  menuOverlayEl.classList.add('visible');
}

function closeMenuOverlay(): void {
  if (menuHostRequestId !== null) fieldSession?.closeMenu(menuHostRequestId);
  menuHostRequestId = null;
  menuSession = null;
  paintBoxes(menuHost, [], fontKontext);
  menuOverlayEl.classList.remove('visible');
}

/**
 * F24-B — Menü zeichnen.
 *
 * Die frühere `<table>` in Monospace ist ersatzlos weg. Entschieden wird
 * nichts mehr hier: `MenuSession.screen()` liefert Fenster, Zeilen,
 * Spaltenanker und Balken in Koordinaten der 640×480-Fläche; diese Funktion
 * setzt sie nur noch. Gezeichnet wird mit demselben Maler und derselben
 * Fensterschale wie das Kampf-HUD (`paintBoxes` + `applyWindowSkin`) — genau
 * das war der Zweck der Schale.
 */
function renderMenu(): void {
  const bild = menuSession?.screen();
  if (!bild) {
    paintBoxes(menuHost, [], fontKontext);
    return;
  }
  paintBoxes(menuHost, menuBoxes(bild), fontKontext);
}

/** `MenuScreen` → Kastenliste des gemeinsamen Malers. */
function menuBoxes(bild: MenuScreen): HudBox[] {
  const boxen: HudBox[] = [];
  const zeilenHoehe = FF7_WINDOW_SKIN.lineHeight;
  for (const panel of bild.panels) {
    /**
     * 🟡 Der Maler kennt bisher nur die Normaldarstellung. Alle Fenster, die
     * `buildMainScreen`/`buildViewScreen` heute liefern, sind Normal; ein
     * anderer Modus würde hier auffallen, statt still falsch zu erscheinen.
     */
    if (panel.mode !== WindowDisplayMode.NoFrameNoBackground) {
      boxen.push({
        id: `menu.${panel.id}`,
        kind: 'window',
        rect: { x: panel.rect.x, y: panel.rect.y, w: panel.rect.width, h: panel.rect.height },
      });
    }
    for (const zeile of panel.lines) {
      // Zeilen unterhalb der Textfläche werden NICHT gezeichnet — sonst
      // schriebe eine lange Liste über das Fußfenster hinweg.
      if (zeile.y + zeilenHoehe > panel.content.height + 1) continue;
      const oben = panel.content.y + zeile.y;
      if (zeile.cursor) {
        boxen.push({
          id: `menu.${panel.id}.${zeile.key}.cursor`,
          kind: 'cursor',
          // Breite = CURSOR_SPALTE aus @webmidgar/menu: derselbe Betrag, um
          // den die Zeile eingerückt ist — sonst ragt der Zeiger aus dem Kasten.
          rect: { x: panel.rect.x + 6, y: oben, w: CURSOR_SPALTE, h: zeilenHoehe },
          text: FF7_WINDOW_SKIN.cursor.trim(),
          align: 'left',
          fontSize: FF7_WINDOW_SKIN.fontSize,
        });
      }
      /**
       * Balken ZUERST: die Kastenliste ist zugleich die Zeichenreihenfolge.
       * In der Gegenstands- und der Materiaansicht überlappen Balken und
       * rechtsbündiger Wert (der Balkenanker steht 180 px vor der rechten
       * Kante, lange Werte reichen darüber hinaus) — dann muss die Zahl
       * gewinnen, nicht der Balken.
       */
      zeile.bars.forEach((balken, k) => {
        const x = panel.content.x + balken.x;
        const y = oben + Math.round((zeilenHoehe - 12) / 2);
        boxen.push({
          id: `menu.${panel.id}.${zeile.key}.bar${k}.frame`,
          kind: 'barFrame',
          rect: { x, y, w: balken.width, h: 12 },
        });
        const breite = Math.round((balken.width - 4) * Math.max(0, Math.min(1, balken.fill)));
        if (breite > 0) {
          boxen.push({
            id: `menu.${panel.id}.${zeile.key}.bar${k}.fill`,
            kind: 'barFill',
            rect: { x: x + 2, y: y + 2, w: breite, h: 8 },
            background: MENU_BAR_COLORS[balken.tone] ?? MENU_BAR_COLORS['hp']!,
          });
        }
      });
      zeile.runs.forEach((lauf, k) => {
        // Rechtsbündig: der Anker ist die RECHTE Kante; die gemessene Breite
        // kommt aus dem Paket und wird hier nicht neu gerechnet.
        const rect =
          lauf.align === 'right'
            ? { x: panel.content.x, y: oben, w: lauf.x, h: zeilenHoehe }
            : { x: panel.content.x + lauf.x, y: oben, w: Math.max(lauf.width, panel.content.width - lauf.x), h: zeilenHoehe };
        boxen.push({
          id: `menu.${panel.id}.${zeile.key}.${k}`,
          kind: 'value',
          rect,
          text: lauf.text,
          align: lauf.align,
          fontSize: FF7_WINDOW_SKIN.fontSize,
          ...(lauf.dim ? { opacity: 0.45 } : {}),
        });
      });
    }
  }
  /**
   * Die Hinweise MÜSSEN sichtbar sein — sie tragen „Ersatzmetrik statt
   * WINDOW.BIN", „Ort vom Wirt geraten", „Zauberzuordnung 🔴". Ein Menü, das
   * seine Unsicherheiten verschweigt, ist genau der Fehler von Welle 1.
   */
  bild.notes.slice(0, 3).forEach((note, i) => {
    boxen.push({
      id: `menu.note${i}`,
      kind: 'diagnostic',
      rect: { x: 8, y: bild.surface.height - 18 * (bild.notes.length - i), w: bild.surface.width - 16, h: 16 },
      text: note,
      align: 'left',
      fontSize: 12,
      color: '#ffd050',
    });
  });
  return boxen;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
}

/** 🟡 Balkenfarben des Menüs — an EINER Stelle, nicht je Ansicht. */
const MENU_BAR_COLORS: Record<string, string> = {
  hp: 'rgb(140,213,170)',
  mp: 'rgb(150,180,255)',
  limit: 'rgb(204,143,176)',
  exp: 'rgb(228,181,129)',
};

function menuTick(frame: ActionFrame): void {
  const map: [SemanticAction, keyof MenuInput][] = [
    ['up', 'up'],
    ['down', 'down'],
    ['left', 'left'],
    ['right', 'right'],
    ['ok', 'confirm'],
    ['cancel', 'cancel'],
    ['menu', 'toggle'],
  ];
  const input: MenuInput = { ...NEUTRAL_MENU_INPUT };
  let any = false;
  for (const [action, ziel] of map) {
    if (frame.pressed.includes(action)) {
      (input as unknown as Record<string, boolean>)[ziel as string] = true;
      any = true;
    }
  }
  if (!any || !menuSession) return;
  /**
   * Abbrechen/Umschalten geht jetzt DURCH die Sitzung, statt das Overlay
   * vorher zu schließen. Vorher war der Rückweg aus einer Unteransicht
   * unerreichbar: der Wirt schloss das Menü, bevor `MenuSession.step` den
   * zweistufigen Abbruch überhaupt sehen konnte.
   */
  menuSession.step(input);
  menuSession.step(NEUTRAL_MENU_INPUT); // Flanke abschließen (MenuSession wirkt auf Flanken)
  if (!menuSession.state.open) {
    closeMenuOverlay();
    return;
  }
  renderMenu();
}

// --- Dialog-Overlay: echter Text aus der Field-Stringtabelle + Auswahl ------------

let dialogSel = 0;
/** Schreibmaschine: bereits sichtbare Zeichen des laufenden Dialogs. */
let dialogZeichen = 0;

function updateDialogOverlay(): void {
  const pending = fieldSession?.pendingDialogs() ?? [];
  if (pending.length === 0) {
    dialogVisibleId = null;
    dialogSel = 0;
    windowShell.close(DIALOG_SLOT);
    dialogOverlayEl.classList.remove('visible');
    return;
  }
  const first = pending[0]!;
  if (dialogVisibleId !== first.requestId) {
    dialogSel = 0;
    dialogZeichen = 0; // neuer Dialog ⇒ Schreibmaschine von vorn
  }
  dialogVisibleId = first.requestId;
  const text = fieldSession!.dialogText(first.dialogId) ?? `[Dialog ${first.dialogId} nicht dekodierbar]`;

  /**
   * Schreibmaschine: ein Zeichen je Takt, wie im Original. Zeilenumbrüche
   * zählen nicht mit — sonst entstünde eine sichtbare Pause an jedem
   * Zeilenende. Ein Tastendruck füllt den Rest sofort auf (s. `dialogTick`).
   */
  const sichtbar = dialogFertig(text) ? text : teiltextBis(text, dialogZeichen);
  const lines = sichtbar.split('\n');
  const gesamtZeilen = text.split('\n');
  const hatAuswahl = first.firstChoice !== null && first.lastChoice !== null;
  if (fontKontext) {
    // Welle 3: aus dem Fontblatt zeichnen. Die Zeilenaufteilung bleibt
    // dieselbe — nur der Inhalt jeder Zeile besteht jetzt aus Glyphenkästen
    // statt aus Systemschrift.
    const zeilenEl = gesamtZeilen.map((_, i) => {
      const line = lines[i] ?? '';
      const div = document.createElement('div');
      if (hatAuswahl && i >= first.firstChoice! && i <= first.lastChoice!) {
        div.className = i - first.firstChoice! === dialogSel ? 'choice sel' : 'choice';
      }
      paintGlyphText(div, line, fontKontext, { lineHeight: FF7_WINDOW_SKIN.lineHeight });
      return div;
    });
    dialogBoxEl.replaceChildren(...zeilenEl);
  } else {
    const html = gesamtZeilen
      .map((_, i) => {
        const line = lines[i] ?? '';
        if (hatAuswahl && i >= first.firstChoice! && i <= first.lastChoice!) {
          const sel = i - first.firstChoice! === dialogSel ? ' sel' : '';
          return `<div class="choice${sel}">${escapeHtml(line)}</div>`;
        }
        return `<div>${escapeHtml(line) || '&nbsp;'}</div>`;
      })
      .join('');
    dialogBoxEl.innerHTML = html;
  }
  windowShell.open(DIALOG_SLOT);
  applyWindowSkin(dialogBoxEl, windowShell.get(DIALOG_SLOT)!.mode);
  dialogOverlayEl.classList.add('visible');
}

/** Anzahl darstellbarer Zeichen eines Textes (Umbrüche zählen nicht mit). */
function zeichenZahl(text: string): number {
  return text.length - (text.match(/\n/g)?.length ?? 0);
}

function dialogFertig(text: string): boolean {
  return dialogZeichen >= zeichenZahl(text);
}

/** Text bis zum n-ten darstellbaren Zeichen, Umbrüche bleiben erhalten. */
function teiltextBis(text: string, n: number): string {
  let übrig = n;
  let out = '';
  for (const ch of text) {
    if (ch === '\n') {
      out += ch;
      continue;
    }
    if (übrig <= 0) break;
    out += ch;
    übrig--;
  }
  return out;
}

function dialogTick(frame: ActionFrame): void {
  if (dialogVisibleId === null || !fieldSession) return;
  const pending = fieldSession.pendingDialogs();
  const first = pending.find((d) => d.requestId === dialogVisibleId);
  if (!first) return;
  const text = fieldSession.dialogText(first.dialogId) ?? '';
  const fertig = dialogFertig(text);
  // Schreibmaschine: ein Zeichen je Takt, solange der Text läuft.
  if (!fertig) dialogZeichen++;

  const choiceCount =
    first.firstChoice !== null && first.lastChoice !== null ? first.lastChoice - first.firstChoice + 1 : 0;
  // Die Auswahl ist erst bedienbar, wenn der Text vollständig steht — sonst
  // wählte man in einem Fenster, das die Optionen noch gar nicht zeigt.
  if (choiceCount > 0 && fertig) {
    if (frame.pressed.includes('up')) dialogSel = (dialogSel + choiceCount - 1) % choiceCount;
    if (frame.pressed.includes('down')) dialogSel = (dialogSel + 1) % choiceCount;
  }
  if (frame.pressed.includes('ok')) {
    if (!fertig) {
      // Erster Druck füllt den Text sofort auf, statt den Dialog zu schließen.
      dialogZeichen = zeichenZahl(text);
      return;
    }
    fieldSession.resolveDialog(dialogVisibleId, choiceCount > 0 ? dialogSel : 0);
    dialogVisibleId = null;
    dialogSel = 0;
    dialogZeichen = 0;
  }
}

// --- Kampf: echte BattleSession + render-battle ------------------------------------

function openBattle(encounterId: number, requestId: number | null, source: 'field' | 'world'): void {
  /**
   * Ein Kampf hat Vorrang vor dem Menü — und zwar sichtbar. Im normalen Lauf
   * kann das nicht vorkommen (ein offenes Menü hält den Takt an), über
   * `gameDebug.starteKampf` schon: dann blieb das Menü-Overlay über der Bühne
   * stehen und war nicht mehr schließbar, weil der Kampfkontext gewinnt.
   */
  if (menuSession) closeMenuOverlay();
  const session = battleStarter?.(encounterId & 0x3ff) ?? null;
  if (!session || !data?.scenes) {
    openBattleStub(encounterId, requestId, source);
    return;
  }
  const partyIds = partySpecs.map((p) => p.id).filter((id) => session.actor(id) !== null);
  const enemyIds: string[] = [];
  for (let i = 0; i < 8; i++) if (session.actor(`enemy-${i}`)) enemyIds.push(`enemy-${i}`);
  const maxHp = new Map<string, number>();
  const maxMp = new Map<string, number>();
  for (const id of [...partyIds, ...enemyIds]) {
    maxHp.set(id, session.actor(id)!.hp);
    maxMp.set(id, session.actor(id)!.mp);
  }
  // K7: Die Projektionsschicht bekommt ihren Anfangszustand aus der Sitzung
  // (nur Lesezugriff) und ab jetzt jedes Tick-Ergebnis.
  const view = BattleViewModel.fromSession(
    session,
    [...partyIds, ...enemyIds].map((id) => ({ id, maxHp: maxHp.get(id)!, maxMp: maxMp.get(id)! })),
  );
  battle = {
    session,
    view,
    requestId,
    source,
    encounterId,
    partyIds,
    enemyIds,
    maxHp,
    maxMp,
    awaiting: [],
    eventLog: [],
    outcomeKind: null,
    rewards: null,
    commandIndex: 0,
    message: '',
    messageTicks: 0,
    result: null,
    resultPage: 0,
  };
  buildBattleVisuals(encounterId & 0x3ff);
  // Field-Titel auf den Keller, Kampfmusik darüber — `pop-music` stellt ihn
  // nach dem Kampf wieder her (die Laufzeit startet ihn wirklich neu).
  void music?.dispatch({ kind: 'push-music' });
  spieleMusikId(musicIdByName('bat'));
  battleOverlayEl.classList.add('visible');
  log(`Kampf gestartet: Encounter ${encounterId} (${source}), ${enemyIds.length} Gegner`);
  renderBattleHud();
}

function buildBattleVisuals(battleId: number): void {
  const gen = ++battleGen;
  battleGroup.clear();
  if (!data?.scenes) return;
  const { sceneIndex, formationIndex } = formationAddress(battleId);
  const scn = data.scenes.scenes[sceneIndex];
  const formation = scn?.formations[formationIndex];
  if (!scn || !formation) return;

  const cams = parseCameraBlock(formation.cameraRaw).cameras;
  if (cams[0]) applyBattleCamera(battleCamera, cams[0]);

  /**
   * K5 — echte Bühne statt Ersatzscheibe. `location` der Formation indiziert
   * DIREKT in das Bühnenband; die Teile tragen ihre Weltlage selbst, deshalb
   * wird nichts platziert, skaliert oder gedreht (die Gruppe trägt die
   * Battle-Basis, mehr nicht).
   */
  setzeBuehne(buildSubstituteStage());
  stageProtokoll = { prefix: null, location: formation.location, teile: 0, texturen: 0, ersatz: true };
  const praefixe = data.listBattlePrefixes();
  const stagePrefix = stagePrefixForLocation(formation.location, praefixe);
  if (!stagePrefix) {
    log(`Bühne: location ${formation.location} außerhalb des Bandes (${praefixe.length} Präfixe) — Ersatzbühne`);
  } else {
    void loadBattleStage(stagePrefix, data)
      .then((files) => {
        if (gen !== battleGen) return;
        if (!files) {
          log(`Bühne "${stagePrefix}" nicht ladbar — Ersatzbühne`);
          return;
        }
        const gebaut = buildBattleStage(stagePrefix, files);
        setzeBuehne(gebaut.root);
        stageProtokoll = {
          prefix: stagePrefix,
          location: formation.location,
          teile: gebaut.partCount,
          texturen: files.textures.filter((t) => t !== null).length,
          ersatz: false,
        };
        log(`Bühne "${stagePrefix}" (location ${formation.location}): ${gebaut.partCount} Teile`);
      })
      .catch((err) => log(`Bühne "${stagePrefix}": ${(err as Error).message}`));
  }

  // Gegner: sofort Platzhalterwürfel, echtes Modell asynchron nachladen.
  const placed = placeFormation(formation);
  placed.forEach((p, i) => {
    const box = new Mesh(new BoxGeometry(600, 1200, 600), new MeshBasicMaterial({ color: 0xcc4466 }));
    box.position.set(p.scenePosition[0], p.scenePosition[1] + 600, p.scenePosition[2]);
    battleGroup.add(box);
    const prefix = enemyModelPrefix(p.enemyTypeId);
    // K1/K2: `data` erfüllt `BattleEntrySource` strukturell — der Lader listet
    // damit den ECHTEN Namensraum des Präfixes auf und klassifiziert jeden
    // Eintrag über seine Inhaltssignatur, statt Dateinamen zu raten.
    void loadBattleModel(prefix, data!)
      .then((files) => {
        if (gen !== battleGen) return;
        if (!files) {
          log(`Battle-Modell "${prefix}" (Typ ${p.enemyTypeId}) nicht ladbar`);
          return;
        }
        const built = buildBattleActor(`enemy-${i}`, files);
        built.actor.root.position.set(p.scenePosition[0], p.scenePosition[1], p.scenePosition[2]);
        battleGroup.add(built.actor.root);
        battleGroup.remove(box);
        battleModellProtokoll.set(prefix, {
          prefix,
          teile: files.parts.length,
          texturen: files.textures.length,
          eintraege: data?.listBattleEntries(prefix).length ?? 0,
        });
        log(`Battle-Modell "${prefix}" geladen (${files.parts.length} Teile, ${files.textures.length} Texturen)`);
      })
      .catch((err) => log(`Battle-Modell "${prefix}": ${(err as Error).message}`));
  });
  /**
   * K3/K4 — echte Party-Modelle statt blauer Quader.
   *
   * Die Charakter-ID kommt aus der Savemap, NICHT aus `PartyMemberSpec.id`:
   * das ist der (umbenennbare) Anzeigename und trägt keine ID. Ohne Spielstand
   * sind es die IDs der `defaultParty()`.
   *
   * WICHTIG: kein `battleToScene` und keine Skalierung auf das fertige Modell.
   * `BATTLE_MODEL_SCALE = 1`, und die Modellkette trägt die Battle-Lage
   * bereits — wer sie ein zweites Mal anwendet, legt jede Figur flach.
   */
  const charIds = data.savemap
    ? data.savemap.party.filter((x): x is number => x !== null)
    : [0, 1];
  const plaetze = placeParty(Math.max(1, charIds.length));
  charIds.forEach((cid, i) => {
    const platz = plaetze[i];
    if (!platz) return;
    const prefix = partyModelPrefix(cid);
    if (!prefix) {
      // Kein Raten: unbekannte ID bekommt den Ersatzquader und eine Meldung.
      const box = new Mesh(new BoxGeometry(500, 1500, 500), new MeshBasicMaterial({ color: 0x4466cc }));
      box.position.set(platz[0], platz[1] + 750, platz[2]);
      battleGroup.add(box);
      log(`Party-Modell für Charakter ${cid} unbekannt — Ersatzquader`);
      return;
    }
    void loadBattleModel(prefix, data!)
      .then((files) => {
        if (gen !== battleGen || !files) {
          if (!files) log(`Party-Modell "${prefix}" nicht ladbar`);
          return;
        }
        const built = buildBattleActor(`party-${i}`, files);
        built.actor.root.position.set(platz[0], platz[1], platz[2]);
        battleGroup.add(built.actor.root);
        battleModellProtokoll.set(prefix, {
          prefix,
          teile: files.parts.length,
          texturen: files.textures.filter((t) => t !== null).length,
          eintraege: data?.listBattleEntries(prefix).length ?? 0,
        });
        log(
          `Party-Modell "${prefix}" (${partyModelByPrefix(prefix)?.label ?? '?'}) geladen: ${files.parts.length} Teile`,
        );
      })
      .catch((err) => log(`Party-Modell "${prefix}": ${(err as Error).message}`));
  });
}

function fmtBattleEvent(e: { kind: string } & Record<string, unknown>): string | null {
  switch (e.kind) {
    case 'action':
      return `${e['actorId']} → ${e['targetId']}: ${e['hit'] ? `${e['damage']} Schaden` : 'verfehlt'}`;
    case 'death':
      return `${e['actorId']} besiegt`;
    case 'escape-attempt':
      return `Flucht ${e['success'] ? 'gelungen' : 'misslungen'}`;
    case 'heal':
      return `${e['actorId']} heilt ${e['targetId']} um ${e['amount']}`;
    default:
      return null;
  }
}

/**
 * K7 — Trefferzahlen aus dem BattleViewModel in Flächenkoordinaten bringen.
 *
 * Die Zahl hängt am Ziel der Aktion. Party-Ziele bekommen die Zahl über ihre
 * HUD-Zeile (dort steht die Figur im HUD), Gegner über gleichmäßig verteilte
 * Ankerpunkte im oberen Bildbereich. 🟡 Das ist ein **Ersatz für eine echte
 * Projektion** der Kampfpositionen: Die Aufstellung gehört `render-battle`
 * (anderer Bereich), und ohne dessen Bildschirmkoordinaten wäre jede
 * genauere Zuordnung geraten. Was sichtbar wird, ist die ZAHL — vorher
 * erschien überhaupt nichts.
 */
function floaterAnchor(actorId: string): { x: number; y: number } {
  if (!battle) return { x: 320, y: 200 };
  const partyIndex = battle.partyIds.indexOf(actorId);
  if (partyIndex >= 0) return { x: 150, y: 300 - partyIndex * 26 };
  const enemyIndex = Math.max(0, battle.enemyIds.indexOf(actorId));
  const spalten = Math.max(1, battle.enemyIds.length);
  return { x: Math.round(((enemyIndex + 0.5) / spalten) * 560) + 40, y: 170 + (enemyIndex % 2) * 40 };
}

/** ViewState-Floater → HUD-Floater (Fortschritt 0…1 statt Resttakte). */
function hudFloaters(): HudFloater[] {
  if (!battle) return [];
  const FLOAT_TICKS = 45; // Anzeigedauer des BattleViewModel
  return battle.view.view.floating.map((f) => ({
    actorId: f.actorId,
    text: f.kind === 'miss' ? 'verfehlt' : f.kind === 'heal' ? `+${f.amount}` : String(f.amount),
    kind: f.kind,
    progress: Math.max(0, Math.min(1, 1 - f.ticksLeft / FLOAT_TICKS)),
    anchor: floaterAnchor(f.actorId),
  }));
}

function hudModel(): HudModel {
  const b = battle!;
  const view = b.view.view;
  const model: HudModel = {
    members: b.partyIds.map((id) => {
      const a = b.session.actor(id)!;
      const spec = partySpecs.find((p) => p.id === id);
      return {
        id,
        name: spec?.id ?? id,
        hp: a.hp,
        maxHp: b.maxHp.get(id) ?? a.hp,
        mp: a.mp,
        maxMp: b.maxMp.get(id) ?? a.mp,
        atb: a.atb,
        alive: a.hp > 0,
        awaiting: b.awaiting.includes(id),
      };
    }),
    message: b.messageTicks > 0 ? b.message : '',
    command: null,
    floaters: hudFloaters(),
    effectCoverage: view.effectCoverage,
  };
  // Die Metrik-Diagnose MUSS sichtbar bleiben — ein stiller Rückfall auf
  // Ersatzbreiten war der Fehler von Welle 1.
  if (data && !data.textMetrik.measured) model.metricsMeasured = false;
  const amZug = b.awaiting[0];
  if (amZug !== undefined) {
    const zeile = Math.max(0, b.partyIds.indexOf(amZug));
    model.command = { entries: DEFAULT_COMMANDS, selected: b.commandIndex, row: zeile };
  }
  return model;
}

function renderBattleHud(): void {
  if (!battle) return;
  if (battle.result) {
    paintBoxes(hudHost, [], fontKontext);
    paintBoxes(resultHost, resultBoxes({ ...battle.result, page: battle.resultPage }), fontKontext);
    battleOverlayEl.classList.remove('visible');
    resultOverlayEl.classList.add('visible');
    return;
  }
  resultOverlayEl.classList.remove('visible');
  battleOverlayEl.classList.add('visible');
  paintBoxes(hudHost, hudBoxes(hudModel()), fontKontext);
}

/**
 * N7 — Ergebnisbildschirm aus der VERBUCHUNG bauen. Gerechnet wird in
 * `@webmidgar/battle-runtime` (`applyExperience`, `expTotalForLevel`);
 * hier wird nur übernommen, was dabei herauskam.
 *
 * Ohne Growth-Sektion (KERNEL.BIN fehlt) gibt es keine Schwellen — dann
 * zeigt der Bildschirm EXP/AP/Gil und sagt beim Level nichts Erfundenes.
 */
function buildResultScreen(rewards: { exp: number; ap: number; gil: number; drops: number[] }): ResultScreenModel {
  const b = battle!;
  const namen = b.partyIds;
  const beute = rewards.drops.map((id) => data?.itemName(id) ?? `#${id}`);
  return {
    messages: resultMessages(rewards.gil, beute),
    page: 0,
    gainedExp: rewards.exp,
    gainedAp: rewards.ap,
    members: namen.map((id) => {
      const spec = partySpecs.find((p) => p.id === id);
      let fortschritt = progressById.get(id);
      if (!fortschritt) {
        fortschritt = {
          charIndex: Math.max(0, namen.indexOf(id)),
          level: spec?.level ?? 1,
          exp: 0,
          maxHp: spec?.maxHp ?? 100,
          maxMp: spec?.maxMp ?? 10,
        };
        progressById.set(id, fortschritt);
      }
      const aufstieg = growth
        ? applyExperience(fortschritt, rewards.exp, growth)
        : { levelsGained: 0, hpGained: 0, mpGained: 0 };
      if (!growth) fortschritt.exp += rewards.exp;
      const naechste = growth ? expTotalForLevel(growth, fortschritt.charIndex, fortschritt.level + 1) : 0;
      const vorige = growth ? expTotalForLevel(growth, fortschritt.charIndex, fortschritt.level) : 0;
      const spanne = Math.max(1, naechste - vorige);
      if (aufstieg.levelsGained > 0) {
        log(
          `${id}: Stufe ${fortschritt.level} (+${aufstieg.levelsGained}), HP +${aufstieg.hpGained}, MP +${aufstieg.mpGained}`,
        );
      }
      return {
        name: spec?.id ?? id,
        level: fortschritt.level,
        exp: fortschritt.exp,
        toNextLevel: growth ? Math.max(0, naechste - fortschritt.exp) : 0,
        levelProgress: growth ? Math.max(0, Math.min(1, (fortschritt.exp - vorige) / spanne)) : 0,
        levelsGained: aufstieg.levelsGained,
      };
    }),
  };
}

function closeRealBattle(): void {
  if (!battle) return;
  const outcomeCode = battle.outcomeKind === 'victory' ? 0 : battle.outcomeKind === 'escape' ? 1 : 2;
  if (battle.source === 'field' && battle.requestId !== null) {
    fieldSession?.runtime?.postEvent({ kind: 'battle-finished', requestId: battle.requestId, outcome: outcomeCode });
  }
  log(`Kampf beendet: ${battle.outcomeKind}${battle.rewards ? ` (+${battle.rewards.exp} EXP, +${battle.rewards.gil} Gil — Verbuchung in Savemap offen)` : ''}`);
  battle = null;
  battleGen++;
  battleGroup.clear();
  // Die Bühne gehört dem beendeten Kampf — sie bleibt nicht für den nächsten stehen.
  setzeBuehne(null);
  stageProtokoll = { prefix: null, location: null, teile: 0, texturen: 0, ersatz: true };
  paintBoxes(hudHost, [], fontKontext);
  paintBoxes(resultHost, [], fontKontext);
  battleOverlayEl.classList.remove('visible');
  resultOverlayEl.classList.remove('visible');
  void music?.dispatch({ kind: 'pop-music' });
}

function battleTick(frame: ActionFrame): void {
  if (!battle) return;

  // Ausgang erreicht: erst blättert der Ergebnisbildschirm, dann schließt er.
  if (battle.outcomeKind !== null) {
    if (frame.pressed.includes('ok')) {
      if (battle.result && battle.resultPage < battle.result.messages.length - 1) battle.resultPage++;
      else {
        closeRealBattle();
        return;
      }
    }
    renderBattleHud();
    return;
  }

  let input: BattleTickInput = {};
  const actorId = battle.awaiting[0];
  if (actorId !== undefined) {
    const eintraege = DEFAULT_COMMANDS.length;
    if (frame.pressed.includes('up')) battle.commandIndex = (battle.commandIndex + eintraege - 1) % eintraege;
    if (frame.pressed.includes('down')) battle.commandIndex = (battle.commandIndex + 1) % eintraege;
    if (frame.pressed.includes('cancel')) {
      input = { command: { actorId, command: { kind: 'escape' } } };
    } else if (frame.pressed.includes('ok')) {
      const target = battle.enemyIds.find((id) => (battle!.session.actor(id)?.hp ?? 0) > 0);
      // 🟡 Nur „Angriff“ und „Flucht“ sind Kommandos der Sitzung; Magie und
      // Gegenstand sind im Kampfmodell noch nicht angeschlossen. Statt sie
      // stillschweigend als Angriff auszuführen, melden sie das offen.
      const wahl = DEFAULT_COMMANDS[battle.commandIndex];
      if (wahl === 'Flucht') input = { command: { actorId, command: { kind: 'escape' } } };
      else if (wahl === 'Angriff' && target) {
        input = { command: { actorId, command: { kind: 'attack', targetId: target } } };
        zeigeKampfmeldung('Angriff');
      } else if (wahl !== 'Angriff') {
        zeigeKampfmeldung(`${wahl}: noch nicht angeschlossen`);
      }
    }
  }

  const result = battle.session.tick(input);
  // K7: dasselbe Ergebnis, das die Sitzung meldet, geht in die Projektion —
  // ohne Rückkanal, deshalb ist der Digest davon unberührt.
  battle.view.applyTick(result);
  battle.awaiting = result.awaitingInput;
  if (battle.messageTicks > 0) battle.messageTicks--;
  for (const e of result.events) {
    const line = fmtBattleEvent(e as { kind: string } & Record<string, unknown>);
    if (line) battle.eventLog.push(line);
    if (e.kind === 'action') zeigeKampfmeldung(kampfmeldung(e));
  }
  if (battle.eventLog.length > 12) battle.eventLog = battle.eventLog.slice(-12);
  if (result.outcome) {
    battle.outcomeKind = result.outcome.kind;
    if (result.outcome.kind === 'victory') {
      const rewards = {
        exp: result.outcome.exp,
        ap: result.outcome.ap,
        gil: result.outcome.gil,
        drops: [...result.outcome.drops],
      };
      battle.rewards = rewards;
      battle.result = buildResultScreen(rewards);
      battle.resultPage = 0;
      // Die Siegfanfare ist ein Einmaltitel (`once`), keine Schleife — sonst
      // wiederholt sie sich, solange der Ergebnisbildschirm offen steht.
      // 🟡 Ungemessen bleibt, ob das Original danach einen Folgetitel startet;
      // hier bleibt es still, bis `pop-music` beim Schließen die Feldmusik holt.
      spieleMusikId(musicIdByName('fanfare'), true);
    }
  }
  renderBattleHud();
}

/** 🟡 Meldungsdauer über der Bühne: 30 Kampftakte = 2 s bei 15 Hz. */
const MELDUNG_TAKTE = 30;

function zeigeKampfmeldung(text: string): void {
  if (!battle) return;
  battle.message = text;
  battle.messageTicks = MELDUNG_TAKTE;
}

/**
 * 🟡 Der Meldungstext des Originals ist der ATTACKENNAME („Machine Gun“ in
 * `…223335_1.jpg`). Die Attackennamen liegen in einer kernel-Sektion, die
 * hier noch nicht gedeutet ist — deshalb steht die Attack-ID daneben, statt
 * einen Namen zu erfinden.
 */
function kampfmeldung(e: { kind: string } & Record<string, unknown>): string {
  const angreifer = String(e['actorId']);
  const attackId = e['attackId'];
  if (attackId === null || attackId === undefined) return `${angreifer}: Angriff`;
  return `${angreifer}: Attacke #${attackId}`;
}

// --- Kampf-Stub (Rückfall, wenn der Starter die Szene nicht liefert) ----------------

function openBattleStub(encounterId: number, requestId: number | null, source: 'field' | 'world'): void {
  battleStub = { encounterId, requestId, source };
  // Der Stub bekommt dieselbe Fensterschale wie der echte Kampf — nur eben
  // eine ehrliche Meldung darin, dass hier keine Sitzung laeuft.
  paintBoxes(
    hudHost,
    hudBoxes({
      members: [],
      message: `Encounter ${encounterId} (${source}) — keine Szene: Enter = Sieg, Esc = Flucht`,
      command: null,
      floaters: [],
    }),
    fontKontext,
  );
  battleOverlayEl.classList.add('visible');
  log(`Kampf angefordert: Encounter ${encounterId} (${source})`);
}

function battleStubTick(frame: ActionFrame): void {
  if (!battleStub) return;
  const victory = frame.pressed.includes('ok');
  const escape = frame.pressed.includes('cancel');
  if (!victory && !escape) return;
  const outcome = victory ? 0 : 1; // encodeOutcome: victory=0, escape=1
  if (battleStub.source === 'field' && battleStub.requestId !== null) {
    fieldSession?.runtime?.postEvent({ kind: 'battle-finished', requestId: battleStub.requestId, outcome });
  }
  log(`Kampf beendet: ${victory ? 'Sieg' : 'Flucht'}`);
  battleStub = null;
  paintBoxes(hudHost, [], fontKontext);
  battleOverlayEl.classList.remove('visible');
}

// --- Field-Modus -------------------------------------------------------------------

async function enterField(name: string, start?: { x: number; y: number }): Promise<boolean> {
  fieldMusicId = null;
  if (!data) return false;
  setStatus(`Lade Field "${name}" …`);
  const { bundle, codes } = await data.loadFieldBundle(name);
  if (!bundle) {
    setStatus(`Field "${name}" unbrauchbar (${codes.join(', ') || 'unbekannt'}).`);
    return false;
  }
  fieldBundle = bundle;
  fieldName = name;
  fieldWarnings = [];

  bgGroup.clear();
  hintergrundAnim = null;
  if (bundle.background) {
    const built = buildFieldBackground(bundle.background, bundle.palette, { near: NEAR, far: FAR });
    for (const mesh of built.meshes) bgGroup.add(mesh);
    if (built.animationen.length > 0) {
      hintergrundAnim = { gruppen: built.animationen, zustaende: built.zustaende, takt: 0 };
      setzeHintergrundZustand();
    }
  } else {
    fieldWarnings.push('Hintergrund fehlt/quarantänisiert — Szene bleibt schwarz.');
  }

  const fieldCam = bundle.cameras?.cameras[0];
  fieldCamera = fieldCam
    ? buildFieldCamera(fieldCam, { fovBase: FOV_BASE, near: NEAR, far: FAR })
    : new PerspectiveCamera(60, FIELD_ASPECT, NEAR, FAR);
  if (!fieldCam) fieldWarnings.push('Kamera fehlt — Platzhalterkamera.');
  if (!bundle.walkmesh) fieldWarnings.push('Walkmesh fehlt — Figur inaktiv.');

  /**
   * F35-1: Der Interpreter kennt die Hintergrundkacheln nicht und darf ihren
   * Anfangszustand nicht erraten — der Wirt reicht die fertige Karte herein.
   * Je Animationsparameter das niedrigste vorkommende Zustandsbit; ohne diese
   * Vorbelegung blieb `bgStates` leer und die Zeichenregel blendete ganze
   * Kachelgruppen aus (korpusweit 213 Gruppen mit 9682 Kacheln).
   */
  const anfangsBgStates = berechneAnfangsBgStates(
    (bundle.background?.layers ?? []).flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state }))),
  );

  fieldSession = new FieldSession(bundle, {
    dialogMode: 'manual',
    menuMode: 'manual',
    encounters: true,
    initialBgStates: anfangsBgStates,
    ...(start ? { start } : {}),
  });
  for (const a of npcActors.values()) actorGroup.remove(a.root);
  npcActors.clear();
  releaseFieldModels();
  void loadFieldModels();
  transitioning = false;
  mode = 'field';
  selectEl.value = name;
  setStatus(`Field "${name}" betreten.`);
  return true;
}

// --- Echte Charaktermodelle (S10-Manifest → char.lgp) ------------------------------

function releaseFieldModels(): void {
  modelGeneration++;
  modelLoadPending.clear();
  for (const h of actorHandles.values()) {
    actorGroup.remove(h.actor.root);
    h.release();
  }
  actorHandles.clear();
  if (playerHandle) {
    actorGroup.remove(playerHandle.actor.root);
    playerHandle.release();
    playerHandle = null;
  }
  spielerAnim = null;
  spielerBereit = false;
  letzteSpielerPos = null;
  animBereit.clear();
  actorAnimState.clear();
}

async function loadFieldModels(): Promise<void> {
  if (!actorLib || !fieldBundle?.models || !fieldSession) return;
  const gen = modelGeneration;
  const manifest = fieldBundle.models;
  const actors = fieldSession.runtime?.state.actors ?? [];

  // Spielermodell: Actor mit Party-Slot 0, sonst erstes Manifest-Modell (🔵).
  let playerModelIndex = actors.find((a) => a.partyMember === 0)?.modelIndex ?? null;
  if (playerModelIndex === null && manifest.models.length > 0) playerModelIndex = 0;
  if (playerModelIndex !== null && manifest.models[playerModelIndex]) {
    const handle = await actorLib.load(manifest.models[playerModelIndex]!, manifest.scaleGlobal);
    if (handle && gen === modelGeneration) {
      playerHandle = handle;
      handle.setAnimation(0, 1, true); // 🔵 Stand-Animation = Manifest-Index 0
      actorGroup.add(handle.actor.root);
    } else {
      handle?.release();
    }
  }

}

/**
 * NPC-Modelle lazy: `modelIndex` wird erst durch Script-Opcodes während der
 * ersten Ticks gesetzt — deshalb je Tick nachschauen statt einmalig beim
 * Betreten (sonst bleiben alle NPCs Ersatzkapseln).
 */
const modelLoadPending = new Set<number>();

function requestNpcModel(i: number, modelIndex: number): void {
  if (!actorLib || !fieldBundle?.models) return;
  if (modelLoadPending.has(i) || actorHandles.has(i)) return;
  const entry = fieldBundle.models.models[modelIndex];
  if (!entry) return;
  modelLoadPending.add(i);
  const gen = modelGeneration;
  actorLib
    .load(entry, fieldBundle.models.scaleGlobal)
    .then((handle) => {
      modelLoadPending.delete(i);
      if (!handle) return;
      if (gen !== modelGeneration) {
        handle.release();
        return;
      }
      handle.actor.root.visible = false;
      if (figurSkala !== 1) handle.actor.root.scale.setScalar(figurSkala);
      actorHandles.set(i, handle);
      actorGroup.add(handle.actor.root);
    })
    .catch((err) => {
      modelLoadPending.delete(i);
      log(`Modell ${entry.modelFile} nicht ladbar: ${(err as Error).message}`);
    });
}

/** Gateway-Wechsel: Ziel über maplist auflösen, Ankunft über das Gegen-Gateway. */
async function handleFieldChange(change: FieldChange): Promise<void> {
  if (!data?.maplist || transitioning) return;
  transitioning = true;
  const targetName = data.fieldNameByMaplist(change.destMaplistIndex);
  if (!targetName) {
    log(`Gateway ${change.gatewayIndex}: maplist[${change.destMaplistIndex}] leer — Sackgasse.`);
    transitioning = false;
    return;
  }
  const { bundle } = await data.loadFieldBundle(targetName);
  const plan = planTransition(change, data.maplist, bundle, fieldName);
  const arrival = plan?.arrival ?? undefined;
  // Herkunft der Ankunft mitschreiben: `record` ist der Normalweg (Zielpunkt
  // aus dem Gateway-Record, 100 % belegt), `gegen-gateway` der Rückfall.
  const herkunft = plan?.source === 'record'
    ? ' (Zielpunkt aus dem Record)'
    : plan?.source === 'gegen-gateway'
      ? ' (Rückfall: Gegen-Gateway)'
      : plan?.reason
        ? ` (ohne Ankunftspunkt: ${plan.reason})`
        : '';
  log(`Gateway ${change.gatewayIndex} → ${targetName}${herkunft}`);
  await enterField(targetName, arrival);
}

function handleHostRequests(requests: HostRequest[]): void {
  for (const req of requests) {
    switch (req.kind) {
      case 'battle':
        openBattle(req.encounterId, req.requestId, 'field');
        break;
      case 'field-change': {
        const ziel = data?.fieldNameByMaplist(req.maplistIndex);
        log(`Script-Fieldwechsel → maplist[${req.maplistIndex}] = ${ziel ?? '(leer)'}`);
        if (ziel) void enterField(ziel);
        break;
      }
      case 'menu':
        log(`Menü-Request (selector ${req.selector}, param ${req.param})`);
        openMenu(req.requestId);
        break;
      case 'music':
        loeseMusikAuf(req.trackId);
        break;
      case 'sound':
        log(`Sound: ${req.soundId} (pan ${req.pan})`);
        break;
      case 'save-offer':
        log('Speicherpunkt (Save-UI nicht verdrahtet)');
        break;
    }
  }
}

/**
 * Die MUSIC-Kette (F09-A), vollständig:
 *
 *   Operand v → `akaoOffsets[v]` des AKTUELLEN Fields → AKAO-Blockkopf →
 *   u16@+4 = musicId (1…98) → `music.idx[musicId − 1]` → OGG
 *
 * Der Operand ist ein **field-lokaler AKAO-Index**, kein globaler Titel
 * (Messung: 1230/1243 = 98,95 % gegen Kontrolle Nachbarfield 71,92 %). Die
 * frühere Rechnung `musicNames[trackId − 1]` traf deshalb in 686 von 1241
 * Aufrufen den Operanden 0 — `musicNames[-1]` ist `undefined`, und es passierte
 * stillschweigend NICHTS; der Rest spielte einen falschen Titel.
 */
function loeseMusikAuf(operand: number): void {
  const section1 = fieldBundle?.rawSections[1];
  const offsets = fieldBundle?.script?.akaoOffsets;
  if (!section1 || !offsets) {
    log(`Musik: Operand ${operand} — kein Field-Script/keine Sektion 1, nicht auflösbar`);
    return;
  }
  const diags: FieldDiagnostic[] = [];
  const res = resolveFieldMusic(offsets, section1, operand, fieldName, diags);
  for (const d of diags) log(`${d.code}: ${d.detail}`);
  const name = res.musicIndex === null ? null : (data?.musicNames[res.musicIndex] ?? null);
  // Die Script-Schleife setzt denselben Opcode viele Male ab (gemessen: md1_1
  // 32-mal in 120 Takten). Eine Wiederholung ist kein neues Ereignis — sie wird
  // gezählt, nicht erneut protokolliert und nicht erneut gemeldet.
  const letzte = musikProtokoll[musikProtokoll.length - 1];
  const wiederholung =
    letzte !== undefined &&
    letzte.field === fieldName &&
    letzte.operand === operand &&
    letzte.musicId === res.musicId;
  if (wiederholung) {
    letzte.wiederholungen++;
  } else {
    musikProtokoll.push({
      field: fieldName,
      operand,
      musicId: res.musicId,
      musicIndex: res.musicIndex,
      name,
      reason: res.reason,
      diagnosen: diags.map((d) => d.code),
      wiederholungen: 0,
    });
    if (musikProtokoll.length > 32) musikProtokoll.shift();
    if (res.musicId === null) log(`Musik: Operand ${operand} nicht auflösbar (${res.reason})`);
    else log(`Musik: AKAO-Index ${operand} → musicId ${res.musicId} → ${name ?? '(kein music.idx-Eintrag)'}`);
  }
  if (res.musicId === null) return;
  fieldMusicId = res.musicId;
  spieleMusikId(res.musicId);
}

function fieldTick(input: FieldInput): TickResult | null {
  if (!fieldSession || transitioning) return null;
  const result = fieldSession.tick(input);
  handleHostRequests(result.hostRequests);
  if (result.fieldChange) void handleFieldChange(result.fieldChange);
  updateFieldActors();
  updateDialogOverlay();
  return result;
}

/**
 * Hintergrund-Animation (F22).
 *
 * Je Animationsparameter ist GENAU EIN Zustand sichtbar. Welcher, entscheidet
 * im Original das Field-Script über die Parameter-Opcodes.
 *
 * 🟡 **Demo-Ersatz, solange die Opcodes nicht verdrahtet sind:** die Zustände
 * eines Parameters werden reihum durchgeschaltet. Das ist nicht die Semantik
 * des Originals — aber es zeigt eine Animation statt aller Phasen übereinander,
 * und genau daran hing der Befund „verschwommene Blöcke".
 */
const HINTERGRUND_TAKTE_JE_PHASE = 8;

function setzeHintergrundZustand(): void {
  if (!hintergrundAnim) return;
  const phase = Math.floor(hintergrundAnim.takt / HINTERGRUND_TAKTE_JE_PHASE);
  // F22, echter Mechanismus: Wenn das Field-Script einen Parameter über
  // BGON/BGOFF angefasst hat, gilt seine Bitmaske (state ist ein Bit).
  // Unberührte Parameter laufen weiter im Demo-Reihum — besser eine
  // plausible Animation als ein eingefrorener Zustand.
  const script = fieldSession?.runtime?.state.bgStates ?? {};
  for (const gruppe of hintergrundAnim.gruppen) {
    const maske = script[gruppe.param];
    if (maske !== undefined) {
      for (const mesh of gruppe.meshes) mesh.visible = gruppe.state === 0 || (maske & gruppe.state) !== 0;
      continue;
    }
    const bits = hintergrundAnim.zustaende.get(gruppe.param) ?? [];
    const aktiv = bits.length > 0 ? bits[phase % bits.length] : gruppe.state;
    const sichtbar = gruppe.state === aktiv;
    for (const mesh of gruppe.meshes) mesh.visible = sichtbar;
  }
}

function updateFieldActors(): void {
  const player = fieldSession?.player;
  // Actor statt root führen: die Blickrichtung geht über setActorFacing, das
  // die Scene-Basis erhält (F20 — `root.rotation.y` löschte sie).
  const playerFigur = playerHandle?.actor ?? playerActor;
  playerActor.root.visible = false;
  if (playerHandle) playerHandle.actor.root.visible = false;
  if (player) {
    playerFigur.root.visible = true;
    const p = ff7ToScene([player.walk.x, player.walk.y, player.walk.height]);
    playerFigur.root.position.set(p[0], p[1], p[2]);
    setActorFacing(playerFigur, player.facing);
    if (playerHandle) {
      // F27: Stehen/Gehen/Rennen (Slots 0/1/2, Makou-belegt) nach der
      // TATSÄCHLICHEN Ortsveränderung — nicht nach dem Eingabezustand, damit
      // eine blockierte Bewegung (Wand) nicht auf der Stelle läuft. Das
      // frühere Kippen der Gehanimation war eine Folge von F20 und ist mit
      // dem Quaternion-Facing behoben (spielerProbe: Wurzellage bei allen
      // drei Slots identisch).
      const dx = letzteSpielerPos ? player.walk.x - letzteSpielerPos[0] : 0;
      const dy = letzteSpielerPos ? player.walk.y - letzteSpielerPos[1] : 0;
      const schritt = Math.hypot(dx, dy);
      const wunsch = schritt < 0.01 ? ANIM_STEHEN : schritt > 9 ? ANIM_RENNEN : ANIM_GEHEN;
      if (spielerAnim !== wunsch) {
        spielerAnim = wunsch;
        playerHandle.setAnimation(wunsch, 1, true);
        if (!spielerBereit) void playerHandle.whenAnimationSettled().then(() => { spielerBereit = true; });
      }
      playerFigur.root.visible = spielerBereit; // F36: nur bis zur ERSTEN Bindung verborgen
      letzteSpielerPos = [player.walk.x, player.walk.y];
      playerHandle.advanceTick();
    }
  }
  // NPCs: echtes Modell wenn geladen, sonst Ersatzkapsel. Party-Slot 0 ist der
  // Spieler und wird nicht doppelt gezeichnet.
  const actors = fieldSession?.runtime?.state.actors ?? [];
  for (const h of actorHandles.values()) h.actor.root.visible = false;
  for (const c of npcActors.values()) c.root.visible = false;
  actors.forEach((rt, i) => {
    if (!rt.position || !rt.visible || rt.partyMember === 0) return;
    if (rt.modelIndex !== null) requestNpcModel(i, rt.modelIndex);
    const handle = actorHandles.get(i);
    let figur: Actor;
    if (handle) {
      figur = handle.actor;
      const anim = rt.animation;
      // F21: Ohne Script-Animation lief die Figur in der BINDPOSE — und die
      // ist keine Standpose: die Modelle lagen flach am Boden. Im Original ist
      // die Ruhehaltung Animation 0 des Manifest-Eintrags, nicht die Bindpose.
      const key = anim ? `${anim.id}|${anim.speed}|${anim.loop}` : 'standard0';
      if (actorAnimState.get(i) !== key) {
        actorAnimState.set(i, key);
        if (anim) handle.setAnimation(anim.id, anim.speed, anim.loop);
        else handle.setAnimation(ANIM_STEHEN, 1, true);
        // F36: Bis der Clip gebunden ist, posiert advanceTick die BINDPOSE —
        // und die ist keine Standhaltung, sondern die gestreckte Bone-Kette:
        // die Figur liegt flach am Boden. Das dauert nur wenige Takte, ist
        // aber bei JEDEM Field-Wechsel sichtbar. Deshalb bleibt die Figur
        // unsichtbar, bis ihre Animation steht.
        animBereit.delete(i);
        void handle.whenAnimationSettled().then(() => animBereit.add(i));
      }
      handle.advanceTick();
    } else {
      let capsule = npcActors.get(i);
      if (!capsule) {
        capsule = buildFallbackActor(16);
        npcActors.set(i, capsule);
        actorGroup.add(capsule.root);
      }
      figur = capsule;
    }
    figur.root.visible = !handle || animBereit.has(i);
    const p = ff7ToScene(rt.position);
    figur.root.position.set(p[0], p[1], p[2]);
    if (rt.direction !== null) setActorFacing(figur, rt.direction);
  });
}

// --- World-Modus -------------------------------------------------------------------

/**
 * 🔵 Kuratierte Ortsmarken als **Fußgängerpfad ohne Skript** — kein Ersatz
 * mehr für die echten Einstiegspunkte.
 *
 * Der frühere Satz „die echten World↔Field-Einstiegspunkte sind offen (🔴)"
 * stimmt seit F06 nicht mehr: sie liegen in `field.tbl` (64 Datensätze × 2
 * Szenarien) und werden über den Weltscript-Opcode 0x318 mit 1-BASIERTER
 * Datensatznummer angesprochen. Der Ankunftspunkt (x, y) liegt nachweislich im
 * Walkmesh-Dreieck `triangle` des über `fieldId` aufgelösten Feldes (65/65,
 * Kontrolle 0/65 bei anderem Dreieck, 11/65 bei permutiertem Feld). Diese Marke
 * bleibt nur, damit man ohne Skriptlauf zu Fuß in ein Field kommt.
 */
function curatedLocations(): WorldLocation[] {
  if (!data?.maplist || !data.terrain) return [];
  const idx = data.maplist.names.indexOf(START_FIELD_DEFAULT);
  if (idx < 0) return [];
  const start = findLandStart(data.terrain);
  return [{ x: start.x + 4000, z: start.z, radius: 2500, destMaplistIndex: idx }];
}

/**
 * F10: Die Rastermitte liegt auf Wasser (Klasse 3) — zu Fuß bewegungsunfähig.
 * Spiralsuche vom Zentrum nach der ersten Nicht-Wasser-Position (🔵 Demo-
 * Start; die echte Startposition der Weltkarte ist nicht erschlossen).
 */
function findLandStart(terrain: NonNullable<GameData['terrain']>): { x: number; z: number } {
  const mitte = { x: 4.5 * 32768, z: 3.5 * 32768 };
  const schritt = 8192;
  for (let radius = 0; radius <= 20; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = mitte.x + dx * schritt;
        const z = mitte.z + dz * schritt;
        const boden = sampleGround(terrain, GRID, x, z);
        if (boden && boden.walkClass !== 3) return { x, z };
      }
    }
  }
  return mitte;
}

function enterWorld(): void {
  if (!data?.terrain) {
    setStatus('Kein WM0-Terrain geladen — Weltkarte nicht verfügbar.');
    return;
  }
  if (!worldSession) {
    worldSession = new WorldSession(data.terrain, GRID, {
      ev: data.worldEv,
      // F06: ohne die Tabelle bleibt 0x318 ein durchgereichtes script-command —
      // kein erfundenes Ziel.
      fieldTable: data.fieldTable ?? null,
      start: findLandStart(data.terrain),
      locations: curatedLocations(),
      encounters: { enabled: true, classes: Array.from({ length: 32 }, (_, i) => i) }, // 🔵 Demo: alle Klassen zählen
    });
    for (const loc of curatedLocations()) {
      const marker = new Mesh(new ConeGeometry(900, 2600, 6), new MeshBasicMaterial({ color: 0x44ff88 }));
      marker.position.set(loc.x, 800, loc.z);
      worldMarkerGroup.add(marker);
    }
  }
  mode = 'world';
  setStatus('Weltkarte (WM0) — Tab wechselt das Fahrzeug, grüne Marke = Field-Einstieg.');
}

function toggleWorld(): void {
  if (mode === 'world') {
    if (fieldName) void enterField(fieldName);
    else setStatus('Kein Field bekannt — zuerst eines betreten.');
  } else {
    enterWorld();
  }
}

function worldTick(frame: ActionFrame): void {
  if (!worldSession) return;
  const result = worldSession.tick(toWorldInput(frame));
  lastWorldResult = result;
  for (const req of result.requests) {
    if (req.kind === 'world-transition') {
      const ziel = data?.fieldNameByMaplist(req.destMaplistIndex);
      if (req.source === 'script') {
        // F06: Ankunft aus field.tbl. `arrival.triangle` ist der Walkmesh-Index,
        // in dem (x, y) liegt — als Ankunftsdreieck belegt (65/65).
        // 🔴 `direction` ist eine 256er-Richtung, deren Nullpunkt im Field-Raum
        // NICHT gemessen ist. Sie wird deshalb nur protokolliert, nicht auf die
        // Blickrichtung angewandt — eine geratene Drehung wäre schlechter als keine.
        const a = req.arrival;
        log(
          `Weltscript 0x318 → Datensatz ${req.fieldTblRecord}/Szenario ${req.scenario}: ` +
            `maplist[${req.destMaplistIndex}] = ${ziel ?? '(leer)'}` +
            (a ? ` @(${a.x},${a.y}) Dreieck ${a.triangle}, Richtung ${a.direction} (🔴 ungedeutet)` : ''),
        );
        if (ziel) void enterField(ziel, a ? { x: a.x, y: a.y } : undefined);
      } else {
        log(`Weltkarte → Field (Ortsmarke ${req.locationIndex}): maplist[${req.destMaplistIndex}] = ${ziel ?? '(leer)'}`);
        if (ziel) void enterField(ziel);
      }
    } else if (req.kind === 'encounter-check') {
      worldEncounterChecks++;
      // Die Sitzung hat bereits gewürfelt (Schwelle 24/256 alle 32 Schritte) —
      // jeder encounter-check IST ein Treffer. 🔵 Encounter-ID bleibt Demo-Ersatz.
      openBattle(WORLD_DEMO_ENCOUNTER, null, 'world');
    }
  }
  // Streaming + Marker.
  const update = streamer.update(worldSession.x, worldSession.z);
  for (const slot of update.release) {
    const g = residentBlocks.get(slot.key);
    if (g) {
      worldTerrainGroup.remove(g);
      g.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshLambertMaterial).dispose();
        }
      });
      residentBlocks.delete(slot.key);
    }
  }
  for (const slot of update.load) {
    const g = buildBlockGroup(slot.blockIndex, slot.cell);
    residentBlocks.set(slot.key, g);
    worldTerrainGroup.add(g);
  }
  playerMarker.position.set(worldSession.x, worldSession.h + 1400, worldSession.z);
}

/**
 * F11b/F25 — Darstellungsart der Weltkarte.
 *
 * `textured` ist der neue Normalfall. Die beiden Diagnosearten bleiben
 * ausdrücklich erhalten: sie sind Werkzeuge, kein Fehler. `terrain` färbt nach
 * Begehbarkeitsklasse (der bisherige Zustand), `region` nach `locationId` —
 * damit lässt sich die Ortszuordnung ohne Textur prüfen.
 */
type WeltDarstellung = 'textured' | 'terrain' | 'region';
let weltDarstellung: WeltDarstellung = 'textured';

/**
 * Die Atlasseiten als Three-Texturen — EINMAL, nicht je Block. `flipY = false`
 * ist Pflicht: die Atlas-UVs zählen v von oben.
 */
const atlasTexturen = new Map<number, DataTexture>();

function atlasTextur(seite: number): DataTexture | null {
  const atlas = data?.worldTextures?.atlas;
  const bytes = atlas?.atlases[seite];
  if (!atlas || !bytes) return null;
  const vorhanden = atlasTexturen.get(seite);
  if (vorhanden) return vorhanden;
  const t = new DataTexture(bytes, atlas.size, atlas.size, RGBAFormat);
  t.flipY = false;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  atlasTexturen.set(seite, t);
  return t;
}

function buildBlockGroup(blockIndex: number, cell: { col: number; row: number }): Group {
  const gruppe = new Group();
  const block = data?.terrain?.blocks[blockIndex];
  if (!block) return gruppe;
  const satz = weltDarstellung === 'textured' ? (data?.worldTextures ?? null) : null;
  block.meshes.forEach((mesh, meshIndex) => {
    if (!mesh) return;
    const geo = buildTexturedMeshGeometry(mesh, blockIndex, meshIndex, GRID, {
      ...(satz ? { table: satz.table, atlas: satz.atlas } : {}),
      cellOverride: cell,
    });
    /**
     * Nach Atlasseite trennen. 255 heißt „keine Zelle" — diese Dreiecke gehen
     * in die Klassenfarben-Darstellung, statt mit einer falschen UV zu laufen.
     * WM0 braucht heute genau eine Seite; die Aufteilung steht trotzdem hier,
     * weil sie sonst beim ersten Mehrseiten-Atlas still falsch wäre.
     */
    const seiten = new Map<number, number[]>();
    for (let t = 0; t < geo.triCount; t++) {
      const seite = satz ? geo.atlasPages[t]! : 255;
      let liste = seiten.get(seite);
      if (!liste) {
        liste = [];
        seiten.set(seite, liste);
      }
      liste.push(t);
    }
    for (const [seite, dreiecke] of seiten) {
      const positions = new Float32Array(dreiecke.length * 9);
      dreiecke.forEach((t, i) => positions.set(geo.positions.subarray(t * 9, t * 9 + 9), i * 9));
      const bg = new BufferGeometry();
      bg.setAttribute('position', new BufferAttribute(positions, 3));
      const textur = seite === 255 ? null : atlasTextur(seite);
      if (textur) {
        const uvs = new Float32Array(dreiecke.length * 6);
        dreiecke.forEach((t, i) => uvs.set(geo.uvs.subarray(t * 6, t * 6 + 6), i * 6));
        bg.setAttribute('uv', new BufferAttribute(uvs, 2));
        // Unbeleuchtet und OHNE Backface-Culling — die Weltmeshes sind nicht
        // durchgehend gleich gewickelt.
        gruppe.add(new Mesh(bg, new MeshBasicMaterial({ map: textur, alphaTest: 0.5, side: DoubleSide })));
        continue;
      }
      const farben = new Float32Array(dreiecke.length * 9);
      dreiecke.forEach((t, i) => {
        const idx = weltDarstellung === 'region' ? geo.locationIds[t]! : geo.walkClasses[t]!;
        const farbe = KLASSENFARBEN[idx % KLASSENFARBEN.length]!;
        for (let k = 0; k < 3; k++) {
          farben[i * 9 + k * 3] = farbe.r;
          farben[i * 9 + k * 3 + 1] = farbe.g;
          farben[i * 9 + k * 3 + 2] = farbe.b;
        }
      });
      bg.setAttribute('color', new BufferAttribute(farben, 3));
      bg.computeVertexNormals();
      gruppe.add(new Mesh(bg, new MeshLambertMaterial({ vertexColors: true })));
    }
  });
  return gruppe;
}

/** Darstellungsart wechseln und alle residenten Blöcke neu bauen. */
function setzeWeltDarstellung(art: WeltDarstellung): void {
  weltDarstellung = art;
  for (const [key, g] of residentBlocks) {
    worldTerrainGroup.remove(g);
    g.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        // Die geteilte Atlastextur wird NICHT entsorgt — nur das Material.
        (o.material as MeshLambertMaterial).dispose();
      }
    });
    residentBlocks.delete(key);
  }
  streamer.clear(); // Residenz vergessen, sonst gilt jeder Block als „schon da"
  if (worldSession) {
    for (const slot of streamer.update(worldSession.x, worldSession.z).load) {
      const g = buildBlockGroup(slot.blockIndex, slot.cell);
      residentBlocks.set(slot.key, g);
      worldTerrainGroup.add(g);
    }
  }
  setStatus(`Weltkarten-Darstellung: ${art}`);
}

// --- Takt + Render -----------------------------------------------------------------

let tickCounter = 0;
/**
 * Eingaben der Wirtstakte, in denen KEIN Kampftakt faellig war (der Kampf
 * laeuft mit 15 Hz in einer 30-Hz-Schleife). Ohne diesen Puffer verschwaende
 * jeder zweite Tastendruck.
 */
const kampfEingabePuffer = new Set<SemanticAction>();

function tick(): void {
  tickCounter++;
  if (hintergrundAnim) {
    hintergrundAnim.takt++;
    setzeHintergrundZustand();
  }
  sampler.setContext(activeContext());
  const frame = sampler.sampleTick();
  if (battle) {
    /**
     * **Kampf-Bildrate (gemessen, dann geaendert).** Das Original begrenzt
     * den Kampf auf 15 fps, Field und Weltkarte auf 30
     * (`docs/fremdquellen/ffnx.md`, `ff7_limit_fps`). Bis hierher lief der
     * Kampf in DIESER 30-Hz-Schleife mit, also doppelt so schnell wie im
     * Original. `isBattleTickDue` halbiert ihn.
     *
     * Der Replay-Digest bleibt davon unberuehrt: Die `BattleSession` kennt
     * keine Wanduhr, ihr Zustand haengt nur an der Zahl der Takte und an den
     * Eingaben (belegt in `packages/battle-runtime/src/rate.test.ts`).
     * Geaendert hat sich die Geschwindigkeit, nicht die Rechnung.
     *
     * Eingaben duerfen dabei nicht verlorengehen: Tastendruecke der
     * uebersprungenen Wirtstakte werden gesammelt und beim naechsten
     * Kampftakt mitgegeben.
     */
    for (const a of frame.pressed) kampfEingabePuffer.add(a);
    if (isBattleTickDue(tickCounter - 1)) {
      const gepuffert: ActionFrame = { ...frame, pressed: [...kampfEingabePuffer].sort() as typeof frame.pressed };
      kampfEingabePuffer.clear();
      battleTick(gepuffert);
    }
    return;
  }
  if (battleStub) {
    battleStubTick(frame);
    return;
  }
  if (menuSession) {
    menuTick(frame);
    return;
  }
  if (frame.pressed.includes('menu') && mode !== 'boot') {
    openMenu(null);
    return;
  }
  if (dialogVisibleId !== null) {
    dialogTick(frame);
    // Dialog blockiert die Feldbewegung; die Sitzung läuft weiter (wartet).
    fieldTick(NEUTRAL_INPUT);
    return;
  }
  if (mode === 'field') fieldTick(toFieldInput(frame));
  else if (mode === 'world') worldTick(frame);
}

let accumulator = 0;
let lastFrame = performance.now();

function frame(now: number): void {
  accumulator = Math.min(accumulator + (now - lastFrame), MAX_ACCUMULATOR_MS);
  lastFrame = now;
  while (accumulator >= TICK_DT_MS) {
    tick();
    accumulator -= TICK_DT_MS;
  }
  render();
  updateReadout();
  requestAnimationFrame(frame);
}

function render(): void {
  if (battle) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.render(battleScene3, battleCamera);
    return;
  }
  if (mode === 'world' && worldSession) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    const pose = followCameraPose(worldSession.x, worldSession.z, worldSession.h, (worldSession.heading * 360) / 256);
    worldCamera.position.set(...pose.position);
    worldCamera.lookAt(...pose.target);
    renderer.render(worldScene, worldCamera);
  } else if (mode === 'field' && fieldCamera) {
    compositor.render(fieldScene, fieldCamera);
  }
}

function updateReadout(): void {
  const lines: string[] = [];
  lines.push(`Modus            ${mode}${battleStub ? ' + Kampf-Stub' : ''}${menuSession ? ' + Menü' : ''}${dialogVisibleId !== null ? ' + Dialog' : ''}`);
  if (mode === 'field') {
    const p = fieldSession?.player;
    lines.push(`Field            ${fieldName || '(keins)'}`);
    lines.push(`Takt             ${fieldSession?.tickCounter ?? 0}`);
    lines.push(
      p
        ? `Position         Tri=${p.walk.tri} x=${p.walk.x.toFixed(0)} y=${p.walk.y.toFixed(0)} z=${p.walk.height.toFixed(0)} Blick=${p.facing.toFixed(0)}°`
        : 'Position         (keine Figur)',
    );
    const actors = fieldSession?.runtime?.state.actors ?? [];
    lines.push(`NPC sichtbar     ${actors.filter((a) => a.visible && a.position).length}/${actors.length}`);
    lines.push(`Dialoge offen    ${fieldSession?.pendingDialogs().length ?? 0}`);
  } else if (mode === 'world' && worldSession) {
    lines.push(`Position         x=${worldSession.x.toFixed(0)} z=${worldSession.z.toFixed(0)} h=${worldSession.h.toFixed(0)} Kurs=${worldSession.heading}`);
    lines.push(`Fahrzeug         ${worldSession.vehicle.id}`);
    lines.push(`Takt             ${worldSession.tickCounter}  blockiert=${lastWorldResult?.blocked ?? false}`);
    lines.push(`Terrain resident ${residentBlocks.size} Blöcke`);
    lines.push(`Encounter-Checks ${worldEncounterChecks}`);
  }
  if (fieldWarnings.length && mode === 'field') {
    lines.push('Hinweise:');
    lines.push(...fieldWarnings.map((w) => `  - ${w}`));
  }
  if (hostLog.length) {
    lines.push('Ereignisse:');
    lines.push(...hostLog.map((l) => `  ${l}`));
  }
  readoutEl.textContent = lines.join('\n');
}

// --- Boot ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  data = await bootGameData(setStatus);
  if (!data) return;
  // Die drei Ketten, die sich früher still selbst verdeckt haben, melden sich
  // beim Start: Namenszuordnung, Weltscript-Paarung, Einstiegstabelle.
  log(data.kernelHinweis);
  /**
   * F07: Der laufende Spielstand ist ab hier eine **eigene Kopie**. Die Datei
   * des Nutzers bleibt unberührt — geschrieben wird nur in den eigenen,
   * versionierten Spielstandsplatz.
   */
  savemapBytes = data.savemapRaw ? data.savemapRaw.slice() : null;
  savemapAktuell = data.savemap;
  log(
    savemapBytes
      ? 'Spielstand geladen — Ausrüsten und Speichern sind freigegeben'
      : 'Kein Spielstand in der Installation gefunden — das Menü bleibt lesend',
  );
  const schrift = buildFontContext(data.windowBin);
  fontKontext = schrift.kontext;
  log(schrift.hinweis);
  log(
    `Weltscript ${data.worldChoice.evName}${data.worldChoice.evArchive ? ` (${data.worldChoice.evArchive})` : ''}: ` +
      `${data.worldChoice.meshFunctions} Mesh-Funktionen`,
  );
  log(data.fieldTable ? `field.tbl: ${data.fieldTable.records.length} Datensätze` : 'field.tbl fehlt — 0x318 bleibt roh');
  actorLib = createActorLibrary((name) => data!.readCharEntry(name), {
    // F21: fehlende Teilressourcen zählen, statt sie nur magenta zu zeichnen.
    onMissing: (info) => {
      const key = `${info.kind}:${info.name}`;
      modellFehlstellen.set(key, {
        ...info,
        anzahl: (modellFehlstellen.get(key)?.anzahl ?? 0) + 1,
      });
    },
  });
  partySpecs = data.savemap ? partyFromSavemap(data.savemap) : defaultParty();
  /**
   * N7: Die EXP-Kurven fuer den Ergebnisbildschirm stehen in Sektion 2 von
   * KERNEL.BIN. Fehlt sie, zeigt der Bildschirm EXP/AP/Gil und beim Level
   * NICHTS — statt eine Schwelle zu erfinden.
   */
  const growthRoh = data.kernelSections?.[2];
  growth = growthRoh ? parseGrowthSection(growthRoh, 'KERNEL.BIN/2', []) : null;
  if (!growth) log('Growth-Sektion nicht lesbar — Ergebnisbildschirm ohne Stufenaufstieg');
  progressById.clear();
  battleStarter = data.scenes
    ? createEncounterBattleStarter({ scenes: data.scenes, party: partySpecs, seed: 0x51ed })
    : null;
  selectEl.innerHTML = data.fieldNames.map((n) => `<option value="${n}">${n}</option>`).join('');
  selectEl.disabled = false;
  enterBtn.disabled = false;
  toWorldBtn.disabled = false;
  const param = new URLSearchParams(location.search).get('field');
  const start = param && data.fieldNames.includes(param)
    ? param
    : data.fieldNames.includes(START_FIELD_DEFAULT)
      ? START_FIELD_DEFAULT
      : data.fieldNames[0]!;
  await enterField(start);
}

enterBtn.addEventListener('click', () => void enterField(selectEl.value));
toWorldBtn.addEventListener('click', () => enterWorld());

void boot();
requestAnimationFrame(frame);

// --- Automatisierungshaken ----------------------------------------------------------

/** Erste Tastenbelegung einer Aktion im aktiven Kontext (für hold/release). */
function codeForAction(action: SemanticAction): string | null {
  const set = bindings[activeContext()];
  if (!set) return null;
  for (const [code, a] of Object.entries(set.keyboard)) if (a === action) return code;
  return null;
}

(window as unknown as { gameDebug: unknown }).gameDebug = {
  ready: (): boolean => data !== null && mode !== 'boot',
  mode: (): string => mode,
  stats: (): object => ({
    mode,
    field: fieldName,
    fieldTick: fieldSession?.tickCounter ?? 0,
    player: fieldSession?.player
      ? {
          tri: fieldSession.player.walk.tri,
          x: fieldSession.player.walk.x,
          y: fieldSession.player.walk.y,
          height: fieldSession.player.walk.height,
          facing: fieldSession.player.facing,
        }
      : null,
    npcVisible: (fieldSession?.runtime?.state.actors ?? []).filter((a) => a.visible && a.position).length,
    pendingDialogs: fieldSession?.pendingDialogs() ?? [],
    world: worldSession
      ? { x: worldSession.x, z: worldSession.z, h: worldSession.h, heading: worldSession.heading, vehicle: worldSession.vehicle.id, encounterChecks: worldEncounterChecks }
      : null,
    battleStub: battleStub ? { ...battleStub } : null,
    battle: battle
      ? {
          encounterId: battle.encounterId,
          awaiting: [...battle.awaiting],
          outcome: battle.outcomeKind,
          rewards: battle.rewards,
          actors: [...battle.partyIds, ...battle.enemyIds].map((id) => {
            const a = battle!.session.actor(id);
            return { id, hp: a?.hp ?? 0, atb: a?.atb ?? 0 };
          }),
          log: [...battle.eventLog],
        }
      : null,
    menuOpen: menuSession !== null,
    dialogVisible: dialogVisibleId,
    warnings: [...fieldWarnings],
    log: [...hostLog],
  }),
  actors: (): object[] =>
    (fieldSession?.runtime?.state.actors ?? []).map((a, i) => ({
      i,
      modelIndex: a.modelIndex,
      partyMember: a.partyMember,
      visible: a.visible,
      position: a.position,
      triangle: a.triangle,
      direction: a.direction,
      animation: a.animation,
      hatModell: actorHandles.has(i),
    })),
  /**
   * F22/F23-Messung: Verteilung der noch ungedeuteten Bytes des 52-B-
   * Tile-Records. Erwartet werden dort Animationsparameter, Animationszustand
   * und Mischmodus — belegt ist das nicht, also wird gezählt statt geraten.
   */
  tileBytes: (): object => {
    const layers = fieldBundle?.background?.layers ?? [];
    const verteilung: Record<number, Record<number, number>> = {};
    let gesamt = 0;
    for (const l of layers) {
      for (const t of l.tiles) {
        gesamt++;
        for (let off = 0; off < t.raw.length; off++) {
          (verteilung[off] ??= {})[t.raw[off]!] = ((verteilung[off] ?? {})[t.raw[off]!] ?? 0) + 1;
        }
      }
    }
    // Nur Offsets zeigen, die überhaupt variieren (konstante sind uninteressant).
    const bunt: Record<number, { werte: number; top: [string, number][] }> = {};
    for (const [off, w] of Object.entries(verteilung)) {
      const eintraege = Object.entries(w).sort((a, b) => b[1] - a[1]);
      if (eintraege.length > 1) bunt[Number(off)] = { werte: eintraege.length, top: eintraege.slice(0, 4) };
    }
    return { field: fieldName, tiles: gesamt, layer: layers.map((l) => ({ i: l.index, tiles: l.tiles.length })), bunt };
  },
  /** F22: Hintergrund-Zustandsbits der Script-Opcodes (BGON/BGOFF). */
  bgZustaende: (): object => ({ ...(fieldSession?.runtime?.state.bgStates ?? {}) }),
  /**
   * W1: Welches Weltscript liegt wirklich an? Erwartet `wm0.ev` mit 49
   * Mesh-Funktionen. Vorher lieferte die TOC-Reihenfolge `wm2.ev` (1
   * Mesh-Funktion, Unterwasserkarte) zum WM0-Terrain.
   */
  weltScript: (): object => ({
    karte: data?.worldChoice.id ?? null,
    kartendatei: data?.worldChoice.mapFile ?? null,
    script: data?.worldChoice.evName ?? null,
    archiv: data?.worldChoice.evArchive ?? null,
    meshFunktionen: data?.worldChoice.meshFunctions ?? 0,
    funktionenGesamt: data?.worldEv?.functions.length ?? 0,
    fieldTblDatensaetze: data?.fieldTable?.records.length ?? 0,
    fieldTblBelegt:
      data?.fieldTable?.records.filter((r) => !r.default.empty || !r.alternative.empty).length ?? 0,
  }),
  /**
   * F09-A: aufgelöste musicId je MUSIC-Aufruf, jüngste zuletzt. `reason`
   * kommt unverändert aus `resolveFieldMusic` — eine stille Null gibt es nicht.
   */
  musik: (): object => ({
    kontext: audioCtx === null ? null : 'AudioContext',
    gate: music?.state.gate ?? null,
    aktuellerTitel: music?.state.currentTrack ?? null,
    titelkeller: [...(music?.state.trackStack ?? [])],
    fieldMusicId,
    schleifenplan: music?.current
      ? {
          trackId: music.current.trackId,
          reason: music.current.plan.reason,
          loopStartSekunden: Math.round(music.current.loopStartSeconds * 1000) / 1000,
          loopEndSekunden: Math.round(music.current.loopEndSeconds * 1000) / 1000,
        }
      : null,
    aufloesungen: musikProtokoll.map((m) => ({ ...m })),
  }),
  /**
   * K6: Kampf ohne Zufallsbegegnung starten — sonst ist das HUD nur durch
   * minutenlanges Umherlaufen erreichbar und damit nicht automatisierbar.
   */
  starteKampf: (encounterId = 8): void => openBattle(encounterId, null, 'field'),
  /**
   * K6/N7/K7: Zustand des Kampf-HUD als Daten — Fensterkanten, Balkenstaende,
   * Trefferzahlen und die Effektabdeckung. Damit ist die Darstellung ohne
   * Screenshot pruefbar.
   */
  kampfHud: (): object => {
    if (!battle) return { aktiv: false, taktrateHz: BATTLE_TICK_HZ };
    const boxen = battle.result
      ? resultBoxes({ ...battle.result, page: battle.resultPage })
      : hudBoxes(hudModel());
    const kante = (id: string): object | null => {
      const b = boxen.find((x) => x.id === id);
      return b ? { x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h, text: b.text ?? null } : null;
    };
    return {
      aktiv: true,
      taktrateHz: BATTLE_TICK_HZ,
      ergebnisbildschirm: battle.result ? { seite: battle.resultPage, seiten: battle.result.messages.length } : null,
      fenster: {
        status: kante('status.window'),
        anzeigen: kante('gauge.window'),
        kommando: kante('command.window'),
        meldung: kante('message.window'),
      },
      zeile0: {
        name: kante('row0.name'),
        hp: kante('row0.hp'),
        zeitbalken: kante('row0.time.frame'),
        zeitfuellung: kante('row0.time.fill'),
      },
      trefferzahlen: boxen.filter((b) => b.kind === 'floater').map((b) => ({ text: b.text, opacity: b.opacity })),
      effektabdeckung: battle.view.view.effectCoverage,
      kastenZahl: boxen.length,
    };
  },
  /** K1/K2: Teile und Texturen je geladenem Battle-Präfix. */
  battleModelle: (): object => ({
    geladen: [...battleModellProtokoll.values()],
    teileGesamt: [...battleModellProtokoll.values()].reduce((s, m) => s + m.teile, 0),
  }),
  /**
   * K5: Welche Bühne trägt der laufende Kampf? `ersatz: true` heißt, dass die
   * schwarze Ersatzscheibe steht — im Originalbestand darf das nicht vorkommen.
   */
  kampfBuehne: (): object => ({
    ...stageProtokoll,
    bandGroesse: data?.listBattlePrefixes().filter((p) => p >= 'og' && p <= 'rr').length ?? 0,
    partyModelle: (data?.savemap?.party ?? [])
      .filter((x): x is number => x !== null)
      .map((cid) => ({ charakterId: cid, prefix: partyModelPrefix(cid), label: partyModelByPrefix(partyModelPrefix(cid) ?? '')?.label ?? null })),
    kinderImKampf: battleGroup.children.length,
  }),
  /**
   * F24-B: Menüansicht von außen wählen — sonst ist jede Unteransicht nur
   * über eine Tastenfolge erreichbar und damit nicht automatisierbar.
   * Ohne offenes Menü wird eines geöffnet.
   */
  /**
   * F07: Was steht gerade im laufenden Spielstand? Die Menüansicht zeigt nur
   * die erste Zeile je Fenster; für die Abnahme einer **Schreibhandlung**
   * braucht es den Wert selbst.
   */
  spielstand: (): object => ({
    bytes: savemapBytes?.length ?? null,
    ausruestung: (savemapAktuell?.characters ?? []).slice(0, 3).map((c) => ({
      name: c.name,
      waffe: c.weapon,
      ruestung: c.armor,
      accessoire: c.accessory,
    })),
    inventarWaffen: (savemapAktuell?.inventory ?? [])
      .filter((e) => e.itemId >= 128 && e.itemId < 256)
      .map((e) => `${e.itemId}×${e.count}`),
    speicherplaetze: saveUebersicht,
  }),
  menueAnsicht: (view?: string): object => {
    if (!menuSession) openMenu(null);
    if (view) {
      if (!VIEW_ORDER.includes(view as MenuViewId) && view !== 'main') {
        return { fehler: `unbekannte Ansicht ${view}`, moeglich: ['main', ...VIEW_ORDER] };
      }
      menuSession!.open(view as MenuViewId);
      renderMenu();
    }
    const bild = menuSession!.screen();
    return {
      ansicht: menuSession!.state.view,
      wurzel: menuSession!.state.root,
      zeiger: menuSession!.state.cursor,
      metrikGemessen: bild?.metricsMeasured ?? null,
      hinweise: bild?.notes ?? [],
      fenster:
        bild?.panels.map((p) => ({
          id: p.id,
          rect: p.rect,
          zeilen: p.lines.length,
          erstesLabel: p.lines[0]?.runs[0]?.text ?? null,
        })) ?? [],
      kaesten: bild ? menuBoxes(bild).length : 0,
    };
  },
  /** F11b/F25: Darstellungsart der Weltkarte umschalten und lesen. */
  setWeltDarstellung: (art: WeltDarstellung): object => {
    setzeWeltDarstellung(art);
    return { art: weltDarstellung };
  },
  weltTexturen: (): object => {
    const satz = data?.worldTextures;
    return {
      art: weltDarstellung,
      hinweis: data?.worldTexturHinweis ?? null,
      verfuegbar: satz !== null && satz !== undefined,
      bericht: satz
        ? {
            ...satz.report,
            misfits: satz.report.misfits.length,
            unresolved: satz.report.unresolved.length,
            missingImages: satz.report.missingImages.length,
          }
        : null,
      atlasSeiten: satz?.atlas.atlases.length ?? 0,
      atlasGroesse: satz?.atlas.size ?? 0,
      residenteBloecke: residentBlocks.size,
    };
  },
  /** K1/K2: Namensraum eines Präfixes, so wie der Lader ihn sieht. */
  battlePraefix: (prefix: string): object => ({
    prefix,
    eintraege: data?.listBattleEntries(prefix) ?? [],
  }),
  /**
   * K1/K2: Ein Battle-Modell probeweise über die Auflistung laden und die
   * Klassifikation melden. Erwartungswert für Cloud (`rt`): 33 Teile
   * (17 Körper + 16 Waffen) und 2 Texturen — vorher waren es 3 und 0.
   *
   * Bewusst KEINE Party-Verdrahtung: welcher Party-Platz welches Präfix trägt,
   * ist im Baum nirgends gemessen (🔴). Diese Sonde macht den Ladepfad prüfbar,
   * ohne eine Zuordnung zu erfinden.
   */
  battleModellProbe: async (prefix: string): Promise<object | null> => {
    if (!data) return null;
    const eintraege = data.listBattleEntries(prefix).length;
    const files = await loadBattleModel(prefix, data);
    if (!files) return { prefix, geladen: false, eintraege };
    return {
      prefix,
      geladen: true,
      eintraege,
      teile: files.parts.length,
      texturen: files.textures.filter((t) => t !== null).length,
      texturSlots: files.textures.length,
      bones: files.skeleton.boneCount,
    };
  },
  /** F18: Inventarnamen-Auflösung samt Grund (Bereiche 0/128/256/288). */
  itemNamen: (ids: number[] = [0, 128, 215, 257, 307]): object => ({
    hinweis: data?.kernelHinweis ?? null,
    namen: ids.map((id) => ({ id, name: data?.itemName(id) ?? null })),
  }),
  /**
   * F06: Ziel und Ankunftspunkt eines field.tbl-Datensatzes (1-basiert, wie der
   * Opcode 0x318 sie trägt) — damit ist die Kette ohne Skriptlauf sichtbar.
   */
  fieldTblEintrag: (record: number, scenario: 0 | 1 = 0): object | null => {
    if (!data?.fieldTable) return null;
    const eintrag = fieldTblEntryForOpcode(data.fieldTable, record, scenario);
    if (!eintrag) return null;
    return {
      record,
      scenario,
      fieldId: eintrag.fieldId,
      ziel: data.fieldNameByMaplist(eintrag.fieldId),
      x: eintrag.x,
      y: eintrag.y,
      triangle: eintrag.triangle,
      direction: eintrag.direction,
      leer: eintrag.empty,
    };
  },
  /**
   * Welle 2: Textmetrik und Fensterschale von außen prüfbar machen.
   *
   * `textMetrik().gemessen === false` bedeutet, dass die Fenster mit der
   * Ersatzmetrik bemessen werden — der Grund steht daneben. Genau diese
   * Sichtbarkeit fehlte, solange FALLBACK_GLYPHS still eingesprungen ist.
   */
  textMetrik: (): object => {
    const m = data?.textMetrik;
    if (!m) return { fehler: 'keine Daten geladen' };
    return {
      gemessen: m.measured,
      hinweis: data!.windowHinweis,
      diagnose: m.diagnostic,
      polsterung: m.spacing.padding,
      namensplatzhalter: m.spacing.widths[0xea],
      breiteO: m.spacing.widths[0x2f],
      breiteI: m.spacing.widths[0x49],
      windowBinDiagnosen: data!.windowBin?.diagnostics.map((d) => d.code) ?? null,
      sektionen:
        data!.windowBin?.sections.map((sek) => ({
          komprimiert: sek.compressedLength,
          entpackt: sek.data.length,
          kopfLaenge: sek.declaredLength,
        })) ?? null,
      fontblatt: data!.windowBin?.fontTexture
        ? { breite: data!.windowBin.fontTexture.width, hoehe: data!.windowBin.fontTexture.height }
        : null,
    };
  },
  /**
   * Misst einen Dialog des laufenden Fields nach der Originalregel und
   * vergleicht ihn mit der Ersatzmetrik — die Gegenprobe im Browser.
   */
  fensterMass: (index: number): object | null => {
    const script = fieldBundle?.script;
    const section = fieldBundle?.rawSections[1];
    if (!script || !section || !data) return null;
    const off = script.stringOffsets[index];
    if (off === null || off === undefined) return null;
    const start = script.stringTableOffset + off;
    let end = start;
    while (end < section.length && section[end] !== 0xff) end++;
    const roh = section.subarray(start, end);
    const echt = measureFfWindow(roh, data.textMetrik.spacing);
    const ersatz = measureFfWindow(roh, FALLBACK_SPACING);
    return {
      index,
      bytes: roh.length,
      gemessen: { breite: echt.width, zeilen: echt.lines, hoehe: echt.height, seiten: echt.pages },
      ersatzmetrik: { breite: ersatz.width, zeilen: ersatz.lines },
      aussenmass: windowOuterSize(echt.width, echt.lines),
    };
  },
  /** Die Fensterschale, wie die UI sie anwendet (Welle 2, Teil 2/3). */
  fensterschale: (modus = 0): object => ({
    modus,
    css: windowSkinCss(modus as WindowDisplayMode),
    slots: [...windowShell.slots.values()],
    renderflaeche: RENDER_SURFACE,
  }),
  /** F27-Messung: Spieleranimation setzen und Wurzellage nach dem Binden melden. */
  spielerProbe: async (animId: number): Promise<object> => {
    if (!playerHandle) return { fehler: 'kein Spielermodell' };
    spielerAnim = animId;
    playerHandle.setAnimation(animId, 1, true);
    await playerHandle.whenAnimationSettled();
    for (let i = 0; i < 3; i++) playerHandle.advanceTick();
    const a = playerHandle.actor;
    a.root.updateMatrixWorld(true);
    const hoch = new Vector3(0, 0, 1).transformDirection(a.model.matrixWorld);
    return {
      animId,
      modelRotGrad: a.model.rotation.toArray().slice(0, 3).map((v) => Math.round((v as number) * 57.296)),
      modelPos: a.model.position.toArray().map((v) => Math.round(v * 100) / 100),
      hochWelt: hoch.toArray().map((v) => Math.round(v * 1000) / 1000),
      boneSum: Math.round(
        a.boneGroups.reduce((s, b) => s + Math.abs(b.rotation.x) + Math.abs(b.rotation.y) + Math.abs(b.rotation.z), 0) * 57.296,
      ),
    };
  },
  /** F29-Messung: Rohbytes eines Dialogstrings (hex), um Funktionscodes zu belegen. */
  dialogRoh: (index: number, laenge = 48): string | null => {
    const script = fieldBundle?.script;
    const section = fieldBundle?.rawSections[1];
    if (!script || !section) return null;
    const off = script.stringOffsets[index];
    if (off === null || off === undefined) return null;
    const start = script.stringTableOffset + off;
    return [...section.slice(start, start + laenge)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  },
  /** Diagnose: Eintrag aus char.lgp lesen (Gegenstück zu readBattle). */
  readChar: async (name: string): Promise<number | null> => {
    const bytes = await data?.readCharEntry(name);
    return bytes ? bytes.length : null;
  },
  models: (): object => ({
    manifest: fieldBundle?.models
      ? {
          scaleGlobal: fieldBundle.models.scaleGlobal,
          models: fieldBundle.models.models.map((m) => ({
            name: m.name,
            file: m.modelFile,
            scale: m.scale,
            anims: m.animations.length,
            animFiles: m.animations.map((a) => a.file),
          })),
        }
      : null,
    playerLoaded: playerHandle !== null,
    npcLoaded: [...actorHandles.keys()],
  }),
  /**
   * F28-Messung: Wie groß landet eine Figur auf dem Schirm?
   *
   * Die Modellskala ist bestandsweit 512/512 = 1, die scheinbare Größe hängt
   * also allein an der Projektion. Diese Sonde liefert die Kennzahlen, mit
   * denen sich „Figur zu klein" von „Kamera falsch" trennen lässt.
   */
  kameraSonde: (): object => {
    if (!fieldCamera || !fieldSession?.player) return { fehler: 'keine Kamera/Figur' };
    const p = fieldSession.player;
    const welt = ff7ToScene([p.walk.x, p.walk.y, p.walk.height]);
    const pos = new Vector3(welt[0], welt[1], welt[2]);
    const abstand = fieldCamera.position.distanceTo(pos);
    const fovY = (fieldCamera.fov * Math.PI) / 180;
    // Höhe eines 100-Einheiten-Objekts in Design-Pixeln (240 hoch) an dieser Stelle
    const sichtHoehe = 2 * Math.tan(fovY / 2) * abstand;
    const bbox = new Box3().setFromObject(playerHandle?.actor.root ?? playerActor.root);
    const figurHoehe = bbox.max.y - bbox.min.y;
    return {
      field: fieldName,
      fovGrad: Math.round(fieldCamera.fov * 100) / 100,
      abstand: Math.round(abstand),
      sichtHoeheBeiFigur: Math.round(sichtHoehe),
      figurHoeheWelt: Math.round(figurHoehe * 100) / 100,
      figurPixel480: Math.round((figurHoehe / sichtHoehe) * 480),
      anteilBildhoehe: Math.round((figurHoehe / sichtHoehe) * 1000) / 1000,
    };
  },
  /**
   * F28-Kalibrierung: Figurenmaßstab zur Laufzeit ändern, um ihn gegen
   * Original-Screenshots einzumessen. Kein Dauerzustand — der ermittelte Wert
   * gehört danach als belegte Konstante in die Modellkette.
   */
  setFigurSkala: (faktor: number): void => {
    figurSkala = faktor;
    for (const h of actorHandles.values()) h.actor.root.scale.setScalar(faktor);
    if (playerHandle) playerHandle.actor.root.scale.setScalar(faktor);
  },
  /** F21-Sonde: Materialien der gezeichneten Field-Figuren (Textur ja/nein, Farbe). */
  materialSonde: (): object =>
    [...actorHandles.entries()].map(([i, h]) => {
      const meshes: { mat: string; hatMap: boolean; farbe: string; vertexColors: boolean }[] = [];
      h.actor.root.traverse((o) => {
        const m = o as { isMesh?: boolean; material?: unknown };
        if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as {
          type: string;
          map?: unknown;
          color?: { getHexString(): string };
          vertexColors?: boolean;
        }[]) {
          meshes.push({
            mat: mat.type,
            hatMap: !!mat.map,
            farbe: mat.color ? mat.color.getHexString() : '—',
            vertexColors: !!mat.vertexColors,
          });
        }
      });
      const magenta = meshes.filter((m) => m.farbe === 'ff00ff').length;
      // Wohin zeigt die FF7-Hochachse nach root UND model? (0,1,0) = aufrecht.
      const hochRoot = new Vector3(0, 0, 1).applyQuaternion(h.actor.root.quaternion);
      h.actor.root.updateMatrixWorld(true);
      const hochWelt = new Vector3(0, 0, 1).transformDirection(h.actor.model.matrixWorld);
      return {
        actor: i,
        meshes: meshes.length,
        magenta,
        mitTextur: meshes.filter((m) => m.hatMap).length,
        hochRoot: hochRoot.toArray().map((v) => Math.round(v * 1000) / 1000),
        hochWelt: hochWelt.toArray().map((v) => Math.round(v * 1000) / 1000),
        modelRot: h.actor.model.rotation.toArray().slice(0, 3).map((v) => Math.round((v as number) * 57.3)),
        // Bindpose = alle Bone-Rotationen 0. Eine echte Animation ist ≠ 0.
        boneRotSumme: Math.round(
          h.actor.boneGroups.reduce(
            (s, b) => s + Math.abs(b.rotation.x) + Math.abs(b.rotation.y) + Math.abs(b.rotation.z),
            0,
          ) * 57.3,
        ),
        bones: h.actor.boneGroups.length,
      };
    }),
  /**
   * F21: Warum ist eine Figur magenta? Zwei Quellen, im Bild ununterscheidbar —
   * `ersatzkapseln` sind Actors ohne geladenes Modell, `fehlstellen` sind
   * übersprungene Teilressourcen geladener Modelle (fehlende `.tex` ⇒
   * Platzhaltermaterial).
   */
  platzhalter: (): object => {
    const sichtbar = (fieldSession?.runtime?.state.actors ?? [])
      .map((a, i) => ({ i, modelIndex: a.modelIndex, sichtbar: a.visible && !!a.position, partyMember: a.partyMember }))
      .filter((a) => a.sichtbar && a.partyMember !== 0);
    return {
      field: fieldName,
      sichtbareActors: sichtbar.length,
      mitModell: sichtbar.filter((a) => actorHandles.has(a.i)).length,
      ersatzkapseln: sichtbar.filter((a) => !actorHandles.has(a.i)).map((a) => ({ i: a.i, modelIndex: a.modelIndex })),
      fehlstellen: [...modellFehlstellen.values()],
    };
  },
  gateways: (): object[] =>
    (fieldBundle?.triggers?.gateways ?? [])
      .map((g, i) => ({
        i,
        used: g.used,
        austritt: g.exitPoint,
        ziel: g.destPoint,
        dest: g.destMaplistIndex,
        destName: data?.fieldNameByMaplist(g.destMaplistIndex) ?? null,
      }))
      .filter((g) => g.used),
  placeAt: (x: number, y: number): boolean => fieldSession?.placeAt(x, y) ?? false,
  readBattle: async (name: string): Promise<number | null> => {
    const bytes = await data?.readBattleEntry(name);
    return bytes ? bytes.length : null;
  },
  battleCameraInfo: (): object => ({
    pos: battleCamera.position.toArray(),
    kinder: battleGroup.children.map((k) => ({ typ: k.type, name: k.name, pos: k.position.toArray() })),
  }),
  enterField: (name: string): Promise<boolean> => enterField(name),
  toWorld: (): void => enterWorld(),
  toField: (): void => toggleWorld(),
  stepTicks: (n: number): void => {
    for (let i = 0; i < n; i++) tick();
    render();
    updateReadout();
  },
  pressKey: (code: string, down: boolean): void => keyboardFeed.handleKey(code, down),
  hold: (action: SemanticAction): boolean => {
    const code = codeForAction(action);
    if (code) keyboardFeed.handleKey(code, true);
    return code !== null;
  },
  release: (action: SemanticAction): boolean => {
    const code = codeForAction(action);
    if (code) keyboardFeed.handleKey(code, false);
    return code !== null;
  },
  releaseAll: (): void => keyboardFeed.clear(),
};
