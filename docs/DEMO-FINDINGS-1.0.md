# Demo-Findings — 1.0-Integrationstest (2026-08-10)

Testkampagne der integrierten Demo `apps/demo/game.html` gegen die lokale
Installation (Dev-HTTP-Quelle `/ff7data`). Jedes Finding wird hier dokumentiert,
bewertet und mit Fix-Status geführt. Konvention: F-Nummern sind stabil.

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F01 | Build | `vite.config.ts` kannte die Pakete world-runtime/formats-battle/battle-runtime/render-battle nicht (Aliasliste veraltet) | Blocker für die Seite | ✅ behoben (Aliase ergänzt) |
| F02 | Field/Modelle | NPC-Modelle luden nie: `modelIndex` wird erst durch Script-Opcodes während der ersten Ticks gesetzt, der Lader lief aber einmalig beim Betreten. Spielermodell erschien nur über den Manifest-0-Fallback | Kernfehler der Integration | ✅ behoben (Lazy-Load je Tick in `game-demo.ts`) |
| F03 | Field/Hintergrund | `md1stin`: große schwarze Löcher — Ursache war das Tiefenfenster: vorberechnete NDC-Tiefen (z·zScale) fielen mit NEAR=100/FAR=10000 aus [−1,1], 795/795 Layer-0-Tiles wurden weggeclippt (nur 73/1115 Tiles sichtbar). Fix: ordnungserhaltende Klemmung in `render-field/src/background.ts`; 1115/1115 Tiles in allen 6 Kontroll-Fields | Kernfehler — Sichtqualität | ✅ behoben (Sichtnachweis `.shots/bg-fixed.jpg`) |
| F04 | Field/Interaktion | Keine Talk-Interaktion vorhanden. Fix: `requestEntityScript(entity, entry)` im Interpreter (TALK_SCRIPT_SLOT=1, Leerspan-Erkennung über Slot-Wiederholungen 288.665/0-Gegenbeleg), Talk-Auslösung in FieldSession (TALK_RANGE=40 🟡, confirm-Flanke, nächster NPC). Sichtnachweis: OK neben dem Bahnsteig-Wächter liefert dekodierten Text „Received "Potion"!" wie im Original; Folgedialog + Sound 360 laufen | Kernfehler — behoben | ✅ (Slot-1-Konvention bleibt 🟡) |
| F05 | Kampf | Echter Kampfmodus integriert: Zufalls-/Script-Encounter → BattleStarter → BattleSession; ATB, Kommandos (Angriff/Flucht), Gegner-KI, Sieg/EXP/AP/Gil/Fanfare, Rückkehr ins Field mit battle-finished-Event. Sichtnachweis `.shots/battle-fixed.jpg` | Integrationslücke | ✅ integriert (Bühne=Ersatzscheibe, Party=Quader, Kamera=Intro-Kamera — 🔴-Formatlücken) |
| F06 | Weltkarte | ~~Echte World↔Field-Einstiegspunkte sind 🔴 (S29)~~ **Formatlücke geschlossen (2026-08-11): die Einstiegspunkte stehen in `field.tbl` (world_us.lgp) und werden über Opcode `0x318` adressiert.** Accounting byteexakt: 1536 B = 64 × 24, Rest 0; 65 von 128 Einträgen belegt, 63 genullt und aus allen Quoten herausgerechnet. Vier Vorhersagen je mit Kontrolle: **K1** Richtungsbyte 65/65 gegen 0/0/0 bei 1–3 B Versatz · **K2** `fieldId` löst über die maplist (788 Namen) auf einen existierenden flevel-Eintrag auf 65/65 gegen 22/1/0/0 bei −2/−1/+1/+2 B (die Zufallskontrolle 58/65 trägt NICHT — die maplist ist zu dicht belegt, das ist so vermerkt und nicht geschönt) · **K3** `triangle` < Dreiecksanzahl im Ziel-Walkmesh 65/65 gegen 54/65 permutiert (schwach) · **K4, tragend** der Ankunftspunkt (x, y) liegt IM Walkmesh-Dreieck `triangle` des über `fieldId` aufgelösten Feldes: **65/65 gegen 0/65** bei einem anderen Dreieck desselben Feldes und **11/65** bei permutiertem Feld. Zusatzbefund, der die Referenz KORRIGIERT: die Datensatznummer von `0x318` ist **1-basiert** — Vollerhebung über wm0/wm2/wm3.ev, 89 Fundstellen, 1-basiert 89/89 belegte Slots gegen 75/89 bei 0-basiert (Szenario 1 sogar 9/9 gegen 0/9); die Operandenreihenfolge ist gegen die Vertauschungskontrolle mit 0/89 entschieden | Formatlücke geschlossen, Demo verdrahtet | ✅ **behoben.** `parseFieldTbl` in `packages/formats-world`, an `WorldSession` durchgereicht, `world-transition` nach `source` unterschieden, Ankunft {x,y} an `enterField` weitergereicht. Live: `gameDebug.fieldTblEintrag(1,0)` ⇒ fieldId 170 ⇒ `mds5_5`, (711,−2420), Dreieck 16. 🔴 **Rest:** `direction` wird nur geloggt, nicht angewandt — Nullpunkt und Drehsinn im Field-Raum sind ungemessen. ⚠️ Der Zweig `source: 'script'` ist statisch belegt, aber **nie live ausgelöst** worden |
| F07 | Menü | Menü ist lesend (S21-Stand): kein Ausrüsten/Benutzen/Speichern | Bekannte Ausbaustufe | 🟡 offen |
| F08 | Charaktergröße | Sichtvergleich der Feldmodell-Skalierung (scale/512-Hypothese) gegen Referenzbilder steht aus | Kalibrierung | 🔜 geplant |
| F09 | Audio | music/sound-HostRequests werden nur geloggt (music.idx→OGG-Kette wäre seit S37 möglich) | Integrationslücke, nicht 1.0-kritisch | ✅ vollständig verdrahtet (2026-08-11): Kette über resolveFieldMusic, Wiedergabe über MusicRuntime |
| F09-B | Audio/Field | **Der MUSIC-Operand ist kein Titel, sondern ein field-lokaler Index in die AKAO-Offsettabelle von Sektion 1.** Die Demo las ihn direkt als `music.idx`-Zeile. Gemessen über 702 Fields/1243 Vorkommen: „Operand < nAkao des eigenen Fields" 98,95 % (Kontrollen 71,92 % Nachbarfield, 49,88 % Byte-davor); an `akaoOffsets[v]` steht in 1228/1230 = 99,84 % das Magic `AKAO` (Kontrollen Versatz +4 und Zufallsoffset je 0,00 %); `u16@+4` liegt 1230/1230 im Band 1…98 (Kontrolle „u16 zwei Byte weiter" 14,63 %). Gegenhypothese Kujata (`u8@+50`) 31,06 % — fällt durch. Die 2 Magic-Fehlschläge sind exakt die belegten `KAO…`-Blöcke (`junair2`, `junone7`, `sininb1`, `sininb2`), mit Versatzausgleich lösen 1230/1230 auf | Kette `MUSIC v → akaoOffsets[v] → AKAO-Kopf → musicId → music.idx[musicId−1] → OGG` | ✅ Parser + Demo verdrahtet; Endprüfung 1217/1243 = 97,91 % vorhandene OGG gegen 548/1243 = 44,09 % der Altregel |
| F09-E | Audio | `readOggLoopTags`/`planLoop` waren vollständig getestet und wurden **nirgends aufgerufen**: Die Demo setzte `audioEl.loop = true` und wiederholte die ganze Datei — jeder Titel mit Intro spielte sein Intro erneut. Ein `HTMLAudioElement` kann das prinzipiell nicht anders; `loopStart`/`loopEnd` gibt es nur am `AudioBufferSourceNode` | 87 % der Titel tragen `LOOPSTART`, kein einziger `LOOPLENGTH` | ✅ verdrahtet; in der Demo gemessen: plan.reason = tagged-start-to-end, loopStart 0,028 s, loopEnd 144,305 s (dun2) |
| F10 | Weltkarte | Demo-Startposition (Rastermitte) liegt auf Wasser (Klasse 3) — zu Fuß bewegungsunfähig; erst Fahrzeugwechsel (Highwind) macht die Karte befahrbar | Startplatzierung | 🔧 Landstart suchen |
| F11 | Weltkarte | Terrain rendert als Klassenfarben-Diagnose; Weltkarten-Texturen sind nicht erschlossen | Bekannte S28-Lücke | 🟡 offen |
| F12 | Menü | Party-Ansicht zeigt „MP 122/116" (aktuell > Maximum) — Verdacht Feldvertauschung mp/mpMax in Savemap-Lesung oder Anzeige | Datenlesung prüfen | 🔜 messen |
| F13 | Kampf | Aufstellung falsch: `placeFormation`/`placeParty` deuten Slot-Koordinaten über die FIELD-Konvention (ff7ToScene) — Gegner unter dem Boden (y −1700/−2000), Party schwebt (+3200). Gegnermodelle selbst laden korrekt („aq" 3 Teile, „ar" 6 Teile) | 🟡-Deutung widerlegt durch Sichtbefund | 🔧 Subagent misst Konvention |
| F14 | Field/Encounter | Zufallskämpfe feuern in Stadt-Fields (md1stin: Encounter 302/303 alle ~100 bewegte Takte) — im Original hat der Bahnhofsvorplatz keine Zufallskämpfe. Encounter-Aktivierungs-Gating (Sektion-7-Flag bzw. Script) fehlt | Spielbarkeit | 🔜 Gating messen (nach Talk-Agent) |
| F16 | Field/Hintergrund | Verwürfelte Kachelblöcke in md1_1 (Mosaik-Flecken), nmkin_1 (Magenta-Rauschen), md8_1 (halbe Bildfläche) — md1stin sauber. Quellregion/Texturseite/bpp-Deutung einzelner Tiles falsch | Sichtqualität, systematisch | 🔧 Subagent misst Trennvariable |
| F17 | Weltkarte | encounter-check schien nie zu feuern — Ursache: Die Session würfelt bereits (Check alle 32 Schritte, Schwelle 24/256 ⇒ ~1 Treffer je ~350 Takte), und die Demo filterte das Ergebnis ein ZWEITES Mal (roll<16). Doppel-Gating entfernt | Kein Paketfehler | ✅ behoben (Demo) |
| F15 | Field/Gateway | Gateway-Übertritt feuert nicht: die Austrittslinie von md1stin liest sich als (353,3669,29368)→(353,1049,400) — nur die Deutung [1],[2] des ersten Punkts liegt auf dem Walkmesh (placeAt-Probe), die Linie wäre eine Diagonale über die halbe Karte. Achs-/Offsetdeutung des 24-B-Gateway-Records prüfen | Feldwechsel blockiert | 🔜 messen (nach Talk-Agent) |

