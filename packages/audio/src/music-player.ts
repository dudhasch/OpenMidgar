import { planLoop, readOggLoopTags, type LoopPlan, type OggLoopTags } from './ogg-tags.js';
import {
  applyAudioCommand,
  blockAudio,
  createAudioState,
  resumeAudio,
  type AudioCommand,
  type AudioEngineState,
} from './engine.js';

/**
 * Musikwiedergabe mit **echter Schleifenmarke** (F09-E).
 *
 * **Warum nicht `HTMLAudioElement`.** Ein `<audio loop>` kann nur die GANZE
 * Datei wiederholen. Im Bestand tragen **87 % der Titel `LOOPSTART` und kein
 * einziger `LOOPLENGTH`** (Messung in `ogg-tags.ts`) — die Schleife läuft also
 * von `LOOPSTART` bis Dateiende. Mit `<audio loop>` spielt jeder Titel mit
 * Intro sein Intro bei jeder Wiederholung erneut. Das ist prinzipiell nicht
 * behebbar, solange das Element die Wiedergabequelle ist: `loopStart`/
 * `loopEnd` gibt es nur am `AudioBufferSourceNode`.
 *
 * **Warum eine eigene Schnittstelle.** 🔵 Architekturentscheidung: WebAudio
 * steckt hinter den schmalen Typen unten (`AudioContextLike` &c.), genau wie
 * das Kommandomodell in `engine.ts` es vorsieht. Damit ist der komplette Pfad
 * — Bytes → Tags → Dekodierung → Plan → Quelle mit Schleifenmarken — in Node
 * testbar, ohne Browser und ohne Vorbis-Codec.
 *
 * **Zusammenspiel mit der Autoplay-Sperre.** Der Zustand aus `engine.ts` bleibt
 * die einzige Wahrheit darüber, was läuft. `MusicRuntime` führt ihn mit und
 * spielt nur das ab, was `applyAudioCommand` tatsächlich ausgeführt (also ins
 * Protokoll geschrieben) hat. Ein `play-music` vor der Nutzergeste ist damit
 * automatisch eine Vormerkung; `resume()` holt sie über `resumeAudio` nach und
 * startet den Titel dann wirklich.
 */

// --- Schmale WebAudio-Schnittstelle ----------------------------------------

export interface AudioBufferLike {
  /** Samples je Kanal. */
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly duration: number;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  /** Sekunden — NICHT Samples. Die Umrechnung macht `MusicRuntime`. */
  loopStart: number;
  loopEnd: number;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly sampleRate: number;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createBufferSource(): BufferSourceLike;
  createGain(): GainNodeLike;
}

/**
 * Compile-Zeit-Nachweis, dass die echte WebAudio-API diese Schnittstelle
 * erfüllt. Ohne ihn wäre `AudioContextLike` nur ein hübsches Testgerüst, das
 * im Browser womöglich gar nicht passt — und der Fehler fiele erst der
 * Demo-Verdrahtung auf.
 */
export type RealAudioContextFits = AudioContext extends AudioContextLike ? true : never;
export const REAL_AUDIO_CONTEXT_FITS: RealAudioContextFits = true;

/** Liefert die OGG-Rohbytes zu einem Titel; `null` = unbekannter Titel. */
export type TrackLoader = (trackId: number) => Promise<Uint8Array | null>;

// --- Der eigentliche Pfad ---------------------------------------------------

export interface PreparedTrack {
  trackId: number;
  tags: OggLoopTags;
  buffer: AudioBufferLike;
  plan: LoopPlan;
  /** Schleifenanfang in Sekunden (aus `plan.start` und der Abtastrate). */
  loopStartSeconds: number;
  /** Schleifenende in Sekunden; bei `end === null` das Pufferende. */
  loopEndSeconds: number;
}

