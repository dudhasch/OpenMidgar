# R4 — Forschungsnotiz: Modell- und Animationskonventionen (lebendes Dokument)

Status: **Strukturebene geschlossen, Semantikebene offen** (P1-Risiko laut
Masterplan). Ergänzt [R1-REQUEST-SEMANTIK.md](R1-REQUEST-SEMANTIK.md).

## Realdaten-validierte Formatfakten (model-probe/-sweep, 2026-08-09)

| Fakt | Beleg |
|---|---|
| `.p`: 128-B-Header, Poolreihenfolge laut Doku, Renderstate 100 B, Gruppe 56 B, **BBox-Record 28 B**, **Normalindex-Tabelle 4·nVertices** | Size-Accounting exakt über 4180/4180 Dateien |
| `.p`: Polygon-Vertexindizes sind **gruppenrelativ** (zu verticesStartIndex) | 0 × E-P-BOUNDS, 0 verworfene Gruppen im Sweep |
| `.tex`: Header 236 B + Palette (4·paletteSize) + Pixel (b·w·h); char.lgp durchgehend 8-bpp-palettiert | 695/695 exakt |
| `.a`: Header 36 B; **Frame = 24 B Wurzel + 12 B je Bone**; nBones 0–29 | 3209/3209 exakt |
| `.hrc`/`.rsd`-Grammatik + Alt-Endungs-Mapping (PLY→.p, TIM→.tex) | 385/385 bzw. 4180/4180; alle 385 Ketten vollständig auflösbar |

## Semantik-Annahmen B1–B10 — Stand nach der O4-Bilanz (2026-08-10)

**Diese Tabelle ist der maßgebliche Merkzettel.** Sie wurde am 2026-08-10 gegen
den gesamten Verlauf dieses Dokuments nachgeführt; die Einzelnachweise stehen
in den Abschnitten weiter unten. Ausführliche Einordnung: „O4-Bilanz" am Ende.

| # | Annahme | Ort | Stand |
|---|---|---|---|
| B1 ✅ | Bone-Längsachse = lokales +Z; Kindversatz **T(0,0,−parentLength)** | `render-actor/pose.ts`, `actor.ts` | **Gelöst 2026-08-10:** Tafel mit 50 Renderketten, Bewertung in sich konsistent (zwei Zerlegungen desselben Transforms); numerisch gegen die Produktionskette nachgewiesen, gegen Überanpassung an drei weiteren Modellen in je drei Ansichten. Das Vorzeichen lief nach `+len`, richtig ist `−len` |
| B2 ✅ | Eulerreihenfolge **'YXZ'** (R = Ry·Rx·Rz), Winkel in Grad | `pose.ts EULER_ORDER` | **Gelöst als Datum:** steht im `.a`-Dateikopf, **3209/3209**. Die zwischenzeitliche Notiz „B2 widerlegt" betraf die *Hypothese*, eine wechselnde Reihenfolge erkläre das Kippen — die ist widerlegt, YXZ selbst ist bestätigt. Ursache des Kippens war B1 |
| B3 🟡 | 24 Wurzel-Bytes je Frame: **Rotation vor Translation** | `formats-model/anim.ts` | **Nur eingegrenzt, nicht entschieden.** Belegt ist ausschließlich, dass die Wurzel das Kippen nicht verursacht (Bytes 0–11 zu 98,7 % genau 0; Bytes 12–23 max. 16,45). Welche Hälfte welche ist, bleibt unbelegt — bei diesen Wertgrößen folgenlos, aber es ist kein Formatfakt |
| B4 🟡 | Frames adressieren Bones in **Dateireihenfolge** | `pose.ts`/`actor.ts` via `fileOrder` | **Indirekt gestützt, nie direkt geprüft.** Die B1-Tafel und die drei Gegenmodelle zeigen zusammensitzende Segmente in drei Ansichten — eine falsche Bone-Adressierung würde Segmente verstreuen. Das ist ein starkes Indiz, aber keine gezielte Messung an einem Skelett mit ungleichen Kettenlängen |
| B5 ✅ | Palettenblock **BGRA** | `tex.ts`, `model-writers.ts` | **Sichtgeprüft 2026-08-10:** 4 Texturen × 4 Auslegungen, BGRA 4/4 richtig, alle Alternativen 12/12 als falsche Farbe |
| B6a ✅ | Vertexfarben **BGRA** | `p.ts` | **Sichtgeprüft 2026-08-10:** zwei Modelle einstimmig, RGBA zweimal verworfen |
| B6b ✅ | UV-Koordinaten **roh**, weder U noch V geflippt | `p.ts`, `actor.ts` | **Sichtgeprüft 2026-08-10:** genau 1 von 4 Kombinationen richtig |
| B7 ❌ | ~~Wurzelpivot am Walkmesh-Kontaktpunkt; Höhenversatz aus rootTranslation~~ | Demo/`actor.ts` | **Widerlegt, ohne Ersatz.** Der Wurzelpivot liegt **in der Hüfte**, nicht am Bodenkontaktpunkt. Der Höhenversatz Figur↔Walkmesh muss anders bestimmt werden. **Einziger echt offener B-Posten** — s. „Offen bleibt" unter der B1-Lösung |
| B8 ✅ | Skalierungsfaktor kommt aus dem **Modelldateifeld**, nicht aus der Field-Sektion | `formats-model` | **Präzisiert 2026-08-10** — s. Abschnitt „B8 präzisiert" |
| B9 ✅ | Farbschlüssel: Palettenalpha 0 = durchsichtig, Kopfschalter bei 0x08 | `tex.ts`, `actor.ts` | **Realdaten 695/695** (`tex-alpha-probe`), Bildwirkung sichtgeprüft |
| B10 🟡 | Texturierte Teilnetze sind Aufkleber und bekommen Tiefenvorzug | `actor.ts` | Bauformregel, kein Dateidatum — s. Abschnitt „Streifen über den Augen" |

