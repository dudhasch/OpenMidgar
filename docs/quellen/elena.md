# Elena (tsunamods-codes/Elena) — Recherchenotizen

**Erhebung:** 2026-08-10 · Klon: `scratchpad/repos/Elena` · `git clone --depth 1`
**HEAD:** `cebf1b1e1bd0c916c898e073c99d6266b10decd0` — *„Typo in kernel2 example"*, Joshua Moon, 2019-07-22
**Branches:** nur `master`, keine Tags. Der Stand ist seit Juli 2019 unverändert (Version `0.1.1-dev`).

---

## 0. LIZENZ (zuerst, verbindlich)

**MIT License, Copyright (c) 2019 Joshua Moon** (`LICENSE`, Zeilen 1–21).
Permissiv: Nutzung, Modifikation, Weitergabe erlaubt, **Bedingung: Copyright- und
Lizenzhinweis müssen in Kopien oder wesentlichen Teilen enthalten bleiben.**

Für WebMidgar bedeutet das:

* **Formatfakten (Offsets, Recordgrößen, Enum-Werte, Headerreihenfolge) sind frei
  verwertbar** — das sind Tatsachen über ein Dateiformat, keine schöpferische Leistung.
* **Quelltext darf nicht übernommen werden**, ohne den MIT-Hinweis mitzuführen. Das
  Projekt ist Clean-Room; hier wurde daher **kein Code kopiert**, nur beschrieben.
* ⚠️ **Besonderer Risikopunkt:** `Shojy.FF7.Elena/Compression/LzsCompression.cs`
  trägt in Zeilen 5–8 den Hinweis, die Methoden seien *„based on fantastic work by
  NFITC1 for Wall Market, and has been ported to run in C#"*. Der Code trägt die
  typischen Merkmale einer **Dekompilierung** (Variablennamen `num1`…`num6`,
  `checked{}`-Rauschen, VB-artige Schleifen). Die Herkunft ist damit *nicht* sauber
  MIT — sie stammt aus einem Drittwerkzeug. **Diese Datei ist für WebMidgar tabu,
  auch als Vorlage.** WebMidgar hat mit `packages/formats-field/src/lzs.ts` ohnehin
  eine eigene LZS-Implementierung; es besteht kein Bedarf.
* Alles Übrige in Elena ist handgeschrieben und unauffällig; die hier notierten
  Fakten sind zusätzlich durch Qhimm-/ffrtt-Wikidokumentation gedeckt (Elena selbst
  zitiert `wiki.ffrtt.ru/index.php/FF7/FF_Text` in `Sections/TextSection.cs:53`).

---

## 1. Was Elena tatsächlich ist

Elena ist **keine Modding-Suite und kein Patcher.** Es ist eine kleine
**.NET-Standard-2.0-Klassenbibliothek (NuGet-Paket „Elena", 43 Dateien, ~1.900 LOC
Quelltext)** zum **lesenden** Zugriff auf drei FF7-PC-Dateiarten:

1. `KERNEL.BIN` und `kernel2.bin` (Spieldatenbasis + Texte),
2. `*.lgp`-Archive (Inhaltsverzeichnis auflisten, Einzeldatei extrahieren),
3. `*.tex`-Texturen (Konvertierung nach PNG/GIF/JPEG/`Bitmap`).

Selbstbeschreibung: *„a .net standard utility library for reading various FF7
files"* (`README.md:3`), Paketbeschreibung *„A kernel reading utility for Final
Fantasy VII"* (`Shojy.FF7.Elena.csproj:6`).

**Es gibt keinerlei Schreib-, Pack- oder Patchpfad**: kein LGP-Writer, kein
Kernel-Writer, keine Manifest-/Mod-Paketformate, keine Diff-/Patchformate, keine
Konfliktauflösung, keine Assetnamenskonventionen für Overrides. Der Auftrag „Mod-
Packaging/Patching-Konventionen ernten" läuft bei diesem Repository **ins Leere** —
diese Konventionen liegen im Tsunamods-Ökosystem an anderer Stelle (7th Heaven /
`.iro`-Pakete), nicht hier.

**Verhältnis zu Tsunamods:** `csproj` nennt als `PackageProjectUrl`/`RepositoryUrl`
noch `https://github.com/Shojy/Elena` (`Shojy.FF7.Elena.csproj:10–11`). Das
tsunamods-codes-Repo ist also eine **Fork/Übernahme des Originals von Shojy**, ohne
eigene Commits über dem 2019er Stand. Elena wird im Tsunamods-Umfeld als
Bibliothek konsumiert (Kernel-Anzeige in Werkzeugen), nicht dort weiterentwickelt.

**Aufbau:**

| Ordner | Inhalt |
|---|---|
| `Shojy.FF7.Elena/` | Bibliothek (netstandard2.0, einzige Abhängigkeit `System.Drawing.Common` 4.5.1) |
| `Shojy.FF7.Elena.Runner/` | Wegwerf-Konsolenprogramm des Autors mit hartkodierten lokalen Pfaden (`Runner/Program.cs:14,19`) |

---

## 2. `KERNEL.BIN` — Containerformat

Quelle: `Shojy.FF7.Elena/KernelReader.cs:239–288`.

