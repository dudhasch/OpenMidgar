import type { Telemetry } from '@webmidgar/telemetry';
import type { Endpoint } from './endpoint.js';
import {
  PipelineFault,
  type PipelineRequest,
  type PipelineResponse,
} from './contracts.js';

/**
 * Main-Thread-Seite der Pipeline (Masterplan Phase 2.1):
 * requestId-Korrelation, Generationszähler für Field-Wechsel-Abbrüche,
 * SAB-optionaler Abbruchkanal (ADR-003), Latenz-/Zähler-Telemetrie.
 *
 * Abbruchsemantik: abort() verwirft die Anfrage sofort lokal (Promise-Reject);
 * verspätete Antworten finden keinen Pending-Eintrag mehr und werden als
 * `stale-dropped` gezählt — eine Auslieferung nach Abbruch ist damit
 * strukturell unmöglich.
 */

export interface ClientOptions {
  telemetry?: Telemetry;
  /** SAB-Abbruchkanal aktivieren (nur wirksam, wenn SharedArrayBuffer existiert). */
  sharedAbort?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  transfer?: Transferable[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  generation: number;
  stopTimer?: (() => number) | undefined;
  abortFlag?: Int32Array | undefined;
  detachSignal?: (() => void) | undefined;
}

const abortError = (): DOMException => new DOMException('Anfrage abgebrochen', 'AbortError');

export class PipelineClient {
  private pending = new Map<number, Pending>();
  private nextRequestId = 1;
  private currentGeneration = 0;

  constructor(
    private readonly endpoint: Endpoint,
    private readonly opts: ClientOptions = {},
  ) {
    endpoint.listen((msg) => this.onResponse(msg as PipelineResponse));
  }

  get generation(): number {
    return this.currentGeneration;
  }

  request(
    kind: 'parse-field' | 'decode-texture',
    payload: unknown,
    o: RequestOptions = {},
  ): Promise<unknown> {
    const telemetry = this.opts.telemetry;
    if (o.signal?.aborted) {
      telemetry?.count('pipeline.aborted');
      return Promise.reject(abortError());
    }
    const requestId = this.nextRequestId++;
    const generation = this.currentGeneration;
    const useSab = (this.opts.sharedAbort ?? false) && typeof SharedArrayBuffer !== 'undefined';
    const sab = useSab ? new SharedArrayBuffer(4) : undefined;

    return new Promise((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        generation,
        stopTimer: telemetry?.time(`pipeline.${kind}`),
        abortFlag: sab ? new Int32Array(sab) : undefined,
      };
      if (o.signal) {
        const onAbort = (): void => this.abort(requestId);
        o.signal.addEventListener('abort', onAbort, { once: true });
        entry.detachSignal = () => o.signal!.removeEventListener('abort', onAbort);
      }
      this.pending.set(requestId, entry);
      const msg = {
        v: 1,
        kind,
        requestId,
        generation,
        payload,
        ...(sab ? { abortFlag: sab } : {}),
      } as PipelineRequest;
      this.endpoint.post(msg, o.transfer);
    });
  }

  /** Bricht eine einzelne Anfrage ab (lokal sofort, Worker kooperativ). */
  abort(requestId: number): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.detachSignal?.();
    if (entry.abortFlag) {
      Atomics.store(entry.abortFlag, 0, 1); // sichtbar auch mitten in einer Etappe
    }
    this.endpoint.post({ v: 1, kind: 'abort', requestId } satisfies PipelineRequest);
    this.opts.telemetry?.count('pipeline.aborted');
    entry.reject(abortError());
  }

  /**
   * Field-Wechsel (Masterplan 2.1): neue Generation; alle in-flight-Anfragen
   * älterer Generationen werden abgebrochen.
   */
  beginGeneration(): number {
    this.currentGeneration++;
    for (const [requestId, entry] of [...this.pending]) {
      if (entry.generation < this.currentGeneration) this.abort(requestId);
    }
    return this.currentGeneration;
  }

  private onResponse(msg: PipelineResponse): void {
    if (!msg || typeof msg !== 'object' || !('requestId' in msg)) return;
    const entry = this.pending.get(msg.requestId);
    if (!entry) {
      // Verspätete Antwort einer abgebrochenen/verdrängten Anfrage.
      this.opts.telemetry?.count('pipeline.stale-dropped');
      return;
    }
    this.pending.delete(msg.requestId);
    entry.detachSignal?.();
    switch (msg.kind) {
      case 'result':
        entry.stopTimer?.();
        entry.resolve(msg.payload);
        break;
      case 'aborted':
        this.opts.telemetry?.count('pipeline.aborted');
        entry.reject(abortError());
        break;
      case 'fault':
        this.opts.telemetry?.count('pipeline.fault');
        entry.reject(new PipelineFault(msg.code, msg.message));
        break;
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
