import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RelayConfig } from './config.ts';
import { createRelayHandler, jsonForInlineScript, type RelayDeps } from './relay.ts';

const STATE = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://app.example.org';
const REALM = 'https://relay.example.org';
const CLAIMED_ID = 'https://steamcommunity.com/openid/id/76561198000000000'; // Platzhalter

function baseConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    steamWebApiKey: 'TEST-WEB-API-KEY-PLACEHOLDER',
    appIds: [39140],
    realm: REALM,
    allowedOrigins: [ORIGIN],
    resultTtlMs: 300_000,
    port: 8787,
    ...overrides,
  };
}

interface SteamStubs {
  assertionValid?: boolean;
  checkAppOwnership?: { status?: number; ownsapp?: boolean };
  ownedGames?: { status?: number; games?: Array<{ appid: number }> };
}

function steamFetch(stubs: SteamStubs): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://steamcommunity.com/openid/login')) {
      const valid = stubs.assertionValid ?? true;
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid ? 'true' : 'false'}\n`, {
        status: 200,
      });
    }
    if (url.includes('/ISteamUser/CheckAppOwnership/')) {
      const stub = stubs.checkAppOwnership ?? {};
      return new Response(JSON.stringify({ appownership: { ownsapp: stub.ownsapp ?? false } }), {
        status: stub.status ?? 200,
      });
    }
    if (url.includes('/IPlayerService/GetOwnedGames/')) {
      const stub = stubs.ownedGames ?? {};
      const games = stub.games ?? [];
      return new Response(JSON.stringify({ response: { game_count: games.length, games } }), {
        status: stub.status ?? 200,
      });
    }
    throw new Error(`unerwarteter Steam-Aufruf: ${url}`);
  }) as typeof fetch;
}

const servers: Server[] = [];

async function startRelay(config: RelayConfig, deps: RelayDeps): Promise<string> {
  const handler = createRelayHandler(config, deps);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

function returnUrl(nonce: string, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    state: STATE,
    origin: ORIGIN,
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': CLAIMED_ID,
    'openid.identity': CLAIMED_ID,
    'openid.response_nonce': nonce,
    'openid.sig': 'PLACEHOLDER-SIGNATUR',
    ...overrides,
  });
  return `/auth/steam/return?${params.toString()}`;
}

async function fetchResult(base: string, origin?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers['origin'] = origin;
  return fetch(`${base}/auth/steam/result?state=${STATE}`, { headers });
}

describe('jsonForInlineScript (XSS-Härtung der Return-HTML)', () => {
  it('escaped "<" als \\u003c, damit "</script>" den Inline-Kontext nicht bricht', () => {
    const json = jsonForInlineScript({ result: { error: '</script><script>alert(1)</script>' } });
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');
    // bleibt valides, äquivalentes JSON
    expect(JSON.parse(json)).toEqual({ result: { error: '</script><script>alert(1)</script>' } });
  });

  it('lässt escape-freie Payloads unverändert', () => {
    expect(jsonForInlineScript('https://app.example.org')).toBe('"https://app.example.org"');
  });
});

describe('Relay — /healthz und unbekannte Routen', () => {
  it('healthz antwortet mit {"ok":true} und no-store', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('unbekannte Route → 404', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/gibts-nicht`);
    expect(res.status).toBe(404);
  });
});

