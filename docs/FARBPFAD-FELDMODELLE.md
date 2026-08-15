# Farbpfad der Feldmodelle — was das Original tut

**Datum:** 2026-08-15 · **Grundlage:** [ADR-028](ADR-028-EIGENE-CODEANALYSE.md)
(eigene Codeanalyse der PC-EXE, ohne Auflagen freigegeben) · **Quelle:** die
eigene Ghidra-Analyse von `ff7_en.exe` samt der Notizensammlung unter
`decomp/` — genau der Bestand, den ADR-028 benennt

Dieses Dokument hält fest, wie im Original aus einer `.p`-Datei und einer
`.tex`-Palette ein Pixel wird — und an welchen Stellen unsere Umsetzung davor
danebenlag.

Jede Aussage nennt die Funktion, aus der sie stammt. Das ist seit ADR-028
**keine Auflage mehr**, sondern gute Praxis: Der Quellvermerk ist der Beleg,
dass nachgebaut und nicht übersetzt wurde — übernommen sind Verhaltenstatsachen
(Formeln, Konstanten, Reihenfolgen, Feldbedeutungen), kein Quelltext.

Was **nicht** entfällt, ist die Beweisklassenordnung: Eine Aussage aus dem
Bestand bleibt 🟡, bis eine Gegenprobe an unseren Daten sie trägt. ADR-028 führt
das ausdrücklich als „Arithmetik, keine Regel" — der Bestand beziffert seine
eigene Fehlerquote mit 131 Defekten und hält fest, dass sein **Fließtext** etwa
zur Hälfte falsch war, wo die Codeblöcke daneben stimmen.

> Dieser Farbpfad ist ein Beleg dafür. Der Fließtext nennt als Divisor der
> Lichtrichtung 360; im Abbild steht an der benutzten Stelle 4096 (§ 2.2).
> Genau deshalb steht hinter jeder Zahl hier entweder eine Messung an unseren
> Daten oder ein 🟡.

---

## 1. Die Kette in einem Satz

Das Original ist eine **reine 8-Bit-Kette ohne Gammastufe**: Vertexfarbbyte mal
Beleuchtungsintensität mal Texelbyte, das Ergebnis unverändert in den
Bildspeicher.

```
.p Vertexfarbe (D3DCOLOR 0xAARRGGBB)
      │
      ├─ RGB unverändert übernommen        (D3D5BuildVertexArray, 0x006A37F5)
      └─ Alpha überschrieben mit p_hundred+0x5C
                                            (ApplyGlobalColorModulate, 0x006A3BEE)
      │
      ×  Intensität  I = ambient + Σ_L Farbe_L · (Richtung_L · n_welt)
                                            (Gfx_LightVertexDiffuse, 0x0068DAE1
                                             bzw. FUN_0068DD1E)
      │
      ×  Texel                              (D3DTBLEND_MODULATE, gesetzt von
                                             D3D5ApplyRenderState, 0x006A3D30)
      │
      →  Bildspeicher, ohne Umkodierung
```

---

## 2. Die Befunde, die unsere Darstellung verändert haben

### 2.1 Die Ausgabe wurde aufgehellt (größter Einzelbetrag)

Das Original kennt an keiner Stelle eine Gammastufe. three ab r152 hat
`outputColorSpace = sRGB` als Vorgabe und **kodiert** beim Schreiben ins Bild.
Gemessen in `colorprobe.html`: ein Pixel, der `[125, 63, 31]` sein müsste, kam
als **`[186, 136, 98]`** heraus. Das betraf jedes Pixel, Modelle **und**
Hintergrund.

→ `FieldCompositor` stellt den Renderer jetzt auf `LinearSRGBColorSpace` und
`NoToneMapping` (`configureOriginalColorPipeline`).

### 2.2 Die Beleuchtung stand auf dem Kopf

Bisher: eine frei gesetzte Lambert-Hypothese
`farbe · clamp(ambient + Σ max(0, n·l̂) · c)` mit einem erfundenen Deckel
`min(1.25, …)`, gebacken einmal beim Bau, im Modellraum, mit **unnegierter,
normierter** Richtung.

Das Original (`Field_InstantiateModels` 0x0063E4EB → `Gfx_CreateLightSet`
0x0069CA53 → `ApplyLightSet` 0x0069C69F → `FUN_0068DD1E`) rechnet anders, in
fünf Punkten:

