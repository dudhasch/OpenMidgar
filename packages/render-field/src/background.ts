import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  GLSL3,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  RawShaderMaterial,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { viewDistanceToNdcDepth } from '@webmidgar/convert';

/**
 * Tile-Depth-Komposition (ADR-005, Masterplan Phase 3.2): Hintergrund-Tiles
 * werden als Clip-Space-Quads gerendert und schreiben pro Tile eine feste
 * NDC-Tiefe in den Z-Buffer — Vordergrund-Tiles verdecken 3D-Figuren dadurch
 * exakt wie im Original, ohne Sortier-Sonderfälle.
 *
 * S4-Scope: Tiles kommen als bereits aufgelöste Specs (Farbe statt Textur);
 * der spätere Background-Parser (Phase 1.3) emittiert denselben Spec-Typ.
 */

/** Design-Raster der Tile-Koordinaten (y nach unten), 4:3. */
export const DESIGN_WIDTH = 320;
export const DESIGN_HEIGHT = 240;

export interface BackgroundTileSpec {
  /** Position/Größe in Design-Pixeln (320×240, y nach unten). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Sichtdistanz entlang der Kamerablickachse (bestimmt Verdeckung). */
  viewDistance: number;
  /** Farbmodulation; ohne Atlas die Tilefarbe selbst (S4-Pfad). */
  color: [number, number, number];
  /** UV-Rechteck im Atlas (u0, v0, u1, v1); nur mit `atlas` wirksam. */
  uv?: [number, number, number, number] | undefined;
}

export interface BackgroundAtlasSource {
  width: number;
  height: number;
  /** RGBA8, Zeile 0 oben. */
  data: Uint8Array;
}

export interface BackgroundMeshOptions {
  /** Müssen mit der Renderkamera übereinstimmen (Kalibrierungsvertrag). */
  near: number;
  far: number;
  /** Ohne Atlas rendert der Mesh die Flachfarben des S4-Pfads. */
  atlas?: BackgroundAtlasSource | undefined;
}

/**
 * Vorgabefaktor Tile-`z` → Sichtdistanz.
 *
 * Hergeleitet aus der Ordnungsbedingung (S11-Eichung K7 über alle 702 Fields):
 * Layer 0 trägt ausnahmslos z = 4095 und ist die hinterste Ebene, also muss
 * `4095 · zScale` größer sein als die Sichtdistanz JEDES begehbaren Punktes.
 * Der dafür nötige Faktor liegt im Median bei 0,66, im 99. Perzentil bei 3,31
 * und maximal bei 3,77 — **4 ist der kleinste Wert, der alle Fields
 * abdeckt** (bei 1 wären es nur 476 von 702).
 *
 * Die so skalierte Sichtdistanz DARF `far` überschreiten (Layer 0:
 * 4095·4 = 16380) — `buildBackgroundMesh` klemmt die NDC-Tiefe auf das
 * Clip-Fenster, damit die Ordnung gilt, ohne Quads zu verlieren (F03).
 */
export const DEFAULT_TILE_Z_SCALE = 4;

/**
 * Tile-Tiefenschlüssel → Sichtdistanz.
 *
 * 🟡 Realdaten-Befund (S9): Zwischen `z` und der kameraseitigen Sichtdistanz
 * ist KEIN konstanter Faktor nachweisbar (Verhältnisstreuung über drei
 * Größenordnungen) — `z` ist ein Sortierschlüssel, keine Metrik. Die
 * Ordnungsbedingung oben liefert nur eine untere Schranke, keinen Beweis;
 * dass ausgerechnet 4 aufgeht, ist ein starkes Indiz, aber erst die
 * Sichtprüfung der Figurenverdeckung entscheidet endgültig.
 */
export function tileZToViewDistance(z: number, zScale = DEFAULT_TILE_Z_SCALE): number {
  return Math.max(1, z * zScale);
}

