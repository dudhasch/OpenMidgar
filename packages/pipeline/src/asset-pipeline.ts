import { assetKey, AssetStore, MemoryLru } from '@webmidgar/cache';
import type { FieldBundle, FieldDiagnostic, FieldParseResult } from '@webmidgar/formats-field';
import type { IndexService } from '@webmidgar/io';
import type { Telemetry } from '@webmidgar/telemetry';
import type { PipelineClient } from './client.js';

/**
 * Asset-Auflösung für Field-Bundles über die Cache-Kette (Masterplan 2.2/2.3):
 *   Memory-LRU (S2 flüchtig) → AssetStore (S2 persistent) → Cold Path
 *   (IO-Slice → Parser-Worker → Cache-Write).
 * Abbruchgarantie: nach einem Abbruch findet KEIN Cache-Write statt — der
 * Guard sitzt zwischen Worker-Antwort und Persistenz.
 */

/** Versionsstempel der Field-Parser-Kette — Bump invalidiert S2-Einträge (ADR-008). */
export const FIELD_PARSER_VERSION = 1;

export class FieldUnusableError extends Error {
  constructor(
    readonly fieldId: string,
    readonly diagnostics: FieldDiagnostic[],
  ) {
    super(`Field unbrauchbar: ${fieldId} (${diagnostics.map((d) => d.code).join(', ')})`);
  }
}

export interface AssetPipelineOptions {
  client: PipelineClient;
  index: IndexService;
  store?: AssetStore;
  memory?: MemoryLru<FieldBundle>;
  telemetry?: Telemetry;
  parserVersion?: number;
}

interface CachedBundleRecord {
  bundle: FieldBundle;
  approxBytes: number;
}

export class AssetPipeline {
  private readonly client: PipelineClient;
  private readonly index: IndexService;
  private readonly store: AssetStore | undefined;
  private readonly memory: MemoryLru<FieldBundle>;
  private readonly telemetry: Telemetry | undefined;
  private readonly parserVersion: number;

  constructor(opts: AssetPipelineOptions) {
    this.client = opts.client;
    this.index = opts.index;
    this.store = opts.store;
    this.memory = opts.memory ?? new MemoryLru<FieldBundle>({ maxBytes: 64 * 1024 * 1024 });
    this.telemetry = opts.telemetry;
    this.parserVersion = opts.parserVersion ?? FIELD_PARSER_VERSION;
  }

  private keyFor(canonicalId: string): string {
    const fp = this.index.getLastResult()?.sourceFingerprint ?? 'unknown-source';
    return assetKey(fp, this.parserVersion, canonicalId, 's2');
  }

  /** Field-Wechsel: bricht alle laufenden Anfragen der alten Generation ab. */
  beginFieldTransition(): number {
    return this.client.beginGeneration();
  }

  async getFieldBundle(canonicalId: string, o: { signal?: AbortSignal } = {}): Promise<FieldBundle> {
    const stop = this.telemetry?.time('asset.field-bundle');
    try {
      const key = this.keyFor(canonicalId);

      const memHit = this.memory.get(key);
      if (memHit) {
        this.telemetry?.count('cache.hit-memory');
        return memHit;
      }

      if (this.store) {
        const idbHit = await this.store.get<CachedBundleRecord>(key);
        if (idbHit) {
          this.telemetry?.count('cache.hit-idb');
          this.memory.set(key, idbHit.bundle, idbHit.approxBytes);
          return idbHit.bundle;
        }
      }

      this.telemetry?.count('cache.miss');
      const raw = await this.index.readEntry(canonicalId, o.signal);
      const bytes =
        raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
          ? (raw.buffer as ArrayBuffer)
          : (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);

      const result = (await this.client.request(
        'parse-field',
        { fieldId: canonicalId, bytes },
        { signal: o.signal, transfer: [bytes] },
      )) as FieldParseResult;
      if (!result.ok || !result.bundle) {
        throw new FieldUnusableError(canonicalId, result.diagnostics);
      }

      // Abbruch-Guard (Masterplan 2.1): kein Cache-Write nach Abbruch.
      o.signal?.throwIfAborted();
      const approxBytes = raw.byteLength * 4; // Dekompressions-/NAM-Heuristik
      this.memory.set(key, result.bundle, approxBytes);
      if (this.store) {
        await this.store.put(key, 's2', { bundle: result.bundle, approxBytes } satisfies CachedBundleRecord, approxBytes);
      }
      return result.bundle;
    } finally {
      stop?.();
    }
  }
}
