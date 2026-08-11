# FF7 Scarlet — Reverse-Engineering-Notizen (Clean-Room)

**Quelle:** https://github.com/petfriendamy/ff7-scarlet — shallow clone unter
`…/scratchpad/repos/ff7-scarlet`, Stand: Klon vom 2026-08-10.

---

## 0. LIZENZ — ZUERST LESEN

**Microsoft Public License (MS-PL)** — `LICENSE.txt:2`.

Relevante Bedingungen für WebMidgar:

| Klausel | Inhalt | Konsequenz |
|---|---|---|
| §2(A) | Copyright-Grant: reproduzieren, Derivate, verteilen | erlaubt, **aber** |
| §3(C) | Bei Verteilung *jeglichen Teils* müssen alle Copyright-/Attribution-Hinweise erhalten bleiben | Übernommener Code müsste Notices mitführen |
| §3(D) | Quellcode-Verteilung **nur unter MS-PL** (vollständige Lizenzkopie beilegen) | **Copyleft-artig auf Datei-/Snippet-Ebene** |

**Folgerung für das Clean-Room-Verfahren:** MS-PL ist *nicht* mit einer freien Wahl der
WebMidgar-Lizenz kompatibel, wenn Code übernommen wird. → **Kein Quellcode aus diesem Repo
kopieren.** Alles unten sind *Beschreibungen von Dateiformaten und Zahlenwerten* (nicht
urheberrechtsfähige Fakten über ein Drittprodukt, nämlich FF7 selbst), mit Zitaten
`pfad/Datei.cs:Zeile` nur als Herkunftsnachweis.

**Zusätzliche Sonderfälle im Repo (nicht anfassen):**

- `src/Compression/Lzs.cs:1-4` — expliziter Header: MS-PL, Originalautor **Iros**. Der
  Algorithmus selbst ist der klassische LZSS von Haruhiko Okumura (Public Domain,
  1989) — die *Beschreibung* unten reicht für eine Eigenimplementierung.
- `src/KimeraCS/**` — portierter Code aus **Kimera** (VB6, Borde/qhimm-Community).
  Enthält die Battle-Model-/Animationslogik. Herkunft unklar dokumentiert →
  **maximale Vorsicht**, nur Formatbeschreibung übernehmen.
- `src/Compression/Gzip.cs:69` — Hinweis „based on code from SegaChief".
- Externe NuGet-Abhängigkeit **`Shojy.FF7.Elena` 0.10.0** (`src/FF7Scarlet.csproj`).
  Die Enums `Statuses`, `Elements`, `TargetData`, `SpecialEffects`, `MateriaElements`,
  `EquipmentStatus`, `Restrictions`, `EquipableBy` liegen **dort**, nicht im Repo.
  Die Bit-Reihenfolgen unten sind aus Scarlets UI-Reihenfolge *abgeleitet* → siehe
  „Offene Fragen".

**RISKANT WÖRTLICH ZU ÜBERNEHMEN (nicht tun):**
`Opcodes.cs`, `OpcodeInfo.cs` (Opcode-Tabelle als Datenstruktur), `CommonVars.cs`
(Variablen-Enums), `DamageCalculationInfo.cs`, `AdditionalEffects.cs`,
`LocationInfo.cs`. Die *Werte* sind FF7-Fakten und dürfen neu tabelliert werden; die
konkrete C#-Formulierung nicht.

---

## 1. Überblick über das Repo

.NET 10 WinForms-Editor, ~35.000 Zeilen C#, `src/`:

| Verzeichnis | Inhalt | Für WebMidgar relevant |
|---|---|---|
| `SceneEditor/` | scene.bin: Gegner, Angriffe, Formationen, Kamera | **sehr hoch** → `formats-battle` |
| `AIEditor/` | Battle-AI-VM: Opcodes, Disassembler, Compiler | **sehr hoch** → `interpreter`, `battle-runtime` |
| `KernelEditor/` | kernel.bin/kernel2.bin, Schadensformeln | **sehr hoch** → `formats-kernel` |
| `Compression/` | gzip-Blockpacking, LZS | **hoch** → `formats-battle` |
| `Shared/` | Attack-Record, Bitfelder, Hex-/Text-Parser | **sehr hoch** |
| `KimeraCS/` | Battle-Skelett, Animationen, P-Modelle, TEX | **mittel** → `render-battle` |
| `ExeEditor/` | ff7.exe-Patching (Shops, Limits, Text, Audio) | gering |

---

## 2. scene.bin — Container & Blockpacking

Referenz: `src/Compression/Gzip.cs:87-273`, `src/SceneEditor/Scene.cs:12-15`.

### 2.1 Konstanten

| Konstante | Wert | Bedeutung |
|---|---|---|
| `SCENE_COUNT` | 256 | Szenen gesamt in scene.bin |
| `COMPRESSED_BLOCK_SIZE` | `0x2000` (8192) | fixe Blockgröße |
| `UNCOMPRESSED_BLOCK_SIZE` | 7808 (`0x1E80`) | dekomprimierte Szenengröße, **exakt** |
| `HEADER_COUNT` | 16 | Header-Einträge pro Block |
| `BLOCK_COUNT` | 64 | max. Blöcke |

### 2.2 Blocklayout

```
Offset 0x0000: 16 × uint32  Offset-Tabelle
Offset 0x0040: gzip-Stream #0
               gzip-Stream #1
               …
               0xFF-Padding bis 0x2000
```

- Tabelleneintrag = **Offset / 4** (Wort-Adressierung). `0xFFFFFFFF` = kein Eintrag.
  (`Gzip.cs:118` — `sceneOffset = currHeader * 4`)
- Größe eines Streams = `(nextHeader − currHeader) * 4`; beim letzten belegten
  Eintrag = `0x2000 − currHeader*4` (`Gzip.cs:119-126`).
- Jeder komprimierte Stream wird beim Schreiben mit `0xFF` auf ein **Vielfaches von 4**
  aufgefüllt (`Gzip.cs:176-182`).
- Block wird mit `0xFF` auf `0x2000` aufgefüllt (`Gzip.cs:237-240`).
- Blöcke werden **greedy** gefüllt: solange `16*4 + Σ komprimierte Größen < 0x2000`
  (`Gzip.cs:188-210`). Die Anzahl Szenen pro Block ist damit **variabel** (nicht fix 16).

### 2.3 Kompression

Standard-**gzip** (RFC 1952, mit Wrapper), `System.IO.Compression.GZipStream`
(`Gzip.cs:77`, `Gzip.cs:281`). Beim Schreiben optional Zopfli im
`ZOPFLI_FORMAT_GZIP` (`Gzip.cs:291`). → In TypeScript: `DecompressionStream('gzip')`
bzw. `fflate.gunzipSync`. Kein Sonderfall, kein raw-deflate.

### 2.4 Scene-Lookup-Table

64 Bytes, liegt in **kernel.bin, Sektion 3 (Battle & Growth)** — nicht in scene.bin.
Index = Blocknummer, Wert = ID der **ersten Szene** in diesem Block; `0xFF` = ungenutzt
(`Gzip.cs:145-160`, `Kernel.cs:1403`, `Kernel.cs:282-292`). **Wichtig:** Weil die
Blockbelegung variabel ist, ist diese Tabelle zum Auffinden einer Szene *zwingend*.

---

## 3. scene.bin — dekomprimierter Szenenblock (7808 Bytes)

Rekonstruiert aus `src/SceneEditor/Scene.cs:342-469` (Lesereihenfolge) und
`Scene.cs:673-836` (Schreibreihenfolge). Alle Werte **Little-Endian**.

| Offset | Größe | Feld |
|---|---|---|
| `0x0000` | 3×2 | Enemy-Model-IDs (uint16; `0xFFFF` = leer) |
| `0x0006` | 2 | Padding (`0xFFFF`) |
| `0x0008` | 4×20 = 80 | Battle-Setup-Data, 4 Formationen |
| `0x0058` | 4×48 = 192 | Camera-Placement-Data, 4 Formationen |
| `0x0118` | 4×6×16 = 384 | Enemy-Locations, 4 Formationen × 6 Slots |
| `0x0298` | 3×184 = 552 | Enemy-Records (je 32 Byte Name + 152 Byte Daten) |
| `0x04C0` | 32×28 = 896 | Attack-Records |
| `0x0840` | 32×2 = 64 | Attack-IDs (uint16; `0xFFFF` = Slot leer) |
| `0x0880` | 32×32 = 1024 | Attack-Namen (FF7-Text, `0xFF`-terminiert) |
| `0x0C80` | 4×2 = 8 | Formation-AI-Offsets |
| `0x0C88` | 504 | Formation-AI-Block |
| `0x0E80` | 3×2 = 6 | Enemy-AI-Offsets |
| `0x0E86` | 4090 | Enemy-AI-Block |
| = | **7808** | |

Restbytes werden mit `0xFF` gefüllt (`Scene.cs:808-825`).

**Japanische Originalversion:** Enemy-Namen sind nur **16** statt 32 Byte lang
(`Scene.cs:391-392`) und der Formation-AI-Block fehlt (`Scene.cs:449-457`) — Layout
verschiebt sich entsprechend. Flag für Regionalerkennung.

### 3.1 Battle-Setup-Data (20 Byte)

`src/SceneEditor/BattleSetupData.cs:29-46`

| Off | Typ | Feld |
|---|---|---|
| `0x00` | u16 | Location-ID (Battle-Background, siehe §3.6) |
| `0x02` | u16 | Next-Scene-ID / Folgeformation (`0xFFFF` = keine) |
| `0x04` | u16 | Escape-Counter |
| `0x06` | u16 | Padding (`0xFFFF`) |
| `0x08` | 4×u16 | Battle-Arena-Formation-IDs |
| `0x10` | u16 | **BattleFlags, invertiert gespeichert** (`~`) |
| `0x12` | u8 | BattleType |
| `0x13` | u8 | Pre-Battle-Camera-Position |

