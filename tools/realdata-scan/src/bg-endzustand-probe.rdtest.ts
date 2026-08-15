import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import {
  berechneAnfangsBgStates,
  FieldRuntime,
  prepareScript,
} from '@webmidgar/interpreter';
import { NodeDirectorySource } from './node-source.js';

/**
 * **F35 — was bedeutet eine leere Hintergrundmaske?**
 *
 * Der Befund, der die Frage stellt: Nach 300 Ticks stehen korpusweit **340 von
 * 1256** animierten Kachelgruppen auf Maske 0, und **keine einzige** davon ist
 * unberührt — jede wurde vom Field-Script selbst auf 0 geschaltet
 * (`junonr2-bgfluss-probe`). Unter der geltenden Zeichenregel („Bit nicht
 * gesetzt ⇒ unsichtbar") verschwinden diese 340 Gruppen dauerhaft. Genau das
 * ist der Verdacht hinter F35: fehlende Gondel, fehlende Tür.
 *
 * Zwei Deutungen stehen gegeneinander, und beide sind für sich plausibel:
 *
 *  - **(H1) Maske 0 heißt unsichtbar.** Die betroffenen Gruppen sind
 *    Einmal-Effekte — Rauchwolke, Blitz, Aufprall —, die nach ihrem Ablauf
 *    zu Recht weg sind. Die Zeichenregel ist richtig, F35 hat eine andere
 *    Ursache.
 *  - **(H2) Maske 0 heißt Anfangszustand.** Das Script fährt die Animation
 *    herunter und der Grundzustand kommt zurück. Dann blendet unsere Regel
 *    Dauerobjekte aus, und F35 ist ein Zeichenfehler.
 *
 * **Gütefunktion.** H1 und H2 sagen Unterschiedliches über die **Größe** der
 * betroffenen Gruppen voraus. Ein Einmal-Effekt belegt wenige Kacheln an einer
 * Stelle des Bildes; ein Dauerobjekt (Gondel, Tür, Aufzug) belegt viele. Wenn
 * H1 stimmt, müssen die auf 0 endenden Gruppen **deutlich kleiner** sein als
 * die, die belegt enden. Wenn H2 stimmt, dürfen sie es nicht sein — dann
 * unterscheidet die Endmaske nur, welches Script gerade fertig ist, und das hat
 * mit der Objektgröße nichts zu tun.
 *
 * **Kontrollniveau.** Die Größenverteilung der Gruppen, die belegt enden, ist
 * die eingebaute Kontrolle: Sie stammt aus demselben Bestand, denselben Fields
 * und derselben Messung, und nur die geprüfte Eigenschaft unterscheidet sie.
 * Zusätzlich läuft eine **Vertauschungskontrolle** — dieselbe Rechnung mit
 * zufällig zugeordneten Endmasken. Sie muss den Unterschied verlieren; täte sie
 * es nicht, misst die Anlage nur die Schiefe der Größenverteilung.
 *
 * **Zweite, unabhängige Vorhersage.** H1 sagt außerdem: Ein Einmal-Effekt läuft
 * **einmal** und hört auf. Gemessen wird deshalb, ob die letzte Schaltung eines
 * auf 0 endenden Parameters früh liegt (das Script ist durch) oder ob sie bis
 * zum Ende der 300 Ticks weiterläuft (dann ist 0 ein Durchgangszustand einer
 * laufenden Schleife und die Momentaufnahme sagt nichts).
 *
 * Urheberrecht: ausschließlich Zähler über die Daten des Nutzers.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const TICKS = 300;

const BGON = 0xe0;
const BGOFF = 0xe1;
const BGCLR = 0xe4;

interface Gruppe {
  field: string;
  param: number;
  /** Anzahl Kacheln, die zu diesem Animationsparameter gehören. */
  kacheln: number;
  /** Wie viele verschiedene Zustandsbits die Gruppe kennt. */
  zustaende: number;
  endmaske: number;
  /** Tick der letzten BGON/BGOFF/BGCLR-Schaltung auf diesem Parameter. */
  letzteSchaltung: number;
  schaltungen: number;
  /** Welcher Opcode zuletzt auf diesen Parameter wirkte. */
  letzterOp: 'BGON' | 'BGOFF' | 'BGCLR' | 'keiner';
  /** Hat das Script auf diesem Parameter je BGON oder BGOFF abgesetzt? */
  jeBitgeschaltet: boolean;
  /** Kacheln des ganzen Fields — Bezugsgröße für den Bildanteil. */
  kachelnField: number;
  /**
   * Kacheln, die nach 300 Ticks **zusätzlich** fehlen, weil die Gruppe gar
   * nichts mehr zeigt.
   *
   * ⚠️ Bewusst **nicht** „alle Kacheln ohne gesetztes Bit": Eine Gruppe mit
   * acht Zuständen blendet sieben davon zu Recht aus, das ist die Animation.
   * Ein erster Anlauf hat genau das mitgezählt und dadurch Bildanteile bis
   * 83 % ausgewiesen — eine Zahl, die den Defekt bestätigt hätte, ohne ihn zu
   * messen. Gezählt wird deshalb nur der Fall Endmaske 0, und zwar gegen den
   * **Anfangszustand**: so viele Kacheln stünden dort, wenn die Gruppe ihren
   * Grundzustand zeigte.
   */
  fehlend: number;
}

