# Roadmap — offene Forschungsposten

Dieses Dokument plant die verbliebenen 🔴/🟡-Posten in konkrete Sessions ein.
Es ist bewusst **methodenlastig**: Bei allen bisher gelösten Posten war nicht
der Aufwand das Problem, sondern die Messanlage. Deshalb steht bei jedem Punkt
nicht nur „was", sondern „womit gemessen wird" und „woran man merkt, dass die
Messung lügt".

**Aussagenklassen** wie im Masterplan: 🟢 Formatfakt · 🔵 Architekturentscheidung
· 🟡 Annahme/`Zu validieren` · 🔴 Offene Forschungsfrage.

## Stand nach der Prüfrunde 2026-08-09

| Posten | vorher | jetzt |
|---|---|---|
| Spielstand-Prüfsumme | 🔴 | 🟢 **gelöst** (CRC-16/CCITT, XOR-out 0xFFFF, ab +4; 8/8) |
| Kopflänge der Spielstanddatei | 🟡 | 🟢 **gelöst** (9/4340 trifft 8/8, Alternativen 0/8) |
| `audio.fmt`-Layout | 🔴 | 🟡 Eintragsgröße 74 B gemessen, WAVEFORMATEX belegt, Vorspann offen |
| Musikindex → Dateiname | 🔴 | 🟡 Zielmenge geschlossen (94/94), Permutation offen |
| Kampf-Opcode | 🔴 | 🟢 **gelöst** (`BATTLE` = 0x70, verdrahtet und getestet) |
| R4-Sichtprüfungen B1–B8 | ⏳ | ⏳ unverändert (braucht ein Auge, s. u.) |

---

## O1 — `audio.fmt` schließen (Ziel: S23, vorziehbar)

**Stand.** Die Eintragsgröße **74 Byte** ist hypothesenfrei gemessen: Häufige
u32-Konstanten wiederholen sich zu 87,1 % im Abstand 74 (Zweitplatzierter
3,5 %). Im Eintrag steckt nachweislich ein **WAVEFORMATEX** — Formatkennung 2
(MS-ADPCM), 1 Kanal, 44100 Hz, nBlockAlign 1024, 4 Bit/Sample, cbSize 32. Ein
WAVEFORMATEX mit 32 B Zusatz ist 50 B lang; 6 × u32 + 50 B = exakt 74 B.

**Was fehlt.** Der Vorspann. Versatz 10 trifft die Formatkonstanten in 265/738
Einträgen, Versatz 0 in 198/738 — Faktor 1,34, also kein Befund. 46 Byte
bleiben unverbucht, und nur ~36 % der Einträge teilen dieselben
Formatkonstanten.

**Methode.** Nicht weiter über Quoten raten — die Klangbank ist heterogen,
Quoten mitteln dabei zwangsläufig ins Unentscheidbare. Stattdessen:

1. **Je Eintrag statt global auswerten.** Für jeden der 738 Einträge einzeln
   prüfen, ob ein plausibles WAVEFORMATEX an einer festen Position steht
   (Formatkennung ∈ {1, 2}, Abtastrate ∈ {11025, 22050, 44100}, Bit ∈ {4, 8,
   16}). Der richtige Vorspann ist der, bei dem *jeder* Eintrag ein gültiges
   WAVEFORMATEX trägt — nicht der mit dem besten Mittelwert.
2. **`audio.dat` als Gegenprobe.** Ein Bereich (Offset, Länge) ist richtig,
   wenn an dieser Stelle in `audio.dat` tatsächlich MS-ADPCM-Daten liegen. Ein
   MS-ADPCM-Block beginnt mit einem Prädiktorindex < nNumCoef — das ist ein
   billiger, harter Test, den falsche Offsets fast nie bestehen.
3. **Accounting als Wahrheitstest** (Projektstandard): Die Summe aller Längen
   plus Lücken muss `audio.dat` byteexakt füllen.

**Fallstrick.** Nullwerte sind trivial monoton, trivial rahmenkonform und
trivial überlappungsfrei. Genau daran ist der erste Anlauf gescheitert und
beinahe auch der zweite. Jede Quote **ohne** die Nullfälle zweitrechnen.

