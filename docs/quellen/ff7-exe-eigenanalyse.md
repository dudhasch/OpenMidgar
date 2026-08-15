# `ff7_en.exe` — eigene Ghidra-Analyse (Recherchenotizen für WebMidgar)

Erhebungsdatum der Sichtung: 2026-08-15
Quelle: `C:\ff7-daten-kopie\FINAL FANTASY VII\decomp\` — **kein Repositorium**,
sondern ein lokaler Dokumentenbestand. Entstanden 2026-08-11 bis 2026-08-15 in
acht Analyserunden.
Freigabe: [ADR-028](../ADR-028-EIGENE-CODEANALYSE.md), ohne Auflagen.

---

## 0. EINORDNUNG UND WARNUNG (zuerst lesen)

**Das ist keine Fremdquelle.** Der Bestand ist erstbeteiligt erhoben — die
eigene Analyse einer legal erworbenen eigenen Kopie. Es gibt keinen Dritten,
dessen Rechte am *Text* dieser Dokumente zu beachten wären. Er wird hier
geführt, weil dies das Quellenregister des Projekts ist; das Verzeichnis heißt
seit ADR-028 deshalb `quellen/` und nicht mehr `fremdquellen/`.

Was bleibt, ist die Frage des abgeleiteten Werks **am Original**, und dazu drei
Feststellungen:

- **Der Bestand wird nicht in diesen Baum eingecheckt.** Er ist Dokumentation
  über ein urheberrechtlich geschütztes Binärprogramm, und der Zweig
  `pseudocode\` enthält **dekompiliertes C**. Derselbe Grund wie bei
  Sperrvermerk 3 (Aeris, kujata-data), nicht derselbe wie bei den durch ADR-027
  aufgehobenen Sperren.
- **Nichts daraus wird eingebettet oder verteilt.** Das BYO-Data-Modell ist
  unberührt: Werte entstehen weiterhin erst auf dem Rechner des Nutzers aus
  dessen eigener Installation.
- **ADR-028 hat die Auflage „keine Textübernahme" aufgehoben.** Eine zeilenweise
  Übersetzung von dekompiliertem C nach TypeScript ist damit zulässig. Sie
  bleibt trotzdem die schlechtere Arbeitsweise — nicht aus Regelgründen, sondern
  weil eine Übersetzung die Fehler des Originals mitübersetzt und weil dieser
  Bestand eine gemessene Fehlerquote hat (§2).

Neben den Dokumenten liegen dort drei Ghidra-Projektarchive
(`ff7_en_annotated_v6/v7/v8.gzf`, je ~32 MB), `_data\{functions,functions_sized,
strings}.csv` und `_tools\*.ps1`. **`strings.csv` ist extrahierter Spielinhalt**
— für dieses Projekt gilt dort weiterhin „Fundstelle statt Fundstück" (S37).

---

## 1. Was der Bestand ist

Nachgezählt am 2026-08-15, nicht aus der Selbstauskunft übernommen:

| | gemessen | Selbstauskunft |
|---|---|---|
| Markdown gesamt | **97 Dateien, 8,62 MB** | „~9 MB" |
| `spec\` | 21 Dateien, davon **16** `spec-*.md` | README: „13 Dokumente" (Runde 7) + 3 Livedokumente aus Runde 8 |
| `pseudocode\` | **74** Dateien | README: „76 Dokumente, 6,4 MB" — **auf der Platte sind es 74** |
| `findings.md` | 496.689 B (485 KiB), 5.399 Zeilen | — |
| `function-index.md` | 336.797 B (329 KiB) | — |
| Ghidra-Datenbank | `ff7_en_annotated_v8.gzf`, 32.921.967 B | 10.791 Funktionen, 4.884 benannt (45,3 %) |

**Bezugsbinär:** `ff7_en.exe`, 6.421.856 B, DotEmu-/Square-Enix-Neuveröffentlichung
2012, 32-bit x86 PE, MSVC, Imagebasis `0x00400000`, `VA = fileOffset + 0x401600`.
**Bezugsdaten:** der `data\`-Baum derselben Installation, die auch
`WEBMIDGAR_REAL_DIR` liest.

### Zwei Ebenen, und der Unterschied entscheidet, welche man nimmt

| | `spec\` | `pseudocode\` |
|---|---|---|
| Adressat | „ein TypeScript-Entwickler, der nie Ghidra öffnet und keine Kopie der EXE besitzt" | „jemand mit einem Disassembler in der Hand" |
| Inhalt | Layouttabellen, explizite Ganzzahlsemantik (`\| 0`, `>>> 0`, `Math.trunc`, abschneidende vs. abrundende Division), 277 Testvektoren | dekompiliertes C, Adressen, Kontrollfluss |
| Für uns | **erste Wahl** | nur, wenn `spec\` die Frage nicht abdeckt |

### Die Live-Ebene ist die stärkste

Runde 8 hat einen Debugger an ein **laufendes** `ff7_en.exe` gehängt und in drei
Spielzuständen Speicher gelesen (Feld `md1stin`, im Kampf, Weltkarte).
`spec-live-ground-truth.md` führt jede Adresse mit Live-Wert und einem
Urteil statisch-vs-Laufzeit. Zwei Randbedingungen machen die Aufnahmen
belastbar: **keine ASLR** (Ghidra-VA = Laufzeit-VA, 1:1), und **FFNx ist nicht
geladen** (der Treiber ist das ausgelieferte DotEmu-`AF3DN.P`, 195.752 B) — die
Aufnahmen sind also nahezu unmodifiziert.

---

## 2. Zuverlässigkeit — der Grund, warum dieser Eintrag existiert

Der Bestand misst seine eigene Fehlerquote und veröffentlicht sie. Das ist die
wertvollste Eigenschaft, die eine Quelle haben kann, und sie ist bindend für
jeden, der daraus baut.

**Die Bauproben der Runde 7 fanden 131 Defekte in den Spezifikationen selbst**,
darunter **vier falsche Testvektoren** — die schlimmste Klasse, weil korrekter
Code gegen einen falschen Vektor kaputt aussieht. Von 167 gefundenen
Baublockern wurden 119 (71 %) im Dokument geschlossen, 48 sind offen.

Die Regel, die der Bestand daraus selbst ableitet:

> Alles, was aus gelieferten Bytes abgeleitet ist, reproduzierte nahezu perfekt;
> alles, was als Fließtext statt als Code geschrieben war, war etwa zur Hälfte
> falsch.

Daraus folgt für uns, unabhängig von jeder Freigabe:

1. **Tabellen, Bytedumps und Testvektoren sind belastbar. Fließtext ist es nicht.**
2. **`Measured` lesen, nicht `Claimed`.** Die Bereitschaftstabelle in
   `spec/README.md` führt beide Spalten; in **vier** Fällen widersprechen sie
   sich, und die Bauprobe behält recht.
3. **`spec-live-ground-truth.md` §9 zuerst lesen.** Das ist die Liste dessen, was
   die Live-Messung selbst falsch hatte. Der lehrreichste Fall: Die erste
   Kampfaufnahme erklärte „max HP kommt im Kampfrecord nirgends vor" — möglich
   nur, weil das einzige Partymitglied auf **vollen HP** stand (302 = 302), wo
   aktuell und maximal ununterscheidbar sind. **Ein Aktuell/Maximum-Paar nur
   gegen ein Ziel prüfen, das nicht voll ist.**
4. **Eine Aufnahme kann nur ein Feld widerlegen, das sie auch benutzt.** Mehrere
   „Feld ist tot"-Urteile stammten aus einem Spielstand mit **null** Kämpfen.
5. **Herkunftsmarken mitführen, nicht einebnen:** `[LIVE-SELF]` (live gelesen und
   gegen Rohdumps nachgeprüft), `[STATIC]` (aus dem Disassemblat),
   `[AGENT]` (Ergebnis eines Analyseläufers, nicht nachgeprüft),
   `[1-SAMPLE]` (genau einmal beobachtet). **`[AGENT]` und `[1-SAMPLE]` werden
   in unserem Baum nie 🟢** — das folgt aus der Beweisklassenordnung, nicht aus
   einer Auflage.

`spec/index-by-package.md` führt ab Zeile 135 **je Dokument einen eigenen
Zuverlässigkeitsvorbehalt** — 96 Zeilen, eine pro Dokument. Das ist die Angabe,
die ein `grep` nie mitliefert. Drei Beispiele, weil sie die Bandbreite zeigen:

- `pseudocode/animation.md` — „das am wenigsten gehärtete Dokument des
  Bestands: keine gegnerische Runde, kein Korrekturabschnitt". **Betrifft K9
  unmittelbar.**
- `pseudocode/limit-breaks.md` — vier Kommentare bezeichnen
  Charakterrecord-Offsets fälschlich als Savemap-Offsets; wörtlich befolgt liest
  man Nullen.
- `pseudocode/localisation.md` — „die eigene Kernaussage des Dokuments ist für
  den aufgenommenen Prozess **falsch**", und der Text unterhalb des
  Korrekturkastens argumentiert die widerlegte Position weiter.

---

## 3. Erste eigene Gegenprobe — bestanden, und sie hat mehr ergeben als die Vorlage

Nachgemessen am 2026-08-15 an der Installation, ohne eine einzige Instruktion zu
lesen: `KERNEL.BIN`-Sektionen sind gzip hinter einem 6-Byte-Kopf, also mit einem
Standardaufruf entpackbar und direkt vergleichbar.

```
Sektionen:        data\kernel = 27,  data\lang-en\kernel = 27
Sektionen 0,1,4,5,6,7,8:  byteidentisch
Sektion 2 (3988 B):       28 Byte verschieden
Sektion 3 (2876 B):        3 Byte verschieden  ->  "Ex-SOLDAT" / "Ex-SOLDIER"
Sektionen 9..26:          durchweg verschieden (auch in der Länge)
```

Das deckt sich mit der Angabe des Bestands. **Weiter geht die eigene Messung
bei Sektion 2:** Alle 28 abweichenden Bytes liegen im 64-Byte-Blockindex bei
`+0x0F1C` — der Tabelle „Block → erste Szene" für `scene.bin`:

```
data\kernel  : 34 Einträge -> data\battle\scene.bin         278.528 B / 8192 = 34   TRIFFT
data\lang-en : 33 Einträge -> data\lang-en\battle\scene.bin 270.336 B / 8192 = 33   TRIFFT
```

Das Accounting geht in beide Richtungen byteexakt auf.

**Damit ist eine Selbstwidersprüchlichkeit des Bestands entschieden.**
`spec-live-ground-truth.md` §11 nennt diese Tabelle „ein kumulatives
Offset-/Breitenfeld, dessen Leser nicht identifiziert ist", und schließt daraus,
man dürfe nicht annehmen, der sprachabhängige Teil der `kernel.bin` beschränke
sich auf die Textsektionen. §3 desselben Dokuments identifiziert dieselbe
Tabelle jedoch bereits als scene.bin-Blockindex. Die Messung entscheidet für §3,
und die praktische Folgerung dreht sich um: Der Unterschied ist **keine
Übersetzung**, sondern eine **Packungsfolge** — die deutsche `scene.bin`
komprimiert in einen Block mehr.

Die harte Regel, die daraus folgt und die unser Code einhalten muss:

> 🟢 **`kernel.bin` und `scene.bin` müssen aus demselben Locale-Zweig stammen.**
> Gemischt zeigt der Blockindex in die falsche Datei.

Der Bestand kommt zur selben Warnung aus anderer Richtung
(`index-by-package.md` zu `spec-file-formats.md`: „mixing them corrupts scene
lookup") — zwei unabhängige Wege, ein Ergebnis.

---

## 4. Was wir daraus verwerten können, nach Posten der `PROJEKTSTAND.html`

Fundstellen sind Dateiname plus Abschnittsanker; Zeilennummern sind flüchtig und
stehen deshalb nur dort, wo sie einen langen Abschnitt aufschließen.

### Kampf — die dichteste Abdeckung

| Posten | Fundstelle |
|---|---|
| Zahlengleiche Schadensformeln (*versperrt*) | `spec/spec-battle-formulas.md` §5.0 Pro-Treffer-Kette, §5.3 Formel 0x01, §5.8 die vier gemeinsamen Nachbearbeiter **in Reihenfolge**, §4 das Schadensbyte, §11 Testvektoren |
| Treffer- und Kritischwurf | dito §6.5, §6.9 |
| Was die Nibbles des Schadensbytes wählen | `pseudocode/damage-nibbles-final.md` — ⚠ die „0xC/0xD/0xE sind tot"-Urteile sind Formargumente, keine Beobachtungen |
| ATB-Timing (*versperrt*) | `pseudocode/battle-core.md` §3 `Battle_TickAtbAndGauges`, §2 Phasenmaschine, Aktor-Timingrecord 10 × 0x44 — ⚠ die 60-Hz-Angabe ist ausdrücklich *nominal* |
| Wer zuerst handelt, Fluchtuhr | `pseudocode/ai-vm-unknowns.md` §4, §6 |
| Statuseffekte (Immunitätsfeld `u32@0xB0`) | `pseudocode/status-effects.md` Bit→Name-Tabelle, `Battle_BuildStatusImmunityMask`, 16 Statustimer, Verwirrung; `spec/spec-battle-formulas.md` §7, §8.1 |
| Kampfkamera (K8) und `camdat` (K11) | `spec/spec-battle-camera.md` — Archiv plus drei Kamera-VMs (Auge 33 Ops, Fokus 25 Ops, Beschwörung 12 Modi); `pseudocode/camera-vms.md` |
| Battle-Animationen `da` (K9) — **eingelöst** | `pseudocode/battle-actors.md` **§5 und §6** — die Satzkette und der Bitstrom, vollständig. Am Abbild gegengelesen: `BattleModel_LoadAnimBank` `0x005E82DE`, `BattleModel_DecodeAnimation` `0x005E7DE4`, `BattleModel_DecodeAnimFrame` `0x005E7680`, Bitleser `0x005E7C40` / `0x005E7B7B` / `0x005E7CE4`. **Beide Lesungen stimmen in jedem Feld überein** — der einzige Fall im Bestand, in dem ein Dossier eine Formatfrage vollständig und ohne Abweichung trägt. Namensbildung: `BattleModel_ResolveArchiveName` `0x005E2460` (Suffixcode `.D`→0, `.B`→1, `.A`→78 — daher `aa`, `ab`, `da`). Konstanten am Abbild geprüft: `0x007B77EC` = `1.0f`, `0x007B77F0` = `360.0f`. Was das Dossier **nicht** hat: die leeren Platzhalter, `align4(5+stromBytes)`, die schwankende Gelenkzahl — das kam aus der Messung |
| Magie/Effektdarstellung | `spec/spec-battle-effects.md`; `pseudocode/fx-*.md` — ⚠ nur Spritepfad; 1.179 von 2.160 Assetrecords ohne definierte Darstellung |
| Szenenformat, Formationen | `spec/spec-file-formats.md` §8; `pseudocode/scene-bin.md` — nur Quervergleich, wir sind hier belegt |

### Übrige Bereiche

| Posten | Fundstelle |
|---|---|
| HP-/MP-Maxima nach Ausrüstungswechsel | `spec/spec-battle-formulas.md` §9 „Stat derivation chain" — **die fehlende Formel**; Livebeleg `spec-live-ground-truth.md` §4.2 |
| Materia-System | `pseudocode/kernel-data.md`, `kernel-bitfields.md`, `savemap.md` — ⚠ der `attribute[]`-Schwanz ist teilweise ungeklärt, Pro-Materia-Statdeltas fehlen |
| Savemap | `spec/spec-savemap-live.md`, `spec/spec-file-formats.md` §9 — deckt sich mit unserem Layout (§5) |
| Weltkarten-Begegnungen | `spec/spec-rng.md` §6 — Generator 4 (GFSR `x^521 + x^32 + 1`), **byteexakt gegen Livespeicher validiert** |
| Determinismus/Replay | `spec/spec-rng.md` §9 — **vier** unabhängige Generatoren; sie zu vermischen macht bitgleiches Replay unmöglich |
| MS-ADPCM-Dekoder | `spec/spec-audio-sfx.md` §5.6 Referenzimplementierung, §4 `audio.fmt`, §6 Mischer — ⚠ ID→Bedeutung nur 337 von 724 |
| Musikindex (O2) | `spec/spec-audio-midi.md` §5 — ⚠ die Fassung von 2012 nutzt den EXE-Sequenzer **nicht**, OGG-Wiedergabe liegt in `AF3DN.P` |
| Minigames S34/S35 | `spec/spec-minigames.md` (222 KB) — §10 ist die Extraktionsanleitung in genau der „Fundstelle statt Fundstück"-Form, die S37 verlangt |
| Zeichentabelle | `spec/spec-file-formats.md` §3 — **bestätigt** unsere offene Aufgabe 2 (ASCII-Fenster bis 0x5E, darüber Mac OS Roman + 0x20), ergänzt: `0xBB` ist das Währungszeichen `¤`, nicht das Eurozeichen |
| Numerik | `spec/spec-numerics.md` — 4.12-Festkomma, 4096 = 360°, Software-GTE |
| Prior-Art-Vergleich | `spec/spec-prior-art-diff.md` — ff7-fenrir, kujata, Braver, V-Gears/Q-Gears, aus den Repositorienbäumen gemessen statt aus READMEs (**Grundlage für K10**) |

**Nicht abgedeckt:** FMV-Wiedergabe (S36). Der Bestand sagt dazu nichts —
das ist hier ausdrücklich vermerkt, damit die Tabelle nicht Vollständigkeit
suggeriert, die sie nicht hat.

---

## 5. Bestätigungen unseres eigenen Bestands

| Eigene Festlegung | Befund des Bestands |
|---|---|
| Savemap-Charakterrecord: Basis 84, Schrittweite 132, `hp 44`, `hpBasis 46`, `mp 48`, `mpBasis 50`, `hpMax 56`, `mpMax 58` | Feld für Feld gegen Livespeicher geprüft, **alles deckungsgleich** |
| F12 (Herkunft ff7tk) | aus zweiter, unabhängiger Richtung bestätigt |
| Kernel-Sektionsrollen 0–8 Recordtabellen, 9–26 Textlisten (S21) | 27 Sektionen, Typen 0..8 je einmal, danach 18× Typ 9 — **eigene Messung, s. §3** |
| Speicherstand-Prüfsumme CRC-16 mit Nachlauf-XOR über `slot[4…]` (S14) | CRC-16/GENIBUS, Poly `0x1021`, Init `0xFFFF`, Xorout `0xFFFF`, über `slot+4`, Länge `0x10F0`, 8/8 echte Slots — **gegenseitige Bestätigung** |
| `BATTLE_TICK_HZ = 15` (`battle-runtime/src/rate.ts`) | unberührt; der Livewert `+0x00 = 546` ist **[1-SAMPLE]** und kann Rate nicht von Akkumulator trennen |
| ASCII-Fenster zu breit (QUELLEN-SICHTUNG §2.2, Aufgabe 2) | bestätigt und präzisiert (§4) |

---

## 6. Was der Bestand ausdrücklich **nicht** liefert

Diese vier Stellen sind dort als unbelegt markiert. Eine plausible Vermutung
wäre hier schlechter als eine Lücke, weil sie gemessen aussähe:

1. **Der Container des Kampf-Ergebnisprotokolls** — Basisadresse, Kapazität und
   Umlaufverhalten sind unbekannt. Der 14-Byte-Record ist belegt, der Behälter
   nicht.
2. **Das innere Layout von `kernel2.bin`** — dritter Containertyp (weder gzip
   noch `kernel.bin`-Aufbau): `u32` = Dateigröße − 4, danach Tabellenbytes und
   FF7-Text. Der Aufbau darüber hinaus wurde nicht ermittelt. (⚠ Das
   widerspricht unserer Notiz aus touphScript, die „ganze Datei LZS" sagt —
   **zu messen**, s. offene Aufgaben.)
3. **Die Reduktion vom Ringbyte zur Formation** bei der Weltkarte — eine
   Zählung, keine Spezifikation.
4. **Der Mechanismus der Locale-Auflösung** — *welche* Datei geladen wird, ist
   byteexakt geklärt (§3); *wie* der Pfad zustande kommt, nicht. Der einzige
   Fundort eines `lang-`-Literals ist `FF7_Launcher.exe`.

Ebenfalls nicht anfassen: Der Bestand beschreibt die Startprüfung des Spiels
(`FF7_Launcher.exe` + `SteamAPI_Init` in `AF3DN.P`). Sie wurde dort bewusst nicht
umgangen, und sie ist für uns gegenstandslos — unser Weg über
`license-steam` / `steam-auth-relay` bleibt.

---

## 7. Arbeitsanleitung

1. `spec/README.md` — Bereitschaftstabelle, **`Measured` lesen**.
2. `spec/index-by-package.md` — Paket → Frage → Datei → Überschrift, und ab
   Zeile 135 der Zuverlässigkeitsvorbehalt je Dokument. **Vor dem Bauen den
   Vorbehalt des Dokuments lesen.**
3. `spec/roadmap.md` — Bauordnung, die fenrir-Entscheidung, und was ohne
   laufendes Spiel nicht zu schließen ist.
4. `findings.md` (485 KiB) und `function-index.md` (329 KiB) sind zu groß zum
   Lesen — **greppen**, nach Symbolnamen oder Adresse. ⚠ `function-index.md`
   führt analystenvergebene Namen, keine wiedergewonnenen Symbole: Ein
   plausibler Name belegt kein Verhalten.
5. **Nach Symbolnamen greppen, nicht nach Thema — und dann JEDEN Treffer
   öffnen.** K9 ist hier ein Lehrstück mit einem Fehler darin: Der Dekoder
   steht vollständig in `pseudocode/battle-actors.md` §5/§6. Ein Grep nach
   `DecodeAnim|LoadAnimBank` hat diese Datei sofort geliefert — sie wurde
   trotzdem übergangen, weil das *themengleiche* Dossier `animation.md` (nur
   Field-Seite) den Blick gebunden hatte. Das ist Fehlertyp 1 („falsche
   Suchmenge"), und er blieb nur folgenlos, weil das Abbild danebenlag.
   Der Themenname eines Dossiers sagt nichts darüber, was darin steht:
   Der Kampf-Animationsdekoder wohnt im *Aktoren*-Dossier.
6. Ein Fund aus dem Abbild ist ein **Bauplan, kein Beleg**. Er wird 🟢 erst
   durch eine Abrechnung an unseren Daten — bei K9 die Rahmenzahl, 391/391 mit
   drei Kontrollen. Ohne diesen Schritt bleibt er 🟡, egal wie klar der
   Dekompilat-Text ist.
