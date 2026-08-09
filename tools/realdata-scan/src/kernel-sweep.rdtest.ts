import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAsciiTable,
  decodeStringTable,
  germanLikeness,
  parseKernelContainer,
  type FfTextTable,
  type KernelContainer,
} from '@webmidgar/formats-kernel';

/**
 * S13-Realdaten-Abnahme „Kernel-Abnahme": Parser gegen die echte `kernel.bin`
 * (deutsch + englisch) und Ableitung des Zeichentabellen-Versatzes aus den
 * Daten selbst — der Versatz wird nicht angenommen, sondern über
 * `germanLikeness` gegen den kompletten Textsektionsbestand erhärtet.
 *
 * Original- vs. Overlay-Trennung: Nur Dateien außerhalb von `mods/` (7th
 * Heaven) fließen ein — Mod-Kopien sind Fremddaten, keine Basisformat-Probe.
 *
 * Urheberrecht: Es wird nirgends dekodierter Text ausgegeben — weder als
 * Beispiel noch als Wortliste. `germanLikeness` sieht den Text, liefert aber
 * nur eine Zahl; das Unbekannt-Byte-Histogramm trägt ausschließlich
 * Bytewerte, nie den daraus entstehenden Text.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

/** Erste und letzte Textsektion (Dateityp 9) laut Strukturprobe (kernel-probe). */
const TEXT_SECTION_FIRST = 9;
const TEXT_SECTION_LAST = 26;

/** Kandidatenbereich für den Zeichentabellen-Versatz. */
const OFFSET_MIN = 0x00;
const OFFSET_MAX = 0x60;

/** Zeichenketten unter dieser Länge sind für die Güteschätzung nicht aussagekräftig. */
const MIN_LIKENESS_LEN = 4;

interface FoundKernelBin {
  relPath: string;
  lang: 'de' | 'en';
}

/** Rekursive Suche nach `kernel.bin` (case-insensitiv) unterhalb `root`, `mods/` ausgeschlossen. */
async function findKernelBinFiles(root: string): Promise<FoundKernelBin[]> {
  const results: FoundKernelBin[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'mods') continue;
        await walk(childAbs, childRel);
      } else if (/^kernel\.bin$/i.test(entry.name)) {
        const lower = childRel.toLowerCase();
        results.push({ relPath: childRel, lang: lower.includes('lang-en') ? 'en' : 'de' });
      }
    }
  }
  await walk(root, '');
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}

interface M1Report {
  asset: string;
  relPath: string;
  groesse: number;
  layout: string;
  sektionen: number;
  sektionenOk: number;
  diagnoseAnzahlGesamt: number;
  diagnoseCodes: Record<string, number>;
  entpackteBytesGesamt: number;
}

async function runM1(bytes: Uint8Array, asset: string, relPath: string): Promise<{ report: M1Report; container: KernelContainer }> {
  const container = await parseKernelContainer(bytes, asset);
  if (!container) {
    throw new Error(`parseKernelContainer lieferte null für ${asset}`);
  }
  const diagCodes: Record<string, number> = {};
  for (const d of container.diagnostics) {
    diagCodes[d.code] = (diagCodes[d.code] ?? 0) + 1;
  }
  const sektionenOk = container.sections.filter((s) => s.ok).length;
  const entpackteBytesGesamt = container.sections.reduce((sum, s) => sum + s.data.length, 0);
  return {
    report: {
      asset,
      relPath,
      groesse: bytes.length,
      layout: container.layout,
      sektionen: container.sections.length,
      sektionenOk,
      diagnoseAnzahlGesamt: container.diagnostics.length,
      diagnoseCodes: diagCodes,
      entpackteBytesGesamt,
    },
    container,
  };
}

interface TextSpan {
  sectionIndex: number;
  data: Uint8Array;
  count: number;
}

/**
 * Extrahiert für alle Textsektionen (9–26) die u16-Zeigertabelle am
 * Sektionsanfang: Der erste Zeiger zeigt hinter die Tabelle, also ist die
 * Zeigeranzahl `ersterZeiger / 2`.
 */
