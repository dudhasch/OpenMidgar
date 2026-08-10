import { canonicalJson, fnv1a64HexOfString } from '@webmidgar/interpreter';
import {
  isNeutralSample,
  sortActions,
  type ActionSample,
  type InputSourceKind,
  type SemanticAction,
} from './actions.js';

/**
 * Aufzeichnung des SEMANTISCHEN Aktionsstroms (S27).
 *
 * Aufgezeichnet werden Aktionen und quantisierte Achsen je Tick — niemals
 * Tasten, Knöpfe oder Koordinaten. Die Herkunft (`sourceKinds`) ist ein
 * Metadatum im `meta`-Block und fließt AUSDRÜCKLICH NICHT in den Digest:
 * Zwei Aufzeichnungen derselben Aktionsfolge aus verschiedenen Quellen sind
 * digestgleich (das ist der zentrale S27-Nachweis), bleiben aber als
 * Diagnose unterscheidbar.
 */

export interface RecordedActionFrame extends ActionSample {
  tick: number;
}

export interface ActionRecording {
  schemaVersion: 1;
  ticks: number;
  /** Nur Ticks mit Eingabe ungleich neutral — Lücken sind implizit neutral. */
  frames: RecordedActionFrame[];
  /** Metadaten. Fließen nicht in den Digest (s. recordingDigest). */
  meta: {
    sourceKinds: InputSourceKind[];
  };
}

export const ACTION_RECORDING_SCHEMA_VERSION = 1;

export class ActionRecorder {
  private readonly frames: RecordedActionFrame[] = [];
  private ticks = 0;

  constructor(private readonly sourceKinds: InputSourceKind[]) {}

  record(sample: ActionSample): void {
    this.ticks++;
    if (isNeutralSample(sample)) return;
    this.frames.push({
      tick: this.ticks,
      held: sortActions(sample.held),
      axisX: sample.axisX,
      axisY: sample.axisY,
    });
  }

  finish(): ActionRecording {
    return {
      schemaVersion: ACTION_RECORDING_SCHEMA_VERSION,
      ticks: this.ticks,
      frames: [...this.frames],
      meta: { sourceKinds: [...this.sourceKinds] },
    };
  }
}

/**
 * Digest des Aktionsstroms. `meta` bleibt außen vor — die Quelle darf den
 * Digest nicht ändern, sonst wäre Replay-Portabilität über Geräte hinweg
 * per Konstruktion unmöglich.
 */
export function recordingDigest(recording: ActionRecording): string {
  return fnv1a64HexOfString(
    canonicalJson({
      schemaVersion: recording.schemaVersion,
      ticks: recording.ticks,
      frames: recording.frames,
    }),
  );
}

/**
 * Digest NUR über die Takte mit tatsächlicher Eingabe (Nullwert-
 * Zweitrechnung aus der S27-Abnahme): „keine Eingabe" ist trivial
 * deterministisch; wer Quellgleichheit nachweisen will, muss sie auf den
 * Takten zeigen, auf denen etwas passiert.
 */
export function inputTicksDigest(recording: ActionRecording): { digest: string; inputTicks: number } {
  return {
    digest: fnv1a64HexOfString(canonicalJson(recording.frames)),
    inputTicks: recording.frames.length,
  };
}

/** Verschiebt einen Strom um `delta` Takte — die Gegenprobe der S27-Abnahme. */
export function shiftRecording(recording: ActionRecording, delta: number): ActionRecording {
  const frames = recording.frames
    .map((f) => ({ ...f, tick: f.tick + delta }))
    .filter((f) => f.tick >= 1 && f.tick <= recording.ticks);
  return { ...recording, frames, meta: { sourceKinds: [...recording.meta.sourceKinds] } };
}

export function frameForTick(recording: ActionRecording, tick: number): RecordedActionFrame | null {
  // Aufzeichnungen sind klein (nur Eingabe-Ticks); lineare Suche genügt den
  // Tests — Läufe mit Takt-für-Takt-Zugriff bauen sich eine Map (s. replay).
  return recording.frames.find((f) => f.tick === tick) ?? null;
}

export type { SemanticAction };
