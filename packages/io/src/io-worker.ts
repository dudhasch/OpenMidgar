/// <reference lib="webworker" />
import { IndexService, EntryNotFoundError, EntryQuarantinedError } from './index-service.js';
import { FsaDirectorySource, type DirectorySource } from './sources.js';
import type { IoRequest, IoResponse, IoWorkerInit } from './messages.js';

/**
 * Worker-Entry des IO/Index-Workers: dünner Dispatch über IndexService.
 * Die gesamte Logik liegt im (in Node testbaren) IndexService.
 */

const service = new IndexService();
let dir: DirectorySource | null = null;
const aborters = new Map<number, AbortController>();

const post = (msg: IoResponse, transfer: Transferable[] = []): void =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<IoRequest | IoWorkerInit>) => {
  const msg = ev.data;
  if (msg.kind === 'init') {
    dir = new FsaDirectorySource(msg.directoryHandle);
    return;
  }
  if (msg.kind === 'abort') {
    aborters.get(msg.requestId)?.abort();
    return;
  }
  const ac = new AbortController();
  aborters.set(msg.requestId, ac);
  try {
    switch (msg.kind) {
      case 'open-source': {
        if (!dir) throw new Error('Worker nicht initialisiert (init fehlt)');
        const result = await service.openSource(dir, {
          signal: ac.signal,
          ...(msg.deep !== undefined ? { deep: msg.deep } : {}),
        });
        post({ v: 1, kind: 'result', requestId: msg.requestId, payload: result });
        break;
      }
      case 'list-entries':
        post({ v: 1, kind: 'result', requestId: msg.requestId, payload: service.listEntries(msg.archiveName) });
        break;
      case 'read-entry': {
        const bytes = await service.readEntry(msg.canonicalId, ac.signal);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        post({ v: 1, kind: 'bytes', requestId: msg.requestId, payload: buf }, [buf]);
        break;
      }
    }
  } catch (err) {
    if (ac.signal.aborted) {
      post({ v: 1, kind: 'aborted', requestId: msg.requestId });
    } else {
      const code =
        err instanceof EntryNotFoundError || err instanceof EntryQuarantinedError
          ? err.code
          : 'E-IO-INTERNAL';
      post({ v: 1, kind: 'fault', requestId: msg.requestId, code, message: (err as Error).message });
    }
  } finally {
    aborters.delete(msg.requestId);
  }
};
