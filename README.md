# WebMidgar

Open-Source-Reimplementierung der technischen Laufzeitumgebung von
*Final Fantasy VII (PC, 1998)* im Browser, aufgebaut aus dokumentierten und
selbst rekonstruierten Formatfakten. Originaldaten werden ausschließlich
lokal vom Nutzer bereitgestellt (File System Access API) und clientseitig
verarbeitet — kein Upload, keine Verteilung proprietärer Daten.

**Architekturreferenz:** [docs/WEBMIDGAR-MASTERPLAN.md](docs/WEBMIDGAR-MASTERPLAN.md)
· **Umgang mit Fremdquellen:** [ADR-027](docs/ADR-027-DECOMP-REFERENZ.md)
(dekompilierte Quellen als Referenz zugelassen, Textübernahme ausgeschlossen)

## Stand

- ✅ **S1 — LGP-Indexer & FSA-Zugriffsschicht** (Masterplan-Roadmap)
- ✅ **S2 — Field-Container-Parser & Validierungs-Framework** (LZS, 9 Sektionen, Walkmesh/Kamera/Trigger/Script-Spans)
- ✅ **S3 — Worker-Pipeline & Cache-Gerüst** (Nachrichtenverträge, Generations-Abbruch, S0–S2-Caches, NFR-Telemetrie)
- ✅ **S4 — Kamera-Kalibrierung & Hintergrund-Komposition** (Koordinatenkonvertierung, `C=−Rᵀ·t`, Tile-Depth, Letterbox; [Kalibrier-Doku](tools/calibration/CALIBRATION.md))
- ✅ **S5 — Walkmesh-Solver-Prototyp** + **Realdaten-Crosstest** gegen Steam-Installation ([Befunde](tools/realdata-scan/FINDINGS.md): Lookup-Tabelle & 516-Byte-Trigger bestätigt, Kamerarecord = 38 Bytes korrigiert, 140k Solver-Schritte auf 702 echten Walkmeshes ohne Invariantenverletzung)
- ✅ **S6 — Interpreter-Grundgerüst** (Fixed-Tick-Scheduler, waitState als Daten, Snapshot/Restore mit Script-Hash-Guard, Ringpuffer-Trace, 10k-Tick-Replay-Digest; Kategorien Kontrollfluss/Variablen/Dialog-Stub, UNKNOWN-Politik; Realdaten: 702/702 Fields deterministisch, [R1-Notiz](docs/R1-REQUEST-SEMANTIK.md))
- ✅ **S7 — Modell-Kette `char.lgp`** (hrc/rsd/p/tex/a-Parser mit realdaten-validierten Layouts, Index-Flattening, Bindpose + Gelenk-Weltposen numerisch asserted, Three-Actor mit Referenzmathematik-Dualität; Realdaten: 12.649/12.649 Artefakte parsen, alle 385 Ketten auflösbar; [R4-Notiz](docs/R4-MODELL-KONVENTIONEN.md))

