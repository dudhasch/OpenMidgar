import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import {
  effectiveTileSource,
  parseFieldEntry,
  type BackgroundTile,
  type BackgroundTexturePage,
} from '@webmidgar/formats-field';
import { baseLayerIndex, layerTileSize, layerTransparency, resolveTileRgba } from '@webmidgar/render-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * F16-Probe: Verwürfelte Kachelblöcke in Feld-Hintergründen (md1_1, nmkin_1,
 * md8_1) — md1stin ist das saubere Kontrollfield.
 *
 * Verfahren (Methodik-Standard: messen, nicht raten): Jede Kachel wird unter
 * mehreren Quell-Hypothesen dekodiert und ihr INNENRAUSCHEN gemessen
 * (mittlerer |ΔRGB| benachbarter opaker Pixel innerhalb der Kachel).
 * Verwürfelte Kacheln — "richtige Struktur, falsche Quellregion" — haben
 * extremes Innenrauschen. Die Rauschkacheln werden anschließend nach ihren
 * Record-Feldern geclustert: Welches Feld trennt Rausch von Sauber?
 *
 * Hypothesen je Kachel:
 *  - cur      : effectiveSrc (src2 vor src) + Texturseite u8@34  (Ist-Stand)
 *  - srcOnly  : src (u8@12/@14)             + Texturseite u8@34
 *  - tex32eff : effectiveSrc                + Texturseite u8@32
 *  - tex32src : src                         + Texturseite u8@32
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const FIELDS = ['md1_1', 'nmkin_1', 'md8_1', 'md1stin'];
const NOISY = 90; // |ΔRGB|-Schwelle; Verteilung wird zusätzlich ausgegeben.

function tileNoise(rgba: Uint8Array, size: number): { noise: number; opaque: number } {
  let sum = 0;
  let n = 0;
  let opaque = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = (y * size + x) * 4;
      if (rgba[a + 3] === 0) continue;
      opaque++;
      if (x + 1 < size && rgba[a + 7] !== 0) {
        sum +=
          Math.abs(rgba[a]! - rgba[a + 4]!) +
          Math.abs(rgba[a + 1]! - rgba[a + 5]!) +
          Math.abs(rgba[a + 2]! - rgba[a + 6]!);
        n++;
      }
      const b = a + size * 4;
      if (y + 1 < size && rgba[b + 3] !== 0) {
        sum += Math.abs(rgba[a]! - rgba[b]!) + Math.abs(rgba[a + 1]! - rgba[b + 1]!) + Math.abs(rgba[a + 2]! - rgba[b + 2]!);
        n++;
      }
    }
  }
  return { noise: n === 0 ? 0 : sum / n, opaque };
}

function quantiles(values: number[]): string {
  if (values.length === 0) return '—';
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return `n=${s.length} p50=${q(0.5).toFixed(0)} p90=${q(0.9).toFixed(0)} p99=${q(0.99).toFixed(0)} max=${s[s.length - 1]!.toFixed(0)}`;
}

function bump(m: Record<string, number>, key: string): void {
  m[key] = (m[key] ?? 0) + 1;
}

