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
Spannen-Abschluss **99,73 % → 99,92 %**, Overrun **0,23 % → 0,06 %**.

> ⚠️ **Korrektur 2026-08-11.** Hier stand: „Ein erneuter Lauf übernimmt nichts
> mehr — die Tabelle ist ein Fixpunkt." **Das ist falsch und war es schon bei
> der Niederschrift.** Der Abstieg schlägt sehr wohl etwas vor: heute acht
> Änderungen, die den Spannen-Abschluss auf 99,9417 % heben würden. Ursache ist
> nicht Zufall, sondern Mechanik — seit O9 sind vier Längen gewandert
> (0x16–0x19, 0x52, 0xA6/0xA7), und **jede Längenänderung verschiebt den
> Instruktionsstrom und damit die Gütelandschaft aller übrigen Opcodes**. Ein
> Fixpunkt kann diese Tabelle konstruktionsbedingt nie sein.
>
> Richtig ist die schwächere, aber haltbare Aussage: **Kein Vorschlag des
> Abstiegs übersteht die Einzelprüfung.** Details im Abschnitt „O9-Nachlese II".

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

## O9-Nachlese — das Längentabellen-Bündel (2026-08-11)

Sieben Restposten in **einem** Durchgang gemessen, gemeinsam entschieden, in
**einem** engineCompat-Schritt übernommen. Gebündelt, weil jede einzelne
Längenänderung den Instruktionsstrom verschiebt und damit die
Häufigkeitszahlen aller anderen laufenden Messungen entwertet.

**Der eigentliche Fund ist methodisch: der Spannen-Abschluss ist bei seltenen
Opcodes blind, und zwar aus einem benennbaren Grund.** Setzt man `XYI` von
Länge 2 auf 8, landet der Durchlauf sechs Byte weiter — findet aber nach
wenigen Instruktionen wieder auf dasselbe Raster und schließt die Spanne
trotzdem exakt. In **allen 32** betroffenen Spannen. Das ist die bekannte
Selbstresynchronisation variabler Befehlsformate und keine Eigenheit dieses
Bestands. Genau deshalb ließ O9 diese Posten offen: Die Gütefunktion war nicht
unentschieden, sie war **unempfindlich**.

Zwei neue Gütefunktionen schließen die Lücke
(`tools/realdata-scan/src/oplen-bundle-probe.rdtest.ts`,
`oplen-struktur-probe.rdtest.ts`):

1. **Grenzplausibilität.** Byteverteilungen an echten Instruktionsanfängen
   gegen Operandenbytes, als Log-Quotient. Kontrollniveaus: **1,24** an echten
   Anfängen, **−1,16** in Operanden.
2. **Struktursonde.** Der Inhalt der Operanden gegen eine unabhängige Sektion
   desselben Fields: literale Koordinaten gegen die Walkmesh-Grenzen,
   Dreiecksindizes gegen die Dreieckszahl, bankadressierte Werte gegen die
   256-B-Bankgröße (hohes Byte muss 0 sein). Geeicht an `XYZI`, dessen
   Aufteilung bekannt ist: **99,2 %** gegen **0,0 %** bei um ein Byte
   verschobener Lesart.

### Ergebnis: 2 von 7 übernommen

| Opcode | Vorkommen | ist → ref | Urteil |
|---|---|---|---|
| `XYI` 0xA6 | 32 in 14 Fields | 2 → **8** | ✅ übernommen |
| `XYZ` 0xA7 | 42 in 23 Fields | 6 → **8** | ✅ übernommen |
| `MINIGAME` 0x20 | 134 in 78 Fields | 0 → 10 | ❌ **widerlegt** |
| `BGMOVIE` 0x27 | 36 in 13 Fields | 0 → 1 | ❌ nicht belegt |
| `MVCAM` 0xFB | 55 in 23 Fields | 0 → 1 | ❌ nicht belegt |
| `BGROL` 0xE2 | 13 in 6 Fields | 1 → 2 | ~~❌ nicht belegt~~ → ✅ **Runde 4** |
| `BGROL2` 0xE3 | 5 in 2 Fields | 2 = 2 | ~~❌ nicht messbar~~ → ✅ **Runde 4** |

