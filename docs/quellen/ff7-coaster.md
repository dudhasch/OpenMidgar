# ff7-coaster (ergonomy-joe) — Recherchenotizen für WebMidgar

Erhebungsdatum: 2026-08-10
Quelle: https://github.com/ergonomy-joe/ff7-coaster
Lokaler Klon (nur Scratchpad): `C:\Users\timur\AppData\Local\Temp\claude\C--ff7-web\b414bdf9-1c92-4887-8d93-1c2edd9fa485\scratchpad\repos\ff7-coaster`
Einziger Commit: `825f4ba` „Add files via upload"; GitHub `pushed_at` 2024-11-25.

---

## 0. LIZENZ- UND CLEAN-ROOM-WARNUNG (zuerst lesen)

**Das Repository hat KEINE Lizenz.** Verifiziert über die GitHub-API:
`gh api repos/ergonomy-joe/ff7-coaster --jq .license` → `null`. Es existiert keine
LICENSE-, COPYING- oder NOTICE-Datei im Repo (Dateiliste s. §1).

**Schlimmer als „keine Lizenz": Es ist dekompilierter Originalcode.** Jede Datei trägt
den Kopf `Final Fantasy VII / (c) 1997 Square / decompiled by ergonomy_joe in 2018`.
Die Dateinamen sind Funktionsadressen der Original-`ff7.exe` (`C_005EAB70.cpp` =
Funktion bei `0x005EAB70`). Zwei binäre Statik-Bibliotheken (`FF7LIB.lib`, `FF7SND.lib`,
zusammen ~6,6 MB) sind ausgeschnittene Teile des Originalspiels — also
unlizenzierter, urheberrechtlich geschützter Square-Enix-Code in Binärform.

Konsequenzen für WebMidgar:

- **Niemals Code aus diesem Repo kopieren, übersetzen oder transliterieren.**
  Auch eine 1:1-TypeScript-Umschreibung einer dekompilierten C-Funktion ist ein
  abgeleitetes Werk.
- **Niemals die `.lib`-Dateien oder `tools/coaster.obj` weiterverteilen.**
- Was gefahrlos verwertbar ist: **Beobachtungen über Datenformate** (Feld-Offsets,
  Stream-Indizes, Wertebereiche) — dieselbe Klasse von Fakten, die man auch durch
  eigenes Hexdump-Studium von `coaster.lgp` gewinnen würde. Diese Notizen enthalten
  bewusst nur **Beschreibungen mit Adressangabe**, keinen Quelltext.
