import { canonicalJson, fnv1a64HexOfString } from '@webmidgar/interpreter';
import type { WorldEv, WorldGrid, WorldTerrain } from '@webmidgar/formats-world';
import { WORLD_MESH_EXTENT } from '@webmidgar/formats-world';
import { sampleGround } from '@webmidgar/render-world';
import { WorldScriptVM, type WorldMemorySnapshot, type WorldVmFault } from './script-vm.js';

/**
 * WorldSession (S29) — Fixed-Tick-Sitzung der Weltkarte im ADR-006-Vertrag:
 * jeder Takt ist ein reiner Zustandsübergang, Wirkungen nach außen sind
 * `WorldHostRequest`-DATEN, Snapshot/Restore verlustfrei, `digest()` für den
 * bitgenauen Replay-Vergleich. Eigenes Runtime-Modul, KEINE Erweiterung des
 * Field-Interpreters (Roadmap-ADR: eigene Grammatik, eigenes Streaming).
 *
 * Fahrzeuge und Geländeklassen: Die Matrix „Fahrzeug × Klasse" ist eine
 * AUSTAUSCHBARE Tabelle (dieselbe Entwurfshaltung wie der Musikindex in S16).
 * Die KLASSENSEMANTIK des Originals ist unbelegt (🟡 FINDINGS S28); die
 * mitgelieferte Standardmatrix ist 🔵 Eigenentwurf und ausdrücklich kein
 * Originalverhalten.
 *
 * R9-Härtung: Kurs als ganzzahlige 256er-Richtung; Richtungsvektoren kommen
 * aus einer auf 1/4096 gerundeten Tabelle — `Math.cos` ist in ECMA-262 nicht
 * bitgenau festgelegt, die gerundeten Tabellenwerte sind es (dieselbe
 * Begründung wie `richtungGrad` in der FieldSession).
 */

export interface VehicleSpec {
  id: string;
  /** Welteinheiten je Takt bei voller Fahrt (🔵 Tabelle, kein Formatfakt). */
  speed: number;
  /** Geländeklassen (5-Bit-Werte), die dieses Fahrzeug betreten darf. */
  allowedClasses: number[];
}

export interface WorldLocation {
  x: number;
  z: number;
  radius: number;
  /** Ziel als 0-basierter maplist-Index — derselbe Namensraum wie der Field-Wechsel (S11). */
  destMaplistIndex: number;
}

export interface EncounterConfig {
  /** ADR-011: Standard AUS — der Kampf bleibt Stub, die Mechanik ist vorbereitet. */
  enabled: boolean;
  /** Klassen, auf denen der Schrittzähler zählt (🔵, Tabellenplatz). */
  classes: number[];
  /** Prüfung alle n Schritte; Schwelle je Prüfung in 1/256 (🔵). */
  stepsPerCheck: number;
  threshold: number;
}

export interface WorldSessionOptions {
  vehicles?: VehicleSpec[];
  startVehicle?: string;
  start?: { x: number; z: number };
  startHeading?: number;
  ev?: WorldEv | null;
  seed?: number;
  encounters?: Partial<EncounterConfig>;
  locations?: WorldLocation[];
  scriptBudget?: number;
}

export interface WorldTickInput {
  /** Drehung: −1 = links, +1 = rechts (Kurswirkung, keine Seitwärtsfahrt). */
  turn: -1 | 0 | 1;
  /** Fahrt: +1 vorwärts, −1 rückwärts. */
  throttle: -1 | 0 | 1;
  action: boolean;
  switchVehicle: boolean;
}

export const NEUTRAL_WORLD_INPUT: WorldTickInput = { turn: 0, throttle: 0, action: false, switchVehicle: false };

export type WorldHostRequest =
  | { kind: 'world-transition'; locationIndex: number; destMaplistIndex: number }
  | { kind: 'encounter-check'; roll: number; walkClass: number };

export interface WorldTickResult {
  tick: number;
  moved: boolean;
  blocked: boolean;
  meshChanged: boolean;
  vehicle: string;
  /** Kennungen der in diesem Takt gelaufenen Mesh-Funktionen. */
  ranFunctions: number[];
  scriptFaults: WorldVmFault[];
  requests: WorldHostRequest[];
}

export interface WorldSessionSnapshot {
  schemaVersion: 1;
  tick: number;
  x: number;
  z: number;
  h: number;
  heading: number;
  vehicleIndex: number;
  prevAction: boolean;
  prevSwitch: boolean;
  stepCounter: number;
  rngState: number;
  memory: WorldMemorySnapshot | null;
}

