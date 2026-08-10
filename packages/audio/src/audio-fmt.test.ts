import { describe, expect, it } from 'vitest';
import {
  composeAudioDat,
  composeAudioFmt,
  type AudioFmtBankSpec,
} from '@webmidgar/fixture-gen';
import {
  ADPCM_RECORD_BYTES,
  TERMINATOR_BYTES,
  auditAudioDat,
  blockCount,
  frameCount,
  loopFrames,
  parseAudioFmt,
  predictSamplesPerBlock,
} from './audio-fmt.js';

/**
 * Roundtrip-Suite Composer ↔ Parser für `audio.fmt` (S38).
 *
 * Der Composer in fixture-gen ist die unabhängige zweite Implementierung
 * (Dualitätsprinzip). Geprüft wird vor allem die eine Eigenschaft, an der der
 * erste Anlauf gescheitert ist: **Die Datei ist kein Feld gleich großer
 * Einträge.** Bänke werden durch 42-B-Abschlussmarken getrennt, Klangsätze
 * sind 74 B lang. Ein Parser mit festem 74-B-Raster liest ab der ersten
 * Abschlussmarke Müll — die Fixtures erzwingen genau diesen Fall.
 */

const eineBank: AudioFmtBankSpec = [
  { length: 4096 },
  { length: 2048, loop: 1, loopStart: 1024, loopEnd: 8000 },
];

