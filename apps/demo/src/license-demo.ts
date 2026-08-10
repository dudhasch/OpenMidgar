import { SteamLicenseClient, type LicenseProofResult } from '@webmidgar/license-steam';

/**
 * Demo-Seite für den Steam-Lizenznachweis (Stufe 2 aus
 * docs/STEAM-LIZENZNACHWEIS.md): Relay-URL konfigurierbar (localStorage),
 * Badge-Anzeige des Ergebnisses. Der Nachweis ist freiwillig (opt-in).
 */

const STORAGE_KEY = 'webmidgar.steam-relay-url';
const DEFAULT_RELAY_URL = 'http://localhost:8787';

const $ = (id: string) => document.getElementById(id)!;

const relayInput = $('relayUrl') as HTMLInputElement;
const verifyBtn = $('verify') as HTMLButtonElement;
const cancelBtn = $('cancel') as HTMLButtonElement;
const badgeEl = $('badge');
const statusEl = $('status');
const detailEl = $('detail');

relayInput.value = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RELAY_URL;
relayInput.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY, relayInput.value.trim());
});

const STATUS_TEXT: Record<LicenseProofResult['status'], string> = {
  verified: 'FF7-Besitz verifiziert',
  'not-owned': 'kein Besitz nachweisbar',
  unverifiable: 'nicht überprüfbar',
  error: 'Fehler',
  cancelled: 'abgebrochen',
};

let client: SteamLicenseClient | null = null;

function showResult(result: LicenseProofResult): void {
  badgeEl.className = result.status;
  badgeEl.textContent = STATUS_TEXT[result.status];
  const parts: string[] = [];
  if (result.appid !== undefined) parts.push(`appid=${result.appid}`);
  if (result.method !== undefined) parts.push(`method=${result.method}`);
  if (result.verifiedAt !== undefined) parts.push(`verifiedAt=${result.verifiedAt}`);
  if (result.error !== undefined) parts.push(`error=${result.error}`);
  detailEl.textContent = parts.length > 0 ? parts.join('\n') : '—';
}

verifyBtn.addEventListener('click', () => {
  const relayBaseUrl = relayInput.value.trim().replace(/\/+$/, '');
  if (relayBaseUrl === '') {
    statusEl.textContent = 'Bitte eine Relay-URL eintragen.';
    return;
  }
  client = new SteamLicenseClient({ relayBaseUrl, origin: window.location.origin });
  verifyBtn.disabled = true;
  cancelBtn.disabled = false;
  statusEl.textContent = 'Steam-Anmeldung läuft … (Popup ggf. zulassen)';
  client
    .verify()
    .then((result) => {
      showResult(result);
      statusEl.textContent =
        result.status === 'verified'
          ? 'Verifizierung abgeschlossen.'
          : 'Verifizierung beendet — WebMidgar bleibt uneingeschränkt nutzbar.';
    })
    .catch((err: unknown) => {
      badgeEl.className = 'error';
      badgeEl.textContent = STATUS_TEXT['error'];
      detailEl.textContent = String(err);
    })
    .finally(() => {
      verifyBtn.disabled = false;
      cancelBtn.disabled = true;
      client = null;
    });
});

cancelBtn.addEventListener('click', () => {
  client?.cancel();
});
