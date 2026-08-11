# Fremdquellen-Sichtung — 14 Repositorien + „Gears"-Dokument

Vollständige Auswertung externer Reverse-Engineering-Projekte auf verwertbare
Befunde für WebMidgar. Erhoben am 2026-08-10, je ein Rechercheauftrag pro Quelle.

**Zweck:** Fakten über die Originaldaten und die Original-Engine sammeln, die
eigene Messungen bestätigen, widerlegen oder abkürzen. **Kein Codeimport.**

---

## 1. Rechtslage — verbindlich

WebMidgar ist eine Clean-Room-Reimplementierung. Aus keiner der folgenden
Quellen darf Quelltext übernommen, übersetzt oder strukturell nachgebaut
werden. Verwertbar sind ausschließlich **Tatsachen über die Originaldaten**
(Offsets, Layouts, Opcode-Bedeutungen, Formeln) — solche Tatsachen sind nicht
urheberrechtlich geschützt, die Formulierung ihrer Beschreibung schon.

| Quelle | Lizenz | Einstufung |
|---|---|---|
| makoureactor | GPL-3.0 | viral — nur Fakten |
| FFNx | GPL-3.0-**only** | viral — nur Fakten |
| KimeraCS | GPL-3.0 | viral — nur Fakten |
| Aeris | GPL-3.0 | viral; **enthält echte Spieldaten** |
| Gaia | GPL-3.0 (`LZS.cs` separat Ms-PL) | viral — nur Fakten |
| FF7SND | GPL-3.0 | viral — nur Fakten |
| ff7tk | LGPL-3.0-or-later | schwächer viral — trotzdem nur Fakten |
| ff7-scarlet | MS-PL (§3(D)) | erzwingt MS-PL bei Weitergabe |
| Elena | MIT | permissiv, Namensnennung — trotzdem nur Fakten |
| touphScript | **keine** | all rights reserved |
| ff7-landscaper | **keine** (+ GPL-Portierungen ohne Hinweis) | all rights reserved, doppelt belastet |
| kujata (+ Forks) | **keine** (`package.json` sagt ISC) | ungeklärt |
| Workers | **keine** | all rights reserved |
| ff7-coaster | **keine** | ⛔ siehe unten |
| gears.pdf | keine Gesamtangabe; Kapitel Battle Mechanics © T. Fergusson 2001–2003 | Fakten ja, Prosa nein |

### ⛔ Sperrvermerke

1. **ff7-coaster ist dekompilierter Originalcode.** Jede Datei trägt
   „(c) 1997 Square / decompiled by ergonomy_joe", die Dateinamen sind
   `ff7.exe`-Adressen, zwei Binärbibliotheken sind aus dem Spiel
   herausgeschnitten. **Nicht hineinsehen.** Dasselbe gilt für die
   Nachbarrepos `ff7-worldmap`, `ff7-chocobo`, `ff7snobo.github.io`.
2. **makoureactor `src/core/field/BackgroundTiles.cpp:42-93`** enthält eine
   auskommentierte **Hex-Rays-Dekompilierung** der Retail-`ff7.exe`. Die
   Hintergrund-Projektion dort nicht lesen — eigenständig aus Messdaten
   herleiten.
3. **Aeris und kujata-data enthalten echte Spieldateien** (Felddateien, PNGs,
   abgeleitete Assets). Nie nach `C:\ff7-web`.
4. **Elena `Compression/LzsCompression.cs`** liest sich wie eine
   Dekompilierung — eigenes `formats-field/src/lzs.ts` ist ohnehin vorhanden.
5. **ff7tk** führt Sonys PSV/VMP-Signierschlüssel mit. Nicht in unseren Baum.

---

## 2. Belegte Mängel im eigenen Bestand

Beide unabhängig durch mehrere Fremdquellen gestützt und im Code verifiziert.

### 2.1 `0xF9` ist keine Steuersequenz, sondern eine Rückreferenz