**BattleFlags** (`BattleFlags.cs:3-11`), *nach* Invertierung:
`0x02` unbekannt · `0x04` CantEscape · `0x08` NoVictoryPoses · `0x10` NoPreemptive.
Bits 0 und 5–15 in Scarlet unbenannt.

**BattleType** (`BattleType.cs:3-15`):
`0` Normal · `1` Preemptive · `2` BackAttack · `3` SideAttack1 · `4` Pincer1 ·
`5` Pincer2 · `6` SideAttack2 · `7` SideAttack3 · `8` FrontRowOnly.

### 3.2 Camera-Placement-Data (48 Byte)

`src/SceneEditor/CameraPlacementData.cs:38-57`

4 Kamera-Slots à 12 Byte, jeweils **Position (x,y,z als int16)** unmittelbar gefolgt von
**Blickrichtung/Target (x,y,z als int16)** — *interleaved*, nicht als zwei getrennte
Arrays. `-1` (`0xFFFF`) ist der Null-Sentinel.

```
Slot n (n=0..3):  [posX i16][posY i16][posZ i16][dirX i16][dirY i16][dirZ i16]
```

Der Formation-3D-Editor rendert mit `SCENE_SCALE = 2.5f`
(`SceneEditor/Formation3DEditorForm.cs:27`) — reiner Anzeige-Faktor, keine Formatangabe.

### 3.3 Enemy-Location (16 Byte, 6 Slots pro Formation)

`src/SceneEditor/EnemyLocation.cs:26-43`

| Off | Typ | Feld |
|---|---|---|
| `0x00` | u16 | Enemy-ID (= Model-ID; `0xFFFF` = leer) |
| `0x02` | i16 | X |
| `0x04` | i16 | Y |
| `0x06` | i16 | Z |
| `0x08` | u16 | Row |
| `0x0A` | u16 | Cover-Flags (16 Einzelbits, `CoverFlagsControl.cs:5`) |
| `0x0C` | u32 | Initial-Condition-Flags (**nicht** invertiert) |

**InitialConditions** (`InitialConditions.cs:3-12`):
`0x01` Visible · `0x02` LeftSide · `0x04` unbekannt · `0x08` Targetable ·
`0x10` MainScriptActive.

### 3.4 Enemy-Record (152 Byte Daten, davor 32 Byte Name)

`src/SceneEditor/Enemy.cs:131-209` (lesen) / `Enemy.cs:232-324` (schreiben).
Offsets relativ zum Beginn des 152-Byte-Datenblocks.

| Off | Typ | Feld |
|---|---|---|
| `0x00` | u8 | Level |
| `0x01` | u8 | Speed |
| `0x02` | u8 | Luck |
| `0x03` | u8 | Evade |
| `0x04` | u8 | Strength |
| `0x05` | u8 | Defense |
| `0x06` | u8 | Magic |
| `0x07` | u8 | MDef |
| `0x08` | 8×u8 | Resistance-**IDs** (Element- bzw. Status-Kennung) |
| `0x10` | 8×u8 | Resistance-**Rates** (parallel zum vorigen Array) |
| `0x18` | 16×u8 | Action-Animation-Indices (pro Angriffs-Slot) |
| `0x28` | 16×u16 | Attack-IDs |
| `0x48` | 16×u16 | Camera-Movement-IDs (pro Angriffs-Slot) |
| `0x68` | 4×u8 | Drop-/Steal-Rates |
| `0x6C` | 4×u16 | Item-IDs (kombinierter Item-Index, siehe §5.7) |
| `0x74` | 3×u16 | Manipulate-Attack-IDs |
| `0x7A` | u16 | **unbekannt** (Scarlet liest/schreibt es nur durch) |
| `0x7C` | u16 | MP |
| `0x7E` | u16 | AP (Belohnung) |
| `0x80` | u16 | Morph-Item-Index |
| `0x82` | u8 | Back-Attack-Multiplier |
| `0x83` | u8 | Padding (`0xFF`) |
| `0x84` | u32 | HP |
| `0x88` | u32 | EXP |
| `0x8C` | u32 | Gil |
| `0x90` | u32 | **Status-Immunities, invertiert gespeichert** (`~`) |
| `0x94` | u32 | wird als `0xFFFFFFFF` geschrieben, **beim Lesen ignoriert** → unbekanntes Feld |

**Resistance-Kodierung** (`Enemy.cs:146-165`, `ResistanceRate.cs`):

- ID-Byte `0xFF` **und** Rate `0xFF` → Slot leer.
- ID `< 0x10` → **Element**-Resistenz, Wert = `MateriaElements`-Index.
- ID `≥ 0x10` → **Status**-Resistenz, Statuswert = `ID − 0x20` (`Enemy.cs:163`,
  `ResistanceRate.cs:73`). ⚠️ Der Test ist `< 0x10`, der Offset aber `0x20` — IDs im
  Bereich `0x10..0x1F` ergeben negative Statuswerte. **Quirk / potenzieller Bug.**
- **Rate-Werte** (`ResistanceRate.cs:8`): `0` Death (tötet) · `1` NeverMiss ·
  `2` Double · `4` Half · `5` Null · `6` Absorb · `7` FullCure.
  ⚠️ **Wert `3` ist unbelegt** — Lücke im Enum, in Scarlet nicht erklärt.

**Drop-/Steal-Kodierung** (`ItemDropRate.cs:31-49`):
Byte `> 0x80` → **Steal**, Rate = `Byte − 0x80`; sonst **Drop** mit dieser Rate.
⚠️ Genau `0x80` fällt in den Drop-Zweig (strikt größer) — Grenzfall-Quirk.
Leer, wenn Rate-Byte `0xFF` **und** Item-ID `0xFFFF`.

### 3.5 Attack-Record (28 Byte) — gilt für scene.bin **und** kernel.bin

`src/Shared/DataParser.cs:150-179` (lesen) / `DataParser.cs:181-222` (schreiben).
`ATTACK_BLOCK_SIZE = 28` (`DataParser.cs:15`).

| Off | Typ | Feld |
|---|---|---|
| `0x00` | u8 | Accuracy-Rate |
| `0x01` | u8 | Impact-Effect-ID |
| `0x02` | u8 | Target-Hurt-Action-Index (Trefferanimation des Ziels) |
| `0x03` | u8 | **unbekannt** (schreibt `0xFF`) |
| `0x04` | u16 | MP-Cost |
| `0x06` | u16 | Impact-Sound |
| `0x08` | u16 | Camera-Movement-ID (Einzelziel) |
| `0x0A` | u16 | Camera-Movement-ID (Mehrfachziel) |
| `0x0C` | u8 | Target-Flags |
| `0x0D` | u8 | Attack-Effect-ID |
| `0x0E` | u8 | **Damage-Calculation-ID** (siehe §5.3) |
| `0x0F` | u8 | Attack-Strength / Power |
| `0x10` | u8 | Condition-Submenu (`AttackConditions.cs`: `0` HP, `1` MP, `2` Status, `0xFF` keine) |
| `0x11` | u8 | Status-Change (siehe unten) |
| `0x12` | u8 | Additional-Effects (siehe §5.4) |
| `0x13` | u8 | Additional-Effects-Modifier |
| `0x14` | u32 | Statuses (Bitfeld) |
| `0x18` | u16 | Elements (Bitfeld) |
| `0x1A` | u16 | **Special-Attack-Flags, invertiert gespeichert** (`~`) |

**Status-Change-Byte** (`DataParser.cs:224-237`):
`0xFF` = keine · `0x00–0x3F` = **Inflict**, Amount = Wert · `0x40–0x7F` = **Cure**,
Amount = Wert − `0x40` · `0x80+` = **Swap/Toggle**, Amount = Wert − `0x80`.
Zusatzregel beim Schreiben: Ist der Typ „None", wird das Status-Bitfeld auf
`0xFFFFFFFF` gesetzt (`DataParser.cs:209-213`).

**Invertiert gespeicherte Felder — Sammelliste** (überall `~` beim Lesen *und* Schreiben):
Enemy-Status-Immunities (u32), BattleFlags (u16), Attack-Special-Flags (u16),
Item-Restrictions & Item-Special, Weapon/Armor/Accessory-Restrictions.
→ In WebMidgar konsequent als „stored one's complement" modellieren.

### 3.6 Battle-Location-IDs

`src/SceneEditor/LocationInfo.cs:10-102` — vollständige Liste `0x00`–`0x59` (90 Einträge)
mit Klartextnamen (Debug Room, Grassland, Mt. Nibel, Reactor 1, …, Forest (Ultimate
Weapon)). Gruppierung in Midgar/Junon/Corel/Nibelheim/Wutai/Temple/NorthernCrater/Misc.
→ Direkt als Nachschlagetabelle für `render-battle` verwendbar (Fakten, keine Übernahme
von Code nötig).

Modell-Dateiname der Location: erste ID → `"ogaa"`, danach wird das erste Zeichen
inkrementiert, bei Überlauf `>'z'` das zweite (`LocationInfo.cs:123-137`).
⚠️ **Bug im Repo:** die Schleifenvariable `i` wird nie erhöht → Endlosschleife für
jede `LocationID > 0`. Die *Intention* der Namensableitung ist trotzdem klar.

---

## 4. Battle-AI-VM (Stack-Maschine)

Zentral für `interpreter` / `battle-runtime`.

### 4.1 Skript-Container-Layout

`src/AIEditor/AIContainer.cs:50-143`, `AIContainer.cs:145-208`

Jeder AI-Träger (Gegner, Formation, Charakter) besitzt **16 Skript-Slots**
(`AIContainer.cs:8`). Sein Skript-Block beginnt mit **16 × uint16 Offsets**;
`0xFFFF` = Slot leer. Die Offsets sind **relativ zum Beginn des Container-Blocks
inklusive des 32-Byte-Headers** (`currPos` startet bei `SCRIPT_NUMBER*2 = 32`,
`AIContainer.cs:103`).

