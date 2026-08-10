/**
 * Besitzprüfung gegen die Steam Web API.
 *
 * Primärpfad: `ISteamUser/CheckAppOwnership` — braucht aber einen
 * **Publisher-Key**, der nur dem Rechteinhaber der AppID ausgestellt wird
 * (für FF7/AppID 39140 nicht verfügbar). Deshalb automatischer Fallback auf
 * `IPlayerService/GetOwnedGames` mit `appids_filter`, der mit einem normalen
 * Web-API-Key läuft, aber ein öffentliches Profil voraussetzt.
 */

export type OwnershipMethod = 'check-app-ownership' | 'owned-games';

export interface OwnershipResult {
  owns: boolean;
  method: OwnershipMethod;
  appid?: number;
  error?: string;
}

const STEAM_API_BASE = 'https://api.steampowered.com';

function checkAppOwnershipUrl(publisherKey: string, steamId64: string, appid: number): string {
  return (
    `${STEAM_API_BASE}/ISteamUser/CheckAppOwnership/v0002/` +
    `?key=${encodeURIComponent(publisherKey)}&steamid=${encodeURIComponent(steamId64)}` +
    `&appid=${appid}&format=json`
  );
}

function ownedGamesUrl(webApiKey: string, steamId64: string, appIds: number[]): string {
  const filter = appIds.map((id, i) => `&appids_filter[${i}]=${id}`).join('');
  return (
    `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/` +
    `?key=${encodeURIComponent(webApiKey)}&steamid=${encodeURIComponent(steamId64)}` +
    `&format=json${filter}`
  );
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { ok: false, error: 'steam-api-unreachable' };
  }
  if (!response.ok) {
    return { ok: false, error: `steam-api-http-${response.status}` };
  }
  try {
    return { ok: true, data: (await response.json()) as unknown };
  } catch {
    return { ok: false, error: 'steam-api-broken-json' };
  }
}

export async function checkOwnership(
  opts: { steamId64: string; appIds: number[]; webApiKey: string; publisherKey?: string },
  deps: { fetchImpl: typeof fetch },
): Promise<OwnershipResult> {
  // Primärpfad: nur aktiv, wenn ein Publisher-Key konfiguriert ist.
  if (opts.publisherKey !== undefined) {
    let publisherFailed = false;
    for (const appid of opts.appIds) {
      const res = await fetchJson(
        deps.fetchImpl,
        checkAppOwnershipUrl(opts.publisherKey, opts.steamId64, appid),
      );
      if (!res.ok) {
        publisherFailed = true; // HTTP-/Netzfehler → Fallback auf GetOwnedGames
        break;
      }
      const body = res.data as { appownership?: { ownsapp?: unknown } };
      if (body.appownership?.ownsapp === true) {
        return { owns: true, method: 'check-app-ownership', appid };
      }
    }
    if (!publisherFailed) {
      // Alle AppIDs sauber geprüft, keine davon im Besitz.
      return { owns: false, method: 'check-app-ownership' };
    }
  }

  // Fallback: GetOwnedGames mit appids_filter (öffentliches Profil nötig).
  const res = await fetchJson(deps.fetchImpl, ownedGamesUrl(opts.webApiKey, opts.steamId64, opts.appIds));
  if (!res.ok) {
    return { owns: false, method: 'owned-games', error: res.error };
  }
  const body = res.data as { response?: { games?: Array<{ appid?: unknown }> } };
  const games = Array.isArray(body.response?.games) ? body.response.games : [];
  if (games.length === 0) {
    // Leere Liste: kein Besitz ODER privates Profil — nicht unterscheidbar.
    return { owns: false, method: 'owned-games' };
  }
  const firstAppid = games[0]?.appid;
  const result: OwnershipResult = { owns: true, method: 'owned-games' };
  if (typeof firstAppid === 'number') result.appid = firstAppid;
  return result;
}
