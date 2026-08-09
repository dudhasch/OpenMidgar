import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AssetStore, MemoryLru } from '@webmidgar/cache';
import type { FieldBundle, FieldParseResult } from '@webmidgar/formats-field';
import { IndexService, MemoryDirectorySource, MemorySourceFile } from '@webmidgar/io';
import { Telemetry } from '@webmidgar/telemetry';
import {
  buildLgp,
  composeCameraSection,
  composeCompressedField,
  composeWalkmeshSection,
  type FieldContainerSpec,
} from '@webmidgar/fixture-gen';
import { AssetPipeline, FieldUnusableError } from './asset-pipeline.js';
import { PipelineClient } from './client.js';
import { createLoopbackPair, type Endpoint } from './endpoint.js';
import { PipelineFault, type DecodedTextureStub } from './contracts.js';
import { PipelineWorkerHost } from './worker-host.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Field-Fixture: Walkmesh (2 Dreiecke) + 1 Kamera — genug für ein Bundle. */
function fieldSpec(): FieldContainerSpec {
  return {
    sections: {
      2: composeCameraSection([
        { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], position: [0, 0, -4096], zoom: 400 },
      ]),
      5: composeWalkmeshSection({
        triangles: [
          { vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]] },
          { vertices: [[100, 0, 0], [100, 100, 0], [0, 100, 0]] },
        ],
      }),
    },
  };
}

interface Rig {
  client: PipelineClient;
  telemetry: Telemetry;
  /** Anzahl der beim Host angekommenen Anfragen je kind. */
  seen: Record<string, number>;
}

function makeRig(opts: { sharedAbort?: boolean } = {}): Rig {
  const [clientEnd, hostEnd] = createLoopbackPair();
  const seen: Record<string, number> = {};
  // Zähl-Wrapper um den Host-Endpoint (beobachtet eingehende Anfragen).
  const counting: Endpoint = {
    post: (m, t) => hostEnd.post(m, t),
    listen: (h) =>
      hostEnd.listen((msg) => {
        const kind = (msg as { kind?: string }).kind ?? '?';
        seen[kind] = (seen[kind] ?? 0) + 1;
        h(msg);
      }),
  };
  new PipelineWorkerHost(counting);
  const telemetry = new Telemetry();
  const client = new PipelineClient(clientEnd, {
    telemetry,
    ...(opts.sharedAbort !== undefined ? { sharedAbort: opts.sharedAbort } : {}),
  });
  return { client, telemetry, seen };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('Pipeline: Nachrichtenvertrag', () => {
  it('parse-field roundtrippt über den Loopback (Sequenz aus Phase-2-Diagramm)', async () => {
    const { client, telemetry } = makeRig();
    const entry = composeCompressedField(fieldSpec());
    const buf = entry.buffer.slice(0, entry.byteLength) as ArrayBuffer;
    const result = (await client.request('parse-field', {
      fieldId: 'fixture',
      bytes: buf,
    })) as FieldParseResult;
    expect(result.ok).toBe(true);
    expect(result.bundle!.walkmesh!.triangleCount).toBe(2);
    expect(telemetry.snapshot().latencies['pipeline.parse-field']!.count).toBe(1);
  });

  it('decode-texture-Stub liefert RGBA-Puffer in erwarteter Größe', async () => {
    const { client } = makeRig();
    const tex = (await client.request('decode-texture', {
      width: 16,
      height: 8,
    })) as DecodedTextureStub;
    expect(tex.rgba.byteLength).toBe(16 * 8 * 4);
  });

  it('E-PIPE-KIND: unbekannte Anfrageart → typisierter Fault', async () => {
    const { client } = makeRig();
    await expect(
      client.request('unbekannt' as never, {}),
    ).rejects.toBeInstanceOf(PipelineFault);
  });

  it('E-PIPE-VERSION: falsche Protokollversion → Fault statt stiller Verwurf', async () => {
    const [clientEnd, hostEnd] = createLoopbackPair();
    new PipelineWorkerHost(hostEnd);
    const received: unknown[] = [];
    clientEnd.listen((m) => received.push(m));
    clientEnd.post({ v: 99, kind: 'parse-field', requestId: 7, generation: 0, payload: {} });
    await sleep(20);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'fault', requestId: 7, code: 'E-PIPE-VERSION' });
  });

  it('E-PIPE-INTERNAL: defekter LZS-Eintrag → ok:false-Ergebnis, kein Crash', async () => {
    const { client } = makeRig();
    const broken = new Uint8Array(16); // deklarierte Länge 0, Müllcontainer
    const result = (await client.request('parse-field', {
      fieldId: 'broken',
      bytes: broken.buffer as ArrayBuffer,
    })) as FieldParseResult;
    expect(result.ok).toBe(false);
  });
});

