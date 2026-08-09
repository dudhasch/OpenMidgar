import type { ByteSource } from '@webmidgar/formats-lgp';

/**
 * Quellenabstraktion über der File System Access API (Masterplan Phase 2.1):
 * Der IO/Index-Worker ist der einzige Ort mit FSA-Zugriff; Tests nutzen die
 * In-Memory-Implementierung mit identischem Vertrag.
 */

export interface SourceFile extends ByteSource {
  /** Pfad relativ zur gewählten Verzeichniswurzel, mit '/'-Trennern. */
  readonly path: string;
  readonly name: string;
  readonly lastModified: number;
}

export interface DirectorySource {
  /** Rekursive Aufzählung aller Dateien (Reihenfolge unspezifiziert). */
  files(signal?: AbortSignal): AsyncIterable<SourceFile>;
}

// --- In-Memory (Tests, Fixture-Verzeichnisse) ------------------------------

export class MemorySourceFile implements SourceFile {
  constructor(
    public readonly path: string,
    private bytes: Uint8Array,
    public lastModified = 0,
  ) {}
  get name(): string {
    return this.path.split('/').pop()!;
  }
  get size(): number {
    return this.bytes.length;
  }
  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (offset < 0 || length < 0 || offset + length > this.bytes.length) {
      throw new RangeError(`read out of bounds: ${offset}+${length} > ${this.bytes.length}`);
    }
    return this.bytes.slice(offset, offset + length);
  }
  /** Testhilfe: Quelle „ändert sich auf der Platte". */
  replaceContent(bytes: Uint8Array, lastModified: number): void {
    this.bytes = bytes;
    this.lastModified = lastModified;
  }
}

export class MemoryDirectorySource implements DirectorySource {
  constructor(private readonly entries: MemorySourceFile[]) {}
  async *files(signal?: AbortSignal): AsyncIterable<SourceFile> {
    for (const f of this.entries) {
      signal?.throwIfAborted();
      yield f;
    }
  }
}

// --- File System Access API (Browser) --------------------------------------

export class FsaSourceFile implements SourceFile {
  #file: File;
  constructor(
    public readonly path: string,
    file: File,
  ) {
    this.#file = file;
  }
  get name(): string {
    return this.#file.name;
  }
  get size(): number {
    return this.#file.size;
  }
  get lastModified(): number {
    return this.#file.lastModified;
  }
  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (offset < 0 || length < 0 || offset + length > this.#file.size) {
      throw new RangeError(`read out of bounds: ${offset}+${length} > ${this.#file.size}`);
    }
    const buf = await this.#file.slice(offset, offset + length).arrayBuffer();
    signal?.throwIfAborted();
    return new Uint8Array(buf);
  }
}

export class FsaDirectorySource implements DirectorySource {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async *files(signal?: AbortSignal): AsyncIterable<SourceFile> {
    yield* this.walk(this.root, '', signal);
  }

  private async *walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    signal?: AbortSignal,
  ): AsyncIterable<SourceFile> {
    // entries() fehlt in den TS-DOM-Typen, ist aber Teil der FSA-API.
    const iterable = dir as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of iterable.entries()) {
      signal?.throwIfAborted();
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        yield* this.walk(handle as FileSystemDirectoryHandle, path, signal);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        yield new FsaSourceFile(path, file);
      }
    }
  }
}
