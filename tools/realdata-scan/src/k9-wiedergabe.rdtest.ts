import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { battleAnimationToClip, loadBattleModel, type BattleEntrySource } from '@webmidgar/render-battle';
import { REAL_DIR } from './real-pfade.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * K9 — der Weg von der Datei bis zum abspielbaren Clip, über den ganzen
 * Bestand.
 *
 * Die Formatabrechnung steht in `k9-bitpackung.rdtest.ts` (391/391). Diese
 * Probe prüft die **Kette danach**: Kommt aus jedem Präfix ein Clip heraus,
 * der zum Skelett dieses Präfixes passt? Drei Fragen, die ein Fixture nicht
 * beantworten kann, weil sie den Bestand brauchen:
 *
 * 1. Trägt jedes Modell überhaupt eine Bank, und hat sie einen Satz mit
 *    Bewegung?
 * 2. Deckt ein Clip nie mehr Knochen ab, als das Skelett hat? Ein Clip mit
 *    zu vielen Knochen würde im Abspieler ins Leere schreiben.
 * 3. **Beißt die halbe Winkelnormierung des Originals?** Sie addiert auf
 *    negative Werte genau einmal `0x1000` und ist damit KEIN Modulo. Ob im
 *    Bestand je ein Winkel außerhalb `[0, 4096)` landet, ist eine reine
 *    Tatsachenfrage — hier wird sie gestellt. **Antwort: ja, in 0,59 % der
 *    Fälle**, und es ist folgenlos. Warum, steht bei der Erwartung unten.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Wertebereiche, keine Rahmendaten.
 */

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('K9 — von der Datei zum abspielbaren Clip', () => {
  it('baut aus jedem Präfix Clips, die zum eigenen Skelett passen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const proPraefix = new Map<string, string[]>();
    const idOf = new Map<string, string>();
    for (const e of index.listEntries('battle')) {
      if (e.name.length !== 4) continue;
      const n = e.name.toLowerCase();
      idOf.set(n, e.canonicalId);
      const p = n.slice(0, 2);
      (proPraefix.get(p) ?? proPraefix.set(p, []).get(p)!).push(n);
    }
    const source: BattleEntrySource = {
      listBattleEntries: (prefix) => proPraefix.get(prefix) ?? [],
      readBattleEntry: async (name) => {
        const id = idOf.get(name.toLowerCase());
        if (!id) return null;
        try {
          return await index.readEntry(id);
        } catch {
          return null;
        }
      },
    };

    let mitBank = 0;
    let ohneBank = 0;
    let mitBewegung = 0;
    let clips = 0;
    let rahmen = 0;
    let knochenPasst = 0;
    let knochenZuViele = 0;
    let winkelAusserhalb = 0;
    let winkelGesamt = 0;
    let minWinkel = Number.POSITIVE_INFINITY;
    let maxWinkel = Number.NEGATIVE_INFINITY;
    let maxVerschiebung = 0;
    const ohneBankNamen: string[] = [];

    const praefixe = [...proPraefix.keys()].sort();
    for (const prefix of praefixe) {
      const model = await loadBattleModel(prefix, source);
      if (!model) continue;
      if (!model.animations) {
        ohneBank++;
        if (ohneBankNamen.length < 6) ohneBankNamen.push(prefix);
        continue;
      }
      mitBank++;
      const echte = model.animations.animations.filter((a) => !a.leer);
      if (echte.some((a) => a.frames.length > 1)) mitBewegung++;

      for (const a of echte) {
        const clip = battleAnimationToClip(a);
        clips++;
        rahmen += clip.frames.length;
        if (clip.boneCount <= model.skeleton.boneCount) knochenPasst++;
        else knochenZuViele++;
        for (const f of clip.frames) {
          for (const g of [f.rootRotation[0], f.rootRotation[1], f.rootRotation[2], ...f.rotations]) {
            winkelGesamt++;
            if (!Number.isFinite(g)) throw new Error(`${prefix}: nicht-endlicher Winkel`);
            if (g < 0 || g >= 360) winkelAusserhalb++;
            if (g < minWinkel) minWinkel = g;
            if (g > maxWinkel) maxWinkel = g;
          }
          for (const t of f.rootTranslation) maxVerschiebung = Math.max(maxVerschiebung, Math.abs(t));
        }
      }
    }
    await dir.closeAll();

    // Die 90 ohne Bank sind das Bühnenband `og`…`rr` — sie haben ein leeres
    // Skelett und tragen folgerichtig keine Animation.
    console.log(`[K9-W] Präfixe mit Bank ${mitBank}, ohne Bank ${ohneBank}${ohneBankNamen.length ? ` (ab ${ohneBankNamen[0]})` : ''}`);
    console.log(`[K9-W] Modelle mit mindestens einem bewegten Satz: ${mitBewegung}/${mitBank}`);
    console.log(`[K9-W] Clips ${clips} · Rahmen ${rahmen} · Knochen passt ${knochenPasst}, zu viele ${knochenZuViele}`);
    console.log(
      `[K9-W] Winkel ${winkelGesamt}: außerhalb [0,360) ${winkelAusserhalb} · Spanne ` +
        `${minWinkel.toFixed(2)}…${maxWinkel.toFixed(2)}° · größte Wurzelverschiebung ${maxVerschiebung}`,
    );

    /**
     * DAUERBEFUND 🟢 — **kein Clip greift über sein Skelett hinaus.** Das ist
     * die Bedingung dafür, dass `applyFrame` gefahrlos laufen kann: Knochen,
     * die der Clip nicht abdeckt, bleiben in der Bindpose (Drehung 0), und
     * Knochen jenseits des Skeletts gibt es nicht.
     */
    expect(mitBank).toBe(391);
    expect(knochenZuViele).toBe(0);
    expect(mitBewegung).toBe(mitBank);

    /**
     * ⚠️ **Hier ist eine Erwartung gefallen, und die Widerlegung ist der
     * eigentliche Befund.** Erwartet war, dass kein Winkel `[0, 360°)`
     * verlässt. Gemessen: **50.371 von 8.492.094 (0,59 %)**, Spanne
     * **−2520°…+2877°**. Die halbe Normierung des Originals holt also
     * nachweislich nicht jeden Wert zurück.
     *
     * 🟢 **Und das ist folgenlos — aus einem Grund, der im Format steckt.**
     * Der Akkumulator ist ein `short`. Läuft er über, springt der Wert um
     * 65536 Einheiten, und `65536 / 4096 = **16**` — ein Überlauf ist exakt
     * **sechzehn volle Umdrehungen** und im Winkelraum unsichtbar. Aus
     * demselben Grund ist ein Winkel von 2877° dasselbe wie −3°: Drehungen
     * sind periodisch, und Three.js rechnet mit jedem Eulerwert.
     *
     * Genau deshalb kann das Original sich die halbe Normierung leisten. Wer
     * sie für einen Fehler hält, hat die Periode übersehen.
     *
     * DAUERBEFUND 🟢 — die **echte** Schranke ist der `short`: Kein Winkel
     * darf ±32768 Einheiten = **±2880°** überschreiten. Das prüft, dass der
     * Akkumulator nie mehr getragen hat, als ein `short` fassen kann — und
     * schlägt an, sobald der Deltacode falsch gelesen wird.
     */
    const S16_IN_GRAD = (32768 / 4096) * 360;
    expect(winkelAusserhalb).toBeGreaterThan(0);
    expect(Math.abs(minWinkel)).toBeLessThanOrEqual(S16_IN_GRAD);
    expect(maxWinkel).toBeLessThanOrEqual(S16_IN_GRAD);
    // Die Wurzelverschiebung ist ebenfalls ein `short` — auch sie muss passen.
    expect(maxVerschiebung).toBeLessThan(32768);
  }, 900_000);
});