const median = (a: number[]): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};

const mittel = (a: number[]): number =>
  a.length === 0 ? 0 : Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10;

describe.skipIf(!available)('Realdaten: Bedeutung der leeren Hintergrundmaske', () => {
  it(
    'trennt Einmal-Effekte von Dauerobjekten über die Gruppengröße',
    { timeout: 900_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      const gruppen: Gruppe[] = [];

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let p;
        try {
          p = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        const b = p.bundle;
        if (!p.ok || !b?.script || !b.rawSections[1] || !b.background) continue;
        const code = b.rawSections[1]!;

        // Kachelzählung je Parameter — die unabhängige Größenangabe. Sie kommt
        // aus der Hintergrundsektion, nicht aus dem Script.
        const kachelZahl = new Map<number, number>();
        const bits = new Map<number, Set<number>>();
        /** Kacheln je (param, state) — für den tatsächlich unsichtbaren Anteil. */
        const jeZustand = new Map<string, number>();
        let kachelnField = 0;
        for (const layer of b.background.layers) {
          for (const t of layer.tiles) {
            kachelnField++;
            if (t.param === 0) continue;
            jeZustand.set(`${t.param}/${t.state}`, (jeZustand.get(`${t.param}/${t.state}`) ?? 0) + 1);
            kachelZahl.set(t.param, (kachelZahl.get(t.param) ?? 0) + 1);
            if (t.state !== 0) {
              let s = bits.get(t.param);
              if (!s) bits.set(t.param, (s = new Set()));
              s.add(t.state);
            }
          }
        }
        const anfang = berechneAnfangsBgStates(
          b.background.layers.flatMap((l) => l.tiles.map((t) => ({ param: t.param, state: t.state }))),
        );
        const params = Object.keys(anfang).map(Number);
        if (params.length === 0) continue;

        const letzte = new Map<number, number>();
        const anzahl = new Map<number, number>();
        const letzterOp = new Map<number, 'BGON' | 'BGOFF' | 'BGCLR'>();
        const bitgeschaltet = new Set<number>();
        let rt!: FieldRuntime;
        rt = new FieldRuntime(prepareScript(b.script, code), {
          seed: 0x5117,
          budget: 200,
          mainLoop: true,
          initialBgStates: anfang,
          stepGate: (ctx) => {
            const op = code[ctx.ip]!;
            if (op === BGON || op === BGOFF || op === BGCLR) {
              const par = code[ctx.ip + 2]!;
              letzte.set(par, rt.state.tickCounter);
              anzahl.set(par, (anzahl.get(par) ?? 0) + 1);
              letzterOp.set(par, op === BGON ? 'BGON' : op === BGOFF ? 'BGOFF' : 'BGCLR');
              if (op !== BGCLR) bitgeschaltet.add(par);
            }
            return true;
          },
        });
        rt.start();
        for (let t = 0; t < TICKS; t++) rt.tick();

        for (const par of params) {
          // Die Zeichenregel der Demo: `state === 0 || (maske & state) !== 0`.
          // Bei Endmaske 0 zeigt die Gruppe nichts; verglichen wird gegen den
          // Anfangszustand, also gegen das, was ohne jede Schaltung stünde.
          const maske = rt.state.bgStates[par] ?? 0;
          const fehlend = maske === 0 ? (jeZustand.get(`${par}/${anfang[par]}`) ?? 0) : 0;
          gruppen.push({
            kachelnField,
            fehlend,
            field: entry.name,
            param: par,
            kacheln: kachelZahl.get(par) ?? 0,
            zustaende: bits.get(par)?.size ?? 0,
            endmaske: rt.state.bgStates[par] ?? 0,
            letzteSchaltung: letzte.get(par) ?? -1,
            schaltungen: anzahl.get(par) ?? 0,
            letzterOp: letzterOp.get(par) ?? 'keiner',
            jeBitgeschaltet: bitgeschaltet.has(par),
          });
        }
      }
      await dir.closeAll();

      const leer = gruppen.filter((g) => g.endmaske === 0);
      const belegt = gruppen.filter((g) => g.endmaske !== 0);

      const groesseLeer = leer.map((g) => g.kacheln);
      const groesseBelegt = belegt.map((g) => g.kacheln);

      /**
       * Vertauschungskontrolle: dieselben Gruppen, aber die Endmasken werden
       * deterministisch durchgeschoben. Der Größenunterschied muss dabei
       * verschwinden.
       */
      const verschoben = gruppen.map((g, i) => ({
        ...g,
        endmaske: gruppen[(i + 7) % gruppen.length]!.endmaske,
      }));
      const kLeer = verschoben.filter((g) => g.endmaske === 0).map((g) => g.kacheln);
      const kBelegt = verschoben.filter((g) => g.endmaske !== 0).map((g) => g.kacheln);

      // Zweite Vorhersage: läuft die Schaltung noch, wenn die Momentaufnahme fällt?
      const spaet = leer.filter((g) => g.letzteSchaltung > TICKS - 30).length;
      const frueh = leer.filter((g) => g.letzteSchaltung >= 0 && g.letzteSchaltung <= 60).length;

      /**
       * **Dritte, schärfere Vorhersage — H3.** H1 und H2 behandeln BGCLR und
       * BGOFF gleich; beide enden auf Maske 0. Die Engine hat aber **zwei**
       * Opcodes, und ein zweiter Opcode, der nichts anderes tut als der erste,
       * wäre eine Merkwürdigkeit. Die Deutung, die sie unterscheidet:
       *
       *  - **BGCLR** hebt die Auswahl auf ⇒ es gilt wieder der Anfangszustand.
       *  - **BGOFF** löscht genau ein Bit ⇒ die Auswahl bleibt ausdrücklich,
       *    und wenn sie leer wird, ist die Gruppe wirklich unsichtbar.
       *
       * Vorhersage: Gruppen, auf denen das Script **ausschließlich** BGCLR
       * absetzt (nie ein Bit schaltet), sind **groß** — das sind Dauerobjekte,
       * deren Auswahl nur zurückgesetzt wird. Gruppen, die über BGOFF auf 0
       * enden, sind **klein** — Einmal-Effekte. Kontrolle ist wieder die
       * Gegengruppe aus demselben Bestand.
       */
      const nurGeklaert = leer.filter((g) => !g.jeBitgeschaltet);
      const bitAus = leer.filter((g) => g.jeBitgeschaltet);

      /**
       * **Der deutungsfreie Test.** Alle drei Vorhersagen oben setzen voraus,
       * dass man weiß, was eine Kachelgruppe *darstellt*. Diese hier tut das
       * nicht: Sie fragt nur, **welchen Anteil des Bildes** unsere Zeichenregel
       * nach 300 Ticks wegnimmt. Ein Hintergrund ist eine Zeichnung; wenn eine
       * Regel dauerhaft die Hälfte davon entfernt, ist sie falsch, ganz gleich
       * wie die Opcodes heißen. Das ist die Größe, die man auf dem Bildschirm
       * nachsehen kann — und genau deshalb steht sie hier.
       */
      const jeField = new Map<string, { gesamt: number; weg: number }>();
      for (const g of gruppen) {
        const e = jeField.get(g.field) ?? { gesamt: g.kachelnField, weg: 0 };
        e.weg += g.fehlend;
        jeField.set(g.field, e);
      }
      const anteile = [...jeField].map(([field, e]) => ({
        field,
        anteil: e.gesamt === 0 ? 0 : e.weg / e.gesamt,
        weg: e.weg,
        gesamt: e.gesamt,
      }));
      const ueber = (q: number): number => anteile.filter((a) => a.anteil > q).length;

      console.log(
        'F35 — Bedeutung der leeren Hintergrundmaske:',
        JSON.stringify(
          {
            Fields: new Set(gruppen.map((g) => g.field)).size,
            Kachelgruppen: gruppen.length,
            'davon Endmaske 0': leer.length,
            'davon Endmaske belegt': belegt.length,

            '=== Vorhersage 1: Größe ===': '',
            'Median Kacheln, Endmaske 0': median(groesseLeer),
            'Median Kacheln, Endmaske belegt': median(groesseBelegt),
            'Mittel Kacheln, Endmaske 0': mittel(groesseLeer),
            'Mittel Kacheln, Endmaske belegt': mittel(groesseBelegt),
            'Anteil ≤ 30 Kacheln, Endmaske 0': `${((groesseLeer.filter((k) => k <= 30).length / Math.max(1, groesseLeer.length)) * 100).toFixed(1)} %`,
            'Anteil ≤ 30 Kacheln, Endmaske belegt': `${((groesseBelegt.filter((k) => k <= 30).length / Math.max(1, groesseBelegt.length)) * 100).toFixed(1)} %`,

            '=== Kontrolle: vertauschte Endmasken ===': '',
            'Median Kacheln, „0" (vertauscht)': median(kLeer),
            'Median Kacheln, „belegt" (vertauscht)': median(kBelegt),

            '=== Vorhersage 2: Ablauf ===': '',
            'Endmaske 0, letzte Schaltung ≤ Tick 60 (Script ist durch)': `${frueh}/${leer.length}`,
            'Endmaske 0, letzte Schaltung > Tick 270 (Schleife läuft noch)': `${spaet}/${leer.length}`,
            'Median Zustandsbits, Endmaske 0': median(leer.map((g) => g.zustaende)),
            'Median Zustandsbits, Endmaske belegt': median(belegt.map((g) => g.zustaende)),

            '=== Vorhersage 3 (H3): BGCLR ≠ BGOFF ===': '',
            'Endmaske 0, nur BGCLR (nie ein Bit geschaltet)': nurGeklaert.length,
            'Endmaske 0, über BGON/BGOFF ausgeschaltet': bitAus.length,
            'Median Kacheln, nur BGCLR': median(nurGeklaert.map((g) => g.kacheln)),
            'Median Kacheln, über BGOFF ausgeschaltet': median(bitAus.map((g) => g.kacheln)),
            'Mittel Kacheln, nur BGCLR': mittel(nurGeklaert.map((g) => g.kacheln)),
            'Mittel Kacheln, über BGOFF ausgeschaltet': mittel(bitAus.map((g) => g.kacheln)),
            'Anteil > 200 Kacheln, nur BGCLR': `${((nurGeklaert.filter((g) => g.kacheln > 200).length / Math.max(1, nurGeklaert.length)) * 100).toFixed(1)} %`,
            'Anteil > 200 Kacheln, über BGOFF': `${((bitAus.filter((g) => g.kacheln > 200).length / Math.max(1, bitAus.length)) * 100).toFixed(1)} %`,
            'Kontrolle — Median Kacheln aller belegt endenden Gruppen': median(groesseBelegt),

            '=== Der deutungsfreie Test: Bildanteil ===': '',
            'Fields mit Animationsgruppen': anteile.length,
            'Median unsichtbarer Bildanteil': `${(median(anteile.map((a) => a.anteil)) * 100).toFixed(1)} %`,
            'Fields, die > 10 % ihrer Kacheln verlieren': `${ueber(0.1)}/${anteile.length}`,
            'Fields, die > 25 % verlieren': `${ueber(0.25)}/${anteile.length}`,
            'Fields, die > 50 % verlieren': `${ueber(0.5)}/${anteile.length}`,
            'schlimmste Fields': [...anteile]
              .sort((a, b) => b.anteil - a.anteil)
              .slice(0, 12)
              .map((a) => `${a.field}: ${(a.anteil * 100).toFixed(1)} % weg (${a.weg}/${a.gesamt} Kacheln)`),

            'größte Gruppen mit Endmaske 0': leer
              .sort((a, b) => b.kacheln - a.kacheln)
              .slice(0, 12)
              .map((g) => `${g.field} param ${g.param}: ${g.kacheln} Kacheln, ${g.zustaende} Zustände, letzter Opcode ${g.letzterOp} in Tick ${g.letzteSchaltung}`),
          },
          null,
          1,
        ),
      );

      expect(gruppen.length).toBeGreaterThan(500);
      expect(leer.length).toBeGreaterThan(0);
      expect(belegt.length).toBeGreaterThan(0);

      /**
       * **Vertauschungskontrolle.** Sie muss den Größenunterschied verlieren —
       * sonst misst die Anlage nur die Schiefe der Größenverteilung und nicht
       * die Endmaske. Sie verliert ihn nicht: 35/27 vertauscht gegen 36/25 echt.
       * Damit ist Vorhersage 1 **nicht bestätigt, sondern entwertet** — die
       * Endmaske sagt über die Gruppengröße nichts aus. Der Test hält das als
       * Dauerbefund fest, statt ihn als Erfolg zu verbuchen.
       */
      expect(Math.abs(median(kLeer) - median(kBelegt))).toBeLessThan(
        Math.abs(median(groesseLeer) - median(groesseBelegt)) + 5,
      );

      /**
       * **Die tragende Aussage.** Der typische Field verliert unter der
       * geltenden Zeichenregel **nichts** — der Median des fehlenden
       * Bildanteils ist 0 %. Eine Regeländerung („leere Maske ⇒ Anfangszustand")
       * wäre damit keine Korrektur, sondern würde die 169 Gruppen kaputtmachen,
       * die das Script absichtlich abschaltet. Der Rest ist ein **begrenzter
       * Ausläufer**: 27 Fields über 10 %, genau eines über 50 %. Wächst er,
       * schlägt dieser Test an, und dann ist die Regel neu zu prüfen.
       */
      expect(median(anteile.map((a) => a.anteil))).toBe(0);
      expect(ueber(0.5)).toBeLessThanOrEqual(3);
      expect(ueber(0.1)).toBeLessThanOrEqual(40);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
