import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseA, parseHrc, parseP, parseRsd, parseTex } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * S7-Realdaten-Sweep: sämtliche Modellartefakte der char.lgp durch die
 * Parser; Kompositionskette hrc→rsd→(p, tex) wird gegen den Archivindex
 * aufgelöst. Prüft insbesondere die 🟡-Annahme „Vertexindizes gruppenrelativ"
 * (E-P-BOUNDS-Rate) und die Degradierungsmatrix. Ausgabe aggregiert.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Modellketten-Sweep char.lgp', () => {
  it('Parser + Kompositionskette über alle Artefakte', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const idByName = new Map<string, string>();
    for (const entry of index.listEntries('char')) idByName.set(entry.name.toLowerCase(), entry.canonicalId);
    const names = new Set(idByName.keys());
    const byExt = (ext: string): string[] => [...names].filter((n) => n.endsWith(ext));

    const stats = {
      hrc: { total: 0, ok: 0, diag: {} as Record<string, number> },
      rsd: { total: 0, ok: 0, diag: {} as Record<string, number> },
      p: { total: 0, ok: 0, diag: {} as Record<string, number>, droppedGroups: 0, submeshes: 0, texturedSubmeshes: 0 },
      tex: { total: 0, ok: 0, diag: {} as Record<string, number> },
      a: { total: 0, ok: 0, diag: {} as Record<string, number>, boneMin: Infinity, boneMax: 0 },
      chain: { skeletons: 0, complete: 0, missingRsd: 0, missingP: 0, missingTex: 0 },
      samples: [] as string[],
    };
    const count = (rec: Record<string, number>, code: string): void => {
      rec[code] = (rec[code] ?? 0) + 1;
    };
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    for (const name of byExt('.hrc')) {
      stats.hrc.total++;
      const { value, diagnostics } = parseHrc(await read(name), name);
      diagnostics.forEach((d) => count(stats.hrc.diag, d.code));
      if (!value) {
        if (stats.samples.length < 6) stats.samples.push(`hrc ${name}: ${diagnostics[0]?.message}`);
        continue;
      }
      stats.hrc.ok++;
      stats.chain.skeletons++;
      let complete = true;
      for (const bone of value.bones) {
        for (const ref of bone.resourceRefs) {
          const rsdName = `${ref}.rsd`;
          if (!names.has(rsdName)) {
            stats.chain.missingRsd++;
            complete = false;
            continue;
          }
          const rsd = parseRsd(await read(rsdName), rsdName).value;
          if (!rsd) {
            complete = false;
            continue;
          }
          if (!names.has(`${rsd.meshRef}.p`)) {
            stats.chain.missingP++;
            complete = false;
          }
          for (const tex of rsd.textureRefs) {
            if (!names.has(`${tex}.tex`)) {
              stats.chain.missingTex++;
              complete = false;
            }
          }
        }
      }
      if (complete) stats.chain.complete++;
    }

    for (const name of byExt('.rsd')) {
      stats.rsd.total++;
      const { value, diagnostics } = parseRsd(await read(name), name);
      diagnostics.forEach((d) => count(stats.rsd.diag, d.code));
      if (value) stats.rsd.ok++;
      else if (stats.samples.length < 12) stats.samples.push(`rsd ${name}: ${diagnostics[0]?.message}`);
    }

    for (const name of byExt('.p')) {
      stats.p.total++;
      const { value, diagnostics } = parseP(await read(name), name);
      diagnostics.forEach((d) => count(stats.p.diag, d.code));
      if (value) {
        stats.p.ok++;
        stats.p.droppedGroups += value.droppedGroups;
        stats.p.submeshes += value.submeshes.length;
        stats.p.texturedSubmeshes += value.submeshes.filter((s) => s.textured).length;
      } else if (stats.samples.length < 18) {
        stats.samples.push(`p ${name}: ${diagnostics[0]?.message}`);
      }
    }

    for (const name of byExt('.tex')) {
      stats.tex.total++;
      const { value, diagnostics } = parseTex(await read(name), name);
      diagnostics.forEach((d) => count(stats.tex.diag, d.code));
      if (value) stats.tex.ok++;
      else if (stats.samples.length < 24) stats.samples.push(`tex ${name}: ${diagnostics[0]?.message}`);
    }

    for (const name of byExt('.a')) {
      stats.a.total++;
      const { value, diagnostics } = parseA(await read(name), name);
      diagnostics.forEach((d) => count(stats.a.diag, d.code));
      if (value) {
        stats.a.ok++;
        stats.a.boneMin = Math.min(stats.a.boneMin, value.boneCount);
        stats.a.boneMax = Math.max(stats.a.boneMax, value.boneCount);
      } else if (stats.samples.length < 30) {
        stats.samples.push(`a ${name}: ${diagnostics[0]?.message}`);
      }
    }

    console.log('Modell-Sweep:', JSON.stringify(stats, null, 2));

    // Akzeptanz: Parser tragen den echten Bestand; Kernannahmen halten.
    expect(stats.hrc.ok).toBe(stats.hrc.total);
    expect(stats.rsd.ok).toBe(stats.rsd.total);
    expect(stats.p.ok).toBe(stats.p.total);
    expect(stats.tex.ok).toBe(stats.tex.total);
    expect(stats.a.ok).toBe(stats.a.total);
    // Gruppenrelative Vertexindizes: keine Bounds-Verletzungen erwartet.
    expect(stats.p.diag['E-P-BOUNDS'] ?? 0).toBe(0);
    expect(stats.p.droppedGroups).toBe(0);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
