import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { REAL_DIR } from './real-pfade.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * K9 — was in den 872 `ab`/`da`-Einträgen von `battle.lgp` steht.
 *
 * **Der Anlass** ist der größte verbliebene Sichtmangel der 1.0-Demo: Alle
 * Kampffiguren stehen in der Bindpose, Arme senkrecht nach oben. Die
 * Geometrie steht (K1/K2), die Bewegung fehlt.
 *
 * **Die Hypothese** kommt aus dem eigenen EXE-Bestand: Der Kampf-Modellbank
 * hält `struct Animation *` — **dieselbe** Struktur wie die Field-`.a`-Dateien,
 * die seit S7 geparst werden. Auf der Platte wäre das:
 *
 * ```
 * 0x00 u32 version == 1
 * 0x04 u32 frameCount
 * 0x08 u32 boneCount
 * 0x0C 3 B Rotationsreihenfolge aus {0,1,2}, 1 B ungenutzt
 * 0x10..0x23 Laufzeitzeiger — auf der Platte veraltet und bedeutungslos
 * 0x24 frameCount * (0x18 + boneCount*0x0C) Byte Rahmendaten
 * ```
 *
 * **Die Gütefunktion ist das Accounting**, nicht die Plausibilität der Werte:
 * `0x24 + frameCount·(0x18 + boneCount·0x0C)` muss die Eintragslänge
 * **byteexakt** treffen. Eine Zahlenreihe kann plausibel aussehen; ein
 * Accounting kann nicht zufällig aufgehen.
 *
 * **Kontrollniveau** ist derselbe Test an einem verschobenen Kopf (±4, ±8) und
 * an den *anderen* Suffixfamilien des Archivs. Trifft er dort ähnlich oft,
 * misst er nur die Struktur des Archivs und nicht das Format.
 *
 * ⚠ **Methodischer Merkposten.** Ein erster Anlauf las `battle.lgp` mit einem
 * selbst gebauten LGP-Leser und meldete 0 von 11.119 — scheinbar ein sauberer
 * Negativbefund. Er war keiner: Derselbe Leser fand auch **0** `.p`-Dateien,
 * wo das Projekt 8979 belegt hat. Der Fehler lag im Leser, nicht in der
 * Hypothese. Deshalb läuft diese Probe über den **Projektparser** —
 * Fehlerklasse „falsche Suchmenge", diesmal rechtzeitig gesehen.
 *
 * Urheberrecht: Ausgegeben werden Zähler und Feldwerte, keine Rahmendaten.
 */

const available = existsSync(REAL_DIR);

const KOPF = 0x24;
const ROOT_FRAME = 0x18;
const BONE_FRAME = 0x0c;

interface Kopf {
  version: number;
  frames: number;
  bones: number;
  ordnung: [number, number, number];
}

function liesKopf(d: Uint8Array): Kopf | null {
  if (d.length < KOPF) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    version: dv.getUint32(0, true),
    frames: dv.getUint32(4, true),
    bones: dv.getUint32(8, true),
    ordnung: [d[0x0c]!, d[0x0d]!, d[0x0e]!],
  };
}

/** Byteexaktes Accounting der Hypothese. */
function trifftAccounting(d: Uint8Array, versatz = 0): boolean {
  const teil = versatz >= 0 ? d.subarray(versatz) : d;
  const k = liesKopf(teil);
  if (!k || k.version !== 1) return false;
  if (k.frames <= 0 || k.bones < 0) return false;
  // Ohne obere Schranke wäre die Prüfung nicht schärfer, aber ein
  // Überlauf würde sie unbrauchbar machen.
  if (k.frames > 1e6 || k.bones > 1e4) return false;
  return KOPF + k.frames * (ROOT_FRAME + k.bones * BONE_FRAME) === teil.length;
}

