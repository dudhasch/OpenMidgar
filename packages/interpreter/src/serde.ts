import { canonicalJson, fnv1a64HexOfString } from './digest.js';
import type { PreparedScript } from './prepared.js';
import { RUNTIME_SCHEMA_VERSION, type FieldRuntimeState } from './state.js';

/**
 * Snapshot/Restore (Masterplan 4.2): Der Runtime-Zustand ist ein reiner
 * Datenbaum — Snapshot = tiefe Kopie + Schemaversion; Restore validiert
 * gegen den PreparedScript-Hash. Script geändert → definierte Migration:
 * ip-Reset der betroffenen Kontexte auf ihren Entry-Point + Warnung.
 */

export interface RuntimeSnapshot {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  scriptHash: string;
  state: FieldRuntimeState;
}

/** Strukturiert klonbare, tiefe Kopie (Uint8Arrays inklusive). */
export function snapshotRuntime(state: FieldRuntimeState): RuntimeSnapshot {
  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    scriptHash: state.scriptHash,
    state: structuredClone(state),
  };
}

export interface RestoreResult {
  state: FieldRuntimeState;
  /** Migrationswarnungen (Script-Hash-Abweichung → ip-Resets). */
  warnings: string[];
}

export class SnapshotSchemaError extends Error {}

export function restoreRuntime(snapshot: RuntimeSnapshot, script: PreparedScript): RestoreResult {
  if (snapshot.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
    throw new SnapshotSchemaError(`Snapshot-Schema ${snapshot.schemaVersion} ≠ ${RUNTIME_SCHEMA_VERSION}`);
  }
  const state = structuredClone(snapshot.state);
  const warnings: string[] = [];
  if (snapshot.scriptHash !== script.scriptHash) {
    warnings.push(`Script-Hash-Abweichung (${snapshot.scriptHash} → ${script.scriptHash}): ip-Reset aller aktiven Kontexte`);
    state.scriptHash = script.scriptHash;
    state.entities.forEach((entity, e) => {
      entity.suspended = [];
      entity.initDone = false;
      entity.mainIp = null;
      const ctx = entity.context;
      if (!ctx) return;
      const entry = script.entities[e]?.entryPoints[ctx.slot];
      if (entry === null || entry === undefined) {
        entity.context = null;
        warnings.push(`Entität ${e}: Slot ${ctx.slot} existiert nicht mehr — Kontext entfernt`);
      } else {
        ctx.ip = entry;
        ctx.callStack = [];
        ctx.waitState = { kind: 'none' };
        ctx.status = 'running';
        ctx.budgetStrikes = 0;
      }
    });
  }
  return { state, warnings };
}

/**
 * Bitidentischer Zustands-Digest (Replay-Regressionsmaß): FNV-1a-64 über die
 * kanonische JSON-Form des kompletten Zustandsbaums.
 */
export function stateDigest(state: FieldRuntimeState): string {
  return fnv1a64HexOfString(canonicalJson(state));
}
