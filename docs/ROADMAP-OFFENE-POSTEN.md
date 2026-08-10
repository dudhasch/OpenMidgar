# Roadmap — offene Forschungsposten

Dieses Dokument plant die verbliebenen 🔴/🟡-Posten in konkrete Sessions ein.
Es ist bewusst **methodenlastig**: Bei allen bisher gelösten Posten war nicht
der Aufwand das Problem, sondern die Messanlage. Deshalb steht bei jedem Punkt
nicht nur „was", sondern „womit gemessen wird" und „woran man merkt, dass die
Messung lügt".

**Aussagenklassen** wie im Masterplan: 🟢 Formatfakt · 🔵 Architekturentscheidung
· 🟡 Annahme/`Zu validieren` · 🔴 Offene Forschungsfrage.

## Stand nach der Prüfrunde 2026-08-09

| Posten | vorher | jetzt |
|---|---|---|
| Spielstand-Prüfsumme | 🔴 | 🟢 **gelöst** (CRC-16/CCITT, XOR-out 0xFFFF, ab +4; 8/8) |
| Kopflänge der Spielstanddatei | 🟡 | 🟢 **gelöst** (9/4340 trifft 8/8, Alternativen 0/8) |
| `audio.fmt`-Layout | 🔴 | 🟡 Eintragsgröße 74 B gemessen, WAVEFORMATEX belegt, Vorspann offen |
| Musikindex → Dateiname | 🔴 | 🟡 Zielmenge geschlossen (94/94), Permutation offen |
| Kampf-Opcode | 🔴 | 🟢 **gelöst** (`BATTLE` = 0x70, verdrahtet und getestet) |
| R4-Sichtprüfungen B1–B8 | ⏳ | ✅ **vollständig abgeschlossen** (2026-08-10, zwei Schritte: Gegenprüfung, dann Resttafel — **alle** B1–B10 entschieden, B7 war ein Definitionsfehler) |

## Stand nach der Repo-Recherche 2026-08-10

| Posten | vorher | jetzt |
|---|---|---|
| **O1 `audio.fmt`-Vorspann** | 🟡 | 🟢 **gelöst** — 24 B aus sechs u32, Accounting lückenlos über 198 Einträge, Kontrollen bei 0/198 |
| **O2 Musikindex** | 🟡 | 🟡 verengt: indizierte 100er-Liste deckt alle 94 lokalen Titel, aber die scharfe Vorhersage fällt durch (36/935). **Blockiert auf O9** |
| **O5 LGP-Check-Code** | 🔴 | 🟢 **geschlossen** (45.563 Einträge: nur 2 Werte, 0,1231 Bit; Prüfwert und Ordnung beide widerlegt; 0x0B ⟺ `.hrc` 766/766, Nachbarkontrolle 3,00 %) |
| **R4-B2 Rotationsreihenfolge** | 🟡 | 🟢 als Datum belegt (im Dateikopf, 3209/3209 YXZ) — die Hypothese „wechselnde Reihenfolge erklärt B2" ist **widerlegt**, neue Spur: Versatzvorzeichen ⊗ Achsenbasis |
| **Beweismaßstab für EXE-Größen** | offen | 🔵 [ROADMAP-S37-EXE-ANALYSE.md](ROADMAP-S37-EXE-ANALYSE.md) — Datentabellen lesen ist Import, nicht Dekompilierung |

---

## O1 — `audio.fmt` ✅ gelöst

**Ergebnis.** Je Eintrag 24 B Vorspann aus sechs `uint32` —
`Length, Offset, Loop, Count, Start, End` — gefolgt von einem
`ADPCMWAVEFORMAT` (50 B). Zusammen 74 B, exakt die gemessene Eintragsgröße.

**Belegt durch Accounting, nicht durch eine Quote:** Die 198 belegten Einträge
beschreiben Bereiche in `audio.dat`, die bei 0 beginnen und lückenlos sowie
überlappungsfrei bis 23.227.348 laufen. Zwei unabhängige Zweitprüfungen
halten: `Loop` ist genau dann gesetzt, wenn `End` gesetzt ist (198/198), und
Eintrag 198 ist die Abschlussmarke mit `Length == 0` und `Offset` exakt am
Datenende. Kontrollversätze 0 und 10: **0/198**.