/**
 * 🔵 Standardfahrzeuge — bewusst Minimaldaten, die Matrix ist austauschbar.
 * Klasse 3 ist der datengetriebene WASSER-Kandidat (dominante Klasse der
 * modalen Flachhöhe 0 auf WM0, world-vehicle-probe 2026-08-10, 🟡) und für
 * den Fußweg ausgeschlossen; alles Weitere ist unbelegt und absichtlich
 * nicht „originalgetreu" benannt.
 */
export function defaultVehicles(): VehicleSpec[] {
  return [
    { id: 'onFoot', speed: 120, allowedClasses: Array.from({ length: 32 }, (_, i) => i).filter((i) => i !== 3) },
    { id: 'highwind', speed: 400, allowedClasses: Array.from({ length: 32 }, (_, i) => i) },
  ];
}

export const RICHTUNGSEINHEITEN = 256;

/**
 * Richtungsvektoren je 256er-Kurs, auf 1/4096 gerundet — exakt darstellbar,
 * damit engineübergreifend bitgleich (R9; Restrisiko wie bei richtungGrad:
 * ein cos-Ergebnis exakt auf der Rundungsgrenze — dokumentiert, Test hält).
 */
const DIR_TABLE: Array<[number, number]> = Array.from({ length: RICHTUNGSEINHEITEN }, (_, k) => {
  const rad = (k * 2 * Math.PI) / RICHTUNGSEINHEITEN;
  return [Math.round(Math.cos(rad) * 4096) / 4096, Math.round(Math.sin(rad) * 4096) / 4096];
});

export class WorldSession {
  readonly vehicles: VehicleSpec[];
  readonly locations: WorldLocation[];
  readonly vm: WorldScriptVM | null;
  private readonly encounters: EncounterConfig;
  private readonly scriptBudget: number;

  tickCounter = 0;
  x: number;
  z: number;
  h = 0;
  /** Kurs in 256er-Einheiten (ganzzahlig — Replayfestigkeit). */
  heading: number;
  vehicleIndex = 0;
  private prevAction = false;
  private prevSwitch = false;
  private stepCounter = 0;
  private rngState: number;
  private currentMesh: { mx: number; my: number } | null = null;

  constructor(
    readonly terrain: WorldTerrain,
    readonly grid: WorldGrid,
    options: WorldSessionOptions = {},
  ) {
    this.vehicles = options.vehicles ?? defaultVehicles();
    this.locations = options.locations ?? [];
    this.vm = options.ev ? new WorldScriptVM(options.ev) : null;
    this.scriptBudget = options.scriptBudget ?? 10_000;
    this.encounters = {
      enabled: false,
      classes: [],
      stepsPerCheck: 32,
      threshold: 24,
      ...options.encounters,
    };
    const start = options.start ?? { x: WORLD_MESH_EXTENT / 2, z: WORLD_MESH_EXTENT / 2 };
    this.x = start.x;
    this.z = start.z;
    this.heading = options.startHeading ?? 0;
    this.rngState = (options.seed ?? 0x51ed) >>> 0;
    if (options.startVehicle) {
      const idx = this.vehicles.findIndex((v) => v.id === options.startVehicle);
      if (idx >= 0) this.vehicleIndex = idx;
    }
    const boden = sampleGround(terrain, grid, this.x, this.z);
    if (boden) this.h = boden.height;
    this.currentMesh = this.meshCell();
  }

  get vehicle(): VehicleSpec {
    return this.vehicles[this.vehicleIndex]!;
  }

  private meshCell(): { mx: number; my: number } {
    const meshesX = this.grid.cols * 4;
    const meshesY = this.grid.rows * 4;
    const mod = (v: number, m: number): number => ((v % m) + m) % m;
    return {
      mx: mod(Math.floor(this.x / WORLD_MESH_EXTENT), meshesX),
      my: mod(Math.floor(this.z / WORLD_MESH_EXTENT), meshesY),
    };
  }

  /** Ganzzahliger LCG (Numerical Recipes) — Teil des Snapshots (ADR-006). */
  private nextRoll(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState >>> 24;
  }

