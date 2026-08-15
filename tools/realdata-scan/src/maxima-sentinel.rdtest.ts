import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAXIMUM_UNBERECHNET, readSavemap, wirksamesMaximum } from '@webmidgar/formats-save';
import { REAL_DIR } from './real-pfade.js';

/**
 * F12-Nachtrag — der Sentinel `0xFFFF` bei @56/@58, gemessen statt geglaubt.
 *
 * **Die Behauptung** stammt aus einer Fremdaufnahme („`0xFFFF` heißt: noch
 * nicht berechnet"). Sie ist plausibel, aber eine Fremdaufnahme ist in diesem
 * Projekt eine Hypothese. Diese Probe misst sie an den echten Spielständen der
 * Installation.
 *
 * **Warum es kein Randfall ist.** Träfe der Sentinel nur vereinzelt auf, wäre
 * die Wache Vorsorge. Er trifft auf **24 von 63** benannten Records — die
 * Auflösung ist damit der Normalfall für jede Figur, die noch nie in der
 * Gruppe war.
 *
 * **Die Gütefunktion ist die Ordnungsaussage, nicht die Häufigkeit.** Ein
 * Zähler allein sagt nichts; entscheidend ist, dass nach der Auflösung
 * `aktuell ≤ Maximum` für **jeden** Record gilt und vorher nicht. Genau diese
 * Aussage trägt die Feldlage aus F12.
 *
 * Urheberrecht: Ausgegeben werden nur Zähler und Wertebereiche.
 */

const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const SAVE_HEADER_LEN = 9;

const available = existsSync(join(REAL_DIR, 'save'));

async function ladeSlots(): Promise<Uint8Array[]> {
  const saveDir = join(REAL_DIR, 'save');
  const out: Uint8Array[] = [];
  for (const d of (await readdir(saveDir)).filter((f) => /\.ff7$/i.test(f)).sort()) {
    const b = await readFile(join(saveDir, d));
    if (b.length !== SAVE_HEADER_LEN + SLOT_COUNT * SLOT_LEN) continue;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const start = SAVE_HEADER_LEN + i * SLOT_LEN;
      const slot = new Uint8Array(b.subarray(start, start + SLOT_LEN));
      if (slot.filter((x) => x !== 0).length / SLOT_LEN >= 0.1) out.push(slot);
    }
  }
  return out;
}