**Warum der erste Anlauf scheitern musste — die Lehre.** Das WAVEFORMATEX
beginnt bei Versatz **24**, dem Wert, der sich aus 74 − 50 zwingend ergibt.
Geprüft wurden 0 und 10. Die Rechnung hatte den Versatz die ganze Zeit
vorhergesagt; sie wurde nur nicht befragt. Das ist ein dritter Fehlertyp neben
„falsche Suchmenge" und „blinde Gütefunktion": **die Antwort lag in einer
Rechnung, die schon dastand.**

**~~Offen geblieben:~~ ✅ nachgetragen 2026-08-10.** Hier stand, nur 32,4 % von
`audio.dat` seien referenziert und 48,5 MB adressiere die Tabelle nicht. **Die
Prämisse war falsch.** `audio.fmt` ist kein Feld gleich großer Einträge,
sondern eine Folge von **26 Bänken**, jede mit einer 42 B kurzen
Abschlussmarke. Der O1-Durchlauf hielt die **erste** dieser Marken für das
Dateiende und las danach ein um 42 B versetztes Raster.

Neu belegt: `audio.fmt` byteexakt verbraucht (**724 × 74 + 26 × 42 = 54.668**,
Rest 0), `audio.dat` zu **100,0000 %** überdeckt, 0 Lücken, 0 Überlappungen.
MS-ADPCM-Prädiktortest über alle 66.332 Blockanfänge **100 %**, Kontrollen
(Offsets rotiert) 77,1 % / 58,9 %. Getrennt gerechnet besteht der *neue*
Bereich den Test genauso gut wie der längst belegte.

**Und es war derselbe Fehlertyp wie bei O1 selbst — in derselben Datei:**
`54.668 mod 74 = 56`. Ein reines 74-B-Raster kann `audio.fmt` gar nicht
füllen; die 56 Bytes wurden als „Rest" abgelegt statt befragt. Sie sind genau
`26 × 42 mod 74` — der Fingerabdruck der 26 Marken. Auch das
Abstandshistogramm aus O1-alt zeigte es: 87,1 % statt ~100 % bei 74, mit
**116 B (= 74 + 42) auf Platz 5**. **Die Antwort lag zum zweiten Mal in einer
Rechnung, die schon dastand.**

**Erst danach** lohnt sich der MS-ADPCM-Dekoder (reiner TS-Code,
Node-testbar) — jetzt mit belegten Bereichsgrenzen über die *ganze* Datei.

## O1-alt — der Weg dorthin (historisch)

**Stand.** Die Eintragsgröße **74 Byte** ist hypothesenfrei gemessen: Häufige
u32-Konstanten wiederholen sich zu 87,1 % im Abstand 74 (Zweitplatzierter
3,5 %). Im Eintrag steckt nachweislich ein **WAVEFORMATEX** — Formatkennung 2
(MS-ADPCM), 1 Kanal, 44100 Hz, nBlockAlign 1024, 4 Bit/Sample, cbSize 32. Ein
WAVEFORMATEX mit 32 B Zusatz ist 50 B lang; 6 × u32 + 50 B = exakt 74 B.

**Was fehlt.** Der Vorspann. Versatz 10 trifft die Formatkonstanten in 265/738
Einträgen, Versatz 0 in 198/738 — Faktor 1,34, also kein Befund. 46 Byte
bleiben unverbucht, und nur ~36 % der Einträge teilen dieselben
Formatkonstanten.

**Methode.** Nicht weiter über Quoten raten — die Klangbank ist heterogen,
Quoten mitteln dabei zwangsläufig ins Unentscheidbare. Stattdessen:

1. **Je Eintrag statt global auswerten.** Für jeden der 738 Einträge einzeln
   prüfen, ob ein plausibles WAVEFORMATEX an einer festen Position steht
   (Formatkennung ∈ {1, 2}, Abtastrate ∈ {11025, 22050, 44100}, Bit ∈ {4, 8,
   16}). Der richtige Vorspann ist der, bei dem *jeder* Eintrag ein gültiges
   WAVEFORMATEX trägt — nicht der mit dem besten Mittelwert.
