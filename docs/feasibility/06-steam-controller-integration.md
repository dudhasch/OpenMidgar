# Machbarkeitsanalyse 06: Steam Controller Integration

**Thema:** Gamepad-/Controller-Support für WebMidgar, mit Fokus Steam Controller / Steam Input / Steam Deck
**Projekt:** WebMidgar (OpenMidgar) — Clean-Room-Reimplementierung der FF7-PC-Laufzeitumgebung (1998), vollständig im Browser (TypeScript, Three.js, Web Worker), deterministischer Fixed-Tick-Interpreter mit Eingabe-Replay
**Status:** Analyse / Empfehlung
**Datum:** 2026-08

---

## 1. Executive Summary

**Verdikt: Machbar — mit klarer Zweiteilung des Wegs.**

- **Stufe A (empfohlen, kurzfristig):** Gamepad-Support über die **W3C Gamepad API** direkt im Browser. Deckt Xbox-, PlayStation-, Switch-Pro- und — unter SteamOS — die Steam-Deck-eigenen Controller ab. Passt exzellent zum bestehenden Eingabe-Replay-Modell, weil die API ohnehin ein **Polling-/Snapshot-Modell** ist: Der Gamepad-Zustand wird pro Tick abgetastet und als Eingabedaten aufgezeichnet — Replay-Determinismus bleibt vollständig erhalten. Aufwand: **klein bis mittel** (ca. 1–2 Wochen inkl. Mapping-Profilen und Menü-Navigation).
- **Stufe B (optional, später):** Echtes **Steam Input (SAPI)** mit Action Sets, Geräte-Glyphs und Steam-Deck-Zertifizierung ist aus einem reinen Browser-Kontext **nicht erreichbar** — SAPI ist Teil des nativen Steamworks-C++-SDK und erfordert einen laufenden Steam-Client-Prozess. Der realistische Weg dorthin ist ein **nativer Wrapper (Electron/Tauri + steamworks.js)**. Aufwand: **mittel bis groß**, und er widerspricht teilweise der „kein nativer Code"-Prämisse des Projekts.
- **Der zentrale pragmatische Befund:** Auf dem Steam Deck erledigt der **Steam-Input-Configurator im Overlay** die Controller→Tastatur/Maus-Übersetzung **ohne jede SDK-Integration** — auch für Browser, die als „Non-Steam Game" eingebunden sind. WebMidgar muss dafür „nur" ein sauberes Gamepad-API-Mapping plus konsistente Tastatur-Fallbacks liefern; Steam-Nutzer/Community-Layouts übernehmen den Rest. Damit ist Steam-Deck-Spielbarkeit **kostenlos** erreichbar.

**Empfehlung:** Stufe A jetzt umsetzen, Stufe B als eigenes, späteres Vorhaben (nur falls eine Steam-Store-Veröffentlichung geplant wird).

---

## 2. Ausgangslage

