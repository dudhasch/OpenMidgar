import type { OpCategory } from './opcodes.js';

/**
 * Opcode-Tracing (Masterplan 4.4): Ringpuffer je Kontext, Off-Modus
 * kostenneutral (No-op-Sink). Einträge tragen Digests, nie Originaltexte.
 */

export interface TraceEntry {
  tick: number;
  entityIndex: number;
  slot: number;
  ip: number;
  op: number;
  category: OpCategory;
  /** FNV-1a-32 über die Operandenbytes (asset-frei). */
  operandsDigest: number;
}

export interface TraceSink {
  record(entry: TraceEntry): void;
}

export const NOOP_TRACE: TraceSink = { record: () => undefined };

export class RingTrace implements TraceSink {
  private buffer: (TraceEntry | undefined)[];
  private cursor = 0;
  private filled = false;

  constructor(readonly capacity = 256) {
    this.buffer = new Array<TraceEntry | undefined>(capacity);
  }

  record(entry: TraceEntry): void {
    this.buffer[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.cursor === 0) this.filled = true;
  }

  /** Einträge in Aufzeichnungsreihenfolge (älteste zuerst). */
  entries(): TraceEntry[] {
    const tail = this.filled ? this.buffer.slice(this.cursor) : [];
    const head = this.buffer.slice(0, this.cursor);
    return [...tail, ...head].filter((e): e is TraceEntry => e !== undefined);
  }

  /** Letzte n Einträge — für strukturierte FaultInfo-Anhänge. */
  last(n: number): TraceEntry[] {
    const all = this.entries();
    return all.slice(Math.max(0, all.length - n));
  }
}
