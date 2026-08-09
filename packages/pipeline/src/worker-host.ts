import { parseFieldEntry } from '@webmidgar/formats-field';
import type { Endpoint } from './endpoint.js';
import type {
  DecodedTextureStub,
  PipelineRequest,
  PipelineResponse,
} from './contracts.js';

/**
 * Worker-seitiger Host der Pipeline: dünner Dispatch mit kooperativen
 * Abbruch-Prüfpunkten zwischen den Etappen (Masterplan Phase 2.1).
 * Abbruch erreicht den Host über zwei Kanäle: die 'abort'-Nachricht und —
 * SAB-optional (ADR-003) — das Atomics-Flag, das auch mitten in einer Etappe
 * ohne Message-Roundtrip sichtbar wird.
 */

const yieldTask = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class PipelineWorkerHost {
  private aborts = new Map<number, AbortController>();

  constructor(private readonly endpoint: Endpoint) {
    endpoint.listen((msg) => void this.onMessage(msg as PipelineRequest));
  }

  private post(msg: PipelineResponse, transfer?: Transferable[]): void {
    this.endpoint.post(msg, transfer);
  }

  private async onMessage(msg: PipelineRequest): Promise<void> {
    if (!msg || typeof msg !== 'object' || !('kind' in msg)) return;
    if (msg.kind === 'abort') {
      this.aborts.get(msg.requestId)?.abort();
      return;
    }
    if (msg.v !== 1) {
      this.post({
        v: 1,
        kind: 'fault',
        requestId: msg.requestId,
        code: 'E-PIPE-VERSION',
        message: `Protokollversion ${String((msg as { v?: unknown }).v)} nicht unterstützt`,
      });
      return;
    }

    const ac = new AbortController();
    this.aborts.set(msg.requestId, ac);
    const sabView = msg.abortFlag ? new Int32Array(msg.abortFlag) : null;
    /** Prüfpunkt: SAB-Flag in lokales Abort übersetzen, dann Signal prüfen. */
    const checkpoint = (): void => {
      if (sabView && Atomics.load(sabView, 0) !== 0) ac.abort();
      ac.signal.throwIfAborted();
    };

    try {
      switch (msg.kind) {
        case 'parse-field': {
          checkpoint();
          const { fieldId, bytes, delayMs } = msg.payload;
          // Testbare Etappengrenze: Verzögerung in Scheiben mit Prüfpunkten.
          for (let waited = 0; waited < (delayMs ?? 0); waited += 5) {
            await yieldTask(5);
            checkpoint();
          }
          const result = parseFieldEntry(new Uint8Array(bytes), fieldId, { signal: ac.signal });
          checkpoint(); // keine Auslieferung nach spätem Abbruch
          this.post({ v: 1, kind: 'result', requestId: msg.requestId, payload: result });
          break;
        }
        case 'decode-texture': {
          // Stub (S3-Nicht-Ziel: echte Dekoder) — mehrstufig, damit Abbruch
          // zwischen Etappen injizierbar ist.
          const { width, height } = msg.payload;
          const stages = Math.max(1, msg.payload.stages ?? 4);
          const rgba = new ArrayBuffer(width * height * 4);
          const view = new Uint8Array(rgba);
          const rowsPerStage = Math.ceil(height / stages);
          for (let s = 0; s < stages; s++) {
            checkpoint();
            await yieldTask(0);
            checkpoint();
            const from = s * rowsPerStage;
            const to = Math.min(height, from + rowsPerStage);
            for (let y = from; y < to; y++) {
              for (let x = 0; x < width; x++) {
                const o = (y * width + x) * 4;
                view[o] = x & 0xff;
                view[o + 1] = y & 0xff;
                view[o + 2] = 0x80;
                view[o + 3] = 0xff;
              }
            }
          }
          checkpoint();
          const payload: DecodedTextureStub = { width, height, rgba };
          this.post({ v: 1, kind: 'result', requestId: msg.requestId, payload }, [rgba]);
          break;
        }
        default: {
          const unknown = msg as { kind: string; requestId: number };
          this.post({
            v: 1,
            kind: 'fault',
            requestId: unknown.requestId,
            code: 'E-PIPE-KIND',
            message: `Unbekannte Anfrageart: ${unknown.kind}`,
          });
        }
      }
    } catch (err) {
      if (ac.signal.aborted) {
        this.post({ v: 1, kind: 'aborted', requestId: msg.requestId });
      } else {
        this.post({
          v: 1,
          kind: 'fault',
          requestId: msg.requestId,
          code: 'E-PIPE-INTERNAL',
          message: (err as Error).message,
        });
      }
    } finally {
      this.aborts.delete(msg.requestId);
    }
  }
}
