# R9 — Cross-Browser-Replay-Gleichheit (S20)

R9 lautet in der Masterplan-Risikotabelle: *„Deterministik über Browser hinweg
(Fließkomma, Math-Implementierungen) — Replays nicht portabel."*
Verifikationsmethode: Digest-Vergleich identischer Replays über Browser,
gegebenenfalls fixpoint-kritische Pfade härten.

Diese Session hat eine **echte Abweichung gefunden, die Ursache benannt und
behoben**. Der Ablauf ist hier vollständig dokumentiert, weil der Weg zur
Ursache mehr wert ist als das Endergebnis.

## Messaufbau

Drei Replay-Vektoren (`tools/nfr-run/src/replay-vektoren.ts`), je 400 Takte
auf selbst erzeugten Fixture-Fields:

| Vektor | Was er trifft |
|---|---|
| `diagonal` | Diagonalbewegung, viele Kantenübertritte, Blickrichtung aus dem Bewegungsvektor |
| `gleiten` | Schmaler Korridor: Kollision mit Gleiten an Kanten, Projektionen und Wurzeln |
| `skript` | Skriptgesteuerte Bewegung mit Zielführung (`MOVE`-Opcode, Distanz- und Richtungsberechnung) |

Ausgeführt in: Node 22 (V8), Chromium 148 (Browser-Pane, Electron),
Chromium 151 (`--headless=new --dump-dom` über `/r9.html`).

Die Vektoren sind bewusst nicht beliebig gewählt. Eine Gegenprobe belegt, dass
sie das Risiko überhaupt treffen: die Math-Expositionsanalyse zählt je Lauf
**5580 Aufrufe implementierungsdefinierter Funktionen** (`atan2` 1384,
`hypot` 4196) gegen 34.232 bitgenau festgelegte — **14,02 %** der erfassten
Math-Aufrufe sind nicht bitgenau spezifiziert. Der Kontrolllauf, der
absichtlich nur `sqrt`/`abs`/`floor` benutzt, meldet exakt **0** — ohne diese
Null wäre nicht zu unterscheiden, ob die Instrumentierung überhaupt misst.

## Befund vor der Härtung

| Vektor | Node 22 | Chromium 148 | Chromium 151 |
|---|---|---|---|
| `diagonal` | `3d07c6395dbea6a2` | identisch | identisch |
| `gleiten` | `07431186ef506ffc` | identisch | identisch |
| `skript` | `a122762f32833f86` | identisch | **`2baf122fe0959524`** |

Die Abweichung war reproduzierbar (zwei Läufe, gleiches Ergebnis) und lag
**innerhalb derselben Engine-Familie** — zwei V8-Stände, kein Fremdengine-Fall.

## Ursacheneingrenzung

Ein abweichender Sitzungsdigest sagt nur „irgendwo anders". Deshalb wurde ein
**Math-Fingerprint** gebaut (`mathProbe()`, Seite `/mathprobe.html`): je
Funktion ein Digest über ein festes Argumentgitter von 2000 Punkten.

| Funktion | Node 22 | Chromium 151 | gleich? |
|---|---|---|---|
| `sqrt` | `f38d7391c39c4113` | `f38d7391c39c4113` | ✅ |
| `hypot` | `91e4ac16353aac8c` | `91e4ac16353aac8c` | ✅ |
| `pow` | `989f40db28c36dcc` | `989f40db28c36dcc` | ✅ |
| `atan2` | `937b29e0fdee9455` | `3010a63acf05fe13` | ❌ |
| `sin` | `5fd586f037bf604d` | `297aa4184bb32858` | ❌ |
| `cos` | `306ca11893532dda` | `49a7e280c8db6c59` | ❌ |
| `log` | `2bfe6b2ce026b549` | `e60aa43b7932f01f` | ❌ |
| `exp` | `fd6a60c1432e2676` | `4034f3f8a8e9337c` | ❌ |

Damit war die Ursache eindeutig: `Math.atan2`. Die Engine speicherte das rohe
Ergebnis als Blickrichtung im Sitzungszustand — und der Zustand ist der
Digest.

Warum nur `skript` betroffen war und `diagonal` nicht: Bei Tastatureingaben
kommt `atan2` nur mit acht diskreten Richtungsvektoren vor, deren Ergebnisse
in beiden Ständen übereinstimmen. Die skriptgesteuerte Zielführung ruft
`atan2` dagegen mit beliebigen Differenzvektoren auf. Ein Vektor allein hätte
den Fehler übersehen — das ist der Grund für drei verschiedene Vektoren.

## Härtung

Zwei Änderungen, beide klein und beide in der Digest-Kette:

