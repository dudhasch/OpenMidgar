import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexService } from '@webmidgar/io';
import { parseFieldEntry } from '@webmidgar/formats-field';
import { NodeDirectorySource } from './node-source.js';

/**
 * S10-Realdaten-Messprobe — Feldsemantik von Field-Sektion 3 (Model-Loader).
 *
 * Klärt (rein messend, keine Bewertung) drei offene Stellen der bereits
 * belegten Grammatik:
 *   M1 — der 30-Byte-Block je Modell (Lichthypothese vs. Gegenhypothesen)
 *   M2 — das 12-Byte-Dateifeld (ASCII-Teil, Endung, angehängte Ziffern)
 *   M3 — die beiden Konstantenverdächtigen (unknownAfterName, animTail)
 *        sowie Anim-/Modellnamenlängen und Count-Histogramme.
 *
 * Ausgabe ausschließlich aggregiert. Keine Feldnamen, keine Originalnamen,
 * keine Rohbytes einzelner Einträge — nur Längen, Zahlen, Zeichenklassen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);
const SECTION_MODEL_LOADER = 3;

// ---------------------------------------------------------------------------
// kleine Statistik-Helfer
// ---------------------------------------------------------------------------

interface NumSummary {
  n: number;
  min: number;
  max: number;
  mean: number;
  p5: number;
  p50: number;
  p95: number;
}

function summarize(values: number[]): NumSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[idx]!;
  };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p5: pick(0.05),
    p50: pick(0.5),
    p95: pick(0.95),
  };
}

function bump(hist: Record<string, number>, key: string | number): void {
  const k = String(key);
  hist[k] = (hist[k] ?? 0) + 1;
}

function mergeHist(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

function topN(hist: Record<string, number>, n: number): Array<{ value: string; count: number }> {
  return Object.entries(hist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

// Zeichenklassen-Muster: Buchstabe -> L, Ziffer -> D, Sonderzeichen literal.
function classPattern(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z]/.test(ch)) out += 'L';
    else if (/[0-9]/.test(ch)) out += 'D';
    else out += ch;
  }
  return out;
}

// Byte-Positionsstatistik (min/max/distinct/Nullanteil) je fester Position
// innerhalb des 30-Byte-Blocks, inkrementell akkumuliert und über Fields
// mergebar (analog zu den Histogrammen).
interface BytePosAcc {
  min: number;
  max: number;
  zeroCount: number;
  total: number;
  distinct: Set<number>;
}

function newBytePosAccs(n: number): BytePosAcc[] {
  return Array.from({ length: n }, () => ({ min: 256, max: -1, zeroCount: 0, total: 0, distinct: new Set<number>() }));
}

function updateBytePosAccs(accs: BytePosAcc[], block: Uint8Array): void {
  for (let i = 0; i < accs.length; i++) {
    const v = block[i]!;
    const a = accs[i]!;
    a.min = Math.min(a.min, v);
    a.max = Math.max(a.max, v);
    if (v === 0) a.zeroCount++;
    a.total++;
    a.distinct.add(v);
  }
}

function mergeBytePosAccs(into: BytePosAcc[], from: BytePosAcc[]): void {
  for (let i = 0; i < into.length; i++) {
    const t = into[i]!;
    const f = from[i]!;
    t.min = Math.min(t.min, f.min);
    t.max = Math.max(t.max, f.max);
    t.zeroCount += f.zeroCount;
    t.total += f.total;
    for (const v of f.distinct) t.distinct.add(v);
  }
}

// ---------------------------------------------------------------------------
// Reader für Sektion 3 nach der belegten Grammatik
// ---------------------------------------------------------------------------

class Cursor {
  #o = 0;
  constructor(private readonly view: DataView, private readonly data: Uint8Array) {}
  remaining(): number {
    return this.data.length - this.#o;
  }
  u16(): number {
    const v = this.view.getUint16(this.#o, true);
    this.#o += 2;
    return v;
  }
  bytes(n: number): Uint8Array {
    const v = this.data.subarray(this.#o, this.#o + n);
    this.#o += n;
    return v;
  }
  chars(n: number): string {
    const b = this.bytes(n);
    return Array.from(b, (x) => String.fromCharCode(x)).join('');
  }
}

interface LightSample {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  len: number;
}

interface WalkResult {
  modelCountHist: Record<string, number>;
  animCountHist: Record<string, number>;
  scaleGlobalHist: Record<string, number>;
  unknownAfterNameHist: Record<string, number>;
  animTailHist: Record<string, number>;
  animNameLenHist: Record<string, number>;
  animExtHist: Record<string, number>;
  modelNameLenHist: Record<string, number>;
  // M1
  bytePosAccs: BytePosAcc[];
  lightDirs: LightSample[];
  ambientBytes: Array<[number, number, number]>;
  // M2
  asciiLenHist: Record<string, number>;
  oneDotFrac: { withDot: number; total: number };
  extHist: Record<string, number>;
  digitsAfterExtFrac: { withDigits: number; total: number };
  trailingDigitValueHist: Record<string, number>;
  trailingDigitMatchesScale: { matches: number; checked: number };
}

function newWalkResult(): WalkResult {
  return {
    modelCountHist: {},
    animCountHist: {},
    scaleGlobalHist: {},
    unknownAfterNameHist: {},
    animTailHist: {},
    animNameLenHist: {},
    animExtHist: {},
    modelNameLenHist: {},
    bytePosAccs: newBytePosAccs(30),
    lightDirs: [],
    ambientBytes: [],
    asciiLenHist: {},
    oneDotFrac: { withDot: 0, total: 0 },
    extHist: {},
    digitsAfterExtFrac: { withDigits: 0, total: 0 },
    trailingDigitValueHist: {},
    trailingDigitMatchesScale: { matches: 0, checked: 0 },
  };
}

/** Wirft bei jeder Grammatikverletzung — der Aufrufer zählt das als "broken". */
function walkSection3(data: Uint8Array): WalkResult {
  if (data.length < 6) throw new Error('zu kurz für Kopf');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cur = new Cursor(view, data);

  const blank = cur.u16();
  const modelCount = cur.u16();
  const scaleGlobal = cur.u16();
  if (blank !== 0) throw new Error(`blank != 0 (${blank})`);
  // Obergrenze ist nur ein Sanity-Deckel gegen Fehlausrichtung, keine belegte
  // Grammatikgrenze (Spezifikation nennt 1…12 als *beobachtete* Spanne, nicht
  // als Maximum — reale Daten enthalten auch größere Werte). Die eigentliche
  // Korrektheitsprüfung ist die vollständige, bündige Byte-Konsumierung am
  // Ende des Walks.
  if (modelCount < 1 || modelCount > 64) throw new Error(`modelCount unplausibel (${modelCount})`);

  const rec = newWalkResult();
  bump(rec.modelCountHist, modelCount);
  bump(rec.scaleGlobalHist, scaleGlobal);

  for (let m = 0; m < modelCount; m++) {
    if (cur.remaining() < 2) throw new Error(`Modell ${m}: kein Platz für nameLen`);
    const nameLen = cur.u16();
    if (nameLen < 1 || nameLen > 200 || cur.remaining() < nameLen) {
      throw new Error(`Modell ${m}: nameLen unplausibel (${nameLen})`);
    }
    cur.chars(nameLen); // Name selbst wird nicht ausgewertet/ausgegeben
    bump(rec.modelNameLenHist, nameLen);

    if (cur.remaining() < 2) throw new Error(`Modell ${m}: kein Platz für unknownAfterName`);
    const unknownAfterName = cur.u16();
    bump(rec.unknownAfterNameHist, unknownAfterName);

    if (cur.remaining() < 12) throw new Error(`Modell ${m}: kein Platz für Dateifeld`);
    const fileField = cur.bytes(12);
    analyzeFileField(fileField, scaleGlobal, rec);

    if (cur.remaining() < 2) throw new Error(`Modell ${m}: kein Platz für animCount`);
    const animCount = cur.u16();
    if (animCount > 500) throw new Error(`Modell ${m}: animCount unplausibel (${animCount})`);
    bump(rec.animCountHist, animCount);

    if (cur.remaining() < 30) throw new Error(`Modell ${m}: kein Platz für 30-Byte-Block`);
    const block = cur.bytes(30);
    analyzeBlock30(block, rec);

    for (let a = 0; a < animCount; a++) {
      if (cur.remaining() < 2) throw new Error(`Modell ${m} Anim ${a}: kein Platz für animNameLen`);
      const animNameLen = cur.u16();
      if (animNameLen < 1 || animNameLen > 200 || cur.remaining() < animNameLen) {
        throw new Error(`Modell ${m} Anim ${a}: animNameLen unplausibel (${animNameLen})`);
      }
      const animName = cur.chars(animNameLen);
      bump(rec.animNameLenHist, animNameLen);
      const dot = animName.lastIndexOf('.');
      const ext = dot >= 0 ? animName.slice(dot + 1) : '';
      bump(rec.animExtHist, classPattern(ext));

      if (cur.remaining() < 2) throw new Error(`Modell ${m} Anim ${a}: kein Platz für animTail`);
      const animTail = cur.u16();
      bump(rec.animTailHist, animTail);
    }
  }

  if (cur.remaining() !== 0) {
    throw new Error(`${cur.remaining()} Bytes übrig nach vollständigem Walk`);
  }
  return rec;
}

