import type { WorldAnimatedTexture, WorldTerrain } from '@webmidgar/formats-world';
import type { WorldAtlasImage } from './texture-atlas.js';

/**
 * F25 — von den Rohdaten zu RGBA-Bildern, die der Atlas packen kann.
 *
 * Zwei Quellen, zwei Reifegrade:
 *  1. **Statische Texturen** (`.tex`, 380 Einträge): vollständig gemessen.
 *     Der Dekoder ist der bestehende `parseTex` aus `formats-model` — 8 bpp
 *     palettiert, BGRA→RGBA, Palettenalpha als Transparenz (dort belegt an
 *     695/695 Dateien). Dieses Modul nimmt das fertige Ergebnis entgegen und
 *     baut keinen zweiten Dekoder.
 *  2. **Animierte Texturen** (`wm.ta`, 22 Einträge, 66,6 % der WM0-Dreiecke):
 *     die PIXEL sind gemessen (32×32, 4 bpp), die **Farbtabelle nicht**.
 *     Siehe `substituteAnimatedPalette` — das ist die einzige Stelle in
 *     diesem Arbeitspaket, an der eine Farbe nicht aus den Daten kommt, und
 *     sie ist als solche gekennzeichnet und abschaltbar.
 */

/** RGBA-Bild einer statischen Textur, wie es aus `parseTex` fällt. */
export interface StaticTextureImage {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * 🟡 **ERSATZPALETTE — keine Messung.**
 *
 * Für die 22 animierten Texturen ist keine CLUT auffindbar (weder in `wm.ta`
 * noch über die EXE-Tabelle, s. `formats-world/wm-ta.ts`). Statt eine
 * Wunschpalette zu erfinden, wird sie aus den Daten ABGELEITET, die es gibt:
 *
 *   Für die betroffene `textureId` wird gezählt, welche STATISCHE `textureId`
 *   am häufigsten im selben Mesh vorkommt (Nachbarschaftsmaß). Deren Palette
 *   liefert die dunkelste und die hellste Farbe; dazwischen wird linear in
 *   16 Stufen interpoliert.
 *
 * Warum das nicht willkürlich ist: die animierten Texturen sind der Ozean,
 * ihre häufigsten Nachbarn sind die statischen Wasser-/Küstentexturen. Der
 * Farbton kommt damit aus echten Spieldaten und nicht aus dem Geschmack des
 * Entwicklers. Warum es trotzdem 🟡 bleibt: der VERLAUF zwischen den beiden
 * Extremfarben ist eine Annahme, und die Zuordnung Index→Stufe ist eine
 * zweite. Ein Screenshot mit dieser Palette ist ein Beleg für Geometrie,
 * UV-Rechnung und Atlas — NICHT für die Ozeanfarbe.
 */
export const ANIMATED_PALETTE_ENTRIES = 16;

/** Häufigster statischer Nachbar je animierter `textureId` (im selben Mesh). */
export function measureTextureCooccurrence(terrain: WorldTerrain): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const block of terrain.blocks) {
    if (!block) continue;
    for (const mesh of block.meshes) {
      if (!mesh) continue;
      const zaehlung = new Map<number, number>();
      for (const tri of mesh.triangles) zaehlung.set(tri.textureId, (zaehlung.get(tri.textureId) ?? 0) + 1);
      for (const id of zaehlung.keys()) {
        const ziel = out.get(id) ?? new Map<number, number>();
        for (const [other, n] of zaehlung) if (other !== id) ziel.set(other, (ziel.get(other) ?? 0) + n);
        out.set(id, ziel);
      }
    }
  }
  return out;
}

const luminanz = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Dunkelste und hellste undurchsichtige Farbe eines RGBA-Bildes. */
export function paletteExtremes(rgba: Uint8Array): { dark: [number, number, number]; light: [number, number, number] } | null {
  let dark: [number, number, number] | null = null;
  let light: [number, number, number] | null = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const l = luminanz(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    if (l < lo) {
      lo = l;
      dark = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    }
    if (l > hi) {
      hi = l;
      light = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    }
  }
  return dark && light ? { dark, light } : null;
}