**Zusätzlich offen, ohne B-Nummer:** Die Abbildung der **Wurzeltranslation**
ist unbelegt. Sie verschiebt Figur und Pivot gemeinsam und ist damit für jede
Sichtprüfung **und** jedes formbasierte Maß unsichtbar — sie braucht den
Bodenkontakt als Referenz und hängt damit an B7.

## Sichtprüfung durchgeführt (2026-08-09) — und was sie ausgelöst hat

Der Nutzer hat die Demoseite mit der echten Installation geprüft. Vier
Beobachtungen, wörtlich:

1. „Ansicht Front — Cloud *liegt*. Man sieht ihn von unten, sieht aber an sich
   richtig aus."
2. „Animationen selbst sind richtig, aber die Bonestruktur zuckt in falsche
   Richtungen."
3. „Ansicht Seite und Draufsicht — Bones komplett falsch angeordnet."
4. „Bei Texturkanäle sehe ich keinen Unterschied zwischen den beiden."

Beobachtung 1 ist der Schlüssel: *„sieht an sich richtig aus"* heißt, dass
Netzaufbau, Bone-Anbindung und Farben stimmen — falsch ist nur die **Lage**.
Damit war endlich klar, wonach ein automatischer Test suchen muss, und die
seit S11 blockierte Automatisierung ließ sich bauen
(`tools/realdata-scan/src/model-orientation-probe.rdtest.ts`).

### Was daraufhin gemessen wurde

| Aussage | Ergebnis |
|---|---|
| **B1 ✅ bestätigt** | Bindpose über 280 Modelle: bei **266 (95,0 %)** ist die Höhe die längste Achse, Verhältnis Höhe/Quer **2,109**. Die Kontrollabbildung (ohne Konvertierung) liefert 0,453 und legt die Figur flach. Bone-Achse, Kindversatz und die zentrale Konvertierung (ADR-009) sind damit belegt. |
| **Winkeleinheit ✅ bestätigt** | 11.421 Bone-Winkel: **100 % ≤ 360°**, Maximum 359,91°, Median 76°, voller Wertebereich ausgeschöpft. Grad, nicht Radiant, kein Festkommamaß. |
| **B3 ✅ eingegrenzt** | Beide Hälften des 24-B-Wurzelblocks tragen winzige Werte (Bytes 0–11 zu 98,7 % genau 0; Bytes 12–23 maximal 16,45). Die Wurzel verursacht das Kippen **nicht** — unabhängig davon, welche Hälfte welche ist. |
| **B2 ❌ widerlegt, Ersatz offen** | Die Bindpose steht aufrecht (72/76), **Frame 0 einer echten Animation nur in 10/76**. Es sind also die **Bone-Rotationen**. Der Durchlauf aller sechs Eulerreihenfolgen liefert aber keinen Sieger: ZXY 57,2 %, ZYX 51,7 %, YZX 50,9 %, XYZ 39,5 %, das implementierte **YXZ 34,3 %**. Faktor 1,11 zum Zweiten — nach Projektmaßstab kein Befund. |
| **B5/B6 ⏳ weiterhin ungeprüft** | Nur **13,3 %** der Teilnetze (626/4710) sind überhaupt texturiert; der Rest trägt Vertexfarben. Der RGB↔BGR-Schalter wirkt nur auf Texturen — deshalb ist „kein Unterschied" **kein** Ergebnis, sondern ein untauglicher Testaufbau. |

### Beinahe-Fehlschluss, festgehalten

Im ersten Anlauf wurden Skelett und Animation über die **Bone-Anzahl** gepaart,
weil Animationen nicht wie ihr Skelett heißen. Damit gewann XYZ mit 66,6 %.
Mit der **echten** Paarung aus dem Field-Manifest (S10, 100 % auflösbar) fällt
XYZ auf 39,5 % und ZXY führt. Die erste Rangfolge war ein reines Artefakt der
Behelfspaarung — dieselbe Lehre wie bei der Prüfsumme: Eine bequeme
Hilfsannahme im Messaufbau kann die Rangfolge vollständig drehen.

### Was als Nächstes zu tun ist

Die Unbekannte ist jetzt eng: **die Auslegung der Bone-Rotationen** — und
nur sie. Ausgeschlossen sind Konvertierung, Winkeleinheit, Wurzelblock,
Netzaufbau. Da die reine Reihenfolge nicht trennt, ist der nächste Suchraum
größer als sechs Kandidaten: Reihenfolge **× Vorzeichen je Achse** (48
Kombinationen) und ggf. eine Achsenpermutation der Winkel gegenüber den
Bone-Achsen. Die Gütefunktion steht bereits, der Durchlauf ist mechanisch.

Zusätzlich sollte die Gütefunktion geschärft werden: „Höhe ist die längste
Achse" ist grob. Besser wäre die **Stetigkeit** über aufeinanderfolgende
Frames (gemessen: Höhensprung Median 0,6 %, p95 10,5 %) zusammen mit der
Aufrechtigkeit — eine falsche Auslegung erzeugt Sprünge, die eine echte
Animation nicht hat. Genau das beschreibt Beobachtung 2 mit „zuckt".

## Stand nach S10 (2026-08-09)

