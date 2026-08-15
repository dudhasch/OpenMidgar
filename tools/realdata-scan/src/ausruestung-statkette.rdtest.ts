import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKernelContainer } from '@webmidgar/formats-kernel';
import { abgeleiteteWerte, alsI8, grundwerte } from '@webmidgar/battle-runtime';
import { REAL_DIR } from './real-pfade.js';

/**
 * Die Ausrüstungsfelder der Statuskette an **unseren** Daten.
 *
 * **Warum das die eigentliche Prüfung ist.** Testvektor 11.8 rechnet die
 * Kette von den Grundwerten bis zu den vier Kampfzahlen durch — aber Formel
 * und Vektor stammen aus derselben Quelle. Der Vektor nennt dafür die beiden
 * Ausrüstungsdatensätze **wörtlich**, und die liegen in `KERNEL.BIN`. Also
 * lässt sich prüfen, ob unsere Daten dieselben Bytes an denselben Stellen
 * tragen — und ob die Kette darauf dieselben Zahlen liefert.
 *
 * Dazu eine Zählaussage, die der Bestand über **alle drei** Tabellen macht:
 *
 * > Shipped index values across all three tables: `0, 1, 2, 3, 4, 5, 0xFF` —
 * > nothing else.
 *
 * Das ist scharf: `statBoostIndex` ist ein Byte mit 256 möglichen Werten, und
 * die Behauptung ist, dass im ganzen Bestand nur sieben davon vorkommen.
 * Läge das Feld anderswo, wäre das mit hoher Wahrscheinlichkeit verletzt.
 *
 * Urheberrecht: Ausgegeben werden Feldwerte und Zähler, keine Datensätze.
 */

const KERNEL = join(REAL_DIR, 'data', 'kernel', 'KERNEL.BIN');
const available = existsSync(KERNEL);

/** Sektionsindizes und Recordlängen (Vorlage §9.1a, 0-basiert). */
const SEK_WAFFE = 5;
const SEK_RUESTUNG = 6;
const SEK_ACCESSOIRE = 7;
const WAFFE_LEN = 0x2c;
const RUESTUNG_LEN = 0x24;
const ACCESSOIRE_LEN = 0x10;

/** Feldlagen, die die Statuskette liest. */
const W = { attackPower: 0x04, criticalBonus: 0x07, accuracy: 0x08, boostIdx: 0x14, boostAmt: 0x18 };
const R = { defense: 0x02, magicDefense: 0x03, defensePercent: 0x04, magicDefensePercent: 0x05, boostIdx: 0x18, boostAmt: 0x1c };
const A = { boostIdx: 0x00, boostAmt: 0x02 };

async function sektionen(): Promise<Uint8Array[]> {
  const c = await parseKernelContainer(await readFile(KERNEL), 'KERNEL.BIN');
  return c ? c.sections.map((s) => s.data) : [];
}

function record(sek: Uint8Array, index: number, len: number): Uint8Array {
  return sek.subarray(index * len, (index + 1) * len);
}

