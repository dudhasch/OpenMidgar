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
| F07 | Menü | Menü ist lesend (S21-Stand): kein Ausrüsten/Benutzen/Speichern | Bekannte Ausbaustufe | ✅ **Ausrüsten und Speichern behoben (Welle 4)** — Schreibpfad `formats-save/src/write.ts`, Ablauf `menu/src/actions.ts`, Abnahme über die Bytedifferenz und die Stückzahlerhaltung. 🔴 **„Benutzen" bleibt offen**, weil die Wirkungsangabe im `ItemRecord` ungemessen ist — s. unten |
| F08 | Charaktergröße | Sichtvergleich der Feldmodell-Skalierung (scale/512-Hypothese) gegen Referenzbilder steht aus | Kalibrierung | 🔜 geplant |
| F09 | Audio | music/sound-HostRequests werden nur geloggt (music.idx→OGG-Kette wäre seit S37 möglich) | Integrationslücke, nicht 1.0-kritisch | ✅ vollständig verdrahtet (2026-08-11): Kette über resolveFieldMusic, Wiedergabe über MusicRuntime |
| F09-B | Audio/Field | **Der MUSIC-Operand ist kein Titel, sondern ein field-lokaler Index in die AKAO-Offsettabelle von Sektion 1.** Die Demo las ihn direkt als `music.idx`-Zeile. Gemessen über 702 Fields/1243 Vorkommen: „Operand < nAkao des eigenen Fields" 98,95 % (Kontrollen 71,92 % Nachbarfield, 49,88 % Byte-davor); an `akaoOffsets[v]` steht in 1228/1230 = 99,84 % das Magic `AKAO` (Kontrollen Versatz +4 und Zufallsoffset je 0,00 %); `u16@+4` liegt 1230/1230 im Band 1…98 (Kontrolle „u16 zwei Byte weiter" 14,63 %). Gegenhypothese Kujata (`u8@+50`) 31,06 % — fällt durch. Die 2 Magic-Fehlschläge sind exakt die belegten `KAO…`-Blöcke (`junair2`, `junone7`, `sininb1`, `sininb2`), mit Versatzausgleich lösen 1230/1230 auf | Kette `MUSIC v → akaoOffsets[v] → AKAO-Kopf → musicId → music.idx[musicId−1] → OGG` | ✅ Parser + Demo verdrahtet; Endprüfung 1217/1243 = 97,91 % vorhandene OGG gegen 548/1243 = 44,09 % der Altregel |
| F09-E | Audio | `readOggLoopTags`/`planLoop` waren vollständig getestet und wurden **nirgends aufgerufen**: Die Demo setzte `audioEl.loop = true` und wiederholte die ganze Datei — jeder Titel mit Intro spielte sein Intro erneut. Ein `HTMLAudioElement` kann das prinzipiell nicht anders; `loopStart`/`loopEnd` gibt es nur am `AudioBufferSourceNode` | 87 % der Titel tragen `LOOPSTART`, kein einziger `LOOPLENGTH` | ✅ verdrahtet; in der Demo gemessen: plan.reason = tagged-start-to-end, loopStart 0,028 s, loopEnd 144,305 s (dun2) |
| F10 | Weltkarte | Demo-Startposition (Rastermitte) liegt auf Wasser (Klasse 3) — zu Fuß bewegungsunfähig; erst Fahrzeugwechsel (Highwind) macht die Karte befahrbar | Startplatzierung | 🔧 Landstart suchen |
| F11 | Weltkarte | Terrain rendert als Klassenfarben-Diagnose; Weltkarten-Texturen sind nicht erschlossen | Bekannte S28-Lücke | ✅ **F11a+F11b gelöst und in der Demo verdrahtet** (Welle 2): `buildBlockGroup` zeichnet über `buildTexturedMeshGeometry` mit Tabelle+Atlas, Darstellungsart `textured` ist Vorgabe. 🟡 Ozeanfarbe bleibt Ersatzpalette (66,55 % der WM0-Dreiecke) — s. F11b/F25 unten |
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
| F24 | Menü | Menü-UI **durchgängig als katastrophal bewertet** (10/10): Rahmen, Schrift, Anordnung entsprechen nicht dem Original — die Demo zeigt eine Diagnosetabelle, kein FF7-Menü. Zusätzlich inhaltlich: Materia werden unter „Gegenstände" gelistet, Itemnamen teils falsch (`?307`, `?260`, s. F18) | Ausbaustufe + Datenlesung | 🟡 **F24-B umgesetzt (Welle 2), Aufteilung aber unbelegt.** Die `<table>`-Diagnose in Monospace ist ersatzlos weg; das Menü läuft über `MenuSession.screen()` → `HudBox[]` → `paintBoxes` → `applyWindowSkin`, also durch **dieselbe** Fensterschale wie Dialog und Kampf-HUD. Sechs neue Ansichten (Ausrüstung, Materia, Zauber, Limit, PHS, Konfiguration), Gegenstandsbeschreibungen im Fußfenster, Ortsanzeige aus der Savemap statt vom Wirt geraten. 🔴 **Die Hauptmenü-Aufteilung ist NICHT belegt** — unter den 18 Referenzbildern ist keine Menüaufnahme, und makoureactor dokumentiert nur die FIELD-Fenstergeometrie (320×224), nicht das Menü. Die Zahlen liegen deshalb vollständig in **einem** austauschbaren Objekt `FF7_MAIN_MENU_LAYOUT`; ob die Kommandospalte im Original links oder rechts steht, ist offen. **Datenlesung behoben, s. F18/F24-A** |
| F25 | Weltkarte | Weltkarte **durchgängig katastrophal** (13/13): „KOMPLETT FALSCHE FARBEN — 3D-Modell an sich plausibel". Das Terrain rendert weiterhin die Klassenfarben-Diagnose (F11). Ausdrücklicher Referenzwunsch des Projektinhabers: **an FF7-Landscaper orientieren**. Nebenbefund: bei „3× Tab" ist kein Fahrzeugmodell erkennbar | Bekannte Lücke, jetzt priorisiert | ✅ **gelöst** — Texturzuordnung gemessen (F11b, WM0 282/282 gegen Kontrolle 0,6028), Atlas gebaut, Sichtnachweis vorhanden; **in der Demo verdrahtet (Welle 2)**: Atlasseite einmalig als `DataTexture` (`flipY=false`, Mipmaps, Anisotropie), Trennung nach `geo.atlasPages`, Dreiecke ohne Atlaszelle (255) fallen auf Klassenfarben zurück; drei Darstellungsarten `textured`/`terrain`/`region`. 🟡 Ozeanfarbe über Ersatzpalette, 🔜 Fahrzeugmodell (F34) |
| F26 | Kampf | 19/27 katastrophal. Bestätigt und zusammengefasst: **keine Kampfbühne** (schwarzer Hintergrund), **Party wird nicht gerendert** (nur Quader bzw. gar nichts), **Gegnermodelle erscheinen verzögert** (die ersten Takte zeigen Farbflächen) **und sind viel zu klein**, Blickrichtung der Gegner vermutlich gespiegelt, **HUD nicht im Originalstil** (Diagnosekasten statt FF7-Kampfmenü) | Sammelbefund über F05/F19 hinaus | 🟡 **drei von vier Teilen behoben (Welle 2), die Kamera nicht.** ✅ HUD im Originalstil (K6, s. u.) · ✅ echte Bühne statt schwarzer Ersatzscheibe: `stagePrefixForLocation(formation.location)` → `loadBattleStage` → `buildBattleStage`, 1000/1000 Formationen lösen auf · ✅ Party als echte Battle-Modelle statt blauer Quader (K4-Zuordnung, s. u.) · 🔴 **Die Kampfkamera ist falsch kalibriert und ist damit der größte verbleibende Sichtmangel**: bei Encounter 8 (Bühne `pk`) füllt eine Ziegelwand das ganze Bild, bei Encounter 300 (Bühne `op`) sind alle Figuren sichtbar, aber winzig. Bühne, Party und Gegner sind dabei nachweislich geladen (`gameDebug.kampfBuehne`/`battleModelle`) — es ist kein Ladefehler, sondern der 🟡 unkalibrierte Öffnungswinkel bzw. der 12-B-Kamerasatz, der Position und Ziel trägt, aber keinen Zoom. 🔴 Zusätzlich stehen alle Figuren in der **Bindpose** (Arme senkrecht nach oben), weil das Animationsformat der Battle-Modelle (`da`-Dateien, 872 Stück) ungedeutet ist |

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
| F33 | Kampf | **Party sind blaue Quader** (in Runde 2 zehnmal wörtlich benannt), Gegner zusätzlich „viel zu klein" — dieselbe Größenfrage wie F28, nur im Kampfraum. Ohne Party-Battle-Modelle und ohne Bühne ist die Kategorie nicht sinnvoll bewertbar; 15 von 25 Bildern katastrophal, kein einziges „gut" | Bekannte Lücke, jetzt quantifiziert | 🟡 **teilweise behoben (2026-08-11), s. K1/K2 unten.** Der Lader ist repariert — er rät keine Dateinamen mehr, sondern klassifiziert jeden Eintrag des Präfix-Namensraums über seine **Inhalts-Signatur**: **8979/8979** `.p`-Teile (Kontrolle alter Lader: **2321** = 25,8 %) und **787/787** TEX-Dateien (Kontrolle: **411**; davon Modellpräfixe **201** statt 35) über 11 119 Einträge / 481 Präfixe; kein Präfix ohne Skelett, keines mit 0 Teilen trotz Geometrie (vorher 36). Cloud (`rt`) liefert jetzt **33 Teile / 2 Texturen / 23 Bones** statt 3/0. 🔴 **Die Party bleibt trotzdem aus Quadern**: welcher Party-Platz welches Battle-Präfix trägt, ist im gesamten Baum **nirgends gemessen** — „rt = Cloud" ist eine Behauptung, für die übrigen Plätze existiert nicht einmal eine. Eine geratene Tabelle wäre ein Regel-3-Verstoß; was fehlt, ist eine Messung, nicht Code. **⇒ Diese Messung liegt seit Welle 2 vor (K4, s. u.), die Quader sind weg.** Die Party lädt jetzt über `savemap.party` → `partyModelPrefix` → `loadBattleModel`/`buildBattleActor`. Die Größenfrage ist mit Kontrolle beantwortet: **Faktor 1, kein Umrechnungsfaktor** (`BATTLE_MODEL_SCALE = 1`) — der Feldfaktor 4 aus F37 gilt im Kampf NICHT. Belegt über Bindpose-Höhen (Spieler Median 852, Gegner Median 1370) gegen einen Sweep 1/4/8/16: schon bei 4 füllt ein Party-Unterarm ein Drittel des Bildes. 🔴 Bindpose und Kamera bleiben offen, s. F26 |
| F34 | Weltkarte | Unverändert „Farbe falsch, 3D-Modelle gut". Referenzwunsch bleibt **ff7-landscaper**; aus dem README ließen sich keine Formatdetails ziehen, die Texturzuordnung steckt im Quellcode (`src/`, `src-tauri/`) und in `docs/map-state.md` | Bekannte Lücke | ✅ Farbteil gelöst — **ohne** Fremdcode: die Zuordnung wurde aus der Spiel-EXE des Nutzers GEMESSEN, nicht aus ff7-landscaper übernommen; seit Welle 2 auch in der Demo sichtbar (s. F25). 🔜 **Der Nebenbefund „bei 3× Tab kein Fahrzeugmodell erkennbar" ist unangetastet** — das ist Weltmodell-Rendering, nicht Terrain, und wurde in Welle 2 nicht bearbeitet |
| F35 | Field/Modelle | **Fehlende 3D-Objekte:** In `junonr2` fehlt die Gondel, in `bigwheel` fehlen Tür und Gondel in allen drei Animationsphasen. Das sind Script-gesteuerte Feldobjekte, keine Hintergrundkacheln — sie hängen an Opcodes, die die Demo noch nicht ausführt | Spielbarkeit/Sichtqualität | ✅ **vermessen und ohne Codeänderung geschlossen (Welle 4)** — die Zeichenregel ist richtig (Median des fehlenden Bildanteils **0,0 %**; drei Gegendeutungen scheitern an ihrer eigenen Vorhersage), und `junonr2`s `lift` trägt **weder Modell noch Hintergrundparameter**: seine Animationsspannen hängen an Story-`REQSW`, die in einer freilaufenden Demo nicht ablaufen. 🔴 Rest: was `lift` zeichnet, und ein Ausläufer von 27 Fields — s. unten |
| F35-1 | Field/Hintergrund | **Teilbefund, vermessen (2026-08-11).** Die „Gondel" von `junonr2` ist **kein** 3D-Modell: Die Entitäten `door` (Index 0) und `lift` (Index 3) tragen `modelIndex = null` — es sind Hintergrundgruppen (Layer 1 param 16, Layer 2 param 17/18). Zwei Ursachen wurden geprüft: (a) **Bankbyte-Aufteilung ausgeschlossen** — alle **46** BG-Instruktionen von `junonr2` tragen Bankbyte 0, bei Literaloperanden ist `banks>>4`/`banks&0xf` wirkungslos. (b) **Anfangszustand eingeführt** (🔵): `berechneAnfangsBgStates` belegt je Parameter das niedrigste vorkommende Zustandsbit vor. Gemessen über 702 Fields: von 1256 animierten Kachelgruppen sind nach 300 Ticks **542 leer ohne** und **329 leer mit** Vorbelegung — **213 Gruppen mit 9682 Kacheln** werden wieder sichtbar. 🔴 **`junonr2` ist NICHT darunter**: Vorbelegung `{16:1, 17:1, 18:1}`, nach 300 Ticks ohne wie mit `{16:0, 17:0, 18:1}` — das Skript räumt die Parameter selbst wieder ab | Interpreter-seitig erledigt, Restursache liegt woanders | ✅ **beantwortet (Welle 4), und die Alternative war eine Scheinalternative.** Die Zeichenregel bleibt: Der deutungsfreie Bildanteil-Test gibt ihr recht (Median 0,0 %), und alle drei Gegendeutungen fallen. ⚠️ **Die Zuordnung in dieser Zeile ist falsch** — der Kontrollflusslauf zeigt param 16 = `door`, **17/18 = `smoke0`/`smoke1`**; `lift` hat **gar keinen** Hintergrundparameter. Der Fehler entstand durch Erschließen statt Messen: zwei modelllose Entitäten, drei Parameter, im selben Field |

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

