import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseA, parseHrc, parseP, parseRsd, type AnimationClipSource, type MeshSource, type Skeleton } from '@webmidgar/formats-model';
import { parseFieldEntry, splitAnimationName } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { computePose, transformPoint } from '@webmidgar/render-actor';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4 — Bildtafel für die Sichtprüfung (50 Konfigurationen).
 *
 * **Warum das nötig ist.** Vier aufeinanderfolgende Gütefunktionen konnten die
 * Modellorientierung nicht entscheiden: „Y ist die längste Achse" ist
 * invariant unter 180°, der Anteil über dem Pivot ist es faktisch auch (die
 * Wurzel sitzt in der Hüfte), und das Breitenverhältnis liegt über alle
 * Varianten im Rauschen. Jede dieser Größen aggregiert die Punktwolke — und
 * aggregiert dabei genau die Richtung weg, nach der gefragt ist.
 *
 * Statt eine fünfte Kennzahl zu erfinden, rendert diese Probe die Kandidaten
 * und legt sie dem **Auge** vor. Das ist hier kein Rückschritt gegenüber einer
 * Messung, sondern das schärfere Instrument: Ein Mensch sieht „steht
 * aufrecht, Segmente sitzen zusammen" in einer Sekunde, und keine der vier
 * Kennzahlen konnte es in vier Anläufen.
 *
 * **Was aufgespannt wird** (50 Zellen):
 *  - A (32): volle Kette — Versatzreihenfolge × Versatzvorzeichen ×
 *    Wurzelwinkel × Achsenbasis. Die Versatzreihenfolge ist neu im Suchraum:
 *    `Eltern · (Versatz · Lokal)` gegen `Eltern · (Lokal · Versatz)`. Eine
 *    falsche Reihenfolge erzeugt genau das beobachtete Symptom — Segmente,
 *    die neben dem Körper schweben.
 *  - B (8): Bone-Rotationen angewandt, **Kindversatz 0** — zeigt, ob die
 *    Versätze oder die Rotationen die Segmente auseinandertreiben.
 *  - C (8): Vertices als bereits modellraum-fertig behandelt (keine
 *    Bone-Matrix), nur Wurzelwinkel + Basis.
 *  - D (2): rohe Vertices ohne jede Transformation.
 *
 * **Farbgebung:** je Bone eine eigene Farbe. Zusammengehörige Segmente sind
 * damit auch dann unterscheidbar, wenn die Figur richtig steht.
 *
 * **Datenschutz/Urheberrecht:** Die Tafel wird **ausschließlich lokal** in das
 * Arbeitsverzeichnis geschrieben und nirgends hochgeladen. Sie ist ein
 * Diagnosebild aus Originaldaten und fällt damit unter dieselbe Regel wie die
 * Daten selbst. Der Pfad steht in der Konsolenausgabe.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const OUT =
  process.env['WEBMIDGAR_SHEET_OUT'] ??
  'C:\\Users\\timur\\AppData\\Local\\Temp\\claude\\C--ff7-web\\49dab9ae-a74e-4275-bde7-8575218c5ff6\\scratchpad\\r4-tafel.html';

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
function eulerYxz(x: number, y: number, z: number): M3 {
  const cx = Math.cos(x * deg), sx = Math.sin(x * deg);
  const cy = Math.cos(y * deg), sy = Math.sin(y * deg);
  const cz = Math.cos(z * deg), sz = Math.sin(z * deg);
  const rx: M3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const ry: M3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const rz: M3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mul3(mul3(ry, rx), rz);
}
function apply(m: M3, o: Vec3, p: Vec3): Vec3 {
  return [
    o[0] + m[0]![0]! * p[0] + m[0]![1]! * p[1] + m[0]![2]! * p[2],
    o[1] + m[1]![0]! * p[0] + m[1]![1]! * p[1] + m[1]![2]! * p[2],
    o[2] + m[2]![0]! * p[0] + m[2]![1]! * p[1] + m[2]![2]! * p[2],
  ];
}

