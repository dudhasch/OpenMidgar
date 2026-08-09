/**
 * `kernel.bin`-Composer für Golden Fixtures — codegetrennt vom Parser in
 * formats-kernel (Dualitätsprinzip). Schreibt beide Kopfauslegungen, damit
 * Tests belegen können, dass der Parser die richtige selbst erkennt.
 */

export type KernelHeaderLayout = 'u16-triple' | 'u32-len';

export interface KernelSectionSpec {
  data: Uint8Array;
  /** Drittes Kopffeld (Dateityp); im Original nicht sicher gedeutet. */
  typeRaw?: number | undefined;
  /** Absichtlich falsche entpackte Länge im Kopf (Defektfixture). */
  declaredLengthOverride?: number | undefined;
}

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

export async function composeKernelContainer(
  sections: readonly KernelSectionSpec[],
  layout: KernelHeaderLayout = 'u16-triple',
): Promise<Uint8Array> {
  const packed = await Promise.all(sections.map(async (s) => ({ spec: s, gz: await gzip(s.data) })));
  const total = packed.reduce((sum, p) => sum + 6 + p.gz.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (const { spec, gz } of packed) {
    if (layout === 'u16-triple') {
      view.setUint16(o, gz.length, true);
      view.setUint16(o + 2, spec.declaredLengthOverride ?? spec.data.length, true);
      view.setUint16(o + 4, spec.typeRaw ?? 0, true);
    } else {
      view.setUint32(o, gz.length, true);
      view.setUint16(o + 4, spec.typeRaw ?? 0, true);
    }
    bytes.set(gz, o + 6);
    o += 6 + gz.length;
  }
  return bytes;
}

/**
 * Baut eine Textsektion: `count` u16-Zeiger (relativ zum Tabellenanfang),
 * danach die kodierten Zeichenketten. Die Kodierung ist der lineare
 * ASCII-Versatz, den der Dekoder als Hypothese führt.
 */
export function composeTextSection(strings: readonly string[], asciiOffset = 0x20): Uint8Array {
  const encoded = strings.map((s) => {
    const out = new Uint8Array(s.length + 1);
    for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) - asciiOffset) & 0xff;
    out[s.length] = 0xff; // Terminator
    return out;
  });
  const tableLen = strings.length * 2;
  const total = tableLen + encoded.reduce((n, e) => n + e.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let at = tableLen;
  encoded.forEach((e, i) => {
    view.setUint16(i * 2, at, true);
    bytes.set(e, at);
    at += e.length;
  });
  return bytes;
}