| | Original | vorher bei uns |
|---|---|---|
| Richtung | `−roh / 4096`, danach in die Feldlichtbasis `(x,y,z) → (x, z, −y)` gedreht | roh, nicht negiert, keine Basis |
| Betrag | **unnormiert** — der Betrag ist Teil der Helligkeit | normiert |
| Summation | **vorzeichenbehaftet**, kein `max(0, n·l)` je Licht | je Licht bei 0 abgeschnitten |
| Raum | Normale im **Weltraum** des Bones, je Bone und Bild neu | Modellraum, einmalig gebacken |
| Untergrenze | Intensität wird auf die **Umgebungsfarbe** angehoben | implizit, wegen des Abschnitts je Licht |
| Deckel | nur `min(farbe · I, 255)` | zusätzlich `min(1.25, I)` — erfunden |

**Zum Divisor 4096.** Der Fließtext der Notizensammlung nennt hier 360; das ist
der Divisor des benachbarten Skalenfeldes. Im Abbild steht an der benutzten
Stelle `0x45800000` = **4096.0f**. 🟢 **Gegenprobe an unseren Daten bestanden:**
über alle 5454 Modellblöcke liegt der Median der Vektorbeträge bei 4108,5
(IQR 9,2; 96,4 % innerhalb ±10 %) — auf 4096 normierte Vektoren. Zwei
unabhängige Quellen, derselbe Wert.

**Zur Untergrenze.** Es gibt zwei Vertexkerne. `Gfx_LightVertexDiffuse`
(0x0068DAE1) schneidet die Intensität bei 0 ab, `FUN_0068DD1E` bei der
Umgebungsfarbe. Welcher läuft, entscheidet das Kartenfeld
`g_FieldModelNoShadow`: `Field_InitMapConfigTable` (0x0060EFF9) setzt es für
alle 1200 Karten auf 0 und danach für genau **12** Karten (Liste bei
0x00905AE0) auf 1. Der Regelfall — **1188 von 1200 Feldkarten** — ist damit die
Variante mit Umgebungs-Untergrenze.

### 2.3 FLAT-Gruppen wurden als Gouraud gerendert

Der Renderstate-Block je Gruppe führt auf `+0x24` einen Schattierungsmodus
(`D3DSHADE_FLAT` 1 / `D3DSHADE_GOURAUD` 2), den `D3D5ApplyRenderState` je Gruppe
ausgibt; `Pfile_BuildHundredFromMaterial` (0x00694E05) leitet ihn aus der
Materialklasse ab: Klassen **G (1)** und **H (4)** → GOURAUD, Klassen
**C (0), T (2), D (3)** → FLAT. Unser Parser hat die 100-Byte-Blöcke bis dahin
komplett übersprungen und alles Gouraud interpoliert.

🟢 **Gegenprobe an unseren Daten bestanden**
(`tools/realdata-scan/src/model-shading-probe.rdtest.ts`, gemessen über alle
**4180** `.p`-Einträge von `char.lgp`):

| Frage | Messung |
|---|---|
| Blöcke je Gruppe | **4180/4180** genau einer, null Abweichungen |
| Werte auf `+0x24` | ausschließlich 1 und 2 — es ist wirklich ein Schattierungsmodus |
| Block ≡ Materialklasse | **4875/4875 einig, 0 uneinig** — die Behauptung „bauartbedingt gleich" ist jetzt gemessen, nicht übernommen |
| flache Gruppen | **754** von 4875 (15,5 %) |
| davon texturiert | **687** — von 695 texturierten Gruppen sind also 687 flach |

Bei Feldfiguren trifft das damit fast genau die aufgeklebten Gesichtsteile:
**687 der 695 texturierten Gruppen** des Bestands wurden bisher falsch
schattiert. Nur 8 texturierte Gruppen sind echt Gouraud.

Der Blendmodus fällt bei derselben Messung mit ab — **4852× Modus 4**, dazu
10× 0, 2× 1, 11× 3. Das sind Zahl für Zahl dieselben Werte, die das Dekompilat
für `char.lgp` nennt: zwei unabhängige Wege, dasselbe Ergebnis.

**Umsetzung.** Statt den Schattierungsmodus im Shader nachzubauen, backt der
Parser die Folge in den Vertexstrom: bei FLAT-Gruppen tragen alle drei Ecken
eines Dreiecks **Farbe und Normale der ersten Ecke**, die Position bleibt je
Ecke echt. Das Ergebnis ist über das Dreieck konstant, also dasselbe wie
`D3DSHADE_FLAT` — und umgeht den `flat`-Qualifizierer, der in GL die *letzte*
Ecke nähme, wo Direct3D die *erste* nimmt.

