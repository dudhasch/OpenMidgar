import {
  effectiveTileRef,
  type BackgroundLayer,
  type BackgroundTexturePage,
  type BackgroundTile,
  type FieldBackground,
  type FieldPalette,
} from '@webmidgar/formats-field';
import { decodeBgr555 } from '@webmidgar/formats-field';

/**
 * Auflösung der Hintergrund-Tiles zu RGBA — bewusst frei von Three.js, damit
 * derselbe Code im Worker (Asset-Pipeline) laufen kann.
 *
 * Realdaten-belegte Regeln (S9-Proben über 647.531 Tiles):
 *  - Quellkoordinate: `src2`, sobald gesetzt, sonst `src` (99,1 % Deckung mit
 *    dem im Record mitgeführten UV-Cache) → `effectiveTileSource`.
 *  - Texturseite: `textureId` (u8@34) verweist in 99,85 % der Tiles auf einen
 *    im Field vorhandenen Slot.
 *  - Palettenseite: `paletteId` (u8@24), 99,87 % im gültigen Bereich.
 *  - Kachelkante: 16 px, außer wenn `layerControl === 32` (Layer 2 im
 *    Original: 7062/7062 Tiles mit 32, Quellkoordinaten durchgängig
 *    32-aligned, gemessene Rasterweite ebenfalls 32).
 *  - Texeltiefe: `bpp` 0/1 = palettiert, 2 = BGR555-Direktfarbe.
 *
 * 🟡 Offen: `flags` (u8@25) und die Blendmodi der Layer 1–3 werden hier als
 * einfaches Alpha-Over behandelt; `layerControl` wird als Zustandskennung
 * nur durchgereicht (Layer 3 stapelt im Original Zustandsvarianten auf
 * derselben Zielzelle).
 */

export const DEFAULT_TILE_SIZE = 16;

export interface ComposedImage {
  width: number;
  height: number;
  /** Bildkoordinate (0,0) entspricht dieser dst-Position. */
  originX: number;
  originY: number;
  rgba: Uint8Array;
}

export interface TileResolveIssue {
  code: 'W-BG-TEXMISS' | 'W-BG-PALMISS' | 'W-BG-SRCOOB';
  tileIndex: number;
  layer: number;
  detail: string;
}

/** Kachelkante eines Layers — realdaten-gestützte Ableitung, siehe Kopfnotiz. */
export function layerTileSize(layer: BackgroundLayer): number {
  const control = layer.tiles[0]?.layerControl ?? 0;
  return control === 32 ? 32 : DEFAULT_TILE_SIZE;
}

function pageBySlot(pages: BackgroundTexturePage[]): Map<number, BackgroundTexturePage> {
  return new Map(pages.map((p) => [p.slot, p]));
}

/**
 * Transparenzregel für palettierte Kacheln.
 *  - `index0`: Palettenindex 0 ist transparent (Überlagerungsebenen).
 *  - `opaque`: nichts ist transparent (Basisebene — sonst reißt der
 *    Hintergrund überall dort Löcher, wo die Palette echtes Schwarz führt).
 *  - `paletteAlpha`: Alpha aus der dekodierten Palettenfarbe (Rohwert 0).
 */
export type TileTransparency = 'index0' | 'opaque' | 'paletteAlpha';

/**
 * Texel einer Kachel nach RGBA auflösen. Gibt `null` zurück, wenn die
 * referenzierte Seite fehlt — der Aufrufer entscheidet über die Degradierung.
 */
