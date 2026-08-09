import type { FieldBundle, FieldTriggerVolume, Vec3 } from '@webmidgar/formats-field';
import {
  detectGatewayCrossings,
  WalkmeshSolver,
  type GatewayEvent,
  type MoveEvent,
  type WalkState,
} from '@webmidgar/walkmesh';
import {
  canonicalJson,
  fnv1a64HexOfString,
  FieldRuntime,
  prepareScript,
  restoreRuntime,
  snapshotRuntime,
  type PreparedScript,
  type RuntimeSnapshot,
} from '@webmidgar/interpreter';

/**
 * Field-Sitzung (Masterplan Phase 5, vertikaler Durchstich): bindet Walkmesh-
 * Solver, Gateway-/Triggererkennung und den Fixed-Tick-Interpreter zu einer
 * framework-freien Laufzeit zusammen. Kein Three.js, kein DOM — damit ist die
 * gesamte Spiellogik in Node testbar und im Worker lauffähig; das Rendering
 * liest den Zustand nur ab.
 *
 * Determinismus ist die tragende Zusicherung (ADR-006): Eingaben werden auf
 * ganzzahlige Richtungen quantisiert, jeder Tick ist ein reiner
 * Zustandsübergang, und `digest()` erlaubt den bitgenauen Replay-Vergleich.
 */

/** Eingabe eines Ticks — bewusst quantisiert, damit Replays exakt sind. */
export interface FieldInput {
  /** Bewegungsrichtung, jeweils −1, 0 oder +1 (Field-Grundriss). */
  moveX: number;
  moveY: number;
  /** Aktionstaste; die Sitzung wertet nur die steigende Flanke. */
  confirm: boolean;
  cancel: boolean;
}

export const NEUTRAL_INPUT: FieldInput = { moveX: 0, moveY: 0, confirm: false, cancel: false };

export interface PlayerState {
  walk: WalkState;
  /** Blickrichtung in Field-Einheiten (Grad, 0 = +x), zuletzt bewegte Richtung. */
  facing: number;
  moving: boolean;
}

export interface TriggerEvent {
  index: number;
  volume: FieldTriggerVolume;
  kind: 'enter' | 'leave';
}

/**
 * Ein gequertes Gateway. `destMaplistIndex` ist belegt (0-basierter Index in
 * die `maplist`, nachgewiesen über 78,8 % Rückkantenquote gegen 0,2 %
 * Kontrollniveau) — der Host löst ihn über `resolveMaplistTarget` zu einem
 * Fieldnamen auf. Der Zielpunkt bleibt dagegen ein 🟡 Kandidat; bis zu seiner
 * Bestätigung setzt man die Figur im Zielfield besser über die Rückrichtung
 * (das Gegen-Gateway) statt über diese Koordinate.
 */
export interface FieldChange {
  gatewayIndex: number;
  destMaplistIndex: number;
}

/**
 * Offene Dialoganfrage eines Skriptkontextes. Der Interpreter hält den Kontext
 * an, bis der Host antwortet — im Durchstich löst die Bestätigungstaste auf,
 * ab S13 das echte Fenstersystem.
 */
export interface PendingDialog {
  entityIndex: number;
  slot: number;
  requestId: number;
  /** Gesetzt, wenn das Skript eine Auswahl erwartet (ASK). */
  choice: { bank: number; addr: number } | null;
}

export interface TickResult {
  tick: number;
  moveEvents: MoveEvent[];
  gateways: GatewayEvent[];
  triggers: TriggerEvent[];
  /** Gesetzt, sobald ein Gateway gequert wurde — der Host lädt das Zielfield. */
  fieldChange: FieldChange | null;
  confirmPressed: boolean;
  /** Kontexte, die auf eine Dialogantwort warten (stabil sortiert). */
  pendingDialogs: PendingDialog[];
  /** In diesem Takt beantwortete Dialoge. */
  resolvedDialogs: number[];
  /** Bewegungsaufträge, die in diesem Takt erfüllt (oder abgebrochen) wurden. */
  arrivals: number[];
}

export interface FieldSessionOptions {
  /** Field-Einheiten je Tick bei voller Auslenkung. */
  speed?: number | undefined;
  seed?: number | undefined;
  /** Startposition im Grundriss; fehlt → Schwerpunkt des ersten Dreiecks. */
  start?: { x: number; y: number } | undefined;
  /** Interpreter mitlaufen lassen (Standard: ja, wenn ein Script vorliegt). */
  runScript?: boolean | undefined;
  interpreterBudget?: number | undefined;
  /**
   * Wie offene Dialoganfragen aufgelöst werden:
   *  - `confirm` (Standard): auf Tastendruck, ein Dialog je Takt
   *  - `auto`: sofort im selben Takt (Testläufe, Sweeps)
   *  - `manual`: gar nicht — der Host ruft `resolveDialog` selbst
   */
  dialogMode?: 'confirm' | 'auto' | 'manual' | undefined;
}