**Erst danach** lohnt sich der MS-ADPCM-Dekoder (reiner TS-Code, Node-testbar).

## O2 — Musikindex → Dateiname (Ziel: S23)

**Stand.** Es gibt keine Indexdatei; FFNx löst über eine Funktion in der EXE
auf. Die **Zielmenge ist aber geschlossen**: `data/midi/midi.lgp` und
`data/music_ogg` decken sich zu 94/94. Der Index bildet also in eine bekannte
94-elementige Namensmenge ab — gesucht ist nur noch die Permutation.

**Was widerlegt ist.** Die TOC-Reihenfolge von `midi.lgp` ist nicht der Index:
Die Schwesterarchive desselben Titelsatzes sind nur 40/94, 19/94 bzw. 25/94
positionsgleich. Wäre die Archivordnung kanonisch, müssten alle vier
übereinstimmen.

**Methode.** Zwei unabhängige Wege, beide datengetrieben:

1. **Über die Fields.** `MUSIC` (0xF0) trägt einen feldlokalen Index. Führt
   ein Field eine eigene Musikliste (Verdacht: `flevel`-Sektion 5), dann ist
   deren Eintragszahl eine harte Vorhersage: Der größte im Field vorkommende
   0xF0-Operand muss kleiner sein als die Listenlänge. Über 702 Fields ist das
   ein scharfer Test — er fällt sofort durch, wenn Sektion 5 etwas anderes ist.
2. **Über die Häufigkeit.** Die Verteilung der 0xF0-Operanden über alle Fields
   ist stark ungleich (Feldmusik, Kampfmusik, Themen). Auch die Nutzung der
   Titel ist bekanntermaßen ungleich. Eine Rangkorrelation zwischen beiden
   Verteilungen liefert Kandidaten — **aber nur als Hypothesengenerator**, nie
   als Beleg.

**Entwurfsentscheidung unabhängig davon:** Die Zuordnung wird als
**austauschbare Tabelle** modelliert (Mod-fähig, wie FFNx es faktisch macht),
nicht als eingebaute Konstante. Damit ist S16 auch ohne O2 auslieferbar — die
Tabelle ist dann eben unvollständig statt falsch.

## O3 — Kampf-Opcode ✅ gelöst

**Ergebnis.** `BATTLE` = **0x70**, Operanden: Bank-Byte + u16 Formationsnummer.
`BTLON` = 0x71 (Zufallskämpfe an/aus). Beide sind implementiert, der
Wartezustand und der Rückkanal `battle-finished` sind verdrahtet und durch
Fixture-Tests abgesichert.

**Warum der erste Anlauf scheitern musste — die eigentliche Lehre.** Die
Messung prüfte, ob der Operand in der Kandidatenmenge aus Sektion 7 des
**eigenen** Fields vorkommt. Aber `battleID` ist eine **globale**
Formationsnummer: Sektion 7 beschreibt die *Zufalls*kämpfe eines Fields,
`BATTLE` löst einen *skriptierten* Kampf aus. Die Probe hat in einer Menge
gesucht, in der die Antwort gar nicht liegen kann — nachgemessen steht die
Nummer dort in 1 von 173 Fällen, und im Nachbarfield exakt gleich oft.

Das ist ein anderer Fehlertyp als die bisherigen: nicht eine schlechte
Kontrolle, sondern eine **falsche Suchmenge**. Eine Kontrolle kann das nicht
aufdecken — sie misst dasselbe Rauschen wie der Kandidat und sieht dabei
völlig gesund aus. Der einzige Schutz ist, die Annahme hinter der Suchmenge
selbst auszusprechen: *„Ich nehme an, die gesuchte Nummer stammt aus dieser
Tabelle."* Genau dieser Satz stand nirgends.

**Offen geblieben:** Ob `outcome` aus `battle-finished` im Original in eine
Variable gespiegelt wird und in welche. Der Interpreter schreibt bewusst
nichts, statt eine Adresse zu raten. 🟡

## O3b — Sektion 7 (Encounter-Tabelle) erschließen (Ziel: S23)

Durch O3 nicht mehr blockierend, aber weiterhin unerschlossen — und für
Zufallskämpfe nötig. Standardverfahren: Accounting plus die Strukturkarte
„Wertevielfalt je Byteposition", also das Verfahren, das bei `audio.fmt` die
Eintragsgröße freigelegt hat.

