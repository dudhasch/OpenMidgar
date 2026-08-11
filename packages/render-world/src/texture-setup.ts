import type { WorldAnimatedTexture, WorldTerrain, WorldTextureNameTable } from '@webmidgar/formats-world';
import {
  buildWorldTextureAtlas,
  type WorldTextureAtlas,
} from './texture-atlas.js';
import {
  collectAtlasImages,
  measureTextureCooccurrence,
  paletteExtremes,
  substituteAnimatedPalette,
  type StaticTextureImage,
} from './texture-images.js';
import {
  buildWorldTextureTable,
  CLTR_NAME,
  measureTextureUvRanges,
  type TextureSize,
  type TextureTableEntry,
} from './texture-table.js';
import type { WorldTextureTable } from './uv.js';

/**
 * F11b + F25 in EINEM Aufruf — der Einstieg, den die Demo verdrahtet.
 *
 * Zusammengeführt werden vier Quellen, die alle schon einzeln belegt sind:
 * die Namenstabelle aus der EXE, die `.tex`-Bilder aus `world_us.lgp`, die
 * animierten Texturen aus `wm.ta` und die UV-Spannweiten aus dem geparsten
 * Terrain. Das Ergebnis ist die Tabelle für `resolveTriangleUv` plus der
 * fertige Atlas plus ein Bericht, der in die Statuszeile gehört — jede Zahl
 * darin ist eine Messung, keine Behauptung.
 */

export interface WorldTextureSetInput {
  terrain: WorldTerrain;
  /** Vollständige EXE-Tabelle; der Kartenausschnitt wird über `base` gewählt. */
  nameTable: WorldTextureNameTable;
  /** `bases.wm0` / `bases.wm2` / `bases.wm3`. */
  base: number;
  /** Dekodierte `.tex`-Bilder, Schlüssel = Basisname ohne Endung. */
  staticImages: ReadonlyMap<string, StaticTextureImage>;
  /** Animierte Texturen aus `wm.ta` (leer erlaubt — dann fehlen sie sichtbar). */
  animated?: ReadonlyArray<WorldAnimatedTexture>;
  atlasSize?: number;
  padding?: number;
  animationFrame?: number;
}

export interface WorldTextureSetReport {
  usedIds: number;
  named: number;
  animatedIds: number;
  /** IDs, deren UV-Fenster NICHT in die zugeordnete Textur passt (Soll: 0). */
  misfits: number[];
  /** IDs ohne Größe oder ohne Bild — sie bleiben untexturiert. */
  unresolved: number[];
  missingImages: number[];
  atlasPages: number;
  atlasRejected: number[];
  /** 🟡 Anteil der Dreiecke, die eine ERSATZPALETTE benutzen (animierte Texturen). */
  substitutePaletteTriangleShare: number;
  diagnostics: string[];
}

export interface WorldTextureSet {
  table: WorldTextureTable;
  atlas: WorldTextureAtlas;
  entries: TextureTableEntry[];
  report: WorldTextureSetReport;
}

export function buildWorldTextureSet(input: WorldTextureSetInput): WorldTextureSet {
  const names = input.nameTable.names.slice(input.base);
  const animated = input.animated ?? [];

  // cltr-Quirk: nur dort anwenden, wo die Textur auch cltr heißt.
  const quirk = new Set<number>();
  names.forEach((n, i) => {
    if (n === CLTR_NAME) quirk.add(i);
  });
  const ranges = measureTextureUvRanges(input.terrain, { quirkTextureIds: quirk });

  const sizes = new Map<string, TextureSize>();
  for (const [name, bild] of input.staticImages) sizes.set(name, { width: bild.width, height: bild.height });
  const tabelle = buildWorldTextureTable({
    ranges,
    names,
    sizes,
    animated: animated.map((t) => ({ width: t.width, height: t.height })),
  });

  // 🟡 Ersatzpaletten der animierten Texturen — Herleitung s. texture-images.ts.
  const nachbarn = measureTextureCooccurrence(input.terrain);
  const animatedPalettes = new Map<number, Uint8Array>();
  for (const e of tabelle.entries) {
    if (e.animatedSlot === null) continue;
    const kandidaten = [...(nachbarn.get(e.textureId) ?? new Map<number, number>())]
      .filter(([id]) => names[id])
      .sort((a, b) => b[1] - a[1]);
    for (const [id] of kandidaten) {
      const bild = input.staticImages.get(names[id]!);
      if (!bild) continue;
      const ext = paletteExtremes(bild.rgba);
      if (!ext) continue;
      animatedPalettes.set(e.textureId, substituteAnimatedPalette(ext.dark, ext.light));
      break;
    }
  }

  const bilder = collectAtlasImages({
    names,
    staticImages: input.staticImages,
    animated,
    usedIds: [...ranges.keys()],
    animatedPalettes,
    ...(input.animationFrame === undefined ? {} : { animationFrame: input.animationFrame }),
  });
  const atlas = buildWorldTextureAtlas(bilder.images, {
    ...(input.atlasSize === undefined ? {} : { atlasSize: input.atlasSize }),
    ...(input.padding === undefined ? {} : { padding: input.padding }),
  });

  const gesamtTris = [...ranges.values()].reduce((s, r) => s + r.triangles, 0);
  const ersatzTris = tabelle.entries
    .filter((e) => e.animatedSlot !== null && animatedPalettes.has(e.textureId))
    .reduce((s, e) => s + e.triangles, 0);

  return {
    table: tabelle.table,
    atlas,
    entries: tabelle.entries,
    report: {
      usedIds: ranges.size,
      named: tabelle.entries.filter((e) => e.name !== null).length,
      animatedIds: tabelle.entries.filter((e) => e.animatedSlot !== null).length,
      misfits: tabelle.entries.filter((e) => !e.fits).map((e) => e.textureId),
      unresolved: tabelle.unresolved,
      missingImages: bilder.missing,
      atlasPages: atlas.atlases.length,
      atlasRejected: atlas.rejected,
      substitutePaletteTriangleShare: gesamtTris ? ersatzTris / gesamtTris : 0,
      diagnostics: tabelle.diagnostics,
    },
  };
}