describe.skipIf(!available)('Ausrüstungsfelder der Statuskette', () => {
  it('findet Waffe 0 und Rüstung 2 genau so, wie der Testvektor sie nennt', async () => {
    const sek = await sektionen();
    const waffen = sek[SEK_WAFFE];
    const ruestungen = sek[SEK_RUESTUNG];
    expect(waffen).toBeDefined();
    expect(ruestungen).toBeDefined();
    if (!waffen || !ruestungen) return;

    const w0 = record(waffen, 0, WAFFE_LEN);
    const r2 = record(ruestungen, 2, RUESTUNG_LEN);
    const wIdx = [...w0.subarray(W.boostIdx, W.boostIdx + 4)];
    const wAmt = [...w0.subarray(W.boostAmt, W.boostAmt + 4)].map(alsI8);
    const rIdx = [...r2.subarray(R.boostIdx, R.boostIdx + 4)];

    console.log(
      `[EQ] Waffe 0: attackPower ${w0[W.attackPower]} · accuracy ${w0[W.accuracy]} · ` +
        `criticalBonus ${w0[W.criticalBonus]} · boost ${wIdx.join('/')} → ${wAmt.join('/')}`,
    );
    console.log(
      `[EQ] Rüstung 2: defense ${r2[R.defense]} · magicDefense ${r2[R.magicDefense]} · ` +
        `defense% ${r2[R.defensePercent]} · magicDefense% ${r2[R.magicDefensePercent]} · boost ${rIdx.join('/')}`,
    );

    /**
     * 🟢 **Der unabhängige Beleg.** Sechs Feldwerte aus zwei Datensätzen,
     * alle aus einer Quelle, die unsere Dateien nie gesehen hat. Sitzt auch
     * nur ein Versatz falsch, fällt das hier auf.
     */
    expect(w0[W.attackPower]).toBe(18);
    expect(w0[W.accuracy]).toBe(96);
    expect(w0[W.criticalBonus]).toBe(0);
    expect(wIdx).toEqual([0x02, 0xff, 0xff, 0xff]);
    expect(wAmt).toEqual([2, -1, -1, -1]);
    expect(r2[R.defense]).toBe(14);
    expect(r2[R.magicDefense]).toBe(4);
    expect(r2[R.defensePercent]).toBe(2);
    expect(r2[R.magicDefensePercent]).toBe(0);
    expect(rIdx).toEqual([0x00, 0xff, 0xff, 0xff]);

    /**
     * 🟢 Und die Kette darauf: Testvektor 11.8 aus **echten** Bytes statt aus
     * abgeschriebenen Zahlen. Der Waffenbonus Magie +2 muss durchschlagen,
     * und die Magieabwehr der Rüstung (4) darf **nicht** durchschlagen.
     */
    const stat = grundwerte({
      base: [40, 30, 22, 25, 21, 18],
      sourceBonus: [5, 0, 0, 0, 0, 0],
      ausruestung: [
        { index: wIdx, amount: wAmt },
        { index: rIdx, amount: [...r2.subarray(R.boostAmt, R.boostAmt + 4)].map(alsI8) },
      ],
    });
    const abgeleitet = abgeleiteteWerte({
      stat,
      weaponAttackPower: w0[W.attackPower]!,
      armorDefense: r2[R.defense]!,
    });
    expect(stat[2]).toBe(24);
    expect(abgeleitet).toEqual({ attack: 63, defense: 44, magicAttack: 24, magicDefense: 25 });
  }, 300_000);

  it('zählt die Boost-Indizes über alle drei Tabellen', async () => {
    const sek = await sektionen();
    const werte = new Map<number, number>();
    const zaehle = (sekBytes: Uint8Array | undefined, len: number, off: number, n: number): number => {
      if (!sekBytes) return 0;
      const anzahl = Math.floor(sekBytes.length / len);
      for (let i = 0; i < anzahl; i++) {
        const r = record(sekBytes, i, len);
        for (let k = 0; k < n; k++) {
          const v = r[off + k]!;
          werte.set(v, (werte.get(v) ?? 0) + 1);
        }
      }
      return anzahl;
    };
    const nW = zaehle(sek[SEK_WAFFE], WAFFE_LEN, W.boostIdx, 4);
    const nR = zaehle(sek[SEK_RUESTUNG], RUESTUNG_LEN, R.boostIdx, 4);
    const nA = zaehle(sek[SEK_ACCESSOIRE], ACCESSOIRE_LEN, A.boostIdx, 2);

    console.log(
      `[EQ] ${nW} Waffen · ${nR} Rüstungen · ${nA} Accessoires · Indexwerte: ` +
        [...werte.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}×${c}`).join(', '),
    );

    /**
     * 🟢 **Die Zählaussage hält.** Ein Byte hat 256 mögliche Werte; im ganzen
     * Bestand kommen an dieser Stelle nur **sieben** vor — `0`…`5` als echte
     * Statplätze und `0xFF` als „kein Bonus". Ein falsch gelegtes Feld würde
     * über hunderte Datensätze fast sicher etwas anderes zeigen.
     *
     * Das belegt zugleich, dass Index und Betrag wirklich **Paare** sind:
     * Die Indexspalte trägt genau die sechs Statplätze und sonst nichts.
     */
    expect(nW).toBeGreaterThan(100);
    expect(nR).toBeGreaterThan(20);
    const erlaubt = new Set([0, 1, 2, 3, 4, 5, 0xff]);
    for (const v of werte.keys()) expect(erlaubt.has(v)).toBe(true);
    // Alle sechs Statplätze kommen auch wirklich vor — sonst wäre die Menge zu weit.
    for (const v of [0, 1, 2, 3, 4, 5]) expect(werte.get(v) ?? 0).toBeGreaterThan(0);
  }, 300_000);
});
