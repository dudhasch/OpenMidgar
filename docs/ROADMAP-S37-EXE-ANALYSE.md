# WebMidgar — Roadmap S37: Die EXE als Datenquelle

Fortschreibung der Roadmap (S1–S19 ✅ abgeschlossen; S20–S26 siehe
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md), S27–S36 siehe
[ROADMAP-S27-S36.md](ROADMAP-S27-S36.md); Architekturreferenz:
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md)).

**Thema dieses Bogens:** ROADMAP-S27-S36 stellt in Zusatzregel 3 fest, dass
ATB-Konstanten, Schadensformeln, Minigame-Physik und die Fahrzeug-/
Geländematrix „vermutlich ganz oder teilweise **in der EXE, nicht in Daten**"
liegen, und zieht daraus den Schluss: dort gibt es nichts zu parsen, also
🔵 Eigenentwurf. **Dieser Bogen prüft genau diesen Schluss nach** — und zwar
den Teil davon, der falsch ist.

---

## Die Abgrenzung, die diesen Bogen überhaupt zulässig macht

ROADMAP-S27-S36 Zusatzregel 4 lautet: *„Kein Disassemblieren der
Original-EXE."* Diese Regel bleibt **unverändert in Kraft**. Sie wird hier
nicht aufgeweicht, sondern **präzisiert**, weil sie zwei sehr verschiedene
Dinge in einen Topf wirft:

| | Was es ist | Status |
|---|---|---|
| **Codeanalyse** | Instruktionen lesen, Kontrollfluss rekonstruieren, aus dem Maschinencode einen Algorithmus ableiten | 🚫 **Bleibt verboten.** Das ist Dekompilierung und genau das Risiko, gegen das Clean-Room schützt. |
| **Datenextraktion** | Statisch abgelegte Tabellen aus der Datei lesen — Zahlenfelder, Zeichenkettenlisten, Record-Arrays | ✅ **Zulässig.** Das ist derselbe Vorgang wie bei `flevel.lgp`: eine Datei der Nutzerinstallation wird lokal gelesen. |

Die EXE ist eine Datei mit einem Codeabschnitt **und** einem Datenabschnitt.
Der Datenabschnitt enthält Arrays wie jeder andere Container auch. Ihn zu
lesen unterscheidet sich technisch und rechtlich nicht davon, `kernel.bin` zu
lesen — die Bytes liegen nur in einer anderen Datei. Dass mehrere
Community-Werkzeuge (u. a. der EXE-Editor von FF7Scarlet) genau das seit
Jahren tun, ist ein Hinweis auf die Machbarkeit, **nicht** auf die
Zulässigkeit; letztere folgt aus der Abgrenzung oben.

🔵 **Architekturentscheidung — Fundstelle statt Fundstück.** Das Repository
enthält **niemals** extrahierte Werte. Es enthält ausschließlich
**Lokatoren**: Byte-Signaturen, Struktur-Invarianten und Versions-Fingerprints,
also eine Beschreibung davon, *wo* und *woran* eine Tabelle zu erkennen ist.
Die Werte selbst entstehen erst beim Import auf dem Rechner des Nutzers, aus
dessen eigener Datei, und landen im lokalen Cache. Damit gilt für die EXE
exakt dieselbe Rechtslage wie für alle anderen Originaldaten des Projekts —
und der Diagnose-Export bleibt beweisbar assetfrei.

🔵 **Die EXE bleibt optional.** Keine Tabelle dieses Bogens darf zur
Voraussetzung werden. Fehlt sie oder ist sie unauffindbar, läuft die Engine
mit ihren eigenen, dokumentierten 🔵-Werten weiter und sagt das in der
Diagnose. Ein Bogen, der die Engine von einer erfolgreichen Signatursuche
abhängig macht, wäre schlechter als gar keiner.

---

## Was dieser Bogen liefert — und was ausdrücklich nicht

**Die ehrliche Obergrenze zuerst, damit niemand mehr erwartet:**
Der Datenabschnitt enthält **Tabellen, keine Algorithmen**. Wir können daraus
die *Koeffizienten* einer Schadensformel gewinnen, nicht ihre *Gestalt*. Wir
können ATB-Grundwerte je Charakter lesen, nicht die Regel, nach der der
Balken tickt.