* Datei ist eine **reine Folge von 27 Sektionen**, kein Index, kein Dateikopf.
* Je Sektion: **6-Byte-Kopf**, dann der komprimierte Strom.
  * `u16 @+0` komprimierte Länge
  * `u16 @+2` entpackte Länge
  * `u16 @+4` Dateityp
  * ab `+6`: Nutzdaten der Länge „komprimierte Länge"
* Fortschritt: `offset += 6 + komprimierteLänge`. Die Schleife läuft **fest 27 mal**.
* Dekompression: **GZip** (`GZipStream`, `KernelReader.cs:279–288`).
* Sektionsnummerierung **1-basiert** (`(KernelSection)sectionIndex + 1`).

➡️ **Deckt sich exakt mit WebMidgars `u16-triple`-Auslegung** in
`packages/formats-kernel/src/container.ts`. Elena ist damit eine unabhängige
Zweitbestätigung dafür, dass WebMidgars Accounting-Entscheidung richtig ausgegangen
ist. Elena kennt allerdings **keinen Trailer** und keine Quarantäne — WebMidgar ist
hier robuster (2 Nullbytes Rest, gzip-Magic-Prüfung, Layout-Wahl per Accounting).

### 2.1 Sektionsbelegung (1-basiert), `KernelSection.cs:5–31`

| # | Rolle | # | Rolle | # | Rolle |
|---|---|---|---|---|---|
| 1 | Command Data | 10 | Command **Descriptions** | 19 | Magic **Names** |
| 2 | Attack Data | 11 | Magic Descriptions | 20 | Item Names |
| 3 | Battle & Growth Data | 12 | Item Descriptions | 21 | Weapon Names |
| 4 | Init Data | 13 | Weapon Descriptions | 22 | Armor Names |
| 5 | Item Data | 14 | Armor Descriptions | 23 | Accessory Names |
| 6 | Weapon Data | 15 | Accessory Descriptions | 24 | Materia Names |
| 7 | Armor Data | 16 | Materia Descriptions | 25 | Key Item Names |
| 8 | Accessory Data | 17 | Key Item Descriptions | 26 | Battle Text |
| 9 | Materia Data | 18 | Command Names | 27 | Summon Attack Names |

Merksatz: **1–9 Records, 10–17 Beschreibungen, 18–25 Namen, 26–27 Sondertexte.**
Beschreibung *n* und Name *n+8* gehören paarweise zusammen. Key Items (17/25) haben
**keine** Recordsektion — `KeyItemData` besteht nur aus Name + Beschreibung
(`Sections/KeyItemData.cs:10–26`).

⚠️ Fehler in Elena, nicht übernehmen: Die XML-Doku-Kommentare in `KernelReader.cs`
sind teils falsch (`MagicDescriptions` wird als „Kernel section 19" beschriftet,
obwohl der Enumwert 11 ist; `MateriaNames`/`MagicNames` beide als 24). **Maßgeblich
ist das Enum, nicht die Prosa.**

### 2.2 `kernel2.bin` — anderer Container

Quelle: `KernelReader.cs:70–104` (Kommentar Zeilen 72–74).

* Die **gesamte Datei** ist **LZS-komprimiert** (nicht sektionsweise, nicht gzip).
* Nach dem Entpacken: Folge von Sektionen mit **`int32` Längenpräfix je Sektion**,
  danach direkt die Nutzdaten. Kein Typfeld, keine entpackte Länge.
* Schleife läuft über `sectionIndex = 9…26`, eingetragen als `+1` ⇒ **Sektionen
  10 bis 27**, also **genau die 18 Textsektionen** — Recordsektionen 1–9 fehlen.
* `MergeKernel2Data` (`KernelReader.cs:49–68`) überschreibt die gleichnamigen
  Sektionen aus `KERNEL.BIN` und lädt neu. Semantik laut `README.md:29`:
  *das Spiel benutzt kernel2.bin statt der äquivalenten Texte in kernel.bin.*

➡️ **Neu und direkt verwertbar für WebMidgar.** `tools/realdata-scan/FINDINGS.md:74`
weiß bisher nur „ist LZS-komprimiert, entpackt zu 27.390 B (deutsch)". Elena liefert
die **innere Struktur nach dem Entpacken** (u32-Längenpräfixe, Sektionen 10–27) und
die **Vorrangregel** gegenüber `kernel.bin`.

---

## 3. FF7-Textkodierung — der wichtigste Fund

### 3.1 `0xF9` ist **keine** Steuersequenz, sondern eine Rückverweis-Kompression

Quelle: `Sections/TextSection.cs:12–13, 46–84` (Kommentar 49–62).

Algorithmus, wie Elena ihn beschreibt und ausführt:

* `0xFF` = Stringende. `0xF9` = *Lookup-Kommando*.
* Auf `0xF9` folgt **ein Argumentbyte**, aufgeteilt:
  * **obere 2 Bit** (`args & 0b1100_0000 >> 6`) → Länge, **`L·2 + 4`** (also 4, 6, 8 oder 10 Bytes)
  * **untere 6 Bit** (`args & 0b0011_1111`) → Rückversatz (0…63)
* Kopiert wird aus dem **rohen, noch nicht dekodierten** Sektionsbytestrom ab
  `index - 1 - offset` (mit `index` = Position des `0xF9`-Bytes), `L` Bytes vorwärts;
  `0xFF`-Bytes werden dabei übersprungen statt kopiert.
