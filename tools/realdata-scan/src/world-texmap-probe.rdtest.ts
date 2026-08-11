import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseWorldAnimatedTextures,
  parseWorldMap,
  parseWorldTextureNames,
  type WorldTerrain,
} from '@webmidgar/formats-world';
import { parseTex, texToRgba } from '@webmidgar/formats-model';
import {
  buildWorldTextureAtlas,
  buildWorldTextureSet,
  buildWorldTextureTable,
  CLTR_NAME,
  countAtlasOverlaps,
  measureTextureFit,
  measureTextureUvRanges,
  type StaticTextureImage,
  type TextureSize,
} from '@webmidgar/render-world';
import { encodePng } from './png.js';

/**
 * **F11b + F25 — Realdatenprobe.**
 *
 * Gegenstand 1 (F11b): welche Texturdatei gehört zu welcher `textureId`?
 * Die Antwort wird nicht geglaubt, sondern über eine Gütefunktion MIT
 * KONTROLLE geprüft: passen die Dreiecks-UVs überhaupt in das Fenster der
 * zugeordneten Textur? Zweitrechnung über seltene Texturgrößen, weil „passt
 * ins Fenster" bei einer 225-fach vorkommenden Größe (32×32) wenig sagt.
 *
 * Gegenstand 2 (F25): Atlas-Accounting — alle benutzten Texturen
 * untergebracht, keine Überlappung, Seitenzahl und Füllgrad berichtet.
 *
 * Gegenstand 3: Sichtnachweis. Zwei Standbilder derselben Kartenausschnitte,
 * einmal Klassenfarben-Diagnose, einmal texturiert, softwaregerastert aus
 * genau den Daten, die auch die Demo benutzt.
 *
 * Urheberrecht: berichtet werden Zähler, Quoten, Maße und Diagnosen. Die
 * Namenstabelle wird aus der EXE DES NUTZERS gelesen und NICHT ins Repo
 * geschrieben; die Standbilder landen außerhalb des Baums.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ?? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';
const WM_DIR = join(REAL_DIR, 'data', 'wm');
const EXE_KANDIDATEN = ['ff7.exe', 'ff7_en.exe'];
const available = existsSync(WM_DIR) && EXE_KANDIDATEN.some((e) => existsSync(join(REAL_DIR, e)));
const OUT_DIR = process.env['WM_PROBE_OUT'] ?? join(REAL_DIR, '..', 'webmidgar-probe');

// --- LGP-Zugriff (nur lesend, ohne Index-Dienst — die Probe steht VOR dem Parser) ---

interface LgpEintrag {
  name: string;
  start: number;
  size: number;
}

function lgpEintraege(bytes: Uint8Array): Map<string, LgpEintrag> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(12, true);
  const out = new Map<string, LgpEintrag>();
  for (let i = 0; i < count; i++) {
    const base = 16 + i * 27;
    let name = '';
    for (let k = 0; k < 20; k++) {
      const c = bytes[base + k]!;
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    const offset = view.getUint32(base + 20, true);
    const size = view.getUint32(offset + 20, true);
    out.set(name.toLowerCase(), { name, start: offset + 24, size });
  }
  return out;
}

function ladeTexturen(lgp: Uint8Array, eintraege: Map<string, LgpEintrag>): {
  sizes: Map<string, TextureSize>;
  images: Map<string, StaticTextureImage>;
  fehler: string[];
} {
  const sizes = new Map<string, TextureSize>();
  const images = new Map<string, StaticTextureImage>();
  const fehler: string[] = [];
  for (const [key, e] of eintraege) {
    if (!key.endsWith('.tex')) continue;
    const base = key.slice(0, -4);
    const r = parseTex(lgp.subarray(e.start, e.start + e.size), key);
    if (!r.value) {
      fehler.push(`${key}: ${r.diagnostics.map((d) => d.code).join(',')}`);
      continue;
    }
    const t = r.value;
    sizes.set(base, { width: t.width, height: t.height });
    // Dekodierung über den bestehenden Pfad — kein zweiter TEX-Dekoder.
    images.set(base, { name: base, width: t.width, height: t.height, rgba: texToRgba(t) });
  }
  return { sizes, images, fehler };
}

interface KartenBefund {
  name: string;
  terrain: WorldTerrain;
  ids: number[];
  fitTotal: number;
  fitHits: number;
  fitRate: number;
  controlMedian: number;
  controlMax: number;
  rareTotal: number;
  rareHits: number;
  rareRate: number;
  rareControlMedian: number;
  rareControlMax: number;
  animatedIds: number;
  animatedTriangleShare: number;
  unresolved: number[];
}

describe.skipIf(!available)('F11b/F25: Weltkarten-Texturen', () => {
  const exeName = EXE_KANDIDATEN.find((e) => existsSync(join(REAL_DIR, e)))!;
  const exe = new Uint8Array(readFileSync(join(REAL_DIR, exeName)));
  const lgp = new Uint8Array(readFileSync(join(WM_DIR, 'world_us.lgp')));
  const eintraege = lgpEintraege(lgp);

  it('K1 — Namenstabelle: Fundstelle gesucht, Accounting geschlossen', () => {
    const tabelle = parseWorldTextureNames(exe)!;
    expect(tabelle).not.toBeNull();
    const benannt = tabelle.names.filter((n) => n !== null) as string[];
    const fehlend = benannt.filter((n) => !eintraege.has(`${n}.tex`));
    const texGesamt = [...eintraege.keys()].filter((k) => k.endsWith('.tex')).length;

    // wm.ta als UNABHÄNGIGE Zweitzählung der animierten Plätze.
    const ta = eintraege.get('wm.ta')!;
    const anim = parseWorldAnimatedTextures(lgp.subarray(ta.start, ta.start + ta.size));

    console.log(
      'K1-NAMENSTABELLE:',
      JSON.stringify(
        {
          exe: exeName,
          tableOffset: `0x${tabelle.tableOffset.toString(16)}`,
          eintraege: tabelle.names.length,
          benannt: benannt.length,
          namenlos: tabelle.animatedCount,
          bases: tabelle.bases,
          texImArchiv: texGesamt,
          namenOhneTexDatei: fehlend.length,
          wmTaEintraege: anim.textures.length,
          wmTaDiagnosen: anim.diagnostics.length,
          wmTaMasse: [...new Set(anim.textures.map((t) => `${t.width}x${t.height}`))],
          wmTaHalbbilder: [...new Set(anim.textures.map((t) => t.frames.length))].sort(),
          schlussnamen: tabelle.names.slice(tabelle.bases.wm2),
        },
        null,
        1,
      ),
    );

    // Killerbeobachtung 1: JEDER benannte Eintrag hat eine Datei.
    expect(fehlend).toEqual([]);
    // Killerbeobachtung 2: namenlose Plätze == wm.ta-Einträge (zwei Quellen).
    expect(tabelle.animatedCount).toBe(anim.textures.length);
    expect(anim.diagnostics).toEqual([]);
    // Killerbeobachtung 3: alle animierten Texturen haben dasselbe Maß.
    expect(new Set(anim.textures.map((t) => `${t.width}x${t.height}`)).size).toBe(1);
  });

  it('K2 — Gütefunktion mit Kontrolle und Zweitrechnung über seltene Größen', () => {
    const tabelle = parseWorldTextureNames(exe)!;
    const { sizes, fehler } = ladeTexturen(lgp, eintraege);
    const ta = eintraege.get('wm.ta')!;
    const anim = parseWorldAnimatedTextures(lgp.subarray(ta.start, ta.start + ta.size));
    const animSizes: TextureSize[] = anim.textures.map((t) => ({ width: t.width, height: t.height }));

    const census = new Map<string, number>();
    for (const s of sizes.values()) census.set(`${s.width}x${s.height}`, (census.get(`${s.width}x${s.height}`) ?? 0) + 1);

    const karten: Array<[string, number]> = [
      ['WM0.MAP', tabelle.bases.wm0],
      ['WM2.MAP', tabelle.bases.wm2],
      ['WM3.MAP', tabelle.bases.wm3],
    ];
    const befunde: KartenBefund[] = [];
    for (const [datei, base] of karten) {
      const terrain = parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, datei))));
      const names = tabelle.names.slice(base);
      const quirk = new Set<number>();
      names.forEach((n, i) => {
        if (n === CLTR_NAME) quirk.add(i);
      });
      const ranges = measureTextureUvRanges(terrain, { quirkTextureIds: quirk });
      const r = buildWorldTextureTable({ ranges, names, sizes, animated: animSizes });
      const m = measureTextureFit(r.entries, ranges, census, { controls: 500, seed: 4242 });
      const gesamtTris = [...ranges.values()].reduce((s, x) => s + x.triangles, 0);
      const animTris = r.entries.filter((e) => e.animatedSlot !== null).reduce((s, e) => s + e.triangles, 0);
      befunde.push({
        name: datei,
        terrain,
        ids: [...ranges.keys()].sort((a, b) => a - b),
        fitTotal: m.total,
        fitHits: m.hits,
        fitRate: m.rate,
        controlMedian: m.controlMedian,
        controlMax: m.controlMax,
        rareTotal: m.rareTotal,
        rareHits: m.rareHits,
        rareRate: m.rareRate,
        rareControlMedian: m.rareControlMedian,
        rareControlMax: m.rareControlMax,
        animatedIds: r.entries.filter((e) => e.animatedSlot !== null).length,
        animatedTriangleShare: gesamtTris ? animTris / gesamtTris : 0,
        unresolved: r.unresolved,
      });
    }

    console.log(
      'K2-GUETE:',
      JSON.stringify(
        {
          texParserFehler: fehler.length,
          karten: befunde.map((b) => ({
            karte: b.name,
            ids: b.ids.length,
            maxId: b.ids[b.ids.length - 1],
            fit: `${b.fitHits}/${b.fitTotal} = ${b.fitRate.toFixed(4)}`,
            kontrolleMedian: b.controlMedian.toFixed(4),
            kontrolleMax: b.controlMax.toFixed(4),
            selten: `${b.rareHits}/${b.rareTotal} = ${b.rareRate.toFixed(4)}`,
            seltenKontrolleMedian: b.rareControlMedian.toFixed(4),
            seltenKontrolleMax: b.rareControlMax.toFixed(4),
            animierteIds: b.animatedIds,
            animierterDreiecksanteil: b.animatedTriangleShare.toFixed(4),
            unaufgeloest: b.unresolved.length,
          })),
        },
        null,
        1,
      ),
    );

    for (const b of befunde) {
      // Die Zuordnung muss VOLL treffen.
      expect(b.fitHits).toBe(b.fitTotal);
      expect(b.unresolved).toEqual([]);
    }
    // Die Kontrolle hat nur auf WM0 Aussagekraft: bei 8 bzw. 4 IDs trifft
    // eine Verwürfelung regelmäßig ebenfalls alles (WM2 Median 0,8750, WM3
    // 1,0000). Das wird BERICHTET und nicht als Beleg verkauft — geprüft wird
    // die Trennschärfe dort, wo sie messbar ist.
    const wm0 = befunde[0]!;
    expect(wm0.controlMax).toBeLessThan(0.8);
    expect(wm0.controlMedian).toBeLessThan(0.7);
    expect(wm0.rareHits).toBe(wm0.rareTotal);
    expect(wm0.rareControlMax).toBeLessThan(1);
    expect(wm0.rareControlMedian).toBeLessThan(0.7);
  });

  it('K3 — Atlas-Accounting und Sichtnachweis', () => {
    const tabelle = parseWorldTextureNames(exe)!;
    const { images } = ladeTexturen(lgp, eintraege);
    const ta = eintraege.get('wm.ta')!;
    const anim = parseWorldAnimatedTextures(lgp.subarray(ta.start, ta.start + ta.size));
    const terrain = parseWorldMap(new Uint8Array(readFileSync(join(WM_DIR, 'WM0.MAP'))));

    // Genau der Aufruf, den die Demo verdrahtet — die Probe misst den
    // Produktivpfad, nicht eine Nachbildung davon.
    const set = buildWorldTextureSet({
      terrain,
      nameTable: tabelle,
      base: tabelle.bases.wm0,
      staticImages: images,
      animated: anim.textures,
    });
    const atlas = set.atlas;
    const flaeche = atlas.usedArea.reduce((s, x) => s + x, 0);
    console.log(
      'K3-ATLAS:',
      JSON.stringify(
        {
          ...set.report,
          misfits: set.report.misfits.length,
          seitenKante: atlas.size,
          polsterung: atlas.padding,
          untergebracht: atlas.placements.size,
          ueberlappendePaare: countAtlasOverlaps(atlas),
          nutzflaeche: flaeche,
          fuellgrad: (flaeche / (atlas.atlases.length * atlas.size * atlas.size)).toFixed(4),
        },
        null,
        1,
      ),
    );
    // Accounting: jede benutzte ID hat ein Bild, jedes Bild einen Platz,
    // kein Platz überlappt einen anderen — auch nicht in der Polsterung.
    expect(set.report.missingImages).toEqual([]);
    expect(set.report.unresolved).toEqual([]);
    expect(set.report.misfits).toEqual([]);
    expect(set.report.atlasRejected).toEqual([]);
    expect(atlas.placements.size).toBe(set.report.usedIds);
    expect(countAtlasOverlaps(atlas)).toBe(0);


    // --- Sichtnachweis --------------------------------------------------------
    mkdirSync(OUT_DIR, { recursive: true });
    const GANZ = { x0: 0, z0: 0, x1: 9 * BLOCK_EXTENT, z1: 7 * BLOCK_EXTENT };
    // Ausschnitt um Midgar/Kalm (Blockspalten 2–4, Zeilen 1–3) — dort liegen
    // Küste, Wiese, Gebirge und Stadt dicht beieinander, also viele Texturen.
    const NAH = { x0: 2 * BLOCK_EXTENT, z0: 1 * BLOCK_EXTENT, x1: 5 * BLOCK_EXTENT, z1: 4 * BLOCK_EXTENT };
    const bilderRaus: Array<[string, Uint8Array]> = [
      ['wm0-texturiert.png', rasterOben(terrain, set.table, atlas, 'textured', GANZ)],
      ['wm0-klassenfarben.png', rasterOben(terrain, set.table, atlas, 'classes', GANZ)],
      ['wm0-texturiert-nah.png', rasterOben(terrain, set.table, atlas, 'textured', NAH)],
      ['wm0-klassenfarben-nah.png', rasterOben(terrain, set.table, atlas, 'classes', NAH)],
    ];
    for (const [name, rgb] of bilderRaus) writeFileSync(join(OUT_DIR, name), encodePng(RASTER, RASTER, rgb));
    writeFileSync(join(OUT_DIR, 'wm0-atlas0.png'), encodePng(atlas.size, atlas.size, rgbaZuRgb(atlas.atlases[0]!)));
    const vielfalt = Object.fromEntries(bilderRaus.map(([n, rgb]) => [n, farbvielfalt(rgb)]));
    console.log('K3-STANDBILDER:', OUT_DIR, JSON.stringify(vielfalt));

    // Ein Standbild ist nur dann ein Nachweis, wenn es die Diagnoseansicht
    // sichtbar übertrifft: die Klassenfarben können höchstens 32 Töne zeigen
    // (5 Attributbits), eine echte Texturierung deutlich mehr.
    expect(vielfalt['wm0-klassenfarben.png']).toBeLessThanOrEqual(33);
    expect(vielfalt['wm0-texturiert.png']).toBeGreaterThan(200);
    expect(vielfalt['wm0-texturiert-nah.png']).toBeGreaterThan(200);
  });
});

// --- Software-Rasterung (nur Beweismittel, nicht Produktivpfad) ---------------

const RASTER = 768;
const BLOCK_EXTENT = 4 * 8192;

interface Ausschnitt {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function rgbaZuRgb(rgba: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return rgb;
}

function farbvielfalt(rgb: Uint8Array): number {
  const s = new Set<number>();
  for (let i = 0; i < rgb.length; i += 3) s.add((rgb[i]! << 16) | (rgb[i + 1]! << 8) | rgb[i + 2]!);
  return s.size;
}

/**
 * Draufsicht der ganzen Karte, dreiecksweise mit Baryzentrik gefüllt. Kein
 * Ersatz für den Three-Pfad — nur ein reproduzierbares Standbild, das ohne
 * Browser entsteht und genau dieselbe Tabelle/denselben Atlas benutzt.
 */
