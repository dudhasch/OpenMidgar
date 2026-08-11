import { describe, expect, it } from 'vitest';
import {
  MusicRuntime,
  prepareTrack,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
} from './music-player.js';

/**
 * F09-E — die Schleifenplanung wird endlich benutzt.
 *
 * Der Test greift genau dort an, wo `audioEl.loop = true` prinzipiell versagt:
 * Ein Titel mit `LOOPSTART` muss eine Quelle mit **loopStart > 0** bekommen,
 * damit das Intro nur EINMAL läuft. Ein Titel ohne Tag muss nachweislich auf
 * `whole-file` zurückfallen — die Kontrollmessung zur Aussage.
 */

// --- Selbst gebauter OGG-Kommentarstrom (wie in audio.test.ts) --------------

function u32le(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return Array.from(b);
}
const ascii = (s: string): number[] => Array.from(new TextEncoder().encode(s));

function oggWithComments(comments: string[]): Uint8Array {
  const payload: number[] = [0x03, ...ascii('vorbis')];
  const vendor = ascii('webmidgar-test');
  payload.push(...u32le(vendor.length), ...vendor);
  payload.push(...u32le(comments.length));
  for (const c of comments) {
    const b = ascii(c);
    payload.push(...u32le(b.length), ...b);
  }
  const segments: number[] = [];
  let remaining = payload.length;
  if (remaining === 0) segments.push(0);
  while (remaining > 0) {
    const seg = Math.min(255, remaining);
    segments.push(seg);
    remaining -= seg;
    if (seg < 255) break;
  }
  const header = [
    0x4f, 0x67, 0x67, 0x53, 0x00, 0x02,
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    segments.length,
  ];
  return Uint8Array.from([...header, ...segments, ...payload]);
}

// --- WebAudio-Attrappe ------------------------------------------------------

const SAMPLE_RATE = 44100;
const TOTAL_SAMPLES = 44100 * 10; // 10 s

class FakeParam implements AudioParamLike {
  value = 1;
  events: string[] = [];
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.events.push(`set ${v}@${t}`);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.events.push(`ramp ${v}@${t}`);
  }
  cancelScheduledValues(t: number): void {
    this.events.push(`cancel@${t}`);
  }
}

class FakeGain implements GainNodeLike {
  readonly gain = new FakeParam();
  connected: AudioNodeLike | null = null;
  connect(d: AudioNodeLike): void {
    this.connected = d;
  }
  disconnect(): void {
    this.connected = null;
  }
}

