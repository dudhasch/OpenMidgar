# "Gears" (gears.pdf) — Auswertung für WebMidgar

## 0. Provenienz und Rechtslage

**Was das Dokument ist:** `C:\Users\timur\Downloads\gears.pdf`, 2.730.050 Bytes, **211 Seiten**.
Titel (S. 1): *"Gears" — A look Inside the Final Fantasy VII Game Engine*, "By Joshua Walker and the
'Qhimm Team'". Es ist tatsächlich das bekannte Qhimm-Community-Dokument zur FF7-Engine — kein
anderes Dokument, keine Fälschung. PDF-Metadaten: Creator `Writer`, Producer `OpenOffice.org 1.1.2`,
CreationDate `2005-01-01 16:11:13 -06:00`. Textextraktion ist durchgehend sauber (Tabellen laufen
teils zeilenweise ineinander, Screenshots/Diagramme sind Bilder ohne Text).

**Autorschaft:** Joshua Walker (in der Szene als "Halkun") ist Herausgeber/Hauptautor der Rahmen-
kapitel. Einzelne Kapitel sind namentlich anderen zugeschrieben und offensichtlich aus separaten
Community-Dokumenten übernommen:

| Kapitel | Autor laut Dokument | Seiten |
|---|---|---|
| LZS-Kompression, LGP-Archiv | Ficedula | 28–32 |
| TEX-Format (PC) | Mirix/Mirex | 35 |
| HRC-, RSD-Format | Alhexx | 36–39 |
| ".P"-Polygonformat | Alhexx, mit Ficedula und Mirex | 40–54 |
| Field Section 1 (Script/Dialog) | Halkun, Lasyan, Ficedula | 76 |
| Section 2 Kameramatrix, Section 5 Walkmesh | Kero | 77–81 |
| Section 4 Palette, Section 7 Encounter, Section 9 Background | Terrence (= Terence Fergusson) | 79–85 |
| "A"-Animationsdateien (PC Field) | Mirex | 123–124 |
| **FF7 Battle Mechanics** | **Terence Fergusson** | **126–155** |
| scene.bin | Fremen (30.09.2003) | 157–166 |
| PSX-3D-Battle-Stages | Micky | 167–168 |
| PSX-Battle-Modelle | Cyberman | 168–171 |
| PC-Battle-Modelle, Skelett/Animation | Mirex | 172–174 |
| Chocobo-Zucht | Terence Fergusson | 180–196 |
| Qhimm Team (Credits) | Qhimm, Halkun, Nori, Alhexx, Ficedula, Mirex, Lasyan3, Kero | 211 |

**Lizenz/Weiterverbreitung:** Das Gesamtdokument nennt **keine** Lizenz. Die einzige explizite
Rechtsangabe steht im Battle-Mechanics-Kapitel (S. 126): Terence Fergusson erklärt das Kapitel als
sein alleiniges Werk und erlaubt die Reproduktion **unverändert und vollständig inkl. Copyright-
Hinweis**, vorzugsweise als ASCII-Text. Fußzeile S. 155: "The FF7 Battle Mechanics, copyright
2001-2003 Terence Fergusson". → **Für ein Clean-Room-Projekt gilt: Formeln/Fakten sind
verwendbar, wörtliche Passagen nicht in die Repo-Doku kopieren.** Alle Angaben unten sind
umformuliert; nur die kurzen Formelzeilen stehen in Originalnotation, weil ihre exakte Form
funktional relevant ist.

**Zustand des Dokuments:** Unfertig. Mindestens 20 Abschnitte enthalten nur Lorem-ipsum-Platzhalter,
darunter *Introduction*, *Event Scripting* (Fließtext), *Movies*, *3D Overlay*, *Data Organization*,
*Magic Scripting*, **die gesamte World-Map-Beschreibung außer PC-Encounterdaten**, **alle
Mini-Game-Kapitel außer Chocobo-Zucht**, *PSX Model Formats*, *PSX-* und *PC-spezifische Bugs*.
Die Kapitel *FF7 Party Mechanics* (S. 156) und *FF7 Enemy Mechanics* (S. 156) sind **komplett
Platzhalter** — genau die Kapitel mit Spell-/Limit-/Materia-Formeln und Gegner-KI fehlen also.

---

## 1. Engine-Architektur (S. 9–13)

- Sechs Module: **Kernel, Field, Menu, World Map, Battle, Mini Game** (S. 9). Kernel ist Wurzel;
  Field ruft alle anderen Module. Aus Battle heraus ist das Menü nicht erreichbar.
- Der Kernel ist ein threaded Multitasking-Kern mit Software-Speichermanager für RAM und VRAM;
  auf PSX über Psy-Q-Bibliotheken, auf PC durch PC-Äquivalente ersetzt (SEQ-Player → MIDI).
- **Savemap:** ein zusammenhängender Block von **4340 Bytes (0x10F4)**, der sämtliche
  Spielvariablen hält; Speichern = dieser Block auf nichtflüchtigen Speicher (S. 11).
- **Field-Script-Bänke → Savemap-Offsets** (S. 11), zentral für `interpreter`/`formats-save`:

| Savemap-Offset | 8-Bit-Bank | 16-Bit-Bank | Bedeutung |
|---|---|---|---|
| 0x0000 | – | – | Anfang Savemap |
| 0x0BA4 | 0x1 | 0x2 | Script-Bank 1 |
| 0x0CA4 | 0x3 | 0x4 | Script-Bank 2 |
| 0x0DA4 | 0xB | 0xC | Script-Bank 3 |
| 0x0EA4 | 0xD | 0xE | Script-Bank 4 |
| 0x0FA4 | 0x7 | 0xF | Script-Bank 5 |
| 0x10F4 | – | – | Ende Savemap |
| (nicht in Savemap) | 0x5 | 0x6 | temporäre Field-Variablen, 256 Bytes, nicht gespeichert |

- PSX-VRAM: 1 MB, als Fläche 2048×512 modelliert (im Dokument als 1024×512 dargestellt); Doppel-
  puffer, CLUT-Bereich unter den Framebuffern, permanente Menü-Texturen und Font rechts (S. 11–13).
- CD-Zugriff umgeht `open()/read()`-BIOS-Calls; "Quick Mode" lädt max. 8 KB am Stück und adressiert
  Dateien **über Sektornummern statt Dateinamen** (S. 13).

---

## 2. KERNEL.BIN / KERNEL2.BIN (S. 13–26) → `formats-kernel`

- PSX `/INIT/KERNEL.BIN`, PC `/DATA/KERNEL/KERNEL.BIN`. BIN-GZIP: **27 gzip-Sektionen** hinter-
  einander, je 6-Byte-Header. Datei ist auf PC und PSX identisch. Sektionen 10–27 = FF-Text.
- **KERNEL2.BIN** (nur PC): enthält nur Sektionen 10–27, entpackt, konkateniert, dann **LZS**
  komprimiert, mit 4-Byte-Längen-Header (S. 26).
- Sektionsindex mit Offsets (S. 14): 1 Command 0x0006, 2 Attack 0x0086, 3 Savemap 0x063A,
  4 Startwerte 0x0F7F, 5 Item 0x111B, 6 Weapon 0x137A, 7 Armor 0x1A30, 8 Accessory 0x1B73,
  9 Materia 0x1C11, 10 Command-Desc 0x1F32, 11 Magic-Desc 0x2119, 12 Item-Desc 0x28D4,
  13 Weapon-Desc 0x2EE2, 14 Armor-Desc 0x307B, 15 Acc-Desc 0x315F, 16 Materia-Desc 0x3384,
  17 Key-Item-Desc 0x3838, 18 Command-Names 0x3BE2, 19 Magic-Names 0x3CCA, 20 Item-Names 0x4293,
  21 Weapon-Names 0x4651, 22 Armor-Names 0x4B02, 23 Acc-Names 0x4C4B, 24 Materia-Names 0x4D90,
  25 Key-Item-Names 0x5040, 26 Battle-Text 0x5217, 27 Summon-Attack-Names 0x5692.
- **Recordlängen:** Command 16 B; **Attack 28 B**; Item 27 B; **Weapon 44 B**; **Armor 36 B**;
  Accessory 16 B; **Materia 20 B**.

### 2.1 Attack-Record (28 B, S. 15–16)
0x04 Casting Cost; 0x0A Attack Type; 0x0B (2 B) Attack Attribute (u. a. 0x0013 Limit Break,
0x0015 Cait-Sith-Limit, 0x0017 Summon, 0x0097 Multi-Strike-Limit, 0x00C7 Roulette, 0xFF01
Phoenix Down, 0xFF17 Final Limit Break); 0x0D ID; 0x0E Restore Apply; 0x0F Strength; 0x10
Restore Type (0 HP, 1 MP, 2 Ailment, 0xFF none); 0x13 Times Attacking; 0x14 (4 B) Statuses;
0x18 (2 B) Element. *Achtung: Die Offsettabelle des Dokuments ist an dieser Stelle inkonsistent
(letztes Feld bei 0x20 in einem 28-B-Record) — hier misstrauisch bleiben.*

### 2.2 Weapon-Record (44 B, S. 18–20) — **enthält die UW-Modifier-Tabelle**
- 0x00 Range: 0x03 Long Range, 0x23 Normal.
- **0x02 Special Options / Attack Modifier** — das ist genau die BD/UW-Modifier-Quelle aus dem
  Battle-Kapitel:
  - 0x11 normal
  - 0xA0 `1 + (Anzahl Tifa-Status aus {Near-death, Poison, Sadness, Silence, Slow, Darkness}) + 2 * (Anzahl aus {Death-sentence, Slow-numb})`
  - 0xA1 stärker bei Near-Death
  - 0xA2 `1 + Anzahl toter Verbündeter`
  - 0xA3 `Target's Level / 16` (Conformer; gegen Verbündete physischer Treffer ohne Schaden, kein Morph-Modifikator)
  - 0xA4 `(1 + [48 * HP / MaxHP]) / 16`
  - 0xA5 `(1 + [48 * MP / MaxMP]) / 16`
  - 0xA6 `(1 + [Gesamt-AP der Waffe / 10000]) / 16`
  - 0xA7 `(10 + [Kills / 128]) / 16`
  - 0xA8 `(1 + [Limit Level * Limit Units / 16]) / 16`
- 0x04 Weapon Attack; 0x06 Materia-Growth-Rate; 0x08 Weapon Attack %; 0x09 (3 B) Model-ID;
  0x0E (2 B) Equip-Maske (Bit 0 Cloud … Bit 10 Sephiroth); 0x10 Attack Type (0x0004 Cut,
  0x0008 Hit, 0x0010 Punch, 0x0020 Hit); 0x14 (4 B) Stat-Typ (0 Str, 1 Vit, 2 Mag, 3 Spr,
  4 Dex, 5 Lck, 0xFF none); 0x18 (4 B) Stat-Betrag; **0x1C (8 B) Materia-Slots**
  (0x00 kein Slot, 0x05 ungelinkt, 0x06 links gelinkt, 0x07 rechts gelinkt); 0x27 Attack-Textur;
  0x2A Restriction Mask.