  tick(input: WorldTickInput = NEUTRAL_WORLD_INPUT): WorldTickResult {
    this.tickCounter++;
    const requests: WorldHostRequest[] = [];
    const ranFunctions: number[] = [];
    const scriptFaults: WorldVmFault[] = [];

    // Fahrzeugwechsel auf steigender Flanke; die Matrix wirkt ab sofort.
    if (input.switchVehicle && !this.prevSwitch) {
      this.vehicleIndex = (this.vehicleIndex + 1) % this.vehicles.length;
    }
    this.prevSwitch = input.switchVehicle;

    const TURN_UNITS = 2;
    if (input.turn !== 0) {
      this.heading = (this.heading + input.turn * TURN_UNITS + RICHTUNGSEINHEITEN) % RICHTUNGSEINHEITEN;
    }

    let moved = false;
    let blocked = false;
    if (input.throttle !== 0) {
      const [dx, dz] = DIR_TABLE[this.heading]!;
      const speed = this.vehicle.speed * input.throttle;
      const zielX = this.x + dx * speed;
      const zielZ = this.z + dz * speed;
      const boden = sampleGround(this.terrain, this.grid, zielX, zielZ);
      if (boden && this.vehicle.allowedClasses.includes(boden.walkClass)) {
        this.x = zielX;
        this.z = zielZ;
        this.h = boden.height;
        moved = true;
        if (this.encounters.enabled && this.encounters.classes.includes(boden.walkClass)) {
          this.stepCounter++;
          if (this.stepCounter >= this.encounters.stepsPerCheck) {
            this.stepCounter = 0;
            const roll = this.nextRoll();
            if (roll < this.encounters.threshold) {
              requests.push({ kind: 'encounter-check', roll, walkClass: boden.walkClass });
            }
          }
        }
      } else {
        blocked = true;
      }
    }

    // Mesh-Trigger: beim Zellenwechsel läuft Funktion 0 der Zelle (🟡 —
    // welche Funktionsnummer das Original beim Betreten ruft, ist unbelegt;
    // die Zuordnung Zelle→Funktion ist Formatfakt, der Anlass Hypothese).
    let meshChanged = false;
    const cell = this.meshCell();
    if (!this.currentMesh || cell.mx !== this.currentMesh.mx || cell.my !== this.currentMesh.my) {
      meshChanged = this.currentMesh !== null;
      this.currentMesh = cell;
      if (meshChanged && this.vm) {
        const fn = this.vm.findMeshFunction(cell.mx, cell.my, 0);
        if (fn) {
          const result = this.vm.runFunction(fn, this.scriptBudget);
          ranFunctions.push(fn.id);
          scriptFaults.push(...result.faults);
        }
      }
    }

    // Ortsmarken: Aktion (steigende Flanke) innerhalb des Radius ⇒ Übergang
    // als HostRequest-Daten. Die Marken selbst sind Wirtsdaten (🔴 die
    // Original-Quelle der Einstiegspunkte ist offen, s. FINDINGS).
    const actionPressed = input.action && !this.prevAction;
    this.prevAction = input.action;
    if (actionPressed) {
      for (let i = 0; i < this.locations.length; i++) {
        const loc = this.locations[i]!;
        const dx = this.x - loc.x;
        const dz = this.z - loc.z;
        if (dx * dx + dz * dz <= loc.radius * loc.radius) {
          requests.push({ kind: 'world-transition', locationIndex: i, destMaplistIndex: loc.destMaplistIndex });
          break;
        }
      }
    }

    return {
      tick: this.tickCounter,
      moved,
      blocked,
      meshChanged,
      vehicle: this.vehicle.id,
      ranFunctions,
      scriptFaults,
      requests,
    };
  }

  snapshot(): WorldSessionSnapshot {
    return {
      schemaVersion: 1,
      tick: this.tickCounter,
      x: this.x,
      z: this.z,
      h: this.h,
      heading: this.heading,
      vehicleIndex: this.vehicleIndex,
      prevAction: this.prevAction,
      prevSwitch: this.prevSwitch,
      stepCounter: this.stepCounter,
      rngState: this.rngState,
      memory: this.vm ? this.vm.snapshotMemory() : null,
    };
  }

  restore(snapshot: WorldSessionSnapshot): { ok: boolean; reason?: string } {
    if (snapshot.schemaVersion !== 1) return { ok: false, reason: `Schemaversion ${snapshot.schemaVersion}` };
    if (snapshot.memory && !this.vm) return { ok: false, reason: 'Snapshot trägt VM-Speicher, die Sitzung keinen' };
    this.tickCounter = snapshot.tick;
    this.x = snapshot.x;
    this.z = snapshot.z;
    this.h = snapshot.h;
    this.heading = snapshot.heading;
    this.vehicleIndex = snapshot.vehicleIndex;
    this.prevAction = snapshot.prevAction;
    this.prevSwitch = snapshot.prevSwitch;
    this.stepCounter = snapshot.stepCounter;
    this.rngState = snapshot.rngState;
    if (snapshot.memory && this.vm) this.vm.restoreMemory(snapshot.memory);
    this.currentMesh = this.meshCell();
    return { ok: true };
  }

  digest(): string {
    return fnv1a64HexOfString(canonicalJson(this.snapshot()));
  }
}
