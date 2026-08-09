import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type FieldCamera, type FieldCameraSet, type Vec3 } from '../nam.js';

/**
 * Kamerasektion (Masterplan Phase 1.4 / 3.2):
 * 🟢 Record: 3 Achsvektoren à 3×i16 (Festkomma, 4096 = 1.0), i16-Wiederholung,
 * Translationsvektor 3×i32, u32-Leerfeld, Zoom u16 = **38 Bytes**.
 * ✅ Realdaten-validiert (Steam-Release, 702 Fields, 2026-08-09):
 * Sektionslängen ausschließlich 38/76/114 — das früher angenommene Pad-u16
 * (40-Byte-Record) existiert nicht.
 */

export const CAM_RECORD_LEN = 38;
export const CAM_FIXED_ONE = 4096;

/** Toleranz für Orthonormalitätsprüfung nach Festkomma-Normierung. */
export const CAM_ORTHO_TOLERANCE = 0.05;

export function parseCameraSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): FieldCameraSet | null {
  if (data.length < CAM_RECORD_LEN || data.length % CAM_RECORD_LEN !== 0) {
    diagnostics.push(
      fdiag('E-CAM-SIZE', field, `Sektionslänge ${data.length} ist kein Vielfaches von ${CAM_RECORD_LEN}`, SECTION.CAMERA),
    );
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cameras: FieldCamera[] = [];
  for (let c = 0; c * CAM_RECORD_LEN < data.length; c++) {
    const base = c * CAM_RECORD_LEN;
    const axesRaw = [0, 1, 2].map(
      (row) =>
        [
          view.getInt16(base + row * 6, true),
          view.getInt16(base + row * 6 + 2, true),
          view.getInt16(base + row * 6 + 4, true),
        ] as Vec3,
    ) as [Vec3, Vec3, Vec3];
    const axisRepeatRaw = view.getInt16(base + 18, true);
    const positionRaw = [
      view.getInt32(base + 20, true),
      view.getInt32(base + 24, true),
      view.getInt32(base + 28, true),
    ] as Vec3;
    // base+32: u32 Leerfeld (konserviert über Rohsektion), base+36: zoom (Recordende)
    const zoom = view.getUint16(base + 36, true);

    const axes = axesRaw.map((row) => row.map((v) => v / CAM_FIXED_ONE) as Vec3) as [Vec3, Vec3, Vec3];
    const orthonormal = isOrthonormal(axes);
    if (!orthonormal) {
      diagnostics.push(
        fdiag('W-CAM-ORTHO', field, `Kamera ${c}: Achsenmatrix außerhalb Toleranz ${CAM_ORTHO_TOLERANCE}`, SECTION.CAMERA),
      );
    }
    cameras.push({ axesRaw, axisRepeatRaw, positionRaw, zoom, axes, orthonormal });
  }
  return { schemaVersion: 1, cameras };
}

function isOrthonormal(axes: [Vec3, Vec3, Vec3]): boolean {
  for (let i = 0; i < 3; i++) {
    const len = Math.hypot(...axes[i]!);
    if (Math.abs(len - 1) > CAM_ORTHO_TOLERANCE) return false;
    for (let j = i + 1; j < 3; j++) {
      const dot =
        axes[i]![0] * axes[j]![0] + axes[i]![1] * axes[j]![1] + axes[i]![2] * axes[j]![2];
      if (Math.abs(dot) > CAM_ORTHO_TOLERANCE) return false;
    }
  }
  return true;
}