**XYI/XYZ.** Grenzplausibilität 2,37 ± 0,37 bzw. 1,76 bei Länge 8 — über dem
Kontrollniveau echter Instruktionsanfänge; Struktursonde 90,6 % bzw. 88,1 %
gegen 15,6 % bzw. 0,0 % bei Versatz. Bei `XYZ` hätte die Grenzplausibilität
allein in die Irre geführt (sie bevorzugt Länge 4); entschieden hat die
Kontrolle am dritten Wertfeld: auf @7 trifft es zu 88,1 %, auf @9 nur zu
45,2 %.

**MINIGAME ist der interessanteste Posten — die Referenz ist hier nicht bloß
unbelegt, sondern falsifiziert.** In vier Spannen des Fields `ancnt1` steht der
Opcode nur **6 Byte** vor dem Spannenende. Zehn Operandenbytes passen dort
nicht hinein; die Länge kann höchstens 5 sein. Das ist eine harte Schranke ohne
Statistik. Entweder ist 0x20 in diesem Bestand nicht durchgängig MINIGAME, oder
die Instruktion ist variabel lang — mit dem Field-Bytecode allein nicht zu
entscheiden.

**BGROL bleibt unimplementiert, und das ist die eigentliche Entscheidung
dieses Durchgangs.** Die Referenzaufteilung wird von den Daten nicht nur nicht
gestützt, sondern unterboten: Das Parameterbyte an @+2 trifft in **11,1 %**
(1/9) einen Parameter, den dasselbe Field per BGON/BGOFF schaltet — gegen ein
Kontrollniveau von **22,2 %** bei den Parametern eines *fremden* Fields. Zum
Vergleich das Niveau eines belegten Opcodes: `BGON` trifft an derselben Stelle
**98,0 %** (1963/2003) gegen 46,7 % fremd. Eine geratene Rotationssemantik
würde die BGON-Maske derselben Gruppe beschädigen und wäre schlechter als der
heutige Übersprung. Was fehlt, ist ein Bestand mit mehr Vorkommen.

> ⛔ **ZURÜCKGENOMMEN (Runde 4, 2026-08-11).** Der Vergleich ist zirkulär (die
> Menge wird aus BGON gebaut), und acht der neun Fundstellen waren Phantome
> der eigenen Längentabelle. `BGROL` steht seit Runde 4 auf Länge **2** und ist
> implementiert. Was fehlte, war kein anderer Bestand, sondern ein anderes
> Mittel — siehe „Runde 4" weiter unten.

**Spannen-Abschluss vorher wie nachher 99,9230 % (48.004/48.041)**, Overrun
0,0645 %. Dass sich die Kennzahl *nicht* bewegt, ist hier kein Nullergebnis,
sondern die Bestätigung des Befunds: Sie kann diese Posten nicht sehen.

**S-DEADSKIP mitbereinigt.** 17 Opcodes standen in beiden Längentabellen; die
Skip-Einträge waren unerreichbar, weil `vm.ts` zuerst `IMPL_OPERAND_LEN` fragt.
Alle 17 stimmten überein — genau deshalb waren sie gefährlich. Ein Test
erzwingt jetzt Disjunktheit und lückenlose 256er-Abdeckung.

**OP-0x52 umbenannt.** 0x52 heißt `WMODE`, nicht `WCLSE`; `WCLSE` liegt auf
0x54. Beide Längen (3 bzw. 1) waren längst richtig, beide sind Stubs — es
ändert sich kein Verhalten, nur der Name hing am falschen Opcode. Dieselbe
Fehlerklasse wie damals `DIR`/`TURA`.

## O9-Nachlese II — der Abstieg schlägt acht vor, keiner übersteht (2026-08-11)

Vier Restposten der ersten Nachlese entschieden. **Keine Operandenlänge
geändert, kein `engineCompat`-Schritt.** Vollständig mit allen Zahlen in
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md), Abschnitt „Nachlese Welle 1".

**Der Abstieg (implementierte Opcodes eingefroren) macht acht Vorschläge.**
Jeder einzeln, isoliert auf die Ist-Tabelle gesetzt und auf seiner betroffenen
Teilmenge gegen alle 17 Längen gemessen:

