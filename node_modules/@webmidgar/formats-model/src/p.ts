import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import type { MeshSource, Submesh } from './nam.js';
import type { ParseResult } from './hrc.js';

/**
 * `.p`-Parser — Layout realdaten-validiert (model-probe, 2026-08-09, 4180
 * Dateien): 128-B-Header, Pools in dokumentierter Reihenfolge, Renderstate-
 * Blöcke à 100 B, Gruppen à 56 B, BBox-Records à 28 B, Normalindex-Tabelle
 * 4·nVertices. Ausgabe ist der vereinheitlichte Vertexstream nach
 * Index-Flattening (Deduplikation); defekte Gruppen werden laut
 * Validierungsmatrix ausgelassen (W-P-GROUP), nicht fatal.
 */

const HEADER_LEN = 128;
const POLY_LEN = 24;
const HUNDRED_LEN = 100;
const GROUP_LEN = 56;
const BBOX_LEN = 28;

export function parseP(bytes: Uint8Array, asset: string): ParseResult<MeshSource> {
  const diagnostics: ModelDiagnostic[] = [];
  const fail = (message: string): ParseResult<MeshSource> => {
    diagnostics.push(mdiag('E-P-SIZE', asset, message));
    return { value: null, diagnostics };
  };
  if (bytes.length < HEADER_LEN) return fail(`Datei kürzer als Header (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const nVertices = view.getUint32(0x0c, true);
  const nNormals = view.getUint32(0x10, true);
  const nUnknown1 = view.getUint32(0x14, true);
  const nTexCs = view.getUint32(0x18, true);
  const nVertexColors = view.getUint32(0x1c, true);
  const nEdges = view.getUint32(0x20, true);
  const nPolys = view.getUint32(0x24, true);
  const nHundreds = view.getUint32(0x30, true);
  const nGroups = view.getUint32(0x34, true);
  const nBBoxes = view.getUint32(0x38, true);

  const offVertices = HEADER_LEN;
  const offNormals = offVertices + nVertices * 12;
  const offUnknown1 = offNormals + nNormals * 12;
  const offTexCs = offUnknown1 + nUnknown1 * 12;
  const offVertexColors = offTexCs + nTexCs * 8;
  const offPolyColors = offVertexColors + nVertexColors * 4;
  const offEdges = offPolyColors + nPolys * 4;
  const offPolys = offEdges + nEdges * 4;
  const offHundreds = offPolys + nPolys * POLY_LEN;
  const offGroups = offHundreds + nHundreds * HUNDRED_LEN;
  const offBBoxes = offGroups + nGroups * GROUP_LEN;
  const offNormalIndex = offBBoxes + nBBoxes * BBOX_LEN;
  const expected = offNormalIndex + nVertices * 4;
  if (expected !== bytes.length) {
    return fail(`Size-Accounting: erwartet ${expected} B, tatsächlich ${bytes.length} B`);
  }

  // --- Gruppenweises Index-Flattening mit Deduplikation ---------------------
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const submeshes: Submesh[] = [];
  let droppedGroups = 0;

  for (let g = 0; g < nGroups; g++) {
    const go = offGroups + g * GROUP_LEN;
    const polyStart = view.getUint32(go + 4, true);
    const polyCount = view.getUint32(go + 8, true);
    const vertexStart = view.getUint32(go + 12, true);
    const vertexCount = view.getUint32(go + 16, true);
    const texCoordStart = view.getUint32(go + 44, true);
    const textured = view.getUint32(go + 48, true) !== 0;
    const textureIndex = view.getUint32(go + 52, true);

    // Gruppenvalidierung — defekte Gruppe wird ausgelassen (Degradierung).
    const groupBroken = (why: string): void => {
      diagnostics.push(mdiag('W-P-GROUP', asset, `Gruppe ${g} ausgelassen: ${why}`));
      droppedGroups++;
    };
    if (polyStart + polyCount > nPolys) {
      groupBroken(`Polygonbereich [${polyStart}, ${polyStart + polyCount}) > ${nPolys}`);
      continue;
    }
    if (vertexStart + vertexCount > nVertices) {
      groupBroken(`Vertexbereich [${vertexStart}, ${vertexStart + vertexCount}) > ${nVertices}`);
      continue;
    }
    if (textured && texCoordStart + vertexCount > nTexCs) {
      groupBroken(`TexCoord-Bereich [${texCoordStart}, ${texCoordStart + vertexCount}) > ${nTexCs}`);
      continue;
    }

    const startIndex = indices.length;
    const dedupe = new Map<string, number>();
    let broken = false;
    for (let p = polyStart; p < polyStart + polyCount && !broken; p++) {
      const po = offPolys + p * POLY_LEN;
      for (let corner = 0; corner < 3; corner++) {
        // 🟡 Vertexindizes relativ zum Gruppen-Vertexstart (dokumentierte
        // Konvention); Normalenindizes ebenfalls gruppenrelativ zu prüfen —
        // Realdaten-Sweep entscheidet (E-P-BOUNDS-Rate).
        const relV = view.getUint16(po + 2 + corner * 2, true);
        const relN = view.getUint16(po + 8 + corner * 2, true);
        if (relV >= vertexCount) {
          diagnostics.push(mdiag('E-P-BOUNDS', asset, `Gruppe ${g}, Polygon ${p}: Vertexindex ${relV} ≥ ${vertexCount}`));
          broken = true;
          break;
        }
        const absV = vertexStart + relV;
        const absN = relN < nNormals ? relN : -1;
        const uvIdx = textured ? texCoordStart + relV : -1;
        const key = `${absV}/${absN}/${uvIdx}`;
        let unified = dedupe.get(key);
        if (unified === undefined) {
          unified = positions.length / 3;
          dedupe.set(key, unified);
          const vo = offVertices + absV * 12;
          positions.push(view.getFloat32(vo, true), view.getFloat32(vo + 4, true), view.getFloat32(vo + 8, true));
          if (absN >= 0) {
            const no = offNormals + absN * 12;
            normals.push(view.getFloat32(no, true), view.getFloat32(no + 4, true), view.getFloat32(no + 8, true));
          } else {
            normals.push(0, 0, 1);
          }
          if (uvIdx >= 0) {
            const to = offTexCs + uvIdx * 8;
            uvs.push(view.getFloat32(to, true), view.getFloat32(to + 4, true));
          } else {
            uvs.push(0, 0);
          }
          if (absV < nVertexColors) {
            const co = offVertexColors + absV * 4;
            // Ablage BGRA → RGBA (🟡).
            colors.push(bytes[co + 2]!, bytes[co + 1]!, bytes[co]!, bytes[co + 3]!);
          } else {
            colors.push(255, 255, 255, 255);
          }
        }
        indices.push(unified);
      }
    }
    if (broken) {
      // Bereits geschriebene Indices der Gruppe zurücknehmen.
      indices.length = startIndex;
      droppedGroups++;
      continue;
    }
    submeshes.push({ start: startIndex, count: indices.length - startIndex, textured, textureIndex });
  }

  return {
    value: {
      schemaVersion: 1,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Uint8Array(colors),
      indices: new Uint32Array(indices),
      submeshes,
      droppedGroups,
      diagnostics,
    },
    diagnostics,
  };
}