Darüber liegt eine **Gruppen-Ebene**: `N × uint16` Container-Offsets, relativ zum Beginn
der Offset-Tabelle (`currPos` startet bei `containerCount*2`, `AIContainer.cs:151`).
Jeder Container-Block wird auf **gerade Länge** mit `0xFF` gepolstert
(`AIContainer.cs:168`, `AIContainer.cs:188-191`).

| Ebene | Anzahl Container | Header | Datenblock | Summe |
|---|---|---|---|---|
| Enemy-AI (scene.bin) | 3 | 6 B | 4090 B | 4096 |
| Formation-AI (scene.bin) | 4 | 8 B | 504 B | 512 |
| Character-AI (kernel.bin §3) | 12 | 24 B | 2024 B | 2048 |

(`Enemy.cs:10-13`, `Formation.cs:8`, `Kernel.cs:25`)

**Skriptlänge** ergibt sich implizit aus dem *nächsten belegten* Offset — es gibt kein
Längenfeld (`AIContainer.cs:63-98`, `Scene.cs:504-536`).

### 4.2 Die 16 Skript-Slots

`src/SceneEditor/SceneEditorForm.cs:33-39`

| # | Name |
|---|---|
| 0 | Pre-Battle |
| 1 | Main |
| 2 | General Counter |
| 3 | Death Counter |
| 4 | Physical Counter |
| 5 | Magic Counter |
| 6 | Battle Victory |
| 7 | Pre-Action Setup |
| 8–15 | Custom Event 1–8 |

### 4.3 Opcode-Tabelle

`src/AIEditor/Opcodes.cs:9-24` (Werte) + `src/AIEditor/OpcodeInfo.cs:10-74`
(Operandengröße, Pop-Count, Symbol).

Legende Operand: `–` = keiner, `1B/2B/3B` = n Byte Immediate, `STR` = FF7-Text bis
`0xFF`, `DBG` = 1 Byte Pop-Count + ASCII bis `0x00`.

| Code | Mnemonic | Operand | Pops | Semantik |
|---|---|---|---|---|
| `0x00` | PushAddress00 | 2B | 0 | Adresse pushen, Typ 0 |
| `0x01` | PushAddress01 | 2B | 0 | Adresse pushen, Typ 1 |
| `0x02` | PushAddress02 | 2B | 0 | Adresse pushen, Typ 2 |
| `0x03` | PushAddress03 | 2B | 0 | Adresse pushen, Typ 3 |
| `0x10` | PushValue10 | 2B | 0 | **Wert an Adresse** pushen, Typ 0 |
| `0x11` | PushValue11 | 2B | 0 | Wert pushen, Typ 1 |
| `0x12` | PushValue12 | 2B | 0 | Wert pushen, Typ 2 |
| `0x13` | PushValue13 | 2B | 0 | Wert pushen, Typ 3 |
| `0x30` | Add | – | 2 | `a + b` |
| `0x31` | Subtract | – | 2 | `a − b` |
| `0x32` | Multiply | – | 2 | `a * b` |
| `0x33` | Divide | – | 2 | `a / b` |
| `0x34` | Modulo | – | 2 | `a % b` |
| `0x35` | BitwiseAnd | – | 2 | `a & b` |
| `0x36` | BitwiseOr | – | 2 | `a \| b` |
| `0x37` | BitwiseNot | – | **1** | `~a` |
| `0x40` | Equal | – | 2 | `a == b` |
| `0x41` | NotEqual | – | 2 | `a != b` |
| `0x42` | GreaterOrEqual | – | 2 | `a >= b` |
| `0x43` | LessThanOrEqual | – | 2 | `a <= b` |
| `0x44` | GreaterThan | – | 2 | `a > b` |
| `0x45` | LessThan | – | 2 | `a < b` |
| `0x50` | LogicalAnd | – | 2 | `a && b` |
| `0x51` | LogicalOr | – | 2 | `a \|\| b` |
| `0x52` | LogicalNot | – | **1** | `!a` |
| `0x60` | PushConst01 | **1B** | 0 | Konstante (8 bit) |
| `0x61` | PushConst02 | **2B** | 0 | Konstante (16 bit) |
| `0x62` | PushConst03 | **3B** | 0 | Konstante (24 bit) |
| `0x70` | JumpEqual | 2B | 1 | bedingter Sprung (Ziel = abs. Byte-Offset) |
| `0x71` | JumpNotEqual | 2B | 1 | bedingter Sprung, vergleicht gegen Stack-Top |
| `0x72` | Jump | 2B | 0 | unbedingter Sprung |
| `0x73` | End | – | 0 | Skriptende (Parser stoppt hier) |
| `0x74` | PopUnused | – | 0 | (Name aus Scarlet; Semantik unklar) |
| `0x75` | ShareScripts | – | 1 | Skripte eines anderen Charakters (ID) benutzen |
| `0x80` | Mask | – | 2 | Bit-Maskierung, disassembliert als `a.b` |
| `0x81` | RandomWord | – | 0 | Zufallswort pushen |
| `0x82` | RandomByte | – | 1 | **zufällig gesetztes Bit** aus Maske wählen |
| `0x83` | CountBits | – | 1 | Anzahl gesetzter Bits |
| `0x84` | MaskGreatest | – | 1 | höchstwertiges gesetztes Bit |
| `0x85` | MaskLeast | – | 1 | niederwertigstes gesetztes Bit |
| `0x86` | MPCost | – | 1 | MP-Kosten eines Angriffs (ID) |
| `0x87` | TopBit | – | 1 | oberstes Bit |
| `0x90` | Assign | – | 2 | `ziel = wert` |
| `0x91` | Pop | – | 0 | Stack-Element verwerfen |
| `0x92` | Attack | – | 2 | Angriff ausführen (Typ, Attack-ID) |
| `0x93` | ShowMessage | STR | 0 | Nachricht anzeigen |
| `0x94` | CopyStats | – | 2 | Statuswerte kopieren (Semantik unklar) |
| `0x95` | AssignGlobal | – | 2 | globale Variable lesen/schreiben |
| `0x96` | ElementalDef | – | 2 | Elementarverteidigung des Ziels abfragen |
| `0xA0` | DebugMessage | DBG | var. | Debug-Ausgabe, Pop-Count **dynamisch** aus dem 1. Byte |
| `0xA1` | Pop2 | – | 0 | Stack-Element verwerfen (Variante) |
| `0xFE` | Label | – | 0 | **Pseudo-Opcode nur im Editor**, erzeugt keine Bytes |

**Wichtig:** `0xFE` existiert *nicht* im Binärformat (`CodeLine.cs:246`, `Script.cs:456`).
Er ist Scarlets Label-Marker. Ein Interpreter braucht ihn nicht.

**Nicht belegte Codes:** alles außerhalb der Tabelle. Scarlet pusht unbekannte Bytes
kommentarlos auf den Stack (`Script.cs:245-248`) — kein Fehler, Robustheit gegen
unbekannte Opcodes ist also empfehlenswert.

### 4.4 Stack-Semantik & Rekonstruktion von Ausdrücken

`src/AIEditor/Script.cs:206-259`

Reiner Postfix-Auswerter:

1. Jedes Opcode mit `PopCount == 0` wird auf den Stack gelegt.
2. Jedes Opcode mit `PopCount = n > 0` nimmt die **letzten n** Stack-Einträge ab
   (`AddToTop` → LIFO-Reihenfolge wird umgedreht, sodass Operand 0 der zuerst
   gepushte ist) und legt den resultierenden Ausdrucksblock zurück.
3. `DebugMessage` (`0xA0`) hat einen **laufzeitvariablen** Pop-Count aus seinem
   ersten Parameterbyte (`Script.cs:219-222`).
4. Am Ende bleibt eine Liste von Top-Level-Anweisungen (`Script.cs:251-258`).

Operanden-Präzedenz für die Ausgabe (`OpcodeInfo.cs:198-219`), absteigend:
Push (7) > Special/MPCost (6) > BitOperation (5) > Mathematical (4) > Logical (3) >
Logical2 (`&&`,`||`,`!`) (2) > Random (1).

### 4.5 Sprünge & Adressierung von Sprungzielen

`src/AIEditor/Script.cs:167-199`, `Script.cs:464-486`

- Sprungoperand = **absoluter Byte-Offset innerhalb des Skripts** (nicht relativ,
  nicht innerhalb des Containers).
- Scarlet ersetzt beim Parsen alle Ziele durch fortlaufende Label-Nummern und
  rechnet beim Schreiben zurück (`CorrectHeaders`).
- Disassembler-Konvention (`CodeBlock.cs:178-192`): `JumpEqual` ⇒ „If (cond) …
  else goto label"; `JumpNotEqual` ⇒ „If (1st in Stack != x) … else goto label".
  ⚠️ Die beiden verhalten sich **asymmetrisch** (der eine konsumiert die Bedingung, der
  andere vergleicht gegen den Stack-Rest). Für WebMidgar an echten Skripten verifizieren.

### 4.6 Variablen-/Adressraum

`src/AIEditor/CommonVars.cs:11-34`

Zwei Bänke, unterschieden am oberen Nibble der 16-Bit-Adresse:
**`0x2xxx` = Kampf-Globals**, **`0x4xxx` = aktorbezogene Werte**.

**Starke Hypothese (aus den Abständen abgeleitet, in Scarlet nicht dokumentiert):**
Die Adressen sind **Bit-Offsets**, nicht Byte-Offsets. Belege: `CommandIndex 0x2000` →
`ActionIndex 0x2008` (Δ 8 = 1 Byte); `CurrentMP 0x4140` → `MaxMP 0x4150` (Δ 0x10 =
2 Byte); `CurrentHP 0x4160` → `MaxHP 0x4180` (Δ 0x20 = 4 Byte, passend zu 32-Bit-HP).
→ **Vor Implementierung an echten Daten verifizieren.**

**Globals (`0x2xxx`):**

