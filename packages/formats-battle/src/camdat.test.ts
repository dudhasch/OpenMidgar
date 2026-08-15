import { describe, expect, it } from 'vitest';
import {
  CAMDAT_HEADER_LEN,
  CAMDAT_PSX_BASE,
  altEyeBodyOffset,
  altFocusBodyOffset,
  bodyBytes,
  camdatFileForLayout,
  eyeBodyOffset,
  focusBodyOffset,
  parseCamDat,
} from './camdat.js';

/**
 * Fixtures für den `camdat`-Container (K11) — selbst erzeugt, wie überall im
 * Projekt: nie Originaldaten im Baum.
 *
 * Der Bauer unten ist bewusst eine **zweite Implementierung** der Grammatik
 * (er schreibt, was der Parser liest). Genau deshalb fangen diese Fälle
 * Missverständnisse, die eine Realdatenprobe nicht fängt: Die echte Datei
 * besteht auch dann, wenn der Parser aus dem falschen Grund richtig liegt.
 */

interface Bau {
  takes: number;
  /** Körper als Bytefolgen OHNE Abschluss; der wird angehängt. */
  koerper: number[][];
  /** Verzeichnisplatz → Index in `koerper`; Länge muss 3·takes sein. */
  eye: number[];
  focus: number[];
  altEye: [number, number, number];
  altFocus: [number, number, number];
}

/**
 * Baut ein gültiges Archiv nach der belegten Grammatik:
 * Kopf(16) · Hauptkörper · eyeDir · focusDir · Alternativkörper · altEyeDir ·
 * altFocusDir, und `altFocusDir + 12` ist byteexakt das Dateiende.
 */
function baue(b: Bau): Uint8Array {
  const mitEnde = b.koerper.map((k) => [...k, 0xff]);
  const anzahlHaupt = Math.max(...b.eye, ...b.focus) + 1;
  const haupt = mitEnde.slice(0, anzahlHaupt);
  const alt = mitEnde.slice(anzahlHaupt);

  const hauptVersatz: number[] = [];
  let at = CAMDAT_HEADER_LEN;
  for (const k of haupt) {
    hauptVersatz.push(at);
    at += k.length;
  }
  const eyeDir = at;
  const focusDir = eyeDir + b.takes * 12;
  at = focusDir + b.takes * 12;

  const altVersatz: number[] = [];
  for (const k of alt) {
    altVersatz.push(at);
    at += k.length;
  }
  const altEyeDir = at;
  const altFocusDir = altEyeDir + 12;
  const laenge = altFocusDir + 12;

  const out = new Uint8Array(laenge);
  const view = new DataView(out.buffer);
  const setz = (o: number, wert: number): void => view.setUint32(o, (wert + CAMDAT_PSX_BASE) >>> 0, true);

  setz(0, eyeDir);
  setz(4, focusDir);
  setz(8, altEyeDir);
  setz(12, altFocusDir);
  haupt.forEach((k, i) => out.set(k, hauptVersatz[i]!));
  alt.forEach((k, i) => out.set(k, altVersatz[i]!));
  b.eye.forEach((k, i) => setz(eyeDir + i * 4, hauptVersatz[k]!));
  b.focus.forEach((k, i) => setz(focusDir + i * 4, hauptVersatz[k]!));
  b.altEye.forEach((k, i) => setz(altEyeDir + i * 4, altVersatz[k - anzahlHaupt]!));
  b.altFocus.forEach((k, i) => setz(altFocusDir + i * 4, altVersatz[k - anzahlHaupt]!));
  return out;
}

/** Zwei Takes; Körper 0 wird von mehreren Plätzen geteilt. */
const GUELTIG: Bau = {
  takes: 2,
  koerper: [
    [0x01],
    [0x02, 0x03],
    [0x04],
    [0x05, 0x06, 0x07],
    // Alternativkörper (Index 4..5)
    [0x08],
    [0x09],
  ],
  eye: [0, 0, 1, 2, 2, 2],
  focus: [3, 3, 3, 1, 0, 3],
  altEye: [4, 4, 5],
  altFocus: [5, 5, 4],
};

