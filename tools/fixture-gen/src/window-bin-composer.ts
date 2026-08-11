/**
 * `WINDOW.BIN`-Composer für Golden Fixtures — codegetrennt vom Parser in
 * formats-kernel (Dualitätsprinzip: Schreiber und Leser dürfen sich keine
 * Implementierung teilen, sonst prüft ein Test nur sich selbst).
 *
 * Erzeugt wird die vollständige Datei: drei Sektionen mit 6-Byte-Kopf und
 * gzip-Strom, dahinter der 2-Byte-Nullrest wie im Original.
 */

async function gzip(chunk: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(chunk.length);
  owned.set(chunk);
  const stream = new Blob([owned]).stream().pipeThrough(new CompressionStream('gzip'));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = new Uint8Array(value as ArrayBufferView as Uint8Array);
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface TimSpec {
  /** Bildbreite in Pixeln (Vielfaches von 4 bei 4 bpp). */
  width: number;
  height: number;
  /** Palettenfarben als BGR555; Länge = clutWidth × clutHeight. */
  clut: Uint16Array;
  clutWidth: number;
  clutHeight: number;
  /** Ein Byte je Pixel (0–15). */
  indices: Uint8Array;
}

/** Baut einen 4-bpp-TIM-Block mit CLUT. */
export function composeTim(spec: TimSpec): Uint8Array {
  const clutBytes = spec.clut.length * 2;
  const wUnits = spec.width / 4;
  const pixBytes = wUnits * 2 * spec.height;
  const out = new Uint8Array(8 + 12 + clutBytes + 12 + pixBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x10, true);
  view.setUint32(4, 8, true); // pmode 0 (4 bpp) + CLUT-Bit
  view.setUint32(8, 12 + clutBytes, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint16(16, spec.clutWidth, true);
  view.setUint16(18, spec.clutHeight, true);
  for (let i = 0; i < spec.clut.length; i++) view.setUint16(20 + i * 2, spec.clut[i]!, true);
  const imgAt = 20 + clutBytes;
  view.setUint32(imgAt, 12 + pixBytes, true);
  view.setUint16(imgAt + 4, 0, true);
  view.setUint16(imgAt + 6, 0, true);
  view.setUint16(imgAt + 8, wUnits, true);
  view.setUint16(imgAt + 10, spec.height, true);
  for (let i = 0; i < pixBytes; i++) {
    const lo = spec.indices[i * 2] ?? 0;
    const hi = spec.indices[i * 2 + 1] ?? 0;
    out[imgAt + 12 + i] = (lo & 0x0f) | ((hi & 0x0f) << 4);
  }
  return out;
}

export interface WindowBinSpec {
  /** Sektion 0 — Fenster-/Menügrafik. */
  windowTim: Uint8Array;
  /** Sektion 1 — Fontblatt. */
  fontTim: Uint8Array;
  /** Sektion 2 — Breitentabelle (256 Rohbytes + Rest). */
  widthSection: Uint8Array;
  /** Nullbytes hinter der letzten Sektion (Original: 2). */
  trailer?: number;
  /** Absichtlich falsche entpackte Länge im Kopf (Defektfixture). */
  declaredOverride?: (number | undefined)[];
}

export async function composeWindowBin(spec: WindowBinSpec): Promise<Uint8Array> {
  const sections = [spec.windowTim, spec.fontTim, spec.widthSection];
  const packed = await Promise.all(sections.map((s) => gzip(s)));
  const trailer = spec.trailer ?? 2;
  const total = packed.reduce((n, p) => n + 6 + p.length, 0) + trailer;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < packed.length; i++) {
    view.setUint16(o, packed[i]!.length, true);
    view.setUint16(o + 2, spec.declaredOverride?.[i] ?? sections[i]!.length, true);
    // Drittes Kopffeld: im Original 0/0/1 — roh übernommen, nicht gedeutet.
    view.setUint16(o + 4, i === 2 ? 1 : 0, true);
    out.set(packed[i]!, o + 6);
    o += 6 + packed[i]!.length;
  }
  return out;
}

/**
 * Ein kleines, aber vollständiges Fixture: Fontblatt mit einer Tintenspur je
 * Zeichen, deren Breite exakt `Breitentabelle − 1` beträgt. Damit lässt sich
 * die Dekodierregel prüfen, ohne Originaldaten anzufassen.
 */
export async function composeWindowBinFixture(
  glyphBytes: Uint8Array,
  opts: { trailer?: number } = {},
): Promise<Uint8Array> {
  const cell = 12;
  const perRow = 21;
  const width = 256;
  const height = 252;
  const indices = new Uint8Array(width * height);
  for (let code = 0; code < 256; code++) {
    const ink = Math.max(0, (glyphBytes[code]! & 0x1f) + (glyphBytes[code]! >> 5) - 1);
    const x0 = (code % perRow) * cell;
    const y0 = Math.floor(code / perRow) * cell;
    if (y0 + cell > height) break;
    for (let x = 0; x < Math.min(ink, cell); x++) indices[(y0 + 1) * width + x0 + x] = 3;
  }
  const fontTim = composeTim({
    width,
    height,
    clut: Uint16Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : 0x7fff)),
    clutWidth: 16,
    clutHeight: 1,
    indices,
  });
  const windowTim = composeTim({
    width: 64,
    height: 64,
    clut: Uint16Array.from({ length: 16 }, (_, i) => i * 0x111),
    clutWidth: 16,
    clutHeight: 1,
    indices: new Uint8Array(64 * 64),
  });
  const widthSection = new Uint8Array(1302);
  widthSection.set(glyphBytes.subarray(0, 256));
  const trailerOpt = opts.trailer;
  return composeWindowBin({
    windowTim,
    fontTim,
    widthSection,
    ...(trailerOpt === undefined ? {} : { trailer: trailerOpt }),
  });
}
