/**
 * gzip-Entpacker über `DecompressionStream` — bewusst **nicht** `node:zlib`:
 * derselbe Code muss im Browser laufen. Deshalb ist jeder Aufrufer asynchron.
 *
 * Gemeinsam genutzt von `kernel.bin` (Sektionscontainer) und `WINDOW.BIN`.
 */
export async function gunzip(chunk: Uint8Array): Promise<Uint8Array> {
  // Kopie in einen eigenen ArrayBuffer: `subarray` kann auf einen
  // SharedArrayBuffer zeigen, den Blob nicht annimmt.
  const owned = new Uint8Array(chunk.length);
  owned.set(chunk);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value as Uint8Array;
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
