# WebMidgar — Konzept: Lizenznachweis der Spieler (FF7-Besitz via Steam)

**Status:** Entscheidungsvorlage (ADR-Kandidat) · **Stand:** 2026-08 · **Bezug:**
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) (Rechtsrahmen, Clean Room),
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) (S18 App-Shell, R5-Fingerprint-Matrix)

**Fragestellung:** WebMidgar ist eine Clean-Room-Reimplementierung und verteilt
keine Originaldaten — der Nutzer stellt sie lokal per File System Access API (FSA)
bereit. Damit das Modell trägt (und als Piraterie-Abschirmung bzw. Signal
gegenüber Square Enix), soll das Projekt plausibel machen können, dass Nutzer
eine **legale FF7-Kopie** besitzen. Dieses Dokument untersucht, wie ein solcher
Nachweis technisch funktionieren kann — primär via Steam — und empfiehlt eine
gestufte Architektur.

**Aussagenklassen** wie im Masterplan: 🟢 verifizierter Fakt (Quelle am Ende) ·
🔵 Architekturentscheidung (Vorschlag) · 🟡 Annahme/zu validieren · 🔴 offene Frage.
**Kein Teil dieses Dokuments ist Rechtsberatung.**

---

## TL;DR

1. 🟢 **Ein direkter Browser-Aufruf der Steam Web API ist unmöglich:**
   `api.steampowered.com` sendet keine CORS-Header (empirisch verifiziert:
   Preflight → 405, kein `Access-Control-Allow-Origin`), und ein im Client
   eingebetteter API-Key wäre auslesbar und ToS-widrig (100k Calls/Tag,
   kein Key-Sharing).
2. 🟢 **Steam OpenID 2.0 liefert ohne Key nur die SteamID64.** Die eigentliche
   Besitzprüfung (`GetOwnedGames`) braucht weiterhin einen API-Key und ein
   **öffentliches** Profil — also zwingend einen minimalen Relay.
3. 🟢 **Publisher-APIs** (`CheckAppOwnership`, `GetPublisherAppOwnership`,
   Encrypted App Tickets) **sind strukturell gesperrt:** Der nötige
   Publisher-Key wird nur dem Rechteinhaber der AppID ausgestellt — FF7 ist
   **AppID 39140, Publisher Square Enix** (verifiziert). Ein Fan-Projekt kann
   diesen Pfad nicht nutzen.
4. 🟢 **Stärkste praktikable Basis: lokale Prüfung.** FSA + vorhandene
   R5-Fingerprint-Matrix + Steam-Installationsartefakte
   (`appmanifest_39140.acf`, `libraryfolders.vdf`). Schwach als „Beweis",
   stark als Hürde und Signal — exakt das Modell von OpenMW, ScummVM, FFNx
   und 7th Heaven (keines dieser Projekte implementiert einen harten
   Besitznachweis).
5. 🔵 **Empfehlung in 3 Stufen:** (1) lokale FSA-Prüfung inkl. Steam-Manifest
   (Basis, ohne Server, jetzt umsetzbar); (2) opt-in Steam-OpenID-Login über
   genau eine serverlose Relay-Funktion (bewusster, transparenter
   Philosophie-Bruch an einem Punkt); (3) optionale native Companion-App
   (Komfort, kein Beweiszuwachs). **Keine harten Zwangssperren** (private
   Profile, GOG-/Windows-Store-Besitzer, Familienkonten).

---

## 1. Randbedingungen aus dem Projekt

| Randbedingung | Konsequenz für den Lizenznachweis |
|---|---|
| 100 % clientseitig, kein Server | Jede servergestützte Prüfung ist ein bewusster Architekturbruch und muss als solcher markiert + optional sein |
| FSA: Secure Context, User-Gesture, Chromium-only, keine Registry, keine Pfad-Discovery | Lokale Prüfung nur über nutzergewählte Verzeichnisse; Firefox/Safari brauchen Fallback (`webkitdirectory`) |
| Clean Room / Provenienz (ADR-017-Prinzip) | Der Nachweis darf selbst keine Originalbytes transportieren — nur Fingerprints/Hashes (R5-Diagnose-Export ist bereits beweisbar assetfrei) |
| R5-Fingerprint-Matrix + Realdaten-Scan existieren bereits | Der Lizenzcheck ist eine **Erweiterung bestehender Infrastruktur**, kein Neubau |
| Mehrere legale FF7-Releases (Steam 2013, Rerelease, GOG, Windows Store) | Der Check muss variantentolerant sein; AppID-Liste statt Einzelwert |

## 2. Recherche-Befunde

