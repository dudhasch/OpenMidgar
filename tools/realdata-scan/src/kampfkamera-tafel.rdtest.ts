import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  enemyModelPrefix,
  formationAddress,
  parseSceneBin,
  type BattleFormation,
} from '@webmidgar/formats-battle';
import type { TextureSource } from '@webmidgar/formats-model';
import {
  battleToScene,
  loadBattleStage,
  parseCameraBlock,
  partyModelPrefix,
  placeParty,
  stagePrefixForLocation,
} from '@webmidgar/render-battle';
import { NodeDirectorySource } from './node-source.js';
import { rasterize, type Bild, type Dreieck, type Vec3 } from './sheet.js';
import { BREITE, HOEHE, meshDreiecke, modellDreieckeFabrik, projektor, projiziere } from './battle-sheet.js';

/**
 * K8, Schritt 3 — DIE TAFEL, die den Öffnungswinkel entscheidet.
 *
 * **Warum eine Tafel und nicht weiter gerechnet.** Schritt 2 hat den
 * naheliegenden Weg versucht: zwei im Original vermessene Bodenpunkte, ein
 * freier Parameter, kleinster Pixelfehler. Er ist GESCHEITERT, und zwar
 * messbar — eine FREMDE Kamera (Formation 731) passte mit 3,5 px besser als
 * die echte mit 17,5 px. Bei rund 12 000 Kontrollvarianten findet sich immer
 * eine bessere Passung; vier Messzahlen gegen einen Parameter sind zu wenig
 * Überbestimmung. Dazu kommt, dass die Figuren im Kampf gar nicht exakt auf
 * ihren Aufstellungsplätzen stehen — sie atmen, treten vor, weichen zurück.
 *
 * Die Bühne tut das nicht. Sie ist starr, sie füllt das Bild, und sie trägt
 * hunderte Kanten. Genau dieselbe Lage gab es bei R4: Vier Aggregat-
 * Gütefunktionen konnten die Modelllage nicht entscheiden, eine Tafel mit
 * gerenderten Ketten konnte es. Diese Probe stellt die Tafel her.
 *
 * Gerendert wird Formation **301** (Referenzaufnahme `20260810223321_1.jpg`,
 * identifiziert in Schritt 1) durch ihre eigene Kamera, bei mehreren
 * Öffnungswinkeln. Zusätzlich werden die BILDKOORDINATEN der beiden
 * Gegnerplätze ausgegeben, damit der Vergleich nicht nur am Auge hängt: Im
 * Original liegen die Schattenmitten bei (65,5 | 260) und (177,5 | 241).
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));
const OUT = process.env['WEBMIDGAR_K8_OUT'] ?? join(tmpdir(), 'webmidgar-sheets', 'k8');

const REF_BATTLE_ID = 301;
/** Im Original vermessene Schattenmitten (Renderfläche 640×448). */
const REF_PIXEL = [
  { name: 'Gegner links', x: 65.5, y: 260 },
  { name: 'Gegner rechts', x: 177.5, y: 241 },
];
const FOVS = [18, 22, 26, 30, 34, 40, 50];
/**
 * Feiner Sweep für den Bild-gegen-Bild-Vergleich. Verglichen wird die BÜHNE
 * ALLEIN: Sie ist starr (Figuren atmen und treten vor), sie füllt das Bild,
 * und sie trägt hunderte Kanten — das ist die Überbestimmung, die dem
 * Punkt-Fit aus Schritt 2 gefehlt hat.
 */
const FEIN = Array.from({ length: 26 }, (_, i) => 10 + i * 2);