function analyzeFileField(field: Uint8Array, scaleGlobal: number, rec: WalkResult): void {
  let zeroAt = field.length;
  for (let i = 0; i < field.length; i++) {
    if (field[i] === 0) {
      zeroAt = i;
      break;
    }
  }
  const ascii = Array.from(field.subarray(0, zeroAt), (b) => String.fromCharCode(b)).join('');
  bump(rec.asciiLenHist, ascii.length);

  rec.oneDotFrac.total++;
  const dotCount = ascii.split('.').length - 1;
  if (dotCount === 1) rec.oneDotFrac.withDot++;

  const dotIdx = ascii.indexOf('.');
  if (dotIdx >= 0) {
    // Endung = alphabetischer Lauf direkt nach dem ersten Punkt.
    const afterDot = ascii.slice(dotIdx + 1);
    const extMatch = /^[A-Za-z]+/.exec(afterDot);
    const ext = extMatch ? extMatch[0] : '';
    bump(rec.extHist, ext);
    const rest = afterDot.slice(ext.length);
    rec.digitsAfterExtFrac.total++;
    const digitsMatch = /^[0-9]+/.exec(rest);
    if (digitsMatch) {
      rec.digitsAfterExtFrac.withDigits++;
      const val = Number.parseInt(digitsMatch[0], 10);
      bump(rec.trailingDigitValueHist, val);
      rec.trailingDigitMatchesScale.checked++;
      if (val === scaleGlobal) rec.trailingDigitMatchesScale.matches++;
    }
  }
}

