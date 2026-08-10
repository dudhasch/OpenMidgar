import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RelayConfig } from './config.ts';
import { buildLoginUrl, verifyAssertion } from './openid.ts';
import { NonceStore } from './nonce.ts';
import { checkOwnership } from './ownership.ts';
import { ResultStore, type RelayResult } from './results.ts';

/**
 * HTTP-Handler des Relay als reine Funktion `(req, res)` — lauffähig auf
 * `node:http` und damit direkt in Serverless-Adaptern wiederverwendbar.
 *
 * Routen:
 * - GET  /auth/steam/login   → 302 auf Steam-OpenID (state- + Origin-Prüfung)
 * - GET  /auth/steam/return  → Assertion-Verifikation, Nonce-Dedup, Besitzprüfung,
 *                              Ergebnis-HTML mit postMessage an den Öffner
 * - GET  /auth/steam/result  → one-shot Ergebnisabholung (CORS-Allowlist)
 * - OPTIONS /auth/steam/result → CORS-Preflight
 * - GET  /healthz            → {"ok":true}
 *
 * Datenschutz: Die SteamID64 wird nur im Speicher für die Dauer eines Laufs
 * gehalten; geloggt werden ausschließlich status/method/appid.
 */

const STATE_PATTERN = /^[a-f0-9]{16,64}$/;

export interface RelayDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

/** Origin-Header gegen die Allowlist prüfen; liefert die Origin oder null. */
function allowedRequestOrigin(req: IncomingMessage, config: RelayConfig): string | null {
  const origin = req.headers['origin'];
  if (typeof origin !== 'string') return null;
  return config.allowedOrigins.includes(origin) ? origin : null;
}

/** JSON für den Inline-<script>-Kontext: '<' escapen, damit z. B. ein
 *  künftiges '</script>' im Payload das Skript nicht vorzeitig beendet. */
