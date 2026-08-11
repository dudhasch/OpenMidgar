import { IndexService } from '@webmidgar/io';
import {
  parseA, parseHrc, parseP, parseRsd, parseTex,
  type AnimationClipSource, type AnimationFrame, type MeshSource, type Skeleton, type TextureSource,
} from '@webmidgar/formats-model';
import { parseFieldEntry, splitAnimationName } from '@webmidgar/formats-field';
import { ff7ToScene } from '@webmidgar/convert';
import { computePose, transformPoint } from '@webmidgar/render-actor';
import { encodePng } from './png.js';
import type { NodeDirectorySource } from './node-source.js';

/**
 * Gemeinsame Bausteine der Sichtprüfungs-Tafeln.
 *
 * **Warum ausgelagert.** Bei der Modellorientierung und bei B5/B6 hat dieselbe
 * Methode entschieden, wo Aggregatkennzahlen versagt haben: gerenderte
 * Kandidaten nebeneinander, Urteil durch Ansehen. Ab der zweiten Tafel ist der
 * Rasterizer geteilter Code — ihn zu kopieren hieße, dass zwei Tafeln
 * unbemerkt auseinanderlaufen und ihre Urteile nicht mehr vergleichbar sind.
 *
 * Bewusst ein **eigener, winziger Rasterizer** statt des Produktionspfads:
 * Three.js braucht eine GPU, und eine Tafel, die nur im Browser entsteht, kann
 * nicht Teil der Realdatensuite sein. Der Preis ist, dass hier nur das geprüft
 * wird, was beide Pfade teilen — Format-Auslegung, nicht GPU-Verhalten.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export const W = 210;
export const H = 270;
/** Vorgabegröße einer Tafelzelle (durch `RasterOpt.groesse` überschreibbar). */
const BREITE = W;
const HOEHE = H;

/**
 * Kanalpermutationen, ausgedrückt auf dem, was der Parser BEREITS liefert.
 *
 * `tex.ts` liest BGRA und legt RGBA ab, d. h. das gespeicherte Tripel ist
 * (r,g,b) = (datei2, datei1, datei0). Alle anderen Auslegungen sind daher
 * Permutationen des gespeicherten Tripels — kein Neu-Parsen nötig.
 */
export const PALETTEN: Record<string, (r: number, g: number, b: number, a: number) => Vec3> = {
  'BGRA (heute)': (r, g, b) => [r, g, b],
  'RGBA': (r, g, b) => [b, g, r],
  'ARGB': (r, g, b, a) => [g, r, a],
  'ABGR': (r, g, b, a) => [a, r, g],
};

export interface Bild {
  w: number;
  h: number;
  rgb: Uint8Array;
  /** 0 = durchsichtig laut Palettenalpha. Nur bei BGRA-Lesung sinnvoll. */
  alpha: Uint8Array;
}

export interface Dreieck {
  p: [Vec3, Vec3, Vec3];
  uv: [Vec2, Vec2, Vec2];
  col: [Vec3, Vec3, Vec3];
  tex: Bild | null;
}

/** Textur einer Palette-Auslegung als RGB-Puffer plus Alphamaske. */
export function texRgb(tex: TextureSource, perm: (r: number, g: number, b: number, a: number) => Vec3): Bild {
  const pal = tex.palettes[0] ?? new Uint8Array(4);
  const farben = pal.length / 4;
  const rgb = new Uint8Array(tex.width * tex.height * 3);
  const alpha = new Uint8Array(tex.width * tex.height);
  for (let i = 0; i < tex.pixelIndices.length; i++) {
    const idx = Math.min(tex.pixelIndices[i]!, farben - 1) * 4;
    const [r, g, b] = perm(pal[idx]!, pal[idx + 1]!, pal[idx + 2]!, pal[idx + 3]!);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    alpha[i] = pal[idx + 3]!;
  }
  return { w: tex.width, h: tex.height, rgb, alpha };
}

