# Machbarkeitsanalyse 04 — Worldmap-Erweiterung: mehr Fields/Städte — ab wann laggt es?

**Projekt:** WebMidgar (github.com/dudhasch/OpenMidgar) — Clean-Room-Reimplementierung der FF7-PC-Laufzeitumgebung im Browser (TypeScript, Three.js, Worker-Pipeline, 100 % clientseitig)
**Status:** Analyse / Post-1.0-Ausblick
**Fragestellung:** Wenn die Worldmap mehr Fields/Städte (POIs, ggf. zusätzliche geladene Field-Daten) trägt, wo liegen die Performance-Grenzen — und ab welcher Skalierung (×2, ×5, ×10) drohen Lag, VRAM- oder Long-Task-Verletzungen?
**Verwandte Dokumente:** Analyse 03 (POI-Schicht), ADR-014 (.wmmod), NFR-/Telemetry-Konventionen

---

## 1. Executive Summary

**Kurzantwort: Nicht die Anzahl der Orte laggt — sondern eine naive Implementierung der Darstellung und des Ladens.** Die FF7-Weltkarte ist nach heutigen Maßstäben winzig (geschätzt 1–2 × 10⁵ Dreiecke gesamt, davon aktiv ein 2×2-Block-Fenster von ~10⁴ Dreiecken). Selbst ×10 mehr Orte (≈ 7.000 Fields/POIs) bleibt auf Mittelklasse-Hardware bei 60 FPS, **wenn** drei Disziplinen eingehalten werden: (1) statisches Terrain gemergt + Texturen geatlast (Draw Calls < 100/Frame), (2) POI-Marker per Instancing/Batching (1–5 Draw Calls statt Tausender), (3) Field-Daten bleiben „genau ein Field zur Zeit" — Anzahl der Fields skaliert nur Cache-Größe (IndexedDB), nicht VRAM oder Framekosten.

**Lag-Schwellen (begründete Schätzungen, Annahmen markiert):**

| Implementierung | sichtbare Grenze (Mittelklasse-Laptop) |
|---|---|
| Naiv: 1 Mesh + 1 Draw Call pro POI-Marker | ~500–1.000 POIs → FPS-Einbruch (Draw-Call-CPU-Limit) |
| Naiv + pro Frame Raycast gegen alle POIs | schon ~1.000–10.000 Objekte → 5–10 ms/Frame zusätzlich |
| Diszipliniert: Instancing, Atlas, Streaming, Spatial-Hash | keine praktische Grenze im Mod-Kontext (≥ 10⁵ POIs, VRAM < 100 MB) |
| Field-Anzahl allgemein (egal ob 702 oder 7.020) | kein FPS-Effekt; nur IndexedDB-Footprint und Kalt-Lade-Long-Tasks beim erstmaligen Betreten |

**Verdikt:** Skalierung ×2–×10 ist **unkritisch für die Rendering-Last**, kritisch nur für (a) JS-Main-Thread-Disziplin und (b) Kalt-Field-Wechsel (Parse/Atlas-Pack → Long Tasks). Beides adressiert WebMidgars bestehende NFR-Kultur (Budgets, Telemetry, Budget-Verweigerung im Modsystem) bereits konzeptionell — sie muss aufs Worldmap-Modul übertragen werden.

---

## 2. Ausgangslage und Datenmodell

### 2.1 Ist-Zustand WebMidgar (NFR-relevant)

- Field-System: 702 Fields, Tile-Depth-Rendering mit **Atlas-Packer**, **GPU-Registry mit VRAM-Budgets**, Worker-Pipeline, deterministischer Fixed-Tick.
- Telemetry/NFR: Long-Task-Messung, Soak-Tests mit Heap-/VRAM-Baseline; **Field-Wechsel-Budget: Median ~5,1 ms warm**; TTFF-Budgets.
- Modsystem: deklarativ, Budget-Verweigerung (Mods, die Budgets überschreiten, werden abgelehnt).
- Worldmap-Modul: **existiert noch nicht** (Roadmap Post-1.0). Alle Worldmap-Zahlen unten sind daher **Modellrechnungen auf Basis der Original-Datenformate**, keine Messungen.

