import {
  LZS_INITIAL_POS,
  LZS_MAX_MATCH,
  LZS_MIN_MATCH,
  LZS_WINDOW,
  LZS_WINDOW_MASK,
} from '@webmidgar/formats-field';

/**
 * Greedy-LZS-Kompressor — nur für Golden Fixtures. Erzeugt gültige Ströme mit
 * echten Referenz-Tokens (Ring-Pfad des Dekoders wird mitgetestet), optimiert
 * nicht auf Kompressionsrate. Bewusst codegetrennt vom Dekoder in
 * formats-field (unabhängige Implementierungen, Roundtrip als Beweis).
 */

export function compressLzs(input: Uint8Array): Uint8Array {
  const ring = new Uint8Array(LZS_WINDOW);
  let ringPos = LZS_INITIAL_POS;
  const out: number[] = [];
  let i = 0;

  const push = (b: number): void => {
    ring[ringPos] = b;
    ringPos = (ringPos + 1) & LZS_WINDOW_MASK;
  };

  while (i < input.length) {
    const controlIndex = out.length;
    out.push(0);
    let control = 0;
    for (let bit = 0; bit < 8 && i < input.length; bit++) {
      const match = findMatch(input, i, ring, ringPos);
      if (match) {
        const hi = ((match.offset >> 4) & 0xf0) | (match.length - LZS_MIN_MATCH);
        out.push(match.offset & 0xff, hi);
        for (let k = 0; k < match.length; k++) push(input[i + k]!);
        i += match.length;
      } else {
        control |= 1 << bit;
        out.push(input[i]!);
        push(input[i]!);
        i++;
      }
    }
    out[controlIndex] = control;
  }
  return new Uint8Array(out);
}

/** Rahmenformat eines Archiveintrags: u32 komprimierte Länge + Strom. */
export function compressLzsEntry(input: Uint8Array): Uint8Array {
  const stream = compressLzs(input);
  const entry = new Uint8Array(4 + stream.length);
  new DataView(entry.buffer).setUint32(0, stream.length, true);
  entry.set(stream, 4);
  return entry;
}

function findMatch(
  input: Uint8Array,
  i: number,
  ring: Uint8Array,
  ringPos: number,
): { offset: number; length: number } | null {
  const maxLen = Math.min(LZS_MAX_MATCH, input.length - i);
  if (maxLen < LZS_MIN_MATCH) return null;
  let best: { offset: number; length: number } | null = null;
  const erstesByte = input[i]!;
  for (let offset = 0; offset < LZS_WINDOW; offset++) {
    // Früher Ausstieg ohne Verhaltensänderung: passt schon das erste Byte
    // nicht, wird `len` 0 und der Kandidat scheitert ohnehin an
    // `len >= LZS_MIN_MATCH`. Der Test spart den inneren Vergleich für ~255
    // von 256 Kandidaten — gemessen 1,8 s → 30 ms je 64-KiB-Seite beim Bau
    // der NFR-Fixtures. Die erzeugten Ströme sind byteidentisch.
    if (ring[offset] !== erstesByte) continue;
    // Kandidat verwerfen, wenn der Lesebereich in den während des Tokens
    // beschriebenen Bereich fällt (konservativ; hält Encoder trivial korrekt).
    const distance = (offset - ringPos + LZS_WINDOW) & LZS_WINDOW_MASK;
    let len = 0;
    while (len < maxLen && ring[(offset + len) & LZS_WINDOW_MASK] === input[i + len]) len++;
    const noOverlap = distance >= len && distance <= LZS_WINDOW - len; // auch Wrap-Fall ausschließen
    if (len >= LZS_MIN_MATCH && noOverlap && (!best || len > best.length)) {
      best = { offset, length: len };
      if (len === maxLen) break;
    }
  }
  return best;
}