| Adr | Name | Adr | Name |
|---|---|---|---|
| `0x2000` | CommandIndex | `0x20A0` | Enemies |
| `0x2008` | ActionIndex | `0x20B0` | ActiveEnemies |
| `0x2010` | TempGlobal | `0x20C0` | ActiveCharacters |
| `0x2018` | Dummy | `0x20E0` | Actors |
| `0x2020` | BattleFormation | `0x2110` | BattleRewards |
| `0x2038` | LimitLevel | `0x2120` | Elements |
| `0x2050` | ActiveActors | `0x2140` | FormationIndex |
| `0x2060` | Self | `0x2150` | ActionIndex2 |
| `0x2070` | Target | `0x2170` | SpecialFlags |
| `0x2080` | Allies | `0x21C0` | Gil |
| `0x2090` | ActiveAllies | | |

**Actor-Globals (`0x4xxx`):**

| Adr | Name | Adr | Name |
|---|---|---|---|
| `0x4000` | StatusEffects | `0x40D0` | PreviousAttacker |
| `0x4040` | ActorIndex | `0x40E0` | PreviousPhysicalAttacker |
| `0x4048` | Level | `0x40F0` | PreviousMagicalAttacker |
| `0x4058` | ElementalDamageModifier | `0x4100` | PhysicalDefense |
| `0x4060` | CharacterID | `0x4110` | MagicalDefense |
| `0x4068` | PhysicalAttackPower | `0x4120` | ActorIndex2 |
| `0x4070` | MagicAttackPower | `0x4130` | AbsorbedElements |
| `0x4078` | PhysicalEvade | `0x4140` | CurrentMP |
| `0x4080` | IdleAnimation | `0x4150` | MaxMP |
| `0x4088` | DamagedAnimation | `0x4160` | CurrentHP |
| `0x4090` | BackDamageModifier | `0x4180` | MaxHP |
| `0x4098` | ModelSize | `0x4220` | InitialStatus |
| `0x40A0` | Dexterity | `0x4268` | MagicEvade |
| `0x40A8` | Luck | `0x4270` | Row |
| `0x40B8` | CoveredCharacter | `0x4280` | GilStolen |
| `0x40C0` | Target | `0x4290` | ItemStolen |
| | | `0x42A0` | NullifiedElements |
| | | `0x42B0` | APReward |
| | | `0x42C0` | GilReward |
| | | `0x42E0` | EXPReward |

Der Unterschied zwischen den **vier Push-Typen** (`0x00`–`0x03` bzw. `0x10`–`0x13`)
wird in Scarlet **nicht erklärt** — nur als „Address/Value Type 0..3" benannt
(`OpcodeInfo.cs:12-20`). Einziger Hinweis: `CommonVarInfo.cs:6` erlaubt für die
Variable `Self` genau die Typen `PushAddress02` und `PushValue12`. → **Offene Frage.**

### 4.7 Semantik der Kommando-Opcodes

`src/AIEditor/CodeBlock.cs:118-281`, `src/AIEditor/CommandInfo.cs:12-26`

- **`Attack` (`0x92`)**, pops 2: Operand 0 = **Attack-Type-Byte**, Operand 1 = **Attack-ID**.
  Sonderwert **Type `0x24` = „Wait"** (kein Angriff) — `CodeBlock.cs:214`.
  Alle übrigen Typwerte sind in Scarlet **nicht** aufgeschlüsselt → offene Frage.
  Der Angriffs-ID-Parameter ist typischerweise `PushConst02` (`Script.cs:387`).
- **`AssignGlobal` (`0x95`)**, pops 2: Operand 0 == `1` ⇒ **schreiben**
  (`GlobalVar[x] = TempGlobal`); sonst **lesen** (`TempGlobal = GlobalVar[x]`)
  — `CodeBlock.cs:224-237`.
- **`ElementalDef` (`0x96`)**, pops 2: `(Ziel, Element-Bitmaske)` → Elementarverteidigung.
  Operand 1 wird als `Elements`-Bitfeld interpretiert (`CodeBlock.cs:238-252`).
- **`MPCost` (`0x86`)**, pops 1: Attack-ID → MP-Kosten.
- **`RandomByte` (`0x82`)**, pops 1: wird als `RandomBit(maske)` disassembliert
  (`CodeBlock.cs:196-198`) → wählt ein zufällig gesetztes Bit, typisches Muster für
  zufällige Zielauswahl aus einer Aktormaske.
- **`ShareScripts` (`0x75`)**, pops 1: Character-ID, deren Skripte verwendet werden.
- **`ShowMessage` (`0x93`)**: FF7-Text bis `0xFF` (inklusive Terminator im Parameter,
  `Script.cs:133-142`).
- **`DebugMessage` (`0xA0`)**: 1 Byte Pop-Count, danach ASCII bis `0x00`; der
  Terminator wird **nicht** in den Parameter aufgenommen (`Script.cs:143-153`), die
  Längenrechnung addiert `+2` (`CodeLine.cs:263-265`).
- **`CopyStats` (`0x94`)**, pops 2: Semantik in Scarlet **nicht** dokumentiert.

---

## 5. kernel.bin / kernel2.bin

### 5.1 Containerformat

`src/Compression/Gzip.cs:14-67`, `src/KernelEditor/Kernel.cs:22-28`

**kernel.bin** — 27 Sektionen hintereinander, jede mit 6-Byte-Header:

| Off | Typ | Feld |
|---|---|---|
| `+0` | u16 | komprimierte Länge |
| `+2` | u16 | unkomprimierte Länge |
| `+4` | u16 | Sektions-/Dateityp-Index |
| `+6` | n | **gzip**-Stream |

Für Sektionen `≥ KERNEL1_END (9)` wird als Typfeld konstant `9` geschrieben
(`Gzip.cs:29-33`). Danach zwei Null-Bytes am Dateiende, im Repo kommentiert mit
„add 0s because this helps for some reason??" (`Gzip.cs:37`) → **undokumentierter
Quirk, für byte-genaues Round-Trip relevant.**

**kernel2.bin** — kein gzip. Alle Textsektionen (Index 9…26) werden als
`[u32 Länge][Daten]` aneinandergehängt, das **Gesamtergebnis** mit **LZS** komprimiert,
und die Datei bekommt vorne `[u32 komprimierte Länge]` (`Gzip.cs:43-66`).

### 5.2 Sektionsliste

Abgeleitet aus `Kernel.cs:22` (`SECTION_COUNT=27`, `KERNEL1_END=9`,
`DESCRIPTIONS_END=17`, `NAMES_END=25`), `Kernel.cs:451-553`, `Kernel.cs:1274-1578`,
`KernelChunkExportForm.cs:93-99` (1-basierte Nummerierung).

| # | Sektion | Recordgröße |
|---|---|---|
| 1 | Command Data | 8 B |
| 2 | Attack Data | 28 B × 128 |
| 3 | Battle & Growth Data | s. §5.5 |
| 4 | Initialization Data | s. §5.6 |
| 5 | Item Data | 28 B |
| 6 | Weapon Data | 44 B |
| 7 | Armor Data | 36 B |
| 8 | Accessory Data | 16 B |
| 9 | Materia Data | 20 B × 96 |
| 10–17 | Descriptions: Command, Magic, Item, Weapon, Armor, Accessory, Materia, Key Item | Text |
| 18–25 | Names: Command, Magic, Item, Weapon, Armor, Accessory, Materia, Key Item | Text |
| 26 | Battle Text | Text |
| 27 | Summon Attack Names | Text |

**Textsektionsformat** (`Kernel.cs:77-154`, `Kernel.cs:1176-1266`):
`N × u16` Offsets ab Sektionsbeginn, danach die FF7-Text-Strings, jeweils `0xFF`-
terminiert, Sektion auf gerade Länge mit `0xFF` gepolstert.

**Text-Rückreferenz-Kompression (`0xF9`)** — `Kernel.cs:113-139`, `Kernel.cs:160-239`:
Auf `0xF9` folgt ein Argumentbyte:
- Bits 7–6 → Länge = `((arg >> 6) * 2) + 4` ⇒ nur **4, 6, 8, 10** möglich.
- Bits 5–0 → Rückwärtsdistanz (0–63).
- Decoder springt `(−offset − 3)` relativ von der Position **nach** dem Argumentbyte.
- `0xFF`-Bytes werden beim Kopieren übersprungen.
Beim Encodieren: Distanz = `aktuellePos − matchStart − 1`, Längenbits =
`((L/2) − 2) << 6`; Matches dürfen keine bereits komprimierten Positionen überlappen.

Historischer Marker: Limit-Break-Namen waren mit `0xF8 0x02` präfigiert; der Code
dafür ist auskommentiert (`Kernel.cs:62-73`, `Kernel.cs:1205-1212`) → Flag.

### 5.3 Damage-Calculation-ID (das wichtigste Byte für `battle-runtime`)

`src/KernelEditor/DamageCalculationInfo.cs:170-368`.
Ein Byte, **oberes Nibble = Kategorie**, **unteres Nibble = Formel**. `0xFF` = null.
Oberes Nibble `> 0xB` ⇒ ungültig.

**Oberes Nibble:**

| Upper | Schadensart | Trefferberechnung | Krit möglich |
|---|---|---|---|
| `0x0` | physisch | NoMiss (Typ 1) | nein |
| `0x1` | physisch | normal (Accuracy-Stat) | **ja** |
| `0x2` | magisch | normal | nein |
| `0x3` | physisch | NoMiss (Typ 2) | nein |
| `0x4` | magisch | NoMiss (Typ 1) | nein |
| `0x5` | magisch | NoMiss (Typ 2) | nein |
| `0x6` | physisch | normal | **ja** — Spezialformeln |
| `0x7` | magisch | normal | nein — Spezialformeln |
| `0x8` | physisch | „Hit Chance % Target Level" | nein |
| `0x9` | physisch | „Manipulate"-Formel | nein |
| `0xA` | physisch | normal | **ja** — Schadensmultiplikatoren |
| `0xB` | physisch | normal | **nein** |

**Unteres Nibble bei Upper ∉ {6,7,A} (Normalformeln):**

