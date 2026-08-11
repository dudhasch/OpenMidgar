/**
 * UV-Auflösung der Weltkarte (F11a).
 *
 * 🟢 FORMATFAKT (docs/fremdquellen/ff7-landscaper.md §5.2, gaia.md §5.2 —
 * zwei unabhängige Beschreibungen desselben Verhaltens): Die sechs u/v-Bytes
 * eines Weltdreiecks sind **VRAM-SEITEN-ABSOLUT**, nicht texturlokal. Jede
 * Textur hat einen Ursprung (`uOffset`, `vOffset`) innerhalb ihrer VRAM-Seite;
 * texturlokal wird ein Byte erst nach dieser Umrechnung:
 *
 *   1. `wert + offset === dimension`  ⇒  Ergebnis `wert − 1`  (Randkachel)
 *   2. `offset > wert`                ⇒  `offset := offset mod dimension`
 *   3. Ergebnis = `abs((wert − offset) mod dimension)`
 *
 * Schritt 1 ist ein Sonderfall, kein Rundungsartefakt: er greift genau dann,
 * wenn das Byte auf die rechte/untere Kante der Kachel zeigt; ohne ihn würde
 * die Kachel um eine volle Breite umlaufen (Ergebnis 0 statt `dimension − 1`).
 * Schritt 2 fängt `vOffset`-Werte bis 480 bei nur 8 Bit v-Byte ab — die
 * Texturseite steckt NICHT im Dreieck.
 *
 * 🔴 OFFEN (Forschungsposten **F11b**, ausdrücklich NICHT Gegenstand dieser
 * Arbeit): welche `.tex`-Datei aus `world_us.lgp` zu welcher `textureId`
 * gehört und wie `uOffset`/`vOffset`/`width`/`height` daraus zu MESSEN sind
 * (die Referenzen führen eine fertige Tabelle mit 282/8/4 Einträgen; deren
 * INHALT wird nicht übernommen). Bis F11b liegt, ist `WorldTextureMeta` eine
 * leere Schnittstelle: `resolveTriangleUv` gibt ohne Tabelle `null` zurück und
 * die Geometrie führt die ROHEN Bytes weiter — sichtbar falsch, aber ehrlich.
 *
 * Gemessene Vorarbeit für F11b (world-fieldtbl-probe, 2026-08-11): die real
 * belegten `textureId`-Werte sind LÜCKENLOS 0…281 (WM0, 282 Werte), 0…7 (WM2)
 * und 0…3 (WM3). Eine Tabelle für F11b muss also genau so viele Einträge
 * haben, indexpositioniert ab 0.
 */

/** Texturmetadaten je `textureId` — Inhalt kommt aus F11b, nicht von hier. */
export interface WorldTextureMeta {
  width: number;
  height: number;
  /** Ursprung der Textur in ihrer VRAM-Seite. */
  uOffset: number;
  vOffset: number;
}

/** Indexpositionierte Tabelle: Listenindex === `textureId`. */
export type WorldTextureTable = ReadonlyArray<WorldTextureMeta | undefined>;

/**
 * Ein seiten-absolutes Byte in eine texturlokale Pixelkoordinate umrechnen.
 * `dimension` ist die Breite (für u) bzw. Höhe (für v) der Textur.
 */
export function worldUvToLocal(value: number, offset: number, dimension: number): number {
  if (dimension <= 0) return 0;
  // 1. Randkachel: das Byte zeigt genau auf die gegenüberliegende Kante.
  // 🔵 Die Klemme auf 0 ist eine EIGENE Absicherung: bei `value === 0` und
  // `offset === dimension` liefert die Vorschrift −1. Diese Kombination tritt
  // in keiner der in F11b erwarteten Maß-/Offsetpaare auf (Offsets sind
  // Vielfache von 16, Maße Zweierpotenzen ≥ 16 — `offset === dimension`
  // verlangt also eine Textur, die genau an ihrer eigenen Kantenlänge
  // beginnt); ohne die Klemme wäre es eine negative Texturkoordinate.
  if (value + offset === dimension) return value > 0 ? value - 1 : 0;
  // 2. Seitenüberlauf: Offsets > Dimension gehören zu einer höheren Seite.
  let o = offset;
  if (o > value) o = o % dimension;
  // 3. Umlauf, vorzeichenfrei.
  return Math.abs((value - o) % dimension);
}

export interface TriangleUv {
  /** Texturlokale Pixel je Ecke: [u0, v0, u1, v1, u2, v2]. */
  pixels: [number, number, number, number, number, number];
  /** Auf [0,1] normiert — die Form, die eine Geometrie als `uv` braucht. */
  normalized: [number, number, number, number, number, number];
}

/**
 * Rechnet die sechs Bytes eines Dreiecks in texturlokale Koordinaten um.
 * `null`, wenn zur `textureId` keine Metadaten vorliegen (Regelfall bis F11b).
 */
export function resolveTriangleUv(
  uv: readonly [number, number, number, number, number, number],
  textureId: number,
  table: WorldTextureTable,
): TriangleUv | null {
  const meta = table[textureId];
  if (!meta) return null;
  const pixels = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
  const normalized = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
  for (let ecke = 0; ecke < 3; ecke++) {
    const u = worldUvToLocal(uv[ecke * 2]!, meta.uOffset, meta.width);
    const v = worldUvToLocal(uv[ecke * 2 + 1]!, meta.vOffset, meta.height);
    pixels[ecke * 2] = u;
    pixels[ecke * 2 + 1] = v;
    normalized[ecke * 2] = u / meta.width;
    normalized[ecke * 2 + 1] = v / meta.height;
  }
  return { pixels, normalized };
}
