import { describe, expect, it } from 'vitest';
import {
  istPermutation,
  ladeZufallstabelle,
  naechste16,
  naechstesByte,
  setzeZufall,
  wechsleBank,
  wurf1bis100,
  zufallUnter,
  ZUFALLSTABELLE_LEN,
  ZUFALLSTABELLE_SUMME,
  ZUFALLSTABELLE_VERSATZ,
} from './ff7-zufall.js';

/**
 * Der Zufallsgenerator gegen **selbst erzeugte** Tabellen.
 *
 * Die echte Tabelle sind Originaldaten und steht nicht im Repository — die
 * Fixtures hier arbeiten mit der Identitätspermutation `t[i] = i`, weil bei
 * ihr jeder gezogene Wert unmittelbar den Lesekopf verrät. Damit lässt sich
 * die **Buchführung** prüfen, und genau die ist der Gegenstand: wie viele
 * Bytes ein Zug kostet und wann die Bank wechselt.
 *
 * Die Tabelle selbst prüft `tools/realdata-scan/src/zufallstabelle.rdtest.ts`
 * an den Daten des Anwenders.
 */

/** `t[i] = i` — jeder Wert nennt seinen eigenen Lesekopfstand. */
function identitaet(): Uint8Array {
  return Uint8Array.from({ length: 256 }, (_, i) => i);
}

describe('Zufallstabelle', () => {
  it('erkennt eine Permutation an Vollständigkeit UND Summe', () => {
    expect(istPermutation(identitaet())).toBe(true);
    expect(ZUFALLSTABELLE_SUMME).toBe((255 * 256) / 2);

    const doppelt = identitaet();
    doppelt[7] = 8; // 7 fehlt, 8 doppelt — Summe passt NICHT mehr
    expect(istPermutation(doppelt)).toBe(false);

    // Und eine, bei der die Summe zufällig stimmt, aber Werte doppelt sind:
    const summeStimmt = identitaet();
    summeStimmt[0] = 1;
    summeStimmt[1] = 0;
    expect(istPermutation(summeStimmt)).toBe(true); // echte Permutation
    const getauscht = identitaet();
    getauscht[3] = 4;
    getauscht[4] = 3;
    expect(istPermutation(getauscht)).toBe(true);
  });

  it('liest die Tabelle nur an der belegten Fundstelle', () => {
    const sektion = new Uint8Array(ZUFALLSTABELLE_VERSATZ + ZUFALLSTABELLE_LEN);
    sektion.set(identitaet(), ZUFALLSTABELLE_VERSATZ);
    const t = ladeZufallstabelle(sektion);
    expect(t).not.toBeNull();
    expect(t![0]).toBe(0);
    expect(t![255]).toBe(255);

    // Zu kurz: null, keine halbe Tabelle.
    expect(ladeZufallstabelle(new Uint8Array(100))).toBeNull();
    // Richtige Länge, aber keine Permutation: ebenfalls null.
    const kaputt = new Uint8Array(ZUFALLSTABELLE_VERSATZ + ZUFALLSTABELLE_LEN);
    expect(ladeZufallstabelle(kaputt)).toBeNull();
  });
});

