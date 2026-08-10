# NFR-Messbericht S20 (Härtung & Beta-Gate)

Messdatum: **2026-08-10**. Alle Zahlen stammen aus reproduzierbaren Läufen
dieses Repositories; nichts ist geschätzt. Ein nicht gemessener Sollwert steht
als `ungemessen` in der Tabelle und ist ausdrücklich **nicht** erfüllt.

## Messaufbau

| Lauf | Kommando | Umgebung |
|---|---|---|
| Fixture (Node) | `npx vitest run tools/nfr-run` | Node 22, `--expose-gc`, synthetische Fake-Installation aus `tools/fixture-gen` |
| Realdaten (Node) | `npx vitest run --config vitest.realdata.config.ts tools/realdata-scan/src/nfr-desktop.rdtest.ts` | Node 22, lokale Installation, 702 Fields, 3 Archive |
| Soak (Realdaten) | `… tools/realdata-scan/src/soak.rdtest.ts` | 500 Field-Wechsel, 25 Fields in Rotation, 2048er Atlanten |
| Browser | `http://localhost:5199/nfr.html` | Chromium 148 (Browser-Pane), WebGL2, echter Parser-Worker |
| Cross-Browser | `http://localhost:5199/r9.html` kopflos | Chromium 151 (`--headless=new --dump-dom`) |

Messmaschine: Windows 11, 24 logische Kerne. Die Absolutwerte sind
maschinenabhängig; die **Verhältnisse zu den Budgets** sind die Aussage.

## Ergebnis gegen Masterplan-Phase 2.4 (Desktop)

| Metrik | Soll | Ist | Abweichung | Urteil | Quelle |
|---|---|---|---|---|---|
| Max. Main-Thread-Task durch Engine-Arbeit | ≤ 8 ms | 7,42 ms | −7,3 % | **erfüllt** | Realdaten, größte Tick-Etappe über 702 Sitzungen |
| Long Tasks (> 50 ms) im Steady State | 0 | 0 | — | **erfüllt** | Browser, `PerformanceObserver`, Parsen im Worker (Phase `worker-parse`) |
| GPU-Upload je Frame (gestückelt) | ≤ 2 ms | 1,0 ms (p95) | −50 % | **erfüllt** | Browser, `texSubImage2D`, 2048² in 8 Streifen |
| GPU-Upload je Frame, **ungestückelt** | ≤ 2 ms | 5,4 ms (p95) | +170 % | *verfehlt* | Browser, `texImage2D` einer ganzen 2048er-Seite |
| Time-to-First-Field (kalt) | ≤ 10 s | 48,4 ms | −99,5 % | **erfüllt** | Realdaten, Erstimport 702 Einträge + erstes Field |
| Time-to-First-Field (warm) | ≤ 2 s | 28,9 ms | −98,6 % | **erfüllt** | Realdaten, S0-Treffer |
| Field-Wechsel (warm) | ≤ 500 ms | 10,12 ms (p95) | −98,0 % | **erfüllt** | Realdaten, 702 Wechsel, p50 5,67 ms |
| Asset-Latenz Einzelmodell (kalt) | ≤ 300 ms | 2,15 ms (p95) | −99,3 % | **erfüllt** | Realdaten, 40 vollständige Modellketten |
| Asset-Latenz Einzelmodell (warm) | ≤ 50 ms | 1,14 ms (p95) | −97,7 % | **erfüllt** | Realdaten, zweiter Durchlauf |
| JS-Heap Steady State | ≤ 256 MB | 25,2 MB | −90,1 % | **erfüllt** | Realdaten, GC erzwungen |
| VRAM-Schätzbudget | ≤ 512 MB | 32 MB | −93,8 % | **erfüllt** | Atlas-Buchführung, 2048er Atlanten |
| Abbruchlatenz ohne SAB | ≤ 1 Parse-Etappe | 1 Etappe | 0 % | **erfüllt** | Vertragstests `packages/pipeline` (S3, unverändert grün) |
| Mindestanforderung (WebGL2, FSA, IndexedDB, Module-Worker) | Gate | erfüllt | — | **erfüllt** | Fähigkeitsmatrix `packages/app-shell`, Browserlauf |
| **Mobile — sämtliche Zeilen** | — | — | — | **ungemessen** | kein Referenzgerät, ADR-019 |

