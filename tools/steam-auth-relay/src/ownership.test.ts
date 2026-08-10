import { describe, expect, it } from 'vitest';
import { checkOwnership } from './ownership.ts';

const STEAM_ID = '76561198000000000'; // Platzhalter, keine echte SteamID
const WEB_KEY = 'TEST-WEB-API-KEY-PLACEHOLDER';
const PUBLISHER_KEY = 'TEST-PUBLISHER-KEY-PLACEHOLDER';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

/** fetch-Mock, der je nach Steam-Endpunkt antwortet und die Aufrufe protokolliert. */
function steamFetch(routes: {
  checkAppOwnership?: { status?: number; body?: unknown };
  ownedGames?: { status?: number; body?: unknown; rawBody?: string };
}): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/ISteamUser/CheckAppOwnership/')) {
      const route = routes.checkAppOwnership ?? { status: 404, body: {} };
      return jsonResponse(route.body ?? {}, route.status ?? 200);
    }
    if (url.includes('/IPlayerService/GetOwnedGames/')) {
      const route = routes.ownedGames ?? { status: 404, body: {} };
      if (route.rawBody !== undefined) return new Response(route.rawBody, { status: route.status ?? 200 });
      return jsonResponse(route.body ?? {}, route.status ?? 200);
    }
    throw new Error(`unerwarteter Aufruf: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('checkOwnership — Primärpfad CheckAppOwnership (Publisher-Key)', () => {
  it('ownsapp:true → owns mit method check-app-ownership und appid', async () => {
    const { fetchImpl, calls } = steamFetch({
      checkAppOwnership: { body: { appownership: { ownsapp: true } } },
    });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY, publisherKey: PUBLISHER_KEY },
      { fetchImpl },
    );
    expect(result).toEqual({ owns: true, method: 'check-app-ownership', appid: 39140 });
    expect(calls[0]).toContain('CheckAppOwnership');
    expect(calls[0]).toContain('appid=39140');
    expect(calls[0]).toContain(`key=${PUBLISHER_KEY}`);
    expect(calls[0]).toContain(`steamid=${STEAM_ID}`);
  });

  it('ownsapp:false für alle AppIDs → owns:false (kein Fallback nötig)', async () => {
    const { fetchImpl, calls } = steamFetch({
      checkAppOwnership: { body: { appownership: { ownsapp: false } } },
    });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140, 39141], webApiKey: WEB_KEY, publisherKey: PUBLISHER_KEY },
      { fetchImpl },
    );
    expect(result).toEqual({ owns: false, method: 'check-app-ownership' });
    expect(calls).toHaveLength(2);
  });

  it('HTTP-Fehler im Publisher-Pfad → Fallback auf GetOwnedGames', async () => {
    const { fetchImpl, calls } = steamFetch({
      checkAppOwnership: { status: 403, body: {} },
      ownedGames: { body: { response: { game_count: 1, games: [{ appid: 39140 }] } } },
    });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY, publisherKey: PUBLISHER_KEY },
      { fetchImpl },
    );
    expect(result).toEqual({ owns: true, method: 'owned-games', appid: 39140 });
    expect(calls[0]).toContain('CheckAppOwnership');
    expect(calls[1]).toContain('GetOwnedGames');
    expect(calls[1]).toContain(`key=${WEB_KEY}`);
  });
});

describe('checkOwnership — Fallback GetOwnedGames (normaler Web-API-Key)', () => {
  it('Treffer in gefilterten Games → owns mit method owned-games', async () => {
    const { fetchImpl, calls } = steamFetch({
      ownedGames: { body: { response: { game_count: 1, games: [{ appid: 39140 }] } } },
    });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140, 39141], webApiKey: WEB_KEY },
      { fetchImpl },
    );
    expect(result).toEqual({ owns: true, method: 'owned-games', appid: 39140 });
    expect(calls[0]).toContain('appids_filter[0]=39140');
    expect(calls[0]).toContain('appids_filter[1]=39141');
  });

  it('leere games-Liste (kein Besitz oder privates Profil) → owns:false', async () => {
    const { fetchImpl } = steamFetch({
      ownedGames: { body: { response: {} } },
    });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY },
      { fetchImpl },
    );
    expect(result).toEqual({ owns: false, method: 'owned-games' });
  });

  it('HTTP-Fehler → owns:false mit error', async () => {
    const { fetchImpl } = steamFetch({ ownedGames: { status: 403, body: {} } });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY },
      { fetchImpl },
    );
    expect(result.owns).toBe(false);
    expect(result.method).toBe('owned-games');
    expect(result.error).toBe('steam-api-http-403');
  });

  it('kaputtes JSON → owns:false mit error', async () => {
    const { fetchImpl } = steamFetch({ ownedGames: { rawBody: '<html>kaputt' } });
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY },
      { fetchImpl },
    );
    expect(result.owns).toBe(false);
    expect(result.error).toBe('steam-api-broken-json');
  });

  it('Netzwerkfehler → owns:false mit error', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as typeof fetch;
    const result = await checkOwnership(
      { steamId64: STEAM_ID, appIds: [39140], webApiKey: WEB_KEY },
      { fetchImpl },
    );
    expect(result.error).toBe('steam-api-unreachable');
  });
});
