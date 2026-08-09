import {
  DATA_PREFIX_LEN,
  diag,
  readAndValidatePrefix,
  resolvableEntries,
  scanLgp,
  type ArchiveIndexData,
  type LgpDiagnostic,
  type LgpEntry,
} from '@webmidgar/formats-lgp';
import { S0Store } from '@webmidgar/cache';
import { archiveFingerprint, sourceFingerprint } from './fingerprint.js';
import type { DirectorySource, SourceFile } from './sources.js';

/**
 * IO/Index-Dienst (Masterplan Phase 2.1) — Worker-agnostischer Kern des
 * IO/Index-Workers. Verantwortlich für Cold Scan, S0-Persistenz, Auflösung
 * kanonischer IDs und Lazy-Slice-Reads mit Vorsatz-Kreuzcheck.
 */

export interface OpenedArchive {
  index: ArchiveIndexData;
  file: SourceFile;
  fromCache: boolean;
}

export interface OpenSourceResult {
  sourceFingerprint: string;
  archives: {
    archiveName: string;
    path: string;
    fingerprint: string;
    entryCount: number;
    resolvable: number;
    quarantined: number;
    fromCache: boolean;
    fatal: boolean;
  }[];
  diagnostics: LgpDiagnostic[];
  timings: { totalMs: number; perArchiveMs: Record<string, number> };
}

export interface OpenSourceOptions {
  signal?: AbortSignal;
  /** Deep Scan validiert alle Vorsätze + Overlaps beim Cold Scan (Default: true). */
  deep?: boolean;
}

export class IndexService {
  private archives = new Map<string, OpenedArchive>(); // key: archiveName
  private entryById = new Map<string, { archive: OpenedArchive; entry: LgpEntry }>();
  private lastResult: OpenSourceResult | null = null;

  constructor(private readonly store: S0Store = new S0Store()) {}

  async openSource(dir: DirectorySource, opts: OpenSourceOptions = {}): Promise<OpenSourceResult> {
    const { signal } = opts;
    const deep = opts.deep ?? true;
    const t0 = now();
    this.archives.clear();
    this.entryById.clear();

    // 1. LGP-Dateien der Quelle einsammeln.
    const lgpFiles: SourceFile[] = [];
    for await (const f of dir.files(signal)) {
      if (f.name.toLowerCase().endsWith('.lgp')) lgpFiles.push(f);
    }
    lgpFiles.sort((a, b) => a.path.localeCompare(b.path));

    const result: OpenSourceResult = {
      sourceFingerprint: '',
      archives: [],
      diagnostics: [],
      timings: { totalMs: 0, perArchiveMs: {} },
    };

    // 2. Pro Archiv: Fingerprint → Warm-Pfad (S0) oder Cold Scan.
    const fps: string[] = [];
    for (const file of lgpFiles) {
      signal?.throwIfAborted();
      const ta = now();
      const archiveName = file.name.toLowerCase().replace(/\.lgp$/, '');
      const fp = await archiveFingerprint(file, signal);
      fps.push(fp);

      let index = await this.store.getArchiveIndex(fp);
      let fromCache = index !== undefined;
      // Warm-Treffer ohne Deep-Daten genügt nicht, wenn Deep angefordert ist.
      if (index && deep && !index.deepScanned) {
        index = undefined;
        fromCache = false;
      }
      let fatal = false;
      if (!index) {
        const scan = await scanLgp(file, archiveName, {
          mode: deep ? 'deep' : 'fast',
          signal,
          fingerprint: fp,
        });
        if (!scan.ok) {
          fatal = true;
          result.diagnostics.push(...scan.diagnostics);
          result.archives.push({
            archiveName,
            path: file.path,
            fingerprint: fp,
            entryCount: 0,
            resolvable: 0,
            quarantined: 0,
            fromCache: false,
            fatal,
          });
          result.timings.perArchiveMs[archiveName] = now() - ta;
          continue;
        }
        index = scan.archive!;
        signal?.throwIfAborted(); // kein Cache-Write nach Abbruch (Abbruchsemantik Phase 2.1)
        await this.store.putArchiveIndex(index);
      }

      const opened: OpenedArchive = { index, file, fromCache };
      this.archives.set(index.archiveName, opened);
      for (const entry of resolvableEntries(index)) {
        this.entryById.set(entry.canonicalId, { archive: opened, entry });
      }
      result.diagnostics.push(...index.diagnostics);
      result.archives.push({
        archiveName: index.archiveName,
        path: file.path,
        fingerprint: fp,
        entryCount: index.entryCount,
        resolvable: resolvableEntries(index).length,
        quarantined: index.entries.filter((e) => e.quarantined).length,
        fromCache,
        fatal,
      });
      result.timings.perArchiveMs[index.archiveName] = now() - ta;
    }

    result.sourceFingerprint = await sourceFingerprint(fps);
    signal?.throwIfAborted();
    await this.store.putSourceMeta({
      schemaVersion: 1,
      sourceFingerprint: result.sourceFingerprint,
      archiveFingerprints: fps,
      savedAt: Date.now(),
    });
    result.timings.totalMs = now() - t0;
    this.lastResult = result;
    return result;
  }

  getLastResult(): OpenSourceResult | null {
    return this.lastResult;
  }

  resolve(canonicalIdStr: string): LgpEntry | undefined {
    return this.entryById.get(canonicalIdStr)?.entry;
  }

  listEntries(archiveName: string): LgpEntry[] {
    const a = this.archives.get(archiveName.toLowerCase());
    return a ? resolvableEntries(a.index) : [];
  }

  /**
   * Lazy-Slice-Read: liest genau den Payload eines Eintrags, validiert beim
   * ersten Zugriff den Datenvorsatz (E-LGP-ENTRY → Laufzeit-Quarantäne).
   */
  async readEntry(canonicalIdStr: string, signal?: AbortSignal): Promise<Uint8Array> {
    const hit = this.entryById.get(canonicalIdStr);
    if (!hit) throw new EntryNotFoundError(canonicalIdStr);
    const { archive, entry } = hit;
    if (entry.quarantined) throw new EntryQuarantinedError(canonicalIdStr, entry.quarantineCode!);

    if (entry.length === undefined) {
      const problem = await readAndValidatePrefix(archive.file, entry, archive.file.size, signal);
      if (problem) {
        entry.quarantined = true;
        entry.quarantineCode = 'E-LGP-ENTRY';
        const d = diag('E-LGP-ENTRY', archive.index.archiveName, problem, {
          entry: entry.name,
          tocIndex: entry.tocIndex,
        });
        archive.index.diagnostics.push(d);
        this.entryById.delete(canonicalIdStr);
        throw new EntryQuarantinedError(canonicalIdStr, 'E-LGP-ENTRY', problem);
      }
    }
    signal?.throwIfAborted();
    return archive.file.read(entry.offset + DATA_PREFIX_LEN, entry.length!, signal);
  }
}

export class EntryNotFoundError extends Error {
  readonly code = 'E-RESOLVE';
  constructor(id: string) {
    super(`Asset nicht auflösbar: ${id}`);
  }
}

export class EntryQuarantinedError extends Error {
  constructor(
    id: string,
    readonly code: 'E-LGP-TOC' | 'E-LGP-ENTRY',
    detail?: string,
  ) {
    super(`Eintrag quarantänisiert (${code}): ${id}${detail ? ` — ${detail}` : ''}`);
  }
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();
