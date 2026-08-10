import { existsSync, statSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADPCM_RECORD_BYTES,
  TERMINATOR_BYTES,
  auditAudioDat,
  blockCount,
  frameCount,
  parseAudioFmt,
  predictSamplesPerBlock,
  type SoundEntry,
} from '@webmidgar/audio';

/**
 * O1-Rest — die 48,5 MB, die `audio.fmt` angeblich nicht adressiert. **Gelöst.**
 *
 * **Stand vorher.** O1 hatte den Eintrag richtig aufgelöst: 24 B Kopf aus
 * sechs `uint32` (`Length, Offset, Loop, ?, Start, End`), dann ein
 * `ADPCMWAVEFORMAT` (50 B), zusammen 74 B. Das Accounting über 198 Einträge
 * war lückenlos — aber es endete bei 23.227.348 von 71.738.528 Byte. 32,4 %.
 * Der Rest galt als unadressiert, und die Vermutung war, es brauche eine
 * zweite Tabelle oder die EXE.
 *
 * **Der Fehler.** `audio.fmt` ist **kein Feld gleich großer Einträge**. Es ist
 * eine Folge von Abschnitten („Bänken"), und jede Bank endet mit einer
 * **Abschlussmarke von nur 42 Byte**: 24 B Kopf mit `Length == 0` und dem
 * Schreibstand in `Offset`, gefolgt von 18 nie beschriebenen WAVEFORMATEX-
 * Bytes (MSVC-Füllmuster 0xCD). Der Durchlauf des ersten Anlaufs hielt die
 * erste dieser Marken für das Dateiende und las danach ein um 42 Byte
 * verschobenes Raster — also Müll.
 *
 * **Die Rechnung stand schon da.** `54.668 mod 74 = 56`. Ein reines
 * 74-B-Raster kann `audio.fmt` gar nicht füllen; 56 Byte blieben übrig und
 * wurden als „Rest" abgelegt. 56 ist genau `26 × 42 mod 74` — der unerklärte
 * Rest war der Fingerabdruck der 26 Abschlussmarken. Dasselbe sagte das
 * Abstandshistogramm aus O1-alt: 87,1 % bei Abstand 74, nicht ~100 %. Beide
 * Zahlen standen längst da und sagten „das Raster bricht". Das ist derselbe
 * Fehlertyp wie bei O1 selbst — **die Antwort lag in einer Rechnung, die
 * schon dastand**, zum zweiten Mal in derselben Datei.
 *
 * **Was diese Probe misst.**
 *  1. Der Durchlauf verbraucht `audio.fmt` byteexakt (724 × 74 + 26 × 42).
 *  2. Das Accounting über `audio.dat` ist **100 %** — 0 Lücken, 0
 *     Überlappungen, von 0 bis zur Dateigröße.
 *  3. Die Gegenhypothese „festes 74-B-Raster" erklärt nur 32,4 % — sie ist
 *     als Kontrolle mitgemessen, nicht bloß behauptet.
 *  4. Der harte, billige MS-ADPCM-Test über **alle** Blöcke: Prädiktorindex
 *     < `wNumCoef`. Kontrollen: Versatz +1/+2/+512 und rotierte Offsets.
 *  5. Nullwert-Zweitrechnung: getrennte Auswertung für Bank 0 (der alte,
 *     schon belegte Bereich) und die Bänke 1..25 (die 48,5 MB).
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Offsets und
 * Formatkonstanten. Keine Audiodaten, keine Rohbytefolgen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const FMT = join(REAL_DIR, 'data', 'sound', 'audio.fmt');
const DAT = join(REAL_DIR, 'data', 'sound', 'audio.dat');
const available = existsSync(FMT) && existsSync(DAT);

interface Block {
  at: number;
  numCoef: number;
}

/** Alle Blockanfänge einer Satzmenge, optional verschoben. */
function bloecke(entries: readonly SoundEntry[], offsetOf: (i: number) => number, datLen: number): Block[] {
  const out: Block[] = [];
  entries.forEach((e, i) => {
    const base = offsetOf(i);
    if (base < 0 || base + e.length > datLen) return;
    const n = blockCount(e);
    for (let k = 0; k < n; k++) out.push({ at: base + k * e.format.blockAlign, numCoef: e.format.numCoef });
  });
  return out;
}