## O9 — Operandenlängentabelle systematisch abgleichen (Ziel: S20)

**Neu aufgetaucht.** Die aus den Realdaten abgeleitete Längentabelle (S12,
99,73 % Spannen-Abschluss) hat Lücken. Gegen die Strukturgrößen aus Makou
Reactor geprüft, weichen **4 von 8** Stichproben ab:

| Opcode | Referenz | unsere Ableitung |
|---|---|---|
| `BTMD2` 0x22 | 4 | 1 |
| `BTRLD` 0x23 | 2 | 4 |
| `BTLTB` 0x4B | 1 | 0 |
| `BTLMD` 0x72 | 2 | 1 |
| `BATTLE` 0x70 | 3 | 3 ✓ |
| `BTLON` 0x71 | 1 | 1 ✓ |
| `MAPJUMP` 0x60 | 9 | 9 ✓ |
| `WAIT` 0x24 | 2 | 2 ✓ |

Alle vier Abweichungen betreffen **seltene** Opcodes — genau dort trägt der
Spannen-Abschluss als Gütefunktion am wenigsten, weil wenige Vorkommen kaum
Druck auf die Optimierung ausüben.

**Methode.** Die Referenzgrößen als **Hypothese** einsetzen (nicht übernehmen)
und gegen die Realdaten messen: Steigt der Spannen-Abschluss über 99,73 %?
Sinkt die Overrun-Quote unter 0,22 %? Jede Änderung, die beides verbessert,
ist belegt; jede, die es verschlechtert, wird verworfen — auch wenn die
Referenz etwas anderes sagt. Das ist dasselbe Verfahren wie beim
Koordinatenabstieg, nur mit besseren Startwerten.

**Erwarteter Ertrag:** Die 0,22 % Overrun sind die Stellen, an denen der
Interpreter heute aus dem Tritt gerät. Jede korrigierte Länge schließt eine
davon.

## O4 — R4-Sichtprüfungen B1–B8 (jederzeit, braucht 20 Minuten)

Das ist der einzige Posten, bei dem **du** schneller bist als jede Messung —
und er braucht keinerlei Fachwissen. Details und Anleitung in
[R4-MODELL-KONVENTIONEN.md](R4-MODELL-KONVENTIONEN.md).

Zwei Automatisierungsversuche sind sauber gescheitert und sind dort
dokumentiert, damit sie niemand wiederholt.

**Falls es doch automatisiert werden soll** (Aufwand: eine halbe Session): Die
Bindpose trägt die Information nicht, weil FF7-Modelle starr segmentiert sind
und die Kette dabei gerade ausfällt. Ein tragfähiger Test müsste die
`.p`-Segmente über die Bone-Matrizen transformieren und die Bounding-Box der
**Mesh-Geometrie** messen, nicht die des Skeletts.

## O5 — LGP-„Check-Code" im TOC (Ziel: S20, Härtung)

**Stand.** 1 Byte je TOC-Eintrag, Community-Quellen widersprechen sich
(Prüfwert vs. Ordnungshinweis). Wird eingelesen, mitgeführt und **nicht**
validierend verwendet — das ist die richtige Vorsichtshaltung, aber sie kostet
eine Fehlererkennung.

**Methode.** Über den vollen Bestand (alle LGPs der Installation, ~13.000
Einträge) beide Hypothesen gegeneinander messen:

- *Prüfwert:* Korreliert das Byte mit einer billigen Funktion über Name oder
  Inhalt (Summe, XOR, CRC-8)? Kontrolle: dieselbe Funktion über den
  **Nachbareintrag**.
- *Ordnungshinweis:* Ist das Byte eine Funktion der Position (Sortierschlüssel,
  Bucket-Index)? Dann muss es monoton oder blockweise konstant sein.

Die beiden Hypothesen machen **gegensätzliche** Vorhersagen — das ist der
Idealfall, weil eine davon zwingend durchfallen muss.

## O6 — R1: Prioritätsverdrängung bei Script-Requests (Ziel: S20, P0)

