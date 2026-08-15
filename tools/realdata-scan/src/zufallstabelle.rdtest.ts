import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKernelContainer } from '@webmidgar/formats-kernel';
import {
  istPermutation,
  ladeZufallstabelle,
  naechstesByte,
  setzeZufall,
  ZUFALLSTABELLE_LEN,
  ZUFALLSTABELLE_SEKTIONSTYP,
  ZUFALLSTABELLE_SUMME,
  ZUFALLSTABELLE_VERSATZ,
} from '@webmidgar/battle-runtime';
import { REAL_DIR } from './real-pfade.js';

/**
 * Die Zufallstabelle des Kampfs an den Daten des Anwenders.
 *
 * **Warum sie nicht im Repository steht.** Die 256 Bytes sind Originaldaten.
 * Der Bestand druckt sie zwar wörtlich ab, aber sie hier abzulegen hieße,
 * Originaldaten auszuliefern — das tut dieses Projekt nicht. Stattdessen
 * trägt der Code die **Fundstelle** (`KERNEL.BIN`, Sektion mit Typfeld 2,
 * Versatz `0xE1C`) und die **Invarianten**, und diese Probe rechnet sie an
 * der Installation nach.
 *
 * **Wie man byteexakt prüft, ohne die Bytes zu haben.** Über einen
 * Fingerabdruck: Ein FNV-1a-Hash über die 256 Bytes ist keine Kopie der
 * Daten, aber er ändert sich bei jedem einzelnen geänderten Byte. Zusammen
 * mit „ist eine Permutation von 0…255" und „in beiden Locale-Fassungen
 * identisch" ist das eine scharfe Prüfung, die nichts ausliefert.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Versätze und ein Hash — keine
 * Tabellenbytes.
 */

const KERNEL_A = join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN');
const KERNEL_B = join(REAL_DIR, 'data', 'lang-en', 'kernel', 'KERNEL.BIN');
const available = existsSync(KERNEL_A);

