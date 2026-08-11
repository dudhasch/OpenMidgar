# Recherche: Vgr255/Workers

Quelle: https://github.com/Vgr255/Workers
Klon: `…/scratchpad/repos/Workers`
Erfasst: 2026-08-10

## 1. Was das Repo ist

Ein winziges Community-Modding-Tool aus dem Qhimm-Umfeld: ein **GUI-Editor (Python 3 / tkinter) für die
Datei `PEOPLE.BIN` von Final Fantasy VII**. Repo-Beschreibung auf GitHub: "Tool to edit FF7's PEOPLE.BIN".

Bestand (vollstaendig gelesen):

- `README.md` — 3 Zeilen, "Workers tool v0.3", Work-in-Progress-Hinweis.
- `workers.py` — 323 Zeilen, einziges Codefile, `__version__ = "0.4"` (README hinkt hinterher).
- `.gitignore` — ignoriert `*.py[cd]` und `config.py`.

Git-Metadaten:

- **Genau ein Commit**: `f80c1e8` "Fix mulltiple files overlapping", Vgr E. Barry <vgr255@live.ca>,
  2015-12-17. Die drei Dateien wurden in diesem einen Commit angelegt (Historie wurde offenbar plattgemacht).
- Nur Branch `master`, **keine weiteren Branches, keine Tags**.
- GitHub-API: created 2015-10-18, letzter Push 2015-12-17, 4 Stars, 0 Forks, keine Topics,
  keine Releases. **Wiki ist aktiviert, aber leer** (Startseite bietet nur "Create the first page" an).
- Seit Ende 2015 tot.

Im About-Dialog steht: Tool von "Vgr", **"Format research by IlDucci"** (IlDucci = spanischer
Fan-Uebersetzer, Traducciones XT). Das Repo enthaelt selbst **keine** Formatdokumentation — das
Format ist nur implizit aus dem Parser ableitbar.

## 2. LIZENZ — WICHTIG

**Keine Lizenzdatei, kein Lizenzhinweis, GitHub-API meldet `"license": null`.**
=> **Alle Rechte vorbehalten.** Kein Code, keine Tabellen und keine Datenstrukturen aus `workers.py`
duerfen nach `C:\ff7-web` kopiert werden. Die unten notierten Fakten sind reine
Interoperabilitaets-/Dateiformatbeobachtungen (Beschreibung, kein Abschreiben) und wurden bewusst als
Prosa/Tabelle statt als Codeauszug festgehalten.

## 3. Bezug zu Final Fantasy VII

Ja, der Bezug ist echt und direkt — aber sehr eng: es geht ausschliesslich um **eine einzige
Textdatei**, `PEOPLE.BIN`. Nach Community-Kenntnis ist das die Datei mit den **Namenszeilen fuer den
Abspann/Staff-Roll** ("people" = die Leute, die am Spiel gearbeitet haben; daher der Tool-Name
"Workers"). Der Editor bestaetigt das Nutzungsbild: eine flache Liste kurzer, grossgeschriebener
Textzeilen mit Font-Attributen, ohne jeden Spiel-/Logikbezug (keine NPCs, keine Feld-Daten,
kein Skript). Eine unabhaengige, zitierfaehige Formatdoku (Qhimm-Wiki o.ae.) konnte ich nicht finden;
die Zuordnung "Abspann" ist damit **plausibel, aber nicht hart belegt**.

## 4. Extrahierte Formatfakten (aus dem Parser abgeleitet)

### Container

- Datei ist ein **Array gleich grosser Records ohne Header**. Die Dateilaenge muss ein **Vielfaches
  von 64 Byte** sein; das Tool bricht sonst mit Fehler ab. Recordanzahl = Dateigroesse / 64.
- Records werden beim Speichern einfach hintereinander geschrieben — kein Index, kein Count-Feld.

### Recordlayout (64 Byte)

| Offset | Laenge | Bedeutung laut Tool |
|--------|--------|---------------------|
| 0x00   | 4      | "Font Type", uint32 **little endian**, im UI frei editierbar |
| 0x04   | 4      | "Font Color", uint32 **little endian**, im UI frei editierbar |
| 0x08   | 4      | unbekannt — wird gelesen und unveraendert zurueckgeschrieben |
| 0x0C   | 48     | Textfeld (siehe unten) |
| 0x3C   | 4      | unbekannt — bei neu angelegten Records auf 0x28 (=40) LE vorbelegt |

Die Bezeichnungen "Font Type"/"Font Color" sind die Labels des Tool-Autors, **nicht verifiziert**.
Das 0x28 als Default fuer 0x3C riecht nach einer Positions-/Breiten-/Timing-Groesse — unbelegt.

### Textfeld (0x0C..0x3B, 48 Byte)

- **Eigene Zeichentabelle, nicht ASCII und nicht die uebliche FF7-Textkodierung.**
- Terminator: **0x7F**. Alles ab dem Terminator wird ignoriert; beim Schreiben wird mit 0x00
  aufgefuellt (0x00 ist selbst ein gueltiges Zeichen, deshalb ist der Terminator zwingend).
