/**
 * Interpreter-Zustandsmodell (Masterplan 4.2): reiner Datenbaum — keine
 * Closures, keine Promises. Yield-Zustände sind Daten (`WaitState`),
 * damit Snapshot/Restore und Replay trivial korrekt sind (ADR-006).
 */

/**
 * Schema 1 → 2 (Dialogtext-Pipeline): Der `dialogue`-Wartezustand trägt jetzt
 * den String-Index des Opcodes (`dialogId`, bei ASK zusätzlich firstChoice/
 * lastChoice). Ein Schema-1-Snapshot mitten im Dialog könnte den Index nicht
 * liefern — er ist eine Operandenangabe und aus dem alten Zustand nicht
 * rekonstruierbar. Deshalb laut scheitern statt still raten (ADR-006).
 */
export const RUNTIME_SCHEMA_VERSION = 2;

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
  | {
      kind: 'dialogue';
      requestId: number;
      /** String-Index in die Field-Stringtabelle (MESSAGE-/ASK-Operand). */
      dialogId: number;
      /** Zielvariable der Auswahl (nur ASK). */
      choice?: { bank: number; addr: number } | undefined;
      /** Erste/letzte wählbare Zeile (nur ASK; aus den Operanden). */
      firstChoice?: number | undefined;
      lastChoice?: number | undefined;
    }
  | { kind: 'movement'; requestId: number }
  | { kind: 'sync'; entityIndex: number; slot: number }
  | { kind: 'transition' }
  | { kind: 'battle'; requestId: number }
  /** Menü offen; der Kontext läuft weiter, sobald der Wirt es schließt (S21). */
  | { kind: 'menu'; requestId: number };

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
  /**
   * ⚠️ **`trackId` ist KEIN Titel, sondern der rohe MUSIC-Operand** — ein
   * **field-lokaler Index in die AKAO-Offsettabelle** der eigenen Sektion 1
   * (F09-B, 98,95 % gegen 71,92 %/49,88 % Kontrollniveau). Der Wirt muss ihn
   * mit `resolveFieldMusic` aus `@webmidgar/formats-field` auflösen:
   * `trackId → akaoOffsets[trackId] → AKAO-Kopf → musicId (1…98)
   *  → music.idx[musicId − 1] → OGG`.
   * Der Name bleibt aus engineCompat-Gründen stehen (er steckt in Replay-
   * Protokollen); ihn direkt als `music.idx`-Zeile zu lesen ist falsch — genau
   * das war der Defekt hinter F09.
   */
  | { kind: 'music'; trackId: number }
  | { kind: 'sound'; soundId: number; pan: number }
  | { kind: 'battle'; encounterId: number; requestId: number }
  | { kind: 'field-change'; maplistIndex: number; requestId: number }
  | { kind: 'save-offer'; requestId: number }
  /**
   * Menü öffnen (S21). `selector` und `param` bleiben **roh**: Die
   * Operandenform ist realdaten-vermessen (Bankbyte, Auswahl mit 22 Werten,
   * Parameter mit 67 Werten über 296 Vorkommen), die Bedeutung der einzelnen
   * Auswahlwerte ist es nicht. Sie zu raten hieße, eine falsche Ansicht
   * überzeugend aussehen zu lassen — der Wirt bildet sie stattdessen über eine
   * austauschbare Tabelle ab und meldet, was er nicht kennt.
   */
  | { kind: 'menu'; selector: number; param: number; requestId: number };