export interface FieldSessionSnapshot {
  schemaVersion: 1;
  fieldId: string;
  tick: number;
  player: PlayerState | null;
  activeTriggers: number[];
  prevConfirm: boolean;
  runtime: RuntimeSnapshot | null;
}

export const SESSION_SCHEMA_VERSION = 1;

const DEFAULT_SPEED = 6;

/** Fortschritt je Takt, unter dem eine Bewegung als blockiert gilt. */
const MOVE_MIN_PROGRESS = 1e-3;
/** Takte ohne Fortschritt, nach denen ein Bewegungsauftrag abgebrochen wird. */
const MOVE_STALL_TICKS = 30;

/**
 * Ein Triggervolumen gilt als belegt, sobald es im Grundriss eine Ausdehnung
 * hat. Dasselbe Erkennungsmerkmal trägt bei Gateways die Austrittslinie —
 * ungenutzte Slots sind in beiden Fällen schlicht genullt (realdaten-belegt).
 */
function isUsedVolume(v: FieldTriggerVolume): boolean {
  const [a, b] = v.corners;
  return a[0] !== b[0] || a[1] !== b[1];
}

function insideVolume(v: FieldTriggerVolume, x: number, y: number): boolean {
  const [a, b] = v.corners;
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/**
 * Länge eines 2D-Vektors ohne `Math.hypot` (R9-Härtung, S20).
 *
 * `Math.sqrt` und die Grundrechenarten sind in ECMA-262 bitgenau auf
 * IEEE-754 festgelegt, `Math.hypot` ist es nicht. Da jede dieser Längen über
 * Positionen in den Replay-Digest einfließt, wird die festgelegte Form
 * verwendet.
 */
function laenge2d(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Volle Umdrehung in Richtungseinheiten — das Original führt Richtungen als Byte. */
export const RICHTUNGSEINHEITEN = 256;

/**
 * Richtung eines Bewegungsvektors in Grad, **quantisiert auf die 256
 * Richtungseinheiten des Originals**.
 *
 * Das ist die zentrale R9-Härtung dieser Session. Gemessen am 2026-08-10:
 * `Math.atan2` liefert zwischen zwei V8-Ständen (Node 22 und Chrome 151)
 * unterschiedliche Bitmuster — der Replay-Digest des skriptgesteuerten
 * Vektors wich dadurch ab, obwohl beide Läufe fachlich identisch waren. Roh
 * gespeicherte Winkel tragen die letzten Bits von `atan2` in den Zustand und
 * damit in den Digest.
 *
 * Die Quantisierung entfernt genau diese Bits: Ergebnis ist immer ein
 * ganzzahliges Vielfaches von 360/256 = 1,40625 — im Binärsystem exakt
 * darstellbar, also über Engines hinweg bitgleich. Fachlich ist das keine
 * Einbuße, sondern näher am Original, das Richtungen ohnehin als Byte führt.
 *
 * Rest­risiko: Liegt ein `atan2`-Ergebnis exakt auf einer Rundungsgrenze,
 * könnten zwei Engines in verschiedene Eimer runden. Das ist nicht
 * ausgeschlossen, sondern nur sehr unwahrscheinlich — und es ist der Grund,
 * warum die Replay-Vektoren als Regressionstest bestehen bleiben.
 */
export function richtungGrad(dx: number, dy: number): number {
  const einheit = Math.round((Math.atan2(dy, dx) * (RICHTUNGSEINHEITEN / 2)) / Math.PI);
  const normiert = ((einheit % RICHTUNGSEINHEITEN) + RICHTUNGSEINHEITEN) % RICHTUNGSEINHEITEN;
  return normiert * (360 / RICHTUNGSEINHEITEN);
}

export class FieldSession {
  readonly fieldId: string;
  readonly solver: WalkmeshSolver | null;
  readonly script: PreparedScript | null;
  readonly runtime: FieldRuntime | null;
  readonly speed: number;
  readonly dialogMode: 'confirm' | 'auto' | 'manual';

  player: PlayerState | null = null;
  tickCounter = 0;
  private activeTriggers = new Set<number>();
  private prevConfirm = false;
  /** Takte ohne Bewegungsfortschritt je Entität (Deadlock-Schutz). */
  private moveStalls = new Map<number, number>();

  constructor(
    readonly bundle: FieldBundle,
    options: FieldSessionOptions = {},
  ) {
    this.fieldId = bundle.fieldId;
    this.speed = options.speed ?? DEFAULT_SPEED;
    this.dialogMode = options.dialogMode ?? 'confirm';
    this.solver = bundle.walkmesh ? new WalkmeshSolver(bundle.walkmesh) : null;

    const scriptSection = bundle.rawSections[1];
    const runScript = options.runScript ?? true;
    if (runScript && bundle.script && scriptSection) {
      this.script = prepareScript(bundle.script, scriptSection);
      this.runtime = new FieldRuntime(this.script, {
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.interpreterBudget !== undefined ? { budget: options.interpreterBudget } : {}),
      });
      // Ohne `start()` wird kein Slot-0-Request eingereiht — die Skripte
      // liefen sonst nie an und `tick()` wäre stillschweigend wirkungslos.
      // Beim Restore wird der Zustand ersetzt, dort NICHT erneut starten.
      this.runtime.start();
    } else {
      this.script = null;
      this.runtime = null;
    }

    if (this.solver && bundle.walkmesh && bundle.walkmesh.triangles.length > 0) {
      const start = options.start ?? centroidOfFirstWalkable(bundle);
      if (start) this.placeAt(start.x, start.y);
    }
  }

  /**
   * Setzt die Figur auf den Grundriss. Liegt der Punkt außerhalb, bleibt der
   * bisherige Zustand erhalten — die Invariante „immer im Mesh" gilt auch hier.
   */
  placeAt(x: number, y: number, zHint?: number): boolean {
    if (!this.solver) return false;
    const walk = this.solver.locate(x, y, zHint);
    if (!walk) return false;
    this.player = { walk, facing: this.player?.facing ?? 0, moving: false };
    // Triggerzugehörigkeit ohne Flanken neu bestimmen (Wiedereinstieg).
    this.activeTriggers = new Set(this.currentTriggerIndices(x, y));
    return true;
  }

  private currentTriggerIndices(x: number, y: number): number[] {
    const volumes = this.bundle.triggers?.triggers ?? [];
    const hit: number[] = [];
    volumes.forEach((v, i) => {
      // Die Sektion führt immer 12 Slots; ungenutzte sind auf (0,0,0)–(0,0,0)
      // genullt. Ohne diese Prüfung feuerte am Weltursprung ein Phantomtrigger.
      if (isUsedVolume(v) && insideVolume(v, x, y)) hit.push(i);
    });
    return hit;
  }

  /** Ein deterministischer Zeitschritt. */
  tick(input: FieldInput = NEUTRAL_INPUT): TickResult {
    const moveEvents: MoveEvent[] = [];
    const gateways: GatewayEvent[] = [];
    const triggers: TriggerEvent[] = [];
    let fieldChange: FieldChange | null = null;

    const mx = Math.sign(input.moveX);
    const my = Math.sign(input.moveY);
    if (this.solver && this.player && (mx !== 0 || my !== 0)) {
      // Diagonale auf gleiche Schrittweite bringen — sonst wäre schräg schneller.
      const norm = mx !== 0 && my !== 0 ? Math.SQRT1_2 : 1;
      const dx = mx * this.speed * norm;
      const dy = my * this.speed * norm;
      const prev = { x: this.player.walk.x, y: this.player.walk.y };
      const result = this.solver.move(this.player.walk, dx, dy);
      moveEvents.push(...result.events);
      this.player = {
        walk: result.state,
        facing: richtungGrad(dx, dy),
        moving: true,
      };
      const next = { x: result.state.x, y: result.state.y };

      if (this.bundle.triggers) {
        gateways.push(...detectGatewayCrossings(prev, next, this.bundle.triggers));
        const first = gateways[0];
        if (first) {
          fieldChange = {
            gatewayIndex: first.gatewayIndex,
            destMaplistIndex: first.gateway.destMaplistIndex,
          };
        }
      }

      // Triggervolumen: Flanken über den Zustand des Vor-Ticks.
      const now = new Set(this.currentTriggerIndices(next.x, next.y));
      const volumes = this.bundle.triggers?.triggers ?? [];
      for (const i of now) {
        if (!this.activeTriggers.has(i)) triggers.push({ index: i, volume: volumes[i]!, kind: 'enter' });
      }
      for (const i of this.activeTriggers) {
        if (!now.has(i)) triggers.push({ index: i, volume: volumes[i]!, kind: 'leave' });
      }
      triggers.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
      this.activeTriggers = now;
    } else if (this.player) {
      this.player = { ...this.player, moving: false };
    }

    // Skriptgesteuerte Bewegung VOR dem Tick abarbeiten: Der Interpreter
    // setzt nur den Auftrag; ausgeführt wird er hier mit dem Solver, damit die
    // Invariante „immer im Mesh" auch für Skript-Entitäten gilt.
    const arrivals = this.stepScriptedMovement();
    this.runtime?.tick();

    const confirmPressed = input.confirm && !this.prevConfirm;
    this.prevConfirm = input.confirm;

    // Dialoge werden NACH dem Tick betrachtet: die Antwort wirkt dann im
    // nächsten Takt — genau wie jedes andere Ereignis (ADR-006, Staging).
    let pendingDialogs = this.pendingDialogs();
    const resolvedDialogs: number[] = [];
    if (this.dialogMode !== 'manual' && pendingDialogs.length > 0) {
      const answer = this.dialogMode === 'auto' || confirmPressed;
      if (answer) {
        const first = pendingDialogs[0]!;
        this.resolveDialog(first.requestId, 0);
        resolvedDialogs.push(first.requestId);
        pendingDialogs = pendingDialogs.slice(1);
      }
    }

    this.tickCounter++;
    return {
      tick: this.tickCounter,
      moveEvents,
      gateways,
      triggers,
      fieldChange,
      confirmPressed,
      pendingDialogs,
      resolvedDialogs,
      arrivals,
    };
  }

  /**
   * Führt alle offenen Bewegungsaufträge um einen Schritt aus.
   *
   * Ein Auftrag gilt als erfüllt, sobald das Ziel im Grundriss erreicht ist —
   * die Höhe ergibt sich aus dem Walkmesh, sie ist kein Bewegungsziel. Bleibt
   * eine Entität hängen (blockierte Kante, kein Fortschritt), wird der Auftrag
   * nach `MOVE_STALL_TICKS` erfolglosen Takten abgebrochen und die Ankunft
   * trotzdem gemeldet. Ohne diesen Abbruch bliebe der Skriptkontext für immer
   * im Wartezustand — ein stiller Deadlock wäre schlimmer als eine ungenaue
   * Position.
   */
  private stepScriptedMovement(): number[] {
    const rt = this.runtime;
    if (!rt || !this.solver) return [];
    const arrived: number[] = [];
    for (const [entityIndex, a] of rt.state.actors.entries()) {
      const target = a.moveTarget;
      if (!target) continue;
      if (!a.position) {
        // Ohne Startposition kann nicht bewegt werden — Auftrag sofort quittieren.
        a.moveTarget = null;
        arrived.push(target.requestId);
        rt.postEvent({ kind: 'movement-arrived', requestId: target.requestId });
        continue;
      }
      // Der per XYZI gesetzte Dreiecksindex ist eine Skriptangabe und kann
      // nicht zur Position passen (ein inkonsistenter Walkstate lässt den
      // Solver an Kanten entlangdriften statt sauber zu stoppen). Deshalb wird
      // er geprüft und im Zweifel neu bestimmt — der Solver hat das letzte Wort.
      const claimed =
        a.triangle !== null &&
        a.triangle >= 0 &&
        a.triangle < this.solver.tris.length &&
        this.solver.containsPoint(a.triangle, a.position[0], a.position[1], 0.01)
          ? { tri: a.triangle, x: a.position[0], y: a.position[1], height: a.position[2] }
          : null;
      const state = claimed ?? this.solver.locate(a.position[0], a.position[1]);
      if (!state) {
        a.moveTarget = null;
        arrived.push(target.requestId);
        rt.postEvent({ kind: 'movement-arrived', requestId: target.requestId });
        continue;
      }
      const dx = target.x - state.x;
      const dy = target.y - state.y;
      const dist = laenge2d(dx, dy);
      if (dist <= a.moveSpeed) {
        // Zielnähe: exakt setzen und quittieren.
        const final = this.solver.locate(target.x, target.y) ?? state;
        a.position = [final.x, final.y, final.height];
        a.triangle = final.tri;
        a.moveTarget = null;
        arrived.push(target.requestId);
        rt.postEvent({ kind: 'movement-arrived', requestId: target.requestId });
        continue;
      }
      const step = this.solver.move(state, (dx / dist) * a.moveSpeed, (dy / dist) * a.moveSpeed);
      const progressed = laenge2d(step.state.x - state.x, step.state.y - state.y);
      a.position = [step.state.x, step.state.y, step.state.height];
      a.triangle = step.state.tri;
      a.direction = richtungGrad(dx, dy);
      if (progressed < MOVE_MIN_PROGRESS) {
        const stalls = (this.moveStalls.get(entityIndex) ?? 0) + 1;
        this.moveStalls.set(entityIndex, stalls);
        if (stalls >= MOVE_STALL_TICKS) {
          this.moveStalls.delete(entityIndex);
          a.moveTarget = null;
          arrived.push(target.requestId);
          rt.postEvent({ kind: 'movement-arrived', requestId: target.requestId });
        }
      } else {
        this.moveStalls.delete(entityIndex);
      }
    }
    return arrived;
  }

  /**
   * Alle Kontexte, die auf eine Dialogantwort warten — nach Entität und Slot
   * sortiert, damit die Reihenfolge unabhängig von der Iterationsreihenfolge
   * des Schedulers ist (Determinismus).
   */
  pendingDialogs(): PendingDialog[] {
    const out: PendingDialog[] = [];
    for (const [entityIndex, entity] of (this.runtime?.state.entities ?? []).entries()) {
      const contexts = [entity.context, ...entity.suspended];
      for (const ctx of contexts) {
        if (!ctx || ctx.waitState.kind !== 'dialogue') continue;
        out.push({
          entityIndex,
          slot: ctx.slot,
          requestId: ctx.waitState.requestId,
          choice: ctx.waitState.choice ?? null,
        });
      }
    }
    return out.sort((a, b) => a.entityIndex - b.entityIndex || a.slot - b.slot);
  }

  /** Beantwortet eine Dialoganfrage; `choice` ist der Auswahlindex (ASK). */
  resolveDialog(requestId: number, choice = 0): void {
    this.runtime?.postEvent({ kind: 'dialogue-resolved', requestId, choice });
  }

  snapshot(): FieldSessionSnapshot {
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      fieldId: this.fieldId,
      tick: this.tickCounter,
      player: this.player ? { walk: { ...this.player.walk }, facing: this.player.facing, moving: this.player.moving } : null,
      activeTriggers: [...this.activeTriggers].sort((a, b) => a - b),
      prevConfirm: this.prevConfirm,
      runtime: this.runtime ? snapshotRuntime(this.runtime.state) : null,
    };
  }

  /**
   * Stellt einen Snapshot wieder her. Scheitert bewusst laut, wenn Field oder
   * Script-Hash nicht passen — ein stillschweigend falsch geladener Zustand
   * wäre schlimmer als ein sichtbarer Fehler.
   */
  restore(snapshot: FieldSessionSnapshot): { ok: boolean; reason?: string; warnings: string[] } {
    if (snapshot.schemaVersion !== SESSION_SCHEMA_VERSION) {
      return { ok: false, reason: `Schemaversion ${snapshot.schemaVersion} unbekannt`, warnings: [] };
    }
    if (snapshot.fieldId !== this.fieldId) {
      return { ok: false, reason: `Snapshot gehört zu Field "${snapshot.fieldId}"`, warnings: [] };
    }
    const warnings: string[] = [];
    if (snapshot.runtime && this.script && this.runtime) {
      // Wirft bei fremder Schemaversion — das ist gewollt laut ADR-006.
      const restored = restoreRuntime(snapshot.runtime, this.script);
      warnings.push(...restored.warnings);
      this.runtime.state = restored.state;
    } else if (snapshot.runtime && !this.script) {
      return { ok: false, reason: 'Snapshot enthält Interpreterzustand, die Sitzung nicht', warnings: [] };
    }
    this.player = snapshot.player
      ? { walk: { ...snapshot.player.walk }, facing: snapshot.player.facing, moving: snapshot.player.moving }
      : null;
    this.tickCounter = snapshot.tick;
    this.activeTriggers = new Set(snapshot.activeTriggers);
    this.prevConfirm = snapshot.prevConfirm;
    return { ok: true, warnings };
  }

  /**
   * Stabiler Fingerabdruck des Sitzungszustands. Gleiche Eingabefolge muss
   * denselben Digest liefern — das ist der Regressionstest der Integration.
   */
  digest(): string {
    return fnv1a64HexOfString(canonicalJson(this.snapshot()));
  }
}

function centroidOfFirstWalkable(bundle: FieldBundle): { x: number; y: number } | null {
  for (const tri of bundle.walkmesh?.triangles ?? []) {
    if (tri.degenerate) continue;
    const [a, b, c] = tri.vertices;
    return { x: (a[0] + b[0] + c[0]) / 3, y: (a[1] + b[1] + c[1]) / 3 };
  }
  return null;
}