`packages/formats-kernel/src/text.ts:72` führt `0xf9: 1` in `DEFAULT_CONTROLS`
und verwirft das Byte — der Kommentar dort nennt das selbst eine unbewiesene
Hypothese bei 164 Fundstellen. **Elena und ff7-scarlet implementieren es
übereinstimmend als Rückreferenz-Kompression:**

- Länge `((arg & 0xC0) >> 6) * 2 + 4` ⇒ 4, 6, 8 oder 10 Zeichen
- Rückversatz `arg & 0x3F`
- kopiert aus dem rohen Sektionsstrom ab `pos(0xF9) − 1 − versatz`,
  `0xFF`-Bytes werden übersprungen

Zwei unabhängige Implementierungen stimmen überein. Jede Fundstelle verliert
derzeit 4–10 Zeichen. `docs/ROADMAP-S13-S19.md:72` führt das bereits als nie
erledigtes S13-Ziel.

### 2.2 Das lineare ASCII-Fenster ist zu breit

`text.ts:41` setzt `to: 0xdf - offset` ⇒ 0xBF. **touphScript und Elena sagen
übereinstimmend: das lineare Fenster endet bei 0x5E.** Ab 0x60 gilt
**Mac Roman minus 0x20** mit rund 14 dokumentierten Abweichungen. Der Bereich
0x60–0xBF wird also falsch abgebildet — genau dort liegen die deutschen
Umlaute. Die Tabelle ist ableitbar (Mac Roman + Ausnahmeliste), muss also
nicht abgeschrieben werden.

Zusatz: `DEFAULT_CONTROLS` braucht ein **Kontextprofil**. In kernel2 sind
0xEA–0xF0 dreibytige Variablencodes und 0xF8 zweibytig; im Field gilt das
nicht.

---

## 3. Bestätigungen eigener Entscheidungen

