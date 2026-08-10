/**
 * `audio.fmt`-Composer für Golden Fixtures — codegetrennt vom Parser in
 * `packages/audio` (Dualitätsprinzip).
 *
 * Erzeugt genau die Struktur, die aus den Realdaten belegt ist: eine Folge
 * von Bänken, jede Bank eine Folge von 74-B-Klangsätzen, jede Bank durch eine
 * **42-B-Abschlussmarke** beendet (`Length == 0`, `Offset` = Schreibstand).
 *
 * Der Composer schreibt die Abschlussmarke bewusst mit dem MSVC-Füllmuster
 * `0xCD` in den nie beschriebenen WAVEFORMATEX-Teil. Damit prüft der Parser
 * gegen dieselbe Eigenheit wie in den Realdaten: Er darf diese 18 Byte NICHT
 * als Format lesen. Ein Parser, der es doch tut, fällt über die Fixture.
 *
 * Es werden **keine** Audiodaten erzeugt — nur Tabellenbytes.
 */

/** MS-ADPCM-Standardkoeffizienten (7 Paare), wie sie in `audio.fmt` stehen. */
export const MS_ADPCM_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

export interface AudioFmtSoundSpec {
  /** Bytelänge des Bereichs in `audio.dat`; muss > 0 sein. */
  length: number;
  /** 0 = keine Schleife. */
  loop?: number;
  /** Byteversatz im dekodierten PCM16-Strom. */
  loopStart?: number;
  loopEnd?: number;
  channels?: number;
  samplesPerSec?: number;
  blockAlign?: number;
  /** Nur für Fehlerfixtures: weicht vom MS-ADPCM-Tag 2 ab. */
  formatTag?: number;
}

/** Eine Bank ist eine (auch leere) Liste von Klängen. */
export type AudioFmtBankSpec = readonly AudioFmtSoundSpec[];

const HEADER = 24;
const WFX = 18;
const EXTRA = 32;
const RECORD = HEADER + WFX + EXTRA; // 74
const TERMINATOR = HEADER + WFX; // 42

/** `wSamplesPerBlock` nach der Microsoft-Formel — dieselbe wie im Parser. */
function samplesPerBlock(blockAlign: number, channels: number, bits: number): number {
  return ((blockAlign - 7 * channels) * 8) / (bits * channels) + 2;
}

/**
 * Baut `audio.fmt`. Die Offsets in `audio.dat` werden fortlaufend vergeben —
 * genau so, wie es die Realdaten zeigen: lückenlos über alle Bänke hinweg.
 */
export function composeAudioFmt(banks: readonly AudioFmtBankSpec[]): Uint8Array {
  const sounds = banks.reduce((n, b) => n + b.length, 0);
  const bytes = new Uint8Array(sounds * RECORD + banks.length * TERMINATOR);
  const view = new DataView(bytes.buffer);

  let at = 0;
  let dataOffset = 0;
  for (const bank of banks) {
    for (const s of bank) {
      if (s.length <= 0) throw new RangeError('Klangsatz braucht Length > 0');
      const channels = s.channels ?? 1;
      const blockAlign = s.blockAlign ?? 1024 * channels;
      const bits = 4;
      view.setUint32(at, s.length, true);
      view.setUint32(at + 4, dataOffset, true);
      view.setUint32(at + 8, s.loop ?? 0, true);
      view.setUint32(at + 12, 0, true);
      view.setUint32(at + 16, s.loopStart ?? 0, true);
      view.setUint32(at + 20, s.loopEnd ?? 0, true);
      const w = at + HEADER;
      const spb = samplesPerBlock(blockAlign, channels, bits);
      const rate = s.samplesPerSec ?? 44100;
      view.setUint16(w, s.formatTag ?? 2, true);
      view.setUint16(w + 2, channels, true);
      view.setUint32(w + 4, rate, true);
      view.setUint32(w + 8, Math.floor((rate * blockAlign) / spb), true);
      view.setUint16(w + 12, blockAlign, true);
      view.setUint16(w + 14, bits, true);
      view.setUint16(w + 16, EXTRA, true);
      view.setUint16(w + 18, spb, true);
      view.setUint16(w + 20, MS_ADPCM_COEFFICIENTS.length, true);
      MS_ADPCM_COEFFICIENTS.forEach(([a, b], i) => {
        view.setInt16(w + 22 + i * 4, a, true);
        view.setInt16(w + 24 + i * 4, b, true);
      });
      dataOffset += s.length;
      at += RECORD;
    }
    // Abschlussmarke: Kopf gefüllt, WAVEFORMATEX uninitialisiert (0xCD).
    view.setUint32(at, 0, true);
    view.setUint32(at + 4, dataOffset, true);
    for (let k = 8; k < HEADER; k++) bytes[at + k] = 0;
    bytes.fill(0xcd, at + HEADER, at + TERMINATOR);
    at += TERMINATOR;
  }
  return bytes;
}

/**
 * Baut die zu einer Fixture passenden `audio.dat`-Bytes: je ADPCM-Block ein
 * gültiger Prädiktorindex (< 7) am Blockanfang, der Rest deterministisch
 * gefüllt. Damit lässt sich der Prädiktortest der Realdatenprobe auch als
 * Fixture-Test fahren — **ohne** echte Audiodaten.
 */
export function composeAudioDat(banks: readonly AudioFmtBankSpec[]): Uint8Array {
  const total = banks.reduce((n, b) => n + b.reduce((m, s) => m + s.length, 0), 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  let seed = 1;
  for (const bank of banks) {
    for (const s of bank) {
      const channels = s.channels ?? 1;
      const blockAlign = s.blockAlign ?? 1024 * channels;
      for (let k = 0; k < s.length; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        bytes[at + k] = k % blockAlign === 0 ? (seed >>> 24) % 7 : (seed >>> 16) & 0xff;
      }
      at += s.length;
    }
  }
  return bytes;
}
