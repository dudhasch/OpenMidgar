import { describe, expect, it } from 'vitest';
import { NonceStore } from './nonce.ts';

describe('NonceStore (Replay-Schutz)', () => {
  it('akzeptiert frische Nonces und weist Replays zurück', () => {
    const store = new NonceStore(60_000, () => 1_000);
    expect(store.checkAndStore('nonce-a')).toBe(true);
    expect(store.checkAndStore('nonce-a')).toBe(false); // Replay
    expect(store.checkAndStore('nonce-b')).toBe(true);
    expect(store.size()).toBe(2);
  });

  it('weist leere Nonces zurück', () => {
    const store = new NonceStore(60_000, () => 1_000);
    expect(store.checkAndStore('')).toBe(false);
  });

  it('lässt Nonces nach Ablauf der TTL wieder zu (Lazy-Purge)', () => {
    let t = 1_000;
    const store = new NonceStore(60_000, () => t);
    expect(store.checkAndStore('nonce-a')).toBe(true);
    t = 60_999;
    expect(store.checkAndStore('nonce-a')).toBe(false);
    t = 61_001; // abgelaufen (Ablauf bei 61_000)
    expect(store.checkAndStore('nonce-a')).toBe(true);
    expect(store.size()).toBe(1);
  });
});