- **Erledigt:** Die Model-Loader-Sektion ist geparst (702/702 byteexakt), und
  **jede** Referenz löst gegen `char.lgp` auf — 5454/5454 Modelle und
  26.212/26.212 Animationen. Die echten hrc↔a-Paarungen liegen damit vor;
  die Demoseite `apps/demo/field-model.html` lädt sie lokal und blendet
  Bone-Achsen, Ansichten und einen RGB↔BGR-Tausch als Vergleichsschalter ein.
- **Korrektur zu B8:** Der Skalierungsfaktor kommt NICHT aus der
  Triggersektion, sondern doppelt aus Sektion 3 — global im Kopf
  (`scaleGlobal`, 512 in 643/702 Fields) und je Modell als ASCII-Ziffern im
  12-B-Dateifeld. Beide stimmen nur in 93,6 % überein; welcher Wert bei
  Abweichung gilt, ist offen.
- **Neu offen (B9):** Das u16 hinter dem Modellnamen ist ein binäres Flag
  (0 in 47,6 %, 1 in 52,4 %) — Bedeutung unbekannt.
- **Neu offen (B10):** Der 30-B-Block je Modell ist vermutlich Beleuchtung
  (`decodeModelLightBlock`); die Umgebungsfarbe am Ende ist gut gestützt, die
  Aufteilung der drei Lichteinheiten nicht. Erst anwenden, wenn die
  Sichtprüfung sie bestätigt.

## Warum B1 und B4 sich der Automatisierung entziehen (Versuch in S11)

Ein Automatisierungsversuch ist bewusst gescheitert und wird hier festgehalten,
damit ihn niemand wiederholt:

- **B1 über die Bindpose messen geht nicht.** Der Gedanke war: „eine Figur ist
  höher als breit". In der Bindpose sind aber alle Rotationen 0, und weil
  FF7-Feldmodelle starr segmentiert sind, entsteht dabei eine *gerade Kette*
  entlang der Bone-Achse — Breite exakt 0 bei allen 280 gemessenen Modellen.
  Die Aufrechtigkeit steckt nicht im Skelett, sondern in der Mesh-Geometrie.
  Ein tragfähiger automatischer Test müsste die `.p`-Segmente über die
  Bone-Matrizen transformieren und deren Bounding-Box messen.
- **B4 über die Posengröße messen geht nicht.** Gemessen wurde die
  Ausdehnung der animierten Pose gegen die Bindpose, mit zyklisch
  verschobener Bone-Zuordnung als Kontrolle. Ergebnis: die *falsche*
  Zuordnung ergab eine kleinere Ausdehnung (Median 1,26 gegen 1,52) — das Maß
  ist von der Wurzeltranslation dominiert und trennt die Hypothesen nicht.

Beide Annahmen bleiben damit auf die Sichtprüfung angewiesen; die Demoseite
`apps/demo/field-model.html` hält die Vergleichsschalter dafür bereit.

## Nächste Schritte

1. B1–B4 an einem Referenzmodell (aufrechte Idle-Pose) sichtprüfen —
   die Demoseite dafür steht, die Prüfung selbst braucht ein Auge.
2. B5/B6 über ein texturiertes Modell mit bekannter Farbverteilung prüfen.
3. Renderstate-Blöcke (100 B): abgesicherte Flags (Blend/Cull/Lit) mappen —
   bisher roh konserviert.

## Kujata-Abgleich (2026-08-10)

Kujata (picklejar76) übersetzt FF7-Assets nach glTF und muss die
Modellkonventionen daher vollständig auflösen. Der Abgleich bringt drei
Aussagen:

1. **`rotationOrder = "YXZ"`** — identisch mit unserer Annahme B2. Kujatas
   Euler→Quaternion-Herleitung entspricht Zeichen für Zeichen der
   Three-Semantik (R = Ry·Rx·Rz). **Die Reihenfolge war nie das Problem.**
2. **`rootRotationDegreesX = 180` für Feldmodelle**, bei
   `boneRotationScale = 1` und `boneRotationDegrees = 0`. Diesen Versatz
   hatten wir gar nicht.
3. Für Kampfmodelle gilt stattdessen `containerRotationDegreesX = 180` —
   die Fassungen unterscheiden sich also, was die Existenz eines solchen
   Versatzes zusätzlich plausibel macht.

**Umgesetzt als `FIELD_ROOT_PITCH_DEG = 180`** in `render-actor/pose.ts`,
angewendet an genau einer Stelle (`applyFrame`). `computePose` bleibt frei
davon — es ist die reine Referenzmathematik und soll keine
Fassungs-Konvention tragen; die Dualitätstests rufen es entsprechend mit 0.

### Warum das 🟡 bleibt und nicht ✅

Die Realdaten-Probe kann diesen Wert **nicht** entscheiden, und zwar aus einem
prinzipiellen Grund: Sie bewertet über die Ausdehnung der Mesh-Punktwolke, und
eine 180°-Drehung lässt eine Bounding-Box unverändert. Gemessen liefern
Versatz 0 und 180 **exakt dieselben Zahlen** — die Gütefunktion ist für genau
diesen Fehler blind.

Das ist selbst ein Befund: Eine Gütefunktion muss zur gesuchten Größe passen.
Die Ausdehnung misst „liegt oder steht", nicht „steht richtig herum". Für den
zweiten Fall braucht es ein **richtungsempfindliches** Maß — etwa die Lage des
Wurzelgelenks relativ zur Figurenhöhe, oder den Bodenkontakt gegen das
Walkmesh.

