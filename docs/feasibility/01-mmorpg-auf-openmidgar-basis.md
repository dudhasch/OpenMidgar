# Machbarkeitsanalyse: FF7-MMORPG auf OpenMidgar-Basis („WebMidgar")

**Status:** Analyse-Entwurf
**Datum:** 2026-08-09
**Gegenstand:** Könnte man aus WebMidgar (github.com/dudhasch/OpenMidgar) ein Massively-Multiplayer-Online-Spiel im FF7-Universum machen?
**Hinweis:** Alle Aufwands- und Skalierungszahlen sind grobe Schätzungen und als solche markiert. Diese Analyse ersetzt keine Rechtsberatung.

---

## 1. Executive Summary

**Gesamtverdikt: Bedingt Go — als Co-op-Feature (2–8 Spieler) ja, als „volles MMORPG" auf FF7-IP derzeit No-Go.**

Kurzfassung der Begründung:

- **Technisch überraschend gut positioniert.** WebMidgar besitzt mit dem deterministischen Fixed-Tick-Interpreter (30 Ticks/s, serialisierbarer Zustand, Snapshot/Restore, Replay-Digests) genau die Eigenschaft, die Multiplayer-Architekturen sonst teuer nachträglich erkämpfen müssen: reproduzierbare Simulation. Das TypeScript-Monorepo erlaubt zudem Code-Sharing zwischen Browser-Client und Node-Server — derselbe Interpreter kann serverseitig als Autorität laufen.
- **Aber: Es gibt kein „Spiel" im MMO-Sinn.** Battle-Modul (ADR-011, Stub, Post-1.0), Worldmap (Post-1.0-Ausblick) und Menü (S21 geplant) fehlen. Ein MMORPG auf dem heutigen Stand wäre ein gemeinsam begehbarer Field-Viewer mit Chat — kein Spiel.
- **Rechtlich der dominante Blocker.** Square Enix hat eine dokumentierte Historie von Cease-and-Desists gegen Fanprojekte (Chrono Trigger: Crimson Echoes, Chrono Trigger: Resurrection, FF-Type-0-Fanübersetzung). Der Clean-Room-/BYO-Data-Ansatz von WebMidgar (Originaldaten nur lokal per File System Access API, nichts wird distribuiert) ist die derzeit beste bekannte Schutzstrategie — vergleichbar mit PokeMMO, das mit genau diesem Modell seit über einem Jahrzehnt online ist. Ein **Serverbetrieb mit Accounts und Persistenz** ändert die Risikolage aber qualitativ: Man betreibt dann einen dauerhaften, öffentlichen „Spiele-Service" auf fremder IP, statt nur ein Werkzeug zu verteilen.
- **Empfehlung:** Netzwerk-Fähigkeit als **Co-op-Architektur** (server-autoritativ, instanziiert pro Field, kleine Gruppen) auf die Roadmap nach 1.0 setzen, als nicht-kommerzielles, nicht „FF7"-gebrandetes Experiment. „Massively" (tausende Spieler, persistente Welt, Economy) ist für dieses Projekt absehbar weder technisch noch rechtlich tragfähig.

---

## 2. Ausgangslage

### 2.1 Ist-Stand WebMidgar

Laut Projektbeschreibung und Repo-Dokumentation (`docs/WEBMIDGAR-MASTERPLAN.md`):

