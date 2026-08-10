/**
 * Isomorphes SHA-256 über `globalThis.crypto.subtle` — lauffähig in
 * Node ≥ 20 (WebCrypto-Global) und im Browser, ohne weitere Dependency
 * (A-ST-3: Integritäts-Hashes des `.wmmod`-Pakets).
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Eigene Pufferkopie: SubtleCrypto verlangt einen echten ArrayBuffer
  // (kein SharedArrayBuffer, kein Teil-View mit fremdem Offset).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  const out = new Uint8Array(digest);
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function sha256HexAll(dateien: Iterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for (const d of dateien) out.push(await sha256Hex(d));
  return out;
}
