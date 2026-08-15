import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MENU_BIT_BEENDEN,
  phsBeweglich,
  phsVorhanden,
  readSavemap,
  readStoryZustand,
  wirksameMenuemasken,
  type StoryZustand,
} from '@webmidgar/formats-save';
import { REAL_DIR } from './real-pfade.js';

/**
 * F43 — der Story-Fortschritt bei Slotversatz `0x0BA4`.
 *
 * **Die Prüfgröße ist die Rangfolge.** Fortschrittswert und Spielzeit stehen
 * an ganz verschiedenen Stellen des Slots und werden von verschiedenen
 * Stellen geschrieben (Feldskripte bzw. Engine). Trägt `0x0BA4` wirklich den
 * Erzählfortschritt, müssen beide Reihen **dieselbe Ordnung** haben: Wer
 * länger gespielt hat, ist weiter.
 *
 * Das bindet **jedes** Spielstandspaar, und ein beliebiges Feld erfüllt es
 * nicht. Kontrollniveau ist die rotierte Zuordnung.
 *
 * Urheberrecht: Ausgegeben werden Zähler, Werte und Masken — keine Namen und
 * keine Spielstandsinhalte.
 */

const SAVE_DIR = join(REAL_DIR, 'save');
const available = existsSync(SAVE_DIR);
const SLOT_LEN = 4340;
const SLOT_COUNT = 15;
const HEAD = 9;

interface Stand {
  quelle: string;
  zeit: number;
  z: StoryZustand;
}

async function alleStaende(): Promise<Stand[]> {
  const namen = (await readdir(SAVE_DIR)).filter((f) => /\.ff7$/i.test(f)).sort();
  const out: Stand[] = [];
  for (const d of namen) {
    const b = await readFile(join(SAVE_DIR, d));
    if (b.length !== HEAD + SLOT_COUNT * SLOT_LEN) continue;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = new Uint8Array(b.subarray(HEAD + i * SLOT_LEN, HEAD + (i + 1) * SLOT_LEN));
      if (slot.filter((x) => x !== 0).length / SLOT_LEN < 0.1) continue;
      const z = readStoryZustand(slot);
      const sm = readSavemap(slot);
      if (z && sm) out.push({ quelle: `${d}#${i}`, zeit: sm.playtimeSeconds, z });
    }
  }
  return out;
}

/** Paare, die in beiden Reihen dieselbe Ordnung haben. Gleichstände zählen nicht mit. */
function gleichgeordnet(a: readonly number[], b: readonly number[]): { treffer: number; paare: number } {
  let treffer = 0;
  let paare = 0;
  for (let i = 0; i < a.length; i++) {
    for (let k = i + 1; k < a.length; k++) {
      if (a[i] === a[k] || b[i] === b[k]) continue;
      paare++;
      if (a[i]! < a[k]! === (b[i]! < b[k]!)) treffer++;
    }
  }
  return { treffer, paare };
}