2. **`audio.dat` als Gegenprobe.** Ein Bereich (Offset, Länge) ist richtig,
   wenn an dieser Stelle in `audio.dat` tatsächlich MS-ADPCM-Daten liegen. Ein
   MS-ADPCM-Block beginnt mit einem Prädiktorindex < nNumCoef — das ist ein
   billiger, harter Test, den falsche Offsets fast nie bestehen.
3. **Accounting als Wahrheitstest** (Projektstandard): Die Summe aller Längen
   plus Lücken muss `audio.dat` byteexakt füllen.

**Fallstrick.** Nullwerte sind trivial monoton, trivial rahmenkonform und
trivial überlappungsfrei. Genau daran ist der erste Anlauf gescheitert und
beinahe auch der zweite. Jede Quote **ohne** die Nullfälle zweitrechnen.

**Erst danach** lohnt sich der MS-ADPCM-Dekoder (reiner TS-Code, Node-testbar).

## O2 — Musikindex → Dateiname (Ziel: S23)

**Stand.** Es gibt keine Indexdatei; FFNx löst über eine Funktion in der EXE
auf. Die **Zielmenge ist aber geschlossen**: `data/midi/midi.lgp` und
`data/music_ogg` decken sich zu 94/94. Der Index bildet also in eine bekannte
94-elementige Namensmenge ab — gesucht ist nur noch die Permutation.

**Was widerlegt ist.** Die TOC-Reihenfolge von `midi.lgp` ist nicht der Index:
Die Schwesterarchive desselben Titelsatzes sind nur 40/94, 19/94 bzw. 25/94
positionsgleich. Wäre die Archivordnung kanonisch, müssten alle vier
übereinstimmen.

**Methode.** Zwei unabhängige Wege, beide datengetrieben:

1. **Über die Fields.** `MUSIC` (0xF0) trägt einen feldlokalen Index. Führt
   ein Field eine eigene Musikliste (Verdacht: `flevel`-Sektion 5), dann ist
   deren Eintragszahl eine harte Vorhersage: Der größte im Field vorkommende
   0xF0-Operand muss kleiner sein als die Listenlänge. Über 702 Fields ist das
   ein scharfer Test — er fällt sofort durch, wenn Sektion 5 etwas anderes ist.
2. **Über die Häufigkeit.** Die Verteilung der 0xF0-Operanden über alle Fields
   ist stark ungleich (Feldmusik, Kampfmusik, Themen). Auch die Nutzung der
   Titel ist bekanntermaßen ungleich. Eine Rangkorrelation zwischen beiden
   Verteilungen liefert Kandidaten — **aber nur als Hypothesengenerator**, nie
   als Beleg.

**Entwurfsentscheidung unabhängig davon:** Die Zuordnung wird als
**austauschbare Tabelle** modelliert (Mod-fähig, wie FFNx es faktisch macht),
nicht als eingebaute Konstante. Damit ist S16 auch ohne O2 auslieferbar — die
Tabelle ist dann eben unvollständig statt falsch.

## O3 — Kampf-Opcode ✅ gelöst

**Ergebnis.** `BATTLE` = **0x70**, Operanden: Bank-Byte + u16 Formationsnummer.
`BTLON` = 0x71 (Zufallskämpfe an/aus). Beide sind implementiert, der
Wartezustand und der Rückkanal `battle-finished` sind verdrahtet und durch
Fixture-Tests abgesichert.

**Warum der erste Anlauf scheitern musste — die eigentliche Lehre.** Die
Messung prüfte, ob der Operand in der Kandidatenmenge aus Sektion 7 des
**eigenen** Fields vorkommt. Aber `battleID` ist eine **globale**
Formationsnummer: Sektion 7 beschreibt die *Zufalls*kämpfe eines Fields,
`BATTLE` löst einen *skriptierten* Kampf aus. Die Probe hat in einer Menge
gesucht, in der die Antwort gar nicht liegen kann — nachgemessen steht die
Nummer dort in 1 von 173 Fällen, und im Nachbarfield exakt gleich oft.

