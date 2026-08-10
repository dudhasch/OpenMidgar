import type { LicenseFlowState, LicenseProofResult } from './types.js';

/**
 * Framework-freier Client für den Steam-Besitznachweis über einen
 * selbst-gehosteten Auth-Relay (`@webmidgar/steam-auth-relay`).
 *
 * Ablauf: Popup auf `/auth/steam/login` öffnen → das Relay schickt das
 * Ergebnis per `postMessage` zurück (primär) oder der Client pollt
 * `/auth/steam/result` (Fallback, z. B. wenn window.opener fehlt). DOM-Zugriffe
 * laufen ausschließlich über injizierbare Interfaces — dadurch ist der Client
 * unter Node testbar.
 */

export interface LicenseClientDeps {
  relayBaseUrl: string; // z. B. https://relay.example.org (ohne Slash am Ende)
  origin: string; // Origin dieser App (relay-seitig allowlisted)
  openPopup?: (url: string) => { close(): void; closed?: boolean } | null; // default: window.open-Wrapper
  addMessageListener?: (cb: (e: { origin: string; data: unknown }) => void) => () => void; // Rückgabe = unsubscribe
  fetchImpl?: typeof fetch;
  randomHex?: (nBytes: number) => string; // default: crypto.getRandomValues, 16 Bytes → 32 Hex
  pollIntervalMs?: number; // default 1500
  timeoutMs?: number; // default 180_000
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 180_000;
const MESSAGE_TYPE = 'webmidgar-steam-license';

const RELAY_STATUSES = new Set(['verified', 'not-owned', 'unverifiable', 'error']);

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return end === value.length ? value : value.slice(0, end);
}

function defaultRandomHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function defaultOpenPopup(url: string): { close(): void; closed?: boolean } | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  return window.open(url, 'webmidgar-steam-license', 'width=800,height=720,popup=yes');
}

function defaultAddMessageListener(
  cb: (e: { origin: string; data: unknown }) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: MessageEvent): void => {
    cb({ origin: event.origin, data: event.data });
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Validiert und normalisiert ein Relay-Ergebnis; null bei ungültiger Struktur. */
function mapRelayResult(raw: unknown): LicenseProofResult | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['status'] !== 'string' || !RELAY_STATUSES.has(r['status'])) return null;
  const out: LicenseProofResult = {
    status: r['status'] as LicenseProofResult['status'],
  };
  if (typeof r['appid'] === 'number') out.appid = r['appid'];
  if (r['method'] === 'check-app-ownership' || r['method'] === 'owned-games') out.method = r['method'];
  if (typeof r['verifiedAt'] === 'string') out.verifiedAt = r['verifiedAt'];
  if (typeof r['error'] === 'string') out.error = r['error'];
  return out;
}

export class SteamLicenseClient {
  private readonly deps: Required<Omit<LicenseClientDeps, 'openPopup' | 'addMessageListener'>> & {
    openPopup: NonNullable<LicenseClientDeps['openPopup']>;
    addMessageListener: NonNullable<LicenseClientDeps['addMessageListener']>;
  };
  private readonly relayOrigin: string;
  private flow: LicenseFlowState = 'idle';
  private cancelRequested = false;
  private cancelSignal: (() => void) | null = null;
  private popup: { close(): void; closed?: boolean } | null = null;
  private messageResult: LicenseProofResult | null = null;

  constructor(deps: LicenseClientDeps) {
    this.deps = {
      openPopup: deps.openPopup ?? defaultOpenPopup,
      addMessageListener: deps.addMessageListener ?? defaultAddMessageListener,
      fetchImpl: deps.fetchImpl ?? fetch,
      randomHex: deps.randomHex ?? defaultRandomHex,
      pollIntervalMs: deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
      now: deps.now ?? Date.now,
      relayBaseUrl: stripTrailingSlashes(deps.relayBaseUrl),
      origin: deps.origin,
    };
    this.relayOrigin = new URL(this.deps.relayBaseUrl).origin;
  }

  getFlowState(): LicenseFlowState {
    return this.flow;
  }