| Aspekt | Stand |
|---|---|
| Architektur | TypeScript-Monorepo, Three.js-Renderer, Web-Worker-Pipeline, IndexedDB-Caches |
| Netzwerk | **Keins.** 100 % clientseitig, kein Server, kein Netzwerk-Code |
| Originaldaten | Nur lokal per File System Access API; kein Upload, keine Distribution |
| Kernsimulation | Deterministischer, tick-basierter Opcode-Interpreter (Field-Skriptsystem); Logiktakt fix (Kalibrierziel 30 Ticks/s), entkoppelt vom Renderframe (Accumulator); streng stabile Ausführungsreihenfolge; Instruktionsbudget pro Kontext |
| Determinismus-Nachweis | 702/702 Fields deterministisch; Snapshot/Restore; Replay-Digests (State-Hashes) |
| Weitere Systeme | Walkmesh-Solver (Sliding, Trigger/Gateways), Dialogsystem, eigenes Save-Format |
| Modsystem | Deklarativ (.wmmod), ADR-007: kein Runtime-Code in Mods |
| Persistenz | IndexedDB, versionierte Cache-Keys, Auto-Resume bei Tab-Suspendierung |
| Relevante Pakete | `interpreter`, `field-runtime`, `formats-save`, `formats-field`, `walkmesh`, `dialog`, `render-field`, `render-actor`, `cache`, `io`, `modding`, `app-shell` |

### 2.2 Was für ein MMO fehlt

1. **Netzwerkschicht komplett** (Transport, Protokoll, Sessions, Reconnect).
2. **Server** (Autorität, Instanzen, Persistenz, Betrieb/Hosting, Monitoring).
3. **Accounts & Authentifizierung** (inkl. DSGVO-relevanter Pflichten bei personenbezogenen Daten).
4. **Spielsysteme:** Battle (ADR-011, Stub), Worldmap, Menü, Inventar/Charakterprogression.
5. **MMO-spezifische Systeme:** Chat, Gruppen/Gilden, Handel, Anti-Cheat, Moderation, Interest Management, Sharding.
6. **Rechtssichere Positionierung** des Serverbetriebs (Namensrecht/Markenrecht, Nutzungsbedingungen, Haftung).

Der Sprung „Singleplayer-Engine" → „MMORPG" ist also kein Feature-Increment, sondern eine neue Produktkategorie. Realistisch ist nur der Zwischenschritt **Multiplayer-Co-op** (s. Abschnitt 3).

---

## 3. Zielbild-Varianten — realistische Abgrenzung

| Variante | Beschreibung | Spieler/Instanz | Machbarkeit | Verdikt |
|---|---|---|---|---|
| **A: Co-op klein** | Gemeinsames Begehen von Fields, 2–8 Spieler, Session-basiert (Raum-Code), Chat, Emotes; Fortschritt bleibt lokal pro Spieler | 2–8 | Hoch; baut direkt auf deterministischem Interpreter auf; bekannte Browser-Architekturmuster (WebSocket + Server-Autorität) reichen | **Go (empfohlener Pfad)** |
| **B: Persistente Welt (instanziiert)** | Viele Spieler aufgeteilt auf Field-Instanzen (z. B. 20–50 je Field), serverseitige Charakter-Persistenz, Accounts, soziale Systeme; „MMO-Gefühl" in Midgar-Sektoren | 20–100/Field, wenige hundert gesamt | Mittel; technisch machbar mit Room/Instanz-Architektur (Colyseus-Muster), aber erfordert Serverbetrieb, Accounts, Moderation — und setzt Battle/Worldmap voraus, um ein „Spiel" zu sein | **Bedingt Go** (nur nach Battle + rechtlicher Klärung) |
| **C: Volles MMORPG** | Persistente Welt ohne harte Instanzen, tausende CCU, Economy, Grinden, Raids | 1.000+ | Gering; Rendering- und Simulationskosten im Browser, Ops-Aufwand, Anti-Cheat, und rechtlich praktisch sicherer C&D-Fall | **No-Go** |

**Wichtige Einschränkung für alle Varianten:** Ohne Battle-Modul fehlt der Kernspiel-Loop. Variante A ist auch *vor* Battle sinnvoll (Erkunden/Chat/Demo-Charakter), Variante B/C erst danach.

---

## 4. Technischer Lösungsansatz

### 4.1 Leitprinzipien

