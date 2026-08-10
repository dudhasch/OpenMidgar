# WebMidgar — Implementierung: Steam-Besitznachweis (OpenID + CheckAppOwnership)

**Status:** Implementiert (Stufe 2) · **Bezug:**
[STEAM-LIZENZNACHWEIS.md](STEAM-LIZENZNACHWEIS.md) (Konzept, Stufenmodell, Recherche),
`tools/steam-auth-relay/README.md` (Betrieb), `packages/license-steam` (Client)

Dieses Dokument beschreibt die implementierte **Stufe 2** des Konzepts: einen
optionalen, selbst-hostbaren **Auth-Relay** plus **Browser-Client**, die per
Steam OpenID 2.0 die SteamID64 verifizieren und den FF7-Besitz (AppID **39140**)
prüfen. Das Ergebnis ist ein Verifizierungs-**Badge** — bewusst **keine** harte
Sperre (private Profile, GOG-/Windows-Store-Besitzer, Familienkonten).

## Architektur

```mermaid
flowchart LR
    subgraph Browser["Browser (WebMidgar)"]
        C["@webmidgar/license-steam<br/>SteamLicenseClient"]
    end
    subgraph Relay["Auth-Relay (selbst gehostet)"]
        L["/auth/steam/login"]
        R["/auth/steam/return"]
        Q["/auth/steam/result"]
        N["NonceStore (Replay-Schutz)"]
        S["ResultStore (TTL, one-shot)"]
    end
    subgraph Steam["Steam"]
        O["OpenID 2.0<br/>steamcommunity.com/openid/login"]
        A["Web API<br/>CheckAppOwnership / GetOwnedGames"]
    end
    C -->|302-Redirect| L --> O
    O -->|Assertion| R
    R -->|check_authentication| O
    R --> N
    R -->|Besitzprüfung (Key bleibt serverseitig)| A
    R --> S
    R -->|postMessage Badge| C
    C -->|Polling-Fallback| Q --> S
```

**Sequenzfluss:**

1. Der Client erzeugt ein zufälliges `state` (16 Bytes hex) und öffnet
   `{relay}/auth/steam/login?state=…&origin=…` im Popup.
2. Das Relay prüft `state`-Format und Origin-Allowlist und leitet per 302 auf
   Steam OpenID (`checkid_setup`, `return_to` enthält `state` + `origin`).
3. Steam leitet nach dem Login mit der OpenID-Assertion zurück auf
   `/auth/steam/return`.
4. Das Relay verifiziert die Assertion **serverseitig** per
   `check_authentication`-POST (kein Client-Parsing), dedupliziert
   `response_nonce` (Replay-Schutz) und extrahiert die SteamID64 aus der
   `claimed_id` (`^https://steamcommunity\.com/openid/id/(\d{17})$`).
5. Besitzprüfung: mit Publisher-Key primär `ISteamUser/CheckAppOwnership` je
   AppID, sonst (Normalfall) `IPlayerService/GetOwnedGames` mit
   `appids_filter`. HTTP-Fehler im Publisher-Pfad → automatischer Fallback.
6. Das Ergebnis landet im `ResultStore` (In-Memory, TTL 5 min, keyed by state,
   **one-shot**) und wird dem Öffner-Fenster per `postMessage` (Ziel-Origin =
   allowlistete Origin) zugestellt; Fallback: Client-Polling auf
   `/auth/steam/result?state=…`.
7. Der Client mappt das Relay-Ergebnis auf `LicenseProofResult`
   (`verified` / `not-owned` / `unverifiable` / `error` / `cancelled`).

## Relay-API-Referenz

| Route | Antwort |
|---|---|
| `GET /auth/steam/login?state=…&origin=…` | `400 invalid-state` bei Formatverstoß (`^[a-f0-9]{16,64}$`), `403 origin-not-allowed` sonst `302` auf Steam OpenID |
| `GET /auth/steam/return?state&origin&openid.…` | `200` HTML (CSP `default-src 'none'; script-src 'unsafe-inline'`, `no-store`) mit Inline-`postMessage({type:'webmidgar-steam-license', state, result}, <origin>)` + `window.close()` + sichtbarem Fallback-Text |
| `GET /auth/steam/result?state=…` | `200 {state, result}` oder `404 {error:'not-found-or-expired'}`; CORS-Header nur für allowlistete `Origin`; `OPTIONS`-Preflight → `204` |
| `GET /healthz` | `200 {"ok":true}` |

`result` (`RelayResult`): `{ status: 'verified'|'not-owned'|'unverifiable'|'error',
method?: 'check-app-ownership'|'owned-games', appid?: number, verifiedAt: string,
error?: string }`.

## Konfiguration (Umgebungsvariablen)

Siehe `tools/steam-auth-relay/README.md` — Pflicht: `STEAM_WEB_API_KEY`,
`REALM`, `ALLOWED_ORIGINS`; optional: `STEAM_PUBLISHER_KEY`, `STEAM_APP_IDS`
(Default `39140`), `RESULT_TTL_MS` (Default 300000), `PORT` (Default 8787).

## Sicherheitsmodell

- **OpenID-Korrektheit:** Assertion wird ausschließlich serverseitig per
  `check_authentication` gegen Steam verifiziert; `openid.mode` muss `id_res`
  sein; die `claimed_id` wird strikt gematcht.
