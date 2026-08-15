import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseSceneBin } from '@webmidgar/formats-battle';
import { realPfad } from './real-pfade.js';

/**
 * K10 — zwei Felder des Gegnerrecords, aus dem Quellenvergleich als Hypothese
 * geholt und **hier** entschieden.
 *
 * Beide Behauptungen stammen aus dem Prior-Art-Vergleich (Braver's `Scene.cs`,
 * über `docs/quellen/ff7-fenrir.md`). Eine Fremdquelle liefert in diesem
 * Projekt die Hypothese, nie das Urteil — deshalb diese Probe.
 *
 * **A — `+0xB0` heißt „erlaubt", nicht „immun".** Unser Feld hieß
 * `statusImmunity` und war damit das Gegenteil dessen, was auf der Platte
 * steht. Das ist kein Namensstreit: Wer die Maske als Immunität liest, dreht
 * jede Zustandsprüfung um.
 *
 * **B — `+0xA2` ist der Rückenangriffs-Faktor in Achteln** (`schaden * v >> 3`).
 * Das Feld war bei uns überhaupt nicht gedeutet.
 *
 * **Die Gütefunktion für B ist bewusst nicht „wenige verschiedene Werte"** —
 * das erfüllt in diesem Record fast jedes dünn belegte Byte. Die Achtel-Deutung
 * sagt etwas Schärferes vorher: Alle Nicht-Sentinel-Werte müssen **Vielfache
 * von 8** sein. Das ist über alle 184 Byteversätze prüfbar, und genau das ist
 * die Kontrolle.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Zahlenwerte, kein Text.
 */

const available = existsSync(realPfad('battle/scene.bin'));

const SENTINEL = 0xff;

interface Bestand {
  records: Uint8Array[];
  erlaubt: number[];
  ruecken: number[];
}

async function bestand(): Promise<Bestand> {
  const container = await parseSceneBin(
    await readFile(realPfad('battle/scene.bin')),
    'scene.bin',
  );
  const records: Uint8Array[] = [];
  const erlaubt: number[] = [];
  const ruecken: number[] = [];
  for (const scene of container.scenes) {
    if (!scene) continue;
    for (const e of scene.enemies) {
      // Belegt heißt: HP im sinnvollen Bereich. Der Namenstest allein reicht
      // nicht, weil leere Records im deutschen Zweig Reste tragen können.
      if (!e || e.hp === 0 || e.hp === 0xffffffff) continue;
      records.push(e.raw);
      erlaubt.push(e.statusesAllowed >>> 0);
      ruecken.push(e.backAttackScale);
    }
  }
  return { records, erlaubt, ruecken };
}

describe.skipIf(!available)('K10 — Gegnerrecord: +0xB0 und +0xA2', () => {
  it('A: +0xB0 ist die Erlaubnismaske — die Immunitätslesung ist absurd', async () => {
    const { records, erlaubt } = await bestand();
    expect(records.length).toBeGreaterThan(500);

    let bitsum = 0;
    let alleEins = 0;
    const werte = new Set<number>();
    for (const v of erlaubt) {
      werte.add(v);
      if (v === 0xffffffff) alleEins++;
      for (let i = 0; i < 32; i++) if (v & (1 << i)) bitsum++;
    }
    const mittel = bitsum / erlaubt.length;

    console.log(
      '[K10-A]',
      JSON.stringify({
        records: records.length,
        verschiedeneWerte: werte.size,
        alleEins,
        anteilAlleEins: Number((alleEins / erlaubt.length).toFixed(3)),
        bitsImMittel: Number(mittel.toFixed(1)),
      }),
    );

    /**
     * Die Entscheidung ist eine Absurditätsprüfung, keine Statistik: Als
     * Immunitätsmaske gelesen wäre der Durchschnittsgegner gegen 26 von 32
     * Zuständen immun und ein Drittel aller Gegner gegen **alle**. Ein Spiel,
     * in dem Gift, Schlaf und Stopp bei einem Drittel der Gegner grundsätzlich
     * nicht wirken, gibt es nicht — und `scene.bin` trägt für genau diese
     * Zustände Angriffsdaten.
     */
    expect(mittel).toBeGreaterThan(20);
    expect(alleEins / erlaubt.length).toBeGreaterThan(0.25);

    /**
     * Gegenprobe gegen „die Maske ist einfach konstant": Es sind viele
     * verschiedene Werte, also trägt das Feld Information. Wäre es nahezu
     * konstant, wäre die Deutung in beide Richtungen bedeutungslos.
     */
    expect(werte.size).toBeGreaterThan(50);
  });

  it('B: +0xA2 in Achteln — und über alle 184 Versätze getrennt', async () => {
    const { records, ruecken } = await bestand();

    const haeufig = new Map<number, number>();
    for (const v of ruecken) haeufig.set(v, (haeufig.get(v) ?? 0) + 1);
    const zweiFach = haeufig.get(16) ?? 0;

    console.log(
      '[K10-B]',
      JSON.stringify({
        records: records.length,
        werte: [...haeufig.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}(x${(v / 8).toFixed(2)}):${n}`),
        anteilZweifach: Number((zweiFach / ruecken.length).toFixed(3)),
      }),
    );

    // Der Modalwert ist exakt 16 = ×2,0 — der bekannte doppelte Rückenschaden.
    expect(zweiFach / ruecken.length).toBeGreaterThan(0.9);

    /**
     * KONTROLLE über alle 184 Byteversätze des Records: Wie viele erfüllen die
     * Vorhersage „alle Nicht-Sentinel-Werte sind Vielfache von 8, und es sind
     * höchstens 8 verschiedene"? Erfüllten es viele, wäre die Vorhersage
     * wertlos, weil der Record voller dünn belegter Bytes ist.
     */
    const treffer: number[] = [];
    for (let off = 0; off < 184; off++) {
      const m = new Set<number>();
      for (const r of records) m.add(r[off]!);
      const w = [...m].filter((v) => v !== SENTINEL && v !== 0);
      if (w.length === 0) continue;
      if (w.every((v) => v % 8 === 0) && w.length <= 8) treffer.push(off);
    }
    console.log('[K10-B] Versätze, die die Achtel-Vorhersage erfüllen:', treffer.map((o) => `0x${o.toString(16)}`).join(', '));

    expect(treffer).toContain(0xa2);
    /**
     * DAUERBEFUND: genau zwei Treffer, `+0x8B` und `+0xA2`. Faktor 92 gegen
     * die volle Kandidatenmenge, weit über der Projektschwelle 3. `+0x8B`
     * liegt im Dropraten-Block (`itemRaw` ab `+0x88`) und hat dort einen
     * eigenen Grund — es ist kein Gegenbeleg, sondern ein zweites Feld mit
     * derselben Zahlenform.
     *
     * Wächst diese Menge, ist die Vorhersage schwächer als angenommen und die
     * Deutung neu zu begründen.
     */
    expect(treffer.length).toBeLessThanOrEqual(2);
  });
});
