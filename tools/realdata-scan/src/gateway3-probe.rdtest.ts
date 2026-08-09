import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { decompressLzs, decompressLzsEntry, parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { WalkmeshSolver } from '@webmidgar/walkmesh';
import { NodeDirectorySource } from './node-source.js';

/**
 * S8-Probe (Zielfield-Nummer, 3. Anlauf): Klärt koordinatenfrei, welches
 * u16-Feld im 24-B-Gateway-Record der Triggersektion die Ziel-Field-Nummer
 * trägt — über Graph-Symmetrie (Rückkante) statt über Zielkoordinaten.
 *
 * Bisher wurden zwei Auslegungen über die Probe „Zielpunkt liegt im
 * Walkmesh des Zielfields" verworfen (9,0 % Treffer ggü. 10,8 % Kontrolle,
 * siehe gateway2-probe.rdtest.ts). Der Zielpunkt hilft offenbar nicht
 * weiter — diese Probe verzichtet komplett auf Koordinaten.
 *
 * Idee: Führt Field A ein Gateway nach B, hat B fast immer ein Gateway
 * zurück nach A (die Spielwelt ist begehbar, Sackgassen sind die
 * Ausnahme). Diese Rückkanten-Symmetrie ist unabhängig von Koordinaten.
 * Für jeden u16-Offset 12..22 und jede von vier Auflösungsvarianten wird
 * der gerichtete Gateway-Graph gebaut und die Rückkantenquote gegen ein
 * Kontrollniveau (feste Verschiebung der Ziele um 37) gemessen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TRG_HEADER_LEN = 36;
const GW_LEN = 24;
const GW_COUNT = 12;
const CONTROL_SHIFT = 37;

/** Dekodiert `count` nullterminierte Namen fester Länge ab `headerLen`. */
function decodeFixedNames(bytes: Uint8Array, headerLen: number, nameLen: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = headerLen + i * nameLen;
    let s = '';
    for (let k = 0; k < nameLen; k++) {
      const b = bytes[start + k] ?? 0;
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    out.push(s);
  }
  return out;
}

interface OccupiedGateway {
  view: DataView;
  base: number;
  /** Index des Fields, dem dieser Gateway-Record gehört (Bundle-Array-Index). */
  ownerFieldIdx: number;
}

type Variant = 'V1' | 'V2' | 'V3' | 'V4';
const VARIANTS: Variant[] = ['V1', 'V2', 'V3', 'V4'];
const OFFSETS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const;

interface LoadedFields {
  bundles: FieldBundle[];
  bundleNames: string[]; // Archivreihenfolge, kleingeschrieben
  bundleIdxByName: Map<string, number>;
  maplistEntryFound: boolean;
  maplistToName: string[]; // maplistIndex -> Fieldname (kleingeschrieben)
  maplistDecodeWeg: string;
  alphabeticalNames: string[];
}

/** Lädt alle Fields (Name + Bundle) und dekodiert `maplist` (mit LZS-Fallback). */
async function loadFieldsAndMaplist(index: IndexService): Promise<LoadedFields> {
  const flevelEntries = index.listEntries('flevel').filter((e) => !e.name.includes('.'));

  const bundleNames: string[] = [];
  const bundles: FieldBundle[] = [];
  const bundleIdxByName = new Map<string, number>();

  for (const entry of flevelEntries) {
    if (entry.name === 'maplist') continue;
    try {
      const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      if (parsed.ok && parsed.bundle) {
        const idx = bundles.length;
        bundles.push(parsed.bundle);
        bundleNames.push(entry.name.toLowerCase());
        bundleIdxByName.set(entry.name.toLowerCase(), idx);
      }
    } catch {
      /* Nicht-Fields / defekte Einträge überspringen */
    }
  }

  const maplistEntry = flevelEntries.find((e) => e.name === 'maplist');
  let maplistNames: string[] | null = null;
  let maplistDecodeWeg = 'nicht gefunden';

  if (maplistEntry) {
    const raw = await index.readEntry(maplistEntry.canonicalId);
    const bufferCandidates: { label: string; bytes: Uint8Array }[] = [{ label: 'raw', bytes: raw }];
    try {
      bufferCandidates.push({ label: 'lzsEntry(u32-len+LZS)', bytes: decompressLzsEntry(raw) });
    } catch {
      /* kein u32-Längenvorsatz + LZS-Strom */
    }
    try {
      bufferCandidates.push({ label: 'lzsRaw(reiner LZS-Strom)', bytes: decompressLzs(raw) });
    } catch {
      /* kein reiner LZS-Strom */
    }

    let best: { label: string; count: number; headerLen: number; nameLen: number; hitRate: number } | null = null;
    for (const { label, bytes } of bufferCandidates) {
      if (bytes.length < 2) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint16(0, true);
      const headerLen = 2;
      const nameLen = 32;
      if (headerLen + count * nameLen > bytes.length) continue;
      const names = decodeFixedNames(bytes, headerLen, nameLen, count);
      const hits = names.filter((n) => bundleIdxByName.has(n.toLowerCase())).length;
      const hitRate = count > 0 ? hits / count : 0;
      if (!best || hitRate > best.hitRate) {
        best = { label, count, headerLen, nameLen, hitRate };
      }
    }
    if (best && best.hitRate > 0.5) {
      maplistDecodeWeg = best.label;
      const src = bufferCandidates.find((c) => c.label === best!.label)!.bytes;
      maplistNames = decodeFixedNames(src, best.headerLen, best.nameLen, best.count);
    }
  }

  const maplistToName: string[] = maplistNames ?? [];
  const alphabeticalNames = [...bundleNames].sort();

  return {
    bundles,
    bundleNames,
    bundleIdxByName,
    maplistEntryFound: !!maplistEntry,
    maplistToName,
    maplistDecodeWeg,
    alphabeticalNames,
  };
}

/** Sammelt alle belegten Gateway-Slots (nicht-entartete Austrittslinie) über alle Fields. */
function collectOccupied(bundles: FieldBundle[]): OccupiedGateway[] {
  const occupied: OccupiedGateway[] = [];
  for (let fieldIdx = 0; fieldIdx < bundles.length; fieldIdx++) {
    const bundle = bundles[fieldIdx]!;
    const raw = bundle.rawSections[8];
    if (!raw) continue;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let g = 0; g < GW_COUNT; g++) {
      const base = TRG_HEADER_LEN + g * GW_LEN;
      if (base + GW_LEN > raw.length) continue;
      const ax = view.getInt16(base, true);
      const ay = view.getInt16(base + 2, true);
      const az = view.getInt16(base + 4, true);
      const bx = view.getInt16(base + 6, true);
      const by = view.getInt16(base + 8, true);
      const bz = view.getInt16(base + 10, true);
      const degenerate = ax === bx && ay === by && az === bz;
      if (degenerate) continue;
      occupied.push({ view, base, ownerFieldIdx: fieldIdx });
    }
  }
  return occupied;
}