## F11b + F25 — Weltkarten-Texturen: gelöst und gemessen (2026-08-11)

### F11b — welche Texturdatei gehört zu welcher `textureId`?

**Fundstelle (gemessen, nicht übernommen):** Die Zuordnung steht als
**Zeigerfeld in der Spiel-EXE** (`ff7.exe`, Dateiversatz `0x5686E8`, VA
`0x969CE8`; in `ff7_en.exe` identisch). Jeder Eintrag zeigt auf einen
NUL-terminierten Namen `<name>.tim` in einem 4-Byte-ausgerichteten
Zeichenkettenvorrat; der PC-Lader lädt daraus `<name>.tex` aus
`world_us.lgp`. Gelesen wird die Tabelle von `parseWorldTextureNames`
(`packages/formats-world/src/texture-names.ts`) — **die Fundstelle wird
gesucht, nicht fest verdrahtet** (längster Lauf aufeinanderfolgender Zeiger
auf `*.tim`-Namen).

**Aufbau — drei hintereinandergelegte Tabellen, 402 Einträge:**

| Karte | Basis | Länge | Belegte IDs |
|---|---:|---:|---|
| Overworld (WM0) | 0 | 390 | 0…281 (282 benutzt, 108 unbenutzt) |
| Unterwasser (WM2) | 390 | 8 | 0…7 |
| Great Glacier (WM3) | 398 | 4 | 0…3 |

