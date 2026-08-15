import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { ff7ToScene } from '@webmidgar/convert';
import { enemyModelPrefix, parseSceneBin, type BattleFormation } from '@webmidgar/formats-battle';
import { parseP, type MeshSource, type TextureSource } from '@webmidgar/formats-model';
import { bindPoseFrame, computePose, transformPoint } from '@webmidgar/render-actor';
import {
  assignPartsToBones,
  battleSkeletonToSkeleton,
  battleToScene,
  BATTLE_ROOT_EXTRA_X_DEG,
  loadBattleModel,
  loadBattleStage,
  parseCameraBlock,
  partyModelPrefix,
  placeParty,
  stagePrefixForLocation,
  type BattleCamera,
} from '@webmidgar/render-battle';
import { NodeDirectorySource } from './node-source.js';
import { rasterize, type Bild, type Dreieck, type Vec3 } from './sheet.js';
import {
  BREITE,
  HOEHE,
  meshDreiecke,
  modellDreieckeFabrik,
  projektor,
  projiziere,
} from './battle-sheet.js';

/**
 * K3/K4/K5-ABNAHME — ein VOLLSTÄNDIGES Kampfbild: Bühne + Gegner + Party,
 * gesehen durch die Kamera, die in der Formation selbst steht.
 *
 * Warum durch die echte Kamera und nicht orthographisch wie die
 * Modelltafeln: Die Frage ist hier nicht „steht die Figur aufrecht" (das ist
 * S32 entschieden), sondern „passen Bühne, Aufstellung und Größen ZUEINANDER".
 * Diese Frage kann nur eine Ansicht beantworten, die alle drei im selben Bild
 * und in derselben Projektion zeigt. Die Vergleichsgrundlage ist die
 * Originalaufnahme eines echten Durchlaufs.
 *
 * 🟡 Der Öffnungswinkel der Kampfkamera ist NICHT aus den Daten belegt — der
 * 12-B-Kamerasatz trägt nur Position und Ziel, keinen Zoom. Er wird hier
 * durchgefahren und der Sichtvergleich entscheidet; der gewählte Wert ist
 * eine Kalibrierung, kein Formatfakt.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const available = existsSync(join(REAL_DIR, 'data', 'battle'));
const OUT = process.env['WEBMIDGAR_VOLLBILD_OUT'] ?? join(tmpdir(), 'webmidgar-sheets', 'vollbild');

/**
 * Renderkette und Bildmaße liegen seit K8 in `battle-sheet.ts` — die
 * Kameraprobe braucht dieselbe Kette, und zwei Kopien wären zwei
 * Wahrheiten (bei der Modelllage ist genau das schon einmal teuer
 * geworden, s. `modellDreieckeFabrik`).
 */