describe('parseCamDat — gültiges Archiv', () => {
  it('liest Verzeichnisse, Takezahl und Körpergrenzen', () => {
    const a = parseCamDat(baue(GUELTIG), 'fixture-camdat.bin')!;
    expect(a).not.toBeNull();
    expect(a.takeCount).toBe(2);
    expect(a.diagnostics).toEqual([]);
    expect(a.altFocusDir + 12).toBe(a.bytes.length);

    // Körper 0 ist geteilt: die Plätze eye[0] und eye[1] zeigen auf denselben.
    expect(eyeBodyOffset(a, 0, 0)).toBe(eyeBodyOffset(a, 0, 1));
    expect(bodyBytes(a, eyeBodyOffset(a, 0, 0)!)).toEqual(new Uint8Array([0x01, 0xff]));
    expect(bodyBytes(a, focusBodyOffset(a, 1, 1)!)).toEqual(new Uint8Array([0x01, 0xff]));
    expect(bodyBytes(a, focusBodyOffset(a, 0, 0)!)).toEqual(new Uint8Array([0x05, 0x06, 0x07, 0xff]));
    expect(bodyBytes(a, altEyeBodyOffset(a, 2)!)).toEqual(new Uint8Array([0x09, 0xff]));
    expect(bodyBytes(a, altFocusBodyOffset(a, 2)!)).toEqual(new Uint8Array([0x08, 0xff]));
  });

  it('gibt null statt Müll außerhalb der Schranken', () => {
    const a = parseCamDat(baue(GUELTIG), 'fixture-camdat.bin')!;
    expect(eyeBodyOffset(a, 2, 0)).toBeNull();
    expect(focusBodyOffset(a, 0, 3)).toBeNull();
    expect(altEyeBodyOffset(a, -1)).toBeNull();
  });
});

describe('parseCamDat — jede verletzte Invariante wird benannt', () => {
  const kaputt = (aendere: (b: Uint8Array, v: DataView) => void): ReturnType<typeof parseCamDat> => {
    const bytes = baue(GUELTIG);
    aendere(bytes, new DataView(bytes.buffer));
    return parseCamDat(bytes, 'fixture-kaputt.bin');
  };

  it('I1 — Spanne kein Vielfaches von 12', () => {
    const a = kaputt((_, v) => v.setUint32(4, v.getUint32(4, true) + 1, true));
    expect(a).toBeNull();
  });

  it('I3 — altFocusDir + 12 trifft das Dateiende nicht', () => {
    const a = kaputt((_, v) => v.setUint32(12, v.getUint32(12, true) - 4, true));
    expect(a).toBeNull();
  });

  it('I4 — ein Verzeichniszeiger zeigt aus seinem Bereich heraus', () => {
    const gut = parseCamDat(baue(GUELTIG), 'x')!;
    const a = kaputt((_, v) => v.setUint32(gut.eyeDir, (CAMDAT_PSX_BASE + 8) >>> 0, true));
    expect(a).toBeNull();
  });

  it('I5 — ein Körper endet nicht auf 0xFF', () => {
    const gut = parseCamDat(baue(GUELTIG), 'x')!;
    const a = kaputt((b) => {
      // Alle 0xFF hinter dem ersten Körper überschreiben.
      for (let i = CAMDAT_HEADER_LEN; i < gut.eyeDir; i++) if (b[i] === 0xff) b[i] = 0x00;
    });
    expect(a).toBeNull();
  });

  it('eine falsche Zeigerbasis fällt durch, statt Unsinn zu liefern', () => {
    // Das ist dieselbe Kontrolle wie an den Realdaten, hier gegen eine
    // Fixture: Der Parser darf bei falscher Basis nicht werfen, sondern muss
    // eine Diagnose liefern.
    for (const delta of [-4, 4, 0x1000, -CAMDAT_PSX_BASE]) {
      const bytes = baue(GUELTIG);
      const v = new DataView(bytes.buffer);
      for (let i = 0; i < 4; i++) v.setUint32(i * 4, (v.getUint32(i * 4, true) + delta) >>> 0, true);
      expect(() => parseCamDat(bytes, 'fixture-basis.bin')).not.toThrow();
      expect(parseCamDat(bytes, 'fixture-basis.bin')).toBeNull();
    }
  });

  it('zu kurze Datei', () => {
    expect(parseCamDat(new Uint8Array(20), 'kurz.bin')).toBeNull();
  });
});

describe('camdatFileForLayout', () => {
  it('deckt 0…8 vollständig auf drei Dateien ab', () => {
    expect([0, 1, 8].map(camdatFileForLayout)).toEqual(['camdat0.bin', 'camdat0.bin', 'camdat0.bin']);
    expect(camdatFileForLayout(2)).toBe('camdat1.bin');
    expect([3, 4, 5, 6, 7].map(camdatFileForLayout)).toEqual(Array(5).fill('camdat2.bin'));
  });

  it('rät nicht außerhalb des belegten Bereichs', () => {
    expect(camdatFileForLayout(9)).toBeNull();
    expect(camdatFileForLayout(-1)).toBeNull();
    expect(camdatFileForLayout(1.5)).toBeNull();
  });
});
