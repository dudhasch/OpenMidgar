import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  decompressLzs,
  decompressLzsEntry,
  parseFieldEntry,
  type FieldBundle,
} from '@webmidgar/formats-field';
import { WalkmeshSolver } from '@webmidgar/walkmesh';
import { NodeDirectorySource } from './node-source.js';

/**
 * S11-Probe (Gateway-Layout, zweiter Anlauf): Entscheidet zwischen zwei
 * konkurrierenden Layouts des 24-B-Gateway-Records der Triggersektion
 * (Field-Sektion 8) über einen Kreuztest gegen den Walkmesh des Zielfields.
 *
 * Hypothese H (neu):   exitLine @0..11, destFieldId = u16@12,
 *                       destination = Vec3 i16 @14..19, Rest @20..23 unbekannt.
 * Hypothese A (bisher, sections/triggers.ts): exitLine @0..11,
 *                       destination = Vec3 i16 @12..17, destFieldId = u16@18,
 *                       Rest @20..23 unbekannt.
 *
 * Test: Für jeden belegten Gateway-Slot (nicht-entartete Austrittslinie) wird
 * das Zielfield über destFieldId aufgelöst (Index in `maplist`, ersatzweise
 * alphabetisch sortierter Field-Bestand) und geprüft, ob die Zielposition im
 * Walkmesh-Grundriss dieses Zielfields liegt (`WalkmeshSolver.locate`).
 * Kontrollgröße: dieselbe Prüfung mit dem Zielfield des NÄCHSTEN belegten
 * Slots (Index+1) statt des eigenen — liefert die Grundrauschen-Trefferquote.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const TRG_HEADER_LEN = 36;
const GW_LEN = 24;
const GW_COUNT = 12;

/** Layout-Hypothesen: Offsets innerhalb des 24-B-Gateway-Records. */
const HYPOTHESES = {
  H: { destFieldIdOffset: 12, destinationOffset: 14 },
  A: { destFieldIdOffset: 18, destinationOffset: 12 },
} as const;
type HypName = keyof typeof HYPOTHESES;

interface OccupiedGateway {
  view: DataView;
  base: number;
}

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