- **Replay-Schutz:** `response_nonce`-Dedup mit TTL (`NonceStore`, Lazy-Purge).
- **CSRF:** `state` bindet Login- und Return-Schritt; Formatvalidierung.
- **Origin-Allowlist:** gilt für `postMessage`-Ziel, Login/Return-Parameter
  und CORS auf der Ergebnisroute.
- **Key-Sicherheit:** Der Steam-API-Key existiert nur serverseitig und taucht
  in keiner Response, keinem Log und keinem Test auf.
- **Härtung:** `Cache-Control: no-store` überall; restriktive CSP auf der
  einzigen HTML-Antwort; Logging nur `status`/`method`/`appid`.

## DSGVO-Notizen

- Die SteamID64 ist personenbeziehbar und wird deshalb **nicht persistiert
  und nicht geloggt** — sie lebt nur flüchtig für die Dauer eines Laufs im
  Arbeitsspeicher. Gespeichert (In-Memory, TTL, one-shot) wird nur das
  abgeleitete Badge-Ergebnis, keyed by dem zufälligen `state`.
- Der Login ist **opt-in**; WebMidgar bleibt ohne Nachweis voll funktionsfähig.
- Betreiber eines eigenen Relays verarbeiten beim Return-Aufruf zwangsläufig
  die SteamID64; ein kurzer Hinweis in der eigenen Datenschutzerklärung ist
  empfohlen (Zweck: einmaliger Besitznachweis, keine Speicherung).

## Publisher-Key-Constraint und Fallback (ehrlich)

`CheckAppOwnership` ist für AppID 39140 **praktisch nicht nutzbar**: Valve
stellt Publisher-Keys nur dem Rechteinhaber aus, und FF7 gehört Square Enix
(Recherche in `STEAM-LIZENZNACHWEIS.md`, Abschnitt 2.3). Der Pfad ist trotzdem
implementiert — für den Fall, dass ein Betreiber einen eigenen Publisher-Key
für eine andere AppID besitzt (`STEAM_APP_IDS` ist konfigurierbar). Im
Normalfall läuft die Prüfung über `GetOwnedGames` mit `appids_filter`; das ist
der ehrliche, dokumentierte Hauptpfad. Konsequenz: Der Nachweis hängt an einem
**öffentlichen** Steam-Profil.

## Deployment-Optionen

- **Standalone:** `npm start` im Tool-Verzeichnis (Node ≥ 23.6,
  Type-Stripping; Reverse Proxy mit TLS davor, `REALM` = öffentliche URL).
- **Serverless:** `createRelayHandler(config, deps)` aus
  `@webmidgar/steam-auth-relay` ist eine reine `(req, res)`-Funktion und lässt
  sich in Adapter für Cloudflare Workers / Deno Deploy / Vercel Functions
  einhängen. Achtung: `NonceStore`/`ResultStore` sind In-Memory — bei mehreren
  Instanzen entfällt die One-Shot-Garantie instanzübergreifend (für den
  Badge-Zweck vertretbar, dokumentiert).
- **Keys:** https://steamcommunity.com/dev/apikey (Web-API-Key); niemals in
  Client-Code, Logs oder Repos committen.

## Test-Anleitung

- **Unit/Integration (automatisiert):** `npm test` in der Repo-Wurzel —
  `tools/steam-auth-relay/src/*.test.ts` (OpenID, Nonce-Dedup, Ownership inkl.
  Publisher-Fehler→Fallback, End-to-End login→return→result mit gemocktem
  Steam, CORS, Replay, TTL) und `packages/license-steam/src/client.test.ts`
  (postMessage, Polling, Origin/state-Filter, Timeout, Cancel). Alle Tests
  injizieren `fetch`/`now`; keine echten Keys oder SteamIDs.
- **Manuell (echter Account):** Relay lokal starten (Env siehe README), Demo
  per `npm run demo` → `http://localhost:5199/license.html`, „Mit Steam
  anmelden". Erwartung: Badge `verified` bei FF7 im Account (öffentliches
  Profil), sonst `not-owned`. Gegenprobe mit privatem Profil → `not-owned`
  (= „nicht nachweisbar").

## Integration in `packages/app-shell` (Snippet)

```ts
import { SteamLicenseClient } from '@webmidgar/license-steam';

// Opt-in-Button in der App-Shell; Ergebnis als Badge anzeigen, nichts sperren.
const client = new SteamLicenseClient({
  relayBaseUrl: 'https://relay.example.org',
  origin: window.location.origin,
});
const proof = await client.verify();
if (proof.status === 'verified') {
  // Badge setzen (z. B. im Diagnose-Export als optionales Feld)
}
```

## Limitationen

- Private Steam-Profile sind nicht nachweisbar → `not-owned` ist kein
  Piraterie-Beweis; es gibt **kein hartes Gate**.
- Nur Steam abgedeckt; GOG-/Windows-Store-Besitzer können den Badge nicht
  erwerben (Stufe 1, lokale FSA-Prüfung, bleibt die Basis für alle).
- In-Memory-Stores: Relay-Restart verliert ausstehende Ergebnisse (durch TTL
  und One-Shot-Design bewusst in Kauf genommen).
- `not-owned` bei fehlerhafter Besitzprüfung wird als `unverifiable`
  unterschieden — Clients sollten beide Fälle weich behandeln.