class FakeSource implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: { when: number; offset: number } | null = null;
  stopped: number | null = null;
  connect(): void {}
  disconnect(): void {}
  start(when = 0, offset = 0): void {
    this.started = { when, offset };
  }
  stop(when = 0): void {
    this.stopped = when;
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = SAMPLE_RATE;
  readonly destination: AudioNodeLike = { connect: () => {}, disconnect: () => {} };
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  /** Wird von den Fehlerfall-Tests auf true gesetzt. */
  decodeFails = false;

  async decodeAudioData(): Promise<AudioBufferLike> {
    if (this.decodeFails) throw new Error('kein gültiger Vorbis-Strom');
    return {
      length: TOTAL_SAMPLES,
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      duration: TOTAL_SAMPLES / SAMPLE_RATE,
    };
  }
  createBufferSource(): BufferSourceLike {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain(): GainNodeLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

const TAGGED = oggWithComments(['LOOPSTART=220500', 'TITLE=mit Intro']); // 5,0 s
const TAGGED_SHORT = oggWithComments(['LOOPSTART=132300', 'TITLE=mit Intro']); // 3,0 s
const UNTAGGED = oggWithComments(['TITLE=ohne Marke']);

function runtimeWith(files: Record<number, Uint8Array>): { rt: MusicRuntime; ctx: FakeContext } {
  const ctx = new FakeContext();
  const rt = new MusicRuntime({
    context: ctx,
    loadTrack: async (id) => files[id] ?? null,
  });
  return { rt, ctx };
}

// --- Tests ------------------------------------------------------------------

describe('prepareTrack: Bytes → Tags → Dekodierung → Plan', () => {
  it('ein Titel MIT LOOPSTART bekommt einen Plan mit reason ≠ whole-file und loopStart > 0', async () => {
    const track = await prepareTrack(new FakeContext(), 1, TAGGED_SHORT);
    expect(track.plan.reason).toBe('tagged-start-to-end');
    expect(track.plan.reason).not.toBe('whole-file');
    expect(track.plan.start).toBe(132300);
    expect(track.plan.end).toBe(TOTAL_SAMPLES);
    expect(track.loopStartSeconds).toBeCloseTo(3, 6);
    expect(track.loopEndSeconds).toBeCloseTo(10, 6);
  });

  it('ein Titel OHNE LOOPSTART fällt nachweislich auf whole-file zurück', async () => {
    const track = await prepareTrack(new FakeContext(), 2, UNTAGGED);
    expect(track.plan).toEqual({ start: 0, end: TOTAL_SAMPLES, reason: 'whole-file' });
    expect(track.loopStartSeconds).toBe(0);
    expect(track.tags.loopStart).toBeNull();
  });

  it('LOOPSTART am Dateiende wird auf die Pufferdauer begrenzt statt hinter das Ende zu zeigen', async () => {
    const track = await prepareTrack(new FakeContext(), 3, oggWithComments(['LOOPSTART=99999999']));
    expect(track.loopStartSeconds).toBeCloseTo(10, 6);
  });
});

describe('MusicRuntime: Quelle mit echten Schleifenmarken', () => {
  it('setzt loop/loopStart/loopEnd am BufferSource und startet trotzdem bei 0 (Intro läuft einmal)', async () => {
    const { rt, ctx } = runtimeWith({ 5: TAGGED_SHORT });
    await rt.resume();
    await rt.dispatch({ kind: 'play-music', trackId: 5, loop: { start: 0, end: null, reason: 'whole-file' } });

    expect(ctx.sources).toHaveLength(1);
    const src = ctx.sources[0]!;
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(3, 6);
    expect(src.loopEnd).toBeCloseTo(10, 6);
    // Der springende Punkt gegen `audioEl.loop = true`: Wiedergabebeginn 0,
    // Schleifenanfang 3 s — das Intro wird beim Umlauf übersprungen.
    expect(src.started).toEqual({ when: 0, offset: 0 });
    expect(rt.current?.plan.reason).toBe('tagged-start-to-end');
  });

  it('Titel ohne Marke: loopStart bleibt 0 — Kontrollfall zur Aussage oben', async () => {
    const { rt, ctx } = runtimeWith({ 6: UNTAGGED });
    await rt.resume();
    await rt.dispatch({ kind: 'play-music', trackId: 6, loop: { start: 0, end: null, reason: 'whole-file' } });
    expect(ctx.sources[0]!.loopStart).toBe(0);
    expect(rt.planOf(6)?.reason).toBe('whole-file');
  });

  it('der Plan wird aus der DEKODIERTEN Länge gerechnet, nicht aus dem Kommandofeld', async () => {
    const { rt } = runtimeWith({ 7: TAGGED });
    await rt.resume();
    // Absichtlich ein falscher Plan im Kommando — er darf nicht durchschlagen.
    await rt.dispatch({ kind: 'play-music', trackId: 7, loop: { start: 999, end: 1000, reason: 'tagged-range' } });
    expect(rt.current?.plan).toEqual({ start: 220500, end: TOTAL_SAMPLES, reason: 'tagged-start-to-end' });
  });
});

describe('MusicRuntime und die Autoplay-Sperre', () => {
  it('spielt VOR der Nutzergeste nichts, holt die Vormerkung bei resume() nach', async () => {
    const { rt, ctx } = runtimeWith({ 9: TAGGED_SHORT });
    await rt.dispatch({ kind: 'play-music', trackId: 9, loop: { start: 0, end: null, reason: 'whole-file' } });

    expect(ctx.sources).toHaveLength(0); // nur vorgemerkt — kein Ton
    expect(rt.state.pending).toHaveLength(1);
    expect(rt.current).toBeNull();

    await rt.resume();
    expect(rt.state.gate).toBe('running');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.loopStart).toBeCloseTo(3, 6);
    expect(rt.current?.trackId).toBe(9);
  });

  it('mehrere Vormerkungen: nur der zuletzt gewinnende Titel klingt am Ende', async () => {
    const { rt, ctx } = runtimeWith({ 1: UNTAGGED, 2: TAGGED_SHORT });
    const loop = { start: 0, end: null, reason: 'whole-file' as const };
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop });
    await rt.dispatch({ kind: 'play-music', trackId: 2, loop });
    await rt.resume();
    // Beide Kommandos werden nachgeholt (das Protokoll fasst nicht zusammen),
    // klingen darf aber nur der letzte: die erste Quelle wurde gestoppt.
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]!.stopped).toBe(0);
    expect(rt.current?.trackId).toBe(2);
  });

  it('block(): Vormerkungen verfallen, es entsteht nie eine Quelle', async () => {
    const { rt, ctx } = runtimeWith({ 1: TAGGED_SHORT });
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop: { start: 0, end: null, reason: 'whole-file' } });
    rt.block();
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop: { start: 0, end: null, reason: 'whole-file' } });
    expect(ctx.sources).toHaveLength(0);
    expect(rt.state.gate).toBe('blocked');
  });
});

