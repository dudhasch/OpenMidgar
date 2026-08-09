import { describe, expect, it } from 'vitest';
import {
  MVP_CAPABILITIES,
  unsupportedCapabilities,
  validateManifest,
  type ModDiagnostic,
  type ModManifest,
  type ModOverride,
} from './manifest.js';
import { isFailure, modCacheKey, ModResolver, type ActiveMod, type ResolverSources } from './resolver.js';

// ---------------------------------------------------------------------------
// Hilfsbausteine
// ---------------------------------------------------------------------------

/** Deterministischer 64-stelliger Hex-String — kein Math.random. */
function fakeHash(seed: number): string {
  return seed.toString(16).padStart(64, '0');
}

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function validOverride(overrides?: Partial<ModOverride>): ModOverride {
  return {
    target: 'lgp:flevel/md1stin',
    file: 'textures/md1stin.png',
    assetHash: fakeHash(1),
    capability: 'texture-override',
    ...overrides,
  };
}

function validManifest(overrides?: Partial<ModManifest>): ModManifest {
  return {
    schemaVersion: 2,
    modId: 'test-mod',
    modVersion: '1.0.0',
    name: 'Test Mod',
    engineCompatVersion: '1.0.0',
    capabilities: ['texture-override'],
    overrides: [validOverride()],
    ...overrides,
  };
}

function findDiagnostic(diagnostics: ModDiagnostic[], field: string): ModDiagnostic {
  const d = diagnostics.find((x) => x.field === field);
  expect(d, `Diagnose für Feld "${field}" erwartet, gefunden: ${JSON.stringify(diagnostics)}`).toBeDefined();
  return d!;
}

// ---------------------------------------------------------------------------
// Teil B.1-B.4 — Manifest-Validierung
// ---------------------------------------------------------------------------

describe('validateManifest — gültiges Manifest', () => {
  it('wird ohne Diagnosen angenommen', () => {
    const result = validateManifest(validManifest());
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).not.toBeNull();
  });
});