### 2.3 Armor-Record (36 B, S. 20–22)
0x02 Damage Type (0xFF normal, 0x00 absorb, 0x01 no damage, 0x02 half); 0x03 Defense;
0x04 Magic Defense; 0x05 Def %; 0x06 MDef %; 0x08 (8 B) Materia-Slots; 0x12 Materia Growth;
0x13 Equip-Maske (0xFF01 alle, 0x2C00 weiblich, 0xD303 männlich); 0x15 Element; 0x19 Stat-Bonus;
0x1D Stat-Increase; 0x21 Restriction Mask.
**Wichtig:** Das MDef-Feld ist im Spiel wirkungslos → siehe Bug-Abschnitt.

### 2.4 Accessory-Record (16 B, S. 22–25)
0x00 Stat-Bonus-Typ, 0x02 Bonus-Betrag, 0x04 Elemental Strength (0 Drain, 1 Nullify),
0x05 Special Effect (0 Haste, 1 Fury, 2 Curse-Ring, 3 Reflect, 4 Steal-Rate, 5 Manipulate-Rate,
6 Barrier/MBarrier), 0x06 Elementmaske (0x01 Fire … 0x80 Wind, 0x0001 Holy, 0xFF01 alles),
0x08 (4 B) Status-Protect-Maske, 0x0C Equip-Maske, 0x0E Restriction Mask.

### 2.5 Materia-Record (20 B, S. 25–26)
0x00 (8 B) vier WORDs = AP-Level-Grenzen in Vielfachen von 100; 0x08 Equip-Effect-Index;
0x09 (3 B) Status-Bitmaske; 0x0C Element; **0x0D Materia-Typ**; 0x0E–0x13 typabhängige Attribute.
Typen: 0x08 Master Command, 0x0A Master Magic, 0x0C Master Summon, 0x12 Command (fix),
0x16 Command (freischaltend), 0x19 Magic (freischaltend), 0x20 Booster%, 0x33 W-Command,
0x3B Summon (Anzahl Nutzungen je Level), 0x57 Enemy Skill.
**Equip-Effect-Tabelle** (S. 26) — Stat-Deltas als STR/VIT/MAG/MDEF/MAXHP/MAXMP/LUCK/DEX:
0x01 (−2 STR, −1 VIT, +2 MAG, +1 MDEF, −5 % MaxHP, +5 % MaxMP); 0x02 (−4, −4, +4, +2, −10 %,
+10 %); 0x06 +1; 0x07 +1; 0x08 −1; 0x0A +2; 0x0B (−1, +1, −2 %, +2 %); 0x0C (+1, −2 %, +2 %);
0x0D (+1, +1, −5 %, +5 %); 0x0E (+2, +2, −10 %, +10 %); 0x0F (+4, +4, −10 %, +15 %);
0x10 (+8, +8, −10 %, +20 %). *Die Spaltenzuordnung ist im PDF durch den Tabellenumbruch teils
ambivalent — vor Übernahme gegen echte KERNEL.BIN verifizieren.*

---

## 3. Container- und Bildformate (S. 27–35) → `formats-lgp`, `convert`

### 3.1 BIN (S. 27)
- **BIN plain:** 4-Byte-Header = Länge ohne Header, danach Daten.
- **BIN-GZIP:** je Sektion 6-Byte-Header — 2 B Länge der gzip-Sektion, 2 B unbekannt,
  2 B Dateinummer, danach `1F 8B 08 00 …`.

### 3.2 LZS (S. 28–30) — Ficedula
- 4-Byte-Header = **dekomprimierte Länge (u32)**, danach Daten.
- Control-Byte pro Block, **von rechts nach links** gelesen: Bit 1 = Literal, Bit 0 = Referenz.
- Referenz = 2 Bytes, Layout `OOOOOOOO OOOOLLLL` → 12-Bit-Offset, 4-Bit-Länge; **Länge + 3**
  (also 3–18).
- Offsetberechnung: `real_offset = tail - ((tail - 18 - raw_offset) mod 4096)`
  (`mod 4096` = `& 0xFFF`); `tail` = aktuelle Ausgabeposition.
- **Zwei Sonderfälle, die FF7 tatsächlich nutzt:**
  1. Negativer Offset (Referenz "vor Dateibeginn") → Nullbytes ausgeben; bei teilweiser
     Überlappung erst die fehlenden Nullbytes, dann die realen Bytes.
  2. Überlappende Kopie (Run) → byteweise kopieren, sodass frisch geschriebene Bytes wieder
     gelesen werden.
- Maximale Kompression daher knapp unter 9:1.

### 3.3 LGP (S. 30–32) — Ficedula
- Header: 12 B Ersteller-String, **rechtsbündig** (FF7: zwei Nullbytes + "SQUARESOFT"), dann
  4-Byte-Anzahl Dateien.
- TOC-Eintrag je Datei: 20 B nullterminierter Name, 4 B Datenoffset, 3 B Prüfcode (meist 14,0,0).
- Danach **CRC-Block, normalerweise 3602 Bytes**; hängt nur an der Dateianzahl (evtl. Namen).
  Ficedula konnte ihn dekodieren, aber nicht erzeugen — Praxis: aus Originalarchiv kopieren.
- Datenteil: pro Datei erneut 20 B Name + 4 B Länge + Daten (die Länge steht **nicht** im TOC).
- Terminator: String bis Dateiende, "FINAL FANTASY 7" (bzw. "LGP PATCH FILE").
- Toleranzen des Spiels: TOC-Name und Datei-Header-Name müssen nicht übereinstimmen; zwei
  TOC-Einträge dürfen auf dieselben Daten zeigen; nicht referenzierte Daten sind erlaubt;
  Archivgröße wird nicht geprüft, solange alle erwarteten Namen vorhanden sind.
  Ficedulas Tools schreiben nach verkleinerten Dateien eine 4-Byte-Lückenlänge — nur relevant,
  wenn man den Datenteil sequenziell statt über TOC liest.

### 3.4 TIM (PSX, S. 32–35) und TEX (PC, S. 35)
- TIM-Kennung `10 00 00 00`; Flags `08` = 4 bpp, `09` = 8 bpp, `02` = 16 bpp. Bei 4/8 bpp folgt
  CLUT-Block (CLUT-X/Y, Anzahl Einträge, 32 B bzw. 512 B pro CLUT), danach Bild-Header mit
  VRAM-X/Y und **Breite/4 bzw. Breite/2**. 16 bpp: Pixel als BGR mit Maskbit,
  Bitlayout `[ggg][rrrrr][m][bbbbb]gg`.
- TEX (PC): 0x38 Bit-Tiefe (4/8/16), 0x3C Breite, 0x40 Höhe, 0x58 Palettengröße,
  0xEC Palette (4 B je Farbe, **BGRA**), danach Bitmap (Indizes bzw. RGB555).

---

## 4. 3D-Formate PC-Field (S. 36–54) → `formats-model`, `render-actor`

- **HRC** (Alhexx, S. 36–38): Klartext. `:HEADER_BLOCK 2`, `:SKELETON <name>`, `:BONES <n>`;
  je Bone 4 Zeilen: Name, Parent-Name (oder `root`), **Länge**, dann `<Anzahl RSD> [Namen…]`.
  Es gibt **keine Winkel** in der HRC — die stammen aus den `.a`-Animationsdateien.
- **RSD** (Alhexx, S. 38–39): Klartext, ID-Zeile `@RSD940102`, `#`-Kommentare, `PLY=`, `MAT=`,
  `GRP=`, `NTEX=n`, `TEX[i]=xxxx.TIM`. **Reale Datei ist `.TEX`, nicht `.TIM`** — Endung ersetzen.
- **.P** (S. 40–54): 128-B-Header, davon 64 B bekannt: VertexColor-Flag, NumVerts, NumNormals
  (in Battle-Dateien immer 0), NumTexCs, NumNormInds, NumEdges, NumPolys, mirex_h (Hundrets),
  NumGroups, mirex_g. Chunk-Reihenfolge und -Offsets:
  - Vertices `0x80`, `NumVerts*12` (3 floats)
  - Normals, `NumNormals*12`
  - TexCoords, `NumTexCs*8` (2 floats, 0..1; Werte > 1.0: 1.0 subtrahieren)
  - Vertex Colors `NumVerts*4` (BGRA-artig: blue, green, red, reserved)
  - Polygon Colors `NumPolys*4`
  - Edges `NumEdges*4` (2 × short) — **enthalten absolute Vertexindizes, nicht gruppenrelativ**
  - Polygons `NumPolys*24`: `short Tag1(0); short Vertex[3]; short Normal[3]; short Edge[3]; long Tag2(0x00EAFC0C)`; **Normal-Indizes sind absolut**
  - Hundrets `mirex_h*100` (Zweck unklar, vermutlich Textur-States)
  - Groups `NumGroups*56`: polyType (1 untexturiert, 2 texturiert mit Normalen, 3 texturiert ohne), offPoly, numPoly, offVert, numVert, offEdge, numEdge, 4×0, offTex, texFlag, texID
  - BoundingBox (24 B: max xyz, min xyz) nach zusätzlichen 4 B
  - Normal Index Table `NumNormInds*4` (Vertex → Normal)
  - **`numEdge` ist meist 0**; korrekt: `numEdge[i] = offEdge[i+1] - offEdge[i]`, für die letzte
    Gruppe `NumEdges - offEdge[last]`.
  - **Gruppensemantik (S. 49–54):** Vertices/Edges werden pro Gruppe geklont; Polygon- und
    Edge-Indizes innerhalb einer Gruppe sind **gruppenrelativ**, die Vertexindizes im Edge-Chunk
    dagegen absolut. Das ist die klassische Fehlerquelle beim Laden.
- **"A"-Animation (Mirex, S. 123–124):** 24-B-Header (`x1`, `frames_count`, `bones_count`,
  3 unbekannte u32), 12 B unbekannt, dann Frames à `bones*12 + 24` Bytes: 6 floats unbekannt
  (vermutlich Root-Translation), danach je Bone 3 floats Rotation.

---

## 5. Menu-Modul und Savemap (S. 56–73) → `formats-save`, `menu`

- 13 Untermodule (Begin, Party, Item, Magic, Eqip, Stat, Change, Limit, Config, Form, Save,
  Name, Shop); nur 4 sind per Field-Script aufrufbar (S. 63). `MENU`-Kommando: erstes Argument
  immer 0x00, zweites = Menu-ID, drittes = Argument.
  - Party 0x09/0x00; Form 0x07 (0 = 3er-Party, 1 = 3 Gruppen, 2 = 2 Gruppen);
    Save 0x0E/0x00; Name 0x06 (0 Cloud … 0x09 Chocobo); Shop 0x08 mit Shop-Nummer 0x00–0xFF.
- `WINDOW.BIN` (BIN-GZIP): 6 B Header, 1062 B statische Menütexturen, 3034 B Fonttextur ab
  0x2754, 163 B unbekannt ab 0x332E (S. 56).
- Save-Modul liest zur Vorschau nur die **ersten 80 Bytes** jedes Slots (S. 62).