/** Externe, tick-synchron einsortierte Ereignisse (UI, Solver, …). */
export type RuntimeEvent =
  | { kind: 'dialogue-resolved'; requestId: number; choice: number }
  | { kind: 'movement-arrived'; requestId: number }
  /** Kampf beendet; `outcome` wird laut Vertragstabelle in Variablen gespiegelt. */
  | { kind: 'battle-finished'; requestId: number; outcome: number }
  | { kind: 'transition-done'; requestId: number }
  | { kind: 'menu-closed'; requestId: number };

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
  /**
   * Zustand von `BTLON` (0x71). 🟡 Die Polarität des Operanden ist nicht
   * belegt — der Wert wird roh mitgeführt, damit der Wirt entscheidet. Teil
   * des Snapshots, weil er das Verhalten beeinflusst.
   */
  randomEncountersDisabled: boolean;
  /**
   * Hintergrund-Zustandsbits je Animationsparameter (BGON/BGOFF/BGCLR,
   * F22-Mechanismus). Schlüssel = param, Wert = Bitmaske der aktiven
   * Zustände (`1 << state`). Ein Tile mit state ≠ 0 ist sichtbar, wenn sein
   * Bit gesetzt ist; state 0 ist immer sichtbar (Makou-Regel). Teil des
   * Snapshots, weil sichtbarer Zustand.
   */
  bgStates: Record<number, number>;
  /**
   * Zustand von `MENU2` (0x4A) — der Zugriffssperre auf das Menü. 🟡 Der
   * Operand nimmt im Bestand **sechs** verschiedene Werte an (8212 Vorkommen),
   * ist also keine Ja/Nein-Angabe. Er wird deshalb roh mitgeführt, damit der
   * Wirt entscheidet; dieselbe Zurückhaltung wie bei `BTLON`.
   */
  menuAccessRaw: number;
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

/**
 * **O7 ✅ geschlossen (2026-08-11) — die Wrap-Regel steht jetzt auf einer Zahl.**
 *
 * Ein 16-Bit-Zugriff auf Bankadresse 0xFF braucht zwei Bytes, aber dort endet
 * die Bank. Diese Implementierung wrappt **innerhalb** der Bank (`b[0xFF] |
 * b[0x00] << 8`); die Alternative wäre ein Übergriff in die Folgeregion. Beide
 * Auslegungen unterscheiden sich an genau einer Adresse.
 *
 * Bisher war das eine Annahme. Gemessen (702 Fields,
 * `tools/realdata-scan/src/bank-wrap-probe.rdtest.ts`): Wortvarianten mit
 * Bankzugriff auf Adresse 0xFF kommen **genau 1-mal** vor (Field `blinele`,
 * Opcode 0xAND2), IF-Wortvarianten **0-mal**. Die Kontrollzählung für die
 * Nachbaradresse 0xFE ergibt ebenfalls 0 — die Seltenheit ist also die
 * Randlage hoher Bankadressen und keine Besonderheit von 0xFF.
 *
 * Die Regel bleibt damit stehen, **begründet durch Irrelevanz statt durch
 * Wissen**: Bei einer einzigen Fundstelle im gesamten Bestand kann keine der
 * beiden Auslegungen einen sichtbaren Unterschied machen. Die Probe bleibt als
 * Dauerprobe erhalten und schlägt bei mehr als 5 Fundstellen fehl — dann wäre
 * die Irrelevanz aufgehoben und die Frage wieder offen.
 */
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