Das ist ein anderer Fehlertyp als die bisherigen: nicht eine schlechte
Kontrolle, sondern eine **falsche Suchmenge**. Eine Kontrolle kann das nicht
aufdecken — sie misst dasselbe Rauschen wie der Kandidat und sieht dabei
völlig gesund aus. Der einzige Schutz ist, die Annahme hinter der Suchmenge
selbst auszusprechen: *„Ich nehme an, die gesuchte Nummer stammt aus dieser
Tabelle."* Genau dieser Satz stand nirgends.

**Offen geblieben:** Ob `outcome` aus `battle-finished` im Original in eine
Variable gespiegelt wird und in welche. Der Interpreter schreibt bewusst
nichts, statt eine Adresse zu raten. 🟡

## O3b — Sektion 7 ✅ erschlossen (2026-08-10)

Layout, Bedeutung der Slots und der **Ort** der Daten sind belegt. Vollständig
in [FINDINGS.md](../tools/realdata-scan/FINDINGS.md), Abschnitt „O3b".

**Wo die Daten liegen — drei Orte, sauber getrennt:** Field-Sektion 7 hält
*welcher* Kampf *wie oft*; `data/battle/scene.bin` hält, *was* ein Kampf ist
(Gegner, Geometrie, Kampfort, KI); `enc_w.bin` in `world_us.lgp` dasselbe für
die Weltkarte. Der **Schnitt der ID-Mengen von Sektion 7 und `enc_w.bin` ist
0** — Field und Weltkarte teilen sich den Formationsnummernraum
überschneidungsfrei.

**Layout:** `u8 enabled · u8 rate · u16 standard[6] · u16 special[4] · u16
padding`, je 24 B, zweimal = 48 B. **702/702 byteexakt.**

**Der Wahrheitstest war nicht die Plausibilität der IDs, sondern eine
Summenprobe:** Sind die oberen 6 Bit Wahrscheinlichkeitsanteile, muss ihre
Summe konstant sein. Gemessen **genau ein Wert, 64, in 197/197** belegten
Tabellen; alle Kontrollen (andere Bit-Splits, verschobene Wortbasis,
Big-Endian) liefern 19–57 % bzw. 82–84 verschiedene Summen.

**Nullwert-Zweitrechnung war hier entscheidend:** **1207 der 1404 Tabellen
sind vollständig genullt** (520 der 702 Fields haben keine Zufallskämpfe).
Genau daran krankte der alte S17-Eintrag, der das Layout schon als ✅ führte —
seine vier Vorhersagen bestanden 1207 Tabellen trivial.

**Und der naheliegende Referenzschluss taugte nichts:** „Löst jede ID auf?"
besteht 1083/1083 — aber `id+1` und `id+4` **ebenfalls zu 100 %**, weil 1000
der 1024 Formationen belegt sind. Der scharfe Test ist der **Kampfort**:
195/195 einheitlich gegen Kontrollen bei 73–116/195 und Neuziehung **0/195**.
Verschärft auf die 35 Tabellen, in denen allein `id & 3` entscheidet: **35/35**
gegen 5–14/35. Damit ist `scene = id >> 2`, `formation = id & 3` gemessen.

**Offen:** `rate`-Formel liegt in der EXE (🔴, Clean-Room); Umschalter auf
Tabelle 1 nur eingegrenzt (Opcode 0x4B: 14/15 gegen 4/167 und 6/520 — 🔵
Kandidat, 15 Fields sind kein Beleg); 272 belegte Formationen von keiner der
drei Quellen erreicht (🟡); **`enc_w.bin`-Satzformat** folgt nicht dem
Field-Raster und ist ein eigener Posten (🔴).

## O9 — Operandenlängen ✅ gelöst (2026-08-10)

