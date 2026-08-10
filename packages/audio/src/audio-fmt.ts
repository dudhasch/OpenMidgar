/**
 * `data/sound/audio.fmt` — die Bereichstabelle zu `audio.dat` (O1, S38).
 *
 * **Was hier neu ist gegenüber dem Stand von O1.** O1 hat den Eintrag richtig
 * aufgelöst (24 B Kopf aus sechs `uint32`, dann ein `ADPCMWAVEFORMAT`), aber
 * die Datei als **Feld gleich großer Einträge** gelesen. Das ist sie nicht.
 * Deshalb brach der Durchlauf bei Eintrag 198 ab und erklärte nur 32,4 % von
 * `audio.dat`; die restlichen 48,5 MB galten als unadressiert.
 *
 * **Tatsächliches Layout.** `audio.fmt` ist eine Folge von **Abschnitten**
 * („Bänke"). Jeder Abschnitt ist eine Folge von Klangsätzen und endet mit
 * einer **Abschlussmarke**:
 *
 * ```text
 * Klangsatz     74 B = 24 B Kopf + 18 B WAVEFORMATEX + cbSize (32) B ADPCM-Zusatz
 * Abschlussmarke 42 B = 24 B Kopf + 18 B WAVEFORMATEX (nie gefüllt)
 * ```
 *
 * Unterschieden werden beide am **Längenfeld**: `Length == 0` ist die
 * Abschlussmarke, ihr `Offset` trägt den Schreibstand in `audio.dat` am Ende
 * des Abschnitts. Ein Klangsatz hat immer `Length > 0`.
 *
 * **Warum das als belegt gilt — Accounting, nicht Quote.** Mit dieser Regel
 * verbraucht der Durchlauf `audio.fmt` **byteexakt** (724 × 74 + 26 × 42 =
 * 54.668, Rest 0), und die 724 Klangsätze überdecken `audio.dat`
 * **lückenlos und überlappungsfrei von 0 bis 71.738.528 — 100,0000 %**.
 * Eine falsche Satzgröße erzeugt sofort Löcher oder einen Rest.
 *
 * **Die Lehre, diesmal wörtlich dieselbe wie bei O1.** Die Antwort stand
 * schon in der Rechnung: `54.668 mod 74 = 56`. Ein reines 74-B-Raster kann
 * die Datei gar nicht füllen — 56 Byte blieben übrig und wurden als „Rest"
 * abgelegt. 56 ist genau `26 × 42 mod 74`; der unerklärte Rest war der
 * Fingerabdruck der 26 Abschlussmarken. Ebenso stand im Abstandshistogramm
 * von O1-alt 87,1 % statt ~100 % bei Abstand 74 — auch das sagte „das Raster
 * bricht", und auch das wurde nicht befragt.
 *
 * Dieses Modul dekodiert **kein** Audio. Es liefert Bereiche und
 * Formatangaben; der MS-ADPCM-Dekoder ist ausdrücklich nicht Teil davon.
 */

/** Kopf eines Satzes: sechs `uint32`. */
export const RECORD_HEADER_BYTES = 24;
/** `WAVEFORMATEX` ohne Zusatzdaten. */
export const WAVEFORMATEX_BYTES = 18;
/** Kürzestmöglicher Satz — und exakt die Größe einer Abschlussmarke. */
export const TERMINATOR_BYTES = RECORD_HEADER_BYTES + WAVEFORMATEX_BYTES;
/** `cbSize` eines `ADPCMWAVEFORMAT` mit sieben Koeffizientenpaaren. */
export const ADPCM_EXTRA_BYTES = 32;
/** 24 + 18 + 32 — die in O1-alt hypothesenfrei gemessene Satzgröße. */
export const ADPCM_RECORD_BYTES = TERMINATOR_BYTES + ADPCM_EXTRA_BYTES;

/** `WAVE_FORMAT_ADPCM` (Microsoft ADPCM). */
export const WAVE_FORMAT_ADPCM = 2;

export interface AdpcmFormat {
  /** `wFormatTag` — im Bestand ausnahmslos 2. */
  formatTag: number;
  channels: number;
  samplesPerSec: number;
  avgBytesPerSec: number;
  blockAlign: number;
  bitsPerSample: number;
  cbSize: number;
  /** `wSamplesPerBlock` aus dem ADPCM-Zusatz. */
  samplesPerBlock: number;
  /** `wNumCoef` — Anzahl der Prädiktorpaare; begrenzt den Prädiktorindex. */
  numCoef: number;
  /** Die `wNumCoef` Koeffizientenpaare, so wie sie in der Datei stehen. */
  coefficients: ReadonlyArray<readonly [number, number]>;
}

