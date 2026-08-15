# ff7-landscaper — Reverse-Engineering-Notizen für WebMidgar

**Ziel-Repo:** https://github.com/maciej-trebacz/ff7-landscaper
**Stand:** Commit `3e2708441a8335f14e10fb52bd9af4a82a2a6921`, 2025-10-07, Version 1.1.1
**Lokaler Klon:** `...\scratchpad\repos\ff7-landscaper` (`git clone --depth 1`)
**Erhebungsdatum:** 2026-08-10

---

## ⚠️ 0. LIZENZ — KRITISCH FÜR CLEAN-ROOM

> **Es gibt KEINE Lizenz.** Kein `LICENSE`, kein `COPYING`, kein SPDX-Header, kein
> `license`-Feld in `package.json` (dort nur `"private": true`). Die GitHub-API
> liefert für dieses Repo `"license": null`.

**Konsequenz:** Das Werk ist **„all rights reserved"**. Es ist *nicht* Open Source,
auch nicht permissiv. Jede Übernahme von Quelltext — auch kurzer Ausschnitte, auch
umbenannt — ist eine Urheberrechtsverletzung und würde unseren Clean-Room-Status
zerstören.

**Erlaubt und ausschließlich hier praktiziert:** Übernahme von **Fakten über das
Spieldatenformat** (Offsets, Bitbreiten, Zählungen, Opcode-Nummern). Fakten sind
nicht urheberrechtsfähig. Dieses Dokument enthält **keinen Quelltext** aus dem
Zielrepo — nur Beschreibungen mit Fundstellen.

**Zusätzliche Lizenz-Kontamination im Zielrepo (Doppelrisiko):**

| Datei | Herkunftsangabe im Kopf | Risiko |
|---|---|---|
| `src/ff7/lzss.ts:1-3` | Portierung aus **PyFF7** (Niema Moshiri) | PyFF7 steht unter GPL — der Landscaper-Code ist damit selbst abgeleitetes GPL-Material *ohne* Lizenzangabe. **Niemals anfassen.** |
| `src/ff7/lgp.ts:1-3` | „lookup & conflict parts ported from" PyFF7 | dito |

→ **LZSS und LGP müssen bei uns unabhängig aus der Formatbeschreibung entstehen**
(bzw. sind bei uns ohnehin längst vorhanden). Sie sind hier nur der Vollständigkeit
halber dokumentiert.

**Risiko-Kennzeichnung im Rest des Dokuments:** 🚫 = darf inhaltlich als *Ausdruck*
nicht übernommen werden (Prosa, Farbwahl, Benennungstabellen als Ganzes);
✅ = reiner Datenformat-Fakt, gefahrlos nutzbar.

---

## 1. Projektüberblick

| Aspekt | Wert |
|---|---|
| Zweck | Weltkarten-Editor für FF7 PC (Geometrie, Nachrichten, Encounters, Skripte) |
| Stack | Tauri 2 + React 18 + TypeScript + Vite, Three.js / react-three-fiber, Jotai, Ace-Editor |
| Parser-Basis | `binary-parser` (deklarative Structs) — dieselbe Idee wie unsere `formats-*`-Pakete |
| Umfang | ~23 400 Zeilen TS/TSX; Formatparser in `src/ff7/` (~11 Dateien) |
| Fremdanerkennung (README) | codemann8 (Weltkartendaten), ergonomy_joe (Code-RE), picklejar (World-Skript), Qhimm/FF7-Wiki |

**Direkt übertragbare Muster (Architektur, nicht Code):**
- Ein Modul pro Binärformat, jeweils Klasse mit `read*` / `write*` und Roundtrip-Fähigkeit.
- Dekompilieren→Rekompilieren beim Schreiben von Skripten, um absolute Sprungziele neu zu setzen.
- Nicht-indizierte `BufferGeometry` mit Dreieck-Index == `faceIndex` für O(1)-Picking.

**Relevante Spieldateien und Fundorte:**

| Datei | Pfad im Spiel | Zweck | Fundstelle |
|---|---|---|---|
| `WM0.MAP` / `WM2.MAP` / `WM3.MAP` | `data/wm/` | Terrain-Geometrie | `src/hooks/useMaps.ts:468` |
| `WM0.BOT` u. a. | `data/wm/` | vorexpandierte Sektionsfolge | `src/hooks/useMaps.ts:1039-1043` |
| `world_us.lgp` | `data/wm/` | Archiv: `.ev`, `.mes`, `.tex`, `field.tbl`, `enc_w.bin` | `src/hooks/useLgpState.ts:25` |
| `wm0.ev` / `wm2.ev` / `wm3.ev` | in `world_us.lgp` | Weltskript-Bytecode | `src/hooks/useScriptState.ts:82` |
| `field.tbl` | in `world_us.lgp` | **World→Field-Einstiegspunkte** | `src/hooks/useLocationsState.ts:41` |
| `enc_w.bin` | in `world_us.lgp` | Zufallsbegegnungen | `src/hooks/useEncountersState.ts:32` |
| `ff7_en.exe` | Spielwurzel | Terrain→Encounter-Set-Zuordnung @ `0x56C8A0` | `src/ff7/ff7exefile.ts:29-36` |

---

## 2. Weltkarten-Terrain: `wm*.MAP` ✅

### 2.1 Kartenkonfiguration

Quelle: `src/hooks/useMaps.ts:29-72`, `docs/map-state.md:6`

| Karte | Datei | interne ID | Sektionen X × Z | Sektionen | Meshes/Sektion | Meshes gesamt | Mesh-Raster (Zeilen × Spalten) |
|---|---|---|---|---|---|---|---|
| Overworld | `WM0.MAP` | 0 | 9 × 7 | 63 | 16 | 1008 | 28 × 36 |
| Underwater | `WM2.MAP` | 2 | 3 × 4 | 12 | 16 | 192 | 16 × 12 |
| Great Glacier | `WM3.MAP` | 3 | 2 × 2 | 4 | 16 | 64 | 8 × 8 |

- ID 1 existiert nicht (`src/hooks/useMaps.ts:80`).
- Jede Sektion ist ein **4×4-Untergitter** von Meshes, zeilenweise gespeichert:
  `rowOffset = meshIdx div 4`, `colOffset = meshIdx mod 4` (`src/hooks/useMaps.ts:250-266`).
- Sektionsplatzierung: `sectionRow = sectionIdx div sectionsX`, `sectionCol = sectionIdx mod sectionsX`.

### 2.2 Dateilayout ✅

Quelle: `src/ff7/mapfile.ts:5-32`, `252-291`

| Element | Wert |
|---|---|
| Sektionsgröße | **0xB800 = 47 104 Byte**, fix |
| Sektionskopf | 16 × `uint32le` Mesh-Offsets (64 Byte), relativ zum Sektionsanfang |
| Pro Mesh am Offset | `uint32le` Größe der komprimierten Daten, danach so viele LZSS-Bytes |
| Ausrichtung | Mesh-Blobs auf 4 Byte ausgerichtet |
| Sektionsanzahl | **nicht im Kopf deklariert** — bis EOF lesen, also Dateigröße / 0xB800 |

### 2.3 Dekomprimiertes Mesh ✅

Quelle: `src/ff7/mapfile.ts:34-74`, `188-250`

```
Mesh-Kopf:   uint16le numTriangles
             uint16le numVertices
Dreiecke:    numTriangles × 12 Byte
Vertices:    numVertices  × 8 Byte
Normalen:    numVertices  × 8 Byte   (eine Normale je Vertex, nicht je Dreieck)
```

Größenformel beim Schreiben: `4 + numTriangles*12 + numVertices*16`.

**Dreieck (12 Byte):**

| Offset | Typ | Feld |
|---|---|---|
| +0 | u8 | Vertexindex 0 |
| +1 | u8 | Vertexindex 1 |
| +2 | u8 | Vertexindex 2 |
| +3 | Bitfeld | **3 Bit `script` (high) + 5 Bit `type` (low)** |
| +4..+9 | 6 × u8 | u0, v0, u1, v1, u2, v2 |
| +10 | u16le | `ids` (gepackt) |

**Achtung Bitreihenfolge:** Byte +3 wird als `bit3 script` gefolgt von `bit5 type`
gelesen; beim Schreiben ergibt sich `(script << 5) | type` (`src/ff7/mapfile.ts:38-39`,
`:207`). `type` sind also die **unteren 5 Bit**, `script` die **oberen 3 Bit**.

**`ids`-Entpackung** (`src/ff7/mapfile.ts:181-183`):

| Feld | Bits | Formel | Wertebereich |
|---|---|---|---|
| `texture` | 0–8 | `ids & 0x1FF` | 0–511 |
| `locationId` (Region) | 9–13 | `(ids >> 9) & 0x1F` | 0–31 |
| *unbenutzt* | 14 | — | — |
| `isChocobo` (Chocobo-Spuren) | 15 | `(ids >> 15) & 1` | 0/1 |

**Vertex / Normale (je 8 Byte):** `int16le x`, `int16le y`, `int16le z`, 2 Byte Padding.

### 2.4 Alternativsektionen ✅ (nur Overworld)

