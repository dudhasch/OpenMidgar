/**
 * Paketierung & Provenienz (A-ST-3, B.7): Doppellauf-Digest
 * (Determinismus), ZIP-Lesbarkeit mit Integritäts-Hashes, vollständiges
 * Paket-Audit und die Import-Schleuse gegen Originalbytes.
 */

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { utf8Bytes, utf8Decode } from '@webmidgar/studio-core';
import { compileProject, pruefeAssetImport, sha256Hex, type ManifestV2 } from './index.js';
import { fixtureAssets, fixtureProject, LINA_TEX_BYTES } from './test-helpers.js';

describe('.wmmod-Paketierung (A-ST-3)', () => {
  it('Doppellauf erzeugt ein byteidentisches Paket (Digest-Vergleich)', async () => {
    const [p1, p2] = [await fixtureProject(), await fixtureProject()];
    const r1 = await compileProject(p1, { assets: fixtureAssets() });
    const r2 = await compileProject(p2, { assets: fixtureAssets() });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const d1 = await sha256Hex(r1.paket!);
    const d2 = await sha256Hex(r2.paket!);
    expect(d1).toBe(d2);
    expect(Buffer.from(r1.paket!).equals(Buffer.from(r2.paket!))).toBe(true);
  });

  it('ZIP ist lesbar: manifest.json + content, Hashes stimmen mit integrity überein', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    const entpackt = unzipSync(result.paket!);
    const pfade = Object.keys(entpackt).sort();
    expect(pfade).toEqual(['content/assets/lina_tex.png', 'manifest.json']);

    // manifest.json im ZIP == Manifest des Ergebnisses.
    const manifest = JSON.parse(utf8Decode(entpackt['manifest.json']!)) as ManifestV2;
    expect(manifest.manifestVersion).toBe('2.0.0');
    expect(manifest.id).toBe(result.manifest!.id);
    expect(manifest.capabilities).toEqual(result.manifest!.capabilities);

    // Inhaltsdatei stimmt byteweise und per integrity-Hash.
    expect(Buffer.from(entpackt['content/assets/lina_tex.png']!).equals(Buffer.from(LINA_TEX_BYTES))).toBe(true);
    const integrity = manifest.integrity;
    expect(integrity.algo).toBe('sha256');
    for (const [pfad, hash] of Object.entries(integrity.hashes)) {
      expect(entpackt[pfad]).toBeDefined();
      expect(await sha256Hex(entpackt[pfad]!)).toBe(hash);
    }
    // integrity deckt alle content/-Dateien ab.
    expect(Object.keys(integrity.hashes).sort()).toEqual(pfade.filter((p) => p !== 'manifest.json'));
  });

  it('Paket-Audit ist vollständig: jede Paketdatei mit Herkunft, Bytes, SHA-256 (B.7)', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    const entpackt = unzipSync(result.paket!);
    expect(result.audit.map((a) => a.pfad).sort()).toEqual(Object.keys(entpackt).sort());
    for (const eintrag of result.audit) {
      const bytes = entpackt[eintrag.pfad]!;
      expect(eintrag.bytes).toBe(bytes.byteLength);
      expect(eintrag.sha256).toBe(await sha256Hex(bytes));
      if (eintrag.pfad === 'manifest.json') {
        expect(eintrag.herkunft).toBe('generated');
      } else {
        expect(eintrag.herkunft).toBe('user-asset');
      }
    }
  });

  it('feste ZIP-Zeitstempel: DOS-Epoch in allen Einträgen', async () => {
    const result = await compileProject(await fixtureProject(), { assets: fixtureAssets() });
    const paket = result.paket!;
    // Lokale Datei-Header: DOS-Zeit/Datum an Offset 10..13 je Eintrag.
    let gefunden = 0;
    for (let i = 0; i + 4 <= paket.length; i++) {
      if (paket[i] === 0x50 && paket[i + 1] === 0x4b && paket[i + 2] === 0x03 && paket[i + 3] === 0x04) {
        const dosZeit = paket[i + 10]! | (paket[i + 11]! << 8);
        const dosDatum = paket[i + 12]! | (paket[i + 13]! << 8);
        expect(dosZeit).toBe(0); // 00:00:00
        expect(dosDatum).toBe((1 << 5) | 1); // 1980-01-01
        gefunden += 1;
      }
    }
    expect(gefunden).toBeGreaterThan(0);
  });
});

describe('Provenienz-Schleuse (B.7, ADR-017)', () => {
  it('verweigert byteidentische Originalimporte mit Erklärtext (Fixture-Hash)', async () => {
    const originalBytes = utf8Bytes('FIXTURE-ORIGINAL asset-bytes');
    const originalHash = await sha256Hex(originalBytes);
    const bekannte = new Set([originalHash]);

    const ergebnis = await pruefeAssetImport(originalBytes, bekannte);
    expect(ergebnis.erlaubt).toBe(false);
    expect(ergebnis.sha256).toBe(originalHash);
    expect(ergebnis.meldung).toContain('byteidentisch');
    expect(ergebnis.meldung).toContain('lgp:');
  });

  it('lässt eigenständige Nutzerassets passieren', async () => {
    const bekannte = new Set([await sha256Hex(utf8Bytes('FIXTURE-ORIGINAL'))]);
    const ergebnis = await pruefeAssetImport(LINA_TEX_BYTES, bekannte);
    expect(ergebnis.erlaubt).toBe(true);
    expect(ergebnis.meldung).toBeUndefined();
    expect(ergebnis.sha256).toBe(await sha256Hex(LINA_TEX_BYTES));
  });
});
