import type { RuntimeObserver, ScriptContext } from '@webmidgar/interpreter';

/**
 * Event-Timeline (Masterplan 4.4): globale, tick-indizierte Ereignisliste —
 * Requests, Yields, Kontextstarts/-enden, Faults. Export als strukturiertes
 * JSON ohne Originaltexte (der Interpreter kennt ohnehin nur IDs/Digests).
 */

export type TimelineEvent =
  | { tick: number; kind: 'context-start'; entity: number; slot: number; priority: number; ip: number }
  | { tick: number; kind: 'context-end'; entity: number; slot: number; status: string; faultReason?: string | undefined }
  | { tick: number; kind: 'yield'; entity: number; slot: number; waitKind: string }
  | { tick: number; kind: 'request'; source: number; target: number; slot: number; priority: number; mode: string; accepted: boolean }
  | { tick: number; kind: 'budget-forced-yield'; entity: number; slot: number; strikes: number };

export class Timeline implements RuntimeObserver {
  readonly events: TimelineEvent[] = [];

  contextStarted(tick: number, ctx: ScriptContext): void {
    this.events.push({ tick, kind: 'context-start', entity: ctx.entityIndex, slot: ctx.slot, priority: ctx.priority, ip: ctx.ip });
  }

  contextEnded(tick: number, ctx: ScriptContext): void {
    this.events.push({
      tick,
      kind: 'context-end',
      entity: ctx.entityIndex,
      slot: ctx.slot,
      status: ctx.status,
      faultReason: ctx.faultInfo?.reason,
    });
  }

  yielded(tick: number, ctx: ScriptContext): void {
    this.events.push({ tick, kind: 'yield', entity: ctx.entityIndex, slot: ctx.slot, waitKind: ctx.waitState.kind });
  }

  requested(tick: number, source: number, target: number, slot: number, priority: number, mode: string, accepted: boolean): void {
    this.events.push({ tick, kind: 'request', source, target, slot, priority, mode, accepted });
  }

  budgetForcedYield(tick: number, ctx: ScriptContext): void {
    this.events.push({ tick, kind: 'budget-forced-yield', entity: ctx.entityIndex, slot: ctx.slot, strikes: ctx.budgetStrikes });
  }

  /** Asset-freier JSON-Export (Masterplan-Vorgabe). */
  toJson(): string {
    return JSON.stringify(this.events);
  }
}
