import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fuehreSoakAus } from '@webmidgar/nfr-run';
import { NodeDirectorySource } from './node-source.js';

/**
 * S20 — Soak-Test über 500 Field-Wechsel auf **echten** Fields
 * (Masterplan-Teststrategie, Zeile „Speicher").
 *
 * Abnahme: Heap und GPU-/VRAM-Buchführung kehren nach 500 Wechseln auf die
 * Baseline zurück (± 5 %), und derselbe Zyklus liefert am Ende denselben
 * Sitzungsdigest wie am Anfang. Der zweite Teil ist der eigentlich
 * gefährliche: ein Zustandsrest, der sich über Wechsel hinweg aufbaut,
 * verbraucht keinen sichtbaren Speicher und fällt nur als Digestabweichung
 * auf.
 *
 * Die Heap-Zusicherung greift nur mit erzwungenem GC (`--expose-gc`, in
 * `vitest.realdata.config.ts` gesetzt). Ohne GC wäre die Zahl Rauschen und
 * wird deshalb nicht geprüft, sondern als solche berichtet.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: Soak 500 Field-Wechsel (S20)', () => {
  it('Heap- und GPU-Buchführung kehren auf die Baseline zurück', { timeout: 1_800_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const s = await fuehreSoakAus({
      quelle: dir,
      archiv: 'flevel',
      wechsel: 500,
      atlasGroesse: 2048,
      ticksJeWechsel: 30,
      fieldsInRotation: 25,
      abtastungAlle: 50,
    });

    console.log(
      'Soak Desktop (Realdaten):',
      JSON.stringify(
        {
          wechsel: s.wechsel,
          rotation: s.fieldsInRotation,
          wechselMs: {
            n: s.wechselMs.n,
            p50: +s.wechselMs.p50.toFixed(2),
            p95: +s.wechselMs.p95.toFixed(2),
            max: +s.wechselMs.max.toFixed(2),
          },
          vram: {
            baselineBytes: s.vramBaselineBytes,
            endeBytes: s.vramEndeBytes,
            hoechststandMB: +(s.vram.hoechststandBytes / (1024 * 1024)).toFixed(1),
            erwerbe: s.vram.erwerbe,
            freigaben: s.vram.freigaben,
            fehlfreigaben: s.vram.fehlfreigaben,
          },
          heap: {
            kaltBaselineMB: +s.heapKaltBaselineMB.toFixed(1),
            steadyBaselineMB: +s.heapBaselineMB.toFixed(1),
            endeMB: +s.heapEndeMB.toFixed(1),
            abweichungSteadyProzent: +s.heapAbweichungProzent.toFixed(2),
            abweichungKaltProzent: +s.heapAbweichungKaltProzent.toFixed(2),
            aufwaermWechsel: s.aufwaermWechsel,
            gcErzwungen: s.gcErzwungen,
          },
          verlauf: s.verlauf.map((v) => ({
            wechsel: v.wechsel,
            heapMB: +v.heapMB.toFixed(1),
            vramMB: +(v.vramBytes / (1024 * 1024)).toFixed(1),
            vramEintraege: v.vramEintraege,
          })),
          digestStabil: s.digestStabil,
          fehler: s.fehler,
        },
        null,
        1,
      ),
    );

    expect(s.fehler).toBe(0);
    expect(s.vramEndeBytes).toBe(s.vramBaselineBytes);
    expect(s.vram.fehlfreigaben).toBe(0);
    // Die Registry darf zu keinem Zeitpunkt mehr als eine Generation halten.
    for (const v of s.verlauf) expect(v.vramEintraege).toBeLessThanOrEqual(1);
    expect(s.digestStabil).toBe(true);
    if (s.gcErzwungen) expect(Math.abs(s.heapAbweichungProzent)).toBeLessThanOrEqual(5);
    else console.warn('Heap-Baselineprüfung übersprungen: kein --expose-gc verfügbar');

    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
