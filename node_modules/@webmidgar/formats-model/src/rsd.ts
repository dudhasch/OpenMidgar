import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import type { ResourceBinding } from './nam.js';
import type { ParseResult } from './hrc.js';

/**
 * `.rsd`-Parser (🟢 Textformat): Signaturzeile `@RSD…`, Schlüssel=Wert-Zeilen.
 * PLY-Verweis trägt historisch die Alt-Endung `.PLY` und wird per
 * dokumentierter Namenskonvention auf die tatsächliche `.p`-Datei abgebildet;
 * TEX[i]-Verweise (`.TIM`) analog auf `.tex`. Die Reihenfolge der Texturliste
 * ist Semantik (Gruppen indizieren hinein) und bleibt konserviert.
 */

const decoder = new TextDecoder('ascii');

/** Alt-Endung entfernen und kleinschreiben: "AAAA.PLY" → "aaaa". */
const baseName = (value: string): string => {
  const dot = value.lastIndexOf('.');
  return (dot >= 0 ? value.slice(0, dot) : value).trim().toLowerCase();
};

export function parseRsd(bytes: Uint8Array, asset: string): ParseResult<ResourceBinding> {
  const diagnostics: ModelDiagnostic[] = [];
  const lines = decoder
    .decode(bytes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (!lines[0]?.startsWith('@RSD')) {
    diagnostics.push(mdiag('E-RSD-KEY', asset, 'Signaturzeile @RSD fehlt'));
    return { value: null, diagnostics };
  }

  let ply: string | null = null;
  let ntex = 0;
  const texByIndex = new Map<number, string>();
  for (const line of lines.slice(1)) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const value = line.slice(eq + 1).trim();
    if (key === 'PLY') ply = baseName(value);
    else if (key === 'NTEX') ntex = Number.parseInt(value, 10) || 0;
    else {
      const m = /^TEX\[(\d+)\]$/.exec(key);
      if (m) texByIndex.set(Number.parseInt(m[1]!, 10), baseName(value));
    }
  }

  if (!ply) {
    diagnostics.push(mdiag('E-RSD-KEY', asset, 'Pflichtschlüssel PLY fehlt'));
    return { value: null, diagnostics };
  }
  const textureRefs: string[] = [];
  for (let i = 0; i < ntex; i++) {
    const tex = texByIndex.get(i);
    if (tex === undefined) {
      diagnostics.push(mdiag('E-RSD-KEY', asset, `TEX[${i}] fehlt (NTEX=${ntex})`));
      return { value: null, diagnostics };
    }
    textureRefs.push(tex);
  }

  return {
    value: { schemaVersion: 1, meshRef: ply, textureRefs, diagnostics },
    diagnostics,
  };
}
