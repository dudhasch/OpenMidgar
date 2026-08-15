import { mdiag, type ModelDiagnostic } from './diagnostics.js';
import { isFlatShaded, type MaterialClass, type MeshSource, type Submesh } from './nam.js';
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

/** Kopfzähler des `.p`-Layouts — Grundlage von Size-Accounting UND Parser. */
function pCounts(view: DataView): {
  nVertices: number;
  nNormals: number;
  nUnknown1: number;
  nTexCs: number;
  nVertexColors: number;
  nEdges: number;
  nPolys: number;
  nHundreds: number;
  nGroups: number;
  nBBoxes: number;
} {
  return {
    nVertices: view.getUint32(0x0c, true),
    nNormals: view.getUint32(0x10, true),
    nUnknown1: view.getUint32(0x14, true),
    nTexCs: view.getUint32(0x18, true),
    nVertexColors: view.getUint32(0x1c, true),
    nEdges: view.getUint32(0x20, true),
    nPolys: view.getUint32(0x24, true),
    nHundreds: view.getUint32(0x30, true),
    nGroups: view.getUint32(0x34, true),
    nBBoxes: view.getUint32(0x38, true),
  };
}

/**
 * 🟢 INHALTS-SIGNATUR `.p` — das Size-Accounting des Kopfes ohne den teuren
 * Parserlauf. Damit lassen sich Archiveinträge nach INHALT klassifizieren,
 * statt Dateinamen zu raten (Battle-Modell-Lader K1/K2).
 *
 * Gemessen an battle.lgp (11.119 Einträge, 2026-08-11): trifft auf **8979**
 * Einträge zu. Kontrollhypothesen, alle bestanden:
 *  - Die 872 Einträge der `ab`/`da`-Familie (Animationsformate, echte
 *    Nicht-Geometrie) treffen die Signatur **0-mal**.
 *  - Überschneidung mit `hasTexSignature`: **0**, mit der Skelettgrammatik
 *    (52+12·n): **0** — die drei Signaturen sind am Bestand disjunkt.
 *  - Die Zusatzwache `nVertices>0 && nGroups>0` schließt den trivialen
 *    Nulltreffer (128 genullte Bytes) aus und ändert am Bestand nichts
 *    (8979 mit und ohne Wache; kleinste echte `.p`-Datei 436 B).
 */
export function hasPSignature(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LEN) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const c = pCounts(view);
  if (c.nVertices === 0 || c.nGroups === 0) return false;
  return expectedPLength(c) === bytes.length;
}

function expectedPLength(c: ReturnType<typeof pCounts>): number {
  return (
    HEADER_LEN +
    c.nVertices * 12 +
    c.nNormals * 12 +
    c.nUnknown1 * 12 +
    c.nTexCs * 8 +
    c.nVertexColors * 4 +
    c.nPolys * 4 + // Polygonfarben
    c.nEdges * 4 +
    c.nPolys * POLY_LEN +
    c.nHundreds * HUNDRED_LEN +
    c.nGroups * GROUP_LEN +
    c.nBBoxes * BBOX_LEN +
    c.nVertices * 4 // Normalindex-Tabelle
  );
}

