import type { Mesh } from 'three';
import type { FieldBackground, FieldPalette } from '@webmidgar/formats-field';
import {
  buildBackgroundMesh,
  DEFAULT_TILE_Z_SCALE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  tileZToViewDistance,
  type BackgroundTileSpec,
  type TileBlendMode,
} from './background.js';
import { buildDrawList, buildTileAtlas, type TileAtlasSet } from './tile-atlas.js';

/**
 * Verbindungsstück Field-Hintergrund → S4-Depth-Pipeline.
 *
 * Zielkoordinaten des Formats sind um die Bildmitte zentriert (realdaten-
 * belegt: die bemalte Fläche der nicht scrollenden Fields liegt exakt bei
 * −120…+120 bzw. −160…+160). Der Kompositor rechnet dagegen im Design-Raster
 * 320×240 mit Ursprung oben links — die Verschiebung um die halbe Bildgröße
 * passiert genau hier.
 */

export interface FieldBackgroundRenderOptions {
  near: number;
  far: number;
  /** Kamerascroll in Design-Pixeln (Scroll-Fields). */
  scrollX?: number | undefined;
  scrollY?: number | undefined;
  /** Kalibrierfaktor Tile-z → Sichtdistanz (🟡, siehe `tileZToViewDistance`). */
  zScale?: number | undefined;
  atlasSize?: number | undefined;
  /** Nur diese Layerindizes aufbauen; Default: alle vorhandenen. */
  layers?: number[] | undefined;
}

export interface FieldBackgroundRender {
  atlas: TileAtlasSet;
  /** Alle aufgebauten Meshes in Zeichenreihenfolge (deckend zuerst). */
  meshes: Mesh[];
  tileCount: number;
  /**
   * Animationsgruppen (F22): je Kombination aus Parameter und Zustandsbit ein
   * eigener Stapel. Der Aufrufer schaltet je Parameter GENAU EINEN Zustand
   * sichtbar — werden alle gleichzeitig gezeichnet, überlagern sich sämtliche
   * Phasen zu einem unscharfen Block.
   */
  animationen: { param: number; state: number; meshes: Mesh[] }[];
  /** Vorhandene Zustandsbits je Parameter, aufsteigend. */
  zustaende: Map<number, number[]>;
}

export function buildFieldBackground(
  bgAll: FieldBackground,
  palette: FieldPalette | undefined,
  opts: FieldBackgroundRenderOptions,
): FieldBackgroundRender {
  const bg = opts.layers
    ? { ...bgAll, layers: bgAll.layers.filter((l) => opts.layers!.includes(l.index)) }
    : bgAll;
  const atlas = buildTileAtlas(bg, palette, { atlasSize: opts.atlasSize ?? 2048 });
  const items = buildDrawList(bg, atlas);
  const offsetX = DESIGN_WIDTH / 2 - (opts.scrollX ?? 0);
  const offsetY = DESIGN_HEIGHT / 2 - (opts.scrollY ?? 0);

  /**
   * Ein Stapel je (Atlas, Mischart, Animationsgruppe). Die Aufteilung ist
   * nötig, weil Mischart und Sichtbarkeit Eigenschaften des Materials bzw. des
   * Objekts sind — beides lässt sich nicht je Tile innerhalb eines Meshes
   * setzen.
   */
  const stapel = new Map<
    string,
    {
      spec: BackgroundTileSpec[];
      atlasIndex: number;
      blend: TileBlendMode;
      param: number;
      state: number;
      layer: number;
      zMax: number;
    }
  >();
  const zustaende = new Map<number, Set<number>>();

  for (const item of items) {
    const t = item.tile;
    const blend: TileBlendMode = t.blending === 0 ? 'opaque' : mischart(t.typeTrans);
    // F32: Layer gehört in den Stapelschlüssel — ohne ihn landete eine
    // Layer-1-Mischkachel ÜBER allem, was später gezeichnet wurde (sbwy4_6:
    // Wasser über den eigentlichen Texturen). Makou teilt nach Layer, Z,
    // param, state UND transType.
    const schluessel = `${item.entry.atlas}|${blend}|${t.param}|${t.state}|${item.layer}`;
    let eintrag = stapel.get(schluessel);
    if (!eintrag) {
      eintrag = {
        spec: [],
        atlasIndex: item.entry.atlas,
        blend,
        param: t.param,
        state: t.state,
        layer: item.layer,
        zMax: t.z,
      };
      stapel.set(schluessel, eintrag);
    }
    if (t.z > eintrag.zMax) eintrag.zMax = t.z;
    eintrag.spec.push({
      x: t.dstX + offsetX,
      y: t.dstY + offsetY,
      width: item.size,
      height: item.size,
      viewDistance: tileZToViewDistance(t.z, opts.zScale ?? DEFAULT_TILE_Z_SCALE),
      color: [1, 1, 1],
      uv: [item.entry.u0, item.entry.v0, item.entry.u1, item.entry.v1],
    });
    if (t.param !== 0) (zustaende.get(t.param) ?? zustaende.set(t.param, new Set()).get(t.param)!).add(t.state);
  }

  // Deckend zuerst (Tiefe regelt dort die Ordnung), gemischte danach in
  // Bildordnung: Layer aufsteigend, innerhalb des Layers hinten (großes z)
  // zuerst — gemischte Stapel schreiben keine Tiefe, ihre Reihenfolge IST
  // die Ordnung (F32).
  const sortiert = [...stapel.values()].sort(
    (a, b) =>
      Number(a.blend !== 'opaque') - Number(b.blend !== 'opaque') ||
      a.layer - b.layer ||
      b.zMax - a.zMax,
  );

  const meshes: Mesh[] = [];
  const animationen: { param: number; state: number; meshes: Mesh[] }[] = [];
  const animIndex = new Map<string, { param: number; state: number; meshes: Mesh[] }>();

  sortiert.forEach((s, ordnung) => {
    const mesh = buildBackgroundMesh(s.spec, {
      near: opts.near,
      far: opts.far,
      atlas: { width: atlas.size, height: atlas.size, data: atlas.atlases[s.atlasIndex]! },
      blend: s.blend,
    });
    mesh.renderOrder = ordnung;
    meshes.push(mesh);
    if (s.param !== 0) {
      const k = `${s.param}|${s.state}`;
      let gruppe = animIndex.get(k);
      if (!gruppe) {
        gruppe = { param: s.param, state: s.state, meshes: [] };
        animIndex.set(k, gruppe);
        animationen.push(gruppe);
      }
      gruppe.meshes.push(mesh);
    }
  });

  return {
    atlas,
    meshes,
    tileCount: items.length,
    animationen,
    zustaende: new Map([...zustaende].map(([p, s]) => [p, [...s].sort((a, b) => a - b)])),
  };
}

/**
 * Mischart aus `typeTrans`.
 *
 * 🟢 Formeln belegt (Makou Reactor, `BackgroundFile::blendColor`):
 * 0 = (dst+src)/2 · 1 = dst+src · 2 = dst−src · 3 = dst+src/4.
 */
function mischart(typeTrans: number): TileBlendMode {
  switch (typeTrans) {
    case 1:
      return 'add';
    case 2:
      return 'sub';
    case 3:
      return 'add25';
    default:
      return 'average';
  }
}
