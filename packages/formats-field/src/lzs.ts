/**
 * LZS-Dekompression (Masterplan Phase 1.1, Formatmatrix):
 * 🟢 LZSS-Variante mit 4096-Byte-Ringpuffer, Steuerbyte mit 8 Flags (LSB
 * zuerst), Flag 1 = Literal, Flag 0 = 2-Byte-Referenz (12 Bit absolute
 * Ringposition + 4 Bit Länge−3).
 * 🟡 Zu validieren: Ring-Initialisierung (hier 0x00) und Startschreibposition
 * 0xFEE — beides dokumentierte Konvention, per Realdaten-Diagnosescan prüfbar.
 */

export const LZS_WINDOW = 4096;
export const LZS_WINDOW_MASK = LZS_WINDOW - 1;
export const LZS_INITIAL_POS = 0x0fee;
export const LZS_MIN_MATCH = 3;
export const LZS_MAX_MATCH = 18;

/** Default-Obergrenze der Ausgabe — Schutz gegen Dekompressionsbomben. */
export const LZS_DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;

export class LzsError extends Error {
  readonly code = 'E-LZS-STREAM' as const;
  constructor(detail: string) {
    super(`E-LZS-STREAM: ${detail}`);
  }
}

export interface LzsOptions {
  maxOutput?: number;
  signal?: AbortSignal | undefined;
}

/** Dekomprimiert einen rohen LZS-Strom (ohne u32-Längenvorsatz). */
export function decompressLzs(input: Uint8Array, opts: LzsOptions = {}): Uint8Array {
  const maxOutput = opts.maxOutput ?? LZS_DEFAULT_MAX_OUTPUT;
  const ring = new Uint8Array(LZS_WINDOW);
  let ringPos = LZS_INITIAL_POS;
  let out = new Uint8Array(Math.min(maxOutput, Math.max(64, input.length * 4)));
  let outLen = 0;

  const emit = (b: number): void => {
    if (outLen >= maxOutput) throw new LzsError(`Ausgabe überschreitet Limit ${maxOutput} B`);
    if (outLen >= out.length) {
      const grown = new Uint8Array(Math.min(maxOutput, out.length * 2));
      grown.set(out);
      out = grown;
    }
    out[outLen++] = b;
    ring[ringPos] = b;
    ringPos = (ringPos + 1) & LZS_WINDOW_MASK;
  };

  let i = 0;
  while (i < input.length) {
    opts.signal?.throwIfAborted();
    const control = input[i++]!;
    for (let bit = 0; bit < 8 && i < input.length; bit++) {
      if (control & (1 << bit)) {
        emit(input[i++]!);
      } else {
        if (i + 2 > input.length) throw new LzsError('Referenz-Token am Stromende abgeschnitten');
        const lo = input[i++]!;
        const hi = input[i++]!;
        const offset = lo | ((hi & 0xf0) << 4);
        const len = (hi & 0x0f) + LZS_MIN_MATCH;
        for (let k = 0; k < len; k++) emit(ring[(offset + k) & LZS_WINDOW_MASK]!);
      }
    }
  }
  return out.slice(0, outLen);
}

/**
 * Dekomprimiert einen Archiveintrag im LZS-Rahmenformat:
 * 🟢 u32 komprimierte Länge + Strom dieser Länge.
 */
export function decompressLzsEntry(bytes: Uint8Array, opts: LzsOptions = {}): Uint8Array {
  if (bytes.length < 4) throw new LzsError('Eintrag kürzer als Längenvorsatz');
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + declared > bytes.length) {
    throw new LzsError(`Deklarierte Länge ${declared} überschreitet Eintragsgröße ${bytes.length - 4}`);
  }
  return decompressLzs(bytes.subarray(4, 4 + declared), opts);
}
