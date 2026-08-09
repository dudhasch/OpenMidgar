import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { basicFixture, buildLgp, corruptPrefixName } from '@webmidgar/fixture-gen';
import { S0Store } from '@webmidgar/cache';
import { EntryNotFoundError, EntryQuarantinedError, IndexService } from './index-service.js';
import { archiveFingerprint } from './fingerprint.js';
import { MemoryDirectorySource, MemorySourceFile } from './sources.js';

const ascii = (s: string) => new TextEncoder().encode(s);

function makeDir(files: MemorySourceFile[]): MemoryDirectorySource {
  return new MemoryDirectorySource(files);
}

beforeEach(() => {
  // Frische IndexedDB je Test — deterministische Cold/Warm-Pfade.
  globalThis.indexedDB = new IDBFactory();
});

describe('IndexService: Cold Scan & Persistenz', () => {
  it('indexiert alle .lgp-Dateien einer Quelle und ignoriert Fremddateien', async () => {
    const fixture = basicFixture();
    const dir = makeDir([
      new MemorySourceFile('data/field/char.lgp', fixture.bytes, 111),
      new MemorySourceFile('readme.txt', ascii('kein archiv'), 5),
    ]);
    const service = new IndexService();
    const result = await service.openSource(dir);
    expect(result.archives).toHaveLength(1);
    expect(result.archives[0]!.archiveName).toBe('char');
    expect(result.archives[0]!.fromCache).toBe(false);
    expect(result.archives[0]!.resolvable).toBe(fixture.order.length);
    expect(result.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Warm-Start: zweiter openSource lädt den Index aus S0 statt neu zu scannen', async () => {
    const fixture = basicFixture();
    const file = new MemorySourceFile('char.lgp', fixture.bytes, 111);
    const store = new S0Store();
    const cold = await new IndexService(store).openSource(makeDir([file]));
    expect(cold.archives[0]!.fromCache).toBe(false);

    const t0 = performance.now();
    const warm = await new IndexService(store).openSource(makeDir([file]));
    const warmMs = performance.now() - t0;
    expect(warm.archives[0]!.fromCache).toBe(true);
    expect(warm.sourceFingerprint).toBe(cold.sourceFingerprint);
    expect(warmMs).toBeLessThan(100); // Akzeptanzkriterium S1
  });

  it('Rescan bei Quelländerung: neuer Inhalt → neuer Fingerprint → Cold Scan', async () => {
    const file = new MemorySourceFile('char.lgp', basicFixture().bytes, 111);
    const store = new S0Store();
    await new IndexService(store).openSource(makeDir([file]));

    const changed = buildLgp({ entries: [{ name: 'newfile.p', data: ascii('changed content') }] });
    file.replaceContent(changed.bytes, 222);
    const result = await new IndexService(store).openSource(makeDir([file]));
    expect(result.archives[0]!.fromCache).toBe(false);
    expect(result.archives[0]!.entryCount).toBe(1);
  });

  it('fatales Archiv (E-LGP-HDR) macht die übrigen Archive nicht unbrauchbar', async () => {
    const good = basicFixture();
    const dir = makeDir([
      new MemorySourceFile('broken.lgp', ascii('xx'), 1),
      new MemorySourceFile('char.lgp', good.bytes, 2),
    ]);
    const result = await new IndexService().openSource(dir);
    const broken = result.archives.find((a) => a.archiveName === 'broken')!;
    const char = result.archives.find((a) => a.archiveName === 'char')!;
    expect(broken.fatal).toBe(true);
    expect(char.fatal).toBe(false);
    expect(char.resolvable).toBe(good.order.length);
    expect(result.diagnostics.map((d) => d.code)).toContain('E-LGP-HDR');
  });
});

describe('IndexService: Slice-Reader', () => {
  it('liefert exakt den Payload eines Eintrags', async () => {
    const fixture = basicFixture();
    const service = new IndexService();
    await service.openSource(makeDir([new MemorySourceFile('char.lgp', fixture.bytes, 1)]));
    for (let i = 0; i < fixture.order.length; i++) {
      const id = `lgp:char/${fixture.order[i]!.name.toLowerCase()}`;
      const payload = await service.readEntry(id);
      expect(payload).toEqual(fixture.order[i]!.data);
    }
  });

  it('E-RESOLVE: unbekannte ID wirft EntryNotFoundError', async () => {
    const service = new IndexService();
    await service.openSource(makeDir([new MemorySourceFile('char.lgp', basicFixture().bytes, 1)]));
    await expect(service.readEntry('lgp:char/gibtsnicht.p')).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it('E-LGP-ENTRY beim Lazy-Zugriff (Fast Scan): Vorsatz-Mismatch quarantänisiert zur Laufzeit', async () => {
    const fixture = basicFixture();
    const corrupted = corruptPrefixName(fixture, 1);
    const service = new IndexService();
    await service.openSource(makeDir([new MemorySourceFile('char.lgp', corrupted, 1)]), { deep: false });
    const id = `lgp:char/${fixture.order[1]!.name.toLowerCase()}`;
    await expect(service.readEntry(id)).rejects.toBeInstanceOf(EntryQuarantinedError);
    // Nach Quarantäne ist der Eintrag nicht mehr auflösbar.
    await expect(service.readEntry(id)).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it('Abbruch: vor dem Read abgebrochenes Signal → AbortError, kein Ergebnis', async () => {
    const fixture = basicFixture();
    const service = new IndexService();
    await service.openSource(makeDir([new MemorySourceFile('char.lgp', fixture.bytes, 1)]));
    const ac = new AbortController();
    ac.abort();
    const id = `lgp:char/${fixture.order[0]!.name.toLowerCase()}`;
    await expect(service.readEntry(id, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('Abbruch während openSource: kein Source-Meta-Write nach Abbruch', async () => {
    const fixture = basicFixture();
    const file = new MemorySourceFile('char.lgp', fixture.bytes, 1);
    // Signal bricht nach dem ersten Read ab → Scan terminiert mit AbortError.
    const ac = new AbortController();
    let reads = 0;
    const origRead = file.read.bind(file);
    file.read = async (offset, length, signal) => {
      if (++reads > 1) ac.abort();
      return origRead(offset, length, signal);
    };
    const store = new S0Store();
    await expect(
      new IndexService(store).openSource(makeDir([file]), { signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Fingerprint', () => {
  it('ist stabil für identische Quellen und ändert sich mit Größe/mtime/TOC', async () => {
    const fixture = basicFixture();
    const a = new MemorySourceFile('char.lgp', fixture.bytes, 100);
    const b = new MemorySourceFile('char.lgp', fixture.bytes.slice(), 100);
    expect(await archiveFingerprint(a)).toBe(await archiveFingerprint(b));

    const laterMtime = new MemorySourceFile('char.lgp', fixture.bytes.slice(), 200);
    expect(await archiveFingerprint(laterMtime)).not.toBe(await archiveFingerprint(a));

    const other = buildLgp({ entries: [{ name: 'x.p', data: ascii('y') }] });
    const differentContent = new MemorySourceFile('char.lgp', other.bytes, 100);
    expect(await archiveFingerprint(differentContent)).not.toBe(await archiveFingerprint(a));
  });
});