1. **Richtungswinkel werden quantisiert** (`richtungGrad()` in
   `packages/field-runtime/src/session.ts`). Statt des rohen
   `atan2`-Ergebnisses wird auf die **256 Richtungseinheiten des Originals**
   gerundet; das Ergebnis ist ein ganzzahliges Vielfaches von
   360/256 = 1,40625, im Binärsystem exakt darstellbar. Die letzten Bits von
   `atan2` verlassen damit den Zustand. Fachlich ist das keine Einbuße,
   sondern näher am Original, das Richtungen ohnehin als Byte führt.
2. **`Math.hypot` wird durch `Math.sqrt(x²+y²)` ersetzt**
   (`packages/walkmesh/src/solver.ts`, `session.ts`, `transition.ts`).
   `sqrt` und die Grundrechenarten sind in ECMA-262 bitgenau auf IEEE-754
   festgelegt, `hypot` ausdrücklich nicht. `hypot` stimmte in der Messung
   zwar überein — aber das ist Zufall der Version, keine Zusicherung. Der
   Überlaufschutz von `hypot` wird bei Field-Koordinaten nicht gebraucht.

## Befund nach der Härtung

| Vektor | Node 22 | Chromium 148 | Chromium 151 |
|---|---|---|---|
| `diagonal` | `8f3579c8c25b109d` | identisch | identisch |
| `gleiten` | `3e159880012168ad` | identisch | identisch |
| `skript` | `f7a597e17a462ee8` | identisch | identisch |

Die Werte stehen als Konstanten in `ERWARTETE_DIGESTS` und werden in `npm test`
sowie im Realdatenlauf geprüft. Eine erneute Abweichung ist damit kein stiller
Befund, sondern ein roter Test.

## Verbleibende Exposition

Nach der Härtung berührt der **digestrelevante** Pfad noch:

- `Math.atan2` — aber nur noch vor einer Quantisierung auf 256 Eimer. Rest­risiko:
  liegt ein Ergebnis exakt auf einer Rundungsgrenze, könnten zwei Engines in
  verschiedene Eimer runden. Größenordnung: rund 10⁻¹³ je Aufruf, bei ~1400
  Aufrufen je Replay. Nicht ausgeschlossen, nur sehr unwahrscheinlich — und
  genau deshalb bleiben die Vektoren als Regressionstest bestehen.

Nicht digestrelevant, aber weiterhin engine-abhängig:

- `Math.sin`/`Math.cos` in `packages/render-actor/src/pose.ts` (Posenmathematik).
  Sie wirken auf das gerenderte Bild, nicht auf den Zustand. Zwei Browser können
  ein Gelenk um Bruchteile eines ULP verschieden zeichnen; der Replay bleibt
  identisch. Das ist bewusst so belassen — Rendering ist kein Vertragsgegenstand
  des Digests.
- `Math.hypot` in `packages/formats-field/src/sections/camera.ts` (Normierung der
  Kameraachsen). Ebenfalls rein darstellend.

## Browser-Matrix

| Engine | Stand | Replay-Digests | Anmerkung |
|---|---|---|---|
| V8 / Node 22 | gemessen 2026-08-10 | Referenz | Alle drei Vektoren |
| Chromium 148 (Electron) | gemessen 2026-08-10 | identisch | Vollständiger Browserlauf inkl. Worker, WebGL2 |
| Chromium 151 (kopflos) | gemessen 2026-08-10 | identisch (nach Härtung) | Quelle des ursprünglichen Befundes |
| Chromium (Edge) | Versuch gescheitert | — | Der kopflose Lauf liefert auf dieser Maschine keine Ausgabe. Gleiche Engine-Familie wie Chromium 151; kein zusätzlicher Erkenntniswert erwartet. |
| SpiderMonkey (Firefox) | **nicht gemessen** | — | Firefox ist auf der Entwicklungsmaschine nicht installiert. **ADR-020.** |
| JavaScriptCore (Safari/WebKit) | **nicht gemessen** | — | Unter Windows nicht testbar. **ADR-020.** |

Die Anforderung „Chromium × 2 Versionen" ist erfüllt (148 und 151). Die
Anforderung „Firefox" ist **nicht** erfüllt und per ADR-020 als bewusstes
Restrisiko geschlossen — mit benanntem Auslöser für das Nachholen.

## Reproduktion

```bash
npm test                                    # Vektoren gegen die Konstanten (Node)
npm run demo                                # dann:
#   http://localhost:5199/r9.html           Digests + Expositionsanalyse
#   http://localhost:5199/mathprobe.html    Math-Fingerprint je Funktion
```

Kopfloser Lauf einer beliebigen Chromium-Installation:

```bash
chrome --headless=new --virtual-time-budget=30000 --dump-dom http://localhost:5199/r9.html
```