Gelesen wird `p_hundred+0x24`, **nicht** die Materialklasse: für
`p_group+0x00` ist kein Leser zur Laufzeit belegt. Im Bestand stimmen beide
bauartbedingt überein (16.177/16.177 Meshes tragen genau einen Block je
Gruppe, in gleicher Reihenfolge).

### 2.4 Das Vertexalpha gehörte nicht ins Bild

`ApplyGlobalColorModulate` überschreibt das Alphabyte jedes Vertex mit
`p_hundred+0x5C`; für `char.lgp` ist das in **4852 von 4875** Blöcken 255. Das
in der Datei stehende Vertexalpha erreicht das Gerät also nie. Wir luden es als
vierte Komponente hoch, wo three es auf die Fragmentdeckkraft multipliziert —
Vertices mit kleinem Alpha blichen aus, die im Original voll deckend sind.

→ Das Farbattribut ist jetzt dreikomponentig.

*(Namenskorrektur: `+0x5C` heißt in älteren Notizen „alphaRef". Das ist falsch —
der Zeichenzeit-`ALPHAREF` sitzt auf `+0x40` und ist in allen 17.808
ausgelieferten Blöcken 0.)*

### 2.5 Bestätigt, nicht geändert

Zwei Verdachtsmomente haben sich **nicht** bestätigt, und das ist ein Befund:

- **Keine Halbskala.** Es gibt im PC-Build weder eine Verdopplung (`×2`) noch
  die von PSX-Pipelines bekannte 128-=-1,0-Konvention. Das RGB wird „ohne
  Multiplikation, Skalierung, Gamma oder Vormultiplikation" übernommen.
- **BGRA war richtig.** `polygon_data+0x50` führt einen `D3DCOLOR`
  (`0xAARRGGBB`); little-endian ist das genau die Bytefolge B, G, R, A. Unsere
  sichtgeprüfte Auslegung ist damit auch aus dem Code belegt.

---

## 2.6 Sichturteil und der Befund daneben (Rückmeldung 2026-08-15)

Die Sichtprüfung an `corel2` #7 (`beec.hrc`) fiel auf allen Farbachsen positiv
aus — Helligkeit, Farbton, Lichtrichtung, Gesicht, Texturen, Kanten je „passt",
beste Variante **linear + Original-Kern**. Der Farbpfad gilt damit als
sichtbestätigt.

Der Befund daneben betraf die Gelenke: „Knie und Übergänge zwischen Bones
überschneiden sich scharf." Zwei Messungen dazu
(`tools/realdata-scan/src/joint-overlap-probe.rdtest.ts`):

- **Bauartbedingt, nicht unser Fehler.** Feldmodelle sind starr segmentiert
  (je Bone ein `.p`, kein Skinning — `Anim_DrawSkeletonFrame` zeichnet jedes
  Teil mit der Matrix SEINES Bones, ohne Mischung). Gemessen über alle **4060**
  Bone-Meshes ragt die Geometrie im Median **18,9 %** über die eigene Bonelänge
  hinaus, im oberen Zehntel 73,7 % — und **81,9 %** aller Bone-Meshes sind
  länger als ihr Bone. Die Überlappung ist also *hineinmodelliert*, damit
  Gelenke beim Beugen gefüllt bleiben. Beispiel `beec.hrc`, Bone `dou1`:
  Bonelänge 5,05, Meshtiefe 8,24.
- **Ein echter Fehler steckte trotzdem darin.** Der Aufkleber-Tiefenvorzug
  traf bis dahin *jedes* texturierte Submesh. Von 626 texturierten sind 618
  flach (echte Aufkleber) und **8 Gouraud** — texturierte Körpergeometrie in
  `avia`, `avjb`, `bydf`, `byee`, `hjgc`, `hjgf`, `hrda`, `hrdf`, die dadurch
  vor ihre Nachbarsegmente gezogen wurde. Die Regel lautet jetzt
  `textured && flatShaded`. `beec.hrc` ist nicht betroffen, der Sichtbefund
  hatte also eine andere Ursache als dieser Fehler.

## 2.7 Blendmodi angeschlossen