describe.skipIf(!available)('Realdaten: Gateway-Layout (S11-Probe, 2. Anlauf)', () => {
  it('Hypothese H vs. A gegen Ziel-Walkmesh', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // --- 0. Alle Fields parsen + Namensbestand des Archivs einsammeln. ------
    const flevelEntries = index.listEntries('flevel');
    const allFlevelNames = new Set(
      flevelEntries.filter((e) => e.name !== 'maplist' && !e.name.includes('.')).map((e) => e.name.toLowerCase()),
    );

    const bundles: FieldBundle[] = [];
    const bundleByName = new Map<string, FieldBundle>();
    for (const entry of flevelEntries) {
      if (entry.name === 'maplist' || entry.name.includes('.')) continue;
      try {
        const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        if (parsed.ok && parsed.bundle) {
          bundles.push(parsed.bundle);
          bundleByName.set(entry.name.toLowerCase(), parsed.bundle);
        }
      } catch {
        /* Nicht-Fields / defekte Einträge überspringen */
      }
    }
    const fields = bundles.length;

    // --- 1. `maplist` auflösen: Layout per Accounting ermitteln. -----------
    const maplistEntry = flevelEntries.find((e) => e.name === 'maplist');
    const maplistCandidates: {
      label: string;
      headerLen: number;
      count: number;
      nameLen: number;
      hits: number;
      hitRate: number;
    }[] = [];
    let maplistNames: string[] | null = null;
    let maplistWinner: (typeof maplistCandidates)[number] | null = null;

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

      for (const { label, bytes } of bufferCandidates) {
        for (const headerLen of [2, 4] as const) {
          if (bytes.length < headerLen) continue;
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const count = headerLen === 2 ? view.getUint16(0, true) : view.getUint32(0, true);
          if (count <= 0 || count > 10000) continue;
          const rem = bytes.length - headerLen;
          if (rem % count !== 0) continue;
          const nameLen = rem / count;
          if (nameLen < 1 || nameLen > 128) continue;
          const names = decodeFixedNames(bytes, headerLen, nameLen, count);
          const hits = names.filter((n) => allFlevelNames.has(n.toLowerCase())).length;
          maplistCandidates.push({ label, headerLen, count, nameLen, hits, hitRate: hits / count });
        }
      }
      maplistCandidates.sort((a, b) => b.hitRate - a.hitRate);
      const best = maplistCandidates[0];
      if (best && best.hitRate > 0.5) {
        maplistWinner = best;
        // Bytes des Gewinner-Kandidaten erneut erzeugen, um Namen zu dekodieren.
        const src = bufferCandidates.find((c) => c.label === best.label)!.bytes;
        maplistNames = decodeFixedNames(src, best.headerLen, best.nameLen, best.count);
      }
    }

    const resolutionMode: 'maplist' | 'alphabetical-fallback' = maplistNames ? 'maplist' : 'alphabetical-fallback';
    const alphabeticalNames = [...bundleByName.keys()].sort();

    const resolveField = (id: number): FieldBundle | undefined => {
      if (maplistNames) {
        if (id < 0 || id >= maplistNames.length) return undefined;
        const name = maplistNames[id];
        if (!name) return undefined;
        return bundleByName.get(name.toLowerCase());
      }
      if (id < 0 || id >= alphabeticalNames.length) return undefined;
      return bundleByName.get(alphabeticalNames[id]!);
    };

    // --- 2. Belegte Gateway-Slots einsammeln (nicht-entartete Austrittslinie). --
    const occupied: OccupiedGateway[] = [];
    for (const bundle of bundles) {
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
        occupied.push({ view, base });
      }
    }
    const usedSlots = occupied.length;

    // --- 3. Walkmesh-Kreuztest je Hypothese, real + Kontrolle (Nachbar-Ziel). --
    const solverCache = new Map<FieldBundle, WalkmeshSolver | null>();
    const getSolver = (bundle: FieldBundle): WalkmeshSolver | null => {
      let s = solverCache.get(bundle);
      if (s === undefined) {
        s = bundle.walkmesh ? new WalkmeshSolver(bundle.walkmesh) : null;
        solverCache.set(bundle, s);
      }
      return s;
    };

    const hypResults: Record<
      HypName,
      {
        real: { hits: number; misses: number; unresolvedTarget: number; noWalkmesh: number };
        control: { hits: number; misses: number; unresolvedTarget: number; noWalkmesh: number };
      }
    > = {
      H: {
        real: { hits: 0, misses: 0, unresolvedTarget: 0, noWalkmesh: 0 },
        control: { hits: 0, misses: 0, unresolvedTarget: 0, noWalkmesh: 0 },
      },
      A: {
        real: { hits: 0, misses: 0, unresolvedTarget: 0, noWalkmesh: 0 },
        control: { hits: 0, misses: 0, unresolvedTarget: 0, noWalkmesh: 0 },
      },
    };

    const N = occupied.length;
    for (const hyp of Object.keys(HYPOTHESES) as HypName[]) {
      const { destFieldIdOffset, destinationOffset } = HYPOTHESES[hyp];
      const res = hypResults[hyp];
      for (let i = 0; i < N; i++) {
        const rec = occupied[i]!;
        const destFieldId = rec.view.getUint16(rec.base + destFieldIdOffset, true);
        const dx = rec.view.getInt16(rec.base + destinationOffset, true);
        const dy = rec.view.getInt16(rec.base + destinationOffset + 2, true);
        const dz = rec.view.getInt16(rec.base + destinationOffset + 4, true);

        // Real: eigenes Zielfield.
        const target = resolveField(destFieldId);
        if (!target) {
          res.real.unresolvedTarget++;
        } else {
          const solver = getSolver(target);
          if (!solver) {
            res.real.noWalkmesh++;
          } else if (solver.locate(dx, dy, dz)) {
            res.real.hits++;
          } else {
            res.real.misses++;
          }
        }

        // Kontrolle: Zielfield des nächsten belegten Slots, eigener Punkt.
        const neighbor = occupied[(i + 1) % N]!;
        const neighborDestFieldId = neighbor.view.getUint16(neighbor.base + destFieldIdOffset, true);
        const neighborTarget = resolveField(neighborDestFieldId);
        if (!neighborTarget) {
          res.control.unresolvedTarget++;
        } else {
          const solver = getSolver(neighborTarget);
          if (!solver) {
            res.control.noWalkmesh++;
          } else if (solver.locate(dx, dy, dz)) {
            res.control.hits++;
          } else {
            res.control.misses++;
          }
        }
      }
    }

    // --- 4. Restfelder-Statistik (belegte Slots), absolute Offsets @18/@20/@22. --
    const restOffsets = [18, 20, 22] as const;
    const restStats: Record<number, { min: number; max: number; distinct: number; top8: [number, number][] }> = {};
    for (const off of restOffsets) {
      const hist = new Map<number, number>();
      let min = 0xffff;
      let max = 0;
      for (const rec of occupied) {
        const v = rec.view.getUint16(rec.base + off, true);
        hist.set(v, (hist.get(v) ?? 0) + 1);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const top8 = Array.from(hist.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8) as [number, number][];
      restStats[off] = { min, max, distinct: hist.size, top8 };
    }

    // --- Ausgabe (aggregiert, keine Field-/Originalnamen). ------------------
    const rate = (h: { hits: number; misses: number }): string =>
      h.hits + h.misses > 0 ? `${((h.hits / (h.hits + h.misses)) * 100).toFixed(1)}%` : 'n/a';

    const report = {
      fields,
      maplist: {
        entryFound: !!maplistEntry,
        resolutionMode,
        winner: maplistWinner,
        topCandidates: maplistCandidates.slice(0, 6),
      },
      belegteSlots: usedSlots,
      hypothesen: {
        H: {
          real: { ...hypResults.H.real, trefferquote: rate(hypResults.H.real) },
          kontrolle: { ...hypResults.H.control, trefferquote: rate(hypResults.H.control) },
        },
        A: {
          real: { ...hypResults.A.real, trefferquote: rate(hypResults.A.real) },
          kontrolle: { ...hypResults.A.control, trefferquote: rate(hypResults.A.control) },
        },
      },
      restfelderStatistik: restStats,
    };

    console.log('Gateway-Layout:', JSON.stringify(report, null, 2));

    expect(fields).toBeGreaterThan(700);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
