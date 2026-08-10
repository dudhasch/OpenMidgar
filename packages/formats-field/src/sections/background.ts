import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type BackgroundLayer, type BackgroundTexturePage, type BackgroundTile, type FieldBackground } from '../nam.js';

/**
 * Hintergrundsektion (Sektion 9) — Layout ✅ realdaten-validiert
 * (bg-/bg-tex-/bg-layer-Proben, 702/702 Fields, 2026-08-09):
 *
 *   5-B-Kopf (u16 0, u16, u8) · "PALETTE" + 24-B-Palettenkopf · "BACK"
 *   Layer 0: u16 w, h, tileCount, depth; tileCount·52-B-Tiles
 *   Layer 1–3: u8 flag; wenn 1: u16 w, h, tileCount + Headerrest
 *     (L1: 16 B, L2: 10 B, L3: 14 B); tileCount·52-B-Tiles
 *   Separator-Regel: nach jedem AKTIVEN Layer-Block stehen 4 Null-Bytes,
 *     sofern noch ein Flag folgt; nach dem Layer-3-Block folgt TEXTURE direkt.
 *   "TEXTURE": 42 Slots {u16 exists; wenn ≠0: u16 size, u16 depth,
 *     65536·depth B Texel} — Datenlänge hängt NUR an depth (Seiten 256×256)
 *   "END" als letzte 3 Bytes.
 *
 * Tile-Record 52 B — Feldzuordnung ✅ realdaten-validiert (S9-Proben 1–3,
 * 647.531 Tiles): dstX i16@4, dstY i16@6, srcX u8@12, srcY u8@14,
 * srcX2 u8@16, srcY2 u8@18, layerControl u16@20 (🟡, je Layer konstant),
 * paletteId u8@24 (99,87 % im Bereich), flags u8@25 (🟡), z u16@26
 * (12 Bit; Layer 0 konstant 4095), textureId u8@34 (99,85 % vorhandener
 * Slot), bpp u8@38, uvX u32@44 / uvY u32@48 = round(src/256·1e7).
 * Der Record bleibt zusätzlich vollständig roh erhalten.
 *
 * Die S8-Annahme „paletteId = u16@20" war falsch (nur 54 % im Bereich) —
 * korrigiert auf u8@24 durch den Teilmengentest gegen die Palettenseiten
 * des jeweiligen Fields.
 */

export const BG_TILE_LEN = 52;
export const BG_TEXTURE_SLOTS = 42;
export const BG_PAGE_TEXELS = 65536; // 256×256
export const BG_LAYER_HEADER_REST: readonly number[] = [2, 16, 10, 14];

/** Skalierung des vorberechneten UV-Cache im Tile-Record (src/256 · 1e7). */
export const BG_UV_SCALE = 1e7;

/**
 * Wirksame Quellkoordinate eines Tiles. Der im Record mitgeführte UV-Cache
 * folgt `src2`, sobald dieses Paar gesetzt ist — die Regel ist damit
 * formatseitig belegt und nicht geraten.
 */
export function effectiveTileSource(tile: BackgroundTile): { x: number; y: number } {
  return tile.srcX2 !== 0 || tile.srcY2 !== 0
    ? { x: tile.srcX2, y: tile.srcY2 }
    : { x: tile.srcX, y: tile.srcY };
}

const MARKERS = { palette: 'PALETTE', back: 'BACK', texture: 'TEXTURE', end: 'END' } as const;

function findAscii(bytes: Uint8Array, text: string, from: number): number {
  outer: for (let i = from; i <= bytes.length - text.length; i++) {
    for (let c = 0; c < text.length; c++) {
      if (bytes[i + c] !== text.charCodeAt(c)) continue outer;
    }
    return i;
  }
  return -1;
}

function parseTiles(data: Uint8Array, view: DataView, start: number, count: number): BackgroundTile[] {
  const tiles: BackgroundTile[] = [];
  for (let t = 0; t < count; t++) {
    const o = start + t * BG_TILE_LEN;
    tiles.push({
      dstX: view.getInt16(o + 4, true),
      dstY: view.getInt16(o + 6, true),
      srcX: data[o + 12]!,
      srcY: data[o + 14]!,
      srcX2: data[o + 16]!,
      srcY2: data[o + 18]!,
      layerControl: view.getUint16(o + 20, true),
      paletteId: data[o + 24]!,
      flags: data[o + 25]!,
      z: view.getUint16(o + 26, true),
      param: data[o + 28]!,
      state: data[o + 29]!,
      blending: data[o + 30]!,
      typeTrans: data[o + 32]!,
      textureId: data[o + 34]!,
      bpp: data[o + 38]!,
      uvX: view.getUint32(o + 44, true),
      uvY: view.getUint32(o + 48, true),
      raw: data.slice(o, o + BG_TILE_LEN),
    });
  }
  return tiles;
}

