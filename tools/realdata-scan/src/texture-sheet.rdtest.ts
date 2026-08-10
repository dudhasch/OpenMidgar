import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  parseA, parseHrc, parseP, parseRsd, parseTex,
  type AnimationClipSource, type MeshSource, type Skeleton, type TextureSource,
} from '@webmidgar/formats-model';
import { parseFieldEntry, splitAnimationName } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { computePose, transformPoint } from '@webmidgar/render-actor';
import { encodePng } from './png.js';
import { NodeDirectorySource } from './node-source.js';

/**
 * R4-B5/B6 — Bildtafel für Palettenreihenfolge, Vertexfarben und UV-Ursprung.
 *
 * **Warum wieder eine Tafel.** Bei der Modellorientierung haben vier
 * Aggregat-Gütefunktionen dieselbe Frage viermal nicht beantwortet; entschieden
 * hat am Ende die Sichtprüfung an gerenderten Kandidaten. Farbkanäle und
 * UV-Ursprung sind vom selben Typ: Eine vertauschte Reihenfolge ändert keine
 * Statistik, die man ohne Sollbild prüfen könnte — sie ändert nur, ob das Bild
 * richtig aussieht. Statt eine Kennzahl zu erfinden, die das ohnehin nicht
 * sehen kann, wird derselbe Weg genommen.
 *
 * **Die offenen Annahmen:**
 *  - **B5** — Der Palettenblock im `.tex` wird als **BGRA** gelesen
 *    (`tex.ts`: `rgba[c*4] = bytes[src+2]` …). Alternativen: RGBA, ARGB, ABGR.
 *  - **B6a** — Vertexfarben im `.p` ebenfalls als BGRA (`p.ts` Z. 134 f.).
 *  - **B6b** — UV-Koordinaten werden **ungeflippt** übernommen; ob der
 *    V-Ursprung oben oder unten liegt, ist ungeprüft. Dasselbe gilt für U.
 *
 * **Aufteilung der Tafel:**
 *  - Abschnitt 1 (16 Zellen): Palettenreihenfolge (4) × V-Flip (2) × U-Flip (2),
 *    texturiert gerendert. Hier entscheidet sich B5 und B6b.
 *  - Abschnitt 2 (4 Zellen): Vertexfarb-Reihenfolge (2) × zwei Modelle, mit
 *    **abgeschalteten Texturen** — sonst verdecken die Texturen genau die
 *    Flächen, an denen B6a sichtbar wäre.
 *
 * **Kontrolle gegen Selbsttäuschung.** Die vier Palettenreihenfolgen sind
 * echte Permutationen derselben Bytes; eine davon ist richtig, drei erzeugen
 * verschobene Farben. Gäbe es keinen sichtbaren Unterschied zwischen den
 * Zellen, wäre entweder die Textur einfarbig oder der Renderpfad kaputt —
 * die Probe prüft deshalb, dass sich die Bilder überhaupt unterscheiden.
 *
 * **Datenschutz/Urheberrecht:** ausschließlich lokal, kein Upload. Gilt wie
 * für die Daten selbst.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const OUT =
  process.env['WEBMIDGAR_TEXSHEET_OUT'] ??
  'C:\\Users\\timur\\AppData\\Local\\Temp\\claude\\C--ff7-web\\49dab9ae-a74e-4275-bde7-8575218c5ff6\\scratchpad\\b5b6-tafel.html';

const available = existsSync(REAL_DIR);

type Vec3 = [number, number, number];
type Vec2 = [number, number];
const W = 210, H = 270;

/**
 * Kanalpermutationen, ausgedrückt auf dem, was der Parser BEREITS liefert.
 *
 * `tex.ts` liest heute BGRA und legt RGBA ab, d. h. das gespeicherte Tripel
 * ist (r,g,b) = (datei2, datei1, datei0). Alle anderen Auslegungen sind daher
 * Permutationen des gespeicherten Tripels — kein Neu-Parsen nötig.
 */
const PALETTEN: Record<string, (r: number, g: number, b: number, a: number) => [number, number, number]> = {
  'BGRA (heute)': (r, g, b) => [r, g, b],
  'RGBA': (r, g, b) => [b, g, r],
  'ARGB': (r, g, b, a) => [g, r, a],
  'ABGR': (r, g, b, a) => [a, r, g],
};

