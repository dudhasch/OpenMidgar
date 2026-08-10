import type { FieldInput } from '@webmidgar/field-runtime';
import type { ActionSample } from './actions.js';
import type { ActionRecording } from './recording.js';

/**
 * Brücke Aktionsstrom → FieldSession (S27). Die FieldSession behält ihren
 * unveränderten Vertrag (`FieldInput` mit −1/0/+1-Richtungen); hier wird nur
 * abgebildet. Die Achsstufen kollabieren auf das Vorzeichen — die Feinstufung
 * ist für künftige Kontexte (Weltkarte: Fahrgeschwindigkeit) reserviert und
 * bleibt in der Aufzeichnung erhalten.
 */
export function toFieldInput(sample: ActionSample): FieldInput {
  return {
    moveX: Math.sign(sample.axisX),
    moveY: Math.sign(sample.axisY),
    confirm: sample.held.includes('ok'),
    cancel: sample.held.includes('cancel'),
  };
}

/** Aufzeichnung als Tick→FieldInput-Funktion, für Replays über die Session. */
export function fieldInputPlan(recording: ActionRecording): (tick: number) => FieldInput {
  const byTick = new Map(recording.frames.map((f) => [f.tick, toFieldInput(f)]));
  const neutral: FieldInput = { moveX: 0, moveY: 0, confirm: false, cancel: false };
  return (tick) => byTick.get(tick) ?? neutral;
}
