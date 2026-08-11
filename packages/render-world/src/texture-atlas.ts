import { ATLAS_SIZE, ShelfPacker, blitRgbaWithBleed } from '@webmidgar/atlas';

/**
 * F25 — Texturatlas der Weltkarte.
 *
 * 🔵 Der Packer ist der GEMEINSAME aus `@webmidgar/atlas` (herausgehoben aus
 * `render-field/tile-atlas`); hier steht nur, was für das Weltterrain
 * besonders ist:
 *
 *  - **4 px Polsterung mit Edge-Bleed.** Der Weltpfad filtert bilinear (die
 *    Kacheln werden stark vergrößert), deshalb greift der Sampler über die
 *    Zellgrenze. Der Field-Pfad tut das nicht (NEAREST) und braucht die
 *    Polsterung folglich nicht — dieselbe Packung, andere Polsterung.
 *  - **Wiederholung gehört in die UV-Rechnung.** Bei Atlasnutzung ist
 *    `RepeatWrapping` unbrauchbar: die Hardware würde über die Zellgrenze
 *    hinaus in die Nachbartextur laufen. Deshalb rechnet
 *    `atlasUvForLocalPixel` den lokalen Pixel MODULO der Texturgröße und
 *    setzt ihn erst dann in die Atlaszelle. Die Modulo-Stelle ist damit
 *    genau eine.
 */

export interface WorldAtlasImage {
  textureId: number;
  width: number;
  height: number;
  /** RGBA, zeilenweise, width·height·4 Byte. */
  rgba: Uint8Array;
}

export interface WorldAtlasPlacement {
  atlas: number;
  /** Linke obere Ecke der Zelle in Atlaspixeln (ohne Polsterung). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldTextureAtlas {
  size: number;
  padding: number;
  atlases: Uint8Array[];
  placements: Map<number, WorldAtlasPlacement>;
  /** Texturen, die auch allein nicht auf eine Seite passen. */
  rejected: number[];
  /** Belegte Fläche je Atlasseite in Pixeln (Nutzfläche ohne Polsterung). */
  usedArea: number[];
}

export const WORLD_ATLAS_PADDING = 4;

/**
 * Baut den Atlas EINER Karte. Große Texturen zuerst — das ist die
 * Standardheuristik für Regalpacker und hält die Regale flach; die Reihenfolge
 * der Eingabe bleibt sonst unangetastet (stabile Sortierung nach Höhe, dann
 * `textureId`, damit derselbe Bestand denselben Atlas ergibt).
 */
export function buildWorldTextureAtlas(
  images: readonly WorldAtlasImage[],
  opts: { atlasSize?: number; padding?: number } = {},
): WorldTextureAtlas {
  const size = opts.atlasSize ?? ATLAS_SIZE;
  const padding = opts.padding ?? WORLD_ATLAS_PADDING;
  const packer = new ShelfPacker(size, padding);
  const atlases: Uint8Array[] = [];
  const usedArea: number[] = [];
  const placements = new Map<number, WorldAtlasPlacement>();
  const rejected: number[] = [];

  const sortiert = [...images].sort((a, b) => b.height - a.height || b.width - a.width || a.textureId - b.textureId);
  for (const img of sortiert) {
    if (img.rgba.length !== img.width * img.height * 4) {
      rejected.push(img.textureId);
      continue;
    }
    const spot = packer.place(img.width, img.height);
    if (!spot) {
      rejected.push(img.textureId);
      continue;
    }
    while (atlases.length <= spot.atlas) {
      atlases.push(new Uint8Array(size * size * 4));
      usedArea.push(0);
    }
    blitRgbaWithBleed(atlases[spot.atlas]!, size, img.rgba, img.width, img.height, spot.x, spot.y, padding);
    usedArea[spot.atlas] = usedArea[spot.atlas]! + img.width * img.height;
    placements.set(img.textureId, {
      atlas: spot.atlas,
      x: spot.x,
      y: spot.y,
      width: img.width,
      height: img.height,
    });
  }
  return { size, padding, atlases, placements, rejected, usedArea };
}

/**
 * Prüft, dass sich keine zwei Zellen überlappen — **inklusive Polsterung**,
 * denn genau der Polsterungsstreifen ist die Stelle, an der ein fehlerhafter
 * Packer eine Nachbartextur überschreiben würde. Rückgabe: Anzahl der
 * überlappenden Paare (0 = sauber).
 */
export function countAtlasOverlaps(atlas: WorldTextureAtlas): number {
  const proSeite = new Map<number, WorldAtlasPlacement[]>();
  for (const p of atlas.placements.values()) {
    const liste = proSeite.get(p.atlas) ?? [];
    liste.push(p);
    proSeite.set(p.atlas, liste);
  }
  let paare = 0;
  const pad = atlas.padding;
  for (const liste of proSeite.values()) {
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        const a = liste[i]!;
        const b = liste[j]!;
        const ax0 = a.x - pad;
        const ay0 = a.y - pad;
        const ax1 = a.x + a.width + pad;
        const ay1 = a.y + a.height + pad;
        const bx0 = b.x - pad;
        const by0 = b.y - pad;
        const bx1 = b.x + b.width + pad;
        const by1 = b.y + b.height + pad;
        if (ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1) paare++;
      }
    }
  }
  return paare;
}

/**
 * Texturlokaler Pixel → Atlas-UV. `local` darf außerhalb [0, width) liegen;
 * die Wiederholung wird hier per Modulo aufgelöst (s. Kopfkommentar).
 *
 * Die halbe Texelverschiebung (`+0.5`) ist kein Schönheitsfehler, sondern
 * nötig: `u = x/size` zeigt auf die KANTE eines Texels, `(x+0.5)/size` auf
 * seine Mitte. Ohne sie mittelt der bilineare Filter am Zellrand über die
 * Polsterung — genau die Naht, gegen die der Edge-Bleed antritt.
 */
export function atlasUvForLocalPixel(
  placement: WorldAtlasPlacement,
  atlasSize: number,
  localU: number,
  localV: number,
): [number, number] {
  const w = placement.width;
  const h = placement.height;
  const u = ((localU % w) + w) % w;
  const v = ((localV % h) + h) % h;
  return [(placement.x + u + 0.5) / atlasSize, (placement.y + v + 0.5) / atlasSize];
}
