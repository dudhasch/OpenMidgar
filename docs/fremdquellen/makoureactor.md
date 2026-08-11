# Makou Reactor — Reverse-Engineering-Notizen (Recherche für WebMidgar)

> Erstellt: 2026-08-10 · Quelle: `https://github.com/myst6re/makoureactor` (shallow clone, `main`)
> Lokaler Klon: `…\scratchpad\repos\makoureactor`

---

## 0. LIZENZ UND CLEAN-ROOM-WARNUNG (zuerst lesen)

| Punkt | Wert |
|---|---|
| Lizenz | **GNU General Public License Version 3** (`COPYING.TXT:1`) |
| Copyright | Arzel Jérôme (myst6re) 2009–2022, Datei-Header in jeder `src/**/*.cpp` |
| Copyleft | **Stark viral.** Jede Übernahme von Quelltext würde WebMidgar unter GPLv3 zwingen. |
| Externe Abhängigkeit | `ff7tk` ≥ 1.2.0 (`CMakeLists.txt:79`) — enthält LZS, LGP, FF7String, WindowBinFile, IsoArchive, GZIP. **Diese Klassen liegen NICHT in diesem Repo.** |

**Regeln, die in diesem Dokument eingehalten wurden:**

1. **Kein Quelltext kopiert.** Alle Aussagen sind Beschreibungen von Datenformaten und Algorithmen in Prosa/Tabellenform.
2. Jede Aussage ist mit `pfad/datei.cpp:ZEILE` belegt, damit ein Entwickler sie **unabhängig neu herleiten** kann (Blackbox: Datei öffnen, Bytes zählen).
3. Datenformat-Fakten (Offsets, Feldgrößen, Opcode-Nummern, Enum-Werte) sind **Schnittstellen-Tatsachen über die Spieldaten**, nicht das kreative Werk des Makou-Reactor-Autors. Sie sind grundsätzlich unkritisch — kritisch wäre die *Formulierung* des Codes.

### ⚠️ Als riskant markiert (NICHT wörtlich übernehmen)

| Artefakt | Ort | Warum riskant / Alternative |
|---|---|---|
| `FF7Font::charWidth[7][256]` — Zeichenbreiten-Tabelle | `src/core/FF7Font.cpp:583–…` | Große Literal-Tabelle. **Alternative:** aus `window.bin` des Spiels zur Laufzeit lesen (Makou tut das selbst, wenn `window.bin` verfügbar ist, `src/core/FF7Font.cpp:549–561`). |
| `Data::_mapList[788]` — Feldnamen-Liste (PSX) | `src/Data.cpp` (Ende) | Große Literal-Tabelle. **Alternative:** aus `maplist` in `flevel.lgp` lesen (`src/core/field/MapList.cpp`). |
| `Data::movieList[106]`, `musicList[100]`, `musicList2[100]` | `src/Data.cpp:607`, `:771`, `:790` | Literal-Tabellen. Movie-/Musiknamen sind aus dem Spielverzeichnis ableitbar. |
| Der komplette Opcode-Namens-/Größen-Table in `Opcode.cpp` | `src/core/field/Opcode.cpp` | Nur **Werte** (Nummer, Länge, Parameter) übernehmen — die Namensgebung/Struktur des C++-Codes nicht. Namen wie `MPNAM`, `BGON` stammen ohnehin aus der Community (Qhimm) und sind älter als Makou Reactor. |
| Übersetzungs-Strings (`translations/*.ts`) | `translations/` | Urheberrechtlich geschützte Texte. Nicht anfassen. |
| Icons/Bilder (`src/qt/images/*`) | — | Nicht verwenden. |

---

## 1. Repository-Überblick

Qt6/C++-Desktop-Editor für FF7-Field-Archive. 419 getrackte Dateien; ~65 000 Zeilen in `src/`.

| Verzeichnis | Inhalt |
|---|---|
| `src/core/field/` | **Kernstück.** Alle Datei-/Sektionsformate: Field-Container, Section 1 (Skripte+Texte), Walkmesh, Kamera, INF, Encounter, Model-Loader, Background, Tiles, Paletten, PSX-Varianten (BSX/BCX/MIM), Opcode-Tabelle |
| `src/core/` | `FF7Font` (Textmetrik), `Var` (Savemap-Variablennamen), `SystemColor`, `Config`, `Clipboard`, `CsvFile` |
| `src/3d/` | OpenGL-Renderer, Walkmesh-Widget, Field-Model-Renderer |
| `src/widgets/` | UI — enthält viel **semantisches** Wissen (Wertebereiche, Enum-Beschriftungen, Kamera-Projektion in `WalkmeshManager.cpp`) |
| `src/qt/vars.cfg` | 43 bekannte Savemap-Variablen (Bank/Adresse → Name) |
| `misc/diagram.uxf` | UMLet-Klassendiagramm der Architektur (nur Architektur, keine Formatinfos) |
| `translations/` | Qt-Übersetzungen (fr, de, es, ja, …) |

**Keine `docs/`-Verzeichnis, kein Format-Spec-Dokument.** Das gesamte Formatwissen steckt in Parser-Code und Kommentaren.

---

## 2. Field-Container (flevel.lgp / PSX .DAT)

### 2.1 Äußere Hülle

Die Field-Datei in `flevel.lgp` ist als Ganzes LZS-komprimiert:

| Offset | Größe | Bedeutung |
|---|---|---|
| 0x00 | u32 LE | Größe der **komprimierten** Nutzdaten (ohne diese 4 Byte) |
| 0x04 | … | LZS-Datenstrom |

Beleg: `src/core/field/Field.cpp:70–85`. Heuristik für „unkomprimiert“: wenn `dateigröße != lzsSize + 4` **und** `lzsSize == 0x90000`, wird die Datei als roh behandelt (`Field.cpp:81`, identisch in `Field.cpp:160`). `0x90000` = 589 824 — das ist das ASCII-Muster, das ein unkomprimierter Header an dieser Stelle erzeugt; ein sehr nützlicher Robustheits-Trick.

Makou dekomprimiert **partiell**: `LZS::decompress(daten, len, headerSize())` liefert nur so viele Bytes, wie für den Header nötig sind (`Field.cpp:84`), bzw. bis `sectionPosition(idPart+1)` beim Lesen einer Sektion (`Field.cpp:163`). Für einen Streaming-Decoder im Browser ist das ein direkt übertragbares Muster.

> **LZS-Algorithmus selbst liegt in `ff7tk`, nicht in diesem Repo.** Hier nur die Aufrufkonvention: `LZS::decompress(ptr, size, maxOut)`, `LZS::decompressAll(...)`, `LZS::decompressAllWithHeader(...)` (letzteres überspringt den 4-Byte-Größenkopf, `FieldPC.cpp:152`), `LZS::compress(...)`.

### 2.2 PC-Header (42 Byte)

`FieldPC::headerSize() = 42` (`src/core/field/FieldPC.h:41`).

| Offset | Größe | Bedeutung | Beleg |
|---|---|---|---|
| 0x00 | 2 | Padding, immer `00 00` | `FieldPC.cpp:124` |
| 0x02 | u32 LE | Sektionsanzahl, immer **9** | `FieldPC.cpp:125`, `FieldPC.h:52` |
| 0x06 | 9 × u32 LE | Sektions-Offsets, absolut ab Dateianfang | `FieldPC.cpp:48` |

Die **effektive** Sektionsposition ist `offset + 4` — die 4 Byte an `offset` sind die u32-Sektionslänge (`FieldPC::sectionPosition`, `FieldPC.cpp:70`; `paddingBetweenSections() = 4`, `FieldPC.h:53`; `hasSectionHeader() = true`, `FieldPC.h:57`).

Sektionsgröße wird **nicht** aus dem Längenpräfix gelesen, sondern aus der Differenz zur nächsten Sektionsposition (`Field.cpp:121–125`). Die letzte Sektion (Background) endet vor dem Footer.

**Footer:** die ASCII-Zeichenkette `FINAL FANTASY7` (14 Byte, ohne Nullterminierung) am Dateiende (`FieldPC.cpp:131`). Beim Lesen der letzten Sektion wird der Footer abgeschnitten (`Field.cpp:167–172`).

Keine Ausrichtung/Alignment auf PC (`FieldPC.h:54`).

### 2.3 Sektionsindex → Inhalt (PC) — **verbindliche Zuordnung**

Aus `FieldPC::sectionId` (`FieldPC.cpp:51–66`) und `orderOfSections` (`FieldPC.cpp:136`):

| Index (0-basiert) | Nr. „menschlich" | Inhalt | Parser-Klasse |
|---|---|---|---|
| 0 | 1 | **Skripte + Dialogtexte + AKAO/Tutorials** | `Section1File`, `TutFileStandard` |
| 1 | 2 | **Kamera** | `CaFile` |
| 2 | 3 | **Model-Loader** (Actor-Liste) | `FieldModelLoaderPC` |
| 3 | 4 | **Paletten** (nur PC!) | `BackgroundFilePC::savePal` |
| 4 | 5 | **Walkmesh** | `IdFile` |
| 5 | 6 | **Tiles / Background-Kacheln (ungenutzt)** | `BackgroundTilesFile` |
| 6 | 7 | **Encounter (Zufallskämpfe)** | `EncounterFile` |
| 7 | 8 | **INF — Triggers/Gateways/Mapname** | `InfFile` |
| 8 | 9 | **Background (Tiles+Texturseiten)** | `BackgroundFilePC` |

