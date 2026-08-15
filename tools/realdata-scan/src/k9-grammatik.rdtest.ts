import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseBattleSkeleton } from '@webmidgar/formats-battle';
import { REAL_DIR } from './real-pfade.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * K9, zweiter Anlauf — die Grammatik aus den Dateien selbst.
 *
 * Der erste Anlauf hat das Field-`.a`-Format ausgeschlossen (0 von 872,
 * `k9-anim-probe`). Diese Probe sucht die Felder des Kopfes, und zwar **nicht**
 * über Plausibilität, sondern über eine **externe Prüfgröße**:
 *
 * > Die Knochenzahl eines Modells steht im **Skelett** (`<präfix>aa`,
 * > `n = u32@12`, 481/481 belegt) — also in einer **anderen Datei**. Trägt die
 * > Animationsdatei desselben Präfixes diese Zahl an fester Stelle, kann das
 * > kein Zufall sein: Ein falscher Versatz kennt die Zahl nicht.
 *
 * **Das Kontrollniveau ist die verwürfelte Paarung.** Dieselbe Messung mit der
 * Animation des einen und dem Skelett eines *anderen* Präfixes. Trifft sie
 * dort ähnlich oft, misst der Versatz nur den Wertebereich kleiner Zahlen und
 * nicht die Knochenzahl — genau der Fehler, den dieses Projekt als „blinde
 * Gütefunktion" führt.
 *
 * Urheberrecht: Ausgegeben werden Versätze, Zähler und Quoten.
 */

const available = existsSync(REAL_DIR);

interface Paar {
  prefix: string;
  bones: number;
  anim: Uint8Array;
  suffix: string;
}

async function sammle(): Promise<Paar[]> {
  const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
  const index = new IndexService();
  await index.openSource(dir, { deep: false });

  const nachName = new Map<string, string>(); // name -> canonicalId
  for (const e of index.listEntries('battle')) {
    if (e.name.length === 4) nachName.set(e.name.toLowerCase(), e.canonicalId);
  }
  const lies = async (name: string): Promise<Uint8Array | null> => {
    const id = nachName.get(name);
    if (!id) return null;
    try {
      return await index.readEntry(id);
    } catch {
      return null;
    }
  };

  const paare: Paar[] = [];
  const praefixe = new Set([...nachName.keys()].map((n) => n.slice(0, 2)));
  for (const p of [...praefixe].sort()) {
    const skelRoh = await lies(`${p}aa`);
    if (!skelRoh) continue;
    const { skeleton } = parseBattleSkeleton(skelRoh, `${p}aa`);
    if (!skeleton) continue;
    for (const suffix of ['ab', 'da']) {
      const anim = await lies(p + suffix);
      if (anim && anim.length >= 16) paare.push({ prefix: p, bones: skeleton.boneCount, anim, suffix });
    }
  }
  await dir.closeAll();
  return paare;
}

/** Wie oft steht `wert` als u32 bzw. u16 an Versatz `off`? */
function trefferAnVersatz(paare: Paar[], off: number, breite: 2 | 4, werte: number[]): number {
  let n = 0;
  for (let i = 0; i < paare.length; i++) {
    const b = paare[i]!.anim;
    if (off + breite > b.length) continue;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const v = breite === 4 ? dv.getUint32(off, true) : dv.getUint16(off, true);
    if (v === werte[i]) n++;
  }
  return n;
}

