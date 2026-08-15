/**
 * Modell-Fixture-Writer (S7): hrc/rsd/p/tex/a — bewusst codegetrennt von den
 * Parsern in packages/formats-model (Dualitätsprinzip). Binärlayouts sind
 * realdaten-validiert (model-probe.rdtest, 2026-08-09):
 *  - .p: 128-B-Header, Pools, BBox-Record 28 B, Normalindex-Tabelle 4·nVerts
 *  - .tex: Header 236 B + Palette (4·paletteSize) + Pixel (b·w·h)
 *  - .a: Header 36 B, Frame = 24 B Wurzel (Rot + Trans) + 12 B je Bone
 */

export type Vec3f = [number, number, number];
export type Rgba = [number, number, number, number];

// --- .hrc (Text) ------------------------------------------------------------

export interface HrcBoneSpec {
  name: string;
  /** Parent-Bone-Name; "root" = Wurzel. */
  parent: string;
  length: number;
  resources?: string[] | undefined;
}

export interface HrcSpec {
  skeletonName: string;
  bones: HrcBoneSpec[];
}

const encoder = new TextEncoder();

export function composeHrc(spec: HrcSpec): Uint8Array {
  const lines: string[] = [':HEADER_BLOCK 2', `:SKELETON ${spec.skeletonName}`, `:BONES ${spec.bones.length}`, ''];
  for (const bone of spec.bones) {
    const res = bone.resources ?? [];
    lines.push(bone.name, bone.parent, bone.length.toString(), res.length === 0 ? '0' : `${res.length} ${res.join(' ')}`, '');
  }
  return encoder.encode(lines.join('\r\n'));
}

// --- .rsd (Text) ------------------------------------------------------------

export interface RsdSpec {
  /** Basisname des Polygonmodells (ohne Endung); wird als PLY=<n>.PLY notiert. */
  ply: string;
  textures?: string[] | undefined;
}

export function composeRsd(spec: RsdSpec): Uint8Array {
  const tex = spec.textures ?? [];
  const lines = [
    '@RSD940102',
    `PLY=${spec.ply.toUpperCase()}.PLY`,
    `MAT=${spec.ply.toUpperCase()}.MAT`,
    `GRP=${spec.ply.toUpperCase()}.GRP`,
    `NTEX=${tex.length}`,
    ...tex.map((t, i) => `TEX[${i}]=${t.toUpperCase()}.TIM`),
    '',
  ];
  return encoder.encode(lines.join('\r\n'));
}

// --- .p (Binär) -------------------------------------------------------------

export interface PPolySpec {
  /** Vertexindizes RELATIV zum Gruppen-Vertexstart (🟡 dokumentierte Konvention). */
  v: [number, number, number];
  /** Normalenindizes (absolut in den Normalenpool). */
  n: [number, number, number];
}

export interface PGroupSpec {
  /** Absoluter Start dieser Gruppe im Vertexpool. */
  vertexStart: number;
  vertexCount: number;
  polys: PPolySpec[];
  textured?: boolean | undefined;
  textureIndex?: number | undefined;
  /** Start in den TexCoord-Pool (nur texturierte Gruppen). */
  texCoordStart?: number | undefined;
  /**
   * Materialklasse (`p_group+0x00`): 0 C, 1 G, 2 T, 3 D, 4 H — sie entscheidet
   * über FLAT (0/2/3) oder GOURAUD (1/4). Default 1 (Gouraud).
   */
  materialClass?: 0 | 1 | 2 | 3 | 4 | undefined;
  /**
   * Schattierung des zugehörigen Renderstate-Blocks (`p_hundred+0x24`):
   * 1 D3DSHADE_FLAT, 2 D3DSHADE_GOURAUD. Ohne Angabe aus `materialClass`
   * abgeleitet — genau wie `Pfile_BuildHundredFromMaterial` es täte. Setze 0,
   * um einen leeren Block zu schreiben und den Rückfall auf die Klasse zu
   * prüfen.
   */
  shadeMode?: 0 | 1 | 2 | undefined;
  /** FF7-Blendmodus des Blocks (`p_hundred+0x44`); Default 4 (deckend). */
  blendMode?: number | undefined;
}

export interface PSpec {
  vertices: Vec3f[];
  normals: Vec3f[];
  texCoords?: [number, number][] | undefined;
  /** Je Vertex eine Farbe (RGBA); Default Weiß. */
  vertexColors?: Rgba[] | undefined;
  groups: PGroupSpec[];
  boundingBoxes?: number | undefined;
}