describe.skipIf(!available)('K3/K5: Vollbild eines Kampfes (Bühne + Gegner + Party)', () => {
  it('rendert Bühne, Gegner und Party durch die Szenenkamera', async () => {
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

    /** Modell in Bindpose → Dreiecke in Szenenkoordinaten (s. battle-sheet). */
    const modellDreiecke = modellDreieckeFabrik(quelle);

    // --- K3-GRÖSSENFRAGE: in welchem Verhältnis stehen Modell und Bühne? ---
    // F37 hat für FELD-Modelle den Bezugswert 512/4 = 128 kalibriert. Ob im
    // Kampf derselbe Bezug gilt, ist eine EIGENE Frage: Die Szene trägt kein
    // `modelScale`. Gemessen wird deshalb der einzige Maßstab, den die Daten
    // selbst hergeben — die Aufstellungsabstände. Zwei nebeneinander stehende
    // Gegner sind rund eine Körperbreite auseinander; damit ist die
    // Modellhöhe gegen den Platzabstand vergleichbar.
    const hoeheVon = async (prefix: string): Promise<number> => {
      const files = await loadBattleModel(prefix, quelle);
      if (!files) return 0;
      const skeleton = battleSkeletonToSkeleton(files.skeleton, prefix);
      const { boneToPart } = assignPartsToBones(files.skeleton, files.parts.length);
      const frame = { ...bindPoseFrame(skeleton), rootRotation: [BATTLE_ROOT_EXTRA_X_DEG, 0, 0] as [number, number, number] };
      const posen = computePose(skeleton, frame, true);
      let lo = Infinity;
      let hi = -Infinity;
      for (const [bone, part] of boneToPart) {
        const mat = posen[bone]?.matrix;
        if (!mat) continue;
        const mesh = files.parts[part]!;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          const m = transformPoint(mat, [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!]);
          const y = (ff7ToScene([m[0], m[1], m[2]]) as Vec3)[1];
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      }
      return hi - lo;
    };
    const hoehen: Record<string, number> = {};
    for (const p of ['rt', 'ru', 'sb', 'rw', 'aa', 'ae', 'oe']) hoehen[p] = Math.round(await hoeheVon(p));

    // KONTROLLIERTE Fassung derselben Frage: Sind die SPIELERMODELLE als
    // Gruppe kleiner als die GEGNERMODELLE? Wenn ja, um welchen Faktor —
    // das ist der gesuchte Bezugswert, und er hat mit den Gegnern eine
    // eingebaute Kontrollgruppe, die im selben Archiv und im selben Format
    // liegt.
    const spielerBand = ['rt', 'ru', 'rv', 'rw', 'rx', 'ry', 'rz', 'sa', 'sb', 'sf', 'si'];
    const gegnerBand = praefixe.slice(0, 370);
    const messe = async (liste: readonly string[]): Promise<number[]> => {
      const hs: number[] = [];
      for (const p of liste) {
        const h = await hoeheVon(p);
        if (h > 0 && Number.isFinite(h)) hs.push(h);
      }
      return hs.sort((a, b) => a - b);
    };
    const hSpieler = await messe(spielerBand);
    const hGegner = await messe(gegnerBand);
    const med = (xs: number[]): number => xs[Math.floor(xs.length / 2)] ?? 0;
    console.log(
      `K3-Bandvergleich Bindpose-Höhen: Spieler n=${hSpieler.length} Median ${med(hSpieler).toFixed(0)} ` +
        `(min ${hSpieler[0]!.toFixed(0)}, max ${hSpieler[hSpieler.length - 1]!.toFixed(0)}); ` +
        `Gegner n=${hGegner.length} Median ${med(hGegner).toFixed(0)} ` +
        `(10 % ${hGegner[Math.floor(hGegner.length * 0.1)]!.toFixed(0)}, ` +
        `90 % ${hGegner[Math.floor(hGegner.length * 0.9)]!.toFixed(0)}); ` +
        `Verhältnis Median Gegner/Spieler ${(med(hGegner) / med(hSpieler)).toFixed(2)}`,
    );
    // Aufstellungsabstände: kleinster Abstand zweier belegter Plätze je Formation.
    const abstaende: number[] = [];
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (const f of scene.formations) {
        const b = f.slots.filter((s) => s.enemyTypeId !== 0xffff);
        for (let i = 0; i < b.length; i++)
          for (let j = i + 1; j < b.length; j++)
            abstaende.push(Math.hypot(b[i]!.x - b[j]!.x, b[i]!.y - b[j]!.y, b[i]!.z - b[j]!.z));
      }
    }
    // Wo steht die GEGNERSEITE? Daraus folgt die Partyseite als Spiegelung —
    // Partypositionen selbst stehen in keiner Datei (🔵 Ersatzregel).
    const zWerte: number[] = [];
    const xWerte: number[] = [];
    for (const scene of container.scenes) {
      if (!scene) continue;
      for (const f of scene.formations)
        for (const s of f.slots)
          if (s.enemyTypeId !== 0xffff) {
            zWerte.push(s.z);
            xWerte.push(s.x);
          }
    }
    zWerte.sort((a, b) => a - b);
    xWerte.sort((a, b) => a - b);
    const q = (xs: number[], p: number): number => xs[Math.floor(xs.length * p)] ?? 0;
    console.log(
      `K3-Gegnerseite: n=${zWerte.length} Plätze; z Median ${q(zWerte, 0.5)} (10 % ${q(zWerte, 0.1)}, 90 % ${q(zWerte, 0.9)}); ` +
        `x Median ${q(xWerte, 0.5)} (10 % ${q(xWerte, 0.1)}, 90 % ${q(xWerte, 0.9)})`,
    );

    abstaende.sort((a, b) => a - b);
    const medianAbstand = abstaende[Math.floor(abstaende.length / 2)]!;
    console.log(
      `K3-Größenfrage: Bindpose-Höhen ${JSON.stringify(hoehen)}; ` +
        `Platzabstände n=${abstaende.length}, Median ${medianAbstand.toFixed(0)}, ` +
        `10 % ${abstaende[Math.floor(abstaende.length * 0.1)]!.toFixed(0)}, ` +
        `90 % ${abstaende[Math.floor(abstaende.length * 0.9)]!.toFixed(0)}`,
    );

    // DIAGNOSE: dieselbe Kette wie oben, aber ein Modell allein und
    // orthographisch eingepasst — direkt vergleichbar mit den K4-Tafeln.
    for (const prefix of ['rt', 'sb', 'ru', 'aa']) {
      const cache = new Map<TextureSource, Bild>();
      const tris = await modellDreiecke(prefix, [0, 0, 0], cache, 1);
      writeFileSync(
        join(OUT, `diagnose-${prefix}.png`),
        rasterize(tris, { transparenz: true, aufkleberVersatz: true, groesse: { w: 380, h: 470 } }),
      );
      const files = await loadBattleModel(prefix, quelle);
      const { boneToPart, unassignedParts } = assignPartsToBones(files!.skeleton, files!.parts.length);
      console.log(
        `Diagnose ${prefix}: teile=${files!.parts.length} zugeordnet=${boneToPart.size} ` +
          `unzugeordnet=${unassignedParts.length} tex=${files!.textures.length} dreiecke=${tris.length}`,
      );
    }

    // NEBENBEFUND, gemessen: Die niedrigen Gegnerpräfixe sind KEINE Modelle.
    // Für die Abnahme braucht es eine Formation mit echter Gegnergeometrie —
    // sie wird gesucht statt geraten.
    const teileVon = new Map<string, number>();
    const zaehle = async (prefix: string): Promise<number> => {
      if (teileVon.has(prefix)) return teileVon.get(prefix)!;
      const f = await loadBattleModel(prefix, quelle);
      let tris = 0;
      for (const m of f?.parts ?? []) for (const sm of m.submeshes) tris += sm.count / 3;
      teileVon.set(prefix, tris);
      return tris;
    };
    const flachePraefixe: string[] = [];
    for (const p of praefixe.slice(0, 370)) if ((await zaehle(p)) < 20) flachePraefixe.push(p);
    console.log(`Gegnerband: ${flachePraefixe.length}/370 Präfixe mit < 20 Dreiecken: ${flachePraefixe.join(' ')}`);

    const faelle: { scene: number; formation: number }[] = [];
    for (const [si, scene] of container.scenes.entries()) {
      if (!scene || faelle.length >= 3) continue;
      for (const [fi, f] of scene.formations.entries()) {
        const belegt = f.slots.filter((s) => s.enemyTypeId !== 0xffff);
        if (belegt.length < 2 || faelle.length >= 3) continue;
        let ok = true;
        for (const s of belegt) if ((await zaehle(enemyModelPrefix(s.enemyTypeId))) < 200) ok = false;
        if (ok) faelle.push({ scene: si, formation: fi });
      }
    }
    console.log(`Abnahmefälle mit echter Gegnergeometrie: ${JSON.stringify(faelle)}`);

    for (const fall of faelle) {
      const scene = container.scenes[fall.scene];
      if (!scene) continue;
      const formation: BattleFormation = scene.formations[fall.formation]!;
      const belegt = formation.slots.filter((s) => s.enemyTypeId !== 0xffff);
      if (belegt.length === 0) continue;

      const cache = new Map<TextureSource, Bild>();

      // 1. Bühne — trägt keinen Maßstab, sie ist der Bezug.
      const stagePrefix = stagePrefixForLocation(formation.location, praefixe);
      const buehne: Dreieck[] = [];
      let stageTeile = 0;
      let stageBreite = 0;
      if (stagePrefix) {
        const stage = await loadBattleStage(stagePrefix, quelle);
        if (stage) {
          stageTeile = stage.parts.length;
          let x0 = Infinity;
          let x1 = -Infinity;
          for (const mesh of stage.parts) {
            buehne.push(...meshDreiecke(mesh, stage.textures, (p) => battleToScene(p), cache));
            for (let i = 0; i < mesh.positions.length; i += 3) {
              if (mesh.positions[i]! < x0) x0 = mesh.positions[i]!;
              if (mesh.positions[i]! > x1) x1 = mesh.positions[i]!;
            }
          }
          stageBreite = x1 - x0;
        }
      }

      const partyIds = [0, 1, 2];
      const plaetze = placeParty(partyIds.length);
      const { cameras } = parseCameraBlock(formation.cameraRaw);

      // MASSSTABS-SWEEP (K3): derselbe Kampf, nur der Modellfaktor wandert.
      // Das ist dieselbe Methode, mit der F37 den Feldmaßstab entschieden hat.
      for (const faktor of [1, 4]) {
        const welt = buehne.slice();
        for (const slot of belegt) {
          const prefix = enemyModelPrefix(slot.enemyTypeId);
          welt.push(...(await modellDreiecke(prefix, battleToScene([slot.x, slot.y, slot.z]), cache, faktor)));
        }
        for (const [i, id] of partyIds.entries()) {
          const prefix = partyModelPrefix(id);
          expect(prefix).toBeTruthy();
          welt.push(...(await modellDreiecke(prefix!, plaetze[i]!, cache, faktor)));
        }
        // Zusätzlich eine NAHAUFNAHME: dieselbe Blickrichtung, aber die Kamera
        // auf 35 % der Strecke zum Ziel herangeholt und das Ziel auf
        // Brusthöhe (Battle-y = −800) gehoben. Das ändert nichts an den Daten
        // — es macht nur sichtbar, was die Weitaufnahme aus 12 000 Einheiten
        // Entfernung auf 30 Pixel zusammendrückt.
        // ÜBERSICHT: quer zur Party-Gegner-Achse. Die Szenenkamera steht im
        // Original schräg HINTER der Party — die Party ist damit um ein
        // Vielfaches näher als die Gegner und füllt das Bild mit einem
        // einzelnen Unterarm. Für die Abnahme („sind Party, Gegner und Bühne
        // gemeinsam da und stimmig groß?") braucht es eine Ansicht, in der
        // beide Reihen ähnlich weit weg sind: Battle-x quer zur z-Achse.
        const quer: BattleCamera = { position: [7000, -2600, 0], target: [0, -700, 0] };
        writeFileSync(
          join(OUT, `s${fall.scene}f${fall.formation}-loc${formation.location}-f${String(faktor).padStart(2, '0')}-quer.png`),
          rasterize(projiziere(welt, projektor(quer, 45)), {
            transparenz: true,
            aufkleberVersatz: true,
            groesse: { w: BREITE, h: HOEHE },
            fenster: { cx: 0, cy: 0, halbHoehe: 1 },
          }),
        );

        const nah: BattleCamera = {
          position: [
            Math.round(cameras[0]!.target[0] + (cameras[0]!.position[0] - cameras[0]!.target[0]) * 0.35),
            Math.round(cameras[0]!.target[1] + (cameras[0]!.position[1] - cameras[0]!.target[1]) * 0.35) - 400,
            Math.round(cameras[0]!.target[2] + (cameras[0]!.position[2] - cameras[0]!.target[2]) * 0.35),
          ],
          target: [cameras[0]!.target[0], -800, cameras[0]!.target[2]],
        };
        writeFileSync(
          join(OUT, `s${fall.scene}f${fall.formation}-loc${formation.location}-f${String(faktor).padStart(2, '0')}-nah.png`),
          rasterize(projiziere(welt, projektor(nah, 45)), {
            transparenz: true,
            aufkleberVersatz: true,
            groesse: { w: BREITE, h: HOEHE },
            fenster: { cx: 0, cy: 0, halbHoehe: 1 },
          }),
        );

        for (const fov of [45, 60]) {
          const proj = projektor(cameras[0]!, fov);
          writeFileSync(
            join(OUT, `s${fall.scene}f${fall.formation}-loc${formation.location}-f${String(faktor).padStart(2, '0')}-fov${fov}.png`),
            rasterize(projiziere(welt, proj), {
              transparenz: true,
              aufkleberVersatz: true,
              groesse: { w: BREITE, h: HOEHE },
              fenster: { cx: 0, cy: 0, halbHoehe: 1 },
            }),
          );
        }
      }
      console.log(
        `Vollbild s${fall.scene}f${fall.formation}: location=${formation.location} → ${stagePrefix} ` +
          `(${stageTeile} Teile, Bühnenbreite ${stageBreite.toFixed(0)}), ` +
          `${belegt.length} Gegner (${belegt.map((s) => enemyModelPrefix(s.enemyTypeId)).join(',')}), ` +
          `3 Party, Kamera ${JSON.stringify(cameras[0])}`,
      );
    }
    console.log(`Vollbilder: ${OUT}`);
    await dir.closeAll();
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
