# Lage der Feldmodelle — Umlaufsinn und Blickrichtung

**Datum:** 2026-08-16 · **Grundlage:** [ADR-028](ADR-028-EIGENE-CODEANALYSE.md) ·
**Anlass:** Rückmeldung „Gesicht sieht falsch aus", zusammen mit dem Hinweis auf
eine gespiegelte Basismatrix

Zwei Defekte, die sich gegenseitig verdeckt haben. Beide sind behoben; die
vermutete Ursache war es **nicht**.

---

## 0. Was NICHT die Ursache war

Die Meldung nannte eine fehlende Negation in der Basis: Ein Port schreibe
`(x, y, z) → (x, z, y)`, das habe `det = −1`, spiegele und erkläre beide
Symptome auf einmal.

**Bei uns nicht der Fall.** `packages/convert/src/ff7-to-scene.ts` bildet
`(x, y, z) → (x, z, −y)` ab; als Spalten `(1,0,0)`, `(0,0,−1)`, `(0,1,0)`, also
**det = +1**. Die Negation ist da, ADR-009 macht diese Datei zur einzigen
Stelle, an der Achsen getauscht werden dürfen, und es gibt im ganzen Baum kein
`frontFace`, kein `side`, kein `DoubleSide` und kein `flipY` auf Modelltexturen.

Die Symptome waren echt — die Ursache lag woanders, und zwar an zwei
unabhängigen Stellen.

---

## 1. Umlaufsinn: Vorderseite im Uhrzeigersinn

**Original.** Die Vorderseite ist im **Uhrzeigersinn**, die Rückseite wird
weggeschnitten. Im GL-Zweig gesetzt über `cfg[0] = 1` in
`Gl_InitConfigDefaults` (0x006A6AE6; Bytes bei 0x006A6AFA
`C7 01 01 00 00 00`), im D3D-Zweig über `D3DRENDERSTATE_CULLMODE = D3DCULL_CW`.

**three** erwartet die Vorderseite **gegen** den Uhrzeigersinn.

**Folge.** Unser `.p`-Parser gab die Ecken in Dateireihenfolge 0, 1, 2 aus. Die
Rückseitenentfernung behielt damit die falsche Hälfte — sichtbar als „das
Gesicht scheint durch den Hinterkopf".

**Behebung.** Eine Zeile in `packages/formats-model/src/p.ts`: Die Ecken werden
als **0, 2, 1** ausgegeben. Das gehört an die Daten, nicht in den Renderzustand
— `frontFace(CW)` oder `side: DoubleSide` erzeugen dasselbe Bild, verstecken
aber die Ursache und liefern jeder späteren Flächennormalen-, Kollisions- oder
Exportrechnung das falsche Vorzeichen. Ecke 0 bleibt vorn, damit die
FLAT-Schattierung weiterhin deren Farbe und Normale nimmt.

> **Sichtbestätigt** (Rückmeldung 2026-08-16): Vor der Behebung wurden
> `BackSide` und `DoubleSide` als richtig und `FrontSide` als falsch bewertet —
> genau die Signatur eines umgekehrten Umlaufsinns. Nach der Behebung stimmt
> `FrontSide`, und `DoubleSide` wird nicht mehr gebraucht.

---

## 2. Blickrichtung: das Vorzeichen, nicht der Versatz

**Original**, zwei unabhängig aus dem Abbild gelesene Stücke:

1. **Kurs 0 ist −Y.** `Field_StepEntityOnWalkmesh` (0x00636C41) bildet den
   Schritt als `(+sin(h)·sx, −cos(h)·sy)`; das `NEG EAX` bei 0x00636FBE sitzt
   allein auf dem Kosinus-/Y-Term. Die Tabelle bei 0x00908E30 ist stride-4
   `{sin, cos}` — Eintrag 64 (90°) liest `(+4096, 0)`, Eintrag 0 liest
   `(0, +4096)`. Kurs 0 ergibt `(0, −Schritt)`.
2. **Gedreht wird um +Kurs.** `BuildRotationZColVec` (0x0067BFE6) schreibt
   `m[0]=cos, m[1]=−sin, m[4]=sin, m[5]=cos` — eine gewöhnliche Linksdrehung.
   Der Feldzeichenpfad reicht den Kurs direkt hinein und addiert **keinen**
   Versatz.

**Vorher bei uns.** `setActorFacing` drehte um `−(Blickrichtung + Versatz)` mit
einem per Auge kalibrierten Versatz von −90°. Das Minus kehrt die Abbildung
Winkel → Weltrichtung um. Der Actor blieb dabei eine echte Drehung (det = +1,
nichts war gespiegelt), aber das Ergebnis war:

| Blickrichtung | Soll | vorher |
|---|---|---|
| 0 (+X) | +X | +X ✓ |
| 180 (−X) | −X | −X ✓ |
| 90 (+Y) | +Y | **−Y** ✗ |
| 270 (−Y) | −Y | **+Y** ✗ |

„Hoch und runter vertauscht, links und rechts richtig" — **kein additiver
Versatz kann das heilen**, nur das Vorzeichen.

