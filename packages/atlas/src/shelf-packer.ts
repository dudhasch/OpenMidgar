/**
 * Gemeinsamer Regal-Packer („shelf") für ALLE Atlaspfade des Projekts.
 *
 * 🔵 ARCHITEKTURENTSCHEIDUNG: Field-Hintergrund (`render-field/tile-atlas`),
 * Weltterrain (`render-world/texture-atlas`) und später die Kampfbühne
 * brauchen dieselbe Packung. Bis hierher gab es sie nur einmal, eingebacken in
 * `buildTileAtlas`. Dieser Baustein ist die HERAUSGEHOBENE Fassung: bewusst
 * Three-frei und worker-tauglich (keine DOM-, keine GL-Abhängigkeit), damit
 * beide Aufrufer denselben Code benutzen statt einen zweiten zu bauen.
 *
 * Das Packverhalten ist gegenüber dem Field-Pfad UNVERÄNDERT übernommen
 * (Regression: `render-field/background.test.ts` und `tile-atlas`-Tests
 * bleiben grün, weil `place()` für quadratische Kacheln ohne Polsterung
 * bitgleich dieselben Plätze vergibt).
 */

/** Kantenlänge einer Atlasseite. Historisch aus `render-field` (Phase 3.2). */
export const ATLAS_SIZE = 2048;

export interface ShelfSpot {
  /** Index der Atlasseite (0-basiert, wächst bei Überlauf). */
  atlas: number;
  /** Linke obere Ecke des NUTZBEREICHS (ohne Polsterung). */
  x: number;
  y: number;
}

/**
 * Streamender Regal-Packer: Rechtecke werden in der Reihenfolge des Aufrufs
 * in Regalzeilen gelegt; passt eine Zeile nicht mehr, beginnt die nächste,
 * passt die Seite nicht mehr, beginnt eine neue Seite.
 *
 * `padding` reserviert ringsum Platz für den Edge-Bleed (s.
 * `blitRgbaWithBleed`). Der zurückgegebene Punkt zeigt auf den NUTZBEREICH;
 * die Polsterung liegt links/oberhalb davon.
 */
export class ShelfPacker {
  #atlas = -1;
  #cursorX = 0;
  #cursorY = 0;
  #rowHeight = 0;
  #count = 0;

  constructor(
    readonly size: number = ATLAS_SIZE,
    readonly padding: number = 0,
  ) {}

  /** Bisher angelegte Atlasseiten. */
  get atlasCount(): number {
    return this.#atlas + 1;
  }

  /** Bisher vergebene Plätze. */
  get placed(): number {
    return this.#count;
  }

  /**
   * Platz für ein Rechteck (Nutzmaß, ohne Polsterung). `null`, wenn das
   * Rechteck selbst mit Polsterung nicht auf eine leere Seite passt — der
   * Aufrufer muss diesen Fall melden, nicht stillschweigend beschneiden.
   */
  place(width: number, height: number): ShelfSpot | null {
    const p = this.padding;
    const belegtX = width + p * 2;
    const belegtY = height + p * 2;
    if (belegtX > this.size || belegtY > this.size) return null;
    if (this.#atlas < 0) this.#neueSeite();
    if (this.#cursorX + belegtX > this.size) {
      // Regalzeile voll → nächste Zeile.
      this.#cursorX = 0;
      this.#cursorY += this.#rowHeight;
      this.#rowHeight = 0;
    }
    if (this.#cursorY + belegtY > this.size) this.#neueSeite();
    const spot: ShelfSpot = { atlas: this.#atlas, x: this.#cursorX + p, y: this.#cursorY + p };
    this.#cursorX += belegtX;
    if (belegtY > this.#rowHeight) this.#rowHeight = belegtY;
    this.#count++;
    return spot;
  }

  #neueSeite(): void {
    this.#atlas++;
    this.#cursorX = 0;
    this.#cursorY = 0;
    this.#rowHeight = 0;
  }
}

/** RGBA-Block ohne Polsterung in eine Atlasseite kopieren. */
export function blitRgba(
  target: Uint8Array,
  targetSize: number,
  src: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): void {
  for (let row = 0; row < height; row++) {
    const from = row * width * 4;
    const to = ((y + row) * targetSize + x) * 4;
    target.set(src.subarray(from, from + width * 4), to);
  }
}

/**
 * RGBA-Block mit **Edge-Bleed** kopieren: der Nutzbereich landet auf (x,y),
 * und die `padding` Pixel ringsum werden mit dem jeweils NÄCHSTEN Randpixel
 * gefüllt.
 *
 * 🔵 Warum: Bei bilinearer Filterung und Mipmaps greift der Sampler über den
 * Rand einer Atlaszelle hinaus. Ohne Bleed zieht er die Nachbarzelle herein —
 * das sind die typischen hellen Nähte zwischen Geländekacheln. Mit Bleed
 * liest er denselben Randpixel weiter und die Naht verschwindet. Die
 * Polsterung darf NICHT einfach transparent sein: dann fräst der alphaTest
 * die Kachelränder weg.
 */
export function blitRgbaWithBleed(
  target: Uint8Array,
  targetSize: number,
  src: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  padding: number,
): void {
  for (let row = -padding; row < height + padding; row++) {
    const srcRow = Math.min(height - 1, Math.max(0, row));
    const ty = y + row;
    if (ty < 0 || ty >= targetSize) continue;
    for (let col = -padding; col < width + padding; col++) {
      const srcCol = Math.min(width - 1, Math.max(0, col));
      const tx = x + col;
      if (tx < 0 || tx >= targetSize) continue;
      const from = (srcRow * width + srcCol) * 4;
      const to = (ty * targetSize + tx) * 4;
      target[to] = src[from]!;
      target[to + 1] = src[from + 1]!;
      target[to + 2] = src[from + 2]!;
      target[to + 3] = src[from + 3]!;
    }
  }
}
