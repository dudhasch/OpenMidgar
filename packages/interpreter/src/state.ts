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
 * Bank-Aliasing (S14). Die 15 adressierbaren Bänke zeigen **nicht** auf 15
 * getrennte Speicher: Sie bilden Paare, die dieselbe Region ansprechen. Der
 * S6-Stand mit 16 unabhängigen Bänken war darin falsch — ein Skript, das über
 * Bank 1 schreibt und über Bank 2 liest, hätte den Wert nie gesehen.
 *
 * Abbildung Bank → Region. Die Paare (1,2), (3,4), (B,C), (D,E), (7,F) teilen
 * sich je eine persistente 256-B-Region der Savemap; (5,6) ist die temporäre,
 * field-lokale Region.
 *
 * 🟡 Die Paarbildung selbst ist Community-dokumentiert und über die
 * Zugriffsmuster im Bestand plausibilisiert, aber nicht bewiesen. Sie ist
 * bewusst als Tabelle geführt, damit sie an genau einer Stelle korrigierbar
 * bleibt.
 */
export const BANK_REGION: readonly number[] = [
  // 0 = Literal-Marker (keine Region), danach je Bank die Regionsnummer.
  -1, 0, 0, 1, 1, 5, 5, 4, -1, -1, -1, 2, 2, 3, 3, 4,
];

/** Anzahl echter Speicherregionen (5 persistente + 1 temporäre + Reserve). */
export const REGION_COUNT = 6;

/**
 * Regionen, die in den Spielstand gehören. Die temporäre Region (Bänke 5/6)
 * ist field-lokal und wird beim Field-Wechsel verworfen.
 */
export const PERSISTENT_REGIONS: readonly number[] = [0, 1, 2, 3, 4];
export const TEMP_REGION = 5;

/** Rückwärtskompatibler Name aus S6 — jetzt aus dem Regionsmodell abgeleitet. */
export const GLOBAL_BANKS: readonly number[] = BANK_REGION.map((r, bank) =>
  r >= 0 && PERSISTENT_REGIONS.includes(r) ? bank : -1,
).filter((b) => b > 0);

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

/**
 * Sichtbarer Zustand einer Entität (S12). Die Bewegungs-Opcodes schreiben
 * ausschließlich hierhin — die eigentliche Bewegung führt der Host mit dem
 * Walkmesh-Solver aus und meldet die Ankunft als Ereignis zurück. Damit bleibt
 * der Interpreter ein reiner Zustandsübergang (ADR-006) und der Solver die
 * einzige Instanz, die über Begehbarkeit entscheidet.
 */
export interface ActorRuntime {
  /** Modellindex aus dem Field-Manifest (CHAR); null = kein Modell gebunden. */
  modelIndex: number | null;
  /** Partymitglied-Slot (PC); null = keine Zuordnung. */
  partyMember: number | null;
  visible: boolean;
  /** Grundriss + Höhe im FF7-Raum; null = noch nicht platziert. */
  position: [number, number, number] | null;
  /** Walkmesh-Dreieck aus XYZI; null = unbekannt. */
  triangle: number | null;
  /** Blickrichtung in Grad (0 = +x); null = unverändert. */
  direction: number | null;
  /** Dauerhafte Animation (DFANM) bzw. Einmalanimation (ANIME1). */
  animation: { id: number; speed: number; loop: boolean } | null;
  /** Laufender Bewegungsauftrag; der Host arbeitet ihn ab. */
  moveTarget: { x: number; y: number; requestId: number } | null;
  /** Bewegungsgeschwindigkeit in Field-Einheiten je Takt (MSPED). */
  moveSpeed: number;
}

export function createActor(): ActorRuntime {
  return {
    modelIndex: null,
    partyMember: null,
    visible: true,
    position: null,
    triangle: null,
    direction: null,
    animation: null,
    moveTarget: null,
    moveSpeed: DEFAULT_MOVE_SPEED,
  };
}

/** 🟡 Vorgabe in Field-Einheiten je Takt; MSPED überschreibt sie. */
export const DEFAULT_MOVE_SPEED = 8;

/**
 * Wirkungen nach außen (S17) — als **Daten**, nicht als Aufrufe.
 *
 * Musik, Kampf und Field-Wechsel sind Nebenwirkungen, die der Interpreter
 * nicht selbst ausführen darf: Sie sind langsam, asynchron und teilweise
 * unumkehrbar. Er reiht sie stattdessen ein, der Host arbeitet sie ab und
 * antwortet über die Ereignisschlange. Damit bleibt jeder Tick ein reiner
 * Zustandsübergang und der Replay bitgenau (ADR-006).
 */
export type HostRequest =
  | { kind: 'music'; trackId: number }
  | { kind: 'sound'; soundId: number; pan: number }
  | { kind: 'battle'; encounterId: number; requestId: number }
  | { kind: 'field-change'; maplistIndex: number; requestId: number }
  | { kind: 'save-offer'; requestId: number };

/** Externe, tick-synchron einsortierte Ereignisse (UI, Solver, …). */
export type RuntimeEvent =
  | { kind: 'dialogue-resolved'; requestId: number; choice: number }
  | { kind: 'movement-arrived'; requestId: number }
  /** Kampf beendet; `outcome` wird laut Vertragstabelle in Variablen gespiegelt. */
  | { kind: 'battle-finished'; requestId: number; outcome: number }
  | { kind: 'transition-done'; requestId: number };

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
  /** Sichtbarer Entitätszustand, parallel zu `entities` indiziert (S12). */
  actors: ActorRuntime[];
  eventQueue: RuntimeEvent[];
  /** Ausstehende Wirkungen nach außen; der Host leert die Liste je Takt. */
  hostRequests: HostRequest[];
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

/**
 * Legt die Bankschicht an: `REGION_COUNT` echte Puffer, auf die die 16
 * Bank-Indizes gemäß `BANK_REGION` zeigen. Gepaarte Bänke teilen sich damit
 * denselben Speicher — genau das ist die S14-Korrektur.
 *
 * Bank 0 und die nicht belegten Indizes bekommen einen eigenen Wegwerfpuffer,
 * damit ein versehentlicher Zugriff nicht stillschweigend eine echte Region
 * trifft.
 */
export function createBanks(): Uint8Array[] {
  const regions = Array.from({ length: REGION_COUNT }, () => new Uint8Array(BANK_SIZE));
  const scratch = new Uint8Array(BANK_SIZE);
  return Array.from({ length: BANK_COUNT }, (_, bank) => {
    const region = BANK_REGION[bank] ?? -1;
    return region >= 0 ? regions[region]! : scratch;
  });
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

/**
 * Die eindeutigen Regionspuffer in stabiler Reihenfolge — für Snapshot und
 * Spielstand. Über `state.banks` zu serialisieren würde jede Region mehrfach
 * schreiben und beim Restore die Aliasbindung zerstören.
 */
export function regionBuffers(state: FieldRuntimeState): Uint8Array[] {
  const seen = new Map<Uint8Array, number>();
  const out: Uint8Array[] = [];
  for (const bank of state.banks) {
    if (seen.has(bank)) continue;
    seen.set(bank, out.length);
    out.push(bank);
  }
  return out;
}

/** mulberry32 — identisch zur Fixture-PRNG-Konvention des Projekts. */
export function nextRandom(state: FieldRuntimeState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