export function composeP(spec: PSpec): Uint8Array {
  const texCoords = spec.texCoords ?? [];
  const vertexColors = spec.vertexColors ?? spec.vertices.map((): Rgba => [255, 255, 255, 255]);
  const polys = spec.groups.flatMap((g) => g.polys);
  const nV = spec.vertices.length;
  const nN = spec.normals.length;
  const nT = texCoords.length;
  const nP = polys.length;
  const nG = spec.groups.length;
  const nH = nG; // 1 Renderstate-Block ("hundred") je Gruppe
  const nB = spec.boundingBoxes ?? 1;

  const total = 128 + nV * 12 + nN * 12 + nT * 8 + nV * 4 + nP * 4 + nP * 24 + nH * 100 + nG * 56 + nB * 28 + nV * 4;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint32(0x00, 1, true); // version
  view.setUint32(0x08, 1, true); // vertexTyp-Feld (roh konserviert)
  view.setUint32(0x0c, nV, true);
  view.setUint32(0x10, nN, true);
  view.setUint32(0x14, 0, true); // unknown1-Pool ungenutzt
  view.setUint32(0x18, nT, true);
  view.setUint32(0x1c, nV, true); // Vertexfarben
  view.setUint32(0x20, 0, true); // Kanten
  view.setUint32(0x24, nP, true);
  view.setUint32(0x30, nH, true);
  view.setUint32(0x34, nG, true);
  view.setUint32(0x38, nB, true);
  view.setUint32(0x3c, 1, true); // Normalindex-Tabelle vorhanden

  let o = 128;
  for (const v of spec.vertices) {
    view.setFloat32(o, v[0], true);
    view.setFloat32(o + 4, v[1], true);
    view.setFloat32(o + 8, v[2], true);
    o += 12;
  }
  for (const n of spec.normals) {
    view.setFloat32(o, n[0], true);
    view.setFloat32(o + 4, n[1], true);
    view.setFloat32(o + 8, n[2], true);
    o += 12;
  }
  for (const t of texCoords) {
    view.setFloat32(o, t[0], true);
    view.setFloat32(o + 4, t[1], true);
    o += 8;
  }
  for (const c of vertexColors) {
    // Ablage BGRA (dokumentierte Konvention 🟡).
    bytes[o] = c[2];
    bytes[o + 1] = c[1];
    bytes[o + 2] = c[0];
    bytes[o + 3] = c[3];
    o += 4;
  }
  o += nP * 4; // Polygonfarben (0 = schwarz)
  // Kantenpool leer.
  for (const p of polys) {
    view.setUint16(o + 2, p.v[0], true);
    view.setUint16(o + 4, p.v[1], true);
    view.setUint16(o + 6, p.v[2], true);
    view.setUint16(o + 8, p.n[0], true);
    view.setUint16(o + 10, p.n[1], true);
    view.setUint16(o + 12, p.n[2], true);
    o += 24;
  }
  // Renderstate-Blöcke ("hundreds"), einer je Gruppe und in gleicher
  // Reihenfolge — so erzeugt sie `Pfile_BuildGroupsFromFaces` im Original.
  for (const g of spec.groups) {
    const klasse = g.materialClass ?? 1;
    const shade = g.shadeMode ?? (klasse === 1 || klasse === 4 ? 2 : 1);
    view.setUint32(o + 0x24, shade, true); // D3DSHADE_FLAT 1 / GOURAUD 2
    view.setUint32(o + 0x44, g.blendMode ?? 4, true); // FF7-Blendmodus
    o += 100;
  }
  let polyCursor = 0;
  for (const g of spec.groups) {
    view.setUint32(o + 0, g.materialClass ?? 1, true); // Materialklasse C/G/T/D/H
    view.setUint32(o + 4, polyCursor, true);
    view.setUint32(o + 8, g.polys.length, true);
    view.setUint32(o + 12, g.vertexStart, true);
    view.setUint32(o + 16, g.vertexCount, true);
    view.setUint32(o + 44, g.texCoordStart ?? 0, true);
    view.setUint32(o + 48, g.textured ? 1 : 0, true);
    view.setUint32(o + 52, g.textureIndex ?? 0, true);
    polyCursor += g.polys.length;
    o += 56;
  }
  o += nB * 28; // Bounding-Volumen (Runtime berechnet eigene)
  // Normalindex-Tabelle: identische Abbildung.
  for (let i = 0; i < nV; i++) {
    view.setUint32(o, i, true);
    o += 4;
  }
  return bytes;
}

// --- .tex (Binär) -----------------------------------------------------------

