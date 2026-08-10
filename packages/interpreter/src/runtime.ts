import { spanEnd, type PreparedScript } from './prepared.js';
import {
  createActor,
  createBanks,
  writeBank,
  FAULT_LOG_CAP,
  RUNTIME_SCHEMA_VERSION,
  type EntityRuntime,
  type FieldRuntimeState,
  type PendingRequest,
  type HostRequest,
  type RuntimeEvent,
  type ScriptContext,
} from './state.js';
import { NOOP_TRACE, type TraceSink } from './trace.js';
import { restoreRuntime, type RuntimeSnapshot } from './serde.js';
import { stepInstruction } from './vm.js';

/**
 * Fixed-Tick-Scheduler (Masterplan 4.2, ADR-006): streng stabile
 * Kontextordnung (entityIndex aufsteigend), Instruktionsbudget je Kontext und
 * Tick mit Eskalation (Zwangs-Yield → Fault), Event-Zustellung ausschließlich
 * am Tickanfang. Identische Eingaben ⇒ identischer Zustandsverlauf.
 *
 * 🟡 Prioritätsregeln (R1, `Zu validieren` — gekapselt in `PriorityRules`,
 * nicht über den Code verstreut):
 *  - kleinere Zahl = höhere Priorität
 *  - Verdrängung nur an Tick-Grenzen, nur durch strikt höhere Priorität
 *  - REQ und REQSW unterscheiden sich in S6 nicht (keine Queue-Obergrenze)
 */
export const PriorityRules = {
  isHigher: (a: number, b: number): boolean => a < b,
  /** Stabile Queue-Ordnung: Priorität, dann Einreihungsfolge. */
  compareQueue: (a: PendingRequest, b: PendingRequest): number =>
    a.priority - b.priority || a.seq - b.seq,
  INIT_PRIORITY: 7,
  /**
   * 🟡 Vorgabe für Wirt-Interaktionen (`requestEntityScript`, F04): hoch
   * genug, um eine in `wait`/`move` hängende Main-Schleife zu verdrängen
   * (Verdrängung braucht strikt höhere Priorität als INIT_PRIORITY 7),
   * niedrig genug, um Raum nach oben zu lassen. Der Zahlenwert ist nicht
   * realdaten-belegt — das Original kennt für Talk keinen Prioritätsoperanden.
   */
  INTERACTION_PRIORITY: 3,
} as const;

/**
 * 🟡 Script-Slot-Konvention je Entität (Community-dokumentiert): Slot 0 =
 * Init + Main, Slot 1 = Talk (Spieler drückt OK in Reichweite), Slot 2 =
 * Contact (Kollision).
 *
 * Messstand 2026-08-10 (tools/realdata-scan/src/talk-slot-probe.rdtest.ts,
 * 702 Fields, 10 523 Entities, davon 5460 Modell-Entities mit CHAR im Init):
 *  - Die MESSAGE/ASK-Quote der Modell-Entities differenziert Slot 1 (22,5 %)
 *    scharf von Slot 2 (0,5 %) — zwei klar verschiedene Rollen, konsistent
 *    mit Talk (Dialog üblich) gegen Contact (Dialog bei Berührung unüblich).
 *  - Über das Kontrollniveau der Slots 3+ (27,5 %) hebt sich Slot 1 dagegen
 *    NICHT — auch REQ-gerufene Eventscripts zeigen Dialoge. Die Zuordnung
 *    „1 = Talk" bleibt damit Community-Wissen, gestützt, nicht bewiesen.
 */
export const TALK_SCRIPT_SLOT = 1;
export const CONTACT_SCRIPT_SLOT = 2;

/** Beobachter-Hooks für Timeline/Debugger — alle optional, kostenneutral. */
export interface RuntimeObserver {
  contextStarted?(tick: number, ctx: ScriptContext): void;
  /** completed ODER faulted — `ctx.status` unterscheidet. */
  contextEnded?(tick: number, ctx: ScriptContext): void;
  yielded?(tick: number, ctx: ScriptContext): void;
  requested?(
    tick: number,
    source: number,
    target: number,
    slot: number,
    priority: number,
    mode: PendingRequest['mode'],
    accepted: boolean,
  ): void;
  budgetForcedYield?(tick: number, ctx: ScriptContext): void;
}

