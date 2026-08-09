/**
 * Endpoint-Abstraktion über postMessage: identischer Vertrag für echte Worker
 * (Browser) und das In-Process-Loopback (Node-Tests). Die Worker-Logik selbst
 * ist dadurch ohne Worker-Runtime testbar (gleiches Muster wie IndexService).
 */

export type MessageHandler = (msg: unknown) => void;

export interface Endpoint {
  post(msg: unknown, transfer?: Transferable[]): void;
  /** Registriert einen Handler; Rückgabe deregistriert ihn. */
  listen(handler: MessageHandler): () => void;
}

/**
 * Zwei verbundene In-Process-Endpoints mit asynchroner Zustellung (Makrotask),
 * damit Abbruch-Injektion zwischen Zustellungen greifen kann wie bei echten
 * Workern. Nachrichten werden bewusst NICHT strukturklont — SharedArrayBuffer-
 * und Transfer-Semantik entsprechen so dem echten Worker-Pfad am nächsten.
 */
export function createLoopbackPair(): [Endpoint, Endpoint] {
  const handlersA = new Set<MessageHandler>();
  const handlersB = new Set<MessageHandler>();
  const make = (own: Set<MessageHandler>, peer: Set<MessageHandler>): Endpoint => ({
    post(msg) {
      setTimeout(() => {
        for (const h of peer) h(msg);
      }, 0);
    },
    listen(handler) {
      own.add(handler);
      return () => own.delete(handler);
    },
  });
  return [make(handlersA, handlersB), make(handlersB, handlersA)];
}

export function workerEndpoint(worker: Worker): Endpoint {
  return {
    post: (msg, transfer) => worker.postMessage(msg, transfer ?? []),
    listen(handler) {
      const on = (ev: MessageEvent): void => handler(ev.data);
      worker.addEventListener('message', on);
      return () => worker.removeEventListener('message', on);
    },
  };
}

export function workerScopeEndpoint(scope: DedicatedWorkerGlobalScope): Endpoint {
  return {
    post: (msg, transfer) => scope.postMessage(msg, transfer ?? []),
    listen(handler) {
      const on = (ev: MessageEvent): void => handler(ev.data);
      scope.addEventListener('message', on);
      return () => scope.removeEventListener('message', on);
    },
  };
}