Das verschiebt die in ROADMAP-S27-S36 aufgeworfene Grundsatzfrage, ohne sie
aufzulösen:

| | vorher | nach S37 |
|---|---|---|
| Tabellenwerte (Grundwerte, Modifikatoren, Kurven, Namen) | 🔴 geraten oder 🔵 erfunden | 🟢 **aus den eigenen Daten gelesen** |
| Verknüpfungsregel (Formelgestalt, ATB-Tick, Physik) | 🔵 Eigenentwurf | 🔵 Eigenentwurf — **aber gegen echte Werte kalibrierbar** |

Der zweite Punkt ist der eigentliche Ertrag. Eine Formelhypothese, deren
Konstanten geraten sind, lässt sich gegen nichts prüfen — jede Abweichung kann
an der Gestalt *oder* an den Zahlen liegen. Sind die Zahlen belegt, wird die
Gestalt zur **einzigen** freien Variablen und damit erstmals falsifizierbar.
Genau das ist in diesem Projekt der Unterschied zwischen einer Messung und
einer Meinung.

---

## S37 — EXE-Datenbasis

| Feld | Inhalt |
|---|---|
| **Ziel** | `packages/formats-exe` (neu): Die Spiel-EXE wird eine **Importquelle wie ein LGP-Archiv**. (a) **Versions-Fingerprint** (Dateigröße + Hash ausgewählter Regionen) ordnet die vorliegende Datei einer bekannten Release-Matrix zu; unbekannte Builds laufen im „best effort"-Pfad mit erhöhter Diagnostik. (b) **Signaturbasierter Lokator**: Jede Zieltabelle wird über ein Bytemuster **plus** Struktur-Invarianten gesucht, nie über einen fest verdrahteten Versatz — Versätze überleben keinen Buildwechsel, Muster oft schon. (c) **Extraktion + Kreuzvalidierung** der Zieltabellen (s. u.) in NAM-Strukturen. (d) Ergebnis landet als **austauschbare Tabelle** im lokalen Cache — mod-fähig, wie beim Musikindex bereits entschieden. (e) `tools/realdata-scan`: Probe, die vor jeder Extraktion misst, was in der Datei des Nutzers überhaupt auffindbar ist |
| **Voraussetzungen** | S13 (Kernel-Records + Textdekoder — die Gegenprobe für alle Namenstabellen), S14 (Savemap-Records), S18 (Import-Zustandsmaschine, assetfreier Diagnose-Export), S20 (Fingerprint-Matrix-Verfahren steht). **Nicht** vorausgesetzt: S30+ — dieser Bogen ist bewusst **vorziehbar** und liefert Eingangsdaten für das Kampfsystem, nicht umgekehrt |
| **Betroffene Module** | `packages/formats-exe` (neu: Fingerprint, Lokator-Registry, Extraktoren, NAM, Fehlerklassen), `packages/app-shell` (EXE als optionaler Importschritt im Wizard, Fähigkeitsmatrix), `packages/cache` (Extraktionsergebnis als versionierter Cache-Eintrag), `packages/audio` (Musikindex-Tabelle bekommt endlich eine Quelle), `tools/fixture-gen` (**eigener Mini-PE-Writer**: erzeugt synthetische Testdateien mit bekannten Tabellen an bekannten Stellen), `tools/realdata-scan` (Lokator-Trefferprobe + Kreuzvalidierung) |
| **Akzeptanzkriterien** | Fingerprint erkennt die lokale EXE und ordnet sie zu oder meldet `E-EXE-FINGERPRINT` mit Diagnose; **jede** extrahierte Tabelle besteht mindestens **eine** Kreuzvalidierung gegen bereits belegte Projektdaten (s. „Wahrheitstests"); Accounting je Tabelle byteexakt (Recordzahl × Recordgröße füllt die Region zwischen zwei Ankern vollständig); Kontrollhypothese je Lokator dokumentiert und **durchgefallen**; unauffindbare Tabelle → `W-EXE-TABLE-MISS` + 🔵-Rückfallwert, Engine läuft weiter (Fixture-Test); Extraktion ohne EXE übersprungen, Engine unverändert lauffähig (Fixture-Test); Diagnose-Export nachweislich frei von extrahierten Werten; FINDINGS.md-Eintrag je Tabelle mit Trefferquote, Kontrolle und Kreuzvalidierung |
| **Nicht-Ziele** | **Kein Disassemblieren, kein Rekonstruieren von Instruktionsfolgen, kein Ableiten von Algorithmen aus Code** — S27-S36 Zusatzregel 4 gilt unverändert; keine extrahierten Werte im Repository; **kein Schreiben** in die EXE (reiner Lesezugriff, kein Patcher, kein Modding-Pfad in die EXE hinein); keine Abhängigkeit der Engine von einer erfolgreichen Extraktion; keine Formelherleitung — dieser Bogen liefert Zahlen, nicht Gleichungen |
| **Formatlage** | PE-Containerstruktur (Sektionstabelle, Abschnittsgrenzen) 🟢 (offener Industriestandard, keine FF7-Frage); Lage und Layout jeder einzelnen Zieltabelle 🔴 (per Probe zu erschließen); Stabilität der Signaturen über Releases 🟡 — **in dieser Session prüfbar**, weil die Installation drei Programmdateien aus drei Jahren enthält, davon zwei sprachverschieden; Zeichenkodierung der Namenstabellen 🟡 (Verdacht: dieselbe Tabelle wie S13, was zugleich die schärfste Gegenprobe ist) |
| **Prompt** | „Probe zuerst, Extraktion später. Erst messen: Welche Abschnitte hat die lokale EXE, wo liegen Regionen mit Recordstruktur (Strukturkarte ‚Wertevielfalt je Byteposition'), und welche Kandidatenregionen bestehen eine Kreuzvalidierung gegen bereits belegte Projektdaten? Dann `packages/formats-exe` mit signaturbasierten Lokatoren und Struktur-Invarianten, niemals festen Versätzen. Jede Tabelle braucht Accounting, Kontrollhypothese und **mindestens eine externe Kreuzvalidierung**. Kein Codeabschnitt wird interpretiert. Fehlende Tabelle ist ein zulässiges Ergebnis und muss die Engine unberührt lassen." |

---

## Die Zieltabellen, nach Ertrag sortiert

Die Reihenfolge ist bewusst nicht thematisch, sondern nach **Beweisbarkeit**:
Zuerst kommt, was sich hart gegen vorhandene Daten prüfen lässt. Eine Tabelle,
die keine Kreuzvalidierung zulässt, ist der schlechteste Startpunkt — auch
wenn sie inhaltlich interessanter wäre.

| # | Tabelle | Erwarteter Ertrag | Kreuzvalidierung |
|---|---|---|---|
| **1** | **Musiktitel-Namen** | Schließt **O2** — den Musikindex | 🟢 **Die schärfste, die es gibt.** Die Zielmenge ist bereits belegt geschlossen: `midi.lgp` und `music_ogg` decken sich zu 94/94. Ein richtiger Lokator liefert **genau diese** Namen. Ein falscher kann das nicht zufällig treffen |
| **2** | Item-/Materia-/Zauber-Namen | Anker für alle folgenden Record-Tabellen | 🟢 Muss sich mit den `kernel.bin`-Zeichenketten aus S13 decken (98,9 % dekodierbar) |
| **3** | Shop-Bestände, Materia-Ausrüstungseffekte | Menü- und Shopmodul | 🟢 Jede referenzierte Item-ID muss in den S13-Kernel-Records existieren |
| **4** | Fahrzeug-/Geländematrix (Weltkarte) | Löst einen 🔴-Posten aus S28/S29 | 🟡 Gegen die Geländetypen aus dem Weltkarten-Terrain, sobald S28 sie kennt |
| **5** | ATB-Grundwerte, Geschwindigkeits-/Zeitkurven | Macht S31 kalibrierbar | 🟡 Gegen beobachtbares Verhalten (dokumentierte Sichtprüfung), nicht gegen Daten |
| **6** | Schadens-/Elementar-/Statusmodifikatoren | Macht die Formelgestalt falsifizierbar | 🟡 Wie 5 |
| **7** | Minigame-Konstanten | Reduziert 🔵-Erfindung in S34/S35 | 🔴 Zunächst keine — deshalb **zuletzt** |
| **8** | Zielvariable des Kampfergebnisses (`outcome`) | Schließt den letzten offenen Punkt aus S17 | 🟡 Gegen die Savemap-Regionen aus S14 |

Posten 1 ist der Beweis, dass das Verfahren trägt. Läuft er durch, ist die
Methode belegt und die übrigen sind Fleißarbeit. Läuft er **nicht** durch,
obwohl seine Kreuzvalidierung die günstigste von allen ist, dann trägt das
Verfahren nicht — und der Bogen endet nach Posten 1 mit einem sauberen
Negativbefund statt mit sieben unbelegten Tabellen. Das ist ausdrücklich ein
zulässiges Sessionergebnis.

---

## Die Wahrheitstests dieses Bogens

Eine Signatursuche findet **immer** etwas. Genau deshalb braucht dieser Bogen
strengere Prüfungen als jeder bisherige, nicht lockerere.

### 1. Kreuzvalidierung gegen bereits belegte Daten — der Hauptbeweis

Das ist das Instrument, das bei der EXE **besser** verfügbar ist als
anderswo: Viele Tabellen dort referenzieren Dinge, die wir längst unabhängig
geparst haben. Der Musikindex muss genau die 94 Namen liefern, die in
`music_ogg` liegen. Item-Namen müssen sich mit den Kernel-Zeichenketten
decken. Shop-Bestände müssen auf existierende Item-IDs zeigen.

Das ist kein Plausibilitätsargument, sondern ein **externer** Test: Die
Prüfmenge stammt aus einer anderen Datei, die ein falscher Lokator nicht
kennt. Er kann sie nicht zufällig treffen.

### 2. Accounting

Projektstandard, unverändert: Eine Tabelle gilt erst als richtig, wenn
Recordzahl × Recordgröße die Region zwischen zwei unabhängig bestimmten
Ankern **byteexakt** ausfüllt. Ein Rest von 3 Byte ist kein Rundungsfehler,
sondern ein Gegenbeweis.

### 3. Kontrollhypothese

Jeder Lokator wird zusätzlich an einer bewusst falschen Stelle angesetzt —
verschobener Versatz, anderer PE-Abschnitt, Nachbarregion. Findet er dort
etwas, das die Invarianten ebenso gut erfüllt, ist die Invariantenmenge zu
schwach und der Fund wertlos.

### 4. Die zwei bekannten Grenzen der Kontrolle — hier besonders akut

Beide Fehlertypen, die dieses Projekt teuer gelernt hat, sind bei einer
Signatursuche **wahrscheinlicher** als bei einem Containerformat:

- **Falsche Suchmenge.** Wenn die gesuchte Tabelle gar nicht statisch in der
  Datei liegt, sondern zur Laufzeit aufgebaut wird, misst die Kontrolle
  dasselbe Rauschen wie der Kandidat und sieht dabei gesund aus. Schutz: Die
  Annahme *„ich nehme an, diese Größe liegt als statische Tabelle vor"* muss
  bei jedem Posten ausgesprochen werden, bevor gesucht wird — und Posten mit
  Kreuzvalidierung zuerst geprüft werden, weil nur sie diesen Fehler aufdecken
  können.
- **Blinde Gütefunktion.** „Sieht aus wie eine Tabelle" ist gegenüber dem
  *Inhalt* invariant: Eine plausibel strukturierte Zahlenreihe erfüllt jede
  Formkriterium-Prüfung, egal ob sie ATB-Werte oder Fensterkoordinaten
  enthält. Reine Strukturkriterien dürfen deshalb nie allein entscheiden.

### 5. Der Nullwert-Fallstrick

Unverändert Pflicht: Nullbereiche sind trivial strukturkonform, trivial
monoton und trivial überlappungsfrei. PE-Dateien enthalten **große**
genullte Ausrichtungsbereiche — hier ist der Fallstrick größer als bei jedem
bisherigen Format. Jede Quote wird ohne die Nullfälle zweitgerechnet, und die
Zahl der ausgeschlossenen Fälle steht im Bericht.

### 6. Versionsrobustheit — hier ausnahmsweise sofort messbar

Ein Lokator, der nur in genau einem Build trifft, ist ein fest verdrahteter
Versatz mit Extraschritten.

Dieses Kriterium ist **kein Zukunftsversprechen**: Die vorliegende
Installation enthält nachgeprüft **drei** Spiel-Programmdateien
unterschiedlicher Größe und aus drei verschiedenen Jahren, davon **zwei, die
sich in der Sprache unterscheiden**. Damit gilt:

- **Jeder Lokator wird gegen alle drei geprüft.** Trifft er nur in einem,
  ist er kein Lokator, sondern ein Versatz — und wird verworfen.
- **Der Sprachunterschied ist ein Geschenk.** Namenstabellen sind genau die
  Tabellen, die sich zwischen Sprachbuilds *ändern müssen*. Ein Lokator für
  Item-Namen, der in beiden Sprachbuilds dieselbe Region findet, **aber
  unterschiedliche Zeichenketten liefert**, ist damit doppelt belegt: Die
  Struktur ist stabil, der Inhalt sprachabhängig. Ein Lokator, der in beiden
  dasselbe liefert, hat die Tabelle nicht gefunden.
- **Die Gegenprobe hat eine passende Quelle.** Die deutschen Namen müssen sich
  mit den deutschen Kernel-Zeichenketten aus S13 decken, die englischen mit
  den englischen. Das ist eine externe Prüfmenge je Sprache.

Die Formatlage-Markierung für Signaturstabilität ist deshalb 🟡 „prüfbar",
nicht 🟡 „unprüfbar" — der Unterschied entscheidet, ob dieses Kriterium in der
Session abgehakt werden kann oder vertagt werden muss.

---

## Fehlerklassen

| Klasse | Auslöser | Verhalten |
|---|---|---|
| `E-EXE-FINGERPRINT` | Build nicht in der Release-Matrix | „best effort", erhöhte Diagnostik, keine Extraktion ohne bestandene Kreuzvalidierung |
| `W-EXE-TABLE-MISS` | Lokator findet die Tabelle nicht | 🔵-Rückfallwert, Engine läuft, Diagnose nennt die Tabelle |
| `E-EXE-INVARIANT` | Tabelle gefunden, Kreuzvalidierung oder Accounting scheitert | Behandelt wie „nicht gefunden" — **niemals** teilweise übernehmen |
| `W-EXE-AMBIGUOUS` | Signatur trifft mehrfach | Kein Fund; Mehrdeutigkeit wird berichtet, nie „ungefähr" aufgelöst |

Die Regel hinter `E-EXE-INVARIANT` ist die wichtigste des Bogens: **Ein
halb bestandener Test ist ein nicht bestandener Test.** Eine Tabelle, deren
Namen zu 80 % zu `music_ogg` passen, ist nicht „fast richtig" — sie ist
falsch ausgerichtet, und die 80 % sind der Beweis dafür, nicht dagegen.

---

## Einordnung

| Bezug | Wirkung |
|---|---|
| **O2** (Musikindex) | Wird hier geschlossen — Zielmenge ist belegt, es fehlt nur die Zuordnung |
| **S17-Restposten** (`outcome`) | Wird hier adressiert (Posten 8) |
| **S28/S29** (Weltkarte) | Fahrzeug-/Geländematrix könnte hier statt als 🔵-Erfindung entstehen |
| **S31** (ATB, Formeln) | Bekommt belegte Konstanten und wird dadurch überhaupt erst falsifizierbar |
| **S34/S35** (Minigames) | Geringster erwarteter Ertrag, ehrlich als solcher geführt |
| **S27-S36 Zusatzregel 3** | Wird durch diesen Bogen **teilweise widerlegt**: „liegt in der EXE" heißt nicht automatisch „nicht zugänglich" |
| **S27-S36 Zusatzregel 4** | Bleibt in Kraft, präzisiert um die Grenze Codeanalyse ↔ Datenextraktion |

**Empfohlene Lage:** vorziehbar, unabhängig von S27–S36, frühestens nach S20
(Fingerprint-Verfahren) und sinnvollerweise **vor** S30, damit das
Kampfsystem nicht auf geratenen Konstanten aufsetzt.

---

*Rückverweis: [ROADMAP-S27-S36.md](ROADMAP-S27-S36.md) ·
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) ·
[ROADMAP-OFFENE-POSTEN.md](ROADMAP-OFFENE-POSTEN.md) ·
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) ·
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md)*
