# R1 — Forschungsnotiz: Script-Request- und Prioritätssemantik (lebendes Dokument)

Status: **offen** (P0-Risiko laut Masterplan). Diese Notiz sammelt die in S6
getroffenen, bewusst gekapselten Annahmen (`PriorityRules` und markierte
🟡-Stellen in `packages/interpreter`) und die Validierungsstrategie. Regel:
Semantiklücken werden als benannte Hooks implementiert — nie still geraten.

## Getroffene S6-Annahmen (alle `Zu validieren`)

| # | Annahme | Ort | Validierungsidee |
|---|---|---|---|
| A1 | Priorität: kleinere Zahl = höher; Skala 0–7 aus den hohen 3 Bits des Request-Operanden, Slot aus den niedrigen 5 | `vm.ts unpackRequestOperand`, `PriorityRules` | Fixture-Field im Original ablaufen lassen (Makou-Reactor-Disassembly-Sicht), Reihenfolgevergleich |
| A2 | Verdrängung nur an Tick-Grenzen und nur durch strikt höhere Priorität; Verdrängter wird per LIFO fortgesetzt | `runtime.ts activateContext/suspended` | Referenzszenen mit konkurrierenden Requests (Türen + Cutscene-Trigger) |
| A3 | Requests wirken erst am nächsten Tickanfang (Staging), unabhängig von der Entitätsreihenfolge | `EntityRuntime.staged` | Timing-sensitive Szenen; Original zeigt ggf. Same-Frame-Starts |
| A4 | REQ ≙ REQSW (keine Queue-Obergrenze in S6); REQEW wartet auf Kontextende — auch bei Fault | `runtime.ts` | REQ-Fehlschlag-Verhalten des Originals bei belegtem Slot prüfen |
| A5 | Slot-0-Semantik: Init bis zum ersten RET (einmalig), Rest des Slot-0-Spans = Main, genau 1 Iteration je Tick-Grenze | `finishContext/activateContext` | Sichtbares Main-Verhalten (Idle-Animationen, Tür-Loops) vergleichen |
| A6 | Sprungbasis: Ziel = Adresse des Offset-Operanden ± Offset (JMP*/IF*-Familie) | `vm.ts`, gespiegelt im Assembler | Differenziell: echte Scripts disassemblieren lassen (Makou-Reactor-Semantik) und Kontrollflussgraphen vergleichen |
| A7 | WAIT 0 ≙ Yield bis zum nächsten Tick | `vm.ts` | Frame-Timing-Vergleich |
| A8 | Bankpaar-Nibble: hoch = erster Operand (Ziel), niedrig = zweiter (Quelle); Bank 0 = Literal | `vm.ts`, Assembler | Variablen-Sollverläufe bekannter Szenen |
| A9 | Wickel- vs. Saturier-Arithmetik: plain wickelt, „!"-Varianten saturieren; DIV/MOD durch 0 → 0 | `vm.ts` | Grenzwert-Fixtures gegen Originalverhalten |

## Realdaten-Stand (2026-08-09, S6-Sweep)

- Determinismus-Doppellauf: **702/702 Fields bitidentisch** (120 Ticks, Budget 200, Auto-Dialog).
- 10.523 Entitäten; 7.241 UNKNOWN-Op-Faults (erwartet — S6 implementiert nur
  Kontrollfluss/Variablen/Dialog-Stub), 69 unknown-comparison, 33 data.
- Häufigste Fault-Opcodes (Priorisierung künftiger Kategorien):
  `0xD0 (1833), 0xC7 (1148), 0xB3 (997), 0xE4 (516), 0xC6 (488), 0x43 (433), 0xE0 (397)`.
- unknown-comparison/data-Faults sind Kalibrierungsindikatoren: vermutlich
  Folgefehler zu kleiner/falscher Skip-Längen (Instruktionsstrom verrutscht) —
  bei Erweiterung der Opcode-Tabelle erneut messen.

## Nächste Schritte

1. Opcode-Kategorie „Entity/Bewegung" (0xA0-Block real implementieren statt
   skippen) — größter Hebel laut Skip-Statistik.
2. Verhaltensvergleich der A1–A5-Annahmen an 2–3 Referenzfields, sobald
   Hintergrund + Modelle sichtbar sind (nach S7).
3. Jede bestätigte/falsifizierte Annahme hier dokumentieren und die 🟡-Marker
   im Code auf 🟢 heben bzw. korrigieren.
