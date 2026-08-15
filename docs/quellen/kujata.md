# Recherche: kujata (picklejar76) + Schwesterprojekte — Notizen für WebMidgar

Stand: 2026-08-10. Alle Repos lokal geklont unter
`…\scratchpad\repos\{kujata, dg-kujata, kujata-webapp, pj-kujata-data, ff7-fenrir}`.
**Es wurde nichts unter `C:\ff7-web` verändert.**

---

## 0. LIZENZ — CLEAN-ROOM-WARNUNG (zuerst lesen)

| Repo | URL | LICENSE-Datei | package.json `license` | GitHub-API `license` |
|---|---|---|---|---|
| picklejar76/kujata | github.com/picklejar76/kujata | **keine** | `"ISC"` (`kujata/package.json:11`) | `null` (nicht erkannt) |
| dangarfield/kujata (Fork, deutlich weiter) | github.com/dangarfield/kujata | **keine** | `"ISC"` | `null` |
| picklejar76/kujata-data (JSON-Ausgabedaten) | github.com/picklejar76/kujata-data | **keine** | – | `null` |
| picklejar76/kujata-webapp (Angular-Viewer) | github.com/picklejar76/kujata-webapp | **keine** | – | `null` |
| dangarfield/ff7-fenrir (three.js-Engine) | github.com/dangarfield/ff7-fenrir | **keine** | `"ISC"` (`ff7-fenrir/package.json`) | `null` |
| Beigelegt: ff7tools-1.3 (Python, in `kujata/world-map/`) | – | **eigene LICENSE-Datei vorhanden** (GPL-artig, separat prüfen!) | – | – |

Konsequenzen:

1. Keine LICENSE-Datei im Repo-Root ⇒ nur die `package.json`-Angabe „ISC" als Absichtserklärung.
   ISC ist permissiv, verlangt aber **Copyright-Hinweis + Lizenztext bei Weitergabe von Code**.
   Da kein Lizenztext vorliegt, ist eine Übernahme von Quellcode **rechtlich unklar** → **nicht kopieren**.
2. `kujata-data` enthält **abgeleitete Square-Enix-Assets** (JSON aus flevel.lgp, PNGs aus Backgrounds,
   glTF aus char.lgp). Diese Daten sind urheberrechtlich problematisch und dürfen **nicht** in
   WebMidgar eingecheckt werden — WebMidgar extrahiert selbst aus der Original-Installation.
3. `kujata/world-map/ff7tools-1.3/` ist **Fremdcode Dritter** (Christian Bauer) mit eigener LICENSE
   → strikt meiden, auch konzeptionell separat behandeln.
4. `kujata/lgp-0.5b/src/*.c`, `tex-tool-0.10/TexTool.exe`, `sfxedit-0.3`, `lzs/fice-lzs-120` sind
   ebenfalls Drittwerkzeuge (Aali, Borde, ficedula) — nur als Referenz erwähnen.