export interface SoundEntry {
  /** Laufende Nummer über alle Bänke hinweg, Abschlussmarken übersprungen. */
  index: number;
  bank: number;
  indexInBank: number;
  /** Byteposition des Satzes in `audio.fmt` — für Diagnosen. */
  recordAt: number;
  /** Bereich in `audio.dat`. */
  offset: number;
  length: number;
  /** Schleifenschalter (Feld +8): im Bestand nur 0 oder 1. */
  loop: number;
  /** Feld +12. Im Bestand ausnahmslos 0 — Bedeutung unbelegt (🔴). */
  reserved: number;
  /** Schleifenanfang, Byteversatz im **dekodierten** PCM16-Strom. */
  loopStart: number;
  /** Schleifenende, Byteversatz im **dekodierten** PCM16-Strom. */
  loopEnd: number;
  format: AdpcmFormat;
}

export interface SoundBank {
  index: number;
  /** Sätze dieser Bank in Dateireihenfolge. */
  entries: SoundEntry[];
  /** `Offset` der Abschlussmarke = Schreibstand in `audio.dat` am Bankende. */
  dataEnd: number;
  /** Byteposition der Abschlussmarke in `audio.fmt`. */
  terminatorAt: number;
}

export interface AudioFmtDiagnostic {
  code:
    | 'E-AFMT-TRUNC'
    | 'E-AFMT-REST'
    | 'E-AFMT-NOTERM'
    | 'W-AFMT-FORMAT'
    | 'W-AFMT-BANKEND';
  message: string;
  at?: number;
}

export interface AudioFmtTable {
  banks: SoundBank[];
  /** Alle Klangsätze in Dateireihenfolge; der Index ist `SoundEntry.index`. */
  entries: SoundEntry[];
  /** Verbrauchte Bytes des Durchlaufs. Gleich `bytes.length`, wenn alles aufgeht. */
  consumed: number;
  diagnostics: AudioFmtDiagnostic[];
}

function readFormat(view: DataView, at: number): AdpcmFormat {
  const cbSize = view.getUint16(at + 16, true);
  const coefficients: Array<readonly [number, number]> = [];
  let numCoef = 0;
  let samplesPerBlock = 0;
  if (cbSize >= 4 && at + 18 + 4 <= view.byteLength) {
    samplesPerBlock = view.getUint16(at + 18, true);
    numCoef = view.getUint16(at + 20, true);
    for (let i = 0; i < numCoef; i++) {
      const p = at + 22 + i * 4;
      if (p + 4 > view.byteLength || p + 4 > at + 18 + cbSize) break;
      coefficients.push([view.getInt16(p, true), view.getInt16(p + 2, true)]);
    }
  }
  return {
    formatTag: view.getUint16(at, true),
    channels: view.getUint16(at + 2, true),
    samplesPerSec: view.getUint32(at + 4, true),
    avgBytesPerSec: view.getUint32(at + 8, true),
    blockAlign: view.getUint16(at + 12, true),
    bitsPerSample: view.getUint16(at + 14, true),
    cbSize,
    samplesPerBlock,
    numCoef,
    coefficients,
  };
}

/**
 * Liest `audio.fmt`.
 *
 * Der Durchlauf ist **selbstbegrenzend**: Er liest den 24-B-Kopf, entscheidet
 * am Längenfeld zwischen Klangsatz und Abschlussmarke und schreitet um die
 * daraus folgende Satzgröße weiter. Bleibt am Ende ein Rest, ist die Auslegung
 * falsch — deshalb wird er als Diagnose gemeldet und nicht verschwiegen.
 */
export function parseAudioFmt(bytes: Uint8Array): AudioFmtTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const diagnostics: AudioFmtDiagnostic[] = [];
  const banks: SoundBank[] = [];
  const entries: SoundEntry[] = [];

  let at = 0;
  let current: SoundEntry[] = [];
  let index = 0;

  while (at + TERMINATOR_BYTES <= bytes.length) {
    const length = view.getUint32(at, true);
    const offset = view.getUint32(at + 4, true);

    if (length === 0) {
      // Abschlussmarke. Ihre 18 WAVEFORMATEX-Bytes wurden nie beschrieben
      // (im Bestand MSVC-Füllmuster 0xCD) und werden bewusst nicht gelesen.
      banks.push({ index: banks.length, entries: current, dataEnd: offset, terminatorAt: at });
      const last = current[current.length - 1];
      if (last && last.offset + last.length !== offset) {
        diagnostics.push({
          code: 'W-AFMT-BANKEND',
          at,
          message: `Abschlussmarke ${offset} ≠ Ende des letzten Satzes ${last.offset + last.length}`,
        });
      }
      current = [];
      at += TERMINATOR_BYTES;
      continue;
    }

    const format = readFormat(view, at + RECORD_HEADER_BYTES);
    const size = TERMINATOR_BYTES + format.cbSize;
    if (at + size > bytes.length) {
      diagnostics.push({
        code: 'E-AFMT-TRUNC',
        at,
        message: `Satz mit cbSize ${format.cbSize} reicht über das Dateiende hinaus`,
      });
      break;
    }
    if (format.formatTag !== WAVE_FORMAT_ADPCM) {
      diagnostics.push({
        code: 'W-AFMT-FORMAT',
        at,
        message: `wFormatTag ${format.formatTag} ≠ ${WAVE_FORMAT_ADPCM} (MS-ADPCM)`,
      });
    }

    const entry: SoundEntry = {
      index,
      bank: banks.length,
      indexInBank: current.length,
      recordAt: at,
      offset,
      length,
      loop: view.getUint32(at + 8, true),
      reserved: view.getUint32(at + 12, true),
      loopStart: view.getUint32(at + 16, true),
      loopEnd: view.getUint32(at + 20, true),
      format,
    };
    index++;
    current.push(entry);
    entries.push(entry);
    at += size;
  }

  if (current.length > 0) {
    diagnostics.push({
      code: 'E-AFMT-NOTERM',
      at,
      message: `${current.length} Sätze ohne Abschlussmarke am Dateiende`,
    });
    banks.push({ index: banks.length, entries: current, dataEnd: -1, terminatorAt: -1 });
  }
  if (at !== bytes.length) {
    diagnostics.push({
      code: 'E-AFMT-REST',
      at,
      message: `${bytes.length - at} Byte hinter dem letzten Satz unverbucht`,
    });
  }

  return { banks, entries, consumed: at, diagnostics };
}