### 5.1 Save-Slot-Layout (S. 67–71) — ohne plattformspezifischen Header
Kernpunkte: 0x0000 Checksum (2 B); 0x0004–0x0047 Preview-Block (Level, 3 Portraits, Name 16 B
0xFF-terminiert, Cur/Max HP, Cur/Max MP, Gil, Sekunden, Location 32 B FF-Text);
0x0048–0x0053 4× RGB Fensterecken; **0x0054 + 9 × 132 B Charakter-Records** (Cloud, Barret,
Tifa, Aerith, Red XIII, Yuffie, Cait Sith, Vincent, Cid); 0x04F8–0x04FA Party-Slots;
**0x04FC 640 B Item-Bestand (2 B × 320)**; **0x077C 800 B Materia-Bestand (4 B × 200)**;
0x0B7C Gil; 0x0B80 Spielzeit in Sekunden; 0x0B94 Current Map; 0x0B96 Current Location;
0x0B9A/0x0B9C/0x0B9E Weltkarten-X/Y/Z.
Ab **0x0BA4** Script-Bank 1/2: 0x0BA4 Plot-Progress-Variable; **0x0BA7 Aerith-, 0x0BA8 Tifa-,
0x0BA9 Yuffie-, 0x0BAA Barret-Love-Points**; 0x0BB0 Kämpfe, 0x0BB2 Fluchten;
0x0BB4–0x0BB7 Spieluhr (h/min/s/Zehntel); 0x0BE4 8 B Key Items;
0x0BF9–0x0BFC Field-Chocobo-Ratings; 0x0BC9 Menü-Sichtbarkeitsmaske, 0x0BCB Menü-Sperrmaske
(Bitreihenfolge LSB→MSB: item, magic, mtra, eqip, status, ordr, limit, cfg, PHS, save);
0x0C02–0x0C05 Ratings der 4 Gehege-Chocobos (1 = Wonderful … 8 = schlechtestes).
Ab 0x0CA4 Bank 3/4: 0x0CEE Party-GP (0–10000); 0x0CFC Anzahl Ställe, 0x0CFE besetzte Ställe,
0x0CFF Maske besetzter Ställe. Ab 0x0DA4 Bank B/C: 0x0DC4 ff. Chocobo-Slots 1–4 (je 16 B).
Ab 0x0EA4 Bank D/E: 0x0EA4 aktuelle CD; 0x0EC4 ff. sechs Chocobonamen (je 6 B FF-Text);
0x0EE8 ff. sechs Stamina-Werte (je 2 B); 0x0EFD U-Boot an/aus; 0x0F15 Ortsname (24 B);
0x0F32 Weltkarten-Hinweise; 0x0F66/0x0F67 Party-Tile-X/Y; **0x0F68 Blickrichtung
(0x00 Süd, 0x40 Ost, 0x80 Nord, 0xC0 West)**; 0x0F86–0x0F8B analog fürs U-Boot.
Ab 0x0FA4 Bank 7/F: 0x0FA6 Weltkarten-Kamera + Map-Anzeige (Summe aus Kamera Aerial 0x00 /
Closeup 0x20 und Map Off 0x80 / Small 0x00 / Large 0x40); **0x0FAB muss 0x00 sein, sonst Absturz**;
**0x1030 Field-Regen-Schalter (ungleich 0 → Regen)** — direkt relevant für S39;
0x1084/0x1094 Chocobo-Slots 5 und 6; 0x10A3 Ende der Script-Bänke.
Danach: 0x10AD PHS-Sperrmaske, 0x10AF PHS-Sichtbarkeitsmaske (LSB Cloud … Cid);
**0x10D8 Battle Speed (0x00 schnellste, 0xFF langsamste)**, 0x10D9 Battle-Message-Speed,
0x10EC Message-Speed.
*Hinweis: Die Offsetspalte des PDF enthält in diesem Bereich mehrere offensichtliche Zahlendreher
(z. B. 0x0BB8→0x0BBD, 0x0BEC→0x0BC9, 0x0D04→0x0EA3) — bei der Implementierung nur die
eindeutigen Einträge übernehmen.*

### 5.2 Charakter-Record (132 B, S. 72–73)
0x00 Sephiroth-Flag (Vincent→Sephiroth); 0x01 Level (0–99); 0x02–0x07 Str/Vit/Mag/Spr/Dex/Lck
(je 0–255); **0x08–0x0D Source-Boni** (Power/Guard/Magic/Mind/Speed/Luck Sources);
0x0E Limit-Level (1–4); **0x0F Limit-Bar (0xFF = Limit bereit)**; 0x10 Name (12 B FF-Text);
0x1C/0x1D/0x1E Waffe/Rüstung/Accessoire; 0x1F (3 B) Character Flags; 0x22 gelernte Limits;
**0x24 Kill-Zähler** (Waffenmodifier 0xA7!); 0x26/0x28/0x2A Nutzungszähler Limit 1-1/2-1/3-1;
0x2C Cur HP; **0x2E Base HP (vor Materia)**; 0x30 Cur MP; 0x32 Base MP;
**0x38 Max HP (nach Materia), 0x3A Max MP (nach Materia)**; 0x3C Cur EXP;
0x40–0x47 Waffen-Materia-Slots 1–8; 0x48–0x4F Rüstungs-Materia-Slots 1–8;
0x80 EXP bis zum nächsten Level.
*Widerspruch im Dokument: Record ist 132 B (0x84), Slots enden bei 0x4F, dann springt die
Tabelle auf 0x80 — die Bytes 0x50–0x7F sind nicht dokumentiert.*

### 5.3 Chocobo-Record (16 B, S. 73)
0x0 Sprint-Speed, 0x2 Max Sprint, 0x4 Speed, 0x6 Max Speed, 0x8 Acceleration, 0x9 Cooperation,
0xA Intelligence, 0xB Personality, 0xC Pcount, 0xD gewonnene Rennen, 0xE Geschlecht
(0 m / 1 w), 0xF Typ (Gelb, Grün, Blau, Schwarz, Gold).

---

## 6. Field-Modul (S. 74–124) → `formats-field`, `field-runtime`, `render-field`, `walkmesh`

### 6.1 Dateien und Container
PSX: `/FIELD/*.DAT` (Script), `*.MIM` (Backgrounds), `*.BSX` (3D). PC: `FLEVEL.LGP` mit je einer
Datei pro Field, **LZS-komprimiert**, und `CHAR.LGP` für Modelle (S. 74).

### 6.2 PC-Field-Header (S. 75)
0x00 2 B Null; 0x02 4 B Sektionsanzahl (immer 9); danach 9 × 4 B Offsets. Sektionen:
1 Field Script & Dialog, 2 Camera Matrix, 3 unbekannt (Model Loader?), 4 Palette, 5 Walkmesh,
6 unbekannt, 7 Encounter, 8 unbekannt, 9 Background. Jede Sektion beginnt mit 4 B Länge.

### 6.3 Sektion 1 — Script/Dialog (S. 76)
```c
struct FF7SCRIPTHEADER {
  u16 unknown1; char nEntities; u16 unknown2;   // < nEntities, evtl. sichtbare Entities
  u16 wStringOffset; u16 nExtraOffsets; u16 unknown4[4];
  char szCreator[8]; char szName[8];            // nie angezeigt
  char szEntities[nEntities][8];
  u32 dwExtraOffsets[nExtraOffsets];
  u16 vEntityScripts[nEntities][32];            // Subroutinen-Offsets
};
```
- Pro Entity eine 64-B-Tabelle mit 2-B-Zeigern ⇒ **max. 32 Skripte je Entity**; Tabelle N liegt
  bei `header_length + N*64`. Die Länge eines Skripts ergibt sich nur aus dem Abstand zum
  nächsten Skript.
- Dialoge: direkt nach dem letzten Skript 2 B Anzahl, dann Zeigertabelle (Zeiger **relativ zur
  Tabelle**), danach die Texte; `0xFF` beendet einen Dialog. Es gibt Dialoge, die in der Tabelle
  gar nicht referenziert sind.
- PSX-DAT: identischer Sektionsinhalt, aber **28 Bytes Vorspann** (7 × 2-B-RAM-Adressen);
  alle Dateiadressen brauchen +28 (oder man entfernt die 28 Bytes).

### 6.4 Sektion 2 — Kameramatrix (Kero, S. 77–78)
- 0x00/0x06/0x0C je 3 × S16 = X-, Y-, Z-Achsenvektor; **Fixpunkt mit Faktor 4096**, Vektorlänge
  immer 4096, orthonormal. **Vorzeichen von y und z jeder Achse umdrehen**, dann durch 4096 teilen.
- 0x12 S16 unbekannt (gleicht der z-Komponente des z-Achsenvektors).
- 0x14/0x18/0x1C je S32 = Position im Kameraraum. Weltposition:
  ```
  tx = -(ox*vx.x + oy*vy.x + oz*vz.x)
  ty = -(ox*vx.y + oy*vy.y + oz*vz.y)
  tz = -(ox*vx.z + oy*vy.z + oz*vz.z)
  ```
- 0x20 U32 (immer 0), **0x24 2 B Zoom** (größer = Modell und Walkmesh größer).
- Linkshändiges System: x links→rechts, y unten→oben, z nah→fern. Der Autor ist sich bei
  Vektorreihenfolge und Zoom-Vorzeichen ausdrücklich unsicher.

### 6.5 Sektion 4 — Palette (Terence, S. 79)
0x00 2 B Länge (Wiederholung), 0x02 2 B unbekannt, 0x04 1 B (oft 0), **0x05 Anzahl Farben + 1**,
0x09 1 B (oft 0), ab 0x0A Palettendaten. Einträge sind **15 Bit + Maskbit**, Bitfolge
`rrrrr ggggg bbbbb m`. Paletten sind in 256-Farben-"Pages" organisiert (Farbe 256 = Page 1/Farbe 0).

### 6.6 Sektion 5 — Walkmesh (Kero, S. 79–80) → `walkmesh`
- 0x00 u32 `NoS` = Anzahl Sektoren.
- Sector Pool ab 0x04, Länge `NoS*24`: pro Sektor 3 Vertices `struct { short x, z, y, res; }`
  — **Achsreihenfolge x, z, y**, dann ein Reserve-Short (oft = z, aber nicht immer).
  Polygone sind offenbar im Uhrzeigersinn orientiert.
- Access Pool ab `0x04 + NoS*24`, Länge `NoS*6`: 3 Shorts pro Sektor.
  `acces1` = Kante Vertex 0→1, `acces2` = 1→2, `acces3` = 2→0. **0xFFFF = Kante nicht überschreitbar.**
  Der Access-Wert ist die Ziel-Polygon-ID; ist die Konsistenz verletzt, bleibt FF7 stehen.

### 6.7 Sektion 7 — Encounter (Terence, S. 81–82)
Immer **48 Bytes** (52 inkl. Längenfeld). Aufteilung:
- 0x00 (2 B) Encounter-Daten-Set 1, evtl. Encounter-Rate im 2. Byte
- 0x02–0x0D: Kampf-ID + Chance-Byte, **die Chance-Bytes summieren sich auf 64**, wenn Kämpfe möglich sind
- 0x0E–0x17: Sekundär-Encounter (Zweck unklar, teils leer)
- 0x18: Encounter-Daten-Set 2 (oft leer)
- 0x1A–0x25: Kämpfe + Chancen für Set 2, wieder Summe 64
- 0x26–0x2F: Sekundär-Encounter für Set 2
Ambush-Encounter liegen wohl separat, mutmaßlich ab 0x14 (unsicher). Als Kuriosum: Tonberry
steht in den Encounterdaten von `trnad_51`, einem reinen Szenen-Raum, und kann nie auftreten.

