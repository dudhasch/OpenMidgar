import { fdiag, type FieldDiagnostic } from '../diagnostics.js';
import { SECTION, type Vec3, type Walkmesh, type WalkmeshTriangle } from '../nam.js';

/**
 * Walkmesh-Sektion (🟢 Grundstruktur, Masterplan Phase 1.4):
 * u32 Dreiecksanzahl, dann Vertex-Pool (je Dreieck 3 Vertices à 4×i16
 * x/y/z/res = 24 B), dann Zugänglichkeits-Pool (je Dreieck 3×u16 Nachbar,
 * 0xFFFF = gesperrte Kante).
 */

export const WM_TRIANGLE_LEN = 24;
export const WM_ACCESS_LEN = 6;
export const WM_BLOCKED = 0xffff;

/** Maximal einzeln gemeldete Asymmetrien, danach Sammel-Diagnose. */
const ASYM_REPORT_CAP = 8;

export function parseWalkmeshSection(
  data: Uint8Array,
  field: string,
  diagnostics: FieldDiagnostic[],
): Walkmesh | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 4) {
    diagnostics.push(fdiag('E-WM-COUNT', field, 'Sektion kürzer als Zähler', SECTION.WALKMESH));
    return null;
  }
  const count = view.getUint32(0, true);
  const needed = 4 + count * (WM_TRIANGLE_LEN + WM_ACCESS_LEN);
  if (count === 0 || needed > data.length) {
    diagnostics.push(
      fdiag('E-WM-COUNT', field, `Zähler ${count} passt nicht zur Sektionslänge ${data.length}`, SECTION.WALKMESH),
    );
    return null;
  }

  const accessBase = 4 + count * WM_TRIANGLE_LEN;
  const triangles: WalkmeshTriangle[] = [];
  for (let t = 0; t < count; t++) {
    const vBase = 4 + t * WM_TRIANGLE_LEN;
    const vertices = [0, 1, 2].map((v) => {
      const o = vBase + v * 8;
      return [view.getInt16(o, true), view.getInt16(o + 2, true), view.getInt16(o + 4, true)] as Vec3;
    }) as [Vec3, Vec3, Vec3];

    const aBase = accessBase + t * WM_ACCESS_LEN;
    const adjacency = [0, 1, 2].map((e) => {
      const raw = view.getUint16(aBase + e * 2, true);
      if (raw === WM_BLOCKED) return null;
      if (raw >= count) {
        diagnostics.push(
          fdiag('E-WM-ADJ', field, `Dreieck ${t}, Kante ${e}: Nachbar ${raw} außerhalb (als gesperrt behandelt)`, SECTION.WALKMESH),
        );
        return null;
      }
      return raw;
    }) as [number | null, number | null, number | null];

    const tri: WalkmeshTriangle = { vertices, adjacency };
    if (isDegenerate(vertices)) {
      tri.degenerate = true;
      diagnostics.push(fdiag('W-WM-DEGEN', field, `Dreieck ${t} ist degeneriert`, SECTION.WALKMESH));
    }
    triangles.push(tri);
  }

  // Symmetrie-Check: verweist t auf n, muss n zurückverweisen (Masterplan 3.3).
  let asymCount = 0;
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const n = triangles[t]!.adjacency[e] ?? null;
      if (n === null) continue;
      if (!triangles[n]!.adjacency.includes(t)) {
        asymCount++;
        if (asymCount <= ASYM_REPORT_CAP) {
          diagnostics.push(
            fdiag('W-WM-ASYM', field, `Dreieck ${t} → ${n} ohne Rückverweis`, SECTION.WALKMESH),
          );
        }
      }
    }
  }
  if (asymCount > ASYM_REPORT_CAP) {
    diagnostics.push(
      fdiag('W-WM-ASYM', field, `insgesamt ${asymCount} asymmetrische Kanten`, SECTION.WALKMESH),
    );
  }

  return { schemaVersion: 1, triangleCount: count, triangles };
}

function isDegenerate([a, b, c]: [Vec3, Vec3, Vec3]): boolean {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return cx === 0 && cy === 0 && cz === 0;
}