export function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildReturnHtml(state: string, origin: string, result: RelayResult): string {
  // state ist hex-validiert, origin allowlisted — das Escape macht den
  // Inline-Stringkontext zusätzlich gegen künftige Payload-Änderungen robust.
  const message = jsonForInlineScript({ type: 'webmidgar-steam-license', state, result });
  const target = jsonForInlineScript(origin);
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>WebMidgar — Steam-Verifizierung</title>
</head>
<body>
  <p>Verifizierung abgeschlossen. Du kannst dieses Fenster schließen.</p>
  <script>
    (function () {
      var message = ${message};
      if (window.opener) {
        window.opener.postMessage(message, ${target});
      }
      window.close();
    })();
  </script>
</body>
</html>`;
}

export function createRelayHandler(
  config: RelayConfig,
  deps: RelayDeps = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  // Nonce-TTL: dieselbe Grobgröße wie das Ergebnis-TTL — eine Assertion, die
  // älter als das Ergebnis-Fenster ist, ist ohnehin nutzlos.
  const nonceStore = new NonceStore(config.resultTtlMs, now);
  const resultStore = new ResultStore(config.resultTtlMs, now);

  function logResult(result: RelayResult): void {
    const parts = [`status=${result.status}`];
    if (result.method !== undefined) parts.push(`method=${result.method}`);
    if (result.appid !== undefined) parts.push(`appid=${result.appid}`);
    console.log(`[steam-auth-relay] Ergebnis ${parts.join(' ')}`);
  }

  async function handleLogin(url: URL, res: ServerResponse): Promise<void> {
    const state = url.searchParams.get('state') ?? '';
    if (!STATE_PATTERN.test(state)) {
      sendJson(res, 400, { error: 'invalid-state' });
      return;
    }
    const origin = url.searchParams.get('origin') ?? '';
    if (!config.allowedOrigins.includes(origin)) {
      sendJson(res, 403, { error: 'origin-not-allowed' });
      return;
    }
    const returnTo =
      `${config.realm}/auth/steam/return?state=${state}&origin=${encodeURIComponent(origin)}`;
    res.writeHead(302, {
      location: buildLoginUrl({ realm: config.realm, returnTo }),
      'cache-control': 'no-store',
    });
    res.end();
  }

  async function handleReturn(url: URL, res: ServerResponse): Promise<void> {
    const state = url.searchParams.get('state') ?? '';
    const origin = url.searchParams.get('origin') ?? '';
    const fail = (statusCode: number, error: string): void => {
      sendJson(res, statusCode, { error });
    };
    if (!STATE_PATTERN.test(state)) {
      fail(400, 'invalid-state');
      return;
    }
    if (!config.allowedOrigins.includes(origin)) {
      fail(403, 'origin-not-allowed');
      return;
    }

    const assertion: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (key.startsWith('openid.')) assertion[key] = value;
    }

    const finish = (result: RelayResult): void => {
      resultStore.put(state, result);
      logResult(result);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'",
      });
      res.end(buildReturnHtml(state, origin, result));
    };

    const verification = await verifyAssertion(assertion, { fetchImpl });
    if (!verification.ok || verification.steamId64 === undefined) {
      finish({ status: 'error', verifiedAt: new Date(now()).toISOString(), error: verification.error ?? 'assertion-failed' });
      return;
    }

    if (!nonceStore.checkAndStore(assertion['openid.response_nonce'] ?? '')) {
      finish({ status: 'error', verifiedAt: new Date(now()).toISOString(), error: 'nonce-replay' });
      return;
    }

    const ownershipOpts: Parameters<typeof checkOwnership>[0] = {
      steamId64: verification.steamId64,
      appIds: config.appIds,
      webApiKey: config.steamWebApiKey,
    };
    if (config.steamPublisherKey !== undefined) ownershipOpts.publisherKey = config.steamPublisherKey;
    const ownership = await checkOwnership(ownershipOpts, { fetchImpl });

    const verifiedAt = new Date(now()).toISOString();
    if (ownership.error !== undefined) {
      const result: RelayResult = { status: 'unverifiable', method: ownership.method, verifiedAt, error: ownership.error };
      if (ownership.appid !== undefined) result.appid = ownership.appid;
      finish(result);
    } else if (ownership.owns) {
      const result: RelayResult = { status: 'verified', method: ownership.method, verifiedAt };
      if (ownership.appid !== undefined) result.appid = ownership.appid;
      finish(result);
    } else {
      const result: RelayResult = { status: 'not-owned', method: ownership.method, verifiedAt };
      if (ownership.appid !== undefined) result.appid = ownership.appid;
      finish(result);
    }
  }

  async function handleResult(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<void> {
    const corsOrigin = allowedRequestOrigin(req, config);
    const corsHeaders: Record<string, string> = {};
    if (corsOrigin !== null) {
      corsHeaders['access-control-allow-origin'] = corsOrigin;
      corsHeaders['vary'] = 'Origin';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'cache-control': 'no-store',
        ...corsHeaders,
        ...(corsOrigin !== null
          ? {
              'access-control-allow-methods': 'GET, OPTIONS',
              'access-control-allow-headers': 'content-type',
            }
          : {}),
      });
      res.end();
      return;
    }

    const state = url.searchParams.get('state') ?? '';
    const result = resultStore.take(state);
    if (result === undefined) {
      sendJson(res, 404, { error: 'not-found-or-expired' }, corsHeaders);
      return;
    }
    sendJson(res, 200, { state, result }, corsHeaders);
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `${config.realm}/`);
    } catch {
      sendJson(res, 400, { error: 'bad-request' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/steam/login') {
      await handleLogin(url, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/steam/return') {
      await handleReturn(url, res);
      return;
    }
    if (url.pathname === '/auth/steam/result' && (req.method === 'GET' || req.method === 'OPTIONS')) {
      await handleResult(req, url, res);
      return;
    }
    sendJson(res, 404, { error: 'not-found' });
  };
}