### 6.8 Sektion 9 — Background (Terence, S. 82–85) → `render-field` (S39!)
- 0x28 Word `BGWidth`, 0x2A `BGHeight`, 0x2C `NumBGSprites`, ab 0x32 Sprite-Daten (**52 B je Sprite**).
- Danach 7 B unbekannt; bei `0x32 + NumBGSprites*52 + 7` Word `NumBG2Sprites`; 0x12 B unbekannt;
  bei `0x32 + NumBGSprites*52 + 0x1B` die Layer-2-Sprites; danach 0x3D B unbekannt;
  bei `0x32 + NumBGSprites*52 + NumBG2Sprites*52 + 0x58` die Rohbilddaten.
- Sprite-Record (Delphi-Notation): `ZZ1, X, Y : Smallint; ZZ2[2]; SrcX, SrcY; ZZ3[4]; Pal;
  Flags : Word; ZZ4[3]; Page, Sfx; NA : Longint; ZZ5; OffX, OffY : Longint; ZZ6`.
- **Jeder Sprite ist ein 16×16-Block**: Zielposition (X, Y), Quellposition (SrcX, SrcY, Page),
  Palettenseite (Pal).
- Rohdaten sind in **256×256-Pages** mit je **6 Bytes Page-Header**. Quelloffset:
  `StartOffset := (Page shl 16) or ((SrcY shl 8) or SrcX) + (Page+1)*6;`
  (Das Dokument schreibt daneben `Page*$FFFF + SrcY*$FF + SrcX + (Page+1)*6` und erklärt
  256×256 = `$FFFF` — **das ist falsch**, korrekt sind 0x10000 bzw. 0x100; die Shift-Variante
  ist die maßgebliche.)
- Ziel-`X`/`Y` sind direkt verwendbar; **(0,0) liegt vermutlich in der Bildmitte**, nicht oben links.
- Layer-1-Sprites werden **hinter** den Layer-2-Sprites gezeichnet.
- Qhimms (und Ficedulas) Code **zeichnet Sprites mit `Sfx != 0` gar nicht**, weil die Bedeutung
  unbekannt ist — das ist eine bekannte Lücke, die S39 betreffen dürfte.
- Farbkonvertierung FF7 → 16-Bit-RGB: Rot- und Blaukanal tauschen:
  `DCol := ((Col and $1F) shl 10) or (Col and $3E0) or ((Col and $7C00) shr 10)`.
- Rendering-Konzept (S. 74–75): Backgrounds sind 16×16-Blöcke, die pro Frame aus dem VRAM in den
  Framebuffer zusammengesetzt werden; Layer verdecken 3D-Entities über einen simplen
  Painter's-Algorithmus. **Grellgrüne Flächen in den Cache-Bereichen waren Debug-Marker** für
  Löcher in der oberen Ebene. Beim Emulator-Upscaling mit Texturfilter "bluten" untere Layer
  über die Kanten — deshalb wurden die Backgrounds für den PC nie neu gerendert.
  Nebenbei: eine Textur-Cache-Region enthält ausschließlich Augen-Sprites für das zufällige
  Blinzeln der Charaktere.

### 6.9 Field-Script-Opcodes (S. 121–122) → `interpreter`
- **246 Kommandos.** Das PDF enthält eine vollständige 16×16-Opcode-Matrix (S. 121), aber nur
  **vier ausformulierte Kommandos**: 0x00 RET, 0x01 REQ, 0x30 WINDOW, 0x48 ASK. Der Fließtext des
  Kapitels "Event Scripting" ist Lorem ipsum.
- Die Matrix ist trotzdem wertvoll als Namens-/Positionsreferenz. Zeilen (0x_0 … 0x_F):
  - `00`: RET REQ REQSW REQEW PREQ PRQSW PRQEW RETTO JOIN SPLIT SPTYE GTPYE ?0C? ?0D? DSKCG SPECIAL
  - `10`: GotoNext GotoNextLong GotoPrev GotoPrevLong IfUByte IfUByteL IfSWord IfSWordL IfUSWord IfUSWordL – – ?1C? – – –
  - `20`: MINIGAME TUTOR BTMD2 BTRLD wait NFADE BLINK BGMOVIE KAWAI KAWIW PMOVA SLIP BGPDH BGSCR WCLS WSIZW
  - `30`: IF-KEY IF-KEYON IF-KEYOF UC PDIRA PTURA WSPCL WNUMB STTIM GOLD+ GOLD- CHGLD HMPMAX1 HMPMAX2 MHMMX HMPMAX3
  - `40`: message MPARA MPRA2 MPNAM – MP+ – MP- ASK MENU MENU2 BTLTB – HP+ – HP-
  - `50`: window WMOVE WMODE WREST WCLSE WROW GWCOL SWCOL ST-ITM DL-ITM CK-ITM SM-TRA DM-TRA CM-TRA SHAKE NOP
  - `60`: MAPJUMP SCRLO SCRLC SCRLA SCR2D SCRCC SCR2DC SCRLW SCR2DL MPDSP VWOFT FADE FADEW IDLCK LSTMP SCRLP
  - `70`: battle BTLON BTLMD PGTDR GETPC PXYZI PLUS! PLUS2! MINUS! MINUS2! INC! INC2! DEC! DEC2! TLKON RDMSD
  - `80`: set byte SET-WORD BIT-ON BIT-OFF BIT-XOR PLUS PLUS2 MINUS MINUS2 MUL MUL2 DIV DIV2 MOD MOD2 AND
  - `90`: AND2 OR OR2 XOR XOR2 INC INC2 DEC DEC2 RANDOM LBYTE HBYTE 2BYTE SETX GETX SEARCHX
  - `a0`: PC CHAR DFANM ANIME1 VISI XYZI XYI XYZ MOVE CMOVE MOVA TURA ANIMW FMOVE ANIME2 ANIM!1
  - `b0`: CANIM1 CANM!1 MSPED DIR TURNGEN TURN DIRA GETDIR GETAXY GETAI ANIM!2 CANIM2 CANM!2 ASPED – CC
  - `c0`: JUMP AXYZ LADER OFST OFSTW TALKR SLIDR SOLID PRTYP PRTYM PRTYE IF-PRTYQ IF-MEMBQ MMB+- MMBLK MMBUK
  - `d0`: LINE LINON MPJPO SLINE SIN COS TLKR2 SLDR2 PMJMP PMJMP2 AKAO2 FCFIX CCANM ANIMB TURNW MPPAL
  - `e0`: BGON BGOFF BGROL BGROL2 BGCLR STPAL LDPAL CPPA RTPAL ADPAL MPPAL2 STPLS LDPLS CPPAL2 RTPAL2 ADPAL2
  - `f0`: MUSIC Sound AKAO MUSVT MUSVM MULCK BMUSC CHMPH PMVIE MOVIE MVIEF MVCAM FMUSC CMUSC CHMST GAMEOVER
- `WINDOW` (0x30 in der Beschreibung, in der Matrix bei 0x50 als `window`): id=byte, x=long,
  y=long, h=long, w=long — legt nur einen Container an, zeigt kein Fenster.
  *Das PDF vertauscht in der Beschreibung „h = Breite" und „w = Höhe" und schreibt zweimal
  „X coordinate" — offensichtliche Fehler.*
- `ASK` (0x48): unknown=byte, win=byte, mes=byte, first=byte, last=byte, var=byte.
  Der Autor markiert selbst als offen, **wohin das Ergebnis geschrieben wird**.

### 6.10 Beobachtetes Verhalten aus den Debug-Räumen (S. 86–119)
Der lange Debug-Room-Katalog ist überwiegend Inhaltsdokumentation, enthält aber Engine-Fakten:
- Der Debug-Raum wurde beim finalen Build nur "ausgesperrt", nicht entfernt; Zugang über Savegame.
- `STARTMAP` setzt Kamera und Spieler auf (0,0,0) mit Rotation (0,0,0) — brauchbarer
  Referenz-Testfall für `render-field`/Kamera (S. 86).
- Ein `MAPJUMP` ohne gesetzte Location-Variablen lässt die Spielfigur hängen — das ist der
  häufigste Fehler in den Debug-Skripten und beschreibt implizit, dass MAPJUMP die Zielposition
  **nicht** selbst aus dem Field ableitet (S. 101–103, 116).
- Räume testen gezielt einzelne Kommandos: STPAL/ASPAL/LDPAL (Field-Lichtschattierung), WSIZW/WCLSE
  (Fenster), SWCOL (Fensterfarbe), TLKON/SOLID/VISI, MMB+-/PRTYE/PRTYP, GOLD+/GOLD-, HP-/MP-,
  KAWAI (nach dem Animator benannt) (S. 100–101).
- Zwei gleiche Charaktere in der Party sind unmöglich; der Sephiroth-Vincent wird sonst aus der
  Battle-Engine entfernt (S. 108).
- Das Namensmenü zweimal für dieselbe Figur zu benutzen überschreibt den Namen mit dem
  Standardnamen (S. 62).

---

## 7. Battle Mechanics (Terence Fergusson, S. 126–155) → `battle-runtime` — **Kernstück**

### 7.1 Stats (S. 127–128)
Primär: Str, Vit, Mag, Spr, Dex, Lck, Lvl. Abgeleitet:

| Abgeleitet | Berechnung |
|---|---|
| Atk | Str + Weapon Attack Bonus |
| At% | Weapon Attack% Bonus |
| Def | Vit + Armour Defense Bonus |
| Df% | **(Dex / 4)** + Armour Defense% Bonus |
| MAt | Mag |
| MDf | Spr + Armour MDefense Bonus |
| MD% | Armour MDefense% Bonus |

**Bug (S. 128, wiederholt S. 209):** Der MDefense-Bonus der Rüstung wird **nicht** zu MDf addiert.
Der Statusbildschirm zeigt das ebenfalls (der Equip-Bildschirm zeigt den nicht wirksamen Bonus).
Gilt auf PC *und* PSX. Magischer Schaden ist also unabhängig vom MDef-Wert der Rüstung.
Ausrüstungsboni auf Primärstats wirken im Kampf, sind aber nur im Statusbildschirm sichtbar.

### 7.2 Notation
`[x]` = Abrunden (Floor), `x ... y` = ganzzahlige Gleichverteilung inklusive Grenzen,
`Rnd` = Zufallszahl in [0,1] (Präzision im Dokument ausdrücklich unbekannt).

### 7.3 Base Damage (S. 133)
```
Physisch:  Base Damage = Att + [(Att + Lvl) / 32] * [(Att * Lvl) / 32]
Magisch:   Base Damage = 6 * (MAt + Lvl)
```
Die Engine kann eine Formel prinzipiell mit dem jeweils anderen Angriffsstat aufrufen; im Spiel
tut das keine bekannte Fähigkeit.

### 7.4 Vollständige Schadenspipeline (S. 134–140)
Reihenfolge exakt so implementieren:

1. **Negative-Damage-Flag** setzen: true, wenn der Angriff das Element *Restorative* trägt, sonst false.
2. **Base Damage** (falls die Formel Base benutzt).
   - Status *Small* → Base Damage mit `Att = 0` berechnen.
   - Hero-Drink-artige Mods:
     `Base = [Base * (100 + Physical Base Mod) / 100]` bzw. mit Magical Base Mod.
     Hero Drink erhöht beide um je 30, Maximum 100.
3. **Formel anwenden** (Base × Power, %-von-HP, %-von-MaxHP, Cure-Formel = Magic-Formel + Power,
   Fixed Power, Recovery, Spezialformeln). Danach `dam = [dam]`.
