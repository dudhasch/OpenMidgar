/**
 * Nonce-Store als Replay-Schutz für OpenID-Assertions: jede
 * `response_nonce` darf nur einmal akzeptiert werden. Lazy-Purge: abgelaufene
 * Einträge werden bei Zugriff entfernt, es läuft kein Timer.
 */
export class NonceStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly seen = new Map<string, number>(); // nonce → Ablaufzeitpunkt

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** true = Nonce ist frisch und wurde gespeichert; false = Replay oder leer. */
  checkAndStore(nonce: string): boolean {
    this.purge();
    if (nonce === '' || this.seen.has(nonce)) return false;
    this.seen.set(nonce, this.now() + this.ttlMs);
    return true;
  }

  size(): number {
    this.purge();
    return this.seen.size;
  }

  private purge(): void {
    const t = this.now();
    for (const [nonce, expiresAt] of this.seen) {
      if (expiresAt <= t) this.seen.delete(nonce);
    }
  }
}
