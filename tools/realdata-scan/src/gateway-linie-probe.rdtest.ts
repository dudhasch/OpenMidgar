import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * Gateway-Austrittslinie (F15): **An welchen Byteversätzen des 24-B-Records
 * stehen die beiden Endpunkte?**
 *
 * Anlass ist ein Sichtbefund, kein Verdacht: In `md1stin` liest sich die Linie
 * unter der bisherigen Deutung (@0 und @6, je drei `i16`) als
 * (353, 3669, 29368) → (353, 1049, 400) — eine Diagonale über die halbe Karte,
 * bei der nur die Komponenten [1],[2] des ersten Punktes auf dem Walkmesh
 * liegen. Der Übertritt feuert deshalb nie.
 *
 * **Erste Vorhersage — widerlegt.** Naheliegend war: Ein Gateway liegt auf
 * einer Kante des begehbaren Netzes, seine Endpunkte sind also
 * **Walkmesh-Vertices**. Über alle 1095 belegten Gateways und alle elf
 * möglichen `i16`-Paare trifft das an **keinem** Versatz (Bestwert 2/1095,
 * Fremdfeld-Kontrolle gleichauf). Die Endpunkte sind keine Vertices.
 *
 * **Zweite Vorhersage — die hier gemessen wird.** Schwächer, aber ausreichend:
 * Der Punkt muss **im begehbaren Netz liegen** (Punkt-in-Dreieck über alle
 * Dreiecke des Fields). Das ist die Eigenschaft, auf die es für den Übertritt
 * ankommt — der Solver prüft genau sie.
 *
 * **Kontrollniveau, doppelt.** (1) Die zehn falschen Versätze sind die
 * eingebaute Kontrolle. (2) Zusätzlich läuft jede Rechnung gegen das Netz
 * eines **fremden Fields**: Ein Versatz, der auch dort trifft, misst nur die
 * Größenordnung der Zahlen, nicht die Zuordnung. Ohne diese zweite Kontrolle
 * wäre eine hohe Quote wertlos, weil Fields ähnliche Wertebereiche haben.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

interface FeldProbe {
  name: string;
  /** Rohbytes aller belegten Gateway-Records. */
  records: Uint8Array[];
  /** Dreiecke als flache (x, y)-Tripel — Punkt-in-Dreieck ohne Objektlast. */
  tris: Int32Array;
}

