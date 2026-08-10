# R5 — Release-Fingerprint-Matrix (S20)

R5 lautet: *„Release-Varianz (1998 vs. Steam) in Field-Containern und Archiven
— Parser bricht auf Nutzervarianten."* Verifikationsmethode: Fingerprint-Matrix
plus Community-Beta mit asset-freien Diagnoseberichten. Entscheidungsfrist:
laufend, **Gate vor Beta**.

## Warum ein zweiter Fingerprint

Der bestehende Archiv-Fingerprint aus `@webmidgar/io` ist ein **Cache-Key**: er
enthält Pfad, Dateigröße und Änderungszeit, damit jede Quelländerung einen
Rescan erzwingt (ADR-008). Genau das macht ihn als Release-Kennung unbrauchbar
— eine Kopie derselben Datei hat eine andere Änderungszeit und damit einen
anderen Wert, obwohl es dasselbe Release ist.

Der **Release-Fingerprint** (`tools/nfr-run/src/release-fingerprint.ts`) ist
deshalb rein inhaltsstrukturell: SHA-256 über Eintragsanzahl und je Eintrag
Name, Offset, Prüfbyte und Konfliktindex — in TOC-Reihenfolge. Nichts
Dateisystemseitiges fließt ein. Bewusst **nicht** über die Nutzdaten: das wäre
ein Vollscan von über 100 MB je Archiv und würde die Beta-Diagnose unbrauchbar
langsam machen. Die Verzeichnisstruktur identifiziert einen Archivbuild
bereits eindeutig genug — sie ändert sich bei jedem Neuverpacken.

## Trennschärfe (die eigentliche Prüfung)

Eine Kennung ist erst dann etwas wert, wenn sie in **beide** Richtungen
belegt ist. Eine Kennung, die alles trennt, trennt nichts.

| Richtung | Prüfung | Ergebnis |
|---|---|---|
| **Stabilität** | Dieselbe Datei an zwei Pfaden mit zwei Änderungszeiten (Hauptbaum ↔ Sicherungskopie eines Game-Converters) | 10 Paare, **0 Abweichungen** |
| **Sensitivität** | Verschiedene Fassungen derselben Archivrolle (Sprach-/Regionalvarianten) | **5 Rollen** mit mehreren Fingerprints |
| Unit-Gegenprobe | Ein zusätzlicher Eintrag im Archiv muss den Fingerprint ändern | geprüft in `tools/nfr-run/src/nfr-run.test.ts` |

Rollen mit mehreren unterscheidbaren Fassungen:

| Rolle | Fassungen |
|---|---|
| `condor` | 4 |
| `disc` | 4 |
| `snowboard` | 4 |
| `sub` | 4 |
| `flevel` | 2 |

Bemerkenswerter Negativbefund: Die Sicherungskopien des Game-Converters sind
**byteidentisch** zum Hauptbaum — der Konverter hat diese Archive nicht
angefasst. Ebenso sind `cr_*`, `high-*`, `menu_*` und `world_*` über alle vier
Sprachkürzel hinweg identisch; die Sprachfassung steckt dort nicht im Archiv.
Ohne die Sensitivitätsmessung über Rollen hinweg hätte die Matrix nur
identische Werte gezeigt und wie ein kaputter Fingerprint ausgesehen.

## Matrix-Kennzahlen (lokale Installation, 2026-08-10)

| Größe | Wert |
|---|---|
| Gescannte LGP-Archive | 57 |
| Archive mit fatalem Headerfehler | **0** |
| Einträge mit Quarantäne | 0 in allen 57 Archiven |
| Terminator korrekt | 57 / 57 |
| Lookup-Tabelle reproduzierbar | 57 / 57 |
| Als bekannt klassifiziert | 5 |
| Als unbekannte Variante klassifiziert | 52 |

## Registrierte Release-Fingerprints

Die Registry (`BEKANNTE_RELEASES`) enthält ausschließlich **gemessene** Werte.
Es steht dort kein Eintrag, der nicht aus einem Lauf stammt.

| Archiv | Kurzfingerprint | Einträge | Herkunft |
|---|---|---|---|
| `flevel` | `e5db628390bfe061` | 729 | Lokale Messung 2026-08-10 |
| `gflevel` | `dacd701ed74d98f6` | 729 | Lokale Messung 2026-08-10 |
| `char` | `49c43a74eea3ca21` | 12.649 | Lokale Messung 2026-08-10 |
| `battle` | `683680fd051f2c4b` | 11.119 | Lokale Messung 2026-08-10 |
| `magic` | `8c7f79784b75421a` | 5.252 | Lokale Messung 2026-08-10 |

Das Akzeptanzkriterium „≥ 3 bekannte Release-Fingerprints" ist damit erfüllt.
Die Registry stammt allerdings aus **einer** Installation — das ist eine
Grenze, keine Vollständigkeit. Die Erweiterung über eine Community-Beta ist
ADR-022.

## Der „best effort"-Pfad

Nachgewiesen an zwei Stellen:

1. **Realdaten:** 52 der 57 Archive sind unbekannte Varianten. Alle 52 werden
   trotzdem vollständig indexiert — Einträge > 0, Quarantäne 0, Terminator und
   Lookup-Tabelle in Ordnung. Eine unbekannte Variante führt zu **erhöhter
   Diagnosetiefe**, nicht zum Abbruch.
2. **Fixture-Test:** Ein selbst gebautes Archiv mit Namen, die in keiner
   Registry stehen, wird als `unbekannte-variante` klassifiziert, behält aber
   alle Einträge und bleibt nutzbar (`nfr-run.test.ts`).

## Assetfreiheit des Berichts

Die Matrix ist als Beta-Diagnosebericht gedacht und deshalb maschinell auf
Assetfreiheit geprüft (`berichtIstAssetfrei`): erlaubt sind Hexdigests,
Archivnamen, Endungskürzel, Diagnosecodes und Zahlen. Freitext ist
ausgeschlossen. Dateipfade erscheinen nicht — statt eines Pfads trägt jede
Zeile nur ein Struktur-Tag `haupt` oder `sicherung`. Eine Gegenprobe im Test
belegt, dass ein eingeschmuggelter Dateiname die Prüfung zum Scheitern bringt.

## Reproduktion

```bash
npx vitest run --config vitest.realdata.config.ts tools/realdata-scan/src/r5-fingerprint.rdtest.ts
```