/** FNV-1a über Bytes — Fingerabdruck, keine Kopie. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

async function holeTabelle(
  pfad: string,
): Promise<{ tabelle: Uint8Array | null; sektion: Uint8Array | null; sektionen: number[] }> {
  const container = await parseKernelContainer(await readFile(pfad), 'KERNEL.BIN');
  if (!container) return { tabelle: null, sektion: null, sektionen: [] };
  const passende = container.sections.filter((s) => s.typeRaw === ZUFALLSTABELLE_SEKTIONSTYP && s.ok);
  const indizes = passende.map((x) => x.index);
  for (const s of passende) {
    const t = ladeZufallstabelle(s.data);
    if (t) return { tabelle: t, sektion: s.data, sektionen: indizes };
  }
  return { tabelle: null, sektion: null, sektionen: indizes };
}

describe.skipIf(!available)('Zufallstabelle des Kampfs', () => {
  it('findet sie an der belegten Fundstelle und prüft die Invarianten', async () => {
    const { tabelle, sektionen } = await holeTabelle(KERNEL_A);
    console.log(`[RNG] Sektionen mit Typfeld ${ZUFALLSTABELLE_SEKTIONSTYP}: [${sektionen.join(', ')}]`);
    expect(tabelle).not.toBeNull();
    if (!tabelle) return;

    const summe = [...tabelle].reduce((a, b) => a + b, 0);
    const hash = fnv1a(tabelle);
    console.log(
      `[RNG] Versatz 0x${ZUFALLSTABELLE_VERSATZ.toString(16).toUpperCase()} · ${tabelle.length} B · ` +
        `Summe ${summe} · Permutation ${istPermutation(tabelle)} · FNV ${hash.toString(16).padStart(8, '0')}`,
    );

    /**
     * 🟢 **Die Invarianten.** Eine Permutation von 0…255 ist keine schwache
     * Aussage: Von den 256^256 möglichen Bytefolgen erfüllen sie nur 256!,
     * und die Bytesumme allein würde schon fast jede zufällige Folge
     * aussortieren.
     */
    expect(tabelle.length).toBe(ZUFALLSTABELLE_LEN);
    expect(summe).toBe(ZUFALLSTABELLE_SUMME);
    expect(istPermutation(tabelle)).toBe(true);

    /**
     * 🟢 **Der Fingerabdruck — und er ist hier mehr als eine Regressionswache.**
     *
     * Der Bestand druckt die 256 Bytes wörtlich ab. Sie stehen aus gutem
     * Grund nicht in diesem Repository, aber ihr FNV-1a lässt sich außerhalb
     * ausrechnen und **vergleichen**: Über die abgedruckte Tabelle ergibt er
     * `0x5D181049` — genau den Wert, den unsere Extraktion aus der
     * Installation des Anwenders liefert.
     *
     * Damit ist belegt, dass wir **dieselben 256 Bytes** haben, ohne sie
     * auszuliefern. Die Fundstelle (Sektion mit Typfeld 2, Versatz `0xE1C`)
     * sitzt also richtig, und der Generator läuft auf der echten Tabelle.
     *
     * Schlägt diese Erwartung an, ist entweder die Installation eine andere
     * oder die Fundstelle hat sich verschoben.
     */
    expect(hash).toBe(0x5d181049);
  }, 300_000);

  it('ist in beiden Locale-Fassungen byteidentisch', async () => {
    if (!existsSync(KERNEL_B)) {
      console.log('[RNG] keine lang-en-Fassung vorhanden — Vergleich übersprungen');
      return;
    }
    const a = await holeTabelle(KERNEL_A);
    const b = await holeTabelle(KERNEL_B);
    expect(a.tabelle).not.toBeNull();
    expect(b.tabelle).not.toBeNull();
    if (!a.tabelle || !b.tabelle) return;

    const gleich = a.tabelle.every((v, i) => v === b.tabelle![i]);
    // Das Umfeld: die ganze Sektion 2, ohne die 256 Tabellenbytes.
    const umfeldGleich =
      a.sektion !== null &&
      b.sektion !== null &&
      a.sektion.length === b.sektion.length &&
      a.sektion.every(
        (v, i) =>
          (i >= ZUFALLSTABELLE_VERSATZ && i < ZUFALLSTABELLE_VERSATZ + ZUFALLSTABELLE_LEN) ||
          v === b.sektion![i],
      );
    console.log(
      `[RNG] data/ gegen lang-en/: Tabelle identisch ${gleich} · Umfeld identisch ${umfeldGleich} · ` +
        `Sektionslänge ${a.sektion?.length} / ${b.sektion?.length}`,
    );

    /**
     * 🟢 Der Bestand sagt: Die 256 Bytes sind in beiden Fassungen gleich,
     * **obwohl der Rest der Sektion sich unterscheidet**. Beides wird geprüft
     * — die Gleichheit der Tabelle UND die Ungleichheit ihres Umfelds. Ohne
     * die zweite Hälfte wäre die erste trivial: Wären die Dateien insgesamt
     * gleich, bewiese die gleiche Tabelle nichts.
     */
    expect(gleich).toBe(true);
    expect(umfeldGleich).toBe(false);
  }, 300_000);

  it('liefert einen Strom, der die Tabelle der Reihe nach abläuft', async () => {
    const { tabelle } = await holeTabelle(KERNEL_A);
    expect(tabelle).not.toBeNull();
    if (!tabelle) return;

    /**
     * 🟢 Die Buchführungsprobe an echten Daten: Mit Startwert 0 stehen alle
     * acht Leseköpfe auf 0, und die ersten fünf Ziehungen müssen **genau**
     * die ersten fünf Tabellenwerte sein. Das prüft den Generator gegen die
     * geladene Tabelle, ohne einen einzigen Wert zu nennen.
     */
    const z = setzeZufall(tabelle, 0);
    const gezogen = [0, 1, 2, 3, 4].map(() => naechstesByte(z));
    expect(gezogen).toEqual([...tabelle.subarray(0, 5)]);
    expect(z.cursor[0]).toBe(5);
    expect(z.cursor[1]).toBe(0);
  }, 300_000);
});