Quelle: `src/hooks/useMaps.ts:81-103`, `docs/map-state.md:10`, Bezeichner 🚫 `src/components/map/components/MapControls.tsx:10-15`

Basisanzahl 63; **6 Alternativsektionen liegen direkt danach** als Dateiindizes 63–68,
in der Reihenfolge der ersetzten Sektionen `[50, 41, 42, 60, 47, 48]`.

| Gruppe | ersetzt Sektion(en) | Alt-Dateiindex | Ereignis (Bezeichnung 🚫) |
|---|---|---|---|
| 0 | 50 | 63 | Tempel der Cetra verschwunden |
| 1 | 41, 42 | 64, 65 | Junon-Krater |
| 2 | 60 | 66 | Mideel nach dem Lifestream |
| 3 | 47, 48 | 67, 68 | Cosmo-Canyon-Krater |

**Direkte Antwort auf unsere offene ADR-Frage** (ADR-S28-S29 „Alternativblock-Schaltung
WM0 63–68"): Die Zuordnung 63→50, 64→41, 65→42, 66→60, 67→47, 68→48 ist damit belegt.
Die Umschaltung erfolgt im Spiel über den Opcode `0x349 set_world_progress` mit fünf
Stufen (siehe §4.9).

**Nicht enthalten:** Es gibt hier **keine** Gruppe „Ultimate-Weapon-Krater" und keine
„Midgar zerstört" — genau vier Gruppen.

### 2.5 `.BOT`-Variante ✅

Quelle: `src/ff7/mapfile.ts:293-356`

`WM0.BOT` = **332 Sektionen × 0xB800 = 15 638 528 Byte**. Erzeugungsvorschrift:

1. **252 Sektionen (63 × 4):** Für jede Rasterzelle (`y` 0..6, `x` 0..8) wird der
   2×2-Nachbarschaftsblock `((y+i) mod 7) * 9 + ((x+j) mod 9)` für `i,j ∈ {0,1}`
   geschrieben — **mit Umlauf an den Kartenrändern** (bestätigt unsere Wrap-Annahme
   in ADR-S28-S29 Punkt 3).
2. **80 Sektionen aus den Alternativen:** je Gruppe die Vereinigung der 2×2-Blöcke,
   die *auf* jeder Gruppensektion enden (`id − i*9 − j`), sortiert; zu jeder davon
   wieder deren 2×2-Umlaufblock. Sektions-IDs aus `[50,41,42,60,47,48]` werden dabei
   durch `index + 63` ersetzt.
   Gruppenmengen: g0 {40,41,49,50}→16, g1 {31,32,33,40,41,42}→24, g2 {50,51,59,60}→16,
   g3 {37,38,39,46,47,48}→24. Summe 80.

Beim Speichern werden immer **beide** Dateien geschrieben (`.MAP` und `.BOT`).

### 2.6 Koordinaten und Skalierung ✅

Quelle: `src/components/map/constants.ts:62-66`, `src/hooks/useMaps.ts:392-410`

| Konstante | Wert | Bedeutung |
|---|---|---|
| `MESH_SIZE` | **8192** | Spieleinheiten je Mesh-Kante (quadratisch) |
| Sektionskante | 4 × 8192 = **32768** | Spieleinheiten |
| `SCALE` | **0.05** | Render-Einheiten je Spieleinheit (nur Darstellung) |
| Normalen-Betrag | **4096** (0x1000) | Einheitslänge der gespeicherten Normalen |
| `ATLAS_SIZE` | 2048 | Texturatlas-Kantenlänge |

**Lokal → global:** `offsetX = column * 8192`, `offsetZ = row * 8192`;
`worldX = (localX + offsetX) * SCALE`, `worldY = localY * SCALE`,
`worldZ = (localZ + offsetZ) * SCALE`.

**Y-Achse:** Positionen werden **nicht** gespiegelt. Für die Normalen-Debugdarstellung
werden jedoch **Y und Z negiert** (`src/components/map/components/WorldMesh/hooks.ts:230-232`),
und die „flach nach oben"-Standardnormale beim Import ist `(0, −4096, 0)`
(`src/components/map/components/ExportImport.tsx:268`). → **Im Spieldatenraum zeigt −Y
nach oben.** Das ist ein direkt prüfbarer Vergleichspunkt zu unserem `ff7ToScene`.

### 2.7 Geländetypen (5 Bit, 0–31) ✅ / Bezeichnungen 🚫

Quelle: `src/lib/map-data.ts:26-59`. Die **Namen** sind funktionale Bezeichner (geringes
Risiko); die **englischen Beschreibungstexte und die Farbwerte** sind eigene Schöpfung
des Autors 🚫 und dürfen nicht übernommen werden.

| ID | Name | Begehbarkeitshinweis (sinngemäß) |
|---|---|---|
| 0 | Grass | fast alles befahrbar |
| 1 | Forest | keine Landung |
| 2 | Mountain | nur Chocobo / Fluggerät |
| 3 | Sea | Tiefwasser: Gold-Chocobo, U-Boot |
| 4 | River Crossing | Buggy, Tiny Bronco, Wasser-Chocobos |
| 5 | River | Tiny Bronco und Chocobos |
| 6 | Water | Flachwasser, wie River |
| 7 | Swamp | Midgar-Zolom nur hier |
| 8 | Desert | keine Landung |
| 9 | Wasteland | keine Landung |
| 10 | Snow | Fußspuren, keine Landung |
| 11 | Riverside | Fluss/Land-Übergang |
| 12 | Cliff | scharfe Kante |
| 13 | Corel Bridge | — |
| 14 | Wutai Bridge | — |
| 15 | Underwater tunnel | verhindert Auftauchen des U-Boots |
| 16 | Hill side | begehbarer Bergfuß |
| 17 | Beach | — |
| 18 | Sub Pen | nur U-Boot-Ein-/Ausstieg |
| 19 | Canyon | ≈ Wasteland |
| 20 | Mountain Pass | Costa del Sol ↔ Corel |
| 21 | *unbekannt* | nahe Brücken und Nordkrater |
| 22 | Waterfall | Fluss, für Tiny Bronco gesperrt |
| 23 | *unbenutzt* | kommt in Originaldaten nicht vor |
| 24 | Gold Saucer Desert | — |
| 25 | Jungle | Begehbarkeit wie Forest |
| 26 | Sea (2) | eine Stelle nahe der HP-MP-Höhle |
| 27 | Northern Cave | Highwind kann landen |
| 28 | Gold Saucer Desert Border | skriptgesteuerter Treibsand |
| 29 | Bridgehead | beide Brückenenden |
| 30 | Back Entrance | per Skript unbegehbar schaltbar |
| 31 | *unbenutzt* | kommt in Originaldaten nicht vor |

**Wichtig für uns:** Die Begehbarkeit ist auch hier **nicht aus dem Original belegt**,
sondern eine Beobachtungs-/Community-Beschreibung. Unsere ADR-Position „Fahrzeugmatrix
als austauschbare Tabelle (🔵)" bleibt richtig. Aber: **„Wasserkandidat = Klasse 3" wird
hier bestätigt** — Typ 3 ist „Sea/Tiefwasser". Zusätzlich sind 5, 6, 22, 26 Wasser und
4 eine Furt. Das ist ein datenunabhängiger Gegencheck für unsere 🟡-Markierung.

### 2.8 Regionen (5 Bit `locationId`) ✅ / Namen 🚫

Quelle: `src/lib/map-data.ts:3-24` — 20 Einträge:
0 Midgar Area, 1 Grasslands, 2 Junon, 3 Corel, 4 Gold Saucer, 5 Gongaga, 6 Cosmo,
7 Nibel, 8 Rocket Launch Pad, 9 Wutai, 10 Woodlands, 11 Icicle, 12 Mideel,
13 North Corel, 14 Cactus Island, 15 Goblin Island, 16 Round Island, 17 Sea,
18 Bottom of the Sea, 19 Glacier.

---

## 3. Weiterverarbeitende Formate

### 3.1 `field.tbl` — World→Field-Einstiegspunkte ✅ **(Top-Fund)**

Quelle: `src/ff7/fieldtblfile.ts:3-19`, `38-60`

```
Datei:      64 Datensätze à 24 Byte  = 0x600 Byte
Datensatz:  Eintrag "default"     (12 Byte)
            Eintrag "alternative" (12 Byte)
Eintrag:    int16le  x
            int16le  y
            uint16le triangle       (Dreiecksindex im Ziel-Walkmesh)
            uint16le fieldId        (Feld-/Kartenindex)
            uint8    direction
            3 Byte   Padding
```

**Quirk:** In den Originaldateien ist das Richtungsbyte **viermal wiederholt** (die
letzten 3 Padding-Bytes tragen denselben Wert); der Editor schreibt es deshalb
ebenfalls 4×. (`src/ff7/fieldtblfile.ts:47-50`)

**IDs sind 1-basiert** in der Benutzeroberfläche (`getEntry(id)` greift auf `id − 1`
zu, gültig 1–64), während der Skript-Opcode `0x318 enter_field` die **Datensatznummer**
und einen Szenario-Selektor (0 = default, 1 = alternative) auf dem Stack erwartet.

→ **Dies löst den in ADR-S28-S29 Punkt 7 als 🔴 markierten Posten „Originalquelle der
Einstiegspunkte" auf.** Die Einstiegspunkte sind keine Wirtsdaten, sondern liegen als
`field.tbl` in `world_us.lgp`.

### 3.2 `enc_w.bin` — Zufallsbegegnungen ✅

Quelle: `src/ff7/encwfile.ts:42-99`, `148-197`

```
Gesamtgröße 0x8A0 = 2208 Byte  =  32 + 128 + 2048

0x000  8  × Yuffie-Eintrag      (4 B: uint16le cloudLevel, uint16le sceneId)      = 32 B
0x020  32 × Chocobo-Bewertung   (4 B: uint16le battleSceneId, uint16le rating)    = 128 B
0x0A0  16 Regionen × 4 Sets à 32 Byte                                             = 2048 B
```

**Encounter-Set (32 Byte):**

| Offset | Typ | Feld |
|---|---|---|
| +0 | u8 | `active` |
| +1 | u8 | `encounterRate` (0–255) |
| +2 | 6 × u16le | Normalbegegnungen |
| +14 | 2 × u16le | Rückenangriffe |
| +18 | 1 × u16le | Seitenangriff |
| +20 | 1 × u16le | Zangenangriff |
| +22 | 4 × u16le | Chocobo-Begegnungen |
| +30 | 2 B | Padding |

**Paar-Packung:** `packed = (rate << 10) | encounterId`; also `encounterId = packed & 0x3FF`
(0–1023), `rate = packed >> 10` (nur die unteren 6 Bit werden vom Spiel benutzt, 0–63).

**Chocobo-`rating`:** 1 = „wonderful" … 8 = „terrible".

**Auswahlsemantik** (Prosa im Repo 🚫, Fakt ✅): Die Region kommt aus `locationId` des
betretenen Dreiecks, das **Set** aus dem Geländetyp. Nur die **ersten 16 Regionen**
haben eigene Daten; Regionen ≥ 16 benutzen die Tabellen der Region 15. Normalraten
sollen sich zu **64** summieren; Rate 0 deaktiviert einen Eintrag. Doppelte Geländetypen
innerhalb einer Region sind wirkungslos — nur das erste passende Set greift.

### 3.3 Terrain→Encounter-Set-Zuordnung liegt in `ff7_en.exe` ✅

Quelle: `src/ff7/ff7exefile.ts:11-21`, `29-36`, `59`

**Offset `0x56C8A0`, 16 Regionen × 4 Byte = 64 Byte.** Jedes Byte ist eine
Geländetyp-ID (0–31). Die vier Bytes einer Region sagen: „Encounter-Set *i* dieser
Region gilt für Geländetyp `byte[i]`."

→ Für uns relevant: Diese Zuordnung ist **nicht** in `world_us.lgp`. Ein reiner
Datenpfad-Ansatz ohne EXE-Auswertung kann Begegnungen nicht vollständig reproduzieren.
Das koppelt an unsere S37-EXE-Analyse.

### 3.4 `.mes` — Weltkarten-Nachrichten ✅

Quelle: `src/ff7/mesfile.ts:15-27`, `73-101`

```
uint16le numMessages
numMessages × uint16le offset      (absoluter Offset in dieselbe Datei)
… Textblöcke, je terminiert durch 0xFF
```
Der erste Textoffset ist folglich `2 + numMessages*2`. Der Editor begrenzt die
Gesamtdatei auf **0x1000 = 4096 Byte**; ob das eine Engine-Grenze oder eine
Editor-Annahme ist, sagt der Code nicht.
Textkodierung über eine FF7-eigene Zeichentabelle (`src/ff7/fftext.ts`, 427 Zeilen 🚫 —
die Tabelle selbst ist Faktenmaterial, die Aufbereitung nicht).

### 3.5 `.tex` ✅

Quelle: `src/ff7/texfile.ts:147`, `172-203`

- Kopf **0xEC = 236 Byte**; danach Palette (`paletteSize * 4` Byte, falls `paletteFlag ≠ 0`),
  dann Pixel (`width*height*bytesPerPixel`), dann Color-Key-Array (`numPalettes` Byte, falls markiert).
- Palettenmodus: Einträge liegen als **BGRA** vor und müssen zu RGBA umgeordnet werden.
- Direktmodus: Kanäle über Maske/Shift, danach Linksschieben um `8 − bits`; Alpha wird
  auf 255 gezwungen, wenn `alphaBits === 0`.
- **Fehler im Zielrepo** (nicht nachbauen): Im Direktmodus wird eine `DataView` auf
  `pixels.buffer` gelegt, obwohl `pixels` ein `slice()` ist — der `byteOffset` des Slices
  wird ignoriert, nicht-palettierte Texturen lesen an falscher Stelle (`src/ff7/texfile.ts:188`).

### 3.6 `.lgp` und LZSS — **🚫 GPL-kontaminiert, nur zur Kenntnis**

`src/ff7/lgp.ts`: Kopf 12 Byte Ersteller (`SQUARESOFT`), `uint32le numFiles`, TOC à
27 Byte (20 B Name, `uint32le` Offset, `uint8` check, `uint16le` conflictIndex), danach
**900 Lookup-Einträge** (30 × 30, à 4 Byte), Konfliktblock, Datenblöcke mit je 24 B
Vorspann (20 B Name + `uint32le` Größe), Abschluss `FINAL FANTASY7`.
Lookup-Index = `l1 * 30 + l2 + 1` über die ersten zwei Dateinamenzeichen
(`.` = −1, `_` = 10, `-` = 11, Ziffern 0–9, Buchstaben case-insensitiv 0–25).

`src/ff7/lzss.ts`: Fenster 0x1000, Referenzlänge 3–18, 2-Byte-Referenz
`offset = ((ref[1] & 0xF0) << 4) | ref[0]`, `length = (ref[1] & 0x0F) + 3`;
Steuerbyte mit 8 Flags, Bit gesetzt = Literal.

---

## 4. Weltkarten-Skriptsystem ✅ — der wertvollste Teil

### 4.1 `wm*.ev`-Container

Quelle: `src/ff7/evfile.ts:5-28`, `380-456`

| Bereich | Offset | Größe | Inhalt |
|---|---|---|---|
| Funktionstabelle | `0x000` | **`0x400` fix** | 256 Slots à 4 Byte (1 Dummy + 255 echte) |
| Codesegment | `0x400` | Rest | u16le-Wörter |
| Gesamtpuffer (Editor) | — | `0x7000` | Rest genullt |

**Bestätigt unsere ADR-Korrektur:** Die Tabelle ist **fix 0x400 Byte**, nicht dynamisch
sentinelbegrenzt (ADR-S28-S29, „Zwei realdaten-korrigierte Community-Beschreibungen").
Freie Slots tragen Header `0xFFFF`, Offset `0x0000`.

**Tabelleneintrag (4 Byte):** `uint16le header`, `uint16le offset`.
Der Offset ist eine **Wortnummer** relativ zu `0x400`:
`Byteadresse = 0x400 + offset * 2`.
Das erste Codewort bei `0x400` ist ein `RETURN` (`0x203`); echter Code beginnt bei
Wortindex 1. Die Tabelle wird sortiert nach Headerwert geschrieben.

**Header-Bitlayout** (Typ = `header >> 14`; 0 = System, 1 = Model, 2 = Mesh):

| Typ | Bits 15–14 | Bits 13–8 | Bits 7–0 | Dekodierung |
|---|---|---|---|---|
| System | `00` | — | Funktions-ID | `id = header & 0xFF` |
| Model | `01` | Model-ID (`& 0x3F`) | Funktions-ID | `modelId = (header >> 8) & 0x3F` |
| Mesh | `10` | Mesh-Koordinate: `(header >> 4) & 0x3FF` | Funktions-ID (`& 0xF`) | s. u. |

**Mesh-Koordinate:** Das Zielrepo rechnet `x = coords div 36`, `y = coords mod 36`
(`src/ff7/evfile.ts:107-113`), benennt aber in der Oberfläche `x` als **Zeile** und `y`
als **Spalte** (`src/components/map/components/SelectedTriangle.tsx:58-77`).
→ **Das ist inhaltlich identisch mit unserer Messung `zeile·36 + spalte` (49/49)**, nur
mit irreführender Benennung. Unsere ADR-Korrektur bleibt gültig und ist hier unabhängig
bestätigt.

**Aliasing:** Mehrere Tabelleneinträge dürfen denselben `offset` teilen; nur der erste
trägt den Code. (`src/ff7/evfile.ts:69-83`)

**Beobachtete Zählungen in ausgeliefertem `wm0.ev`** (`src/ff7/evfile.test.ts:23,32,42`):
**32 System-, 61 Model-, 49 Mesh-Funktionen** (Summe 142).
→ Gegenprobe zu unserer Messung „143/143 wm0-Funktionen" bzw. „175/175
Funktions-Abschluss": Wir zählen **eine Funktion mehr**. Wahrscheinlichste Erklärung:
Wir zählen den Dummy-Slot bei Wortindex 0 mit, das Zielrepo nicht. Siehe offene Fragen.

**Funktionskörper-Ende:** Erstes `0x203`-Wort. (Das Zielrepo schneidet dort ab — bei
frühem `RETURN` mit Folgecode wäre das ein Datenverlust; wir sollten stattdessen die
Grenze über den nächsten Tabelleneintrag bestimmen.)

### 4.2 Einstiegspunkt-Konventionen (Beobachtung, teils unbelegt 🟡)

Quelle: `src/ff7/worldscript/constants.ts:155-172`

- **Model-Funktionen:** 0 = init, 1 = unload, 2 = update, 3 = touch, 4 = interact, 5 = disembark.
- **System-Funktionen:** 0 = init, 2 = update, 6 = Highwind-Menü, 7 = Zolom berührt,
  9 = Kraterlandung. ID 1 („exit/unload") ist im Zielrepo auskommentiert, weil sie
  **im Test nicht bestätigt** werden konnte.
- **Mesh-Funktionen:** Auslöser ist das `script`-Feld des Dreiecks. Werte 3..7 tragen
  Skripte; **Mesh-Funktions-ID = `triangle.script − 3`**; Wert 0 = kein Skript
  (`src/components/map/components/SelectedTriangle.tsx:60`, `:131`, `:140`).
  Zur Laufzeit ist die ID über `Special.current_triangle_script_id` lesbar.

→ **Das beantwortet unseren 🔴-Posten „Anlass der Mesh-Funktionsausführung"** (ADR-S28-S29):
Der Anlass ist das Betreten eines Dreiecks, dessen 3-Bit-`script`-Feld ≥ 3 ist; die
Funktions-ID ergibt sich durch Subtraktion von 3. Weil `script` 3 Bit hat (0–7), gibt
es je Mesh höchstens 5 auslösbare Funktionen (3,4,5,6,7 → 0..4), obwohl das
Header-Feld 4 Bit für Mesh-Funktions-IDs vorsieht. Werte 1 und 2 sind vergeben, aber
laut Zielrepo keine Skriptauslöser (im Rendermodus „scripts" bekommen sie eigene Farben).

### 4.3 VM-Modell ✅

Quelle: `src/ff7/worldscript/opcodes.ts:6-21`, `src/ff7/worldscript/worldscript.ts:117-131`, `421-423`

- **Reine Stackmaschine**, keine Register. Jeder Opcode zieht `stackParams` Werte und
  legt ggf. genau ein Ergebnis ab. 16-Bit-Werte.
- **Wortorientiert:** Opcode = 1 u16le-Wort; jeder Codeparameter = 1 weiteres Wort.
  Programmzähler und Sprungmarken zählen **Wörter**, nicht Bytes.
- **Immediates sind signed 16 Bit** (≥ 0x8000 wird negativ).
- **Sprünge tragen absolute Wortadressen** im selben Raum wie das `offset`-Feld der
  Tabelle. Es gibt **nur** „springe wenn null" (`0x201`) plus unbedingtes `goto` (`0x200`).
- **Kein Aufrufstack für Argumente, kein Rückgabewert.** Kommunikation ausschließlich
  über die Speicherbänke.
- **`RESET` (0x100) leert den gesamten Stack** — nötig, weil die Engine Reste liegen
  lässt (u. a. wegen `0x31B`).

**Speicherbänke** (`src/ff7/worldscript/worldscript.ts:32-34`):

| Bank | Basis (im Editor) | Bit | Byte | Wort | Persistenz |
|---|---|---|---|---|---|
| Savemap (Bank 0) | `0xBA4` | `0x114` | `0x118` | `0x11C` | im Spielstand |
| Temp (Bank 1) | `0x0` | *(fehlt)* | `0x119` | `0x11D` | flüchtig |
| Special (VM-Register) | `0x0` | `0x117` | `0x11B` | `0x11F` | Pseudovariablen |

**Bitadressierung:** Die Bank ist ein flaches Bitfeld — `byteOffset = addr div 8`,
`bit = addr mod 8`. Beispiel aus den Tests: Bitadresse `0x1C2E` → Savemap-Byte `0xF29`,
Bit 6. Wortzugriffe verlangen gerade Adressen.
**Schreiben:** genau **ein** Store-Opcode `0xE0 WRITE`, der Adressausdruck und Wert vom
Stack zieht; die Breite (Bit/Byte/Wort) folgt aus der Form des vorangegangenen
Lese-Push. Es gibt **keine berechnete Adressierung** — alle Adressen sind Immediates.

**Special-Variablen** (17 belegt; der Opcode-Kommentar behauptet 21 — 17..20 unbelegt 🟡):

| Idx | Name | Breite | | Idx | Name | Breite |
|---|---|---|---|---|---|---|
| 0 | entity_mesh_x_coord | Byte | | 9 | current_chocobo_rating | Byte |
| 1 | entity_mesh_y_coord | Byte | | 10 | check_if_riding_chocobo | Byte |
| 2 | entity_coord_in_mesh_x | Wort | | 11 | battle_result | Bit |
| 3 | entity_coord_in_mesh_y | Wort | | 12 | prompt_window_result | Byte |
| 4 | entity_direction | Byte | | 13 | current_triangle_script_id | Byte |
| 5 | *unbekannt* | Byte | | 14 | party_leader_model_id | Byte |
| 6 | last_field_id | Byte | | 15 | active_entity_model_id | Byte |
| 7 | map_options | Byte | | 16 | random_8bit_number | Byte |
| 8 | player_entity_model_id | Byte | | | | |

**Benannte Savemap-Adressen** (Bezeichner 🚫, Adressen ✅,
`src/ff7/worldscript/constants.ts:3-16`): `0xBA4` game_progress (Wort),
`0xBF9`–`0xBFC` chocobo_rating_1..4, `0xC1F` weapons_killed, `0xC21` own_chocobo_stable,
`0xC22` chocobos_on_map, `0xC23` vehicle_display, `0xD73` yuffie_flags,
`0xEF4` submarine_color_flags, `0xF2A` submarine_flags.

### 4.4 Aufrufkonvention ✅

`0x204`..`0x22F`: Die **Funktions-ID steckt im Opcode**: `id = opcode − 0x204`, also
aufrufbar 0–43. Der **Kontext (Model-/Entity-ID) kommt vom Stack**. Model-ID ≥ 64
bedeutet „System-Funktion im Kontext der aktuellen Entität", üblich als `0xFFFF`
übergeben. Aufrufe sind **asynchron**; `0x334 WAIT_FUNC` blockiert bis zur Beendigung.
`0x203 RETURN` beendet den Kontext.

### 4.5 Opcode-Tabelle: Arithmetik / Logik / Vergleich (alle schieben ein Ergebnis)

| Hex | Bedeutung | Stack | Operator |
|---|---|---|---|
| `0x15` | Negation | 1 | `-` (Tabelle nennt `~`) |
| `0x17` | logisches Nicht | 1 | `!` |
| `0x30` | Multiplikation | 2 | `*` |
| `0x40` | Addition | 2 | `+` |
| `0x41` | Subtraktion | 2 | `-` |
| `0x50` | Linksschieben | 2 | `<<` |
| `0x51` | Rechtsschieben | 2 | `>>` |
| `0x60` | kleiner | 2 | `<` |
| `0x61` | größer | 2 | `>` |
| `0x62` | kleiner-gleich | 2 | `<=` |
| `0x63` | größer-gleich | 2 | `>=` |
| `0x70` | gleich | 2 | `==` |
| `0x80` | bitweises Und | 2 | `&` |
| `0xA0` | bitweises Oder | 2 | `\|` |
| `0xB0` | logisches Und | 2 | `and` |
| `0xC0` | logisches Oder | 2 | `or` |

**Es gibt keine Division, kein Modulo, kein XOR und kein `!=`.** (Vom Parser des
Zielrepos zwar erkannt, aber ohne Opcode — Übersetzung schlägt fehl.)

### 4.6 Opcode-Tabelle: Speicher und Stack

| Hex | Bedeutung | Stack | Code-Wörter | Ergebnis |
|---|---|---|---|---|
| `0x00` | No-Op | 0 | 0 | — |
| `0xE0` | Schreiben in Bank | 2 (Adressausdruck, Wert) | 0 | nein |
| `0x100` | Stack zurücksetzen | 0 | 0 | — |
| `0x110` | Konstante schieben | 0 | 1 (Immediate) | ja |
| `0x114` | Savemap-Bit lesen | 0 | 1 (Bitadresse) | ja |
| `0x117` | Special-Bit lesen | 0 | 1 (Index) | ja |
| `0x118` | Savemap-Byte lesen | 0 | 1 | ja |
| `0x119` | Temp-Byte lesen | 0 | 1 | ja |
| `0x11B` | Special-Byte lesen | 0 | 1 | ja |
| `0x11C` | Savemap-Wort lesen | 0 | 1 | ja |
| `0x11D` | Temp-Wort lesen | 0 | 1 | ja |
| `0x11F` | Special-Wort lesen | 0 | 1 | ja |

**Lücken in diesem Block ohne Zuordnung:** `0x111`–`0x113`, `0x115`, `0x116`, `0x11A`,
`0x11E`. Die Symmetrie (Bank × Breite) legt `0x115` = Temp-Bit nahe — im Zielrepo
**nicht** belegt (der Compiler erzeugt dort ein Mnemonic ohne Opcode und scheitert).

### 4.7 Opcode-Tabelle: Kontrollfluss

| Hex | Bedeutung | Stack | Code-Wörter |
|---|---|---|---|
| `0x200` | goto (absolute Wortadresse) | 0 | 1 |
| `0x201` | goto, wenn Bedingung == 0 | 1 | 1 |
| `0x203` | return | 0 | 0 |
| `0x204`–`0x22F` | Funktionsaufruf `n = opcode − 0x204` | 1 (Entität) | 0 |

`0x202` ist unbelegt (plausibel „goto if true", aber ohne Beleg).

### 4.8 Opcode-Tabelle: Entitäten

| Hex | Bedeutung | Stack | Anmerkung |
|---|---|---|---|
| `0x18` | Distanz zu Punkt | 1 (Punkt-ID) → Ergebnis | Maßstab unklar 🟡 |
| `0x19` | Distanz zu Entität | 1 (Model-ID) → Ergebnis | Maßstab unklar 🟡 |
| `0x1B` | Richtung zu Punkt | 1 → Ergebnis | |
| `0x300` | Modell laden | 1 | führt dessen init aus, wird aktive Entität |
| `0x302` | zur Spielerentität machen | 0 | Kamera/Steuerung folgen |
| `0x303` | Bewegungsgeschwindigkeit (ohne Walkmesh) | 1 (0–255) | Nicht-Spieler laufen weiter bis 0 |
| `0x304` | Richtung + Blickrichtung setzen | 1 (0–255) | |
| `0x308` | Mesh-Koordinaten setzen | 2 (X 0–35, Z 0–27) | **Welt = (mesh << 13) + lokal** |
| `0x309` | Koordinaten im Mesh setzen | 2 (X/Z 0–8191) | |
| `0x30A` | Vertikalgeschwindigkeit | 1 | negativ = steigen |
| `0x30B` | Y-Versatz des Modells | 1 | |
| `0x30C` | Fahrzeug betreten | 0 | Verhalten unbekannt 🟡 |
| `0x30D` | anhalten | 0 | für Kollisionsprüfung |
| `0x30E` | Animation abspielen | 2 (Anim-ID, Schleife) | |
| `0x321` | zu Punkt drehen | 1 (Punkt 0–15) | |
| `0x328` | nur Bewegungsrichtung | 1 (0–255) | Blickrichtung unverändert |
| `0x333` | zu Modell drehen | 2 (Model-ID, Winkelversatz 0–255) | 128 = Rücken zugewandt |
| `0x336` | Gehgeschwindigkeit (mit Walkmesh) | 1 (0–255) | |
| `0x339` | Modell verbergen | 0 | Kamera folgt weiter |
| `0x33A` | Vertikalgeschw. mit Kameranachführung | 1 | Vorzeichen **gegenläufig** zu `0x30A` 🟡 |
| `0x347` | zu Entität versetzen | 1 (Model-ID) | Teleport |
| `0x34F` | Y-Position setzen | 1 | |
| `0x353` | Position beim Aussteigen korrigieren | 2 | beide Parameter unbelegt 🟡 |

**Wichtiger Maßstabsfakt:** `0x308` dokumentiert `Welt = (mesh << 13) + lokal`.
`1 << 13 = 8192` — das ist exakt `MESH_SIZE`. Die 8192er-Kachelung ist damit **doppelt
belegt** (Geometrie und Skript-VM).

### 4.9 Opcode-Tabelle: System

| Hex | Bedeutung | Stack | Anmerkung |
|---|---|---|---|
| `0x305` | Wartebild vorbereiten | 1 (Frames) → Ergebnis | Paar mit `0x306` |
| `0x306` | warten | 1 (Frames) | „tut evtl. mehr" 🟡 |
| `0x307` | Steuerungssperre | 1 (bool) | |
| `0x317` | Kampf auslösen | 1 (Szene) | Format unbestätigt 🟡 |
| `0x318` | **Feld betreten** | 2 (`field.tbl`-Datensatz, Szenario 0/1) | siehe §3.1 |
| `0x319` | Kartenoptionen | 1 (Bitmaske) | 0 Minikarte an, 1 Kamera tief, 2 Kurs anzeigen, 4 große Karte, 8 Minikarte aus; Wert 3 erzeugt kaputte Nahkamera |
| `0x31B` | No-Op, **zieht 1 Stackwert** | 1 | Grund für `RESET` |
| `0x320` | Zolom zurücksetzen | 0 | Verhalten unbekannt 🟡 |
| `0x32B` | Zufallsbegegnungen an/aus | 1 (bool) | |
| `0x332` | Chocobo flieht | 0 | |
| `0x334` | auf Funktion warten | 0 | |
| `0x33B` | ausblenden | **2** (Tempo 0–255 + 1 unbenutzt) | nicht blockierend; Tempo muss > 1 sein |
| `0x33C` | auftauchen (U-Boot) | 0 | wechselt zur Overworld |
| `0x33D` | Feld-Einstiegspunkt per ID | 1 | benutzt `field.tbl` 🟡 |
| `0x348` | einblenden | **2** (Tempo + 1 unbenutzt) | Tempo muss > 1 sein |
| `0x349` | **Weltfortschritt setzen** | 1 | 0 vor Tempel, 1 nach Tempel, 2 nach Erscheinen der Ultimate Weapon, 3 nach Mideel, 4 nach Tod der Ultimate Weapon — **wählt Ersatzblöcke aus der MAP-Datei** |
| `0x34A` | Ebenen-Animation abspielen | 1 (fest kodierte Anim-ID) | 1 Wasserringe, 2 Rauch, 6 Aufschlagkreis, 20–23 Funken |
| `0x34D` | Ebene einblenden | 3 (Ebenen-ID, Anim-ID, Wiederholintervall in Frames) | |
| `0x34E` | Ebene ausblenden | 1 | |
| `0x350` | Meteor-Overlay | 1 (bool) | |
| `0x354` | Fahrzeug benutzbar | 1 (bool) | sperrt Skripte/Interaktion einer Entität |
| `0x355` | Kampf-Timer | 1 | „setzt wohl den Emerald-Timer, tut aber mehr" 🟡 |

**`0x349` ist der Schlüssel zur Alternativblock-Frage:** Fünf Fortschrittsstufen
schalten die Ersatzsektionen. Vier Alternativgruppen + Grundzustand = 5. 🟡 Die exakte
Stufe→Gruppe-Abbildung steht im Zielrepo **nicht**.

### 4.10 Opcode-Tabelle: Punkte, Fenster, Kamera, Ton, Spieler

**Punkte (16 Slots — Koordinaten *oder* Lichtquellen):**

| Hex | Bedeutung | Stack |
|---|---|---|
| `0x310` | aktiven Punkt wählen | 2 (Punkt 0–15, Typ 0 = Koordinate / 1 = Lichtquelle) |
| `0x311` | Mesh-Koordinaten des Punktes | 2 (X 0–35, Z 0–27) |
| `0x312` | Koordinaten im Mesh | 2 (X/Z 0–8191) |
| `0x313` | Geländefarbe | 3 (R, G, B 0–255) |
| `0x314` | Radius (Lichtabfall) | 2 (außen, innen) |
| `0x315` | Himmelfarbe oben | 3 (R, G, B) |
| `0x316` | Himmelfarbe unten | 3 (R, G, B) |

**Fenster (genau eines auf der Weltkarte, daher keine Fenster-ID):**

| Hex | Bedeutung | Stack |
|---|---|---|
| `0x324` | Maße setzen | 4 (X, Y, Breite, Höhe) |
| `0x325` | Nachricht setzen | 1 (Nachrichten-ID aus `.mes`) |
| `0x326` | Auswahl setzen | 3 (Nachrichten-ID, erste Option, letzte Option) |
| `0x327` | auf Bestätigung der Auswahl warten | 0 |
| `0x32C` | Parameter | 2 (Stil 0 normal / 1 rahmenlos / 2 halbtransparent; Schließen verhindern) |
| `0x32D` | warten bis wiederverwendbar | 0 |
| `0x32E` | warten bis quittiert | 0 |

Das Ergebnis der Auswahl wird über `Special.prompt_window_result` (Index 12) gelesen.

**Kamera:** `0x31C` Zoom/Neigung freischalten (bool); `0x31F` Drehgeschwindigkeit
(0–255); `0x329` Neigungsgeschwindigkeit; `0x32A` Zoomgeschwindigkeit (beide verlangen
`0x31C`); `0x352` Erdbeben/Wackeln (bool).

**Ton:** `0x31D` SFX abspielen (Format unbestätigt 🟡); `0x33E` Musik (AKAO-Kommando 🟡);
`0x351` BGM-Lautstärke (0–127).

**Spieler:** `0x32F` Richtung setzen (Verhalten unbekannt 🟡); `0x330` aktive Entität
setzen (Model-ID); `0x331` Fahrzeug verlassen; `0x34B` Chocobo-Typ (0 gelb, 1 grün,
2 blau, 3 schwarz, 4 gold — **ändert Farbe *und* Walkmesh-Parameter**);
`0x34C` U-Boot-Farbe (0 rot, 1 blau; negative Werte −1..−5 aliasen wegen der
Palettenindizierung auf Chocobo-Farben).

### 4.11 Belegte Opcodes gesamt / Lücken

**103 Tabelleneinträge** plus 43 weitere Aufruf-Aliase von `0x204`.
Unbelegt und im Zielrepo beim Dekodieren **stillschweigend verworfen**:
`0x01`–`0x14`, `0x16`, `0x1A`, `0x1C`–`0x2F`, `0x31`–`0x3F`, `0x42`–`0x4F`, `0x52`–`0x5F`,
`0x64`–`0x6F`, `0x71`–`0x7F`, `0x81`–`0x9F`, `0xA1`–`0xAF`, `0xB1`–`0xBF`, `0xC1`–`0xDF`,
`0xE1`–`0xFF`, `0x101`–`0x10F`, `0x111`–`0x113`, `0x115`, `0x116`, `0x11A`, `0x11E`,
`0x120`–`0x1FF`, `0x202`, `0x230`–`0x2FF`, `0x301`, `0x30F`, `0x31A`, `0x31E`, `0x322`,
`0x323`, `0x335`, `0x337`, `0x338`, `0x33F`–`0x346`, alles > `0x355`.

→ **Direkter Gewinn für uns:** Unsere ADR-Politik „Kommando-Opcodes (0x300er, 23,6 %)
faulten und werden übersprungen" kann jetzt in eine **belegte Semantik** überführt
werden. Der 0x300er-Raum ist praktisch vollständig beschrieben (`0x300`–`0x355`).

### 4.12 Namensraum-Ebene (reine Darstellung, kein Formatfakt) 🚫

Namensräume `System, Math, Entity, Point, Camera, Sound, Memory, Window, Player,
Savemap, Special, Temp` sind nur Präsentationsschicht: Jeder Opcode trägt Namensraum +
Name, der Dekompilierer schreibt `Namensraum.name(args)`. `Math.` erscheint nie —
Rechenopcodes werden als Infix-Operatoren gerendert. Die Quellsprache ist Lua-artig
(`if … then … end`, `goto`, `::label::`, `--`-Kommentare). Zusätzlich gibt es
Pseudo-Namensräume `Entities.<slug>` (31 Model-IDs 0–30 plus `system` = 65535) und
`Fields.<slug>` (65 Feld-IDs 0–64, im Repo mit TODO „kann Fehler enthalten" markiert 🟡).

**Für WebMidgar irrelevant/riskant:** Diese ganze Ebene ist Ausdruck, nicht Format. Wenn
wir einen Dekompilierer bauen, sollten wir eine **eigene** Oberflächensyntax wählen.

### 4.13 Syntaktischer Zucker mit Formatbezug ✅

- `System.wait(n)` entspricht dem **Opcode-Paar** `0x305` gefolgt von `0x306`.
- `fade_in`/`fade_out` nehmen **zwei** Stackwerte; der zweite ist unbenutzt und wird als 0 geschoben.
- Der Compiler des Zielrepos schiebt **vor jedem `if`, jeder Zuweisung und jedem Aufruf
  mit Stackparametern defensiv ein `RESET` (0x100)** ein. Das erklärt, warum `0x100` in
  Realdaten so häufig ist.

### 4.14 Konkrete Byte→Quelle-Beispiele (Prüfvektoren für unsere VM) ✅

| Wortfolge | Bedeutung |
|---|---|
| `0x110 0x0001` | Konstante 1 schieben |
| `0x11C 0x0000` | Savemap-Wort an Basis `0xBA4` (game_progress) |
| `0x118 0x007E` | Savemap-Byte `0xBA4 + 0x7E = 0xC22` |
| `0x114 0x1C2E` | Savemap-Bit → Byte `0xF29`, Bit 6 |
| `0x110 0x0003`, `0x218` | Funktion 20 auf Entität 3 aufrufen (`0x218 − 0x204 = 20`) |
| `0x110 0x0034`, `0x110 0x0000`, `0x318` | Feld-Datensatz 0x34, Szenario 0 betreten |
| `0x110 0x001E`, `0x305`, `0x306` | 30 Frames warten |
| `0x100`, `0x110 0x0001`, `0x203` | Reset, Push 1, Return |
| `0x110 0xFFFE` | Konstante −2 (Zweierkomplement) |

Quelle: `src/ff7/worldscript/worldscript.test.ts` und `src/ff7/evfile.test.ts`.

---

## 5. Texturen und Rendering

### 5.1 Texturtabellen ✅ (Zahlen), 🚫 (Tabellenlayout)

Quelle: `src/lib/map-data.ts:61-363`. Jeder Eintrag: `id, name, width, height, uOffset, vOffset`.

| Karte | Anzahl | IDs | Maße |
|---|---|---|---|
| Overworld | **282** | 0–281 | Zweierpotenzen 16/32/64/128 |
| Underwater | **8** | 0–7 | 128×128 bis 256×256 |
| Great Glacier | **4** | 0–3 | 64×64 |

`uOffset`/`vOffset` sind der Ursprung der Textur innerhalb der ursprünglichen
VRAM-Seite (Vielfache von 16; u bis 224, v bis 480). Underwater-Namen: `cltr`, `lake_a`,
`rock`, `scave`, `ssand`, `swall02`, `sng01`, `sng02`. Glacier: `hokola01`, `hokola02`,
`snwfldl`, `snwfld2`.

**Wichtig:** Das 9-Bit-Texturfeld erlaubt 0–511, real belegt sind nur 282. Texturen
werden als `<name>.tex` aus `world_us.lgp` geladen.

### 5.2 UV-Berechnung ✅ — der subtilste Fakt

Die u/v-Bytes im Dreieck sind **VRAM-seiten-absolut**, nicht texturlokal. Die Umrechnung
in texturlokale Pixel (`src/lib/utils.ts:9-15`, Algorithmus 🚫 nicht kopieren, aber
Verhalten beschreibbar):

1. Falls `wert + offset === dimension` → Ergebnis `wert − 1` (Sonderfall Randkachel).
2. Falls `offset > wert` → `offset = offset mod dimension`.
3. Ergebnis = `abs((wert − offset) mod dimension)`.

Danach im Atlas: `u_atlas = (atlasPos.x + lokalU) / 2048`, `v_atlas = (atlasPos.y + lokalV) / 2048`.

**Quirk:** Enthält der Texturname `cltr` **und** ist `uVertex0 === 254`, gilt das
Dreieck als „Unterwasser-Außenbereich" und bekommt **gar keine UVs** (und wird beim
OBJ-Export übersprungen). (`src/components/map/components/WorldMesh/hooks.ts:132-133`)

### 5.3 Texturatlas ✅

`2048 × 2048`, einfacher Regal-Packer (Shelf), 4 px Polsterung rings um jede Textur,
Randpixel werden in die Polsterung repliziert (Edge-Bleed) gegen Bilinear-Nähte.
`flipY = false`, `LinearFilter` / `LinearMipmapLinearFilter`, Mipmaps an, Anisotropie 16.
Ein Atlas je Karte, wird bei Kartenwechsel neu gebaut.
**Konsequenz:** Hardware-Wiederholung (`RepeatWrapping`) ist bei Atlasnutzung
unbrauchbar — die Wiederholung muss in die UV-Berechnung (Modulo) hinein.

### 5.4 Renderansatz

| Aspekt | Umsetzung |
|---|---|
| Geometrie | **nicht-indizierte** `BufferGeometry`, ein Dreieck = 3 eigene Vertices |
| Attribute | `position` (3), `color` (3), `uv` (2), danach `computeVertexNormals()` |
| Dateinormalen | **nur für die Debug-Darstellung**, nicht fürs Shading |
| Picking | `faceIndex` == Index in die Dreiecksliste → O(1)-Zugriff |
| Vertex-Verschweißung | Weltkoordinaten auf 3 Nachkommastellen gerundet als Schlüssel; alle Vorkommen werden gemeinsam bewegt |
| Modi | `textured` (unbeleuchtet, `MeshBasicMaterial`, `alphaTest 0.5`, `DoubleSide`), `terrain` / `region` / `scripts` (`MeshPhongMaterial` + `vertexColors`) |
| Rückseiten | überall `DoubleSide` — **kein Backface-Culling** |
| LOD | **keines** — die gesamte Karte ist ein Draw-Call |
| Licht | Ambient 0.3 + eine gerichtete Lichtquelle, Intensität 1.0 |

**Kamera** (`src/components/map/constants.ts:6-10`, `MapViewer.tsx:128-141`):
Höhen je Karte Overworld **10 200**, Underwater **5 800**, Glacier **2 900**
(Render-Einheiten). Perspektive `fov 60`, `near 0.1`, `far 1 000 000`, Blick von oben
auf die Kartenmitte. Alternative Orthografie mit `near −1000`, `far 100 000`.
`OrbitControls` mit `maxPolarAngle = π/2` (nie unter den Horizont).

Kartenausdehnung in Render-Einheiten: Overworld 14 745,6 × 11 468,8;
Underwater 4 915,2 × 6 553,6; Glacier 3 276,8 × 3 276,8.

### 5.5 Weltmodelle und Animation — **große Lücke** ⚠️

Das Zielrepo **rendert keine 3D-Weltmodelle**. Modelle erscheinen ausschließlich als
2D-Sprite-Nadeln (`src/components/map/ModelOverlay.tsx`), es gibt **keinerlei** Parser
für `.hrc`, `.a`, `.rsd`, `.p` oder Skelettanimationen. Was existiert:

- Model-IDs mit Nadelsymbol (`src/components/map/modelTextures.ts:23-99`): 0 Cloud,
  1 Tifa, 2 Cid, 3 Highwind, 4 Wildchocobo, 5 Tiny Bronco, 6 Buggy, 10 Diamond Weapon,
  11 Ultimate Weapon, 13 Submarine, 19 Chocobo, 28 Red Submarine, 29 Ruby Weapon,
  30 Emerald Weapon, 40 Zolom.
- Feste Weltversätze (`ModelOverlay.tsx:35-70`): Zolom bei `x = coords[1] + 0x34000`,
  `z = coords[0] + 0x20000` (**Achsen vertauscht!**); Unterwassermodelle bei
  `x − 0x18000`, `z − 0x10000`.
- Animationen sind nur über Opcodes ansprechbar (`0x30E`, `0x34A`, `0x34D`, `0x34E`) —
  die ID-Listen sind unvollständig und verweisen auf das FF7-Wiki.

→ **Für `render-world` liefert dieses Repo zum Thema Modelle/Animation nichts.** Der
`0x34A`-Katalog (1 Wasserringe, 2 Rauch, 6 Aufschlagkreis, 20–23 Funken) ist der einzige
verwertbare Krümel.

### 5.6 OBJ-Export/Import ✅ (Konventionen, nützlich für Werkzeuge)

- Export teilt Spieleinheiten durch **1024** (nicht durch `SCALE`); Normalen ebenfalls durch 1024.
- Import multipliziert Positionen mit **1024**, Normalen aber mit **4096** — **asymmetrisch**,
  ein Roundtrip skaliert Normalen um Faktor 4. (Fehler im Zielrepo, nicht nachbauen.)
- `vt` wird pro Dreiecksecke geschrieben, mit **umgekehrtem V** (`1 − v`).
- Nicht-geometrische Dreiecksattribute (`type`, `locationId`, `script`, `isChocobo`)
  stehen **nicht** im OBJ; sie werden über einen Schlüssel aus den drei sortierten
  Vertexpositionen aus dem vorhandenen Mesh zurückgeholt.
- **Vertexgrenze 122 je Mesh:** Mehr erzeugt laut Zielrepo „visuelle Fehler im Spiel".
  Das ist eine **Engine-Puffergrenze**, keine Formatgrenze — das Format erlaubt über
  u8-Indizes bis 256. **Für unseren Streamer/Loader ist 122 die praktisch relevante
  Obergrenze.**

---

## 6. Top-Funde für WebMidgar (gerankt, Paketen zugeordnet)

| # | Fund | Paket | Wert |
|---|---|---|---|
| **1** | **`field.tbl`: 64 Datensätze à 24 B, je 2 Einträge (default/alternative) mit `x, y, triangle, fieldId, direction`** — löst den 🔴-Posten „Originalquelle der World↔Field-Einstiegspunkte" | `formats-world`, `world-runtime` | sehr hoch — schließt eine offene ADR-Frage vollständig |
| **2** | **Vollständige Semantik des 0x300er-Opcodeblocks** (`0x300`–`0x355`, ~60 Kommandos mit Stelligkeit und Wertebereichen) | `interpreter`, `world-runtime` | sehr hoch — ersetzt unsere Fault-Politik für 23,6 % der Instruktionen durch belegte Semantik |
| **3** | **Mesh-Skript-Auslöser: `script`-Feld (3 Bit) ≥ 3 → Mesh-Funktions-ID = `script − 3`**, 0 = kein Skript | `world-runtime`, `walkmesh` | sehr hoch — löst den 🔴-Posten „Anlass der Mesh-Funktionsausführung" |
| **4** | **Dreiecks-Bitlayout bestätigt:** Byte+3 = `(script << 5) \| type`; `ids` = Textur (0–8), Region (9–13), Chocobo (Bit 15), Bit 14 frei | `formats-world` | hoch — direkter Gegencheck unserer Parser |
| **5** | **Alternativsektionen: 63→50, 64→41, 65→42, 66→60, 67→47, 68→48**, vier Gruppen, geschaltet über `0x349` (5 Fortschrittsstufen) | `formats-world`, `world-runtime` | hoch — löst den 🔴-Posten „Alternativblock-Schaltung WM0 63–68" bis auf die Stufe→Gruppe-Abbildung |
| **6** | **`enc_w.bin`-Layout (0x8A0 B) + Packung `(rate << 10) \| id`** und die Erkenntnis, dass die **Terrain→Set-Zuordnung in `ff7_en.exe` @ `0x56C8A0`** liegt (16 × 4 B) | `formats-world`, S33/S37 | hoch — Begegnungen sind ohne EXE-Auswertung nicht vollständig |
| **7** | **`0x308`: Welt = `(mesh << 13) + lokal`** — 8192er-Kachelung in Geometrie *und* VM belegt | `world-runtime`, `render-world` | hoch — bestätigt unsere Skalierungsannahme aus zweiter Quelle |
| **8** | **Speicherbank-Modell:** genau ein Store (`0xE0`), Breite folgt aus der Push-Form; Bitadresse = flaches Bitfeld (`div 8` / `mod 8`); Savemap-Basis `0xBA4` | `interpreter` | hoch |
| **9** | **Aufrufkonvention:** ID im Opcode (`opcode − 0x204`, 0–43), Entität vom Stack, `0xFFFF` = System im Kontext der aktiven Entität, asynchron + `0x334` als Join | `interpreter`, `world-runtime` | hoch |
| **10** | **UV-Semantik:** u/v-Bytes sind VRAM-seiten-absolut und müssen über `uOffset/vOffset` + Modulo texturlokal gemacht werden; 282/8/4 Texturen je Karte | `render-world` | mittel-hoch — ohne das sind Texturen sichtbar falsch |
| **11** | **`.BOT` = 332 Sektionen**, erzeugt aus 2×2-Umlaufblöcken (63×4) + 80 Alternativkopien | `formats-world` | mittel — bestätigt unsere Wrap-Annahme aus dem Dateiformat heraus |
| **12** | **17 Special-Variablen** (u. a. `current_triangle_script_id`, `battle_result`, `prompt_window_result`, `random_8bit_number`) | `interpreter` | mittel |
| **13** | **`.mes`-Layout** (Zähler + Offsettabelle, `0xFF`-Terminator) | `formats-world` | mittel |
| **14** | **Vertexgrenze 122 je Mesh** (Engine-Puffer, nicht Format) | `render-world`, `formats-world` | mittel |
| **15** | **−Y ist „oben" im Spieldatenraum** (Standardnormale `(0, −4096, 0)`); Normalenbetrag 4096 | `render-world` | mittel — direkter Prüfpunkt für `ff7ToScene` |
| **16** | **Nicht-indizierte Geometrie + `faceIndex`-Picking**, Vertex-Verschweißung über gerundete Weltkoordinaten | `render-world` | mittel (Architekturmuster, kein Code) |
| **17** | **Chocobo-Bewertung 1..8** und Chocobo-Flag als Dreiecks-Bit 15 | `world-runtime` | niedrig-mittel |

---

## 7. Offene Fragen und Widersprüche zu unserer Weltkarten-Arbeit

Bezug: `C:\ff7-web\docs\ADR-S28-S29-WELTKARTE.md` (nur lesend eingesehen).

### 7.1 Bestätigungen (unsere Position hält)

| Unsere Aussage | Befund im Zielrepo |
|---|---|
| Call-Tabelle **fix 0x400 B**, nicht sentinelbegrenzt | ✅ bestätigt — 256 Slots à 4 B, freie Slots `0xFFFF` |
| Mesh-Kennung `(id >> 4) & 0x3FF = zeile·36 + spalte` | ✅ inhaltlich bestätigt; das Zielrepo rechnet `div 36`/`mod 36`, benennt das Ergebnis in der Oberfläche aber als Zeile/Spalte — **unsere Formulierung ist die klarere** |
| World-Bytecode ist eigene **u16-Stackgrammatik**, kein Field-Dialekt | ✅ bestätigt — reine Stackmaschine, wortorientiert, absolute Wort-Sprungziele |
| Karte **wiederholt sich am Rand** (Chebyshev-Streaming, Wrap) | ✅ bestätigt durch die `.BOT`-Erzeugung mit `mod 7` / `mod 9` |
| Wasserkandidat = **Klasse 3** (🟡, datengetrieben) | ✅ bestätigt — Typ 3 heißt „Sea"; zusätzlich 5, 6, 22, 26 wasserartig, 4 Furt |
| Geländeklassen-Semantik des Originals **unbelegt** | ✅ bestätigt — auch das Zielrepo hat nur Beobachtungen, keine Belege |

### 7.2 Widersprüche und Klärungsbedarf

1. **Funktionszählung `wm0.ev`: 142 vs. unsere 143.**
   Zielrepo zählt 32 System + 61 Model + 49 Mesh = **142** (`src/ff7/evfile.test.ts:23,32,42`).
   Unsere ADR spricht von „143/143 wm0-Funktionen enden regulär" und an anderer Stelle
   von „175/175 Funktions-Abschluss". Drei Kandidatenerklärungen:
   (a) wir zählen den Dummy-Slot bei Wortindex 0 mit; (b) wir zählen Alias-Einträge
   (mehrere Header auf denselben Offset) als eigene Funktionen, das Zielrepo nicht;
   (c) die 175 stammen aus einem anderen Bezugsrahmen (alle drei `.ev` zusammen?).
   → **Zu prüfen:** unsere Zählung gegen Alias-Dedup und Dummy-Slot abgleichen.
   Die Zahl 175 sollte separat verortet werden.

2. **Funktionskörper-Grenze.** Das Zielrepo schneidet beim ersten `0x203` ab; wir sollten
   die Grenze über den **nächsten Tabelleneintrag** bestimmen. Falls unsere „175/175
   Funktions-Abschluss"-Messung auf dem ersten `RETURN` beruht, misst sie möglicherweise
   dasselbe wie das Zielrepo und würde Code hinter einem frühen `RETURN` übersehen.
   → **Zu prüfen an Realdaten:** Gibt es Funktionen, bei denen der nächste Tabellen-Offset
   weiter reicht als das erste `0x203`?

3. **`0x100 RESET` als Compiler-Artefakt vs. Originalverhalten.** Das Zielrepo *erzeugt*
   `RESET` defensiv vor `if`, Zuweisung und Aufruf. Ob das Original dasselbe Muster
   verwendet oder `RESET` gezielter setzt, ist damit **nicht** belegt. Unsere
   Stacktiefen-Statistik sollte das prüfen, bevor wir daraus Regeln ableiten.

4. **Mesh-Funktions-ID-Raum: 4 Bit im Header, aber nur 3 Bit im Dreieck.**
   Der Header reserviert 4 Bit (0–15) für Mesh-Funktions-IDs, das `script`-Feld des
   Dreiecks aber nur 3 Bit (0–7), wovon nur 3..7 Skripte sind → real 5 auslösbare IDs
   (0..4). **Widerspruch oder zweiter Auslöseweg?** Das Zielrepo erklärt es nicht.
   → **Zu messen:** Kommen in `wm0.ev` Mesh-Funktions-IDs > 4 vor? Falls ja, gibt es
   einen zweiten, unbekannten Auslösemechanismus.

5. **`0x349 set_world_progress` (5 Stufen) vs. 4 Alternativgruppen.**
   Die Abbildung Stufe → geschaltete Gruppe(n) steht nirgends. Insbesondere: Stufe 2
   („nach Erscheinen der Ultimate Weapon") und Stufe 4 („nach Tod der Ultimate Weapon")
   haben **keine** eigene Alternativgruppe. → **🔴 bleibt offen**, aber deutlich enger
   eingegrenzt als vorher.

6. **`WM3`-Rasteranordnung (unsere Messung „blind — 12 Unikate auf 64 Meshes").**
   Das Zielrepo behauptet schlicht 2×2 Sektionen à 4×4 Meshes = 8×8. Es liefert
   **keinen Beleg** dafür, dass diese Anordnung stimmt — es rendert nur so.
   Unsere Beobachtung von 12 Unikaten auf 64 Meshes ist damit **nicht widerlegt**:
   Der Great Glacier könnte tatsächlich stark wiederholte Meshes enthalten.
   → **🔴 bleibt offen.**

7. **Y-Achsen-Konvention.** Zielrepo: Positionen unverändert, Normalen bei der Anzeige in
   **Y und Z** negiert, Standardnormale `(0, −4096, 0)`. Unsere ADR sagt: Weltvertex
   `(x, h, z)` geht als `[x, z, h]` in `ff7ToScene`. Das sind **verschiedene
   Konventionen**, die zum selben Bild führen können — aber nur, wenn das Vorzeichen von
   `h` stimmt. → **Zu prüfen:** Ist unsere Höhe `h` bereits vorzeichenkorrigiert, oder
   verlassen wir uns auf das Kameramodell? Konkreter Testfall: eine flache Grasfläche
   muss eine Normale mit **negativem** Y in den Rohdaten haben.

8. **Terrain→Encounter-Set steckt in `ff7_en.exe` @ `0x56C8A0`.**
   Unsere ADR koppelt Begegnungen an S33 und hält sie als Stub. Der Fund verschiebt das
   Problem: Ein reiner LGP/MAP-Datenpfad reicht **nicht**. Das gehört zu S37 (EXE-Analyse).
   → **Neue Abhängigkeit**, in der Roadmap noch nicht abgebildet.

9. **`.mes`-Grenze 0x1000 Byte.** Ob das eine Engine-Grenze oder eine Editor-Annahme ist,
   sagt das Zielrepo nicht. Für unseren Lesepfad irrelevant, für einen Schreibpfad nicht.

10. **Fahrzeugmatrix.** Unsere ADR prüft ausschließlich die **Zielklasse** gegen die
    Matrix des aktiven Fahrzeugs. Das Zielrepo kennt zwei Opcodes, die das berühren:
    `0x34B set_chocobo_type` ändert laut Beschreibung **Farbe *und* Walkmesh-Parameter**,
    und `0x354 set_vehicle_usable` sperrt Entitäten. → Die Fahrzeugmatrix ist im Original
    also **skriptseitig umschaltbar** (mindestens für Chocobos, 5 Typen). Unsere
    „austauschbare Tabelle" (🔵) ist damit nicht nur pragmatisch, sondern strukturell
    richtig — sie braucht aber einen **Umschaltpfad aus der VM**.

### 7.3 Nicht beantwortet durch dieses Repo

- 3D-Weltmodelle, Skelette, Animationsdaten (`.hrc`/`.a`/`.p`) — **null Abdeckung**.
- Kameraverhalten im Spiel (nur Editorkamera).
- Himmel/Wolken/Meteor-Darstellung (nur als Opcode-Schalter bekannt).
- Wasser-/Wellenanimation der Weltkarte.
- Genaue Bedeutung der Spielfortschrittsstufen jenseits der Grobbeschriftung.
- Die vier unbelegten Special-Variablen 17–20.

---

## 8. Kopierrisiko-Register (was auf keinen Fall angefasst wird)

| Ort | Art | Grund |
|---|---|---|
| `src/ff7/lzss.ts`, `src/ff7/lgp.ts` | Quelltext | PyFF7-Portierung (GPL) **ohne** Lizenzangabe — doppelt kontaminiert |
| `src/lib/map-data.ts` | Datentabellen + Prosa | Die englischen Beschreibungstexte zu Geländetypen sind eigene Schöpfung. Zahlen (IDs, Maße, Offsets) sind Fakten und nutzbar; **Formulierungen nicht** |
| `src/components/map/constants.ts` | Farbpaletten | Rein gestalterische Wahl des Autors, keine Spieldaten |
| `src/ff7/worldscript/opcodes.ts` | Beschreibungstexte, Mnemonics, Namensraum-Zuordnung | Opcode-**Nummern und Stelligkeiten** sind Fakten; die englischen Beschreibungen, die Mnemonics und die `Namespace.name`-Zuordnung sind Ausdruck — **eigene Benennung wählen** |
| `src/ff7/worldscript/constants.ts` | Bezeichnertabellen (Entities/Fields/Savemap-Namen) | Adressen und IDs = Fakt; die Slugs/Namen = Ausdruck |
| `src/ff7/worldscript/worldscript.ts` | Dekompilierer-Struktur, Lua-artige Oberflächensyntax | vollständig Ausdruck; unsere Oberflächensyntax muss eigenständig sein |
| `src/lib/utils.ts` (`calcUV`) | 5-Zeilen-Algorithmus mit Sonderfällen | beschreiben, nicht kopieren (Beschreibung in §5.2) |
| `docs/map-state.md`, `src/help/content.tsx`, `CLAUDE.md` | Prosa | zusammenfassen, nie zitieren |
| `src/ff7/mapfile.ts` (`writeBot`) | Erzeugungsvorschrift | Vorschrift = Fakt (§2.5), Umsetzung = Ausdruck |

**Empfohlenes Vorgehen:** Nur dieses Notizdokument geht in die Projektarbeit ein. Der
Klon unter `scratchpad/repos/` wird **nicht** in `C:\ff7-web` gespiegelt und sollte nach
Abschluss der Auswertung gelöscht werden.

---

## 9. Nicht ausgewertet / Restposten

- `src/ff7/fftext.ts` (427 Z.): FF7-Textkodierungstabelle inkl. Sonderzeichen und
  Steuercodes. Für Nachrichtendarstellung relevant, hier nicht im Detail erhoben.
- `src/data/scenes.json`, `src/lib/battle-locations.ts`: Kampfszenen-Namensliste
  (Komfortdaten für den Battle-ID-Picker), für uns an S33 gekoppelt.
- `scripts/extract-world-scripts.ts`, `scripts/get-unused-locations.ts`: Hilfswerkzeuge.
- `src/lib/worldscript.lr` / `worldscript-parser.terms.js`: Lezer-Grammatik der
  Oberflächensprache — reiner Ausdruck, irrelevant für uns.
