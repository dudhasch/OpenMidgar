import { MVP_CAPABILITIES, type ModManifest, type ModOverride } from './manifest.js';

/**
 * Fünfstufige Auflösungskette (S19, Masterplan 5.1, ADR-007).
 *
 * Reihenfolge: **Sitzungs-Override → aktivierte Mods (nach Load-Order) →
 * Mod-Cache → Originalindex → Fallback**. Jede Auslieferung trägt ein
 * Herkunfts-Tag; ohne das wäre bei einem Fehlerbericht nicht mehr feststellbar,
 * ob ein Asset aus dem Original oder aus einem Mod kam — die häufigste Ursache
 * für unreproduzierbare Fehler in Modding-Ökosystemen.
 *
 * Die Load-Order ist **explizit und persistiert**, nie alphabetisch abgeleitet:
 * Eine implizite Ordnung ändert sich, sobald jemand ein Mod umbenennt.
 */

export type ResolutionOrigin = 'session' | 'mod' | 'mod-cache' | 'original' | 'fallback';

export interface ResolvedAsset {
  target: string;
  origin: ResolutionOrigin;
  /** Bei `mod`/`mod-cache`: welches Mod geliefert hat. */
  modId?: string | undefined;
  assetHash?: string | undefined;
  data: Uint8Array;
}

export interface ResolutionFailure {
  target: string;
  /** Stufen, die es versucht haben, in Reihenfolge. */
  attempted: ResolutionOrigin[];
  reason: string;
}

export interface ActiveMod {
  manifest: ModManifest;
  /** Liefert die Ersatzdatei; wirft oder gibt null bei Defekt. */
  read: (override: ModOverride) => Promise<Uint8Array | null>;
}

export interface ResolverSources {
  /** Sitzungs-Override (Studio-Vorschau) — höchste Priorität. */
  session?: ((target: string) => Promise<Uint8Array | null>) | undefined;
  /** Mod-Cache, geschlüsselt nach modId/modVersion/assetHash/engineCompat. */
  cache?:
    | {
        get: (key: string) => Promise<Uint8Array | null>;
        put: (key: string, data: Uint8Array) => Promise<void>;
      }
    | undefined;
  original: (target: string) => Promise<Uint8Array | null>;
  fallback?: ((target: string) => Promise<Uint8Array | null>) | undefined;
}

export function modCacheKey(manifest: ModManifest, override: ModOverride): string {
  return `${manifest.modId}/${manifest.modVersion}/${override.assetHash}/${manifest.engineCompatVersion}`;
}

export interface ResolverStats {
  cacheHits: number;
  cacheMisses: number;
  /** Assets, die wegen eines defekten Mod-Eintrags eine Stufe weitergereicht wurden. */
  degraded: number;
}

/**
 * Auflösungsregistrierung mit **Generationen**. Ein Wechsel der aktiven Mods
 * erhöht die Generation, wirkt aber erst, wenn der Host sie übernimmt — im
 * Field-Pfad an der Field-Grenze. Ein laufendes Field darf sich nicht unter
 * den Füßen verändern, sonst wäre der Replay-Digest wertlos.
 *
 * Die `resolverGeneration` ist strikt getrennt von der `fieldGeneration` der
 * Asset-Pipeline: Sie beantworten verschiedene Fragen (was gilt vs. was ist
 * noch aktuell) und dürfen sich nicht gegenseitig invalidieren.
 */
export class ModResolver {
  private mods: ActiveMod[] = [];
  private generation = 0;
  readonly stats: ResolverStats = { cacheHits: 0, cacheMisses: 0, degraded: 0 };

  constructor(private readonly sources: ResolverSources) {}

  get resolverGeneration(): number {
    return this.generation;
  }

  /**
   * Setzt die aktive Modliste **in genau dieser Reihenfolge**. Frühere
   * Einträge gewinnen bei Konflikten; der Konflikt wird gemeldet, nicht
   * verschwiegen.
   */
  setActiveMods(mods: readonly ActiveMod[]): { conflicts: { target: string; winner: string; loser: string }[] } {
    this.mods = [...mods];
    this.generation++;
    const owner = new Map<string, string>();
    const conflicts: { target: string; winner: string; loser: string }[] = [];
    for (const mod of this.mods) {
      for (const ov of mod.manifest.overrides) {
        const existing = owner.get(ov.target);
        if (existing === undefined) owner.set(ov.target, mod.manifest.modId);
        else conflicts.push({ target: ov.target, winner: existing, loser: mod.manifest.modId });
      }
    }
    return { conflicts };
  }

  /** Stabiler Fingerabdruck der Modlage — gehört in jeden Replay-Digest. */
  modSignature(): string {
    return this.mods
      .map((m) => `${m.manifest.modId}@${m.manifest.modVersion}`)
      .join(',')
      .concat(`#${this.generation}`);
  }

  async resolve(target: string): Promise<ResolvedAsset | ResolutionFailure> {
    const attempted: ResolutionOrigin[] = [];

    if (this.sources.session) {
      attempted.push('session');
      const data = await this.sources.session(target);
      if (data) return { target, origin: 'session', data };
    }

    for (const mod of this.mods) {
      const override = mod.manifest.overrides.find((o) => o.target === target);
      if (!override) continue;
      if (!MVP_CAPABILITIES.includes(override.capability)) {
        // Bekannte, aber im MVP nicht ausgeführte Capability: übergehen statt
        // stillschweigend zu liefern — sonst entstünde der Eindruck, sie wirke.
        continue;
      }
      const key = modCacheKey(mod.manifest, override);
      if (this.sources.cache) {
        attempted.push('mod-cache');
        const cached = await this.sources.cache.get(key);
        if (cached) {
          this.stats.cacheHits++;
          return { target, origin: 'mod-cache', modId: mod.manifest.modId, assetHash: override.assetHash, data: cached };
        }
        this.stats.cacheMisses++;
      }
      attempted.push('mod');
      let data: Uint8Array | null = null;
      try {
        data = await mod.read(override);
      } catch {
        data = null;
      }
      if (!data) {
        // Fehlerisolation auf Asset-Ebene: dieses eine Asset fällt durch,
        // das Mod bleibt aktiv.
        this.stats.degraded++;
        continue;
      }
      if (this.sources.cache) await this.sources.cache.put(key, data);
      return { target, origin: 'mod', modId: mod.manifest.modId, assetHash: override.assetHash, data };
    }

    attempted.push('original');
    const original = await this.sources.original(target);
    if (original) return { target, origin: 'original', data: original };

    if (this.sources.fallback) {
      attempted.push('fallback');
      const fb = await this.sources.fallback(target);
      if (fb) return { target, origin: 'fallback', data: fb };
    }
    return { target, attempted, reason: 'Asset in keiner Stufe gefunden' };
  }
}

export function isFailure(r: ResolvedAsset | ResolutionFailure): r is ResolutionFailure {
  return (r as ResolutionFailure).reason !== undefined;
}
