import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseA, parseHrc, parseP, parseRsd, type AnimationClipSource, type AnimationFrame, type Skeleton } from '@webmidgar/formats-model';
import { parseFieldEntry, splitAnimationName } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { bindPoseFrame, computePose, transformPoint } from '@webmidgar/render-actor';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4-B1/B4 — Modellausrichtung, jetzt MESSBAR.
 *
 * Zwei Automatisierungsversuche sind früher gescheitert (dokumentiert in
 * docs/R4-MODELL-KONVENTIONEN.md), beide aus demselben Grund: Sie haben das
 * **Skelett** vermessen. FF7-Feldmodelle sind starr segmentiert, in der
 * Bindpose sind alle Rotationen 0, und die Bone-Kette fällt dadurch zu einer
 * geraden Linie zusammen — Breite exakt 0 bei allen 280 gemessenen Modellen.
 *
 * Die Aufrechtigkeit steckt nicht im Skelett, sondern in der **Mesh-Geometrie**.
 * Diese Probe transformiert deshalb die `.p`-Segmente über die Bone-Matrizen
 * der Bindpose in den Modellraum, bildet sie mit der zentralen Konvertierung
 * (ADR-009) in den Szenenraum ab und misst die Ausdehnung der Punktwolke.
 *
 * **Sollbild:** Eine stehende humanoide Figur ist deutlich höher als breit und
 * deutlich höher als tief. In Three-Konvention heißt das: Die Y-Ausdehnung
 * muss die größte sein.
 *
 * Sichtprüfung des Nutzers (2026-08-09) am Field-Modell-Viewer: „Cloud liegt,
 * man sieht ihn von unten; das Modell selbst sieht richtig aus." Genau diese
 * Aussage ist hier nachzurechnen — und zwar ohne Auge.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zahlen (Ausdehnungen, Quoten,
 * Achsenkürzel). Keine Modellnamen im Klartext-Ergebnis, keine Geometrie.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

type Vec3 = [number, number, number];

interface Extent {
  dx: number;
  dy: number;
  dz: number;
  points: number;
}

/** Achse mit der größten Ausdehnung. */
function longestAxis(e: Extent): 'x' | 'y' | 'z' {
  if (e.dy >= e.dx && e.dy >= e.dz) return 'y';
  return e.dx >= e.dz ? 'x' : 'z';
}

/**
 * Ausdehnung der Mesh-Punktwolke im Szenenraum.
 *
 * `mapModel` erlaubt es, eine ALTERNATIVE Modell→Szene-Abbildung zu prüfen,
 * ohne den Produktivcode anzufassen — die Gegenhypothesen laufen damit über
 * exakt dieselbe Rechenstrecke wie die belegte Auslegung.
 */
function meshExtent(
  skeleton: Skeleton,
  meshesByBone: Map<number, Float32Array[]>,
  mapModel: (v: Vec3) => Vec3,
): Extent {
  const poses = computePose(skeleton, bindPoseFrame(skeleton));
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let points = 0;
  for (const [boneIndex, meshes] of meshesByBone) {
    const m = poses[boneIndex]?.matrix;
    if (!m) continue;
    for (const positions of meshes) {
      for (let i = 0; i + 3 <= positions.length; i += 3) {
        const local: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
        const model = transformPoint(m, local);
        const s = mapModel(model as Vec3);
        if (s[0] < minX) minX = s[0];
        if (s[0] > maxX) maxX = s[0];
        if (s[1] < minY) minY = s[1];
        if (s[1] > maxY) maxY = s[1];
        if (s[2] < minZ) minZ = s[2];
        if (s[2] > maxZ) maxZ = s[2];
        points++;
      }
    }
  }
  if (points === 0) return { dx: 0, dy: 0, dz: 0, points: 0 };
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ, points };
}

