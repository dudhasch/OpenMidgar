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

export interface FieldChange {
  gatewayIndex: number;
  destFieldId: number;
  destination: Vec3;
}

export interface TickResult {
  tick: number;
  moveEvents: MoveEvent[];
  gateways: GatewayEvent[];
  triggers: TriggerEvent[];
  /** Gesetzt, sobald ein Gateway gequert wurde — der Host lädt das Zielfield. */
  fieldChange: FieldChange | null;
  confirmPressed: boolean;
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

function insideVolume(v: FieldTriggerVolume, x: number, y: number): boolean {
  const [a, b] = v.corners;
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export class FieldSession {
  readonly fieldId: string;
  readonly solver: WalkmeshSolver | null;
  readonly script: PreparedScript | null;
  readonly runtime: FieldRuntime | null;
  readonly speed: number;

  player: PlayerState | null = null;
  tickCounter = 0;
  private activeTriggers = new Set<number>();
  private prevConfirm = false;

  constructor(
    readonly bundle: FieldBundle,
    options: FieldSessionOptions = {},
  ) {
    this.fieldId = bundle.fieldId;
    this.speed = options.speed ?? DEFAULT_SPEED;
    this.solver = bundle.walkmesh ? new WalkmeshSolver(bundle.walkmesh) : null;

    const scriptSection = bundle.rawSections[1];
    const runScript = options.runScript ?? true;
    if (runScript && bundle.script && scriptSection) {
      this.script = prepareScript(bundle.script, scriptSection);
      this.runtime = new FieldRuntime(this.script, {
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.interpreterBudget !== undefined ? { budget: options.interpreterBudget } : {}),
      });
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
      if (insideVolume(v, x, y)) hit.push(i);
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
        facing: (Math.atan2(dy, dx) * 180) / Math.PI,
        moving: true,
      };
      const next = { x: result.state.x, y: result.state.y };

      if (this.bundle.triggers) {
        gateways.push(...detectGatewayCrossings(prev, next, this.bundle.triggers));
        const first = gateways[0];
        if (first) {
          fieldChange = {
            gatewayIndex: first.gatewayIndex,
            destFieldId: first.gateway.destFieldId,
            destination: first.gateway.destination,
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

    this.runtime?.tick();

    const confirmPressed = input.confirm && !this.prevConfirm;
    this.prevConfirm = input.confirm;
    this.tickCounter++;
    return { tick: this.tickCounter, moveEvents, gateways, triggers, fieldChange, confirmPressed };
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