| Vorschlag | ist → neu | Maximum | Vorsprung | Urteil |
|---|---|---|---|---|
| `0x0d` | 0 → 3 | 2-fach | 1 | mehrdeutig |
| `0x1d` | 4 → 3 | 3-fach | −3 | schlechter als Ist |
| `0x20` | 0 → 1 | 2-fach (1/4) | 2 | mehrdeutig |
| `0x3a` | 4 → 0 | 3-fach | 1 | mehrdeutig |
| `0x41` | 1 → 4 | 3-fach | 0 | Gleichstand |
| `0x7f` | 2 → 6 | **eindeutig** | **1** | unter Rauschschwelle |
| `0xb7` | 2 → 3 | 7-fach | 0 | Gleichstand |
| `0xef` | 0 → 5 | 2-fach | 1 | mehrdeutig |

**Der Ertrag ist eine neue Kontrolle: die Rauschschwelle.** `0x7f` besteht das
O9-Kriterium formal (50/50 gegen 49/50, beide Nachbarn schlechter, eindeutiges
Maximum) — auf einem Vorsprung von **einer Spanne**. Was eine Spanne wert ist,
sagt erst die Kalibrierung an den **68 eingefrorenen, unabhängig gedeckten**
Opcodes: Dort schlägt in **5 Fällen (7,4 %)** eine nachweislich **falsche**
Länge die richtige, mit median 1 und maximal 3 Spannen Vorsprung — `MUL` (0x89)
um 2, `IFUWL` (0x19) um 3. Ein Ein-Spannen-Vorsprung ist damit **exakt das
Rauschniveau**. Neue stehende Regel: Ein Vorschlag muss mehr Vorsprung bieten
als der größte Vorsprung einer falschen Länge an einem gedeckten Opcode.

**BGROL: das Urteil hält, der Maßstab war falsch.**
> ⛔ **ZURÜCKGENOMMEN (Runde 4).** Der Maßstabswechsel auf BGCLR war richtig,
> die Fundstellenmenge war es nicht: 8 von 9 Stellen waren Phantome. Gepaart
> auf denselben Fields hatte die BGCLR-Eichung **n = 1**; die behauptete
> Disjunktheit verglich 273 fremde Fields gegen 5. Vier der neun Stellen lagen
> in `frcyo` als byteidentische Kopien — Pseudoreplikation. Absatz bleibt als
> Fehlerprotokoll stehen.

Die erste Nachlese verglich
`BGROL`@+2 mit `BGON`@+2 (98,0 %) — tautologisch, weil die Vergleichsmenge aus
BGON selbst gebaut wird. Der ehrliche Maßstab ist `BGCLR` (gleiche Form, gleiche
Länge 2, nicht in der Menge): **98,1 %** (608/620), 95-%-Intervall
[96,6 %, 98,9 %], gegen `BGROL` **12,5 %** (1/8), [2,2 %, 47,1 %] — **disjunkt**.
Trotz n = 8 ist damit belegt, dass @+2 bei BGROL kein Parameterbyte dieser
Familie trägt. Die als Zweitmessung erwogene *Nachfolgerprobe* wurde an BGCLR
und BGON geeicht und **fällt dort durch** (sie zeigt bei beiden auf Länge 0);
sie wurde deshalb nicht ausgewertet. 🔴 `0xE2`/`0xE3` bleiben Skip.

**MINIGAME/BGMOVIE/MVCAM: sie kommen vor, entscheidbar sind sie nicht.**
> ⛔ **Zur Hälfte zurückgenommen (Runde 4).** „Sie kommen vor" ist mit der
> verankerten Zählung nicht belegt — ein nachweislich falsches Raster findet
> zehnmal so viel. Und die harte Schranke ≤ 5 beruht auf einem eigenen
> Tabellenfehler bei `IFKEYON`. Was steht: Die Referenzlänge 10 bleibt in
> jeder Lesart draußen.

Verankerte Vorkommen 118 (79 Fields), 18 (13), 38 (23). Harte Schranken ≤ 5,
≤ 3, ≤ 3 — die Referenz 10 für `MINIGAME` bleibt physisch widerlegt. Über alle
Längen 0…12 erreicht keiner ein eindeutiges Maximum über der Rauschschwelle;
bei `BGMOVIE` schließen 0, 1 und 2 identisch 18/18. 🔴 Alle drei bleiben auf
dem Ist-Wert — mit dem ausdrücklich benannten Preis, dass Länge 0 die VM
Operandenbytes ausführen lässt.