/**
 * Bytes → Tags → Dekodierung → Plan. Getrennt herausgezogen, weil das die
 * einzige Stelle ist, an der `totalSamples` überhaupt bekannt wird: `planLoop`
 * braucht die Länge, und die liefert erst der Dekoder.
 *
 * 🟡 Die Länge kommt aus dem dekodierten Puffer, nicht aus der Granule-Position
 * des OGG-Stroms. Beide sollten übereinstimmen; die Dekoderlänge ist die, an
 * der die Wiedergabe tatsächlich hängt, deshalb wird sie genommen.
 */
export async function prepareTrack(
  context: AudioContextLike,
  trackId: number,
  bytes: Uint8Array,
): Promise<PreparedTrack> {
  const tags = readOggLoopTags(bytes);
  // Eigene Kopie: `decodeAudioData` darf den übergebenen Puffer übernehmen
  // (detachen) — die Aufrufer-Bytes dürfen davon nichts merken.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buffer = await context.decodeAudioData(copy.buffer);
  const plan = planLoop(tags, buffer.length);
  const rate = buffer.sampleRate > 0 ? buffer.sampleRate : context.sampleRate;
  const endSamples = plan.end ?? buffer.length;
  return {
    trackId,
    tags,
    buffer,
    plan,
    loopStartSeconds: clampSeconds(plan.start / rate, buffer.duration),
    loopEndSeconds: clampSeconds(endSamples / rate, buffer.duration),
  };
}

function clampSeconds(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return max > 0 ? Math.min(value, max) : value;
}

export interface MusicRuntimeOptions {
  context: AudioContextLike;
  loadTrack: TrackLoader;
  /** Takte je Sekunde für `fadeInTicks`/`fadeOutTicks`. Original: 60. */
  ticksPerSecond?: number;
  /** Diagnosekanal; standardmäßig still. */
  onDiagnostic?: (message: string) => void;
}

/**
 * Führt die Audiokommandos wirklich aus — der Zustand kommt unverändert aus
 * `engine.ts`, damit Protokoll und Replay dieselbe Wahrheit sehen.
 */
export class MusicRuntime {
  private readonly ctx: AudioContextLike;
  private readonly loadTrack: TrackLoader;
  private readonly ticksPerSecond: number;
  private readonly onDiagnostic: (message: string) => void;

  private engineState: AudioEngineState = createAudioState();
  private readonly cache = new Map<number, PreparedTrack>();
  private source: BufferSourceLike | null = null;
  private gain: GainNodeLike | null = null;
  private playing: PreparedTrack | null = null;
  /** Läuft mit, damit ein spätes `await` einen inzwischen überholten Titel nicht startet. */
  private generation = 0;

  constructor(opts: MusicRuntimeOptions) {
    this.ctx = opts.context;
    this.loadTrack = opts.loadTrack;
    this.ticksPerSecond = opts.ticksPerSecond ?? 60;
    this.onDiagnostic = opts.onDiagnostic ?? ((): void => {});
  }

  get state(): AudioEngineState {
    return this.engineState;
  }

  /** Der aktuell klingende Titel samt Plan — die Prüfgröße der Tests. */
  get current(): PreparedTrack | null {
    return this.playing;
  }

  /** Plan eines bereits vorbereiteten Titels (ohne ihn zu starten). */
  planOf(trackId: number): LoopPlan | null {
    return this.cache.get(trackId)?.plan ?? null;
  }

  /**
   * Nimmt ein Kommando entgegen. Vor der Freigabe wird nur vorgemerkt — das
   * entscheidet `applyAudioCommand`, nicht diese Klasse.
   */
  async dispatch(cmd: AudioCommand): Promise<void> {
    await this.applyAndExecute((s) => applyAudioCommand(s, cmd));
  }

  /** Nutzergeste: Freigabe + Nachholen des Staus (F09-E: wirkt auf DIESEM Pfad). */
  async resume(): Promise<void> {
    await this.applyAndExecute(resumeAudio);
  }