| Eigene Festlegung | Bestätigt durch | Anmerkung |
|---|---|---|
| FOV-Basis 240 (S9/Kalibrierung) | kujata, makoureactor | beide: `fov = 2·atan(240/(2·zoom))` |
| Kameraachsen /4096, Y negiert, `C = −Rᵀ·t` | kujata, makoureactor, gears | FFNx ergänzt: `eye/target/up` sind **Basisvektoren**, keine Punkte |
| R4-Modellkonventionen B1–B4, B5/B6a | KimeraCS | unabhängige dritte Quelle |
| B9 Palettenalpha (gegen „Index 0"-Regel) | KimeraCS ist hier **falsch** | unsere Messung (7,7 % Übererkennung) bleibt gültig |
| S28-Weltkarten-Container (0xB800, 16 Meshes) | Gaia, ff7-landscaper | exakt deckungsgleich |
| Call-Tabelle 0x400, Mesh-Kennung `zeile·36+spalte` | ff7-landscaper | identische Rechnung |
| audio.dat-Satzregel, 724+26 | FF7SND | über `wNumCoef` statt `cbSize` parametriert |
| LGP-Lookup, Terminator, Prüfbyte | Elena, ff7tk, touphScript | wir sind hier weiter als alle drei |
| `state = log2(statePow2)` | Aeris, kujata, makoureactor | makoureactor präzisiert: `state` ist eine **Bitmaske** `1 << stateID` |

---

## 4. Widersprüche zwischen den Quellen — zu entscheiden

### 4.1 Blend-Modi und Texturseiten (höchste Priorität für S39)

Drei Quellen, drei Aussagen:

| Quelle | Aussage |
|---|---|
| Aeris | 4 Paare im Layer-1-Kopf; 15–25 additiv, 26–32 subtraktiv, 33–41 25 % additiv (15+11+7+9 = 42) |
| makoureactor | Bereiche 0–14 / 15–23 / 24–25 / 26–32 / 33–39 / 40–41 |
| FFNx | Typ-1-Seiten 0–14 opak, 15–23 additiv, 24–28 avg; **Modi 2 und 3 im PC-Original über keine Seite erreichbar** |

FFNx ist die Treibersicht und damit am nächsten an der Engine; es legt für die
fehlenden Modi eigene Kopien auf +14/+18 an und nennt Feld 347 (`fr_e`) als
Beleg, dass das Original dort falsch rendert. kujata bestätigt indirekt:
dessen subtraktives Blending ist nachweislich falsch — möglicherweise, weil es
gar nicht vorkommt. **Aufgabe: an unseren 647.531 Tiles messen, welche
Texturseiten tatsächlich belegt sind.**

### 4.2 Wurzeltranslation im Field

KimeraCS: **Y** wird negiert (X, Z unverändert), Battle nicht.
kujata: **Z** wird gespiegelt.
Prüfbar an einer Animation mit starker Vertikalbewegung.

### 4.3 Weltkarten-Funktionszahl

ff7-landscaper zählt 142 Funktionen in `wm0.ev`, wir 143. Zusätzlich schneidet
das Fremdprojekt Funktionskörper beim ersten `0x203` ab — falls unsere
„175/175-Abschluss"-Messung dasselbe tut, übersieht sie Code hinter frühem
RETURN. Grenze besser über den nächsten Tabelleneintrag bestimmen.

### 4.4 Kampf-Bildrate

kujata schwankt zwischen 7,5 und 15 fps. FFNx nennt die Zielraten des
Originals eindeutig: **Field/World 30, Kampf 15, Menü 60, Credits 39** — alle
Skript-Wartewerte sind Ticks dieser Rate.

---

## 5. Neue Befunde nach Baustelle

### S38 — Field-Aktoren

- **FFNx:** vollständige `field_event_data` (0x88 B): Position in
  1/4096-Festkomma, getrennte `collision_radius`/`talk_radius`,
  `rotation_steps_type` 0–3, Offset-Bewegung mit `n_steps`/`step_idx`.
- **FFNx:** KAWAI-Subcodes 0x0 EYETX, 0x1 TRNSP, 0x2 AMBNT, 0x6 LIGHT,
  0xD SHINE — Zustand ist **pro Modell persistent**, Reset bei Feldwechsel
  zwingend. Beleuchtung: 1 ambientes + 3 gerichtete Lichter je `field_object`,
  max. 32 Modelle.
- **makoureactor:** Modellskalierung in Sektion 3 steht als **4-Byte-ASCII-
  Dezimalzeichenkette** — die auffälligste Falle. Die Aktor↔Modell-Bindung ist
  implizit (laufender Index unter den Gruppen vom Typ *Model*), der Gruppentyp
  wird **allein aus dem ersten Opcode des Init-Skripts** erschlossen. Dazu 28
  Opcodes, die im Init-Skript die Engine abstürzen lassen.
- **KimeraCS:** die 22 `V_*` Render-State-Bitmasken, und entscheidend:
  `field_C` ist eine **Änderungsmaske**, `field_8` der Wert — ein
  Delta-Protokoll. Schließt den in R4 offenen Schritt „100-B-Blöcke roh
  konserviert".
- **KimeraCS + ff7-scarlet (unabhängig deckungsgleich):** Battle-Animation als
  Bitstrom — 1 Bit Achsflag, 3 Bit `dLen` mit Sonderfällen 0 (Delta −1) und 7
  (Rohwert `12−key` Bit), sonst Korrektur `± 2^(dLen−1)`, 12-Bit-Wrap,
  **4096 Einheiten = 360°**. Beide Frame-Zähler in der Datei sind
  konstruktionsbedingt falsch — bis Stromende lesen.

### S39 — Hintergrunddynamik

- **FFNx:** Animation = `background_sprite_layer[anim_group] &
  tile.anim_bitmask`, 64 Gruppen, gesetzt von BGON/BGOFF **und** vom
  `field_trigger`. Layer 1 ist nie animiert. Original-Bug: läuft im Menü
  weiter (`woa_*`-Desync).
- **FFNx:** vollständige Parallaxformel für Layer 3/4 (Position ÷16-Festkomma,
  Geschwindigkeit ÷256, Wrapping gegen `bg{3,4}_width/height`).
- **FFNx:** sichtbares Hintergrundfenster ist **352 × 256**, nicht 320 × 224;
  Positionen auf 1/10 Pixel quantisieren, sonst Nähte.
- **makoureactor:** Zeichenreihenfolge `4096 − tile.ID`; feste IDs 4096/4095/0
  für Layer 3/1/4, per-Tile-ID für Layer 2 ⇒ **Layer 2 verzahnt sich
  tiefenweise mit der Layer-1-Platte**. `BGPDH` überschreibt die ID einer
  ganzen Ebene (nur Layer 2/3) und sortiert neu.
- **makoureactor:** zweiter, leicht übersehener Pfad — **INF-Trigger** setzen
  `param`/`state` datengetrieben, mit 6-wertigem `behavior`-Enum;
  `background_parameter == 0xFF` = unbenutzt, ein Freigabebit existiert nicht.
- **makoureactor:** Direktfarbe — `0x0000` transparent, **`0x0821` = opakes
  Schwarz**, Bit 5 übersprungen; die „offizielle" PC-Portierungsformel ist
  belegt fehlerhaft.
- **makoureactor:** PC-Sektion 6 („Tiles") ist ungenutzt, enthält aber eine
  **zweite Kopie der Tiledaten im PS-Format** — geschenkter Quervergleich für
  den eigenen Parser.
- **kujata:** Umsetzungstechnik für Palettenanimation im Browser —
  Index-PNG (Palettenindex im Rotkanal) + Paletten-`DataTexture` 256×1 im
  Shader, damit werden STPAL/LDPAL/ADPAL/MPPAL zu Uniform-Updates.
- **Aeris:** Liste von **19 Feldern, deren Layer-Z das Skript setzt** statt der
  Daten — fertige Regressionsliste über `interpreter` + `render-field`.
- **gears:** das `Sfx`-Feld der Hintergrundsprites ist unverstanden;
  bestehende Implementierungen zeichnen solche Sprites gar nicht.

### Interpreter / Field-Skript

- **makoureactor:** vollständige 256-Einträge-Opcodetabelle mit Größe und
  typisierter Parameterliste, dazu SPECIAL (0x0F) und KAWAI (0x28).
- **makoureactor:** **Sprungbasisregel** — Ziel = Offset des Sprung*operanden*
  plus Rohwert (Shift-Tabelle 1/0/5/7/3/2); rückwärts nur JMPB/JMPBL ab
  Opcodebeginn; alle Rohwerte vorzeichenlos ⇒ IF-Sprünge sind ausschließlich
  vorwärts.
- **makoureactor:** `PLUS` läuft über, `PLUSX` sättigt — keine Dubletten.
- **makoureactor:** Textcodes **0xE7 = Zeilenumbruch, 0xE8/0xE9 = neue Seite**
  (verbreitet genau andersherum dokumentiert).
- **makoureactor:** Savemap-Bankpaare 1-2/3-4/5-6/11-12/13-14/**15-7**
  (asymmetrisch), Bänke 8/9/10 temporär.
- **gears:** Chocobo-Zucht ist vollständig im Field-Skript implementiert und
  formalisiert — idealer End-to-End-Test für den Interpreter.

### Kampf (`formats-battle`, `battle-runtime`)

- **gears:** die **19-stufige Schadenspipeline** mit exakter Reihenfolge und
  Floor-Semantik. Basis-Schaden physisch
  `Att + [(Att + Lvl)/32] * [(Att * Lvl)/32]`, magisch `6 * (MAt + Lvl)`.
  Absorb **toggelt** ein Negativ-Flag; HP↔MP-Materia vertauscht auch die Caps.
  Autor stuft die Reihenfolge selbst als „educated guess, ~99 %" ein.
- **gears:** Statusdauern in Zeiteinheiten; Haste/Slow verdoppeln/halbieren die
  Zeitrate, Stop friert alle Timer ein. `Df% = (Dex/4) + Armour Def%`.
- **gears (Bug):** Rüstungs-MDefense wird **nie** zu MDf addiert — PC und PSX,
  immer. Magischer Schaden ignoriert Rüstungs-MDef.
- **ff7-scarlet:** vollständiges 7808-B-Szenenlayout (Summe geht exakt auf),
  Battle-AI-Opcodetabelle 0x00–0xA1 **mit Pop-Count**, Zwei-Ebenen-Container
  (Gruppe → 16 Skript-Slots), Variablenraum `0x2xxx` global / `0x4xxx` aktor.
  Vermutung: die Variablenadressen sind **Bit**-Offsets (Δ CurrentHP→MaxHP =
  0x20 = 4 Byte) — an Realdaten prüfen.
- **ff7-scarlet:** Damage-Calculation-Byte dekodiert (oberes Nibble Schadensart
  + Trefferberechnung + Kritfähigkeit, unteres Nibble Formel, drei getrennte
  Formelräume).
- **ff7-scarlet + touphScript unabhängig:** wer `scene.bin` ändert, muss die
  64-B-Nachschlagetabelle in kernel.bin §3 neu berechnen.
- **gears:** vier Kampfnummern zeigen auf **eine** Szenendatei.

### Weltkarte

- **ff7-landscaper:** `field.tbl` in `world_us.lgp` — 64 Sätze à 24 B, je zwei
  Einträge (default/alternativ) mit `int16 x, int16 y, u16 triangle,
  u16 fieldId, u8 direction`. Löst den offenen Posten „Originalquelle der
  World↔Field-Einstiegspunkte".
- **ff7-landscaper:** Mesh-Skript-Auslöser — Dreiecks-`script`-Feld (3 Bit)
  ≥ 3 ⇒ Mesh-Funktions-ID = `script − 3`, 0 = kein Skript. Achtung: der Header
  hat 4 Bit, das Dreieck nur 3 ⇒ real nur 5 IDs erreichbar. Messen, ob IDs > 4
  vorkommen.
- **ff7-landscaper:** kompletter Opcodeblock 0x300–0x355 (~60 Kommandos mit
  Stelligkeit) — ersetzt die Fault-Politik für die verbleibenden
  Kommando-Instruktionen.
- **ff7-landscaper:** Terrain→Encounter-Set-Zuordnung liegt **nicht** in
  `enc_w.bin`, sondern in `ff7_en.exe` @ `0x56C8A0` (16 × 4 B). **Neue
  Abhängigkeit zu S37, in der Roadmap noch nicht abgebildet.**
- **Gaia:** `.BOT`-Konstruktion byteexakt — Block `4·cell + k` ist das
  2×2-Blockfenster `[b, b+1, b+cols, b+cols+1]` mit Torus-Wrap; WM0 = 252 + 80
  Sonderblöcke = 332. Belegt zugleich, dass die Engine ein 2×2-Fenster streamt.
- **Gaia + ff7-landscaper übereinstimmend:** Alternativgruppen 63→50, 64→41,
  65→42, 66→60, 67→47, 68→48.
- **Gaia:** `textureWord` zerfällt in `textureID = w & 0x1FF` und
  `locationID = w >> 9`; wir halten das Wort bislang roh.
- **ff7-landscaper:** Standardnormale `(0, −4096, 0)` ⇒ **−Y ist oben**.
- **ff7-landscaper:** Welt = `(mesh << 13) + lokal`.

### Speicherstände, Kernel, Text

- **ff7tk:** vollständige 0x10F4-Slotkarte (~120 benannte Felder), Prüfsumme
  **CRC-16/CCITT-FALSE über 0x0004–0x10F3**, Leerslot-Sentinel `0x4D1D`,
  Containermatrix für zehn Formate, gepackte Weltkoordinaten
  (X|mapID|angle / Y|Z), Item-Wort 9 Bit ID + 7 Bit Menge, 377
  Feld-Aufsammelflags als (Offset, Bit, Karte). **Warnung:** die Wachstums-
  kurven dort enthalten echte Fehler (Statustabelle mit 7 von 8 Werten,
  Bereichsüberlauf bei Level 82–99) — keine Grundwahrheit.
- **Elena:** Kernel-Recordlayouts 5–9 (Item 28, Weapon 44, Armor 36,
  Accessory 16, Materia 20 B); **Restriktionen sind bitinvertiert** (die Datei
  speichert Verbote, nicht Erlaubnisse); Status/Element existieren in zwei
  Kodierungen (Masken für Angriffe/Items, Indizes für Ausrüstung/Materia);
  kernel2 enthält **nur** die 18 Textsektionen 10–27 und überschreibt
  kernel.bin. TEX: alle 59 Kopffelder benannt, Palettenalpha **254 ist ein
  Sentinel**, ersetzt durch `ReferenceAlpha` @0xC4.
- **touphScript:** `WINDOW.BIN` Sektion 3 = 256 Glyphenbreiten mit der Regel
  `(b & 0x1F) + b/0x20` — ersetzt `FALLBACK_GLYPHS` in
  `dialog/src/layout.ts` durch Messwerte aus Spieldateien. **FF7 hat keinen
  Autowrap:** Breite = längste Zeile + Polsterung, Höhe = max. Zeilen je
  `{NEW}`-Seite, Deckel 13.
- **touphScript:** der gespeicherte Zähler jeder Texttabelle ist unzuverlässig
  (0 bedeutet 256 in ~15 Feldern) — korrekt ist `Anzahl = (ersterOffset−2)/2`.
- **touphScript:** LZS-Ringpuffer wird mit **0x00** vorbelegt, nicht 0x20.
  Gegen `formats-field/src/lzs.ts` prüfen.
- **gears:** LZS-Sonderfälle, die FF7 wirklich nutzt — negativer Versatz gibt
  Nullbytes aus, überlappende Läufe byteweise kopieren.

### Querschnitt

- **ff7-coaster (nur Faktum, Code gesperrt):** FF7 PC läuft mit **60-Hz-Fixed-
  Timestep über RDTSC, gedeckelt auf 32 Aufholticks je Frame**, wobei alle
  außer dem letzten mit abgeschaltetem Zeichnen laufen. Die Engine simuliert
  also **nicht** bildratenabhängig. Coaster, Highway und Snowboard teilen den
  Mechanismus. Dazu die 17-Einträge-LGP-Pfadtabelle.
- **ff7-coaster:** Sichtbarkeit im Minispiel ist **vorberechnetes
  Add/Remove-Skript**, kein Laufzeit-Culling.
- **FF7SND:** dekodiert nichts, sondern legt einen RIFF-Kopf um unveränderte
  `audio.dat`-Bytes — genau das belegt, dass die Nutzdaten byteidentisches
  Standard-MS-ADPCM sind. Feld +12 („Count") ist **unbelegt**: der Ursprungs-
  code von 2003 führte den Bereich als undurchsichtige Polsterung, die Namen
  stammen aus der Neufassung von 2020.
- **Workers:** `PEOPLE.BIN` = kopfloses Feld aus 64-B-Sätzen mit eigener
  Nur-Großbuchstaben-Zeichentabelle; Bytes 0x28–0x2E sind **sprachabhängig**,
  die Datei ist nicht selbstbeschreibend. Randnotiz für einen künftigen
  Abspann.

---

## 6. Abgeleitete Aufgaben

| # | Aufgabe | Paket | Grundlage |
|---|---|---|---|
| 1 | `0xF9` als Rückreferenz implementieren | formats-kernel | §2.1, zwei Quellen |
| 2 | ASCII-Fenster auf 0x5E begrenzen, Mac-Roman-Ableitung ab 0x60 | formats-kernel | §2.2, zwei Quellen |
| 3 | `DEFAULT_CONTROLS` nach Kontext (field / kernel2 / scene / exe) trennen | formats-kernel | touphScript |
| 4 | Texturseiten-Belegung an 647.531 Tiles messen, Blendgruppen entscheiden | formats-field, render-field | §4.1, drei Quellen uneins |
| 5 | Glyphenbreiten aus `WINDOW.BIN` statt `FALLBACK_GLYPHS` | dialog | touphScript |
| 6 | Textzähler auf `(ersterOffset−2)/2` umstellen | formats-kernel, formats-field | touphScript |
| 7 | `.BOT`-Fensterregel als rdtest | formats-world | Gaia |
| 8 | `field.tbl` parsen — World↔Field-Einstiegspunkte | formats-world, world-runtime | ff7-landscaper |
| 9 | Encounter-Set-Tabelle @ `0x56C8A0` in S37 aufnehmen | world-runtime | ff7-landscaper |
| 10 | 143-vs-142-Funktionen und die `0x203`-Körpergrenze klären | interpreter | ff7-landscaper |
| 11 | LZS-Ringvorbelegung 0x00 gegenprüfen | formats-field | touphScript |
| 12 | Wurzeltranslation Y- vs. Z-Spiegelung an Realanimation entscheiden | formats-model | §4.2 |
| 13 | Sektion 6 als Quervergleich für den Tileparser nutzen | formats-field | makoureactor |
| 14 | Bildraten 30/15/60/39 als Tickbasis verankern | field-runtime, battle-runtime | FFNx |

---

## 7. Detailnotizen

Je Quelle liegt eine ausführliche Notiz (Layouttabellen, Opcodetabellen,
Fundstellenverweise, offene Fragen) unter [`docs/fremdquellen/`](fremdquellen/)
— zusammen 10.854 Zeilen:

| Notiz | Zeilen | Notiz | Zeilen |
|---|---:|---|---:|
| [makoureactor.md](fremdquellen/makoureactor.md) | 1903 | [ff7tk.md](fremdquellen/ff7tk.md) | 671 |
| [ff7-scarlet.md](fremdquellen/ff7-scarlet.md) | 1199 | [kujata.md](fremdquellen/kujata.md) | 640 |
| [ff7-landscaper.md](fremdquellen/ff7-landscaper.md) | 974 | [touphscript.md](fremdquellen/touphscript.md) | 629 |
| [gears-pdf.md](fremdquellen/gears-pdf.md) | 944 | [ff7-coaster.md](fremdquellen/ff7-coaster.md) | 578 |
| [kimeracs.md](fremdquellen/kimeracs.md) | 897 | [ffnx.md](fremdquellen/ffnx.md) | 576 |
| [elena.md](fremdquellen/elena.md) | 543 | [gaia.md](fremdquellen/gaia.md) | 457 |
| [aeris.md](fremdquellen/aeris.md) | 422 | [ff7snd.md](fremdquellen/ff7snd.md) | 284 |
| [workers.md](fremdquellen/workers.md) | 137 | | |

Alle Notizen sind Beschreibungen mit Fundstellenverweisen — **kein
Fremdquelltext**. Die Verweise der Form `pfad/datei.cpp:zeile` zeigen in die
jeweiligen Klone, nicht in diesen Baum; sie dienen der Nachvollziehbarkeit,
nicht dem Nachschlagen.

Die Klone (~1,1 GB) lagen im Sitzungs-Scratchpad unter `…\scratchpad\repos\`
und sind nicht dauerhaft. **Der Klon `ff7-coaster` ist zu löschen und nicht
erneut anzulegen** (siehe Sperrvermerk 1).
