/**
 * Interpreter-Zustandsmodell (Masterplan 4.2): reiner Datenbaum — keine
 * Closures, keine Promises. Yield-Zustände sind Daten (`WaitState`),
 * damit Snapshot/Restore und Replay trivial korrekt sind (ADR-006).
 */

export const RUNTIME_SCHEMA_VERSION = 1;

/** Bänke 0x1–0xF à 256 Bytes; Bank 0 = Literal-Marker in Operanden. */
export const BANK_COUNT = 16;
export const BANK_SIZE = 256;

/**
 * 🟡 `Zu validieren`: welche Bänke savegame-global vs. field-lokal sind.
 * S6-Annahme: 1+2 global, Rest field-lokal/temporär. Nur Scoping-Frage —
 * Snapshots serialisieren immer alle Bänke.
 */
export const GLOBAL_BANKS: readonly number[] = [1, 2];

export type WaitState =
  | { kind: 'none' }
  | { kind: 'ticks'; untilTick: number }
  | { kind: 'dialogue'; requestId: number; choice?: { bank: number; addr: number } | undefined }
  | { kind: 'movement'; requestId: number }
  | { kind: 'sync'; entityIndex: number; slot: number }
  | { kind: 'transition' }
  | { kind: 'battle' };

export type ContextStatus = 'running' | 'completed' | 'faulted';

export interface FaultInfo {
  /** Strukturierte Diagnose — Digests statt Inhalte (Masterplan 4.4). */
  reason: 'unknown-op' | 'budget' | 'data' | 'unknown-comparison';
  op: number;
  ip: number;
  tick: number;
  detail: string;
}

/** Ein Ausführungskontext = Entität × aktiver Script-Slot. */
export interface ScriptContext {
  entityIndex: number;
  slot: number;
  /** 🟡 Prioritätsskala 0–7; Annahme: kleiner = höher (`Zu validieren`). */
  priority: number;
  /** Instruktionszeiger, sektionsrelativ (wie die Entry-Points). */
  ip: number;
  callStack: number[];
  waitState: WaitState;
  status: ContextStatus;
  /** Zwangs-Yield-Eskalation: Budgetüberschreitungen in Folge. */
  budgetStrikes: number;
  faultInfo?: FaultInfo | undefined;
}

/** Wartende Script-Anforderung (REQ/REQSW/REQEW) an eine Entität. */
export interface PendingRequest {
  slot: number;
  priority: number;
  /** sync: anfordernder Kontext wartet auf Abschluss (REQEW). */
  mode: 'async' | 'async-guaranteed' | 'sync';
  /** Für Determinismus: Einreihungsfolge als stabiler Tiebreaker. */
  seq: number;
}

export interface EntityRuntime {
  /** Aktiver Kontext oder null (idle). */
  context: ScriptContext | null;
  /** Durch höherpriore Requests verdrängte Kontexte (LIFO). */
  suspended: ScriptContext[];
  queue: PendingRequest[];
  /**
   * Determinismusregel „Requests wirken am Tickanfang": neu eingereihte
   * Anforderungen landen hier und werden erst an der nächsten Tick-Grenze
   * in `queue` übernommen — unabhängig von der Entitätsreihenfolge.
   */
  staged: PendingRequest[];
  /** Gefaultete Slots — deaktiviert, Requests dorthin werden verworfen. */
  disabledSlots: number[];
  /**
   * 🟡 Slot-0-Semantik (`Zu validieren`, R1): Teil bis zum ersten RET = Init
   * (läuft einmal), Rest = Main (läuft wiederholt, 1 Iteration je Tick-Grenze).
   */
  initDone: boolean;
  mainIp: number | null;
}

/** Externe, tick-synchron einsortierte Ereignisse (UI, Solver, …). */
export type RuntimeEvent =
  | { kind: 'dialogue-resolved'; requestId: number; choice: number }
  | { kind: 'movement-arrived'; requestId: number };

export interface FieldRuntimeState {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  /** FNV-1a-64-Hash des PreparedScript-Bytecodes (Restore-Guard). */
  scriptHash: string;
  tickCounter: number;
  /** Deterministischer PRNG-Zustand (RANDOM-Op); Teil jedes Snapshots. */
  rngState: number;
  /** Monoton für requestId/seq-Vergabe. */
  nextRequestId: number;
  nextSeq: number;
  banks: Uint8Array[];
  entities: EntityRuntime[];
  eventQueue: RuntimeEvent[];
  /** Telemetrie der UNKNOWN-Politik: op → Übersprung-Zähler. */
  unknownSkips: Record<number, number>;
  /** Requests an nicht existente Entitäten/Slots (diagnostiziert, nie geraten). */
  droppedRequests: number;
  /** Fault-Journal (Masterplan 4.3: „Fehler isoliert, Diagnose geloggt"). */
  faults: FaultInfo[];
  /** Gesamtzahl — `faults` ist auf FAULT_LOG_CAP Einträge begrenzt. */
  faultCount: number;
}

export const FAULT_LOG_CAP = 200;

export function createBanks(): Uint8Array[] {
  return Array.from({ length: BANK_COUNT }, () => new Uint8Array(BANK_SIZE));
}

export function readBank(state: FieldRuntimeState, bank: number, addr: number, word: boolean): number {
  const b = state.banks[bank & 0xf]!;
  return word ? b[addr & 0xff]! | (b[(addr + 1) & 0xff]! << 8) : b[addr & 0xff]!;
}

export function writeBank(state: FieldRuntimeState, bank: number, addr: number, value: number, word: boolean): void {
  const b = state.banks[bank & 0xf]!;
  b[addr & 0xff] = value & 0xff;
  if (word) b[(addr + 1) & 0xff] = (value >>> 8) & 0xff;
}

/** mulberry32 — identisch zur Fixture-PRNG-Konvention des Projekts. */
export function nextRandom(state: FieldRuntimeState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
