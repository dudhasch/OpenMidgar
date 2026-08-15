# ADR-028 — Eigene Codeanalyse der PC-EXE freigegeben, ohne Auflagen

**Status:** Akzeptiert
**Entscheidungsdatum:** 2026-08-15
**Entscheider:** Projektinhaber
**Ergänzt:** [ADR-027](ADR-027-DECOMP-REFERENZ.md)
**Hebt auf:** ROADMAP-S27-S36 Zusatzregel 4 („Kein Disassemblieren der
Original-EXE") in der Fassung von
[ROADMAP-S37-EXE-ANALYSE.md](ROADMAP-S37-EXE-ANALYSE.md)

---

## Kontext

ADR-027 hat dekompilierte **Fremdquellen** als Referenz freigegeben und den
Begriff „Clean-Room" aufgegeben. S37 hat Zusatzregel 4 anschließend
präzisiert statt aufgeweicht: **Datenextraktion** (statisch abgelegte Tabellen
aus der Datei lesen) wurde zulässig, **Codeanalyse** (Instruktionen lesen,
Kontrollfluss rekonstruieren, aus Maschinencode einen Algorithmus ableiten)
blieb ausdrücklich verboten.

Seit 2026-08-15 liegt ein Bestand vor, den beide Regelungen nicht erfassen:
eine **eigene** Ghidra-Analyse von `ff7_en.exe`, ergänzt um Speicherlesungen am
laufenden Spiel. Er fällt nicht unter ADR-027, das konkrete Fremdrepositorien
benennt, und nicht unter S37, das ihn als Codeanalyse ausschließt.

Zwei Unterschiede zu ADR-027 zählen für die Abwägung:

1. **Herkunft.** Auflage A1 in ADR-027 folgt aus fehlender Lizenzgewährung
   Dritter — `ff7-decomp`, `ff7-coaster`, `touphScript` und die übrigen stehen
   ohne Lizenz, also besteht kein Nutzungsrecht an ihrem Quelltext. Diese
   Begründung trägt hier nicht: Der Bestand ist erstbeteiligt erhoben, an einer
   legal erworbenen eigenen Kopie. Es gibt keinen Dritten, dessen Rechte am
   *Text* zu beachten wären. Es bleibt allein die Frage des abgeleiteten Werks
   am Original.
2. **Plattform.** Der Plattformvorbehalt A3 entfällt. Der Bestand beschreibt
   genau die PC-Fassung, die das Projekt ohnehin liest, statt der PSX-Fassung,
   für die ADR-027 einen Vorbehalt brauchte.

## Was der Bestand ist — geprüft, nicht übernommen

Nachgezählt am 2026-08-15 unter
`C:\ff7-daten-kopie\FINAL FANTASY VII\decomp\` (nicht im Repository, s.
[quellen/ff7-exe-eigenanalyse.md](quellen/ff7-exe-eigenanalyse.md)):

| | |
|---|---|
| Umfang | **97 Markdown-Dateien, 8,62 MB** |
| `spec\` | 21 Dateien, davon **16 Spezifikationen** — 13 aus Runde 7 (bauzeitgeprüft) plus 3 Livedokumente aus Runde 8 |
| `pseudocode\` | **74** Subsystemanalysen (das eigene README sagt 76 — auf der Platte sind es 74) |
| Karten | `findings.md` 496.689 B, `function-index.md` 336.797 B |
| Ghidra-Datenbank | `ff7_en_annotated_v8.gzf`, 32.921.967 B, 10.791 Funktionen, 4.884 benannt (45,3 %) |
| Bezugsbinär | `ff7_en.exe`, 6.421.856 B, DotEmu-/Square-Enix-Neuveröffentlichung 2012 |

Der Bestand dokumentiert seine eigene Fehlerquote, und sie ist nicht klein:
Die Bauproben der Runde 7 fanden **131 Defekte in den Spezifikationen selbst**,
darunter vier falsche Testvektoren. Sein eigenes README formuliert die Regel
so: Was aus gelieferten Bytes abgeleitet ist, reproduziert nahezu perfekt; was
als Fließtext statt als Code geschrieben ist, war etwa zur Hälfte falsch. In
vier Fällen widersprechen sich die Spalten `Claimed` und `Measured`, und die
Bauprobe behält recht.

Diese Selbstauskunft ist der Grund, warum die Beweisklassenordnung des Projekts
unten ausdrücklich **nicht** zur Disposition steht.

## Entscheidung

Der Bestand ist **vollständig freigegeben, ohne Auflagen**. Beide Ebenen —
`spec\` und `pseudocode\` — dürfen gelesen und verwertet werden.

**Zusatzregel 4 ist damit aufgehoben.** Nicht abgeschwächt, nicht präzisiert:
Eine Regel, die verbietet, worauf das Projekt aufbaut, ist keine Regel, sondern
eine Falschaussage über das Projekt. Dasselbe Argument hat ADR-027 gegen den
Begriff „Clean-Room" geführt, und es gilt hier unverändert.

Die Abgrenzung Codeanalyse ↔ Datenextraktion aus S37 bleibt als **Beschreibung**
nützlich — sie trennt zwei technisch verschiedene Vorgänge — hat aber keine
regelnde Wirkung mehr.

## Was damit aufgegeben wurde

Ehrlichkeit an dieser Stelle ist der einzige Zweck eines
Entscheidungsdokuments. ADR-027 hat vier Auflagen getragen; keine davon gilt
noch. Was jede einzelne abgesichert hat:

| | Was sie verhinderte | Was ihr Wegfall bedeutet |
|---|---|---|
| **A1** Keine Textübernahme | zeilenweise Übersetzung von dekompiliertem C nach TypeScript | Zulässig. **Dies ist die einzige der vier Auflagen mit einem Dritten dahinter.** Sie war der Schritt, der aus „nachgebaut" ein abgeleitetes Werk am Original macht |
| **A2** Herkunftspflicht | Aussagen ohne Quellvermerk, 🟢 ohne Gegenprobe | Nicht mehr erzwungen. Der Quellvermerk bleibt trotzdem gute Praxis — er ist der Beleg, dass reimplementiert und nicht übersetzt wurde |
| **A3** Plattformvorbehalt | PSX-Befunde als PC-Belege | Gegenstandslos: PC-Fassung |
| **A4** Messvorrang | abgeschriebene statt gemessene Tabellen | Nicht mehr erzwungen. Gemessen wird weiter, wo gemessen werden kann — aus Qualitätsgründen, nicht aus Regelgründen |

**Die Rechtsposition wird ein zweites Mal schwächer, und diesmal ist die
Analyse dem Projekt selbst zurechenbar.** ADR-027 hatte sie von „strukturell
verteidigt" auf „hängt an A1 und der Nachweisbarkeit über A2" gestellt. Beide
Anker fallen jetzt weg. Das ist die bewusst getroffene Entscheidung des
Projektinhabers an seinem eigenen Bestand und in seinem eigenen Repository.

## Was von dieser Entscheidung unberührt bleibt

Diese drei Punkte sind **keine** Auflagen dieses ADR. Sie stehen anderswo und
gelten unabhängig davon, was hier entschieden wurde:

1. **Die Beweisklassenordnung.** 🟢 verlangt weiterhin eine Gütefunktion **und**
   ein Kontrollniveau. Eine Aussage aus dem Bestand ist eine Hypothese, bis eine
   Gegenprobe an unseren Daten sie trägt — nicht weil eine Auflage es fordert,
   sondern weil eine Ein-Stichproben-Messung kein Formatfakt ist und der Bestand
   seine eigene Fehlerquote mit 131 Defekten beziffert. Aussagen, die dort als
   **[1-SAMPLE]** oder als unbestätigtes Agentenergebnis gekennzeichnet sind,
   werden nie 🟢. Das ist Arithmetik, keine Regel.
2. **„Fundstelle statt Fundstück"** (S37). Das Repository enthält weiterhin
   **niemals** extrahierte Werte aus Originaldateien, nur Lokatoren. Diese Regel
   betrifft eine andere Frage als dieser ADR — Verhalten der Engine ist keine
   Kopie von Spielinhalt, eine Minigame-Kurstabelle schon.
3. **Das BYO-Data-Modell.** Originaldaten, Originaldialoge und Bytecode-Dumps
   werden nicht eingebettet und nicht verteilt. Der Bestand selbst wird **nicht**
   in diesen Baum eingecheckt: Er ist Dokumentation über ein geschütztes
   Binärprogramm, und `pseudocode\` enthält dekompiliertes C.

## Konsequenzen

- **Dokumentation:** `docs/fremdquellen/` heißt künftig `docs/quellen/` und
  `FREMDQUELLEN-SICHTUNG.md` heißt `QUELLEN-SICHTUNG.md` — der Bestand ist
  keine Fremdquelle, und ein Register, das eigene Erhebung unter „fremd" führt,
  benennt seinen Inhalt falsch. Neuer Eintrag:
  [quellen/ff7-exe-eigenanalyse.md](quellen/ff7-exe-eigenanalyse.md).
- **Erwarteter Nutzen** — die Posten, für die die Freigabe geholt wurde:
  Zahlengleiche Schadensformeln und ATB-Timing (in `PROJEKTSTAND.html` als
  *offen · versperrt* geführt, mit genau dieser Regel als Blocker),
  Statusnumerierung (bisher Community-Stand), Stat-Ableitungskette nach
  Ausrüstungswechsel, die vier Zufallsgeneratoren, `camdat` (K11),
  `da`/`ab`-Animationen (K9), Minigame-Physik S34/S35.
- **Arbeitsweise:** Wie bei ADR-027 beginnt ein Referenzlauf mit einem
  Scouting-Schritt — hier: `spec/README.md` lesen und **`Measured`, nicht
  `Claimed`** glauben, danach `spec/index-by-package.md`, dessen zweite Hälfte je
  Dokument den Zuverlässigkeitsvorbehalt nennt. Ein `grep` liefert diesen
  Vorbehalt nie mit.
- **Ein Posten braucht diesen ADR nicht.** Die Locale-Auflösung
  (`data/lang-en/` vor `data/`) ist an der Installation des Nutzers messbar und
  wurde unabhängig nachgemessen: Sektion 2 der `kernel.bin` unterscheidet sich
  zwischen beiden Zweigen in genau 28 Byte, alle im scene.bin-Blockindex bei
  `+0x0F1C`, mit byteexaktem Accounting gegen beide `scene.bin`-Dateien. Dafür
  wurde nie eine Instruktion gelesen.

## Wann die Entscheidung neu zu treffen ist

1. Es geht ein **Rechtehinweis** ein. Dann fehlen die Anker, die ADR-027 noch
   hatte — der Vorgang ist dann zusammen mit diesem ADR neu zu bewerten, und die
   Wiedereinführung einer A1-artigen Auflage ist der naheliegende erste Schritt.
2. Es zeigt sich über zwei Wellen, dass der Bestand **keine** Posten schließt,
   die nicht auch messbar gewesen wären. Dann ist die Position ohne Gegenwert
   aufgegeben und die Freigabe zurückzunehmen.
3. Die dokumentierte **Fehlerquote** erweist sich als höher als angegeben. Dann
   ist der Bestand als Hypothesengenerator unbrauchbar, und die Freigabe hat
   keinen Zweck mehr.

---

*Rückverweis: [ADR-027](ADR-027-DECOMP-REFERENZ.md) ·
[ROADMAP-S37-EXE-ANALYSE.md](ROADMAP-S37-EXE-ANALYSE.md) ·
[QUELLEN-SICHTUNG.md](QUELLEN-SICHTUNG.md) ·
[quellen/ff7-exe-eigenanalyse.md](quellen/ff7-exe-eigenanalyse.md) ·
[PROJEKTSTAND.html](PROJEKTSTAND.html)*