### 2.1 Steam Web API (`IPlayerService/GetOwnedGames`)

- 🟢 Endpunkt `GET /IPlayerService/GetOwnedGames/v1/` mit Pflichtparametern
  `key` + `steamid`; optional `appids_filter` — ideal für eine gezielte
  FF7-Prüfung (nur AppID 39140, nicht die ganze Bibliothek).
- 🟢 Ergebnis nur sichtbar, wenn die „Game Details" des Profils öffentlich
  sind; private Profile liefern leere Listen → ein Teil legitimer Besitzer ist
  so **nicht** nachweisbar.
- 🟢 API-Keys: kostenlos registrierbar, aber 100.000 Calls/Tag gedeckelt,
  Weitergabe untersagt → ein projektweit geteilter Client-Key ist ToS-widrig
  und auslesbar.
- 🟢 **CORS-Befund (eigener Test, 2026-08):** `api.steampowered.com` sendet
  keine `Access-Control-Allow-Origin`-Header; OPTIONS-Preflight → 405. Ein
  `fetch()` aus dem Browser wird blockiert — unabhängig vom Key.

**Folge:** Direktaufruf aus WebMidgar ist technisch (CORS) und operativ
(Key-ToS) ausgeschlossen. Jede Web-API-Nutzung erfordert einen serverseitigen
Relay oder eine native Komponente.

### 2.2 Steam OpenID 2.0

- 🟢 Steam implementiert **OpenID 2.0** (kein OIDC, kein OAuth2-Token):
  Redirect an `steamcommunity.com/openid/login` (`openid.mode=checkid_setup`,
  `return_to`, `realm`), Rückkehr mit signierter Assertion
  (`claimed_id = …/openid/id/<SteamID64>`).
- 🟢 **Verifizierungspflicht:** Die Assertion muss per serverseitigem POST
  `openid.mode=check_authentication` verifiziert werden (`is_valid:true`),
  inkl. Nonce-Einmaligkeit (Replay-Schutz, OpenID-Spec §11.3/11.4). Wer nur
  URL-Parameter im Client ausliest, akzeptiert **gefälschte** SteamIDs.
- 🟢 Ohne API-Key erhält man **nur die SteamID64** — kein Bibliothekszugriff.
  Der Besitznachweis braucht danach immer noch die Web API (§2.1).

**Folge:** Der Redirect-Teil funktioniert von einer statischen Seite aus, die
verbindliche Verifizierung + Besitzabfrage braucht **genau eine** serverseitige
Funktion.

### 2.3 Publisher-APIs und Encrypted App Tickets

- 🟢 `CheckAppOwnership` / `GetPublisherAppOwnership` /
  `ISteamUserAuth/AuthenticateUserTicket` benötigen einen **Publisher-Key**,
  den nur der Steamworks-Partner der jeweiligen AppID erhält.
- 🟢 Encrypted App Tickets werden im laufenden Spiel-Client via Steamworks SDK
  mit **eigener** AppID erzeugt und nur mit dem Publisher-Ticket-Key
  entschlüsselt.
- 🟢 **AppID-Befund:** `39140 = FINAL FANTASY VII (Steam 2013, Square Enix)`,
  verifiziert über die Store-URL. Rerelease-Varianten existieren (z. B.
  `steam_appid.txt` 3837340 bei der 2020er-Version laut PCGamingWiki).

**Folge:** Der von Valve dokumentierte „Ownership Verification"-Pfad für
Drittanbieter setzt voraus, dass der Drittanbieter **Eigentümer der geprüften
AppID** ist. Für WebMidgar strukturell gesperrt. 🔵 Konsequenz: Die Prüfliste
akzeptiert **mehrere AppIDs** (mindestens 39140; Rerelease/GOG-Varianten
pflegbar), abgeglichen mit den Datenvarianten, die die Engine verarbeitet (R5).

### 2.4 Clientseitige Erkennung (Desktop-Konsens vs. Browser)

- 🟢 Etabliertes Desktop-Verfahren: Registry `HKCU\Software\Valve\Steam\
  SteamPath` → `steamapps/libraryfolders.vdf` (alle Bibliotheken) → je
  Bibliothek `steamapps/appmanifest_<appid>.acf` (`appid`, `name`,
  `installdir`) → Installationspfad. Der Registry-Schlüssel
  `…\Steam\Apps\<appid>\Installed` gilt als unzuverlässig.