> **Wichtig / Korrektur häufiger Fehlannahmen:** Sektion 2 ist die **Kamera**, nicht die Walkmesh. Walkmesh ist Sektion 5. Sektion 4 ist die Palette und existiert **nur** in der PC-Version. Sektion 6 („Tiles") wird von der PC-Engine **nicht benutzt** und wird von Makou beim Speichern optional komplett geleert (`Field.cpp:341`, `Field::setRemoveUnusedSection`, `Field.h:107` mit dem Kommentar, dass das ein „ugly hack“ nur für PC ist).

Der Flag-Enum (`Field.h:36–46`) verwendet Bitmasken (`Scripts=0x01 … Tiles=0x200`) — das ist eine reine Makou-Interna, keine Formattatsache.

### 2.4 PSX-Container (.DAT)

`FieldPS` (`src/core/field/FieldPS.h`, `.cpp`):

| Eigenschaft | Wert | Beleg |
|---|---|---|
| Headergröße | **28 Byte** = 7 × u32 | `FieldPS.h:47` |
| Sektionsanzahl | **7** | `FieldPS.h:59` |
| Sektionslängen-Präfix | **nein** (`hasSectionHeader() = false`) | `FieldPS.h:63` |
| Padding zwischen Sektionen | 0 | `FieldPS.h:60` |
| Alignment | **4 Byte** | `FieldPS.h:61` |
| Footer | keiner | `FieldPS.cpp` (`saveFooter` leer) |
| Header-Bytes | leer (`saveHeader` liefert nichts) | `FieldPS.cpp` |

**VRAM-Bias (sehr wichtig):** Die 7 u32-Offsets im PSX-Header sind **keine Dateioffsets**, sondern PSX-Speicheradressen. Makou berechnet `vramDiff = offset[0] − 28` und zieht diesen Wert von allen 7 Offsets ab, um Dateipositionen zu erhalten (`FieldPS.cpp:44–50`). Beim Schreiben wird `vramDiff` wieder addiert (`Field.cpp:336` via `diffSectionPos()`, `FieldPS.h:62`).

**Sektionsindex PSX** (`FieldPS.cpp:53–66`, Reihenfolge `FieldPS.cpp:…orderOfSections`):

| Index | Inhalt |
|---|---|
| 0 | Skripte + AKAO |
| 1 | Walkmesh |
| 2 | Background **und** Tiles (gemeinsam) |
| 3 | Kamera |
| 4 | INF |
| 5 | Encounter |
| 6 | Model-Loader |

Zusatzdateien pro PSX-Field: `<NAME>.DAT` (Container), `<NAME>.BSX` (Modelle), `<NAME>.MIM` (Background-Bilddaten) — `FieldArchiveIOPS.cpp:120–130`, `:249–257`. Alle drei sind LZS-komprimiert mit 4-Byte-Größenkopf.

### 2.5 PSX-Demo-Variante

`FieldPSDemo` (`src/core/field/FieldPSDemo.h/.cpp`): **kein Container** — jede Sektion ist eine eigene Datei mit eigener Endung (`FieldPSDemo.cpp:42–54`):

| Sektion | Datei-Endung |
|---|---|
| Skripte / AKAO | `.ATE` |
| Walkmesh | `.ID` |
| Background | `.MAP` |
| Kamera | `.CA` |
| INF / Encounter / Model-Loader | **nicht vorhanden** |

Erkennung im ISO: Dateien mit Endung `.ATE` (`FieldArchiveIOPS.cpp:311`); normale PSX-Fields sind `.DAT` unter Ausschluss von `WM*.DAT` (Weltkarte) (`FieldArchiveIOPS.cpp:315`).

### 2.6 Archiv-Ebene

- **PC:** `flevel.lgp` via ff7tk-`Lgp`-Klasse. Field-Dateien sind Einträge **ohne Punkt im Namen**; `maplist` ist ein Sondereintrag; `*.tut` sind separate Tutorial-Dateien (`FieldArchiveIOPC.cpp:129–135`). Ohne `maplist` verweigert Makou das Öffnen (`FieldArchiveIOPC.cpp:100–103`).
- **PSX:** ISO wird über ff7tk-`IsoArchive` gelesen; die Field-Dateien liegen in einem eigenen Verzeichnis (`iso.fieldDirectory()`, `FieldArchiveIOPS.cpp:274`). Beim Speichern wird das ISO komplett neu gepackt (`FieldArchiveIOPS.cpp:396`).
- `window.bin` wird beim PSX-ISO direkt aus dem Image geladen (`FieldArchiveIOPS.cpp:325`).

---

## 3. Sektion 1 — Skripte, Dialoge, AKAO/Tutorials

Quelle: `src/core/field/Section1File.cpp:121–318` (Lesen) und `:320–412` (Schreiben — dort ist die Struktur am klarsten abzulesen).

### 3.1 Kopf

| Offset | Größe | Feld | Beleg |
|---|---|---|---|
| 0x00 | u16 LE | **Version**. Normal `0x0502`; **`0x0301` = PSX-Demo** | `:134–138`, `:44` |
| 0x02 | u8 | Anzahl Entity-Gruppen (`nbGrpScripts`) | `:152` |
| 0x03 | u8 | Anzahl 3D-Modelle (`nb3DObjects`) — wird beim Lesen ignoriert, beim Schreiben aus der Anzahl Gruppen vom Typ *Model* berechnet | `:154`, `:353` |
| 0x04 | u16 LE | **posTexts** — Offset des Textblocks = Ende der Skripte | `:140` |
| 0x06 | u16 LE | Anzahl AKAO-/Tutorial-Blöcke | `:155` |
| 0x08 | u16 LE | **scale** (Hintergrund-Maßstab; Standard 512 für neue Maps) | `:161`, `:43` |
| 0x0A | 6 Byte | leer/reserviert | `:395` |
| 0x10 | 8 Byte | Autor/Creator, Latin-1, nullterminiert, letztes Byte erzwungen 0 | `:164–165`, `:391–392` |
| 0x18 | 8 Byte | Map-Name, gleiche Konvention | `:166`, `:393` |
| 0x20 | — | Beginn der Entity-Namenstabelle | `:167` |

**PSX-Demo-Abweichung (Version 0x0301):** kein `scale`-Feld; Autor beginnt bei **0x08**, Namenstabelle bei **0x18** (24) statt 0x20 (`:157–163`, bestätigt in `TutFileStandard.cpp:59`).

### 3.2 Tabellen

Reihenfolge unmittelbar nach dem Kopf:

1. **Entity-Namen:** `nbEntity × 8 Byte` Latin-1, nullgepolstert (`:209–210`, `:340`).
2. **AKAO-Offsets:** `nbAKAO × u32 LE`, absolut relativ zum Sektionsanfang (`:194`, `TutFileStandard.cpp:57–66`).
3. **Skript-Einsprungtabelle:** pro Entity **32 × u16 LE** (PC/PSX) bzw. **16 × u16 LE** (Demo) — Offsets relativ zum Sektionsanfang (`:176–177`, `:216`, `:342–352`).
4. **Skript-Bytecode** (dicht gepackt).
5. **Textblock** ab `posTexts`.
6. **AKAO-/Tutorial-Blöcke**.

Beim Schreiben: `posScripts = 32 + nbEntity×72 + nbAKAO×4` — die 72 = 8 Byte Name + 32×2 Byte Offsets pro Entity (`:334`). Für die Demo entsprechend `24 + nbEntity×8 + nbAKAO×4` (`TutFileStandard.cpp:59`).

**Größenlimit:** Alle Offsets sind u16 ⇒ Skripte+Texte müssen unter 65 536 Byte bleiben. Makou rechnet den verfügbaren Platz als `65535 − (32 + nbEntity×72 + nbAKAO×4)` (`Section1File.cpp:1159–1164`).

**Maxima:** 256 Entity-Gruppen (`Section1File.h:51`), 256 Texte (`Section1File.h:85`), 255 AKAO/Tutorial-Blöcke (`Section1File.cpp:332`, `TutFileStandard.h:31`).

### 3.3 Skript-Slots pro Entity

32 Offsets ⇒ 32 Skripte. Konvention (`GrpScript.cpp:180–228`, `GrpScript.h:24` `SCRIPTS_SIZE 33`):

- Datei-Skript **0** enthält *zwei* logische Skripte: **Init** und **Main**. Makou spaltet es beim ersten `RET`/`RETTO` auf (`Section1File.cpp:252–255`, `Script::splitScriptAtReturn`, `Script.cpp:91–119`). Deshalb 33 Slots im Editor.
- Die Aufspaltung überspringt Vorwärtssprünge: Ein `RET`, das durch einen noch offenen Vorwärtssprung „übersprungen“ wird, zählt nicht als Trennpunkt (`Script.cpp:96–110`). Wichtiger Edge-Case beim Nachbauen.
- Datei-Skripte 1..31 → Editor-Slots 2..32.

Semantische Slot-Namen (aus `GrpScript::scriptName`, `GrpScript.cpp:180–228`):

| Datei-Slot | Entity-Typ *Model* | Entity-Typ *Location* (Walkmesh-Linie) |
|---|---|---|
| 0 (Teil A) | Init | Init |
| 0 (Teil B) | Main | Main |
| 1 | **Talk** | **[OK]** (Bestätigungstaste auf der Linie) |
| 2 | **Contact** (Berührung) | **Move** |
| 3 | — | **Move** |
| 4 | — | **Go** |
| 5 | — | **Go 1×** |
| 6 | — | **Go away** |
| 7..31 | generisch „Script n“ | generisch |

### 3.4 Entity-Typ-Erkennung

`GrpScript::detectType` (`GrpScript.cpp:61–97`) klassifiziert eine Entity **allein anhand des Init-Skripts**:

| Erster passender Opcode im Init-Skript | Typ | Nebeneffekt |
|---|---|---|
| `PC` | **Model** | `character` = Party-Char-ID |
| `CHAR` | **Model** | `character = 0x100` (= „nur 3D-Objekt, kein Party-Char“) |
| `LINE` | **Location** | Walkmesh-Trigger-Linie |
| `BGPDH`, `BGSCR`, `BGON`, `BGOFF`, `BGROL`, `BGROL2`, `BGCLR` | **Animation** | reine Hintergrund-Animator-Entity |
| `MPNAM` | **Director** | Map-Name-Setzer |
| sonst | NoType | |

> Für WebMidgar (S38) sehr nützlich: Die Engine kennt keine explizite Typmarkierung. Der Typ ist **implizit** aus dem Init-Skript ableitbar. Insbesondere existiert eine eigene Konvention für „Hintergrund-Animations-Entities“ — das sind die Skripte, die S39 interessieren.

### 3.5 Model-ID-Zuordnung (Actor ↔ Model-Loader)

`Section1File::modelID` (`:539–554`): Die Model-ID einer Entity ist der **laufende Index unter allen Gruppen vom Typ *Model***, nicht der Gruppenindex. `modelCount()` zählt entsprechend (`:917–927`). Diese Zahl indiziert die Model-Loader-Sektion (Sektion 3).

### 3.6 Textblock

Ab `posTexts`:

| Offset (rel. posTexts) | Größe | Bedeutung |
|---|---|---|
| 0x00 | u16 LE | Anzahl Texte (`nbTexts`) |
| 0x02 | `nbTexts × u16 LE` | Offsets der Texte, **relativ zu posTexts** |
| … | | Textdaten, jeder mit `0xFF` terminiert |

Belege: Lesen `:277–312`, Schreiben `:369–378`.

**Quirk:** Makou traut dem `nbTexts`-Feld nicht. Es leitet die Anzahl aus dem **ersten Offset** ab: `textCount = offset[0]/2 − 1` (`:282–284`). Das funktioniert, weil die Offsettabelle direkt vor den Daten liegt. Empfehlung für WebMidgar: dieselbe Ableitung verwenden und `nbTexts` nur als Plausibilitätscheck.

**Quirk 2 (FIXME im Code):** Zwischen dem `0xFF`-Terminator und dem nächsten Offset können „versteckte“ Bytes liegen — Makou behält sie derzeit nicht bei (`:298`, `:310`). Beim Re-Encode kann dadurch Byte-Gleichheit verloren gehen.

**Quirk 3 (Android-Port):** In manchen Builds liegt `posTexts` **hinter** `posAKAO`. Makou erkennt das und sucht die reale Skriptgrenze per Rückwärtssuche nach den ersten 4 Bytes des Textblocks (`:199–206`, Kommentar „On the Android version, posTexts can be after posAKAO“).

**Quirk 4 (leere Gruppen):** Manche Gruppen haben eine degenerierte Offsettabelle (alle Offsets identisch/absteigend). Makou erkennt sie über einen `emptyGrps`-Zähler und überspringt sie, statt Müll zu parsen (`:212–238`).

### 3.7 Wortausrichtung

Wenn AKAO-Blöcke vorhanden sind, wird der Bereich Skripte+Texte auf ein Vielfaches von 4 aufgefüllt (`:381–384`). AKAO-Blöcke selbst werden einzeln auf 4 ausgerichtet, Tutorial-Blöcke **nicht** (`TutFileStandard.cpp:87–90`, expliziter Kommentar).

---

## 4. AKAO- und Tutorial-Blöcke (die „Sektion 2" innerhalb Sektion 1)

Beide Sorten liegen in derselben Offsettabelle. Unterschieden wird **am Inhalt**:

- Beginnt der Block mit ASCII `AKAO` → Musik/Sound-Block (`TutFileStandard.cpp:113–116`).
- Sonst → Tutorial-Skript.

### 4.1 AKAO-Blockkopf

| Offset | Größe | Bedeutung | Beleg |
|---|---|---|---|
| 0x00 | 4 | Magic `AKAO` | `TutFileStandard.cpp:115` |
| 0x04 | u16 LE | AKAO-ID (Sound-/Musik-ID) | `TutFileStandard.cpp:168`, `:196` |
| 0x06 | u16 LE | Länge | `TutFileStandard.cpp:176` |
| 0x08 | 8 | unbekannt (Hex-Dump im UI) | `TutFileStandard.cpp:187` |
| 0x10 | 4 | unbekannt | `TutFileStandard.cpp:189` |
| 0x14 | u16 LE | Offset der ersten Kanaldaten ⇒ **Kanalanzahl = wert/2 + 1** | `TutFileStandard.cpp:183–185` |

### 4.2 Bekannter Datenfehler (Repair-Funktion)

In Original-Spieldaten existieren AKAO-Blöcke mit **abgeschnittenem Magic**: `KAO…` (1 Byte fehlt) oder `AO…` (2 Byte fehlen). Makou bietet eine Reparatur an, die die fehlenden Bytes vorne ergänzt (`TutFileStandard.cpp:132–150`). Ein Tutorial-Block gilt als „kaputt“, wenn sein erstes Byte `> 0x12` und `< 0xFF` ist (`TutFileStandard.cpp:120–130`) — also außerhalb des gültigen Tutorial-Opcode-Bereichs.

> **Für WebMidgar relevant:** Ein robuster `formats-field`-Parser sollte diese beiden Defekte tolerieren statt zu werfen.

### 4.3 Tutorial-Bytecode (eigene, sehr kleine VM)

Vollständige Opcode-Liste aus `src/core/field/TutFile.cpp:110–205`:

| Byte | Mnemonik | Zusatzbytes | Bedeutung |
|---|---|---|---|
| 0x00 | PAUSE | 2 (u16 LE) | Warten n Einheiten |
| 0x02 | — | 0 | Taste **UP** |
| 0x03 | — | 0 | **DOWN** |
| 0x04 | — | 0 | **LEFT** |
| 0x05 | — | 0 | **RIGHT** |
| 0x06 | — | 0 | **MENU** |
| 0x07 | — | 0 | **CANCEL** |
| 0x08 | — | 0 | **CHANGE** |
| 0x09 | — | 0 | **OK** |
| 0x0A | — | 0 | **R1** |
| 0x0B | — | 0 | **R2** |
| 0x0C | — | 0 | **L1** |
| 0x0D | — | 0 | **L2** |
| 0x0E | — | 0 | **START** |
| 0x0F | — | 0 | **SELECT** |
| 0x10 | TEXT | variabel bis `0xFF` | FF7-kodierter Text, terminiert durch `0xFF` |
| 0x11 | FINISH | 0 | Ende |
| 0x12 | MOVE | 4 (2× u16 LE: x, y) | Cursor-/Fensterposition |
| 0xFF | NOP | 0 | — |

Gültige Opcodes also nur 0x00, 0x02–0x12, 0xFF. **0x01 ist nicht belegt.**

### 4.4 Tutorial-Dateien in `flevel.lgp` (`*.tut`) — anderes Format!

`TutFilePC::openPositions` (`src/core/field/TutFilePC.cpp:30–48`): Feste Tabelle von **9 × u16 LE** Offsets am Dateianfang (18 Byte Kopf). Ein Offset `< 18` wird auf 18 hochkorrigiert; beim Schreiben markiert `0xFFFF` einen leeren Slot.

---

## 5. Text-Kodierung (FF7String)

> `FF7String` selbst liegt in ff7tk. In diesem Repo ist das **Rendering-/Metrik-Verhalten** dokumentiert, aus dem sich die Steuercode-Semantik ableiten lässt: `src/core/FF7Font.cpp:430–545` (Breitenberechnung) und `src/widgets/TextPreview.cpp:360–450` (Zeichnen).

### 5.1 Steuercodes (Nicht-Japanisch)

| Byte | Zusatzbytes | Bedeutung | Beleg |
|---|---|---|---|
| 0x00–0xDF | 0 | Normale Zeichen, Tabelle 0 | `FF7Font.cpp:531–534` |
| **0xE0** | 0 | `{CHOICE}` — Einzug für Auswahlmenü (Breite = 3 × `choiceWidth`, Default 10) | `FF7Font.cpp:517–518`, `TextPreview.cpp:378` |
| **0xE1** | 0 | Tabulator (Breite = 3 × `tabWidth`, Default 4) | `FF7Font.cpp:519–520` |
| **0xE2–0xE4** | 0 | „optimierte Duos“ — je **zwei** Zeichen aus Tabelle 1 in einem Byte | `FF7Font.cpp:521–525`, `TextPreview.cpp:382–384` |
| **0xE7** | 0 | **Zeilenumbruch** (`\n`) — Zeilenhöhe +16 px | `FF7Font.cpp:460–466` |
| **0xE8** | 0 | **Seitenumbruch** | `FF7Font.cpp:450` |
| **0xE9** | 0 | **Seitenumbruch 2** | `FF7Font.cpp:451` |
| **0xEA–0xF5** | 0 | Charakternamen-Platzhalter (12 Stück: Cloud, Barret, Tifa, …); Breite ≈ 9 × breitestes Zeichen | `FF7Font.cpp:526–527`, `TextPreview.cpp:392–393` |
| **0xF6–0xF9** | 0 | Tasten-Icons (4 Stück), feste Breite **17 px** | `FF7Font.cpp:528–529`, `TextPreview.cpp:394–396` |
| **0xFA** | 1 | Japanische Tabelle 2 (im Nicht-JP-Modus: `< 0xD2` ⇒ 1 px) | `FF7Font.cpp:467–475` |
| **0xFB** | 1 | Japanische Tabelle 3 | `FF7Font.cpp:476–482` |
| **0xFC** | 1 | Japanische Tabelle 4 | `FF7Font.cpp:483–489` |
| **0xFD** | 1 | Japanische Tabelle 5 | `FF7Font.cpp:490–496` |
| **0xFE** | 1 (+ mehr) | **Erweiterungspräfix**, siehe unten | `FF7Font.cpp:497–515` |
| **0xFF** | 0 | **Textende** | `FF7Font.cpp:448` |

> **Korrektur einer verbreiteten Fehlannahme:** 0xE7 ist der **Zeilenumbruch**, 0xE8/0xE9 sind die **Seitenumbrüche** — nicht umgekehrt.

### 5.2 0xFE-Untercodes

| Zweites Byte | Zusatzbytes | Bedeutung | Beleg |
|---|---|---|---|
| 0x00–0xD1 | 0 | Japanische Tabelle 6 (nur JP-Modus) | `FF7Font.cpp:513–514` |
| **0xD2–0xD9** | 0 | **Schriftfarbe setzen** (8 Farben, `WindowBinFile::FontColor`) | `TextPreview.cpp:417–418` |
| **0xDA** | 0 | **Blinken an/aus** | `TextPreview.cpp:419–422` |
| **0xDB** | 0 | **Regenbogen/Multicolor an/aus** | `TextPreview.cpp:423–431` |
| **0xDD** | 1 | „PAUSE"/Wartecode — konsumiert 1 weiteres Byte | `TextPreview.cpp:432–433`, `FF7Font.cpp:501–502` |
| **0xDE** | 0 | `{VARHEX}` — Variable hex, Breite = 5 Ziffern | `FF7Font.cpp:503–505` |
| **0xDF** | 0 | `{VARDEC}` — Variable dezimal, 5 Ziffern | `FF7Font.cpp:503–505` |
| **0xE1** | 0 | `{VARDECR}` — Tab + Variable dezimal | `FF7Font.cpp:503–505`, `TextPreview.cpp:436–438` |
| **0xE2** | **4** | `{MEMORY}` — Bank/Adresse/Länge; Länge steht im **4. Folgebyte** (Offset +3 nach 0xFE 0xE2) | `FF7Font.cpp:506–510`, `TextPreview.cpp:439–440` |
| **0xE9** | 0 | `{SPACED CHARACTERS}` — Umschalter für feste Zeichenbreite (Default 13 px) | `FF7Font.cpp:511–512`, `TextPreview.cpp:441–442` |

### 5.3 Textmetrik / Fensterautogröße

Aus `FF7Font::calcSize` (`FF7Font.cpp:430–545`):

| Größe | Wert | Beleg |
|---|---|---|
| Startbreite | `8 + autoSizeMarginRight` (Default 14) ⇒ 22, erste Zeile −3 | `:436–437` |
| Starthöhe | **25 px** | `:437` |
| Zeilenhöhe | **+16 px** je `0xE7` | `:465` |
| Maximale Fensterbreite | **322 px** (geklemmt) | `:542` |
| Maximale Fensterhöhe | **226 px** (geklemmt) | `:543` |
| Zeichenbreite | aus `window.bin` (`charWidth` + `leftPadding`), Fallback: eingebaute Tabelle | `:548–566` |

Die Fallback-Tabelle `charWidth[7][256]` kodiert Breite und linkes Padding **in einem Byte** (Makros `CHARACTER_WIDTH` / `LEFT_PADD` stammen aus ff7tk, nicht aus diesem Repo — `FF7Font.cpp:553`, `:561`). Werte > 64 in der Tabelle sind erkennbar gepackte Kombinationen.

Es gibt **7 Zeichentabellen** (Index 0..6): 0 = International, 1 = JP-Basis, 2..5 = JP-Erweiterungen (Präfix 0xFA..0xFD), 6 = JP über 0xFE (`FF7Font.h:59`, Nutzung in `FF7Font.cpp:471–514`).

Fensterhintergrundfarben (Farbverläufe je Fenstertyp) sind als RGB-Tripel in `TextPreview.cpp:658–668` hinterlegt.

---

## 6. Field-Skript-VM: Sprünge, Labels, Grenzen

Aus `src/core/field/Script.cpp`:

| Fakt | Beleg |
|---|---|
| Ein Skript wird linear dekodiert; jeder Opcode meldet seine eigene Länge (`op.size()`), es gibt **keine** Längenpräfixe | `Script.cpp:43–52` |
| **Sprungziel = Position des Sprung-Opcodes selbst + Sprungwert.** Nicht das Ende des Opcodes, nicht der Skriptanfang. | `Script.cpp:48` (`labelPositions.insert(pos + op.jump(), …)`) |
| Beim Kompilieren: `jump = labelPosition − pos`, wobei `pos` wieder die Opcode-Position ist | `Script.cpp:200` |
| Sprungziele, die **nicht** auf eine Opcode-Grenze fallen, sind Fehler (`InsideInstruction`) — die Engine würde mitten in eine Instruktion springen | `Script.cpp:64–69`, `:235–237` |
| Kurz-/Langsprung: `setJump()` kann einen Opcode automatisch in die Langform konvertieren, was seine Größe ändert; Makou iteriert die Kompilierung bis zum Fixpunkt | `Script.cpp:184–225` |
| Maximale Skriptgröße: **65 535 Byte** | `Script.cpp:256–258` |
| Fehlerklassen: `Ok`, `InsideInstruction`, `ImpossibleBackward`, `ImpossibleLong`, `AfterScript`, `BeforeScript` | `Script.cpp:232–250` |

`LABEL` ist ein **Pseudo-Opcode** von Makou (Größe 0, wird beim Speichern eliminiert), keine Engine-Instruktion (`Script.cpp:78–86`, `:164–174`).

### 6.1 Hintergrund-Zustandsanalyse (direkt relevant für S39)

`Script::backgroundParams` (`Script.cpp:714–739`):

- Ein `BGON`-Opcode mit **Bank-Byte = 0** (also literale Operanden) markiert Parameter `bgParamID` mit **State-Bit `1 << bgStateID`** als aktiv.
- Mehrere `BGON` auf denselben Parameter werden **ODER-verknüpft** ⇒ ein Parameter kann mehrere gleichzeitig sichtbare States haben.
- `BGOFF` wird bewusst **nicht** ausgewertet (auskommentiert, `Script.cpp:727–737`): Für die statische Vorschau interessiert nur, welche Zustände *jemals* eingeschaltet werden. Die auskommentierte Logik zeigt aber die Semantik: `state = (1<<id) & aktiv) XOR aktiv` = Bit löschen.
- Nur das **erste** Skript (Init) einer Gruppe wird für Params ausgewertet (`GrpScript.cpp:102–105`), **alle** Skripte dagegen für Bewegung (`GrpScript.cpp:107–110`).

`Script::backgroundMove` (`Script.cpp:741–757`):

- `BGPDH` setzt die **Z-Tiefe** eines Layers: nur `layerID` 2 und 3 werden berücksichtigt, Ablage in `z[layerID − 2]` ⇒ **nur Layer 2 und 3 haben eine variable Z-Tiefe**; Layer 1 (Hintergrund) und 4 sind fix.
- `BGSCR` setzt **X/Y-Scroll** ebenfalls nur für Layer 2 und 3 (`x[layerID−2]`, `y[layerID−2]`).
- Beide nur bei Bank-Byte = 0 (literale Werte).

> **Kernaussage für S39:** Die Layer-Dynamik der FF7-Field-Hintergründe reduziert sich auf (a) Parameter/State-Sichtbarkeitsschalter (`BGON`/`BGOFF`) und (b) Z-Tiefe + X/Y-Scroll für genau **zwei** Layer (2 und 3). Zusätzlich gibt es `BGROL`/`BGROL2` (Rollen) und `BGCLR` (Löschen) — siehe Opcode-Kapitel.

---

## 7. Savemap-Variablen (Banks)

`src/widgets/VarManager.cpp`:

| Fakt | Beleg |
|---|---|
| Bänke sind **1..15** | `VarManager.cpp:31` |
| Jede Bank hat **256 Adressen** (0..255) | `VarManager.cpp:174` |
| **Bänke 8, 9, 10 sind temporär** und werden nicht im Spielstand gespeichert | `VarManager.cpp:62–63` (Hilfetext) |
| Bänke teilen sich paarweise denselben Speicherort: **1↔2, 3↔4, 5↔6, 11↔12, 13↔14, 15↔7** | `VarManager.cpp:118–135` |
| Variablenname-Schlüssel: `(bank << 8) | address` | `VarManager.cpp:257`, `Var.h` |

> Beachte das **unsymmetrische Paar 15↔7** — das ist kein Tippfehler, es steht so in `banksFromRow`/`rowFromBank` (`VarManager.cpp:130`, `:154`).

Bekannte Variablen (`src/qt/vars.cfg`, Format `bank|address|$Name`, 43 Einträge), Auswahl:

| Bank | Adresse | Name |
|---|---|---|
| 1 | 3–6 | `$AerisLovePoints`, `$TifaLovePoints`, `$YuffieLovePoints`, `$BarretLovePoints` |
| 1 | 20–23 | `$Hours`, `$Minutes`, `$Seconds`, `$Frames` |
| 1 | 64–70 | `$KeyItems` (Bitfeld über 7 Byte) |
| 1 | 80–83 | `…BattleLovePoints` |
| 1 | 85–88 | `$ChocoboType1..4Catched` |
| 1 | 124 | `$ChocoboOnMap` |
| 1 | 167 / 182 | `$VictoryFortCondor` / `$DefeatFortCondor` |
| 2 | 0 | **`$GameMoment`** (globaler Story-Fortschritt) |
| 2 | 24 / 26 | `$BattleCount` / `$BattleEscaped` |
| 2 | 180 | `$GoldFortCondor` |
| 3 | 9 | `$PartyLeader` |
| 3 | 88 / 89 | `$NumStablesBought` / `$NumStablesFilled` |
| 13 | 31 | `$ErrorAddMateria` |
| 13 | 84–89 | `$LastCloud`, `$LastBarret`, `$LastTifa`, `$LastRedXIII`, `$LastCid`, `$LastYuffi` |

---

## 8. kernel2.bin (Namenslisten)

`Data::loadKernel2Bin` (`src/Data.cpp:371–485`):

1. Datei beginnt mit u32 LE **komprimierter Größe**; `größe + 4 == dateigröße` wird geprüft (`:389`).
2. Rest ist LZS ⇒ `LZS::decompressAll` (`:393`).
3. Im dekomprimierten Blob folgen Unterabschnitte, jeder mit **u32 LE Längenpräfix**.
4. Die **ersten 10** Abschnitte werden übersprungen (`:400–407`).
5. Danach in dieser Reihenfolge: **Item-Namen** (Index 10), **Waffen-Namen**, **Rüstungs-Namen**, **Accessoire-Namen**, **Materia-Namen** (`:420`, `:436`, `:450`, `:465`, `:480`).

**Namenslisten-Format** (`Data::fill`, `:568–605`): Der Abschnitt beginnt mit einer u16-LE-Offsettabelle; `anzahl = ersterOffset / 2`. Offsets sind relativ zum Abschnittsanfang. Jeder Eintrag ist ein FF7-kodierter String, dessen Ende der nächste Offset ist (letzter Eintrag bis Abschnittsende). — **Dasselbe Muster wie der Textblock in Sektion 1.**

---

## 9. maplist / Feldnamen

- `maplist` ist ein Eintrag in `flevel.lgp`; ohne ihn verweigert Makou das Öffnen (`FieldArchiveIOPC.cpp:100–110`).
- Eingebaute PSX-Liste: **788** Einträge (`Data.h:104`, `Data.cpp:743`).
- **PC weicht an 19 Stellen ab** (`Data::toPCMaplist`, `Data.cpp:750–769`) — konkrete Indizes: 88–92 → `qa`..`qe`; 153 → `min71`; 164–169 → `sbwy4_1`..`sbwy4_6`; 174–175 → `min51_1`, `min51_2`; 586 → `tower5`; 735 → `sbwy4_22`.

> Für `formats-field`/`pipeline`: Feld-IDs in `MAPJUMP`-Opcodes indizieren diese Liste. Bei PC-Daten **muss** die korrigierte Liste verwendet werden, sonst zeigen 19 Sprungziele auf falsche Maps.

---

## 10. Musik-IDs

`Data::musicList[100]` (`src/Data.cpp:771–789`) — 100 interne Kurznamen, Index = Musik-ID im Skript-Opcode. `musicList2[100]` (`:790–…`) enthält die menschenlesbaren Titel. Index 0 = `none`, 1 = `nothing`, 2 = `oa` (Opening – Bombing Mission), … Die vollständige Liste ist eine Literal-Tabelle ⇒ als riskant markiert, aber die Zuordnung ist über die Dateinamen in `music/` bzw. `midi/` des Spiels trivial nachvollziehbar.

Movie-Namen: `Data::movieList[106]` (`:607–…`); die ersten 20 sind CD-übergreifend, danach CD-spezifisch (`:526–553`).

Tastensymbole (für Textcodes 0xF6–0xF9 und Tutorials), Index 0..15 (`Data.cpp:514–524`): CAMERA/L2, TARGET/R2, PAGE UP/L1, PAGE DOWN/R1, MENU/TRIANGLE, OK/CIRCLE, CANCEL/CROSS, SWITCH/SQUARE, ASSIST/SELECT, ???, ???, START, UP, RIGHT, DOWN, LEFT.

---

## 11. Walkmesh — Sektion 5 (`IdFile`)

Alles Little Endian; Makou liest per `memcpy` in x86-Structs, **kein Byteswap irgendwo**.

| Offset | Größe | Feld |
|---|---|---|
| 0 | u32 | `nbSector` — Dreiecksanzahl |
| 4 | n × 24 | Dreiecke |
| 4 + n·24 | n × 6 | Access-/Nachbarschaftsrecords |
| Ende | 0 oder 2 | optionales Padding |

`IdFile.cpp:105–113` (Größenprüfung: Datei muss **exakt** `4 + n·24 + n·6` oder **+2** sein), `:121`, `:123`. Struct-Größen per Runtime-Assert: `Triangle` = 24, `Access` = 6 (`IdFile.cpp:95`).

**Dreieck = 3 × `Vertex_sr` à 8 Byte** (`IdFile.h:24–30`): +0 `x` i16, +2 `y` i16, +4 `z` i16, +6 `res` i16 (Padding).

**Quirk:** Beim Speichern schreibt Makou in *alle drei* `res`-Felder eine Kopie von `vertices[0].z` (`IdFile.cpp:140–142`). Reader sollte das Feld ignorieren, Writer replizieren.

**Access-Record = 3 × i16**, indexparallel zu den Dreiecken (`IdFile.h:32–34`, `IdFile.cpp:185–197`):

| Index | Nachbardreieck über Kante |
|---|---|
| `a[0]` | v1–v2 |
| `a[1]` | v2–v3 |
| `a[2]` | v3–v1 |

**`-1` = keine Verbindung (Wand)** (`IdFile.cpp:52–57`, Renderer `WalkmeshWidget.cpp:198–200`).

**Repräsentative Höhe eines Dreiecks = `vertices[0].z`** — Fallback-Z, wenn ein Skript nur eine Dreiecks-ID liefert (`3d/WalkmeshWidget.cpp:356–357`). Passt zur `res`-Konvention.

**Weltkoordinaten-Divisor: 4096** — einheitlich für Walkmesh-Vertices, Gateway-/Trigger-Linien, Kamera-Achsen, Kamera-Position, Modellpositionen (`3d/WalkmeshWidget.cpp:161–175`, `:195–197`, `:224–225`, `:238–239`, `:311–312`, `:366`).

**Field-Welt hat Z als Vertikalachse** (bestätigt durch den Z-Fallback und `up = (0,0,1)` in der Modellvorschau, `3d/FieldModel.cpp:322`).

---

## 12. Kamera — Sektion 6 (`CaFile`)

### 12.1 Record (40 Byte, Assert `CaFile.cpp:57`; Deklaration `CaFile.h:27–34`)

| Offset | Größe | Feld | Bemerkung |
|---|---|---|---|
| 0 | 6 | `camera_axis[0]` = X-Achse (3 × i16) | Festkomma **/4096** |
| 6 | 6 | `camera_axis[1]` = Y-Achse | /4096 |
| 12 | 6 | `camera_axis[2]` = Z-Achse (Blickrichtung) | /4096 |
| 18 | 2 | `camera_axis2z` | **Kopie** von `camera_axis[2].z` (Padding), wird bei jedem Schreiben resynchronisiert (`CaFile.cpp:115`) |
| 20 | 12 | `camera_position[3]` (3 × i32) | im Viewer ebenfalls **/4096** |
| 32 | 4 | `blank` (i32) | |
| 36 | 2 | `camera_zoom` (u16) | Brennweite |
| 38 | 2 | `unknown` (u16) | „scheint undefiniert"; **auf PC nicht geschrieben** (nur 38 Byte emittiert) |

### 12.2 PC vs. PSX — Formaterkennung allein über die Sektionslänge (`CaFile.cpp:62–69`)

| Bedingung | Interpretation |
|---|---|
| `size == 40` oder (`size−38 > 0` und `(size−38) % 18 == 0`) | **PSX** |
| `size == 38` oder `size % 38 == 0` | **PC** |
| sonst | ungültig, Öffnen verweigert |

- **PC:** `count = size/38`, jeder Record 38 Byte (`:84–89`).
- **PSX:** erster Record 38 (bzw. 40) Byte, danach `(size−38)/18` Records à **18 Byte** — nur die 3×3-Achsenmatrix (9 × i16). **Position und Zoom werden vom vorherigen Record geerbt** (expliziter Kommentar, `CaFile.cpp:79–96`); Makou nutzt dieselbe Struct-Instanz weiter.
- Mindestens ein Kamerarecord muss existieren (`:157–164`).

### 12.3 Projektionsmathematik (das, was belegbar ist)

**FOV aus Zoom** (`3d/WalkmeshWidget.cpp:110`):

> `fovy_grad = 2 · atan(240 / (2 · camera_zoom)) · 180/π`

Der Zoomwert ist also eine **Brennweite bezogen auf eine virtuelle Bildhöhe von 240 Einheiten** (PSX-Field-Vertikalauflösung). Fallback ohne Kamera: 70° (`:112`).

**View-Matrix** (`3d/WalkmeshWidget.cpp:161–182`): Achsen `/4096`; die **komplette Y-Achse und `camera_position[1]` werden negiert** (FF7 nutzt Y-abwärts, OpenGL Y-aufwärts). Augpunkt komponentenweise `t = −(camPos · R)`, dann `lookAt(eye = t, center = t + Zachse, up = Yachse)`. Projektion: `perspective(fovy, aspect, 0.001, 1000)`; Shader rechnet `projection * view * model` (`qt/shaders/main.vert:17`).

### 12.4 ⚠️⚠️ KONTAMINATIONSWARNUNG — `BackgroundTiles.cpp:42–93`

In `Tile::calcIDBig` steht ein **auskommentierter Hex-Rays-Decompiler-Auszug der Original-FF7-EXE** (rohe `sub_67C323`-/`sub_67CEA3`-Namen, `esp/ebp`-Stackkommentare, `_DWORD`-Casts). Das ist **dekompilierter proprietärer Square-Enix-Code**, kein Reverse-Engineering-Ergebnis in eigenen Worten.

> **Empfehlung für WebMidgar: diesen Block nicht als Grundlage verwenden und möglichst gar nicht lesen.** Wer ihn gelesen hat, ist für eine Clean-Room-Argumentation zur exakten BG-Projektion angreifbar. Die Formel ist aus beobachtbaren Daten (Kamera-Records + Tile-Positionen einer Map) selbst herzuleiten.

Nur zur Plausibilisierung einer eigenen Herleitung (aus den Kommentaren, nicht aus dem Code): Bildmitte-Konstanten `160` / `90` (letztere im Code selbst mit `// FIXME` markiert, also unsicher — 160 = halbe 320er-Breite, 90 ist **nicht** die halbe Höhe von 224/240), Perspektivteiler = `camera_zoom`, Tiefeneinheit = `4 · ID`, Kameramatrix als 4×4 mit `m[0,1,2,4,5,6,8,9,10] = achse[i]/4096` und Translation in der 4. Spalte.

Der **produktiv genutzte** Code verwendet nichts davon, sondern die Näherung `IDBig = (ID / 4096) · 10 000 000` mit Sonderfällen `ID == 0 → 999`, `ID < 50 → 10000·ID`, `ID ≥ 4095 → 9 998 999` (`BackgroundTiles.cpp:33–40`, `:95`), zweimal mit `// FIXME: approximation` markiert.

### 12.5 Kameraauswahl durch Skripte — **ungelöst**

Aus diesem Repo **nicht** beantwortbar: Es gibt **keinen Opcode, der einen CA-Record-Index setzt**. Der einzige kameragenannte Opcode ist `MVCAM` (0xFB) = „Camera Movie". Makou zeigt immer Kamera 0 bzw. die im UI gewählte (`BackgroundTiles.cpp:45`, `WalkmeshManager.cpp:560`). Die `SCRL*`-Opcodes (0x61–0x68, 0x6F) verschieben die 2D-Ansicht, wählen aber keinen CA-Record aus.

---

## 13. INF — Sektion 8: Mapname, Triggers, Gateways, Layer-Ausrichtung

Nur **zwei** Sektionsgrößen sind gültig: **740** (international) und **536** (japanisch). `isJap() ⇔ size == 536` (`InfFile.cpp:57`, `:62`, `:95`). Beim Speichern wird die vorhandene Größe beibehalten, Default 740.

| Offset | Größe | Feld | Bemerkung |
|---|---|---|---|
| 0 | 9 | `name[9]` | Mapname, Latin-1; Byte 8 wird auf 0 gezwungen (`InfFile.cpp:73`, `:106`) |
| 9 | 1 | `control` | Bewegungs-Orientierung; Default **128** („Left on the left", `InfFile.cpp:33`) |
| 10 | 2 | `cameraFocusHeight` (i16) | Kamerafokus-Höhe auf der Spielfigur |
| 12 | 8 | `camera_range` = i16 **left, top, right, bottom** | Defaults ∓256 (`InfFile.cpp:34–37`) |
| 20 | 1 | `bg_layer1_flag` | **1 = normal, 2 = vertikale Achse gespiegelt** |
| 21–23 | 3 | `bg_layer2/3/4_flag` | als ungenutzt markiert |
| 24 | 2 | `bg_layer3_width` | Default 1024 |
| 26 | 2 | `bg_layer3_height` | Default 1024 |
| 28 | 2 | `bg_layer4_width` | Default 1024 |
| 30 | 2 | `bg_layer4_height` | Default 1024 |
| 32 | 2 | `bg_layer3_x_related` | X-Offset |
| 34 | 2 | `bg_layer3_y_related` | |
| 36 | 2 | `bg_layer4_x_related` | |
| 38 | 2 | `bg_layer4_y_related` | |
| 40 | 2 | `bg_layer3_x_multiplier_related` | **X-Multiplikator (Parallax)** |
| 42 | 2 | `bg_layer3_y_multiplier_related` | |
| 44 | 2 | `bg_layer4_x_multiplier_related` | |
| 46 | 2 | `bg_layer4_y_multiplier_related` | |
| 48 | 8 | ungenutzt | |
| 56 | 288 | `Exit doors[12]` — 12 × 24 Byte | Gateways |
| 344 | 192 | `Trigger triggers[12]` — 12 × 16 Byte | |
| **536** | 12 | `display_arrow[12]` | **nur international**; 536 endet exakt hier |
| 548 | 192 | `Arrow arrows[12]` — 12 × 16 Byte | |
| 740 | | Ende | |

`InfFile.h:60–87`, Größen-Assert `InfFile.cpp:57`. Alle Layer-3/4-Werte sind im UI ±32767 (`WalkmeshManager.cpp:445–461`).

> **Für S39 hochrelevant:** `bg_layer3/4_width/height`, `*_x/y_related` und `*_x/y_multiplier_related` sind die **statischen Parallax-/Wrap-Parameter** der Layer 3 und 4. Die Suffixe `_related` zeigen, dass die exakte Semantik von Makou **nicht vollständig reversiert** wurde — hier ist eigene Messung nötig.

### 13.1 Gateway-Record (`Exit`, 24 Byte × 12, `InfFile.h:31–36`)

| Rel. Offset | Größe | Feld |
|---|---|---|
| +0 | 6 | `exit_line[0]` (i16 x,y,z) |
| +6 | 6 | `exit_line[1]` |
| +12 | 6 | `destination` — **x, y und z = Ziel-Dreiecks-ID** (im UI „T" statt „Z") |
| +18 | 2 | `fieldID` (u16) — Ziel-Map (Index in `maplist`) |
| +20 | 1 | `dir` — Blickrichtung bei Ankunft, 0..255 (256 = 360°) |
| +21..+23 | 3 | `dir_copy1..3` |

- **`fieldID == 0x7FFF` ⇒ Gateway ungenutzt.** Es gibt **kein separates Enable-Bit** (`InfFile.cpp:43`, `WalkmeshManager.cpp:1231`, `3d/WalkmeshWidget.cpp:222`).
- Beim Editieren werden **`dir` und alle drei Kopien mit demselben Wert** beschrieben (`WalkmeshManager.cpp:1194`) — die Engine liest offenbar eine der Kopien. Writer muss replizieren.
- Strukturell ein **datengetriebener `MAPJUMP`**: `OpcodeMAPJUMP { u16 mapID; i16 targetX; i16 targetY; u16 targetI; u8 direction; }` (`Opcode.h:856–863`).

### 13.2 Trigger-Record (`Trigger`, 16 Byte × 12, `InfFile.h:38–51`) — **S39-Kern**

| Rel. Offset | Größe | Feld |
|---|---|---|
| +0 | 6 | `trigger_line[0]` |
| +6 | 6 | `trigger_line[1]` |
| +12 | 1 | `background_parameter` |
| +13 | 1 | `background_state` |
| +14 | 1 | `behavior` |
| +15 | 1 | `soundID` |

- **`background_parameter == 0xFF` ⇒ Trigger ungenutzt** (`InfFile.cpp:44`). Gültiger Bereich 0..254.
- **Behavior-Werte** (`InfFile.h:43–49`) — „AN/AUS" = setze den durch `background_parameter` bezeichneten Layer auf `background_state`:

| Wert | Semantik |
|---|---|
| 0 | beim Auslösen → AN |
| 1 | beim Auslösen → AUS |
| 2 | beim Auslösen → AN, beim Entfernen → AUS |
| 3 | beim Auslösen → AUS, beim Entfernen → AN |
| 4 | beim Auslösen → AN, beim Entfernen **auf der Plus-Seite** → AUS |
| 5 | beim Auslösen → AUS, beim Entfernen auf der Plus-Seite → AN |

> **Kernaussage:** Hintergrund-Layer-Zustände werden **nicht nur** per Skript (`BGON`/`BGOFF`) gesetzt, sondern auch **rein datengetrieben** über Walkmesh-Trigger-Linien. `field-runtime` + `render-field` brauchen beide Pfade.

### 13.3 Pfeile (nur internationale Builds)

- `display_arrow[i]`: **nur Bit 0** wird genutzt (`InfFile.cpp:371`, `:376`); ein Byte pro **Gateway**.
- `Arrow` (16 Byte, `InfFile.h:53–58`): Feldreihenfolge **X, Z, Y, type** (i32, i32, i32, u32) — die mittleren Komponenten sind **vertauscht**.
- `type`: **0 = unsichtbar, 1 = rot, 2 = grün** (`InfFile.h:57`).
- Makou-Bug (nicht nachbauen): `editArrowType` schreibt den Combobox-**Index** statt des Datenwerts (`WalkmeshManager.cpp:1420–1424`).

---

## 14. Encounter — Sektion 7 (`EncounterFile`)

Sektion ist **exakt 48 Byte**, sonst Ablehnung (`EncounterFile.cpp:44–49`). Zwei identische Tabellen à 24 Byte (Assert `:39`), Tabelle 1 bei Offset 0, Tabelle 2 bei Offset 24.

| Offset (je Tabelle) | Größe | Feld |
|---|---|---|
| +0 | 1 | `enabled` |
| +1 | 1 | `rate` |
| +2 | 12 | `enc_standard[6]` — 6 normale Formationen (u16) |
| +14 | 8 | `enc_special[4]` — 4 Sonderformationen (Rücken-/Seitenangriff) |
| +22 | 2 | Padding |

**Bitpackung je Eintrag (u16)** (`EncounterFile.h:23–24`, Repack `EncounterWidget.cpp:81`):

| Bits | Feld | Bereich |
|---|---|---|
| 15..10 | Wahrscheinlichkeit | 0..63 |
| 9..0 | Formations-/Battle-ID | 0..1023 |

- `enabled`: nur **Bit 0** bedeutungstragend (`EncounterWidget.cpp:55`, `:75`). ⚠️ Makou-Inkonsistenz: `EncounterFile::setBattleEnabled` überschreibt das ganze Byte (`EncounterFile.cpp:85`).
- `rate`: „je niedriger, desto häufiger die Kämpfe" (`EncounterWidget.cpp:31`).
- **Tabelle 1 ist per Default aktiv; der Opcode `BTLTB` (0x4B) schaltet auf Tabelle 2 um** (`EncounterWidget.cpp:30`, `Opcode.h:771–773`).
- **PC und PSX identisch**, nur der Sektionsindex unterscheidet sich (PC 6, PSX 5).

> **Lücke:** `EncounterTableWidget` (das die Wahrscheinlichkeits-Budgetregel durchsetzt, z. B. ob die 10 Werte auf 64 aufsummieren müssen) liegt in **ff7tk**, nicht hier. Diese Regel ist aus diesem Repo **nicht** belegbar.

---

## 15. `maplist`

| Offset | Größe | Feld |
|---|---|---|
| 0 | u16 | `nbMap` |
| 2 | `nbMap × 32` | Feldnamen, 32 Byte, Latin-1, nullgepolstert |

`MapList.cpp:31–46`. Dateigröße muss **exakt** `2 + nbMap·32` sein (`:36–38`). Namen via `qstrnlen(…, 32)` + Whitespace-Normalisierung (`:45`). Nachlaufende **leere** Einträge werden beim Laden abgeschnitten (`:49–51`). Löschen ist ein **Soft-Delete** (Slot wird leerer String), damit spätere Indizes stabil bleiben (`:99–109`) — wichtig, weil `MAPJUMP`/Gateway-`fieldID` hier hineinindizieren.

---

## 16. `FIELD.TDB` — Gesichts-/Augen-/Mund-Texturen (PSX)

**Header (16 Byte)** (`TdbFile.h:23–29`, Prüfung `TdbFile.cpp:37–40`):

| Offset | Größe | Feld |
|---|---|---|
| 0 | u32 | Gesamtgröße (muss der Dateigröße entsprechen) |
| 4 | u16 | Bildanzahl |
| 6 | u16 | Palettenanzahl |
| 8 | u32 | Offset Bilddaten |
| 12 | u32 | Offset Paletten |

- **Bild:** 512 Byte bei `imageOffset + id·512`, **32 × 32 Pixel, 4 Bit indiziert**, ein Byte = zwei Pixel, **Low-Nibble zuerst** (`TdbFile.cpp:97`, `:108–119`).
- **Palette:** 32 Byte bei `paletteOffset + pal·32` = 16 PSX-16-Bit-Farben (`:101`, `:114–118`).
- Palettenwahl: `pal = min(faceID, paletteCount − 1)` (`:99`).
- `TextureType`: `Eye=0, EyeClosed1, EyeClosed2, EyeOpened1, EyeOpened2, MouthClosed, MouthOpened, Empty` (`TdbFile.h:34–40`).
- Bild-ID (`TdbFile.cpp:124–143`): `faceID ≤ 9` ⇒ `id = faceID·8 + type` (außer `Empty` ⇒ 126). `faceID ≥ 10` ⇒ Eye/EyeOpened* ⇒ `80 + (faceID−10)·2`; MouthOpened ⇒ `80 + (faceID−10)·2 + 1`; alles andere ⇒ **126**.
- **Bild 126 ist die kanonische Leerkachel.**

---

## 17. Field-Modelle (Actors) — Kernmaterial für S38

### 17.1 Sektion 3 „Model-Loader", PC

**Sektionskopf (6 Byte)** (`FieldModelLoaderPC.cpp:277–279`, Lesen `:140`):

| Offset | Größe | Feld |
|---|---|---|
| 0 | u16 | immer 0 (unbekannt/Version) |
| 2 | u16 | Modellanzahl |
| 4 | u16 | Field-Scale (aus Sektion 1 übernommen) |

**Quirk:** Beim Lesen wird Offset 4 **nie ausgewertet**; Makou holt den Scale aus Sektion 1 und nutzt ihn nur als Fallback (`:142`, `:172–174`). Mindestgröße 6 Byte.

**Modell-Record (48 + `len` Byte)** — `FieldModelLoaderPC.cpp:152–198`, Schreibseite `:243–260`:

| Offset | Größe | Feld |
|---|---|---|
| +0 | 2 | `len` = Länge des Modellnamens (**inkl. nachlaufender NULs**) |
| +2 | `len` | Modell-/Charaktername, Latin-1, bis zum ersten NUL |
| +2+len | 2 | unbekannt (pro Modell) |
| +4+len | 8 | **HRC-Name**, fix 8 Byte, NUL-gepolstert (z. B. `AAAA.HRC`) |
| +12+len | 4 | **Scale als ASCII-Dezimalziffern**, fix 4 Byte, NUL-gepolstert (z. B. `"512\0"`) |
| +16+len | 2 | Animationsanzahl |
| +18+len | 27 | 3 × 9-Byte-Richtungslicht |
| +45+len | 3 | globales Licht: R, G, B (je u8) |
| +48+len | var | Animationseinträge |

> **Die Modellskalierung ist als ASCII-Text gespeichert.** Einer der überraschendsten Fakten des Formats und leicht zu übersehen (`:169–175`, `:248`). Parse-Fehler ⇒ Fallback auf den Field-Scale.

**Richtungslicht (9 Byte):** +0 R, +1 G, +2 B, +3 `dirA`/X (i16), +5 `dirB`/Y (i16), +7 `dirC`/Z (i16) — `:185–191`, `:254–259`.

**Animationseintrag (4 + `len` Byte):** +0 `len` (u16), +2 Name (Latin-1, **ohne** `.a`-Endung), +2+len u16 unbekannt (Default 1) — `:211–224`. Der Loader hängt `.a` bzw. `.hrc` selbst an (`FieldModelFilePC.cpp:68–71`, `:89–96`).

**Grenzen:** max. 256 Modelle („auch wenn das Dateiformat mehr könnte, nützt es nichts, weil die Skripte nicht mehr adressieren können"), max. 255 Animationen („die PS-Version kann nicht mehr speichern") — `FieldModelLoader.h:54–57`.

⚠️ Makou-Schreibfehler nicht nachbauen: Die Namenslänge wird als `QString::size()` (UTF-16-Codeeinheiten) geschrieben, die Bytes stammen aber aus `toLocal8Bit()` (`:243–245`).

### 17.2 Sektion 3, PSX — völlig anderes Format

| Offset | Größe | Feld |
|---|---|---|
| 0 | u16 | Gesamtgröße der Sektion (**inkl.** dieser 4 Kopfbytes) |
| 2 | u16 | Modellanzahl |
| 4 | 8 × N | Records à 8 Byte |

Validierung: `size == data.size()`, `(size−4)/8 == modelCount`, `(size−4)%8 == 0` (`FieldModelLoaderPS.cpp:49–60`).

Record (alle u8, `FieldModelLoaderPS.h:28–29`): `faceID, bonesCount, partsCount, animationCount, unknown1, unknown2, unknown3, modelID`.

- **Keine Namen, kein Scale, keine Lichtfarben** — die liegen bei PSX im BSX-Modellkopf (`BsxFile.h:41–68`).
- `faceID` wählt Augen/Mund aus `FIELD.TDB` (gültig `< 0x21`).
- `modelID` 1..9 = spielbarer Charakter, sonst feldlokales Modell.
- **PSX-Bone-Anzahl = PC-Bone-Anzahl + 1** (`FieldModelLoaderPS.cpp:185`, `FieldModelFile.cpp:46–55`).

`modelID` → Charakter / BCX / PC-HRC (`FieldModelFilePS.cpp:66–76`, `FieldModelLoaderPS.cpp:171–179`):

| ID | Charakter | BCX | PC-HRC | PC-Anim (Stehen/Gehen/Rennen) |
|---|---|---|---|---|
| 1 | Cloud | `CLOUD.BCX` | `AAAA` | `ACFE/AAFF/AAGA` |
| 2 | Aerith | `EARITH.BCX` | `AUFF` | — |
| 3 | Barret | `BALLET.BCX` | `ACGD` | `ADCB/ADCC/ADCD` |
| 4 | Tifa | `TIFA.BCX` | `AAGB` | `ABCD/ABCE/ABCF` |
| 5 | Red XIII | `RED.BCX` | `ADDA` | `AEAE/AEAF/AEBA` |
| 6 | Cid | `CID.BCX` | `ABDA` | `ABIE/ABIF/ABJA` |
| 7 | Yuffie | `YUFI.BCX` | `ABJB` | `ACFB/ACFC/ACFD` |
| 8 | Cait Sith | `KETCY.BCX` | `AEBC` | `AEHA/AEHB/AEHC` |
| 9 | Vincent | `VINCENT.BCX` | `AEHD` | `AFDF/AFEA/AFEB` |

(Die Schreibfehler `EARITH`, `BALLET`, `YUFI`, `KETCY` stammen aus dem Spiel. Anim-Tabelle: `FieldModelLoaderPC.cpp:589–612`.) In PSX-Fields belegen diese die ersten 3 Animationsslots; feldspezifische Animationen beginnen bei Index 3 (`FieldModelLoaderPS.cpp:229`, `:248–250`).

### 17.3 HRC-Skelett (Textformat, `HrcFile.cpp`)

- Kopf: Zeilen werden gelesen, bis eine mit `:BONES ` beginnt; der Rest der Zeile ist die Bone-Anzahl (`:41–47`). `:BONES 0` wird auf 1 korrigiert („Null HRC fix", `:48–50`). Andere Kopfzeilen (`:HEADER BLOCK`, `:SKELETON`) werden ignoriert.
- Körper: strikt **4 Zeilen pro Bone**; Leerzeilen und `#`-Kommentare werden übersprungen **ohne** die Phase zu stören (`:80–85`):

| Zeile | Inhalt | Verarbeitung |
|---|---|---|
| 0 | Bone-Name | mit laufendem Index registriert |
| 1 | Name des Eltern-Bones | über Namenstabelle aufgelöst; unbekannt bzw. `root` ⇒ **−1** |
| 2 | Bone-Länge | `size = −länge / 132.0` — **negiert und durch `MODEL_SCALE_PC` geteilt** |
| 3 | RSD-Liste `anzahl name1 name2 …` | nur übernommen, wenn Anzahl > 0 und Tokenzahl exakt passt |

`:87–119`; `MODEL_SCALE_PC = 132.0f` in `PFile.h:24`. Tabelle vorbelegt mit `"root" → −1` (`:76`). Bone-Index = Reihenfolge im File; **jeder Elternteil steht vor seinen Kindern** (setzt der Renderer voraus). Erfolg erfordert `boneID == boneCount` exakt (`:122`). Ein Bone kann **mehrere** RSD-Teile tragen (`QMultiMap`, `:111`). Ein-Bone-Skelette gelten als gültig und brauchen keine `.a` (`FieldModelFile.cpp:41`).

### 17.4 RSD-Datei (Textformat, `RsdFile.cpp:29–86`)

| Schlüssel | Bedeutung |
|---|---|
| `PLY=` / `MAT=` / `GRP=` | alle drei gleichwertig: Basisname des Meshes. Alles ab dem **letzten Punkt** abgeschnitten, Rest kleingeschrieben ⇒ `.p`-Dateiname. Nur die **erste** solche Zeile zählt. |
| `NTEX=` | Texturanzahl (dezimal), nur einmal gültig, nur nach einer PLY/MAT/GRP-Zeile |
| `TEX[i]=` | genau `NTEX` Folgezeilen; jede muss buchstäblich mit `TEX[i]=` für den laufenden Index beginnen, sonst Fehler. Endung abgeschnitten, kleingeschrieben. |

**Textur-ID-Vergabe:** Jeder Texturname wird in einer **modellweiten** Namensliste gesucht und ggf. angehängt. Das RSD hält damit eine Liste **absoluter Modell-Textur-IDs** in RSD-lokaler Reihenfolge (`:71–77`). Kette: HRC-Bone → RSD (+`.rsd`) → `.p`-Mesh + Texturnamen (+`.tex`).

### 17.5 `.P`-Mesh (binär, Little Endian)

**Header: fix 128 Byte** (`PFile.h:26–44`, gelesen `PFile.cpp:59`).

| Offset | Feld | Prüfung |
|---|---|---|
| 0x00 | `version` | muss 1 sein |
| 0x04 | `off04` | muss 1 sein |
| 0x08 | `vertexType` | muss ≤ 1 sein |
| 0x0C | `numVertices` | |
| 0x10 | `numNormals` | |
| 0x14 | `numUnknown1` | 12-Byte-Records |
| 0x18 | `numTexCs` | |
| 0x1C | `numVertexColors` | |
| 0x20 | `numEdges` | |
| 0x24 | `numPolys` | |
| 0x28 | `numUnknown2` | **wird nie gelesen** |
| 0x2C | `numUnknown3` | **wird nie gelesen** |
| 0x30 | `numHundreds` | |
| 0x34 | `numGroups` | |
| 0x38 | `numBoundingBoxes` | |
| 0x3C | `normIndexTableFlag` | **ignoriert** — Tabelle wird immer gelesen |
| 0x40 | `runtime_data[16]` | 64 Byte Engine-Scratch |

**Tabellen direkt hintereinander, in genau dieser Reihenfolge** (`PFile.cpp:65–153`):

| # | Tabelle | Anzahl | Recordgröße | Aufbau |
|---|---|---|---|---|
| 1 | Vertices | `numVertices` | 12 | 3 × f32; **beim Laden durch 132.0 geteilt** |
| 2 | Normalen | `numNormals` | 12 | 3 × f32, **nicht** skaliert |
| 3 | unknown1 | `numUnknown1` | 12 | opak |
| 4 | Texcoords | `numTexCs` | 8 | 2 × f32, bereits 0..1 normalisiert |
| 5 | Vertexfarben | `numVertexColors` | 4 | **BGRA** (blue, green, red, alpha) |
| 6 | Polygonfarben | `numPolys` | 4 | gelesen und **verworfen** |
| 7 | Kanten | `numEdges` | 4 | 2 × u16 Vertexindizes |
| 8 | Polygone | `numPolys` | 24 | s. u. |
| 9 | „Hundreds" | `numHundreds` | 100 | Renderstate, s. u. |
| 10 | Gruppen | `numGroups` | 56 | s. u. |
| 11 | Bounding Boxes | `numBoundingBoxes` | 28 | u32 + 6 × f32 (max/min xyz) |
| 12 | Normal-Index-Tabelle | `numVertices` | 4 | u32/Vertex, gelesen aber ungenutzt |

**Polygon (24 Byte, `PFile.h:50–54`):** `u16 zero`, `u16 VertexIndex[3]`, `u16 NormalIndex[3]`, `u16 EdgeIndex[3]`, `u16 u[2]` — immer Dreiecke.

**„Hundred" (100 Byte = 25 × u32, `PFile.h:60–86`):** Renderstate mit u. a. `texture_id`, `texture_set`, `shademode`, `lightstate_ambient`, `lightstate_material_pointer`, `srcblend`, `destblend`, `alpharef`, `blend_mode`, `zsort`, `vertex_alpha`. **Von Makou geparst, aber nicht angewendet** — für WebMidgar potenziell die Quelle für korrektes Alpha-Blending von Field-Modellen.

**Gruppe (56 Byte = 14 × u32, `PFile.h:88–103`):** `primitiveType`, `polygonStartIndex`, `numPolygons`, `verticesStartIndex`, `numVertices`, `edgeStartIndex`, `numEdges`, `u1..u4`, `texCoordStartIndex`, `areTexturesUsed`, `textureNumber`.

**Auflösungsregeln (tragend, `PFile.cpp:158–204`):**

- Textur nur wenn `areTexturesUsed != 0` **und** `textureNumber < texIds.size()`; `textureNumber` indiziert die **RSD-lokale** Liste und liefert die absolute Modell-Textur-ID.
- Vertex: `vertices[g.verticesStartIndex + poly.VertexIndex[j]]`
- Vertexfarbe: **derselbe Index wie der Vertex** — die Farbtabelle ist parallel zur Vertextabelle. Ein Vertex wird verworfen, wenn er in *einer* der beiden Tabellen out of range ist.
- Texcoord: `texCs[g.texCoordStartIndex + poly.VertexIndex[j]]` — benutzt den **Polygon-Vertexindex**; es gibt keinen separaten UV-Index.
- `NormalIndex`, `EdgeIndex`, `poly.u[2]`, `primitiveType` bleiben ungenutzt.

**Skalenkonstanten:** `MODEL_SCALE_PC = 132.0f` (`PFile.h:24`), `MODEL_SCALE_PS = 4096.0f` (`BsxFile.h:26`). PC-Divisor 132 gilt für (a) `.p`-Vertices, (b) HRC-Bone-Längen (negiert), (c) `.a`-Root-Translationen. PSX-Translationen werden zusätzlich **negiert**.

### 17.6 `.A`-Animation (binär)

**Header: 36 Byte** (`AFile.h:23–30`, gelesen `AFile.cpp:36`):

| Offset | Größe | Feld |
|---|---|---|
| 0x00 | 4 | `version` (als 1 geschrieben, beim Lesen **nicht geprüft**) |
| 0x04 | 4 | `framesCount` (muss ≠ 0) |
| 0x08 | 4 | `boneCount` |
| 0x0C | 3 | `rotationOrder[3]`, geschrieben als `{1, 0, 2}` |
| 0x0F | 1 | ungenutzt |
| 0x10 | 20 | `runtimeData[5]`, Nullen |

**Frame-Stride = `24 + 12 × boneCount` Byte** (Plausibilitätsprüfung `AFile.cpp:38`).

Pro Frame (`:62–86`):

| Reihenfolge | Größe | Inhalt |
|---|---|---|
| 1 | 12 | 3 × f32 — Rotationsvektor („initialRot"). Makou überschreibt ihn **in jedem Frame**, nur der letzte überlebt; fließt nicht in die Bone-Rotationsliste ein und wird beim Rendern nicht genutzt. |
| 2 | 12 | 3 × f32 **Root-Translation** x,y,z — beim Laden **/132**, beim Speichern ×132 |
| 3 | 12 × boneCount | 3 × f32 pro Bone, Rotationen in HRC-Bone-Reihenfolge |

**Winkelkodierung:** PC = IEEE-f32 in **Grad** (direkt an `QMatrix4x4::rotate`, `3d/FieldModel.cpp:282–284`). PSX = 8-Bit-Binärwinkel, umgerechnet mit `360 · wert / 256` ⇒ **256 Einheiten = volle Umdrehung** (`BsxFile.cpp:779`, `:796`, `:813`).

**Rotationsreihenfolge:** `{1,0,2}` entspricht der Anwendungsreihenfolge **Y, dann X, dann Z** (`3d/FieldModel.cpp:282–284`). Mit Qt-Spaltenvektorkonvention und Postmultiplikation: `M ← M · Ry · Rx · Rz`. Der Parser verzweigt **nicht** auf `rotationOrder`; `{1,0,2}` ist beim Schreiben fest verdrahtet.

**PSX↔PC-Bone-Versatz:** `FieldModelAnimation::toPC` entfernt aus jedem Frame die Rotation des ersten PS-Bones und befördert die Rotation von Frame 0 zu `initialRot` (`FieldModelAnimation.cpp:75–89`) — bestätigt, dass die 12 führenden Bytes je PC-Frame der zusätzliche „Root"-Bone sind, den PSX als Bone 0 führt.

### 17.7 Skelett-Traversierung und Platzierung im Field

**Traversierung** (`3d/FieldModel.cpp:238–300`):

- Sonderfall `boneCount ≤ 1`: Bone 0 direkt zeichnen, keine Matrixarbeit.
- Sonst expliziter Stack, initialisiert mit `−1` (Root-Sentinel aus dem HRC). Für Bone `i`: so lange poppen, bis `stack.top() == bone.parent()`, dann `i` + aktuelle Matrix pushen. Funktioniert für beliebige Verzweigungen.
- **Translationsreihenfolge ist plattformabhängig** (`translateAfter()`): **PSX translatiert vor** Rotation/Zeichnen, **PC translatiert nach** dem Zeichnen (`FieldModelFilePC.h:30`, `FieldModelFilePS.h:40–42`, `3d/FieldModel.cpp:276–278`, `:291–293`).
- Bones erstrecken sich entlang der lokalen **+Z**-Achse; da HRC-Längen beim Laden negiert werden, ist die tatsächliche Verschiebung entlang lokal **−Z**.
- Rotation Y → X → Z.

**Platzierung im Field** (`3d/WalkmeshWidget.cpp:344–377`):

1. `translate(x/4096, y/4096, z/4096)`
2. `rotate(270°, X-Achse)`
3. `rotate(−360 · direction / 256, Y-Achse)` — Richtung ist ein **Byte-Winkel, 256 = volle Umdrehung, negiert**
4. Zeichnen mit hartkodiertem Scale `8.0f` — **der Per-Modell-Scale aus Sektion 3 wird von Makou ignoriert**; nur Frame 0 wird gezeichnet.

Richtung wird aus dem **ersten** `DIR`-Opcode mit `banks == 0` in Skript 0 jeder Model-Gruppe gescrapt (`WalkmeshWidget.cpp:329–342`); ohne solchen Opcode entfällt Schritt 3.

### 17.8 `char.lgp` und Texturreferenzen

- Standardpfad `<FF7-Data>/field/char.lgp` (`Data.cpp:360–368`). **Alle Lookups werden kleingeschrieben** (`CharArchive.cpp:104–107`).
- Endungen: `.hrc`, `.rsd`, `.p`, `.tex`, `.a`.
- HRC-Index-Schlüssel: `u64(boneCount) | (u64(partCount) << 32)`, `partCount` = Gesamtzahl aller RSDs über alle Bones (`CharArchive.cpp:136–143`).
- Animationsindizes: nach `boneCount` allein und nach `u64(boneCount) | (u64(framesCount) << 32)` (`:180–181`).
- **Animationen mit `boneCount == 0` passen zu jedem Modell** (`ModelManagerPC.cpp:359–361`).
- Empirische Bone-Anzahl → Beispielanimation (Plausibilitätstabelle, `ModelManagerPC.cpp:294–312`): 5:`avhd`, 9:`geaf`, 11:`bdfe`, 12:`atcf`, 13:`bria`, 14:`fgad`, 15:`gcad`, 17:`hkga`, 18:`gsia`, 20:`FZGB`, 23:`anhd`, 24:`abcd`, 25:`afdf`, 26:`hlfb`, 27:`fhhb`, 28:`aeha`, 29:`aeae`.

**Texturreferenzen:**

| Plattform | Record | Identifier |
|---|---|---|
| PC | einzelne u32 `id` = absoluter Index in die Modell-Texturnamensliste | == id |
| PSX | `type` (u8), `bpp` (u8), `imgX`, `imgY`, `palX`, `palY` (je u16) | gepackt aus imgX/64 (4 Bit), imgY/256 (1 Bit), palX/16 (6 Bit), palY (9 Bit), type (6 Bit), bpp (2 Bit) |

`FieldModelTextureRefPC.h:26–39`, `FieldModelTextureRefPS.h:99–158`. PSX-`type`: **0 = Auge, 1 = Mund, ≥ 2 = normal** (`:160`). `bpp`: 0 = 4 bpp, 1 = 8 bpp (`:49–52`). PSX-Texturen sind 16-Bit, `width·height·2` Byte, mit VRAM-Rechtecken.

> ⚠️ Der PSX-Textur-Bitmaskenblock (`BsxFile.cpp:365–375`) trägt den Credit „Many thanks to Akari for his work." (`FieldModelTextureRefPS.h:18`) — **Fremd-Reverse-Engineering**, nicht wörtlich übernehmen.

### 17.9 Licht

- Pro Modell: **3 Richtungslichter + 1 globales (Ambient-)Licht** (`FieldModelLoader.h:24–43`).
- Richtungskomponenten signed 16 Bit, im UI als X/Y/Z beschriftet (`ModelColorsLayout.cpp:67–70`, `:28`). Genau 3 Records werden erwartet (`:87–89`).
- Modell-Scale im UI: Bereich 0..4096, Label „Model size" (`ModelManager.cpp:44–45`).
- PSX legt dieselben Daten im BSX-Modellkopf ab; Makou sortiert sie explizit in PC-Reihenfolge um (`BsxFile.cpp:75–88`).
- **Keine dieser Lichtdaten wird von Makou zum Shading benutzt** — der Shader kennt keine Beleuchtung, `globalColor` ist auf Weiß gestubbt (`3d/FieldModel.cpp:244–252`). Für WebMidgar **offenes Terrain**.

### 17.10 Renderer-/Shader-Details (Referenz, kein Format)

- Vertexlayout: `position` vec4, `color` vec4, `texcoord` vec2 ⇒ **40 Byte Stride**, Offsets 0/16/32 (`3d/Renderer.h:32–36`, `Renderer.cpp:151–155`).
- GL-State: Tiefentest `LEQUAL`, **Face-Culling aus**, Blending nur bei gebundener Textur (`SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA`) (`Renderer.cpp:93–98`, `:257–258`).
- Texturfilter: Minification `NearestMipMapLinear`, Magnification `Nearest` (`:246–252`).
- Hintergrund wird als Vollbild-Quad mit Identitäts-MVP gezeichnet, UVs (0,1)/(0,0)/(1,1)/(1,0), Indizes `0,1,2, 1,3,2` (`WalkmeshWidget.cpp:403–440`).
- **Fragmentshader-Quirk:** Die Textur wird **nur** gesampelt, wenn `v_texcoord.x > 0 || v_texcoord.y > 0`; `discard` bei Alpha 0 (`qt/shaders/main.frag:12–24`). Ein legitimes UV von exakt (0,0) rendert damit untexturiert. Untexturierte Geometrie wird CPU-seitig genau so signalisiert. **Nicht nachbauen — sauber über ein Flag lösen.**
- Quads werden als Fan trianguliert: `{0, j+1, j+2}` (`3d/FieldModel.cpp:114–115`); `QuadPoly` tauscht Vertex 2 und 3 „für die richtige OpenGL-Quad-Reihenfolge" und spiegelt den Tausch in Farben und Texcoords (`FieldModelPart.cpp:87–113`).

### 17.11 Bekannte Makou-Bugs (nicht replizieren)

| Bug | Beleg |
|---|---|
| `.A`-`initialRot` wird bei jedem Frame überschrieben ⇒ verlustbehafteter Round-Trip | `AFile.cpp:67` vs. `:116–118` |
| PSX-Translations-Fallback prüft `frameTrans.tx != 0xFF` auch in den **ty**- und **tz**-Zweigen | `BsxFile.cpp:859`, `:885` |
| `IdFile::initEmpty` schreibt „oben"-Nachbarn auch für die oberste Reihe ⇒ negative Nachbarindizes | `IdFile.cpp:69–74` |
| `EncounterFile::setBattleEnabled` überschreibt das ganze Byte statt nur Bit 0 | `EncounterFile.cpp:85` |
| `editArrowType` speichert den Combobox-Index statt des Datenwerts | `WalkmeshManager.cpp:1420–1424` |
| `BackgroundTiles::shiftPalettes` weist `min(palID + steps, 255)` statt `tile.paletteID + steps` zu | `BackgroundTiles.cpp:387–394` |

### 17.12 Nicht implementiert / TODO in Makou

`HrcFile::write`, `RsdFile::write`, `PFile::write`, `FieldModelAnimation::toPS`, `BackgroundTexturesPS::toPC`-Gegenrichtung sind Stubs. PSX→PC-Modell-/Animationszuordnung ist explizit `// FIXME: approximation` (Heuristik über die maximale Zahl gemeinsamer Rotationen/Farben). Der **PS-Tile-Writer gibt am Ende immer `false` zurück** (`BackgroundTilesIO.cpp:991`) — PS-Tile-Speichern ist unfertig.

## 18. Hintergrund — Sektion 9 (PC) — **Kernmaterial für S39**

> **Vorab-Korrektur:** `BsxFile`/`BcxFile` sind **keine** Hintergrunddateien, sondern PSX-**Modell**archive; `PFile` ist PC-Modellgeometrie. PSX-Hintergrunddaten liegen in **`.MIM`** (Paletten + Texturseiten) plus **Field-Sektion 3** (Tiles).

Alle Offsets unten sind relativ zum **ersten Byte nach** dem 4-Byte-Sektionslängenpräfix.

### 18.1 Container (`BackgroundIO.cpp:130–182` schreibt, `:60–128` liest)

| Offset | Größe | Feld | Bemerkung |
|---|---|---|---|
| 0 | 2 | Nullen | |
| 2 | 2 | `depth` u16 | geschrieben als **2** wenn keine Paletten, sonst **1**; **Reader ignoriert es** |
| 4 | 1 | `isEnabled` u8 | immer 1 |
| 5 | 7 | Magic `"PALETTE"` | |
| 12 | 20 | **Palettentransparenz-Flags**, 1 Byte je Palette, max. 20 | `PaletteIO.h:24`, gelesen `PaletteIO.cpp:120–145` |
| 32 | 4 | Nullen | |
| 36 | 4 | Magic `"BACK"` | |
| 40 | … | Tile-Unterabschnitte Layer 1..4 | s. 18.3 |
| … | 7 | Magic `"TEXTURE"` | beim Lesen nur übersprungen (`BackgroundIO.cpp:91`) |
| … | … | Texturseiten | s. 18.6 |
| Ende | 3 | Magic `"END"` | |

**Reader-Quirk:** Makou **validiert kein einziges Magic**. `BackgroundTilesIOPC::readData` springt hart auf absolut 44 (erste Tile-Anzahl) und absolut 52 (erste Kachel) (`BackgroundTilesIO.cpp:72`, `:82`).

### 18.2 PC-Kachel: 40-Byte-Struct in 52-Byte-Schrittweite

⚠️ Der Kommentar `//Sizeof : 36` an `TilePC` (`BackgroundTilesIO.h:30`) ist **falsch** — mit 4-Byte-Alignment sind es **40 Byte**, `IDBig` liegt auf Offset 36 (nicht 32 wie der Inline-Marker sagt). Bestätigt durch `writeTile`: 2 + 40 + 4 + 4 + 2 = 52 Byte (`BackgroundTilesIO.cpp:269–283`).

| Off | Größe | Feld | Bedeutung |
|---|---|---|---|
| 0 | 2 | `dstX` i16 | Zielposition X (Bildschirmraum, vorzeichenbehaftet) |
| 2 | 2 | `dstY` i16 | Zielposition Y |
| 4 | 4 | `unused1` u32 | unbekannt |
| 8 | 1 | `srcX` u8 | Quell-X in der Texturseite |
| 9 | 1 | ungenutzt | |
| 10 | 1 | `srcY` u8 | |
| 11 | 1 | ungenutzt | |
| 12 | 1 | `srcX2` u8 | **zweites** Quell-X — genutzt statt `srcX`, wenn `layerID > 0 && blending` |
| 13 | 1 | ungenutzt | |
| 14 | 1 | `srcY2` u8 | dito |
| 15 | 1 | ungenutzt | |
| 16 | 2 | `width` u16 | „normalerweise ungenutzt"; Writer schreibt 0 für Layer 0, sonst Kachelgröße |
| 18 | 2 | `height` u16 | dito |
| 20 | 1 | `paletteID` u8 | |
| 21 | 1 | ungenutzt | |
| 22 | 2 | `ID` u16 | **der Z-/Tiefenschlüssel** |
| 24 | 1 | `param` u8 | **Hintergrund-Parameter-ID (Animation)** |
| 25 | 1 | `state` u8 | **Bitmaske** `1 << stateID`, kein State-Index |
| 26 | 1 | `blending` u8 | boolesches Flag |
| 27 | 1 | `unknown7` u8 | Round-Trip erhalten, nie interpretiert |
| 28 | 1 | `typeTrans` u8 | Blend-Modus 0..3 |
| 29 | 1 | ungenutzt | |
| 30 | 1 | `textureID` u8 | Texturseiten-Index 0..41 |
| 31 | 1 | ungenutzt | |
| 32 | 1 | `textureID2` u8 | genutzt statt `textureID`, wenn `layerID > 0 && blending` |
| 33 | 1 | ungenutzt | |
| 34 | 1 | `depth` u8 | **0 = 4 bpp, 1 = 8 bpp paletted, 2 = 16 bpp direct** |
| 35 | 1 | ungenutzt | |
| 36 | 4 | `IDBig` u32 | feingranulares, float-kodiertes Z |
| 40 | 4 | `srcXBig` u32 | `(srcX2 ? srcX2 : srcX)/256 · 10 000 000` |
| 44 | 4 | `srcYBig` u32 | `(srcY2 ? srcY2 : srcY)/256 · 10 000 000` |
| 48 | 2 | Nullen | Nachlauf-Padding dieses Records |
| 50 | 2 | Nullen | Vorlauf-Padding des *nächsten* Records — deshalb beginnt der erste Struct bei 52, nicht 50 |

**Es gibt kein 20-Byte-PC-Kachelformat.** Die kleineren Records (8/10/14 Byte) sind die PSX-Varianten (s. 18.8).

**Plausibilitätsklemme:** Kacheln mit `|dstX| >= 1024` oder `|dstY| >= 1024` werden verworfen (`MAX_TILE_DST = 1024`, `BackgroundTilesIO.h:28`).

### 18.3 Die vier Layer-Unterabschnitte (PC)

Reader `BackgroundTilesIO.cpp:62–267`, Writer `:415–517`.

**Layer 1 (`layerID` 0) — kein „exists"-Byte**, beginnt bei absolut 40:

| Abs. Offset | Größe | Feld |
|---|---|---|
| 40 | 2 | `width` u16 — Writer: `cameraRange.right − left + 16` |
| 42 | 2 | `height` u16 — `bottom − top + 16` |
| 44 | 2 | `nbTiles1` u16 |
| 46 | 2 | `depth` u16 |
| 48 | 4 | Nullen (+ Record-Vorlauf) |
| 52 | 52·n | Kachel-Records |

Nächster Block bei `52 + 52·nbTiles1`.

**Layer 2 (`layerID` 1):** +0 `exists` u8 (**Writer schreibt immer 1**: „Tiles 2 is always enabled, no matter if there are tiles or not", `:449`); +1 width (640); +3 height (480); +5 `nbTiles2`; +7 **16 Byte `HeaderLayer2TilePC`**; +23 4 Byte Nullen; +27 Records.

**Layer 3 (`layerID` 2):** +0 `exists` u8 (**gesetzt, wenn Layer 3 *oder* Layer 4 Kacheln hat**: „When tiles 4 is enabled, tiles 3 is enabled too, even without tiles in it", `:473`); +1 width; +3 height; +5 `nbTiles3`; +7 10 Byte Nullen; +17 4 Byte Nullen; +21 Records.

**Layer 4 (`layerID` 3):** +0 `exists` u8; +1 width; +3 height; +5 `nbTiles4`; +7 2 Byte Nullen; +9 **8 Byte `HeaderLayer4TilePC`**; +17 4 Byte Nullen; +21 Records.

Ist `exists == 0`, ist der gesamte Block **exakt 1 Byte** lang.

`HeaderLayer2TilePC` (16 Byte = 8 × u16, `BackgroundTilesIO.h:53–62`): `firstPalettedTextureId`, `nextPalettedTextureId`, `firstPalettedBlendingTypeTransTextureId`, `nextPalettedBlendingTypeTransTextureId`, `firstDirectColorTextureId`, `nextDirectColorTextureId`, `firstDirectColorBlendingTypeTransTextureId`, `nextDirectColorBlendingTypeTransTextureId`. **Der Reader ignoriert diesen Header vollständig**; Makou regeneriert ihn beim Schreiben aus Min/Max über die Textur-IDs je Klasse (`BackgroundTilesIO.cpp:285–413`).

⚠️ `HeaderLayer4TilePC` ist mit `//Sizeof : 10` kommentiert (`BackgroundTilesIO.h:64`), enthält aber 4 × u16 = **8 Byte** und wird mit Länge 8 geschrieben (`:506`). **Stale Comment — nicht übernehmen.**

### 18.4 Layer-abhängige Feldinterpretation (`tilePC2Tile`, `BackgroundTilesIO.cpp:519–561`)

| Aspekt | Layer 1 (0) | Layer 2 (1) | Layer 3 (2) | Layer 4 (3) |
|---|---|---|---|---|
| `param`, `state`, `blending` | **auf 0 gezwungen** (lesend `:540`, schreibend `:582–584`) | aus Datei | aus Datei | aus Datei |
| Quell-/Texturwahl | immer `srcX/srcY/textureID` | `srcX2/srcY2/textureID2` bei `blending` | dito | dito |
| `ID` (Z) | **fest 4095** | Dateiwert (0..4095) | **fest 4096** | **fest 0** |
| Kachelgröße | 16 | 16 | 32 | 32 |
| `IDBig` | aus Datei | aus Datei | 0 | 0 |

> **Layer 1 kann nie animiert werden** — das ist eine harte Formateigenschaft, keine Makou-Vereinfachung.

`ret.textureY = tile.textureID2` beim Lesen (`:549`) — auf PC wird `textureY` als „Texturgruppen"-Index zweckentfremdet, es ist **kein** PS-Seiten-Y.

### 18.5 Z-/Prioritätsordnung — der exakte Sortierschlüssel

`BackgroundTiles` ist eine `QMultiMap<qint32, Tile>`; die aufsteigende Schlüsselreihenfolge **ist** die Zeichenreihenfolge (`BackgroundFile.cpp:99`). Kanonischer Schlüssel:

> **key = 4096 − tile.ID** (`BackgroundTiles.h:107–109`)

| Layer | ID | key | Zeichenposition |
|---|---|---|---|
| 3 (`layerID` 2) | 4096 | 0 | zuerst / ganz hinten |
| 1 (`layerID` 0) | 4095 | 1 | Hintergrundplatte |
| 2 (`layerID` 1) | per Kachel | 4096 − ID | **verschachtelt nach Tiefe** |
| 4 (`layerID` 3) | 0 | 4096 | zuletzt / vorderstes Overlay |

**Layer-2-Kacheln verschachteln sich also über ihr eigenes `ID` mit der Layer-1-Platte.** Ein `ID` von 4095 zeichnet auf demselben Schlüssel wie Layer 1; kleinere IDs zeichnen später (davor). Das UI nennt das eine „Section" (`BGDialog.cpp:251–257`) und zeigt `ID` als „Depth (Z)", editierbar **nur für Layer 2** (`BackgroundTileEditor.cpp:69`, `:266–274`).

**Z-Override durch `BGPDH`:** Für Layer 2/3 wird der Schlüssel zu `4096 − (z[layerID−2] != −1 ? z[layerID−2] : tile.ID)` (`BackgroundTiles.cpp:176`). **`BGPDH` sortiert also einen ganzen Layer gegen die Layer-1/2-Tiefenabschnitte um.** Defaults ohne `BGPDH`: Layer 3 → 4096, Layer 4 → 0 (`BGDialog.cpp:344–353`); Z-Bereich im UI 0..4096.

`IDBig` (feines Z, „Depth fine tune") — Ableitung `Tile::calcIDBig` (`BackgroundTiles.cpp:22–100`): `layerID ≥ 2` → 0; `ID == 0` → 999; `ID < 50` → 10000·ID; `ID ≥ 4095` → 9 998 999; sonst **Näherung** `(ID/4096)·10 000 000` mit `// FIXME: approximation`. **Der exakte `IDBig`-Wert ist ein Kameraprojektionsergebnis und in diesem Projekt ungelöst** (siehe Kontaminationswarnung in Abschnitt 12.4).

Weitere Ordnungsschlüssel (nur für Speichern/Validieren, nicht fürs Zeichnen): Dateireihenfolge `(layerID << 28) | tileID` (`:190–192`); Identität `(layerID << 16) | tileID` (`:298`). `checkOrdering()` erwartet die Originalreihenfolge des Spiels je Layer als `(paletteID<<20)|(dstY<<10)|dstX` für Layer 1 und `(dstY<<20)|(dstX<<10)|param` für Layer 2–4 (`:650–657`) — **das ist eine sehr nützliche Verifikationsregel für einen eigenen Parser.**

### 18.6 Paletten

**Container (beide Plattformen), `PaletteIO.cpp:29–81`** — 12-Byte-MIM-Kopf + N × 512 Byte:

| Off | Größe | Feld |
|---|---|---|
| 0 | 4 | `size` = 12 + 512·palH |
| 4 | 2 | `palX` (0) |
| 6 | 2 | `palY` (480) |
| 8 | 2 | `palW` (256) |
| 10 | 2 | **`palH` = Palettenanzahl** |
| 12 | 512·palH | Paletten |

Jede Palette = **256 Einträge × 2 Byte**. Eintragsformat (`Palette.cpp:36–47`):

- Bits 0..14: PSX-BGR555-Farbe (Konvertierung via `PsColor::fromPsColor` aus **ff7tk**, hier nicht verifizierbar)
- **Bit 15 = `mask`** (PSX-STP-/Semitransparenz-Bit), separat gespeichert und beim Speichern verbatim wiederhergestellt: `(toPsColor(color) & 0x7FFF) | (mask << 15)` (`Palette.cpp:55–56`)
- **`isZero` = das gesamte 16-Bit-Wort == 0** (`Palette.cpp:43`) — die PSX-Konvention „transparentes Schwarz"

**Plattformunterschied bei Transparenz (der subtile Teil):**

| | PS (`PalettePS`) | PC (`PalettePC`) |
|---|---|---|
| `isZero(i)` | Wort == 0 für diesen Index | **`i == 0 && _transparency`** (`Palette.cpp:112–115`) — nur Index 0 kann transparent sein, und nur wenn das Flagbyte der Palette gesetzt ist |
| `color(i)` | roh | war das Rohwort 0, wird stattdessen **`color(0)`** zurückgegeben (`Palette.cpp:104–110`) |
| Per-Paletten-Flag | keins | 1 Byte bei Sektion-9-Offset `12 + palID`, max. 20 Paletten |

Beim Zeichnen wird ein paletted Pixel **nur** geschrieben, wenn `palette->notZero(index)` (`BackgroundFile.cpp:140`). Max. 256 Paletten im Editor.

> **Wichtig:** Auf PC kommen die Paletten**farben** aus **Sektion 4**, die **Flags** aus **Sektion 9 Offset 12** — zwei verschiedene Sektionen (`BackgroundFilePC.cpp:89–90`, `BackgroundIO.cpp:60–73`).

### 18.7 Texturseiten (PC)

Direkt nach dem `"TEXTURE"`-Magic folgen **exakt 42 Slots** (`BACKGROUND_TEXTURE_PC_MAX_COUNT`, `BackgroundTextures.h:26`), je:

| Größe | Feld |
|---|---|
| 2 | `exists` u16 |
| 2 | `isBigTile` u16 (0 → 16×16-Kacheln, 1 → 32×32) — **nur wenn `exists`** |
| 2 | `depth` u16 — nur wenn `exists` |
| `depth==0 ? 32768 : depth·65536` | Pixeldaten |

Seiten sind immer **256 × 256 Pixel**. Datengröße: 4 bpp → 32768, 8 bpp → 65536, 16 bpp → 131072. Zeilenschrittweite in Byte = `depth==0 ? 128 : depth·256` (`BackgroundTextures.cpp:282–285`).

Kachel-Pixeladressierung: `origin = texPos(textureID) + (srcY·256 + srcX) · depth` (`BackgroundTextures.cpp:298–304`).

⚠️ **Bug:** Für `depth == 0` (4 bpp) macht `· depth` den Offset zu 0. Kommentar: „When tile.depth is used, it can be buggy, because the PC version doesn't understand depth = 0" (`:289–291`). Die effektive Tiefe wird deshalb aus dem **Texturkopf** genommen, nicht aus der Kachel, sobald die Textur existiert (`:292–295`).

**Texturslot-Klassen (`TextureGroups`, `BackgroundTextures.h:96–117`)** — die Engine leitet den Rendermodus aus dem **Index-Bereich** ab:

| Bereich | Klasse |
|---|---|
| 0–14 (15) | Paletted, kein Blending |
| 15–23 (9) | Paletted + Blending (`typeTrans != 0`) |
| 24–25 (2) | Paletted + Blending „Average" (`typeTrans == 0`) |
| 26–32 (7) | Direct Color (16 bpp) |
| 33–39 (7) | Direct Color + Blending |
| 40–41 (2) | Direct Color + Blending Average |

Klassenwahl aus einer Kachel: `BackgroundTexturesPC::textureGroup` (`BackgroundTextures.cpp:535–570`), abhängig von `depth==2`, `blending`, `layerID` (2/3 gesondert) und `typeTrans==0`.

> **Konsequenz:** Auf PC ist der Blend-Modus **teilweise über den Texturindex kodiert**, nicht nur über das `typeTrans`-Feld. Makou dokumentiert außerdem, dass die Engine zwei dieser Grenzen **nicht streng prüft**, sodass „paletted blended average" nach 33–41 und „direct color" nach 0–14 überlaufen kann (`BackgroundFilePC.cpp:348–368`).

**Direct-Color-Dekodierung (16 Bit) auf PC** — `BackgroundTextures.cpp:306–335`, ein echter Load-Bearing-Quirk:

- `color == 0x0000` → **vollständig transparent**
- `color == 0x0821` → **opakes Schwarz** (Sonderfall; `fromQRgb` bildet opakes Schwarz zurück auf `0x0821` ab)
- sonst: `b = color & 31`, `g = (color >> 6) & 31`, `r = color >> 11` — **Bit 5 (0x20) wird übersprungen**, „special PC RGB16"
- 5→8-Bit-Expansion: `(v << 3) + (v >> 2)`

⚠️ Der auskommentierte Block bewahrt die **offizielle, aber fehlerhafte PC-Port-Formel** `(color & 0x1F) | ((color & 0x7E0) >> 1) | ((color & 0xF800) >> 1)` mit dem Kommentar, sie sei buggy weil zwei Farben überlappen (`:312–313`). **Nicht als korrekt übernehmen.**

### 18.8 PSX-Hintergrund (Field-Sektion 3 + `.MIM`)

Parser `BackgroundTilesIOPS::readData` (`BackgroundTilesIO.cpp:600–840`).

**Kopf:** 4 × u32 absolute Offsets `start1..start4` bei 0/4/8/12. Sind sie nicht monoton steigend (oder überschreitet `start4` die Dateigröße), wird die Datei als **Demo-Format** mit nur 3 Offsets (12-Byte-Kopf) reinterpretiert und `start4 = fileSize` gesetzt (`:609–637`).

**Index-/Markerstrom** — `[16 (bzw. 12 bei Demo), start1)`, in 2-Byte-Schritten durchlaufen (`:637–672`):

| Marker | Bedeutung |
|---|---|
| `0x7FFF` | **Layer-Trenner** (2 Byte) |
| `0x7FFE` | **Zeilen-(dstY-)Trenner**; `tilePos`/`tileCount` werden aus den **vorangehenden** 4 Byte gelesen (6 Byte gesamt) |
| sonst | Run-Deskriptor: `{dstX i16 @+0, tilePos u16 @+2, tileCount u16 @+4}` (6 Byte) |

Abschluss: drei aufeinanderfolgende `0x7FFF`.

**Datenbereiche:**

| Bereich | Record | Größe | Felder |
|---|---|---|---|
| `[start1, start2)` | `layer1Tile` | **8** | `dstX i16 @0`, `dstY i16 @2`, `srcX u8 @4`, `srcY u8 @5`, `palID i16 @6` → **Layer 1**, Größe 16, `ID` = 4095 |
| `[start2, start3)` | Texturdeskriptor | **2** | Bitfeld: `page_x` Bits 0–3, `page_y` Bit 4, `typeTrans` Bits 5–6, `depth` Bits 7–8, Rest 0 — **eine Angabe pro Run**, nicht pro Kachel |
| `[start3, start4)` | Layer-2-Kachel | **14** | `layer1Tile` (8) + Texturdeskriptor u16 @8 + `ID u16 @10`, `param u8 @12` (**Bit 7 = blending, Bits 0–6 = param**), `state u8 @13` |
| `[start4, EOF)` | Layer-3/4-Kachel | **10** | `layer1Tile` (8) + `param u8` (Bit 7 = blending) + `state u8`; Layerzuordnung aus den `0x7FFF`-Grenzen; `ID` = 4096 (L3) bzw. 0 (L4); Größe 32 |

**`palID`-Packung:** gelesen als `(palID >> 6) & 0xF`; geschrieben als `(30 << 10) | (paletteID << 6)` — die oberen 6 Bit sind immer 30, die unteren 6 immer 0 (`BackgroundTilesIO.h:76`, `:1002`).

**Weitere PS-Unterschiede:** `textureID` = VRAM-Seiten-X, `textureY` = 0 Bildseite / 1 Effektseite (nur PS). `IDBig` und `unknown7` sind **nur PC** (`BackgroundTiles.h:32–38`). `depth` und `typeTrans` stehen im gemeinsamen 2-Byte-Texturdeskriptor, nicht in der Kachel — ein Run teilt sie sich.

Nützliche Format-Assertions (Makou warnt bei Verletzung): `(start3−start2) % 2`, `(start2−start1) % 8`, `(start4−start3) % 14`, `(size−start4) % 10`.

PSX-Texturseiten (`.MIM`): u32 `headerPalSize` am Anfang = Größe des Palettenblocks; dort ein 12-Byte-`MIM`-Kopf `{size u32, x u16, y u16, w u16, h u16}`, **`w` wird beim Lesen verdoppelt** (VRAM-16-Bit-Einheiten). Optional folgt ein zweiter `MIM` („Effect"-Seite) bei `headerPalSize + headerImg.size`. Adressierung: `pageDataPos(id) = 12 + (id ? headerImg.size : 0)`, `pageTexPos(x,y) = x/64`, `texturePos = pageDataPos(y) + (x − pageTexPos(y))·128` — eine „Texturseite" ist auf PS **64 VRAM-X-Einheiten = 128 Byte breit**. Kachelursprung: `texturePos + srcY·textureWidth + (depth==0 ? srcX/2 : srcX·depth)` — dieser Pfad behandelt 4 bpp **korrekt**, anders als der PC-Pfad.

### 18.9 Animation / Dynamik — das `param`/`state`-Modell (**S39-Kern**)

- `param` (u8) identifiziert einen **Hintergrund-Parameter**; `state` (u8) ist eine **Bitmaske** `1 << stateID`, **8 mögliche States** (`Script.cpp:721`, `BGDialog.cpp:321–329`).
- **`param == 0` bedeutet „statisch"**: solche Kacheln haben `state == 0` und werden immer gezeichnet. Gültige Parameter im Editor: 1..255 (`BackgroundTileEditor.cpp:39`).
- **Sichtbarkeitstest** (`BackgroundTiles::filter`, `BackgroundTiles.cpp:162–183`): Eine Kachel mit `layerID ≥ 1` wird gezeichnet gdw.

  > `state == 0` **ODER** `(aktiveStates[param] & state) != 0`

  In Worten: **State 0 ⇒ immer sichtbar; sonst nur, wenn die Laufzeitmaske für `param` genau dieses State-Bit gesetzt hat.** Eine animierte Hintergrundfläche ist damit eine Menge von Kacheln mit **gleichem `param`** und **unterschiedlichem `state`**, von denen das Skript jeweils genau eines aktiviert.
- Layer-0-Kacheln werden von `filter()` **immer bedingungslos** behalten (`:169–170`).
- Ein `param` kann legitim mehrere Kacheln an derselben `dstX/dstY` für dasselbe `(param, state)` haben; Makou nennt diese „Conflicts"/Effekt-Layer und zerlegt sie in aufeinanderfolgende Frames (`BackgroundTiles.cpp:329–369`). **So werden mehrframige Effekte an einer Position rekonstruiert.**

### 18.10 Die sieben Hintergrund-Opcodes

Startzustand einer Map wird durch Skript-Replay bestimmt: `Section1File::bgParamAndBgMove` (`:556–564`) → `Script::backgroundParams` + `Script::backgroundMove` (`Script.cpp:714–757`) → `BackgroundFile::openBackground` (`BackgroundFile.cpp:56–63`).

| Op | ID | Größe | Operanden (nach dem Bank-Byte) | Semantik |
|---|---|---|---|---|
| `BGPDH` | 0x2C | 5 | `layerID` u8, `targetZ` i16 | Z-Tiefe eines Layers setzen. **Nur `layerID` 2 und 3 werden honoriert** |
| `BGSCR` | 0x2D | 7 | `layerID` u8, `targetX` i16, `targetY` i16 | **Scroll-/Parallax-Opcode.** Nur Layer 2/3. Makou erfasst die Werte, **wendet sie aber nie auf das Rendering an** |
| `BGON` | 0xE0 | 4 | `bgParamID` u8, `bgStateID` u8 | `maske[param] \|= 1 << stateID` |
| `BGOFF` | 0xE1 | 4 | `bgParamID`, `bgStateID` | Bit löschen. **Makous Simulation ignoriert BGOFF bewusst** (auskommentiert, `Script.cpp:727–737`) |
| `BGROL` | 0xE2 | 3 | `bgParamID` | nächsten State zeigen (vorwärts zyklisch) |
| `BGROL2` | 0xE3 | 3 | `bgParamID` | vorherigen State zeigen |
| `BGCLR` | 0xE4 | 3 | `bgParamID` | alle States eines Parameters ausblenden |

Alle Operanden sind bankadressierbar; Makou wertet sie nur bei `banks == 0` (Literale) aus. Jede Gruppe mit einem dieser sieben Opcodes im Init-Skript wird als Typ **`Animation`** klassifiziert.

**Benachbarte Palettenanimations-Opcodes** (dieselbe Familie, für „animierte Hintergründe" ebenfalls relevant): `MPPAL` 0xDF (11), `STPAL` 0xE5 (5), `LDPAL` 0xE6 (5), `CPPAL` 0xE7 (5), `RTPAL` 0xE8 (7), `ADPAL` 0xE9 (10), `MPPAL2` 0xEA (10), `STPLS` 0xEB (5), `LDPLS` 0xEC (5), `CPPAL2` 0xED (8), `RTPAL2` 0xEE (8), `ADPAL2` 0xEF (11). **Alle `colorCount`-Felder sind als *Anzahl − 1* gespeichert** (Makou zeigt überall `colorCount + 1`).

### 18.11 Blending

- `blending` ist ein boolesches Byte; ist es gesetzt, kommen **Quellkoordinaten und Textur** aus `srcX2/srcY2/textureID2` (nur Layer 2–4).
- `typeTrans` wählt den Modus. `BackgroundFile::blendColor(type, d = vorhandenes Framebuffer-Pixel, s = eingehende Kachelfarbe)` (`BackgroundFile.cpp:192–229`):

| `typeTrans` | UI-Label | Mathematik je Kanal |
|---|---|---|
| 0 (Default-Zweig) | „Average" | `(d + s) / 2` |
| 1 | „Plus" | `min(d + s, 255)` |
| 2 | „Minus" | `max(d − s, 0)` |
| 3 | „Source +25% destination" | `min(d + s/4, 255)` |
| — (`blending == 0`) | „None" | reines Kopieren |

⚠️ Zwei Warnungen: (a) Das UI-Label für Typ 3 ist gegenüber der Implementierung **invertiert** (tatsächlich `dest + 25 % source`). (b) `drawBackground` wendet Blending **nur auf dem paletted Pfad** an — Direct-Color-Kacheln (depth 2) werden opak kopiert (`BackgroundFile.cpp:134–149`). **Makous Vorschau ist für 16-Bit-Blend-Kacheln nicht maßgeblich.**

### 18.12 Reparatur-Heuristik für kaputte PC-Maps

`BackgroundFilePC.cpp:149–215`: Bevorzugter Weg — die **PS-Format-Tiles aus PC-Sektion 6** (`Field::Tiles`) lesen: „PC field file contains PS tiles format. Although it is unused by the game, we can use it to repair the PC format" (`:151–152`) — und `paletteID`/`typeTrans` für Kacheln mit `depth < 2` übernehmen. Fallback-Heuristik: Jede Kachel mit `depth<2 && blending && typeTrans != 2 && paletteID >= paletteCount` bekommt `typeTrans = 2` und eine unbenutzte Palette.

> **Für WebMidgar sehr wertvoll:** PC-Field-Dateien enthalten in der ungenutzten Sektion 6 eine **zweite, PS-formatierte Kopie der Tile-Daten**. Die ist eine unabhängige Verifikationsquelle für den eigenen PC-Tile-Parser.

### 18.13 Palmer-kompatible Frame-Benennung (Asset-Export)

`BackgroundFilePC::untile` (`:525–554`): Start `i = (layerId == 1 ? 128 : 0)`; ist `param > 0`, dann `i += 256 + (param + state·64)·4`; ist `blending` gesetzt, `i += 64·256·4`; Kollisionen erhöhen `i` um 1. Dateiname `<field>_<layer>_<i:8>.png` mit `layer = layerId == 0 ? 0 : layerId − 1`.

### 18.14 Minimaler gültiger PC-Hintergrund (Sanity-Referenz)

`BackgroundFilePC::initEmpty` (`:43–80`): eine 256×256-Textur mit `isBigTile = 0`, `depth = 2` (keine Paletten), schwarz gefüllt; dann Layer-1-Kacheln mit `ID = 4095`, `srcX = srcY = 0` („Data optimization: always the same source"), `size = 16`, `depth = 2`, über `dstX ∈ [−256, 256)` in 16er-Schritten und `dstY`-Bänder von +128 abwärts bis −256 in 128-px-Zeilen, `tileID` in genau dieser Reihenfolge hochzählend.

---

## 19. Feldskript-Bytecode — vollständige Opcode-Tabelle

### 19.1 Wie diese Tabelle entstanden ist (und wie man sie unabhängig verifiziert)

Zwei voneinander unabhängige Quellen in Makou wurden gegeneinander geprüft:

1. **`Opcode::length[257]`** (`Opcode.cpp:5302–5576`) — flache Tabelle, indiziert mit dem Opcode-Byte; liefert die **Gesamtlänge inklusive Opcode-Byte**.
2. **Die gepackten `Opcode<NAME>`-Structs** (`Opcode.h:326–1531`) — die Felder *nach* dem `id`-Member sind exakt die On-Disk-Parameterbytes in Reihenfolge. `id` ist im Speicher `quint16`, auf Disk aber **1 Byte**.

⇒ **On-Disk-Layout = 1 Opcode-Byte, dann die Structfelder in Deklarationsreihenfolge, gepackt, Little Endian** (`Opcode.cpp:86–90`, `:104–112`, `:161–173`).

Die Enum-Reihenfolge in `OPCODE_GENERATE_LIST` (`Opcode.h:125–205`) ist positionsidentisch mit `names[257]`, und `RET = 0` ⇒ **Enum-Index == Opcode-Byte**.

Rein editor-interne Felder, die **nie** geschrieben werden: `_label` (u16), `_badJump` (u8) auf Jump/If-Opcodes, `QByteArray *_data` auf KAWAI und 0x1C. `LABEL` (Index 0x100) ist ein **Pseudo-Opcode** mit `length == 0`.

> ⚠️ **Rechtlicher Hinweis:** Die beiden 257-Einträge-Literaltabellen (`length[]`, `names[]`), der AKAO-Beschreibungs-Switch (`Opcode.cpp:5035–5181`) und der MENU-ID-Switch (`:3080–3204`) sind große GPLv3-Literaltabellen. **Nicht wörtlich kopieren.** Die *Werte* (Nummer → Mnemonik → Größe) sind Schnittstellenfakten über das FF7-Datenformat und aus jeder Field-Datei unabhängig verifizierbar. Die englischen Beschreibungstexte sind dagegen schöpferischer Inhalt — selbst formulieren.

### 19.2 Parameterkodierung

**Bank-Nibbles.** Opcodes mit „Variable-oder-Literal"-Operanden tragen ein oder mehrere **Bank-Bytes**, jedes packt **zwei 4-Bit-Bank-IDs**: High-Nibble = ungerade Bank, Low-Nibble = gerade Bank (`Opcode.h:31–33`). Bank-Bytes stehen **zuerst** im Parameterbereich: `banks` (Banks 1&2), `banks[2]` (1–4) oder `banks[3]` (1–6). Zuordnung: `bank1 = hi(banks[0])`, `bank2 = lo(banks[0])`, `bank3 = hi(banks[1])`, `bank4 = lo(banks[1])`, `bank5 = hi(banks[2])`, `bank6 = lo(banks[2])` (`Opcode.cpp:1503–1561`).

- **Bank-ID 0 ⇒ Operand ist ein Literal. Bank-ID 1..15 ⇒ Operand ist eine Adresse in dieser Bank** (`Opcode.cpp:5194–5200`).
- Bei Bank ≠ 0 werden **nur die unteren 8 Bit** des Operanden als Adresse benutzt, auch wenn das Feld 16 Bit breit ist (`Opcode.cpp:5197`).

**Operandenbreiten/Vorzeichen** (`FF7Var::VarSize`: `Byte`, `Word` (u16), `SignedWord` (i16), `Bit`; `Writable`-Flag für Ziele; vollständige Klassifikation in `Opcode::variables()`, `Opcode.cpp:1792–1969`):

- Koordinaten (`targetX/Y/Z`, SIN/COS-Werte, JUMP-`height`, WMOVE-Relativwerte, Fenster-x/y) sind **i16**; Dreiecks-IDs/`targetI`, Geschwindigkeiten, Reichweiten sind **u16**.
- IF-Familie in drei Breiten: **IFUB = unsigned byte, IFUW = unsigned word, IFSW = signed word**.
- 32-Bit-Werte (GOLDu/GOLDd/WNUMB) liegen als ein `qint32`, werden aber als **zwei unabhängige 16-Bit-Hälften** gebankt: bank1 → Bits 0–15, bank2 → Bits 16–31.
- 24-/32-Bit-AP-Zähler (SMTRA/DMTRA/CMTRA) sind **Byte-Arrays**, jedes Byte separat bankbar; Literalwert = Little-Endian-Komposition.

**Vergleichsoperatoren** (`oper`-Byte, 11 Stück, `Opcode.cpp:5298–5300`, `Opcode.h:38`):

| Wert | Operator |
|---|---|
| 0 | `==` |
| 1 | `!=` |
| 2 | `>` |
| 3 | `<` |
| 4 | `>=` |
| 5 | `<=` |
| 6 | `&` (Bit-AND) |
| 7 | `^` (Bit-XOR) |
| 8 | `\|` (Bit-OR) |
| 9 | bitON |
| 10 | bitOFF |

**Skript-ID + Priorität.** `REQ/REQSW/REQEW/PREQ/PRQSW/PRQEW/RETTO` packen **Skript-ID in Bits 0–4 (`& 0x1F`) und Priorität in Bits 5–7 (`>> 5 & 7`)** eines Bytes (`Opcode.h:34–37`). Priorität wird als „n/6" angezeigt; **niedrigere Zahl = höhere Priorität im Spiel** (`ScriptEditorStructPage.cpp:28–31`).

**Variable-Länge — nur zwei Instruktionen** (`Opcode.cpp:148–159`):
- **KAWAI (0x28)**: `size = max(byte1, 1)`. Byte 1 = **Gesamtlänge inkl. Opcode-Byte**, Byte 2 = Sub-Opcode, Payload = `size − 3` Byte. Die Klemme auf 1 verhindert eine Endlosschleife bei Größe 0.
- **0x1C (unbenutzt)**: `size = 6 + min(subSize, 128)`.

**SPECIAL (0x0F)** ist sub-opcode-abhängig groß: `2 + extra` mit `extra ∈ {0,1,2}` (`Opcode.cpp:125–146`).

### 19.3 Opcode-Tabelle 0x00–0xFF

Größe = **Gesamtbytes inkl. Opcode-Byte**. „bN" = welches der 6 Bank-Nibbles den Operanden regiert.

#### Ablaufsteuerung / Skriptausführung (0x00–0x0F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 00 | RET | 1 | — (Skriptende) |
| 01 | REQ | 3 | `groupID` u8; `scriptIDAndPriority` u8. Async, übersprungen wenn schon laufend |
| 02 | REQSW | 3 | wie REQ; async, immer eingereiht |
| 03 | REQEW | 3 | wie REQ; blockiert bis Ende |
| 04 | PREQ | 3 | `partyID` u8; `scriptIDAndPriority` u8 |
| 05 | PRQSW | 3 | wie PREQ, immer eingereiht |
| 06 | PRQEW | 3 | wie PREQ, blockierend |
| 07 | RETTO | 2 | `scriptIDAndPriority` u8 — Skript N *dieser* Entity |
| 08 | JOIN | 2 | `speed` u8 |
| 09 | SPLIT | 15 | `banks[3]`; X1 i16(b1); Y1 i16(b2); dir1 u8(b3); X2 i16(b4); Y2 i16(b5); dir2 u8(b6); `speed` u8 |
| 0A | SPTYE | 6 | `banks[2]`; charID1(b1), charID2(b2), charID3(b3) u8 |
| 0B | GTPYE | 6 | `banks[2]`; varCharID1(b1), varCharID2(b2), varCharID3(b3) u8 **schreibend** |
| 0C | *(unbenutzt)* | 1 | — |
| 0D | *(unbenutzt)* | 1 | — |
| 0E | DSKCG | 2 | `diskID` u8 |
| 0F | SPECIAL | 2 (+0/1/2) | `subKey` u8 + Sub-Parameter (s. 19.4) |

#### Sprünge und Bedingungen (0x10–0x1F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 10 | JMPF | 2 | `jump` u8 (vorwärts) |
| 11 | JMPFL | 3 | `jump` u16 |
| 12 | JMPB | 2 | `jump` u8 (rückwärts, Betrag) |
| 13 | JMPBL | 3 | `jump` u16 |
| 14 | IFUB | 6 | `banks`; `value1` u8(b1); `value2` u8(b2); `oper` u8; `jump` u8 |
| 15 | IFUBL | 7 | dito, `jump` u16 |
| 16 | IFSW | 8 | `banks`; `value1` **i16**(b1); `value2` **i16**(b2); `oper` u8; `jump` u8 |
| 17 | IFSWL | 9 | dito, `jump` u16 |
| 18 | IFUW | 8 | `banks`; `value1` **u16**(b1); `value2` **u16**(b2); `oper` u8; `jump` u8 |
| 19 | IFUWL | 9 | dito, `jump` u16 |
| 1A | *(unbenutzt, DLPB)* | 10 | `from` u16; `to` u16; `absValue` i32; `flag` u8. `flag&7`: 0=8, 1=16, 2=24, 3=32 Bit; `flag&0x10` = „from ist Pointer"; `flag&0x20` = „to ist Pointer". Savemap lesen/schreiben |
| 1B | *(unbenutzt, DLPB)* | 3 | `jump` u16 — **echter Langsprung**, beschrieben als „If Red XIII is named Nanaki" |
| 1C | *(unbenutzt, DLPB)* | 6 + n | `address` u32; `subSize` u8; dann `min(subSize,128)` Rohbytes |
| 1D–1F | *(unbenutzt)* | 1 | — |

#### Diverses / Modellfilter / Hintergrund (0x20–0x2F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 20 | MINIGAME | 11 | `mapID` u16; X i16; Y i16; `targetI` u16; `minigameParam` u8; `minigameID` u8 (0 Bike, 1 Chocobo-Rennen, 2 Snowboard normal, 3 Fort Condor, 4 U-Boot, 5 Speed Square, 6 Snowboard GS) |
| 21 | TUTOR | 2 | `tutoID` u8 |
| 22 | BTMD2 | 5 | `battleMode` u32-Bitfeld (Bit 1 Countdown, 2 Präventivschlag, 3 keine Flucht, 5 keine Siegesmusik, 6 Battle Arena, 7 keine Belohnung, 8 keine Siegespose, 16 kein Game Over) |
| 23 | BTRLD | 3 | `banks`; `var` u8(b2) **schreibend** |
| 24 | WAIT | 3 | `frameCount` u16 — **Einheit = Frames** |
| 25 | NFADE | 9 | `banks[2]`; `type` u8; r(b1); g(b2); b(b3) u8; `speed` **u16**(b4) |
| 26 | BLINK | 2 | `closed` u8 (0 = Blinzeln an) |
| 27 | BGMOVIE | 2 | `disabled` u8 (0 = an) |
| 28 | KAWAI | **variabel** | `opcodeSize` u8, `subKey` u8, `opcodeSize−3` Payloadbytes (s. 19.5) |
| 29 | KAWIW | 1 | — (auf KAWAI-Filter warten) |
| 2A | PMOVA | 2 | `partyID` u8 |
| 2B | SLIP | 2 | `disabled` u8 |
| 2C | BGPDH | 5 | `banks`; `layerID` u8; `targetZ` i16 |
| 2D | BGSCR | 7 | `banks`; `layerID` u8; X i16(b1); Y i16(b2) |
| 2E | WCLS | 2 | `windowID` u8 |
| 2F | WSIZW | 10 | `windowID` u8; X i16; Y i16; `width` u16; `height` u16 (**keine Banks**) |

#### Eingabe / Party / Geld / Fenstervariablen (0x30–0x3F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 30 | IFKEY | 4 | `keys` u16-Bitmaske; `jump` u8 |
| 31 | IFKEYON | 4 | dito — „einmal gedrückt" |
| 32 | IFKEYOFF | 4 | dito — „einmal losgelassen" |
| 33 | UC | 2 | `disabled` u8 — Spielerbewegbarkeit |
| 34 | PDIRA | 2 | `partyID` u8 |
| 35 | PTURA | 4 | `partyID` u8; `speed` u8; `directionRotation` u8 (1 oder 2 = umgekehrt) |
| 36 | WSPCL | 5 | `windowID` u8; `displayType` u8 (0 keins, 1 Uhr, 2 numerisch); `marginLeft` u8; `marginTop` u8 |
| 37 | WNUMB | 8 | `banks`; `windowID` u8; `value` **i32** (low16→b1, high16→b2); `digitCount` u8 |
| 38 | STTIM | 6 | `banks[2]`; h u8(b1); m u8(b2); s u8 |
| 39 | GOLDu | 6 | `banks`; `value` i32 (low16→b1, high16→b2) |
| 3A | GOLDd | 6 | dito |
| 3B | CHGLD | 4 | `banks`; var1 u8(b1) **schreibend 16-Bit**; var2 u8(b2) **schreibend 16-Bit** |
| 3C | HMPMAX1 | 1 | — |
| 3D | HMPMAX2 | 1 | — |
| 3E | MHMMX | 1 | — volle HP/MP **aller** Charaktere + Statusheilung |
| 3F | HMPMAX3 | 1 | — |

#### Nachrichten / Menüs / HP-MP (0x40–0x4F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 40 | MESSAGE | 3 | `windowID` u8; `textID` u8 |
| 41 | MPARA | 5 | `banks`; `windowID` u8; `windowVarID` u8; `value` u8(b2) |
| 42 | MPRA2 | 6 | `banks`; `windowID` u8; `windowVarID` u8; `value` **u16**(b2) |
| 43 | MPNAM | 2 | `textID` u8 |
| 44 | *(unbenutzt)* | 1 | — |
| 45 | MPu | 5 | `banks`; `partyID` u8; `value` u16(b2) |
| 46 | *(unbenutzt)* | 1 | — |
| 47 | MPd | 5 | wie MPu |
| 48 | ASK | 7 | `banks`; `windowID` u8; `textID` u8; `firstLine` u8; `lastLine` u8; `varAnswer` u8(b2) **schreibend** |
| 49 | MENU | 4 | `banks`; `menuID` u8; `param` u8(b2) |
| 4A | MENU2 | 2 | `disabled` u8 |
| 4B | BTLTB | 2 | `battleTableID` u8 |
| 4C | *(unbenutzt)* | 1 | — |
| 4D | HPu | 5 | `banks`; `partyID`; `value` u16(b2) |
| 4E | *(unbenutzt)* | 1 | — |
| 4F | HPd | 5 | dito |

Bekannte `menuID`-Werte (`Opcode.cpp:3074–3208`): 1 Beenden, 2 Encounter-Fehler, 5 Credits, 6 Charakter umbenennen (`param` = charID), 7 Party wechseln, 8 Shop (`param` = shopID), 9 Hauptmenü, 12 Bike, 14 Speichern, 15/16 alle Materia entfernen/wiederherstellen, 17 Materia eines Charakters entfernen, 18/19 Clouds Materia leeren/wiederherstellen, 21 HP → 1, 22 Materia-Prüfungen (**Ergebnis in `var[15][111]`**), 23 Master-Materia-Umwandlungen.

#### Fenster / Inventar / Materia / Shake (0x50–0x5F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 50 | WINDOW | 10 | `windowID` u8; X i16; Y i16; `width` u16; `height` u16 |
| 51 | WMOVE | 6 | `windowID` u8; `relativeX` i16; `relativeY` i16 |
| 52 | WMODE | 4 | `windowID` u8; `mode` u8 (0 normal, 1 ohne Rahmen/Hintergrund, 2 transparent); `preventClose` u8 |
| 53 | WREST | 2 | `windowID` u8 — setzt Fenster auf **x=8, y=149, w=304, h=74** zurück |
| 54 | WCLSE | 2 | `windowID` u8 („stärkeres" Schließen) |
| 55 | WROW | 3 | `windowID` u8; `rowCount` u8 |
| 56 | GWCOL | 7 | `banks[2]`; `corner` u8(b1) (0 oben-links, 1 unten-links, 2 oben-rechts, 3 unten-rechts); varR(b2), varG(b3), varB(b4) **schreibend** |
| 57 | SWCOL | 7 | `banks[2]`; `corner`(b1); r(b2), g(b3), b(b4) u8 |
| 58 | STITM | 5 | `banks`; `itemID` **u16**(b1); `quantity` u8(b2) |
| 59 | DLITM | 5 | dito — entfernen |
| 5A | CKITM | 5 | dito, `quantity` ist das **Zielregister**(b2) |
| 5B | SMTRA | 7 | `banks[2]`; `materiaID` u8(b1); `APCount[3]` (b2,b3,b4) = 24-Bit AP |
| 5C | DMTRA | 8 | wie SMTRA + `quantity` u8 |
| 5D | CMTRA | 10 | `banks[3]`; `APCount[4]` (b1..b4) = 32-Bit AP; `materiaID` u8 (**ohne Bank**); `varQuantity` u8(b6) **schreibend** |
| 5E | SHAKE | 8 | `banks[2]`; `type` u8; xAmplitude(b1), xFrames(b2), yAmplitude(b3), yFrames(b4) u8 |
| 5F | NOP | 1 | — |

#### Mapwechsel / Kamera-Scroll / Fade (0x60–0x6F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 60 | MAPJUMP | 10 | `mapID` u16; X i16; Y i16; `targetI` u16 (Dreieck); `direction` u8 |
| 61 | SCRLO | 2 | `unknown` u8 |
| 62 | SCRLC | 5 | `banks`; `speed` u16(b2); `unknown` u8 |
| 63 | SCRLA | 6 | `banks`; `speed` u16(b2); `groupID` u8; `scrollType` u8 |
| 64 | SCR2D | 6 | `banks`; X i16(b1); Y i16(b2) |
| 65 | SCRCC | 1 | — (zur Spielfigur scrollen) |
| 66 | SCR2DC | 9 | `banks[2]`; X i16(b1); Y i16(b2); `speed` u16(b4) |
| 67 | SCRLW | 1 | — (auf Scroll warten) |
| 68 | SCR2DL | 9 | wie SCR2DC, linear |
| 69 | MPDSP | 2 | `unknown` u8 |
| 6A | VWOFT | 7 | `banks`; u16(b1); u16(b2); `enable` u8 |
| 6B | FADE | 9 | `banks[2]`; r(b1), g(b2), b(**b4**) u8; `speed` u8; `fadeType` u8; `adjust` u8 |
| 6C | FADEW | 1 | — |
| 6D | IDLCK | 4 | `triangleID` u16; `locked` u8 |
| 6E | LSTMP | 3 | `banks`; `var` u8(b2) **schreibend 16-Bit** |
| 6F | SCRLP | 6 | `banks`; `speed` u16(b2); `partyID` u8; `scrollType` u8 |

#### Kampf / Party-Geometrie / X-Arithmetik (0x70–0x7F)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| 70 | BATTLE | 4 | `banks`; `battleID` u16(b2) |
| 71 | BTLON | 2 | `disabled` u8 — Zufallskämpfe |
| 72 | BTLMD | 3 | `battleMode` **u16**-Bitfeld (wie BTMD2, außer Bit 8 = kein Game Over) |
| 73 | PGTDR | 4 | `banks`; `partyID` u8; `varDir` u8(b2) **schreibend** |
| 74 | GETPC | 4 | `banks`; `partyID` u8; `varPC` u8(b2) **schreibend** |
| 75 | PXYZI | 8 | `banks[2]`; `partyID` u8; varX(b1,i16), varY(b2,i16), varZ(b3,i16), varI(b4,u16) — alle **schreibend** |
| 76 | PLUSX | 4 | `banks`; `var` u8(b1) **schreibend**; `value` u8(b2) — 8-Bit, **gesättigt** |
| 77 | PLUS2X | 5 | `banks`; `var`(b1) **schreibend 16-Bit**; `value` **u16**(b2) |
| 78 | MINUSX | 4 | wie PLUSX |
| 79 | MINUS2X | 5 | wie PLUS2X |
| 7A | INCX | 3 | `banks`; `var`(b2) **schreibend** — 8-Bit ++, gesättigt |
| 7B | INC2X | 3 | dito, 16-Bit |
| 7C | DECX | 3 | 8-Bit −−, gesättigt |
| 7D | DEC2X | 3 | 16-Bit |
| 7E | TLKON | 2 | `disabled` u8 |
| 7F | RDMSD | 3 | `banks`; `value` u8(b2) — RNG-Seed |

> **Wichtige Semantik (aus dem Editor, `ScriptEditorMathPage.cpp:288–367`):** Die `X`-Suffix-Varianten sind die **gesättigten (capped)** Formen, die schlichten Varianten die **überlaufenden (wrapped)** Formen. Das ist ein leicht zu übersehender, aber verhaltensrelevanter Unterschied.

#### Arithmetik / Bitoperationen / Speicher (0x80–0x9F)

Alle 4 Byte (`banks` u8; `var` u8 b1 **schreibend**; `value`/`position` u8 b2): `SETBYTE`(80), `BITON`(82), `BITOFF`(83), `BITXOR`(84), `PLUS`(85), `MINUS`(87), `MUL`(89), `DIV`(8B), `MOD`(8D), `AND`(8F), `OR`(91), `XOR`(93), `LBYTE`(9A).

Alle 5 Byte (`banks` u8; `var` u8 b1 **schreibend 16-Bit**; `value` **u16** b2): `SETWORD`(81), `PLUS2`(86), `MINUS2`(88), `MUL2`(8A), `DIV2`(8C), `MOD2`(8E), `AND2`(90), `OR2`(92), `XOR2`(94), `HBYTE`(9B).

| Hex | Mnemonik | Größe | Anmerkung |
|---|---|---|---|
| 82/83/84 | BITON/BITOFF/BITXOR | 4 | `var`(b1) ist **bitadressiert**; `position`(b2) = Bitindex |
| 95 | INC | 3 | 8-Bit, **wrapped** |
| 96 | INC2 | 3 | 16-Bit, wrapped |
| 97 | DEC | 3 | 8-Bit, wrapped |
| 98 | DEC2 | 3 | 16-Bit, wrapped |
| 99 | RANDOM | 3 | `banks`; `var`(b2) **schreibend** — 8-Bit-Zufall |
| 9A | LBYTE | 4 | `var = value & 0xFF` |
| 9B | HBYTE | 5 | `var = (value >> 8) & 0xFF` |
| 9C | TOBYTE | 6 | `banks[2]`; `var`(b1, schreibend 16-Bit); v1 u8(b2); v2 u8(**b4**) → `var = (v1&0xFF) \| ((v2&0xFF)<<8)` |
| 9D | SETX | 7 | `banks[2]`; `value` u8; `varOrValue1` **u16**(b2); `varOrValue2` u8(b4). **b1 = Speicherbank-Selektor, kein Operand-Bank.** `SETX[b1][value + varOrValue1] = varOrValue2` |
| 9E | GETX | 7 | `banks[2]`; `value` u8; `varOrValue1` u16(b2); `var` u8(b4, schreibend) → `var = GETX[b1][value + varOrValue1]` |
| 9F | SEARCHX | 11 | `banks[3]`; `searchStart` u8; `start` u16(b2); `end` u16(b3); `value` u8(b4); `varResult` u8(b6, schreibend, 16-Bit). Durchsucht Bank b1 von `searchStart+start` bis `searchStart+end` |

**`DIV`/`MOD` durch 0 lässt das Spiel abstürzen** (Warnhinweis im Editor, `ScriptEditorMathPage.cpp:57–59`). **Es gibt keine Shift-Opcodes.**

#### Field-Modell-Steuerung (0xA0–0xBF)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| A0 | PC | 2 | `charID` u8 — diese Entity ist Spielfigur X |
| A1 | CHAR | 2 | `object3DID` u8 — **Index in die Model-Loader-Tabelle** dieses Fields |
| A2 | DFANM | 3 | `animID` u8; `speed` u8 — Schleifenanimation |
| A3 | ANIME1 | 3 | `animID`; `speed` — einmal, dann zurücksetzen |
| A4 | VISI | 2 | `show` u8 (0 = verbergen) |
| A5 | XYZI | 11 | `banks[2]`; X i16(b1); Y i16(b2); Z i16(b3); `targetI` u16(b4) |
| A6 | XYI | 9 | `banks[2]`; X i16(b1); Y i16(b2); `targetI` u16(b3) |
| A7 | XYZ | 9 | `banks[2]`; X i16(b1); Y i16(b2); Z i16(b3) |
| A8 | MOVE | 6 | `banks`; X i16(b1); Y i16(b2) — Gehen mit Animation |
| A9 | CMOVE | 6 | dito — ohne Animation und ohne Rotation |
| AA | MOVA | 2 | `groupID` u8 |
| AB | TURA | 4 | `groupID` u8; `directionRotation` u8; `speed` u8 |
| AC | ANIMW | 1 | — (auf Animation warten) |
| AD | FMOVE | 6 | `banks`; X i16(b1); Y i16(b2) — ohne Animation |
| AE | ANIME2 | 3 | `animID`; `speed` |
| AF | ANIMX1 | 3 | `animID`; `speed` (Typ 1) |
| B0 | CANIM1 | 5 | `animID`; `firstFrame`; `lastFrame`; `speed` (teilweise, mit Rücksetzen) |
| B1 | CANMX1 | 5 | dito, ohne Rücksetzen |
| B2 | MSPED | 4 | `banks`; `speed` u16(b2) — **Bewegungsgeschwindigkeit** |
| B3 | DIR | 3 | `banks`; `direction` u8(b2) |
| B4 | TURNGEN | 6 | `banks`; `direction` u8(b2); `turnCount` u8; `speed` u8; `unknown` u8 |
| B5 | TURN | 6 | dito („inverse Rotation") |
| B6 | DIRA | 2 | `groupID` u8 |
| B7 | GETDIR | 4 | `banks`; `groupID` u8; `varDir` u8(b2) **schreibend** |
| B8 | GETAXY | 5 | `banks`; `groupID` u8; varX(b1); varY(b2) — beide **schreibend i16** |
| B9 | GETAI | 4 | `banks`; `groupID` u8; `varI` u8(b2) **schreibend u16** |
| BA | ANIMX2 | 3 | `animID`; `speed` (Typ 2) |
| BB | CANIM2 | 5 | wie CANIM1 |
| BC | CANMX2 | 5 | wie CANMX1 |
| BD | ASPED | 4 | `banks`; `speed` u16(b2) — **Animationsgeschwindigkeit** |
| BE | *(unbenutzt)* | 1 | — |
| BF | CC | 2 | `groupID` u8 — Kontrolle an Gruppe übergeben |

> **Einheiten (aus dem Editor, `ScriptEditorGenericList.cpp:563–609`):** „Direction" und „Rotation" sind **einfache u8 0–255** — **es gibt nirgends eine Gradumrechnung im Format**; die Umrechnung `−360·dir/256` passiert erst im Renderer. „Speed (8-bit)" = u8 0–255, „Speed (16-bit)" = u16. Koordinaten X/Y/Z sind **i16 ohne Skalierung**; „Triangle" ist **u16**.

#### Bewegung / Walkmesh / Party-Zugehörigkeit (0xC0–0xCF)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| C0 | JUMP | 11 | `banks[2]`; X i16(b1); Y i16(b2); `targetI` u16(b3); `height` i16(b4) |
| C1 | AXYZI | 8 | `banks[2]`; `groupID` u8; varX(b1), varY(b2), varZ(b3), varI(b4) — alle **schreibend** |
| C2 | LADER | 15 | `banks[2]`; X i16(b1); Y i16(b2); Z i16(b3); `targetI` u16(b4); `way` u8; `animID` u8; `direction` u8; `speed` u8 |
| C3 | OFST | 12 | `banks[2]`; `moveType` u8; X i16(b1); Y i16(b2); Z i16(b3); `speed` u16(b4) |
| C4 | OFSTW | 1 | — |
| C5 | TALKR | 3 | `banks`; `range` u8(b2) |
| C6 | SLIDR | 3 | `banks`; `range` u8(b2) |
| C7 | SOLID | 2 | `disabled` u8 |
| C8 | PRTYP | 2 | `charID` u8 — zur Party hinzufügen |
| C9 | PRTYM | 2 | `charID` u8 — entfernen |
| CA | PRTYE | 4 | `charID[3]` u8 — ganze Party (**0xFE/0xFF = leerer Slot**) |
| CB | IFPRTYQ | 3 | `charID` u8; `jump` u8 |
| CC | IFMEMBQ | 3 | `charID` u8; `jump` u8 |
| CD | MMBud | 3 | `exists` u8; `charID` u8 |
| CE | MMBLK | 2 | `charID` u8 — in PHS sperren |
| CF | MMBUK | 2 | `charID` u8 — entsperren |

#### Linien / Trigonometrie / Preload / AKAO2 / Paletten-1 (0xD0–0xDF)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| D0 | LINE | 13 | 6 × i16: X1,Y1,Z1,X2,Y2,Z2 — **keine Banks**. Im Init-Skript ⇒ Gruppentyp „Location" |
| D1 | LINON | 2 | `enabled` u8 (≠ 0 = aktiv) |
| D2 | MPJPO | 2 | `disabled` u8 — Gateways an/aus |
| D3 | SLINE | 16 | `banks[3]`; X1(b1),Y1(b2),Z1(b3),X2(b4),Y2(b5),Z2(b6) alle i16 |
| D4 | SIN | 10 | `banks[2]`; v1 i16(b1); v2 i16(b2); v3 i16(b3); `var` u8(b4, schreibend i16) → **`var = ((sin(v1)·v2) + v3) >> 12`** |
| D5 | COS | 10 | dito mit Kosinus |
| D6 | TLKR2 | 4 | `banks`; `range` **u16**(b2) |
| D7 | SLDR2 | 4 | `banks`; `range` u16(b2) |
| D8 | PMJMP | 3 | `mapID` u16 — Field vorladen |
| D9 | PMJMP2 | 1 | — |
| DA | AKAO2 | 15 | `banks[3]`; `opcode` u8; p1 u16(b1); p2 u16(b2); p3 u16(b3); p4 u16(b4); p5 u16(b6) |
| DB | FCFIX | 2 | `disabled` u8 — Kamerarotation sperren |
| DC | CCANM | 4 | `animID` u8; `speed` u8; `standWalkRun` u8 (0 stehen, 1 gehen, 2 rennen) |
| DD | ANIMB | 1 | — Animation abbrechen |
| DE | TURNW | 1 | — auf Rotation warten |
| DF | MPPAL | 11 | `banks[3]`; `posSrc` u8; `posDst` u8; `start`(b1); `b`(b2); `g`(b3); `r`(b4); `colorCount`(b6) |

#### Hintergrund & Paletten (0xE0–0xEF)

Siehe Abschnitt 18.10 für BGON..BGCLR. Palettenopcodes:

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| E5 | STPAL | 5 | `banks`; `palID`(b1); `position`(b2); `colorCount` u8 |
| E6 | LDPAL | 5 | `banks`; `position`(b1); `palID`(b2); `colorCount` |
| E7 | CPPAL | 5 | `banks`; `posSrc`(b1); `posDst`(b2); `colorCount` |
| E8 | RTPAL | 7 | `banks[2]`; `posSrc`(b1); `posDst`(b2); `start`(b4); `end` u8 |
| E9 | ADPAL | 10 | `banks[3]`; `posSrc`(b1); `posDst`(b2); b(b3); g(b4); r(b5); `colorCount` u8 |
| EA | MPPAL2 | 10 | identisch zu ADPAL (multiplizieren statt addieren) |
| EB | STPLS | 5 | `palID`; `posSrc`; `start`; `colorCount` — **keine Banks** |
| EC | LDPLS | 5 | `posSrc`; `palID`; `start`; `colorCount` — keine Banks |
| ED | CPPAL2 | 8 | `banks[2]`; `posTileSrc`; `posTileDst`; `posSrc`(b1); `posDst`; `colorCount`(b4) |
| EE | RTPAL2 | 8 | `banks[2]`; `posTileSrc`; `posTileDst`; `posSrc`(b1); `posDst`(b2); `start`(b4) |
| EF | ADPAL2 | 11 | `banks[3]`; `posTileSrc`; `posTileDst`; `start`(b1); b; g; r; `colorCount`(b6) |

**Alle `colorCount`-Felder sind als *Anzahl − 1* kodiert.**

#### Sound / Musik / Video (0xF0–0xFF)

| Hex | Mnemonik | Größe | Parameter |
|---|---|---|---|
| F0 | MUSIC | 2 | `musicID` u8 |
| F1 | SOUND | 5 | `banks`; `soundID` **u16**(b1); `position` u8(b2) — **Pan 0..127** |
| F2 | AKAO | 14 | `banks[3]`; `opcode` u8; p1 **u8**(b1); p2 u16(b2); p3 u16(b3); p4 u16(b4); p5 u16(b6) |
| F3 | MUSVT | 2 | `musicID` u8 — temporäre Musik |
| F4 | MUSVM | 2 | `musicID` u8 |
| F5 | MULCK | 2 | `disabled` u8 — Musik sperren/entsperren |
| F6 | BMUSC | 2 | `musicID` u8 — nächste Kampfmusik |
| F7 | CHMPH | 4 | `banks`; var1(b1) **schreibend**; var2(b2) **schreibend** — Zweck unbekannt („FIXME: reverse this") |
| F8 | PMVIE | 2 | `movieID` u8 |
| F9 | MOVIE | 1 | — Video abspielen |
| FA | MVIEF | 3 | `banks`; `varCurMovieFrame` u8(b2) |
| FB | MVCAM | 2 | `movieCamID` u8 |
| FC | FMUSC | 2 | `musicID` u8 |
| FD | CMUSC | 8 | `musicID` u8; `banks` u8; `opcode` u8; p1 u16(b1); p2 u16(b2) |
| FE | CHMST | 3 | `banks`; `var` u8(b2) **schreibend** — 1 wenn Musik läuft |
| FF | GAMEOVER | 1 | — |
| 100 | LABEL | **0** | Pseudo-Opcode, nur im Editor |

### 19.4 SPECIAL (0x0F) — Sub-Opcodes

Layout: `0x0F`, `subKey` u8, dann Sub-Parameter. Sub-Keys `0xF5..0xFF` (`Opcode.h:272–284`).

| Sub-Key | Mnemonik | Gesamtgröße | Parameter | Bedeutung |
|---|---|---|---|---|
| F5 | ARROW | 3 | `disabled` u8 | Field-Pfeil-Cursor an/aus |
| F6 | PNAME | 3 | 1 Byte (**siehe Konflikt unten**) | „Disable right menu" |
| F7 | GMSPD | 3 | 1 Byte | Spielgeschwindigkeit in Variable lesen |
| F8 | SMSPD | 4 | `banks` u8; `speed` u8(b2) | Nachrichtengeschwindigkeit setzen |
| F9 | FLMAT | 2 | — | Materia-Menü mit allen Materia (gemeistert) füllen |
| FA | FLITM | 2 | — | Alle Items in voller Menge |
| FB | BTLCK | 3 | `lock` u8 | Kämpfe an/aus |
| FC | MVLCK | 3 | `lock` u8 | Videos an/aus |
| FD | SPCNM | 4 | `charID` u8; `textID` u8 | Charakter umbenennen |
| FE | RSGLB | 2 | — | Spielzeit auf 0, PHS+Speichern entsperren, Party = Cloud/leer/leer |
| FF | CLITM | 2 | — | Alle Items entfernen |

Unbekannte Sub-Keys werden als 2 Byte angenommen. ⚠️ **Konflikt:** `OpcodeSPECIALPNAME` deklariert **4 Parameter** mit dem Kommentar „FIXME: 4 parameters, not 1", während die Größentabelle nur 1 Extra-Byte einplant und der Editor 3 Felder anbietet (`ScriptEditorSpecialPage.cpp:28–35`). **PNAME ist in Makou nachweislich falsch modelliert.**

### 19.5 KAWAI (0x28) — Sub-Opcodes

Layout: `0x28`, `opcodeSize` u8 (**Gesamtlänge inkl. Opcode-Byte**), `subKey` u8, dann `opcodeSize − 3` Payloadbytes. **Das Größenbyte ist maßgeblich**, unabhängig vom Sub-Key.

| Sub-Key | Mnemonik | Payload | Bytes | Typische Gesamtlänge |
|---|---|---|---|---|
| 00 | EYETX | `eyeID1`, `eyeID2`, `mouthID`, `objectID` (u8) | 4 | 7 |
| 01 | TRNSP | `enableTransparency` u8 | 1 | 4 |
| 02 | AMBNT | `r1, r2, g1, g2, b1, b2, flags` (u8) — **zwei Ambient-Farben, kanalweise verschränkt** | 7 | 10 |
| 03 | ??? (1) | unbekannt | ? | Größenbyte |
| 04 | UNKNOWN4 | unbekannt | ? | Größenbyte |
| 05 | ??? (3) | unbekannt | ? | Größenbyte |
| 06 | LIGHT | unbekannt | ? | Größenbyte |
| 07–09, 0B, 0C | UNKNOWN7/8/9/B/C | unbekannt | ? | Größenbyte |
| 0A | SBOBJ | unbekannt | ? | Größenbyte |
| 0D | SHINE | unbekannt | ? | Größenbyte |
| FF | RESET | unbekannt | ? | Größenbyte |

`KAWIW` (0x29) wartet auf den Abschluss des Filters.

### 19.6 Sprung- und Label-Semantik (exakt)

**Welche Opcodes sind Sprünge** (`Opcode.cpp:201–228`):
- `isJump()` = 0x10..0x13 (JMPF/JMPFL/JMPB/JMPBL) **oder** 0x1B **oder** `isIf()`
- `isIf()` = 0x14..0x19 ∪ 0x30..0x32 ∪ 0xCB..0xCC
- `isLongJump()` = JMPFL, JMPBL, IFUBL, IFSWL, IFUWL, 0x1B
- `isBackJump()` = **nur** JMPB und JMPBL

**Der Sprung-Basisoffset (`jumpShift`, `Opcode.cpp:1255–1285`):**

| Opcode(s) | Shift |
|---|---|
| JMPF, JMPFL, 0x1B | 1 |
| JMPB, JMPBL | 0 |
| IFUB, IFUBL | 5 |
| IFSW, IFSWL, IFUW, IFUWL | 7 |
| IFKEY, IFKEYON, IFKEYOFF | 3 |
| IFPRTYQ, IFMEMBQ | 2 |
| alles andere | 0 |

`jump() = isBackJump() ? −raw : raw + jumpShift()`, Ziel = `opcodeStartOffset + jump()` (`Opcode.cpp:1110–1115`, `Script.cpp:47–48`).

> **Die eine Regel:**
> - **Vorwärtssprünge und alle IF-Sprünge: Ziel = Byteoffset des Sprungoperanden selbst + Rohwert.** (Shift 1 = JMPF-Operand bei start+1; Shift 5 = IFUB-Operand bei start+5; Shift 7 = IFSW/IFUW-Operand bei start+7; Shift 3 = IFKEY-Operand bei start+3; Shift 2 = IFPRTYQ-Operand bei start+2.)
> - **Rückwärtssprünge (nur JMPB/JMPBL): Ziel = eigener Opcode-Startoffset − Rohwert.**
> - Rohoperanden sind **vorzeichenlos** (u8 kurz, u16 lang) ⇒ **IF-Sprünge können nur vorwärts springen.**

Offsets sind **absolut im Bytestrom des jeweiligen Skripts**.

**Kodierung beim Assemblieren** (`Opcode.cpp:1287–1344`):
1. Vorzeichen des Deltas bestimmt die Richtung. JMPF↔JMPB und JMPFL↔JMPBL konvertieren automatisch; **jeder andere Opcode, der rückwärts springen soll, scheitert mit `ImpossibleBackward`**.
2. `realJump = isBackJump() ? −jump : jump − jumpShift()`
3. `realJump < 0` → `BeforeScript`; `> 65535` → `AfterScript`
4. `realJump > 255` → Beförderung zur Langform, sonst Kurzform
5. Beförderung/Degradierung schreibt die Opcode-ID um: JMPF↔JMPFL, JMPB↔JMPBL, IFUB↔IFUBL, IFSW↔IFSWL, IFUW↔IFUWL. **IFKEY/IFKEYON/IFKEYOFF/IFPRTYQ/IFMEMBQ haben keine Langform** ⇒ `ImpossibleLong`.

**Kompilieren** (`Script.cpp:156–262`): Pass 1 erfasst Labelpositionen (LABEL trägt 0 Byte bei); Pass 2 berechnet `jump = labelPos − opcodePos` und ruft `setJump`, **in einer Schleife bis kein Opcode mehr seine Größe ändert**; Pass 3 meldet Sprungfehler; abschließend `pos > 65535` → „Skript zu groß".

Fehlerklassen: `Ok`, `InsideInstruction`, `ImpossibleBackward`, `ImpossibleLong`, `AfterScript`, `BeforeScript`.

### 19.7 Fenstergeometrie-Regel der Engine

`FF7Window::realPos()` reproduziert die Klemmung der Engine (`Opcode.h:223–247`):

> wenn `x + w > 312` dann `x = 312 − w`; wenn `y + h > 223` dann `y = 223 − h`; danach `x` und `y` je auf **mindestens 8** klemmen.

Effektive Arbeitsfläche also **8..312 × 8..223** bei einer Bildschirmfläche von **320 × 224** (`TextPreview.cpp:43`, `:485–488`).

Weitere Fensterkonstanten aus dem Editor:
- Textursprung im Fenster: **x = 8, y = 6**; Zeilenvorschub **+16 px**; Zeichnen endet bei `y > maxH − 16` (`TextPreview.cpp:363`, `:370–375`).
- Rahmen-Chrome: 3 px (Hintergrundrechteck bei 3,3 mit `maxW−6 × maxH−6`).
- `WROW`-Fensterhöhe: **9 px Chrome + 16 px je Zeile** (`ScriptEditorWindowPage.cpp:125–126`, `:246–249`).
- `WREST` setzt auf **x=8, y=149, w=304, h=74** (`Opcode.cpp:1627–1633`).
- Default-Fensterverlauf: oben-links rgb(0,88,176), oben-rechts rgb(0,0,80), unten-links rgb(0,0,128), unten-rechts rgb(0,0,32) (`TextPreview.cpp:230–233`).
- `ASK`: `firstLine`/`lastLine` sind **inklusive, 0-basierte Zeilenindizes** mit 16 px Zeilenabstand; der Auswahlcursor erscheint nur auf der **letzten Textseite** (`TextPreview.cpp:452–457`).
- `WSPCL` `displayType == 1` (Uhr): fünf Glyphen bei x-Offsets +0, +16, +32, +40, +56 ab `displayX`; der **Doppelpunkt blinkt** (8 px breit, 100-ms-Timer). `displayType == 2`: nur die zwei führenden Ziffern. Ziffernglyphen sind 16 px breit.

⚠️ **Diskrepanz bei WMODE:** Die Renderer-Enum ist `Normal=0, WithoutFrameAndBg=1, Transparent=2, WithoutFrame=3` (`TextPreview.h:28–29`), das WMODE-Combo bietet aber nur 0/1/2 an und beschriftet 1 als „ohne Rahmen". **Modus 3 (rahmenlos, aber mit Hintergrund) hat keine UI-Entsprechung** — im Format existiert er offenbar.

### 19.8 Tastenbitmaske (IFKEY-Familie)

16 Tasten, Bit i entspricht `Data::key_names[i]` (`Data.cpp:515–523`):

| Bit | Taste |
|---|---|
| 0 | CAMERA / L2 |
| 1 | TARGET / R2 |
| 2 | PAGE UP / L1 |
| 3 | PAGE DOWN / R1 |
| 4 | MENU / TRIANGLE |
| 5 | OK / CIRCLE |
| 6 | CANCEL / CROSS |
| 7 | SWITCH / SQUARE |
| 8 | ASSIST / SELECT |
| 9 | ??? |
| 10 | ??? |
| 11 | START |
| 12 | UP |
| 13 | RIGHT |
| 14 | DOWN |
| 15 | LEFT |

### 19.9 Opcodes, die in einem Init-Skript abstürzen

Makou sperrt die Bearbeitung dieser Opcodes im Init-Modus, weil sie dort die Engine crashen (`ScriptEditor.cpp:36–47`, `:398–402`):

JOIN, SPLIT, DSKCG, MINIGAME, TUTOR, PMOVA, PTURA, MESSAGE, ASK, MENU, WINDOW, MAPJUMP, DFANM, ANIME1, MOVE, CMOVE, FMOVE, ANIME2, ANIMX1, CANIM1, CANMX1, TURNGEN, TURN, ANIMX2, CANIM2, CANMX2, JUMP, LADER.

> **Sehr wertvoll für `field-runtime`/`interpreter`:** Das ist eine explizite Liste von Kontextbeschränkungen der Originalengine.

### 19.10 Unbenutzte und aliasgleiche Opcodes

**Als „unbenutzt" markiert:** 0x0C, 0x0D, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x44, 0x46, 0x4C, 0x4E, 0xBE. Davon sind 0x1A, 0x1B und 0x1C **keine No-Ops**, sondern DLPB-Erweiterungen (Community-Patch) mit dokumentierter Struktur; die übrigen sind 1 Byte lang.

**Verhaltensgleiche Duplikate:** `HMPMAX1 (0x3C)`, `HMPMAX2 (0x3D)`, `HMPMAX3 (0x3F)` identisch; `MHMMX (0x3E)` heilt zusätzlich Status. `ANIME1 (0xA3)` ≡ `ANIME2 (0xAE)`; ebenso `CANIM1/CANIM2`, `CANMX1/CANMX2`. `TALKR/TLKR2` und `SLIDR/SLDR2` unterscheiden sich nur in der Operandenbreite (8 vs. 16 Bit). Der X-Block 0x76–0x7D dupliziert 0x85/0x87/0x95–0x98 semantisch (gesättigt vs. überlaufend).

### 19.11 Dekoder-Robustheit (nachbauenswert)

- `setParams` klemmt die Parameterkopie auf die verfügbaren Bytes und warnt „fixed size exceeded" — eine abgeschnittene letzte Instruktion liefert einen nullgepolsterten Opcode statt eines Fehlers (`Opcode.cpp:79–84`).
- KAWAIs `max(opcodeSize, 1)` verhindert eine Nulllängen-Instruktion.
- 0x1C-Payload wird auf 128 Byte geklemmt.
- `name()` prüft `id() < 257` und fällt auf Index 0 zurück.

### 19.12 PC-/PSX-Unterschiede auf Opcode-Ebene

Explizit dokumentiert (`Opcode.cpp:5156–5169`): Die AKAO-Kommandos **0xC8 (Musik-Pan setzen), 0xC9 (Pan-Übergang), 0xCA (Pan-Fade) und 0xDA** sind **auf PC No-Ops**. Außerdem: `PMVIE`-`movieID` löst je CD auf drei verschiedene Namen auf; `DSKCG` (0x0E) ist ein PSX-Artefakt.

### 19.13 Weitere gewonnene Konstanten

- Item-ID-Bereiche: **0–127 Items, 128–255 Waffen, 256–287 Rüstungen, 288–319 Accessoires** (`Opcode.cpp:4957–4977`; der Delegate zeigt Accessoires bis 511, `Delegate.cpp:146–181`).
- Charakter-IDs ≥ 254 bedeuten „(leer)"; IDs ≥ 100 kollabieren auf den letzten Namenseintrag.
- `SOUND`-Pan: 0..127. AKAO-Tempo 0x20 = „normal".
- Farbparameter (`color`, 24 Bit) werden gepackt als **`(blue << 16) | (green << 8) | red`** — **R im niederwertigsten Byte** (`Delegate.cpp:266–278`).
- Parameter-Bitbreiten im Editor: 32 (dword), 24 (color), 16 (word/sword/jump_l/coord_x/y/z/window_w/h/item_id/vitesse2/polygone_id/sound_id/keys/label/field_id), 8 (Default), 5 (script_id), 4 (bank), 3 (priorite), 1 (bit). **Nur `sword`, `coord_x`, `coord_y`, `coord_z` sind vorzeichenbehaftet** (`ScriptEditorGenericList.cpp:563–609`).
- Boolesche Opcodes speichern überwiegend das **negierte** Konzept (`disabled`), Ausnahmen `LINON` (`enabled`) und `VISI` (`show`) (`ScriptEditorGenericList.cpp:769–844`).

### 19.14 Von Makou selbst markierte Unsicherheiten (nicht blind übernehmen)

`OpcodeSPECIALPNAME` „4 parameters, not 1"; `OpcodeSPECIALGMSPD`/`SMSPD` FIXME; `OpcodeBGPDH` „change bank" (`variables()` sagt b1, `toString` nutzt b2); `OpcodeSTTIM` „change bank for s" (b4 vs. b3); `OpcodeMPRA2` „signed?"; `OpcodeCMTRA` „all reorganized, APCount + 1 byte, − 1 unknown, bank of var is 6, not 5"; `OpcodeSHAKE` „add var"; `OpcodeSCRLC` „new variable detected"; `OpcodeVWOFT` „last parameter has more sense"; `OpcodeSEARCHX` „varResult is 16-bit"; `OpcodeCPPAL2`/`RTPAL2` FIXME (b2 vs. b3); `OpcodeCHMPH` „reverse this"; `OpcodePDIRA` „check if really partyID"; MENU-Sub-IDs 20/24/25 TODO.

Zusätzlich **ohne deklarierte Signatur** im Editor (fallen auf rohe Bytezeilen zurück): SCRLO (0x61), SETX/GETX/SEARCHX (0x9D–0x9F), CPPAL2/RTPAL2/ADPAL2 (0xED–0xEF), CHMPH (0xF7), FMUSC (0xFC).

---

## 20. Top-Erkenntnisse für WebMidgar (nach Nutzen gerankt)

| # | Erkenntnis | WebMidgar-Paket | Warum wertvoll |
|---|---|---|---|
| **1** | **Das vollständige `param`/`state`-Modell für Hintergrund-Animation**: `state` ist eine **Bitmaske** `1 << stateID` (8 States), `param == 0` heißt „statisch, immer sichtbar"; Sichtbarkeitstest = `state == 0 \|\| (maske[param] & state)`; **Layer 1 kann nie animiert werden** (param/state/blending werden formatseitig auf 0 gezwungen). Abschnitt 18.9. | `render-field`, `field-runtime` | **Das ist der Kern von S39.** Ohne die Bitmasken-Erkenntnis baut man ein falsches Modell (State als Index). |
| **2** | **Zeichenreihenfolge = `4096 − tile.ID`**, mit festen IDs 4096/4095/0 für Layer 3/1/4 und variablem `ID` für Layer 2 ⇒ **Layer 2 verschachtelt sich tiefenweise mit der Layer-1-Platte**. `BGPDH` überschreibt das `ID` eines ganzen Layers (nur Layer 2/3) und sortiert ihn dadurch um. Abschnitt 18.5. | `render-field` | Ein naiver „Layer 1 unten, Layer 4 oben"-Renderer ist falsch. Diese eine Formel erklärt die gesamte FF7-Field-Tiefensortierung. |
| **3** | **Hintergrund-States werden auch datengetrieben über INF-Trigger gesetzt**, nicht nur per Skript: `Trigger{ line[2], background_parameter, background_state, behavior, soundID }`, `behavior` 0..5 mit „beim Betreten/Verlassen/Verlassen-auf-Plus-Seite"-Semantik; `background_parameter == 0xFF` = ungenutzt. Abschnitt 13.2. | `field-runtime`, `walkmesh`, `render-field` | Zweiter, leicht übersehener Pfad für S39. Ohne ihn bleiben viele Maps statisch. |
| **4** | **Exakte Sprungsemantik**: Ziel = **Offset des Sprungoperanden** + Rohwert (Shift-Tabelle 1/0/5/7/3/2 je Opcode-Familie), Rückwärtssprünge nur JMPB/JMPBL vom **Opcode-Start**, alle Rohwerte vorzeichenlos ⇒ IF kann nur vorwärts. Abschnitt 19.6. | `interpreter` | Off-by-N hier zerstört jedes Skript. Die Shift-Tabelle ist die einzig belastbare Formulierung, die ich gefunden habe. |
| **5** | **Vollständige Opcode-Tabelle** (256 Einträge: Nummer → Mnemonik → Gesamtlänge → Parameterliste mit Breite/Vorzeichen/Bank), inkl. SPECIAL- und KAWAI-Sub-Tabellen und der beiden variabel langen Opcodes (KAWAI 0x28, DLPB 0x1C). Abschnitt 19.3–19.5. | `interpreter`, `formats-field` | Direkt gegen die eigene Opcode-Tabelle diffbar. |
| **6** | **Sektion 3 Model-Loader, PC**: Layout mit `len`-präfigierten Namen, 8-Byte-HRC-Name und **Scale als 4-Byte-ASCII-Dezimalstring**, 3 Richtungslichter à 9 Byte + globales Licht. Abschnitt 17.1. | `formats-field`, `render-actor` | **Der ASCII-Scale ist die Falle Nr. 1 in S38.** Auch die Lichtdaten sind hier vollständig beschrieben — Makou nutzt sie gar nicht. |
| **7** | **Actor↔Model-Zuordnung ist implizit**: Die Model-ID einer Entity ist der **laufende Index unter allen Gruppen vom Typ *Model***, nicht der Gruppenindex; der Typ wiederum wird **allein aus dem ersten Opcode des Init-Skripts** abgeleitet (`PC`/`CHAR` → Model, `LINE` → Location, BG-Opcodes → Animation, `MPNAM` → Director). Abschnitte 3.4/3.5. | `field-runtime`, `render-actor` | S38-Kernkonvention. Es gibt keine explizite Typmarkierung im Format. |
| **8** | **Skeleton-/Animations-Pipeline vollständig**: HRC 4-Zeilen-Records mit **negierter, durch 132 geteilter** Bone-Länge; `.A`-Frame-Stride `24 + 12·boneCount`, PC-Rotationen als **f32-Grad**, Rotationsreihenfolge **Y→X→Z**; PC translatiert **nach** dem Zeichnen, PSX **davor**; Bones wachsen entlang lokal −Z. Abschnitte 17.3, 17.6, 17.7. | `formats-model`, `render-actor` | Reicht aus, um einen korrekten Skelett-Renderer zu bauen, inkl. der Plattform-Asymmetrie. |
| **9** | **Kameraprojektion**: `fovy = 2·atan(240/(2·zoom))`, Achsen und Position **/4096**, **Y-Achse und Y-Position negiert**, `lookAt(eye, eye+Z, up=Y)`. PSX-Folgerecords sind nur 18 Byte und **erben Position/Zoom**. Abschnitt 12. | `render-field`, `formats-field` | Die 240er-Referenzhöhe und der 4096er-Divisor sind die beiden Konstanten, an denen eigene Herleitungen typischerweise scheitern. |
| **10** | **Sektion-Index-Zuordnung PC vs. PSX** inkl. der Tatsache, dass **Sektion 6 („Tiles") auf PC ungenutzt ist, aber eine PS-formatierte Zweitkopie der Tile-Daten enthält** — nutzbar als unabhängige Verifikationsquelle für den eigenen PC-Tile-Parser. Abschnitte 2.3, 18.12. | `formats-field`, `pipeline` | Kostenloser Cross-Check für S39. |
| **11** | **Text-Steuercodes vollständig**: 0xE7 = Zeilenumbruch (**nicht** Seitenumbruch!), 0xE8/0xE9 = Seitenumbruch, 0xFE-Untercodes für Farbe/Blinken/Regenbogen/Variablen/`{MEMORY}` (4 Folgebytes), 7 Zeichentabellen. Abschnitt 5. | `dialog`, `formats-field` | Die 0xE7/0xE8-Verwechslung ist ein verbreiteter Fehler. |
| **12** | **Fenstergeometrie-Regel der Engine**: `x+w > 312 → x = 312−w`, `y+h > 223 → y = 223−h`, dann min 8; Bildschirmfläche 320×224; Textursprung (8,6); Zeilenhöhe 16; `WROW`-Höhe = 9 + 16·Zeilen; `WREST` → (8,149,304,74). Abschnitt 19.7. | `dialog`, `menu` | Direkt implementierbare Layoutregeln. |
| **13** | **Walkmesh-Layout + Nachbarschaftssemantik** (`a[0]` = Kante v1–v2 usw., `-1` = Wand) und die Konvention, dass **`vertices[0].z` die repräsentative Höhe** eines Dreiecks ist. Abschnitt 11. | `walkmesh`, `formats-field` | Kompakt und eindeutig; die Kanten-Zuordnung ist anderswo oft falsch dokumentiert. |
| **14** | **Sektion-1-Layout inkl. der Quirks**: Textanzahl wird aus `offset[0]/2 − 1` abgeleitet statt aus `nbTexts`; Skript-0 enthält Init+Main, getrennt am ersten `RET`, **wobei durch Vorwärtssprünge übersprungene `RET`s nicht zählen**; degenerierte Gruppen-Offsettabellen; Android-Variante mit `posTexts` hinter `posAKAO`. Abschnitt 3. | `formats-field` | Diese vier Quirks sind exakt die Stellen, an denen ein Parser an Realdaten scheitert. |
| **15** | **Blend-Modi mit exakter Kanalmathematik** (Average / Plus / Minus / +25 %) **und** die Warnung, dass der Blend-Modus auf PC **zusätzlich über den Texturseiten-Index kodiert** ist (Klassenbereiche 0–14 / 15–23 / 24–25 / 26–32 / 33–39 / 40–41). Abschnitte 18.7, 18.11. | `render-field` | Der Texturindex-Trick ist nirgends offensichtlich und beeinflusst das Rendering direkt. |
| **16** | **Liste der Opcodes, die in einem Init-Skript die Engine crashen** (28 Stück). Abschnitt 19.9. | `interpreter`, `field-runtime`, `modding` | Als Validator-Regel direkt übernehmbar. |
| **17** | **Direct-Color-16-Bit-Dekodierung auf PC**: `0x0000` = transparent, **`0x0821` = opakes Schwarz** (Sonderfall!), sonst `b = c&31, g = (c>>6)&31, r = c>>11` — **Bit 5 wird übersprungen**; die „offizielle" Portformel ist nachweislich fehlerhaft. Abschnitt 18.7. | `render-field`, `convert` | Ohne den `0x0821`-Sonderfall wird schwarzes Bildmaterial durchsichtig. |
| **18** | **Bank-/Savemap-Modell**: Banks 1–15, je 256 Adressen, Paare 1-2/3-4/5-6/11-12/13-14/**15-7**, Banks 8/9/10 temporär; Bank 0 = Literal; bei Bank ≠ 0 zählen nur die unteren 8 Bit. Plus 43 bekannte Variablennamen. Abschnitte 7, 19.2. | `interpreter`, `formats-save` | Das asymmetrische Paar 15↔7 ist ein echter Stolperstein. |
| **19** | **INF-Parallaxfelder für Layer 3/4** (`width/height`, `x/y_related`, `x/y_multiplier_related`) und `bg_layer1_flag` = 1 normal / 2 vertikal gespiegelt. Abschnitt 13. | `render-field` | Der statische Gegenpart zu `BGSCR`; für S39 unverzichtbar, auch wenn die Semantik nur halb reversiert ist. |
| **20** | **`.P`-Mesh-Layout mit den zwölf Tabellen** und den drei nichttrivialen Auflösungsregeln (Vertexfarbe teilt den Vertexindex; Texcoord nutzt `texCoordStartIndex + poly.VertexIndex[j]`; Textur nur bei `areTexturesUsed`). Abschnitt 17.5. | `formats-model`, `render-actor` | Die „Hundred"-Tabelle (Renderstate, 100 Byte) ist von Makou ungenutzt — potenzieller Qualitätsvorsprung für WebMidgar. |
| **21** | **Encounter-Bitpackung** (6 Bit Wahrscheinlichkeit / 10 Bit Formations-ID) und dass **`BTLTB` auf Tabelle 2 umschaltet**. Abschnitt 14. | `formats-field`, `battle-runtime` | Kompakter Cross-Check zu S33. |
| **22** | **Tutorial-Bytecode als eigene Mini-VM** (0x00 PAUSE, 0x02–0x0F Tasten, 0x10 TEXT, 0x11 FINISH, 0x12 MOVE, 0xFF NOP) und die AKAO-Blockstruktur mit dem realen Datenfehler „abgeschnittenes Magic" (`KAO…`/`AO…`). Abschnitt 4. | `formats-field`, `dialog`, `audio` | Kleine, aber vollständig gelöste Teilformate. |
| **23** | **kernel2.bin-Struktur** (LZS + 4-Byte-Größenkopf, 11 Unterabschnitte, ab Index 10 Item/Waffen/Rüstungs-/Accessoire-/Materia-Namen; Namenslisten mit u16-Offsettabelle, Anzahl = `offset[0]/2`). Abschnitt 8. | `formats-kernel` | Dasselbe Offsettabellen-Muster wie im Field-Textblock — einmal implementieren, zweimal nutzen. |
| **24** | **PC-`maplist` weicht an 19 Indizes von der PSX-Liste ab** (88–92, 153, 164–169, 174, 175, 586, 735). Abschnitt 9. | `formats-field`, `pipeline` | Sonst zeigen 19 `MAPJUMP`-Ziele auf falsche Maps. |
| **25** | **PSX-VRAM-Bias im DAT-Header**: Die 7 u32-Offsets sind Speicheradressen; `vramDiff = offset[0] − 28` muss abgezogen werden. Abschnitt 2.4. | `formats-field` | Kurz, aber ohne diese Zeile ist keine PSX-Datei lesbar. |

---

## 21. Offene Fragen und Widersprüche

### 21.1 Vom Repo selbst als ungelöst markiert

| Thema | Status | Konsequenz für WebMidgar |
|---|---|---|
| **Exakte `IDBig`-Berechnung** (feines Z der Hintergrundkacheln) | Makou verwendet zweimal `// FIXME: approximation` (`(ID/4096)·10⁷`). Der echte Wert ist ein Kameraprojektionsergebnis. | Für reines Rendering irrelevant (die grobe `ID`-Sortierung reicht), **aber** für byte-genaues Zurückschreiben und für exakte Tiefenvergleiche gegen Modelle relevant. **Eigene Herleitung nötig.** |
| **Exakte 3D→2D-Hintergrundprojektion der Engine** | Nur als dekompilierter EXE-Auszug im Kommentar vorhanden (**kontaminiert**, siehe 12.4). Konstante `caMatrixY = 90` ist selbst mit `// FIXME` markiert. | **Muss unabhängig hergeleitet werden.** Nicht aus diesem Repo übernehmen. |
| **INF-Parallaxsemantik der Layer 3/4** | Feldnamen enden auf `_related` — Makou weiß nur, dass die Felder existieren, nicht wie sie wirken. | **S39-Blocker.** Empirische Ermittlung an Maps mit sichtbarem Parallax (z. B. Zug-/Wolkenszenen) nötig. |
| **`BGSCR`-Anwendung** | Makou liest die Scroll-Offsets aus, **wendet sie aber nie an**. | Kein Referenzverhalten verfügbar; Verhalten muss selbst bestimmt werden. |
| **KAWAI-Sub-Opcodes 0x03–0x0D** | Nur 0x00 (EYETX), 0x01 (TRNSP) und 0x02 (AMBNT) haben bekannte Payloads. `LIGHT`, `SBOBJ`, `SHINE`, `RESET` und sechs `???` sind leere Structs. | Für S38 (Actor-Rendering mit Beleuchtung/Shine) eine **echte Wissenslücke**. Die Payloadlänge ist immerhin aus dem Größenbyte bekannt. |
| **`SPECIAL PNAME` (0x0F 0xF6)** | Struct sagt 4 Parameter, Größentabelle sagt 1, Editor bietet 3 an. Makou ist hier **nachweislich falsch**. | Nicht von Makou übernehmen; an Realdaten messen. |
| **`CHMPH` (0xF7)** | „FIXME: reverse this" — Zweck unbekannt. | Als opak behandeln. |
| **`SCRLO` (0x61), `MPDSP` (0x69), `VWOFT` (0x6A)** | Parameter heißen `unknown`; VWOFT: „last parameter has more sense". | Als opak behandeln. |
| **Encounter-Wahrscheinlichkeitsbudget** | Die Regel (summieren die 10 Werte auf 64?) steckt in `EncounterTableWidget` aus **ff7tk**, nicht in diesem Repo. | Aus ff7tk oder Realdaten klären. |
| **Kameraauswahl per Skript** | Kein Opcode setzt einen CA-Record-Index. Makou nutzt immer Kamera 0. | Offene Frage: Wie wählt die Engine bei mehreren CA-Records aus? Vermutlich über die Walkmesh-Position — **selbst zu ermitteln**. |
| **`WMODE`-Modus 3** | Der Renderer kennt `WithoutFrame = 3`, das Format-UI bietet nur 0/1/2. | Prüfen, ob 3 in Realdaten vorkommt. |

### 21.2 Widersprüche *innerhalb* von Makou (nicht blind einer Seite folgen)

| Ort | Widerspruch |
|---|---|
| `BGPDH` | `variables()` weist `targetZ` Bank 1 zu, `toString` Bank 2. Header trägt „FIXME: change bank". |
| `STTIM` | `s`-Operand: Struct/`variables()` sagen Bank 4, `toString` nutzt Bank 3. |
| `CPPAL2` / `ADPAL2` | Bank-Zuordnung von `posDst` bzw. b/g/r weicht zwischen Structkommentar und `toString` ab. |
| `TilePC` | Kommentar „Sizeof : 36", tatsächlich 40; Inline-Marker `// 32` an `IDBig`, tatsächlich Offset 36. |
| `HeaderLayer4TilePC` | Kommentar „Sizeof : 10", tatsächlich 8, geschrieben werden 8. |
| `EncounterFile` | `setBattleEnabled` überschreibt das ganze Byte, das Widget nur Bit 0. |
| Blend-Typ 3 | UI-Label „Source +25 % destination", Implementierung rechnet `dest + 25 % source`. |
| PS-Tile-Grenzprüfung | Layer 1 nutzt `&&` für die dstX/dstY-Überlaufprüfung, Layer 2/3/4 nutzen `||`. |

### 21.3 Punkte, die gegen den aktuellen WebMidgar-Stand zu prüfen sind

1. **Sektionsnummerierung.** Falls in WebMidgar irgendwo „Sektion 2 = Walkmesh" steht: falsch. PC-Reihenfolge ist Skripte, **Kamera**, Model-Loader, **Palette**, **Walkmesh**, Tiles, Encounter, INF, Background. Palette (Index 3) existiert **nur** auf PC.
2. **Textumbruchcodes.** 0xE7 = Zeilenumbruch, 0xE8/0xE9 = Seitenumbruch. Falls invertiert implementiert, brechen alle mehrseitigen Dialoge.
3. **State-Semantik im Hintergrund.** Falls `state` als Index statt als Bitmaske behandelt wird, sind alle Mehrfach-States falsch.
4. **Model-ID-Ableitung.** Falls der Gruppenindex statt des laufenden Model-Index verwendet wird, laden ab der ersten Nicht-Model-Gruppe alle Actors das falsche Modell.
5. **Bank-Paar 15↔7.** Alle anderen Paare sind (2n−1, 2n); dieses nicht.
6. **`X`-Suffix-Arithmetik.** `PLUS` überläuft, `PLUSX` sättigt. Falls als Duplikate behandelt, driften Savemap-Werte.
7. **Sprung-Basisoffset.** Prüfen, dass IF-Sprünge vom **Operandenoffset** und nicht vom Opcode-Start oder Opcode-Ende gerechnet werden.
8. **Encounter-Sektionsindex.** PC 6, PSX 5 — Layout aber identisch.
9. **Gateway-/Trigger-„Deaktiviert"-Sentinels.** `fieldID == 0x7FFF` bzw. `background_parameter == 0xFF`. Es gibt **kein** Enable-Bit.
10. **`dir_copy1..3` in Gateways.** Beim Schreiben alle vier Bytes gleich setzen.

### 21.4 Was dieses Repo **nicht** enthält (anderswo suchen)

- **LZS-Algorithmus** (Fenstergröße, Kontrollbit-Reihenfolge, Offset-Bias) — liegt in `ff7tk`, hier nur die Aufrufkonvention `LZS::decompress(ptr, size, maxOut)`.
- **LGP-Archivstruktur** (TOC-Eintragsgröße, CRC-/Lookup-Tabelle, Terminator) — ebenfalls `ff7tk`.
- **FF7String-Zeichentabelle** selbst — nur das Metrik-/Renderverhalten ist hier belegt; die Tabelle kommt aus `window.bin`.
- **`PsColor::fromPsColor`/`toPsColor`** (exakte BGR555↔RGB888-Rundung für **Paletten**) — `ff7tk`. Nur der PC-Direct-Color-Pfad ist lokal belegt.
- **`CHARACTER_WIDTH`/`LEFT_PADD`-Makros** (Bitpackung von Breite und linkem Padding in ein Byte) — `ff7tk`.
- **ISO-/CD-Sektorlayout** (2352/2048, Mode 2 Form 1) — `IsoArchive` aus `ff7tk`.
- **`EncounterTableWidget`, `OrientationWidget`, `ListWidget`, `WindowBinFile`** — alle `ff7tk`.

> **Empfehlung:** Für LZS und LGP ist `ff7tk` (ebenfalls GPL) die nächste Quelle — mit **derselben Clean-Room-Disziplin**. Beide Formate sind aber auch aus öffentlichen Qhimm-Wiki-Beschreibungen und aus Realdaten unabhängig herleitbar, was rechtlich sauberer ist.

> **Querverweis:** Für `ff7tk` existiert bereits eine eigene Recherchenotiz in diesem Verzeichnis
> (`research/ff7tk.md`, Lizenz **LGPL-3.0-or-later**). Dort sind LZS (Okumura-LZSS, 4096-Byte-Ringpuffer,
> Startschreibposition **4078 = 0xFEE**, 8-Flag-Kontrollbyte LSB-first mit 1 = Literal, Match als 2 Byte
> = 12-Bit-Offset + 4-Bit-(Länge−3), max. Match 18) und die LGP-TOC samt 30×30-Lookup-Hash bereits
> dokumentiert. Die oben als „hier nicht enthalten" markierten Punkte sind dort größtenteils abgedeckt.
