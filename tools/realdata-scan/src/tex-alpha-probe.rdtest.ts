import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseTex } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';

/**
 * Streifen über den Augen — Verdacht: Transparenz wird nicht ausgewertet.
 *
 * **Beobachtung (Sichtprüfung 2026-08-10).** Die Augen werden inzwischen
 * gerendert, aber „die Platzhalter-Textur (die Streifen)" liegt weiter über
 * ihnen. Ein Streifenmuster ist genau das, was man sieht, wenn eine Fläche
 * Bildbereiche zeigt, die eigentlich **nicht sichtbar** sein sollten: FF7 legt
 * Augen und Mund als kleine Aufkleber auf das Gesicht, und der Rand dieser
 * Aufkleber ist im Bild als Füllfläche belegt, nicht leer.
 *
 * **Der Verdacht.** `texToRgba` reicht das Alphabyte der Palette zwar korrekt
 * durch, aber kein Renderpfad wertet es aus: Das Material kennt weder
 * `alphaTest` noch Mischung. Dann malt jeder Aufkleber sein volles Rechteck.
 *
 * **Was diese Probe misst, und was nicht.** Sie kann NICHT zeigen, wie das
 * Bild danach aussieht — das ist wieder eine Bildfrage und gehört ins
 * Formular. Sie klärt die Vorfrage, die man vor jeder Formatänderung
 * beantworten muss: **Welche Transparenzregel trägt die Datei überhaupt?**
 *
 *  1. Kopffelder: Gibt es einen Farbschlüssel-Schalter, und variiert er?
 *  2. Alphabytes der Palette: konstant oder gemischt?
 *  3. Index 0: Wie oft kommt er in den Pixeldaten vor?
 *
 * **Kontrolle gegen Selbsttäuschung — und zwar die entscheidende.** Die
 * naheliegende Konsequenz „Alpha 0 heißt durchsichtig" ist eine **Falle**:
 * Trägt der Bestand durchgehend A = 0 (ein in Formaten dieser Zeit übliches
 * ungenutztes Feld), dann würde diese Regel jede Textur vollständig unsichtbar
 * machen. Die Probe misst deshalb ausdrücklich, wie viele Texel unter jeder
 * Regel wegfielen. Eine Regel, die > 90 % entfernt, ist widerlegt, egal wie
 * plausibel sie klingt.
 *
 * Der Gegenprobe-Wert ist die **Randlage**: Ein echter Schlüsselwert liegt bei
 * Aufklebern bevorzugt am Bildrand. Deshalb wird für Index 0 getrennt gezählt,
 * welcher Anteil auf die Randzeilen/-spalten fällt. Verteilt er sich gleich
 * über die Fläche, ist er eine gewöhnliche Farbe und kein Schlüssel.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zähler, Quoten, Histogramme.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Kopffelder, die laut Gemeinschaftsbeschreibungen mit Transparenz zu tun haben. */
const KOPF_KANDIDATEN: Array<[string, number]> = [
  ['0x08 (Farbschlüssel?)', 0x08],
  ['0x1c (min Alphabits?)', 0x1c],
  ['0x20 (max Alphabits?)', 0x20],
  ['0x38 (Bittiefe?)', 0x38],
  ['0x44 (?)', 0x44],
  ['0x48 (?)', 0x48],
  ['0x64 (?)', 0x64],
  ['0x6c (Alphabits?)', 0x6c],
  ['0x70 (Alphamaske?)', 0x70],
  ['0xa4 (Palettenindex?)', 0xa4],
  ['0xcc (referenziertes Alpha?)', 0xcc],
  ['0xd0 (?)', 0xd0],
];

