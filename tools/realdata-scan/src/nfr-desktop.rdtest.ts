import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseHrc, parseP, parseRsd, parseTex } from '@webmidgar/formats-model';
import {
  berechneReplayVektoren,
  bewerte,
  bilanziere,
  fuehreKampagneAus,
  jetzt,
  kontrollLauf,
  messeMathExposition,
  perzentile,
  vergleicheGegenErwartung,
  type NfrBefund,
} from '@webmidgar/nfr-run';
import { NodeDirectorySource } from './node-source.js';

/**
 * S20 — NFR-Messkampagne gegen die **echte lokale Installation** (Desktop).
 *
 * Gemessen wird die Rechenlast der Engine-Kette in Node: Scan, Slice-Read,
 * LZS, Container-Parse, Sitzungsaufbau, Ticks, Atlasaufbau, dazu die
 * Einzelasset-Latenz einer vollständigen Modellkette aus `char.lgp`.
 * Browserkosten (GPU-Upload, Worker-Übergabe, Renderer) sind NICHT enthalten
 * — dieser Lauf ist deshalb eine belastbare **untere Schranke** für die
 * Latenzbudgets und die vollständige Quelle für das ADR-010-Lastprofil.
 *
 * Ausgabe: ausschließlich aggregierte Zahlen. Keine Fieldnamen, keine
 * Pfade, keine Bytes.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const runde = (n: number, stellen = 2): number => +n.toFixed(stellen);
const rundeP = (p: { n: number; p50: number; p95: number; max: number; summeMs: number }): Record<string, number> => ({
  n: p.n,
  p50: runde(p.p50),
  p95: runde(p.p95),
  max: runde(p.max),
  summeMs: runde(p.summeMs, 1),
});

describe.skipIf(!available)('Realdaten: NFR-Messkampagne Desktop (S20)', () => {
  it('misst alle Metriken aus Masterplan 2.4 und bewertet sie', { timeout: 3_600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const e = await fuehreKampagneAus({
      quelle: dir,
      archiv: 'flevel',
      atlasGroesse: 2048,
      ticksJeSitzung: 60,
    });

    // --- Einzelasset-Latenz: vollständige Modellkette aus char.lgp ----------
    // „Request → NAM-Auslieferung" heißt bei einem Modell: Skelett, alle
    // Ressourcenbindungen, Geometrie und Texturen. Nur den .hrc zu messen
    // wäre eine geschönte Zahl.
    const charDir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const charIndex = new IndexService();
    await charIndex.openSource(charDir, { deep: false });
    const idByName = new Map<string, string>();
    for (const eintrag of charIndex.listEntries('char')) {
      idByName.set(eintrag.name.toLowerCase(), eintrag.canonicalId);
    }
    const hrcNamen = [...idByName.keys()].filter((n) => n.endsWith('.hrc')).sort().slice(0, 40);

    const ladeKette = async (hrcName: string): Promise<number> => {
      const t0 = jetzt();
      const hrc = parseHrc(await charIndex.readEntry(idByName.get(hrcName)!), hrcName).value;
      if (hrc) {
        for (const bone of hrc.bones) {
          for (const ref of bone.resourceRefs) {
            const rsdId = idByName.get(`${ref}.rsd`);
            if (!rsdId) continue;
            const rsd = parseRsd(await charIndex.readEntry(rsdId), `${ref}.rsd`).value;
            if (!rsd) continue;
            const pId = idByName.get(`${rsd.meshRef}.p`);
            if (pId) parseP(await charIndex.readEntry(pId), `${rsd.meshRef}.p`);
            for (const tex of rsd.textureRefs) {
              const texId = idByName.get(`${tex}.tex`);
              if (texId) parseTex(await charIndex.readEntry(texId), `${tex}.tex`);
            }
          }
        }
      }
      return jetzt() - t0;
    };

    const kaltLatenzen: number[] = [];
    for (const name of hrcNamen) kaltLatenzen.push(await ladeKette(name));
    // Warm = Betriebssystem-Dateicache + JIT warm; der S2-Cache liefert im
    // Produktionspfad zusätzlich, diese Zahl ist also konservativ.
    const warmLatenzen: number[] = [];
    for (const name of hrcNamen) warmLatenzen.push(await ladeKette(name));

    const assetKalt = perzentile(kaltLatenzen);
    const assetWarm = perzentile(warmLatenzen);

    const befunde: NfrBefund[] = [
      bewerte('ttff-cold', e.ttffKaltMs, 'desktop', `Erstimport ${e.eintraege} Einträge + erstes Field`),
      bewerte('ttff-warm', e.ttffWarmMs, 'desktop', 'S0-Treffer + erstes Field'),
      bewerte('field-wechsel-warm', e.etappen.wechselGesamt.p95, 'desktop', `p95 über ${e.fields} Fields`),
      bewerte('asset-kalt', assetKalt.p95, 'desktop', `p95 über ${assetKalt.n} Modellketten, erster Durchlauf`),
      bewerte('asset-warm', assetWarm.p95, 'desktop', `p95 über ${assetWarm.n} Modellketten, zweiter Durchlauf`),
      bewerte('main-thread-task', e.hauptthreadEtappeMaxMs, 'desktop', 'größte Sitzungs-/Tick-Etappe (Node)'),
      bewerte('long-tasks', e.longTasks, 'desktop', 'Lag-Probe über den gesamten Lauf'),
      bewerte('vram-schaetzung', e.vramHoechststandMB, 'desktop', 'Atlas-Buchführung, 2048er Atlanten'),
      bewerte('heap-steady', e.heapEndeMB, 'desktop', 'Heap nach dem Lauf, GC erzwungen'),
    ];
    const bilanz = bilanziere(befunde);

    console.log(
      'NFR Desktop (Realdaten):',
      JSON.stringify(
        {
          umfang: { archive: e.archive, eintraege: e.eintraege, fields: e.fields, bundleFehler: e.bundleFehler },
          ttff: { kaltMs: runde(e.ttffKaltMs, 1), warmMs: runde(e.ttffWarmMs, 1) },
          scan: { kaltMs: runde(e.scanKaltMs, 1), warmMs: runde(e.scanWarmMs, 1) },
          wechsel: rundeP(e.etappen.wechselGesamt),
          etappen: {
            io: rundeP(e.etappen.io),
            lzs: rundeP(e.etappen.lzs),
            parse: rundeP(e.etappen.parse),
            sitzung: rundeP(e.etappen.sitzung),
            ticks: rundeP(e.etappen.ticks),
            atlas: rundeP(e.etappen.atlas),
          },
          assetLatenz: { kalt: rundeP(assetKalt), warm: rundeP(assetWarm) },
          hauptthreadEtappeMaxMs: runde(e.hauptthreadEtappeMaxMs),
          workerEtappeMaxMs: runde(e.workerEtappeMaxMs),
          longTasks: { anzahl: e.longTasks, maxMs: runde(e.longTaskMaxMs, 1) },
          atlasSeiten: rundeP(e.atlasSeiten),
          vram: { hoechststandMB: runde(e.vramHoechststandMB), endeBytes: e.vram.bytes, fehlfreigaben: e.vram.fehlfreigaben },
          heap: {
            baselineMB: runde(e.heapBaselineMB, 1),
            endeMB: runde(e.heapEndeMB, 1),
            abweichungProzent: runde(e.heapAbweichungProzent, 1),
            gcErzwungen: e.gcErzwungen,
          },
          bilanz: {
            erfuellt: bilanz.erfuellt,
            grenzwertig: bilanz.grenzwertig,
            verfehlt: bilanz.verfehlt,
            ungemessen: bilanz.ungemessen,
          },
          urteile: befunde.map((b) => ({
            id: b.id,
            soll: b.sollwert,
            ist: b.messwert === null ? null : runde(b.messwert),
            abweichungProzent: b.abweichungProzent === null ? null : runde(b.abweichungProzent, 1),
            urteil: b.urteil,
          })),
        },
        null,
        1,
      ),
    );

    // --- ADR-010-Lastprofil ---------------------------------------------------
    // Die Frage ist nicht „ist LZS schnell?", sondern „wie viel Budget bliebe
    // liegen, wenn LZS und Texturkonvertierung magisch 0 ms kosteten?".
    const wechselSumme = e.etappen.wechselGesamt.summeMs;
    const wasmKandidatMs = e.etappen.lzs.summeMs + e.etappen.atlas.summeMs;
    const restBudgetOhneWasmMs = e.etappen.wechselGesamt.p95;
    const hypothetischP95 =
      restBudgetOhneWasmMs - (wasmKandidatMs / Math.max(1, e.fields)) * 0.6; // 60 % Ersparnis, optimistisch
    console.log(
      'ADR-010-Lastprofil:',
      JSON.stringify(
        {
          wechselSummeMs: runde(wechselSumme, 1),
          lzsSummeMs: runde(e.etappen.lzs.summeMs, 1),
          atlasSummeMs: runde(e.etappen.atlas.summeMs, 1),
          parseSummeMs: runde(e.etappen.parse.summeMs, 1),
          wasmKandidatAnteilProzent: runde(e.wasmKandidatAnteilProzent, 1),
          budgetMs: 500,
          istP95Ms: runde(restBudgetOhneWasmMs),
          budgetAuslastungProzent: runde((restBudgetOhneWasmMs / 500) * 100, 1),
          hypothetischP95MitWasmMs: runde(Math.max(0, hypothetischP95)),
          annahmeErsparnisProzent: 60,
        },
        null,
        1,
      ),
    );

    // --- R9-Expositionsanalyse -------------------------------------------------
    const { exposition } = messeMathExposition(() => berechneReplayVektoren());
    const { exposition: kontrolle } = messeMathExposition(() => kontrollLauf());
    console.log(
      'R9-Mathexposition:',
      JSON.stringify(
        {
          vektoren: {
            unsicher: exposition.unsicher,
            summeUnsicher: exposition.summeUnsicher,
            summeSicher: exposition.summeSicher,
            anteilUnsicherProzent: runde(exposition.anteilUnsicherProzent, 2),
          },
          kontrolle: { summeUnsicher: kontrolle.summeUnsicher, summeSicher: kontrolle.summeSicher },
          digests: vergleicheGegenErwartung(berechneReplayVektoren()),
        },
        null,
        1,
      ),
    );

    // --- Zusicherungen ---------------------------------------------------------
    expect(e.fields).toBeGreaterThan(700);
    expect(e.vram.bytes).toBe(0);
    expect(e.vram.fehlfreigaben).toBe(0);
    expect(bilanz.ungemessen).toBe(0);
    // Kernbudget der Session: der warme Field-Wechsel.
    expect(e.etappen.wechselGesamt.p95).toBeLessThan(500);
    // Kontrollhypothese der Expositionsanalyse: der Kontrolllauf MUSS 0 melden,
    // sonst misst die Instrumentierung etwas anderes als behauptet.
    expect(kontrolle.summeUnsicher).toBe(0);
    expect(exposition.summeUnsicher).toBeGreaterThan(0);
    expect(vergleicheGegenErwartung(berechneReplayVektoren()).every((v) => v.gleich)).toBe(true);

    await dir.closeAll();
    await charDir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
