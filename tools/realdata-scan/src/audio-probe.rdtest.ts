import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * S16-Vorprobe „Audio-Struktur": Bestandsaufnahme der Audiodateien der
 * lokalen FF7-Installation (Sound-`audio.dat`/`audio.fmt` + Musik-OGGs),
 * bevor `packages/formats-audio` bzw. eine WebAudio-Engine entsteht
 * (siehe docs/ROADMAP-S13-S19.md, Abschnitt S16).
 *
 * M1 — Bestandsaufnahme: alle gefundenen Dateien mit relativem Pfad,
 * Größe, Einstufung original/overlay (`mods/**` = Overlay). Für
 * `audio.dat`/`audio.fmt` zusätzlich SHA-256; für OGGs reicht Anzahl je
 * Verzeichnis + Größenverteilung.
 *
 * M2 — `audio.fmt` als Eintragstabelle: Hypothese „Folge gleich großer
 * Einträge, die je einen Bereich (Offset, Länge) in `audio.dat`
 * beschreiben". Für jede aufgehende Eintragsgröße (4..128 B, Teiler der
 * Dateigröße) wird an jeder Bytepositionskombination (Offset-Feld,
 * Länge-Feld, beide u32 LE, PC-Konvention, nicht überlappend) geprüft:
 * Offset+Länge <= audio.dat-Größe, Offsets monoton steigend über die
 * Einträge, aufeinanderfolgende Bereiche überlappungsfrei
 * (Offset[i]+Länge[i] <= Offset[i+1]). Die 5 besten Kombinationen
 * (kleinste der drei Quoten als Rangkriterium) werden berichtet.
 *
 * M3 — OGG-Loop-Tags: für alle gefundenen OGG-Dateien wird ausschließlich
 * der Vorbis-Comment-Header (zweites OGG-Paket) geparst — kein
 * Audio-Decoding — und nach `LOOPSTART`/`LOOPLENGTH` gesucht (Groß-/
 * Kleinschreibung egal). Berichtet werden nur Zahlen/Quoten, keine
 * Dateinamen der Musikstücke (Werkinhalt).
 *
 * M4 — Musikindex-Zuordnung (Negativbefund erlaubt): H1 sucht kleine
 * `.txt`/`.lst`/`.cfg`-Dateien in den Audioverzeichnissen (nur Name +
 * Zeilenanzahl, kein Inhalt); H2 prüft, ob OGG-Dateinamen einem
 * Nummernschema folgen (nur Zähler, keine konkreten Namen).
 *
 * Urheberrecht/Datenschutz: Ausgabe ausschließlich Pfade (relativ zur
 * Installation), Längen, Zähler, Anteile und SHA-256-Digests — keine
 * Titelnamen, kein Audioinhalt, keine Rohbytefolgen über 16 Byte.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

// --- Dateisuche ----------------------------------------------------------

interface Datei {
  abs: string;
  /** relativ zu REAL_DIR, '/'-getrennt */
  rel: string;
  groesse: number;
}

/** Rekursiver Voll-Scan von `root`, tolerant gegen Zugriffsfehler. */
async function walkAll(root: string): Promise<Datei[]> {
  const out: Datei[] = [];
  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        let s;
        try {
          s = await stat(abs);
        } catch {
          continue;
        }
        out.push({ abs, rel, groesse: s.size });
      }
    }
  }
  await walk(root, '');
  return out;
}

function basenamePosix(rel: string): string {
  return rel.split('/').pop() ?? rel;
}

function dirOfPosix(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '' : rel.slice(0, idx);
}

