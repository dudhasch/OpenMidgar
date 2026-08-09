import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldPalette } from '../nam.js';

/**
 * Palettensektion (Sektion 4) — ✅ Realdaten-validiert (702/702, bg-probe
 * 2026-08-09): 12-B-Header (u32, u16 palX, u16 palY, u16 colorsPerPage,
 * u16 pageCount) + pageCount·256·u16 Farben.
 *
 * Farbdekodierung BGR555 → RGBA8: Bits 0–4 = R, 5–9 = G, 10–14 = B,
 * Bit 15 = Maskenbit (🟡 `Zu validieren` gegen Referenzbild; Rohwert bleibt
 * über die Seitenrekonstruktion erhalten, da 5→8-Bit-Expansion umkehrbar).
 */

export const PAL_HEADER_LEN = 12;
export const PAL_PAGE_COLORS = 256;

export function decodeBgr555(value: number): [number, number, number, number] {
  const r = (value & 0x1f) << 3;
  const g = ((value >> 5) & 0x1f) << 3;
  const b = ((value >> 10) & 0x1f) << 3;
  // 5-Bit auf 8-Bit expandieren (obere Bits replizieren, verlustfrei umkehrbar).
  return [r | (r >> 5), g | (g >> 5), b | (b >> 5), value === 0 ? 0 : 255];
}

export function parsePaletteSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldPalette | null {
  if (data.length < PAL_HEADER_LEN) {
    diagnostics.push(fdiag('E-PAL-SIZE', field, `Sektion kürzer als Header (${data.length} B)`, SECTION.PALETTE));
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pageCount = view.getUint16(10, true);
  const expected = PAL_HEADER_LEN + pageCount * PAL_PAGE_COLORS * 2;
  if (expected !== data.length) {
    diagnostics.push(
      fdiag('E-PAL-SIZE', field, `erwartet ${expected} B (${pageCount} Seiten), tatsächlich ${data.length}`, SECTION.PALETTE),
    );
    return null;
  }
  const pages: Uint8Array[] = [];
  for (let p = 0; p < pageCount; p++) {
    const rgba = new Uint8Array(PAL_PAGE_COLORS * 4);
    for (let c = 0; c < PAL_PAGE_COLORS; c++) {
      const value = view.getUint16(PAL_HEADER_LEN + (p * PAL_PAGE_COLORS + c) * 2, true);
      rgba.set(decodeBgr555(value), c * 4);
    }
    pages.push(rgba);
  }
  return {
    schemaVersion: 1,
    headerRaw: [view.getUint32(0, true), view.getUint16(4, true), view.getUint16(6, true), view.getUint16(8, true)],
    pages,
  };
}