4. **BD-/UW-Modifier** (nur bei Base-Commands: Attack, 2x-Cut, 4x-Cut, Slash-All, Mug, Morph,
   D. blow; **nicht** bei Limit, Magic, Summon, Item, E. Skill, Throw).
   Kombination zweier Modifier (Nenner immer 16, Rundung **auf**):
   `New BDM = [(BD1 * BD2 * 16) + (15 / 16)] / 16`
   Anwendung: `dam = [BD Modifier * dam]`.
   *Die Formelzeile ist so gedruckt und rechnerisch fragwürdig (das `+15/16` müsste innerhalb der
   Klammer vor dem Floor stehen); das mitgelieferte Beispiel 9/16 × 2/16 → 2/16 zeigt eindeutig
   „aufrunden auf das nächste 1/16", also `ceil(BD1*BD2*16)/16` in 1/16-Einheiten. Diese
   Interpretation implementieren, nicht die gedruckte Zeile.*
5. **All-Tar-Split**: außer bei No-Split und außer wenn nur 1 Ziel in der Gruppe:
   `dam = [dam * 2 / 3]`.
   Physical-Formel-Angriffe splitten **immer**. Magical-Formel-Angriffe sind nur dann No Split,
   wenn sie nicht zwischen All Tar und 1 Tar umschaltbar sind — alles, was mit All-Materia geht,
   splittet daher. Die Cure-Formel splittet **immer**, unabhängig von den Zieldaten.
6. **Quadra Magic**: `dam = [dam / 2]` (auch bei Demi und FullCure; nur wenn die Fähigkeit
   überhaupt Schaden oder Heilung macht).
7. **Verteidigung** (entfällt bei Piercing):
   ```
   physisch: DefNum = [Def * (100 + Defense Mod) / 100]
   magisch:  DefNum = [MDf * (100 + MDefense Mod) / 100]
   dam = [dam * (512 - DefNum) / 512]
   ```
   Hero Drink +30 auf beide Mods, Dragon Force +50; Obergrenze je 100.
8. **Berserk / Critical**: Berserk und Physical Base → `dam = [dam * 1.5]`.
   Kritischer Treffer (Glück, Deathblow, Lucky Girl, Auto-Crit) und Physical Base → `dam = dam * 2`.
9. **Frog**: Caster ist Frog und Angriff nutzt Physical Base → `dam = [dam / 4]`.
10. **MP Turbo**: `dam = [dam * (1 + (MP Turbo Level / 10))]`.
11. **Back Row** (entfällt bei magischen und Long-Range-Angriffen): steht Caster **oder** Ziel
    hinten → `dam = [dam / 2]`. Wird **nur einmal** angewandt, auch bei Selbstangriff.
12. **Barrier / MBarrier**: je `dam = [dam / 2]`, sofern der Angriff nicht No-Barrier ist.
    Betroffen sind i. d. R. nur Physical-, Magical- und Cure-Formel-Angriffe.
13. **Sadness** (entfällt bei NRV, Restore und Items):
    `dam = dam - [dam * 79 / 256]`   (⇒ effektiv 177/256 ≈ 69,1 %).
14. **Zufallsstreuung** (entfällt bei NRV): `dam = [dam * (15 + Rnd) / 16]`.
15. **Untergrenze**: `if (dam < 1) dam = 1`. Werte über 9999 bleiben hier noch unangetastet.
16. **Added Damage Effects**: ganzzahlige Multiplikatoren, `dam = dam * ADE`.
    Waffen-ADE wie BD-Modifier nur bei Base-Commands.
17. **Elementprüfung und finale Statusprüfungen** — **erste zutreffende Affinität gewinnt**,
    Reihenfolge Absorb → Void → Half → Weak:
    - Absorb: Negative-Damage-Flag **umschalten** (nicht setzen!)
    - Void: `dam = 0`
    - Half: `dam = [(dam + 1) / 2]`  ← Aufrundung, kein simples Halbieren
    - Weak: `dam = dam * 2`
    Poison ist Sonderfall: Immunität gegen den Status impliziert Immunität gegen das Element,
    aber Absorb-Poison wird zuerst geprüft. Waffen-Elementaffinität zählt nur bei Base-Commands.
    Shield-, Peerless- und Gegnersonderfähigkeitsprüfungen liegen ebenfalls hier; ihre exakte
    Position ist **unbekannt**.
18. **Deckelung**: `if (dam > 9999) dam = 9999`.
    Bei MP-Schaden ohne HP↔MP-Materia am Ziel stattdessen `if (dam > 999) dam = 999`.
    HP↔MP tauscht auch die Deckelung: mit HP↔MP am Ziel gilt für **HP**-Schaden die 999-Grenze.
19. **Negative Damage**: bei true wird `dam` geheilt statt zugefügt.