export interface RasterOpt {
  /** Bei Tiefengleichstand die später gezeichnete Fläche durchlassen. */
  spaetereGewinnen?: boolean;
  /** Texel mit Palettenalpha 0 überspringen (Farbschlüssel). */
  transparenz?: boolean;
  /**
   * Aufkleber-Versatz: Jedes Dreieck bekommt eine mit der Zeichenreihenfolge
   * wachsende, verschwindend kleine Tiefenzugabe. Koplanare Flächen können
   * dadurch nicht mehr um einzelne Pixel streiten.
   */
  aufkleberVersatz?: boolean;
  /**
   * **Festes Sichtfenster statt Einpassung.** Ohne dieses Feld skaliert jede
   * Zelle auf ihren eigenen Inhalt — für Farb- und Formfragen richtig, für
   * **Lagefragen fatal**: Eine Figur, die relativ zum Boden nach oben rutscht,
   * würde von der Einpassung stillschweigend wieder zentriert, und die Tafel
   * zeigte in jeder Zelle dasselbe Bild. Wer Höhenlagen vergleicht, muss allen
   * Varianten eines Modells dasselbe Fenster geben.
   */
  fenster?: { cx: number; cy: number; halbHoehe: number };
  /**
   * Abweichende Zellgröße. Ohne Angabe die Tafelgröße `W`×`H` (210×270) —
   * richtig für Vergleichstafeln mit vielen Zellen. Für IDENTIFIKATIONSfragen
   * („welche Figur ist das?") ist 210×270 zu klein: Ein Stachelhaar oder ein
   * Waffenarm verschwindet dort im Rauschen. K4 rendert deshalb einzeln und
   * groß. Der Rasterizer bleibt derselbe — nur die Auflösung ändert sich.
   */
  groesse?: { w: number; h: number };
}

/** Orthographische Frontansicht, Tiefenpuffer, Textur- oder Vertexfarbe. */
export function rasterize(tris: Dreieck[], opt: RasterOpt = {}): Buffer {
  const bild = rasterizePixels(tris, opt);
  return encodePng(bild.w, bild.h, bild.px);
}

/** Wie `rasterize`, aber als roher RGB-Puffer (für Montagen/Weiterverarbeitung). */
export function rasterizePixels(tris: Dreieck[], opt: RasterOpt = {}): { w: number; h: number; px: Uint8Array } {
  const W = opt.groesse?.w ?? BREITE;
  const H = opt.groesse?.h ?? HOEHE;
  const px = new Uint8Array(W * H * 3).fill(18);
  const zb = new Float32Array(W * H).fill(-Infinity);
  if (tris.length === 0) return { w: W, h: H, px };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) for (const p of t.p) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  let s: number, cx: number, cy: number;
  if (opt.fenster) {
    s = (H - 16) / Math.max(1e-6, 2 * opt.fenster.halbHoehe);
    cx = opt.fenster.cx;
    cy = opt.fenster.cy;
  } else {
    s = Math.min((W - 16) / Math.max(1e-6, maxX - minX), (H - 16) / Math.max(1e-6, maxY - minY));
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
  }
  const scr = (p: Vec3): Vec3 => [W / 2 + (p[0] - cx) * s, H / 2 - (p[1] - cy) * s, p[2]];

  // Der Versatz muss klein gegen echte Tiefenunterschiede und gross gegen den
  // Rundungsfehler sein. Ein Zehntausendstel der Gesamttiefe je Dreieck
  // erfüllt beides, solange die Dreieckszahl im Tausenderbereich bleibt.
  const spanne = Math.max(1e-6, maxZ - minZ);
  const schritt = opt.aufkleberVersatz ? (spanne * 1e-3) / Math.max(1, tris.length) : 0;

  for (const [ti, t] of tris.entries()) {
    const bias = schritt * ti;
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
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2] + bias;
        const i = y * W + x;
        if (opt.spaetereGewinnen ? z < zb[i]! : z <= zb[i]!) continue;

        let r: number, g: number, bl: number;
        if (t.tex) {
          const u = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0];
          const v = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
          const tx = ((Math.floor(u * t.tex.w) % t.tex.w) + t.tex.w) % t.tex.w;
          const ty = ((Math.floor(v * t.tex.h) % t.tex.h) + t.tex.h) % t.tex.h;
          const o = ty * t.tex.w + tx;
          // Durchsichtige Texel dürfen den Tiefenpuffer NICHT beschreiben —
          // sonst verdeckt der unsichtbare Teil des Aufklebers das Gesicht
          // genauso zuverlässig wie der sichtbare, und man hätte nichts
          // gewonnen ausser einem Loch.
          if (opt.transparenz && t.tex.alpha[o] === 0) continue;
          r = t.tex.rgb[o * 3]!; g = t.tex.rgb[o * 3 + 1]!; bl = t.tex.rgb[o * 3 + 2]!;
        } else {
          r = w0 * t.col[0][0] + w1 * t.col[1][0] + w2 * t.col[2][0];
          g = w0 * t.col[0][1] + w1 * t.col[1][1] + w2 * t.col[2][1];
          bl = w0 * t.col[0][2] + w1 * t.col[1][2] + w2 * t.col[2][2];
        }
        zb[i] = z;
        px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = bl;
      }
    }
  }
  return { w: W, h: H, px };
}

