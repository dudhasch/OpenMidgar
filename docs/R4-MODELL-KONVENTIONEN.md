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

## Offene Semantik-Annahmen (🟡, je genau EINE Codestelle)

| # | Annahme | Ort | Validierung |
|---|---|---|---|
| B1 | Bone-Längsachse = lokales +Z; Kindversatz T(0,0,parentLength); Längen im Bestand negativ ⇒ Kette wächst nach −Z | `render-actor/pose.ts`, `actor.ts` | Sichtprüfung echtes Modell (aufrechte Figur) |
| B2 | Eulerreihenfolge **'YXZ'** (R = Ry·Rx·Rz), Winkel in Grad | `pose.ts EULER_ORDER` | „Bekannte Pose"-Vergleich gegen Original-Screenshot |
| B3 | 24 Wurzel-Bytes je Frame: **Rotation vor Translation** | `formats-model/anim.ts` | dito — vertauschte Deutung fiele durch springende Figuren auf |
| B4 | Frames adressieren Bones in **Dateireihenfolge** | `pose.ts`/`actor.ts` via `fileOrder` | Skelett mit ungleichen Kettenlängen sichtprüfen |
| B5 | Palettenblock **BGRA** | `tex.ts`, `model-writers.ts` | Referenzbild (bekannte Farbfläche) |
| B6 | Vertexfarben BGRA; UV-V-Ursprung/flipY ungeprüft | `p.ts`, `actor.ts` | texturiertes Realmodell |
| B7 | Wurzelpivot am Walkmesh-Kontaktpunkt; Höhenversatz kommt aus rootTranslation der Animation | Demo/`actor.ts` | Bodenkontakt echter Modelle |
| B8 | Field-Skalierungsfaktor als Modell-Divisor noch NICHT angewendet | — | bei Field-Integration (S11) |

## Stand nach S10 (2026-08-09)

Die Voraussetzung für B1–B4 ist geschaffen, die Sichtprüfung selbst steht noch aus.

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