/** 16-stufige Ersatzpalette (RGBA) zwischen zwei Extremfarben. */
export function substituteAnimatedPalette(
  dark: readonly [number, number, number],
  light: readonly [number, number, number],
): Uint8Array {
  const pal = new Uint8Array(ANIMATED_PALETTE_ENTRIES * 4);
  for (let i = 0; i < ANIMATED_PALETTE_ENTRIES; i++) {
    const t = i / (ANIMATED_PALETTE_ENTRIES - 1);
    pal[i * 4] = Math.round(dark[0] + (light[0] - dark[0]) * t);
    pal[i * 4 + 1] = Math.round(dark[1] + (light[1] - dark[1]) * t);
    pal[i * 4 + 2] = Math.round(dark[2] + (light[2] - dark[2]) * t);
    pal[i * 4 + 3] = 255;
  }
  return pal;
}

/** Indexbild + Palette → RGBA. */
export function colorizeIndexed(indices: Uint8Array, palette: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);
  const n = palette.length / 4;
  for (let i = 0; i < indices.length; i++) {
    const p = (indices[i]! % n) * 4;
    rgba[i * 4] = palette[p]!;
    rgba[i * 4 + 1] = palette[p + 1]!;
    rgba[i * 4 + 2] = palette[p + 2]!;
    rgba[i * 4 + 3] = palette[p + 3]!;
  }
  return rgba;
}

export interface AtlasImageInput {
  /** Name je `textureId` (Kartenausschnitt der EXE-Tabelle). */
  names: ReadonlyArray<string | null>;
  /** Dekodierte `.tex`-Bilder, Schlüssel = Basisname. */
  staticImages: ReadonlyMap<string, StaticTextureImage>;
  /** Animierte Texturen in `wm.ta`-Reihenfolge. */
  animated?: ReadonlyArray<WorldAnimatedTexture>;
  /** Nur diese `textureId`s aufnehmen (die real belegten). */
  usedIds: Iterable<number>;
  /** Halbbild, das in den Atlas geht (Standard 0). */
  animationFrame?: number;
  /** Ersatzpalette je animierter `textureId`; fehlt sie, bleibt die Textur weg. */
  animatedPalettes?: ReadonlyMap<number, Uint8Array>;
}

export interface AtlasImageResult {
  images: WorldAtlasImage[];
  /** IDs ohne Bild — sie bleiben im Atlas unbesetzt und im Ergebnis sichtbar. */
  missing: number[];
  staticCount: number;
  animatedCount: number;
}

/** Sammelt alle Bilder EINER Karte für den Atlasbau. */
export function collectAtlasImages(input: AtlasImageInput): AtlasImageResult {
  const frame = input.animationFrame ?? 0;
  const animated = input.animated ?? [];
  const images: WorldAtlasImage[] = [];
  const missing: number[] = [];
  let staticCount = 0;
  let animatedCount = 0;

  const animSlotOf = new Map<number, number>();
  let lauf = 0;
  for (let i = 0; i < input.names.length; i++) if (input.names[i] === null) animSlotOf.set(i, lauf++);

  for (const id of input.usedIds) {
    const name = id < input.names.length ? (input.names[id] ?? null) : null;
    if (name) {
      const bild = input.staticImages.get(name);
      if (!bild) {
        missing.push(id);
        continue;
      }
      images.push({ textureId: id, width: bild.width, height: bild.height, rgba: bild.rgba });
      staticCount++;
      continue;
    }
    const slot = animSlotOf.get(id);
    const tex = slot === undefined ? undefined : animated[slot];
    const palette = input.animatedPalettes?.get(id);
    if (!tex || !palette) {
      missing.push(id);
      continue;
    }
    const halbbild = tex.frames[Math.min(frame, tex.frames.length - 1)]!;
    images.push({
      textureId: id,
      width: tex.width,
      height: tex.height,
      rgba: colorizeIndexed(halbbild.indices, palette),
    });
    animatedCount++;
  }
  return { images, missing, staticCount, animatedCount };
}
