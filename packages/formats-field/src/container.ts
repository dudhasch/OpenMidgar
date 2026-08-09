import { fdiag, type FieldDiagnostic, type FieldDiagnosticCode } from './diagnostics.js';
import { decompressLzsEntry, LzsError, type LzsOptions } from './lzs.js';
import { SECTION, type FieldBundle } from './nam.js';
import { parseBackgroundSection } from './sections/background.js';
import { parseCameraSection } from './sections/camera.js';
import { parseModelLoaderSection } from './sections/model-loader.js';
import { parsePaletteSection } from './sections/palette.js';
import { parseScriptSection } from './sections/script.js';
import { parseTriggersSection } from './sections/triggers.js';
import { parseWalkmeshSection } from './sections/walkmesh.js';

/**
 * Field-Container (Masterplan Phase 1.4, Formatmatrix):
 * 🟢 Zeigertabelle auf 9 Sektionen, jede Sektion mit u32-Längenvorsatz.
 * Header: 🟡 führendes u16 (erwartet 0), u32 Sektionsanzahl, n×u32 absolute
 * Zeiger. Verhalten: sektionsweise Quarantäne (E-FLD-SEC<n>) statt Abbruch;
 * nur ein unbrauchbarer Header ist fatal (E-FLD-HDR).
 */

export const FLD_EXPECTED_SECTIONS = 9;
export const FLD_MAX_SECTIONS = 32;

export interface FieldParseResult {
  /** false nur bei E-FLD-HDR / E-LZS-STREAM (Field unbrauchbar). */
  ok: boolean;
  bundle?: FieldBundle;
  diagnostics: FieldDiagnostic[];
}

/** Parst einen bereits dekomprimierten Field-Container. */
export function parseFieldContainer(bytes: Uint8Array, fieldId: string): FieldParseResult {
  const diagnostics: FieldDiagnostic[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 6) {
    diagnostics.push(fdiag('E-FLD-HDR', fieldId, `Container kleiner als Header (${bytes.length} B)`));
    return { ok: false, diagnostics };
  }
  const magic = view.getUint16(0, true);
  if (magic !== 0) {
    diagnostics.push(fdiag('W-FLD-MAGIC', fieldId, `führendes u16 = ${magic} (erwartet 0)`));
  }
  const sectionCount = view.getUint32(2, true);
  if (sectionCount === 0 || sectionCount > FLD_MAX_SECTIONS) {
    diagnostics.push(fdiag('E-FLD-HDR', fieldId, `Sektionsanzahl unplausibel: ${sectionCount}`));
    return { ok: false, diagnostics };
  }
  if (sectionCount !== FLD_EXPECTED_SECTIONS) {
    diagnostics.push(
      fdiag('W-FLD-SECCOUNT', fieldId, `Sektionsanzahl ${sectionCount} != ${FLD_EXPECTED_SECTIONS} (🟡 releaseabhängig)`),
    );
  }
  const headerEnd = 6 + sectionCount * 4;
  if (headerEnd > bytes.length) {
    diagnostics.push(fdiag('E-FLD-HDR', fieldId, 'Zeigertabelle überschreitet Containergröße'));
    return { ok: false, diagnostics };
  }

  // Zeiger lesen und je Sektion strukturell validieren (monoton, in Bounds,
  // Längenvorsatz konsistent). Defekte Sektionen → Quarantäne, Rest bleibt nutzbar.
  const rawSections: Record<number, Uint8Array> = {};
  const quarantinedSections: number[] = [];
  let prevPtr = 0;
  for (let s = 0; s < sectionCount; s++) {
    const sectionNo = s + 1;
    const quarantine = (detail: string): void => {
      quarantinedSections.push(sectionNo);
      diagnostics.push(fdiag(`E-FLD-SEC${sectionNo}` as FieldDiagnosticCode, fieldId, detail, sectionNo));
    };
    const ptr = view.getUint32(6 + s * 4, true);
    if (ptr < headerEnd || ptr + 4 > bytes.length) {
      quarantine(`Zeiger ${ptr} außerhalb des Containers`);
      continue;
    }
    if (ptr <= prevPtr) {
      quarantine(`Zeiger ${ptr} nicht monoton steigend (vorher ${prevPtr})`);
      continue;
    }
    prevPtr = ptr;
    const sectionLen = view.getUint32(ptr, true);
    if (ptr + 4 + sectionLen > bytes.length) {
      quarantine(`Sektionslänge ${sectionLen} überschreitet Containerende`);
      continue;
    }
    rawSections[sectionNo] = bytes.subarray(ptr + 4, ptr + 4 + sectionLen);
  }

  const bundle: FieldBundle = {
    schemaVersion: 1,
    fieldId,
    sectionCount,
    rawSections,
    quarantinedSections,
    enterable: false,
    diagnostics,
  };

  // Semantische Sektionsparser — Fehlschlag degradiert nur die eine Sektion.
  const trySection = <T>(
    sectionNo: number,
    parse: (data: Uint8Array) => T | null,
    assign: (value: T) => void,
  ): void => {
    const data = rawSections[sectionNo];
    if (!data) return;
    try {
      const value = parse(data);
      if (value !== null) assign(value);
      else quarantineSemantic(sectionNo);
    } catch (err) {
      diagnostics.push(
        fdiag(`E-FLD-SEC${sectionNo}` as FieldDiagnosticCode, fieldId, `Parser-Ausnahme: ${(err as Error).message}`, sectionNo),
      );
      quarantineSemantic(sectionNo);
    }
  };
  const quarantineSemantic = (sectionNo: number): void => {
    if (!quarantinedSections.includes(sectionNo)) quarantinedSections.push(sectionNo);
  };

  trySection(SECTION.SCRIPT, (d) => parseScriptSection(d, fieldId, diagnostics), (v) => (bundle.script = v));
  trySection(SECTION.CAMERA, (d) => parseCameraSection(d, fieldId, diagnostics), (v) => (bundle.cameras = v));
  trySection(SECTION.MODEL_LOADER, (d) => parseModelLoaderSection(d, fieldId, diagnostics), (v) => (bundle.models = v));
  trySection(SECTION.WALKMESH, (d) => parseWalkmeshSection(d, fieldId, diagnostics), (v) => (bundle.walkmesh = v));
  trySection(SECTION.TRIGGERS, (d) => parseTriggersSection(d, fieldId, diagnostics), (v) => (bundle.triggers = v));
  trySection(SECTION.PALETTE, (d) => parsePaletteSection(d, fieldId, diagnostics), (v) => (bundle.palette = v));
  trySection(SECTION.BACKGROUND, (d) => parseBackgroundSection(d, fieldId, diagnostics), (v) => (bundle.background = v));

  bundle.enterable = bundle.walkmesh !== undefined;
  return { ok: true, bundle, diagnostics };
}

/** Kompletter Eintragspfad: LZS-Rahmen dekomprimieren, dann Container parsen. */
export function parseFieldEntry(
  compressed: Uint8Array,
  fieldId: string,
  opts: LzsOptions = {},
): FieldParseResult {
  let decompressed: Uint8Array;
  try {
    decompressed = decompressLzsEntry(compressed, opts);
  } catch (err) {
    if (err instanceof LzsError) {
      return { ok: false, diagnostics: [fdiag('E-LZS-STREAM', fieldId, err.message)] };
    }
    throw err; // AbortError u. ä. propagieren unverändert
  }
  return parseFieldContainer(decompressed, fieldId);
}