`p_hundred+0x44` wird nicht mehr nur mitgeführt, sondern ausgewertet.
`Pfile_SetHundredBlendMode` (0x00694C80) setzt je Modus ein Faktorenpaar **und**
das erzwungene Vertexalpha `+0x5C`, das `ApplyGlobalColorModulate` danach in
jeden Vertex schreibt — weil dieses Alpha je Gruppe konstant ist, trägt es bei
uns `opacity`:

| Modus | src / dest | Alpha | three |
|---|---|---|---|
| 0 | SRCALPHA / INVSRCALPHA | 0x80 | `NormalBlending`, Deckkraft 128/255 |
| 1 | SRCALPHA / ONE | 0x80 | `AdditiveBlending`, Deckkraft 128/255 |
| 2 | INVSRCCOLOR / ONE | 0xFF | `CustomBlending`, `OneMinusSrcColor` / `One` |
| 3 | SRCALPHA / ONE | 0x40 | `AdditiveBlending`, Deckkraft 64/255 |
| 4 | ONE / ZERO | 0xFF | deckend (unverändert) |

🟢 **Am Bestand gemessen:** 4852 der 4875 Blöcke sind Modus 4. Die 23 übrigen
(10× Modus 0, 2× Modus 1, 11× Modus 3, **kein** Modus 2) liegen in 23
verschiedenen Dateien, je als Gruppe 0 oder 1 — unter anderem `ancd`, `hbca`,
`ggif`, `ggje`, `haha`, `fibc`. Modus 2 ist im Feldbestand unbelegt und bleibt
Vorsorge.

**Eine Falle steckte darin.** Unser `alphaTest` vertritt den Farbschlüssel, und
three prüft ihn gegen `opacity · Texelalpha`. Bei Modus 3 läge das Produkt
(0,25) unter der festen Schwelle 0,5 — **jedes** Fragment wäre verworfen und die
Gruppe unsichtbar geworden. Die Schwelle wandert deshalb mit der Deckkraft; das
Texelalpha ist binär, die halbe Deckkraft trennt beide Fälle sauber. Ein Test
hält den Fall fest.

`depthWrite` bleibt an: Das Original schaltet ZWRITEENABLE nie ab, und die Modi
0…3 sind dort keine Sortierklasse, sondern nur ein anderes Faktorenpaar in
derselben Zeichenreihenfolge.

## 3. Was offen bleibt

- **Texturfilter — die einzige offene Renderfrage.** Wir tasten punktgenau ab.
  `D3D5ApplyRenderState` setzt unter Maskenbit `0x4` `D3DFILTER_LINEAR`, und
  Bit `0x4` steht in jedem texturierten Block — nur enthält die `changedMask`
  der Blöcke (0x20002) dieses Bit **nicht**. Der Filter wird also vom Block nie
  ausgegeben; es gilt der globale Gerätezustand, und der ist nicht vermessen.
  Zusätzlich erzwingt das Original Nearest, sobald `forceSoftwareDevice` steht.
  Die Messung kann das nicht entscheiden, deshalb steht es als Schalter in
  `farbcheck.html` (Variante „Texturfilter"), sichtbar vor allem an Augen und
  Mund.
- **Farbschlüssel.** Das Original schaltet die Durchsichtigkeit über
  `COLORKEYENABLE` beim Texturbinden, nicht über einen Alphatest — bei
  deckenden Blöcken wird `ALPHATESTENABLE` nie ausgegeben. Unser `alphaTest`
  über das Palettenalpha ist ein Stellvertreter; er deckt sich mit unserem
  eigenen Realdatenbefund (das Kopffeld 0x08 stimmt in 695/695 Dateien mit
  „Paletteneintrag 0 trägt Alpha 0" überein), ist aber nicht derselbe
  Mechanismus.
- **Kampfmodelle.** Alles hier Beschriebene ist am Feldpfad gemessen. Der
  Kampfpfad teilt zwar `buildMeshObject`, übergibt aber kein Licht — dort ist
  die Beleuchtung noch gar nicht angeschlossen.

---

## 4. Gegenprobe

`apps/demo/colorprobe.html` rendert ein Fixture-Modell durch **denselben** Pfad
wie ein echtes Feldmodell und vergleicht zurückgelesene Pixel mit der auf der
CPU nachgerechneten Erwartung. Keine Originaldaten nötig. Zu jeder Zelle gehört
eine Kontrolle, die fehlschlagen muss, wenn die geprüfte Regel wirkungslos wäre
— unter anderem die Gegenüberstellung linear/sRGB aus 2.1.