/**
 * Prüft die Blockanfänge in **einem** streamenden Durchlauf durch `audio.dat`.
 * Die Datei ist 71 MB groß; sie am Stück in den Heap zu laden wäre unnötig.
 */
async function pruefePraediktor(positionen: Block[], datLen: number): Promise<{ ok: number; n: number }> {
  const sortiert = [...positionen].sort((a, b) => a.at - b.at);
  const fh = await open(DAT, 'r');
  try {
    const CHUNK = 4 << 20;
    const buf = new Uint8Array(CHUNK);
    let ok = 0;
    let i = 0;
    for (let base = 0; base < datLen && i < sortiert.length; base += CHUNK) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, base);
      if (bytesRead <= 0) break;
      while (i < sortiert.length && sortiert[i]!.at < base + bytesRead) {
        const p = sortiert[i]!;
        if (p.at >= base && buf[p.at - base]! < p.numCoef) ok++;
        i++;
      }
    }
    return { ok, n: sortiert.length };
  } finally {
    await fh.close();
  }
}

const pct = (n: number, d: number): string => `${n}/${d} (${((n / Math.max(1, d)) * 100).toFixed(2)}%)`;

describe.skipIf(!available)('Realdaten: audio.fmt-Bankstruktur (O1-Rest)', () => {
  it('verbraucht audio.fmt byteexakt und überdeckt audio.dat zu 100 %', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const datLen = statSync(DAT).size;
    const table = parseAudioFmt(fmt);
    const audit = auditAudioDat(table, datLen);

    // Gegenhypothese: festes 74-B-Raster, Abbruch beim ersten Length == 0.
    const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
    let starrSumme = 0;
    let starrEintraege = 0;
    for (let i = 0; i * ADPCM_RECORD_BYTES + 8 <= fmt.length; i++) {
      const len = view.getUint32(i * ADPCM_RECORD_BYTES, true);
      if (len === 0) break;
      starrSumme += len;
      starrEintraege++;
    }

    const leereBaenke = table.banks.filter((b) => b.entries.length === 0).length;

    console.log(
      'audio.fmt — Bankstruktur (O1-Rest):',
      JSON.stringify(
        {
          Durchlauf: {
            Dateigröße: fmt.length,
            verbraucht: table.consumed,
            Rest: fmt.length - table.consumed,
            Klangsätze: table.entries.length,
            Bänke: table.banks.length,
            'davon leer': leereBaenke,
            Rechnung: `${table.entries.length}×${ADPCM_RECORD_BYTES} + ${table.banks.length}×${TERMINATOR_BYTES} = ${
              table.entries.length * ADPCM_RECORD_BYTES + table.banks.length * TERMINATOR_BYTES
            }`,
            Diagnosen: table.diagnostics.map((d) => d.code),
          },
          'Accounting audio.dat': {
            Dateigröße: audit.datBytes,
            referenziert: audit.referenced,
            überdeckt: audit.covered,
            Anteil: `${((audit.covered / audit.datBytes) * 100).toFixed(4)}%`,
            'beginnt bei 0': audit.startsAtZero,
            'endet am Dateiende': audit.endsAtEof,
            Lücken: `${audit.gaps} (${audit.gapBytes} B)`,
            Überlappungen: `${audit.overlaps} (${audit.overlapBytes} B)`,
            ausserhalb: audit.outside,
            byteexakt: audit.exact,
          },
          'Kontrollhypothese festes 74-B-Raster': {
            Einträge: starrEintraege,
            referenziert: starrSumme,
            Anteil: `${((starrSumme / datLen) * 100).toFixed(2)}%`,
            unerklärt: datLen - starrSumme,
            'Rest von audio.fmt mod 74': fmt.length % ADPCM_RECORD_BYTES,
            'Abschlussmarken × 42 mod 74': (table.banks.length * TERMINATOR_BYTES) % ADPCM_RECORD_BYTES,
          },
          Bänke: table.banks.map((b) => `${b.entries.length} Sätze → ${b.dataEnd}`),
        },
        null,
        1,
      ),
    );

    // 1. Der Durchlauf geht byteexakt auf. Das ist die erste harte Bedingung:
    //    eine falsche Satzgröße lässt einen Rest stehen.
    expect(table.diagnostics).toEqual([]);
    expect(table.consumed).toBe(fmt.length);
    expect(table.entries.length * ADPCM_RECORD_BYTES + table.banks.length * TERMINATOR_BYTES).toBe(fmt.length);

    // 2. Das Accounting über audio.dat ist der eigentliche Beweis.
    expect(audit.exact).toBe(true);
    expect(audit.covered).toBe(datLen);
    expect(audit.gaps).toBe(0);
    expect(audit.overlaps).toBe(0);
    expect(audit.outside).toBe(0);

    // 3. Die Gegenhypothese fällt messbar durch — sie erklärt nur die erste
    //    Bank. Ohne diese Zahl wäre „100 %" nur eine Behauptung.
    expect(starrSumme).toBeLessThan(datLen);
    expect(starrSumme / datLen).toBeLessThan(0.4);

    // 4. Die letzte Abschlussmarke trägt exakt die Dateigröße von audio.dat.
    expect(table.banks[table.banks.length - 1]!.dataEnd).toBe(datLen);
  }, 900_000);

  it('MS-ADPCM-Prädiktortest über alle Blöcke, mit Kontrollen und getrennter Zweitrechnung', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const datLen = statSync(DAT).size;
    const table = parseAudioFmt(fmt);
    const alle = table.entries;
    const bank0 = alle.filter((e) => e.bank === 0);
    const rest = alle.filter((e) => e.bank > 0);

    async function messe(entries: readonly SoundEntry[], offsetOf: (i: number) => number): Promise<string> {
      const b = bloecke(entries, offsetOf, datLen);
      const { ok, n } = await pruefePraediktor(b, datLen);
      return pct(ok, n);
    }

    const belegt = await messe(alle, (i) => alle[i]!.offset);
    const k1 = await messe(alle, (i) => alle[i]!.offset + 1);
    const k2 = await messe(alle, (i) => alle[i]!.offset + 2);
    const k512 = await messe(alle, (i) => alle[i]!.offset + 512);
    const kRot = await messe(alle, (i) => alle[(i + 1) % alle.length]!.offset);
    const kRot7 = await messe(alle, (i) => alle[(i + 7) % alle.length]!.offset);

    const b0 = await messe(bank0, (i) => bank0[i]!.offset);
    const b0rot = await messe(bank0, (i) => bank0[(i + 1) % bank0.length]!.offset);
    const bR = await messe(rest, (i) => rest[i]!.offset);
    const bRrot = await messe(rest, (i) => rest[(i + 1) % rest.length]!.offset);

    console.log(
      'MS-ADPCM-Prädiktortest (Blockanfang trägt Index < wNumCoef):',
      JSON.stringify(
        {
          'belegte Offsets': belegt,
          Kontrollen: {
            'Versatz +1': k1,
            'Versatz +2': k2,
            'Versatz +512': k512,
            'Offsets rotiert um 1': kRot,
            'Offsets rotiert um 7': kRot7,
          },
          'Nullwert-Zweitrechnung — getrennt': {
            'Bank 0 (alter, belegter Bereich)': { Sätze: bank0.length, Bytes: bank0.reduce((a, e) => a + e.length, 0), belegt: b0, rotiert: b0rot },
            'Bänke 1..25 (die 48,5 MB)': { Sätze: rest.length, Bytes: rest.reduce((a, e) => a + e.length, 0), belegt: bR, rotiert: bRrot },
          },
          Hinweis:
            'Der Einzelbyte-Versatz +2 ist als Kontrolle stumpf: Byte 2 ist das ' +
            'untere Byte von iDelta und meist klein. Scharf ist die Rotation — ' +
            'sie behält die Werteverteilung und zerstört nur die Zuordnung.',
        },
        null,
        1,
      ),
    );

    const quote = (s: string): number => Number.parseFloat(s.slice(s.indexOf('(') + 1));

    // Der Test ist hart: 100 % über ALLE Blöcke, in beiden Teilmengen.
    expect(quote(belegt)).toBe(100);
    expect(quote(b0)).toBe(100);
    expect(quote(bR)).toBe(100);
    // Die 48,5 MB bestehen den Test genauso wie der schon belegte Bereich —
    // dort liegen also Audiodaten, keine Füllung und keine Reste.
    expect(quote(bR)).toBeGreaterThan(quote(bRrot) + 15);
    expect(quote(kRot)).toBeLessThan(90);
    expect(quote(k1)).toBeLessThan(20);
    expect(quote(k512)).toBeLessThan(50);
  }, 900_000);

  it('unabhängige Vorhersagen aus dem WAVEFORMATEX halten über alle 724 Sätze', async () => {
    const fmt = new Uint8Array(await readFile(FMT));
    const table = parseAudioFmt(fmt);
    const alle = table.entries;

    let spb = 0;
    let koppel = 0;
    let coef = 0;
    let tag = 0;
    for (const e of alle) {
      if (e.format.samplesPerBlock === predictSamplesPerBlock(e.format)) spb++;
      if (e.format.blockAlign === 1024 * e.format.channels) koppel++;
      if (e.format.numCoef === 7 && e.format.coefficients.length === 7) coef++;
      if (e.format.formatTag === 2 && e.format.bitsPerSample === 4 && e.format.cbSize === 32) tag++;
    }

    // Loop ⟺ End und die Einheit der Schleifenmarken.
    const loops = alle.filter((e) => e.loop !== 0);
    let loopEnd = 0;
    for (const e of alle) if ((e.loop !== 0) === (e.loopEnd !== 0)) loopEnd++;
    let alsPcmBytes = 0;
    let alsFrames = 0;
    let startVorEnde = 0;
    for (const e of loops) {
      const frames = frameCount(e);
      const div = 2 * e.format.channels;
      if (e.loopEnd / div <= frames && e.loopStart / div <= frames) alsPcmBytes++;
      if (e.loopEnd <= frames) alsFrames++;
      if (e.loopStart < e.loopEnd) startVorEnde++;
    }

    // Nullwert-Zweitrechnung: Sind unter den gezählten Sätzen triviale?
    const nullSaetze = alle.filter((e) => e.length === 0).length;
    const reserviertNull = alle.filter((e) => e.reserved === 0).length;
    const raten = new Set(alle.map((e) => e.format.samplesPerSec));

    console.log(
      'Unabhängige Vorhersagen:',
      JSON.stringify(
        {
          Sätze: alle.length,
          'wSamplesPerBlock == Microsoft-Formel': pct(spb, alle.length),
          'nBlockAlign == 1024 × Kanalzahl': pct(koppel, alle.length),
          'wNumCoef == 7 mit 7 Koeffizientenpaaren': pct(coef, alle.length),
          'formatTag 2, 4 Bit, cbSize 32': pct(tag, alle.length),
          Abtastraten: [...raten],
          Schleifen: {
            'Loop ⟺ End': pct(loopEnd, alle.length),
            'davon Loop gesetzt': loops.length,
            'Start < End': pct(startVorEnde, loops.length),
            'Marken als PCM16-Bytes (÷ 2 ÷ Kanäle) im Bereich': pct(alsPcmBytes, loops.length),
            'KONTROLLE: Marken direkt als Frames im Bereich': pct(alsFrames, loops.length),
          },
          'Nullwert-Zweitrechnung': {
            'gezählte Sätze mit Length == 0': nullSaetze,
            'Feld +12 == 0': pct(reserviertNull, alle.length),
            Hinweis:
              'Abschlussmarken sind aus der Menge ausgeschlossen und tragen im ' +
              'Formatteil 0xCD statt Nullen — sie können keine Quote trivial heben.',
          },
        },
        null,
        1,
      ),
    );

    // Keine trivialen Sätze in der gezählten Menge.
    expect(nullSaetze).toBe(0);

    // Zwei Vorhersagen, die unabhängig vom Accounting durchfallen könnten.
    expect(spb).toBe(alle.length);
    expect(koppel).toBe(alle.length);
    expect(coef).toBe(alle.length);
    expect(tag).toBe(alle.length);
    expect(loopEnd).toBe(alle.length);

    // Die Einheit der Schleifenmarken: als PCM16-Bytes gelesen passen sie,
    // direkt als Frames gelesen nicht ein einziges Mal.
    expect(alsPcmBytes).toBe(loops.length);
    expect(alsFrames).toBe(0);
    expect(startVorEnde).toBe(loops.length);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