function rasterOben(
  terrain: WorldTerrain,
  table: ReadonlyArray<{ width: number; height: number; uOffset: number; vOffset: number } | undefined>,
  atlas: ReturnType<typeof buildWorldTextureAtlas>,
  modus: 'textured' | 'classes',
  sicht: Ausschnitt,
): Uint8Array {
  const rgb = new Uint8Array(RASTER * RASTER * 3);
  const BLOCK = BLOCK_EXTENT;
  const COLS = 9;
  const ROWS = 7;
  const sx = RASTER / (sicht.x1 - sicht.x0);
  const sz = RASTER / (sicht.z1 - sicht.z0);
  const klassenfarbe = (k: number): [number, number, number] => {
    const h = ((k * 0.618034) % 1) * 6;
    const i = Math.floor(h);
    const f = h - i;
    const q = Math.round(255 * (1 - f) * 0.7 + 40);
    const t = Math.round(255 * f * 0.7 + 40);
    const v = 218;
    const p = 40;
    return [
      [v, t, p],
      [q, v, p],
      [p, v, t],
      [p, q, v],
      [t, p, v],
      [v, p, q],
    ][i % 6] as [number, number, number];
  };

  for (let b = 0; b < terrain.blocks.length && b < COLS * ROWS; b++) {
    const block = terrain.blocks[b];
    if (!block) continue;
    const bx = (b % COLS) * BLOCK;
    const bz = Math.floor(b / COLS) * BLOCK;
    block.meshes.forEach((mesh, mi) => {
      if (!mesh) return;
      const ox = bx + (mi % 4) * 8192;
      const oz = bz + Math.floor(mi / 4) * 8192;
      for (const tri of mesh.triangles) {
        const idx = [tri.v0, tri.v1, tri.v2];
        const px = idx.map((v) => (ox + mesh.positions[v * 3]! - sicht.x0) * sx);
        const pz = idx.map((v) => (oz + mesh.positions[v * 3 + 2]! - sicht.z0) * sz);
        let farbe: [number, number, number] = [30, 30, 40];
        let zelle: { atlas: number; x: number; y: number; width: number; height: number } | undefined;
        let meta: { width: number; height: number; uOffset: number; vOffset: number } | undefined;
        if (modus === 'classes') {
          farbe = klassenfarbe(tri.walkClass);
        } else {
          meta = table[tri.textureId] ?? undefined;
          zelle = atlas.placements.get(tri.textureId);
        }
        const minX = Math.max(0, Math.floor(Math.min(...px)));
        const maxX = Math.min(RASTER - 1, Math.ceil(Math.max(...px)));
        const minY = Math.max(0, Math.floor(Math.min(...pz)));
        const maxY = Math.min(RASTER - 1, Math.ceil(Math.max(...pz)));
        const d = (px[1]! - px[0]!) * (pz[2]! - pz[0]!) - (px[2]! - px[0]!) * (pz[1]! - pz[0]!);
        if (d === 0) continue;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const w1 = ((x + 0.5 - px[0]!) * (pz[2]! - pz[0]!) - (px[2]! - px[0]!) * (y + 0.5 - pz[0]!)) / d;
            const w2 = ((px[1]! - px[0]!) * (y + 0.5 - pz[0]!) - (x + 0.5 - px[0]!) * (pz[1]! - pz[0]!)) / d;
            if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
            let c = farbe;
            if (modus === 'textured' && meta && zelle) {
              const w0 = 1 - w1 - w2;
              const uPix = lokal(tri.uv[0]!, meta.uOffset, meta.width) * w0 +
                lokal(tri.uv[2]!, meta.uOffset, meta.width) * w1 +
                lokal(tri.uv[4]!, meta.uOffset, meta.width) * w2;
              const vPix = lokal(tri.uv[1]!, meta.vOffset, meta.height) * w0 +
                lokal(tri.uv[3]!, meta.vOffset, meta.height) * w1 +
                lokal(tri.uv[5]!, meta.vOffset, meta.height) * w2;
              const ax = zelle.x + (((Math.floor(uPix) % zelle.width) + zelle.width) % zelle.width);
              const ay = zelle.y + (((Math.floor(vPix) % zelle.height) + zelle.height) % zelle.height);
              const seite = atlas.atlases[zelle.atlas]!;
              const p = (ay * atlas.size + ax) * 4;
              if (seite[p + 3]! < 128) continue; // alphaTest 0.5
              c = [seite[p]!, seite[p + 1]!, seite[p + 2]!];
            }
            const o = (y * RASTER + x) * 3;
            rgb[o] = c[0];
            rgb[o + 1] = c[1];
            rgb[o + 2] = c[2];
          }
        }
      }
    });
  }
  return rgb;
}

function lokal(value: number, offset: number, dimension: number): number {
  if (dimension <= 0) return 0;
  if (value + offset === dimension) return value > 0 ? value - 1 : 0;
  let o = offset;
  if (o > value) o = o % dimension;
  return Math.abs((value - o) % dimension);
}
