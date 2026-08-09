import type { LgpEntry } from '@webmidgar/formats-lgp';
import type { OpenSourceResult } from './index-service.js';

/**
 * Versionierter Nachrichtenvertrag des IO/Index-Workers (Masterplan Phase 2.1).
 * Alle Nachrichten sind diskriminierte Records; Antworten referenzieren die
 * requestId. Abbruch ist eine eigene Nachricht auf die laufende requestId.
 */

export const PROTOCOL_VERSION = 1;

export type IoRequest =
  | { v: 1; kind: 'open-source'; requestId: number; deep?: boolean }
  | { v: 1; kind: 'list-entries'; requestId: number; archiveName: string }
  | { v: 1; kind: 'read-entry'; requestId: number; canonicalId: string }
  | { v: 1; kind: 'abort'; requestId: number };

export type IoResponse =
  | { v: 1; kind: 'result'; requestId: number; payload: OpenSourceResult | LgpEntry[] }
  | { v: 1; kind: 'bytes'; requestId: number; payload: ArrayBuffer } // transferiert
  | { v: 1; kind: 'aborted'; requestId: number }
  | { v: 1; kind: 'fault'; requestId: number; code: string; message: string };

/** Der FSA-Handle wird einmalig per structured clone übergeben, nicht pro Request. */
export interface IoWorkerInit {
  v: 1;
  kind: 'init';
  directoryHandle: FileSystemDirectoryHandle;
}
