import {
  assignPartsToBones,
  battleSkeletonToSkeleton,
  battleToScene,
  BATTLE_ROOT_EXTRA_X_DEG,
  loadBattleModel,
  type BattleCamera,
} from '@webmidgar/render-battle';
import { ff7ToScene } from '@webmidgar/convert';
import type { MeshSource, TextureSource } from '@webmidgar/formats-model';
import { bindPoseFrame, computePose, transformPoint } from '@webmidgar/render-actor';
import { texRgb, type Bild, type Dreieck, type Vec2, type Vec3 } from './sheet.js';

/**
 * Gemeinsame Bausteine der Kampf-Bildproben. Ausgelagert aus
 * `battle-vollbild.rdtest.ts`, als die K8-Kameraprobe dieselbe Kette
 * brauchte — zwei Kopien einer Renderkette wären zwei Wahrheiten, und genau
 * das ist bei der Modelllage (s. `modellDreieckeFabrik`) schon einmal
 * teuer geworden.
 */

/** 🟢 F40: vermessene Renderfläche des Originals. */
export const BREITE = 640;
export const HOEHE = 448;

export interface Projektor {
  (v: Vec3): { x: number; y: number; z: number; vor: boolean };
}

/**
 * Kameraraum-Projektion nach dem FF7-Modell (vgl. convert/camera-math).
 * Liefert NDC-artige Koordinaten in [−1,1]; `rasterize` bildet sie auf die
 * Bildfläche ab.
 */
