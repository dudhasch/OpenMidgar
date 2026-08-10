import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
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
  type TickResult,
} from '@webmidgar/field-runtime';
import type { FieldBundle } from '@webmidgar/formats-field';
import type { HostRequest } from '@webmidgar/interpreter';
import {
  buildFallbackActor,
  createActorLibrary,
  setActorFacing,
  type Actor,
  type ActorLibrary,
  type FieldActorHandle,
} from '@webmidgar/render-actor';
import { WORLD_GRIDS } from '@webmidgar/formats-world';
import {
  WorldSession,
  toWorldInput,
  type WorldLocation,
  type WorldTickResult,
} from '@webmidgar/world-runtime';
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
  type ActionFrame,
  type InputContextId,
  type SemanticAction,
} from '@webmidgar/input';
import {
  createEncounterBattleStarter,
  defaultParty,
  encodeOutcome,
  partyFromSavemap,
  type BattleSession,
  type BattleStarter,
  type BattleTickInput,
  type PartyMemberSpec,
} from '@webmidgar/battle-runtime';
import {
  applyBattleCamera,
  buildBattleActor,
  buildSubstituteStage,
  loadBattleModel,
  parseCameraBlock,
  placeFormation,
  placeParty,
} from '@webmidgar/render-battle';
import { enemyModelPrefix, formationAddress } from '@webmidgar/formats-battle';
import { Box3, BoxGeometry, Vector3 } from 'three';
import { MenuSession, NEUTRAL_MENU_INPUT, type MenuData, type MenuInput, type MenuViewModel } from '@webmidgar/menu';
import { readSavemap } from '@webmidgar/formats-save';
import { composeSavemapSlot, type FixtureSavemap } from '@webmidgar/fixture-gen';
import { bootGameData, type GameData } from './game/data';

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
const battleBoxEl = $('battleBox');
const menuOverlayEl = $('menuOverlay');
const menuBoxEl = $('menuBox');

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
battleScene3.add(buildSubstituteStage());
const battleGroup = new Group();
battleScene3.add(battleGroup);
const battleCamera = new PerspectiveCamera(50, canvas.width / canvas.height, 10, 200000);
let partySpecs: PartyMemberSpec[] = [];
let battleStarter: BattleStarter | null = null;
let battleGen = 0;

interface RealBattle {
  session: BattleSession;
  requestId: number | null;
  source: 'field' | 'world';
  encounterId: number;
  partyIds: string[];
  enemyIds: string[];
  maxHp: Map<string, number>;
  awaiting: string[];
  eventLog: string[];
  outcomeKind: string | null;
  rewards: { exp: number; ap: number; gil: number } | null;
}
let battle: RealBattle | null = null;

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

// Musik (F09): music.idx → OGG aus der Installation. 🔵 Kampf-/Sieg-Titel sind
// Demo-Konvention („bat"/„fanfare"); die Script-Musik kommt aus HostRequests.
const musicEl = new Audio();
musicEl.loop = true;
let currentMusic = '';
let fieldMusicName = ''; // zum Zurückschalten nach dem Kampf

function playMusicByName(name: string, loop = true): void {
  if (!name || currentMusic === name) return;
  currentMusic = name;
  musicEl.loop = loop;
  musicEl.src = `/ff7data/data/music_ogg/${name}.ogg`;
  void musicEl.play().catch(() => {
    // Autoplay-Sperre ohne Nutzergeste — bewusst still (Demo bleibt lauffähig).
  });
}

function playMusicByTrackId(trackId: number): void {
  // S37: musicId ist 1-basiert, music.idx 0-basiert.
  const name = data?.musicNames[trackId - 1];
  if (name) {
    fieldMusicName = name;
    playMusicByName(name);
  }
}

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
  if (e.code === 'F9') {
    e.preventDefault();
    toggleWorld();
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
    savemap: data?.savemap ?? readSavemap(composeSavemapSlot(MENU_FIXTURE))!,
    itemName: data?.itemName ?? (() => null),
    locationName: mode === 'world' ? 'Weltkarte' : fieldName || null,
  };
}

