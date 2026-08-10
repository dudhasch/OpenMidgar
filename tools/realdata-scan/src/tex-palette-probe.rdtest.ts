import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseTex } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * Fehlende Augen — Verdacht: Wir rendern immer nur Palette 0.
 *
 * **Beobachtung (Sichtprüfung 2026-08-10).** „Bei den Charakteren fehlen
 * jeweils die Augen." In den gerenderten Gesichtern ist die Augenpartie
 * dunkel, während Brauen und Mund korrekt erscheinen.
 *
 * **Der Verdacht.** `TextureSource` konserviert **alle** Paletten einer
 * `.tex` — der NAM-Kommentar sagt das ausdrücklich. Aber `texToRgba` nimmt
 * standardmäßig `paletteIndex = 0`, und jeder Renderpfad ruft es ohne
 * Argument. Trägt eine Gesichtstextur mehrere Paletten (in FF7 üblich, um
 * Blinzeln und Blickrichtung ohne Geometrieänderung zu schalten), dann sehen
 * wir dauerhaft genau eine davon — und wenn in dieser die Augenfarben
 * schwarz sind, fehlen die Augen.
 *
 * **Was diese Probe misst, und was nicht.** Sie kann NICHT zeigen, dass die
 * Augen in einer anderen Palette sichtbar sind — das ist eine Bildfrage und
 * gehört ins Sichtprüfungs-Formular. Sie kann aber die Vorbedingung prüfen:
 *
 *  1. Wie viele `.tex` tragen überhaupt **mehr als eine** Palette?
 *  2. Unterscheiden sich diese Paletten inhaltlich, oder sind sie Kopien?
 *  3. Gibt es Farbindizes, die in Palette 0 **schwarz** sind und in einer
 *     anderen Palette **nicht** — also genau die Signatur „unsichtbar in 0"?
 *
 * Fällt (1) oder (3) durch, ist der Verdacht widerlegt und die Ursache liegt
 * woanders (fehlende Submesh, nicht aufgelöste zweite Textur, Alpha-Regel).
 *
 * **Kontrolle gegen Selbsttäuschung.** Punkt 3 wird gegen eine bewusst
 * falsche Erwartung gemessen: Wären Paletten bloß Helligkeitsvarianten,
 * müssten *viele* Indizes zwischen den Paletten wechseln. Betrifft es dagegen
 * nur eine Handvoll Indizes, passt das zu einer gezielten Augen-/
 * Ausdrucksschaltung.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler und Quoten.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Ist die Farbe (RGB) praktisch schwarz? */
function istSchwarz(p: Uint8Array, i: number): boolean {
  return p[i]! < 16 && p[i + 1]! < 16 && p[i + 2]! < 16;
}

describe.skipIf(!available)('Realdaten: Paletten je .tex (fehlende Augen)', () => {
  it('prüft, ob Mehrfachpaletten existieren und sich gezielt unterscheiden', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const palettenAnzahl = new Map<number, number>();
    let dateien = 0;
    let mehrLautKopf = 0;
    let teilbar = 0;
    const kopf = new Map<string, number>();
    let mehrfach = 0;
    let mitUnterschied = 0;
    // Signatur „unsichtbar in Palette 0": Index ist in 0 schwarz, anderswo nicht.
    let mitDunkelIn0 = 0;
    const wechselndeIndizes: number[] = [];
    const dunkelIndizes: number[] = [];

    for (const entry of index.listEntries('char')) {
      if (!entry.name.toLowerCase().endsWith('.tex')) continue;
      let tex;
      try {
        tex = parseTex(await index.readEntry(entry.canonicalId), entry.name).value;
      } catch {
        continue;
      }
      if (!tex) continue;
      dateien++;
      // Kopffelder ROH mitlesen: Wenn der Parser die Palettenaufteilung nicht
      // erkennt (weil numPalettes * colorsPerPalette != paletteSize), fasst er
      // alles zu EINER Palette zusammen — dann wäre "eine Palette" ein
      // Artefakt unserer Auslegung und nicht die Wahrheit der Datei.
      const rohBytes = await index.readEntry(entry.canonicalId);
      const rv = new DataView(rohBytes.buffer, rohBytes.byteOffset, rohBytes.byteLength);
      const nP = rv.getUint32(0x30, true);
      const cPP = rv.getUint32(0x34, true);
      const pSize = rv.getUint32(0x58, true);
      kopf.set(`nP=${nP} cPP=${cPP} pSize=${pSize}`, (kopf.get(`nP=${nP} cPP=${cPP} pSize=${pSize}`) ?? 0) + 1);
      if (nP > 1) mehrLautKopf++;
      if (nP > 0 && cPP > 0 && nP * cPP === pSize) teilbar++;
      const n = tex.palettes.length;
      palettenAnzahl.set(n, (palettenAnzahl.get(n) ?? 0) + 1);
      if (n < 2) continue;
      mehrfach++;

      const p0 = tex.palettes[0]!;
      const farben = p0.length / 4;
      let wechsel = 0;
      let dunkel = 0;
      for (let c = 0; c < farben; c++) {
        const i = c * 4;
        let andersWo = false;
        let hellWoanders = false;
        for (let q = 1; q < n; q++) {
          const pq = tex.palettes[q]!;
          if (pq.length !== p0.length) continue;
          if (pq[i] !== p0[i] || pq[i + 1] !== p0[i + 1] || pq[i + 2] !== p0[i + 2]) andersWo = true;
          if (istSchwarz(p0, i) && !istSchwarz(pq, i)) hellWoanders = true;
        }
        if (andersWo) wechsel++;
        if (hellWoanders) dunkel++;
      }
      if (wechsel > 0) mitUnterschied++;
      if (dunkel > 0) mitDunkelIn0++;
      wechselndeIndizes.push(wechsel);
      dunkelIndizes.push(dunkel);
    }
    await dir.closeAll();

    const median = (v: number[]): number => {
      if (v.length === 0) return 0;
      const s = [...v].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };

    console.log(
      'Paletten je .tex:',
      JSON.stringify(
        {
          'Texturen gesamt': dateien,
          'laut Kopf mehr als eine Palette': `${mehrLautKopf}/${dateien}`,
          'Kopf teilbar (nP*cPP == pSize)': `${teilbar}/${dateien}`,
          'häufigste Kopfkombinationen': [...kopf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
          'Palettenzahl (Anzahl → Dateien)': [...palettenAnzahl.entries()].sort((a, b) => a[0] - b[0]),
          'mit mehr als einer Palette': `${mehrfach}/${dateien}`,
          'davon inhaltlich verschieden': `${mitUnterschied}/${mehrfach}`,
          'davon mit Signatur „in Palette 0 schwarz, anderswo nicht"': `${mitDunkelIn0}/${mehrfach}`,
          'wechselnde Farbindizes je Textur (Median)': median(wechselndeIndizes),
          'davon in 0 schwarze (Median)': median(dunkelIndizes),
        },
        null,
        1,
      ),
    );

    // BEFUND: Der Verdacht ist widerlegt. Der Kopf selbst meldet
    // numPalettes = 1 in allen Dateien, und nP*cPP == pSize geht überall auf —
    // unser Parser liest also richtig, es GIBT nur eine Palette. Die fehlenden
    // Augen haben eine andere Ursache.
    expect(dateien).toBeGreaterThan(100);
    expect(mehrLautKopf).toBe(0);
    expect(teilbar).toBe(dateien);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