| F18 | Menü | Inventar-IDs außerhalb der Item-Namensliste zeigen „?215/?256/?258" — vermutlich Waffen-/Rüstungs-/Materia-Bereiche, deren Namen in anderen Kernel-Sektionen liegen | **Nicht kosmetisch — 100 % der Inventarnamen waren falsch** | ✅ behoben, s. F18/F24-A unten |
| F19 | Kampf | Aufstellung nach Fix korrekt (Gegner links am Boden, Party rechts — Battle-Basis x-rechts/y-ab/z-Tiefe, 91,8 % Slots auf Boden 0, Kameras 1000/1000 über dem Boden); offen: z-Spiegelfrage (Sichtvergleich), Gameplay-Kamera (co.bin/camdat 🔴), echte Bühne (Stage-Format 🔴), Party-Battle-Modelle | Sichtqualität | 🟡 teilbehoben |

## Sichtbewertungskampagne 2026-08-10 (110 Aufnahmen, Nutzerurteil)

110 automatisiert erzeugte Aufnahmen der Demo (`apps/demo/.shots/`, Fragebogen
`bewertung.html`, Rohdaten `webmidgar-bewertung.json`) wurden vom Projektinhaber
bewertet: **3× „sieht gut aus", 23× „auffällig", 80× „katastrophal"** (4 offen).
Kein Bereich blieb ohne Befund; die Menü- und Weltkartenkategorien wurden zu
100 % als katastrophal bewertet. Die 103 Einzelbefunde fallen auf sieben
Ursachen zurück — F20–F26. Die Nummern F20–F23 sind im Code belegt, nicht
vermutet.

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F20 | Field/Modelle | **Alle Feldfiguren liegen flach am Boden** („Cloud liegt auf dem Boden, Kopf nach rechts"; bei anderen Blickrichtungen dreht sich der liegende Körper mit). Ursache belegt: `buildActor` legt die zentrale FF7→Scene-Basis als `root.quaternion` an (actor.ts, ADR-009: „trägt als EINZIGE Stelle die Basis"), `game-demo.ts:792` und `:826` schreiben danach `root.rotation.y` — die Euler-Zuweisung **ersetzt das Quaternion vollständig** und löscht damit die Z-hoch→Y-hoch-Basis. Übrig bleibt der rohe FF7-Modellraum: die Figur liegt, und `facing` rotiert sie in der Bodenebene | Kernfehler — betrifft jede Field-Aufnahme | ✅ behoben: `setActorFacing` (render-actor) multipliziert den Gierwinkel um die FF7-Hochachse **auf** die Basis; die Demo setzt `root.rotation` nicht mehr. Zwei Abnahmetests (Hochachse bleibt (0,1,0) über alle Winkel; Gierabbildung deckungsgleich zur alten Absicht) |
| F21 | Field/Modelle | **„Lila Sprites" statt Figuren** — und die Magenta-Hypothese war FALSCH. Gemessen (Diagnosehaken `onMissing` in der Modellkette, acht Fields): 0 fehlende `.hrc/.rsd/.p/.tex`, 0 Texturslot-Überläufe, 0 Ersatzkapseln, 0 Materialien mit `0xff00ff`. Die „lila Sprites" sind **texturierte NPCs, die flach am Boden liegen** — ihre Kleidung ist rot/violett. Ursache: Der Demo wies eine Animation nur zu, wenn ein Script eine setzte; sonst lief die Figur in der **Bindpose**, und die ist keine Standhaltung, sondern die unposierte Bone-Kette (`boneRotSumme = 0` gemessen). Auch der Spieler lief ohne jede Animation | Kernfehler — Sichtqualität | ✅ behoben: NPCs und Spieler bekommen die Ruheanimation (Index 0, 🟡 Konventionshypothese); Sichtnachweis `.shots/nach_f21c_lauf.jpg` |
| F22 | Field/Hintergrund | **„Verschwommene Blöcke" überall dort, wo animierte Tiles gehören** (Flammen in md8_1, Flipper in mds7pb_1, Gondelbahn in bigwheel, 20 weitere Fields). Ursache belegt: `buildBackgroundMesh` kennt weder Animationsparameter noch Zustandsbits — es zeichnet **alle Zustände einer Animationsgruppe gleichzeitig übereinander**. Das Ergebnis ist genau die beschriebene Unschärfe, und bewegte Elemente fehlen als Bewegung komplett | Kernfehler — systematisch, größter Einzelposten | ✅ behoben: `param` (u8@28) und `state` (u8@29) im Parser belegt und ausgewertet; je Parameter ist genau ein Zustand sichtbar. 🟡 Welcher, schaltet die Demo reihum weiter — im Original entscheiden das die Parameter-Opcodes des Field-Scripts (offen) |
| F23 | Field/Hintergrund | **Schwarze Flächen statt Rauch, Wasser, Feuer** (ujunon1 Schornstein, uutai1 Fluss, nrthmk, gonjun1, cosin1). Ursache belegt: der Tile-Shader in `background.ts` kennt nur „undurchsichtig oder verworfen" (`discard` bei a<0.5, `outColor.a = 1.0`, `depthWrite` immer an). Die FF7-Mischmodi (Mittelwert / additiv / subtraktiv / 25 % additiv) fehlen vollständig — additiv gemischte Effekttiles werden dadurch als deckende dunkle Blöcke gezeichnet | Kernfehler — Sichtqualität | ✅ behoben: `blending` (u8@30) und `typeTrans` (u8@32) im Parser belegt; getrennte Zeichenstapel je Mischart mit additivem bzw. gemitteltem Blending und `depthWrite: false`, deckend zuerst. Sichtnachweis: Schornsteinrauch in `ujunon1` und der Fluss in `uutai1` erscheinen statt schwarzer Blöcke |
| F24 | Menü | Menü-UI **durchgängig als katastrophal bewertet** (10/10): Rahmen, Schrift, Anordnung entsprechen nicht dem Original — die Demo zeigt eine Diagnosetabelle, kein FF7-Menü. Zusätzlich inhaltlich: Materia werden unter „Gegenstände" gelistet, Itemnamen teils falsch (`?307`, `?260`, s. F18) | Ausbaustufe + Datenlesung | 🟡 UI weiter offen (Nachfolger von F07); **Datenlesung behoben, s. F18/F24-A** |
| F25 | Weltkarte | Weltkarte **durchgängig katastrophal** (13/13): „KOMPLETT FALSCHE FARBEN — 3D-Modell an sich plausibel". Das Terrain rendert weiterhin die Klassenfarben-Diagnose (F11). Ausdrücklicher Referenzwunsch des Projektinhabers: **an FF7-Landscaper orientieren**. Nebenbefund: bei „3× Tab" ist kein Fahrzeugmodell erkennbar | Bekannte Lücke, jetzt priorisiert | 🟡 offen (verschärft F11) |
| F26 | Kampf | 19/27 katastrophal. Bestätigt und zusammengefasst: **keine Kampfbühne** (schwarzer Hintergrund), **Party wird nicht gerendert** (nur Quader bzw. gar nichts), **Gegnermodelle erscheinen verzögert** (die ersten Takte zeigen Farbflächen) **und sind viel zu klein**, Blickrichtung der Gegner vermutlich gespiegelt, **HUD nicht im Originalstil** (Diagnosekasten statt FF7-Kampfmenü) | Sammelbefund über F05/F19 hinaus | 🟡 offen |