export function projektor(cam: BattleCamera, fovGrad: number): Projektor {
  const p = battleToScene(cam.position);
  const t = battleToScene(cam.target);
  const f: Vec3 = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  const fw: Vec3 = [f[0] / fl, f[1] / fl, f[2] / fl];
  // Rechtsvektor gegen die Welt-Hochachse; bei senkrechtem Blick weicht die
  // Konstruktion auf die z-Achse aus (kommt im Bestand nicht vor, ist aber
  // billiger abzufangen als zu debuggen).
  const oben: Vec3 = Math.abs(fw[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const r: Vec3 = [
    fw[1] * oben[2] - fw[2] * oben[1],
    fw[2] * oben[0] - fw[0] * oben[2],
    fw[0] * oben[1] - fw[1] * oben[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  const rw: Vec3 = [r[0] / rl, r[1] / rl, r[2] / rl];
  const uw: Vec3 = [
    rw[1] * fw[2] - rw[2] * fw[1],
    rw[2] * fw[0] - rw[0] * fw[2],
    rw[0] * fw[1] - rw[1] * fw[0],
  ];
  const tanH = Math.tan((fovGrad * Math.PI) / 360);
  const aspekt = BREITE / HOEHE;
  return (v: Vec3) => {
    const d: Vec3 = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
    const zc = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    const xc = d[0] * rw[0] + d[1] * rw[1] + d[2] * rw[2];
    const yc = d[0] * uw[0] + d[1] * uw[1] + d[2] * uw[2];
    if (zc <= 1) return { x: 0, y: 0, z: 0, vor: false };
    return { x: xc / (zc * tanH * aspekt), y: yc / (zc * tanH), z: -zc, vor: true };
  };
}

/** Dreiecke eines `.p`-Meshes in Szenenkoordinaten, mit Abbildung. */
export function meshDreiecke(
  mesh: MeshSource,
  texturen: (TextureSource | null)[],
  abbild: (p: Vec3) => Vec3,
  cache: Map<TextureSource, Bild>,
): Dreieck[] {
  const out: Dreieck[] = [];
  for (const sub of mesh.submeshes) {
    let bild: Bild | null = null;
    if (sub.textured) {
      const tex = texturen[sub.textureIndex] ?? null;
      if (tex) {
        let b = cache.get(tex);
        if (!b) {
          b = texRgb(tex, (r, g, bl) => [r, g, bl]);
          cache.set(tex, b);
        }
        bild = b;
      }
    }
    for (let i = sub.start; i + 3 <= sub.start + sub.count; i += 3) {
      const p: Vec3[] = [];
      const uv: Vec2[] = [];
      const col: Vec3[] = [];
      for (let e = 0; e < 3; e++) {
        const vi = mesh.indices[i + e]!;
        p.push(
          abbild([mesh.positions[vi * 3]!, mesh.positions[vi * 3 + 1]!, mesh.positions[vi * 3 + 2]!]),
        );
        uv.push([mesh.uvs[vi * 2] ?? 0, mesh.uvs[vi * 2 + 1] ?? 0]);
        col.push([
          mesh.colors[vi * 4] ?? 255,
          mesh.colors[vi * 4 + 1] ?? 255,
          mesh.colors[vi * 4 + 2] ?? 255,
        ]);
      }
      out.push({
        p: [p[0]!, p[1]!, p[2]!],
        uv: [uv[0]!, uv[1]!, uv[2]!],
        col: [col[0]!, col[1]!, col[2]!],
        tex: bild,
      });
    }
  }
  return out;
}

/** Kamera-Projektion auf eine bereits in Szenenkoordinaten liegende Menge. */
export function projiziere(tris: Dreieck[], proj: Projektor): Dreieck[] {
  const out: Dreieck[] = [];
  for (const t of tris) {
    const a = proj(t.p[0]);
    const b = proj(t.p[1]);
    const c = proj(t.p[2]);
    if (!a.vor || !b.vor || !c.vor) continue; // Kein Clipping — Dreieck fällt weg.
    out.push({ ...t, p: [[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]] });
  }
  return out;
}

export interface BattleQuelle {
  listBattleEntries: (prefix: string) => string[];
  readBattleEntry: (name: string) => Promise<Uint8Array | null>;
}

/**
 * Modell in Bindpose → Dreiecke in Szenenkoordinaten, an `pos` versetzt.
 *
 * ACHTUNG, hier lag ein Fehler: Die Modellkette trägt die Battle-Lage
 * BEREITS — `computePose` mit Wurzel-Frame-X 270° plus die ADR-009-Basis
 * `ff7ToScene` (= Rx(−90°)) ergeben netto Rx(180°), und genau das IST
 * `battleToScene`. Wer danach noch einmal `battleToScene` anwendet, dreht um
 * weitere 180° und legt jede Figur flach hin (Rx(90°) statt Rx(180°)).
 * Für Modelle gilt deshalb `ff7ToScene`, für Plätze, Bühne und Kamera
 * `battleToScene` — beide Wege enden in derselben Lage.
 */
export function modellDreieckeFabrik(quelle: BattleQuelle) {
  return async (
    prefix: string,
    pos: Vec3,
    cache: Map<TextureSource, Bild>,
    faktor = 1,
  ): Promise<Dreieck[]> => {
    const files = await loadBattleModel(prefix, quelle);
    if (!files) return [];
    const skeleton = battleSkeletonToSkeleton(files.skeleton, prefix);
    const { boneToPart } = assignPartsToBones(files.skeleton, files.parts.length);
    const frame = {
      ...bindPoseFrame(skeleton),
      rootRotation: [BATTLE_ROOT_EXTRA_X_DEG, 0, 0] as [number, number, number],
    };
    const posen = computePose(skeleton, frame, true);
    const out: Dreieck[] = [];
    for (const [bone, part] of boneToPart) {
      const mat = posen[bone]?.matrix;
      if (!mat) continue;
      out.push(
        ...meshDreiecke(
          files.parts[part]!,
          files.textures,
          (p) => {
            const m = transformPoint(mat, p);
            const s = ff7ToScene([m[0] * faktor, m[1] * faktor, m[2] * faktor]) as Vec3;
            return [s[0] + pos[0], s[1] + pos[1], s[2] + pos[2]];
          },
          cache,
        ),
      );
    }
    return out;
  };
}
