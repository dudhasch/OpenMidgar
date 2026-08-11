import type { LoopPlan } from './ogg-tags.js';

/**
 * Audio-Engine (S16) als **Kommandomodell**.
 *
 * Der springende Punkt: Audio darf den Spielzustand nicht beeinflussen. Die
 * Engine nimmt deshalb serialisierbare Kommandos entgegen und führt sie
 * getrennt aus; der Interpreter reiht sie nur ein (`HostRequest`). Damit ist
 * die gesamte Audiologik ohne Browser testbar, und ein Replay bleibt bitgenau,
 * egal ob Ton läuft oder nicht.
 *
 * Der Autoplay-Sperre begegnet die Engine mit einem **expliziten Zustand**
 * statt mit einem verschluckten Fehler: Vor der ersten Nutzergeste ist sie
 * `suspended`, sammelt Kommandos und spielt sie ab, sobald sie freigegeben
 * wird. Ein `play` vor der Geste ist kein Fehler, sondern eine Vormerkung.
 */

export type AudioCommand =
  | {
      kind: 'play-music';
      trackId: number;
      loop: LoopPlan;
      fadeInTicks?: number | undefined;
      /**
       * Einmal abspielen statt schleifen (Siegfanfare, Jingles).
       *
       * 🔵 Architekturentscheidung: Das Kommandomodell kannte bisher nur
       * Endlosschleifen, weshalb die Fanfare in der Demo dauerhaft lief. Der
       * Schalter sitzt am Kommando und nicht am `LoopPlan`, weil der Plan
       * beschreibt, WO die Schleife läge — nicht, ob es eine geben soll. Der
       * Plan bleibt damit auch für Einmaltitel auswertbar (Diagnose).
       *
       * 🟡 Ungemessen bleibt, was das Original NACH der Fanfare tut. Hier endet
       * die Quelle still; wer einen Folgetitel will, setzt ihn selbst ab.
       */
      once?: boolean | undefined;
    }
  | { kind: 'stop-music'; fadeOutTicks?: number | undefined }
  | { kind: 'push-music' }
  | { kind: 'pop-music' }
  | { kind: 'play-sound'; soundId: number; pan: number }
  | { kind: 'set-volume'; channel: 'music' | 'sound'; volume: number };

export type AudioGateState = 'suspended' | 'running' | 'blocked';

export interface AudioEngineState {
  gate: AudioGateState;
  /** Aktuell laufender Titel; null = Stille. */
  currentTrack: number | null;
  /** Titelkeller für PUSH/POP (Kampf, Menü). */
  trackStack: number[];
  volumes: { music: number; sound: number };
  /** Vor der Nutzergeste eingereihte Kommandos. */
  pending: AudioCommand[];
  /** Zuletzt ausgeführte Kommandos — Golden-Datensatz für Tests. */
  log: AudioCommand[];
}

export const PAN_CENTER = 0x40;
export const PAN_MAX = 0x7f;

export function createAudioState(): AudioEngineState {
  return {
    gate: 'suspended',
    currentTrack: null,
    trackStack: [],
    volumes: { music: 1, sound: 1 },
    pending: [],
    log: [],
  };
}

/** Panorama 0x00…0x7F → −1…+1. Mitte ist 0x40, nicht 0x3F. */
export function panToBalance(pan: number): number {
  const clamped = Math.max(0, Math.min(PAN_MAX, pan));
  return (clamped - PAN_CENTER) / PAN_CENTER;
}

/**
 * Wendet ein Kommando an. Vor der Freigabe wird nur vorgemerkt — mit einer
 * Ausnahme: Lautstärkeänderungen wirken sofort, weil sie den späteren
 * Nachhol-Abspielvorgang betreffen sollen.
 */
export function applyAudioCommand(state: AudioEngineState, cmd: AudioCommand): AudioEngineState {
  if (state.gate !== 'running' && cmd.kind !== 'set-volume') {
    return { ...state, pending: [...state.pending, cmd] };
  }
  const log = [...state.log, cmd];
  switch (cmd.kind) {
    case 'play-music':
      return { ...state, currentTrack: cmd.trackId, log };
    case 'stop-music':
      return { ...state, currentTrack: null, log };
    case 'push-music':
      return {
        ...state,
        trackStack: state.currentTrack === null ? state.trackStack : [...state.trackStack, state.currentTrack],
        log,
      };
    case 'pop-music': {
      const stack = [...state.trackStack];
      const restored = stack.pop() ?? null;
      return { ...state, trackStack: stack, currentTrack: restored, log };
    }
    case 'play-sound':
      return { ...state, log };
    case 'set-volume':
      return {
        ...state,
        volumes: { ...state.volumes, [cmd.channel]: Math.max(0, Math.min(1, cmd.volume)) },
        log: state.gate === 'running' ? log : state.log,
      };
  }
}

/**
 * Freigabe nach der Nutzergeste: Der Stau wird in Reihenfolge nachgeholt.
 * Mehrfache `play-music` im Stau werden dabei NICHT zusammengefasst — der
 * letzte gewinnt ohnehin, und die Zwischenschritte im Protokoll zu behalten
 * macht Tests aussagekräftiger.
 */
export function resumeAudio(state: AudioEngineState): AudioEngineState {
  let next: AudioEngineState = { ...state, gate: 'running', pending: [] };
  for (const cmd of state.pending) next = applyAudioCommand(next, cmd);
  return next;
}

/** Endgültig blockiert (Nutzer hat Ton abgelehnt): Kommandos verfallen. */
export function blockAudio(state: AudioEngineState): AudioEngineState {
  return { ...state, gate: 'blocked', pending: [] };
}
