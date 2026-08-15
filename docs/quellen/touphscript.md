# touphScript — Recherchenotizen (Clean-Room)

Quelle: <https://github.com/ser-pounce/touphscript>
Shallow-Clone: `…\scratchpad\repos\touphscript`, Commit `867ada5` („fix script text table offset bug", 2023-02-09, Autor „Luksy").
Version laut `readme.txt:1`: touphScript v1.5.0 (main() meldet noch v1.2.9 — `touphScript.exe.cpp:29`).

---

## 0. LIZENZ — KRITISCH

**Es gibt keine Lizenz.** Kein `LICENSE`/`COPYING`, kein Copyright-Header in irgendeiner Datei,
keine Lizenzangabe in `readme.txt` (geprüft per Volltextsuche über alle `*.cpp`, `*.h`, `*.txt`,
`Makefile`, `*.ini` — Treffer nur in den mitgelieferten Fremddateien `zlib.h`/`zconf.h`, die
unter der zlib-Lizenz stehen und nicht zum Projekt gehören).

**Folge: „All rights reserved".** Ohne Lizenzgewährung ist *jede* Übernahme von Quelltext
unzulässig. Für WebMidgar gilt daher strikt:

- ❌ **Nicht kopieren:** keine Codezeilen, keine Tabellenliterale, keine Kommentare.
  Besonders heikel, weil es *große Datenliterale* im Quelltext gibt und Datenliterale in einem
  Clean-Room-Verfahren am schlechtesten zu verteidigen sind:
  - `ff7exe.cpp:154-164` — 3 × 767 Einträge (Exe-Offsets, Längen, Typen). **Nie übernehmen.**
    Die Offsets sind ohnehin Ergebnis fremder Reverse-Engineering-Arbeit (siehe „DLPBs exe
    offset table", `readme.txt:278-279`), nicht aus Spieldateien ableitbar.
  - `script.cpp:657-674` — Opcode-Längentabelle (256 Einträge) des Field-Skripts.
  - `scene.cpp:265-282` — Opcode-Längentabelle der Battle-AI.
  - `field_ids.h` — 726 Field-Name→ID-Paare.
  - `Chars.txt` — 210 Zeilen Zeichentabelle (siehe §1: Herkunft).
  - `touphScript.ini:61` — 256-Byte-Font-Spacing-Tabelle.
- ✅ **Erlaubt und hier praktiziert:** Beschreibung der *Struktur* und der *Verfahren* mit
  Fundstellen. Alle Zahlenwerte unten sind entweder (a) Formatkonstanten, die WebMidgar selbst
  aus den Spieldateien des Nutzers misst, oder (b) als „fremd erarbeitet, nur als
  Prüfhypothese" gekennzeichnet.

### Herkunft der Daten — was ist Spieldatei, was ist Handarbeit?

| Datum | Herkunft | Clean-Room-Bewertung |
|---|---|---|
| Zeichentabelle (`Chars.txt`) | **Handgebaut**, externe Datei, zur Laufzeit geladen (`ffString.cpp:380-395`) | 🔴 Nicht übernehmen. WebMidgar muss den Versatz selbst ableiten — hat es bereits getan (`packages/formats-kernel/src/text.ts`, Versatz 0x20). Siehe §1.3 für einen *unabhängigen* Ableitungsweg. |
| Glyphenbreiten (Spacing) | **Aus der Spieldatei** `WINDOW.BIN`, Sektion 3 (`windowBin.h:30-36`) | 🟢 Unbedenklich: WebMidgar liest sie selbst aus der Installation. Nur die *Dekodierregel* ist Wissen (§4.1). |
| `max`/`choice`/`tab`-Breiten | **Aus `ff7.exe`** an 3 Einzeloffsets (`ff7exe.h:20`) | 🟡 Offsets sind Fremdarbeit; die *Existenz* dieser drei Werte ist die verwertbare Information. |
| Exe-Stringtabelle | Fremde Reverse-Engineering-Tabelle (DLPB) | 🔴 Nicht übernehmen. |
| Container-/Sektionslayouts | Aus dem Dateiformat ableitbar | 🟢 Beschreibung unbedenklich, WebMidgar verifiziert gegen Realdaten. |

### Reichweitenwarnung

touphScript deckt **ausschließlich die PC-Fassungen mit lateinischer Schrift** ab
(EN/US, DE, FR, ES, IT). **Japanisch wird nicht unterstützt**: es gibt keine Kana-Bereiche,
keine 0xF9-Dictionary-Behandlung und keine erweiterten Zeichenseiten 0xFA–0xFD
(`ffString.cpp:365-369` — die Einträge 0xFA–0xFF sind leer). Die Frage nach den JP-Tabellen
bleibt offen (§9).

---

## 1. Zeichenkodierung

### 1.1 Aufbau der Tabelle

`charMap` ist ein `vector<string>` mit **256 Einträgen**, zusammengesetzt aus zwei Teilen
(`ffString.cpp:380-395`, `ffString.cpp:365-369`):

1. **0x00–0xD1** (210 Einträge) aus der externen Datei `Chars.txt`, eine UTF-8-Zeile je Code.
2. **0xD2–0xFF** (46 Einträge) fest im Quelltext — Steuer-/Variablencodes, siehe §2.

Zeile *n* (1-basiert) der Datei ⇒ Bytewert *n−1*. Verifiziert: `Chars.txt` hat exakt 210 Zeilen,
und `choice = 0xE0` (`ffString.h:62`) liegt im angehängten Teil an Index 14 ⇒ Teil 2 beginnt bei
0xE0−14 = 0xD2 ⇒ Teil 1 endet bei 0xD1. ✔

### 1.2 Die zwei Regelmäßigkeiten (das eigentlich Verwertbare)

**Regel A — ASCII-Fenster:** 0x00–0x5E ↦ ASCII 0x20–0x7E, also `Codepunkt = Byte + 0x20`.
0x00 = Leerzeichen, 0x10 = `0`, 0x21 = `A`, 0x41 = `a`.
Das **bestätigt unabhängig** WebMidgars eigene Ableitung `DEFAULT_ASCII_OFFSET = 0x20`
(`C:\ff7-web\packages\formats-kernel\src\text.ts:61`).

**Regel B — Mac-Roman-Fenster:** 0x60–0xD1 folgen **Mac Roman 0x80–0xF1**, also ebenfalls
`MacRoman-Code = Byte + 0x20`. Das ist der Schlüsselbefund: die westliche FF7-Zeichentabelle ist
im Kern *Mac Roman minus 0x20*, mit einer Handvoll Abweichungen. WebMidgar kann die Tabelle
damit aus einer öffentlichen Standardkodierung erzeugen, statt sie abzuschreiben.

Abweichungen von Mac Roman (aus `Chars.txt` gegen die Mac-Roman-Referenz verglichen):

| Byte | touphScript | Mac Roman an Byte+0x20 |
|---|---|---|
| 0x61 | `Á` | `Å` |
| 0x84 | `Ù` | `§` |
| 0x85 | `Û` | `•` |
| 0x97 | `Σ` | `∑` |
| 0x98 | `Π` | `∏` |
| 0x9A | `⌡` | `∫` |
| 0x80 | `⌘` | `†` |
| 0xC0 | `■` | `‡` |
| 0xC1 | `▪` | `·` |
| 0xCA–0xCD | `í î ï ì` | `Í Î Ï Ì` (Kleinbuchstaben statt Großbuchstaben) |

Nicht belegte Codes werden als Literal `{96}`, `{195}`, `{209}` geführt — **die Zahl ist die
1-basierte Zeilennummer, also Bytewert + 1**: 0x5F, 0xC2, 0xD0. Ein Rückkodierer muss diese
Pseudo-Tags erkennen (`ffString.cpp:170-174`: Suche nach `"{" + op + "}"` in der Zeichentabelle).
0xAA ist eine leere Zeile (Mac Roman 0xCA = NBSP).

### 1.3 Quirks der Tabelle

- **Doppelbelegungen:** `Á` (0x61 und 0xC7), `í` (0x72/0xCA), `î` (0x74/0xCB), `ï` (0x75/0xCC),
  `ì` (0x73/0xCD). Beim Kodieren gewinnt immer der *erste* Treffer
  (`ffString.cpp:116-118`, lineares `find`) — die hohen Codes sind also nicht erreichbar.
  Ein Roundtrip Dump→Encode ist damit **nicht byteidentisch**. Für WebMidgars
  `modding`-Paket ist das der wichtigste Fallstrick.
- **Mehrzeichen-Einträge (Ligaturen/„Dictionary"):** 0xE2 = `", "`, 0xE3 = `.\"`, 0xE4 = `…\"`.
  Das ist die einzige Form von Textkompression in der westlichen Fassung — kein echtes
  Dictionary, sondern drei fest verdrahtete Digraphen. Ihre Pixelbreiten werden zur Laufzeit
  aus den Einzelbreiten summiert (§4.2).
- **Escapes im Dumpformat** (`ffString.cpp:29-36`): Backslash vor `#` (0x03), `\` (0x3C),
  `{` (0x5B), `}` (0x5D). Nach `{NEW}` (0xE8) wird beim Dump ein `\n` eingefügt.
- **Terminator:** 0xFF (`end`, `ffString.h:63`). Dekodierung bricht dort ab; Kodierung hängt
  ihn immer an (`ffString.cpp:75`).

---

## 2. Steuercodes — Gesamttabelle

Zwei Klassen: **Einbyte-Codes 0xE0–0xF9** direkt in der Zeichentabelle, und
**Zweibyte-Funktionen mit Präfix 0xFE**. Belegt in `ffString.h:58-67` und `ffString.cpp:360-374`.

### 2.1 Einbyte-Codes (Field & World)

| Byte | Dump-Tag | Bedeutung | Anmerkung |
|---|---|---|---|
| 0xD2–0xDF | — | unbelegt/leer in der Tabelle | |
| 0xE0 | `{CHOICE}` | langer Einzug für den Auswahl-Cursor | Breite = Zähler × Leerzeichenbreite, Standard 10 |
| 0xE1 | `\t` | Tab | Standard 4 Leerzeichen |
| 0xE2 | `", "` | Ligatur Komma+Leerzeichen | |
| 0xE3 | `.\"` | Ligatur Punkt+Anführungszeichen | |
| 0xE4 | `…\"` | Ligatur Auslassung+Anführungszeichen | |
| 0xE5, 0xE6 | — | leer/unbelegt | |
| 0xE7 | `\n` | Zeilenumbruch | erhöht Zeilenzähler |
| 0xE8 | `{NEW}` | Seitenumbruch: auf Bestätigung warten, Fenster leeren | setzt Zeilenzähler zurück |
| 0xE9 | — | leer | |
| 0xEA–0xF2 | `{CLOUD}` `{BARRET}` `{TIFA}` `{AERIS}` `{RED XIII}` `{YUFFIE}` `{CAIT SITH}` `{VINCENT}` `{CID}` | Namensersetzung Charakter | im Field einbytig |
| 0xF3–0xF5 | `{PARTY #1}` `{PARTY #2}` `{PARTY #3}` | Namensersetzung Gruppenplatz | |
| 0xF6–0xF9 | `〇 △ ☐ ✕` | PlayStation-Tastenglyphen | laut `readme.txt:308` erst ab 1.3.1 |
| 0xFA–0xFD | — | **leer** — in der JP-Fassung erweiterte Zeichenseiten, hier ungenutzt | 🟡 offen |
| 0xFE | Präfix | leitet Zweibyte-Funktion ein | §2.2 |
| 0xFF | — | **String-Ende** | |

*Achtung Kontextabhängigkeit:* 0xEA–0xF0 bedeuten in `kernel2.bin` etwas völlig anderes (§6),
und 0xF8 ist dort ein Fensterfarben-Code, keine Taste.

### 2.2 Zweibyte-Funktionen `0xFE <code>`

Basiscode `gray = 0xD2`; der Name ergibt sich aus `funcMap[code − 0xD2]`
(`ffString.cpp:50`, `ffString.cpp:360-363`).

| Sequenz | Tag | Parameter | Bedeutung |
|---|---|---|---|
| `FE D2` | `{GRAY}` | — | Farbe ab hier |
| `FE D3` | `{BLUE}` | — | |
| `FE D4` | `{RED}` | — | |
| `FE D5` | `{PURPLE}` | — | |
| `FE D6` | `{GREEN}` | — | |
| `FE D7` | `{CYAN}` | — | |
| `FE D8` | `{YELLOW}` | — | |
| `FE D9` | `{WHITE}` | — | |
| `FE DA` | `{FLASH}` | — | **Toggle** — braucht identisches Schluss-Tag (`readme.txt:105-106`) |
| `FE DB` | `{RAINBOW}` | — | **Toggle**, dito |
| `FE DC` | `{OK}` | — | auf Bestätigung warten (ohne Fenster zu leeren) |
| `FE DD` | `{WAIT n}` | u16 LE, 2 Byte | Verzögerung in Frames, 30 = 1 s, 0–65535 |
| `FE DE` | `{MEM1}` | — | Text aus Speicher, vom Skript vorher gesetzt |
| `FE DF`, `FE E0` | — | unbenannt | |
| `FE E1` | `{MEM2}` | — | wie MEM1 |
| `FE E2` | `{MEM3 o l}` | 2 × u16 LE, 4 Byte | Direktkopie aus dem Speicher: Offset, Länge — im Dump **hexadezimal** (`ffString.h:51-56`) |
| `FE E3`–`FE E8` | — | unbenannt | |
| `FE E9` | `{MAX}` | — | **Toggle**: erzwingt maximale Zeichenbreite bis zum nächsten `{MAX}` |

Beim Kodieren wird jedes unbekannte `{TAG}` in dieser Reihenfolge gesucht: Sonderfälle
WAIT/MEM3/NEW → `funcMap` (0xFE-Funktionen) → `mapVars` (0xE0/0xEA–0xF5) → Zeichentabelle
(`ffString.cpp:126-177`). Ein Tag, das nirgends passt, wirft „Unknown var".

### 2.3 Normalisierungsquirk `{CHOICE}` vs. Doppel-Tab

Beim Dump wird die Folge **0xE1 0xE1 (zwei Tabs) als `{CHOICE}` ausgegeben**
(`ffString.cpp:16-21`), und beim Kodieren wird umgekehrt ein Literal-Doppeltab zu **0xE0**
(`ffString.cpp:81-88`). Das ist absichtliche Reparatur (`readme.txt:109-111`: Square hat an
einigen Stellen zwei Tabs statt des Auswahl-Einzugs benutzt) — aber es ist eine
**verlustbehaftete Normalisierung**: Fenster, die zwei Tabs als reine Textausrichtung nutzen,
werden mitverändert.

---

## 3. Dumpformat (relevant für WebMidgar `modding`)

- UTF-8, BOM optional (`common.h:60-73`).
- Einträge getrennt durch eine Zeile aus ≥ 20 Bindestrichen (`touphScript.exe.cpp:20`,
  Delimiter `"----------"` wird dreifach geschrieben).
- **Leerer Eintrag = ignorieren** (beim Kodieren wird der Originaltext behalten,
  `touphScript.exe.cpp:515-516`) — das ist der Mechanismus für selektive Mods.
- Anzahl der Einträge muss exakt stimmen, sonst Abbruch (`touphScript.exe.cpp:512-513`).
- Fensterparameter als führende `#`-Zeile: `#[xycwhlt] werte…`
  (`touphScript.exe.cpp:443-494`). Bedeutung:
  `x`,`y` Position; `c` x automatisch zentrieren (x = 160 − w/2, `script.cpp:366-367`);
  `w`,`h` Größe (h in Zeilen, wird über `pxHeight` umgerechnet); `l`,`t` Position der
  Ziffern-/Uhranzeige; `o` erste/letzte Auswahlzeile (im Field-Zweig auskommentiert,
  `touphScript.exe.cpp:485-487`, im World-Zweig aktiv, Zeile 615-617).
  Gültigkeitsbereiche laut `readme.txt:134-138`: x 0–304, y 0–224, w 16–304, h/t 1–13.

---

## 4. Fenstergröße, Font-Metrik, Zeilenumbruch

### 4.1 Spacing-Tabelle aus `WINDOW.BIN`

`WINDOW.BIN` besteht aus **3 Sektionen**; Sektionskopf (`windowBin.h:17-28`):
`u16 komprimierteGröße`, `u16 unkomprimierteGröße`, `u16 (ignoriert)`, danach **gzip**-Daten
(zlib mit `MAX_WBITS+16`, `gzip.h:29`).

**Sektion 2 (die dritte) enthält 256 Byte Zeichenbreiten.** Dekodierregel — der zentrale Befund
(`windowBin.h:30-36`, identisch in `config.h:23-29`):

```
Breite_px(code) = (b & 0x1F) + (b / 0x20)
```

d. h. die unteren 5 Bit sind die Breite (bis 31 px), und **jedes gesetzte 0x20-Vielfache im
oberen Nibble addiert 1 px**. Ohne diese Regel kommen falsche Breiten heraus.

### 4.2 Aufbau des Arbeitsvektors (258 Einträge)

`getSpacingTable()` (`touphScript.exe.cpp:954-1009`) erweitert die 256 Byte um zwei Slots und
überschreibt einige:

| Index | Inhalt |
|---|---|
| 0x00–0xFF | Glyphenbreiten aus `WINDOW.BIN` |
| **0x100** | `max`-Breite — aus `ff7.exe` Offset 0x2E6F0A, Standard 26. **Halbiert** verwendet: im MAX-Modus zählt jedes Zeichen `0x100/2` px |
| **0x101** | Fensterpolsterung (`box_width_padding`), Standard 0x10 = 16 px — Startwert jeder Zeile und Rückfallwert |
| 0xE0 | `{CHOICE}` als **Anzahl Leerzeichen** (nicht px!), aus `ff7.exe` 0x231127, Standard 10 |
| 0xE1 | Tab als Anzahl Leerzeichen, aus `ff7.exe` 0x23108D, Standard 4 |
| 0xE2 | Breite(0x00) + Breite(0x0C) — Leerzeichen + Komma |
| 0xE3 | Breite(0x0E) + Breite(0x02) — Punkt + `"` |
| 0xE4 | Breite(0xA9) + Breite(0x02) — `…` + `"` |
| 0xEA–0xF2 | Breite des jeweils konfigurierten Charakternamens minus Polsterung |
| 0xF3–0xF5 | Maximum über 0xEA–0xF2 (Gruppenplätze) |

Standardname für die Breitenberechnung ist `"OOOOOOOOO"` (`config.cpp:10`) — `O` ist das
breiteste Standardzeichen (`readme.txt:200`).

### 4.3 Breitenberechnung `width()` (`ffString.cpp:283-326`)

```
lineWidth = newWidth = sp[0x101]                       // Polsterung
je Byte:
  0xFE 0xE9        -> MAX-Modus umschalten
  0xFE 0xDD        -> 2 Parameterbytes überspringen
  0xFE 0xDE/0xE1   -> += 5 * sp[0x10]        (MEM1/MEM2 = 5 Ziffernbreiten; MAX: 5*sp[0x100])
  0xFE 0xE2        -> Länge l aus Parameter; += l * sp[0x2F]   ('O'-Breite; MAX: l*sp[0x100])
  0xE7 / 0xE8      -> newWidth = max(newWidth, lineWidth); lineWidth = sp[0x101]
  0xE0             -> += sp[0xE0] * sp[0x00]           (MAX: sp[0xE0] * sp[0x100]/2)
  0xE1             -> += sp[0xE1] * sp[0x00]           (MAX: sp[0xE1] * sp[0x100]/2)
  sonst            -> += sp[byte]                      (MAX: sp[0x100]/2)
Ergebnis = ceil(max(lineWidth, newWidth))
```

Bemerkenswert: **Es gibt keinen automatischen Zeilenumbruch.** Die Breite folgt der *längsten
bereits vorhandenen Zeile*; Umbrüche stehen fest im Text (0xE7). FF7 rendert Text, es setzt ihn
nicht. Das ist für WebMidgars `dialog`-Paket die entscheidende Aussage: Layout = Messen +
Fenster dimensionieren, nicht Umbrechen.

### 4.4 Höhenberechnung `height()` (`ffString.cpp:328-358`)

Zeilen zählen: `\n` (0xE7) erhöht, `{NEW}` (0xE8) schließt eine Seite ab und setzt zurück; das
Ergebnis ist das **Maximum über alle Seiten**, gedeckelt bei **13 Zeilen**. Umrechnung in Pixel:

```
h_px = Zeilen * rowH1 + rowH2            (pxHeight, gedeckelt bei 217 px)
Zeilen = (h_px - rowH2) / rowH1          (lineHeight, gedeckelt bei 13)
```

⚠️ **Widerspruch im Repo:** `config.cpp:6-7` setzt `rowH1 = 16`, `rowH2 = 9`; die ausgelieferte
`touphScript.ini:56-57` setzt `box_height_part_1 = 16`, `box_height_part_2 = 25`. Effektiv gilt
also 16/25 (3 Zeilen ⇒ 73 px). Der Codestandard 9 ist vermutlich veraltet. **Für WebMidgar:
selbst messen, nicht übernehmen.**

### 4.5 Sonderfenster (Uhr / Zifferndisplay)

`autosize::action()` (`script.cpp:463-469`): Ist am Fenster ein `WSPCL` aktiv, überschreibt es
die Textmaße:
`w = (typ == 1 ? 72 : ziffern * 16) + 8` — Typ 1 = Uhr (80 px), sonst Zifferndisplay, wobei
`ziffern` aus dem `WNUMB`-Opcode stammt. `h = (Polsterung == 0x0E ? 38 : 29)` — eine unschöne
Heuristik am Polsterungswert. Der Anzeigeversatz wird auf (4,4) gesetzt.

---

## 5. Textorte und Containerlayouts

### 5.1 LGP-Archiv (`lgp.cpp`, `lgp.h`)

- Kopf: 12 Byte `"\0\0SQUARESOFT"`, dann `u32 Dateianzahl`.
- TOC-Eintrag, gepackt, 27 Byte: `char name[20]`, `u32 offset`, `u8 unk (0x0E beim Schreiben)`,
  `u16 conflict`.
- Danach eine Hashtabelle mit **30 × 30 = 900 Einträgen** à `{u16 offset; u16 count}`, plus
  `u16` Konfliktzähler.
- Hashfunktion (`lgp.cpp:69-78`): `h(name[0]) * 30 + h(name[1]) + 1`, wobei
  Ziffern → 0–9, `_` → `'k'-'a'` (10), `-` → `'l'-'a'` (11), sonst `tolower(c) - 'a'`.
- Je Datei im Datenbereich: `char name[20]`, `u32 size`, Daten.
- Dateiende: Literal `"FINAL FANTASY7"`.
- Beim Lesen wird der TOC nach Offset sortiert, beim Schreiben nach Hash.

### 5.2 `flevel.lgp` → Feldddatei (`field.cpp`)

Jede Felddatei ist **LZS-komprimiert**. Danach:
`u16 (0)`, `u32 Sektionsanzahl`, `u32 Offsets[n]`; an jedem Offset `u32 Sektionsgröße` + Daten.
touphScript berührt nur Sektion 0 (Skript + Text).
Feld erkannt an: kein Punkt im Namen und Name ≠ `maplist` (`field.h:13-17`).

**LZS** (`lzs.cpp`, `lzs.h`): klassisches LZSS nach Okumura.
Ringpuffer 4096 Byte, `maxMatch` 18, `minMatch` 2 (⇒ kodierte Längen 3–18), Startposition
`4096 − 18`. Ein Flagbyte steuert 8 Einheiten (LSB zuerst): Bit 1 = Literal, Bit 0 = Rückverweis
aus 2 Byte: `pos = b0 | ((b1 & 0xF0) << 4)`, `len = (b1 & 0x0F) + 2`, kopiert werden `len+1`
Bytes. Der Datei-Kopf ist `u32 komprimierteGröße` (ohne diese 4 Byte selbst).
❗ **Quirk:** Der Ringpuffer wird mit **0x00** vorbelegt (`lzs.cpp:16`), nicht mit 0x20 wie in
Okumuras Original. Wer 0x20 nimmt, bekommt am Dateianfang Müll.

### 5.3 Field-Skriptsektion 0 (`script.cpp:7-81`)

Kopf, gepackt, **32 Byte** (`script.h:43-55`):
`u16 unk1`, `u8 nEnts`, `u8 nMods`, `u16 strOfst`, `u16 akOfsts`, `u16 scale`, `u16 unk2[3]`,
`char szCreator[8]`, `char szName[8]`.

Danach: Entity-Namen `nEnts × 8 Byte` → AKAO-Offsets `akOfsts × u32` →
Skript-Offsets `nEnts × 32 × u16` (32 Skripte je Entity) → Skriptcode → Texttabelle bei
`strOfst` → AKAO-Blöcke.

**Texttabelle** (der interessanteste Teil):
`u16 Anzahl`, dann `u16 Offsets[]` **relativ zum Tabellenanfang**, dann die 0xFF-terminierten
Strings.
❗ **Die Anzahl ist unzuverlässig** (`script.cpp:49-59`): In `smkin_1`, `pillar_1`–`3`,
`blin66_1`–`5`, `blin67_1`–`4`, `blin671b`, `blin673b`, `blin68_1`–`2` steht 0, gemeint sind 256.
Korrekte Ableitung: **`Anzahl = (ersterOffset − 2) / 2`**. Genau das ist der letzte Commit
(„fix script text table offset bug"). Weitere Robustheitsfälle:
- Doppelte Zeiger (`ofst[1] == ofst[0]`) → zum nächsten abweichenden Zeiger weitersuchen.
- **Vertauschte Zeiger** (`ofst[1] < ofst[0]`) in der italienischen Fassung
  (`blin67_1`, `blin671b`) → `ofst[2]` als Ende nehmen (`script.cpp:71-73`).
- Skriptzeiger unterhalb von `strOfst` ignorieren (Feld `snw_w`, `script.cpp:32`).
- Felder ganz ohne Text: `life1`, `life2` (`script.cpp:47`).
- Beim Speichern zeigen leere Skripteinträge auf das *vorherige* Skript (`script.cpp:150-152`).

**Textbezogene Opcodes** (Werte aus `script.h:68-95`, Größen aus `script.cpp:657-674`):

| Opcode | Wert | Größe | Parameter |
|---|---|---|---|
| `MPNAM` | 0x43 | 2 | Text-ID (Feldname) |
| `MESSAGE` | 0x40 | 3 | Fenster-ID, Text-ID |
| `ASK` | 0x48 | 7 | Bank, Fenster-ID, Text-ID, erste Zeile, letzte Zeile, Variablenadresse |
| `WINDOW`/`FWINDOW` | 0x50 | 10 | Fenster-ID, dann 4 × u16: x, y, w, h(px) |
| `WSIZW` | 0x2F | 10 | wie 0x50 |
| `WSPCL` | 0x36 | 5 | Fenster-ID, Typ (0 = aus, 1 = Uhr, sonst Ziffern), x-Versatz, y-Versatz |
| `WNUMB` | 0x37 | 8 | Bank, Fenster-ID, u32 Wert, Ziffernzahl |
| `SPECIAL` | 0x0F | var. | Sub-Opcode, u. a. `SPCNM` = 0xFD (4 Byte), Text-ID an Byte 3 |

Es gibt **4 Fensterslots** (0–3) — überall `vector<...>(4)` in `script.h`.
Sub-Opcodes von `SPECIAL` liegen bei 0xF5–0xFF (`script.h:96-99`).
❗ **Quirk:** `PNAME` (0xF6) und `GMSPD` (0xF7) haben Größe 0 in `spOpSizes`
(`script.cpp:676-678`) — touphScript kennt ihre Länge nicht und wirft „Unknown (special)
opcode".

**Sprungmarken** (`script.cpp:478-560`): Sprungziele stehen bei `jmpf/jmpb` an Byte 1,
bei `ifub` an Byte 5, bei `ifsw/ifuw` an Byte 7, bei `ifkey*` an Byte 3, bei `ifprtyq/ifmembq`
an Byte 2. Kurze Formen sind 1 Byte, lange 2 Byte, und **die lange Variante ist immer
`kurzerOpcode + 1`** (`script.cpp:549`) — beim Überlauf über 0xFF wird der Opcode hochgestuft
und ein Nullbyte eingeschoben. Rückwärtssprünge zählen ab Opcodeposition, `jmpf` ab
Opcodeposition + 1, alle anderen ab der Parameterposition.

### 5.4 Tutorials (`.tut` in `flevel.lgp`, `tutorial.cpp`)

Layout: `u16` Offsettabelle, Anzahl = `ersterOffset / 2`; danach Abschnitte mit Opcodes:

| Opcode | Bedeutung |
|---|---|
| 0x00 | `{WAIT n}`, u16 LE |
| 0x02–0x0F | Tastenglyphen: `{UP} {DOWN} {LEFT} {RIGHT} {MENU} {CANCEL} {SWITCH} {CONFIRM} {SCROLLDOWN} {TARGET} {SCROLLUP} {CAMERA} {PAUSE} {ASSIST}` (Index = Opcodebyte) |
| 0x10 | Text: 1 Füllbyte (0x00), dann 0xFF-terminierter FF-Text |
| 0x11 | Ende |
| 0x12 | `{WINDOW x y}`, 2 × u16 — setzt den Ursprung für alle folgenden Fenster |
| > 0x12 | wird übersprungen |

❗ Der `enum ops` in `tutorial.h:19-22` widerspricht der Namensliste in `tutorial.cpp:131-134`
(`confirm = 0x09` vs. `"SWITCH"` an Index 8). Maßgeblich ist die Namensliste.
Nur drei Tutorialdateien existieren: `mds7_w.tut`, `mds7pb.tut`, `junpb.tut`
(`touphScript.exe.cpp:212-217`).

### 5.5 `KERNEL.BIN` (`kernel.cpp`, `kernel.h`)

- **27 Sektionen**, je Kopf: `u16 komprimiert`, `u16 unkomprimiert`, `u16 Index`, dann **gzip**.
- Beim Speichern wird der Indexzähler bei 9 gedeckelt (`kernel.cpp:79`) und ans Dateiende
  kommen 2 Nullbytes.
- **Sektion 3** = Startdatensätze der Charaktere. Namensfelder, je **12 Byte, 0xFF-gefüllt**:
  Cloud 0x10, Barret 0x94, Tifa 0x118, Aerith 0x19C, Red XIII 0x220, Yuffie 0x2A4,
  Cait Sith 0x328, Sephiroth 0x3AC, Cid 0x430 ⇒ **Satzabstand 0x84 = 132 Byte**.
  Spielrelevant sind laut `readme.txt:253-256` nur „Ex-SOLDIER" und „Sephiroth", und
  Änderungen greifen nur bei einem neuen Spielstand.
- **Sektion 2, Offset 0xF1C**: 64-Byte-**Nachschlagetabelle für `scene.bin`**. Sie listet den
  Index der ersten Szenendatei je 0x2000-Block; erster Eintrag 0x00, Rest mit 0xFF gefüllt.
  Neu berechnet aus den (komprimierten) Szenengrößen: sobald `0x40 + Σ Größen > 0x2000`,
  beginnt ein neuer Block (`kernel.cpp:51-67`). **Wer `scene.bin` ändert, muss diese Tabelle
  mitziehen.**

### 5.6 `kernel2.bin` (`kernel2.cpp`)

- **Ganze Datei LZS-komprimiert** (nicht gzip — anders als `KERNEL.BIN`).
- Danach **18 Sektionen** hintereinander: `u32 Sektionsgröße`, dann der Sektionsinhalt.
- Je Sektion: `u16` Offsettabelle, **Anzahl = ersterOffset / 2**, danach 0xFF-terminierte
  Strings.
- ❗ **Der Terminator-Scan muss variablenbewusst sein** (`kernel2.cpp:30-34`): Bytes
  **0xEA–0xF0 verbrauchen 3 Byte** (Code + 2 Parameter, beim Schreiben `0xFF 0xFF`) — sonst
  wird ein Parameter-0xFF fälschlich als Stringende gelesen.
- Sektionsreihenfolge (`kernel2.cpp:69-88`): 0 Kommandobeschreibungen, 1 Magie/Beschwörung/
  Feindfähigkeit/Limit-Beschreibungen, 2 Item-, 3 Waffen-, 4 Rüstungs-, 5 Accessoire-,
  6 Materia-, 7 Schlüsselitem-Beschreibungen, 8 Kommandonamen, 9 Magie-/Limitnamen,
  10 Item-, 11 Waffen-, 12 Rüstungs-, 13 Accessoire-, 14 Materia-, 15 Schlüsselitemnamen,
  16 sonstiger Kampftext, 17 Beschwörungsangriffsnamen.

**Variablen in kernel2** (`ffString.cpp:226-281`) — eigene Kodierung, **nicht** die des Fields:

| Byte | Tag | Länge |
|---|---|---|
| 0xEA | `{CHAR}` | 3 (Code + 2 Parameter) |
| 0xEB | `{ITEM}` | 3 |
| 0xEC | `{NUM}` | 3 |
| 0xED | `{TARGET}` | 3 |
| 0xEE | `{ATTACK}` | 3 |
| 0xEF | `{ID}` | 3 |
| 0xF0 | `{ELEMENT}` | 3 |
| 0xF8 | `{RED}` | 2 (`F8 02`) — Fensterfarbe rot |

⭐ **Das beantwortet direkt WebMidgars offene Frage** in
`C:\ff7-web\packages\formats-kernel\src\text.ts:63-72`, wo 0xF8 (594 Fundstellen) und 0xF9
(164) als „unerklärte, hypothetisch einbytige Steuerbytes" geführt werden: In kernel2-Kontext
ist **0xF8 zweibytig** und 0xEA–0xF0 sind **dreibytig**. Die Hypothese „einbytig" ist damit
widerlegt und die Zählung der unbekannten Bytes zu hoch.

### 5.7 `scene.bin` (`scene.cpp`, `scene.h`)

- **256 Szenendateien**, verpackt in Blöcken von **0x2000 Byte**.
- Blockkopf: **16 × u32 Offsets in 4-Byte-Einheiten** (`0xFFFFFFFF` = unbelegt).
- Jede Szenendatei ist **gzip**-komprimiert; unkomprimierte Größe fest **0x1E80**; komprimierte
  Daten werden mit 0xFF auf 4 Byte aufgefüllt.
- Textfelder in der unkomprimierten Szenendatei (`scene.h:35-38`), je **32 Byte, 0xFF-gefüllt**:
  Feind 1 = 0x298, Feind 2 = 0x350, Feind 3 = 0x408 ⇒ **Feindsatzabstand 0xB8 = 184 Byte**;
  Angriffsnamen ab **0x880**, 32 Einträge × 32 Byte.
- **0xC80** = Formations-KI-Skripte, **0xE80** = Feind-KI-Skripte.
- KI-Skriptblock zweistufig (`scene.cpp:57-82`): 16 × u16 Offsets → je Einheit erneut
  16 × u16 Offsets → Skripte; `0xFFFF` = null; abschließende 0xFF-Bytes werden abgeschnitten.
- **KI-Opcodes** (`scene.h:39-41`): `0x70` jmp-if-zero, `0x71` jmp-if-not-equal, `0x72` jmp
  (je + u16 Ziel), `0x73` Ende, **`0x93` Text** (direkt eingebetteter, 0xFF-terminierter
  FF-Text), `0xA0` Debug (2 Byte überspringen, dann 0-terminierter ASCII-String).
  Weil Text *inline* im Skript liegt, müssen bei Längenänderung alle Sprungziele
  nachgezogen werden (`scene.cpp:143-174`).
- **Szenentextvariable:** `{NAME n}` = **`EA 00 n`**, n = 0…11 ⇒ Cloud…Party #3
  (`ffString.cpp:180-224`). Wieder eine kontextabhängige Bedeutung von 0xEA.
- Dumpformat je Datei: Kopfzeile, Leerzeile, 3 Feindnamen, Leerzeile, 32 Angriffsnamen,
  danach optional die KI-Strings — **38 feste Zeilen** (`touphScript.exe.cpp:697-717`).

### 5.8 `world_us.lgp` (`world.cpp`, `world.h`)

- Datei **`mes`** = Textcontainer: `u16 Anzahl`, `u16 Offsets` (relativ zum Dateianfang),
  Strings. Anzahl ebenfalls über `(ersterOffset − 2)/2` abgeleitet.
- Dateien **`wm0.ev`** (Globus) und **`wm3.ev`** (Gletscher) = Eventskripte, gelesen als
  **u16-Wortstrom**.
- Opcodes: **`0x0324` = Fenster, `0x0325` = MESSAGE, `0x0326` = ASK** (`world.h:39`).
- Fensterparameter stehen **vor** dem Fensteropcode, in den vorangehenden Wörtern:
  `w[-7]` = x, `w[-5]` = y, `w[-3]` = Breite, `w[-1]` = Höhe in Pixeln (Zwischenwörter sind die
  Push-Opcodes). Text-ID: bei MESSAGE `it[-1]`, bei ASK `it[-6]`, erste/letzte Auswahlzeile
  `it[-4]` / `it[-2]`.
- ❗ Im World-Text fehlen Funktionen: **Tab und `{CHOICE}` sind field-only**
  (`readme.txt:180-181`).

### 5.9 `ff7.exe` (`ff7exe.cpp`, `ff7exe.h`)

**767 Stringeinträge**, je mit Offset, Länge und Typ. Die Offsets stammen aus fremder
Reverse-Engineering-Arbeit (`readme.txt:277-279`) — **nicht übernehmen**, nur das Typkonzept
ist interessant. **6 Speicherarten** (`ff7exe.h:21`, Verteilung ausgezählt):

| Typ | Anzahl | Verhalten |
|---|---|---|
| `def` (0) | 450 | FF-kodiert, feste Länge, letztes Byte auf 0xFF gezwungen |
| `rgb` (1) | 3 | **Jedes Byte um 0x73 versetzt** gespeichert, 0xFF-terminiert, sonst reines ASCII (`ff7exe.cpp:35-40`, `72-81`) |
| `unicode` (2) | 175 | roher Bytestring, 0-aufgefüllt, **nicht** FF-kodiert |
| `noffTerm` (3) | 68 | FF-kodiert **ohne** Terminator, feste Länge |
| `ffpadded` (4) | 25 | FF-kodiert, mit 0xFF aufgefüllt |
| `zeroterm` (5) | 46 | FF-kodiert, aber 0x00-terminiert und 0-aufgefüllt |

Weitere Exe-Adressen: `max`-Spacing **0x2E6F0A**, `choice` **0x231127**, `tab` **0x23108D**
(je 1 Byte), Item-Sortiertabelle **0x51FF48** (u16 × 320). Alle als *Dateioffsets* per
`seekg`/`seekp` verwendet.

**Item-Sortierung** (`ff7exe.cpp:129-152`): Aus den kernel2-Sektionen 10–13 (Item, Waffe,
Rüstung, Accessoire) entstehen 320 Namen; Eintrag **255 (Masamune)** wird herausgenommen,
der Rest alphabetisch sortiert, führende Leereinträge entfernt, Masamune an Position **0x99**
wieder eingefügt; leere Namen bekommen absteigende Indizes vom Ende her.

---

## 6. Sprachfassungen und Datenquirks

touphScript kennt keine Sprachumschaltung. Stattdessen erkennt es **einzelne kaputte Dateien
per Hash** (`touphScript.exe.cpp:863-892`, `touphScript.exe.h:87-89`) und repariert sie:

| Fassung | Datei | Reparatur |
|---|---|---|
| Spanisch | `loslake2` | AKAO-Zeiger bei Offset 0x68 um 1 erhöhen |
| Spanisch | `blue_1` | AKAO-Zeiger bei 0x48 um 1 erhöhen |
| Spanisch | `shpin_22` | Byte 0x336 auf 0xFF setzen (Textfehler) |
| Italienisch | `junpb.tut` | Byte 0x10 auf 0x3A setzen (Tutorial-Offset) |
| Italienisch | `blin67_1`, `blin671b` | vertauschte Textzeiger (im Parser abgefangen, §5.3) |
| Deutsch | `junpb.tut` | Tutorialfehler, laut `readme.txt:344` in 1.2.3 behoben |

Weitere Datenquirks aus `readme.txt:284-287`: In `itown2`, `mtcrl_8` und `zmind3` ist der
Feldname versehentlich ein doppelter Dialogstring; nur der zweite Eintrag ist im Spiel sichtbar.

`config.cpp:78-85` listet 16 Feldnamen als Schalter (`ealin_2`, `chrin_2`, `kuro_4`, `goson`,
`elmin4_2`, `psdun_2`, `gongaga`, `cosin1_1`, `games_2`, `mtcrl_9`, `elminn_1`, `blin67_2`,
`min51_1`, `lastmap`, `frcyo`, `fship_4`) mit zugehörigen Skript-Hashes
(`touphScript.exe.h:91-96`) — frühere Skriptpatches, in v1.5 nicht mehr angewandt. Sie markieren
aber genau die Felder, in denen Fragefenster/Zeilennummern problematisch sind
(`readme.txt:176-178`: `gaiin_5`, `junonl1` teilen sich Variablen).

**Fragefenster (`ASK`) sind der fragilste Teil:** `setWin::action()` (`script.cpp:343-352`,
`382-388`) verfolgt die Vergleichsvariable eines `ASK` und korrigiert anschließende
`IFUB`/`IFUBL`/`SETBYTE` auf die neuen Zeilennummern — d. h. Antwortzeilen zu verschieben
verändert Skriptlogik.

---

## 7. Dumpen/Kodieren — Ablauf

Zwei Modi, `d` und `e` (`touphScript.exe.cpp:23-110`). Pfade kommen aus `.ini`, sonst aus der
Registry (`HKLM\SOFTWARE\Square Soft, Inc.\Final Fantasy VII` bzw. die Steam-/Installer-Keys,
`touphScript.exe.cpp:1019-1023`), sonst aus dem lokalen Verzeichnis.
Beim Kodieren wird immer über eine Temp-Datei gearbeitet und erst am Ende kopiert — die
Originale bleiben bei einem Fehler intakt.
Fehlt eine Textdatei, wird die Datei trotzdem **auto-gesizt** (`touphScript.exe.cpp:428-431`).

---

## 8. Wichtigste Befunde für WebMidgar (nach Nutzen sortiert)

1. **Kontextabhängige Bedeutung von 0xEA–0xF0 und 0xF8 löst ein bestehendes offenes Problem.**
   → `packages/formats-kernel` (`src/text.ts`). In kernel2-Strings sind 0xEA–0xF0
   *dreibytige* Variablen und 0xF8 ein *zweibytiger* Farbcode; im Field sind 0xEA–0xF5
   *einbytige* Namensersetzungen. WebMidgars `DEFAULT_CONTROLS = {0xfe:1, 0xf8:1, 0xf9:1}`
   ist damit für kernel2 falsch parametrisiert. Die Textkodierung braucht ein
   **Kontextprofil** (field | kernel2 | scene | exe), keine globale Tabelle.
   0xF9 bleibt unerklärt — touphScript kennt es nur als PS-Glyphe `✕`.

2. **Die westliche Zeichentabelle ist „Mac Roman minus 0x20" mit ~14 Abweichungen.**
   → `formats-kernel`, `dialog`. Erlaubt eine *ableitbare* statt abgeschriebene Tabelle:
   Standardkodierung als Hypothese, Abweichungen über `germanLikeness` o. Ä. gegen die
   Installation verifizieren. Bestätigt zugleich WebMidgars gemessenen Versatz 0x20.

3. **Glyphenbreiten stehen in `WINDOW.BIN`, Sektion 3, mit nichttrivialer Dekodierregel**
   `(b & 0x1F) + b/0x20`. → `dialog/src/layout.ts` ersetzt damit `FALLBACK_GLYPHS`
   (dort ausdrücklich als 🟡 Ersatzmetrik markiert) durch echte Metrik.
   `WINDOW.BIN` = 3 gzip-Sektionen mit 6-Byte-Kopf.

4. **Fenstergröße = Messen, nicht Umbrechen.** → `dialog`. Breite = längste Zeile + Polsterung;
   Höhe = maximale Zeilenzahl je Seite (`{NEW}`-getrennt), Deckel 13 Zeilen;
   `h_px = Zeilen*16 + rowH2`. Variablen zählen mit Ersatzbreiten (Name = konfigurierte
   Breite, MEM1/2 = 5 Ziffern, MEM3 = Länge × `O`-Breite). Kein Autowrap im Spiel.

5. **Vollständige Steuercodetabelle Field/World** (§2) inkl. Parameterlängen — direkt
   verwertbar für `dialog` (Rendering: Farben, FLASH/RAINBOW als Toggles, WAIT in Frames,
   OK/NEW als Wartepunkte) und für `interpreter` (Textabruf).

6. **Textcontainer-Zählerfalle:** In Field-, World- und kernel2-Texttabellen ist der Zähler
   unzuverlässig; korrekt ist **`Anzahl = (ersterOffset − Offsetgröße)/Offsetgröße`**, plus
   Sonderfälle für doppelte und vertauschte Zeiger. → `formats-field`, `formats-kernel`.
   Das ist ein einzeiliger, aber spielentscheidender Robustheitsgewinn.

7. **LZS-Ringpuffer wird mit 0x00 initialisiert** (nicht 0x20). → `formats-field/src/lzs.ts`
   gegenprüfen. Ebenso: `kernel2.bin` ist LZS, `KERNEL.BIN`/`WINDOW.BIN`/`scene.bin` sind gzip.

8. **scene.bin-Layout inkl. KI-Skript-Textopcode 0x93 und die 64-Byte-Nachschlagetabelle in
   `KERNEL.BIN` Sektion 2 @ 0xF1C.** → `formats-battle`, `modding`. Wer Kampftext ändert,
   ändert Blockgrenzen und muss die Tabelle neu berechnen — sonst lädt das Spiel falsche
   Szenen.

9. **Fensteropcodes und die 4 Fensterslots** (`MESSAGE` 0x40, `ASK` 0x48, `WINDOW` 0x50,
   `WSIZW` 0x2F, `WSPCL` 0x36, `WNUMB` 0x37, `MPNAM` 0x43, `SPECIAL/SPCNM` 0x0F/0xFD).
   → `interpreter/src/opcodes.ts`, `field-runtime`. Inklusive der Regel
   „langer Sprungopcode = kurzer + 1".

10. **World-Map-Eventopcodes 0x0324/0x0325/0x0326 als u16-Wortstrom mit vorangestellten
    Fensterparametern.** → `formats-world`, `world-runtime`.

11. **Mod-Ergonomie: leerer Eintrag = ignorieren.** → `modding`. Ein sehr sauberes Muster für
    selektive Textpatches; WebMidgars `modding/src/resolver.ts` könnte dieselbe Semantik
    anbieten.

12. **Roundtrip ist verlustbehaftet** (Doppelbelegungen `Á/í/î/ï/ì`, Doppeltab→0xE0). →
    `modding`-Tests: Ein Dump→Encode-Vergleich darf nicht auf Byteidentität prüfen.

---

## 9. Offene Fragen

1. **Japanische Fassung komplett offen.** touphScript deckt sie nicht ab: keine Kana-Bereiche,
   kein 0xF9-Dictionary, keine erweiterten Seiten 0xFA–0xFD. Der Versuch, die von
   `readme.txt:86` zitierte Qhimm-Wiki-Seite `wiki.qhimm.com/FF7/Text_encoding` abzurufen,
   scheiterte an HTTP 403 (beide URL-Formen). **Nächster Schritt:** Qhimm-Wiki über einen
   anderen Weg lesen oder die JP-Tabelle direkt aus einer JP-Installation ableiten.
2. **Was ist 0xF9 wirklich?** In WebMidgars kernel.bin-Bestand 164 Fundstellen; touphScript
   kennt es nur als PS-Glyphe `✕` (Latin-Fassung) — das erklärt 164 Vorkommen kaum. Verdacht:
   In der JP-Fassung ist 0xF9 der Dictionary-/Erweiterungspräfix, und die westlichen Dateien
   enthalten Reste. Zu messen.
3. **0xFA–0xFD** sind in der Latin-Tabelle leer. Ungenutzt oder ungeklärt?
4. **`rowH2`: 9 oder 25?** Codestandard und ausgelieferte `.ini` widersprechen sich (§4.4).
   Aus einer echten Installation nachmessen.
5. **Sind die `ff7.exe`-Offsets Datei- oder virtuelle Adressen?** Sie werden als Dateioffsets
   benutzt, sehen aber wie RVA-nahe Werte aus (0x51FF48). Für WebMidgar irrelevant, solange
   Exe-Strings nicht angefasst werden — aber relevant, falls doch.
6. **Wie ist `WINDOW.BIN` Sektion 0 und 1 aufgebaut?** touphScript liest nur Sektion 2.
   Vermutlich Fensterrahmen-Grafik und Font-Textur — für `render-field`/`dialog` interessant.
7. **`SPECIAL`-Sub-Opcodes `PNAME` (0xF6) und `GMSPD` (0xF7):** Länge unbekannt
   (`spOpSizes` = 0). Aus Makou Reactor oder Realdaten schließen.
8. **`{MEM3}`-Semantik:** Offset in *welchen* Speicher? touphScript warnt ausdrücklich vor
   Änderungen (`readme.txt:123-127`). Für einen Interpreter muss das geklärt werden.
9. **AKAO-Blöcke** in Field-Sektion 0 werden nur durchgereicht — Layout unbekannt.
   → relevant für `audio`.
10. **Die 4 Fensterslots**: Sind das echte Hardware-/Engine-Slots (also max. 4 gleichzeitige
    Fenster)? Der Code behandelt sie als feste 4 — zu bestätigen.