**Stand.** Im Masterplan als „kritischste Kategorie für Determinismus"
markiert und nur teildokumentiert. Falsche Eventreihenfolge zeigt sich als
Softlock, also spät und schwer zuzuordnen.

**Methode.** Nicht aus Dokumentation ableiten, sondern **das eigene Verhalten
gegen sich selbst absichern**:

1. Fixture-Scripts mit bewusst konkurrierenden Requests (gleiche Priorität,
   höhere Priorität, Selbstverdrängung, Verdrängung eines Wartenden) und
   festgeschriebenem Sollablauf.
2. Über die 702 echten Fields die **Häufigkeit** der Konfliktfälle messen: Wie
   oft tritt Verdrängung überhaupt auf? Ist sie selten, sinkt das Risiko und
   die Frage darf mit ADR-Nummer als Restrisiko geschlossen werden — ist sie
   häufig, braucht es einen Verhaltensvergleich.
3. Der Replay-Digest über alle Fields ist der Regressionsschutz: Jede Änderung
   der Verdrängungsregel muss ihn ändern, sonst greift sie nicht.

## O7 — 16-Bit-Bankzugriff an Adresse 0xFF (Ziel: S20)

**Stand.** Der Interpreter wrappt innerhalb der Bank
(`packages/interpreter/src/state.ts`): Ein Wortzugriff auf 0xFF liest
`b[0xFF] | b[0x00] << 8`. Die Alternative wäre ein Übergriff in die
Folgeregion. Beide Auslegungen unterscheiden sich an **genau einer** Adresse.

**Methode.** Erst messen, ob es überhaupt zählt: Über alle 702 Fields zählen,
wie viele Wortzugriffe auf Adresse 0xFF im Bytecode überhaupt vorkommen. Bei
null Vorkommen ist die Frage entschieden — nicht durch Wissen, sondern durch
Irrelevanz, und das wird so dokumentiert. Erst bei Vorkommen lohnt der
Vergleich beider Auslegungen im Replay-Digest.

## O8 — Variablenbank-Kollisionen zwischen Mods (Ziel: S22, vor MS5)

**Stand.** Als P0-Risiko registriert
([MODDING-SUITE-MASTERPLAN.md](MODDING-SUITE-MASTERPLAN.md)). Zwei Mods, die
denselben Variablenbereich beanspruchen, korrumpieren gegenseitig den Save.

**Entscheidung, die ansteht** (keine Forschung, ein Entwurf):
Bankbereichs-Registry gegen Save-seitige Mod-Namespaces.

- *Registry:* Mods deklarieren `variable-claim`, die Engine prüft
  Überschneidungen bei der Aktivierung. Einfach, aber der Bereich ist endlich.
- *Namespaces:* Jeder Mod bekommt eigenen Variablenraum im Save. Robuster, aber
  bricht die Kompatibilität mit Original-Saves.

Die Entscheidung gehört als ADR dokumentiert, **bevor** MS5 anfängt — nachher
ist sie ein Migrationsproblem.

---

## Einordnung in die bestehenden Bögen

| Posten | Session | Blockiert |
|---|---|---|
| O1 `audio.fmt` | S23 (vorziehbar) | Soundeffekte |
| O2 Musikindex | S23 | korrekte Musikauswahl (Engine läuft ohne) |
| ~~O3 Kampf-Opcode~~ | ✅ erledigt | — |
| O3b Sektion 7 | S23 | Zufallskämpfe |
| O9 Längentabelle | S20 | 0,22 % Overrun im Interpreter |
| O4 R4-Sichtprüfung | jederzeit | nichts — aber acht Annahmen bleiben ungeprüft |
| O5 LGP-Check-Code | S20 | nichts (Fehlererkennung entfällt) |
| O6 R1-Prioritäten | S20 | Determinismus-Zusicherung |
| O7 0xFF-Wrap | S20 | nichts (Randfall) |
| O8 Mod-Variablenbänke | S22, vor MS5 | Mod-Kombinierbarkeit |

*Rückverweis: [ROADMAP-S13-S19.md](ROADMAP-S13-S19.md) ·
[ROADMAP-S20-S26.md](ROADMAP-S20-S26.md) ·
[WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) ·
[FINDINGS.md](../tools/realdata-scan/FINDINGS.md)*