**Ergebnis.** 16 von 103 abweichenden Längen übernommen, der Rest verworfen.
Spannen-Abschluss **99,73 % → 99,92 %**, Overrun **0,23 % → 0,06 %**. Ein
erneuter Lauf übernimmt nichts mehr — die Tabelle ist ein Fixpunkt.

**Die Referenz pauschal zu übernehmen wäre ein Absturz gewesen: 86,77 %.**
Der Projektstandard „Referenz ist Hypothese, nicht Autorität" hat hier keine
Zeremonie erspart, sondern 13 Prozentpunkte.

**Der eigentliche Fund war kein Tabelleneintrag, sondern ein Lesefehler.**
Bei den Wort-Varianten der IF-Familie ist auch die **linke** Adresse zwei Byte
breit; die VM las ein Byte, wodurch Vergleichsoperator und Sprungziel
verrutschten. Kontrolle: dieselben vier Opcodes je ein Byte zu weit gesetzt
liefern 99,52 % — die Gütefunktion misst also nicht bloß „länger ist besser".

**Und O9 hat einen zweiten, unabhängigen Fehler aufgedeckt:** Der
Sitzungs-Snapshot führte die Stillstandszähler der Bewegungsaufträge nicht
mit. Das brach Snapshot/Restore in 3 von 702 Fields — und war vorher
unerreichbar, weil zu wenige Fields überhaupt bis zu den Bewegungs-Opcodes
kamen. **Lehre: Nach einer Formatkorrektur die gesamte Realdatensuite laufen
lassen, nicht nur die betroffene Probe.**

**Offen geblieben:** 3 der 16 Übernahmen sind nicht *strikt* besser als
`ref±1` (0xc1, 0xe7, 0xfc) und bleiben 🟡; 0x18/0x19 sind aus Formgleichheit
übernommen, nicht aus der Messung. Weiterzukommen bräuchte einen **zweiten,
unmodifizierten** Datensatz — die zweite `flevel.lgp` der Installation gehört
zu einem 7th-Heaven-Overlay und ist keine unabhängige Stichprobe.

## O9-alt — der Weg dorthin (historisch)

**Neu aufgetaucht.** Die aus den Realdaten abgeleitete Längentabelle (S12,
99,73 % Spannen-Abschluss) hat Lücken. Gegen die Strukturgrößen aus Makou
Reactor geprüft, weichen **4 von 8** Stichproben ab:

| Opcode | Referenz | unsere Ableitung |
|---|---|---|
| `BTMD2` 0x22 | 4 | 1 |
| `BTRLD` 0x23 | 2 | 4 |
| `BTLTB` 0x4B | 1 | 0 |
| `BTLMD` 0x72 | 2 | 1 |
| `BATTLE` 0x70 | 3 | 3 ✓ |
| `BTLON` 0x71 | 1 | 1 ✓ |
| `MAPJUMP` 0x60 | 9 | 9 ✓ |
| `WAIT` 0x24 | 2 | 2 ✓ |

Alle vier Abweichungen betreffen **seltene** Opcodes — genau dort trägt der
Spannen-Abschluss als Gütefunktion am wenigsten, weil wenige Vorkommen kaum
Druck auf die Optimierung ausüben.

**Methode.** Die Referenzgrößen als **Hypothese** einsetzen (nicht übernehmen)
und gegen die Realdaten messen: Steigt der Spannen-Abschluss über 99,73 %?
Sinkt die Overrun-Quote unter 0,22 %? Jede Änderung, die beides verbessert,
ist belegt; jede, die es verschlechtert, wird verworfen — auch wenn die
Referenz etwas anderes sagt. Das ist dasselbe Verfahren wie beim
Koordinatenabstieg, nur mit besseren Startwerten.

**Erwarteter Ertrag:** Die 0,22 % Overrun sind die Stellen, an denen der
Interpreter heute aus dem Tritt gerät. Jede korrigierte Länge schließt eine
davon.

## O4 — R4-Sichtprüfungen ✅ vollständig abgeschlossen (2026-08-10)

