import { ATLAS_SIZE as SHARED_ATLAS_SIZE, ShelfPacker, blitRgba } from '@webmidgar/atlas';
import { effectiveTileRef, type BackgroundTile, type FieldBackground, type FieldPalette } from '@webmidgar/formats-field';
import {
  baseLayerIndex,
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

/**
 * 🔵 Der Packer selbst wohnt seit F25 in `@webmidgar/atlas` — Weltkarte und
 * Kampfbühne brauchen denselben. Hier bleibt nur der Field-spezifische Teil
 * (Kachelvarianten auflösen); die Kantenlänge wird durchgereicht, damit
 * bestehende Importe von `ATLAS_SIZE` aus `render-field` gültig bleiben.
 */
export const ATLAS_SIZE = SHARED_ATLAS_SIZE;

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

export function tileVariantKey(
  tile: BackgroundTile,
  size: number,
  transparency: TileTransparency,
  layerIndex: number,
): string {
  // F31: Quelle UND Texturseite nach der Makou-Regel (blending>0 && Layer>0
  // → zweites Koordinatenpaar auf textureId2) — Schlüssel und Auflösung
  // müssen dieselbe Regel verwenden.
  const ref = effectiveTileRef(tile, layerIndex);
  return `${ref.textureId}:${ref.x}:${ref.y}:${tile.paletteId}:${size}:${transparency}`;
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

  // Punktabtastung (NEAREST) im Field-Pfad ⇒ Polsterung 0.
  const packer = new ShelfPacker(atlasSize, 0);
  const place = (size: number): { atlas: number; x: number; y: number } => {
    const spot = packer.place(size, size)!;
    while (atlases.length <= spot.atlas) atlases.push(new Uint8Array(atlasSize * atlasSize * 4));
    return spot;
  };

  const baseIndex = baseLayerIndex(bg);
  for (const layer of bg.layers) {
    const size = layerTileSize(layer);
    const transparency = layerTransparency(layer.index, baseIndex);
    for (const [tileIndex, tile] of layer.tiles.entries()) {
      const key = tileVariantKey(tile, size, transparency, layer.index);
      if (entries.has(key)) continue;
      const ref = effectiveTileRef(tile, layer.index);
      const page = pages.get(ref.textureId);
      const texels = resolveTileRgba(tile, page, palettePages, size, transparency, layer.index);
      if (!texels) {
        issues.push({
          code: page ? 'W-BG-PALMISS' : 'W-BG-TEXMISS',
          tileIndex,
          layer: layer.index,
          detail: page ? `Palettenseite ${tile.paletteId} fehlt` : `Texturseite ${ref.textureId} fehlt`,
        });
        continue;
      }
      const spot = place(size);
      blitRgba(atlases[spot.atlas]!, atlasSize, texels, size, size, spot.x, spot.y);
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
  // Muss dieselbe Basis annehmen wie `buildTileAtlas` — die Transparenzregel
  // geht in den Atlasschlüssel ein, eine Abweichung fände schlicht nichts.
  const baseIndex = baseLayerIndex(bg);
  for (const layer of [...bg.layers].sort((a, b) => a.index - b.index)) {
    const size = layerTileSize(layer);
    const transparency = layerTransparency(layer.index, baseIndex);
    for (const tile of sortTilesForDraw(layer.tiles)) {
      const entry = atlas.entries.get(tileVariantKey(tile, size, transparency, layer.index));
      if (!entry) continue;
      items.push({ layer: layer.index, tile, size, entry });
    }
  }
  return items;
}
