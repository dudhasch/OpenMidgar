# Gaia (LaZar00) — Recherchenotizen für WebMidgar

Stand: 2026-08-10 · Quelle: `https://github.com/LaZar00/Gaia`, shallow clone
(`--depth 1`), HEAD = `07da63b` („Merge pull request #1 from LaZar00/add-license-1").
Arbeitskopie: `…\scratchpad\repos\Gaia`.

---

## 0. LIZENZ — CLEAN-ROOM-WARNUNG (zuerst lesen)

| Punkt | Befund |
|---|---|
| Repo-Lizenz | **GNU GPL v3** (`LICENSE`, 35 823 B, Volltext GPLv3, 29. Juni 2007). Kein `NOTICE`, kein separates Copyright-Header-Schema in den meisten Dateien. |
| Fremdcode im Repo | `Gaia/LZS.cs` steht **nicht** unter GPL, sondern laut eigenem Kopfkommentar (Z. 1–9) unter der **Microsoft Public License (Ms-PL)**; Urheber „Iros" (7th Heaven / Tsunamods). Der Header nennt eine mündliche Nutzungserlaubnis an LaZar00. |
| Weitere Herkunftsangabe | `Gaia/OBJ.cs` Z. 1–2: OBJ-Parser „partial info" aus `github.com/stefangordon/ObjParser`. |
| Datenherkunft | `Gaia/Tables.cs` Z. 1–2 nennt als Quelle der Texturtabelle das **ff7-mods-Wiki**: `ff7-mods/ff7-flat-wiki/docs/FF7/WorldMap_Module/TextureTable.md`. |

**Konsequenz für WebMidgar:** GPLv3 ist mit dem Projektmodell nur bei
vollständiger Übernahme der GPL vereinbar — also gilt hier strikt: **kein
Quellcode, keine Codestruktur, keine wörtlichen Kommentare übernehmen.** Diese
Notiz enthält ausschließlich *Beschreibungen* von Formatfakten mit Fundstellen.

**Als riskant markiert (nicht abschreiben):**
- 🔴 **Die Texturtabelle** (`Tables.cs`, 294 Einträge) — eine große, kreativ
  selektierte Datensammlung. Sie stammt laut Header ohnehin aus dem ff7-mods-Wiki;
  WebMidgar sollte sie **aus der Primärquelle (Wiki) bzw. aus eigener Messung an
  `world_us.lgp`** beziehen, nicht aus Gaia. Unten stehen nur Struktur und
  wenige Beispielzeilen zur Illustration.
- 🔴 **`LZS.cs`** — klassische LZSS-Implementierung (Okumura-Abstammung), Ms-PL.
  WebMidgar hat mit `formats-field/decompressLzs` bereits eine eigene
  Implementierung; die Parameter unten dienen nur der Gegenprüfung.
- 🟡 Die 3DS-Max-Hinweise und die `.psd`/`.png`-Referenzbilder sind Assets des
  Autors — nicht weiterverbreiten, nur als Beleg lesen.

---

## 1. Was das Werkzeug tatsächlich ist

**Gaia Worldmap Converter Tool for FF7 v1.0** — ein Kommandozeilenwerkzeug
(C#, .NET Framework 4.8, `Gaia.csproj`), das die **Weltkarten-Geometriedateien**
von FF7 PC in beide Richtungen konvertiert:

| Richtung | Aufruf | Ergebnis |
|---|---|---|
| `.MAP → .OBJ` (+ `.MTL`) | `gaia wm0.map [-t: -f: -b: -n]` | Wavefront-OBJ der ganzen Karte oder je Block eine `.obj`; Materialbibliothek mit Texturverweisen |
| `.OBJ → .MAP` (+ `.BOT`) | `gaia wm0.obj` | zurück ins Binärformat, anschließend automatisch der `.BOT`-Neubau |
| `.MAP → .BOT` | `gaia wm0.map -r` | reiner `.BOT`-Neubau aus der `.MAP` |
| Rohdump | `… -d:[pfad]` | LZS-**dekomprimierte** Mesh-Blobs als `BlockNN_MeshMM.dec` |

Belegstellen: `Gaia/Program.cs` Z. 13–58 (Hilfetext), Z. 96–389 (Dispatch nach
Dateiendung `.MAP` / `.OBJ` / `.BOT`).

**Berührte FF7-Daten:** ausschließlich das Worldmap-Modul — `WM0.MAP`,
`WM2.MAP`, `WM3.MAP` sowie die zugehörigen `.BOT`. Texturen werden **nicht**
gelesen oder geschrieben; das Werkzeug schreibt nur Dateinamensverweise in die
`.MTL` (`Tables.cs` `writeMatLib*`). Kein `.TEX`-Decoder, kein Encounter-/
Scripting-Teil, kein `world_us.lgp`-Zugriff.

**Repo-Inventar** (vollständig, 8 Quelldateien + 6 Doku-Assets):
`Program.cs` (400 Z., CLI), `Globals.cs` (222, Konstanten + Strukturen),
`Map2Obj.cs` (484, MAP-Leser + OBJ-Export), `Obj2Map.cs` (491, OBJ→MAP-Schreiber),
`Map2Bot.cs` (864, BOT-Leser + BOT-Neubau), `OBJ.cs` (789, OBJ/MTL-Typen und
-Parser), `Tables.cs` (497, Textur- und Walkmap-Tabellen), `LZS.cs` (235).
Doku: `fundamentals/WM0BOTstructure.txt`, `WM2BOTstructure.txt`,
`WM3BOTstructure.txt`, `WorldMap.png`/`.psd`/`WorldMapPure.psd`,
`docs/3DSMax Options.txt` + 2 Screenshots.

---

## 2. Containerformat `.MAP` — Block- und Meshgrammatik

Fundstellen: `Globals.cs` Z. 12–24 (Konstanten), `Map2Obj.loadMapFile`
Z. 96–139 (Leser), `Obj2Map.generate_Meshbinarydata` Z. 312–416 +
`Obj2Map.writeMAP` Z. 419–487 (Schreiber, inkl. Padding/Offsetrechnung).

| Konstante | Wert | Bedeutung |
|---|---|---|
| `BLOCK_SIZE` | `0xB800` = 47 104 B | feste Blockgröße, **Datei = n · 0xB800** |
| `N_MESHES` | 16 | Meshes je Block, gelesen als 4×4-Raster (`i%4` = Spalte, `i/4` = Zeile) |
| `BLOCK_PIXELS` | 32 768 | Kantenlänge eines Blocks in Weltkoordinaten |
| `MESH_PIXELS` | 8 192 | Kantenlänge eines Meshes (32 768 = 4 · 8 192) |
| `VERTEX_NORMAL_DEF` | 4 096 | Normalenskalierung (Int16 / 4096 → Einheitsvektor) |
| `N_BLOCKSBOT` | 332 | Blockzahl der WM0-`.BOT` (hart verdrahtet) |

**Blocklayout** (identisch für `.MAP` und `.BOT`):

```
+0x00  int32[16]   Offsets der 16 Meshes, relativ zum Blockanfang
                   (erster Mesh-Offset ist stets 0x40 = Ende der Tabelle)
+off   int32       Länge des LZS-Datenstroms des Meshes (OHNE dieses Längenfeld)
+off+4 byte[len]   LZS-komprimierter Mesh
       …           auf 4-Byte-Grenze mit Nullen aufgefüllt
+…     Nullen bis exakt 0xB800
```

Der Schreiber führt einen Blockzähler und wirft eine Ausnahme, wenn die Summe
`0x40 + Σ (4 + len + pad)` über `0xB800` steigt (`Obj2Map.writeMAP` Z. 466–470) —
d. h. die 47 104 B sind eine **harte** Obergrenze, kein Zufall der Originaldaten.

**Mesh (nach LZS-Dekompression)** — `Map2Obj.processMAP` Z. 174–231:

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | u16 | `numTriangles` |
| 0x02 | u16 | `numVertices` |
| 0x04 | `Triangle[numTriangles]`, je **12 B** | s. u. |
| … | `Vertex[numVertices]`, je **8 B** | x,y,z Int16 + u16 (in Gaia „always 0?") |
| … | `Normal[numVertices]`, je **8 B** | xn,yn,zn Int16 + u16 (dito) |

Dreieck (12 B), little endian:

| Offset | Typ | Feld | Ableitung |
|---|---|---|---|
| 0 | u8 | `v0` | Vertexindex |
| 1 | u8 | `v1` | |
| 2 | u8 | `v2` | |
| 3 | u8 | Attributbyte | `walkmapID = b & 0x1F` (Bit 0–4), `walkmapUNK = b >> 5` (Bit 5–7) |
| 4–9 | u8 ×6 | `ut0,vt0,ut1,vt1,ut2,vt2` | Texturkoordinaten in **Atlas-Pixeln**, 8 bit |
| 10 | u16 | `texture_location` | `textureID = w & 0x1FF` (9 Bit, 0–511), `locationID = w >> 9` (7 Bit, 0–127) |

➡ **Neu gegenüber WebMidgar:** die Zerlegung des `textureWord` in
`textureID` (unten 9 Bit) und `locationID` (oben 7 Bit).
`packages/formats-world/src/parse.ts` speichert bislang nur `textureWord` roh.

**Weltkoordinaten** (`Map2Obj.export2Obj` Z. 343–361):
`X_welt = x + col_block·32768 + col_mesh·8192`, `Y_welt = y` (Höhe unverändert),
`Z_welt = z + row_block·32768 + row_mesh·8192`; Normale = `(xn,yn,zn)/4096`.
Blockzelle: `col = index % ncols`, `row = index / ncols` — **row-major**, Block 0
links oben. Bestätigt durch `fundamentals/WorldMap.png` (866×770, beschriftetes
Raster 9×7 mit Blocknummern 0–62 plus abgesetzter Reihe 63–68; jede Blockzelle
zusätzlich in 4×4 Meshzellen unterteilt).

**Rasterwahl** (`Globals.get_ncols` Z. 146–166) — nach Blockzahl der Datei:

| Datei | Blöcke `.MAP` | Spalten | Zeilen | Primärblöcke | `.BOT`-Blöcke |
|---|---|---|---|---|---|
| WM0 | 69 | 9 | 7 | 63 (+6 Alternativblöcke 63–68) | 332 |
| WM2 | 12 | 3 | 4 | 12 | 48 |
| WM3 | 4 | 2 | 2 | 4 | 16 |

Deckungsgleich mit `WORLD_GRIDS` in `packages/formats-world/src/types.ts` —
inklusive der dort als 🟡 markierten WM3-Annahme 2×2, die Gaia (in
`WM3BOTstructure.txt` und im Code-Zweig `else` von `rebuildBOT`) als 2×2
**voraussetzt**. Das ist eine unabhängige Zweitquelle für dieselbe Annahme,
aber keine Messung.

---

## 3. LZS-Kompression

`LZS.cs` — LZSS nach Haruhiko Okumura, Parameter `N = 4096` (Ringpuffer),
`F = 18` (max. Matchlänge), `THRESHOLD = 2`, `NIL = N`. Dekoder: Flagbyte mit
8 Bits, LSB zuerst; Bit 1 = ein Literalbyte; Bit 0 = Zweibytepaar
`i = b0 | ((b1 & 0xF0) << 4)` (12-Bit-Position im Ringpuffer),
`j = (b1 & 0x0F) + 2` → `j+1` Bytes werden kopiert. Ringpuffer initial mit
**Nullen** gefüllt, Schreibzeiger startet bei `N − F` = 4078.
(`LZS.cs` Z. 200–233.)

➡ Identisch zum FF7-Field-LZS. WebMidgars `decompressLzs` aus
`@webmidgar/formats-field` ist also **direkt wiederverwendbar** — was
`packages/formats-world/src/parse.ts` bereits tut. Nur der Encoder
(Binärbaum-Matchsuche, `InsertNode`/`DeleteNode`) fehlt WebMidgar noch; er wäre
für `modding`/`convert` (Rückschreiben) relevant, muss aber neu geschrieben
werden (Ms-PL-Code nicht übernehmen).

**Quirk beim Rückschreiben:** Gaia schreibt vor jeden Mesh die Länge des
komprimierten Stroms und füllt danach auf 4 Byte auf. Das Padding zählt in den
nächsten Offset hinein, ist aber **nicht** in der Längenangabe enthalten
(`Obj2Map` Z. 399–405 vs. Z. 447–464). Ein Reimplementat muss beides getrennt
führen, sonst driften Offsettabelle und Daten auseinander.

---

## 4. `.BOT` — exakte Konstruktionsvorschrift (wichtigster Fund)

`.BOT` enthält **keine eigene Geometrie**, sondern dieselben Blöcke der `.MAP`
in einer anderen, redundanten Reihenfolge — WebMidgar hat das bereits gemessen
(FINDINGS S28: „Unikatmengen von MAP und BOT identisch"), aber den
Anordnungszweck als 🟡 offen geführt. Gaia liefert die Vorschrift vollständig:

**Grundregel:** Für jede Rasterzelle `b` (0…62 bei WM0) werden **vier**
aufeinanderfolgende `.BOT`-Blöcke geschrieben — das 2×2-Blockfenster
`[b, b+1, b+cols, b+cols+1]` mit **torusförmigem Umlauf** an beiden Rändern.
`.BOT`-Index = `4·b + k`, `k ∈ {0=oben links, 1=oben rechts, 2=unten links,
3=unten rechts}`. Das bestätigt die WebMidgar-Lesart „Original streamt ein
2×2-Block-Fenster" (`docs/feasibility/03-…` Z. 54) **byteexakt prüfbar**.

Damit: WM0 = 63·4 = 252 Normalblöcke (0–251) + 80 Sonderblöcke (252–331) = 332;
WM2 = 12·4 = 48; WM3 = 4·4 = 16.
Belege: `Map2Bot.rebuildBOT` Z. 291–546 und die drei
`fundamentals/WM*BOTstructure.txt` (Notation dort: `MAPblock(BOTindex)`).

### 4.1 Sonderblöcke 252–331 (WM0) — vollständig rekonstruiert

Die 6 Alternativblöcke 63–68 ersetzen die Rasterzellen **63→50, 64→41, 65→42,
66→60, 67→47, 68→48** (`WM0BOTstructure.txt` Z. 7–13; identisch zu
`WM0_ALTERNATIVE_CELLS` in WebMidgar).

Der Sonderteil enthält **20 weitere Fenster** (= 80 Blöcke), gruppiert:

| Gruppe | ersetzte Zellen | Fensteranker (2×2-Ursprünge) | Fenster | `.BOT`-Blöcke |
|---|---|---|---|---|
| A | 50 → 63 | 40, 41, 49, 50 | 4 | 252–267 |
| B | 41 → 64, 42 → 65 | 31, 32, 33, 40, 41, 42 | 6 | 268–291 |
| C | 60 → 66 | 50, 51, 59, 60 | 4 | 292–307 |
| D | 47 → 67, 48 → 68 | 37, 38, 39, 46, 47, 48 | 6 | 308–331 |

Regel: für eine Gruppe werden genau die 2×2-Fenster erzeugt, die mindestens
eine der ersetzten Zellen enthalten; darin wird jede ersetzte Zelle durch ihren
Alternativblock getauscht. Ich habe alle 20 Fenster gegen `Map2Bot.rebuildBOT`
Z. 349–453 **und** gegen `WM0BOTstructure.txt` nachgerechnet — sie stimmen
durchgängig.

### 4.2 Kumulativität der Alternativgruppen — teilweiser Beleg 🟢/🟡

In den Fenstern der Gruppen **B und C** ist Zelle 50 **ebenfalls schon** durch
Block 63 ersetzt (Gaia kommentiert das ausdrücklich: „we update also BLOCK 63
when Block 50 is present", `Map2Bot.cs` Z. 370, 402). Beispiel: Fenster mit
Anker 40 lautet in Gruppe B `[40, 64, 49, 63]` — Zelle 41 → 64 *und* Zelle 50 → 63.

➡ Das ist ein **echter Beleg für kumulative Stufen** und für die Reihenfolge
„Gruppe {50} vor {41,42} und vor {60}". WebMidgar führt genau diese Gruppierung
(`WM0_ALTERNATIVE_GROUPS = [[50],[41,42],[60],[47,48]]`) bislang als 🟡
Referenzangabe aus ff7-landscaper plus 🔵 Eigenentscheidung. Die `.BOT`-Struktur
hebt Reihenfolge und Kumulativität für die ersten drei Stufen auf „aus den
Originaldaten ableitbar". **Für Gruppe D ({47,48}) fehlt der Beleg**: keines
ihrer 6 Fenster enthält die Zellen 41, 42, 50 oder 60.

### 4.3 Zwei Fehler in Gaias Umlaufrechnung (nachgerechnet)

Die Diagonalzelle (`k = 3`) wird in `Map2Bot.rebuildBOT` Z. 321–331 falsch
umgelaufen: erst der **Zeilen**umlauf (`≥ 63 ⇒ −63`), dann erst der
**Spalten**umlauf (`% 9 == 0 ⇒ −9`). Korrekt ist die umgekehrte Reihenfolge.

| `b` | korrekt (aus `WM0BOTstructure.txt`) | Gaias Rechnung | Status |
|---|---|---|---|
| 53 (Zeile 5, Spalte 8) | 54 | 0 | ✗ |
| 62 (Zeile 6, Spalte 8) | 0 | 9 | ✗ |
| alle übrigen | — | — | ✓ |

Die vorhandene Korrekturzeile (`if (src == 63) src = 0`) läuft nach der
Subtraktion und kann nie greifen — toter Code. Ein WebMidgar-Reimplementat
muss also **Spalte zuerst, dann Zeile** wickeln:
`d = b + cols + 1; if (d % cols == 0) d -= cols; if (d >= primary) d -= primary;`
Diese Fassung reproduziert alle 252 Normaleinträge der `.txt`-Tabelle.

Weitere Einschränkungen desselben Pfads:
- `.BOT`-**Lesen** ist auf WM0 festgenagelt: `get_nblocksbotfile` setzt
  `i_nblocksbot = 332` unbesehen (`Globals.cs` Z. 115–119) — WM2/WM3-`.BOT`
  (48/16 Blöcke) würden über das Dateiende hinaus gelesen.
- `dumpBinaryData` liest immer aus `wm_block`, wird für den `.BOT`-Pfad aber mit
  `i_nblocksbot` aufgerufen, während die Daten in `wm_blockbot` liegen
  (`Globals.cs` Z. 180–220 vs. `Program.cs` Z. 377–380) — der `-d`-Dump einer
  `.BOT` läuft ins Leere.
- Ein `.BOT`→OBJ-Export existiert **nicht**; die Funktion ist auskommentiert
  (`Map2Bot.cs` Z. 620–861).
- `WM3BOTstructure.txt` Z. 5–6 nennt die Datei irrtümlich „WM2.MAP/WM2.BOT" —
  Tippfehler, gemeint ist WM3.

---

## 5. Texturen und UV-Auflösung

### 5.1 Struktur der Tabelle (🔴 Inhalt nicht übernehmen)

`Tables.cs` führt pro `textureID` einen Datensatz `{MName, MWidth, MHeight,
UOffset, VOffset}` (Z. 33–40). Die Liste ist **indexpositioniert** — der
Listenindex *ist* die `textureID` aus den unteren 9 Bit des Dreieckswortes.

| Kartensatz | Auswahlkriterium im Code | Einträge |
|---|---|---|
| WM0 | `i_ncols > 3` | **282** |
| WM2 | `i_ncols == 3` | **8** |
| WM3 | sonst | **4** |

Größen: WM0-Texturen sind 16…128 px breit/hoch (Zweierpotenzen, oft nicht
quadratisch, z. B. 32×128, 128×32, 16×16); WM2 nutzt 128×128 bis 256×256,
WM3 durchgängig 64×64. `UOffset` liegt im Bereich 0…224, `VOffset` **0…480**.
Illustrative Beispiele (drei von 282, zur Veranschaulichung des Schemas):
`clf_l` 64×64 @ (0,0), `md03` 16×16 @ (112,64), `lostmtd` 128×32 @ (128,480).
WM2-Namen: `cltr, lake_a, rock, scave, ssand, swall02, sng01, sng02`;
WM3-Namen: `hokola01, hokola02, snwfldl, snwfld2`.

**Primärquelle für die Tabelle ist das ff7-mods-Wiki**
(`ff7-flat-wiki/docs/FF7/WorldMap_Module/TextureTable.md`, im Datei-Header
zitiert). WebMidgar sollte die Zuordnung entweder von dort beziehen oder — im
Sinne des Clean-Room besser — **selbst aus `world_us.lgp` messen**: die
`.TEX`-Dateinamen im LGP liefern die Namen, deren Kopf die Maße; die Offsets
lassen sich aus der Verteilung der u/v-Bytes je `textureID` in den echten
Meshdaten rekonstruieren (jede `textureID` belegt genau ein Rechteck).

### 5.2 UV-Dekodierung (Algorithmus — sicher nachnutzbar)

`Map2Obj.export2Obj` Z. 365–404. Pro Dreieck und Ecke *i*:

```
u_norm = (u_byte − UOffset[texID]) / Width[texID]
t      = (v_byte − VOffset[texID]) / Height[texID]
v_norm = (t < 0) ? (−t + 1) : (1 − t)          // OBJ-V-Achse zeigt nach oben
```

Rückweg (`Obj2Map.export2Map` Z. 219–237): `u_byte = round(u_norm·W) + UOffset`;
`v` wird mit `v>1 ? −(v−1) : 1−v` gespiegelt und dann
`round(v·H) + VOffset` gerechnet. Beide Bytes werden auf `u8` gecastet, laufen
also **modulo 256 um** — das ist der Grund für die `< 0`-Sonderbehandlung.

➡ **Wichtige Folgerung / offene Stelle:** `VOffset` bis 480 bei nur 8 Bit
V-Koordinate heißt, dass die u/v-Bytes **seitenweise** (PSX-typische
256×256-Texturseiten) zu lesen sind und die Seite *nicht* im Dreieck steht.
Viele Einträge teilen sich denselben (U,V)-Ursprung (z. B. `clf_l`, `shor`,
`md02`, `ggmt` alle bei 0,0) — die Tabelle beschreibt also die Lage **innerhalb
der jeweils eigenen Texturseite**, und die Seitenwahl hängt an der `textureID`
selbst bzw. an einer Seitentabelle des Worldmap-Moduls, die Gaia nicht kennt.
Gaia umgeht das, indem es je `textureID` eine **eigene Bilddatei** referenziert
(`textures/<MName>.<ext>`, `Tables.writeMatLib` Z. 377–378).

### 5.3 Materialnamensschema (Transportkanal für Nicht-Geometriedaten)

Um beim Roundtrip OBJ→MAP nichts zu verlieren, kodiert Gaia die
nicht-geometrischen Dreiecksattribute in den **Materialnamen**:

`<Texturname>_<textureID>_<locationID>_<WALKNAME>_<walkmapID>_<walkmapUNK>`

(`Map2Obj.cs` Z. 416–431; Rücklesen per Split von hinten in `Obj2Map.cs`
Z. 174–206 — daher die Anforderung „mindestens 4 Segmente" und der Hinweis, dass
Option `-n` den Rückweg unmöglich macht.) Für WebMidgars `convert`/`modding`
ist das ein brauchbares *Muster* (Attribute überleben ein DCC-Werkzeug im
Materialnamen), aber ein fragiles: Texturnamen mit `_` verschieben die Segmente.

---

## 6. Walkmap-/Geländeklassen (untere 5 Bit des Attributbytes)

`Tables.PopulateWalkmapID` Z. 461–495 listet **32 Klassen** in Indexreihenfolge
0…31. Das ist eine reine Namenszuordnung ohne Semantik (keine Bewegungskosten,
keine Fahrzeugregeln) und deckt sich mit der verbreiteten
Community-Nomenklatur:

| ID | Name | ID | Name | ID | Name | ID | Name |
|---|---|---|---|---|---|---|---|
| 0 | GRASS | 8 | DESERT | 16 | HILLSIDE | 24 | GLDDESERT |
| 1 | FOREST | 9 | WASTELAND | 17 | BEACH | 25 | JUNGLE |
| 2 | MOUNTAIN | 10 | SNOW | 18 | SUBPEN | 26 | SEA2 |
| 3 | SEA | 11 | RIVERSIDE | 19 | CANYON | 27 | NCAVE |
| 4 | RIVERCROSS | 12 | CLIFF | 20 | MNTPASS | 28 | DSRTBORDER |
| 5 | RIVER | 13 | CORELBRDG | 21 | UNKNOWN1 | 29 | BRDGHEAD |
| 6 | WATER | 14 | WUTAIBRDG | 22 | WATERFALL | 30 | BACK |
| 7 | SWAMP | 15 | UNUSED1 | 23 | UNUSED2 | 31 | UNUSED3 |

➡ WebMidgar führt in `formats-world/types.ts` `walkClass` mit „Wertevielfalt
belegt, Semantik 🟡". Diese Tabelle ist eine 🟡 **Referenzangabe** (keine
Messung, keine Quellenangabe im Repo) — sie taugt als Hypothese, die gegen die
Realdaten geprüft werden kann (z. B. „`SEA`-Dreiecke liegen auf Meereshöhe",
„`CORELBRDG` kommt nur in den Blöcken um Corel vor").

Die oberen 3 Bit (`walkmapUNK`, WebMidgar: `attrHigh`) bleiben auch bei Gaia
unbenannt — sie werden nur durchgereicht.

---

## 7. Sonstige Detailfunde und Quirks

1. **`w`/`wn` je Vertex** (je ein u16 hinter Position bzw. Normale): Gaia
   kommentiert beide mit „always 0?" (`Globals.cs` Z. 79, 83) und schreibt sie
   beim Rückweg **nie** — der Encoder lässt die Felder auf 0
   (`Obj2Map.cs` Z. 368–381 schreibt `.w`/`.wn`, die nie gesetzt wurden).
   Ein OBJ→MAP-Roundtrip ist damit **nicht** byteidentisch, falls die
   Originaldaten dort etwas ungleich 0 tragen. WebMidgar hält die Felder in
   `vertexSpare`/`normalSpare` — die Frage „immer 0?" ist dort messbar.
2. **Normalenrichtung:** `docs/3DSMax Options.txt` hält fest, dass die
   `wm0.map`-Normalen beim OBJ-Import ohne „Flip Normals" **invertiert**
   erscheinen. Relevanter Hinweis für die Beleuchtung in `render-world`.
3. **Vertexlimit:** Vertexindizes sind u8 ⇒ ≤ 256 Vertices je Mesh; Gaia castet
   ungeprüft auf `byte` (`Obj2Map.cs` Z. 241–243) — bei Modding still
   überlaufend. WebMidgars Parser prüft die Indexgrenze bereits explizit.
4. **Kein Blockindex in der Datei:** Die Zuordnung Block↔Rasterzelle ergibt sich
   ausschließlich aus der Dateireihenfolge und der Spaltenzahl; die Spaltenzahl
   wiederum nur aus der Blockzahl. Es gibt keinen Header, keine Magic, keine
   Version.
5. **Erster Mesh-Offset = 0x40:** Der Schreiber initialisiert den Offsetzähler
   fest auf 0x40 (`Obj2Map.cs` Z. 333) — die 16·4 B Offsettabelle ist also nie
   größer und nie kleiner.
6. **OBJ-Gruppennamen** tragen die Semantik: `BlockNN_MeshMM`, per Regex
   `Block\d\d_Mesh\d\d` erzwungen (`OBJ.cs` Z. 43–50). Der Import gruppiert
   ausschließlich danach; die Meshreihenfolge muss lückenlos sein.
7. **Zielrahmen** `net48`, reine Konsolenanwendung, keine Abhängigkeiten außer
   BCL; `Properties/launchSettings.json` verrät den Entwicklungspfad des Autors.

---

## 8. Top-Funde für WebMidgar (gereiht, mit Paketzuordnung)

| # | Fund | Paket(e) | Nutzen |
|---|---|---|---|
| 1 | **Vollständige `.BOT`-Konstruktionsvorschrift** (2×2-Fenster mit Torusumlauf, `.BOT`-Index = 4·Zelle + k) inkl. der 20 Sonderfenster 252–331 | `formats-world`, `render-world` (Streaming), `tools/realdata-scan` | Macht aus dem bisher 🟡 „Zweck der Anordnung" ein **byteexakt prüfbares** Maß: die 332 Blockdigests der echten `WM0.BOT` müssen der Vorschrift folgen. Direkt als `rdtest` formulierbar. Zugleich Bestätigung, dass das Original ein 2×2-Blockfenster streamt → Vorlage für `render-world/streaming.ts`. |
| 2 | **Kumulativität + Reihenfolge der WM0-Alternativgruppen**, aus der `.BOT`-Struktur ableitbar (Zelle 50 ist in den Fenstern der Gruppen {41,42} und {60} bereits getauscht) | `formats-world` (`WM0_ALTERNATIVE_GROUPS`, `resolveBlockIndex`) | Hebt eine 🔵 Eigenentscheidung auf „aus Originaldaten ableitbar" für 3 der 4 Stufen. |
| 3 | **`textureWord`-Zerlegung**: `textureID = w & 0x1FF`, `locationID = w >> 9` | `formats-world`, `render-world` | Voraussetzung für jedes Texturieren der Weltkarte; `locationID` ist zudem ein Kandidat für Regions-/Ortszuordnung (Encounter-Sets, Ortsnamen). |
| 4 | **UV-Dekodierformel** mit texturweitem (U,V)-Ursprung und Größennormierung, inkl. der Vorzeichen-/Spiegelungsregel | `render-world`, `convert` | Der fehlende Schritt zwischen `uv`-Bytes und benutzbaren Texturkoordinaten. |
| 5 | **32er-Walkmap-Klassentabelle** (Namen zu `walkClass` 0…31) | `formats-world`, `world-runtime`, `walkmesh` | Benennt die bereits gemessene Wertevielfalt; Hypothesenbasis für Bewegungs-/Fahrzeugregeln. Als 🟡 Referenz führen. |
| 6 | **Container-Invarianten bestätigt** (0xB800 hart, 0x40 Offsettabelle, 4-Byte-Padding, Länge ohne Padding) | `formats-world`, `modding` | Zweitquelle zu WebMidgars eigener Messung; für das **Schreiben** (Modding) sind Padding-/Offsetregel und die Blockgrößenprüfung die entscheidenden Details. |
| 7 | **LZS-Parameter identisch zum Field-LZS** (N=4096, F=18, THRESHOLD=2, Puffer nullinitialisiert, Start bei 4078) | `formats-field`, `formats-world`, `modding` | Bestätigt die Wiederverwendung; für den fehlenden **Encoder** ist die Bitstromdefinition ausreichend, um eigenständig zu implementieren. |
| 8 | **Bekannte Fehlerquellen als Negativprüfungen**: Diagonalumlauf (Zellen 53, 62), `w`/`wn` gehen beim Roundtrip verloren, u8-Vertexindexüberlauf | `tools/realdata-scan`, `modding` | Fertige Testfälle; die Gaia-Fehler sind gute Regressionsanker („unsere Implementierung darf hier NICHT wie Gaia rechnen"). |
| 9 | **Texturtabelle als Existenzbeweis** (282 benannte WM0-Texturen mit Maßen/Offsets) — 🔴 Inhalt nicht übernehmen | `formats-world`, `render-world`, `pipeline` | Zeigt Umfang und Struktur der benötigten Zuordnung; WebMidgar sollte sie aus `world_us.lgp` selbst messen. |
| 10 | **Materialnamen als Attributkanal** für DCC-Roundtrips | `modding`, `convert` | Muster (nicht Code) für den geplanten Weltkarten-Editor. |

---

## 9. Offene Fragen

1. **Texturseiten:** Wie wird die Texturseite gewählt, wenn `VOffset > 255` und
   die v-Bytes nur 8 Bit haben? Steckt die Seite in `textureID`-Bereichen, in
   `locationID`, oder in einer Tabelle im Worldmap-Modul der `ff7.exe`?
   (Gaia beantwortet das nicht — es weicht auf Einzelbilddateien aus.)
2. **`locationID` (obere 7 Bit):** Gaia transportiert den Wert nur. Ist das eine
   Regions-/Ortsnummer (Ortsnamen-Einblendung, Encounter-Gruppe, Musikzone)?
   → Messbar: Verteilung von `locationID` über Blöcke/Zellen gegen bekannte Orte.
3. **`walkmapUNK` / `attrHigh` (obere 3 Bit):** unbenannt bei Gaia. Kandidaten:
   Steigungs-/Kantenflag, Schatten-/Beleuchtungsflag, Fahrzeugmaske.
4. **`w`/`wn` der Vertices:** tatsächlich immer 0 in allen sechs Originaldateien?
   → In WebMidgar direkt messbar (`vertexSpare`/`normalSpare`).
5. **Alternativgruppe {47,48}:** Ihre Stufe lässt sich aus der `.BOT` **nicht**
   ableiten (keine Überschneidung mit 41/42/50/60). Andere Quelle nötig
   (`ff7.exe`-Worldmap-Modul oder Savegame-Weltfortschrittsflag).
6. **WM3-Raster 2×2:** Gaia setzt es voraus, misst es aber nicht — die Annahme
   bleibt 🟡. Eine unabhängige Bestätigung fehlt weiterhin.
7. **Warum 332 und nicht 252+96?** Die vier Alternativgruppen erzeugen 20 statt
   24 Fenster, weil sich die Fenster benachbarter Alternativzellen überlappen.
   Ist die Reihenfolge der Sonderfenster im Original wirklich A→B→C→D (Gaias
   Annahme), oder ergibt sich eine andere Sortierung aus der Ladelogik?
   → Prüfbar durch Digestvergleich mit der echten `WM0.BOT`.
8. **Nutzt die Engine `.MAP` überhaupt zur Laufzeit**, oder lädt sie
   ausschließlich aus `.BOT`? Die Redundanz legt Letzteres nahe; das hätte
   Folgen für `render-world/streaming.ts`.

---

## 10. Fundstellenverzeichnis (Kurzform)

| Thema | Datei : Zeilen |
|---|---|
| CLI/Optionen | `Gaia/Program.cs` : 13–58, 96–389 |
| Konstanten, Strukturen, Rasterwahl | `Gaia/Globals.cs` : 12–24, 31–84, 103–178 |
| `.MAP`-Leser (Offsettabelle, LZS) | `Gaia/Map2Obj.cs` : 96–139 |
| Meshgrammatik + Bitzerlegung | `Gaia/Map2Obj.cs` : 174–231 |
| Weltkoordinaten + UV-Dekodierung | `Gaia/Map2Obj.cs` : 303–466 |
| Materialnamensschema | `Gaia/Map2Obj.cs` : 414–437; `Gaia/Obj2Map.cs` : 174–206 |
| `.MAP`-Schreiber, Padding, 0xB800-Prüfung | `Gaia/Obj2Map.cs` : 312–487 |
| `.BOT`-Leser | `Gaia/Map2Bot.cs` : 73–242 |
| `.BOT`-Neubau (Normal + Sonderfenster) | `Gaia/Map2Bot.cs` : 247–559 |
| LZS (Ms-PL!) | `Gaia/LZS.cs` : 17–20 (Parameter), 200–233 (Dekoder) |
| Texturtabelle (🔴) | `Gaia/Tables.cs` : 33–350 |
| Walkmap-Klassen | `Gaia/Tables.cs` : 461–495 |
| `.MTL`-Ausgabe | `Gaia/Tables.cs` : 352–446 |
| OBJ-Typen/Parser | `Gaia/OBJ.cs` : 25–339 (Typen), 553–786 (Parser) |
| `.BOT`-Tabellen (Doku) | `Gaia/fundamentals/WM0BOTstructure.txt`, `WM2BOTstructure.txt`, `WM3BOTstructure.txt` |
| Rasterreferenzbild | `Gaia/fundamentals/WorldMap.png` (866×770, Blöcke 0–68 beschriftet) |
| Normalenhinweis | `Gaia/docs/3DSMax Options.txt` |