**junonr2 (Ermittlung, keine Codeänderung).** Der BG-Bereich [1688, 2293) wird
**ausschließlich über Slot 0** betreten (Init/Main, Priorität 7); in 300 Ticks
feuert **kein einziger REQ** (0 von 6013 Kontextstarts), 151 der 174 Spannen
werden nie betreten. Die Verdrängungsregel wird damit an diesem Field **nie
ausgelöst** — die Frage ist dort nicht beantwortbar. Die Masken sind nicht
„stehengeblieben": `smoke1`/Slot 0 fährt eine BGOFF/BGON-Paarfolge über
s = 0…7 mit Periode 33 Ticks; `door` und `smoke0` löschen ihre Gruppen im Init
per BGCLR selbst. Korpusweit sind **alle 329** nach 300 Ticks leeren
Kachelgruppen vom Skript geleert worden, **keine einzige** durch Nichtbeachtung
— eine leere Maske ist ein regulärer Skriptzustand, kein Interpreterfehler.

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

## O7 — 16-Bit-Bankzugriff an Adresse 0xFF ✅ geschlossen (2026-08-11)

**Ergebnis.** Die Wrap-Regel bleibt — sie steht jetzt auf einer Zahl statt auf
einer Annahme. Gemessen über alle 702 Fields
(`tools/realdata-scan/src/bank-wrap-probe.rdtest.ts`):

| Zählung | Fundstellen |
|---|---|
| Wortvarianten mit Bankzugriff auf Adresse 0xFF | **1** (Field `blinele`, Opcode 0x90 `AND2`) |
| IF-Wortvarianten mit 0xFF | **0** |
| Kontrollzählung, dieselbe Auswertung für 0xFE | **0** |

**Geschlossen durch Irrelevanz, nicht durch Wissen** — und das ist hier die
korrekte Auflösung: Bei einer einzigen Fundstelle im gesamten Bestand kann
keine der beiden Auslegungen (Wrap innerhalb der Bank gegen Übergriff in die
Folgeregion) einen sichtbaren Unterschied machen. Ein Verhaltensvergleich im
Replay-Digest wäre eine Messung an einem einzigen Byte.

**Die Kontrollzählung trägt die Aussage.** Ergäbe 0xFE hundert Fundstellen und
0xFF eine, wäre die Seltenheit von 0xFF ein eigener Befund. Beide bei ~0 heißt:
Es ist schlicht die Randlage hoher Bankadressen, die Skripte nutzen den oberen
Bankrand nicht.

**Die Probe bleibt als Dauerprobe stehen** und schlägt bei mehr als 5
Fundstellen fehl. Die Irrelevanz ist eine Eigenschaft des Bestands, nicht der
Engine — ein Mod oder ein anderer Datenstand kann sie jederzeit aufheben.

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

## Runde 4 (2026-08-11) — BGROL entschieden, ein neuer Posten aufgemacht

**BGROL 0xE2 ist implementiert, Operandenlänge 2.** Entschieden hat nicht eine
Quote, sondern die **Struktur einer einzigen Spanne**: `hyou4` [2137, 2213)
enthält fünf 0xE2- und vier 0xE3-Blöcke, die byteidentisch gebaut sind
(`24 07 00 · eX 00 01`). 0xE3 stand immer auf Länge 2; unter der alten Länge 1
für 0xE2 zerfiel die e2-Hälfte in `BGROL 00 / REQ / RET`, während die e3-Hälfte
sauber las — dieselbe Konstruktion, zwei Lesarten in einer Spanne. Unter
Länge 2 lesen beide gleich. Stützend: Der Schleifenrumpf ab 2145 schließt nur
unter Länge 2 hinter dem `JMPB` (erstes RET bei 2212 statt 2161).