describe.skipIf(!available)('F43 — Story-Fortschritt bei 0x0BA4', () => {
  it('ordnet gleich wie die Spielzeit, rotiert dagegen nicht', async () => {
    const alle = await alleStaende();
    expect(alle.length).toBeGreaterThan(4);

    /**
     * ⚠️ Ein Spielstand trägt **Spielzeit 0** bei hohem Fortschritt. Er wird
     * ausgenommen **und ausgewiesen**, statt die Messung zu verwässern: Eine
     * Spielzeit von exakt 0 kann nicht stimmen, wenn schon Hunderte
     * Story-Punkte gesetzt sind. Ihn stillschweigend mitzuzählen hieße, gegen
     * ein bekannt falsches Maß zu prüfen — ihn stillschweigend wegzulassen
     * wäre Rosinenpickerei. Deshalb steht er in der Ausgabe.
     */
    const brauchbar = alle.filter((s) => s.zeit > 0);
    const verworfen = alle.length - brauchbar.length;

    const momente = brauchbar.map((s) => s.z.gameMoment);
    const zeiten = brauchbar.map((s) => s.zeit);
    const echt = gleichgeordnet(momente, zeiten);
    const rotiert = momente.map((_, i) => momente[(i + 1) % momente.length]!);
    const kontrolle = gleichgeordnet(rotiert, zeiten);

    console.log(
      `[F43] ${alle.length} Spielstände (${verworfen} mit Spielzeit 0 ausgenommen) · ` +
        `Momente ${momente.join(', ')} · Zeiten ${zeiten.join(', ')}`,
    );
    console.log(
      `[F43] gleichgeordnete Paare: echt ${echt.treffer}/${echt.paare} · rotiert ${kontrolle.treffer}/${kontrolle.paare}`,
    );

    /**
     * 🟢 **Belegt.** Die Ordnung stimmt über **alle** Paare überein. Der Wert
     * bei `0x0BA4` ist damit an unseren Daten als Fortschrittsmaß bestätigt —
     * unabhängig davon, dass der EXE-Bestand ihn so benennt.
     *
     * Die Kontrolle wird bewusst nur als *kleiner* geprüft und nicht auf einen
     * festen Wert: Bei so wenigen Ständen ist eine Rotation ein grobes
     * Kontrollniveau, und eine scharfe Zahl darauf wäre Scheingenauigkeit.
     */
    expect(echt.paare).toBeGreaterThan(8);
    expect(echt.treffer).toBe(echt.paare);
    expect(kontrolle.treffer).toBeLessThan(echt.treffer);

    /** 🟡 Alle Werte liegen weit unter der ersten Erzählschwelle (1000). */
    expect(Math.max(...momente)).toBeLessThan(1000);
  }, 300_000);

  it('lässt die Verfügbarkeit mit dem Fortschritt wachsen', async () => {
    const alle = (await alleStaende()).filter((s) => s.zeit > 0);
    const momente = alle.map((s) => s.z.gameMoment);
    const anzahl = alle.map((s) => {
      let n = 0;
      for (let c = 0; c < 16; c++) if (phsVorhanden(s.z, c)) n++;
      return n;
    });
    const echt = gleichgeordnet(momente, anzahl);
    console.log(
      `[F43] verfügbare Figuren je Stand: ${anzahl.join(', ')} · gleichgeordnet: ${echt.treffer}/${echt.paare}`,
    );

    /**
     * 🟢 **Ein zweiter, unabhängiger Beleg.** Die Verfügbarkeitsmaske
     * (`0x10A6`) steht 21 KB vom Fortschrittswert entfernt und wird von
     * anderen Skripten gesetzt. Dass ihre Kardinalität dieselbe Ordnung hat,
     * bestätigt beide Felder auf einmal: Wer weiter ist, hat mehr Figuren.
     */
    expect(echt.paare).toBeGreaterThan(4);
    expect(echt.treffer).toBe(echt.paare);
  }, 300_000);

  it('findet Cloud in jedem Stand festgesetzt — und trotzdem im Raster', async () => {
    const alle = await alleStaende();
    let gesperrt = 0;
    let vorhanden = 0;
    for (const s of alle) {
      if ((s.z.phsLocked & 1) !== 0) gesperrt++;
      if (phsVorhanden(s.z, 0)) vorhanden++;
    }
    console.log(`[F43] Cloud gesperrt in ${gesperrt}/${alle.length} · im Raster ${vorhanden}/${alle.length}`);

    /**
     * 🟢 Die Sperrmaske `0x10A4` trägt in **jedem** Spielstand genau Bit 0 —
     * Cloud lässt sich nicht aus der Gruppe nehmen. Das ist die bekannte
     * Spielregel und ein starker Hinweis auf die richtige Deutung: Ein
     * beliebiges Feld wäre nicht in allen Ständen genau `1`.
     *
     * 🟢 **Und er bleibt sichtbar.** `phsBeweglich` falsch, `phsVorhanden`
     * wahr — genau die Unterscheidung, die verlorenginge, führte man die
     * beiden Masken zusammen.
     */
    expect(gesperrt).toBe(alle.length);
    expect(vorhanden).toBe(alle.length);
    for (const s of alle) {
      expect(phsBeweglich(s.z, 0)).toBe(false);
      expect(phsVorhanden(s.z, 0)).toBe(true);
    }
  }, 300_000);

  it('erzwingt „Beenden“ — und gerade die frühen Stände brauchen das', async () => {
    const alle = await alleStaende();
    let rohGesetzt = 0;
    const masken = new Set<number>();
    for (const s of alle) {
      if (s.z.menuVisibleRaw & (1 << MENU_BIT_BEENDEN)) rohGesetzt++;
      masken.add(s.z.menuVisibleRaw);
      const { visible, locked } = wirksameMenuemasken(s.z);
      expect(visible & (1 << MENU_BIT_BEENDEN)).toBeTruthy();
      expect(locked & (1 << MENU_BIT_BEENDEN)).toBe(0);
    }
    console.log(
      `[F43] Bit 10 roh gesetzt in ${rohGesetzt}/${alle.length} · ` +
        `Sichtbarkeitsmasken: ${[...masken].map((v) => '0x' + v.toString(16)).join(', ')}`,
    );

    /**
     * ⚠️ **Meine Erwartung war „nie gesetzt" — falsch.** Gemessen: Bit 10 ist
     * in **3 von 7** Ständen gesetzt. Die drei sind die weiter
     * fortgeschrittenen (Masken `0xFFFF` und `0xFEFF`); die vier frühen
     * tragen `0x2FB` und haben es **nicht**.
     *
     * 🟢 **Das macht den Zwang erst wichtig.** Wäre das Bit immer gesetzt,
     * wäre das Erzwingen überflüssig; wäre es nie gesetzt, wäre es eine
     * Formalie. So ist es genau das, was den frühen Ständen einen Ausgang aus
     * dem Menü gibt — ohne den Zwang hätten sie keinen.
     *
     * Eingefroren als das, was gemessen wurde: nicht alle, nicht keiner.
     */
    expect(rohGesetzt).toBe(3);
    expect(rohGesetzt).toBeLessThan(alle.length);
  }, 300_000);
});