| Low | Formel |
|---|---|
| `0x0` | kein Schaden |
| `0x1` | Standard: `(Power/16) * (Stat + ((Level+Stat)/32)²)` |
| `0x2` | Simple: `(Power/16) * ((Level+Stat) * 6)` |
| `0x3` | `CurrHP * (Power/32)` |
| `0x4` | `MaxHP * (Power/32)` |
| `0x5` | SimpleStronger: `(Power*22) + ((Level+Stat)*6)` |
| `0x6` | statisch: `Power * 20` |
| `0x7` | `Power / 32` |
| `0x8` | stellt HP **und** MP vollständig wieder her |
| `0x9` | „Throw"-Formel |
| `0xA` | „Coin"-Formel |

⚠️ Die Standard-Formel steht im Repo als Anzeigestring mit **unausgeglichenen Klammern**
(`DamageCalculationInfo.cs:41`); die obige Fassung ist die naheliegende Lesart —
gegen die bekannte FF7-Formel gegenprüfen.

**Unteres Nibble bei Upper ∈ {6,7} (Spezialformeln):**

| Low | Bedeutung |
|---|---|
| `0x0` | aktuelle HP des Anwenders |
| `0x1` | MaxHP − CurrHP des Anwenders |
| `0x8` | Würfelwurf × 100 |
| `0x9` | Anzahl Fluchten × 256 |
| `0xA` | aktuelle HP des Ziels − 1 |
| `0xB` | `(Stunden × 100) + Minuten` (Spielzeit) |
| `0xC` | Kill-Count des Ziels × 10 |
| `0xD` | Anzahl Materia des Ziels × 1111 (Aire Tam Storm) |

**Unteres Nibble bei Upper = `0xA` (Multiplikatoren, benötigen zusätzlich einen Modifier):**

| Low | Bedeutung |
|---|---|
| `0x0` | Master Fist — mehr Schaden bei Statuseffekten auf dem Anwender |
| `0x1` | Powersoul — mehr Schaden bei Near Death / Death Sentence |
| `0x2` | mehr Schaden pro gefallenem Verbündeten |
| `0x3` | Angriffskraft = Durchschnittslevel der Ziele |
| `0x4` | Angriffskraft nach aktuellen HP |
| `0x5` | Angriffskraft nach aktuellen MP |
| `0x6` | Missing Score — Angriffskraft nach Waffen-AP |
| `0x7` | Death Penalty — Angriffskraft nach Kill-Count |
| `0x8` | Premium Heart — Angriffskraft nach Limit-Leiste |

**Konsistenzregeln beim Zurückschreiben** (`DamageCalculationInfo.cs:390-441`) — nützlich
als Validierung: Krit nur bei physisch + normaler Trefferberechnung; physisch schließt
die Berechnungen `HitChanceModTargetLevel`/`Manip` aus; Multiplikatorformeln
(Upper `0xA`) erfordern physisch **und** Krit; Spezialformeln ohne Krit ⇒ Upper `0x7`.

### 5.4 Additional Effects (Byte `0x12` im Attack-Record)

`src/Shared/AdditionalEffects.cs:18-56`. „Mod" = nutzt Byte `0x13` als Modifier.

| Wert | Effekt | Mod |
|---|---|---|
| `0xFF` | keiner | |
| `0x00` | Mehrfachtreffer (Anzahl = Modifier) | ✔ |
| `0x01` | führt Gunge Lance aus, wenn Gegner statusimmun sind | |
| `0x02` | Fat Chocobo beschwören, wenn `rand(0..255) > Modifier` | ✔ |
| `0x03` | Anwender wird zur ID des Modifiers (Vincent-Limit) | ✔ |
| `0x04` | Backattack-Schaden, wenn Zielreihe = Modifier | ✔ |
| `0x05` | Kampf ohne Belohnung beenden | |
| `0x06` | `Level × 20` Gil stehlen | |
| `0x07` | Item stehlen | |
| `0x08` | zufällig einen der nächsten sechs Animationsindizes abspielen | |
| `0x09` | bei gleichem Level: Schaden × 8 | |
| `0x0A` | Master-Fist-Multiplikator | |
| `0x0B` | Powersoul-Multiplikator | |
| `0x0C` | Schaden = 1 × Anzahl KO'd Verbündeter | |
| `0x0D` | Angriffskraft = Durchschnittslevel der Ziele | |
| `0x0E` | tote Verbündete wiederbeleben | |
| `0x0F` | Cait Siths Slots | |
| `0x10` | Cait Siths Transform | |
| `0x11` | Ziel aus dem Kampf entfernen (als tot markiert) | |
| `0x12` | Ziel aus dem Kampf entfernen (als geflohen markiert) | |
| `0x13` | Schaden nach Slot-Ergebnis (Tifa-Limits) | |
| `0x14` | Limit-Leisten der Verbündeten füllen | |
| `0x15` | Angriff/Verteidigung des Ziels um `(Mod − 100)%` ändern | ✔ |
| `0x16` | Ausweichen des Ziels um `(Mod − 100)%` ändern | ✔ |
| `0x17` | Angriff des Ziels um `(Mod − 100)%` ändern | ✔ |
| `0x18` | nach Abschluss Angriff mit ID = Modifier ausführen | ✔ |
| `0x19` | Zielreihe wechseln | |
| `0x1A` | Angriff mit ID = Modifier auf übrige Reihenmitglieder | ✔ |
| `0x1B` | Anwender aus dem Kampf entfernen | |
| `0x1C` | Verteidigung des Ziels um `(Mod − 100)%` ändern | ✔ |
| `0x1D` | Ziel aus dem „geflohen"-Status zurückholen | |
| `0x1E` | Angriffskraft nach aktuellen HP | |
| `0x1F` | Angriffskraft nach aktuellen MP | |
| `0x20` | Angriffskraft nach aktuellen AP | |
| `0x21` | Angriffskraft nach Kill-Count | |
| `0x22` | Angriffskraft nach Limit-Level | |
| `0x23` | keine Belohnungen vom Ziel | |

### 5.5 Battle- & Growth-Sektion (kernel.bin #3)

Schreibreihenfolge aus `Kernel.cs:1305-1408`.

**A) 9 Charakter-Wachstumsrecords à 48 Byte:**

| Off | Typ | Feld |
|---|---|---|
| `0x00`–`0x08` | 9×u8 | Kurvenindizes: STR, VIT, MAG, SPR, DEX, LUCK, HP, MP, EXP |
| `0x09` | u8 | Padding `0xFF` |
| `0x0A` | i8 | Rekrutierungslevel-Offset **× 2** (Yuffie: fest `1`, `Kernel.cs:1318-1325`) |
| `0x0B` | u8 | Padding `0xFF` |
| `0x0C`–`0x0E` | 3×u8 | Limit 1-1, 1-2, 1-3 (1-3 immer `0xFF`) |
| `0x0F`–`0x11` | 3×u8 | Limit 2-1, 2-2, 2-3 (`0xFF`) |
| `0x12`–`0x14` | 3×u8 | Limit 3-1, 3-2, 3-3 (`0xFF`) |
| `0x15`–`0x17` | 3×u8 | Limit 4-1, 4-2/4-3 (`0xFFFF`) |
| `0x18` | u16 | Kills für Limit-Level 2 |
| `0x1A` | u16 | Kills für Limit-Level 3 |
| `0x1C` | u16 | Uses für Limit 1-2 |
| `0x1E` | u16 | `0xFFFF` (Limit 1-3) |
| `0x20` | u16 | Uses für Limit 2-2 |
| `0x22` | u16 | `0xFFFF` |
| `0x24` | u16 | Uses für Limit 3-2 |
| `0x26` | u16 | `0xFFFF` |
| `0x28`/`0x2A`/`0x2C`/`0x2E` | 4×u16 | HP-Divisoren Limit-Level 1–4 |

**B)** Random-Bonus-Tabellen: Primärstats, HP, MP (Byte-Arrays).
**C)** Stat-Kurven: je 8 Paare `(Gradient u8, Base u8)` = 16 B pro Kurve.
**D)** Character-AI-Block: 24 B Offsets (12 × u16) + 2024 B Code = 2048 B.
**E)** RNG-Tabelle.
**F)** Scene-Lookup-Table (64 B, siehe §2.4).
**G)** 56 Spell-Index-Bytes (`INDEXED_SPELL_COUNT`): **untere 5 Bit = Section-Index,
obere 3 Bit = Spell-Type**; `0xFF` = „unlisted" (`Kernel.cs:1051-1080`).

### 5.6 Initialization-Sektion (kernel.bin #4)

`Kernel.cs:1411-1435`, Recordlayout `DataParser.cs:28-141` (`CHARACTER_RECORD_LENGTH = 132`).

Reihenfolge: 9 Charakterrecords (je 132 B) → Party1/2/3 (3 B) → `0xFF` →
Inventar `320 × u16` → Materia `200 × 4 B` → gestohlene Materia `48 × 4 B` →
32 B Padding (`0xFF`) → Gil (u32).

**Charakter-Record (132 B):**

| Off | Typ | Feld | Off | Typ | Feld |
|---|---|---|---|---|---|
| `0x00` | u8 | ID | `0x22` | u16 | LearnedLimits |
| `0x01` | u8 | Level | `0x24` | u16 | KillCount |
| `0x02`–`0x07` | 6×u8 | STR,VIT,MAG,SPR,DEX,LUCK | `0x26` | u16 | Limit1Uses |
| `0x08`–`0x0D` | 6×u8 | dieselben Boni | `0x28` | u16 | Limit2Uses |
| `0x0E` | u8 | LimitLevel | `0x2A` | u16 | Limit3Uses |
| `0x0F` | u8 | CurrentLimitBar | `0x2C` | u16 | CurrentHP |
| `0x10` | 12 B | Name (FF7-Text) | `0x2E` | u16 | BaseHP |
| `0x1C` | u8 | WeaponID | `0x30` | u16 | CurrentMP |
| `0x1D` | u8 | ArmorID | `0x32` | u16 | BaseMP |
| `0x1E` | u8 | AccessoryID | `0x34` | u32 | **unbekannt** |
| `0x1F` | u8 | CharacterFlags | `0x38` | u16 | MaxHP |
| `0x20` | u8 | Reihe: `0xFE` = hintere, sonst `0xFF` | `0x3A` | u16 | MaxMP |
| `0x21` | u8 | LevelProgressBar | `0x3C` | u32 | CurrentEXP |
| | | | `0x40` | 8×4 B | Waffen-Materia |
| | | | `0x60` | 8×4 B | Rüstungs-Materia |
| | | | `0x80` | u32 | EXP bis zum nächsten Level |

