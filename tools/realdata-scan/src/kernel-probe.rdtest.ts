import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decompressLzs } from '@webmidgar/formats-field';

/**
 * S13-Realdatenprobe „Kernel-Struktur": `kernel.bin` und `kernel2.bin` der
 * lokalen FF7-Installation gegen zwei Formathypothesen prüfen.
 *
 * K1 (kernel.bin): reine Sektionsfolge, jede mit 6-Byte-Kopf + gzip-Strom.
 * Zwei Kopfauslegungen sind plausibel — u16 komprimiert/u16 entpackt/u16
 * Dateityp vs. u32 komprimiert/u16 Dateityp —, und nur das byteexakte
 * Accounting (Σ(6 + kompLänge) == Dateigröße) entscheidet, welche aufgeht.
 * `DecompressionStream('gzip')` statt `node:zlib`, weil derselbe Code später
 * im Browser laufen muss.
 *
 * K2 (kernel2.bin): vermutlich LZS-komprimiert (`decompressLzs` aus
 * `@webmidgar/formats-field`), ohne Längenvorsatz — direkter Versuch auf dem
 * Rohinhalt.
 *
 * Original- vs. Overlay-Trennung: Nur Dateien außerhalb von `mods/` (7th
 * Heaven) fließen in die Struktur-Accounting; Mod-Kopien werden nur
 * inventarisiert (Pfad, Größe, SHA-256), sonst validiert die Probe womöglich
 * modifizierte Daten statt des Basisformats.
 *
 * Urheberrecht: Ausgabe ausschließlich Längen, Zähler, Anteile,
 * Byte-Histogramme (Zahlen) und Digests — keine dekodierten Strings, keine
 * zusammenhängenden Rohbytefolgen aus den Datensektionen.
 */

const REAL_DIR =
  process.env['WEBMIDGAR_REAL_DIR'] ??
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY VII';

const available = existsSync(REAL_DIR);

const HEADER_LEN = 6;

type KernelLayout = 'u16-triple' | 'u32-len';

interface FoundFile {
  relPath: string;
  classification: 'original' | 'overlay';
  size: number;
  sha256: string;
}

interface SectionTrace {
  index: number;
  offset: number;
  kompLen: number;
  entpackteLenField: number | null;
  dateityp: number;
  gzipMagicOk: boolean;
}

interface HypothesisReport {
  layout: KernelLayout;
  sektionen: number;
  bytesAbgerechnet: number;
  dateigroesse: number;
  gehtAuf: boolean;
  gzipMagicOkVon: number;
  abbruchgrund: string | null;
  /** Nicht abgerechnete Restbytes am Dateiende, roh — nur wenn ≤16 B (Strukturbytes, kein Inhalt). */
  restBytesWerte: number[] | null;
}

interface SectionReport extends SectionTrace {
  entpackteLaenge: number;
  entpackteLaengeStimmtMitKopf: boolean | null;
  fehler: string | null;
  anteilLow: number;
  anteilAscii: number;
  anteilHigh: number;
  top12: Array<{ byte: string; anzahl: number }>;
  zeigerTabellePrefixN: number;
}

/** Rekursive Suche nach `kernel*.bin` (case-insensitiv) unterhalb `root`. */
async function findKernelFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (/^kernel2?\.bin$/i.test(entry.name)) {
        results.push(childRel);
      }
    }
  }
  await walk(root, '');
  return results;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Läuft eine Kopfauslegung linear ab und meldet, ob sie die Datei byteexakt
 * ausläuft. Bricht beim ersten Widerspruch ab (fehlendes gzip-Magic, Länge
 * über Dateiende) und hält die komplette Sektionsspur bis dahin fest.
 */
