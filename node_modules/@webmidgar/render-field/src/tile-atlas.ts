import type { BackgroundTile, FieldBackground, FieldPalette } from '@webmidgar/formats-field';
import {
  layerTileSize,
  layerTransparency,
  resolveTileRgba,
  sortTilesForDraw,
  type TileResolveIssue,
  type TileTransparency,
} from './tile-image.js';

/**
 * Atlas-Packer für den GPU-Pfad: alle im Field vorkommenden Kachelvarianten
 * werden einmalig aufgelöst und in wenige Texturen gepackt. Schlüssel einer
 * Variante ist (Texturseite, Quellkoordinate, Palettenseite, Kantenlänge) —
 * identische Kacheln teilen sich damit einen Atlaseintrag.
 *
 * Auslegung (Masterplan Phase 3.2, ≤ 4 Atlanten je Field): 2048² fasst bei
 * 16-px-Zellen 16.384 Varianten; das größte Original-Field liegt weit darunter.
 * Punktabtastung (NEAREST) macht Randstege überflüssig.
 */

export const ATLAS_SIZE = 2048;

export interface AtlasEntry {
  atlas: number;
  /** UV-Rechteck im Atlas (0..1, v von oben). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TileAtlasSet {
  size: number;
  atlases: Uint8Array[];
  /** Variantenschlüssel → Atlaseintrag. */
  entries: Map<string, AtlasEntry>;
  variantCount: number;
  issues: TileResolveIssue[];
}

export function tileVariantKey(tile: BackgroundTile, size: number, transparency: TileTransparency): string {
  const sx = tile.srcX2 !== 0 || tile.srcY2 !== 0 ? tile.srcX2 : tile.srcX;
  const sy = tile.srcX2 !== 0 || tile.srcY2 !== 0 ? tile.srcY2 : tile.srcY;
  return `${tile.textureId}:${sx}:${sy}:${tile.paletteId}:${size}:${transparency}`;
}

export function buildTileAtlas(
  bg: FieldBackground,
  palette: FieldPalette | undefined,
  opts: { atlasSize?: number } = {},
): TileAtlasSet {
  const atlasSize = opts.atlasSize ?? ATLAS_SIZE;
  const pages = new Map(bg.texturePages.map((p) => [p.slot, p]));
  const palettePages = palette?.pages ?? [];
  const entries = new Map<string, AtlasEntry>();
  const atlases: Uint8Array[] = [];
  const issues: TileResolveIssue[] = [];

  let current = -1;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const place = (size: number): { atlas: number; x: number; y: number } => {
    if (current < 0 || cursorX + size > atlasSize) {
      if (current >= 0) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }
      if (current < 0 || cursorY + size > atlasSize) {
        atlases.push(new Uint8Array(atlasSize * atlasSize * 4));
        current = atlases.length - 1;
        cursorX = 0;
        cursorY = 0;
        rowHeight = 0;
      }
    }
    const spot = { atlas: current, x: cursorX, y: cursorY };
    cursorX += size;
    if (size > rowHeight) rowHeight = size;
    return spot;
  };

  for (const layer of bg.layers) {
    const size = layerTileSize(layer);
    const transparency = layerTransparency(layer.index);
    for (const [tileIndex, tile] of layer.tiles.entries()) {
      const key = tileVariantKey(tile, size, transparency);
      if (entries.has(key)) continue;
      const page = pages.get(tile.textureId);
      const texels = resolveTileRgba(tile, page, palettePages, size, transparency);
      if (!texels) {
        issues.push({
          code: page ? 'W-BG-PALMISS' : 'W-BG-TEXMISS',
          tileIndex,
          layer: layer.index,
          detail: page ? `Palettenseite ${tile.paletteId} fehlt` : `Texturseite ${tile.textureId} fehlt`,
        });
        continue;
      }
      const spot = place(size);
      const target = atlases[spot.atlas]!;
      for (let y = 0; y < size; y++) {
        const from = y * size * 4;
        const to = ((spot.y + y) * atlasSize + spot.x) * 4;
        target.set(texels.subarray(from, from + size * 4), to);
      }
      entries.set(key, {
        atlas: spot.atlas,
        u0: spot.x / atlasSize,
        v0: spot.y / atlasSize,
        u1: (spot.x + size) / atlasSize,
        v1: (spot.y + size) / atlasSize,
      });
    }
  }

  return { size: atlasSize, atlases, entries, variantCount: entries.size, issues };
}

export interface TileDrawItem {
  layer: number;
  tile: BackgroundTile;
  size: number;
  entry: AtlasEntry;
}

/**
 * Zeichenliste in Originalreihenfolge: Layer aufsteigend (0 = hinterster),
 * innerhalb eines Layers absteigend nach `z` — Layer 0 trägt konstant 4095.
 */
export function buildDrawList(bg: FieldBackground, atlas: TileAtlasSet): TileDrawItem[] {
  const items: TileDrawItem[] = [];
  for (const layer of [...bg.layers].sort((a, b) => a.index - b.index)) {
    const size = layerTileSize(layer);
    const transparency = layerTransparency(layer.index);
    for (const tile of sortTilesForDraw(layer.tiles)) {
      const entry = atlas.entries.get(tileVariantKey(tile, size, transparency));
      if (!entry) continue;
      items.push({ layer: layer.index, tile, size, entry });
    }
  }
  return items;
}