describe.skipIf(!available)('Realdaten: F16 Kachel-Rauschprobe', () => {
  it('Rauschcluster + Trennvariable', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    for (const entry of index.listEntries('flevel')) {
      if (!FIELDS.includes(entry.name)) continue;
      const parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
      const bg = parsed.bundle?.background;
      const pal = parsed.bundle?.palette;
      if (!bg) continue;
      const pages = new Map<number, BackgroundTexturePage>(bg.texturePages.map((p) => [p.slot, p]));
      const palPages = pal?.pages ?? [];
      const base = baseLayerIndex(bg);

      const HYPS = ['cur', 'srcOnly', 'tex32src', 'tex36eff', 'blend36', 'blend32'];
      const noiseByHyp: Record<string, number[]> = Object.fromEntries(HYPS.map((h) => [h, []]));
      const noisyCluster: Record<string, number> = {};
      const cleanCluster: Record<string, number> = {};
      let noisyCount = 0;
      let cleanCount = 0;
      // Für Rauschkacheln (cur): Rauschen unter den anderen Hypothesen.
      const noisyAlt: Record<string, { sum: number; n: number; stillNoisy: number }> = Object.fromEntries(
        HYPS.map((h) => [h, { sum: 0, n: 0, stillNoisy: 0 }]),
      );
      // Blending-Tiles gesondert: Mittel + Rauschanteil je Hypothese.
      const blendStat: Record<string, { sum: number; n: number; noisy: number; miss: number }> = Object.fromEntries(
        HYPS.map((h) => [h, { sum: 0, n: 0, noisy: 0, miss: 0 }]),
      );
      const pageInfo = bg.texturePages.map((p) => `slot${p.slot}:d${p.depth}`).join(' ');

      for (const layer of bg.layers) {
        const size = layerTileSize(layer);
        const transparency = layerTransparency(layer.index, base);
        for (const tile of layer.tiles) {
          const eff = effectiveTileSource(tile);
          const raw = tile.raw;
          const blended = raw[30]! !== 0;
          const hyp: Record<string, { src: { x: number; y: number }; tex: number }> = {
            cur: { src: eff, tex: tile.textureId },
            srcOnly: { src: { x: tile.srcX, y: tile.srcY }, tex: tile.textureId },
            tex32src: { src: { x: tile.srcX, y: tile.srcY }, tex: raw[32]! },
            tex36eff: { src: eff, tex: raw[36]! },
            // Kombiregel: Blending-Tiles von der Ablageseite u8@36 lesen
            // (dort liegt src2), alle anderen wie bisher von u8@34.
            blend36: blended ? { src: eff, tex: raw[36]! } : { src: eff, tex: tile.textureId },
            // Kombiregel: Blending-Tiles von der Quellseite u8@32 mit src lesen.
            blend32: blended
              ? { src: { x: tile.srcX, y: tile.srcY }, tex: raw[32]! }
              : { src: eff, tex: tile.textureId },
          };
          const noise: Record<string, number | null> = {};
          for (const [name, h] of Object.entries(hyp)) {
            const t: BackgroundTile = { ...tile, srcX: h.src.x, srcY: h.src.y, srcX2: 0, srcY2: 0 };
            const rgba = resolveTileRgba(t, pages.get(h.tex), palPages, size, transparency);
            if (!rgba) {
              noise[name] = null;
              continue;
            }
            const m = tileNoise(rgba, size);
            noise[name] = m.opaque < 16 ? null : m.noise;
            if (noise[name] !== null) noiseByHyp[name]!.push(noise[name]!);
          }
          if (blended) {
            for (const name of HYPS) {
              const v = noise[name];
              if (v === null || v === undefined) {
                blendStat[name]!.miss++;
                continue;
              }
              blendStat[name]!.sum += v;
              blendStat[name]!.n++;
              if (v >= NOISY) blendStat[name]!.noisy++;
            }
          }

          const cur = noise['cur'];
          if (cur === null) continue;
          const src2set = tile.srcX2 !== 0 || tile.srcY2 !== 0;
          const uvSrcX = Math.round((tile.uvX / 1e7) * 256);
          const uvSrcY = Math.round((tile.uvY / 1e7) * 256);
          const uvAgree = uvSrcX === eff.x && uvSrcY === eff.y;
          const keyParts = [
            `L${layer.index}`,
            `src2=${src2set ? 1 : 0}`,
            `t32=${raw[32]}`,
            `t34=${raw[34]}`,
            `d36=${raw[36]}`,
            `bpp38=${raw[38]}`,
            `pgDepth=${pages.get(tile.textureId)?.depth ?? '—'}`,
            `pal=${tile.paletteId}${tile.paletteId < palPages.length ? '' : '!OOB'}`,
            `f25=${tile.flags}`,
            `b30=${raw[30]}`,
            `tt31=${raw[31]}`,
            `uv=${uvAgree ? 'ok' : 'MISS'}`,
          ].join(' ');
          if (cur! >= NOISY) {
            noisyCount++;
            bump(noisyCluster, keyParts);
            for (const [name, v] of Object.entries(noise)) {
              if (v === null) continue;
              noisyAlt[name]!.sum += v;
              noisyAlt[name]!.n++;
              if (v >= NOISY) noisyAlt[name]!.stillNoisy++;
            }
          } else {
            cleanCount++;
            bump(cleanCluster, keyParts);
          }
        }
      }

      const top = (m: Record<string, number>, k: number): [string, number][] =>
        Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k);
      console.log(`\n===== ${entry.name} ===== Seiten: ${pageInfo}`);
      for (const [name, vals] of Object.entries(noiseByHyp)) {
        console.log(`  Rauschen ${name.padEnd(8)} ${quantiles(vals)}`);
      }
      console.log(`  Rauschkacheln (cur ≥ ${NOISY}): ${noisyCount} | sauber: ${cleanCount}`);
      console.log('  Top-Cluster RAUSCH:');
      for (const [k, n] of top(noisyCluster, 12)) console.log(`    ${n}× ${k}`);
      console.log('  Top-Cluster SAUBER (Kontrolle):');
      for (const [k, n] of top(cleanCluster, 6)) console.log(`    ${n}× ${k}`);
      console.log(
        '  Blending-Tiles (u8@30 ≠ 0) je Hypothese: ' +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(blendStat).map(([k, v]) => [
                k,
                { mittel: v.n ? +(v.sum / v.n).toFixed(1) : null, rausch: v.noisy, fehlt: v.miss, n: v.n },
              ]),
            ),
          ),
      );
      console.log(
        '  Rauschkacheln unter Alternativhypothesen: ' +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(noisyAlt).map(([k, v]) => [
                k,
                { mittel: v.n ? +(v.sum / v.n).toFixed(1) : null, nochRausch: v.stillNoisy, n: v.n },
              ]),
            ),
          ),
      );
    }

    expect(true).toBe(true);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
