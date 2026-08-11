# S26 — Gate-Feststellung für den Bogen S27–S36 (2026-08-10)

**Zweck dieses Dokuments.** ROADMAP-S27-S36, Zusatzregel 1: „Kein Bogen dieses
Dokuments startet, bevor die Regressionslage aus S26 grün ist." Dieses Dokument
stellt die Regressionslage fest und dokumentiert eine **bewusste Abweichung**
von der ursprünglichen S26-Definition.

## Die Abweichung, ausgesprochen

ROADMAP-S20-S26 definiert S26 als „Final-Härtung & 1.0-Politur" **nach**
S21–S25. Tatsächlicher Stand auf `main`:

| Session | Stand |
|---|---|
| S20 (Härtung & Beta-Gate) | ✅ abgeschlossen (NFR-Bericht, R9, R5, ADR-019–023) |
| S21 (Menü-Grundmodul) | ✅ **auf main** — Korrektur 2026-08-11. Der Satz „nicht auf main" war zum Zeitpunkt des Gates richtig und ist seither überholt: `packages/menu` liegt mit `model.ts`, `session.ts`, `format.ts` sowie `menu.test.ts`/`menu-runtime.test.ts` auf `main`, der Savemap-Leser ebenso, und `apps/demo` zieht die Inventarnamen über `resolveKernelNameLists`/`inventoryNameLookup` daraus (F18/F24-A). **Offen bleibt allein die Menü-OPTIK** (F24: Rahmen, Schrift, Anordnung — die Demo zeigt eine Diagnosetabelle, kein FF7-Menü); die Datenlesung ist belegt (79/79 Inventarzeilen aufgelöst). Der genannte Branch ist damit gegenstandslos |
| S22–S25 (Modding II, Audio-Feinsemantik, Save/Load-UI, field-add/KTX2) | ❌ nicht begonnen |
| S37 (EXE-Datenanalyse, vorgezogen) | ✅ abgeschlossen (`decompile-findings.md`) |

**Entscheidung:** Der Bogen S27–S29 (Eingabe, Weltkarte I/II) startet trotzdem.
Begründung: Die Zusatzregel begründet das Gate ausschließlich mit der
**Determinismuszusicherung** („ein wackeliger Digest macht jede Abnahme dieses
Bogens wertlos") — sie hängt an der Replay-Digest-Regressionslage, nicht an
Menü- oder Modding-Funktionalität. Keine der S27–S29-Voraussetzungen berührt
S21–S25 hart; die einzige weiche Referenz (S21/S24 als „zweiter Eingabekontext"
für S27) wird zur Tabellen-Reservierung ohne Nutzer — genau das, was S27 für
Battle/Weltkarte/Minigame ohnehin vorsieht. **„1.0" ist damit ausdrücklich
NICHT erklärt** — die 1.0-Politur (Release-Notes, R6-Auflösung,
Browser-Matrix final, Replay-Austauschformat) bleibt offen und gehört in eine
eigene Session nach S21–S25.

## Regressionslage (gemessen 2026-08-10)

| Lauf | Ergebnis |
|---|---|
| Fixture-Suite (`npm test`) | **34 Dateien, 401/401 Tests grün**, 0 Skips |
| Realdaten-Suite (`vitest.realdata.config.ts`, gegen die lokale Steam-Installation) | **54 Dateien, 62 Tests grün, 53 Skips** (Skips = dokumentierte Sichtprüfungs- und Sonderläufe, unverändert zur S20-Basis) |
| Typecheck (`tsc -b`) | grün |
| NFR-Fixture-Kampagne + Soak (Teil der Fixture-Suite) | grün, `digestStabil: true`, 0 Fehler, Heap/VRAM auf Baseline |

Damit gilt: **Das Gate ist offen. S27, S28, S29 dürfen starten.**

## Was dieses Dokument NICHT feststellt

- Keine 1.0-Erklärung, keine Release-Notes, keine finale Browser-Matrix.
- Keine Aussage über den S21-Branch-Inhalt (ungeprüft, bleibt liegen).
- R6 (Renderstate-Bits) bleibt offen wie in der Masterplan-Risikotabelle.

*Rückverweis: [ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) ·
[ROADMAP-S27-S36.md](ROADMAP-S27-S36.md)*