function buildTextSpans(container: KernelContainer): {
  spans: TextSpan[];
  uebersprungenNichtOk: number;
  uebersprungenZuKurz: number;
} {
  const spans: TextSpan[] = [];
  let uebersprungenNichtOk = 0;
  let uebersprungenZuKurz = 0;
  for (const section of container.sections) {
    if (section.index < TEXT_SECTION_FIRST || section.index > TEXT_SECTION_LAST) continue;
    if (!section.ok) {
      uebersprungenNichtOk++;
      continue;
    }
    if (section.data.length < 2) {
      uebersprungenZuKurz++;
      continue;
    }
    const view = new DataView(section.data.buffer, section.data.byteOffset, section.data.byteLength);
    const firstPointer = view.getUint16(0, true);
    const count = Math.floor(firstPointer / 2);
    spans.push({ sectionIndex: section.index, data: section.data, count });
  }
  return { spans, uebersprungenNichtOk, uebersprungenZuKurz };
}

interface CandidateResult {
  offset: number;
  meanLikeness: number;
  unknownByteShare: number;
  terminatedShare: number;
  sampleCount: number;
}

/**
 * Sweep über alle Kandidaten-Versätze: pro Kandidat wird der gesamte
 * Textsektionsbestand dekodiert und über `germanLikeness` bewertet.
 * Zeichenketten unter `MIN_LIKENESS_LEN` fließen nicht in die Güteschätzung
 * ein — sie sind zu kurz, um aussagekräftig zu sein.
 */
function sweepOffsets(spans: TextSpan[]): CandidateResult[] {
  const results: CandidateResult[] = [];
  for (let offset = OFFSET_MIN; offset <= OFFSET_MAX; offset++) {
    const table = buildAsciiTable(offset);
    let sumLikeness = 0;
    let filteredCount = 0;
    let totalUnknown = 0;
    let totalChars = 0;
    let terminatedCount = 0;
    for (const span of spans) {
      const decoded = decodeStringTable(span.data, table, 0, span.count);
      for (const d of decoded) {
        if (d.text.length < MIN_LIKENESS_LEN) continue;
        filteredCount++;
        sumLikeness += germanLikeness(d.text);
        totalUnknown += d.unknownBytes;
        totalChars += d.text.length;
        if (d.terminated) terminatedCount++;
      }
    }
    results.push({
      offset,
      meanLikeness: filteredCount > 0 ? sumLikeness / filteredCount : 0,
      unknownByteShare: totalChars > 0 ? totalUnknown / totalChars : 0,
      terminatedShare: filteredCount > 0 ? terminatedCount / filteredCount : 0,
      sampleCount: filteredCount,
    });
  }
  return results;
}

interface ClassifiedString {
  length: number;
  unknownBytes: number[];
  terminated: boolean;
}

/**
 * Spiegelt die Klassifikationslogik von `decodeFfText`, gibt aber statt eines
 * Textes nur die Länge und die rohen Bytewerte der unbekannten Bytes zurück —
 * für das Vollständigkeits-Histogramm (M3), ohne je Text zu materialisieren.
 */
function classifyString(bytes: Uint8Array, table: FfTextTable, start: number, maxLen = 4096): ClassifiedString {
  let length = 0;
  const unknownBytes: number[] = [];
  let terminated = false;
  for (let i = start; i < bytes.length && i - start < maxLen; i++) {
    const b = bytes[i]!;
    if (table.terminators.includes(b)) {
      terminated = true;
      break;
    }
    const skip = table.controls[b];
    if (skip !== undefined) {
      i += skip;
      continue;
    }
    const override = table.overrides[b];
    if (override !== undefined) {
      length++;
      continue;
    }
    const win = table.windows.find((w) => b >= w.from && b <= w.to);
    if (win) {
      length++;
      continue;
    }
    unknownBytes.push(b);
    length++;
  }
  return { length, unknownBytes, terminated };
}

function classifyStringTable(data: Uint8Array, table: FfTextTable, count: number): ClassifiedString[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: ClassifiedString[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * 2;
    if (at + 2 > data.length) break;
    const offset = view.getUint16(at, true);
    if (offset >= data.length) {
      out.push({ length: 0, unknownBytes: [], terminated: false });
      continue;
    }
    out.push(classifyString(data, table, offset));
  }
  return out;
}

interface WinnerEvaluation {
  offset: number;
  decodedCount: number;
  shareWithoutUnknown: number;
  unknownByteHistogramTop20: Array<{ byte: number; count: number }>;
}