**Inventar-Wort-Packung** (`DataParser.cs:352-378`):
**untere 9 Bit = Item-Index, obere 7 Bit = Menge**. `0xFFFF` = leer.

**Materia-Slot (4 B)** (`DataParser.cs:390-400`): `[u8 Index][3 B AP, LE 24 bit]`;
Index `0xFF` = leer.

### 5.7 Weitere kernel-Recordlayouts

**Command (8 B)** — `Kernel.cs:1284-1290`:
`0x00` InitialCursorAction · `0x01` TargetFlags · `0x02` u16 unbekannt ·
`0x04` CameraMovementID single · `0x06` CameraMovementID multi.
InitialCursorAction (`InitialCursorActionInfo.cs:11-25`): `0` Kommando mit Zieldaten ·
`1` Magie · `2` Beschwörung · `3` Item · `4` Enemy Skill · `5` Throw · `6` Limit ·
`7` Zielauswahl per Cursor · `8` W-Magic · `9` W-Summon · `A` W-Item · `B` Coin.

**Item (28 B)** — `Kernel.cs:1443-1459`:
`0x00`–`0x07` Padding · `0x08` u16 CameraMovementID · `0x0A` u16 Restrictions (**inv.**) ·
`0x0C` TargetData · `0x0D` AttackEffectID · `0x0E` DamageCalcID · `0x0F` AttackPower ·
`0x10` ConditionSubmenu · `0x11` StatusChange · `0x12` AdditionalEffects ·
`0x13` Modifier · `0x14` u32 Status · `0x18` u16 Element · `0x1A` u16 Special (**inv.**).

**Weapon (44 B)** — `Kernel.cs:1473-1506`:
`0x00` Targets · `0x01` AttackEffectID (immer `0xFF`) · `0x02` DamageCalcID ·
`0x03` ungenutzt · `0x04` AttackStrength · `0x05` Status · `0x06` GrowthRate ·
`0x07` CriticalRate · `0x08` AccuracyRate · `0x09` WeaponModelID · `0x0A` Padding ·
`0x0B` HighSoundIDMask · `0x0C` u16 CameraMovementID (immer `0xFFFF`) ·
`0x0E` u16 EquipableBy · `0x10` u16 AttackElements · `0x12` u16 Padding ·
`0x14`–`0x17` 4× BoostedStat · `0x18`–`0x1B` 4× Bonus · `0x1C`–`0x23` 8 Materia-Slots ·
`0x24` NormalHitSound · `0x25` CriticalHitSound · `0x26` MissedAttackSound ·
`0x27` ImpactEffectID · `0x28` u16 SpecialAttackFlags (immer `0xFFFF`) ·
`0x2A` u16 Restrictions (**inv.**).

**Armor (36 B)** — `Kernel.cs:1514-1539`:
`0x00` unbekannt · `0x01` ElementDamageModifier · `0x02` Defense · `0x03` MagicDefense ·
`0x04` Evade · `0x05` MagicEvade · `0x06` Status · `0x07`–`0x08` unbekannt ·
`0x09`–`0x10` 8 Materia-Slots · `0x11` GrowthRate · `0x12` u16 EquipableBy ·
`0x14` u16 ElementalDefense · `0x16` u16 unbekannt · `0x18`–`0x1B` 4× BoostedStat ·
`0x1C`–`0x1F` 4× Bonus · `0x20` u16 Restrictions (**inv.**) · `0x22` u16 unbekannt.

**Accessory (16 B)** — `Kernel.cs:1546-1555`:
`0x00`/`0x01` BoostedStat1/2 · `0x02`/`0x03` Bonus1/2 · `0x04` ElementalDamageModifier ·
`0x05` SpecialEffect · `0x06` u16 ElementalDefense · `0x08` u32 StatusDefense ·
`0x0C` u16 EquipableBy · `0x0E` u16 Restrictions (**inv.**).

**Materia (20 B)** — `Kernel.cs:1562-1576`:
`0x00`/`0x02`/`0x04`/`0x06` je u16 **AP für Level 2/3/4/5, gespeichert als AP÷100** ·
`0x08` EquipEffect · `0x09`–`0x0B` Status (**nur die unteren 24 Bit** des u32!) ·
`0x0C` Element · `0x0D` MateriaTypeByte · `0x0E`–`0x13` 6 Attribut-Bytes.
Max-AP-Sentinel: `0xFFFF × 100` ⇒ Level nicht erreichbar (`MateriaExt.cs:113`, `:204-212`).

**Materia-Type-Byte** (`MateriaExt.cs:7-27`): unteres Nibble = Basistyp,
oberes Nibble = Subtyp (`MateriaExt.cs:115-123`). Bekannte Gesamtwerte:
`0x00` IndependentFunction · `0x08` MasterCommand · `0x0A` MasterMagic ·
`0x0C` MasterSummon · `0x12` CommandReplaceAttack · `0x16` CommandAdd · `0x19` Magic ·
`0x20` IndepStatBoost1 · `0x21` IndepPreEmptive · `0x25` Support1 · `0x30` IndepLongRange ·
`0x33` CommandDouble · `0x34` IndepMegaAll · `0x35` Support2 · `0x3B` Summon ·
`0x40` IndepEXPPlus · `0x41` IndepStatBoost2 · `0x57` CommandEnemySkill.
Support-Subtypen (Attribut 0) `MateriaExt.cs:40-57`: `0x51` All · `0x54` CommandCounter ·
`0x55` MagicCounter · `0x56` SneakAttack · `0x57` FinalAttack · `0x58` MPTurbo ·
`0x59` MPAbsorb · `0x5A` HPAbsorb · `0x5C` AddedCut · `0x5D` StealAsWell ·
`0x5E` Elemental · `0x5F` AddedEffect · `0x60` MorphAsWell · `0x61` APPlus ·
`0x63` QuadraMagic.
Materia-Slot-Byte: Werte 8/9 = „double-linked" Varianten von
`EmptyRightLinkedSlot`/`NormalRightLinkedSlot` (`MateriaSlotExt.cs:7-16`).

### 5.8 Item-Indexraum (global)

`DataParser.cs:16-26`, `DataParser.cs:300-350`

| Bereich | Typ | Anzahl |
|---|---|---|
| `0`–`127` | Item | 128 |
| `128`–`255` | Weapon | 128 |
| `256`–`287` | Armor | 32 |
| `288`–`319` | Accessory | 32 |
| `320`–`415` | Materia | 96 |
| `> 415` | ungültig | |

### 5.9 Attack-Index-Bereiche in kernel.bin

`Kernel.cs:22-28`: `ATTACK_COUNT = 128`; `SUMMON_OFFSET = 0x38`;
`ESKILL_OFFSET = 0x48`; `SPECIAL_SUMMON_OFFSET = 0x60`; `LIMIT_OFFSET = 0x62`;
`ESKILL_COUNT = 0x60 − 0x48 = 24`. Limit-Namen liegen in `MagicNames` **hinter**
Index 128 (`Kernel.cs:381-395`).

**Enemy-Skills-Bitfeld (24 Bit)** — `src/Shared/EnemySkills.cs:11-36`, Bit 0..23:
FrogSong, L4Suicide, MagicHammer, WhiteWind, BigGuard, AngelWhisper, DragonForce,
DeathForce, FlameThrower, Laser, MatraMagic, BadBreath, Beta, Aqualung, Trine,
MagicBreath, „????", GoblinPunch, Chocobuckle, L5Death, DeathSentence, Roulette,
ShadowFlare, PandorasBox.

---

## 6. Bitfelder (Reihenfolge aus Scarlets UI abgeleitet)

⚠️ Die numerischen Werte liegen in `Shojy.FF7.Elena` (externes NuGet, **nicht im Repo**).
Scarlet indiziert positionsweise in `Enum.GetValues<T>()`, d. h. Position *i* ↔ Bit *i*
gilt nur, wenn Elenas Enums saubere `1<<i`-Flags in Deklarationsreihenfolge sind
(bei 32 Einträgen für u32 bzw. 16 für u16 höchst plausibel). **Gegenprüfen.**

### 6.1 Statuses (32 Bit) — `Shared/Controls/StatusesControl.cs:41-51`

| Bit | Name | Bit | Name |
|---|---|---|---|
| 0 | Death | 16 | Barrier |
| 1 | Near Death | 17 | MBarrier |
| 2 | Sleep | 18 | Reflect |
| 3 | Poison | 19 | Dual |
| 4 | Sadness | 20 | Shield |
| 5 | Fury | 21 | Death Sentence |
| 6 | Confu | 22 | Manipulate |
| 7 | Silence | 23 | Berserk |
| 8 | Haste | 24 | Peerless |
| 9 | Slow | 25 | Paralysis |
| 10 | Stop | 26 | Darkness |
| 11 | Frog | 27 | Dual Drain |
| 12 | Small | 28 | Death Force |
| 13 | Slow-numb | 29 | Resist |
| 14 | Petrify | 30 | Lucky Girl |
| 15 | Regen | 31 | Imprisoned |

Die **ersten 24** bilden die „partielle" Liste für Felder mit nur 24 nutzbaren Bits
(`StatusesControl.cs:10`, `PARTIAL_LIST_LENGTH = 24`) — passt zum 3-Byte-Statusfeld
im Materia-Record (§5.7).

### 6.2 Elements (16 Bit) — `Shared/Controls/ElementsControl.cs:18-24`