/** Punkt-in-Dreieck über Vorzeichen der Kreuzprodukte, Rand zählt als innen. */
function imNetz(tris: Int32Array, px: number, py: number): boolean {
  for (let i = 0; i < tris.length; i += 6) {
    const ax = tris[i]!, ay = tris[i + 1]!;
    const bx = tris[i + 2]!, by = tris[i + 3]!;
    const cx = tris[i + 4]!, cy = tris[i + 5]!;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

describe.skipIf(!available)('Realdaten: Byteversatz der Gateway-Austrittslinie', () => {
  it(
    'sucht die Versätze, deren Punkte auf Walkmesh-Vertices liegen',
    { timeout: 900_000 },
    async () => {
      const index = new IndexService();
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      await index.openSource(dir, { deep: false });

      const felder: FeldProbe[] = [];
      for (const eintrag of index.listEntries('flevel')) {
        if (eintrag.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(eintrag.canonicalId), eintrag.name);
        } catch {
          continue;
        }
        const b = parsed.ok ? parsed.bundle : null;
        if (!b?.triggers || !b.walkmesh) continue;
        const tris = new Int32Array(b.walkmesh.triangles.length * 6);
        b.walkmesh.triangles.forEach((t, i) => {
          for (let k = 0; k < 3; k++) {
            tris[i * 6 + k * 2] = t.vertices[k]![0];
            tris[i * 6 + k * 2 + 1] = t.vertices[k]![1];
          }
        });
        const records = b.triggers.gateways.filter((g) => g.used).map((g) => g.raw);
        if (records.length) felder.push({ name: eintrag.name, records, tris });
      }
      await dir.closeAll();

      const i16 = (r: Uint8Array, at: number): number => {
        const v = r[at]! | (r[at + 1]! << 8);
        return v > 0x7fff ? v - 0x10000 : v;
      };

      /**
       * Ein Kandidat ist ein Paar benachbarter `i16` (x an `off`, y an
       * `off + 2`). Geprüft werden alle Versätze, an denen ein solches Paar
       * vollständig in den Record passt.
       */
      const kandidaten: number[] = [];
      for (let off = 0; off + 4 <= 24; off += 2) kandidaten.push(off);

      const zaehle = (off: number, fremd: boolean): { treffer: number; gesamt: number } => {
        let treffer = 0;
        let gesamt = 0;
        felder.forEach((f, i) => {
          const netz = fremd ? felder[(i + 1) % felder.length]!.tris : f.tris;
          for (const r of f.records) {
            gesamt++;
            if (imNetz(netz, i16(r, off), i16(r, off + 2))) treffer++;
          }
        });
        return { treffer, gesamt };
      };

      const ergebnis = kandidaten.map((off) => {
        const eigen = zaehle(off, false);
        const fremd = zaehle(off, true);
        return {
          off,
          eigen: `${((eigen.treffer / eigen.gesamt) * 100).toFixed(1)} % (${eigen.treffer}/${eigen.gesamt})`,
          kontrolleFremdesField: `${((fremd.treffer / fremd.gesamt) * 100).toFixed(1)} %`,
          q: eigen.treffer / eigen.gesamt,
          k: fremd.treffer / fremd.gesamt,
        };
      });

      const rang = [...ergebnis].sort((a, b) => b.q - a.q);
      console.log(
        JSON.stringify(
          {
            felder: felder.length,
            gateways: felder.reduce((n, f) => n + f.records.length, 0),
            rangliste: rang.map(({ off, eigen, kontrolleFremdesField }) => ({
              off,
              eigen,
              kontrolleFremdesField,
            })),
          },
          null,
          1,
        ),
      );

      /**
       * Zweiter Endpunkt: Eine Austrittslinie ist **kurz** — sie liegt auf
       * einer Kante des begehbaren Bereichs, nicht quer über die Karte.
       * Gemessen wird deshalb für jeden Kandidaten der Abstand zum Siegerpunkt
       * (@2/@4). Kontrolle ist derselbe Abstand zu einem **fremden** Gateway
       * desselben Fields: Läge der Kandidat nur „irgendwo in der Nähe", träfe
       * er die Kontrolle genauso.
       */
      const abstand = kandidaten
        .filter((off) => off !== 2)
        .map((off) => {
          const eigene: number[] = [];
          const fremde: number[] = [];
          for (const f of felder) {
            f.records.forEach((r, ri) => {
              const ax = i16(r, 2);
              const ay = i16(r, 4);
              const bx = i16(r, off);
              const by = i16(r, off + 2);
              eigene.push(Math.hypot(bx - ax, by - ay));
              const andere = f.records[(ri + 1) % f.records.length]!;
              fremde.push(Math.hypot(i16(andere, off) - ax, i16(andere, off + 2) - ay));
            });
          }
          const med = (a: number[]): number => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
          const kurz = (a: number[]): string =>
            `${((a.filter((d) => d < 1000).length / a.length) * 100).toFixed(1)} %`;
          return {
            off,
            medianAbstand: Math.round(med([...eigene])),
            'Anteil < 1000': kurz(eigene),
            kontrolleFremdesGateway: Math.round(med([...fremde])),
            'Kontrolle < 1000': kurz(fremde),
          };
        })
        .sort((a, b) => a.medianAbstand - b.medianAbstand);
      console.log(JSON.stringify({ zweiterEndpunkt: abstand }, null, 1));

      /**
       * **Wie nah kommt man einem Gateway überhaupt?** Der Austrittspunkt liegt
       * in 85,5 % der Fälle im Netz, in den übrigen 14,5 % davor oder dahinter.
       * Für die Auslöseregel zählt deshalb nicht, ob er drin liegt, sondern wie
       * weit er von der nächsten begehbaren Stelle entfernt ist: Ein Radius
       * unterhalb dieses Abstands macht das Gateway **unerreichbar**.
       *
       * Gemessen wird der Abstand zum nächsten Dreieck (0, wenn innen) — als
       * Verteilung, weil der Radius alle Gateways tragen muss, nicht den Median.
       */
      const abstandZumNetz = (tris: Int32Array, px: number, py: number): number => {
        if (imNetz(tris, px, py)) return 0;
        let best = Infinity;
        for (let i = 0; i < tris.length; i += 2) {
          const dx = tris[i]! - px;
          const dy = tris[i + 1]! - py;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) best = d;
        }
        return best;
      };
      const abstaende: number[] = [];
      for (const f of felder) {
        for (const r of f.records) abstaende.push(abstandZumNetz(f.tris, i16(r, 2), i16(r, 4)));
      }
      abstaende.sort((a, b) => a - b);
      const perzentil = (q: number): number =>
        Math.round(abstaende[Math.min(abstaende.length - 1, Math.floor(abstaende.length * q))]!);
      console.log(
        JSON.stringify(
          {
            'Abstand Austrittspunkt → nächstes Dreieck': {
              'im Netz (0)': `${((abstaende.filter((d) => d === 0).length / abstaende.length) * 100).toFixed(1)} %`,
              p50: perzentil(0.5),
              p90: perzentil(0.9),
              p95: perzentil(0.95),
              p99: perzentil(0.99),
              max: Math.round(abstaende[abstaende.length - 1]!),
            },
          },
          null,
          1,
        ),
      );

      // Der beste Versatz muss die Vorhersage erfüllen ...
      expect(rang[0]!.q).toBeGreaterThan(0.5);
      // ... und sich von der Fremdfeld-Kontrolle deutlich abheben.
      expect(rang[0]!.q).toBeGreaterThan(rang[0]!.k * 2);
    },
  );
});
