/**
 * Diagnose-Export (S18). Der Nutzer soll einen Fehlerbericht weitergeben
 * können — **ohne** dabei versehentlich Spieldaten zu verschicken.
 *
 * Deshalb ist der Export nicht „das Diagnoseobjekt als JSON", sondern eine
 * bewusste Projektion auf eine Positivliste: Fehlerklassen, Zähler, Längen,
 * Fingerprints. Alles andere fällt weg. Die Prüffunktion `isAssetFree`
 * belegt das nachweisbar und ist als Test verankert — eine Zusicherung, die
 * man nicht durch Hinsehen erfüllen kann.
 */

export interface DiagnosticEntry {
  code: string;
  severity: string;
  /** Kennung des betroffenen Assets — wird zu einem Digest verkürzt. */
  asset?: string | undefined;
  section?: number | undefined;
  detail?: string | undefined;
}

export interface DiagnosticsExport {
  schemaVersion: 1;
  sourceFingerprint: string;
  /** Fehlerklasse → Anzahl. */
  counts: Record<string, number>;
  /** Je Klasse bis zu `sampleLimit` betroffene Asset-Digests. */
  samples: Record<string, string[]>;
  totals: { entries: number; assets: number };
}

/**
 * FNV-1a-32 über eine Zeichenkette — kurz, stabil und nicht umkehrbar genug,
 * um aus einem Bericht keine Dateinamen zu rekonstruieren.
 */
export function shortDigest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function buildDiagnosticsExport(
  entries: readonly DiagnosticEntry[],
  sourceFingerprint: string,
  sampleLimit = 5,
): DiagnosticsExport {
  const counts: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  const assets = new Set<string>();
  for (const e of entries) {
    counts[e.code] = (counts[e.code] ?? 0) + 1;
    if (e.asset !== undefined) {
      assets.add(e.asset);
      const list = (samples[e.code] ??= []);
      const digest = shortDigest(e.asset);
      if (list.length < sampleLimit && !list.includes(digest)) list.push(digest);
    }
  }
  return {
    schemaVersion: 1,
    sourceFingerprint,
    counts,
    samples,
    totals: { entries: entries.length, assets: assets.size },
  };
}

/**
 * Belegt, dass ein Export keine Nutzdaten enthält: Alle Blattwerte müssen
 * Zahlen sein oder Zeichenketten, die einem der erlaubten Muster folgen
 * (Fehlerklasse, Hexdigest). Freitext ist ausgeschlossen — genau dort würden
 * sonst Dateinamen oder Spielinhalte durchsickern.
 */
const ALLOWED_STRING = /^(?:[A-Z]-[A-Z0-9-]+\d*|[0-9a-f]{8,64}|\d+)$/;

export function isAssetFree(value: unknown, path = '$'): { ok: boolean; offender?: string } {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return { ok: true };
  if (typeof value === 'string') {
    return ALLOWED_STRING.test(value) ? { ok: true } : { ok: false, offender: `${path}: "${value}"` };
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const r = isAssetFree(v, `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Schlüssel dürfen sprechend sein (sie sind Struktur, kein Inhalt);
      // geprüft werden die Werte.
      if (k === 'schemaVersion') continue;
      const r = isAssetFree(v, `${path}.${k}`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  return { ok: false, offender: `${path}: ${typeof value}` };
}
