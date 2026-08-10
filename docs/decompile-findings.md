# decompile-findings — S37: Die Spiel-EXE als Datenquelle

**Messdatum:** 2026-08-10 · **Quelle:** lokale Steam-Installation
(`C:\Program Files (x86)\Steam\steamapps\common\FINAL FANTASY VII`), 7 Programm-
dateien aus vier Jahren · **Werkzeuge:** eigene PE-Sondierung (Python), keine
Fremdwerkzeuge, kein Disassembler.

Dieses Dokument ist die Befundsammlung zum Bogen
[ROADMAP-S37-EXE-ANALYSE.md](ROADMAP-S37-EXE-ANALYSE.md). Es folgt derselben
Beweislast wie [FINDINGS.md](../tools/realdata-scan/FINDINGS.md): jede Aussage
trägt Accounting, Kontrollhypothese und — wo möglich — eine externe
Kreuzvalidierung.

---

## 0. Was hier getan wurde und was nicht

S37 trennt zwei Vorgänge, die umgangssprachlich beide „Dekompilieren" heißen.
Diese Trennung wurde eingehalten, und zwar nicht als Zeremonie, sondern weil
sie die Grenze zwischen brauchbarem Wissen und rechtlichem Risiko ist:

| | Vorgang | hier |
|---|---|---|
| **Datenextraktion** | statisch abgelegte Tabellen lesen: Zeigerfelder, Zeichenkettenpools, Recordarrays, Containerstruktur | ✅ **vollständig ausgeschöpft** |
| **Codeanalyse** | Instruktionen lesen, Kontrollfluss rekonstruieren, aus Maschinencode einen Algorithmus ableiten | 🚫 **nicht getan** |

Kein Byte des `.text`-Abschnitts wurde als Instruktion gedeutet. Wo unten
`.text` vorkommt, geht es ausschließlich um **Byte-Gleichheit zweier Dateien**
— eine Aussage über Dateien, nicht über Programmlogik.

**Zur Ablageregel.** Der Bogen verlangt „Fundstelle statt Fundstück": das
Repository enthält Lokatoren, nicht Werte. Dieses Dokument hält das ein. Es
nennt Adressen, Eintragszahlen, Recordgrößen und Invarianten vollständig,
Inhalte dagegen nur als *einzelne* Beispiele, wo ohne sie die Struktur
unverständlich bliebe. Die vollständigen Tabellen entstehen erst beim Import
auf dem Rechner des Nutzers, aus dessen eigener Datei.

---

## 1. Die Versionsmatrix — sieben Dateien, fünf verschiedene Binaries

| Datei | Größe | SHA-256 (12) | Sektionen |
|---|---|---|---|
| `ff7.exe` | 5.882.880 | `c1437392c5e4` | 4 |
| `ff7_en.exe` | 6.421.856 | `68cf1b8c1d73` | 6 (+`.dotemu`, +`.bind`) |
| `7H2.0-BACKUP\20200321…\ff7.exe` | 5.882.880 | `a33ccad7554f` | 4 |
| `7H2.0-BACKUP\20200321…\ff7_bc.exe` | 5.882.880 | `a8728404acb5` | 4 |
| `7H2.0-BACKUP\20200321…\ff7_mo.exe` | 5.882.880 | `a0472cba99fc` | 4 |
| `7H2.0-BACKUP\20230313…\ff7.exe` | 5.882.880 | `a33ccad7554f` | 4 |
| `7H2.0-BACKUP\20241207…\ff7.exe` | 6.421.856 | `68cf1b8c1d73` | 6 |

PE32, `machine = 0x14c` (i386), `ImageBase = 0x400000` in allen.

| Befund | Status |
|---|---|
| **Der Link-Zeitstempel ist in beiden Spiel-EXEs identisch: `905883247` = 1998-09-15 18:14:07 UTC.** Die Steam-Fassung von 2013 ist keine Neuübersetzung, sondern eine **nachbearbeitete 1998er-Binary**. `FF7Config.exe` trägt 1998-09-14, ist also einen Tag älter | ✅ Fingerprint-Fakt |
| Sektionslayout `ff7.exe`: `.text` (RVA 4096, 3.884.597 B) · `.rdata` (3.891.200, 15.550) · `.data` (3.907.584, **vsize 7.957.596** bei nur 1.978.368 B Dateiinhalt) · `.rsrc` | ✅ Containerfakt |
| **Der `.data`-Abschnitt ist zu 75 % nicht dateigestützt** (7,96 MB virtuell gegen 1,98 MB roh). Alles jenseits `rawsize` ist Laufzeit-BSS und enthält **keine** Bytes zum Lesen | ⚠️ **Der wichtigste Fallstrick des Bogens** — s. §7 |
| Der Lokator aus §3 trifft in **7/7 Dateien** an derselben RVA, über 5 verschiedene Hashes und beide Sektionslayouts | ✅ Versionsrobustheit erfüllt |

---

## 2. Der Strukturbefund, der den halben Bogen umschreibt

> **`.data` und `.rdata` sind zwischen `ff7.exe` und `ff7_en.exe` byteidentisch.**

