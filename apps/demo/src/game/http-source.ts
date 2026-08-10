import type { DirectorySource, SourceFile } from '@webmidgar/io';

/**
 * Dev-Datenquelle über den Vite-Endpunkt `/ff7data/*` (s. ff7data-plugin.ts).
 * Erfüllt denselben `DirectorySource`-Vertrag wie die FSA-Quelle, braucht aber
 * keine Nutzergeste — damit ist die integrierte Demo automatisiert testbar.
 * Nur für den Entwicklungsserver gedacht; die Produktions-App nutzt FSA.
 */

interface ManifestEntry {
  path: string;
  size: number;
  lastModified: number;
}

class HttpSourceFile implements SourceFile {
  constructor(
    public readonly path: string,
    public readonly size: number,
    public readonly lastModified: number,
  ) {}

  get name(): string {
    return this.path.split('/').pop()!;
  }

  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(`read out of bounds: ${offset}+${length} > ${this.size}`);
    }
    if (length === 0) return new Uint8Array(0);
    const res = await fetch(`/ff7data/${encodeURI(this.path)}`, {
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
      signal: signal ?? null,
    });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} für ${this.path}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length !== length) {
      throw new Error(`Range-Antwort unvollständig für ${this.path}: ${buf.length} statt ${length}`);
    }
    return buf;
  }
}

export class HttpDirectorySource implements DirectorySource {
  constructor(private readonly entries: ManifestEntry[]) {}

  async *files(signal?: AbortSignal): AsyncIterable<SourceFile> {
    for (const e of this.entries) {
      signal?.throwIfAborted();
      yield new HttpSourceFile(e.path, e.size, e.lastModified);
    }
  }
}

/** null ⇔ Endpunkt nicht verfügbar (kein FF7_DATA_DIR gesetzt / kein Dev-Server). */
export async function openHttpSource(): Promise<HttpDirectorySource | null> {
  try {
    const res = await fetch('/ff7data/__manifest');
    if (!res.ok) return null;
    const manifest = (await res.json()) as ManifestEntry[];
    return new HttpDirectorySource(manifest);
  } catch {
    return null;
  }
}

/** Ganze Datei (Nicht-LGP: scene.bin, KERNEL.BIN, WM0.MAP, save*.ff7). */
export async function fetchRawFile(path: string): Promise<Uint8Array | null> {
  const res = await fetch(`/ff7data/${encodeURI(path)}`);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}
