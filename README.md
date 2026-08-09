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
- ⏳ S10 — Model-Loader-Sektion (Field-Sektion 3) + R4-Sichtvalidierung (nächster Schritt)

## Struktur

| Pfad | Inhalt |
|---|---|
| `packages/formats-lgp` | LGP-Scanner, Namensnormalisierung, Indexmodell, Fehlerklassen |
| `packages/formats-field` | LZS-Dekoder, Field-Container (9 Sektionen), NAM: Walkmesh, Kamera, Trigger, Script-Spans, Paletten, Hintergrund-Layer/-Tiles/-Texturseiten |
| `packages/io` | FSA-/Memory-Quellen, Fingerprinting, IndexService, IO-Worker + Nachrichtenvertrag |
| `packages/cache` | Cache-Stufen S0–S2: Index-Store, Memory-LRU, budgetierter IndexedDB-Asset-Store |
| `packages/pipeline` | Worker-Verträge, Client mit Generations-Abbruch (SAB-optional), Worker-Host, AssetPipeline |
| `packages/telemetry` | Zähler, Latenzen, Long-Task-/Lag-Probe (NFR-Instrumentierung) |
| `packages/convert` | Zentrale Koordinatenkonvertierung (ADR-009), Kamerarekonstruktion, Referenzprojektion, Depth-Mapping |
| `packages/render-field` | Three.js: PerspectiveCamera-Aufbau, Letterbox-Kompositor, Tile-Depth-Hintergrundmesh, Tile-Auflösung + Atlas-Packer (Three-frei) |
| `packages/walkmesh` | Bewegungs-Solver (Punkt-in-Dreieck, Kantenübertritt, Sliding), Gateway-Querung, Debug-Daten |
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
