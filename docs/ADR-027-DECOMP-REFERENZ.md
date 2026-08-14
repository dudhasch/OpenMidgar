# ADR-027 — Dekompilierte Originalquellen als Referenz zugelassen

**Status:** Akzeptiert
**Entscheidungsdatum:** 2026-08-15
**Entscheider:** Projektinhaber
**Löst ab:** die Clean-Room-Klausel in [WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md)
(Kopfzeile und Phase 4) sowie die Sperrvermerke 1, 2 und 4 aus
[FREMDQUELLEN-SICHTUNG.md](FREMDQUELLEN-SICHTUNG.md)

---

## Kontext

Bis heute galt: Ausführungssemantik wird „aus öffentlicher Dokumentation und
Verhaltensbeobachtung abgeleitet, **nie** aus Original-Disassembly des
Engine-Codes" (Masterplan, Phase 4). Daraus folgten drei Sperrvermerke gegen
dekompilierte Quellen (`ff7-coaster` samt Nachbarrepos, die Hex-Rays-Passage in
Makou Reactor, `Elena/LzsCompression.cs`).

Diese Regel hat ihren Zweck erfüllt, solange die offenen Fragen **messbar**
waren: Formatgrammatiken lassen sich aus 702 Fields, 45.563 LGP-Einträgen oder
1360 Weltmeshes mit Kontrollhypothese herleiten — und die bisherige Arbeit
zeigt, dass das belastbarer ist als jede übernommene Tabelle (O9: pauschal
übernommene Referenzlängen hätten den Spannen-Abschluss von 99,92 % auf
86,77 % gedrückt).

Der verbliebene Rest ist anders geartet. `camdat`, das Stage-Format, die
Kampf-Kamera und der Formelsatz für Schaden/ATB/Trefferwahrscheinlichkeit sind
**Verhalten der Engine**, nicht Struktur der Daten. Sie stehen nirgends im
Bestand, gegen den man messen könnte. Ihre 🔵-Ersatzmodelle sind gesetzt, nicht
belegt, und werden es durch weitere Messkampagnen auch nicht.

Hinzu kommt ein sachlicher Befund: `camdat` trägt PSX-Zeiger, und der
`battle.lgp`-Namensraum folgt PSX-Konventionen. Der PC-Build von 1998 ist eine
Portierung mit PSX-Erblasten — für genau diese Posten ist eine PSX-Dekompilierung
nicht ein Umweg, sondern die nächstgelegene Quelle.

## Entscheidung

