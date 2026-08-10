import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  baueFakeInstallation,
  bewerte,
  bilanziere,
  fuehreKampagneAus,
  fuehreSoakAus,
  jetzt,
  type FakeInstallation,
} from './index.js';

/**
 * NFR-Messkampagne und Soak-Test gegen die **synthetische** Fake-Installation.
 *
 * Was dieser Lauf beweist: die Messkette selbst funktioniert, der
 * Speicherlebenszyklus über viele Wechsel ist leckfrei, und die
 * Budgetbewertung urteilt auf echten Zahlen. Was er **nicht** beweist: dass
 * die NFRs auf Originaldaten eingehalten werden — die Fake-Installation ist
 * strukturgleich, aber viel kleiner. Dafür gibt es den Realdatenlauf
 * (`tools/realdata-scan/src/nfr-desktop.rdtest.ts`).
 *
 * Deshalb sind die Zusicherungen hier bewusst zweigeteilt:
 *  - **hart** geprüft wird, was strukturell gelten MUSS (Buchführung kehrt
 *    exakt auf 0 zurück, Determinismus über 500 Wechsel, keine Fehler),
 *  - die Latenzbudgets werden bewertet und protokolliert, aber mit großzügiger
 *    Grenze geprüft, weil eine CI-Maschine unter Last sonst rot würde, ohne
 *    dass sich am Produkt etwas geändert hätte.
 */

let cache: FakeInstallation | null = null;
function installation(): FakeInstallation {
  cache ??= baueFakeInstallation({ fields: 8, kacheln: 256, gitter: 5 });
  return cache;
}

describe('NFR-Kampagne gegen die synthetische Fake-Installation', () => {
  it('misst alle Etappen und bewertet sie gegen die Sollwerte', { timeout: 180_000 }, async () => {
    const install = installation();
    const t0 = jetzt();
    const e = await fuehreKampagneAus({
      quelle: install.quelle,
      archiv: 'flevel',
      atlasGroesse: 256,
      ticksJeSitzung: 60,
    });
    const laufzeitMs = jetzt() - t0;

    const befunde = [
      bewerte('ttff-cold', e.ttffKaltMs, 'desktop', `Fake-Installation, ${e.fields} Fields, Erstimport`),
      bewerte('ttff-warm', e.ttffWarmMs, 'desktop', 'Fake-Installation, S0-Treffer'),
      bewerte('field-wechsel-warm', e.etappen.wechselGesamt.p95, 'desktop', `p95 über ${e.fields} Wechsel`),
      bewerte('main-thread-task', e.hauptthreadEtappeMaxMs, 'desktop', 'größte Sitzungs-/Tick-Etappe'),
      bewerte('long-tasks', e.longTasks, 'desktop', 'Lag-Probe über den gesamten Lauf'),
      bewerte('vram-schaetzung', e.vramHoechststandMB, 'desktop', 'Höchststand der Atlas-Buchführung'),
    ];
    const bilanz = bilanziere(befunde);

    console.log(
      'NFR (Fixture):',
      JSON.stringify(
        {
          fields: e.fields,
          archivBytes: install.archivBytes,
          ttffKaltMs: +e.ttffKaltMs.toFixed(1),
          ttffWarmMs: +e.ttffWarmMs.toFixed(1),
          scanKaltMs: +e.scanKaltMs.toFixed(1),
          scanWarmMs: +e.scanWarmMs.toFixed(1),
          wechsel: rundePerzentile(e.etappen.wechselGesamt),
          etappen: {
            io: rundePerzentile(e.etappen.io),
            lzs: rundePerzentile(e.etappen.lzs),
            parse: rundePerzentile(e.etappen.parse),
            sitzung: rundePerzentile(e.etappen.sitzung),
            ticks: rundePerzentile(e.etappen.ticks),
            atlas: rundePerzentile(e.etappen.atlas),
          },
          hauptthreadEtappeMaxMs: +e.hauptthreadEtappeMaxMs.toFixed(2),
          workerEtappeMaxMs: +e.workerEtappeMaxMs.toFixed(2),
          wasmKandidatAnteilProzent: +e.wasmKandidatAnteilProzent.toFixed(1),
          longTasks: e.longTasks,
          longTaskMaxMs: +e.longTaskMaxMs.toFixed(1),
          vramHoechststandMB: +e.vramHoechststandMB.toFixed(2),
          vramEndeBytes: e.vram.bytes,
          heap: {
            baselineMB: +e.heapBaselineMB.toFixed(1),
            endeMB: +e.heapEndeMB.toFixed(1),
            abweichungProzent: +e.heapAbweichungProzent.toFixed(1),
            gcErzwungen: e.gcErzwungen,
          },
          bilanz: {
            erfuellt: bilanz.erfuellt,
            grenzwertig: bilanz.grenzwertig,
            verfehlt: bilanz.verfehlt,
            ungemessen: bilanz.ungemessen,
          },
          laufzeitMs: Math.round(laufzeitMs),
        },
        null,
        1,
      ),
    );

    // Strukturelle Zusicherungen — hier ist keine Toleranz nötig.
    expect(e.fields).toBe(8);
    expect(e.bundleFehler).toBe(0);
    expect(e.vram.bytes).toBe(0); // Buchführung exakt auf Baseline
    expect(e.vram.fehlfreigaben).toBe(0);
    expect(e.vram.hoechststandBytes).toBeGreaterThan(0);
    expect(bilanz.ungemessen).toBe(0);

    // Latenzbudgets: großzügig geprüft (Maschinenlast), exakt protokolliert.
    expect(e.ttffKaltMs).toBeLessThan(10_000);
    expect(e.etappen.wechselGesamt.p95).toBeLessThan(500);
  });
});

