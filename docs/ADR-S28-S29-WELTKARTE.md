# ADR-025 — Weltkarte als eigenes Runtime-Modul (S28/S29)

**Status:** Akzeptiert (2026-08-10). **Kontext:** ROADMAP-S27-S36, S28+S29;
Messgrundlage `tools/realdata-scan/FINDINGS.md` Abschnitte S28/S29.

## Entscheidung

1. **Eigenes Modulpaar statt Field-Erweiterung.** `packages/formats-world`
   (Terrain + `.ev`) und `packages/world-runtime` (VM + Fixed-Tick-Sitzung)
   sind vom Field-Pfad getrennt. Grundlage ist kein Geschmack, sondern eine
   Messung: Die Field-Bytegrammatik schließt die World-Funktionen nur zu
   6–44 % (gegen 99,73 % auf flevel) — der World-Bytecode ist eine **eigene
   u16-Stack-Grammatik** (Funktions-Abschluss 175/175, Sprungbeweis 732/732).
2. **ADR-009 unverletzt.** `render-world` erzeugt jede Szenenkoordinate über
   `ff7ToScene`; Weltvertex (x, h, z) geht als `[x, z, h]` hinein. Es gibt
   keine weltkartenlokale Flip-Stelle (Test vergleicht gegen die
   Referenzabbildung).
3. **Eigene Streaming-/Generationsachse.** `WorldStreamer` hält die
   Chebyshev-Nachbarschaft resident, wickelt am Kartenrand (die Karte
   wiederholt sich) und nummeriert Generationen — die Schale verwirft
   verspätete Ladungen alter Generationen (S3-Muster).
4. **ADR-006 neu belegt.** `WorldSession`: ganzzahliger Kurs (256er-Einheiten),
   Richtungsvektoren aus einer 1/4096-gerundeten Tabelle (`Math.cos` ist
   nicht bitfestgelegt — dieselbe R9-Härtung wie `richtungGrad`), PRNG als
   Snapshot-Bestandteil, Wirkungen als `WorldHostRequest`-Daten,
   Digest-Replay mit Gegenprobe (verschobener Strom ⇒ anderer Digest).
5. **Fahrzeugmatrix als austauschbare Tabelle (🔵).** Die Geländeklassen-
   Semantik des Originals ist unbelegt; die Session prüft ausschließlich die
   ZIELklasse gegen die Matrix des aktiven Fahrzeugs (Ein-/Ausstieg =
   Grenzübertritt). Realdaten-Abnahme: verdrehte Matrix ⇒ Erreichbarkeit 0
   von Landstart; ohne Matrix 142 586/142 586 — die Messanlage ist nicht
   blind. Wasserkandidat = Klasse 3 (🟡, datengetrieben).
6. **VM-Politik: Fault statt Raten.** Nur die belegte Opcode-Teilmenge ist
   scharf (Push-Familie, Sprünge, Stack-Grundrechnung per Fixture-Sollverlauf
   🟡, Write, Reset, Return); Kommando-Opcodes (0x300er, 23,6 % der realen
   Instruktionen) faulten und werden übersprungen. 143/143 wm0-Funktionen
   enden regulär unter dieser Politik.
7. **Übergänge als Daten.** `world-transition` trägt den 0-basierten
   maplist-Index — derselbe Namensraum wie der Field-Wechsel (S11). Die
   Ortsmarken selbst sind Wirtsdaten; die Originalquelle der Einstiegspunkte
   ist 🔴 offen. Begegnungen bleiben Stub (ADR-011): Mechanik vorbereitet
   (Schrittzähler, Seed-PRNG, Requests), Standard AUS.

## Zwei realdaten-korrigierte Community-Beschreibungen

- Call-Tabelle: fix 0x400 B — die dynamische Lesung (Sentinel als Ende) legte
  den Bezugsrahmen falsch und drückte JEDE Sprungmessung auf Kontrollniveau.
- Mesh-Kennung: (id>>4)&0x3FF = **zeile·36 + spalte** (49/49) — nicht
  „x = div 36" (46/49).

## Bewusst offen (🔴, mit Ziel-Session)

- Semantik der Kommando-Opcodes und der Anlass der Mesh-Funktionsausführung
  (Interpreter-Ausbau, Folge-Session; Verfahren: Operanden-/Stacktiefen-
  Statistik je Opcode + Sichtprüfung am Original).
- Alternativblock-Schaltung WM0 63–68; Original-Einstiegspunkte World↔Field;
  Begegnungstabellen (an S33 gekoppelt).
- WM3-Rasteranordnung (Messung blind — 12 Unikate auf 64 Meshes).
