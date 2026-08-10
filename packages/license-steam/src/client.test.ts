import { describe, expect, it } from 'vitest';
import { SteamLicenseClient, type LicenseClientDeps } from './client.js';
import type { LicenseProofResult } from './types.js';

const RELAY = 'https://relay.example.org';
const ORIGIN = 'https://app.example.org';
const STATE = 'a'.repeat(32);

interface Harness {
  deps: LicenseClientDeps;
  popupUrls: string[];
  popup: { close(): void; closed?: boolean };
  emit: (e: { origin: string; data: unknown }) => void;
  fetchCalls: string[];
  respond: (r: Response) => void;
  advance: (ms: number) => void;
  now: () => number;
}

/**
 * Fake-Popup, Fake-MessageBus, Fake-Fetch, kontrollierte Zeit.
 * sleep(ms) läuft auf der Fake-Uhr: advance(ms) weckt wartende Sleeps auf.
 */
function makeHarness(opts: {
  popupBlocked?: boolean;
  fetchBehavior?: (url: string, respond: (r: Response) => void) => void;
} = {}): Harness {
  let t = 1_000_000;
  const sleepers: Array<{ at: number; wake: () => void }> = [];
  const listeners: Array<(e: { origin: string; data: unknown }) => void> = [];
  const popupUrls: string[] = [];
  const popup = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  const fetchCalls: string[] = [];
  let pendingRespond: ((r: Response) => void) | null = null;

  const harness: Harness = {
    deps: {
      relayBaseUrl: RELAY,
      origin: ORIGIN,
      openPopup: (url) => {
        popupUrls.push(url);
        return opts.popupBlocked === true ? null : popup;
      },
      addMessageListener: (cb) => {
        listeners.push(cb);
        return () => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      fetchImpl: (async (input: unknown) => {
        const url = String(input);
        fetchCalls.push(url);
        if (opts.fetchBehavior !== undefined) {
          return await new Promise<Response>((resolve) => {
            pendingRespond = resolve;
            opts.fetchBehavior!(url, resolve);
          });
        }
        return await new Promise<Response>((resolve) => {
          pendingRespond = resolve;
        });
      }) as typeof fetch,
      randomHex: () => STATE,
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      sleep: (ms) =>
        new Promise((resolve) => {
          sleepers.push({ at: t + ms, wake: resolve });
        }),
      now: () => t,
    },
    popupUrls,
    popup,
    emit: (e) => {
      for (const cb of [...listeners]) cb(e);
    },
    fetchCalls,
    respond: (r) => pendingRespond?.(r),
    advance: (ms) => {
      t += ms;
      for (const s of sleepers.splice(0)) {
        if (s.at <= t) s.wake();
        else sleepers.push(s);
      }
    },
    now: () => t,
  };
  return harness;
}

function resultBody(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ state: STATE, result }), { status: 200 });
}

const VERIFIED_RELAY_RESULT = {
  status: 'verified',
  method: 'owned-games',
  appid: 39140,
  verifiedAt: '2026-08-01T00:00:00.000Z',
};

describe('SteamLicenseClient — postMessage-Pfad', () => {
  it('Happy Path: Ergebnis kommt per postMessage, Popup wird geöffnet und geschlossen', async () => {
    const h = makeHarness({
      fetchBehavior: (_url, respond) => {
        // Polling läuft parallel; 404 solange keine Message da ist
        respond(new Response(JSON.stringify({ error: 'not-found-or-expired' }), { status: 404 }));
      },
    });
    const client = new SteamLicenseClient(h.deps);
    expect(client.getFlowState()).toBe('idle');

    const promise = client.verify();
    expect(client.getFlowState()).toBe('awaiting-result');

    expect(h.popupUrls).toHaveLength(1);
    const loginUrl = new URL(h.popupUrls[0]!);
    expect(loginUrl.origin).toBe(RELAY);
    expect(loginUrl.pathname).toBe('/auth/steam/login');
    expect(loginUrl.searchParams.get('state')).toBe(STATE);
    expect(loginUrl.searchParams.get('origin')).toBe(ORIGIN);

    await Promise.resolve(); // Listener registrieren lassen
    h.emit({
      origin: RELAY,
      data: { type: 'webmidgar-steam-license', state: STATE, result: VERIFIED_RELAY_RESULT },
    });

    const result = await promise;
    expect(result).toEqual(VERIFIED_RELAY_RESULT as LicenseProofResult);
    expect(h.popup.closed).toBe(true);
    expect(client.getFlowState()).toBe('done');
  });

  it('ignoriert Nachrichten von falscher Origin', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(new Response('{}', { status: 404 })),
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    await Promise.resolve();
    h.emit({
      origin: 'https://evil.example',
      data: { type: 'webmidgar-steam-license', state: STATE, result: VERIFIED_RELAY_RESULT },
    });
    h.emit({
      origin: RELAY,
      data: { type: 'webmidgar-steam-license', state: STATE, result: { status: 'not-owned' } },
    });
    const result = await promise;
    expect(result.status).toBe('not-owned');
  });

  it('ignoriert Nachrichten mit falschem state', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(new Response('{}', { status: 404 })),
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    await Promise.resolve();
    h.emit({
      origin: RELAY,
      data: { type: 'webmidgar-steam-license', state: 'f'.repeat(32), result: { status: 'verified' } },
    });
    h.emit({
      origin: RELAY,
      data: { type: 'webmidgar-steam-license', state: STATE, result: { status: 'unverifiable' } },
    });
    const result = await promise;
    expect(result.status).toBe('unverifiable');
  });

  it('ignoriert strukturell ungültige Ergebnisse', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(new Response('{}', { status: 404 })),
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    await Promise.resolve();
    h.emit({ origin: RELAY, data: { type: 'webmidgar-steam-license', state: STATE, result: { status: 'wat' } } });
    h.emit({ origin: RELAY, data: { type: 'webmidgar-steam-license', state: STATE, result: 'kaputt' } });
    h.emit({ origin: RELAY, data: { type: 'webmidgar-steam-license', state: STATE, result: { status: 'error', error: 'nonce-replay' } } });
    const result = await promise;
    expect(result).toEqual({ status: 'error', error: 'nonce-replay' });
  });
});