function openMenu(requestId: number | null): void {
  menuSession = new MenuSession(menuData());
  menuSession.open('party');
  menuHostRequestId = requestId;
  renderMenu();
  menuOverlayEl.classList.add('visible');
}

function closeMenuOverlay(): void {
  if (menuHostRequestId !== null) fieldSession?.closeMenu(menuHostRequestId);
  menuHostRequestId = null;
  menuSession = null;
  menuOverlayEl.classList.remove('visible');
}

function renderMenu(): void {
  const vm = menuSession?.viewModel();
  if (!vm) {
    menuBoxEl.innerHTML = '';
    return;
  }
  menuBoxEl.innerHTML = `<h2>${escapeHtml(vm.title)}</h2>${menuRows(vm)}`;
}

function menuRows(vm: MenuViewModel): string {
  const auswahl = vm.selectable[menuSession!.state.cursor];
  return `<table>${vm.rows
    .map((r, i) => {
      const marke = i === auswahl ? '▶' : '';
      return `<tr><td>${marke}</td><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`;
    })
    .join('')}</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
}

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
  if (input.cancel || input.toggle) {
    closeMenuOverlay();
    return;
  }
  menuSession.step(input);
  menuSession.step(NEUTRAL_MENU_INPUT); // Flanke abschließen (MenuSession wirkt auf Flanken)
  renderMenu();
}

// --- Dialog-Overlay: echter Text aus der Field-Stringtabelle + Auswahl ------------

let dialogSel = 0;

function updateDialogOverlay(): void {
  const pending = fieldSession?.pendingDialogs() ?? [];
  if (pending.length === 0) {
    dialogVisibleId = null;
    dialogSel = 0;
    dialogOverlayEl.classList.remove('visible');
    return;
  }
  const first = pending[0]!;
  if (dialogVisibleId !== first.requestId) dialogSel = 0;
  dialogVisibleId = first.requestId;
  const text = fieldSession!.dialogText(first.dialogId) ?? `[Dialog ${first.dialogId} nicht dekodierbar]`;
  const lines = text.split('\n');
  const hatAuswahl = first.firstChoice !== null && first.lastChoice !== null;
  const html = lines
    .map((line, i) => {
      if (hatAuswahl && i >= first.firstChoice! && i <= first.lastChoice!) {
        const sel = i - first.firstChoice! === dialogSel ? ' sel' : '';
        return `<div class="choice${sel}">${escapeHtml(line)}</div>`;
      }
      return `<div>${escapeHtml(line) || '&nbsp;'}</div>`;
    })
    .join('');
  dialogBoxEl.innerHTML = html;
  dialogOverlayEl.classList.add('visible');
}

function dialogTick(frame: ActionFrame): void {
  if (dialogVisibleId === null || !fieldSession) return;
  const pending = fieldSession.pendingDialogs();
  const first = pending.find((d) => d.requestId === dialogVisibleId);
  if (!first) return;
  const choiceCount =
    first.firstChoice !== null && first.lastChoice !== null ? first.lastChoice - first.firstChoice + 1 : 0;
  if (choiceCount > 0) {
    if (frame.pressed.includes('up')) dialogSel = (dialogSel + choiceCount - 1) % choiceCount;
    if (frame.pressed.includes('down')) dialogSel = (dialogSel + 1) % choiceCount;
  }
  if (frame.pressed.includes('ok')) {
    fieldSession.resolveDialog(dialogVisibleId, choiceCount > 0 ? dialogSel : 0);
    dialogVisibleId = null;
    dialogSel = 0;
  }
}

// --- Kampf: echte BattleSession + render-battle ------------------------------------

function openBattle(encounterId: number, requestId: number | null, source: 'field' | 'world'): void {
  const session = battleStarter?.(encounterId & 0x3ff) ?? null;
  if (!session || !data?.scenes) {
    openBattleStub(encounterId, requestId, source);
    return;
  }
  const partyIds = partySpecs.map((p) => p.id).filter((id) => session.actor(id) !== null);
  const enemyIds: string[] = [];
  for (let i = 0; i < 8; i++) if (session.actor(`enemy-${i}`)) enemyIds.push(`enemy-${i}`);
  const maxHp = new Map<string, number>();
  for (const id of [...partyIds, ...enemyIds]) maxHp.set(id, session.actor(id)!.hp);
  battle = {
    session,
    requestId,
    source,
    encounterId,
    partyIds,
    enemyIds,
    maxHp,
    awaiting: [],
    eventLog: [],
    outcomeKind: null,
    rewards: null,
  };
  buildBattleVisuals(encounterId & 0x3ff);
  playMusicByName('bat');
  battleOverlayEl.classList.add('visible');
  log(`Kampf gestartet: Encounter ${encounterId} (${source}), ${enemyIds.length} Gegner`);
  renderBattleBox();
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

  // Gegner: sofort Platzhalterwürfel, echtes Modell asynchron nachladen.
  const placed = placeFormation(formation);
  placed.forEach((p, i) => {
    const box = new Mesh(new BoxGeometry(600, 1200, 600), new MeshBasicMaterial({ color: 0xcc4466 }));
    box.position.set(p.scenePosition[0], p.scenePosition[1] + 600, p.scenePosition[2]);
    battleGroup.add(box);
    const prefix = enemyModelPrefix(p.enemyTypeId);
    void loadBattleModel(prefix, (n) => data!.readBattleEntry(n))
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
        log(`Battle-Modell "${prefix}" geladen (${files.parts.length} Teile)`);
      })
      .catch((err) => log(`Battle-Modell "${prefix}": ${(err as Error).message}`));
  });
  // Party: 🔵 Ersatzquader auf Spiegelpositionen (Party-Battle-Modelle noch nicht verdrahtet).
  for (const pos of placeParty(battle?.partyIds.length ?? partySpecs.length)) {
    const box = new Mesh(new BoxGeometry(500, 1500, 500), new MeshBasicMaterial({ color: 0x4466cc }));
    box.position.set(pos[0], pos[1] + 750, pos[2]);
    battleGroup.add(box);
  }
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

function renderBattleBox(): void {
  if (!battle) return;
  const lines: string[] = [];
  lines.push(`KAMPF — Encounter ${battle.encounterId}`);
  for (const id of battle.partyIds) {
    const a = battle.session.actor(id);
    if (a) lines.push(`  ${id.padEnd(10)} HP ${a.hp}/${battle.maxHp.get(id)}  MP ${a.mp}  ATB ${Math.floor((a.atb / 65536) * 100)}%`);
  }
  for (const id of battle.enemyIds) {
    const a = battle.session.actor(id);
    if (a) lines.push(`  ${id.padEnd(10)} HP ${a.hp}/${battle.maxHp.get(id)}${a.hp <= 0 ? '  ✝' : ''}`);
  }
  lines.push(...battle.eventLog.slice(-5).map((l) => `  · ${l}`));
  if (battle.outcomeKind) {
    const r = battle.rewards;
    lines.push(`AUSGANG: ${battle.outcomeKind}${r ? ` — EXP ${r.exp} AP ${r.ap} Gil ${r.gil}` : ''}`);
    lines.push('[Enter] weiter');
  } else if (battle.awaiting.length > 0) {
    lines.push(`▶ ${battle.awaiting[0]}: [Enter] Angriff · [Esc] Flucht`);
  } else {
    lines.push('… ATB läuft …');
  }
  battleBoxEl.textContent = lines.join('\n');
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
  battleOverlayEl.classList.remove('visible');
  if (fieldMusicName) playMusicByName(fieldMusicName);
}

function battleTick(frame: ActionFrame): void {
  if (!battle) return;
  if (battle.outcomeKind !== null) {
    if (frame.pressed.includes('ok')) closeRealBattle();
    else renderBattleBox();
    return;
  }
  let input: BattleTickInput = {};
  if (battle.awaiting.length > 0) {
    const actorId = battle.awaiting[0]!;
    if (frame.pressed.includes('ok')) {
      const target = battle.enemyIds.find((id) => (battle!.session.actor(id)?.hp ?? 0) > 0);
      if (target) input = { command: { actorId, command: { kind: 'attack', targetId: target } } };
    } else if (frame.pressed.includes('cancel')) {
      input = { command: { actorId, command: { kind: 'escape' } } };
    }
  }
  const result = battle.session.tick(input);
  battle.awaiting = result.awaitingInput;
  for (const e of result.events) {
    const line = fmtBattleEvent(e as { kind: string } & Record<string, unknown>);
    if (line) battle.eventLog.push(line);
  }
  if (battle.eventLog.length > 12) battle.eventLog = battle.eventLog.slice(-12);
  if (result.outcome) {
    battle.outcomeKind = result.outcome.kind;
    if (result.outcome.kind === 'victory') {
      battle.rewards = { exp: result.outcome.exp, ap: result.outcome.ap, gil: result.outcome.gil };
      playMusicByName('fanfare', false);
    }
  }
  renderBattleBox();
}

// --- Kampf-Stub (Rückfall, wenn der Starter die Szene nicht liefert) ----------------

function openBattleStub(encounterId: number, requestId: number | null, source: 'field' | 'world'): void {
  battleStub = { encounterId, requestId, source };
  battleBoxEl.textContent =
    `KAMPF — Encounter ${encounterId} (${source})\n` +
    `[Platzhalter bis BattleSession verdrahtet ist]\n` +
    `Enter = Sieg · Esc = Flucht`;
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
  battleOverlayEl.classList.remove('visible');
}

// --- Field-Modus -------------------------------------------------------------------

async function enterField(name: string, start?: { x: number; y: number }): Promise<boolean> {
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

  fieldSession = new FieldSession(bundle, {
    dialogMode: 'manual',
    menuMode: 'manual',
    encounters: true,
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
  log(`Gateway ${change.gatewayIndex} → ${targetName}${arrival ? ' (Gegen-Gateway-Ankunft)' : ''}`);
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
        log(`Musik: Track ${req.trackId} → ${data?.musicNames[req.trackId - 1] ?? '(unbekannt)'}`);
        playMusicByTrackId(req.trackId);
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
 * 🔵 Kuratierte Ortsmarken: Die echten World↔Field-Einstiegspunkte sind laut
 * S29 offen (🔴). Bis dahin: eine Demo-Marke nahe der Startposition, die in
 * das Startfield zurückführt — als Demo-Finding dokumentiert.
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
      log(`Weltkarte → Field: maplist[${req.destMaplistIndex}] = ${ziel ?? '(leer)'}`);
      if (ziel) void enterField(ziel);
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

function buildBlockGroup(blockIndex: number, cell: { col: number; row: number }): Group {
  const gruppe = new Group();
  const block = data?.terrain?.blocks[blockIndex];
  if (!block) return gruppe;
  block.meshes.forEach((mesh, meshIndex) => {
    if (!mesh) return;
    const geo = buildMeshGeometry(mesh, blockIndex, meshIndex, GRID, cell);
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

// --- Takt + Render -----------------------------------------------------------------

let tickCounter = 0;

function tick(): void {
  tickCounter++;
  if (hintergrundAnim) {
    hintergrundAnim.takt++;
    setzeHintergrundZustand();
  }
  sampler.setContext(activeContext());
  const frame = sampler.sampleTick();
  if (battle) {
    battleTick(frame);
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
      .map((g, i) => ({ i, used: g.used, exitLine: g.exitLine, dest: g.destMaplistIndex, destName: data?.fieldNameByMaplist(g.destMaplistIndex) ?? null }))
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
