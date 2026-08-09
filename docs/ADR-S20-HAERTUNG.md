# ADR-Nachtrag S20 — Härtung & Beta-Gate

Fortschreibung des ADR-Registers aus
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) (ADR-001–012) und
[MODDING-SUITE-MASTERPLAN.md](MODDING-SUITE-MASTERPLAN.md) (ADR-013–018).
Diese Session vergibt **ADR-019 bis ADR-023** und entscheidet **ADR-010**.

Zusatzregel 1 des Bogens S20–S26 lautet: *„Kein Feature-Bogen S21+ beginnt,
bevor die Härtungskriterien erfüllt oder der Verzicht auf ein Kriterium per
ADR dokumentiert ist (inkl. Nummer des bewussten Restrisikos)."* Jeder
Verzichts-ADR hier nennt deshalb ausdrücklich **die Bedingung, unter der er
nachgeholt wird** — kein „später" ohne Auslöser.

---

## ADR-010 — WASM für LZS und Texturkonvertierung: **Verworfen**

**Status:** Verworfen (vorher: Vorgeschlagen)
**Entscheidungsdatum:** 2026-08-10

### Entscheidung

Es wird **kein** WebAssembly-Modul für LZS-Dekompression oder
Texturkonvertierung gebaut. Beide bleiben in TypeScript.

### Lastprofil, auf dem die Entscheidung beruht

Realdatenlauf über 702 Fields
([NFR-BERICHT-S20.md](NFR-BERICHT-S20.md)):

| Größe | Wert |
|---|---|
| Gesamte Wechselarbeit | 3684,0 ms über 702 Wechsel |
| davon LZS-Dekompression | 1102,7 ms |
| davon Atlasaufbau (Texturkonvertierung) | 1823,7 ms |
| **Anteil der beiden WASM-Kandidaten** | **79,4 %** |
| Budget je warmem Field-Wechsel | 500 ms |
| Gemessener p95 | 10,12 ms — **2,0 % des Budgets** |
| Hypothetischer p95 bei optimistischen 60 % Ersparnis | 7,62 ms — 1,5 % des Budgets |

### Begründung