export interface TexSpec {
  width: number;
  height: number;
  /** Eine oder mehrere Paletten à `colorsPerPalette` Einträgen. */
  palettes: Rgba[][];
  /** Palettenindizes, width·height Einträge. */
  pixels: number[];
  /**
   * Farbschlüssel-Schalter bei 0x08. Ohne Angabe wird er aus dem Alpha des
   * ersten Paletteneintrags abgeleitet — so verhält sich der Bestand
   * (695/695, `tex-alpha-probe`). Explizit setzbar, damit eine Fixture den
   * Widerspruch zwischen Kopf und Palette absichtlich herstellen kann.
   */
  colorKey?: boolean | undefined;
}

export function composeTex(spec: TexSpec): Uint8Array {
  const colorsPerPalette = spec.palettes[0]?.length ?? 0;
  const paletteSize = spec.palettes.length * colorsPerPalette;
  const bytes = new Uint8Array(236 + paletteSize * 4 + spec.width * spec.height);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x00, 1, true); // version
  const schluessel = spec.colorKey ?? (spec.palettes[0]?.[0]?.[3] === 0);
  view.setUint32(0x08, schluessel ? 1 : 0, true); // colorKeyFlag
  view.setUint32(0x30, spec.palettes.length, true);
  view.setUint32(0x34, colorsPerPalette, true);
  view.setUint32(0x38, 8, true); // bitDepth
  view.setUint32(0x3c, spec.width, true);
  view.setUint32(0x40, spec.height, true);
  view.setUint32(0x44, spec.width, true); // pitch
  view.setUint32(0x4c, 1, true); // hasPalette
  view.setUint32(0x50, 8, true); // bitsPerIndex
  view.setUint32(0x58, paletteSize, true);
  view.setUint32(0x5c, colorsPerPalette, true);
  view.setUint32(0x64, 8, true); // bitsPerPixel
  view.setUint32(0x68, 1, true); // bytesPerPixel
  let o = 236;
  for (const palette of spec.palettes) {
    for (const c of palette) {
      // Palettenblock in BGRA. 🟢 Sichtgeprüft (B5, 2026-08-10): vier Texturen
      // × vier Kanalauslegungen, BGRA durchgehend als richtig, jede
      // Alternative als falsche Farbe bewertet.
      bytes[o] = c[2];
      bytes[o + 1] = c[1];
      bytes[o + 2] = c[0];
      bytes[o + 3] = c[3];
      o += 4;
    }
  }
  bytes.set(spec.pixels.map((p) => p & 0xff), o);
  return bytes;
}

// --- .a (Binär) -------------------------------------------------------------

export interface AFrameSpec {
  /** Grad. Reihenfolge Wurzelrotation VOR Wurzeltranslation (🟡 R4). */
  rootRotation: Vec3f;
  rootTranslation: Vec3f;
  /** Grad, je Bone [x, y, z]. */
  boneRotations: Vec3f[];
}

export interface ASpec {
  frames: AFrameSpec[];
  /**
   * Rotationsreihenfolge als drei Bytes (0 = alpha/X, 1 = beta/Y, 2 = gamma/Z).
   * Vorgabe [1, 0, 2] = YXZ — das ist der Wert, den **alle** 3209 echten
   * `.a`-Dateien tragen (realdaten-belegt, Kontrollversätze bei exakt 0).
   * Abweichende Werte sind nur für Defekt-Fixtures gedacht.
   */
  rotationOrder?: [number, number, number] | undefined;
}

export function composeA(spec: ASpec): Uint8Array {
  const nFrames = spec.frames.length;
  const nBones = spec.frames[0]?.boneRotations.length ?? 0;
  const bytes = new Uint8Array(36 + nFrames * (24 + nBones * 12));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true); // version
  view.setUint32(4, nFrames, true);
  view.setUint32(8, nBones, true);
  const order = spec.rotationOrder ?? [1, 0, 2];
  bytes[12] = order[0];
  bytes[13] = order[1];
  bytes[14] = order[2];
  // Byte 15 bleibt 0 — in allen 3209 echten Dateien genullt.
  let o = 36;
  const putVec = (v: Vec3f): void => {
    view.setFloat32(o, v[0], true);
    view.setFloat32(o + 4, v[1], true);
    view.setFloat32(o + 8, v[2], true);
    o += 12;
  };
  for (const frame of spec.frames) {
    putVec(frame.rootRotation);
    putVec(frame.rootTranslation);
    for (const rot of frame.boneRotations) putVec(rot);
  }
  return bytes;
}
