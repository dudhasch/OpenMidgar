import { kdiag, type KernelDiagnostic } from './diagnostics.js';
import { gunzip } from './gzip.js';

/**
 * `WINDOW.BIN` (data/kernel/) — Fontbild, Fensterbild und **Glyphenbreiten**.
 *
 * Aufbau 🟢 (realdatenbelegt, Accounting geht byteexakt auf): drei Sektionen
 * mit demselben 6-Byte-Kopf wie `kernel.bin` (u16 komprimiert, u16 entpackt,
 * u16 Typ) und je einem gzip-Strom; dahinter genau zwei Nullbytes.
 *
 *   Sektion 0 — TIM, 256×256 @ 4 bpp: Fenster-/Menügrafik
 *   Sektion 1 — TIM, 256×252 @ 4 bpp: Fontblatt, 21×21 Zellen à 12×12 px
 *   Sektion 2 — Breitentabelle; die ersten 256 Byte sind die Zeichenbreiten
 *
 * **Warum das hier liegt und nicht in `formats-field`:** Die Datei wohnt in
 * `data/kernel/` neben `KERNEL.BIN`, teilt deren Sektionskopf und deren
 * gzip-Weg. Sie ist Kerneldaten, kein Feldinhalt.
 */

/** 🟢 Zellenraster des Fontblatts (aus dem Bild gemessen, siehe unten). */
export const FONT_CELL = 12;
export const FONT_CELLS_PER_ROW = 21;

/**
 * Breite eines Zeichens aus dem Tabellenbyte.
 *
 * 🟢 **Unabhängig belegt.** Die Regel stammt aus einer Fremdbeschreibung
 * (docs/fremdquellen/touphscript.md §4.1), ist hier aber gegen die
 * Spieldateien nachgemessen worden — ohne sie zu übernehmen: Für 194 der
 * 212 belegten Glyphen der deutschen Fassung gilt exakt
 * `Breite = Tintenbreite_im_Fontblatt + 1`, wobei die Tintenbreite direkt
 * aus Sektion 1 gemessen wurde. Beispiele: `i`/`l`/`I` = 3, `O` = 9,
 * `M`/`W`/`m`/`w` = 11 — genau die Rangfolge, die das Fontblatt zeigt.
 *
 * Die 12–15 Einträge mit gesetzten oberen Bits (`"` `(` `)` `,` `.` `1` `:`
 * und einige Akzentgroßbuchstaben) folgen dieser Faustregel *nicht*; für sie
 * entscheidet erst die Fenstermessung gegen echte `WINDOW`-Opcodes, welche
 * Auslegung stimmt (siehe `tools/realdata-scan/src/glyph-metrik-probe.rdtest.ts`).
 */
export function decodeGlyphWidth(b: number): number {
  return (b & 0x1f) + (b >> 5);
}

/** Ein TIM-Bild (PSX-Standardcontainer), so weit hier gebraucht. */
export interface TimImage {
  /** Bits pro Pixel laut Kopf (hier immer 4). */
  bpp: number;
  width: number;
  height: number;
  /** Palettenfarben als RGBA8, `clutWidth` Einträge je Zeile. */
  palette: Uint8Array;
  clutWidth: number;
  clutHeight: number;
  /** Palettenindizes, ein Byte je Pixel (aus 4 bpp entpackt). */
  indices: Uint8Array;
}

export interface WindowBinSection {
  index: number;
  compressedLength: number;
  declaredLength: number;
  typeRaw: number;
  data: Uint8Array;
}

export interface WindowBin {
  schemaVersion: 1;
  sections: WindowBinSection[];
  /** Nullbytes hinter der letzten Sektion (Original: 2). */
  trailerLength: number;
  /** Die ersten 256 Byte der dritten Sektion, unverändert. */
  rawGlyphBytes: Uint8Array;
  /** Dekodierte Vorschubbreiten in Pixeln, Index = Textbyte. */
  glyphWidths: Uint8Array;
  /** Fensterschale/Menügrafik (Sektion 0); null, wenn unlesbar. */
  windowTexture: TimImage | null;
  /** Fontblatt (Sektion 1); null, wenn unlesbar. */
  fontTexture: TimImage | null;
  diagnostics: KernelDiagnostic[];
}

const HEADER_LEN = 6;
const TRAILER_MAX = 2;

/**
 * TIM-Block lesen.
 *
 * ⚠️ **Accounting-Fallstrick, realdatenbelegt:** In Sektion 1 nennt das
 * Längenfeld des Bildblocks 16 140 Byte, die Maße (64 u16 × 252) verlangen
 * aber 32 256 Byte — und nur mit den Maßen füllt der Block die Sektion
 * byteexakt aus (544 + 32 256 = 32 800). Das Längenfeld ist dort schlicht
 * falsch; maßgeblich sind Breite und Höhe. In Sektion 0 stimmen beide.
 */