export function parseP(bytes: Uint8Array, asset: string): ParseResult<MeshSource> {
  const diagnostics: ModelDiagnostic[] = [];
  const fail = (message: string): ParseResult<MeshSource> => {
    diagnostics.push(mdiag('E-P-SIZE', asset, message));
    return { value: null, diagnostics };
  };
  if (bytes.length < HEADER_LEN) return fail(`Datei kürzer als Header (${bytes.length} B)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const counts = pCounts(view);
  const {
    nVertices,
    nNormals,
    nUnknown1,
    nTexCs,
    nVertexColors,
    nEdges,
    nPolys,
    nHundreds,
    nGroups,
    nBBoxes,
  } = counts;

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
  const expected = expectedPLength(counts);
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
    // `p_group+0x00` — Materialklasse C/G/T/D/H (siehe `MaterialClass`).
    const rawKind = view.getInt32(go, true);
    const materialClass = (rawKind >= 0 && rawKind <= 4 ? rawKind : 1) as MaterialClass;

    // Schattierungsmodus. **Maßgeblich ist der Renderstate-Block**, nicht die
    // Materialklasse: Zur Laufzeit liest das Original `p_hundred+0x24`
    // (D3DSHADE_FLAT 1 / D3DSHADE_GOURAUD 2) und gibt ihn als
    // `D3DRENDERSTATE_SHADEMODE` aus; für `p_group+0x00` ist im Dekompilat
    // **kein** Leser zur Laufzeit belegt — es ist der Eimerschlüssel des
    // Konverters.
    //
    // 🟢 Beide stimmen im Bestand überein — gemessen, nicht übernommen
    // (`model-shading-probe`): 4180/4180 Dateien tragen genau einen Block je
    // Gruppe, `+0x24` ist ausnahmslos 1 oder 2, und über alle 4875 Gruppen
    // sind Block und Klasse **4875-mal einig, 0-mal uneinig**. Gelesen wird
    // trotzdem die Angabe, die die Engine liest — das hält auch bei von Hand
    // veränderten `.p`-Dateien.
    //
    // Ohne Blöcke (`nHundreds == 0`, so bauen die 16 engine-erzeugten
    // Primitive) bleibt die Klasse als Rückfall.
    const hundredShade =
      g < nHundreds ? view.getUint32(offHundreds + g * HUNDRED_LEN + 0x24, true) : 0;
    const flat =
      hundredShade === 1 ? true : hundredShade === 2 ? false : isFlatShaded(materialClass);
    // `p_hundred+0x44` — FF7-Blendmodus (0…4, 4 = deckend). Wird noch nicht
    // ausgewertet; für `char.lgp` sind 4852 von 4875 Blöcken deckend, und der
    // Feldlader übergibt Modus 6 („behalte, was die Datei sagt"), plättet also
    // nichts. Mitgeführt, damit die verbleibende Lücke sichtbar bleibt.
    const blendMode = g < nHundreds ? view.getInt32(offHundreds + g * HUNDRED_LEN + 0x44, true) : 4;
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

      // 🟡 Vertexindizes relativ zum Gruppen-Vertexstart (dokumentierte
      // Konvention); Normalenindizes ebenfalls gruppenrelativ zu prüfen —
      // Realdaten-Sweep entscheidet (E-P-BOUNDS-Rate).
      const relV = [0, 1, 2].map((c) => view.getUint16(po + 2 + c * 2, true));
      const relN = [0, 1, 2].map((c) => view.getUint16(po + 8 + c * 2, true));
      const bad = relV.findIndex((v) => v >= vertexCount);
      if (bad >= 0) {
        diagnostics.push(
          mdiag('E-P-BOUNDS', asset, `Gruppe ${g}, Polygon ${p}: Vertexindex ${relV[bad]} ≥ ${vertexCount}`),
        );
        broken = true;
        break;
      }

      // **Umlaufsinn: 0, 2, 1 statt 0, 1, 2.**
      //
      // 🟡 Herkunft (ADR-028): Das Original zeichnet die Vorderseite im
      // UHRZEIGERSINN und schneidet die Rückseite weg — im GL-Zweig gesetzt
      // über `cfg[0] = 1` in `Gl_InitConfigDefaults` (0x006A6AE6, Bytes bei
      // 0x006A6AFA `C7 01 01 00 00 00`), im D3D-Zweig über
      // `D3DRENDERSTATE_CULLMODE = D3DCULL_CW`. three erwartet umgekehrt die
      // Vorderseite GEGEN den Uhrzeigersinn.
      //
      // Diese eine Zeile ist die ganze Brücke zwischen beiden Konventionen.
      // Sie gehört hierher — an die Daten —, nicht in den Renderzustand:
      // `frontFace(CW)` oder `side: DoubleSide` würden dasselbe Bild erzeugen,
      // aber die Ursache verstecken und jede spätere Flächennormale,
      // Kollisions- oder Exportrechnung mit dem falschen Vorzeichen versorgen.
      //
      // Ecke 0 bleibt zuerst — die FLAT-Schattierung unten nimmt weiterhin
      // deren Farbe und Normale, wie D3DSHADE_FLAT es tut.
      const CORNER_ORDER = [0, 2, 1] as const;
      for (const corner of CORNER_ORDER) {
        const absV = vertexStart + relV[corner]!;
        const uvIdx = textured ? texCoordStart + relV[corner]! : -1;
        // FLAT-Gruppen: Direct3D nimmt für das ganze Dreieck die Farbe der
        // ERSTEN Ecke. Statt das im Shader nachzubauen (`flat`-Qualifizierer
        // hätte in GL die LETZTE Ecke genommen, nicht die erste) wird die
        // Schattierungsquelle hier eingebacken: Farbe UND Normale kommen von
        // Ecke 0, die Position bleibt je Ecke. Ergebnis ist über das Dreieck
        // konstant — also byteweise dasselbe wie D3DSHADE_FLAT.
        const shadeCorner = flat ? 0 : corner;
        const shadeV = vertexStart + relV[shadeCorner]!;
        const shadeN = relN[shadeCorner]! < nNormals ? relN[shadeCorner]! : -1;

        const key = `${absV}/${shadeV}/${shadeN}/${uvIdx}`;
        let unified = dedupe.get(key);
        if (unified === undefined) {
          unified = positions.length / 3;
          dedupe.set(key, unified);
          const vo = offVertices + absV * 12;
          positions.push(view.getFloat32(vo, true), view.getFloat32(vo + 4, true), view.getFloat32(vo + 8, true));
          if (shadeN >= 0) {
            const no = offNormals + shadeN * 12;
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
          if (shadeV < nVertexColors) {
            const co = offVertexColors + shadeV * 4;
            // Ablage BGRA → RGBA. 🟢 Sichtgeprüft (B6a, 2026-08-10): An zwei
            // figürlichen Modellen mit abgeschalteten Texturen wurde BGRA
            // einstimmig bestätigt; unter RGBA werden Haare blau und
            // Kleidung weinrot. 🟡 Bestätigt durch das Dekompilat (ADR-028):
            // `polygon_data+0x50` führt einen D3DCOLOR (0xAARRGGBB) je Vertex,
            // little-endian also genau die Bytefolge B,G,R,A.
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
    submeshes.push({
      start: startIndex,
      count: indices.length - startIndex,
      textured,
      textureIndex,
      materialClass,
      flatShaded: flat,
      blendMode,
    });
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