- **Server-Autorität.** Kein P2P-Trust: Clients senden Eingaben/Intentionen, der Server entscheidet. Das ist der etablierte Standard für Browser-Multiplayer (vgl. Colyseus: „authoritative game servers", WebSocket-basiert, automatische State-Synchronisation) und verhindert die trivialsten Cheats.
- **Code-Sharing ausnutzen.** Weil Client und Server beide TypeScript sprechen, kann das Paket `interpreter` (+ `field-runtime`, `walkmesh`, `formats-field`, `formats-save`) **unverändert serverseitig** (Node/Bun/Deno) laufen. Das ist der zentrale Architekturvorteil gegenüber Engines, die Client und Server in verschiedenen Sprachen pflegen müssen. Analoges Muster dokumentiert für Node-Lockstep-Architekturen (Shared-Simulator in `/shared`).
- **Determinismus als Validierungswerkzeug, nicht als Sync-Mechanismus** (Details 4.3).

### 4.2 Transport: WebSocket, nicht WebRTC DataChannel

Empfehlung: **WebSocket (wss)** als einziger Client-Transport.

- WebSocket läuft über TCP: verlässlich, geordnet — für ein 30-Hz-RPG mit diskreten Skript-Events ist das ausreichend und deutlich einfacher zu skalieren.
- WebRTC DataChannel (UDP, P2P-orientiert) bietet minimal niedrigere Latenz, ist aber für Client-Server-Topologien komplexer (Signaling, TURN/STUN, Server-seitige DataChannel-Stacks sind Nischenlösungen) und lohnt sich primär für P2P oder Actionspiele mit Frame-Präzision (Quelle: Ably, „WebRTC vs. WebSocket"). Für ein FF7-Field-RPG ohne Echtzeit-Trefferphysik bringt es keinen Mehrwert, der die Komplexität rechtfertigt.
- Server-intern können später WebTransport/QUIC evaluiert werden — kein Startpunkt.

### 4.3 Sync-Modell: Server-autoritative State-Sync mit deterministischer Verifikation

**Ausgangslage:** WebMidgars Fixed-Tick-Determinismus (30 Ticks/s, Snapshot/Restore, Replay-Digests) legt deterministisches Lockstep nahe — das Modell klassischer RTS (StarCraft/Age of Empires): nur Inputs übertragen, jeder Client simuliert identisch (Quelle: Socratopia/Math for Game Devs, Kap. „Lockstep").

**Bewertung: Lockstep passt nur eingeschränkt.**

*Dafür spricht:*
- Identische Eingaben + identischer Datenbestand ⇒ identischer Zustandsverlauf ist projektweit bereits bewiesen (702/702 Fields, Replay-Digests).
- Bandbreite minimal (nur Inputs); Replay/Debugging gratis.

*Dagegen spricht (gewichtig):*
- **Browser sind keine Lockstep-freundliche Umgebung:** Tabs werden vom Browser pausiert/gedrosselt (Timer-Throttling, `freeze`-Events); Tickrate und Paketankunft sind nicht garantiert. Ein strenges Lockstep würde bei jedem Hintergrund-Tab die ganze Session einfrieren — in der Fachliteratur explizit als Problem des Browser-Umfelds beschrieben (AIRCC-Paper zu WebRTC-Multiplayer im Browser).
- **Cross-Engine-Determinismus ist fragil:** Die 702/702-Determinismusgarantie gilt für dieselbe Codebasis/dieselbe Datenlage. Ob sie über Browser-Engines (V8/JSC/SpiderMonkey) und Plattformen hinweg bit-identisch bleibt (insb. `Math.*`-Funktionen, Float-Semantik in Randfällen), ist **nicht belegt** — Annahme, die per Testmatrix zu validieren wäre.
- **Lockstep skaliert sozial schlecht:** Jeder hinkende Spieler bremst alle. Für Drop-in/Drop-out (MMO-Grundanforderung) ist Lockstep strukturell ungeeignet; Reconnect erfordert Snapshot-Übertragung ohnehin.
- **Cheating:** Reines Client-Lockstep ohne Server-Simulation ist manipulierbar.

**Empfohlener Ansatz — Hybrid:**

1. **Server simuliert autoritativ:** Der Server führt pro Field-Instanz denselben Fixed-Tick-Interpreter aus (Code-Sharing). Skriptzustände, Trigger, Dialoge, NPC-Logik entstehen ausschließlich dort.
2. **Spielerbewegung:** Client-seitige Prediction (lokale Walkmesh-Simulation wie heute) + Server-Reconciliation. Server prüft Bewegung serverseitig gegen das Walkmesh (Anti-Teleport/Wallhack) mit Toleranzen. Für ein 30-Hz-RPG ohne PvP-Timing reicht ein einfaches Reconcile-Modell (letzter bestätigter Tick + Reapply unbestätigter Inputs); aufwändiges Rollback-Netcode ist nicht nötig.
3. **State-Sync für Fremdspieler/NPCs:** Delta-komprimierte Positions-/Animations-Updates (Patch-Rate 10–20 Hz), Interpolation auf den Clients. Muster: Colyseus-Schema/Patch-Rate (Default 50 ms) als Referenzimplementierung; Eigenbau mit binärem Delta-Protokoll ist im Monorepo ebenso gut möglich.
4. **Replay-Digests als Anti-Desync-Infrastruktur:** Clients hashen lokalen simulierten Zustand pro Tick-N und vergleichen mit Server-Digest. Divergenz ⇒ autoritativer Snapshot-Pull. Die vorhandene Snapshot/Restore-Fähigkeit macht dieses „Resync per Snapshot" billig — das ist ein echter Alleinstellungsvorteil.
5. **Persistenz:** `formats-save` als Serialisierungsbasis; serverseitige DB (z. B. PostgreSQL/SQLite) speichert Charakterstände versionsgebunden; lokale IndexedDB bleibt Offline-/Cache-Ebene.

### 4.4 Instanzierung & Interest Management

- **Eine Room-/Instanz-Einheit pro Field** (Colyseus-Room-Muster: „From a single Room definition, clients are matched into multiple Room instances"). Field-Wechsel = Room-Wechsel; Gateway-Trigger des Walkmesh-Systems liefern dafür bereits die natürlichen Übergangspunkte.
- **Interest Management innerhalb eines Fields:** Bei kleinen Fields und fixen Kameras ist Sichtbarkeit praktisch „alle im Field". Erst bei >50 Spielern/Field lohnt Distanz-basierte Filterung (Area-of-Interest um die aktive Kamera).
- **Sharding:** Horizontale Skalierung über Prozesse/Hosts, je Prozess n Field-Instanzen (Zielgrößenordnung 20–50 Spieler/Instanz; Begründung s. 4.6). Ein Presence-/Matchmaking-Dienst (Redis-ähnlich) vermittelt Room↔Server. Colyseus demonstriert dieses Muster inkl. RedisPresence; SpacetimeDB zeigt die radikalere Alternative (Datenbank als Server, BitCraft-Referenz mit tausenden Spielern — aber Modul-Ökosystem in Rust/C#, kein direkter Import des TS-Interpreters; daher als **Inspiration, nicht als Empfehlung**).

### 4.5 Server-Optionen im Vergleich

| Option | Charakter | Bewertung für WebMidgar |
|---|---|---|
| **Eigener Node/Bun-Server** | Volle Kontrolle, direktes Code-Sharing des Interpreters | **Empfohlen.** Größter Hebel: identische Simulationspakete client- und serverseitig |
| **Colyseus** | Authoritative Node-Framework, Rooms, State-Sync, Matchmaking, MIT-lizenziert | Gute Referenz/Beschleuniger für Variante A/B; Room-Modell passt exakt auf Field-Instanzen |
| **SpacetimeDB** | DB+Server in einem, Module in Rust/C#/TS, BitCraft-Referenz | Architektonisch interessant (Persistenz + Sync in einem), aber Interpreter müsste in ein Modul-Ökosystem portiert werden; Lizenz BSL 1.1 → AGPL; zusätzliche Plattformabhängigkeit |
| **WebRTC P2P** | Kein Server, Host-Migration nötig | Nur für 2-Spieler-Demo denkbar; kein Cheat-Schutz, kein Drop-in/Drop-out-Komfort — nicht zielführend |

### 4.6 Skalierungsrealität: Wie viele Spieler pro Field?

**Rendering (Client, Three.js):** FF7-Field-Modelle sind sehr low-poly (wenige hundert bis ~1.500 Dreiecke, einfache Skelette). Erfahrungswerte aus der Three.js-Community: Bei ~200–300 eigenständig animierten SkinnedMeshes bricht die CPU-Seite (AnimationMixer, Bone-Matrix-Updates, updateMatrixWorld) auf älterer Hardware unter 60 fps ein; mit Animation-Throttling, detached bindMode und Skeleton-Sharing sind ~500 Einheiten in RTS-Szenen demonstriert worden (Three.js-Discourse, Okt./Nov. 2023). Für realistische Spieler-Modelle mit individuellen Animationen, Kamera-Nahansicht und schwächeren Geräten (Annahme):

- **Komfortabel:** 20–50 sichtbare Spieler + NPCs pro Field-Kamera.
- **Machbar mit Optimierung (Throttling, LOD, Animation-Sharing, Culling):** ~100.
- **>200 sichtbar:** erfordert GPU-Skinning/Instancing-Umbauten — Aufwand, der im Verhältnis zum Nutzen (FF7-Fields sind klein) nicht steht.

**Netzwerk/Server:** Trivial im Vergleich: 50 Spieler × Positions-Delta (≈30–60 Byte) × 15 Hz ≈ 25–45 kB/s Upstream pro Instanz — für Node-Prozesse unproblematisch; hunderte Instanzen pro Host vorstellbar (Schätzwert, lastzutesten).

**Konsequenz:** „Massively" entsteht hier — wie in echten MMOs — durch **viele Instanzen**, nicht durch viele Spieler pro Szene. Das Field-System von FF7 (702 kleine, diskrete Orte mit Gateway-Übergängen) ist für Instanz-basiertes Sharding sogar strukturell ideal.

---

## 5. Aufwandsschätzung (grob)

Alle Angaben: **Schätzung, 1 erfahrene:r Entwickler:in Vollzeit-Äquivalent (Personenmonate, PM)**, inklusive Tests, ohne Design/Content. Begründung in Klammern.

| Baustein | Aufwand | Begründung |
|---|---|---|
| Netcode-Spike: Interpreter über 2 Browser synchron (WebSocket-Relay, Input-Sync, Digest-Vergleich) | 1–2 PM | Vorhandene Determinismus-/Replay-Infrastruktur senkt Risiko; Unsicherheit: Cross-Browser-Determinismus |
| Variante A: Co-op (Server-Autorität, Rooms, Movement-Prediction/Reconcile, Chat, Session-Codes) | 6–10 PM | Code-Sharing hilft massiv; Hauptarbeit: Protokoll, Reconcile, Room-Lifecycle, Edge-Cases (Reconnect, Tab-Suspend) |
| Accounts, Auth, serverseitige Persistenz (Charakterstände via `formats-save`) | 3–5 PM | Standardwerk, aber Datenschutz/Security nicht unterschätzen |
| Variante B zusätzlich: Instanz-Orchestrierung, Matchmaking/Presence, soziale Basissysteme, Moderation, Ops/Hosting | 8–15 PM | Ops-Daueraufwand (Betrieb!) nicht in PM enthalten |
| Rendering-Optimierung für 50–100 sichtbare Akteure | 2–4 PM | Throttling/LOD/Animation-Sharing sind bekannte Muster |
| **Variante C (volles MMORPG)** | **mehrere Personenjahre (Größenordnung 3–6+ PJ)** | zusätzlich Battle-MMO-tauglich, Worldmap, Economy, Anti-Cheat, LiveOps, CS/Moderation — jenseits der realistischen Projektkapazität |

**Summe bis Variante B (spielbarer Zustand inkl. Accounts):** grob **20–35 PM** — und das setzt ein existierendes Battle-Modul **nicht** voraus; Battle selbst ist ein eigenes, bereits als Post-1.0 eingeordnetes Großprojekt.

---

## 6. Risiken & offene Fragen

### 6.1 Rechtlich (dominantes Risiko) 🔴

- **Square-Enix-C&D-Historie:** Chrono Trigger: Crimson Echoes wurde 2009 nach ~4–5 Jahren Entwicklung kurz vor Release per C&D beerdigt; zuvor traf es Chrono Trigger: Resurrection und das Chrono Trigger Remake Project; 2013 die FF-Type-0-Fanübersetzung. Square Enix gehört zu den eskalationsfreudigeren IP-Inhabern (Quellen: Chrono Compendium, NeoGAF-Thread zum Type-0-C&D).
- **Der Clean-Room-/BYO-Data-Rahmen ist das Fundament des Projekts** — und der einzige dokumentierte Dauer-Überlebenspfad für Fan-MMOs: **PokeMMO** läuft seit ~2012 online, weil es keine ROMs/Assets distribuiert, sondern Nutzer:innen ihre eigenen legalen Spieldaten bereitstellen müssen; Pokenet dagegen (Pokémon-MMO mit eigener Distribution/Domain) wurde 2010 von Nintendo per C&D geschlossen (Quellen: Engadget 2010; RaGEZONE-/PokeMMO-Foren zur Rechtslogik). WebMidgar folgt bereits exakt dem PokeMMO-Muster — **ein Multiplayer-Server darf diese Disziplin nicht brechen:** keine Assets, keine extrahierten Daten, keine Namen/Logos von Square Enix auf dem Server oder im Marketing.
- **Was sich durch einen Server ändert:** Aus „Werkzeug, das lokal legale Daten verarbeitet" wird ein „öffentlich betriebener Online-Dienst im FF7-Universum". Markenrecht (Begriffe wie „Final Fantasy", „Midgar", Charakternamen in Domain/Branding), wettbewerbsrechtliche Aspekte und die reine Sichtbarkeit (Server mit Accounts = angreifbare Zielpersonen) erhöhen das Risiko. **Monetarisierung jeder Art (auch „Spenden für Serverkosten") ist der dokumentierte Eskalationsauslöser** (vgl. PokeMMO-Community-Regeln zu Verkauf von Inhalten).
- **Offene Fragen (Recht):** Darf ein Server überhaupt *Spielzustände* (Positionen, Skript-Variablen) halten, ohne abgeleitete Werke der IP zu hosten? (Wahrscheinlich ja — Zustände sind keine geschützten Inhalte — aber ungeprüft; Annahme.) Wie steht es um Nutzernamen/Chat-Moderation (Haftung für Nutzerinhalte)? Lohnt sich eine anwaltliche Vorab-Einschätzung vor Variante B? **Empfohlen: ja, spätestens vor öffentlichem Serverbetrieb.**

### 6.2 Technisch

- **Cross-Browser-Determinismus unbewiesen** (V8/JSC/SpiderMonkey, `Math.*`, Float-Randfälle). Mitigation: Server ist alleinige Simulationsautorität; Digests dienen nur der Erkennung, Snapshot-Resync der Heilung. Testmatrix nötig.
- **Tab-Suspendierung** kollidiert mit jeder Form von Echtzeit-Sync; das vorhandene Auto-Resume (Snapshot vor `freeze`/`hidden`) muss netzwerktauglich werden (Reconnect + Snapshot-Pull statt nahtlosem Fortsetzen).
- **Cheat-Oberfläche wächst:** Movement muss serverseitig gegen Walkmesh validiert werden; Savegame-Integrität (lokale IndexedDB ist manipulierbar) verlangt serverseitige Autorität über alles Wertige.
- **Rendering-Skalierung** begrenzt sichtbare Spielerzahlen (s. 4.6); „Overcrowded Midgar" wäre auch eine UX-Frage (Kollisionen, Nametags).
- **Betrieb ist Dauerlast:** Hosting-Kosten, Monitoring, Abuse/Moderation, DSGVO — für ein Freizeit-Open-Source-Projekt der unterschätzteste Faktor.

### 6.3 Produkt/Scope

- Ohne Battle gibt es **keinen MMO-Spiel-Loop** (kein Kampf, keine Progression, kein Grund zu kooperieren). Variante A ist eine Tech-Demo mit sozialem Charakter — das muss kommuniziert sein.
- Scope-Creep-Gefahr: „Erst mal nur Co-op" zieht unweigerlich Forderungen nach Persistenz, Accounts, Handel nach sich.

---

## 7. Abhängigkeiten zur Projekt-Roadmap

| Abhängigkeit | Roadmap-Status | Relevanz für Multiplayer |
|---|---|---|
| **Battle-Modul** (ADR-011) | Stub, Post-1.0 | Voraussetzung für Variante B/C und für jede „echte" Co-op-Spielerfahrung |
| **Worldmap-Modul** | Post-1.0-Ausblick | Voraussetzung für „Welt"-Gefühl; ohne Worldmap bleibt es Field-Hopping |
| **Menü/Inventory** | S21 geplant | Charakterfortschritt/Equipment serverseitig persistierbar erst mit Menü-Systemen sinnvoll |
| **Save-Format** (`formats-save`) | vorhanden | Basis serverseitiger Charakter-Persistenz; Versionsdisziplin wird kritischer |
| **Modsystem (ADR-007)** | deklarativ, kein Runtime-Code | **Positive Synergie:** Deklarative Mods sind netzwerksicher (kein Client-Code, keine Cheat-Vektoren über Mods). Regel muss gelten: Mods müssen für alle Instanz-Teilnehmer identisch sein (Server erzwingt Mod-Set + Hash) |
| **Determinismus-/Replay-Infrastruktur** | vorhanden (702/702, Digests, Snapshot/Restore) | Direkt wiederverwendbar für Anti-Desync, Server-Simulation, Debugging |
| **1.0-Stabilität** | offen | Netzwerk vor API-Stabilisierung von `interpreter`/`field-runtime` erhöht Refactoring-Kosten; empfohlener Start: **nach 1.0** |

---

## 8. Empfehlung / Stufenplan

**Empfehlung: Bedingt Go.** Multiplayer als Post-1.0-Co-op-Roadmap aufnehmen — mit explizitem Scope-Deckel (Variante A → B) und rechtlichen Leitplanken. Kein „FF7 MMORPG" als Ziel kommunizieren.

**Stufenplan:**

1. **Stufe 0 — Netcode-Spike (Post-1.0, ~1–2 PM):** Zwei Browser-Instanzen, ein Node-Relay, Input-Sync + Digest-Vergleich + Snapshot-Resync. Abbruchkriterien definiert: Wenn Cross-Browser-Determinismus nicht haltbar ist, wird der Server die einzige Simulationsinstanz (Plan B ohne Mehrkosten, da ohnehin empfohlen).
2. **Stufe 1 — Co-op-Prototyp (Variante A, ~6–10 PM):** Server-autoritative Field-Rooms, 2–8 Spieler, Movement-Prediction/Reconcile, Chat, Session-Codes, kein Account-Zwang (gastfähig), selbst-hostbar. Explizit nicht-kommerziell, kein FF7-Branding auf Server-/Projekt-Ebene.
3. **Stufe 2 — Rechtliche Prüfung + Persistenz (Gate):** Anwaltliche Kurzbewertung des Serverbetriebs; danach Accounts/Auth, serverseitige Charakterstände, Mod-Hash-Erzwingung.
4. **Stufe 3 — Instanziierte Welt (Variante B, erst nach Battle):** Matchmaking/Presence, Sharding über Field-Instanzen, soziale Basissysteme, Moderations- und Ops-Konzept. Zielkorridor 20–50 Spieler/Field.
5. **Dauerhaft ausgeschlossen (derzeit):** Monetarisierung jeder Form; Distribution jeglicher Originaldaten; Variante C (volles MMORPG); Marketing unter FF7-Begriffen.

**Killer-Argument für den Co-op-Pfad:** Die teuerste Voraussetzung — beweisbar deterministische, serialisierbare Simulation mit Snapshot/Restore — existiert bereits und ist projektweit verifiziert. Die teuerste Gefahr — Square Enix — wird durch konsequente Beibehaltung des BYO-Data-/No-Distribution-Prinzips auf das dokumentierte PokeMMO-Überlebensniveau begrenzt, **nicht eliminiert**.

---

## 9. Quellen

**Projekt:**
- OpenMidgar/WebMidgar Repository: https://github.com/dudhasch/OpenMidgar (inkl. `docs/WEBMIDGAR-MASTERPLAN.md`: Fixed-Tick-Interpreter, 30 Ticks/s-Kalibrierziel, Determinismus, „kein Upload, kein Server")

**Browser-MMO-Architektur & Transport:**
- Ably — WebRTC vs. WebSocket: https://ably.com/topic/webrtc-vs-websocket
- VideoSDK — WebSocket vs WebRTC DataChannel: https://videosdk.live/developer-hub/webrtc/websocket-vs-webrtc-datachannel
- Colyseus — Dokumentation (authoritative Server, Rooms, State-Sync, Skalierung): https://docs.colyseus.io/
- Colyseus — npm-Paketbeschreibung (WebSocket, delta-komprimierte State-Sync): https://www.npmjs.com/package/colyseus
- Colyseus — State-Synchronisation im Detail: https://0-15-x.docs.colyseus.io/state/
- SpacetimeDB — Was ist SpacetimeDB (DB als Server, BitCraft-Referenz): https://spacetimedb.com/docs/1.12.0/intro/what-is-spacetimedb/
- SpacetimeDB — GitHub: https://github.com/clockworklabs/SpacetimeDB

**Deterministisches Lockstep vs. State-Sync:**
- Socratopia / Math for Game Devs — „Lockstep as the RTS Gold Standard": https://www.socratopia.app/library/math-for-game-devs-en/chapter-30
- Northfield — „How to Architect a Deterministic Network Layer": https://www.northfield.pro/posts/how-to-architect-a-deterministic-network-layer-for-competitive-multiplayer-engines
- DevelopersVoice — Real-Time Multiplayer: Lockstep vs. State-Sync vs. Server-Autorität: https://developersvoice.com/blog/practical-design/realtime-card-games-net-architecture-guide/
- AIRCC — Browser-spezifische Lockstep-Probleme (Tab-Pausierung, Nicht-Determinismus): https://aircconline.com/csit/papers/vol12/csit122010.pdf
- GameDev.StackExchange — Node.js Lockstep mit geteiltem Simulator: https://gamedev.stackexchange.com/questions/64019/node-js-lockstep-multiplayer-architecture

**Rechtliche Präzedenzfälle:**
- Chrono Compendium — Cease & Desist (Crimson Echoes u. a.): https://www.chronocompendium.com/Forums/index.php?topic=7396.0
- NeoGAF-Thread — Square-Enix-C&D gegen FF-Type-0-Fanübersetzung: https://www.neogaf.com/threads/square-enix-sends-cease-and-desist-letter-to-ff-type-0-translation-group.857470/
- Engadget — „Nintendo shuts down fan-made Pokemon MMO" (Pokenet, 2010): https://www.engadget.com/2010-04-02-nintendo-shuts-down-fan-made-pokemon-mmo.html
- RaGEZONE — Warum PokeMMO nicht geschlossen wird (BYO-ROM-Modell): https://forum.ragezone.com/threads/why-nintendo-dont-shutdown-pokemmo.1151021/
- PokeMMO-Forum — Diskussion C&D-Überleben/Monetarisierungsgrenzen: https://forums.pokemmo.com/index.php?/topic/133846-did-pokemmo-really-survive-a-cease-and-desist/

**Skalierungsrealität (Rendering):**
- Three.js Discourse — „Optimization of large amounts (100–1000) of Skinned Meshes (CPU bottlenecks)": https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196

*Alle nicht durch Quellen belegten Zahlen (Personenmonate, Spielerzahlen/Instanz, Serverdichte) sind Schätzungen der Analyse und entsprechend markiert.*