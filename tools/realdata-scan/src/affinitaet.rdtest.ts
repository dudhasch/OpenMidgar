import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseSceneBin } from '@webmidgar/formats-battle';
import { baueAffinitaetstabelle, falteAffinitaet } from '@webmidgar/battle-runtime';
import { realPfad } from './real-pfade.js';

/**
 * Die Elementaraffinitäten der Gegner an **unseren** Daten.
 *
 * **Die Prüfgröße steckt in der Bytezerlegung.** Der Gegnerrecord trägt acht
 * Paare: eine Kennung bei `+0x28+i` und einen Affinitätscode bei `+0x30+i`.
 * Die Kennung ist **kein** Bitindex, sondern zwei Felder in einem Byte —
 * `id >> 5` wählt die Hälfte (0 = Element, 1 = Status), `id & 0x1F` das Bit.
 *
 * Daraus folgen zwei scharfe Vorhersagen, beide über 256 mögliche Bytewerte:
 *
 * 1. Jede belegte Kennung ist **< 64** (sonst zeigte `id >> 5` auf einen
 *    Platz jenseits der 16), oder `0xFF` als Leermarker.
 * 2. Jeder Code ist **≤ 7** (es gibt nur acht Affinitätsplätze je Hälfte).
 *
 * Läge eines der beiden Felder anderswo, wäre das über hunderte Gegner fast
 * sicher verletzt — Bytes an falscher Stelle sind selten so brav.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Wertebereiche.
 */

const SCENE = realPfad('battle/scene.bin');
const available = existsSync(SCENE);

const AFF_ID_OFF = 0x28;
const AFF_CODE_OFF = 0x30;
const AFF_PAARE = 8;

describe.skipIf(!available)('Elementaraffinitäten der Gegner', () => {
  it('hält Kennungen und Codes in den Bereichen, die die Zerlegung verlangt', async () => {
    const container = await parseSceneBin(await readFile(SCENE), 'scene.bin');
    const gesehen = new Set<number>();
    const codes = new Map<number, number>();
    let paare = 0;
    let belegt = 0;
    let idZuGross = 0;
    let codeZuGross = 0;
    let statushaelfte = 0;
    let maxId = 0;

    for (const scene of container.scenes) {
      if (!scene) continue;
      for (let slot = 0; slot < scene.enemyTypeIds.length; slot++) {
        const typ = scene.enemyTypeIds[slot]!;
        if (typ === 0xffff || gesehen.has(typ)) continue;
        const rec = scene.enemies[slot];
        if (!rec || rec.hp === 0 || rec.hp === 0xffffffff) continue;
        gesehen.add(typ);
        for (let i = 0; i < AFF_PAARE; i++) {
          paare++;
          const id = rec.raw[AFF_ID_OFF + i]!;
          const code = rec.raw[AFF_CODE_OFF + i]!;
          if (id === 0xff) continue;
          belegt++;
          maxId = Math.max(maxId, id);
          if (id >= 64) idZuGross++;
          if (id >> 5 === 1) statushaelfte++;
          if (code > 7) codeZuGross++;
          codes.set(code, (codes.get(code) ?? 0) + 1);
        }
      }
    }

    console.log(
      `[AFF] ${gesehen.size} Gegnertypen · ${paare} Paare · ${belegt} belegt · größte Kennung ${maxId} · ` +
        `Statushälfte ${statushaelfte} · Kennung ≥ 64: ${idZuGross} · Code > 7: ${codeZuGross}`,
    );
    console.log(
      '[AFF] Affinitätscodes:',
      [...codes.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c}×${n}`).join(', '),
    );

    /**
     * 🟢 Beide Vorhersagen halten. Damit sitzen **zwei** Feldversätze richtig
     * (`+0x28` und `+0x30`) **und** die Zerlegung des Kennungsbytes ist
     * bestätigt: Wäre `id` ein glatter Bitindex, gäbe es keinen Grund für die
     * scharfe Grenze bei 64.
     */
    expect(gesehen.size).toBeGreaterThan(300);
    expect(belegt).toBeGreaterThan(100);
    expect(idZuGross).toBe(0);
    expect(codeZuGross).toBe(0);

    /**
     * 🟢 **Welche Codes der Bestand wirklich benutzt** — und das trifft eine
     * offene Frage aus dem Modul. Dort sind die Codes 1 und 3 bewusst
     * **unbenannt** geblieben, weil ihre Wirkung aus dem gelesenen Abschnitt
     * nicht hervorging. Gemessen kommen vor:
     *
     * ```
     * 0 Soforttod · 1 (unbenannt) · 2 Schwäche · 4 Halbierung
     * 5 Nichtigkeit · 6 Absorption
     * ```
     *
     * **Code 3 und Code 7 kommen als Gegneraffinität überhaupt nicht vor.**
     * Die Lücke bei 3 ist damit keine Wissenslücke von uns, sondern eine des
     * Bestands: Es gibt schlicht kein Beispiel. Code 7 (volle Wiederherstellung)
     * erreicht ein Gegner nur über den Umweg von Formel `0x08`.
     *
     * Eingefroren — taucht Code 3 je auf, gibt es zum ersten Mal etwas zu
     * deuten.
     */
    expect([...codes.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6]);
  }, 300_000);

  it('faltet die Tabelle eines echten Gegners zu einer Reaktion', async () => {
    const container = await parseSceneBin(await readFile(SCENE), 'scene.bin');
    let geprueft = 0;
    let mitReaktion = 0;
    let ohneSonderflag = 0;
    const gesehen = new Set<number>();

    for (const scene of container.scenes) {
      if (!scene) continue;
      for (let slot = 0; slot < scene.enemyTypeIds.length; slot++) {
        const typ = scene.enemyTypeIds[slot]!;
        if (typ === 0xffff || gesehen.has(typ)) continue;
        const rec = scene.enemies[slot];
        if (!rec || rec.hp === 0 || rec.hp === 0xffffffff) continue;
        gesehen.add(typ);

        const paare = [];
        for (let i = 0; i < AFF_PAARE; i++) {
          paare.push({ id: rec.raw[AFF_ID_OFF + i]!, code: rec.raw[AFF_CODE_OFF + i]! });
        }
        // Ein Angriff, der alle Elemente trägt: Er zieht jede Elementaffinität.
        const t = baueAffinitaetstabelle({ attackElementMask: 0xffff, statusChangeMask: 0, gegner: paare });
        geprueft++;
        if (falteAffinitaet(t, 16, 0x0080) !== 0) mitReaktion++;
        if (falteAffinitaet(t, 16, 0x0000) !== 0) ohneSonderflag++;
      }
    }

    console.log(`[AFF] ${geprueft} Gegner · mit Reaktion auf einen Allelementangriff: ${mitReaktion}`);

    /**
     * 🟢 Zwei Aussagen auf einmal: Ein nennenswerter Teil der Gegner reagiert
     * überhaupt auf Elemente (die Tabelle ist also nicht leer), und **ohne
     * Sonderflag `0x0080` reagiert kein einziger** — der Angriff ignoriert
     * Affinitäten dann vollständig. Das ist die Wirkung, die der Bestand
     * beschreibt, hier über den ganzen Gegnerbestand nachgerechnet.
     */
    expect(geprueft).toBeGreaterThan(300);
    expect(mitReaktion).toBeGreaterThan(50);
    expect(ohneSonderflag).toBe(0);
  }, 300_000);
});
