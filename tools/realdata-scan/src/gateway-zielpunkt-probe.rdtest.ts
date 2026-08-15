import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry, parseMaplist, resolveMaplistTarget } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * Gateway-**Zielpunkt** (F15, Anschlussmessung an die Linienprobe).
 *
 * **Woher die Hypothese kommt.** Die Linienprobe hat zwei Dinge gezeigt:
 * Der Punkt an @2/@4 liegt im begehbaren Netz des **eigenen** Fields
 * (85,5 % gegen 27,0 % Fremdfeld-Kontrolle), und für einen *zweiten* Punkt im
 * eigenen Netz gibt es an keinem Versatz einen Beleg — @8 liegt mit 36,8 %
 * sogar unter seiner Kontrolle (43,0 %). Ein Wert, der im eigenen Netz
 * *nicht* liegt, aber wie eine Koordinate aussieht, hat einen naheliegenden
 * Grund: **Er gehört in ein anderes Field.**
 *
 * **Scharfe Vorhersage.** `(x@8, y@10)` liegt im Walkmesh des **Zielfields**,
 * das `destMaplistIndex` (@14, bereits belegt) benennt.
 *
 * **Kontrollniveau, dreifach** — ohne das wäre die Quote wertlos, weil Fields
 * ähnliche Wertebereiche haben:
 *  1. **Nachbarfield**: derselbe Punkt gegen das Netz des Maplist-Nachbarn,
 *  2. **eigenes Field**: derselbe Punkt gegen das Netz des Ausgangsfields,
 *  3. **verschobene Zuordnung**: der Punkt des nächsten Gateways gegen dasselbe
 *     Zielfield.
 *
 * **Warum das der Posten aus S11 ist.** Dort wurde festgehalten, der Zielpunkt
 * stehe *nicht* im Record — geprüft worden waren aber nur die Versätze @12,
 * @16 und @18. @8 war nie in der Kandidatenmenge.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