Gemessen über die vollen 1.978.368 bzw. 15.872 B: identisch, nicht „fast".
Die `.text`-Abschnitte unterscheiden sich in **252 von 3.885.056 Bytes**
(0,0065 %), verteilt auf 59 Häufungen. Jede einzelne Häufung ist eine
4-Byte-Adresse, die im einen Build auf `0x7b60xx` und im anderen auf
`0xf6e0xx` zeigt — also **Relokationen**, verursacht durch das zusätzliche
`.bind`/`.dotemu`-Layout des Steam-Builds. Nirgends steht an einer dieser
Stellen Text.

Dazu passt der Rest der Installation: `lang.dat` enthält `en`, und unter
`data/` existiert genau ein Sprachverzeichnis (`lang-en`).

**Vier Folgerungen, alle unangenehm für den ursprünglichen Plan:**

1. **Es gibt keine „deutsche EXE".** Die vermeintlich sprachverschiedenen
   Builds sind derselbe Code mit anderer Adressbasis. Die Sprachfassung liegt
   vollständig in `data/lang-*/` (vor allem `kernel.bin`).
2. **S37-Wahrheitstest 6 („Der Sprachunterschied ist ein Geschenk") ist
   hinfällig.** Er kann nicht durchgeführt werden, weil die Voraussetzung nicht
   existiert. Das ist kein Fehlschlag der Messung, sondern ein Fehler in der
   Annahme, auf der der Test aufgebaut war.
3. **Zieltabelle 2 (Item-/Materia-/Zaubernamen) ist strukturell erledigt, nicht
   nur „nicht gefunden".** Eine sprachabhängige Namenstabelle *kann* nicht in
   einem sprachinvarianten Abschnitt liegen. Das ist ein Beweis, keine
   erfolglose Suche — und er ist stärker als jedes Suchergebnis, weil er nicht
   von der Güte des Lokators abhängt.
4. Damit entfällt auch Zieltabelle 3 (Shop-Bestände) als *Namens*quelle; als
   reine ID-Tabelle bleibt sie denkbar.

---

## 3. Posten 1: Der Musikindex — **gelöst**, aber nicht dort, wo gesucht wurde

Der Bogen hatte Posten 1 zum Lackmustest erklärt: läuft er durch, trägt das
Verfahren. Er läuft durch — über einen Weg, den der Bogen ausgeschlossen hatte.

### 3.1 Es gibt doch eine Indexdatei: `data/music/music.idx`

FINDINGS.md hielt fest: *„Es gibt keine Indexdatei — die Zuordnung liegt in der
EXE."* Diese Aussage ist **falsch**. Ein Bestandsscan über alle 3655 Dateien der
Installation findet `data/music/music.idx`, 647 B.

| Befund | Status |
|---|---|
| **Format: CRLF-getrennte Namensliste, Zeilenindex = Musiknummer.** 98 nichtleere Zeilen | ✅ Formatfakt |
| **Accounting byteexakt:** Σ(Namenslänge + 2) über alle 98 Einträge = **647 B** = Dateigröße. Kein Vorspann, kein Rest, keine Prüfsumme | ✅ byteexakt |
| **Kreuzvalidierung 98/98:** jeder Eintrag löst auf eine real vorhandene Audiodatei auf — 94 als `.ogg` in `data/music_ogg`, **4 als `.wav` in `data/music`** | ✅ vollständig |
| **Gegenrichtung ebenfalls vollständig:** 0 OGG-Dateien ohne Eintrag | ✅ Menge geschlossen |

### 3.2 Damit ist die bisherige Zielmenge zu klein gewesen

Das Projekt führte die Zielmenge als „94/94 geschlossen". Sie ist **98**. Die
vier fehlenden liegen als `.wav` neben der Indexdatei, nicht im OGG-Verzeichnis
— deshalb hat der bisherige Abgleich sie nie gesehen.

Zwei unabhängige Bestätigungen, dass 98 die richtige Zahl ist:
`data/midi/xg.lgp` und `data/midi/ygm.lgp` führen **exakt 98** Einträge
(`midi.lgp` und `awe.lgp` nur 94 bzw. 95 — sie sind unvollständig, nicht
maßgeblich).

Das erklärt rückwirkend Kujatas Liste: dort standen 100 Einträge, von denen
„sechs lokal keine Datei" hatten. Vier davon sind die WAV-Titel.

### 3.3 Die EXE-Tabelle — Lokator, Struktur, Kontrolle

Die Namen stehen **zusätzlich** in der EXE, und zwar in Großschreibung.

| Eigenschaft | Wert |
|---|---|
| **Lokator** | Zeigerarray im `.data`-Abschnitt, dessen Dereferenzierung die Folge `"NONE"` + 98 Namen ergibt |
| **Fundstelle** | RVA `0x9684c8` (in allen 7 Dateien) |
| **Länge** | **99** Einträge à 4 B = 396 B |
| **Zeichenkettenpool** | direkt anschließend, 4-Byte-ausgerichtet, NUL-terminiert |
| **Indexbasis** | **Eintrag 0 = `NONE`, Einträge 1…98 = die Musiktitel** |

| Befund | Status |
|---|---|
| **Positionsabgleich EXE-Tabelle gegen `music.idx`: 98/98 bei Versatz 1.** Zwei getrennte Quellen (Programmdatei und Datendatei) liefern **dieselbe Permutation** — die Zuordnung ist damit doppelt belegt | ✅ **Kreuzvalidierung bestanden** |
| **Kontrollhypothese fällt durch:** derselbe Abgleich bei Versatz 0 trifft **0/98**. Die Tabelle ist also nicht „ungefähr" ausgerichtet, sondern exakt um den `NONE`-Eintrag versetzt | ✅ Kontrolle |
| **Konsequenz: `musicId` ist 1-basiert**, `music.idx` dagegen 0-basiert. Wer die Indexdatei direkt als Nachschlagetabelle für einen `MUSIC`-Operanden verwendet, liegt um genau eins daneben | ✅ **abgeleiteter Formatfakt** |
| **Versionsrobust:** 7/7 Dateien, 5 verschiedene Hashes, identische RVA. Der Lokator ist inhaltsdefiniert (Zeigerfolge + Dereferenzierungsmuster), nicht adressdefiniert | ✅ Kriterium 6 erfüllt |

**Damit ist O2 geschlossen.** Es bleibt genau eine Folgefrage offen: FINDINGS.md
notiert, dass 36 von 935 `MUSIC`-Operanden im Feld-Bytecode ≥ 100 liegen. Mit
99 gültigen Werten (0…98) wird diese Verletzung **nicht kleiner**. Der
Musikindex ist geklärt; ob der `MUSIC`-Opcode diesen Index direkt trägt, ist
damit **nicht** geklärt und hängt weiter an O9 (Spannen-Durchlauf).

### 3.4 Die methodische Lehre — und ein eigener Fehlschlag, offen protokolliert

Der erste Anlauf dieser Session meldete: *„40 von 48 markanten Musiknamen
fehlen vollständig in der EXE — der Musikindex liegt nicht statisch in der
Datei."* Das war ein **Messfehler**, kein Befund. Die Suche war
groß-/kleinschreibungsempfindlich, die Tabelle steht in Großbuchstaben.
Gemessen: **8/48** case-sensitiv gegen **48/48** case-insensitiv.

Das ist derselbe Fehlertyp wie der „Case-Schatten" aus S13 — dort verfälschte
die Groß-/Kleinschreibung eine Gütefunktion, hier ließ sie eine vorhandene
Tabelle unsichtbar werden. Der Unterschied: In S13 sah der Fehler nach einem
knappen Ergebnis aus, hier sah er nach einem **sauberen Negativbefund** aus —
also nach genau der Art Ergebnis, die der Bogen ausdrücklich als zulässig
erklärt. **Ein Negativbefund ist die gefährlichste Ausgabe einer Suche, weil er
plausibel aussieht, wenn das Suchverfahren defekt ist.** Regel für künftige
Signatursuchen: Bevor ein Negativbefund berichtet wird, muss die Suche an einer
Zeichenkette validiert werden, von der bekannt ist, dass sie in der Datei
steht.

---

## 4. Der Tabellenkatalog — 41 Zeigertabellen mit ≥ 15 Einträgen

Verfahren: Der `.data`-Rohbereich wird als u32-Folge gelesen; ein Eintrag gilt
als Zeiger, wenn er in einen dateigestützten Abschnitt zeigt und dort eine
NUL-terminierte, druckbare Zeichenkette ≤ 64 B beginnt. Läufe ab 15
aufeinanderfolgenden gültigen Zeigern werden als Tabelle geführt. Das ist ein
reines Strukturkriterium — es sagt nichts über den Inhalt und entscheidet
deshalb nach Projektstandard nie allein (S37-Wahrheitstest 4).

### 4.1 Tabellen mit bestandener externer Kreuzvalidierung

| RVA | n | Inhalt | Kreuzvalidierung |
|---|---|---|---|
| `0x9684c8` | 99 | Musiktitel (§3) | 🟢 98/98 gegen `music.idx` **und** `music_ogg` + `music/*.wav` |
| `0x7bae80` | 95 | FMV-Namen, Teil 1 | 🟢 s. u. |
| `0x7bb000` | 105 | FMV-Namen Teil 2 (10) + **95 zugehörige `.cam`-Namen** | 🟢 s. u. |

**FMV-Tabellen — Accounting und Kreuzprobe.** Beide Arrays zusammen ergeben
104 verschiedene `.avi`-Namen. Gegen `data/movies/` (105 `.avi`-Dateien):

| Größe | Wert |
|---|---|
| Schnittmenge | **102** |
| in der EXE, nicht im Ordner | 2 |
| im Ordner, nicht in der EXE | 3 |

Die drei Ordner-Extras sind die nachträglich ergänzten Vorspannfilme (Eidos-
und Square-Logo sowie ein Effektfilm) — sie stammen nicht aus der
Originalsequenzliste. Die zwei EXE-Extras sind Varianten (`…n`-Suffix) ohne
eigene Datei. **Eine falsche Tabellenausrichtung kann 102 reale Dateinamen
nicht zufällig treffen.**

Zusätzlicher Strukturbefund: Die 95 `.cam`-Einträge stehen in **derselben
Reihenfolge** wie die 95 `.avi`-Einträge des ersten Arrays — zwei parallele
Arrays mit gemeinsamem Index (Film ↔ Kamerafahrt). Der Abgleich der `.cam`-
Namen gegen die TOC von `moviecam.lgp` (124 Einträge) ergibt allerdings
**0/95 positionsgleich**: Die Archivreihenfolge ist auch hier nicht der Index —
dasselbe Muster wie bei `midi.lgp` (S16).

### 4.2 Tabellen ohne externe Kreuzvalidierung (Lokator belegt, Semantik 🟡)

Diese sind **nicht** als bewiesen zu führen. Sie sind Fundstellen, deren
Struktur klar ist und deren Bedeutung aus dem Inhaltsmuster erschlossen wurde.

| RVA | n | mutmaßlicher Inhalt | Anmerkung |
|---|---|---|---|
| `0x91b068` | 246 | DirectInput-Tastennamen | eindeutig an der Reihenfolge erkennbar (Scancode-Ordnung); Index = Scancode |
| `0x909728` | 181 | `.rsd`-Namen (Kampfmodelle) | gegen `battle.lgp` prüfbar — noch nicht getan |
| `0x96fd10` | 144 | `.TIM`-Namen (Weltkarte) | |
| `0x96a13c` / `0x969df8` / `0x969ef0` / `0x969ce8` / `0x96a02c` / `0x96a09c` | 125/61/58/53/25/16 | `.tim`-Namen, thematisch gruppiert (Gelände, Vegetation, Schnee, Küste) | **Weltkarten-Texturbibliothek**, sechs Teiltabellen |
| `0x919c18` | 24 | Menü-Porträts, 12 Namen + 12 mit `_l`-Suffix | **Index = Charakterreihenfolge**; die 12 Positionen decken sich mit der bekannten Party-ID-Ordnung inkl. zweier Sonderfiguren und Chocobo |
| `0x7c27b8` | 17 | `.DAT`-Namen (Kampfmodelle je Spielfigur) | enthält Mehrfachbelegungen — dieselbe Figur in mehreren Ausführungen |
| `0x7c1b58` | 56 | `.DAT`-Namen der Limit-Effekte | **stark strukturiert**: Blöcke zu je 7 pro Figur, Füllplätze mit wiederholtem Platzhalternamen → 8 Figuren × 7 Plätze = 56, Accounting geht exakt auf |
| `0x910bac` | 15 | Schlüsselwörter zweier Textformate: 3 gehören zum `.hrc`-Skelett (385/385 belegt), 12 zu einem **Animations-Textformat** | s. §5 — **direkt R4-relevant** |
| `0x912088` | 17 | Kommandozeilenschalter der EXE | u. a. Renderer-Wahl, Vollbild, Protokollierung |
| `0x90cc40` | 16 | `.P`-Dateinamen | deckungsgleich mit den 16 `*.P`-Dateien im Installationswurzelverzeichnis (🟢 trivial kreuzvalidiert) |
| `0x7bf160` | 43 | Wochentags-/Monatsnamen | Laufzeitbibliothek, kein Spielinhalt |
| `0x939dc0` / `0x949fa0` | 76 / 58 | Streckensegment-Codes | s. §6 |
| `0x901c00`…`0x9023c0` | 15–28 je | `.rsd`-Pfade eines Minispiels, nach Einheiten gruppiert (`un01`…`un18`) | vollständige Pfade mit Quellverzeichnisstruktur |

### 4.3 Nicht-Zeiger-Tabelle: die Weltkarten-Modellliste

Bei Dateiversatz ≈ 5.681.800 liegt **kein** Zeigerarray, sondern ein
**Festfeld-Array**: abwechselnd ein Bezeichner und ein Modellpfad, jeweils auf
12-Byte-Felder ausgerichtet und mit NUL aufgefüllt (`<name>` ⟶ `/xxx.hrc`).
Dieselbe Modellzeile wiederholt sich mehrfach mit variierenden Einträgen —
sichtbar sind mehrere aufeinanderfolgende Blöcke gleicher Länge, in denen
einzelne Positionen wechseln.

**Deutung (🟡, unbelegt):** Das Muster passt zu einer Matrix „Weltkartenzustand
× Modellplatz" — also der Tabelle, die bestimmt, welches Fahrzeug/Objekt in
welchem Handlungsabschnitt auf der Weltkarte sichtbar ist. Das wäre
**Zieltabelle 4** des Bogens. Sie ist **auffindbar und strukturiert**, ihre
Zeilensemantik ist ohne S28 aber nicht prüfbar. Ausdrücklich nicht bewiesen.

---

## 5. Der R4-Fund: ein benanntes Feld „Rotationsauflösung"

Bei RVA `0x910bac` liegen 15 Schlüsselwörter eines zeilenbasierten Textformats,
darunter Bezeichner für **Rotationsreihenfolge**, **Rotationsauflösung**,
**Wurzelkoordinatensystem** sowie je drei Kanalbezeichner für Translation und
Rotation.

### 5.1 Erste Deutung — und ihre Widerlegung in derselben Session

Naheliegend war: das sind die Schlüsselwörter des `.hrc`-Skelettformats. Diese
Deutung wurde geprüft und ist **falsch**.

Auszählung über alle **385** `.hrc`-Dateien in `char.lgp`:

| Schlüsselwort | Vorkommen |
|---|---|
| Kopfblock, Skelettname, Knochenzahl | **385/385** |
| Rotationsreihenfolge, Rotationsauflösung, Bildzahl, Kanäle, Wurzelkoordinate, die 6 Kanalbezeichner | **0/385** |

Nur 3 der 15 Schlüsselwörter gehören zum Skelettformat. Die übrigen 12 kommen
in keiner einzigen `.hrc`-Datei vor. Ein einzelner Zähllauf hat damit eine
Hypothese erledigt, die sonst als „plausibel" ins Dokument gewandert wäre.

### 5.2 Wozu die zwölf Schlüsselwörter wirklich gehören

Sie bilden zusammen ein **Animations-Textformat**: Bildzahl, Kanäle,
Rotationsreihenfolge, Rotationsauflösung, Wurzelkoordinate und sechs Kanäle
(drei Translation, drei Rotation). In den ausgelieferten Felddaten kommt es
nicht vor — die Animationen liegen dort ausschließlich binär als `.a` vor. Es
ist also ein **Entwicklungs-/Zwischenformat**, dessen Leser in der
ausgelieferten Binary verblieben ist.

Bestätigt wird das durch zwei unabhängige Beobachtungen im selben Bereich:

- Die zugehörigen Quellpfade gehören zur **Polygon-Schicht der Hausbibliothek**
  (§8), nicht zum Feld- oder Kampfmodul — passend zu einem
  formatübergreifenden Konverter.
- Unmittelbar benachbart liegen zwei Diagnosetexte, von denen einer wörtlich
  eine **ungültige „animation degree resolution"** bemängelt.

| Befund | Status |
|---|---|
| **Die Rotationsauflösung ist eine Winkelauflösung in Grad und hat gültige und ungültige Werte** — sie ist also ein Aufzählungsfeld mit kleiner Wertemenge, kein freier Skalar | ✅ aus dem Diagnosetext, nicht aus Code |
| Die Rotationsreihenfolge ist **auch hier** ein benanntes Feld. Das deckt sich mit dem `.a`-Befund vom 2026-08-10 („Reihenfolge steht in der Datei, Versatz 12..14, 3209/3209 eine Permutation von {0,1,2}") | ✅ zweite, unabhängige Stütze |
| Es existiert ein eigener Bezeichner für den **Wurzelrahmen** — R4-B2 wurde als „der Fehler sitzt im Wurzelrahmen" gelöst; das Format führt ihn als eigenständiges, benanntes Konzept | ✅ stützt die B2-Lösung |

### 5.3 Die konkrete, prüfbare Hypothese für den R4-Rest

Im Textformat stehen **Rotationsreihenfolge und Rotationsauflösung direkt
nebeneinander**. Im binären `.a`-Format liegt die Reihenfolge bei Versatz
**12…14** — und Byte **15** ist laut FINDINGS.md „in allen Dateien 0" und bisher
unerklärt.

> **Hypothese H-A15: `.a`-Byte 15 ist die Rotationsauflösung**, als
> Aufzählungswert, mit 0 als Standardauflösung.

Das ist die sparsamste Erklärung für ein bislang bedeutungsloses Byte: Zwei
Formate derselben Bibliothek führen dieselben zwei Felder, im Textformat
nachweislich benachbart, im Binärformat an benachbarten Versätzen.

**Warum das für R4 zählt:** Wenn Bone-Rotationen gegen eine *deklarierte*
Auflösung skaliert werden, ist die im Projekt verwendete feste Umrechnung eine
Annahme und keine Messung. Das ist ein Kandidat für den in R4 verbliebenen Rest
(63,1 % statt 100 % aufrecht).

**Ehrliche Grenze:** Der Bestand kann H-A15 **nicht bestätigen**, weil Byte 15
in allen 3209 Dateien denselben Wert trägt. Eine Konstante ist mit sich selbst
verträglich, aber sie beweist nichts — genau der Fall, in dem das Projekt
bisher „gemessene Konstante" von „angenommener Konstante" unterschieden hat.
Prüfbar wäre H-A15 nur an Animationsdaten mit abweichendem Byte 15; im
vorliegenden Bestand gibt es keine. Der Wert der Hypothese liegt darin, dass
sie **falsifizierbar formuliert** ist und ein bisher unbeschriftetes Feld
beschriftet.

### 5.4 Nebenbefund: ein Minispiel ist ein eigenständiges Programm

Bei der Suche nach dem Animationsformat fiel auf, dass **`chocobo.lgp` eine
vollständige eingebettete Programmdatei enthält** (gültiger MZ- und
PE-Vorspann, dazu über 1000 Quellpfad-Zeichenketten). Von den 21 geprüften
Minispiel-Archiven trifft das auf **genau eines** zu; die übrigen enthalten
ausschließlich Daten.

Das erklärt §8.1 aus einer zweiten Richtung: Die Minispiele waren separate
Projekte, und mindestens eines wird als **eigenes Programm im Archiv
ausgeliefert** statt in die Haupt-EXE gelinkt. Für WebMidgar heißt das: Ein
Archiv aus `data/minigame/` ist nicht zwingend ein reiner Datencontainer, und
ein Importer sollte das nicht voraussetzen.

---

## 6. Minigame-Konstanten (Posten 7) — auffindbar, entgegen der Erwartung

Der Bogen führte Posten 7 als „geringster erwarteter Ertrag, zunächst keine
Kreuzvalidierung, deshalb zuletzt". Befund: Es **gibt** dort etwas zu finden.

Zwei Tabellen (76 und 58 Einträge) tragen Bezeichner nach einem strengen
Schema: **ein Typbuchstabe, sechs Ziffern, ein Variantenbuchstabe.**

| Beobachtung | Beleg |
|---|---|
| Typbuchstaben bilden eine kleine geschlossene Menge (Kurve links, Kurve rechts, gerade, Sprung u. a.) | Verteilung über beide Tabellen |
| Bei „gerade" sind **alle sechs Ziffern 0**, bei Kurven nie | ausnahmslos |
| Die Ziffern zerfallen in **drei Paare**; das erste Paar nimmt nur Werte aus einer kleinen Menge an, die wie Winkelgrade aussieht | Wertebereich in beiden Tabellen identisch |
| Die beiden Tabellen sind **nicht disjunkt und nicht identisch** — sie teilen einen großen Kern und unterscheiden sich in den Rändern | Mengenvergleich |
| **Kein einziger dieser Bezeichner kommt in irgendeinem der 21 Minigame-Archive vor** | geprüft über alle `data/minigame/*.lgp` |

**Folgerung:** Die Streckendefinition eines Minispiels ist **in der EXE
hartkodiert**, nicht in den Daten. Zwei Tabellen mit gemeinsamem Kern passen zu
zwei Schwierigkeitsgraden derselben Strecke.

**Status 🟡.** Die Segmentgrammatik ist belegt (Typ + drei Zahlenpaare +
Variante, mit ausnahmsloser Nullregel bei „gerade"). Die Bedeutung der
Zahlenpaare ist eine begründete Vermutung. Welchem Minispiel die Tabellen
gehören, ist **nicht** belegt — das ließe sich nur über Codeanalyse
entscheiden, die hier nicht stattfindet. Eine Sichtprüfung im laufenden Spiel
(Segmentfolge mitschreiben und mit der Tabelle vergleichen) wäre der zulässige
Weg.

---

## 7. Der Nullwert-Fallstrick — hier in einer neuen Ausprägung

S37-Wahrheitstest 5 warnt vor genullten Ausrichtungsbereichen. Die tatsächliche
Falle in einer PE-Datei ist schärfer und anders gelagert:

> Der `.data`-Abschnitt meldet eine **virtuelle Größe von 7.957.596 B**, hat
> aber nur **1.978.368 B Dateiinhalt**. Rund **75 % des Adressbereichs, den
> Zeiger in dieser Datei ansprechen können, existiert in der Datei nicht.**

Wer Zeiger gegen die *virtuelle* Sektionsgrenze prüft statt gegen die
*Rohgröße*, akzeptiert Millionen Adressen als „gültig", die auf nichts zeigen —
und liest je nach Implementierung entweder Nullen oder fremde Bytes. Beide
Ergebnisse sind trivial strukturkonform.

Alle Zeigerprüfungen dieses Dokuments verwenden ausschließlich `rawsize`. Das
ist der Grund, warum der Tabellenkatalog 41 Einträge hat und nicht mehrere
hundert.

---

## 8. Der Quellbaum — rekonstruiert aus Zeichenketten

Die EXE enthält **116 Zeichenketten mit Quelldateipfaden** (Nebenprodukt der
Assertion-Makros des Originalcompilers). Daraus ergibt sich die Modulstruktur
des Originalprojekts — **Architekturwissen, kein Code**:

| Zweig | Inhalt |
|---|---|
| `…\src\main\` | Programmstart, Pfadauflösung |
| `…\field\src\` | Feldmodul, ~13 Dateien (Hintergrund, Kacheln, Paletten, Objekte, Listen, CD-Zugriff) |
| `…\src\Battle\` + `…\battle\battle3d\` | Kampfmodul, davon ein eigener 3D-Zweig (Modelle, Gegner, Limitangriffe, Bühne, Animationskonvertierung) |
| `…\src\wm\` | Weltkarte |
| `…\src\menu\` | Menü, mit **sprachbenannten Unterverzeichnissen** |
| `…\src\Credits\` | Abspann |
| `…\chocobo\`, `…\condor\`, `…\coaster\`, `…\highway\`, `…\snobo\` | fünf Minispiele als **eigenständige Teilprojekte** neben `src\` |
| `…\lib\src\` | **Hausbibliothek** mit 12 Untermodulen: Grafik (~25 Dateien, getrennte Pfade für DirectX, OpenGL, Software-Rasterizer und PSX), Datei, Ton, Polygon, Speicher, Eingabe, Bewegung, Sortierung, Listen, Stapel, Zeichenketten, Nebenläufigkeit |

**Was daraus folgt und im Projekt verwendbar ist:**

1. **Die Minispiele sind keine Untermodule des Spiels**, sondern separate
   Projekte auf gleicher Ebene. Das stützt die Architekturentscheidung, sie in
   WebMidgar als eigene Pakete zu führen statt als Feldmodus.
2. **Es gab eine gemeinsame Bibliotheksschicht unter dem Spiel.** Die
   Polygon-Untermodule tragen genau die Namen der Formate, die das Projekt
   bereits geparst hat (`.p`, `.rsd`, `.tim`, `.a`) — das erklärt, warum diese
   Formate über Feld, Kampf, Weltkarte und Minispiele hinweg **einheitlich**
   sind. Ein Parser je Format reicht; formatgleiche Sonderfälle je Spielmodus
   sind nicht zu erwarten.
3. Die Grafikschicht hatte **vier austauschbare Rückenden**. Das erklärt die
   Kommandozeilenschalter (§4.2) und macht plausibel, dass Renderzustände als
   Daten vorliegen — was zum bereits vermessenen 100-B-Renderstate im
   `.p`-Format passt.
4. Das Menü hat sprachbenannte Quellverzeichnisse — konsistent mit §2:
   Lokalisierung war zur *Übersetzungszeit* getrennt, nicht zur Laufzeit über
   Datentabellen in der EXE.

---

## 9. Bilanz gegen die Akzeptanzkriterien des Bogens

| Kriterium | Ergebnis |
|---|---|
| Fingerprint erkennt die lokale EXE | ✅ Größe + Sektionshashes + Link-Zeitstempel trennen die 5 Binaries |
| Jede extrahierte Tabelle besteht ≥ 1 Kreuzvalidierung | ✅ für die 3 als bewiesen geführten Tabellen (§4.1); die übrigen 38 sind ausdrücklich **nicht** als bewiesen geführt |
| Accounting byteexakt | ✅ `music.idx` 647/647; Musiktabelle 99 × 4 B; Limit-Tabelle 8 × 7 |
| Kontrollhypothese je Lokator dokumentiert und durchgefallen | ✅ Musikindex: Versatz 0 trifft 0/98 gegen 98/98 |
| Versionsrobustheit | ✅ 7/7 Dateien, 5 Hashes, identische RVA |
| Kein Disassemblieren | ✅ eingehalten |
| Keine extrahierten Werte im Repository | ✅ nur Lokatoren, Strukturen und Einzelbeispiele |
| Posten 1 als Verfahrensbeweis | ✅ **bestanden** — mit der Einschränkung, dass der Beweis über eine Datendatei lief, die es laut Projektstand nicht geben sollte |

**Zieltabellen-Bilanz:**

| # | Tabelle | Ergebnis |
|---|---|---|
| 1 | Musiktitel | 🟢 **gelöst**, doppelt belegt (§3) |
| 2 | Item-/Materia-/Zaubernamen | 🔴 **strukturell ausgeschlossen** — nicht in der EXE (§2) |
| 3 | Shop-Bestände | 🟡 als Namensquelle ausgeschlossen; als ID-Tabelle offen |
| 4 | Fahrzeug-/Geländematrix | 🟡 **Kandidat gefunden** (§4.3), Semantik ohne S28 nicht prüfbar |
| 5 | ATB-/Zeitkurven | 🔴 nicht gesucht — reine Zahlentabellen ohne Zeichenketten sind mit dem hier verwendeten Zeigerverfahren nicht auffindbar (s. §10) |
| 6 | Schadensmodifikatoren | 🔴 wie 5 |
| 7 | Minigame-Konstanten | 🟡 **besser als erwartet** (§6) |
| 8 | `outcome`-Variable | 🔴 nicht angegangen |

---

## 10. Was noch fehlt — geordnet nach Aufwand und Ertrag

### 10.1 Sofort machbar, hoher Ertrag

| # | Frage | Warum jetzt |
|---|---|---|
| **A** | **`music.idx` als Musikindexquelle einbauen**, 1-Basis-Versatz beachten | O2 ist gelöst; der Einbau ist Fleißarbeit, und der Versatzfehler ist eine Falle, die genau einmal teuer wird (§3.3) |
| **B** | **H-A15 in den `.a`-Parser als beschriftetes Feld übernehmen** und bei Abweichung von 0 warnen | Genau das Vorgehen, das sich bei der Rotationsreihenfolge bewährt hat: das Feld lesen und melden, statt eine Konstante anzunehmen. Kostet fast nichts und macht künftige Fremddaten sofort auffällig (§5.3) |
| **C** | **Die 181 `.rsd`-Namen gegen `battle.lgp` prüfen** | Dieselbe Kreuzvalidierung wie bei den FMV-Namen, nur mit einem Archiv, das das Projekt bereits liest. Billigster nächster Beweis |
| **D** | **Die Porträttabelle als Charakter-ID-Ordnung gegen `kernel.bin` prüfen** | Liefert die kanonische Figurenreihenfolge mit externem Beleg statt aus Konvention |

*(Der ursprünglich hier geplante Punkt „`.hrc`-Schlüsselwörter auszählen" wurde
in dieser Session bereits ausgeführt — Ergebnis in §5.1, die Ausgangshypothese
fiel durch.)*

### 10.2 Methodische Lücke — die eigentliche offene Baustelle

**Das hier verwendete Verfahren findet nur Tabellen, die Zeichenketten
enthalten.** Alle Zieltabellen 5, 6 und 8 (ATB, Schaden, Kampfausgang) sind
**reine Zahlentabellen**. Für die ist der Zeigerscan blind — er hat sie nicht
verfehlt, er kann sie nicht sehen.

Der Bogen sieht dafür die „Strukturkarte Wertevielfalt je Byteposition" vor;
sie wurde in dieser Session **nicht** durchgeführt. Das ist die größte
verbliebene Lücke und der logische nächste Schritt. Zu beachten ist dabei:

- Sie braucht zwingend eine Kreuzvalidierung von außen, sonst greift
  S37-Wahrheitstest 4 („blinde Gütefunktion"): eine plausibel strukturierte
  Zahlenreihe erfüllt jedes Formkriterium, unabhängig vom Inhalt.
- Der einzige verfügbare externe Prüfstein für Kampfgrößen ist **beobachtbares
  Verhalten**, nicht Daten. Das ist eine Sichtprüfung — und nach der R4-Bilanz
  („fünf Anläufe, vier Aggregatmaße, entschieden hat das Auge") ist das kein
  Notbehelf.

### 10.3 Fragen, zu denen die Messung nichts sagen kann

Ehrlich abgegrenzt, damit niemand hier weitersucht:

- **Formelgestalt** (Schadensrechnung, ATB-Takt, Physik). Der Datenabschnitt
  enthält Tabellen, keine Algorithmen. Diese Grenze hat der Bogen richtig
  vorhergesagt und sie ist mit zulässigen Mitteln nicht überwindbar.
- **Zuordnung der Streckentabellen zu einem konkreten Minispiel** (§6) — ohne
  Codeanalyse nur durch Sichtprüfung im Spiel.
- **Zeilensemantik der Weltkarten-Modellmatrix** (§4.3) — braucht S28.

### 10.4 Befunde, die über dieses Projekt hinaus interessant sein dürften

Ohne Anspruch darauf zu wissen, was in der Community bereits dokumentiert ist —
das wurde hier nicht recherchiert, sondern ausschließlich selbst gemessen:

1. **Die Steam-Fassung trägt den Link-Zeitstempel von 1998.** Sie ist eine
   nachbearbeitete Originalbinary, kein Neubau (§1).
2. **`.data` und `.rdata` sind zwischen den beiden ausgelieferten Spiel-EXEs
   byteidentisch**, die 252 abweichenden `.text`-Bytes sind ausschließlich
   Relokationen. „Sprachversionen der EXE" gibt es nicht (§2).
3. **Der Musikindex ist 1-basiert**, `music.idx` 0-basiert — ein
   Off-by-one-Fallstrick für jedes Werkzeug, das die Indexdatei direkt als
   Nachschlagetabelle verwendet (§3.3).
4. **Die Zielmenge der Musiktitel ist 98, nicht 94** — vier Titel liegen als
   WAV neben der Indexdatei; `xg.lgp` und `ygm.lgp` bestätigen die Zahl
   unabhängig (§3.2).
5. **Film- und Kamerafahrtnamen liegen als zwei parallele Arrays mit
   gemeinsamem Index** vor; die Archivreihenfolge von `moviecam.lgp` ist
   **nicht** dieser Index (0/95 positionsgleich) — dasselbe Muster wie bei den
   MIDI-Archiven (§4.1).
6. **Die Streckensegmente eines Minispiels sind in der EXE hartkodiert**, in
   keinem Minigame-Archiv auffindbar, mit einer strengen und lesbaren
   Segmentgrammatik (§6).
7. **Es gibt ein Animations-Textformat mit einem benannten Feld
   „Rotationsauflösung" in Grad**, dessen Leser in der ausgelieferten Binary
   steckt, während in den Felddaten nur die binäre Fassung vorkommt. Daraus die
   falsifizierbare Hypothese H-A15 für ein bisher unerklärtes Byte des
   `.a`-Formats (§5).
8. **`chocobo.lgp` enthält eine vollständige eingebettete Programmdatei** — als
   einziges von 21 Minispiel-Archiven (§5.4).
9. **75 % des `.data`-Adressbereichs sind nicht dateigestützt** — der
   entscheidende Fallstrick jeder Zeigersuche in dieser Datei (§7).

---

*Rückverweis: [ROADMAP-S37-EXE-ANALYSE.md](ROADMAP-S37-EXE-ANALYSE.md) ·
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md) ·
[R4-MODELL-KONVENTIONEN.md](R4-MODELL-KONVENTIONEN.md) ·
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md)*