**Kostenfreies Referenzbündel: 53 Längen übernommen.** Kriterium war „der
Spannen-Abschluss wird nicht schlechter"; gemeinsam angewandt geht er von
48.004/31/6 auf **48.006/29/6**. ⚠️ Kostenfreiheit ist kein Beleg für
Richtigkeit — der Ertrag ist die gesenkte **Phantomrate**, alle 53 stehen 🟡
mit Herkunft Referenz. Wirkung: 0xE2 fällt von 13 Fundstellen in 6 Fields auf
6 in 2, `MINIGAME` 0x20 von 118 verankerten in 79 Fields auf 67 in 49.

**Semantik.** BGROL rotiert die Zustandsmaske ein Bit weiter, BGROL2 eines
zurück; Breite **8 Bit** (gemessen: der Zustandsoperand von BGON/BGOFF nimmt
über 9684 Literalvorkommen genau die Werte 0…7 an). 🟡 Ob „weiterschalten"
rotieren oder auf den nächsten *tatsächlich vorkommenden* Zustand springen
heißt, geben die Daten nicht her: 195 von 1256 Kachelgruppen haben Lücken, aber
keine davon liegt in einem Field, das BGROL benutzt. Gewählt ist die Rotation
als einfachere Regel, die Alternative ist im Quelltext benannt.

**Nebenbefund zum `RET` bei 2144: (c) toter Code, belegt.** Die Entität `nami`
hat 32 Skript-Slots, und alle 32 zeigen auf 2137 — es gibt keinen
Eintrittspunkt bei 2145. Korpusweit enthalten **26,7 % aller Spannen**
unerreichbare Instruktionen (32,5 % aller Instruktionen). Der Rollblock ist
eine stillgelegte Animationsschleife.

### ✅ O11 — Rückwärtssprünge lagen um ein Byte daneben (behoben 2026-08-15)

**Behoben in einem Zug mit dem Fixture-Assembler** (Welle 4). `vm.ts` rechnet
jetzt `ip − offset`, `script-assembler.ts` kodiert entsprechend ab dem
Opcode-Byte. Dauerprobe: `tools/realdata-scan/src/sprungziel-probe.rdtest.ts`
— `JMPB` 99,5 % (5270/5298) gegen 0,7 %, `JMPBL` 80,2 % gegen 0,0 %, Eichung an
`JMPF`/`JMPFL` 98,8 % gegen 4,9 %. Alle drei Replay-Digests sind dabei
gewandert; das war die Probe darauf, dass beide Seiten mitgezogen haben.

Der ursprüngliche Befund:

| Posten | Befund | Wirkung |
|---|---|---|
| **O11** `JMPB`/`JMPBL` | `vm.ts` rechnet `ip + 1 − off`; das Ziel liegt in **39/5286 (0,7 %)** auf einer Instruktionsgrenze. `ip − off` trifft **5266/5286 (99,6 %)**, bei `JMPBL` 97/97 gegen 0/97. | Auf echten Field-Daten läuft fast jeder Rücksprung ins Leere. |

Die Messanlage ist an den Vorwärtssprüngen geeicht und besteht dort (`JMPF`
7809/7876 mit der heutigen Rechnung gegen 974/7876 verschoben) — vorwärts
stimmt, rückwärts nicht.

**Bewusst nicht behoben:** Der Fixture-Assembler
(`tools/fixture-gen/src/script-assembler.ts`) erzeugt Rücksprünge mit derselben
Konvention. Beide Seiten sind konsistent falsch, alle Fixtures laufen; eine
einseitige Korrektur zerreißt jede Fixture-Schleife und bewegt alle
Replay-Digests. Die Korrektur gehört in **einem** Zug mit dem Assembler
gemacht — Interpreter und `tools/fixture-gen` gehören verschiedenen Revieren.

### Sonden konsolidiert

Fünfzehn Wegwerfsonden dieses Tages (`bgrol-adversarial2…5`,
`bgrol-*-gegenprobe`, `gegenprobe-minigame*`, `minigame-gegenprobe*`,
`zz-gegenprobe-fixpunkt`) sind gelöscht und durch **drei** Dauerproben ersetzt:
`bgrol-belegkette.rdtest.ts` (Bündel, Phantomrate, Spannenstruktur,
Semantikfrage), `minigame-laengenfrage.rdtest.ts` (Rauschboden, Schranke,
Abschlussverlauf) und das bestehende `oplen-abstieg-nachlese.rdtest.ts`
(Abstieg und Rauschschwelle).

