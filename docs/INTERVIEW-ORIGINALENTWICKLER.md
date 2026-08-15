# Interview mit einem Originalentwickler von Final Fantasy VII

**Zweck:** Einmalige Gelegenheit, die 🔴/🟡-Posten des Projekts an der Quelle zu
klären. Dieses Dokument ist Vorbereitung, Fragenkatalog und Antwortprotokoll in
einem.

**Stand:** 2026-08-11 · abgeleitet aus `WEBMIDGAR-MASTERPLAN.md`,
`ROADMAP-OFFENE-POSTEN.md`, `ROADMAP-S27-S36.md`, `ROADMAP-S37-EXE-ANALYSE.md`,
`ADR-S28-S29-WELTKARTE.md`, `ADR-S33-KAMPFINTEGRATION.md`,
`decompile-findings.md`, `DEMO-FINDINGS-1.0.md`, `QUELLEN-SICHTUNG.md`,
`tools/realdata-scan/FINDINGS.md`.

---

## 0. Vorbemerkung — die Zwei-Kanal-Regel

> **Stand 2026-08-15 überholt, aber nicht wertlos.** Die Trennung unten war mit
> der Clean-Room-Position begründet. Diese Position ist aufgegeben:
> [ADR-027](ADR-027-DECOMP-REFERENZ.md) hat dekompilierte Fremdquellen
> zugelassen, [ADR-028](ADR-028-EIGENE-CODEANALYSE.md) die eigene Analyse der
> PC-EXE ohne Auflagen. **K2 ist damit kein Sperrkanal mehr.** Die Tabelle
> bleibt trotzdem stehen, weil ihre *zweite* Begründung unberührt gilt: Eine
> Aussage aus zweiter Hand ist eine **Hypothese, keine Autorität** — auch dann,
> wenn sie vom Originalentwickler kommt. Erst recht nach 28 Jahren.

Der Masterplan sagte wörtlich: Semantiktabellen werden aus öffentlicher
Dokumentation und Verhaltensbeobachtung abgeleitet, **nie aus
Original-Disassembly des Engine-Codes**. Diese Regel gilt nicht mehr. Was
weiterhin für dieses Interview gilt:

| Kanal | Inhalt | Verwendung |
|---|---|---|
| **K1 — Datenfakten** | Aussagen über **Dateiformate, Feldbedeutungen, Wertebereiche, Einheiten, Reihenfolgen**. „Das Wort an dieser Stelle ist ein Index in die Maplist." | ✅ Direkt verwertbar. Wie jede Fremdquelle: **Hypothese, nicht Autorität** — anschließend gegen die Realdaten messen. |
| **K2 — Code & Algorithmen** | Aussagen über **Quelltext, Funktionsstruktur, konkrete Formeln aus der EXE**. „Die Schadensformel lautete …" | ⚠️ Protokollieren, **aber getrennt ablegen** und nicht in den Implementierungspfad geben. Alternativ: gar nicht erst fragen. |
| **K3 — Geschichte & Prozess** | Wie gearbeitet wurde, Werkzeuge, Entscheidungen, Anekdoten | ✅ Unbedenklich, hoher Erzählwert, oft indirekt technisch aufschlussreich. |

**Praktische Umsetzung, die beides rettet:**

1. Fragen so stellen, dass sie **K1-Antworten provozieren**: nicht „Wie lautete
   die Formel?", sondern „**Woran** würde ich in den Daten erkennen, ob meine
   Formel stimmt?" Das ist zugleich die für euch nützlichere Antwort, weil sie
   messbar ist.
2. Der Interviewte entscheidet selbst, was er sagen darf — **nicht** zum
   Nachhaken drängen, wenn er ausweicht. Notiz: „NDA-Grenze".
3. **Provenienz mitschreiben.** Jede übernommene Aussage bekommt im Code/Doku
   den Herkunftstag `Interview-<Datum>-<Frage-ID>`, genau wie die
   Fremdquellen-Tags. Wenn später etwas zurückgezogen werden muss, ist es
   auffindbar.
4. Wenn er von sich aus Code beschreibt: aufnehmen, aber im Protokoll als **K2**
   markieren und nicht implementieren, bevor jemand entschieden hat, ob das
   tragbar ist.

**Der wichtigste Satz für das Gespräch selbst:** Die Erinnerung ist ~28 Jahre
alt. Ein Entwickler, der sich an eine Konstante „ziemlich sicher" erinnert, ist
nach Projektmaßstab eine **🟡-Annahme**, kein 🟢-Formatfakt. Das ist keine
Respektlosigkeit — es ist dieselbe Regel, die auch Makou Reactor, KimeraCS und
FFNx trifft, und sie hat dem Projekt bei O9 dreizehn Prozentpunkte gerettet.
Deshalb bei **jeder** Antwort mitprotokollieren:

> **Sicherheitsgrad:** `sicher` · `glaube ich` · `weiß nicht mehr` · `NDA`

---

## 1. Was ihr braucht — Ausrüstung und Vorbereitung

### 1.1 Technik (redundant, sonst ist es weg)

- [ ] **Zwei Aufnahmegeräte.** Hauptaufnahme + unabhängiges Backup (Handy
      daneben). Ein einziges verlorenes Interview dieser Art ist nicht
      wiederholbar.
- [ ] **Aufnahmeeinwilligung** vor Aufnahmebeginn, **auf der Aufnahme selbst**
      eingeholt. Schriftlich zusätzlich.
- [ ] Bei Videocall: **lokale Aufnahme** beider Seiten, nicht nur die
      Cloud-Aufnahme der Plattform.
