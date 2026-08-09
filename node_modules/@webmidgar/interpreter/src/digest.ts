/**
 * Deterministische Digests (FNV-1a) für Script-Hash-Guard, Trace-Einträge
 * und Replay-Zustandsvergleiche. Bewusst synchron und dependency-frei.
 */

export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64-Bit-FNV-1a als Hex-String (BigInt, bitidentisch über Plattformen). */
export function fnv1a64Hex(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]!);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

const encoder = new TextEncoder();

export function fnv1a64HexOfString(text: string): string {
  return fnv1a64Hex(encoder.encode(text));
}

/**
 * Kanonische JSON-Serialisierung: Objektschlüssel sortiert, Uint8Array als
 * Zahlenliste — Grundlage bitidentischer Replay-Digests.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(rec).sort()) sorted[k] = rec[k];
      return sorted;
    }
    return v;
  });
}