Alle Zahlen der Realdatenzeilen stammen aus **einem** Lauf (2026-08-10,
702 Fields, 3 Archive, 0 Bundle-Fehler). Bilanz dieses Laufs: 9 erfüllt,
0 grenzwertig, 0 verfehlt, 0 ungemessen.

Der knappste Wert ist der Main-Thread-Task mit 7,42 ms gegen 8 ms — 7 %
Luft. Der Wert ist die längste von 702 Tick-Etappen zu je 60 Takten; der
Median liegt bei 0,35 ms. Er verdient bei künftigen Erweiterungen der
Tick-Arbeit Aufmerksamkeit, ist aber eingehalten.

Der Browserlauf meldet **einen** Long Task von rund 1000 ms — er liegt
vollständig in der Phase `messgeruest`, dem Aufbau der Fake-Installation durch
die Fixture-Writer (LZS-Kompression). Das ist Testwerkzeug, keine
Engine-Arbeit; der Sollwert spricht ausdrücklich von „Main-Thread-Task durch
Engine-Arbeit". Die Phasenzuordnung wird mitgemessen, damit dieser Task nicht
unerklärt im Bericht steht. In der Messphase `worker-parse` — 12 Fields über
den echten Parser-Worker — sind es **0** Long Tasks.

**Einziger verfehlter Zielwert:** der ungestückelte GPU-Upload einer ganzen
2048er-Atlasseite (5,4 ms gegen 2 ms). Der Masterplan verlangt in derselben
Zeile „Uploads getaktet/gestückelt" — der gestückelte Pfad hält das Budget mit
1,0 ms je Streifen. Daraus folgt eine **bindende Auflage für die
Renderer-Integration**, festgehalten als ADR-021: Atlasseiten werden nie in
einem `texImage2D` hochgeladen, sondern in Streifen von höchstens 2048 × 256
Pixeln über mehrere Frames.

## Etappenaufteilung (Realdaten, 702 Field-Wechsel)

| Etappe | p50 | p95 | max | Summe | Thread laut ADR-002 |
|---|---|---|---|---|---|
| IO (Slice-Read) | 0,28 ms | 2,22 ms | 4,13 ms | 448,6 ms | Worker |
| LZS-Dekompression | 1,46 ms | 2,62 ms | 6,45 ms | 1102,7 ms | Worker |
| Container-Parse | 0,34 ms | 0,67 ms | 1,11 ms | 258,1 ms | Worker |
| Sitzungsaufbau | 0,19 ms | 0,48 ms | 1,30 ms | 156,1 ms | Hauptthread |
| 60 Takte | 0,35 ms | 1,36 ms | 7,42 ms | 343,4 ms | Hauptthread |
| Atlasaufbau | 2,44 ms | 4,68 ms | 8,98 ms | 1823,7 ms | Worker |
| **Wechsel gesamt** | **5,67 ms** | **10,12 ms** | **20,76 ms** | 4137,9 ms | — |

Atlasseiten je Field: p50 1, max 1 — ein einziger 2048er Atlas trägt jedes
der 702 Fields.

Der warme Field-Wechsel nutzt **2,0 %** seines Budgets.

## Soak-Test: 500 Field-Wechsel (Realdaten)

| Größe | Wert |
|---|---|
| Wechsel | 500 (25 Fields in Rotation) |
| Dauer je Wechsel | p50 5,71 ms, p95 10,58 ms, max 17,64 ms |
| Heap kalte Baseline | 26,2 MB |
| Heap Steady-State-Baseline (nach 25 Wechseln) | 26,2 MB |
| Heap nach 500 Wechseln | 26,5 MB |
| **Abweichung gegen Steady-State-Baseline** | **+1,07 %** (Grenze ± 5 %) |
| Abweichung gegen kalte Baseline | +0,97 % |
| GPU-Buchführung Ende | 0 Bytes (exakt Baseline) |
| Erwerbe / Freigaben / Fehlfreigaben | 500 / 500 / 0 |
| Höchststand GPU-Buchführung | 32 MB (nie mehr als eine Generation) |
| Sitzungsdigest Zyklus 1 == Zyklus 476 | ja |