function analyzeBlock30(block: Uint8Array, rec: WalkResult): void {
  updateBytePosAccs(rec.bytePosAccs, block);

  // Lichthypothese: 3 Lichtquellen à (i16 x, i16 y, i16 z, u8 r, u8 g, u8 b) = 9 B je Licht, 27 B total.
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  for (let light = 0; light < 3; light++) {
    const base = light * 9;
    const x = view.getInt16(base + 0, true);
    const y = view.getInt16(base + 2, true);
    const z = view.getInt16(base + 4, true);
    const r = view.getUint8(base + 6);
    const g = view.getUint8(base + 7);
    const b = view.getUint8(base + 8);
    const len = Math.sqrt(x * x + y * y + z * z);
    rec.lightDirs.push({ x, y, z, r, g, b, len });
  }
  rec.ambientBytes.push([block[27]!, block[28]!, block[29]!]);
}

describe.skipIf(!available)('Realdaten: Feldsemantik Sektion 3 Model-Loader', () => {
  it(
    'M1 30-Byte-Block, M2 12-Byte-Dateifeld, M3 Konstantenverdächtige',
    { timeout: 900_000 },
    async () => {
      const dir = new NodeDirectorySource(REAL_DIR, ['data/field']);
      const index = new IndexService();
      await index.openSource(dir, { deep: false });

      let fields = 0;
      let broken = 0;
      const brokenSamples: string[] = [];

      const total = newWalkResult();

      for (const entry of index.listEntries('flevel')) {
        if (entry.name.includes('.')) continue;
        let parsed;
        try {
          parsed = parseFieldEntry(await index.readEntry(entry.canonicalId), entry.name);
        } catch {
          continue;
        }
        if (!parsed.ok || !parsed.bundle) continue;
        const data = parsed.bundle.rawSections[SECTION_MODEL_LOADER];
        if (!data) continue;

        fields++;
        try {
          const rec = walkSection3(data);
          mergeHist(total.modelCountHist, rec.modelCountHist);
          mergeHist(total.animCountHist, rec.animCountHist);
          mergeHist(total.scaleGlobalHist, rec.scaleGlobalHist);
          mergeHist(total.unknownAfterNameHist, rec.unknownAfterNameHist);
          mergeHist(total.animTailHist, rec.animTailHist);
          mergeHist(total.animNameLenHist, rec.animNameLenHist);
          mergeHist(total.animExtHist, rec.animExtHist);
          mergeHist(total.modelNameLenHist, rec.modelNameLenHist);
          mergeBytePosAccs(total.bytePosAccs, rec.bytePosAccs);
          total.lightDirs.push(...rec.lightDirs);
          total.ambientBytes.push(...rec.ambientBytes);
          mergeHist(total.asciiLenHist, rec.asciiLenHist);
          total.oneDotFrac.withDot += rec.oneDotFrac.withDot;
          total.oneDotFrac.total += rec.oneDotFrac.total;
          mergeHist(total.extHist, rec.extHist);
          total.digitsAfterExtFrac.withDigits += rec.digitsAfterExtFrac.withDigits;
          total.digitsAfterExtFrac.total += rec.digitsAfterExtFrac.total;
          mergeHist(total.trailingDigitValueHist, rec.trailingDigitValueHist);
          total.trailingDigitMatchesScale.matches += rec.trailingDigitMatchesScale.matches;
          total.trailingDigitMatchesScale.checked += rec.trailingDigitMatchesScale.checked;
        } catch (err) {
          broken++;
          if (brokenSamples.length < 8) brokenSamples.push((err as Error).message);
        }
      }

      // M1: Lichthypothese auswerten.
      const dirX = summarize(total.lightDirs.map((l) => l.x));
      const dirY = summarize(total.lightDirs.map((l) => l.y));
      const dirZ = summarize(total.lightDirs.map((l) => l.z));
      const lens = summarize(total.lightDirs.map((l) => l.len));
      const colR = summarize(total.lightDirs.map((l) => l.r));
      const colG = summarize(total.lightDirs.map((l) => l.g));
      const colB = summarize(total.lightDirs.map((l) => l.b));
      const ambientR = summarize(total.ambientBytes.map((a) => a[0]));
      const ambientG = summarize(total.ambientBytes.map((a) => a[1]));
      const ambientB = summarize(total.ambientBytes.map((a) => a[2]));

      // Gegenhypothese letzte 3 Bytes: Farbe (breit gestreut) vs. Zähler (klein, wenige Werte).
      const lastThreeHist: Record<string, number>[] = [{}, {}, {}];
      for (const a of total.ambientBytes) {
        bump(lastThreeHist[0]!, a[0]);
        bump(lastThreeHist[1]!, a[1]);
        bump(lastThreeHist[2]!, a[2]);
      }

      const output = {
        accounting: { fields, broken, brokenSamples },
        M3_counts: {
          modelCountHist: total.modelCountHist,
          animCountHistTop: topN(total.animCountHist, 20),
          scaleGlobalHistTop: topN(total.scaleGlobalHist, 10),
          unknownAfterNameHist: total.unknownAfterNameHist,
          animTailHist: total.animTailHist,
          modelNameLenHist: total.modelNameLenHist,
          animNameLenHist: total.animNameLenHist,
          animExtHistTop: topN(total.animExtHist, 10),
        },
        M2_fileField: {
          asciiLenHist: total.asciiLenHist,
          oneDotFraction: total.oneDotFrac.total > 0 ? total.oneDotFrac.withDot / total.oneDotFrac.total : null,
          oneDotCounts: total.oneDotFrac,
          extHistTop: topN(total.extHist, 15),
          digitsAfterExtFraction:
            total.digitsAfterExtFrac.total > 0
              ? total.digitsAfterExtFrac.withDigits / total.digitsAfterExtFrac.total
              : null,
          digitsAfterExtCounts: total.digitsAfterExtFrac,
          trailingDigitValueTop12: topN(total.trailingDigitValueHist, 12),
          trailingDigitMatchesScaleGlobal: {
            ...total.trailingDigitMatchesScale,
            fraction:
              total.trailingDigitMatchesScale.checked > 0
                ? total.trailingDigitMatchesScale.matches / total.trailingDigitMatchesScale.checked
                : null,
          },
        },
        M1_block30: {
          perBytePosition: total.bytePosAccs.map((a, i) => ({
            pos: i,
            min: a.total > 0 ? a.min : 0,
            max: a.total > 0 ? a.max : 0,
            distinct: a.distinct.size,
            zeroFrac: a.total > 0 ? a.zeroCount / a.total : 0,
          })),
          lightHypothesis: {
            note: '3 Lichter à (i16 x,y,z, u8 r,g,b) auf Byte 0..26, letzte 3 Bytes (27..29) als Umgebungslicht',
            perLightDirection: { x: dirX, y: dirY, z: dirZ },
            perLightVectorLength: lens,
            perLightColor: { r: colR, g: colG, b: colB },
            ambientColor: { r: ambientR, g: ambientG, b: ambientB },
            sampleCount: total.lightDirs.length,
          },
          counterHypothesisLastThreeBytes: {
            note: 'letzte 3 Bytes des 30B-Blocks (Positionen 27,28,29), je Position separat histogrammiert',
            histograms: lastThreeHist.map((h) => topN(h, 15)),
          },
        },
      };

      console.log('Feldsemantik Sektion 3 (Model-Loader):', JSON.stringify(output, null, 2));

      expect(fields).toBeGreaterThan(700);
      expect(broken).toBe(0);
      await dir.closeAll();
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
