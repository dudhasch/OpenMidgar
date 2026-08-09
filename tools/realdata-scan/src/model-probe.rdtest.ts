import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { NodeDirectorySource } from './node-source.js';

/**
 * S7-Vorprobe: Byte-Level-Strukturanalyse der char.lgp-Artefakte, BEVOR die
 * Parser geschrieben werden (Formatfakten statt Annahmen — Lehre aus dem
 * 38-Byte-Kamerarecord). Ausgabe ausschließlich aggregiert.
 *
 * Fragen:
 *  P1  Welche Endungen enthält char.lgp überhaupt (Histogramm)?
 *  P2  .a: Headerfelder + Framegröße — 12+12n (RootTrans+Bones) oder
 *      24+12n (RootRot+RootTrans+Bones)?
 *  P3  .p: stimmt das dokumentierte 128-Byte-Header-/Poolmodell
 *      (Size-Accounting über alle Dateien)?
 *  P4  .tex: Header 236 Bytes + Palette (4·paletteSize) + Pixel (b·w·h)?
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

describe.skipIf(!available)('Realdaten: char.lgp-Strukturproben', () => {
  it('P1–P4: Layout-Kandidaten prüfen', { timeout: 600_000 }, async () => {
    const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
    const index = new IndexService();
    await index.openSource(dir, { deep: false });

    const extHist: Record<string, number> = {};
    const aStats = {
      files: 0,
      version: {} as Record<number, number>,
      frameCandidates: { rootTrans12: 0, rootTransRot24: 0, other: 0 },
      otherSamples: [] as string[],
      boneCounts: { min: Infinity, max: 0 },
    };
    const pStats = {
      files: 0,
      version: {} as Record<number, number>,
      accounting: {} as Record<string, number>,
      leftoverSamples: [] as string[],
    };
    const texStats = { files: 0, exact: 0, mismatch: [] as string[] };

    for (const entry of index.listEntries('char')) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : '(ohne)';
      extHist[ext] = (extHist[ext] ?? 0) + 1;
    }
    console.log('P1 Endungen:', JSON.stringify(extHist));

    for (const entry of index.listEntries('char')) {
      const name = entry.name.toLowerCase();
      if (name.endsWith('.a')) {
        const bytes = await index.readEntry(entry.canonicalId);
        if (bytes.length < 36) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        aStats.files++;
        const version = view.getUint32(0, true);
        const nFrames = view.getUint32(4, true);
        const nBones = view.getUint32(8, true);
        aStats.version[version] = (aStats.version[version] ?? 0) + 1;
        aStats.boneCounts.min = Math.min(aStats.boneCounts.min, nBones);
        aStats.boneCounts.max = Math.max(aStats.boneCounts.max, nBones);
        const payload = bytes.length - 36;
        if (nFrames > 0 && payload % nFrames === 0) {
          const frameSize = payload / nFrames;
          if (frameSize === 12 + 12 * nBones) aStats.frameCandidates.rootTrans12++;
          else if (frameSize === 24 + 12 * nBones) aStats.frameCandidates.rootTransRot24++;
          else {
            aStats.frameCandidates.other++;
            if (aStats.otherSamples.length < 8) {
              aStats.otherSamples.push(`frameSize=${frameSize} nBones=${nBones} nFrames=${nFrames} len=${bytes.length}`);
            }
          }
        } else {
          aStats.frameCandidates.other++;
          if (aStats.otherSamples.length < 8) {
            aStats.otherSamples.push(`payload=${payload} nFrames=${nFrames} len=${bytes.length}`);
          }
        }
      } else if (name.endsWith('.p')) {
        const bytes = await index.readEntry(entry.canonicalId);
        if (bytes.length < 128) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        pStats.files++;
        pStats.version[view.getUint32(0, true)] = (pStats.version[view.getUint32(0, true)] ?? 0) + 1;
        const numVertices = view.getUint32(0x0c, true);
        const numNormals = view.getUint32(0x10, true);
        const numUnknown1 = view.getUint32(0x14, true);
        const numTexCs = view.getUint32(0x18, true);
        const numVertexColors = view.getUint32(0x1c, true);
        const numEdges = view.getUint32(0x20, true);
        const numPolys = view.getUint32(0x24, true);
        const numHundreds = view.getUint32(0x30, true);
        const numGroups = view.getUint32(0x34, true);
        const numBBoxes = view.getUint32(0x38, true);
        const known =
          128 +
          numVertices * 12 +
          numNormals * 12 +
          numUnknown1 * 12 +
          numTexCs * 8 +
          numVertexColors * 4 +
          numPolys * 4 +
          numEdges * 4 +
          numPolys * 24 +
          numHundreds * 100 +
          numGroups * 56;
        // Hypothese aus Runde 1: Rest = Normalindex-Tabelle (4·numVertices)
        // + ggf. BBox-Records fester Größe.
        const leftover = bytes.length - known - numVertices * 4;
        let key: string;
        if (leftover === 0) key = 'exakt (Rest = 4·numVertices)';
        else if (numBBoxes > 0 && leftover % numBBoxes === 0) key = `bboxRecord=${leftover / numBBoxes}B`;
        else key = `rest=${leftover}`;
        pStats.accounting[key] = (pStats.accounting[key] ?? 0) + 1;
        if (leftover !== 0 && pStats.leftoverSamples.length < 8) {
          pStats.leftoverSamples.push(
            `${leftover}B übrig (v=${numVertices} n=${numNormals} u1=${numUnknown1} t=${numTexCs} vc=${numVertexColors} e=${numEdges} p=${numPolys} h=${numHundreds} g=${numGroups} bb=${numBBoxes} len=${bytes.length})`,
          );
        }
      } else if (name.endsWith('.tex')) {
        const bytes = await index.readEntry(entry.canonicalId);
        if (bytes.length < 236) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        texStats.files++;
        const paletteSize = view.getUint32(0x58, true);
        const width = view.getUint32(0x3c, true);
        const height = view.getUint32(0x40, true);
        const bytesPerPixel = view.getUint32(0x68, true);
        const expected = 236 + paletteSize * 4 + width * height * bytesPerPixel;
        if (expected === bytes.length) texStats.exact++;
        else if (texStats.mismatch.length < 8) {
          texStats.mismatch.push(`erw=${expected} ist=${bytes.length} pal=${paletteSize} ${width}x${height}x${bytesPerPixel}`);
        }
      }
    }

    console.log('P2 .a:', JSON.stringify(aStats, null, 2));
    console.log('P3 .p:', JSON.stringify({ files: pStats.files, version: pStats.version, accounting: pStats.accounting }, null, 2));
    console.log('P3 .p Rest-Beispiele:', JSON.stringify(pStats.leftoverSamples, null, 2));
    console.log('P4 .tex:', JSON.stringify(texStats, null, 2));

    expect(aStats.files + pStats.files + texStats.files).toBeGreaterThan(100);
    await dir.closeAll();
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