describe('audio.fmt — Satzgrößen und Bankgrenzen', () => {
  it('verbraucht die Datei byteexakt: n×74 + b×42', () => {
    const banken: AudioFmtBankSpec[] = [eineBank, [], [{ length: 512 }, { length: 512 }, { length: 512 }]];
    const bytes = composeAudioFmt(banken);
    expect(bytes.length).toBe(5 * ADPCM_RECORD_BYTES + 3 * TERMINATOR_BYTES);

    const table = parseAudioFmt(bytes);
    expect(table.diagnostics).toEqual([]);
    expect(table.consumed).toBe(bytes.length);
    expect(table.banks.map((b) => b.entries.length)).toEqual([2, 0, 3]);
    expect(table.entries).toHaveLength(5);
  });

  it('erkennt die leere Bank — zwei Abschlussmarken hintereinander', () => {
    const table = parseAudioFmt(composeAudioFmt([[], [], [{ length: 100 }]]));
    expect(table.diagnostics).toEqual([]);
    expect(table.banks).toHaveLength(3);
    expect(table.banks[0]!.entries).toHaveLength(0);
    expect(table.banks[1]!.entries).toHaveLength(0);
    // Leere Bänke schieben den Schreibstand nicht weiter.
    expect(table.banks[0]!.dataEnd).toBe(0);
    expect(table.banks[1]!.dataEnd).toBe(0);
    expect(table.banks[2]!.dataEnd).toBe(100);
  });

  it('nummeriert Sätze fortlaufend über Bankgrenzen hinweg', () => {
    const table = parseAudioFmt(composeAudioFmt([[{ length: 10 }, { length: 20 }], [{ length: 30 }]]));
    expect(table.entries.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(table.entries.map((e) => e.bank)).toEqual([0, 0, 1]);
    expect(table.entries.map((e) => e.indexInBank)).toEqual([0, 1, 0]);
  });

  it('liest die 18 Füllbytes der Abschlussmarke NICHT als Format', () => {
    // Der Composer füllt sie mit 0xCD. Läse der Parser dort ein
    // WAVEFORMATEX, ergäbe cbSize 0xCDCD und der Durchlauf liefe aus der
    // Datei heraus — genau der Fehler des ersten Anlaufs, nur andersherum.
    const bytes = composeAudioFmt([[{ length: 8 }]]);
    expect(bytes[ADPCM_RECORD_BYTES + 24]).toBe(0xcd);
    const table = parseAudioFmt(bytes);
    expect(table.diagnostics).toEqual([]);
    expect(table.consumed).toBe(bytes.length);
  });

  it('meldet einen unverbuchten Rest, statt ihn zu verschweigen', () => {
    const bytes = composeAudioFmt([[{ length: 8 }]]);
    const kaputt = new Uint8Array(bytes.length + 9);
    kaputt.set(bytes);
    const table = parseAudioFmt(kaputt);
    expect(table.diagnostics.map((d) => d.code)).toContain('E-AFMT-REST');
  });

  it('meldet Sätze ohne Abschlussmarke', () => {
    const bytes = composeAudioFmt([[{ length: 8 }]]).slice(0, ADPCM_RECORD_BYTES);
    const table = parseAudioFmt(bytes);
    expect(table.diagnostics.map((d) => d.code)).toContain('E-AFMT-NOTERM');
  });

  it('meldet einen fremden Formatschlüssel', () => {
    const table = parseAudioFmt(composeAudioFmt([[{ length: 8, formatTag: 1 }]]));
    expect(table.diagnostics.map((d) => d.code)).toContain('W-AFMT-FORMAT');
  });
});

describe('audio.fmt — Accounting als Wahrheitstest', () => {
  const banken: AudioFmtBankSpec[] = [
    [{ length: 4096 }, { length: 3072 }],
    [],
    [{ length: 1024 }],
  ];

  it('überdeckt audio.dat lückenlos und überlappungsfrei', () => {
    const table = parseAudioFmt(composeAudioFmt(banken));
    const dat = composeAudioDat(banken);
    const audit = auditAudioDat(table, dat.length);
    expect(audit.referenced).toBe(dat.length);
    expect(audit.covered).toBe(dat.length);
    expect(audit.gaps).toBe(0);
    expect(audit.overlaps).toBe(0);
    expect(audit.outside).toBe(0);
    expect(audit.startsAtZero).toBe(true);
    expect(audit.endsAtEof).toBe(true);
    expect(audit.exact).toBe(true);
  });

  it('die letzte Abschlussmarke trägt die Dateigröße von audio.dat', () => {
    const table = parseAudioFmt(composeAudioFmt(banken));
    expect(table.banks[table.banks.length - 1]!.dataEnd).toBe(composeAudioDat(banken).length);
  });

  it('Kontrollhypothese: ein zu großes audio.dat lässt die Rechnung durchfallen', () => {
    const table = parseAudioFmt(composeAudioFmt(banken));
    const audit = auditAudioDat(table, composeAudioDat(banken).length + 1);
    expect(audit.endsAtEof).toBe(false);
    expect(audit.exact).toBe(false);
  });

  it('Kontrollhypothese: eine Lücke wird als Lücke gemeldet', () => {
    const table = parseAudioFmt(composeAudioFmt(banken));
    table.entries[1]!.offset += 64;
    const audit = auditAudioDat(table, composeAudioDat(banken).length);
    expect(audit.gaps).toBe(1);
    expect(audit.gapBytes).toBe(64);
    expect(audit.exact).toBe(false);
  });

  it('Kontrollhypothese: eine Überlappung wird als Überlappung gemeldet', () => {
    const table = parseAudioFmt(composeAudioFmt(banken));
    table.entries[1]!.offset -= 64;
    const audit = auditAudioDat(table, composeAudioDat(banken).length);
    expect(audit.overlaps).toBe(1);
    expect(audit.overlapBytes).toBe(64);
    expect(audit.exact).toBe(false);
  });

  it('das feste 74-B-Raster erklärt nur die erste Bank — der Gegenbeweis', () => {
    // Diese Rechnung ist der eigentliche Befund von S38: Wer die Datei als
    // Feld gleich großer Einträge liest, sieht nur bis zur ersten
    // Abschlussmarke und hält den Rest für unadressiert.
    const bytes = composeAudioFmt(banken);
    const dat = composeAudioDat(banken);
    let starres = 0;
    const view = new DataView(bytes.buffer);
    for (let i = 0; i * ADPCM_RECORD_BYTES + 8 <= bytes.length; i++) {
      const len = view.getUint32(i * ADPCM_RECORD_BYTES, true);
      if (len === 0) break;
      starres += len;
    }
    expect(starres).toBeLessThan(dat.length);
    expect(starres).toBe(4096 + 3072); // nur Bank 0
    expect(bytes.length % ADPCM_RECORD_BYTES).not.toBe(0); // der Rest, der es verrät
  });
});

describe('audio.fmt — abgeleitete Größen', () => {
  it('wSamplesPerBlock folgt der MS-ADPCM-Formel', () => {
    const table = parseAudioFmt(composeAudioFmt([[{ length: 4096 }, { length: 4096, channels: 2, blockAlign: 2048 }]]));
    for (const e of table.entries) {
      expect(e.format.samplesPerBlock).toBe(predictSamplesPerBlock(e.format));
    }
    expect(table.entries[0]!.format.samplesPerBlock).toBe(2036);
    expect(table.entries[1]!.format.samplesPerBlock).toBe(2036);
  });

  it('Blockzahl rundet den angebrochenen letzten Block auf', () => {
    const table = parseAudioFmt(composeAudioFmt([[{ length: 1024 }, { length: 1025 }]]));
    expect(blockCount(table.entries[0]!)).toBe(1);
    expect(blockCount(table.entries[1]!)).toBe(2);
    expect(frameCount(table.entries[0]!)).toBe(2036);
  });

  it('Schleifenmarken sind Byteversätze im dekodierten PCM16-Strom', () => {
    const table = parseAudioFmt(
      composeAudioFmt([[{ length: 1024, loop: 1, loopStart: 2000, loopEnd: 4000 }, { length: 1024 }]]),
    );
    expect(loopFrames(table.entries[0]!)).toEqual({ start: 1000, end: 2000 });
    expect(loopFrames(table.entries[1]!)).toBeNull();
  });

  it('Stereo halbiert die Frames je Byte', () => {
    const table = parseAudioFmt(
      composeAudioFmt([[{ length: 2048, channels: 2, blockAlign: 2048, loop: 1, loopStart: 0, loopEnd: 8000 }]]),
    );
    expect(loopFrames(table.entries[0]!)).toEqual({ start: 0, end: 2000 });
  });

  it('die erzeugten audio.dat-Blöcke tragen gültige Prädiktorindizes', () => {
    // Derselbe harte, billige Test wie gegen die Realdaten — hier gegen
    // Fixtures, damit die Prüfung ohne Installation läuft.
    const banken: AudioFmtBankSpec[] = [[{ length: 4096 }], [{ length: 3072 }]];
    const table = parseAudioFmt(composeAudioFmt(banken));
    const dat = composeAudioDat(banken);
    let bloecke = 0;
    let ok = 0;
    for (const e of table.entries) {
      for (let k = 0; k < blockCount(e); k++) {
        bloecke++;
        if (dat[e.offset + k * e.format.blockAlign]! < e.format.numCoef) ok++;
      }
    }
    expect(bloecke).toBe(7);
    expect(ok).toBe(bloecke);
  });
});
