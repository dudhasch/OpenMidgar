import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  CAMDAT_CHANNELS,
  CAMDAT_PSX_BASE,
  altEyeBodyOffset,
  altFocusBodyOffset,
  bodyBytes,
  camdatFileForLayout,
  eyeBodyOffset,
  focusBodyOffset,
  parseCamDat,
} from '@webmidgar/formats-battle';
import { realPfad } from './real-pfade.js';

/**
 * K11 — der `camdat`-Container.
 *
 * **Der Anlass** ist K8: Keine der drei Kameras aus dem 48-B-Block der Szene
 * zeigt die Ansicht der Originalaufnahme, bei keinem Öffnungswinkel. Die Frage
 * lautet seither „welche Kamera", und `camdat` ist die Antwortquelle.
 *
 * **Die Gütefunktion sind fünf Invarianten**, nicht eine Plausibilität:
 * Takezahl geht auf, Alternativkörper schließen an, `altFocusDir + 12` ist
 * byteexakt das Dateiende, jeder Verzeichniszeiger landet in seinem Bereich,
 * jeder Körper endet auf `0xFF`.
 *
 * **Das Kontrollniveau ist die Zeigerbasis.** Die Behauptung „alle Zeiger sind
 * PSX-Absolutadressen gegen `0x801A0000`" ist genau dann etwas wert, wenn eine
 * *falsche* Basis durchfällt. Geprüft werden fünf Verschiebungen — darunter
 * eine um nur **4 Byte** — und die Lesart „Zeiger sind schlichte
 * Dateiversätze".
 *
 * Urheberrecht: Ausgegeben werden Versätze, Zähler und Größen. Kein Skriptbyte
 * wird protokolliert.
 */

const DATEIEN = ['camdat0.bin', 'camdat1.bin', 'camdat2.bin'] as const;
const available = DATEIEN.every((d) => existsSync(realPfad(`battle/${d}`)));

/** Messbild 2026-08-15 — Dauerbefund, nicht Zierde. */
const ERWARTET: Record<string, { laenge: number; eye: number; focus: number; alt: number; takes: number; koerper: number }> = {
  'camdat0.bin': { laenge: 49044, eye: 0x99fc, focus: 0xac74, alt: 0xbf7c, takes: 394, koerper: 1020 },
  'camdat1.bin': { laenge: 42552, eye: 0x8278, focus: 0x940c, alt: 0xa620, takes: 375, koerper: 860 },
  'camdat2.bin': { laenge: 42760, eye: 0x837c, focus: 0x9504, alt: 0xa6f0, takes: 374, koerper: 866 },
};

async function lade(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(realPfad(`battle/${name}`)));
}

/** Bytes mit einer verschobenen Zeigerbasis im Kopf — für die Kontrolle. */
function mitBasis(bytes: Uint8Array, delta: number): Uint8Array {
  const kopie = bytes.slice(0);
  const view = new DataView(kopie.buffer, kopie.byteOffset, kopie.byteLength);
  for (let i = 0; i < 4; i++) {
    // Der Parser rechnet `zeiger − CAMDAT_PSX_BASE`. Ein um `delta` erhöhter
    // Zeiger im Kopf wirkt exakt wie eine um `delta` verschobene Basis.
    view.setUint32(i * 4, (view.getUint32(i * 4, true) + delta) >>> 0, true);
  }
  return kopie;
}