  /**
   * Startet den Verifizierungslauf. Genau ein Lauf zur selben Zeit; das
   * erste valide Ergebnis (postMessage oder Polling) gewinnt.
   */
  async verify(): Promise<LicenseProofResult> {
    if (this.flow === 'awaiting-popup' || this.flow === 'awaiting-result') {
      return { status: 'error', error: 'already-running' };
    }
    this.flow = 'awaiting-popup';
    this.cancelRequested = false;

    const state = this.deps.randomHex(16);
    const loginUrl =
      `${this.deps.relayBaseUrl}/auth/steam/login` +
      `?state=${state}&origin=${encodeURIComponent(this.deps.origin)}`;

    this.popup = this.deps.openPopup(loginUrl);
    // openPopup null (Popup blockiert / kein Browser) → reiner Polling-Modus.
    this.flow = 'awaiting-result';

    const unsubscribe = this.deps.addMessageListener((e) => {
      if (e.origin !== this.relayOrigin) return;
      const data = e.data;
      if (data === null || typeof data !== 'object') return;
      const msg = data as Record<string, unknown>;
      if (msg['type'] !== MESSAGE_TYPE || msg['state'] !== state) return;
      const result = mapRelayResult(msg['result']);
      if (result !== null) this.messageResult = result;
    });

    try {
      this.flow = 'awaiting-result';
      const result = await this.awaitResult(state);
      return result;
    } finally {
      unsubscribe();
      this.popup?.close();
      this.popup = null;
      this.messageResult = null;
      this.cancelSignal = null;
      this.flow = 'done';
    }
  }

  /** Bricht einen laufenden Lauf ab; verify() löst dann mit status 'cancelled'. */
  cancel(): void {
    if (this.flow !== 'awaiting-popup' && this.flow !== 'awaiting-result') return;
    this.cancelRequested = true;
    this.popup?.close();
    this.cancelSignal?.();
  }

  private async awaitResult(state: string): Promise<LicenseProofResult> {
    const deadline = this.deps.now() + this.deps.timeoutMs;
    const cancelPromise = new Promise<'cancelled'>((resolve) => {
      this.cancelSignal = () => resolve('cancelled');
    });

    for (;;) {
      if (this.cancelRequested) return { status: 'cancelled' };
      if (this.messageResult !== null) return this.messageResult;
      if (this.deps.now() >= deadline) {
        return { status: 'unverifiable', error: 'timeout' };
      }

      // Polling-Fallback: 404 heißt „noch nicht fertig" → weiter pollen.
      let polled: LicenseProofResult | null = null;
      try {
        // cancel() und die Deadline unterbrechen auch einen hängenden Fetch —
        // sonst liefe ein nicht-resolvendes fetchImpl am timeoutMs vorbei.
        polled = await Promise.race([
          this.fetchResultOnce(state),
          cancelPromise.then((): null => null),
          this.deps.sleep(Math.max(0, deadline - this.deps.now())).then((): null => null),
        ]);
      } catch {
        // transiente Netzfehler → still weiterversuchen bis Timeout
      }
      if (polled !== null) return polled;
      if (this.messageResult !== null) return this.messageResult;
      if (this.cancelRequested) return { status: 'cancelled' };

      const remaining = deadline - this.deps.now();
      if (remaining <= 0) return { status: 'unverifiable', error: 'timeout' };
      // Message während des Schlafs: der Listener setzt messageResult; der
      // nächste Schleifendurchlauf (spätestens nach pollIntervalMs) greift es ab.
      await Promise.race([
        this.deps.sleep(Math.min(this.deps.pollIntervalMs, remaining)),
        cancelPromise,
      ]);
    }
  }

  /** null = noch kein Ergebnis (404) oder ungültige Antwort. */
  private async fetchResultOnce(state: string): Promise<LicenseProofResult | null> {
    const res = await this.deps.fetchImpl(
      `${this.deps.relayBaseUrl}/auth/steam/result?state=${state}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) return { status: 'error', error: `relay-http-${res.status}` };
    const body = (await res.json()) as { result?: unknown };
    return mapRelayResult(body.result);
  }
}