const BASEN: Record<string, (v: Vec3) => Vec3> = {
  'adr009': (v) => [v[0], v[2], -v[1]],
  'keine': (v) => [v[0], v[1], v[2]],
};

// --- minimaler PNG-Encoder (nur was hier gebraucht wird) --------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** HSL→RGB für die Bone-Farben. */
function boneColor(i: number, n: number): [number, number, number] {
  const h = ((i * 360) / Math.max(1, n)) % 360;
  const c = 0.75, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.25;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const W = 190, H = 240;

interface Dreieck {
  p: [Vec3, Vec3, Vec3];
  bone: number;
}

type Ansicht = 'front' | 'seite' | 'oben';

/** Projektion je Ansicht: [Bildschirm-X, Bildschirm-Y, Tiefe]. */
function projiziere(p: Vec3, v: Ansicht): [number, number, number] {
  if (v === 'seite') return [p[2], p[1], -p[0]];
  if (v === 'oben') return [p[0], p[2], p[1]];
  return [p[0], p[1], p[2]];
}

/** Orthographische Ansicht mit Tiefenpuffer, flache Bone-Farben. */
function rasterize(tris: Dreieck[], boneCount: number, ansicht: Ansicht = 'front'): Buffer {
  const px = new Uint8Array(W * H * 3).fill(18);
  const zb = new Float32Array(W * H).fill(-Infinity);
  if (tris.length === 0) return encodePng(W, H, px);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const q of t.p) {
    const p = projiziere(q, ansicht);
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const s = Math.min((W - 16) / spanX, (H - 16) / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const toScreen = (q: Vec3): [number, number, number] => {
    const p = projiziere(q, ansicht);
    return [
      W / 2 + (p[0] - cx) * s,
      H / 2 - (p[1] - cy) * s, // Bildschirm-Y zeigt nach unten
      p[2],
    ];
  };

  for (const t of tris) {
    const a = toScreen(t.p[0]), b = toScreen(t.p[1]), c = toScreen(t.p[2]);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-9) continue;
    const [cr, cg, cb] = boneColor(t.bone, boneCount);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / det;
        const w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * W + x;
        if (z <= zb[i]!) continue;
        zb[i] = z;
        px[i * 3] = cr; px[i * 3 + 1] = cg; px[i * 3 + 2] = cb;
      }
    }
  }
  return encodePng(W, H, px);
}

interface Konfig {
  id: number;
  gruppe: string;
  label: string;
  versatzNach: boolean;
  versatzSign: 1 | -1 | 0;
  pitch: number;
  basis: string;
  modus: 'kette' | 'modellraum' | 'roh';
}

function konfigurationen(): Konfig[] {
  const out: Konfig[] = [];
  let id = 1;
  // A: volle Kette
  for (const nach of [false, true]) {
    for (const sg of [1, -1] as (1 | -1)[]) {
      for (const pitch of [0, 90, 180, 270]) {
        for (const basis of ['adr009', 'keine']) {
          out.push({
            id: id++, gruppe: 'A — volle Kette', modus: 'kette',
            versatzNach: nach, versatzSign: sg, pitch, basis,
            label: `Versatz ${nach ? 'NACH' : 'VOR'} Rotation · ${sg > 0 ? '+' : '−'}len · WurzelX ${pitch}° · Basis ${basis}`,
          });
        }
      }
    }
  }
  // B: Rotationen ohne Kindversatz
  for (const pitch of [0, 90, 180, 270]) {
    for (const basis of ['adr009', 'keine']) {
      out.push({
        id: id++, gruppe: 'B — Rotationen, KEIN Kindversatz', modus: 'kette',
        versatzNach: false, versatzSign: 0, pitch, basis,
        label: `Kindversatz 0 · WurzelX ${pitch}° · Basis ${basis}`,
      });
    }
  }
  // C: Vertices bereits modellraum-fertig
  for (const pitch of [0, 90, 180, 270]) {
    for (const basis of ['adr009', 'keine']) {
      out.push({
        id: id++, gruppe: 'C — Vertices als Modellraum (keine Bone-Matrix)', modus: 'modellraum',
        versatzNach: false, versatzSign: 0, pitch, basis,
        label: `ohne Bone-Matrix · WurzelX ${pitch}° · Basis ${basis}`,
      });
    }
  }
  // D: völlig roh
  for (const basis of ['adr009', 'keine']) {
    out.push({
      id: id++, gruppe: 'D — völlig roh', modus: 'roh',
      versatzNach: false, versatzSign: 0, pitch: 0, basis,
      label: `rohe Vertices · Basis ${basis}`,
    });
  }
  return out;
}

