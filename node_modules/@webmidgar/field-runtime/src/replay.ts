import type { FieldBundle } from '@webmidgar/formats-field';
import { FieldSession, NEUTRAL_INPUT, type FieldInput, type FieldSessionOptions } from './session.js';

/**
 * Eingabe-Replay (Masterplan Phase 5, Abnahmekriterium „Replay bitidentisch"):
 * Eine aufgezeichnete Eingabefolge muss auf demselben Field denselben
 * Zustandsdigest ergeben. Damit wird die gesamte Integration — Solver,
 * Trigger, Interpreter — in einem einzigen Vergleich abgesichert.
 */

export interface InputFrame {
  tick: number;
  input: FieldInput;
}

export interface InputRecording {
  schemaVersion: 1;
  fieldId: string;
  /** Nur Ticks mit Eingabe ungleich neutral — die Lücken sind implizit neutral. */
  frames: InputFrame[];
  ticks: number;
}

export const RECORDING_SCHEMA_VERSION = 1;

export function isNeutral(input: FieldInput): boolean {
  return input.moveX === 0 && input.moveY === 0 && !input.confirm && !input.cancel;
}

export class InputRecorder {
  private readonly frames: InputFrame[] = [];
  private ticks = 0;

  constructor(readonly fieldId: string) {}

  record(input: FieldInput): void {
    this.ticks++;
    if (!isNeutral(input)) this.frames.push({ tick: this.ticks, input: { ...input } });
  }

  finish(): InputRecording {
    return {
      schemaVersion: RECORDING_SCHEMA_VERSION,
      fieldId: this.fieldId,
      frames: [...this.frames],
      ticks: this.ticks,
    };
  }
}

export interface ReplayResult {
  digest: string;
  ticks: number;
  fieldChanges: number;
  triggerEvents: number;
}

/**
 * Spielt eine Aufzeichnung auf einer frischen Sitzung ab und liefert den
 * Enddigest. Der Aufrufer vergleicht ihn mit dem Digest des Originallaufs.
 */
export function replayInputs(
  bundle: FieldBundle,
  recording: InputRecording,
  options: FieldSessionOptions = {},
): ReplayResult {
  const session = new FieldSession(bundle, options);
  const byTick = new Map(recording.frames.map((f) => [f.tick, f.input]));
  let fieldChanges = 0;
  let triggerEvents = 0;
  for (let t = 1; t <= recording.ticks; t++) {
    const result = session.tick(byTick.get(t) ?? NEUTRAL_INPUT);
    if (result.fieldChange) fieldChanges++;
    triggerEvents += result.triggers.length;
  }
  return { digest: session.digest(), ticks: recording.ticks, fieldChanges, triggerEvents };
}
