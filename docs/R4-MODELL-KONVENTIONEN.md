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
| B8 | Field-Skalierungsfaktor (Triggersektion) als Modell-Divisor noch NICHT angewendet | — | bei Field-Integration (S8+) |

## Nächste Schritte

1. Model-Loader-Sektion (Field-Sektion 3) parsen → echte hrc↔a-Paarungen,
   dann B1–B4 an einem Referenzmodell (aufrechte Idle-Pose) sichtprüfen.
2. B5/B6 über ein texturiertes Modell mit bekannter Farbverteilung prüfen.
3. Renderstate-Blöcke (100 B): abgesicherte Flags (Blend/Cull/Lit) mappen —
   bisher roh konserviert.