5. **Riskant zu übernehmen (nicht verbatim lifting):** Der Opcode-Dispatcher in
   `kujata/ff7-asset-loader/ff7-binary-data-reader.js` (2838 Zeilen, ~245 Opcodes mit Kommentaren
   und „js:"-Pseudocode) — das ist die kreativste Einzelleistung des Repos. Ebenso der
   Fragment-Shader in `ff7-fenrir/app/field/field-backgrounds.js:659-694`.
   Die *Fakten* daraus (Byte-Layout, Bitfelder) sind Fakten und frei; die *Formulierung* nicht.

Alle unten stehenden Angaben sind **Beschreibungen mit Fundstelle**, damit sie unabhängig
nachvollzogen/neu implementiert werden können.

---

## 1. Repo-Landschaft und Rollen

| Repo | Rolle |
|---|---|
| `kujata` | Node-Extraktor: LGP-Inhalte → JSON/glTF/PNG. Keine Renderer.
| `dg-kujata` | Fork von dangarfield; gleiche Loader + **Encounter-Section, Palette-PNGs, Pixel-Index-PNGs, Layer-Shifts, World-/Menu-/CD-/EXE-Extractor**, CLI `kujata.js`, Extraktoren unter `data-extractors/`.
| `kujata-data` | Ausgabeartefakte (JSON pro Field, glTF pro Modell, metadata/*.json).
| `kujata-webapp` | Angular-Viewer (Feldliste, Opcode-Statistiken, Modellvorschau mit GLTFLoader).
| `ff7-fenrir` | **Die eigentliche three.js-Laufzeit**, konsumiert kujata-data. Field ist „mostly complete", 240/245 Field-Opcodes implementiert (`ff7-fenrir/OPS_CODES_FIELD_README.md:1`).

Für WebMidgar ist **ff7-fenrir die wertvollste Quelle** (Render-/Kamera-/Bewegungskonventionen),
kujata die wertvollste für **Binärlayouts**.

---

## 2. flevel-Sektionen — Binärlayout (aus `kujata/ff7-asset-loader/flevel-loader.js`)

Dateikopf: `blank:u16` (immer 0), `numSections:u32`, danach `numSections` × `u32`-Offsets
(absolut ab Dateianfang) — `flevel-loader.js:32-37`. Jede Sektion beginnt mit `u32 length`;
sektionsinterne Offsets sind relativ zu `sectionOffset + 4` (`:43-45`).
Kompression: LZS, siehe §7.

### 2.1 Sektion 1 (Index 0) — Script/Dialog
`flevel-loader.js:47-60`
| Feld | Typ |
|---|---|
| unknown | u16 |
| numEntities | u8 |
| numModels | u8 |
| stringOffset | u16 (relativ zur Sektionsbasis) |
| numAkaoOffsets | i16 |
| scale | i16 |
| blank | 3 × i16 |
| creator | char[8] |
| name | char[8] |
| entityNames | numEntities × char[8] |
| akaoOffsets | numAkaoOffsets × u32 |
| entitySections | numEntities × 32 × u16 (Script-Einsprungoffsets) |

- Dialoge: bei `sectionBase + stringOffset` steht `u16 numDialogs`; **Sonderfall `0` ⇒ 255**
  (`:86-89`), danach `numDialogs` × u16 Offsets, jeder String ab
  `sectionBase + stringOffset + dialogOffset`, terminiert mit `0xFF` (`:97-99`, `:103-114`).
- Script-Grenzen: Ende eines Scripts = Startoffset des nächsten *unterschiedlichen*
  Eintrags in `entityScriptRoutines`; identische aufeinanderfolgende Offsets = „nicht vorhanden"
  und werden übersprungen (`:125-130`, `:141-156`). Letztes Script der letzten Entity endet
  am Dialog-Bereich (`:162`). **Nur Index 0..30 werden gelesen — Script 31 ist ein bekanntes TODO**
  (`:116`).
- **Init/Main-Split:** Script 0 wird an der ersten `RET` aufgetrennt, deren `byteIndex`
  ≥ dem größten bisher gesehenen `goto`-Ziel liegt; Teil 1 = Init, Rest = Main (`:209-241`).
  Sehr brauchbare Heuristik für WebMidgar-Interpreter.
- Entity-Typisierung (Metadaten, nicht im Binärformat!) über Opcodes im Init-Script (`:254-274`):
  `PC` → Playable Character, `CHAR` → Model, `LINE` → Line,
  `BGPDH|BGSCR|BGON|BGOFF|BGROL|BGROL2|BGCLR` → **Animation**, `MPNAM` → Director.
- Script-Rollenbenennung nach Index abhängig vom Entity-Typ (`:275-307`):
  Model/PC: 0 Init, 0' Main, 1 Talk, 2 Contact. Line: 1 `[OK]`, 2/3 Move, 4 Go, 5 Go 1x, 6 Go away.
- AKAO: pro `akaoOffset` wird bei **Offset+50** ein `u8 musicId` gelesen (`:320-324`).

### 2.2 Sektion 2 (Index 1) — Kamera
`flevel-loader.js:383-403`, identisch in `dg-kujata/…/flevel-loader.js:575-600`
| Feld | Typ |
|---|---|
| xAxis, yAxis, zAxis | je 3 × i16 (Rotationsmatrix, Festkomma /4096) |
| zz | i16 |
| position | 3 × i32 (Kameraposition in Kameraraum-Koordinaten, /4096) |
| blank | i32 |
| zoom | u16 |
| unknown | u16 |
Nur die erste Kamera wird gelesen; mehrere Kameras sind ein offenes TODO.

### 2.3 Sektion 3 (Index 2) — Model Loader
`flevel-loader.js:339-376`
`blank:i16, numModels:i16, modelScale:i16`, dann pro Modell:
`nameLen:u16, name, unknown:u16, hrcId:char[8], scaleString:char[4], numAnimations:u16`,
3 × Licht `{r,g,b:u8, x,y,z:i16}`, `globalLight {r,g,b:u8}`,
dann pro Animation `nameLen:u16, name, unknown:i16`.

### 2.4 Sektion 4 (Index 3) — Palette
`flevel-loader.js:512-532`: `length:u32, header{length:u32, palX:u16, palY:u16,
colorsPerPage:u16, pageCount:u16}`, danach `pageCount × colorsPerPage × i16`-Farben.
Farbformat siehe §4.1.

### 2.5 Sektion 5 (Index 4) — Walkmesh
`flevel-loader.js:406-429`: `length:u32, numSectors:u32`,
dann `numSectors` × 3 Vertices `{x,y,z:i16, res:i16}` (res = Padding),
danach `numSectors` × 3 × i16 **Accessors** (Nachbardreieck-IDs, `-1` = Kante ohne Nachbar,
vgl. `ff7-fenrir/app/field/field-backgrounds.js:270`).

### 2.6 Sektion 7 (Index 6) — Encounter (nur im dangarfield-Fork)
`dg-kujata/ff7-asset-loader/flevel-loader.js:638-664`: zwei Tabellen, je
`enabled:u8, rate:u8, 6 × u16`; jedes u16 dekodiert als
`prob = b >> 10`, `encounterId = b & 0x03FF`.

### 2.7 Sektion 8 (Index 7) — Trigger/Gateways
`flevel-loader.js:432-502`
- Header: `fieldName char[9]`, `controlDirection:u8`,
  **Umrechnung in Grad: `((256 - controlDirection) * 360 / 256) - 180`, relativ zur Y-Achse** (`:441`),
  `cameraHeightAdjustment:i16`, `cameraRange {left,bottom,right,top:i16}`,
  4 Bytes @0x20, `bgLayer3.animation {width,height:u16}`, `bgLayer4.animation {width,height:u16}`,
  24 Bytes @0x32.
- 12 × Gateway: `exitLineVertex1/2 {x,y,z:i16}`, `destinationVertex {x,y:i16, triangleId:i16}`,
  `fieldId:u16`, `direction:i8`, 3 unbekannte Bytes.
  **`fieldId == 32767` bedeutet „leerer Slot"** (`:470`).
- 12 × Trigger: `cornerVertex1/2 {x,y,z:i16}`, `bgGroupId_param:u8`, `bgFrameId_state:u8`,
  `behavior:u8`, `soundId:u8` — die ersten beiden Felder sind **dieselben param/state-Werte
  wie bei BGON/BGOFF** (`:483-484`). ⇒ Trigger schalten Hintergrund-Layer.
- 12 × `showArrow:i8`, dann 12 × `gatewayArrow {x:i32, z:i32, y:i32, type:i32}`
  (**Achtung: Reihenfolge x,z,y**, `:500`).

### 2.8 Sektion 9 (Index 8) — Background
`flevel-loader.js:534-679`
Header: `length:u32`, `zero1:u16`, `usePaddles:u16`, `activated:u8`,
`paletteTitle char[7]`, **`ignoreFirstPixel: u8[20]`** (pro Palette-Seite!), `zero2:u32`, `"BACK"`.

Layer 1: `width:u16, height:u16, tileCount:u16, depth:u16, blank:u16`, dann Tiles, dann `blank2:u16`.
Layer 2..4: je `flag:u8`; bei 1 folgt `width,height,tileCount:u16`,
**unknown-Block 16 Bytes für Layer 2, 10 Bytes für Layer 3/4** (`:646`), `blank:u16`, Tiles, `blank2:u16`.

**Tile-Struktur (52 Bytes)** — `flevel-loader.js:546-607`:
| Offset (rel.) | Feld | Typ |
|---|---|---|
| 0 | blank | u16 |
| 2 | destinationX | i16 |
| 4 | destinationY | i16 |
| 6 | unknown1 | u8[4] |
| 10 | sourceX | u8 |
| 11 | unknown2 | u8 |
| 12 | sourceY | u8 |
| 13 | unknown3 | u8 |
| 14 | sourceX2 | u8 |
| 15 | unknown4 | u8 |
| 16 | sourceY2 | u8 |
| 17 | unknown5 | u8 |
| 18 | width | u16 |
| 20 | height | u16 |
| 22 | paletteId | u8 |
| 23 | unknown6 | u8 |
| 24 | id (=z) | u16 |
| 26 | param | u8 |
| 27 | state als 2er-Potenz | u8 |
| 28 | blending | u8 |
| 29 | **useBlack** (im Fork benannt; bei picklejar `unknown7`) | u8 |
| 30 | typeTrans | u8 |
| 31 | unknown8 | u8 |
| 32 | textureId | u8 |
| 33 | unknown9 | u8 |
| 34 | textureId2 | u8 |
| 35 | unknown10 | u8 |
| 36 | depth | u8 |
| 37 | unknown11 | u8 |
| 38 | idBig | u32 |
| 42 | sourceXBig | u32 |
| 46 | sourceYBig | u32 |
| 50 | blank2 | u16 |

Abgeleitete Felder:
- **`state = log2(statePow2)`** (0, wenn statePow2 == 0) — `:593`.
- **layerID aus `id`** (`:536-545`): `4095 → layerID 0` (und param/state werden auf 0 zurückgesetzt),
  `4096 → layerID 2`, `0 → layerID 3`, sonst `layerID 1`. `z = id`
  („niedrigere Werte = näher an der Kamera").
- Tilegröße: 16 px; **Layer 2 und 3 können 32-px-Tiles haben** (erkannt daran, dass
  `width !== 16 && height !== 16`) — `:76-80`, `background-layer-renderer.js:154-158`.

Texturen: `"TEXTURE"`-Marker, dann **max. 42 Slots**; pro Slot `exists:u16`; wenn gesetzt:
`size:u16, depth:u16`, danach **bei depth==2 `256*256` u16-Werte (Direktfarbe), sonst
`256*256*depth` u8-Werte (Paletten-Indizes)** (`:663-676`). Abschluss `"END"` + 14 Byte `"FINAL FANTASY7"`.

---

## 3. Background-Layer-Rendering (Extractor-Seite)

Quelle: `kujata/ff7-asset-loader/background-layer-renderer.js`,
erweitert in `dg-kujata/ff7-asset-loader/background-layer-renderer.js`.

### 3.1 Layer-Gruppierung
Ein „Layer-Bild" entsteht pro **eindeutiger Kombination**
`(layerID, z, param, state, typeTrans)` — picklejar `:312-343`;
der Fork nimmt **zusätzlich `paletteId`** in den Schlüssel auf (`dg:562-576, 594`).
Sortierung vorab nach denselben Feldern (`:350`). Dateiname:
`{field}-{z}-{layerID}-{typeTrans}-{param}-{state}.png` (Fork zusätzlich `-{paletteId}`)
— `:366`, `dg:672`. Metadaten aller Layer landen in `{field}.json`.

Bekannte Grenze (im Code kommentiert, `:364`): pro `param` kann nur zwischen `state`s
umgeschaltet werden; gleichzeitige Mehrfach-States eines params sind nicht abgedeckt.

### 3.2 Canvas-Geometrie
`getSizeMetaData` (`:61-89`): min/max über `destinationX/Y` **mit 0 als Startwert**
(d. h. der Ursprung liegt immer im Bild), Breite/Höhe = `max-min+tileSize`.
Ausreißer `destinationX == 10000` (blinst_2, Layer 0, Tiles 640/641) werden ignoriert (`:69-70`).
Fork hat zusätzlich Hardcode-Fix für `elevtr1` (`dg:611-617`) und Clipping von Tiles
außerhalb der Bounds (`dg:251-254`).

### 3.3 Pixel-Auflösung pro Tile
`saveTileGroupImage` (`:124-309`):
- Quelloffset im 256×256-Texturblatt: `((sourceY + dy) * 256) + (sourceX + dx)` (`:174`).
- **Blend-Tiles benutzen die zweite Quelle:** wenn `layerID > 0 && textureId2 > 0 && depth != 0`,
  werden `sourceX2/sourceY2/textureId2` verwendet (`:145-150`).
- Paletten- vs. Direktfarbe: `usePalette` wenn Paletten vorhanden, `paletteId` gültig **und
  `depth == 1`** (picklejar `:211`); im Fork stattdessen **`depth !== 2`** (`dg:331-334`)
  — das ist eine echte inhaltliche Korrektur (depth 0 = ebenfalls indiziert).
- **Schwarz-Regel:** eine Farbe gilt als „schwarz", wenn r=g=b=0 **und** das Maskenbit gesetzt ist
  (`m != 0`, s. §4.1). Ist sie schwarz, wird stattdessen **Farbe 0 der Palette** verwendet
  (`:198-209`, `:228-233`).
- **`ignoreFirstPixel[paletteId] == 1` und Texturbyte == 0 ⇒ Pixel wird nicht gezeichnet**
  (transparent) — `:212`, `:234-239`.
- Bei Direktfarbe wird Schwarz ebenfalls als „nicht zeichnen" behandelt (picklejar `:241-243`;
  im Fork auskommentiert → Verhaltensunterschied, s. offene Fragen).
- `typeTrans == 3` (25 %) wird **im Extractor** vorab durch Multiplikation der RGB-Werte mit 0.25
  eingebacken; alle anderen Blendings sollen laut Kommentar „im Browser mit WebGL" passieren
  (`:279-285`).

### 3.4 Parallax-Metadaten für Layer 2
`:369-384`: Layer-2-Gruppen bekommen eine eigene Bounding-Box. Ist der Höhenunterschied zur
Gesamtszene ≤ 16 px, gilt `parallaxDirection = 'horizontal'`, sonst `'vertical'`;
`parallaxRatio = layerGröße / szeneGröße` in der jeweiligen Achse, `parallaxMax = szeneGröße`.

### 3.5 Zusätze im dangarfield-Fork (sehr relevant für S39)
- **Palette-PNGs**: pro Palette-Seite ein 1-Zeilen-PNG (Breite verdoppelt, jeder Eintrag doppelt
  geschrieben — Workaround gegen Sampling-Ungenauigkeit) plus ein `-all-palettes.png`
  (Breite = colorsPerPage, Höhe = Anzahl Seiten) — `dg:727-788`.
- **Pixel-Index-PNGs** (`{folder}/pixels/{name}.png`): statt RGB wird der **Paletten-Index in den
  Rotkanal** geschrieben (G=B=0, A=255); bei Direktfarb-Tiles die echte RGBA — `dg:502-512`, `dg:546-558`.
  Damit kann der Browser-Shader zur Laufzeit Palettenanimation ausführen (§5.4).
- **`layerShifts`**: pro Layergruppe (1, 2, 3) der Subtile-Versatz
  `dest % tileSize` (bei negativem dest `tileSize - (-dest % tileSize)`), einmalig aus dem ersten
  passenden Tile bestimmt — `dg:153-187`, Ausgabe in `dg:709-720`.
- Globaler `offsetX/offsetY` = negierte Mitte der Tile-Bounding-Box mit Ausreißerschwelle 3500 (`dg:632-655`).
- `useBlack` je Layer aus dem ersten Tile (`dg:705`), `isDirect = depth >= 2` (`dg:595`).

---

## 4. Farb- und Texturkonvertierung

### 4.1 Field-Palettenfarbe (16 bit)
`background-layer-renderer.js:24-36`: Bitlayout **`a bbbbb ggggg rrrrr`** (MSB→LSB),
also `r = bits 0-4`, `g = bits 5-9`, `b = bits 10-14`, `mask = bit 15`.
5→8 bit über Faktor `255/31`. Konvention im Code:
**`m = (bit15 == 1) ? 0 : 255`**, `a` wird pauschal auf 255 gesetzt.
Der Fork ergänzt `isZero = (bytes === 0)` (`dg:32`).

### 4.2 Direktfarbe (depth 2, kein Palettenzugriff)
`:37-47`: Layout **`rrrrr ggggg a bbbbb`** — `r = bits 11-15`, `g = bits 6-10`,
`b = bits 0-4`, Alpha-Bit an Position 5. (Das ist genau die um 1 Bit verschobene
Variante gegenüber 4.1 — beim Nachbau leicht zu verwechseln.)

### 4.3 TEX (`kujata/ff7-asset-loader/tex-file.js`)
Header ist eine lange u32-Kette: Version, colorKeyFlag, min/max Bits pro Farbe/Alpha/Pixel,
`noOfPalettes`, `noColorsPerPalettes`, `bitDepth`, `width`, `height`, `bytesPerRow`,
`paletteFlag`, `bitsPerIndex`, `indexedTo8bitFlag`, `paletteSize`, `bitsPerPixel`, `bytesPerPixel`
(`:12-41`), danach ein `pixelFormat`-Block (Bitmasken/Shifts/Max je Kanal, `:42-63`),
ein `misc`-Block (u. a. `referenceAlpha`, `paletteIndex`, `:64-77`),
dann `paletteData = paletteSize * 4` Bytes (BGRA/RGBA-Bytes) und
`pixelData = width * height * bytesPerPixel` (`:80-81`),
optional `colorKeyArray` (`noOfPalettes` Bytes) — kann fehlen, wird abgesichert (`:82-86`).
PNG-Ausgabe: Palettenindex + `paletteOffset` → 4 Bytes aus `paletteData`.
**Bekannte Einschränkung im Kommentar** (`:103-114`): kein Zugriff auf Paletten jenseits der
ersten 1024 Byte, RGB555 (`bitDepth == 16`) wird als in FF7 nicht vorkommend angenommen.
Der Fork rendert stattdessen alle Paletten (`saveAllPalettesAsPngs`).

### 4.4 TIM (`kujata/ff7-asset-loader/tim-file.js`, Kopfkommentar verweist auf Makou Reactor)
Byte 0 Tag, Byte 1 Version; ab Offset 4 `marker`: `marker & 3` → BPP-Typ,
`(marker >> 3) & 1` → CLUT vorhanden (`:19-25`).
CLUT-Block ab Offset 8: `length:u32, x,y,width,height:u16`; `paletteSize` = 16 (4bit) bzw. 256 (8bit);
`noOfPalettes = (length - 12) / (paletteSize * 2)`, **verdoppelt, wenn die Division nicht aufgeht**
(`:36-40`). Farben über dieselbe Funktion wie Field-Paletten (§4.1) — also gemeinsames 16-bit-Format.
Bilddaten: `length:u32, x,y,width,height:u16`; **width × 4 bei 4bit, × 2 bei 8bit** (`:66-67`).

---

## 5. three.js-Laufzeit (ff7-fenrir) — die für WebMidgar spannendsten Konventionen

Zielauflösung intern: **320×240**, Skalierungsfaktor 2 (`app/data/global-data.js:26-31`).

### 5.1 Field-Kamera (`app/field/field-scene.js:185-250`)
- **FOV**: `2 * atan(240 / (2 * zoom)) * 57.29577951` — d. h. Bildhöhe 240 px als
  Sensorhöhe, `zoom` aus der Kamera-Sektion als Brennweite (`:188`).
- `THREE.PerspectiveCamera(fov, width/height, near=0.001, far=1000)`; Kommentar verweist
  darauf, dass Makou Reactor `0.001/4096` bzw. `100000/4096` benutzt (`:191-196`).
- **Achsen**: alle Kamera-Achsvektoren und die Position durch **4096** teilen.
  **Y-Achse und Y-Position werden negiert** (`:202-204`, `:211`), X und Z bleiben.
- **Kameraposition** = `-(pos · axis)` je Komponente, also klassische Inverse einer
  Rotations-/Translationsmatrix (`:214-216`).
- `camera.up = (yAxisX, yAxisY, yAxisZ)` (bereits negiert), `lookAt(pos + zAxis)` (`:221-227`).
- Weltmaßstab: **1 Einheit = 4096 FF7-Einheiten**; Walkmesh-Vertices, Modellpositionen,
  Lichtpositionen werden alle durch 4096 geteilt (`field-backgrounds.js:232-262`,
  `field-models.js:335`, `field-scene.js:379-381`).

### 5.2 FOV-Nachkorrektur gegen Hintergrundgröße (`field-backgrounds.js:410-473`)
- `adjustedFOV = fov * (bgHöhe / 240) * f`, mit empirischem
  `f = 1` für ≤41°, `0.85` für >93°, sonst `1 - (fov-41)*0.002885` (`:414-445`).
  Der Autor nennt es selbst einen Hack („maybe because the screen is about 7 % smaller").
- `camera.aspect = bgBreite / bgHöhe` (`:464-465`) — also **Seitenverhältnis aus dem
  Hintergrundbild, nicht aus dem Viewport**.
- Sichtausschnitt/Scrolling über `camera.setViewOffset(fullW, fullH, offsetX, offsetY, 320, 240)`
  (`field-scene.js:884-895`), Offsets auf halbe Pixel gerundet, um Shader-Flackern zu vermeiden
  (`:865-869`).

### 5.3 Hintergrund-Layer als Planes im 3D-Raum (`field-backgrounds.js:504-567, 701-840`)
- **z→Distanz:** `bgDistance = layer.z / 1024` (`metaData.bgZDistance = 1024`, `:457`, `:534`).
  Position = `lerp(cameraPos, cameraTarget, bgDistance)` (`:550-554`).
- Sonderregeln vor der Umrechnung (`:504-527`):
  `depth == 0 → 1`; `z <= 10 → z + 10`; **layerID 3 → z = 9 (immer vorn)**;
  **layerID 2 → z = 5000 (immer hinten)**; `param > 0 → z - 1` (Param-Layer vor ihrem Default).
- **Plane-Größe** aus Kamerafrustum: `vH = tan(effFOV/2) * distance * 2`, `vW = vH * aspect`
  (`:713-721`); bei Parallax-Layern wird die jeweilige Achse mit `parallaxRatio` multipliziert.
- Ausrichtung: `plane.lookAt(cameraPos)` und danach `setRotationFromEuler(camera.rotation)` (`:813-814`).
- **Occlusion der 3D-Modelle passiert allein über diese echte 3D-Platzierung + Z-Buffer** —
  im gesamten Field-Code gibt es **kein** `renderOrder`, `depthTest` oder `depthWrite` (verifiziert
  per Grep über `app/field/*.js`, `app/render/*.js`). Das ist die zentrale Idee: pro Tile-z eine
  eigene Ebene im Frustum, Modelle schneiden sich natürlich damit.
- **Blending** (`:818-829`): `typeTrans 1 → AdditiveBlending`, `2 → SubtractiveBlending`
  („not right at all", Beispielfelder jtempl, trnad_1, bugin1a), `3 → AdditiveBlending`
  (die 25 % sind schon im Bild eingebacken, s. §3.3).
- **Texturfilter**: `magFilter = NearestFilter`; im Nicht-Shader-Pfad zusätzlich
  `minFilter = LinearFilter` und `encoding = sRGBEncoding` (`:749-750`, `:800-803`).
- Sichtbarkeit initial: **alle Layer mit `param != 0` sind unsichtbar**, Opcodes schalten sie ein (`:528`).
- Zwei Ortho-Szenen (`field-ortho-bg-scene.js`, `field-ortho-scene.js`) werden vor und nach der
  Feldszene gerendert (Fader/UI) — `field-scene.js:82-88`.

### 5.4 Palettenbasierter Shader (`field-backgrounds.js:648-694`, Uniforms `:752-789`)
Prinzip: Layer-Textur enthält im Rotkanal den **Palettenindex** (aus dem Fork-Extractor);
die Palette liegt als `THREE.DataTexture` 256×1 RGBA vor (`:591-611`).
Fragment-Logik (beschrieben, nicht zitiert):
`index = red * 255`; Sample der Palettentextur bei `(index + 0.5)/256`;
Alpha 0, wenn das Quellpixel Alpha 0 hat **oder** `useFirstPixel && index == 0`;
ist die gefundene Farbe schwarz und `useBlack == false`, wird stattdessen Palettenfarbe 0 genommen.
`useDirect` (depth ≥ 2) umgeht die Palette komplett.
`useBlack` wird nur gesetzt, wenn das Layer-Flag gesetzt **und** `blending > 0` ist (`:762-764`).
⇒ Palettenanimation zur Laufzeit = nur die DataTexture aktualisieren + `needsUpdate`.

### 5.5 Hintergrund-Dynamik/Opcodes (`field-op-codes-background.js`, `field-backgrounds.js:15-218`)
| Opcode | Byte | Argumente (aus `ff7-binary-data-reader.js`) | Laufzeitverhalten |
|---|---|---|---|
| BGPDH | 0x2C | `b1/bx` nibbles, `l:u8` (Layer), `z:i16` | setzt z des Layers neu: alle Planes mit `layerId == l` bekommen neues z, neue Distanz, **neue PlaneGeometry** und neue Position (`field-backgrounds.js:69-104`) |
| BGSCR | 0x2D | `bx/by`, `l:u8`, `x:i16`, `y:i16` | Layer wird auf Scale 3 + `RepeatWrapping` (repeat 3×3) gesetzt und pro Frame die Textur-`center` verschoben; Faktor **`BG_SCROLL_FACTOR = 0.00266`** („matcht ztruck fairly well") (`:105-157`) |
| BGON | 0xE0 | `b1/b2`, `a` = param, `l` = state | alle Planes mit (param, state) sichtbar (`:15-27`) |
| BGOFF | 0xE1 | dito | dieselben unsichtbar |
| BGROL | 0xE2 | `b`, `a` = param | aktuellen state ermitteln, `state+1` sichtbar, Rest des params unsichtbar (`:28-61`) |
| BGROL2 | 0xE3 | dito | wie BGROL, `state-1` |
| BGCLR | 0xE4 | `b`, `a` = param | alle Planes des params unsichtbar (`:62-68`) |
| STPAL/LDPAL | 0xE5/0xE6 | `b1/b2`, `p`, `a`, `size:u8` | Palette → Temp-Array bzw. zurück; **Größe wird als `size + 1` interpretiert** (`field-op-codes-background.js:65-83`) |
| STPLS/LDPLS | – | zusätzlich `start` | wie oben mit Startindex |
| ADPAL | – | RGB + size | addiert `-(r*8)` usw. auf die Temp-Palette; die Opcode-Schicht übergibt vorher **`255 - r`** (`:84-94`, `field-backgrounds.js:947-988`) — als „255-???" markiert, also unsicher |
| MPPAL/MPPAL2 | 0xDF/… | RGB + start/size | addiert `(r - 128)` je Kanal (im Code als „not really right" markiert, `field-backgrounds.js:989-1034`) |
| CPPAL | 0xE7 | s, d, size | wird testweise wie LDPAL behandelt (`field-op-codes-background.js:126-132`) |

Layer-2-Parallax zur Laufzeit (`field-backgrounds.js:158-218`): Textur wird 3×3 gekachelt,
`center` bewegt sich linear zwischen `0.5 ± parallaxRatio/3.59` (die 3.59 ist ein empirischer
Nenner), gesteuert vom normierten Kamera-Scrolloffset. Vertikal ist das Vorzeichen invertiert.

### 5.6 Kamerafolge / Scrollbereich (`field-scene.js:790-895`)
- Weltposition → Bildschirmpunkt via `Vector3.project(debugCamera)` (Kamera ohne ViewOffset),
  dann Umrechnung in Hintergrundpixel: `x = (ndc.x+1) * bgW / 2`, `y = -(ndc.y-1) * bgH / 2` (`:790-802`).
- Clamping über `triggers.header.cameraRange {left, right, top, bottom}` in Kombination mit
  Bild- und Viewportgröße (`:805-838`) — d. h. cameraRange sind **Bildschirmränder in Hintergrundpixeln**.

### 5.7 Feldmodelle (`field-models.js`)
- **Modellskalierung** aus `model.header.modelScale` (`:55-74`):
  `faktor = (modelScale - 768) * -1 + 768` (= `1536 - modelScale`); ab `modelScale >= 1024`
  stattdessen `2^(19 - log2(modelScale))`; verwendet wird `1/faktor`.
  (Für modelScale 512 ⇒ 1/1024; für 1024 ⇒ 1/512.)
- **Orientierung**: das glTF-Wurzelobjekt wird um **X +90°** gedreht, `scene.up = (0,0,1)`
  (`:146-147`) — die Welt ist also Z-up.
- **Richtungen**: FF7-Richtung 0..255 ↔ Grad über `deg = round(dir * 360/255)` bzw.
  `dir = round(deg * 255/360)` (`:26-39`). Modellrotation wirkt auf `scene.children[0].rotation.y`.
- Defaults pro Entity (`:153-159`): `movementSpeed = 1024`, `animationSpeed = 16`,
  `talkRadius = 60`, `collisionRadius = 60`.
- **Animationstempo**: `timeScale = (animationSpeed / 16) * speed` (`field-animations.js:109`);
  Clips werden mit **30 fps** subgeclippt (`field-animations.js:320-352`).
- Lauf/Gehen: `movementSpeed < 1600` ⇒ Walk-Animation (ID 1), sonst Run (ID 2)
  (`field-movement.js:483-492`).
- Distanzen werden zum Vergleich mit **4096** zurückskaliert; Zielankunft bei Distanz < 8
  FF7-Einheiten (`field-movement.js:398-411`).

### 5.8 Walkmesh-Bewegung (`field-movement-player.js:99-215`)
- Bewegung wird per **Raycast von oben** (`RAY_HEIGHT = 0.1`, Richtung `(0,0,-1)`) gegen die
  Walkmesh-Dreiecksmeshes getestet; der Trefferpunkt liefert die Z-Höhe und die `triangleId`.
- Kann die Zielrichtung nicht laufen, werden Ausweichwinkel geprüft:
  **`SLIP_ANGLE_1 = 45°`, `SLIP_ANGLE_2 = 70°`** (Wandgleiten).
- Ein Wechsel auf ein anderes Dreieck ist nur zulässig, wenn es in den **Accessors** des aktuellen
  Dreiecks steht (Nachbarschaftsprüfung, `:183-199`); Kommentar nennt sehr dünne Dreiecke
  (convil_1) als Problemfall.
- Walkmesh wird als je ein `BufferGeometry`-Dreieck pro Sektor gebaut, `userData.triangleId`;
  Kanten mit Accessor `-1` werden andersfarbig gezeichnet (`field-backgrounds.js:219-300`).

---

## 6. Modelle: HRC / RSD / P / A

### 6.1 HRC (`kujata/ff7-asset-loader/hrc-loader.js`) — Textformat
Zeile 1 `:HEADER_BLOCK 2`, Zeile 2 `:SKELETON <name>`, Zeile 3 `:BONES <n>`;
**`n == 0` bedeutet real 1 Bone namens „null" ohne Kinder** (`:33-35`).
Danach **5 Zeilen pro Bone ab Index 4**: name, parent, length, rsd-Liste (`:40-52`).
RSD-Liste: erstes Token = Anzahl, danach die Basisnamen; `"0"` = keine (`:9-22`).
Kommentarzeilen beginnen mit `#` und werden vorher entfernt.

### 6.2 RSD (`rsd-loader.js`) — Textformat
`@RSD`, `PLY=`, `MAT=`, `GRP=`, `NTEX=`, dann `TEX[i]=`.
Der Loader erzwingt, dass MAT und GRP denselben Basisnamen wie PLY haben (`:28-29`).

### 6.3 P (`p-loader.js`) — Binär, Little Endian
Header (16 × i32, `:71-98`): u. a. `isColoredVertices`, `numVertices`, `numNormals`,
`numTextureCoords`, `numNormalIndices`, `numEdges`, `numPolygons`, `numHundrets`, `numGroups`, `mirex_g`;
danach 16 weitere unbekannte i32 (`:100-102`).
Reihenfolge der Blöcke:
Vertices (3 × float), Normals (3 × float), TexCoords (2 × float),
**VertexColors und PolygonColors als BGRA-Bytes** (`:112-117`),
Edges (2 × i16), Polygone (je `i16 unknown`, 3 Vertex-, 3 Normal-, 3 Edge-Indizes als i16,
dann `i32 unknown` — 24 Byte/Polygon, `:121-129`).

**„Hundrets" (Render-State-Blöcke, 25 × i32, `:130-158`)** — für WebMidgar wertvoll:
`renderFlags1/2, textureId, textureSetPointer, shadeMode, ambient, materialPointer,
srcBlend, dstBlend, alphaRef, blendMode, zsort (zur Laufzeit gefüllt), vertexAlpha`.
Kommentar zu `blendMode`: **0 = average, 1 = additive, 4 = none; andere Modi kaputt/ungenutzt**
(`:149`). Der Fork mappt zusätzlich testweise 3 → additiv (`dg-kujata/ff7-gltf/ff7-to-gltf.js:967-990`).

**PolygonGroups (`:159-172`)**: `polygonType, offsetPolyIndex, numPolysInGroup,
offsetVertexIndex, numVerticesInGroup, offsetEdgeIndex, 5 × unknown,
offsetTextureCoordinateIndex, isTextureUsed, textureIndex`.
Danach `i32 unknown` und **BoundingBox als max{x,y,z} vor min{x,y,z}** (`:174-177`),
zuletzt `numNormalIndices` × i32 (Vertex→Normal-Zuordnung), bei `cvba` läuft der Puffer aus
und wird abgesichert (`:184-186`).
Fehlen Normalen, berechnet der Loader Flächennormalen aus `(p2-p1) × (p3-p1)` (`:7-55`).

### 6.4 A (`a-loader.js`) — Animationen
`version:i32, numFrames:i32, numBones:i32`, **`rotationOrder1/2/3` als drei u8**,
dann 1 u8 + 5 i32 unused (`:16-25`).
Pro Frame: `rootRotation{x,y,z:float}`, `rootTranslation{x,y,z:float}`,
dann `numBones` × `{x,y,z:float}` Bone-Rotationen **in Grad** (`:26-36`).

### 6.5 glTF-Übersetzung — Konventionen (`kujata/ff7-gltf/ff7-to-gltf.js`, `ff7-field-animation-translator.js`, `config.json`)
- **Rotationsreihenfolge: hart „YXZ"** — die Felder `rotationOrder1/2/3` aus der A-Datei werden
  *nicht* benutzt (expliziter TODO-Kommentar, `ff7-to-gltf.js:151-161`,
  `ff7-field-animation-translator.js:60`). Quaternion-Bildung siehe `ff7-gltf-common.js:14-55`
  (Standard-Euler→Quaternion für 6 Reihenfolgen).
- **Root-Bone bekommt +180° um X** (`ROOT_X_ROTATION_DEGREES`, `ff7-to-gltf.js:42, 227-232`;
  `config.json:85` `rootRotationDegreesX.field = 180`). Battle-Modelle stattdessen
  `containerRotationDegreesX = 180` (`config.json:88`).
- **Knochenkette:** jedes Bone-Node hat Translation `[0, 0, -parentBone.length]`, also
  **entlang −Z vom Elternknochen weg** (`ff7-to-gltf.js:554-557`). Knoten-Indizes:
  0 = RootContainer, 1 = BoneRoot, 2+i = Bone i (`:599`).
- **Wurzeltranslation der Animation: `(x, y, -z)`** — Z wird gespiegelt
  (`ff7-field-animation-translator.js:199-209`).
- **Wurzelrotation der Animation: `(x - 180, 360 - y, z)`** (`:245-250`).
- **fps: Field 30, Battle 7.5 bzw. 15** (`config.json:74`; `ff7-to-gltf.js:44-48` benutzt 15 für Battle
  — Widerspruch, s. offene Fragen). Jeder Frame erzeugt **zwei** Keyframes (Start/Ende) mit
  identischem Wert, d. h. faktisch Step-Interpolation trotz `"LINEAR"` (`:136`, TODO im Code).
- **Dreiecks-Wicklung wird umgedreht** (Indizes 3,2,1) — `ff7-to-gltf.js:376-381`,
  passend zu `reverseVertexOrder = true` (`config.json:75`).
- **UV-Korrektur**: `u`/`v` ≥ 0.999 werden auf den Nachkommateil reduziert;
  Battle-Modelle bekommen `v` negiert („textures are upside down") — `:491-502`.
- Materialien: `metallicFactor 0`, `roughnessFactor 0`, `alphaMode "BLEND"`;
  Sampler `magFilter LINEAR`, `minFilter NEAREST_MIPMAP_LINEAR`, `wrap REPEAT` (`:209-214`, `:326-340`).
  Der Fork setzt `alphaMode` abhängig davon, ob die Textur wirklich transparente Pixel hat, und
  aktiviert `KHR_materials_unlit` für transparente/Battle-Materialien
  (`dg-kujata/ff7-gltf/ff7-to-gltf.js:660-681`).
- Texturierte PolygonGroups verlieren `COLOR_0` (`ff7-to-gltf.js:544-546`).
- Vertexfarben werden durch 255 geteilt; in `ff7-gltf-common.js:59-69` gibt es zusätzlich eine
  Variante, die **Alpha invertiert** (`1 - a/255`).

---

## 7. LZS-Dekompression (`kujata/lzs/lzs-decompressor.js`)
`u32 declaredLength` = Dateigröße − 4, danach Kontrollbyte-Schema:
pro Kontrollbyte 8 Bits, **Bit gesetzt = Literalbyte**, Bit 0 = 2-Byte-Referenz.
Referenz: `rawOffset = ((byte2 >> 4) << 8) | byte1`, `rawLength = byte2 & 0x0F`,
**Länge = rawLength + 3**, Zielposition
`actualOffset = tail - ((tail - 18 - rawOffset + 4096) % 4096)`
(4096er-Ringpuffer, Bias 18) — `:44-51`.
Sonderfälle: Position < 0 ⇒ Nullbytes; Position > tail ⇒ Wiederholung des bereits kopierten
Musters (`:53-66`).

---

## 8. Sonstige Fundstücke
- **maplist** (`map-list-loader.js`): `u16 numMaps`, danach `numMaps × char[32]`.
  Gateway-`fieldId` indiziert direkt in diese Liste (`flevel-loader.js:471-473`).
- **Zeichensatz** (`char-map.js`): Portierung der Tabelle aus touphScript;
  Dialogstrings enden mit `0xFF`; Steuercodes u. a. Farbnamen GRAY/BLUE/… und `MEM1/MEM2/MAX`.
- **Vergleichsoperatoren in IF-Opcodes** (`ff7-binary-data-reader.js:116-129`):
  0 `==`, 1 `!=`, 2 `>`, 3 `<`, 4 `>=`, 5 `<=`, 6 `&`, 7 `^`, 8 `|`, 9 `& (1<<b)`, 10 `!(& (1<<b))`.
- **Bank-Nibbles**: fast alle Opcodes packen zwei Bank-IDs in ein Byte (`hi = >>4`, `lo = &0x0F`);
  Bank 0 = Literal, sonst Speicherbank (durchgängiges Muster, z. B. `:641-660`).
  In `REQ`-Familien: `priority = (byte & 0b11100000) >> 5`, `scriptId = byte & 0b00011111` (`:195`).
- **Charakter-IDs** (`:131-147`): 0 Cloud … 8 Cid, 9 YoungCloud, 10 Sephiroth, 11 Chocobo,
  0xFE/0xFF = „keiner".
- **CCANM-Aktions-IDs** (`:2438`): 0 Stand, 1 Walk, 2 Run.
- **BTMD2-Bitflags** (`:531-541`): DisableRewardScreens, ActivateArenaMode, DisableVictoryMusic,
  CanNotEscape, PreEmptiveAttack, TimedBattleWithoutRewardScreen, NoCelebrations, DisableGameOver.
- Emittierte Field-JSON-Struktur (verifiziert an `pj-kujata-data/data/field/flevel.lgp/md1_1.json`):
  `{blank, numSections, sectionOffsets, script{header, entities[{entityId, entityName, entityType,
  scripts[{index, scriptType, isMain, ops[]}]}], dialogStrings}, model{header, modelLoaders},
  cameraSection{cameras}, walkmeshSection{numSectors, triangles, accessors},
  triggers{header, gateways, triggers, shownArrows, gatewayArrows}, palette, background}`.
  Tiles/Texturen/Palettenseiten werden im JSON durch `"Omitted to reduce size"` ersetzt
  (`flevel-loader.js:693-704`) — die Pixel gehen ausschließlich in die PNGs.

---

## 9. Top-Erkenntnisse für WebMidgar (gerankt, mit Paketbezug)

1. **Layer-z → 3D-Distanz statt 2D-Sortierung** (`render-field`, S39).
   `distance = tile.z / 1024`, Position = `lerp(kameraPos, kameraZiel, distance)`,
   Plane-Größe aus dem Frustum (`vH = tan(fov/2)*d*2`). Damit erledigt der Z-Buffer die
   Verdeckung der Actors durch Hintergrundteile ohne Sonderlogik.
   Quelle: `ff7-fenrir/app/field/field-backgrounds.js:504-567, 713-732`.
2. **Kamera-Rekonstruktion aus der flevel-Kamerasektion** (`render-field`, `formats-field`).
   `fov = 2*atan(240/(2*zoom))` in Grad, Achsen/Position ÷4096, **Y negiert**,
   Position = `-(pos·achse)`, `up` = negierte Y-Achse, `lookAt(pos + zAxis)`.
   Quelle: `ff7-fenrir/app/field/field-scene.js:185-229`.
3. **Layer-Identität = (layerID, z, param, state, typeTrans[, paletteId])** und
   `state = log2(statePow2)`; `id`-Sonderwerte 4095/4096/0 → layerID 0/2/3.
   Das ist das Fundament für BGON/BGOFF/BGROL. (`formats-field`, `render-field`)
   Quelle: `kujata/ff7-asset-loader/flevel-loader.js:536-545, 593`; `background-layer-renderer.js:312-343`.
4. **Palettenindex-Textur + Paletten-DataTexture im Shader** (`render-field`, S39).
   Layer-PNG trägt den Index im Rotkanal, Palette als 256×1-RGBA-Textur; Palettenanimation
   (STPAL/LDPAL/ADPAL/MPPAL) = nur DataTexture patchen. Löst zugleich `ignoreFirstPixel`,
   „Schwarz → Palettenfarbe 0" und Direktfarb-Tiles über Uniforms.
   Quelle: `dg-kujata/…/background-layer-renderer.js:502-558`; `ff7-fenrir/…/field-backgrounds.js:588-694`.
5. **Modellskalierung aus `modelScale`** (`render-actor`): `1/(1536 - modelScale)`,
   ab 1024 `2^(log2(modelScale) - 19)`; Wurzelobjekt +90° um X, Welt Z-up, 1 Einheit = 4096.
   Quelle: `ff7-fenrir/app/field/field-models.js:55-74, 144-147`.
6. **Skelett-/Animationskonventionen** (`formats-model`, `render-actor`):
   Bone-Offset `[0,0,-parentLength]`, Rotationsreihenfolge YXZ, Root +180° um X,
   Root-Translation mit gespiegeltem Z, Root-Rotation `(x-180, 360-y, z)`, 30 fps im Field,
   Winkel in Grad. Quelle: `kujata/ff7-gltf/ff7-to-gltf.js:554-557, 227-232`;
   `ff7-field-animation-translator.js:199-250`; `config.json:74-90`.
7. **Blend-Semantik**: Tile `typeTrans` 1=additiv, 2=subtraktiv, 3=25 % (vorab eingebacken);
   P-Datei `blendMode` 0=average, 1=additive, 4=none. (`render-field`, `render-actor`)
   Quelle: `background-layer-renderer.js:279-285`; `ff7-fenrir/…:818-829`; `p-loader.js:149`.
8. **Walkmesh-Accessors als Nachbarschaftsgraph** (`walkmesh`): Bewegung nur in Nachbardreiecke,
   Höhe via Raycast/Ebenengleichung, Wandgleiten mit 45°/70°, Ankunftstoleranz 8 FF7-Einheiten.
   Quelle: `ff7-fenrir/app/field/field-movement-player.js:99-215`; `field-movement.js:398-411`.
9. **Richtungs-/Winkelkonvention** (`field-runtime`, `render-actor`): 0..255 ↔ Grad
   (`deg = dir*360/255`), Feld-Steuerrichtung `((256-controlDirection)*360/256) - 180`.
   Quelle: `field-models.js:26-39`; `flevel-loader.js:441`.
10. **Init/Main-Split und Entity-Typisierung aus Script 0** (`interpreter`, `field-runtime`):
    Split an der ersten RET nach dem letzten Rückwärts-Goto-Ziel; Entity-Typ aus vorkommenden
    Opcodes. Quelle: `flevel-loader.js:209-241, 254-307`.
11. **Kamera-Scrollbereich**: `cameraRange` sind Bildschirmränder in Hintergrundpixeln, umgesetzt
    über `camera.setViewOffset(...)` auf halbe Pixel gerundet. (`render-field`)
    Quelle: `ff7-fenrir/app/field/field-scene.js:790-838, 868-895`.
12. **Layer-2-Parallax**: Richtung aus dem Größenvergleich Layer-BBox vs. Szene-BBox
    (≤16 px Höhendifferenz ⇒ horizontal), `parallaxRatio` = Größenverhältnis; zur Laufzeit
    Texturkachel 3×3 und `center` linear zwischen `0.5 ± ratio/3.59`.
    Quelle: `background-layer-renderer.js:369-384`; `ff7-fenrir/…:158-218`.
13. **BGSCR-Scrollrate**: empirisch `speed * delta * 0.00266` mit 3×3-Kachelung und
    `RepeatWrapping`. (`render-field`, S39) Quelle: `ff7-fenrir/…:105-157`.
14. **Trigger-Felder `bgGroupId_param`/`bgFrameId_state`** sind exakt die BGON-Parameter ⇒
    Trigger sind der zweite Weg, Hintergrundzustände zu schalten. (`field-runtime`)
    Quelle: `flevel-loader.js:483-484`.
15. **Encounter-Dekodierung** `prob = b>>10`, `id = b & 0x3FF` (`formats-field`, Kampf-Integration).
    Quelle: `dg-kujata/…/flevel-loader.js:639-641`.
16. **Layer-Shift-Metadaten** (Subtile-Versatz je Layergruppe) als Erklärung für
    Halb-Tile-Verschiebungen zwischen Layern. (`render-field`)
    Quelle: `dg-kujata/…/background-layer-renderer.js:153-187`.

---

## 10. Offene Fragen / Widersprüche

1. **`usePalette`-Kriterium widersprüchlich**: picklejar verlangt `depth == 1`
   (`kujata/…/background-layer-renderer.js:211`), der Fork `depth !== 2`
   (`dg-kujata/…:331-334`). Für `depth == 0` ergibt das gegensätzliches Verhalten.
   WebMidgar sollte an realen Feldern (Tiles mit depth 0) verifizieren.
2. **Direktfarb-Schwarz**: picklejar setzt `noRender` für schwarze Direktfarbpixel (`:241-243`),
   der Fork hat das auskommentiert (`dg:395-397`). Welches ist korrekt?
3. **Alpha-Bit der Palettenfarbe**: Bit 15 wird als `m` gespeichert, `a` aber pauschal 255.
   Die eigentliche Semantik (STP-Bit der PSX-Farbe: Transparenz/Blendmaske) bleibt ungeklärt;
   die „Schwarz → Farbe 0"-Regel ist offensichtlich eine Ersatzheuristik.
4. **`typeTrans == 2` (subtraktiv) sieht nachweislich falsch aus** („Not right at all",
   `ff7-fenrir/…:824`, Beispiele jtempl, trnad_1, bugin1a). Auch der Extractor kommentiert
   „typeTrans=2 doesn't seem to display perfectly" (`background-layer-renderer.js:19`).
5. **`adjustedFovFactor`** (`ff7-fenrir/…:414-445`) ist eine reine Kurvenanpassung
   („Yes, I know it's a hack"). Vermutlich fehlt eine saubere Behandlung von
   `cameraHeightAdjustment` / Overscan / Hintergrundgröße ≠ 320×240.
6. **`BG_SCROLL_FACTOR = 0.00266`** und der Parallax-Nenner **3.59** sind unbegründete
   Messwerte — echte Beziehung zur Frame-/Pixelrate unbekannt.
7. **fps für Battle-Animationen**: `config.json:74` sagt 7.5, `ff7-to-gltf.js:44-48` benutzt 15.
8. **Rotationsreihenfolge**: Die A-Datei liefert `rotationOrder1/2/3`, benutzt wird aber immer
   „YXZ". Ob die Engine die Datei-Angabe je auswertet, ist offen (TODO im Code).
9. **Nur eine Kamera pro Field wird gelesen** (`flevel-loader.js:403`), obwohl die Sektion
   mehrere enthalten kann — für Felder mit Kamerawechsel relevant.
10. **Script 31 pro Entity wird nicht gelesen** (`flevel-loader.js:116`); außerdem existiert ein
    bekannter Parser-Fehler in `mds7st3` (Entity „aval", Script 6), bei dem der nächste
    Script-Offset nicht stimmt (`:193-196`).
11. **`destinationX == 10000`** bei blinst_2 Layer 0 (Tiles 640/641) ist unerklärt (`:69-70`);
    `elevtr1` braucht im Fork hartcodierte Bounds (`dg:611-617`).
12. **ADPAL/MPPAL-Arithmetik unsicher**: `255 - r` bzw. `(r - 128)`, beides im Code mit „???"
    bzw. „not really right" markiert (`field-op-codes-background.js:92, 101`;
    `field-backgrounds.js:1014-1021`).
13. **Ein `param` mit mehreren gleichzeitig aktiven `state`s** ist im Extractor-Modell nicht
    darstellbar (Kommentar `background-layer-renderer.js:364`). Falls FF7 das nutzt, braucht
    WebMidgar ein tile-basiertes statt bild-basiertes Layermodell.
14. **`p-loader` erkennt Modelle mit mehreren Meshes pro Bone nicht** (nur `rsdBaseFilenames[0]`
    wird verwendet; `bzhf.hrc` genannt als Gegenbeispiel, `ff7-to-gltf.js:283-285`).
15. **Selektive Beleuchtung**: 137 Felder haben pro Modell unterschiedliche Lichter; fenrir
    approximiert mit einem globalen Directional Light vom Walkmesh-Schwerpunkt aus
    (`field-scene.js:291-310`) — für WebMidgar ein bewusst offener Punkt.
