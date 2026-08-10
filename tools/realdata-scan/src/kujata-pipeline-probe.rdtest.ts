import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseA, parseHrc, parseP, parseRsd, type AnimationClipSource, type Skeleton } from '@webmidgar/formats-model';
import { parseFieldEntry, splitAnimationName } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4 — Die vollständige Renderkette als Kreuzprodukt.
 *
 * **Warum diese Probe nötig ist.** Alle bisherigen R4-Messungen hatten
 * dieselbe Schwäche: eine Gütefunktion, die „Y ist die längste Achse" prüft.
 * Die ist gegenüber der **Richtung** blind — eine kopfstehende Figur erfüllt
 * sie genauso gut wie eine stehende. Genau deshalb hat die letzte Messung
 * ±90° mit 63,1 % gegen 34,3 % gewählt und die Sichtprüfung trotzdem „von
 * oben statt von unten" gemeldet: Die Zahl war richtig und die Frage falsch.
 *
 * **Die neue Gütefunktion ist richtungsempfindlich.** Der Wurzelpivot eines
 * Feldmodells liegt am Bodenkontaktpunkt (B7) — die Figur steht also
 * **oberhalb** ihres eigenen Ursprungs. Gemessen wird deshalb
 *
 * ```text
 * anteilOberhalb = (maxY − wurzelY) / (maxY − minY)
 * ```
 *
 * 1,0 heißt „steht vollständig über dem Pivot", 0,0 heißt „hängt vollständig
 * darunter", also kopfüber. Diese Größe unterscheidet 0° von 180° — was eine
 * Bounding-Box-Ausdehnung prinzipiell nicht kann.
 *
 * **Und sie wird als Kreuzprodukt gemessen, nicht achsenweise.** Die drei
 * Entscheidungen Kindversatz, Wurzelwinkel und Achsenbasis hängen zusammen;
 * einzeln geprüft kann jede verlieren, die als Gruppe gewinnt. Genau diese
 * Kopplungsfalle hat das Projekt hier schon zweimal Zeit gekostet.
 *
 * **Kujatas vollständige Kette** (aus `ff7-gltf/`, `config.json`, für
 * `modelType = "field"`) ist eine Zelle dieses Kreuzprodukts:
 * Kindversatz `[0,0,−parentLength]`, `rootRotationDegreesX = 180`,
 * `containerRotationDegreesX = 0` (also **kein** Basiswechsel), Reihenfolge
 * YXZ, Bone-Winkel unskaliert und ohne Zusatzversatz. Sie wird hier gegen
 * alle Alternativen gemessen, nicht übernommen.
 *
 * **Was diese Probe NICHT entscheiden kann:** die Abbildung der
 * Wurzeltranslation. Sie verschiebt Figur und Pivot gemeinsam, der Quotient
 * oben ist gegenüber Verschiebungen invariant. Das ist keine Schwäche der
 * Umsetzung, sondern eine Eigenschaft der Frage — und sie wird hier
 * ausgesprochen, statt später als Überraschung aufzutauchen.
 *
 * Urheberrecht/Datenschutz: ausschließlich Zahlen und Achsenkürzel.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

type Vec3 = [number, number, number];
type M3 = number[][];

const deg = Math.PI / 180;

function mul3(a: M3, b: M3): M3 {
  const o: M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r]![c] = a[r]![0]! * b[0]![c]! + a[r]![1]! * b[1]![c]! + a[r]![2]! * b[2]![c]!;
  }
  return o;
}

/** R = Ry · Rx · Rz (Three-Order 'YXZ'), Grad. */
function eulerYxz(xDeg: number, yDeg: number, zDeg: number): M3 {
  const cx = Math.cos(xDeg * deg), sx = Math.sin(xDeg * deg);
  const cy = Math.cos(yDeg * deg), sy = Math.sin(yDeg * deg);
  const cz = Math.cos(zDeg * deg), sz = Math.sin(zDeg * deg);
  const rx: M3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const ry: M3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const rz: M3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mul3(mul3(ry, rx), rz);
}

/** Achsenbasen Modellraum → Szene. Alle sind vorzeichenbehaftete Permutationen. */
const BASEN: Record<string, (v: Vec3) => Vec3> = {
  // Unsere ADR-009-Basis.
  'adr009 (x,z,−y)': (v) => [v[0], v[2], -v[1]],
  // Kujata: keine Basis, glTF übernimmt den Modellraum unverändert.
  'ohne (x,y,z)': (v) => [v[0], v[1], v[2]],
  // Spiegelvariante: Z-up nach Y-up ohne Vorzeichenwechsel.
  'z→y (x,z,y)': (v) => [v[0], v[2], v[1]],
};