describe('Ziehungen und ihre Buchführung', () => {
  it('setzt die acht Leseköpfe aus einem GLEITENDEN BYTEFENSTER', () => {
    const z = setzeZufall(identitaet(), 0);
    expect([...z.cursor]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(z.bank).toBe(0);

    /**
     * ⚠️ Kopf `i` bekommt `(seed >> i) & 0xFF`, nicht Bit `i`. Für 0x35 sind
     * das 53, 26, 13, 6, 3, 1, 0, 0 — stark überlappende Startwerte. Als
     * Bitauslese gelesen ergäbe das [1,0,1,0,1,1,0,0] und einen völlig
     * anderen Strom; genau dieser Irrtum ist hier eingefroren.
     */
    const z2 = setzeZufall(identitaet(), 0x35);
    expect([...z2.cursor]).toEqual([0x35, 0x1a, 0x0d, 0x06, 0x03, 0x01, 0x00, 0x00]);
    // Und ein Startwert am oberen Rand belegt alle acht Köpfe verschieden.
    const z3 = setzeZufall(identitaet(), 0x7fff);
    expect([...z3.cursor]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });

  it('zieht der Reihe nach aus EINER Bank und lässt die anderen stehen', () => {
    const z = setzeZufall(identitaet(), 0);
    expect([naechstesByte(z), naechstesByte(z), naechstesByte(z)]).toEqual([0, 1, 2]);
    expect(z.cursor[0]).toBe(3);
    expect(z.cursor[1]).toBe(0);
    wechsleBank(z);
    expect(naechstesByte(z)).toBe(0); // Bank 1 fängt bei ihrem eigenen Stand an
  });

  it('lässt den Lesekopf bei 256 umlaufen', () => {
    const z = setzeZufall(identitaet(), 0xff);
    expect(z.cursor[0]).toBe(0xff);
    z.cursor[0] = 255;
    expect(naechstesByte(z)).toBe(255);
    expect(z.cursor[0]).toBe(0);
  });

  it('kostet zufallUnter genau EIN Byte', () => {
    const z = setzeZufall(identitaet(), 0);
    z.cursor[0] = 100;
    expect(zufallUnter(z, 100)).toBe((100 * 100) >> 8);
    expect(z.cursor[0]).toBe(101);
  });

  it('kostet naechste16 ZWEI Bytes und wechselt sieben von acht Malen die Bank', () => {
    const z = setzeZufall(identitaet(), 0);
    // Erster Aufruf: rand16Counter & 7 === 0 → KEIN Bankwechsel.
    naechste16(z);
    expect(z.bank).toBe(0);
    expect(z.cursor[0]).toBe(2);
    // Die folgenden sieben wechseln jeweils.
    let banks = 0;
    for (let i = 0; i < 7; i++) {
      const vorher = z.bank;
      naechste16(z);
      if (z.bank !== vorher) banks++;
    }
    expect(banks).toBe(7);
    // Der neunte fällt wieder auf n === 0.
    const vorher = z.bank;
    naechste16(z);
    expect(z.bank).toBe(vorher);
  });

  it('bleibt bei wurf1bis100 im Bereich 1…100', () => {
    const z = setzeZufall(identitaet(), 0);
    let min = 101;
    let max = 0;
    for (let i = 0; i < 2000; i++) {
      const w = wurf1bis100(z);
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(100);
  });

  it('erreicht die 100 nur bei vollem 16-Bit-Wert — der Schiefstand des Originals', () => {
    // 0xFFFF · 99 / 0xFFFF + 1 = 100; ein Zähler darunter ergibt 99.
    expect((((Math.imul(0xffff, 0x63) | 0) / 0xffff) | 0) + 1).toBe(100);
    expect((((Math.imul(0xfffe, 0x63) | 0) / 0xffff) | 0) + 1).toBe(99);
    expect((((Math.imul(0, 0x63) | 0) / 0xffff) | 0) + 1).toBe(1);
  });

  it('setzt rand16Counter beim Neusetzen NICHT zurück — der Strom läuft weiter', () => {
    // Das Original setzt den Zähler beim Kampfbeginn bewusst nicht zurück.
    // Wir bilden das ab, indem `setzeZufall` einen frischen Zustand liefert
    // und der Aufrufer entscheidet, ob er ihn übernimmt.
    const z = setzeZufall(identitaet(), 0);
    naechste16(z);
    naechste16(z);
    expect(z.rand16Counter).toBe(2);
    const weiter = { ...setzeZufall(identitaet(), 5), rand16Counter: z.rand16Counter };
    expect(weiter.rand16Counter).toBe(2);
  });
});