describe('validateManifest — jede Regel einzeln verletzt', () => {
  it('kein Objekt ⇒ E-MOD-SCHEMA auf $', () => {
    const result = validateManifest('nicht-einmal-ein-objekt');
    const d = findDiagnostic(result.diagnostics, '$');
    expect(d.code).toBe('E-MOD-SCHEMA');
    expect(result.manifest).toBeNull();
  });

  it('falsche schemaVersion ⇒ E-MOD-SCHEMA auf schemaVersion', () => {
    const result = validateManifest(validManifest({ schemaVersion: 1 as unknown as 2 }));
    const d = findDiagnostic(result.diagnostics, 'schemaVersion');
    expect(d.code).toBe('E-MOD-SCHEMA');
  });

  it('ungültige modId ⇒ E-MOD-FIELD auf modId', () => {
    const result = validateManifest(validManifest({ modId: 'X' }));
    const d = findDiagnostic(result.diagnostics, 'modId');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('fehlende modId ⇒ E-MOD-FIELD auf modId', () => {
    const raw = validManifest() as unknown as Record<string, unknown>;
    delete raw.modId;
    const result = validateManifest(raw);
    const d = findDiagnostic(result.diagnostics, 'modId');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('ungültige modVersion ⇒ E-MOD-FIELD auf modVersion', () => {
    const result = validateManifest(validManifest({ modVersion: '1.0' }));
    const d = findDiagnostic(result.diagnostics, 'modVersion');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('ungültige engineCompatVersion ⇒ E-MOD-FIELD auf engineCompatVersion', () => {
    const result = validateManifest(validManifest({ engineCompatVersion: 'aktuell' }));
    const d = findDiagnostic(result.diagnostics, 'engineCompatVersion');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('leerer name ⇒ E-MOD-FIELD auf name', () => {
    const result = validateManifest(validManifest({ name: '   ' }));
    const d = findDiagnostic(result.diagnostics, 'name');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('capabilities keine Liste ⇒ E-MOD-FIELD auf capabilities', () => {
    const result = validateManifest(validManifest({ capabilities: 'texture-override' as unknown as [] }));
    const d = findDiagnostic(result.diagnostics, 'capabilities');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('unbekannte Capability in capabilities ⇒ E-MOD-CAPABILITY auf capabilities[0]', () => {
    const result = validateManifest(
      validManifest({ capabilities: ['fliegen-koennen'] as unknown as ModManifest['capabilities'] }),
    );
    const d = findDiagnostic(result.diagnostics, 'capabilities[0]');
    expect(d.code).toBe('E-MOD-CAPABILITY');
  });

  it('overrides keine Liste ⇒ E-MOD-FIELD auf overrides', () => {
    const result = validateManifest(validManifest({ overrides: {} as unknown as ModOverride[] }));
    const d = findDiagnostic(result.diagnostics, 'overrides');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('Override kein Objekt ⇒ E-MOD-SCHEMA auf overrides[0]', () => {
    const result = validateManifest(
      validManifest({ overrides: ['nicht-einmal-ein-objekt'] as unknown as ModOverride[] }),
    );
    const d = findDiagnostic(result.diagnostics, 'overrides[0]');
    expect(d.code).toBe('E-MOD-SCHEMA');
  });

  it('ungültiges target ⇒ E-MOD-FIELD auf overrides[0].target', () => {
    const result = validateManifest(validManifest({ overrides: [validOverride({ target: 'kein gueltiges ziel' })] }));
    const d = findDiagnostic(result.diagnostics, 'overrides[0].target');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('doppeltes target im selben Mod ⇒ E-MOD-DUPLICATE auf overrides[1].target', () => {
    const dup = validOverride({ target: 'lgp:flevel/md1stin', assetHash: fakeHash(2) });
    const result = validateManifest(validManifest({ overrides: [validOverride(), dup] }));
    const d = findDiagnostic(result.diagnostics, 'overrides[1].target');
    expect(d.code).toBe('E-MOD-DUPLICATE');
  });

  it('file mit ".." ⇒ E-MOD-FIELD auf overrides[0].file', () => {
    const result = validateManifest(validManifest({ overrides: [validOverride({ file: '../../evil.png' })] }));
    const d = findDiagnostic(result.diagnostics, 'overrides[0].file');
    expect(d.code).toBe('E-MOD-FIELD');
  });

  it('ungültiger assetHash ⇒ E-MOD-HASH auf overrides[0].assetHash', () => {
    const result = validateManifest(validManifest({ overrides: [validOverride({ assetHash: 'kein-hash' })] }));
    const d = findDiagnostic(result.diagnostics, 'overrides[0].assetHash');
    expect(d.code).toBe('E-MOD-HASH');
  });

  it('Capability im Override nicht angemeldet ⇒ E-MOD-CAPABILITY auf overrides[0].capability', () => {
    const result = validateManifest(
      validManifest({
        capabilities: ['background-override'],
        overrides: [validOverride({ capability: 'texture-override' })],
      }),
    );
    const d = findDiagnostic(result.diagnostics, 'overrides[0].capability');
    expect(d.code).toBe('E-MOD-CAPABILITY');
  });
});

describe('validateManifest — mehrere Mängel gleichzeitig', () => {
  it('liefert alle Diagnosen auf einmal, nicht nur die erste', () => {
    const raw = validManifest({
      modId: 'X',
      name: '',
      overrides: [validOverride({ file: '../evil.png' })],
    });
    const result = validateManifest(raw);
    expect(result.diagnostics.length).toBeGreaterThan(1);
    const fields = result.diagnostics.map((d) => d.field);
    expect(fields).toContain('modId');
    expect(fields).toContain('name');
    expect(fields).toContain('overrides[0].file');
    expect(result.manifest).toBeNull();
  });
});

describe('unsupportedCapabilities', () => {
  it('meldet die schema-bekannten, aber im MVP nicht ausgeführten Capabilities', () => {
    const manifest = validManifest({
      capabilities: ['texture-override', 'background-override', 'model-override', 'entity-add'],
    });
    const unsupported = unsupportedCapabilities(manifest);
    expect(unsupported).toEqual(['model-override', 'entity-add']);
    // Gegenprobe: Die MVP-Capabilities selbst gelten nicht als "nicht unterstützt".
    for (const c of MVP_CAPABILITIES) expect(unsupported).not.toContain(c);
  });
});

// ---------------------------------------------------------------------------
// Teil B.5-B.11 — ModResolver
// ---------------------------------------------------------------------------

const TARGET = 'lgp:flevel/md1stin';

function activeMod(
  modOverrides: Partial<{ manifest: Partial<ModManifest>; read: ActiveMod['read'] }> = {},
): ActiveMod {
  const manifest = validManifest(modOverrides.manifest);
  return {
    manifest,
    read: modOverrides.read ?? (async (ov) => bytesOf(`mod-daten:${manifest.modId}:${ov.target}`)),
  };
}

describe('ModResolver — Auflösungskette', () => {
  it('Stufe 1: Sitzungs-Override schlägt Mod, Cache, Original und Fallback', async () => {
    const sources: ResolverSources = {
      session: async () => bytesOf('sitzung'),
      cache: { get: async () => bytesOf('cache-treffer'), put: async () => {} },
      original: async () => bytesOf('original'),
      fallback: async () => bytesOf('fallback'),
    };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([activeMod()]);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.origin).toBe('session');
      expect(new TextDecoder().decode(result.data)).toBe('sitzung');
    }
  });

  it('Stufe 2: ohne Sitzung gewinnt das erste Mod der Load-Order', async () => {
    const sources: ResolverSources = { original: async () => bytesOf('original') };
    const resolver = new ModResolver(sources);
    const first = activeMod({ manifest: { modId: 'erstes-mod' }, read: async () => bytesOf('vom-ersten-mod') });
    const second = activeMod({ manifest: { modId: 'zweites-mod' }, read: async () => bytesOf('vom-zweiten-mod') });
    resolver.setActiveMods([first, second]);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.origin).toBe('mod');
      expect(result.modId).toBe('erstes-mod');
    }
  });

  it('Stufe 3: bei gefülltem Cache kommt mod-cache statt mod (read wird nicht aufgerufen)', async () => {
    const mod = activeMod({
      read: async () => {
        throw new Error('sollte bei Cache-Treffer nicht aufgerufen werden');
      },
    });
    const key = modCacheKey(mod.manifest, mod.manifest.overrides[0]!);
    const cacheMap = new Map<string, Uint8Array>([[key, bytesOf('aus-dem-cache')]]);
    const sources: ResolverSources = {
      cache: {
        get: async (k) => cacheMap.get(k) ?? null,
        put: async (k, d) => {
          cacheMap.set(k, d);
        },
      },
      original: async () => bytesOf('original'),
    };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([mod]);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.origin).toBe('mod-cache');
      expect(new TextDecoder().decode(result.data)).toBe('aus-dem-cache');
    }
  });

  it('Stufe 4: ohne Mod-Treffer kommt original', async () => {
    const sources: ResolverSources = { original: async () => bytesOf('original-daten') };
    const resolver = new ModResolver(sources);
    // Mod ist aktiv, hat aber keinen Override für dieses Ziel.
    resolver.setActiveMods([activeMod({ manifest: { overrides: [validOverride({ target: 'lgp:anderes/ziel' })] } })]);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.origin).toBe('original');
      expect(new TextDecoder().decode(result.data)).toBe('original-daten');
    }
  });

  it('Stufe 5: ohne Original kommt fallback', async () => {
    const sources: ResolverSources = {
      original: async () => null,
      fallback: async () => bytesOf('fallback-daten'),
    };
    const resolver = new ModResolver(sources);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.origin).toBe('fallback');
      expect(new TextDecoder().decode(result.data)).toBe('fallback-daten');
    }
  });

  it('ohne jeden Treffer: ResolutionFailure mit attempted-Liste', async () => {
    const sources: ResolverSources = {
      original: async () => null,
      fallback: async () => null,
    };
    const resolver = new ModResolver(sources);
    const result = await resolver.resolve(TARGET);
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.attempted).toEqual(['original', 'fallback']);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('ModResolver — Load-Order und Konflikte', () => {
  it('bestimmt den Gewinner über die Reihenfolge und meldet den Konflikt', async () => {
    const sources: ResolverSources = { original: async () => bytesOf('original') };
    const modA = activeMod({ manifest: { modId: 'mod-a' }, read: async () => bytesOf('von-a') });
    const modB = activeMod({ manifest: { modId: 'mod-b' }, read: async () => bytesOf('von-b') });

    const resolverAB = new ModResolver(sources);
    const { conflicts: conflictsAB } = resolverAB.setActiveMods([modA, modB]);
    expect(conflictsAB).toEqual([{ target: TARGET, winner: 'mod-a', loser: 'mod-b' }]);
    const resultAB = await resolverAB.resolve(TARGET);
    expect(!isFailure(resultAB) && resultAB.modId).toBe('mod-a');

    const resolverBA = new ModResolver(sources);
    const { conflicts: conflictsBA } = resolverBA.setActiveMods([modB, modA]);
    expect(conflictsBA).toEqual([{ target: TARGET, winner: 'mod-b', loser: 'mod-a' }]);
    const resultBA = await resolverBA.resolve(TARGET);
    expect(!isFailure(resultBA) && resultBA.modId).toBe('mod-b');
  });
});

describe('ModResolver — Cache-Zählung', () => {
  it('zählt den ersten Zugriff als Miss und den zweiten als Hit', async () => {
    const cacheMap = new Map<string, Uint8Array>();
    const sources: ResolverSources = {
      cache: {
        get: async (k) => cacheMap.get(k) ?? null,
        put: async (k, d) => {
          cacheMap.set(k, d);
        },
      },
      original: async () => bytesOf('original'),
    };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([activeMod()]);

    await resolver.resolve(TARGET);
    expect(resolver.stats.cacheMisses).toBe(1);
    expect(resolver.stats.cacheHits).toBe(0);

    await resolver.resolve(TARGET);
    expect(resolver.stats.cacheHits).toBe(1);
    expect(resolver.stats.cacheMisses).toBe(1);
  });
});

describe('ModResolver — Cache-Schlüssel', () => {
  it('ändert sich mit dem assetHash und führt bei einem Mod-Update zu einem Miss', async () => {
    const overrideV1 = validOverride({ assetHash: fakeHash(1) });
    const overrideV2 = validOverride({ assetHash: fakeHash(2) });
    const manifest = validManifest({ overrides: [overrideV1] });

    const keyV1 = modCacheKey(manifest, overrideV1);
    const keyV2 = modCacheKey(manifest, overrideV2);
    expect(keyV1).not.toBe(keyV2);

    const cacheMap = new Map<string, Uint8Array>([[keyV1, bytesOf('alte-version')]]);
    const sources: ResolverSources = {
      cache: {
        get: async (k) => cacheMap.get(k) ?? null,
        put: async (k, d) => {
          cacheMap.set(k, d);
        },
      },
      original: async () => bytesOf('original'),
    };
    const resolver = new ModResolver(sources);
    // Mod-Update: gleiche modId/modVersion, aber neuer assetHash ⇒ neuer Schlüssel ⇒ Miss.
    resolver.setActiveMods([{ manifest: validManifest({ overrides: [overrideV2] }), read: async () => bytesOf('neue-version') }]);
    const result = await resolver.resolve(TARGET);
    expect(resolver.stats.cacheMisses).toBe(1);
    expect(!isFailure(result) && new TextDecoder().decode(result.data)).toBe('neue-version');
  });
});

describe('ModResolver — Fehlerisolation', () => {
  it('übergeht ein defektes Asset, lässt aber andere Assets desselben Mods unberührt', async () => {
    const targetOk = 'lgp:flevel/mds7pre';
    const overrideBroken = validOverride({ target: TARGET, assetHash: fakeHash(1) });
    const overrideOk = validOverride({ target: targetOk, assetHash: fakeHash(2) });
    const manifest = validManifest({ overrides: [overrideBroken, overrideOk] });

    const mod: ActiveMod = {
      manifest,
      read: async (ov) => {
        if (ov.target === TARGET) throw new Error('defekte Datei');
        return bytesOf('funktioniert');
      },
    };
    const sources: ResolverSources = { original: async (t) => bytesOf(`original:${t}`) };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([mod]);

    const broken = await resolver.resolve(TARGET);
    expect(!isFailure(broken) && broken.origin).toBe('original');
    expect(resolver.stats.degraded).toBe(1);

    const ok = await resolver.resolve(targetOk);
    expect(!isFailure(ok) && ok.origin).toBe('mod');
    expect(resolver.stats.degraded).toBe(1); // unverändert
  });

  it('übergeht ein Asset auch, wenn read() null statt zu werfen liefert', async () => {
    const mod: ActiveMod = { manifest: validManifest(), read: async () => null };
    const sources: ResolverSources = { original: async () => bytesOf('original') };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([mod]);
    const result = await resolver.resolve(TARGET);
    expect(!isFailure(result) && result.origin).toBe('original');
    expect(resolver.stats.degraded).toBe(1);
  });
});

describe('ModResolver — nicht unterstützte Capability', () => {
  it('übergeht einen Override mit model-override (nicht in MVP_CAPABILITIES) und liefert das Original', async () => {
    const override = validOverride({ capability: 'model-override' });
    const manifest = validManifest({ capabilities: ['model-override'], overrides: [override] });
    const mod: ActiveMod = {
      manifest,
      read: async () => {
        throw new Error('sollte für nicht unterstützte Capability nicht aufgerufen werden');
      },
    };
    const sources: ResolverSources = { original: async () => bytesOf('original') };
    const resolver = new ModResolver(sources);
    resolver.setActiveMods([mod]);
    const result = await resolver.resolve(TARGET);
    expect(!isFailure(result) && result.origin).toBe('original');
  });
});

describe('ModResolver — Generation und Signatur', () => {
  it('erhöht resolverGeneration bei jedem setActiveMods-Aufruf', () => {
    const sources: ResolverSources = { original: async () => null };
    const resolver = new ModResolver(sources);
    expect(resolver.resolverGeneration).toBe(0);
    resolver.setActiveMods([]);
    expect(resolver.resolverGeneration).toBe(1);
    resolver.setActiveMods([activeMod()]);
    expect(resolver.resolverGeneration).toBe(2);
  });

  it('modSignature ändert sich mit Modliste und Generation, ist bei gleicher Lage aber stabil', () => {
    const sources: ResolverSources = { original: async () => null };
    const resolver = new ModResolver(sources);
    const sigEmpty = resolver.modSignature();
    expect(sigEmpty).toBe('#0');

    resolver.setActiveMods([activeMod({ manifest: { modId: 'mod-a', modVersion: '1.0.0' } })]);
    const sigA1 = resolver.modSignature();
    expect(sigA1).toBe('mod-a@1.0.0#1');
    // Wiederholte Abfrage ohne erneutes setActiveMods ⇒ stabil.
    expect(resolver.modSignature()).toBe(sigA1);

    // Gleiche Modliste, aber erneuter setActiveMods-Aufruf ⇒ neue Generation ⇒ andere Signatur.
    resolver.setActiveMods([activeMod({ manifest: { modId: 'mod-a', modVersion: '1.0.0' } })]);
    const sigA2 = resolver.modSignature();
    expect(sigA2).not.toBe(sigA1);
    expect(sigA2).toBe('mod-a@1.0.0#2');

    // Andere Modversion ⇒ andere Signatur.
    resolver.setActiveMods([activeMod({ manifest: { modId: 'mod-a', modVersion: '2.0.0' } })]);
    expect(resolver.modSignature()).toBe('mod-a@2.0.0#3');
  });
});