interface Messwerte {
  /** Anteil der Frames mit Y als längster Achse. */
  hochAnteil: number;
  /** Anteil der Frames, in denen die Figur ÜBER ihrem Pivot steht. */
  aufrechtAnteil: number;
  /** Median von (maxY − wurzelY) / (maxY − minY). */
  medianOberhalb: number;
  frames: number;
}

/**
 * Statistik je Achsenbasis für einen Frame.
 *
 * **Das Oben-Unten-Signal.** Der erste Anlauf maß, ob die Figur über ihrem
 * Pivot steht — und bekam über ALLE 24 Kombinationen einen Median um 0,5.
 * Das war kein Messfehler, sondern die Widerlegung der Annahme dahinter: Der
 * Wurzelursprung eines FF7-Feldskeletts liegt in der **Hüfte**, nicht am
 * Boden. Eine korrekt stehende Figur reicht also naturgemäß nach oben UND
 * unten, und der Quotient liegt zwangsläufig bei ~0,5. Die Größe war für die
 * Frage blind.
 *
 * Was oben und unten wirklich trennt, ist die **Breite**: Über der Hüfte
 * sitzen Rumpf, Arme und der (bei FF7-Feldmodellen sehr große) Kopf, darunter
 * nur zwei Beine. Gemessen wird deshalb der horizontale Radius je Hälfte —
 * eine aufrechte Figur ist oben breiter als unten, eine kopfstehende
 * umgekehrt. Das ist richtungsempfindlich und braucht weder Bone-Namen noch
 * eine Annahme über die Pivot-Höhe.
 */
interface BasisStat {
  dx: number;
  dy: number;
  dz: number;
  /** Größter horizontaler Radius oberhalb der Wurzel. */
  radiusOben: number;
  /** Größter horizontaler Radius unterhalb der Wurzel. */
  radiusUnten: number;
  punkteOben: number;
  punkteUnten: number;
}

/**
 * Modellraum-Box + Wurzelursprung für eine Kettenkonfiguration.
 * Die Wurzeltranslation bleibt bewusst weg: Sie verschiebt Box und Wurzel
 * gemeinsam und ist für das pivot-relative Maß wirkungslos.
 */
function frameStatistik(
  skeleton: Skeleton,
  meshesByBone: Map<number, Float32Array[]>,
  frame: { rootRotation: readonly number[]; rotations: Float32Array },
  offsetSign: 1 | -1,
  rootPitchX: number,
): Record<string, BasisStat> | null {
  const mats: M3[] = [];
  const origins: Vec3[] = [];
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    const rx = frame.rotations[bone.fileOrder * 3] ?? 0;
    const ry = frame.rotations[bone.fileOrder * 3 + 1] ?? 0;
    const rz = frame.rotations[bone.fileOrder * 3 + 2] ?? 0;
    const local = eulerYxz(rx, ry, rz);
    if (bone.parentIndex < 0) {
      const r = frame.rootRotation;
      mats.push(mul3(eulerYxz((r[0] ?? 0) + rootPitchX, r[1] ?? 0, r[2] ?? 0), local));
      origins.push([0, 0, 0]);
    } else {
      const pm = mats[bone.parentIndex]!;
      const po = origins[bone.parentIndex]!;
      const plen = skeleton.bones[bone.parentIndex]!.length * offsetSign;
      origins.push([
        po[0] + pm[0]![2]! * plen,
        po[1] + pm[1]![2]! * plen,
        po[2] + pm[2]![2]! * plen,
      ]);
      mats.push(mul3(pm, local));
    }
  }

  const wurzelModell = origins[0] ?? ([0, 0, 0] as Vec3);
  const acc: Record<string, BasisStat & { min: Vec3; max: Vec3 }> = {};
  const wurzelJeBasis: Record<string, Vec3> = {};
  for (const [name, basis] of Object.entries(BASEN)) {
    acc[name] = {
      dx: 0, dy: 0, dz: 0, radiusOben: 0, radiusUnten: 0, punkteOben: 0, punkteUnten: 0,
      min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    };
    wurzelJeBasis[name] = basis(wurzelModell);
  }

  let punkte = 0;
  for (const [boneIndex, meshes] of meshesByBone) {
    const m = mats[boneIndex];
    const o = origins[boneIndex];
    if (!m || !o) continue;
    for (const pos of meshes) {
      for (let i = 0; i + 3 <= pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
        const p: Vec3 = [
          o[0] + m[0]![0]! * x + m[0]![1]! * y + m[0]![2]! * z,
          o[1] + m[1]![0]! * x + m[1]![1]! * y + m[1]![2]! * z,
          o[2] + m[2]![0]! * x + m[2]![1]! * y + m[2]![2]! * z,
        ];
        punkte++;
        for (const [name, basis] of Object.entries(BASEN)) {
          const s = acc[name]!;
          const w = wurzelJeBasis[name]!;
          const q = basis(p);
          for (let k = 0; k < 3; k++) {
            if (q[k]! < s.min[k]!) s.min[k] = q[k]!;
            if (q[k]! > s.max[k]!) s.max[k] = q[k]!;
          }
          const r = Math.hypot(q[0] - w[0], q[2] - w[2]);
          if (q[1] >= w[1]) {
            s.punkteOben++;
            if (r > s.radiusOben) s.radiusOben = r;
          } else {
            s.punkteUnten++;
            if (r > s.radiusUnten) s.radiusUnten = r;
          }
        }
      }
    }
  }
  if (punkte === 0) return null;

  const out: Record<string, BasisStat> = {};
  for (const [name, s] of Object.entries(acc)) {
    out[name] = {
      dx: s.max[0]! - s.min[0]!,
      dy: s.max[1]! - s.min[1]!,
      dz: s.max[2]! - s.min[2]!,
      radiusOben: s.radiusOben,
      radiusUnten: s.radiusUnten,
      punkteOben: s.punkteOben,
      punkteUnten: s.punkteUnten,
    };
  }
  return out;
}

