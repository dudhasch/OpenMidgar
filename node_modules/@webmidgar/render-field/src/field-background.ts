import type { Mesh } from 'three';
import type { FieldBackground, FieldPalette } from '@webmidgar/formats-field';
import {
  buildBackgroundMesh,
  DEFAULT_TILE_Z_SCALE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  tileZToViewDistance,
  type BackgroundTileSpec,
} from './background.js';
import { buildDrawList, buildTileAtlas, type TileAtlasSet } from './tile-atlas.js';

/**
 * Verbindungsstück Field-Hintergrund → S4-Depth-Pipeline.
 *
 * Zielkoordinaten des Formats sind um die Bildmitte zentriert (realdaten-
 * belegt: die bemalte Fläche der nicht scrollenden Fields liegt exakt bei
 * −120…+120 bzw. −160…+160). Der Kompositor rechnet dagegen im Design-Raster
 * 320×240 mit Ursprung oben links — die Verschiebung um die halbe Bildgröße
 * passiert genau hier.
 */

export interface FieldBackgroundRenderOptions {
  near: number;
  far: number;
  /** Kamerascroll in Design-Pixeln (Scroll-Fields). */
  scrollX?: number | undefined;
  scrollY?: number | undefined;
  /** Kalibrierfaktor Tile-z → Sichtdistanz (🟡, siehe `tileZToViewDistance`). */
  zScale?: number | undefined;
  atlasSize?: number | undefined;
  /** Nur diese Layerindizes aufbauen; Default: alle vorhandenen. */
  layers?: number[] | undefined;
}

export interface FieldBackgroundRender {
  atlas: TileAtlasSet;
  /** Ein Mesh je Atlas — jeder Mesh trägt genau eine Textur. */
  meshes: Mesh[];
  tileCount: number;
}

export function buildFieldBackground(
  bgAll: FieldBackground,
  palette: FieldPalette | undefined,
  opts: FieldBackgroundRenderOptions,
): FieldBackgroundRender {
  const bg = opts.layers
    ? { ...bgAll, layers: bgAll.layers.filter((l) => opts.layers!.includes(l.index)) }
    : bgAll;
  const atlas = buildTileAtlas(bg, palette, { atlasSize: opts.atlasSize ?? 2048 });
  const items = buildDrawList(bg, atlas);
  const offsetX = DESIGN_WIDTH / 2 - (opts.scrollX ?? 0);
  const offsetY = DESIGN_HEIGHT / 2 - (opts.scrollY ?? 0);

  const perAtlas: BackgroundTileSpec[][] = atlas.atlases.map(() => []);
  for (const item of items) {
    perAtlas[item.entry.atlas]!.push({
      x: item.tile.dstX + offsetX,
      y: item.tile.dstY + offsetY,
      width: item.size,
      height: item.size,
      viewDistance: tileZToViewDistance(item.tile.z, opts.zScale ?? DEFAULT_TILE_Z_SCALE),
      color: [1, 1, 1],
      uv: [item.entry.u0, item.entry.v0, item.entry.u1, item.entry.v1],
    });
  }

  const meshes = perAtlas.map((tiles, i) =>
    buildBackgroundMesh(tiles, {
      near: opts.near,
      far: opts.far,
      atlas: { width: atlas.size, height: atlas.size, data: atlas.atlases[i]! },
    }),
  );
  return { atlas, meshes, tileCount: items.length };
}