Dekompilierte Originalquellen dürfen als **Referenz gelesen** werden. Konkret
freigegeben: [Xeeynamo/ff7-decomp](https://github.com/Xeeynamo/ff7-decomp)
(matching decomp der PSX-Fassung, Stand 2026-08: 15,78 %), `ff7-coaster` und
seine Nachbarrepos, die Hex-Rays-Passage in Makou Reactor, `Elena`.

Der Begriff **„Clean-Room" wird im Projekt nicht mehr geführt.** Die
Selbstbeschreibung lautet künftig: Reimplementierung aus dokumentierten und
rekonstruierten Formatfakten; Originaldaten werden weder eingebettet noch
verteilt.

## Auflagen

Die Freigabe gilt nur zusammen mit diesen vier Auflagen. Sie sind Teil der
Entscheidung, nicht Empfehlung.

**A1 — Keine Textübernahme.** `ff7-decomp` steht **ohne Lizenz** (GitHub-API:
`license: null`); dasselbe gilt für `ff7-coaster`, `touphScript`,
`ff7-landscaper`, `kujata` und `Workers`. Ohne Lizenzgewährung existiert kein
Nutzungsrecht am Quelltext — unabhängig von der aufgegebenen
Clean-Room-Position. Übernommen werden **Tatsachen über das Verhalten des
Originals** (Formeln, Konstanten, Reihenfolgen, Feldbedeutungen), nie
Quelltext, Kommentare, Bezeichnerlisten oder Dateistruktur. Das gilt auch für
maschinelle Übersetzung von C nach TypeScript: eine zeilenweise Transkription
ist eine Übernahme.

**A2 — Herkunftspflicht.** Jede so gewonnene Aussage trägt am Ort ihrer
Verwendung einen Quellvermerk (Repo, Commit-Kurz-Hash, Datei bzw. Funktion) und
die Klasse 🟡 `Zu validieren`. **Erst eine bestandene Gegenprobe an unseren
Daten hebt sie auf 🟢** — die Referenz ersetzt die Kontrollhypothese nicht, sie
liefert nur die Hypothese.

**A3 — Plattformvorbehalt.** `ff7-decomp` beschreibt die **PSX**-Fassung. Für
Fragen des PC-Builds ist sie kein Beleg, sondern eine Spur. Ohne Gegenmessung
gegen den PC-Bestand darf daraus keine 🟢-Aussage werden. Das gilt ausdrücklich
auch für die PSX-Erblasten (`camdat`, Battle-Container): dass die Struktur
übernommen wurde, ist selbst eine zu prüfende Behauptung.

**A4 — Messvorrang bleibt.** Wo eine Messung am Nutzerbestand möglich ist, wird
gemessen. Die Referenz dient (a) Posten, die im Bestand nicht abgebildet sind,
(b) als Gegenhypothese in einer laufenden Messung, (c) zur Erklärung eines
bereits gemessenen Befunds. Sie ist **kein** Ersatz für eine Messung, die
lediglich aufwendig wäre. Regel 3 („keine geratene Tabelle") gilt unverändert —
eine abgeschriebene Tabelle ohne Gegenprobe ist derselbe Verstoß wie eine
geratene.

## Was ausdrücklich **nicht** freigegeben ist

Die übrigen Sperrvermerke bleiben, weil sie einen anderen Grund haben als die
Clean-Room-Position:

- **Aeris** und **kujata-data** enthalten echte Spieldateien. Nie in den Baum.
- **ff7tk** führt Sonys PSV/VMP-Signierschlüssel mit. Nie in den Baum.
- Originaldaten, Originaldialoge und Bytecode-Dumps werden weiterhin **nicht**
  eingebettet und nicht verteilt. Der Rechtsrahmen des Datenzugriffs (lokale,
  legal erworbene Installation des Nutzers) ist von diesem ADR unberührt.

## Konsequenzen

- **Dokumentation:** README-Kopf, Masterplan-Kopf und Masterplan Phase 4
  verlieren die Clean-Room-Aussage; `FREMDQUELLEN-SICHTUNG.md` verliert die
  Sperrvermerke 1, 2 und 4 und verweist stattdessen hierher. Das ist kein
  Schönheitsfehler: Eine öffentlich behauptete Arbeitsweise, die nicht mehr
  praktiziert wird, ist eine Falschaussage über das Projekt. Mitgeändert:
  `apps/demo/beta.html` (nutzerseitiger Text). **Nicht** geändert:
  `docs/feasibility/*` — datierte Studien von vor dieser Entscheidung, deren
  Wortlaut als historischer Stand erhalten bleibt; dort meint „Clean-Room"
  zudem überwiegend das BYO-Data-Modell, das unverändert gilt.
- **Rechtsposition:** Sie wird schwächer als vorher. Vorher war das Projekt
  gegen den Vorwurf abgeleiteter Werke strukturell verteidigt; jetzt hängt die
  Verteidigung an A1 (keine Textübernahme) und an der Nachweisbarkeit über A2.
  Deshalb ist die Herkunftspflicht bindend und nicht optional — sie ist der
  Beleg, dass reimplementiert und nicht kopiert wurde.
- **Erwarteter Nutzen** (die Posten, für die die Freigabe geholt wurde):
  `camdat`/Gameplay-Kamera 🔴, Stage-Format 🔴, Battle-Animationen `ab` 🔴,
  Formelsatz Schaden/ATB/Treffer 🔵 → belegbar, Encounter-Schrittmodell 🔵,
  Menü-Ablauflogik (F24-Aufteilung 🔴).
- **Arbeitsweise:** Ein Referenzlauf beginnt mit einem Scouting-Schritt
  („welche Units sind überhaupt gematcht?"), weil 15,78 % Gesamtfortschritt
  bedeuten, dass die Antwort für einen konkreten Posten schlicht fehlen kann.
  Ein Fehlschlag ist dann ein Negativbefund über die Quelle, kein Befund über
  das Spiel.

## Wann die Entscheidung neu zu treffen ist

1. `ff7-decomp` (oder eine andere freigegebene Quelle) erhält eine Lizenz —
   dann ist A1 neu zu bewerten, ggf. wird Codeübernahme unter deren Bedingungen
   möglich.
2. Es geht ein Rechtehinweis ein — dann gilt A1/A2 als Nachweisgrundlage, und
   der ADR wird mit dem Vorgang zusammen neu bewertet.
3. Es zeigt sich über zwei Wellen, dass die Referenz keine Posten schließt, die
   nicht auch messbar gewesen wären — dann ist die Rechtsposition ohne
   Gegenwert aufgegeben und die Freigabe zurückzunehmen.