export interface BoneRes {
  mesh: MeshSource;
  texturen: (TextureSource | null)[];
}

export interface Modell {
  skeleton: Skeleton;
  res: Map<number, BoneRes[]>;
  clip: AnimationClipSource;
  texAnzahl: number;
  texDreiecke: number;
}

export interface Optionen {
  palette: string;
  flipV: boolean;
  flipU: boolean;
  /** Vertexfarb-Permutation; null = Texturen verwenden. */
  vertexPerm: ((r: number, g: number, b: number) => Vec3) | null;
  /**
   * Abweichender Frame. Ohne Angabe Frame 0.
   *
   * Trägt die B3- und B4-Gegenhypothesen: Beide lassen sich als **veränderter
   * Frame** ausdrücken (Wurzelhälften vertauscht bzw. Rotationsblöcke
   * umsortiert), statt die Posenmathematik zu duplizieren. Damit prüft die
   * Tafel denselben `computePose`, den auch die Produktion benutzt — eine
   * zweite Posenimplementierung könnte sonst unbemerkt abweichen und die
   * Urteile wären nicht auf den Renderpfad übertragbar.
   */
  frame?: AnimationFrame;
  /** Höhenversatz in Szenenkoordinaten, nach ADR-009 aufgeschlagen (B7). */
  versatzY?: number;
}

