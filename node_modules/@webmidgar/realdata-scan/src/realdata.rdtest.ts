import 'fake-indexeddb/auto';
import { existsSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, type FieldBundle } from '@webmidgar/formats-field';
import { WalkmeshSolver } from '@webmidgar/walkmesh';
import { NodeDirectorySource } from './node-source.js';

/**
 * Realdaten-Crosstest (Masterplan: Diagnose-Scan) gegen eine lokale
 * FF7-PC-Installation. Läuft NUR über die separate Config
 * (`npx vitest run --config vitest.realdata.config.ts`), nie in `npm test`.
 * Output: ausschließlich aggregierte Diagnosen, keine Originaldaten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const REPORT_PATH = process.env['WEBMIDGAR_REPORT'] ?? '';

const available = existsSync(REAL_DIR);

interface FieldSweepStats {
  entries: number;
  fieldsOk: number;
  fieldsFatal: number;
  nonField: number;
  withWalkmesh: number;
  withCameras: number;
  withTriggers: number;
  withScript: number;
  quarantineBySection: Record<number, number>;
  diagCodes: Record<string, number>;
  walkmeshTriangles: { min: number; max: number; total: number };
  examplesFatal: string[];
}

describe.skipIf(!available)('Realdaten: Steam-Installation', () => {
  it(
    'S1: LGP-Deep-Scan von field/battle-Archiven — Struktur hält, Quarantäne minimal',
    { timeout: 600_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field', 'data/battle']);
      const index = new IndexService();
      const result = await index.openSource(dir, { deep: true });

      const summary = result.archives.map((a) => ({
        archive: a.archiveName,
        entries: a.entryCount,
        resolvable: a.resolvable,
        quarantined: a.quarantined,
        fatal: a.fatal,
        ms: Math.round(result.timings.perArchiveMs[a.archiveName] ?? 0),
      }));
      const diagHist: Record<string, number> = {};
      for (const d of result.diagnostics) diagHist[d.code] = (diagHist[d.code] ?? 0) + 1;
      console.log('LGP-Scan:', JSON.stringify(summary, null, 2));
      console.log('LGP-Diagnosen:', JSON.stringify(diagHist));

      expect(result.archives.length).toBeGreaterThanOrEqual(4); // battle, magic, char, flevel, gflevel
      for (const a of result.archives) {
        expect(a.fatal, `${a.archiveName} fatal`).toBe(false);
        expect(a.resolvable, `${a.archiveName} auflösbar`).toBeGreaterThan(0);
        // Quarantäne-Quote < 1 % (Akzeptanzmaß Diagnose-Scan).
        expect(a.quarantined / a.entryCount, `${a.archiveName} Quarantäne`).toBeLessThan(0.01);
      }
      await dir.closeAll();
    },
  );

  it(
    'S2+S5: Field-Sweep über flevel — Container, Sektionen, Solver-Invarianten',
    { timeout: 600_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      const open = await index.openSource(dir, { deep: false });
      const flevel = open.archives.find((a) => a.archiveName === 'flevel');
      expect(flevel).toBeDefined();

      const stats: FieldSweepStats = {
        entries: 0,
        fieldsOk: 0,
        fieldsFatal: 0,
        nonField: 0,
        withWalkmesh: 0,
        withCameras: 0,
        withTriggers: 0,
        withScript: 0,
        quarantineBySection: {},
        diagCodes: {},
        walkmeshTriangles: { min: Infinity, max: 0, total: 0 },
        examplesFatal: [],
      };
      const solverStats = { fields: 0, steps: 0, clamps: 0, slides: 0, crossings: 0, failures: [] as string[] };
      const cameraStats = { total: 0, orthonormal: 0, zoomMin: Infinity, zoomMax: -Infinity };
      const rnd = (() => {
        let a = 0x7777;
        return () => {
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();

      for (const entry of index.listEntries('flevel')) {
        // Nicht-Field-Beifang (maplist, .tut, .siz …) per Endung aussortieren.
        if (entry.name.includes('.')) {
          stats.nonField++;
          continue;
        }
        stats.entries++;
        let bundle: FieldBundle | undefined;
        try {
          const bytes = await index.readEntry(entry.canonicalId);
          const parsed = parseFieldEntry(bytes, entry.name);
          for (const d of parsed.diagnostics) stats.diagCodes[d.code] = (stats.diagCodes[d.code] ?? 0) + 1;
          if (!parsed.ok) {
            stats.fieldsFatal++;
            if (stats.examplesFatal.length < 10) stats.examplesFatal.push(entry.name);
            continue;
          }
          bundle = parsed.bundle!;
        } catch (err) {
          stats.fieldsFatal++;
          stats.diagCodes[`EXC:${(err as Error).name}`] =
            (stats.diagCodes[`EXC:${(err as Error).name}`] ?? 0) + 1;
          if (stats.examplesFatal.length < 10) stats.examplesFatal.push(`${entry.name}!`);
          continue;
        }
        stats.fieldsOk++;
        for (const s of bundle.quarantinedSections) {
          stats.quarantineBySection[s] = (stats.quarantineBySection[s] ?? 0) + 1;
        }
        if (bundle.walkmesh) {
          stats.withWalkmesh++;
          const n = bundle.walkmesh.triangleCount;
          stats.walkmeshTriangles.min = Math.min(stats.walkmeshTriangles.min, n);
          stats.walkmeshTriangles.max = Math.max(stats.walkmeshTriangles.max, n);
          stats.walkmeshTriangles.total += n;
        }
        if (bundle.cameras) {
          stats.withCameras++;
          for (const cam of bundle.cameras.cameras) {
            cameraStats.total++;
            if (cam.orthonormal) cameraStats.orthonormal++;
            cameraStats.zoomMin = Math.min(cameraStats.zoomMin, cam.zoom);
            cameraStats.zoomMax = Math.max(cameraStats.zoomMax, cam.zoom);
          }
        }
        if (bundle.triggers) stats.withTriggers++;
        if (bundle.script) stats.withScript++;

        // S5-Solver-Property-Lauf auf dem echten Walkmesh.
        if (bundle.walkmesh && bundle.walkmesh.triangleCount > 0) {
          const solver = new WalkmeshSolver(bundle.walkmesh);
          const first = solver.tris.findIndex((t) => t.walkable);
          if (first >= 0) {
            const cx = (solver.tris[first]!.xs[0]! + solver.tris[first]!.xs[1]! + solver.tris[first]!.xs[2]!) / 3;
            const cy = (solver.tris[first]!.ys[0]! + solver.tris[first]!.ys[1]! + solver.tris[first]!.ys[2]!) / 3;
            let state = { tri: first, x: cx, y: cy, height: solver.heightAt(first, cx, cy) };
            solverStats.fields++;
            for (let step = 0; step < 200; step++) {
              const angle = rnd() * Math.PI * 2;
              const dist = rnd() * 120;
              const res = solver.move(state, Math.cos(angle) * dist, Math.sin(angle) * dist);
              state = res.state;
              solverStats.steps++;
              for (const e of res.events) {
                if (e.type === 'clamped') solverStats.clamps++;
                if (e.type === 'slid') solverStats.slides++;
                if (e.type === 'crossed') solverStats.crossings++;
              }
              if (!solver.containsPoint(state.tri, state.x, state.y, 0.05)) {
                if (solverStats.failures.length < 10) {
                  solverStats.failures.push(`${entry.name}@${step}`);
                }
                break;
              }
            }
          }
        }
      }

      console.log('Field-Sweep:', JSON.stringify(stats, null, 2));
      console.log('Kameras:', JSON.stringify(cameraStats));
      console.log('Solver:', JSON.stringify(solverStats, null, 2));
      if (REPORT_PATH) {
        writeFileSync(REPORT_PATH, JSON.stringify({ stats, solverStats }, null, 2));
      }

      // Akzeptanz: die große Mehrheit der echten Fields parst mit Walkmesh.
      expect(stats.entries).toBeGreaterThan(500);
      expect(stats.fieldsOk / stats.entries).toBeGreaterThan(0.95);
      expect(stats.withWalkmesh / stats.fieldsOk).toBeGreaterThan(0.95);
      // Solver-Invariante hielt auf allen gelaufenen echten Walkmeshes.
      expect(solverStats.failures).toEqual([]);
      expect(solverStats.fields).toBeGreaterThan(400);
      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen — WEBMIDGAR_REAL_DIR nicht gefunden', () => {
    expect(true).toBe(true);
  });
});
