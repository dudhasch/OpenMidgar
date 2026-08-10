# @webmidgar/steam-auth-relay

Selbst-hostbarer **Auth-Relay** für den freiwilligen Steam-Besitznachweis von
WebMidgar (Stufe 2 aus `docs/STEAM-LIZENZNACHWEIS.md`). Das Relay verifiziert
per **Steam OpenID 2.0** die SteamID64 eines Nutzers und prüft danach den
FF7-Besitz (AppID **39140**, Liste konfigurierbar) gegen die Steam Web API.
Das Ergebnis ist ein Verifizierungs-Badge — **keine** harte Sperre.

Reine TypeScript-Implementierung, **dependency-frei** (nur Node-Builtins +
global `fetch`), lauffähig als eigenständiger Node-Server und als Bibliothek
testbar (siehe `src/*.test.ts`).

## Architektur

```
Browser (WebMidgar)                Relay                       Steam
─────────────────                  ─────                       ─────
GET /auth/steam/login ───────────▶ state+Origin prüfen
  ◀── 302 auf steamcommunity.com/openid/login
Nutzer meldet sich bei Steam an ──────────────────────────────▶
  ◀── Redirect auf /auth/steam/return?openid.* ──▶ check_authentication (POST) ─▶
                                                  Nonce-Dedup (Replay-Schutz)
                                                  CheckAppOwnership (Publisher-Key)
                                                    └─ Fallback: GetOwnedGames ──▶
  ◀── HTML: postMessage({type, state, result}) + window.close()
GET /auth/steam/result?state=… ──▶ one-shot Ergebnis (TTL, CORS-Allowlist)
```

Details und Sicherheitsmodell: `docs/STEAM-LIZENZNACHWEIS-IMPLEMENTIERUNG.md`.

## Routen

| Route | Zweck |
|---|---|
| `GET /auth/steam/login?state=…&origin=…` | state-Format (`^[a-f0-9]{16,64}$`) und Origin-Allowlist prüfen, 302 auf Steam OpenID |
| `GET /auth/steam/return?state&origin&openid.…` | Assertion serverseitig verifizieren, Nonce deduplizieren, Besitz prüfen, Ergebnis-HTML mit `postMessage` |
| `GET /auth/steam/result?state=…` | Ergebnis one-shot abholen (JSON `200 {state, result}` oder `404`), CORS nur für allowlistete Origins, `OPTIONS`-Preflight |
| `GET /healthz` | `{"ok":true}` |

## Umgebungsvariablen

| Variable | Pflicht | Default | Bedeutung |
|---|---|---|---|
| `STEAM_WEB_API_KEY` | ja | — | normaler Steam-Web-API-Key (https://steamcommunity.com/dev/apikey) |
| `STEAM_PUBLISHER_KEY` | nein | — | Publisher-Key; aktiviert `CheckAppOwnership` als Primärpfad |
| `STEAM_APP_IDS` | nein | `39140` | kommagetrennte AppID-Liste |
| `REALM` | ja | — | öffentliche Basis-URL des Relays (z. B. `https://relay.example.org`, ohne Slash am Ende) |
| `ALLOWED_ORIGINS` | ja | — | kommagetrennte Origin-Allowlist für `postMessage`-Ziel und CORS |
| `RESULT_TTL_MS` | nein | `300000` | TTL für Ergebnisse (one-shot) und Nonces |
| `PORT` | nein | `8787` | Listen-Port |

## Start (Node ≥ 23.6)

```sh
STEAM_WEB_API_KEY="<DEIN-KEY>" \
REALM="https://relay.example.org" \
ALLOWED_ORIGINS="https://app.example.org" \
npm start   # = node --experimental-strip-types src/server.ts
```

Type-Stripping braucht **Node ≥ 23.6**; ältere Node-Versionen kennen das Flag
`--experimental-strip-types` nicht (Fehler `bad option`). In dem Fall bitte
Node aktualisieren — es wird bewusst kein Transpilier-Workaround ins Repo
gebaut. Für Serverless-Adapter (Cloudflare Workers, Deno Deploy, Vercel
Functions) ist `createRelayHandler` aus `src/relay.ts` der Einstiegspunkt:
eine reine `(req, res)`-Funktion ohne `node:http`-Abhängigkeit zur Laufzeit
(nur Typ-Importe).

## Publisher-Key-Hinweis und Fallback

`ISteamUser/CheckAppOwnership` erfordert einen **Publisher-Key**, den Valve
nur dem Rechteinhaber der AppID ausstellt — für FF7 (Square Enix) ist er für
dieses Projekt **nicht verfügbar**. Deshalb:

- **Mit** `STEAM_PUBLISHER_KEY`: Primärpfad `CheckAppOwnership` je AppID;
  bei HTTP-/Netzfehler automatischer Fallback.
- **Ohne** (Normalfall): `IPlayerService/GetOwnedGames` mit
  `appids_filter` — funktioniert mit dem normalen Web-API-Key, setzt aber ein
  **öffentliches** Profil voraus. Private Profile liefern leere Listen →
  `not-owned` ist in dem Fall „nicht nachweisbar", nicht „Raubkopie".

## Sicherheits- und Privacy-Notizen

- Die OpenID-Assertion wird **serverseitig** per `check_authentication`
  verifiziert (kein reines Client-Parsing).
- `openid.response_nonce` wird RP-seitig dedupliziert (Replay-Schutz, TTL).
- `state` (16–64 Hex-Zeichen) bindet den Flow gegen CSRF; `origin` wird
  gegen eine Allowlist geprüft (postMessage-Ziel + CORS).
- Die SteamID64 wird **nicht** persistiert und **nicht** geloggt; geloggt
  werden ausschließlich `status`/`method`/`appid`. Ergebnisse liegen nur im
  Speicher (TTL, one-shot, keyed by state).
- Der API-Key bleibt serverseitig und taucht in keiner Response auf.
- Alle Antworten mit `Cache-Control: no-store`; die Return-HTML mit CSP
  `default-src 'none'; script-src 'unsafe-inline'`.

## Manueller Test

1. Relay lokal starten: `STEAM_WEB_API_KEY="<KEY>" REALM="http://localhost:8787" ALLOWED_ORIGINS="http://localhost:5199" npm start`
2. Demo starten: `npm run demo` (Repo-Wurzel) und `http://localhost:5199/license.html` öffnen.
3. „Mit Steam anmelden" → Steam-Login im Popup → Badge erscheint.
4. Gegenprobe: `curl http://localhost:8787/healthz` → `{"ok":true}`.

Unit-Tests (mit gemocktem Steam, ohne echte Keys): `npm test` in der
Repo-Wurzel.
