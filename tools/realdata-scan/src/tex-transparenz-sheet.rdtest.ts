import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import type { TextureSource } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';
import {
  PALETTEN, dreiecke, html, ladeModelle, rasterize, texZelle, texturierteDreiecke,
  type Fall, type Modell,
} from './sheet.js';

/**
 * Streifen über den Augen — Tafel zur Trennung zweier Ursachen.
 *
 * **Beobachtung (Sichtprüfung 2026-08-10).** „Obwohl die Augen richtig
 * gerendert worden sind, ist immer noch die Platzhalter-Textur (die Streifen)
 * über den Augen zu sehen."
 *
 * **Zwei Ursachen kommen in Frage, und sie sehen ähnlich aus.**
 *
 *  1. **Fehlende Transparenz.** FF7 legt Augen und Mund als kleine Aufkleber
 *     auf das Gesicht. Der Aufkleber ist ein Rechteck, das Motiv darin klein;
 *     der Rest ist im Bild belegt und soll durchsichtig sein. Werten wir das
 *     nicht aus, malt jeder Aufkleber sein volles Rechteck.
 *  2. **Tiefenstreit koplanarer Flächen.** Aufkleber und Gesicht liegen exakt
 *     aufeinander. Wer je Pixel gewinnt, entscheidet dann der Rundungsfehler —
 *     und das Muster, das dabei entsteht, sind **Streifen**.
 *
 * Beide erzeugen „irgendwas Falsches über den Augen“, und genau deshalb darf
 * man sie nicht zusammen prüfen: Behebt man beide gleichzeitig und es wird
 * besser, weiß man nicht, welche es war — und trägt die falsche Erklärung als
 * Formatfakt ein. Die Tafel zeigt daher **jede Ursache einzeln** und beide
 * zusammen (M1..M4).
 *
 * **Was die Messung bereits entschieden hat** (`tex-alpha-probe`, 🟢): Die
 * Transparenzregel steht in der Datei und ist nicht zu raten. Der Kopfschalter
 * bei 0x08 stimmt in **695/695** Dateien mit dem Palettenalpha überein — Flag = 1
 * genau dann, wenn Index 0 das Alpha 0 trägt, null Widersprüche in beide
 * Richtungen. Zudem ist „Alpha 0“ eine echte **Teilmenge** von „Index 0“: Es
 * gibt keinen Texel, den nur die Alpharegel entfernt, während die pauschale
 * Regel zusätzlich 7,7 % der Texel verschlucken würde — nämlich in den 68
 * Dateien, in denen Index 0 eine gewöhnliche Farbe ist.
 *
 * Offen ist damit **nicht mehr, was die Datei sagt**, sondern nur, ob das
 * Bild danach stimmt — und ob es die Streifen erklärt. Deshalb diese Tafel.
 *
 * **Datenschutz/Urheberrecht:** ausschließlich lokal, kein Upload.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const OUT =
  process.env['WEBMIDGAR_TRANSPARENZ_OUT'] ??
  'C:\\Users\\timur\\AppData\\Local\\Temp\\claude\\C--ff7-web\\49dab9ae-a74e-4275-bde7-8575218c5ff6\\scratchpad\\transparenz-formular.html';

const available = existsSync(REAL_DIR);

/** Anteil der Texel, die laut Palettenalpha durchsichtig sind. */
function durchsichtigAnteil(tex: TextureSource): number {
  const pal = tex.palettes[0];
  if (!pal) return 0;
  const farben = pal.length / 4;
  let n = 0;
  for (const v of tex.pixelIndices) {
    const idx = Math.min(v, farben - 1);
    if (pal[idx * 4 + 3] === 0) n++;
  }
  return n / Math.max(1, tex.pixelIndices.length);
}

