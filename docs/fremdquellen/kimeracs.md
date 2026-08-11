# KimeraCS — Forschungsnotiz (Reverse Engineering, WebMidgar)

> Erhebung: 2026-08-10. Quelle: `https://github.com/LaZar00/KimeraCS`,
> shallow clone (`--depth 1`) nach
> `…/scratchpad/repos/KimeraCS`. Alle Zitate als `Datei.cs:Zeile`.

---

## ⚠️ LIZENZ — CLEAN-ROOM-WARNUNG (zuerst lesen)

| | |
|---|---|
| **Lizenz** | **GNU General Public License v3.0** (`LICENSE`, Kopfzeile „GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007") |
| **Copyleft** | stark. Abgeleiteter Code MUSS unter GPL-3.0 stehen. |
| **Herkunft** | C#-Portierung von Bordes „Kimera" (VB6); enthält an vielen Stellen wörtlich übernommene VB6-Kommentare („-- Commented in KimeraVB6"). Die Formatkenntnis stammt laut Quellkommentaren aus dem **Qhimm-Wiki** (Mirex/Aali) — s. `FF7FieldAnimation.cs:38-39`, `FF7TEXTexture.cs:32-33`. |

**Regel für WebMidgar:** In diesem Dokument stehen ausschließlich
**Beschreibungen** von Layouts, Konventionen und Algorithmen — kein Quelltext.
Layouts (Feldreihenfolgen, Offsets) und Formatfakten sind Tatsachen und nicht
schutzfähig; die **Implementierung** ist es. Es darf daher **nichts** aus
KimeraCS kopiert werden, auch nicht sinngemäß Zeile für Zeile.

**Als riskant markiert (nicht übernehmen, nur als Hinweis benutzen):**

- 🔴 Der Bit-Entpacker der Battle-Animationen (`Utils.cs:1023-1138`) — eine
  eigenwillige, teils fehleranfällige Konstruktion. Der **Algorithmus**
  (Bitbreiten, Delta-Semantik) ist unten beschrieben; die Umsetzung muss
  eigenständig entstehen.
- 🔴 Die „Repair"-Heuristiken (`FF7PModel.cs:1293-1360`) sind Editor-Politik,
  kein Formatfakt.
- 🔴 Der 16-Bit-Texturpfad (`FF7TEXTexture.cs:256-280`) ist **nachweislich
  fehlerhaft** (s. „Fehler in der Referenz") — auf keinen Fall nachbauen.

---

## 1. `.p` — Polygondatei

### 1.1 Kopf — 128 B, 32 × int32 (LE)

`FF7PModel.cs:32-52` (Struktur), `366-407` (Leser)

| Offset | Feld | Bedeutung |
|---|---|---|
| 0x00 | `version` | muss 1 sein, sonst Ablehnung |
| 0x04 | `off04` | muss ebenfalls 1 sein — KimeraCS prüft **beide** (`:376`) |
| 0x08 | `vertexColor` | Schalter „Vertexfarben benutzt" |
| 0x0C | `numVerts` | ≤ 0 ⇒ Datei wird verworfen (`:262`) |
| 0x10 | `numNormals` | |
| 0x14 | `numXYZ` | „TryVerts", zusätzlicher Punktpool; oft 0 |
| 0x18 | `numTexCs` | |
| 0x1C | `numNormIdx` | Länge der Normalindex-Tabelle |
| 0x20 | `numEdges` | |
| 0x24 | `numPolys` | |
| 0x28 | `off28` | unbekannt |
| 0x2C | `off2C` | unbekannt |
| 0x30 | `mirex_h` | **Anzahl der Renderstate-Blöcke** („Hundrets") |
| 0x34 | `numGroups` | |
| 0x38 | `mirex_g` | unbekannt (paart mit numGroups?) |
| 0x3C | `off3C` | unbekannt |
| 0x40–0x7C | `unknown[16]` | 16 × int32, roh konserviert; wird beim Schreiben unverändert zurückgeschrieben (`:2410`) |

**Summe 0x80 = 128 B.** ✅ Deckt sich exakt mit R4 („128-B-Header").

### 1.2 Poolreihenfolge nach dem Kopf

`FF7PModel.cs:268-322` (Aufrufreihenfolge in `LoadPModel`)

| # | Pool | Satzgröße | Anzahl | Anmerkung |
|---|---|---|---|---|
| 1 | Vertices | 12 B (3 × f32) | `numVerts` | |
| 2 | Normals | 12 B | `numNormals` | |
| 3 | XYZ / „TryVerts" | 12 B | `numXYZ` | **nur wenn > 0** (`:277`) |
| 4 | TexCoords | 8 B (2 × f32) | `numTexCs` | |
| 5 | **Vertexfarben** | 4 B | `numVerts` | Byte-Folge **B, G, R, A** (`:506-511`) |
| 6 | **Polygonfarben** | 4 B | `numPolys` | dieselbe BGRA-Folge, derselbe Leser |
| 7 | Edges | 4 B (2 × u16) | `numEdges` | |
| 8 | Polygone | **24 B** | `numPolys` | Aufbau s. u. |
| 9 | Renderstates | **100 B** | `mirex_h` | s. Abschnitt 1.5 |
| 10 | Gruppen | **56 B** | `numGroups` | s. Abschnitt 1.4 |
| 11 | BoundingBox | **28 B** | 1 | s. Abschnitt 1.6 |
| 12 | Normalindex | 4 B (i32) | `numNormIdx` | |

✅ **Vollständige Übereinstimmung mit R4** (Renderstate 100 B, Gruppe 56 B,
BBox-Record 28 B, Normalindex 4 · n).

### 1.3 Polygon — 24 B

`FF7PModel.cs:68-77` (Struktur), `540-568` (Leser)

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | i16 | `tag1` |
| 0x02 | 3 × u16 | `Verts[0..2]` |
| 0x08 | 3 × u16 | `Normals[0..2]` |
| 0x0E | 3 × u16 | `Edges[0..2]` |
| 0x14 | i32 | `tag2` |

Konstante `PPOLY_TAG2 = 0x0CFCEA00` (= 217 901 568), `FF7PModel.cs:29` — der
kanonische Wert von `tag2`, den KimeraCS für neu erzeugte Polygone einsetzt.

**Indexsemantik — wichtig und subtil.** Beim Zeichnen
(`ModelDrawing.cs:152-159`) werden aus **demselben** `Verts[i]` zwei
verschiedene Adressen gebildet:

| Ziel | Adresse |
|---|---|
| Position | `Verts[ poly.Verts[i] + Group.offsetVert ]` |
| **UV** | `TexCoords[ poly.Verts[i] + Group.offsetTex ]` |
| Normale | `Normals[ NormalIndex[ poly.Verts[i] + Group.offsetVert ] ]` |

Also: **Polygon-Vertexindizes sind gruppenrelativ** ✅ (deckt sich mit R4), und
**UVs sind pro Vertex, nicht pro Polygon-Ecke** — sie werden über denselben
gruppenrelativen Index adressiert, nur mit `offsetTex` statt `offsetVert`.
`poly.Normals[i]` wird beim Zeichnen **gar nicht benutzt**; die Normale kommt
über den Vertexindex aus `NormalIndex`. (`poly.Normals` wird nur in der
Konsistenzprüfung `FF7PModel.cs:1126-1168` als Index **in `NormalIndex`**
interpretiert — die Datei erlaubt also beides, die Engine nutzt die
Vertexvariante.)

### 1.4 Gruppe — 56 B, 14 × int32

`FF7PModel.cs:165-183` (Struktur), `617-657` (Leser)

| Offset | Feld | Bedeutung |
|---|---|---|
| 0x00 | `polyType` | **1** = untexturiert · **2** = texturiert **mit** Normalen · **3** = texturiert **ohne** Normalen (`:167-170`) |
| 0x04 | `offsetPoly` | |
| 0x08 | `numPoly` | |
| 0x0C | `offsetVert` | |
| 0x10 | `numVert` | |
| 0x14 | `offsetEdge` | |
| 0x18 | `numEdge` | |
| 0x1C | `off1C` | unbekannt |
| 0x20 | `off20` | unbekannt |
| 0x24 | `off24` | unbekannt |
| 0x28 | `off28` | unbekannt |
| 0x2C | `offsetTex` | Startindex im TexCoord-Pool |
| 0x30 | `texFlag` | 1 = Gruppe ist texturiert |
| 0x34 | `texID` | Index in die Texturliste der RSD/Skelett-Ressource |

**Quirk:** `texID` steht **zweimal** in der Datei — hier und im Renderstate
(0x10). Der Quellkommentar (`FF7PModel.cs:137-138`) sagt ausdrücklich: *für die
Konsistenz sollten beide gleich sein, aber **FF7 benutzt tatsächlich den Wert
aus dem Renderstate***. KimeraCS selbst benutzt beim Zeichnen dennoch den
Gruppenwert (`ModelDrawing.cs:372, 382`) — eine Inkonsequenz der Referenz.
👉 **Für WebMidgar: den Renderstate-Wert vorziehen, Abweichung protokollieren.**

**Reihenfolge der Gruppen ≠ Zeichenreihenfolge.** `AssignRealGID`
(`FF7PModel.cs:713-756`) sortiert die Gruppen nach aufsteigendem `offsetPoly`
und vergibt daraus eine „echte" Gruppen-ID. Die Reihenfolge im Gruppenblock
ist also nicht garantiert monoton.

### 1.5 Renderstate („Hundret") — 100 B, 25 × int32

`FF7PModel.cs:131-163` (Struktur), `575-610` (Leser)

| Offset | Feld | Bedeutung |
|---|---|---|
| 0x00 | `field_0` | |
| 0x04 | `field_4` | |
| 0x08 | **`field_8`** | **Wert**bits der Renderstates |
| 0x0C | **`field_C`** | **Änderungsmaske**: nur wo hier ein Bit steht, wird der State überhaupt gesetzt |
| 0x10 | `texID` | *der* von FF7 benutzte Texturindex (s. o.) |
| 0x14 | `texture_set_ptr` | Laufzeit, in der Datei bedeutungslos |
| 0x18 | `field_18` | |
| 0x1C | `field_1C` | |
| 0x20 | `field_20` | |
| 0x24 | `shademode` | **1 = flat, 2 = smooth** |
| 0x28 | `lightstate_ambient` | |
| 0x2C | `field_2C` | |
| 0x30 | `lightstate_material_ptr` | Laufzeit |
| 0x34 | `srcblend` | D3D-Blendfaktor (von KimeraCS **ignoriert**) |
| 0x38 | `destblend` | dito |
| 0x3C | `field_3C` | |
| 0x40 | `alpharef` | Alphatest-Schwelle (von KimeraCS **ignoriert**) |
| 0x44 | **`blend_mode`** | 0 = Average (½ src + ½ dst) · 1 = Additive · 2 = Subtractive (*„broken and unused"*) · 3 = *„seems broken, never used"* · 4 = kein Blending (**nur FF8**) |
| 0x48 | `zSort` | Laufzeit |
| 0x4C–0x58 | `field_4C…field_58` | |
| 0x5C | `vertex_alpha` | |
| 0x60 | `field_60` | |

**Summe 0x64 = 100 B.** ✅

#### Die V_*-Bitmasken (das wertvollste Einzelstück)

`FF7PModel.cs:108-130` — gilt für **`field_8` (Wert)** und **`field_C` (Maske)**:

| Bit | Name | Bit | Name |
|---|---|---|---|
| 0x00001 | V_WIREFRAME | 0x00800 | V_ALPHATEST |
| 0x00002 | V_TEXTURE | 0x01000 | V_ANTIALIAS |
| 0x00004 | V_LINEARFILTER | 0x02000 | V_CULLFACE |
| 0x00008 | V_PERSPECTIVE | 0x04000 | V_NOCULL |
| 0x00010 | V_TMAPBLEND | 0x08000 | V_DEPTHTEST |
| 0x00020 | V_WRAP_U | 0x10000 | V_DEPTHMASK |
| 0x00040 | V_WRAP_V | 0x20000 | V_SHADEMODE |
| 0x00080 | V_UNKNOWN80 | 0x40000 | V_SPECULAR |
| 0x00100 | V_COLORKEY | 0x80000 | V_LIGHTSTATE |
| 0x00200 | V_DITHER | 0x100000 | V_FOG |
| 0x00400 | V_ALPHABLEND | 0x200000 | V_TEXADDR |

**Auswertungsmuster** (`ModelDrawing.cs:223-355`): stets
`if (field_C & BIT) { if (field_8 & BIT) A else B }`. Ohne Bit in `field_C`
bleibt der State unverändert — das ist ein **Delta-Protokoll**, kein
Zustandsbild. Wer die Gruppen in falscher Reihenfolge zeichnet, erbt falsche
States.

**Welche Bits KimeraCS tatsächlich auswertet:**

| Bit | Wirkung | Zeile |
|---|---|---|
| V_WIREFRAME | `glPolygonMode` LINE/FILL | `:223-229` |
| V_TEXTURE | `glEnable/Disable(GL_TEXTURE_2D)` + Bindung | `:370-390` |
| V_LINEARFILTER | MIN+MAG `GL_LINEAR` bzw. **`GL_NEAREST`** | `:232-248` |
| V_CULLFACE | Cull an; gesetzt ⇒ `GL_FRONT`, sonst `GL_BACK` | `:251-260` |
| V_NOCULL | gesetzt ⇒ Cull **aus**; sonst Cull an mit `GL_FRONT` | `:264-275` |
| V_DEPTHTEST | Tiefentest an/aus | `:279-289` |
| V_DEPTHMASK | Tiefenschreiben an/aus | `:292-302` |
| V_SHADEMODE | flat/smooth nach `shademode` | `:306-333` |
| V_ALPHABLEND | Blendmodus nach `blend_mode` | `:337-355` |

**Ignoriert:** V_PERSPECTIVE, V_TMAPBLEND, V_WRAP_U/V, V_COLORKEY, V_DITHER,
V_ALPHATEST, V_ANTIALIAS, V_SPECULAR, V_LIGHTSTATE, V_FOG, V_TEXADDR sowie die
Felder `srcblend`, `destblend`, `alpharef`. `glAlphaFunc` ist im Binder
deklariert (`OpenGL32.cs:1502`), wird aber **nirgends aufgerufen** — es gibt in
KimeraCS keinen Alphatest.

**Rückfall ohne V_ALPHABLEND** (`ModelDrawing.cs:349-355`): `blend_mode == 0`
⇒ Average-Blending **trotzdem an**; sonst Blending aus. Ein Nulldefault ist
hier also *nicht* „aus".

**Blendmodi → GL** (`OpenGL32.cs:2641-2690`, Enum `:1446-1454`):

| `blend_mode` | Gleichung / Faktoren |
|---|---|
| 0 AVG | `FUNC_ADD`, `SRC_ALPHA` / `ONE_MINUS_SRC_ALPHA` |
| 1 ADD | `FUNC_ADD`, `ONE` / `ONE` |
| 2 SUB | `FUNC_REVERSE_SUBTRACT`, `ONE` / `ONE` |
| 3 (25 %) | `FUNC_ADD`, `SRC_ALPHA` / `ONE` |
| 4 NONE | `FUNC_ADD`, `ONE` / `ZERO` |

### 1.6 BoundingBox — 28 B, mit dokumentierten Ausnahmen

`FF7PModel.cs:197-207` (Struktur), `664-693` (Leser)

| Offset | Feld |
|---|---|
| 0x00 | `unknown4bytes` (i32) |
| 0x04 | `max_x`, `max_y`, `max_z` (3 × f32) |
| 0x10 | `min_x`, `min_y`, `min_z` (3 × f32) |

**Zwei namentlich genannte Ausreißer** (`:672-688`) — echte Formatquirks:

- `magic/bari_a1.p`, `magic/bari_a2.p`: **kein** `unknown4bytes` vor der Box.
- `magic/bari_a2.p`: zusätzlich **kein** `min_x/min_y/min_z`.

KimeraCS erkennt beides über die **Restlänge** der Datei (≥ 24 bzw. ≥ 12 B),
nicht über einen Dateikopfschalter. 👉 Für `formats-model` heißt das: der
BBox-Record ist **28 B im Regelfall, aber nicht garantiert**; ein
längenbasierter Rückfall ist nötig, sobald `magic.lgp` erschlossen wird.
(In `char.lgp` tritt das laut R4 nicht auf — 4180/4180 exakt.)

### 1.7 Normalenberechnung und Windung

- `CalculateNormal(p1,p2,p3) = (p2−p1) × (p3−p1)` (`Utils.cs:876-884`).
- In `UpdateNormal` (`FF7PModel.cs:2078-2081`) wird sie mit den Vertices in der
  Reihenfolge **V2, V1, V0** aufgerufen — also mit **umgekehrter** Windung
  gegenüber der Dateireihenfolge.
- `ComputeNormals` (`:2017-2029`) wählt zwischen zwei Verfahren anhand von
  `numVerts / (numVerts + numPolys) × 100` gegen die Schwelle
  `I_COMPUTENORMALS_VERTEXTHRESHOLD = 58` (`:30`). Das ist eine reine
  Performance-Heuristik des Editors, **kein Formatfakt**.
- `ComputeEdges` (`:2116 ff.`) verwirft die Datei-Edges und legt einfach
  `numPolys × 3` Einträge an — die Kantentabelle wird von KimeraCS beim
  Rendern **nicht gebraucht**.

**Windung/Culling — konkret:** `glFrontFace` wird **nie** aufgerufen (Default
`GL_CCW`). Der Grundzustand ist `glCullFace(GL_FRONT)` + `glEnable(GL_CULL_FACE)`
(`OpenGL32.cs:2492-2493`, `frmSkeletonEditor.cs:187-188`, `frmPEditor.cs:176-177`).
👉 **Es werden die CCW-Vorderseiten weggeschnitten**, sichtbar sind also die im
Bildschirmraum **im Uhrzeigersinn** orientierten Dreiecke. Für WebGL/Three
entspricht das `side: FrontSide` mit invertierter Windung bzw. `BackSide`.

---

## 2. `.hrc` — Feldskelett

`FF7FieldSkeleton.cs:42-112` (Datei), `118-172` (Bone)

**Zeilenraster:**

| Zeile (0-basiert) | Inhalt |
|---|---|
| 0 | Kopfzeile (übersprungen) |
| 1 | Skelettname — ab **Zeichen 10** (`:55`), passend zu `:SKELETON ` |
| 2 | Bone-Anzahl — ab **Zeichen 7** (`:58`), passend zu `:BONES ` |
| 3 | Leerzeile |
| ab 4 | Bone-Blöcke zu **4 Nutzzeilen** |

**Toleranter Parser (`:72-111`):** Leerzeilen, mit `#` beginnende
Kommentarzeilen und mit Leerzeichen beginnende Zeilen werden **übersprungen und
zählen nicht** zum 4-Zeilen-Raster. Der Quellkommentar (`:66-67`) sagt
ausdrücklich, dass es Feldmodelle mit solchen Zeilen gibt.
👉 Ein streng zeilenzählender Parser bricht auf echten Daten.

**Bone-Block, 4 Zeilen in dieser Reihenfolge:**

| # | Feld | Bedeutung |
|---|---|---|
| 1 | `joint_i` | **eigener** Gelenkname |
| 2 | `joint_f` | **Elternname** |
| 3 | `len` | Bonelänge, als `double` mit **`InvariantCulture`** (`:136`) |
| 4 | `<n> <rsd1> <rsd2> …` | Ressourcenzahl + RSD-Basisnamen, leerzeichengetrennt |

Dass `joint_i` das Kind und `joint_f` der Elternteil ist, folgt aus der
Traversierung: verglichen wird gegen `joint_f`, auf den Stapel gelegt wird
`joint_i` (`FF7FieldSkeleton.cs:263, 291`).

**Defensive Auslegung der Ressourcenzeile (`:151-166`):** `nResources` wird bei
Bedarf auf die tatsächliche Anzahl der Tokens heruntergesetzt — die Zahl im
Feld ist also nicht verlässlich.

---

## 3. `.rsd` — Ressourcenbeschreibung

`FF7FieldRSDResource.cs:35-157`

Reine Textdatei. Der Leser ist **schlüsselwortgetrieben, nicht positionsfest**:
er läuft vorwärts bis zur ersten Zeile, die mit `P` beginnt (PLY), dann bis zur
ersten mit `N` (NTEX), dann je Textur bis zur nächsten mit `T` (TEX[n])
(`:72, 104, 115`).

| Schlüssel | Inhalt | Behandlung |
|---|---|---|
| `@RSD940102` | Kennung | beim Schreiben **fest** gesetzt (`:54`) |
| `PLY=NAME.PLY` | Geometrie | Endung wird verworfen, **`.P`** angehängt (`:76`) |
| `MAT=NAME.MAT` | Material | **wird nie gelesen**, beim Schreiben nur erzeugt (`:191`) |
| `GRP=NAME.GRP` | Gruppen | dito (`:192`) |
| `NTEX=n` | Texturzahl | |
| `TEX[i]=NAME.TIM` | Textur | Endung verworfen, **`.TEX`** angehängt (`:121-123`) |

✅ **Alt-Endungs-Mapping PLY→`.p` und TIM→`.tex` exakt wie in R4 dokumentiert.**
Neu gegenüber R4: **`MAT` und `GRP` sind tote Verweise** — die Dateien werden
von der Referenzimplementierung nie geöffnet.

**Texturpool:** Texturen werden über einen Skelett-weiten Pool dedupliziert,
Schlüssel ist der **Dateiname** (`:132-141`). Eine Textur, die von mehreren
Bones referenziert wird, existiert nur einmal — für `render-actor` relevant,
weil `texID` je Gruppe in **diesen** Pool zeigt.

---

## 4. `.tex` — Textur

### 4.1 Kopf — 236 B, 59 × int32

`FF7TEXTexture.cs:25-106` (Struktur), `129-187` (Leser)

| Offset | Feld | Offset | Feld |
|---|---|---|---|
| 0x00 | `version` (= 1) | 0x7C | `redBitMask` |
| 0x04 | `unk1` | 0x80 | `greenBitMask` |
| **0x08** | **`ColorKeyFlag`** | 0x84 | `blueBitMask` |
| 0x0C | `unk2` | 0x88 | `alphaBitMask` (u32) |
| 0x10 | `unk3` | 0x8C | `redShift` |
| 0x14 | `minBitsPerColor` | 0x90 | `greenShift` |
| 0x18 | `maxBitsPerColor` | 0x94 | `blueShift` |
| 0x1C | `minAlphaBits` | 0x98 | `alphaShift` |
| 0x20 | `maxAlphaBits` | 0x9C | `red8` (immer 8) |
| 0x24 | `minBitsPerPixel` | 0xA0 | `green8` (immer 8) |
| 0x28 | `maxBitsPerPixel` | 0xA4 | `blue8` (immer 8) |
| 0x2C | `unk4` | 0xA8 | `alpha8` (immer 8) |
| 0x30 | `numPalettes` | 0xAC | `redMax` |
| 0x34 | `numColorsPerPalette` | 0xB0 | `greenMax` |
| 0x38 | `bitDepth` | 0xB4 | `blueMax` |
| 0x3C | `width` | 0xB8 | `alphaMax` |
| 0x40 | `height` | 0xBC | `colorKeyArrayFlag` |
| 0x44 | `pitch` | 0xC0 | `runtimeData2` |
| 0x48 | `unk5` | 0xC4 | `referenceAlpha` |
| 0x4C | `hasPal` | 0xC8 | `runtimeData3` |
| 0x50 | `bitsPerIndex` | 0xCC | `unk6` |
| 0x54 | `indexedTo8BitsFlag` | 0xD0 | `paletteIndex` |
| 0x58 | `paletteSize` | 0xD4 | `runtimeData4` |
| 0x5C | `numColorsPerPalette2` | 0xD8 | `runtimeData5` |
| 0x60 | `runtimeData` | 0xDC | `unk7` |
| 0x64 | `bitsPerPixel` | 0xE0 | `unk8` |
| 0x68 | `bytesPerPixel` | 0xE4 | `unk9` |
| 0x6C | `numRedBits` | 0xE8 | `unk10` |
| 0x70 | `numGreenBits` | | |
| 0x74 | `numBlueBits` | | |
| 0x78 | `numAlphaBits` | | |

**Ende 0xEC = 236 B.** ✅ Deckt sich exakt mit R4. **Und: der Kopfschalter für
den Farbschlüssel liegt bei 0x08** — genau wie in R4-B9 notiert. ✅

### 4.2 Körper

`FF7TEXTexture.cs:189-202`

| Block | Bedingung | Größe |
|---|---|---|
| Palette | `hasPal == 1` | `paletteSize × 4` B |
| Pixel | immer | `width × height × bytesPerPixel` B |
| ColorKey-Array | `colorKeyArrayFlag == 1` | `numPalettes` B |

Semantische Hinweise aus den Feldkommentaren (`:52-61`):
`paletteSize` **muss** `numPalettes × numColorsPerPalette` sein;
`numColorsPerPalette2` darf gleich oder 0 sein („doesn't really matter");
`pitch` wird selten benutzt und ist üblicherweise `bytesPerPixel × width`;
**`bytesPerPixel` ist `bitsPerPixel` vorzuziehen**; `indexedTo8BitsFlag` wird in
FF7 nie benutzt; das letzte Feld vor der Palette ist FF8-spezifisch und in FF7
**nicht** vorhanden (`:100`, auskommentiert).

### 4.3 Palettenreihenfolge und Transparenz

- Die Palette ist laut Strukturkommentar (`:102`) **„always in 32-bit BGRA"**.
  ✅ **Bestätigt R4-B5.** Die Dekodierung (`:244-246`) kopiert die ersten drei
  Bytes **in Dateireihenfolge** in einen BGRA-Zielpuffer, der anschließend als
  `GL_BGRA` hochgeladen wird (`:318, 350`) — konsistent mit BGRA.

- **Transparenzregel in KimeraCS (`:248-249`): Pixel**index** 0 UND
  `ColorKeyFlag == 1` ⇒ Alpha 0, sonst Alpha 255.**

  ⚠️ **Widerspruch zu WebMidgar — und WebMidgar ist hier belegt im Recht.**
  KimeraCS **ignoriert das Alphabyte der Palette vollständig** (nur Index 0..2
  werden kopiert). Das ist exakt die grobe Faustregel, die
  `tex-alpha-probe` mit **7,7 % zu viel entfernten Texeln in 68 Dateien**
  gemessen hat. R4-B9 (Palettenalpha statt Index 0) bleibt gültig; KimeraCS ist
  in diesem Punkt die schlechtere Referenz.

  Zusatz: KimeraCS liest den **`paletteIndex`** (0xD0) und das
  **ColorKey-Array** zwar ein, benutzt aber beim Dekodieren **immer Palette 0**
  — Mehrpalettentexturen werden nicht bedient. Für `render-actor`/`modding` ist
  das eine offene Stelle, keine Antwort.

### 4.4 GL-Zustand für Texturen

`FF7TEXTexture.cs:294-352`

- Filter: `GL_LINEAR` für MIN und MAG als Grundeinstellung (`:297-298`), später
  je Gruppe über V_LINEARFILTER auf `GL_NEAREST` umschaltbar.
- `GL_UNPACK_ALIGNMENT = 1` (`:339`).
- Uploadformat nach `bitDepth`: 1/2/4/8/32 ⇒ `GL_BGRA`→`GL_RGBA`;
  24 ⇒ `GL_BGR`→`GL_RGB`; 16 ⇒ `GL_RGBA`→`GL_RGB5`.
- **Wrap-Modi werden nie gesetzt** — es bleibt beim GL-Default `GL_REPEAT`,
  obwohl das Format mit V_WRAP_U/V eigene Bits dafür hat.

### 4.5 🔴 Fehler in der Referenz — nicht nachbauen

Der 16-Bit-Pfad (`FF7TEXTexture.cs:256-280`) ist **doppelt kaputt**:

1. Die Schleifengrenze `imageSize` wird auf 0 gesetzt (`:258`) und nie
   berechnet — die Schleife läuft **nie**. Der Pfad ist toter Code.
2. Die Kanalextraktion benutzt `Math.Pow(col16 / 2, 5)` bzw. `…, 10)` statt
   eines Rechtsschiebens um 5 bzw. 10 Bit (`:269-270`). Das ist mathematisch
   etwas völlig anderes.

👉 Für `formats-model`: A1R5G5B5 nach der **Maskenformel aus dem Kopf** selbst
implementieren — die steht im Strukturkommentar (`:76-77`):
`Kanal = ((value & mask) >> shift) × 255 / max`.

---

## 5. `.a` — Feldanimation

### 5.1 Kopf — 36 B

`FF7FieldAnimation.cs:70-81` (Struktur), `145-162` (Leser)

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | i32 | `version` — muss 1 sein, damit FF7 lädt |
| 0x04 | i32 | `nFrames` |
| 0x08 | i32 | `nBones` |
| **0x0C** | 3 × u8 | **`rotationOrder[3]`** — 0 = alpha, 1 = beta, 2 = gamma |
| 0x0F | u8 | `unused` |
| 0x10–0x23 | 5 × i32 | `runtime_data[5]` |

**Summe 36 B.** ✅ Genau wie R4.

**Zur Rotationsreihenfolge:** Das Feld liegt bei **0x0C..0x0E** — R4 nennt
„Versatz 12..14", also dieselbe Stelle ✅, und misst dort 3209/3209 eine
Permutation von {0,1,2} mit **genau einem** belegten Wert. KimeraCS **liest das
Feld zwar ein, wertet es aber nirgends aus** — die Reihenfolge ist im Zeichnen
fest verdrahtet (s. 5.3). Das ist ein starkes Indiz dafür, dass das Feld in der
Praxis konstant ist, und deckt sich mit der R4-Messung.

Zusatzfund: R4 notiert „Byte 15, `version` 0 bzw. 1". KimeraCS nennt Byte 0x0F
**`unused`** (`:79`) — der Name „version" für dieses Byte ist damit nicht
gestützt; beide Quellen sind sich nur einig, dass das Byte nicht ausgewertet
wird.

### 5.2 Frame

`FF7FieldAnimation.cs:166-200`

| Reihenfolge | Inhalt | Größe |
|---|---|---|
| 1 | **Wurzelrotation** alpha, beta, gamma (3 × f32) | 12 B |
| 2 | **Wurzeltranslation** X, Y, Z (3 × f32) | 12 B |
| 3 | je Bone: alpha, beta, gamma (3 × f32) | 12 B × `nBones` |

**Frame = 24 B Wurzel + 12 B je Bone.** ✅ Exakt wie R4.
✅ **R4-B3 bestätigt: Rotation steht VOR Translation** — dritte unabhängige
Quelle.

**Quirk (`:182-196`):** Bei `nBones == 0` legt KimeraCS trotzdem **einen**
Nullrotations-Bone an, damit die Zeichenkette nicht leerläuft.
Alle Winkel sind **float in Grad**, kein Festkomma. ✅ deckt sich mit der
R4-Messung (11 421 Winkel, 100 % ≤ 360°).

### 5.3 🔑 Die Zeichenkette für Feldmodelle — der wichtigste Abschnitt

`ModelDrawing.cs:795-850` (`DrawFieldSkeleton`), identisch in
`FF7FieldSkeleton.cs:250-300` (BoundingBox) und `ModelDrawing.cs:518-553`
(`MoveToFieldBone`).

**Wurzelrahmen, in dieser Reihenfolge:**

1. `translate(rootTranslationX, 0, 0)`
2. **`translate(0, −rootTranslationY, 0)`** ← **Y wird negiert**
3. `translate(0, 0, rootTranslationZ)`
4. Wurzelrotation als Matrix (YXZ, s. u.) **post**-multipliziert

⚠️ **Das negierte Y ist der bemerkenswerteste Einzelfund für R4.** R4 führt die
**waagerechten** Komponenten der Wurzeltranslation als 🟡 unbelegt und die
senkrechte als „mit B7 mitbelegt". KimeraCS sagt: **X und Z gehen unverändert
ein, Y kehrt das Vorzeichen um.** Battle macht das **nicht** (s. 6.3) — die
Asymmetrie ist also kein Versehen des Autors, sondern beschreibt eine echte
Konventionsdifferenz zwischen Field- und Battle-Raum.

**Bone-Schleife, je Bone in Dateireihenfolge:**

1. Solange `bone.joint_f != Stapelspitze` **und** `jsp > 0`: `popMatrix`, `jsp--`
2. `pushMatrix`
3. Rotationsmatrix aus (alpha, beta, gamma) post-multiplizieren
4. **Geometrie des Bones zeichnen** (an diesem Punkt, *vor* dem Versatz)
5. **`translate(0, 0, −bone.len)`**
6. `jsp++`, Stapelspitze := `bone.joint_i`

✅ **R4-B1 bestätigt:** Kindversatz **`−len`** entlang der **lokalen +Z-Achse**,
und zwar **nach** der Rotation angewandt (also entlang der *Eltern*-Achse aus
Sicht des Kindes) — genau die in R4 als richtig erkannte Konfiguration.
✅ **R4-B4 bestätigt:** Frames adressieren Bones **in Dateireihenfolge**
(`fFrame.rotations[iBoneIdx]` ↔ `fSkeleton.bones[iBoneIdx]`). Die Hierarchie
entsteht **allein aus dem Namensstapel**, nicht aus der Indexreihenfolge — die
Zuordnung Frame↔Bone ist also positionsbasiert, die Verschachtelung
namensbasiert. Auch KimeraCS unterscheidet damit **nicht** zwischen Datei- und
Tiefenreihenfolge, genau wie R4 einräumt.

Zur Kontrolle: die Bone-Achse wird als Linie von `(0,0,0)` nach `(0,0,−len)`
gezeichnet (`ModelDrawing.cs:645, 727`) — die Längsachse ist also **lokales
−Z**, nicht +Z. R4-B1 formuliert „Bone-Längsachse = lokales +Z" mit Versatz
`−len`; das ist dieselbe Aussage mit anderem Vorzeichenbezug, kein Widerspruch.

### 5.4 Rotationsmathematik — Eulerreihenfolge

`Utils.cs:101-182`

`BuildRotationMatrixWithQuaternions(alpha, beta, gamma)`:

1. `q_x` = Quaternion um Achse **(1,0,0)** mit Winkel **alpha**
2. `q_y` = Quaternion um Achse **(0,1,0)** mit Winkel **beta**
3. `q_z` = Quaternion um Achse **(0,0,1)** mit Winkel **gamma**
4. `q = (q_y · q_x) · q_z`
5. Matrix daraus in **spaltenweiser** OpenGL-Anordnung (`:142-143`), per
   `glMultMatrixd` **post**-multipliziert

⇒ Der lokale Transform ist **R = R_y · R_x · R_z**, angewandt als
`v' = R_y(R_x(R_z v))`. Das ist **exakt Three.js-`'YXZ'`**.

✅ **R4-B2 (YXZ) durch eine dritte unabhängige Quelle bestätigt.** Zuordnung:
**alpha ↔ X, beta ↔ Y, gamma ↔ Z**.

Winkel sind **Grad**: `PIOVER180 = π/180` wird beim Quaternionbau angewandt
(`Utils.cs:82, 104`). ✅

Die gleichwertige Fixed-Function-Schreibweise steht in
`ModelDrawing.cs:534-536`: `glRotate(beta,Y)`, dann `glRotate(alpha,X)`, dann
`glRotate(gamma,Z)` — dieselbe YXZ-Verkettung.

**Kein zusätzlicher Wurzel-Pitch.** KimeraCS setzt **weder 180° noch −90°** an
die Wurzel. Der Autor zeichnet einfach mit einer Kamera, die zum
FF7-Koordinatensystem passt (`gluPerspective(60, …, 0.1, 10000)`,
`FF7FieldSkeleton.cs:522`), und kennt keinen Basiswechsel.
👉 **Das ist die Auflösung des R4-Rätsels um `ROOT_FRAME_FIX_DEG`:** Der
Zusatzwinkel ist **keine Eigenschaft der Datei**, sondern die Differenz
zwischen FF7s Achsen und der Szenenbasis der jeweiligen Pipeline. R4 hat das
mit „C = Rx(−90°)" bereits algebraisch hergeleitet; KimeraCS bestätigt es
negativ, indem es ohne Basiswechsel **auch ohne Zusatzwinkel** auskommt.
Kujatas 180° gehört analog zu dessen glTF-Basis.

**Weitere Nebenfunktionen** (für Vollständigkeit, nicht für den Renderpfad):
`BuildRotationMatrixWithQuaternionsXYZ` (`Utils.cs:250-270`, `q_x·q_y·q_z`) wird
**nur für Editor-Transformationen** einzelner Gruppen benutzt
(`ModelDrawing.cs:403`), nicht für Bones. `GetQuaternionFromEulerUniversal`
(`:272 ff.`) ist eine ungenutzte Shoemake-Portierung.

---

## 6. Battle-Modelle

### 6.1 Skelettdatei (`??AA`) — Kopf 52 B

`FF7BattleSkeleton.cs:36-51` (Struktur), `91-105` (Leser)

| Offset | Feld | Bedeutung |
|---|---|---|
| 0x00 | `skeletonType` | **0 = Gegner, 1 = Kampfschauplatz, 2 = Spielerfigur** |
| 0x04 | `unk1` | „immer 1?" |
| 0x08 | `unk2` | „immer 1?" |
| 0x0C | **`nBones`** | **0 ⇒ die Datei ist ein Kampfschauplatz** (`:111`) |
| 0x10 | `unk3` | „immer 0?" |
| 0x14 | `nJoints` | bei Schauplätzen die Anzahl der Teilstücke |
| 0x18 | `nTextures` | |
| 0x1C | `nsSkeletonAnims` | Anzahl Skelettanimationen |
| 0x20 | `unk4` | „Anzahl Skelettanimationen + 2?" |
| 0x24 | `nWeapons` | |
| 0x28 | `nsWeaponsAnims` | |
| 0x2C | `unk5` | „immer 0?" |
| 0x30 | `unk6` | „globale Länge?" |

**Summe 0x34 = 52 B.** Danach folgen `nBones` Bone-Sätze.

### 6.2 Bone-Satz — 12 B

`FF7BattleSkeleton.cs:326-357`

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | i32 | `parentBone` — **Index**, Wurzel = −1 (Stapelinitialisierung `ModelDrawing.cs:864`) |
| 0x04 | f32 | `len` |
| 0x08 | i32 | `hasModel` — ≠ 0 ⇒ es gibt eine zugehörige `.p`-Datei |

Der Dateiname der Geometrie steht **nicht** im Satz; er wird aus der Position
im Bone-Array errechnet (s. 6.4).

### 6.3 Zeichenkette Battle — die Unterschiede zu Field

`ModelDrawing.cs:858-925` (`MoveToBattleBone`)

| Aspekt | **Field** | **Battle** |
|---|---|---|
| Hierarchie | Namensstapel `joint_i`/`joint_f` | **Elternindex** `parentBone`, Wurzel −1 |
| Wurzeltranslation | `(X, **−Y**, Z)` | `(startX, startY, startZ)` — **kein Vorzeichenwechsel** |
| Wurzelrotation | Frame-Wurzelfelder | **`bones[0]`** des Frames ist die Wurzeltransformation |
| Bone-Index im Frame | `rotations[i]` ↔ `bones[i]` | **`frame.bones[i + 1]`** ↔ `skeleton.bones[i]`, wenn `nBones > 1`; sonst Versatz 0 (`:868-869`) |
| **Kindversatz** | **`translate(0, 0, −len)`** | **`translate(0, 0, +len)`** ← **Vorzeichen invertiert** (`:897`) |
| Winkelquelle | f32 Grad | 12-Bit-Festkomma, entpackt (s. 6.5) |
| Eulerreihenfolge | YXZ | **YXZ, identisch** (dieselbe Funktion, `:874, 892`) |

✅ **Bestätigt die in R4 notierte Field/Battle-Asymmetrie beim Versatz.** Neu
ist, dass **auch die Wurzeltranslation** asymmetrisch ist (Y-Negierung nur im
Field) und dass Battle die Wurzelrotation **als Bone 0 des Frames** führt statt
in eigenen Kopffeldern.

Hilfspunkte auf dem Bone: Mitte = `+len/2`, Ende = `+len`
(`ModelDrawing.cs:926-945`) — konsistent mit dem `+len`-Versatz.

### 6.4 Dateinamensschema in `battle.lgp`

`FF7BattleSkeleton.cs:108-228`

Basis = die **ersten zwei Zeichen** des Skelettdateinamens (`aa`, `ab`, …).
Angehängt werden zwei weitere Zeichen, die ein **Alphabet-Zählwerk** bilden:
Das zweite Zeichen läuft; überschreitet es `Z`, springt es auf `A` zurück und
das erste Zeichen wird inkrementiert (`:121-125`, `:155-159`).

| Gegenstand | Startsuffix | Bildung |
|---|---|---|
| Skelett | `AA` | die Datei selbst |
| **Texturen** | **`AC`** | `nTextures` Stück ab `AC`, aufsteigend (`:208-215`) |
| **Körperteile (Bones)** | **`AM`** | ein Teil je Bone ab `AM`, mit Überlauf `AZ`→`BA` (`:151-167`) |
| **Waffen** | **`CK`** | `nWeapons` Stück ab `CK` (`:170-176`) |
| Schauplatz-Teilstücke | **`AM`** | wie Körperteile, `nJoints` Stück (`:116-142`) |

⚠️ Der Texturbereich `AC…` und der Körperteilbereich `AM…` **kollidieren**,
sobald `nTextures > 10` ist. Die Referenz behandelt das nicht — vermutlich tritt
es in Vanilla nicht auf. Für `render-battle` als Prüfbedingung notieren.

Für **`magic.lgp`** gibt es einen zweiten Konstruktor (`:236 ff.`): Basisname
ist der Dateiname **ohne `.D`-Endung**, Texturen tragen eigene Suffixe.

**Kampfschauplätze** (`nBones == 0`) haben **keine Bone-Sätze** in der Datei.
KimeraCS erzeugt je Teilstück einen synthetischen Bone mit
`parentBone = laufender Index`, `hasModel = 1` und
**`len = Durchmesser(BoundingBox) / 2`** (`:365-380`) — reine Editor-Erfindung,
**kein Formatfakt**.

### 6.5 Battle-Animation — der komprimierte Bitstrom

`FF7BattleAnimation.cs:69-166` (Kopf), `172-296` (Entpacker)

**Kopf, 12 B:**

| Offset | Typ | Feld | Kommentar der Referenz |
|---|---|---|---|
| 0x00 | i32 | `nBones` | *„Anzahl Bones + 1 (Wurzeltransformation). **Unzuverlässig**."* |
| 0x04 | i32 | `numFrames` | *„konservativ, meist **zu klein**"* |
| 0x08 | i32 | `blockSize` | Gesamtgröße des folgenden Blocks inkl. Kurzkopf und Auffüllung |

**Nur wenn `blockSize > 11`** folgt der Nutzblock:

| Offset | Typ | Feld |
|---|---|---|
| 0x0C | u16 | `numFramesShort` — *„meist **zu groß**"* |
| 0x0E | u16 | `blockSizeShort` — Länge des Bitstroms in Bytes |
| 0x10 | u8 | **`key`** — globaler Genauigkeitsschlüssel |
| 0x11 | `blockSizeShort` B | Bitstrom |
| … | `blockSize − blockSizeShort − 5` B | Auffüllung auf 4 B |

**Quirk mit Eigennamen** (`:118-127`): Bei den Vanilla-Animationen **`RSAA`/`RSDA`
(Frosch-Gegner, Frame 14)** fehlt `numFramesShort`. Erkannt wird das daran, dass
`blockSize − 5` gleich dem ersten u16 ist; dann gilt dieses u16 als
`blockSizeShort`, `blockSize` wird um 2 erhöht und `numFramesShort` aus
`numFrames` übernommen.

**Die wahre Framezahl steht nirgends.** Beide Zähler sind falsch; KimeraCS liest
Frames, bis der Bitstrom ausgeht, und korrigiert `numFramesShort` dann nach
unten (`:153-162`). 👉 Für `formats-model`: **Abbruch am Datenende ist Teil des
Formats**, nicht Fehlerbehandlung.

**Frame 0 — unkomprimiert** (`:331-355`):

| Größe | Inhalt |
|---|---|
| 3 × 16 Bit signed | `startX`, `startY`, `startZ` |
| je Bone: 3 × `(12 − key)` Bit signed | alpha, beta, gamma; anschließend **× 2^key** ⇒ 12-Bit-Rohwert |

**Folgeframes — deltakodiert** (`:236-296`):

*Translation*, je Achse: **1 Bit** wählt die Breite —
`0` ⇒ 7-Bit-Delta, `1` ⇒ 16-Bit-Delta; beide **signed**, addiert auf den Wert
des Vorframes.

*Rotation*, je Bone und Achse (`:172-215`):

1. **1 Bit**. Ist es 0 ⇒ **Delta 0** (Wert unverändert).
2. Sonst **3 Bit** `dLen`:

| `dLen` | Bedeutung |
|---|---|
| **0** | Delta = **−1** (kleinstmögliche Abnahme), keine weiteren Bits |
| **7** | **`(12 − key)` Bit signed** — „wie im ersten Frame", volle Genauigkeit |
| 1…6 | **`dLen` Bit signed**; danach wird der Betrag um **2^(dLen−1)** vergrößert (bei negativem Wert subtrahiert, bei positivem addiert) — eine Vorzeichen-Betrag-Aufspreizung, die den ungenutzten kleinen Wertebereich überspringt |

3. Ergebnis **× 2^key**.

*Akkumulation* (`:218-232`): Deltas summieren sich in einem **signed 16-Bit**
Akkumulator über die Frames. Negative Summen werden durch **`+ 0x1000`** in den
Bereich 0…4095 zurückgeholt (12-Bit-Wraparound).

*Winkelumrechnung* (`Utils.cs:1230-1239`): `Grad = roh / 2^(12 − key) × 360`.
Da der Rohwert oben bereits mit `2^key` skaliert wurde, wird die Funktion mit
`key = 0` gerufen ⇒ effektiv **`Grad = roh / 4096 × 360`**.
👉 **Die FF7-Winkeleinheit im Kampf ist 4096 Einheiten = 360°.** (Passt zur in
R4 notierten Festkommaeinheit 4096 aus dem Lichtblock.)

🔴 Der Bitleser `GetBitBlockVUnsigned` (`Utils.cs:1023-1084`) liest
**MSB-zuerst innerhalb des Bytes**, mit gesonderter Behandlung von
unausgerichtetem Anfang und Ende; `GetBitBlockV` (`:1131-1138`) hängt eine
Vorzeichenerweiterung an. Die Implementierung benutzt `Math.Pow` für
Zweierpotenzen und ist auf 16 Bit begrenzt (`ExtendSignInteger`, `:1086-1110`) —
**nicht portieren, nur die Bitreihenfolge übernehmen.**

### 6.6 Waffen

**Es gibt keinen Anbindungspunkt in den Daten.** Die Waffen-`.p` wird über den
Namen geladen (`??CK` …), aber *wo* sie sitzt, bestimmt der Anwender: Laut
`doc/readme.txt:53-61` gibt es einen Knopf „Compute Attached weapon position",
mit dem man den Ziel-Bone (Mitte oder Ende) **per Maus** wählt. Beim Zeichnen
werden nur `reposition*`/`rotate*`/`resize*` des Waffenmodells angewandt
(`ModelDrawing.cs:1259-1267`) — allesamt **Editor-Felder**, keine Dateidaten.
Zusätzlich gibt es einen eigenen Satz **Waffenanimationen**
(`bAnimationsPack.WeaponAnimations`, `:1421-1440`) mit eigenem Frameindex.
👉 Die Anbindung ist in FF7 vermutlich **hartkodiert in der Engine**, nicht in
`battle.lgp`. Das ist eine offene Frage, keine Antwort.

---

## 7. Sonstige Beobachtungen zum Renderpfad

`ModelDrawing.cs:114-183` (`DrawGroup`)

- Gezeichnet wird als `GL_TRIANGLES`, `GL_COLOR_MATERIAL` mit
  `GL_AMBIENT_AND_DIFFUSE` (`:127, 217`).
- **Vertexfarben werden immer gesetzt** — auch bei texturierten Gruppen. Mit dem
  GL-Default `GL_MODULATE` heißt das: **Textur × Vertexfarbe**. Reine
  Texturfarbe gibt es nicht.
- **Halbtransparenz-Sonderfall (`:133-137`):** Ist `blend_mode == 0` **und**
  `shademode != 1` **und** das Modell **kein** Kampfschauplatz, wird der
  Vertexalpha auf **0,5** gesetzt statt 1,0. Zusammen mit dem
  `SRC_ALPHA`-Blending ist das die 50-%-Durchsichtigkeit des
  Average-Blendmodus. 👉 Relevant für `render-actor`: FF7s „Average" ist **nicht
  alphagesteuert**, sondern ein fester Halbewert.
- `Pcolors` (Polygonfarben) werden **eingelesen, aber nie gezeichnet** —
  KimeraCS nutzt ausschließlich `Vcolors`.
- Lichter (`Lighting.cs`) sind reine **Betrachterlichter** des Editors (bis zu
  vier Richtungslichter, Positionen aus dem Szenendurchmesser, feste Farben
  0,5/0,5/1,0/0,75). **Keine Aussage über FF7s Beleuchtung** — der 30-B-Lichtblock
  aus der Field-Sektion (R4-B10) kommt hier gar nicht vor.
- **Battle-Schauplatz-Hack (`:361-367`):** Endet der Modelldateiname auf `AO`,
  wird `glDepthFunc(GL_ALWAYS)` gesetzt, sonst `GL_LEQUAL`. Ein hartkodierter
  Zeichenreihenfolge-Kniff für ein bestimmtes Teilstück — **Symptom** dafür, dass
  FF7 im Kampf einen echten Z-Sort hat (`zSort`-Feld im Renderstate), den
  KimeraCS nicht nachbildet.

**Ladezeit-Reparaturen (Editor-Politik, keine Formatfakten):**

| Funktion | Wirkung | Zeile |
|---|---|---|
| `RepairGroups` | löscht Gruppen mit `numPoly == 0` **oder** `numVert == 0` | `FF7PModel.cs:1293-1310` |
| `RepairPolys` | löscht Polygone mit doppeltem Vertexindex (entartete Linien) und, in einem zweiten Durchgang, mit deckungsgleichen Koordinaten — **nach Rückfrage** | `:1312-1360` |
| `KillUnusedVertices` | entfernt unreferenzierte Vertices und zieht Indizes nach | `:1195 ff.` |
| `ComputeNormals`/`ComputeEdges` | **überschreiben** die Datei-Normalen und -Kanten bei jedem Laden | `:2017, 2116` |

👉 Der letzte Punkt ist wichtig für den Vergleich: **KimeraCS zeigt nicht die
Normalen der Datei an, sondern selbst berechnete.** Wer WebMidgars Schattierung
gegen einen KimeraCS-Screenshot prüft, vergleicht nicht dasselbe.

---

## 8. Top-Befunde für WebMidgar (gereiht)

| # | Befund | Paket | Verhältnis zu R4 |
|---|---|---|---|
| **1** | **Die V_*-Bitmaskentabelle (22 Flags) samt Delta-Semantik `field_C` = Maske / `field_8` = Wert** | `formats-model`, `render-actor`, `render-battle` | **Neu.** R4 führt die Renderstate-Blöcke als „bisher roh konserviert" und als offenen Schritt. Das ist die vollständige Auflösung. |
| **2** | **Wurzeltranslation im Field: X und Z unverändert, `Y` NEGIERT** — im Battle **nicht** | `render-actor` | **Schließt eine 🟡-Lücke.** R4 führt die waagerechten Komponenten als unbelegt; hier ist die Konvention benannt und die Y-Negierung ist überprüfbar. |
| **3** | **Battle-Animationsformat vollständig**: 12-B-Kopf, 5-B-Kurzkopf, Bitstrom; Delta-Kodierung mit 1+3 Bit, `dLen`-Sonderfälle 0 und 7, `× 2^key`, 12-Bit-Wrap, **4096 Einheiten = 360°** | `render-battle`, `formats-model` | **Neu.** Deckt einen Bereich ab, den R4 gar nicht behandelt. |
| **4** | **Battle-Dateinamensschema** (Skelett `AA`, Texturen ab `AC`, Körperteile ab `AM`, Waffen ab `CK`, Alphabet-Überlauf) | `render-battle`, `convert` | **Neu.** |
| **5** | **`texID` steht doppelt in der `.p`; FF7 benutzt den Wert aus dem Renderstate, nicht aus der Gruppe** | `formats-model`, `render-actor` | **Neu und folgenreich** — wir lesen vermutlich den Gruppenwert. |
| **6** | **UVs werden über `poly.Verts[i] + offsetTex` adressiert, Positionen über `+ offsetVert`** — zwei verschiedene Basisadressen, derselbe Index | `render-actor` | Präzisiert R4 („gruppenrelativ") um den zweiten Offset. |
| **7** | **`blend_mode == 0` erzwingt Vertexalpha 0,5**, unabhängig von den Farbdaten | `render-actor` | **Neu.** Erklärt FF7-Halbtransparenzen ohne Alphakanal. |
| **8** | **Windung: `glCullFace(GL_FRONT)` bei Default-`GL_CCW`** ⇒ sichtbar sind die im Uhrzeigersinn orientierten Dreiecke | `render-actor`, `render-battle` | **Neu**; R4 sagt zur Windung nichts. |
| **9** | **Der Wurzel-Zusatzwinkel ist keine Dateieigenschaft.** KimeraCS kommt ohne Basiswechsel **und** ohne Zusatzwinkel aus | `render-actor` | **Bestätigt R4s Algebra** und entwertet endgültig die Frage „180° oder −90°?" als Formatfrage. |
| **10** | **`.hrc`-Parser muss Kommentar-, Leer- und eingerückte Zeilen überspringen**, ohne sie zu zählen | `formats-model` | Präzisierung; R4 meldet 385/385, also vermutlich schon so umgesetzt. |
| **11** | **`.p`-BoundingBox ist nicht garantiert 28 B** (`magic/bari_a1`, `bari_a2`) | `formats-model` | Ergänzt R4 („28 B, 4180/4180 in `char.lgp`") um die Grenze für `magic.lgp`. |
| **12** | **`MAT=` und `GRP=` in `.rsd` sind tote Verweise** | `formats-model`, `modding` | **Neu**, spart Arbeit. |
| **13** | `polyType` 1/2/3 = untexturiert / texturiert+Normalen / texturiert ohne Normalen; `PPOLY_TAG2 = 0x0CFCEA00` | `formats-model`, `modding` | Neu (Schreibseite). |
| **14** | Battle-Animationszähler sind **beide falsch**; die echte Framezahl ergibt sich aus dem Datenende | `formats-model` | Neu. |

### Bestätigungen bestehender R4-Annahmen (unabhängige dritte Quelle)

| R4 | Beleg in KimeraCS |
|---|---|
| **B1** Kindversatz `−len` entlang Bone-Achse | `ModelDrawing.cs:538, 838` (Field) |
| **B2** Eulerreihenfolge **YXZ**, Grad | `Utils.cs:174-181` (q_y·q_x·q_z, post-multipliziert), `ModelDrawing.cs:534-536` |
| **B3** Wurzelrotation **vor** Wurzeltranslation im Frame | `FF7FieldAnimation.cs:168-174` |
| **B4** Frames adressieren Bones in Dateireihenfolge | `ModelDrawing.cs:828-832` |
| **B5** Palette **BGRA** | `FF7TEXTexture.cs:102` (Kommentar), `:244-246, 318` |
| **B6a** Vertexfarben **BGRA** | `FF7PModel.cs:506-511` |
| Layouts: `.p`-Kopf 128 B, Renderstate 100 B, Gruppe 56 B, Normalindex 4·n | Abschnitt 1 |
| `.tex`-Kopf 236 B, Farbschlüsselschalter bei **0x08** | Abschnitt 4.1 |
| `.a`-Kopf 36 B, Frame 24 B + 12 B/Bone, `rotationOrder` bei 0x0C..0x0E | Abschnitt 5 |
| Alt-Endungen PLY→`.p`, TIM→`.tex` | `FF7FieldRSDResource.cs:76, 121-123` |

### Widersprüche zu WebMidgar

| Punkt | KimeraCS | WebMidgar | Bewertung |
|---|---|---|---|
| **Transparenz (B9)** | Pixel**index** 0 + `ColorKeyFlag` ⇒ Alpha 0; **Palettenalpha ignoriert** | Palettenalpha, gemessen 695/695 konsistent zum Kopfschalter | **WebMidgar ist im Recht.** Die Faustregel entfernt messbar 7,7 % zu viel in 68 Dateien. KimeraCS hier **nicht** folgen. |
| **Byte 0x0F der `.a`** | heißt `unused` | R4 nennt es „`version`, 0 bzw. 1" | Namensfrage, folgenlos. Beide werten es nicht aus. |
| **`texID`-Quelle** | zeichnet mit dem **Gruppen**wert, obwohl der eigene Kommentar den **Renderstate**wert als den von FF7 benutzten nennt | vermutlich Gruppenwert | **KimeraCS widerspricht sich selbst.** Der Kommentar ist die bessere Quelle. |
| **Mehrpalettige `.tex`** | `paletteIndex` und ColorKey-Array werden gelesen, aber nie benutzt (immer Palette 0) | — | Keine Referenz verfügbar; offene Frage. |

---

## 9. Offene Fragen

1. **Wie bindet FF7 Waffen an Battle-Bones?** In `battle.lgp` steht es nicht;
   KimeraCS lässt den Anwender den Bone wählen. Vermutlich Engine-seitig
   hartkodiert oder in `.exe`/`kernel.bin` — Anschluss an
   `ROADMAP-S37-EXE-ANALYSE.md`.
2. **Wozu dient `paletteIndex` (0x D0) und das ColorKey-Array?** Beide werden
   gelesen und verworfen. Gibt es in `char.lgp` überhaupt Texturen mit
   `numPalettes > 1`? Messbar mit einer Realdaten-Probe.
3. **Bedeutung von `mirex_g` (0x38) und `off28`/`off2C`/`off3C` im `.p`-Kopf**
   sowie `off1C…off28` in der Gruppe. Niemand kennt sie.
4. **`unk1`…`unk6` im Battle-Skelettkopf.** Die Referenz vermutet
   „immer 1 / immer 0 / nsAnims + 2 / globale Länge" — alles mit Fragezeichen.
   Über `battle.lgp` messbar.
5. **Was macht `srcblend`/`destblend`/`alpharef`?** Die Felder existieren, sind
   D3D-Blendfaktoren, und **keine** bekannte Reimplementierung wertet sie aus.
   Wenn sie in den Daten variieren, fehlt allen etwas.
6. **Y-Negierung der Wurzeltranslation: Konvention oder Kompensation?** Sie
   könnte ein echtes Formatdatum sein oder KimeraCS' Ausgleich für seine
   Kamerablickrichtung. **Prüfbar an einer Animation mit deutlicher
   Vertikalbewegung** (Sprung, Treppe) — genau die waagerecht/senkrecht-Frage,
   die R4 als 🟡 offen führt.
7. **Kollidiert der Battle-Namensraum je?** Texturen ab `AC`, Körperteile ab
   `AM` — ab `nTextures > 10` überlappen sie. Über den Bestand auszählbar.
8. **Wie sortiert FF7 im Kampf nach Tiefe?** Das `zSort`-Feld ist als
   Laufzeitfeld markiert; KimeraCS braucht einen Dateinamens-Hack (`…AO`), um
   ein Teilstück richtig zu zeichnen. Der eigentliche Algorithmus fehlt.
9. **Sind `Pcolors` (Polygonfarben) irgendwo wirksam?** Sie stehen in jeder
   Datei, werden aber von keiner bekannten Implementierung gezeichnet.