describe('SteamLicenseClient — Polling-Fallback', () => {
  it('Popup blockiert (openPopup null) → Polling-Modus liefert Ergebnis', async () => {
    const h = makeHarness({
      popupBlocked: true,
      fetchBehavior: (_u, respond) => respond(resultBody(VERIFIED_RELAY_RESULT)),
    });
    const client = new SteamLicenseClient(h.deps);
    const result = await client.verify();
    expect(result.status).toBe('verified');
    expect(h.popupUrls).toHaveLength(1); // Öffnen wurde versucht, Browser hat blockiert
    expect(h.fetchCalls[0]).toBe(`${RELAY}/auth/steam/result?state=${STATE}`);
    expect(client.getFlowState()).toBe('done');
  });

  it('404 → weiter pollen bis Ergebnis da ist', async () => {
    let calls = 0;
    const h = makeHarness({
      fetchBehavior: (_u, respond) => {
        calls += 1;
        respond(calls < 3 ? new Response('{}', { status: 404 }) : resultBody({ status: 'not-owned' }));
      },
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    // Zeit zwischen den Polls voranschieben
    for (let i = 0; i < 10 && calls < 3; i += 1) {
      await Promise.resolve();
      h.advance(100);
      await Promise.resolve();
    }
    const result = await promise;
    expect(result.status).toBe('not-owned');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('Relay-HTTP-Fehler (≠404) → status error', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(new Response('boom', { status: 500 })),
    });
    const client = new SteamLicenseClient(h.deps);
    const result = await client.verify();
    expect(result.status).toBe('error');
    expect(result.error).toBe('relay-http-500');
  });

  it('Relay-Ergebnis status error wird durchgereicht', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(resultBody({ status: 'error', error: 'nonce-replay' })),
    });
    const client = new SteamLicenseClient(h.deps);
    const result = await client.verify();
    expect(result).toEqual({ status: 'error', error: 'nonce-replay' });
  });
});

describe('SteamLicenseClient — Timeout und Abbruch', () => {
  it('Timeout → unverifiable mit error timeout', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(new Response('{}', { status: 404 })),
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    // Poll-Zyklus durchlaufen lassen und die Deadline überschreiten
    await Promise.resolve();
    for (let i = 0; i < 20; i += 1) {
      h.advance(100);
      await Promise.resolve();
    }
    const result = await promise;
    expect(result).toEqual({ status: 'unverifiable', error: 'timeout' });
    expect(client.getFlowState()).toBe('done');
  });

  it('hängender Fetch (nie resolvend) → unverifiable mit error timeout', async () => {
    const h = makeHarness({
      fetchBehavior: () => {
        /* nie antworten */
      },
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    await Promise.resolve();
    h.advance(1_001); // Deadline überschreiten, während der Fetch hängt
    const result = await promise;
    expect(result).toEqual({ status: 'unverifiable', error: 'timeout' });
    expect(client.getFlowState()).toBe('done');
  });

  it('cancel() → status cancelled, Popup geschlossen', async () => {
    const h = makeHarness({
      fetchBehavior: () => {
        /* nie antworten */
      },
    });
    const client = new SteamLicenseClient(h.deps);
    const promise = client.verify();
    await Promise.resolve();
    client.cancel();
    const result = await promise;
    expect(result).toEqual({ status: 'cancelled' });
    expect(h.popup.closed).toBe(true);
    expect(client.getFlowState()).toBe('done');
  });

  it('cancel() im Leerlauf ist ein No-Op', () => {
    const h = makeHarness();
    const client = new SteamLicenseClient(h.deps);
    client.cancel();
    expect(client.getFlowState()).toBe('idle');
  });

  it('parallel laufender zweiter verify()-Aufruf → already-running', async () => {
    const h = makeHarness({
      fetchBehavior: (_u, respond) => respond(resultBody({ status: 'verified' })),
    });
    const client = new SteamLicenseClient(h.deps);
    const first = client.verify();
    await Promise.resolve();
    const second = await client.verify();
    expect(second).toEqual({ status: 'error', error: 'already-running' });
    await first;
  });
});