describe.skipIf(!available)('K9 — Kopfgrammatik der ab/da-Familie', () => {
  it('sucht die Knochenzahl an fester Stelle, gegen verwürfelte Paarung', async () => {
    const paare = await sammle();
    console.log(`[K9-G] ${paare.length} Paare (Animation + Skelett desselben Präfixes)`);
    expect(paare.length).toBeGreaterThan(400);

    const echt = paare.map((p) => p.bones);
    // Kontrolle: Knochenzahlen um eine Stelle rotiert — gleiche Verteilung,
    // falsche Zuordnung. Das ist die schärfere Kontrolle als Zufallszahlen.
    const verwuerfelt = echt.map((_, i) => echt[(i + 1) % echt.length]!);

    const befunde: { off: number; breite: 2 | 4; echt: number; kontrolle: number; versatz: number }[] = [];
    const maxOff = 64;
    for (const breite of [2, 4] as const) {
      for (let off = 0; off + breite <= maxOff; off++) {
        const e = trefferAnVersatz(paare, off, breite, echt);
        const k = trefferAnVersatz(paare, off, breite, verwuerfelt);
        if (e > 0) befunde.push({ off, breite, echt: e, kontrolle: k, versatz: 0 });
      }
    }
    /**
     * ⚠ Ein erster Durchlauf prüfte nur `wert === boneCount` und fand nichts.
     * Das war zu eng: Ein Kopf kann die Knochenzahl **verschoben** führen —
     * `n+1` etwa, wenn die Wurzel mitgezählt wird. Deshalb laufen hier alle
     * Verschiebungen −2…+2 mit, jede mit eigener Kontrolle. Derselbe
     * Fehlertyp wie bei F15: eine Kandidatenmenge, die den richtigen Wert
     * nicht enthält, erzeugt einen sauberen Negativbefund.
     */
    for (const d of [-2, -1, 1, 2]) {
      const e2 = echt.map((v) => v + d);
      const k2 = verwuerfelt.map((v) => v + d);
      for (const breite of [2, 4] as const) {
        for (let off = 0; off + breite <= maxOff; off++) {
          const e = trefferAnVersatz(paare, off, breite, e2);
          const k = trefferAnVersatz(paare, off, breite, k2);
          if (e > 0) befunde.push({ off, breite, echt: e, kontrolle: k, versatz: d });
        }
      }
    }
    befunde.sort((a, b) => b.echt - a.echt);
    console.log(
      '[K9-G] Versätze mit Treffern (Top 8):',
      befunde
        .slice(0, 8)
        .map((b) => `+0x${b.off.toString(16)}/u${b.breite * 8}${b.versatz ? (b.versatz > 0 ? '+' : '') + b.versatz : ''}: ${b.echt}/${paare.length} (Kontrolle ${b.kontrolle})`)
        .join(' · '),
    );

    /**
     * Die Gesamtquote von 383/782 ist irreführend — sie mittelt über ZWEI
     * Formate. `ab` und `da` sind nachweislich verschieden (Größen 372…1692 B
     * gegen 68…54.584 B), also wird getrennt ausgewertet. Eine Quote über eine
     * gemischte Menge ist keine Quote.
     */
    for (const suffix of ['ab', 'da'] as const) {
      const sub = paare.filter((p) => p.suffix === suffix);
      const e = sub.map((p) => p.bones + 1);
      const k = sub.map((_, i) => sub[(i + 1) % sub.length]!.bones + 1);
      const treffer = trefferAnVersatz(sub, 4, 4, e);
      const kontrolle = trefferAnVersatz(sub, 4, 4, k);
      console.log(
        `[K9-G] ${suffix} · u32@4 == Knochen+1: ${treffer}/${sub.length} ` +
          `(${((100 * treffer) / sub.length).toFixed(1)} %), Kontrolle ${kontrolle} ` +
          `(${((100 * kontrolle) / sub.length).toFixed(1)} %)`,
      );
      if (suffix === 'da') {
        /**
         * 🟢 **`da`: u32@4 ist die Knochenzahl + 1.** Die „+1" ist die Wurzel:
         * Das Skelett zählt `n` Knochen, die Animation `n` Gelenke plus den
         * Wurzelrahmen. Die Prüfgröße stammt aus einer **anderen Datei**
         * (`<präfix>aa`), die verwürfelte Paarung fällt deutlich ab.
         *
         * Die 98 % hier sind der Wert über den GESAMTEN `da`-Bestand. Getrennt
         * nach Knochenzahl gilt die Regel für `n > 1` **ausnahmslos**
         * (378/378); die Abweichungen liegen alle im Einknochenfall — s. den
         * Fall „erklärt die acht Ausreißer".
         */
        expect(treffer / sub.length).toBeGreaterThan(0.95);
        expect(treffer).toBeGreaterThan(3 * kontrolle);
      } else {
        // `ab` trägt die Zahl an dieser Stelle NICHT — anderes Format.
        expect(treffer / sub.length).toBeLessThan(0.1);
      }
    }
  }, 300_000);

  it('erklärt die acht Ausreißer, statt sie als Rauschen abzutun', async () => {
    const alle = await sammle();
    const da = alle.filter((p) => p.suffix === 'da');
    const u32 = (b: Uint8Array, o: number): number =>
      new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);

    const ausreisser = da.filter((p) => u32(p.anim, 4) !== p.bones + 1);
    console.log(`[K9-X] ${ausreisser.length} von ${da.length} da-Dateien tragen nicht n+1`);

    /** Alle Knochenzahlen des Bestands — für die Frage „passt ein ANDERES Skelett?" */
    const alleBones = new Set(alle.map((p) => p.bones));

    for (const p of ausreisser) {
      const wert = u32(p.anim, 4);
      const kopf = [0, 4, 8, 12].map((o) => u32(p.anim, o));
      const passtAnderswo = alleBones.has(wert - 1);
      console.log(
        `[K9-X]   ${p.prefix}da: Skelett ${p.bones} Knochen ⇒ erwartet ${p.bones + 1}, gelesen ${wert}` +
          ` · Kopf [${kopf.join(', ')}] · Länge ${p.anim.length} B` +
          ` · ${wert - 1} kommt als Knochenzahl ${passtAnderswo ? 'VOR' : 'nicht vor'}`,
      );
    }

    /**
     * 🟢 **Die Ausreißer haben ausnahmslos ein Einknochen-Skelett — und das
     * schärft die Regel, statt sie aufzuweichen.**
     *
     * Getrennt nach Knochenzahl:
     *  - `n > 1`: **378 von 378**, ausnahmslos `n+1`. Die vorher berichteten
     *    98 % waren ein Artefakt der Vermischung mit dem entarteten Fall.
     *  - `n == 1`: 13 Dateien, davon lesen **8 den Wert 1 und 5 den Wert 2**.
     *
     * ⚠ Die naheliegende Erklärung „bei einem Knochen gibt es keine Gelenkkette,
     * also nur der Wurzelrahmen" wurde von dieser Messung **widerlegt**: Sie
     * würde 13 von 13 vorhersagen, gemessen sind 8. Der Einknochenfall bleibt
     * damit offen — aber er ist ein *benannter* Sonderfall über 13 Dateien und
     * kein Rauschen über 391.
     */
    const einknochen = da.filter((p) => p.bones === 1);
    const einknochenLesen1 = einknochen.filter((p) => u32(p.anim, 4) === 1);
    const mehrknochen = da.filter((p) => p.bones > 1);
    const mehrknochenRegel = mehrknochen.filter((p) => u32(p.anim, 4) === p.bones + 1);
    console.log(
      `[K9-X] n == 1: ${einknochen.length} Dateien, davon lesen ${einknochenLesen1.length} den Wert 1 ` +
        `und ${einknochen.length - einknochenLesen1.length} den Wert 2`,
    );
    console.log(
      `[K9-X] n > 1: ${mehrknochen.length} Dateien, davon ${mehrknochenRegel.length} = n+1 ` +
        `(${((100 * mehrknochenRegel.length) / mehrknochen.length).toFixed(1)} %)`,
    );

    // Jeder Ausreißer hat n == 1 — die Regel bricht NUR im entarteten Fall.
    expect(ausreisser.every((p) => p.bones === 1)).toBe(true);
    /** 🟢 Für `n > 1` gilt sie ausnahmslos. Das ist der eigentliche Befund. */
    expect(mehrknochenRegel.length).toBe(mehrknochen.length);
    /**
     * DAUERBEFUND für den offenen Sonderfall: die 8/5-Spaltung. Ändert sie
     * sich, ist der Einknochenfall verstanden oder der Bestand ein anderer —
     * beides wäre eine Nachricht.
     */
    expect(einknochen.length).toBe(13);
    expect(einknochenLesen1.length).toBe(8);
  }, 300_000);

  it('sucht ein Accounting über die Gelenkzahl und findet keines', async () => {
    const paare = (await sammle()).filter((p) => p.suffix === 'da');
    const gelenke = (p: Paar): number => p.bones + 1;

    /**
     * Naheliegend nach dem Kopffund: Wenn `n+1` Gelenke je Rahmen dieselbe
     * Zahl Bytes belegen, muss `(Länge − Kopf)` durch `(n+1)·k` teilbar sein.
     * Geprüft werden Kopfgrößen 8…32 und Bytes je Gelenk 1…12.
     */
    const treffer: string[] = [];
    for (let kopf = 8; kopf <= 32; kopf += 4) {
      for (let k = 1; k <= 12; k++) {
        let n = 0;
        for (const p of paare) {
          const rest = p.anim.length - kopf;
          if (rest > 0 && rest % (gelenke(p) * k) === 0) n++;
        }
        if (n / paare.length > 0.5) treffer.push(`Kopf ${kopf}, ${k} B/Gelenk: ${n}/${paare.length}`);
      }
    }
    console.log('[K9-A] Accounting-Kandidaten über 50 %:', treffer.length ? treffer.join(' · ') : '— keiner —');

    /**
     * DAUERBEFUND, absichtlich als Erwartung formuliert: **Es gibt kein festes
     * Byteraster je Gelenk.** Das ist der stärkste Hinweis darauf, dass die
     * Rahmendaten **bitgepackt** sind — bei variabler Bitbreite kann kein
     * Byte-Accounting aufgehen, und genau deshalb hat auch das Field-Format
     * nicht gepasst (dort sind es feste 12 B je Knochen).
     *
     * Schlägt diese Erwartung eines Tages fehl, ist das die gute Nachricht:
     * Dann gibt es doch ein Raster, und K9 wird ein Accounting-Problem statt
     * eines Bitstromproblems.
     */
    expect(treffer.length).toBe(0);
  }, 300_000);

  it('kartiert den Kopf: welche Versätze sind überhaupt konstant oder klein', async () => {
    const paare = await sammle();
    const N = 32;
    const zeilen: string[] = [];
    for (let off = 0; off + 4 <= N; off += 4) {
      const werte = new Map<number, number>();
      for (const p of paare) {
        const dv = new DataView(p.anim.buffer, p.anim.byteOffset, p.anim.byteLength);
        const v = dv.getUint32(off, true);
        werte.set(v, (werte.get(v) ?? 0) + 1);
      }
      const top = [...werte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const max = Math.max(...werte.keys());
      zeilen.push(
        `+0x${off.toString(16).padStart(2, '0')}: ${werte.size} verschiedene, max ${max}, häufigste ` +
          top.map(([v, n]) => `${v}×${n}`).join(', '),
      );
    }
    console.log('[K9-K] u32-Karte des Kopfes:\n  ' + zeilen.join('\n  '));

    // Und dieselbe Karte als u16, weil ein Rahmen-/Knochenzähler dort passen könnte.
    const zeilen16: string[] = [];
    for (let off = 0; off + 2 <= 16; off += 2) {
      const werte = new Map<number, number>();
      for (const p of paare) {
        const dv = new DataView(p.anim.buffer, p.anim.byteOffset, p.anim.byteLength);
        const v = dv.getUint16(off, true);
        werte.set(v, (werte.get(v) ?? 0) + 1);
      }
      const top = [...werte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      zeilen16.push(
        `+0x${off.toString(16).padStart(2, '0')}: ${werte.size} verschiedene, max ${Math.max(...werte.keys())}, häufigste ` +
          top.map(([v, n]) => `${v}×${n}`).join(', '),
      );
    }
    console.log('[K9-K] u16-Karte:\n  ' + zeilen16.join('\n  '));
    expect(paare.length).toBeGreaterThan(400);
  }, 300_000);

  it('misst den Zusammenhang zwischen Dateigröße und Knochenzahl', async () => {
    const paare = await sammle();
    const n = paare.length;
    const mx = paare.reduce((a, p) => a + p.bones, 0) / n;
    const my = paare.reduce((a, p) => a + p.anim.length, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const p of paare) {
      sxy += (p.bones - mx) * (p.anim.length - my);
      sxx += (p.bones - mx) ** 2;
      syy += (p.anim.length - my) ** 2;
    }
    const r = sxy / Math.sqrt(sxx * syy);
    console.log(`[K9-S] ${n} Paare, Korrelation Größe~Knochenzahl = ${r.toFixed(3)}`);

    for (const suffix of ['ab', 'da']) {
      const sub = paare.filter((p) => p.suffix === suffix);
      const bones = sub.map((p) => p.bones);
      const laengen = sub.map((p) => p.anim.length);
      console.log(
        `[K9-S] ${suffix}: ${sub.length} Dateien · Knochen ${Math.min(...bones)}…${Math.max(...bones)} · ` +
          `Größe ${Math.min(...laengen)}…${Math.max(...laengen)} B`,
      );
    }

    // Hexdump dreier Dateien mit sehr verschiedener Knochenzahl — die Form
    // sieht man am Bytebild, nicht an Kennzahlen.
    const sortiert = [...paare].sort((a, b) => a.bones - b.bones);
    for (const p of [sortiert[0]!, sortiert[Math.floor(n / 2)]!, sortiert.at(-1)!]) {
      const hex = [...p.anim.subarray(0, 32)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
      console.log(`[K9-S] ${p.prefix}${p.suffix} bones=${p.bones} len=${p.anim.length}\n[K9-S]   ${hex}`);
    }
    expect(n).toBeGreaterThan(400);
  }, 300_000);
});