/** M3: Vollständigkeitsmessung beim Sieger-Versatz — nur Zahlen und Bytewerte. */
function evaluateWinner(spans: TextSpan[], offset: number): WinnerEvaluation {
  const table = buildAsciiTable(offset);
  const hist = new Map<number, number>();
  let decodedCount = 0;
  let withoutUnknown = 0;
  for (const span of spans) {
    const classified = classifyStringTable(span.data, table, span.count);
    for (const c of classified) {
      decodedCount++;
      if (c.unknownBytes.length === 0) withoutUnknown++;
      for (const b of c.unknownBytes) hist.set(b, (hist.get(b) ?? 0) + 1);
    }
  }
  const unknownByteHistogramTop20 = [...hist.entries()]
    .map(([byte, count]) => ({ byte, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return {
    offset,
    decodedCount,
    shareWithoutUnknown: decodedCount > 0 ? withoutUnknown / decodedCount : 0,
    unknownByteHistogramTop20,
  };
}

function top8(results: CandidateResult[]): CandidateResult[] {
  return [...results].sort((a, b) => b.meanLikeness - a.meanLikeness).slice(0, 8);
}

/**
 * `germanLikeness` bewertet groß-/kleinschreibungslos (`toLowerCase()` vor
 * der Analyse). Da sich ASCII-Groß- und Kleinbuchstaben um exakt 32 (0x20)
 * unterscheiden, dekodiert ein Kandidat, der genau 32 unter dem wahren
 * Versatz liegt, für jedes Byte, dessen wahres Zeichen ein Buchstabe ist,
 * automatisch dieselbe Buchstabenfolge — nur in Großschreibung. Nach dem
 * Kleinschreiben sieht die Gütefunktion beide Kandidaten für den
 * Buchstaben-/Bigramm-Anteil praktisch identisch; der Unterschied bleibt nur
 * über die nicht-alphabetischen Bytes (Satzzeichen, Ziffern, Umlaute)
 * bestehen. Ein solcher „Case-Schatten" ist keine unabhängige Hypothese über
 * die Bytebelegung, sondern ein Artefakt der Gütefunktion — deshalb wird der
 * Sieger zusätzlich gegen den besten Kandidaten *ohne* Case-Schatten-Abstand
 * (|Versatz - Sieger| !== 32) verglichen, das ist der belastbare Abstand.
 */
function isCaseShadow(offset: number, bestOffset: number): boolean {
  return Math.abs(offset - bestOffset) === 32;
}

function findDistinctRunnerUp(results: CandidateResult[], best: CandidateResult): CandidateResult {
  const sorted = [...results].sort((a, b) => b.meanLikeness - a.meanLikeness);
  const distinct = sorted.find((r) => r.offset !== best.offset && !isCaseShadow(r.offset, best.offset));
  return distinct ?? sorted[1]!;
}

describe.skipIf(!available)('Realdaten: Kernel-Abnahme', () => {
  it(
    'Kernel-Abnahme: Parser gegen echte kernel.bin, Zeichentabellen-Versatz aus den Daten abgeleitet',
    { timeout: 900_000 },
    async () => {
      const found = await findKernelBinFiles(REAL_DIR);
      const germanEntry = found.find((f) => f.lang === 'de');
      const englishEntry = found.find((f) => f.lang === 'en');

      if (!germanEntry || !englishEntry) {
        console.log(
          'Kernel-Abnahme: deutsche oder englische kernel.bin nicht gefunden — gültiger Negativbefund.',
          JSON.stringify({
            installationsVerzeichnis: REAL_DIR,
            gefunden: found.map((f) => ({ relPath: f.relPath, lang: f.lang })),
          }),
        );
        return;
      }

      const germanBytes = await readFile(join(REAL_DIR, ...germanEntry.relPath.split('/')));
      const englishBytes = await readFile(join(REAL_DIR, ...englishEntry.relPath.split('/')));

      // --- M1: Parser-Abnahme ---------------------------------------------------
      const m1German = await runM1(germanBytes, 'kernel.bin:de', germanEntry.relPath);
      const m1English = await runM1(englishBytes, 'kernel.bin:en', englishEntry.relPath);

      // --- M2: Zeichentabellen-Versatz ableiten (deutsche Datei) -----------------
      const germanSpans = buildTextSpans(m1German.container);
      const germanSweep = sweepOffsets(germanSpans.spans);
      const germanTop8 = top8(germanSweep);
      const germanBest = germanTop8[0]!;
      const germanSecond = germanTop8[1]!;
      const germanDistinctRunnerUp = findDistinctRunnerUp(germanSweep, germanBest);

      // --- M3: Vollständigkeit beim Sieger-Versatz --------------------------------
      const winnerEvaluation = evaluateWinner(germanSpans.spans, germanBest.offset);

      // --- M4: Gegenprobe Englisch -------------------------------------------------
      const englishSpans = buildTextSpans(m1English.container);
      const englishSweep = sweepOffsets(englishSpans.spans);
      const englishTop8 = top8(englishSweep);
      const englishBest = englishTop8[0]!;
      const englishSecond = englishTop8[1]!;
      const englishDistinctRunnerUp = findDistinctRunnerUp(englishSweep, englishBest);

      const output = {
        installationsVerzeichnis: REAL_DIR,
        m1: {
          deutsch: m1German.report,
          englisch: m1English.report,
        },
        m2: {
          kandidatenbereich: { von: OFFSET_MIN, bis: OFFSET_MAX },
          textSpans: {
            anzahlSektionen: germanSpans.spans.length,
            uebersprungenNichtOk: germanSpans.uebersprungenNichtOk,
            uebersprungenZuKurz: germanSpans.uebersprungenZuKurz,
          },
          top8: germanTop8,
          bestOffset: germanBest.offset,
          secondOffset: germanSecond.offset,
          gapAbsolute: germanBest.meanLikeness - germanSecond.meanLikeness,
          gapFactor: germanSecond.meanLikeness > 0 ? germanBest.meanLikeness / germanSecond.meanLikeness : Infinity,
          zweitplatzierterIstCaseSchatten: isCaseShadow(germanSecond.offset, germanBest.offset),
          distinctRunnerUpOffset: germanDistinctRunnerUp.offset,
          distinctRunnerUpMeanLikeness: germanDistinctRunnerUp.meanLikeness,
          gapFactorDistinct:
            germanDistinctRunnerUp.meanLikeness > 0 ? germanBest.meanLikeness / germanDistinctRunnerUp.meanLikeness : Infinity,
        },
        m3: winnerEvaluation,
        m4: {
          textSpans: {
            anzahlSektionen: englishSpans.spans.length,
            uebersprungenNichtOk: englishSpans.uebersprungenNichtOk,
            uebersprungenZuKurz: englishSpans.uebersprungenZuKurz,
          },
          top8: englishTop8,
          bestOffset: englishBest.offset,
          secondOffset: englishSecond.offset,
          gapAbsolute: englishBest.meanLikeness - englishSecond.meanLikeness,
          gapFactor: englishSecond.meanLikeness > 0 ? englishBest.meanLikeness / englishSecond.meanLikeness : Infinity,
          zweitplatzierterIstCaseSchatten: isCaseShadow(englishSecond.offset, englishBest.offset),
          distinctRunnerUpOffset: englishDistinctRunnerUp.offset,
          distinctRunnerUpMeanLikeness: englishDistinctRunnerUp.meanLikeness,
          gapFactorDistinct:
            englishDistinctRunnerUp.meanLikeness > 0
              ? englishBest.meanLikeness / englishDistinctRunnerUp.meanLikeness
              : Infinity,
          offsetStimmtMitDeutschUeberein: englishBest.offset === germanBest.offset,
        },
      };

      console.log('Kernel-Abnahme:', JSON.stringify(output, null, 2));

      // --- M1: 27 Sektionen, keine E-KRN--Diagnosen -------------------------------
      expect(m1German.report.sektionen).toBe(27);
      expect(m1English.report.sektionen).toBe(27);
      expect(m1German.report.sektionenOk).toBe(27);
      expect(m1English.report.sektionenOk).toBe(27);
      expect(m1German.report.diagnoseAnzahlGesamt).toBe(0);
      expect(m1English.report.diagnoseAnzahlGesamt).toBe(0);

      // --- M2: Der beste Versatz muss die Zweitplatzierung deutlich schlagen -----
      // Zwei Prüfungen: gegen die rohe Zweitplatzierung (kann ein
      // Case-Schatten sein, siehe isCaseShadow) mit moderatem Faktor, und
      // gegen den besten Kandidaten OHNE Case-Schatten-Abstand mit dem vollen
      // Faktor — das ist der eigentlich belastbare Abstand.
      expect(germanBest.sampleCount).toBeGreaterThan(0);
      expect(germanBest.meanLikeness).toBeGreaterThan(germanSecond.meanLikeness * 1.05);
      expect(germanBest.meanLikeness).toBeGreaterThan(germanDistinctRunnerUp.meanLikeness * 1.2);

      // --- M4: dieselbe Anforderung an die englische Gegenprobe -------------------
      expect(englishBest.sampleCount).toBeGreaterThan(0);
      expect(englishBest.meanLikeness).toBeGreaterThan(englishSecond.meanLikeness * 1.05);
      expect(englishBest.meanLikeness).toBeGreaterThan(englishDistinctRunnerUp.meanLikeness * 1.2);
    },
  );
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