function imNetz(tris: Int32Array, px: number, py: number): boolean {
  for (let i = 0; i < tris.length; i += 6) {
    const ax = tris[i]!, ay = tris[i + 1]!;
    const bx = tris[i + 2]!, by = tris[i + 3]!;
    const cx = tris[i + 4]!, cy = tris[i + 5]!;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
}

describe.skipIf(!available)('Realdaten: Zielpunkt im Gateway-Record', () => {
  it(
    'prüft (x@8, y@10) gegen das Walkmesh des Zielfields',
    { timeout: 900_000 },
    async () => {
      const index = new IndexService();
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      await index.openSource(dir, { deep: false });

      const maplistBytes = await index.readEntry('lgp:flevel/maplist');
      const maplistDiag: Parameters<typeof parseMaplist>[2] = [];
      const maplist = parseMaplist(maplistBytes, 'maplist', maplistDiag);
      expect(maplist).not.toBeNull();
      if (!maplist) return;
      expect(maplist.names.length).toBeGreaterThan(700);

      const netze = new Map<string, Int32Array>();
      const gateways: { von: string; ziel: number; raw: Uint8Array }[] = [];

      for (const eintrag of index.listEntries('flevel')) {
        if (eintrag.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(eintrag.canonicalId), eintrag.name);
        } catch {
          continue;
        }
        const b = parsed.ok ? parsed.bundle : null;
        if (!b?.walkmesh) continue;
        const tris = new Int32Array(b.walkmesh.triangles.length * 6);
        b.walkmesh.triangles.forEach((t, i) => {
          for (let k = 0; k < 3; k++) {
            tris[i * 6 + k * 2] = t.vertices[k]![0];
            tris[i * 6 + k * 2 + 1] = t.vertices[k]![1];
          }
        });
        netze.set(eintrag.name, tris);
        for (const g of b.triggers?.gateways ?? []) {
          if (g.used) gateways.push({ von: eintrag.name, ziel: g.destMaplistIndex, raw: g.raw });
        }
      }
      await dir.closeAll();

      const i16 = (r: Uint8Array, at: number): number => {
        const v = r[at]! | (r[at + 1]! << 8);
        return v > 0x7fff ? v - 0x10000 : v;
      };

      let auflösbar = 0;
      const zaehler = { regel: 0, nachbarfield: 0, eigenesField: 0, verschoben: 0 };

      gateways.forEach((g, i) => {
        const zielName = resolveMaplistTarget(maplist, g.ziel);
        const nachbarName = resolveMaplistTarget(maplist, g.ziel + 1);
        const ziel = zielName ? netze.get(zielName) : undefined;
        if (!ziel) return;
        auflösbar++;
        const px = i16(g.raw, 8);
        const py = i16(g.raw, 10);
        if (imNetz(ziel, px, py)) zaehler.regel++;
        const nachbar = nachbarName ? netze.get(nachbarName) : undefined;
        if (nachbar && imNetz(nachbar, px, py)) zaehler.nachbarfield++;
        const eigen = netze.get(g.von);
        if (eigen && imNetz(eigen, px, py)) zaehler.eigenesField++;
        const anderes = gateways[(i + 1) % gateways.length]!;
        if (imNetz(ziel, i16(anderes.raw, 8), i16(anderes.raw, 10))) zaehler.verschoben++;
      });

      const p = (n: number): string => `${((n / auflösbar) * 100).toFixed(1)} % (${n}/${auflösbar})`;
      console.log(
        JSON.stringify(
          {
            gateways: gateways.length,
            auflösbar,
            'Regel (x@8,y@10) im Zielfield': p(zaehler.regel),
            'Kontrolle Maplist-Nachbar': p(zaehler.nachbarfield),
            'Kontrolle eigenes Field': p(zaehler.eigenesField),
            'Kontrolle verschobene Zuordnung': p(zaehler.verschoben),
          },
          null,
          1,
        ),
      );

      /**
       * Anschlussfrage: Was steht an @0 und @6? In `md1stin` tragen beide den
       * Wert 353 — zu klein für eine Koordinate dieses Fields, aber genau die
       * Größenordnung einer **Dreiecksnummer**. Scharfe Vorhersage: Der
       * Zielpunkt liegt im Dreieck Nr. @6 des Zielfields, der Austrittspunkt im
       * Dreieck Nr. @0 des eigenen Fields.
       *
       * Kontrolle ist das **Nachbardreieck** (Nummer + 1). Das ist die harte
       * Kontrolle: Nachbardreiecke grenzen aneinander, eine Verwechslung wäre
       * also gerade nicht auszuschließen — trifft die Regel trotzdem deutlich
       * besser, sitzt die Nummer.
       */
      const dreieck = { zielRegel: 0, zielKontrolle: 0, ausRegel: 0, ausKontrolle: 0, grund: 0 };
      const inDreieck = (tris: Int32Array, nr: number, px: number, py: number): boolean => {
        const i = nr * 6;
        if (i < 0 || i + 6 > tris.length) return false;
        return imNetz(tris.subarray(i, i + 6), px, py);
      };
      for (const g of gateways) {
        const zielName = resolveMaplistTarget(maplist, g.ziel);
        const ziel = zielName ? netze.get(zielName) : undefined;
        const eigen = netze.get(g.von);
        if (!ziel || !eigen) continue;
        dreieck.grund++;
        const zx = i16(g.raw, 8);
        const zy = i16(g.raw, 10);
        if (inDreieck(ziel, i16(g.raw, 6), zx, zy)) dreieck.zielRegel++;
        if (inDreieck(ziel, i16(g.raw, 6) + 1, zx, zy)) dreieck.zielKontrolle++;
        const ax = i16(g.raw, 2);
        const ay = i16(g.raw, 4);
        if (inDreieck(eigen, i16(g.raw, 0), ax, ay)) dreieck.ausRegel++;
        if (inDreieck(eigen, i16(g.raw, 0) + 1, ax, ay)) dreieck.ausKontrolle++;
      }
      const d = (n: number): string =>
        `${((n / dreieck.grund) * 100).toFixed(1)} % (${n}/${dreieck.grund})`;
      console.log(
        JSON.stringify(
          {
            'Zielpunkt in Dreieck @6 des Zielfields': d(dreieck.zielRegel),
            'Kontrolle Nachbardreieck @6+1': d(dreieck.zielKontrolle),
            'Austrittspunkt in Dreieck @0 des eigenen Fields': d(dreieck.ausRegel),
            'Kontrolle Nachbardreieck @0+1': d(dreieck.ausKontrolle),
          },
          null,
          1,
        ),
      );

      /**
       * Kohärenzprobe über das **Gegen-Gateway**: Wo A nach B führt, führt in
       * 78,8 % der Fälle ein Gateway von B zurück nach A. Dann muss gelten:
       * Der Zielpunkt von A (@8/@10, oben belegt) liegt **nahe am
       * Austrittspunkt** des Gegen-Gateways (@2/@4) — man kommt dort an, wo man
       * hinausginge. Das prüft beide Deutungen gegeneinander, ohne eine dritte
       * Annahme einzuführen.
       *
       * Kontrolle: der Abstand zu einem **anderen** Gateway desselben
       * Zielfields.
       */
      const paar = { nah: [] as number[], kontrolle: [] as number[] };
      const proField = new Map<string, { ziel: number; raw: Uint8Array }[]>();
      for (const g of gateways) {
        const liste = proField.get(g.von) ?? [];
        liste.push({ ziel: g.ziel, raw: g.raw });
        proField.set(g.von, liste);
      }
      const maplistIndexVon = new Map<string, number>();
      maplist.names.forEach((n, i) => {
        if (!maplistIndexVon.has(n)) maplistIndexVon.set(n, i);
      });
      for (const g of gateways) {
        const zielName = resolveMaplistTarget(maplist, g.ziel);
        const zurueck = zielName ? proField.get(zielName) : undefined;
        const eigenerIndex = maplistIndexVon.get(g.von);
        if (!zurueck || eigenerIndex === undefined) continue;
        const gegen = zurueck.find((x) => x.ziel === eigenerIndex);
        if (!gegen) continue;
        const zx = i16(g.raw, 8);
        const zy = i16(g.raw, 10);
        paar.nah.push(Math.hypot(i16(gegen.raw, 2) - zx, i16(gegen.raw, 4) - zy));
        const anderes = zurueck.find((x) => x !== gegen);
        if (anderes) {
          paar.kontrolle.push(Math.hypot(i16(anderes.raw, 2) - zx, i16(anderes.raw, 4) - zy));
        }
      }
      const med = (a: number[]): number =>
        a.length ? Math.round([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!) : -1;
      const anteil = (a: number[], grenze: number): string =>
        a.length ? `${((a.filter((x) => x < grenze).length / a.length) * 100).toFixed(1)} %` : '—';
      console.log(
        JSON.stringify(
          {
            'Gegen-Gateway-Paare': paar.nah.length,
            'Median-Abstand Zielpunkt ↔ Austrittspunkt des Gegen-Gateways': med(paar.nah),
            'Anteil < 300 Einheiten': anteil(paar.nah, 300),
            'Kontrolle: anderes Gateway desselben Zielfields': med(paar.kontrolle),
            'Kontrolle Anteil < 300': anteil(paar.kontrolle, 300),
          },
          null,
          1,
        ),
      );

      /**
       * Zweiter Endpunkt der Austrittslinie — entschieden über dieselben
       * Gegen-Gateway-Paare. Wenn `@2/@4 → @off/@off+2` wirklich eine Linie
       * ist, muss der Zielpunkt des Gegen-Gateways **an der Strecke** liegen,
       * nicht nur beim ersten Endpunkt. Ein falscher Kandidat verlängert die
       * Strecke in eine beliebige Richtung und verbessert den Abstand nur
       * zufällig — deshalb werden alle Kandidaten nebeneinander gerechnet und
       * gegen „nur der Punkt @2/@4" verglichen.
       */
      const abstandZurStrecke = (
        ax: number, ay: number, bx: number, by: number, px: number, py: number,
      ): number => {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        return Math.hypot(ax + t * dx - px, ay + t * dy - py);
      };
      const streckenTest = new Map<number, number[]>();
      for (const g of gateways) {
        const zielName = resolveMaplistTarget(maplist, g.ziel);
        const zurueck = zielName ? proField.get(zielName) : undefined;
        const eigenerIndex = maplistIndexVon.get(g.von);
        if (!zurueck || eigenerIndex === undefined) continue;
        const gegen = zurueck.find((x) => x.ziel === eigenerIndex);
        if (!gegen) continue;
        const zx = i16(g.raw, 8);
        const zy = i16(g.raw, 10);
        const ax = i16(gegen.raw, 2);
        const ay = i16(gegen.raw, 4);
        for (const off of [0, 6, 12, 16, 18, 20]) {
          const liste = streckenTest.get(off) ?? [];
          liste.push(abstandZurStrecke(ax, ay, i16(gegen.raw, off), i16(gegen.raw, off + 2), zx, zy));
          streckenTest.set(off, liste);
        }
      }
      console.log(
        JSON.stringify(
          {
            'nur Punkt @2/@4': { median: med(paar.nah), 'Anteil < 300': anteil(paar.nah, 300) },
            alsStrecke: Object.fromEntries(
              [...streckenTest]
                .map(([off, a]) => [
                  `@2/@4 → @${off}/@${off + 2}`,
                  { median: med(a), 'Anteil < 300': anteil(a, 300) },
                ])
                .sort((x, y) => (x[1] as { median: number }).median - (y[1] as { median: number }).median),
            ),
          },
          null,
          1,
        ),
      );

      expect(zaehler.regel / auflösbar).toBeGreaterThan(0.7);
      expect(zaehler.regel).toBeGreaterThan(zaehler.nachbarfield * 2);
      expect(zaehler.regel).toBeGreaterThan(zaehler.verschoben * 2);
    },
  );
});