  /** Nutzer hat Ton abgelehnt: Vormerkungen verfallen, Ausgabe wird beendet. */
  block(): void {
    this.engineState = blockAudio(this.engineState);
    this.stopSource();
  }

  /**
   * Wendet einen Zustandsübergang an und führt **genau die** Kommandos aus, die
   * dabei tatsächlich ausgeführt wurden. Das Protokoll ist die Brücke: was
   * nicht darin landet, war eine Vormerkung und darf nicht klingen.
   */
  private async applyAndExecute(step: (s: AudioEngineState) => AudioEngineState): Promise<void> {
    const before = this.engineState.log.length;
    this.engineState = step(this.engineState);
    const executed = this.engineState.log.slice(before);
    for (const cmd of executed) await this.execute(cmd);
  }

  private async execute(cmd: AudioCommand): Promise<void> {
    switch (cmd.kind) {
      case 'play-music':
      case 'pop-music': {
        const trackId = this.engineState.currentTrack;
        if (trackId === null) {
          this.stopSource();
          return;
        }
        const fadeIn = cmd.kind === 'play-music' ? (cmd.fadeInTicks ?? 0) : 0;
        await this.startTrack(trackId, fadeIn);
        return;
      }
      case 'stop-music':
        this.stopSource(cmd.fadeOutTicks ?? 0);
        return;
      case 'set-volume':
        if (cmd.channel === 'music' && this.gain) {
          this.gain.gain.value = this.engineState.volumes.music;
        }
        return;
      case 'push-music':
      case 'play-sound':
        // `push-music` merkt sich nur den Titel; Klangeffekte laufen über den
        // ADPCM-Pfad (`audio-fmt.ts`) und nicht über diese Musikquelle.
        return;
    }
  }

  private async startTrack(trackId: number, fadeInTicks: number): Promise<void> {
    const myGeneration = ++this.generation;
    let track = this.cache.get(trackId) ?? null;
    if (!track) {
      const bytes = await this.loadTrack(trackId);
      if (bytes === null) {
        this.onDiagnostic(`Titel ${trackId} nicht auffindbar — Stille statt Fehlklang`);
        return;
      }
      try {
        track = await prepareTrack(this.ctx, trackId, bytes);
      } catch (err) {
        this.onDiagnostic(`Titel ${trackId} nicht dekodierbar: ${String(err)}`);
        return;
      }
      this.cache.set(trackId, track);
    }
    // Ein zwischenzeitlich abgesetztes Kommando gewinnt.
    if (myGeneration !== this.generation) return;
    if (this.engineState.currentTrack !== trackId) return;

    this.stopSource();
    const gain = this.ctx.createGain();
    const source = this.ctx.createBufferSource();
    source.buffer = track.buffer;
    // Der springende Punkt: Wiedergabe beginnt bei 0 (Intro spielt einmal),
    // die Schleife greift erst am Marker.
    source.loop = true;
    source.loopStart = track.loopStartSeconds;
    source.loopEnd = track.loopEndSeconds;
    source.connect(gain);
    gain.connect(this.ctx.destination);

    const target = this.engineState.volumes.music;
    const fadeSeconds = fadeInTicks > 0 ? fadeInTicks / this.ticksPerSecond : 0;
    if (fadeSeconds > 0) {
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + fadeSeconds);
    } else {
      gain.gain.value = target;
    }
    source.start(0, 0);

    this.gain = gain;
    this.source = source;
    this.playing = track;
  }

  private stopSource(fadeOutTicks = 0): void {
    const source = this.source;
    const gain = this.gain;
    this.source = null;
    this.gain = null;
    this.playing = null;
    if (!source) return;
    const fadeSeconds = fadeOutTicks > 0 ? fadeOutTicks / this.ticksPerSecond : 0;
    if (fadeSeconds > 0 && gain) {
      gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeSeconds);
      source.stop(this.ctx.currentTime + fadeSeconds);
    } else {
      source.stop(0);
      source.disconnect();
      gain?.disconnect();
    }
  }
}
