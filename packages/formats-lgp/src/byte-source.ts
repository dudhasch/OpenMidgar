/**
 * Minimale Lesequelle für Parser — implementiert von packages/io
 * (FSA-`File.slice`) und vom Fixture-Generator (In-Memory).
 * Parser kennen weder FSA noch IndexedDB (Masterplan ADR-004).
 */
export interface ByteSource {
  readonly size: number;
  /** Liest exakt [offset, offset+length); wirft bei Bereichsüberschreitung. */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
}

export class MemoryByteSource implements ByteSource {
  constructor(private readonly bytes: Uint8Array) {}
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
}
