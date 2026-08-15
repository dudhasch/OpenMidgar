# Realdaten-Befunde (Diagnose-Scan, aggregiert)

**Quelle:** lokale Steam-Installation (deutsch, mit 7th-Heaven/FFNx-Overlay; die
gescannten Originalarchive unter `data/` sind unverändert). Scan vom 2026-08-09,
`npx vitest run --config vitest.realdata.config.ts`. Dieses Dokument enthält
ausschließlich aggregierte Formatbefunde — keine Originaldaten.

## S1 — LGP (char, flevel, gflevel, battle, magic)

| Befund | Status |
|---|---|
| Header/TOC/Datenvorsätze: 0 Quarantäne-Einträge über alle Archive | ✅ Struktur bestätigt |
| **Lookup-Tabelle exakt aus TOC reproduzierbar** (kein einziges W-LGP-LOOKUP) | ✅ Bucket-Funktion (Ziffern-Faltung, `_`→k, `-`→l, col 0 = kein 2. Zeichen) ist damit realdaten-validiert |
| W-LGP-SHADOWED ×1798 (v. a. battle.lgp) | ✅ erwartete Duplikatnamen; „letzter gewinnt" verifiziert unkritisch |
| W-LGP-CONFLICTTBL ×1 | 🟡 Einzelfall, bei Bedarf nachziehen |
| flevel (en) 703 Field-Einträge + 26 Sonstige; gflevel (de) 729 Einträge | ℹ️ Release-Varianz dokumentiert |

## S2 — Field-Container (702 echte Fields)

