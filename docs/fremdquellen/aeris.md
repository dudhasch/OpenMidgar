# Aeris (LaZar00/Aeris) — Recherche-Notizen für WebMidgar

> Erstellt: 2026-08-10 · Quelle: `https://github.com/LaZar00/Aeris`, shallow clone (`--depth 1`),
> HEAD = `0dee53d316bb672fc59c9ab96395044088cc6303`, "Improved visuals … Code cleaning", 2023-04-24.
> Lokaler Klon: `C:\Users\timur\AppData\Local\Temp\claude\C--ff7-web\b414bdf9-1c92-4887-8d93-1c2edd9fa485\scratchpad\repos\Aeris`

---

## 0. LIZENZ — CLEAN-ROOM-WARNUNG (zuerst lesen)

| Punkt | Befund |
|---|---|
| Lizenzdatei | `LICENSE` = **GNU General Public License v3.0** (vollständiger FSF-Text, 35.823 Bytes) |
| Header in Quelldateien | **keine** per-File-Lizenzheader; nur die Repo-weite `LICENSE` |
| Sprache/Stack | C# / .NET Framework WinForms (`Aeris.csproj`, `Aeris.sln`) |
| Konsequenz | **GPL-3.0 ist strikt copyleft und inkompatibel mit einem permissiv lizenzierten WebMidgar.** Es darf **kein** Code, keine Codestruktur und keine wörtliche Übersetzung von C# nach TypeScript übernommen werden. |

**Zusätzliches Copyright-Risiko:** Das Repo enthält **echte FF7-Spieldaten** unter
`Aeris/fundamentals/fieldsfixes/*` — je Feld ein komprimiertes Feld (LZS) und eine `.dec`-Variante
(PC-uncompressed): `ealin_2`, `fr_e` (zwei Varianten), `fship_1`, `fship_12`, `gaiin_2`, `las2_3`,
`ncorel`, `shpin_3`. Ebenso `fundamentals/fr_e_fixresources/*.png` (aus Texturen gebaut) und
`section0.bin` (ein gepatchtes Feld-Skript-Sektionsimage). **Diese Dateien dürfen niemals in
`C:\ff7-web` landen** — weder als Fixture noch als Testdatei. Für Verifikation habe ich sie nur
gelesen (read-only, im Scratchpad).

**Als riskant zu betrachten (nicht wörtlich übernehmen):**
- `FieldIDs.cs` — 721 Zeilen `FieldID → FieldName`-Zuordnung (IDs 0x42…0x312). Fakten-Tabelle, aber
  aus dem Spiel abgeleitet; für WebMidgar **aus den eigenen Spieldaten regenerieren**, nicht kopieren.
- Alle `fundamentals/hashexceptions/*.txt` und `BITemplates/*.txt` — feldspezifische Hash-/Tile-Listen.
- Der komplette `SwizzleBase.cs`/`SwizzleHash.cs`-Heuristik-Apparat (GPL).

**Unbedenklich (Fakten über Dateiformate):** Offsets, Feldbreiten, Konstanten, Bitlayouts,
Wertebereiche, Reihenfolge-Regeln. Diese Notiz beschreibt sie in eigenen Worten.

---

## 1. Was das Tool tatsächlich ist

**Aeris FF7 Background Tool** — ein Windows-Desktop-Editor (+ CLI) ausschließlich für die
**Hintergründe (Backgrounds) von FF7-PC-Feldern**. Es ist **kein** Engine-Reimplement, kein
LGP-Tool und kein Skript-Editor.

Datenbasis: **einzelne, bereits aus `flevel.lgp` extrahierte und dekomprimierte Felddateien**
("PC Uncompressed Field"). Aeris kann `flevel.lgp` nicht öffnen und kann nicht komprimiert
schreiben — das steht explizit im README (Extraktion via Makou Reactor).

Berührte Formate:

| Format | Zugriff | Wo im Code |
|---|---|---|
| FF7 Field, PC uncompressed (Container + Sektionstabelle) | lesen **und** schreiben | `FileTools.cs` |
| Field **Sektion 4** (Paletten) | lesen + schreiben | `S4.cs` |
| Field **Sektion 9** (Background: Layer/Tiles/Texturseiten) | lesen + schreiben | `S9.cs` |
| Field Sektion 1 (Skript) | nur blindes Ersetzen durch `section0.bin` beim `fr_e`-Fix | `Repair_fr_e.cs` |
| Sektionen 2,3,5,6,7,8 | nur Byte-Passthrough beim Speichern | `FileTools.cs` |
| PNG (Import/Export von Texturen & „Base Images") | lesen/schreiben | `ImageTools.cs` |
| Microsoft **RIFF/PAL** (`.pal`) | Export + Import | `Palette.cs` |
| **GIMP**-Palette (`.gpl`-Text) | nur Export | `Palette.cs` |
| **FFNx**-Textur-Dumps (Dateinamen mit 64-bit-Hash) | lesen/schreiben (Datei-/Ordnerkonvention) | `SwizzleHash.cs`, `FileTools.cs` |
| Eigene Textformate: `<feld>_BI.txt`, `BITemplates/*.txt`, `hashexceptions/*.txt`, `tileseparation/*.txt` | lesen/schreiben | `SwizzleBase.cs`, `SwizzleHash.cs` |

CLI (`CommandLine.cs`): `-s` Swizzle Hash-Bilder, `-u` Unswizzle FFNx-Dump, `-d` alle Base Images
unswizzeln, `-b` Base Images zurück-swizzeln, `-x` alle Base-Texturen exportieren, `-v` verbose.

---

## 2. Container: PC-uncompressed Field

Belegt in `FileTools.Load_Field` / `Save_Field` / `Update_FieldHDR`; **von mir gegen echte `.dec`-Dateien
im Repo verifiziert** (siehe §8).

| Off | Typ | Bedeutung |
|---|---|---|
| 0x00 | u16 | „blank" (in allen Samples 0) |
| 0x02 | u32 | Anzahl Sektionen (immer 9) |
| 0x06 | u32 × n | Absolute Dateioffsets je Sektion |
| … | — | je Sektion: u32 `sectionSize`, dann `sectionSize` Bytes |
| EOF−14 | 14 Bytes ASCII | `FINAL FANTASY7` — laut Kommentar in `Load_Field` **nicht** in allen Feldern vorhanden; Aeris hängt ihn beim Speichern *immer* an |

- Erster Sektionsoffset ist konstant **0x2A** (= 2 + 4 + 9·4). `Update_FieldHDR` rechnet
  `offset[i] = offset[i-1] + size[i-1] + 4` — d. h. Sektionen liegen lückenlos hintereinander.
- Aeris-Index-Konvention: `fieldSection[3]` = Sektion 4 (Paletten), `fieldSection[8]` = Sektion 9
  (Background), `fieldSection[0]` = Skript.

---

## 3. Sektion 4 — Paletten (`S4.cs`)

| Off (in Sektionsdaten) | Typ | Bedeutung |
|---|---|---|
| 0x00 | u32 | Größe des Palettenblocks (in Samples identisch mit `sectionSize`) |
| 0x04 | u16 | `PalX` (Sample: 0) |
| 0x06 | u16 | `PalY` (Sample: 480) — VRAM-Koordinate der Palettenseite |
| 0x08 | u16 | Farben pro Palette (immer 256) |
| 0x0A | u16 | Anzahl Paletten |
| 0x0C | u16 × 256 × nPal | Farbeinträge |

**Farbformat (Paletten): 16 bit, `M B5 G5 R5`** — Bit 0–4 = Rot, 5–9 = Grün, 10–14 = Blau,
Bit 15 = Maske/„Special"-Flag. Umrechnung nach 8 bit über Multiplikation mit **COEF = 8**
(`Palette.cs`), d. h. 31 → 248, *nicht* 255. Rückrichtung: Division durch 8. Das ist verlustbehaftet
bzw. leicht zu dunkel — WebMidgar sollte stattdessen `(v<<3)|(v>>2)` verwenden, muss aber wissen,
dass Aeris-exportierte PNGs im ×8-Raster liegen.

Blockgröße-Formel: `12 + 512 · numPalettes` Bytes (verifiziert: 2572 = 12 + 512·5).

---

## 4. Sektion 9 — Background (`S9.cs`) — das Kernstück

### 4.1 Sektionskopf

| Off | Typ | Bedeutung |
|---|---|---|
| 0x00 | u16 | „zeroes" (Sample: 0) |
| 0x02 | u16 | von Aeris `usePaddles` genannt (Sample: 1) — Bedeutung ungeklärt |
| 0x04 | u8 | `activated` (Sample: 1) |
| 0x05 | 7 Bytes | ASCII `PALETTE` |
| 0x0C | 20 Bytes | **`pal_ignoreFirstPixel[20]`** — je Palettenindex ein Flag: 1 ⇒ Farbindex 0 dieser Palette wird beim Rendern als **voll transparent** behandelt |
| 0x20 | u32 | „palzeroes" (Sample: 0) |
| 0x24 | 4 Bytes | ASCII `BACK` |

Danach 4 Layer, dann `TEXTURE`-Block, dann ASCII `END`. Aeris prüft `END` als Integritätscheck.

### 4.2 Layer

- **Layer 0** hat **kein** `layerFlag`-Byte und ist immer vorhanden. Layer 1–3 beginnen jeweils mit
  1 Byte `layerFlag` (1 = Layer vorhanden, sonst folgt sofort der nächste Layer).
- Layer-Kopf: `u16 Width`, `u16 Height`, `u16 numTiles`, dann layer-spezifischer Rest:
  - Layer 0: `u16 depth`
  - Layer 1: **16 Bytes „unknown"** → siehe §4.5, *die entschlüssele ich unten*
  - Layer 2/3: 10 Bytes „unknown" (in allen Samples komplett 0)
- Danach `u16 blank`, `numTiles` × 52-Byte-Tile, `u16 blank2`.

Beobachtete Werte: Layer 0 hat feldspezifische Größe (z. B. 416×416, 528×272); Layer 1–3 sind
immer 640×480.

### 4.3 Tile-Record — **exakt 52 Bytes**

| Off | Typ | Name | Anmerkung |
|---|---|---|---|
| 0 | u16 | blank | |
| 2 | i16 | destX | vorzeichenbehaftet, Bildschirmkoordinate |
| 4 | i16 | destY | |
| 6 | 4 B | unknown1 | |
| 10 | u8 | sourceX | Vielfaches von 16, 0…240 |
| 11 | u8 | unknown2 | |
| 12 | u8 | sourceY | dito |
| 13 | u8 | unknown3 | |
| 14 | u8 | sourceX2 | Quelle für die *zweite* Texturseite |
| 15 | u8 | unknown4 | |
| 16 | u8 | sourceY2 | |
| 17 | u8 | unknown5 | |
| 18 | u16 | Width | 16 bei L0/L1, 32 bei L2/L3, teils 0 |
| 20 | u16 | Height | |
| 22 | u8 | paletteID | |
| 23 | u8 | unknown6 | |
| 24 | u16 | ID | Z-/Sublayer-ID, 0…4096 |
| 26 | u8 | param | 0…255, 0 = immer sichtbar |
| 27 | u8 | statePow2 | **Bitmaske: 1,2,4,…,128** |
| 28 | u8 | blending | nur 0 oder 1 |
| 29 | u8 | unknown7 | |
| 30 | u8 | BlendMode | 0…3 |
| 31 | u8 | unknown8 | |
| 32 | u8 | textureID | primäre Texturseite |
| 33 | u8 | unknown9 | |
| 34 | u8 | textureID2 | sekundäre Texturseite (Blend-Seite) |
| 35 | u8 | unknown10 | |
| 36 | u8 | depth | |
| 37 | u8 | unknown11 | |
| 38 | u32 | bigID | |
| 42 | u32 | sourceXBig | |
| 46 | u32 | sourceYBig | |
| 50 | u16 | blank2 | |

Wertebereichs-Validierung aus `TileEditor.cs`: `ID` ≤ 4096; `paletteID` < numPalettes;
`destX/destY` i16; `blending` ∈ {0,1}; `BlendMode` ∈ 0..3; `param`, `state` ≤ 255;
`textureID`/`textureID2` ≤ 42; `sourceX/Y/X2/Y2` ≤ 240 **und Vielfaches von 16**;
`bigID`/`sourceXBig`/`sourceYBig` ≥ 0.

**`state = log2(statePow2)`** (Aeris rundet `Math.Log(statePow2,2)`); `statePow2 == 0 ⇒ state = 0`.
Verifiziert: in `las2_3` kommen genau die Werte 0,1,2,4,8,16,32,64,128 vor.

**Layer-0-Quirk (Aeris-Korrektur):** Für Layer 0 werden `param` und `state` beim Laden **hart auf 0
gesetzt** — es gibt Felder, in denen dort `param = 2` steht, was laut Autor „nicht möglich" ist.

### 4.4 Texturblock

- ASCII `TEXTURE` (7 Bytes), dann **genau 42 Slots** (`MAX_NUM_TEXTURES = 42`), dann ASCII `END`.
- Je Slot: `u16 textureFlag`. Nur bei `flag == 1` folgen `u16 Size`, `u16 Depth` und die Pixeldaten.
  Bei `flag == 0` folgt sofort der nächste Slot.
- Pixeldaten sind **immer 256×256** (`TEXTURE_WIDTH/HEIGHT = 256`), zeilenweise:
  - `Depth < 2` ⇒ **1 Byte/Pixel** = Palettenindex ⇒ 0x10000 Bytes
  - `Depth ≥ 2` ⇒ **2 Byte/Pixel** = Direktfarbe ⇒ 0x20000 Bytes
- `Size` war in allen untersuchten Samples **0** — Aeris schreibt es unverändert zurück und benutzt es nie.

**Direktfarbe (Depth = 2) ist RGB565, nicht BGR555!** `Palette.Get16bitColor` liest
R = Bits 11–15, G = Bits 6–10, B = Bits 0–4 — also die oberen 5 Bit eines 6-Bit-Grüns; geschrieben
wird `R<<11 | G<<6 | B`. Das ist ein **anderes Bitlayout als in Sektion 4** und ein sehr leicht zu
übersehender Fallstrick. Zusätzlich: reines Schwarz (0,0,0) wird beim Lesen auf **Alpha 0**
abgebildet (Transparenz-Konvention), und beim Schreiben wird Alpha 0 zu 0x0000.

Beispiel `fr_e`: Layer 0 benutzt Texturseiten 26/27 mit `depth = 2` — das einzige mir untergekommene
Feld mit Direktfarb-Hintergrund im Sample-Satz.

### 4.5 ⭐ Die 16 „unbekannten" Bytes im Layer-1-Kopf — dekodiert

Aeris behandelt sie als Blackbox (`unknown16`). Meine Analyse der acht `.dec`-Felder ergibt:
Es sind **8 × u16 = 4 Paare `(ersteTexturseite, letzteTexturseite)`**, und die Paare korrespondieren
mit den **Blend-Modi**:

| Feld | Paare | Von Layer 1 tatsächlich benutzte Texturen |
|---|---|---|
| `ealin_2` | (1,3) (15,16) (26,27) (33,34) | BM0: 1,2 · BM1: tex2=15 |
| `fship_1`/`fship_12` | (0,2) (15,16) (26,27) (33,34) | BM0: 0,1 |
| `gaiin_2` | (2,5) (15,17) (26,27) (33,34) | BM0: 2,3,4 · BM1: tex2=15,16 |
| `las2_3` | (1,3) (15,19) (26,27) (33,34) | BM0: 0,1,2 (+tex2=24) · BM1: tex2=15,16,17,18 |
| `ncorel`, `shpin_3` | alle 0 | keine Blend-Tiles in L1 |

Ableitung (**neu / m. W. nicht standardmäßig dokumentiert**):

- Paar 0 = variabler Bereich der **opaken** Texturseiten dieses Layers.
- Paar 1 = **15…25** ⇒ additives Blending
- Paar 2 = **26…32** ⇒ subtraktives Blending
- Paar 3 = **33…41** ⇒ 25 %-additives Blending
- 15 + 11 + 7 + 9 = 42 = `MAX_NUM_TEXTURES` ✔

Das erklärt auch Aeris' überall verstreute Magic-Konstanten: `ZTexture > 0xE && ZTexture < 0x1A`
(= 15…25, „High15") markiert genau die additive Gruppe, und `textureID2 >= 0xF` schaltet auf die
Blend-Quelle um. **Die Texturseiten-Nummer kodiert also selbst die Blend-Gruppe.**

### 4.6 Blending-Semantik (Rendering)

`blending` (0/1) ist der *Schalter*, `BlendMode` (0–3) die *Formel* (`Palette.BlendColor`):

| BlendMode | Formel je Kanal |
|---|---|
| 0 (default) | `(bg + src) / 2` — 50 % Mittelwert |
| 1 | `min(255, bg + src)` — additiv |
| 2 | `max(0, bg − src)` — subtraktiv |
| 3 | `min(255, bg + src/4)` — 25 % additiv |

Zusatzregeln im Renderpfad:
- Ein Quellpixel wird übersprungen, wenn er **schwarz (0,0,0)** *oder* Alpha 0 ist
  (`Render_Tile` in `Palette.cs`). Schwarz ist damit de facto Transparenz.
- Bei `blending == 0` wird das Tile **hart kopiert** (kein Alpha-Compositing).
- Bei `blending == 1` gilt: BG-Pixel alpha 0 ⇒ Quellpixel direkt setzen; Quelle alpha 0 ⇒ BG behalten;
  sonst blenden (`DirectBitmap.Render_Tile` in `ImageTools.cs`).
- Palettenindex-Sonderfall: Ist die Palettenfarbe komplett 0/0/0/mask=0, wird sie durch **Farbe 0
  derselben Palette** ersetzt; ist `pal_ignoreFirstPixel[paletteID] == 1` und der Index 0, wird
  vollständig transparent gezeichnet.

### 4.7 Z-Ordnung / Sichtbarkeit (die Render-Regeln)

Aus `S9.Load_ZList` und `Render_S9Layers` — für `render-field` direkt relevant:

1. **Z-Wert je Tile:** `Z = 4096 − tile.ID`. **Ausnahme:** Layer 1 **und** `ID > 4000` **und**
   Texturseite > 14 ⇒ `Z = tile.ID` (die animierten/additiven Effekte kippen nach vorn).
2. **Sortierung zum Zeichnen:** `Z` aufsteigend, dann `bigID` **absteigend**.
3. Tiles mit `destX ≤ −2000` oder `destX ≥ 5000` sind „out of boundaries" und werden verworfen.
   Konkrete Beispiele aus den Kommentaren in `SwizzleBase.cs`: `blinst_2` (Tiles 640/641, destX 10000),
   `cos_btm` (626), `jtmpin2` (132/163/244/245), `md_e1` (Texturen 24–26 komplett unbenutzt),
   `nivinn_2` (480), `trnad_1` (Tile 0, destX −3184), `trnad_3` (Tile 0, destX −2616).
4. **Sublayer** existieren nur in Layer 1: nach Sortierung `(ZLayer, ZTileID)` bekommt jede neue
   `ID` eine fortlaufende Sublayer-Nummer. Layer 1 wird in der GUI pro Sublayer ein-/ausschaltbar.
5. **Sichtbarkeit:** Layer 0 immer. Layer 1: `param == 0` und Textur < 15 ⇒ immer sichtbar; sonst nur
   wenn Effekte aktiv und `(param, state)` als „an" markiert. Layer 2/3: nur wenn Effekte aktiv,
   dann `param == 0` immer, sonst `(param, state)`.
6. `param`/`state`-Modell: pro `param` werden `MinState`/`MaxState` über alle Layer-1..3-Tiles
   ermittelt; die „Basisdarstellung" eines Feldes (`Render_S9BaseLayer`) benutzt je `param` genau
   `state == MinState`.
7. **Tile-Kantenlänge nach Layer:** Layer 0/1 ⇒ 16×16, Layer 2/3 ⇒ 32×32 (Aeris leitet das aus der
   Layer-Nummer ab, **nicht** aus dem `Width`-Feld des Tiles — das ist teils 0).

### 4.8 Feld-spezifische Hacks (Symptome echter Engine-Verhalten)

`AssignZDepthToLayerAsPerFLEVEL` überschreibt für 19 Felder die `ID` (= Z) ganzer Layer, weil das
**Feldskript** den Layer-Z zur Laufzeit setzt. Tabelle (Feld → Layer → erzwungene ID):

| Feld | L2 | L3 |
|---|---|---|
| crater_1 | — | 3840 |
| del3 | — | 256 |
| hill, hill2 | — | 512 |
| junonr2 | 415 | 416 |
| junonl2 | 433 | 434 |
| junair | 8 | 16 |
| las1_1 | — | 3584 |
| loslake1 | — | 594 |
| trnad_3 | — | 4080 |
| trnad_4 | 4092 | — |
| ujunon2 | — | 4094 |
| ujunon3 | — | 4080 |
| woa_1 | 628 | — |
| woa_2 | 706 | 705 |
| woa_3 | 466 | 465 |
| zcoal_1 | — | 3840 |
| zcoal_3 | — | 4080 |
| ztruck | 3856 | 3600 |

⇒ **Für WebMidgar heißt das: der Layer-Z darf nicht rein aus Sektion 9 abgeleitet werden, das Skript
(Opcode „BGPDH"/Layer-Z-Setzer) muss ihn setzen können.** Aeris umgeht das mit einer Namensliste,
weil es das Skript nicht interpretiert.

Weitere Einzelfall-Korrekturen im Ladepfad:
- `bugin1`: `textureID2 > 42` ⇒ auf 15 zwingen (defekter Wert in den Originaldaten).
- `trnad_3`: in Layer 0 wird jedes `textureID2 != 0` auf 0 gezwungen.
- `whitein`: Bilder mit nur einem Tile werden verworfen, wenn komplett alpha.
- `blue_2`: zwei Effekte (Sonnenstrahlen + Wasserfunkeln) teilen sich Texture/Palette/Param/State/TileID
  und sind **nur manuell per Tile-Liste trennbar** — laut Autor das einzige Feld dieser Art.

---

## 5. Kollateral-Wissen: FFNx-Dumps & „Swizzling"

- **Swizzled** = wie im Feld gespeichert (256×256-Texturseite, Tiles gemischt).
  **Unswizzled** = zusammengesetztes Bildschirmbild (Tiles an ihre `destX/destY` gezeichnet).
- Dateinamenkonventionen (`FileTools.SplitFileNameAndCheckHash`):
  - Base (swizzled): `<feld>_<tex:00>_<pal:00>.png`
  - FFNx-Hash-Dump (swizzled): `<feld>_<tex>_<pal>_<hash16hex>.png`
  - Aeris-„treated" (unswizzled): `<feld>_<tex>_<pal>_<param:00>_<state:00>_<tileID:0000>.png`
  - Ordnerkonvention für Hash-Dumps: `…/<tex>_<pal>/<hash>/…`
  - **FFNx-Hash ist 64 bit / 16 Hexzeichen** (Aeris erkennt „hashed" schlicht daran, dass das letzte
    `_`-Segment ≥ 12 Zeichen lang ist).
- **Upscale-Faktor** wird nicht konfiguriert, sondern erschlossen:
  `scale = eingelesenesBild.Width / layerMaxWidth` — getrennt für die Layer-Gruppe 0/1 und 2/3.
- Aeris' interner `CreateHash_IDX_PAL` ist **nicht** der FFNx-Hash: er sammelt die benutzten Farben
  einer Textur in einer sortierten Menge, serialisiert deren Win32-Integer-Darstellung als **UTF-8-Text**
  und bildet darüber CRC32 (Poly 0x04C11DB7, reflected). Reines Aeris-internes Matching-Verfahren.
- Layer-Bounding-Box-Berechnung (`GetDrawLayersDimensions`): min/max über `destX/destY + tileSize`
  aller sichtbaren Layer, getrennt für L0/L1 und L2/L3, plus **16 px Rahmen** (`SIZE_BORDERFRAME`),
  Ursprung = `maxWidth/2 + shift` mit `shift = −(max − |min|)/2`.

### Eigene Textformate (nur zur Einordnung, nicht nachbauen)

- `BITemplates/<feld>.txt`: Zeilen `UniqueSublayerID=`, `JoinSublayerIDs=`, `High15ByPal=`,
  `Low15ByPal=`, `TileSeparation=`. Trenner: `,` zwischen Einträgen, `_` für `id_param_state`,
  `:` für „Haupt:Neben", `+` für Listen, `Layer:tile+tile+…` bei TileSeparation.
- `<feld>_BI.txt`: CSV mit `FileName, Layer, Param, State, High15ByPalette, Low15ByPalette,
  High15, UniqueSublayerID, DuplicateDest, DuplicateDestHigh15, DuplicateDestParam,
  DuplicateDestParamHigh15, JoinedTileIDs, TileSeparation`.
- `hashexceptions/<feld>.txt`: `hash, tex, pal, param, state, matchHash, firstTileID[, …]`;
  Präfix `&` = „Ziel-Textur/TileID ändern", `+` = „Hash-Addition", `!` = Tile-Separation.

---

## 6. Verifizierte Rohdaten (aus den mitgelieferten `.dec`-Feldern)

Alle Werte selbst geparst, nicht aus dem Code übernommen:

| Feld | Sektionsgrößen 1–9 | L0 | L1 | L2 | L3 | Texturen (flag=1) |
|---|---|---|---|---|---|---|
| `ealin_2` | 7876, 38, 1385, 2572, 1804, 0, 48, 740, 294627 | 416×416, 407 Tiles, depth 1 | 640×480, 214 | — | — | 0,1,2,15 (alle Depth 1, Size 0) |
| `fr_e` | — | 528×272, 300, **depth 2** | — | — | 640×480, 125 | Tex 26,27 direktfarbig |
| `fship_1` | — | 336×256, 152 | 640×480, 121 | 640×480, 160 | — | |
| `las2_3` | — | 528×368, 425 | 640×480, 1204 | — | — | param bis 16, state bis 128 |

Weitere Beobachtungen:
- Sektion 6 kann **Größe 0** haben (bei `ealin_2`) — Parser dürfen das nicht als Fehler werten.
- `pal_ignoreFirstPixel` hat 20 Slots, aber Felder haben oft weniger Paletten (z. B. `ealin_2`:
  5 Paletten, aber 16 gesetzte Flags). Die überzähligen Flags sind Müll/ungenutzt.
- Layer-0-Tiles haben durchgehend `ID = 4095` ⇒ `Z = 1` (ganz hinten).
  Layer-2/3-Tiles haben `ID = 4096` bzw. `0`.
- `.dec` ≈ 2,5–3,5× die Größe der LZS-komprimierten Felddatei.

---

## 7. Top-Erkenntnisse für WebMidgar (nach Nutzen sortiert)

| # | Erkenntnis | Zielpaket | Warum wertvoll |
|---|---|---|---|
| 1 | **Texturseiten-Nummer kodiert die Blend-Gruppe**: 0–14 opak, 15–25 additiv, 26–32 subtraktiv, 33–41 25 %-additiv (aus dem Layer-1-Kopf abgeleitet, §4.5) | `render-field`, `formats-field` | Erklärt die Effekt-Layer ohne Heuristik; erlaubt korrektes Batching/Sortieren der Effekt-Tiles |
| 2 | **Layer-1-Kopf: 16 Bytes = 4× (firstTex,lastTex)**, nicht „unknown" | `formats-field` | Schließt eine der letzten Lücken im Sektion-9-Layout; direkt verifizierbar |
| 3 | **Z-Regel `Z = 4096 − ID`, mit Ausnahme Layer 1 + ID>4000 + Tex>14 ⇒ `Z = ID`**; Tiebreak `bigID` absteigend | `render-field` | Reproduzierbare Zeichenreihenfolge ohne Trial-and-Error |
| 4 | **4 Blend-Formeln** (½·Summe / add / sub / add¼) + „Schwarz = transparent" + `pal_ignoreFirstPixel` | `render-field` | Exakte Pixel-Semantik inkl. der Transparenz-Sonderfälle |
| 5 | **`state = log2(statePow2)`**, `param`/`state` als Sichtbarkeits-Gate, `MinState` = Basiszustand | `field-runtime`, `interpreter` | Modell für Türen/Lichter/Animationen aus Sektion 9; verbindet Skript-Opcodes mit Tiles |
| 6 | **19 Felder brauchen skriptgesetzten Layer-Z** (Tabelle §4.8) | `interpreter`, `render-field` | Konkrete Regressionsliste: wenn WebMidgar diese Felder korrekt rendert, ist der Z-Pfad richtig |
| 7 | **Direktfarb-Texturen sind RGB565**, Paletten dagegen `M-B5-G5-R5` | `formats-field` | Klassischer Fehlerkandidat; zwei verschiedene 16-Bit-Layouts in derselben Sektion |
| 8 | **52-Byte-Tile-Layout inkl. `sourceX2/sourceY2/textureID2`** und die Regel „`textureID2 ≥ 15` ⇒ zweite Quelle benutzen" | `formats-field`, `render-field` | Vollständiges, feldverifiziertes Tile-Struct |
| 9 | **Container: `END`-Tag, `FINAL FANTASY7`-Trailer optional, Sektion 6 kann leer sein, Offsets ab 0x2A lückenlos** | `formats-field`, `convert` | Robuster Parser + korrekter Writer |
| 10 | **„Out of boundaries"-Tiles** (destX 10000 / −3184 / −2616) mit Feldliste | `render-field` | Sonst zerschossene Bounding-Box / riesige Canvas |
| 11 | **FFNx-Dump-Namens- und Ordnerkonvention** (64-bit-Hash, `<tex>_<pal>/<hash>/`) | `modding`, `pipeline` | Wenn WebMidgar HD-Texturpacks unterstützen soll |
| 12 | Layer-Bounding-Box-/Ursprungsberechnung inkl. 16-px-Rahmen, getrennt für L0/1 und L2/3 | `render-field` | Erklärt, warum L2/L3 (Parallax) eine eigene Bezugsfläche haben |
| 13 | `ID ≤ 4096`, `sourceX/Y ≤ 240` und 16er-Vielfache, `blending ∈ {0,1}`, `BlendMode ∈ 0..3` | `formats-field` (Validierung/Tests) | Fertige Invarianten für Property-Tests |

---

## 8. Methodik / Verifikationsprotokoll

- Repo geklont, alle 40 `.cs`-Dateien (~23.000 Zeilen) gesichtet; vollständig gelesen:
  `S4.cs`, `S9.cs`, `Palette.cs`, `FileTools.cs`, `HashCRC.cs`, `ImageTools.cs`, `Repair_fr_e.cs`,
  `CommandLine.cs` (Kopf), `TileEditor.cs` (Validierung), Auszüge aus `SwizzleBase.cs` (3358 Z.)
  und `SwizzleHash.cs` (3806 Z.).
- Alle Struktur-Aussagen gegen die acht im Repo liegenden `.dec`-Felder mit eigenen Python-Parsern
  gegengeprüft (Header, Sektionstabelle, S4-Kopf, alle 4 Layer, 52-Byte-Tiles, Texturblock, `END`,
  `FINAL FANTASY7`) — alle Sektionen gingen ohne Rest auf.
- Die Blend-Gruppen-Deutung aus §4.5 ist **meine Ableitung**, nicht Aeris' Aussage; sie ist über
  acht Felder konsistent, sollte aber gegen weitere Felder (v. a. mit Blendmode 2/3) validiert werden.

---

## 9. Offene Fragen

1. **`usePaddles` (u16 @0x02 der Sektion 9)** — Name stammt von Aeris, Bedeutung unbekannt; in allen
   Samples 1. Gegen ein Feld mit abweichendem Wert prüfen.
2. **Layer-2/3-„unknown10" (10 Bytes)** — in allen Samples 0. Vermutung: analoge Texturseiten-Paare,
   aber nur 5 u16 statt 8. Braucht ein Feld mit aktiven L2/L3-Blendeffekten (Kandidaten aus dem Code:
   `woa_3` für Layer 2, `anfrst_1` für Layer 3).
3. **`Size` im Texturkopf** — in allen Samples 0. Wozu? (VRAM-Byte-Größe? Immer ungenutzt?)
4. **`bigID`, `sourceXBig`, `sourceYBig` (3× u32)** — Aeris speichert und validiert sie, nutzt `bigID`
   nur als Tiebreak beim Sortieren. Vermutung: PSX-„große" Tile-Variante bzw. 32×32-Quellkoordinaten.
   In Layer 0/2/3 der Samples durchgehend 0, in Layer 1 aber siebenstellig — verdächtig nach
   gepacktem Feld (Koordinaten + Flags?). **Lohnendes Reverse-Engineering-Ziel.**
5. **Paar 2/3 (26–32, 33–41)** — kein Sample nutzt sie. Werden subtraktives und 25 %-additives
   Blending im Original überhaupt verwendet? (`fr_e` benutzt 26/27 mit BlendMode 0 in Layer 0 —
   passt nicht zur Hypothese und ist zugleich das Feld, das Aeris als „kaputt" repariert.)
6. **`pal_ignoreFirstPixel` mit 20 Slots** bei bis zu wie vielen Paletten? Gibt es Felder mit > 20?
7. **`depth` je Tile (Off 36)** vs. `Depth` je Texturseite — Aeris liest den Tile-Wert, nutzt aber für
   die Pixelinterpretation nur den Texturseiten-Wert (`ImportTexture` schaut allerdings auf
   `layerTiles[0].depth`). Welcher ist maßgeblich?
8. **Sektion 6 mit Größe 0** — offiziell was? (`ealin_2`)
9. Aeris' `COEF = 8` erzeugt max. 248 statt 255. Wie skaliert die Original-Engine 5→8 Bit
   (Bit-Replikation oder ×8)? Für pixelgenaue Vergleiche mit Referenzbildern relevant.