describe.skipIf(!available)('K9 — das Animationsformat der ab/da-Familie', () => {
  it('misst das Accounting über den ganzen Bestand, mit zwei Kontrollen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const eintraege = index.listEntries('battle');
    expect(eintraege.length).toBeGreaterThan(10000);

    const nachSuffix = new Map<string, { n: number; treffer: number }>();
    let abda = 0;
    let abdaTreffer = 0;
    const koepfe: Kopf[] = [];
    const kontrolleVersatz = new Map<number, number>([
      [-8, 0],
      [-4, 0],
      [4, 0],
      [8, 0],
    ]);

    for (const e of eintraege) {
      if (e.name.length !== 4) continue;
      const suffix = e.name.slice(2).toLowerCase();
      let bytes: Uint8Array;
      try {
        bytes = await index.readEntry(e.canonicalId);
      } catch {
        continue; // quarantänisiert — zählt nirgends mit
      }
      const eintrag = nachSuffix.get(suffix) ?? { n: 0, treffer: 0 };
      eintrag.n++;
      const trifft = trifftAccounting(bytes);
      if (trifft) eintrag.treffer++;
      nachSuffix.set(suffix, eintrag);

      if (suffix === 'ab' || suffix === 'da') {
        abda++;
        if (trifft) {
          abdaTreffer++;
          const k = liesKopf(bytes)!;
          koepfe.push(k);
        }
        for (const v of kontrolleVersatz.keys()) {
          if (v > 0 && trifftAccounting(bytes, v)) kontrolleVersatz.set(v, kontrolleVersatz.get(v)! + 1);
        }
      }
    }

    const fremd = [...nachSuffix.entries()]
      .filter(([s]) => s !== 'ab' && s !== 'da')
      .reduce((a, [, v]) => ({ n: a.n + v.n, treffer: a.treffer + v.treffer }), { n: 0, treffer: 0 });

    console.log(
      '[K9]',
      JSON.stringify({
        abda,
        abdaTreffer,
        quoteAbDa: Number((abdaTreffer / Math.max(1, abda)).toFixed(4)),
        fremdN: fremd.n,
        fremdTreffer: fremd.treffer,
        quoteFremd: Number((fremd.treffer / Math.max(1, fremd.n)).toFixed(4)),
        kontrolleVersatz: Object.fromEntries(kontrolleVersatz),
      }),
    );

    // Die Suchmenge ist die belegte: 481 `ab` + 391 `da` = 872.
    expect(abda).toBe(872);

    if (abdaTreffer === 0) {
      /**
       * NEGATIVBEFUND, ausdrücklich als solcher festgehalten. Er ist nur dann
       * etwas wert, wenn die Suchmenge stimmt — und das ist hier gesichert:
       * 872 Einträge, über den Projektparser gelesen, derselbe, der 8979
       * `.p`-Dateien im selben Archiv findet.
       *
       * Was daraus folgt: Das Kampf-Animationsformat ist **nicht** das
       * Field-`.a`-Format. Der Bestand hält im Speicher dieselbe
       * `Animation`-Struktur, aber der Weg von der Datei dorthin ist nicht die
       * Identität — es liegt eine Umsetzung dazwischen, und die ist K9s
       * eigentlicher Gegenstand.
       */
      console.log('[K9] Negativbefund: das Field-.a-Accounting trifft in der ab/da-Familie NICHT.');
      expect(abdaTreffer).toBe(0);
    } else {
      // Trifft es doch, muss es die Fremdfamilien DEUTLICH schlagen.
      expect(abdaTreffer / abda).toBeGreaterThan(3 * (fremd.treffer / Math.max(1, fremd.n)));
      expect(koepfe.every((k) => k.ordnung.every((x) => x <= 2))).toBe(true);
    }
  }, 300_000);

  it('hält fest, wie die ab/da-Einträge tatsächlich aussehen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const groessen: number[] = [];
    const ersteWorte = new Map<number, number>();
    let gelesen = 0;
    for (const e of index.listEntries('battle')) {
      const suffix = e.name.slice(2).toLowerCase();
      if (e.name.length !== 4 || (suffix !== 'ab' && suffix !== 'da')) continue;
      let bytes: Uint8Array;
      try {
        bytes = await index.readEntry(e.canonicalId);
      } catch {
        continue;
      }
      gelesen++;
      groessen.push(bytes.length);
      if (bytes.length >= 4) {
        const w = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
        ersteWorte.set(w, (ersteWorte.get(w) ?? 0) + 1);
      }
    }
    groessen.sort((a, b) => a - b);
    console.log(
      '[K9-Form]',
      JSON.stringify({
        gelesen,
        kleinste: groessen[0],
        median: groessen[Math.floor(groessen.length / 2)],
        groesste: groessen.at(-1),
        ersteWorte: [...ersteWorte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      }),
    );
    expect(gelesen).toBe(872);
    // Kein leerer Eintrag — die Familie trägt echte Nutzlast.
    expect(groessen[0]).toBeGreaterThan(0);
  }, 300_000);
});
