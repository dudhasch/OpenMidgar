# Machbarkeitsanalyse 03 — Worldmap-Erweiterung für Skill-Orte (Holzfällerei, Angeln etc.)

**Projekt:** WebMidgar (github.com/dudhasch/OpenMidgar) — Clean-Room-Reimplementierung der FF7-PC-Laufzeitumgebung im Browser
**Status:** Analyse / Post-1.0-Ausblick
**Datum:** 2026 (Analyse auf Stand der öffentlich zugänglichen Quellen)
**Verwandte Dokumente:** ADR-014 (.wmmod, deklaratives Modsystem), Analyse 04 (Worldmap-Skalierung/Performance), separate Analyse „Gathering-Skills (RuneScape-like)"

---

## 1. Executive Summary

**These:** Sobald das Worldmap-Modul von WebMidgar existiert, sollen auf der Weltkarte neue Orte für Gathering-Skills (Holzfällerei, Angeln, Mining etc.) erscheinen, die beim Betreten in eigene Fields wechseln.

**Ergebnis: Machbar — aber strikt sequentiell hinter dem Worldmap-Modul.** Die originale FF7-Weltkarte kennt „Orte" nicht als eigenes Dateiformat, sondern als Zusammenspiel aus World-Models, WM-Skripten (`.ev`) und Mesh-Dreieck-Triggern. WebMidgar kann dieses Verhalten **deklarativ nachbilden**: POI-Records im `.wmmod`-Manifest (Position, Radius, Ziel-Field, Marker), auflösend über die bereits existierende maplist/Gateway-Mechanik des Field-Systems. Es ist **kein Schreiben von Original-Binärformaten nötig** (ADR-014-konform).

**ff7-landscaper** ist als Referenz und Authoring-Werkzeug wertvoll (vollständiger TypeScript-Parser-Stack für `.map/.ev/.tex/.lgp`, World-Skript-Dekompiler, Koordinaten-Picking per 3D-View), aber **nicht** als Integrationsweg: Es ist eine Tauri-Desktop-App, die Original-Binärdaten editiert und zurückschreibt — genau das, was WebMidgar per ADR-014 bewusst nicht tut. Zudem liegt **keine Lizenzdatei** im Repo; Code-Übernahme ist damit rechtlich ausgeschlossen, Nutzung als Wissensquelle bleibt möglich.

**Verdikt:** Grünes Licht als Post-Worldmap-Feature. Aufwand nach Worldmap-Modul: **S–M** (ca. 3–8 PT). Empfehlung: deklarativer POI-Overlay-Ansatz, landscaper nur als externes Authoring-/Referenz-Tool, kein Format-Import.

---

## 2. Ausgangslage

### 2.1 WebMidgar-Ist-Zustand

- **Field-System komplett:** 702 Fields, Walkmesh-Solver, deterministischer Fixed-Tick-Interpreter, Tile-Depth-Rendering mit Atlas-Packer, GPU-Registry mit VRAM-Budgets.
- **Field-Wechsel existiert:** maplist/Gateway-Mechanik (Field → Field über Gateways), mit NFR-Budgets (Wechsel Median ~5,1 ms warm) und Telemetry-Messung.
- **Modsystem `.wmmod`:** deklarativ, Capability-basiert (u. a. `field-add`), NAM-nahe Field-Dokumente (ADR-014). WebMidgar schreibt bewusst **keine** Original-Binärformate.
- **Worldmap-Modul: existiert nicht.** Roadmap-Post-1.0-Ausblick: „Weltkarte: Terrain, Fahrzeuge, World-Script-System".

### 2.2 Zielbild (aus Skill-Analyse, RuneScape-like)

Gathering-Skills brauchen räumlich verankerte Sammelorte: einen Wald für Holzfällerei, einen See/Fluss für Angeln, eine Mine für Mining. Auf einer Weltkarte bedeutet das:

1. **Sichtbarkeit:** Marker/Modell an einer Worldmap-Position.
2. **Erreichbarkeit:** Der Spieler kann die Position ansteuern (Walkmap-Typen müssen passen).
3. **Betreten:** Annäherung (Radius/Trigger) löst Übergang in ein Field aus (ggf. mit Bestätigungsdialog „Betreten?").
4. **Rückkehr:** Beim Verlassen des Fields erscheint der Spieler an einer definierten Worldmap-Position (nicht exakt dieselbe wie der Eingang — das Original nutzt leicht versetzte Exit-Positionen, „Outside Kalm"-Mechanik).

---

## 3. Recherche-Befunde

### 3.1 Aufbau der originalen FF7-Weltkarte (Qhimm-Wiki / FF Inside Wiki)

Quellen: [wiki.ffrtt.ru WorldMap_Module](https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module), [WorldMap_Module/Script](https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module/Script), [World Map/TXZ](https://wiki.ffrtt.ru/index.php/FF7/World_Map/TXZ), [Qhimm-Thread 18560](https://forums.qhimm.com/index.php?topic=18560.50).

**Geometrie (`.map`, LZS/LZSS-komprimiert, in `data/wm/world_us.lgp`):**

- Drei Karten: **WM0** (Oberwelt), **WM2** (Unterwasser/U-Boot), **WM3** (Schneesturm).
- WM0: 68 Blöcke; 63 davon als **7×9-Raster**, jeder Block **0xB800 Bytes** und 32768×32768 Welt-Einheiten; pro Block **16 Meshes (4×4)**, je 8192×8192 Einheiten. Gesamtgröße der Oberwelt: ca. 294912 × 229376 Einheiten.
- Blöcke 63–68 sind **Story-Ersetzungen** (Ultima-Weapon-Krater, Tempel der Alten etc.) und ersetzen definierte Rasterblöcke.
- Mesh-Aufbau: Header (Anzahl Dreiecke/Vertices), Dreiecke à 12 Bytes — inkl. **5-Bit-Walkmap-Typ** (Gras, Wald, Berg, Meer, Sumpf, Wüste, Brücken … 32 Typen), **3-Bit Mesh-Funktions-ID** (Skript-Trigger beim Betreten des Dreiecks), UVs, 9-Bit-Textur-ID, Chocobo-Flag, 6-Bit-Region. Vertices/Normals à 8 Bytes (int16).
- `.bot`-Dateien: redundante, ladeoptimierte Variante — jeder Block mit 3 Nachbarblöcken gruppiert (332 Gruppen), d. h. das Original streamt ein **2×2-Block-Fenster** um den Spieler.
- Texturen: Tabelle mit **512 Slots (0–281 belegt)**, kleine palettierte Texturen; Regionen: 20 Region-IDs (Midgar Area, Grasslands Area, …) für Menü/Savegame-Anzeige.

**„Orte" sind im Original kein Format, sondern Skript-Verhalten:**

- Orte (Städte, Höhlen) sind **World-Models** (aus `wmset.obj` u. a.), die per WM-Skript platziert werden, plus **Trigger-Logik**:
  - **Model-Funktionen:** Enter / Exit / Tick / **Touch** (Spieler berührt Modell) / **Interact** (OK-Taste) — Touch/Interact auf dem Stadt-Modell löst den Field-Sprung aus.
  - **Mesh-Funktionen:** Dreiecke mit Mesh-Funktions-ID ≥ 3 lösen beim Betreten Skripte aus (z. B. Midgar Zolom im Sumpf ist System-Funktion 7; Brücken-, Quicksand-Logik).
- **Field-IDs 1–64 sind Shortcut-Sprungziele auf die Worldmap** (WM0 Midgar-Eingang, WM1 Kalm, … WM29 Unterwasser). Beim Field→WM-Übergang speichert die **Special Variable 6** die Herkunfts-Field-ID; die WM-System-Funktion 0 („Enter", beim Laden der Worldmap) prüft sie und setzt Mesh + Koordinaten des Spieler-Entities (Koordinaten = Mesh-X/Z × 0x2000 + Offset im Mesh, 16-Bit-Stack-Arithmetik).
- **Ein-/Ausstiegs-Koordinaten differieren:** Ausstieg aus einer Stadt → Position leicht neben dem Stadt-Modell („Outside Kalm"); Einstieg → am Modell selbst, flächenbasiert (Dreieck/Radius), nicht exakt punktuell (DynamixDJ/codemann8 im Qhimm-Thread; bestätigt durch Kujata-Metadaten).

**WM-Skriptsystem (`.ev`):** stackbasiert, 16-Bit-Instruktionen, globaler Stack (8 tief), kooperatives Multitasking über Contexts; `.ev`-Datei = 0x400 Bytes Call-Table + 0x6C00 Bytes Code (Original-Größenfixierung; `wm0.ev` im landscaper-Repo ist exakt 28672 = 0x7000 Bytes groß). 32 System-Funktionen + Model-Funktionen + Mesh-Funktionen.

### 3.2 Repo maciej-trebacz/ff7-landscaper

Quellen: [GitHub-Repo](https://github.com/maciej-trebacz/ff7-landscaper), [package.json](https://raw.githubusercontent.com/maciej-trebacz/ff7-landscaper/main/package.json), Repo-Tree via GitHub-API.

**Was es ist:** Ein World-Map-Editor für FF7 PC (v1.1.1). Editierbar: Weltkarten-Geometrie aller drei Karten, Dialoge/Nachrichten (Regionsnamen, WM-Texte), Encounter-Tabellen pro Region (inkl. Yuffie-/Chocobo-Sonderfälle, Terrain-Region-Sets) sowie WM-Skripte. Vier Ansichtsmodi (Textured, Terrain, Region, Scripts); **OBJ-Export/Import** (Blender-Workflow); Skript-Editor mit **Dekompilierung in eine Hochsprache** und drei Skripttypen (System, Model, Mesh); Hinzufügen neuer Model- und Mesh-Skripte möglich.

**Technologie:** Tauri-2-Desktop-App (dünner Rust-Shell: `commands.rs`, `main.rs`, `updater.rs`), Vite + TypeScript ~5.6, React 18, **React Three Fiber + drei (Three.js r172)**, jotai, `binary-parser`, Tailwind, Vitest; Lezer-Grammatik (`worldscript.lr`) für die WM-Skript-Hochsprache.

**Verarbeitete Dateiformate (`src/ff7/`):**

| Parser | Format |
|---|---|
| `lgp.ts` | LGP-Archive (world_us.lgp) |
| `lzss.ts` | LZSS/LZS-Kompression |
| `mapfile.ts` | WM-Geometrie (wm0/wm2/wm3.map) |
| `texfile.ts` | `.tex`-Texturen |
| `evfile.ts` | WM-Skripte (`.ev`) |
| `encwfile.ts` | WM-Encounter (`encw`) |
| `mesfile.ts` | Nachrichten/Regionsnamen (`.mes`) |
| `fieldtblfile.ts` | `field.tbl` (Field↔WM-Zuordnung) |
| `worldscript/*` | Dekompiler/Compiler für die WM-Hochsprache (~100 kLOC-Zeilen an Opcode-Tabellen und AST-Logik) |

**Relevanz für WebMidgar — und deren Grenzen:**

- ✅ **Referenz-Implementierung in TypeScript** für exakt die Formate, die das künftige Worldmap-Modul parsen muss (`.map`, `.tex`, `.ev`, `.lgp`, LZSS). Wertvoll als Lektüre/Verifikationsquelle für Clean-Room-Parser.
- ✅ **Authoring-Werkzeug:** 3D-Ansicht mit Koordinaten-/Dreiecks-Inspektion (Mesh-X/Z, Vertices, Walkmap-Typ, Region) — ideal, um POI-Positionen für Skill-Orte **auszumessen**; OBJ-Export erlaubt Blick in Blender.
- ✅ **Dokumentation der WM-Skript-Semantik** (Opcode-Tabellen, System-/Model-/Mesh-Funktionen).
- ❌ **Kein Integrationsweg:** landscaper **schreibt Original-Binärdateien** (patched `.map`, `.ev`, `.mes` in der LGP) — für WebMidgar per ADR-014 ausgeschlossen (Originaldaten bleiben read-only, Mods deklarativ).
- ❌ **Kein Lizenzfile im Repo** (Stand: kompletter Tree eingesehen, kein `LICENSE`/`COPYING`) → „all rights reserved", **kein Code darf kopiert werden**; nur konzeptionelle Nutzung + Verifikation gegen eigene Implementierung.
- ❌ Tauri-Desktop-App, nicht browserfähig; R3F-Renderer-Code nicht auf WebMidgar-Architektur (Worker-Pipeline, GPU-Registry) übertragbar.

### 3.3 Bekannte Tools im FF7-Worldmap-Ökosystem

- **Makou Reactor** (myst6re, [SourceForge](https://sourceforge.net/projects/makoureactor/), [Qhimm-Thread 9658](https://forums.qhimm.com/index.php?topic=9658.50)): Referenz-**Field**-Editor; kann seit 1.8 Field-Maps **hinzufügen/entfernen** (mit FFNx bis 1200 Maps). Relevant als Beleg, dass „mehr Fields" im Ökosystem etabliert sind — aber Makou editiert Binärdateien.
- **Reeve** (Ficedula): klassischer World-Map-Viewer (Vorläufer, nur PSX/PC-Viewer).
- **ff7MapToObj** (Omzy, [Qhimm-Thread 10717](https://forums.qhimm.com/index.php?topic=10717.0)): `.map → .obj`-Konverter (C++), Grundlage vieler Höhenkarten-Workflows.
- **Kujata-Metadaten** (picklejar): JSON-Datensätze für Field-ID↔WM-Koordinaten, Szenengraph ([github.com/picklejar76/kujata-data](https://github.com/picklejar76/kujata-data)) — nützlich als Realdaten-Probe für die Worldmap-Parser-Entwicklung (NFR-Kultur: „Realdaten-Proben vor Parserbau").

---

## 4. Technischer Ansatz

### 4.1 Grundprinzip: POI-Overlay statt Geometrie-Patch

Der Originalmechanismus (Stadt-Modell + Touch/Interact-Funktion + Special-Var-6-Rücksprung) wird **funktional nachgebaut**, nicht datenseitig gepatcht. Skill-Orte werden als **deklarative POI-Records** in einem `.wmmod`-Manifest beschrieben; das Worldmap-Modul stellt eine **POI-Schicht** bereit, die diese Records rendert und triggert.

Konsequenz: Die Erweiterung benötigt **keine Änderung an Original-Worldmap-Daten** und funktioniert unabhängig davon, ob WebMidgars Worldmap-Modul das Original-`.ev`-System interpretiert oder ein eigenes World-Verhalten implementiert.

### 4.2 Deklaratives POI-Record-Schema (Vorschlag, `.wmmod`-Manifest)

```yaml
capabilities: [world-poi-add, field-add]      # neue Capability + bestehende
pois:
  - id: mod.author/logging_camp_01
    label: "Holzfällerlager"                   # Regions-/Menüname
    position:
      mesh: { x: 24, z: 13 }                   # Mesh-Raster (0x2000-Einheiten-Raster)
      local: { x: 5078, z: 6432 }              # Offset im Mesh — Original-Konvention
    trigger:
      kind: radius                             # radius | triangle | interact
      radius: 900                              # Welt-Einheiten
      prompt: "Betreten?"                      # optional, wie Original-Interact
    marker:
      kind: sprite                             # sprite | model | none
      asset: assets/markers/logging_camp.png   # Atlas-fähig
    target:
      field: mod.author/logging_camp_field     # field-add-Capability liefert das Field
      gateway: 0
    return:
      position: { mesh: { x: 24, z: 13 }, local: { x: 5400, z: 6600 } }  # versetzt, „Outside-X"-Semantik
      facing: 0
    conditions:                                # optional: Story-/Skill-Gates
      min_skill: { woodcutting: 1 }
```

**Design-Entscheidungen:**

1. **Koordinaten in Original-Konvention** (Mesh-X/Z + 16-Bit-Local-Offset): direkte Kompatibilität zu Community-Daten (Kujata-JSON, landscaper-Inspektion, Qhimm-Doku) und zu Walkmesh/Dreiecks-Lookups; vermeidet Float-Drift im deterministischen Fixed-Tick.
2. **Trigger-Modi:** `radius` (Proximity-Check im Fixed-Tick, O(n) über aktive POIs bzw. Spatial-Hash), `interact` (Radius + OK-Taste, originalnah), später `triangle` (Bindung an Walkmesh-Dreieck, falls das WM-Modul Dreieck-Trigger abbildet).
3. **Betreten = Field-Wechsel über bestehende Pipeline:** Der POI-Trigger ruft denselben Field-Switch wie ein Field-Gateway (maplist-Auflösung, Ladebudget, TTFF-Messung). Die Worldmap wird dabei selbst als „Ort" behandelt, aus dem man kommt und zu dem man zurückkehrt — analog der Original-Shortcut-Field-IDs 1–64 (WM0–WM29).
4. **Rücksprung:** explizite `return`-Position im Record (versetzt zum Eingang, „Outside Kalm"-Semantik); Fallback: letzte WM-Position aus dem Save-State.
5. **Marker-Rendering:** Sprites/Quads in der WM-Szene, atlasfähig (GPU-Registry, VRAM-Budget), optional Original-Style-Modelle, falls das WM-Modul World-Models lädt.
6. **Sichtbarkeits-/Bedingungslogik:** deklarativ (Skill-Level, Story-Flags), auswertbar ohne Skript-VM-Erweiterung.

### 4.3 Alternativen und Abgrenzung

| Ansatz | Bewertung |
|---|---|
| **A: Deklarativer POI-Overlay (empfohlen)** | ADR-014-konform, klein, testbar, unabhängig vom `.ev`-Interpreter-Reifegrad |
| B: WM-Skript-Hochsprache à landscaper (Mods liefern World-Skripte) | Mächtig, aber bricht die Deklarativität des Modsystems; deterministische WM-Skript-VM ist eigenes Großprojekt; frühestens nach World-Script-System denkbar |
| C: landscaper-Workflow (Binär-Patch von `.map/.ev`) | Ausgeschlossen: schreibt Originalformate, Tauri-App, keine Lizenz — widerspricht ADR-014 und Clean-Room-Prinzip |
| D: Fields direkt auf der WM rendern (kein Szenenwechsel) | Bricht mit der FF7-Architektur (genau ein Field aktiv) und mit den bestehenden NFR-/Ladebudgets; kein Mehrwert für Gathering-Loop |

### 4.4 Einordnung in die Roadmap

```
1.0 (Field-System, fertig)  →  Worldmap-MVP (Terrain, Streaming, Player-Entity, Encounters)
                              →  POI-Schicht + world-poi-add-Capability  ← DIESE ANALYSE
                              →  World-Script-System (.ev-Interpretation)
                              →  Fahrzeuge, Unterwasser/Schnee (wm2/wm3)
```

Die POI-Schicht sollte **nicht** auf das World-Script-System warten: Die Original-Orte lassen sich für den MVP genauso als POI-Records aus Community-Daten (Kujata) generieren — das liefert sofort Realdaten-Proben und validiert die Schicht, bevor `.ev` interpretiert wird.

---

## 5. Aufwand

Voraussetzung: Worldmap-Modul MVP existiert (Terrain-Streaming, Spieler-Entity, Fixed-Tick-Integration). **Dieser Blocker dominiert die Gesamtdauer** und ist nicht Teil dieser Schätzung.

| Arbeitspaket | Umfang | Schätzung |
|---|---|---|
| POI-Record-Schema + Manifest-Validierung (Capabilities `world-poi-add`, Budget-Checks) | XS–S | 0,5–1 PT |
| POI-Schicht im WM-Modul: Registry, Spatial-Index, Proximity-/Interact-Trigger im Fixed-Tick | S | 1–2 PT |
| Field-Switch-Anbindung (maplist-Erweiterung „Worldmap als Herkunft", Rücksprung-Positionen) | S | 1–2 PT |
| Marker-Rendering (Atlas-Sprites, VRAM-Budget-Registrierung, Labels) | S | 1 PT |
| Realdaten-Proben: Original-Orte (ca. 30+ Sprungziele) als POI-Records aus Kujata/Qhimm-Daten generieren + Verifikation | S | 0,5–1 PT |
| NFR-Instrumentierung (Trigger-Latenz, TTFF POI-Betreten, Long-Task-Budgets), Tests, Doku | S | 0,5–1 PT |
| **Summe** | **S–M** | **ca. 3–8 PT** |

Optional/nicht eingerechnet: Authoring-Komfort (eigener Koordinaten-Picker im Browser, ~2–4 PT), WM-Skript-gesteuerte POIs (Ansatz B, eigenes Projekt), Animated/3D-Marker.

---

## 6. Risiken

| Risiko | Eintritt | Impact | Mitigation |
|---|---|---|---|
| **Worldmap-Modul verschiebt sich** (Feature ist hart davon abhängig) | Mittel | Total | POI-Schema + Manifest früh spezifizieren (ADR), Implementierung als erster WM-Aufsatz; Original-Orte als Probedaten treiben WM-MVP-Anforderungen |
| **Annahmen über Trigger-Semantik falsch** (Radius vs. Dreieck vs. Modell-Touch) | Mittel | Mittel | Realdaten-Proben: Original-Koordinaten aus Kujata + landscaper-Inspektion verifizieren; Trigger-Modi konfigurierbar halten |
| **Scope Creep Richtung WM-Skript-Hochsprache** | Hoch | Hoch | Ansatz B explizit out-of-scope; Deklarativitäts-Prinzip (ADR-014) als Gate |
| **Lizenz-Falle landscaper** (unbeabsichtigte Code-Übernahme; keine LICENSE-Datei) | Niedrig | Mittel | Clean-Room-Regel: Repo nur lesen, nie kopieren; eigene Parser gegen Community-Doku (wiki.ffrtt.ru) + Realdaten testen |
| **Inkonsistente Rücksprung-Positionen** (Spieler landet „in" der Stadt-Geometrie) | Mittel | Niedrig | „Outside-X"-Semantik aus dem Original übernehmen (versetzte Exit-Koordinaten); Sanity-Check gegen Walkmap-Typ am Rücksprungpunkt |
| **Determinismus-Bruch** durch Float-Koordinaten im Fixed-Tick | Niedrig | Mittel | Integer-Koordinaten (Original-Konvention), Proximity-Checks in Festkomma |
| **Mod-Konflikte** (zwei Mods, gleiche Position/Region) | Mittel | Niedrig | Namespace-Pflicht (`mod.author/...`), Manifest-Validierung mit Kollisionswarnung |

---

## 7. Abhängigkeiten

- **Blocker (hart):** Worldmap-Modul MVP — Terrain-Streaming (Blockfenster à la `.bot`-Design), Spieler-Entity mit Walkmap-Regeln, Fixed-Tick-Integration, WM-Renderer in GPU-Registry/VRAM-Budgets.
- **Weich:** World-Script-System (`.ev`) — **nicht** erforderlich für Ansatz A; POI-Schicht funktioniert vorher und liefert umgekehrt Probedaten für den `.ev`-Interpreter.
- **Bestehend (kein Risiko):** maplist/Gateway-Mechanik, `.wmmod`-Manifest + Capability-System (`field-add` existiert; `world-poi-add` kommt hinzu), Atlas-Packer, GPU-Registry, Telemetry/NFR-Budgets.
- **Extern (Wissen/Daten, kein Code):** wiki.ffrtt.ru-Worldmap-Doku, Qhimm-Threads 18560/10717, Kujata-Metadaten (field-id-to-world-map-coords.json), ff7-landscaper als Inspektions-/Messtool, Makou Reactor als Ökosystem-Referenz.

---

## 8. Empfehlung

1. **Verdikt: Machbar, empfohlen — als deklarative POI-Schicht (`world-poi-add`) im `.wmmod`-Modsystem.** Kein Binär-Patching, kein Format-Import, volle ADR-014-Konformität.
2. **Sequenzierung strikt einhalten:** Erst Worldmap-MVP, dann POI-Schicht. Das POI-Schema kann aber **jetzt** als ADR-Vorschlag spezifiziert werden — es definiert Anforderungen an den WM-MVP (Koordinatensystem, Trigger, Rücksprung).
3. **Original-Orte als Realdaten-Probe:** Die ~30 Original-Sprungziele (WM0–WM29, Kalm, Chocobo-Farm, Mideel …) als POI-Records modellieren und gegen Kujata-Metadaten + landscaper-Inspektion verifizieren. Das validiert die Schicht, bevor die erste Skill-Mod existiert.
4. **ff7-landscaper** als Authoring-/Inspektionswerkzeug in die Toolchain-Doku aufnehmen (Koordinaten ausmessen, OBJ-Export), aber **keinen Code übernehmen** (fehlende Lizenz) und **keine Binär-Workflows** (ADR-014).
5. **NFR-Kultur anwenden:** POI-Betreten in die bestehende Telemetry aufnehmen (TTFF, Wechselbudget Median ~5,1 ms warm als Referenzwert), Long-Task-Messung beim Marker-Aufbau, VRAM-Budget für Marker-Atlanten.
6. **Skill-Orte ≠ Skripte:** Gathering-Logik (Respawn-Timer, Skill-Checks, Loot-Tabellen) gehört in die Field-/Skill-Domäne der separaten Skill-Analyse — die POI-Schicht liefert nur räumliche Verankerung und Betreten/Verlassen.

---

## 9. Quellen

- ff7-landscaper Repo: https://github.com/maciej-trebacz/ff7-landscaper (README, Features, Screenshots)
- ff7-landscaper package.json (Tech-Stack): https://raw.githubusercontent.com/maciej-trebacz/ff7-landscaper/main/package.json
- ff7-landscaper Datei-Tree (Parser-Liste, fehlende LICENSE): https://api.github.com/repos/maciej-trebacz/ff7-landscaper/git/trees/main?recursive=1
- FF7 WorldMap Module (MAP/BOT-Format, Mesh, Walkmap, Regionen): https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module
- FF7 WorldMap Script-Engine (.ev, Call-Table, System-/Model-/Mesh-Funktionen): https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module/Script
- FF7 World Map TXZ (Texturen, VRAM-Blöcke): https://wiki.ffrtt.ru/index.php/FF7/World_Map/TXZ
- Qhimm: World/Field Map Scripts and Encounters (Field-IDs 1–64 = WM-Sprungziele, Special Var 6, Mesh-Koordinaten): https://forums.qhimm.com/index.php?topic=18560.50 und https://forums.qhimm.com/index.php?topic=18560.25
- Qhimm: ff7MapToObj (.map→.obj, Block-/Mesh-Struktur, 0xB800-Blöcke): https://forums.qhimm.com/index.php?topic=10717.0
- Makou Reactor (Field-Editor, Add/Remove Maps, FFNx 1200 Maps): https://forums.qhimm.com/index.php?topic=9658.800 , https://sourceforge.net/projects/makoureactor/
- Kujata-Metadaten (Field↔WM-Koordinaten, Szenengraph): https://github.com/picklejar76/kujata-data/blob/master/metadata/field-id-to-world-map-coords.json , https://github.com/picklejar76/kujata-data/blob/master/metadata/scene-graph.json