// --- Accounting ------------------------------------------------------------

export interface AudioDatAudit {
  datBytes: number;
  /** Summe aller `Length`-Felder. */
  referenced: number;
  /** Tatsächlich überdeckte Bytes (Überlappungen nur einmal gezählt). */
  covered: number;
  gaps: number;
  gapBytes: number;
  overlaps: number;
  overlapBytes: number;
  /** Sätze, deren Bereich über das Dateiende hinausreicht. */
  outside: number;
  startsAtZero: boolean;
  endsAtEof: boolean;
  /** Der Wahrheitstest: lückenlos, überlappungsfrei, von 0 bis EOF. */
  exact: boolean;
}

/**
 * Der Wahrheitstest des Projekts: Bereiche + Lücken müssen `audio.dat`
 * byteexakt füllen. Ohne diese Rechnung gilt hier nichts als gelöst.
 */
export function auditAudioDat(table: AudioFmtTable, datBytes: number): AudioDatAudit {
  const sorted = [...table.entries].sort((a, b) => a.offset - b.offset);
  let referenced = 0;
  let covered = 0;
  let gaps = 0;
  let gapBytes = 0;
  let overlaps = 0;
  let overlapBytes = 0;
  let outside = 0;
  let cursor = 0;
  for (const e of sorted) {
    referenced += e.length;
    if (e.offset > cursor) {
      gaps++;
      gapBytes += e.offset - cursor;
    } else if (e.offset < cursor) {
      overlaps++;
      overlapBytes += Math.min(cursor, e.offset + e.length) - e.offset;
    }
    if (e.offset + e.length > datBytes) outside++;
    const end = e.offset + e.length;
    if (end > cursor) {
      covered += end - Math.max(cursor, e.offset);
      cursor = end;
    }
  }
  const startsAtZero = sorted.length > 0 && sorted[0]!.offset === 0;
  const endsAtEof = cursor === datBytes;
  return {
    datBytes,
    referenced,
    covered,
    gaps,
    gapBytes,
    overlaps,
    overlapBytes,
    outside,
    startsAtZero,
    endsAtEof,
    exact: startsAtZero && endsAtEof && gaps === 0 && overlaps === 0 && outside === 0,
  };
}

// --- Abgeleitete Größen ----------------------------------------------------

/**
 * `wSamplesPerBlock` aus `nBlockAlign` — die Formel, die Microsoft für
 * MS-ADPCM festlegt. Sie ist hier **Vorhersage**, nicht Bequemlichkeit: Sie
 * trifft im Bestand 724/724 und bestätigt damit die Lage des ADPCM-Zusatzes
 * unabhängig vom Accounting.
 */
export function predictSamplesPerBlock(format: AdpcmFormat): number {
  const { blockAlign, channels, bitsPerSample } = format;
  return ((blockAlign - 7 * channels) * 8) / (bitsPerSample * channels) + 2;
}

/** Anzahl ADPCM-Blöcke eines Bereichs; der letzte Block darf angebrochen sein. */
export function blockCount(entry: SoundEntry): number {
  return Math.ceil(entry.length / entry.format.blockAlign);
}

/** Gesamtzahl der Frames (Samples je Kanal) eines Bereichs. */
export function frameCount(entry: SoundEntry): number {
  return blockCount(entry) * entry.format.samplesPerBlock;
}

/**
 * Schleifenmarken in Frames.
 *
 * `loopStart`/`loopEnd` stehen als Byteversatz im **dekodierten** PCM16-Strom
 * in der Datei. Belegt ist das über eine Vorhersage mit Kontrolle: Als Frames
 * gelesen (`/ 2 / Kanalzahl`) liegen beide Marken in 90/90 Fällen innerhalb
 * der Frameanzahl; ohne den Faktor 2 in 0/90.
 */
export function loopFrames(entry: SoundEntry): { start: number; end: number } | null {
  if (entry.loop === 0) return null;
  const div = 2 * Math.max(1, entry.format.channels);
  return { start: Math.floor(entry.loopStart / div), end: Math.floor(entry.loopEnd / div) };
}