| F27 | Field/Modelle | **Die Gehanimation legt die Figur flach.** Beim Umschalten des Spielers auf Animationsindex 1 (aaaa.hrc, 8316 B ≈ Bewegungszyklus) kippt Cloud um; mit Index 0 steht er. Die Frames der `.a` tragen eine Wurzelrotation, die sich mit der Wurzelrahmen-Korrektur (`ROOT_FRAME_FIX_DEG`) und der von uns gesetzten Blickrichtung beißt. Der Umschalter ist deshalb bewusst nicht aktiv — die Figuren stehen beim Gehen | Sichtqualität — blockiert die Laufanimation | 🔜 Wurzelrotations-Semantik der `.a`-Frames gegen die selbst gesetzte Blickrichtung messen |

Zuordnung ohne neue Nummer: „MP 122/116" → F12 · `?215/?257/?307` → F18 ·
Weltkartentexturen → F11 · Kampfbühne/Party-Modelle → F05/F19 ·
fehlendes Menü-Handeln → F07.

## Sichtbewertung Runde 2 (117 Aufnahmen, nach F20–F23)

Zweite Kampagne mit **anderen** Szenen: 34 neue Fields (gleichmäßig über die 640
nicht in Runde 1 verwendeten gestreut), zwei neue Kategorien **Story-Dialoge**
(18) und **Hintergrund-Animation** (12), dazu Bewegung (12), Kampf (25),
Weltkarte (10), Menü (6). Bewertet: 98 von 117 — **13× gut, 27× auffällig,
58× katastrophal**.

