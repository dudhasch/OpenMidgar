import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import type { TextureSource } from '@webmidgar/formats-model';
import { NodeDirectorySource } from './node-source.js';
import {
  PALETTEN, dreiecke, html, ladeModelle, rasterize, texZelle, texturierteDreiecke,
  type Fall, type Modell, type Vec3,
} from './sheet.js';

/**
 * R4-B5/B6 — Bildtafel für Palettenreihenfolge, Vertexfarben und UV-Ursprung.
 *
 * **Warum eine Tafel.** Bei der Modellorientierung haben vier
 * Aggregat-Gütefunktionen dieselbe Frage viermal nicht beantwortet; entschieden
 * hat am Ende die Sichtprüfung an gerenderten Kandidaten. Farbkanäle und
 * UV-Ursprung sind vom selben Typ: Eine vertauschte Reihenfolge ändert keine
 * Statistik, die man ohne Sollbild prüfen könnte — sie ändert nur, ob das Bild
 * richtig aussieht.
 *
 * **Ergebnis der Sichtprüfung vom 2026-08-10** (Urteile des Betreibers am
 * eigenen Bestand, 26 Fälle):
 *
 *  - **B5 🟢 BGRA.** Alle vier Texturen einstimmig; jede der drei Alternativen
 *    durchgehend als „falsche Farbe“ bewertet, 12/12.
 *  - **B6a 🟢 BGRA.** Beide Modelle einstimmig, RGBA je zweimal verworfen.
 *  - **B6b 🟢 U und V roh.** Genau eine der vier Kombinationen wurde als
 *    richtig bewertet, die drei geflippten verworfen.
 *  - **Gruppe A (Tiefenregel) unentschieden — und zwar aussagekräftig:** Beide
 *    Varianten wurden als richtig bewertet, die Augen erscheinen also in
 *    beiden. Die koplanare Tiefenregel war damit **nicht** die Ursache der
 *    fehlenden Augen. Die verbliebene Auffälligkeit (Streifen über den Augen)
 *    ist eine eigene Frage und wird in `tex-transparenz-sheet` behandelt.
 *
 * **Zwei Fehler dieser Tafel, festgehalten statt überschrieben.** Im ersten
 * Anlauf trug der Prüfgegenstand zweimal die gesuchte Information nicht:
 * einmal ein Effektsprite (bei einer Flamme ist cyan als Wasser so plausibel
 * wie rot als Feuer), einmal ein im Spiel rotierendes Objekt für die
 * Ausrichtungsfrage — an dem kann keine Ausrichtung falsch sein. Auswahlkriterium
 * war beide Male „viel Textur“ statt „trägt die Frage“. Seither: mehrere
 * Texturen aus figürlichen Modellen, und für Ausrichtungsfragen ein Modell mit
 * eindeutiger Oberseite.
 *
 * **Datenschutz/Urheberrecht:** ausschließlich lokal, kein Upload. Gilt wie
 * für die Daten selbst.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const OUT =
  process.env['WEBMIDGAR_TEXSHEET_OUT'] ??
  'C:\\Users\\timur\\AppData\\Local\\Temp\\claude\\C--ff7-web\\49dab9ae-a74e-4275-bde7-8575218c5ff6\\scratchpad\\b5b6-formular.html';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: B5/B6-Testformular (Palette, Vertexfarben, UV)', () => {
  it('erzeugt ein lokales Formular mit unabhängigen Testfällen', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const modelle = await ladeModelle(dir, index);
    await dir.closeAll();

    for (const m of modelle) m.texDreiecke = texturierteDreiecke(m);
    modelle.sort((a, b) => b.texDreiecke - a.texDreiecke);
    expect(modelle.length).toBeGreaterThan(2);
    const haupt = modelle[0]!;
    expect(haupt.texDreiecke).toBeGreaterThan(20);

    // Texturen aus mehreren FIGÜRLICHEN Modellen: Bei einem Effektsprite ist
    // jede Farbe plausibel, bei einem Gesicht nicht.
    const figuren: Modell[] = [...modelle].sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length);
    const alleTex: TextureSource[] = [];
    for (const m of figuren) {
      if (alleTex.length >= 4) break;
      for (const liste of m.res.values()) {
        for (const { texturen } of liste) {
          for (const t of texturen) if (t && !alleTex.includes(t) && alleTex.length < 4) alleTex.push(t);
        }
      }
    }

    const faelle: Fall[] = [];

    // --- Gruppe 1: Palettenreihenfolge, am Texturbild selbst.
    //
    // Bewusst am Bild statt am Modell: Auf dem Modell nimmt die texturierte
    // Fläche nur einen Bruchteil ein, und dieselbe Vertauschung geht dort
    // unter.
    let pn = 1;
    for (const [ti, tex] of alleTex.entries()) {
      for (const palette of Object.keys(PALETTEN)) {
        faelle.push({
          id: `P${pn++}`,
          gruppe: '1 — Palettenreihenfolge im .tex (B5)',
          frage: 'Welche Zellen zeigen plausible Farben? Hauttöne, Augen und Münder sind eindeutig; Effektsprites bewusst mit Vorsicht beurteilen.',
          variante: palette,
          detail: `Textur ${ti + 1} · ${tex.width}×${tex.height}`,
          png: texZelle(tex, PALETTEN[palette]!),
        });
      }
    }

    // --- Gruppe 2: UV-Ursprung, am Modell.
    //
    // Unabhängig von der Palette: Ein geflipptes Bild ist geflippt, egal in
    // welchen Farben. Deshalb hier eine feste Palette und nur die vier
    // UV-Kombinationen — und ein Modell mit eindeutiger Oberseite.
    const gesicht = figuren.find((m) => texturierteDreiecke(m) > 0) ?? haupt;
    let un = 1;
    for (const flipV of [false, true]) {
      for (const flipU of [false, true]) {
        faelle.push({
          id: `U${un++}`,
          gruppe: '2 — UV-Ursprung (B6b)',
          frage: 'Welche Zelle zeigt die Textur richtig herum? Nur auf Ausrichtung achten (Augen über Mund), nicht auf Farbe — die entscheidet Gruppe 1.',
          variante: `V ${flipV ? 'geflippt' : 'roh'} · U ${flipU ? 'geflippt' : 'roh'}`,
          detail: `figürliches Modell · ${gesicht.skeleton.bones.length} Bones · Palette BGRA`,
          png: rasterize(dreiecke(gesicht, { palette: 'BGRA (heute)', flipV, flipU, vertexPerm: null }), {
            spaetereGewinnen: true,
          }),
        });
      }
    }

    // --- Gruppe 4: Tiefenregel bei koplanaren Flächen.
    let an = 1;
    for (const spaeter of [false, true]) {
      faelle.push({
        id: `A${an++}`,
        gruppe: '4 — Augen: Tiefenregel bei koplanaren Flächen',
        frage: 'In welcher Zelle sind die Augen sichtbar? Die Augentexturen sind nachweislich geladen (626/626 Flächen auflösbar) — es geht nur darum, ob sie das Gesicht überdecken dürfen.',
        variante: spaeter ? 'spätere Fläche gewinnt bei Gleichstand' : 'frühere gewinnt (bisher)',
        detail: `figürliches Modell · ${gesicht.skeleton.bones.length} Bones`,
        png: rasterize(dreiecke(gesicht, { palette: 'BGRA (heute)', flipV: false, flipU: false, vertexPerm: null }), {
          spaetereGewinnen: spaeter,
        }),
      });
    }

    // --- Gruppe 3: Vertexfarben, Texturen abgeschaltet.
    //
    // Ohne Abschalten der Texturen verdecken genau die Flächen die Antwort, an
    // denen sie sichtbar wäre.
    const VERTEX: Record<string, (r: number, g: number, b: number) => Vec3> = {
      'BGRA (heute)': (r, g, b) => [r, g, b],
      'RGBA': (r, g, b) => [b, g, r],
    };
    let vn = 1;
    for (const [n, m] of figuren.slice(0, 2).entries()) {
      for (const [name, fn] of Object.entries(VERTEX)) {
        faelle.push({
          id: `V${vn++}`,
          gruppe: '3 — Vertexfarben (B6a), Texturen aus',
          frage: 'Welche Zellen zeigen glaubhafte Haut-, Haar- und Kleidungsfarben?',
          variante: name,
          detail: `Modell ${n + 1} · ${m.skeleton.bones.length} Bones`,
          png: rasterize(dreiecke(m, { palette: 'BGRA (heute)', flipV: false, flipU: false, vertexPerm: fn })),
        });
      }
    }

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      html(faelle, {
        titel: 'B5/B6 — Farbkanäle und UV-Ursprung',
        speicher: 'b5b6-urteile',
        kennung: 'b5b6',
        einleitung:
          '<p>Bitte je Fall eine Auswahl treffen. Unbeantwortete Fälle sind erlaubt — sie erscheinen im JSON als <code>offen</code>. Der Fortschritt bleibt beim Neuladen erhalten.</p>' +
          '<p><b>Hinweis:</b> Zwei Zellen derselben Textur können <i>identisch</i> aussehen. Das ist kein Fehler: Bei grauen Palettenfarben (R&nbsp;=&nbsp;G&nbsp;=&nbsp;B) fallen Kanalvertauschungen zusammen. Solche Paare bitte gleich bewerten — sie tragen zur Entscheidung schlicht nichts bei.</p>',
        wahl: [
          ['richtig', 'richtig'],
          ['falsche-farbe', 'falsche Farbe'],
          ['anderes', 'etwas anderes'],
        ],
      }),
      'utf8',
    );
    console.log(`B5/B6-Testformular geschrieben: ${OUT}`);
    console.log(`Testfälle: ${faelle.length} (Palette ${pn - 1}, UV ${un - 1}, Vertexfarben ${vn - 1}, Augen ${an - 1})`);

    // Kontrolle: Je Textur müssen sich die vier Auslegungen unterscheiden —
    // sonst wäre der Texturpfad tot und das Formular wertlos.
    //
    // ABER: Vollständige Verschiedenheit ist NICHT zu erwarten. Hat eine
    // Palette graue Einträge (R = G = B), fallen Permutationen zusammen; bei
    // A = R gilt dasselbe für die Alpha-Varianten. Gemessen wird deshalb, dass
    // je Textur mindestens zwei verschiedene Bilder entstehen, und die Zahl
    // der zusammenfallenden Paare wird berichtet statt weggeprüft.
    const pFaelle = faelle.filter((f) => f.id.startsWith('P'));
    let entartet = 0;
    for (let t = 0; t < pFaelle.length; t += 4) {
      const gruppe = pFaelle.slice(t, t + 4).map((f) => f.png.toString('base64').slice(0, 96));
      const verschieden = new Set(gruppe).size;
      expect(verschieden).toBeGreaterThan(1);
      entartet += 4 - verschieden;
    }
    console.log(`zusammenfallende Palettenvarianten (graue Paletten): ${entartet} von ${pFaelle.length}`);
    expect(faelle.length).toBe(26);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
