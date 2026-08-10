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
  'C:\\Users\\timur\\AppData\\Local\\Temp\\claude\\C--ff7-web\\49dab9ae-a74e-4275-bde7-8575218c5ff6\\scratchpad\\b5b6-formular.html';

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

/** Ein Texturbild als Zelle, mit Nearest auf Zellgroesse gebracht. */
function texZelle(tex: TextureSource, perm: (r: number, g: number, b: number, a: number) => [number, number, number]): Buffer {
  const bild = texRgb(tex, perm);
  const px = new Uint8Array(W * H * 3).fill(18);
  const s = Math.min(W / bild.w, H / bild.h);
  const ox = Math.floor((W - bild.w * s) / 2);
  const oy = Math.floor((H - bild.h * s) / 2);
  for (let y = 0; y < Math.floor(bild.h * s); y++) {
    for (let x = 0; x < Math.floor(bild.w * s); x++) {
      const sx = Math.min(bild.w - 1, Math.floor(x / s));
      const sy = Math.min(bild.h - 1, Math.floor(y / s));
      const so = (sy * bild.w + sx) * 3;
      const dst = ((y + oy) * W + (x + ox)) * 3;
      px[dst] = bild.rgb[so]!;
      px[dst + 1] = bild.rgb[so + 1]!;
      px[dst + 2] = bild.rgb[so + 2]!;
    }
  }
  return encodePng(W, H, px);
}

interface Fall {
  id: string;
  gruppe: string;
  frage: string;
  variante: string;
  detail: string;
  png: Buffer;
}

function html(faelle: Fall[]): string {
  const gruppen = [...new Set(faelle.map((f) => f.gruppe))];
  const abschnitte = gruppen.map((g) => {
    const eigene = faelle.filter((f) => f.gruppe === g);
    const karten = eigene.map((f) => `
      <figure data-id="${f.id}" data-gruppe="${f.gruppe}" data-variante="${f.variante}">
        <img src="data:image/png;base64,${f.png.toString('base64')}" width="${W}" height="${H}" alt="${f.id}">
        <figcaption><b>${f.id}</b> — ${f.variante}<br><span class="d">${f.detail}</span></figcaption>
        <div class="wahl">
          <label><input type="radio" name="${f.id}" value="richtig"> richtig</label>
          <label><input type="radio" name="${f.id}" value="falsche-farbe"> falsche Farbe</label>
          <label><input type="radio" name="${f.id}" value="anderes"> etwas anderes</label>
          <input class="notiz" type="text" placeholder="was genau? (optional)">
        </div>
      </figure>`).join('\n');
    return `<h2>${g}</h2><p class="frage">${eigene[0]?.frage ?? ''}</p><div class="grid">${karten}</div>`;
  }).join('\n');

  return `<!doctype html><meta charset="utf-8"><title>B5/B6 — Testfälle</title>
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
<h1>B5/B6 — Farbkanäle und UV-Ursprung</h1>
<p>Bitte je Fall eine Auswahl treffen. Unbeantwortete Fälle sind erlaubt — sie erscheinen im JSON als <code>offen</code>. Der Fortschritt bleibt beim Neuladen erhalten.</p>
<p><b>Hinweis:</b> Zwei Zellen derselben Textur können <i>identisch</i> aussehen. Das ist kein Fehler: Bei grauen Palettenfarben (R&nbsp;=&nbsp;G&nbsp;=&nbsp;B) fallen Kanalvertauschungen zusammen. Solche Paare bitte gleich bewerten — sie tragen zur Entscheidung schlicht nichts bei.</p>
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
const SPEICHER = 'b5b6-urteile';
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
  const faelle = karten.map((k) => {
    const gewaehlt = k.querySelector('input[type=radio]:checked');
    const notiz = k.querySelector('.notiz').value.trim();
    k.classList.toggle('fertig', !!gewaehlt);
    return {
      id: k.dataset.id,
      gruppe: k.dataset.gruppe,
      variante: k.dataset.variante,
      urteil: gewaehlt ? gewaehlt.value : 'offen',
      notiz: notiz,
    };
  });
  return faelle;
}

function aktualisieren() {
  const faelle = sammeln();
  const beantwortet = faelle.filter((f) => f.urteil !== 'offen').length;
  document.getElementById('stand').textContent = beantwortet + ' von ' + faelle.length + ' beantwortet';
  const ausgabe = { tafel: 'b5b6', version: 1, faelle: faelle };
  document.getElementById('json').value = JSON.stringify(ausgabe, null, 1);
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

describe.skipIf(!available)('Realdaten: B5/B6-Testformular (Palette, Vertexfarben, UV)', () => {
  it('erzeugt ein lokales Formular mit unabhängigen Testfällen', async () => {
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
    const haupt = modelle[0]!;
    expect(haupt.texDreiecke).toBeGreaterThan(20);

    // Texturen aus mehreren FIGÜRLICHEN Modellen: Bei einem Effektsprite ist
    // jede Farbe plausibel, bei einem Gesicht nicht.
    const alleTex: TextureSource[] = [];
    for (const m of [...modelle].sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length)) {
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
    // unter. Vier Texturen, damit ein einzelnes mehrdeutiges Sprite (eine
    // cyane Flamme ist als Wasser genauso plausibel wie eine rote als Feuer)
    // die Entscheidung nicht allein trägt.
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
    // UV-Kombinationen.
    let un = 1;
    for (const flipV of [false, true]) {
      for (const flipU of [false, true]) {
        faelle.push({
          id: `U${un++}`,
          gruppe: '2 — UV-Ursprung (B6b)',
          frage: 'Welche Zelle zeigt die Textur richtig herum? Nur auf Ausrichtung achten, nicht auf Farbe — die entscheidet Gruppe 1.',
          variante: `V ${flipV ? 'geflippt' : 'roh'} · U ${flipU ? 'geflippt' : 'roh'}`,
          detail: 'Modell, Palette BGRA',
          png: rasterize(dreiecke(haupt, { palette: 'BGRA (heute)', flipV, flipU, vertexPerm: null })),
        });
      }
    }

    // --- Gruppe 3: Vertexfarben, Texturen abgeschaltet.
    const VERTEX: Record<string, (r: number, g: number, b: number) => Vec3> = {
      'BGRA (heute)': (r, g, b) => [r, g, b],
      'RGBA': (r, g, b) => [b, g, r],
    };
    let vn = 1;
    const figuren = [...modelle].sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length).slice(0, 2);
    for (const [n, m] of figuren.entries()) {
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
    writeFileSync(OUT, html(faelle), 'utf8');
    console.log(`B5/B6-Testformular geschrieben: ${OUT}`);
    console.log(`Testfälle: ${faelle.length} (Palette ${pn - 1}, UV ${un - 1}, Vertexfarben ${vn - 1})`);

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
    expect(faelle.length).toBe(24);
  }, 900_000);
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(available).toBe(false);
  });
});