interface Dreieck {
  p: [Vec3, Vec3, Vec3];
  uv: [Vec2, Vec2, Vec2];
  col: [Vec3, Vec3, Vec3];
  tex: { w: number; h: number; rgb: Uint8Array } | null;
}

/** Textur einer Palette-Auslegung als RGB-Puffer. */
function texRgb(tex: TextureSource, perm: (r: number, g: number, b: number, a: number) => [number, number, number]): { w: number; h: number; rgb: Uint8Array } {
  const pal = tex.palettes[0] ?? new Uint8Array(4);
  const farben = pal.length / 4;
  const rgb = new Uint8Array(tex.width * tex.height * 3);
  for (let i = 0; i < tex.pixelIndices.length; i++) {
    const idx = Math.min(tex.pixelIndices[i]!, farben - 1) * 4;
    const [r, g, b] = perm(pal[idx]!, pal[idx + 1]!, pal[idx + 2]!, pal[idx + 3]!);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  return { w: tex.width, h: tex.height, rgb };
}

/** Orthographische Frontansicht, Tiefenpuffer, Textur- oder Vertexfarbe. */
function rasterize(tris: Dreieck[]): Buffer {
  const px = new Uint8Array(W * H * 3).fill(18);
  const zb = new Float32Array(W * H).fill(-Infinity);
  if (tris.length === 0) return encodePng(W, H, px);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const p of t.p) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const s = Math.min((W - 16) / Math.max(1e-6, maxX - minX), (H - 16) / Math.max(1e-6, maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scr = (p: Vec3): [number, number, number] => [W / 2 + (p[0] - cx) * s, H / 2 - (p[1] - cy) * s, p[2]];

  for (const t of tris) {
    const a = scr(t.p[0]), b = scr(t.p[1]), c = scr(t.p[2]);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-9) continue;

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

        let r: number, g: number, bl: number;
        if (t.tex) {
          const u = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0];
          const v = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
          const tx = ((Math.floor(u * t.tex.w) % t.tex.w) + t.tex.w) % t.tex.w;
          const ty = ((Math.floor(v * t.tex.h) % t.tex.h) + t.tex.h) % t.tex.h;
          const o = (ty * t.tex.w + tx) * 3;
          r = t.tex.rgb[o]!; g = t.tex.rgb[o + 1]!; bl = t.tex.rgb[o + 2]!;
        } else {
          r = w0 * t.col[0][0] + w1 * t.col[1][0] + w2 * t.col[2][0];
          g = w0 * t.col[0][1] + w1 * t.col[1][1] + w2 * t.col[2][1];
          bl = w0 * t.col[0][2] + w1 * t.col[1][2] + w2 * t.col[2][2];
        }
        px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = bl;
      }
    }
  }
  return encodePng(W, H, px);
}

interface BoneRes {
  mesh: MeshSource;
  texturen: (TextureSource | null)[];
}
interface Modell {
  skeleton: Skeleton;
  res: Map<number, BoneRes[]>;
  clip: AnimationClipSource;
  texAnzahl: number;
  texDreiecke: number;
}

interface Optionen {
  palette: string;
  flipV: boolean;
  flipU: boolean;
  /** Vertexfarb-Permutation; null = Texturen verwenden. */
  vertexPerm: ((r: number, g: number, b: number) => Vec3) | null;
}