Der Autor stellt selbst klar, dass die Reihenfolge nicht zu 100 % gesichert ist ("educated
guesses", geschätzt für 99 % der Fälle korrekt) — für `battle-runtime` als Konvention
dokumentieren, nicht als bewiesene Wahrheit.

### 7.5 Angriffs- und Zieltypen (S. 130–133)
- Physical/Magical/Piercing/Attack/Absorb/LR/Restore/Recovery/Change Status/Misc.
- **Restorative** ist ein Element mit invertierten Regeln: ohne Affinität heilt es; wer
  Restorative *absorbiert* (Untote!), nimmt Schaden. Untote sind also **nicht** „schwach gegen
  Holy", sondern absorbieren Restorative.
- **Recovery**: füllt HP und MP komplett; gegen Ziele, die das Element der Fähigkeit absorbieren,
  wird stattdessen Death zugefügt (Anzeige "Recovery" bzw. "Death").
- **Change Status** hat ein Rating in eckigen Klammern; grobe Näherung: Chance aus 64, brauchbar
  gegen Gegner gleicher Stufe. Die **exakte Formel ist unbekannt**. [63] ist praktisch 100 %.
- Zielarten: `1 Tar`, `<n> Tar` (n zufällige Ziele der Gruppe, z. B. Omnislash = 15 Op),
  `All Tar`, `All Tar (NS)`, `Area` (ganzes Schlachtfeld), `Random [All]` / `Random [Area]`.

### 7.6 Elemente (S. 129–130)
Normal: Fire, Ice, Lightning, Earth, Poison, Gravity, Water, Wind, Holy, Restorative.
Nur physisch, praktisch nie in Elementrechnungen: Cut, Hit, Punch, Shoot, Shout.
**16. verstecktes Element ("Hidden")**: sollte offenbar entfernt werden, wirkt wegen
schlampiger Programmierung aber weiter — man schützt sich dagegen, indem man **irgendeine**
Nicht-Element-Materia mit Elemental-Materia in der Rüstung verlinkt.

### 7.7 Statuseffekte (S. 140–153)
31 Status; nicht im Statusbildschirm: Dual, Death Force, Resist, Lucky Girl, Imprisoned.
Numerisch verwertbar:

| Status | Dauer | Wirkung |
|---|---|---|
| Near-Death | – | ab **HP ≤ 25 % des aktuellen Max-HP** und nicht tot |
| Sleep | **26 Einheiten** | kann nicht handeln; **jeder physische Treffer weckt** |
| Poison | bis Kampfende | **[MaxHP / 32]** physischer Poison-Elementschaden **alle 2,5 Einheiten**; ignoriert Def und Barrier, NRV |
| Sadness | bis geheilt | ≈ 177/256 Schaden, **Limit-Balken-Wachstum halbiert** |
| Fury | bis geheilt | Attack% gesenkt, **Limit-Balken-Wachstum verdoppelt** |
| Haste | bis Kampfende | Zeiteinheiten laufen **doppelt so schnell** — auch alle Timer laufen doppelt schnell ab |
| Slow | bis Kampfende | Zeit halbiert; Timer laufen entsprechend länger |
| Stop | **15 Einheiten** | Zeit = 0, kann nicht handeln; andere Timer zählen währenddessen **nicht** herunter |
| Frog | bis Kampfende | alle physischen Angriffe auf **1/4 Base Damage**; nur Fight, Item/W-Item, Toad; **kein Limit** |
| Small | bis Kampfende | **Att = 0** → 1 HP Schaden vor allen Nach-Zufall-Modifikatoren; Elemental und ADE rechnen mit dieser 1 weiter |
| Slow-numb | **30 Einheiten** | bei 0 → Petrify |
| Petrify | bis Kampfende | kann nicht handeln, gilt als „tot", **voidet allen Schaden und alle Statusänderungen** (auch Heilung) |
| Regen | **32 Einheiten** | ≈ **MaxHP / 32 pro Zeiteinheit** |
| Barrier / MBarrier | je **30 Einheiten** | halbiert physischen / magischen Schaden |
| Reflect | bis Kampfende/erschöpft | **max. 4 Reflexionen pro Casting pro Charakter** |
| Shield | **17,5 Einheiten** | voidet normale Angriffe, **absorbiert elementare Magie und physischen Schaden**; **Items und nicht-elementare Magie kommen durch** |
| Death-sentence | **60 Einheiten** | bei 0 → Death (Death-Schutz greift) |
| Peerless | **17,5 Einheiten** | voidet allen Schaden, immun gegen alle Status; **Heilung ebenfalls unmöglich** |
| Paralysed | **8 Einheiten** | kann nicht handeln; **nicht** durch physische Treffer heilbar |
| Berserk | bis Kampfende | physischer Schaden ×1,5, keine Kontrolle, **kritische Treffer unmöglich** |
| Dual | ??? | „umgekehrtes Regen": ≈ MaxHP/32 Verlust je Zeiteinheit (nur Bottomswell) |
| Confusion / Manipulate | bis Kampfende | je durch **einen physischen Treffer** aufhebbar |
| Imprisoned | bis Kampfende | kann nicht handeln, gilt als tot, **nicht anvisierbar** |

**Weitere harte Regeln:**
- Farbpriorität beim Blinken (höchste zuerst): Slow-numb (grau), Poison (grün), Berserk (rot),
  Peerless (gelb), Darkness (schwarz), Regen (orange), Manipulate (cyan) (S. 151).
- Statusausschlüsse (S. 151–152): Death löscht **alle** Status außer Frog und Small;
  Sleep/Stop/Paralysed/Petrify löschen Manipulate; Sadness ↔ Fury; Haste ↔ Slow;
  Petrify löscht zusätzlich Slow-numb.
- **Heilreihenfolge**: erst HP, dann Statusentfernung **von oben nach unten** in fester
  Reihenfolge. Konsequenz: White Wind braucht zwei Anwendungen, um z. B. Frog *und* Resist zu
  entfernen, weil beim ersten Mal Resist noch aktiv ist (S. 152).
- Vollständige Heilmatrix Esuna/Remedy/DeBarrier/DeSpell/White Wind/Angel Whisper (S. 152–153).
  Holy Torch = alles was DeSpell kann, außer Death Force und Resist.
- Reflektierbar (S. 153): eine namentlich vollständige Liste von Magie und Enemy Skills.
  **Nicht** reflektierbar: Demi/Demi2/Demi3, Reflect, DeBarrier, DeSpell, Escape, Remove,
  Comet/Comet2, FullCure, Shield, Ultima; von den Enemy Skills u. a. White Wind, Big Guard,
  Angel Whisper, Dragon Force, Bad Breath, Beta, Trine, Magic Breath, Goblin Punch, Chocobuckle,
  L5 Death, Death Sentence, Roulette. **Alle Summons und alle Items sind nicht reflektierbar.**
- Immunität = Resist: Wer immun gegen einen Status ist, kann diesen Status auch **nicht heilen**
  (Ribbon + Hyper außerhalb des Kampfs → Fury bleibt für den ganzen Kampf) (S. 132–133).

### 7.8 Game Over (S. 154)
Verloren, wenn alle drei aktiven Charaktere als „tot" markiert sind: durch Death, Petrify,
Imprisoned oder durch Aus-dem-Kampf-Werfen per Eat (Hungry), Goanni (Ghost Ship),
Whirlsand (Ruby Weapon). **Abgrenzung:** Blown Away (Midgar Zolom), Scissor Tornado
(Scissors Upper) und Sun Diver (Gighee) markieren den Charakter als *geflohen*, nicht als tot —
sterben oder fliehen dann alle anderen, zählt der Kampf als Flucht.
Wer am Kampfende noch als „tot" markiert ist, bekommt **weder EXP noch AP**. Nur der Status
Death überdauert den Kampf.
Sonderfälle: Emerald Weapon ohne Underwater-Materia = Zeitlimit; Niederlagen in Battle Square,
Fünf-Götter-Pagode und Fort Condor sind kein Game Over; Zeitablauf in der Mako-Reaktor-1-Mission
ist ein Game Over **außerhalb** des Kampfs.

---

## 8. scene.bin (Fremen, S. 157–166) → `formats-battle`

- Pfad: PSX `/DATA/BATTLE/SCENE.BIN`, PC `/BATTLE/SCENE.BIN` — **auf beiden Plattformen identisch**.
- Struktur: **Blöcke à exakt 0x2000 Bytes**. Blockanfang: 16 Zeiger à 4 B (0x0000–0x003C);
  `Offset = pointer * 4`; `0xFFFFFFFF` markiert Blockende. Danach die gzip-Dateien, jeweils auf
  4 B ausgerichtet (mit 0xFF aufgefüllt); ~10 Dateien je Block; Block mit 0xFF auf 0x2000 gefüllt.
- Ergebnis: **256 entpackte Dateien à 7808 Bytes**.
- **Battle-Number-Mapping: je 4 Kampfnummern → 1 Scene-Datei** (Kämpfe 0–3 → Datei 0, 4–7 →
  Datei 1 usw.); 1024 mögliche Kampfnummern insgesamt.
- Datei-Layout: 3 × 2 B Enemy-IDs + 2 B Padding; 4 × 20 B Battle Setup 1; 4 × 48 B Battle Setup 2;
  4 × 6 × 16 B Battle Formations; **3 × 184 B Enemy Data ab 0x0298**; **32 × 28 B Attack Data ab
  0x04C0**; 32 × 2 B Attack IDs ab 0x0840; 32 × 32 B Attack Names (FF-Text) ab 0x0880;
  512 B 0xFF-Padding ab 0x0C80; **3 × 2 B AI-Offsets ab 0x0E80**; 26 B unbekannt;
  **AI-Daten ab 0x0EA0, 4063 Bytes, beginnend mit 6 × 0xFF**.
  *Fehler im PDF: „Battle Setup 1, Record" wird als 20 B gelistet, die Formatbeschreibung spricht
  von 16 B; Attack Data 10 und 11 haben denselben Offset 0x05BC; Battle Formation 4 Record 4 steht
  fälschlich bei 0x0168. Bei der Implementierung nachrechnen.*
- **Battle Setup 1** (S. 162–165): 2 B Battle Location als Index in eine **vollständig
  abgedruckte Tabelle 0x0000–0x0059** (Grassland 0x0002, Mt Nibel 0x0003, … Ultimate Weapon –
  Forest 0x0059). Sehr nützlich für `render-battle`-Stage-Zuordnung. Danach 14 B unbekannt.
- **Enemy Data (184 B)**: 0x00 Name (32 B, 0xFF-gefüllt); 0x20 Level; 0x21 Speed; 0x22 Luck;
  0x23 physisches Ausweichen; 0x24 Strength; 0x25 physische Verteidigung; 0x26 Magic Power;
  0x27 Magic Defense; **0x28 8 B Elementliste** (0x00 Fire, 0x01 Ice, 0x02 Bolt, 0x03 Earth,
  0x04 Bio, 0x05 Gravity, 0x06 Water, 0x07 Wind, 0x08 Scare, 0x09 Health, 0x0A Cut, 0x0B Hit,
  0x0C Punch, 0x0D Shoot, 0x0E Scream, 0xFF kein Element); **0x30 8 B Affinitätsrate**
  (0x00 Death, 0x02 Weakness = 200 %, 0x04 Resist = 50 %, 0x05 Defense = 0 %,
  0x06 Absorb = −100 %, 0x07 HP Max, 0xFF nichts); 0x38 84 B unbekannt (vermutlich
  Verhaltensdaten); 0x8C Drop-Item; 0x8F Steal-Item (0xFFFF = keins); 0x9D MP;
  0x9F AP; 0xA1 Morph-Ziel (0xFFFF = keins); 0xA5 (4 B) HP; 0xA9 (4 B) EXP; 0xAD (4 B) Gil.
  *Die Offsets ab 0x008C sind im PDF um 1 versetzt (0x008C+2 B ergäbe 0x008E, nicht 0x008F) —
  auffällige Ungenauigkeit, unbedingt gegen echte Daten verifizieren.*
- Die **Enemy-AI-Sprache selbst ist nicht dokumentiert**, nur Offset und Größe des Blocks.

---

## 9. Battle-Modelle und -Stages (S. 167–174) → `formats-model`, `render-battle`

- **PSX-Stages (Micky, S. 167–168):** LZS in `STAGE1`/`STAGE2`; Word = Sektionsanzahl, dann
  Zeiger. Erste Sektion unbekannt, letzte enthält TIM-Textur und Paletten, dazwischen Meshes.
  Je Mesh: u32 Größe der Vertexdaten, 8 B je Vertex (3 × u16 x/y/z + Pad);
  Dreiecke: u16 Anzahl + u16 Texturpage, 16 B je Dreieck (3 × u16 Vertexindex, u16 unbekannt,
  u1/v1, u16 Palette+Flags, u2/v2, u3/v3);
  Quads: u16 Anzahl + u16 Texturpage, 20 B je Quad (4 × u16 Index, u1/v1, u16 Palette,
  u2/v2, u3/v3, u4/v4, u16 unbekannt).
- **PSX-Battle-Modelle (Cyberman, S. 168–171):** LZS mit 4 B unkomprimierter Größe; danach
  u32 Sektionsanzahl + Offsettabelle. Sektion 1 = Modell; **Sektionen 2 bis zur TIM = Animationen**;
  bei Charaktermodellen **16 Sektionen nach der TIM = Waffenmodelle**.
  Bone: `{ UINT16 Parent; INT16 Length; UINT32 Offset; }`; Root-Bone ist komplett 0 und zählt
  nicht mit; **Offset 0 = Joint ohne Geometrie**; **alle Bone-Längen sind negativ**;
  Zeichnung von Parent zu Child. Vertexpool-Größe ist immer Vielfaches von 8.
  Polygonordnung folgt der **Linke-Hand-Regel**; **Quads sind in der Reihenfolge A B D C**
  gespeichert (PSX zeichnet Quads als zwei Dreiecke). **Palettennummer: `(PAL >> 7) & 7`.**
  Vertexfarben sind 24 Bit, obwohl nur 15 Bit dargestellt werden. Transparenz über
  Palettenindex mit gesetztem Bit 15.
- **PC-Battle-Modelle (Mirex, S. 172–174):** `battle.lgp` in `FF7/DATA/BATTLE`. 4-Zeichen-Namen;
  erste zwei Zeichen = Modell (`aa`–`of` Gegner, `og`–`rr` Battle-Stages, `rs`–`sm` Spieler,
  z. B. `rt` = Cloud); Zeichen 3–4 = Typ (`aa` Skelett, `ac`–`al` Texturen, `am`–`cj` Körperteile
  als .P, `ck`–`cz` Waffen, `da` Animationen; `ab` unbekannt). Summons liegen analog in
  `magic.lgp` mit Namen `creature.p??` / `.t??` / `.d` / `.a??`.
  - Skelett `AA`: 52-B-Header (u. a. `bones` bei Offset 12), dann je Bone 12 B:
    `long parent (-1 = Root); float length (immer negativ); ulong model (1 = hat Geometrie)`.
  - Animationen `DA`: u32 Anzahl, dann je Animation ein 23-B-Header
    (`rec_a, rec_b, block_len, block_a, real_data_len, translat[3], u1`) und Daten der Länge
    `block_len - 11`.
  - **Rotationen sind 12-Bit-Ganzzahlen, nicht Floats**: 3 Winkel = 4,5 Bytes;
    `Grad = euler * 360 / 4096`. Das PDF zeigt ein durchgerechnetes Bitbeispiel
    (`DC BF FE 00 3E` → 3531/4094/3 → 310,3° / 359,8° / 0,2°).
    Der Autor merkt an, dass mit dieser Lesart praktisch nur der erste Frame plausibel aussieht —
    die Animationsdaten sind **nicht vollständig verstanden**.

---

## 10. World Map (S. 175–177) → `formats-world`, `world-runtime`

Nur ein einziger belastbarer Absatz, alles andere Lorem ipsum:
- Dialoge in `mes`, Eventdateien `wm0.ev`, `wm2.ev`, `wm3.ev` (vom Autor als Vermutung markiert),
  Encounter in `enc_w.bin`.
- **Encounterdaten in `enc_w.bin` ab Offset 0xB8, je Abschnitt 32 Bytes:**
  - 0x00 = `01`
  - 0x01 = Encounter-Rate (1 B) — **niedrigere Werte = höhere Rate**
  - 0x02–0x0D: 6 Records à 2 B, normaler Kampf + Chance (**Chancen summieren sich zu 64**)
  - 0x0E–0x15: 4 Records Spezialformationen + Chance
  - 0x16–0x1F: 5 Records Chocobo-Kämpfe + Chance
- Je Gebiet **vier Felder in dieser Reihenfolge**: Grass, Dirt/Snow, Forest/Desert, Beach.
- Gebietsreihenfolge: Midgar, Kalm, Junon, Corel, Gold Saucer, Gongaga, Cosmo, Nibel, Rocket,
  Wutai, Woodlands, Icicle, Mideel, North Corel, Cactus Island, Goblin Island
  (Goblin Island hat keine vollständige leere Beach-Liste).

---

## 11. Chocobo-Zucht (Terence Fergusson, S. 180–196) → `field-runtime` (komplett Field-Script!)

Explizit angemerkt (S. 180): **Chocobo-Zucht ist kein eigenes Modul, sondern vollständig in
Field Script implementiert.** Damit ist dies der einzige komplett formalisierte
Field-Script-Algorithmus im Dokument — ein hervorragender Integrationstest für `interpreter`.

- Stats: Dash, Max Dash, Run, Max Run, Stamina (max. 9999), Accel, Co-Op, Int, Performance
  (0 normal … 2 Sprinter), RT Count, Races Won, Gender, Color, Rating (1 = Wonderful … 8 = schlechtestes).
  **Anzeigewerte im Chocobo-Rennen: Speed = [Dash / 34], Stamina = [Stamina / 10].**
- **Nur das Rating** wird gespeichert, solange der Chocobo im Gehege steht; alle übrigen Stats
  entstehen erst beim Einstallen (S. 180).
- Basistabelle Max Dash / Stamina: je Rating **8 gekoppelte Wertepaare** (vollständig auf S. 181
  abgedruckt, z. B. Wonderful MDash 3500…4000 / Stam 4500…3500; Terrible MDash 1300…1500 /
  Stam 1000…800). Danach **je Wert unabhängig**: 1/2 Chance +Rnd(0..127), sonst −Rnd(0..127).
- Dash:
  - Wonderful/Great/Good/So-So: `Dash = [Max Dash / 10] * Rnd(5..8)`
  - Average/Poor/Bad/Terrible: `Dash = [Max Dash / 10] * ([Rnd(0..255) / 50] + 3)`
- Run/Max Run mit `x = 100 * Rnd(2..4)` (obere vier Ratings) bzw. `100 * Rnd(2..5)`:
  `Max Run = Max Dash − x`, `Run = Dash − x`.
- Co-Op, RT Count, Races Won = 0; Gender 50/50; Accel und Int als Vielfache von 10 je nach Rating
  (Wonderful/Great: `10*Rnd(6..7)` bzw. `10*Rnd(5..6)`; … Bad/Terrible: `10*Rnd(2..5)` bzw.
  `10*Rnd(0..2)`); Performance-0-Chance 7/8, 3/4, 1/2, 1/2 je Ratingpaar, sonst 50/50 auf 1 und 2.
- **Greens** (S. 183–184): pro Sorte exakte Zufallsbereiche und Obergrenzen (Gysahl: `x=Rnd(0..3)`,
  Dash +x, Run +Rnd(0..2), Stamina +(3−x), Co-Op +1 … Sylkis: `x=[Dash/10]`, `y=[Rnd(0..255)/25]`,
  50 % `x+y`, sonst `x−y` mit Minimum 0, analog für Run mit `[Run/10]` und Stamina mit
  `[Stamina/50]`, Int +Rnd(1..4), Co-Op +4). Pahsana senkt über RT Count die Performance:
  bei Performance > 0 steigt RT Count um Rnd(1..4); erreicht RT Count 100, wird Performance = 0.
  *Anmerkung: Bei Krakka steht „Co-Op … Maximum of 10" — mit hoher Wahrscheinlichkeit ein Typo
  für 100.*
- **Nüsse** (S. 185–195): für jede der acht Nüsse (Pepio, Luchile, Saraha, Lasan, Pram, Porov,
  Carob, Zeio) exakte Wahrscheinlichkeitsverteilungen mit 1/16-, 3/32- bzw. n/256-Nennern,
  Bruchmodifikatoren (1/33, 1/20, 1/18, 1/15, 1/10, 1/8), Ober-/Untergrenzen (Max Dash/Run
  max. 6000, Stamina max. 9999) und die immer gleichen Normalisierungsschleifen
  („so lange 100 abziehen, bis Dash < Max Dash" usw.).
  Farbregeln u. a.: Grün×Blau ergibt je nach Nuss 25 % oder 50 % Schwarz; Carob Nut mit
  Grün×Blau und **≥ 9 gewonnenen Rennen der Eltern ⇒ garantiert Schwarz**, sonst 10/256 Schwarz,
  128/256 Blau, 118/256 Grün; Carob mit zwei Great/Good-Eltern und **≥ 4 Rennen ⇒ garantiert
  Blau oder Grün (je 50 %)**, sonst 69/256 Blau, 69/256 Grün, 118/256 Gelb.
  Zeio Nut mit Schwarz × Wonderful: 1/32 direkt Gold, sonst Gold **nur** wenn die Eltern
  zusammen ≥ 12 Rennen gewonnen haben; ein so erzeugter Gold-Chocobo hat Rating Great.
  Für Schwarz (Carob) bzw. Gold (Zeio) gibt es zusätzliche Max-Dash-Bonustabellen mit
  16-teln, danach `x = [Rnd(0..255)/5]` bzw. `/10` und 50/50 auf Addition oder Subtraktion.
  Gold mit Max Run < 4000 erhält +1000 Max Run — **darf dabei Max Dash übersteigen**.
- Schlussregeln (S. 195–196): Eltern brauchen 3–10 Kämpfe Erholung, das Baby 3–18 Kämpfe bis zur
  Reife. **17/256 Chance auf einen Sprinter-Shift**: `x = 100*Rnd(3..10)`, nur wirksam, wenn
  `Run > x` und `Max Dash + x ≤ 6000`; dann Run und Max Run −x, Dash und Max Dash +x.
- **Bug (S. 196 und S. 209):** Beim Ermitteln der Performance des Babys wird die Variable **nicht
  reinitialisiert**. Sollte Performance 0 herauskommen, kann das Baby stattdessen die Performance
  des zuvor geborenen Chocobos erben — aber nur, wenn man den Bildschirm seit der letzten Zucht
  nicht verlassen hat. Da maximal zwei Babys ohne Verlassen möglich sind, ist der Effekt klein,
  aber reproduzierbar.

---

## 12. Item-/Materia-Indizes und Textkodierung (S. 197–206)

### 12.1 Item-Inventar-Kodierung (S. 197) — **wichtig für `formats-save`**
Record = 2 Bytes: ID-Byte + Mengen-Byte. Es gibt 319 Items (ohne Key Items), also mehr als 256 IDs.
**Für IDs 0x00–0x3F teilen sich zwei Items eine ID; das Mengen-Byte entscheidet:**
gerade → erstes Item, ungerade → zweites Item. **Tatsächliche Menge = Mengen-Byte ganzzahlig / 2.**
Beispiel: `03 07` → ID 0x03, 7 ist ungerade → Mythril Armlet, 7/2 = 3 Stück.
Für IDs 0x40–0xFF **muss** das Mengen-Byte gerade sein.
Vollständige ID-Liste 0x00–0xFF ist abgedruckt (0x00 Potion / Bronze Bangle … 0xFF Masamune).

### 12.2 Materia-Inventar (S. 203–205)
Record = 4 Bytes: 1 B ID + 3 B AP; **`FF FF FF` = Master**. Vollständige ID-Liste 0x00–0x5A
plus `FF` = nicht ausgerüstet ist abgedruckt (0x00 MP Plus … 0x2C Enemy Skill, 0x30 Master
Command, 0x31–0x48 Magie, 0x49 Master Magic, 0x4A–0x59 Summons, 0x5A Master Summon).
Lücken: 0x16, 0x26, 0x2D–0x2F, 0x3F, 0x42, 0x43 fehlen in der Liste.
Der Autor bestätigt, dass diese IDs mit den PSX-GameShark-Listen übereinstimmen.

### 12.3 FF-Textkodierung (S. 206) → `dialog`
Keine ASCII-Tabelle. 0x00 = Leerzeichen, dann ASCII-ähnlich verschoben:
0x00–0x0F Satzzeichen, 0x10–0x19 Ziffern 0–9, 0x20 `@` gefolgt von A–O, 0x30 P–Z u. a.,
0x40 Backtick + a–o, 0x50 p–z, 0x60–0x7F akzentuierte Zeichen, 0x80 ff. Sonderzeichen
(`{Comnd}`, °, ¢, £, ¶, ß, ®, ©, ™, ≠, Æ, Ø, ≦, ≧, ¥, µ, ∂, Σ, Π, π, ♀, ♂, Ω).
**0xD0–0xD7 = Farbcodes** (GRAY, BLUE, RED, PURPLE, GREEN, CYAN, YELLOW, WHITE).
**0xE0 ff. = Steuerzeichen und Namensplatzhalter**: TAB, Komma, EOL, PAUSE, dann
`{Cloud} {Barret} {Tifa} {Aerith} {Red 13} {Yuffie}`, weiter 0xF0 ff.
`{Cait Sith} {Vincent} {Cid}`, dann die PSX-Tastensymbole ○ △ □ ×, **0xFF = {STOP}**.

---

## 13. Source-Code-Forensik (S. 207–208)

Aus `ff7.exe` extrahierbare Quelldateipfade (nur Dateien mit Speicherallokation; Debug-Tracing
blieb im Release-Build als Klartext enthalten). Verwertbar als **Bestätigung der Modulstruktur**:
- `c:\ff7\field\src\ad_*.cpp` — `ad_app`, `ad_bk` (Background), `ad_cdr`, `ad_data`, `ad_ddraw`,
  `ad_human`, `ad_image`, `ad_list`, `ad_obj`, `ad_pal` (Palette), `ad_tile` (Tiles), `tutaddr`
  → bestätigt die Trennung Background/Tile/Palette/Object im Field-Renderer (relevant für S38/S39).
- `c:\ff7\src\battle\battle.cpp`, `b3ddata.cpp`, `battle3d\{amptoanm, bdata, char, enemy,
  limitbrk, lmd, mdl, stage}.cpp` — eigene Übersetzungseinheit **`limitbrk.cpp`** für Limit Breaks.
- Programmiererordner im Battle-Baum: `myoshiok\lasboss3.cpp`, `yama\{coloss,init,inits}.cpp`,
  `yasui\{deadsef,sting,vahamut0}.cpp` — Bosse waren als **einzelne Quelldateien** implementiert,
  nicht rein datengetrieben.
- Minispiele als eigene Bäume: `chocobo\`, `coaster\`, `condor\`, `highway\`, `snobo\`.
- `c:\ff7\src\wm\{wmdefine,wmfile}.cpp` (World Map), `src\menu\...\english\...` (lokalisiertes Menü),
  `src\movie\sm_movie.cpp`, `src\credits\credfile.cpp`, `src\main\{initpath,main}.cpp`.
- Gemeinsame Bibliothek `c:\lib\src\` mit `graphics\` (DirectX- **und** `psx.cpp`/`psxgraph.cpp`
  **und** Software-Renderer `sw\`), `polygon\{anm,plytopd,polygon,rsd,tim}.cpp`,
  `sound\{acm,dx_snd,midi1,sound}.cpp`, `mem\{heap,mem}.cpp`, `thread\thread.cpp`.
  → `plytopd.cpp` belegt eine Konvertierung PLY → interne Polygondaten.

---

## 14. Bekannte Bugs mit Auslösebedingung (S. 128, 196, 209)

1. **Rüstungs-MDefense wirkungslos** (S. 128/209): Der MDefense-Bonus der Rüstung wird nicht in
   MDf eingerechnet. Auslöser: immer, PC und PSX. Sichtbar im Statusbildschirm (fehlend) vs.
   Equip-Bildschirm (angezeigt). Folge: magischer Schaden ist unabhängig vom Rüstungs-MDef.
2. **Chocobo-Performance nicht reinitialisiert** (S. 196/209): Wenn nach allen Regeln
   Performance 0 herauskäme, erbt das Baby ggf. die Performance des vorherigen Babys.
   Auslösebedingung: zweite Zucht **ohne** den Bildschirm zwischendurch zu verlassen.
3. **Verstecktes 16. Element** (S. 130): Sollte deaktiviert sein, ist es aber nicht. Man kann sich
   dagegen schützen, indem man eine beliebige Nicht-Element-Materia mit Elemental-Materia in der
   Rüstung verlinkt — unbeabsichtigtes Verhalten.
4. **Savemap 0x0FAB muss 0 sein** (S. 71): Andernfalls stürzt das Spiel ab.
5. **Doppelter Charakter in der Party** (S. 108): Der zweite wird getötet und aus der
   Battle-Engine entfernt.
6. **`MAPJUMP` ohne Location-Daten** (mehrfach, S. 101–103, 116): Figur bleibt unspielbar stecken.
   Die Debug-Skripte reproduzieren das massenhaft.
7. **Walkmesh-Inkonsistenz** (S. 80): Führt eine Kantenüberquerung in ein Polygon, in dem der
   Spieler laut Access-Pool nicht liegt, bleibt FF7 stehen.
8. **Falsch ausgerichtetes Dialogmenü** (S. 96): Wenn mehr Auswahlzeilen adressiert werden als der
   Dialog Zeilen hat, verschiebt sich die Zuordnung Zeile → Aktion um eins.
9. PC-Port allgemein (S. 8): läuft nicht auf NT-Kerneln wegen fehlplatzierter Pointer;
   Softwarerenderer-Fallback ohne Paletted-Texture-Support bei High-Color;
   inkompatibel mit Cyrix-/AMD-CPUs beim Release.
10. Die Kapitel *PSX Specific Bugs* und *PC Specific Bugs* (S. 209–210) sind **leer** (Lorem ipsum).

---

## 15. Top-Findings für WebMidgar (Ranking, mit Paketzuordnung)

1. **Vollständige 19-Schritt-Schadenspipeline mit exakten Floors und Reihenfolge** (S. 134–140)
   → `battle-runtime`. Das ist die einzige Stelle, an der die Kombinationsreihenfolge von
   All-Tar-Split, Quadra, Defense, Berserk/Crit, Frog, MP Turbo, Back Row, Barrier, Sadness,
   Zufall, Untergrenze, ADE, Element und Deckelung dokumentiert ist. Direkt in Testfälle gießbar.
2. **Base-Damage-Formeln** `Att + [(Att+Lvl)/32] * [(Att*Lvl)/32]` und `6*(MAt+Lvl)` (S. 133)
   → `battle-runtime`. Fundament für jede weitere Verifikation.
3. **Status-Timerwerte in „Einheiten"** (Sleep 26, Stop 15, Slow-numb 30, Regen 32, Barrier/
   MBarrier 30, Shield 17,5, Peerless 17,5, Death-sentence 60, Paralysed 8; Poison alle 2,5;
   Haste/Slow verdoppeln/halbieren die Zeitrate; Stop friert Timer ein) (S. 141–151)
   → `battle-runtime`. Damit lässt sich die ATB-Zeitbasis kalibrieren, auch ohne dass das
   Dokument die ATB-Formel selbst nennt.
4. **Field-Section-Layout mit Walkmesh, Kameramatrix und Background-Sprites** (S. 75–85)
   → `formats-field`, `walkmesh`, `render-field`. Für S39 zentral: 16×16-Sprites, Layer-1-hinter-
   Layer-2, Palettenseiten, `Sfx != 0` als bekannte Blackbox, die Page-Offset-Formel.
5. **Savemap-Bankmapping + Charakter-Record + Item/Materia-Kodierung** (S. 11, 67–73, 197, 203)
   → `formats-save`, `interpreter`. Besonders die **Odd/Even-Item-ID-Trickserei** und die
   Bankadressen 0x0BA4/0x0CA4/0x0DA4/0x0EA4/0x0FA4.
6. **Field-Script-Opcode-Matrix mit 246 Kommandos** (S. 121) → `interpreter`. Auch ohne
   Stelligkeiten eine belastbare Namens- und Positionsreferenz — relevant, weil das Projekt laut
   Commit-Log gerade Kommando-Stelligkeit belegt.
7. **scene.bin-Struktur inkl. Battle-Number→Datei-Mapping (4:1) und Enemy-Data-Layout**
   (S. 157–166) → `formats-battle`, `battle-runtime`.
8. **LZS-Dekompression mit den beiden Sonderfällen** (negativer Offset → Nullen, überlappende
   Runs) (S. 28–30) → `formats-lgp`/`convert`. Wer das übersieht, dekomprimiert FF7-Dateien falsch.
9. **Chocobo-Zucht als vollständig spezifizierter Field-Script-Algorithmus** (S. 180–196)
   → `field-runtime`, `interpreter`. Idealer End-to-End-Test für den Interpreter mit
   deterministisch prüfbarem RNG-Verhalten.
10. **.P-Gruppensemantik** (gruppenrelative Polygon-/Edge-Indizes, aber absolute Vertexindizes im
    Edge-Chunk; `numEdge` per Differenz) (S. 46–54) → `formats-model`, `render-actor`. Bekannte
    Stolperfalle, direkt für S38 relevant.
11. **12-Bit-Euler-Rotationen in PC-Battle-Animationen** (`Grad = euler * 360 / 4096`)
    (S. 173–174) → `formats-model`, `render-battle`.
12. **World-Map-Encounterlayout in `enc_w.bin`** (0xB8, 32-B-Abschnitte, Chancensumme 64,
    4 Terraintypen × 16 Gebiete) (S. 175–176) → `formats-world`, `world-runtime`.
13. **Battle-Location-Tabelle 0x00–0x59** (S. 162–165) → `render-battle` (Stage-Zuordnung).
14. **Waffen-Special-Options 0xA0–0xA8 als konkrete UW-Modifier-Formeln** (S. 18)
    → `formats-kernel` + `battle-runtime`; verbindet Datenfeld und Kampfformel.
15. **FF-Textcodetabelle inkl. Farb- und Namenscodes, 0xFF = STOP** (S. 206) → `dialog`, `menu`.

---

## 16. Offene Fragen / vom Dokument nicht Beantwortetes

**Kampfsystem**
- **Die ATB-/Turn-Order-Formel fehlt vollständig.** Es gibt nur die Begriffe „Time Unit",
  „time bar" und Statusdauern in Einheiten; wie sich Dex, Battle Speed (Savemap 0x10D8) und die
  Zeiteinheit zueinander verhalten, wird nirgends definiert.
- **Treffer-/Ausweichformel fehlt.** At%, Df%, MD% werden definiert, aber nie in eine Formel
  eingesetzt. Auch Darkness und Fury sind nur qualitativ als „Attack% reduziert" beschrieben.
- **Kritische-Treffer-Wahrscheinlichkeit** ist nicht angegeben (nur der Effekt ×2).
- **Statusinfliktions-Formel unbekannt**; der Autor gibt nur die Faustregel „Rating aus 64".
- **Limit-Break-Mechanik**: keine Formel für Limit-Balken-Wachstum, keine Limit-Level-Aufstiegs-
  bedingungen, keine Limit-Break-Daten. Nur: Sadness halbiert, Fury verdoppelt das Wachstum;
  Savemap-Felder 0x0E/0x0F/0x22/0x26/0x28/0x2A.
- **Stat-Wachstum beim Levelaufstieg, EXP-Kurven, Source-Effekte**: nur als Existenz erwähnt,
  keine Kurven, keine Tabellen.
- **Materia-AP-Kurven** nur als „Vielfache von 100" im Record; keine konkreten Werte.
- **Gegner-KI-Sprache**: nur Offset (0x0EA0) und Größe (4063 B); keine Opcodes, keine Semantik.
- Shield-/Peerless-/Gegnersonderfähigkeiten: Position in der Elementprüfung ausdrücklich unbekannt.
- Präzision und Verteilung von `Rnd` in Schritt 14 ausdrücklich unbekannt.
- Der Autor stellt die Gesamtreihenfolge der Pipeline selbst unter Vorbehalt.

**Formate**
- Field-Sektionen **3, 6 und 8** sind unbenannt bzw. nur geraten („Model Loader?").
- Background-Sprite-Felder `ZZ1`–`ZZ6`, `Flags`, **`Sfx`**, `NA`, `OffX`, `OffY` sind unbekannt —
  und `Sfx != 0` führt in bestehenden Implementierungen zum Weglassen des Sprites. **Für S39 die
  wichtigste offene Frage.**
- Ob der Ursprung (0,0) des Hintergrunds in der Bildmitte liegt, ist nur eine Vermutung.
- Encounter-Sektion: Bedeutung der „Secondary Encounters", des zweiten Encounter-Sets und die
  genaue Lage der Ambush-Daten sind offen; Encounter-**Rate**-Byte nur vermutet.
- Kameramatrix: Vektorreihenfolge, Vorzeichenbehandlung, Zoom-Signedness und die 2 B bei 0x12 sind
  unsicher; der Autor markiert seine eigene Darstellung mit „FIXME: not yet true".
- Walkmesh: Bedeutung des `res`-Shorts unbekannt; Wicklungsrichtung nur vermutet.
- `.P`: Hundrets-Chunk komplett unverstanden; `mirex_g`, Header-Offsets 0x00/0x04/0x14/0x28/0x2C/
  0x3C und die zweiten 64 Header-Bytes unbekannt; Gruppierung der Texturkoordinaten ungeklärt.
- PC-Battle-Animationen: Der Autor sagt selbst, dass mit der beschriebenen Lesart meist nur der
  erste Frame korrekt wirkt.
- PSX-Battle-Quads: Zweck von `ZZ1` unbekannt.
- LGP-CRC lässt sich nicht erzeugen, nur prüfen.
- TIM: mehrere „Unknown"-Felder; im 4bpp-Layout ist die Offsetliste im PDF inkonsistent
  (`+0x08` Breite, dann `+0x10` Höhe — es fehlt offenkundig `+0x0A`).
- **PSX-Modellformate, MIM- und BSX-Format sind reine Überschriften ohne Inhalt** (S. 85, S. 36).
- KERNEL.BIN Sektion 1 (Command Data): Überschrift und Recordlänge vorhanden, **Feldtabelle leer**.
- Charakter-Record: Bytes 0x50–0x7F undokumentiert.
- Savemap: große „Unknown"-Bereiche (0x0A9C 224 B, 0x0B84 16 B, 0x0BBF–0x0BE3, 0x0C06–0x0CA3,
  0x0D00–0x0DA3, 0x0F6C–0x0F85, 0x0FAC–0x102F, 0x10B0–0x10D7); Key-Item-Liste wird referenziert,
  ist aber **nicht abgedruckt**.
- Enemy Data: 84 B unbekannt (mutmaßlich Verhalten/Aktionen) — genau das, was für Gegner-KI
  gebraucht würde.

**Ganz fehlende Kapitel** (Lorem ipsum): Introduction; PSX Model Formats; Event Scripting
(Fließtext); 3D Overlay; Movies (beide Vorkommen); Battle Overview; Magic Scripting;
Data Organization (zweimal); **FF7 Party Mechanics**; **FF7 Enemy Mechanics**; World Map Overview,
Land, Underwater, Snow Field, Data Format; alle Mini-Game-Kapitel außer Chocobo-Zucht;
Resource Lookup Table; PSX- und PC-spezifische Bugs.

**Empfehlung:** Für Spell-Power-Tabellen, Limit-Break-Daten, Gegnerattribute und Gegner-KI ist
Gears **keine** Quelle — dafür wären die eigenständigen Fergusson-Guides („FF7 Party Mechanics",
„FF7 Enemy Mechanics") nötig, die hier nur als Platzhalter existieren.

---

*Erstellt aus einer vollständigen Textextraktion aller 211 Seiten (pypdf); Rohtext liegt unter
`…\scratchpad\gears-text.txt` mit Seitenmarkern `===== PAGE n =====`.*
