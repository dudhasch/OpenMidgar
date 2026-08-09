import { describe, expect, it } from 'vitest';
import { readOggLoopTags, planLoop, type OggLoopTags } from './ogg-tags.js';
import {
  applyAudioCommand,
  blockAudio,
  createAudioState,
  panToBalance,
  resumeAudio,
  PAN_CENTER,
  PAN_MAX,
  type AudioCommand,
  type AudioEngineState,
} from './engine.js';

// ---------------------------------------------------------------------------
// Hilfsbausteine: ein minimaler, selbst erzeugter OGG-Strom mit genau einer
// Seite und einem Vorbis-Kommentar-Header. Kein echter Vorbis-Codec nötig —
// der Decoder liest nur Rohbytes bis zum Kommentar-Header.
// ---------------------------------------------------------------------------

function u32le(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return Array.from(b);
}

function asciiBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/** Baut den Nutzlast-Bytestrom des Vorbis-Kommentar-Headers. */
function buildCommentPayload(comments: string[], vendor = 'webmidgar-test'): number[] {
  const bytes: number[] = [0x03, ...asciiBytes('vorbis')];
  const vendorBytes = asciiBytes(vendor);
  bytes.push(...u32le(vendorBytes.length), ...vendorBytes);
  bytes.push(...u32le(comments.length));
  for (const c of comments) {
    const cBytes = asciiBytes(c);
    bytes.push(...u32le(cBytes.length), ...cBytes);
  }
  return bytes;
}

/** Verpackt eine Nutzlast in genau eine OGG-Seite mit korrekter Segmenttabelle. */
function buildOggPage(payload: number[]): Uint8Array {
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
    0x4f, 0x67, 0x67, 0x53, // "OggS"
    0x00, // Version
    0x02, // header_type (erste Seite)
    0, 0, 0, 0, 0, 0, 0, 0, // Granule-Position
    1, 0, 0, 0, // Serial
    0, 0, 0, 0, // Sequenznummer
    0, 0, 0, 0, // Prüfsumme (vom Decoder nicht geprüft)
    segments.length,
  ];
  return Uint8Array.from([...header, ...segments, ...payload]);
}

function buildOggCommentStream(comments: string[], vendor?: string): Uint8Array {
  return buildOggPage(buildCommentPayload(comments, vendor));
}

describe('readOggLoopTags', () => {
  it('liest LOOPSTART aus einem selbst gebauten OGG-Kommentar-Header, unabhängig von der Schlüssel-Groß-/Kleinschreibung', () => {
    const bytes = buildOggCommentStream(['loopstart=44100', 'Title=Everdream']);
    const tags = readOggLoopTags(bytes);
    expect(tags.loopStart).toBe(44100);
    expect(tags.loopLength).toBeNull();
    expect(tags.keys).toContain('LOOPSTART');
    expect(tags.keys).toContain('TITLE');
    expect(tags.keys).toHaveLength(2);
  });

  it('liest LOOPSTART und LOOPLENGTH gemeinsam, wenn beide vorhanden sind', () => {
    const bytes = buildOggCommentStream(['LOOPSTART=1000', 'LOOPLENGTH=2000']);
    const tags = readOggLoopTags(bytes);
    expect(tags.loopStart).toBe(1000);
    expect(tags.loopLength).toBe(2000);
  });

  it('liefert null für loopStart/loopLength, wenn keine Schleifenmarken vorhanden sind (Realdaten-Regelfall für 13% der Titel)', () => {
    const bytes = buildOggCommentStream(['TITLE=Aerith Theme', 'ARTIST=Uematsu']);
    const tags = readOggLoopTags(bytes);
    expect(tags.loopStart).toBeNull();
    expect(tags.loopLength).toBeNull();
    expect(tags.keys).toEqual(['TITLE', 'ARTIST']);
  });

  it('wirft nicht bei fehlender OggS-Signatur, sondern liefert leere Tags', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => readOggLoopTags(bytes)).not.toThrow();
    const tags = readOggLoopTags(bytes);
    expect(tags).toEqual<OggLoopTags>({ loopStart: null, loopLength: null, keys: [] });
  });

  it('wirft nicht bei leerem Puffer', () => {
    const tags = readOggLoopTags(new Uint8Array(0));
    expect(tags).toEqual<OggLoopTags>({ loopStart: null, loopLength: null, keys: [] });
  });

  it('wirft nicht bei einem auf wenige Bytes abgeschnittenen Seiten-Header', () => {
    const full = buildOggCommentStream(['LOOPSTART=500']);
    const truncated = full.slice(0, 10); // kürzer als die 27 Byte des Seiten-Headers
    expect(() => readOggLoopTags(truncated)).not.toThrow();
    const tags = readOggLoopTags(truncated);
    expect(tags).toEqual<OggLoopTags>({ loopStart: null, loopLength: null, keys: [] });
  });
});