describe('Soak-Test: 500 Field-Wechsel', () => {
  it('kehrt mit Heap und GPU-Buchführung auf die Baseline zurück', { timeout: 600_000 }, async () => {
    const install = installation();
    const s = await fuehreSoakAus({
      quelle: install.quelle,
      archiv: 'flevel',
      wechsel: 500,
      atlasGroesse: 256,
      ticksJeWechsel: 20,
      fieldsInRotation: 8,
      abtastungAlle: 100,
    });

    console.log(
      'Soak (Fixture):',
      JSON.stringify(
        {
          wechsel: s.wechsel,
          rotation: s.fieldsInRotation,
          wechselMs: rundePerzentile(s.wechselMs),
          vram: {
            baselineBytes: s.vramBaselineBytes,
            endeBytes: s.vramEndeBytes,
            erwerbe: s.vram.erwerbe,
            freigaben: s.vram.freigaben,
            fehlfreigaben: s.vram.fehlfreigaben,
            hoechststandMB: +(s.vram.hoechststandBytes / (1024 * 1024)).toFixed(2),
          },
          heap: {
            kaltBaselineMB: +s.heapKaltBaselineMB.toFixed(1),
            steadyBaselineMB: +s.heapBaselineMB.toFixed(1),
            endeMB: +s.heapEndeMB.toFixed(1),
            abweichungSteadyProzent: +s.heapAbweichungProzent.toFixed(2),
            abweichungKaltProzent: +s.heapAbweichungKaltProzent.toFixed(2),
            gcErzwungen: s.gcErzwungen,
          },
          verlauf: s.verlauf.map((v) => ({
            wechsel: v.wechsel,
            heapMB: +v.heapMB.toFixed(1),
            vramBytes: v.vramBytes,
          })),
          digestStabil: s.digestStabil,
          fehler: s.fehler,
        },
        null,
        1,
      ),
    );

    expect(s.fehler).toBe(0);
    // GPU-/VRAM-Buchführung: exakte Rückkehr, nicht ± 5 %.
    expect(s.vramEndeBytes).toBe(s.vramBaselineBytes);
    expect(s.vram.fehlfreigaben).toBe(0);
    // Über 500 Wechsel darf die Registry nie mehr als eine Generation halten.
    for (const v of s.verlauf) expect(v.vramEintraege).toBeLessThanOrEqual(1);
    // Determinismus: derselbe Zyklus liefert nach 500 Wechseln denselben Digest.
    expect(s.digestStabil).toBe(true);
    // Heap-Rückkehr auf Baseline ± 5 % — nur aussagekräftig mit erzwungenem
    // GC. Ohne `--expose-gc` wäre die Zahl Rauschen und die Prüfung eine
    // Scheinsicherheit; dann wird sie ehrlich übersprungen.
    if (s.gcErzwungen) expect(Math.abs(s.heapAbweichungProzent)).toBeLessThanOrEqual(5);
    else console.warn('Heap-Baselineprüfung übersprungen: kein --expose-gc verfügbar');
  });
});

function rundePerzentile(p: { n: number; p50: number; p95: number; max: number }): Record<string, number> {
  return { n: p.n, p50: +p.p50.toFixed(2), p95: +p.p95.toFixed(2), max: +p.max.toFixed(2) };
}