describe.skipIf(!available)('F12-Nachtrag — 0xFFFF bei den abgeleiteten Maxima', () => {
  it('zählt den Sentinel und belegt, dass die Auflösung die Ordnung herstellt', async () => {
    const slots = await ladeSlots();
    expect(slots.length).toBeGreaterThan(0);

    let records = 0;
    let sentinelBeide = 0;
    let sentinelEinzeln = 0;
    let maximumUnterBasis = 0;
    let ordnungRoh = 0;
    let ordnungAufgeloest = 0;
    let groesstesRohMaximum = 0;

    for (const slot of slots) {
      const savemap = readSavemap(slot);
      if (!savemap) continue;
      for (const c of savemap.characters) {
        if (!c.used) continue;
        records++;

        // Rohwerte zurückrechnen: Der Leser liefert bereits das wirksame
        // Maximum, der Sentinel steckt in `maximaBerechnet`.
        const hpRoh = c.maximaBerechnet ? c.hpMax : MAXIMUM_UNBERECHNET;
        const mpRoh = c.maximaBerechnet ? c.mpMax : MAXIMUM_UNBERECHNET;
        const beide = hpRoh === MAXIMUM_UNBERECHNET && mpRoh === MAXIMUM_UNBERECHNET;
        const eines = hpRoh === MAXIMUM_UNBERECHNET || mpRoh === MAXIMUM_UNBERECHNET;
        if (beide) sentinelBeide++;
        else if (eines) sentinelEinzeln++;

        if (c.maximaBerechnet && (c.hpMax < c.hpBasis || c.mpMax < c.mpBasis)) maximumUnterBasis++;
        if (c.maximaBerechnet) groesstesRohMaximum = Math.max(groesstesRohMaximum, c.hpMax, c.mpMax);

        // Ordnung VOR der Auflösung — mit dem Rohwert 65535 gilt sie trivial,
        // und genau das ist das Problem: Sie sagt dann nichts mehr aus.
        if (c.hp <= hpRoh && c.mp <= mpRoh) ordnungRoh++;
        if (c.hp <= c.hpMax && c.mp <= c.mpMax) ordnungAufgeloest++;
      }
    }

    console.log(
      '[F12-Sentinel]',
      JSON.stringify({
        slots: slots.length,
        records,
        sentinelBeide,
        sentinelEinzeln,
        maximumUnterBasis,
        groesstesRohMaximum,
        ordnungRoh,
        ordnungAufgeloest,
      }),
    );

    // Der Sentinel ist da, und zwar reichlich.
    expect(sentinelBeide).toBeGreaterThan(0);
    expect(sentinelBeide / records).toBeGreaterThan(0.2);

    /**
     * DAUERBEFUND: Der Sentinel tritt in diesem Bestand **nie einzeln** auf —
     * beide Felder werden gemeinsam gefüllt. Das ist eine Beobachtung über
     * diesen Bestand, keine Zusicherung des Formats; der Code behandelt beide
     * Felder deshalb weiterhin getrennt. Schlägt diese Erwartung je fehl, ist
     * das die interessante Nachricht und kein Regressionsschaden.
     */
    expect(sentinelEinzeln).toBe(0);

    /**
     * Die eigentliche Gütefunktion: Nach der Auflösung gilt `aktuell ≤
     * Maximum` für JEDEN Record. Ohne sie gilt sie auch — aber nur, weil
     * 65535 alles durchlässt. Deshalb steht darunter die schärfere Kontrolle.
     */
    expect(ordnungAufgeloest).toBe(records);

    /**
     * KONTROLLE gegen die Trivialität: Ein Record mit Sentinel besteht die
     * Ordnungsprüfung roh **immer**, unabhängig vom Inhalt — `ordnungRoh`
     * kommt deshalb ebenfalls auf 63/63, und genau das ist der Punkt. Eine
     * Prüfung, die auch mit einer Marke statt eines Wertes durchgeht, misst
     * nichts.
     *
     * Dass 65535 wirklich eine Marke ist und kein Wert, zeigt der Bestand
     * selbst: Das größte **berechnete** Maximum ist **9999** — die
     * dokumentierte Obergrenze des Originals. 65535 liegt um Faktor 6,5
     * darüber und ist damit im Wertebereich schlicht unerreichbar.
     */
    expect(groesstesRohMaximum).toBe(9999);
    expect(ordnungRoh).toBe(records); // trivial bestanden — genau der Punkt

    /**
     * Materia handelt Maxima auch NACH UNTEN (Magie-Materia: HP runter, MP
     * hoch). Eine Wache „Maximum ≥ Basiswert" wäre also falsch gewesen — hier
     * steht der Beleg dafür, dass sie nicht eingebaut wurde.
     */
    expect(maximumUnterBasis).toBeGreaterThan(0);
  });

  it('wirksamesMaximum trifft an den echten Ständen dieselbe Wahl wie der Leser', async () => {
    const slots = await ladeSlots();
    let geprueft = 0;
    for (const slot of slots) {
      const savemap = readSavemap(slot);
      if (!savemap) continue;
      for (const c of savemap.characters) {
        if (!c.used) continue;
        geprueft++;
        const hpRoh = c.maximaBerechnet ? c.hpMax : MAXIMUM_UNBERECHNET;
        expect(wirksamesMaximum(hpRoh, c.hpBasis)).toBe(c.hpMax);
      }
    }
    expect(geprueft).toBeGreaterThan(0);
  });
});