### 2.2 Original-Datenmodell der Weltkarte (aus Format-Doku abgeleitet)

Quellen: [wiki.ffrtt.ru WorldMap_Module](https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module), [TXZ](https://wiki.ffrtt.ru/index.php/FF7/World_Map/TXZ), [Qhimm 10717](https://forums.qhimm.com/index.php?topic=10717.0).

- **Oberwelt (wm0):** 63 Blöcke (7×9) + 5–6 Story-Ersatzblöcke; Block = 0xB800 Bytes, 16 Meshes (4×4) à 8192×8192 Einheiten. Gesamt ~1.000 Meshes Oberwelt (+ wm2: 12 Blöcke, wm3: 4 Blöcke).
- **Dreieckszahl (Schätzung, Annahme A1):** Pro Mesh stehen komprimiert ~2,9 KB zur Verfügung (0xB800/16); dekomprimiert bei typischem LZSS-Verhältnis ~4,5–6 KB; Dreieck = 12 B, Vertex+Normal = 16 B, V≈T ⇒ ~120–200 Dreiecke/Mesh ⇒ **Oberwelt gesamt ≈ 1,2–2,0 × 10⁵ Dreiecke**. Plausibilitäts-Check: Omzys wm0.obj (unkomprimiert, ASCII) ≈ 20 MB ⇒ bei ~70 B/Dreieck + ~45 B/Vertex dieselbe Größenordnung (≈ 1,5–2 × 10⁵). → **Arbeitszahl: ~200k Dreiecke gesamt.**
- **Aktives Fenster (Annahme A2):** Original streamt Block + 3 Nachbarn (BOT-Gruppierung, 332 Gruppen) ⇒ 2×2 Blöcke = **64 Meshes ≈ 8–13k Dreiecke aktiv** um den Spieler. Selbst ein großzügiges 3×3-Block-Fenster (144 Meshes) bleibt < 30k Dreiecke.
- **Texturen:** Tabelle mit 512 Slots, davon 0–281 belegt; kleine palettierte Tiles (z. B. 64×64, Beleg aus landscaper-Screenshot). In RGBA expandiert + Atlas: **< 25 MB VRAM gesamt** (Annahme A3, großzügig).
- **Orte/POIs:** Original ~30 WM-Sprungziele (Field-IDs 1–64 reserviert; Liste WM0–WM29, [Qhimm 18560](https://forums.qhimm.com/index.php?topic=18560.50)) + ~702 Fields gesamt. **Ein POI ist Metadaten** (Position, Radius, Ziel-Field, Marker-Index) ≈ 100–200 Bytes + 1 Marker-Quad (2 Dreiecke, atlasfähig).
- **Fields:** Genau **ein** Field aktiv/geladen (Original-Architektur, WebMidgar übernimmt das). Field-Daten liegen ansonsten als Dateien (FSA) bzw. geparst im IndexedDB-Cache.

### 2.3 Skalierungsszenarien (Definition)

Basis = Originalbestand: ~702 Fields, ~30 WM-Orte.

| Szenario | Fields | WM-POIs | Entsprechung |
|---|---|---|---|
| ×2 | ~1.400 | ~60 + Skill-Orte | kleine Mod-Szene |
| ×5 | ~3.500 | ~150–500 | große Skill-/Content-Mods (vgl. FFNx erlaubt 1.200 Maps in der Classic-Modding-Szene — ×5 liegt weit darüber) |
| ×10 | ~7.000 | ~1.000–3.000 | Extremfall/Stresstest |
| Deckel | — | 10⁵ (theoretisch) | nur für „ab wann laggt es wirklich" |

---

## 3. Recherche-Befunde: Browser-/Three.js-Performance-Grenzen

### 3.1 Draw Calls — der dominierende Engpass

- **Faustregel:** < 100 Draw Calls/Frame ⇒ 60 FPS auf den meisten Geräten; > 500 ⇒ selbst starke GPUs strugglen ([threejsroadmap.com](https://threejsroadmap.com/blog/draw-calls-the-silent-killer), [Utsubo 100 Tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)).
- **Durchsatz-Obergrenzen:** ~5.500 Draw Calls @60 FPS auf durchschnittlichem Desktop ([StackOverflow](https://stackoverflow.com/questions/41525579/three-js-whats-the-upper-limit-for-holding-60-fps-on-an-average-desktop)); WebGL-Demo: 6.000 Calls @60 FPS / 16.000 Calls @43 FPS auf 2015er-MBP mit iGPU ([StackOverflow](https://stackoverflow.com/questions/37494273/are-webgl-draw-calls-really-really-slow)); rohes CPU-Limit moderner Desktop-CPUs ~5.000–50.000 Calls/Frame ([mysimulator.uk](https://mysimulator.uk/content/articles/instanced-rendering-lod.html)).
- **Praxis-Cases:** 10.000 Einzel-Meshes ⇒ 12–15 FPS auf Laptop; instanced (3 Calls) ⇒ 60 FPS Laptop, 45+ Mobile ([IGC](https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance)). Chrome mit „1 Draw Call pro CAD-Teil": 50 ms/Frame (20 FPS), mit MultiDraw ~1 ms ([Mozilla-Bug 1536673](https://bugzilla.mozilla.org/show_bug.cgi?id=1536673)).
- **Merksatz:** Dreieckszahl ist selten das Problem — Draw-Call-CPU-Overhead schlägt weit vor dem GPU-Fülllimit zu.

### 3.2 Dreiecke, JS-Main-Thread, GC

- Framebudget 60 FPS = 16,67 ms, davon JS idealerweise ≤ 8–12 ms ([StackOverflow](https://stackoverflow.com/questions/41525579/three-js-whats-the-upper-limit-for-holding-60-fps-on-an-average-desktop)).
- Raycast gegen 10.000 Objekte pro Mousemove: 5–10 ms/Frame; dazu GC-Pausen durch Allokationen im Frame ⇒ sichtbares Stottern ([IGC](https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance)).
- Moderne Mittelklasse-GPUs verkraften 10⁵–10⁶ Dreiecke/Frame bei wenigen Draw Calls mühelos (Beleg u. a.: 450k-Partikel-Szene @60 FPS in 3 Draw Calls, [ethereal-patronus](https://github.com/Salwa08/ethereal-patronus)).
- **Mobile Throttling:** nach 5–10 min Dauerlast drosseln mobile Geräte CPU/GPU — kurze Demos täuschen ([IGC](https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance)).

### 3.3 Texturen / VRAM / WebGL-Limits

- RGBA unkomprimiert: 2048² ≈ 16 MB, 4096² ≈ 67 MB, 8192² ≈ 268 MB ([browsertrace](https://browsertrace.online/details/rendering/max-texture-size.html)).
- MAX_TEXTURE_SIZE: Budget/iGPU 4096, Midrange 8192, High-End 16384; ~99 % der Geräte können ≥ 4096 ([webgl2fundamentals](https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html), [browsertrace](https://browsertrace.online/details/rendering/max-texture-size.html)).
- **Arbeitsbudgets (Annahme A4):** Mobile-Tab praktisch ~300–500 MB GPU/RAM-Gesamtkontingent; Desktop-Tab ~1–2 GB, bevor Browser-Memory-Pressure greift (vgl. Unity-WebGL-Mobile-Problematik ab ~1,5 GB Heap, [Unity-Forum](https://discussions.unity.com/t/webgl-mobile-browsers-memory-problems/850324)). Textur-Binds sind auf Mobile der engere Pfad als Textur-Größe (Phaser-Messreihe: optimierte Pipeline 15.104 Binds @60 FPS iPhone SE, naive Pipeline 192, [Phaser Changelog](https://github.com/phaserjs/phaser/blob/master/changelog/v3/3.60/MobilePerformance.md)).

### 3.4 Konsequenz für WebMidgars Architektur

WebMidgar nutzt bereits Atlas-Packer, GPU-Registry/VRAM-Budgets und Worker-Parsing — also genau die Maßnahmen, die die Literatur als wirksam ausweist (Merge, Atlas, Instancing, Culling, Budgets). Die Worldmap muss in **dieselbe Disziplin** eingebunden werden, dann liegen ihre Grenzen weit jenseits realistischer Mod-Szenarien.

---

## 4. Lastmodell: wo entstehen Kosten bei „mehr Orten"?

### 4.1 Kostenfaktoren und Skalierungsverhalten

| Faktor | Skaliert mit POI-/Field-Anzahl? | Größenordnung & Grenze |
|---|---|---|
| **Terrain-Draw-Calls** | Nein (konstant) | Gemergt + Atlas: ~10–50 Calls (aktives Fenster + Wasser/Himmel + Modelle). Unverändert bei ×10. |
| **POI-Marker-Draw-Calls** | Ja — aber nur wenn naiv | Naiv 1 Call/Marker: ×10 (3.000 Marker) ⇒ 3.000 Calls ⇒ **< 30 FPS** (Grenze ~500–1.000 sichtbar, ~5.500 hart). Instanced: **1–5 Calls konstant** bis ≥ 10⁵ Marker. |
| **POI-Marker-Dreiecke** | Ja, vernachlässigbar | 2 Dreiecke/Marker-Quad; 10⁵ Marker = 200k Dreiecke ≈ Verdopplung der Gesamtwelt — für GPU irrelevant. |
| **Proximity-/Trigger-Checks** | Ja, CPU | O(n) Integer-Distanzcheck: ~1 µs/POI grob ⇒ 3.000 POIs ≈ 3 ms/Frame — **zu viel** im Fixed-Tick. Mit Spatial-Hash (aktives Blockfenster): **< 0,05 ms konstant**. |
| **POI-Metadaten (Heap/IndexedDB)** | Ja, linear, klein | ~150 B/POI ⇒ ×10 ≈ 0,5 MB; 10⁵ POIs ≈ 15 MB — unkritisch. |
| **Field-Daten gesamt (Cache)** | Ja, linear | Annahme A5: geparstes Field-Cache-Objekt Ø 0,2–1 MB ⇒ ×2 ≈ +0,7 GB ungecapped ⇒ **IndexedDB-/Quota-Problem vor RAM-Problem**. Mit LRU-Cap (z. B. 200 Entries) konstant. |
| **VRAM (Worldmap)** | Nein (Marker-Atlas ausgenommen) | Terrain-Texturen < 25 MB + Marker-Atlas 1024²–2048² (4–16 MB) ⇒ weit unter Mobile-Budget. |
| **Field-Wechsel-Latenz (warm)** | Nein | Bleibt ~5,1 ms Median — unabhängig von Gesamtzahl der Fields (nur Ziel-Field wird geladen). |
| **Field-Wechsel (kalt: FSA-Read + Parse + Atlas-Pack)** | Indirekt (mehr neue Ziele) | Long-Task-Risiko; einmalig pro Field, dann Cache. Mod-Fields ohne Realdaten-Probe können überraschend groß sein. |
| **IndexedDB-Reads** | Ja, pro Wechsel | Ein Lookup pro Wechsel; Größe der DB beeinflusst Latenz nur schwach; kein Frame-Effekt. |
| **Save/Serialize** | Schwach | POI-Zustände (entdeckt/respawn) wachsen linear; bei 10⁵ POIs erst relevant. |

### 4.2 Quantifizierte Szenarien (Mittelklasse-Referenz: Laptop mit Iris-Xe-iGPU, Chrome; Annahme A6)

| Szenario | Diszipliniert (Instancing/Atlas/Hash/LRU) | Naiv (1 Mesh/POI, O(n)-Checks, ungecapped) |
|---|---|---|
| ×2 (1.400 Fields, ~60–100 POIs) | 60 FPS, VRAM +< 20 MB, Wechsel unverändert ~5 ms warm | 60 FPS — noch keine spürbare Grenze |
| ×5 (3.500 Fields, ~300 POIs) | 60 FPS; Marker-Atlas evtl. zweite Seite (+4 MB); TTFF unverändert | ~45–55 FPS bei 300 eigenen Draw Calls; Long-Task-Spitzen bei Kalt-Wechseln |
| ×10 (7.000 Fields, ~1.000–3.000 POIs) | 60 FPS; VRAM < 100 MB; IndexedDB-Footprint GB-range ⇒ LRU-Pflicht | **15–30 FPS** (Draw-Call-Limit), Trigger-Checks +2–3 ms/Frame, Heap-Wachstum → GC-Ruckler |
| 10⁵ POIs (Stresstest) | 60 FPS solange Instancing + Culling; Atlas-Deckel (2048², Mobile-Limit 4096²) wird zur Grenze | unbrauchbar (< 10 FPS) |

**Interpretation:** Die „Lag-Kante" liegt im naiven Fall zwischen **~300 und ~1.000 POIs** (Draw Calls + per-Frame-Checks); im disziplinierten Fall existiert im Mod-Rahmen **keine erreichbare Kante** — die Begrenzer werden dann exotisch (Atlas-Größe vs. MAX_TEXTURE_SIZE, IndexedDB-Quota, Save-Größe).

### 4.3 Wo die echten Risiken liegen (unabhängig von der Anzahl)

1. **Terrain-Renderer des WM-Moduls selbst:** 64–144 aktive Meshes als Einzel-`Mesh`-Objekte ⇒ 64–144 Draw Calls — noch ok, aber mit Modellen, Wasseranimation, Minimap, POI-Markern summiert sich das. → Merge statischer Meshes pro Block, Textur-Atlas (512 Slots passen in 1–2 Atlanten à 2048²/4096²).
2. **Kalt-Field-Wechsel:** FSA-Read + LZS-Dekompression + Parse + Atlas-Pack auf dem Main-Thread ⇒ Long Tasks > 50 ms möglich. → Worker-Pipeline (existiert), TTFF-Budgets, Pre-Warming entlang Gateway-Nachbarschaft.
3. **Mod-Fields ohne Budget-Disziplin:** Ein einzelnes riesiges Mod-Field (viele Tiles/Texturen) kann VRAM-Budget und Parse-Budget sprengen — unabhängig von der Gesamtzahl. → Budget-Verweigerung wie im Modsystem vorgesehen, Realdaten-Proben-Pflicht.
4. **Mobile/Dauerlast:** Throttling nach Minuten; WM-Szene sollte auf Mobile mit Pixel-Ratio-Cap und reduziertem Fenster laufen. Soak-Tests (existieren) auf WM-Szene ausdehnen.

---

## 5. Dämpfungsmaßnahmen (Maßnahmenkatalog für das WM-Modul)

| Maßnahme | Adressiert | Aufwand |
|---|---|---|
| Statische Terrain-Meshes pro Block mergen (BufferGeometryUtils) | Draw Calls | S |
| WM-Texturen in 1–2 Atlanten (2048²–4096², ≤ MAX_TEXTURE_SIZE-Minimum 4096) | Draw Calls, Binds, VRAM | S–M |
| POI-Marker als InstancedMesh/BatchedMesh (1–5 Calls) | Draw Calls bei ×5–×10 | S |
| Spatial-Hash/Blockfenster für Trigger + Sichtbarkeit (Culling) | Fixed-Tick-CPU, Offscreen-Marker | S |
| Blockfenster-Streaming wie Original (BOT-Design: Block + 3 Nachbarn) | VRAM, Parse-Last, TTFF | M (Teil des WM-MVP) |
| LRU-Cap für Field-Cache (IndexedDB), Quota-Monitoring | Heap/Quota bei ×10 | S |
| Worker-Parsing für Fields + WM-Meshes (LZSS), Progressive-Commit | Long Tasks bei Kalt-Wechsel | M (Field-Seite existiert) |
| Budget-Verweigerung für Mods (VRAM-, Atlas-, POI-Deckel im Manifest) | Mod-Ausreißer | S (Mechanik existiert) |
| LOD/Impostor nur für WM-Modelle/Marker in der Ferne (nicht fürs Terrain) | Dreiecke/Binds | M, optional |
| NFR-Instrumentierung: WM-Framebudget, Wechsel-TTFF, Soak mit Heap/VRAM-Baseline | Nachweis statt Gefühl | S (Kultur existiert) |

---

## 6. Aufwand der Performance-Absicherung (zusätzlich zum WM-MVP)

| Paket | Schätzung |
|---|---|
| Terrain-Merge + Atlas-Integration in GPU-Registry | 2–3 PT |
| Instanced POI-Marker + Spatial-Hash-Trigger | 1–2 PT |
| Field-Cache-LRU + Quota-Guard | 1 PT |
| NFR-/Soak-Erweiterung (WM-Szene, ×2/×5/×10-Synthese-Mods als Lasttest) | 2–3 PT |
| **Summe** | **6–9 PT** (S–M) |

Hinweis: Die Synthese-Mods (×2/×5/×10 generierte POIs/Fields) sind der eigentliche Mehrwert — sie machen die Schätzungen aus Abschnitt 4 **messbar**, statt sie zu behaupten (NFR-Kultur: Realdaten-Proben).

---

## 7. Risiken

| Risiko | Bewertung | Mitigation |
|---|---|---|
| Schätzungen (A1–A6) weichen ab — WM-Mesh-Dichte, Field-Cache-Größe | Mittel | Früh messen: echten wm0-Block parsen (Realdaten-Probe), Dreiecke zählen, Obj-Export (landscaper/ff7MapToObj) zur Verifikation |
| WM-MVP wird ohne Merge/Atlas gebaut ⇒ Draw-Call-Basis schon hoch | Mittel | Merge+Atlas als **Akzeptanzkriterium** des WM-MVP, nicht als spätere Optimierung |
| Mobile/Quota-Grenzen unterschätzt (IndexedDB, Throttling) | Niedrig–Mittel | LRU-Cap, Pixel-Ratio-Cap, Soak-Tests auf Zielhardware |
| Mod-Ökosystem liefert Monster-Fields (NFR-Verletzung einzelner Assets) | Mittel | Budget-Verweigerung + klare Mod-Richtwerte (z. B. Field-VRAM ≤ X MB, Tiles ≤ Y) |
| „Lag durch Anzahl" wird zum Mythos und blockiert Feature-Entscheidungen | Niedrig | Diese Analyse + Lasttest-Mods als Beleg |

---

## 8. Abhängigkeiten

- **Hart:** Worldmap-Modul MVP (Renderer, Streaming, Fixed-Tick) — die Performance-Disziplin muss dort von Tag 1 eingeplant sein.
- **Weich:** Analyse 03 (POI-Schicht) liefert die Marker-/Trigger-Implementierung, deren Instancing/Hash hier vorausgesetzt wird.
- **Bestehend:** GPU-Registry/VRAM-Budgets, Atlas-Packer, Worker-Pipeline, Telemetry/Long-Task-Messung, Soak-Tests, Mod-Budget-Verweigerung.
- **Extern (Wissen):** Format-Doku wiki.ffrtt.ru; Three.js-/WebGL-Community-Werte (Draw-Call-Faustregeln, MAX_TEXTURE_SIZE-Verteilung); ff7-landscaper zur Realdaten-Verifikation (nur lesend, keine Lizenz → kein Code).

---

## 9. Empfehlung

1. **Verdikt: Skalierung ×2–×10 ist machbar und unkritisch — unter der Bedingung, dass Merge/Atlas/Instancing/Streaming als WM-MVP-Definition gelten.** Ohne diese Disziplin kippt die Szene ab ~300–1.000 POIs in den Draw-Call-Tod; mit ihr ist selbst der ×10-Stresstest ein 60-FPS-Szenario auf Mittelklasse-Hardware.
2. **Budgets jetzt festlegen** (Vorschlag für NFR-ADR): WM-Szene ≤ 100 Draw Calls/Frame; WM-VRAM ≤ 64 MB (Desktop) / ≤ 32 MB (Mobile); POI-Trigger-Checks ≤ 0,5 ms/Tick; Field-Wechsel warm ≤ bisheriges Budget (Median ~5,1 ms); Kalt-TTFF-Budget mit Worker-Parsing; Field-Cache-LRU mit Quota-Guard.
3. **Lasttest-Mods bauen, bevor echte Mods kommen:** Generatoren für ×2/×5/×10-POIs/Fields als interne Test-`.wmmod`s; Ergebnisse in die Soak-/Telemetry-Suite aufnehmen. Damit wird „ab wann laggt es" eine gemessene statt geschätzte Zahl.
4. **Keine Sonderbehandlung für „viele Fields":** Die Field-Anzahl ist ein Cache-/Quota-Thema, kein Frame-Thema. Kommunikation ins Modsystem: Deckel über Budgets (pro Mod), nicht über globale Anzahl-Limits.
5. **Mobile explizit adressieren:** Pixel-Ratio-Cap, reduziertes Streaming-Fenster, Throttling-Soak (≥ 10 min) — sonst misst man 60 FPS in einer 30-Sekunden-Demo und liefert 25 FPS im realen Spiel.

---

## 10. Quellen

**FF7-Worldmap-Format / -Ökosystem:**
- WorldMap Module (Blöcke, Meshes, BOT-Streaming, Texturen, Walkmap): https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module
- World Map TXZ (Textur-Tabelle 512 Slots, VRAM-Blöcke): https://wiki.ffrtt.ru/index.php/FF7/World_Map/TXZ
- Worldmap Script (.ev): https://wiki.ffrtt.ru/index.php/FF7/WorldMap_Module/Script
- Qhimm 18560 (WM-Sprungziele, Field-IDs 1–64): https://forums.qhimm.com/index.php?topic=18560.50
- Qhimm 10717 (ff7MapToObj, Block-Größen, wm0.obj ~20 MB): https://forums.qhimm.com/index.php?topic=10717.0
- ff7-landscaper (Format-Parser in TS, Verifikationsquelle): https://github.com/maciej-trebacz/ff7-landscaper

**Three.js-/WebGL-Performance:**
- Draw Calls — The Silent Killer (<100 Faustregel, >500 kritisch): https://threejsroadmap.com/blog/draw-calls-the-silent-killer
- Utsubo — 100 Three.js Tips (Draw-Call-Regeln, Instancing/Batching/Merging, 90 %+ Reduktion): https://www.utsubo.com/blog/threejs-best-practices-100-tips
- IGC — Three.js Performance (10k Meshes 12–15 FPS vs. instanced 60 FPS; Raycast-Kosten; Mobile-Throttling; Memory-Tabelle): https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance
- StackOverflow — Upper limit 60 FPS (~5.500 Draw Calls): https://stackoverflow.com/questions/41525579/three-js-whats-the-upper-limit-for-holding-60-fps-on-an-average-desktop
- StackOverflow — WebGL Draw Calls (6.000 @60 FPS iGPU, 16.000 @43 FPS): https://stackoverflow.com/questions/37494273/are-webgl-draw-calls-really-really-slow
- mysimulator.uk — Instancing & LOD (CPU-Draw-Call-Budget 5.000–50.000/Frame): https://mysimulator.uk/content/articles/instanced-rendering-lod.html
- Mozilla-Bug 1536673 (Chrome 1-Call-pro-Teil 50 ms vs. MultiDraw ~1 ms): https://bugzilla.mozilla.org/show_bug.cgi?id=1536673
- webgl2fundamentals — Cross-Platform-Limits (4096 = 99 %-Geräte): https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html
- browsertrace — MAX_TEXTURE_SIZE-Klassen + VRAM-Quadratzahlen: https://browsertrace.online/details/rendering/max-texture-size.html
- Phaser 3.60 MobilePerformance (Textur-Bind-Limits, iPhone SE 15.104 @60 FPS): https://github.com/phaserjs/phaser/blob/master/changelog/v3/3.60/MobilePerformance.md
- Unity-Forum — Mobile WebGL Memory-Probleme (~1,5 GB-Heap-Grenze): https://discussions.unity.com/t/webgl-mobile-browsers-memory-problems/850324