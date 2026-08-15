import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseKernelContainer } from '@webmidgar/formats-kernel';
import { ATTACK_RECORD_LEN, parseKernelBattleData, parseSceneBin } from '@webmidgar/formats-battle';
import { SCHADENSKLASSEN_FLAGS } from '@webmidgar/battle-runtime';
import { realPfad } from './real-pfade.js';

/**
 * Das Schadensbyte an **unseren** Daten — der unabhängige Beleg zur
 * zahlengleichen Schadensrechnung.
 *
 * **Warum diese Probe nötig ist.** Formel und Testvektoren stammen aus
 * derselben Quelle. Dass unsere Umsetzung die Vektoren trifft, zeigt nur,
 * dass wir richtig abgeschrieben haben — nicht, dass die Vorlage stimmt.
 * Dafür braucht es eine Aussage der Vorlage über etwas, das wir selbst
 * nachzählen können.
 *
 * Die Vorlage macht eine sehr scharfe: ein **vollständiges Histogramm der
 * hohen Nibbles je Container**, und zwar für **beide** Locale-Fassungen
 * getrennt. Die beiden unterscheiden sich um **fünf Datensätze**. Eine
 * Messung, die eines der beiden Histogramme auf den Datensatz genau trifft,
 * belegt damit dreierlei auf einmal:
 *
 * 1. der Versatz `+0x0E` des Schadensbytes sitzt richtig,
 * 2. unser Szenenparser liest genau die richtigen Datensätze,
 * 3. **welche der beiden `scene.bin` wir überhaupt lesen** — die Zählung
 *    unterscheidet sie, ohne die Dateien zu vergleichen.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Nibbleverteilungen.
 */

const SCENE = realPfad('battle/scene.bin');
const KERNEL = realPfad('kernel/KERNEL.BIN');
const available = existsSync(SCENE) && existsSync(KERNEL);

/** Versatz des Schadensbytes im Angriffsdatensatz (Vorlage §4, `+0x0E`). */
const DAMAGE_CALC_OFF = 0x0e;

/** Histogramme der hohen Nibbles aus dem Zensus der Vorlage, je Container. */
const ERWARTET = {
  /** `data\battle\scene.bin` — die Fassung ohne Locale-Ordner. */
  szeneA: { 0x0: 386, 0x1: 1158, 0x2: 642, 0x5: 35, 0x6: 34, 0x8: 15, 0xb: 4, 0xf: 5918 },
  /** `data\lang-en\battle\scene.bin`. */
  szeneB: { 0x0: 386, 0x1: 1157, 0x2: 638, 0x5: 35, 0x6: 34, 0x8: 15, 0xb: 4, 0xf: 5923 },
  /** Kernel §1 (Angriffe) — in **beiden** Fassungen identisch. */
  kernelAngriffe: { 0x0: 2, 0x1: 9, 0x2: 91, 0x5: 8, 0x6: 3, 0x8: 2, 0xb: 7, 0xf: 6 },
} as const;

type Histogramm = Record<number, number>;

function histogramm(records: readonly { raw: Uint8Array }[]): Histogramm {
  const h: Histogramm = {};
  for (const r of records) {
    if (r.raw.length < ATTACK_RECORD_LEN) continue;
    const hi = (r.raw[DAMAGE_CALC_OFF]! & 0xf0) >> 4;
    h[hi] = (h[hi] ?? 0) + 1;
  }
  return h;
}

function gleich(a: Histogramm, b: Record<number, number>): boolean {
  const schluessel = new Set([...Object.keys(a), ...Object.keys(b)].map(Number));
  for (const k of schluessel) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function zeige(h: Histogramm): string {
  return Object.entries(h)
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([n, c]) => `${Number(n).toString(16).toUpperCase()}:${c}`)
    .join(' ');
}