export function dreiecke(m: Modell, opt: Optionen): Dreieck[] {
  const frame = opt.frame ?? m.clip.frames[0]!;
  const dy = opt.versatzY ?? 0;
  const poses = computePose(m.skeleton, frame, true);
  const perm = PALETTEN[opt.palette]!;
  const cache = new Map<TextureSource, Bild>();
  const out: Dreieck[] = [];

  for (const [boneIndex, liste] of m.res) {
    const mat = poses[boneIndex]?.matrix;
    if (!mat) continue;
    for (const { mesh, texturen } of liste) {
      for (const sub of mesh.submeshes) {
        let bild: Bild | null = null;
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
            const sp = ff7ToScene(mp) as Vec3;
            p.push([sp[0], sp[1] + dy, sp[2]]);
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

/** Ein Texturbild als Zelle, mit Nearest auf Zellgroesse gebracht. */
export function texZelle(
  tex: TextureSource,
  perm: (r: number, g: number, b: number, a: number) => Vec3,
  transparenzAls?: Vec3,
): Buffer {
  const bild = texRgb(tex, perm);
  const px = new Uint8Array(W * H * 3).fill(18);
  const s = Math.min(W / bild.w, H / bild.h);
  const ox = Math.floor((W - bild.w * s) / 2);
  const oy = Math.floor((H - bild.h * s) / 2);
  for (let y = 0; y < Math.floor(bild.h * s); y++) {
    for (let x = 0; x < Math.floor(bild.w * s); x++) {
      const sx = Math.min(bild.w - 1, Math.floor(x / s));
      const sy = Math.min(bild.h - 1, Math.floor(y / s));
      const so = sy * bild.w + sx;
      const dst = ((y + oy) * W + (x + ox)) * 3;
      if (transparenzAls && bild.alpha[so] === 0) {
        // Schachbrett statt Farbe: Ein durchsichtiger Bereich soll im
        // Formular als durchsichtig ERKENNBAR sein und nicht als schwarze
        // Fläche, die man für Bildinhalt halten kann.
        const hell = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        px[dst] = hell ? transparenzAls[0] : transparenzAls[0] / 2;
        px[dst + 1] = hell ? transparenzAls[1] : transparenzAls[1] / 2;
        px[dst + 2] = hell ? transparenzAls[2] : transparenzAls[2] / 2;
        continue;
      }
      px[dst] = bild.rgb[so * 3]!;
      px[dst + 1] = bild.rgb[so * 3 + 1]!;
      px[dst + 2] = bild.rgb[so * 3 + 2]!;
    }
  }
  return encodePng(W, H, px);
}

/**
 * Modelle aus char.lgp laden, gepaart mit einer Animation aus flevel.
 *
 * Die Paarung ist nötig, weil ein `.hrc` allein keine Pose hat: Ohne Frame
 * stünde jedes Modell in einer Bindpose, die im Spiel nie vorkommt.
 */
export async function ladeModelle(
  dir: NodeDirectorySource,
  index: IndexService,
  grenze = 40,
): Promise<Modell[]> {
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
  for (const [hrcName, aName] of [...paare].slice(0, grenze)) {
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
  return modelle;
}

export function texturierteDreiecke(m: Modell): number {
  let n = 0;
  for (const liste of m.res.values()) {
    for (const { mesh, texturen } of liste) {
      for (const sub of mesh.submeshes) {
        if (sub.textured && texturen[sub.textureIndex]) n += sub.count / 3;
      }
    }
  }
  return n;
}

export interface Fall {
  id: string;
  gruppe: string;
  frage: string;
  variante: string;
  detail: string;
  png: Buffer;
}

export interface TafelOpt {
  titel: string;
  speicher: string;
  kennung: string;
  einleitung: string;
  /** Antwortmöglichkeiten je Fall (Wert → Beschriftung). */
  wahl: Array<[string, string]>;
}

export function html(faelle: Fall[], opt: TafelOpt): string {
  const gruppen = [...new Set(faelle.map((f) => f.gruppe))];
  const abschnitte = gruppen.map((g) => {
    const eigene = faelle.filter((f) => f.gruppe === g);
    const karten = eigene.map((f) => `
      <figure data-id="${f.id}" data-gruppe="${f.gruppe}" data-variante="${f.variante}" data-detail="${f.detail.replace(/"/g, '&quot;')}">
        <img src="data:image/png;base64,${f.png.toString('base64')}" width="${W}" height="${H}" alt="${f.id}">
        <figcaption><b>${f.id}</b> — ${f.variante}<br><span class="d">${f.detail}</span></figcaption>
        <div class="wahl">
          ${opt.wahl.map(([v, l]) => `<label><input type="radio" name="${f.id}" value="${v}"> ${l}</label>`).join('\n          ')}
          <input class="notiz" type="text" placeholder="was genau? (optional)">
        </div>
      </figure>`).join('\n');
    return `<h2>${g}</h2><p class="frage">${eigene[0]?.frage ?? ''}</p><div class="grid">${karten}</div>`;
  }).join('\n');

  return `<!doctype html><meta charset="utf-8"><title>${opt.titel}</title>
<style>
:root{color-scheme:dark}
body{background:#111;color:#ddd;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px 24px 220px}
h1{font-size:21px;margin:0 0 6px} h2{font-size:16px;color:#7aa2f7;margin:34px 0 4px}
p{max-width:78ch;color:#aaa;margin:6px 0} .frage{color:#e0af68}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:14px;margin-top:12px}
figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:9px}
figure.fertig{border-color:#2f6f4f;background:#16211b}
img{display:block;border-radius:4px;background:#121212;width:100%;height:auto}
figcaption{font-size:11.5px;line-height:1.4;margin:7px 0 6px;color:#ccc}
b{color:#fff} .d{color:#888}
.wahl{display:flex;flex-direction:column;gap:3px;font-size:12px}
.wahl label{display:flex;align-items:center;gap:6px;cursor:pointer;padding:1px 0}
.notiz{margin-top:4px;background:#111;border:1px solid #3a3a3a;border-radius:4px;color:#ddd;padding:4px 6px;font:inherit;font-size:11.5px}
#leiste{position:fixed;left:0;right:0;bottom:0;background:#181818;border-top:1px solid #333;padding:12px 24px;display:flex;gap:14px;align-items:flex-start}
#leiste textarea{flex:1;height:120px;background:#111;color:#9ece6a;border:1px solid #3a3a3a;border-radius:6px;padding:8px;font:12px/1.4 ui-monospace,Consolas,monospace;resize:vertical}
#leiste .rechts{display:flex;flex-direction:column;gap:8px;min-width:190px}
button{background:#2d4f7c;color:#fff;border:0;border-radius:6px;padding:9px 12px;font:inherit;cursor:pointer}
button:hover{background:#3a67a0}
#stand{font-size:12.5px;color:#aaa}
</style>
<h1>${opt.titel}</h1>
${opt.einleitung}
${abschnitte}

<div id="leiste">
  <textarea id="json" readonly></textarea>
  <div class="rechts">
    <div id="stand"></div>
    <button id="kopieren">JSON kopieren</button>
    <button id="leeren">Antworten verwerfen</button>
  </div>
</div>

<script>
const SPEICHER = ${JSON.stringify(opt.speicher)};
const KENNUNG = ${JSON.stringify(opt.kennung)};
const karten = [...document.querySelectorAll('figure[data-id]')];

function laden() {
  try {
    const roh = localStorage.getItem(SPEICHER);
    if (!roh) return;
    const daten = JSON.parse(roh);
    for (const k of karten) {
      const e = daten[k.dataset.id];
      if (!e) continue;
      if (e.urteil) {
        const r = k.querySelector('input[value="' + e.urteil + '"]');
        if (r) r.checked = true;
      }
      if (e.notiz) k.querySelector('.notiz').value = e.notiz;
    }
  } catch (_) { /* localStorage kann bei file:// gesperrt sein */ }
}

function sammeln() {
  return karten.map((k) => {
    const gewaehlt = k.querySelector('input[type=radio]:checked');
    const notiz = k.querySelector('.notiz').value.trim();
    k.classList.toggle('fertig', !!gewaehlt);
    return {
      id: k.dataset.id,
      gruppe: k.dataset.gruppe,
      variante: k.dataset.variante,
      // Die Kennzahlen gehören ins JSON, nicht nur ins Bild: Ohne sie ist aus
      // einem Urteil zwar die gewählte Variante ablesbar, aber nicht der Wert,
      // den sie trägt — und genau der wird hinterher zur Regel.
      detail: k.dataset.detail || '',
      urteil: gewaehlt ? gewaehlt.value : 'offen',
      notiz: notiz,
    };
  });
}

function aktualisieren() {
  const faelle = sammeln();
  const beantwortet = faelle.filter((f) => f.urteil !== 'offen').length;
  document.getElementById('stand').textContent = beantwortet + ' von ' + faelle.length + ' beantwortet';
  document.getElementById('json').value = JSON.stringify({ tafel: KENNUNG, version: 1, faelle: faelle }, null, 1);
  try {
    const karte = {};
    for (const f of faelle) karte[f.id] = { urteil: f.urteil, notiz: f.notiz };
    localStorage.setItem(SPEICHER, JSON.stringify(karte));
  } catch (_) { /* egal */ }
}

document.addEventListener('input', aktualisieren);
document.addEventListener('change', aktualisieren);

document.getElementById('kopieren').addEventListener('click', async () => {
  const ta = document.getElementById('json');
  const btn = document.getElementById('kopieren');
  try {
    await navigator.clipboard.writeText(ta.value);
    btn.textContent = 'kopiert ✓';
  } catch (_) {
    // Bei file:// ist die Zwischenablage oft gesperrt — dann markieren,
    // damit Strg+C trotzdem funktioniert.
    ta.removeAttribute('readonly');
    ta.select();
    btn.textContent = 'markiert — Strg+C';
    ta.setAttribute('readonly', '');
  }
  setTimeout(() => { btn.textContent = 'JSON kopieren'; }, 2200);
});

document.getElementById('leeren').addEventListener('click', () => {
  if (!confirm('Alle Antworten verwerfen?')) return;
  for (const k of karten) {
    for (const r of k.querySelectorAll('input[type=radio]')) r.checked = false;
    k.querySelector('.notiz').value = '';
  }
  try { localStorage.removeItem(SPEICHER); } catch (_) {}
  aktualisieren();
});

laden();
aktualisieren();
</script>`;
}