export function parseBackgroundSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldBackground | null {
  const fail = (code: 'E-BG-HDR' | 'E-BG-LAYER' | 'E-BG-TEX', detail: string): null => {
    diagnostics.push(fdiag(code, field, detail, SECTION.BACKGROUND));
    return null;
  };
  if (data.length < 64) return fail('E-BG-HDR', `Sektion zu kurz (${data.length} B)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const mPal = findAscii(data, MARKERS.palette, 0);
  const mBack = mPal >= 0 ? findAscii(data, MARKERS.back, mPal + 7) : -1;
  const mTex = mBack >= 0 ? findAscii(data, MARKERS.texture, mBack + 4) : -1;
  if (mPal < 0 || mBack < 0 || mTex < 0) {
    return fail('E-BG-HDR', `Marker fehlen (PALETTE@${mPal}, BACK@${mBack}, TEXTURE@${mTex})`);
  }
  const endStart = data.length - 3;
  if (findAscii(data, MARKERS.end, endStart) !== endStart) {
    return fail('E-BG-HDR', 'Sektion endet nicht mit "END"');
  }

  // --- Layer ----------------------------------------------------------------
  const layers: BackgroundLayer[] = [];
  let cursor = mBack + 4;
  let prevActive = false;
  for (let layer = 0; layer < 4; layer++) {
    if (layer > 0) {
      if (prevActive) {
        // Separator nach aktivem Block: 4 Null-Bytes.
        if (cursor + 4 > mTex) return fail('E-BG-LAYER', `Layer ${layer}: Separator überschreitet TEXTURE`);
        for (let z = 0; z < 4; z++) {
          if (data[cursor + z] !== 0) {
            return fail('E-BG-LAYER', `Layer ${layer}: Separator-Bytes nicht 0 (Position ${cursor + z})`);
          }
        }
        cursor += 4;
      }
      if (cursor + 1 > mTex) return fail('E-BG-LAYER', `Layer ${layer}: Flag überschreitet TEXTURE`);
      const flag = data[cursor]!;
      cursor += 1;
      if (flag === 0) {
        prevActive = false;
        continue;
      }
      if (flag !== 1) return fail('E-BG-LAYER', `Layer ${layer}: Flag ${flag} unbekannt`);
    }
    const headerRest = BG_LAYER_HEADER_REST[layer]!;
    if (cursor + 6 + headerRest > mTex) return fail('E-BG-LAYER', `Layer ${layer}: Header überschreitet TEXTURE`);
    const width = view.getUint16(cursor, true);
    const height = view.getUint16(cursor + 2, true);
    const tileCount = view.getUint16(cursor + 4, true);
    const headerRaw = data.slice(cursor + 6, cursor + 6 + headerRest);
    const tilesStart = cursor + 6 + headerRest;
    const tilesEnd = tilesStart + tileCount * BG_TILE_LEN;
    if (tilesEnd > mTex) {
      return fail('E-BG-LAYER', `Layer ${layer}: ${tileCount} Tiles überschreiten TEXTURE (${tilesEnd} > ${mTex})`);
    }
    layers.push({ index: layer, width, height, headerRaw, tiles: parseTiles(data, view, tilesStart, tileCount) });
    cursor = tilesEnd;
    prevActive = true;
  }
  if (cursor !== mTex) {
    return fail('E-BG-LAYER', `Layer-Accounting endet bei ${cursor}, TEXTURE bei ${mTex}`);
  }

  // --- Texturseiten ---------------------------------------------------------
  const texturePages: BackgroundTexturePage[] = [];
  let o = mTex + 7;
  for (let slot = 0; slot < BG_TEXTURE_SLOTS; slot++) {
    if (o + 2 > endStart) return fail('E-BG-TEX', `Slot ${slot}: Slotliste überschreitet END`);
    const exists = view.getUint16(o, true);
    o += 2;
    if (exists === 0) continue;
    if (o + 4 > endStart) return fail('E-BG-TEX', `Slot ${slot}: Kopf überschreitet END`);
    const sizeRaw = view.getUint16(o, true);
    const depth = view.getUint16(o + 2, true);
    if (depth < 1 || depth > 2) return fail('E-BG-TEX', `Slot ${slot}: Texeltiefe ${depth} unplausibel`);
    const dataStart = o + 4;
    const dataEnd = dataStart + BG_PAGE_TEXELS * depth;
    if (dataEnd > endStart) return fail('E-BG-TEX', `Slot ${slot}: Texeldaten überschreiten END`);
    texturePages.push({ slot, depth, sizeRaw, data: data.slice(dataStart, dataEnd) });
    o = dataEnd;
  }
  if (o !== endStart) {
    return fail('E-BG-TEX', `Textur-Accounting endet bei ${o}, END bei ${endStart}`);
  }

  return {
    schemaVersion: 1,
    headerRaw: data.slice(0, Math.min(5, mPal)),
    paletteHeaderRaw: data.slice(mPal + 7, mBack),
    layers,
    texturePages,
  };
}