export function buildBackgroundMesh(
  tiles: BackgroundTileSpec[],
  opts: BackgroundMeshOptions,
): Mesh {
  const positions = new Float32Array(tiles.length * 4 * 3);
  const colors = new Float32Array(tiles.length * 4 * 3);
  const uvs = new Float32Array(tiles.length * 4 * 2);
  const indices = new Uint32Array(tiles.length * 6);

  const toNdcX = (px: number): number => (px / DESIGN_WIDTH) * 2 - 1;
  const toNdcY = (py: number): number => 1 - (py / DESIGN_HEIGHT) * 2;

  tiles.forEach((tile, i) => {
    // 🟢 F03 (md1stin, bg-clip-probe 2026-08-10): Tile-`z` ist ein
    // Sortierschlüssel, keine Metrik — skaliert liegt die Sichtdistanz
    // regelmäßig außerhalb von [near, far] (Layer 0: 4095·4 = 16380 > 10000;
    // Overlays mit kleinem z: max(1, z·4) < 100). Ohne Klemmung fällt das
    // Quad aus dem Clip-Volumen (NDC-|z| > 1) und der Rasterizer verwirft es
    // KOMPLETT: in md1stin verschwanden so 795/795 Layer-0- und 247/320
    // Layer-1-Tiles; systematisch traf es jede Layer-0-Fläche aller Fields.
    // Die Klemmung auf das Tiefenfenster ist ordnungserhaltend; Gleichstände
    // an den Rändern entscheidet die Zeichenreihenfolge (hinterster Layer
    // zuerst, großes z zuerst) unter dem Standard-Tiefentest LessEqual.
    const depth = Math.min(1, Math.max(-1, viewDistanceToNdcDepth(tile.viewDistance, opts.near, opts.far)));
    const x0 = toNdcX(tile.x);
    const x1 = toNdcX(tile.x + tile.width);
    const y0 = toNdcY(tile.y);
    const y1 = toNdcY(tile.y + tile.height);
    const corners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    // UV-Ecken in derselben Reihenfolge wie die Positionsecken (v von oben).
    const [u0, v0, u1, v1] = tile.uv ?? [0, 0, 1, 1];
    const uvCorners: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    corners.forEach(([x, y], c) => {
      const v = (i * 4 + c) * 3;
      positions[v] = x;
      positions[v + 1] = y;
      positions[v + 2] = depth;
      colors[v] = tile.color[0];
      colors[v + 1] = tile.color[1];
      colors[v + 2] = tile.color[2];
      const t = (i * 4 + c) * 2;
      uvs[t] = uvCorners[c]![0];
      uvs[t + 1] = uvCorners[c]![1];
    });
    const base = i * 4;
    // CCW-Winding im NDC-Raum (y oben): TL→BR→TR / TL→BL→BR — sonst Backface-Cull.
    indices.set([base, base + 2, base + 1, base, base + 3, base + 2], i * 6);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));

  let texture: DataTexture | null = null;
  if (opts.atlas) {
    texture = new DataTexture(
      opts.atlas.data,
      opts.atlas.width,
      opts.atlas.height,
      RGBAFormat,
      UnsignedByteType,
    );
    // Punktabtastung: Tiles sollen pixelgenau wie im Original erscheinen.
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = LinearSRGBColorSpace;
    texture.needsUpdate = true;
  }

  // Clip-Space direkt: Kameratransformationen bewusst ignoriert — die Tiefe
  // steckt in position.z (vorberechnete NDC-Tiefe).
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    uniforms: texture ? { uAtlas: { value: texture } } : {},
    vertexShader: `
      in vec3 position;
      in vec3 color;
      in vec2 uv;
      out vec3 vColor;
      out vec2 vUv;
      void main() {
        vColor = color;
        vUv = uv;
        gl_Position = vec4(position.xy, position.z, 1.0);
      }
    `,
    fragmentShader: texture
      ? `
      precision highp float;
      uniform sampler2D uAtlas;
      in vec3 vColor;
      in vec2 vUv;
      out vec4 outColor;
      void main() {
        vec4 texel = texture(uAtlas, vUv);
        // Vollständig transparente Texel verwerfen, damit der Tiefenpuffer
        // hinter Löchern nicht beschrieben wird.
        if (texel.a < 0.5) discard;
        outColor = vec4(texel.rgb * vColor, 1.0);
      }
    `
      : `
      precision highp float;
      in vec3 vColor;
      in vec2 vUv;
      out vec4 outColor;
      void main() {
        outColor = vec4(vColor, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // Clip-Space-Geometrie hat keine Weltbounds
  return mesh;
}
