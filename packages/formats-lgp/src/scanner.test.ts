import { describe, expect, it } from 'vitest';
import {
  basicFixture,
  conflictFixture,
  corruptConflictCount,
  corruptCreator,
  corruptFileCount,
  corruptLookup,
  corruptOverlap,
  corruptPrefixLength,
  corruptPrefixName,
  corruptTocOffset,
  duplicateTocName,
  duplicateTocRecord,
  omitConflictFieldFixture,
  setTocCheckByte,
  setTocConflictIndex,
  unterminatedFixture,
  weirdNameFixture,
} from '@webmidgar/fixture-gen';
import {
  CHECK_BYTE_HRC,
  CHECK_BYTE_PLAIN,
  expectedCheckByte,
  MemoryByteSource,
  resolvableEntries,
  scanLgp,
} from './index.js';

const scan = (bytes: Uint8Array, mode: 'fast' | 'deep' = 'deep') =>
  scanLgp(new MemoryByteSource(bytes), 'test', { mode });

/** Zweiter Einstieg mit eingeschalteter Check-Code-Prüfung (O5, opt-in). */
const scanMitCheck = (bytes: Uint8Array) =>
  scanLgp(new MemoryByteSource(bytes), 'test', { mode: 'deep', validateCheckByte: true });

describe('LGP-Scanner: Golden Roundtrip', () => {
  it('reproduziert alle Einträge des Writers bitkorrekt (Namen, Offsets, Längen)', async () => {
    const fixture = basicFixture();
    const result = await scan(fixture.bytes);
    expect(result.ok).toBe(true);
    const archive = result.archive!;
    expect(archive.entryCount).toBe(fixture.order.length);
    expect(archive.terminatorOk).toBe(true);
    expect(archive.lookupReproducible).toBe(true);
    expect(archive.diagnostics).toHaveLength(0);

    for (let i = 0; i < fixture.order.length; i++) {
      const spec = fixture.order[i]!;
      const entry = archive.entries[i]!;
      expect(entry.name).toBe(spec.name.toLowerCase());
      expect(entry.canonicalId).toBe(`lgp:test/${spec.name.toLowerCase()}`);
      expect(entry.offset).toBe(fixture.entryOffsets[i]);
      expect(entry.length).toBe(spec.data.length);
      expect(entry.quarantined).toBeUndefined();
    }
  });

  it('liest Payloads über die indexierten Slices korrekt', async () => {
    const fixture = basicFixture();
    const source = new MemoryByteSource(fixture.bytes);
    const archive = (await scanLgp(source, 'test', { mode: 'deep' })).archive!;
    for (let i = 0; i < fixture.order.length; i++) {
      const entry = archive.entries[i]!;
      const payload = await source.read(entry.dataOffset!, entry.length!);
      expect(payload).toEqual(fixture.order[i]!.data);
    }
  });

  it('parst Konfliktgruppen mit Diskriminator und Quellordner', async () => {
    const result = await scan(conflictFixture().bytes);
    const entries = result.archive!.entries;
    const shared = entries.filter((e) => e.name === 'shared.tex');
    expect(shared).toHaveLength(2);
    const ids = shared.map((e) => e.canonicalId).sort();
    expect(ids).toEqual(['lgp:test/shared.tex#c1', 'lgp:test/shared.tex#c2']);
    const dirs = shared.map((e) => e.conflictDir).sort();
    expect(dirs).toEqual(['dir_a', 'dir_b']);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('akzeptiert Archive ohne Konfliktfeld (Daten direkt nach Lookup)', async () => {
    const result = await scan(omitConflictFieldFixture().bytes);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(resolvableEntries(result.archive!)).toHaveLength(1);
  });
});

describe('LGP-Scanner: Fehlerklassen der Validierungsmatrix', () => {
  it('E-LGP-HDR (fatal): nicht-druckbarer Creator', async () => {
    const result = await scan(corruptCreator(basicFixture()));
    expect(result.ok).toBe(false);
    expect(result.archive).toBeUndefined();
    expect(result.diagnostics[0]!.code).toBe('E-LGP-HDR');
    expect(result.diagnostics[0]!.severity).toBe('fatal');
  });

  it('E-LGP-HDR (fatal): Dateianzahl 0 und unplausibel groß', async () => {
    for (const count of [0, 0x7fffffff]) {
      const result = await scan(corruptFileCount(basicFixture(), count));
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]!.code).toBe('E-LGP-HDR');
    }
  });

  it('E-LGP-TOC: Offset außerhalb der Datei → nur dieser Eintrag quarantänisiert', async () => {
    const fixture = basicFixture();
    const result = await scan(corruptTocOffset(fixture, 2, fixture.bytes.length + 1000));
    expect(result.ok).toBe(true);
    const archive = result.archive!;
    expect(archive.entries[2]!.quarantined).toBe(true);
    expect(archive.entries[2]!.quarantineCode).toBe('E-LGP-TOC');
    expect(resolvableEntries(archive)).toHaveLength(fixture.order.length - 1);
    expect(result.diagnostics.map((d) => d.code)).toContain('E-LGP-TOC');
  });

  it('E-LGP-ENTRY: Vorsatzname-Mismatch → Quarantäne im Deep Scan', async () => {
    const result = await scan(corruptPrefixName(basicFixture(), 1));
    const archive = result.archive!;
    expect(archive.entries[1]!.quarantined).toBe(true);
    expect(archive.entries[1]!.quarantineCode).toBe('E-LGP-ENTRY');
    expect(result.diagnostics.map((d) => d.code)).toContain('E-LGP-ENTRY');
  });

  it('E-LGP-ENTRY: Payload-Länge über Dateiende → Quarantäne', async () => {
    const result = await scan(corruptPrefixLength(basicFixture(), 0));
    expect(result.archive!.entries[0]!.quarantineCode).toBe('E-LGP-ENTRY');
  });

  it('W-LGP-OVERLAP: überlappende Datenbereiche → Warnung, beide nutzbar', async () => {
    const result = await scan(corruptOverlap(basicFixture(), 0, 1));
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('W-LGP-OVERLAP');
    expect(result.archive!.entries[0]!.quarantined).toBeUndefined();
    expect(result.archive!.entries[1]!.quarantined).toBeUndefined();
  });

  it('W-LGP-TERM: fehlender Terminator ist nur Diagnose', async () => {
    const result = await scan(unterminatedFixture().bytes);
    expect(result.ok).toBe(true);
    expect(result.archive!.terminatorOk).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('W-LGP-TERM');
    expect(resolvableEntries(result.archive!)).toHaveLength(1);
  });

  it('W-LGP-LOOKUP: manipulierte Lookup-Tabelle → Warnung, Index bleibt maßgeblich', async () => {
    const result = await scan(corruptLookup(basicFixture()));
    expect(result.archive!.lookupReproducible).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('W-LGP-LOOKUP');
    expect(resolvableEntries(result.archive!).length).toBeGreaterThan(0);
  });

  it('W-LGP-CONFLICTTBL: unplausibler Gruppenzähler → Warnung, Einträge nutzbar', async () => {
    const fixture = basicFixture();
    const result = await scan(corruptConflictCount(fixture, 60000));
    expect(result.diagnostics.map((d) => d.code)).toContain('W-LGP-CONFLICTTBL');
    expect(resolvableEntries(result.archive!)).toHaveLength(fixture.order.length);
  });

  it('W-LGP-CONFLICTTBL: Conflict-Index im TOC ohne Platz für Tabelle → Warnung', async () => {
    const result = await scan(setTocConflictIndex(omitConflictFieldFixture(), 0, 1));
    expect(result.diagnostics.map((d) => d.code)).toContain('W-LGP-CONFLICTTBL');
  });

  it('W-LGP-NAME: nicht-kanonische Zeichen werden bereinigt', async () => {
    const result = await scan(weirdNameFixture().bytes);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('W-LGP-NAME');
    const names = result.archive!.entries.map((e) => e.name);
    expect(names).toContain('upper_case_.tex');
  });
});

