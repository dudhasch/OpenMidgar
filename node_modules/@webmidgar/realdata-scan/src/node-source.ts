import { open, readdir, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirectorySource, SourceFile } from '@webmidgar/io';

/**
 * Node-Adapter der IO-Quellenabstraktion für den lokalen Realdaten-Scan.
 * Liest ausschließlich; Originaldaten verlassen nie die Maschine — Ergebnis
 * des Scans sind aggregierte Diagnosen (Masterplan: „Diagnose-Scan").
 */

export class NodeSourceFile implements SourceFile {
  #handle: FileHandle | null = null;
  constructor(
    private readonly absPath: string,
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
    this.#handle ??= await open(this.absPath, 'r');
    const buf = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await this.#handle.read(buf, done, length - done, offset + done);
      if (bytesRead === 0) throw new Error(`EOF bei ${offset + done} in ${this.path}`);
      done += bytesRead;
    }
    return buf;
  }

  async close(): Promise<void> {
    await this.#handle?.close();
    this.#handle = null;
  }
}

export class NodeDirectorySource implements DirectorySource {
  readonly opened: NodeSourceFile[] = [];
  constructor(
    private readonly root: string,
    /** Nur diese Unterpfade (relativ, '/'-getrennt) aufzählen; leer = alles. */
    private readonly includePrefixes: string[] = [],
  ) {}

  async *files(signal?: AbortSignal): AsyncIterable<SourceFile> {
    yield* this.walk(this.root, '', signal);
  }

  private async *walk(abs: string, rel: string, signal?: AbortSignal): AsyncIterable<SourceFile> {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (
          this.includePrefixes.length === 0 ||
          this.includePrefixes.some((p) => p.startsWith(childRel) || childRel.startsWith(p))
        ) {
          yield* this.walk(childAbs, childRel, signal);
        }
      } else if (
        this.includePrefixes.length === 0 ||
        this.includePrefixes.some((p) => childRel.startsWith(p))
      ) {
        const s = await stat(childAbs);
        const file = new NodeSourceFile(childAbs, childRel, s.size, s.mtimeMs);
        this.opened.push(file);
        yield file;
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.opened.map((f) => f.close()));
  }
}