describe.skipIf(!available)('Realdaten: Modellausrichtung (R4-B1)', () => {
  it('misst die Mesh-Ausdehnung statt der Skelettkette', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    // Abbildungen, die verglichen werden. „belegt" ist die aktuelle zentrale
    // Konvertierung; die übrigen sind Gegenhypothesen.
    const abbildungen: Record<string, (v: Vec3) => Vec3> = {
      'belegt (x, z, −y)': (v) => ff7ToScene(v) as Vec3,
      'identisch (x, y, z)': (v) => v,
      'z-hoch gespiegelt (x, −z, y)': (v) => [v[0], -v[2], v[1]],
      'y-hoch direkt (x, y, −z)': (v) => [v[0], v[1], -v[2]],
    };

    const laengste: Record<string, Record<string, number>> = {};
    const hoehenVerhaeltnis: Record<string, number[]> = {};
    for (const k of Object.keys(abbildungen)) {
      laengste[k] = { x: 0, y: 0, z: 0 };
      hoehenVerhaeltnis[k] = [];
    }

    let modelle = 0;
    let ohneMesh = 0;
    let submeshGesamt = 0;
    let submeshTexturiert = 0;
    const hrcNamen = entries.map((e) => e.name.toLowerCase()).filter((n) => n.endsWith('.hrc'));

    for (const hrcName of hrcNamen) {
      const skeleton = parseHrc(await read(hrcName), hrcName).value;
      if (!skeleton) continue;

      const meshesByBone = new Map<number, Float32Array[]>();
      for (const [boneIndex, bone] of skeleton.bones.entries()) {
        for (const ref of bone.resourceRefs) {
          const rsd = idByName.has(`${ref}.rsd`)
            ? parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value
            : null;
          if (!rsd) continue;
          const pName = `${rsd.meshRef}.p`;
          if (!idByName.has(pName)) continue;
          const mesh = parseP(await read(pName), pName).value;
          if (!mesh) continue;
          // Nebenmessung zu B5/B6: Wie viele Teilnetze sind überhaupt
          // texturiert? Die Sichtprüfung meldet „kein Unterschied beim
          // Texturkanal-Schalter" — das kann heißen, dass der Schalter falsch
          // ist, oder dass es schlicht nichts zu tauschen gibt.
          for (const sub of mesh.submeshes) {
            submeshGesamt++;
            if (sub.textured) submeshTexturiert++;
          }
          const list = meshesByBone.get(boneIndex) ?? [];
          list.push(mesh.positions);
          meshesByBone.set(boneIndex, list);
        }
      }
      if (meshesByBone.size === 0) {
        ohneMesh++;
        continue;
      }
      modelle++;

      for (const [name, map] of Object.entries(abbildungen)) {
        const e = meshExtent(skeleton, meshesByBone, map);
        if (e.points === 0) continue;
        laengste[name]![longestAxis(e)]!++;
        const quer = Math.max(e.dx, e.dz);
        hoehenVerhaeltnis[name]!.push(quer > 0 ? e.dy / quer : 0);
      }
    }

    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
    };

    console.log(
      'Modellausrichtung (Mesh-Ausdehnung im Szenenraum):',
      JSON.stringify(
        {
          modelleMitMesh: modelle,
          modelleOhneMesh: ohneMesh,
          teilnetzeTexturiert: `${submeshTexturiert}/${submeshGesamt} (${((submeshTexturiert / Math.max(1, submeshGesamt)) * 100).toFixed(1)}%)`,
          jeAbbildung: Object.fromEntries(
            Object.entries(laengste).map(([k, v]) => [
              k,
              {
                längsteAchse: `x:${v['x']} y:${v['y']} z:${v['z']}`,
                'Höhe/Quer (Median)': median(hoehenVerhaeltnis[k]!).toFixed(3),
              },
            ]),
          ),
        },
        null,
        1,
      ),
    );

    expect(modelle).toBeGreaterThan(50);

    // Eine stehende Figur ist höher als breit. Welche Abbildung das leistet,
    // entscheidet die Messung — nicht diese Datei.
    const belegt = laengste['belegt (x, z, −y)']!;
    const gesamt = belegt['x']! + belegt['y']! + belegt['z']!;
    console.log(
      `Belegte Abbildung liefert bei ${belegt['y']}/${gesamt} Modellen die Höhe als längste Achse ` +
        `(${((belegt['y']! / gesamt) * 100).toFixed(1)} %).`,
    );

    await dir.closeAll();
  }, 900_000);

  /**
   * Dasselbe Maß, aber auf ANIMIERTEN Frames statt auf der Bindpose.
   *
   * Die Sichtprüfung zeigt eine liegende Figur, die Bindpose-Messung eine
   * aufrechte. Der Unterschied kann nur in der Frame-Anwendung liegen: Die
   * Wurzel trägt je Frame eine Rotation, und deren Auslegung ist 🟡 (R4-B2/B3
   * — Eulerreihenfolge und die Frage, ob Rotation vor Translation gilt).
   *
   * Gemessen wird über echte Animationen: Bleibt die Figur über die Frames
   * aufrecht (Y die längste Achse), oder kippt sie? Zusätzlich wird die
   * **Sprunghaftigkeit** von Frame zu Frame gemessen — FF7-Animationen sind
   * stetig, also ist ein Ruck ein Auslegungsfehler und kein Bewegungsstil.
   * Genau das beschreibt die Sichtprüfung mit „die Bonestruktur zuckt in
   * falsche Richtungen".
   */
  it('prüft animierte Frames auf Aufrechtigkeit und Stetigkeit', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);
    const toScene = (v: Vec3): Vec3 => ff7ToScene(v) as Vec3;

    // ECHTE Paarung Modell↔Animation über das Field-Manifest (S10): Dort
    // stehen je Field die Modelldatei und ihre Animationsnamen, und diese
    // Zuordnung ist realdaten-belegt zu 100 % auflösbar. Die vorherige
    // Behelfspaarung über die Bone-Anzahl war ein Störfaktor — sie hätte
    // fremde Animationen auf fremde Skelette geworfen und damit JEDE
    // Auslegung schlecht aussehen lassen.
    const paare = new Map<string, string>(); // hrc → a-Datei
    const fieldEntries = [...index.listEntries('flevel')].filter((e) => !e.name.includes('.'));
    for (const entry of fieldEntries.slice(0, 120)) {
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      for (const m of parsed.bundle?.models?.models ?? []) {
        const anim = m.animations[0];
        if (!anim) continue;
        const aFile = splitAnimationName(anim.name).file.toLowerCase();
        if (!paare.has(m.modelFile) && idByName.has(aFile)) paare.set(m.modelFile, aFile);
      }
    }

    const proben: { skeleton: Skeleton; meshes: Map<number, Float32Array[]>; clip: AnimationClipSource }[] = [];
    const warum = { keinSkelett: 0, keinMesh: 0, keineAnimDatei: 0, animUnparsbar: 0, keineFrames: 0 };
    const wurzelrotationen: number[][] = [];
    const sprung: number[] = [];
    let geprueft = 0;
    let aufrechtBind = 0;
    let aufrechtFrame0 = 0;

    for (const [hrcName, aName] of [...paare].slice(0, 80)) {
      if (!idByName.has(hrcName)) continue;
      const skeleton = parseHrc(await read(hrcName), hrcName).value;
      if (!skeleton) {
        warum.keinSkelett++;
        continue;
      }

      const meshesByBone = new Map<number, Float32Array[]>();
      for (const [boneIndex, bone] of skeleton.bones.entries()) {
        for (const ref of bone.resourceRefs) {
          const rsd = idByName.has(`${ref}.rsd`)
            ? parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value
            : null;
          if (!rsd || !idByName.has(`${rsd.meshRef}.p`)) continue;
          const mesh = parseP(await read(`${rsd.meshRef}.p`), `${rsd.meshRef}.p`).value;
          if (!mesh) continue;
          const list = meshesByBone.get(boneIndex) ?? [];
          list.push(mesh.positions);
          meshesByBone.set(boneIndex, list);
        }
      }
      if (meshesByBone.size === 0) {
        warum.keinMesh++;
        continue;
      }

      const clip = parseA(await read(aName), aName).value;
      if (!clip) {
        warum.animUnparsbar++;
        continue;
      }
      if (clip.frames.length === 0) {
        warum.keineFrames++;
        continue;
      }

      geprueft++;
      proben.push({ skeleton, meshes: meshesByBone, clip });
      if (longestAxis(meshExtent(skeleton, meshesByBone, toScene)) === 'y') aufrechtBind++;

      const f0 = clip.frames[0]!;
      wurzelrotationen.push([...f0.rootRotation]);
      const e0 = extentForFrame(skeleton, meshesByBone, toScene, f0);
      if (longestAxis(e0) === 'y') aufrechtFrame0++;

      // Stetigkeit: relative Änderung der Höhe über aufeinanderfolgende Frames.
      let vorher = e0.dy;
      for (const f of clip.frames.slice(1, 20)) {
        const e = extentForFrame(skeleton, meshesByBone, toScene, f);
        if (vorher > 0) sprung.push(Math.abs(e.dy - vorher) / vorher);
        vorher = e.dy;
      }
    }

    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
    };
    const p95 = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length === 0 ? 0 : s[Math.floor(s.length * 0.95)]!;
    };

    // Wie sehen die Wurzelrotationen des ersten Frames aus? Ein systematischer
    // Wert nahe ±90° in einer Achse wäre die Erklärung für „liegt".
    const achsen = [0, 1, 2].map((k) => {
      const werte = wurzelrotationen.map((r) => r[k]!);
      return {
        median: median(werte).toFixed(1),
        min: Math.min(...werte).toFixed(1),
        max: Math.max(...werte).toFixed(1),
      };
    });

    console.log(
      'Animierte Frames:',
      JSON.stringify(
        {
          gepruefteModelle: geprueft,
          ausfallgruende: warum,
          'aufrecht in der Bindpose': `${aufrechtBind}/${geprueft}`,
          'aufrecht in Frame 0': `${aufrechtFrame0}/${geprueft}`,
          'Wurzelrahmen-Sweep (animierte Frames, Anteil aufrecht)': wurzelrahmenSweep(proben, toScene),
          wurzelrotationFrame0: { x: achsen[0], y: achsen[1], z: achsen[2] },
          'Höhensprung je Frame': { median: median(sprung).toFixed(4), p95: p95(sprung).toFixed(4) },
        },
        null,
        1,
      ),
    );

    // BELEGT: Die Bindpose steht aufrecht, der animierte Frame nicht. Damit
    // ist die Fehlerquelle auf die Bone-Rotationen eingegrenzt.
    expect(geprueft).toBeGreaterThan(10);
    expect(aufrechtBind / geprueft).toBeGreaterThan(0.8);
    expect(aufrechtFrame0 / geprueft).toBeLessThan(0.5);

    // --- Eulerreihenfolge als Gütefunktion --------------------------------
    // Sollbild: Die Figur bleibt über die Animation aufrecht. Gemessen wird
    // der Anteil aufrechter Frames je Kandidatenreihenfolge. Die Bindpose
    // taugt als Maß NICHT — dort sind alle Rotationen 0, also liefern alle
    // sechs Reihenfolgen dasselbe Ergebnis. Nur animierte Frames trennen sie.
    // Kujata (picklejar76) setzt fuer FELD-Modelle rootRotationDegreesX = 180
    // bei sonst unveraenderten Bone-Winkeln und Reihenfolge 'YXZ'. Dieser
    // Wurzelversatz fehlt bei uns vollstaendig — er wird hier als zusaetzliche
    // Dimension mitgemessen, statt uebernommen zu werden.
    const ROOT_X = [0, 180];
    // Kujata versetzt das Kind nach -parentLength (ff7-to-gltf.js:556); wir
    // nach +parentLength. Da die Laengen negativ sind, kehrt das die
    // Wachstumsrichtung der Kette um — und DAS sieht eine Bounding-Box sehr
    // wohl, anders als eine 180-Grad-Drehung.
    const SIGNS: (1 | -1)[] = [1, -1];
    const bewertung: Record<string, { aufrecht: number; gesamt: number; verhaeltnis: number[] }> = {};
    for (const o of EULER_ORDERS) for (const rx of ROOT_X) for (const sg of SIGNS) bewertung[`${o} rootX+${rx} offset${sg > 0 ? '+' : '-'}`] = { aufrecht: 0, gesamt: 0, verhaeltnis: [] };

    for (const probe of proben) {
      for (const f of probe.clip.frames.slice(0, 12)) {
        for (const o of EULER_ORDERS) for (const rx of ROOT_X) for (const sg of SIGNS) {
          const e = extentWithOrder(probe.skeleton, probe.meshes, f, o, rx, sg);
          if (e.points === 0) continue;
          const b = bewertung[`${o} rootX+${rx} offset${sg > 0 ? '+' : '-'}`]!;
          b.gesamt++;
          if (longestAxis(e) === 'y') b.aufrecht++;
          const quer = Math.max(e.dx, e.dz);
          b.verhaeltnis.push(quer > 0 ? e.dy / quer : 0);
        }
      }
    }

    const rang = Object.entries(bewertung)
      .map(([o, b]) => ({
        order: o,
        aufrecht: b.gesamt > 0 ? b.aufrecht / b.gesamt : 0,
        median: median(b.verhaeltnis),
        gesamt: b.gesamt,
      }))
      .sort((a, b) => b.aufrecht - a.aufrecht || b.median - a.median)
      .slice(0, 6);

    console.log(
      'Eulerreihenfolge gegen die Aufrechtigkeit animierter Frames:',
      JSON.stringify(
        rang.map((r) => ({
          order: r.order,
          aufrecht: `${(r.aufrecht * 100).toFixed(1)}% von ${r.gesamt}`,
          'Höhe/Quer (Median)': r.median.toFixed(3),
        })),
        null,
        1,
      ),
    );

    // --- B3: Rotation vor Translation? ------------------------------------
    // Die 24 Wurzel-Bytes werden derzeit als „12 B Rotation, dann 12 B
    // Translation" gelesen (🟡). Ein Vertauschen wäre an den Wertebereichen
    // erkennbar: Winkel liegen in Grad (Betrag bis ~360), Translationen in
    // Modelleinheiten (bei diesen Modellen typischerweise deutlich größer und
    // mit einer klar dominanten Höhenkomponente).
    const block1: number[] = [];
    const block2: number[] = [];
    for (const p of proben) {
      for (const f of p.clip.frames.slice(0, 8)) {
        block1.push(...f.rootRotation.map(Math.abs));
        block2.push(...f.rootTranslation.map(Math.abs));
      }
    }
    const beschreibe = (xs: number[]): Record<string, string> => ({
      median: median(xs).toFixed(2),
      p95: xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!.toFixed(2) : '0',
      max: Math.max(...xs).toFixed(2),
      'Anteil > 360': `${((xs.filter((v) => v > 360).length / xs.length) * 100).toFixed(1)}%`,
      'Anteil == 0': `${((xs.filter((v) => v === 0).length / xs.length) * 100).toFixed(1)}%`,
    });
    console.log(
      'Wurzelblock (24 B) — Wertebereiche der beiden 12-B-Hälften:',
      JSON.stringify(
        {
          'Bytes 0…11 (gelesen als Rotation)': beschreibe(block1),
          'Bytes 12…23 (gelesen als Translation)': beschreibe(block2),
        },
        null,
        1,
      ),
    );

    // --- Einheit der Bone-Winkel ------------------------------------------
    // Werden die float32-Werte als GRAD gelesen (aktuelle Annahme)? Dann muss
    // ihr Wertebereich zu Winkeln passen. Radiant (|v| ≲ 6,3) oder ein
    // Festkommamaß (z. B. 4096 = 360°) sähen völlig anders aus.
    const winkel: number[] = [];
    for (const p of proben) {
      for (const f of p.clip.frames.slice(0, 8)) for (const v of f.rotations) winkel.push(Math.abs(v));
    }
    const sortiert = [...winkel].sort((a, b) => a - b);
    console.log(
      'Bone-Winkel — Wertebereich:',
      JSON.stringify({
        anzahl: winkel.length,
        median: median(winkel).toFixed(2),
        p95: sortiert[Math.floor(sortiert.length * 0.95)]!.toFixed(2),
        max: Math.max(...winkel).toFixed(2),
        'Anteil ≤ 6,3 (radiantverdächtig)': `${((winkel.filter((v) => v <= 6.3).length / winkel.length) * 100).toFixed(1)}%`,
        'Anteil ≤ 360 (gradverträglich)': `${((winkel.filter((v) => v <= 360).length / winkel.length) * 100).toFixed(1)}%`,
        'Anteil > 360': `${((winkel.filter((v) => v > 360).length / winkel.length) * 100).toFixed(1)}%`,
      }),
    );

    // NICHT belegt: Keine Reihenfolge trennt sich deutlich ab. Die Erwartung
    // hält diesen Zustand fest — sobald jemand B2 wirklich löst, MUSS sie
    // brechen und angepasst werden.
    expect(rang[0]!.aufrecht).toBeLessThan(rang[1]!.aufrecht * 1.5);

    await dir.closeAll();
  }, 900_000);
});