- 🟢 **Via FSA erreichbar (Chromium):** `appmanifest_39140.acf` und
  `libraryfolders.vdf` liegen **unterhalb des nutzergewählten
  Verzeichnisses** und sind les-/hashbar — wenn der Nutzer `steamapps`, eine
  Bibliothek oder den Steam-Ordner wählt. Nicht erreichbar: Registry,
  Laufwerksweite Suche, Firefox/Safari (Picker).
- 🟢 Bewertung: ACF + passende Fingerprints sind ein **stärkeres Indiz** als
  Hashes allein (Steam hat die App auf diesem System registriert), aber keine
  Eigentumsurkunde — ACF ist Klartext und kopierbar; Spieldateien können ohne
  Kauf vorliegen (Family Sharing, Raubkopie).

### 2.5 Praxis-Precedents

| Projekt | Modell | Quelle |
|---|---|---|
| **OpenMW** | „You MUST own a legal copy of Morrowind" — Ehrenprinzip + lokale Daten, kein technischer Check | openmw.org/faq |
| **ScummVM** | Striktes Anti-Piraterie-Gebot; technisch **keine** Echtheitsprüfung („no way to tell the difference") | docs.scummvm.org |
| **FFNx** | **Genuine-Detection ist Pflicht** („MUST have a legal copy … no support if not detected as genuine"), Support-Matrix Steam 2013/Rerelease/GOG/Windows Store | github.com/julianxhokaxhiu/FFNx |
| **7th Heaven** | Aktive Anti-Piracy-Checks; Launcher ausdrücklich „for legality reasons with Square Enix" auf die Steam-Version ausgerichtet | forums.qhimm.com; Tsunamods-Statement |
| **Desktop-Library-Tools** (Playnite/GOG-Galaxy-Muster) | Dreistufig: lokale VDF/ACF-Erkennung → OpenID für Identität → **nutzereigener** API-Key für Bibliotheksdaten | Playmoir knowledge-base |

🟢 **Muster:** Kein vergleichbares Projekt implementiert einen kryptographisch
harten Besitznachweis. Alle kombinieren lokale-Daten-Hürde + Echtheitsheuristik
+ Community-/Support-Regeln. Sichtbare Anti-Piraterie-Maßnahmen wirken als
Schutzschild gegenüber dem Rechteinhaber.

### 2.6 Rechtliche Einordnung (keine Rechtsberatung)

- 🟢 Clean Room schützt den **Code** (Sega v. Accolade 1992; Sony v. Connectix
  2000: Reverse Engineering für Interoperabilität = Fair Use, sofern das
  Endprodukt kein geschütztes Material enthält) — nicht die Nutzung.
- 🟢 Square Enix geht aktiv gegen Fanprojekte vor (C&Ds u. a. Chrono
  Resurrection 2004, Crimson Echoes 2009 mit Androhung bis $150k/Werk).
- Einordnung: WebMidgar ist kein abgeleitetes Werk (keine Assets/Texte). Der
  Besitznachweis ist **Risikominderung und Signal**, keine eigenständige
  Rechtsverteidigung — und dokumentiert, dass das Projekt Piraterie nicht
  erleichtert.
- 🟢 **DSGVO:** SteamID64 = Online-Identifikator mit (relativem) Personenbezug
  (EuGH Breyer C-582/14; FIN C-319/22). Reine lokale Verarbeitung (Stufe 1)
  vermeidet Projekt-Verantwortlichkeit; ein Relay (Stufe 2) braucht
  Datenschutzerklärung, Zweckbindung, Datenminimierung (nur
  `appids_filter`-Match, keine Bibliothek, keine SteamID-Speicherung).

## 3. Trust-Modell: Was kann ein Nachweis realistisch leisten?

| Modell | Stärke | Hauptangriff | Fit zur „kein Server"-Philosophie |
|---|---|---|---|
| **A. Rein clientseitig** (FSA + Fingerprint + ACF) | Indiz; stark als Hürde/Signal | Client unter Nutzerkontrolle: Logik patchbar, Artefakte kopierbar | Exzellent |
| **B. OpenID + Mini-Relay** (`check_authentication` + `GetOwnedGames?appids_filter`) | Mittel-stark (Valve-attestierte Identität + Besitz, nur öffentliche Profile) | Relay = Vertrauensgrenze; Key-Limit; private Profile unprüfbar | Bruch an genau einem, klar markierten, optionalen Punkt |
| **C. Nutzereigener API-Key** | Schwach-mittel (unverifizierte Selbstauskunft) | CORS erzwingt ohnehin Proxy → kaum Vorteil ggü. B | Gut, aber praktisch wertlos |
| **D. Native Companion-App** | Mittel lokal (Registry, Multi-Bibliothek) | weiterhin clientseitig fälschbar | Gut, aber hohe Plattformkosten |
| **E. Publisher-APIs/Tickets** | — | — | **Nicht verfügbar** (Square-Enix-Key) |

🟢 **Fundamentalgrenze:** Selbst ein perfekter Relay beweist nur „ein
Steam-Account mit FF7 hat sich eingeloggt" — nicht, dass dieser Browser-Nutzer
Kontoinhaber ist oder die lokalen Dateien aus diesem Konto stammen. Ohne
Publisher-Key gibt es **kein kryptographisches Bindeglied** zwischen
Steam-Besitz und lokalen Daten.

🔵 **Zielsetzung daher: „best-effort authenticity gate".** Ehrliche Nutzer
bekommen einen reibungsarmen, glaubwürdigen Check; Piraterie wird sichtbar
erschwert und dokumentiert nicht unterstützt. Mehr leistet kein vergleichbares
Projekt.

## 4. Empfohlene Architektur (3 Stufen)

### Stufe 1 — Basis (jetzt umsetzbar, ohne Server)

**Lokale FSA-Prüfung: Fingerprint-Matrix + Steam-Installationsartefakte.**

- Erweiterung des Realdaten-Scans/Import-Flusses (`packages/app-shell`,
  `packages/io`): Neben den Datei-Fingerprints (R5) wird —
  verzeichnisabhängig — nach `steamapps/appmanifest_<appid>.acf` und
  `libraryfolders.vdf` gesucht. ACF-Felder prüfen (`"appid" "39140"`,
  `"name" "FINAL FANTASY VII"`) und mit den Fingerprints der Installation
  verknüpfen.
- Fingerprint-Matrix um alle bekannten **legalen Varianten** erweitern
  (Steam 2013, Rerelease, GOG, Windows Store — analog der FFNx-Support-Matrix);
  AppID-/Variantenliste als Daten pflegbar, nicht hartkodiert.
- Ergebnis-Modell als Daten (projektkonform):
  `licenseSignal := { variant: known-steam-2013 | known-gog | … | unknown,
  steamManifest: present | absent | not-applicable, fingerprints: matched |
  partial | none }` — auslieferbar über den **assetfreien Diagnose-Export**
  (S18-Bestand).
- UI-Kommunikation ehrlich: „Best-effort-Echtheitscheck, kein Beweis";
  Support-Regel nach FFNx-Vorbild („kein Support für nicht als echt erkannte
  Installationen"); README-Disclaimer nach OpenMW-Vorbild.
- Firefox/Safari-Fallback dokumentieren (`webkitdirectory`-Input), Ergebnis
  bleibt lokal.

**Aufwand:** niedrig-mittel — Infrastruktur (Fingerprinting, Import-Zustands-
maschine, Diagnose-Export) existiert; neu sind ACF/VDF-Parsing und UI/Copy.

### Stufe 2 — Opt-in (nur bei Bedarf): Steam-OpenID über Mini-Relay

- 🔵 **Genau eine** serverlose Funktion (z. B. Cloudflare Worker/Vercel
  Function), Aufgaben strikt: OpenID-Assertion entgegennehmen →
  `check_authentication` (serverseitig, mit Nonce-Einmaligkeit) → mit
  gehärtetem Projekt-Key `GetOwnedGames?appids_filter=<FF7-AppIDs>&steamid=
  <verifizierte ID>` → Antwort an Client nur `{ owns_ff7: bool,
  verified: true, appid: number }`. **Keine** SteamID-/Bibliotheksspeicherung,
  minimale Log-Retention, Datenschutzerklärung.
- Ergebnis ist ein **Verifizierungs-Badge**, niemals harte Zugangssperre
  (private Profile, Familienkonten, GOG-Besitzer).
- Philosophie-Bruch transparent machen: „Dieser eine optionale Schritt nutzt
  einen Mini-Relay; alles andere bleibt lokal."
- **Nicht tun:** Key in den Client; Bibliothek ohne `appids_filter` abrufen;
  SteamID persistieren; Assertion ohne `check_authentication` akzeptieren.

**Aufwand:** mittel (Relay + Nonce-Store + Datenschutztext + Betriebspflicht).
🟡 Zu validieren: Key-Härtung (Rate-Limits, Origin-Checks), Kosten/Quota bei
Community-Größe.

### Stufe 3 — Optional (später): Native Companion-App

- Kleine signierte Desktop-App (Tauri/Electron/Rust), die das
  Desktop-Konsensverfahren umsetzt (Registry → VDF → ACF → Installationspfad,
  optional Steam-Prozess-Erkennung) und dem Browser per `localhost`-HTTP nur
  das Prüfergebnis + Datei-Hinweise übergibt.
- Mehrwert: kein manuelles Ordner-Suchen, Multi-Bibliothek. **Bleibt
  clientseitig fälschbar** — als Komfort-/Robustheitsgewinn positionieren,
  nicht als Sicherheitsfeature. Klare Nachrangigkeit hinter Stufe 1–2.

### Explizit verworfen

- Publisher-APIs / Encrypted App Tickets (unmöglich ohne Square Enix).
- Nutzereigener API-Key im Browser (CORS erzwingt Proxy; UX schlechter als
  Stufe 2 bei geringerer Beweiskraft).
- Harte Zwangssperren auf Basis manipulierbarer Client-Prüfungen.

## 5. ADR-Vorschlag

| ADR | Entscheidung | Alternativen | Konsequenzen | Status |
|---|---|---|---|---|
| ADR-019 | Lizenznachweis als best-effort authenticity gate: Stufe 1 (lokal, FSA+Fingerprint+ACF) verbindlich, Stufe 2 (OpenID-Mini-Relay) opt-in mit Badge, Stufe 3 (Companion) zurückgestellt; keine harten Sperren | Serverpflicht für alle; nutzereigene Keys; gar kein Check | Philosophie bleibt intakt (Stufe 2 explizit optional); Piraterie-Abschirmung dokumentiert; Square-Enix-Signal; DSGVO-Berührung nur bei Opt-in | Vorgeschlagen |

**Einordnung in die Roadmap:** Stufe 1 passt als Teil von **S20** (Härtung:
R5-Matrix-Erweiterung) bzw. als kleiner Folgebogen nach S18 (App-Shell/
Diagnose-Export). Stufe 2 ist ein eigenständiges, klar abgegrenztes
Infrastruktur-Projekt außerhalb des Runtime-Strangs (🔴 Betreiberfrage: wer
hostet und betreut den Relay dauerhaft?).

## 6. Offene Fragen (🔴)

1. Betrieb/Verantwortlichkeit des Stufe-2-Relay (Kosten, Datenschutz,
   Key-Inhaberschaft) — Voraussetzung für jede Stufe-2-Umsetzung.
2. Vollständige Varianten-Matrix legaler Releases (Hashes je Release;
   Rerelease-AppIDs) — Pflegeprozess analog R5.
3. UX-Formulierung des Checks ohne rechtliche Überinterpretation
   („unterstützt legale Nutzung" statt „Lizenzprüfung").
4. Verhalten bei Family Sharing / Abo-Bezug (Steam-weit legitim, aber ohne
   eigenen Kauf) — als „legitim" klassifizieren (Empfehlung), dokumentieren.

## 7. Quellen (Auswahl)

**Steam-APIs/CORS/Limits:** partner.steamgames.com/doc/webapi/IPlayerService ·
partner.steamgames.com/doc/features/auth (+ #ownership) ·
steamcommunity.com/dev/apiterms (via Sekundärquellen: Unity-Forum 100k/Tag;
Playmoir-KB Key-Sharing) · eigener curl-Test 2026-08 (kein ACAO, Preflight 405)
**OpenID:** openid.net/specs/openid-authentication-2_0.html (§11.3/11.4
Replay) · volcengine.com-Praxisbeispiel (serverseitiges check_authentication)
**AppID/Varianten:** store.steampowered.com/app/39140/ · pcgamingwiki.com
(Final Fantasy VII; FF7 2020, steam_appid.txt 3837340)
**Client-Erkennung/FSA:** github.com/NPBruce/valkyrie#1056 ·
shaktech786/soundpad-pro GAME_DETECTION.md · testmuai.com FSA-Browser-Support ·
arxiv.org/pdf/2504.17692 · print3m.github.io (filejacking)
**Precedents:** openmw.org/faq · docs.scummvm.org · github.com/julianxhokaxhiu/
FFNx (how_to_install.md) · forums.qhimm.com (7th-Heaven-Checks) ·
Tsunamods-Statement (Steam-Guide 3118368057)
**Rechtliches:** outsideipcounsel.com (Sony v. Connectix; Sega v. Accolade) ·
wired.com/2009/05 (Crimson Echoes C&D) · mttlr.org 2012/09 (Fan-Remakes &
Copyright) · eylaw.de (EuGH relativer Personenbezug, Breyer/FIN)

*Vollständige Beleglage inkl. Einzelzitate: Recherche-Findings vom 2026-08
(Arbeitsdokument, auf Anfrage). Dieses Dokument ersetzt keine Rechtsberatung.*