function accountHypothesis(bytes: Uint8Array, layout: KernelLayout): { report: HypothesisReport; sections: SectionTrace[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileSize = bytes.length;
  const sections: SectionTrace[] = [];
  let offset = 0;
  let stoppedReason: string | null = null;
  let gzipMagicOkCount = 0;

  while (offset < fileSize) {
    if (offset + HEADER_LEN > fileSize) {
      stoppedReason = `Kopf ragt bei Sektion ${sections.length} über Dateiende hinaus`;
      break;
    }
    let kompLen: number;
    let entpackteLenField: number | null;
    let dateityp: number;
    if (layout === 'u16-triple') {
      kompLen = view.getUint16(offset, true);
      entpackteLenField = view.getUint16(offset + 2, true);
      dateityp = view.getUint16(offset + 4, true);
    } else {
      kompLen = view.getUint32(offset, true);
      entpackteLenField = null;
      dateityp = view.getUint16(offset + 4, true);
    }
    const dataOffset = offset + HEADER_LEN;
    if (kompLen <= 0 || dataOffset + kompLen > fileSize) {
      stoppedReason = `Sektion ${sections.length}: kompLen=${kompLen} passt nicht (Rest ${fileSize - dataOffset} B)`;
      break;
    }
    const magicOk = bytes[dataOffset] === 0x1f && bytes[dataOffset + 1] === 0x8b;
    if (magicOk) gzipMagicOkCount++;
    sections.push({ index: sections.length, offset, kompLen, entpackteLenField, dateityp, gzipMagicOk: magicOk });
    if (!magicOk) {
      stoppedReason = `Sektion ${sections.length - 1}: gzip-Magic fehlt bei Offset ${dataOffset}`;
      break;
    }
    offset = dataOffset + kompLen;
    if (sections.length > 512) {
      stoppedReason = 'Sicherheitsabbruch: >512 Sektionen';
      break;
    }
  }

  const matchesExactly = stoppedReason === null && offset === fileSize;
  const restLen = fileSize - offset;
  const restBytesWerte = !matchesExactly && restLen > 0 && restLen <= 16 ? Array.from(bytes.subarray(offset, fileSize)) : null;
  return {
    report: {
      layout,
      sektionen: sections.length,
      bytesAbgerechnet: offset,
      dateigroesse: fileSize,
      gehtAuf: matchesExactly,
      gzipMagicOkVon: gzipMagicOkCount,
      abbruchgrund: stoppedReason,
      restBytesWerte,
    },
    sections,
  };
}

/** gzip-Dekompression über die Web-Streams-API (browserkompatibel). */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function byteStats(data: Uint8Array): {
  anteilLow: number;
  anteilAscii: number;
  anteilHigh: number;
  top12: Array<{ byte: string; anzahl: number }>;
} {
  const hist = new Array<number>(256).fill(0);
  let low = 0;
  let ascii = 0;
  let high = 0;
  for (const b of data) {
    hist[b]!++;
    if (b < 0x20) low++;
    else if (b <= 0x7e) ascii++;
    if (b > 0xdf) high++;
  }
  const len = data.length || 1;
  const top12 = hist
    .map((anzahl, byte) => ({ byte: `0x${byte.toString(16).padStart(2, '0')}`, anzahl }))
    .filter((e) => e.anzahl > 0)
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 12);
  return { anteilLow: low / len, anteilAscii: ascii / len, anteilHigh: high / len, top12 };
}

/**
 * Größtes `n`, für das die ersten `n` u16-Werte (LE) aufsteigend und kleiner
 * als die Sektionslänge sind — Indiz für eine Zeigertabelle am Sektionsanfang.
 */
function pointerTablePrefixN(data: Uint8Array): number {
  if (data.length < 2) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let n = 0;
  let prev = -1;
  while ((n + 1) * 2 <= data.length) {
    const v = view.getUint16(n * 2, true);
    if (v < data.length && v >= prev) {
      prev = v;
      n++;
    } else {
      break;
    }
  }
  return n;
}

/** Gruppiert Fundstellen nach Inhalt (SHA-256) — jeder Inhalt wird nur einmal analysiert. */
function groupBySha<T extends FoundFile>(list: T[]): Array<{ rep: T; dateien: string[] }> {
  const map = new Map<string, { rep: T; dateien: string[] }>();
  for (const f of list) {
    const existing = map.get(f.sha256);
    if (existing) existing.dateien.push(f.relPath);
    else map.set(f.sha256, { rep: f, dateien: [f.relPath] });
  }
  return [...map.values()];
}