function dreiecke(m: Modell, opt: Optionen): Dreieck[] {
  const frame = m.clip.frames[0]!;
  const poses = computePose(m.skeleton, frame, true);
  const perm = PALETTEN[opt.palette]!;
  const cache = new Map<TextureSource, { w: number; h: number; rgb: Uint8Array }>();
  const out: Dreieck[] = [];

  for (const [boneIndex, liste] of m.res) {
    const mat = poses[boneIndex]?.matrix;
    if (!mat) continue;
    for (const { mesh, texturen } of liste) {
      for (const sub of mesh.submeshes) {
        let bild: { w: number; h: number; rgb: Uint8Array } | null = null;
        if (!opt.vertexPerm && sub.textured) {
          const tex = texturen[sub.textureIndex] ?? null;
          if (tex) {
            let b = cache.get(tex);
            if (!b) { b = texRgb(tex, perm); cache.set(tex, b); }
            bild = b;
          }
        }
        for (let i = sub.start; i + 3 <= sub.start + sub.count; i += 3) {
          const p: Vec3[] = [];
          const uv: Vec2[] = [];
          const col: Vec3[] = [];
          for (let e = 0; e < 3; e++) {
            const vi = mesh.indices[i + e]!;
            const mp = transformPoint(mat, [
              mesh.positions[vi * 3]!, mesh.positions[vi * 3 + 1]!, mesh.positions[vi * 3 + 2]!,
            ]);
            p.push(ff7ToScene(mp) as Vec3);
            const u = mesh.uvs[vi * 2] ?? 0;
            const v = mesh.uvs[vi * 2 + 1] ?? 0;
            uv.push([opt.flipU ? 1 - u : u, opt.flipV ? 1 - v : v]);
            const cr = mesh.colors[vi * 4] ?? 255;
            const cg = mesh.colors[vi * 4 + 1] ?? 255;
            const cb = mesh.colors[vi * 4 + 2] ?? 255;
            col.push(opt.vertexPerm ? opt.vertexPerm(cr, cg, cb) : [cr, cg, cb]);
          }
          out.push({
            p: [p[0]!, p[1]!, p[2]!],
            uv: [uv[0]!, uv[1]!, uv[2]!],
            col: [col[0]!, col[1]!, col[2]!],
            tex: bild,
          });
        }
      }
    }
  }
  return out;
}