describe.skipIf(!available)('Schadensbyte gegen den Originalbestand', () => {
  it('trifft ein Container-Histogramm des Zensus auf den Datensatz genau', async () => {
    const container = await parseSceneBin(await readFile(SCENE), 'scene.bin');
    const szeneRecords: { raw: Uint8Array }[] = [];
    let szenen = 0;
    for (const scene of container.scenes) {
      if (!scene) continue;
      szenen++;
      for (const a of scene.attacks) szeneRecords.push(a);
    }
    const hSzene = histogramm(szeneRecords);

    const kernelContainer = await parseKernelContainer(await readFile(KERNEL), 'KERNEL.BIN');
    expect(kernelContainer).not.toBeNull();
    if (!kernelContainer) return;
    const kernel = parseKernelBattleData(kernelContainer.sections, 'KERNEL.BIN');
    const kernelDaten = kernel.data;
    expect(kernelDaten).not.toBeNull();
    if (!kernelDaten) return;
    const hKernel = histogramm(kernelDaten.attacks);

    const istA = gleich(hSzene, ERWARTET.szeneA);
    const istB = gleich(hSzene, ERWARTET.szeneB);
    console.log(`[DMG] ${szenen} Szenen · ${szeneRecords.length} Angriffe · Histogramm ${zeige(hSzene)}`);
    console.log(`[DMG] Kernel §1: ${kernelDaten.attacks.length} Angriffe · ${zeige(hKernel)}`);
    console.log(`[DMG] Zuordnung: Korpus A (data/) ${istA} · Korpus B (lang-en) ${istB}`);

    /**
     * 🟢 **Der unabhängige Beleg.** Das Histogramm muss GENAU eines der beiden
     * Zensus-Ergebnisse treffen — beide gleichzeitig geht nicht, sie
     * unterscheiden sich in drei Nibbles. Trifft es keines, sitzt entweder der
     * Versatz falsch oder unser Recordraster.
     */
    expect(szeneRecords.length).toBe(256 * 32);
    expect(istA !== istB).toBe(true);
    expect(istA || istB).toBe(true);

    /**
     * 🟢 **Und es sagt uns, welche Datei wir lesen.** `scene.bin` steht im
     * Locale-Verbund (F-LOC): Liegt `data/lang-en/battle/scene.bin` vor, hat
     * sie Vorrang. Genau das weist diese Zählung nach — **ohne die Dateien zu
     * vergleichen**, allein über fünf Datensätze Unterschied im Inhalt.
     * Fällt diese Erwartung, hat sich die Locale-Auflösung geändert.
     */
    expect(istB).toBe(true);

    // Kernel §1 ist in beiden Fassungen identisch — also eine Erwartung ohne Fallunterscheidung.
    expect(gleich(hKernel, ERWARTET.kernelAngriffe)).toBe(true);

    /**
     * 🟢 **Gegenprobe zur Klassenflagtabelle.** Die hohen Nibbles `0xC`…`0xE`
     * führt die Vorlage als strukturelle Auffüllung — verhaltensgleich mit
     * `0x4`/`0x5` und deshalb im Auslieferungsbestand unbenutzt. Gemessen,
     * statt geglaubt. `0xF` kommt vor, aber **nur** als ganzes Byte `0xFF`.
     */
    for (const n of [0xc, 0xd, 0xe]) {
      expect((hSzene[n] ?? 0) + (hKernel[n] ?? 0)).toBe(0);
    }
    const nurFF = [...szeneRecords, ...kernelDaten.attacks]
      .filter((r) => r.raw.length >= ATTACK_RECORD_LEN && (r.raw[DAMAGE_CALC_OFF]! & 0xf0) === 0xf0)
      .every((r) => r.raw[DAMAGE_CALC_OFF] === 0xff);
    expect(nurFF).toBe(true);
    for (const n of Object.keys(hSzene).map(Number)) expect(SCHADENSKLASSEN_FLAGS[n]).toBeDefined();
  }, 300_000);

  it('prüft die übrigen Felder des Angriffsdatensatzes am Bestand', async () => {
    const container = await parseSceneBin(await readFile(SCENE), 'scene.bin');
    const alle = [];
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (const a of scene.attacks) alle.push(a);
    }
    const kc = await parseKernelContainer(await readFile(KERNEL), 'KERNEL.BIN');
    const kd = kc ? parseKernelBattleData(kc.sections, 'KERNEL.BIN').data : null;
    if (kd) alle.push(...kd.attacks);
    // Nur belegte Datensaetze: 0xFF im Schadensbyte ist der Leermarker.
    const belegt = alle.filter((a) => a.damageCalc !== 0xff);
    let powerNull = 0;
    let elementKeins = 0;
    let statusKeine = 0;
    let elementRoh0xffff = 0;
    const statusModi = new Map<number, number>();
    for (const a of belegt) {
      if (a.power === 0) powerNull++;
      if (a.elementMask === 0) elementKeins++;
      if (a.statusMask === 0xffffffff) statusKeine++;
      if (new DataView(a.raw.buffer, a.raw.byteOffset, a.raw.byteLength).getUint16(0x18, true) === 0xffff) {
        elementRoh0xffff++;
      }
      statusModi.set(a.statusMode >> 6, (statusModi.get(a.statusMode >> 6) ?? 0) + 1);
    }
    console.log(
      `[DMG] ${belegt.length} belegte Angriffe · power==0: ${powerNull} · elementMask==0: ${elementKeins} ` +
        `(davon roh 0xFFFF: ${elementRoh0xffff}) · statusMask==keine: ${statusKeine}`,
    );
    console.log(
      '[DMG] Statusmodus-Eimer (>>6):',
      [...statusModi.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}×${n}`).join(', '),
    );

    /**
     * ⚠️ **Hier ist eine Erwartung von mir gefallen, und der Befund ist
     * besser als die Erwartung.**
     *
     * Die Vorlage vermerkt, `0xFFFF` werde im Elementfeld auf `0` normiert.
     * Ich hatte daraus geschlossen, elementlose Angriffe traegen roh
     * `0xFFFF` — **falsch**: In `scene.bin` steht bei 903 elementlosen
     * Angriffen **kein einziges Mal** `0xFFFF`, sondern glattes `0x0000`.
     *
     * 🟢 **Aber die Normierung ist auch kein toter Code.** Nimmt man die
     * 128 Kernel-Angriffe dazu, gibt es **genau einen** Datensatz mit rohem
     * `0xFFFF` — 1 von 2391. Sie existiert also fuer diesen einen Fall, und
     * ohne sie waere aus einem elementlosen Angriff einer mit sechzehn
     * Elementen geworden.
     *
     * Ein schoenes Mass dafuer, wie wenig „kommt im Bestand nicht vor" und
     * „ist ueberfluessig" miteinander zu tun haben. Die Zahl ist eingefroren.
     */
    expect(belegt.length).toBeGreaterThan(2000);
    expect(elementRoh0xffff).toBe(1);
    expect(elementKeins).toBeGreaterThan(0);

    /**
     * 🟢 Der Statusmodus ist ein gepacktes Byte: Eimer in den oberen zwei
     * Bits, Rate in den unteren sechs. Kaeme dort etwas anderes, saehe man
     * mehr als vier Eimer.
     */
    for (const k of statusModi.keys()) expect(k).toBeLessThanOrEqual(3);
  }, 300_000);

  it('prüft den Rückenangriffsfaktor der Gegner als Achtel', async () => {
    const container = await parseSceneBin(await readFile(SCENE), 'scene.bin');
    const werte = new Map<number, number>();
    const gesehen = new Set<number>();
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (let slot = 0; slot < scene.enemyTypeIds.length; slot++) {
        const id = scene.enemyTypeIds[slot]!;
        if (id === 0xffff || gesehen.has(id)) continue;
        const rec = scene.enemies[slot];
        if (!rec || rec.hp === 0 || rec.hp === 0xffffffff) continue;
        gesehen.add(id);
        const v = rec.raw[0xa2]!;
        werte.set(v, (werte.get(v) ?? 0) + 1);
      }
    }
    console.log(
      `[DMG] backAttack (u8@0xA2) über ${gesehen.size} Gegnertypen:`,
      [...werte.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}×${c}`).join(', '),
    );

    /**
     * 🟢 Die Vorlage liest `SceneEnemy + 0xA2` als Faktor **in Achteln**
     * (`d * v >> 3`): 8 hieße „unverändert", 16 „doppelt". Der Bestand liegt
     * ganz überwiegend auf **16** — der Regelfall „von hinten trifft es
     * doppelt". Wäre die Einheit eine andere, läge der Schwerpunkt anderswo.
     *
     * 🟡 **Neun Gegnertypen tragen `255`.** Als Achtelfaktor wäre das ×31,9 —
     * unplausibel als Absicht, aber `0xFF` ist in diesen Datensätzen sonst
     * durchweg der Leermarker. Ob das Original diesen Wert je erreicht oder
     * ob die betroffenen Gegner nie von hinten angegriffen werden können,
     * ist an den Daten allein nicht zu entscheiden. Festgehalten, nicht
     * gedeutet — und beim Rechnen wirkt er nur bei gesetztem
     * Rückenangriffsflag.
     */
    expect(gesehen.size).toBeGreaterThan(300);
    expect(Math.min(...werte.keys())).toBeGreaterThan(0);
    expect((werte.get(16) ?? 0) / gesehen.size).toBeGreaterThan(0.9);
    expect(werte.get(255) ?? 0).toBe(9);
  }, 300_000);
});