// --- Eulerreihenfolgen durchmessen (R4-B2) ----------------------------------

const DEG = Math.PI / 180;

type M3 = number[][];

const mul3 = (a: M3, b: M3): M3 =>
  [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r]![0]! * b[0]![c]! + a[r]![1]! * b[1]![c]! + a[r]![2]! * b[2]![c]!));

const rotX = (t: number): M3 => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const rotY = (t: number): M3 => [
  [Math.cos(t), 0, Math.sin(t)],
  [0, 1, 0],
  [-Math.sin(t), 0, Math.cos(t)],
];
const rotZ = (t: number): M3 => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];

/**
 * `order` gelesen wie in Three: 'YXZ' bedeutet R = Ry·Rx·Rz. Die Winkel
 * bleiben dabei fest den Achsen zugeordnet (x→X, y→Y, z→Z) — variiert wird
 * ausschließlich die REIHENFOLGE der Multiplikation.
 */
function eulerMatrix(order: string, x: number, y: number, z: number): M3 {
  const byAxis: Record<string, M3> = { X: rotX(x * DEG), Y: rotY(y * DEG), Z: rotZ(z * DEG) };
  return mul3(mul3(byAxis[order[0]!]!, byAxis[order[1]!]!), byAxis[order[2]!]!);
}