export function resolveTileRgba(
  tile: BackgroundTile,
  page: BackgroundTexturePage | undefined,
  palettePages: readonly Uint8Array[],
  size: number,
  transparency: TileTransparency = 'index0',
  layerIndex = 0,
): Uint8Array | null {
  if (!page) return null;
  const src = effectiveTileRef(tile, layerIndex);
  const out = new Uint8Array(size * size * 4);
  const paletted = page.depth === 1;
  const pal = paletted ? palettePages[tile.paletteId] : undefined;
  if (paletted && !pal) return null;
  for (let ty = 0; ty < size; ty++) {
    const sy = src.y + ty;
    if (sy >= 256) break;
    for (let tx = 0; tx < size; tx++) {
      const sx = src.x + tx;
      if (sx >= 256) break;
      const texel = sy * 256 + sx;
      const o = (ty * size + tx) * 4;
      if (paletted) {
        const idx = page.data[texel]!;
        const p = idx * 4;
        out[o] = pal![p]!;
        out[o + 1] = pal![p + 1]!;
        out[o + 2] = pal![p + 2]!;
        // F30: Palettenrohwert 0x0000 ist IMMER transparent (Makou `isZero`;
        // decodeBgr555 kodiert das als Alpha 0 — Schwarz MIT STP-Bit bleibt
        // deckend). Ohne diese Regel rahmte das Schwarz der Effektkacheln
        // jede Animation als Block ein. `index0`/`opaque` bleiben als
        // zusätzliche Layerregeln bestehen.
        out[o + 3] =
          transparency === 'opaque'
            ? 255
            : pal![p + 3] === 0
              ? 0
              : transparency === 'index0' && idx === 0
                ? 0
                : 255;
      } else {
        const value = page.data[texel * 2]! | (page.data[texel * 2 + 1]! << 8);
        const [r, g, b, a] = decodeBgr555(value);
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }
  }
  return out;
}

export interface ComposeOptions {
  /** Layerindizes in Zeichenreihenfolge; Default: alle vorhandenen aufsteigend. */
  layers?: number[] | undefined;
  /**
   * Nur Tiles zeichnen, deren `layerControl` in dieser Menge liegt bzw. die
   * den kleinsten Wert ihrer Zielzelle tragen (MVP-Regel für Layer 3).
   */
  stateSelect?: 'lowest' | 'all' | undefined;
  /** Sammelbecken für Degradierungshinweise (fehlende Seiten). */
  issues?: TileResolveIssue[] | undefined;
  /** Überschreibt die layerabhängige Standardregel (siehe `layerTransparency`). */
  transparency?: TileTransparency | undefined;
}

/**
 * Kleinster Layerindex, der tatsächlich Kacheln trägt — die Basisebene.
 *
 * ✅ Realdaten-belegt: Das ist **nicht** immer Layer 0. Im Bestand hat genau
 * ein Field (`ship_2`) einen leeren Layer 0; sein gesamtes Bild liegt in
 * Layer 1. Ein Layer wird also nicht dadurch zur Basis, dass er Index 0 hat,
 * sondern dadurch, dass er der unterste bemalte ist.
 */
export function baseLayerIndex(bg: Pick<FieldBackground, 'layers'>): number {
  let base = -1;
  for (const l of bg.layers) {
    if (l.tiles.length > 0 && (base < 0 || l.index < base)) base = l.index;
  }
  return base;
}

/**
 * Standard-Transparenzregel je Layer: Die Basisebene deckt, die darüber
 * liegenden Layer überlagern sie mit Index 0 als Loch.
 *
 * ✅ Realdaten-gestützt: Mit der Regel `paletteAlpha` (Rohwert 0 = transparent)
 * blieben nur 57 % der Basisfläche gedeckt — echtes Schwarz wäre dann überall
 * ein Loch. `opaque` schließt die Fläche.
 *
 * `baseIndex` ist ein Parameter, weil die Basis nicht immer Layer 0 ist
 * (siehe `baseLayerIndex`): Bei `ship_2` deckt die Basisebene unter `opaque`
 * 100,00 %, unter der nach Index gewählten `index0`-Regel nur 94,73 % —
 * 5,27 % des Basisbilds wären Löcher.
 */
export function layerTransparency(layerIndex: number, baseIndex = 0): TileTransparency {
  return layerIndex === baseIndex ? 'opaque' : 'index0';
}

/** Zeichenreihenfolge: hinterster Layer zuerst, innerhalb dessen großes z zuerst. */
export function sortTilesForDraw(tiles: readonly BackgroundTile[]): BackgroundTile[] {
  return tiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.z - a.t.z || a.i - b.i)
    .map((e) => e.t);
}

/**
 * Komponiert die gewählten Layer zu einem RGBA-Bild (Alpha-Over).
 * Dient dem Golden-Test, der Diagnose und dem 2D-Fallback; der GPU-Pfad
 * nutzt stattdessen `buildTileAtlas`.
 */
