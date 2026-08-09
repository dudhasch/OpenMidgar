import type { PreparedScript } from './prepared.js';
import { FieldRuntime, type RuntimeOptions } from './runtime.js';
import { snapshotRuntime, stateDigest, type RuntimeSnapshot } from './serde.js';
import type { RuntimeEvent } from './state.js';

/**
 * Deterministisches Replay (Masterplan 4.4): Aufzeichnung = Start-Snapshot +
 * Eingabestrom (Tick, Ereignis); Wiedergabe muss einen bitidentischen
 * Zustandsverlauf liefern (Digest je n Ticks). Replays sind die primären
 * Regressionstests des Interpreters.
 */

export interface ReplayInput {
  /** tickCounter-Stand, NACH dem das Ereignis eingereiht wurde. */
  afterTick: number;
  event: RuntimeEvent;
}

export interface ReplayRecording {
  schemaVersion: 1;
  scriptHash: string;
  /** Ausführungsparameter — müssen bei Wiedergabe identisch sein. */
  options: { budget: number; maxBudgetStrikes: number; mainLoop: boolean };
  startSnapshot: RuntimeSnapshot;
  inputs: ReplayInput[];
  digestEvery: number;
  digests: string[];
  totalTicks: number;
}

export class ReplayRecorder {
  readonly recording: ReplayRecording;

  constructor(
    private readonly runtime: FieldRuntime,
    digestEvery = 100,
  ) {
    this.recording = {
      schemaVersion: 1,
      scriptHash: runtime.script.scriptHash,
      options: {
        budget: runtime.budget,
        maxBudgetStrikes: runtime.maxBudgetStrikes,
        mainLoop: runtime.mainLoop,
      },
      startSnapshot: snapshotRuntime(runtime.state),
      inputs: [],
      digestEvery,
      digests: [],
      totalTicks: 0,
    };
  }

  postEvent(event: RuntimeEvent): void {
    this.runtime.postEvent(event);
    this.recording.inputs.push({ afterTick: this.runtime.state.tickCounter, event: structuredClone(event) });
  }

  tick(): void {
    this.runtime.tick();
    this.recording.totalTicks++;
    if (this.recording.totalTicks % this.recording.digestEvery === 0) {
      this.recording.digests.push(stateDigest(this.runtime.state));
    }
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }
}

export interface ReplayResult {
  digests: string[];
  finalDigest: string;
  warnings: string[];
}

/** Wiedergabe einer Aufzeichnung gegen ein PreparedScript. */
export function replayRecording(recording: ReplayRecording, script: PreparedScript): ReplayResult {
  const options: RuntimeOptions = {
    budget: recording.options.budget,
    maxBudgetStrikes: recording.options.maxBudgetStrikes,
    mainLoop: recording.options.mainLoop,
  };
  const runtime = new FieldRuntime(script, options);
  const warnings = runtime.restoreFrom(recording.startSnapshot);

  // Eingaben nach afterTick gruppieren (Reihenfolge bleibt stabil).
  const byTick = new Map<number, RuntimeEvent[]>();
  for (const input of recording.inputs) {
    const list = byTick.get(input.afterTick) ?? [];
    list.push(input.event);
    byTick.set(input.afterTick, list);
  }

  const digests: string[] = [];
  const startTick = runtime.state.tickCounter;
  for (const ev of byTick.get(startTick) ?? []) runtime.postEvent(structuredClone(ev));
  for (let i = 0; i < recording.totalTicks; i++) {
    runtime.tick();
    for (const ev of byTick.get(runtime.state.tickCounter) ?? []) runtime.postEvent(structuredClone(ev));
    if ((i + 1) % recording.digestEvery === 0) digests.push(stateDigest(runtime.state));
  }
  return { digests, finalDigest: stateDigest(runtime.state), warnings };
}