/** Zielfield-Auflösung über u16@14 als 0-basierten maplist-Index (gesicherter Befund, S8/2. Anlauf). */
function resolveDestFieldIdx(
  rec: OccupiedGateway,
  maplistToName: string[],
  bundleIdxByName: Map<string, number>,
): number | undefined {
  const raw = rec.view.getUint16(rec.base + 14, true);
  const name = maplistToName[raw];
  if (!name) return undefined;
  return bundleIdxByName.get(name.toLowerCase());
}

describe.skipIf(!available)('Realdaten: Zielfield-Nummer via Rückkanten-Symmetrie (S8, 3. Anlauf)', () => {
  it('Rückkante: u16-Offset × Auflösungsvariante gegen Kontrollniveau', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // --- 0. Alle Fields parsen + `maplist` dekodieren (LZS-Fallback). -------
    const { bundles, bundleIdxByName, maplistEntryFound, maplistToName, maplistDecodeWeg, alphabeticalNames } =
      await loadFieldsAndMaplist(index);
    const fields = bundles.length;

    // Fieldname (lc) -> maplistIndex
    const nameToMaplistIdx = new Map<string, number>();
    maplistToName.forEach((n, i) => {
      if (n) nameToMaplistIdx.set(n.toLowerCase(), i);
    });

    // --- 1. Belegte Gateway-Slots einsammeln (nicht-entartete Austrittslinie). --
    const occupied: OccupiedGateway[] = collectOccupied(bundles);
    const usedSlots = occupied.length;
    const N = occupied.length;

    // --- 2. Auflösungsvarianten: (Offset, rohwert) -> Bundle-Index | undefined. --
    function resolve(variant: Variant, raw: number): number | undefined {
      switch (variant) {
        case 'V1': {
          // v ist 0-basierter maplist-Index -> Name -> Field
          const name = maplistToName[raw];
          if (!name) return undefined;
          return bundleIdxByName.get(name.toLowerCase());
        }
        case 'V2': {
          // v-1 ist maplist-Index (1-basiert)
          const name = maplistToName[raw - 1];
          if (!name) return undefined;
          return bundleIdxByName.get(name.toLowerCase());
        }
        case 'V3': {
          // v ist 0-basierter Index in alphabetisch sortierter Namensliste
          if (raw < 0 || raw >= alphabeticalNames.length) return undefined;
          const name = alphabeticalNames[raw];
          if (!name) return undefined;
          return bundleIdxByName.get(name);
        }
        case 'V4': {
          // v ist 0-basierter Index in Field-Liste in Archivreihenfolge
          if (raw < 0 || raw >= bundles.length) return undefined;
          return raw;
        }
      }
    }

    // --- 4. Für jeden (Offset, Variante) den gerichteten Graphen bauen. -----
    interface Combo {
      offset: number;
      variant: Variant;
      aufloesbar: number;
      rueckkante: number;
      selbstbezug: number;
      zielGrad: number;
      kontrolle: number;
      kanten: number;
    }

    const combos: Combo[] = [];

    for (const offset of OFFSETS) {
      for (const variant of VARIANTS) {
        // Kanten real: edges[i] = Ziel-Bundle-Index für occupied[i], oder undefined.
        const edges: (number | undefined)[] = new Array(N);
        for (let i = 0; i < N; i++) {
          const rec = occupied[i]!;
          const raw = rec.view.getUint16(rec.base + offset, true);
          edges[i] = resolve(variant, raw);
        }

        let resolvedCount = 0;
        let selfCount = 0;
        const targetSet = new Set<number>();
        // Adjazenz A->B für Rückkantenprüfung, gebaut aus (ownerFieldIdx -> Ziel).
        const adjacency = new Set<string>();
        for (let i = 0; i < N; i++) {
          const dst = edges[i];
          if (dst === undefined) continue;
          resolvedCount++;
          const src = occupied[i]!.ownerFieldIdx;
          if (src === dst) selfCount++;
          targetSet.add(dst);
          adjacency.add(`${src}->${dst}`);
        }

        let backCount = 0;
        let backChecked = 0;
        for (let i = 0; i < N; i++) {
          const dst = edges[i];
          if (dst === undefined) continue;
          const src = occupied[i]!.ownerFieldIdx;
          if (src === dst) continue; // Selbstbezug für Rückkantenquote ausschließen
          backChecked++;
          if (adjacency.has(`${dst}->${src}`)) backCount++;
        }

        // Kontrollniveau: Ziel von Record (i+37) mod N statt eigenem Ziel.
        const controlAdjacency = new Set<string>();
        for (let i = 0; i < N; i++) {
          const dst = edges[(i + CONTROL_SHIFT) % N];
          if (dst === undefined) continue;
          const src = occupied[i]!.ownerFieldIdx;
          controlAdjacency.add(`${src}->${dst}`);
        }
        let controlBackCount = 0;
        let controlBackChecked = 0;
        for (let i = 0; i < N; i++) {
          const dst = edges[(i + CONTROL_SHIFT) % N];
          if (dst === undefined) continue;
          const src = occupied[i]!.ownerFieldIdx;
          if (src === dst) continue;
          controlBackChecked++;
          if (controlAdjacency.has(`${dst}->${src}`)) controlBackCount++;
        }

        combos.push({
          offset,
          variant,
          aufloesbar: resolvedCount / N,
          rueckkante: backChecked > 0 ? backCount / backChecked : 0,
          selbstbezug: resolvedCount > 0 ? selfCount / resolvedCount : 0,
          zielGrad: targetSet.size,
          kontrolle: controlBackChecked > 0 ? controlBackCount / controlBackChecked : 0,
          kanten: backChecked,
        });
      }
    }

    const qualifying = combos.filter((c) => c.aufloesbar >= 0.5).sort((a, b) => b.rueckkante - a.rueckkante);
    const best = qualifying[0];

    // --- 5. Zusatzmessung für die beste Kombination: Ausgangsgrad-Histogramm. --
    let zusatzmessung: {
      offset: number;
      variant: Variant;
      histogramm: Record<string, number>;
      fieldsOhneAusgang: number;
    } | null = null;

    if (best) {
      const outDegree = new Map<number, number>(); // fieldIdx -> Anzahl ausgehender Kanten
      for (let i = 0; i < N; i++) {
        const rec = occupied[i]!;
        const raw = rec.view.getUint16(rec.base + best.offset, true);
        const dst = resolve(best.variant, raw);
        if (dst === undefined) continue;
        const src = rec.ownerFieldIdx;
        outDegree.set(src, (outDegree.get(src) ?? 0) + 1);
      }
      const histogramm: Record<string, number> = {};
      for (const deg of outDegree.values()) {
        const key = String(deg);
        histogramm[key] = (histogramm[key] ?? 0) + 1;
      }
      const fieldsOhneAusgang = bundles.length - outDegree.size;
      zusatzmessung = { offset: best.offset, variant: best.variant, histogramm, fieldsOhneAusgang };
    }

    // --- Ausgabe (aggregiert, keine Field-/Originalnamen). ------------------
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

    const report = {
      fields,
      belegteSlots: usedSlots,
      maplist: {
        entryFound: maplistEntryFound,
        decodeWeg: maplistDecodeWeg,
        anzahlNamen: maplistToName.length,
        anzahlAufgeloest: nameToMaplistIdx.size,
      },
      tabelle: qualifying.map((c) => ({
        offset: c.offset,
        variante: c.variant,
        aufloesbar: pct(c.aufloesbar),
        rueckkante: pct(c.rueckkante),
        kontrolle: pct(c.kontrolle),
        selbstbezug: pct(c.selbstbezug),
        zielGrad: c.zielGrad,
        geprueftKanten: c.kanten,
      })),
      besteKombination: best
        ? {
            offset: best.offset,
            variante: best.variant,
            rueckkante: pct(best.rueckkante),
            kontrolle: pct(best.kontrolle),
            abstandProzentpunkte: ((best.rueckkante - best.kontrolle) * 100).toFixed(1),
          }
        : null,
      zusatzmessungBesteKombination: zusatzmessung,
    };

    console.log('Zielfield-Rückkante:', JSON.stringify(report, null, 2));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

  // --- Zweite Probe: Zielpunkt (unabhängige Bestätigung der Rückkante). -----
  const CANDIDATE_POINT_OFFSETS = [12, 16, 18, 20] as const;
  /** Feste Verschiebung für das Kontrollniveau (Ziel des NACHFOLGENDEN Records). */
  const NEXT_SHIFT = 1;
  /** Übrige u16-Felder, deren Wertestatistik/Plausibilität berichtet wird. */
  const REST_OFFSETS = [12, 16, 18, 20, 22] as const;

  /** Bounding-Box aller begehbaren Dreiecke im Grundriss (x/y). */
  function computeBBox(solver: WalkmeshSolver): { minX: number; maxX: number; minY: number; maxY: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const t of solver.tris) {
      if (!t.walkable) continue;
      any = true;
      for (const x of t.xs) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      for (const y of t.ys) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return any ? { minX, maxX, minY, maxY } : null;
  }

  /** Abstand eines Punkts zur nächsten Kante/Ecke einer Bounding-Box (0 = innerhalb). */
  function distToBBox(x: number, y: number, box: { minX: number; maxX: number; minY: number; maxY: number }): number {
    const dx = Math.max(0, box.minX - x, x - box.maxX);
    const dy = Math.max(0, box.minY - y, y - box.maxY);
    return Math.hypot(dx, dy);
  }

  /** Kombinierter Wertebereich (min/max über x,y,z) aller Walkmesh-Ecken eines Fields. */
  function computeOwnRange(bundle: FieldBundle): { min: number; max: number } | null {
    if (!bundle.walkmesh) return null;
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    for (const tri of bundle.walkmesh.triangles) {
      for (const v of tri.vertices) {
        for (const c of v) {
          any = true;
          if (c < min) min = c;
          if (c > max) max = c;
        }
      }
    }
    return any ? { min, max } : null;
  }

  function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  describe.skipIf(!available)('Realdaten: Zielfield-Nummer via Rückkanten-Symmetrie (S8, 3. Anlauf)', () => {
    it(
      'Zielpunkt: Vec3-Kandidatenoffset gegen Ziel-Walkmesh (unabhängige Bestätigung von u16@14/V1)',
      { timeout: 900_000 },
      async () => {
        const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
        const index = new IndexService();
        await index.openSource(dir, { deep: false });

        const { bundles, bundleIdxByName, maplistToName } = await loadFieldsAndMaplist(index);
        const fields = bundles.length;
        const occupied = collectOccupied(bundles);
        const N = occupied.length;

        // --- 1. Zielfield je Record über u16@14 (0-basierter maplist-Index). --
        const destFieldIdx: (number | undefined)[] = occupied.map((rec) =>
          resolveDestFieldIdx(rec, maplistToName, bundleIdxByName),
        );
        const unresolvedTarget = destFieldIdx.filter((d) => d === undefined).length;

        // --- 2. Solver + Bounding-Box je Zielfield cachen. ---------------------
        const solverCache = new Map<number, WalkmeshSolver | null>();
        const bboxCache = new Map<number, { minX: number; maxX: number; minY: number; maxY: number } | null>();
        const getSolver = (fieldIdx: number): WalkmeshSolver | null => {
          let s = solverCache.get(fieldIdx);
          if (s === undefined) {
            const bundle = bundles[fieldIdx];
            s = bundle?.walkmesh ? new WalkmeshSolver(bundle.walkmesh) : null;
            solverCache.set(fieldIdx, s);
          }
          return s;
        };
        const getBBox = (fieldIdx: number): { minX: number; maxX: number; minY: number; maxY: number } | null => {
          let b = bboxCache.get(fieldIdx);
          if (b === undefined) {
            const solver = getSolver(fieldIdx);
            b = solver ? computeBBox(solver) : null;
            bboxCache.set(fieldIdx, b);
          }
          return b;
        };

        // --- 3. Je Kandidatenoffset: Treffer/Kontrolle gegen Ziel-Walkmesh. ----
        interface CandidateResult {
          offset: number;
          verworfen: boolean;
          grund: string | null;
          hits: number;
          misses: number;
          noWalkmesh: number;
          geprueft: number;
          controlHits: number;
          controlMisses: number;
          controlGeprueft: number;
          missAbstaende: number[];
        }
        const candidates: CandidateResult[] = [];

        for (const offset of CANDIDATE_POINT_OFFSETS) {
          // Vec3 i16 (x,y,z) muss vollständig in den 24 B des Records passen.
          if (offset + 6 > GW_LEN) {
            candidates.push({
              offset,
              verworfen: true,
              grund: 'dritter i16-Wert (z) ragt über den 24-B-Record hinaus',
              hits: 0,
              misses: 0,
              noWalkmesh: 0,
              geprueft: 0,
              controlHits: 0,
              controlMisses: 0,
              controlGeprueft: 0,
              missAbstaende: [],
            });
            continue;
          }

          let hits = 0;
          let misses = 0;
          let noWalkmesh = 0;
          let controlHits = 0;
          let controlMisses = 0;
          let controlGeprueft = 0;
          const missAbstaende: number[] = [];

          for (let i = 0; i < N; i++) {
            const rec = occupied[i]!;
            const x = rec.view.getInt16(rec.base + offset, true);
            const y = rec.view.getInt16(rec.base + offset + 2, true);

            const target = destFieldIdx[i];
            if (target !== undefined) {
              const solver = getSolver(target);
              if (!solver) {
                noWalkmesh++;
              } else if (solver.locate(x, y) !== null) {
                hits++;
              } else {
                misses++;
                const box = getBBox(target);
                if (box) missAbstaende.push(distToBBox(x, y, box));
              }
            }

            // Kontrolle: derselbe Punkt gegen das Zielmesh des nachfolgenden Records.
            const neighborTarget = destFieldIdx[(i + NEXT_SHIFT) % N];
            if (neighborTarget !== undefined) {
              const solver = getSolver(neighborTarget);
              if (solver) {
                controlGeprueft++;
                if (solver.locate(x, y) !== null) controlHits++;
                else controlMisses++;
              }
            }
          }

          candidates.push({
            offset,
            verworfen: false,
            grund: null,
            hits,
            misses,
            noWalkmesh,
            geprueft: hits + misses,
            controlHits,
            controlMisses,
            controlGeprueft,
            missAbstaende,
          });
        }

        const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

        const auswertung = candidates.map((c) => ({
          offset: c.offset,
          verworfen: c.verworfen,
          grund: c.grund,
          geprueft: c.geprueft,
          trefferquote: pct(c.hits, c.geprueft),
          kontrollquote: pct(c.controlHits, c.controlGeprueft),
          noWalkmesh: c.noWalkmesh,
        }));

        const best = candidates
          .filter((c) => !c.verworfen && c.geprueft > 0)
          .sort((a, b) => b.hits / b.geprueft - a.hits / a.geprueft)[0];
        const bestMedianAbstand = best ? median(best.missAbstaende) : null;

        // --- 4. Restfelder einordnen: Wertestatistik + Plausibilität (eigenes Field). --
        const restStats: Record<
          number,
          {
            min: number;
            max: number;
            distinct: number;
            top8: [number, number][];
            eigenesFieldPlausibelQuote: string;
          }
        > = {};
        const ownRangeCache = new Map<number, { min: number; max: number } | null>();
        const getOwnRange = (fieldIdx: number): { min: number; max: number } | null => {
          let r = ownRangeCache.get(fieldIdx);
          if (r === undefined) {
            r = computeOwnRange(bundles[fieldIdx]!);
            ownRangeCache.set(fieldIdx, r);
          }
          return r;
        };

        for (const off of REST_OFFSETS) {
          const hist = new Map<number, number>();
          let min = 0xffff;
          let max = 0;
          let plausibel = 0;
          let plausibelGeprueft = 0;
          for (const rec of occupied) {
            const vU16 = rec.view.getUint16(rec.base + off, true);
            hist.set(vU16, (hist.get(vU16) ?? 0) + 1);
            if (vU16 < min) min = vU16;
            if (vU16 > max) max = vU16;

            const vI16 = rec.view.getInt16(rec.base + off, true);
            const range = getOwnRange(rec.ownerFieldIdx);
            if (range) {
              plausibelGeprueft++;
              if (vI16 >= range.min && vI16 <= range.max) plausibel++;
            }
          }
          const top8 = Array.from(hist.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8) as [number, number][];
          restStats[off] = {
            min,
            max,
            distinct: hist.size,
            top8,
            eigenesFieldPlausibelQuote: pct(plausibel, plausibelGeprueft),
          };
        }

        const report = {
          fields,
          belegteSlots: N,
          zielfieldAufgeloest: N - unresolvedTarget,
          zielfieldUnaufgeloest: unresolvedTarget,
          kandidaten: auswertung,
          besteKombination: best
            ? {
                offset: best.offset,
                trefferquote: pct(best.hits, best.geprueft),
                kontrollquote: pct(best.controlHits, best.controlGeprueft),
                geprueft: best.geprueft,
                medianAbstandFehlschlaegeZurBBox: bestMedianAbstand,
                anzahlFehlschlaegeMitAbstand: best.missAbstaende.length,
              }
            : null,
          restfelderStatistik: restStats,
        };

        console.log('Zielpunkt-Probe:', JSON.stringify(report, null, 2));

        expect(fields).toBeGreaterThan(700);
        await dir.closeAll();
      },
    );
  });

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