describe('Relay — /auth/steam/login', () => {
  it('gültige Anfrage → 302 auf Steam-OpenID mit return_to (state+origin kodiert)', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/auth/steam/login?state=${STATE}&origin=${encodeURIComponent(ORIGIN)}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(location.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(location.searchParams.get('openid.realm')).toBe(REALM);
    expect(location.searchParams.get('openid.return_to')).toBe(
      `${REALM}/auth/steam/return?state=${STATE}&origin=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it('ungültiges state-Format → 400', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/auth/steam/login?state=zu-kurz&origin=${encodeURIComponent(ORIGIN)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-state' });
  });

  it('nicht allowlistete Origin → 403', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(
      `${base}/auth/steam/login?state=${STATE}&origin=${encodeURIComponent('https://evil.example')}`,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin-not-allowed' });
  });
});

describe('Relay — End-to-End login→return→result', () => {
  it('Happy Path: verifiziert, HTML mit postMessage, Ergebnis one-shot abholbar', async () => {
    const base = await startRelay(baseConfig(), {
      fetchImpl: steamFetch({ ownedGames: { games: [{ appid: 39140 }] } }),
    });

    const res = await fetch(`${base}${returnUrl('nonce-happy-1')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; script-src 'unsafe-inline'",
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain("window.opener.postMessage");
    expect(html).toContain(`postMessage(message, ${JSON.stringify(ORIGIN)})`);
    expect(html).toContain('webmidgar-steam-license');
    expect(html).toContain('Du kannst dieses Fenster schließen');
    expect(html).not.toContain('76561198000000000'); // keine SteamID in der Antwort

    const resultRes = await fetchResult(base, ORIGIN);
    expect(resultRes.status).toBe(200);
    expect(resultRes.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const body = (await resultRes.json()) as { state: string; result: Record<string, unknown> };
    expect(body.state).toBe(STATE);
    expect(body.result['status']).toBe('verified');
    expect(body.result['method']).toBe('owned-games');
    expect(body.result['appid']).toBe(39140);
    expect(typeof body.result['verifiedAt']).toBe('string');

    // One-shot: zweite Abholung → 404
    const second = await fetchResult(base, ORIGIN);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: 'not-found-or-expired' });
  });

  it('Publisher-Key-Pfad: ownsapp:true → verified mit method check-app-ownership', async () => {
    const base = await startRelay(baseConfig({ steamPublisherKey: 'TEST-PUBLISHER-KEY-PLACEHOLDER' }), {
      fetchImpl: steamFetch({ checkAppOwnership: { ownsapp: true } }),
    });
    await fetch(`${base}${returnUrl('nonce-pub-1')}`);
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('verified');
    expect(body.result['method']).toBe('check-app-ownership');
    expect(body.result['appid']).toBe(39140);
  });

  it('Publisher-Fehler → Fallback auf GetOwnedGames', async () => {
    const base = await startRelay(baseConfig({ steamPublisherKey: 'TEST-PUBLISHER-KEY-PLACEHOLDER' }), {
      fetchImpl: steamFetch({
        checkAppOwnership: { status: 500 },
        ownedGames: { games: [{ appid: 39140 }] },
      }),
    });
    await fetch(`${base}${returnUrl('nonce-fallback-1')}`);
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('verified');
    expect(body.result['method']).toBe('owned-games');
  });

  it('kein Besitz → not-owned', async () => {
    const base = await startRelay(baseConfig(), { fetchImpl: steamFetch({ ownedGames: {} }) });
    await fetch(`${base}${returnUrl('nonce-notowned-1')}`);
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('not-owned');
    expect(body.result['method']).toBe('owned-games');
  });

  it('Steam-API-Fehler bei Besitzprüfung → unverifiable', async () => {
    const base = await startRelay(baseConfig(), {
      fetchImpl: steamFetch({ ownedGames: { status: 403 } }),
    });
    await fetch(`${base}${returnUrl('nonce-unver-1')}`);
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('unverifiable');
    expect(body.result['error']).toBe('steam-api-http-403');
  });

  it('ungültige Assertion (is_valid:false) → status error', async () => {
    const base = await startRelay(baseConfig(), {
      fetchImpl: steamFetch({ assertionValid: false }),
    });
    await fetch(`${base}${returnUrl('nonce-invalid-1')}`);
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('error');
    expect(body.result['error']).toBe('assertion-invalid');
  });

  it('Nonce-Replay → status error mit error nonce-replay', async () => {
    const base = await startRelay(baseConfig(), {
      fetchImpl: steamFetch({ ownedGames: { games: [{ appid: 39140 }] } }),
    });
    await fetch(`${base}${returnUrl('nonce-replay-1')}`); // erste Nutzung
    await fetch(`${base}${returnUrl('nonce-replay-1')}`); // Replay überschreibt Ergebnis
    const body = (await (await fetchResult(base)).json()) as { result: Record<string, unknown> };
    expect(body.result['status']).toBe('error');
    expect(body.result['error']).toBe('nonce-replay');
  });

  it('ungültiges state bei return → 400', async () => {
    const base = await startRelay(baseConfig(), { fetchImpl: steamFetch({}) });
    const res = await fetch(`${base}${returnUrl('n', { state: 'XX' })}`);
    expect(res.status).toBe(400);
  });

  it('fremde Origin bei return → 403', async () => {
    const base = await startRelay(baseConfig(), { fetchImpl: steamFetch({}) });
    const res = await fetch(`${base}${returnUrl('n', { origin: 'https://evil.example' })}`);
    expect(res.status).toBe(403);
  });

  it('abgelaufenes Ergebnis → 404', async () => {
    let t = 1_000_000;
    const base = await startRelay(baseConfig({ resultTtlMs: 300_000 }), {
      fetchImpl: steamFetch({ ownedGames: { games: [{ appid: 39140 }] } }),
      now: () => t,
    });
    await fetch(`${base}${returnUrl('nonce-expired-1')}`);
    t += 300_001; // Ergebnis-TTL überschritten
    const res = await fetchResult(base);
    expect(res.status).toBe(404);
  });
});

describe('Relay — /auth/steam/result CORS', () => {
  it('OPTIONS-Preflight mit erlaubter Origin → 204 mit Allow-Headers/Methods', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/auth/steam/result?state=${STATE}`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
  });

  it('nicht allowlistete Origin → kein CORS-Header (Browser blockt clientseitig)', async () => {
    const base = await startRelay(baseConfig(), {});
    const res = await fetch(`${base}/auth/steam/result?state=${STATE}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
