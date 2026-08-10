/**
 * Kanonische JSON-Serialisierung (sortierte Schlüssel, stabile
 * Array-Reihenfolgen, undefined-Einträge entfallen) — Grundlage für
 * Tiefenvergleiche, Byte-Budgets und diff-freundliche Projektdateien.
 */

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      const v = rec[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Length(text: string): number {
  return utf8Bytes(text).length;
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