380 Einträge tragen einen Namen, **22 nicht** — deren Zeiger führen in einen
uninitialisierten `.data`-Bereich (BSS). Das sind die **animierten Texturen
aus `wm.ta`**; genau 22 ist auch die Eintragszahl dieser Datei. Zwei
unabhängige Zählungen, dieselbe Zahl.

**Gütefunktion mit Kontrolle** (`world-texmap-probe`, Realdaten): Passen die
Dreiecks-UVs in das Fenster der zugeordneten Textur?

| Karte | Treffer | Quote | Kontrolle (500 Verwürfelungen) Median / Max |
|---|---|---:|---|
| **WM0** | **282/282** | **1,0000** | **0,6028 / 0,6489** |
| WM0, nur seltene Größen (≤ 8 Exemplare) | **20/20** | **1,0000** | **0,5500 / 0,7000** |
| WM2 | 8/8 | 1,0000 | 0,8750 / 1,0000 (bei 8 IDs ohne Trennschärfe) |
| WM3 | 4/4 | 1,0000 | 1,0000 / 1,0000 (bei 4 IDs ohne Trennschärfe) |

Die **Zweitrechnung über seltene Größen** war nötig, weil 225 der 415
Texturen 32×32 sind — „passt ins Fenster" ist bei einer 225-fach
vorkommenden Größe billig. Bei den seltenen Größen (128×256 einmal, 32×128
einmal, 128×16 einmal …) trifft die Zuordnung ebenfalls vollständig.

**Gegengeprüfte Kandidatenordnungen** (dieselbe Gütefunktion, vor dem Fund
der EXE-Tabelle gemessen, WM0): TOC-Reihenfolge des Archivs **0,5780** ·
alphabetisch **0,5780** · physische Datenlage im LGP **0,6241** · nach Größe
sortiert **0,4645** · bestes gleitendes Fenster über die physische Ordnung
**0,7411** — gegen ein Verwürfelungsniveau von Median 0,5851 / Max 0,6241.
**Keine** dieser naheliegenden Ordnungen ist die richtige; erst die
EXE-Tabelle liefert 1,0000. Das ist der Beleg dafür, dass die Zuordnung
gemessen und nicht geraten wurde.

