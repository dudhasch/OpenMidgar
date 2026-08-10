# Machbarkeitsanalyse 07: Nachträgliche Integration mehrerer Mods aus 7th Heaven

**Thema:** Können bestehende 7th-Heaven-Mods (IRO-Pakete) in WebMidgar nutzbar gemacht werden?
**Projekt:** WebMidgar (OpenMidgar) — Clean-Room-Reimplementierung der FF7-PC-Laufzeitumgebung (1998), vollständig im Browser (TypeScript, Three.js), 100 % clientseitig, Originaldaten lokal per FSA, kein Original-Binary wird je ausgeführt
**Status:** Analyse / Empfehlung
**Datum:** 2026-08

---

## 1. Executive Summary

**Gesamtverdikt: Teilweise machbar — als Einbahn-Konverter (IRO → .wmmod), niemals als Laufzeit-Kompatibilitätsschicht.** Die in der Roadmap bereits vorgesehene Richtung („IRO-/7th-Heaven-Import-Konverter, nur Richtung WebMidgar, Post-MVP") ist die einzig tragfähige: 7th-Heaven-Mods setzen voraus, dass das Original-`ff7.exe` läuft (Speicher-Hooks, Byte-Patches, DLL-Injektion). WebMidgar führt per Definition kein Original-Binary aus — jede „Kompatibilität" kann also nur eine **statische Inhalts-Konvertierung** der im IRO verpackten Assets auf die deklarativen .wmmod-Capabilities sein.

**Verdikt je Mod-Klasse:**

| 7th-Heaven-Mod-Klasse | Verdikt |
|---|---|
| Texturpakete (Field/Battle/World/Spell/UI/Minigames, PNG/DDS) | **Direkt konvertierbar** (PNG sofort; DDS erst mit S25-KTX2-Pfad sinnvoll) — aber fast immer **Derivate von Originalassets** → Rechtsrisiko, nur lokaler Import |
| 3D-Modelle (hrc/rsd/p/tex/a aus char.lgp, battle.lgp u. a.) | **Konvertierbar mit Verlust** (Parser existieren; hrc/p→NAM-Konverter + Animations-Mapping nötig) |
| Field-Background-Upscalers (SYW, Satsuki o. ä.) | **Mit Verlust konvertierbar** (Ebenen-/Animationsstruktur geht in Flachbild-Paketen oft verloren; Guard-Hash-/Anker-Problematik) |
| Dialog-/Übersetzungs-Mods (flevel-Text-Chunks) | **Konvertierbar mit Verlust** (Extraktion + Mapping auf `dialogue-replace`-Records; Sprach-/Version-Anker nötig) |
| Musik/Sound (ogg/vgmstream) | **Derzeit nicht abbildbar** (keine Audio-Capability im Manifest v1/v2), technisch aber trivial, sobald S23-Audio-Pfad Mod-Haken hat |
| FMV-Ersatz (webm/mp4) | **Derzeit nicht abbildbar** (Capability fehlt), technisch einfach nachrüstbar |
| Field-Script-/Gameplay-Mods auf flevel-Ebene (New Threat u. ä.) | **Praktisch nicht konvertierbar** (Binär-Diff → deklarative Anker-Patches ist nicht automatisierbar; kernel.bin/scene.bin haben **kein** .wmmod-Gegenstück) |
| Hext-Patches (Speicher-/EXE-Bytes) | **Unmöglich** (Clean-Room: keine EXE, keine Adressen; ADR-007) |
| DLL-Plugins (`LoadLibrary`/`LoadAssembly`/`LoadPlugin`, Cosmo Memory u. a.) | **Unmöglich** (nativer Code, ADR-007) |
| FFNx-Shader (BGFX) | **Unmöglich direkt** (andere GPU-Pipeline; nur Neu-Authoring für Three.js) |

**Empfehlung in Kurzform:** Konverter als Post-MVP-Vorhaben nach S25 umsetzen; Stufenplan: (1) PNG-Texturpakete → `texture-override`, (2) Modelle → `model-override`, (3) Dialog-Mods → `dialogue-replace`, (4) Audio/FMV sobald Capabilities existieren. Zwingende Begleitmaßnahmen: **Provenienz-Audit** (keine Originalbytes in Paketen), **Mod-Doktor-Integration** für Konflikt-/Kompatibilitätsdiagnose, klare Policy: **nur lokaler, nutzerseitiger Import — kein Redistribution-Kanal** für konvertierte Community-Mods.

---

## 2. Ausgangslage

- WebMidgar besitzt ein **eigenes deklaratives Modsystem `.wmmod`**: Manifest v1 mit den Capabilities `texture-override`, `model-override`, `background-override`, `script-patch`, `dialogue-replace`, `field-add`; v2 ergänzt `entity-add`, `script-add`, `dialogue-add`, `model-add`, `variable-claim`. **ADR-007: Mods enthalten niemals Runtime-Code.** **ADR-014: Mod-Fields sind deklarative NAM-nahe Dokumente; es gibt keinen Binär-Field-/LGP-Writer.**
- Die Override-Kette (S19) ist fünfstufig mit Herkunfts-Tags, expliziter persistierter Load-Order und deterministischen Konfliktreports; `script-patch`/`dialogue-replace` werden in **S22** scharfgeschaltet (Anker + guardHash, Patch-Applikation an Field-Grenzen), `field-add` und der **KTX2/HD-Texturpfad** in **S25**. S23 behandelt Audio.
- Eigene Formate/NAM decken bereits ab: Parser für hrc/rsd/p/tex/a, eigene Save-Formate, kernel.bin-Parser.
- Die Projekt-Roadmap nennt bereits: **„IRO-/7th-Heaven-Import-Konverter (nur Richtung WebMidgar, Post-MVP)"** — diese Analyse konkretisiert diesen Eintrag.
- **Rechtsrahmen (verbindlich):** strikte Provenienz — keine Originalbytes in WebMidgar-Paketen; kein Original-Binary wird ausgeführt oder inspiziert (Laufzeit-Adressen existieren in WebMidgar schlicht nicht).
- Zielgröße der Fragestellung: **nachträgliche Integration *mehrerer* Mods gleichzeitig** — d. h. zusätzlich zur Einzelkonvertierung sind Load-Order-Übersetzung und Konfliktdiagnose zwischen konvertierten Mods zu bewerten.

---

## 3. Recherche-Befunde: 7th-Heaven/FFNx-Ökosystem und IRO-Format

### 3.1 7th Heaven — der Mod-Manager

- **Was es ist:** „The Ultimate Mod Manager for Final Fantasy VII PC" (Windows, .NET/WPF). Ursprung von Iros/ficedula (1.x, ~2013), 2.x-Rewrite (unab0mb/rodriada), heute gepflegt vom **Tsunamods-Team** (Repo `tsunamods-codes/7th-Heaven`, Fork der 2.x-Linie; aktuelle Releases im 4.5er-Zweig, Stand 2025). Lizenz: **Microsoft Public License (MS-PL)**. Quellen: [^1][^2]
- **Kernmechanik (wichtig für das Mapping):** 7th Heaven ersetzt **keine Dateien auf der Platte**. Ein in den Spielprozess injizierter **Wrapper hooked `CreateFileW`** und lenkt Dateizugriffe des Originals zur Laufzeit auf Mod-Inhalte um (Repo: `AppProxy`/`AppWrapper`, `Wrap.cs`). LGP-Archive werden transparent **pro Member-Datei** überschrieben (`battle.lgp\rvaa` usw.). Damit funktioniert das System nur, solange ein Original-Prozess läuft, dessen Dateizugriffe man umbiegen kann — **in WebMidgar existiert kein solcher Prozess**. Quellen: [^1][^3]
- **Profile & Load-Order:** Nutzer pflegen Mod-Listen mit Drag&Drop-Reihenfolge, speicherbar als Profile (u. a. `/PROFILE:<name>`-Startparameter); Mods können per `OrderConstraints` (`Before`/`After`) Sortierwünsche deklarieren, ein Auto-Sort berücksichtigt Kategorien. Die Reihenfolge entscheidet, **welcher Mod bei gleichem Zielpfad gewinnt** (letzte Überschreibung in der Abarbeitung). Quellen: [^2][^3]
- **Konditionale Aktivierung (`mod.xml`):** Neben Metadaten (`Author`, `Version`, `Description`, `Link`, `PreviewFile`) definiert das Manifest `ConfigOption`s (Typ **Bool** oder **List**, mit Default, ID, Vorschaubildern) und **Conditional Folders** (`<Conditional Folder="..." ActiveWhen="battlem = 1">` bzw. `<ModFolder .../>`). Zusätzlich gibt es **`RuntimeVar`s**, die Ordner **in Abhängigkeit von im Originalprozess gelesenen Werten** aktivieren — Variablentypen laut Quelltext: `Byte`, `Short`, `Int`, `FFString` (lesen **Speicheradressen** der laufenden EXE!), `Sys` (z. B. Time/FieldID/PartyLeader), `Counter`, `CounterAdv`, `CounterRnd`, `Random`, `RandomVarOnce`, `RandomVar`. Quellen: [^3][^4]
- **Code-Ausführung aus Mods:** `mod.xml` kennt die Tags **`LoadLibrary`** (native DLL), **`LoadAssembly`** (.NET-Assembly mit `_7thHeaven.Main.Init`-Einstiegspunkt) und **`LoadPlugin`** — Mods können also echten Code in den Spiel-/Wrapper-Prozess laden. Quelle: [^3]
- **Hext-Patches:** Seit 7H 1.23 kann der Wrapper **Hext-Patches** anwenden; in der aktuellen Codebasis werden beim Start alle `hext\…`-Dateien der aktiven Mods gelesen und per `HexPatch.Apply` **in den Speicher der laufenden Original-EXE** geschrieben. Quellen: [^2][^3]
- **Chunk-Mechanik:** Für `flevel.lgp` gibt es ein „Chunk Tool": Field-Dateien bestehen intern aus **nummerierten Sektionen** (der 7H-Quelltext `FieldFile.cs` zeigt `Unchunk`/`Chunk` inkl. LZS-Kompression; das Changelog nennt z. B. Chunk 1 = Dialoge, Chunk 7 = Encounters). Mods können einzelne Chunks statt ganzer Field-Dateien ausliefern. Quellen: [^2][^3]
- **Extra/Extra-Folders:** Standard-Überwachungsordner sind u. a. `direct`, `music`, `shaders`; der Treiber (FFNx) löst deren Inhalte auf (direct-Mode, externe Musik, Shader). Quelle: [^3]

### 3.2 IRO-Containerformat

- **Kernbefund: IRO ist kein ZIP**, sondern ein eigenes, schlankes Archivformat (die verbreitete Annahme „ZIP + mod.xml" ist falsch — Annahme im Auftrag korrigiert). Dokumentiert u. a. im Rust-Referenz-Tool `iroga` (von tangtang95, FFNx-Kernentwickler): Header `IROS` (Magic, 4 Byte), Version (aktuell `0x10002`), Flags (**0 = Full, 1 = Patch**), Headergröße, Dateianzahl; danach ein Index je Datei (UTF-16-Pfad, Kompressions-Flags **0 = keine, 1 = LZSS, 2 = LZMA**, Offset, Länge) und anschließend die rohen Dateidaten. Quelle: [^5]
- **Kompression & Patches:** Beim Packen wählbar: nie / immer / *By Extension* (PNG/JPG/MP3/OGG nicht komprimieren) / *By Content* (nur wenn > 10 % Ersparnis). Es existieren **`.irop`-Patchdateien** (Deltas zwischen IRO-Versionen), die der Katalog automatisch statt Voll-Downloads anwenden kann. Quelle: [^2]
- **Im Archiv** liegt typischerweise `mod.xml` im Wurzelverzeichnis plus Ordner, die entweder **LGP-Memberpfade** spiegeln (`battle.lgp\…`, `char.lgp\…`, `world_us.lgp\…` …) oder Sonderordner sind (`hext`, `direct`, `music`, `vgmstream`, `shaders`, `movies`, Varianten-Ordner für Conditionals, `preview`). Quellen: [^2][^3][^4]
- **Katalog-Format:** Der Mod-Katalog ist eine **XML-Datei** (Default: Qhimm-Katalog, gehostet auf GitHub im Repo `tsunamods-codes/7th-Heaven-Catalogs`, `catalogs/qhimm.xml`), abonniert über das URI-Schema `iros://Url/https$…`. Einträge: GUID-`ID`, `Author`, `Link`, `LatestVersion` (Download-Link `iros://…`, `Version`, `ReleaseDate`, `CompatibleGameVersions`, `PreviewImage`, `ReleaseNotes`, `DownloadSize`), `Name`, `Category`, `Description`, `Tags`. Es gibt **keine API** — nur XML-Dateien plus Direkt-Downloads (meist GitHub Releases, Mega, GDrive). Quellen: [^6][^7]
- **Kategorien im Qhimm-Katalog (Ist-Bestand, gezählt):** Gameplay (20), User Interface (23), Media (14), Spell Textures (7), Field Models (6), Animations (6), World Textures (5), Battle Models (5), Battle Textures (4), Field Textures (3), Minigames (3), Miscellaneous (4), **Shaders (2)**. Darunter bekannte Mods wie *New Threat 2.0* (Gameplay), *Echo-S* (Sprachausgabe), *Cosmo Memory* (FFNx-Plugin), *SYW Unified …* (Textur-Serien), *Cosmos FMV/Limit Break/Gaia*, *60/30 FPS Gameplay*. Quelle: [^6]

### 3.3 FFNx — der Treiber-Layer, über den die Mods wirken

- **Linie:** FFNx ist die Weiterentwicklung von **Aalis FF7_OpenGL-Treiber**; ersetzt die Grafik-/Audio-Schicht des Originals per DLL-Ersetzung (`ddraw.dll`-Hook) und wird seit 7th Heaven 2.3 fest gebündelt. Render-Backends: **DirectX 11 (Default), DirectX 12, Vulkan, OpenGL** über BGFX. Quelle: [^8]
- **Modder-relevante Fähigkeiten (README):** **DDS-Texturen bis BC7** (PNG als Fallback), konfigurierbare Pfade `mod_path` (externe Textur-Ersetzung) und `override_path` (Override-Layer über dem Datenverzeichnis), **Hext-Patching** (`hext_patching_path`), externe Musik (ersetzt die Original-MIDIs; **VGMStream** für Loop-fähige Formate, **MINIPSF**/AKAO-Emulation), FMV-Abspielung über **FFmpeg** (moderne Codecs: WEBM, H.265, Ogg), imgui-DevTools, Plugin-Mechanik (z. B. *Cosmo Memory*), 60-FPS-Arbeiten (tangtang95). Quellen: [^8][^9]
- **Hext:** Ursprünglich DLPBs Konzept (HextLaunch/Tools), von FFNx nativ implementiert: Textdateien, die **Bytes an absoluten Speicheradressen der laufenden (Sprach-)Version der EXE** ersetzen — sprachversionsabhängig (`hext/ff7/en\…` im Log). Quellen: [^8][^9]
- **Konsequenz für WebMidgar:** Sämtliche 7th-Heaven-/FFNx-Mod-Klassen, die auf *Prozesspräsenz* beruhen (Hext, DLL-Plugins, RuntimeVar-Speicherlesezugriffe, BGFX-Shader, EXE-gekoppelte FPS-Mods), haben **kein** Abbild in einer Clean-Room-Engine, die diese Adressen, diese EXE und diese Render-Pipeline nicht besitzt.

### 3.4 Mod-Klassen im Ökosystem (abgeleitet aus Katalog + Technik)

1. **Textur-Ersetzung** — PNG/DDS-Pakete (Field-/Battle-/World-/Spell-/UI-/Minigame-Texturen), über `direct`-Ordner bzw. FFNx-`mod_path`. Dominante Klasse (SYW, Satsuki u. a.).
2. **Modell-Ersetzung** — hrc/rsd/p/tex (+ `.a`-Animationen) als LGP-Member-Overrides (Ninostyle, Kaldarasha, cmh175 u. a.).
3. **Field-Background-Ersetzung** — hochskalierte Hintergrundbilder (häufig als Flachbilder; die Original-Ebenen-/Tile-Struktur wird dabei von den Paketen oft nicht mitgeliefert — *Annahme auf Basis bekannter Pack-Strukturen, stichprobenartig zu verifizieren*).
4. **Dialog-/Übersetzungs-Mods** — flevel-Text-Chunks (z. B. italienische ReTranslation).
5. **Gameplay-Mods** — `scene.bin`/`kernel.bin`-Ersatz + flevel-Änderungen + oft Hext (New Threat, Hardcore Mod, Reasonable Difficulty u. a.).
6. **Hext-Patches** — Speicherbytes (60-FPS-Fixes, Save-everywhere, QoL).
7. **DLL-Plugins** — native/.NET/FFNx-Plugins (Cosmo Memory, FFNx FF7Music).
8. **Musik/Sound** — ogg/mp3 über `music`/`vgmstream` (Arranged Soundtrack, Symphonic Remasters).
9. **FMV** — Video-Dateien (Cosmos FMV 15/30 fps, SYW FMV).
10. **Shader** — BGFX-Shader für FFNx (Cosmos Limit Break, Cosmos Gaia).

---

## 4. Mapping-Tabelle: 7H-Mod-Klasse → .wmmod-Capability → Machbarkeit

| # | 7H-Mod-Klasse | Technischer Inhalt im IRO | Nächste .wmmod-Capability | Machbarkeit | Zentrale Hürden |
|---|---|---|---|---|---|
| 1 | Texturpakete (PNG) | `direct\…\*.png`, FFNx-Texturpfade | `texture-override` | **Direkt konvertierbar** | Pfad-Mapping FFNx-Namen → WebMidgar-Canonical-IDs (Mapping-Tabelle zu bauen); Derivate-Provenienz |
| 1b | Texturpakete (DDS/BC7) | `*.dds` | `texture-override` (+ S25-KTX2-Pfad) | **Konvertierbar mit Verlust** | Transkodierung DDS→PNG (verlustfrei möglich, CPU-teuer) oder DDS→KTX2 (BC7→UASTC/ETC1S = Verlust); Browser decodiert DDS nicht nativ |
| 2 | Modelle | `char.lgp\…` hrc/rsd/p/tex, `battle.lgp\…`, `.a` | `model-override` | **Konvertierbar mit Verlust** | hrc/p→NAM-Konverter neu; rsd-Textur-Referenzen auflösen; `.a`→NAM-`AnimationClipSource`; Bone-/Budget-Grenzen kalibrieren |
| 3 | Field-Background-Upscaler | Flach-PNGs je Field | `background-override` | **Mit Verlust konvertierbar** | Ebenen/Parallaxe/Palettenanimationen gehen in Flachbildern verloren (FFNx selbst dokumentiert das Animationsproblem); WebMidgar erwartet NAM-nahe Layer |
| 4 | Dialog-/Text-Mods | flevel-Chunk 1 (Texte), ggf. ToughScript-Export | `dialogue-replace` | **Konvertierbar mit Verlust** | Chunk-Extraktion + Feld-/Fenster-Mapping auf `dialogues[]`-Records; Fenstermetrik-Validierung (S22); Sprachvarianten-Anker |
| 5 | Musik/Sound | `music\…`, `vgmstream\*.ogg` | *keine* (Manifest v1/v2) | **Derzeit nicht abbildbar** (technisch trivial) | Audio-Capability fehlt; ogg spielt der Browser nativ — nach S23 als kleine Erweiterung kandidieren |
| 6 | FMV | `movies\*.webm/mp4/avi` | *keine* (Manifest v1/v2) | **Derzeit nicht abbildbar** | FMV-Override-Capability fehlt; avi müsste transkodiert werden, webm/mp4 direkt abspielbar |
| 7 | Field-Script-Änderungen | ganze flevel-Member oder Chunks (Binär) | `script-patch` | **Praktisch nicht automatisierbar** | WebMidgar patcht **deklarativ** (Anker + Mnemonics + guardHash), nicht per Binär-Diff; Binärdiff→Ankerpatch-Übersetzung ist ein Forschungsproblem, kein Konverter-Feature |
| 8 | kernel.bin/scene.bin (Gameplay) | `kernel.bin`, `scene.bin` | *keine* | **Nicht abbildbar** | Keine kernel-/scene-Override-Capability; Balancing-Daten sind Interpreter-Semantik — bewusste Capability-Lücke |
| 9 | Hext-Patches | `hext\*.txt` (Adresse→Bytes) | — | **Unmöglich** | Keine EXE, keine Adressen (Clean-Room, ADR-007); semantisch nur als native Engine-Features nachbaubar (z. B. „Save überall" als Feature-Request) |
| 10 | DLL-Plugins | `LoadLibrary/LoadAssembly/LoadPlugin` | — | **Unmöglich** | Nativer Code im Browser nicht ausführbar; ADR-007 verbietet Code in Mods ohnehin |
| 11 | FFNx-Shader | `shaders\…` (BGFX) | — | **Unmöglich direkt** | BGFX≠Three.js/WebGL; nur Neu-Authoring als evtl. künftige `shader`-Capability |
| — | ConfigOption/Conditional/RuntimeVar | `mod.xml`-Logik | (kein Options-System in .wmmod bekannt — *Annahme*) | **Zur Konvertierzeit auflösen** | Nutzer wählt Variante beim Import → Konverter baut genau diese Variante; `RuntimeVar` mit Speicheradressen (`Byte:0x…`) ist nicht portierbar |
| — | IROP-Patches, Profile, Load-Order | Manager-Metadaten | Load-Order-Import | **Teilweise** | Reihenfolge als Liste importierbar; `OrderConstraints` (Before/After) übersetzbar; Conditional-Semantik nur statisch |

**Formatkonvertierungen im Einzelnen:** PNG → unverändert (oder → KTX2 im S25-Pfad); DDS → PNG/KTX2 (Transkoder nötig); tex → PNG (Parser existiert); hrc+rsd+p (+a) → NAM-`Skeleton`/`MeshSource`/`TextureSource`/`AnimationClipSource` (Konverter neu, Parser existieren); flevel-Text-Chunks → `dialogues[]`-Records (Extraktor + Metrik-Validator); ogg → unverändert; avi → webm (Transkode, oder beim Nutzer ablehnen); hext/DLL/Shader → **keine Konvertierung, kategorische Ablehnung mit Diagnose**.

---

## 5. Technischer Lösungsansatz: Konverter-Architektur

**Einordnung:** Der Ansatz operationalisiert den Roadmap-Eintrag „IRO-/7th-Heaven-Import-Konverter (nur Richtung WebMidgar, Post-MVP)". Er kommt **nach S25** (KTX2/HD-Pfad, field-add) und nutzt S22 (script-patch/dialogue-replace-Validierung, Mod-Doktor) sowie S19 (Override-Kette, Import-Validator, E-MOD-*-Fehlerklassen).

### 5.1 Bausteine

1. **IRO-Reader (`packages/iro-import`, neu):** Header-/Index-Parsing nach `iroga`-Spezifikation (Magic `IROS`, Version, Full/Patch-Flag, UTF-16-Pfade); Dekompression **LZSS** (WebMidgar besitzt bereits LZS/LZSS-Codec-Code aus den Datenformaten — *Annahme: wiederverwendbar*) und **LZMA** (reine JS/TS-Implementierung, z. B. lzma-Decoder; läuft im Web Worker). IROP-Patchdateien: in Stufe 1 **nicht** unterstützen (Voll-IRO verlangen, Diagnose ausgeben). Auch Ordner-Import (entpacktes IRO) unterstützen — 7H erlaubt beides.
2. **mod.xml-Parser:** Metadaten (Author/Version/Description/Link) → .wmmod-Manifest-Metadaten inkl. Herkunfts-Tag (`provenance: { source: "7th-heaven-iro", originalModId, originalVersion }`); `ConfigOption`s dem Nutzer als **Auswahl-UI zur Importzeit** präsentieren; Conditional/ModFolder statisch zur gewählten Variante auflösen; `RuntimeVar`-Ordner ohne portierbare Bedingung → Diagnose + Auslassung der bedingten Inhalte (niemals still).
3. **Klassifikator:** Ordner-/Dateimuster → Mod-Klasse gemäß Kapitel 4 (z. B. `direct\**/*.png` → Klasse 1; `*.lgp\…hrc/p` → Klasse 2; `hext\**` → Klasse 9). Ergebnis: **Klassenreport** mit Ampel je erkanntem Inhalt (konvertierbar / mit Verlust / nicht unterstützt).
4. **Provenienz-Audit (verbindlich):** Jede zu übernehmende Datei wird gegen den **Hash-Index der lokalen Originalinstallation** geprüft (Originaldaten sind per FSA ohnehin präsent): (a) **byte-identisch mit Original** → ablehnen (verletzt Provenienz-Regel; z. B. mitgelieferte Original-tex/kernel-Dateien); (b) **heuristisch Derivat** (gleiche Maße/Palettensignatur wie Original-Textur, Upscale-Verhältnis 2×/4×/8×) → **Warnstufe „Derivat-Verdacht"**, nur lokaler Import, niemals Upload/Teilen-Funktion; (c) **eigenständig** → freigeben. *Annahme: Die Derivat-Heuristik ist eine Policy-Entscheidung des Projekts, kein rechtsverbindlicher Nachweis — sie dokumentiert Sorgfalt, entscheidet aber nicht die Rechtsfrage.*
5. **Emitter:** Erzeugt ein `.wmmod`-Verzeichnis (Manifest + Assets) aus den konvertierten Records; nutzt denselben Import-Validator wie jeder native Mod (gleiche E-MOD-*-Fehlerklassen, gleiche Override-Kette). **Kein Binär-Field-Writer** (ADR-014): flevel-Inhalte werden nur als Text-Extrakt (Dialoge) übernommen, nie als Binär-Chunk.
6. **Mod-Doktor-Integration:** Der Import landet als eigener „Konvertierungs-Report" in der S22-Mod-Doktor-Ansicht: je übernommenem Asset Herkunfts-Tag (`iro:<modname>`), je ausgelassenem Inhalt benannter Grund (Klasse 7–11), Konflikte mit anderen aktiven (konvertierten) Mods nach den S19-Load-Order-Regeln.
7. **Optional: Katalog-Leser (sehr spät):** qhimm.xml parsen (Kategorien, Versionen, `DownloadSize`, `iros://`-Links) als reine **Informationsansicht**; Downloads nur nutzerinitiiert und nur lokal. *Empfehlung: kein Auto-Download, keine Spiegelung.*

### 5.2 Mehrere Mods gleichzeitig (Kern der Fragestellung)

- **Load-Order-Übersetzung:** 7H-Reihenfolge (Drag&Drop + OrderConstraints) → WebMidgar-Load-Order als Liste übernehmen; `OrderConstraints` Before/After als Sortierhinweise auswerten. Semantik-Differenz dokumentieren: 7H wendet **Conditional Folders zur Laufzeit** an (Inhalte können mitten im Spiel wechseln), WebMidgar löst **generationsbasiert an Field-Grenzen** um (S19) — konvertierte Mods verlieren die Laufzeit-Konditionalität (siehe 5.1.2).
- **Konfliktdiagnose:** S19 liefert deterministische Konfliktreports bei gleichem Ziel-Asset. Der Konverter sollte zusätzlich **Cross-IRO-Überlappungen bereits zur Importzeit** melden (zwei IROs liefern denselben Zielpfad → Konflikt-Vorschau), statt erst zur Laufzeit.
- **Typische Mehrfach-Mod-Szenarien der Community** (z. B. „Texturpaket + Modelle + Gameplay-Mod") zerfallen nach dem Mapping in: voll konvertierbare Teile (Texturen/Modelle) und kategorisch verlorene Teile (Hext-Abhängigkeiten des Gameplay-Mods). Der Klassenreport muss diese Teilhabe explizit machen, sonst entsteht der falsche Eindruck „der Mod funktioniert".

---

## 6. Aufwandsschätzung

Gröbenordnungen, 1 erfahrene Person, TypeScript/Browser; Vorbedingung: S19/S22/S25 abgeschlossen.

| Arbeitspaket | Klassen | Aufwand |
|---|---|---|
| IRO-Reader + LZMA/LZSS + mod.xml-Parser + Klassifikator + Klassenreport-UI | alle | **2–3 Wochen** |
| Provenienz-Audit (Hash-Abgleich, Derivat-Heuristik, Policy-UI) | alle | **1–2 Wochen** |
| PNG-Texturpfad-Mapping (FFNx-Namen → Canonical-IDs, Matrix über Kategorien Field/Battle/World/Spell/UI/Minigames) | 1 | **2–4 Wochen** (Datenarbeit an ~6 Kategorien; größtes Fehlerfeld: nicht eindeutig mappbare Pfade → Diagnose) |
| DDS→KTX2/PNG-Transkodierung im Worker | 1b | **1 Woche** (nach S25) |
| hrc/rsd/p/tex→NAM-Konverter inkl. `.a`-Animationen und Budget-Validierung | 2 | **3–5 Wochen** (Parser existieren; Animation-Mapping + rsd-Auflösung sind die Unsicherheit) |
| flevel-Text-Extraktion → `dialogues[]`-Records + Fenstermetrik-Check | 4 | **1–2 Wochen** |
| Audio-/FMV-Capability-Erweiterung des Manifests + Konverterzweig | 5, 6 | **1–2 Wochen** (nur sinnvoll nach S23/Manifest-Erweiterung) |
| Load-Order-/OrderConstraints-Import + Cross-IRO-Konfliktvorschau | Mehrfach-Mod | **1 Woche** |
| **Summe realistischer Kern (Klassen 1, 2, 4 + Infrastruktur)** | | **~10–16 Wochen** |
| Nicht eingeplant (unmöglich/Forschung): Hext-Semantik-Portierung, flevel-Binärdiff→Ankerpatch, Shader | 7–11 | n/v |

---

## 7. Risiken & offene Fragen

1. **Rechtliches — Derivate in Community-Mods (höchstes Risiko):** Die ökonomisch attraktivsten 7H-Mods (HD-Texturpakete, Upscaler, „Unified"-Serien) sind mit hoher Wahrscheinlichkeit **Bearbeitungen von Square-Enix-Originalassets** (AI-Upscales der Originaltexturen) und außerdem oft lizenzseitig unklar deklariert. 7th Heaven umgeht das Vertriebsproblem, indem **die Community selbst hostet** und der Nutzer ein Originalspiel besitzen muss. WebMidgar darf konvertierte Pakete **nicht selbst vertreiben**; nur der **lokale, nutzerseitige Import** ist vertretbar (analog: der Nutzer konvertiert sein eigenes Paket). *Offene Frage: Policy-Text „nur lokaler Import, kein Teilen" + ob die Derivat-Heuristik aus 5.1.4 überhaupt standardmäßig blocken oder nur warnen soll.*
2. **Provenienz-Audit-Falschpositive/-negative:** Byte-Identität ist eindeutig, Derivat-Erkennung heuristisch. Ein zu strenger Filter bricht legitime Eigenkreationen, ein zu laxer untergräbt ADR-007/Provenienz-Anspruch.
3. **Qualitäts-/Konfliktdiagnose bei Mehrfach-Mods:** 7H-Nutzer sind „es crasht halt, dann sortiere ich um" gewohnt; WebMidgar verspricht deterministische Diagnose. Der Konverter muss die **Teilverluste je Mod sichtbar** machen (Klassenreport), sonst entstehen Support-Last und falsche Erwartungen („New Threat importiert, aber Gegner sind Vanilla" — weil kernel.bin kein Gegenstück hat).
4. **Load-Order-Semantik-Unterschiede:** 7H = Laufzeit-Überschreibung inkl. konditionaler Ordner und prozessgelesener RuntimeVars; WebMidgar = deklarativ, generationsbasiert, an Field-Grenzen. Zufalls-/variablenbasierte Mod-Varianten (RandomVar/Counter) sind **nicht** abbildbar; ConfigOption-Varianten werden zur Importzeit eingefroren — Nutzer müssen ggf. mehrere Varianten desselben Mods separat importieren.
5. **Mapping-Vollständigkeit der Texturpfade:** FFNx-`mod_path`-Namenskonventionen und WebMidgar-Canonical-IDs sind nicht 1:1; ein Teil der Dateien wird nicht mappbar sein (Diagnose statt Raten). Umfang ist nur empirisch an echten Paketen bestimmbar (Probe-Pakete SYW/Satsuki empfohlen).
6. **Sprach-/Versionsanker:** 7H-Mods zielen fast ausschließlich auf die **englische 1.02**-Datenlage (7H konvertiert Steam→1998-EN); Dialog-/flevel-bezogene Mods kollidieren mit anderen Sprachvarianten der Nutzer-Installation. Konverter muss Basissprache erkennen und bei Mismatch ablehnen/warnen.
7. **Lebendes Ökosystem = Wartungslast:** IRO-Versionierung (`0x10002` heute), Katalog-Umzüge, neue Sonderordner. Der Konverter braucht eine Versions-Support-Matrix und fail-closed-Verhalten bei unbekannten Flags.
8. **Offene Fragen:** (a) Soll der Katalog-Leser (5.1.7) überhaupt gebaut werden (Rechts-/Erwartungsmanagement)? (b) Braucht .wmmod ein Options-/Varianten-System (v3?), um ConfigOptions nicht einfrieren zu müssen? (c) Soll es je eine `kernel-override`-/Daten-Override-Capability geben (Voraussetzung für Gameplay-Mod-Konvertierung — derzeit bewusste Lücke)? (d) Haftungs-/Policy-Review der Derivat-Heuristik durch Projektverantwortliche.

---

## 8. Abhängigkeiten

| Abhängigkeit | Inhalt | Bedeutung für diese Analyse |
|---|---|---|
| **S19** (Modding-MVP) | Manifest, Override-Kette, texture-/background-override, ModStore, Load-Order | Träger der Klassen 1/3; Konverter emittiert in dieses System |
| **S22** (Modding II) | `script-patch` + `dialogue-replace` + **Mod-Doktor** | Träger der Klasse 4; Ziel-UI für Klassenreport/Konfliktdiagnose; guardHash-Diagnosen |
| **S25** (Modding II+) | `field-add`-Runtime + **KTX2/HD-Texturpfad** | Sinnvoller Zielpfad für DDS/HD-Texturpakete (Klasse 1b); Seitenverhältnis-Handling |
| **S23** (Audio) | Audio-Pfad der Engine | Voraussetzung für eine künftige Musik-Capability (Klasse 5) |
| Roadmap-Eintrag (S26-Kapitel) | „IRO-/7th-Heaven-Import-Konverter (nur Richtung WebMidgar, Post-MVP)" | Diese Analyse konkretisiert genau diesen Eintrag; frühester sinnvoller Start: nach S25 |
| Studio-Strang (MS6, glTF→NAM) | glTF-Subset-Import, NAM-Modellpipeline | Synergie: hrc/p→NAM-Konverter kann Validierungs-/Budget-Disziplin des Studio-Konverters teilen |

---

## 9. Empfehlung / Stufenplan

**Empfehlung: Umsetzen — aber als disziplinierter Einbahn-Konverter mit harten Grenzen, Post-MVP (nach S25).** Der Wert liegt in der Erschließung des größten FF7-Mod-Ökosystems für WebMidgar-Nutzer, ohne die Clean-Room- und Provenienz-Prinzipien aufzuweichen. Was nicht deklarativ abbildbar ist (Hext, DLL, Shader, kernel/scene), wird **kategorisch abgelehnt und dokumentiert** — nicht „irgendwie" emuliert.

1. **Stufe 1 — Infrastruktur + PNG-Texturpakete (Klasse 1):** IRO-Reader, mod.xml, Klassifikator, Provenienz-Audit, Texturpfad-Mapping, Klassenreport im Mod-Doktor. Erster sichtbarer Nutzen bei geringstem technischem Risiko. *Zuerst.*
2. **Stufe 2 — Modelle (Klasse 2):** hrc/rsd/p/tex(+a)→NAM; Budget-Validierung an Studio-Disziplin angelehnt.
3. **Stufe 3 — Dialog-Mods (Klasse 4) + Field-Backgrounds (Klasse 3, mit dokumentiertem Ebenen-Verlust):** nutzt S22-Metrik-Validierung.
4. **Stufe 4 — Audio/FMV (Klassen 5/6), nur falls Manifest-Capabilities geschaffen werden:** kleine Erweiterung, großer Nutzen (Musikpakete sind populär und rechtlich am ehesten eigenständig).
5. **Explizit nie:** Hext-Patches, DLL-Plugins, FFNx-Shader, automatisierte flevel/kernel/scene-Gameplay-Konvertierung. Für deren *Semantik* (z. B. „Save überall", QoL-Patches) sind separate native Feature-Requests der richtige Weg — nicht der Konverter.
6. **Begleitend:** Policy-Dokument „nur lokaler Import", Probe-Konvertierung von 3–5 Referenzpaketen (SYW-Texturserie, ein Ninostyle-Modellpaket, eine Übersetzung) als Akzeptanznachweis, Versions-Support-Matrix für IRO/Katalog.

---

## 10. Quellen

[^1]: tsunamods-codes/7th-Heaven — GitHub-Repo (Mod-Manager, MS-PL-Lizenz, Build/Architektur): https://github.com/tsunamods-codes/7th-Heaven
[^2]: Qhimm-Forum — „[FF7][WIP] Barrett's Hideout – 7th Heaven Mod Creation Tutorial" / Iros-Changelogs v1.0x–v1.45 (IRO-Kompression By Extension/By Content, `.irop`-Patches, Chunk-Tool flevel.lgp, Hext-Support ab 1.23, Profile/`/PROFILE:`): https://forums.qhimm.com/index.php?topic=15985.0
[^3]: 7th-Heaven-Quelltext (eingesehen, `master`): `AppWrapper/Wrap.cs` (CreateFileW-Remapping, Hext-Anwendung, LoadLibrary/LoadAssembly/LoadPlugin), `AppWrapper/Profile.cs` (mod.xml-Tags, OrderConstraints, Conditional/RuntimeVar), `AppWrapper/RuntimeVar.cs` (VarType-Enum: Byte/Short/Int/FFString/Sys/Counter/CounterAdv/CounterRnd/Random/RandomVarOnce/RandomVar), `AppWrapper/FieldFile.cs` (Chunk/Unchunk + LZS), `AppProxy/Main.cs` (CreateFileW-Hook): https://github.com/tsunamods-codes/7th-Heaven
[^4]: Qhimm-Forum — „[PC] Mod manager – 7thHeaven (v1.54)" (Iros: mod.xml-Beispiel mit ConfigOption Bool/List, Conditional Folder + ActiveWhen, ModFolder, RuntimeVar, PreviewFile): https://forums.qhimm.com/index.php?topic=14490.50
[^5]: tangtang95/iroga — IRO-Formatspezifikation (IROS-Magic, Version 0x10002, Full/Patch-Flags, UTF-16-Pfade, Kompression 0/1/2 = keine/LZSS/LZMA, Index-/Datensektion): https://github.com/tangtang95/iroga
[^6]: tsunamods-codes/7th-Heaven-Catalogs — `catalogs/qhimm.xml` (Katalog-Schema: GUID-ID, LatestVersion, iros://-Links, DownloadSize, CompatibleGameVersions, Tags; Kategorien-Bestand; Einträge wie 60/30 FPS Gameplay, New Threat, Echo-S, Cosmo Memory, SYW-Serien): https://github.com/tsunamods-codes/7th-Heaven-Catalogs/blob/master/catalogs/qhimm.xml
[^7]: Qhimm-Forum — Beispiel Katalog-Subscription per `iros://Url/https$…` (Caledor 7thCatalog): https://forums.qhimm.com/index.php?topic=18903.0
[^8]: julianxhokaxhiu/FFNx — GitHub-README (Aali-Linie, DX11/12/Vulkan/OpenGL via BGFX; DDS bis BC7 + PNG-Fallback; mod_path/override_path; hext_patching_path; externe Musik, VGMStream, MINIPSF; FFmpeg-FMV; seit 7th Heaven 2.3 gebündelt): https://github.com/julianxhokaxhiu/FFNx
[^9]: Qhimm-Forum — „[FF7PC-98/Steam] FFNx – Next generation modding platform for FF7/FF8" (Hext-Log `hext/ff7/en\…`, DDS-Performance, 4-GB-Patch/LARGEADDRESSAWARE): https://forums.qhimm.com/index.php?topic=19970.0
[^10]: Tsunamods-Forum — „7th Heaven (v2.2.3.522 Release)"-Changelog 2.0 (FFNx-Bündelung, Profile, Auto-Sort, iros://-Direktdownloads, IROP-Import): https://forum.tsunamods.com/viewtopic.php?t=37
[^11]: OatBran/7HSteamGuide — PNG→DDS-Konvertierungspraxis für Texturpakete (Beleg für die beiden realen Textur-Trägerformate PNG/DDS im Ökosystem): https://github.com/OatBran/7HSteamGuide
[^12]: WebMidgar-Projektdocs (intern): `docs/ROADMAP-S13-S19.md` (S19 Modding-MVP), `docs/ROADMAP-S20-S26.md` (S22/S25, Roadmap-Eintrag „IRO-/7th-Heaven-Import-Konverter (nur Richtung WebMidgar, Post-MVP)"), `docs/MODDING-SUITE-MASTERPLAN.md` (ADR-007, ADR-014, Manifest v1/v2, NAM-nahe Mod-Fields, glTF→NAM).

*Annahmen sind im Text ausdrücklich als solche markiert. Formatangaben zum IRO-Container beruhen auf der iroga-Dokumentation und dem 7th-Heaven-Quelltext; künftige IRO-Versionen können Felder ergänzen (fail-closed-Verhalten des Konverters vorsehen).*