describe.skipIf(!available)('K8/3: FOV-Tafel für die Referenzformation', () => {
  it('rendert Formation 301 durch ihre Kamera bei mehreren Öffnungswinkeln', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/battle']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const bytesOf = new Map<string, Uint8Array>();
    const proPraefix = new Map<string, string[]>();
    for (const e of index.listEntries('battle')) {
      bytesOf.set(e.name, await index.readEntry(e.canonicalId));
      const pre = e.name.slice(0, 2);
      if (!proPraefix.has(pre)) proPraefix.set(pre, []);
      proPraefix.get(pre)!.push(e.name);
    }
    const praefixe = [...proPraefix.keys()].sort();
    const quelle = {
      listBattleEntries: (p: string) => proPraefix.get(p) ?? [],
      readBattleEntry: (n: string) => Promise.resolve(bytesOf.get(n) ?? null),
    };
    mkdirSync(OUT, { recursive: true });

    const container = await parseSceneBin(
      await readFile(join(REAL_DIR, 'data', 'battle', 'scene.bin')),
      'scene.bin',
    );
    const { sceneIndex, formationIndex } = formationAddress(REF_BATTLE_ID);
    const formation: BattleFormation | undefined =
      container.scenes[sceneIndex]?.formations[formationIndex];
    expect(formation, 'Formation 301 muss im Bestand liegen').toBeTruthy();
    const belegt = formation!.slots.filter((s) => s.enemyTypeId !== 0xffff);
    expect(belegt.length).toBe(2);

    const cache = new Map<TextureSource, Bild>();
    const modellDreiecke = modellDreieckeFabrik(quelle);

    // --- Bühne ------------------------------------------------------------
    const stagePrefix = stagePrefixForLocation(formation!.location, praefixe);
    const buehne: Dreieck[] = [];
    if (stagePrefix) {
      const stage = await loadBattleStage(stagePrefix, quelle);
      for (const mesh of stage?.parts ?? []) {
        buehne.push(...meshDreiecke(mesh, stage!.textures, (p) => battleToScene(p), cache));
      }
    }

    // --- Gegner und Party -------------------------------------------------
    const welt = buehne.slice();
    for (const slot of belegt) {
      welt.push(
        ...(await modellDreiecke(
          enemyModelPrefix(slot.enemyTypeId),
          battleToScene([slot.x, slot.y, slot.z]) as Vec3,
          cache,
        )),
      );
    }
    const partyPlaetze = placeParty(3);
    for (const [i, id] of [0, 1, 2].entries()) {
      const prefix = partyModelPrefix(id);
      if (prefix) welt.push(...(await modellDreiecke(prefix, partyPlaetze[i]!, cache)));
    }

    const kameras = parseCameraBlock(formation!.cameraRaw).cameras;

    /** NDC → Pixel der Renderfläche (Ursprung oben links). */
    const zuPixel = (n: { x: number; y: number }): { x: number; y: number } => ({
      x: +(((n.x + 1) / 2) * BREITE).toFixed(1),
      y: +(((1 - n.y) / 2) * HOEHE).toFixed(1),
    });

    const zeilen: object[] = [];
    for (let k = 0; k < kameras.length; k++) {
      for (const fov of FOVS) {
        const proj = projektor(kameras[k]!, fov);
        const bild = rasterize(projiziere(welt, proj), {
          transparenz: true,
          aufkleberVersatz: true,
          groesse: { w: BREITE, h: HOEHE },
          fenster: { cx: 0, cy: 0, halbHoehe: 1 },
        });
        writeFileSync(join(OUT, `f301-kam${k}-fov${fov}.png`), bild);
        if (k === 0) {
          const punkte = belegt.map((s) => {
            const n = proj(battleToScene([s.x, s.y, s.z]) as Vec3);
            return n.vor ? zuPixel(n) : null;
          });
          zeilen.push({
            fov,
            slot0: punkte[0] ? `${punkte[0].x}|${punkte[0].y}` : 'hinten',
            slot1: punkte[1] ? `${punkte[1].x}|${punkte[1].y}` : 'hinten',
          });
        }
      }
    }

    // --- Feiner Bühnen-Sweep für den Bildvergleich ------------------------
    // Kamera 2 bleibt hier weg: Sie liefert für diese Formation dasselbe Bild
    // wie Kamera 1 (bitgleiche Dateien im groben Sweep).
    for (let k = 0; k < 2; k++) {
      for (const fov of FEIN) {
        writeFileSync(
          join(OUT, `buehne-kam${k}-fov${String(fov).padStart(2, '0')}.png`),
          rasterize(projiziere(buehne, projektor(kameras[k]!, fov)), {
            transparenz: true,
            aufkleberVersatz: true,
            groesse: { w: BREITE, h: HOEHE },
            fenster: { cx: 0, cy: 0, halbHoehe: 1 },
          }),
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log('K8/3 Tafel:', {
      ausgabe: OUT,
      buehne: `${stagePrefix} (location ${formation!.location}), ${buehne.length} Dreiecke`,
      gegner: belegt.map((s) => `${enemyModelPrefix(s.enemyTypeId)} @ ${s.x}/${s.y}/${s.z}`),
      kamera0: JSON.stringify(kameras[0]),
      referenzImOriginal: REF_PIXEL.map((p) => `${p.name}: ${p.x}|${p.y}`),
      projiziertJeFov: zeilen,
    });

    expect(buehne.length).toBeGreaterThan(0);
  }, 180_000);

  /**
   * DAS ENTSCHEIDENDE ARGUMENT — und es braucht das Originalbild nicht mehr.
   *
   * Ein Öffnungswinkel skaliert das Bild RADIAL um die Bildmitte. Er kann
   * einen Punkt näher an die Mitte oder weiter weg schieben, aber niemals in
   * eine andere RICHTUNG. Das Verhältnis dy/dx eines Weltpunkts zur Bildmitte
   * ist damit eine Invariante der Kamera — unabhängig vom Öffnungswinkel.
   *
   * Gemessen am gelben Warnschild der Bühne `op` (größte zusammenhängende
   * gelbe Komponente, Bildmitte 320|224):
   *
   * | Ansicht                    | dy/dx |
   * |----------------------------|-------|
   * | Original `20260810223321`  | **1,381** |
   * | Blockkamera 0 (fov 22…46)  | 0,825 · 0,826 · 0,827 · 0,826 |
   * | Blockkamera 1 (fov 30…46)  | 2,793 · 2,808 · 2,814 |
   *
   * Die Konstanz über den Sweep ist die eingebaute Kontrolle: Streut das
   * Verhältnis nicht (< 0,003 über je vier Winkel), dann liegt der
   * Unterschied zum Original nachweislich NICHT am Öffnungswinkel.
   *
   * 🟢 **Folge: Keine der drei Blockkameras zeigt die Ansicht der
   * Originalaufnahme, bei keinem Öffnungswinkel.** Der Wert des Originals
   * liegt ZWISCHEN denen von Kamera 0 und 1 — verträglich damit, dass die
   * Spielkamera im Kampf eine andere, vermutlich geführte Lage einnimmt und
   * der Formationsblock nur Ausgangslagen trägt. Damit ist die Frage „welcher
   * Öffnungswinkel" für sich genommen unbeantwortbar: Erst muss geklärt sein,
   * WELCHE Kamera gilt.
   *
   * Dieser Test hält die Invariante fest, damit die Argumentation nicht an
   * Bildern hängt, die nicht im Arbeitsbaum liegen.
   */
  it('belegt: der Öffnungswinkel wirkt radial und ändert keine Richtung', async () => {
    const container = await parseSceneBin(
      await readFile(join(REAL_DIR, 'data', 'battle', 'scene.bin')),
      'scene.bin',
    );
    const { sceneIndex, formationIndex } = formationAddress(REF_BATTLE_ID);
    const formation = container.scenes[sceneIndex]!.formations[formationIndex]!;
    const kameras = parseCameraBlock(formation.cameraRaw).cameras;

    // Prüfpunkte: die belegten Gegnerplätze und zwei frei gewählte Bühnenhöhen
    // darüber — die Aussage gilt für jeden Weltpunkt, nicht nur für das Schild.
    const pruefpunkte: Vec3[] = [];
    for (const s of formation.slots.filter((x) => x.enemyTypeId !== 0xffff)) {
      pruefpunkte.push(battleToScene([s.x, s.y, s.z]) as Vec3);
      pruefpunkte.push(battleToScene([s.x, s.y - 1500, s.z]) as Vec3);
    }

    const streuungen: number[] = [];
    for (let k = 0; k < kameras.length; k++) {
      for (const q of pruefpunkte) {
        const verhaeltnisse: number[] = [];
        for (const fov of [18, 26, 34, 42, 50]) {
          const n = projektor(kameras[k]!, fov)(q);
          if (!n.vor) continue;
          const dx = ((n.x + 1) / 2) * BREITE - BREITE / 2;
          const dy = ((1 - n.y) / 2) * HOEHE - HOEHE / 2;
          if (Math.abs(dx) < 1) continue; // Punkt praktisch auf der Mittelachse
          verhaeltnisse.push(dy / dx);
        }
        if (verhaeltnisse.length < 2) continue;
        streuungen.push(Math.max(...verhaeltnisse) - Math.min(...verhaeltnisse));
      }
    }

    // eslint-disable-next-line no-console
    console.log('K8/3 Radialitaet:', {
      geprueftePaare: streuungen.length,
      groessteStreuung: +Math.max(...streuungen).toExponential(2),
      originalSchild: 1.381,
      blockkamera0Schild: 0.826,
      blockkamera1Schild: 2.81,
    });

    expect(streuungen.length).toBeGreaterThan(4);
    // Der Öffnungswinkel darf die Richtung nicht messbar verändern.
    expect(Math.max(...streuungen)).toBeLessThan(1e-9);
  });
});