### Die Lehre

**Wenn eine Gütefunktion blind ist, folgt daraus, mit einem anderen Mittel zu
entscheiden — nicht, dass es nichts zu entscheiden gibt.** Die vollständige
Fehlkette steht als Lehrstück in `packages/interpreter/src/opcodes.ts`.

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
| ~~O7 0xFF-Wrap~~ | ✅ geschlossen | — (1 Fundstelle im ganzen Bestand, Dauerprobe steht) |
| O8 Mod-Variablenbänke | S22, vor MS5 | Mod-Kombinierbarkeit |
| **O11 Rücksprungziel** | S22 (mit `fixture-gen`) | Kontrollfluss auf echten Field-Daten |

*Rückverweis: [ROADMAP-S13-S19.md](ROADMAP-S13-S19.md) ·
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) ·
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) ·
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md)*


---

## F15 — der Gateway-Record, und was er über Negativbefunde lehrt (2026-08-15)

Der Übertritt zwischen Fields feuerte nie. Ursache war eine zur Hälfte falsche
Deutung des 24-B-Records; die Messung steht in
[DEMO-FINDINGS-1.0.md](DEMO-FINDINGS-1.0.md) (Welle 4). Hierher gehört die
**methodische** Lehre, weil sie sich einreiht in die drei Fehlertypen, die
dieses Dokument schon führt:

1. falsche Suchmenge (O2),
2. blinde Gütefunktion (O9, BGROL),
3. die Antwort stand längst in einer Rechnung (O1, zweimal).

**Neu, Typ 4: eine Kandidatenmenge, die den richtigen Platz nicht enthält.**
S11 hielt fest, der Zielpunkt stehe *nicht* im Gateway-Record — sauber gemessen,
mit Kontrollniveau, und trotzdem falsch. Geprüft worden waren die Versätze @12,
@16 und @18. Der Zielpunkt steht an **@8** und trifft dort 978 von 978. Der
Negativbefund war nicht das Ergebnis einer schlechten Messung, sondern einer
Menge, die den richtigen Kandidaten gar nicht enthielt.