- **Riskant und daher hier nicht übernommen:** konkrete Formelketten aus der
  Objektlogik (`C_005EAB70.cpp`), die Renderer-Vertexaufbauten (`C_005EF4D0.cpp`)
  und alle Makrodefinitionen. Wer die Coaster-Mechanik je nachbaut, sollte das
  **ausschließlich aus Spielbeobachtung / eigenem Datei-Reverse-Engineering**
  tun und diese Notizen nur als Landkarte („wo suche ich?") benutzen.
- Empfehlung: dieses Repo **nicht** in `C:\ff7-web` einchecken, nicht in ADRs
  zitieren als „Vorlage", höchstens als externe Beobachtung mit Adressverweis.
  Für Personen, die WebMidgar-Code schreiben, ist die sicherste Haltung: **gar nicht
  hineinsehen** (Chinese-Wall). Diese Notizen sind das Destillat für die
  Spezifikationsseite der Wall.

---

## 1. Was das Repo ist

Ein baubares Visual-Studio-2008-Projekt, das **exakt ein FF7-Minispiel** aus der
PC-Version 1998 als eigenständige EXE startet: die **Achterbahn-Schießbude im
Gold Saucer („Jet Coaster" / „Speed Square")**. Der Spieler fährt auf Schienen
und schießt mit einem Fadenkreuz auf Ziele; am Ende zählt der Score.

Der Autor hat die Minispiel-spezifischen Funktionen als C++ rekonstruiert, den
gemeinsamen Engine-Unterbau aber als **Binärbibliotheken** beigelegt:

| Datei | Größe | Inhalt |
|---|---|---|
| `CoasterMain.cpp` | 413 Z. | Ersatz-`main`, Registry-Checks, Mock-Pad-Treiber |
| `NEWFF7/C_005E8A70.cpp` | 289 Z. | Launcher: Viewport, Frame-Takt, UPDATE/BEGIN/END-Callbacks |
| `NEWFF7/C_005E9150.cpp` | 246 Z. | Ressourcen + Sound/MIDI |
| `NEWFF7/C_005E98E0.cpp` | 480 Z. | Kern: Rendering von Objekten/Track/Hintergrund, Kamera |
| `NEWFF7/C_005EA8C0.cpp` | 97 Z. | Track-Position, Schwerkraft, View-Matrix |
| `NEWFF7/C_005EAB70.cpp` | 1142 Z. | **Spielobjekt-Zustandsmaschine** (größte Datei) |
| `NEWFF7/C_005ED8F0.cpp` | 293 Z. | Streaming-Listen für Track/Hintergrund |
| `NEWFF7/C_005EE150.cpp` | 167 Z. | Eingabe |
| `NEWFF7/C_005EE7F0.cpp` | 90 Z. | Modell-„Ladung" (Zeiger in Streams) |
| `NEWFF7/C_005EEA50.cpp` | 220 Z. | Halbraum-/Frustum-Test |
| `NEWFF7/C_005EF1C0.cpp` | 128 Z. | Szenengraph-Knotenpool |
| `NEWFF7/C_005EF4D0.cpp` | 803 Z. | **Renderer-Klasse** (D3D-Vertexaufbau, HUD) |
| `NEWFF7/psxdata_c.cpp` | 78 Z. | Stream-Container (`xbin.bin`/`xbinadr.bin`) |
| `NEWFF7/initpath.cpp` | 412 Z. | Registry-Pfade + **LGP-Archiv-Tabelle** |
| `NEWFF7/C_00404D80.cpp`, `C_004067A0.cpp`, `C_0040A460.cpp` | 33/203/308 Z. | Registry-Konfiguration (Grafik/Sound/MIDI) |
| `NEWFF7/ff7.h` | 1137 Z. | **Adressannotierte Prototypen der ganzen Engine** |
| `NEWFF7/ff7_structs.h` | 1794 Z. | Engine-Strukturen (D3D-Wrapper, Vertex, App-Objekt) |
| `NEWFF7/coaster_data.h` | 303 Z. | Coaster-Strukturen + Adresstabelle |
| `NEWFF7/loadmenu.h` | 223 Z. | **Savemap-Layout** (`t_loadmenu_10f4`) |
| `NEWFF7/ff7_sound.h` | 213 Z. | Sound-Treiber-Opcodes |
| `FF7LIB.lib` / `FF7SND.lib` | 5,9 MB / 736 KB | Binärteile des Originals — **nicht anfassen** |
| `tools/coaster.obj` | 2,3 MB | Wavefront-OBJ-Export der Streckengeometrie |

`tools/coaster.obj` ist reiner ASCII-OBJ: 48 088 `v`, 10 320 `f` (jede Fläche mit
eigenem `newmtl`/`Kd`, also Vertex-/Face-Farben statt Texturen), 8 564 `l`
(Linien — vermutlich die Schienenzüge), 31 `g`. Die Größenordnungen passen exakt
zu den Pools im Code (12 000 Hintergrunddreieck-Slots, 9 000 Track-Slots, §4).
Das ist extrahierte Spielgeometrie → ebenfalls nicht weiterverteilen.

Laufzeitvoraussetzung laut README: nur `coaster.lgp` aus der Windows-Version plus
korrekte Registry-Einträge.

---

## 2. Datendateien des Minispiels

Alle Coaster-Daten liegen in **`coaster.lgp`** (Archiv-ID `ARCHIVE_09 = 9`),
Pfad `<DataPath>/minigame/coaster.lgp` (`initpath.cpp`, `__004079B8` Fall `0x09`).

Einträge im LGP, die der Code namentlich öffnet:

| Eintrag | Verwendung | Fundstelle |
|---|---|---|
| `xbinadr.bin` | Offset-Tabelle (Array von `int`) | `C_005E9319`, `psxdata_c::init` |
| `xbin.bin` | eigentlicher Datenblob, in Streams unterteilt | dito |
| `score.tim` | Ziffern-/„SCORE"-Textur | `Class_coaster_D8`-Ctor `0x005EF4D0` |
| `co1.tim` | Statusbox | dito |
| `waku2.tim` | „waku" = Rahmen der Schusskraft-Anzeige | dito |
| `pause.tim` | Pause-Overlay | dito |
| `rail.tim` | Schienentextur | dito |
| `sight.tim` | Fadenkreuz | dito |
| `beam1.tim`, `beam2.tim`, `beam3.tim` | 3 Laserstrahl-Frames (zyklisch) | dito |

### `xbinadr.bin` / `xbin.bin` — das zentrale Format

`psxdata_c` (deklariert in `coaster_data.h`, implementiert in `psxdata_c.cpp`,
Ctor bei `0x005EE620`) lädt beide Dateien komplett in den Speicher. `xbinadr.bin`
ist ein Array von 32-Bit-Offsets, die **noch PSX-Absolutadressen** sind: der Code
liest `pOffset[0]` als Basis und zieht sie von allen Einträgen ab. Danach ist
`pOffset[i]` ein Byte-Offset in `xbin.bin`. Ein Zugriff mit `offset >= dwDataSize`
gilt als „leerer Stream" (liefert Null).

> **Wichtiger Befund für WebMidgar:** Das ist ein wiederverwendbares Muster —
> die PC-Portierung hat PSX-Speicherabbilder 1:1 übernommen und rebasiert nur die
> Zeigertabelle. Wer `coaster.lgp` (oder analoge Minispiel-Archive) parst, muss
> also mit *absoluten PSX-RAM-Adressen* als Offsets rechnen.

Stream-Belegung (Index → Bedeutung), rekonstruiert aus den Zugriffsstellen:

| Idx | Inhalt | belegt in |
|---|---|---|
| 1 | Modell-Infotabelle: pro Modell `numTri`, `numQua`, zwei `SVECTOR` als AABB-Ecken (Struktur 0x14 Byte) | `C_005EE7F0` |
| 2 | Skript „Track-Element hinzufügen": `u16`-Liste, `0xFFFF` = Blockende | `C_005ED8F0` |
| 3 | Skript „Track-Element entfernen", gleiches Format | `C_005ED8F0` |
| 4 | Schienen-Stützpunkte (`SVECTOR`-Arrays); Index 0 = linke Schiene, 1 = rechte | `C_005EA8C0`, `C_005EAAF3`, `C_005E98E0` |
| 5 | Offsets in Stream 4 (`int[]`) | dito |
| 6 | Längen zu Stream 4 (`int[]`); `[0]` = Gesamtlänge der Strecke | dito |
| 7 | Kamera-Bahn: pro Streckenindex ein `SVECTOR` mit Rotationswinkeln | `C_005E98E0` |
| 8 | Skript „Hintergrunddreieck hinzufügen" (`u16`, `0xFFFF`-terminiert) | `C_005ED8F0` |
| 9 | Skript „Hintergrunddreieck entfernen" | `C_005ED8F0` |
| 0xA | Dreieck-Pool: `t_coaster_Triangle`, 0x24 Byte = 3×`SVECTOR` + 3×RGBA | `C_005EE7F0`, `C_005E9E7E` |
| 0xB | Bahnkurven der Spielobjekte (`SVECTOR`-Punkte) | `C_005EAC30` |
| 0xC | Offsets in Stream 0xB | dito |
| 0xD | Längen zu Stream 0xB | dito |
| 0xE | Spawn-Tabelle: Datensätze à 0x60 Byte (`ObjType`, `ModelId`, `PathIndex`, `Speed`, 20×`int` Parameter) | `C_005EB391` |
| 0xF | pro Streckentick ein Byte: „wie viele Objekte hier spawnen" | `C_005EB391` |
| 0x10 | Quad-Pool — **im Coaster leer/ungenutzt** | `C_005EE7F0` |

Die Streams 5/6 werden auch für die Bahn des Spielerwagens benutzt (`C_005EAC30`
mit Modus 1), die Streams 0xB/0xC/0xD für alle übrigen Objekte (Modus 0).

### Geometrieformat

- `t_coaster_Triangle` (0x24 B): drei `SVECTOR` (je 4× `short`, PSX-Konvention),
  danach drei RGBA-Farben. **Kein UV** — die Objekte sind vollständig
  vertexgefärbt, nur HUD/Schiene/Beam sind texturiert.
- `t_coaster_Quad` (0x28 B) existiert in der Struktur, wird aber nie gerendert;
  ein Kommentar merkt an, dass die Farben 2 und 3 in den `pad`-Feldern der
  `SVECTOR` versteckt wären — dasselbe Packmuster wie in FF7s Chocobo-Rennen
  (`t_chocobo_data_DG4`). **Hinweis für formats-model:** das `pad`-Feld eines
  PSX-`SVECTOR` ist in FF7-Daten oft Nutzlast, kein Füllbyte.
- Modelle sind keine eigenen Records: `C_005EE8CF` (0x005EE8CF) läuft die
  Modellinfotabelle (Stream 1) sequenziell ab und schneidet aus dem globalen
  Dreieckspool (Stream 0xA) `numTri` Dreiecke für Modell *n* heraus. Der Pool ist
  also **in Modellreihenfolge konkateniert**; es gibt keine Per-Modell-Offsets.
  100 Modelle (`0x64`) werden beim Start erzeugt, der Pool fasst 0x8C Slots.
- Die AABB aus Stream 1 wird nicht als Box benutzt, sondern in **6 Flächenmittel-
  punkte** umgerechnet, die später projiziert werden (§5).

---

## 3. Adressen in `ff7.exe` (Version 1.00, US)

`ff7.h` ist die wertvollste Datei: über 1100 Zeilen Prototypen, **jede mit der
Originaladresse als Kommentar**. Auszug der für WebMidgar interessanten Cluster:

| Adressbereich | Subsystem |
|---|---|
| `0x00404D80`–`0x0040A9xx` | Registry/Konfiguration (Graphics/Sound/Midi) |
| `0x00406D10`–`0x004079B8` | `initpath.cpp`: Pfade + **LGP-Auswahl nach ID** |
| `0x004082BF`–`0x0040A091` | `main.cpp`: Init, Callback-Registrierung |
| `0x00660370`–`0x00660489` | `TS_*`: CPU-Timestamp-Zähler (RDTSC-basiert) |
| `0x00660540`–`0x00660EEB` | `g_drv_*`: Grafiktreiber-Vtable (Viewport, Clear, Flip, RenderState, Begin/EndScene) |
| `0x00661000`–`0x00663A48` | `psx_*`: Nachbau der PSX-`libgte` (RotMatrix, CompMatrix, rsin/rcos, SquareRoot0, ratan2, OuterProduct, VectorNormal, ApplyMatrix, RotTransPers …) |
| `0x006750E0`–`0x006763A5` | `is_lib`: **LGP-Archivzugriff** (open/close/get entry offset/get entry size/load entry/read bytes) |
| `0x00670000`–`0x006B27A9` | `dx_sfx`, `dx_rend`, `dx_mat`, `dx_spr`, Polygon-/Light-Pipeline |
| `0x00740D80`–`0x0074934A` | Sound-Treiber (Opcode-Dispatch) und MIDI |
| `0x005E8A70`–`0x005F2924` | **das Coaster-Minispiel** |

Einzeladressen, die im Coaster-Code namentlich fallen und über das Minispiel
hinaus gelten:

| Adresse | Bedeutung |
|---|---|
| `0x00675511` | LGP-Archiv öffnen (Name, Slot-ID) |
| `0x006759D2` | Eintrag suchen → Offset |
| `0x006762EA` | Eintragsgröße |
| `0x0067633E` | Eintrag in Puffer laden |
| `0x00675F1D` | Archiv schließen |
| `0x00676578` | globales App-Objekt (`t_aa0`) holen |
| `0x00661939` | PSX-Matrix auf Identität |
| `0x00661966` | LH/RH-Flag setzen (Coaster nutzt 0) |
| `0x006611FB` | PSX-`MATRIX` → `D3DMATRIX` |
| `0x0066134B` | `D3DMATRIX` → PSX-`MATRIX` |
| `0x0067CCDE` | Projektionsmatrix aus FOV/Near/Far/Center/Viewport |
| `0x00660E95` | **Render-Layer umschalten (0/1)** |
| `0x0066E641` | Sprite-Batch rendern |
| `0x0066E272` | Platz für *n* Primitive im Batch anfordern |
| `0x00742055` / `0x00742E2B` | MIDI play / stop |
| `0x00740D80` | Sound-Opcode absetzen (9 Argumente) |

### LGP-Archiv-IDs (aus `__004079B8`, `initpath.cpp`)

Diese Tabelle gilt für die ganze Engine, nicht nur fürs Minispiel:

| ID | Pfad |
|---|---|
| 0x00 | `field/char.lgp` |
| 0x01 | `field/flevel.lgp` |
| 0x02 | `battle/battle.lgp` |
| 0x03 | `battle/magic.lgp` |
| 0x04 | `menu/menu_us.lgp` |
| 0x05 | `wm/world_us.lgp` |
| 0x06 | `minigame/condor.lgp` |
| 0x07 | `minigame/chocobo.lgp` |
| 0x08 | `minigame/high-us.lgp` |
| 0x09 | `minigame/coaster.lgp` |
| 0x0A | `minigame/snowboard-us.lgp` |
| 0x0B | MIDI-Archiv (Name vom MIDI-Treiber, `0x007443E7`) |
| 0x0E | `cd/moviecam.lgp` |
| 0x0F | `cd/cr_us.lgp` |
| 0x10 | `cd/disc_us.lgp` |
| 0x11 | `minigame/sub.lgp` |

Bemerkenswert: `char.lgp`, `flevel.lgp`, `world_us.lgp` und alle Minispiele hängen
am *AppPath*-Zweig (bzw. `DataDrive` + `ff7/` bei Nicht-Vollinstallation), während
`battle.lgp`, `menu_us.lgp`, `cd/*` am *DataPath* hängen. Für einen Web-Loader ist
das die Erklärung, warum FF7-Installationen zwei Wurzelverzeichnisse haben.

### Registry-Schlüssel

Wurzel `HKLM\Software\Square Soft, Inc.\Final Fantasy VII`, Werte `AppPath`,
`MoviePath`, `DataDrive`, `DataPath`, `FullInstall`, `Sound` (`"ON"`), `Midi`
(`"ON"`). Unterschlüssel `\1.00\Graphics` (`DD_GUID`, `Driver` [0=SW, 1=HW,
2=OpenGL, ≥3=DLL-Treiber], `DriverPath`, `Mode`, `Options`), `\1.00\Sound`
(`Sound_GUID`, `SFXVolume`, `Options`), `\1.00\Midi` (`MIDI_DeviceID`,
`MusicVolume`, `MIDI_data`, `Options`). Lautstärken sind 0–100.

`Graphics\Mode` steuert die Auflösung (`C_00404D80` + `C_005E8BDE`):

| Mode | Viewport | Skalierungsfaktoren x/y |
|---|---|---|
| 0 | (0,0,320,240) | 1 / 1 |
| 1 | (160,120,320,240) | 1 / 1 |
| 2 | (0,0,640,480) | 2 / 2 |
| sonst | wie 0 | 1 / 1 |

Das gesamte HUD rechnet in 320×240-Koordinaten und multipliziert mit diesen
Faktoren plus Viewport-Ursprung — ein sauberes, übernehmbares **Designmuster**
(logische Auflösung + Skalar), das WebMidgar in `render-field` spiegeln kann.

---

## 4. Laufzeitmodell (die für WebMidgar wirklich relevanten Mechaniken)

### 4.1 Frametakt — „60 Ticks/s, entkoppelt vom Rendern"

`C_005E8F9B` (`0x005E8F9B`) misst mit dem CPU-Timestamp-Zähler (`TS_getCPUTimeStamp`
= RDTSC, `0x00660370`) die Zeit seit dem letzten Aufruf, teilt durch die im
App-Objekt (`t_aa0::f_030`, Offset 0x030) hinterlegten **CPU-Zyklen pro Sekunde**
und multipliziert mit **60,0** → Anzahl fälliger Logiktakte als `float`.

Konstanten und Regeln:

- Nennfrequenz der Simulation: **60 Hz**.
- Obergrenze pro Frame: **32,0 Ticks** (Clamp gegen Aufholspiralen nach Stotterern).
- Der Akkumulator `D_00C3F6E8` („next frame") und der Zähler `D_00C3F6EC`
  („frame counter") sind beide `float`.
- In `C_005E8E7E` (`0x005E8E7E`) läuft die Aufholschleife: solange
  `counter + 1 < accumulator`, wird die Logik **mit abgeschaltetem Zeichnen**
  ausgeführt (globales Flag `D_009014A8 = 0`); der letzte Tick läuft mit
  `D_009014A8 = 1` und zeichnet.
- Der Autor merkt an, dass Coaster, Highway und Snowboard **denselben Taktmechanismus**
  benutzen.

> **Top-Erkenntnis:** Das ist exakt ein *fixed-timestep with render-on-last-tick*,
> ohne Interpolation. FF7-PC hat also keine variable Physik — jede Simulation
> tickt in 1/60-Schritten. Für WebMidgar heißt das: `requestAnimationFrame`-Delta
> in 60-Hz-Ticks umrechnen, auf 32 clampen, N-1 Ticks „stumm" ausführen.
> Das ist eine reine Verhaltensbeobachtung, kein Code.

### 4.2 Fortbewegung, Kamera, Schwerkraft

- Streckenposition `D_00C3F778` und Geschwindigkeit `D_00C3F768` sind
  **16.16-Festkomma** (`>>16` = Stützpunktindex, untere 16 Bit = Interpolations-
  bruchteil). Startgeschwindigkeit 10 000; Normalfahrt pendelt um `0x4000`.
- `C_005EA194` (`0x005EA194`) baut Position **und** Orientierung der Kamera rein
  aus der Geometrie: linke und rechte Schiene werden getrennt interpoliert, ihre
  Mitte ist die Wagenposition; Tangente (Mitte[i+1]−Mitte[i]) und Normale
  (rechts−links) ergeben per Kreuzprodukt + Normalisierung die **Binormale**, auf
  der der Höhenversatz aufgetragen wird (−100 für die Kamera, +10 für den Wagen).
  Ein ASCII-Diagramm im Original erklärt die Stützpunktanordnung.
  → Ein sauberes, generisches „Rail-Frame"-Verfahren (Frenet-artig), das ohne
  gespeicherte Rotationen auskommt.
- Zusätzlich liegt in Stream 7 eine **Kamerarotationsbahn**; deren Winkel werden
  in Einheiten von 4096 = 360° geführt (PSX-Konvention). Interpolation mit
  Wrap-Around: Differenzen > 0x800 werden um 0x1000 korrigiert (kürzester Weg).
  Die y-Komponente wird vor der Interpolation durch 32 geteilt — eine Eigenheit,
  die man beim Nachbau nur durch Datenvergleich fände.
- **Schwerkraft** (`C_005EA973`, `0x005EA973`): aus dem Sinus des Nickwinkels,
  geteilt durch 15, wird ein Delta gebildet; bergab beschleunigt, bergauf bremst
  es, begrenzt auf das Intervall **43 000 … 120 000** (Festkomma).
- Rotationskonvention der Objekte: standardmäßig „RotMatrixZXY" (`C_005EA099`,
  `0x005EA099`), das aber intern über D3D-Einzelrotationen mit
  Winkel × (360/4096) gebaut wird. Für Knoten beim Anlegen: `psx_RotMatrixZYX`.
  Die View-Rotation nutzt `psx_RotMatrixYXZ`. → **Drei verschiedene Euler-
  Reihenfolgen im selben Minispiel**; wer FF7-Rotationen nachbaut, darf keine
  einheitliche Konvention annehmen.

### 4.3 Streaming von Track und Hintergrund (`C_005ED8F0.cpp`)

Zwei doppelt verkettete Listen über feste Arrays:

- Track-Elemente: `0x2328` = **9 000** Slots.
- Hintergrunddreiecke: `0x2ee0` = **12 000** Slots.
- Verkettung als `{u16 prev; u16 next}`-Paare, `0xFFFF` = Ende/leer.

Der Fortschritt entlang der Strecke wird als 32-Bit-Wert geführt; die
**Streckenphase** ergibt sich aus `>> 0x12` (18 Bit) — d. h. alle 2^18
Positionseinheiten wird ein Schritt der Sichtbarkeitsskripte abgearbeitet.
Für jeden solchen Schritt werden aus Stream 8 IDs *hinzugefügt* und aus Stream 9
IDs *entfernt* (Hintergrund), analog Stream 2/3 für die Schienen. Der Zähler
`D_00C3F75C` („Streckenphase") ist zugleich die Zeitachse für Objektspawns
(Stream 0xF) und für alle Lebensdauerbedingungen der Objekte.

> **Wiederverwendbare Erkenntnis:** FF7 lädt hier nichts nach — die komplette
> Level-Geometrie ist im RAM, und die Sichtbarkeit wird über ein **vorberechnetes
> Add/Remove-Skript** gesteuert. Kein Frustum-Culling, keine Räumlichkeit: reines
> Autorenwerkzeug-Output. Wer das Format liest, bekommt die Sichtbarkeit geschenkt.

### 4.4 Szenengraph (`C_005EF1C0.cpp`)

Sehr klein und sehr charakteristisch:

- 200 (`0xC8`) Knoten im Pool, Freiliste als Index-Array („nächster freier Index
  steht im Slot des belegten") — dieselbe Technik nochmals für 100 Spielobjekte.
- **10 Tiefenebenen** mit je Kopf-/Schwanz-Wächterknoten; ein Knoten wird nach
  seiner Tiefe (Elterntiefe + 1) einsortiert. Die Ebenen erzwingen die
  Renderreihenfolge.
- Ein globaler TOP-Knoten mit Identitätsmatrix bei `0x00C60150`.
- Elternmatrizen werden zwar multipliziert, im Coaster aber faktisch nie benutzt
  (alle Objekte hängen direkt am TOP).
- `t_coaster_Node` ist 0x38 B: Modellzeiger, PSX-`MATRIX` (0x1E B + 2 Padding),
  Elternzeiger, ModelId, Index, Tiefe, prev/next.

### 4.5 Rendering (`C_005EF4D0.cpp`, Klasse bei `0x005EF4D0`)

Aufbau der Renderer-Klasse (0xD8 Byte): für jede Materialklasse werden beim
Konstruktor eigene „SFX"-Batches angelegt, jeweils in zwei Varianten —
**„nicht geclippt"** (Typ `0x0C`/`0x02`, direkte Bildschirmvertizes) und
**„teilweise geclippt"** (Typ `0x0D`/`0x03`, geht durch die Clip-Pipeline):

| Batch | Zweck | Textur | Blendmodus |
|---|---|---|---|
| Objekte solid | 3D-Modelle | keine | 4 |
| Objekte transparent | Modelle mit Alphaflag | keine | 1 |
| Schienen | Track | `rail.tim` | 4 |
| Fadenkreuz | Sight | `sight.tim` | 4 |
| Beams | Laser (3 Frames) | `beam1..3.tim` | 1 |
| HUD | Score/Box/Rahmen/Pause | `score/co1/waku2/pause.tim` | 4 |
| Alpha-Quad | Vollbild-Fade | keine | 0 |

Beobachtungen mit Übertragungswert:

- **Clipping-Entscheidung pro Primitiv per Skalarprodukt**: jeder Vertex wird
  gegen die dritte Spalte der World-View-Matrix geprüft (Tiefe). Ist alles vorn →
  billiger Direktpfad mit vorprojizierten Vertizes (`rhw` gesetzt); ist etwas
  hinten → Übergabe an den Clipper mit Kameraraum-Koordinaten. Ein Dreieck, das
  komplett hinten liegt, wird ganz verworfen. Toleranz: −100 Einheiten für
  Modelle, 0 für Schienen.
- **Entfernungsnebel als Vertex-Dimmung, nicht als Fog-State**: aus derselben
  Tiefe wird ein Lichtverhältnis gebildet — voll hell unterhalb einer unteren
  Schwelle, schwarz oberhalb einer oberen, dazwischen linear. Startwerte:
  **unten `0x28AA` = 10 410, oben `0x37DC` = 14 300** — und `14300` ist exakt
  die Far-Plane des Coaster-Viewports. Im Entwicklermodus lassen sich beide
  Schwellen mit den Pfeiltasten verschieben.
  → **FF7 verdunkelt Ferngeometrie per Vertexfarbe.** Das ist für `render-field`
  direkt relevant: gleicher Effekt in WebGL = Vertex-Color-Multiplikation, kein
  Fog-Uniform.
- **Projektionsergebnisse werden als gepackte `(y<<16)|x`-Paare** zurückgegeben —
  das erklärt Bitmasken-Gefummel in verwandten FF7-Datenstrukturen.
- **Layer-Umschaltung** (`0x00660E95`) trennt opake Welt (Layer 0) von
  transparenter Welt + Beams (Layer 1); das HUD kommt wieder auf Layer 0, das
  Fade-Quad ganz zum Schluss auf Layer 1. Der Autor markiert eine doppelte
  Ausgabe von Anzeige+Rahmen als vermutlichen Originalbug.
- Alle Farben werden intern von RGBA nach **BGRA** gedreht (D3D-Konvention) und
  vorher mit dem Lichtverhältnis multipliziert; Alpha ist konstant 0xFF, die
  Transparenz steckt im **Bit 1 des Alphabytes der ersten Vertexfarbe** als
  Materialflag — nicht als echter Alphawert.
- Der HUD-Zahlensatz sitzt in `score.tim` ab u=48/255 in 16-Pixel-Schritten,
  Ziffernbreite 15, Höhe 29 (in 320×240-Einheiten); „SCORE" belegt u=0…47.
  Vierstellig, ab 10 000 fünfstellig (und die Statusbox wird dann verbreitert).
- Der Viewport des Minispiels: **FOV 45°, Near 10, Far 14 300**; das Hauptspiel
  setzt dagegen FOV 90°, Near 125, Far 50 000 (`C_0040A091`). Projektionszentrum
  x = 0, y = Skalierungsfaktor × 40 — die Kamera schaut also **oberhalb der
  Bildmitte** heraus.

### 4.6 Trefferprüfung

Zweistufig, und beide Stufen sind ungewöhnlich:

1. **Halbraumtest** (`C_005EEA50` / `C_005EECB5`, `0x005EEA50`): beim Init werden
   aus vier festen Eckvektoren eines 320×240-Sichtfelds bei z=256 —
   (±160, ±120, 256) — die Normalen der **linken und rechten Frustum-Ebene**
   per Kreuzprodukt gebildet, samt Referenz-Vorzeichen. Zur Laufzeit wird nur
   der **Translationsanteil der Objektmatrix** gegen beide Ebenen getestet.
   Vorzeichenvergleich statt Betrag = klassischer Integer-Trick.
   Alle Zwischenwerte werden vorher um 2 Bit nach rechts geschoben
   (Überlaufschutz bei 32-Bit-Festkomma).
   Oben/unten wird **nicht** getestet.
2. **2D-Rechteckvergleich**: die sechs Flächenmittelpunkte der Objekt-AABB
   werden projiziert, daraus Min/Max in x und y gebildet, und geprüft, ob der
   (skalierte) Cursor darin liegt. Interessant: die Schleife läuft nur über
   6 der 8 reservierten Einträge — es sind tatsächlich 6 Punkte, kein Würfel.

→ Für WebMidgar (`render-actor`, Zielerfassung) ist das der Beleg, dass FF7
**Bildschirmraum-AABB gegen Cursor** prüft, nicht Ray-vs-Mesh.

### 4.7 Spielobjekte (`C_005EAB70.cpp`) — nur Typenkatalog

Eine 100-Slot-Tabelle mit Freiliste; jeder Eintrag 0x13C Byte mit Position,
Rotation, Zustandsblock (0xA0 B, darin 20 `int` Skriptparameter aus Stream 0xE),
Bahnzeiger, Knotenzeiger und der projizierten AABB.

Die Zustandsmaschine kennt folgende Typcodes (aus den `switch`-Zweigen; die
Bedeutungen sind Autorenvermutungen, im Original mit „?" markiert):

| Code | Verhalten |
|---|---|
| 0x00 | Bahn abfahren + konstante Eigenrotation |
| 0x01 | Bahn abfahren, Ausrichtung entlang der Tangente (atan2) |
| 0x02 | aufsteigender Ballon mit Pendelneigung |
| 0x03 | Sternenfeld (folgt der Kamera, y −2500) |
| 0x04 | fallendes Objekt (Beschleunigung), stirbt bei y > 0 |
| 0x05 | Pfosten/Scheinwerfer; Sonderfall „fliegende Untertasse" (Modellwechsel bei Treffer, nur unterhalb einer Geschwindigkeitsschwelle verwundbar) |
| 0x07, 0x0D | rotierende Objekte mit begrenzter Rotationsdauer |
| 0x08 | Feuerwerk (Aufstieg, dann 20 Partikel aus 3 zufälligen Modellen) |
| 0x09 | Feuerwerkspartikel (100 Ticks Lebensdauer) |
| 0x0A | **Spielerwagen** (Position/Rotation direkt aus der Schienenkurve) |
| 0x0B → 0x0C | Explosion nach Untertassenabschuss + deren Partikel (der Autor markiert ein fehlendes `break` als möglichen Originalbug) |
| 0x0E/0x0F/0x10 | Lava-Ausbruch mit zwei Partikelarten |
| 0x11 | Felsbrocken/Kaktus (fährt die Bahn rückwärts ab) |
| 0x64 | zielsuchendes Objekt; trifft es den Spieler, **−5 Punkte** |
| 0xC9/0xCA/0xCB | Treffersterne (drei Größenklassen) |
| 0xE6 | ungenutzt |
| 0xFA | bedingter Geschwindigkeitswechsel (ungenutzt) |
| 0xFC | „Blocker Start": Einblendung über 125 Ticks, danach Geschwindigkeit `0x4000` |
| 0xFD | „Blocker Ziel": Ausblendung über 127 Ticks, setzt das Ende-Flag |
| 0xFE | Blocker für die Untertassensequenz (nutzt `clock()` in Sekunden!) |
| 0xFF | Geschwindigkeitsrampe; erreicht sie 0, wird das Ziel-Objekt erzeugt |

**Scoring** (`C_005ED528` / `C_005ED5AC`): jedes Objekt hat „Trefferpunkte";
pro Schuss wird die aktuelle **Schusskraft geteilt durch 32** abgezogen (mindestens
1). Fällt der Wert unter 0, greift die Zerstörungsanimation, die je nach
Kategorie (Sterne / Kristall / Rotation / „Pop" / „viele Sterne") den Punktwert
gutschreibt, einen Sound spielt und 3, 0 oder 100 Partikel erzeugt. Der letzte
Trefferwert wird 100 Ticks lang als rotierendes 3D-Modell + Zahl eingeblendet
und blinkt in den letzten 50 Ticks.

**Score-Übergabe ans Hauptspiel** (`C_005E8E0B`, `0x005E8E0B`): der Score wird
als 16-Bit-Wert in **zwei aufeinanderfolgende Savemap-Bytes** geschrieben, in
`loadmenu.h` als `D_00DC0A3E`/`D_00DC0A3F` benannt = Offsets **0x162/0x163 im
Variablenbank-Bereich** der Savemap (`t_loadmenu_10f4::f_0ba4`, RAM `0x00DC08DC`,
Bankgröße 0x500). Little-Endian (niedriges Byte zuerst). Danach schaltet die
Zustandsmaschine auf `MAIN_STATE_01` mit Untermodus `MAIN_STATE_0B`.

### 4.8 Eingabe

- Padmaske als Bitfeld (`ff7.h`): Bits 0–11 = Tasten 1–12, Bit 12 = oben,
  13 = rechts, 14 = unten, 15 = links.
- Der Ersatz-Treiber in `CoasterMain.cpp` bindet den Ziffernblock: 7/1/9/3 auf
  Tasten 1–4, `+` auf 5, Enter auf 6, 0 auf 7, `.` auf 8, `−` auf 9,
  Numpad-5 auf 12, Numpad 8/6/2/4 auf die Richtungen. Tastenwiederholung
  200 ms / 50 ms (`PAD_setRepeatParams`).
- Im Spiel: Richtungstasten bewegen das Fadenkreuz um **10 Einheiten/Tick**,
  geclamped auf 0…320 / 0…240. **Taste 6 (Bit 5) = Schuss.**
- **Schusskraft**: Startwert 0x80; beim Halten sinkt sie um 1 pro Tick bis
  minimal 8, beim Loslassen steigt sie um 1 bis 0x80. Sie bestimmt gleichzeitig
  Trefferschaden (÷32), Beam-Breite (÷8) und den Balkenausschlag der Anzeige.
  Der Beam-Frame wechselt zyklisch 0→1→2 und der Schuss feuert **jeden zweiten
  Tick** (ein 1-Tick-Kühlzähler).
- **Pause**: Taste 12 (Numpad 5) toggelt; im Pausezustand läuft nur noch
  Statusbox + Pause-Overlay.
- Ein **Entwicklermodus** (`D_00C3F890 = 0`) belegt dieselben Tasten mit
  Debugfunktionen: Lichtschwellen verschieben, Geschwindigkeit ±0x400, Geschwindigkeit 0.
  Im Release ist er auf 1 fixiert. Auskommentierter Mausunterstützungscode
  („test mouse support -- by joe") ist eine Zutat des Autors, kein Original.
- Ein `MAIN_inputMask2` existiert für einen **Cheat-Modus im Chocobo-Rennen**
  (Buchstabentasten A–L) — Hinweis auf ein Feature außerhalb dieses Minispiels.

### 4.9 Audio

- Musik: **MIDI-Track 0x37, im Code als „GOLD1" benannt** (Gold-Saucer-Thema),
  Startlautstärke 0x7F.
- Der Sound-Treiber wird über **Opcodes** gefüttert (`0x00740D80`, 9 Argumente).
  Belegte Kanäle im Coaster: Kanal 1/2 im Wechsel für Einzeleffekte
  (Opcodes 0x28/0x29 „play", 0xA0/0xA1 „volume", 0xB0/0xB1 „tempo"),
  Kanal 3 für das **Schienengeräusch** (0x2A/0xA2), Kanal 4 für den
  **Laserdauerton** (0x2B/0xA3/0xB3). Globale Opcodes: 0xB8 Volume all,
  0xB9 Volume-Transition all, 0xC1 Musik-Volume-Transition.
- **23 SFX-IDs werden beim Start vorgeladen** (Dezimal/Hex):
  0x00A, 0x018, 0x02D, 0x045, 0x076, 0x085, 0x08E, 0x098, 0x0BF, 0x107, 0x10D,
  0x10E, 0x10F, 0x11E, 0x166, 0x177, 0x195, 0x21B, 0x22B, 0x22D, 0x235, 0x236,
  0x2A1. Namentlich zugeordnet: **0x177 = Schienenrollen**, **0x22B = Laser**
  („pioupiou"), **0x08E = große Explosion**, **0x098 = Explosion**,
  **0x00A = Aufschlag**, **0x03B = Menü-Piep (Pause)**.
  Das Hauptmenü lädt zusätzlich SFX **0x02B**.
- Die Lautstärke des Schienengeräuschs wird geschwindigkeitsabhängig zwischen 0
  und 0x7F geschaltet (Schwelle `0x4000`); die des Lasers folgt der Schusskraft.

---

## 5. Wichtigste Erkenntnisse für WebMidgar (priorisiert)

| # | Erkenntnis | Zielpaket | Warum wertvoll |
|---|---|---|---|
| 1 | **60-Hz-Fixed-Timestep mit Clamp auf 32 Ticks und „nur der letzte Tick rendert"** — identisch in Coaster/Highway/Snowboard | `interpreter`, App-Loop | Klärt die Frage, ob FF7-PC framerateabhängig simuliert. Antwort: nein. Direkt übernehmbare *Architektur* (nicht Code). |
| 2 | **LGP-Archiv-ID-Tabelle** (17 Einträge, §3) inkl. Aufteilung AppPath vs. DataPath | `convert`, Asset-Loader | Vollständige Landkarte aller FF7-Archive mit den Original-IDs; erklärt zweigeteilte Installationslayouts. |
| 3 | **Rebasierte PSX-Zeigertabellen** (`xbinadr.bin`: Offsets sind PSX-Absolutadressen, Basis = Eintrag 0) | `formats-field`, `convert` | Muster, das vermutlich in mehreren FF7-Minispiel-/Datenblobs wiederkehrt. Spart beim Parsen viel Rätselraten. |
| 4 | **Entfernungsabdunklung per Vertexfarbe** mit linearer Rampe zwischen zwei Schwellen; obere Schwelle = Far-Plane | `render-field` | Erklärt FF7s „Fog" ohne Fog-State; in WebGL 1:1 als Vertex-Color-Multiplikation nachbaubar. |
| 5 | **Zwei-Pfad-Rendering: „nicht geclippt" (vorprojiziert, `rhw`) vs. „teilweise geclippt" (Kameraraum)**, Entscheidung per Tiefen-Skalarprodukt pro Primitiv | `render-field`, `render-actor` | Erklärt, warum FF7-Batches paarweise auftreten, und warum manche Geometrie andere Artefakte zeigt. |
| 6 | **`SVECTOR::pad` ist in FF7-Daten Nutzlast** (Farbkanäle im Quad-Format versteckt) | `formats-model` | Konkrete Warnung gegen die naheliegende Fehlannahme „pad = Füllbytes". |
| 7 | **Drei verschiedene Euler-Reihenfolgen** (ZXY für Objekte, ZYX beim Knotenanlegen, YXZ für die View) im selben Modul; Winkeleinheit 4096 = 360°, Interpolation mit Wrap bei 0x800 | `formats-model`, `render-actor` | Verhindert die Annahme einer globalen Rotationskonvention; die 4096er-Einheit und der Wrap sind übertragbare Datenfakten. |
| 8 | **Savemap-Ablage des Minispiel-Scores** an Variablenbank-Offset 0x162/0x163, LE | `interpreter` (Savemap) | Zwei belegte Bytes der Savemap-Variablenbank; `loadmenu.h` liefert darüber hinaus ein **komplettes Savemap-Layout** (0x10F4 B) inkl. GIL bei 0x0B7C, Spielzeit 0x0B80, Konfigmaske 0x10DA, Nachrichtengeschwindigkeiten 0x10D8/0x10D9/0x10EC. |
| 9 | **Sichtbarkeits-Streaming per vorberechnetem Add/Remove-Skript**, getaktet über `Position >> 18` | `render-field` (Hintergrunddynamik, vgl. S39) | Beleg, dass FF7 Sichtbarkeit als Autorenwerkzeug-Output speichert statt zur Laufzeit zu cullen — relevant für die laufende Roadmap zu Field-Background-Dynamik. |
| 10 | **HUD in logischen 320×240-Koordinaten × Skalierungsfaktor + Viewport-Ursprung**; Modus 2 = 640×480 mit Faktor 2 | `render-field` | Sauberes, direkt spiegelbares Skalierungsmodell für die Web-Ausgabe. |
| 11 | **Screen-Space-AABB-Treffererkennung** aus 6 Flächenmittelpunkten + Frustum-Halbraumtest nur links/rechts | `render-actor` | Zeigt FF7s tatsächliche (billige, ungenaue) Zielerfassung. |
| 12 | **Sound-Opcode-Modell** (Kanal-getrennte play/volume/tempo-Opcodes, Volume-Transitions) und die 23 vorgeladenen SFX-IDs | Audio-Schicht | Grundgerüst für einen Web-Audio-Treiber, der FF7-SFX-IDs adressiert. |
| 13 | **Freilisten als Index-Array** (dreimal identisch: Objekte, Knoten, Modelle) und **10 feste Tiefenebenen** im Szenengraph | allgemein | Charakteristische Engine-Signatur; hilft, ähnliche Strukturen in anderen Modulen wiederzuerkennen. |
| 14 | Viewport-Parameter: Hauptspiel FOV 90/Near 125/Far 50 000, Coaster FOV 45/Near 10/Far 14 300, Projektionszentrum y = Faktor × 40 | `render-field` | Konkrete Kamerawerte, die sonst nur durch Messen zu bekommen wären. |

---

## 6. Offene Fragen

1. **Stream 0 von `xbin.bin`** wird nie gelesen — Header? Padding? Nur durch
   Betrachten einer echten `coaster.lgp` zu klären.
2. Was steht in den 20 Skriptparametern pro Spawn-Eintrag (Stream 0xE) außer den
   im Code angesprochenen Indizes 0–8, 0xA, 0xB, 0xE, 0x11, 0x12? Die restlichen
   sind toter Raum oder von anderen Minispielen mitbenutzte Struktur.
3. Warum wird die y-Komponente der Kamerarotation vor der Interpolation durch 32
   geteilt? Vermutlich eine Datenkonvention (Faktor 32 in der Quelltabelle).
4. Sind die Streams in `high-us.lgp` (Highway) und `snowboard-us.lgp` identisch
   aufgebaut? Der Kommentar zum Frametakt legt nahe, dass die drei Minispiele
   denselben Codegenerator/Autorenwerkzeug-Stand teilen.
5. Ist `0x00660E95` (Layer-Umschaltung) wirklich nur 0/1, oder gibt es mehr
   Ebenen im Feld-/Kampfmodul?
6. Die Halbraum-Konstante z = 256 bei einem 320×240-Feld impliziert einen
   bestimmten FOV — passt sie zu FOV 45°, oder ist sie ein PSX-Erbe?

---

## 7. Weitere Repositories desselben Autors (Nachfassliste)

Alle über `gh api users/ergonomy-joe/repos` geprüft: **keines hat eine Lizenz**
(`spdx_id` durchweg `NONE`). Dieselbe Clean-Room-Warnung gilt für alle.

FF7-relevant, nach Priorität:

| Repo | Inhalt | Warum interessant | Priorität |
|---|---|---|---|
| **ff7-worldmap** | „FF7 world map engine (decompiled)", C++ | **Höchste Relevanz.** Trifft WebMidgars Weltkarten-/Interpreter-Arbeit direkt (vgl. der bereits ausgebaute World-Interpreter). Erwartbar: `world_us.lgp`-Formate, Mesh-/Höhenfeld-Layout, Weltkarten-Skriptmaschine. | **hoch** |
| **ff7-chocobo** | (ohne Beschreibung), C++ | Der Coaster-Code verweist mehrfach auf `t_chocobo_data_DOMEG3` / `t_chocobo_data_DG4` — das Chocobo-Modul erklärt also das **Quad-Format mit versteckten Farben**. Auch der Cheat-Modus (`MAIN_inputMask2`) gehört dorthin. | **hoch** |
| **ff7snobo.github.io** | Snowboard-Minispiel, **nach Emscripten portiert**, HTML | Zeigt, wie derselbe Autor FF7-Code im Browser laufen lässt — potenziell aufschlussreich für Timing/Asset-Loading im Web. Achtung: als lauffähige Portierung urheberrechtlich noch heikler. | mittel |

Nicht FF7 (nur der Vollständigkeit halber, kein Nachfassbedarf): `u4-decompiled`,
`u6-decompiled`, `karateka-decompiled`, `HELLRAIDER`, `DRGNSRC`, `tutor-pooyan`,
`SERCQ`, `qin-decompiled`, `supercopter_decompiled`, `un_delirium`, `test_int16h`.

**Empfehlung:** `ff7-worldmap` und `ff7-chocobo` als nächste Rechercheziele —
aber mit derselben Disziplin: Beschreibungen und Offsets ernten, keinen Code.