function parseTim(data: Uint8Array): TimImage | null {
  if (data.length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 0x10) return null;
  const flags = view.getUint32(4, true);
  const pmode = flags & 0x7;
  if (pmode !== 0) return null; // hier nur 4 bpp
  let at = 8;
  let palette = new Uint8Array(0);
  let clutWidth = 0;
  let clutHeight = 0;
  if (flags & 0x8) {
    const blockLen = view.getUint32(at, true);
    clutWidth = view.getUint16(at + 8, true);
    clutHeight = view.getUint16(at + 10, true);
    const count = clutWidth * clutHeight;
    if (at + 12 + count * 2 > data.length) return null;
    palette = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const c = view.getUint16(at + 12 + i * 2, true);
      // BGR555 mit STP-Bit; Index 0 gilt als durchsichtig.
      palette[i * 4 + 0] = ((c & 0x1f) * 255) / 31;
      palette[i * 4 + 1] = (((c >> 5) & 0x1f) * 255) / 31;
      palette[i * 4 + 2] = (((c >> 10) & 0x1f) * 255) / 31;
      palette[i * 4 + 3] = c === 0 ? 0 : 255;
    }
    at += blockLen;
  }
  if (at + 12 > data.length) return null;
  const wUnits = view.getUint16(at + 8, true);
  const height = view.getUint16(at + 10, true);
  const width = wUnits * 4; // 4 Pixel je u16 bei 4 bpp
  const pixStart = at + 12;
  const need = wUnits * 2 * height;
  if (pixStart + need > data.length) return null;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < need; i++) {
    const b = data[pixStart + i]!;
    indices[i * 2] = b & 0x0f;
    indices[i * 2 + 1] = (b >> 4) & 0x0f;
  }
  return { bpp: 4, width, height, palette, clutWidth, clutHeight, indices };
}

/**
 * Liest `WINDOW.BIN`. Der Aufrufer bekommt immer ein Ergebnis; was nicht
 * gelesen werden konnte, steht als Diagnose drin — stilles Raten gibt es
 * nicht. Ohne brauchbare Breitensektion bleibt `glyphWidths` leer (Länge 0),
 * damit der Aufrufer den Rückfall bewusst wählen muss.
 */
export async function parseWindowBin(bytes: Uint8Array, asset: string): Promise<WindowBin> {
  const diagnostics: KernelDiagnostic[] = [];
  const sections: WindowBinSection[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 0;
  let index = 0;
  while (bytes.length - offset > TRAILER_MAX) {
    if (offset + HEADER_LEN > bytes.length) break;
    const compressedLength = view.getUint16(offset, true);
    const declaredLength = view.getUint16(offset + 2, true);
    const typeRaw = view.getUint16(offset + 4, true);
    const start = offset + HEADER_LEN;
    if (compressedLength <= 0 || start + compressedLength > bytes.length) break;
    if (bytes[start] !== 0x1f || bytes[start + 1] !== 0x8b) break;
    let data: Uint8Array;
    try {
      data = await gunzip(bytes.subarray(start, start + compressedLength));
    } catch (err) {
      diagnostics.push(
        kdiag('E-KRN-GZIP', asset, `gzip-Strom defekt: ${(err as Error).message}`, index),
      );
      break;
    }
    sections.push({ index, compressedLength, declaredLength, typeRaw, data });
    offset = start + compressedLength;
    index++;
  }

  // Accounting: Sektionen + genullter Rest müssen die Datei füllen.
  let trailerLength = bytes.length - offset;
  let trailerZeroed = true;
  for (let i = offset; i < bytes.length; i++) if (bytes[i] !== 0) trailerZeroed = false;
  if (trailerLength > TRAILER_MAX || !trailerZeroed) {
    diagnostics.push(
      kdiag(
        'E-WIN-ACCOUNT',
        asset,
        `${sections.length} Sektionen rechnen ${offset} von ${bytes.length} B ab; Rest ${trailerLength} B${trailerZeroed ? '' : ' (nicht genullt)'}`,
      ),
    );
    trailerLength = bytes.length - offset;
  }
  if (sections.length !== 3) {
    diagnostics.push(kdiag('E-WIN-SECTIONS', asset, `${sections.length} statt 3 Sektionen`));
  }

  const widthSection = sections[2]?.data;
  let rawGlyphBytes = new Uint8Array(0);
  let glyphWidths = new Uint8Array(0);
  if (!widthSection || widthSection.length < 256) {
    diagnostics.push(
      kdiag('E-WIN-WIDTHS', asset, `Breitensektion ${widthSection?.length ?? 0} B, < 256`),
    );
  } else {
    rawGlyphBytes = widthSection.slice(0, 256);
    glyphWidths = Uint8Array.from(rawGlyphBytes, decodeGlyphWidth);
  }

  const windowTexture = sections[0] ? parseTim(sections[0].data) : null;
  const fontTexture = sections[1] ? parseTim(sections[1].data) : null;
  for (const [i, tim] of [windowTexture, fontTexture].entries()) {
    if (sections[i] && tim === null) {
      diagnostics.push(kdiag('W-WIN-TIM', asset, 'TIM-Block nicht lesbar', i));
    }
  }

  return {
    schemaVersion: 1,
    sections,
    trailerLength,
    rawGlyphBytes,
    glyphWidths,
    windowTexture,
    fontTexture,
    diagnostics,
  };
}

/**
 * Tintenbreite je Zeichenzelle des Fontblatts — die **unabhängige Gegenprobe**
 * zur Breitentabelle: Sie liest nur Pixel, nie die Tabelle. Rückgabe: 256
 * Werte; `0` heißt „Zelle leer" bzw. „außerhalb des Blattes".
 */
export function measureGlyphInkWidths(font: TimImage): Uint8Array {
  const out = new Uint8Array(256);
  for (let code = 0; code < 256; code++) {
    const col = code % FONT_CELLS_PER_ROW;
    const row = Math.floor(code / FONT_CELLS_PER_ROW);
    const x0 = col * FONT_CELL;
    const y0 = row * FONT_CELL;
    if (y0 + FONT_CELL > font.height || x0 + FONT_CELL > font.width) continue;
    let max = -1;
    for (let y = 0; y < FONT_CELL; y++) {
      for (let x = 0; x < FONT_CELL; x++) {
        if (font.indices[(y0 + y) * font.width + x0 + x]) max = Math.max(max, x);
      }
    }
    out[code] = max + 1;
  }
  return out;
}