export interface RuntimeOptions {
  seed?: number | undefined;
  /** Instruktionen je Kontext und Tick (Endlosschleifen-Schutz). */
  budget?: number | undefined;
  /** Budgetüberschreitungen in Folge bis zum Fault. */
  maxBudgetStrikes?: number | undefined;
  trace?: TraceSink | undefined;
  /** Slot-0-Init/Main-Semantik aktiv (🟡, s. EntityRuntime). */
  mainLoop?: boolean | undefined;
  observer?: RuntimeObserver | undefined;
  /**
   * Debugger-Gate: vor JEDER Instruktion gefragt; false ⇒ Kontext hält an
   * (Breakpoint/Einzelschritt), Zustand bleibt unverändert.
   */
  stepGate?: ((ctx: ScriptContext) => boolean) | undefined;
}

export class FieldRuntime {
  /** Ersetzbar durch `restoreFrom` (Snapshot-Restore). */
  state: FieldRuntimeState;
  readonly budget: number;
  readonly maxBudgetStrikes: number;
  readonly mainLoop: boolean;
  trace: TraceSink;
  observer: RuntimeObserver;
  stepGate: (ctx: ScriptContext) => boolean;

  constructor(
    readonly script: PreparedScript,
    options: RuntimeOptions = {},
  ) {
    this.budget = options.budget ?? 1000;
    this.maxBudgetStrikes = options.maxBudgetStrikes ?? 3;
    this.mainLoop = options.mainLoop ?? true;
    this.trace = options.trace ?? NOOP_TRACE;
    this.observer = options.observer ?? {};
    this.stepGate = options.stepGate ?? (() => true);
    this.state = {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      scriptHash: script.scriptHash,
      tickCounter: 0,
      rngState: (options.seed ?? 0x1234) | 0,
      nextRequestId: 1,
      nextSeq: 1,
      banks: createBanks(),
      actors: script.entities.map(() => createActor()),
      entities: script.entities.map((): EntityRuntime => ({
        context: null,
        suspended: [],
        queue: [],
        staged: [],
        disabledSlots: [],
        initDone: false,
        mainIp: null,
      })),
      eventQueue: [],
      hostRequests: [],
      randomEncountersDisabled: false,
      bgStates: {},
      menuAccessRaw: 0,
      unknownSkips: {},
      droppedRequests: 0,
      faults: [],
      faultCount: 0,
    };
  }

  /** Field-Start: Init-Slot (0) aller Entitäten einreihen (stabile Ordnung). */
  start(): void {
    for (let e = 0; e < this.state.entities.length; e++) {
      this.enqueueRequest(e, 0, PriorityRules.INIT_PRIORITY, 'async');
    }
  }

  /** Externe Ereignisse (UI, Solver) — wirken erst am nächsten Tickanfang. */
  postEvent(event: RuntimeEvent): void {
    this.state.eventQueue.push(event);
  }

  /**
   * Nimmt die aufgelaufenen Wirkungen entgegen und leert die Liste. Der Host
   * ruft das nach jedem Tick; unabgeholte Wirkungen sammeln sich, gehen aber
   * nie verloren — sie sind Teil des Snapshots.
   */
  takeHostRequests(): HostRequest[] {
    const out = this.state.hostRequests;
    this.state.hostRequests = [];
    return out;
  }

  enqueueRequest(entityIndex: number, slot: number, priority: number, mode: PendingRequest['mode']): boolean {
    const entity = this.state.entities[entityIndex];
    const entry = this.script.entities[entityIndex]?.entryPoints[slot];
    if (!entity || entry === null || entry === undefined || entity.disabledSlots.includes(slot)) {
      this.state.droppedRequests++;
      return false;
    }
    entity.staged.push({ slot, priority, mode, seq: this.state.nextSeq++ });
    return true;
  }