Die Fixes wirken messbar: „gut" stieg von 3/106 auf 13/98, und der Fluss in
Wutai (F23) wurde dreimal mit „gut" bewertet. Zwei Kategorien bleiben ohne
jedes „gut": Bewegung/Haltung (12/12 katastrophal, ausschließlich wegen der
Figurengröße) und Menü (6/6).

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F28 | Field/Kamera | **„Chars viel zu klein" ist ein KAMERA-, kein Modellproblem.** Gemessen (`kameraSonde`, 12 Fields): Die Modellhöhe ist bestandsweit konstant **35,4 Welteinheiten**, und der Skalenfaktor ist überall **512/512 = 1** (`scaleGlobal` und Modellskala sind in allen geprüften Fields 512). Die Bildgröße der Figur schwankt trotzdem um Faktor 5: `md1stin` 54 px, `jail4` 44 px, `mds5_i` 50 px, `tin_1` 49 px — alle unbeanstandet; dagegen `nvmin1_1` 29 px, `startmap` 23 px, `rkt_i` 22 px, `sinin1_1` 18 px, `farm` 17 px — alle beanstandet. Die Trennlinie liegt sauber bei ~40 px. Ursache der Streuung ist die **Kameradistanz** (505 bei `md1stin` gegen 2080 bei `farm`, Faktor 4) bei unskaliertem Modell | Kernfehler — häufigster Einzelbefund beider Runden | 🔜 Verdächtig ist die Behandlung der Kameratranslation: FF7 legt sie im Kamerarahmen ab, die Weltposition ist `−Rᵀ·T`. Gegenprobe: Bringt die korrigierte Translation `farm` von 17 px auf ~45 px? |
| F29 | Dialoge | **Steuercodes werden als Buchstaben ausgegeben.** Ursache belegt im Code, nicht vermutet: `decodeFieldDialogs` (field-runtime/src/dialog.ts) nutzt `buildAsciiTable(DEFAULT_ASCII_OFFSET)` — eine **rein lineare ASCII-Tabelle ohne jede Steuercode-Behandlung**. Bytes oberhalb des ASCII-Fensters landen dadurch als Latin-1-Glyphen (`Ò`, `Ó`) oder als Ersatzzeichen (`◇`/`�`) im Text. Sichtbar in jedem der 18 Story-Dialoge; in `del1` werden dadurch drei getrennte Sprechblasen in ein Fenster gequetscht | Kernfehler — betrifft jeden Text im Spiel | 🔜 Steuercode-Tabelle einführen: Farbcodes, `{PAUSE}`, `{CHOICE}`, `{OK}`, **Zeilenumbruch** und **Seitenwechsel** sowie die Charakternamen-Platzhalter. Referenztabelle: `ff7-asset-loader/char-map.js` in Kujata |
| F30 | Field/Hintergrund | **Schwarze Blockränder um animierte Kacheln** („block pixel für animationen sichtbar", 9× in Runde 2). Unser Tile-Shader kennt nur `discard` bei `alpha < 0.5`; Kujata dagegen führt je Palettenfarbe ein `noRender`-Merkmal und setzt es für **schwarze Pixel**, sowohl im Palettenpfad als auch bei Direktfarbe (`if (!usePalette && paletteItem.isBlack)`). Ohne diese Regel bleibt das Schwarz der Effektkacheln deckend und rahmt jede animierte Kachel sichtbar ein | Kernfehler — Sichtqualität | 🔜 Schwarzregel je Palettenfarbe umsetzen; Wechselwirkung mit F23 beachten (bei additiver Mischung ist Schwarz ohnehin neutral, bei deckenden Kacheln nicht) |
| F31 | Field/Hintergrund | **Verwürfelte Kachelblöcke (F16) haben eine benannte Ursache.** Kujata wählt die Quellkoordinaten nach der Regel `if (tile.layerID > 0 && tile.textureId2 > 0 && tile.depth !== 0)` → dann `srcX2`/`srcY2` **mit `textureId2`**, sonst `srcX`/`srcY` mit `textureId`. Unser Parser kennt `srcX2`/`srcY2`, aber **kein `textureId2`** — die zweite Quellkoordinate wird also gegen die falsche Texturseite gelesen. Ebenso relevant: `usePalette` gilt bei Kujata nur für `depth === 1` | Kernfehler — erklärt F16 | 🔜 `textureId2` (u8@36, in `md8_1` mit den Werten 0/15/16 belegt) parsen und die Auswahlregel übernehmen |
| F32 | Field/Hintergrund | **Rückschritt durch F23:** In `sbwy4_6` liegt der Wasserhintergrund über den eigentlichen Texturen. Mein Zeichenpass sortiert nur nach „deckend vor gemischt" und ignoriert Layer und Tiefenschlüssel — eine gemischte Kachel aus Layer 1 landet dadurch über allem, was danach käme. Kujata teilt die Stapel nach **Layer-ID, Z-Index, param, state UND transType** auf; meine Aufteilung ließ Layer und Z weg | Von mir eingeschleppt | 🔧 Aufteilung um Layer-ID und Z-Index ergänzen, Reihenfolge Layer→Z→Mischart |
| F33 | Kampf | **Party sind blaue Quader** (in Runde 2 zehnmal wörtlich benannt), Gegner zusätzlich „viel zu klein" — dieselbe Größenfrage wie F28, nur im Kampfraum. Ohne Party-Battle-Modelle und ohne Bühne ist die Kategorie nicht sinnvoll bewertbar; 15 von 25 Bildern katastrophal, kein einziges „gut" | Bekannte Lücke, jetzt quantifiziert | 🟡 **teilweise behoben (2026-08-11), s. K1/K2 unten.** Der Lader ist repariert — er rät keine Dateinamen mehr, sondern klassifiziert jeden Eintrag des Präfix-Namensraums über seine **Inhalts-Signatur**: **8979/8979** `.p`-Teile (Kontrolle alter Lader: **2321** = 25,8 %) und **787/787** TEX-Dateien (Kontrolle: **411**; davon Modellpräfixe **201** statt 35) über 11 119 Einträge / 481 Präfixe; kein Präfix ohne Skelett, keines mit 0 Teilen trotz Geometrie (vorher 36). Cloud (`rt`) liefert jetzt **33 Teile / 2 Texturen / 23 Bones** statt 3/0. 🔴 **Die Party bleibt trotzdem aus Quadern**: welcher Party-Platz welches Battle-Präfix trägt, ist im gesamten Baum **nirgends gemessen** — „rt = Cloud" ist eine Behauptung, für die übrigen Plätze existiert nicht einmal eine. Eine geratene Tabelle wäre ein Regel-3-Verstoß; was fehlt, ist eine Messung, nicht Code |
| F34 | Weltkarte | Unverändert „Farbe falsch, 3D-Modelle gut". Referenzwunsch bleibt **ff7-landscaper**; aus dem README ließen sich keine Formatdetails ziehen, die Texturzuordnung steckt im Quellcode (`src/`, `src-tauri/`) und in `docs/map-state.md` | Bekannte Lücke | 🟡 offen (F11/F25) |
| F35 | Field/Modelle | **Fehlende 3D-Objekte:** In `junonr2` fehlt die Gondel, in `bigwheel` fehlen Tür und Gondel in allen drei Animationsphasen. Das sind Script-gesteuerte Feldobjekte, keine Hintergrundkacheln — sie hängen an Opcodes, die die Demo noch nicht ausführt | Spielbarkeit/Sichtqualität | 🔜 messen, welche Opcodes diese Objekte sichtbar schalten |
| F35-1 | Field/Hintergrund | **Teilbefund, vermessen (2026-08-11).** Die „Gondel" von `junonr2` ist **kein** 3D-Modell: Die Entitäten `door` (Index 0) und `lift` (Index 3) tragen `modelIndex = null` — es sind Hintergrundgruppen (Layer 1 param 16, Layer 2 param 17/18). Zwei Ursachen wurden geprüft: (a) **Bankbyte-Aufteilung ausgeschlossen** — alle **46** BG-Instruktionen von `junonr2` tragen Bankbyte 0, bei Literaloperanden ist `banks>>4`/`banks&0xf` wirkungslos. (b) **Anfangszustand eingeführt** (🔵): `berechneAnfangsBgStates` belegt je Parameter das niedrigste vorkommende Zustandsbit vor. Gemessen über 702 Fields: von 1256 animierten Kachelgruppen sind nach 300 Ticks **542 leer ohne** und **329 leer mit** Vorbelegung — **213 Gruppen mit 9682 Kacheln** werden wieder sichtbar. 🔴 **`junonr2` ist NICHT darunter**: Vorbelegung `{16:1, 17:1, 18:1}`, nach 300 Ticks ohne wie mit `{16:0, 17:0, 18:1}` — das Skript räumt die Parameter selbst wieder ab | Interpreter-seitig erledigt, Restursache liegt woanders | 🔜 **Zeichenseite/Kontrollfluss:** entweder erreicht der Wirt die Animationsunterroutine schon beim Field-Start (im Original läuft sie erst beim Benutzen des Lifts), oder die Zeichenregel muss bei leerer Maske auf den Anfangszustand zurückfallen statt alles auszublenden |

### Quellenlage der Fremdrecherche

- **Kujata** (`picklejar76/kujata`): ergiebigste Quelle. `ff7-asset-loader/char-map.js` liefert die Steuercode-Tabelle für F29; `background-layer-renderer.js` liefert die Kachelregeln für F30/F31/F32 — und **bestätigt unseren F22/F23-Ansatz**: dort wird „a layer … split out for every unique combination of: Layer ID, Z index, Param, State, transType". `typeTrans === 3` skaliert die Farbe dort auf 25 %.
- **ff7-landscaper** (`maciej-trebacz/ff7-landscaper`): README ohne Formatangaben; die Weltkarten-Texturzuordnung muss aus dem Quellcode gelesen werden. Für F34 noch auszuwerten.
- **FFNx** (`julianxhokaxhiu/FFNx`): noch nicht ausgewertet.
- **Die drei Tutorial-PDFs** (`ff7modhd.yolasite.com`) sind **nicht abrufbar**: der Server liefert statt der Dateien eine Bot-Schutz-Seite („Just a moment…", HTTP 403 über den normalen Abruf). Eine Umgehung des Schutzes kommt nicht in Frage. Wenn die Dateien lokal abgelegt werden, lese ich sie aus — inhaltlich erwarte ich dort vor allem Material zu F28 (Modellmaßstab) und F33 (Kampfmodelle).

## Runde 3: Abgleich gegen Original-Screenshots (2026-08-10 Abend)

Referenz: 18 Screenshots eines Original-Durchlaufs (Steam, dieselben
Spieldateien) in `apps/demo/.shots/ref/`, pixelvermessen (Katalog per
Subagent). Der Überlagerungsvergleich `md1stin` gegen
`20260810223237_1.jpg` zeigt: **Hintergrund nahezu deckungsgleich** (mittlere
Abweichung 18,9/255, Ausreißer fast nur an den Figuren).

| # | Bereich | Beobachtung | Bewertung | Status |
|---|---|---|---|---|
| F37 | Field/Modelle | **Figurenmaßstab war um Faktor 4 zu klein** — die Kamera-Hypothese aus F28 ist damit WIDERLEGT: Kamerarekonstruktion und Positionen stimmen (Überlagerung: Füße der Wächter deckungsgleich), nur die Größe nicht. Faktorsweep 1–6 gegen die Referenz: **4** trifft Kopf und Füße deckungsgleich (3,5/4,5 sichtbar daneben). Bezugswert der Modellskala also 512/4 = **128**, neue Vorgabe `model-over-128` | Kernfehler — häufigster Befund beider Runden, jetzt behoben | ✅ sichtkalibriert (`SCALE_REFERENCE_KALIBRIERT`, 2 Abnahmetests); 🟡 pixelgenau belegt nur an `md1stin`, Gegenprobe in 4 Fields stimmig |
| F36 | Field/Modelle | **Regression aus der Skalen-Kalibrierung sichtbar gemacht:** „bei Faktor 4 liegen alle wieder am Boden" (Nutzerbefund). Gemessen: NICHT der Faktor — die Figuren standen in der **Bindpose**, weil `setAnimation` asynchron bindet und `advanceTick` bis dahin die Bindpose anwendet. Bei jedem Fieldwechsel lagen die Figuren für die ersten Takte flach | Von Anfang an vorhanden, durch die großen Figuren erst auffällig | ✅ behoben: Figuren bleiben unsichtbar, bis ihre Animation gebunden ist (`whenAnimationSettled`) |
| F38 | Field/Modelle | **Blickrichtung um 90° verdreht** (Nutzerbefund Runde 3: „runter"→rechts, „hoch"→links, „links"→Kamera, „rechts"→hoch). Sweep +90/−90 gegen die Referenz (Cloud frontal in `223303`): **−90°** stellt hoch=Rücken, links=Linksprofil, rechts=Rechtsprofil her | Kernfehler | ✅ behoben (`MODEL_FRONT_OFFSET_DEG = -90`, 🟡 Vorzeichen-Herleitung offen, sichtkalibriert); Abnahmetest angepasst |
| F39 | Dialoge | **F29 abgeschlossen — Zeichentabelle jetzt zweifach belegt:** (a) Rohbytes per `gameDebug.dialogRoh` (del1: `eb e7 b2` = {Barret}+Umbruch+`“`, `b3 e8 b2` = `”`+Seite+`“`, `e7 e1` = Umbruch+Einzug, `a9` = `…`); (b) ff7tk `FF7Text.h` (vollständige Westtabelle). Wichtige Korrekturen: das lineare ASCII-Fenster gilt **nur bis 0x5E** (0x60–0x7F sind Umlaute — `ä`=0x6A, `ß`=0x87; die alte Fenstergrenze 0xBF hätte deutsche Texte zerstört), und **0xF8/0xF9 sind PS-Buttons (□/✕), keine Steuersequenzen** — die alte Skip-Deutung hätte echte Zeichen verschluckt. 0xFE-Mehrbytesequenzen (Farben, {PAUSEnnn}, {MEMORY}) vorerst pauschal 1 Folgebyte 🟡 | Kernfehler — behoben | ✅ `buildFieldTextTable` in formats-kernel; Sichtnachweis: Barret-Dialog in del1 dekodiert zeichengleich zum Original inkl. Namenszeile und Einzügen |
| F40 | Dialoge/UI | Dialogfenster-Optik nach Pixelvermessung der Referenz umgesetzt: Bordüre 2px `#7A7C7D` / 2px `#C6C4C5` / 1px `#313035`, Eckenradius 4px, Füllung Diagonalverlauf `#0001B7`→`#000022`, Text weiß mit 1px-Schatten (+1/+1), **Zeilenhöhe 32px**. Weitere vermessene Konstanten im Referenzkatalog: Kampf-HUD-Fenster `(1,333)–(270,442)` und `(275,333)–(637,442)`, ATB grün `rgb(145,210,170)` → voll sandgelb `rgb(227,181,129)`, Kommandofenster `(145,341)–(261,450)`, Renderfläche Field/Battle **640×448** mit 32px-Balken unten, Menüs 640×480 | Angleichung | ✅ Dialogfenster; 🔜 Kampf-HUD und Ergebnisbildschirme nach denselben Konstanten |
| F12 | Menü | **GELÖST** (ff7tk `Type_FF7CHAR.h`): Der Charakterrecord trägt ZWEI Wertepaare — Basiswerte @46/@50 (ohne Ausrüstung) und echte Maxima @56/@58 (mit Ausrüstungs-/Materiaboni), getrennt durch 4 Füllbytes. Unsere Lesung nahm die Basiswerte als Maxima → „MP 122/116" | Datenlesung | ✅ behoben (savemap.ts + Fixture-Komponist schreibt beide Paare) |
| F18 | Menü | **ERKLÄRT** (ff7tk `FF7Item.h`): Item-IDs sind bereichskodiert — 0–104 Gegenstände, **128–255 Waffen** (Yuffie ab 0xD7=215!), **256–287 Rüstungen**, **288–319 Accessoires**; u16 = ID in Bits 0–8, Menge in Bits 9–15. `?215`/`?257`/`?307` sind Conformer-Bereich, Rüstung, Accessoire — deren Namen liegen in anderen kernel.bin-Sektionen | Kosmetisch → verstanden | ✅ umgesetzt, s. F18/F24-A |
| F41 | Field/Modelle | **Cloud fehlt ein Auge** (Nutzerbefund Runde 3). Vermutlich Aufkleber-/Alphaproblem der Gesichtstextur (`alphaTest`/Decal-Versatz oder gespiegelte UV des zweiten Auges) | Sichtqualität | 🔜 messen (Texel des Augen-Aufklebers gegen texToRgba prüfen) |
| F42 | Field/Modelle | **„Sattere" Modelle im Original** (Nutzerbefund Runde 3, Punkt 1). Verdacht: (a) texturierte Flächen ignorieren bei uns die Vertexfarben (`MeshBasicMaterial` ohne `vertexColors` — das Original moduliert Textur × Vertexfarbe), (b) Sektion 3 trägt womöglich Lichtfarben je Modell, die wir nicht anwenden | Sichtqualität | 🔜 Makou-Reactor-Recherche (läuft) klärt (b); (a) ist ein Einzeiler-Experiment mit Sichtvergleich |
| F43 | Interpreter | **Story-Fortschritt** (Nutzerbefund Runde 3, Punkt 2): Die Hauptfortschrittsvariable liegt in der Savemap bei Slot-Offset **0x0BA4** (u16 `mprogress`, ff7tk `FF7Save_Types.h`). Wie weit unsere Interpreter-Bänke sie den Field-Scripts bereitstellen (Entity-Sichtbarkeit, alternative Entries), ist ungemessen | Spielbarkeit | 🔜 messen; Makou-Reactor-Recherche (läuft) liefert die Opcode-Seite |

Offen aus Runde 2 bleiben: **F30** (Transparenzregel — Blockränder,
Nutzerpunkt 3), **F31** (`textureId2` — verwürfelte Kacheln), **F32**
(Layer/Z-Sortierung der Mischstapel), **F27** (Wurzelrotation der
Gehanimation — Nutzerpunkt 5), F24/F25/F26 (Menü/Weltkarte/Kampf als
Ausbaustufen).

## Makou-Reactor-Recherche: belegte Formatfakten (2026-08-10, master@931dd37)

Subagent-Auswertung des Quellcodes von `myst6re/makoureactor` (+ ff7tk als
dessen Text-Backend). Die für unsere offenen Findings entscheidenden Fakten,
jeweils mit Quelldatei:

- **Tile-Record-Verschiebung +4 bestätigt unsere Deutung:** Makous `TilePC`
  (BackgroundTilesIO.h) beginnt 4 Bytes später als unser Record-Nullpunkt —
  alle Felder decken sich dann exakt (paletteID→@24, Z→@26, param→@28,
  state→@29, blending→@30, typeTrans→@32, textureID→@34, depth→@38 in
  UNSERER Zählung). **`textureID2` liegt damit bei uns @36** — F31-Vermutung
  belegt. Auswahlregel (`tilePC2Tile`): bei `blending > 0` UND `layerID > 0`
  gelten `srcX2/srcY2/textureID2`, sonst die ersten Felder. Layer 0 immer die
  ersten.
- **Mischformeln** (`BackgroundFile::blendColor`): typeTrans 0 = (dst+src)/2,
  1 = dst+src (Clamp 255), 2 = dst−src (Clamp 0), 3 = dst + src/4. Unsere
  F23-Umsetzung stimmt für 0/1; **3 braucht Faktor 0,25** (bisher wie 1
  behandelt), **2 fehlt** (bisher wie 0). → F23-Nachbesserung.
- **Sichtbarkeitsregel** (`BackgroundTiles::filter`): Layer 0 immer; sonst
  sichtbar wenn `state == 0` ODER `aktiveStates(param) & state` — state ist
  eine **Bitmaske**, und die Bits schalten die Script-Opcodes **BGON (0xE0,
  setzt Bit 1<<bgStateID) / BGOFF (0xE1, löscht) / BGROL/BGROL2 (weiter/
  zurück) / BGCLR (alles aus)**. Das ist der echte F22-Mechanismus — unser
  Reihum-Takt ist Demo-Ersatz, die Opcodes gehören in den Interpreter.
- **Transparenz** (Palette.cpp/PaletteIOPC): Ein Pixel ist transparent, wenn
  der Palettenwert **roh 0x0000** ist (Schwarz ohne STP-Bit); auf PC
  zusätzlich **Palettenindex 0, wenn das Per-Palette-Flag gesetzt ist**
  (max. 20 Flag-Bytes ab Offset 12 der Background-Sektion). NICHT „alle
  schwarzen Pixel" (Kujas Regel war gröber). 5→8-Bit-Expansion: `(c<<3)|(c>>2)`.
  STP-Bit (Bit 15) wird gespeichert, von Makou aber nicht gerendert. → F30-Fixpfad.
- **Stand/Gehen/Rennen = Animations-Slots 0/1/2** — im Code verankert
  (FieldModelLoaderPS.cpp setzt für Hauptcharaktere genau diese drei auf die
  ersten Slots; Cloud AAAA.HRC → ACFE/AAFF/AAGA „Standing, walking, running").
  Unsere ANIM_STEHEN=0/ANIM_GEHEN=1-Hypothese ist damit belegt; Opcode **CCANM
  (0xDC)** ersetzt gezielt eine der drei (`standWalkRun` 0/1/2). Animations-
  Opcodes: DFANM 0xA2 (Loop), ANIME1 0xA3, ANIMW 0xAC, CANIM1/2 (Teilbereich
  firstFrame/lastFrame), ASPED 0xBD. → Nutzerpunkt 5 beantwortet; bleibt F27.
- **Blickrichtung**: 0–255 = volle Umdrehung, gerendert als −360°·dir/256 um
  die Hochachse (WalkmeshWidget.cpp). Nullpunkt-Semantik definiert Makou
  nicht — unser sichtkalibrierter −90°-Versatz (F38) bleibt die Referenz.
- **$GameMoment = Bank 2, Adresse 0** (vars.cfg) — die 16-Bit-Sicht auf
  denselben Speicher wie Bank 1; Scripts prüfen sie mit gewöhnlichen
  IF-Opcodes, es gibt KEINE Engine-Sonderlogik. Savemap-Feld `mprogress`
  @0x0BA4 (F43). Entity-Sichtbarkeit läuft über VISI (0xA4) in den Scripts.
- **Sektion-3-Licht** (FieldModelLoaderPC.cpp): pro Modell 3 gerichtete
  Lichter à RGB + s16-Richtungsvektor, plus 3 Bytes Globalfarbe (Defaults
  128/204/77 grau + Global 64). Makou rendert sie selbst nicht; die
  Lambert-Anwendung aufs Vertexlicht ist die plausible Erklärung für den
  „satteren" Original-Look (F42-Fixpfad).
- **Kamera bestätigt**: Position im Kameraraum, Welt-Auge = −Rᵀ·T; Achsen
  /4096; `fovy = 2·atan(240/(2·zoom))` — deckt sich mit unserer
  Rekonstruktion (und erklärt, warum die Hintergrund-Überlagerung passt).
- **0xFE-Subcodes** (ff7tk toPC): ≥0xD2; 0xDD trägt 1 Folgebyte (Pausendauer),
  0xE2 {MEMORY} trägt 4. Unsere Pauschale „1 Folgebyte" ist für 0xDD korrekt,
  für {MEMORY} zu kurz 🟡.

## Fix-Runde nach der Makou/ff7tk-Recherche (2026-08-10, Commit-Folge auf 9bfa849)

Alle offenen Sichtfindings mit bekanntem Fixpfad umgesetzt; 615 Tests grün.

| # | Fix | Status |
|---|---|---|
| F30 | Transparenzregel: Palettenrohwert 0x0000 ist immer transparent (decodeBgr555 kodiert genau das als Alpha 0; Schwarz MIT STP-Bit bleibt deckend). Schwarze Blockränder um Effektkacheln beseitigt | ✅ Sichtnachweis `md8_1`: echte Flammen statt Blöcke |
| F31 | `textureId2` (u8@36) geparst; Auswahlregel `blending>0 && Layer>0 → srcX2/srcY2/textureId2` in Atlas, Schlüssel und Kompositor. Makous Struct bestätigt ALLE unsere Record-Offsets (um +4 verschobener Nullpunkt) | ✅ verwürfelte Kachelblöcke (F16) beseitigt; Abnahmetest ersetzt die alte „src2 sobald gesetzt"-Heuristik |
| F32 | Mischstapel nach Layer und Z sortiert (Schlüssel um Layer erweitert, Reihenfolge deckend → Layer aufsteigend → z absteigend) | ✅ `sbwy4_6`-Wasser liegt nicht mehr über den Texturen |
| F23′ | Mischformeln vervollständigt: typeTrans 2 = subtraktiv (Umkehr-Differenz), 3 = 25 % additiv (Alpha 0,25) — vorher wie 0 bzw. 1 behandelt | ✅ |
| F42 | Sektion-3-Licht angewandt: `decodeModelLightBlock` („Farbe zuerst" — deckt sich mit Makous Layout) → Lambert-Bake in die Vertexfarben beim Actor-Bau; texturierte Flächen modulieren jetzt Textur × Vertexfarbe | ✅ Sichtvergleich Wächter: Farbsättigung wie im Original; 🟡 Lambert-Anwendung bleibt Hypothese |
| F41 | Clouds fehlendes Auge: Decal-Texturen brauchen **RepeatWrapping** — das gespiegelte zweite Auge nutzt UVs außerhalb [0,1], Clamp-to-Edge (three-Vorgabe) verschmierte es zur leeren Fläche | ✅ Sichtnachweis: beide Augen, Brauen, Mund (`f41_gesicht3.jpg`) |
| F27 | Gehen/Rennen aktiviert (Slots 1/2 nach tatsächlicher Ortsveränderung; Schwelle 9 Einheiten/Takt für Rennen). Das frühere Kippen war eine Folge von F20 — `spielerProbe` misst identische Wurzellage für alle drei Slots. Clip-Wechsel behalten den alten Clip bis zur Bindung (kein Bindpose-Flackern) | ✅ |
| F22′ | **BGON (0xE0) / BGOFF (0xE1) / BGCLR (0xE4) im Interpreter**: `bgStates` (param → Bitmaske) im Runtime-Zustand; Demo nutzt Script-Bits, Reihum nur noch als Fallback für unberührte Parameter. Gemessen: `uutai1` {1:9, 2:63, 4:2}, `mds7pb_1` {5:1, 6:1}, `junonr2` {18:128} — die Scripts schalten real | ✅ Replay-Digests fortgeschrieben (bewusster engineCompat-Schritt, dokumentiert in replay-vektoren.ts); BGROL/BGROL2 bleiben übersprungen 🟡 |

## Schrittzähler-Modell für Zufallskämpfe (2026-08-11)

Quelle: Speedrun-Dokumentation „Step Count" (FF7 Comprehensive Speedrun
Tutorial pt 3). Sie beschreibt die Zählerhierarchie, auf der Step-Routing
beruht — und damit genau das, was unser bisheriges Ersatzmodell („alle 24
bewegten Takte würfeln") nicht abbilden konnte.

| # | Bereich | Beobachtung | Status |
|---|---|---|---|
| F14 | Field/Encounter | **Zufallskämpfe viel zu dicht** (Runde 1: „Encounter 302/303 alle ~100 bewegte Takte" im Bahnhofsvorplatz). Ursache war das grobe Ersatzmodell ohne Schrittzählung und ohne Gehen | ✅ behoben — gemessen in `md1stin`: **384 Takte** bis zum Kampf beim Rennen (12,8 s bei 30 Hz) statt ~100 |
| F44 | Field/Encounter | Zählerhierarchie nachgebaut: `fractions` (Überlauf 256, +32 je bewegtem Bild), `stepId` (+2 je Überlauf, also alle 8 Bilder), `danger` (+64 rennend / **+16 gehend**), `offset` (+13 je `stepId`-Überlauf), `formationId` (+2 bzw. +3 je Kampf). Alle fünf liegen im Snapshot — sonst verlöre eine gesicherte Sitzung ihre Schrittroute | ✅ Sitzungsschema 3 → 4; 7 Abnahmetests |
| F45 | Field/Eingabe | **Gehen als Eingabe**: `FieldInput.walking` (Vorgabe Rennen wie im Original), belegt auf „Abbrechen halten". Gemessen in `md1stin`: Rennen 384 Takte, Gehen **1536 Takte** — exakt Faktor 4 bei identischer Schrittzählung, und beide treffen dieselbe Prüfnummer. Genau das ist der „Limbo"-Effekt der Doku: dieselbe Strecke, dieselben Schritte, aber die Gefahrenschwelle wird nicht erreicht | ✅ |

**Was aus der Doku abgeleitet und nicht gemessen ist (🔵):** Die Doku nennt
„jedes Bild" für `fractions` und zugleich „alle 8 Bilder" für den Überlauf —
daraus folgt der Zuwachs 256/8 = 32 je Bild; wörtlich steht er dort nicht.
Die **Gefahrenschwelle je Prüfung** ist ebenfalls unbeziffert;
`DANGER_PRO_PRUEFUNG = 1024` ist der freie Parameter (Rennen: eine Prüfung je
16 Schrittzyklen). Belegt aus dem Format bleiben allein Tabelle, Rate und die
6-Bit-Wahrscheinlichkeiten. Die Formationsnummer wandert nach der
beschriebenen Regel (+2/+3 je nach aktuellem Wert), ist aber noch nicht mit
der Formationsauswahl selbst verdrahtet — die läuft weiter über die
gewichteten Tabellenplätze.

## F18/F24-A gelöst: Die Kernel-Namensliste war die falsche Sektion (2026-08-11)

**Befund.** Das Menü las die **Zauberliste** als Gegenstandsliste. Über die vier
Spielstände der Installation (save00/01/07/09) ergibt das 79 Inventarzeilen, davon
**65 falsch benannt, 14 als „?ID", 0 richtig**. Damit sind beide Hälften von F24
mit einer Ursache erklärt: die „falschen Itemnamen" *und* „Materia werden unter
Gegenstände gelistet" — der Tester sah Zaubernamen.

**Ursache.** `pickItemTextLists` filterte auf `strings.length === ITEM_COUNT`
mit `ITEM_COUNT = 256`. Genau zwei Textlisten haben 256 Einträge: Sektion 10
(Magiebeschreibungen) und Sektion 18 (Magienamen). Die Gegenstandsnamen stehen in
Sektion 19 und haben **128** Plätze. Die Zahl 256 stammte aus der Inventargröße,
nicht aus der Kernel-Datei — und traf deshalb die Liste, die zufällig 256 Einträge
hat. Warum die damalige Zugewinnmessung das nicht auffangen konnte, steht in
`tools/realdata-scan/FINDINGS.md`, Abschnitt **M4-K**.

**Sektionsrollen, 0-basiert, gemessen.** 17 Kommandos (32) · 18 Magie/Angriffe
(256) · 19 **Gegenstände** (128, belegt 0…104) · 20 **Waffen** (128, Füllgrad
1,000) · 21 Rüstungen (32) · 22 Accessoires (32) · 23 Materia (96) · 24
Schlüsselgegenstände (64). Beschreibung = Name − 8.

**Umsetzung.** `resolveKernelNameLists` bestimmt die Rollen über einen Anker
(einzige 128er-Liste mit Füllgrad 1,000 = Waffen), die feste Rollenreihenfolge und
eine Gegenprobe je Rolle (Stringanzahl; Gegenstände zusätzlich Belegungsgrenze
104). `inventoryNameLookup` wendet die Bereichskodierung aus F18 an:
0…127 Gegenstände · 128…255 Waffen · 256…287 Rüstungen · 288…319 Accessoires.

**Abnahme.** `tools/realdata-scan/src/kernel-names-probe.rdtest.ts`: 79/79 Zeilen
lösen auf (52 Gegenstände, 15 Waffen, 9 Rüstungen, 3 Accessoires), 0 Platzhalter;
Kontrollniveau ist die alte Lesung mit 14 Platzhaltern und 65 abweichenden Namen.
Der Fixture-Test in `packages/menu/src/menu.test.ts` bildet jetzt den **echten
Sektionssatz** nach (fünf 128er-Listen, zwei 256er-Listen) — mit der alten
Einzelliste blieb die Suite grün, obwohl das Menü zu 100 % falsch benannte.

**Zusatz im selben Bereich.** Die Recordtabellen der Kernel-Sektionen 5…9
(1-basiert) sind jetzt typisiert (`packages/formats-kernel/src/data-records.ts`):
Item 28 B · Waffe 44 B · Rüstung 36 B · Accessoire 16 B · Materia 20 B, das
Accounting geht für alle fünf byteexakt auf. Restriktionsfelder sind
**bitinvertiert** — die Datei speichert Verbote. Details und Kontrollniveaus in
FINDINGS.md, Abschnitt **M4-R**.

## Testprotokoll (fortlaufend)

- ✅ Boot über Dev-HTTP-Quelle: 8 Archive indexiert, maplist (787 Namen), KERNEL.BIN, scene.bin, WM0.MAP, Weltscript, Spielstand geladen.
  ⚠️ **Korrektur 2026-08-11:** Diese Zeile behauptete ursprünglich „`wm0.ev` geladen". Das war falsch —
  geladen wurde tatsächlich **`wm2.ev`**. Der alte Griff nahm den ersten `.ev`-Eintrag in TOC-Reihenfolge,
  und dort steht `wm2.ev` auf Position **963**, `wm0.ev` erst auf **965**; über alle vier Sprachvarianten
  (je 985 Einträge) ging der Griff **4/4 daneben**. Seit W1 wird der Eintrag namentlich (`'wm0.ev'`) geholt
  und mit dem Terrain als Paar geführt; die Laufzeit meldet jetzt `wm0.ev` mit **49** Mesh-Funktionen
  (Kontrolle: `wm2.ev` 1, `wm3.ev` 25). Siehe Abschnitt **W1** weiter unten.
- ✅ Start-Field `md1stin` betreten, Spielermodell (aaaa.hrc = Cloud) steht auf dem Walkmesh, Kamera + Letterbox korrekt.
- ✅ Bewegung: 45 Takte „hoch" ⇒ Tri 0→22, y 27462→27659, Blickrichtung 0→90°; Solver-Events plausibel.
- ✅ Script-Läufe: NPC-Richtungen und Animation (Actor 11: anim id 6, loop) werden vom Interpreter gesetzt.
- ✅ NPC-Modelle nach F02-Fix geladen (Actors 2/9/10); „pinkes Objekt" neben Cloud ist die POTION-Flasche (Pickup-Objekt, korrekt klein) — kein Fehler.
- ✅ Talk-Kette End-to-End: OK am Wächter ⇒ Talk-Script ⇒ MESSAGE dialogId 6 ⇒ dekodierter Text „Received "Potion"!" ⇒ Folgedialog ⇒ Sound-Requests ⇒ Dialog schließbar.
- ✅ Zufallskampf: Encounter 302/303 in md1stin; voller Ablauf ATB→Angriff→Gegner-KI→Sieg (EXP 36/AP 4/Gil 22) → Rückkehr, mehrfach reproduziert; Kampf robust auch bei gehaltener Bewegung.
- ✅ Menü: Party-Ansicht mit echten Spielstandsdaten (Tifa Lv 17, Cloud Lv 18, Yuffie Lv 17), Gegenstandsseiten mit deutschen KERNEL-Namen, Öffnen/Blättern/Schließen.
- ✅ Weltkarte: Landstart (Spiralsuche, F10), zu Fuß begehbar, Highwind fliegt über alles, Terrain-Streaming + Verfolgerkamera, Höhenverfolgung.
- ✅ Welt→Field: Ortsmarke + OK ⇒ world-transition ⇒ md1stin geladen (zweifach bestätigt); F9/Buttons wechseln Field↔Welt.
- ✅ Kampf-Sicht nach F13-Fix: Gegner-MPs als texturierte Modelle am Boden links, Party rechts (`.shots/battle-fixed.jpg`).
- ✅ Musik verdrahtet (F09): music-HostRequests → music.idx (1-basiert→0-basiert) → OGG; Kampf „bat", Sieg „fanfare", danach Feldmusik zurück (Autoplay-Sperre wird toleriert).
- ✅ Charaktergröße (F08): Cloud ≈ 68 px auf 640×480 im md1stin-Startblick, Proportionen zu Türen/Zug/Potion stimmig (scale/512-Hypothese sichtplausibel); pixelgenauer Web-Referenzabgleich scheiterte an CORS — offen als Feinkalibrierung.

## Demo-Verdrahtung der Welle 1 (2026-08-11)

Die fünf Paket-Fixes waren gebaut, aber `apps/demo` rief sie nicht auf. Diese
Runde verdrahtet sie und misst jede Kette **mit dem Zustand vorher als
Kontrolle** (`tools/realdata-scan/src/demo-verdrahtung-probe.rdtest.ts`, 4/4
grün gegen die Installation).

**W1 — die Demo fuhr das falsche Weltscript.** Die Auswahl
`[...worldGm.keys()].find((n) => n.endsWith('.ev'))` nimmt die TOC-Reihenfolge.
Gemessen in **allen vier** Sprachvarianten von `world_*.lgp` (je 985 Einträge):
`wm2.ev` steht auf TOC-Position **963**, `wm0.ev` auf **965** — der Griff ging
also 4/4 daneben. Kontrollgröße Mesh-Funktionen: `wm0.ev` **49**, `wm2.ev` **1**
(Unterwasser), `wm3.ev` 25. Die Demo lief mit dem Ein-Funktions-Unterwasserscript
über dem WM0-Terrain. Jetzt werden Kartendatei und Script GEMEINSAM benannt
(`WorldMapChoice`); die Laufzeit meldet `wm0.ev` / 49 über `gameDebug.weltScript()`.

**F09-A — die MUSIC-Kette endet jetzt auf einer spielbaren Datei.** Gemessen
über 1243 MUSIC-Vorkommen des Bestands, Prüfgröße ist das ENDE der Kette (liegt
eine `.ogg` vor):

| Regel | Endet auf vorhandener OGG |
|---|---|
| neu (`Operand → akaoOffsets → AKAO-Kopf → musicId → music.idx`) | **1217/1243 = 97,91 %** |
| alt (`musicNames[operand − 1]`) | 548/1243 = 44,09 % |

Nullwerte separat gerechnet: **688/1243 = 55,35 %** der Aufrufe tragen Operand 0
— dort war die alte Regel nicht falsch, sondern **stumm** (`musicNames[−1]` ist
`undefined`); dazu 7 Operanden oberhalb der 99 `music.idx`-Zeilen, zusammen
695 stille Aufrufe. Genau diese Stille hat den Defekt verdeckt. Die 13
verbleibenden Fehlschläge der neuen Kette sind `operand-out-of-range`, 2 lösen
über den Versatzausgleich des abgeschnittenen Magics auf.
In der laufenden Demo nachgeprüft: `md1_1` Operand 0 → musicId 3 → `dun2`,
`elmin1_1` Operand 1 → musicId 20 → `sido`.

**F09-D/F09-E/AUD-1 — Engine statt `HTMLAudioElement`.** `MusicRuntime` ist jetzt
der einzige Wiedergabeweg, `resumeAudio` hängt an Tastendruck und Zeigerdruck.
Abnahmegröße F09-E in der laufenden Demo: `plan.reason = "tagged-start-to-end"`,
`loopStart` 0,028 s, `loopEnd` 144,305 s (dun2) — das Intro läuft einmal, nicht
bei jeder Wiederholung.
**Neuer Nebenbefund dieser Runde:** `md1_1` setzt den MUSIC-Opcode in 150 Takten
**223-mal** ab (Script-Schleife). Ohne Wache hätte die Umstellung den Titel im
Sekundentakt neu gestartet — die Wache prüft `state.currentTrack`, also das
tatsächlich AUSGEFÜHRTE Kommando, und nicht wie die alte F09-D-Wache den Wunsch
vor dem Abspielen. Vor der Nutzergeste ist `currentTrack` `null`, eine Vormerkung
kann also nie als „läuft schon" missdeutet werden.

**F18 — Inventarnamen über die Spielstände der Installation.** 79 belegte
Inventarzeilen: **79/79 = 100 %** lösen bereichskodiert auf, mit der alten
einlistigen Auswahl 52/79 = 65,82 %. Nach Bereichen: Gegenstände 52/52 in beiden,
Waffen 15 · Rüstungen 9 · Accessoires 3 — davon mit der Altfassung **0**.
Leere Slots sind getrennt gezählt (0).

**K1/K2 — Battle-Präfixindex.** 11 119 Einträge, 481 Präfixe, 0 Abweichungen
gegen die Vollfilterung. Ehrliche Einordnung: das frühere Suffixfenster `aa..dz`
deckt **100 %** des Bestands ab — die Auflistung ist eine Optimierung, keine
Korrektur; der Lader-Fix wirkte schon vor der Verdrahtung. In der laufenden Demo:
`rt` (Cloud) 33 Teile / 2 Texturen / 23 Bones (vorher 3 Teile / 0 Texturen),
Kampf in `md1_1`: `aq` 20 Teile, `ar` 32 Teile.

**F06 — `field.tbl` in der Demo.** 64 Datensätze geladen, 58 belegt; die Sitzung
bekommt die Tabelle, `world-transition` wird nach `source` unterschieden und die
Ankunft `{x, y, triangle}` an `enterField` durchgereicht. 🔴 `direction` wird nur
protokolliert, nicht auf die Blickrichtung angewandt — ihr Nullpunkt im
Field-Raum ist ungemessen. Sichtprobe über `gameDebug.fieldTblEintrag(1, 0)`:
`fieldId` 170 → `mds5_5`, (711, −2420), Dreieck 16.

**F35-1 — Anfangszustand der Hintergrundparameter** wird jetzt aus
`bundle.background.layers[].tiles` gerechnet (`berechneAnfangsBgStates`) und über
die neue `FieldSession`-Option `initialBgStates` durchgereicht. In `md1stin`
sichtbar als `bgStates = {1: 1}` statt leer. Die offene Zeichenregel-Frage
(„leere Maske = unsichtbar" vs. „Rückfall auf Anfangszustand") bleibt unberührt.

## Abnahme der Welle 1 — Gesamtlauf (2026-08-11)

Alle drei Suiten wurden nach dem Zusammenführen der fünf Paketänderungen und der
Demo-Verdrahtung vollständig gefahren.

| Lauf | Ergebnis |
|---|---|
| `npm test` | **60 Dateien / 686 Tests, 686 grün, 0 Fehler, 0 übersprungen** |
| `npx tsc -b --force` | **grün** (Exit 0, erzwungener Neubau ohne Inkrementcache) |
| `npx vitest run --config vitest.realdata.config.ts` | in zwei Hälften gefahren (Laufzeit): **87 Dateien, 234 Tests — 155 grün, 0 Fehler**, 79 übersprungen (Hälfte 1: 47 Dateien, 83 grün / 45 übersprungen · Hälfte 2: 40 Dateien, 72 grün / 34 übersprungen) — die Übersprungenen sind durchweg die `describe.skipIf(available)`-Gegenstücke „Realdaten nicht verfügbar", also bauartbedingt und kein Ausfall |

**Ein Fehlschlag, behoben.** `tools/realdata-scan/src/battle-model-sheet.rdtest.ts`
scheiterte mit `EPERM: operation not permitted, mkdir 'C:\Program Files (x86)\webmidgar-sheets'`.
Ursache war ein **Defekt im Test**, keine Semantikänderung: der Ausgabepfad wurde
aus `REAL_DIR` abgeleitet (vier Ebenen aufwärts), was bei der Steam-Installation
in `C:\Program Files (x86)` landet und bei der Kopie unter `C:\ff7-daten-kopie`
sogar oberhalb der Laufwerkswurzel. Der Ausgabeort einer Tafel darf nicht von der
Lage der Originaldaten abhängen; er liegt jetzt unter `os.tmpdir()` und bleibt
über `WEBMIDGAR_BATTLE_SHEET_OUT` überschreibbar. **Keine Erwartung wurde
nachgezogen** — die Messaussage des Tests ist unverändert (56 Modelle, 20 mit Textur).

**Abnahmegrößen der Welle, gegen ihre Sollwerte:**

| Größe | Soll | Gemessen | |
|---|---|---|---|
| Inventarnamen aufgelöst | 79/79, kein `?ID` | **79/79 = 100 %** gegen Altregel **52/79 = 65,82 %**; Waffen 15, Rüstungen 9, Accessoires 3 lösten alt zu **0** auf | ✅ |
| Battle-`.p`-Teile | 8979 statt 2321 | **8979/8979** gegen Kontrolle **2321** | ✅ |
| Battle-TEX | „204 statt 35" | **787/787** gegen Kontrolle **411**; davon Modellpräfixe **201** statt 35 — die Sollzahl 204 der Auftragsliste ist um 3 zu hoch, richtig ist **201** | ✅ (Sollwert korrigiert) |
| Spannen-Abschluss | ≥ 99,92 % | **99,92 %** ok (0,01 % unknown, 0,06 % overrun); der Koordinatenabstieg käme auf 99,94 % | ✅ |
| Weltscript | `wm0.ev` mit 49 Mesh-Funktionen | **`wm0.ev`, 49** (Kontrolle `wm2.ev` 1, `wm3.ev` 25) | ✅ |
| `field.tbl` Accounting | geht auf | **1536 B = 64 × 24, Rest 0**; 65/128 Einträge belegt | ✅ |
| `field.tbl` Auflösungsquote | — | K1 65/65 (Kontr. 0/0/0) · K2 65/65 (Kontr. 22/1/0/0) · K3 65/65 (Kontr. 54) · **K4 65/65 (Kontr. 0 und 11)** | ✅ |
| MUSIC-Kette bis zur OGG | — | **1217/1243 = 97,91 %** gegen Altregel **548/1243 = 44,09 %** | ✅ |

**Replay-Digests unverändert und geprüft:** `diagonal 264718afa7d478d5`,
`gleiten 430f8b8a0770156f`, `skript dfdfd745ed5452e0` — alle drei gemessen gleich.
Das ist die tragende Gegenprobe der Welle: `FieldScriptSet.schemaVersion` ging
1 → 2 und die Opcode-Längen 0xA6/0xA7 wanderten von der Skip- auf die
Implementierungstabelle. **Hätte** sich ein Digest bewegt, wäre das der Alarm
gewesen (Offsettabelle im Laufzeitzustand bzw. beschädigte Längentabelle);
dass sie stehen, ist die Aussage. Der Soak-Test meldet weiterhin
`digestStabil: true`, `fehler: 0`.