function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

describe.skipIf(!available)('Realdaten: vollständige Renderkette (R4, Kreuzprodukt)', () => {
  it('misst Kindversatz × Wurzelwinkel × Achsenbasis mit richtungsempfindlicher Güte', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    const paare = new Map<string, string>();
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
    for (const [hrcName, aName] of [...paare].slice(0, 60)) {
      if (!idByName.has(hrcName)) continue;
      const skeleton = parseHrc(await read(hrcName), hrcName).value;
      if (!skeleton) continue;
      const meshesByBone = new Map<number, Float32Array[]>();
      for (const [boneIndex, bone] of skeleton.bones.entries()) {
        for (const ref of bone.resourceRefs) {
          const rsd = idByName.has(`${ref}.rsd`) ? parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value : null;
          if (!rsd || !idByName.has(`${rsd.meshRef}.p`)) continue;
          const mesh = parseP(await read(`${rsd.meshRef}.p`), `${rsd.meshRef}.p`).value;
          if (!mesh) continue;
          const list = meshesByBone.get(boneIndex) ?? [];
          list.push(mesh.positions);
          meshesByBone.set(boneIndex, list);
        }
      }
      if (meshesByBone.size === 0) continue;
      const clip = parseA(await read(aName), aName).value;
      if (!clip || clip.frames.length === 0) continue;
      proben.push({ skeleton, meshes: meshesByBone, clip });
    }
    await dir.closeAll();

    const SIGNS: (1 | -1)[] = [1, -1];
    const PITCHES = [0, 90, 180, 270];
    const ergebnis: Record<string, Messwerte> = {};

    for (const sg of SIGNS) {
      for (const pitch of PITCHES) {
        const roh: Record<string, { hoch: number; auf: number; quot: number[] }> = {};
        for (const b of Object.keys(BASEN)) roh[b] = { hoch: 0, auf: 0, quot: [] };
        let frames = 0;

        for (const p of proben) {
          for (const f of p.clip.frames.slice(0, 6)) {
            const stat = frameStatistik(p.skeleton, p.meshes, f, sg, pitch);
            if (!stat) continue;
            frames++;
            for (const [name, s] of Object.entries(stat)) {
              const r = roh[name]!;
              const hoch = s.dy >= s.dx && s.dy >= s.dz;
              if (hoch) r.hoch++;
              // Breitenverhältnis oben/unten — das Richtungssignal.
              const q = s.radiusUnten > 0 ? s.radiusOben / s.radiusUnten : 0;
              r.quot.push(q);
              if (hoch && q > 1) r.auf++;
            }
          }
        }
        for (const [name, r] of Object.entries(roh)) {
          ergebnis[`Versatz${sg > 0 ? '+' : '−'} · WurzelX ${pitch}° · Basis ${name}`] = {
            hochAnteil: frames > 0 ? r.hoch / frames : 0,
            aufrechtAnteil: frames > 0 ? r.auf / frames : 0,
            medianOberhalb: median(r.quot),
            frames,
          };
        }
      }
    }

    // --- Gegenhypothese: liegen die `.p`-Vertices bereits im MODELLRAUM?
    //
    // Die Sichtprüfung zeigt keine verdrehte Figur, sondern eine
    // auseinandergefallene: einzelne Segmente schweben neben dem Körper. Das
    // ist die Signatur einer doppelt angewandten Transformation — nämlich
    // dann, wenn die Vertices gar nicht bone-lokal, sondern schon fertig
    // platziert vorliegen.
    //
    // Der Test ist billig und hart: Ohne JEDE Bone-Transformation die rohen
    // Vertices vereinigen. Sind sie bereits modellraum-fertig, ergibt allein
    // ihre Vereinigung eine kohärente Figur — und schlägt jede der 24
    // transformierten Ketten. Sind sie bone-lokal, fallen sie alle auf einen
    // Haufen und das Ergebnis ist deutlich schlechter.
    let rohHoch = 0;
    let rohAuf = 0;
    let rohFrames = 0;
    const rohQuot: number[] = [];
    for (const p of proben) {
      const min: Vec3 = [Infinity, Infinity, Infinity];
      const max: Vec3 = [-Infinity, -Infinity, -Infinity];
      let rOben = 0, rUnten = 0;
      const punkte: Vec3[] = [];
      for (const meshes of p.meshes.values()) {
        for (const pos of meshes) {
          for (let i = 0; i + 3 <= pos.length; i += 3) {
            const q: Vec3 = [pos[i]!, pos[i + 2]!, -pos[i + 1]!]; // adr009-Basis
            punkte.push(q);
            for (let k = 0; k < 3; k++) {
              if (q[k]! < min[k]!) min[k] = q[k]!;
              if (q[k]! > max[k]!) max[k] = q[k]!;
            }
          }
        }
      }
      if (punkte.length === 0) continue;
      // Bezugshöhe: Mitte der Figur, weil es hier keinen Wurzelursprung gibt.
      const mitteY = (min[1]! + max[1]!) / 2;
      const mitteX = (min[0]! + max[0]!) / 2;
      const mitteZ = (min[2]! + max[2]!) / 2;
      for (const q of punkte) {
        const r = Math.hypot(q[0] - mitteX, q[2] - mitteZ);
        if (q[1] >= mitteY) { if (r > rOben) rOben = r; } else if (r > rUnten) rUnten = r;
      }
      rohFrames++;
      const dx = max[0]! - min[0]!, dy = max[1]! - min[1]!, dz = max[2]! - min[2]!;
      const hoch = dy >= dx && dy >= dz;
      if (hoch) rohHoch++;
      const quot = rUnten > 0 ? rOben / rUnten : 0;
      rohQuot.push(quot);
      if (hoch && quot > 1) rohAuf++;
    }

    const rang = Object.entries(ergebnis)
      .map(([k, v]) => ({ k, ...v }))
      .sort((a, b) => b.aufrechtAnteil - a.aufrechtAnteil || b.medianOberhalb - a.medianOberhalb);

    console.log(
      'Renderkette — Kreuzprodukt (richtungsempfindlich):',
      JSON.stringify(
        {
          Modelle: proben.length,
          Frames: rang[0]?.frames ?? 0,
          'Top 8': rang.slice(0, 8).map(
            (r) =>
              `${r.k}: aufrecht ${(r.aufrechtAnteil * 100).toFixed(1)}%, Y längste ${(r.hochAnteil * 100).toFixed(1)}%, Breite oben/unten ${r.medianOberhalb.toFixed(2)}`,
          ),
          'Schlusslicht': rang.slice(-3).map(
            (r) => `${r.k}: aufrecht ${(r.aufrechtAnteil * 100).toFixed(1)}%, Breite ${r.medianOberhalb.toFixed(2)}`,
          ),
          'unsere bisherige Kette (Versatz+ · WurzelX 270° · adr009)':
            `${(ergebnis['Versatz+ · WurzelX 270° · Basis adr009 (x,z,−y)']!.aufrechtAnteil * 100).toFixed(1)}%`,
          'GEGENHYPOTHESE — rohe .p-Vertices ohne jede Bone-Transformation': {
            Modelle: rohFrames,
            'Y längste Achse': `${((rohHoch / Math.max(1, rohFrames)) * 100).toFixed(1)}%`,
            aufrecht: `${((rohAuf / Math.max(1, rohFrames)) * 100).toFixed(1)}%`,
            'Breite oben/unten (Median)': median(rohQuot).toFixed(2),
          },
          'Kujata vollständig (Versatz− · WurzelX 180° · ohne Basis)':
            `${(ergebnis['Versatz− · WurzelX 180° · Basis ohne (x,y,z)']!.aufrechtAnteil * 100).toFixed(1)}%`,
        },
        null,
        1,
      ),
    );

    expect(proben.length).toBeGreaterThan(20);
    // Die Gütefunktion muss überhaupt trennen — sonst misst sie nichts.
    expect(rang[0]!.aufrechtAnteil).toBeGreaterThan(rang[rang.length - 1]!.aufrechtAnteil + 0.2);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
