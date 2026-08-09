import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Abnahme: Model-Loader-Sektion über alle Fields parsen und jede
 * Referenz gegen den tatsächlichen Bestand von `char.lgp` auflösen.
 * Erst wenn Modell- UND Animationsdateien vorhanden sind, trägt das Manifest
 * die Field-Integration.
 *
 * Ausgabe ausschließlich aggregiert — keine Originalnamen, nur Zahlen,
 * Endungen und Fehlerklassen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Model-Loader-Sweep (S10)', () => {
  it('702 Manifeste + Referenzauflösung gegen char.lgp', { timeout: 900_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field', 'data/field/char.lgp']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    // Bestand von char.lgp als Namensmenge (kleingeschrieben).
    const charNames = new Set<string>();
    const charSuffixes: Record<string, number> = {};
    const stemPrefixSet = new Set<string>();
    for (const entry of index.listEntries('char')) {
      const n = entry.name.toLowerCase();
      charNames.add(n);
      const dot = n.lastIndexOf('.');
      const suf = dot >= 0 ? n.slice(dot) : '(ohne)';
      charSuffixes[suf] = (charSuffixes[suf] ?? 0) + 1;
      if (dot >= 0) stemPrefixSet.add(n.slice(0, dot));
    }

    const stats = {
      fields: 0,
      manifests: 0,
      diag: {} as Record<string, number>,
      models: 0,
      animations: 0,
      modelsPerField: {} as Record<number, number>,
      animsPerModel: { max: 0, zero: 0 },
      scaleGlobalTop: {} as Record<number, number>,
      modelScaleTop: {} as Record<string, number>,
      modelExt: {} as Record<string, number>,
      animExt: {} as Record<string, number>,
      modelResolved: 0,
      animResolved: 0,
      unknownAfterNameNonZero: 0,
      animTailNonOne: 0,
      // Kandidatenabbildungen für die Animationsnamen (siehe Auswertung unten).
      animVariant: { exact: 0, stemPrefix: 0 },
      animDistinct: new Set<string>(),
      missingModelExamples: [] as string[],
      missingAnimExtensions: {} as Record<string, number>,
    };

    for (const entry of index.listEntries('flevel')) {
      if (entry.name.includes('.')) continue;
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      if (!parsed.ok || !parsed.bundle) continue;
      stats.fields++;
      for (const d of parsed.diagnostics) {
        if (d.code.includes('MDL')) stats.diag[d.code] = (stats.diag[d.code] ?? 0) + 1;
      }
      const manifest = parsed.bundle.models;
      if (!manifest) continue;
      stats.manifests++;
      stats.scaleGlobalTop[manifest.scaleGlobal] = (stats.scaleGlobalTop[manifest.scaleGlobal] ?? 0) + 1;
      stats.modelsPerField[manifest.models.length] = (stats.modelsPerField[manifest.models.length] ?? 0) + 1;

      for (const model of manifest.models) {
        stats.models++;
        if (model.unknownAfterName !== 0) stats.unknownAfterNameNonZero++;
        const mext = model.modelFile.slice(model.modelFile.lastIndexOf('.'));
        stats.modelExt[mext] = (stats.modelExt[mext] ?? 0) + 1;
        const sk = model.scale === null ? 'null' : String(model.scale);
        stats.modelScaleTop[sk] = (stats.modelScaleTop[sk] ?? 0) + 1;
        if (charNames.has(model.modelFile)) stats.modelResolved++;
        else if (stats.missingModelExamples.length < 6) {
          stats.missingModelExamples.push(`Endung ${mext}, Länge ${model.modelFile.length}`);
        }
        stats.animsPerModel.max = Math.max(stats.animsPerModel.max, model.animations.length);
        if (model.animations.length === 0) stats.animsPerModel.zero++;
        for (const anim of model.animations) {
          stats.animations++;
          if (anim.tail !== 1) stats.animTailNonOne++;
          const aext = anim.name.slice(anim.name.lastIndexOf('.'));
          stats.animExt[aext] = (stats.animExt[aext] ?? 0) + 1;
          // `file` ist die aufgelöste Referenz (Stamm + `.a`), `name` der Rohname.
          if (charNames.has(anim.file)) stats.animResolved++;
          else stats.missingAnimExtensions[aext] = (stats.missingAnimExtensions[aext] ?? 0) + 1;

          stats.animDistinct.add(anim.file);
          if (charNames.has(anim.name)) stats.animVariant.exact++;
          if (stemPrefixSet.has(anim.file.slice(0, -2))) stats.animVariant.stemPrefix++;
        }
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(2)}%`);
    const top = (o: Record<string | number, number>, n = 8): unknown =>
      Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

    console.log(
      'Model-Loader-Sweep:',
      JSON.stringify(
        {
          fields: stats.fields,
          manifests: stats.manifests,
          diagnosen: stats.diag,
          modelle: stats.models,
          animationen: stats.animations,
          modelleJeField: top(stats.modelsPerField, 14),
          animationenJeModell: stats.animsPerModel,
          scaleGlobal: top(stats.scaleGlobalTop),
          modellSkala: top(stats.modelScaleTop),
          modellEndungen: top(stats.modelExt),
          animEndungen: top(stats.animExt),
          charBestand: charNames.size,
          modellAufgeloest: `${pct(stats.modelResolved, stats.models)} (${stats.modelResolved}/${stats.models})`,
          animAufgeloest: `${pct(stats.animResolved, stats.animations)} (${stats.animResolved}/${stats.animations})`,
          fehlendeModelle: stats.missingModelExamples,
          fehlendeAnimEndungen: top(stats.missingAnimExtensions),
          charEndungen: top(charSuffixes, 10),
          animNamenVerschieden: stats.animDistinct.size,
          animAbbildungen: stats.animVariant,
          unknownAfterNameNichtNull: stats.unknownAfterNameNonZero,
          animTailNichtEins: stats.animTailNonOne,
        },
        null,
        1,
      ),
    );

    expect(stats.fields).toBeGreaterThan(700);
    // Die Grammatik ist realdaten-validiert: jedes Field muss ein Manifest liefern.
    expect(stats.manifests).toBe(stats.fields);
    expect(stats.diag['E-MDL-SIZE']).toBeUndefined();
    expect(stats.diag['E-MDL-COUNT']).toBeUndefined();
    // Jede Referenz des Manifests muss im Modellarchiv auflösbar sein.
    expect(stats.modelResolved).toBe(stats.models);
    expect(stats.animResolved).toBe(stats.animations);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
