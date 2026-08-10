import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseHrc, parseP, parseRsd, parseTex } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * Fehlende Augen — Hypothese: eigene Texturen auf bestimmten Flächen.
 *
 * **Stand.** Zwei Erklärungen sind bereits widerlegt: Es gibt keine
 * Mehrfachpaletten (alle 695 `.tex` tragen genau eine, auch laut Kopf), und
 * unser Parser fasst auch nichts fälschlich zusammen (`nP·cPP == pSize` in
 * 695/695).
 *
 * **Die neue Hypothese** (aus der Sichtprüfung): Augen sind **eigene, kleine
 * Texturen**, die auf bestimmte Flächen des Modells gelegt werden. Fehlen sie
 * im Bild, dann nicht weil die Textur fehlt, sondern weil die **Zuordnung
 * Fläche → Textur** bei uns nicht ankommt.
 *
 * **Was daraus folgt, wenn sie stimmt.** Eine RSD führt mehrere Texturen in
 * geordneter Liste; Submeshes indizieren hinein. Dann muss messbar sein:
 *
 *  1. Charaktermodelle führen **mehrere** Texturen je Ressource, nicht eine.
 *  2. Submeshes nutzen **verschiedene** Indizes in diese Liste.
 *  3. Wenn Augen fehlen, gibt es Indizes, die **nicht auflösbar** sind — die
 *     Liste ist kürzer als der größte benutzte Index, oder die Datei fehlt.
 *
 * Punkt 3 ist der eigentliche Test. Löst sich **alles** auf, ist die
 * Hypothese in dieser Form widerlegt und die Ursache liegt in der Darstellung
 * (UV-Bereich, Alpha-Regel) oder in einer Laufzeit-Zuweisung durch das Skript
 * (FF7 kennt im KAWAI-Block einen Unteropcode `EYETX`).
 *
 * **Kontrolle gegen Selbsttäuschung.** „Nicht auflösbar" wird getrennt nach
 * Ursache gezählt: Index außerhalb der Liste gegen Datei nicht im Archiv. Die
 * beiden bedeuten Verschiedenes — das eine wäre ein Auslegungsfehler bei uns,
 * das andere ein fehlender Bestand.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Größenklassen.
 * Keine Dateinamen im Ergebnis.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Textur-Slots je Submesh (fehlende Augen)', () => {
  it('prüft, ob Flächen auf nicht auflösbare Texturen zeigen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    let modelle = 0;
    let ressourcen = 0;
    const texProRsd = new Map<number, number>();
    let submeshes = 0;
    let texturiert = 0;
    let indexAusserhalb = 0;
    let dateiFehlt = 0;
    let aufgeloest = 0;
    const genutzteIndizes = new Map<number, number>();
    // Größenklassen der aufgelösten Texturen — Augen wären auffällig klein.
    const groessen = new Map<string, number>();
    let ausgelasseneGruppen = 0;

    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.hrc')) continue;
      const skeleton = parseHrc(await read(entry.name), entry.name).value;
      if (!skeleton) continue;
      modelle++;
      for (const bone of skeleton.bones) {
        for (const ref of bone.resourceRefs) {
          if (!idByName.has(`${ref}.rsd`)) continue;
          const rsd = parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value;
          if (!rsd) continue;
          ressourcen++;
          texProRsd.set(rsd.textureRefs.length, (texProRsd.get(rsd.textureRefs.length) ?? 0) + 1);

          if (!idByName.has(`${rsd.meshRef}.p`)) continue;
          const mesh = parseP(await read(`${rsd.meshRef}.p`), `${rsd.meshRef}.p`).value;
          if (!mesh) continue;
          ausgelasseneGruppen += mesh.droppedGroups;

          for (const sub of mesh.submeshes) {
            submeshes++;
            if (!sub.textured) continue;
            texturiert++;
            genutzteIndizes.set(sub.textureIndex, (genutzteIndizes.get(sub.textureIndex) ?? 0) + 1);
            const ref2 = rsd.textureRefs[sub.textureIndex];
            if (ref2 === undefined) {
              indexAusserhalb++;
              continue;
            }
            const datei = `${ref2}.tex`;
            if (!idByName.has(datei)) {
              dateiFehlt++;
              continue;
            }
            const tex = parseTex(await read(datei), datei).value;
            if (!tex) {
              dateiFehlt++;
              continue;
            }
            aufgeloest++;
            const flaeche = tex.width * tex.height;
            const klasse = flaeche <= 256 ? '≤16×16' : flaeche <= 4096 ? '≤64×64' : flaeche <= 16384 ? '≤128×128' : '>128×128';
            groessen.set(klasse, (groessen.get(klasse) ?? 0) + 1);
          }
        }
      }
    }
    await dir.closeAll();

    const q = (n: number): string => `${((n / Math.max(1, texturiert)) * 100).toFixed(1)}%`;

    console.log(
      'Textur-Slots je Submesh:',
      JSON.stringify(
        {
          Modelle: modelle,
          'RSD-Ressourcen': ressourcen,
          'Texturen je RSD (Anzahl → Vorkommen)': [...texProRsd.entries()].sort((a, b) => a[0] - b[0]),
          Submeshes: submeshes,
          'davon texturiert': `${texturiert} (${((texturiert / Math.max(1, submeshes)) * 100).toFixed(1)}%)`,
          aufgelöst: `${aufgeloest} (${q(aufgeloest)})`,
          'Index ausserhalb der Liste': `${indexAusserhalb} (${q(indexAusserhalb)})`,
          'Datei nicht im Archiv': `${dateiFehlt} (${q(dateiFehlt)})`,
          'genutzte Slot-Indizes': [...genutzteIndizes.entries()].sort((a, b) => a[0] - b[0]),
          'Grössenklassen aufgelöster Texturen': [...groessen.entries()].sort((a, b) => b[1] - a[1]),
          'ausgelassene Gruppen (W-P-GROUP)': ausgelasseneGruppen,
        },
        null,
        1,
      ),
    );

    expect(modelle).toBeGreaterThan(100);
    expect(texturiert).toBeGreaterThan(100);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