Der Heapverlauf ist über die gesamten 500 Wechsel flach (26,2 → 26,5 MB); ein
Leck zeigte sich als monotoner Anstieg und ist ausgeschlossen.

Methodischer Hinweis: Die Baseline wird **nach** einer Aufwärmrunde genommen.
Ein erster Messversuch verglich gegen den Zustand vor dem ersten Wechsel und
meldete in einem Lauf 5,85 % — das waren Einmalkosten (JIT-Code, interne
Caches), kein Leck.
Beide Zahlen stehen deshalb in der Tabelle.

## Fixture-Lauf (Node, synthetische Installation)

| Größe | Wert |
|---|---|
| Fields | 8, Archiv 105.381 Bytes |
| TTFF kalt / warm | 8,5 ms / 2,8 ms |
| Field-Wechsel p95 | 1,62 ms (p50 1,37 ms) |
| GPU-Buchführung Ende | 0 Bytes, Höchststand 0,5 MB |
| Soak 500 Wechsel | p50 0,94 ms; Heap +1,49 % gegen Steady-State-Baseline; Digest stabil |
| Sollwerte erfüllt / grenzwertig / verfehlt / ungemessen | 6 / 0 / 0 / 0 |

Der Fixture-Lauf sagt nichts über die Realdatenlast — die Fake-Installation
ist strukturgleich, aber viel kleiner. Er belegt, dass die Messkette selbst
funktioniert und der Speicherlebenszyklus leckfrei ist, und er läuft in
`npm test` mit.

## Mobile

Für das Mobile-Profil liegt **kein Messwert** vor: es gibt kein
Referenzgerät. Alle mobilen Zielwerte der Phase 2.4 bleiben unbelegte
Setzungen und stehen als `ungemessen`. Siehe **ADR-019**.

Ersatzweise gemessen wurde der Speicherkontingent-Anteil von R7 auf dem
Desktop-Browser: Kontingent 17.075 MB, belegt 1,08 MB, `persisted() = false`.
`navigator.storage.persist()` wurde bewusst **nicht** aufgerufen — das wäre
eine Zustandsänderung am Browserprofil des Nutzers. Die Eviction-Frage bleibt
damit offen (ADR-019).

## ADR-010-Lastprofil (WASM)

| Größe | Wert |
|---|---|
| Gesamtarbeit über 702 Wechsel | 3684,0 ms (LZS + Parse + Sitzung + Takte + Atlas) |
| davon LZS | 1102,7 ms |
| davon Atlasaufbau (Texturkonvertierung) | 1823,7 ms |
| **Anteil der WASM-Kandidaten** | **79,4 %** |
| Budget Field-Wechsel | 500 ms |
| Ist p95 | 10,12 ms (**2,0 % Auslastung**) |
| Hypothetischer p95 bei 60 % Ersparnis auf beiden Kandidaten | 7,62 ms (1,5 % Auslastung) |

Die Kandidaten dominieren die Arbeit — aber die Arbeit selbst kostet 2 % des
Budgets. Eine Beschleunigung würde 2,0 % auf 1,5 % senken. **ADR-010 ist
damit verworfen** (siehe [ADR-S20-HAERTUNG.md](ADR-S20-HAERTUNG.md)).

## Cross-Browser (R9)

Siehe [R9-CROSSBROWSER.md](R9-CROSSBROWSER.md). Kurzfassung: Der Vergleich hat
eine echte Abweichung gefunden (`Math.atan2` unterscheidet sich zwischen zwei
V8-Ständen), die Ursache wurde per Math-Fingerprint eingegrenzt und behoben;
nach der Härtung stimmen alle drei Vektoren über Node 22, Chromium 148 und
Chromium 151 überein.

## Release-Varianz (R5)

Siehe [R5-FINGERPRINT-MATRIX.md](R5-FINGERPRINT-MATRIX.md).

## Reproduktion

```bash
npx vitest run tools/nfr-run                                     # Fixture-Lauf + Soak
npx vitest run --config vitest.realdata.config.ts                # alle Realdatenläufe
npm run demo                                                     # dann /nfr.html, /r9.html, /beta.html
```
