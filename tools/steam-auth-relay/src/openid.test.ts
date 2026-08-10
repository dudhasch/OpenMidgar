import { describe, expect, it } from 'vitest';
import {
  buildCheckAuthenticationBody,
  buildLoginUrl,
  extractSteamId64,
  parseCheckAuthenticationResponse,
  STEAM_OPENID_ENDPOINT,
  verifyAssertion,
} from './openid.ts';

const VALID_ASSERTION: Record<string, string> = {
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': STEAM_OPENID_ENDPOINT,
  'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
  'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
  'openid.return_to': 'https://relay.example.org/auth/steam/return?state=0123456789abcdef',
  'openid.response_nonce': '2026-08-01T00:00:00ZABCDEFGH',
  'openid.assoc_handle': '1234567890',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  'openid.sig': 'PLACEHOLDER-SIGNATUR',
};

function fetchReturning(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe('buildLoginUrl', () => {
  it('baut eine checkid_setup-URL mit realm und return_to', () => {
    const url = buildLoginUrl({
      realm: 'https://relay.example.org',
      returnTo: 'https://relay.example.org/auth/steam/return?state=0123456789abcdef&origin=https%3A%2F%2Fapp.example.org',
    });
    expect(url.startsWith(`${STEAM_OPENID_ENDPOINT}?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0');
    expect(params.get('openid.mode')).toBe('checkid_setup');
    expect(params.get('openid.realm')).toBe('https://relay.example.org');
    expect(params.get('openid.return_to')).toBe(
      'https://relay.example.org/auth/steam/return?state=0123456789abcdef&origin=https%3A%2F%2Fapp.example.org',
    );
    expect(params.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(params.get('openid.identity')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
  });
});

describe('buildCheckAuthenticationBody', () => {
  it('überschreibt openid.mode mit check_authentication und lässt fremde Keys weg', () => {
    const body = buildCheckAuthenticationBody({ ...VALID_ASSERTION, state: 'sollte-nicht-rein' });
    const params = new URLSearchParams(body);
    expect(params.get('openid.mode')).toBe('check_authentication');
    expect(params.get('openid.sig')).toBe('PLACEHOLDER-SIGNATUR');
    expect(params.get('state')).toBeNull();
  });
});

describe('parseCheckAuthenticationResponse', () => {
  it('erkennt is_valid:true', () => {
    expect(parseCheckAuthenticationResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')).toBe(true);
  });
  it('erkennt is_valid:false und Müll als ungültig', () => {
    expect(parseCheckAuthenticationResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n')).toBe(false);
    expect(parseCheckAuthenticationResponse('')).toBe(false);
    expect(parseCheckAuthenticationResponse('is_valid:trueff')).toBe(false);
  });
});

describe('extractSteamId64', () => {
  it('extrahiert eine 17-stellige SteamID64', () => {
    expect(extractSteamId64('https://steamcommunity.com/openid/id/76561198000000000')).toBe(
      '76561198000000000',
    );
  });
  it('lehnt fremde Formate ab', () => {
    expect(extractSteamId64(undefined)).toBeNull();
    expect(extractSteamId64('https://steamcommunity.com/openid/id/123')).toBeNull();
    expect(extractSteamId64('https://evil.example/openid/id/76561198000000000')).toBeNull();
    expect(extractSteamId64('https://steamcommunity.com/openid/id/76561198000000000/extra')).toBeNull();
  });
});

describe('verifyAssertion', () => {
  it('verifiziert eine gültige Assertion serverseitig (check_authentication-POST)', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetchImpl = (async (input: unknown, init?: { body?: string }) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', { status: 200 });
    }) as typeof fetch;

    const result = await verifyAssertion(VALID_ASSERTION, { fetchImpl });
    expect(result).toEqual({ ok: true, steamId64: '76561198000000000' });
    expect(capturedUrl).toBe(STEAM_OPENID_ENDPOINT);
    const sent = new URLSearchParams(capturedBody);
    expect(sent.get('openid.mode')).toBe('check_authentication');
    expect(sent.get('openid.sig')).toBe('PLACEHOLDER-SIGNATUR');
  });

  it('lehnt eine vom Provider abgelehnte Assertion ab', async () => {
    const result = await verifyAssertion(VALID_ASSERTION, {
      fetchImpl: fetchReturning('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('assertion-invalid');
  });

  it('meldet HTTP-Fehler des Providers', async () => {
    const result = await verifyAssertion(VALID_ASSERTION, { fetchImpl: fetchReturning('', 500) });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('openid-endpoint-http-500');
  });

  it('meldet Netzwerkfehler', async () => {
    const fetchImpl = (async () => {
      throw new Error('netz weg');
    }) as typeof fetch;
    const result = await verifyAssertion(VALID_ASSERTION, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('openid-endpoint-unreachable');
  });

  it('lehnt Assertionen ohne id_res-Modus ab', async () => {
    const result = await verifyAssertion(
      { ...VALID_ASSERTION, 'openid.mode': 'cancel' },
      { fetchImpl: fetchReturning('is_valid:true') },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unexpected-openid-mode');
  });

  it('lehnt ungültige claimed_id trotz is_valid:true ab', async () => {
    const result = await verifyAssertion(
      { ...VALID_ASSERTION, 'openid.claimed_id': 'https://evil.example/id/76561198000000000' },
      { fetchImpl: fetchReturning('is_valid:true') },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('claimed-id-invalid');
  });
});
