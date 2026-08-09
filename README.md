# WebMidgar

Open-Source-Clean-Room-Reimplementierung der technischen Laufzeitumgebung von
*Final Fantasy VII (PC, 1998)* im Browser. Originaldaten werden ausschließlich
lokal vom Nutzer bereitgestellt (File System Access API) und clientseitig
verarbeitet — kein Upload, keine Verteilung proprietärer Daten.

**Architekturreferenz:** [docs/WEBMIDGAR-MASTERPLAN.md](docs/WEBMIDGAR-MASTERPLAN.md)

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
- ✅ **S11 — Field-Integration (vertikaler Durchstich)**: `packages/field-runtime` bindet Solver, Trigger, Interpreter und Dialogbrücke zu einer Fixed-Tick-Sitzung mit Snapshot/Restore und Eingabe-Replay (Realdaten: 702 Fields × 240 Takte, **0 Digest-Abweichungen**; Wechselbudget Median 5,1 ms gegen 500 ms NFR). Der Field-Wechsel läuft: Zielfield über die `maplist` (u16@14, per Graph-Symmetrie belegt — 78,8 % Rückkanten gegen 0,2 % Kontrolle), Ankunft über das Gegen-Gateway, weil der Zielpunkt nachweislich **nicht** im Record steht. **Offen:** R4-Sichtprüfungen B1–B8 (brauchen ein Auge, [Begründung](docs/R4-MODELL-KONVENTIONEN.md))
- ✅ **S12 — Interpreter-Ausbau**: Operandenlängen **aus den Realdaten abgeleitet** statt aus Dokumentation übernommen (Spannen-Abschluss 43,19 % → 99,73 %); unknown-op-Faults von 7241 auf **0**, Fault-Rate rund 3 %; Bewegungs-Opcodes gegen den Solver, Feldaufteilung realdaten-geprüft
- ✅ **S13 — Kernel-Datenbasis + Textdekoder** (`packages/formats-kernel`): 27-Sektionen-Container mit gzip, Zeichentabellen-Versatz 0x20 aus den Daten abgeleitet, 98,9 % der Zeichenketten dekodieren vollständig
- ✅ **S14 — Bankmodell + Spielstände** (`packages/formats-save`): Bank-Aliasing korrigiert (5 persistente Regionen statt 15 unabhängiger Bänke), eigenes versioniertes Spielstandsformat mit IndexedDB-Speicher; Original-Saves vollständig gelesen **inklusive Prüfsumme** (CRC-16/CCITT mit Nachlauf-XOR über `slot[4…]`, 8/8 belegte Slots; die Prüfsumme entscheidet zugleich die zuvor mehrdeutige Kopflänge)
- ✅ **S15 — Dialog- und Textsystem** (`packages/dialog`): Fenster-/Textlayout mit Umbruch, Seiten, Textgeschwindigkeit und Auswahl — vollständig in Takten statt Millisekunden, damit Replays exakt bleiben
- 🔶 **S16 — Audio** (`packages/audio`): OGG-Schleifenmarken und Engine-Kommandomodell mit Autoplay-Sperre stehen; `audio.fmt` und die Musikindex-Zuordnung sind **Negativbefunde**
- ✅ **S17 — Story-Progression**: Wirkungen nach außen als Daten (`HostRequest`); Audio-Ops, der **aus den Daten identifizierte** Field-Wechsel-Opcode `0x60` und der **Kampf-Opcode `0x70`** sind verdrahtet — inklusive Wartezustand und Rückkanal. Der Kampf-Opcode war lange ein Negativbefund, weil in der falschen Menge gesucht wurde: Die Formationsnummer ist global, nicht aus der Encounter-Tabelle des Fields (nachgemessen 1/173 gegen 1/173 im Kontrollfield)
- ✅ **S18 — App-Shell** (`packages/app-shell`): Import-Zustandsmaschine inkl. Re-Grant-Pfad, Fähigkeitsmatrix mit Einzeldiagnosen, **beweisbar assetfreier** Diagnose-Export
- ✅ **S19 — Modding-MVP** (`packages/modding`): Manifest-Validierung mit mod-lokalen Fehlern, fünfstufige Auflösungskette mit Herkunfts-Tags, explizite Load-Order, generationsbasierte Umschaltung

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
| `packages/app-shell` | Import-Zustandsmaschine, Fähigkeitsprüfung, assetfreier Diagnose-Export |
| `packages/modding` | Mod-Manifest-Validierung + fünfstufige Auflösungskette mit Herkunfts-Tags |
| `packages/interpreter` | Fixed-Tick-Interpreter: VM (Kontrollfluss/Variablen/Dialog-Stub), Scheduler, Serde, Replay |
| `packages/interpreter-debug` | Event-Timeline (JSON, asset-frei), Breakpoints + Einzelschritt |
| `packages/formats-model` | Modellkette: hrc/rsd/p/tex/a → Skeleton/Binding/Mesh/Textur/Clip (Index-Flattening, Degradierung) |
| `packages/render-actor` | Bindpose + Posenmathematik (Referenz), Animationsbindung, Three-Actor, Kapsel-Fallback |
| `tools/calibration` | Kalibrierentscheidungen (FOV-Basis, Depth, Letterbox) als versioniertes Artefakt |
| `tools/realdata-scan` | Diagnose-Scan gegen lokale Installation (`npx vitest run --config vitest.realdata.config.ts`) |
| `tools/fixture-gen` | Eigenständige Writer für Golden Fixtures: LGP, Field-Composer, Script-Assembler + Defekt-Mutationen |
| `apps/demo` | Diagnose- und Kalibrierseiten: Import, Kamera/Tile-Depth, Walkmesh, Actor, Field-Hintergrund |

## Kommandos

```bash
npm test        # Vitest (Golden Fixtures + alle Fehlerklassen)
npm run demo    # Diagnose-Demo auf http://localhost:5199
npx tsc --noEmit
```

Golden Fixtures sind ausschließlich selbst erzeugte Minimaldaten — es liegen
keine Originaldaten im Repository.