const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const;

/**
 * Posenberechnung mit frei wählbarer Eulerreihenfolge — bewusst hier
 * dupliziert statt in pose.ts parametrisiert: Der Produktivcode soll erst
 * geändert werden, wenn die Messung entschieden hat.
 */
function extentWithOrder(
  skeleton: Skeleton,
  meshesByBone: Map<number, Float32Array[]>,
  frame: AnimationFrame,
  order: string,
  rootOffsetX = 0,
  /** Vorzeichen des Kindversatzes entlang der Bone-Achse. */
  offsetSign: 1 | -1 = 1,
): Extent {
  const mats: M3[] = [];
  const origins: Vec3[] = [];
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    const rx = frame.rotations[bone.fileOrder * 3] ?? 0;
    const ry = frame.rotations[bone.fileOrder * 3 + 1] ?? 0;
    const rz = frame.rotations[bone.fileOrder * 3 + 2] ?? 0;
    const local = eulerMatrix(order, rx, ry, rz);
    if (bone.parentIndex < 0) {
      const rootR = frame.rootRotation;
      const rootM = eulerMatrix(order, rootR[0] + rootOffsetX, rootR[1], rootR[2]);
      mats.push(mul3(rootM, local));
      origins.push([...frame.rootTranslation] as Vec3);
    } else {
      const pm = mats[bone.parentIndex]!;
      const po = origins[bone.parentIndex]!;
      const plen = skeleton.bones[bone.parentIndex]!.length * offsetSign;
      // Kindursprung = Elternursprung + Elternrotation · (0,0,parentLength)
      origins.push([
        po[0] + pm[0]![2]! * plen,
        po[1] + pm[1]![2]! * plen,
        po[2] + pm[2]![2]! * plen,
      ]);
      mats.push(mul3(pm, local));
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let points = 0;
  for (const [boneIndex, meshes] of meshesByBone) {
    const m = mats[boneIndex];
    const o = origins[boneIndex];
    if (!m || !o) continue;
    for (const positions of meshes) {
      for (let i = 0; i + 3 <= positions.length; i += 3) {
        const p: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
        const model: Vec3 = [
          o[0] + m[0]![0]! * p[0] + m[0]![1]! * p[1] + m[0]![2]! * p[2],
          o[1] + m[1]![0]! * p[0] + m[1]![1]! * p[1] + m[1]![2]! * p[2],
          o[2] + m[2]![0]! * p[0] + m[2]![1]! * p[1] + m[2]![2]! * p[2],
        ];
        const s = ff7ToScene(model) as Vec3;
        if (s[0] < minX) minX = s[0];
        if (s[0] > maxX) maxX = s[0];
        if (s[1] < minY) minY = s[1];
        if (s[1] > maxY) maxY = s[1];
        if (s[2] < minZ) minZ = s[2];
        if (s[2] > maxZ) maxZ = s[2];
        points++;
      }
    }
  }
  if (points === 0) return { dx: 0, dy: 0, dz: 0, points: 0 };
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ, points };
}