describe.skipIf(!available)('Realdaten: Transparenz-Testformular (Streifen über den Augen)', () => {
  it('erzeugt ein Formular, das beide Streifen-Ursachen trennt', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const modelle = await ladeModelle(dir, index);
    await dir.closeAll();

    for (const m of modelle) m.texDreiecke = texturierteDreiecke(m);
    // Figürliche Modelle: Ein rotierendes Objekt kann die Frage nicht tragen,
    // das ist in dieser Tafelreihe schon einmal schiefgegangen.
    const figuren: Modell[] = [...modelle]
      .sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length)
      .filter((m) => texturierteDreiecke(m) > 0);
    expect(figuren.length).toBeGreaterThan(1);

    const faelle: Fall[] = [];

    // --- Gruppe 1: die Aufkleber selbst, mit sichtbar gemachter Transparenz.
    //
    // Ausgewählt werden die Texturen mit dem HÖCHSTEN durchsichtigen Anteil:
    // Das ist die Bauform „kleines Motiv in leerem Rechteck“, also genau der
    // Verdacht. Was das Schachbrett zeigt, verschwände beim Rendern.
    const kandidaten: Array<{ tex: TextureSource; anteil: number }> = [];
    for (const m of figuren.slice(0, 4)) {
      for (const liste of m.res.values()) {
        for (const { texturen } of liste) {
          for (const t of texturen) {
            if (t && !kandidaten.some((k) => k.tex === t)) kandidaten.push({ tex: t, anteil: durchsichtigAnteil(t) });
          }
        }
      }
    }
    kandidaten.sort((a, b) => b.anteil - a.anteil);
    const aufkleber = kandidaten.slice(0, 3);
    expect(aufkleber.length).toBe(3);

    let tn = 1;
    for (const { tex, anteil } of aufkleber) {
      for (const zeigen of [false, true]) {
        faelle.push({
          id: `T${tn++}`,
          gruppe: '1 — Der Aufkleber selbst: was ist Motiv, was ist Füllfläche?',
          frage:
            'Links jeweils, was wir heute malen; rechts dasselbe Bild, wobei die laut Palettenalpha durchsichtigen Texel als Schachbrett markiert sind. Frage: Steckt das, was wie ein Platzhalter aussieht (die Streifen), im Schachbrettbereich?',
          variante: zeigen ? 'durchsichtige Texel markiert' : 'wie heute gemalt',
          detail: `${tex.width}×${tex.height} · ${(anteil * 100).toFixed(0)}% durchsichtig`,
          png: texZelle(tex, PALETTEN['BGRA (heute)']!, zeigen ? [190, 60, 190] : undefined),
        });
      }
    }

    // --- Gruppe 2: die beiden Ursachen am Modell, einzeln und zusammen.
    const VARIANTEN: Array<[string, { transparenz?: boolean; aufkleberVersatz?: boolean }]> = [
      ['heute (keine der beiden Änderungen)', {}],
      ['nur Transparenz (Palettenalpha)', { transparenz: true }],
      ['nur Aufkleber-Versatz (gegen Tiefenstreit)', { aufkleberVersatz: true }],
      ['beides', { transparenz: true, aufkleberVersatz: true }],
    ];
    let mn = 1;
    for (const [n, m] of figuren.slice(0, 2).entries()) {
      const tris = dreiecke(m, { palette: 'BGRA (heute)', flipV: false, flipU: false, vertexPerm: null });
      for (const [name, opt] of VARIANTEN) {
        faelle.push({
          id: `M${mn++}`,
          gruppe: '2 — Am Modell: welche der beiden Ursachen erklärt die Streifen?',
          frage:
            'Bitte NUR auf die Streifen achten. Entscheidend ist, in welcher Zelle sie zuerst verschwinden — verschwinden sie schon bei „nur Transparenz“, war es die Füllfläche; erst bei „nur Aufkleber-Versatz“, war es der Tiefenstreit.',
          variante: name,
          detail: `Modell ${n + 1} · ${m.skeleton.bones.length} Bones · ${m.texDreiecke} texturierte Dreiecke`,
          png: rasterize(tris, opt),
        });
      }
    }

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      html(faelle, {
        titel: 'Streifen über den Augen — Transparenz oder Tiefenstreit?',
        speicher: 'transparenz-urteile',
        kennung: 'transparenz',
        einleitung:
          '<p>Die Augentexturen sind nachweislich geladen und zugeordnet (626/626 Flächen auflösbar, 0 außerhalb, 0 fehlend). Es geht hier also nicht mehr darum, <i>ob</i> sie da sind, sondern warum noch etwas über ihnen liegt.</p>' +
          '<p><b>Die beiden Kandidaten sehen ähnlich aus, deshalb stehen sie einzeln nebeneinander:</b> eine nicht ausgewertete Durchsichtigkeit malt das volle Rechteck des Aufklebers; ein Tiefenstreit zwischen exakt aufeinanderliegenden Flächen erzeugt Streifen aus Rundungsfehlern. Beide zusammen zu beheben würde die Antwort verdecken.</p>' +
          '<p>Unbeantwortete Fälle sind erlaubt — sie erscheinen im JSON als <code>offen</code>. Der Fortschritt bleibt beim Neuladen erhalten.</p>',
        wahl: [
          ['richtig', 'sieht richtig aus'],
          ['streifen', 'Streifen noch da'],
          ['schlechter', 'schlechter als vorher'],
          ['anderes', 'etwas anderes'],
        ],
      }),
      'utf8',
    );
    console.log(`Transparenz-Testformular geschrieben: ${OUT}`);
    console.log(`Testfälle: ${faelle.length} (Aufkleber ${tn - 1}, Modell ${mn - 1})`);
    console.log(
      'durchsichtige Anteile der drei gewählten Aufkleber:',
      aufkleber.map((k) => `${(k.anteil * 100).toFixed(0)}%`).join(', '),
    );

    // Kontrolle: Die vier Modellvarianten MÜSSEN sich unterscheiden. Wären sie
    // gleich, hätte keine der beiden Änderungen gegriffen und die Tafel wäre
    // wertlos — ein „sieht gleich aus“ wäre dann kein Befund über FF7, sondern
    // einer über eine wirkungslose Schaltung.
    const mFaelle = faelle.filter((f) => f.id.startsWith('M'));
    for (let t = 0; t < mFaelle.length; t += 4) {
      const gruppe = mFaelle.slice(t, t + 4).map((f) => f.png.toString('base64'));
      expect(new Set(gruppe).size).toBeGreaterThan(1);
      // Insbesondere muss die Transparenz für sich allein etwas ändern.
      expect(gruppe[1]).not.toBe(gruppe[0]);
    }
    expect(faelle.length).toBe(14);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