Die beiden Kandidaten dominieren die Arbeit tatsächlich, wie 2021 vermutet —
knapp 80 % der Rechenzeit eines Field-Wechsels. Genau das war die Bedingung im
ursprünglichen ADR-Text („nur für LZS/Texturkonvertierung"). Aber die Arbeit
selbst kostet 2 % ihres Budgets. Eine Halbierung der dominanten Anteile
verschiebt die Budgetauslastung von 2,0 % auf 1,5 %.

Dem gegenüber stehen: eine zweite Toolchain im Build, ein zweiter
Fehlerbehandlungspfad an der WASM-Grenze, ein Ladepfad mit eigenem
Fehlermodus, und — der eigentliche Preis — eine **zweite Implementierung des
LZS-Dekoders**, die mit der TypeScript-Fassung bitgenau übereinstimmen muss,
sonst wandert R9 von der Mathematik in den Dekompressor.

Das ist ein schlechtes Geschäft für 0,5 Prozentpunkte Budget.

### Wann die Entscheidung neu zu treffen ist

Diese Entscheidung ist an das gemessene Lastprofil gebunden, nicht an eine
Meinung. Sie wird neu bewertet, sobald **eine** der folgenden Bedingungen
eintritt:

1. Ein NFR-Lauf misst einen Field-Wechsel-p95 über **250 ms** (50 % des
   Budgets) auf irgendeinem unterstützten Gerät, **und** LZS + Atlas machen
   dort mehr als die Hälfte der Zeit aus.
2. Der Mobile-Referenzlauf (ADR-019) zeigt, dass das mobile Budget von
   1200 ms zu mehr als 50 % von diesen beiden Etappen verbraucht wird.
3. Der HD-Texturpfad aus S25 (KTX2-Transcodierung) verschiebt den
   Texturanteil so weit, dass Punkt 1 erfüllt ist.

### Konsequenzen

- Der Build bleibt eine einzige Toolchain.
- Der LZS-Dekoder bleibt die einzige Implementierung im Produktpfad; die
  zweite Implementierung existiert weiterhin nur als Kompressor in
  `tools/fixture-gen` und dient dort der Fehlererkennung, nicht der Leistung.
- `tools/nfr-run` misst den Kandidatenanteil bei jedem Lauf mit, damit
  Bedingung 1 nicht erst auffällt, wenn jemand danach sucht.

---

## ADR-019 — Kein Mobile-Referenzgerät: mobile NFRs bleiben ungemessen

**Status:** Akzeptiert (bewusstes Restrisiko)
**Betrifft:** Masterplan-Phase 2.4, Mobile-Spalte; Risiko **R7**

### Was fehlt

Sämtliche mobilen Zielwerte der Phase 2.4 sind ungemessen: Main-Thread-Task
≤ 12 ms, GPU-Upload ≤ 4 ms, TTFF kalt ≤ 25 s / warm ≤ 4 s, Field-Wechsel
≤ 1200 ms, Asset-Latenz ≤ 800/120 ms, Heap ≤ 128 MB, VRAM ≤ 128 MB. Ebenso
ungemessen ist der Kern von R7: **Quota- und Eviction-Verhalten** von
IndexedDB unter mobilem Speicherdruck.

### Warum hier nicht messbar

Es steht kein Mobilgerät zur Verfügung. Eine Emulation über die
Bildschirmgröße ändert das Gerät nicht: sie skaliert weder CPU-Leistung noch
Speicherdruck noch die Räumungsstrategie des Browsers. Eine daraus abgeleitete
Zahl sähe wie eine Messung aus und wäre keine — das ist schlimmer als eine
offene Lücke.

Der Masterplan sagt selbst, die mobilen Werte seien Setzungen („🟡 Mobile-
Zahlen sind Setzungen und werden nach erstem Geräteprofiling nachjustiert").
Dieser ADR ändert daran nichts, er hält den Zustand nur fest.

### Was ersatzweise gemessen wurde

Auf dem Desktop-Browser: Speicherkontingent 17.075 MB, belegt 1,08 MB,
`persisted() = false`. `navigator.storage.persist()` wurde **nicht** aufgerufen
— das wäre eine Zustandsänderung am Browserprofil des Nutzers und keine
Messung. Die Zahl sagt über das mobile Verhalten nichts aus und wird auch nicht
so verwendet.

### Restrisiko

Mittel. Der Desktop-Lauf nutzt 2 % des Field-Wechsel-Budgets; selbst ein
Faktor 20 zwischen Desktop und einem mittleren Android-Gerät bliebe innerhalb
des mobilen Budgets von 1200 ms. Die Latenzen sind damit plausibel unkritisch.
**Nicht** plausibel abschätzbar ist R7: Ob ein mobiler Browser den S2-Cache
räumt und wie oft, folgt keiner Regel, die man hochrechnen könnte. Ein
geräumter Warm-Cache degradiert das Produkt nicht, er macht jeden Start zum
Kaltstart — spürbar, aber nicht kaputt.

### Nachhol-Auslöser

Nachgeholt wird, sobald **eines** eintritt:

1. Ein Mobilgerät (Android, mittlere Leistungsklasse) steht zur Verfügung —
   dann läuft `/nfr.html` dort einmal vollständig, und das Ergebnis ersetzt
   die Setzungen der Phase 2.4 durch Messwerte.
2. Der erste Beta-Diagnosebericht einer mobilen Installation trifft ein.
3. **Spätestens vor der ersten öffentlichen Ankündigung mobiler Nutzbarkeit.**
   Bis dahin nennt die Beta-Seite Mobilgeräte ausdrücklich als ungeprüft.

---

## ADR-020 — Keine Nicht-V8-Engine geprüft: R9 nur innerhalb V8 belegt

**Status:** Akzeptiert (bewusstes Restrisiko)
**Betrifft:** Risiko **R9**

### Was fehlt

Die Replay-Digest-Gleichheit ist für **SpiderMonkey (Firefox)** und
**JavaScriptCore (Safari/WebKit)** nicht gemessen.

### Warum hier nicht messbar

Firefox ist auf der Entwicklungsmaschine nicht installiert. Safari läuft nicht
unter Windows, und es gibt keinen WebKit-Ersatz mit derselben
Math-Implementierung. Ein Digest lässt sich nicht schätzen — er stimmt oder
nicht.

### Was stattdessen gemessen wurde

Mehr als der ursprüngliche Plan verlangte, und mit einem echten Fund
([R9-CROSSBROWSER.md](R9-CROSSBROWSER.md)):

- Drei Engines geprüft: Node 22, Chromium 148, Chromium 151. Das Kriterium
  „Chromium × 2 Versionen" ist erfüllt.
- Chromium 151 wich beim Vektor `skript` ab. Ursache per Math-Fingerprint auf
  `Math.atan2` eingegrenzt: **atan2, sin, cos, log und exp unterscheiden sich
  bereits zwischen zwei V8-Ständen**, sqrt/hypot/pow nicht.
- Behoben durch Quantisierung der Richtungswinkel auf die 256
  Richtungseinheiten des Originals und durch Ersatz von `Math.hypot` durch
  `Math.sqrt(x²+y²)` in allen digestrelevanten Pfaden.
- Nach der Härtung stimmen alle drei Vektoren über alle drei Engines überein.

### Restrisiko

Gering bis mittel — und ausdrücklich **kleiner als vor der Härtung**. Der
Befund ist die eigentliche Nachricht: Wenn schon zwei V8-Stände auseinander
liefen, wäre SpiderMonkey mit hoher Wahrscheinlichkeit ebenfalls
auseinandergelaufen. Die Härtung entfernt die Ursachenklasse, nicht nur den
konkreten Fall.

Was bleibt: Der digestrelevante Pfad ruft `Math.atan2` weiterhin auf, nur vor
einer Rundung auf 256 Eimer. Eine Engine mit deutlich anderer atan2-Genauigkeit
könnte an einer Rundungsgrenze in einen anderen Eimer fallen. Größenordnung
rund 10⁻¹³ je Aufruf. Nicht null.

### Nachhol-Auslöser

1. Firefox wird auf einer Entwicklungs- oder CI-Maschine verfügbar — dann läuft
   `/r9.html` dort, und das Ergebnis kommt in die Browser-Matrix.
2. Ein Nutzer meldet abweichende Replay-Digests.
3. **Vor der Freigabe des Replay-Austauschs als öffentliches Feature** (S26,
   Punkt „Replay-Portabilität"). Bis dahin gilt: Digests sind innerhalb einer
   `engineCompat` und innerhalb geprüfter Engines vergleichbar — die Beta-Seite
   sagt das ausdrücklich.

### Fixpoint-Härtungsplan (falls eine Engine abweicht)

Wenn ein künftiger Vergleich doch abweicht, ist der Weg vorgezeichnet und
erprobt:

1. `mathProbe()` auf beiden Engines laufen lassen → betroffene Funktion.
2. Prüfen, ob ihr Ergebnis überhaupt in den Zustand muss.
3. Wenn ja: auf die Einheit des Originals quantisieren (Richtungen 1/256
   Umdrehung, Positionen auf die Auflösung des Field-Rasters).
4. Wenn das nicht reicht: den betroffenen Pfad auf Festkomma-Arithmetik
   umstellen. Alle Eingangsgrößen der Bewegung sind ganzzahlig; eine
   Festkomma-Darstellung mit 16 Nachkommabits deckt den Wertebereich ab.

---

## ADR-021 — GPU-Uploads werden gestückelt (bindende Auflage)

**Status:** Akzeptiert
**Betrifft:** Masterplan-Phase 2.4, Zeile „Frame-Budget GPU-Upload"

### Beobachtung

Gemessen im Browser mit echtem WebGL2-Kontext und `gl.finish()` (ohne
erzwungenes Fertigstellen misst man nur das Einreihen des Befehls — eine Zahl,
die immer gut aussieht):

| Upload | p50 | p95 | Budget |
|---|---|---|---|
| Ganze 2048²-Seite (`texImage2D`) | 5,1 ms | 5,4 ms | 2 ms → **verfehlt** |
| Ganze 1024²-Seite (`texImage2D`) | 1,4 ms | 2,1 ms | 2 ms → grenzwertig |
| 2048² in 8 Streifen (`texSubImage2D`) | 0,6 ms | **1,0 ms** | 2 ms → **erfüllt** |

Die Gesamtzeit je Seite bleibt gleich (rund 6 ms); sie verteilt sich nur auf
acht Frames statt eines.

### Entscheidung

Die Renderintegration lädt Atlasseiten **niemals** in einem einzelnen
`texImage2D`-Aufruf hoch. Verbindlich:

1. Speicher wird einmal mit `texImage2D(..., null)` angelegt.
2. Der Inhalt kommt in Streifen von höchstens **2048 × 256 Pixeln** je Frame
   über `texSubImage2D`.
3. Die GPU-Registry führt je Ressource mit, wie viele Streifen noch offen
   sind; eine Ressource gilt erst als vollständig, wenn keiner mehr offen ist.

### Konsequenzen

- Ein Field-Wechsel zeigt seinen Hintergrund über bis zu acht Frames (≈ 130 ms
  bei 60 Hz) aufgebaut. Das liegt weit innerhalb des 500-ms-Wechselbudgets.
- Die Auflage gilt ab der Renderer-Integration; heute lädt noch nichts
  Atlasseiten in die GPU. Sie steht hier, damit sie nicht erst beim
  Frame-Einbruch entdeckt wird.
- Der Messlauf `/nfr.html` prüft beide Varianten bei jedem Durchgang.

---

## ADR-022 — Keine Community-Beta als Fingerprint-Quelle: Registry aus einer Installation

**Status:** Akzeptiert (bewusstes Restrisiko)
**Betrifft:** Risiko **R5**

### Was fehlt

Die Roadmap sieht die R5-Matrix „über die Community-Beta mittels des
asset-freien S18-Diagnose-Exports" vor. Es gibt keine laufende Beta und damit
keine fremden Diagnoseberichte.

### Was stattdessen gemessen wurde

Die Matrix wurde aus **allen 57 LGP-Archiven einer lokalen Installation**
gebildet, einschließlich der Sicherungskopien eines Game-Converters
([R5-FINGERPRINT-MATRIX.md](R5-FINGERPRINT-MATRIX.md)):

- 5 registrierte Release-Fingerprints (Kriterium: ≥ 3).
- 57 von 57 Archiven ohne fatalen Fehler, ohne Quarantäne.
- 52 unbekannte Varianten, alle im „best effort"-Pfad vollständig nutzbar.
- Trennschärfe in beide Richtungen belegt: 10 identische Dateipaare liefern
  identische Fingerprints, 5 Archivrollen liefern je mehrere.

### Restrisiko

Mittel. Eine Installation ist eine Stichprobe der Größe 1. Insbesondere fehlen
die 1998er-Originaldatenträger-Fassungen und nicht-westliche Sprachfassungen.
Der best-effort-Pfad ist strukturell nachgewiesen (52 Fälle), aber nur an
Varianten, die alle aus derselben Produktlinie stammen.

Gemildert wird das dadurch, dass eine unbekannte Variante ohnehin kein
Sonderfall im Code ist: Der Parser kennt keinen „bekannten Pfad", er hat nur
einen. Der Fingerprint entscheidet über die Diagnosetiefe, nicht über die
Verarbeitung.

### Nachhol-Auslöser

1. Der erste fremde Diagnosebericht trifft ein → Fingerprint in
   `BEKANNTE_RELEASES` aufnehmen, Matrix fortschreiben.
2. Ein Bericht zeigt fatale Fehler oder Quarantäne über 1 % → R5 wird wieder
   aktiv und blockiert die nächste Härtungssession.
3. **Vor dem 1.0-Label** (S26) muss die Matrix mindestens **drei
   unabhängige Installationen** umfassen, sonst bleibt R5 offen.

---

## ADR-023 — GPU-Registry existiert als Messmodell, nicht als Engine-Bestandteil

**Status:** Akzeptiert (bewusstes Restrisiko)
**Betrifft:** Masterplan-Phase 2.2 („GPU-Registry, refcounted, generationsgebunden")

### Sachstand

Der Soak-Test verlangt, dass „Heap- und GPU-Registry-Buchführung nach 500
Field-Wechseln auf Baseline zurückkehren". Die Buchführung existiert und ist
gemessen — aber als **Messinstrument** in
`tools/nfr-run/src/vram-buchfuehrung.ts`, nicht als Bestandteil der
Renderschicht. `packages/render-field` besitzt heute keine GPU-Registry, weil
es noch keine GPU-Ressourcen hält: es erzeugt Atlasdaten als NAM.

### Entscheidung

Die Messung wird als das ausgewiesen, was sie ist. Gemessen und belegt ist der
**Lebenszyklus**: Erwerb je Field-Generation, Freigabe beim Wechsel, exakte
Rückkehr auf 0 Bytes nach 500 Wechseln, 500 Erwerbe gegen 500 Freigaben, keine
Fehlfreigabe, nie mehr als eine Generation gleichzeitig gehalten. **Nicht**
belegt ist, dass ein späterer WebGL-Renderer seine Texturen tatsächlich
freigibt.

Die Buchführung in `tools/nfr-run` ist damit zugleich die
**Verhaltensspezifikation** für die echte Registry: gleiche Schnittstelle,
gleiche Invarianten, gleiche Tests.

### Restrisiko

Gering für die Beta (es gibt noch keinen Renderpfad, der lecken könnte),
mittel ab der Renderer-Integration.

### Nachhol-Auslöser

Mit der ersten Fassung von `packages/render-field`, die WebGL-Ressourcen hält
— spätestens im Bogen S25 (KTX2/HD-Texturpfad, dort ist die
VRAM-Budget-Buchführung explizites Akzeptanzkriterium). Dann wird die
Buchführung aus `tools/nfr-run` in die Renderschicht promoviert und der
Soak-Test gegen die echte Registry geführt, inklusive der
Context-Loss-Simulation aus der Teststrategie.

---

## Übersicht: Statusänderungen im Risikoregister

| Risiko | Vorher | Nachher | Belegt durch |
|---|---|---|---|
| R5 (Release-Varianz) | 🟡 | 🟡, geschlossen per **ADR-022** | 57 Archive, 5 Fingerprints, best-effort nachgewiesen |
| R7 (Quota/Eviction mobil) | offen | offen, geschlossen per **ADR-019** | kein Referenzgerät |
| R9 (Deterministik über Browser) | offen | 🟢 für V8, geschlossen per **ADR-020** | Fund + Härtung + Gegenprobe über drei Engines |
| ADR-010 (WASM) | Vorgeschlagen | **Verworfen** | Lastprofil über 702 Fields |