describe('planLoop', () => {
  it('liefert tagged-range, wenn Start und Länge getaggt sind', () => {
    const tags: OggLoopTags = { loopStart: 1000, loopLength: 500, keys: ['LOOPSTART', 'LOOPLENGTH'] };
    expect(planLoop(tags, 9999)).toEqual({ start: 1000, end: 1500, reason: 'tagged-range' });
  });

  it('liefert tagged-start-to-end, wenn nur der Start getaggt ist (Realdaten-Regelfall: 87% ohne LOOPLENGTH)', () => {
    const tags: OggLoopTags = { loopStart: 2000, loopLength: null, keys: ['LOOPSTART'] };
    expect(planLoop(tags, 8000)).toEqual({ start: 2000, end: 8000, reason: 'tagged-start-to-end' });
  });

  it('liefert whole-file ab 0, wenn keine Tags vorhanden sind', () => {
    const tags: OggLoopTags = { loopStart: null, loopLength: null, keys: [] };
    expect(planLoop(tags, 8000)).toEqual({ start: 0, end: 8000, reason: 'whole-file' });
  });

  it('gibt end: null weiter, wenn totalSamples unbekannt ist (nur Start getaggt)', () => {
    const tags: OggLoopTags = { loopStart: 2000, loopLength: null, keys: ['LOOPSTART'] };
    expect(planLoop(tags, null)).toEqual({ start: 2000, end: null, reason: 'tagged-start-to-end' });
  });

  it('gibt end: null weiter, wenn totalSamples unbekannt ist (keine Tags)', () => {
    const tags: OggLoopTags = { loopStart: null, loopLength: null, keys: [] };
    expect(planLoop(tags, null)).toEqual({ start: 0, end: null, reason: 'whole-file' });
  });
});

const loop = { start: 0, end: null, reason: 'whole-file' as const };

describe('Autoplay-Sperre', () => {
  it('merkt Kommandos vor der Freigabe nur vor — außer set-volume, das sofort wirkt', () => {
    let state = createAudioState();
    expect(state.gate).toBe('suspended');

    const playA: AudioCommand = { kind: 'play-music', trackId: 1, loop };
    const push: AudioCommand = { kind: 'push-music' };
    const setVol: AudioCommand = { kind: 'set-volume', channel: 'sound', volume: 0.5 };
    const playB: AudioCommand = { kind: 'play-music', trackId: 2, loop };

    state = applyAudioCommand(state, playA);
    state = applyAudioCommand(state, push);
    state = applyAudioCommand(state, setVol);
    state = applyAudioCommand(state, playB);

    // set-volume wirkt sofort auf die Lautstärke ...
    expect(state.volumes.sound).toBe(0.5);
    // ... landet aber nicht im Protokoll, solange das Gate nicht offen ist.
    expect(state.log).toEqual([]);
    expect(state.currentTrack).toBeNull();
    expect(state.pending).toEqual([playA, push, playB]);

    const resumed = resumeAudio(state);
    expect(resumed.gate).toBe('running');
    expect(resumed.pending).toEqual([]);
    expect(resumed.log).toEqual([playA, push, playB]);
    expect(resumed.currentTrack).toBe(2); // letztes play-music gewinnt
  });
});

describe('blockAudio', () => {
  it('verwirft den Stau und lässt weitere Kommandos ohne hörbare Wirkung', () => {
    let state = createAudioState();
    state = applyAudioCommand(state, { kind: 'play-music', trackId: 7, loop });
    expect(state.pending).toHaveLength(1);

    state = blockAudio(state);
    expect(state.gate).toBe('blocked');
    expect(state.pending).toEqual([]);

    state = applyAudioCommand(state, { kind: 'play-music', trackId: 8, loop });
    expect(state.currentTrack).toBeNull();
    expect(state.log).toEqual([]);
  });
});

/** Hilfsfunktion für Tests, die einen bereits freigegebenen Zustand brauchen. */
function runningState(): AudioEngineState {
  return resumeAudio(createAudioState());
}

describe('Titelkeller (push/pop)', () => {
  it('stellt den vorherigen Titel nach push/play/pop wieder her', () => {
    let state = runningState();
    state = applyAudioCommand(state, { kind: 'play-music', trackId: 1, loop });
    state = applyAudioCommand(state, { kind: 'push-music' });
    state = applyAudioCommand(state, { kind: 'play-music', trackId: 2, loop });
    expect(state.currentTrack).toBe(2);

    state = applyAudioCommand(state, { kind: 'pop-music' });
    expect(state.currentTrack).toBe(1);
    expect(state.trackStack).toEqual([]);
  });

  it('wirft nicht bei pop-music auf leerem Keller und liefert currentTrack: null', () => {
    const state = runningState();
    expect(() => applyAudioCommand(state, { kind: 'pop-music' })).not.toThrow();
    const popped = applyAudioCommand(state, { kind: 'pop-music' });
    expect(popped.currentTrack).toBeNull();
  });
});

describe('panToBalance', () => {
  it('ist 0 in der Mitte (PAN_CENTER = 0x40)', () => {
    expect(panToBalance(PAN_CENTER)).toBe(0);
  });

  it('ist -1 am linken Rand (0x00)', () => {
    expect(panToBalance(0)).toBe(-1);
  });

  it('ist etwa +1 am rechten Rand (0x7f)', () => {
    expect(panToBalance(PAN_MAX)).toBeCloseTo(1, 1);
  });

  it('klemmt Werte unterhalb von 0x00 auf den linken Rand', () => {
    expect(panToBalance(-50)).toBe(-1);
  });

  it('klemmt Werte oberhalb von 0x7f auf den rechten Rand', () => {
    expect(panToBalance(500)).toBeCloseTo(1, 1);
  });
});

describe('Lautstärke', () => {
  it('klemmt set-volume auf den Bereich 0…1', () => {
    let state = runningState();
    state = applyAudioCommand(state, { kind: 'set-volume', channel: 'music', volume: -3 });
    expect(state.volumes.music).toBe(0);
    state = applyAudioCommand(state, { kind: 'set-volume', channel: 'music', volume: 3 });
    expect(state.volumes.music).toBe(1);
  });
});