- ✅ **S8 — Field-Hintergrund-Parser** (Sektionen 4 + 9: Paletten, 4-Layer-Modell mit realdaten-erschlossener Separator-Regel, 52-B-Tiles, Texturseiten; 702/702 Fields mit exaktem Accounting; Fortsetzungs-Roadmap in [ROADMAP-S8-S12.md](docs/ROADMAP-S8-S12.md))
- ✅ **S9 — Hintergrund-Rendering + R2-Entscheid** (Tile-Semantik über 647.531 Tiles erschlossen: Palette u8@24 statt u16@20 korrigiert, Texturseite u8@34, UV-Cache-Regel `src2 vor src`; Atlas-Packer mit 1 Atlas je Field, texturierte Tile-Depth-Quads; Abnahme per Bildkohärenztest gegen Gegenhypothesen; **FOV-Basis 240 realdaten-entschieden** — [Kalibrier-Doku](tools/calibration/CALIBRATION.md))
- ✅ **S10 — Model-Loader-Sektion (Field-Sektion 3)** (Grammatik über fünf Probeniterationen erschlossen, 702/702 Fields byteexakt; Modell- und Animationsreferenzen zu **100 %** gegen `char.lgp` auflösbar — inklusive der Korrektur, dass Animationsnamen den Stamm plus eine Kennung tragen und die Datei `<stamm>.a` heißt)
- ✅ **S11 — Field-Integration (vertikaler Durchstich)**: `packages/field-runtime` bindet Solver, Trigger, Interpreter und Dialogbrücke zu einer Fixed-Tick-Sitzung mit Snapshot/Restore und Eingabe-Replay (Realdaten: 702 Fields × 240 Takte, **0 Digest-Abweichungen**; Wechselbudget Median 5,1 ms gegen 500 ms NFR). Der Field-Wechsel läuft: Zielfield über die `maplist` (u16@14, per Graph-Symmetrie belegt — 78,8 % Rückkanten gegen 0,2 % Kontrolle), Ankunft über das Gegen-Gateway, weil der Zielpunkt nachweislich **nicht** im Record steht. **R4 gelöst:** Feldmodelle stehen aufrecht. Der Kindversatz lief nach `+parentLength`, richtig ist `−parentLength`; Eulerreihenfolge YXZ (Dateikopf, 3209/3209) und Wurzelwinkel −90° waren bereits richtig. Entschieden hat eine **Tafel mit 50 gerenderten Renderketten** — vier vorangegangene Aggregat-Gütefunktionen konnten die Frage nicht beantworten, weil jede die gesuchte Richtung wegaggregiert. Nachgewiesen numerisch (Produktionskette == als richtig erkannte Zelle) und gegen Überanpassung an drei weiteren Modellen in drei Ansichten ([Analyse](docs/R4-MODELL-KONVENTIONEN.md))
- ✅ **S12 — Interpreter-Ausbau**: Operandenlängen **aus den Realdaten abgeleitet** statt aus Dokumentation übernommen (Spannen-Abschluss 43,19 % → 99,73 %); unknown-op-Faults von 7241 auf **0**, Fault-Rate rund 3 %; Bewegungs-Opcodes gegen den Solver, Feldaufteilung realdaten-geprüft. **Nachgezogen (O9):** Die Referenztabelle wurde posten für posten gegengemessen — 16 von 103 Abweichungen übernommen, Abschluss **99,92 %**, Overrun **0,06 %**. Pauschal übernommen hätte die Referenz auf 86,77 % gedrückt. Dabei zwei echte Fehler gefunden: die linke Adresse der Wort-IF-Opcodes ist zwei Byte breit (VM las eines), und der Sitzungs-Snapshot führte die Bewegungs-Stillstandszähler nicht mit (3/702 Fields brachen beim Restore)
- ✅ **S13 — Kernel-Datenbasis + Textdekoder** (`packages/formats-kernel`): 27-Sektionen-Container mit gzip, Zeichentabellen-Versatz 0x20 aus den Daten abgeleitet, 98,9 % der Zeichenketten dekodieren vollständig
- ✅ **S14 — Bankmodell + Spielstände** (`packages/formats-save`): Bank-Aliasing korrigiert (5 persistente Regionen statt 15 unabhängiger Bänke), eigenes versioniertes Spielstandsformat mit IndexedDB-Speicher; Original-Saves vollständig gelesen **inklusive Prüfsumme** (CRC-16/CCITT mit Nachlauf-XOR über `slot[4…]`, 8/8 belegte Slots; die Prüfsumme entscheidet zugleich die zuvor mehrdeutige Kopflänge)
- ✅ **S15 — Dialog- und Textsystem** (`packages/dialog`): Fenster-/Textlayout mit Umbruch, Seiten, Textgeschwindigkeit und Auswahl — vollständig in Takten statt Millisekunden, damit Replays exakt bleiben
- 🔶 **S16 — Audio** (`packages/audio`): OGG-Schleifenmarken und Engine-Kommandomodell mit Autoplay-Sperre stehen. **`audio.fmt` ist vollständig gelöst** — 24 B Vorspann (`Length, Offset, Loop, Count, Start, End`) + 50 B `ADPCMWAVEFORMAT` = 74 B. **Nachgetragen 2026-08-10:** Die Datei ist kein Feld gleich großer Einträge, sondern eine Folge von **26 Bänken**, jede mit einer 42 B kurzen Abschlussmarke — der erste Durchlauf hielt die *erste* Marke für das Dateiende und ließ dadurch 67,6 % der Daten als „unadressiert" stehen. Jetzt byteexakt (724×74 + 26×42 = 54.668) und `audio.dat` zu **100,0000 %** überdeckt, MS-ADPCM-Prädiktortest 66.332/66.332 gegen Kontrollen bei 77 % / 59 %. Die Musikindex-Zuordnung bleibt offen (O2); ein MS-ADPCM-Dekoder fehlt noch
- ✅ **S17 — Story-Progression**: Wirkungen nach außen als Daten (`HostRequest`); Audio-Ops, der **aus den Daten identifizierte** Field-Wechsel-Opcode `0x60` und der **Kampf-Opcode `0x70`** sind verdrahtet — inklusive Wartezustand und Rückkanal. Der Kampf-Opcode war lange ein Negativbefund, weil in der falschen Menge gesucht wurde: Die Formationsnummer ist global, nicht aus der Encounter-Tabelle des Fields (nachgemessen 1/173 gegen 1/173 im Kontrollfield)
- ✅ **S18 — App-Shell** (`packages/app-shell`): Import-Zustandsmaschine inkl. Re-Grant-Pfad, Fähigkeitsmatrix mit Einzeldiagnosen, **beweisbar assetfreier** Diagnose-Export
- ✅ **S19 — Modding-MVP** (`packages/modding`): Manifest-Validierung mit mod-lokalen Fehlern, fünfstufige Auflösungskette mit Herkunfts-Tags, explizite Load-Order, generationsbasierte Umschaltung
- ✅ **S20 — Härtung & Beta-Gate** (`tools/nfr-run`): NFR-Messkampagne gegen synthetische Fake-Installation **und** echte Installation — alle Desktop-Sollwerte der Phase 2.4 eingehalten (Field-Wechsel p95 **10,12 ms** gegen 500 ms Budget, TTFF kalt 48 ms, Heap 25 MB gegen 256 MB); Soak über **500 Field-Wechsel** mit exakter Rückkehr der GPU-Buchführung auf 0 und **+1,07 %** Heap; **R9-Fund**: Chromium 151 lieferte einen abweichenden Replay-Digest, Ursache per Math-Fingerprint auf `Math.atan2` eingegrenzt und behoben (Richtungswinkel auf die 256 Einheiten des Originals quantisiert, `hypot`→`sqrt`) — danach identisch über Node 22, Chromium 148 und 151; **R5-Matrix** über 57 Archive mit 5 registrierten Release-Fingerprints; **ADR-010 verworfen** (WASM: 79,4 % Lastanteil, aber 2,0 % Budgetauslastung). Berichte: [NFR](docs/NFR-BERICHT-S20.md) · [R9](docs/R9-CROSSBROWSER.md) · [R5](docs/R5-FINGERPRINT-MATRIX.md) · [ADRs](docs/ADR-S20-HAERTUNG.md) · [Beta-Prozess](docs/BETA-PROZESS.md)

