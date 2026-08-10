import type { OwnershipMethod } from './ownership.ts';

/**
 * Ergebnis eines Verifizierungslaufs. Wird keyed by `state` abgelegt und
 * one-shot abgeholt (`take` löscht). Kein Logging, keine Persistenz — die
 * SteamID64 ist hier bewusst nicht Teil des Resultats.
 */
export interface RelayResult {
  status: 'verified' | 'not-owned' | 'unverifiable' | 'error';
  method?: OwnershipMethod;
  appid?: number;
  verifiedAt: string;
  error?: string;
}

export class ResultStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly results = new Map<string, { result: RelayResult; expiresAt: number }>();

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  put(state: string, result: RelayResult): void {
    this.purge();
    this.results.set(state, { result, expiresAt: this.now() + this.ttlMs });
  }

  /** One-shot: liefert das Ergebnis und löscht es; undefined bei unbekannt/abgelaufen. */
  take(state: string): RelayResult | undefined {
    this.purge();
    const entry = this.results.get(state);
    if (entry === undefined) return undefined;
    this.results.delete(state);
    return entry.result;
  }

  size(): number {
    this.purge();
    return this.results.size;
  }

  private purge(): void {
    const t = this.now();
    for (const [state, entry] of this.results) {
      if (entry.expiresAt <= t) this.results.delete(state);
    }
  }
}
