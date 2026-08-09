/**
 * Hintergrund-/Paletten-Composer für Golden Fixtures — codegetrennt von den
 * Parsern in formats-field (Dualitätsprinzip). Layouts realdaten-validiert
 * (bg-Proben 2026-08-09): siehe sections/background.ts für die Fakten.
 */

export type Rgba8 = [number, number, number, number];

// --- Sektion 4: Palette -----------------------------------------------------

export interface PaletteSectionSpec {
  /** Seiten à bis zu 256 Farben (Rest wird mit 0 aufgefüllt). */
  pages: Rgba8[][];
}

export function encodeBgr555(c: Rgba8): number {
  if (c[3] === 0) return 0;
  return ((c[0] >> 3) & 0x1f) | (((c[1] >> 3) & 0x1f) << 5) | (((c[2] >> 3) & 0x1f) << 10) | 0x8000;
}

export function composePaletteSection(spec: PaletteSectionSpec): Uint8Array {
  const bytes = new Uint8Array(12 + spec.pages.length * 512);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, true);
  view.setUint16(8, 256, true); // colorsPerPage
  view.setUint16(10, spec.pages.length, true);
  spec.pages.forEach((page, p) => {
    page.slice(0, 256).forEach((color, c) => {
      view.setUint16(12 + (p * 256 + c) * 2, encodeBgr555(color), true);
    });
  });
  return bytes;
}

// --- Sektion 9: Hintergrund -------------------------------------------------

export interface BgTileSpec {
  dstX: number;
  dstY: number;
  srcX: number;
  srcY: number;
  /** Zweites Quellkoordinatenpaar; gesetzt => der UV-Cache folgt ihm. */
  srcX2?: number | undefined;
  srcY2?: number | undefined;
  layerControl?: number | undefined;
  paletteId?: number | undefined;
  flags?: number | undefined;
  /** 12-Bit-Tiefenschlüssel; Layer 0 verwendet im Original konstant 4095. */
  z?: number | undefined;
  textureId?: number | undefined;
  bpp?: number | undefined;
}

export interface BgLayerSpec {
  width: number;
  height: number;
  tiles: BgTileSpec[];
}

export interface BgTexturePageSpec {
  slot: number;
  /** 1 = palettenindiziert, 2 = 16-Bit-Direktfarbe. */
  depth: 1 | 2;
  /** 65536·depth Bytes; fehlt → Nullseite. */
  data?: Uint8Array | undefined;
}

export interface BackgroundSectionSpec {
  /** Layer 0 sowie optional 1–3 (Index im Record). */
  layers?: Partial<Record<0 | 1 | 2 | 3, BgLayerSpec>> | undefined;
  texturePages?: BgTexturePageSpec[] | undefined;
}

const LAYER_HEADER_REST = [2, 16, 10, 14] as const;
const TILE_LEN = 52;
const TEXTURE_SLOTS = 42;

const putAscii = (target: Uint8Array, offset: number, text: string): number => {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
  return offset + text.length;
};

export function composeBackgroundSection(spec: BackgroundSectionSpec = {}): Uint8Array {
  const layers = spec.layers ?? {};
  const pages = spec.texturePages ?? [];

  // Separator-Regel (realdaten-validiert): 4 Null-Bytes nach jedem AKTIVEN
  // Layer-Block, sofern noch ein Flag folgt; Layer 0 ist immer aktiv.
  let size = 5 + 7 + 24 + 4; // Kopf + "PALETTE" + Palettenkopf + "BACK"
  let prevActiveSize = true;
  for (let l = 0 as 0 | 1 | 2 | 3; l < 4; l = (l + 1) as 0 | 1 | 2 | 3) {
    const layer = layers[l];
    if (l > 0) {
      if (prevActiveSize) size += 4; // Separator
      size += 1; // Flag
      if (!layer) {
        prevActiveSize = false;
        continue;
      }
    }
    size += 6 + LAYER_HEADER_REST[l] + (layer?.tiles.length ?? 0) * TILE_LEN;
    prevActiveSize = true;
  }
  size += 7 + TEXTURE_SLOTS * 2; // "TEXTURE" + exists-Worte
  for (const page of pages) size += 4 + 65536 * page.depth;
  size += 3; // "END"

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let o = 5; // u16 0, u16 0, u8 0
  o = putAscii(bytes, o, 'PALETTE');
  o += 24;
  o = putAscii(bytes, o, 'BACK');
  let prevActive = true;
  for (let l = 0 as 0 | 1 | 2 | 3; l < 4; l = (l + 1) as 0 | 1 | 2 | 3) {
    const layer = layers[l];
    if (l > 0) {
      if (prevActive) o += 4; // Separator (Nullen liegen bereits im Puffer)
      bytes[o] = layer ? 1 : 0;
      o += 1;
      if (!layer) {
        prevActive = false;
        continue;
      }
      prevActive = true;
    }
    view.setUint16(o, layer?.width ?? 0, true);
    view.setUint16(o + 2, layer?.height ?? 0, true);
    view.setUint16(o + 4, layer?.tiles.length ?? 0, true);
    o += 6 + LAYER_HEADER_REST[l];
    for (const tile of layer?.tiles ?? []) {
      const srcX2 = tile.srcX2 ?? 0;
      const srcY2 = tile.srcY2 ?? 0;
      // UV-Cache folgt src2, sobald gesetzt (Originalverhalten).
      const uvSrcX = srcX2 !== 0 || srcY2 !== 0 ? srcX2 : tile.srcX;
      const uvSrcY = srcX2 !== 0 || srcY2 !== 0 ? srcY2 : tile.srcY;
      view.setInt16(o + 4, tile.dstX, true);
      view.setInt16(o + 6, tile.dstY, true);
      bytes[o + 12] = tile.srcX & 0xff;
      bytes[o + 14] = tile.srcY & 0xff;
      bytes[o + 16] = srcX2 & 0xff;
      bytes[o + 18] = srcY2 & 0xff;
      view.setUint16(o + 20, tile.layerControl ?? 0, true);
      bytes[o + 24] = (tile.paletteId ?? 0) & 0xff;
      bytes[o + 25] = (tile.flags ?? 0) & 0xff;
      view.setUint16(o + 26, tile.z ?? (l === 0 ? 4095 : 0), true);
      bytes[o + 34] = (tile.textureId ?? 0) & 0xff;
      bytes[o + 38] = (tile.bpp ?? 1) & 0xff;
      view.setUint32(o + 44, Math.round((uvSrcX / 256) * 1e7), true);
      view.setUint32(o + 48, Math.round((uvSrcY / 256) * 1e7), true);
      o += TILE_LEN;
    }
  }
  o = putAscii(bytes, o, 'TEXTURE');
  const bySlot = new Map(pages.map((p) => [p.slot, p]));
  for (let slot = 0; slot < TEXTURE_SLOTS; slot++) {
    const page = bySlot.get(slot);
    view.setUint16(o, page ? 1 : 0, true);
    o += 2;
    if (!page) continue;
    view.setUint16(o, 256, true); // size-Feld (roh, nicht längenbestimmend)
    view.setUint16(o + 2, page.depth, true);
    o += 4;
    if (page.data) bytes.set(page.data.subarray(0, 65536 * page.depth), o);
    o += 65536 * page.depth;
  }
  putAscii(bytes, o, 'END');
  return bytes;
}