describe('Pipeline: Abbruch-Injektion', () => {
  it('Abbruch mitten in Etappen → aborted-Antwort, NIE ein result danach', async () => {
    const { client, telemetry, seen } = makeRig();
    const ac = new AbortController();
    const promise = client.request(
      'decode-texture',
      { width: 64, height: 64, stages: 40 },
      { signal: ac.signal },
    );
    await sleep(5); // Host ist mitten in den Etappen
    ac.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // Nachlauf: die verspätete Host-Antwort (aborted) darf nichts mehr ausliefern.
    await sleep(60);
    expect(seen['abort']).toBe(1); // abort-Nachricht ist beim Host angekommen
    expect(client.pendingCount).toBe(0);
    expect(telemetry.counterOf('pipeline.stale-dropped')).toBe(1);
  });

  it('bereits abgebrochenes Signal → sofortige Ablehnung, Anfrage verlässt den Client nie', async () => {
    const { client, seen } = makeRig();
    const ac = new AbortController();
    ac.abort();
    await expect(
      client.request('decode-texture', { width: 4, height: 4 }, { signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await sleep(20);
    expect(seen['decode-texture']).toBeUndefined();
  });

  it('Generationswechsel bricht alle in-flight-Anfragen der alten Generation ab', async () => {
    const { client, telemetry } = makeRig();
    const p1 = client.request('decode-texture', { width: 64, height: 64, stages: 30 });
    const p2 = client.request('decode-texture', { width: 64, height: 64, stages: 30 });
    await sleep(5);
    const gen = client.beginGeneration();
    expect(gen).toBe(1);
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    // Verspätete aborted-Acks der beiden Anfragen werden als stale verworfen.
    await sleep(80);
    expect(client.pendingCount).toBe(0);
    expect(telemetry.counterOf('pipeline.stale-dropped')).toBe(2);
    // Neue Generation arbeitet normal weiter (SAB-freier Default-Pfad).
    const tex = (await client.request('decode-texture', { width: 8, height: 8 })) as DecodedTextureStub;
    expect(tex.rgba.byteLength).toBe(8 * 8 * 4);
  });

  it('SAB-Abbruchkanal: Atomics-Flag stoppt den Host auch ohne abort-Nachricht', async () => {
    expect(typeof SharedArrayBuffer).toBe('function');
    const { client } = makeRig({ sharedAbort: true });
    const ac = new AbortController();
    const promise = client.request(
      'decode-texture',
      { width: 128, height: 128, stages: 60 },
      { signal: ac.signal },
    );
    await sleep(5);
    ac.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('AssetPipeline: Cache-Kette gegen Fixtures', () => {
  async function makeAssetRig(store: AssetStore, opts: { sharedAbort?: boolean } = {}) {
    const rig = makeRig(opts);
    const entry = composeCompressedField(fieldSpec());
    const lgp = buildLgp({ entries: [{ name: 'md1stin', data: entry }] });
    const index = new IndexService();
    await index.openSource(
      new MemoryDirectorySource([new MemorySourceFile('flevel.lgp', lgp.bytes, 1)]),
    );
    const pipeline = new AssetPipeline({
      client: rig.client,
      index,
      store,
      memory: new MemoryLru<FieldBundle>({ maxBytes: 1 << 20 }),
      telemetry: rig.telemetry,
    });
    return { ...rig, pipeline, index };
  }

  it('Cold → Parse → Cache; zweiter Zugriff aus Memory ohne Worker-Roundtrip', async () => {
    const store = new AssetStore();
    const { pipeline, telemetry, seen } = await makeAssetRig(store);

    const first = await pipeline.getFieldBundle('lgp:flevel/md1stin');
    expect(first.walkmesh!.triangleCount).toBe(2);
    expect(telemetry.counterOf('cache.miss')).toBe(1);
    expect(seen['parse-field']).toBe(1);

    const second = await pipeline.getFieldBundle('lgp:flevel/md1stin');
    expect(second.walkmesh!.triangleCount).toBe(2);
    expect(telemetry.counterOf('cache.hit-memory')).toBe(1);
    expect(seen['parse-field']).toBe(1); // kein zweiter Worker-Roundtrip
  });

  it('Warm über IndexedDB: frische Session trifft S2-Store statt Worker', async () => {
    const store = new AssetStore();
    const first = await makeAssetRig(store);
    await first.pipeline.getFieldBundle('lgp:flevel/md1stin');

    const second = await makeAssetRig(store); // neue Session, gleicher Store
    const bundle = await second.pipeline.getFieldBundle('lgp:flevel/md1stin');
    expect(bundle.cameras!.cameras).toHaveLength(1);
    expect(second.telemetry.counterOf('cache.hit-idb')).toBe(1);
    expect(second.seen['parse-field']).toBeUndefined();
  });

  it('Abbruch während des Parse → kein Cache-Write (weder Memory noch IndexedDB)', async () => {
    const store = new AssetStore();
    const rig = makeRig();
    const entry = composeCompressedField(fieldSpec());
    const lgp = buildLgp({ entries: [{ name: 'slowfld', data: entry }] });
    const index = new IndexService();
    await index.openSource(
      new MemoryDirectorySource([new MemorySourceFile('flevel.lgp', lgp.bytes, 1)]),
    );
    const memory = new MemoryLru<FieldBundle>({ maxBytes: 1 << 20 });
    const pipeline = new AssetPipeline({ client: rig.client, index, store, memory });

    // delayMs-Etappe im Host gibt dem Abbruch ein Fenster mitten im Request.
    const ac = new AbortController();
    const promise = (async () => {
      const raw = await index.readEntry('lgp:flevel/slowfld', ac.signal);
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      return rig.client.request(
        'parse-field',
        { fieldId: 'lgp:flevel/slowfld', bytes: buf, delayMs: 200 },
        { signal: ac.signal },
      );
    })();
    await sleep(20);
    ac.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await sleep(50);
    expect(memory.size).toBe(0);
    expect(await store.totalBytes()).toBe(0);

    // Regulärer Pfad über die Fassade mit vorab abgebrochenem Signal ebenso:
    const ac2 = new AbortController();
    ac2.abort();
    await expect(
      pipeline.getFieldBundle('lgp:flevel/slowfld', { signal: ac2.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(memory.size).toBe(0);
    expect(await store.totalBytes()).toBe(0);
  });

  it('FieldUnusableError bei fatalem Container; nichts wird gecacht', async () => {
    const store = new AssetStore();
    const rig = makeRig();
    const lgp = buildLgp({ entries: [{ name: 'kaputt', data: new Uint8Array(8) }] });
    const index = new IndexService();
    await index.openSource(
      new MemoryDirectorySource([new MemorySourceFile('flevel.lgp', lgp.bytes, 1)]),
    );
    const pipeline = new AssetPipeline({ client: rig.client, index, store });
    await expect(pipeline.getFieldBundle('lgp:flevel/kaputt')).rejects.toBeInstanceOf(
      FieldUnusableError,
    );
    expect(await store.totalBytes()).toBe(0);
  });

  it('NFR-Instrumentierung: Latenzen erfasst, Steady State ohne Long Tasks', async () => {
    const store = new AssetStore();
    const { pipeline, telemetry } = await makeAssetRig(store);
    const { startLagProbe } = await import('@webmidgar/telemetry');
    const stopProbe = startLagProbe(telemetry, { intervalMs: 10, thresholdMs: 50 });
    for (let i = 0; i < 30; i++) {
      await pipeline.getFieldBundle('lgp:flevel/md1stin');
    }
    await sleep(30);
    stopProbe();
    const snap = telemetry.snapshot();
    expect(snap.latencies['asset.field-bundle']!.count).toBe(30);
    expect(snap.longTasks.count).toBe(0); // Akzeptanzkriterium S3
  });
});
