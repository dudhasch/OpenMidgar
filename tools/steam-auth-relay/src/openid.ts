/**
 * Steam OpenID 2.0: Login-URL bauen, Assertion serverseitig per
 * `check_authentication` verifizieren, SteamID64 aus der claimed_id ziehen.
 *
 * Wichtig: Die Assertion darf niemals nur clientseitig geparst werden — erst
 * der direkte POST an den Steam-Endpunkt beweist, dass die Signatur stimmt.
 */

export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const CLAIMED_ID_PREFIX = 'https://steamcommunity.com/openid/id/';
const STEAM_ID_64_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function buildLoginUrl(opts: { realm: string; returnTo: string }): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': opts.returnTo,
    'openid.realm': opts.realm,
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
    'openid.identity': `${OPENID_NS}/identifier_select`,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

/**
 * Baut den urlencoded Body für den check_authentication-POST: alle
 * `openid.*`-Parameter der Assertion, wobei `openid.mode` zwingend auf
 * `check_authentication` überschrieben wird (Spezifikation OpenID 2.0 §11.4.2).
 */
export function buildCheckAuthenticationBody(assertion: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(assertion)) {
    if (!key.startsWith('openid.')) continue;
    params.set(key, value);
  }
  params.set('openid.mode', 'check_authentication');
  return params.toString();
}

/** Antwort des Providers ist Zeilenformat `key:value`; gültig bei `is_valid:true`. */
export function parseCheckAuthenticationResponse(body: string): boolean {
  return body
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === 'is_valid:true');
}

export function extractSteamId64(claimedId: string | undefined): string | null {
  if (claimedId === undefined) return null;
  const match = STEAM_ID_64_PATTERN.exec(claimedId);
  return match?.[1] ?? null;
}

export interface AssertionVerification {
  ok: boolean;
  steamId64?: string;
  error?: string;
}

/**
 * Verifiziert eine OpenID-Assertion serverseitig gegen Steam. Schlägt fehl bei
 * Netzwerkfehlern, HTTP-Fehlern, `is_valid:false` oder ungültiger claimed_id.
 */
export async function verifyAssertion(
  assertion: Record<string, string>,
  deps: { fetchImpl: typeof fetch; endpoint?: string },
): Promise<AssertionVerification> {
  if (assertion['openid.mode'] !== 'id_res') {
    return { ok: false, error: 'unexpected-openid-mode' };
  }
  const endpoint = deps.endpoint ?? STEAM_OPENID_ENDPOINT;
  let response: Response;
  try {
    response = await deps.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: buildCheckAuthenticationBody(assertion),
    });
  } catch {
    return { ok: false, error: 'openid-endpoint-unreachable' };
  }
  if (!response.ok) {
    return { ok: false, error: `openid-endpoint-http-${response.status}` };
  }
  let body: string;
  try {
    body = await response.text();
  } catch {
    return { ok: false, error: 'openid-response-unreadable' };
  }
  if (!parseCheckAuthenticationResponse(body)) {
    return { ok: false, error: 'assertion-invalid' };
  }
  const steamId64 = extractSteamId64(assertion['openid.claimed_id']);
  if (steamId64 === null) {
    return { ok: false, error: 'claimed-id-invalid' };
  }
  return { ok: true, steamId64 };
}
