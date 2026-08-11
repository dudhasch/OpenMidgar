# S38 — Field-Actors: Entity-Render-Adapter & Animationssemantik

## Ausgangslage

`char.lgp`-Modelle und `.a`-Clips sind vollständig lesbar; die Renderer- und
Interpreterteile sind jedoch nur indirekt verbunden. Der Interpreter führt pro
Entity bereits `modelIndex`, Position, Richtung, Sichtbarkeit und
Animationsauftrag. Die Spielansicht muss daraus noch die korrekte Menge
gerenderter Actors machen. Ohne diesen Adapter zeigt eine Demo höchstens eine
frei gewählte Figur, nicht die Szene.

## Ziel

Eine Field-Render-Laufzeit bindet jede sichtbare Interpreter-Entity an ein
Model-Loader-Entry, löst das Modell aus `char.lgp` und stellt Position,
Richtung, Skalierung sowie Animation tickgenau dar. `CHAR`, `PC`, `VISI`,
`XYZI`, `MOVE`, `DFANM` und `ANIME1` werden damit als sichtbare Wirkung
abgenommen. Der manuelle Character-Selector bleibt ein Debug-Werkzeug, nicht
der Produktpfad.

| Feld | Inhalt |
|---|---|
| Voraussetzungen | S10 (Modell- und Clipparser), S12 (Entity-Zustand), S27 (Tick-Eingabe), S20 (Replay/NFR-Basis) |
| Betroffene Module | `packages/field-runtime`, `packages/render-actor`, neue Actor-Render-Bridge im Demo-/App-Pfad, `tools/fixture-gen`, `tools/realdata-scan` |
| Akzeptanzkriterien | Fixture: zwei Entities mit verschiedenen Modellen, Skalen, Richtungen und Clip-Aufträgen werden korrekt und tickdeterministisch dargestellt; `ANIME1` endet und kehrt zur Daueranimation zurück; `VISI` entfernt den Actor ohne Ressourcenleck; `MOVE` synchronisiert Walkmesh- und Renderposition; Realdaten: Referenzfield zeigt mindestens Cloud und eine NPC-Entity mit nachweisbar wechselndem Clip; Replay-Digest bleibt bei identischem Input gleich; Render-Registry kehrt nach 500 Field-Wechseln auf Baseline zurück |
| Nicht-Ziele | Keine geratene Bedeutung der Clip-Tags (`aki`, `yos`, usw.); keine Kampfmodelle; keine Gesichts-/Lippensynchronisation; keine neue Skriptsemantik außerhalb der bestehenden S12-Opcodes |
| Formatlage | Model-Loader, `.hrc`/`.rsd`/`.p`/`.tex`/`.a` und Entity-Zustandsfelder 🟢; Zuordnung eines numerischen `ANIME`-Operands zu einem Manifest-Clip 🔴 — zuerst Probe über Realdaten und kontrollierte Fixture-Verläufe |

## Prompt

„Probe zuerst: Miss je Field, welche `CHAR`-Indizes und `ANIME`-IDs tatsächlich
auftreten; prüfe als Gegenhypothese die direkte Listenindex-Zuordnung gegen
eine verschobene oder tagbasierte Zuordnung. Dann baue eine datengetriebene
Actor-Render-Bridge: Entities sind die Quelle für Modell, Sichtbarkeit,
Position, Richtung und Clipzustand. Jede sichtbare Abweichung erhält eine
Fixture und einen Replay-Nachweis. Keine Clipsemantik raten." 