/** `mods/**` gilt als Overlay-Fundort (7th-Heaven-Konvention). */
function isOverlay(rel: string): boolean {
  return (rel.toLowerCase().split('/')[0] ?? '') === 'mods';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

function summen(zahlen: number[]): { min: number; median: number; max: number; summe: number } | null {
  if (zahlen.length === 0) return null;
  const sortiert = [...zahlen].sort((a, b) => a - b);
  const mid = Math.floor(sortiert.length / 2);
  const median =
    sortiert.length % 2 === 0 ? (sortiert[mid - 1]! + sortiert[mid]!) / 2 : sortiert[mid]!;
  return {
    min: sortiert[0]!,
    median,
    max: sortiert[sortiert.length - 1]!,
    summe: zahlen.reduce((a, b) => a + b, 0),
  };
}

// --- M2: audio.fmt als Eintragstabelle ------------------------------------

interface M2Kombo {
  eintragsgroesse: number;
  offsetPos: number;
  laengePos: number;
  anzahlEintraege: number;
  quoteImRahmen: number;
  quoteMonotonSteigend: number;
  quoteUeberlappungsfrei: number;
  quoteMinimum: number;
}

interface M2Ergebnis {
  verfuegbar: boolean;
  dateigroesseFmt: number | null;
  dateigroesseDat: number | null;
  geprueftEintragsgroessenVon: number;
  geprueftEintragsgroessenBis: number;
  aufgehendeEintragsgroessen: number[];
  kombinationenGeprueftGesamt: number;
  top5: M2Kombo[];
}

/**
 * Prüft je aufgehender Eintragsgröße (4..128 B) alle nicht überlappenden
 * u32-Feldpositionspaare (Offset, Länge) LE gegen die drei Bedingungen.
 */
function computeM2(fmtBytes: Uint8Array, datGroesse: number): M2Ergebnis {
  const view = new DataView(fmtBytes.buffer, fmtBytes.byteOffset, fmtBytes.byteLength);
  const fileSize = fmtBytes.length;
  const aufgehend: number[] = [];
  const alle: M2Kombo[] = [];

  for (let eintragsgroesse = 4; eintragsgroesse <= 128; eintragsgroesse++) {
    if (fileSize % eintragsgroesse !== 0) continue;
    aufgehend.push(eintragsgroesse);
    const n = fileSize / eintragsgroesse;

    const positionen: number[] = [];
    for (let p = 0; p + 4 <= eintragsgroesse; p++) positionen.push(p);

    for (const offsetPos of positionen) {
      for (const laengePos of positionen) {
        // Felder dürfen sich nicht überlappen (zwei getrennte u32-Werte).
        if (offsetPos < laengePos + 4 && laengePos < offsetPos + 4) continue;

        let imRahmen = 0;
        let monoton = 0;
        let ueberlappungsfrei = 0;
        let prevOffset = -1;
        let prevEnde = -1;

        for (let i = 0; i < n; i++) {
          const base = i * eintragsgroesse;
          const offset = view.getUint32(base + offsetPos, true);
          const laenge = view.getUint32(base + laengePos, true);
          if (offset + laenge <= datGroesse) imRahmen++;
          if (i > 0) {
            if (offset >= prevOffset) monoton++;
            if (prevEnde <= offset) ueberlappungsfrei++;
          }
          prevOffset = offset;
          prevEnde = offset + laenge;
        }

        const quoteImRahmen = imRahmen / n;
        const quoteMonotonSteigend = n > 1 ? monoton / (n - 1) : 1;
        const quoteUeberlappungsfrei = n > 1 ? ueberlappungsfrei / (n - 1) : 1;
        const quoteMinimum = Math.min(quoteImRahmen, quoteMonotonSteigend, quoteUeberlappungsfrei);

        alle.push({
          eintragsgroesse,
          offsetPos,
          laengePos,
          anzahlEintraege: n,
          quoteImRahmen,
          quoteMonotonSteigend,
          quoteUeberlappungsfrei,
          quoteMinimum,
        });
      }
    }
  }

  alle.sort((a, b) => b.quoteMinimum - a.quoteMinimum);

  return {
    verfuegbar: true,
    dateigroesseFmt: fileSize,
    dateigroesseDat: datGroesse,
    geprueftEintragsgroessenVon: 4,
    geprueftEintragsgroessenBis: 128,
    aufgehendeEintragsgroessen: aufgehend,
    kombinationenGeprueftGesamt: alle.length,
    top5: alle.slice(0, 5),
  };
}

// --- M3: OGG-Loop-Tags -----------------------------------------------------

/** Nur Header lesen — max. 128 KiB ab Dateianfang, nie den ganzen Track. */
const OGG_HEADER_READ_CAP = 131_072;

/**
 * Liest die ersten zwei OGG-Pakete (Identification, Vorbis-Comment) aus
 * dem Anfang der Datei. Gibt `null` zurück, wenn der Container nicht
 * innerhalb des Lesefensters vollständig parsbar ist — kein Absturz.
 */
async function readFirstTwoOggPackets(absPath: string): Promise<Buffer[] | null> {
  let handle;
  try {
    handle = await open(absPath, 'r');
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    const readLen = Math.min(OGG_HEADER_READ_CAP, st.size);
    if (readLen < 27) return null;
    const buf = Buffer.alloc(readLen);
    const { bytesRead } = await handle.read(buf, 0, readLen, 0);
    const data = buf.subarray(0, bytesRead);

    const packets: Buffer[] = [];
    let currentChunks: Buffer[] = [];
    let offset = 0;

    while (offset + 27 <= data.length && packets.length < 2) {
      if (data.toString('latin1', offset, offset + 4) !== 'OggS') break;
      const pageSegments = data[offset + 26]!;
      const segTableStart = offset + 27;
      if (segTableStart + pageSegments > data.length) return null;
      const segTable = data.subarray(segTableStart, segTableStart + pageSegments);
      let pos = segTableStart + pageSegments;

      for (let i = 0; i < pageSegments; i++) {
        const segLen = segTable[i]!;
        if (pos + segLen > data.length) return null;
        currentChunks.push(data.subarray(pos, pos + segLen));
        pos += segLen;
        if (segLen < 255) {
          packets.push(Buffer.concat(currentChunks));
          currentChunks = [];
          if (packets.length >= 2) break;
        }
      }
      offset = pos;
    }

    return packets.length >= 2 ? packets : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

interface OggLoopBefund {
  lesbar: boolean;
  loopStart?: number;
  loopLength?: number;
}

/** Parst ausschließlich den Vorbis-Comment-Header (Paket 2) — kein Audio-Decoding. */
async function parseVorbisLoopTags(absPath: string): Promise<OggLoopBefund> {
  const packets = await readFirstTwoOggPackets(absPath);
  if (!packets) return { lesbar: false };
  const comment = packets[1]!;
  if (comment.length < 7 || comment[0] !== 0x03) return { lesbar: false };
  if (comment.toString('ascii', 1, 7) !== 'vorbis') return { lesbar: false };

  let p = 7;
  if (p + 4 > comment.length) return { lesbar: false };
  const vendorLen = comment.readUInt32LE(p);
  p += 4;
  if (p + vendorLen > comment.length) return { lesbar: false };
  p += vendorLen;
  if (p + 4 > comment.length) return { lesbar: false };
  const commentCount = comment.readUInt32LE(p);
  p += 4;

  let loopStart: number | undefined;
  let loopLength: number | undefined;

  for (let i = 0; i < commentCount; i++) {
    if (p + 4 > comment.length) break;
    const len = comment.readUInt32LE(p);
    p += 4;
    if (p + len > comment.length) break;
    const str = comment.toString('utf8', p, p + len);
    p += len;
    const eq = str.indexOf('=');
    if (eq < 0) continue;
    const key = str.slice(0, eq).toUpperCase();
    const val = str.slice(eq + 1);
    if (key === 'LOOPSTART') {
      const n = Number(val);
      if (Number.isFinite(n)) loopStart = n;
    } else if (key === 'LOOPLENGTH') {
      const n = Number(val);
      if (Number.isFinite(n)) loopLength = n;
    }
  }

  const extra: { loopStart?: number; loopLength?: number } = {};
  if (loopStart !== undefined) extra.loopStart = loopStart;
  if (loopLength !== undefined) extra.loopLength = loopLength;
  return { lesbar: true, ...extra };
}

// --- Testlauf ----------------------------------------------------------------

describe.skipIf(!available)('Realdaten: Audio-Struktur (audio.dat/audio.fmt/OGG)', () => {
  it(
    'Audio-Struktur: Bestandsaufnahme, Eintragstabelle, Loop-Tags, Musikindex',
    { timeout: 900_000 },
    async () => {
      const alle = await walkAll(REAL_DIR);

      const audioDatFmt = alle.filter((f) => /^audio\.(dat|fmt)$/i.test(basenamePosix(f.rel)));
      const oggDateien = alle.filter((f) => /\.ogg$/i.test(f.rel));

      if (audioDatFmt.length === 0 && oggDateien.length === 0) {
        console.log(
          'Audio-Struktur: keine audio.dat/audio.fmt/OGG-Dateien gefunden — gültiger Negativbefund.',
          JSON.stringify({ durchsuchtesVerzeichnis: REAL_DIR, gesamtdateien: alle.length }),
        );
        expect(true).toBe(true);
        return;
      }

      // --- M1: Bestandsaufnahme ------------------------------------------

      const datFmtInventar = await Promise.all(
        audioDatFmt.map(async (f) => ({
          pfad: f.rel,
          groesse: f.groesse,
          einstufung: isOverlay(f.rel) ? ('overlay' as const) : ('original' as const),
          sha256: await sha256Hex(await readFile(f.abs)),
        })),
      );

      const oggGruppen = new Map<string, Datei[]>();
      for (const f of oggDateien) {
        const dir = dirOfPosix(f.rel);
        const liste = oggGruppen.get(dir) ?? [];
        liste.push(f);
        oggGruppen.set(dir, liste);
      }
      const oggVerzeichnisInventar = [...oggGruppen.entries()]
        .map(([verzeichnis, dateien]) => ({
          verzeichnis,
          einstufung: isOverlay(verzeichnis) ? ('overlay' as const) : ('original' as const),
          anzahl: dateien.length,
          groessenverteilung: summen(dateien.map((d) => d.groesse)),
        }))
        .sort((a, b) => a.verzeichnis.localeCompare(b.verzeichnis));

      // --- M2: audio.fmt als Eintragstabelle -------------------------------

      const pickOriginal = (namePattern: RegExp): Datei | undefined => {
        const kandidaten = audioDatFmt.filter((f) => namePattern.test(basenamePosix(f.rel)));
        return kandidaten.find((f) => !isOverlay(f.rel)) ?? kandidaten[0];
      };
      const fmtEntry = pickOriginal(/\.fmt$/i);
      const datEntry = pickOriginal(/\.dat$/i);

      let m2: M2Ergebnis;
      if (fmtEntry && datEntry) {
        const fmtBytes = await readFile(fmtEntry.abs);
        m2 = computeM2(fmtBytes, datEntry.groesse);
      } else {
        m2 = {
          verfuegbar: false,
          dateigroesseFmt: fmtEntry?.groesse ?? null,
          dateigroesseDat: datEntry?.groesse ?? null,
          geprueftEintragsgroessenVon: 4,
          geprueftEintragsgroessenBis: 128,
          aufgehendeEintragsgroessen: [],
          kombinationenGeprueftGesamt: 0,
          top5: [],
        };
      }

      // --- M3: OGG-Loop-Tags ------------------------------------------------

      let m3Lesbar = 0;
      let m3Unlesbar = 0;
      let m3MitLoopStart = 0;
      let m3MitLoopLength = 0;
      let m3MitBeiden = 0;
      const loopStartWerte: number[] = [];
      const loopLengthWerte: number[] = [];

      for (const f of oggDateien) {
        const befund = await parseVorbisLoopTags(f.abs);
        if (!befund.lesbar) {
          m3Unlesbar++;
          continue;
        }
        m3Lesbar++;
        if (befund.loopStart !== undefined) {
          m3MitLoopStart++;
          loopStartWerte.push(befund.loopStart);
        }
        if (befund.loopLength !== undefined) {
          m3MitLoopLength++;
          loopLengthWerte.push(befund.loopLength);
        }
        if (befund.loopStart !== undefined && befund.loopLength !== undefined) m3MitBeiden++;
      }

      const m3 = {
        dateienGesamt: oggDateien.length,
        lesbar: m3Lesbar,
        unlesbar: m3Unlesbar,
        anteilMitLoopStart: oggDateien.length > 0 ? m3MitLoopStart / oggDateien.length : 0,
        anteilMitLoopLength: oggDateien.length > 0 ? m3MitLoopLength / oggDateien.length : 0,
        anteilMitBeiden: oggDateien.length > 0 ? m3MitBeiden / oggDateien.length : 0,
        loopStartWertebereich: summen(loopStartWerte),
        loopLengthWertebereich: summen(loopLengthWerte),
      };

      // --- M4: Musikindex-Zuordnung (H1 + H2) -------------------------------

      const audioVerzeichnisse = new Set<string>();
      for (const f of audioDatFmt) audioVerzeichnisse.add(dirOfPosix(f.rel));
      for (const dir of oggGruppen.keys()) audioVerzeichnisse.add(dir);
      audioVerzeichnisse.add('data');
      audioVerzeichnisse.add('music');

      const listenKandidaten = alle.filter(
        (f) => /\.(txt|lst|cfg)$/i.test(f.rel) && audioVerzeichnisse.has(dirOfPosix(f.rel)),
      );
      const h1Listen = await Promise.all(
        listenKandidaten.map(async (f) => {
          const inhalt = await readFile(f.abs, 'utf8').catch(() => null);
          const zeilen = inhalt === null ? null : inhalt.split(/\r\n|\r|\n/).length;
          return { pfad: f.rel, groesse: f.groesse, zeilen };
        }),
      );

      let h2ReinNumerisch = 0;
      let h2BeginntMitZiffer = 0;
      let h2ReinAlphabetisch = 0;
      for (const f of oggDateien) {
        const name = basenamePosix(f.rel).replace(/\.ogg$/i, '');
        if (/^[0-9]+$/.test(name)) h2ReinNumerisch++;
        if (/^[0-9]/.test(name)) h2BeginntMitZiffer++;
        if (/^[a-zA-Z]+$/.test(name)) h2ReinAlphabetisch++;
      }

      const m4 = {
        h1KleineListendateien: h1Listen,
        h1Traegt: h1Listen.length > 0,
        h2Namensschema: {
          dateienGesamt: oggDateien.length,
          reinNumerisch: h2ReinNumerisch,
          beginntMitZiffer: h2BeginntMitZiffer,
          reinAlphabetisch: h2ReinAlphabetisch,
        },
      };

      const output = {
        durchsuchtesVerzeichnis: REAL_DIR,
        gesamtdateienImInstallationsverzeichnis: alle.length,
        m1Bestandsaufnahme: {
          audioDatFmt: datFmtInventar,
          oggVerzeichnisse: oggVerzeichnisInventar,
        },
        m2AudioFmtEintragstabelle: m2,
        m3OggLoopTags: m3,
        m4Musikindex: m4,
      };

      console.log('Audio-Struktur:', JSON.stringify(output, null, 2));

      expect(true).toBe(true);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
