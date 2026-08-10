# ADR-026 — Kampf-Integration: Ablösung von ADR-011 (S33, 2026-08-10)

**Status:** angenommen. **Löst ab:** ADR-011 (Kampf-Stub). **Baut auf:**
ADR-006 (Fixed-Tick/Determinismus), S17 (`HostRequest`/`battle-finished`),
S30–S32 (formats-battle, battle-runtime, render-battle).

## Entscheidung

1. **Der echte Kampf ist der Standardpfad.** Ein `battle`-HostRequest
   (skriptiert über `BATTLE` 0x70 oder aus dem Zufallskampf-Modell) startet
   eine eigene `BattleSession` im Fixed-Tick. Das Field wird währenddessen
   **nicht getickt** — sein Zustand bleibt vollständig erhalten, es gibt
   keinen versteckten Nebenzustand (der `BattleModeCoordinator` in
   `packages/battle-runtime/src/mode.ts` erzwingt das strukturell).
2. **Der ADR-011-Stub bleibt als Testmodus** (`battleMode: 'stub'`): Er
   meldet sofort einen festen Ausgang und ist für schnelle Story-Durchläufe
   und Regressionsläufe zu wertvoll, um ihn zu entfernen.
3. **Rückweg:** `battle-finished { requestId, outcome }` über den seit S17
   verdrahteten Kanal. Kodierung (🔵, die Original-Kodierung ist unbelegt):
   0 = Sieg, 1 = Flucht, 2 = Niederlage.
4. **Die `outcome`-Zielvariable bleibt ungeschrieben.** Messung
   (`battle-outcome-probe`, 2026-08-10): Die stärkste von der IF-Familie
   nach `BATTLE` gelesene Adresse (bank5/addr0, 38,2 % von 68 verzweigenden
   Vorkommen) liegt bei Faktor **2,83** gegen die MAPJUMP-Kontrolle und
   Faktor **1,04** gegen die um 12 Instruktionen verschobene Kontrolle —
   dieselbe Adresse wird dort genauso oft gelesen, sie ist schlicht populär,
   kein Ausgangs-Spiegel. Nach Projektmaßstab (< 3) ist das **kein Befund**:
   Der Interpreter schreibt weiterhin in keine Script-Variable; der Wert
   lebt ausschließlich im Event.
5. **Zufallskämpfe** kommen aus der Encounter-Tabelle (Formatfakt Sektion 7)
   über ein dokumentiertes 🔵-Ratenmodell (`field-runtime/encounter.ts`):
   Schritt = bewegter Takt, Prüfung alle `stepsPerCheck` Schritte
   (`roll256 < rate`), Formationswahl gewichtet über die 6-Bit-
   Wahrscheinlichkeiten der `standard`-Plätze, Würfe aus dem
   Interpreter-PRNG (im Snapshot). `BTLON` schaltet zur Laufzeit. Der
   Schrittzähler wandert in den Sitzungs-Snapshot (Schema 2 → 3 — dieselbe
   Fehlerklasse wie die moveStalls in O9).
6. **Verbuchung:** EXP/AP/Gil und 🔵-Beutewürfe stehen im
   `victory`-Outcome; `applyExperience` (`battle-runtime/rewards.ts`)
   vollzieht Stufenaufstiege gegen die belegten Growth-Kurven mit einer
   dokumentierten 🔵-Schwellenformel. Kampfverläufe und Aufstiege sind
   reproduzierbar und in sich stimmig, aber **nicht zahlengleich mit dem
   Original** — dieser Satz gehört in die Release-Notes.

## Konsequenzen

- Replays überspannen die Modusgrenze (Fixture-Abnahme: bitidentisch, plus
  Gegenprobe „verschobene Eingabe ⇒ anderer Digest").
- Save→Load nach dem Kampf ist digestgleich (Fixture-Abnahme).
- Der O9-Restposten „vier Kampf-Opcode-Längen" ist gemessen geschlossen:
  keine der Makou-Längen (0x22→4, 0x23→2, 0x4B→1, 0x72→2) verbessert den
  Spannen-Abschluss (0x23 verschlechtert ihn); die eigene Tabelle bleibt.
- Offen (ehrlich): Battle-Animationsformate `ab`/`da` (🔴 — Standbild ja,
  Bewegtdarstellung nein), Stage-Format (🔴 → 🔵-Ersatz), camdat-Kameras
  (🔴), Weltkarten-Begegnungen (S29 zieht den Vertrag nach, ADR-011-Stub
  bleibt dort Rückfallpfad).
