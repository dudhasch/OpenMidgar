import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { enemyModelPrefix, parseSceneBin } from '@webmidgar/formats-battle';
import { REAL_DIR, realPfad } from './real-pfade.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * K9 — ist `u32@0` der `da`-Datei die **Anzahl der Animationen**?
 *
 * Die Prüfgröße kommt aus einer **dritten** Datei: Jeder Gegnerrecord in
 * `scene.bin` trägt bei `+0x38` **16 Animationsindizes** (`animationIds`), und
 * die zeigen in genau dieses Bündel. Ist `u32@0` die Anzahl, dann muss gelten:
 *
 * > **jeder belegte Index < `u32@0`**
 *
 * Das ist eine *Enthaltensein*-Aussage, keine Gleichheit — sie kann nicht
 * zufällig zustande kommen, wenn die Zahl klein ist und die Indizes groß.
 *
 * **Kontrollniveau: die verwürfelte Paarung.** Dieselbe Prüfung mit den
 * Indizes des einen Gegners gegen die Animationsdatei eines *anderen*. Weil
 * beide Seiten dieselbe Werteverteilung haben, misst die Kontrolle genau das,
 * was ein blinder Test hier finden würde.
 *
 * ⚠ **Die Kontrolle ist hier besonders nötig**, weil ein zu GROSSES `u32@0`
 * den Test trivial bestehen würde. Deshalb wird zusätzlich gemessen, wie eng
 * die Schranke sitzt: `max(Index) + 1` gegen `u32@0`. Eine Schranke, die immer
 * um das Zehnfache über dem größten Index liegt, belegt nichts.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Quoten und Indexbereiche.
 */

const available = existsSync(realPfad('battle/scene.bin'));
const ANIM_IDS_OFF = 0x38;
const ANIM_IDS_LEN = 16;

interface Gegner {
  prefix: string;
  /** Belegte Animationsindizes des Records (ohne 0xFF-Füllung). */
  ids: number[];
  /** `u32@0` der zugehörigen `da`-Datei. */
  animZahl: number;
  /** `u32@4` — die belegte Gelenkzahl, als Gegenanker. */
  gelenke: number;
}

async function sammle(): Promise<{ gegner: Gegner[]; ohneDatei: number; sentinelWerte: Map<number, number> }> {
  const container = await parseSceneBin(await readFile(realPfad('battle/scene.bin')), 'scene.bin');
  const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });
  const nachName = new Map<string, string>();
  for (const e of index.listEntries('battle')) {
    if (e.name.length === 4) nachName.set(e.name.toLowerCase(), e.canonicalId);
  }

  const daCache = new Map<string, { animZahl: number; gelenke: number } | null>();
  const holeDa = async (prefix: string): Promise<{ animZahl: number; gelenke: number } | null> => {
    if (daCache.has(prefix)) return daCache.get(prefix)!;
    const id = nachName.get(`${prefix}da`);
    let out: { animZahl: number; gelenke: number } | null = null;
    if (id) {
      try {
        const b = await index.readEntry(id);
        if (b.length >= 8) {
          const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
          out = { animZahl: dv.getUint32(0, true), gelenke: dv.getUint32(4, true) };
        }
      } catch {
        out = null;
      }
    }
    daCache.set(prefix, out);
    return out;
  };

  const gegner: Gegner[] = [];
  const sentinelWerte = new Map<number, number>();
  const gesehen = new Set<number>();
  let ohneDatei = 0;
  for (const scene of container.scenes) {
    if (!scene) continue;
    for (let slot = 0; slot < scene.enemyTypeIds.length; slot++) {
      const typId = scene.enemyTypeIds[slot]!;
      if (typId === 0xffff || gesehen.has(typId)) continue;
      const rec = scene.enemies[slot];
      if (!rec || rec.hp === 0 || rec.hp === 0xffffffff) continue;
      gesehen.add(typId);

      const roh = rec.raw.subarray(ANIM_IDS_OFF, ANIM_IDS_OFF + ANIM_IDS_LEN);
      for (const v of roh) sentinelWerte.set(v, (sentinelWerte.get(v) ?? 0) + 1);
      const ids = [...roh].filter((v) => v !== 0xff);

      const da = await holeDa(enemyModelPrefix(typId));
      if (!da) {
        ohneDatei++;
        continue;
      }
      gegner.push({ prefix: enemyModelPrefix(typId), ids, animZahl: da.animZahl, gelenke: da.gelenke });
    }
  }
  await dir.closeAll();
  return { gegner, ohneDatei, sentinelWerte };
}