export function composeBackgroundImage(
  bg: FieldBackground,
  palette: FieldPalette | undefined,
  opts: ComposeOptions = {},
): ComposedImage {
  const pages = pageBySlot(bg.texturePages);
  const palettePages = palette?.pages ?? [];
  const wanted = opts.layers ?? bg.layers.map((l) => l.index);
  const chosen = bg.layers.filter((l) => wanted.includes(l.index)).sort((a, b) => a.index - b.index);
  // Die Basis wird über ALLE Layer des Fields bestimmt, nicht über die
  // gewählte Teilmenge: Wer nur Überlagerungen komponiert, soll dadurch keine
  // davon zur deckenden Basis befördern.
  const baseIndex = baseLayerIndex(bg);

  // Bildausdehnung aus den tatsächlich bemalten Zellen (dst ist um 0 zentriert).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of chosen) {
    const size = layerTileSize(layer);
    for (const t of layer.tiles) {
      if (t.dstX < minX) minX = t.dstX;
      if (t.dstY < minY) minY = t.dstY;
      if (t.dstX + size > maxX) maxX = t.dstX + size;
      if (t.dstY + size > maxY) maxY = t.dstY + size;
    }
  }
  if (!Number.isFinite(minX)) {
    return { width: 0, height: 0, originX: 0, originY: 0, rgba: new Uint8Array(0) };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const rgba = new Uint8Array(width * height * 4);

  for (const layer of chosen) {
    const size = layerTileSize(layer);
    const tiles = selectTiles(layer, opts.stateSelect ?? 'lowest');
    for (const [tileIndex, tile] of sortTilesForDraw(tiles).entries()) {
      const page = pages.get(effectiveTileRef(tile, layer.index).textureId);
      const texels = resolveTileRgba(
        tile,
        page,
        palettePages,
        size,
        opts.transparency ?? layerTransparency(layer.index, baseIndex),
        layer.index,
      );
      if (!texels) {
        opts.issues?.push({
          code: page ? 'W-BG-PALMISS' : 'W-BG-TEXMISS',
          tileIndex,
          layer: layer.index,
          detail: page ? `Palettenseite ${tile.paletteId} fehlt` : `Texturseite ${tile.textureId} fehlt`,
        });
        continue;
      }
      blit(rgba, width, height, texels, size, tile.dstX - minX, tile.dstY - minY);
    }
  }
  return { width, height, originX: minX, originY: minY, rgba };
}

/**
 * MVP-Zustandswahl: Wo mehrere Tiles dieselbe Zielzelle belegen und sich in
 * `layerControl` unterscheiden (Layer 3 im Original), wird der kleinste Wert
 * gezeichnet — das entspricht dem Ausgangszustand. 🟡 Die echte Schaltung
 * hängt an Skriptvariablen und folgt mit der Field-Integration.
 */
function selectTiles(layer: BackgroundLayer, mode: 'lowest' | 'all'): BackgroundTile[] {
  if (mode === 'all') return [...layer.tiles];
  const best = new Map<string, BackgroundTile>();
  const order: string[] = [];
  for (const t of layer.tiles) {
    const key = `${t.dstX},${t.dstY},${t.z}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, t);
      order.push(key);
    } else if (t.layerControl < prev.layerControl) {
      best.set(key, t);
    }
  }
  return order.map((k) => best.get(k)!);
}

function blit(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  size: number,
  atX: number,
  atY: number,
): void {
  for (let y = 0; y < size; y++) {
    const dy = atY + y;
    if (dy < 0 || dy >= dstH) continue;
    for (let x = 0; x < size; x++) {
      const dx = atX + x;
      if (dx < 0 || dx >= dstW) continue;
      const s = (y * size + x) * 4;
      const a = src[s + 3]!;
      if (a === 0) continue;
      const d = (dy * dstW + dx) * 4;
      if (a === 255) {
        dst[d] = src[s]!;
        dst[d + 1] = src[s + 1]!;
        dst[d + 2] = src[s + 2]!;
        dst[d + 3] = 255;
      } else {
        const inv = 255 - a;
        dst[d] = ((src[s]! * a + dst[d]! * inv) / 255) | 0;
        dst[d + 1] = ((src[s + 1]! * a + dst[d + 1]! * inv) / 255) | 0;
        dst[d + 2] = ((src[s + 2]! * a + dst[d + 2]! * inv) / 255) | 0;
        dst[d + 3] = Math.max(dst[d + 3]!, a);
      }
    }
  }
}