* Danach wird das Argumentbyte übersprungen (`++index`).
* Elena beschreibt es als *„based on the LZS compression method, but optimized for
  smaller files"* und verweist auf `wiki.ffrtt.ru/index.php/FF7/FF_Text`.

➡️ 🔴 **Konkreter Mangel in WebMidgar.** `packages/formats-kernel/src/text.ts`
führt in `DEFAULT_CONTROLS` `0xf9: 1`, d. h. `0xF9` + Folgebyte werden **verworfen**.
Der eigene Kommentar dort nennt das ausdrücklich eine unbewiesene Hypothese („senkt
den Anteil unbekannter Bytes messbar, ist aber nicht bewiesen") bei **164 gemessenen
Fundstellen**. Tatsächlich fehlen dadurch **4–10 Zeichen je Fundstelle** in den
dekodierten Strings. Die Roadmap `docs/ROADMAP-S13-S19.md:72` hatte die
„0xF9-Textkompression" bereits als Ziel geführt — sie ist im Code **nicht
umgesetzt**. Elena liefert die genaue Bitaufteilung.

### 3.2 Zeichentabelle, `Extensions/TextExtensions.cs:11–105`

Auswertungsreihenfolge (erste passende Regel gewinnt):

| Bytebereich | Bedeutung laut Elena |
|---|---|
| `< 0x60` | **ASCII = Byte + 0x20** (ergibt 0x20…0x7F) |
| `0x60 … 0xCF`, `0xD1 … 0xE0` | *„Non-English characters are within this range"* — Elena ersetzt sie durch `?` (Z. 27–31) |
| `0xD0` | Leerzeichen (0x20) |
| `0xE2` | Tabulator (0x09) |
| `0xE3` | 0x02 (vermutlich Zeilen-/Seitenumbruch) |
| `0xEA…0xF5` | Namensplatzhalter: `{Cloud}` `{Barret}` `{Tifa}` `{Aeris}` `{Red XIII}` `{Yuffie}` `{Caith Sith}` `{Vincent}` `{Cid}` `{Party 1}` `{Party 2}` `{Party 3}` |
| übrige `< 0xFE` (also `0xE1`, `0xE4–0xE9`, `0xF6–0xFD`) | **Funktion mit einem Parameterbyte** → beide überspringen |
| `0xFF` | Stringende |
| `0xFE` | fällt in Elena in den `else`-Zweig → `?` |

➡️ Bestätigt WebMidgars abgeleiteten `DEFAULT_ASCII_OFFSET = 0x20` **unabhängig**.
➡️ 🔴 **Zweiter konkreter Mangel:** WebMidgars `buildAsciiTable` legt das lineare
Fenster auf `0x00 … 0xDF-offset = 0xBF`. Elena belegt, dass der lineare Bereich
**bei 0x5F endet**; `0x60…0xE0` sind erweiterte/nicht-englische Zeichen. WebMidgar
bildet also `0x60…0xBF` fälschlich auf `0x80…0xDF` ab — genau der Bereich, in dem
die **deutschen Umlaute** stehen. Das erklärt potenziell Restrauschen im deutschen
Bestand. Elena selbst löst diese Zeichen **nicht** auf (`?`), taugt also nicht als
Quelle für die deutsche Tabelle — aber als Beleg, **wo** sie liegen muss.
➡️ Namensplatzhalter: Roadmap nennt `0xEA–0xF0`; Elena erweitert belegt auf
**`0xEA–0xF5`** inkl. der drei Party-Slots.
➡️ ⚠️ Elenas Behandlung von `0xFE` ist mutmaßlich falsch (landet im `else`), obwohl
`0xFE` die dokumentierte Steuerpräfix-Sequenz ist. WebMidgar hat das richtig.

### 3.3 Textsektionsaufbau, `Sections/TextSection.cs:22–35`

* Sektion beginnt mit einer **Zeigertabelle aus `u16`-Offsets** (relativ zum
  Sektionsanfang).
* **Der erste Zeiger zeigt hinter die Tabelle**; `ersterZeiger / 2` = Stringanzahl.
* Strings terminieren mit `0xFF`.

➡️ **Identisch mit WebMidgars `textListLength()`** in `records.ts` — unabhängige
Bestätigung einer Heuristik, die WebMidgar bislang selbst hergeleitet hat.

---

## 4. Recordlayouts der Sektionen 5–9 (Offsets ab Recordanfang, little-endian)

WebMidgar hat für diese Sektionen bisher **nur Schrittweitenerkennung**
(`smallestStride` in `records.ts`), keine Feldbelegung. Elena liefert sie.

### 4.1 Item — Sektion 5, **28 Byte/Record** (`Sections/ItemData.cs:12, 55–69`)

| Offset | Typ | Feld |
|---|---|---|
| 0x00–0x07 | — | (von Elena nicht ausgewertet: Name-/Unbekanntfeld) |
| 0x08 | u16 | Camera Movement Id |
| 0x0A | u16 | **Restrictions, bitinvertiert** (s. 4.6) |
| 0x0C | u8 | Target Data (Flags, s. 4.7) |
| 0x0D | u8 | Attack Effect Id |
| 0x0E | u8 | Damage Calculation Id |
| 0x0F | u8 | Attack Power |
| 0x14 | u32 | Status (Bitmaske, s. 4.8) |
| 0x18 | u16 | Element (Bitmaske, s. 4.9) |

Modell `Items/Item.cs` führt zusätzlich `SpecialEffects Special` — **wird nie
befüllt**, das Feld ist im Parser nicht belegt (Lücke in Elena).

### 4.2 Weapon — Sektion 6, **44 Byte/Record** (`Sections/WeaponData.cs:13, 55–76`)

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | u8 | Target Data (Flags) |
| 0x02 | u8 | Damage Calculation Id |
| 0x04 | u8 | Attack Strength |
| 0x05 | u8 | Status — **Index 0x00–0x1F, nicht Bitmaske** (s. 4.8) |
| 0x06 | u8 | Growth Rate (0 None, 1 Normal, 2 Double, 3 Triple) |
| 0x07 | u8 | Critical Rate |
| 0x08 | u8 | Accuracy Rate |
| 0x09 | u8 | Weapon Model Id |
| 0x0E | u16 | Equipable By (Bitmaske, s. 4.10) |
| 0x10 | u16 | Attack Elements (Bitmaske) |
| 0x1C–0x23 | u8[8] | **8 Materiaslots** (s. 4.11) |
| 0x2A | u16 | Restrictions, bitinvertiert |

### 4.3 Armor — Sektion 7, **36 Byte/Record** (`Sections/ArmorData.cs:13, 55–86`)

| Offset | Typ | Feld |
|---|---|---|
| 0x01 | u8 | Element Damage Modifier (0 Absorb, 1 Nullify, 2 Halve, 0xFF Normal) |
| 0x02 | u8 | Defense |
| 0x03 | u8 | Magic Defense |
| 0x04 | u8 | Evade |
| 0x05 | u8 | Magic Evade |
| 0x06 | u8 | Status (Index) |
| 0x09–0x10 | u8[8] | 8 Materiaslots |
| 0x11 | u8 | Growth Rate |
| 0x12 | u16 | Equipable By |
| 0x14 | u16 | Elemental Defense |
| 0x18–0x1B | u8[4] | Boosted Stat 1–4 (`CharacterStat`, 0xFF = keiner) |
| 0x1C–0x1F | u8[4] | Boosted Stat 1–4 Bonus |
| 0x20 | u16 | Restrictions, bitinvertiert |

### 4.4 Accessory — Sektion 8, **16 Byte/Record** (`Sections/AccessoryData.cs:15, 72–90`)

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | u8 | Boosted Stat 1 |
| 0x01 | u8 | Boosted Stat 2 |
| 0x02 | u8 | Boosted Stat 1 Bonus |
| 0x03 | u8 | Boosted Stat 2 Bonus |
| 0x04 | u8 | Elemental Damage Modifier |
| 0x05 | u8 | Special Effect (s. 4.12) |
| 0x06 | u16 | Elemental Defense |
| 0x08 | u32 | Status Defense — ⚠️ als `u32` gelesen, aber auf den **Index**-Enum
  `EquipmentStatus` gecastet. Widersprüchlich; ein Record von 16 B lässt bei 0x08+4
  und 0x0C+2 und 0x0E+2 keinen Platz — vermutlich ist 0x08 eine 4-Byte-Maske und der
  Enumcast der Fehler. **Nicht ungeprüft übernehmen.** |
| 0x0C | u16 | Equipable By |
| 0x0E | u16 | Restrictions, bitinvertiert |

### 4.5 Materia — Sektion 9, **20 Byte/Record** (`Sections/MateriaData.cs:12, 55–67`)

| Offset | Typ | Feld |
|---|---|---|
| 0x00 | u16 | AP für Stufe 2 — **Wert × 100** |
| 0x02 | u16 | AP für Stufe 3 — × 100 |
| 0x04 | u16 | AP für Stufe 4 — × 100 |
| 0x06 | u16 | AP für Stufe 5 — × 100 |
| 0x0C | u8 | Element (`MateriaElements`, **Index 0x00–0x0F**, nicht Maske) |
| 0x0D | u8 | Materia-Typ, **nur untere 4 Bit** (s. 4.13) |

0x08–0x0B und 0x0E–0x13 wertet Elena nicht aus (dort liegen laut Community-Doku
Statuseffekte und die Attribut-Modifikatoren; Elenas `Materia.Status`/`EquipEffect`
bleiben unbefüllt).

### 4.6 Restrictions — bitinvertiert

`Items/Restrictions.cs:6–11`: `CanBeSold = 1`, `CanBeUsedInBattle = 2`,
`CanBeUsedInMenu = 4`. **Alle vier Parser lesen `~u16`** (`ItemData.cs:60`,
`WeaponData.cs:74`, `ArmorData.cs:83`, `AccessoryData.cs:85`): In der Datei steht
also eine **Verbots**maske („kann nicht verkauft werden"), die zur **Erlaubnis**maske
invertiert wird. Wichtiges Detail — ohne Invertierung ist die Bedeutung genau falsch.

### 4.7 Target Data — u8-Flags (`Battle/TargetData.cs:6–54`, gut dokumentiert)

| Bit | Bedeutung |
|---|---|
| 0x01 | Auswahl aktiv — Cursor darf ins Feld |
| 0x02 | Cursor startet in der Gegnerreihe |
| 0x04 | Standard: alle Ziele einer Reihe |
| 0x08 | Umschaltbar Einzel-/Mehrfachziel (bestimmt auch, ob Schaden geteilt wird) |
| 0x10 | Nur eine Reihe, Cursor darf sie nicht verlassen |
| 0x20 | **Kurze Reichweite** — halber Schaden, wenn Ziel oder Verursacher nicht vorn steht; unterliegt den „Cover Flags" |
| 0x40 | Alle Reihen |
| 0x80 | Zufallsziel aus der Auswahl |

### 4.8 Status — **zwei verschiedene Kodierungen** (`Battle/Statuses.cs`)

* `Statuses` (`:6–40`): **u32-Bitmaske**, `Death = 0x1`, `NearDeath = 0x2`,
  `Sleep = 0x4`, … `Imprisoned = 0x8000_0000` (32 Zustände, lückenlos in dieser
  Reihenfolge: Death, NearDeath, Sleep, Poison, Sadness, Fury, Confusion, Silence,
  Haste, Slow, Stop, Frog, Small, SlowNumb, Petrify, Regen, Barrier, MBarrier,
  Reflect, Dual, Shield, DeathSentence, Manipulate, Berserk, Peerless, Paralysis,
  Darkness, DualDrain, DeathForce, Resist, LuckyGirl, Imprisoned).
* `EquipmentStatus` (`:42–76`): **dieselbe Reihenfolge als Index 0x00–0x1F**.
  Ausrüstung speichert *eine Zustandsnummer*, Angriffe eine *Maske*. Diese
  Unterscheidung ist leicht zu übersehen und in Elena selbst inkonsistent
  angewandt (s. 4.4).

### 4.9 Elemente (`Battle/Elements.cs`)

* `Elements` (`:6–24`): u16-**Maske** — Fire 0x0001, Ice 0x0002, Bolt 0x0004,
  Earth 0x0008, Poison 0x0010, Gravity 0x0020, Water 0x0040, Wind 0x0080,
  Holy 0x0100, Restorative 0x0200, Cut 0x0400, Hit 0x0800, Punch 0x1000,
  Shoot 0x2000, Shout 0x4000, Hidden 0x8000.
* `MateriaElements` (`:26–44`): dieselbe Reihenfolge als **Index 0x00–0x0F**.

### 4.10 Equipable By — u16-Maske (`Equipment/EquipableBy.cs:6–20`)

Cloud 0x0001, Barret 0x0002, Tifa 0x0004, Aeris 0x0008, Red XIII 0x0010,
Yuffie 0x0020, Cait Sith 0x0040, Vincent 0x0080, Cid 0x0100,
**Young Cloud 0x0200, Sephiroth 0x0400** (die beiden Rückblende-Charaktere).

### 4.11 Materiaslot-Kodierung (`Equipment/MateriaSlot.cs:3–39`)

| Wert | Bedeutung |
|---|---|
| 0 | kein Slot |
| 1 | ungelinkt, **ohne** Materiawachstum |
| 2 | linke Seite eines Links, ohne Wachstum |
| 3 | rechte Seite eines Links, ohne Wachstum |
| 5 | ungelinkt, **mit** Wachstum |
| 6 | linke Seite eines Links, mit Wachstum |
| 7 | rechte Seite eines Links, mit Wachstum |

(4 ist nicht belegt — das Bit 0x04 ist offenbar das Wachstumsflag über der
Link-Tripelkodierung 1/2/3.)

### 4.12 Accessory Special Effect (`Equipment/AccessoryEffect.cs:3–14`)

0x00 Haste, 0x01 Berserk, 0x02 Curse Ring, 0x03 Reflect,
0x04 erhöhte Stehlrate, 0x05 erhöhte Manipulationsrate, 0x06 Wall, **0xFF keiner**.

### 4.13 Materiatyp aus dem unteren Nibble (`Materias/Materia.cs:19–52`)

`typ = data[0x0D] & 0x0F`:

| Nibble | Typ | Farbe |
|---|---|---|
| 2, 3, 6, 7, 8 | Command | gelb |
| 5 | Support | blau |
| 9, A | Magic | grün |
| B, C | Summon | rot |
| 0, 1, 4, D, E, F | Independent | lila |

### 4.14 Weitere Enums

* `CharacterStat` (`Equipment/CharacterStat.cs`): 0 Strength, 1 Vitality, 2 Magic,
  3 Spirit, 4 Dexterity, 5 Luck, **0xFF = keiner**.
* `GrowthRate`: 0 None, 1 Normal, 2 Double, 3 Triple.
* `DamageModifier`: 0 Absorb, 1 Nullify, 2 Halve, **0xFF Normal**.
* `SpecialEffects` (`Attacks/SpecialEffects.cs:6–64`, **Maske**, sehr gut
  kommentiert — nur nicht vom Parser benutzt):
  0x001 Schaden auf MP statt HP · 0x004 immer physikalisch rechnen ·
  0x010 HP-Drain anteilig · 0x020 HP+MP-Drain · 0x040 Diffusion (laut Kommentar
  ungenutzt, vermutlich nur Blade Beam) · 0x080 Statusabwehr ignorieren ·
  0x100 verfehlt, wenn Ziel **nicht** tot ist (Phoenix Down/Life) ·
  0x200 durch Reflect umlenkbar · 0x400 Verteidigung durchschlagen ·
  0x800 nicht automatisch auf ein Ersatzziel wechseln · 0x2000 immer kritisch
  (Death Blow). Bits 0x002, 0x008, 0x1000 sind **nicht** belegt.

---

## 5. LGP-Archiv (`LgpReader.cs`)

* Kopf: **12 Byte** „file header" (Creator-Feld), dann `u32` Dateianzahl (`:65–66`).
* TOC-Eintrag, **27 Byte** (`:70–73`):
  `char[20]` Name (NUL-getrimmt) · `u32` Zeiger auf die Daten · `u8` „options" ·
  `u16` „dupes"/Dateiversion.
* An der Zieladresse: erneut **`char[20]` Name + `u32` Länge**, danach die Rohdaten
  (`:47–51`).
* **Namenskonvention für Duplikate:** Elena stellt gleichnamige Einträge als
  `name$version` dar (`:27`) und löst beim Extrahieren nach `$` auf (`:32–41`).

➡️ **Rein bestätigend.** WebMidgars `packages/formats-lgp/src/constants.ts` kennt
dasselbe Layout **und darüber hinaus** die 30×30-Lookuptabelle, den Terminator
`FINAL FANTASY7`, die Konflikt-/Ordnertabellen und die gemessene Check-Byte-Semantik
(0x0E/0x0B). Elena **ignoriert Lookup- und Konflikttabelle vollständig** und liest
das Check-Byte nur als undeutetes „options". WebMidgar ist hier klar weiter.
Einziger möglicher Zugewinn: die `$`-Suffix-Konvention als **Benennungsschema für
Duplikate** in Werkzeug-/Mod-Oberflächen.

---

## 6. `.tex`-Texturen — vollständige Kopfbelegung

Quelle: `Converters/Tex.cs:204–268`. Der Kopf ist eine Folge von **59 `u32`-Feldern
= 236 Byte**, danach `PaletteData` (`PaletteSize × 4` B) und `ImageData`
(`Width × Height × BytesPerPixel` B).

Abgeleitete Offsettabelle (Feldindex × 4):

| Off | Feld | Off | Feld | Off | Feld |
|---|---|---|---|---|---|
| 0x00 | Version | 0x50 | BitsPerIndex | 0xA0 | NumGreenBits8 |
| 0x04 | Unknown1 | 0x54 | IndexedTo8bit | 0xA4 | NumBlueBits8 |
| **0x08** | **ColorKeyFlag** | **0x58** | **PaletteSize** | 0xA8 | NumAlphaBits8 |
| 0x0C | Unknown2 | 0x5C | NumColorsPerPalette (2.) | 0xAC | RedMax |
| 0x10 | Unknown3 | 0x60 | RuntimeData5 | 0xB0 | GreenMax |
| 0x14 | MinBitsPerColor | 0x64 | BitsPerPixel | 0xB4 | BlueMax |
| 0x18 | MaxBitsPerColor | **0x68** | **BytesPerPixel** | 0xB8 | AlphaMax |
| 0x1C | MinAlphaBits | 0x6C | NumRedBits | 0xBC | ColorKeyArrayFlag |
| 0x20 | MaxAlphaBits | 0x70 | NumGreenBits | 0xC0 | RuntimeData1 |
| 0x24 | MinBitsPerPixel | 0x74 | NumBlueBits | **0xC4** | **ReferenceAlpha** |
| 0x28 | MaxBitsPerPixel | 0x78 | NumAlphaBits | 0xC8 | RuntimeData2 |
| 0x2C | Unknown4 | 0x7C | RedBitmask | 0xCC | Unknown6 |
| **0x30** | **NumberOfPalettes** | 0x80 | GreenBitmask | **0xD0** | **PaletteIndex** |
| **0x34** | **NumColorsPerPalette** | 0x84 | BlueBitmask | 0xD4 | RuntimeData3 |
| 0x38 | BitDepth | 0x88 | AlphaBitmask | 0xD8 | RuntimeData4 |
| **0x3C** | **Width** | 0x8C | RedShift | 0xDC | Unknown7 |
| **0x40** | **Height** | 0x90 | GreenShift | 0xE0 | Unknown8 |
| 0x44 | PitchOrBytesPerRow | 0x94 | BlueShift | 0xE4 | Unknown9 |
| 0x48 | Unknown5 | 0x98 | AlphaShift | 0xE8 | Unknown10 |
| **0x4C** | **PaletteFlag** | 0x9C | NumRedBits8 | | |

➡️ **Alle sechs von WebMidgar benutzten Offsets (0x30, 0x34, 0x3C, 0x40, 0x4C,
0x58, 0x68) stimmen exakt überein** — unabhängige Bestätigung des Parsers in
`packages/formats-model/src/tex.ts` inkl. der Gesamtlänge 236.

**Drei Felder, die WebMidgar noch nicht auswertet:**

1. **0x08 = `ColorKeyFlag`.** WebMidgar hat dieses Feld realdatenseitig bereits als
   „Transparenzschalter" identifiziert (627/68-Korrelation, Kommentar in `tex.ts`) —
   **Elena liefert den Namen und damit die Bestätigung der Deutung.** 🟡→🟢.
2. **0xC4 = `ReferenceAlpha`.** Elena benutzt es als **Sentinel-Auflösung**:
   Ein Paletteneintrag mit **Alpha == 254 (0xFE)** wird durch `ReferenceAlpha`
   aus dem Kopf ersetzt (`Tex.cs:178`). Das ist eine **inhaltliche Regel, die
   WebMidgar fehlt** — dort wird das Palettenalpha unverändert übernommen.
3. **0xD0 = `PaletteIndex`** — die vom Asset selbst vorgeschlagene Standardpalette.
   WebMidgar wählt in `texToRgba` per Parameter mit Default 0.

**Palettenformat:** Elena liest je Eintrag **B, G, R, A** in dieser Reihenfolge
(`Tex.cs:173–178`) — **bestätigt WebMidgars sichtgeprüfte BGRA→RGBA-Umsetzung.**

Konvertierung: `TexConverter` bietet `ToBitmap/ToPng/ToGif/ToJpeg` mit
`preferPalette`-Parameter, der bei Bereichsüberschreitung stillschweigend auf 0
zurückfällt (`Tex.cs:159–162`). Reine 8-bpp-Indexlogik; nicht-palettierte Texturen
sind **nicht** unterstützt (identische Einschränkung wie WebMidgar S7).

---

## 7. Modding, Patching, Assetkonventionen

**Fehlanzeige — vollständig.** Systematisch geprüft: kein Schreibpfad, keine
Manifest-, Patch- oder Diffformate, keine Prioritäts-/Konfliktregeln, keine
Overridenamensräume, keine Signatur-/Hashprüfung, keine Konfigurationsdateien.
Einziger modding-naher Datenpunkt ist die `name$version`-Notation für
Namensdubletten in LGP (Abschnitt 5) und der Umstand, dass der Runner ein
Drittwerkzeug („Aalis LGP+UNLGP") im Pfad referenziert (`Runner/Program.cs:19`).

Der Vergleich mit `docs/MODDING-SUITE-MASTERPLAN.md` bzw.
`packages/modding/src/manifest.ts` (Capabilities, `assetHash`, `engineCompatVersion`,
mod-lokale Diagnose) ergibt: **WebMidgar ist Elena in diesem Bereich um das gesamte
Konzept voraus.** Elena liefert nichts, was `packages/modding` verbessern könnte —
außer indirekt: Ein Kernel-Editor-Feature (Werte von Items/Materia/Ausrüstung
verändern) bräuchte genau die Recordlayouts aus Abschnitt 4, was eine künftige
Capability `kernel-record-override` überhaupt erst denkbar macht.

---

## 8. Top-Funde, gereiht und Paketen zugeordnet

| # | Fund | Paket | Wirkung |
|---|---|---|---|
| 1 | **`0xF9` ist Rückverweis-Kompression**, nicht Steuerbyte: Argumentbyte, Länge `(args>>6)*2+4`, Rückversatz `args & 0x3F` ab `pos(0xF9) − 1 − offset`, `0xFF` beim Kopieren überspringen (§3.1) | `formats-kernel` (`text.ts`), `dialog` | **Fehlerbehebung.** 164 Fundstellen liefern derzeit verstümmelte Strings. Roadmapziel S13, im Code nicht umgesetzt. |
| 2 | **Lineares ASCII-Fenster endet bei 0x5F**, `0x60–0xE0` sind erweiterte Zeichen, `0xD0` = Leerzeichen (§3.2) | `formats-kernel` (`text.ts`) | **Fehlerbehebung.** WebMidgars Fenster reicht bis 0xBF und bildet ausgerechnet den Umlautbereich falsch ab. |
| 3 | **Recordlayouts Sektionen 5–9** vollständig: Item 28 B, Weapon 44 B, Armor 36 B, Accessory 16 B, Materia 20 B, mit Feldoffsets (§4.1–4.5) | `formats-kernel` (`records.ts`), `menu`, `battle-runtime` | Ersetzt reine Schrittweitenerkennung durch typisierte Records; Roadmapziel S13 „Records 4–9". |
| 4 | **`kernel2.bin`-Innenstruktur**: nach LZS-Entpacken Folge von `u32`-Längenpräfix + Nutzdaten, **nur Sektionen 10–27**; kernel2 hat **Vorrang** vor kernel.bin (§2.2) | `formats-kernel` | FINDINGS.md kennt bisher nur die Kompression, nicht den Aufbau. Schließt den kernel2-Pfad. |
| 5 | **`ReferenceAlpha` @0xC4**: Palettenalpha **254 ist ein Sentinel** und wird durch dieses Kopffeld ersetzt (§6) | `formats-model` (`tex.ts`), `render-actor`, `render-field` | Neue, bislang unbekannte Regel; betrifft die Transparenzberechnung. |
| 6 | **Restrictions sind bitinvertiert** — die Datei speichert Verbote, nicht Erlaubnisse (§4.6) | `formats-kernel`, `menu` | Ohne dieses Detail wäre die Bedeutung **exakt gegenteilig**. |
| 7 | **Status/Element existieren doppelt**: als Maske (Angriffe/Items) und als Index 0x00–0x1F bzw. 0x00–0x0F (Ausrüstung/Materia) (§4.8, §4.9) | `formats-kernel`, `battle-runtime` | Klassische Verwechslungsfalle; Elena selbst fällt bei Accessory darauf herein. |
| 8 | **TEX-Kopf 236 B, alle 59 Felder benannt**; die sechs von WebMidgar benutzten Offsets **bestätigt**, `ColorKeyFlag` @0x08 benannt, BGRA bestätigt (§6) | `formats-model` | Hebt WebMidgars 🟡-Deutungen auf 🟢 und benennt die restlichen Felder für künftige Formate (nicht-palettiert). |
| 9 | **Sektions-Paarungsregel** kernel.bin: 1–9 Records, 10–17 Beschreibungen, 18–25 Namen, Beschreibung *n* ↔ Name *n+8*; Key Items ohne Recordsektion (§2.1) | `formats-kernel` | Erlaubt, WebMidgars derzeit rein statistische Listenauswahl (`pickItemTextLists` über mittlere Länge) durch eine **strukturelle** Regel abzusichern. |
| 10 | **Target-Data-Flags** und **`SpecialEffects`-Maske** mit ausführlicher Semantik (§4.7, §4.14) | `battle-runtime`, `formats-battle` | Direkt verwertbare Kampfregeln (Kurzreichweite = halber Schaden, Reflect-Fähigkeit, Drain, „verfehlt wenn nicht tot"). |
| 11 | **Materiatyp aus dem unteren Nibble** von 0x0D, Zuordnung Nibble→Farbklasse (§4.13) | `formats-kernel`, `menu` | Kleine, aber nicht offensichtliche Ableitung. |
| 12 | **Namensplatzhalter reichen bis 0xF5** (inkl. `{Party 1..3}`), nicht nur bis 0xF0 (§3.2) | `dialog`, `formats-kernel` | Korrigiert die Roadmapannahme. |
| 13 | **LGP-Dublettennotation `name$version`** (§5) | `formats-lgp`, `modding` | Nur Benennungsidee für Werkzeugoberflächen; Format selbst ist bereits abgedeckt. |
| 14 | **Kernel-Container 27×(6-B-Kopf + gzip), `u16/u16/u16`** (§2) | `formats-kernel` | Rein bestätigend — WebMidgars Layoutentscheidung ist unabhängig belegt. |

**Für `packages/modding` konkret:** kein direkter Fund. Der einzige mittelbare
Beitrag ist Fund 3 — typisierte Kernelrecords sind die Voraussetzung für eine
künftige Capability „Kernelwerte überschreiben" (Balancing-Mods), die im heutigen
Manifest-Enum noch nicht vorgesehen ist.

---

## 9. Offene Fragen

1. **Accessory-Offset 0x08:** `u32`-Statusmaske oder `u8`-Index? Elenas Code ist in
   sich widersprüchlich (§4.4). Muss an Realdaten entschieden werden — 16-B-Record
   mit Feldern bei 0x08(4?), 0x0C(2), 0x0E(2) geht nur auf, wenn 0x08 vier Byte hat.
2. **Deutsche Zeichentabelle 0x60–0xCF:** Elena wirft diesen Bereich weg. Welche
   Bytes tragen ä/ö/ü/ß? Bleibt eine WebMidgar-eigene Ableitung (🔴 laut Roadmap).
3. **`0xF9`-Rückverweis: Quelle roh oder dekodiert?** Elena kopiert aus dem
   **rohen** Sektionsbytestrom, überspringt aber `0xFF`. Was passiert, wenn der
   Rückverweis in die Zeigertabelle oder in einen vorherigen String hineinreicht?
   Elena fängt nur `ArgumentOutOfRangeException` ab (`TextSection.cs:71`) — das
   Verhalten an den Rändern ist unbelegt.
4. **`0xE3` → 0x02:** Elena bildet auf ein Steuerzeichen ab, ohne es zu benennen.
   Zeilenumbruch, Seitenumbruch oder Textfensterwechsel?
5. **Elenas 2-Byte-Funktionsbytes** (`0xE1`, `0xE4–0xE9`, `0xF6–0xFD`): Sind das
   wirklich alle einparametrig? Widerspricht teilweise WebMidgars `0xFE: 1`.
6. **Kernel-Sektionen 1–4** (Command, Attack, Battle&Growth, Init): Elena parst sie
   **nicht** (`Sections/CommandData.cs` ist eine leere Klasse). Für `KernelInitData`
   (Savemap-Seed, Roadmapziel S13) liefert Elena nichts.
7. **`kernel2.bin`-Sektionszählung:** Elena nimmt fest 18 Sektionen an. Bricht der
   Loop bei anderen Sprachfassungen früher ab (Abbruchbedingung `offset < length`)?
8. **Weapon-Offsets 0x0A–0x0D, 0x12–0x1B, 0x24–0x29** und **Materia 0x08–0x0B,
   0x0E–0x13** sind unbelegt — dort liegen laut Community-Doku Statuseffekte,
   Attribut-Modifikatoren und die Materia-Attributsboni.
9. **TEX-Version-Feld @0x00:** Welche Werte kommen im Bestand vor, und ändert sich
   die Kopfbelegung mit ihnen? Elena prüft es nie.
10. **Tsunamods-Bezug:** Wo genau wird Elena im Tsunamods-/7th-Heaven-Stack
    konsumiert, und existiert dort ein *schreibender* Gegenpart (Kernel-Writer)?
    Aus diesem Repository allein nicht beantwortbar.