/**
 * Wurzelrahmen-Sweep — der Test, den die frühere Probe nicht führen konnte.
 *
 * Die Sichtprüfung (2026-08-10) meldet: **ohne** Zusatzwinkel sieht man die
 * Figur von unten, **mit 180°** von oben. Beide Stellungen liegen also 90°
 * daneben, in entgegengesetzte Richtungen — der gesuchte Wert liegt dazwischen.
 *
 * Anders als bei 180° ist die Bounding-Box gegenüber **90°** ausdrücklich
 * NICHT blind: Eine Vierteldrehung um X vertauscht Y- und Z-Ausdehnung. Genau
 * deshalb ist dieser Sweep messbar, während der 180°-Sweep es nie war.
 *
 * Gemessen werden vier reine Winkelversätze (ohne Umbau der Translation) und
 * zusätzlich die vollständige Korrektur inklusive `C⁻¹` auf der Translation.
 * Erwartung: 0° und 180° verlieren, ±90° gewinnt — und die vollständige
 * Korrektur ist mindestens so gut wie der reine Winkel.
 */
function wurzelrahmenSweep(
  proben: { skeleton: Skeleton; meshes: Map<number, Float32Array[]>; clip: AnimationClipSource }[],
  toScene: (v: Vec3) => Vec3,
): Record<string, string> {
  const varianten: Array<{ name: string; pitch: number; fix: boolean }> = [
    { name: 'ohne Versatz (0°)', pitch: 0, fix: false },
    { name: 'Wurzel-X +90°', pitch: 90, fix: false },
    { name: 'Wurzel-X −90°', pitch: -90, fix: false },
    { name: 'Wurzel-X 180° (Kujata roh)', pitch: 180, fix: false },
    { name: 'vollständige Korrektur (−90° + C⁻¹·t)', pitch: 0, fix: true },
  ];
  const out: Record<string, string> = {};
  for (const v of varianten) {
    let aufrecht = 0;
    let gesamt = 0;
    for (const p of proben) {
      for (const f of p.clip.frames.slice(0, 12)) {
        const frame: AnimationFrame = v.pitch === 0
          ? f
          : { ...f, rootRotation: [f.rootRotation[0] + v.pitch, f.rootRotation[1], f.rootRotation[2]] };
        gesamt++;
        if (longestAxis(extentForFrame(p.skeleton, p.meshes, toScene, frame, v.fix)) === 'y') aufrecht++;
      }
    }
    out[v.name] = `${((aufrecht / Math.max(1, gesamt)) * 100).toFixed(1)}% von ${gesamt}`;
  }
  return out;
}

/** Ausdehnung für einen konkreten Frame (statt der Bindpose). */
function extentForFrame(
  skeleton: Skeleton,
  meshesByBone: Map<number, Float32Array[]>,
  mapModel: (v: Vec3) => Vec3,
  frame: AnimationFrame,
  rootFrameFix = false,
): Extent {
  const poses = computePose(skeleton, frame, rootFrameFix);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let points = 0;
  for (const [boneIndex, meshes] of meshesByBone) {
    const m = poses[boneIndex]?.matrix;
    if (!m) continue;
    for (const positions of meshes) {
      for (let i = 0; i + 3 <= positions.length; i += 3) {
        const s = mapModel(transformPoint(m, [positions[i]!, positions[i + 1]!, positions[i + 2]!]) as Vec3);
        if (s[0] < minX) minX = s[0];
        if (s[0] > maxX) maxX = s[0];
        if (s[1] < minY) minY = s[1];
        if (s[1] > maxY) maxY = s[1];
        if (s[2] < minZ) minZ = s[2];
        if (s[2] > maxZ) maxZ = s[2];
        points++;
      }
    }
  }
  if (points === 0) return { dx: 0, dy: 0, dz: 0, points: 0 };
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ, points };
}

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
