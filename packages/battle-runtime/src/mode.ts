import { canonicalJson, fnv1a64HexOfString } from '@webmidgar/interpreter';
import { BattleSession, NEUTRAL_BATTLE_INPUT, type BattleOutcome, type BattleTickInput } from './session.js';

/**
 * Modus-Vertrag Field ↔ Battle (S33, ADR-026 — Ablösung von ADR-011).
 *
 * Field friert ein (es wird schlicht nicht mehr getickt; sein Zustand bleibt
 * vollständig erhalten), der Kampf läuft in einer EIGENEN Fixed-Tick-Sitzung,
 * die Rückkehr meldet `battle-finished` mit `outcome` über den seit S17
 * verdrahteten Rückkanal. Der ADR-011-Stub bleibt als TESTMODUS erhalten
 * (`battleMode: 'stub'`) — er ist für schnelle Story-Durchläufe zu wertvoll.
 *
 * Der Koordinator ist bewusst über ein STRUKTURELLES Port-Interface an die
 * FieldSession gebunden (kein Paketimport): battle-runtime bleibt frei von
 * field-runtime, die Kopplung bleibt eine Datenschnittstelle.
 *
 * `outcome`-Kodierung (🔵, dokumentiert): 0 = Sieg, 1 = Flucht, 2 = Niederlage.
 * Die Original-Kodierung ist unbelegt; die Zielvariablen-Probe (S33) hat
 * zudem ergeben, dass der Interpreter weiterhin NICHTS in eine Script-
 * Variable schreibt (Befund unter Faktor 3) — der Wert lebt nur im Event.
 */

export interface FieldBattleRequest {
  kind: 'battle';
  encounterId: number;
  requestId: number;
}

/** Struktureller Port auf die FieldSession — bewusst minimal. */
export interface FieldPort {
  tick(input: unknown): { hostRequests: { kind: string }[] };
  postBattleFinished(requestId: number, outcome: number): void;
  digest(): string;
}

export type BattleStarter = (encounterId: number) => BattleSession | null;

export type ModeState =
  | { mode: 'field' }
  | { mode: 'battle'; requestId: number; encounterId: number };

export interface CoordinatorOptions {
  /** 'real' (Standard seit ADR-026) oder 'stub' (ADR-011-Testmodus). */
  battleMode?: 'real' | 'stub';
  /** Stub-Ausgang (Testmodus): outcome-Wert, der sofort gemeldet wird. */
  stubOutcome?: number;
}

export function encodeOutcome(outcome: BattleOutcome): number {
  switch (outcome.kind) {
    case 'victory':
      return 0;
    case 'escape':
      return 1;
    case 'defeat':
      return 2;
  }
}

export interface CoordinatorTickResult {
  state: ModeState;
  battleStarted: boolean;
  battleFinished: BattleOutcome | null;
  /** Kumulierte Siege dieses Koordinators (für die Verbuchung durch den Wirt). */
  pendingRewards: { exp: number; ap: number; gil: number; drops: number[] } | null;
}

export class BattleModeCoordinator {
  private state: ModeState = { mode: 'field' };
  private battle: BattleSession | null = null;
  private readonly battleMode: 'real' | 'stub';
  private readonly stubOutcome: number;

  constructor(
    private readonly field: FieldPort,
    private readonly startBattle: BattleStarter,
    options: CoordinatorOptions = {},
  ) {
    this.battleMode = options.battleMode ?? 'real';
    this.stubOutcome = options.stubOutcome ?? 0;
  }

  get modeState(): ModeState {
    return this.state;
  }

  get activeBattle(): BattleSession | null {
    return this.battle;
  }

  /**
   * Ein Takt des Gesamtsystems: Im Field-Modus tickt das Field, im
   * Battle-Modus AUSSCHLIESSLICH der Kampf (das Field ist eingefroren).
   */
  tick(fieldInput: unknown, battleInput: BattleTickInput = NEUTRAL_BATTLE_INPUT): CoordinatorTickResult {
    if (this.state.mode === 'field') {
      const r = this.field.tick(fieldInput);
      const req = r.hostRequests.find((h) => h.kind === 'battle') as FieldBattleRequest | undefined;
      if (!req) return { state: this.state, battleStarted: false, battleFinished: null, pendingRewards: null };
      if (this.battleMode === 'stub') {
        // ADR-011-Testmodus: sofortiger Rückweg mit festem Ausgang.
        this.field.postBattleFinished(req.requestId, this.stubOutcome);
        return { state: this.state, battleStarted: false, battleFinished: null, pendingRewards: null };
      }
      const battle = this.startBattle(req.encounterId);
      if (!battle) {
        // Formation nicht auflösbar: definierter Ersatzausgang statt Hänger —
        // derselbe Grundsatz wie die Quarantäne der Parser.
        this.field.postBattleFinished(req.requestId, this.stubOutcome);
        return { state: this.state, battleStarted: false, battleFinished: null, pendingRewards: null };
      }
      this.battle = battle;
      this.state = { mode: 'battle', requestId: req.requestId, encounterId: req.encounterId };
      return { state: this.state, battleStarted: true, battleFinished: null, pendingRewards: null };
    }

    const result = this.battle!.tick(battleInput);
    if (!result.outcome) return { state: this.state, battleStarted: false, battleFinished: null, pendingRewards: null };
    const outcome = result.outcome;
    this.field.postBattleFinished(this.state.requestId, encodeOutcome(outcome));
    const rewards =
      outcome.kind === 'victory'
        ? { exp: outcome.exp, ap: outcome.ap, gil: outcome.gil, drops: [...outcome.drops] }
        : null;
    this.battle = null;
    this.state = { mode: 'field' };
    return { state: this.state, battleStarted: false, battleFinished: outcome, pendingRewards: rewards };
  }

  /** Digest ÜBER DIE MODUSGRENZE: Field- und Battle-Zustand gemeinsam. */
  digest(): string {
    return fnv1a64HexOfString(
      canonicalJson({
        mode: this.state,
        field: this.field.digest(),
        battle: this.battle ? this.battle.digest() : null,
      }),
    );
  }
}