- Nutzlaenge damit **< 48 Zeichen** inkl. Terminator; das Tool lehnt laengere Eingaben ab.
- Nur Grossbuchstaben — das Tool ruft vor dem Schreiben `upper()` auf.

Belegung der Tabelle (Byte -> Zeichen), aus dem Parser gelesen:

- 0x00–0x19: `A`–`Z` fortlaufend (also 0x00=A, 0x19=Z)
- 0x1A = `1`, 0x1B = `2`, 0x26 = `3` (Ziffern sind unvollstaendig und verstreut — offenbar reichten
  dem Abspann die Ziffern 1–3, z.B. fuer "PART 1/2/3"-artige Zeilen)
- 0x1C = `:`, 0x1D = `,`, 0x1E = `.`, 0x1F = `&`
- 0x20 = `(`, 0x21 = `)`, 0x22 = `'`, 0x23/0x24 = typografische Anfuehrungszeichen auf/zu
- 0x25 = `-`, 0x27 = `Å`
- 0x2F = **Leerzeichen**
- 0x30 = **Zeilenumbruch innerhalb eines Records**
- 0x28–0x2E: **sprachabhaengige Akzentzeichen** (siehe unten)

Sprachvarianten des Blocks 0x28–0x2E — dieselben sieben Bytes, zwei Belegungen:

- Spanisch: `Á Í Ó Ñ É È Ú`
- Englisch/Franzoesisch/Deutsch (im Tool zu einer Gruppe zusammengefasst): `Á Ä Ó Ö É È Ü`

Das ist der interessanteste Einzelbefund: **`PEOPLE.BIN` ist nicht selbstbeschreibend** — ein Decoder
muss die Sprache der Installation kennen, sonst werden 0x28–0x2E falsch dargestellt. Das Tool loest
das ueber ein Menue "Special Characters" plus einen persistierten `LANGUAGE`-Wert in einer
`config.py`.

Auffaellig: es gibt **kein Kleinbuchstaben-, kein Ziffern-0/4-9- und kein `!`/`?`-Mapping**. Die
Tabelle ist damit eine sehr magere, zweckgebundene Abspann-Font — konsistent mit der Annahme
Staff-Roll.

### Sonstiges Verhalten

- Das Tool liest die Datei komplett, haelt Records als 5-Tupel im Speicher, kann Records anhaengen und
  loeschen, und schreibt beim Speichern alles neu — es gibt also **keine Fixgroesse und keine
  Offsettabelle**, die beim Einfuegen nachgezogen werden muesste. Records sind frei umsortier-/
  einfuegbar. Das ist ein starker Hinweis, dass der Konsument die Datei rein sequentiell abspielt.
- Ein neu angelegter Record startet mit leerem Text (nur Terminator), Font Type = 0, Font Color = 0.

## 5. Was NICHT drin ist

- Keine LGP-/Archivbehandlung, keine Angabe, **wo** `PEOPLE.BIN` im Spielverzeichnis liegt bzw. in
  welchem LGP sie steckt.
- Keine Semantik fuer "Font Type"/"Font Color" (keine Enum-, keine Palettenwerte).
- Keine Aussage zur Deutung von 0x08 und 0x3C.
- Keine Renderinformationen (Scrollgeschwindigkeit, Layout, Timing).
- Keine Tests, keine Beispieldateien, keine Fixtures.

## 6. Verdikt fuer WebMidgar

**Relevanz: gering, aber nicht null — klar abgegrenzter Nischenbefund.**

- Das Repo beruehrt **keinen** der bisherigen WebMidgar-Baustellen (Field, Background, Battle, Kernel,
  World, audio.dat). Eine Volltextsuche nach "PEOPLE" in `C:\ff7-web` liefert **null Treffer** — das
  Format ist im Projekt bisher nirgends erwaehnt.
- Nutzen entsteht **erst, wenn WebMidgar den Abspann/Staff-Roll implementiert**. Dann sind die oben
  notierten Fakten (64-Byte-Records, Terminator 0x7F, die zwei sprachabhaengigen Tabellenvarianten)
  eine brauchbare Startvermutung und sparen eine Blind-Analyse.
- Empfehlung: **nicht als eigener Sprint fuehren.** Als Randnotiz zu einem spaeteren
  Ending-/Credits-Roadmap-Punkt ablegen. Vor jeder Umsetzung an einer echten `PEOPLE.BIN` aus einer
  Originalinstallation gegenpruefen — die Fakten hier sind aus einem 2015er Hobby-Parser abgeleitet,
  nicht aus einer verifizierten Spezifikation.
- **Clean-Room:** kein Code uebernehmen (keine Lizenz = alle Rechte vorbehalten). Falls die
  Zeichentabelle je gebraucht wird, aus einer eigenen Analyse echter Dateien rekonstruieren und diese
  Datei nur als Hinweis-/Plausibilitaetsquelle zitieren.