describe('LGP-Scanner: Duplikatauflösung', () => {
  it('W-LGP-DUP-TOC: Name+Offset doppelt → Redundanz verworfen', async () => {
    const result = await scan(duplicateTocRecord(basicFixture(), 0, 1));
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('W-LGP-DUP-TOC');
    const usable = resolvableEntries(result.archive!);
    expect(usable.filter((e) => e.name === result.archive!.entries[0]!.name)).toHaveLength(1);
  });

  it('W-LGP-SHADOWED: gleicher Name, anderer Offset → letzter gewinnt', async () => {
    const fixture = basicFixture();
    const result = await scan(duplicateTocName(fixture, 0, 1));
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('W-LGP-SHADOWED');
    const archive = result.archive!;
    expect(archive.entries[0]!.shadowed).toBe(true);
    const winner = resolvableEntries(archive).find((e) => e.name === archive.entries[0]!.name)!;
    expect(winner.tocIndex).toBe(1);
    expect(winner.offset).toBe(fixture.entryOffsets[1]);
  });
});

/**
 * O5 — der Check-Code im TOC. Beide Community-Hypothesen (Prüfwert,
 * Ordnungshinweis) sind über den vollen Archivbestand gemessen und
 * durchgefallen; getragen hat allein die Eintragsart (0x0B genau auf `.hrc`).
 * Die Prüfung ist deshalb **opt-in und warnend** — sie darf keinen Import
 * scheitern lassen. Herleitung: [check-byte.ts](check-byte.ts).
 */
