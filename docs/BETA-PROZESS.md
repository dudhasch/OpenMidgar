# Beta-Release-Prozess

Ergebnis der Gate-Session S20. Beschreibt, wie eine Beta-Fassung entsteht,
womit sie versioniert wird, was Nutzer beitragen können und wo die Grenzen
liegen. Die nutzerseitige Fassung dieser Seite liegt als
`apps/demo/beta.html` und ist mit der Demo ausgeliefert (`npm run demo`,
dann `/beta.html`).

## Versionsschema

`MAJOR.MINOR.PATCH`, Beta-Stände mit dem Zusatz `-beta.N`. Daneben steht eine
**zweite, unabhängige Zahl**: die Engine-Kompatibilität `engineCompat`.

| Bestandteil | Ändert sich, wenn … |
|---|---|
| `MAJOR` | das Spielstands- oder Mod-Paketformat bricht (Migration nötig) |
| `MINOR` | Fähigkeiten hinzukommen, abwärtskompatibel |
| `PATCH` | nur Fehler behoben oder Messwerte aktualisiert werden |
| `engineCompat` | sich der für Mods sichtbare Vertrag ändert: Opcode-Tabellen, Patch-Anker, Overlay-Kette, Digest-relevante Semantik |

Zwei Regeln, die nicht verhandelbar sind:

1. **Replay-Digests sind an `engineCompat` gebunden.** Ein Digestvergleich über
   diese Grenze hinweg ist bedeutungslos, nicht „ein Fehler". Jeder exportierte
   Digest trägt die `engineCompat`, unter der er entstanden ist.
2. In der Beta darf `engineCompat` auch in einer MINOR-Version steigen; **ab
   1.0 nicht mehr**.

Die R9-Härtung dieser Session (Quantisierung der Richtungswinkel) ist genau so
ein Fall: Sie ändert Digests, ohne das Verhalten zu ändern — und erhöht damit
`engineCompat`.

## Was in eine Beta muss, bevor sie hinausgeht

Vor jedem Beta-Tag laufen und müssen grün sein:

```bash
npx tsc --noEmit
npx vitest run                                    # inkl. NFR-Fixture-Lauf und Soak
npx vitest run --config vitest.realdata.config.ts # sofern eine lokale Installation vorliegt
```

Zusätzlich einmal manuell im Browser (`npm run demo`):

| Seite | Prüft |
|---|---|
| `/nfr.html` | NFR-Bilanz, Long Tasks bei Parsen im Worker, GPU-Upload-Budget, Speicherkontingent |
| `/r9.html` | Replay-Digests gegen die festgehaltenen Konstanten |
| `/index.html` | Import einer echten Installation, Fähigkeitsmatrix, Diagnoseexport |

Weicht eine NFR-Zahl um mehr als 20 % vom Sollwert nach oben ab, gilt die
Beta als blockiert, bis die Abweichung entweder behoben oder im
[NFR-Bericht](NFR-BERICHT-S20.md) begründet ist.

## Diagnosebericht: Anleitung für Nutzer

Der Bericht ist **nachweislich frei von Spieldaten**. Er enthält Fehlerklassen
mit Anzahl, Größen, Zähler, Digests und den Release-Fingerprint der Archive.
Er enthält keine Dateinamen, keinen Spieltext, keine Spielernamen, keine Pfade
und keine Rohbytes. Sichergestellt wird das nicht durch Sorgfalt, sondern
strukturell: Der Export ist eine Projektion auf eine Positivliste, und
`isAssetFree` (in `packages/app-shell`) belegt im Test, dass jeder Blattwert
entweder eine Zahl oder eine erlaubte Kennung ist. Freitext kommt gar nicht
erst durch.

Ablauf:

1. Installation wie gewohnt importieren, bis die Fähigkeitsmatrix erscheint.
2. Auf der Diagnoseseite den Export auslösen; es entsteht eine JSON-Datei.
3. Die Datei darf und soll vor dem Verschicken gelesen werden.
4. Beim Fehlerbericht angeben: Browser und Version, ob der Import kalt oder
   warm war, was zuletzt sichtbar passiert ist.

Besonders wertvoll sind Berichte von Installationen, die vom bekannten Bestand
abweichen — andere Sprachfassungen, ältere Datenträgerfassungen, konvertierte
Installationen. Genau dafür trägt der Bericht den Release-Fingerprint
([R5-Matrix](R5-FINGERPRINT-MATRIX.md)).

## Auswertung eingehender Berichte

1. Release-Fingerprint gegen `BEKANNTE_RELEASES` prüfen.
   - Bekannt → normale Fehlersuche.
   - Unbekannt → als neue Variante in die Registry aufnehmen, Matrix
     fortschreiben (ADR-022).
2. Fehlerklassen-Histogramm gegen die Referenzwerte des lokalen Laufs
   vergleichen. Quarantänequote über 1 % oder ein fatales Archiv reaktiviert
   R5 und blockiert die nächste Härtungssession.
3. Weicht ein Replay-Digest ab: `mathProbe()` in beiden Engines laufen lassen
   und dem Fixpoint-Härtungsplan aus ADR-020 folgen.

## Bekannte Einschränkungen

Die vollständige, nutzerlesbare Liste steht in `apps/demo/beta.html`.
Technische Kurzfassung:

| Bereich | Stand | Verweis |
|---|---|---|
| Menü, Kampf, Weltkarte, Minispiele, Filmsequenzen | fehlen | ADR-011 (Kampf-Stub), Roadmap S21 ff. |
| Audio-Feinsemantik (AKAO-Parameter, Kanal-Locks) | fehlt | Roadmap S23 |
| Skript-Patches und Dialogersetzungen im Modding | nicht scharfgeschaltet | Roadmap S22 |
| Touch-Bedienung, mobiles Layout | fehlen | Nicht-Ziel S20 |
| Mobile Leistungswerte | ungemessen | **ADR-019** |
| Firefox- und Safari-Replay-Gleichheit | ungemessen | **ADR-020** |
| GPU-Registry in der Renderschicht | existiert nur als Messmodell | **ADR-023** |
| R5-Matrix aus nur einer Installation | Stichprobe der Größe 1 | **ADR-022** |

## Was diese Beta ausdrücklich **nicht** ist

- Kein Hosting-Angebot und kein Portal. Der Betrieb erfolgt lokal.
- Keine Verteilung von Originaldaten in irgendeiner Form.
- Keine Zusage für Safari oder für Mobilgeräte — beides ist ungeprüft, und
  ungeprüft heißt hier ungeprüft, nicht „geht wahrscheinlich".