Zwei Schritte an einem Tag. **Erst gegengeprüft:** Die Merkzettel-Tabelle in
[R4-MODELL-KONVENTIONEN.md](R4-MODELL-KONVENTIONEN.md) war veraltet — 6
Annahmen entschieden, 3 unbelegt, B7 widerlegt ohne Ersatz. **Dann geschlossen:**
Eine zweite Tafel über die vier Restposten, 30 Zellen, vollständig beantwortet
([o4-urteile.json](../tools/realdata-scan/o4-urteile.json)).

| Posten | Ergebnis | Kontrolle |
|---|---|---|
| **B7** | Modellursprung auf dem Boden (= heutige Regel) **3/3 richtig** | Wurzelbone auf dem Boden **3/3 „versinkt"** |
| **B3** | Bytes 0–11 = Rotation **3/3 richtig** | vertauscht **3/3 „falsch"** |
| **B4** | Dateireihenfolge **3/3 richtig** | Breitensuche **3/3 „falsch"** |
| **B10** | Regel **2/2 richtig** | umgekehrte Regel **2/2 „falsch"**, ohne Vorzug **2/2 „falsch"** |

**B7 war ein Definitionsfehler, kein Enginefehler.** „Der Wurzelpivot liegt in
der Hüfte" stimmt — der **Wurzelbone** sitzt 3,0–6,2 Einheiten über dem Boden,
dorthin setzt ihn die `rootTranslation`. Aber die Engine platziert nie den
Wurzelbone, sondern den **Modellursprung**, und der ist der Bodenkontaktpunkt.
Beides ist gleichzeitig wahr; die alte B7-Formulierung war mehrdeutig. Damit
ist zugleich die Semantik der `rootTranslation` erklärt: Sie hebt das Skelett
vom Boden auf Hüfthöhe.

**Die eigentliche methodische Lehre.** Vormittags stand hier noch, B7 sei per
Auge *grundsätzlich* nicht zu schließen, weil die Wurzeltranslation Figur und
Pivot gemeinsam verschiebt. Das galt nur, solange jede Zelle auf ihren eigenen
Inhalt eingepasst wird. Mit einer **externen Referenz im selben Bild**
(eingezeichneter Boden) und einem **festen Sichtfenster** über alle Varianten
war die Frage in Minuten entschieden — und zwar auf **2,5 % der Figurhöhe**
genau, schärfer als jede der fünf gescheiterten Aggregatkennzahlen.

> Eine blinde Gütefunktion ist eine Eigenschaft der **Messanordnung**, nicht
> der Frage — auch dann, wenn das Messgerät ein Auge ist.

**Nebenbefund, der die vorweggenommene Falle umdreht:** Die als „trivial
richtig" markierte Zelle (tiefster Mesh-Punkt exakt auf der Ebene) wurde
**3/3 als „schwebt"** beurteilt. Der tiefste Mesh-Punkt liegt bei korrekter
Platzierung leicht *unter* der Bodenebene. Wer den Bodenkontakt künftig aus
der Geometrie rechnet, darf die Unterkante also **nicht** auf die Ebene legen.

**Rest (🟡, nicht blockierend):** waagerechte Komponenten der
Wurzeltranslation (die Tafel hat keine waagerechte Referenz); B4 gegen
*Tiefensuche* ist im Bestand nicht unterscheidbar, weil `.hrc` bereits
tiefenzuerst auflistet; B10 bleibt eine Bauformregel — belegt ist ihre
Wirkung, nicht ihr Dateibeleg.

Zwei Automatisierungsversuche sind sauber gescheitert und in der R4-Notiz
dokumentiert, damit sie niemand wiederholt.

Zwei Automatisierungsversuche sind sauber gescheitert und in der R4-Notiz
dokumentiert, damit sie niemand wiederholt. Die Lehre daraus steht dort als
Bilanz der fünf Messanläufe: Vier Aggregatmaße haben dieselbe Frage viermal
nicht beantwortet und dabei jedes Mal überzeugend ausgesehen — **für Fragen
nach einer Richtung im Raum ist die Sichtprüfung kein Notbehelf, sondern das
schärfere Instrument.**

## O5 — LGP-„Check-Code" ✅ gemessen und geschlossen (2026-08-10)

