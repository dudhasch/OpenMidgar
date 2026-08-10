/**
 * Konfiguration des Steam-Auth-Relay. Alle Werte kommen aus Umgebungsvariablen;
 * `loadConfig` wirft bei fehlenden Pflichtwerten, damit der Server nicht mit
 * halber Konfiguration startet.
 */

export interface RelayConfig {
  steamWebApiKey: string; // Pflicht (normaler Web-API-Key)
  steamPublisherKey?: string; // optional → aktiviert CheckAppOwnership als Primärpfad
  appIds: number[]; // default [39140]
  realm: string; // öffentliche Basis-URL des Relays (https://…, ohne Slash am Ende)
  allowedOrigins: string[]; // Allowlist für Origin-Validierung (postMessage + CORS)
  resultTtlMs: number; // default 300_000
  port: number; // default 8787
}

export const DEFAULT_APP_IDS = [39140];
export const DEFAULT_RESULT_TTL_MS = 300_000;
export const DEFAULT_PORT = 8787;

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return end === value.length ? value : value.slice(0, end);
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`steam-auth-relay: Pflicht-Umgebungsvariable ${key} fehlt oder ist leer`);
  }
  return value;
}

function parseAppIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_APP_IDS];
  const ids = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    throw new Error('steam-auth-relay: STEAM_APP_IDS enthält keine gültige AppID');
  }
  return ids;
}

function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (origins.length === 0) {
    throw new Error('steam-auth-relay: ALLOWED_ORIGINS enthält keine gültige Origin');
  }
  return origins;
}

function parsePositiveInt(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`steam-auth-relay: ${key} muss eine positive Ganzzahl sein (war: ${raw})`);
  }
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): RelayConfig {
  const steamWebApiKey = required(env, 'STEAM_WEB_API_KEY');
  const realm = stripTrailingSlashes(required(env, 'REALM'));
  const allowedOrigins = parseOrigins(required(env, 'ALLOWED_ORIGINS'));
  const appIds = parseAppIds(env['STEAM_APP_IDS']);
  const resultTtlMs = parsePositiveInt(env['RESULT_TTL_MS'], DEFAULT_RESULT_TTL_MS, 'RESULT_TTL_MS');
  const port = parsePositiveInt(env['PORT'], DEFAULT_PORT, 'PORT');

  const publisherRaw = env['STEAM_PUBLISHER_KEY'];
  const config: RelayConfig = { steamWebApiKey, appIds, realm, allowedOrigins, resultTtlMs, port };
  if (publisherRaw !== undefined && publisherRaw.trim() !== '') {
    config.steamPublisherKey = publisherRaw;
  }
  return config;
}