| Befund | Status |
|---|---|
| LZS + 9-Sektionen-Zeigertabelle: 702/702 parsen (einziger „Fatal": `maplist`, kein Field) | ✅ Containermodell bestätigt |
| Walkmesh-Sektion (u32 count + 24B-Tris + 6B-Access): 702/702, 81.542 Dreiecke (2–496/Field) | ✅ bestätigt |
| Adjazenz-Symmetrie: nur 2 Asymmetrie-Warnungen über alle Fields | ✅ Modell bestätigt |
| Trigger-Sektion: 516-Byte-Layout 702/702 | ✅ bestätigt |
| Script-Header (32 B) + Entry-Tabelle: 702/702; E-SCR-SPAN ×29, E-SCR-STR ×1 (Randsemantik einzelner Entry-Points, 🟡 vor S6 klären) | ✅ Grundlayout bestätigt |
| **Kamerarecord ist 38 Bytes, nicht 40** (Sektionslängen ausschließlich 38/76/114; das dokumentierte Pad-u16 existiert nicht). Nach Korrektur: 918 Kameras, **918/918 orthonormal**, Zoom 122–5863 | ✅ **Formatkorrektur** — Parser + Composer + Masterplan-Annahme aktualisiert |

## S8 — Hintergrund-Sektionen 4/9 (2026-08-09)

| Befund | Status |
|---|---|
| Sektion 4 (Palette): 12-B-Header (u32, palX, palY, colorsPerPage, **pageCount@10**) + pageCount·512 B Farben (BGR555): 702/702 exakt; 0–16 Seiten | ✅ Formatfakt |
| Sektion 9: 5-B-Kopf + Marker **"PALETTE"** (24-B-Kopf) → **"BACK"** → Layer → **"TEXTURE"** → **"END"** (Sektionsende, kein FINAL-FANTASY7-Terminator): 702/702 | ✅ Formatfakt |
| Layer-Layout: L0-Header 8 B; L1–L3 flag-gesteuert, Headerrest **16/10/14 B**; Tiles à **52 B**; **Separator-Regel**: 4 Null-Bytes nach jedem aktiven Block, sofern noch ein Flag folgt (nach L3-Block direkt TEXTURE): 702/702 exakt | ✅ Formatfakt (3 Probe-Iterationen: Backtracking → Schiedsrunde → Hexdump) |
| Layer-Verteilung: L0+L1 immer aktiv (702/702); +L2: 84, +L3: 50 | ℹ️ Bestand |
| Texturblock: 42 Slots {u16 exists; u16 size; u16 depth; **65536·depth B** — Datenlänge hängt NUR an depth, Seiten fix 256×256}: 702/702; 3327 Seiten, 51× depth 2 | ✅ Formatfakt (size-Feld ist nicht längenbestimmend) |
| Tile-Record: dstX i16@4, dstY i16@6 (16er-Raster), srcX u16@12, srcY u16@14 (**100 % 16-aligned, < 256** über 647.531 Tiles) | ✅ realdaten-gestützt |
| Tile-Feld u16@20 als paletteId-Kandidat: nur 54 % < Seitenzahl | 🟡 Offset falsch oder zusammengesetzt — bei S9-Rendering kalibrieren (Record roh konserviert) |
| Sektion 6: variabel 1,2–30 kB, kein Tile-Bezug erkennbar | 🟡 Zweck offen (nicht MVP-blockierend) |

## S16/S17 — Audio und Opcode-Identifikation (2026-08-09)

| Befund | Status |
|---|---|
| **Field-Wechsel-Opcode ist `0x60`, Zielfield als u16 an Operandenposition 0.** Gefunden über dieselbe Rückkantenprobe wie beim Gateway: Der aus diesen Zielen gebaute Field-Graph hat **39,4 % Rückkanten** gegen **0,9 %** bei verschobener maplist — Faktor 44. Alle anderen 255 Opcodes und Positionen bleiben unter 2,2 % | ✅ identifiziert (2157 Vorkommen) |
| Bemerkenswert: Die reine Auflösungsquote (82,3 %) liegt *unter* der Kontrolle (86,9 %) — bei 788 maplist-Einträgen löst fast jeder Index irgendwie auf. Ohne die Rückkantenprobe wäre der Befund unsichtbar geblieben | ⚠️ Messfallstrick |
| Kampf-Opcode, erster Anlauf: Kein Opcode trägt erkennbar eine Encounter-ID des eigenen Fields; bester Kandidat 8,8 Prozentpunkte Abstand (Faktor 1,3) | ⚠️ falsche Suchmenge — im zweiten Anlauf erklärt |
| **Kampf-Opcode ist `0x70` (BATTLE), Operanden Bank-Byte + u16 Formationsnummer.** Der erste Anlauf **musste** scheitern: `battleID` ist eine **globale** Formationsnummer, keine Nummer aus Sektion 7. Sektion 7 beschreibt die Zufallskämpfe eines Fields, `BATTLE` löst einen skriptierten Kampf aus. Nachgemessen: Die Nummer steht in Sektion 7 des eigenen Fields **1/173 mal** — und im Nachbarfield **exakt gleich oft**. Es gab dort nichts zu finden | ✅ identifiziert |
| Bestätigung ohne Rückgriff auf die Quelle: 184 Vorkommen über 702 Fields (173 mit Literaloperanden), **169/173 Formationsnummern unter 1024**, Median 468 — ein falsch gedeutetes Bytepaar läge im Median bei ~32768. Operandenlänge 3 deckt sich mit der aus den Realdaten abgeleiteten Tabelle; der Nachbaropcode `MAPJUMP` (0x60) war bereits unabhängig aus den Daten bestimmt | ✅ zwei unabhängige Stützen |
| `BTLON` = `0x71` (Zufallskämpfe an/aus), 102 Vorkommen. 🟡 Polarität des Operanden nicht belegt — der Rohwert wird durchgereicht | ✅ identifiziert, 🟡 Semantik |
| **Nebenbefund: Die abgeleitete Operandenlängentabelle hat Lücken.** Gegen die Strukturgrößen aus Makou Reactor geprüft, weichen 4 von 8 Stichproben ab: `BTMD2` 0x22 (1 statt 4), `BTRLD` 0x23 (4 statt 2), `BTLTB` 0x4B (0 statt 1), `BTLMD` 0x72 (1 statt 2). `BATTLE`, `BTLON`, `MAPJUMP` und `WAIT` stimmen. Die betroffenen Opcodes sind selten — genau dort trägt der Spannen-Abschluss als Gütefunktion am wenigsten | 🟡 systematischer Abgleich offen (O9) |
| Musik: 94 Titel, alle Kommentar-Header lesbar. **87 % tragen `LOOPSTART`, kein einziger `LOOPLENGTH`** | ✅ prägt das Schleifenmodell: von `LOOPSTART` bis Dateiende |
| `audio.fmt` (54.668 B), erster Anlauf: Nur die Eintragsgrößen 4 und 79 teilen die Datei glatt; beste Quoten 66 % / 51 % / 46 % | ⚠️ Methodenfehler: Die Teilersuche setzt „kein Vorspann" voraus |
| **`audio.fmt`-Eintragsgröße = 74 Byte, aus den Daten gemessen.** Statt Layouts zu raten, wurden häufige u32-Konstanten gesammelt und ihre Positionsabstände histogrammiert: **87,1 %** aller Abstände sind 74, der Zweitplatzierte liegt bei 3,5 %. 738 Einträge à 74 B passen in die Datei | ✅ Formatfakt (hypothesenfrei gemessen) |
| **Im Eintrag steckt ein WAVEFORMATEX** — sichtbar über die Wertevielfalt je Byteposition: Formatkennung **2 (MS-ADPCM)**, 1 Kanal, **44100 Hz**, nAvgBytesPerSec 21504, nBlockAlign 1024, **4 Bit/Sample**, cbSize **32**. Ein WAVEFORMATEX mit 32 B Zusatz ist 50 B lang; 6 × u32 Kopffelder + 50 B ergeben exakt die gemessenen 74 B | ✅ Struktur belegt |
| **Offen bleibt der Vorspann.** Der aus dem WAVEFORMATEX abgeleitete Versatz 10 trifft die Formatkonstanten in 265/738 Einträgen, der Zweitplatzierte (0) in 198/738 — Faktor **1,34**. Nach Projektmaßstab ist das kein Befund. Außerdem bleiben 46 Byte unverbucht, und nur ~36 % der Einträge teilen dieselben Formatkonstanten (die Klangbank ist heterogen) | 🟡 Layout zu 2/3 erschlossen, nicht geschlossen |
| Musikindex → Dateiname, erster Anlauf: keine Indexdatei auffindbar, Dateinamen ohne Nummernschema | ⚠️ am falschen Ort gesucht |
| ~~**Es gibt keine Indexdatei — die Zuordnung liegt in der EXE.**~~ **WIDERLEGT (2026-08-10, S37):** `data/music/music.idx` existiert (647 B, CRLF-Liste, Zeilenindex = Musiknummer). Der erste Anlauf hat sie übersehen, weil er nach einem Nummernschema in den Audioverzeichnissen suchte statt nach einer Indexdatei. Siehe [decompile-findings.md](../../docs/decompile-findings.md) §3 | 🔴 **Fehlbefund korrigiert** |
| ~~**Die Zielmenge ist geschlossen: 94/94.**~~ **KORRIGIERT (2026-08-10, S37): die Zielmenge ist 98.** Vier Titel liegen als `.wav` in `data/music/` statt als OGG und blieben deshalb unsichtbar; `xg.lgp` und `ygm.lgp` führen unabhängig ebenfalls 98 Einträge (`midi.lgp` mit 94 ist unvollständig). `music.idx` löst 98/98 auf reale Audiodateien auf | 🔴 **Zahl korrigiert** |
| **Die TOC-Reihenfolge ist NICHT der Index.** Gegenprobe über die drei Schwesterarchive desselben Titelsatzes: `awe.lgp` **40/94**, `xg.lgp` **19/94**, `ygm.lgp` **25/94** positionsgleich mit `midi.lgp`. Wäre die Archivordnung kanonisch, müssten alle vier übereinstimmen | 🟡 Permutation offen, Zielmenge bekannt |

## S13/S14 — Kerneldaten, Textkodierung, Spielstände (2026-08-09)

| Befund | Status |
|---|---|
| `kernel.bin` (deutsch 22.104 B, englisch 22.376 B): Kopf ist **u16 komprimiert · u16 entpackt · u16 Dateityp**, **27 Sektionen**, gzip-Ströme; die entpackte Länge stimmt in **allen 27** mit dem Kopf überein. Der Parser trägt beide Fassungen ohne eine einzige Diagnose | ✅ Formatfakt |
| Die Datei endet mit **2 Nullbytes außerhalb des Sektionsschemas**. Der Parser lässt genau diesen Rest zu — aber nur, wenn er wirklich genullt ist | ✅ Formatfakt |
| **Messfallstrick:** Die beiden denkbaren Kopfauslegungen sind für Sektionen unter 64 KB *byteidentisch*. Die Sektionsanzahl trennt sie nicht; entschieden wird über die entpackte Länge im Kopf | ⚠️ im Parser dokumentiert |
| Sektionen 0–8 tragen Recorddaten, **9–26 Text** (Dateityp 9) mit u16-Zeigertabelle am Sektionsanfang | ✅ Bestand |
| **Zeichentabellen-Versatz = 0x20, aus den Daten abgeleitet** (Gütefunktion „wie deutsch sieht das aus?"), identisch in der deutschen und der englischen Fassung | ✅ belegt |
| **Zweiter Messfallstrick:** Der scheinbare Zweitplatzierte (Versatz 0) liegt nur 6 % zurück — weil die Gütefunktion kleinschreibt und ASCII-Groß-/Kleinbuchstaben genau 32 auseinanderliegen. Versatz 0 ist ein *Schatten* von 0x20, keine Alternative. Gegen den ersten unabhängigen Kandidaten beträgt der Abstand Faktor **1,64** (de) bzw. 1,38 (en) | ⚠️ ohne diese Einsicht wäre der Befund als „knapp" fehlgedeutet worden |
| Textabdeckung: Mit dem linearen Fenster allein dekodieren 70,3 % der Zeichenketten vollständig; die beiden dominanten Restbytes 0xF9 (594×) und 0xF8 (164×) als Steuersequenzen ergänzt, steigt der Wert auf **98,93 %** und der Anteil unbekannter Bytes fällt von 5,4 % auf **0,04 %** | ✅ 🟡 die Deutung von 0xF8/0xF9 bleibt Hypothese |
| `kernel2.bin` ist LZS-komprimiert und entpackt mit dem vorhandenen Dekoder zu 27.390 B (deutsch) | ✅ Pfad trägt |
| Spielstände: 5 Dateien à 65.109 B unter `save/`; Aufteilung 9-B-Kopf + **15 Slots à 4340 B**. Belegte Slots sind sicher unterscheidbar (leer > 99,6 % genullt, belegt ≤ 39 %) | ✅ tragfähig, 🟡 Kopflänge arithmetisch mehrdeutig (9/24/39/54 gehen alle auf) |
| **Prüfsumme — erster Anlauf gescheitert, und ein beinahe geglaubter Fehlschluss:** Fünf CRC-16-Varianten zeigten zunächst 89 % Treffer. Die Nachrechnung ergab, dass diese Treffer **exakt den leeren Slots** entsprechen, für die eine CRC mit Startwert 0 trivial 0 liefert. Bei den belegten Slots traf **keine** Variante | ⚠️ Messfallstrick, im zweiten Anlauf aufgelöst |
| **Prüfsumme geklärt (zweiter Anlauf):** CRC-16/CCITT, Polynom `0x1021`, Startwert `0xFFFF`, unreflektiert, **Nachlauf-XOR `0xFFFF`**, über `slot[4…4340]` = **4336 B**. Ergebnis als u16 LE am Slotanfang; die Bytes 2–3 gehören zum selben Feld (DWord, nur unteres Word belegt) und stehen deshalb außerhalb des Prüfbereichs. **8/8** beschriebene Slots treffen, **0/67** genullte | ✅ Formatfakt |
| Der erste Anlauf scheiterte an **zwei** Abweichungen gleichzeitig (Bereich ab +2 statt +4, kein Nachlauf-XOR). Die Probe belegt beide einzeln: Jede Teilkorrektur allein trifft **0/7**. Dass genullte Slots jetzt durchfallen, ist ein Gütemerkmal — mit Nachlauf-XOR ergibt eine Nullfolge nicht 0, das alte Artefakt ist konstruktiv unmöglich | ⚠️ Lehre: „fast richtig" gab es hier nicht |
| **Kopflänge über die Prüfsumme entschieden:** Von den arithmetisch gleichwertigen Aufteilungen trifft nur **9/4340** (8/8); 24/4339, 39/4338 und 54/4337 liegen bei 0/8 | ✅ frühere 🟡 aufgelöst |
| **Belegtheitsregel korrigiert:** Die 95-%-Nullanteil-Schwelle verwarf einen Slot, der eine **gültige** Prüfsumme trägt. Belegt heißt jetzt „nicht vollständig genullt"; die Prüfsumme wird getrennt gemeldet statt in die Heuristik gemischt | ✅ korrigiert |

## S12 — Operandenlängen und Bewegungs-Opcodes (2026-08-09)

| Befund | Status |
|---|---|
| **Die Operandenlängen sind aus den Daten abgeleitet, nicht abgeschrieben.** Gütefunktion: Jede der 48.041 Script-Spannen ist ein Instruktionsstrom, der beim linearen Durchlaufen **exakt** auf seinem Ende landen muss. Ein Koordinatenabstieg über die Längen 0…16 hebt die Abschlussquote von **43,19 % auf 99,73 %** (unknown 0,04 %, Überlauf 0,23 %) | ✅ Methode + Ergebnis |
| **Überanpassung ist real**: Ein freier Abstieg über alle 256 Opcodes erreicht zwar 99,65 %, verbiegt dabei aber nachweislich richtige Längen (REQ 2→0, MUL 3→0). Mit eingefrorenen implementierten Opcodes steigt die Quote sogar auf 99,73 % | ⚠️ Lehre: 256 freie Parameter gegen eine Kennzahl lassen sich gegen die Kennzahl optimieren |
| 48 Längen bleiben **mehrdeutig** (mehrere Werte gleich gut, weil der Opcode zu selten vorkommt) — für den Skip-Pfad brauchbar, nicht als Strukturbeleg | 🟡 einzeln prüfen, wer sie implementiert |
| Wirkung im Interpreter: **unknown-op-Faults von 7241 auf 0**, Fields ohne jeden Fault von 1 auf **526/702**; Gesamt-Fault-Rate rund **3 %** der Kontexte (S12-Ziel war < 20 %) | ✅ Akzeptanzkriterium erfüllt |
| **Feldaufteilung XYZI (0xA5) und MOVE (0xA8) bestätigt**: 98,36 % der XYZI-Ziele und 99,66 % der MOVE-Ziele liegen tatsächlich **im Walkmesh** des eigenen Fields. Byteverschobene Kontrolle: 0,50 % bzw. 0,14 %; Kontrolle gegen ein fremdes Field: 42 % bzw. 43 % | ✅ realdaten-validiert (4637 XYZI, 7607 MOVE) |
| Die vermuteten Bankpaarbytes sind zu 98,3 % exakt 0 („Literal, keine Bank") — dadurch ist die Einzelmetrik „triangleId im Bereich" kein scharfer Test, erst die Kombination mit der Positionsprüfung trägt | ℹ️ Messfallstrick dokumentiert |

## S11 — Field-Sitzung, Gateway-Bestand, Tiefen-Eichung (2026-08-09)

| Befund | Status |
|---|---|
| **Determinismus der Integration**: 702 Fields × 240 Takte mit Solver, Triggern und mitlaufendem Interpreter — **0 Digest-Abweichungen** beim Eingabe-Replay, **0 Abweichungen** nach Snapshot/Restore mitten im Lauf, 0 Mesh-Verletzungen | ✅ Kernzusicherung realdaten-validiert |
| **Field-Wechsel-Budget** (Container entpacken + parsen, Sitzung aufbauen, Kachelatlas auflösen): Median **5,1 ms**, p95 9,9 ms, Maximum 17,7 ms — die NFR-Vorgabe von 500 ms wird von **0/702** Fields verletzt | ✅ NFR eingehalten (Node-Messung, ohne GPU-Upload) |
| **Ungenutzte Gateway-Slots erkennt man an entarteter Austrittslinie**, nicht am Sentinel: Von 8424 Records (702 × 12) sind nur **1095 belegt**. Der bisherige Test `destFieldId !== 0x7FFF` griff nie — der Wert 0x7FFF kommt im Bestand überhaupt nicht vor | ✅ **Formatkorrektur** (gleiches Muster bei Triggervolumen: genullte Ecken) |
| **Zielfield = u16@14, 0-basierter Index in die `maplist`.** Gefunden über **Graph-Symmetrie** statt über Koordinaten: Fasst man die Ziele als gerichteten Graphen auf, haben **78,8 %** der Kanten eine Gegenkante — gegen **0,2 %** Kontrollniveau bei verwürfelten Zielen. Alle anderen Offsets und Indexdeutungen (1-basiert, Archivreihenfolge, alphabetisch) bleiben unter 3 % | ✅ **Blocker gelöst** |
| `maplist` erschlossen: u16 Anzahl (788) + 32-B-Namen, unkomprimiert; 787 auf einen Fieldnamen auflösbar. Über den Gesamtbestand lösen **978/1095** Gateway-Kanten auf, 0 Selbstbezüge | ✅ Formatfakt (`packages/formats-field/src/maplist.ts`) |
| **Der Zielpunkt steht NICHT im Record.** Mit der korrekten Ziel-ID nachgemessen: Alle prüfbaren Vec3-i16-Offsets liegen *unter* ihrer Kontrollquote — @12: 34,3 % gegen 36,8 %, @16: 14,4 % gegen 17,3 %, @18: 12,0 % gegen 14,2 %. Die Fehlschläge liegen im Median 99 Einheiten neben der Ziel-Bounding-Box, sind also kein Skalierungsfehler | 🔴 **belastbarer Negativbefund** |
| **Ankunft daher über das Gegen-Gateway** (`planTransition`): Austrittslinie des Rückwegs abtasten, lotrecht einrücken, Solver bestätigen lässt. Ergebnis über alle Kanten: **510/1095 (46,6 %)** exakte Ankunft, davon **0**, die beim ersten Schritt sofort wieder feuern. Rest fällt auf den Meshschwerpunkt zurück (207 Kanten ohne Gegen-Gateway, 261 mit Gegen-Gateway abseits des Meshs) | ✅ tragfähig, ausschließlich auf belegten Daten |
| **Tiefen-Eichung K7**: Aus der Ordnungsbedingung (Layer 0 trägt immer z = 4095 und liegt hinter allem Begehbaren) folgt `zScale > max(vz)/4095`. Nötig: Median 0,66, p99 3,31, **Maximum 3,77** — bei zScale 1 erfüllen nur 476/702 Fields die Bedingung, bei **4** alle | 🟡 belegte untere Schranke, kein Beweis — Sichtprüfung entscheidet |

## S10 — Model-Loader-Sektion 3 (2026-08-09)

Über die Sektion war nichts belegt. Fünf Probeniterationen: Längen-/Kopfprofil →
ASCII-Laufanalyse → Grammatikraster (fand **keine** passende Auslegung) →
Zwischenraum-Vermessung → **maskierter Bytestrom-Dump** (Buchstaben als `L`,
Ziffern als `D`), der zeigte, dass die Modelldatei kein längenpräfixiertes,
sondern ein Festfeld ist. Danach lief das Accounting-Raster sofort auf.

| Befund | Status |
|---|---|
| Grammatik: `u16 0 · u16 modelCount · u16 scaleGlobal`, je Modell `u16 nameLen · name · u16 Flag · byte file[12] · u16 animCount · byte block[30]`, je Animation `u16 nameLen · name · u16 tail` — **702/702 Fields byteexakt, 0 Brüche** | ✅ Formatfakt |
| Modelldatei steckt im 12-B-Festfeld als `xxxx.hrc` + **Skala als ASCII-Ziffern**; Endung ausnahmslos `hrc`, Ziffern in 100 % vorhanden; stimmt in 93,6 % mit `scaleGlobal` überein (also kein bloßes Duplikat) | ✅ Formatfakt |
| **Animationsnamen sind keine Dateinamen**: der Rohname `xxxx.aki` löst 0-mal auf, `<stamm>.a` dagegen **26.212/26.212**. Die 3 Zeichen hinter dem Punkt sind eine Kennung (aki/yos/chi/tak/tor/hei/kei/anm) | ✅ **Formatkorrektur** (🟡 Zweck der Kennung offen) |
| Referenzauflösung gegen `char.lgp`: **5454/5454 Modelle und 26.212/26.212 Animationen**; 3209 verschiedene Animationsdateien = exakt der `.a`-Bestand des Archivs | ✅ Kette geschlossen |
| `modelCount` reicht bis **16** (Modus 9), `animCount` Modus 3; Modellnamen 15…30 Zeichen, Animationsnamen ausnahmslos 8 | ℹ️ Bestand |
| u16 hinter dem Modellnamen ist ein **binäres Flag**: nur 0 (47,6 %) und 1 (52,4 %) | 🟡 Bedeutung offen |
| `tail` hinter Animationsnamen: 1 in 97,1 %, Rest breit gestreut (0, 2…254) | 🟡 kein Konstantenfeld |
| 30-B-Block: letzte 3 Bytes sind sehr plausibel eine graue Umgebungsfarbe (Mittel 88,8/87,4/87,9, praktisch nie 0) — Gegenhypothese „Zähler" widerlegt. Die Deutung als 3 × (i16-Richtung + RGB) trägt teilweise: Richtungen sind **unnormiert** (\|v\| p5…p95 = 14167…50067), und je 9-B-Einheit tragen 3 Bytes auffällig wenige verschiedene Werte | 🟡 `decodeModelLightBlock` ist ausdrücklich Deutungsvorschlag; `blockRaw` bleibt maßgeblich |

## S9 — Tile-Semantik, R2-Entscheid, Hintergrund-Komposition (2026-08-09)

Drei Probeniterationen über **647.531 Tiles** haben die Feldbelegung des
52-Byte-Records erschlossen. Verfahren: erst Offsetprofil (Wertebereich und
Kardinalität je Byte), dann Teilmengentests gegen den tatsächlichen Bestand
des jeweiligen Fields, dann Entscheidungstests gegen Gegenkandidaten.

| Befund | Status |
|---|---|
| **`paletteId` ist u8@24, nicht u16@20** — 99,87 % der Tiles < Seitenzahl (S8-Annahme u16@20 lag bei 54 %) | ✅ **Formatkorrektur** |
| `textureId` = u8@34: 99,85 % der Tiles verweisen auf einen im Field vorhandenen Slot; 271 Fields mit exakter Mengengleichheit, 426 mit Teilmenge, 5 Verletzungen. Gegenkandidaten u8@30/@32/@36 verletzen 34/41/22 Fields | ✅ belegt |
| `uvX` u32@44 / `uvY` u32@48 = `round(src/256 · 1e7)` — ein vom Original mitgeführter UV-Cache. Er folgt **`src2` (u8@16/@18), sobald gesetzt, sonst `src`**: Regel trifft 98,91 %, „immer src" nur 84,6 %, „immer src2" 20,9 % | ✅ belegt (Kreuzprüfung gegen redundantes Feld) |
| `z` = u16@26: 12 Bit, in Layer 0 **ausnahmslos 4095** (342.792/342.792 Tiles) = hinterste Ebene | ✅ Ordnung belegt |
| **`z` ist KEINE metrische Tiefe**: zwischen z und der kameraseitigen Sichtdistanz ist über 666 Fields kein konstanter Faktor nachweisbar (Verhältnisstreuung p10…p90 über drei Größenordnungen) | 🟡 nur Sortierschlüssel — Eichung in S11 |
| `layerControl` = u16@20 ist **je Layer konstant** (L0: 0, L1: 16, L2: 32, L3: 2…15 je Tile) — keine Palettenangabe. Rasterweite bestätigt das teilweise: Layer 2 zeichnet 32-px-Kacheln (44 Fields, Quellkoordinaten 100 % 32-aligned), Layer 0/1 16-px | 🟡 Zweck offen, Kachelkante daraus abgeleitet |
| Layer 3 stapelt Zustandsvarianten: 6915 von 6965 Tiles teilen sich eine Zielzelle mit anderen | ℹ️ Schaltung über Skriptvariablen (S11) |
| `bpp` = u8@38 ∈ {0,1,2}; `flags` = u8@25 ist eine Einzelbitmaske (0 in 99,4 % der Tiles) | 🟡 Restsemantik offen |

**Abnahme durch Bildkohärenz** (`bg-compose.rdtest.ts`) — ohne Referenzbild
und ohne Sichtprüfung: Ein Vorrenderbild ist ein natürliches Bild, also sind
benachbarte Pixel über eine Kachelgrenze hinweg im Mittel genauso ähnlich wie
im Kachelinneren. Gemessen wird das Verhältnis beider Farbabstände (ideal 1):

| Auslegung | Verhältnis Grenze/Inneres |
|---|---|
| **belegt (Palette u8@24, Textur u8@34)** | **1,097** |
| Gegenhypothese Textur aus u8@30 | 1,189 |
| Gegenhypothese Palette aus u16@20 (S8-Annahme) | 1,124 |

Deckung der Basisebene (Layer 0+1) bei den 135 Fields mit bemalter Fläche
320×240: **97,1 %** mit der Regel „Basisebene deckend, darüber Index 0
transparent"; die Alternative „Rohwert 0 transparent" verliert 4 Punkte an
echtem Schwarz. Atlas-Packing: max. **1997 Kachelvarianten** je Field, damit
**1 Atlas** (2048²) für jedes der 702 Fields — die Masterplan-Grenze von 4
wird deutlich unterschritten.

**Nachtrag (2026-08-09): Die Basisebene ist nicht zwingend Layer 0.** Genau
ein Field im Bestand — `ship_2` — hat einen leeren Layer 0 und trägt sein
ganzes Bild (747 Kacheln) in Layer 1. Die Transparenzregel hing bis dahin am
Layer**index**, nicht an der tatsächlichen Basis; dadurch galt in diesem Field
Palettenindex 0 als Loch. Gemessen:

| `ship_2`, Basisebene (Layer 1) | Deckung |
|---|---|
| `opaque` (Regel nach tatsächlicher Basis) | **100,00 %** |
| `index0` (Regel nach Layerindex) | 94,73 % |

Kontrolle `md1stin` (Basis auf Layer 0): 77,64 % gegen 71,34 % — die Regel
entfernt also nachweislich echte Bildpixel, wenn sie falsch angewendet wird.
Behoben über `baseLayerIndex()` in `packages/render-field/src/tile-image.ts`;
die Probe zählt seither **702/702** komponierte Fields statt 701 und meldet
die Ausreißer namentlich (`basisNichtLayer0`).

**R2 entschieden: FOV-Basis 240.** Zwei Verfahren scheiterten sauber
(Walkmesh-Projektion zu unscharf; `cameraRange` liefert konstant 16 und ist
damit nicht in Hintergrund-Pixeln belegt). Entschieden hat die bemalte
Layer-0-Fläche der 177 nicht scrollenden Fields: Höhe exakt 240 in 119
Fields gegen 224 in 26, und die bemalte Fläche liegt bei −120…+120 statt
−112…+112 (134 bzw. 135 von 177). Herleitung im Detail:
[CALIBRATION.md](../calibration/CALIBRATION.md).

## S7 — Modellkette char.lgp (2026-08-09)

| Befund | Status |
|---|---|
| `.p`-Layout vollständig belegt: 128-B-Header + Pools + Renderstate 100 B + Gruppe 56 B + **BBox 28 B** + **Normalindex-Tabelle 4·nVertices** (Size-Accounting 4180/4180 exakt) | ✅ Formatfakt |
| Polygon-Vertexindizes gruppenrelativ: 0 × E-P-BOUNDS, 0 verworfene Gruppen | ✅ Annahme bestätigt |
| `.tex` 236-B-Header + Palette + Pixel: 695/695; durchgehend 8-bpp-palettiert | ✅ Formatfakt |
| `.a`-Frame = **24 B Wurzel + 12 B je Bone** (Rotation+Translation), Header 36 B: 3209/3209 | ✅ Formatfakt (Feldzuordnung der 24 B → 🟡 R4-B3) |
| `.hrc` 385/385, `.rsd` 4180/4180; **alle 385 Kompositionsketten hrc→rsd→p/tex vollständig auflösbar** (0 fehlende Referenzen) | ✅ Kette bestätigt |
| 4875 Submeshes, davon 695 texturiert | ℹ️ Bestandsstatistik |

Offene Semantikfragen (Achsen, Eulerorder, BGRA, …): [R4-Notiz](../../docs/R4-MODELL-KONVENTIONEN.md).

## S6 — Interpreter auf echtem Bytecode (2026-08-09)

| Befund | Status |
|---|---|
| Determinismus-Doppellauf: 702/702 Fields liefern bitidentische Zustands-Digests (120 Ticks, Auto-Dialog-Stub) | ✅ ADR-006-Kernzusicherung realdaten-validiert |
| E-SCR-SPAN nach Sentinel-Fix: 0 Diagnosen im gesamten Sweep | ✅ Sentinel `== stringTableOffset` bestätigt |
| 10.523 Entitäten; UNKNOWN-Politik: 7.241 Op-Faults (erwartet, nur 3 Kategorien implementiert), Top-Skips 0xA2/0xA1/0xA5 | ℹ️ Priorisierung künftiger Opcode-Kategorien → [R1-Notiz](../../docs/R1-REQUEST-SEMANTIK.md) |
| 69 unknown-comparison / 33 data-Faults | 🟡 vermutlich Folgefehler falscher Skip-Längen — bei Tabellen-Ausbau erneut messen |

## S5 — Solver auf echten Walkmeshes

140.400 randomisierte Schritte über 702 Fields: **0 Invariantenverletzungen**
(„immer im Mesh"), 93.411 Kantenübertritte, 67.427 Slides, 21 Clamp-Notanker
(0,015 % — numerische Randfälle, kein Durchtunneln).

## Konsequenzen

1. `CAM_RECORD_LEN = 38` ist jetzt Formatfakt (🟢) — umgesetzt in
   `packages/formats-field/src/sections/camera.ts`.
2. ~~E-SCR-SPAN-Randfälle (29/702) vor S6 untersuchen~~ **Geklärt (Probe
   `script-span-probe.rdtest.ts`, 2026-08-09):** Alle 29 Fälle stammen aus
   *einem* Field (eine Entität, Slots 3–31) und tragen exakt den Wert
   `stringTableOffset` — der bekannte Sentinel „ungenutzter Slot wiederholt
   letzten Entry ans Bytecode-Ende". Parser akzeptiert `== stringTableOffset`
   jetzt als leeren Span; Realdaten-Sweep ist damit E-SCR-SPAN-frei.
3. ~~Die FOV-Basis-Entscheidung (R2) kann jetzt mit echten Kameras +
   Backgrounds kalibriert werden~~ **Erledigt (S9): FOV-Basis = 240**, siehe
   [CALIBRATION.md](../calibration/CALIBRATION.md).
4. ~~Offen und blockierend für den Field-Wechsel~~ **Gelöst (S11):** Zielfield
   = u16@14 als maplist-Index; die Ankunft kommt aus dem Gegen-Gateway, weil
   der Zielpunkt nachweislich nicht im Record steht.

   **Methodische Lehre — die wichtigste dieser Session:** Der Durchbruch kam,
   als die Suche das Koordinatensystem verließ. Solange nach dem Zielpunkt
   gesucht wurde, prüfte jede Hypothese *zwei* unbekannte Felder gleichzeitig
   und scheiterte an beiden. Die Rückkantenprobe testet dagegen nur EINE
   Unbekannte und nutzt eine Eigenschaft, die keine Koordinate braucht: dass
   Verbindungen zwischen Räumen gegenseitig sind. Wenn eine Messung nicht
   greift, lohnt der Blick, ob sie zu viele Unbekannte auf einmal prüft.

## Sektion 7 — Encounter-Tabelle (2026-08-10)

| Befund | Status |
|---|---|
| **Layout vollständig: 2 Tabellen à 24 B.** `u8 enabled · u8 rate · u16 standard[6] · u16 special[4] · u16 padding`. Im Wort stecken **Wahrscheinlichkeit in den oberen 6 Bit** und **Kampf-ID in den unteren 10** (`& 0x03FF`) | ✅ Formatfakt |
| Vier unabhängige Vorhersagen halten alle: **702/702** Fields exakt 48 B, Padding **1404/1404** genullt, `enabled` trägt genau **2** verschiedene Werte, `rate` neun; **434** verschiedene Kampf-IDs, **keine** über 1023 | ✅ belegt |
| **Erklärt rückwirkend den ersten Fehlschlag der Kampf-Opcode-Suche.** Die verglich rohe u16-Werte aus der Sektion mit dem Operanden — aber Wahrscheinlichkeit und ID teilen sich das Wort. Ohne die Maske `& 0x03FF` KANN der Vergleich nicht treffen. Der Suchraum war nicht nur die falsche Menge, er war auch falsch kodiert | ⚠️ zweite Lehre aus demselben Fehlschlag |
| Querbestätigung: Die 10-Bit-Breite deckt sich mit den Formationsnummern des `BATTLE`-Opcodes (169/173 unter 1024 = 2¹⁰) | ✅ zwei unabhängige Wege |

## Audio und Musik — Negativbefunde bestätigt (2026-08-10)

| Befund | Status |
|---|---|
| **FFNx parst `audio.fmt` nicht.** Es greift auf das vom Spiel gefüllte Array `ff7_externals.sfx_fmt_header` zu und ruft die spieleigene Ladefunktion. Der Dateivorspann ist dort also nicht zu holen | 🔴 Quelle scheidet aus |
| **FFNx führt keine Musiknamensliste.** Der Name kommt aus `common_externals.get_midi_name(musicId)` — einer Funktion in der EXE | 🔴 Quelle scheidet aus |

## S20 — NFR-Messkampagne, Soak, R5 und R9 (2026-08-10)

Vollständige Berichte: [NFR](../../docs/NFR-BERICHT-S20.md) ·
[R9](../../docs/R9-CROSSBROWSER.md) · [R5](../../docs/R5-FINGERPRINT-MATRIX.md) ·
[ADRs](../../docs/ADR-S20-HAERTUNG.md). Hier nur die Befunde, die aus den
Realdaten stammen.

| Befund | Status |
|---|---|
| **Alle Desktop-NFRs der Phase 2.4 eingehalten.** 702 Fields, 0 Bundle-Fehler: Field-Wechsel p95 **10,12 ms** gegen 500 ms, TTFF kalt **48,4 ms** gegen 10 s, warm **28,9 ms** gegen 2 s, Modellkette kalt **2,15 ms** gegen 300 ms, Heap **25,2 MB** gegen 256 MB, VRAM-Schätzung **32 MB** gegen 512 MB | ✅ gemessen |
| **Knappster Wert: der Main-Thread-Task** mit 7,42 ms gegen 8 ms (7 % Luft). Es ist die längste von 702 Tick-Etappen zu je 60 Takten; der Median liegt bei 0,35 ms. Kein Verstoß, aber die einzige Zahl, die bei künftiger Tick-Arbeit beobachtet gehört | ⚠️ Beobachtungsposten |
| **Lastprofil des Field-Wechsels:** Atlasaufbau 1823,7 ms und LZS 1102,7 ms von 3684,0 ms Gesamtarbeit über 702 Wechsel — zusammen **79,4 %**. Die IO-Etappe (Slice-Read) ist mit 448,6 ms überraschend klein; das Verzeichnis trägt | ✅ ADR-010-Grundlage |
| **Soak über 500 Field-Wechsel auf echten Fields:** GPU-Buchführung kehrt exakt auf 0 zurück (500 Erwerbe, 500 Freigaben, 0 Fehlfreigaben), Heap **+1,07 %** gegen die Steady-State-Baseline, Verlauf flach von Wechsel 50 bis 500. Der Sitzungsdigest des ersten Rotationsfields ist im 476. Zyklus identisch zum ersten | ✅ leckfrei + zustandsfrei |
| **Heap-Baseline muss nach einer Aufwärmrunde genommen werden.** Gegen den Zustand vor dem ersten Wechsel gemessen meldete ein Lauf 5,85 % „Abweichung" — das waren JIT- und Cache-Einmalkosten, kein Leck. Der flache Verlauf ab Wechsel 50 belegt das. Eine Baseline vor der Aufwärmphase misst die Einmalkosten mit | ⚠️ methodische Lehre |
| **57 LGP-Archive der Installation, 0 mit fatalem Headerfehler, 0 Einträge in Quarantäne**, Terminator und Lookup-Tabelle in allen 57 reproduzierbar | ✅ R5-Grundlage |
| **Release-Fingerprint muss inhaltsstrukturell sein.** Der vorhandene Archiv-Fingerprint enthält Pfad und mtime (Cache-Key nach ADR-008) und ist als Release-Kennung unbrauchbar — eine Kopie derselben Datei bekommt einen anderen Wert. Der neue Fingerprint hasht nur die TOC-Struktur | ✅ Formatentscheidung |
| **Trennschärfe des Fingerprints in beide Richtungen belegt:** 10 Paare identischer Dateien (Hauptbaum ↔ Sicherungskopie, verschiedene Pfade und mtimes) liefern identische Werte; 5 Archivrollen (`condor`, `disc`, `snowboard`, `sub` je 4 Fassungen, `flevel` 2) liefern verschiedene | ✅ Sensitivität + Stabilität |
| **Negativbefund: Die Game-Converter-Sicherungen sind byteidentisch zum Hauptbaum.** Der Konverter hat diese Archive nicht angefasst. Ebenso sind `cr_*`, `high-*`, `menu_*` und `world_*` über alle vier Sprachkürzel identisch — die Sprachfassung steckt dort nicht im Archiv. Ohne die Rollen-Sensitivitätsmessung hätte die Matrix nur gleiche Werte gezeigt und wie ein kaputter Fingerprint ausgesehen | 🔵 unerwartet |
| **R9: Chromium 151 lieferte einen abweichenden Replay-Digest** (Vektor `skript`), Node 22 und Chromium 148 stimmten überein. Ursache per Math-Fingerprint eingegrenzt: `atan2`, `sin`, `cos`, `log` und `exp` unterscheiden sich **zwischen zwei V8-Ständen**; `sqrt`, `hypot` und `pow` nicht | 🔴 echter Fund |
| **Warum nur ein Vektor betroffen war:** Tastatureingaben rufen `atan2` nur mit acht diskreten Richtungsvektoren auf — deren Ergebnisse stimmten überein. Die skriptgesteuerte Zielführung ruft `atan2` mit beliebigen Differenzvektoren. Ein einzelner Vektor hätte den Fehler übersehen | ⚠️ methodische Lehre |
| **Behoben:** Richtungswinkel werden auf die 256 Richtungseinheiten des Originals quantisiert (Vielfache von 1,40625° — binär exakt), `Math.hypot` durch `Math.sqrt(x²+y²)` ersetzt (ECMA-262 legt `sqrt` bitgenau fest, `hypot` nicht). Danach stimmen alle drei Vektoren über Node 22, Chromium 148 und Chromium 151 überein | ✅ gehärtet |
| **Expositionsmaß statt Bauchgefühl:** 5580 Aufrufe implementierungsdefinierter Math-Funktionen je Replay (atan2 1384, hypot 4196) gegen 34.232 bitgenau festgelegte — **14,02 %**. Der Kontrolllauf mit ausschließlich `sqrt`/`abs`/`floor` meldet exakt 0; ohne diese Null wäre nicht zu unterscheiden, ob die Instrumentierung überhaupt misst | ✅ Kontrollhypothese |
| **GPU-Upload: eine ganze 2048²-Atlasseite kostet 5,4 ms (p95)** und verfehlt das 2-ms-Frame-Budget um 170 %. In 8 Streifen zerlegt: **1,0 ms je Streifen**. Die Gesamtzeit bleibt gleich, sie verteilt sich nur. Gemessen mit `gl.finish()` — ohne erzwungenes Fertigstellen misst man nur das Einreihen des Befehls und bekommt immer eine gute Zahl | 🔴 Verletzung → ADR-021 |

## `audio.fmt` — Vorspann gelöst (2026-08-10)

Der Befund oben („FFNx parst `audio.fmt` nicht") bleibt richtig, war aber nur
das Ende **einer** Spur. FF7SND benennt die Struktur, und sie hält gegen die
eigenen Daten.

| Befund | Status |
|---|---|
| **Vorspann vollständig: 24 B aus sechs `uint32`** — `Length, Offset, Loop, Count, Start, End` — gefolgt von einem `ADPCMWAVEFORMAT` (18 B WAVEFORMATEX + 32 B Zusatz = 50 B). Zusammen **74 B**, exakt die zuvor hypothesenfrei gemessene Eintragsgröße | ✅ Formatfakt |
| **Der Beweis ist das Accounting, nicht eine Quote.** Die 198 belegten Einträge beschreiben Bereiche in `audio.dat`, die bei 0 beginnen und **lückenlos und überlappungsfrei** bis 23.227.348 laufen: 0 Lücken, 0 Überlappungen, 0 außerhalb der Datei. Eine falsche Feldzuordnung erzeugt Löcher oder Überschneidungen | ✅ byteexakt |
| **Zweite, unabhängige Vorhersage hält:** Ist `Loop` ein Flag und sind `Start`/`End` seine Marken, muss `End` genau dann gesetzt sein, wenn `Loop` gesetzt ist — **198/198**, davon 20 mit Schleife | ✅ zweiter Weg |
| **Dritte Bestätigung:** Eintrag 198 ist die Abschlussmarke — `Length == 0` und `Offset` **genau** am Ende der Nutzdaten | ✅ dritter Weg |
| `cbSize == 32` und `NumCoef == 7` in 198/198 (MS-ADPCM-Standardbelegung); Kontrollversätze 0 und 10 in **0/198** | ✅ Kontrolle fällt durch |
| **Warum der erste Anlauf scheitern musste.** Das WAVEFORMATEX beginnt bei Versatz **24** — dem Wert, der sich aus 74 − 50 zwingend ergibt. Geprüft wurden damals 0 und 10. Die Suche lief über vermutete Stellen statt über die rechnerisch erzwungene | ⚠️ Lehre: die Rechnung sagte den Versatz voraus, sie wurde nur nicht befragt |
| **Der Nullwert-Fallstrick, diesmal andersherum.** Ab Eintrag 199 steht uninitialisierter Speicher — die Bytes folgen dem MSVC-Füllmuster `0xCD`. Mitgezählt drückt das jede Quote auf 28,9 %, ohne dass die Auslegung falsch wäre. Der zweite Anlauf ist genau daran fast gescheitert | ⚠️ methodische Lehre |
| **Offen (kleiner als vorher):** Von 71.738.528 B in `audio.dat` sind **23.227.348 B = 32,4 %** referenziert. Die restlichen 48,5 MB adressiert diese Tabelle nicht | 🟡 Restfrage |

## `.a`-Rotationsreihenfolge — im Kopf, aber konstant (2026-08-10)

Geprüft wurde die Hypothese, wechselnde Reihenfolgen könnten erklären, warum
animierte Frames kippen (R4-B2, bisher 10/76 aufrecht). **Sie ist widerlegt.**

| Befund | Status |
|---|---|
| **Die Rotationsreihenfolge steht in der Datei** (Versatz 12..14), nicht in der Engine: drei Bytes, je 0 = alpha/X, 1 = beta/Y, 2 = gamma/Z. In **3209/3209** Dateien ist das Tripel eine Permutation von {0,1,2}; die Kontrollversätze 13 und 16 liefern in **exakt 0** Fällen eine. Ein Zufallstripel bestünde das mit 6 / 2²⁴ | ✅ Formatfakt |
| **Es kommt genau eine Reihenfolge vor: YXZ (3209/3209).** Byte 15 ist in allen Dateien 0, `version == 1` in allen | ✅ belegt |
| **Damit ist die Hypothese tot und unser fest verdrahtetes YXZ bestätigt.** Der Parser liest die Reihenfolge trotzdem aus der Datei und meldet `W-ANIM-ROTORDER` bei Abweichung — eine gemessene Konstante ist etwas anderes als eine angenommene | ✅ Annahme → Datum |
| Nebenbefund, unabhängig bestätigt: Im Frame steht **Wurzelrotation vor Wurzeltranslation** (zwei Fremdimplementierungen, zuvor 🟡) | ✅ 🟡 → 🟢 |
| **Die verbleibende Spur für B2:** KimeraCS versetzt Field-Bones mit `translate(0, 0, −len)`, Battle-Bones dagegen mit `+len`; Kujata nutzt ebenfalls `−len`. Wir haben `−len` gemessen und es machte alles schlechter — aber **einzeln**, bei unverändertem Achsen-Basiswechsel. Vorzeichen und Basis gehören gemeinsam getestet | ⚠️ Kopplungsfalle |

## Musikindex — verengt, nicht gelöst (2026-08-10)

| Befund | Status |
|---|---|
| Kujata führt eine **indizierte** Liste mit 100 Einträgen (id 0..99). Alle **94** lokalen OGG-Namen kommen darin vor; sechs Einträge haben lokal keine Datei, ein Name ist doppelt vergeben | 🟡 Kandidat |
| **Die daraus abgeleitete scharfe Vorhersage fällt durch:** „kein `MUSIC`-Operand ≥ 100" — verletzt in **36 von 935** Vorkommen | 🔴 nicht erfüllt |
| **Nicht entscheidungsfähig, und das ist der eigentliche Befund.** Der Kandidat ist mit 3,9 % zwar halb so schlecht wie die Kontrollmenge (Byte vor dem Opcode, 8,4 %) — aber die Ausreißer sind über viele Werte gestreut statt auf einen Sentinel wie 0xFF konzentriert, und ihr Anteil liegt in der Größenordnung der bekannten Fault-Rate des Spannen-Durchlaufs (~3 %, S12). Die Messung kann „Liste stimmt, Durchlauf verrutscht" nicht von „Liste stimmt nicht" trennen | ⚠️ blockiert auf O9 |
| **O2 GESCHLOSSEN (2026-08-10, S37).** Die Zuordnung steht in `music.idx` **und** in einer 99-Einträge-Zeigertabelle der EXE (RVA `0x9684c8`, Eintrag 0 = Platzhalter). Beide liefern **dieselbe Permutation, 98/98**; die Kontrolle (Versatz 0) trifft 0/98. Der Lokator hält in 7/7 Programmdateien. **`musicId` ist 1-basiert, `music.idx` 0-basiert.** Die 36 Ausreißer oben werden dadurch nicht kleiner — ob der `MUSIC`-Operand diesen Index direkt trägt, bleibt an O9 gebunden | ✅ [decompile-findings.md](../../docs/decompile-findings.md) §3 |
| Nebenbefund: Feldmusik nutzt nur **34** verschiedene Indizes von 94 Titeln | ✅ Zahl |

## LGP-Check-Code — vier Implementierungen, keine Semantik (2026-08-10)

| Befund | Status |
|---|---|
| Landscaper, PyFF7, Makou Reactor und WebMidgar lesen das 1-Byte-Feld je TOC-Eintrag und **verwenden es nicht**. Keine der vier Quellen nennt eine Bedeutung | 🔴 Recherche erschöpft |
| **Konsequenz:** O5 ist keine Recherche-, sondern eine Messfrage. Die geplante Doppelmessung (Prüfwert über Name/Inhalt gegen Ordnungshinweis über Position) bleibt der einzige Weg — die beiden Hypothesen machen gegensätzliche Vorhersagen, eine muss durchfallen | 🔵 Vorgehen bestätigt |

## O9 — Operandenlängen gegen die Referenz (2026-08-10)

Makou Reactor führt eine vollständige Längentabelle (`Opcode::length[257]`,
Gesamtlänge inkl. Opcode-Byte). Sie wurde **nicht übernommen**, sondern posten
für posten gegen die eigenen Daten gemessen.

| Variante | Spannen-Abschluss | Overrun | Abbruch |
|---|---|---|---|
| A unsere Tabelle (Ausgangslage S12) | 99,73 % | 0,23 % | 0,04 % |
| B Referenz **pauschal** übernommen | **86,77 %** | 0,01 % | 13,23 % |
| C Referenz + variable Längen | 86,78 % | 0,00 % | 13,22 % |
| **D selektiv übernommen** | **99,92 %** | **0,06 %** | **0,01 %** |

| Befund | Status |
|---|---|
| **Die Referenz pauschal zu übernehmen wäre ein schwerer Rückschritt gewesen** — 86,77 % gegen 99,73 %. Die Vorsicht des Projektstandards war hier nicht Zeremonie, sondern hat einen 13-Punkte-Absturz verhindert | ✅ Verfahren belegt |
| **16 von 103 abweichenden Längen übernommen**, der Rest verworfen. Overrun-Quote 0,23 % → **0,06 %**, also gut ein Viertel des Ausgangswerts | ✅ gemessen |
| **Der Abstieg ist ordnungsabhängig.** Runde 2 fand drei weitere Übernahmen, darunter die häufigste überhaupt (0x33, n=7466) — eine übernommene Länge resynchronisiert den Durchlauf und macht eine zuvor verworfene lohnend. Ein einzelner Durchgang hätte sie übersehen | ⚠️ methodische Lehre |
| **Nach der Übernahme ist die Tabelle ein Fixpunkt:** Ein erneuter Lauf übernimmt **nichts** mehr | ✅ konvergiert |
| **Nachbarkontrolle:** Bei 3 der 16 Übernahmen ist der Referenzwert *nicht strikt* besser als `ref±1` (0xc1, 0xe7, 0xfc). Diese bleiben 🟡 — sie sind einer von mehreren gleich guten Werten, kein belegter | 🟡 offen markiert |
| **Phantom-Gegenprobe:** Vorkommenszahlen sind selbst tabellenabhängig. Unter der besseren Tabelle verschwinden 0x0b (328 → 78) und 0x1b (92 → 18) weitgehend — sie waren überwiegend Artefakte eines fehllaufenden Durchlaufs. Alle übrigen verworfenen Opcodes bleiben häufig, sind also echt | ✅ Kontrolle |

### Der eigentliche Fund: ein Lesefehler, keine Tabellenfrage

| Befund | Status |
|---|---|
| **Bei den Wort-Varianten der IF-Familie ist auch die LINKE Adresse zwei Byte breit.** Die VM las dort ein Byte, wodurch Vergleichsoperator und Sprungziel um eine Stelle verrutschten. Betrifft 0x16 (n=4733) und 0x17 (n=300) messbar | 🔴 echter Fehler, behoben |
| 0x18/0x19 sind auf der Gütefunktion **indifferent** und wurden aus **Formgleichheit** mitgezogen — dieselbe Instruktionsform muss dieselbe Länge haben. Als 🟡 markiert, weil das ein Formargument ist, kein Messergebnis | 🟡 begründet übernommen |
| **Kontrolle:** Dieselben vier je ein Byte zu weit gesetzt → 99,52 % gegen 99,92 %. Die Gütefunktion misst also nicht bloß „länger ist besser" | ✅ Kontrolle fällt durch |

### Was O9 nebenbei aufgedeckt hat

| Befund | Status |
|---|---|
| **Der Sitzungs-Snapshot war unvollständig.** Die Stillstandszähler der Bewegungsaufträge fehlten. Eine mitten in einem blockierten Auftrag gesicherte Sitzung brach die Bewegung nach dem Wiederherstellen später ab als der ununterbrochene Lauf — **3 von 702** Fields. Schema 1 → 2, behoben, `restoreMismatch` wieder 0 | 🔴 latenter Fehler, behoben |
| **Der Fehler war vorher unerreichbar.** Erst mit korrigierten Operandenlängen erreichen genug Fields überhaupt Bewegungs-Opcodes. Eine Korrektur an einer Stelle macht Fehler an einer ganz anderen sichtbar — das ist ein Argument dafür, nach jeder Formatkorrektur die **gesamte** Realdatensuite laufen zu lassen, nicht nur die betroffene Probe | ⚠️ methodische Lehre |
| **Alle drei R9-Replay-Digests haben sich geändert** — auch `diagonal` und `gleiten`, die kein Script ausführen. Ursache: Der Digest läuft über den Snapshot, und der hat ein Feld dazubekommen. Wären diese beiden *nicht* mitgewandert, wäre **das** der Alarm gewesen | ✅ bewusster engineCompat-Schritt |

### Was die Gütefunktion nicht kann

Der Spannen-Abschluss ist gegenüber falscher **Semantik** vollständig
invariant: Er belegt, dass die Längen aufgehen, nicht dass ein Opcode das
Richtige tut. Zwei Opcodes mit vertauschten Längen liefern denselben
Abschluss, solange ihre Summe stimmt. Das ist die „blinde Gütefunktion" aus
dem Methodenkatalog — hier struktureller Natur und nicht behebbar. Deshalb
bleiben die 0,06 % Rest und die drei nicht-strikten Übernahmen 🟡.

**Was fehlt, um weiterzukommen:** ein **zweiter, unmodifizierter** Datensatz.
Die Installation enthält zwar eine zweite `flevel.lgp`, die gehört aber zu
einem 7th-Heaven-Overlay und ist vom Original abgeleitet — also keine
unabhängige Stichprobe. Eine Installation eines anderen Release oder einer
anderen Sprachfassung wäre eine.

## R4-B2 gelöst — Wurzelrahmen statt Bone-Rotationen (2026-08-10)

| Befund | Status |
|---|---|
| **Der Fehler saß nie in den Bone-Rotationen.** Er sitzt im Wurzelrahmen: Unsere ADR-009-Basis `C: (x,y,z) → (x,z,−y)` ist genau `Rx(−90°)`; damit die Szene dieselbe Weltlage liefert wie die Referenzpipeline, muss `C · Rx(fix) = Rx(180°)` gelten ⇒ **fix = −90°**. Die Wurzeltranslation steht im selben Rahmen und braucht `C⁻¹`: `t → (t.x, −t.z, t.y)` | ✅ gelöst |
| **Zwei unabhängige Wege, dieselbe Antwort.** Die Sichtprüfung meldet 0° → von unten, 180° → von oben; beide 90° daneben, in entgegengesetzte Richtungen. Die Algebra liefert dieselbe Zahl, ohne die Sichtprüfung zu kennen | ✅ Auge + Rechnung |
| **Und diesmal ist es messbar.** Eine Vierteldrehung vertauscht Y- und Z-Ausdehnung, anders als eine halbe. Über 271 animierte Frames: ±90° **63,1 %** aufrecht gegen 34,3 % bei 0° und 180° — Faktor **1,84** | ✅ Realdaten |
| **Dass 0° und 180° exakt gleich abschneiden, bestätigt die dokumentierte Blindheit der Gütefunktion** gegenüber 180° — sie widerspricht ihr nicht | ✅ Kontrolle |
| **Das Vorzeichen entscheidet die Messung nicht** (−90° und +90° liegen 180° auseinander, dagegen ist die Box blind — beide 63,1 %). Es kommt aus Sichtprüfung und Algebra | 🟡 Grenze benannt |
| **Den Translations-Umbau kann sie prinzipiell nicht prüfen:** Die Ausdehnung einer Punktwolke ist verschiebungsinvariant. Abgesichert stattdessen durch einen Fixture-Test mit in allen drei Komponenten verschiedener Translation | 🟡 Grenze benannt |
| **63,1 % sind nicht 100 %.** B2 ist entschieden, R4 als Ganzes nicht abgeschlossen | 🟡 Rest offen |
| **Rückwirkend erklärt:** Der Eulerreihenfolgen-Sweep konnte keinen Sieger haben, weil der Fehler außerhalb seines Suchraums lag; „Bindpose 95 % aufrecht" war ein Artefakt, weil in der Bindpose alle Rotationen 0 sind und die Wurzel weder Rotation noch Translation trägt — der Fehler *kann* dort nicht auftreten | ⚠️ methodische Lehre |

## Sprachfassung — `flevel` ist nicht sprachabhängig (2026-08-10)

| Befund | Status |
|---|---|
| Nach Umstellung des Spiels auf Englisch liefert `data/field/flevel.lgp` **exakt dieselben 48.041 Skriptspannen** und in allen O9-Varianten identische Zahlen | ✅ gemessen |
| Ursache: `data/lang-en` enthält nur `battle`, `kernel` und `movies` — **kein** `field`. Der Field-Bytecode ist sprachunabhängig; die Sprachfassung steckt in `kernel.bin`, nicht im Field-Archiv | ✅ erklärt |
| **Konsequenz für O9:** Das ist keine unabhängige Stichprobe. Die verbleibenden 🟡-Längen brauchen einen Datensatz aus einem anderen **Release**, nicht aus einer anderen Sprache | 🟡 offen |
| **Konsequenz für S37:** `kernel.bin` IST sprachabhängig — genau die Gegenprobe, die der EXE-Bogen für Namenstabellen braucht | ✅ nützlich |

## S21 — Menü-Grundlagen: Assets, Savemap, Kernel-Records (2026-08-10)

Probe: `menu-savemap-probe.rdtest.ts` (M1–M4). Datenbasis: 4 `menu_*.lgp`,
4 `save*.ff7` mit 8 belegten Slots (davon einer sehr dünn), `KERNEL.BIN`.

### M1 — Menü-Archive

| Befund | Status |
|---|---|
| `menu_de/us/fr/sp.lgp` enthalten **je genau 50 Einträge, ausschließlich `.tex`** — keine Layouttabellen, keine Fontdateien, keine Icondaten in anderem Format | ✅ gemessen |
| Alle vier Archive sind **gleich groß (1.705.214 B), aber inhaltlich verschieden** (vier verschiedene SHA-256). Die Sprachfassung steckt also **in den Texturen selbst** (eingebrannter Text), nicht in einer Textliste | ✅ gemessen |
| **Konsequenz für das Menü:** Es gibt keine Layoutkonstanten zum Auslesen. Die Menümetrik muss eigen definiert werden (wie die Dialogmetrik aus S15) | 🟡 Eigenentwurf |

### M2 — Savemap-Feldlage (aus dem 4340-B-Slot abgeleitet)

| Befund | Status |
|---|---|
| **Charakterrecords: Basis 84, Schrittweite 132, 9 Records** (84 … 1272) | ✅ gemessen |
| Schrittweite über das **Namensraster**: FF-Text-Namen (Zeichentabelle aus S13) treffen bei 100 + i·132; Kontrolle auf verwürfelten Slots: **0 Treffer** | ✅ Kontrolle |
| Recordbasis über die **Kennungsspalte**: genau eine Spalte trägt in jedem Record einen Wert ≤ 10 und nimmt 9 verschiedene Werte an — sie liegt 16 Byte vor dem Namen ⇒ Basis 84 | ✅ gemessen |
| Recordbelegung: `+0` Kennung (0…10), `+1` **Level**, `+2…+7` sechs Grundwerte, `+16…+27` Name (12 B, 0xFF-terminiert), `+44/+46` HP aktuell/max, `+48/+50` MP aktuell/max, `+64…+127` 16 Materiaplätze à 4 B | ✅/🟡 s. u. |
| **Level verifiziert** über Konkordanz mit dem HP-Maximum: **0,974** gegen Kontrollniveau 0,638 (verwürfelte Zuordnung) | ✅ Kontrolle |
| ⚠️ **Selbstbetrug abgefangen:** Die Konkordanzliste wird von den Offsets 47 und 45 angeführt (1,000 bzw. 0,986) — das sind die **oberen Bytes von HP max und HP aktuell selbst**. Eine Kennzahl, die gegen sich selbst misst, gewinnt immer. Sie bestätigen das Verfahren, sie konkurrieren nicht | ⚠️ methodische Lehre |
| HP/MP über **Ordnungspaare** (aktuell ≤ Maximum in allen Records, Gegenrichtung als Kontrollniveau) plus Wertebereich: MP-Felder erreichen exakt **999**, HP-Felder ~10.238 — beides deckt sich mit den Obergrenzen des Originals | ✅ gemessen |
| **Gil = u32@32, Spielzeit = u32@36**, beide zusätzlich bei 2940/2944 wiederholt (Vorschaublock ↔ Savemap). Gefunden über **Duplikatgruppen**: Offsets, deren Wertfolge über alle Slots gleich ist und dabei variiert | ✅ gemessen |
| Auseinandergehalten über zwei unabhängige Kriterien: **Konkordanz beider Reihen 0,885** (mehr Gil ⇒ mehr Spielzeit, 26 Paare) und Wertebereich (50 Mio. Sekunden wären 578 Tage) | ✅ Kontrolle |
| Spielzeiteinheit **Sekunden** — 1759 s ≈ 29 min bei 585 Gil ist stimmig, dieselbe Zahl als Frames (59 s) nicht | 🟡 plausibel, nicht bewiesen |
| **Vorschaublock = Slot 4…83**, Savemap ab 84. Ergibt sich aus der Recordbasis, wurde nicht angenommen | ✅ abgeleitet |
| **Partyaufstellung bei 1272** (3 Bytes), gefunden über „jedes Byte < 9 oder 0xFF **und** die belegten paarweise verschieden" — dieselbe Figur kann nicht zweimal in der Gruppe stehen. 5 Kandidaten im ganzen Slot, einer davon exakt am Ende des Recordarrays | ✅ Kreuzbestätigung |
| Belegung von `+2…+7` (Reihenfolge der sechs Grundwerte) und `+28…+31` (Ausrüstung) | 🟡 aus Wertebereichen plausibel, nicht einzeln belegt |

### M3 — Kernel-Sektionsrollen

| Befund | Status |
|---|---|
| **Sektionen 0–8 = Recordtabellen** (keine Zeigertabelle), **9–26 = Textlisten** (Zeigertabelle am Anfang, Stringanzahl = erster Zeiger / 2) | ✅ gemessen |
| Stringanzahlen: 10/18 → 256, 11/12/19/20/25 → 128, 13/14/17/21/22 → 32, 15/23 → 96, 16/24 → 64, 26 → 16 | ✅ gemessen |
| ⚠️ **Messfallstrick behoben:** Die Spalten-Konstanz eines Recordarrays ist bei jedem **Vielfachen** der wahren Schrittweite mindestens so hoch wie bei ihr selbst. Das reine Maximum las 3584 B als 16×224 statt als 128×28. Genommen wird jetzt die **kleinste** Schrittweite, die den Bestwert nahezu erreicht — dieselbe Sorte Schatten wie der Groß-/Kleinschreibungsschatten der Zeichentabelle aus S13 | ⚠️ methodische Lehre |
| Zuordnung einzelner Textsektionen zu ihren Recordtabellen über die Anzahl allein bleibt mehrdeutig (mehrere Tabellen mit 32 Records) | 🟡 offen |

### M4 — Inventar und Item-Namen

| Befund | Status |
|---|---|
| **Inventar ab Slot-Offset 1276**, 320 Einträge à u16 — direkt hinter der Partyaufstellung (1272 + 4). Güte 1,000 | ✅ gemessen |
| **Eintrag = `Anzahl = wert >> 9`, `Kennung = wert & 0x1FF`.** Entschieden über die **Verteilung der Anzahl**: Die Aufteilung 9/7 liefert „Anzahl 1" als häufigsten Wert (40 Einträge), die Aufteilung 8/8 kennt die 1 **überhaupt nicht** — ein Anzahlfeld ohne Einzelstücke ist widerlegt | ✅ Kontrolle |
| ~~**Item-Namen = Textsektion 18**, Beschreibungen = Sektion 10 (beide 256 Einträge; getrennt über die mittlere Länge 7,1 gegen 13,0)~~ | ❌ **WIDERLEGT**, s. M4-K unten |
| ⚠️ **Basisraten-Fehler abgefangen:** Der erste Anlauf kontrollierte mit „Kennung + 1" und erzeugte einen Scheinbefund — in einer zu 92 % belegten Liste löst auch die falsche Kennung fast immer auf (0,946 gegen 0,919, kein Abstand). Richtiges Kontrollniveau ist der **Füllgrad der Sektion**: Der Zugewinn über die Basisrate trennt die beiden 256er-Sektionen (+0,256 / +0,196) klar von allen übrigen (≤ +0,078, teils negativ) | ⚠️ methodische Lehre — **hat den Fehler trotzdem nicht verhindert** |
| ~~2 von 37 vorkommenden Kennungen lösen in Sektion 18 nicht auf (0,946) — vermutlich Sonderposten außerhalb der Itemliste~~ | ❌ die „Sonderposten" waren Waffen, Rüstungen und Accessoires |

### M4-K — Korrektur: Sektion 18 ist die **Zauberliste** (F18/F24-A, 2026-08-11)

Probe: `tools/realdata-scan/src/kernel-names-probe.rdtest.ts`
(`data/kernel/KERNEL.BIN` der Installation, `save00/01/07/09.ff7`).

| Befund | Status |
|---|---|
| **Die Textsektionen tragen 0-basiert die Rollen** 17 Kommandos (32) · 18 **Magie/Angriffe** (256) · 19 **Gegenstände** (128, belegt 0…104) · 20 **Waffen** (128, Füllgrad 1,000) · 21 Rüstungen (32) · 22 Accessoires (32) · 23 Materia (96) · 24 Schlüsselgegenstände (64); Beschreibung = Name − 8 | ✅ gemessen |
| **Wirkung des Fehlers, quantifiziert:** 79 Inventarzeilen über vier Spielstände — unter der alten Lesung **65 falsch benannt, 14 als „?ID", 0 richtig**. Unter der Bereichskodierung lösen **alle 79** auf (52 Gegenstände, 15 Waffen, 9 Rüstungen, 3 Accessoires; 0 offen) | ✅ Kontrolle |
| Damit sind **beide Hälften von F24 erklärt**: die „falschen Itemnamen" und „Materia werden unter Gegenstände gelistet" — der Tester sah Zaubernamen | ✅ abgeleitet |

**Warum die damalige Messung einen Scheinbefund lieferte.** Der Zugewinn über die
Basisrate war das *richtige* Kontrollniveau für die Frage „ist das überhaupt eine
Namensliste?" — aber er kann **Verwechslung** grundsätzlich nicht sehen. Die
Zauberliste ist zu **75 %** belegt und trägt an den Plätzen 0…104 durchgehend
Einträge; genau dort liegen 52 der 79 Inventarkennungen. Jede dieser Kennungen
löste also auf, nur eben zum falschen Namen, und die Auflösungsquote stieg
sichtbar über den Füllgrad (+0,256). Drei Fehler kamen zusammen:

1. **Die Gütefunktion misst „nicht leer", nicht „richtig".** Zwei Listen mit
   ähnlichem Füllgrad sind darüber nicht unterscheidbar. Eine Auflösungsquote
   ist erst dann eine Aussage, wenn **mehrere Kandidatenlisten gegeneinander**
   antreten — und Sektion 19 war nie im Kandidatenfeld, weil sie 128 statt 256
   Einträge hat.
2. **Die Annahme „256 Gegenstände" stammte aus der Inventargröße**, nicht aus
   der Kernel-Datei. Das Inventar hat 320 Plätze und Kennungen bis 319; die
   *Namens*liste hat 128. Die Zahl 256 passte auf keine der beiden und traf
   deshalb genau die Liste, die zufällig 256 Einträge hat.
3. **Die 14 nicht auflösbaren Kennungen wurden als „Sonderposten" abgehakt**
   statt als Widerspruch behandelt. Sie waren der eigentliche Hinweis: Alle 14
   liegen bei ≥ 215, also außerhalb des Gegenstandsbereichs.

**Was die Messung jetzt trägt** (statt einer einzelnen Kennzahl): Die
Rollenbestimmung nimmt die einzige 128er-Liste mit **Füllgrad 1,000** als Anker
(Waffen — die reine Länge ist fünffach mehrdeutig: Sektionen 11/12/19/20/25),
trägt von ihr aus die feste Rollenreihenfolge ab und prüft jede Rolle gegen ihre
Stringanzahl sowie die Gegenstandsliste zusätzlich gegen die **Belegungsgrenze
104**. Schlägt eine Probe fehl, wird nicht geraten.

### M4-R — Recordtabellen der Kernel-Sektionen 5…9 (1-basiert) typisiert

Quelle der Feldlagen: `docs/quellen/elena.md` §4 (Tatsachenbeschreibung).
Belegt wurde an den Realdaten:

| Befund | Status |
|---|---|
| **Accounting geht für alle fünf Sektionen byteexakt auf** — Item 128 × 28 = 3584 · Waffe 128 × 44 = 5632 · Rüstung 32 × 36 = 1152 · Accessoire 32 × 16 = 512 · Materia 96 × 20 = 1920. Die Recordzahlen sind dabei nicht angenommen, sondern die Stringanzahlen der zugehörigen Namenslisten | ✅ gemessen |
| **Die Einzellänge ist mehrdeutig** (Sektion 1 und 4 tragen beide 3584 B); eindeutig ist erst der **Lauf** aller fünf Längen in Folge — er trifft in der Datei genau einmal zu | ✅ Kontrolle |
| **Waffe 0x06 = Wachstumsrate:** nur Werte 0…3 (21 · 85 · 20 · 2). Kontrolle: Nachbarspalten 0x04/0x05/0x07/0x08/0x09 reichen bis 100 bzw. 255 | ✅ Kontrolle |
| **Materia 0x00…0x07 = vier aufsteigende AP-Schwellen:** 79/79 belegte Records monoton, 0/79 Gegenrichtung. Kontrolle: dieselbe Monotonieprobe auf den u16-Quadrupeln ab 0x08/0x0A/0x0C — 27/96, 41/96, 41/96 | ✅ Kontrolle |
| **Restriktionsfelder sind bitinvertiert** (die Datei speichert *Verbote*). Beim Gegenstandsrecord tragen 128/128 Records am u16 0x0A die Bits 3–15 gesetzt **und** sechs verschiedene Belegungen der unteren drei Bit. Kontrolle: Von den 14 u16-Spalten erfüllen zwar fünf die obere Bedingung, aber nur 0x0A auch die untere — die übrigen vier sind konstantes 0xFFFF-Polster | ✅ Kontrolle |
| Faktor „AP-Wert × 100", Bitbedeutungen der Restriktionen, alle übrigen Feldbedeutungen aus elena §4 | 🟡 übernommen, nicht einzeln nachgemessen |
| Accessoire 0x08: Elena liest u32 und castet auf einen Index-Enum — bei 16 B Recordlänge widersprüchlich. Bleibt roh | 🔴 offen |

## R4-B1 gelöst — Kindversatz-Vorzeichen, per Sichtprüfung entschieden (2026-08-10)

| Befund | Status |
|---|---|
| **Der Kindversatz lief nach `+parent.length`, richtig ist `−parent.length`.** Von 50 gerenderten Renderketten trugen ausschließlich die vier als brauchbar erkannten dieses Vorzeichen | ✅ gelöst |
| **Die Bewertung ist in sich konsistent — das ist der Beleg.** Die zwei als richtig erkannten Zellen (#14, #15) sind derselbe Transform in zwei Zerlegungen (Rx(180°)); die zwei als „180° gedreht" erkannten (#10, #11) ebenfalls (Rx(0°)), und sie liegen exakt 180° daneben. Beide Paare wurden unabhängig vergeben | ✅ Selbstkonsistenz |
| Damit hatte Kujata mit `[0,0,−parentBone.length]` recht. Die frühere Messung „Kujatas Versatzvorzeichen verschlechtert alles" war ein Artefakt der blinden Gütefunktion | ⚠️ Korrektur |
| Wurzelwinkel −90° und Versatzreihenfolge (entlang der **Eltern**-Achse) waren bereits richtig | ✅ bestätigt |
| **Nachweis numerisch:** Die Produktionskette reproduziert wurzelrelativ exakt Konfiguration #15 (Assertion in der Probe) | ✅ verdrahtet |
| **Nachweis gegen Überanpassung:** Drei weitere Modelle in Front-, Seiten- und Draufsicht durch dieselbe Kette — alle aufrecht, Segmente zusammenhängend | ✅ Kontrolle |
| **B7 ist widerlegt:** Der Wurzelpivot liegt in der **Hüfte**, nicht am Bodenkontaktpunkt. Der Höhenversatz zum Walkmesh braucht eine andere Bestimmung | 🔴 neu offen |
| **Die Wurzeltranslation bleibt unbelegt** — sie verschiebt Figur und Pivot gemeinsam und ist damit für Sichtprüfung UND formbasierte Maße unsichtbar. Sie braucht den Bodenkontakt als Referenz | 🟡 offen |

### Die Bilanz von fünf Anläufen

| Anlauf | Gütefunktion | Ergebnis |
|---|---|---|
| 1 | Y ist längste Achse | blind unter 180° |
| 2 | dito über 6 Eulerreihenfolgen | Fehler außerhalb des Suchraums |
| 3 | Anteil über dem Pivot | Wurzel in der Hüfte ⇒ Median ~0,5 |
| 4 | Breite oben/unten | Signal im Rauschen (0,96…1,03) |
| 5 | **50 Bilder, ein Auge** | **entschieden** |

Vier Aggregatmaße haben dieselbe Frage viermal nicht beantwortet — und jedes
sah dabei überzeugend aus. **Für Fragen nach einer Richtung im Raum ist die
Sichtprüfung kein Notbehelf, sondern das schärfere Instrument.** Der Beitrag
der Automatik lag darin, den Suchraum vollständig aufzuspannen, nicht ihn zu
bewerten.

## S28 — Weltkarten-Terrain (`data/wm`), Probe vom 2026-08-10

Werkzeug: `world-probe.rdtest.ts`. Hypothesenquelle: FFNx/ff7-landscaper/Qhimm
(nur Hypothesengeber; jede Zeile unten ist gegen die eigenen Daten gemessen).
Overlay-Hinweis: `mods/` existiert und enthält wm-/world-Pfade — gemessen wurde
ausschließlich `data/wm` (Originalbestand).

| Befund | Status |
|---|---|
| Bestand: WM0/WM2/WM3 je als `.MAP` (69/12/4 Blöcke) und `.BOT` (332/48/16 Blöcke), ALLE sechs Dateien exakte Vielfache von 0xB800 (47104 B); dazu 4 Sprach-LGPs gleicher Größe | ✅ Inventar |
| **Blockgrammatik:** je Block 16 u32-Offsets (blockrelativ, erster = 0x40, monoton) auf LZS-Meshes (u32 Länge + Strom): **85/85 MAP-Blöcke**, um 2 B verschobene Kontrolle **0/85** | ✅ Formatfakt |
| **Mesh-Grammatik:** dekomprimiert `u16 triCount · u16 vertCount · tri[12 B] · vert[8 B] · normal[8 B]` — **1360/1360 Meshes byteexakt aufgehend** (Accounting), Lochquote 0 | ✅ Formatfakt |
| **Vertex:** i16 x · i16 h · i16 z · u16 — x,z ∈ [0, 8192] in 1104/1104 WM0-Meshes, h frei (−1269…4086) ⇒ Mesh-Grundriss 8192², Block = 4×4 Meshes = 32768² | ✅ Formatfakt |
| **Nahtstetigkeit** (Bildkohärenz-Analogon): benachbarte Meshes teilen Randpunkte (t,h) **828/828 Paare perfekt (Quote 1,0)**; Nullwert-Zweitrechnung: ohne 541 Flachpaare bleiben 287 strukturierte Paare bei 1,0; Fremdpaar-Kontrolle 0,56 | ✅ Formatfakt |
| **Blockanordnung WM0:** Primärraster **9 Spalten × 7 Zeilen** (Blöcke 0–62): Blockgrenz-Nähte 440/440 perfekt (1,0); Kontrollanordnung 7×9: 0,764 (Ozeanflächen matchen trivial — deshalb ist nur die 1,0 beweisend) | ✅ Formatfakt |
| WM0-Blöcke 63–68: 6 Alternativblöcke (Story-Varianten). Welcher Block welche Rasterzelle ersetzt und woran das Script das schaltet | 🔴 offen (S29-Kandidat) |
| **`.BOT`-Dateien:** identische Block-/Mesh-Grammatik, alle 6336 Meshes exakt; Digest-Kreuzvergleich: **Unikatmengen von MAP und BOT sind identisch** (512/512, 190/190, 12/12) ⇒ keine eigene Geometrie, nur andere Anordnung derselben Meshes | ✅ gemessen; Zweck der Anordnung 🟡 |
| Dreiecks-Byte 3, untere 5 Bits: 25+ verschiedene Werte mit plausibler Häufigkeitsordnung (Klasse 3 dominiert = Wiese?); obere 3 Bits fast nur 0/1 | 🟡 Wertevielfalt belegt, SEMANTIK unbelegt — Geländeklassen-Matrix bleibt austauschbare Tabelle (S29) |
| Dreieck 12 B: v0/v1/v2 u8 (⇒ ≤256 Verts/Mesh), Byte 3 = Attribut, 6 B UV-Kandidaten, u16 Texturwort | 🟡 nur Längen belegt; UV/Textur-Deutung braucht den Texturpfad |
| Sprach-LGPs: gleich groß, byteweise VERSCHIEDEN (Stichprobe); `world_gm.lgp`: 985 Einträge — .tex 415, .p/.rsd je 228, .a 77, .hrc 29, **.ev 3**, .tbl 2, .bin 1, .ta 1, 1 ohne Endung | ✅ Inventar; Modellkette = bekannte S7-Formate |
| Die 3 `.ev`-Einträge (WM0/2/3-Scripts?) und der endungslose Eintrag (Texte?) | 🟡 S29-Gegenstand |
| **WM2-Anordnung: 3 Spalten × 4 Zeilen** (Naht-Quote 0,985 über 68 Paare gegen 0,40–0,53 aller Alternativen; die fehlenden 1,5 % sind wenige Paare — 🟡 Randnotiz, Zerlegung selbst unstrittig) | ✅ gemessen |
| **WM3-Anordnung: NICHT messbar** — alle Kandidatenbreiten liefern Quote 1,0, weil das Schneefeld nur 12 Unikate auf 64 Meshes trägt (die Gütefunktion ist gegen die Anordnung blind, klassischer Fall). Default 2×2 als dokumentierte Annahme | 🟡 Annahme, nicht Befund |

## S33 — Kampf-Integration: outcome-Probe, O9-Restposten (2026-08-10)

Werkzeuge: `battle-outcome-probe.rdtest.ts`. ADR: [ADR-026](../../docs/ADR-S33-KAMPFINTEGRATION.md).

| Befund | Status |
|---|---|
| **outcome-Zielvariable: belastbarer NEGATIVBEFUND.** Ausgesprochene Annahme: „Das Original spiegelt den Kampfausgang in eine Script-Variable, verzweigende Skripte lesen sie kurz nach `BATTLE`." Messung über 189 BATTLE-Vorkommen (68 mit IF im 8-Instruktionen-Fenster): Top-Adresse bank5/addr0 mit 38,2 % — aber Faktor **2,83** gegen die MAPJUMP-Kontrolle und Faktor **1,04** gegen die um 12 Instruktionen verschobene Kontrolle. Die verschobene Kontrolle ist der Killer: Dieselbe Adresse wird weit nach dem Kampf genauso oft gelesen — sie ist populär, kein Ausgangs-Spiegel. **Unter Faktor 3 ⇒ kein Befund; der Interpreter schreibt weiterhin nichts** (die S17-Haltung bestätigt sich) | 🔴 bleibt offen — bewusst |
| **O9-Restposten geschlossen:** Die vier Makou-Kampf-Opcode-Längen einzeln nachgemessen — 0x22→4: 48004/48004 (gleich), 0x23→2: **48002** (schlechter), 0x4B→1: gleich, 0x72→2: gleich. Keine verbessert den Abschluss; die eigene Tabelle bleibt (Baseline 48004/48041 = 99,92 %) | ✅ gemessen statt verwiesen |
| Zufallskämpfe: Ratenmodell 🔵 (`encounter.ts`) auf dem Formatfakt Sektion 7; Fixture-Abnahmen: Ratenordnung messbar, Rate 0 und `BTLON`-Aus ⇒ 0 Kämpfe, IDs ausnahmslos maskiert (die maskenlose Auslegung läge außerhalb des 10-Bit-Raums), Schrittzähler snapshot-fest (Schema 2 → 3) | ✅ Modell steht; Original-Schrittmodell 🔴 |
| Modus-Vertrag: Replay über die Modusgrenze bitidentisch + Gegenprobe; Save→Load nach dem Kampf digestgleich; ADR-011-Stub bleibt Testmodus | ✅ Fixture-Abnahmen |

## S32 — Battle-Darstellung: Komposition, Kamera, Sichtnachweis (2026-08-10)

Werkzeuge: `battle-model-sheet.rdtest.ts` (Bildtafel, derselbe Rasterizer wie
die R4-Tafeln), Kameramessung in der Exploration (Szenen-Kamerablock).

| Befund | Status |
|---|---|
| **Battle-Modellkonvention sichtgeprüft** (Tafel: 14 Modelle × 6 bzw. 4 Varianten): Kindversatz **+len** (Field: −len!) und Wurzel-Zusatzdrehung Frame-X 270° (netto Rx(180°) im Modellraum). In der Siegervariante sind Cloud (Frisur, Gesicht, Schwert über der Schulter), Barret und der Laternenträger klar erkennbar und aufrecht; alle Kontrollvarianten liegen/kopfüber. Unabhängige Stütze: KimeraCS versetzt Battle-Bones mit +len — genau die „Kopplungsfalle", die der `.a`-Abschnitt vermerkt hatte, ist damit aufgelöst: Vorzeichen UND Wurzelwinkel mussten GEMEINSAM gedreht werden | 🟢 sichtgeprüft (Standbild-Abnahme aus S30 erledigt) |
| **Damit auch die Kompositionsregel gestützt:** „k-ter Flag-1-Bone ← k-te Geometriedatei in Suffixordnung" — die Figuren sind zusammenhängend, Texturen sitzen (Tonberry-Laterne, Cloud-Gesicht). Die 125 „+1"-Präfixe: überzählige Datei bleibt unzugeordnet und gemeldet (Waffen-Kandidat, 🟡) | ✅ tragfähig, 🟡 Rest |
| **Szenen-Kamerablock (48 B je Formation) gedeutet:** 3 Kameras à 12 B (i16 Position x,y,z + i16 Ziel x,y,z) + 6×0xFFFF-Füllung. Messungen: Füllwörter ausnahmslos −1 (100 %), Kamera-y ausnahmslos negativ (über dem Boden; FF7-y zeigt abwärts), Ziel-x überwiegend 0 (Bühnenmitte) | ✅ belegt (🟡 Rollen der 3 Kameras) |
| `camdat0–2.bin`: beginnen mit PSX-RAM-Zeigern (0x801A…) — Deutung braucht die Ladebasis; **nicht angegangen** | 🔴 offen |
| Stage-Format (welcher `location`-Wert welche Bühne lädt, Bühnengeometrie): unbelegt — Darstellung nutzt die dokumentierte 🔵-Ersatz-Stage | 🔴 → 🔵 |
| **Effektabdeckung: 0 % belegt** (magic.lgp-Formate 🔴) — JEDE Aktion bekommt die dokumentierte Ersatzdarstellung; die Quote wird vom ViewModel mitgeführt und berichtet | ✅ ehrlich berichtet |
| **Wirkungsfreiheit strukturell erzwungen:** Die Darstellungsschicht (`BattleViewModel`) konsumiert ausschließlich Tick-ERGEBNISSE, kein Rückkanal; Digest-Gleichheit mit/ohne Darstellung ist Fixture-Abnahme | ✅ erste Abnahme des Bogens |
| Offen (S32-Restpunkte): Golden-Screenshots je Kampfphase im GPU-Pfad, NFR-Messung auf dem Referenzgerät, Battle-Animationsformate `ab`/`da` (🔴) — Standbild ja, Bewegtdarstellung nein | 🟡 dokumentiert |

## S31 — Gegner-KI-Grammatik und Battle-Runtime (2026-08-10)

Werkzeuge: `battle-ai-probe.rdtest.ts`. Verfahren: S12 (Spannen-Abschluss +
Koordinatenabstieg) — mit zwei NEU dokumentierten Blindheiten der
Gütefunktion, die hier beide zugeschlagen haben.

| Befund | Status |
|---|---|
| **Handler-Tabelle:** Jedes Gegner-KI-Skript beginnt mit 16×u16-Offsets — **614/614** monoton, erster belegter Offset **ausnahmslos 32**; Handler-Spannen = [off_i, off_{i+1}) | ✅ Formatfakt |
| **Doppelte Blindheit des Spannen-Abschlusses:** (a) Die NULLTABELLE besteht „Durchlauf landet exakt auf dem Ende" trivial (bytewese Vorrücken landet immer); (b) auch „…und die letzte Instruktion ist Terminator" ist trivial (das letzte Byte IST der Terminator). Der freie Abstieg ÜBERFITTETE anschließend selbst die kombinierte CFG-Gütefunktion (verbog die Push-Familie 0x00→0) — die Ergebnistabelle stützt sich deshalb auf UNABHÄNGIGE Messungen je Familie, nicht auf den Abstieg | ⚠️ zwei Methodenlehren |
| **String-Op 0x93 endet mit 0xFF — 0x00 ist TRENNZEICHEN im Text.** Sichtbar an ASCII-Debugtexten im Bytecode; die naheliegende NUL-Terminierung zerlegt 219 Spannen falsch | ✅ Formatfakt (Korrektur einer naheliegenden Annahme) |
| **0x72 trägt einen u16-Operanden und ist NICHT der Terminator** (wiederkehrende `72 XX 00`-Tripel; kein einziges Spannenende auf 0x72). Terminator ist **0x73** (722/941 Spannenenden; Rest = Mehrfachausgänge) | ✅ realdaten-entschieden, Community-Angabe korrigiert |
| **Operandenlängen eingefroren:** Push 0x00–0x03 je 2 (Adressoperanden clustern in 8 Bänken: 95,0 % von 9884), Immediate-Treppen 0x10–0x13 = 1/2/3/4 und 0x60–0x62 = 1/2/3, Sprünge 0x70/0x71/0x72 je 2, 0xA0/0xA1 = 2 (🟡 indifferent), Rest 0. **Spannen-Abschluss 938/941 = 99,68 %**; die 3 Reste sind dokumentiert (🟡) | ✅ Ziel ≥ 99 % erfüllt |
| **Sprungziele sind HANDLER-relativ:** 7969/8177 = 97,5 % auf Instruktionsgrenzen (0x70/0x71 allein: 99,5 %); Kontrollen: skript-relativ 33 %, +1 verschoben 19 % (erhöht, weil 1-Byte-Instruktionen fast jede Position zur Grenze machen — der Abstand trägt) | ✅ Formatfakt |
| **0x70 ist bedingt, 0x71/0x72 unbedingt.** Diskriminator: Der Nachfolger eines unbedingten Sprungs ist nur als Sprungziel erreichbar — 0x70: 0,0 %, 0x71: 69,2 %, 0x72: 77,7 % | ✅ gemessen; semantischer Unterschied 0x71↔0x72 🟡 |
| **VM-Abdeckungslauf** (UNKNOWN-Politik wie S29): Haupthandler aller 614 Skripte — **613/614 enden regulär** (1 bad-jump-Abbruch in einem Restspannen-Skript), 0 Budget-Hänger; unknown-Quote 20,2 %; mit Null-Speicher wählen 194/614 bereits eine Attacke per 0x92 (Rest verzweigt speicherabhängig → 🔵-Rückfallpfad der Runtime) | ✅ Abdeckung gemessen; Stack-Semantik 🟡 Fixture-Festlegung; Speicherbelegung 🔴 |
| Battle-Speicher-Adressraum (Push-Bänke 0x00/0x20/0x40/0x41/…): Belegung unbelegt — die Runtime führt einen Scratch-Speicher (Stores rücklesbar) und meldet unbekannte Lesezugriffe als Quote | 🔴 → 🔵 dokumentiert |
| ATB/Schadensformeln/Trefferquoten/Zielwahl: **kein Formatgegenstand** — als austauschbarer 🔵-Formelsatz umgesetzt (`battle-runtime/formulas.ts`); Kampfverläufe sind reproduzierbar und in sich stimmig, aber NICHT zahlengleich mit dem Original (Release-Notes-Pflicht aus der Roadmap) | 🔵 Eigenentwurf |

## S30 — Kampfdaten: scene.bin, battle.lgp, kernel 0–2 (2026-08-10)

Werkzeuge: `battle-probe.rdtest.ts` (Grammatik-Erschließung),
`battle-sweep.rdtest.ts` (Produktionsparser). Hypothesengeber: Qhimm-Wiki —
zwei Angaben wurden von den Daten korrigiert (s. u.).

| Befund | Status |
|---|---|
| **Strukturvorhersage hält punktgenau:** scene.bin = 34 Blöcke à 0x2000, je Block 16 u32-Zeiger in 4-Byte-Einheiten (Kontrolle „Byte-Offsets": 0/256 Magics) auf gzip-Ströme → **256 Szenen × 4 Formationen = 1024** — exakt der Adressraum der 10-Bit-Kampf-ID. Die Vorhersage stand VOR der Zerlegung | ✅ Formatfakt |
| **Alle 256 Szenen entpacken exakt auf 7808 B (0x1E80)**; Accounting Zeigertabellen + Ströme + Füllung == Dateigröße byteexakt; die Füllung ist in allen 23.884 Füllbytes **ausnahmslos 0xFF** | ✅ Formatfakt |
| **Dekodier-Fallstrick:** Die Ströme tragen Nachlauf-Füllung — strikte gzip-Dekoder (auch `DecompressionStream`) lehnen das ab. Da ein gzip-Strom mit ISIZE endet (MSB hier nie 0xFF), liefert **0xFF-Lauf abstreifen** exakt den Strom; danach dekodieren 256/256 STRIKT inklusive CRC-Prüfung. Browsertauglich ohne eigenen Inflater | ✅ Strategie belegt |
| **Szenen-Partition byteexakt:** IDs 8 B · Setup 4×20 B · Kamera 4×48 B · Formationen 4×6×16 B · Gegner 3×184 B · Attacken 32×28 B · Attack-IDs 64 B · Attack-Namen 32×32 B · Formation-KI [0xC80,0xE80) · Gegner-KI [0xE80,0x1E80) — Summe exakt 0x1E80 | ✅ Formatfakt |
| **Korrektur 1 an der Community-Beschreibung:** Die Gegner-KI-Offsettabelle liegt bei **0xE80**, nicht 0xF00 (dort steht Text). Sweep 0xC00–0x1400 mit Kriterium „3 monotone Offsets + Korrelation Slot⇔Gegner": Sieger 0xE80 mit **241/256** gegen 15/256 (nächster unabhängiger) und **0/256 bei 0xF00** | ✅ realdaten-entschieden |
| **Referenzschluss 1:** Alle **2414/2414** belegten Formationsplätze referenzieren einen der 3 Szenen-Gegnertypen (Kontrolle Nachbarszene: 25,1 %). 3730 leere Plätze (0xFFFF) getrennt gezählt | ✅ Formatfakt |
| **Referenzschluss 2:** Alle **2509/2509** belegten Gegner-Attack-IDs (@0x48) liegen in der Szenen-Attacktabelle (@0x840); Kontrolle Nachbarszene 28,6 % | ✅ Formatfakt |
| **Referenzschluss 3:** Alle **434/434** Kampf-IDs der Encounter-Tabellen (Sektion 7, maskiert & 0x3FF) lösen auf nicht-leere Formationen auf (1000/1024 Formationen tragen Gegner). ⚠️ Die Verschiebe-Kontrolle ist hier blind (auch id+1 trifft meist) — der Schluss stützt sich auf die Vollständigkeit, nicht auf den Kontrollabstand | ✅ geschlossen |
| Gegner-Record: **HP = u32@0xA4** (627/627 in [1,10⁶], Kontrolle @0xA3: 76,2 %), **Level = u8@0x20** (627/627 in [1,99]), **EXP = u32@0xA8** (Konkordanz mit Level 0,869 gegen 0,642 bei Byteversatz; Nullwert-Zweitrechnung: 36 EXP-0-Gegner = Story-Bosse ausgenommen). 141 unbenutzte Gegner-Slots (ID 0xFFFF) getrennt | ✅ belegt |
| Gegnernamen (32 B @Record-Anfang) dekodieren mit der S13-Tabelle (Versatz 0x20): 615/617 vollständig, Deutsch-Maß 0,707 gegen 0,361 bei falschem Versatz | ✅ belegt |
| Stat-Bytes @0x21–0x27 (speed/luck/…): u8-Werte tragen keine messbare Ordnung — Reihenfolge bleibt Community-Deutung | 🟡 roh konserviert |
| Formation-KI @0xC80: nur 12/1024 Formationen tragen ein Skript, alle 12 Offsets im Bereich | ✅ konsistent (dünn belegt) |
| **battle.lgp-Namenskonvention:** ausnahmslos **11.119 4-Buchstaben-Namen** ohne Endung; **481 Präfixe**, jedes mit genau einem `aa`; die 1798 W-LGP-SHADOWED aus S1 sind KEINE TOC-Duplikate (0 Duplikatnamen) — sie stammen aus der Lookup-Bucket-Struktur | ✅ Inventar |
| **Battle-Skelett `**aa`: 52-B-Kopf + 12 B je Bone — 481/481 byteexakt** (Accounting über den GESAMTBESTAND). Bone = **i32 parent** (Vorwärtskette 11.026/11.026) · **f32 length** (fast ausnahmslos negativ — die −len-Konvention aus R4-B1) · **u32 Flag ∈ {0,1}** (7510× 1, 3516× 0). Masterplan 1.1 bestätigt: NICHT die `.hrc`-Konvention | ✅ Formatfakt |
| **Suffix-Klassifikation über Inhalts-Signaturen** (S7-Parser als Messgerät): `aa` = Skelett, `ae`–`ai` = **TEX**, `am` und alles Weitere = **`.p`-Geometrie** (alle Stichproben 100 % eindeutig), `ab`/`da` = eigenes Format (Animationsskript/Animationsdaten) | ✅ gemessen; `ab`/`da`-Grammatik 🔴 |
| **Modell-Referenzschluss: Gegner-ID → Basis-26-Präfix, `<präfix>aa` existiert 354/354.** ⚠️ Die id+1-Kontrolle ist blind (ID-Raum 0..369 mit nur 16 Lücken, dichter Namensraum) — die Zuordnung stützt sich auf die exakte Arithmetik und braucht den S32-Sichtnachweis | ✅ geschlossen, 🟡 Kontrolle blind |
| Kompositionsregel „k-ter Flag-1-Bone ← k-te Geometriedatei": exakt in 356/481 Präfixen; 125 Abweichungen um +1 Datei (Waffen?) | 🟡 S32-Gegenstand |
| **kernel.bin Sektion 0 = exakt 32×8 B (Commands), Sektion 1 = exakt 128×28 B (Attacken)** — Recordlayout der Attacken identisch zur Szenen-Attacktabelle | ✅ Formatfakt |
| **Growth-Sektion (Sektion 2, 3988 B):** 9 Charakter-Records à 56 B (81/81 Kurvenindizes < 64; HP/MP/EXP-Bänder **37–45/46–54/55–63 exakt getrennt**, je 9 verschiedene) + 3×12 B Gewinn-Tabellen (monoton) + **64 Kurven à 16 B ab 0x21C** + 2424 B Rest (🟡 roh). Kurvenbasis AUS DEN DATEN: EXP-Block = längster (grad,0)-Paarlauf @0x58C → Basis 0x21C; alle 9 EXP-Kurven tragen Basis 0 in allen 8 Paaren, die um 4 B verschobene Kontrolle nicht | ✅ Formatfakt |
| Kurven-SEMANTIK (welche Formel aus grad/base Werte macht): nicht in den Daten — bleibt 🔵-Eigenentwurf (Zusatzregel 3) | 🔴 → 🔵 |
| Inventar: magic.lgp 3454 Einträge (.tex 670, .rsd 618, .p 585, .s 357, …), camdat0–2 49.044/42.552/42.760 B, Stage-Zuordnung der `location`-Werte (90 verschiedene) | 🟡 S32-Gegenstand |

## S29 — World-Script (`.ev`) und Fahrzeugproben, 2026-08-10

Werkzeuge: `world-ev-probe.rdtest.ts`, `world-vehicle-probe.rdtest.ts`.
Hypothesengeber: ff7-landscaper/Qhimm (Beschreibung, keine Autorität — zwei
Beschreibungen wurden von den Daten korrigiert, s. u.).

| Befund | Status |
|---|---|
| `world_gm.lgp` trägt drei `.ev` à exakt 0x7000 B (wm0/wm2/wm3) | ✅ Inventar |
| **Call-Tabelle fix 0x400 B**: bis 256 Paare (u16 Kennung, u16 Wortoffset relativ zu Wort 512), 0xFFFF-Sentinel; Kennungstyp = Bits 14–15 (0 System, 1 Modell mit Modellnummer in Bits 8–13, 2 Mesh); IDs monoton; jedes Funktionsziel liegt am Codeanfang oder direkt hinter 0x203/0x100 (143+26+38 = 207/207) | ✅ Formatfakt |
| **Methodische Lehre (teuer):** Eine dynamisch gelesene Tabelle (Ende am Sentinel) setzte die Codebasis auf Wort 288 statt 512 — ALLE Sprungmessungen lagen dadurch exakt auf Kontrollniveau. Wenn jede Deutung „zufällig" aussieht, zuerst den BEZUGSRAHMEN anzweifeln, nicht die Deutungen | ⚠️ dokumentiert |
| **Grammatik:** u16-wortbasierte Stack-Maschine mit EIGENER Opcode-Menge. Operandenlängen: Push-Familie 0x110/114/117/118/119/11b/11c/11d/11f und Sprünge 0x200/0x201 je 1 Wort, alle übrigen beobachteten 0; 0x203 beendet. **Funktions-Abschluss 175/175** | ✅ Formatfakt |
| **Sprungziel = codebasis-relative Wortadresse: 732/732 auf Instruktionsgrenzen** (Kontrollen: +1-Verschiebung 62 %, funktionsrelativ 36 %); alle Sprünge im Bestand vorwärts (Assembler/VM erlauben rückwärts innerhalb der Funktion) | ✅ Formatfakt |
| **Grammatikfrage der Roadmap ENTSCHIEDEN:** Die Field-Bytetabelle schließt die World-Funktionen nur zu 24 %/44 %/6 % (gegen 99,73 % auf flevel) ⇒ eigener Interpreter, keine Field-Erweiterung | ✅ gemessen |
| **Mesh-Kennungs-Koordinaten: (Kennung>>4)&0x3FF = zeile·36 + spalte** — die Community-Beschreibung („x = div 36") passt nur 46/49, die Vertauschung **49/49** ins 36×28-Raster. Zweite korrigierte Beschreibung dieser Session | ✅ realdaten-entschieden |
| Stack-SEMANTIK der Rechen-/Vergleichs-/Write-Opcodes: per Fixture-Sollverlauf festgelegt (u16-Wrap, Pop-Reihenfolge, Bitzerlegung addr>>3/addr&7) — am Original NICHT belegt | 🟡 dokumentierte Festlegung |
| Kommando-Opcodes (0x204, 0x300er …): **UNKNOWN-Politik** (Fault + überspringen). VM-Lauf über alle 143 wm0-Funktionen: 143/143 enden regulär, 4867 Instruktionen, unknown-Quote 23,6 % (top: 0x305, 0x306, 0x32d, 0x307, 0x303) | ✅ Abdeckung gemessen; Semantik 🔴 |
| **Erreichbarkeitsprobe** (Dreiecksgraph WM0, 142 586 Dreiecke): Wasserkandidat = **Klasse 3** (dominante Klasse der modalen Flachhöhe 0 — die S28-Vermutung „Wiese" war falsch); Matrix „ohne Wasser": 53 614 erreichbar, verdrehte Matrix (nur Wasser, Landstart): **0**, ohne Matrix: 142 586 ⇒ die Matrix ändert die Erreichbarkeit messbar, die Probe ist nicht blind. Erster Anlauf der Wassererkennung („flach auf MINIMALhöhe") traf eine Senke (~300 Dreiecke) — die MODALE Flachhöhe trägt | ✅ Messanlage; Klassensemantik bleibt 🟡, Matrix bleibt austauschbare 🔵-Tabelle |
| Anlass der Mesh-Funktionsausführung (welche Funktionsnummer beim Betreten läuft), Alternativblock-Schaltung (WM0 63–68), Original-Einstiegspunkte World↔Field, Begegnungstabellen der Weltkarte | 🔴 offen |

## O5 — LGP-Check-Code: beide Hypothesen gemessen, beide durchgefallen (2026-08-10)

Die Recherche war erschöpft (vier Implementierungen lesen das Byte und
ignorieren es), also blieb die Messung. Probe:
[lgp-checkbyte-probe.rdtest.ts](src/lgp-checkbyte-probe.rdtest.ts), voller
Archivbestand, Deep-Scan mit Payload.

**Suchmenge, ausgesprochen:** 56 LGP-Dateien einer Installation, 0 mit fatalem
Headerfehler, **45.563 TOC-Einträge**, 0 übersprungen. Davon sind nur **34
Archive inhaltlich verschieden** — der Rest sind byteidentische Kopien aus dem
Sicherungsbaum. Die Minderheitsklasse unten stammt aus **6** verschiedenen
Archiven; die Zahl 766 ist keine Zahl unabhängiger Beobachtungen.

### Die Verteilung entscheidet die Frage vor jeder Korrelation

| Befund | Status |
|---|---|
| Das Byte nimmt im **gesamten Bestand genau zwei Werte** an: **0x0E ×44.797 (98,32 %)**, **0x0B ×766 (1,68 %)**. Entropie **0,1231 Bit** | ✅ gemessen |
| Je Archiv konstant in **39 von 56** Archiven — in den übrigen 17 kommen beide Werte vor | ✅ gemessen |
| **Damit ist die Prüfwert-Hypothese bereits tot.** Ein Prüfwert über Name oder Inhalt müsste sein Bild ausschöpfen; 0,12 Bit über 45.563 Einträge kann keine Prüfsumme sein. Alles Weitere ist nur noch Bestätigung | ✅ Urteil |

### Prüfwert-Hypothese: 18 Funktionen, alle mit Nachbarkontrolle

Nullmodell ist hier nicht die Null (das Byte ist nie 0), sondern die
**Mehrheitsklasse**: „immer 0x0E" trifft **98,32 %**. Jede Quote wird deshalb
zusätzlich **nur über die 766 Minderheitseinträge** gerechnet, und jede
Funktion zusätzlich über den **Nachbareintrag** (Kontrolle). Aussagekräftig ist
allein der *Vorsprung* vor der eigenen Kontrolle — eine Funktion mit Bild 15
trifft schon zufällig ~6,7 %, eigen wie kontrolliert.

| Funktion (Auszug) | Bild | Treffer | Kontrolle Nachbar | nur Minderheit | Kontrolle Minderheit | Vorsprung |
|---|---|---|---|---|---|---|
| name: Bytesumme & 0xFF | 256 | 0,60 % | 0,60 % | 2,22 % | 0,39 % | +1,83 |
| name: CRC-8 (0x07) | 256 | 0,50 % | 0,48 % | 1,57 % | 0,39 % | +1,17 |
| name: CRC-8 (0x31) | 256 | 0,40 % | 0,41 % | 0,00 % | 0,65 % | −0,65 |
| name: Bytesumme mod 15 | 15 | 7,05 % | 6,97 % | 8,88 % | 5,87 % | **+3,00** |
| inhalt: Bytesumme & 0xFF | 256 | 0,33 % | 0,34 % | 0,13 % | 0,78 % | −0,65 |
| inhalt: CRC-8 (0x07) | 256 | 0,38 % | 0,38 % | 0,52 % | 0,65 % | −0,13 |
| inhalt: Länge & 0xFF | 254 | 0,02 % | 0,05 % | 0,39 % | 0,00 % | +0,39 |
| toc: Offset & 0xFF | 256 | 0,37 % | 0,37 % | 0,39 % | 0,26 % | +0,13 |

| Befund | Status |
|---|---|
| **Keine der 18 Funktionen schlägt das Nullmodell.** Beste Trefferquote überhaupt: 7,05 % gegen 98,32 % | 🔴 Hypothese fällt durch |
| **Kein Vorsprung vor der eigenen Nachbarkontrolle.** Größter gemessener Vorsprung auf der Minderheitsklasse: **3,00 Prozentpunkte** (Bytesumme mod 15) — das ist Rauschen einer Funktion mit Bild 15. Zum Vergleich leistet die Endungsregel unten **+97** | ✅ Kontrolle trägt das Urteil |
| Vier CRC-8-Polynome (0x07, 0x31, 0xD5, 0x9B/init 0xFF), Summe, XOR, Längen und Offsets über Name **und** Payload — geprüft, nichts | 🔴 erschöpft |

### Ordnungshypothese: keine Funktion der Position

| Befund | Status |
|---|---|
| **Nicht monoton:** 743 Abstiege über den TOC-Index. Ein Sortierschlüssel dürfte nie absteigen | 🔴 fällt durch |
| **Keine Blockstruktur:** 1.486 Wechsel zwischen Nachbarn beobachtet gegen **1.477,9 erwartet** bei zufälliger Reihenfolge gleicher Zusammensetzung — Verhältnis **1,005**. Die Werte liegen exakt so verstreut, wie es der Zufall vorhersagt | 🔴 fällt durch |
| **Keine Positionsfunktion:** beste Reinheit über `tocIndex mod k` (k = 2…32) liegt bei **98,3188 %** — und das ist auf die letzte Stelle **derselbe Wert wie der Mehrheitsanteil**. Informationsgewinn null | 🔴 fällt durch |
| Auch die dritte Auslegung aus den Quellen („markiert Konflikt- oder Duplikateinträge") ist widerlegt: **2.450** Einträge mit Conflict-Index und **1.798** verschattete Einträge tragen **ausnahmslos 0x0E**; keiner der 766 Minderheitseinträge steht in einer Konfliktgruppe. Die Mengen sind disjunkt | 🔴 fällt durch |

### Was stattdessen trägt: die Eintragsart

| Befund | Status |
|---|---|
| **0x0B steht im gesamten Bestand genau auf den `.hrc`-Einträgen: 766/766, kein Gegenbeispiel in beide Richtungen.** Alle übrigen **87 Endungen** ausnahmslos 0x0E; **0 von 88 Endungen** trägt gemischte Werte | ✅ gemessen |
| **Nachbarkontrolle derselben Regel:** auf der Minderheitsklasse fällt sie von **100 % auf 3,00 %** (gesamt 100 % → 96,74 %, weil die Kontrolle die Mehrheitsklasse gratis mitnimmt). Erst diese Gegenprobe macht die 100 % belastbar | ✅ Kontrolle |
| **Name und Inhalt sind hier nicht trennbar.** Jede `.hrc`-Nutzlast beginnt mit `:HEADER_`; die Inhaltssignatur liefert dieselbe Partition mit derselben Quote (100 % / Kontrolle 96,74 %). Ob der Packer nach Endung oder nach Inhalt entscheidet, kann diese Messung nicht sagen | 🟡 offen und so markiert |
| **Warum der Packer das tut, ist NICHT belegt.** „Skelettdatei", „Textdatei" oder schlicht ein zweiter Packerlauf sind gleich gut mit den Daten vereinbar. Es wird keine Semantik ausgegeben | 🔵 Auslegung, nicht Befund |
| Reichweite der Regel: die Minderheitsklasse stammt aus **6** inhaltlich verschiedenen Archiven (char, magic, world, chocobo, high-us/-fr). Eine Installation, kein Release-Vergleich | 🟡 Grenze der Suchmenge |

### Konsequenz im Parser

| Befund | Status |
|---|---|
| **O5 ist geschlossen — als Messergebnis, nicht als Deutung.** Beide Ausgangshypothesen sind widerlegt, die dritte aus den Quellen ebenfalls. Die Frage ist erledigt statt offen | ✅ abgeschlossen |
| Neue Fehlerklasse **`W-LGP-CHECKBYTE`**, rein warnend, **opt-in** über `ScanOptions.validateCheckByte` (Standard: aus). Sie unterscheidet „Wert im Bestand unbelegt" von „bekannter Wert, falsche Eintragsart" und quarantänisiert nichts — die Regel ist über einen Bestand gemessen, nicht aus dem Format hergeleitet, und darf keinen Import scheitern lassen | ✅ Fehlererkennung nachgeliefert |
| Die Regel steht als eigenes Modul mit ausgeschriebener Herleitung (`packages/formats-lgp/src/check-byte.ts`); der Fixture-Writer führt sie als **Zweitimplementierung**, damit der Roundtrip zwei unabhängige Formatverständnisse vergleicht statt sich selbst | ✅ Projektstandard gewahrt |

## `audio.fmt` — die 48,5 MB sind adressiert, die Datei ist bankweise (2026-08-10)

O1 galt als gelöst und ließ 67,6 % von `audio.dat` als „unadressiert" offen.
Das war kein Restproblem, sondern ein Auslegungsfehler: **`audio.fmt` ist kein
Feld gleich großer Einträge.** Es ist eine Folge von **26 Bänken**; jede Bank
ist eine Folge von 74-B-Klangsätzen und endet mit einer **42 B kurzen
Abschlussmarke** (`Length == 0`, `Offset` = Schreibstand in `audio.dat`,
danach 18 nie beschriebene WAVEFORMATEX-Bytes mit MSVC-Füllmuster `0xCD`).
Der Durchlauf von O1 hielt die erste dieser Marken für das Dateiende.

| Befund | Status |
|---|---|
| **Layout vollständig.** Klangsatz = 24 B Kopf + 18 B `WAVEFORMATEX` + 32 B ADPCM-Zusatz = **74 B**; Abschlussmarke = 24 B Kopf + 18 B = **42 B**. Unterschieden wird am Längenfeld: `Length == 0` ⇒ Abschlussmarke. Der Durchlauf verbraucht `audio.fmt` byteexakt: **724 × 74 + 26 × 42 = 54.668**, Rest **0** | ✅ Formatfakt |
| **Der Beweis ist wieder das Accounting.** Die 724 Klangsätze überdecken `audio.dat` **lückenlos und überlappungsfrei von 0 bis 71.738.528 — 100,0000 %**: 0 Lücken (0 B), 0 Überlappungen (0 B), 0 außerhalb der Datei. Die letzte Abschlussmarke trägt exakt die Dateigröße | ✅ byteexakt |
| **Die Kontrollhypothese ist mitgemessen, nicht behauptet.** Derselbe Lauf mit festem 74-B-Raster und Abbruch beim ersten `Length == 0` liefert 198 Einträge und 23.227.348 B = **32,38 %** — exakt der alte Stand. Die Differenz von 48.511.180 B liegt in den Bänken 1..25 | ✅ Gegenhypothese fällt durch |
| **In den 48,5 MB liegt Audio, keine Füllung.** MS-ADPCM-Prädiktortest über **alle** Blockanfänge (Index < `wNumCoef`): **66.332/66.332 = 100,00 %**. Kontrollen an derselben Satzmenge: Offsets rotiert um 1 → 77,09 %, rotiert um 7 → 58,90 %, Versatz +512 → 26,36 %, Versatz +1 → 6,73 % | ✅ harter Test |
| **Nullwert-Zweitrechnung, getrennt nach altem und neuem Bereich.** Bank 0 (23.227.348 B, 198 Sätze): 19.731/19.731 = 100 %, Kontrolle rotiert 70,38 %. Bänke 1..25 (48.511.180 B, 526 Sätze): 46.601/46.601 = 100 %, Kontrolle rotiert 79,99 %. Der neue Bereich besteht den Test **genauso gut** wie der längst belegte | ✅ beide Teilmengen |
| **Keine trivialen Fälle in der gezählten Menge.** Sätze mit `Length == 0` in der Auswertung: **0**. Die 26 Abschlussmarken sind ausgeschlossen und tragen im Formatteil `0xCD` statt Nullen — sie können keine Quote trivial heben. Genau umgekehrt zum ersten Anlauf, wo mitgezählte Füllbytes die Quote auf 28,9 % drückten | ✅ Fallstrick geprüft |
| **Vier unabhängige Vorhersagen aus dem `WAVEFORMATEX` halten über alle 724 Sätze:** `wSamplesPerBlock` == Microsoft-Formel `((nBlockAlign − 7·ch)·8)/(bits·ch) + 2` **724/724**; `nBlockAlign == 1024 · Kanalzahl` **724/724**; `wNumCoef == 7` mit sieben Koeffizientenpaaren **724/724**; `formatTag 2 / 4 Bit / cbSize 32` **724/724**. Abtastrate ausnahmslos 44100, 716 Sätze mono, 8 stereo | ✅ vier Wege |
| **Feld +8 ⟺ Feld +20 (`Loop` ⟺ `End`): 724/724**, davon 90 mit Schleife (vorher 20 — die 70 zusätzlichen stecken in den Bänken 1..25) | ✅ zweiter Weg |
| **Einheit der Schleifenmarken belegt.** `Start`/`End` sind Byteversätze im **dekodierten PCM16-Strom**: durch `2 · Kanalzahl` geteilt liegen beide Marken in **90/90** Fällen innerhalb der Frameanzahl, `Start < End` in 90/90. Die Kontrolle — Marken direkt als Frames gelesen — trifft in **0/90** | ✅ mit Kontrolle |
| **Wie adressiert wird: flacher Index über alle Klangsätze, Abschlussmarken übersprungen.** Vorhersage „kein `SOUND`-Operand (0xF1) ≥ 724" hält über 702 Fields in **4348/4349 = 99,98 %** (ein einzelner Ausreißer, 1463 — Größenordnung der bekannten Spannen-Fault-Rate). Kontrollmenge (`uint16` unmittelbar vor dem Opcode, gleicher Bytecode, gleiche Verteilung): **71,26 %**. Abstand 28,7 Punkte | ✅ scharfe Vorhersage + Kontrolle |
| **Die beiden Auslegungen sind getrennt:** Zählte das Spiel die 26 Abschlussmarken als Plätze mit (750 statt 724), müssten Operanden im Band 724..749 vorkommen. Es gibt **0** | ✅ trennt sauber |
| **Bankbelegung:** 198, 10, 265, 0, 10, 35, 50, 0, 3, 37, 112, 0×8, 4, 0×6 Sätze. 16 der 26 Bänke sind leer und schieben den Schreibstand nicht weiter — das Muster einer Werkzeugkette, die je Eingabesatz eine Abschlussmarke schreibt, auch wenn nichts anzuhängen war | 🔵 Deutung |
| **Was die Bänke fachlich bedeuten und wer sie auswählt, steht in keiner der beiden Dateien.** Der `SOUND`-Operand adressiert flach über alle Bänke hinweg; eine Bankauswahl kommt in den Felddaten nicht vor | 🔴 offen |
| **Feld +12 (in FF7SND „Count") ist in 724/724 Sätzen 0.** Die Benennung trägt hier nichts; das Feld bleibt unbelegt | 🔴 offen |
| **Negativbefund zu `nAvgBytesPerSec`:** Nur **104/724** tragen den rechnerisch richtigen Wert (22179 mono / 44359 stereo). **620** tragen `21 × nBlockAlign` (21504 bzw. 43008) — ein gerundeter Wert des Erzeugerwerkzeugs. Wer daraus Spieldauern ableitet, rechnet ~3 % falsch; zu nehmen sind `nBlockAlign` und `wSamplesPerBlock` | ⚠️ Falle |
| **Die Lehre — derselbe Fehlertyp wie bei O1, in derselben Datei, zum zweiten Mal.** `54.668 mod 74 = 56`: Ein reines 74-B-Raster kann `audio.fmt` gar nicht füllen. Die 56 unerklärten Bytes wurden als „Rest" abgelegt — dabei sind sie genau `26 × 42 mod 74`, der Fingerabdruck der 26 Abschlussmarken. Dasselbe sagte das Abstandshistogramm aus O1-alt: 87,1 % bei Abstand 74 statt ~100 %, und auf Platz 5 stand **116 B mit 0,7 %** — das ist `74 + 42`, die Marke selbst. Beide Zahlen standen seit O1-alt im Protokoll | ⚠️ die Antwort lag in einer Rechnung, die schon dastand |

**Umgesetzt.** `packages/audio/src/audio-fmt.ts` liest die Bankstruktur und
meldet jeden unverbuchten Rest als Diagnose (`E-AFMT-REST`, `E-AFMT-NOTERM`,
`E-AFMT-TRUNC`) statt ihn zu verschweigen; `auditAudioDat()` ist der
Wahrheitstest als Funktion. Composer in
`tools/fixture-gen/src/audio-composer.ts` (Dualitätsprinzip) — er füllt die
Abschlussmarken absichtlich mit `0xCD`, damit die Fixtures denselben Fallstrick
tragen wie die Realdaten. Proben:
`tools/realdata-scan/src/audio-bank-probe.rdtest.ts` und
`audio-sound-id-probe.rdtest.ts`. **Kein Audiodekoder** — der bleibt der
nächste Schritt, jetzt mit vollständigen Bereichsgrenzen.

## O3b — Sektion 7 erschlossen: Encounter-Tabelle (2026-08-10)

Der S17-Eintrag oben nannte das Layout bereits ✅. Seine vier Vorhersagen
(48 B, Padding genullt, `enabled` zweiwertig, IDs < 1024) waren **notwendig,
aber nicht hinreichend** — jede einzelne besteht **1207 von 1404 Tabellen
trivial, weil sie vollständig genullt sind**, und keine prüft eine
Feldzuordnung. O3b ersetzt sie durch eine Accounting-Vorhersage und einen
Referenzschluss. Proben:
[`encounter-layout`](src/encounter-layout.rdtest.ts) ·
[`encounter-closure`](src/encounter-closure.rdtest.ts).

### Wo die Encounter-Daten liegen

| Befund | Status |
|---|---|
| **Die Zufallskampf-Information ist auf drei Orte verteilt, und die Aufteilung ist gemessen.** Field-Sektion 7 hält *welcher* Kampf *wie oft* vorkommt; `data/battle/scene.bin` hält, *was* ein Kampf ist (Gegner, Formationsgeometrie, Kampfort, KI); `enc_w.bin` in `world_us.lgp` hält dieselbe Frage für die Weltkarte. Der Field-Container trägt **nichts** darüber hinaus — insbesondere keinen Kampfort, weil der aus `scene.bin` kommt | ✅ belegt |
| **Field und Weltkarte teilen sich den Formationsnummernraum überschneidungsfrei.** Sektion 7 erreicht 434 Formationen, `enc_w.bin` 200 — der **Schnitt ist 0**. Sektion 7 fasst **keine** ID unter 256 an (0/434, Szenenbereich 64…244), `enc_w.bin` dagegen 193 von 200 unter 256 | ✅ zwei Wege |
| **Negativbefund: `enc_w.bin` folgt NICHT dem Satzformat der Field-Sektion.** Auf demselben 24-B-Raster gelesen hält die Summenregel dort nur in 19 von 71 belegten Sätzen (in Sektion 7: 197/197). Die Weltkartentabelle ist ein eigener Posten | 🔴 offen (außerhalb O3b) |
| **Ausgesprochene Suchmengen-Annahme** (Pflicht seit dem O3-Fehlschlag): „Die *Zufalls*kämpfe eines Fields stehen vollständig in Sektion 7 dieses Fields, und dort steht nichts anderes." Prüfbar, weil sie erzwingt, dass das Layout die Sektion **byteexakt aufbraucht** — mitgeprüft, hält | ✅ Annahme belegt |

### Das Layout — und wodurch es belegt ist

```text
u8  enabled      0/1  · u8  rate
u16 standard[6]  Wahrscheinlichkeit << 10 | Formations-ID & 0x03FF
u16 special[4]   dito · u16 padding                       = 24 B je Tabelle
2 Tabellen                                                = 48 B je Field
```

| Befund | Status |
|---|---|
| **Accounting: 702/702 Fields exakt 48 B, kein Rest.** 1404 Tabellen, Padding in **1404/1404** genullt, `enabled` genau dann 1, wenn die Tabelle Inhalt trägt (**1404/1404**) | ✅ byteexakt |
| **Der Wahrheitstest ist die Summenprobe, nicht die Plausibilität der IDs.** Sind die oberen 6 Bit Wahrscheinlichkeitsanteile, MUSS ihre Summe über die sechs Standardslots konstant sein. Gemessen: **genau ein Wert, 64, in 197/197 belegten Tabellen** | ✅ Formatfakt |
| **Jede Kontrolle fällt durch.** Bit-Split `>>8`/`>>9`/`>>11`/`>>12`: häufigste Summe nur 19,3 % / 31,0 % / 56,9 % / 55,3 %. Wortbasis um 1 bzw. 3 Byte verschoben: **84 bzw. 82 verschiedene Summen** statt einer. Big-Endian: 84 | ✅ Kontrolle trennt |
| **Nullwert-Zweitrechnung — hier der entscheidende Schritt.** **1207 der 1404 Tabellen sind vollständig genullt; 520 der 702 Fields haben gar keine Zufallskämpfe.** Jede Quote oben ist ohne sie gerechnet; mit ihnen stünde überall 100 %, ohne dass irgendetwas belegt wäre | ⚠️ methodische Pflicht |
| **Zweite, aus dem Layout ERZWUNGENE Vorhersage hält:** 6 Bit fassen höchstens 63, die Summe muss 64 sein — also kann keine belegte Tabelle mit einem einzigen Standardkampf auskommen. Gemessen **197/197**. Die Vorhersage fiel vor der Messung | ✅ zweiter Weg |

### Referenzschluss gegen `scene.bin`

| Befund | Status |
|---|---|
| **Der naheliegende Test taugt nichts — und das ist selbst ein Befund.** „Löst jede ID auf?" besteht **1083/1083** — aber `id+1` und `id+4` bestehen ihn **ebenfalls zu 100 %**, weil 1000 der 1024 Formationen belegt sind. Ein Test, den die Kontrolle genauso besteht, misst nichts | ⚠️ Lehre |
| **Der scharfe Test ist der Kampfort.** Die Zufallskämpfe eines Fields müssen alle am selben Ort spielen. Gemessen: **195/195 Tabellen einheitlich**. Kontrollen: `id+1` 114/195, `id−1` 73/195, `id+4` 116/195, `id+64` 98/195; Neuziehung aus derselben Grundgesamtheit **0/195** | ✅ Referenzschluss |
| **Verschärfung belegt auch die unteren zwei Bit.** Beschränkt auf die 35 Tabellen, in denen allein `id & 3` entscheidet: Kandidat **35/35**, Kontrollen `+1` 9/35, `+2` 5/35, `+3` 8/35, `−1` 14/35. Damit ist `scene = id >> 2`, `formation = id & 3` gemessen, nicht aus 256 × 4 = 1024 geraten | ✅ Sub-Index belegt |

### Die vier Sonderslots — Bedeutung gemessen

| Befund | Status |
|---|---|
| **Sonderslots referenzieren Formationen mit einem Anflugbit, das Standardslots nicht tragen.** Von 328 Standard-IDs trägt genau **eine** ein Bit aus `setup u16@18 & 0x07`. Je Slot: `special[0]` Bit 0x02 in 51/52, `special[1]` 49/50, `special[2]` 10/11, `special[3]` Bit 0x04 in **36/36** | ✅ trennt sauber |
| **Geometrische Gegenprobe bestätigt die Benennung.** Von 328 Standardformationen stehen **327 vollständig vor** der Gruppe, keine dahinter. Von 106 Sonderformationen stehen **59 vollständig dahinter** (Rückenangriff) und **44 gleichzeitig davor und dahinter** (Zangenangriff). Zwei unabhängige Merkmale — Flagbit und Aufstellung | ✅ zwei Wege |

### Was offen blieb

| Befund | Status |
|---|---|
| **`rate` bleibt unerschlossen.** Acht Werte im Bestand (24, 32, 40, 48, 72, 128, 192, 240 — alle Vielfache von 8). Die Schrittzähler-Formel steht in der EXE; Disassemblieren ist ausgeschlossen (Clean-Room). Der Wert wird roh durchgereicht | 🔴 nicht auflösbar ohne zweite Quelle |
| **Wer auf Tabelle 1 umschaltet, ist nicht belegt — aber stark eingegrenzt.** Nur **15 von 702** Fields haben beide Tabellen belegt. Differenzielle Opcode-Häufigkeit liefert **0x4B**: in **14/15** Fields mit zwei Tabellen, aber nur **4/167** mit einer und **6/520** ohne. 15 Fields sind zu wenig für einen Beleg | 🔵 Kandidat, nicht belegt |
| **Deckungsrechnung geht nicht auf:** Von 1000 belegten Formationen erreichen Sektion 7 (434) und die literalen `BATTLE`-Operanden (118) zusammen 469 nicht; `enc_w.bin` deckt davon 197, es bleiben **272**. Kandidaten: `BATTLE` mit Bankvariable statt Literal, Weltkartenskripte, Minispiele | 🟡 Restfrage |
| Drei Slots tragen eine ID bei Anteil 0 — ein Kampf, der nie ausgelöst werden kann. Der Parser reicht ihn durch und zieht ihn nie | 🟡 Kuriosum |

## S29-Nachtrag — World-Kommando-Opcodes und WM0-Alternativblöcke (2026-08-10)

Werkzeuge: `world-cmd-probe.rdtest.ts`, `world-altblock-probe.rdtest.ts` (beide
neu), `world-vehicle-probe.rdtest.ts` (nachgezogen). Hypothesengeber:
**ff7-landscaper**, **wiki.ffrtt.ru**, **FFNx** (nur Teilbestätigung).
**Makou Reactor hat keinen Worldscript-Anteil** (0 Treffer) — als Quelle für
diese Frage ein Fehlschlag, und das ist selbst ein Befund. Zwei
Community-Aussagen wurden von den Daten widerlegt.

*(Überschrift bewusst „S29-Nachtrag": Die Nummer S30 ist im Roadmapbogen für
Kampf I vergeben und inzwischen belegt.)*

### Teil 1 — Stelligkeit der Kommando-Opcodes: das 23,6-%-Loch aus S29

Verfahren: **Anweisungsbilanz als Accounting.** Der Code zerfällt in
Anweisungen ab `0x100` (Stack-Reset); jede muss ihren Stack exakt aufbrauchen.
Das liefert je Anweisung eine Gleichung über den Netto-Deltas; die Pop-Zahl
folgt danach aus den berechenbaren Stacktiefen.

| Befund | Status |
|---|---|
| **2360 Anweisungen** über alle drei `.ev`; das lineare System der Netto-Deltas ist **widerspruchsfrei (0)** und bestimmt **92 von 96** freien Opcodes eindeutig | ✅ Formatfakt |
| **Die Bilanz misst die Trennung, nicht sich selbst.** Dieselbe Rechnung mit Anweisungsgrenze an `0x201` ⇒ **110 Widersprüche**, an `0x110` ⇒ **1833**. Ohne diese Kontrolle wäre „widerspruchsfrei" wertlos, weil ein zu grobes Raster trivial aufgeht | ✅ Kontrolle bestanden |
| **Pop-Zahlen** aus den Stacktiefen für **89 von 92** eindeutig. Offen genau 0x18/0x19/0x1b (Delta 0, Mindesttiefe 1 ⇒ Pop 0 oder 1 nicht entscheidbar) | ✅ gemessen |
| **Nullwert-Zweitrechnung:** 11 der 89 sind 0-stellig und bestehen die Bilanz trivial. Ohne sie bleiben **78 nichttriviale** Stelligkeiten; Belegdichte oben: 0x304 (134×), 0x300 (118×), 0x309/0x303 (je 106×), 0x308 (105×) | ✅ gemessen |
| **Grenze, die die Messung selbst benennt:** 0x305/0x306 (218 Anweisungen) und 0x326/0x327 (3) treten **nur paarweise** auf (unpaarige Vorkommen: **0**). Messbar ist allein die Paarsumme, nicht die Aufteilung | 🟡 Grenze dokumentiert |
| **Referenzabgleich:** von 65 eindeutig gemessenen, in der Referenz benannten Opcodes stimmen **65/65** (Quote 1,0). Kontrolle mit um eine Listenposition verschobener Referenz: **31/65 = 0,477**. Die Aufruf-Familie 0x204–0x223 stimmt zusätzlich 24/24, ist als Kontrolle aber **entartet** (Referenz konstant 1) und wird getrennt gezählt | ✅ gemessen |
| **Referenz WIDERLEGT:** landscaper und Wiki geben 0x305 **und** 0x306 je 1 Pop (Summe 2). Gemessen ist die Paarsumme **1**. Übernommen wird 1/0, weil FFNx 0x306 als den ausführenden Warte-Opcode belegt — die Aufteilung bleibt 🟡 | ✅ realdaten-entschieden |
| **Referenz an eigenen Daten BESTÄTIGT (Sonderregister):** 0x11b nutzt {0,1,4,5,6,7,8,9,10,12,13,14,15,16}, 0x11f genau {2,3}, 0x117 {11} — **überschneidungsfrei und zusammen lückenlos 0–16**. Unter der Byte-/Wort-Deutung müsste Wort 2 die Bytes 4/5 überdecken (2 Kollisionen); sie sind getrennt belegt | ✅ realdaten-entschieden |
| **Scharfschaltung, am Bestand gemessen:** VM über alle 143 wm0-Funktionen — **unknown-op 0** (S29: 23,6 %), **stack-underflow 0**, 143/143 regulär (83 durchgelaufen, 60 an einem Wartepunkt angehalten) | ✅ Abdeckung |
| **Semantikprobe (0x308/0x309):** Der Einstiegsschalter auf Sonderregister 6 liefert 48 Ortseinträge. Mit 0x308 = Mesh-Zelle und 0x309 = Lage im Mesh liegen **43/48 = 0,896** auf Nicht-Wasser, die Karte selbst nur zu **0,337** (2000 Zufallspunkte). Alle Zellen im 36×28-Raster, Lagewerte in [51, 8104] ⊂ [0, 8192] | ✅ gemessen |
| Bedeutung der übrigen Kommandos (Fenster, Kamera, Modelle, Ton …) | 🔴 unbelegt — die VM führt sie als **Daten** aus (`script-command`-HostRequest), nicht als Wirkung |
| 0x301 kommt im Bestand nicht vor und steht in keiner Quelle | 🔴 UNKNOWN-Politik bleibt |

### Teil 2 — WM0-Alternativblöcke 63–68

Am **Terrain** entschieden, ohne Script und ohne Referenz, mit zwei
unabhängigen Maßen über je alle 63 Kandidatenzellen (die 62 falschen Zellen
sind die Kontrolle).

| Alt-Block | ersetzt Zelle | Raster (Zeile, Spalte) | Mesh-Identität | Naht-Quote | Kontroll-Median |
|---|---|---|---|---|---|
| 63 | **50** | 5, 5 | 15/16 | 1,0000 | 0,3922 |
| 64 | **41** | 4, 5 | 4/16 | 1,0000 | 0,3400 |
| 65 | **42** | 4, 6 | 15/16 | 1,0000 | 0,0548 |
| 66 | **60** | 6, 6 | 14/16 | 1,0000 | 0,5695 |
| 67 | **47** | 5, 2 | 14/16 | 0,9671 | 0,4605 |
| 68 | **48** | 5, 3 | 14/16 | 0,9669 | 0,3691 |

| Befund | Status |
|---|---|
| **Zuordnung [50, 41, 42, 60, 47, 48]** — zwei unabhängige Maße, dieselbe Antwort, kein Gleichstand | ✅ Formatfakt |
| **Referenzdeckung:** landscaper und Wiki nennen dieselbe Reihenfolge — festgestellt **nach** der eigenen Messung, nicht davor | ✅ |
| **Was sich ändert:** Block 64 ändert 11/16 Meshes (Lage, UV, Textur, Normalen) — die Junon-Änderung liegt praktisch vollständig dort. 63/66/67/68 ändern 1–2 Meshes. **Block 65 unterscheidet sich von Zelle 42 nur in den NORMALEN eines Meshes**, ist also geometrisch identisch | ✅ gemessen |
| **Umschaltung: 0x349**, ausschließlich in der Initialisierungsfunktion (7 Vorkommen), über eine **monotone Schwellenkaskade auf Savemap-Wort 0**: ≥638 → 1, ≥1000 → 2, ≥1197 → 3, ≥1199 → 3 oder 4 (bitabhängig); sonst 0. Wertemenge exakt {1,2,3,4} + Vorgabe 0 = **5 Stufen** | ✅ gemessen (Struktur) |
| **NEGATIVBEFUND, mit validierter Suche:** **Kein** Kommando-Opcode trägt an **keiner** der vier Literal-Operandenpositionen die Blöcke 63–68 oder die sechs Zielzellen über Rauschniveau (99 geprüfte Opcode/Positions-Stellen über alle drei `.ev`). Die Suche ist validiert, weil dieselbe Suche 0x308 als Mesh-Zellen-Träger findet (>20 Unikate). Die Umschaltung steht **nicht als Blockindex im Script** — 0x349 trägt eine **Stufe** | ✅ Negativbefund |
| **Kopplung Stufe → Alternativgruppe: nicht belegbar.** Keine Quelle stellt die Tabelle auf, und die eigene Gütefunktion ist **blind** — auch die Alternativblöcke haben perfekte Ränder zu den Primärnachbarn (Naht 1,0), die Änderungen liegen im Blockinneren | 🔴 / 🔵 kumulative Stufenregel dokumentiert |
| **Community-Beschreibung korrigiert:** Das Wiki schreibt „the last 5 meshes 63, 64, 65, 66, 67 and 68" — sechs Indizes unter der Überschrift „5", und nennt Blöcke „meshes". An den Daten eindeutig: **6 Blöcke à 16 Meshes**. Die zusätzlich vermutete Gold-Saucer-Variante existiert nicht; es sind genau vier Gruppen | ✅ realdaten-entschieden |

---

## F06 / F11a — `field.tbl` und die Zerlegung des Texturworts (2026-08-11)

Probe: `tools/realdata-scan/src/world-fieldtbl-probe.rdtest.ts`.
Gegenstand: `field.tbl` aus `world_us.lgp` sowie das Dreiecks-Texturwort in
WM0/WM2/WM3.MAP. Hypothesengeber waren `docs/quellen/ff7-landscaper.md`
§3.1/§5 und `gaia.md` §5 — belegt wurde ausschließlich gegen die eigenen Daten.

### `field.tbl` — Accounting

| Größe | Wert |
|---|---|
| Dateilänge | **1536 B = 64 × 24**, Rest **0** |
| Datensatz | 2 Einträge à 12 B (Slot 0 „default", Slot 1 „alternative") |
| Eintrag | i16 x · i16 y · u16 triangle · u16 fieldId · u8 direction · 3 B Padding |
| Belegung | 65 von 128 Einträgen belegt (58 default, 7 alternative), 63 vollständig genullt |
| Wertebereiche | x −2019…5907 · y −9530…3460 · triangle 0…263 · fieldId 70…744 · direction 0…248 |

Die 63 genullten Slots sind aus **allen** Quoten herausgerechnet (Regel 3:
Nullwerte bestehen die meisten Tests trivial).

### `field.tbl` — vier Vorhersagen, je mit Kontrolle

| # | Vorhersage | Treffer | Kontrolle | Status |
|---|---|---|---|---|
| K1 | Padding wiederholt das Richtungsbyte (4× dasselbe Byte) | **65/65** | dieselbe Regel an Byteposition 5/6/7: **0/65, 0/65, 0/65** | ✅ |
| K2 | `fieldId` löst über die `maplist` auf einen existierenden flevel-Eintrag auf | **65/65** | Position −2/−1/+1/+2 B: **22/65, 1/65, 0/65, 0/65**; Zufalls-ID aus demselben Bereich: 58/65 (**trägt nicht** — die `maplist` ist dicht) | ✅ |
| K3 | `triangle` < Dreiecksanzahl im Walkmesh des Zielfelds | **65/65** | permutierte Feldzuordnung: 54/65 (schwach) — ohne den einen Nullwert 64/64 gegen 53/64 | ✅ schwach |
| K4 | **(x, y) liegt IM Walkmesh-Dreieck `triangle` des über `fieldId` aufgelösten Feldes** | **65/65** | anderes Dreieck desselben Feldes: **0/65**; permutiertes Feld: 11/65 | ✅ **tragend** |

K4 prüft alle vier Felder gemeinsam und ist der eigentliche Beleg: eine falsche
Feldgrenze, ein falsches Zielfeld oder ein falscher Dreiecksindex kann diese
Vorhersage nicht erfüllen. Damit ist der 🔴-Posten „Originalquelle der
World→Field-Einstiegspunkte" (ADR-S28-S29 Punkt 7) geschlossen.

### Opcode `0x318` — Operandendeutung, ebenfalls gemessen

Musterscan `PUSH a · PUSH b · 0x318` über wm0/wm2/wm3.ev. Der Opcode kommt im
gesamten Bestand **89×** vor und **alle 89** tragen beide Operanden als direkt
vorangehende Immediates — es gibt keine berechnete Aufrufstelle, die Stichprobe
ist die Vollerhebung.

| Deutung | belegter Slot getroffen | davon Szenario 1 |
|---|---|---|
| args = (Datensatz **1-basiert**, Szenario) | **89/89** | **9/9** |
| args = (Datensatz 0-basiert, Szenario) | 75/89 | 0/9 |
| Kontrolle: Operanden **vertauscht** | **0/89** | — |

Zusätzlich: `b` ∈ {0,1} in **89/89** Fällen; `a` liegt im Bestand exakt im
Bereich **1…64**. Die 1-basierte Lesart ist damit realdaten-entschieden — der
schärfste Diskriminator sind die Szenario-1-Aufrufe, weil es nur **7** belegte
alternative Slots gibt.

### Texturwort — `textureId`, `locationId`, Flagbit

| Karte | Dreiecke | `textureId`-Unikate | Wertebereich | lückenlos ab 0 | `locationId` (5 Bit) | Bit 14 | Bit 15 |
|---|---|---|---|---|---|---|---|
| WM0.MAP | 157 791 | **282** | 0…281 | ja | 18 Unikate, max 17 | **0** | 1004 |
| WM2.MAP | 9 967 | **8** | 0…7 | ja | 2 Unikate, max 18 | **0** | 0 |
| WM3.MAP | 8 268 | **4** | 0…3 | ja | 1 Unikat, 11 | **0** | 0 |

Die Zählungen 282/8/4 decken sich mit den Referenzangaben — festgestellt
**nach** der eigenen Messung. Lückenlosigkeit ab 0 ist die Kontrolle der
Bitbreite: eine falsche Maske erzeugt Löcher oder Ausreißer.

**Entscheidung gaia (7 Bit `locationId`) vs. ff7-landscaper (5 Bit + freies
Bit 14 + Flag Bit 15):** Bit 14 ist in **0 von 176 026** Dreiecken gesetzt,
Bit 15 dagegen in 1004; und die 5-Bit-Werte, die mit Bit 15 auftreten (7
Stück), sind eine **echte Teilmenge** der ohne Bit 15 auftretenden (18). Die
scheinbaren 7-Bit-„Werte" 64…76 liegen exakt auf `64 + bekannter 5-Bit-Wert`.
⇒ **5 Bit Wert + Flagbit 15**, Bit 14 unbenutzt. Die BEDEUTUNG von
`locationId` und Bit 15 bleibt 🟡.

### Offen

- 🔴 **F11b**: Zuordnung `textureId` → `.tex`-Datei aus `world_us.lgp` samt
  `width`/`height`/`uOffset`/`vOffset`. Ohne sie bleibt `worldUvToLocal`
  unbenutzt und die Geometrie reicht die rohen, seiten-absoluten u/v-Bytes
  durch (`TexturedMeshGeometry.uvResolved === 0`).
- 🔴 Nullpunkt und Drehsinn des `direction`-Bytes im Field-Raum.
- 🔴 `0x33D` („Einstiegspunkt per ID", 1 Operand) ist nicht untersucht; ob es
  denselben `field.tbl`-Namensraum benutzt, ist ungemessen.

---

## Längentabellen-Bündel: XYI/XYZ belegt, MINIGAME widerlegt (2026-08-11)

Proben: `oplen-bundle-probe.rdtest.ts`, `oplen-struktur-probe.rdtest.ts`,
`bank-wrap-probe.rdtest.ts`, `bg-anfangszustand-probe.rdtest.ts`.

### Der Befund über den Befunden: eine blinde Gütefunktion, diagnostiziert

Der Spannen-Abschluss — seit S12 die Gütefunktion für Operandenlängen —
**unterscheidet bei seltenen Opcodes nicht zwischen richtig und falsch**. Setzt
man `XYI` von Länge 2 auf 8, schließen **32 von 32** betroffenen Spannen in
beiden Fällen exakt. Ursache ist die Selbstresynchronisation variabler
Befehlsformate: Der Strom findet nach wenigen Instruktionen wieder auf dasselbe
Raster. Die Kennzahl war also nie unentschieden, sie war unempfindlich — und
hätte man nur sie gefragt, wäre der Posten „nicht belegt" geblieben, obwohl die
alte Länge nachweislich falsch war.

### Zwei Ersatz-Gütefunktionen mit Kontrollniveaus

**Grenzplausibilität.** Log-Quotient zweier empirischer Byteverteilungen: an
echten Instruktionsanfängen gegen Operandenbytes, über alle 702 Fields.
Kontrollniveaus **1,24** (Anfänge) und **−1,16** (Operanden). Gewertet wird nur
die *erste* Fundstelle je Spanne — jede weitere kann bei falscher Länge ein
Phantom aus fremden Operandenbytes sein und würde die eigene Fehlannahme
mitmessen.

**Struktursonde.** Operandeninhalt gegen eine unabhängige Sektion desselben
Fields. Literale Koordinaten gegen die Walkmesh-Grenzen, Dreiecksindizes gegen
die Dreieckszahl, bankadressierte Werte gegen die 256-B-Bankgröße (hohes Byte
muss 0 sein — ohne diese Variante wäre die Sonde bei XYI blind, denn 31 der 32
Fundstellen tragen Bankoperanden). Geeicht an `XYZI` mit bekannter Aufteilung:
**99,2 %** (4472/4506) gegen **0,0 %** bei Versatz +1 und **30,9 %** gegen ein
fremdes Walkmesh.

**Nahstellen-Test.** Liegt eine Fundstelle wenige Byte vor dem Spannenende,
bleibt kein Raum zum Resynchronisieren; zusätzlich müssen die Operanden in die
Spanne passen. Der kleinste beobachtete Abstand ist damit eine **harte obere
Schranke** für die Länge, ganz ohne Statistik.

### Ergebnisse

| Opcode | Vorkommen (Fields) | ist → ref | Grenzplausibilität | Struktursonde | Urteil |
|---|---|---|---|---|---|
| `XYI` 0xA6 | 32 (14) | 2 → 8 | **2,37 ± 0,37** bei 8; ist-Wert −1,50 | 90,6 % gegen 15,6 % versetzt | ✅ übernommen |
| `XYZ` 0xA7 | 42 (23) | 6 → 8 | 1,76 bei 8; ist-Wert −2,10 | 88,1 % gegen 0,0 % versetzt | ✅ übernommen |
| `MINIGAME` 0x20 | 134 (78) | 0 → 10 | alle Längen unter Kontrollniveau | — | ❌ **widerlegt**, Schranke ≤ 5 |
| `BGMOVIE` 0x27 | 36 (13) | 0 → 1 | ref (−1,56) schlechter als ist (−0,43) | — | ❌ nicht belegt |
| `MVCAM` 0xFB | 55 (23) | 0 → 1 | Bestwert −0,11, unter Kontrollniveau | — | ❌ nicht belegt |
| `BGROL` 0xE2 | 13 (6) | 1 → 2 | 0,83 ± 0,68 bei n=9 — Rauschen | 11,1 % gegen 22,2 % Kontrolle | ~~❌ unterbietet die Kontrolle~~ → ✅ **Runde 4: übernommen** |
| `BGROL2` 0xE3 | 5 (2) | 2 = 2 | n=2 | n=2 | ~~❌ nicht messbar~~ → ✅ **Runde 4: implementiert** |

**Zur XYZ-Ambiguität.** Die Grenzplausibilität bevorzugt Länge 4 (2,34) knapp
vor 8 (1,76) — sie allein hätte in die Irre geführt. Entschieden hat die
Kontrolle am dritten Wertfeld: auf @7 trifft es zu **88,1 %**, auf @9 (dort
begänne bei Länge 4 schon die nächste Instruktion) nur zu **45,2 %**. Das Feld
gehört also zur Instruktion.

**Zu MINIGAME.** In vier Spannen von `ancnt1` steht der Opcode **6 Byte** vor
dem Spannenende, in vier weiteren 8 Byte. Zehn Operandenbytes passen nicht
hinein. Entweder ist 0x20 hier nicht durchgängig MINIGAME, oder die Instruktion
ist variabel lang — aus dem Field-Bytecode allein nicht entscheidbar.

**Zu BGROL.** Vergleichsniveau eines belegten Opcodes: `BGON` trifft mit seinem
Parameterbyte an @+2 zu **98,0 %** (1963/2003) einen Parameter des eigenen
Fields, gegen 46,7 % bei einem fremden Field. `BGROL` erreicht 11,1 % gegen
22,2 % — schlechter als die Kontrolle. Die Alternative @+1 trifft ebenfalls
11,1 %, davon 7 von 9 mit dem Wert 0 (Nullwerte bestehen den Test trivial).
Nicht implementierbar ohne einen Bestand mit mehr Vorkommen.

> ⛔ **ZURÜCKGENOMMEN (Runde 4, 2026-08-11).** Der BGON-Vergleich ist
> zirkulär — die Vergleichsmenge wird aus BGON gebaut. Die neun BGROL-Stellen
> waren zu 8/9 Phantome der eigenen Längentabelle. `BGROL` steht seit Runde 4
> auf Länge **2** und ist implementiert; entschieden hat die Struktur einer
> einzigen Spanne, nicht eine Quote. Siehe „Runde 4 — BGROL entschieden".

### O7 geschlossen

Wortzugriffe mit Bankadresse 0xFF: **1** Fundstelle im gesamten Bestand
(`blinele`, Opcode 0x90). IF-Wortvarianten: **0**. Kontrollzählung für 0xFE:
**0** — die Seltenheit ist die Randlage hoher Bankadressen, keine Besonderheit
von 0xFF. Die Wrap-Regel bleibt, begründet durch Irrelevanz statt durch Wissen;
die Probe bleibt als Dauerprobe stehen und reißt oberhalb von 5 Fundstellen.

### F35-1: Anfangszustand der Hintergrundmasken

Von 1256 animierten Kachelgruppen in 508 Fields sind nach 300 Ticks **542 leer
ohne** und **329 leer mit** Vorbelegung — **213 Gruppen mit 9682 Kacheln**
werden wieder sichtbar. 🔴 `junonr2` gehört **nicht** dazu: Vorbelegung
`{16:1, 17:1, 18:1}`, danach ohne wie mit Vorbelegung `{16:0, 17:0, 18:1}`. Die
Bankbyte-Aufteilung ist als Ursache ausgeschlossen (alle 46 BG-Instruktionen
des Fields tragen Bankbyte 0, korpusweit 97,3 % bei BGON und 96,8 % bei BGOFF).

---

## Nachlese Welle 1 — vier Restposten, keine Längenänderung (2026-08-11)

Vier Posten, die Welle 1 ausdrücklich offen gelassen hat, mit je einer
**zweiten, unabhängigen** Messung nachgefasst. Ergebnis: **keine einzige
Operandenlänge geändert** — dafür zwei Messanlagen als untauglich entlarvt und
eine Fehlmessung der Vorrunde korrigiert. Proben (Stand Runde 4):
`bgrol-belegkette.rdtest.ts`, `minigame-laengenfrage.rdtest.ts`,
`oplen-abstieg-nachlese.rdtest.ts`, `junonr2-bgfluss-probe.rdtest.ts`.

### Posten 1 — BGROL: der Maßstab war falsch — und das Urteil auch

> ⛔ **Dieser Abschnitt ist zurückgenommen** (Runde 4, 2026-08-11) und bleibt
> nur als Fehlerprotokoll stehen. Die Überschrift lautete ursprünglich „die
> Vorrunde hatte den falschen Maßstab, **das Urteil hält trotzdem**" — genau
> das stimmte nicht. Was unten steht, ist methodisch sauber bis auf einen
> Punkt: Die Fundstellenmenge, auf der gerechnet wurde, war zu 8/9 Phantom.
> Die Auflösung steht in „Runde 4 — BGROL entschieden".

**Der Fehler.** Welle 1 stellte `BGROL`@+2 (11,1 %) gegen `BGON`@+2 (98,0 %).
Dieser Vergleich trägt nicht: Die Vergleichsmenge „Parameter, die dasselbe Field
schaltet" wurde **aus BGON selbst gebaut**. BGON trifft sie per Konstruktion —
das ist eine Tautologie, keine Messung, und als Maßstab wertlos.

**Der ehrliche Maßstab ist `BGCLR` (0xE4):** gleiche Familie, gleiche
Operandenform `banks, param`, gleiche Länge 2 — und **nicht** Teil der
Vergleichsmenge, wenn man diese nur aus BGON/BGOFF baut.

| Opcode | Länge | `param`@+2 trifft eigenes Field | Kontrolle fremdes Field | 95-%-Intervall |
|---|---|---|---|---|
| `BGCLR` 0xE4 (**Eichung**) | 2 belegt | **98,1 %** (608/620) | 61,9 % (384/620) | [96,6 %, 98,9 %] |
| `BGON` 0xE0 (tautologisch) | 3 belegt | 99,1 % (1981/2000) | 64,8 % | [98,5 %, 99,4 %] |
| `BGOFF` 0xE1 (tautologisch) | 3 belegt | 98,6 % (1501/1523) | 62,0 % | [97,8 %, 99,0 %] |
| `BGROL` 0xE2 | 1 ist / 2 ref | **12,5 %** (1/8) | 25,0 % (2/8) | [2,2 %, **47,1 %**] |
| `BGROL2` 0xE3 | 2 | 50,0 % (1/2) | 50,0 % (1/2) | [9,5 %, 90,5 %] |

**Das Urteil hält — und steht jetzt auf einer sauberen Zahl.** Die
95-%-Intervalle von `BGCLR` und `BGROL` sind **disjunkt** (47,1 % < 96,6 %).
Trotz n = 8 ist damit belegt: Das Byte an @+2 verhält sich bei BGROL **nicht**
wie ein Parameterbyte derselben Familie. Die Referenzform `banks, param` ist an
den Daten nicht haltbar, und ohne belegte Operandenlage wäre jede
Rotationssemantik geraten. Die Bankbyte-Signatur zeigt in dieselbe Richtung:
`BGCLR` trägt an @+1 zu **99,4 %** (621/625) eine 0, `BGROL` nur zu 77,8 %
(7/9) — Intervalle knapp disjunkt.

**Die Nachfolgerprobe ist untauglich, und das ist der eigentliche Fund.**
Vorschlag (b) des Auftrags war, die Gültigkeitsquote der Folgeinstruktion zu
messen. Umgesetzt (Quote „Byte an `pos+1+L` gehört zu den 50 Opcodes, die 90 %
aller echten Instruktionsanfänge abdecken") und **an zwei bekannten Längen
geeicht — dort fällt sie durch**:

| Eichung | wahre Länge | Quote bei wahrer Länge | beste Quote | bei Länge |
|---|---|---|---|---|
| `BGCLR` 0xE4 | 2 | 83,2 % | **99,7 %** | 0 |
| `BGON` 0xE0 | 3 | 98,6 % | **99,0 %** | 0 |

Die Probe zeigt bei **beiden** belegten Opcodes auf die falsche Länge.
Kontrollniveaus: echte Instruktionsanfänge 90,2 %, Operandenbytes 60,9 %,
zufällige Position in einer Spanne **83,3 %** — das Rauschband liegt so dicht am
Signal, dass nichts aufzulösen ist. Grund: BG-Opcodes stehen in Ketten, und
ihre Parameterbytes sind kleine Zahlen, die mit häufigen Opcodes kollidieren.
**Eine an bekannten Fällen durchgefallene Messanlage darf auf unbekannte nicht
angewendet werden** — die BGROL-Zahlen dieser Probe sind deshalb nicht
ausgewertet, nur protokolliert.

**Folge:** `0xE2`/`0xE3` bleiben auf dem Skip-Pfad, Längen unverändert (1 bzw.
2). Der Spannen-Abschluss ist auf beiden blind (9/9 bzw. 2/2 für **jede**
Länge 0…6). 🔴 Was fehlt, ist ein Bestand mit mehr Vorkommen.

> ⛔ **Zurückgenommen.** Was fehlte, war kein anderer Bestand, sondern ein
> anderes Mittel. Der letzte Satz oben ist der eigentliche Fehlschluss: Aus
> „meine Gütefunktion ist blind" folgt „mit einem anderen Mittel entscheiden",
> nicht „unentscheidbar".

### Posten 2 — MINIGAME / BGMOVIE / MVCAM: sie kommen vor, entscheidbar sind sie nicht

> ⛔ **Die Überschrift ist zur Hälfte zurückgenommen** (Runde 4). „Sie kommen
> vor" ist mit der verankerten Zählung **nicht** belegt: Ein nachweislich
> falsches Raster (Dekodierstart bei `spanStart + k`) liefert für 0x20
> **1318 / 652 / 717** verankerte Fundstellen bei k = 1/2/3 — zehnmal so viel
> wie das richtige Raster mit 67. Die Zählung trennt keine Phantome ab.
> Details unter „Runde 4 — die Minigame-Zahlen".

Die Sorge „vielleicht kommt 0x20 gar nicht vor" ist ausgeräumt — die Suchmenge
für einen späteren Minispiel-Einstieg ist **nicht leer**:

| Opcode | roh (Fields) | **verankert** (Fields) | harte Schranke | ist / ref |
|---|---|---|---|---|
| `MINIGAME` 0x20 | 134 (79) | **118 (79)** | ≤ 5 | 0 / 10 |
| `BGMOVIE` 0x27 | 36 (13) | **18 (13)** | ≤ 3 | 0 / 1 |
| `MVCAM` 0xFB | 55 (23) | **38 (23)** | ≤ 3 | 0 / 1 |

*Verankert* = erste Fundstelle je Spanne; nur sie ist von der geprüften Länge
unabhängig. Die harte Schranke ist der kleinste Abstand zum Spannenende minus 1
— **statistikfrei** und für `MINIGAME` unverändert vernichtend: die Referenz 10
passt in vier Spannen physisch nicht hinein.

Spannen-Abschluss über **alle** Längen 0…12 auf der betroffenen Teilmenge (jede
Länge ist Kontrolle für jede andere):

- `0x20`: 110, **112**, 107, 110, **112**, 110, 108, 105, 102, 100, 104(ref), 86,
  84 von 118. Maximum **zweifach** (Längen 1 und 4), Vorsprung gegen Ist nur
  2 Spannen. → **unentscheidbar**.
- `0x27`: **18/18 für die Längen 0, 1 und 2** — die Gütefunktion ist vollständig
  indifferent. → **unentscheidbar**.
- `0xfb`: 34, 31(ref), **35**, 34, 31, 32, 34, 33, 30, 34, 30, 29, 28 von 38.
  Maximum bei 2, Vorsprung gegen Ist **eine einzige Spanne**. Bemerkenswert: die
  Referenz 1 ist mit 31/38 **schlechter als der Ist-Wert**. → **unentscheidbar**.

Alle drei bleiben auf ihrem Ist-Wert. 🔴 **Der unbefriedigende Zustand bleibt
und ist hier ausdrücklich benannt:** Länge 0 heißt, die VM führt Operandenbytes
als Instruktionen aus. Belegt ist aber weder 0 noch die Referenz — eine
geratene Länge wäre nicht besser, nur unauffälliger.

### Posten 3 — der Längentabellen-„Fixpunkt" gilt nicht mehr, aber es ändert sich nichts

Der Koordinatenabstieg (implementierte Opcodes eingefroren, wie in O9) hebt den
Spannen-Abschluss von **99,9230 %** (48.004/48.041) auf **99,9417 %**
(48.013/48.041) und macht **acht** Vorschläge. Jeder einzeln, isoliert auf die
Ist-Tabelle gesetzt und auf seiner betroffenen Teilmenge gemessen:

| Vorschlag | verankert | ist → neu | Maximum | Vorsprung | Urteil |
|---|---|---|---|---|---|
| `0x0d` 0 → 3 | 35 (24) | 34 → 35 von 35 | 2-fach (3/6) | 1 | ❌ mehrdeutig |
| `0x1d` 4 → 3 | 32 (26) | 31 → 28 von 32 | 3-fach (1/4/5) | −3 | ❌ schlechter |
| `0x20` 0 → 1 | 118 (79) | 110 → 112 von 118 | 2-fach (1/4) | 2 | ❌ mehrdeutig |
| `0x3a` 4 → 0 | 65 (39) | 63 → 64 von 65 | 3-fach (0/1/2) | 1 | ❌ mehrdeutig |
| `0x41` 1 → 4 | 23 (16) | 21 → 21 von 23 | 3-fach (0/1/4) | 0 | ❌ Gleichstand |
| `0x7f` 2 → 6 | 50 (42) | 49 → 50 von 50 | **eindeutig** | **1** | ❌ unter Rauschschwelle |
| `0xb7` 2 → 3 | 67 (36) | 67 → 67 von 67 | 7-fach | 0 | ❌ Gleichstand |
| `0xef` 0 → 5 | 19 (15) | 18 → 19 von 19 | 2-fach (5/7) | 1 | ❌ mehrdeutig |

**Sieben scheitern schon am O9-Kriterium. Der achte scheitert an einer neuen
Kontrolle — und die ist der Ertrag dieses Postens.**

`0x7f RDMSD` besteht das O9-Kriterium formal: 50/50 gegen ist 49/50, beide
Nachbarn schlechter (5→49, 7→48), Maximum über alle 17 Längen eindeutig. Der
Vorsprung beträgt jedoch **eine einzige Spanne von 50** — und ohne zu wissen,
was eine Spanne wert ist, ist das keine Zahl, sondern eine Ziffer.

**Auflösungskalibrierung.** Dieselbe Auswertung über alle **68** eingefrorenen
Opcodes mit n ≥ 10, deren Länge unabhängig gedeckt ist. Wie oft schlägt dort
eine **falsche** Länge die richtige?

| Kennzahl | Wert |
|---|---|
| geprüfte eingefrorene Opcodes | 68 |
| davon von einer falschen Länge **geschlagen** | **5 (7,4 %)** |
| davon nur gleichauf (mehrdeutiges Maximum) | 11 |
| Vorsprünge der falschen Längen | min 1, **median 1**, max **3** |

Im Klartext: `MUL` (0x89) — der Opcode, an dem O9 die Überanpassung
diagnostizierte — wird von den Längen 0/1 um **2 Spannen** geschlagen, `IFUWL`
(0x19) sogar um **3**. Beide sind nachweislich falsch. Ein Vorsprung von einer
Spanne ist damit **exakt das Rauschniveau dieser Gütefunktion**.

Daraus die **Rauschschwelle** als stehende Regel der Probe: Ein Vorschlag muss
mehr Vorsprung bieten als der größte, den eine falsche Länge an einem gedeckten
Opcode erreicht (**3 Spannen**). `0x7f` bietet 1 — verworfen. Dass die Referenz
für `0x7f` mit 2 unabhängig unseren Ist-Wert bestätigt, kommt hinzu.

**Bilanz: 0 von 8 übernommen, kein `engineCompat`-Schritt, Tabelle unverändert
bei 99,9230 %.** Die Fixpunkt-Aussage der Roadmap („ein erneuter Lauf übernimmt
nichts mehr") war in ihrer Begründung falsch — der Abstieg schlägt sehr wohl
etwas vor — und blieb nur im Ergebnis zufällig richtig. Sie ist in
`docs/ROADMAP-OFFENE-POSTEN.md` korrigiert.

### Posten 4 — junonr2: der BG-Bereich wird ausschließlich über Slot 0 betreten

Ermittlung mit `Timeline` und `stepGate` über 300 Ticks. Der Bereich
**[1688, 2293)** gehört vier modelllosen Entitäten — `door` (0), `smoke0` (1),
`smoke1` (2), `lift` (3) — mit zusammen 11 Entry-Points.

| Frage | Messwert |
|---|---|
| Kontextstarts in 300 Ticks | **6013** |
| davon aus einem REQ | **0** |
| REQ/REQSW/REQEW insgesamt ausgeführt | **0** |
| abgewiesene Requests | 0 |
| Zwangs-Yields (Budget) | 0 |
| Faults | 0 |
| Spannen des Fields | 174, davon **151 nie betreten** |

**Der Bereich wird ausschließlich über Slot 0 betreten** — Init + Main-Schleife,
gestartet von `FieldRuntime.start()` mit Priorität 7. Von den 11 Entry-Points
laufen genau vier (die Slot-0-Einstiege 1688, 1729, 1825, 1939); die sieben
Ereignis-Slots — darunter `lift/slot1` mit 150 Byte, der eigentlichen
Fahrstuhlsequenz — werden **nie** angefordert. Am Instruktionsstrom entlang
gelesen (nicht byteweise — eine byteweise Suche liefert hier über 30
Phantom-REQs aus Operandenbytes) zeigt sich der Grund: Die REQs auf Entity 3
stehen in `produce/slot0` (ip 2400, 2435) und in den Talk-Slots von `cloud`,
`tifa`, `cid`, `hyde` — also selbst hinter Spieler-Interaktion.

**Zur Verdrängungsregel: sie wird in junonr2 nie ausgelöst.** 0 von 6013
Kontextstarts stammen aus einem Request; ohne Requests gibt es keine
konkurrierenden Prioritäten. Die Frage „passt die Reihenfolge zu unserer
Verdrängungsregel" ist an diesem Field **nicht beantwortbar** — das ist der
Befund, nicht ein Hinweis auf einen Scheduler-Fehler.

**Was die Masken wirklich tun.** Nicht „Maske bleibt 0", sondern:

- Tick 1: `door` löscht per **BGCLR param 16**, `smoke0` per **BGCLR param 17**,
  `smoke1` per **BGCLR param 18** — die Skripte räumen ihre eigene Vorbelegung
  selbst ab. 16 und 17 werden danach von keiner erreichbaren Instruktion gesetzt.
- Ab Tick 2 fährt `smoke1`/Slot 0 eine Animation als Paarfolge
  `BGOFF(18, s)` → `BGON(18, s+1)` über s = 0…7 mit Periode **33 Ticks**:
  `{18:1} → {18:2} → {18:4} → … → {18:128} → {18:0} → {18:1} → …`
  Der Endwert `{16:0, 17:0, 18:1}` nach 300 Ticks ist damit ein **Schnappschuss
  eines laufenden Zyklus**, kein eingefrorener Zustand.

Nebenbei ist die BGROL-**Semantik** damit unabhängig bestätigt: Was BGROL in
einer Instruktion täte, schreibt dieses Field von Hand als BGOFF/BGON-Paarfolge
aus. Über die **Operandenlänge** sagt das nichts.

🟡 **Nebenbefund am Main-Loop-Modell.** Innerhalb eines Zyklus liegen
`BGOFF(18,s)` und `BGON(18,s+1)` im **selben** Tick; nur am Umlauf (Tick 34
BGOFF s=7, Tick 35 BGON s=0) klafft **ein Tick mit Maske 0**. Ursache ist unsere
Regel „eine Main-Iteration je Tick-Grenze" (`runtime.ts`, `activateContext`):
Zwischen Ende und Neubeginn einer Iteration liegt zwangsläufig eine Tick-Grenze.
Ob das Original dort ebenfalls ein Bild lang leer zeigt, ist **nicht gemessen**.

**Kontrolle — Sonderfall oder Muster?** Dieselbe Auswertung über alle Fields:

| Kennzahl | Wert |
|---|---|
| Fields mit animierten Gruppen | 508 |
| Fields mit ≥ 1 nach 300 Ticks leerer Gruppe | 179 |
| Kachelgruppen gesamt | 1256 |
| davon nach 300 Ticks leer | 329 |
| leer **und vom Skript nie angefasst** | **0** |
| leer, **obwohl** das Skript den Parameter geschaltet hat | **329** |

**Alle 329 leeren Gruppen sind vom Skript selbst geleert worden**, keine einzige
durch Nichtbeachtung. `junonr2` ist das Muster, nicht die Ausnahme — eine leere
Maske ist ein regulärer Skriptzustand. Wie sie gezeichnet wird, ist damit eine
Render-Entscheidung und keine Interpreter-Frage.

---

## Welle 2 · Glyphenmetrik aus `WINDOW.BIN`

Probe: `tools/realdata-scan/src/glyph-metrik-probe.rdtest.ts`.

### Was die Datei enthält (Accounting geht byteexakt auf)

`data/kernel/WINDOW.BIN` (13 317 B) besteht aus drei Sektionen mit demselben
6-Byte-Kopf wie `KERNEL.BIN` (u16 komprimiert, u16 entpackt, u16 Typ) und je
einem gzip-Strom; dahinter genau **2 Nullbytes** — dieselbe Trailer-Regel wie
bei `KERNEL.BIN`.

| Sektion | komprimiert | entpackt | Inhalt |
|---|---|---|---|
| 0 | 10 065 | 33 312 | TIM, 256×256 @ 4 bpp — Fenster-/Menügrafik |
| 1 | 3 076 | 32 800 | TIM, 256×252 @ 4 bpp — Fontblatt |
| 2 | 156 | 1 302 | Breitentabelle; die ersten 256 B sind die Zeichenbreiten |

⚠️ **Fallstrick im TIM von Sektion 1:** Das Längenfeld des Bildblocks nennt
16 140 B, die Maße (64 u16 × 252) verlangen 32 256 B. Nur mit den **Maßen**
füllt der Block die Sektion byteexakt aus (544 + 32 256 = 32 800). Wer dem
Längenfeld glaubt, liest das halbe Fontblatt. In Sektion 0 stimmen beide.

Das Fontblatt ist ein Raster aus **12×12-Zellen, 21 Zellen je Zeile**;
Zeichencode = Zeile × 21 + Spalte.

### Die Dekodierregel ist belegt, nicht geglaubt

`Breite = (b & 0x1F) + (b >> 5)`.

Erste, **von der Tabelle unabhängige** Gegenprobe: Tintenbreite jeder Glyphe
direkt aus dem Fontblatt gemessen. Für **194 von 212** belegten Glyphen der
deutschen Fassung gilt exakt `Breite = Tintenbreite + 1` (`i`/`l`/`I` = 3,
`O` = 9, `M`/`W`/`m`/`w` = 11). Die 12–15 Einträge mit gesetzten oberen Bits
(`"` `(` `)` `,` `.` `1` `:` und einige Akzentgroßbuchstaben) folgen dieser
Faustregel nicht.

Zweite Gegenprobe (entscheidend, weil sie die Auslegung trennt): Vorhersage
der Fensterbreite gegen die deklarierte `w` von **9 417** `WINDOW`-Opcodes
aus **702** Fields.

| Metrik | exakt getroffen | zu breit (Verletzung) |
|---|---|---|
| **`WINDOW.BIN`, additive Regel** | **38,90 %** | **3,41 %** |
| nur untere 5 Bit | 21,80 % | 3,12 % |
| Tabelle verwürfelt (Kontrolle) | 7,32 % | 85,96 % |
| konstante Mittelwertbreite (Kontrolle) | 8,31 % | 83,23 % |
| alte Ersatzmetrik 8 px (Kontrolle) | 0,21 % | 85,94 % |

Die scharfe Vorhersage der Aufgabe — *keine Zeile eines Originaldialogs darf
breiter sein als ihr Fenster* — trennt um **Faktor 25**: 3,41 % gegen 83–86 %.
Die additive Regel schlägt die Konkurrenzauslegung „nur untere 5 Bit" bei den
exakten Treffern um Faktor 1,8.

### Zwei Konstanten MESSEN statt annehmen

Die Fremdbeschreibung nennt Polsterung 0x10 = 16 als Standard. **Das ist für
diese Installation falsch.** Sweep über dieselben 9 417 Fenster:

| Polsterung | 17 | 18 | 19 | **20** | 21 | 22 | 23 |
|---|---|---|---|---|---|---|---|
| exakt | 0,39 % | 0,38 % | 0,38 % | **38,90 %** | 6,99 % | 3,48 % | 4,88 % |

Faktor 100 gegen den Nachbarwert — das ist eine Ablesung, keine Anpassung.
🟢 **Polsterung = 20 px.**

Namensplatzhalter (0xEA–0xF5), Sweep über 4 830 Dialoge mit Platzhalter:
116 px → 21,4 %, **117 px → 44,7 %**, 118 px → 24,4 %.
🟢 **Namensbreite = 117 px** — und sie ist keine Konstante, sondern fällt aus
den Daten: 117 = 9 × 13, und **13 ist die größte Zeichenbreite der Tabelle**,
in der deutschen wie der englischen Fassung am selben Zeichen 0xC4.

🔴 **Offen (bewusst).** Die Namensbemessung rechnet mit dem Maximum der
*unteren 5 Bit*; unter der additiven Regel läge das Maximum bei 14 (de) bzw.
15 (en) und die Herleitung ginge nicht auf. Für die wenigen Einträge mit
gesetzten oberen Bits ist damit nicht abschließend geklärt, welche Breite das
Original beim Zeichnen benutzt. Für die Fenstermessung gewinnt die additive
Regel deutlich; für die Namensbreite die untere Hälfte.

Rest der Residuen bei gemessener Metrik: 38,9 % genau 0 px, 14,5 % bei +4 px,
4,4 % bei +40 px. Diese Fenster sind vermutlich von Hand größer gesetzt
worden (das Skriptformat erlaubt es) — belegt ist das nicht.

---

## F24-B — Menüansichten, Ausrüstung, Materia, Limit und die Ortsanzeige

Probe: `tools/realdata-scan/src/menu-views-probe.rdtest.ts` (V1–V6), Datenbestand
die fünf `save*.ff7` der Nutzerinstallation (8 belegte, davon 7 dicht
beschriebene Slots, 63 benutzte Charakterrecords) und deren `KERNEL.BIN`.

### V1 🟢 Der Ortsname steht an genau zwei Stellen — und wird nicht mehr geraten

Sweep über **jeden** der 4340 Offsets eines Slots. Gesucht: Stellen, an denen in
allen belegten Slots ein terminiertes, druckbares Namensfeld von mindestens vier
Zeichen steht (ein komplett leeres Feld gilt als „kein Ort eingetragen") und das
über die Slots mindestens drei verschiedene Werte annimmt.

| | eigenständige Fundstellen |
|---|---|
| echte Slots | **2** — `0x0028` (Vorschaublock, 32 B) und `0x0F0C` (Savemap, 24 B) |
| **Kontrolle: byteweise verwürfelte Slots** | **0** |

Je Fundstelle finden sich zusätzlich drei Treffer bei `at+1…at+3`; das sind keine
Alternativen, sondern dieselbe Zeichenkette ohne ihre ersten Zeichen, und der
Schattenfilter (Vorgänger ist ebenfalls Treffer) entfernt sie.

Wo beide Ablagen gefüllt sind, tragen sie denselben Text: **7/7**. Der achte Slot
ist ein Notspeicherstand — Savemap-Feld leer, Vorschaublock gefüllt. Genau
deshalb ist der Vorschaublock zweite Quelle und nicht bloß eine Gegenprobe.

`@webmidgar/menu` liest in dieser Rangfolge und macht jeden Rückfall in der
Ansicht sichtbar; der vom Wirt gemeldete Feldname ist nur noch letzter Ausweg.

### V2 🟢 Waffe @0x1C — belegt über eine Kreuzprobe zwischen zwei Dateien

`equipableBy` des Waffenrecords ist eine Bitmaske über die neun Figuren. Wenn
0x1C die Waffe ist, muss für jede Figur das Bit ihrer eigenen Kennung gesetzt
sein.

| | Treffer |
|---|---|
| Waffe 0x1C, eigene Figurenkennung | **49/49 = 100 %** |
| **Kontrolle: Kennung der nächsten Figur** | **0/49 = 0 %** |
| Kontrolle: Accessoirespalte 0x1E als Waffe gelesen | 2/4 = 50 % |

Die Probe ist trennscharf, weil **keine** der 128 Waffen die Vollmaske trägt
(0/128). Ausgewertet werden nur Records mit `id ≤ 8`; die Slots enthalten auch
Sonderfassungen mit den Kennungen 9 und 10, für die es in der Maske kein Bit gibt.

🟡 **Rüstung 0x1D und Accessoire 0x1E bleiben ungestützt.** Dieselbe Kreuzprobe
liefert für die Rüstung 49/49 — aber auch die verschobene Zuordnung liefert
49/49, weil **30 der 32 Rüstungen** die Vollmaske tragen. Das ist ein Befund über
die Daten, kein Messfehler, und der Grund für 🟡 statt 🟢.

### V3 🟢 Materiaplätze: 0…7 in der Waffe, 8…15 in der Rüstung

Kein belegter Platz darf jenseits der Platzzahl liegen, die das ausgerüstete
Stück laut `KERNEL.BIN` mitbringt.

| | Treffer |
|---|---|
| Zuordnung Waffe/Rüstung | **141/141 = 100 %** |
| **Kontrolle: Waffe und Rüstung vertauscht** | 120/141 = 85,1 % |

### V4 🔴 Materia-Attributbytes 0x0E…0x13 — geordnet, aber ungedeutet

Hypothese: Dort stehen die gewährten Zauberindizes, hinten mit 0xFF aufgefüllt.

| 6-Byte-Fenster | Records mit Inhalt | davon streng steigend |
|---|---|---|
| **0x0E…0x13** | 79 | **45** |
| Kontrolle 0x08…0x0D | 88 | **0** |
| Kontrolle 0x02…0x07 | 63 | **0** |

Dass dort eine geordnete Indexfolge liegt, ist damit belegt — dass *jeder*
Eintrag ein Zauberindex ist, nicht. Der Versuch, die steigenden Records über den
Typnibble zu isolieren, ist **gescheitert**: Auch die größte Gruppe (24 Records)
steigt nur in 17 von 19 Fällen. `buildMagicView` leitet die Zauberliste daraus
ab, nennt zu jedem Zauber die Quellmateria und markiert die Ansicht 🔴.

### V5 🟢 Limitstufe, Limitmaske, Kampfreihe, Erfahrung

| Feld | echt | Kontrollniveau |
|---|---|---|
| Limitstufe u8 @0x0E in 1…4 | **63/63** | Nachbarn 0x0C/0x0D/0x0F/0x10: **0/63** je |
| Limitmaske u16 @0x22 nur Bits {0,1,3,4,6,7,9} | **63/63** | 0x20: 0, 0x21: 0, 0x23: 45, 0x24: 49 |
| Erfahrung u32 @0x3C, Rangkonkordanz mit der Stufe | **1,000** | rotierte Erfahrungsreihe: 0,595 |

Die **Lücken** der Limitmaske sind das eigentliche Beweismittel: Eine beliebige
Zahlenspalte trifft ein derart löchriges Muster nicht.

🟢 **Nebenbefund, der eine Fremdquellen-Widersprüchlichkeit auflöst.** ff7tk
dokumentiert die Kampfreihe @0x20 an einer Stelle als 0/1, an einer anderen als
0xFE/0xFF. Im Bestand kommen **ausschließlich 0xFE und 0xFF** vor — die zweite
Lesart gilt.

### V6 🟡/🟢 Materia-AP: Sättigungswert belegt, Faktor nicht entscheidbar

| Faktor | Überläufe (AP > höchste Schwelle) | Materia über Stufe 1 |
|---|---|---|
| 1 | **13** | 49 |
| 10 | 0 | 33 |
| 100 | 0 | 0 |

🟢 **`0xFFFFFF` ist ein Sättigungswert, keine AP-Zahl.** Er kommt exakt **63-mal**
vor — und exakt so viele „Überläufe" erzeugte die Rechnung, bevor er ausgenommen
wurde. Er bedeutet „gemeistert".

🟡 **Der Faktor bleibt offen.** Faktor 1 ist widerlegt; 10 und 100 sind beide
überlaufsfrei, und der Bestand kann sie nicht trennen, weil die Stände zu früh im
Spiel liegen — ohne Sättigungswert erreicht keine getragene Materia auch nur die
Stufe-2-Schwelle des größeren Faktors. Das Menü rechnet mit 100 und markiert die
Stufe in der Ansicht als 🟡.

### 🟢 Fenstergeometrie aus den Referenzbildern (640×480)

Pixelabtastung der drei Kampfabschluss-Bildschirme
(`apps/demo/.shots/ref/20260810223347_1.jpg`, `…349`, `…351`) — Vollbild-
Fensterstapel in derselben Optik wie das Menü:

- Fenster sitzen **bündig am Bildrand**: linke Rahmenkante x = 0, obere y = 0,
  rechte endet bei x = 637, untere bei y = 479. **Kein** 8-px-Außenrand.
- Zwischen gestapelten Fenstern liegen **2 px**.
- Bordüre dreilagig, 5–6 px: 2 px mittelgrau (≈ 120,124,125), 2 px hellgrau
  (≈ 198,196,197), 1–2 px dunkel (≈ 49,48,53) — deckungsgleich mit
  `FF7_WINDOW_SKIN` (2/2/1). Die Schale wird deshalb benutzt, nicht nachgebaut.

⚠️ **Offener Nebenbefund für `@webmidgar/ui-window`:** An der Oberkante liegen die
Lagen von außen nach innen mittelgrau → hellgrau → dunkel, an der Unterkante in
derselben Reihenfolge **von oben nach unten** (innen mittelgrau, außen dunkel).
Die Schale zeichnet beide Kanten gespiegelt. 2-px-Unterschied an der Unterkante;
hier nicht geändert, weil die Schale einem anderen Auftrag gehört.

🔴 **Es gibt keine Menüaufnahme.** Die 18 Referenzbilder zeigen Sternenhimmel,
sechs Field-Szenen, drei Kampfszenen, ein Dialogfenster und drei
Kampfabschlüsse — **kein Hauptmenü**. Die Aufteilung des Hauptmenüs
(`FF7_MAIN_MENU_LAYOUT` in `packages/menu/src/layout.ts`) ist deshalb
durchgehend 🟡 und steht bewusst in **einem** austauschbaren Objekt.

---

## Runde 4 — BGROL entschieden, zwei Zählweisen kassiert (2026-08-11)

Proben: `bgrol-belegkette.rdtest.ts`, `minigame-laengenfrage.rdtest.ts`,
`oplen-abstieg-nachlese.rdtest.ts`. Diese drei ersetzen **fünfzehn**
Wegwerfsonden desselben Tages; die alten sind gelöscht.

### Das kostenfreie Referenzbündel — 53 Längen

Eine falsche Operandenlänge verschiebt den Instruktionsstrom aller
nachfolgenden Bytes einer Spanne und erzeugt damit **Phantom-Fundstellen**:
Bytes, die auf einer scheinbaren Instruktionsgrenze landen. Wer Fundstellen
zählt, zählt zuerst die Fehler seiner eigenen Längentabelle.

Für jede der 85 Abweichungen zwischen unserer Tabelle und der Referenz wurde
der Referenzwert **isoliert** gesetzt und der Spannen-Abschluss über alle
48.041 Spannen neu gemessen. Übernommen wurde, was ihn **nicht
verschlechtert** — 53 Stück:

| Kennzahl | vorher | nachher |
|---|---|---|
| geschlossene Spannen | 48.004 | **48.006** |
| Überläufe | 31 | **29** |
| Abbrüche (Länge unbekannt) | 6 | 6 |

Die beiden namentlich geprüften Einzelfälle **0x42 MPRA2 (0 → 5)** und
**0xCE MMBLK (0 → 1)** lassen den Abschluss isoliert wie gemeinsam
**bitgleich** bei 48.004/31/6 — sie kosten nichts.

⚠️ **Kostenfreiheit ist kein Beleg für Richtigkeit.** Der Abschluss ist an
seltenen Opcodes blind. Übernommen wird nicht „was gemessen richtig ist",
sondern „was die Referenz sagt, ohne dass unsere Messung widerspricht". Der
Ertrag ist die gesenkte Phantomrate, nicht neues Wissen — alle 53 stehen
deshalb 🟡, Herkunft Referenz.

Draußen bleiben 30 Abweichungen, die den Abschluss verschlechtern (0x04 PREQ
−72, 0x05 PRQSW −14, 0x09 SPLIT −13, 0x20 MINIGAME −6, 0x31 IFKEYON −6,
0xFB MVCAM −3, 0xFE CHMST −3, …), sowie 0xDF MPPAL und 0xEF ADPAL2, die einen
Abbruch gegen einen Überlauf tauschen.

### Was das mit der Phantomrate macht

| Opcode | vor dem Bündel | nach dem Bündel |
|---|---|---|
| `BGROL` 0xE2 | 13 in 6 Fields | **6 in 2 Fields** |
| `BGROL2` 0xE3 | 5 in 2 Fields | **4 in 1 Field** |
| `MINIGAME` 0x20 (verankert) | 118 in 79 Fields | **67 in 49 Fields** |

`blackbg4`, `del1`, `frcyo` und `junair2` verschwinden vollständig aus der
BGROL-Menge. Auf genau diesen Phantomen hatte die Vorrunde ihre
Wilson-Intervalle gerechnet.

### BGROL 0xE2: Länge 2, belegt durch die Struktur einer einzigen Spanne

`hyou4`, Spanne [2137, 2213):

```
e4 00 01 · e0 00 01 00 · 00 · e1 00 01 01 · e0 00 01 00
dann NEUNMAL (24 07 00 · eX 00 01) — fünfmal eX = e2, viermal eX = e3
· 12 41 · 00
```

Die neun Blöcke sind **byteidentisch gebaut**. `0xE3` stand bei uns immer auf
Länge 2, also lasen die vier e3-Blöcke sauber als `BGROL2(00,01) / WAIT(7)`.
Unter der alten Länge 1 zerfielen die fünf e2-Blöcke dagegen in
`BGROL 00 / REQ 24 07 / RET` — **dieselbe Konstruktion, zwei Lesarten in einer
Spanne**. Unter Länge 2 lesen beide gleich. Das ist statistikfrei; es braucht
keine Fundstellenmenge und keine Quote.

Zwei unabhängige Stützen:

- **Der Schleifenrumpf schließt nur unter Länge 2.** Ab 2145 läuft der Rumpf
  auf `JMPB 0x41` bei 2210. Unter Länge 2 ist das erste `RET` des Rumpfes die
  Marke bei **2212** — hinter dem Rücksprung, also ein geschlossener Zyklus.
  Unter Länge 1 liegt das erste `RET` bei **2161**, mitten im ersten Durchlauf:
  die Schleife wäre gar keine.
- **Die Kacheldaten passen.** `hyou4` trägt zu param 1 die Zustände
  0, 1, 2, 4, 8, 16, 32 — eine Sechsbild-Animation, genau das, was fünf
  Vorwärts- und vier Rückwärtsrollen durchschalten.

🟡 Offener Rest: Die einzige verbleibende Fundstelle außerhalb `hyou4` liegt in
`subin_2b@2017` und trägt Bankbyte **0xFF** und Parameter **190**, zu dem das
Field keine Kachelgruppe hat. Sie widerlegt die Spannenstruktur nicht, ist aber
auch nicht erklärt.

### Die Semantik — und die Grenze der Daten

`BGON` setzt Bit `1 << state`, `BGOFF` löscht es, `BGCLR` räumt die Gruppe.
`BGROL` schaltet weiter, `BGROL2` zurück. Was „weiterschalten" heißt, geben die
Daten **nicht** her:

- **(a)** die Maske um ein Bit rotieren, oder
- **(b)** auf den nächsten Zustand springen, der im Hintergrund tatsächlich
  vorkommt (Lücken überspringen).

Entscheidbar wäre das nur an einem Field mit Zustandslücke, das BGROL benutzt.
Korpusweit haben **195 von 1256** Kachelgruppen in **109 Fields** eine Bitlücke
oder beginnen nicht bei Bit 0 — aber **keine davon liegt in einem Field, das
BGROL benutzt**: `hyou4`/param 1 ist mit den Bits 0…5 lückenlos. Gewählt ist
(a) als die einfachere Regel, ausdrücklich als 🟡-Annahme mit benannter
Alternative.

🟢 **Die Rotationsbreite ist dagegen gemessen: 8 Bit.** Der Zustandsoperand von
BGON/BGOFF nimmt über **9684** Literalvorkommen genau die Werte 0…7 an und nie
mehr; die Kachelzustände sind die acht Zweierpotenzen 1…128 (plus 0 für
statische Kacheln, plus 19 Streuwerte aus 121.868 — 0,016 %).

### Nebenbefund: das `RET` bei 2144 ist echt, der Code dahinter ist tot

In beiden Lesarten steht bei 2144 ein `RET` unmittelbar hinter
`BGON(00,01,00)` — die ganze nachfolgende Animationsschleife wäre damit
unerreichbar. Drei Hypothesen, gemessen:

- **(a) BGON hat in Wahrheit 4 Operandenbytes** — widerlegt. Bei Länge 4
  frisst `BGOFF` das folgende `e0` als vierten Operanden, und bei 2150 steht
  wieder ein `RET`. Die Referenz führt 0xE0 mit Operandenlänge 3, und diese
  Länge ist über F22 unabhängig belegt.
- **(b) 0x00 ist dort etwas anderes als RET** — kein Anhalt.
- **(c) Die Spanne enthält toten Code** — ✅ **belegt.** Die Entität `nami`
  besitzt 32 Skript-Slots, und **alle 32 zeigen auf 2137**. Es gibt keinen
  Eintrittspunkt bei 2145; die Spanne ist ein einziges Skript, dessen
  erreichbarer Teil nach drei Instruktionen endet.

Und das ist kein Sonderfall: Über alle 48.041 Spannen enthalten **12.849
(26,7 %)** Instruktionen, die vom Spannenanfang aus nicht erreichbar sind —
**121.330 von 372.814 Instruktionen (32,5 %)**. Toter Code ist in diesem
Bytecode die Regel, nicht die Ausnahme. Der Rollblock in `hyou4` ist damit eine
**stillgelegte** Animationsschleife: als Bytefolge vollständig, als Programm nie
ausgeführt. Für die Längenfrage ändert das nichts — die Konstruktion trägt ihre
Struktur unabhängig davon, ob sie läuft.

### 🔴 Neuer belegter Defekt: Rückwärtssprünge liegen um ein Byte daneben

Beim Nachrechnen des `JMPB 0x41` in `hyou4` gefunden. `vm.ts` berechnet das
Sprungziel als `ip + 1 − offset` (vom Operandenbyte aus). Gemessen über alle im
Instruktionsstrom erreichten Rücksprünge:

| Sprung | heutige Rechnung `ip + 1 − off` | Alternative `ip − off` |
|---|---|---|
| `JMPB` 0x12 | **39 / 5286 (0,7 %)** | **5266 / 5286 (99,6 %)** |
| `JMPBL` 0x13 | **0 / 97** | **97 / 97** |

Gezählt ist „Ziel liegt auf einer Instruktionsgrenze". Die Messanlage ist an
den **Vorwärts**sprüngen geeicht und besteht dort: `JMPF` trifft mit der
heutigen Rechnung `ip + 1 + off` **7809/7876 (99,1 %)**, die um eins
verschobene nur 974/7876. Vorwärts stimmt also, rückwärts ist es um genau ein
Byte daneben.

**Nicht behoben** — bewusst: Der Fixture-Assembler
(`tools/fixture-gen/src/script-assembler.ts`) erzeugt Rücksprünge mit derselben
Konvention. Beide Seiten sind konsistent falsch, alle Fixtures laufen; eine
einseitige Korrektur zerreißt jede Fixture-Schleife. Die Korrektur gehört in
einem Zug mit dem Assembler gemacht. Als Posten in
`docs/ROADMAP-OFFENE-POSTEN.md` geführt.

### Die Minigame-Zahlen

Zwei Begründungen aus Posten 2 sind gefallen:

1. **„Der Opcode kommt vor" ist nicht belegt.** Unter der korrigierten Tabelle
   sind es 67 verankerte Fundstellen in 49 Fields statt 118 in 79. Die fehlende
   Negativkontrolle liefert das Urteil: Dekodiert man dieselben Spannen ab
   `spanStart + k` — ein nachweislich falsches Raster —, meldet die verankerte
   Zählung **1318 / 652 / 717** Fundstellen für k = 1/2/3. Eine Zählung, die
   auf falschem Raster zehnmal so viel findet wie auf richtigem, ist kein
   Beleg für Vorkommen, sondern bestenfalls eine obere Schranke.
2. **Die „harte Schranke ≤ 5" beruht auf einem Tabellenfehler.** Sieben der
   acht engsten Fundstellen stehen direkt hinter der Folge `31 00` — das ist
   `IFKEYON` mit Tastenmaske `0x2000`, und das `0x20` ist deren hohes Byte.
   Sichtbar wird es nur, weil unsere Tabelle 0x31 mit Operandenlänge 2 führt
   statt der Referenzlänge 3. Setzt man 0x31 auf 3, verschwinden diese Stellen
   — dafür sinkt der Abschluss um 6 Spannen. Zwei Messungen, die sich
   widersprechen; keine schlägt die andere.

Was **steht**: Der engste Abstand beträgt auch nach der 0x31-Korrektur noch 7
Byte. Die Referenzlänge 10 passt in beiden Lesarten nicht, und der
Spannen-Abschluss bestätigt es (Länge 10: 48.001 gegen 48.006 — fünf Spannen
unter dem Ist-Wert, über der Rauschschwelle von 3). Das Maximum liegt bei
Länge 1 mit 48.007, also **eine** Spanne über dem Ist-Wert und damit unter der
Schwelle: auch die Alternative bleibt unbelegt. 0x20 bleibt auf 0.

### Die Lehre in einem Satz

**Wenn eine Gütefunktion blind ist, folgt daraus, mit einem anderen Mittel zu
entscheiden — nicht, dass es nichts zu entscheiden gibt.**

Die vollständige Fehlkette, die zu „BGROL ist nicht implementierbar" führte,
steht als Lehrstück im Quelltext bei `SKIP_OPERAND_LEN` in
`packages/interpreter/src/opcodes.ts`: zirkuläre Eichung, Phantom-Fundstellen,
n=1 als disjunkte Intervalle, Pseudoreplikation, Fehlschluss.

---

## F-LOC — Der Sprachzweig: welche Datei die Engine wirklich liest (2026-08-15)

Bis heute las **alles** im Projekt `data/kernel/…` und `data/battle/…`. Auf der
Kalibrierinstallation ist das der **deutsche** Zweig. Das Original lädt
nachweislich `data/lang-en/`.

### Der Wahrheitstest ist eine Kreuzvalidierung, kein Größenvergleich

`kernel.bin` Sektion 2 trägt bei `+0x0F1C` eine `0xFF`-terminierte Bytetabelle
„Block → erste Szene". Ihre Eintragszahl mal `0x2000` muss die Dateigröße der
`scene.bin` **desselben Zweigs** byteexakt treffen — eine externe Prüfmenge aus
einer anderen Datei, die ein falsch gepaarter Zweig nicht zufällig trifft.

| Zweig | Blockindex | `scene.bin` | Rechnung |
|---|---:|---:|---|
| `data/` | **34** Einträge | 278.528 B | 34 × 8192 ✅ |
| `data/lang-en/` | **33** Einträge | 270.336 B | 33 × 8192 ✅ |

**Kontrolle — die Kreuzpaarung scheitert** (34 ≠ 33, 33 ≠ 34). Ohne sie wäre
der Befund wertlos; mit ihr trennt die Probe.

### Sektion für Sektion: der Unterschied ist kleiner als erwartet, aber schärfer

27 Sektionen in beiden Zweigen. **0, 1, 4, 5, 6, 7, 8 byteidentisch**,
9–26 durchweg verschieden (auch in der Länge). Sektion 3 unterscheidet sich in
**3** Byte (`Ex-SOLDAT` gegen `Ex-SOLDIER`), Sektion 2 in **28** — und **alle 28
liegen im Blockindex**.

Damit ist eine offene Frage geschlossen, die anderswo als „kumulatives
Offset-/Breitenfeld, Leser unbekannt" geführt wurde: Es ist der
scene.bin-Blockindex, und der Unterschied ist **keine Übersetzung, sondern eine
Packungsfolge**. Die deutsche `scene.bin` braucht einen Block mehr.

🟢 **Regel, die daraus folgt:** `kernel.bin` und `scene.bin` müssen aus
demselben Zweig kommen. Gemischt zeigt der Blockindex in die falsche Datei.
Durchgesetzt von `pruefeVerbund` in `packages/io/src/locale.ts`.

### Was der Zweigwechsel in `scene.bin` ändert — und was nicht

Gemessen über alle 256 Szenen, Partition für Partition:

| Partition | Szenen mit Unterschied |
|---|---:|
| `enemyIds`, `setup`, `camera`, `formation`, `attack`, `formationAi` | **1** / 256 |
| Gegnerrecords | 220 / 256 — davon **216 nur im Namensfeld** |
| Attackennamen | 247 / 256 |
| KI-Skripte | 76 / 256 |

Die mechanischen Partitionen sind also gleich — bis auf **genau eine Szene**.
**Szene 4 ist im englischen Zweig vollständig leergeräumt** (durchgehend
`0xFFFF`), im deutschen trägt sie zwei Gegnertypen und alle vier Formationen.
Dazu zwei Byte an einem Gegner (`Lessaloploth`, Record `+0x98`) in drei Szenen.

Daraus folgen exakt drei geänderte Erwartungen im Bestand, **alle vollständig
auf diese eine Szene zurückgeführt**:

| Zahl | vorher | jetzt | Differenz |
|---|---:|---:|---|
| Gegnerrecords | 627 | **625** | −2 (die zwei Typen der Szene 4) |
| KI-Skripte | 614 | **612** | −2 (dieselben) |
| belegte Formationen | 1000 | **996** | −4 (alle vier der Szene 4) |
| belegte Formationsplätze | 2414 | **2401** | −13 |

Das ist keine Anpassung, sondern eine Erklärung: Die Differenz ist selbst die
Gegenprobe.

### Zwei Nebenbefunde

- `camdat0.bin`, `camdat1.bin`, `camdat2.bin` sind zwischen den Zweigen
  **byteidentisch**. Für K11 ist die Locale-Frage gegenstandslos.
- **K8 ist unberührt.** Kamera und Formationen der Szene 75 (Formation 301 —
  die Referenzaufnahme) sind in beiden Zweigen byteidentisch. Der 🟢-Befund
  „keine der drei Blockkameras zeigt die Ansicht des Originals" hängt nicht am
  Sprachzweig. Die Probe sichert das namentlich ab, damit es nicht wieder
  gefragt werden muss.

### Was offen bleibt

🔴 Der **Mechanismus**: welche Aufrufstelle im Original die Sprachkomponente
voranstellt. Das ist für uns folgenlos — wir lösen selbst auf —, steht aber
hier, damit die geklärte Tatsache nicht mit der offenen Frage verwechselt wird.
Die Auflösung ist ausdrücklich **je Datei**, nicht je Verzeichnis: `lang-en`
führt nur `battle/`, `kernel/` und `movies/`, und `battle.lgp` liegt allein im
Wurzelzweig.

*Proben: `tools/realdata-scan/src/locale-probe.rdtest.ts` (3 Fälle) ·
`packages/io/src/locale.test.ts` (15 Fälle) · gemeinsame Pfadauflösung in
`tools/realdata-scan/src/real-pfade.ts`.*

---

## F12-Nachtrag — `0xFFFF` bei @56/@58 ist eine Marke, kein Wert (2026-08-15)

F12 hat die abgeleiteten Maxima bei @56/@58 belegt. Was dabei offen blieb: Was
bedeutet dort `0xFFFF`? Der naheliegende Schluss „65535" ist falsch — und er
war im Code wirksam.

### Gemessen an den echten Spielständen

| | |
|---|---:|
| Slots | 7 |
| benannte Charakterrecords | **63** |
| davon `0xFFFF` an **beiden** Feldern | **24** (38,1 %) |
| davon `0xFFFF` an nur **einem** Feld | **0** |
| Maximum **unter** dem Basiswert | 18 |
| größtes **berechnetes** Maximum | **9999** |

`0xFFFF` heißt „noch nicht berechnet". Das Original füllt die Felder erst bei
Kampfeintritt, in den meisten Menübildern und bei jeder Gruppenänderung; wer nie
in der Gruppe war, behält die Marke. Mit 38 % ist das kein Randfall.

### Die Gütefunktion ist die Ordnung, nicht die Häufigkeit

Ein Zähler allein belegt nichts. Entscheidend ist die Ordnungsaussage
`aktuell ≤ Maximum`, über die F12 die Feldlage überhaupt bestimmt hat:

- **roh:** 63/63 bestanden — **trivial**, weil 65535 jeden Wert durchlässt.
- **aufgelöst:** 63/63 bestanden — und jetzt sagt es etwas.

Dass 65535 wirklich eine Marke ist, zeigt der Bestand selbst: Das größte
*berechnete* Maximum ist **9999**, die dokumentierte Obergrenze des Originals.
65535 liegt um Faktor 6,5 darüber und ist im Wertebereich unerreichbar.

### Zwei Fehler, die das im Code verursacht hat

1. **Lesend:** `specFromRecord` reichte `maxHp = 65535` in den Kampf, sobald
   eine Figur mit der Marke in der Gruppe stand.
2. **Schreibend, und das war der unauffälligere:** `setCharacterPoints` klemmte
   gegen den Rohwert. Bei der Marke klemmte es gegen 65535 — also gar nicht.
   Ein „auf voll heilen" hätte 65535 in die aktuellen HP geschrieben und damit
   genau die Ordnungsaussage zerstört, auf der F12 beruht.

Beide gehen jetzt über **eine** Funktion (`wirksamesMaximum` in
`formats-save/src/savemap.ts`); zwei Kopien wären zwei Wahrheiten.

### Was ausdrücklich NICHT eingebaut wurde

Eine Wache „Maximum ≥ Basiswert" wäre falsch: **18 von 63** Records haben ein
Maximum *unter* dem Basiswert, weil Magie-Materia HP nach unten und MP nach oben
handelt. Der Bestand hätte eine solche Wache sofort widerlegt — sie steht
deshalb als Negativbefund in der Probe.

### Dauerbefund

Die Marke tritt in diesem Bestand **nie einzeln** auf; beide Felder werden
gemeinsam gefüllt. Das ist eine Beobachtung über diesen Bestand, **keine
Zusicherung des Formats** — der Code behandelt die Felder weiterhin getrennt.
Schlägt die Erwartung `sentinelEinzeln === 0` je fehl, ist das die interessante
Nachricht und kein Regressionsschaden.

*Proben: `tools/realdata-scan/src/maxima-sentinel.rdtest.ts` (2 Fälle) ·
`packages/formats-save/src/maxima.test.ts` (8 Fälle).*