  /**
   * Startet ein Script-Entry einer Entität als neuen Kontext — die Wirt-Seite
   * der Spieler-Interaktion (F04): Talk (`TALK_SCRIPT_SLOT`) und Contact
   * (`CONTACT_SCRIPT_SLOT`) werden nicht von Skripten, sondern vom Wirt
   * angefordert. Der Kontext läuft mit der normalen Scheduler-Mechanik
   * (Staging an der Tick-Grenze, Budget, Faults) und liegt damit automatisch
   * in jedem Snapshot — es gibt keinen Sonderzustand.
   *
   * Liefert `false` — ohne jede Zustandsänderung, insbesondere ohne
   * `droppedRequests`-Zählung, denn eine abgewiesene Interaktion ist keine
   * Skript-Diagnose — wenn:
   *  - Entität oder Entry nicht existieren (Index außerhalb, Entry null),
   *  - das Entry leer ist: `== codeEnd`-Sentinel ODER Wiederholung eines
   *    kleineren Slots (realdaten-belegt: 288 665 wiederholte gegen 29
   *    Sentinel-Slots — ungenutzte Slots wiederholen frühere Werte),
   *  - der Slot per Fault deaktiviert ist,
   *  - dieses Entry auf der Entität bereits läuft oder ansteht,
   *  - `opts.exclusive` gesetzt ist und die Entität bereits einen Kontext
   *    jenseits der Slot-0-Schleife ausführt oder eingereiht hat.
   */
  requestEntityScript(
    entityIndex: number,
    entryIndex: number,
    opts: { exclusive?: boolean; priority?: number } = {},
  ): boolean {
    const entity = this.state.entities[entityIndex];
    const eps = this.script.entities[entityIndex]?.entryPoints;
    const entry = eps?.[entryIndex];
    if (!entity || !eps || entry === null || entry === undefined) return false;
    if (entry >= this.script.codeEnd) return false; // leerer Span (Sentinel)
    for (let s = 0; s < entryIndex; s++) {
      if (eps[s] === entry) return false; // wiederholter Slot = ungenutzt
    }
    if (entity.disabledSlots.includes(entryIndex)) return false;
    const contexts = entity.context ? [entity.context, ...entity.suspended] : entity.suspended;
    if (contexts.some((c) => c.status === 'running' && c.slot === entryIndex)) return false;
    const pending = [...entity.queue, ...entity.staged];
    if (pending.some((r) => r.slot === entryIndex)) return false;
    if (
      opts.exclusive &&
      (contexts.some((c) => c.status === 'running' && c.slot !== 0) || pending.some((r) => r.slot !== 0))
    ) {
      return false;
    }
    entity.staged.push({
      slot: entryIndex,
      priority: opts.priority ?? PriorityRules.INTERACTION_PRIORITY,
      mode: 'async',
      seq: this.state.nextSeq++,
    });
    return true;
  }

  private makeContext(entityIndex: number, slot: number, priority: number, ip: number): ScriptContext {
    return {
      entityIndex,
      slot,
      priority,
      ip,
      callStack: [],
      waitState: { kind: 'none' },
      status: 'running',
      budgetStrikes: 0,
      faultInfo: undefined,
    };
  }