/**
 * 🔵 **Anfangszustand der Hintergrund-Zustandsmasken (F35-1).**
 *
 * Bis hierher startete jedes Field mit einer leeren `bgStates`-Karte. Für jede
 * Tile-Gruppe mit `param ≠ 0` bedeutet das: kein Zustandsbit gesetzt, also
 * **keine** ihrer Kacheln sichtbar. In `junonr2` sind das die Gondel (Layer 1,
 * param 16, 53 Kacheln) und zwei weitere Gruppen — sie fehlten im Bild
 * vollständig, obwohl die Kacheln geladen waren.
 *
 * **Was zuerst geprüft und ausgeschlossen wurde.** Der Verdacht lag auf der
 * Bankbyte-Aufteilung in `vm.ts` (`banks>>4` = Parameter, `banks&0xf` =
 * Zustand): Wäre sie falsch, träfe BGOFF den falschen Parameter. Gemessen über
 * alle 702 Fields tragen **97,3 %** der BGON- und **96,8 %** der
 * BGOFF-Instruktionen ein Bankbyte von 0 — und in `junonr2` sind es **alle 46**
 * BG-Instruktionen. Bei Literaloperanden ist die Aufteilung wirkungslos. Die
 * Maske ist also korrekt leer; die Ursache liegt nicht im Split.
 *
 * **Die Entscheidung.** Im Original ist beim Field-Start je Parameter genau ein
 * Zustand aktiv, nicht keiner — sonst wäre jede animierte Hintergrundgruppe
 * beim Betreten unsichtbar, bis das Skript sie einschaltet. Als Anfangszustand
 * wird deshalb je Parameter das **niedrigste im Hintergrund vorkommende
 * Zustandsbit** vorbelegt. Für `junonr2` ergibt das `{16: 1, 17: 1, 18: 1}`.
 *
 * Das ist eine 🔵-Architekturentscheidung, keine Messung: Welcher Zustand im
 * Original der Anfangszustand ist, steht nicht in den Field-Daten. Das
 * niedrigste Bit ist gewählt, weil die Zustände einer Gruppe durchweg als
 * aufsteigende Bitfolge (1, 2, 4, …) vergeben sind und die Skripte sie in
 * dieser Reihenfolge durchschalten — der erste Animationsschritt ist damit der
 * plausibelste Ruhezustand. Fällt die Wahl später anders aus, ist genau diese
 * Funktion der einzige zu ändernde Ort.
 *
 * `param === 0` bleibt ausgespart: Diese Kacheln sind statisch und immer
 * sichtbar (F22-Regel), ein Zustandsbit hätten sie nur scheinbar.
 *
 * ---
 *
 * ⚠️ **Gemessene Wirkung — und die Grenze davon**
 * (`tools/realdata-scan/src/bg-anfangszustand-probe.rdtest.ts`, 702 Fields):
 *
 *  - 508 Fields tragen zusammen **1256** animierte Kachelgruppen. Ohne
 *    Vorbelegung ist beim Field-Start **jede** davon leer, mit Vorbelegung
 *    **keine**.
 *  - Entscheidend ist aber der Zustand NACH dem Skriptlauf, nicht beim Start.
 *    Nach 300 Ticks sind ohne Vorbelegung **542** Gruppen leer, mit
 *    Vorbelegung **329** — die Vorbelegung rettet **213 Gruppen mit 9682
 *    Kacheln**, die sonst unsichtbar blieben.
 *  - 🔴 **`junonr2` — der Auslöser von F35-1 — ist NICHT darunter.** Gemessen:
 *    Vorbelegung `{16: 1, 17: 1, 18: 1}`, nach 300 Ticks sowohl ohne als auch
 *    mit Vorbelegung `{16: 0, 17: 0, 18: 1}`. Das Skript des Fields räumt die
 *    Parameter 16 und 17 selbst wieder ab: Alle **46** BG-Instruktionen von
 *    `junonr2` tragen ein Bankbyte von 0, laufen also mit Literaloperanden und
 *    schalten die Zustände paarweise (BGON s, dann BGOFF s) durch, gefolgt von
 *    BGCLR auf Parameter 16.
 *
 * Die Gondel bleibt damit unsichtbar, und die Ursache liegt **nicht mehr im
 * Interpreter**: Entweder erreicht der Wirt die Animationsunterroutine bei
 * Field-Start, obwohl das Original sie erst beim Benutzen des Lifts anstößt
 * (Kontrollfluss), oder die Zeichenregel ist falsch — dann müsste eine leere
 * Maske nicht „alles unsichtbar" bedeuten, sondern „Rückfall auf den
 * Anfangszustand". Die zweite Lesart passt zur Beobachtung, ist aber eine
 * Entscheidung der Zeichenseite und gehört nicht hierher. Beides ohne Messung
 * zu ändern, wäre Raten.
 */
export function berechneAnfangsBgStates(
  kacheln: Iterable<{ param: number; state: number }>,
): Record<number, number> {
  const niedrigste = new Map<number, number>();
  for (const { param, state } of kacheln) {
    if (param === 0 || state === 0) continue;
    const alt = niedrigste.get(param);
    if (alt === undefined || state < alt) niedrigste.set(param, state);
  }
  const out: Record<number, number> = {};
  // Stabile Schlüsselreihenfolge — der Zustandsbaum geht in den Digest ein.
  for (const [param, state] of [...niedrigste].sort((a, b) => a[0] - b[0])) out[param] = state;
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