**Beide Ausgangshypothesen sind widerlegt, die dritte aus den Quellen
ebenfalls.** Gemessen über **45.563 TOC-Einträge** aus 56 Archiven
(34 inhaltlich verschieden). Vollständig in
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md), Abschnitt „O5".

**Die Verteilung hat die Frage vor jeder Korrelation entschieden:** Das Byte
nimmt im gesamten Bestand **genau zwei Werte** an — 0x0E (98,32 %) und 0x0B
(1,68 %), Entropie **0,1231 Bit**. Ein Prüfwert müsste sein Bild ausschöpfen;
0,12 Bit über 45.563 Einträge kann keine Prüfsumme sein. Alles Weitere war
Bestätigung.

| Hypothese | Ergebnis |
|---|---|
| *Prüfwert* (18 Funktionen: Summe, XOR, vier CRC-8-Polynome, Längen, Offsets — über Name **und** Payload) | 🔴 Beste Quote 7,05 % gegen ein Nullmodell „immer 0x0E" von 98,32 %. Größter Vorsprung vor der **eigenen Nachbarkontrolle**: 3,00 Prozentpunkte — Rauschen einer Funktion mit Bild 15 |
| *Ordnungshinweis* (Position, Sortierschlüssel, Bucket) | 🔴 743 Abstiege (nicht monoton); 1.486 beobachtete Wechsel gegen 1.477,9 zufallserwartete = **Verhältnis 1,005** (keine Blöcke); beste Reinheit über `tocIndex mod k` = 98,3188 %, auf die letzte Stelle **identisch mit dem Mehrheitsanteil** |
| *Konflikt-/Duplikatmarkierung* (dritte Quellenauslegung) | 🔴 2.450 Konflikt- und 1.798 verschattete Einträge tragen **ausnahmslos** 0x0E; disjunkt zur Minderheitsklasse |

**Was stattdessen trägt: eine Partition nach Eintragsart.** 0x0B steht genau
auf den `.hrc`-Einträgen — **766/766**, kein Gegenbeispiel in beide Richtungen,
**0 von 88 Endungen** mit gemischten Werten. Die Nachbarkontrolle derselben
Regel fällt auf der Minderheitsklasse von 100 % auf **3,00 %**; erst diese
Gegenprobe macht die 100 % belastbar.

**Was daraus NICHT folgt.** Warum der Packer das tut, ist unbelegt (🔵). Und
Name gegen Inhalt ist hier **nicht trennbar**: Jede `.hrc`-Nutzlast beginnt mit
`:HEADER_`, beide Partitionen sind im Bestand identisch (🟡).

**Konsequenz:** Neue Fehlerklasse `W-LGP-CHECKBYTE`, rein warnend, **opt-in**
über `ScanOptions.validateCheckByte` (Standard aus), quarantänisiert nichts —
die Regel ist über *einen* Bestand gemessen, nicht aus dem Format hergeleitet,
und darf keinen Import scheitern lassen. Damit ist die Fehlererkennung
nachgeliefert, die die bisherige Vorsichtshaltung gekostet hat.

**Offene Randnotiz (🟡, nicht blockierend):** Die Minderheitsklasse stammt aus
nur **6** verschiedenen Archiven **einer** Installation. Ob andere Releases
denselben Wertevorrat haben, klärt erst eine zweite, unabhängige Installation
— dieselbe Grenze wie bei O9.

## O6 — R1: Prioritätsverdrängung bei Script-Requests (Ziel: S20, P0)

**Stand.** Im Masterplan als „kritischste Kategorie für Determinismus"
markiert und nur teildokumentiert. Falsche Eventreihenfolge zeigt sich als
Softlock, also spät und schwer zuzuordnen.

**Methode.** Nicht aus Dokumentation ableiten, sondern **das eigene Verhalten
gegen sich selbst absichern**:

1. Fixture-Scripts mit bewusst konkurrierenden Requests (gleiche Priorität,
   höhere Priorität, Selbstverdrängung, Verdrängung eines Wartenden) und
   festgeschriebenem Sollablauf.