  /** Ein Logik-Tick. Determinismus: exakt gleiche Abfolge bei gleicher Eingabe. */
  tick(): void {
    const st = this.state;
    st.tickCounter++;
    this.deliverEvents();
    // Staged Requests übernehmen — exakt einmal je Tick-Grenze.
    for (const entity of st.entities) {
      if (entity.staged.length === 0) continue;
      entity.queue.push(...entity.staged);
      entity.staged.length = 0;
      entity.queue.sort(PriorityRules.compareQueue);
    }

    for (let e = 0; e < st.entities.length; e++) {
      const entity = st.entities[e]!;
      this.activateContext(e, entity);
      const ctx = entity.context;
      if (!ctx || ctx.status !== 'running') continue;
      if (!this.resolveWait(ctx)) continue;

      let steps = 0;
      let running = true;
      while (running) {
        if (!this.stepGate(ctx)) break; // Debugger-Halt: Zustand unangetastet
        if (steps >= this.budget) {
          ctx.budgetStrikes++;
          this.observer.budgetForcedYield?.(st.tickCounter, ctx);
          if (ctx.budgetStrikes >= this.maxBudgetStrikes) {
            ctx.status = 'faulted';
            ctx.faultInfo = {
              reason: 'budget',
              op: this.script.code[ctx.ip] ?? -1,
              ip: ctx.ip,
              tick: st.tickCounter,
              detail: `${ctx.budgetStrikes}× Instruktionsbudget (${this.budget}) überschritten`,
            };
            this.finishContext(e, entity, ctx);
          }
          break; // Zwangs-Yield: Kontext bleibt lauffähig für den nächsten Tick
        }
        steps++;
        const outcome = stepInstruction(st, ctx, this.script, this.trace);
        switch (outcome.kind) {
          case 'continue':
            break;
          case 'yield':
            ctx.budgetStrikes = 0;
            this.observer.yielded?.(st.tickCounter, ctx);
            running = false;
            break;
          case 'completed':
          case 'faulted':
            this.finishContext(e, entity, ctx);
            running = false;
            break;
          case 'request': {
            const accepted = this.enqueueRequest(outcome.target, outcome.slot, outcome.priority, outcome.mode);
            this.observer.requested?.(st.tickCounter, e, outcome.target, outcome.slot, outcome.priority, outcome.mode, accepted);
            if (accepted && outcome.mode === 'sync') {
              ctx.waitState = { kind: 'sync', entityIndex: outcome.target, slot: outcome.slot };
              ctx.budgetStrikes = 0;
              this.observer.yielded?.(st.tickCounter, ctx);
              running = false;
            }
            break;
          }
          case 'retto': {
            // RETTO: eigenen Slot anfordern, aktuellen Kontext beenden.
            ctx.status = 'completed';
            this.enqueueRequest(e, outcome.slot, outcome.priority, 'async');
            this.finishContext(e, entity, ctx);
            running = false;
            break;
          }
        }
      }
    }
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /** Snapshot einspielen; liefert Migrationswarnungen (Script-Hash-Guard). */
  restoreFrom(snapshot: RuntimeSnapshot): string[] {
    const { state, warnings } = restoreRuntime(snapshot, this.script);
    this.state = state;
    return warnings;
  }

  /** Alle Kontexte terminal und keine Anforderungen offen? */
  isQuiescent(): boolean {
    return this.state.entities.every(
      (e) =>
        (e.context === null || e.context.status !== 'running') &&
        e.queue.length === 0 &&
        e.staged.length === 0 &&
        e.suspended.length === 0,
    );
  }

  // --- interne Schritte ------------------------------------------------------

  private deliverEvents(): void {
    const st = this.state;
    for (const ev of st.eventQueue) {
      for (const entity of st.entities) {
        // Auch verdrängte Kontexte können in einem Yield-Zustand stecken.
        for (const ctx of entity.context ? [entity.context, ...entity.suspended] : entity.suspended) {
          if (ctx.status !== 'running') continue;
          const w = ctx.waitState;
          if (ev.kind === 'dialogue-resolved' && w.kind === 'dialogue' && w.requestId === ev.requestId) {
            if (w.choice) writeBank(st, w.choice.bank, w.choice.addr, ev.choice, false);
            ctx.waitState = { kind: 'none' };
          } else if (ev.kind === 'movement-arrived' && w.kind === 'movement' && w.requestId === ev.requestId) {
            ctx.waitState = { kind: 'none' };
          } else if (ev.kind === 'battle-finished' && w.kind === 'battle' && w.requestId === ev.requestId) {
            // 🟡 `outcome` wird noch nicht in Variablen gespiegelt — welche
            // Bank/Adresse das Original dafür nutzt, ist nicht belegt. Lieber
            // nichts schreiben als an eine geratene Stelle.
            ctx.waitState = { kind: 'none' };
          } else if (ev.kind === 'menu-closed' && w.kind === 'menu' && w.requestId === ev.requestId) {
            ctx.waitState = { kind: 'none' };
          } else if (ev.kind === 'transition-done' && w.kind === 'transition') {
            // Der Wechselzustand trägt keine requestId — es kann pro Field
            // ohnehin nur einen laufenden Wechsel geben.
            ctx.waitState = { kind: 'none' };
          }
        }
      }
    }
    st.eventQueue.length = 0;
  }

  /** Kontextwahl an der Tick-Grenze: Start aus Queue, Verdrängung, Main-Loop. */
  private activateContext(entityIndex: number, entity: EntityRuntime): void {
    const head = entity.queue[0];
    const active = entity.context;

    if (active && active.status === 'running') {
      if (head && PriorityRules.isHigher(head.priority, active.priority)) {
        entity.suspended.push(active);
        entity.context = this.startFromQueue(entityIndex, entity);
      }
      return;
    }

    if (head) {
      entity.context = this.startFromQueue(entityIndex, entity);
      return;
    }
    if (entity.context === null && this.mainLoop && entity.initDone && entity.mainIp !== null) {
      // Main-Iteration: genau eine je Tick-Grenze (kein Tight-Loop im Tick).
      entity.context = this.makeContext(entityIndex, 0, PriorityRules.INIT_PRIORITY, entity.mainIp);
      this.observer.contextStarted?.(this.state.tickCounter, entity.context);
    }
  }

  private startFromQueue(entityIndex: number, entity: EntityRuntime): ScriptContext | null {
    const req = entity.queue.shift();
    if (!req) return null;
    const entry = this.script.entities[entityIndex]?.entryPoints[req.slot];
    if (entry === null || entry === undefined || entity.disabledSlots.includes(req.slot)) {
      this.state.droppedRequests++;
      return null;
    }
    const ctx = this.makeContext(entityIndex, req.slot, req.priority, entry);
    this.observer.contextStarted?.(this.state.tickCounter, ctx);
    return ctx;
  }

  private finishContext(entityIndex: number, entity: EntityRuntime, ctx: ScriptContext): void {
    this.observer.contextEnded?.(this.state.tickCounter, ctx);
    if (ctx.status === 'faulted' && ctx.faultInfo) {
      // Fault-Isolation (Masterplan 4.3): Diagnose ins Journal, Slot sperren.
      this.state.faultCount++;
      if (this.state.faults.length < FAULT_LOG_CAP) this.state.faults.push(ctx.faultInfo);
      if (!entity.disabledSlots.includes(ctx.slot)) entity.disabledSlots.push(ctx.slot);
      if (ctx.slot === 0) entity.mainIp = null; // Main-Loop stoppen
    }
    // Slot-0-Init/Main-Übergang (🟡): Main beginnt hinter dem Init-RET.
    if (ctx.status === 'completed' && ctx.slot === 0 && !entity.initDone) {
      entity.initDone = true;
      const mainIp = ctx.ip + 1;
      // Main bleibt im Slot-0-Span — nie in den Bereich der nächsten Entität.
      const entry0 = this.script.entities[entityIndex]?.entryPoints[0];
      const bound = entry0 !== null && entry0 !== undefined ? spanEnd(this.script, entry0) : this.script.codeEnd;
      entity.mainIp = this.mainLoop && mainIp < bound ? mainIp : null;
    }
    entity.context = entity.suspended.pop() ?? null;
    // REQEW-Synchronwaiter lösen (Kontext beendet — egal ob completed/faulted).
    for (const other of this.state.entities) {
      for (const octx of other.context ? [other.context, ...other.suspended] : other.suspended) {
        if (
          octx.status === 'running' &&
          octx.waitState.kind === 'sync' &&
          octx.waitState.entityIndex === entityIndex &&
          octx.waitState.slot === ctx.slot
        ) {
          octx.waitState = { kind: 'none' };
        }
      }
    }
  }

  /** true = Kontext darf in diesem Tick Instruktionen ausführen. */
  private resolveWait(ctx: ScriptContext): boolean {
    const w = ctx.waitState;
    switch (w.kind) {
      case 'none':
        return true;
      case 'ticks':
        if (this.state.tickCounter >= w.untilTick) {
          ctx.waitState = { kind: 'none' };
          return true;
        }
        return false;
      default:
        // dialogue/movement: Event-Zustellung; sync: finishContext; Rest terminal.
        return false;
    }
  }
}