describe('LGP-Scanner: Check-Code (O5, opt-in)', () => {
  it('Writer und Scanner stimmen unabhängig überein — kein Befund im Roundtrip', async () => {
    const result = await scanMitCheck(basicFixture().bytes);
    expect(result.diagnostics).toHaveLength(0);
    for (const e of result.archive!.entries) {
      expect(e.checkByte).toBe(expectedCheckByte(e.name));
    }
    // Das Fixture deckt beide belegten Werte ab, sonst prüft der Test nur einen Zweig.
    const werte = new Set(result.archive!.entries.map((e) => e.checkByte));
    expect([...werte].sort((a, b) => a - b)).toEqual([CHECK_BYTE_HRC, CHECK_BYTE_PLAIN]);
  });

  it('ist standardmäßig AUS: dieselbe Abweichung bleibt ohne Option stumm', async () => {
    // tocIndex 0 ist `aaaa.hrc` (Bucket-Sortierung des Writers).
    const defekt = setTocCheckByte(basicFixture(), 0, CHECK_BYTE_PLAIN);
    const ohne = await scan(defekt);
    expect(ohne.diagnostics.map((d) => d.code)).not.toContain('W-LGP-CHECKBYTE');
    const mit = await scanMitCheck(defekt);
    expect(mit.diagnostics.map((d) => d.code)).toContain('W-LGP-CHECKBYTE');
  });

  it('W-LGP-CHECKBYTE: bekannter Wert, falsche Eintragsart → Warnung, Eintrag nutzbar', async () => {
    const result = await scanMitCheck(setTocCheckByte(basicFixture(), 0, CHECK_BYTE_PLAIN));
    const befund = result.diagnostics.filter((d) => d.code === 'W-LGP-CHECKBYTE');
    expect(befund).toHaveLength(1);
    expect(befund[0]!.severity).toBe('warning');
    expect(befund[0]!.tocIndex).toBe(0);
    expect(befund[0]!.detail).toContain('Eintragsart');
    // Warnend heißt: nichts wird quarantänisiert, alle Einträge bleiben auflösbar.
    expect(result.ok).toBe(true);
    expect(resolvableEntries(result.archive!)).toHaveLength(basicFixture().order.length);
  });

  it('W-LGP-CHECKBYTE: im Bestand unbelegter Wert wird gesondert benannt', async () => {
    const result = await scanMitCheck(setTocCheckByte(basicFixture(), 1, 0x42));
    const befund = result.diagnostics.filter((d) => d.code === 'W-LGP-CHECKBYTE');
    expect(befund).toHaveLength(1);
    expect(befund[0]!.detail).toContain('0x42');
    expect(befund[0]!.detail).toContain('nicht belegt');
    expect(result.archive!.entries[1]!.quarantined).toBeUndefined();
  });

  it('`.hrc` erwartet 0x0B, alles andere 0x0E — die Regel selbst, ohne Archiv', () => {
    expect(expectedCheckByte('aaaa.hrc')).toBe(CHECK_BYTE_HRC);
    expect(expectedCheckByte('aaaa.rsd')).toBe(CHECK_BYTE_PLAIN);
    expect(expectedCheckByte('abcd')).toBe(CHECK_BYTE_PLAIN);
    // Keine Teiltreffer: die Endung muss am Ende stehen.
    expect(expectedCheckByte('hrc.tex')).toBe(CHECK_BYTE_PLAIN);
  });
});

describe('LGP-Scanner: Abbruch', () => {
  it('bricht kooperativ über AbortSignal ab', async () => {
    const fixture = basicFixture();
    const ac = new AbortController();
    ac.abort();
    await expect(
      scanLgp(new MemoryByteSource(fixture.bytes), 'test', { mode: 'deep', signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
