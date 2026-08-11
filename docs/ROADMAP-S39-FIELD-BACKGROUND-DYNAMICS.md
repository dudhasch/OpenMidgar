# S39 — Field-Hintergrund: Dynamik, Blendmodi & Effekt-Layer

## Ausgangslage

Der statische Field-Hintergrund ist lesbar und GPU-gerendert. Die Tiefenabbildung
hält jetzt auch ferne Basis- und nahe Effekt-Tiles innerhalb des Clippingbereichs.
Nicht implementiert sind jedoch die dynamischen Bestandteile: Palette-/Textur-
Zustände, die Skriptvariablen-Schaltung über `layerControl`, Scroll-/Parallax-
Verhalten und die originalen Blendmodi der Effekt-Layer. Der aktuelle Renderer
wählt bei konkurrierenden Tiles statisch den kleinsten `layerControl` und
behandelt Überlagerungen als normales Alpha-Over.

## Ziel

Ein tickgebundener Background-Zustand verbindet die bestehende Field-Runtime
mit `FieldBackground`: sichtbare Layerzustände, Palette-/Texturvarianten,
Scrollwerte und Blendmodi folgen den belegbaren Field-Skriptwirkungen. Der
Atlas darf dabei nicht dauerhaft auf eine RGBA-Startvariante festgelegt sein;
Varianten werden deterministisch und budgetiert erzeugt oder aktualisiert.

| Feld | Inhalt |
|---|---|
| Voraussetzungen | S9 (Parser/Atlas), S12 (Interpreter-Entity-/Variablenzustand), S20 (NFR- und Replay-Basis) |
| Betroffene Module | `packages/formats-field`, `packages/interpreter`, `packages/field-runtime`, `packages/render-field`, `apps/demo`, `tools/fixture-gen`, `tools/realdata-scan` |
| Akzeptanzkriterien | Realdatenprobe katalogisiert pro Field alle `layerControl`-/Flag-/Palette-/Blend-Kandidaten und trennt sie gegen Kontrollzuordnungen; Fixture deckt mindestens einen Layerwechsel, einen Palette-/Texturwechsel, einen Scrollwert und je einen belegten Blendmodus ab; CPU-Referenz und GPU ergeben für jeden Fixture-Tick dieselben RGBA-Pixel; Effekt-Tiles liegen stets innerhalb des Near-/Far-Clips; Replay-Digest und GPU-Budget bleiben über 500 Field-Wechsel stabil; Referenzfields zeigen sichtbare Effekte ohne schwarze oder achromatische Ausstanzungen |
| Nicht-Ziele | Kein Raten von unbekannten Flags oder Clipsemantik; keine HD-Texturen/KTX2; keine Mod-Autoroberfläche für Palettenanimationen; keine FMV-Effekte |
| Formatlage | Statische Tile-/Palette-/Texturzuordnung 🟢; `layerControl` als konkurrierender Zustandswert 🟡; Flagbits, Blendmodi, Palette-/Texturmutationen und ihre Opcode-Quellen 🔴 — erst per Probe zu entscheiden |

## Prompt

„Probe zuerst: Erfasse über alle Fields die Verteilung von `layerControl`,
Flags, Tile-Z und Palette/Texture-Referenzen sowie den zeitlichen
Interpreterzustand. Jede Kandidatenzuordnung braucht eine falsche Kontrolle.
Baue erst danach einen tickgebundenen Background-State mit CPU/GPU-Dualität;
alle dynamischen Varianten müssen replaydeterministisch und GPU-budgetiert
bleiben. Schwarze Pixel sind nur dann transparent, wenn der belegte Zustand es
fordert — nie als stiller Clipping- oder Fallbackeffekt." 