| Bit | Name | Bit | Name |
|---|---|---|---|
| 0 | Fire | 8 | Holy |
| 1 | Ice | 9 | Restorative |
| 2 | Bolt | 10 | Cut |
| 3 | Earth | 11 | Hit |
| 4 | Poison | 12 | Punch |
| 5 | Gravity | 13 | Shoot |
| 6 | Water | 14 | Shout |
| 7 | Wind | 15 | Hidden |

### 6.3 Target-Flags (8 Bit) — `Shared/Controls/TargetDataControl.cs:17-28`

| Bit | Name |
|---|---|
| 0 | EnableSelection |
| 1 | StartCursorOnEnemyRow |
| 2 | DefaultMultipleTargets |
| 3 | ToggleSingleMultiTarget |
| 4 | SingleRowOnly |
| 5 | ShortRange |
| 6 | AllRows |
| 7 | RandomTarget |

### 6.4 Special-Attack-Flags (16 Bit, **invertiert gespeichert**)

`Shared/Controls/SpecialAttackFlagsControl.cs:18-32`

| Bit | UI-Label in Scarlet | Elena-Enumname |
|---|---|---|
| 0 | Damage MP | DamageMP |
| 1 | (unbekannt 1) | — (Rohwert `0x0002`) |
| 2 | Affected by Darkness | **ForcePhysical** |
| 3 | Drains damage | DrainPartialInflictedDamage |
| 4 | Drains HP and MP | DrainHPAndMP |
| 5 | (unbekannt 2) | **DiffuseAttack** |
| 6 | Ignore status defense | IgnoreStatusDefense |
| 7 | Miss if not dead | MissWhenTargetNotDead |
| 8 | Reflectable | CanReflect |
| 9 | Ignore defense | BypassDefense |
| 10 | No retarget if dead | DontAutoRetargetWhenOriginalTargetKilled |
| 11 | Always crit | AlwaysCritical |
| 12–15 | — | unbelegt |

⚠️ **Namenskonflikt:** Bits 2 und 5 tragen in Scarlets UI andere Bezeichnungen als in
Elena. Beide Deutungen dokumentieren, empirisch entscheiden.

---

## 7. LZS (Kompression für kernel2.bin)

`src/Compression/Lzs.cs` — klassisches **LZSS nach Haruhiko Okumura**.

| Parameter | Wert |
|---|---|
| Ringpuffer `N` | 4096 |
| Max. Matchlänge `F` | 18 |
| `THRESHOLD` | 2 |
| Ringpuffer-Initialisierung | **mit `0x00` gefüllt** (`Lzs.cs:205`) |
| Startposition `r` | `N − F` = 4078 |

**Dekodierung** (`Lzs.cs:199-232`) — genug für eine Eigenimplementierung:

1. Flag-Byte lesen; es liefert 8 Flags, **LSB zuerst**. (Trick: `flags = c | 0xFF00`,
   danach `flags >>= 1`; solange Bit 8 gesetzt ist, sind noch Flags übrig.)
2. Flag-Bit `1` → **Literal**: 1 Byte direkt ausgeben und in den Ringpuffer schreiben.
3. Flag-Bit `0` → **Referenz**: 2 Bytes `i`, `j` lesen.
   - Offset = `i | ((j & 0xF0) << 4)` → 12 Bit.
   - Länge = `(j & 0x0F) + THRESHOLD`, es werden `Länge + 1` Bytes kopiert
     (Schleife `k = 0 … j` inklusiv) ⇒ effektive Länge 3–18.
   - Quelle = `buffer[(offset + k) & (N−1)]`; jedes kopierte Byte wandert wieder in
     den Ringpuffer.
4. Ringpuffer-Schreibzeiger `r` wird nach jedem Byte `& (N−1)` maskiert.

Encoder-Seite (`Lzs.cs:160-162`): Referenz wird als
`[pos & 0xFF]`, `[((pos >> 4) & 0xF0) | (len − 3)]` geschrieben.

---

## 8. battle.lgp & Battle-Modelle (für `render-battle`)

### 8.1 LGP-Archivformat

`src/SceneEditor/BattleLgp.cs:47-75`

```
0x00: 12 Byte Header
0x0C: uint32 fileCount
      fileCount × Eintrag (27 Byte):
          20 Byte Name (nullterminiert/aufgefüllt)
           4 Byte uint32 Offset in die Datei
           1 Byte Options
           2 Byte "dupes" (Duplikat-/Konflikt-Index)
An jedem Offset:
          20 Byte Name (wiederholt)
           4 Byte uint32 Länge
           n Byte Daten
```

### 8.2 Namensschema der Modelldateien

`BattleLgp.cs:82-205`, `LocationInfo.cs:123-137`

Jedes Modell hat ein zweibuchstabiges Präfix `??`:

| Datei | Inhalt |
|---|---|
| `??aa` | **Skelett** (identifiziert das Modell) |
| `??ac`, `??ad`, … | Texturen (`nTextures` Stück, ab `c` aufsteigend) |
| `??am`, `??an`, … `??az`, `??ba`, … | P-Modelle pro Knochen (Überlauf: 1. Zeichen ++, 2. auf `a`) |
| `??da` | Animations-Pack |
| `??ck`, `??cl`, … | Waffenmodelle (`nWeapons` Stück ab `k`) — im Repo auskommentiert |

Battle-Locations beginnen bei `"ogaa"` und zählen zeichenweise hoch.
Modellindex einer Battle-Arena = **Enemy-Modell-Index + 370** (`BattleLgp.cs:10`,
`:140-143`).

### 8.3 Skelett-Header `??aa` (13 × int32 = 52 Byte)

`src/KimeraCS/Core/FF7BattleSkeleton.cs:20-33`, `:67-81`

| Off | Feld | Anmerkung |
|---|---|---|
| `0x00` | skeletonType | `0` Gegner, `1` Battle-Location, `2` PC-Battle-Modell |
| `0x04` | unk1 | „immer 1?" |
| `0x08` | unk2 | „immer 1?" |
| `0x0C` | **nBones** | `0` ⇒ es ist eine Battle-Location |
| `0x10` | unk3 | „immer 0?" |
| `0x14` | **nJoints** | bei Locations die Teile-Anzahl |
| `0x18` | **nTextures** | |
| `0x1C` | nsSkeletonAnims | |
| `0x20` | unk4 | „nSkeletonAnims + 2?" |
| `0x24` | nWeapons | |
| `0x28` | nsWeaponsAnims | |
| `0x2C` | unk5 | „immer 0?" |
| `0x30` | unk6 | „globale Länge?" |

Danach folgen die Knochenrecords. P-File-Anzahl = `max(nBones, nJoints)`
(`BattleLgp.cs:166-167`).

### 8.4 Animations-Pack `??da`

Kommentarblock `src/KimeraCS/Core/FF7BattleAnimationsPack.cs:1-17`, Parser
`src/KimeraCS/Core/FF7BattleAnimation.cs:83-163`.

```
uint32 nAnimations
nAnimations × ANIM HEADER:
    int32  nBones + 1        ← unzuverlässig
    int32  numFrames         ← meist zu KLEIN
    int32  blockSize         ← = blockSizeShort + 5 + Padding auf 4 Byte
    (nur wenn blockSize > 11:)
    uint16 numFramesShort    ← meist zu GROSS
    uint16 blockSizeShort
    uint8  key
    blockSizeShort Bytes     Frame-Rohdaten (bitgepackt)
    (blockSize − blockSizeShort − 5) Bytes Padding
```

Padding-Formel laut Repo-Kommentar: `(4 − ((blockSizeShort + 5) % 4)) % 4`.

**Bekannte Quirks** (`FF7BattleAnimation.cs:66-78`, `:113-124`, `:145-155`):
- `nBones` und `numFrames` sind unzuverlässig; wenn das Skelett nur 1 Knochen hat,
  wird `nBones` auf 1 gezwungen.
- Der Parser dekodiert bis `numFramesShort` und **bricht ab, wenn die Bits ausgehen** —
  die tatsächliche Framezahl ergibt sich erst dabei.
- **Vanilla RSAA (Frosch-Gegner)** hat ein **fehlendes `numFramesShort`**; erkannt an
  `blockSize − 5 == erstes gelesenes u16` → dann wird umgedeutet und `blockSize += 2`.

### 8.5 Frame-Kodierung (bitgepackt, **MSB zuerst**)

Bitleser: `src/KimeraCS/Core/Utils.cs:702-763` (`GetBitBlockVUnsigned`) —
liest von der höchstwertigen Bitposition abwärts, byteübergreifend; Vorzeichenerweiterung
über `GetSignExtendedShort` (`Utils.cs:791-817`).

**Frame 0 (unkomprimiert)** — `FF7BattleAnimation.cs:326-351`:
1. `startX`, `startY`, `startZ`: je **16 Bit signed**.
2. Pro Knochen 3 Rotationen (α, β, γ): je **`12 − key` Bit signed**, Ergebnis
   **× 2^key** (auf 12-Bit-Skala normiert).

**Folgeframes (delta-kodiert)** — `FF7BattleAnimation.cs:226-290`:
1. Für X, Y, Z je: **1 Bit** Breitenwahl → `0` ⇒ 7 Bit, `1` ⇒ 16 Bit; Wert signed,
   **additiv** zum Vorframe.
2. Pro Knochen und Achse (`ProcessBattleFrameBoneRotationDelta`, `:170-208`):
   - **1 Bit**: `0` ⇒ Delta = 0 (keine weiteren Bits).
   - `1` ⇒ **3 Bit** Längencode `dLen`:
     - `dLen == 0` ⇒ Delta = **−1** (kleinstmögliches Dekrement).
     - `dLen == 7` ⇒ **`12 − key` Bit** roh lesen (wie Frame 0).
     - sonst ⇒ `dLen` Bit signed lesen, danach **`± 2^(dLen−1)` korrigieren**
       (bei negativem Wert subtrahieren, bei positivem addieren) — ungewöhnliche
       Sign-Korrektur, exakt so nachbauen.
   - Ergebnis **× 2^key**, additiv auf den Vorframe.
