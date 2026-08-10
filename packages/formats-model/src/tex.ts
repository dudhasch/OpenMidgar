import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import type { TextureSource } from './nam.js';
import type { ParseResult } from './hrc.js';

/**
 * `.tex`-Parser — Kernstruktur realdaten-validiert (695/695 Dateien):
 * 236-B-Header + Palettenblock (4·paletteSize) + Pixeldaten (b·w·h).
 * S7-Scope: palettenindizierte 8-bpp-Texturen (char.lgp-Bestand); andere
 * Formate → E-TEX-FORMAT mit Platzhalter-Fallback beim Aufrufer.
 */

const HEADER_LEN = 236;

export function parseTex(bytes: Uint8Array, asset: string): ParseResult<TextureSource> {
  const diagnostics: ModelDiagnostic[] = [];
  const fail = (code: 'E-TEX-SIZE' | 'E-TEX-FORMAT', message: string): ParseResult<TextureSource> => {
    diagnostics.push(mdiag(code, asset, message));
    return { value: null, diagnostics };
  };
  if (bytes.length < HEADER_LEN) return fail('E-TEX-SIZE', `Datei kürzer als Header (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const numPalettes = view.getUint32(0x30, true);
  const colorsPerPalette = view.getUint32(0x34, true);
  const width = view.getUint32(0x3c, true);
  const height = view.getUint32(0x40, true);
  const hasPalette = view.getUint32(0x4c, true);
  const paletteSize = view.getUint32(0x58, true);
  const bytesPerPixel = view.getUint32(0x68, true);

  const expected = HEADER_LEN + paletteSize * 4 + width * height * bytesPerPixel;
  if (expected !== bytes.length) {
    return fail('E-TEX-SIZE', `erwartet ${expected} B (pal=${paletteSize}, ${width}×${height}×${bytesPerPixel}), tatsächlich ${bytes.length}`);
  }
  if (hasPalette === 0 || bytesPerPixel !== 1) {
    return fail('E-TEX-FORMAT', `nicht unterstützt: hasPalette=${hasPalette}, bytesPerPixel=${bytesPerPixel} (S7: 8-bpp-palettiert)`);
  }

  // Palettenblock BGRA → RGBA. 🟢 **Sichtgeprüft (B5, 2026-08-10):** In einem
  // Formular mit vier Texturen × vier Kanalauslegungen wurde BGRA bei drei
  // Texturen einstimmig als richtig und jede Alternative als „falsche Farbe"
  // bewertet; die vierte war ein Effektsprite und blieb bewusst unentschieden
  // (bei einer Flamme ist cyan so plausibel wie rot — genau deshalb standen
  // mehrere Texturen zur Wahl).
  //
  // Alle Paletten werden konserviert. 🟢 Gemessen tragen allerdings **alle
  // 695** Texturen des Bestands genau EINE Palette (`numPalettes = 1` im Kopf,
  // `nP·cPP == pSize` in 695/695) — die Mehrpaletten-Auslegung ist also
  // Vorsorge, kein aktiver Pfad.
  const perPalette = numPalettes > 0 && numPalettes * colorsPerPalette === paletteSize ? colorsPerPalette : paletteSize;
  const paletteCount = perPalette > 0 ? paletteSize / perPalette : 0;
  const palettes: Uint8Array[] = [];
  for (let p = 0; p < paletteCount; p++) {
    const rgba = new Uint8Array(perPalette * 4);
    for (let c = 0; c < perPalette; c++) {
      const src = HEADER_LEN + (p * perPalette + c) * 4;
      rgba[c * 4] = bytes[src + 2]!;
      rgba[c * 4 + 1] = bytes[src + 1]!;
      rgba[c * 4 + 2] = bytes[src]!;
      rgba[c * 4 + 3] = bytes[src + 3]!;
    }
    palettes.push(rgba);
  }

  // Farbschlüssel. 🟢 **Realdatenbeleg 695/695** (`tex-alpha-probe`): Das
  // Kopffeld bei 0x08 ist der Transparenzschalter. Es steht auf 1 in **genau
  // den 627** Dateien, in denen Paletteneintrag 0 das Alpha 0 trägt, und auf 0
  // in **genau den 68**, in denen er undurchsichtig ist — null Widersprüche in
  // beide Richtungen. Zwei unabhängige Felder derselben Datei sagen dasselbe;
  // gleiche Anzahlen allein wären Zufall gewesen, gleiche Dateien sind es nicht.
  //
  // Ausgewertet wird trotzdem das **Palettenalpha** und nicht das Kopffeld:
  // Es ist die feinere Angabe (8 Dateien führen zwischen 63 und 142
  // durchsichtige Einträge, nicht nur den ersten) und eine echte Teilmenge der
  // Faustregel „Index 0 ist immer durchsichtig". Gemessen entfernt die
  // Faustregel zusätzlich 7,7 % aller Texel — in den 68 Dateien, in denen
  // Index 0 eine gewöhnliche Farbe ist. Deshalb bleibt sie draußen.
  //
  // Die Gegenprobe gegen die naheliegende Falle ist bestanden: Wäre A = 0 ein
  // ungenutztes, überall genulltes Feld, machte die Regel jede Textur
  // unsichtbar. Tatsächlich tragen 640/695 Texturen GEMISCHTES Alpha, und die
  // Regel entfernt ein Drittel der Texel — die leeren Ränder der Aufkleber.
  const pixelStart = HEADER_LEN + paletteSize * 4;
  return {
    value: {
      schemaVersion: 1,
      width,
      height,
      palettes,
      pixelIndices: bytes.slice(pixelStart, pixelStart + width * height),
      diagnostics,
    },
    diagnostics,
  };
}

/** Dekodierung nach RGBA8 (🔵 nie verlustbehaftete Zwischenschritte). */
export function texToRgba(tex: TextureSource, paletteIndex = 0): Uint8Array {
  const palette = tex.palettes[Math.min(paletteIndex, tex.palettes.length - 1)] ?? new Uint8Array(4);
  const paletteColors = palette.length / 4;
  const out = new Uint8Array(tex.width * tex.height * 4);
  for (let i = 0; i < tex.pixelIndices.length; i++) {
    const idx = Math.min(tex.pixelIndices[i]!, paletteColors - 1) * 4;
    out[i * 4] = palette[idx]!;
    out[i * 4 + 1] = palette[idx + 1]!;
    out[i * 4 + 2] = palette[idx + 2]!;
    out[i * 4 + 3] = palette[idx + 3]!;
  }
  return out;
}