describe.skipIf(!available)('K11 — camdat-Container', () => {
  it('alle drei Dateien bestehen die fünf Invarianten, mit den erwarteten Versätzen', async () => {
    for (const name of DATEIEN) {
      const bytes = await lade(name);
      const a = parseCamDat(bytes, name);
      expect(a, `${name}: Container nicht lesbar`).not.toBeNull();
      const e = ERWARTET[name]!;

      expect(bytes.length).toBe(e.laenge);
      expect(a!.eyeDir).toBe(e.eye);
      expect(a!.focusDir).toBe(e.focus);
      expect(a!.altEyeDir).toBe(e.alt);
      expect(a!.takeCount).toBe(e.takes);
      expect(a!.diagnostics).toEqual([]);

      // Körper sind GETEILT: viele Verzeichnisplätze, wenige eigene Körper.
      const eigene = new Set<number>();
      for (let t = 0; t < a!.takeCount; t++) {
        for (let c = 0; c < CAMDAT_CHANNELS; c++) {
          eigene.add(eyeBodyOffset(a!, t, c)!);
          eigene.add(focusBodyOffset(a!, t, c)!);
        }
      }
      const plaetze = a!.takeCount * CAMDAT_CHANNELS * 2;
      console.log(
        `[K11] ${name}: eye 0x${a!.eyeDir.toString(16)} focus 0x${a!.focusDir.toString(16)} ` +
          `alt 0x${a!.altEyeDir.toString(16)}/0x${a!.altFocusDir.toString(16)} ` +
          `takes ${a!.takeCount} — ${plaetze} Verzeichnisplätze auf ${eigene.size} eigene Körper`,
      );
      expect(eigene.size).toBe(e.koerper);
      expect(eigene.size).toBeLessThan(plaetze); // geteilt, nicht 1:1
    }
  });

  it('KONTROLLE: jede verschobene Zeigerbasis fällt durch — auch die um 4 Byte', async () => {
    const verschiebungen = [-0x10000, -4, 4, 0x10000, 0x100000];
    let bestanden = 0;
    let geprueft = 0;
    for (const name of DATEIEN) {
      const bytes = await lade(name);
      for (const d of verschiebungen) {
        geprueft++;
        if (parseCamDat(mitBasis(bytes, d), `${name}@${d}`) !== null) bestanden++;
      }
      // Und die Lesart „Zeiger sind schlichte Dateiversätze".
      geprueft++;
      if (parseCamDat(mitBasis(bytes, CAMDAT_PSX_BASE), `${name}@ohneBasis`) !== null) bestanden++;
    }
    console.log(`[K11] Kontrolle: ${bestanden} von ${geprueft} falschen Basen bestehen die Invarianten`);
    expect(geprueft).toBe(18);
    /**
     * DAUERBEFUND: **0 von 18**. Bestünde auch nur eine, wäre die
     * Invariantenmenge zu schwach und der Befund oben wertlos — genau der
     * Fehler, den dieses Projekt als „blinde Gütefunktion" führt.
     */
    expect(bestanden).toBe(0);
  });

  it('Körper haben belegte Grenzen: Anfang aus dem Verzeichnis, Ende auf 0xFF', async () => {
    const a = parseCamDat(await lade('camdat0.bin'), 'camdat0.bin')!;
    let laengen = 0;
    let kuerzester = Infinity;
    let laengster = 0;
    const gesehen = new Set<number>();
    for (let t = 0; t < a.takeCount; t++) {
      for (let c = 0; c < CAMDAT_CHANNELS; c++) {
        for (const off of [eyeBodyOffset(a, t, c)!, focusBodyOffset(a, t, c)!]) {
          if (gesehen.has(off)) continue;
          gesehen.add(off);
          const b = bodyBytes(a, off);
          expect(b, `Körper bei ${off} ohne Abschluss`).not.toBeNull();
          expect(b![b!.length - 1]).toBe(0xff);
          laengen += b!.length;
          kuerzester = Math.min(kuerzester, b!.length);
          laengster = Math.max(laengster, b!.length);
        }
      }
    }
    console.log(`[K11] camdat0: ${gesehen.size} Körper, ${laengen} B gesamt, kürzester ${kuerzester}, längster ${laengster}`);
    /**
     * Gemessen: **kürzester Körper 2 B, längster 265 B, 28.162 B über 1020
     * Körper.** Ein Körper aus einem einzigen `0xFF` — also ein Skript, das
     * sofort endet — kommt im Bestand **nicht** vor, obwohl das Format ihn
     * zuließe: Der Selektor `−1` liefert genau so einen Körper, aber der
     * stammt aus der EXE und nicht aus der Datei. Jedes Skript *im Archiv*
     * trägt mindestens einen Opcode.
     *
     * Das steht hier als gemessene Zahl und nicht als Vermutung, weil beim
     * ersten Anlauf `1` erwartet wurde — geraten aus der Formatbeschreibung,
     * nicht aus den Daten.
     */
    expect(kuerzester).toBe(2);
    expect(laengster).toBe(265);
    expect(laengen).toBe(28162);

    // Auch die sechs Alternativskripte sind erreichbar und abgeschlossen.
    for (let c = 0; c < CAMDAT_CHANNELS; c++) {
      for (const off of [altEyeBodyOffset(a, c)!, altFocusBodyOffset(a, c)!]) {
        const b = bodyBytes(a, off);
        expect(b).not.toBeNull();
        expect(b![b!.length - 1]).toBe(0xff);
      }
    }
  });

  it('Schranken: ungültiger Take oder Kanal liefert null statt Müll', async () => {
    const a = parseCamDat(await lade('camdat1.bin'), 'camdat1.bin')!;
    // Das Original prüft hier NICHT und dereferenziert notfalls, was hinter
    // dem Verzeichnis steht. Wir tun das nicht — ein erfundenes Skript wäre
    // schlimmer als ein fehlendes.
    expect(eyeBodyOffset(a, a.takeCount, 0)).toBeNull();
    expect(eyeBodyOffset(a, -1, 0)).toBeNull();
    expect(focusBodyOffset(a, 0, CAMDAT_CHANNELS)).toBeNull();
    expect(altEyeBodyOffset(a, 3)).toBeNull();
  });

  it('🟡 Layout-Zuordnung: die drei Dateien werden vollständig adressiert', () => {
    // Nicht an unseren Daten prüfbar — welche Datei das Original öffnet, steht
    // nirgends in den Daten. Prüfbar ist nur die Vollständigkeit der Tabelle.
    const zuordnung = Array.from({ length: 9 }, (_, i) => camdatFileForLayout(i));
    expect(zuordnung.every((x) => x !== null)).toBe(true);
    expect(new Set(zuordnung).size).toBe(3);
    expect(camdatFileForLayout(9)).toBeNull();
    expect(camdatFileForLayout(-1)).toBeNull();
    console.log('[K11] Layout→Datei (🟡):', zuordnung.join(', '));
  });
});