3. Akkumulation in **int16**; negative Werte werden mit **`+ 0x1000`** in den Bereich
   0…4095 geholt.
4. Grad = `raw / 2^(12 − key) × 360` (`Utils.cs:909-918`) — d. h. bei `key = 0`
   schlicht `raw / 4096 × 360`.

Abspielrate im Editor: `ANIMATION_FPS = 15`
(`SceneEditor/Controls/ModelPreviewControl.cs:22`) — Editorwert, nicht zwingend Spielwert.

---

## 9. Kleinkram / Sentinels

`src/Shared/HexParser.cs:10-41`

| Konstante | Wert | Verwendung |
|---|---|---|
| `NULL_OFFSET_16_BIT` | `0xFFFF` | überall „leer/keine Referenz" |
| `NULL_OFFSET_16_BIT_SIGNED` | `-1` | 3D-Koordinaten |
| `NULL_OFFSET_32_BIT` | `0xFFFFFFFF` | |
| „Null-Block" | mit **`0xFF`** gefüllt | leere Records, Padding |

**Merke:** FF7 polstert mit `0xFF`, nicht mit `0x00`. Nur die zwei Bytes am Ende von
kernel.bin sind `0x00` (§5.1).

FF7-Text: eigener Zeichensatz, `0xFF` = Terminator; JP-Modus separat
(`FFText` aus Elena). Steuerbytes im Kernel-Text: `0xF9` (Rückreferenz, §5.2),
`0xF8 0x02` (historischer Limit-Marker).

---

## 10. Top-Findings für WebMidgar (nach Nutzen gerankt)

| # | Finding | Zielpaket | Warum |
|---|---|---|---|
| 1 | **Vollständiges 7808-Byte-Szenenlayout** (§3) inkl. aller Offsets | `formats-battle` | Direkt als Parser-Spezifikation nutzbar; deckt Gegner, Angriffe, Formationen, Kamera und AI in einem Rutsch ab. |
| 2 | **Opcode-Tabelle mit Operandengröße + Pop-Count** (§4.3) | `interpreter` | Das ist die eigentliche Trophäe: Pop-Counts erlauben eine korrekte Stack-Rekonstruktion ohne Raten. |
| 3 | **Damage-Calculation-Nibble-Dekodierung** (§5.3) | `battle-runtime` | Ein Byte steuert Schadensart, Trefferberechnung, Krit-Fähigkeit **und** Formel — vollständig aufgeschlüsselt inkl. der drei Sonderräume. |
| 4 | **scene.bin-Blockpacking + Scene-Lookup-Table** (§2) | `formats-battle` | Offsets sind /4 kodiert, Blockbelegung variabel — ohne die Lookup-Table in kernel.bin §3 findet man Szene *n* nicht. |
| 5 | **AI-Container-Verschachtelung** (Gruppen-Offsets → 16 Skript-Offsets → Code) (§4.1) und die 16 Slot-Namen (§4.2) | `interpreter`, `battle-runtime` | Skriptlängen sind implizit; das Zwei-Ebenen-Offset-Schema muss exakt nachgebaut werden. |
| 6 | **Attack-Record 28 Byte** — identisch in scene.bin und kernel.bin (§3.5) | `formats-battle`, `formats-kernel` | Ein Parser genügt für beide Container. |
| 7 | **Invertiert gespeicherte Felder** (§3.5, Sammelliste) | alle Format-Pakete | Häufige Fehlerquelle; betrifft Statusimmunitäten, BattleFlags, Special-Flags, alle Restrictions. |
| 8 | **kernel.bin-Sektionsheader + 27er-Sektionsliste** (§5.1, §5.2) | `formats-kernel` | Inkl. Text-Sektionsformat und `0xF9`-Rückreferenzkompression. |
| 9 | **Enemy-Record 152 Byte** inkl. Resistenz- und Drop-Kodierung (§3.4) | `formats-battle` | Zwei Parallel-Arrays für Resistenzen und die `0x80`-Steal-Flagge sind nicht offensichtlich. |
| 10 | **Additional-Effects-Tabelle 0x00–0x23** (§5.4) | `battle-runtime` | Deckt Limit-Break-Sonderlogik, Steal, Morph, Slots ab. |
| 11 | **Actor-/Global-Variablen-Adressraum** (§4.6) + Bit-Offset-Hypothese | `interpreter` | Erlaubt es, AI-Skripte auf echte Kampfzustände abzubilden. |
| 12 | **Battle-Animations-Bitpacking** inkl. `dLen`-Sonderfälle (§8.5) | `render-battle` | Die `dLen == 0 ⇒ −1`- und `± 2^(dLen−1)`-Regeln sind ohne Vorlage praktisch nicht zu erraten. |
| 13 | **LZS-Format** (§7) | `formats-kernel` | Nur für kernel2.bin nötig; ~30 Zeilen Eigenimplementierung. |
| 14 | **battle.lgp-Layout + Namensschema** (§8.1, §8.2) | `render-battle` | Inkl. Arena-Offset 370. |
| 15 | **Bitfeld-Reihenfolgen** Statuses/Elements/Targets/Special (§6) | `formats-kernel`, `battle-runtime` | Mit Verifikationsvorbehalt (Elena extern). |
| 16 | **Item-Indexraum & Inventar-Bitpackung** (§5.8, §5.6) | `formats-kernel` | 9-Bit-Index + 7-Bit-Menge. |
| 17 | **Location-ID-Tabelle 0x00–0x59** (§3.6) | `render-battle` | Fertige Namenszuordnung für Battle-Backgrounds. |

---

## 11. Offene Fragen

1. **Push-Typen 0–3** (`0x00`–`0x03` / `0x10`–`0x13`): Was unterscheidet die vier
   Adressierungsarten? Scarlet nennt sie nur „Type 0..3" (`OpcodeInfo.cs:12-20`).
   Einziger Datenpunkt: `Self` ist mit Typ 2 assoziiert (`CommonVarInfo.cs:6`).
2. **Bit- vs. Byte-Adressierung** der AI-Variablen (§4.6): Die Abstände legen
   Bit-Offsets nahe, das Repo sagt nichts. An echten scene.bin-Daten verifizieren.
3. **Attack-Type-Byte** von Opcode `0x92`: Nur `0x24` = „Wait" ist bekannt
   (`CodeBlock.cs:214`). Die übrige Wertemenge fehlt komplett.
4. **`CopyStats` (`0x94`)**, **`PopUnused` (`0x74`)**, **`Pop` (`0x91`)** vs.
   **`Pop2` (`0xA1`)**: Semantik nirgends dokumentiert.
5. **`JumpEqual` vs. `JumpNotEqual`**: Die Disassembler-Texte implizieren
   unterschiedliche Stack-Behandlung (`CodeBlock.cs:178-192`) — unbestätigt.
6. **Elena-Enumwerte**: Alle Bitreihenfolgen in §6 sind aus der UI-Reihenfolge
   abgeleitet. Die tatsächlichen Werte liegen in `Shojy.FF7.Elena` 0.10.0.
7. **Special-Attack-Flags Bit 2 und 5**: Scarlet-UI („Affected by Darkness",
   „unbekannt 2") widerspricht Elena („ForcePhysical", „DiffuseAttack").
8. **Resistenz-IDs `0x10`–`0x1F`**: Test ist `< 0x10`, Statusoffset aber `0x20`
   (`Enemy.cs:157-164`) — was passiert in der Lücke?
9. **Resistenz-Rate `3`**: unbelegt im Enum (`ResistanceRate.cs:8`).
10. **Unbekannte Felder**: Enemy `0x7A` (u16) und `0x94` (u32, wird nie gelesen);
    Attack `0x03`; Charakter-Record `0x34` (u32); Armor `0x00`, `0x07`–`0x08`,
    `0x16`, `0x22`; Command `0x02`.
11. **BattleFlags-Bit `0x02`** und Bits 5–15; **InitialConditions-Bit `0x04`**.
12. **kernel.bin: zwei `0x00`-Bytes am Dateiende** — im Repo selbst als unerklärt
    markiert (`Gzip.cs:37`).
13. **`CHARACTER_COUNT = 11` vs. 9 Einträge in `CharacterList`** und
    **`AI_BLOCK_COUNT = 12`** (`Kernel.cs:24-25`, `Kernel.cs:43-48`): Wofür stehen
    die zusätzlichen AI-Slots (Cait Sith/Young Cloud und Vincent/Sephiroth teilen sich
    je einen Charakter-Slot)?
14. **`CopyAllText` iteriert 0-basiert** über Sektionen (`Kernel.cs:247-249`), während
    `GetSectionRawData` 1-basiert aufgerufen wird (`Gzip.cs:22`,
    `KernelChunkExportForm.cs:98`) — Off-by-one im Repo oder unterschiedliche
    Enum-Basis? Betrifft die Sektionsnummerierung in §5.2.
15. **Standard-Schadensformel**: Anzeigestring mit unausgeglichenen Klammern
    (`DamageCalculationInfo.cs:41`).
16. **`LocationInfo.GetModelID`** ist eine Endlosschleife (`LocationInfo.cs:127-135`) —
    die beabsichtigte Namensableitung muss unabhängig verifiziert werden.
17. **JP-Originalversion**: 16-Byte-Gegnernamen und fehlender Formation-AI-Block
    (`Scene.cs:391-392`, `:449-457`) — verschiebt das gesamte Szenenlayout. Wie wird
    die Region erkannt?
18. **Waffenanimationen** (`??ck` ff.) sind in Scarlet auskommentiert
    (`FF7BattleSkeleton.cs:150-171`) — Format unbestätigt.
19. **Externe Referenzen aus dem Repo** (für Gegenprüfung, nicht gelesen):
    `wiki.ffrtt.ru/index.php/FF7/FF_Text` (`Kernel.cs:117`),
    `wiki.qhimm.com/FF7/Battle/Battle_Animation_(PC)` und
    `forums.qhimm.com/index.php?topic=7185.0` (`FF7BattleAnimationsPack.cs:28-31`).