**Beifang, unabhängig bestätigt:** Der `cltr`-Quirk der Unterwasserkarte ist
gemessen — **1992 von 2523** UV-Bytes der WM2-ID 0 liegen auf 254/255
(„Außenbereich"), der Rest endet bei 120 und passt damit sauber in die
128 px breite Textur. Ohne diese Ausnahme behauptet die Messung eine
256 px breite Textur, die es nicht gibt.

**`wm.ta` (animierte Texturen), Accounting geschlossen:** 22 Einträge,
`stride == 528` in 22/22, `offset[i+1]−offset[i] == frames·stride` in 21/21,
`12 + w16·h·2 == bnum` in **108/108** Halbbildern. 4 oder 8 Halbbilder je
Textur, `speed ∈ {10, 15, 20, 25}`. **4 bpp, 32×32** — gegen die
16-bpp-Lesart entschieden durch (a) die gemessene UV-Fenstergröße 32×32 in
22/22 Fällen und (b) das VRAM-Raster `vramX ∈ {384…440}` Schrittweite 8,
`vramY ∈ {256, 288, 320}` Schrittweite 32, das genau die Texturmaße trifft.

**🔴 Offen geblieben:** Die **Farbtabelle der 22 animierten Texturen**.
`wm.ta` enthält keine CLUT (das Byte-Accounting geht ohne Rest auf), und die
EXE-Tabelle führt für sie keinen Namen. Diese 22 IDs tragen **66,55 % aller
WM0-Dreiecke** (der Ozean) — sie werden daher mit einer ausdrücklich
gekennzeichneten **🟡 Ersatzpalette** eingefärbt, die aus den Daten
ABGELEITET ist: dunkelste und hellste Farbe der Palette der statischen
Textur, die am häufigsten im selben Mesh vorkommt, dazwischen 16 Stufen
linear. Der Ozeanton ist damit **kein Beleg**; Geometrie, UV-Rechnung und
Atlas sind es.

### F25 — texturiertes Terrain

- **Gemeinsamer Packer:** Der Regal-Packer wurde aus
  `render-field/tile-atlas.ts` in das neue Paket **`@webmidgar/atlas`**
  herausgehoben und wird jetzt von Field UND Weltkarte benutzt (die
  Kampfbühne kann denselben nehmen). Kein zweiter Packer.
- **Atlas-Accounting WM0:** 282 benutzte IDs → 282 Bilder (260 statisch,
  22 animiert), **1 Seite** 2048², Polsterung 4 px mit Edge-Bleed,
  **0 abgewiesen**, **0 überlappende Paare** (Prüfung schließt die
  Polsterung ein), Nutzfläche 886.784 px, Füllgrad 0,2114.
- **Wiederholung in der UV-Rechnung**, nicht über `RepeatWrapping` — bei
  Atlasnutzung liefe die Hardware in die Nachbarzelle
  (`atlasUvForLocalPixel`, halbe Texelmitte gegen Randmittelung).
- **Klassenfarben bleiben als umschaltbare Diagnose** erhalten.
- **Sichtnachweis:** `world-texmap-probe` schreibt vier Standbilder
  (Gesamtkarte und Nahausschnitt, je texturiert und Klassenfarben) plus die
  Atlasseite. Farbvielfalt Gesamtkarte: texturiert **470**, Klassenfarben
  **29** (mehr als 32 kann die 5-Bit-Diagnose nicht). Die texturierte
  Gesamtansicht zeigt die FF7-Weltkarte wiedererkennbar: Ost- und
  Westkontinent, Nordkrater mit Schnee, Wüste um die Goldene Untertasse,
  Midgar.

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

## Kampf-HUD und Ergebnisbildschirm (K6/N7/K7, 2026-08-11)

**F26 (Teilbefund „HUD nicht im Originalstil") ist erledigt.** Der
Diagnosekasten aus `<pre>`-Text ist weg; das HUD entsteht jetzt aus
`@webmidgar/ui-battle-hud` — der Anordnung als Daten plus der gemeinsamen
Fensterschale `@webmidgar/ui-window`. Die übrigen Teile von F26 (Bühne,
Party-Modelle, Gegnergröße) bleiben offen und gehören einem anderen Bereich.

**Die F40-Kanten wurden unabhängig nachgemessen**, nicht übernommen:
Kantensuche über die Bordürenfarben in `apps/demo/.shots/ref/…223335_1.jpg`,
`…223327_1.jpg`, `…223347_1.jpg`, `…223349_1.jpg` (alle 640×480, unskaliert).

| Größe | F40-Katalog | Nachmessung 2026-08-11 | |
|---|---|---|---|
| linkes HUD-Fenster | `(1,333)–(270,442)` | Bordürenkanten x=0…273, y=332…443 | ✅ ±1 px |
| rechtes HUD-Fenster | `(275,333)–(637,442)` | x=274…639, y=332…443 | ✅ ±1 px |
| Kommandofenster | `(145,341)–(261,450)` | x=144…263, y=340…451 | ✅ ±1 px |
| ATB füllend | `rgb(145,210,170)` | Kennzeile y=357 → `(140,213,170)` | ✅ |
| ATB voll | `rgb(227,181,129)` | Kennzeile y=357 → `(228,181,129)` | ✅ |

Die ±1-px-Abweichungen sind genau die Frage, ob die vom JPEG weichgezeichnete
äußerste Bordürenspalte mitgezählt wird. Übernommen sind die F40-Werte.

**Neu vermessen** (in F40 nicht katalogisiert): Meldungsfenster über der Bühne
`(32,16)–(607,63)`; Balken BARRIER/LIMIT/TIME je 74×16 außen mit 64×10
Innenfläche bei x=190/476/554, y=351; LIMIT-Kennfarbe `rgb(204,143,176)`,
ungefüllt `rgb(89,89,89)`; Balkenprofil über 10 Zeilen mit Glanzlinie in
Zeile 5–6; Ergebnisbildschirm als fünf lückenlose Bänder auf 640×480
(68 / 52 / 3×120 px). **Der Farbumschlag grün→sandgelb bei vollem ATB ist
damit doppelt belegt** — einmal aus F40, einmal aus dem direkten Vergleich
`…223335` (grün, ATB läuft) gegen `…223327` (sandgelb, Kommandofenster offen).

**Kontrollniveau der einzigen hergeleiteten Größe.** Die Kopfhöhe 13 px ist
belegt: sie sagt die unabhängig abgelesene Balkenoberkante y=351 exakt vorher
(12 ergäbe 350, 14 ergäbe 352). Der **Zeilenabstand 29 px** ist NICHT belegt —
in jeder Referenzaufnahme steht Cloud allein in der Gruppe. Für 29 spricht
allein, dass 87/3 ohne Rest aufgeht. Wer eine Aufnahme mit voller Gruppe hat,
misst nach.

**K7 — `BattleViewModel` ist angeschlossen.** Es war seit S32 gebaut, aber
nirgends benutzt; Trefferzahlen und die Ersatzdarstellung erschienen NIE. Jetzt
speist jedes Tick-Ergebnis die Projektion, und das HUD zeigt aufsteigende,
verblassende Zahlen sowie die Effektabdeckung als Quote (gemessen im Lauf:
`0/68` — die 0 % aus S32 sind jetzt sichtbar statt verschwiegen). Ein Rückkanal
existiert weiterhin nicht.

**Kampf-Bildrate — gemessen, dann geändert.** `packages/battle-runtime` kannte
gar keine Rate; die Demo tickte den Kampf in der gemeinsamen 30-Hz-Schleife,
also **doppelt so schnell wie das Original** (ffnx `ff7_limit_fps`: BATTLE 15,
FIELD/WORLDMAP 30, MENU 60, CREDITS 39). Die Demo taktet ihn jetzt über
`isBattleTickDue` auf 15 Hz; Eingaben der übersprungenen Wirtstakte werden
gepuffert. **Kein engineCompat-Schritt:** Die `BattleSession` hat keine
Wanduhr, ihr Zustand hängt nur an der Zahl der Takte und den Eingaben — belegt
in `packages/battle-runtime/src/rate.test.ts` (200 Takte, Digest
`738934749e950317`; Kontrollen: ein Takt mehr und ein anderer Seed ergeben
andere Digests). Die drei R9-Replay-Vektoren sind reine Field-Läufe und
bleiben unberührt. Die befürchtete Folge „alle Wartewerte um Faktor 2 falsch"
trifft NICHT zu: Wartewerte aus Originaldaten gibt es in der Kampflaufzeit
noch keine.

## Abnahme der Welle 2 — Gesamtlauf (2026-08-11)

Alle Suiten wurden nach dem Zusammenführen der fünf Wellen-2-Aufträge
(Glyphenmetrik/Fensterschale, Menü-Optik, Kampf-Modelle/Bühne, Kampf-HUD,
Weltkarten-Texturen) und der Demo-Verdrahtung vollständig gefahren.

| Lauf | Ergebnis |
|---|---|
| `npm test` | **69 Dateien / 835 Tests, 835 grün, 0 Fehler, 0 übersprungen** (Welle 1: 60/686) |
| `npx tsc -b --force` | **grün** (Exit 0, erzwungener Neubau ohne Inkrementcache) |
| `npx vitest run --config vitest.realdata.config.ts` | **97 Dateien, 261 Tests — 175 grün, 0 Fehler**, 86 übersprungen; in einem Lauf durchgefahren (60 s). Die Übersprungenen sind durchweg die `describe.skipIf(available)`-Gegenstücke „Realdaten nicht verfügbar", also bauartbedingt und kein Ausfall |
| `npx vite build --config apps/demo/vite.config.ts` | **grün, alle 17 Seiten gebaut** |

**Kein Fehlschlag, also auch keine nachgezogene Erwartung.** Anders als bei der
Welle-1-Abnahme gab es diesmal nichts zu reparieren: weder eine bewusste
Semantikänderung mit nachgezogener Erwartung (A) noch fehlerhaften neuen Code (B).

**Der Produktionsbuild ist bewusst mitgefahren**, weil er etwas prüft, das weder
`npm test` noch `tsc` sehen: die **Vite-Aliasauflösung**. Genau dort lag in dieser
Welle ein realer Blocker — `@webmidgar/atlas` war in `vitest.config.ts` registriert,
in `apps/demo/vite.config.ts` aber nicht, wodurch `game.html` mit
„Failed to resolve import" **gar nicht ladbar** war, während beide anderen Läufe
grün blieben. Der Eintrag ist ergänzt; alle Wellen-2-Pakete
(`ui-window`, `ui-battle-hud`, `atlas`, `menu`, `render-battle`, `render-world`,
`formats-kernel`) stehen in `apps/demo/package.json`.

### Digest-Gegenprobe — bestanden

Die drei Replay-Vektoren sind **bytegleich zu HEAD**, geprüft an der Arbeitsdatei,
nicht am Index:

| Vektor | Digest |
|---|---|
| `diagonal` | `264718afa7d478d5` |
| `gleiten` | `430f8b8a0770156f` |
| `skript` | `dfdfd745ed5452e0` |

Der Soak-Test (500 Field-Wechsel) meldet `digestStabil: true`, `fehler: 0`,
Heap-Abweichung 1,46 % gegen die Steady-Baseline, 500 Erwerbe / 500 Freigaben /
**0 Fehlfreigaben**.

`tools/nfr-run/src/replay-vektoren.ts` ist gegenüber HEAD verändert — aber
**ausschließlich um einen Kommentarblock** (+24 Zeilen, keine gelöschte Zeile).
Er dokumentiert eine *Nicht*-Fortschreibung: `BGROL`/`BGROL2` wanderten vom Skip-
auf den Ausführungspfad, ohne die Digests zu bewegen, weil keiner der drei
Vektoren einen BG-Opcode enthält. Das ist das erwartete Ergebnis — hätten sich
die Digests bewegt, hätte eine Längenänderung Opcodes berührt, die in den
Fixtures gar nicht vorkommen.

**Damit ist die tragende Aussage der Welle belegt:** Menü und Kampf-HUD sind
Overlays **ohne Zustandswirkung**. Sie lesen die Savemap, schreiben nichts,
ticken den Interpreter nicht und erzeugen keinen `HostRequest`. Verankert ist
das zusätzlich in `packages/menu/src/menu-runtime.test.ts` („lässt den
Replay-Digest unberührt, egal wie ausgiebig es bedient wird") — inklusive der
eingebauten Gegenprobe, dass das Menü im Vergleichslauf tatsächlich bedient
wurde. Eine Quote ohne Kontrollniveau wäre hier wertlos gewesen.

### Was in dieser Welle belegt wurde (mit Kontrollniveau)

| Größe | Gemessen | Kontrolle | |
|---|---|---|---|
| Glyphenbreiten-Regel `(b & 0x1F) + (b >> 5)` | Fenstervorhersage **38,90 %** exakt über 9417 echte WINDOW-Opcodes | additiv **38,90 %** gegen nicht-additiv **21,80 %**; Polsterungs-Sweep 19 px → 0,38 %, **20 px → 38,90 %**, 21 px → 6,99 % | ✅ |
| Glyphenbreite gegen Tintenbreite | **194/212** Glyphen exakt `Breite = Tinte + 1` | zweite, unabhängige Achse direkt aus dem Fontblatt gemessen | ✅ |
| WINDOW.BIN Accounting | **13317 B** = 10065+3076+156 komprimiert + 2 Nullbytes, byteexakt | Fallstrick belegt: das Längenfeld des TIM-Blocks in Sektion 1 nennt 16140 B, nur die Masse (32256 B) füllt die Sektion byteexakt | ✅ |
| Battle-Präfix → Figur (K4) | 21 Präfixe zugeordnet über **drei unabhängige Achsen** (Sichtbefund je Standbild, Kennzahlen/Byte-Identität, Charakterreihenfolge aus kernel.bin Sektion 3) | **Die naheliegende Regel „Index = 460 + charakterId" FÄLLT**: beste Verschiebung trifft **5 von 9**. Ursache gemessen: Barret belegt vier, Vincent drei aufeinanderfolgende Präfixe. Das Kontrollniveau 5/9 steht als Test im Code | ✅ |
| Bühne → `location` (K5) | Regel „Präfix = Band[location]" löst **1000/1000** Formationen auf, 89/90 Präfixe erreicht, Bereich exakt 0…89 | **Ehrlich: Vollständigkeit trennt NICHT** — jede Bijektion löst zu 100 % auf. Zwei Inhaltsmaße versucht und **beide gescheitert**: Gegner im Bühnengrundriss (Regel 98,05 %, +1 sogar 99,09 %, verwürfelt 97,85 %) und Rangkorrelation Bühnenradius↔Kameraabstand (Regel −0,066, verwürfelt −0,157…+0,068 = reines Rauschen). Getragen wird die Regel von Bereichsausschöpfung, Häufigkeitsprobe (die drei geometrielosen Bühnen sind zugleich die drei seltensten `location`-Werte) und Sichtvergleich | 🟡 |
| Kampf-Modellmaßstab (K3) | **Faktor 1**, kein Umrechnungsfaktor | Sweep 1/4/8/16 durch die Szenenkamera: schon bei 4 füllt ein Party-Unterarm ein Drittel des Bildes. Der Feldfaktor 4 (F37) gilt im Kampf NICHT | ✅ |
| Weltkarten-Texturtabelle (F11b) | Zeigerfeld in `ff7.exe` @ Dateiversatz `0x5686E8` (VA `0x969CE8`), **402 Einträge** = 390 Overworld + 8 Unterwasser + 4 Gletscher; **380/380 Namen lösen in `world_us.lgp` auf, 0 Fehlverweise** | vier Kandidatenordnungen mit derselben Gütefunktion **widerlegt**; die 22 namenlosen Einträge zeigen in BSS — und genau **22** ist unabhängig auch die Eintragszahl von `wm.ta` (zwei Quellen, dieselbe Zahl) | ✅ |
| Fensterschale, alte gegen neue Optik | **457/457** berechnete CSS-Eigenschaften identisch, identisches Kastenmaß | als Unit-Test verankert; ersetzt den nicht möglichen Screenshot-Vergleich | ✅ |

### Was NICHT belegt ist — die drei tragenden Vorbehalte

1. 🔴 **Die Hauptmenü-Aufteilung.** Unter den 18 Referenzbildern
   (`apps/demo/.shots/ref/`) ist **keine Menüaufnahme** — gesichtet wurden
   Sternenhimmel, sechs Field-Szenen, drei Kampfszenen, ein Dialogfenster, drei
   Kampfabschluss-Bildschirme. `docs/fremdquellen/makoureactor.md` dokumentiert
   ebenfalls keine Menüaufteilung; Abschnitt 19.7 beschreibt die Fenstergeometrie
   des **FIELD**-Skripts (Fläche 320×224), also eine andere Fläche und einen
   anderen Bildschirm. Alle Zahlen liegen deshalb in **einem** austauschbaren
   Objekt `FF7_MAIN_MENU_LAYOUT`. Wer eine Menüaufnahme beschafft, korrigiert
   Zahlen, keinen Code. Ob die Kommandospalte im Original links oder rechts
   steht, ist damit ausdrücklich **nicht** entschieden.
2. 🔴 **Die Kampfkamera** (s. F26) — der größte verbleibende Sichtmangel.
3. 🔴 **Der Text kommt weiterhin aus einer Systemschrift**, nicht aus dem
   Fontblatt in WINDOW.BIN Sektion 1. Der Parser liefert die Textur inzwischen
   (256×252, 4 bpp, Palette), benutzt wird sie noch nicht. Die Metrik stimmt
   damit **rechnerisch**, die tatsächlich gezeichneten Pixelbreiten sind aber die
   der Systemschrift. Solange das so ist, bleibt auch offen, welche Breite beim
   **Zeichnen** für die 12–15 Zeichen gilt, bei denen die additive Regel und die
   Namensplatzhalter-Rechnung auseinanderlaufen — die Fenstermessung entscheidet
   sich klar für additiv, die Platzhalterbreite 117 px = 9 × 13 rechnet
   nachweislich mit dem Maximum der **unteren 5 Bit**.

### Weiterhin ohne Pixelvergleich

Zum dritten Mal in Folge festgehalten, weil es sich nicht von selbst erledigt:
**`apps/demo/.shots/ref/` existiert im Arbeitsbaum nicht** — die 18
Referenzbilder liegen nur in einem Worktree unter `.claude/worktrees/`. Einen
automatisierten Bild-gegen-Bild-Vergleich der neuen Optik gibt es deshalb nicht.
Ersetzt ist er durch DOM-Kantenmessungen im Browser, den 457/457-Eigenschafts-
vergleich und Struktur-/Geometrietests. Wer den Pixelvergleich will, muss die
Referenzbilder zuerst in den Arbeitsbaum holen.

---

## Welle 3 — die Spielschrift (2026-08-15)

**Erledigt der dritte tragende Vorbehalt der Welle-2-Abnahme.** Text kommt nicht
mehr aus einer Systemschrift, sondern aus dem Fontblatt der Installation
(`WINDOW.BIN` Sektion 1). Betroffen sind Dialog, Menü und Kampf-HUD in einem
Zug, weil alle drei durch dieselbe Fensterschale laufen.

### Zuerst gemessen, dann gebaut

`tools/realdata-scan/src/fontblatt-probe.rdtest.ts` klärt den Aufbau einer
Zelle, bevor eine Zeile gezeichnet wird:

| Größe | Befund |
|---|---|
| Blatt | 256 × 252, 4 bpp, Zellen 12 × 12, 21 je Zeile — **die Zellennummer ist der Textcode** |
| Palettenindizes im Bestand | nur **0, 1, 3** — durchsichtig, dunkel, hell |
| Paletten | 8 Zeilen (grau, blau, rot, magenta, grün, cyan, gelb, weiß) |
| belegte Zellen | 212, davon **212 linksbündig** |
| rechte Randspalte berührt | **1 von 212** — Kontrollniveau dafür, dass das Raster sitzt |

Zwei Folgerungen bestimmen den Zeichenweg und stehen als Kommentar am Code:
**(1) Der Schatten steckt im Blatt** (Index 1 ist die dunkle Kante) — der
CSS-Schatten wird deshalb beim Zeichnen ausdrücklich zurückgenommen, sonst käme
er doppelt. **(2) Die Textfarbe ist eine Palettenzeile, kein CSS-Wert**;
Farbwechsel im Text sind ein Zeilenwechsel. Vorgabe ist Zeile 7 (weiß).

### Abnahme gegen den echten Bestand

`tools/realdata-scan/src/schrift-abdeckung.rdtest.ts`, 702 Fields:

| Größe | Wert | Kontrolle |
|---|---|---|
| Zeichen im Dialogbestand | 2 584 250 | — |
| **Abdeckung** (Zeichen mit Textcode) | **99,9993 % (2 584 232)** | die 18 Fehlstellen sind ausnahmslos `U+FFFD` aus dem Dekoder, kein Blattproblem |
| verschiedene Codes | 98 | — |
| **Stimmigkeit** Zeichen → Code → Zelle (`Vorschub = Tinte + 1`) | **84,19 %** gewichtet | Zelle +1: **45,58 %** · Zelle −1: **39,26 %** |

Die Rückabbildung Zeichen → Code wird **aus derselben `FfTextTable` abgeleitet**,
mit der dekodiert wurde — keine zweite Tabelle, die auseinanderlaufen könnte.
Mehrzeichige Belegungen (Namensplatzhalter, `', '`) zerfallen beim Zeichnen in
ihre Einzelzeichen.

### Was die neue Schrift sofort aufgedeckt hat

**F46 — Die Menüaufteilung war für die Spielschrift zu schmal.** Mit der
Systemschrift passte alles; mit den echten Vorschüben nicht mehr. Gemessen an
der laufenden Demo: längstes Kommando („Gegenstand") **138 px**, Zeigerspalte
20 px, „Zeit" + „8:39:36" **154 px** — die Textfläche der linken Spalte bot
134 px. Der Zeiger lag auf dem „G", und der Zeitwert überschrieb sein Label
(sichtbar als „Ze8:39:36"). Die Spaltenbreite ist damit **keine freie Zahl
mehr**: Sie ist aus der gemessenen Schrift nach unten begrenzt und steht jetzt
mit Herleitung in `packages/menu/src/layout.ts` (204 px ⇒ 170 px Textfläche).
🔴 Die *Anordnung* bleibt unbelegt — gemessen ist die Untergrenze, nicht die
Aufteilung.

**F47 — Der Auswahlzeiger ist kein Blattzeichen.** `▶` ist das einzige Zeichen
im gesamten Bestand ohne Zelle; im Original sitzt der Zeiger in der
Fenstergrafik (Sektion 0). Fehlstellen werden deshalb **sichtbar in
Systemschrift** gesetzt statt als leeres Kästchen — der erste Entwurf hatte den
Zeiger stumm verschwinden lassen.

**F48 — Die oberen Bits des Breitenbytes bleiben offen, aber jetzt scharf
gestellt.** Der Welle-2-Vorbehalt fragte, welche Auslegung beim *Zeichnen* gilt.
`tools/realdata-scan/src/glyph-oberbits-probe.rdtest.ts` misst beide gegen die
Tintenbreite:

| Gruppe | additiv trifft Tinte + 1 | untere 5 Bit treffen Tinte + 1 |
|---|---|---|
| ohne obere Bits (200 Glyphen) | 97,0 % | 97,0 % (dieselbe Rechnung — eingebaute Kontrolle) |
| **mit oberen Bits (12 Glyphen)** | **0,0 %** | **16,7 %** |

**Beide Auslegungen fallen durch.** Betroffen sind genau `" ( ) , . 1 : Ä Å Ç É
Ñ`. Gezeichnet wird weiter mit der additiven Regel, weil sie als einzige
unabhängig belegt ist (Fenstermessung Welle 2: 38,90 % exakt gegen 21,80 %) —
sichtbare Folge ist der Abstand hinter `1` und `.`. Der Sichtvergleich mit dem
Referenzdialog (`20260810223255_1.jpg`, „Follow me. ”") zeigt genau denselben
breiten Abstand hinter dem Punkt, stützt die additive Regel also. Offen bleibt,
ob das Original zusätzlich einen **linken Versatz** aus den oberen Bits
anwendet; das entscheidet erst eine Aufnahme mit Ziffern in Dialogschrift oder
die Textroutine des Originals (jetzt nach [ADR-027](ADR-027-DECOMP-REFERENZ.md)
zulässig).

### Rückfall

Ohne `WINDOW.BIN` bleibt es bei der Systemschrift — sichtbar und begründet: Der
Bootlog schreibt entweder „Spielschrift aus WINDOW.BIN (212 belegte Zellen,
Palettenzeile 7, Vorschub aus der Breitentabelle)" oder den Grund, warum nicht.
Ein stiller Rückfall existiert nicht.

---

## Welle 4 — Durchstich: O11 und F15 (2026-08-15)

### O11 ✅ — Rücksprünge zählen vom Opcode-Byte

Der Posten stand seit dem 11.08. als belegter, aber **bewusst nicht behobener**
Defekt: `vm.ts` rechnete `ip + 1 − offset`, richtig ist `ip − offset`. Grund für
das Aufschieben war, dass der Fixture-Assembler dieselbe falsche Konvention
kodierte — beide Seiten waren konsistent falsch, eine einseitige Korrektur
hätte jede Fixture-Schleife zerrissen. Jetzt sind **beide in einem Zug**
korrigiert (`packages/interpreter/src/vm.ts`,
`tools/fixture-gen/src/script-assembler.ts`).

Die Messung ist als Dauerprobe verankert
(`tools/realdata-scan/src/sprungziel-probe.rdtest.ts`, 702 Fields):

| Sprungart | implementierte Regel | Kontrolle (um 1 verschoben) |
|---|---|---|
| `JMPB` | `ip − off` → **99,5 %** (5270/5298) | `ip + 1 − off` → 0,7 % |
| `JMPBL` | `ip − off` → **80,2 %** (97/121) | `ip + 1 − off` → **0,0 %** |
| `JMPF`/`JMPFL` (Eichung) | `ip + 1 + off` → **98,8 %** (10970/11105) | `ip + off` → 4,9 % |

Die Vorwärtsrichtung ist die **Eichung der Messanlage**: Sie war schon vorher
richtig und muss es bleiben, sonst misst die Rückwärtsaussage nichts.

**Alle drei Replay-Digests sind gewandert** — das ist das erwartete Ergebnis und
zugleich die Probe darauf, dass die Assembler-Seite mitgezogen wurde. Ein
stillstehender Digest wäre hier der Alarm gewesen. Verhalten unverändert:
die Schleifentests in `interpreter.test.ts` sind vor wie nach der Änderung grün.

### F15 ✅ — Der Gateway-Record war zur Hälfte falsch gedeutet

**Ausgangspunkt.** Die Austrittslinie von `md1stin` las sich als
(353, 3669, 29368) → (353, 1049, 400): eine Diagonale über die halbe Karte. Der
Übertritt feuerte nie.

**Gemessen** (`gateway-linie-probe`, `gateway-zielpunkt-probe`; alle 1095
belegten Records, elf mögliche `i16`-Paare, Punkt-in-Dreieck gegen das
begehbare Netz):

| Feld | Versatz | Beleg | Kontrolle |
|---|---|---|---|
| Austrittsstelle im **eigenen** Netz | @2/@4 | **85,5 %** (936/1095) | Fremdfeld 27,0 %; alle übrigen Versätze ≤ Kontrolle |
| Ankunftsstelle im **Ziel**netz | @8/@10 | **100,0 %** (978/978) | Maplist-Nachbar 33,1 % · eigenes Field 36,2 % · verschobene Zuordnung 46,2 % |

**Kohärenzprobe** über 771 Gegen-Gateway-Paare: Der Zielpunkt von A liegt im
Median **142 Einheiten** vom Austrittspunkt des Gegen-Gateways entfernt (82,7 %
unter 300); Kontrolle „anderes Gateway desselben Zielfields": Median **1107**,
nur 8,8 % unter 300. Beide Deutungen stützen sich gegenseitig.

**Damit ist ein eigener Befund aus S11 widerlegt** — dort stand „der Zielpunkt
steht NICHT im Record". Er war nicht falsch gemessen, sondern zu eng: geprüft
wurden @12, @16 und @18; **@8 stand nie in der Kandidatenmenge.** Das ist ein
vierter Fehlertyp neben „falsche Suchmenge", „blinde Gütefunktion" und „die
Antwort stand schon in einer Rechnung": **eine Kandidatenmenge, die den
richtigen Platz gar nicht enthält, erzeugt einen sauberen Negativbefund.**

**Zwei Hypothesen sind dabei gefallen, beide vermessen statt verworfen:**

- *Endpunkte sind Walkmesh-Vertices*: an keinem Versatz (Bestwert 2/1095,
  Fremdfeld-Kontrolle gleichauf).
- *@0/@6 sind Dreiecksnummern*: 0,8 % bzw. 0,9 % gegen Nachbarkontrollen von
  0,4 % / 1,8 %. Sie bleiben roh und 🟡.

🔴 **Eine Austrittslinie ist nicht auffindbar.** Für einen zweiten Punkt im
eigenen Netz trägt kein Versatz (bester Kandidat @20: 70,4 % gegen 37,0 %), und
als Strecke gerechnet verbessern **alle** Kandidaten den Abstand zum
Gegen-Gateway gleich stark (Median 87–119 gegen 142 für den Punkt allein) — das
ist keine Trennung, sondern der Gewinn, den jede Verlängerung bringt.

**Folgen im Code.** Der Übertritt läuft über den **Punkt**: Ein Gateway feuert,
wenn der Bewegungsschritt in den Kreis mit `GATEWAY_RADIUS` = 300 um den
Austrittspunkt **eintritt** (Schrittanfang außerhalb). Drei naheliegendere
Formulierungen scheitern und stehen als Test: „Abstand < R" feuert in jedem
Takt; „Abstand < R und Annäherung" feuert innerhalb des Kreises weiter; der
reine Endpunktvergleich verpasst schnelle Schritte. Der Radius ist 🔵, aber
**beidseitig aus den Daten eingegrenzt**: nach unten durch die Ankunftsstreuung
(Median 142, 82,7 % unter 300), nach oben durch den Abstand benachbarter
Gateways (Median 1107 ⇒ Radius < 553).

**Abnahme** (`field-transition.rdtest.ts`):

| Größe | vorher | jetzt |
|---|---|---|
| Kanten mit begehbarer Ankunft | 510 (46,6 %) | **978 (89,3 %)** — das sind **alle** auflösbaren; die restlichen 117 nennen Fields, die das Archiv nicht führt |
| Herkunft der Ankunft | Gegen-Gateway | **978× aus dem Record**, 0× Rückfall |
| Ankunft pendelt sofort zurück | 0 | 3 (0,3 %) — die Ankunft liegt dort, wo das Spiel sie hinsetzt; ein Schritt genau darauf zu ist erlaubtes Spielverhalten, kein Selbstlauf |

**Sichtnachweis:** `md1stin` → `md1_1` läuft in der Demo, Ankunft exakt auf
(1049, 400), Protokollzeile „Zielpunkt aus dem Record". `md1_1` führt weiter
nach `md1_2` — die Kette des Demo-Ziels steht.

## Welle 4, zweiter Teil — F35 vermessen, F07 gelöst, Wellenabnahme (2026-08-15)

### F35 — die Zeichenregel bleibt, und das ist ein Messergebnis

F35-1 hatte die Frage offen gelassen: Heißt eine leere Hintergrundmaske
„unsichtbar" (geltende Regel) oder „zurück zum Anfangszustand"? Die Antwort
schien eine Geschmacksfrage. Sie ist keine.

**Ausgangsbefund** (`junonr2-bgfluss-probe`, Vollerhebung über 508 Fields mit
animierten Kachelgruppen): Von 1256 Gruppen stehen nach 300 Ticks **340** auf
Maske 0 — und **keine einzige davon unberührt**. Jede wurde vom Field-Script
selbst abgeschaltet.

**Drei Deutungen, drei Vorhersagen, drei Fehlschläge** (`bg-endzustand-probe`):

| Vorhersage | erwartet | gemessen | |
|---|---|---|---|
| **H1** Es sind Einmal-Effekte ⇒ die Gruppen sind **klein** | deutlich kleiner als die belegt endenden | Median **36** gegen **25** — sie sind eher *größer* | ✗ |
| Kontrolle: dieselbe Rechnung mit **vertauschten** Endmasken | Unterschied verschwindet | **35 gegen 27** — praktisch derselbe Split | ⇒ H1 ist nicht widerlegt, sondern **entwertet**: die Endmaske sagt über die Größe nichts |
| **H2** Maske 0 heißt Anfangszustand | große Dauerobjekte enden auf 0 | s. o. — kein Signal | ✗ |
| **H3** BGCLR (Auswahl aufheben) ≠ BGOFF (Bit löschen) ⇒ nur-BGCLR-Gruppen sind **groß** | größer | **31 gegen 48** — genau umgekehrt | ✗ |

**Der deutungsfreie Test entscheidet.** Alle drei Vorhersagen setzen voraus, man
wüsste, was eine Kachelgruppe *darstellt*. Die vierte Messung tut das nicht —
sie fragt nur, welchen **Bildanteil** die geltende Regel nach 300 Ticks
wegnimmt, gemessen gegen den Anfangszustand:

| Größe | Wert |
|---|---|
| Median des fehlenden Bildanteils | **0,0 %** |
| Fields über 10 % | 27/508 |
| Fields über 25 % | 10/508 |
| Fields über 50 % | **1/508** (`junin7`, 61,7 %) |

⚠️ **Ein erster Anlauf dieser Messung war falsch** und wies Anteile bis 83 %
aus. Er zählte alle Kacheln ohne gesetztes Bit — also auch die sieben von acht
Animationsphasen, die zu Recht ausgeblendet sind. Die Zahl hätte den Verdacht
bestätigt, ohne ihn zu messen. Gezählt wird jetzt nur der Fall Endmaske 0.

**Folge: keine Regeländerung.** Der typische Field verliert nichts; eine
Umstellung auf „leere Maske ⇒ Anfangszustand" würde die 169 Gruppen zerstören,
die das Script absichtlich abschaltet. Der Rest ist ein **begrenzter Ausläufer**,
und er ist als Dauerprobe eingezäunt: Wächst er über 3 Fields mit mehr als 50 %
oder über 40 mit mehr als 10 %, schlägt der Test an.

**Eine Zuordnung aus F35-1 war falsch.** Dort steht, `door` (Entity 0) und
`lift` (Entity 3) seien die Hintergrundgruppen mit param 16 bzw. 17/18. Der
Kontrollflusslauf zeigt: param 16 gehört `door`, **17 und 18 gehören `smoke0`
und `smoke1`** — und `lift` trägt **weder Modell noch Hintergrundparameter**.
Seine Animationsspannen (ab ip 1976) werden in 300 Ticks nie betreten; sie
hängen an `REQSW`-Aufrufen aus `cloud/slot5`, `tifa/slot5`, `cid/slot5` und
`hyde/slot10`, also an Story-Szenen. 🔵 **Damit ist F35 an der untersuchten
Stelle kein Defekt der Engine**, sondern die richtige Folge davon, dass diese
Szenen in einer freilaufenden Demo nicht ablaufen. Was `lift` überhaupt
zeichnet, bleibt 🔴 offen.

### F07 — das Menü handelt: Ausrüsten und Speichern

Bis Welle 3 stand in `model.ts`: „Es gibt keinen Schreibpfad." Das war richtig,
solange es keine Handlung gab, und es hatte den Preis, dass „Ausrüsten" und
„Speichern" in der Kommandospalte standen und nichts taten.

**Drei Schichten, strikt getrennt** — die Trennung ist der eigentliche Inhalt
dieses Postens:

| Schicht | Ort | Aufgabe |
|---|---|---|
| Bytes | `formats-save/src/write.ts` (neu) | schreibt in den 4340-B-Slot, gibt **immer einen neuen Slot** zurück |
| Ablauf | `menu/src/actions.ts` (neu) + `session.ts` | Auswahllisten, Zeigerlogik, Rückmeldungen — kennt keine Bytes |
| Verdrahtung | `apps/demo/src/game-demo.ts` | hält die Bytes, deutet sie mit `readSavemap` |

**Abnahme des Schreibpfads: die Bytedifferenz.** Neben der Rückleseprobe prüft
jeder Test, **welche** Bytes des Slots sich bewegt haben. Ein Schreibfehler, der
nebenbei ein fremdes Feld trifft, überlebt jede Rückleseprobe und stirbt hier.
Zwei Testerwartungen waren dabei zunächst falsch gedacht: Wer 200 nach 12345
schreibt, ändert von vier u32-Bytes nur zwei — identische Bytes sind kein
Unterschied. Die Prüfung fragt deshalb nach der Gegenrichtung: **außerhalb** des
erlaubten Fensters darf sich nichts bewegen.

**Erhaltung statt Buchhaltung.** Der Ausrüstungstausch ist der Punkt, an dem
eine naive Umsetzung Gegenstände erzeugt oder vernichtet. `countItem` zählt eine
Kennung über Inventar **und** alle Ausrüstungsspalten; der Test verlangt, dass
diese Summe über zwei Tauschvorgänge konstant bleibt.

🟡 **Was ausdrücklich nicht passiert:** HP-/MP-Maxima (@56/@58) tragen die
Ausrüstungsboni, und die Formel dafür ist ungemessen — sie bleiben stehen, und
die Ansicht sagt das. 🔴 Die Materia-Umverteilung beim Waffenwechsel ist
ebenfalls ungemessen; die Plätze bleiben unverändert, mit Hinweis im Fußfenster.
🔴 **„Benutzen" fehlt weiterhin** und zwar mit Grund: Der `ItemRecord` trägt
`attackPower` und `damageCalculationId`, aber keine belegte Wirkungsangabe. Ein
Trank, der Punkte verbraucht und nichts heilt, wäre schlechter als kein Trank.

### Save/Load — Schemaversion 2

`SaveSlot` führt jetzt die Savemap mit (4340 B). Version 1 kannte sie nicht,
weil es keine veränderliche gab; `acceptSlot` **migriert** solche Stände, statt
sie abzulehnen, und `savemap` bleibt dabei `undefined` — es wird nichts
erfunden, und die Warnung steht im Ergebnis.

In der laufenden Demo geprüft (F6 speichern, F7 laden, Platz 1):

| Schritt | Cloud, Waffenindex |
|---|---|
| Start | 7 |
| ausgerüstet (Auswahlliste, zweite Zeile) | **32** |
| gespeichert (F6) | — |
| noch einmal ausgerüstet | 87 |
| geladen (F7) | **32** |

Der Inventarplatz belegt den Tausch mit: Kennung 160 (= 128 + 32) wird zu 135
(= 128 + 7) — das neue Stück kam heraus, das alte ging zurück, auf denselben
Platz gestapelt. Field und Takt (471) werden mitgeladen.

### Wellenabnahme: sechs Fields am Stück, gelaufen statt gerechnet

`field-transition.rdtest.ts` rechnet **Kanten**. Die Wellenabnahme verlangt
etwas anderes: dass eine Figur, die **läuft**, durchkommt. Dazwischen liegen die
Auslöseregel, der Walkmesh-Solver mit seinem Gleiten an Wänden und der
Sitzungstakt. `feldkette-probe.rdtest.ts` läuft deshalb wirklich.

| Wechsel | Takte | Ankunft | Quelle |
|---|---|---|---|
| `md1stin` → `md1_1` | 460 | 1049/400 | Record |
| `md1_1` → `md1_2` | 247 | 3560/30579 | Record |
| `md1_2` → `nrthmk` | 781 | 832/−3051 | Record |
| `nrthmk` → `md8_4` | 706 | 82/267 | Record |
| `md8_4` → `nrthmk` | 40 | −916/−3028 | Record |
| `nrthmk` → `nmkin_1` | 602 | −697/1277 | Record |

**6/6, sechs verschiedene Fields, 2836 Takte, alle Ankünfte aus dem Record.**
Die Kontrolle trägt: dieselben sechs Ankünfte mit Bewegungseingabe **null**,
1200 Takte lang — **0 Übertritte**. Ohne diese Gegenprobe wäre der Erfolg
wertlos; eine Regel, die jeden Takt feuert, käme auch durch sechs Fields.

**Drei Fehlschläge beim Bau dieses Tests, alle lehrreich, keiner ein Enginefehler:**

1. **0/6.** Die Figur stand auf der Austrittsstelle selbst. Der Übertritt feuerte
   nie — richtig so: Die Regel ist der **Eintritt** in den Kreis. Der Test hatte
   seine eigene Aufstellung widerlegt, nicht die Kette.
2. **2/6.** Nach jedem Wechsel landet die Figur im Kreis des Gateways, durch das
   sie kam. Sie muss ihn erst verlassen — genau das tut ein Spieler auch. Der
   Lauf hat seitdem zwei Beine.
3. **4/6.** Schnurgerader Zielkurs bleibt an der ersten Wand stehen; dann misst
   der Test die Wand. Der Walkmesh trägt seine Nachbarschaft selbst
   (`adjacency`), eine Breitensuche darüber liefert begehbare Wegpunkte.

**Warum nicht sieben verschiedene Fields:** `md8_4` hat nur **einen**
Gateway-Ausgang — im Original geht es dort per Script weiter, und Scripte laufen
in diesem Test bewusst nicht. Die Kette nimmt deshalb bekannte Ziele, wenn kein
unbekanntes bleibt; das prüft die Strecke zusätzlich in der Gegenrichtung. Der
Sollwert ist **fünf** verschiedene Fields, nicht sieben — das ist eine Aussage
über den Bestand, nicht über die Engine.

### Läufe

| Lauf | Ergebnis |
|---|---|
| `npx vitest run` | **72 Dateien / 893 Tests grün** (vorher 854 — neu: 21 Schreibpfad, 16 Menü-Handlungen, 2 Schemamigration) |
| `npx vitest run --config vitest.realdata.config.ts` | **105 Dateien, 183 grün / 88 übersprungen, 0 Fehler** |
| `npx tsc -b` | grün |
| Replay-Digests | unverändert (`digestStabil: true`) — das Menü schreibt die Savemap, nicht die Spielwelt |

⚠️ Zwei `ERR_INVALID_STATE`-Meldungen (`FileHandle … closed during garbage
collection`) aus `menu-savemap-probe.rdtest.ts` laufen als „unhandled errors"
mit. Sie sind **nicht** von dieser Welle verursacht und kein Testfehlschlag —
die Probe schließt ihre Dateihandles nicht ausdrücklich. Als eigener Posten
notiert, statt stillschweigend übergangen.
