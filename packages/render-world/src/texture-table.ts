import type { WorldTerrain } from '@webmidgar/formats-world';
import type { WorldTextureMeta, WorldTextureTable } from './uv.js';

/**
 * F11b — **Maße und VRAM-Ursprünge je `textureId`, aus den Dreiecken GEMESSEN.**
 *
 * Die EXE-Tabelle (`parseWorldTextureNames`) liefert nur den NAMEN je ID. Die
 * vier Zahlen, die `resolveTriangleUv` braucht — `width`, `height`, `uOffset`,
 * `vOffset` —, kommen hier zustande:
 *
 *  - `width`/`height` sind die echten Kopffelder der `.tex`-Datei bzw. das
 *    gemessene Maß der animierten Textur. Sie werden NICHT geraten.
 *  - `uOffset`/`vOffset` werden aus den beobachteten u/v-Spannweiten
 *    abgeleitet: der GRÖSSTE 16-ausgerichtete Wert `o ≤ uMin` mit
 *    `uMax ≤ o + width`. Der 16er-Raster ist dabei eine Vorhersage, keine
 *    Bequemlichkeit — er stammt aus der VRAM-Seitenaufteilung.
 *
 * ═══ Die Gütefunktion und ihre Kontrolle ═══
 * Ob eine Zuordnung stimmt, entscheidet nicht die Plausibilität der Namen,
 * sondern ob die Dreiecks-UVs überhaupt in das Fenster der zugeordneten
 * Textur PASSEN. `measureTextureFit` rechnet genau das und liefert daneben
 * eine Verwürfelungskontrolle.
 *
 * 🟢 Messergebnis (Realdaten, `world-texmap-probe`, 2026-08-11):
 *   WM0: **282/282** IDs passen = **1,0000**; Kontrolle (500 Verwürfelungen
 *        der Zuordnung) Median **0,6028**, Maximum **0,6489**.
 *   Zweitrechnung nur über IDs mit SELTENER Texturgröße (≤ 8 Exemplare im
 *        Archiv — dort ist „passt ins Fenster" keine billige Aussage):
 *        **20/20 = 1,0000**, Kontrolle Median **0,5500**, Maximum **0,7000**.
 *   WM2: 8/8, WM3: 4/4 — dort hat die Kontrolle bei 8 bzw. 4 IDs KEINE
 *        Trennschärfe (Median 0,8750 bzw. 1,0000) und wird nur berichtet.
 *        Ohne den `cltr`-Quirk fiele WM2 auf 7/8 — s. `CLTR_QUIRK_U`.
 *
 * ═══ Was die Kontrolle wert ist ═══
 * Vor dem Fund der EXE-Tabelle wurden vier naheliegende Kandidatenordnungen
 * mit derselben Gütefunktion gegen WM0 gemessen: TOC-Reihenfolge des Archivs
 * 0,5780 · alphabetisch 0,5780 · physische Datenlage 0,6241 · nach Größe
 * sortiert 0,4645 · bestes gleitendes Fenster 0,7411 — bei einem
 * Verwürfelungsniveau von Median 0,5851. **Keine davon ist die richtige.**
 * Erst die gemessene EXE-Tabelle erreicht 1,0000.
 *
 * Warum die Zweitrechnung nötig war: 225 der 415 Texturen sind 32×32. „UV
 * passt ins Fenster" ist bei einer Größe, die es 225-mal gibt, ein schwaches
 * Argument. Die seltenen Größen (128×256 einmal, 32×128 einmal, 128×16
 * einmal …) sind der scharfe Teil der Messung — und dort trifft es ebenfalls
 * vollständig.
 */