describe.skipIf(!available)('Realdaten: R4-Bildtafel für die Sichtprüfung', () => {
  it('rendert 50 Konfigurationen in eine lokale HTML-Tafel', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    // Modell + Animation über das Field-Manifest paaren; das grösste Skelett
    // mit den meisten Meshes gewinnt — dort ist eine Fehlplatzierung am
    // deutlichsten zu sehen.
    const paare = new Map<string, string>();
    for (const entry of [...index.listEntries('flevel')].filter((e) => !e.name.includes('.')).slice(0, 60)) {
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

    const kandidaten: { skeleton: Skeleton; meshes: Map<number, MeshSource[]>; clip: AnimationClipSource }[] = [];
    for (const [hrcName, aName] of [...paare].slice(0, 40)) {
      if (!idByName.has(hrcName)) continue;
      const skeleton = parseHrc(await read(hrcName), hrcName).value;
      if (!skeleton) continue;
      const meshes = new Map<number, MeshSource[]>();
      for (const [boneIndex, bone] of skeleton.bones.entries()) {
        for (const ref of bone.resourceRefs) {
          const rsd = idByName.has(`${ref}.rsd`) ? parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value : null;
          if (!rsd || !idByName.has(`${rsd.meshRef}.p`)) continue;
          const mesh = parseP(await read(`${rsd.meshRef}.p`), `${rsd.meshRef}.p`).value;
          if (!mesh) continue;
          const list = meshes.get(boneIndex) ?? [];
          list.push(mesh);
          meshes.set(boneIndex, list);
        }
      }
      const clip = parseA(await read(aName), aName).value;
      if (!clip || clip.frames.length === 0 || meshes.size === 0) continue;
      kandidaten.push({ skeleton, meshes, clip });
    }
    await dir.closeAll();
    kandidaten.sort((a, b) => b.meshes.size - a.meshes.size);
    expect(kandidaten.length).toBeGreaterThan(2);
    const best = kandidaten[0]!;
    const { skeleton, meshes, clip } = best;
    const frame = clip.frames[0]!;

    const konfigs = konfigurationen();
    const zellen: string[] = [];

    /** Dreiecke einer Kettenkonfiguration im Szenenraum. */
    const dreieckeFuer = (
      m: { skeleton: Skeleton; meshes: Map<number, MeshSource[]> },
      frm: typeof frame,
      k: Konfig,
    ): Dreieck[] => {
      const mats: M3[] = [];
      const origins: Vec3[] = [];
      for (let i = 0; i < m.skeleton.bones.length; i++) {
        const bone = m.skeleton.bones[i]!;
        const rx = frm.rotations[bone.fileOrder * 3] ?? 0;
        const ry = frm.rotations[bone.fileOrder * 3 + 1] ?? 0;
        const rz = frm.rotations[bone.fileOrder * 3 + 2] ?? 0;
        const local = eulerYxz(rx, ry, rz);
        if (bone.parentIndex < 0) {
          const r = frm.rootRotation;
          mats.push(mul3(eulerYxz(r[0] + k.pitch, r[1], r[2]), local));
          origins.push([0, 0, 0]);
        } else {
          const pm = mats[bone.parentIndex]!;
          const po = origins[bone.parentIndex]!;
          const plen = m.skeleton.bones[bone.parentIndex]!.length * k.versatzSign;
          // „Versatz VOR Rotation" verschiebt entlang der ELTERN-Achse,
          // „NACH Rotation" entlang der eigenen.
          const mm = mul3(pm, local);
          const achse = k.versatzNach ? mm : pm;
          origins.push([
            po[0] + achse[0]![2]! * plen,
            po[1] + achse[1]![2]! * plen,
            po[2] + achse[2]![2]! * plen,
          ]);
          mats.push(mm);
        }
      }
      const basis = BASEN[k.basis]!;
      const wurzel = k.modus === 'roh'
        ? null
        : eulerYxz(frm.rootRotation[0] + k.pitch, frm.rootRotation[1], frm.rootRotation[2]);
      const tris: Dreieck[] = [];
      for (const [boneIndex, liste] of m.meshes) {
        for (const mesh of liste) {
          const pos = mesh.positions;
          const idx = mesh.indices;
          for (let i = 0; i + 3 <= idx.length; i += 3) {
            const ecken: Vec3[] = [];
            for (let e = 0; e < 3; e++) {
              const v = idx[i + e]! * 3;
              const raw: Vec3 = [pos[v]!, pos[v + 1]!, pos[v + 2]!];
              let q: Vec3;
              if (k.modus === 'kette') q = apply(mats[boneIndex]!, origins[boneIndex]!, raw);
              else if (k.modus === 'modellraum') q = apply(wurzel!, [0, 0, 0], raw);
              else q = raw;
              ecken.push(basis(q));
            }
            tris.push({ p: [ecken[0]!, ecken[1]!, ecken[2]!], bone: boneIndex });
          }
        }
      }
      return tris;
    };

    for (const k of konfigs) {
      const png = rasterize(dreieckeFuer(best, frame, k), skeleton.bones.length);
      zellen.push(
        `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}" alt="Konfiguration ${k.id}"><figcaption><b>#${k.id}</b> <span class="g">${k.gruppe}</span><br>${k.label}</figcaption></figure>`,
      );
    }

    // --- Nachweis: Reproduziert die PRODUKTIONSKETTE die als richtig
    // erkannte Zelle? Das ist der eigentliche Abschluss — ohne ihn hätte die
    // Sichtprüfung zwar entschieden, aber nichts wäre damit verdrahtet.
    const produktionsDreiecke = (
      m: { skeleton: Skeleton; meshes: Map<number, MeshSource[]> },
      frm: typeof frame,
    ): Dreieck[] => {
      const poses = computePose(m.skeleton, frm, true);
      const out: Dreieck[] = [];
      for (const [boneIndex, liste] of m.meshes) {
        const mat = poses[boneIndex]?.matrix;
        if (!mat) continue;
        for (const mesh of liste) {
          const pos = mesh.positions;
          const idx = mesh.indices;
          for (let i = 0; i + 3 <= idx.length; i += 3) {
            const ecken: Vec3[] = [];
            for (let e = 0; e < 3; e++) {
              const v = idx[i + e]! * 3;
              const mp = transformPoint(mat, [pos[v]!, pos[v + 1]!, pos[v + 2]!]);
              ecken.push(ff7ToScene(mp) as Vec3);
            }
            out.push({ p: [ecken[0]!, ecken[1]!, ecken[2]!], bone: boneIndex });
          }
        }
      }
      return out;
    };

    const box = (tris: Dreieck[]): { min: Vec3; max: Vec3 } => {
      const mn: Vec3 = [Infinity, Infinity, Infinity];
      const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const t of tris) for (const q of t.p) for (let k = 0; k < 3; k++) {
        if (q[k]! < mn[k]!) mn[k] = q[k]!;
        if (q[k]! > mx[k]!) mx[k] = q[k]!;
      }
      return { min: mn, max: mx };
    };

    // Verglichen wird WURZELRELATIV: Die Tafel rechnet ohne Wurzeltranslation,
    // die Produktion mit. Eine reine Verschiebung darf den Nachweis nicht
    // stören — die Aussage ist „gleiche Form, gleiche Lage zur Wurzel",
    // nicht „gleiche Weltkoordinaten".
    const prodPoses = computePose(best.skeleton, frame, true);
    const prodWurzel = ff7ToScene(transformPoint(prodPoses[0]!.matrix, [0, 0, 0])) as Vec3;
    const prodBox = box(produktionsDreiecke(best, frame));
    const refBox = box(dreieckeFuer(best, frame, konfigs.find((k) => k.id === 15)!));
    for (let k = 0; k < 3; k++) {
      expect(prodBox.min[k]! - prodWurzel[k]!).toBeCloseTo(refBox.min[k]!, 3);
      expect(prodBox.max[k]! - prodWurzel[k]!).toBeCloseTo(refBox.max[k]!, 3);
    }
    console.log('Produktionskette == Konfiguration #15 (wurzelrelativ): bestaetigt');

    // --- Bestätigungstafel: ANDERE Modelle, drei Ansichten.
    const bestaetigung: string[] = [];
    for (const [n, m] of kandidaten.slice(1, 4).entries()) {
      const frm = m.clip.frames[0]!;
      const tris = produktionsDreiecke(m, frm);
      for (const ansicht of ['front', 'seite', 'oben'] as Ansicht[]) {
        const png = rasterize(tris, m.skeleton.bones.length, ansicht);
        bestaetigung.push(
          `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}" alt="Bestaetigung"><figcaption><b>Modell ${n + 2}</b> <span class="g">${ansicht}</span><br>Produktionskette (−len · WurzelX −90° · adr009)</figcaption></figure>`,
        );
      }
    }

    const html = `<!doctype html><meta charset="utf-8"><title>R4-Sichtprüfung — 50 Konfigurationen</title>
<style>
body{background:#111;color:#ddd;font:14px/1.45 system-ui,sans-serif;margin:24px}
h1{font-size:20px} p{max-width:70ch;color:#aaa}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-top:20px}
figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:6px;padding:8px}
img{display:block;border-radius:4px;background:#121212}
figcaption{font-size:11px;line-height:1.35;margin-top:6px;color:#bbb}
b{color:#fff;font-size:13px} .g{color:#7aa2f7}
</style>
<h1>R4 — Sichtprüfung, 50 Renderketten</h1>
<p>Frontansicht, orthographisch, Frame&nbsp;0 einer echten Animation. <b>Jede Farbe ist ein Bone</b> — zusammengehörige Segmente sind so auch bei korrekter Figur unterscheidbar, und freischwebende Teile fallen sofort auf.</p>
<p>Gesucht: aufrecht, von vorn, Segmente sitzen zusammen. Bitte die Nummern nennen, die richtig aussehen — und gern auch die, die „fast" richtig sind.</p>
<div class="grid">${zellen.join('\n')}</div>
<h1 style="margin-top:36px">Bestätigung — andere Modelle, drei Ansichten</h1>
<p>Dieselbe Kette, die oben als richtig erkannt wurde, jetzt aus der <b>Produktionsimplementierung</b> heraus gerendert (wurzelrelativ identisch zu #15) und auf drei weitere Modelle angewandt. Steht hier alles aufrecht und zusammenhängend, ist die Entscheidung nicht an ein einzelnes Modell überangepasst.</p>
<div class="grid">${bestaetigung.join('\n')}</div>`;

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, html, 'utf8');
    console.log(`R4-Bildtafel geschrieben: ${OUT}`);
    console.log(`Konfigurationen: ${konfigs.length}, Bones: ${skeleton.bones.length}, Bones mit Mesh: ${meshes.size}`);

    expect(konfigs.length).toBe(50);
    expect(existsSync(OUT)).toBe(true);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
