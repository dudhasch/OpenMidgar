import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { assetKey } from './keys.js';
import { MemoryLru } from './memory-lru.js';
import { AssetStore } from './asset-store.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('assetKey', () => {
  it('folgt dem Schema {fingerprint}/{parserVersion}/{id}/{stufe}', () => {
    expect(assetKey('abc123', 2, 'lgp:flevel/md1stin', 's2')).toBe(
      'abc123/2/lgp:flevel/md1stin/s2',
    );
  });
});

describe('MemoryLru', () => {
  it('evictet unter Byte-Budget in LRU-Reihenfolge; Zugriff frischt Recency auf', () => {
    const evicted: string[] = [];
    const lru = new MemoryLru<string>({ maxBytes: 100, onEvict: (k) => evicted.push(k) });
    lru.set('a', 'A', 40);
    lru.set('b', 'B', 40);
    expect(lru.get('a')).toBe('A'); // 'a' auffrischen → 'b' ist nun am ältesten
    lru.set('c', 'C', 40); // 120 > 100 → Eviction
    expect(evicted).toEqual(['b']);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.bytes).toBe(80);
  });

  it('cached Einzelobjekte über Budget gar nicht erst', () => {
    const lru = new MemoryLru<string>({ maxBytes: 10 });
    lru.set('big', 'X', 999);
    expect(lru.has('big')).toBe(false);
    expect(lru.bytes).toBe(0);
  });

  it('ersetzt vorhandene Keys ohne Doppelzählung', () => {
    const lru = new MemoryLru<string>({ maxBytes: 100 });
    lru.set('a', 'v1', 30);
    lru.set('a', 'v2', 50);
    expect(lru.bytes).toBe(50);
    expect(lru.get('a')).toBe('v2');
  });
});

describe('AssetStore (S1/S2, IndexedDB)', () => {
  it('roundtrippt Payloads inkl. typisierter Arrays', async () => {
    const store = new AssetStore();
    const payload = { bundle: { data: new Uint8Array([1, 2, 3]) }, n: 42 };
    await store.put('k1', 's2', payload, 3);
    const hit = await store.get<typeof payload>('k1');
    expect(hit?.n).toBe(42);
    expect(hit?.bundle.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get('fehlt')).toBeUndefined();
  });

  it('Sweep entfernt die am längsten unbenutzten Einträge bis unters Budget', async () => {
    const store = new AssetStore(); // Budget hier manuell via sweep()
    await store.put('old', 's2', 'o', 40);
    await store.put('mid', 's2', 'm', 40);
    await store.put('new', 's2', 'n', 40);
    await store.get('old'); // Recency-Touch: 'old' ist jetzt jüngster
    const evicted = await store.sweep(80);
    expect(evicted).toEqual(['mid']); // ältester unbenutzter zuerst
    expect(await store.get('mid')).toBeUndefined();
    expect(await store.get('old')).toBe('o');
    expect(await store.totalBytes()).toBe(80);
  });

  it('put mit konfiguriertem Budget sweept automatisch', async () => {
    const store = new AssetStore(100);
    await store.put('a', 's2', 'A', 60);
    await store.put('b', 's2', 'B', 60); // 120 > 100 → 'a' fliegt
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBe('B');
  });
});