describe('MusicRuntime: Keller, Lautstärke, Fehlerfälle', () => {
  it('pop-music startet den wiederhergestellten Titel wirklich neu', async () => {
    const { rt, ctx } = runtimeWith({ 1: TAGGED_SHORT, 2: UNTAGGED });
    const loop = { start: 0, end: null, reason: 'whole-file' as const };
    await rt.resume();
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop });
    await rt.dispatch({ kind: 'push-music' });
    await rt.dispatch({ kind: 'play-music', trackId: 2, loop });
    expect(rt.current?.trackId).toBe(2);
    await rt.dispatch({ kind: 'pop-music' });
    expect(rt.current?.trackId).toBe(1);
    expect(ctx.sources).toHaveLength(3);
    expect(ctx.sources[2]!.loopStart).toBeCloseTo(3, 6);
  });

  it('stop-music beendet die Quelle; set-volume wirkt auf den laufenden Gain', async () => {
    const { rt, ctx } = runtimeWith({ 1: TAGGED_SHORT });
    await rt.resume();
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop: { start: 0, end: null, reason: 'whole-file' } });
    await rt.dispatch({ kind: 'set-volume', channel: 'music', volume: 0.25 });
    expect(ctx.gains[0]!.gain.value).toBe(0.25);
    await rt.dispatch({ kind: 'stop-music' });
    expect(ctx.sources[0]!.stopped).toBe(0);
    expect(rt.current).toBeNull();
  });

  it('fadeInTicks erzeugt eine Rampe statt eines harten Einsatzes', async () => {
    const { rt, ctx } = runtimeWith({ 1: TAGGED_SHORT });
    await rt.resume();
    await rt.dispatch({
      kind: 'play-music',
      trackId: 1,
      loop: { start: 0, end: null, reason: 'whole-file' },
      fadeInTicks: 30,
    });
    expect(ctx.gains[0]!.gain.events).toEqual(['set 0@0', 'ramp 1@0.5']);
  });

  it('unbekannter Titel und kaputter Strom führen zu Stille mit Diagnose, nicht zu einer Ausnahme', async () => {
    const ctx = new FakeContext();
    const notes: string[] = [];
    const rt = new MusicRuntime({
      context: ctx,
      loadTrack: async (id) => (id === 1 ? UNTAGGED : null),
      onDiagnostic: (m) => notes.push(m),
    });
    await rt.resume();
    await rt.dispatch({ kind: 'play-music', trackId: 99, loop: { start: 0, end: null, reason: 'whole-file' } });
    expect(ctx.sources).toHaveLength(0);
    expect(notes[0]).toContain('99');

    ctx.decodeFails = true;
    await rt.dispatch({ kind: 'play-music', trackId: 1, loop: { start: 0, end: null, reason: 'whole-file' } });
    expect(ctx.sources).toHaveLength(0);
    expect(notes[1]).toContain('nicht dekodierbar');
  });
});