- [ ] **Bildschirmfreigabe vorbereitet** — s. 1.2.
- [ ] Transkript hinterher (automatisch + manuelle Korrektur der Fachbegriffe;
      ASR verstümmelt „LGP", „hrc", „Walkmesh" zuverlässig).

### 1.2 Material, das ihr **zeigen** solltet (der größte Hebel)

Erinnerung an ein Format nach 28 Jahren ist schwach — **Wiedererkennung** ist
stark. Legt Anschauungsmaterial bereit, dann beantwortet er Fragen, die er
freihändig nicht beantworten könnte:

- [ ] **Hexdumps** der strittigen Records, sauber annotiert und ausgedruckt/als
      PDF: Gateway-Record (24 B), Tile-Record (52 B), Kamera-Record (38 B),
      `audio.fmt`-Eintrag (74 B), Sektion-3-Modellblock (30 B), `.a`-Frame
      (24 B + 12 B/Bone), Weltkarten-Dreieck (12 B).
- [ ] **Screenshots eurer Demo neben Originalscreenshots** — besonders die
      offenen Sichtfindings: Kampfbühne, Weltkartenfarben, Menü.
- [ ] **Eine Liste der Dateinamen** der Installation (`flevel.lgp`,
      `world_us.lgp`, `battle.lgp`, `audio.fmt/dat`, `music.idx`, `co.bin`,
      `camdat*.bin`, `enc_w.bin`, `field.tbl`, `WINDOW.BIN`, `maplist`). Namen
      lösen Erinnerungen aus, Beschreibungen nicht.
- [ ] **Die Werkzeugnamen der Zeit**, falls bekannt (interne Editoren für
      Fields, Kampfszenen, Weltkarte) — falls er einen nennt, ist das ein
      Aufhänger für ein halbes Dutzend Folgefragen.

### 1.3 Organisation

- [ ] **Fragenkatalog vorab schicken** (mindestens die P0-Liste, Anhang A). Gibt
      ihm die Chance, nachzudenken, alte Notizen zu suchen und die NDA-Grenze
      selbst vorab zu ziehen. Erhöht die Ausbeute drastisch.
- [ ] **Zeitbudget klären und danach priorisieren.** 60 Min ⇒ nur Anhang A.
      3 Std ⇒ Blöcke A–F. Ein Tag ⇒ alles.
- [ ] **Zweiter Termin ausdrücklich erbitten**, schon im ersten. Die wertvollsten
      Fragen entstehen aus den ersten Antworten.
- [ ] **Erlaubnis zur Veröffentlichung** getrennt klären: (a) gar nicht,
      (b) als Fakten ohne Namensnennung, (c) zitierbar mit Namen. Die Antwort
      unterscheidet sich oft je Frageblock.
- [ ] **Artefakt-Frage stellen** (s. Block N) — Notizen, Spezifikationen,
      Werkzeugquellen, die noch existieren, sind mehr wert als jede
      Erinnerungsfrage.
- [ ] **Kontakt zu weiteren Beteiligten** erbitten. Wer einen erreicht hat,
      erreicht oft drei.
- [ ] Dolmetscher/Sprachfrage vorab klären, falls das Interview nicht in einer
      gemeinsamen Muttersprache stattfindet — technische Präzision ist hier
      alles.

### 1.4 Protokollformat je Frage

```
ID: I-C4
Frage: …
Antwort (wörtlich, wo möglich): …
Sicherheitsgrad: sicher | glaube ich | weiß nicht mehr | NDA
Kanal: K1 | K2 | K3
Prüfplan: Wie messen wir das gegen die Realdaten? Welche Kontrollhypothese?
Status: übernommen 🟢 | Hypothese 🟡 | verworfen | offen
```

---

## 2. Block Ø — Rollenklärung (immer zuerst, 10 Minuten)

Ohne das sind viele Fragen an die falsche Person gerichtet. FF7 hatte mindestens
drei technisch getrennte Welten: **PSX-Original (1997)**, **PC-Port (1998)** und
**spätere Re-Releases**. Und innerhalb davon Field-Engine, Battle-Engine,
Weltkarte, Menü, Audio, Werkzeugkette.

| ID | Frage |
|---|---|
| I-Ø1 | An welchem Teil hast du gearbeitet — PSX-Original, PC-Port, oder beides? |
| I-Ø2 | Welches Subsystem war deins? (Field / Battle / Weltkarte / Menü / Audio / Renderer / Werkzeuge / Datenpipeline) |
| I-Ø3 | In welchem Zeitraum? Warst du bis zum Release dabei? |
| I-Ø4 | Wie groß war das Programmierteam, und wie war es geschnitten? |
| I-Ø5 | Wenn du eine Frage nicht beantworten kannst — wusste jemand anderes das, und lebt/erreichbar? |
| I-Ø6 | Gibt es Themen, über die du aus rechtlichen Gründen nicht sprechen kannst? Dann klären wir das jetzt und ich frage nicht danach. |

> **Weiche:** Ist er reiner PSX-Entwickler, sind die Blöcke A (EXE) und teilweise
> G (Audio-PC) weitgehend leer — dafür werden B/D/E/F umso wertvoller, weil die
> Datenformate zwischen PSX und PC weitgehend geteilt sind. Ist er PC-Port-Mann,
> ist Block A der Jackpot.

---

## 3. Block A — Die EXE, der Build und der PC-Port

Kontext aus `decompile-findings.md`: `.data` und `.rdata` sind zwischen
`ff7.exe` und `ff7_en.exe` **byteidentisch**, die 252 abweichenden
`.text`-Bytes sind reine Relokationen. Link-Zeitstempel beider: **1998-09-15**.
`.data` meldet vsize 7,96 MB bei 1,98 MB Dateiinhalt.

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-A1 | P0 | Es gibt offenbar **keine sprachverschiedenen EXE-Builds** — `ff7.exe` und `ff7_en.exe` haben byteidentische Daten-Sektionen. War das Absicht? Wo lagen die lokalisierten Zeichenketten dann? | K1 |
| I-A2 | P0 | Wir finden Item-, Materia- und Zaubernamen strukturell **nicht** in der EXE. Kommen die vollständig aus `kernel.bin`? Gab es je Namen, die hartkodiert waren? | K1 |
| I-A3 | P0 | `.data` reserviert 8 MB Adressraum bei 2 MB Dateiinhalt. War das ein statisch reserviertes Arbeits-Arena (Savemap, Bänke, Puffer)? Lag die **Savemap** dort? | K1 |
| I-A4 | P1 | Wir haben 41 Zeigertabellen in der EXE katalogisiert. Gab es einen **generierten** Teil der EXE (Tabellen aus Build-Skripten) gegen handgeschriebenen? Woran erkennt man den? | K1 |
| I-A5 | P1 | Welcher **Compiler und welche Version**? Welche Optimierungsstufe? (Wichtig für uns nur zum Verstehen der Datenausrichtung/Padding.) | K3 |
| I-A6 | P1 | Padding- und Ausrichtungsregeln in den Datenstrukturen: Kann man aus einer Recordgröße von 24/38/52/74 Byte auf die C-Struktur zurückschließen, oder waren die Records handgepackt? | K1 |
| I-A7 | P1 | Der Link-Zeitstempel ist 1998-09-15 — und Steam liefert bis heute eine gepatchte 1998er-Binary. Weißt du, was in den späteren Patches geändert wurde? | K3 |
| I-A8 | P1 | Zahlentabellen **ohne** Zeichenketten (ATB-Kurven, Schadensmodifikatoren, Wachstumskurven) sind mit Zeigersuche nicht auffindbar. Gab es dafür ein **Namens-/Ordnungsschema** im Speicherlayout, an dem man sie erkennt? | K1 |
| I-A9 | P2 | Wurde die PSX-Version dekompiliert/portiert oder aus gemeinsamen Quellen gebaut? Wie viel Code war geteilt? | K3 |
| I-A10 | P2 | Gab es ein internes Debug-Menü/Debug-Build? Ist etwas davon in der Retail-EXE übrig? | K3 |
| I-A11 | P2 | Renderer: Direct3D-/Glide-Pfad — welche Fixed-Function-Zustände waren gesetzt (Depth-Test, Alpha-Blending-Modi, Backface-Culling, Winding-Order)? Das ist für uns **direkt** relevant, weil wir Winding-Fallen hatten. | K1 |

---

## 4. Block B — Field-Script-Engine (Interpreter-Semantik)

Der teuerste Block für uns: `R1` ist im Masterplan als **P0-Risiko** und
„kritischste Kategorie für Determinismus" geführt.

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-B1 | **P0** | **Prioritätsverdrängung bei Script-Requests:** Ein Request an eine Entität, deren Slot schon läuft — was passiert? Verdrängung, Warteschlange, Verwerfen? Und was, wenn die *gleiche* Priorität kommt? Was passiert bei Selbstverdrängung? | K1 |
| I-B2 | **P0** | Wie viele Prioritätsstufen gab es tatsächlich, und wurden sie wirklich benutzt? | K1 |
| I-B3 | **P0** | Der Scheduler: Wie viele Instruktionen liefen pro Tick pro Entität? Feste Zahl, „bis zum nächsten Wartezustand", oder Zeitbudget? **Das entscheidet unsere gesamte Determinismus-Zusicherung.** | K1 |
| I-B4 | P0 | In welcher **Reihenfolge** wurden die Entitäten pro Tick abgearbeitet? Feste Indexreihenfolge? Und war die Reihenfolge über Speichern/Laden stabil? | K1 |
| I-B5 | P0 | **Slot-Konvention:** Wir nehmen an, Slot 0 = init/main, **Slot 1 = Talk**, weitere = Kollision/Custom. Stimmt das? Wie viele Slots gab es maximal? (Doku sagt „bis zu 32".) | K1 |
| I-B6 | P1 | **16-Bit-Bankzugriff an Adresse 0xFF:** Wrappte die Engine innerhalb der Bank oder griff sie in die Folgeregion über? (Wir wrappen derzeit; die Auslegungen unterscheiden sich an genau einer Adresse.) | K1 |
| I-B7 | P1 | **Bank-Aliasing:** Wir haben die Paare 1/2, 3/4, B/C, D/E, 7/F auf 5 persistente Regionen plus temporär 5/6 abgebildet. Ist das richtig, und was war der Zweck der Paarung — 8-Bit- vs. 16-Bit-Sicht auf dieselbe Region? | K1 |
| I-B8 | P1 | Was passierte bei einem **unbekannten Opcode** oder einem Sprung ins Leere? Absturz, Ignorieren, Script-Ende? (Wir haben eine UNKNOWN-Politik mit Slot-Deaktivierung erfunden.) | K1 |
| I-B9 | P1 | Waren Script-**Spannen** garantiert disjunkt, oder gab es absichtliches Überlappen/Sprünge zwischen Entitäten? | K1 |
| I-B10 | P1 | `WAIT` zählte in **Frames** — bei 30 fps im Field? Und lief der Zähler weiter, während ein Dialog offen war? | K1 |
| I-B11 | P1 | **Bewegungs-Opcodes:** Wie war die Interaktion zwischen Skript-getriebener Bewegung und dem Walkmesh-Solver? Konnte ein `MOVE` das Mesh verlassen? Was passierte, wenn das Ziel unerreichbar war (unser Stillstandszähler)? | K1 |
| I-B12 | P1 | **`outcome` nach einem Kampf:** Unsere Messung sagt, der Interpreter schreibt das Kampfergebnis in **keine** Script-Variable (Faktor 1,04 gegen Kontrolle). Wie hat ein Field-Script dann erfahren, ob der Kampf gewonnen wurde? Eigener Opcode? Sonderadresse? | K1 |
| I-B13 | P2 | Gab es eine **Rekursionsgrenze** oder eine Grenze für gleichzeitig laufende Scripts? | K1 |
| I-B14 | P2 | Wurden Script-Zustände (Programmzähler, Wartezähler) im **Savegame** mitgeführt, oder startete ein Field beim Laden immer neu? | K1 |
| I-B15 | P2 | Gab es Opcodes, die im Release nie benutzt wurden — Altlasten aus der Entwicklung? Welche? | K1 |
| I-B16 | P2 | Wir haben Operandenlängen **aus den Daten abgeleitet** (99,92 % Spannen-Abschluss). Gab es Opcodes mit **variabler** Länge? Das wäre die Erklärung für unsere Restfehler von 0,06 %. | K1 |

---

## 5. Block C — Field-Daten (`flevel.lgp`, Sektionen, Hintergrund)

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-C1 | **P0** | **Gateway-Record (24 B):** Das Zielfield steht als `u16`-Index in die `maplist` — aber der **Zielpunkt steht nicht im Record**. Wie hat die Engine die Ankunftsposition bestimmt? Über das Gegen-Gateway des Zielfields? Über den Script? (Wir rekonstruieren das heute geometrisch und treffen 510/1095 exakt.) | K1 |
| I-C2 | **P0** | Wie erkannte die Engine einen **ungenutzten** Gateway-/Trigger-Slot? Wir erkennen ihn an entarteter Geometrie (identische Ecken); der oft genannte Sentinel `0x7FFF` kommt im Bestand **nie** vor. | K1 |
| I-C3 | **P0** | **Animierte Hintergrund-Tiles:** Wir haben `param` (u8@28) und `state` (u8@29) belegt. **Wer schaltet den Zustand?** Welche Field-Opcodes setzen Parameter/Zustand, und wie funktionieren `BGON`/`BGOFF`/`BGCLR` genau — Bitmaske je Parameter? | K1 |
| I-C4 | P0 | Was tun `BGROL` / `BGROL2` (wir überspringen sie)? Rollende/scrollende Hintergrundlayer? | K1 |
| I-C5 | P0 | **Tile-`z` (u16@26):** In Layer 0 konstant 4095. Ist `z` **nur** ein Sortierschlüssel oder eine metrische Tiefe? Und wie hing die Tiefensortierung der Tiles mit der 3D-Tiefe der Figuren zusammen? (Genau da liegt unsere Verdeckungsfrage.) | K1 |
| I-C6 | P0 | `layerControl` (u16@20): Was steuert es genau? Wir wissen nur: bei Layer 2 ⇒ 32-px-Kacheln. | K1 |
| I-C7 | P1 | **Transparenz-Regel:** Layer 0 deckend, Layer 1–3 Paletten-Index 0 = Loch — trifft bei uns 97,1 %. Was erklärt die restlichen 2,9 %? Gab es Blendmodi (additiv/subtraktiv) je Tile? Wo stehen die? | K1 |
| I-C8 | P1 | `flags` (u8@25) im Tile-Record — welche Bits, welche Bedeutung? | K1 |
| I-C9 | P1 | `bpp` (u8@38) und die Texturseiten (65536 · depth): Wie war das VRAM-Layout gedacht — 1:1 PSX-VRAM-Emulation auch auf PC? | K1 |
| I-C10 | P1 | **Kamera-Record (38 B, nicht 40):** Wir bilden `C = −Rᵀ·t` und `ff7→scene = (x, z, −y)`. Ist die Konvention richtig, und was steht im Wiederholungsfeld am Ende? | K1 |
| I-C11 | **P0** | **FOV-Basis:** Wir haben 240 aus den Daten abgeleitet (bemalte Layer-0-Fläche −120…+120 in 119 Fields, 224 in 26). War die Projektion an eine feste vertikale Basis gebunden, und was war der Wert? Und warum unterscheiden sich manche Fields? | K1 |
| I-C12 | **P0** | **`zScale`:** Wir mussten einen Faktor 4 einführen, damit die Tiefenordnung in allen 702 Fields hält — als *untere Schranke*, ohne Beleg. Gab es einen festen Tiefenskalierungsfaktor zwischen Walkmesh-Koordinaten und Tile-`z`? | K1 |
| I-C13 | P1 | **Walkmesh:** Wie wurde die Höhe innerhalb eines Dreiecks interpoliert? Und wie war das Verhalten am Rand — Gleiten an der Kante oder Stoppen? | K1 |
| I-C14 | P1 | Sektion 5 (`flevel`): Was steht darin? (Wir haben sie als Musikliste vermutet, verworfen.) | K1 |
| I-C15 | P1 | **Sektion 3, Modellblock (30 B):** Welche Bytes sind Licht (Richtungen/Farben) und welche Umgebungsfarbe? Wir haben ein „Farbe zuerst"-Layout angenommen und den Rest nicht aufgeteilt. Wurde das Licht **pro Vertex** gebacken (Lambert), oder pro Fläche? | K1 |
| I-C16 | P1 | Was ist das `u16`-Flag (0/1) direkt hinter dem Modellnamen in Sektion 3? | K1 |
| I-C17 | P1 | Was ist der `tail`-Wert hinter jedem Animationsnamen (in 97,1 % gleich 1)? | K1 |
| I-C18 | P1 | **Animationsnamen sind keine Dateinamen** — die drei Zeichen hinter dem Punkt (`xxxx.aki`) sind offenbar eine Kennung, die aufgelöste Datei heißt `<stamm>.a`. Was kodieren diese drei Zeichen? | K1 |
| I-C19 | **P0** | **`ANIME`-Operand → Clip:** Wie wurde eine numerische Animationsnummer im Script auf einen Clip der Modell-Animationsliste abgebildet? Einfach Index in die Sektion-3-Liste? (Unser 🔴-Posten aus S38.) | K1 |
| I-C20 | P0 | Welche Animation lief, wenn ein Script **keine** setzte? Wir setzen Index 0 als Ruheanimation (Hypothese) — vorher liefen alle Figuren in der Bindpose. | K1 |
| I-C21 | P1 | **Sektion 9, Separator-Regel:** „4 Nullbytes nach aktivem Block, wenn noch ein Flag folgt" — ist das die Regel, oder haben wir ein Nebenprodukt der Regel gemessen? | K1 |
| I-C22 | P2 | Wie wurden Fields **erzeugt**? Gab es einen Field-Editor, und was war sein Ausgabeformat vor dem Packen? | K3 |
| I-C23 | P2 | Warum sind nur 1095 von 8424 Gateway-Slots belegt — feste Arrays im Editor? | K1 |

---

## 6. Block D — Modelle und Animation (`char.lgp`, `.hrc/.rsd/.p/.tex/.a`)

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-D1 | **P0** | **Der Skalierungswiderspruch:** Der Modelldateiname trägt die Skala im Feld (`xxxx.hrc512`) — aber sichtkalibriert stimmt erst der Bezugswert **128**, also 512/4. Woher kommt der Faktor 4? Was war der Bezugswert der Modellskala wirklich? | K1 |
| I-D2 | **P0** | **Blickrichtungs-Nullpunkt:** Wir brauchen −90° Versatz, damit „hoch = Rücken" stimmt. Wie war die Nullrichtung eines Field-Modells definiert, und in welchem Drehsinn wurden Richtungsbytes gezählt? | K1 |
| I-D3 | **P0** | **Field vs. Battle:** Im Field ist der Kindversatz `−len`, im Battle `+len`, und der Battle-Wurzelframe hat X = 270°. Warum unterscheiden sich die beiden Konventionen? Zwei Werkzeugketten? | K1 |
| I-D4 | P0 | **`.a`-Byte 15:** In der EXE steht bei einem Animations-Textformat ein benanntes Feld „Rotationsauflösung" in Grad. Ist Byte 15 des `.a`-Kopfes diese Rotationsauflösung? (Im Bestand konstant 0 — für uns nicht entscheidbar.) | K1 |
| I-D5 | P0 | Rotationseinheiten: Field-Animationen in **Grad**, Battle-Animationen in **4096 Einheiten = 360°** — richtig? Und warum zwei Systeme? | K1 |
| I-D6 | P0 | **Euler-Reihenfolge YXZ** steht als Datum im `.a`-Kopf (3209/3209). Konnte sie je einen anderen Wert annehmen, oder war das Feld tot? | K1 |
| I-D7 | P1 | **`rootTranslation`:** Wir haben gemessen, dass der Wurzel*bone* 3–6 Einheiten über dem Boden sitzt, die Engine aber den **Modellursprung** auf den Boden setzt. Ist das richtig, und was war der Zweck der Wurzeltranslation — Hüfthöhe? | K1 |
| I-D8 | P1 | Was passierte mit den **waagerechten** Komponenten der Wurzeltranslation? Wurzelbewegung (root motion) oder ignoriert? | K1 |
| I-D9 | P1 | **`.p`-Format:** BBox-Record 28 B, Normalindex-Tabelle 4·nVerts, Vertexindizes **gruppenrelativ**. Was war der Zweck der Normalindex-Tabelle — geteilte Normalen für Smooth Shading? | K1 |
| I-D10 | P1 | **`.tex`:** 236-B-Header. Wie war die Palettenauswahl gedacht, und wie funktionierte der Farbschlüssel/Transparenzindex? Gab es einen 16-Bit-Direktfarbpfad? | K1 |
| I-D11 | P1 | **Knochenreihenfolge:** Dateireihenfolge = Tiefensuche im `.hrc`. War die Auswertungsreihenfolge im Renderer dieselbe, oder gab es eine getrennte Zeichenreihenfolge? | K1 |
| I-D12 | P1 | Wie wurden Waffen/Zusatzteile an die Skeletthierarchie **gehängt** (Field und Battle je einzeln)? | K1 |
| I-D13 | P2 | Wurde zwischen Animationen **interpoliert/geblendet**, oder hart geschnitten? Und mit welcher Rate liefen die Animationen relativ zum Field-Tick? | K1 |
| I-D14 | P2 | Woher kam der Modellexport — welches DCC-Werkzeug, welches Zwischenformat? | K3 |

---

## 7. Block E — Weltkarte (`world_us.lgp`, `world_gm.lgp`, `data/wm`)

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-E1 | **P0** | **`field.tbl`:** 64 Sätze à 24 B, je zwei Einträge (default/alternativ) mit `x, y, triangle, fieldId, direction`. Was schaltet zwischen default und alternativ? Und wie hängt Opcode `0x318 enter_field` damit zusammen? | K1 |
| I-E2 | **P0** | **`.BOT`-Dateien:** Sie enthalten dieselben Unikatmengen wie die `.MAP`, aber keine eigene Geometrie. Wozu waren sie da? | K1 |
| I-E3 | **P0** | **Weltkarten-Texturen:** `textureID = w & 0x1FF`, `locationID = w >> 9`; UV-Bytes VRAM-seiten-absolut mit `uOffset/vOffset` und Modulo. Wo lag die Tabelle, die `textureID` auf eine konkrete Textur abbildet — in der EXE, im Archiv, oder implizit über die Archivreihenfolge? **Das ist unser sichtbar größter Weltkarten-Fehler.** | K1 |
| I-E4 | P0 | **Geländeklassen:** 5 Bit `walkClass` im Dreiecks-Attribut. Was bedeuten die Klassen, und stimmt „Wasser = Klasse 3"? Was sind die anderen 3 Bit? | K1 |
| I-E5 | P0 | **Fahrzeug-/Geländematrix:** Welches Fahrzeug darf auf welche Klasse? Lag die Matrix in der EXE? (Wir haben in der EXE einen Kandidaten gefunden, aber keine Semantik.) | K1 |
| I-E6 | P0 | **Alternativblöcke WM0 63–68** (63→50, 64→41, 65→42, 66→60, 67→47, 68→48): geschaltet über `0x349` mit 5 Fortschrittsstufen. Wie war die **Abbildung Stufe → Gruppe**? | K1 |
| I-E7 | P0 | **WM3-Rasteranordnung:** 12 Unikate auf 64 Meshes — unsere Messung ist blind. Wie war WM3 (offenbar der Krater / Innenbereich) angeordnet? Und WM2? | K1 |
| I-E8 | **P0** | **Weltkarten-Begegnungen:** `enc_w.bin` folgt **nicht** dem Field-Raster. Wie sah der Satz aus, und wie hing die Begegnungsrate von Region und Fahrzeug ab? | K1 |
| I-E9 | P0 | **`.ev`-Bytecode:** eigene `u16`-Stack-Grammatik, Call-Tabelle fix 0x400 B, Codebasis ab Wort 512. Was tun die **Kommando-Opcodes im 0x300er-Bereich** (23,6 % der realen Instruktionen)? Das ist der größte Einzelblock, den wir nicht ausführen. | K1 |
| I-E10 | P0 | **Anlass der Mesh-Funktionsausführung:** Wird eine Mesh-Funktion beim Betreten des Meshes ausgeführt, oder über das `script`-Feld (3 Bit ≥ 3 ⇒ Funktions-ID = script − 3) am Dreieck? | K1 |
| I-E11 | P1 | Stack-Semantik der Weltkarten-VM: Wie tief, wie initialisiert, und was passierte bei Unterlauf? | K1 |
| I-E12 | P1 | Kurs-/Richtungssystem: Wir rechnen mit einem 256er-Kurs und einer auf 1/4096 gerundeten Richtungstabelle. Was war das Original? | K1 |
| I-E13 | P1 | Wie wurde die Weltkarte **gestreamt** — vollständig im Speicher oder blockweise nachgeladen? (Wir haben einen Streamer mit Wicklung gebaut.) | K1 |
| I-E14 | P1 | Wie kamen die Höhen zustande — `h` im Vertex, und was war die Einheit relativ zu `x`/`z` ∈ [0,8192]? | K1 |
| I-E15 | P2 | Wie sah die Weltkarten-Beleuchtung aus? Die Normalentabelle (8 B) — pro Vertex oder pro Dreieck? Und war die Farbgebung Textur × Licht? | K1 |

---

## 8. Block F — Kampf (`scene.bin`, `battle.lgp`, `kernel.bin`, `co.bin`/`camdat`)

Der Block mit den meisten offenen 🔴 und dem schlechtesten Sichtbefund
(19/27 „katastrophal" in der Demo-Bewertung).

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-F1 | **P0** | **Stage-Format:** Kampfbühnen liegen als `og`–`rr` in `battle.lgp` und sind offenbar derselbe `.p`/TEX-Pfad. Wie war eine Bühne aufgebaut — mehrere Teile, feste Reihenfolge, eigene Transformationen? Gab es animierte Bühnenteile? | K1 |
| I-F2 | **P0** | **Battle-Animation `da`:** Bitstrom mit 12-B-Kopf, Frame 0 roh, danach Delta; Rotation 1 Bit + 3 Bit `dLen`. **Beide Framezähler im Kopf sind falsch** — man muss bis Stromende lesen. Warum? Was steht in den Zählern wirklich? | K1 |
| I-F3 | **P0** | Was ist die Datei mit Suffix `ab` im Battle-Namensraum? | K1 |
| I-F4 | **P0** | **`camdat*.bin` / `co.bin`:** Enthalten offenbar PSX-Zeiger. Wie war eine Kampfkamera-Sequenz aufgebaut, und wie wurden Kameras je Aktion ausgewählt? | K1 |
| I-F5 | **P0** | **Kampfaufstellung:** Wir messen die Battle-Basis als x-rechts / y-ab / z-Tiefe, 91,8 % der Slots auf Boden 0. Stimmt das, und ist die z-Achse gespiegelt? (Gegner erscheinen bei uns möglicherweise falsch gedreht.) | K1 |
| I-F6 | **P0** | **Modellgröße im Kampf:** Unsere Gegner sind „viel zu klein". Gab es einen eigenen Skalierungsfaktor für Kampfmodelle, getrennt von Field? | K1 |
| I-F7 | **P0** | **ATB:** Mit welcher Rate füllte sich der Balken, wie ging die Geschwindigkeitsstatistik ein, und was änderte die Kampfgeschwindigkeits-Einstellung genau? Und lief der Kampf wirklich mit **15 fps**? | K1/K2 |
| I-F8 | P0 | **Schadensformel** — falls NDA es zulässt: nicht die Formel, sondern: **Woran** in den Daten (kernel-Records, scene-Records) erkenne ich, welche Modifikatoren in welcher Reihenfolge angewandt wurden? | K1 |
| I-F9 | P0 | **PRNG:** Welcher Zufallszahlengenerator? Wurde er gesaved? War der Kampfverlauf reproduzierbar? (Wir haben einen eigenen, dokumentiert abweichenden PRNG — die Konsequenz steht in unseren Release-Notes.) | K1/K2 |
| I-F10 | **P0** | **Begegnungsrate im Field:** Die `rate`-Formel liegt in der EXE. Was zählte der Schrittzähler — Walkmesh-Distanz, Frames, Schritte? Und wie ging `rate` (u8) ein? | K1/K2 |
| I-F11 | P0 | Wir haben belegt: `scene = id >> 2`, `formation = id & 3`, obere 6 Bit = Wahrscheinlichkeitsanteile mit **Summe 64**. Richtig? Und was schaltet auf die **zweite** Encounter-Tabelle (Verdacht: Opcode `0x4B`/`BTLTB`)? | K1 |
| I-F12 | P1 | **KI-Grammatik:** Handler-Tabelle 16×u16, Terminator `0x73`, `0x72` trägt u16, `0x93`-String endet mit `0xFF` (0x00 ist Trenner). Was bedeuten die 16 Handler-Slots einzeln (Vor-Zug, Nach-Schaden, Tod, …)? | K1 |
| I-F13 | P1 | Gegner-KI-Offsets liegen bei **0xE80** (nicht 0xF00, wie die Community sagt). Bestätigt? | K1 |
| I-F14 | P1 | **`scene.bin`-Container:** 34 Blöcke à 0x2000, gzip mit 0xFF-Füllung. Warum 0xFF und nicht 0x00? War das ein CD-Sektor-Artefakt? | K1 |
| I-F15 | P1 | **Wachstumskurven** (`kernel` Sektion Growth): 9×56 Charaktere, Kurvenbasis 0x21C, EXP-Kurven 55–63 mit Basis 0. Wie wurden Kurven interpoliert — Stützstellen je 4 Stufen? | K1 |
| I-F16 | P1 | **EXP/AP/Gil-Verteilung:** Nach Anzahl lebender Party-Mitglieder? Was bekamen KO'te Mitglieder? | K1 |
| I-F17 | P1 | **Item-Restriktionen sind bitinvertiert** in den Kernel-Records. Absicht oder Werkzeug-Artefakt? | K1 |
| I-F18 | P1 | **`magic.lgp`:** Wie heterogen sind die Effektformate wirklich? Gibt es ein Grundgerüst, oder ist jeder Effekt Sondercode? | K1 |
| I-F19 | P1 | **Battle-Skelett** (52 + 12n, `i32 parent · f32 length · u32 flag`): Was kodiert das Flag? | K1 |
| I-F20 | P2 | Wie wurde der Übergang Field → Kampf → Field technisch abgewickelt (Speicherzustand, Ladepunkte, das „Swirl")? | K1 |
| I-F21 | P2 | Gab es Kämpfe/Formationen, die es nie ins Spiel geschafft haben? (272 belegte Formationen erreicht bei uns keine der drei Quellen.) | K1 |

---

## 9. Block G — Audio

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-G1 | **P0** | **`music.idx` ist 0-basiert, die Musik-ID im Script 1-basiert** (EXE-Tabelle hat 99 Einträge, Eintrag 0 ist Platzhalter). Warum der Versatz? War Musik-ID 0 „keine Musik"? | K1 |
| I-G2 | P0 | Wie war die **Schleife** gemeint? Die OGGs tragen `LOOPSTART` in 87 % der Fälle, aber **nie** `LOOPLENGTH`. War das Original-MIDI-Verhalten „Schleife bis Dateiende, dann zurück zu LOOPSTART"? | K1 |
| I-G3 | P0 | **`audio.fmt`:** 724 Einträge à 74 B + **26 Bankabschlussmarken à 42 B**. Was ist eine „Bank" — SFX-Gruppen je Kontext (Field/Battle/Menü)? Und was bedeuten die sechs `u32` (`Length, Offset, Loop, Count, Start, End`) genau, besonders `Count`? | K1 |
| I-G4 | P1 | **SFX-Opcode `SOUND` (0xF1)** hat 4 Operanden inklusive Pan (0x00–0x7F, Mitte 0x40). Was sind die anderen? Lautstärke, Kanal? Und wie viele gleichzeitige Kanäle gab es? | K1 |
| I-G5 | P1 | Wie war das **Verhältnis MIDI ↔ OGG** im PC-Release? Wurden beide ausgeliefert und nach Konfiguration gewählt? | K1/K3 |
| I-G6 | P1 | Gab es **Überblendungen** (Crossfade) beim Musikwechsel, und mit welcher Dauer? Welche Opcodes steuerten Lautstärke/Fade? | K1 |
| I-G7 | P2 | Wurde die Musik beim Kampfübergang gestoppt und danach wiederhergestellt, oder neu gestartet? | K1 |
| I-G8 | P2 | 98 Titel — vier davon liegen als `.wav` statt im OGG-Satz. Warum die Sonderbehandlung? | K1 |

---

## 10. Block H — Text, Font, Menü, Lokalisierung

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-H1 | **P0** | **Zeichentabelle:** Das lineare ASCII-Fenster (Zeichen = Byte − 0x20) gilt bei uns nur **bis 0x5E**; 0x60–0x7F sind Umlaute (`ä` = 0x6A, `ß` = 0x87). War das je Sprachversion eine andere Tabelle, und **wo** lag sie — Datei oder EXE? | K1 |
| I-H2 | P0 | **`0xF8`/`0xF9` sind PlayStation-Buttons (□/✕)**, keine Steuersequenzen — richtig? Was zeigte die PC-Version an dieser Stelle an? | K1 |
| I-H3 | P0 | **`0xFE`-Mehrbytesequenzen** (Farben, `{PAUSEnnn}`, `{MEMORY}`): Wie viele Folgebytes je Untercode? Wir nehmen pauschal 1 an — das ist eine bekannte 🟡-Stelle. Bitte die vollständige Liste. | K1 |
| I-H4 | P0 | **Fontmetrik:** `WINDOW.BIN` Sektion 3 = 256 Glyphenbreiten, Regel `(b & 0x1F) + b/0x20`. Was kodieren die beiden Anteile — Breite und Vorschub/Kerning? | K1 |
| I-H5 | P0 | **Es gibt keinen automatischen Zeilenumbruch** — der Umbruch steckt als Steuerzeichen im Text. Bestätigt? Was passierte, wenn eine Zeile trotzdem zu lang war? | K1 |
| I-H6 | P1 | Wie viele **Zeichen pro Sekunde** lief der Textaufbau, und in welcher Einheit (Frames pro Zeichen)? Was änderte die Textgeschwindigkeits-Einstellung? | K1 |
| I-H7 | P1 | **Fensterfarben/-gradient** aus dem Savemap-Config-Block: Welche vier Eckfarben, welche Interpolation? Und wie war der Fensterrahmen aufgebaut (9-Slice aus `.TEX`)? | K1 |
| I-H8 | P1 | Fenstergröße/-position: automatisch aus dem Text berechnet oder immer per `WSIZW` gesetzt? Was war das Standardverhalten ohne `WSIZW`? | K1 |
| I-H9 | P1 | **Lokalisierung:** Wenn die EXE identisch ist — wie wurde die deutsche Version gebaut? Nur ausgetauschte Archive? Welche Dateien unterschieden sich? | K1 |
| I-H10 | P1 | **Menü-IDs:** Wir zeigen bei manchen Inventar-IDs „?215/?256/?258" — offenbar Waffen-/Rüstungs-/Materia-Bereiche. Wie war der **globale Item-ID-Raum** segmentiert (Items / Waffen / Rüstungen / Accessoires / Materia)? Welche Grenzen? | K1 |
| I-H11 | P2 | Gab es eine Spezifikation des Menü-Layouts (Pixelkoordinaten), oder war es hartkodiert? | K1 |

---

## 11. Block I — Savegame und Zustandsmodell

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-I1 | P1 | **Savemap:** Wir haben 9-B-Kopf + 15 Slots à 4340 B und die CRC-16/CCITT (XOR-out 0xFFFF, ab +4) belegt. Gab es weitere Prüfungen — Plausibilitätsprüfungen, die einen manipulierten Save ablehnten? | K1 |
| I-I2 | P1 | Wurde beim Speichern der **komplette** Field-Zustand abgelegt, oder nur Position + Variablen und das Field wurde neu initialisiert? | K1 |
| I-I3 | P1 | Welche Variablenbereiche waren **temporär** (bei Field-Wechsel gelöscht) und welche persistent? Wir haben 5 persistente Regionen plus Temp 5/6 abgeleitet. | K1 |
| I-I4 | P2 | `CharacterRecord` 132 B × 9 — stimmt die Größe, und was steht am Ende (Padding vs. Feld)? | K1 |
| I-I5 | P2 | Gab es undokumentierte/ungenutzte Felder in der Savemap? | K1 |

---

## 12. Block J — Archive und Datenpipeline (LGP)

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-J1 | P1 | **Das TOC-„Check-Byte":** Es nimmt im ganzen Bestand nur zwei Werte an — 0x0E (98,3 %) und 0x0B (1,7 %), und 0x0B steht **genau** auf den `.hrc`-Einträgen (766/766). Was war das Byte wirklich? Ein Typ-/Kategorie-Feld des Packers? | K1 |
| I-J2 | P1 | **Schattennamen und Duplikate:** `battle.lgp` enthält 1798 Einträge, die von späteren gleichnamigen verdeckt werden. War das Absicht (Überschreiben durch Anhängen) oder Werkzeug-Artefakt? Welcher Eintrag gewann zur Laufzeit — der erste oder der letzte? | K1 |
| I-J3 | P1 | Der LGP-Lookup lief über eine Hash-/Bucket-Funktion (die wir exakt nachgebaut haben). War die Suche **immer** über den Hash, oder gab es einen linearen Fallback? | K1 |
| I-J4 | P1 | Wie war die **Ladestrategie** — ganze Archive in den Speicher, oder Einzelzugriff von CD? Was war das Speicherbudget? | K3 |
| I-J5 | P2 | Wie lief die Build-Pipeline: Wer packte die Archive, wie oft, und gab es einen Validierungsschritt? | K3 |
| I-J6 | P2 | LZS-Kompression: derselbe Kompressor für Field, Weltkarte und Kernel? Fenstergröße/Parameter? | K1 |

---

## 13. Block K — Timing, Bildraten, Determinismus

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-K1 | **P0** | Bildraten: Field 30, **Kampf 15**, Menü 60, Credits 39 — bestätigt? Warum 15 im Kampf, und was lief dort mit 15 (Logik, Darstellung oder beides)? Und warum 39 in den Credits? | K1 |
| I-K2 | P0 | Lief die **Spiellogik an die Bildrate gekoppelt** (Fixed Tick) oder zeitbasiert? Bei Framedrops: langsamer werden oder Frames überspringen? **Das ist für unsere Determinismus-Zusicherung zentral.** | K1 |
| I-K3 | P1 | Gab es Unterschiede zwischen NTSC und PAL in der Tickrate, und schlug das auf den PC-Port durch? | K1 |
| I-K4 | P1 | Wurden Eingaben **einmal pro Tick** abgetastet, oder ereignisgesteuert? Wie wurden Flanken (Tastendruck vs. Halten) erkannt? | K1 |
| I-K5 | P2 | Gab es eine feste Reihenfolge Eingabe → Script → Bewegung → Kamera → Rendering? Welche? | K1 |

---

## 14. Block L — Minispiele

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-L1 | P1 | Wir finden Minispiel-Streckensegmente **hartkodiert in der EXE**, in keinem Archiv. War das durchgängig so? Für welche Module? | K1 |
| I-L2 | P1 | `chocobo.lgp` enthält als **einziges** von 21 Minispiel-Archiven eine eingebettete PE-Programmdatei. Was war das? | K1 |
| I-L3 | P1 | Wie wurde ein Minispiel aus dem Field **gestartet** — welcher Opcode, welcher Nummernraum? | K1 |
| I-L4 | P2 | Waren die Minispiele eigenständige Module mit eigenem Loop, oder liefen sie im Field-Kontext? | K1 |
| I-L5 | P2 | Wer hat sie gebaut — dasselbe Team? (Erklärt, warum sie technisch so anders aussehen.) | K3 |

---

## 15. Block M — FMV

| ID | Prio | Frage | Kanal |
|---|---|---|---|
| I-M1 | P1 | Welcher **Videocodec** im PC-Release? Und war er zwischen 1998-Retail und den Re-Releases derselbe? | K1 |
| I-M2 | P1 | Zu 95 Filmen gibt es parallele `.cam`-Dateien. Was steht darin — Kamerabahnen zur Überlagerung von 3D über den Film? | K1 |
| I-M3 | P1 | Wie war die **Synchronisation** zwischen laufendem Film und Field-Script (Trigger auf Frames)? | K1 |
| I-M4 | P2 | 102 EXE-Namen gegen 104 Dateien in `data/movies` — welche zwei sind ungenutzt? | K1 |

---

## 16. Block N — Artefakte, Prozess, Geschichte (K3, unbedenklich)

Der Block, aus dem am ehesten etwas kommt, das kein Reverse Engineering
je liefern kann.

| ID | Prio | Frage |
|---|---|---|
| I-N1 | **P0** | **Existieren noch Unterlagen?** Interne Formatspezifikationen, Design-Dokumente, Werkzeugquellen, Notizbücher, E-Mails, Builds auf alten Datenträgern? Auch „nur" ein Blatt Papier mit einem Record-Layout wäre für uns mehr wert als eine Stunde Erinnerung. |
| I-N2 | P0 | **Gab es überhaupt geschriebene Formatspezifikationen**, oder war das Format „was der Exporter schrieb"? (Die Antwort erklärt, warum manche Felder tot sind.) |
| I-N3 | P0 | Welche **internen Werkzeuge** gab es (Field-Editor, Kampfszenen-Editor, Weltkarten-Editor, Script-Compiler)? Wie hießen sie? Existieren sie noch? |
| I-N4 | P0 | War der **Field-Script-Bytecode** handgeschrieben oder Ausgabe eines Compilers aus einer Hochsprache? Wenn Compiler — gibt es die Quelltexte der Scripts noch? |
| I-N5 | P1 | Welche Teile des Formats waren **Altlasten**, die niemand mehr verstand, schon damals? |
| I-N6 | P1 | Was war die **härteste technische Einschränkung** (Speicher, CD-Zugriffszeit, VRAM), und welche Formatentscheidungen sind direkt daraus entstanden? |
| I-N7 | P1 | Welche **Fehler** in der Engine kanntet ihr und habt sie nicht mehr behoben? (Für uns: Wir müssen entscheiden, ob wir Fehler nachbauen — es gibt Spielerwartungen, die auf Fehlern beruhen.) |
| I-N8 | P1 | Gab es Dinge, die **absichtlich** komisch aussehen, die wir für Fehler halten könnten? |
| I-N9 | P1 | Wie war die Arbeitsteilung zwischen PSX-Team und PC-Port-Team? Wer entschied, was portiert wird? |
| I-N10 | P1 | Was wurde beim PC-Port **verändert** (Auflösung, Farbtiefe, Filterung, Bildrate) — und was ist dabei kaputtgegangen? |
| I-N11 | P2 | Wie lange dauerte der PC-Port, mit wie vielen Leuten? |
| I-N12 | P2 | Gibt es geschnittene Inhalte, deren Daten noch in den Archiven liegen? |
| I-N13 | P2 | Was würdest du heute anders machen? |
| I-N14 | P2 | Welche Legende über die FF7-Technik, die im Internet kursiert, ist einfach falsch? |

---

## 17. Block O — Metafragen an den Schluss (immer stellen)

| ID | Frage |
|---|---|
| I-O1 | **Wir haben ~90 % der Formate rein aus den Daten rekonstruiert. Was ist die Sache, bei der wir mit Sicherheit falsch liegen, ohne es zu merken?** |
| I-O2 | Gibt es ein Feld/eine Struktur, die *aussieht* wie Daten, aber in Wahrheit ungenutzt/tot ist? Wir haben mehrfach Bedeutung in Rauschen hineingemessen. |
| I-O3 | Wenn du morgen FF7 nachbauen müsstest, ohne den Originalcode — **in welcher Reihenfolge** würdest du vorgehen? |
| I-O4 | Wärst du bereit, dir unsere Befundliste anzusehen und die Stellen zu markieren, bei denen du weißt, dass sie falsch sind? (Auch ohne Begründung — ein „das stimmt nicht" ist für uns ein vollwertiger Messauftrag.) |
| I-O5 | Dürfen wir dich nochmal fragen, wenn wir konkrete Einzelfragen haben? |
| I-O6 | Kennst du andere Beteiligte, die wir ansprechen dürfen? |
| I-O7 | Was möchtest du, dass Leute über die technische Seite von FF7 wissen — und niemand fragt dich je danach? |

---

## Anhang A — Die 60-Minuten-Fassung

Wenn nur eine Stunde bleibt, diese 20 in dieser Reihenfolge. Ausgewählt nach:
blockiert etwas, ist heute sichtbar falsch, oder ist per Messung prinzipiell
unerreichbar.

1. **I-Ø1/Ø2/Ø6** — Rolle und NDA-Grenze (5 Min, nicht kürzen)
2. **I-N1** — existieren noch Unterlagen/Werkzeuge? *(höchster Erwartungswert überhaupt)*
3. **I-B3** — Instruktionen pro Tick / Scheduler-Modell
4. **I-B1** — Prioritätsverdrängung bei Script-Requests
5. **I-C1** — Woher kam die Ankunftsposition beim Field-Wechsel?
6. **I-C19/C20** — `ANIME`-Operand → Clip, und die Standardanimation
7. **I-C3** — wer schaltet den Zustand animierter Hintergrund-Tiles?
8. **I-C11/C12** — FOV-Basis und Tiefenskalierung
9. **I-D1** — der Skalierungsfaktor 512 vs. 128
10. **I-D3** — warum Field `−len` und Battle `+len`
11. **I-E3** — Weltkarten-Texturzuordnung *(größter sichtbarer Fehler)*
12. **I-E9** — Weltkarten-Kommando-Opcodes 0x300er
13. **I-F1** — Aufbau einer Kampfbühne
14. **I-F4** — Kampfkameras (`camdat`/`co.bin`)
15. **I-F7** — ATB-Rate und 15 fps im Kampf
16. **I-F10** — Schrittzähler und Begegnungsrate
17. **I-K1/K2** — Bildraten und Fixed-Tick-Kopplung
18. **I-H3** — vollständige Liste der `0xFE`-Steuersequenzen
19. **I-O1** — „Wobei liegen wir sicher falsch?"
20. **I-O4/O5** — Bereitschaft zur Durchsicht + Folgetermin

---

## Anhang B — Nach dem Interview

1. **Transkript korrigieren**, solange die Erinnerung frisch ist.
2. Jede Aussage in dieses Dokument als **Antwortzeile** eintragen, mit
   Sicherheitsgrad und Kanal.
3. **Keine Aussage direkt als 🟢 übernehmen.** Für jede K1-Aussage einen
   Prüfplan gegen die Realdaten schreiben — **mit Kontrollhypothese**. Das ist
   dieselbe Regel wie bei Makou Reactor (dort hätte pauschale Übernahme
   99,92 % auf 86,77 % gedrückt).
4. **K2-Aussagen getrennt ablegen**, nicht in `packages/` und nicht in die
   normalen Findings. Vorher entscheiden, ob sie überhaupt verwendet werden.
5. **Provenienz-Tags** setzen: `Interview-<Datum>-<Frage-ID>` an jede Stelle im
   Code/Doku, die auf eine Aussage zurückgeht.
6. **Widersprüche zu bestehenden Messungen sind der wertvollste Ertrag** — jeder
   Widerspruch wird ein eigener Messposten, nicht eine Korrektur per Autorität.
7. **Dankschreiben + Folgetermin** innerhalb einer Woche.

---

*Verweise: [WEBMIDGAR-MASTERPLAN.md](WEBMIDGAR-MASTERPLAN.md) ·
[ROADMAP-OFFENE-POSTEN.md](ROADMAP-OFFENE-POSTEN.md) ·
[QUELLEN-SICHTUNG.md](QUELLEN-SICHTUNG.md) ·
[decompile-findings.md](decompile-findings.md) ·
[DEMO-FINDINGS-1.0.md](DEMO-FINDINGS-1.0.md)*
