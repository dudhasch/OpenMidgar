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
| **Kampf-Opcode: Negativbefund.** Kein Opcode trägt erkennbar eine Encounter-ID des eigenen Fields; der beste Kandidat mit ausreichender Häufigkeit erreicht 8,8 Prozentpunkte Abstand (Faktor 1,3). Entweder ist die Kampfauslösung indirekt kodiert, oder Sektion 7 enthält zu viele Zufallstreffer | 🔴 offen |
| Musik: 94 Titel, alle Kommentar-Header lesbar. **87 % tragen `LOOPSTART`, kein einziger `LOOPLENGTH`** | ✅ prägt das Schleifenmodell: von `LOOPSTART` bis Dateiende |
| `audio.fmt` (54.668 B) als feste Eintragstabelle: Nur die Eintragsgrößen 4 und 79 teilen die Datei glatt; die beste Feldkombination erreicht 66 % Rahmen-, 51 % Monotonie- und 46 % Überlappungsfreiheitsquote | 🔴 Negativbefund — das Format braucht einen Vorspann oder andere Feldbreiten |
| Musikindex → Dateiname: keine Indexdatei auffindbar, Dateinamen ohne Nummernschema (0 von 188 numerisch) | 🔴 Zuordnung offen |

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
| **Prüfsumme ungeklärt — und ein beinahe geglaubter Fehlschluss:** Fünf CRC-16-Varianten zeigten zunächst 89 % Treffer. Die Nachrechnung ergab, dass diese Treffer **exakt den leeren Slots** entsprechen, für die eine CRC mit Startwert 0 trivial 0 liefert. Bei den 8 belegten Slots trifft **keine** Variante | 🔴 Negativbefund; der Parser prüft deshalb bewusst keine Prüfsumme |

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
320×240: **97,1 %** mit der Regel „Layer 0 deckend, Layer 1–3 Index 0
transparent"; die Alternative „Rohwert 0 transparent" verliert 4 Punkte an
echtem Schwarz. Atlas-Packing: max. **1997 Kachelvarianten** je Field, damit
**1 Atlas** (2048²) für jedes der 701 Fields — die Masterplan-Grenze von 4
wird deutlich unterschritten.

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