**Behebung.** `+(Blickrichtung + 90°)`. Der Versatz ist jetzt hergeleitet statt
kalibriert: Unsere Blickrichtung zählt ab +X (`richtungGrad`, `atan2(dy, dx)`),
das Original ab −Y, also `Kurs = Blickrichtung + 90°`; die Modellvorderseite ist
Modell-−Y.

---

## 3. Warum kein Test das gefunden hat

`render-actor.test.ts` prüfte die Blickrichtung, indem es die Referenz aus
**derselben Formel** baute, die es prüfen sollte (`−(grad + Versatz)`) — eine
Tautologie. Sie blieb grün, während +Y und −Y vertauscht gerendert wurden.

Ersetzt durch zwei Zellen, die **Weltrichtungen** nennen statt Formeln: alle
vier Himmelsrichtungen einzeln, plus eine Gegenprobe, die festhält, dass 90 und
270 entgegengesetzt sein müssen. Dazu ein Test auf den Umlaufsinn, der über das
Vorzeichen des Kreuzprodukts prüft und nicht über die Eckreihenfolge allein —
sonst zöge ein Rückbau die Erwartungen einfach mit.

---

## 4. Offen

- ~~**`OP.DIR` (0xB3) rechnet nicht um.**~~ **Behoben** — siehe § 5.
- **Rotationsreihenfolge wird gelesen, aber nicht benutzt.** `anim.ts` parst
  das Tripel aus dem `.a`-Kopf und exportiert es; der Renderer verdrahtet
  `YXZ` fest. Im Bestand tragen alle 3209 Dateien `[1,0,2]` = YXZ, es ist also
  folgenlos — aber es ist die Sorte Festverdrahtung, die genau dann bricht,
  wenn jemand eine Moddatei einspielt.
- **Zur Meldung selbst:** Zwei ihrer Prämissen treffen den heutigen Bestand
  nicht. `field-module.md` sagt inzwischen **selbst** „Kurs 0 = −Y" und zieht
  die +X-Lesart ausdrücklich zurück (Zeilen 594–596, Korrektur [R9] in Zeile
  1651). Und die Trigonometrie-Helfer sind **richtig** benannt:
  `Field_ByteAngleSin` (0x006364EB) liest `+0`, `Field_ByteAngleCos`
  (0x00636500) liest `+2`. Die Schlussfolgerung stimmt trotzdem — nur die
  Begründung zielt auf einen älteren Stand des Dossiers.

---

## 5. `OP.DIR` (0xB3): Byte-Winkel, nicht Grad

**Original, im Abbild nachgelesen.** `Script_OpSetDirection` (0x00618062) liest
den Operanden mit `Script_ReadOperand8` und legt ihn **unverändert als `char`**
in `model+0x38` ab; die Drehzustandsbytes `+0x3A`/`+0x3B` werden dabei
genullt. Keine Umrechnung, keine Skalierung.

Die Feldentität führt **zwei** Winkel im selben Maß:

| Offset | Feld | Bedeutung |
|---|---|---|
| `+0x36` | `heading` | Bewegungsrichtung |
| `+0x37` | `lockFacing` | ≠ 0: `displayHeading` folgt `heading` **nicht** |
| `+0x38` | `displayHeading` | **das, wonach das Modell gedreht wird** |

`displayHeading` ist im Regelfall an `heading` gekoppelt, teilt also dessen
Einheit und Nullpunkt: **256 Schritte auf den Vollkreis, 0 = −Y**
(`0x40` = +X, `0x80` = +Y, `0xC0` = −X). `FieldModel+0x1C` übernimmt genau
dieses Byte.

**Vorher bei uns.** `vm.ts` legte den Rohwert als Grad ab
(`((value % 360) + 360) % 360`). Zwei Fehler in einem: der Kreis war auf
256/360 gestaucht, und der Ursprung lag 90° daneben. Betroffen war jede Figur,
deren Blickrichtung ein Skript setzt — im Dialog also praktisch jede.

**Behebung.** Neu `packages/interpreter/src/angles.ts` mit
`byteAngleToDegrees` / `degreesToByteAngle` als **einziger** Umrechnungsstelle
(dieselbe Regel wie für die Achsen in `@webmidgar/convert`, ADR-009):

```
Grad = ((Byte − 0x40) · 360/256) mod 360
```

Geprüft wird an der Rose (`0x00`→270°, `0x40`→0°, `0x80`→90°, `0xC0`→180°),
an der Schrittweite (360/256, ausdrücklich **nicht** 1 — die Gegenprobe zur
alten Fassung), an der Umkehrbarkeit und einmal durch die VM hindurch.

**Geprüft, aber nicht betroffen:** Unsere Blickrichtung aus Bewegung
(`richtungGrad`, `atan2(dy, dx)`) rechnet durchgehend in Grad ab +X und war nie
ein Byte-Winkel; die Gateway-Rückrichtung wird geometrisch bestimmt, nicht aus
einem gespeicherten Winkelbyte. `OP.DIR` war die einzige Eintrittsstelle.

**Noch offen:** Der Getter `0xB7` und die Drehopcodes (`TURA` u. a.) sind bei
uns Stubs. Sobald sie Verhalten bekommen, müssen sie durch dieselben zwei
Funktionen — sonst entsteht die Ungleichheit an anderer Stelle neu.
