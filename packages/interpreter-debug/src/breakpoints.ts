import type { FieldRuntime, ScriptContext } from '@webmidgar/interpreter';

/**
 * Breakpoints (Masterplan 4.4): auf (entityIndex, slot, ip) oder auf
 * Kategorie-Ort. Anhalten wirkt über das `stepGate` der Runtime — der
 * getroffene Kontext bleibt exakt VOR der Instruktion stehen; andere
 * Kontexte laufen weiter. Einzelschritt = 1 Instruktion.
 */

export interface Breakpoint {
  entityIndex?: number | undefined;
  slot?: number | undefined;
  ip?: number | undefined;
}

export interface BreakHit {
  tick: number;
  entityIndex: number;
  slot: number;
  ip: number;
}

export class BreakpointManager {
  private breakpoints: Breakpoint[] = [];
  /** Kontexte, die im aktuellen Halt einmalig weiter dürfen (Einzelschritt). */
  private stepBudget = new Map<string, number>();
  private paused = new Set<string>();
  readonly hits: BreakHit[] = [];

  constructor(private readonly runtime: FieldRuntime) {
    runtime.stepGate = (ctx) => this.gate(ctx);
  }

  private key(ctx: ScriptContext): string {
    return `${ctx.entityIndex}/${ctx.slot}`;
  }

  add(bp: Breakpoint): void {
    this.breakpoints.push(bp);
  }

  clear(): void {
    this.breakpoints = [];
  }

  /** Angehaltenen Kontext wieder freigeben (bis zum nächsten Treffer). */
  resume(entityIndex: number, slot: number): void {
    this.paused.delete(`${entityIndex}/${slot}`);
    this.stepBudget.delete(`${entityIndex}/${slot}`);
  }

  /** Einzelschritt: genau n Instruktionen ausführen, dann wieder halten. */
  step(entityIndex: number, slot: number, instructions = 1): void {
    this.stepBudget.set(`${entityIndex}/${slot}`, instructions);
  }

  isPaused(entityIndex: number, slot: number): boolean {
    return this.paused.has(`${entityIndex}/${slot}`);
  }

  private matches(ctx: ScriptContext): boolean {
    return this.breakpoints.some(
      (bp) =>
        (bp.entityIndex === undefined || bp.entityIndex === ctx.entityIndex) &&
        (bp.slot === undefined || bp.slot === ctx.slot) &&
        (bp.ip === undefined || bp.ip === ctx.ip),
    );
  }

  private gate(ctx: ScriptContext): boolean {
    const key = this.key(ctx);
    const budget = this.stepBudget.get(key);
    if (budget !== undefined) {
      if (budget <= 0) {
        // Einzelschritt verbraucht → zurück in den Haltezustand.
        this.stepBudget.delete(key);
        this.paused.add(key);
        return false;
      }
      this.stepBudget.set(key, budget - 1);
      return true;
    }
    if (this.paused.has(key)) return false;
    if (this.matches(ctx)) {
      this.paused.add(key);
      this.hits.push({ tick: this.runtime.state.tickCounter, entityIndex: ctx.entityIndex, slot: ctx.slot, ip: ctx.ip });
      return false;
    }
    return true;
  }
}