describe.skipIf(!available)('Realdaten: Kernel-Struktur (kernel.bin / kernel2.bin)', () => {
  it('K1/K2-Formathypothesen gegen echte Kerneldateien', { timeout: 900_000 }, async () => {
    const relPaths = await findKernelFiles(REAL_DIR);

    const files: FoundFile[] = [];
    const buffers = new Map<string, Uint8Array>();
    for (const relPath of relPaths) {
      const bytes = await readFile(join(REAL_DIR, ...relPath.split('/')));
      const sha256 = await sha256Hex(bytes);
      const classification: FoundFile['classification'] = relPath.toLowerCase().split('/').includes('mods')
        ? 'overlay'
        : 'original';
      files.push({ relPath, classification, size: bytes.length, sha256 });
      buffers.set(relPath, bytes);
    }

    if (files.length === 0) {
      console.log(
        'Kernel-Struktur: keine kernel*.bin unterhalb der Installation gefunden — gültiger Negativbefund.',
        JSON.stringify({ installationsVerzeichnis: REAL_DIR }),
      );
      return;
    }

    const kernel1Originals = files.filter(
      (f) => f.classification === 'original' && /^kernel\.bin$/i.test(f.relPath.split('/').pop()!),
    );
    const kernel2Originals = files.filter(
      (f) => f.classification === 'original' && /^kernel2\.bin$/i.test(f.relPath.split('/').pop()!),
    );

    // --- K1: kernel.bin -------------------------------------------------------
    const k1Report: Array<{
      dateien: string[];
      groesse: number;
      sha256: string;
      hypothesen: HypothesisReport[];
      gewinnendesLayout: KernelLayout | null;
      /** true, wenn das gewinnende Layout nur eine Näherung ist (nicht byteexakt, aber mit gültigen Sektionsköpfen). */
      naeherung: boolean;
      sektionsMessungen: SectionReport[];
    }> = [];

    for (const { rep, dateien } of groupBySha(kernel1Originals)) {
      const bytes = buffers.get(rep.relPath)!;
      const gelesen = (['u16-triple', 'u32-len'] as const).map((layout) => accountHypothesis(bytes, layout));
      const hypothesen = gelesen.map((g) => g.report);
      // Bevorzugt: byteexaktes Accounting. Sonst Näherung — die Auslegung mit
      // den meisten Sektionen mit gültigem gzip-Magic, damit die zusätzlichen
      // Sektionsmessungen trotzdem berichtet werden können (klar als Näherung markiert).
      const exact = gelesen.find((g) => g.report.gehtAuf) ?? null;
      const naeherung = exact === null;
      const winner =
        exact ??
        gelesen.reduce<(typeof gelesen)[number] | null>((best, g) => {
          if (g.report.gzipMagicOkVon === 0) return best;
          if (!best || g.report.gzipMagicOkVon > best.report.gzipMagicOkVon) return g;
          return best;
        }, null);

      const sektionsMessungen: SectionReport[] = [];
      if (winner) {
        for (const s of winner.sections) {
          const dataOffset = s.offset + HEADER_LEN;
          const raw = bytes.subarray(dataOffset, dataOffset + s.kompLen);
          try {
            const data = await gunzip(raw);
            const stats = byteStats(data);
            sektionsMessungen.push({
              ...s,
              entpackteLaenge: data.length,
              entpackteLaengeStimmtMitKopf: s.entpackteLenField === null ? null : s.entpackteLenField === data.length,
              fehler: null,
              anteilLow: stats.anteilLow,
              anteilAscii: stats.anteilAscii,
              anteilHigh: stats.anteilHigh,
              top12: stats.top12,
              zeigerTabellePrefixN: pointerTablePrefixN(data),
            });
          } catch (err) {
            sektionsMessungen.push({
              ...s,
              entpackteLaenge: 0,
              entpackteLaengeStimmtMitKopf: null,
              fehler: (err as Error).message,
              anteilLow: 0,
              anteilAscii: 0,
              anteilHigh: 0,
              top12: [],
              zeigerTabellePrefixN: 0,
            });
          }
        }
      }

      k1Report.push({
        dateien,
        groesse: rep.size,
        sha256: rep.sha256,
        hypothesen,
        gewinnendesLayout: winner?.report.layout ?? null,
        naeherung: winner ? naeherung : false,
        sektionsMessungen,
      });
    }

    // --- K2: kernel2.bin --------------------------------------------------------
    const k2Report: Array<{
      dateien: string[];
      groesse: number;
      sha256: string;
      lzsErfolgreich: boolean;
      entpackteLaenge: number | null;
      fehler: string | null;
      ersteBytes: number[] | null;
    }> = [];

    for (const { rep, dateien } of groupBySha(kernel2Originals)) {
      const bytes = buffers.get(rep.relPath)!;
      try {
        const out = decompressLzs(bytes);
        k2Report.push({
          dateien,
          groesse: rep.size,
          sha256: rep.sha256,
          lzsErfolgreich: true,
          entpackteLaenge: out.length,
          fehler: null,
          ersteBytes: null,
        });
      } catch (err) {
        k2Report.push({
          dateien,
          groesse: rep.size,
          sha256: rep.sha256,
          lzsErfolgreich: false,
          entpackteLaenge: null,
          fehler: (err as Error).message,
          ersteBytes: Array.from(bytes.subarray(0, 16)),
        });
      }
    }

    const output = {
      installationsVerzeichnis: REAL_DIR,
      gefundeneDateien: files.length,
      dateiInventar: files,
      k1KernelBin: k1Report,
      k2Kernel2Bin: k2Report,
    };

    console.log('Kernel-Struktur:', JSON.stringify(output, null, 2));

    expect(files.length).toBeGreaterThan(0);
  });
});

describe.skipIf(available)('Realdaten nicht verfügbar', () => {
  it('übersprungen', () => {
    expect(true).toBe(true);
  });
});
