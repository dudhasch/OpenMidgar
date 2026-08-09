/**
 * In-Memory-LRU mit Byte-Budget (Cache-Stufe S2, flüchtiger Teil —
 * Masterplan Phase 2.2). Nutzt die Einfügereihenfolge der Map als
 * Recency-Ordnung: Zugriff = löschen + neu einfügen.
 */

export interface MemoryLruOptions<V> {
  maxBytes: number;
  onEvict?: (key: string, value: V) => void;
}

export class MemoryLru<V> {
  #map = new Map<string, { value: V; bytes: number }>();
  #bytes = 0;

  constructor(private readonly opts: MemoryLruOptions<V>) {}

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: string): V | undefined {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    this.#map.delete(key);
    this.#map.set(key, entry); // Recency-Touch
    return entry.value;
  }

  has(key: string): boolean {
    return this.#map.has(key);
  }

  set(key: string, value: V, bytes: number): void {
    if (bytes > this.opts.maxBytes) return; // Einzelobjekt über Budget: nicht cachen
    this.delete(key);
    this.#map.set(key, { value, bytes });
    this.#bytes += bytes;
    // LRU-Eviction bis unter Budget (älteste = erste Iterationsposition).
    for (const [oldKey, oldEntry] of this.#map) {
      if (this.#bytes <= this.opts.maxBytes) break;
      if (oldKey === key) continue; // frisch gesetzten Eintrag nie sofort opfern
      this.#map.delete(oldKey);
      this.#bytes -= oldEntry.bytes;
      this.opts.onEvict?.(oldKey, oldEntry.value);
    }
  }

  delete(key: string): boolean {
    const entry = this.#map.get(key);
    if (!entry) return false;
    this.#map.delete(key);
    this.#bytes -= entry.bytes;
    return true;
  }

  clear(): void {
    this.#map.clear();
    this.#bytes = 0;
  }
}