2. Über die 702 echten Fields die **Häufigkeit** der Konfliktfälle messen: Wie
   oft tritt Verdrängung überhaupt auf? Ist sie selten, sinkt das Risiko und
   die Frage darf mit ADR-Nummer als Restrisiko geschlossen werden — ist sie
   häufig, braucht es einen Verhaltensvergleich.
3. Der Replay-Digest über alle Fields ist der Regressionsschutz: Jede Änderung
   der Verdrängungsregel muss ihn ändern, sonst greift sie nicht.

## O7 — 16-Bit-Bankzugriff an Adresse 0xFF (Ziel: S20)

**Stand.** Der Interpreter wrappt innerhalb der Bank
(`packages/interpreter/src/state.ts`): Ein Wortzugriff auf 0xFF liest
`b[0xFF] | b[0x00] << 8`. Die Alternative wäre ein Übergriff in die
Folgeregion. Beide Auslegungen unterscheiden sich an **genau einer** Adresse.

**Methode.** Erst messen, ob es überhaupt zählt: Über alle 702 Fields zählen,
wie viele Wortzugriffe auf Adresse 0xFF im Bytecode überhaupt vorkommen. Bei
null Vorkommen ist die Frage entschieden — nicht durch Wissen, sondern durch
Irrelevanz, und das wird so dokumentiert. Erst bei Vorkommen lohnt der
Vergleich beider Auslegungen im Replay-Digest.

## O8 — Variablenbank-Kollisionen zwischen Mods (Ziel: S22, vor MS5)

**Stand.** Als P0-Risiko registriert
([MODDING-SUITE-MASTERPLAN.md](MODDING-SUITE-MASTERPLAN.md)). Zwei Mods, die
denselben Variablenbereich beanspruchen, korrumpieren gegenseitig den Save.

**Entscheidung, die ansteht** (keine Forschung, ein Entwurf):
Bankbereichs-Registry gegen Save-seitige Mod-Namespaces.

- *Registry:* Mods deklarieren `variable-claim`, die Engine prüft
  Überschneidungen bei der Aktivierung. Einfach, aber der Bereich ist endlich.
- *Namespaces:* Jeder Mod bekommt eigenen Variablenraum im Save. Robuster, aber
  bricht die Kompatibilität mit Original-Saves.

Die Entscheidung gehört als ADR dokumentiert, **bevor** MS5 anfängt — nachher
ist sie ein Migrationsproblem.

---

## Einordnung in die bestehenden Bögen

| Posten | Session | Blockiert |
|---|---|---|
| ~~O1 `audio.fmt`~~ | ✅ vollstaendig | — (26 Baenke, audio.dat zu 100,0000 % adressiert) |
| O2 Musikindex | S23 | korrekte Musikauswahl (Engine läuft ohne) |
| ~~O3 Kampf-Opcode~~ | ✅ erledigt | — |
| ~~O3b Sektion 7~~ | ✅ erschlossen | — (Parser verdrahtet; `rate`-Formel 🔴 in der EXE) |
| O9 Längentabelle | S20 | 0,22 % Overrun im Interpreter |
| ~~O4 R4-Sichtprüfung~~ | ✅ abgeschlossen | — (alle B1–B10 entschieden, inkl. Resttafel) |
| ~~O10 Höhenversatz Figur↔Walkmesh~~ | ✅ gelöst (Resttafel) | — (Modellursprung = Bodenkontakt, 3/3; waagerechte Wurzeltranslation bleibt 🟡) |
| ~~O5 LGP-Check-Code~~ | ✅ gemessen, geschlossen | — (Partition nach Eintragsart, opt-in-Warnung nachgeliefert) |
| O6 R1-Prioritäten | S20 | Determinismus-Zusicherung |
| O7 0xFF-Wrap | S20 | nichts (Randfall) |
| O8 Mod-Variablenbänke | S22, vor MS5 | Mod-Kombinierbarkeit |

*Rückverweis: [ROADMAP-S13-S19.md](ROADMAP-S13-S19.md) ·
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) ·
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) ·
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md)*
