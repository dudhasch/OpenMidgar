# S4 — Kalibrierentscheidungen (versioniertes Testartefakt)

Referenz: Masterplan Phase 3.1/3.2, ADR-005/-009, Risiko R2.
Kalibrierseite: `apps/demo/calibration.html` (Dev-Server: `npm run demo` → `/calibration.html`).
Golden: `apps/demo/public/golden/axis-cross.png` (640×480, FOV-Basis 240).

## Entscheidungen

| # | Parameter | Entscheidung | Status | Begründung / Validierungsweg |
|---|---|---|---|---|
| K1 | Koordinatenkonvertierung | `(x, y, z)_ff7 → (x, z, −y)_scene`, det = +1, einzige Flip-Stelle: `packages/convert/src/ff7-to-scene.ts` | 🔵 festgelegt, 🟡 Quellsystem-Annahme (z-up) gegen Realdaten offen | Achsenkreuz-Szene + Node-Tests (Händigkeit, Invertierbarkeit); Realdaten-Beweis folgt mit erstem echten Field (R2-Prozedur unten) |
| K2 | Kamerarekonstruktion | `C = −Rᵀ·t`; Basiswechsel right=M·r₁, up=−M·r₂, back=−M·r₃ (y-down→y-up) | 🔵 festgelegt | Konsistenztest: Referenzprojektion (Originalmodell) ≡ Three.js-Kamera, < 0,05 px (Quantisierungsrest der i16-Achsen ist formatgegeben) |
| K3 | **FOV-Basis** | **240** (`fovY = 2·atan(120/zoom)`); 224 bleibt als Schalter erhalten, ist aber nicht mehr die Arbeitshypothese | 🟢 **realdaten-entschieden (S9, 2026-08-09)** — Verfahren und Zahlen unten | Direkte Pixelmessung der bemalten Hintergrundfläche (siehe „R2-Entscheid") |
| K4 | Near/Far | Kalibrierszene fest 100/10000; produktiv aus Field-Bounds abzuleiten (Masterplan 3.2) | 🔵 Strategie festgelegt | Tile-Depth-Test verifiziert Ordnung 800 < 850 < 950 < 1000 < 5000 im echten Z-Buffer |
| K5 | Tile-Depth-Mapping | Sichtdistanz d → NDC: `z = (f+n)/(f−n) − 2fn/((f−n)·d)`; Tiles als Clip-Space-Quads (CCW!) mit depthWrite | 🔵 festgelegt | 5 automatische Verdeckungs-Proben in der Kalibrierseite (alle PASS) |
| K7 | **Tile-z → Sichtdistanz** | `viewDistance = max(1, z · zScale)`, `zScale` per Aufruf einstellbar (Default 1) | 🟡 offen — **z ist keine Metrik** | S9-Messung über 666 Fields: zwischen dem 12-Bit-Feld `z` (u16@26) und der kameraseitigen Sichtdistanz ist **kein** konstanter Faktor nachweisbar (Verhältnisstreuung p10…p90 über drei Größenordnungen). Belegt ist nur die Ordnung: Layer 0 trägt in **allen** 342.792 Tiles exakt 4095 (hinterste Ebene), Layer 1–3 kleinere Werte. Die Eichung erfolgt in S11 gegen echte Figurenverdeckung |
| K8 | **Transparenz je Layer** | Layer 0 deckend, Layer 1–3 „Palettenindex 0 = Loch" (`layerTransparency`) | 🟢 realdaten-gestützt | Bei bildschirmgroßer Basis (Layer 0+1, 135 Fields mit bemalter Fläche 320×240) deckt die Regel 97,1 % der Fläche; die Alternative „Rohwert 0 transparent" verliert 4 Prozentpunkte an echtem Schwarz. Die restlichen ~3 % sind tatsächlich unbemalte Zellen |
| K6 | Letterboxing | Kamera-Aspect fest 4:3; größtes zentriertes 4:3-Rechteck via Scissor/Viewport, Rest schwarz | 🔵 festgelegt (ADR-005) | Resize-Invarianz-Check: FNV-Hash der inneren Komposition identisch bei 640×480 / 800×480 / 640×600 (PASS) |

## R2-Entscheid: FOV-Basis 240 (S9, 2026-08-09)

Die Frage „historisches Rasterhöhen-Maß 240 (PC-Framebuffer) oder 224
(NTSC-Sichtbereich)?" war seit S4 offen. Entschieden wurde sie **nicht** über
3D-Projektion, sondern über eine direkte Pixelmessung an den Originaldaten —
das ist die schärfere Evidenz, weil kein Kameramodell dazwischensteht.

**Verworfene Verfahren** (beide als Negativbefund dokumentiert, Probe
`tools/realdata-scan/src/fov-probe.rdtest.ts`):

1. *Walkmesh-Projektion.* Für jedes Field wurde `base_touch = 240·|ndc|` über
   alle Walkmesh-Ecken gebildet — bei exakt bildrandberührender Geometrie
   wäre das die wahre Basis. Ergebnis: Median 360 (nicht scrollend) bzw. 488
   (scrollend), p99 im fünfstelligen Bereich. Ursache: Die Walkmesh reicht
   regelmäßig weit über den Bildausschnitt hinaus (Nachbarräume, Flure), und
   Kameras mit hohem Zoom erzeugen für bildferne Punkte riesige NDC-Werte.
   Die Messung trennt 224 und 240 nicht.
2. *`cameraRange` aus der Triggersektion.* Erwartet wurde
   `Bildbreite = W − (rechts − links)`. Ergebnis: **exakt 16 für alle 702
   Fields**, unabhängig von der Hintergrundgröße — `cameraRange` ist also
   nicht in Hintergrund-Pixeln belegt. Verfahren unbrauchbar.

**Entscheidendes Verfahren.** Gemessen wurde die *bemalte* Fläche der
Hintergrund-Basisebene: Bounding-Box über alle Layer-0-Tiles (16-px-Kacheln),
beschränkt auf die 177 nicht scrollenden Fields (deklariertes Layer-0-Maß
336×256 = Bildfläche plus 16 px Rand).

| Messgröße | Ergebnis |
|---|---|
| bemalte Höhe exakt **240** | **119 Fields (67,2 %)** |
| bemalte Höhe exakt 224 | 26 Fields (14,7 %) |
| übrige Höhen (11 verschiedene Werte) | 32 Fields (18,1 %) |
| häufigstes `dstY_min` | **−120** (134 von 177) |
| häufigstes `dstY_max + 16` | **+120** (135 von 177) |
| häufigste bemalte Breite | 320 (135 von 177) |

Die Symmetrieprobe ist der eigentliche Beweis: Die bemalte Fläche liegt
exakt bei −120…+120, nicht bei −112…+112. Ein Sichtfenster von 224 Zeilen
ließe sich damit nicht zentriert füllen.

**Entscheidung: FOV-Basis = 240.** Die 26 Fields mit bemalter Höhe 224
bleiben als Minderheitsbefund unerklärt (vermutlich PSX-Herkunft einzelner
Hintergründe) und sind kein Gegenbeleg — sie bemalen weniger Fläche, nicht
ein anderes Sichtfenster. Der Schalter auf 224 bleibt in
`packages/convert` erhalten, damit die Annahme falsifizierbar bleibt.

## Golden-Screenshot-Verfahren

1. Kalibrierseite rendert die Achsenkreuz-Referenzszene deterministisch
   (antialias aus, pixelRatio 1, FOV-Basis 240, 640×480).
2. „Checks ausführen" vergleicht die live extrahierte Komposition gegen
   `golden/axis-cross.png`: Schwelle 0,5 % abweichende Pixel (Kanaltoleranz 8).
3. Golden neu erzeugen (nur nach begründeter Szenenänderung!):
   Konsole → `fensterExportGolden()` liefert die PNG-DataURL; Datei unter
   `apps/demo/public/golden/axis-cross.png` ersetzen und die Änderung hier
   dokumentieren.

## Abnahme-Stand (2026-08-09)

Alle 7 Checks PASS: 5 Verdeckungs-Proben (Figur hinter Tile 800 / vor Tile 950,
Tiles über Boden, Hintergrund sichtbar), Resize-Invarianz (identische Hashes),
Golden-Diff 0,000 %.