Bis dahin gilt: Der Wert ist durch eine unabhängige Zweitimplementierung
gestützt UND deckt sich mit dem Symptom der Sichtprüfung („man sieht ihn von
unten"). Das ist mehr Beleg als für den vorherigen Zustand — aber kein Beweis.

## Repo-Abgleich Runde 2 (2026-08-10)

### B10 ✅ gelöst — Lichtblock-Aufteilung

Makou Reactor (`FieldModelLoaderPC.cpp`) liest je Lichteinheit **erst drei
Farbbytes, dann drei i16-Richtungen**; wir lasen es umgekehrt. Beide
Auslegungen sind 9 Byte lang, die Bytefolge allein entscheidet nichts.

Entschieden hat der **Betrag der Richtungsvektoren** über alle 5454 Blöcke:

| Auslegung | Median \|v\| | IQR | innerhalb ±10 % |
|---|---|---|---|
| **Farbe zuerst (Makou)** | **4108,5** | **9,2** | **96,4 %** |
| Richtung zuerst (bisher) | 38022,3 | 9712,8 | 43,1 % |

4096 ist die FF7-Festkommaeinheit — das sind normierte Vektoren. Korrigiert
in `decodeModelLightBlock`; der Blockaufbau ist damit
`3 × (RGB[3] + i16 dirA/dirB/dirC) + RGB[3] Globalfarbe = 30 B`.

### B8 ✅ präzisiert — Modelldateifeld

Makou liest das Feld als **8 B HRC-Name + 4 B ASCII-Skala** (nicht als 12 B
gemischt) und beantwortet damit unsere offene Frage: Der Modellwert gilt,
die globale Feldskala ist der **Rückfall**, wenn die vier Zeichen nicht als
Zahl lesbar sind.

### B9 ⏳ unverändert offen

Das u16 hinter dem Modellnamen heißt auch bei Makou `unknown`. Kein Gewinn —
aber immerhin die Bestätigung, dass es niemand kennt.

### B2 — Kujata ist keine Blaupause

Kujatas Wurzel-Pitch (180°) gehört zu einer Pipeline, die sich an zwei
weiteren Stellen unterscheidet: Kindversatz nach `−parentLength` (bei uns
`+parentLength`) und kein Achsen-Basiswechsel FF7→Szene. Nachgemessen
verschlechtert Kujatas Versatzvorzeichen unsere Aufrechtigkeit durchgehend.

Die drei Entscheidungen gehören zusammen; eine davon einzeln zu übernehmen
wäre genau der Fehler, den dieses Projekt sonst vermeidet. Der Pitch steht
deshalb als **Schalter** auf der Demoseite (`Wurzel-Pitch 180°`), nicht als
Vorgabe — die Realdaten-Probe kann ihn nicht entscheiden, weil eine
180°-Drehung eine Bounding-Box unverändert lässt.

### B2 — die Reihenfolge ist es nachweislich nicht (2026-08-10)

KimeraCS liest im `.a`-Kopf drei Bytes `rotationOrder`. Läge dort eine je
Datei wechselnde Reihenfolge, wäre das die **vollständige** Erklärung dafür,
dass animierte Frames nur in 10/76 Fällen aufrecht stehen: Eine fest
verdrahtete Reihenfolge müsste überall dort scheitern, wo die Datei etwas
anderes sagt.

Gemessen über alle 3209 `.a`-Dateien der Installation:

| | |
|---|---|
| Versatz 12..14 ist eine Permutation von {0,1,2} | **3209/3209** |
| Kontrollversätze 13 und 16 | **0/3209** und **0/3209** |
| belegte Reihenfolgen | **genau eine: YXZ** (3209 ×) |
| Byte 15, `version` | 0 bzw. 1 in allen Dateien |

Das Feld ist echt — ein Zufallstripel bestünde den Permutationstest mit
6 / 2²⁴ —, aber es **variiert nicht**. Die Hypothese ist damit sauber
widerlegt und B2s Ursache liegt woanders. Unser YXZ ist zugleich bestätigt,
und der Parser liest die Reihenfolge jetzt aus der Datei (`W-ANIM-ROTORDER`
bei Abweichung), statt sie anzunehmen.

**Nebenertrag:** Dass im Frame die Wurzelrotation **vor** der Wurzeltranslation
steht, war bisher 🟡. Zwei unabhängige Fremdimplementierungen lesen es so —
🟡 → 🟢.

**Die verbleibende Spur — und warum sie bisher falsch gemessen wurde.**
KimeraCS versetzt **Field**-Bones mit `translate(0, 0, −len)`, **Battle**-Bones
dagegen mit `+len`; Kujata nutzt für Field ebenfalls `−len`. Zwei unabhängige
Quellen sagen also `−len`, und unsere Messung sagt, dass `−len` alles
verschlechtert.

Dieser Widerspruch ist auflösbar: Gemessen wurde das Vorzeichen **einzeln**,
bei unverändertem Achsen-Basiswechsel `(x, z, −y)`. Beide Größen beschreiben
dieselbe Händigkeit. Eine davon zu drehen kippt das Ergebnis, beide zu drehen
womöglich nicht — genau die Kopplungsfalle, die dieses Projekt an anderer
Stelle schon einmal Zeit gekostet hat. Der nächste Anlauf muss das Kreuzprodukt
aus Versatzvorzeichen × Basiswechsel durchmessen, nicht eine Achse davon.

## B2 gelöst — der Fehler saß im Wurzelrahmen (2026-08-10)

**Die Sichtprüfung hat entschieden, was keine Bounding-Box konnte.** Gemeldet
wurde: ohne Zusatzwinkel sieht man die Figur **von unten** (Füße), mit 180°
**von oben** (Kopf). Beide Stellungen liegen 90° daneben — in
entgegengesetzte Richtungen. Der gesuchte Wert liegt also dazwischen.

**Dieselbe Zahl folgt unabhängig aus der Algebra.** Kujata setzt für
Feldmodelle `rootRotationDegreesX = 180` im *reinen Modellraum*. Unsere
Pipeline hängt stattdessen die ADR-009-Basis `C: (x,y,z) → (x, z, −y)` über
das Modell — und das ist exakt `Rx(−90°)`:

```text
Rx(θ):    (x, y, z) → (x, y·cosθ − z·sinθ, y·sinθ + z·cosθ)
θ = −90°:           → (x, z, −y)                    ✓ C = Rx(−90°)
```

Aus der Äquivalenzforderung `C · Rx(fix) = Rx(180°)` folgt, weil Drehungen um
dieselbe Achse additiv sind, `Rx(−90° + fix) = Rx(180°)` ⇒ **fix = −90°**.
Die Translation steht im selben gedrehten Rahmen und braucht `C⁻¹ = Rx(+90°)`:
`t → (t.x, −t.z, t.y)`.

### Und diesmal ist es messbar

Der frühere Sweep konnte nichts entscheiden, weil eine 180°-Drehung eine
Bounding-Box unverändert lässt. Eine **Vierteldrehung** lässt sie nicht
unverändert — sie vertauscht Y- und Z-Ausdehnung. Gemessen über 271 animierte
Frames:

| Variante | aufrecht |
|---|---|
| ohne Versatz (0°) | 34,3 % |
| **Wurzel-X ±90°** | **63,1 %** |
| Wurzel-X 180° (Kujata roh) | 34,3 % |
| vollständige Korrektur (−90° + C⁻¹·t) | 63,1 % |

Faktor **1,84** gegenüber beiden Alternativen — nach Projektmaßstab ein
Befund. Der frühere Eulerreihenfolgen-Sweep lag mit Faktor 1,11 klar darunter,
und zwar zu Recht: Der Fehler lag außerhalb seines Suchraums.

**Dass 0° und 180° exakt dieselbe Zahl liefern, ist die Bestätigung der
dokumentierten Blindheit** — nicht ihr Widerspruch.

### Was diese Messung NICHT zeigt — drei Einschränkungen, die bleiben

1. **Das Vorzeichen entscheidet sie nicht.** −90° und +90° unterscheiden sich
   um 180°, und dagegen ist die Box blind; gemessen liefern beide 63,1 %.
   Entschieden wird das Vorzeichen durch die Sichtprüfung („von unten" bei 0°)
   plus die Algebra oben — nicht durch diesen Sweep.
2. **Den Translations-Umbau kann sie prinzipiell nicht prüfen.** Die
   Ausdehnung einer Punktwolke ist gegenüber Verschiebungen invariant. Der
   Umbau `t → (x, −z, y)` folgt allein aus der Algebra; abgesichert ist er
   durch einen Fixture-Test mit in allen drei Komponenten verschiedener
   Translation, der ohne die Regel durchfiele.
3. **63,1 % sind nicht 100 %.** Ein Rest bleibt unerklärt. B2 ist damit
   entschieden, R4 als Ganzes nicht abgeschlossen.

### Umgesetzt

- `render-actor/pose.ts`: `ROOT_FRAME_FIX_DEG = −90`,
  `rootFrameTranslationToModel(t)`; `computePose(…, rootFrameFix = false)` —
  die reine Referenzmathematik bleibt konventionsfrei.
- `render-actor/actor.ts`: `applyFrame(…, rootFrameFix = true)` — der
  Renderpfad trägt die Korrektur als **Vorgabe**.
- `render-actor.test.ts`: Dualität jetzt in **beiden** Modi geprüft; ohne den
  zweiten Test wäre ausgerechnet die Vorgabe ungeprüft gewesen. Dazu eine
  Gegenprobe, dass sich die Modi überhaupt unterscheiden.
- Demoseite: Schalter „Wurzelrahmen-Korrektur", standardmäßig **an**.

### Damit erledigt sich rückwirkend

- Der Eulerreihenfolgen-Sweep konnte keinen Sieger haben — der Fehler lag
  nicht in der Reihenfolge. Die Messung „YXZ 34,3 %" war korrekt und trotzdem
  irreführend.
- „Bindpose zu 95 % aufrecht" war ein Artefakt: In der Bindpose sind alle
  Rotationen 0, die Kette fällt zu einer Geraden zusammen, und die Wurzel
  trägt weder Rotation noch Translation. Der Fehler *kann* dort nicht
  auftreten.

## Korrektur: B2 war NICHT gelöst (2026-08-10, nachmittags)

**Der Abschnitt oben behauptet zu viel.** Die Sichtprüfung nach der Umstellung
zeigt: Mit der Wurzelrahmen-Korrektur sieht man die Figur **von oben** statt
von unten — also weiterhin 90° daneben, nur in die andere Richtung. Und die
Segmente stehen sichtbar auseinander.

Diese Korrektur bleibt hier stehen, statt den Abschnitt zu überschreiben. Der
Fehler war nicht die Rechnung, sondern die Gütefunktion — und das ist der
lehrreiche Teil.

### Was die vollständige Kreuzprodukt-Messung ergeben hat

Gemessen wurde `Kindversatz (±) × Wurzelwinkel (0/90/180/270) × Achsenbasis
(adr009 / keine / z→y)` = 24 Ketten, über 56 Modelle und 138 Frames, mit einer
richtungsempfindlichen Güte (Breite oberhalb gegen unterhalb der Wurzel —
über der Hüfte sitzen Rumpf, Arme und Kopf, darunter nur Beine).

| Kette | aufrecht | Breite oben/unten |
|---|---|---|
| unsere jetzige (Versatz+ · 270° · adr009) | 38,4 % | 1,03 |
| **Kujata vollständig** (Versatz− · 180° · ohne Basis) | **22,5 %** | — |
| unsere frühere (Versatz+ · 0° · adr009) | 31,2 % | 0,97 |
| schlechteste der 24 | 10,9 % | 0,96 |
| **rohe `.p`-Vertices ohne JEDE Bone-Transformation** | **35,7 %** | 1,03 |

Drei Schlüsse, alle unbequem:

1. **Kujatas vollständige Kette ist bei uns schlechter, nicht besser.** Sie
   wholesale zu übernehmen ist damit ausgeschlossen — die Referenz beschreibt
   eine Pipeline, deren übrige Teile wir nicht teilen.
2. **Keine der 24 Ketten steht aufrecht.** Der Fehler liegt also nicht in
   diesen drei Achsen. Er liegt weiter unten: in der Zuordnung Mesh↔Bone, in
   der `.p`-Auslegung oder in der Kettenkonstruktion selbst.
3. **Die Güte trennt kaum.** Alle 24 Varianten liegen zwischen 0,96 und 1,03 —
   ein Signal von rund 7 %. Und die rohen Vertices *ohne* jede
   Bone-Transformation erreichen praktisch denselben Wert wie die beste
   transformierte Kette. Das heißt: Die Bone-Transformationen tragen zur Form
   fast nichts bei. Entweder ist die Kette faktisch wirkungslos, oder die
   Meshes liegen bereits fertig platziert vor.

### Der methodische Kern

Dies ist der **dritte** Anlauf, bei dem eine Gütefunktion die gesuchte Größe
nicht sehen konnte:

| Anlauf | Güte | Warum blind |
|---|---|---|
| 1 | Y ist längste Achse | invariant unter 180° |
| 2 | dito, über Eulerreihenfolgen | Fehler lag außerhalb des Suchraums |
| 3 | Anteil über dem Pivot | Wurzel sitzt in der Hüfte, nicht am Boden ⇒ Median zwangsläufig ~0,5 |
| 4 | Breite oben/unten | Signal nur ~7 %, im Rauschen |

**Die Lehre ist nicht „besser messen", sondern: Diese Frage ist mit
Punktwolken-Statistik nicht zu entscheiden.** Der nächste Anlauf braucht ein
anderes Verfahren — die Sichtprüfung als primäres Instrument, oder einen
Vergleich einzelner Segmentpositionen gegen eine bekannte Referenzpose, nicht
gegen eine Aggregatgröße.

### Stand jetzt

- `ROOT_FRAME_FIX_DEG = −90` **bleibt**, weil es von 24 Ketten die beste ist
  (38,4 % gegen 31,2 % ohne). Aber es ist eine Verbesserung um sieben
  Prozentpunkte, **keine Lösung**.
- **B2 ist NICHT entschieden.** Die Eulerreihenfolge YXZ ist unabhängig belegt
  (Header, 3209/3209) — das bleibt. Alles andere an B1–B4 ist offen.
- Nächster Faden, aus der Sichtprüfung statt aus der Messung: Die Segmente
  stehen auseinander (freischwebende Kästen neben dem Körper). Das ist die
  Signatur einer **Platzierungs**-, keiner Orientierungsfrage — zu prüfen sind
  die RSD→`.p`-Auflösung je Bone und die Frage, in welchem Raum die
  `.p`-Vertices überhaupt stehen.

## R4-B1 GELÖST — der Kindversatz hatte das falsche Vorzeichen (2026-08-10, abends)

Entschieden hat es die **Sichtprüfung an einer Tafel mit 50 gerenderten
Renderketten** — nicht eine fünfte Kennzahl.

### Der Befund

| Bewertung | Zellen | Kette | Gesamtdrehung (Basis ∘ Pitch) |
|---|---|---|---|
| **richtig** | #14 | Versatz VOR Rotation · **−len** · Pitch 180° · Basis keine | Rx(180°) |
| **richtig** | #15 | Versatz VOR Rotation · **−len** · Pitch 270° · Basis adr009 | Rx(−90°)∘Rx(270°) = **Rx(180°)** |
| 180° gedreht | #10 | −len · Pitch 0° · Basis keine | Rx(0°) |
| 180° gedreht | #11 | −len · Pitch 90° · Basis adr009 | **Rx(0°)** |

**Die Bewertung ist in sich konsistent, und das ist der Beleg.** Die beiden
als richtig erkannten Zellen sind derselbe Transform in zwei Zerlegungen; die
beiden als „180° gedreht" erkannten ebenfalls — und sie liegen exakt 180° von
den richtigen entfernt. Beide Paare wurden unabhängig voneinander vergeben.

### Was falsch war

**Der Kindversatz.** Er lief nach `+parent.length`, richtig ist
`−parent.length`. Alle vier als brauchbar erkannten Zellen tragen dieses
Vorzeichen, keine der 46 übrigen.

Damit hatte Kujata mit `[0, 0, −parentBone.length]` von Anfang an recht — und
die frühere Messung „Kujatas Versatzvorzeichen verschlechtert unsere
Aufrechtigkeit durchgehend" war ein weiterer Artefakt der blinden
Gütefunktion, kein Befund.

Der Wurzelwinkel `ROOT_FRAME_FIX_DEG = −90` war bereits richtig; die
Versatzreihenfolge (entlang der **Eltern**-Achse) ebenfalls.

### Nachweis

- **Numerisch:** Die Produktionskette (`computePose(…, rootFrameFix = true)`
  plus ADR-009-Basis) reproduziert wurzelrelativ exakt Konfiguration #15.
  Verglichen wird wurzelrelativ, weil die Tafel ohne Wurzeltranslation
  rechnet — die Aussage lautet „gleiche Form, gleiche Lage zur Wurzel".
- **Gegen Überanpassung:** Drei **weitere** Modelle, je in Front-, Seiten- und
  Draufsicht, durch dieselbe Produktionskette gerendert. Alle stehen aufrecht,
  Segmente sitzen zusammen, das Profil stimmt.

### Die Bilanz der Messversuche

| Anlauf | Gütefunktion | Ergebnis |
|---|---|---|
| 1 | Y ist längste Achse | blind unter 180° |
| 2 | dito über 6 Eulerreihenfolgen | Fehler außerhalb des Suchraums |
| 3 | Anteil über dem Pivot | Wurzel sitzt in der Hüfte ⇒ Median ~0,5 |
| 4 | Breite oben/unten | Signal im Rauschen (0,96…1,03) |
| 5 | **50 Bilder, ein Auge** | **entschieden, in Minuten** |

Vier Aggregatmaße haben dieselbe Frage viermal nicht beantwortet, und jedes
hat dabei überzeugend ausgesehen. Die Lehre für dieses Projekt ist nicht
„besser messen": **Für Fragen nach einer Richtung im Raum ist die Sichtprüfung
kein Notbehelf, sondern das schärfere Instrument.** Der Beitrag der Automatik
lag darin, den Suchraum vollständig aufzuspannen und darstellbar zu machen —
nicht darin, ihn zu bewerten.

### Offen bleibt

- **B7** ist widerlegt in seiner bisherigen Form: Der Wurzelpivot liegt **in
  der Hüfte**, nicht am Bodenkontaktpunkt. Der Höhenversatz zum Walkmesh muss
  also anders bestimmt werden.
- Die Abbildung der **Wurzeltranslation** ist weiterhin nicht belegt — sie
  verschiebt Figur und Pivot gemeinsam und ist damit für jede Sichtprüfung
  UND jedes formbasierte Maß unsichtbar. Sie braucht den Bodenkontakt als
  Referenz.

---

## B5/B6 entschieden — dieselbe Methode, zweiter Durchgang

Tafel mit 26 unabhängigen Fällen (`texture-sheet.rdtest.ts`), Urteile des
Betreibers am eigenen Bestand:

| Annahme | Ergebnis | Belegdichte |
|---|---|---|
| **B5** Palettenreihenfolge | **BGRA** | 4 Texturen einstimmig; 12/12 Alternativen als falsche Farbe |
| **B6a** Vertexfarben | **BGRA** | 2 Modelle einstimmig |
| **B6b** UV-Ursprung | **roh, kein Flip** | genau 1 von 4 Kombinationen richtig |

### Zwei Fehlgriffe beim Prüfgegenstand — dieselbe Ursache

Beide Male war nicht die Frage falsch, sondern das, woran sie gestellt wurde:

1. **Ein Effektsprite für die Farbfrage.** Bei einer Flamme ist cyan als Wasser
   so plausibel wie rot als Feuer. Der Betreiber hat diese eine Textur denn
   auch viermal offengelassen — die Mehrdeutigkeit war real und nicht mein
   Fehlurteil. Behoben durch vier Texturen aus figürlichen Modellen.
2. **Ein rotierendes Objekt für die Ausrichtungsfrage.** In den Worten des
   Betreibers: „dieses Modell rotiert sich im Spiel, an sich ist aber die
   Textur richtig." An einem rotierenden Objekt kann keine Ausrichtung falsch
   sein. Behoben durch ein Modell mit eindeutiger Oberseite.

Auswahlkriterium war beide Male „viel Textur" statt „trägt die Frage". Das ist
die **dritte Ausprägung des Kontrollversagens** neben blinder Gütefunktion und
falschem Suchraum: **Der Prüfgegenstand trägt die gesuchte Information nicht.**
Eine Tafel, die so entsteht, sieht vollständig aus und ist trotzdem leer.

---

## Streifen über den Augen — zwei Ursachen, die gleich aussehen

Nachdem die Augen erschienen, blieb ein Streifenmuster über ihnen. Zwei
Erklärungen kamen in Frage, und sie erzeugen **dasselbe Bild**:

1. **Fehlende Transparenz.** Der Aufkleber malt sein volles Rechteck.
2. **Tiefenstreit koplanarer Flächen.** Aufkleber und Gesicht liegen exakt
   aufeinander; wer je Pixel gewinnt, entscheidet der Rundungsfehler.

Beide gleichzeitig zu beheben hätte die Antwort verdeckt: Es wäre besser
geworden, ohne dass feststünde, warum — und die falsche Erklärung wäre als
Formatfakt eingetragen worden. Die Tafel `tex-transparenz-sheet` zeigt deshalb
jede Ursache **einzeln** (M1..M4). Das Ergebnis trennt sauber:

| Zelle | Änderung | Bild |
|---|---|---|
| M1 | keine | schwarzes Rechteck über dem Auge, **in Streifen zerlegt** |
| M2 | nur Transparenz | Rechteck weg, aber **das Auge selbst streift** |
| M3 | nur Aufkleber-Versatz | Auge sauber, sitzt in **schwarzem Rechteck** |
| M4 | beides | **korrekt** |

Also: Die **Streifen** kommen vom Tiefenstreit, das **schwarze Rechteck** von
der fehlenden Transparenz. Es waren nie Alternativen, sondern zwei Mängel
übereinander — M2 und M3 sehen jeder für sich wie ein Fortschritt aus und sind
doch beide falsch. Hätte ich beide Änderungen zusammen vorgenommen, wäre genau
das unbemerkt geblieben.

### Die Transparenzregel steht in der Datei (🟢, 695/695)

`tex-alpha-probe` misst, statt zu übernehmen:

| Befund | Zahl |
|---|---|
| Kopfschalter 0x08 == 1 ⟺ Paletteneintrag 0 trägt A = 0 | **695/695, null Widersprüche in beide Richtungen** |
| Texel, die nur die Alpharegel entfernt | **0** — echte Teilmenge von „Index 0" |
| Texel, die nur die Faustregel „Index 0" entfernt | 7,7 % — in den 68 Dateien, in denen Index 0 eine gewöhnliche Farbe ist |
| Texturen mit gemischtem Alpha | 640/695 |
| gewählte Aufkleber: durchsichtiger Flächenanteil | 98 %, 98 %, 94 % |

Zwei unabhängige Felder derselben Datei sagen dasselbe. **Gleiche Anzahlen
allein wären Zufall gewesen — deshalb die Kreuztabelle über die Dateien, nicht
der Vergleich der Summen.** Ausgewertet wird das Palettenalpha, weil es die
feinere Angabe ist (8 Dateien führen 63…142 durchsichtige Einträge) und weil
die pauschale Regel messbar zu viel entfernt.

**Die Falle, gegen die geprüft wurde:** Wäre A = 0 ein ungenutztes, überall
genulltes Feld gewesen, hätte die Regel jede Textur unsichtbar gemacht. Genau
deshalb misst die Probe, wie viel jede Regel entfernt, und nicht nur, ob sie
plausibel klingt.

### Der Tiefenvorzug bleibt 🟡

Dass die **texturierten** Teilnetze die Aufkleber sind, ist gemessen (626 von
4710 Teilnetzen texturiert, 13,3 %; 187 Ressourcen mit genau drei Texturen =
Gesicht plus zwei Augen) — aber es ist eine **Bauformregel und kein Datum der
Datei**. Ein texturiertes Teilnetz, das kein Aufkleber ist, bekäme den Vorzug
ebenfalls. Bei dieser Versatzgröße folgenlos, aber es bleibt eine Annahme und
wird als solche geführt.

---

## O4-Bilanz (2026-08-10) — der Posten ist FAST, aber nicht ganz erledigt

Anlass: [ROADMAP-OFFENE-POSTEN.md](ROADMAP-OFFENE-POSTEN.md) führte O4 noch als
„⏳ unverändert (braucht ein Auge)", während die README R4 als gelöst meldet und
dieses Dokument mehrere Teillösungen und **eine Rücknahme** enthält. Der
Widerspruch ist hier aufgelöst; die Merkzettel-Tabelle oben ist nachgeführt.

### Ergebnis

| Klasse | Posten |
|---|---|
| ✅ **entschieden (6)** | B1 (Kindversatz −len), B2 (YXZ, 3209/3209 aus dem Dateikopf), B5, B6a, B6b (Sichtprüfung), B8 (Modelldateifeld), B9 (695/695) |
| 🟡 **belastbar, aber unbelegt (3)** | B3 (nur eingegrenzt: Wurzel verursacht das Kippen nicht — welche Hälfte welche ist, steht nicht fest), B4 (indirekt durch die B1-Tafel gestützt, nie gezielt gemessen), B10 (Bauformregel) |
| ❌ **widerlegt, ohne Ersatz (1)** | **B7** — der Wurzelpivot liegt in der Hüfte, nicht am Bodenkontaktpunkt |

**Die acht Sichtprüfungen B1–B8, um die es O4 ging, sind also durchgeführt.**
Was O4 nicht geliefert hat, ist ein *Ersatz* für die dabei widerlegte Annahme
B7 — und den kann keine Sichtprüfung liefern.

### Warum B7 nicht per Auge zu schließen ist

Die Wurzeltranslation verschiebt **Figur und Pivot gemeinsam**. Für eine
Sichtprüfung ist sie damit unsichtbar: Das Bild sieht bei jedem Versatz gleich
aus. Dasselbe gilt für jedes formbasierte Aggregatmaß. Das ist exakt die
**blinde Gütefunktion** aus der Bilanz der fünf Messanläufe — nur diesmal
gegenüber dem Auge statt gegenüber einer Kennzahl.

Ein tragfähiger Test braucht deshalb eine **externe Referenz**: den
Bodenkontakt. Konkret die Frage, ob die Füße eines Feldmodells in einem Field
mit bekannter Walkmesh-Höhe auf der Ebene stehen, oder ob ein konstanter
Versatz bleibt — und ob dieser Versatz je Modell konstant oder eine Funktion
des Skeletts ist. Das ist eine Messung an der Field-Integration, kein Bild.

### Restrisiko, solange B7 offen ist

Figuren können im Field systematisch zu hoch oder zu tief stehen. Der Fehler
ist **konstant** (kein Zucken, kein Driften) und fällt deshalb bei einer
Einzelansicht kaum auf — er wird erst an einer Kante sichtbar, an der die
Figur den Boden verlässt oder in ihn eintaucht. Zielsession: zusammen mit der
Wurzeltranslation.
