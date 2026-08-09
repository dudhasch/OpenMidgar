import { buildLgp, type LgpFixtureLayout } from './lgp-writer.js';

const ascii = (s: string) => new TextEncoder().encode(s);

/** Standard-Fixture: gemischte Namen, verschiedene Payloadgrößen. */
export function basicFixture(): LgpFixtureLayout {
  return buildLgp({
    entries: [
      { name: 'aaaa.hrc', data: ascii(':HEADER_BLOCK fixture') },
      { name: 'aaab.rsd', data: ascii('@fixture rsd payload') },
      { name: 'ballet.p', data: new Uint8Array(256).fill(0x42) },
      { name: 'cloud_x.tex', data: new Uint8Array(64).fill(7) },
      { name: '1tile.tex', data: ascii('digit-name payload') },
      { name: 'z.a', data: new Uint8Array(1) },
    ],
  });
}

/** Fixture mit Konfliktgruppe: gleicher Kurzname aus zwei Quellordnern. */
export function conflictFixture(): LgpFixtureLayout {
  return buildLgp({
    entries: [
      { name: 'shared.tex', data: ascii('variant one'), conflictIndex: 1, conflictDir: 'dir_a' },
      { name: 'shared.tex', data: ascii('variant two!'), conflictIndex: 2, conflictDir: 'dir_b' },
      { name: 'plain.p', data: ascii('no conflict') },
    ],
  });
}

/** Fixture ohne Konfliktfeld (Datenbereich beginnt direkt nach der Lookup-Tabelle). */
export function omitConflictFieldFixture(): LgpFixtureLayout {
  return buildLgp({
    entries: [{ name: 'only.p', data: ascii('payload') }],
    emptyConflictField: 'omit',
  });
}

export function unterminatedFixture(): LgpFixtureLayout {
  return buildLgp({
    entries: [{ name: 'aa.p', data: ascii('payload') }],
    omitTerminator: true,
  });
}

/** Name mit nicht-kanonischen Zeichen → W-LGP-NAME. */
export function weirdNameFixture(): LgpFixtureLayout {
  return buildLgp({
    entries: [
      { name: 'UPPER CASE$.TEX', data: ascii('weird') },
      { name: 'normal.tex', data: ascii('ok') },
    ],
  });
}