- ✅ **S21 — Menü-Grundmodul** (`packages/menu`): Menü-Modell, Sitzung und Formatierung; **Savemap-Feldlage aus den Daten abgeleitet** (Charakterrecords Basis 84, Schrittweite 132 — Namensraster trifft bei 100+i·132, Kontrolle auf verwürfelten Slots 0 Treffer; Level per Konkordanz mit dem HP-Maximum 0,974 gegen Kontrollniveau 0,638; Gil u32@32 und Spielzeit u32@36 über Duplikatgruppen; Inventar ab 1276 mit `Anzahl = wert>>9`, weil die 8/8-Aufteilung „Anzahl 1" **überhaupt nicht** kennt). Kernel-Sektionsrollen: 0–8 Recordtabellen, 9–26 Textlisten
- ✅ **Welle 4 — Durchstich** (`interpreter`, `walkmesh`, `field-runtime`): **O11** behoben — Rücksprünge zählen vom Opcode-Byte (`JMPB` 99,5 % gegen 0,7 % Kontrolle), in einem Zug mit dem Fixture-Assembler, alle drei Replay-Digests entsprechend fortgeschrieben. **F15** gelöst: Der Gateway-Record war zur Hälfte falsch gedeutet — Austrittsstelle @2/@4 (85,5 % im eigenen Netz gegen 27,0 %), **Ankunftsstelle @8/@10 (100,0 %, 978/978)**. Damit ist der S11-Befund „der Zielpunkt steht nicht im Record" widerlegt: Er war zu eng gemessen, @8 stand nie in der Kandidatenmenge. Kanten mit begehbarer Ankunft 510 → **978 von 1095**; der Feldwechsel läuft (`md1stin` → `md1_1` → `md1_2`). **Wellenabnahme bestanden:** eine gelaufene Kette von **6 Feldwechseln am Stück** über sechs verschiedene Fields (`md1stin` → `md1_1` → `md1_2` → `nrthmk` → `md8_4` → `nrthmk` → `nmkin_1`), jeder Übertritt durch Bewegung ausgelöst; Gegenprobe „stehende Figur, 1200 Takte" **0 Übertritte**. **F07** gelöst — das Menü **handelt**: Ausrüsten über einen Schreibpfad in den 4340-B-Slot (Abnahme über die **Bytedifferenz**: außerhalb des erlaubten Fensters darf sich nichts bewegen; Stückzahlerhaltung über Inventar **und** Ausrüstungsspalten) und Speichern/Laden in Schemaversion 2, die die Savemap mitführt und Version-1-Stände migriert. **F35** vermessen und **ohne Codeänderung geschlossen**: Drei Deutungen der leeren Hintergrundmaske scheitern an ihren eigenen Vorhersagen, die Vertauschungskontrolle entwertet das Größensignal (35/27 gegen 36/25), und der deutungsfreie Bildanteil-Test gibt der geltenden Zeichenregel recht — **Median 0,0 %**, genau 1 Field von 508 über 50 %
- ✅ **Welle 3 — Spielschrift** (`packages/ui-window/src/font.ts`, `text-paint.ts`): Dialog, Menü und Kampf-HUD zeichnen aus dem Fontblatt der Installation (`WINDOW.BIN` Sektion 1) statt aus einer Systemschrift — Zellennummer = Textcode, Vorschub aus der Breitentabelle, der Schatten kommt aus dem Blatt selbst. Abdeckung über 702 Fields **99,9993 %** (2 584 232 von 2 584 250 Zeichen), Stimmigkeit der Kette Zeichen→Code→Zelle **84,19 %** gegen Kontrollen bei 45,58 % / 39,26 %. Die Schrift deckte zwei Fehler der geratenen Menügeometrie auf; die Spaltenbreite ist jetzt aus der Schrift **nach unten begrenzt** statt geraten ([Befunde](docs/DEMO-FINDINGS-1.0.md))
- ✅ **S27 — Eingabe-Abstraktion** (`packages/input`): Tastatur, Gamepad und Touch auf **einen** semantischen Aktionsstrom; Abtastung genau einmal pro Tick, Flanken aus der Tick-Differenz statt aus Event-Handlern, Analogachsen ganzzahlig quantisiert. Belegungen und Touch-Layout als Daten
- ✅ **S28 — Weltkarte I** (`packages/formats-world`, `packages/render-world`): Blockgrammatik **85/85** MAP-Blöcke (Kontrolle bei 2 B Versatz **0/85**), Mesh-Accounting **1360/1360 byteexakt**, Nahtstetigkeit **828/828** perfekt (Fremdpaar-Kontrolle 0,56), Blockanordnung WM0 = 9×7 (Nähte 440/440 gegen 0,764). WM3 ist **nicht messbar** — 12 Unikate auf 64 Meshes machen die Gütefunktion blind, das steht als Annahme statt als Befund
- ✅ **S29 — Weltkarte II** (`packages/world-runtime`, ADR-025): `.ev` ist eine **eigene** u16-Stack-Grammatik (die Field-Tabelle schließt nur 6–44 % gegen 99,73 % auf `flevel`), Funktions-Abschluss 175/175, Sprungziele **732/732** auf Instruktionsgrenzen (Kontrollen 62 % / 36 %). Fahrzeugmatrix als austauschbare Tabelle, Erreichbarkeitsprobe über 142.586 Dreiecke mit verdrehter Kontrollmatrix ⇒ 0. **Nachgezogen:** Kommando-Stelligkeit per Anweisungsbilanz über 2360 Anweisungen widerspruchsfrei (Kontrollen 110 / 1833), **unknown-Ops 23,6 % → 0**; WM0-Alternativblöcke am Terrain zugeordnet (Naht 1,0 gegen Kontrollmediane 0,055–0,570)
- ✅ **O3b — Encounter-Tabelle** (Field-Sektion 7): 702/702 byteexakt. Wahrheitstest ist eine **Summenprobe** (genau ein Wert, 64, in 197/197), nicht die Plausibilität der IDs; der naheliegende Referenzschluss misst nichts, weil `id+1` ihn ebenfalls zu 100 % besteht — entschieden hat der **Kampfort** (195/195 gegen Neuziehung 0/195)
- ✅ **O1 vollständig — `audio.fmt` ist bankweise**: 26 Bänke mit je einer 42 B kurzen Abschlussmarke. `audio.dat` jetzt zu **100,0000 %** adressiert (vorher 32,4 %), 0 Lücken, MS-ADPCM-Prädiktortest 66.332/66.332 gegen Kontrollen bei 77 % / 59 %
- ✅ **O5 — LGP-Check-Code** geschlossen als Messergebnis: 45.563 Einträge, nur **zwei Werte**, Entropie 0,1231 Bit. Prüfwert- und Ordnungshypothese beide widerlegt; was trägt, ist eine Partition nach Eintragsart (0x0B ⟺ `.hrc`, 766/766, Nachbarkontrolle 3,00 %)
- ✅ **R4 vollständig** — alle Annahmen B1–B10 entschieden. B7 war ein **Definitionsfehler**: Der Wurzelbone sitzt in der Hüfte, aber die Engine platziert den **Modellursprung**, und der ist der Bodenkontaktpunkt ([Analyse](docs/R4-MODELL-KONVENTIONEN.md), [Urteile](tools/realdata-scan/o4-urteile.json))

## Planung

| Bogen | Inhalt |
|---|---|
| [S20–S26](docs/ROADMAP-S20-S26.md) | Härtung ✅, Menü ✅ (S21), Modding II, Audio-Feinsemantik, Save/Load-UX, 1.0-Politur — **„1.0" ist ausdrücklich noch NICHT erklärt**, s. [S26-Gate](docs/S26-GATE.md) |
| [S27–S36](docs/ROADMAP-S27-S36.md) | Nach 1.0: Touch/Controller ✅ (S27), Weltkarte ✅ (S28/S29), Kampfsystem, Minigames, FMV |
| [S37](docs/ROADMAP-S37-EXE-ANALYSE.md) | Die EXE als **Datenquelle** — statische Tabellen lesen (Import), nicht Code analysieren (Dekompilierung). Vorziehbar; liefert belegte Konstanten statt geratener |
| [Offene Posten](docs/ROADMAP-OFFENE-POSTEN.md) | Forschungsposten mit Methode, Zielsession und benanntem Fallstrick |

## Struktur

| Pfad | Inhalt |
|---|---|
| `packages/formats-lgp` | LGP-Scanner, Namensnormalisierung, Indexmodell, Fehlerklassen |
| `packages/formats-field` | LZS-Dekoder, Field-Container (9 Sektionen), NAM: Walkmesh, Kamera, Trigger, Script-Spans, Model-Loader-Manifest, Paletten, Hintergrund-Layer/-Tiles/-Texturseiten |
| `packages/io` | FSA-/Memory-Quellen, Fingerprinting, IndexService, IO-Worker + Nachrichtenvertrag |
| `packages/cache` | Cache-Stufen S0–S2: Index-Store, Memory-LRU, budgetierter IndexedDB-Asset-Store |
| `packages/pipeline` | Worker-Verträge, Client mit Generations-Abbruch (SAB-optional), Worker-Host, AssetPipeline |
| `packages/telemetry` | Zähler, Latenzen, Long-Task-/Lag-Probe (NFR-Instrumentierung) |
| `packages/convert` | Zentrale Koordinatenkonvertierung (ADR-009), Kamerarekonstruktion, Referenzprojektion, Depth-Mapping |
| `packages/render-field` | Three.js: PerspectiveCamera-Aufbau, Letterbox-Kompositor, Tile-Depth-Hintergrundmesh, Tile-Auflösung + Atlas-Packer (Three-frei) |
| `packages/walkmesh` | Bewegungs-Solver (Punkt-in-Dreieck, Kantenübertritt, Sliding), Gateway-Querung, Debug-Daten |
| `packages/field-runtime` | Field-Sitzung: Fixed-Tick-Schleife über Solver + Trigger + Interpreter, Snapshot/Restore, Eingabe-Replay, Field-Wechsel (framework-frei) |
| `packages/formats-kernel` | `kernel.bin`-Container (27 gzip-Sektionen) + FF-Textdekoder mit abgeleiteter Zeichentabelle |
| `packages/formats-save` | Eigenes Spielstandsformat + IndexedDB-Speicher; Leser für originale `save*.ff7` |
| `packages/dialog` | Fenster-/Textlayout, Seiten, Textgeschwindigkeit, Auswahl — in Takten, DOM-frei |
| `packages/audio` | OGG-Schleifenmarken (ohne Audiodekodierung) + Engine-Kommandomodell mit Autoplay-Sperre |
| `packages/input` | Eingabeschicht: Tastatur/Gamepad/Touch → ein semantischer Aktionsstrom, Abtastung am Tick, Belegung und Touch-Layout als Daten |
| `packages/menu` | Menü-Modell, Sitzung und Formatierung (S21) |
| `packages/formats-world` | Weltkarten-Terrain (Blöcke, Meshes, Vertices) und `.ev`-World-Script |
| `packages/render-world` | Blockweises Weltkarten-Streaming mit eigener Generationsachse, Höhenabfrage, Fortschrittsstufen |
| `packages/world-runtime` | World-Script-VM und Fixed-Tick-Weltkartensitzung im ADR-006-Vertrag; Fahrzeugmatrix als austauschbare Tabelle |
| `packages/app-shell` | Import-Zustandsmaschine, Fähigkeitsprüfung, assetfreier Diagnose-Export |
| `packages/modding` | Mod-Manifest-Validierung + fünfstufige Auflösungskette mit Herkunfts-Tags |
| `packages/interpreter` | Fixed-Tick-Interpreter: VM (Kontrollfluss/Variablen/Dialog-Stub), Scheduler, Serde, Replay |
| `packages/interpreter-debug` | Event-Timeline (JSON, asset-frei), Breakpoints + Einzelschritt |
| `packages/formats-model` | Modellkette: hrc/rsd/p/tex/a → Skeleton/Binding/Mesh/Textur/Clip (Index-Flattening, Degradierung) |
| `packages/render-actor` | Bindpose + Posenmathematik (Referenz), Animationsbindung, Three-Actor, Kapsel-Fallback |
| `packages/license-steam` | Opt-in-Steam-Besitznachweis (Client): Popup/postMessage + Polling-Fallback, DOM über injizierte Interfaces |
| `tools/calibration` | Kalibrierentscheidungen (FOV-Basis, Depth, Letterbox) als versioniertes Artefakt |
| `tools/realdata-scan` | Diagnose-Scan gegen lokale Installation (`npx vitest run --config vitest.realdata.config.ts`) |
| `tools/fixture-gen` | Eigenständige Writer für Golden Fixtures: LGP, Field-Composer, Script-Assembler + Defekt-Mutationen |
| `tools/nfr-run` | NFR-Sollwerte als Daten, synthetische Fake-Installation, Messkampagne, Soak-Test, Replay-Vektoren, Math-Fingerprint, Release-Fingerprints |
| `tools/steam-auth-relay` | Selbst-hostbarer Auth-Relay: Steam OpenID 2.0 (check_authentication, Nonce-Dedup) + Besitzprüfung (CheckAppOwnership mit GetOwnedGames-Fallback) |
| `apps/demo` | Diagnose- und Kalibrierseiten: Import, Kamera/Tile-Depth, Walkmesh, Actor, Field-Hintergrund, NFR-Messlauf, R9-Digestvergleich, Math-Fingerprint, Beta-Seite, Steam-Lizenznachweis |

## Kommandos

```bash
npm test        # Vitest (Golden Fixtures + alle Fehlerklassen + NFR-Lauf + Soak)
npm run demo    # Diagnose-Demo auf http://localhost:5199
npx tsc --noEmit

npx vitest run --config vitest.realdata.config.ts   # Realdaten-Läufe (opt-in, lokale Installation)
```

Messseiten der Demo: `/nfr.html` (NFR-Bilanz, GPU-Upload, Speicherkontingent),
`/r9.html` (Replay-Digests über Engines), `/mathprobe.html` (Math-Fingerprint),
`/beta.html` (bekannte Einschränkungen + Diagnose-Anleitung).

Golden Fixtures sind ausschließlich selbst erzeugte Minimaldaten — es liegen
keine Originaldaten im Repository.