describe.skipIf(!available)('K9 — ist u32@0 die Anzahl der Animationen?', () => {
  it('prüft Enthaltensein der Animationsindizes, gegen verwürfelte Paarung', async () => {
    const { gegner, ohneDatei, sentinelWerte } = await sammle();
    console.log(`[K9-N] ${gegner.length} Gegnertypen mit da-Datei · ${ohneDatei} ohne`);
    console.log(
      '[K9-N] Werte im animationIds-Feld (Top 6):',
      [...sentinelWerte.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([v, n]) => `${v}×${n}`)
        .join(', '),
    );
    expect(gegner.length).toBeGreaterThan(200);

    const passt = (g: Gegner, zahl: number): boolean => g.ids.length > 0 && g.ids.every((i) => i < zahl);
    const echt = gegner.filter((g) => passt(g, g.animZahl)).length;
    const mitIds = gegner.filter((g) => g.ids.length > 0).length;
    const kontrolle = gegner.filter((g, i) => passt(g, gegner[(i + 1) % gegner.length]!.animZahl)).length;

    console.log(
      `[K9-N] alle Indizes < u32@0: echt ${echt}/${mitIds} (${((100 * echt) / mitIds).toFixed(1)} %) · ` +
        `verwürfelt ${kontrolle}/${mitIds} (${((100 * kontrolle) / mitIds).toFixed(1)} %)`,
    );

    /**
     * Wie ENG sitzt die Schranke? Eine Obergrenze, die immer weit über dem
     * größten Index liegt, ist trivial erfüllt und belegt nichts. Gemessen
     * wird der Abstand `u32@0 − (max(Index) + 1)`.
     */
    const abstaende = gegner
      .filter((g) => g.ids.length > 0)
      .map((g) => g.animZahl - (Math.max(...g.ids) + 1));
    abstaende.sort((a, b) => a - b);
    const exakt = abstaende.filter((d) => d === 0).length;
    console.log(
      `[K9-N] Abstand u32@0 − (max+1): Median ${abstaende[Math.floor(abstaende.length / 2)]}, ` +
        `min ${abstaende[0]}, max ${abstaende.at(-1)} · exakt bündig in ${exakt}/${abstaende.length}`,
    );

    // Gegenanker: u32@4 ist die Gelenkzahl und hat mit den Indizes nichts zu
    // tun — wäre der Test blind, träfe er hier ähnlich oft.
    const gegenanker = gegner.filter((g) => passt(g, g.gelenke)).length;
    console.log(`[K9-N] Gegenanker (u32@4 statt u32@0): ${gegenanker}/${mitIds}`);

    /**
     * DAUERBEFUND — **diese Gütefunktion ist blind, und der Gegenanker
     * beweist es.**
     *
     * Gemessen (2026-08-15): echt 92,6 %, verwürfelt 88,1 % — Faktor 1,05,
     * weit unter der Projektschwelle 3. Entscheidend ist der Gegenanker:
     * `u32@4` ist die **Gelenkzahl** und hat mit Animationsindizes nichts zu
     * tun, besteht denselben Test aber in 91,7 % der Fälle. Ein Test, den ein
     * nachweislich unbeteiligtes Feld ebenso gut besteht, misst nichts.
     *
     * Die Ursache ist der Wertebereich: Die Indizes sind fast alle ≤ 9, also
     * besteht praktisch **jede** kleine Schranke. Der Abstand `u32@0 − (max+1)`
     * hat Median 8 und ist in **0 von 337** Fällen bündig — die Zahl sitzt
     * nirgends eng an den Indizes.
     *
     * **Damit ist `u32@0` als Animationszahl weder belegt noch widerlegt.**
     * Die Enthaltensein-Prüfung kann diese Frage prinzipiell nicht
     * entscheiden; es braucht eine Größe, die mit der Animationszahl
     * *variiert*. Diese Erwartung friert den Fehlschlag ein, damit niemand
     * dieselbe Messung ein zweites Mal für einen Befund hält.
     */
    expect(echt / mitIds).toBeLessThan(3 * (kontrolle / mitIds));
    expect(gegenanker / mitIds).toBeGreaterThan(0.85);
    expect(exakt).toBe(0);
  }, 300_000);

  it('prüft stattdessen, ob u32@0 ein Verzeichnis anführt', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const dateien: Uint8Array[] = [];
    for (const e of index.listEntries('battle')) {
      if (e.name.length !== 4 || e.name.slice(2).toLowerCase() !== 'da') continue;
      try {
        const b = await index.readEntry(e.canonicalId);
        if (b.length >= 16) dateien.push(b);
      } catch {
        /* quarantänisiert */
      }
    }
    await dir.closeAll();
    expect(dateien.length).toBeGreaterThan(300);

    /**
     * Die Frage, die bei `camdat` getragen hat, hier noch einmal gestellt:
     * Führt `u32@0` ein **Verzeichnis** an? Dann müssten ab einem festen
     * Kopfende `N` Werte stehen, die **streng monoton** wachsen und **in der
     * Datei liegen** — die klassische Verzeichnisinvariante. Geprüft werden
     * Kopfenden 8…24 und beide Breiten.
     */
    const ergebnis: string[] = [];
    for (const kopf of [8, 12, 16, 20, 24]) {
      for (const breite of [2, 4] as const) {
        let ok = 0;
        for (const b of dateien) {
          const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
          const n = dv.getUint32(0, true);
          if (n === 0 || n > 500 || kopf + n * breite > b.length) continue;
          let monoton = true;
          let vorher = -1;
          for (let i = 0; i < n; i++) {
            const at = kopf + i * breite;
            const v = breite === 4 ? dv.getUint32(at, true) : dv.getUint16(at, true);
            if (v <= vorher || v >= b.length) {
              monoton = false;
              break;
            }
            vorher = v;
          }
          if (monoton) ok++;
        }
        ergebnis.push(`Kopf ${kopf}/u${breite * 8}: ${ok}/${dateien.length}`);
      }
    }
    console.log('[K9-V] Verzeichnisinvariante:', ergebnis.join(' · '));

    const beste = Math.max(...ergebnis.map((z) => Number(z.split(': ')[1]!.split('/')[0])));
    /**
     * DAUERBEFUND: **Kein Kopfende führt ein monoton wachsendes Verzeichnis.**
     * `u32@0` ist also nicht die Länge einer Zeigertabelle am Dateianfang —
     * der Bauplan, der bei `camdat` getragen hat, trägt hier nicht.
     *
     * Steigt diese Zahl je über die Hälfte, ist ein Verzeichnis gefunden und
     * K9 macht einen großen Schritt.
     */
    expect(beste / dateien.length).toBeLessThan(0.5);
  }, 300_000);
});