describe.skipIf(!available)('Realdaten: B5/B6-Bildtafel (Palette, Vertexfarben, UV)', () => {
  it('rendert 20 Farb-/UV-Varianten in eine lokale HTML-Tafel', async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });
    const entries = [...index.listEntries('char')];
    const idByName = new Map(entries.map((e) => [e.name.toLowerCase(), e.canonicalId]));
    const read = (name: string): Promise<Uint8Array> => index.readEntry(idByName.get(name)!);

    const paare = new Map<string, string>();
    for (const entry of [...index.listEntries('flevel')].filter((e) => !e.name.includes('.')).slice(0, 60)) {
      let parsed;
      try {
        parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      } catch {
        continue;
      }
      for (const mm of parsed.bundle?.models?.models ?? []) {
        const anim = mm.animations[0];
        if (!anim) continue;
        const aFile = splitAnimationName(anim.name).file.toLowerCase();
        if (!paare.has(mm.modelFile) && idByName.has(aFile)) paare.set(mm.modelFile, aFile);
      }
    }

    const modelle: Modell[] = [];
    for (const [hrcName, aName] of [...paare].slice(0, 40)) {
      if (!idByName.has(hrcName)) continue;
      const skeleton = parseHrc(await read(hrcName), hrcName).value;
      if (!skeleton) continue;
      const res = new Map<number, BoneRes[]>();
      let texAnzahl = 0;
      for (const [boneIndex, bone] of skeleton.bones.entries()) {
        for (const ref of bone.resourceRefs) {
          const rsd = idByName.has(`${ref}.rsd`) ? parseRsd(await read(`${ref}.rsd`), `${ref}.rsd`).value : null;
          if (!rsd || !idByName.has(`${rsd.meshRef}.p`)) continue;
          const mesh = parseP(await read(`${rsd.meshRef}.p`), `${rsd.meshRef}.p`).value;
          if (!mesh) continue;
          const texturen: (TextureSource | null)[] = [];
          for (const t of rsd.textureRefs) {
            const datei = `${t}.tex`;
            const tex = idByName.has(datei) ? parseTex(await read(datei), datei).value : null;
            if (tex) texAnzahl++;
            texturen.push(tex);
          }
          const liste = res.get(boneIndex) ?? [];
          liste.push({ mesh, texturen });
          res.set(boneIndex, liste);
        }
      }
      const clip = parseA(await read(aName), aName).value;
      if (!clip || clip.frames.length === 0 || res.size === 0) continue;
      modelle.push({ skeleton, res, clip, texAnzahl, texDreiecke: 0 });
    }
    await dir.closeAll();

    // Sortiert wird nach texturierten DREIECKEN, nicht nach der Zahl der
    // Texturdateien: Ein Modell mit drei Texturen auf winzigen Flächen macht
    // die Palettenfrage unentscheidbar. Genau das ist im ersten Anlauf
    // passiert — die vier Permutationen sahen fast gleich aus, weil die
    // sichtbare Farbe überwiegend aus Vertexfarben kam.
    const texturierteDreiecke = (m: Modell): number => {
      let n = 0;
      for (const liste of m.res.values()) {
        for (const { mesh, texturen } of liste) {
          for (const sub of mesh.submeshes) {
            if (sub.textured && texturen[sub.textureIndex]) n += sub.count / 3;
          }
        }
      }
      return n;
    };
    for (const m of modelle) m.texDreiecke = texturierteDreiecke(m);
    modelle.sort((a, b) => b.texDreiecke - a.texDreiecke);
    expect(modelle.length).toBeGreaterThan(2);
    expect(modelle[0]!.texAnzahl).toBeGreaterThan(0);
    const haupt = modelle[0]!;

    // --- Abschnitt 1: Palette × UV
    const zellen1: string[] = [];
    const signaturen: string[] = [];
    let nr = 1;
    for (const palette of Object.keys(PALETTEN)) {
      for (const flipV of [false, true]) {
        for (const flipU of [false, true]) {
          const png = rasterize(dreiecke(haupt, { palette, flipV, flipU, vertexPerm: null }));
          signaturen.push(png.toString('base64').slice(0, 64));
          zellen1.push(
            `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}"><figcaption><b>T${nr++}</b><br>Palette <b>${palette}</b><br>V ${flipV ? 'geflippt' : 'roh'} · U ${flipU ? 'geflippt' : 'roh'}</figcaption></figure>`,
          );
        }
      }
    }

    // --- Abschnitt 2: Vertexfarben, Texturen abgeschaltet
    const zellen2: string[] = [];
    const VERTEX: Record<string, (r: number, g: number, b: number) => Vec3> = {
      'BGRA (heute)': (r, g, b) => [r, g, b],
      'RGBA': (r, g, b) => [b, g, r],
    };
    let vn = 1;
    for (const [n, m] of modelle.slice(0, 2).entries()) {
      for (const [name, fn] of Object.entries(VERTEX)) {
        const png = rasterize(dreiecke(m, { palette: 'BGRA (heute)', flipV: false, flipU: false, vertexPerm: fn }));
        zellen2.push(
          `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}"><figcaption><b>V${vn++}</b><br>Modell ${n + 1} · Vertexfarben <b>${name}</b><br>Texturen aus</figcaption></figure>`,
        );
      }
    }

    // --- Abschnitt 3: die Texturen SELBST unter den vier Permutationen.
    //
    // Auf dem Modell nimmt die texturierte Fläche nur einen Bruchteil ein; die
    // Kanalfrage entscheidet sich am Bild direkt. Ein Hautton in vertauschter
    // Reihenfolge ist als Blau- oder Grünstich sofort erkennbar, während
    // dieselbe Vertauschung auf einer briefmarkengroßen Fläche untergeht.
    const zellen3: string[] = [];
    const alleTex: TextureSource[] = [];
    // Texturen aus MEHREREN Modellen sammeln, bevorzugt aus figürlichen
    // (viele Bones). Ein einzelnes Modell liefert womöglich nur Effektsprites
    // — und bei einer Flamme ist „cyan oder rot" nicht entscheidbar, weil
    // beides als Effekt plausibel wäre. Hauttöne sind es dagegen sehr wohl:
    // Es gibt keine plausible Lesart, in der ein Gesicht blau ist.
    const figuerlich = [...modelle].sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length);
    for (const m of figuerlich) {
      if (alleTex.length >= 6) break;
      for (const liste of m.res.values()) {
        for (const { texturen } of liste) {
          for (const t of texturen) {
            if (t && !alleTex.includes(t) && alleTex.length < 6) alleTex.push(t);
          }
        }
      }
    }
    let tn = 1;
    for (const [ti, tex] of alleTex.entries()) {
      for (const palette of Object.keys(PALETTEN)) {
        const bild = texRgb(tex, PALETTEN[palette]!);
        // Auf Zellgröße hochskalieren (Nearest), damit Paletten sichtbar sind.
        const px = new Uint8Array(W * H * 3).fill(18);
        const s2 = Math.min(W / bild.w, H / bild.h);
        const ox = Math.floor((W - bild.w * s2) / 2);
        const oy = Math.floor((H - bild.h * s2) / 2);
        for (let y = 0; y < Math.floor(bild.h * s2); y++) {
          for (let x = 0; x < Math.floor(bild.w * s2); x++) {
            const sx = Math.min(bild.w - 1, Math.floor(x / s2));
            const sy = Math.min(bild.h - 1, Math.floor(y / s2));
            const so = (sy * bild.w + sx) * 3;
            const dobj = ((y + oy) * W + (x + ox)) * 3;
            px[dobj] = bild.rgb[so]!;
            px[dobj + 1] = bild.rgb[so + 1]!;
            px[dobj + 2] = bild.rgb[so + 2]!;
          }
        }
        const png = encodePng(W, H, px);
        zellen3.push(
          `<figure><img src="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}"><figcaption><b>P${tn++}</b><br>Textur ${ti + 1} (${bild.w}×${bild.h}) · <b>${palette}</b></figcaption></figure>`,
        );
      }
    }

    const html = `<!doctype html><meta charset="utf-8"><title>B5/B6 — Palette, Vertexfarben, UV</title>
<style>
body{background:#111;color:#ddd;font:14px/1.45 system-ui,sans-serif;margin:24px}
h1{font-size:20px} h2{font-size:16px;margin-top:32px;color:#7aa2f7} p{max-width:74ch;color:#aaa}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-top:16px}
figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:6px;padding:8px}
img{display:block;border-radius:4px;background:#121212}
figcaption{font-size:11px;line-height:1.4;margin-top:6px;color:#bbb}
b{color:#fff}
</style>
<h1>B5/B6 — Farbkanäle und UV-Ursprung</h1>
<p>Frontansicht, Frame&nbsp;0, Modellorientierung wie zuletzt bestätigt. Gesucht ist die Zelle mit <b>natürlichen Hautfarben und passender Kleidung</b> — falsche Kanalreihenfolge macht Haut blau oder grün, ein falscher UV-Ursprung setzt die Texturstreifen kopfüber oder seitenverkehrt.</p>
<h2>Abschnitt 1 — Palettenreihenfolge (B5) × UV-Ursprung (B6b)</h2>
<p>16 Zellen: vier Kanalauslegungen des Palettenblocks, je mit und ohne V- und U-Flip.</p>
<div class="grid">${zellen1.join('\n')}</div>
<h2>Abschnitt 2 — Vertexfarben (B6a), Texturen abgeschaltet</h2>
<p>Die Vertexfarben sind unter den Texturen unsichtbar; deshalb hier ohne. Zwei Modelle, je beide Kanalauslegungen.</p>
<div class="grid">${zellen2.join('\n')}</div>
<h2>Abschnitt 3 — die Texturbilder selbst (B5, entscheidend)</h2>
<p>Dieselben Paletten-Auslegungen, aber direkt auf das Texturbild angewandt statt auf das Modell. Gesucht ist die Zelle mit <b>plausiblen Hauttönen</b> — die falschen Reihenfolgen erzeugen einen Blau- oder Grünstich, der hier großflächig sichtbar ist.</p>
<div class="grid">${zellen3.join('\n')}</div>`;

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, html, 'utf8');
    console.log(`B5/B6-Bildtafel geschrieben: ${OUT}`);
    console.log(`Modelle: ${modelle.length}, texturierte Dreiecke im Hauptmodell: ${haupt.texDreiecke}, Texturen: ${alleTex.length}, Bones mit Geometrie: ${haupt.res.size}`);

    // Kontrolle: Die vier Palettenauslegungen MÜSSEN sich unterscheiden.
    // Wären die Bilder gleich, wäre entweder die Textur einfarbig oder der
    // Texturpfad tot — und die ganze Tafel wertlos.
    expect(new Set(signaturen).size).toBeGreaterThan(4);
    expect(zellen1.length).toBe(16);
    expect(zellen2.length).toBe(4);
    expect(zellen3.length).toBeGreaterThanOrEqual(16);
    // Die texturierte Fläche muss nennenswert sein, sonst ist B5 am Modell
    // gar nicht sichtbar und Abschnitt 1 wäre irreführend.
    expect(haupt.texDreiecke).toBeGreaterThan(20);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