describe.skipIf(!available)('Realdaten: Transparenzregel im .tex (Streifen über den Augen)', () => {
  it('misst, welche Transparenzregel die Datei trägt', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    let dateien = 0;
    const kopfWerte = new Map<string, Map<number, number>>();
    for (const [name] of KOPF_KANDIDATEN) kopfWerte.set(name, new Map());

    // Alphabytes über den gesamten Bestand.
    const alphaHisto = new Map<number, number>();
    let palEintraege = 0;
    let texMitGemischtemAlpha = 0;

    // Wieviel Bild verlöre welche Regel?
    let texelGesamt = 0;
    let texelAlphaNull = 0;
    let texelIndexNull = 0;

    // Randlage von Index 0: Ein Schlüsselwert sitzt bei Aufklebern am Rand.
    let idx0Rand = 0;
    let idx0Gesamt = 0;
    let randTexel = 0;

    // Trennfrage: Regel A (Palettenalpha) und Regel B (Index 0) fallen
    // weitgehend zusammen — aber eben nicht ganz. Nur wo sie sich UNTER-
    // scheiden, ist überhaupt eine Entscheidung möglich.
    /** [Flag 0, undurchsichtig], [Flag 0, durchsichtig], [Flag 1, undurchsichtig], [Flag 1, durchsichtig] */
    const kreuz = [0, 0, 0, 0];
    let idx0MitAlphaNull = 0; // Texturen, in denen Index 0 A = 0 trägt
    let idx0MitAlphaVoll = 0; // … und in denen nicht
    let alphaNullAnzahl = 0; // Paletteneinträge mit A = 0, gezählt je Textur
    const alphaNullProTex = new Map<number, number>();
    let nurA = 0; // Texel: A sagt weg, B sagt bleib
    let nurB = 0; // Texel: B sagt weg, A sagt bleib
    let beide = 0;

    // Kleine Texturen (Augenverdacht) getrennt, damit der Bestand die
    // Aufkleber nicht in seiner Masse ertränkt.
    let kleineDateien = 0;
    let kleineTexel = 0;
    let kleineIndexNull = 0;

    for (const entry of index.listEntries('char')) {
      if (!entry.name.toLowerCase().endsWith('.tex')) continue;
      const roh = await index.readEntry(entry.canonicalId);
      let tex;
      try {
        tex = parseTex(roh, entry.name).value;
      } catch {
        continue;
      }
      if (!tex) continue;
      dateien++;

      const rv = new DataView(roh.buffer, roh.byteOffset, roh.byteLength);
      for (const [name, off] of KOPF_KANDIDATEN) {
        if (off + 4 > roh.byteLength) continue;
        const v = rv.getUint32(off, true);
        const m = kopfWerte.get(name)!;
        m.set(v, (m.get(v) ?? 0) + 1);
      }

      const pal = tex.palettes[0]!;
      const farben = pal.length / 4;
      const alphaHier = new Set<number>();
      const alphaNullIndex = new Set<number>();
      for (let c = 0; c < farben; c++) {
        const a = pal[c * 4 + 3]!;
        alphaHisto.set(a, (alphaHisto.get(a) ?? 0) + 1);
        alphaHier.add(a);
        if (a === 0) alphaNullIndex.add(c);
        palEintraege++;
      }
      if (alphaHier.size > 1) texMitGemischtemAlpha++;
      if (farben > 0) {
        if (pal[3]! === 0) idx0MitAlphaNull++;
        else idx0MitAlphaVoll++;
      }
      // Kreuztabelle Kopfschalter 0x08 × „Index 0 ist durchsichtig".
      // Gleiche ANZAHLEN sind noch keine Übereinstimmung — es müssen
      // dieselben DATEIEN sein. Ohne diese Prüfung wäre 627/68 auf beiden
      // Seiten ein hübscher Zufall und kein Beleg.
      const flagge = roh.byteLength > 0x0c ? rv.getUint32(0x08, true) : 0;
      const durchsichtig = farben > 0 && pal[3]! === 0;
      const feld = (flagge === 1 ? 2 : 0) + (durchsichtig ? 1 : 0);
      kreuz[feld] = (kreuz[feld] ?? 0) + 1;
      alphaNullAnzahl += alphaNullIndex.size;
      alphaNullProTex.set(alphaNullIndex.size, (alphaNullProTex.get(alphaNullIndex.size) ?? 0) + 1);

      const { width: w, height: h, pixelIndices: px } = tex;
      texelGesamt += px.length;
      const klein = w * h <= 4096;
      if (klein) {
        kleineDateien++;
        kleineTexel += px.length;
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = px[i]!;
          const a = alphaNullIndex.has(v);
          const b = v === 0;
          if (a) texelAlphaNull++;
          if (a && b) beide++;
          else if (a) nurA++;
          else if (b) nurB++;
          const amRand = x === 0 || y === 0 || x === w - 1 || y === h - 1;
          if (amRand) randTexel++;
          if (v === 0) {
            texelIndexNull++;
            idx0Gesamt++;
            if (amRand) idx0Rand++;
            if (klein) kleineIndexNull++;
          }
        }
      }
    }
    await dir.closeAll();

    const q = (n: number, aus: number): string => `${n} (${((n / Math.max(1, aus)) * 100).toFixed(1)}%)`;
    const top = (m: Map<number, number>): Array<[number, number]> =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    console.log(
      'Transparenzregel im .tex:',
      JSON.stringify(
        {
          'Texturen gesamt': dateien,
          'Kopffelder (Wert → Dateien, Top 4)': Object.fromEntries(
            [...kopfWerte.entries()].map(([n, m]) => [n, top(m)]),
          ),
          'Palettenalpha (Wert → Einträge)': top(alphaHisto),
          'Paletteneinträge gesamt': palEintraege,
          'Texturen mit gemischtem Alpha': `${texMitGemischtemAlpha}/${dateien}`,
          'Texel gesamt': texelGesamt,
          'Regel A: Alpha == 0 → weg': q(texelAlphaNull, texelGesamt),
          'Regel B: Index 0 → weg': q(texelIndexNull, texelGesamt),
          'Kreuztabelle 0x08 × Index-0-Alpha': {
            'Flag=0, Index 0 undurchsichtig': kreuz[0],
            'Flag=0, Index 0 durchsichtig (Widerspruch)': kreuz[1],
            'Flag=1, Index 0 undurchsichtig (Widerspruch)': kreuz[2],
            'Flag=1, Index 0 durchsichtig': kreuz[3],
          },
          'Index 0 trägt A = 0': `${idx0MitAlphaNull}/${dateien}`,
          'Index 0 trägt A > 0': `${idx0MitAlphaVoll}/${dateien}`,
          'Paletteneinträge mit A = 0 je Textur (Anzahl → Texturen)': [...alphaNullProTex.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6),
          'A = 0 Einträge gesamt': alphaNullAnzahl,
          'Texel: nur A entfernt (A=0, aber Index≠0)': q(nurA, texelGesamt),
          'Texel: nur B entfernt (Index 0, aber A>0)': q(nurB, texelGesamt),
          'Texel: beide einig': q(beide, texelGesamt),
          'Index 0: Anteil am Rand': `${((idx0Rand / Math.max(1, idx0Gesamt)) * 100).toFixed(1)}%`,
          'Randanteil der Fläche (Erwartung ohne Signal)': `${((randTexel / Math.max(1, texelGesamt)) * 100).toFixed(1)}%`,
          'kleine Texturen (≤64×64)': kleineDateien,
          'davon Index 0': q(kleineIndexNull, kleineTexel),
        },
        null,
        1,
      ),
    );

    // BEFUND (🟢): Der Kopfschalter bei 0x08 IST der Farbschlüssel. Er stimmt
    // in 695/695 Dateien mit dem Palettenalpha überein — Flag = 1 genau dann,
    // wenn Index 0 das Alpha 0 trägt, **null Widersprüche in beide
    // Richtungen**. Zwei unabhängige Felder derselben Datei sagen dasselbe;
    // gleiche Anzahlen allein wären Zufall gewesen, gleiche Dateien sind es
    // nicht.
    expect(kreuz[1]).toBe(0);
    expect(kreuz[2]).toBe(0);
    expect(kreuz[0]! + kreuz[3]!).toBe(dateien);

    // Damit ist auch entschieden, WELCHE Regel gilt: Das Palettenalpha ist
    // eine echte Teilmenge von „Index 0 ist immer durchsichtig" — es gibt
    // keinen einzigen Texel, den nur Regel A entfernt. Umgekehrt entfernte die
    // pauschale Regel B zusätzlich 7,7 % der Texel, nämlich in genau den 68
    // Dateien, in denen Index 0 eine gewöhnliche Farbe ist. Wir folgen daher
    // dem Alphabyte und nicht der Faustregel.
    expect(nurA).toBe(0);
    expect(nurB).toBeGreaterThan(0);

    // Kontrolle gegen die Falle: Wäre A = 0 ein ungenutztes Feld, das überall
    // 0 steht, machte die Regel jede Textur unsichtbar. Gemessen entfernt sie
    // ein Drittel — viel, aber genau das erwartet man bei Aufklebern, die als
    // kleines Motiv in einem leeren Rechteck liegen.
    expect(texelAlphaNull / texelGesamt).toBeLessThan(0.9);
    expect(texelAlphaNull / texelGesamt).toBeGreaterThan(0.05);

    expect(dateien).toBeGreaterThan(100);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