/**
 * 🟢 Quirk der Unterwasserkarte: Dreiecke der Textur `cltr` mit u-Byte ≥ 192
 * gehören zum „Außenbereich" und tragen keine sinnvolle UV. Gemessen auf WM2:
 * **1992 von 2523** UV-Bytes der ID 0 liegen auf 254/255, der Rest endet bei
 * 120 — also sauber innerhalb der 128 Pixel breiten Textur. Ohne diese
 * Ausnahme behauptet die Messung eine 256 Pixel breite Textur, die es nicht
 * gibt; mit ihr passt `cltr` exakt.
 */
export const CLTR_QUIRK_U = 192;
export const CLTR_NAME = 'cltr';

/** Beobachtete Wertebereiche der u/v-Bytes einer `textureId`. */
export interface TextureUvRange {
  textureId: number;
  triangles: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

/** Alle `textureId`-Spannweiten einer geparsten Karte einsammeln. */
export function measureTextureUvRanges(
  terrain: WorldTerrain,
  opts: { quirkTextureIds?: ReadonlySet<number> } = {},
): Map<number, TextureUvRange> {
  const quirk = opts.quirkTextureIds ?? new Set<number>();
  const out = new Map<number, TextureUvRange>();
  for (const block of terrain.blocks) {
    if (!block) continue;
    for (const mesh of block.meshes) {
      if (!mesh) continue;
      for (const tri of mesh.triangles) {
        let r = out.get(tri.textureId);
        if (!r) {
          r = { textureId: tri.textureId, triangles: 0, uMin: 255, uMax: 0, vMin: 255, vMax: 0 };
          out.set(tri.textureId, r);
        }
        r.triangles++;
        const istQuirk = quirk.has(tri.textureId);
        for (let e = 0; e < 3; e++) {
          const u = tri.uv[e * 2]!;
          const v = tri.uv[e * 2 + 1]!;
          if (istQuirk && u >= CLTR_QUIRK_U) continue;
          if (u < r.uMin) r.uMin = u;
          if (u > r.uMax) r.uMax = u;
          if (v < r.vMin) r.vMin = v;
          if (v > r.vMax) r.vMax = v;
        }
      }
    }
  }
  return out;
}

/** Raster, auf dem VRAM-Ursprünge liegen (🟢 Vielfache von 16). */
export const VRAM_OFFSET_GRID = 16;
const DIMENSIONEN = [16, 32, 64, 128, 256] as const;

/**
 * Kleinste Kantenlänge, in die eine beobachtete Spannweite passt — die
 * UNTERE SCHRANKE, die eine Zuordnung erfüllen muss.
 *
 * Beachte die Inklusivgrenze `max ≤ o + dim`: das obere Byte darf genau auf
 * die gegenüberliegende Kachelkante zeigen. Diese Randkachel ist derselbe
 * Sonderfall, den `worldUvToLocal` in Schritt 1 behandelt; ohne sie erklärt
 * die Messung z. B. eine 128 Pixel breite Textur mit u-Werten bis 128 für
 * 256 Pixel breit — und die ganze Zuordnung kippt.
 */
export function minimalDimension(min: number, max: number): number {
  const o = Math.floor(min / VRAM_OFFSET_GRID) * VRAM_OFFSET_GRID;
  for (const dim of DIMENSIONEN) if (max <= o + dim) return dim;
  return 512;
}

/** Alle 16-ausgerichteten Ursprünge, die zu (min,max,dim) passen — größter zuerst. */
export function feasibleOffsets(min: number, max: number, dim: number): number[] {
  const out: number[] = [];
  for (let o = Math.floor(min / VRAM_OFFSET_GRID) * VRAM_OFFSET_GRID; o >= 0; o -= VRAM_OFFSET_GRID) {
    if (max <= o + dim) out.push(o);
  }
  return out;
}

/**
 * Ursprung wählen. 🟢 Die Wahl ist nicht beliebig: gemessen liegen **244 von
 * 260** WM0-Ursprüngen auf einem Vielfachen der eigenen Texturbreite
 * (`uOffset mod width == 0`), bei v 234 von 260. Wo mehrere 16-ausgerichtete
 * Werte passen, wird deshalb der mit `o mod dim == 0` bevorzugt — die Regel
 * ist aus der Mehrheit ABGELEITET, nicht gesetzt. Erst danach gilt „größter
 * passender Wert".
 */
export function chooseOffset(min: number, max: number, dim: number): { offset: number; ambiguous: boolean } {
  const kandidaten = feasibleOffsets(min, max, dim);
  if (kandidaten.length === 0) return { offset: 0, ambiguous: true };
  const ausgerichtet = kandidaten.find((o) => o % dim === 0);
  return { offset: ausgerichtet ?? kandidaten[0]!, ambiguous: kandidaten.length > 1 };
}

/** Größe einer Textur, wie sie der Kopf der Datei angibt. */
export interface TextureSize {
  width: number;
  height: number;
}

export interface TextureTableEntry extends WorldTextureMeta {
  textureId: number;
  /** Dateiname ohne Endung; `null` bei animierten Texturen (`wm.ta`). */
  name: string | null;
  /** Index in `wm.ta`, wenn animiert. */
  animatedSlot: number | null;
  triangles: number;
  /** UV-Spannweite passt in die Textur (die Gütefunktion). */
  fits: boolean;
  /** Mehr als ein 16-ausgerichteter Ursprung wäre möglich gewesen. */
  ambiguousOffset: boolean;
}

export interface TextureTableResult {
  table: WorldTextureTable;
  entries: TextureTableEntry[];
  /** IDs ohne Größenangabe (weder `.tex` noch `wm.ta`) — bleiben untexturiert. */
  unresolved: number[];
  diagnostics: string[];
}

export interface BuildTextureTableInput {
  /** Beobachtete Spannweiten (aus `measureTextureUvRanges`). */
  ranges: Map<number, TextureUvRange>;
  /** Name je `textureId` — Ausschnitt der EXE-Tabelle ab der Kartenbasis. */
  names: ReadonlyArray<string | null>;
  /** Maße der `.tex`-Dateien, Schlüssel = Basisname ohne Endung. */
  sizes: ReadonlyMap<string, TextureSize>;
  /**
   * Maße der animierten Texturen in `wm.ta`-Reihenfolge. Die Zuordnung
   * namenloser Tabellenplätze zu `wm.ta`-Plätzen erfolgt der Reihe nach
   * (🟡 ANNAHME: der n-te namenlose Platz ist der n-te `wm.ta`-Eintrag).
   * Sie ist nicht gemessen — aber folgenarm, weil alle 22 animierten
   * Texturen dasselbe Maß 32×32 haben und die Reihenfolge damit nur die
   * PIXEL, nicht die Geometrie betrifft.
   */
  animated?: ReadonlyArray<TextureSize>;
}

export function buildWorldTextureTable(input: BuildTextureTableInput): TextureTableResult {
  const { ranges, names, sizes } = input;
  const animated = input.animated ?? [];
  const diagnostics: string[] = [];
  const entries: TextureTableEntry[] = [];
  const unresolved: number[] = [];
  const table: Array<WorldTextureMeta | undefined> = [];

  // Namenlose Plätze der Reihe nach durchnummerieren (🟡, s. oben).
  const animSlotOf = new Map<number, number>();
  let lauf = 0;
  for (let i = 0; i < names.length; i++) if (names[i] === null) animSlotOf.set(i, lauf++);

  const ids = [...ranges.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const r = ranges.get(id)!;
    const name = id < names.length ? (names[id] ?? null) : null;
    const slot = animSlotOf.get(id) ?? null;
    const size = name ? sizes.get(name) : slot !== null ? animated[slot] : undefined;
    if (!size) {
      unresolved.push(id);
      diagnostics.push(`textureId ${id}: keine Größe (${name ?? (slot !== null ? `wm.ta[${slot}]` : 'kein Tabelleneintrag')})`);
      continue;
    }
    const fits = size.width >= minimalDimension(r.uMin, r.uMax) && size.height >= minimalDimension(r.vMin, r.vMax);
    const u = chooseOffset(r.uMin, r.uMax, size.width);
    const v = chooseOffset(r.vMin, r.vMax, size.height);
    const meta: WorldTextureMeta = {
      width: size.width,
      height: size.height,
      uOffset: u.offset,
      vOffset: v.offset,
    };
    table[id] = meta;
    entries.push({
      textureId: id,
      name,
      animatedSlot: slot,
      triangles: r.triangles,
      fits,
      ambiguousOffset: u.ambiguous || v.ambiguous,
      ...meta,
    });
  }
  return { table, entries, unresolved, diagnostics };
}

/**
 * Gütemaß MIT KONTROLLE: Anteil der IDs, deren UV-Spannweite in die
 * zugeordnete Textur passt — gegen dieselbe Rechnung nach Verwürfelung der
 * Zuordnung. Ohne die Kontrollzahl ist die Quote wertlos (Projektregel 3).
 */
export interface FitMeasurement {
  /** Bewertete IDs (namenlose ohne Größe bleiben draußen). */
  total: number;
  hits: number;
  rate: number;
  /** Dieselbe Quote nur über IDs mit seltener Texturgröße. */
  rareTotal: number;
  rareHits: number;
  rareRate: number;
  /** Median und Maximum der Kontrollläufe. */
  controlMedian: number;
  controlMax: number;
  rareControlMedian: number;
  rareControlMax: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function measureTextureFit(
  entries: readonly TextureTableEntry[],
  ranges: ReadonlyMap<number, TextureUvRange>,
  sizeCensus: ReadonlyMap<string, number>,
  opts: { controls?: number; seed?: number; rareThreshold?: number } = {},
): FitMeasurement {
  const controls = opts.controls ?? 500;
  const rareThreshold = opts.rareThreshold ?? 8;
  const bewertet = entries.filter((e) => ranges.has(e.textureId));
  const istSelten = (w: number, h: number): boolean => (sizeCensus.get(`${w}x${h}`) ?? 0) <= rareThreshold;
  const hits = bewertet.filter((e) => e.fits).length;
  const selten = bewertet.filter((e) => istSelten(e.width, e.height));
  const rareHits = selten.filter((e) => e.fits).length;

  const rnd = mulberry32(opts.seed ?? 4242);
  const raten: number[] = [];
  const seltenRaten: number[] = [];
  const groessen = bewertet.map((e) => ({ width: e.width, height: e.height }));
  for (let k = 0; k < controls; k++) {
    const perm = groessen.slice();
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    let ok = 0;
    let sOk = 0;
    let sN = 0;
    for (let i = 0; i < bewertet.length; i++) {
      const r = ranges.get(bewertet[i]!.textureId)!;
      const g = perm[i]!;
      const treffer = g.width >= minimalDimension(r.uMin, r.uMax) && g.height >= minimalDimension(r.vMin, r.vMax);
      if (treffer) ok++;
      if (istSelten(g.width, g.height)) {
        sN++;
        if (treffer) sOk++;
      }
    }
    raten.push(bewertet.length ? ok / bewertet.length : 0);
    if (sN) seltenRaten.push(sOk / sN);
  }
  raten.sort((a, b) => a - b);
  seltenRaten.sort((a, b) => a - b);
  return {
    total: bewertet.length,
    hits,
    rate: bewertet.length ? hits / bewertet.length : 0,
    rareTotal: selten.length,
    rareHits,
    rareRate: selten.length ? rareHits / selten.length : 0,
    controlMedian: raten[Math.floor(raten.length / 2)] ?? 0,
    controlMax: raten[raten.length - 1] ?? 0,
    rareControlMedian: seltenRaten[Math.floor(seltenRaten.length / 2)] ?? 0,
    rareControlMax: seltenRaten[seltenRaten.length - 1] ?? 0,
  };
}