- WebMidgar läuft vollständig im Browser; kein Server, kein nativer Code. Originaldaten werden lokal per **File System Access API** (FSA) eingebunden — das faktisch auf **Chromium-basierte Browser** (Chrome, Edge) einschränkt.
- Eingabe-Modell: deterministischer Fixed-Tick-Interpreter. Eingaben werden **als Daten pro Tick** erfasst, sodass Replays Digest-identisch sind. Jede neue Eingabequelle muss in dieses Modell passen (keine Event-Callbacks in Spiellogik, sondern Tick-Sampling).
- Aktuell ist die Steuerung tastatur-orientiert (Original-FF7-PC-Belegung: Numpad/Tasten, 8-Wege-Bewegung). Das Original von 1998 hat keine analoge Gamepad-Unterstützung (nur rudimentärer Digital-Joystick über DirectInput). *(Annahme auf Projektkontext-Basis; die späteren Square-Enix-Neuauflagen ab 2012/2013 sind native Windows-Ports mit eigener Steuerung, für WebMidgar nicht maßgeblich.)*
- Zielhardware dieser Analyse: Steam Deck (eingebaute Steuerung „Neptune"), Steam Controller (Gen 1, „VSC"; Gen 2, „Triton"), sowie generische Standard-Gamepads.

---

## 3. Recherche-Befunde

### 3.1 W3C Gamepad API (Browser-Standard)

- **Verfügbarkeit:** In allen modernen Browsern — Chrome 21+, Firefox 29+, Edge 12+, Safari 10.1+/14.1 (je nach Plattform); globale Abdeckung ~96 %. Chrome schränkt `navigator.getGamepads()` auf **Secure Contexts (HTTPS)** ein. Quellen: [^1][^2]
- **Modell:** `navigator.getGamepads()` liefert ein **Snapshot-Array** von `Gamepad`-Objekten mit `axes[]` (float, -1…+1), `buttons[]` (`pressed`, `value` 0–1, `touched`), `mapping`, `id`, `timestamp`. Verbindungs-Events: `gamepadconnected` / `gamepaddisconnected`. **Es gibt keine Button-Events** — die API ist von Grund auf Polling-basiert, üblicherweise im `requestAnimationFrame`-Rhythmus. Quellen: [^1][^2]
- **Standard-Mapping:** Xbox-artiges Layout (Buttons 0–16, Achsen 0–3) liegt vor, wenn `gamepad.mapping === "standard"`. Bei `mapping === ""` sind die Indizes herstellerspezifisch — hier braucht es eigene Profile oder Ablehnung. Quellen: [^2]
- **Gesture-Requirement:** Controller werden erst nach einem Nutzer-Geste (Tastendruck auf dem Pad bei fokussierter Seite) exponiert — Privacy-Schutz gegen Fingerprinting. Firefox liefert zudem in Hintergrund-Tabs/unfokussierten Fenstern nur Nullwerte. Quellen: [^1][^2]
- **Rumble:** `vibrationActuator` / `GamepadHapticActuator.playEffect("dual-rumble", …)` ab Chrome/Edge 89, in neueren Firefox-/Safari-Versionen teilweise; **nicht standardisiert einheitlich**, DualSense-Spezial-Haptics u. ä. bleiben außen vor. Feature-Detection + sanfte Degradation nötig. Quellen: [^1][^3]
- **Gyro/Bewegungssensoren:** Gehören **nicht** zur Gamepad API; dafür existiert kein standardisierter Browser-Zugriff auf Controller-IMUs (Generic Sensor API betrifft Gerätesensoren, nicht Gamepad-Gyros). → Gyro-gestützte Steuerung ist im Browser praktisch nicht portabel machbar. *(Befund aus Spec-Abdeckung; Annahme: kein relevanter Bedarf für FF7-Steuerung.)*
- **Kein Remapping durch die Seite:** Die API erlaubt kein systemweites Remapping; benutzerdefinierte Belegungen müssen im Spiel selbst implementiert werden. Quelle: [^2]

**Zwischenfazit:** Die Gamepad API ist funktional eine perfekte Ergänzung zum WebMidgar-Tick-Modell: Polling statt Events = Sampling pro Tick.

### 3.2 Steam Input (SAPI) — und warum es im Browser nicht geht

- **Was es ist:** `ISteamInput` ist eine Schnittstelle des **nativen Steamworks-SDK (C++)**. Kernkonzept: **aktionsbasiertes Eingabemodell** — das Spiel definiert in einer `game_actions_<AppID>.vdf` Action Sets (z. B. „Menu", „Gameplay") und digitale/analoge Actions; Steam mappt physische Eingaben beliebiger Controller (300+ Geräte) darauf. `RunFrame()` synchronisiert den Zustand; Zustände werden pro Frame gelesen (`GetDigitalActionData`, `GetAnalogActionData`). Quellen: [^4][^5]
- **Glyphs:** `GetGlyphForActionOrigin` / `GetGlyphPNGForActionOrigin` / `GetGlyphSVGForActionOrigin` liefern offizielle Button-Icons aus dem Steam-Client — geräteabhängig korrekt (PS-Buttons für PS-Pads usw.) und zukunftssicher. Valve empfiehlt, Origins **jedes Frame neu** abzufragen (User kann Konfiguration jederzeit ändern). Quelle: [^6]
- **Voraussetzung:** Laufender Steam-Client, gelinktes natives SDK, Steam-AppID. **Es gibt keine Web-/JS-Variante von SAPI.** Eine reine Browser-Seite kann Steam Input nicht direkt ansprechen. *(Zwingende Schlussfolgerung aus der SDK-Architektur; es existiert keine dokumentierte Web-API.)*
- **JS-Zugriff nur über Wrapper:** `steamworks.js` (ceifa) bzw. `steamworks-ffi-node` binden das native SDK in Node/Electron ein; Letzteres dokumentiert vollständige ISteamInput-Abdeckung (Action Sets, Glyphs, Motion-Daten, Haptics). Quellen: [^7][^5]
- **Praxisbeleg Electron:** Die Engine **Narrat** (HTML5/Electron) liefert produktiv Steam-Overlay, Achievements, „gamepad support compatible with Steam Input" und „Steam Deck native support" über steamworks.js im Electron-Main-Prozess. Achtung-Detail: Ab Electron 26.6 gab es Konflikte zwischen Chromiums Gamepad-Handling und Steam Input in WebGL-Builds — Steam Input musste dann direkt konfiguriert statt Chromium-Default genutzt werden. Quellen: [^8][^9]

### 3.3 Steam Deck Realität: Browser-Spiele ohne SDK spielbar

- **Der kostenlose Weg:** Chrome lässt sich im Game Mode als **Non-Steam Game** einbinden. Mit dem Steam-Input-Template **„Gamepad with Mouse Trackpad"** erscheint die Deck-Steuerung dem Browser gegenüber als Standard-Gamepad (Gamepad API!) bzw. Tastatur/Maus — **vollständig ohne SDK-Integration im Spiel**. Voraussetzung auf SteamOS: Flatpak-Override `flatpak --user override --filesystem=/run/udev:ro com.google.Chrome`, damit Chrome die Eingabegeräte sieht. Quelle: [^10]
- **Community-Layouts:** Der Configurator bietet Templates (z. B. „Keyboard (WASD) and Mouse") und **Community-Layouts**, die Nutzer teilen. Damit kann die Community WebMidgar-Belegungen selbst bauen und verteilen — sofern das Spiel auf klare Tastatur- bzw. Gamepad-Standard-Signale hört. Quellen: [^10][^11]
- **Bekannte SteamOS-Einschränkungen (relevant für WebMidgar!):**
  - Im **Desktop Mode** gilt für Non-Steam-Games u. U. das Desktop-Layout statt des Spiel-Layouts (Valve-Issue #8904). Quelle: [^12]
  - Browser, die über den Game Mode gestartet werden, **verlieren Cookies/Sessions** (SteamOS-Issue #1537) — kritisch, falls WebMidgar Zustände im Browser-Profil hält; FSA-Handles (IndexedDB) könnten ebenfalls betroffen sein *(Annahme, zu verifizieren)*. Quelle: [^13]
  - Jellyfin-Webclient-Issue: Gamepad-Unterstützung im Chrome-Flatpak unter Game Mode kann trotz Template brechen — die Kette Steam Input → Chromium-Gamepad-Stack ist konfigurationsempfindlich. Quelle: [^14]
- **Steam Controller (Gen 1, VSC):** Ohne Steam-Client verhält sich der Controller im Fallback als Tastatur/Maus; mit Steam Input ist er voll konfigurierbar. Der neue **Steam Controller 2 (Triton)** wird von Steam Input erkannt, aktuelle Steam-Clients haben aber noch Glyph-Lücken (Valve-Issue #13198) — relevant nur für Stufe B. Quelle: [^15]

### 3.4 Auswirkungen auf die Eingabe-Architektur

- **Determinismus:** Der Gamepad-Zustand wird **pro Tick** aus `navigator.getGamepads()` gelesen, durch Deadzone/Quantisierung normalisiert und als Eingabedatensatz des Ticks gespeichert. Da Replays ohnehin Eingabedaten statt DOM-Events aufzeichnen, bleiben Replays Digest-identisch — solange die Quantisierung deterministisch ist (feste Deadzone, feste Schwellen, keine Zeitstempel in der Spiellogik).
- **Analog → 8-Wege:** FF7s Walkmesh-Solver ist digital 8-Wege. Der Analogstick wird mit Deadzone (z. B. 0,25) und radialer Quantisierung auf 8 Richtungen abgebildet; analoge „Feinsteuerung" entfällt bewusst, weil die Spiellogik sie nicht kennt. Vorteil: identisches Verhalten zu Tastatur, keine Solver-Änderung nötig. Optional: analoge Betrags-Auswertung (leichtes Drücken = Gehen) als *reine Komfort-Funktion*, sofern sie deterministisch quantisiert wird (Gehen/Laufen ist im Original über eine Zusatztaste gelöst). *(Annahme auf Basis der Original-Steuerung.)*
- **UI-Navigation (S21):** Menüs benötigen digitale Navigation (D-Pad/Stick-Richtungstasten + Confirm/Cancel) plus Repeat-Logik (Initial-Delay + Wiederholrate) — muss tickbasiert implementiert werden, nicht über DOM-Keyrepeat.
- **Deadzones:** Konfigurierbar pro Profil, aber in den Replay-Daten nur der **quantisierte** Wert — Deadzone-Parameter gehören in die Konfiguration, nicht in den Eingabestrom.

---

## 4. Technischer Lösungsansatz (gestuft)

### Stufe A — Gamepad-API-Abstraktionsschicht (empfohlen, sofort)

**Ziel:** Standard-Gamepads + Steam-Deck-Steuerung (via Steam-Input-Template) funktionieren im Browser, Replay-sicher.

1. **Input-Source-Abstraktion in der field-runtime:** Neue Eingabequelle `GamepadSource` neben der bestehenden `KeyboardSource`. Beide produzieren dasselbe **logische Eingabemodell** (digitale Buttons: Confirm, Cancel, Menu, Run, …; Richtungsvektor 8-Wege). Die Tick-Engine kennt nur das logische Modell → Determinismus und Replay-Format bleiben unverändert.
2. **Tick-Sampling:** Pro festem Tick: `navigator.getGamepads()` → aktives Pad wählen (letztes Pad mit Aktivität) → Deadzone anwenden → Achsen auf 8-Wege quantisieren → Buttons auf logische Aktionen mappen → Eingabedatensatz des Ticks.
3. **Mapping-Profile:** Internes Standardprofil für `mapping === "standard"` (Xbox/Deck-Layout: A=Confirm, B=Cancel, X=Menu, Y=…, D-Pad + linker Stick = Bewegung, L1/R1 = Page-Switch). Für `mapping === ""`: Warnung + optional manuelles Profil (Kalibrier-Dialog). Kein systemweites Remapping möglich → In-Game-Remapping-Screen als eigener Menüpunkt.
4. **Menü-Navigation (S21-Anbindung):** Richtungstasten mit tickbasierter Wiederholung; Confirm/Cancel konsistent zum Tastatur-Layout.
5. **UX-Pflichten:** „Press any button"-Hinweis wegen Gesture-Requirement; Hinweis bei Verlust des Fensterfokus (Firefox liefert Nullwerte); optionale Rumble-Nutzung (Encounter-Start etc.) hinter Feature-Detection.
6. **Steam-Deck-Betrieb ohne SDK:** Dokumentiertes Setup (Chrome als Non-Steam Game, udev-Override, Template „Gamepad with Mouse Trackpad") + Bereitstellung eines **Referenz-Community-Layouts** (Tastatur-Fallback-Mapping auf die WebMidgar-Tasten) als Distribution-Beilage/Blogpost.

### Stufe B — Nativer Wrapper für echtes SAPI (optional, bei Steam-Release)

**Ziel:** Action Sets, native Glyphs, Steam-Overlay, ggf. Deck-Verifizierung — nur sinnvoll bei einer Steam-Store-Veröffentlichung.

1. **Electron- oder Tauri-Shell** um die unveränderte Web-App; `steamworks.js` (Electron, bewährt, vgl. Narrat) bzw. `steamworks-ffi-node` im Main-Prozess; IPC-Bridge exponiert Action-States an den Renderer.
2. **`game_actions_<AppID>.vdf`** mit Action Sets „Field", „Menu", „Battle"; digitale Actions analog zum logischen Eingabemodell aus Stufe A. Der Wrapper ersetzt nur die Input-Source — Tick-Sampling bleibt (jetzt aus SAPI-`RunFrame()`-Daten statt Gamepad API), **Replay-Format unverändert**.
3. **Glyphs:** dynamisch über `GetGlyphSVGForActionOrigin`, pro Frame neu abgefragt (Valve-Empfehlung), im UI-Layer (S21) gerendert.
4. **Risiken:** Electron/Chromium-Gamepad-Konflikte (vgl. Electron 26.6-Issue) → in der Steam-Build-Konfiguration Steam Input „Forced On" setzen und Chromium-Gamepad-Pfad deaktivieren; Steamworks-Lizenz/AppID erforderlich; Abkehr vom „kein nativer Code"-Prinzip (Wrapper, nicht Spiellogik).

### Stufe C — Steam-Deck-Betriebshinweise (unabhängig, sofort dokumentierbar)

- Chrome-Flatpak als Non-Steam Game; udev-Override; Template-Auswahl; Kiosk-Startoptionen (`--kiosk <url>`) für konsolenartiges Gefühl.
- Warnung vor Session-/Cookie-Verlust im Game Mode (SteamOS-Issue #1537) → WebMidgar sollte Zustand robust in IndexedDB/FSA halten und Neuanmeldung/Datei-Neuwahl tolerieren.
- Hinweis auf Desktop-Mode-Layout-Falle (Valve-Issue #8904).
- FSA bedeutet: Deck-Nutzer müssen Chrome/Chromium nutzen (Firefox entfällt für FSA-Workflows).

---

## 5. Aufwandsschätzung

*(Personentage, grob, Annahme: bestehende Tastatur-Eingabeschicht ist sauber separiert.)*

| Baustein | Aufwand |
|---|---|
| A1: Input-Source-Abstraktion + GamepadSource mit Tick-Sampling | 3–5 PT |
| A2: Mapping-Profile (Standard-Mapping, Deadzone, 8-Wege-Quantisierung) + In-Game-Remapping | 3–4 PT |
| A3: Menü-/UI-Navigation mit Gamepad (S21) inkl. Repeat-Logik | 2–4 PT |
| A4: UX-Hinweise (Gesture, Fokus), Rumble (optional, feature-detected) | 1–2 PT |
| A5: Steam-Deck-Setup-Doku + Referenz-Community-Layout, Tests auf Deck | 2–3 PT |
| **Stufe A gesamt** | **~11–18 PT (2–4 Wochen)** |
| B: Electron-Wrapper + steamworks.js + Action Sets + Glyphs + Steam-Build | 15–30 PT (zusätzlich: Steamworks-Onboarding, AppID, Store-Prozess) |
| C: Betriebshinweise (in A5 enthalten bzw. 1 PT eigenständig) | 1 PT |

---

## 6. Risiken & offene Fragen

1. **Browser-Fokus:** Gamepad-Eingaben hängen am Fensterfokus; Firefox liefert im Hintergrund Nullwerte; Chrome verlangt User-Geste. → UI muss „Controller nicht erkannt / Taste drücken" sauber behandeln. *(Befund: [^1][^2])*
2. **FSA = Chrome-Only:** Da Originaldaten per FSA geladen werden, ist die Zielplattform ohnehin Chromium — auf dem Deck muss Chrome-Flatpak genutzt werden. Firefox-Gamepad-Pfad ist für WebMidgar zweitrangig.
3. **SteamOS-Session-Verlust (Game Mode):** Cookies/Logins gehen verloren; Auswirkung auf FSA-Handles in IndexedDB **ungetestet** — Risiko für „Originaldaten einmalig einbinden"-Flow. *Offener Punkt: Test auf echter Hardware nötig.* *(Befund: [^13])*
4. **Rumble/Gyro:** Rumble inkonsistent (nur Chromium zuverlässig); Gyro nicht standardisiert → beides nur optionaler Komfort, nie Spiellogik-relevant.
5. **Steam Controller Gen 1 ohne Steam:** verhält sich wie Tastatur/Maus → Tastatur-Fallback-Qualität entscheidet; Gen 2 (Triton) Glyph-Lücken betreffen nur Stufe B. *(Befund: [^15]; Gen-1-Fallback: Valve-Dokumentationsstand, Annahme „Lizard Mode" weiterhin gültig.)*
6. **Replay-Konsistenz über Quellen:** Ein Replay, das mit Tastatur aufgezeichnet wurde, muss mit Gamepad-Quelle abspielbar sein (und umgekehrt) — gewährleistet, da nur das logische Modell aufgezeichnet wird; **Muss durch Digest-Tests abgesichert werden.**
7. **Electron-Konflikte (nur Stufe B):** Chromium-Gamepad vs. Steam Input (Electron ≥ 26.6). *(Befund: [^9])*
8. **Offen:** Deck-Performance der WebMidgar-Runtime (Three.js auf Van-Gogh-APU) ist nicht Gegenstand dieser Analyse, aber Voraussetzung für sinnvollen Deck-Support.

---

## 7. Abhängigkeiten

- **S20 (Eingabebasis, Annahme: Tastatur-/Eingabeschicht):** Stufe A setzt eine sauber isolierte Eingabequellen-Abstraktion voraus; falls S20 das logische Eingabemodell bereits definiert, sinkt A1-Aufwand deutlich. *(S20-Bezeichnung aus Projektplanung übernommen; Inhalt Annahme.)*
- **S21 (Menü-/UI-System):** A3 (Gamepad-Menü-Navigation, Repeat-Logik, Glyph-Darstellung in Stufe B) baut direkt auf S21 auf. Reihenfolge: S21-Navigationsmodell sollte gamepad-agnostisch (richtungsbasiert) ausgelegt sein.
- **Keine Abhängigkeit zu Server-Infrastruktur;** Stufe B hängt an Steamworks-Onboarding (außerhalb des Codes).

---

## 8. Empfehlung

1. **Jetzt: Stufe A umsetzen** (Gamepad API, Tick-Sampling, Standard-Mapping-Profil, In-Game-Remapping, Menü-Navigation). Das erschließt Xbox/PS/Switch-Pads **und** das Steam Deck — letzteres über das offiziell dokumentierte Chrome-als-Non-Steam-Game-Setup mit Steam-Input-Template, **ohne SDK, ohne nativen Code, ohne Steamworks-Onboarding**.
2. **Determinismus als Akzeptanzkriterium:** Replay-Digest-Tests (Tastatur-Replay ↔ Gamepad-Replay, gleiche logische Eingaben ⇒ identische Digests) in die CI aufnehmen.
3. **Steam-Deck-Härtung als Pflichtübung:** Einmal-Test auf echter Hardware (FSA-Persistenz im Game Mode, Fokusverhalten, Template-Verhalten) — die dokumentierten SteamOS-Issues (#8904, #1537, jellyfin-web #4296) zeigen, dass die Kette empfindlich ist.
4. **Stufe B nur bei Steam-Store-Absicht:** Electron + steamworks.js ist der bewährte Pfad (Narrat-Präzedenzfall), aber kosten- und prinzipienträchtig (nativer Wrapper). Bis dahin liefern Tastatur-Fallback + Community-Layouts 90 % des Nutzwerts.
5. **Nicht verfolgen:** Gyro-Steuerung, DualSense-Spezialhaptics, systemweites Remapping — im Browser nicht standardisiert/nicht möglich.

---

## 9. Quellen

[^1]: JoyCheck — „How JoyCheck Reads Your Controller (W3C Gamepad API)": https://joycheck.io/how-it-works/
[^2]: TestMu AI — „Gamepad API: Browser Support, Features, Known Issues": https://www.testmuai.com/learning-hub/gamepad-api-browser-support/
[^3]: DeviceHub — „Vibration Test (GamepadHapticActuator)": https://www.testdevicehub.com/vibration-test/
[^4]: Steamworks-Dokumentation — „ISteamInput Interface": https://partner.steamgames.com/doc/api/isteaminput
[^5]: steamworks-ffi-node — „Steam Input Manager API Documentation": https://github.com/ArtyProf/steamworks-ffi-node/blob/main/docs/INPUT_MANAGER.md
[^6]: Steamworks-Dokumentation — „Getting Started for Developers (Steam Input), On-screen Glyphs": https://partner.steamgames.com/doc/features/steam_controller/getting_started_for_devs
[^7]: liana.one — „How to integrate Steamworks.js in Electron": https://liana.one/integrate-electron-steam-api-steamworks
[^8]: Narrat Docs — „Steam Integration (Electron, Steam Input-kompatibler Gamepad-Support, Steam Deck native)": https://docs.narrat.dev/guides/steam-publishing.html
[^9]: steamworks.js Issue #185 — Electron 26.6 / Chromium-Gamepad vs. Steam Input: https://github.com/ceifa/steamworks.js/issues/185
[^10]: GamingOnLinux — „Chrome on Steam Deck now supports the Deck Controller" (udev-Override, „Gamepad with Mouse Trackpad"-Template): https://www.gamingonlinux.com/2022/03/chrome-on-steam-deck-now-supports-the-deck-controller-with-geforce-now-working/
[^11]: Luanti Docs — „Gamepads: Steam Input ohne SDK, Templates & Community-Layouts, Desktop & Deck": https://docs.luanti.org/for-players/gamepads/
[^12]: ValveSoftware/steam-for-linux Issue #8904 — Desktop Mode: Non-Steam-Games nutzen Desktop-Layout: https://github.com/ValveSoftware/steam-for-linux/issues/8904
[^13]: ValveSoftware/SteamOS Issue #1537 — Browser-Sessions gehen im Game Mode verloren: https://github.com/ValveSoftware/SteamOS/issues/1537
[^14]: jellyfin-web Issue #4296 — Gamepad-Support im Chrome-Flatpak auf Steam Deck gebrochen: https://github.com/jellyfin/jellyfin-web/issues/4296
[^15]: ValveSoftware/steam-for-linux Issue #13198 — Steam Controller 2 (Triton) Glyph-Lücken bei ISteamInput: https://github.com/ValveSoftware/steam-for-linux/issues/13198