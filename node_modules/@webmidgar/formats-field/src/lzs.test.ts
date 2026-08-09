import { describe, expect, it } from 'vitest';
import { compressLzs, compressLzsEntry } from '@webmidgar/fixture-gen';
import { decompressLzs, decompressLzsEntry, LzsError } from './lzs.js';

/** Deterministischer PRNG (mulberry32) — Fuzzing ohne Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomBytes = (len: number, seed: number): Uint8Array => {
  const rnd = mulberry32(seed);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.floor(rnd() * 256);
  return out;
};

describe('LZS: Roundtrip', () => {
  it('komprimiert und dekomprimiert repetitive Daten verlustfrei (mit echten Referenzen)', () => {
    const pattern = new TextEncoder().encode('walkmesh-walkmesh-walkmesh-');
    const input = new Uint8Array(4096);
    for (let i = 0; i < input.length; i++) input[i] = pattern[i % pattern.length]!;
    const compressed = compressLzs(input);
    expect(compressed.length).toBeLessThan(input.length); // Referenz-Tokens kamen zum Einsatz
    expect(decompressLzs(compressed)).toEqual(input);
  });

  it('roundtrippt inkompressible Zufallsdaten (Literalpfad)', () => {
    const input = randomBytes(2048, 0xf7);
    expect(decompressLzs(compressLzs(input))).toEqual(input);
  });

  it('roundtrippt leere Eingabe und Kleinstgrößen', () => {
    for (const len of [0, 1, 2, 3, 7, 8, 9]) {
      const input = randomBytes(len, len + 1);
      expect(decompressLzs(compressLzs(input))).toEqual(input);
    }
  });

  it('Rahmenformat: u32-Vorsatz + Strom roundtrippt', () => {
    const input = randomBytes(512, 42);
    expect(decompressLzsEntry(compressLzsEntry(input))).toEqual(input);
  });
});

describe('LZS: typisierte Fehler', () => {
  it('E-LZS-STREAM: mitten im Referenz-Token abgeschnittener Strom', () => {
    const input = new TextEncoder().encode('abcabcabcabcabcabcabc');
    const compressed = compressLzs(input);
    // Iterativ kürzen: jede Kürzung liefert entweder gültige (kürzere) Ausgabe
    // oder LzsError — nie eine fremde Exception.
    for (let cut = compressed.length - 1; cut > 0; cut--) {
      try {
        decompressLzs(compressed.subarray(0, cut));
      } catch (err) {
        expect(err).toBeInstanceOf(LzsError);
      }
    }
  });

  it('E-LZS-STREAM: Ausgabelimit stoppt Dekompressionsbomben', () => {
    // Strom aus lauter Referenzen maximaler Länge → expandiert 8:1 pro Tokenpaar.
    const bomb = new Uint8Array(3000);
    for (let i = 0; i < bomb.length; i += 3) {
      bomb[i] = 0x00; // Steuerbyte: 8 Referenzen
      bomb[i + 1] = 0x00;
      bomb[i + 2] = 0x0f; // Länge 18, Offset 0
    }
    expect(() => decompressLzs(bomb, { maxOutput: 4096 })).toThrowError(LzsError);
  });

  it('E-LZS-STREAM: deklarierte Rahmenlänge überschreitet Eintrag', () => {
    const entry = compressLzsEntry(randomBytes(64, 7));
    new DataView(entry.buffer).setUint32(0, entry.length + 100, true);
    expect(() => decompressLzsEntry(entry)).toThrowError(LzsError);
  });

  it('Fuzzing: 300 mutierte Ströme werfen ausschließlich LzsError', () => {
    const input = randomBytes(1024, 0xbeef);
    const compressed = compressLzs(input);
    const rnd = mulberry32(0xc0ffee);
    for (let iter = 0; iter < 300; iter++) {
      const mutated = compressed.slice();
      const mutations = 1 + Math.floor(rnd() * 8);
      for (let m = 0; m < mutations; m++) {
        mutated[Math.floor(rnd() * mutated.length)] = Math.floor(rnd() * 256);
      }
      try {
        decompressLzs(mutated, { maxOutput: 1 << 20 });
      } catch (err) {
        expect(err, `Iteration ${iter}`).toBeInstanceOf(LzsError);
      }
    }
  });

  it('Abbruch: AbortSignal propagiert als AbortError, nicht als LzsError', () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => decompressLzs(compressLzs(randomBytes(64, 1)), { signal: ac.signal })).toThrowError(
      /abort/i,
    );
  });
});