**Was daraus für künftige Messungen folgt.** Ein Negativbefund über eine
*Position* ist erst dann einer, wenn die Kandidatenmenge **erschöpfend** ist —
bei einem 24-B-Record sind das elf `i16`-Paare, nicht drei. Wo das zu teuer
ist, gehört die Menge ausdrücklich in den Befund („geprüft wurden @12/@16/@18"),
damit der nächste Durchgang sie erweitern kann, statt sie zu glauben.

**Zwei weitere Hypothesen sind an derselben Stelle gefallen** — beide vermessen,
nicht verworfen: Die Endpunkte sind **keine** Walkmesh-Vertices (Bestwert
2/1095), und @0/@6 sind **keine** Dreiecksnummern (0,8 % / 0,9 % gegen
Nachbarkontrollen 0,4 % / 1,8 %). Eine Austritts**linie** ist im Record nicht
auffindbar; der Übertritt läuft deshalb über den Punkt.

## F35 — wenn drei Deutungen scheitern und die alte Regel bleibt (2026-08-15)

F35-1 endete mit einer Alternative: Heißt eine leere Hintergrundmaske
„unsichtbar" oder „Anfangszustand"? Beide Lesarten waren plausibel, und genau
das ist der Zustand, in dem in diesem Projekt normalerweise geraten würde.

**Alle drei geprüften Deutungen sind an ihrer eigenen Vorhersage gescheitert** —
Einmal-Effekte (H1), Rückfall auf den Anfangszustand (H2), BGCLR ≠ BGOFF (H3).
Die Zahlen stehen in den [Demo-Findings](DEMO-FINDINGS-1.0.md).

**Das methodisch Wichtige ist die Vertauschungskontrolle.** H1 sagte, auf 0
endende Gruppen seien kleiner. Gemessen: Median 36 gegen 25 — die falsche
Richtung. Man könnte daraus „also H2" folgern. Die Kontrolle mit **vertauschten**
Endmasken liefert 35 gegen 27, also praktisch denselben Split. Damit ist nicht
H1 widerlegt und H2 bestätigt, sondern **die ganze Messgröße entwertet**: Die
Endmaske trägt über die Gruppengröße keine Information. Ohne die Kontrolle wäre
aus einem Nicht-Signal ein Befund geworden.

**Entschieden hat am Ende eine Größe, die keine Deutung braucht:** Welchen
Bildanteil nimmt die geltende Regel weg? Median **0,0 %**; 27 von 508 Fields
über 10 %, genau **eines** über 50 %. Der typische Field verliert nichts, also
bleibt die Regel — und der Ausläufer ist als Dauerprobe eingezäunt, statt
weggeredet zu werden.

**Nebenbefund, der eine eigene Zeile verdient:** Die Zuordnung in F35-1 („`lift`
ist die Hintergrundgruppe param 17/18") war falsch. `lift` hat weder Modell noch
Hintergrundparameter; 17 und 18 gehören `smoke0`/`smoke1`. Der Fehler entstand
dadurch, dass zwei modelllose Entitäten und drei Hintergrundparameter im selben
Field vorkamen und die Zuordnung **erschlossen statt gemessen** wurde. Die
Messung war einen Kontrollflusslauf entfernt.

## F07 — der erste Schreibpfad des Projekts (2026-08-15)

Bis Welle 4 hat WebMidgar **nur gelesen**. Der Menü-Schreibpfad ist damit ein
Bruch mit einer bis dahin bequemen Eigenschaft: Was man nicht schreibt, kann man
nicht beschädigen. Drei Vorkehrungen ersetzen diese Bequemlichkeit:

1. **Die Bytes sind die Wahrheit.** Geschrieben wird in den 4340-B-Slot,
   `readSavemap` bleibt die einzige Deutung. Ein zweiter Weg über das
   `Savemap`-Objekt hätte zwei Quellen erzeugt.
2. **Keine Handlung in place.** Jede Funktion gibt einen neuen Slot zurück. Das
   kostet 4,3 kB je Handlung und macht die Frage „welche Bytes hat das
   geändert?" zur Testroutine.
3. **Die Bytedifferenz ist die Abnahme.** Nicht „liest sich der Wert zurück",
   sondern „hat sich außerhalb des erlaubten Fensters etwas bewegt".

**Die Datei des Nutzers wird nie geschrieben.** Der veränderte Slot geht in den
eigenen, versionierten Spielstand; die Installation bleibt Lesequelle.

🔴 **„Benutzen" bleibt offen, und zwar aus Datenlage, nicht aus Zeitmangel.**
Der `ItemRecord` trägt `attackPower` und `damageCalculationId`, aber keine
belegte Wirkungsangabe. Solange nicht gemessen ist, wie viele HP ein Trank
zurückgibt, ist die ehrliche Umsetzung **keine** — ein Gegenstand, der
verbraucht wird und nichts tut, ist schlechter als ein fehlender Menüpunkt. Eine
mögliche Messung liegt auf der Hand und ist notiert: Die Beschreibungstexte der
Kernel-Listen enthalten Zahlen; welcher Recordbyte diese Zahl vorhersagt, ist
mit Vertauschungskontrolle prüfbar.

## Offen aus Welle 4

- 🔴 **F35-Rest:** Was `junonr2`s `lift` zeichnet, ist ungeklärt — weder Modell
  noch Hintergrundparameter. Die Animationsspannen hängen an Story-`REQSW`.
- 🔴 **Bildanteil-Ausläufer:** 27 Fields verlieren mehr als 10 % ihrer Kacheln,
  `junin7` 61,7 %. Als Dauerprobe eingezäunt, nicht erklärt.
- 🔴 **Gegenstandswirkung** (s. o.) — Voraussetzung für „Benutzen".
- 🟡 **HP-/MP-Maxima nach Ausrüstungswechsel** (@56/@58 tragen Boni).
- 🔴 **Materia-Umverteilung** beim Waffenwechsel.
- ⚠️ **`menu-savemap-probe.rdtest.ts`** schließt seine Dateihandles nicht; der
  Realdatenlauf meldet dadurch zwei `ERR_INVALID_STATE`-Fehler außerhalb der
  Tests. Kein Fehlschlag, aber Lärm, der einen echten Fehler verdecken kann.
